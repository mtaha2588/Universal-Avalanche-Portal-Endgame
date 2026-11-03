"""Builds forecast/data/tile_thresholds.csv: the 0.25 deg tile grid the alert engine (forecast_core.py) needs,
across the four regions forecast_core.region() recognises (Hindu Kush, Kohistan-Hazara, Kashmir, Karakoram).

Two honestly different things go into this one file:

1. tile_id, lat, lon, elev_approx_m -- REAL. Sampled from the portal's own Copernicus GLO-30 DEM tiles
   (data/dem/terrarium, zoom 12), the same source and method scripts/build_history_events.py uses for the
   historic avalanche paths. Every tile that falls inside the local DEM coverage and clears the elevation
   floor is kept.

2. MODERATE_*/HIGH_* threshold columns -- NOT calibrated. forecast_core.py's own rule is written for "the
   tile's own ERA5 winter percentile" (step 3 of the analysis pipeline, 57 winters of reanalysis). That
   calibration is not in this repo and cannot be reproduced here: the daily ERA5 time series it needs is not
   supplied, only seasonal summaries (data/climate/era5_winter.json). Fabricating per-tile percentiles from
   the wrong timescale would misrepresent the method, so every tile gets the SAME fixed, literature-typical
   storm/warm-snow threshold instead (see THRESHOLDS_NOTE.md) -- a clearly labelled placeholder, not a model
   output. See data/predictions/README.md for the same "nothing invented" rule applied elsewhere in this
   project. Replacing this file with the analysis team's real per-tile percentiles (same columns) switches
   the whole engine over with no code change.

Usage (needs numpy + Pillow):  python build_tile_grid.py
"""
import json, math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]          # project root (forecast/data/.. -> forecast -> root)
DEM = ROOT / "data" / "dem" / "terrarium" / "12"
OUT_DIR = Path(__file__).resolve().parent
Z = 12
# Same bounding box as the portal's own 3D map and glacier-system layers (templates/home.html bgMap bounds).
LON0, LON1, LAT0, LAT1 = 69.5, 78.2, 33.0, 37.3
MIN_ELEV_M = 1200                                     # forecast_core.DEFAULTS["min_elev_m"]: below this, "not rated"
KEEP_FLOOR_M = 900                                    # kept a bit lower than MIN_ELEV_M so "not rated" tiles are visible, honestly

# PREVIEW thresholds: fixed, literature-typical avalanche storm-loading / warm-snow trigger values (not tile-specific
# ERA5 percentiles -- see the module docstring and THRESHOLDS_NOTE.md). mm = mm water equivalent, roughly cm of new
# snow / 1.0-1.3 depending on density; gust in m/s; Tmax rise in deg C over 3 days.
THRESH = {
    "MODERATE_sf3d_mm": 25, "HIGH_sf3d_mm": 45,
    "MODERATE_gust3d_ms": 15, "HIGH_gust3d_ms": 20,
    "MODERATE_tmax_rise3d_c": 6, "HIGH_tmax_rise3d_c": 8,
    "MODERATE_sf7d_mm": 20, "HIGH_sf7d_mm": 35,
}


def tx(lon): return (lon + 180) / 360 * (1 << Z)
def ty(lat): return (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * (1 << Z)


_cache = {}
def dem_tile(x, y):
    key = (x, y)
    if key not in _cache:
        p = DEM / str(x) / f"{y}.png"   # DEM already includes the zoom-12 folder
        _cache[key] = np.asarray(Image.open(p).convert("RGB"), np.float32) if p.exists() else None
    return _cache[key]


def elevation(lon, lat):
    """Bilinear-sampled terrarium elevation at one point, or None if outside the local DEM coverage."""
    px, py = tx(lon) * 256 - 0.5, ty(lat) * 256 - 0.5
    x0, y0 = int(math.floor(px)), int(math.floor(py))
    fx, fy = px - x0, py - y0
    vals, ok = [], True
    for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
        X, Y = x0 + dx, y0 + dy
        tX, tY = X // 256, Y // 256
        t = dem_tile(tX, tY)
        if t is None:
            ok = False; break
        a = t[Y - tY * 256, X - tX * 256]
        vals.append(a[0] * 256 + a[1] + a[2] / 256 - 32768)
    if not ok:
        return None
    v00, v10, v01, v11 = vals
    return float((v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy)


def region(lat, lon):
    if lon < 72.8: return "Hindu Kush (Chitral-Dir-Swat)"
    if lon < 73.6: return "Kohistan-Hazara"
    if lat < 35.1: return "Kashmir (Neelum-Leepa-Astore)"
    return "Karakoram (Gilgit-Baltistan)"


def main():
    rows = []
    lat = LAT0 + 0.125
    while lat < LAT1:
        lon = LON0 + 0.125
        while lon < LON1:
            e = elevation(lon, lat)
            if e is not None and e >= KEEP_FLOOR_M:
                rows.append((lat, lon, round(e)))
            lon += 0.25
        lat += 0.25

    with open(OUT_DIR / "tile_thresholds.csv", "w", encoding="utf-8", newline="") as f:
        cols = ["tile_id", "elev_approx_m", "region"] + list(THRESH)
        f.write(",".join(cols) + "\n")
        for la, lo, e in rows:
            tid = f"N{la:.3f}_E{lo:.3f}"
            f.write(",".join([tid, str(e), region(la, lo)] + [str(v) for v in THRESH.values()]) + "\n")

    rated = sum(1 for _, _, e in rows if e >= MIN_ELEV_M)
    meta = {"calibrated": False, "tile_count": len(rows), "tiles_rated": rated,
            "tiles_not_rated": len(rows) - rated, "min_elev_m": MIN_ELEV_M,
            "note": ("PREVIEW thresholds: the same fixed storm / warm-snow trigger values are used for every tile "
                     "(not the tile's own ERA5 winter percentile, which forecast_core.py's rule is written for). "
                     "The elevation grid is real, sampled from this portal's own Copernicus GLO-30 DEM. Replace "
                     "data/tile_thresholds.csv with the analysis team's calibrated per-tile file (same columns) "
                     "to activate the operational rule -- no code change needed."),
            "thresholds": THRESH}
    (OUT_DIR / "thresholds_meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"{len(rows)} tiles ({rated} rated, {len(rows) - rated} below {MIN_ELEV_M} m) -> tile_thresholds.csv")


if __name__ == "__main__":
    main()
