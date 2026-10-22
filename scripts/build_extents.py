"""Glacier-system extents and major named glaciers, from the exact RGI v7.0 outlines.

Usage: python scripts/build_extents.py <RGI2000-v7.0-G-14_south_asia_west.shp> <RGI2000-v7.0-o2regions.shp>

Extent method (reproducible): buffer each glacier outline by MERGE_DEG, union per system, shrink by SHRINK_DEG,
clip to the system's official GTN-G/RGI region polygon (so systems never overlap), drop slivers, simplify.
"""
import json
import sys
import re
import warnings
from pathlib import Path

import geopandas as gpd
from shapely.geometry import mapping
from shapely.ops import unary_union

warnings.filterwarnings("ignore")
OUT = Path(__file__).resolve().parent.parent / "data" / "glaciers"
NAMES = {"14-01": "Hindu Kush", "14-02": "Karakoram", "14-03": "West Himalaya"}
MERGE_DEG, SHRINK_DEG = 0.05, 0.035      # about 5 km merge, 3.5 km shrink-back
MIN_PART_DEG2 = 0.003                     # drop isolated slivers smaller than about 30 km2
TOP = {"Hindu Kush": 5, "Karakoram": 10, "West Himalaya": 7}
MAJOR = {"Hindu Kush": 2, "Karakoram": 4, "West Himalaya": 3}   # these are labelled from a wider zoom

g = gpd.read_file(sys.argv[1])
g = g[g["o2region"].isin(NAMES)].copy()
g["system"] = g["o2region"].map(NAMES)
regions = gpd.read_file(sys.argv[2])
regions = {r["o2region"]: r.geometry for _, r in regions.iterrows() if r["o2region"] in NAMES}


def rnd(geom):
    def r(o):
        if isinstance(o, (list, tuple)) and o and isinstance(o[0], (int, float)):
            return [round(o[0], 4), round(o[1], 4)]
        return [r(x) for x in o]
    m = mapping(geom)
    return {"type": m["type"], "coordinates": r(m["coordinates"])}


# ---------- system extents ----------
ext = []
for code, name in NAMES.items():
    sub = g[g["o2region"] == code]
    merged = unary_union(sub.geometry.buffer(MERGE_DEG)).buffer(-SHRINK_DEG)
    merged = merged.intersection(regions[code])
    parts = [p for p in getattr(merged, "geoms", [merged]) if p.geom_type == "Polygon" and p.area >= MIN_PART_DEG2]
    geom = unary_union(parts).simplify(0.003, preserve_topology=True)
    ext.append({"type": "Feature", "geometry": rnd(geom), "properties": {
        "name": name, "o2region": code, "glaciers": int(len(sub)), "glacier_area_km2": round(float(sub.area_km2.sum()), 1),
        "method": f"Envelope of the RGI v7.0 glacier outlines (merged within ~{int(MERGE_DEG*100)} km), clipped to the official GTN-G/RGI region {code}"}})
    print(f"{name}: {len(parts)} part(s), glaciers {len(sub)}")

# Check: extents must not overlap each other.
from shapely.geometry import shape
shp = [shape(f["geometry"]) for f in ext]
print("overlap HK/KK %.5f, KK/WH %.5f, HK/WH %.5f deg2" % (
    shp[0].intersection(shp[1]).area, shp[1].intersection(shp[2]).area, shp[0].intersection(shp[2]).area))

(OUT / "rgi7_system_extents.geojson").write_text(json.dumps({"type": "FeatureCollection", "metadata": {
    "source": "Derived from RGI 7.0 Consortium (2023) glacier outlines, doi:10.5067/F6JMOVY5NAVZ; clipped to GTN-G (2023) regions, doi:10.5904/gtng-glacreg-2023-07",
    "method": "buffer-union-shrink of glacier outlines per RGI sub-region, clipped to the official region polygon", "crs": "EPSG:4326"},
    "features": ext}, separators=(",", ":")), encoding="utf-8")

# ---------- major named glaciers ----------
CODE = re.compile(r"^[A-Z]{2}\d[A-Z]\w*\s*")   # leading WGI inventory code, e.g. "IN5Q151B0013 "
def clean(n):
    if n is None or (isinstance(n, float) and n != n):   # missing name (None / NaN)
        return ""
    n = CODE.sub("", str(n)).strip()
    return n if re.search(r"[a-z]", n) else ""   # skip names that are only codes

g["clean"] = g["glac_name"].map(clean)
major = []
for name in NAMES.values():
    top = g[(g.system == name) & (g.clean != "")].sort_values("area_km2", ascending=False).head(TOP[name])
    for rank, (_, r) in enumerate(top.iterrows(), 1):
        pt = r.geometry.representative_point()
        b = r.geometry.bounds
        major.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(pt.x, 4), round(pt.y, 4)]},
                      "properties": {"name": r.clean, "system": name, "rank": rank, "major": rank <= MAJOR[name],
                                     "rgi_id": r.rgi_id, "area_km2": round(float(r.area_km2), 1),
                                     "length_km": round(float(r.lmax_m) / 1000, 1) if r.lmax_m else None,
                                     "zmin_m": round(float(r.zmin_m)) if r.zmin_m else None,
                                     "zmax_m": round(float(r.zmax_m)) if r.zmax_m else None,
                                     "bbox": [round(v, 4) for v in b]}})
        print(f"  {name:<14} #{rank:<2} {r.clean:<26} {r.area_km2:7.1f} km2")

(OUT / "rgi7_major_glaciers.geojson").write_text(json.dumps({"type": "FeatureCollection", "metadata": {
    "source": "RGI 7.0 Consortium (2023), glacier names and attributes (glac_name, area_km2, lmax_m, zmin_m, zmax_m)",
    "selection": "Largest named glaciers per RGI sub-region; inventory codes stripped from names", "crs": "EPSG:4326"},
    "features": major}, separators=(",", ":")), encoding="utf-8")
for f in ("rgi7_system_extents.geojson", "rgi7_major_glaciers.geojson"):
    print(f, round((OUT / f).stat().st_size / 1e3), "KB")
