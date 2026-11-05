"""
build_projection_tiles.py - display geometry for the Projection Till 2100 map
=============================================================================
The projection package has values for 119 tiles of the 305-tile ERA5 grid (data/climate/projections/projections_tiles.geojson).
The other tiles have no projection: glacier-capped or perennial-snow tiles left out of the calibration, and tiles below the
1,200 m rating limit. This script clips the whole grid to the official Pakistan outline so the map covers the mountains right up
to the border, and lists the tiles without values as their own class. No value is created here: geometry and labels only.
Re-run when the package or the grid changes (needs shapely; not in the project .venv):

    python scripts/build_projection_tiles.py

Writes static/projections/tiles_full.json: {"rated": {tile_id: clipped geometry}, "context": FeatureCollection of tiles without values}.
Whole tiles are not stored under "rated": the page keeps their own square from the package.
"""
import csv
import json
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
HALF = 0.125


def main():
    pk = json.loads((ROOT / "data" / "boundaries" / "pakistan_boundaries.geojson").read_text(encoding="utf-8"))
    area = unary_union([shape(f["geometry"]) for f in pk["features"] if f["properties"].get("layer") == "pakistan"]).buffer(0)
    pkg = json.loads((ROOT / "data" / "climate" / "projections" / "projections_tiles.geojson").read_text(encoding="utf-8"))
    with_values = {f["properties"]["tile_id"] for f in pkg["features"]}
    rnd = lambda geom: json.loads(json.dumps(mapping(geom)), parse_float=lambda s: round(float(s), 5))
    rated, context, counts = {}, [], {}
    with (ROOT / "forecast" / "data" / "tiles.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            lat, lon, tid = float(row["lat"]), float(row["lon"]), row["tile_id"]
            sq = box(lon - HALF, lat - HALF, lon + HALF, lat + HALF)
            cut = sq.intersection(area)
            if cut.is_empty or cut.area < 1e-6:
                continue
            geom = rnd(cut.simplify(0.0015, preserve_topology=True))
            if tid in with_values:
                if cut.area < sq.area * 0.999:
                    rated[tid] = geom
                continue
            why = ("glacier-capped" if row["glacier_capped"] == "True" else "perennial snow" if row["perennial_snow"] == "True"
                   else "missing ERA5 years" if row["in_all_files"] != "True" else "below the 1,200 m rating limit")
            counts[why] = counts.get(why, 0) + 1
            context.append({"type": "Feature", "properties": {"tile_id": tid, "lat": lat, "lon": lon, "elev_m": float(row["elev_approx_m"]), "why": why}, "geometry": geom})
    out = ROOT / "static" / "projections" / "tiles_full.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"rated": rated, "context": {"type": "FeatureCollection", "features": context}}, separators=(",", ":")), encoding="utf-8")
    print(f"{len(with_values)} tiles with values ({len(rated)} clipped), {len(context)} without: {counts} -> {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
