"""Regional hotspot register for the Reports & exports window.

Built only from data already in the portal: the Hindu Kush DEM screening (hk_hotspots), the 2026-27 snow outlook
(snow_stations, hk_tiles_windows) and the approximate town centres (settlements). Nothing is estimated.

* Hindu Kush: DEM very-high areas (>= min_ha) whose nearest snow station forecasts >= WEATHER_HIGH heavy-snow
  days in a modelled 15-day window ("main hotspots"). Timeline = those windows.
* Karakoram and Himalaya: no DEM terrain screening has been supplied. Rows are the snow-outlook stations, ranked by
  expected HIGH-danger days, flagged when they reach the same threshold. They are station locations, not terrain.

The nearest populated area is the closest entry in settlements.geojson (20 approximate town centres, no population
figures), with distance and compass bearing. It can be far away; the distance is always shown.
"""
from __future__ import annotations

import json
import math

from portal.services.spatial import haversine_km

WEATHER_HIGH = 0.5          # HIGH-danger days per window, same screening cut-off as the threat register
REGIONS = [
    ("hindu_kush", "Hindu Kush", "Hindu Kush"),
    ("karakoram", "Karakoram", "Karakoram"),
    ("himalaya", "Western Himalaya", "Himalaya"),
]
COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def _bearing(lon1, lat1, lon2, lat2) -> str:
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    b = math.degrees(math.atan2(math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)))
    return COMPASS[round(((b + 360) % 360) / 45) % 8]


def _nearest(lon, lat, towns):
    if not towns:
        return None, None, None
    d, t = min((haversine_km(lon, lat, *t["geometry"]["coordinates"][:2]), t) for t in towns)
    tl, tb = t["geometry"]["coordinates"][:2]
    return t["properties"]["name"], round(d, 1), _bearing(tl, tb, lon, lat)


def _span(w):
    return f'{w["id"][-3:]} ({w["label"]})'


def build(store, min_ha: float = 120.0) -> dict:
    stations = store.features("snow_stations")
    towns = store.features("settlements")
    if not stations:
        return {"available": False, "message": "No snow outlook imported (run scripts/build_snow_forecast.py)."}
    tiles = {f["properties"]["tile_id"]: f["properties"] for f in store.features("hk_tiles_windows")}
    meta = store.meta("snow_stations") or {}
    snow = json.loads((store.data_dir / "forecast" / "snow_2026_27.json").read_text(encoding="utf-8"))
    cov = {c["id"]: c for c in snow["window_coverage"]}
    wins = [w for w in snow["windows"] if cov[w["id"]]["days_in_data"] == cov[w["id"]]["days"]]   # modelled windows only
    idx = [w["index"] for w in wins]
    wby = {w["index"]: w for w in wins}
    key = lambda p, i: p.get(f"h{i:02d}") or 0.0

    out = []
    for rid, name, srange in REGIONS:
        st = [f for f in stations if f["properties"]["range"] == srange]
        rows = []
        if rid == "hindu_kush":
            hmax = max([key(f["properties"], i) for f in st for i in idx] + [0.01])
            sh = {f["properties"]["name"]: f["properties"] for f in st}
            for f in store.features("hk_hotspots"):
                p = f["properties"]
                if p["area_ha"] < min_ha:
                    continue
                t = tiles.get(p["tile_id"])
                if not t:
                    continue
                hit = [i for i in idx if (t.get(f"k{i:02d}") or 0) >= 2]
                if not hit:
                    continue
                sp = sh.get(t["station"], {})
                peak = max(hit, key=lambda i: key(sp, i))
                lon, lat = f["geometry"]["coordinates"]
                tn, td, tb = _nearest(lon, lat, towns)
                rows.append({"type": "Feature", "geometry": f["geometry"], "properties": {
                    "region": name, "basis": "DEM very-high area in a heavy-snow slot (main hotspot)",
                    "name": f'HK-{p["rank"]:05d}', "dem_rank": p["rank"], "tile_id": p["tile_id"],
                    "lat": round(lat, 5), "lon": round(lon, 5), "area_ha": p["area_ha"], "mean_elev_m": p["mean_elev_m"],
                    "mean_slope_deg": p["mean_slope_deg"], "facing": p["facing"], "terrain_score": p["max_score"],
                    "station": t["station"], "station_dist_km": round(t["dist_km"], 1),
                    "windows": "; ".join(wby[i]["id"] for i in hit), "timeline": "; ".join(_span(wby[i]) for i in hit),
                    "peak_window": wby[peak]["id"], "peak_high_days": round(key(sp, peak), 2),
                    "combined_risk": round(p["max_score"] * min(1.0, key(sp, peak) / hmax), 3),
                    "nearest_populated": tn, "nearest_distance_km": td, "nearest_direction_from_town": tb,
                    "meets_threshold": True}})
            rows.sort(key=lambda r: -r["properties"]["combined_risk"])
            note = (f"DEM very-high areas of at least {min_ha:g} ha whose nearest station forecasts at least {WEATHER_HIGH} "
                    "HIGH-danger days in a modelled 15-day window. Terrain screening plus a seasonal snow outlook: not a forecast for a slope, not a probability.")
        else:
            for f in st:
                p = f["properties"]
                hit = [i for i in idx if key(p, i) >= WEATHER_HIGH]
                peak = max(idx, key=lambda i: key(p, i))
                if key(p, peak) <= 0:
                    continue
                shown = hit or [peak]
                lon, lat = f["geometry"]["coordinates"]
                tn, td, tb = _nearest(lon, lat, towns)
                rows.append({"type": "Feature", "geometry": f["geometry"], "properties": {
                    "region": name, "basis": "Snow-outlook station (no DEM terrain screening supplied for this region)",
                    "name": p["name"], "station_type": p["type"], "lat": round(lat, 5), "lon": round(lon, 5),
                    "season_forecast_cm": round(p["forecast_cm"]), "pct_of_normal": round(p["pct_of_normal"]),
                    "windows": "; ".join(wby[i]["id"] for i in shown), "timeline": "; ".join(_span(wby[i]) for i in shown),
                    "peak_window": wby[peak]["id"], "peak_high_days": round(key(p, peak), 2),
                    "nearest_populated": tn, "nearest_distance_km": td, "nearest_direction_from_town": tb,
                    "meets_threshold": bool(hit)}})
            rows.sort(key=lambda r: -r["properties"]["peak_high_days"])
            n_hit = sum(r["properties"]["meets_threshold"] for r in rows)
            note = (f"Station-level ranking by expected HIGH-danger days: {n_hit} of {len(rows)} stations reach {WEATHER_HIGH} days in a window"
                    + ("" if n_hit else "; none does, so the timeline shows each station's relative peak window only") +
                    ". No DEM terrain screening has been supplied for this region, so these are station locations, not avalanche terrain.")
        for k, r in enumerate(rows, 1):
            r["properties"]["rank"] = k
        out.append({"id": rid, "name": name, "count": len(rows), "note": note, "features": rows})
    return {"available": True, "season": snow["season"], "min_ha": min_ha, "weather_high_days": WEATHER_HIGH,
            "windows": [{"id": w["id"], "label": w["label"]} for w in wins],
            "not_modelled": "1 April onward is not modelled (data end 31 March).",
            "source": meta.get("source"), "regions": out,
            "populated_note": "Nearest populated area = closest of 20 approximate town centres; no population figures. The distance can be large.",
            "disclaimer": "Screening and seasonal outlook only. Not a warning, not a probability, not validated; field verification is required."}
