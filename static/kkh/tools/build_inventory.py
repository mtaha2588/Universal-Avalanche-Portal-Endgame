#!/usr/bin/env python3
"""CPEC_KKH_Glacier_Inventory.xlsx -> static/kkh/data/kkh_inventory.json (every value, source code and confidence exactly as in the workbook).

    python static/kkh/tools/build_inventory.py path/to/CPEC_KKH_Glacier_Inventory.xlsx

Each sheet keeps its title line, its notes, its column names in order, and every row with its workbook row number. Values are the text the
workbook stores (numbers are not re-rounded; "Not found" stays "Not found"; empty cells are null). Summary rows (totals, footnotes) are kept
apart from the data rows, verbatim. Then, for each glacier that has coordinates in the workbook: the distance to the nearest point of the
Karakoram Highway (kkh_route.geojson) and its chainage. Nothing is added to the inventory's own values.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import xlsx  # noqa: E402

OUT = HERE.parent / "data" / "kkh_inventory.json"
SHEETS = {"glaciers": ("Glacier Inventory", "Glacier"), "settlements": ("Settlements & Population", "Settlement"), "events": ("Events Timeline", "Date")}


def sheet(rows, first_col):
    hi = next(i for i, r in enumerate(rows) if r and r[0] == first_col)       # the header row (row 4 in three sheets, row 3 in Events Timeline)
    head = rows[hi]
    data, summary = [], []
    for i, r in enumerate(rows[hi + 1:], start=hi + 2):
        if not any(v not in (None, "") for v in r): continue
        rec = {"_row": i, **{h: (r[k] if k < len(r) else None) for k, h in enumerate(head) if h}}
        filled = sum(1 for h in head[1:] if h and rec.get(h) not in (None, ""))
        # totals ("Total ...") and footnotes (only the first cell filled) are summary rows
        (summary if str(r[0] or "").startswith("Total") or filled == 0 else data).append(rec)
    return {"title": rows[0][0] if rows and rows[0] else None, "notes": [r[0] for r in rows[1:hi] if r and r[0]], "header_row": hi + 1, "columns": [h for h in head if h],
            "rows": data, "summary_rows": summary}


def notes_and_sources(rows):
    hi = next(i for i, r in enumerate(rows) if r and r[0] == "ID")
    return {"title": rows[0][0], "notes": [r[0] for r in rows[1:hi] if r and r[0]],
            "sources": [{"id": r[0], "source": r[1], "url": r[2] if len(r) > 2 else None, "_row": i} for i, r in enumerate(rows[hi + 1:], start=hi + 2) if r and r[0]]}


def km(a, b):
    return math.hypot((b[1] - a[1]) * 111.32 * math.cos(math.radians((a[0] + b[0]) / 2)), (b[0] - a[0]) * 110.57)


def road_distance(route, lat, lon):
    """Nearest point of the N-35 line: straight-line distance (km) and chainage (km from Hasan Abdal)."""
    c = route[0]; ch = 0.0; best = (1e9, 0.0, None)
    for p in route[1:]:
        a, b = (c[1], c[0]), (p[1], p[0]); L = km(a, b)
        ax, ay = a[1] * math.cos(math.radians(lat)), a[0]; bx, by = b[1] * math.cos(math.radians(lat)), b[0]; px, py = lon * math.cos(math.radians(lat)), lat
        dx, dy = bx - ax, by - ay; t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        q = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); d = km(q, (lat, lon))
        if d < best[0]: best = (d, ch + L * t, q)
        ch += L; c = p
    return best


def main() -> int:
    src = Path(sys.argv[1])
    S = xlsx.read(str(src))
    inv = {"source_file": src.name, "converted": date.today().isoformat(),
           "note": "Values exactly as in the workbook (text as stored; 'Not found' kept). Computed fields are under 'computed', never mixed into the rows."}
    for key, (name, first) in SHEETS.items():
        inv[key] = sheet(S[name], first)
    inv["notes_sources"] = notes_and_sources(S["Notes & Sources"])
    # computed: distance of each located glacier to the highway (straight line to the nearest point of the line)
    route = next(f for f in json.loads((HERE.parent / "data" / "kkh_route.geojson").read_text(encoding="utf-8"))["features"] if f["properties"]["id"] == "n35")["geometry"]["coordinates"]
    comp = {}
    for r in inv["glaciers"]["rows"]:
        la, lo = r.get("Latitude (°N)"), r.get("Longitude (°E)")
        try: la, lo = float(la), float(lo)
        except (TypeError, ValueError):
            comp[r["Glacier"]] = {"located": False, "reason": "coordinates 'Not found' in the inventory"}; continue
        d, ch, q = road_distance(route, la, lo)
        comp[r["Glacier"]] = {"located": True, "coordinate_source": "inventory", "road_distance_km": round(d, 1), "road_chainage_km": round(ch, 1), "nearest_road_point": [round(q[1], 5), round(q[0], 5)],
                              "basis": "straight line from the inventory's glacier coordinate to the nearest point of the N-35 line (not a flow path)"}
    inv["computed"] = {"glaciers": comp}
    OUT.write_text(json.dumps(inv, ensure_ascii=False, indent=1), encoding="utf-8")
    g, s, e = (len(inv[k]["rows"]) for k in ("glaciers", "settlements", "events"))
    print(f"{OUT.name}: {g} glaciers, {s} settlements, {e} events, {len(inv['notes_sources']['sources'])} sources")
    for k, v in comp.items(): print(f"  {k:28s} " + (f"{v['road_distance_km']:5.1f} km from the KKH, at km {v['road_chainage_km']}" if v["located"] else v["reason"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
