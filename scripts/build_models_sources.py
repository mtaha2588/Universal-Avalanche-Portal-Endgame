"""Model Framework tab: convert NGT's avalanche_models_sources.xlsx into static/models/media/models_sources.json.

Every cell is copied exactly as the workbook stores it (static/kkh/tools/xlsx.py, standard library only). The sheet has two tables:
"Technology | How it works | Purpose | Repository / source | Details" and, under a "Links" row, "Technology | Link name | URL".

    python scripts/build_models_sources.py [path/to/avalanche_models_sources.xlsx]

Default input: static/models/media/avalanche_models_sources.xlsx (the copy of the file shared on Drive by the owner, 11 Nov 2026).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "static" / "kkh" / "tools"))
import xlsx  # noqa: E402


def main(src: Path) -> None:
    sheets = xlsx.read(str(src))
    name, rows = next(iter(sheets.items()))
    rows = [[(c or "").strip() for c in r] for r in rows]
    title = rows[0][0] if rows and rows[0] else ""
    note = next((r[0] for r in rows[1:4] if r and r[0] and r[0] != title and not r[0].startswith("Technology")), "")
    models, links, mode, head = [], [], None, []
    for r in rows:
        if not any(r):
            continue
        if r[0] == "Technology":
            head, mode = r, ("links" if "URL" in r else "models")
            continue
        if r[0] == "Links":
            mode = None
            continue
        if mode == "models":
            models.append({head[i]: r[i] if i < len(r) else "" for i in range(len(head)) if head[i]})
        elif mode == "links":
            links.append({head[i]: r[i] if i < len(r) else "" for i in range(len(head)) if head[i]})
    out = {"source": src.name, "sheet": name, "title": title, "note": note, "models": models, "links": links}
    dst = ROOT / "static" / "models" / "media" / "models_sources.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{dst.relative_to(ROOT)}: {len(models)} models, {len(links)} links")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "static" / "models" / "media" / "avalanche_models_sources.xlsx")
