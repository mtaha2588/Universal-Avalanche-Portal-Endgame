"""Pakistan study area for the home-page glacier map.

Usage:
    python scripts/build_study_area.py <rgi2000-v7.0-g-14_south_asia_west.zip | .shp>
    (system Python: geopandas, shapely, pyproj)

Nothing here is drawn by hand. Inputs are the portal's own boundary file and the official RGI v7.0 shapefile:

  study area = union of the province / territory polygons in data/boundaries/pakistan_boundaries.geojson
               (Natural Earth 1:10m, Pakistan view). This is the Pakistan-administered area, including
               Gilgit-Baltistan and Azad Jammu & Kashmir. India-administered Jammu & Kashmir, Siachen and the
               Shaksgam Valley are not part of it.

Writes:
  data/boundaries/study_area.geojson          study-area polygon, a mask of everything outside it, and the official
                                              Pakistan outline split into 'international' and 'claim' segments
                                              (claim = edge of the official outline around India-administered
                                              disputed territory; drawn dashed, never as a settled border)
  data/glaciers/rgi7_pakistan.geojson         RGI outlines clipped to the study area, with RGI attributes
  data/glaciers/rgi7_context.geojson          RGI outlines not wholly inside the study area (optional grey context)
  data/glaciers/rgi7_system_extents_pk.geojson   glacier-system envelopes clipped to the study area
  data/glaciers/rgi7_major_glaciers_pk.geojson   major named glaciers with an in_study_area flag
  data/glaciers/pakistan_summary.json         per-system counts, areas, elevation range, outline dates
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
BND = ROOT / "data" / "boundaries"
GLA = ROOT / "data" / "glaciers"
NAMES = {"14-01": "Hindu Kush", "14-02": "Karakoram", "14-03": "West Himalaya"}
RGI_SRC = "RGI 7.0 Consortium (2023). Randolph Glacier Inventory v7.0, Region 14 South Asia West. NSIDC, doi:10.5067/F6JMOVY5NAVZ"
EQUAL_AREA = "EPSG:6933"          # WGS 84 / NSIDC EASE-Grid 2.0 Global (equal area) for clipped-area ratios


def rnd(geom):
    """GeoJSON geometry with coordinates rounded to ~10 m, as in build_glaciers.py."""
    g = mapping(geom)

    def r(c):
        return [round(c[0], 4), round(c[1], 4)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


def polys_only(geom):
    """Keep polygonal parts only (clipping can leave stray lines or points on the border)."""
    if geom.is_empty:
        return geom
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [p for p in getattr(geom, "geoms", []) if p.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(parts) if parts else shapely.Polygon()


def num(v, nd=None):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    return round(float(v), nd) if nd is not None else int(round(float(v)))


def write(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote", path.relative_to(ROOT), f"{path.stat().st_size / 1e6:.2f} MB")


def main(src: Path):
    # ------------------------------------------------------------ study area and borders
    bfc = json.loads((BND / "pakistan_boundaries.geojson").read_text(encoding="utf-8"))
    feats = bfc["features"]
    provinces = [shape(f["geometry"]) for f in feats if f["properties"]["layer"] == "province"]
    study = unary_union(provinces).buffer(0)
    pak = next(shape(f["geometry"]) for f in feats if f["properties"]["layer"] == "pakistan")
    # Territory inside the official outline that Pakistan does not administer: India-administered J&K, Junagadh, Siachen.
    claims = unary_union([shape(f["geometry"]) for f in feats if f["properties"]["layer"] == "disputed"
                          and ((f["properties"].get("note") or "").startswith("Admin. by India") or f["properties"]["name"] == "Siachen Glacier")])
    zone = claims.buffer(0.002)
    border = pak.boundary
    claim_lines = border.intersection(zone)
    intl_lines = border.difference(zone)
    mask = box(-179.9, -85.0, 179.9, 85.0).difference(study)   # whole map, so no visible edge
    shapely.prepare(study)
    study_km2 = gpd.GeoSeries([study], crs="EPSG:4326").to_crs(EQUAL_AREA).area.iloc[0] / 1e6
    print(f"study area {study_km2:,.0f} km2 (union of {len(provinces)} provinces / territories)")

    # ------------------------------------------------------------ RGI outlines
    path = f"zip://{src}!RGI2000-v7.0-G-14_south_asia_west.shp" if src.suffix == ".zip" else str(src)
    g = gpd.read_file(path)
    g = g[g["o2region"].isin(NAMES)].copy()
    g["system"] = g["o2region"].map(NAMES)
    g["geometry"] = g.geometry.simplify(0.0003, preserve_topology=True)
    g = g[~g.geometry.is_empty & g.geometry.notna()].reset_index(drop=True)
    print("RGI outlines", len(g), "columns:", ", ".join(c for c in g.columns if c != "geometry"))

    inter = g.geometry.intersects(study)
    within = g.geometry.within(study)
    part = inter & ~within
    clipped = g.geometry.copy()
    clipped[part] = [polys_only(x) for x in shapely.intersection(g.geometry[part].values, study)]
    full_eq = g.geometry[part].to_crs(EQUAL_AREA).area
    clip_eq = gpd.GeoSeries(clipped[part], crs="EPSG:4326").to_crs(EQUAL_AREA).area
    pd_ratio = (clip_eq / full_eq).clip(0, 1)
    print(f"inside {int(within.sum())}, crossing the study-area edge {int(part.sum())}, outside {int((~inter).sum())}")

    def props(i, row, area_pk, is_clipped):
        name = row.get("glac_name")
        name = None if name is None or (isinstance(name, float) and np.isnan(name)) or not str(name).strip() else str(name).strip()
        return {
            "rgi_id": row["rgi_id"], "name": name, "system": row["system"], "o2region": row["o2region"],
            "area_km2": num(row["area_km2"], 4), "area_pk_km2": round(area_pk, 4), "clipped": int(is_clipped),
            "lon": num(row.get("cenlon"), 4), "lat": num(row.get("cenlat"), 4),
            "zmin_m": num(row.get("zmin_m")), "zmed_m": num(row.get("zmed_m")), "zmax_m": num(row.get("zmax_m")),
            "slope_deg": num(row.get("slope_deg"), 1), "aspect_sec": num(row.get("aspect_sec")), "lmax_m": num(row.get("lmax_m")),
            "term_type": num(row.get("term_type")), "src_date": str(row.get("src_date") or "")[:10] or None,
        }

    inside, context = [], []
    for i, row in g.iterrows():
        if inter[i]:
            is_clip = bool(part[i])
            area_pk = float(row["area_km2"]) * (float(pd_ratio[i]) if is_clip else 1.0)
            geom = clipped[i]
            if not geom.is_empty and area_pk > 0:
                inside.append({"type": "Feature", "geometry": rnd(geom), "properties": props(i, row, area_pk, is_clip)})
        if not within[i]:
            context.append({"type": "Feature", "geometry": rnd(row.geometry), "properties": {
                "rgi_id": row["rgi_id"], "system": row["system"], "area_km2": num(row["area_km2"], 3),
                "partly_inside": int(bool(inter[i]))}})

    meta_in = {"source": RGI_SRC, "crs": "EPSG:4326", "study_area": "Pakistan-administered area (union of provinces and territories, Natural Earth 1:10m Pakistan view)",
               "note": "RGI v7.0 outlines clipped to the study area. area_km2 is the official RGI area of the whole glacier; area_pk_km2 is the part inside the study area (equal-area ratio).",
               "feature_count": len(inside)}
    write(GLA / "rgi7_pakistan.geojson", {"type": "FeatureCollection", "metadata": meta_in, "features": inside})
    write(GLA / "rgi7_context.geojson", {"type": "FeatureCollection", "metadata": {
        "source": RGI_SRC, "crs": "EPSG:4326", "note": "Whole RGI v7.0 outlines not wholly inside the study area (context only).",
        "feature_count": len(context)}, "features": context})

    # ------------------------------------------------------------ system envelopes, majors, summary
    ext = json.loads((GLA / "rgi7_system_extents.geojson").read_text(encoding="utf-8"))
    ins = gpd.GeoDataFrame.from_features(inside, crs="EPSG:4326")
    systems, ext_out = {}, []
    for f in ext["features"]:
        n = f["properties"]["name"]
        clip = polys_only(shape(f["geometry"]).intersection(study))
        s = ins[ins.system == n]
        rgi = g[g.system == n]
        dates = sorted(d for d in s.src_date.dropna() if d)
        named = s[s["name"].notna()].sort_values("area_pk_km2", ascending=False)
        c = clip.representative_point() if not clip.is_empty else None
        systems[n] = {
            "o2region": f["properties"]["o2region"], "n": int(len(s)), "km2": round(float(s.area_pk_km2.sum()), 1),
            "rgi_n": int(len(rgi)), "rgi_km2": round(float(rgi.area_km2.sum()), 1),
            "zmin_m": num(s.zmin_m.min()), "zmax_m": num(s.zmax_m.max()),
            "dates": [dates[0], dates[-1]] if dates else None,
            "largest_named": None if named.empty else {"name": named.iloc[0]["name"], "km2": round(float(named.iloc[0].area_pk_km2), 1)},
            "center": [round(c.x, 4), round(c.y, 4)] if c else None,
        }
        props = dict(f["properties"], glaciers=systems[n]["n"], glacier_area_km2=systems[n]["km2"],
                     method=f["properties"]["method"] + "; then clipped to the Pakistan-administered study area")
        if not clip.is_empty:
            ext_out.append({"type": "Feature", "geometry": rnd(clip), "properties": props})
        print(f"{n:14s} {systems[n]['n']:6d} glaciers  {systems[n]['km2']:8.1f} km2 in study area  (RGI sub-region {systems[n]['rgi_n']}, {systems[n]['rgi_km2']} km2)")
    write(GLA / "rgi7_system_extents_pk.geojson", {"type": "FeatureCollection", "metadata": dict(ext.get("metadata", {}),
          note="Glacier-system envelopes clipped to the Pakistan-administered study area"), "features": ext_out})

    maj = json.loads((GLA / "rgi7_major_glaciers.geojson").read_text(encoding="utf-8"))
    for f in maj["features"]:
        f["properties"]["in_study_area"] = bool(study.contains(shape(f["geometry"])))
    out = [f["properties"]["name"] for f in maj["features"] if not f["properties"]["in_study_area"]]
    print("major glaciers outside the study area:", out)
    write(GLA / "rgi7_major_glaciers_pk.geojson", maj)

    write(BND / "study_area.geojson", {"type": "FeatureCollection", "metadata": {
        "source": "Derived from data/boundaries/pakistan_boundaries.geojson (Natural Earth 1:10m, Pakistan view)",
        "method": "study area = union of provinces and territories; border = official Pakistan outline split where it bounds India-administered disputed territory",
        "crs": "EPSG:4326"}, "features": [
        {"type": "Feature", "geometry": rnd(study), "properties": {"layer": "study_area", "name": "Pakistan-administered study area", "area_km2": round(study_km2)}},
        {"type": "Feature", "geometry": rnd(mask), "properties": {"layer": "mask", "name": "Outside the study area"}},
        {"type": "Feature", "geometry": rnd(intl_lines), "properties": {"layer": "border", "kind": "international", "name": "International boundary"}},
        {"type": "Feature", "geometry": rnd(claim_lines), "properties": {"layer": "border", "kind": "claim",
         "name": "Claimed boundary (disputed)", "note": "Edge of Pakistan's official outline around territory administered by India; final status disputed."}},
    ]})

    write(GLA / "pakistan_summary.json", {
        "study_area_km2": round(study_km2), "systems": systems,
        "total": {"n": sum(s["n"] for s in systems.values()), "km2": round(sum(s["km2"] for s in systems.values()), 1)},
        "outside_majors": out, "source": RGI_SRC,
        "note": "Counts and areas are for the Pakistan-administered study area only. A glacier crossing the study-area edge is counted once, with only its inside area.",
    })


if __name__ == "__main__":
    main(Path(sys.argv[1]))
