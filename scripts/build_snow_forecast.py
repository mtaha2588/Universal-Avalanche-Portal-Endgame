"""Import the Northern Pakistan 2026-27 snow outlook run into the portal.

Usage:
    python scripts/build_snow_forecast.py <run folder>      (needs pandas, numpy, shapely, pyproj)

The run folder is the output of Northern_Pakistan_Snow_Avalanche_2026_27.ipynb. It must hold
forecast_2026_27_all_locations.csv, era5land_daily_1990_2026.csv.gz, model_skill.csv and
danger_calendar_2026_27.csv. Writes:

  data/forecast/snow_2026_27.json        run metadata, method, skill, ranges, caveats
  data/forecast/snow_stations.geojson    36 stations: seasonal forecast + 15-day window values
  data/forecast/hk_zones.geojson         Hindu Kush nearest-station zones (Pakistan only, <= 60 km)
  data/forecast/hk_tiles_windows.geojson Hindu Kush screening tiles x windows (relative index)

What is and is not forecast
---------------------------
The notebook forecasts a SEASONAL TOTAL (Nov-Mar) per station. It does not forecast timing.
Window values here are the notebook's own danger-calendar logic split into the portal's 15-day
windows: every 1990-2025 winter's daily 3-day snowfall is scaled by (forecast / normal) and
counted against the thresholds. Snow per window = forecast total x the 1990-2025 share of the
Nov-Mar snow that fell in that window. The data end on 31 Mar: 1-15 Apr is NOT modelled and is
left empty. No value is interpolated between stations.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import MultiPoint, Point, box, mapping, shape
from shapely.ops import transform, unary_union, voronoi_diagram

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from portal.services.windows import generate_windows  # noqa: E402

OUT = ROOT / "data" / "forecast"
SEASON = 2026
HK_BOUNDS = (71.05, 34.72, 74.23, 37.3)
ZONE_KM = 60.0
MIN_DAYS = 140                 # same completeness filter as the notebook (W.n >= 140)
TERRAIN_HIGH = 0.30            # tile share of High + Very-high terrain at or above this = terrain threat (~ median of tiles with snow data)
WEATHER_HIGH = 0.5             # expected HIGH-danger days at the nearest station in a window at or above this = weather threat
THREAT_CODE = {0: "neither", 1: "terrain only", 2: "weather only", 3: "both"}
ONI_INPUT = 2.5                # notebook cell 1: ONI_FORECAST (NOAA CPC Sep-2026, as recorded there)


def rnd(o, n=4):
    if isinstance(o, float):
        return None if math.isnan(o) else round(o, n)
    if isinstance(o, (list, tuple)):
        return [rnd(x, n) for x in o]
    return o


def main(run: Path):
    fc = pd.read_csv(run / "forecast_2026_27_all_locations.csv")
    d = pd.read_csv(run / "era5land_daily_1990_2026.csv.gz", parse_dates=["date"])
    skill = pd.read_csv(run / "model_skill.csv", index_col=0)
    cal = pd.read_csv(run / "danger_calendar_2026_27.csv", index_col=0)
    by_range = pd.read_csv(run / "forecast_2026_27_by_range.csv", index_col=0)

    # thresholds are read back from the notebook's own `danger` column, not assumed
    t1 = float(round(d[d.danger == 1].snow_3d.min()))
    t2 = float(round(d[d.danger == 2].snow_3d.min()))
    inventory_events = int(d.aval.sum())
    print(f"thresholds in data: elevated >= {t1:.1f} cm/3d, high >= {t2:.1f} cm/3d; avalanche-labelled rows: {inventory_events}")

    wins = generate_windows(SEASON)
    wid = [w.id for w in wins]
    first_missing = date(SEASON + 1, 4, 1)                                  # data end 31 Mar
    # offset from 15 Dec of the winter's season start; windows are consecutive 15-day blocks
    start = pd.to_datetime(d.winter.astype(str) + "-12-15")
    d["off"] = (d.date - start).dt.days
    d["w"] = np.where((d.off >= 0) & (d.off < 121), d.off // 15, -1)
    tot = d.groupby(["name", "winter"]).agg(total=("snow_cm", "sum"), n=("date", "count")).reset_index()
    full = tot[tot.n >= MIN_DAYS]
    nfull = full.groupby("name").winter.nunique()
    dd = d.merge(full[["name", "winter"]], on=["name", "winter"])

    stations, rows = [], []
    for _, r in fc.iterrows():
        nm = r["Location"]
        g = dd[dd.name == nm]
        normal, fcast = float(r["Normal snow (cm)"]), float(r["Forecast snow (cm)"])
        f = fcast / normal
        lo, hi = [float(x) for x in str(r["80% range (cm)"]).replace("–", "-").split("-")]
        mean_total = full[full.name == nm].total.mean()
        assert abs(mean_total - normal) / normal < 0.01, (nm, mean_total, normal)
        nw = nfull[nm]
        wv = []
        for i, w in enumerate(wins):
            gw = g[g.w == i]
            days_in_data = int(gw.groupby("winter").date.nunique().max()) if len(gw) else 0
            if days_in_data == 0:
                wv.append(dict(id=w.id, snow_cm=None, elevated_days=None, high_days=None, days_in_data=0))
                continue
            share = gw.snow_cm.sum() / nw / mean_total
            s3 = gw.snow_3d * f
            wv.append(dict(id=w.id, snow_cm=fcast * share, share=share,
                           elevated_days=float((s3 >= t1).sum() / nw), high_days=float((s3 >= t2).sum() / nw),
                           normal_high_days=float((gw.snow_3d >= t2).sum() / nw), days_in_data=days_in_data))
        # consistency with the notebook's own monthly danger calendar (elevated days)
        for m, col in ((12, "12"), (1, "1"), (2, "2"), (3, "3")):
            gm = g[g.month == m]
            mine = float(((gm.snow_3d * f) >= t1).sum() / nw)
            assert abs(mine - cal.loc[nm, col]) < 0.05, (nm, m, mine, cal.loc[nm, col])
        p = dict(
            name=nm, range=r["Range"], type=r["Type"], lat=float(g.lat.iloc[0]), lon=float(g.lon.iloc[0]),
            normal_cm=normal, forecast_cm=fcast, range80_cm=[lo, hi], pct_of_normal=float(r["% of normal"]),
            p_above=float(r["P(above) %"]), p_below=float(r["P(below) %"]),
            elevated_days=float(r["Elevated-danger days"]), high_days=float(r["High-danger days"]),
            normal_high_days=float(r["Normal high-danger days"]), p_high_storm=float(r["P(≥1 HIGH-danger storm) %"]),
            peak_month=r["Peak danger month"], method=r["Method"], risk_label=str(r["Avalanche risk"]).split(" ", 1)[-1],
            season_share_before_15dec=float(1 - sum(x.get("share", 0) for x in wv)),
            windows=wv)
        stations.append(p)

    # ---------------------------------------------------------------- GeoJSON stations
    feats = []
    for p in stations:
        props = {k: v for k, v in p.items() if k not in ("lat", "lon")}
        for i, x in enumerate(p["windows"], 1):
            props[f"h{i:02d}"] = x["high_days"]
            props[f"e{i:02d}"] = x["elevated_days"]
            props[f"s{i:02d}"] = x["snow_cm"]
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                      "properties": rnd_props(props)})
    write(OUT / "snow_stations.geojson", {"type": "FeatureCollection", "features": feats})

    # ---------------------------------------------------------------- Hindu Kush zones + tiles
    pak = next(shape(f["geometry"]) for f in json.loads((ROOT / "data/boundaries/pakistan_boundaries.geojson").read_text(encoding="utf-8"))["features"]
               if f["properties"].get("layer") == "pakistan")
    hk = [p for p in stations if p["range"] == "Hindu Kush"]
    to_m = Transformer.from_crs("EPSG:4326", "+proj=aeqd +lat_0=36 +lon_0=72.6 +units=m", always_xy=True).transform
    to_ll = Transformer.from_crs("+proj=aeqd +lat_0=36 +lon_0=72.6 +units=m", "EPSG:4326", always_xy=True).transform
    cells = voronoi_diagram(MultiPoint([(p["lon"], p["lat"]) for p in hk]), envelope=box(*HK_BOUNDS))
    hmax = max((x["high_days"] or 0) for p in hk for x in p["windows"])
    zone_feats, zone_geoms = [], []
    for p in hk:
        pt = Point(p["lon"], p["lat"])
        cell = next(c for c in cells.geoms if c.contains(pt)).intersection(box(*HK_BOUNDS))
        circle = transform(to_ll, transform(to_m, pt).buffer(ZONE_KM * 1000, 48))
        z = cell.intersection(circle).intersection(pak)
        if z.is_empty:
            continue
        props = {"name": p["name"], "type": p["type"], "range": "Hindu Kush", "pct_of_normal": p["pct_of_normal"],
                 "forecast_cm": p["forecast_cm"], "normal_cm": p["normal_cm"], "p_high_storm": p["p_high_storm"],
                 "method": p["method"]}
        for i, x in enumerate(p["windows"], 1):
            props[f"h{i:02d}"] = x["high_days"]
            props[f"s{i:02d}"] = x["snow_cm"]
        zone_feats.append({"type": "Feature", "geometry": mapping(z), "properties": rnd_props(props)})
        zone_geoms.append((p, z))
    write(OUT / "hk_zones.geojson", {"type": "FeatureCollection", "features": zone_feats})

    tiles = json.loads((ROOT / "data/screening/hk_tiles.geojson").read_text(encoding="utf-8"))["features"]
    tfeats, skipped = [], 0
    for t in tiles:
        x, y = t["geometry"]["coordinates"]
        pt = Point(x, y)
        hit = next(((p, z) for p, z in zone_geoms if z.contains(pt)), None)
        if hit is None:
            skipped += 1
            continue
        p, _ = hit
        dist = transform(to_m, pt).distance(transform(to_m, Point(p["lon"], p["lat"]))) / 1000
        share = t["properties"]["share_high_or_very_high"]
        props = {"tile_id": t["properties"]["tile_id"], "station": p["name"], "dist_km": dist,
                 "share_high_or_very_high": share}
        best = (None, -1)
        for i, w in enumerate(p["windows"], 1):
            hd = w["high_days"]
            c = None if hd is None else 100 * share * hd / hmax
            props[f"c{i:02d}"] = c
            if c is not None and c > best[1]:
                best = (i, c)
        props["peak_window"], props["peak_index"] = wid[best[0] - 1], best[1]
        th = share >= TERRAIN_HIGH
        codes = {}
        for i, w in enumerate(p["windows"], 1):
            hd = w["high_days"]
            if hd is None:
                props[f"k{i:02d}"] = None
                continue
            wk = hd >= WEATHER_HIGH
            codes[i] = 3 if th and wk else 1 if th else 2 if wk else 0
            props[f"k{i:02d}"] = codes[i]
        if 3 in codes.values():
            season = "both"
        elif th:
            season = "terrain only"
        elif 2 in codes.values():
            season = "weather only"
        else:
            season = "neither"
        props["threat_season"] = season
        props["both_windows"] = [wid[i - 1] for i, c in codes.items() if c == 3]
        tfeats.append({"type": "Feature", "geometry": t["geometry"], "properties": rnd_props(props)})
    write(OUT / "hk_tiles_windows.geojson", {"type": "FeatureCollection", "features": tfeats})
    counts = {k: sum(1 for f in tfeats if f["properties"]["threat_season"] == k) for k in ("both", "terrain only", "weather only", "neither")}
    print("season threat counts:", counts)
    print(f"tiles with a station inside Pakistan within {ZONE_KM:.0f} km: {len(tfeats)}; left blank: {skipped}")

    meta = {
        "season": f"{SEASON}-{(SEASON + 1) % 100:02d}", "run_folder": run.name,
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "kind": "Seasonal statistical outlook (ERA5-Land replay + ENSO analog). Not a weather forecast.",
        "enso_input": {"oni": ONI_INPUT, "note": "Set in the notebook (ONI_FORECAST = 2.5, NOAA CPC Sep-2026 as recorded there). Not verified by the portal."},
        "thresholds_cm_3d": {"elevated": t1, "high": t2,
                             "note": "Fallback defaults. No avalanche inventory was matched in this run, so they are not learned from observed avalanches."},
        "inventory_events_matched": inventory_events,
        "windows": [w.to_dict() for w in wins],
        "window_coverage": [{"id": i, "days": w.days, "days_in_data": max(0, min(w.days, (first_missing - w.start).days))}
                            for i, w in zip(wid, wins)],
        "coverage_note": "The model covers Nov-Mar. Windows W01-W07 (15 Dec-29 Mar) are complete, W08 has 2 of 15 days (30-31 Mar) and W09 (14 Apr) and 1-13 Apr have none. They are left empty, not estimated.",
        "method_note": "Seasonal total forecast per station. Timing inside the season is the 1990-2025 average, not forecast. Window danger days = replay of 36 winters scaled by forecast/normal.",
        "method_by_range": {r: fc[fc.Range == r].Method.iloc[0] for r in by_range.index},
        "skill_pct_vs_normal": json.loads(skill.round(2).to_json(orient="index")),
        "skill_note": "Leave-one-winter-out skill vs assuming a normal winter. A range uses a non-normal method only if its mean skill beats normal by more than 1 %. Hindu Kush and Karakoram did not, so their forecast equals the 1990-2025 normal.",
        "ranges": {r: {"pct_of_normal": float(by_range.loc[r, "Forecast % of normal"]),
                       "high_days": float(by_range.loc[r, "High-danger days (avg)"]),
                       "normal_high_days": float(by_range.loc[r, "Normal high-danger days"]),
                       "stations": int((fc.Range == r).sum())} for r in by_range.index},
        "hk_zone_km": ZONE_KM, "hk_tiles_with_zone": len(tfeats), "hk_tiles_blank": skipped, "hk_high_days_max": hmax,
        "threat_rules": {"terrain_high_share": TERRAIN_HIGH, "weather_high_days_per_window": WEATHER_HIGH,
                         "codes": THREAT_CODE, "season_counts": counts,
                         "note": "Screening cut-offs chosen for this portal, not validated. Terrain threat is static; weather threat is per 15-day window at the nearest Hindu Kush station. Tiles outside a station zone are not weather-assessed."},
        "validation": "Not validated against observed avalanches. Danger days are snowfall-threshold counts, not probabilities.",
        "source": "ERA5-Land daily (ECMWF/ERA5_LAND/DAILY_AGGR via Earth Engine, ~9 km), NOAA CPC ONI, run " + run.name,
    }
    write(OUT / "snow_2026_27.json", meta)
    print("done")


def rnd_props(p):
    return {k: (rnd(v) if not isinstance(v, (str, list, dict)) or isinstance(v, float) else (rnd(v) if isinstance(v, list) and k != "windows" else v))
            for k, v in p.items() if k != "windows"}


def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote", path.relative_to(ROOT), f"{path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
