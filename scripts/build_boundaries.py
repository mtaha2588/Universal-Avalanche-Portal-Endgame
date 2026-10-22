"""Build the portal's boundary layers from official/public sources.

Usage: python scripts/build_boundaries.py <source_folder>
The folder must contain (from github.com/nvkelso/natural-earth-vector/geojson): ne_10m_admin_0_countries_pak.geojson,
ne_10m_admin_0_boundary_lines_land.geojson, ne_10m_admin_0_disputed_areas.geojson, ne_10m_admin_1_states_provinces.geojson,
and rgi7_regions/ (unzipped https://cluster.klima.uni-bremen.de/~oggm/rgi/RGI2000-v7.0-regions.zip).

Outputs (EPSG:4326):
  data/boundaries/pakistan_boundaries.geojson  - layer: pakistan | province | disputed | line
  data/glaciers/rgi7_o2_regions_14.geojson     - the three RGI v7.0 / GTN-G glacier regions
"""
import json
import sys
import warnings
from pathlib import Path

import geopandas as gpd
from shapely.geometry import box, mapping
from shapely.ops import unary_union

warnings.filterwarnings("ignore")
SRC = Path(sys.argv[1])   # folder with the Natural Earth GeoJSONs and rgi7_regions/
OUT = Path(__file__).resolve().parent.parent / "data"
AREA = box(60.0, 20.0, 82.0, 39.0)   # northern South Asia window used for the map


def rnd(geom):
    def r(o):
        if isinstance(o, (list, tuple)) and o and isinstance(o[0], (int, float)):
            return [round(o[0], 4), round(o[1], 4)]
        return [r(x) for x in o]
    m = mapping(geom)
    return {"type": m["type"], "coordinates": r(m["coordinates"])}


feats = []

# 1) Pakistan - official view (Natural Earth "Pakistan point of view").
pov = gpd.read_file(SRC / "ne_10m_admin_0_countries_pak.geojson")
pak = unary_union(pov[pov["ADMIN"] == "Pakistan"].geometry).simplify(0.002, preserve_topology=True)
feats.append({"type": "Feature", "geometry": rnd(pak), "properties": {
    "layer": "pakistan", "name": "Pakistan",
    "note": "International boundary as officially shown by Pakistan (Natural Earth 1:10m, Pakistan point of view). "
            "Includes Jammu & Kashmir, whose final status is disputed."}})

# 2) Provinces and territories, renamed to current official names; former FATA merged into KP (2018).
NAMES = {"Northern Areas": ("Gilgit-Baltistan", "Administrative territory"),
         "Azad Kashmir": ("Azad Jammu & Kashmir", "Self-governing territory"),
         "K.P.": ("Khyber Pakhtunkhwa", "Province"), "F.A.T.A.": ("Khyber Pakhtunkhwa", "Province"),
         "Punjab": ("Punjab", "Province"), "Sind": ("Sindh", "Province"),
         "Baluchistan": ("Balochistan", "Province"), "F.C.T.": ("Islamabad Capital Territory", "Federal territory")}
adm = gpd.read_file(SRC / "ne_10m_admin_1_states_provinces.geojson")
adm = adm[adm["adm0_a3"] == "PAK"].copy()
adm["official"] = adm["name"].map(lambda n: NAMES[n][0])
adm["kind"] = adm["name"].map(lambda n: NAMES[n][1])
for (name, kind), grp in adm.groupby(["official", "kind"]):
    geom = unary_union(grp.geometry).simplify(0.003, preserve_topology=True)
    lab = geom.representative_point()
    note = "Includes the former FATA, merged into Khyber Pakhtunkhwa in 2018." if name == "Khyber Pakhtunkhwa" else ""
    feats.append({"type": "Feature", "geometry": rnd(geom), "properties": {
        "layer": "province", "name": name, "kind": kind, "note": note,
        "label_lon": round(lab.x, 4), "label_lat": round(lab.y, 4)}})

