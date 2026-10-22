"""Build data/karakoram/kk_hotspots.geojson from the 10 hotspots supplied for the Karakoram demo.

Usage: python scripts/build_kk_hotspots.py [hotspots.csv]
Coordinates, risk index, class, elevation and slope are copied unchanged. `country` is read from the supplied
address (the last element), nothing is derived from geometry.
"""
import csv
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "data" / "karakoram" / "hotspots.csv"
feats = []
with open(src, encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        addr = r["full_address"]
        country = "China" if addr.strip().endswith("中国") else "Pakistan" if "پاکستان" in addr else "unknown"
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [float(r["lon"]), float(r["lat"])]},
                      "properties": {"rank": int(r["rank"]), "risk_index": float(r["risk_index"]), "class": r["class"],
                                     "elev_m": float(r["elev_m"]), "slope_deg": float(r["slope_deg"]), "place_name": r["place_name"],
                                     "region": r["region"], "full_address": addr, "country": country}})
feats.sort(key=lambda x: x["properties"]["rank"])
out = root / "data" / "karakoram" / "kk_hotspots.geojson"
out.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"wrote {len(feats)} hotspots -> {out}")
