"""Import a Hindu Kush avalanche-terrain screening run into the portal.

Usage:
    python scripts/build_hk_screening.py <run folder containing avalanche_hotspots.csv>

The run folder is the unzipped output of the Hindu Kush Colab notebook
(e.g. hindukush_avalanche_risk_20261015_0939/hindukush_avalanche_risk). It writes:

  data/screening/hk_hotspots.geojson   every very-high release area (point = area centroid)
  data/screening/hk_tiles.geojson      per-tile class shares (point = tile centre)
  data/screening/hk_run.json           thresholds, class areas, run time, overlay bounds
  static/img/hindukush/hk_classes.png  class overlay georeferenced from 01_avalanche_risk_map.png
  static/img/hindukush/*.jpg           the run's figures, unchanged apart from format

No value is invented: the overlay is the run's own figure re-sampled onto Web Mercator, with
everything that is not a class colour (hillshade, labels, hotspot circles) made transparent.
"""
from __future__ import annotations

import csv
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DATA = ROOT / "data" / "screening"
OUT_IMG = ROOT / "static" / "img" / "hindukush"

# Class colours exactly as in the run's settings_used.json; the figure draws them at ~90 % opacity
# over grey hillshade, so the figure colour of each class is matched against that blend.
CLASSES = [("low", "#ffffb2"), ("moderate", "#fecc5c"), ("high", "#fd8d3c"), ("very_high", "#bd0026"),
           ("runout", "#8c6bb1")]
# The figure's "winter snow, not steep enough" class (#dbebf7) cannot be told apart from the
# semi-transparent white label boxes, so it is left out of the overlay rather than guessed.
FIG_ALPHA = 0.9
MATCH_TOL = 38          # max RGB distance to a class colour (anything else becomes transparent)


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


def ticks(line, axis_len):
    """Centres of 2-px dark tick marks along one row/column of the figure."""
    xs = np.where(line)[0]
    groups, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] <= 1:
            cur.append(x)
        else:
            groups.append(cur); cur = [x]
    groups.append(cur)
    return [float(np.mean(g)) for g in groups]


def georeference(fig: Path):
    """Locate the axes frame and the tick marks of the matplotlib map; return image + affine."""
    a = np.asarray(Image.open(fig).convert("RGB")).astype(int)
    dark = a.sum(2) < 300
    H, W = dark.shape
    rows = [y for y in range(H) if dark[y].sum() > 0.6 * W]
    cols = [x for x in range(W) if dark[:, x].sum() > 0.6 * H]
    top, bottom, left, right = min(rows), max(rows), min(cols), max(cols)
    xt = ticks(dark[bottom + 3, left:right], right - left)
    yt = ticks(dark[top:bottom, left - 4], bottom - top)
    xt = [left + t for t in xt]
    yt = [top + t for t in yt]
    return a, (top, bottom, left, right), xt, yt


