"""Download the open terrain elevation tiles the portal's 3D maps use, so they are served locally (no wait for terrain depth).

    python scripts/fetch_dem.py            -> data/dem/terrarium/{z}/{x}/{y}.png  (6,658 tiles, about 400 MB)
    python scripts/fetch_dem.py --dry-run  -> only count the tiles

Source: Terrain Tiles on AWS Open Data (Mapzen / Tilezen "terrarium" PNG encoding), mostly SRTM over this area; zoom 12 is about
30 m per pixel at 35° N, the native SRTM resolution. Open data that may be stored and redistributed with attribution:
https://registry.opendata.aws/terrain-tiles/ and https://github.com/tilezen/joerd/blob/master/docs/attribution.md
The server falls back to the same public tiles for anything outside these areas (app.py, /api/dem/...).
Mapbox tiles are NOT downloaded: Mapbox's terms forbid bulk download and permanent storage.
Re-running skips tiles already on disk.
"""
from __future__ import annotations

import math
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SOURCE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OUT = Path(__file__).resolve().parent.parent / "data" / "dem" / "terrarium"
# (west, south, east, north, max zoom)
AREAS = [
    (70.5, 33.9, 77.7, 37.6, 12),   # the three glacier systems with a margin for low, pitched camera views
    (60.8, 23.6, 77.9, 37.1, 9),    # all of Pakistan, for the country-wide views
]


def tile_x(lon: float, z: int) -> int:
    return int((lon + 180) / 360 * 2 ** z)


def tile_y(lat: float, z: int) -> int:
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z)


def tiles() -> list[tuple[int, int, int]]:
    out = set()
    for w, s, e, n, maxz in AREAS:
        for z in range(maxz + 1):
            for x in range(tile_x(w, z), tile_x(e, z) + 1):
                for y in range(tile_y(n, z), tile_y(s, z) + 1):
                    out.add((z, x, y))
    return sorted(out)


def fetch(t: tuple[int, int, int]) -> int:
    z, x, y = t
    path = OUT / str(z) / str(x) / f"{y}.png"
    if path.exists() and path.stat().st_size > 0:
        return 0
    for attempt in range(4):
        try:
            req = urllib.request.Request(SOURCE.format(z=z, x=x, y=y), headers={"User-Agent": "pak-avalanche-portal/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(path)
            return len(data)
        except Exception as exc:  # network hiccup: retry with back-off
            if attempt == 3:
                print(f"failed {z}/{x}/{y}: {exc}", file=sys.stderr)
                return -1
            time.sleep(2 ** attempt)
    return -1


def main() -> None:
    todo = tiles()
    print(f"{len(todo):,} tiles (zoom 0-{max(a[4] for a in AREAS)})")
    if "--dry-run" in sys.argv:
        return
    got = failed = done = 0
    with ThreadPoolExecutor(max_workers=16) as pool:
        for n in pool.map(fetch, todo):
            done += 1
            if n < 0:
                failed += 1
            else:
                got += n
            if done % 250 == 0 or done == len(todo):
                print(f"  {done:,}/{len(todo):,}  downloaded {got / 1e6:.0f} MB  failed {failed}", flush=True)
    print(f"Done: {OUT}" + (f"  ({failed} failed; run again to retry)" if failed else ""))


if __name__ == "__main__":
    main()
