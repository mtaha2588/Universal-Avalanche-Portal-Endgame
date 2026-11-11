"""5 km Road Exposure Corridor: buffer every major road 5 km on each side and intersect it with the portal's avalanche data.

    python scripts/build_road_corridor.py [--force]

Inputs (all existing portal data; nothing is modified):
    data/roads.geojson                            OpenStreetMap motorway / trunk / primary / secondary ways (scripts/fetch_osm.py roads)
    data/boundaries/study_area.geojson            the study area the roads are clipped to
    data/history/events/pk_events.geojson         compiled historical avalanche events (located records only)
    data/incidents.geojson                        the seed incident catalogue (proxy locations)
    forecast/output/latest/alerts_tiles_daily.geojson   avalanche alert forecast: level and snowfall per 0.25 degree tile and day
    data/screening/hk_hotspots.geojson, data/karakoram/kk_hotspots.geojson   terrain-screened release-area hotspots
    data/glaciers/rgi7_pakistan.geojson           RGI 7.0 glacier outlines
    data/settlements.geojson                      reference settlements
Outputs (data/road_corridor/):
    road_corridor_5km.geojson     one corridor polygon per road (with its statistics) and one dissolved polygon of all corridors
    road_centrelines.geojson      the road centrelines, merged per road
    road_corridor_stats.json      network totals, the ranking, and each input's status

Method. Every geometry is projected to WGS 84 / UTM zone 43N (EPSG:32643, metres; the study area lies within about 3 degrees of its
central meridian, scale error under 0.1 %). Ways are de-duplicated, repaired where invalid, clipped to the study area and grouped into
roads by reference number, else by name; ways with neither are grouped per class and labelled as unnamed. The corridor is the set of
points within 5,000 m of the centreline (5 km on EACH side, 10 km wide). Lengths and areas are measured in the projected CRS.
A dataset that is missing is reported as unavailable (null), never as zero. The build is skipped when no input has changed.
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import shape, mapping, Point
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "road_corridor"
BUFFER_M = 5000
CRS = "EPSG:32643"
VERSION = 3
IN = {
    "roads": ROOT / "data/roads.geojson",
    "study_area": ROOT / "data/boundaries/study_area.geojson",
    "events": ROOT / "data/history/events/pk_events.geojson",
    "incidents": ROOT / "data/incidents.geojson",
    "forecast": ROOT / "forecast/output/latest/alerts_tiles_daily.geojson",
    "hk_hotspots": ROOT / "data/screening/hk_hotspots.geojson",
    "kk_hotspots": ROOT / "data/karakoram/kk_hotspots.geojson",
    "glaciers": ROOT / "data/glaciers/rgi7_pakistan.geojson",
    "settlements": ROOT / "data/settlements.geojson",
}
LEVEL = {2: "High", 1: "Moderate", 0: "Low", -1: "Not rated"}
CLASS_ORDER = ["motorway", "trunk", "primary", "secondary"]

fwd = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
inv = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
to_m = lambda g: shapely.transform(g, lambda a: np.column_stack(fwd.transform(a[:, 0], a[:, 1])))
to_ll = lambda g: shapely.transform(g, lambda a: np.column_stack(inv.transform(a[:, 0], a[:, 1])))


def load(key):
    p = IN[key]
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def signature():
    return {"version": VERSION, **{k: ([p.stat().st_mtime_ns, p.stat().st_size] if p.exists() else None) for k, p in IN.items()}}


def geojson(geom, nd=5):
    return json.loads(shapely.to_geojson(shapely.set_precision(to_ll(geom), 10 ** -nd)))


def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    stats_p = OUT / "road_corridor_stats.json"
    sig = signature()
    if not a.force and stats_p.exists() and all((OUT / f).exists() for f in ("road_corridor_5km.geojson", "road_centrelines.geojson")):
        if json.loads(stats_p.read_text(encoding="utf-8")).get("signature") == json.loads(json.dumps(sig)):
            print("Road corridor is up to date (no input has changed). Use --force to rebuild."); return 0
    t0 = time.time()
    roads = load("roads")
    if roads is None:
        sys.exit("data/roads.geojson is missing: run  python scripts/fetch_osm.py roads")

    # ---- study area (projected, repaired)
    sa = load("study_area"); area = None
    if sa:
        f = next((x for x in sa["features"] if x["properties"].get("layer") == "study_area"), None)
        if f: area = shapely.make_valid(to_m(shape(f["geometry"])))

    # ---- roads: repair, de-duplicate, clip, group
    seen, notes = set(), collections.Counter()
    groups = collections.defaultdict(list)
    for ft in roads["features"]:
        p = ft["properties"]; g = ft.get("geometry")
        if not g or g["type"] != "LineString" or len(g["coordinates"]) < 2: notes["invalid geometry dropped"] += 1; continue
        if p.get("osm_id") in seen: notes["duplicate way dropped"] += 1; continue
        seen.add(p.get("osm_id"))
        ln = to_m(shape(g))
        if not ln.is_valid or ln.length == 0: notes["invalid geometry dropped"] += 1; continue
        if area is not None:
            ln = ln.intersection(area)
            if ln.is_empty: notes["outside the study area"] += 1; continue
        ref = (p.get("ref") or "").split(";")[0].strip() or None
        name = (p.get("name") or "").strip() or None
        key = ("ref", ref) if ref else ("name", name) if name else ("unnamed", p.get("highway"))
        if key[0] == "unnamed": notes["ways without a name or reference"] += 1
        groups[key].append((ln, p.get("highway"), name, p.get("osm_id")))
    print(f"roads: {len(roads['features'])} ways -> {sum(len(v) for v in groups.values())} kept in {len(groups)} roads  {dict(notes)}")

    # ---- other layers, projected, with spatial indexes
    def pts(key, keep=lambda p: True):
        d = load(key)
        if d is None: return None
        out = [(to_m(Point(f["geometry"]["coordinates"][:2])), f["properties"]) for f in d["features"] if f.get("geometry") and f["geometry"]["type"] == "Point" and keep(f["properties"])]
        return out
    events = pts("events"); incidents = pts("incidents"); hk = pts("hk_hotspots"); kk = pts("kk_hotspots"); setts = pts("settlements")
    hot = None if hk is None and kk is None else (hk or []) + (kk or [])
    tree = lambda items: (STRtree([g for g, _ in items]) if items else None)
    T = {"events": tree(events), "incidents": tree(incidents), "hot": tree(hot), "setts": tree(setts)}

    gl = load("glaciers"); gl_geoms = gl_tree = None
    if gl is not None:
        gl_geoms = shapely.make_valid(to_m(shapely.from_geojson([json.dumps(f["geometry"]) for f in gl["features"]])))
        gl_tree = STRtree(gl_geoms)

    fc = load("forecast"); tiles = None; fc_days = []
    if fc is not None and fc["features"]:
        by = {}
        for f in fc["features"]:
            p = f["properties"]; t = by.setdefault(p["tile_id"], {"geom": f["geometry"], "level": -9, "sf3": 0.0, "sf7": 0.0, "depth": 0.0, "region": p.get("region"), "when": None})
            if p["level"] > t["level"]: t["level"] = p["level"]; t["when"] = p["date"]
            t["sf3"] = max(t["sf3"], p.get("sf_3d_mm") or 0); t["sf7"] = max(t["sf7"], p.get("sf_7d_mm") or 0); t["depth"] = max(t["depth"], p.get("snow_depth_m") or 0)
        fc_days = sorted({f["properties"]["date"] for f in fc["features"]})
        tiles = [(to_m(shape(t["geom"])), t) for t in by.values()]
    tile_tree = STRtree([g for g, _ in tiles]) if tiles else None

    def within(key, items, buf):
        if items is None: return None
        return [items[i][1] for i in T[key].query(buf, predicate="intersects")] if T[key] is not None else []

    def road_stats(line, buf):
        s = {}
        ev = within("events", events, buf); ic = within("incidents", incidents, buf)
        s["historical_events"] = None if ev is None else len(ev)
        s["historical_event_list"] = None if ev is None else [f"{p.get('event_id')} {p.get('location', '')[:40]} ({p.get('date') or p.get('date_start') or 'date unknown'})" for p in ev][:12]
        s["seed_incidents"] = None if ic is None else len(ic)
        s["seed_incident_list"] = None if ic is None else [f"{p.get('incident_id')} {p.get('location_name', '')}" for p in ic]
        h = within("hot", hot, buf); s["release_hotspots"] = None if h is None else len(h)
        st = within("setts", setts, buf); s["settlements_in_corridor"] = None if st is None else len(st)
        s["settlement_names"] = None if st is None else sorted(p.get("name") for p in st)
        if setts:
            d = sorted((line.distance(g) / 1000, p.get("name")) for g, p in setts)[:3]
            s["nearest_settlements"] = [f"{n} ({km:.1f} km)" for km, n in d]
        else: s["nearest_settlements"] = None
        if gl_tree is not None:
            idx = gl_tree.query(buf, predicate="intersects")
            s["glaciers"] = int(len(idx)); s["glacier_area_km2"] = round(float(shapely.area(shapely.intersection(gl_geoms[idx], buf)).sum()) / 1e6, 1) if len(idx) else 0.0
        else: s["glaciers"] = s["glacier_area_km2"] = None
        if tile_tree is not None:
            km = collections.Counter(); snow10 = snow25 = 0.0; mx3 = mxd = 0.0; inside = 0.0; worst = -9; when = None
            for i in tile_tree.query(line, predicate="intersects"):
                g, t = tiles[i]; L = line.intersection(g).length / 1000
                if L <= 0: continue
                inside += L; km[LEVEL[t["level"]]] += L
                if t["sf3"] >= 10: snow10 += L
                if t["sf3"] >= 25: snow25 += L
                mx3 = max(mx3, t["sf3"]); mxd = max(mxd, t["depth"])
                if t["level"] > worst: worst = t["level"]; when = t["when"]
            total = line.length / 1000
            s["km_by_alert"] = {k: round(km.get(k, 0.0), 1) for k in ("High", "Moderate", "Low", "Not rated")}
            s["km_no_forecast_tile"] = round(max(0.0, total - inside), 1)
            s["worst_alert"] = LEVEL.get(worst) if worst != -9 else None; s["worst_alert_date"] = when
            s["km_snowfall_10mm"] = round(snow10, 1); s["km_snowfall_25mm"] = round(snow25, 1)
            s["max_snowfall_3d_mm"] = round(mx3, 1); s["max_snow_depth_m"] = round(mxd, 2)
        else:
            for k in ("km_by_alert", "km_no_forecast_tile", "worst_alert", "worst_alert_date", "km_snowfall_10mm", "km_snowfall_25mm", "max_snowfall_3d_mm", "max_snow_depth_m"): s[k] = None
        return s

    # ---- per road: merged centreline, corridor, statistics
    feats, lines_out, all_lines, all_bufs = [], [], [], []
    for n, (key, ways) in enumerate(sorted(groups.items(), key=lambda kv: str(kv[0]))):
        merged = unary_union([w[0] for w in ways]); merged = linemerge(merged) if merged.geom_type == "MultiLineString" else merged
        if merged.is_empty or merged.length < 50: continue
        cls_len = collections.Counter()
        for ln, hw, _, _ in ways: cls_len[hw] += ln.length
        cls = max(cls_len, key=cls_len.get)
        names = collections.Counter(w[2] for w in ways if w[2])
        label = (f"{key[1]}" + (f" · {names.most_common(1)[0][0]}" if names else "")) if key[0] == "ref" else key[1] if key[0] == "name" else f"Unnamed {key[1]} roads (no name in OpenStreetMap)"
        buf = shapely.make_valid(merged.buffer(BUFFER_M, quad_segs=12))
        if area is not None: buf = buf.intersection(area)
        c = to_ll(merged.representative_point() if merged.geom_type != "LineString" else merged.interpolate(0.5, normalized=True))
        props = {"kind": "road", "road_id": f"R{n + 1:04d}", "name": label, "ref": key[1] if key[0] == "ref" else None, "named": key[0] != "unnamed", "road_class": cls,
                 "length_km": round(merged.length / 1000, 1), "osm_ways": len(ways), "buffer_each_side_km": BUFFER_M / 1000, "corridor_area_km2": round(buf.area / 1e6, 1),
                 "lon": round(c.x, 4), "lat": round(c.y, 4), **road_stats(merged, buf)}
        feats.append({"type": "Feature", "properties": props, "geometry": geojson(buf.simplify(60), 4)})
        lines_out.append({"type": "Feature", "properties": {k: props[k] for k in ("road_id", "name", "ref", "road_class", "length_km")}, "geometry": geojson(merged.simplify(15), 5)})
        all_lines.append(merged); all_bufs.append(buf)

    # ---- exposure ranking: km under High, then Moderate, then located historical events, then release hotspots, then glacier area
    rk = lambda p: ((p["km_by_alert"] or {}).get("High", 0), (p["km_by_alert"] or {}).get("Moderate", 0), (p["historical_events"] or 0) + (p["seed_incidents"] or 0), p["release_hotspots"] or 0, p["glacier_area_km2"] or 0)
    ranked = sorted((f["properties"] for f in feats), key=rk, reverse=True)
    for i, p in enumerate(ranked): p["exposure_rank"] = i + 1

    # ---- network totals on the dissolved geometry (nothing counted twice)
    net = unary_union(all_lines); dis = unary_union(all_bufs)
    tot = road_stats(net, dis)
    dissolved = {"type": "Feature", "properties": {"kind": "dissolved", "name": "5 km Road Exposure Corridor (all roads, dissolved)", "buffer_each_side_km": BUFFER_M / 1000,
                 "road_length_km": round(net.length / 1000, 1), "corridor_area_km2": round(dis.area / 1e6, 1)}, "geometry": geojson(dis.simplify(80), 4)}
    meta = {"crs_analysis": f"{CRS} (WGS 84 / UTM zone 43N, metres)", "crs_output": "EPSG:4326", "buffer_m_each_side": BUFFER_M,
            "roads_source": (roads.get("metadata") or {}).get("source", "OpenStreetMap contributors (ODbL)"), "roads_downloaded": (roads.get("metadata") or {}).get("downloaded"),
            "built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"), "forecast_days": [fc_days[0], fc_days[-1]] if fc_days else None}
    (OUT / "road_corridor_5km.geojson").write_text(json.dumps({"type": "FeatureCollection", "metadata": meta, "features": [dissolved] + feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "road_centrelines.geojson").write_text(json.dumps({"type": "FeatureCollection", "metadata": meta, "features": lines_out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by_class = collections.defaultdict(lambda: [0, 0.0])
    for f in feats: by_class[f["properties"]["road_class"]][0] += 1; by_class[f["properties"]["road_class"]][1] += f["properties"]["length_km"]
    stats = {"signature": sig, "meta": meta, "inputs": {k: ("available" if p.exists() else "unavailable") for k, p in IN.items()}, "cleaning": dict(notes),
             "roads": len(feats), "road_length_km": round(net.length / 1000, 1), "corridor_area_km2": round(dis.area / 1e6, 1),
             "by_class": {c: {"roads": by_class[c][0], "length_km": round(by_class[c][1], 1)} for c in CLASS_ORDER if c in by_class},
             "totals": tot,
             "ranking_rule": "Road km under alert High, then Moderate (worst day of the forecast), then located historical events and seed incidents within 5 km, then terrain-screened release hotspots, then glacier area in the corridor.",
             "top_roads": [{k: p.get(k) for k in ("exposure_rank", "road_id", "name", "road_class", "length_km", "km_by_alert", "historical_events", "seed_incidents", "release_hotspots", "glaciers", "glacier_area_km2", "settlements_in_corridor", "max_snowfall_3d_mm", "lon", "lat")} for p in ranked[:15]]}
    stats_p.write_text(json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8")
    kb = lambda f: round((OUT / f).stat().st_size / 1024)
    print(f"built in {time.time() - t0:.1f} s: {len(feats)} roads, {stats['road_length_km']} km, corridor {stats['corridor_area_km2']} km2")
    print(f"  files: corridor {kb('road_corridor_5km.geojson')} KB, centrelines {kb('road_centrelines.geojson')} KB")
    print("  totals:", json.dumps({k: v for k, v in tot.items() if not k.endswith('_list') and k != 'settlement_names'}))
    for p in ranked[:6]: print(f"  #{p['exposure_rank']} {p['name'][:46]:46s} {p['road_class']:9s} {p['length_km']:7.1f} km  alert km {p['km_by_alert']}  events {p['historical_events']}  hotspots {p['release_hotspots']}  glaciers {p['glaciers']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
