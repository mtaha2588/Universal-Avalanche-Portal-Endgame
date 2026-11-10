#!/usr/bin/env python3
"""Karakoram Highway (N-35) route and infrastructure for the "Settlement & Infrastructure" tab.

    python static/kkh/tools/build_route.py [--cache DIR] [--no-mapbox]

Reads OpenStreetMap through Overpass (cached in --cache, default: the system temp folder) and writes, next to this folder:
    data/kkh_route.geojson          the N-35 line (Hasan Abdal -> Khunjerab Pass), the G314 line (Khunjerab -> Kashgar, context) and the towns on it
    data/kkh_infrastructure.geojson tunnels, avalanche galleries, major bridges and the Sost dry port, with chainage along the route
    data/kkh_route_report.json      the quality report (length, gaps, Attabad tunnels, Mapbox Streets cross-check)

Source: OpenStreetMap relation 2441750 "Karakoram Highway", ref N-35, operator National Highway Authority (Pakistan), Hasan Abdal -> Khunjerab Pass.
The relation's ways are chained by their end nodes (shortest path between the two end points); where two ways end within 40 m of each other
they are welded, and any larger break is bridged with a straight segment that is listed in the report. Nothing else is moved or invented.
© OpenStreetMap contributors (ODbL).
"""
from __future__ import annotations

import argparse
import collections
import heapq
import json
import math
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "data"
ROOT = HERE.parents[2]
UA = {"User-Agent": "kkh-portal-research/1.0 (NDMA NGT avalanche portal)", "Accept": "application/json"}
EPS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
ATTRIB = "© OpenStreetMap contributors"
REL = 2441750
KHUNJERAB = (36.8501, 75.4283)           # OSM node 13681846537 "Khunjerab Pass" (saddle)
KASHGAR = (39.4666, 75.9900)             # OSM node 244081035 Kashgar
SIDE_WAYS = (1270853574,)                # the tertiary stretch tagged ref N-35 that closes the break at Thakot (34.74 N)
ATTABAD = (370731323, 528811846, 528811847, 659187471, 1036880269)   # the five post-2015 tunnels round Attabad Lake

ALIAS = {"hassanabdal": "Hasan Abdal", "dassu": "Dasu", "hasanabad": "Hassanabad"}   # OSM spellings
# towns that have no place point in OSM: a sourced coordinate (never guessed); the report says where each came from
EXTRA_TOWNS = {"Besham": {"lat": 34.9239, "lon": 72.8758, "osm": "wikidata/Q3307940", "place": "town (Wikidata; no place point in OSM)"}}
TOWNS = ["Hasan Abdal", "Abbottabad", "Mansehra", "Besham", "Dasu", "Chilas", "Raikot", "Jaglot", "Gilgit", "Aliabad", "Hassanabad", "Gulmit", "Passu", "Sost"]
QUERIES = {
    "n35_ways": f'[out:json][timeout:170];relation({REL});way(r);out tags geom;',
    "g314": '[out:json][timeout:170];way["ref"~"G314"](36.7,74.7,39.9,76.8);out tags geom;',
    "places": '[out:json][timeout:170];(nwr["place"]["name"~"^.{0,2}(Hasan ?Abdal|Hassan ?Abdal|Abbottabad|Mansehra|Besham|Dasu|Dassu|Chilas|Jaglot|Gilgit|Aliabad|Hass?anabad|Gulmit|Passu|Sost|Tashkurgan|Kashgar)$",i](33.5,72.3,40.2,76.6);nwr["place"]["name:en"~"^.{0,2}(Hasan ?Abdal|Hassan ?Abdal|Abbottabad|Mansehra|Besham|Dasu|Dassu|Chilas|Jaglot|Gilgit|Aliabad|Hass?anabad|Gulmit|Passu|Sost|Tashkurgan|Kashgar)$",i](33.5,72.3,40.2,76.6););out center tags;',
    # near Bulunkou (38.8 N) OSM leaves ~9 km of G314 without its ref: the trunk ways there named Karakoram Highway / Urumqi - Khunjerab fill it
    "g314_fill": '[out:json][timeout:170];way["highway"~"^(trunk|primary|secondary|motorway)$"](38.70,74.85,38.95,75.65);out tags geom;',
    "sost": '[out:json][timeout:170];nwr["name"~"Sost Dry Port",i](36.5,74.5,37.0,75.6);out center tags;',
}