# 3) Disputed areas in the window, with Natural Earth's administration/claim notes.
dis = gpd.read_file(SRC / "ne_10m_admin_0_disputed_areas.geojson")
dis = dis[dis.intersects(AREA)]
for _, d in dis.iterrows():
    note = d.get("NOTE_BRK") or ""
    nm = d.get("BRK_NAME") or d.get("NAME_LONG") or d.get("NAME")
    if "Pakistan" not in note and nm != "Siachen Glacier":
        continue  # disputes not involving Pakistan are outside the portal's scope
    nm = {"Shaksam Valley": "Shaksgam Valley", "Azad Kashmir": "Azad Jammu & Kashmir"}.get(nm, nm)
    lab = d.geometry.representative_point()
    feats.append({"type": "Feature", "geometry": rnd(d.geometry.simplify(0.002, preserve_topology=True)), "properties": {
        "layer": "disputed", "name": nm, "note": note, "label_lon": round(lab.x, 4), "label_lat": round(lab.y, 4)}})

# 4) Line of Control and other non-settled lines in the window.
lines = gpd.read_file(SRC / "ne_10m_admin_0_boundary_lines_land.geojson")
lines = lines[lines.intersects(AREA) & ~lines["FEATURECLA"].str.startswith("International")]
KIND = {"Line of control (please verify)": "Line of Control", "Indeterminant frontier": "Indeterminate frontier",
        "Indefinite (please verify)": "Undefined boundary", "Disputed (please verify)": "Disputed boundary"}
for _, ln in lines.iterrows():
    if not {"Pakistan", "Siachen Glacier"} & {ln["ADM0_LEFT"], ln["ADM0_RIGHT"]}:
        continue  # China-India lines are outside the portal's scope
    feats.append({"type": "Feature", "geometry": rnd(ln.geometry), "properties": {
        "layer": "line", "name": KIND.get(ln["FEATURECLA"], ln["FEATURECLA"]),
        "between": f'{ln["ADM0_LEFT"]} / {ln["ADM0_RIGHT"]}'}})

fc = {"type": "FeatureCollection", "metadata": {
    "sources": ["Natural Earth 1:10m Admin-0 countries, Pakistan point of view (public domain)",
                "Natural Earth 1:10m Admin-1 states/provinces; disputed areas; boundary lines (public domain)"],
    "crs": "EPSG:4326"}, "features": feats}
(OUT / "boundaries").mkdir(parents=True, exist_ok=True)
(OUT / "boundaries/pakistan_boundaries.geojson").write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
print("boundaries:", {k: sum(1 for f in feats if f["properties"]["layer"] == k) for k in ("pakistan", "province", "disputed", "line")})
for f in feats:
    if f["properties"]["layer"] in ("disputed", "line"):
        print("  ", f["properties"]["layer"], "|", f["properties"]["name"], "|", f["properties"].get("note") or f["properties"].get("between"))

# 5) RGI v7.0 / GTN-G glacier regions 14-01..03.
reg = gpd.read_file(SRC / "rgi7_regions/RGI2000-v7.0-o2regions.shp")
reg = reg[reg["o2region"].isin(["14-01", "14-02", "14-03"])]
gfeats = []
for _, g in reg.iterrows():
    gfeats.append({"type": "Feature", "geometry": rnd(g.geometry), "properties": {
        "o2region": g["o2region"], "name": g["full_name"]}})
gfc = {"type": "FeatureCollection", "metadata": {
    "source": "GTN-G (2023) Glacier Regions, used by RGI v7.0. doi:10.5904/gtng-glacreg-2023-07", "crs": "EPSG:4326"},
    "features": gfeats}
(OUT / "glaciers/rgi7_o2_regions_14.geojson").write_text(json.dumps(gfc, separators=(",", ":")), encoding="utf-8")
print("glacier regions:", [(f["properties"]["o2region"], f["properties"]["name"]) for f in gfeats])
for p in [OUT / "boundaries/pakistan_boundaries.geojson", OUT / "glaciers/rgi7_o2_regions_14.geojson"]:
    print(p.name, round(p.stat().st_size / 1e3), "KB")
