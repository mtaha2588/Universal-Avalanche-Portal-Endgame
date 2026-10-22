"""Download real road centerlines or settlements from OpenStreetMap (Overpass API).

    python scripts/fetch_osm.py roads        -> data/roads.geojson
    python scripts/fetch_osm.py settlements  -> data/settlements_osm.geojson

Data © OpenStreetMap contributors, ODbL 1.0. Check redistribution terms before publishing.
After downloading settlements, point the 'settlements' entry in data/catalog.json at the new
file if you want to replace the reference set.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

OVERPASS = "https://overpass-api.de/api/interpreter"
BBOX = (33.8, 70.8, 37.1, 77.8)  # south, west, north, east — matches the combined study area
DATA = Path(__file__).resolve().parent.parent / "data"

QUERIES = {
    "roads": f"""[out:json][timeout:180];
way["highway"~"^(motorway|trunk|primary|secondary)$"]{BBOX};
out tags geom;""",
    "settlements": f"""[out:json][timeout:180];
node["place"~"^(city|town|village)$"]{BBOX};
out tags;""",
}


def fetch(kind: str) -> dict:
    body = urllib.parse.urlencode({"data": QUERIES[kind]}).encode()
    req = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": "pak-avalanche-portal/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def to_features(kind: str, osm: dict) -> list[dict]:
    feats = []
    for el in osm.get("elements", []):
        t = el.get("tags", {})
        if kind == "roads" and el["type"] == "way" and el.get("geometry"):
            feats.append({"type": "Feature",
                          "properties": {"osm_id": f"way/{el['id']}", "name": t.get("name:en") or t.get("name"),
                                         "ref": t.get("ref"), "highway": t.get("highway"),
                                         "source": "OpenStreetMap"},
                          "geometry": {"type": "LineString",
                                       "coordinates": [[p["lon"], p["lat"]] for p in el["geometry"]]}})
        elif kind == "settlements" and el["type"] == "node":
            if not (t.get("name:en") or t.get("name")):
                continue
            pop = t.get("population")
            feats.append({"type": "Feature",
                          "properties": {"osm_id": f"node/{el['id']}", "name": t.get("name:en") or t.get("name"),
                                         "place": t.get("place"), "admin_area": t.get("is_in:state"),
                                         "population": int(pop) if pop and pop.isdigit() else None,
                                         "population_source": "OSM tag (unverified)" if pop else None,
                                         "coord_quality": "OSM node", "source": "OpenStreetMap"},
                          "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]}})
    return feats


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in QUERIES:
        sys.exit(__doc__)
    kind = sys.argv[1]
    print(f"Querying Overpass for {kind} … (can take a few minutes)")
    feats = to_features(kind, fetch(kind))
    out = DATA / ("roads.geojson" if kind == "roads" else "settlements_osm.geojson")
    if out.exists():
        out.rename(out.with_suffix(f".bak-{date.today():%Y%m%d}.geojson"))
    fc = {"type": "FeatureCollection",
          "metadata": {"source": "OpenStreetMap contributors (ODbL)", "downloaded": date.today().isoformat(),
                       "bbox_swne": BBOX, "crs": "EPSG:4326"},
          "features": feats}
    out.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(feats)} features to {out}")


if __name__ == "__main__":
    main()
