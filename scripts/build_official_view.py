"""Front-page map, Pakistan's official view of Jammu & Kashmir (as in the Government of Pakistan's political map, 2020).

Input : data/boundaries/study_area.geojson (mask = everything outside the Pakistan-administered study area)
        data/boundaries/pakistan_boundaries.geojson (Natural Earth disputed areas: "Jammu and Kashmir", "Siachen Glacier")
Output: static/geo/official_view.geojson
        - layer "mask":   the study-area mask with Indian Illegally Occupied Jammu & Kashmir and Siachen cut out, so the whole of
                          Jammu & Kashmir shows like the rest of Pakistan on the home map
        - layer "iiojk":  the Indian Illegally Occupied Jammu & Kashmir polygon (label point included)
The study area itself (analysis, statistics, tiles) is unchanged: it stays the Pakistan-administered area.

Usage (Python with shapely):  python scripts/build_official_view.py
"""
import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
STUDY = ROOT / "data" / "boundaries" / "study_area.geojson"
BND = ROOT / "data" / "boundaries" / "pakistan_boundaries.geojson"
OUT = ROOT / "static" / "geo" / "official_view.geojson"


def main():
    study = json.loads(STUDY.read_text(encoding="utf-8"))
    bnd = json.loads(BND.read_text(encoding="utf-8"))
    mask = next(shape(f["geometry"]) for f in study["features"] if f["properties"].get("layer") == "mask")
    dis = {f["properties"]["name"]: shape(f["geometry"]) for f in bnd["features"] if f["properties"].get("layer") == "disputed"}
    jk = dis["Jammu and Kashmir"].buffer(0)
    claim = unary_union([jk, dis["Siachen Glacier"].buffer(0)]).buffer(0.002).buffer(-0.002)
    new_mask = mask.buffer(0).difference(claim)
    lp = jk.representative_point()
    feats = [
        dict(type="Feature", properties=dict(layer="mask"), geometry=mapping(new_mask)),
        dict(type="Feature", properties=dict(layer="iiojk", name="Indian Illegally Occupied Jammu & Kashmir",
                                             label_lon=round(lp.x, 4), label_lat=round(lp.y, 4),
                                             note="Disputed territory: final status to be decided in line with the relevant UN Security Council resolutions."),
             geometry=mapping(jk)),
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(dict(type="FeatureCollection", features=feats), separators=(",", ":")), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: mask {mask.area:.2f} -> {new_mask.area:.2f} deg2, IIOJK {jk.area:.2f} deg2, label {lp.y:.3f} N {lp.x:.3f} E")


if __name__ == "__main__":
    main()