# ------------------------------------------------------------------ fetch (cached)
def overpass(q: str, tries: int = 10, timeout: int = 200) -> dict:
    last = None
    for k in range(tries):
        ep = EPS[k % len(EPS)]
        try:
            req = urllib.request.Request(ep, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=timeout))
        except Exception as e:                                               # busy server: wait and try the next mirror
            last = e
            print(f"  overpass retry {k + 1}: {ep.split('/')[2]} {str(e)[:70]}", flush=True)
            time.sleep(6 + 4 * k)
    raise RuntimeError(f"Overpass unreachable: {last}")


def get(cache: Path, name: str) -> dict:
    f = cache / f"{name}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    print(f"fetching {name} from OpenStreetMap ...", flush=True)
    d = overpass(QUERIES[name])
    f.write_text(json.dumps(d), encoding="utf-8")
    return d


# ------------------------------------------------------------------ geometry
def km(a, b) -> float:
    return math.hypot((b[1] - a[1]) * 111.32 * math.cos(math.radians((a[0] + b[0]) / 2)), (b[0] - a[0]) * 110.57)


def dp(pts, tol_m):
    """Douglas-Peucker on (lat, lon) in metres (iterative: no recursion limit)."""
    if len(pts) < 3:
        return pts
    x0 = pts[0][0]
    P = [((p[1]) * 111320 * math.cos(math.radians(x0)), p[0] * 110574) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = P[a]; bx, by = P[b]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            d = abs((P[i][0] - ax) * dy - (P[i][1] - ay) * dx) / L
            if d > best: best, bi = d, i
        if best > tol_m and bi > 0:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


K = lambda p: (round(p["lat"], 6), round(p["lon"], 6))


class Net:
    """A road network of OSM ways; chain() returns the shortest path between two coordinates as an ordered point list."""

    def __init__(self, ways, weld_m=40, gap_km=1.2, gap_any=False):
        self.W = ways
        self.adj = collections.defaultdict(list)
        for wi, w in enumerate(ways):
            g = [K(p) for p in w["geometry"]]
            L = sum(km(g[i], g[i + 1]) for i in range(len(g) - 1))
            self.adj[g[0]].append((g[-1], L, wi, False)); self.adj[g[-1]].append((g[0], L, wi, True))
        nodes = list(self.adj)
        for i, a in enumerate(nodes):
            for b in nodes[i + 1:]:
                if abs(a[0] - b[0]) < 0.0006 and abs(a[1] - b[1]) < 0.0006 and km(a, b) * 1000 < weld_m:
                    self.adj[a].append((b, km(a, b), -1, False)); self.adj[b].append((a, km(a, b), -1, False))
        self.gaps = []
        ends = list(self.adj) if gap_any else [n for n in self.adj if len(self.adj[n]) == 1]   # gap_any: pieces may end at a junction
        for d, a, b in sorted((km(a, b), a, b) for i, a in enumerate(ends) for b in ends[i + 1:] if km(a, b) < gap_km):
            f = self._comp()
            if f(a) != f(b):
                self.adj[a].append((b, d, -2, False)); self.adj[b].append((a, d, -2, False)); self.gaps.append({"from": a, "to": b, "m": round(d * 1000)})

    def _comp(self):
        par = {}

        def f(x):
            while par.setdefault(x, x) != x:
                par[x] = par[par[x]]; x = par[x]
            return x
        for a in self.adj:
            for b, *_ in self.adj[a]: par[f(a)] = f(b)
        return f

    def nearest(self, ll):
        return min(self.adj, key=lambda n: km(n, ll))

    def chain(self, src, dst):
        s, d = self.nearest(src), self.nearest(dst)
        dist = {s: 0.0}; prev = {}; pq = [(0.0, s)]
        while pq:
            c, u = heapq.heappop(pq)
            if c > dist.get(u, 1e18): continue
            if u == d: break
            for v, L, wi, rv in self.adj[u]:
                if c + L < dist.get(v, 1e18): dist[v] = c + L; prev[v] = (u, wi, rv); heapq.heappush(pq, (c + L, v))
        if d not in prev: raise RuntimeError("no connected path between the end points")
        steps = []; n = d
        while n in prev:
            u, wi, rv = prev[n]; steps.append((u, n, wi, rv)); n = u
        steps.reverse()
        pts, used = [], []
        for u, v, wi, rv in steps:
            if wi >= 0:
                g = [K(p) for p in self.W[wi]["geometry"]]
                if rv: g = g[::-1]
            else:
                g = [u, v]
            i0 = len(pts)
            for p in g:
                if not pts or pts[-1] != p: pts.append(p)
            used.append({"way": self.W[wi]["id"] if wi >= 0 else None, "gap": wi == -2, "i0": max(0, i0 - (1 if i0 else 0)), "i1": len(pts) - 1})
        return pts, used


def pts_eq(pts, u, g):
    a, b = pts[u["i0"]], pts[u["i1"]]
    return {a, b} == {tuple(g["from"]), tuple(g["to"])}


def chainage(pts):
    c = [0.0]
    for i in range(1, len(pts)): c.append(c[-1] + km(pts[i - 1], pts[i]))
    return c


def locate(pts, ch, ll):
    """Nearest vertex-segment point of the line to ll: (chainage km, offset km, nearest point)."""
    best = (1e18, 0, None)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ax, ay = a[1] * math.cos(math.radians(a[0])), a[0]; bx, by = b[1] * math.cos(math.radians(a[0])), b[0]; px, py = ll[1] * math.cos(math.radians(a[0])), ll[0]
        dx, dy = bx - ax, by - ay; t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        q = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); d = km(q, ll)
        if d < best[0]: best = (d, ch[i] + (ch[i + 1] - ch[i]) * t, q)
    return best[1], best[0], best[2]


