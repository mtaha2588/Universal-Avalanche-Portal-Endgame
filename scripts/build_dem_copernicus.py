"""Rebuild the glacier-system terrain tiles (zoom 10-12) from Copernicus GLO-30 instead of SRTM.

    python scripts/build_dem_copernicus.py <work folder>

Needs rasterio, numpy, Pillow (not in requirements.txt; use a scratch venv). Downloads the 1-degree Copernicus DEM
GLO-30 COGs that cover lon 70-78 E, lat 33-38 N (about 1 GB, kept in <work folder>/cop) and writes terrarium PNG tiles
(same encoding and paths as scripts/fetch_dem.py) into <work folder>/terrarium. Copy that folder over data/dem/terrarium
to use it. Zoom 0-9 (country view) stays as the SRTM-based AWS tiles.

Source: Copernicus DEM GLO-30 (ESA / Airbus), open on AWS: https://registry.opendata.aws/copernicus-dem/
Attribution (required): "Produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space
GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved."
Heights are orthometric metres (EGM2008), 1 arc-second (about 30 m) posts. No values are invented or smoothed here:
tiles are a straight resample of the published DEM to Web Mercator.
"""
from __future__ import annotations

import sys
import urllib.request
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.crs import CRS
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_dem import AREAS, tile_x, tile_y  # noqa: E402

BASE = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif"
ZOOMS = (10, 11, 12)
R = 6378137.0
ORIGIN = np.pi * R
WORK: Path


def tiles() -> list[tuple[int, int, int]]:
    w, s, e, n, _ = AREAS[0]
    return [(z, x, y) for z in ZOOMS for x in range(tile_x(w, z), tile_x(e, z) + 1) for y in range(tile_y(n, z), tile_y(s, z) + 1)]


def cog_name(lat: int, lon: int) -> Path:
    return WORK / "cop" / f"N{lat:02d}_E{lon:03d}.tif"


def download() -> None:
    w, s, e, n, _ = AREAS[0]
    for lat in range(int(s), int(n) + 1):
        for lon in range(int(w), int(e) + 1):
            dst = cog_name(lat, lon)
            if dst.exists() and dst.stat().st_size > 0:
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            try:
                urllib.request.urlretrieve(BASE.format(ns="N", lat=lat, ew="E", lon=lon), dst.with_suffix(".part"))
                dst.with_suffix(".part").replace(dst)
                print("downloaded", dst.name, dst.stat().st_size // 1_000_000, "MB", flush=True)
            except Exception as exc:  # a 1-degree cell with no data (e.g. all ocean) is simply absent
                print("skip", lat, lon, exc, flush=True)


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    size = 2 * ORIGIN / 2 ** z
    return (-ORIGIN + x * size, ORIGIN - (y + 1) * size, -ORIGIN + (x + 1) * size, ORIGIN - y * size)


def lonlat(bx: float, by: float) -> tuple[float, float]:
    return np.degrees(bx / R), np.degrees(2 * np.arctan(np.exp(by / R)) - np.pi / 2)


def encode(elev: np.ndarray) -> np.ndarray:
    v = np.clip(elev + 32768.0, 0, 65535.999)
    r = np.floor(v / 256)
    g = np.floor(v) % 256
    b = np.floor((v - np.floor(v)) * 256)
    return np.dstack([r, g, b]).astype(np.uint8)


def build(t: tuple[int, int, int]) -> int:
    z, x, y = t
    out = WORK / "terrarium" / str(z) / str(x) / f"{y}.png"
    if out.exists() and out.stat().st_size > 0:
        return 0
    bounds = tile_bounds(z, x, y)
    lon0, lat0 = lonlat(bounds[0], bounds[1])
    lon1, lat1 = lonlat(bounds[2], bounds[3])
    dst = np.full((256, 256), np.nan, dtype=np.float32)
    tr = from_bounds(*bounds, 256, 256)
    for lat in range(int(np.floor(lat0)), int(np.floor(lat1)) + 1):
        for lon in range(int(np.floor(lon0)), int(np.floor(lon1)) + 1):
            f = cog_name(lat, lon)
            if not f.exists():
                continue
            part = np.full((256, 256), np.nan, dtype=np.float32)
            with rasterio.open(f) as src:
                reproject(rasterio.band(src, 1), part, src_nodata=src.nodata, dst_transform=tr, dst_crs=CRS.from_epsg(3857),
                          dst_nodata=np.nan, resampling=Resampling.bilinear if z >= 12 else Resampling.average)
            m = ~np.isnan(part)
            dst[m] = part[m]
    if np.isnan(dst).all():
        return -1
    if np.isnan(dst).any():  # tile edge past the covered area: fill with the nearest valid height, never zero
        from scipy.ndimage import distance_transform_edt
        idx = distance_transform_edt(np.isnan(dst), return_distances=False, return_indices=True)
        dst = dst[tuple(idx)]
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(encode(dst)).save(out.with_suffix(".part"), format="PNG")
    out.with_suffix(".part").replace(out)
    return 1


def init(work: str) -> None:
    global WORK
    WORK = Path(work)


def main() -> None:
    global WORK
    WORK = Path(sys.argv[1]).resolve()
    if "--no-download" not in sys.argv:
        download()
    todo = tiles()
    print(f"{len(todo):,} tiles (zoom {ZOOMS[0]}-{ZOOMS[-1]})", flush=True)
    done = bad = 0
    with ProcessPoolExecutor(max_workers=6, initializer=init, initargs=(str(WORK),)) as pool:
        for r in pool.map(build, todo, chunksize=8):
            done += 1
            bad += r < 0
            if done % 250 == 0:
                print(f"{done:,}/{len(todo):,}  empty {bad}", flush=True)
    print(f"done: {done:,} tiles, {bad} without data")


if __name__ == "__main__":
    main()
