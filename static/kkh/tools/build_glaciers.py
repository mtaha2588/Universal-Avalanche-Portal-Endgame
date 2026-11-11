#!/usr/bin/env python3
"""All glaciers near the Karakoram Highway / CPEC for the Settlement & Infrastructure tab.

    python static/kkh/tools/build_glaciers.py "path/to/Glacier_Slope_Distance_KKH_CPEC.csv"

Writes, next to this folder:
    data/kkh_glaciers.geojson          one point per glacier of the CSV (its centroid), every CSV column kept (numbers to display precision),
                                       plus: slope class (avalanche terrain, from the CSV's mean slope) and the nearest point of the N-35 line
    data/kkh_glacier_outlines.geojson  RGI 7.0 outlines (data/glaciers/rgi7_pakistan.geojson, the portal's own) within the CSV's 50 km corridor

Slope classes follow the usual avalanche-terrain bands: under 25 degrees rarely releases, 25-30 can, 30-45 is where most slab avalanches start,
over 45 sheds snow often in small sluffs. They describe the terrain only: they are not a forecast.
"""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "data"
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
from build_route import dp, km  # noqa: E402


def ring_dp(ring, tol):
    """Simplify a closed ring: split it at the vertex farthest from its start, simplify both halves (a closed ring's own end points coincide)."""
    pts = [(c[1], c[0]) for c in ring]
    if len(pts) < 5: return pts
    k = max(range(len(pts)), key=lambda i: km(pts[0], pts[i]))
    out = dp(pts[:k + 1], tol)[:-1] + dp(pts[k:], tol)
    return out if len(out) >= 4 else pts


def slope_class(s: float) -> str:
    return "under 25°" if s < 25 else "25–30°" if s < 30 else "30–45° (prime avalanche terrain)" if s <= 45 else "over 45° (frequent sluffs)"


class Line:
    """The N-35 line with a coarse grid index, for nearest-point queries."""

    def __init__(self, coords):
        self.P = [(c[1], c[0]) for c in coords]
        self.ch = [0.0]
        for i in range(1, len(self.P)): self.ch.append(self.ch[-1] + km(self.P[i - 1], self.P[i]))
        self.grid = {}
        for i in range(len(self.P) - 1):
            self.grid.setdefault((int(self.P[i][0] / 0.1), int(self.P[i][1] / 0.1)), []).append(i)

    def nearest(self, lat, lon, reach=6):
        best = (1e9, 0.0, None)
        gi, gj = int(lat / 0.1), int(lon / 0.1)
        cands = [i for di in range(-reach, reach + 1) for dj in range(-reach, reach + 1) for i in self.grid.get((gi + di, gj + dj), [])]
        if not cands: cands = range(len(self.P) - 1)
        cl = math.cos(math.radians(lat))
        for i in cands:
            a, b = self.P[i], self.P[i + 1]
            ax, ay, bx, by, px, py = a[1] * cl, a[0], b[1] * cl, b[0], lon * cl, lat
            dx, dy = bx - ax, by - ay
            t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
            q = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); d = km(q, (lat, lon))
            if d < best[0]: best = (d, self.ch[i] + (self.ch[i + 1] - self.ch[i]) * t, q)
        return best


def main() -> int:
    src = Path(sys.argv[1])
    route = next(f for f in json.loads((OUT / "kkh_route.geojson").read_text(encoding="utf-8"))["features"] if f["properties"]["id"] == "n35")["geometry"]["coordinates"]
    L = Line(route)
    rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
    num = lambda v, d: None if v in ("", "None", None) else round(float(v), d)
    feats = []
    for r in rows:
        lat, lon = float(r["centroid_lat"]), float(r["centroid_lon"])
        d, ch, q = L.nearest(lat, lon)
        s = float(r["slope_mean_deg"])
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}, "properties": {
            "id": r["glac_id"], "name": None if r["glac_name"] in ("", "None") else r["glac_name"], "range": r["range"],
            "area_km2": num(r["area_km2"], 3), "dist_km": num(r["dist_to_KKH_CPEC_km"], 2), "elev_mean_m": num(r["elev_mean_m"], 0),
            "slope_mean": num(r["slope_mean_deg"], 1), "slope_median": num(r["slope_median_deg"], 1), "slope_min": num(r["slope_min_deg"], 1),
            "slope_max": num(r["slope_max_deg"], 1), "slope_std": num(r["slope_std_deg"], 1),
            "prone": 30 <= s <= 45, "road_km": round(ch, 1), "centroid_road_km": round(d, 2)}})
    (OUT / "kkh_glaciers.geojson").write_text(json.dumps({"type": "FeatureCollection", "source": src.name,
        "note": "Every column of the CSV (numbers rounded to display precision). dist_km = the CSV's distance to the KKH/CPEC; road_km and centroid_road_km are computed from the centroid to the N-35 line (OpenStreetMap).",
        "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # RGI 7.0 outlines (the portal's own file) whose centre lies within the CSV's corridor (50 km of the road), simplified for the map
    rgi = json.loads((ROOT / "data" / "glaciers" / "rgi7_pakistan.geojson").read_text(encoding="utf-8"))
    keep = []
    for f in rgi["features"]:
        p = f["properties"]
        if p.get("lat") is None: continue
        d, ch, _ = L.nearest(p["lat"], p["lon"], reach=7)
        if d > 52: continue
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        out = []
        for poly in polys:
            rings = [[[round(x, 4), round(y, 4)] for y, x in ring_dp(ring, 20.0)] for ring in poly]
            rings = [r for r in rings if len(r) >= 4]
            if rings: out.append(rings)
        if not out: continue
        keep.append({"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": out}, "properties": {
            "rgi_id": p.get("rgi_id"), "name": p.get("name"), "system": p.get("system"), "area_km2": p.get("area_km2"),
            "zmin_m": p.get("zmin_m"), "zmax_m": p.get("zmax_m"), "road_km": round(ch, 1), "centre_road_km": round(d, 1)}})
    (OUT / "kkh_glacier_outlines.geojson").write_text(json.dumps({"type": "FeatureCollection", "source": "RGI 7.0 (RGI Consortium 2023), data/glaciers/rgi7_pakistan.geojson",
        "features": keep}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sz = lambda f: round((OUT / f).stat().st_size / 1024)
    n5 = sum(1 for f in feats if f["properties"]["dist_km"] is not None and f["properties"]["dist_km"] <= 5)
    print(f"kkh_glaciers.geojson: {len(feats)} glaciers ({sz('kkh_glaciers.geojson')} KB); within 5 km (CSV distance): {n5}, of them on 30-45 deg slopes: "
          f"{sum(1 for f in feats if f['properties']['prone'] and (f['properties']['dist_km'] or 99) <= 5)}")
    print(f"kkh_glacier_outlines.geojson: {len(keep)} RGI 7.0 outlines ({sz('kkh_glacier_outlines.geojson')} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