# ------------------------------------------------------------------ main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(Path(tempfile.gettempdir()) / "kkh_osm_cache"))
    ap.add_argument("--no-mapbox", action="store_true")
    a = ap.parse_args()
    cache = Path(a.cache); cache.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)

    # ---- N-35
    ways = [w for w in get(cache, "n35_ways")["elements"]
            if (w["tags"].get("highway") == "trunk" and w["tags"].get("ref") == "N-35") or w["id"] in SIDE_WAYS]
    net = Net(ways)
    south = min((n for n in net.adj), key=lambda n: n[0])                       # Hasan Abdal end of the relation
    pts, used = net.chain(south, KHUNJERAB)
    ch = chainage(pts); total = ch[-1]
    by_id = {w["id"]: w for w in ways}
    print(f"N-35: {len(ways)} ways, path {total:.1f} km, {len(pts)} vertices, {len(net.gaps)} gap(s) bridged")

    # ---- infrastructure on the route: tunnels, galleries, bridges (with chainage from the full-resolution line)
    infra, ways_used = [], {u["way"]: u for u in used if u["way"]}
    for wid, u in ways_used.items():
        t = by_id[wid]["tags"]; kind = "tunnel" if t.get("tunnel") == "yes" else "avalanche gallery" if t.get("tunnel") == "avalanche_protector" else "bridge" if t.get("bridge") else None
        if not kind: continue
        i0, i1 = u["i0"], u["i1"]; length = ch[i1] - ch[i0]; mid = pts[(i0 + i1) // 2]
        infra.append({"id": wid, "kind": kind, "name": t.get("name:en") if t.get("name:en") not in (None, "Karakoram Highway") else (t.get("name") if kind == "bridge" and t.get("name") and not re.search(r"[^\x00-\x7f]", t["name"]) else None),
                      "length_m": round(length * 1000), "chainage_km": round(ch[i0], 1), "lat": mid[0], "lon": mid[1], "layer": t.get("layer")})
    infra.sort(key=lambda x: x["chainage_km"])
    sost = get(cache, "sost")["elements"]
    for e in sost:
        if "dry port" not in (e["tags"].get("name:en") or e["tags"].get("name") or "").lower(): continue         # (the query also returns the town)
        c = e.get("center") or {"lat": e.get("lat"), "lon": e.get("lon")}
        s_ch, off, _ = locate(pts, ch, (c["lat"], c["lon"]))
        infra.append({"id": e["id"], "kind": "dry port", "name": e["tags"].get("name:en") or e["tags"].get("name"), "length_m": None, "chainage_km": round(s_ch, 1), "offset_to_route_km": round(off, 2), "lat": c["lat"], "lon": c["lon"], "osm_type": e["type"]})

    # ---- towns on the route
    PL = {}
    for e in get(cache, "places")["elements"]:
        nm = re.sub(r"[‎‏‪-‮]", "", (e["tags"].get("name:en") or e["tags"].get("name") or "")).strip()     # (some names start with an invisible direction mark)
        c = (e["lat"], e["lon"]) if "lat" in e else (e["center"]["lat"], e["center"]["lon"])
        norm = ALIAS.get(nm.lower().replace(" ", ""), nm)
        key = next((t for t in TOWNS + ["Tashkurgan", "Kashgar"] if t.lower().replace(" ", "") == norm.lower().replace(" ", "")), None)
        if key: PL.setdefault(key, []).append({"name": key, "lat": c[0], "lon": c[1], "osm": f"{e['type']}/{e['id']}", "place": e["tags"].get("place")})
    towns = []
    for t in TOWNS:
        cands = PL.get(t, []) or ([{"name": t, **EXTRA_TOWNS[t]}] if t in EXTRA_TOWNS else [])
        best = min(((locate(pts, ch, (c["lat"], c["lon"])), c) for c in cands), key=lambda x: x[0][1], default=None)
        if best: (s_ch, off, _), c = best; towns.append({**c, "chainage_km": round(s_ch, 1), "offset_to_route_km": round(off, 2)})
        else: towns.append({"name": t, "missing": True})
    raikot = next((i for i in infra if i["name"] == "Raikot Bridge"), None)
    if raikot:                                                              # the KKH's Raikot is the bridge over the Indus below Nanga Parbat
        towns = [x for x in towns if x["name"] != "Raikot"] + [{"name": "Raikot", "lat": raikot["lat"], "lon": raikot["lon"], "osm": f"way/{raikot['id']}", "place": "named bridge (Raikot Bridge)", "chainage_km": raikot["chainage_km"], "offset_to_route_km": 0.0}]
    towns.append({"name": "Khunjerab Pass", "lat": KHUNJERAB[0], "lon": KHUNJERAB[1], "osm": "node/13681846537", "place": "saddle", "chainage_km": round(total, 1), "offset_to_route_km": 0.0})
    towns.sort(key=lambda x: x.get("chainage_km", -1))

    # ---- China G314 (context): Khunjerab -> Kashgar
    g314 = [w for w in get(cache, "g314")["elements"] if w["tags"].get("highway") in ("trunk", "motorway", "primary", "secondary") and "旧" not in str(w["tags"].get("ref"))]
    g314 += [w for w in get(cache, "g314_fill")["elements"] if w["tags"].get("highway") == "trunk" and w["id"] not in {x["id"] for x in g314}
             and (w["tags"].get("ref") in (None, "G314")) and re.search(r"喀喇昆仑|红其拉甫|G314", (w["tags"].get("name") or "") + (w["tags"].get("ref") or "") + "G314" * (w["tags"].get("ref") == "G314"))]
    cn_pts, cn_gaps = [], []
    try:
        # context only (drawn dimmer): OSM leaves a few stretches of G314 without the ref, so joins of up to 6 km are drawn straight; listed in the report
        cnet = Net(g314, gap_km=6.0, gap_any=True); cn_pts, cn_used = cnet.chain(KHUNJERAB, KASHGAR)
        cn_gaps = [g for g in cnet.gaps if any(u["gap"] for u in cn_used)]
        cn_gaps = [{"m": g["m"], "from": g["from"], "to": g["to"]} for g in cnet.gaps if any(u["gap"] and pts_eq(cn_pts, u, g) for u in cn_used)]
        print(f"G314: {len(g314)} ways, path {chainage(cn_pts)[-1]:.1f} km, straight joins: {[g['m'] for g in cn_gaps]} m")
    except Exception as e:
        print("G314 chain failed:", e)

    # ---- simplify (to keep the file small) and write
    simp = dp(pts, 3.0); cn_simp = dp(cn_pts, 12.0) if cn_pts else []
    r5 = lambda p: [round(p[1], 5), round(p[0], 5)]
    feats = [{"type": "Feature", "properties": {"id": "n35", "name": "Karakoram Highway (N-35)", "ref": "N-35", "operator": "National Highway Authority (Pakistan)", "from": "Hasan Abdal", "to": "Khunjerab Pass",
                                                  "length_km": round(total, 1), "context": False, "source": f"OpenStreetMap relation {REL}", "attribution": ATTRIB},
              "geometry": {"type": "LineString", "coordinates": [r5(p) for p in simp]}}]
    if cn_simp:
        feats.append({"type": "Feature", "properties": {"id": "g314", "name": "G314 (China): Khunjerab - Tashkurgan - Kashgar", "ref": "G314", "context": True, "length_km": round(chainage(cn_pts)[-1], 1),
                                                          "source": "OpenStreetMap ways with ref G314", "attribution": ATTRIB},
                      "geometry": {"type": "LineString", "coordinates": [r5(p) for p in cn_simp]}})
    for t in towns:
        if t.get("missing"): continue
        feats.append({"type": "Feature", "properties": {"id": "town", "name": t["name"], "chainage_km": t["chainage_km"], "offset_to_route_km": t["offset_to_route_km"], "osm": t["osm"], "place": t.get("place")},
                      "geometry": {"type": "Point", "coordinates": [round(t["lon"], 5), round(t["lat"], 5)]}})
    (OUT / "kkh_route.geojson").write_text(json.dumps({"type": "FeatureCollection", "attribution": ATTRIB, "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "kkh_infrastructure.geojson").write_text(json.dumps({"type": "FeatureCollection", "attribution": ATTRIB, "features": [
        {"type": "Feature", "properties": {k: v for k, v in i.items() if k not in ("lat", "lon")}, "geometry": {"type": "Point", "coordinates": [round(i["lon"], 5), round(i["lat"], 5)]}} for i in infra]},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---- quality report
    nh = collections.Counter(i["kind"] for i in infra)
    att = [{"way": w, "on_route": w in ways_used, "length_m": next((i["length_m"] for i in infra if i["id"] == w), None)} for w in ATTABAD]
    rep = {"relation": REL, "route_vertices_full": len(pts), "route_vertices_simplified": len(simp), "length_km": round(total, 1), "length_km_simplified": round(chainage(simp)[-1], 1),
           "gaps_bridged": [{"m": g["m"], "from": g["from"], "to": g["to"]} for g in net.gaps],
           "g314_context_km": round(chainage(cn_pts)[-1], 1) if cn_pts else None, "g314_straight_joins": cn_gaps,
           "welds_under_40m": sum(1 for u in used if u["way"] is None and not u["gap"]), "side_ways_used": [w for w in SIDE_WAYS if w in ways_used],
           "attabad_tunnels": att, "attabad_tunnel_total_km": round(sum(x["length_m"] or 0 for x in att) / 1000, 2),
           "infrastructure": dict(nh), "towns": towns,
           "files": {f: round((OUT / f).stat().st_size / 1024) for f in ("kkh_route.geojson", "kkh_infrastructure.geojson")}}
    if not a.no_mapbox:
        rep["mapbox_streets_crosscheck"] = mapbox_check(pts, ch)
    (OUT / "kkh_route_report.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in rep.items() if k not in ("towns", "mapbox_streets_crosscheck")}, indent=1, ensure_ascii=False)[:2500])
    return 0


def mapbox_check(pts, ch, n=16):
    """Sample points along the route and ask Mapbox Streets (tilequery, layer road) what road is there. The token is read from .env, never printed."""
    tok = os.environ.get("MAPBOX_TOKEN", "")
    env = ROOT / ".env"
    if not tok and env.exists():
        m = re.search(r"^MAPBOX_TOKEN\s*=\s*(\S+)", env.read_text(encoding="utf-8"), re.M)
        tok = m.group(1).strip("\"'") if m else ""
    if not tok: return {"error": "no MAPBOX_TOKEN"}
    out = []
    for k in range(n):
        s = ch[-1] * (k + 0.5) / n; i = min(range(len(ch)), key=lambda j: abs(ch[j] - s)); p = pts[i]
        url = f"https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/{p[1]},{p[0]}.json?layers=road&radius=80&limit=8&access_token={tok}"
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
            roads = [f for f in d.get("features", []) if f["properties"].get("class") not in ("path", "pedestrian", "service")]
            near = min(roads, key=lambda f: f["properties"]["tilequery"]["distance"], default=None)
            out.append({"chainage_km": round(ch[i], 1), "lat": round(p[0], 4), "lon": round(p[1], 4),
                        "mapbox_road": None if not near else {"class": near["properties"].get("class"), "ref": near["properties"].get("ref"), "name": near["properties"].get("name_en") or near["properties"].get("name"),
                                                              "distance_m": round(near["properties"]["tilequery"]["distance"])}})
        except Exception as e:
            out.append({"chainage_km": round(ch[i], 1), "error": str(e)[:80]})
    return out


if __name__ == "__main__":
    sys.exit(main())
