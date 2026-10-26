"""Builds the Batura 1974 terrain panel for the home page's Historical Overview from the supplied notebook GeoTIFFs.

Usage (system Python with numpy + Pillow):  python scripts/build_batura_panel.py

Reads   static/history/batura_1974/3d/{dem_m,slope_deg,aspect_deg,release_zone}.tif   (EPSG:4326, ~120 m cells, as exported)
Writes  static/history/batura_1974/panel/relief.png   shaded relief of the crop, 6x bicubic upsample (display only)
        static/history/batura_1974/panel/panel.json   crop bounds, cell size, elevation / slope / aspect grids and the release-zone
                                                       cells, all copied from the GeoTIFFs (rounded), nothing interpolated or added.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "static" / "history" / "batura_1974"
SRC, OUT = ROOT / "3d", ROOT / "panel"
CROP = (74.50, 36.40, 74.78, 36.56)       # lon/lat window: release slope, modelled path and the supplied glacier reference point
UP = 6                                     # display upsampling of the relief image


def read(name):
    im = Image.open(SRC / f"{name}.tif")
    sx, sy = im.tag_v2[33550][:2]
    tie = im.tag_v2[33922]
    return np.asarray(im).astype(np.float64), (tie[3], tie[4], sx, sy)   # west, north, deg per col, deg per row


def main():
    dem, (w0, n0, sx, sy) = read("dem_m")
    slope, _ = read("slope_deg")
    aspect, _ = read("aspect_deg")
    zone, _ = read("release_zone")
    c0, c1 = int(round((CROP[0] - w0) / sx)), int(round((CROP[2] - w0) / sx))
    r0, r1 = int(round((n0 - CROP[3]) / sy)), min(dem.shape[0], int(round((n0 - CROP[1]) / sy)))
    sl = (slice(r0, r1), slice(c0, c1))
    E, S, A, Z = dem[sl], slope[sl], aspect[sl], zone[sl]
    h, w = E.shape
    bounds = [w0 + c0 * sx, n0 - r1 * sy, w0 + c1 * sx, n0 - r0 * sy]   # W, S, E, N of the cell edges

    # shaded relief (display only): bicubic upsample of the DEM, Horn hillshade lit from the NW, dark alpine palette
    big = np.asarray(Image.fromarray(E.astype(np.float32)).resize((w * UP, h * UP), Image.BICUBIC)).astype(np.float64)
    cell_x = sx * 111320 * np.cos(np.radians((CROP[1] + CROP[3]) / 2)) / UP
    cell_y = sy * 110574 / UP
    gy, gx = np.gradient(big, cell_y, cell_x)
    slope_r = np.arctan(np.hypot(gx, gy))
    aspect_r = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(42)
    shade = np.clip(np.sin(alt) * np.cos(slope_r) + np.cos(alt) * np.sin(slope_r) * np.cos(az - aspect_r), 0, 1)
    t = np.clip((big - 2400) / (7700 - 2400), 0, 1)[..., None]
    low, high = np.array([22, 34, 52]), np.array([214, 226, 240])          # slate valley floor -> ice-grey summits
    base = low * (1 - t) + high * t
    rgb = base * (0.35 + 0.75 * shade[..., None])
    rgb = np.clip(rgb * np.array([0.92, 0.98, 1.06]), 0, 255).astype(np.uint8)  # slight cold tint
    OUT.mkdir(exist_ok=True)
    Image.fromarray(rgb).save(OUT / "relief.png", optimize=True)

    zc = [[int(c), int(r)] for r, c in zip(*np.nonzero(Z > 0))]
    cell_km2 = (sx * 111320 * np.cos(np.radians(36.44))) * (sy * 110574) / 1e6
    panel = {
        "source": "Batura_1974_08_09_avalanche_outputs/3D_files GeoTIFFs (Copernicus DEM grid, EPSG:4326), cropped; values rounded",
        "bounds": [round(b, 6) for b in bounds], "w": w, "h": h, "deg": [sx, sy], "up": UP,
        "elev": np.round(E).astype(int).ravel().tolist(),
        "slope": np.round(S).astype(int).ravel().tolist(),
        "aspect": np.round(A).astype(int).ravel().tolist(),
        "zone": zc, "zone_cells_total": int((zone > 0).sum()), "zone_area_km2": round(int((zone > 0).sum()) * cell_km2, 2),
    }
    (OUT / "panel.json").write_text(json.dumps(panel, separators=(",", ":")), encoding="utf-8")
    print(f"crop {w} x {h} cells, zone cells in crop {len(zc)} of {panel['zone_cells_total']}, zone area {panel['zone_area_km2']} km2")


if __name__ == "__main__":
    main()