def build_overlay(run: Path):
    fig = run / "01_avalanche_risk_map.png"
    a, (top, bottom, left, right), xt, yt = georeference(fig)
    # The run figure labels ticks every 0.5 degrees: 71.5 .. 74.0 E and 37.0 .. 35.0 N.
    lon_ticks = [71.5 + 0.5 * i for i in range(len(xt))]
    lat_ticks = [37.0 - 0.5 * i for i in range(len(yt))]
    kx, bx = np.polyfit(xt, lon_ticks, 1)
    ky, by = np.polyfit(yt, lat_ticks, 1)
    res_x = max(abs(np.polyval([kx, bx], xt) - lon_ticks))
    res_y = max(abs(np.polyval([ky, by], yt) - lat_ticks))

    # Inner plotting area (inside the 2-px frame); pixel centres -> lon/lat.
    x0, x1, y0, y1 = left + 2, right - 2, top + 2, bottom - 2
    crop = a[y0:y1 + 1, x0:x1 + 1].astype(float)
    w_ = (x1 - x0 + 1)
    west, east = float(np.polyval([kx, bx], x0 - 0.5)), float(np.polyval([kx, bx], x1 + 0.5))
    north, south = float(np.polyval([ky, by], y0 - 0.5)), float(np.polyval([ky, by], y1 + 0.5))

    # Classify every pixel against the blended class colours (blend with its own grey level).
    grey = crop.mean(2, keepdims=True)
    best_d = np.full(crop.shape[:2], 1e9)
    best_k = np.full(crop.shape[:2], -1)
    for k, (_, hx) in enumerate(CLASSES):
        c = hex_rgb(hx)
        # Solve per pixel for the background grey g in  pix = A*c + (1-A)*g,  then measure the fit.
        g = np.clip((crop - FIG_ALPHA * c).mean(2, keepdims=True) / (1 - FIG_ALPHA), 0, 255)
        d = np.sqrt(((crop - (FIG_ALPHA * c + (1 - FIG_ALPHA) * g)) ** 2).sum(2))
        better = d < best_d
        best_d[better], best_k[better] = d[better], k
    chroma = crop.max(2) - crop.min(2)
    keep = (best_d < MATCH_TOL) & (chroma > 14)
    rgba = np.zeros(crop.shape[:2] + (4,), np.uint8)
    for k, (_, hx) in enumerate(CLASSES):
        m = keep & (best_k == k)
        rgba[m, :3] = hex_rgb(hx).astype(np.uint8)
        rgba[m, 3] = 255

    # Resample rows from equirectangular (linear in latitude) to Web Mercator (linear in y).
    merc = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    m_n, m_s = merc(north), merc(south)
    out_h = rgba.shape[0]
    lats = [math.degrees(2 * math.atan(math.exp(m_n + (m_s - m_n) * (r + 0.5) / out_h)) - math.pi / 2) for r in range(out_h)]
    src_rows = np.clip(((north - np.array(lats)) / (north - south) * rgba.shape[0]).astype(int), 0, rgba.shape[0] - 1)
    rgba = rgba[src_rows]

    OUT_IMG.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(OUT_IMG / "hk_classes.png", optimize=True)
    counts = {name: int((keep & (best_k == k)).sum()) for k, (name, _) in enumerate(CLASSES)}
    return {
        "image": "/static/img/hindukush/hk_classes.png",
        "coordinates": [[round(west, 5), round(north, 5)], [round(east, 5), round(north, 5)],
                        [round(east, 5), round(south, 5)], [round(west, 5), round(south, 5)]],
        "pixel_deg": [round(float(abs(kx)), 6), round(float(abs(ky)), 6)],
        "tick_fit_residual_deg": round(float(max(res_x, res_y)), 5),
        "width_px": int(w_), "height_px": int(out_h), "pixels_by_class": counts,
        "note": ("Display layer re-sampled from the run figure 01_avalanche_risk_map.png "
                 f"(about {abs(ky) * 111320:.0f} m per pixel N-S; the model itself is 30 m). "
                 "Spots under the figure's labels, hotspot circles, north arrow and scale bar are blank, and the "
                 "'winter snow, not steep enough' class is not reproduced (indistinguishable from label boxes)."),
    }


def num(v, cast=float):
    try:
        return cast(v)
    except (TypeError, ValueError):
        return None


