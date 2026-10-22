"""Build the portal glacier layer from RGI v7.0, Region 14 (South Asia West).

Usage: python scripts/build_glaciers.py <RGI2000-v7.0-G-14_south_asia_west.shp> data/glaciers/rgi7_region14_systems.geojson
Input: unzip rgi2000-v7.0-g-14_south_asia_west.zip (RGI v7.0, NSIDC doi:10.5067/F6JMOVY5NAVZ).


No political clipping: RGI sub-regions are the internationally used glacier classification.
Output keeps official RGI attributes and rounds coordinates to ~10 m to keep the file small.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])

g = gpd.read_file(SRC)
print("loaded", len(g), "glaciers")

# Verify the sub-region codes against where the glaciers actually are (median centroid).
for code in sorted(g["o2region"].unique()):
    s = g[g["o2region"] == code]
    print(code, "n=%d" % len(s), "median lon=%.2f lat=%.2f" % (s.cenlon.median(), s.cenlat.median()),
          "area=%.0f km2" % s.area_km2.sum())

NAMES = {"14-01": "Hindu Kush", "14-02": "Karakoram", "14-03": "West Himalaya"}
g = g[g["o2region"].isin(NAMES)].copy()
g["system"] = g["o2region"].map(NAMES)

# Light simplification (~30 m, close to RGI source detail) keeps shapes faithful at country scale and keeps the file small.
g["geometry"] = g.geometry.simplify(0.0003, preserve_topology=True)
g = g[~g.geometry.is_empty & g.geometry.notna()]

def round_coords(geom):
    def r(seq):
        return [[round(c[0], 4), round(c[1], 4)] for c in seq]
    if geom.geom_type == "Polygon":
        return {"type": "Polygon", "coordinates": [r(ring.coords) for ring in [geom.exterior, *geom.interiors]]}
    polys = [{"type": "Polygon", "coordinates": [r(ring.coords) for ring in [p.exterior, *p.interiors]]} for p in geom.geoms]
    return {"type": "MultiPolygon", "coordinates": [p["coordinates"] for p in polys]}

features = []
for _, row in g.iterrows():
    features.append({
        "type": "Feature",
        "properties": {
            "rgi_id": row["rgi_id"],
            "system": row["system"],
            "area_km2": round(float(row["area_km2"]), 4),
            "zmin_m": None if row["zmin_m"] is None else round(float(row["zmin_m"])),
            "zmed_m": None if row["zmed_m"] is None else round(float(row["zmed_m"])),
            "zmax_m": None if row["zmax_m"] is None else round(float(row["zmax_m"])),
        },
        "geometry": round_coords(row.geometry),
    })

fc = {
    "type": "FeatureCollection",
    "metadata": {
        "source": "RGI 7.0 Consortium (2023). Randolph Glacier Inventory v7.0, Region 14 South Asia West. NSIDC, doi:10.5067/F6JMOVY5NAVZ",
        "crs": "EPSG:4326",
        "subregions": {"14-01": "Hindu Kush", "14-02": "Karakoram", "14-03": "West Himalaya"},
        "note": "Official RGI glacier outlines, unclipped. Sub-regions follow RGI classification; not political boundaries.",
        "feature_count": len(features),
    },
    "features": features,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
print("wrote", len(features), "features,", round(OUT.stat().st_size / 1e6, 2), "MB ->", OUT)
