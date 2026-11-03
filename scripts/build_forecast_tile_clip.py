"""
build_forecast_tile_clip.py - forecast tiles clipped to the study area, for the Alert Forecast dashboard map
==========================================================================================================
Each 0.25 deg forecast tile (forecast/data/tile_thresholds.csv) is intersected with the Pakistan-administered study area
(data/boundaries/study_area.geojson, layer "study_area"), so the dashboard draws the tiles only where the area of interest
is, instead of whole squares running over the international boundary. The forecast values are unchanged: this is display
geometry only. Re-run when the tile grid changes (needs shapely; not in the project .venv):

    python scripts/build_forecast_tile_clip.py

Writes static/alertdash/tiles_clip.json: {"tiles": {tile_id: GeoJSON geometry}, "outside": [tile_ids with nothing inside],
"regions": {region name: outline (GeoJSON lines)}}. Regions come from forecast_core.region() (forecast/config/regions.json):
re-run this script after editing that file.
"""
import csv
import json
import re
import sys
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "forecast"))
import forecast_core as fc  # noqa: E402
TILES = ROOT / "forecast" / "data" / "tile_thresholds.csv"
STUDY = ROOT / "data" / "boundaries" / "study_area.geojson"
OUT = ROOT / "static" / "alertdash" / "tiles_clip.json"
HALF = 0.125


def main():
    g = json.loads(STUDY.read_text(encoding="utf-8"))
    area = unary_union([shape(f["geometry"]) for f in g["features"] if f["properties"].get("layer") == "study_area"]).buffer(0)
    rnd = lambda geom: json.loads(json.dumps(mapping(geom)), parse_float=lambda s: round(float(s), 5))
    out, outside, partial, by_region = {}, [], 0, {}
    with TILES.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            m = re.match(r"N([\d.]+)_E([\d.]+)", row["tile_id"])
            lat, lon = float(m.group(1)), float(m.group(2))
            sq = box(lon - HALF, lat - HALF, lon + HALF, lat + HALF)
            cut = sq.intersection(area)
            if cut.is_empty or cut.area < 1e-6:
                outside.append(row["tile_id"])
                continue
            by_region.setdefault(fc.region(lat, lon), []).append(cut)
            if cut.area < sq.area * 0.999:
                partial += 1
                out[row["tile_id"]] = rnd(cut.simplify(0.0015, preserve_topology=True))
            # whole tiles are not stored: the dashboard keeps their own square
    # Tiles of the ERA5 grid that the analysis team left out of the calibration (forecast/data/tiles.csv, use_for_thresholds
    # False: perennial snow / glacier-capped / missing years; pipeline/step1_prepare_era5.py). They have no thresholds, so no
    # alert level: drawn as their own class so the map covers the whole range, and clickable for the place's own weather.
    calibrated = set()
    with TILES.open(encoding="utf-8") as f:
        calibrated = {row["tile_id"] for row in csv.DictReader(f)}
    uncal = []
    with (ROOT / "forecast" / "data" / "tiles.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["tile_id"] in calibrated:
                continue
            lat, lon = float(row["lat"]), float(row["lon"])
            cut = box(lon - HALF, lat - HALF, lon + HALF, lat + HALF).intersection(area)
            if cut.is_empty or cut.area < 0.0625 * 0.02:
                continue
            by_region.setdefault(fc.region(lat, lon), []).append(cut)
            why = ("glacier-capped" if row["glacier_capped"] == "True" else "perennial snow" if row["perennial_snow"] == "True"
                   else "missing ERA5 years")
            uncal.append({"type": "Feature", "properties": {"tile_id": row["tile_id"], "elev_m": float(row["elev_approx_m"]), "why": why,
                                                            "region": fc.region(lat, lon)},
                          "geometry": rnd(cut.simplify(0.0015, preserve_topology=True))})
    regions = {name: rnd(unary_union(parts).buffer(0).simplify(0.002, preserve_topology=True).boundary) for name, parts in by_region.items()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": "forecast tiles x data/boundaries/study_area.geojson (layer study_area)",
                               "tiles": out, "outside": outside, "regions": regions,
                               "uncalibrated": {"type": "FeatureCollection", "features": uncal}}, separators=(",", ":")), encoding="utf-8")
    print(f"{len(uncal)} uncalibrated (glacier / perennial-snow) tiles inside the study area")
    print(f"{partial} tiles clipped at the boundary, {len(outside)} entirely outside -> {OUT.relative_to(ROOT)} "
          f"({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
