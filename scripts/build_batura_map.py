"""Places the Batura 1974 model tile on the real map: builds the files the Historical Overview's "On the map" view drapes on the
3D map of Pakistan, at the tile's own georeferenced position.

Usage (system Python with numpy + Pillow):  python scripts/build_batura_map.py

Reads   static/history/batura_1974/3d/{dem_m,release_zone}.tif   (EPSG:4326, PixelIsArea, 522 x 332 cells, as exported)
Writes  static/history/batura_1974/map/tile.png             shaded relief of the WHOLE model DEM tile, rows resampled from equal-latitude
                                                             to equal-Web-Mercator spacing (so a 4-corner image source sits exactly on its
                                                             cells), 2x bilinear upsample. Display only: elevations are not changed.
        static/history/batura_1974/map/tile.json            tile bounds (from the GeoTIFF tie point and pixel scale), grid size, cell
                                                             size, elevation range, source.
        static/history/batura_1974/map/release_zone.geojson one square polygon per release-zone cell (value 1), at its cell corners.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "static" / "history" / "batura_1974"
SRC, OUT = ROOT / "3d", ROOT / "map"
UP = 2


def read(name):
    im = Image.open(SRC / f"{name}.tif")
    sx, sy = im.tag_v2[33550][:2]
    tie = im.tag_v2[33922]
    return np.asarray(im).astype(np.float64), (tie[3], tie[4], sx, sy)   # west, north, deg per col, deg per row


def merc(lat):
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def shade(dem, sx, sy, lat):
    """Hillshade lit from 315 deg / 45 deg altitude on the real cell size, times a muted hypsometric tint."""
    dx = sx * 111320 * math.cos(math.radians(lat))
    dy = sy * 110540
    gy, gx = np.gradient(dem, dy, dx)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(45)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    hs = np.clip(hs, 0, 1)
    stops = [(2400, (92, 84, 70)), (3200, (122, 110, 92)), (4000, (150, 146, 138)), (4800, (190, 198, 210)),
             (5600, (226, 234, 244)), (7800, (250, 252, 255))]
    zs = np.array([s[0] for s in stops], float)
    rgb = np.stack([np.interp(dem, zs, [s[1][k] for s in stops]) for k in range(3)], -1)
    light = 0.35 + 0.85 * hs[..., None]
    return np.clip(rgb * light, 0, 255)


def main():
    dem, (w0, n0, sx, sy) = read("dem_m")
    zone, _ = read("release_zone")
    h, w = dem.shape
    e0, s0 = w0 + w * sx, n0 - h * sy
    OUT.mkdir(exist_ok=True)

    img = shade(dem, sx, sy, (n0 + s0) / 2)
    # Resample rows: output row j covers equal Web-Mercator steps between the north and south edges.
    H, W = h * UP, w * UP
    yn, ys = merc(n0), merc(s0)
    lat_out = np.degrees(2 * np.arctan(np.exp(yn + (np.arange(H) + 0.5) / H * (ys - yn))) - math.pi / 2)
    rows = (n0 - lat_out) / sy - 0.5
    cols = (np.arange(W) + 0.5) / UP - 0.5
    r0 = np.clip(np.floor(rows).astype(int), 0, h - 1); r1 = np.clip(r0 + 1, 0, h - 1); fr = np.clip(rows - r0, 0, 1)[:, None, None]
    c0 = np.clip(np.floor(cols).astype(int), 0, w - 1); c1 = np.clip(c0 + 1, 0, w - 1); fc = np.clip(cols - c0, 0, 1)[None, :, None]
    top = img[r0][:, c0] * (1 - fc) + img[r0][:, c1] * fc
    bot = img[r1][:, c0] * (1 - fc) + img[r1][:, c1] * fc
    out = (top * (1 - fr) + bot * fr).astype(np.uint8)
    Image.fromarray(out, "RGB").save(OUT / "tile.png", optimize=True)

    feats = []
    for r, c in zip(*np.nonzero(zone == 1)):
        x0, y0 = w0 + c * sx, n0 - r * sy
        ring = [[x0, y0], [x0 + sx, y0], [x0 + sx, y0 - sy], [x0, y0 - sy], [x0, y0]]
        feats.append({"type": "Feature", "properties": {"row": int(r), "col": int(c), "elev_m": round(float(dem[r, c]))},
                      "geometry": {"type": "Polygon", "coordinates": [[[round(a, 6), round(b, 6)] for a, b in ring]]}})
    (OUT / "release_zone.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))

    meta = {"source": "Batura_1974_08_09_avalanche_outputs/3D_files/dem_m.tif (Copernicus DEM grid, EPSG:4326, PixelIsArea)",
            "bounds": [round(w0, 6), round(s0, 6), round(e0, 6), round(n0, 6)], "cols": w, "rows": h,
            "cell_deg": [sx, sy], "cell_m": 120, "elev_min_m": round(float(dem.min())), "elev_max_m": round(float(dem.max())),
            "zone_cells": len(feats), "image": "tile.png", "image_rows": "Web Mercator spacing (resampled for display)"}
    (OUT / "tile.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