def main(run: Path):
    settings = json.loads((run / "settings_used.json").read_text(encoding="utf-8"))
    readme = (run / "README.txt").read_text(encoding="utf-8")
    gen = re.search(r"Generated:\s*([\d-]+ [\d:]+)", readme)

    hotspots = []
    with open(run / "avalanche_hotspots.csv", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            lon, lat = round(float(r["lon"]), 5), round(float(r["lat"]), 5)
            hotspots.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                             "properties": {"rank": int(r["rank"]), "tile_id": r["tile_id"],
                                            "area_ha": num(r["area_ha"]), "mean_elev_m": num(r["mean_elev_m"], int),
                                            "mean_slope_deg": num(r["mean_slope_deg"]), "max_score": num(r["max_score"]),
                                            "facing": r["facing"]}})
    hotspots.sort(key=lambda f: f["properties"]["rank"])

    tiles, class_km2 = [], dict.fromkeys(["low", "moderate", "high", "very_high", "runout"], 0.0)
    with open(run / "tile_risk_summary.csv", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            sh = {k: float(r[f"share_{k}"]) for k in class_km2}
            vh_ha = float(r["very_high_area_ha"])
            # Tile area follows from very-high hectares / very-high share (both from the run).
            tile_km2 = vh_ha / 100 / sh["very_high"] if sh["very_high"] > 0 else None
            if tile_km2:
                for k in class_km2:
                    class_km2[k] += sh[k] * tile_km2
            tiles.append({"type": "Feature",
                          "geometry": {"type": "Point", "coordinates": [float(r["lon_center"]), float(r["lat_center"])]},
                          "properties": {"tile_id": r["tile_id"], **{f"share_{k}": v for k, v in sh.items()},
                                         "share_high_or_very_high": round(sh["high"] + sh["very_high"], 4),
                                         "very_high_area_ha": vh_ha, "tile_area_km2": round(tile_km2, 1) if tile_km2 else None,
                                         "max_score": num(r["max_score"]),
                                         "hotspots": sum(1 for h in hotspots if h["properties"]["tile_id"] == r["tile_id"])}})

    OUT_DATA.mkdir(parents=True, exist_ok=True)
    src = f"Hindu Kush avalanche-terrain screening run {run.parent.name}"
    for name, feats in (("hk_hotspots", hotspots), ("hk_tiles", tiles)):
        (OUT_DATA / f"{name}.geojson").write_text(json.dumps(
            {"type": "FeatureCollection", "name": name, "source": src, "features": feats},
            separators=(",", ":")), encoding="utf-8")

    overlay = build_overlay(run)
    areas = [h["properties"]["area_ha"] for h in hotspots]
    run_meta = {
        "run_id": run.parent.name, "generated": gen.group(1) if gen else None,
        "method": "Rule-based screening: score = slope x elevation x aspect x shape, each 0-1, on winter-snow / glacier terrain only.",
        "inputs": "Copernicus GLO-30 DEM (30 m), MODIS MOD10A1 winter snow 2015-2025, GLIMS glaciers",
        "score_type": "screening_index",
        "classes": [{"id": "low", "label": "Low", "range": "0.05-0.25", "color": "#ffffb2"},
                    {"id": "moderate", "label": "Moderate", "range": "0.25-0.45", "color": "#fecc5c"},
                    {"id": "high", "label": "High", "range": "0.45-0.65", "color": "#fd8d3c"},
                    {"id": "very_high", "label": "Very high", "range": "0.65+", "color": "#bd0026"},
                    {"id": "runout", "label": "Runout", "range": "gentle ground (<20°) within 1 km below a release zone", "color": "#8c6bb1"},
                    {"id": "snow", "label": "Winter snow, not steep enough", "range": "", "color": "#dbebf7", "in_overlay": False}],
        "class_area_km2": {k: round(v) for k, v in class_km2.items()},
        "tiles": len(tiles), "hotspots": len(hotspots),
        "hotspot_area_ha_total": round(sum(areas), 1),
        "hotspot_min_ha": settings.get("hotspot_min_ha"),
        "not_included": "Forest cover, ground roughness, glacier snout / snow-line bands (no data in the inputs).",
        "validation": "Not validated against observed avalanches. Thresholds are approximate (Hindu Kush Avalanche Terrain Thresholds).",
        "settings": settings, "overlay": overlay,
    }
    (OUT_DATA / "hk_run.json").write_text(json.dumps(run_meta, indent=1), encoding="utf-8")

    for src_name, dst in (("01_avalanche_risk_map.png", "risk_map.jpg"), ("02_risk_charts.png", "risk_charts.jpg"),
                          ("03_top4_hotspots_zoom.png", "top4_zoom.jpg"), ("04_top10_hotspots_table.png", "top10_table.jpg")):
        p = run / src_name
        if p.exists():
            Image.open(p).convert("RGB").save(OUT_IMG / dst, quality=88, optimize=True)

    print(f"{len(hotspots)} hotspots, {len(tiles)} tiles, class km2 {run_meta['class_area_km2']}")
    print(f"overlay {overlay['width_px']}x{overlay['height_px']} px, tick residual {overlay['tick_fit_residual_deg']} deg, "
          f"bounds {overlay['coordinates'][0]} -> {overlay['coordinates'][2]}")
    print("pixels by class", overlay["pixels_by_class"])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]).resolve())
