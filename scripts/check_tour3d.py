"""Check the 3D Cinematic Tour against the avalanche inventory, field by field.

    python scripts/check_tour3d.py shown.json

shown.json is what the running 3D tour shows for every stop (window.T3.shown() in /tour3d, saved by the test). Each stop is compared with
  1. the tour's own data (data/history/events/avalanche_events_pakistan_compiled.csv), which must match exactly, and
  2. the inventory (forecast/pipeline/avalanche_events_master.csv), where every difference is listed (nothing is chosen silently).
Exit code 1 if any stop differs from the tour's own data.
"""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = ["location", "date", "date_start", "date_end", "date_precision", "deaths", "injured", "who_affected", "confidence", "sources", "weather_context"]


def rows(p: Path) -> dict:
    with open(p, encoding="utf-8-sig", newline="") as f:
        return {r["event_id"]: r for r in csv.DictReader(f)}


def main() -> int:
    shown = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    tour = rows(ROOT / "data/history/events/avalanche_events_pakistan_compiled.csv")
    inv = rows(ROOT / "forecast/pipeline/avalanche_events_master.csv")
    bad = 0
    print(f"{len(shown)} stops shown by the 3D tour\n")
    for n, s in enumerate(shown, 1):
        i = s["event_id"]
        if s.get("model"):
            print(f"{n:2d}. {i:12s} model reconstruction (NGT notebook files), not an inventory record: checked against its own files by the 2D tour")
            continue
        t, v = tour.get(i), inv.get(i)
        dt = [k for k in FIELDS if t is not None and (s.get(k) or "").strip() != (t.get(k) or "").strip()]
        if t is None or dt:
            bad += 1
        dv = [k for k in FIELDS if v is not None and (s.get(k) or "").strip() != (v.get(k) or "").strip()]
        pt = s.get("map_point")
        coords = ""
        if v is not None:
            prec = v.get("location_precision") or ""
            if v.get("lat") and v.get("lon"):
                same = pt and f"{pt[0]}" == v["lat"] and f"{pt[1]}" == v["lon"]
                km = math.hypot((float(v["lon"]) - pt[1]) * 111.32 * math.cos(math.radians(float(v["lat"]))), (float(v["lat"]) - pt[0]) * 110.574) if pt else 0
                coords = "coordinates: same as the inventory" if same else f"coordinates: map point {pt[0]}, {pt[1]} vs inventory {v['lat']}, {v['lon']} ({prec or 'no precision given'}, {km:.1f} km apart)"
            else:
                coords = f"coordinates: inventory has none; map point {pt[0]}, {pt[1]} from the tour"
            # an approximate place (anything but coordinates from the source) must carry the "location approximate" ring
            # (and a pin needs the map point to be the source's point: within 1 km of the inventory's coordinates)
            exact = v.get("lat") and v.get("lon") and prec == "source_coords" and km < 1
            want = not exact or s.get("tier") in ("C", "D", "E")
            ok = bool(s.get("approximate")) == want
            coords += f"; location approximate on screen: {'yes' if s.get('approximate') else 'no'}{'' if ok else ' <- SHOULD BE ' + ('yes' if want else 'no')}"
            if not ok:
                bad += 1
        tag = "OK  " if t is not None and not dt else "DIFF"
        print(f"{n:2d}. {i:12s} {tag} vs tour data" + (f" ({', '.join(dt)})" if dt else ""))
        print(f"      inventory: {'all fields equal' if not dv else 'differs in ' + ', '.join(dv)}; {coords}")
        for k in dv:
            print(f"        {k}: shown {s.get(k)!r} | inventory {v.get(k)!r}")
        if v is not None and (v.get("use_in_analysis") or "").lower() == "no":
            print("      inventory use_in_analysis: no")
    print(f"\n{'All stops match the tour data exactly, and every approximate place is marked approximate.' if not bad else f'{bad} problem(s): a stop differs from the tour data or an approximate place is not marked.'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
