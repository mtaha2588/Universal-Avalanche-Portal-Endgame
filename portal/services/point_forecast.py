"""Exact-place forecast for the Avalanche Alert Forecast dashboard (/api/alertforecast/point).

The ECMWF IFS forecast (Open-Meteo) for the clicked coordinates, downscaled by Open-Meteo to that place's own elevation,
run through the same daily aggregation, avalanche drivers and final alert rule as forecast/forecast_core.py
(hourly_to_daily, drivers, apply_rules with final=True), with the calibrated thresholds of the 0.25 deg tile the place is in.
Pure Python (the portal's .venv has no pandas). Results are cached for 3 hours per ~500 m; the Open-Meteo key, if any, is read
on the server (OPENMETEO_APIKEY or forecast/config/settings.json) and never sent to the browser.
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DET_URL = "https://api.open-meteo.com/v1/ecmwf"
HOURLY = ["temperature_2m", "precipitation", "rain", "snowfall", "snow_depth", "wind_gusts_10m", "pressure_msl",
          "freezing_level_height"]
# forecast_core.DEFAULTS (kept in step; config/settings.json overrides, exactly as run_forecast.load_cfg does)
DEFAULTS = {"min_elev_m": 1200, "moderate_sf3d_floor_mm": 10, "high_sf3d_floor_mm": 25, "warm_sf7d_floor_mm": 20,
            "snowpack_depth_m": 0.05, "snowpack_sf7d_mm": 30, "past_days": 7, "forecast_days": 15}
REGIONS_DEFAULT = {"names": {"hindu_kush": "Hindu Kush", "karakoram": "Karakoram", "west_himalaya": "West Himalaya"},
                   "lon_hindu_kush_max": 72.8, "lat_split": 35.1, "lon_karakoram_min": 73.6}
HALF = 0.125            # half a 0.25 deg tile
NEAR_DEG = 0.3          # a place this close to a tile centre (but outside it) borrows that tile's thresholds
CACHE_S = 3 * 3600
GRID = 0.005            # cache key resolution, ~500 m


class OutsideArea(ValueError):
    pass


def _num(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _max(xs):
    xs = [x for x in xs if x is not None]
    return max(xs) if xs else None


def _min(xs):
    xs = [x for x in xs if x is not None]
    return min(xs) if xs else None


def _sum(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) if xs else None


def _ge(a, b):
    return a is not None and b is not None and a >= b


def _in_ring(x, y, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def hourly_to_daily(hourly: dict) -> list[dict]:
    """forecast_core.hourly_to_daily for one place, one member."""
    times = hourly.get("time", [])
    col = {k: [_num(v) for v in hourly.get(k, [None] * len(times))] for k in HOURLY}
    use_rain = any(v is not None for v in col["rain"])
    days: dict[str, dict] = {}
    for i, t in enumerate(times):
        d = days.setdefault(t[:10], {k: [] for k in HOURLY + ["snow_we"]})
        for k in HOURLY:
            d[k].append(col[k][i])
        p, r, s = col["precipitation"][i], col["rain"][i], col["snowfall"][i]
        if use_rain:
            d["snow_we"].append(None if p is None or r is None else max(p - r, 0.0))
        else:                       # Open-Meteo snowfall is cm of snow; 1 mm of water = 0.7 cm
            d["snow_we"].append(None if s is None else s / 0.7)
    out = []
    for date in sorted(days):
        d = days[date]
        if len(d["temperature_2m"]) < 18:        # drop incomplete days at the ends
            continue
        out.append({"date": date, "snowfall_mmwe": _sum(d["snow_we"]) or 0.0, "precip_mm": _sum(d["precipitation"]),
                    "rain_mm": _sum(d["rain"]), "t2m_max_c": _max(d["temperature_2m"]), "t2m_min_c": _min(d["temperature_2m"]),
                    "t2m_mean_c": _mean(d["temperature_2m"]), "gust10_max_ms": _max(d["wind_gusts_10m"]),
                    "mslp_hpa": _mean(d["pressure_msl"]), "snow_depth_m": _mean(d["snow_depth"]),
                    "deg0l_m": _mean(d["freezing_level_height"])})
    return out


def drivers(days: list[dict], cfg: dict) -> list[dict]:
    """forecast_core.drivers: 3/5/7-day rolling sums (min_periods=1), snowpack, rain on snow, 3-day changes."""
    def roll(i, key, w, how):
        vals = [days[j][key] for j in range(max(0, i - w + 1), i + 1)]
        return _sum(vals) if how == "sum" else _max(vals) if how == "max" else _mean(vals)
    for i, d in enumerate(days):
        for w in (3, 5, 7):
            d[f"sf_{w}d_mm"] = roll(i, "snowfall_mmwe", w, "sum")
        d["snowpack"] = _ge(d["snow_depth_m"], cfg["snowpack_depth_m"]) or _ge(d["sf_7d_mm"], cfg["snowpack_sf7d_mm"])
    for i, d in enumerate(days):
        prev_pack = days[i - 1]["snowpack"] if i > 0 else False
        d["ros_mm"] = (d["rain_mm"] or 0.0) if prev_pack else 0.0
    for i, d in enumerate(days):
        d["ros_3d_mm"] = roll(i, "ros_mm", 3, "sum")
        back = days[i - 3]["t2m_max_c"] if i >= 3 else None
        d["tmax_rise_3d_c"] = d["t2m_max_c"] - back if d["t2m_max_c"] is not None and back is not None else None
        d["gust_max_3d_ms"] = roll(i, "gust10_max_ms", 3, "max")
    return days


def apply_rule(d: dict, t: dict, cfg: dict, elev_m: float | None) -> int:
    """forecast_core.apply_rules(final=True) for one day: 0 Low, 1 Moderate, 2 High, -1 not rated."""
    if elev_m is not None and elev_m < cfg["min_elev_m"]:
        return -1
    lvl = 0
    for k, name in ((1, "MODERATE"), (2, "HIGH")):
        floor = cfg["moderate_sf3d_floor_mm"] if k == 1 else cfg["high_sf3d_floor_mm"]
        a = _ge(d["sf_3d_mm"], t.get(f"{name}_sf3d_mm")) and _ge(d["sf_3d_mm"], floor)
        if f"{name}_gust3d_ms" in t:
            a = a and _ge(d["gust_max_3d_ms"], t[f"{name}_gust3d_ms"])
        if f"{name}_tmax_rise3d_c" in t:
            w = (_ge(d["tmax_rise_3d_c"], t[f"{name}_tmax_rise3d_c"]) and _ge(d["sf_7d_mm"], t.get(f"{name}_sf7d_mm"))
                 and d["snowpack"] and _ge(d["sf_7d_mm"], cfg["warm_sf7d_floor_mm"]))
            a = a or w
        if f"{name}_ros3d_mm" in t:
            a = a or (_ge(d["ros_3d_mm"], t[f"{name}_ros3d_mm"]) and d["snowpack"])
        if a:
            lvl = max(lvl, k)
    return lvl


class PointForecast:
    def __init__(self, forecast_dir: Path, study_area: Path, fetch=None):
        self.dir = Path(forecast_dir)
        self.study_area = Path(study_area)
        self._fetch = fetch or self._http
        self._lock = threading.Lock()
        self._cache: dict = {}
        self._tt = (None, None)
        self._area = None

    # ---------------------------------------------------------------- inputs
    def cfg(self) -> dict:
        cfg = dict(DEFAULTS)
        p = self.dir / "config" / "settings.json"
        if p.exists():
            cfg.update({k: v for k, v in json.loads(p.read_text(encoding="utf-8")).items() if not k.startswith("_")})
        return cfg

    def apikey(self) -> str | None:
        return (os.getenv("OPENMETEO_APIKEY") or os.getenv("AVALANCHE_APIKEY") or self.cfg().get("apikey") or "").strip() or None

    def tiles(self) -> dict:
        p = self.dir / "data" / "tile_thresholds.csv"
        mt = p.stat().st_mtime_ns
        if self._tt[0] != mt:
            tiles = {}
            with p.open(encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    m = re.match(r"N([\d.]+)_E([\d.]+)", row["tile_id"])
                    t = {k: float(v) for k, v in row.items() if re.match(r"^(MODERATE|HIGH)_", k) and not k.endswith("_rule") and v != ""}
                    t.update(id=row["tile_id"], lat=float(m.group(1)), lon=float(m.group(2)), elev_m=float(row["elev_approx_m"]))
                    tiles[row["tile_id"]] = t
            self._tt = (mt, tiles)
        return self._tt[1]

    def region(self, lat: float, lon: float) -> str:
        r = dict(REGIONS_DEFAULT)
        p = self.dir / "config" / "regions.json"
        if p.exists():
            r.update({k: v for k, v in json.loads(p.read_text(encoding="utf-8")).items() if not k.startswith("_")})
        if lon < r["lon_hindu_kush_max"]:
            return r["names"]["hindu_kush"]
        if lat >= r["lat_split"]:
            return r["names"]["hindu_kush"] if lon < r["lon_karakoram_min"] else r["names"]["karakoram"]
        return r["names"]["west_himalaya"]

    def in_study_area(self, lat: float, lon: float) -> bool:
        if self._area is None:
            g = json.loads(self.study_area.read_text(encoding="utf-8"))
            polys = []
            for f in g["features"]:
                if f["properties"].get("layer") != "study_area":
                    continue
                geom = f["geometry"]
                polys += [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
            self._area = polys
        for poly in self._area:
            if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
                return True
        return False

    def grid_tiles(self) -> dict:
        """ERA5 grid tiles with no thresholds (forecast/data/tiles.csv, use_for_thresholds False: perennial snow / glacier /
        missing years; pipeline/step1_prepare_era5.py) - the glaciated high Karakoram and the band north of 36.4 N."""
        p = self.dir / "data" / "tiles.csv"
        if not p.exists():
            return {}
        mt = (p.stat().st_mtime_ns, self._tt[0])
        if getattr(self, "_gt", (None,))[0] == mt:
            return self._gt[1]
        cal, out = self.tiles(), {}
        with p.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["tile_id"] in cal:
                    continue
                why = ("glacier-capped" if row.get("glacier_capped") == "True" else "perennial snow" if row.get("perennial_snow") == "True"
                       else "missing ERA5 years")
                out[row["tile_id"]] = {"id": row["tile_id"], "lat": float(row["lat"]), "lon": float(row["lon"]),
                                       "elev_m": float(row["elev_approx_m"]), "why": why}
        self._gt = ((p.stat().st_mtime_ns, self._tt[0]), out)
        return out

    def tile_for(self, lat: float, lon: float):
        """-> (thresholds tile or None, relation, distance_km, uncalibrated grid tile the place is in or None)."""
        inside = lambda t: abs(t["lat"] - lat) <= HALF + 1e-9 and abs(t["lon"] - lon) <= HALF + 1e-9
        best, bd = None, 1e9
        for t in self.tiles().values():
            if inside(t):
                return t, "inside", 0.0, None
            d = math.hypot((t["lon"] - lon) * math.cos(math.radians(lat)), t["lat"] - lat)
            if d < bd:
                best, bd = t, d
        near = best if best is not None and bd <= NEAR_DEG else None
        unc = next((g for g in self.grid_tiles().values() if inside(g)), None)
        if unc is not None:          # glacier / perennial-snow tile: weather always, a level only if one can be borrowed
            return near, ("borrowed" if near else "none"), (bd * 111.0 if near else None), unc
        if near is not None:
            return near, "nearest", bd * 111.0, None
        return None, None, None, None

    # ---------------------------------------------------------------- download
    def _http(self, params: dict) -> dict:
        url = DET_URL + "?" + urllib.parse.urlencode(params)
        last = None
        for k in range(3):
            try:
                with urllib.request.urlopen(url, timeout=25) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                last = e
                if e.code != 429:
                    break
                time.sleep(2 * (k + 1))
            except Exception as e:  # network
                last = e
                time.sleep(1 + k)
        raise RuntimeError(f"Open-Meteo request failed: {last}")

    # ---------------------------------------------------------------- forecast for one place
    def forecast(self, lat: float, lon: float) -> dict:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise OutsideArea("Coordinates out of range.")
        tile, rel, dist_km, unc = self.tile_for(lat, lon)
        if (tile is None and unc is None) or not self.in_study_area(lat, lon):
            raise OutsideArea("This place is outside the forecast area (the 0.25° alert tiles inside Pakistan's northern mountains).")
        kind = "calibrated" if rel == "inside" else "indicative" if tile is not None else "none"
        key = (round(lat / GRID) * GRID, round(lon / GRID) * GRID)
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
            if hit and now - hit[0] < CACHE_S:
                return dict(hit[1], cached=True)
        cfg = self.cfg()
        params = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "hourly": ",".join(HOURLY), "models": "ecmwf_ifs025",
                  "wind_speed_unit": "ms", "precipitation_unit": "mm", "timezone": "GMT",
                  "past_days": cfg["past_days"], "forecast_days": cfg["forecast_days"]}
        key_ = self.apikey()
        if key_:
            params["apikey"] = key_
        js = self._fetch(params)
        elev = _num(js.get("elevation"))
        days = drivers(hourly_to_daily(js.get("hourly", {})), cfg)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        out = []
        for d in days:
            if d["date"] < today:
                continue
            out.append({"date": d["date"], "level": apply_rule(d, tile, cfg, elev) if tile is not None else None,
                        "snowfall_mm": d["snowfall_mmwe"], "sf_3d_mm": d["sf_3d_mm"], "sf_7d_mm": d["sf_7d_mm"],
                        "precip_mm": d["precip_mm"], "rain_mm": d["rain_mm"], "tmax_c": d["t2m_max_c"], "tmin_c": d["t2m_min_c"],
                        "gust_ms": d["gust10_max_ms"], "gust_max_3d_ms": d["gust_max_3d_ms"], "tmax_rise_3d_c": d["tmax_rise_3d_c"],
                        "ros_3d_mm": d["ros_3d_mm"], "snow_depth_m": d["snow_depth_m"], "freezing_level_m": d["deg0l_m"]})
        res = {"available": True, "lat": round(lat, 5), "lon": round(lon, 5), "elevation_m": elev,
               "region": self.region(lat, lon), "level_kind": kind,
               "tile": ({"id": tile["id"], "relation": rel, "distance_km": round(dist_km, 1) if dist_km is not None else None,
                         "elev_m": tile["elev_m"]} if tile is not None else None),
               "grid_tile": {"id": unc["id"], "elev_m": unc["elev_m"], "why": unc["why"]} if unc is not None else None,
               "min_elev_m": cfg["min_elev_m"], "days": out, "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "source": "ECMWF IFS 0.25° (open data) via Open-Meteo, for these coordinates and this elevation",
               "method": ("Same daily totals, drivers and final alert rule as the tile forecast (forecast_core.py), using the calibrated "
                          f"thresholds of tile {tile['id']}" + ("" if kind == "calibrated" else
                          f" (borrowed: this place is not in a calibrated tile, so the level is indicative)") +
                          f"; not rated below {cfg['min_elev_m']} m.") if tile is not None else
                         (f"Weather only: tile {unc['id']} ({unc['why']}) was left out of the calibration and no calibrated tile is "
                          f"within {NEAR_DEG}°, so there is no alert level here."),
               "cached": False}
        with self._lock:
            if len(self._cache) > 2000:
                self._cache.clear()
            self._cache[key] = (now, res)
        return res
