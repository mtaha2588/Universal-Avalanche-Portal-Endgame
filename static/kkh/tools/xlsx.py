"""A small .xlsx reader (standard library only): every sheet as rows of cell values, exactly as stored in the workbook.

Strings come from the shared-string table or inline strings; numbers are returned as the text the workbook stores (never re-rounded),
so a value such as 12.30 or a code such as "007" survives unchanged. Formulas give their cached result.
"""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def _text(el) -> str:
    return "".join(t.text or "" for t in el.iter(f"{{{NS['m']}}}t"))


def read(path: str) -> dict[str, list[list[str | None]]]:
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = [_text(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for sh in wb.find("m:sheets", NS):
        target = rels[sh.get(REL)].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        root = ET.fromstring(z.read(target))
        rows = []
        for row in root.iter(f"{{{NS['m']}}}row"):
            r = int(row.get("r")) - 1
            while len(rows) <= r: rows.append([])
            cells = rows[r]
            for c in row.findall("m:c", NS):
                i = _col(c.get("r")); t = c.get("t"); v = c.find("m:v", NS)
                if t == "s": val = shared[int(v.text)] if v is not None else None
                elif t == "inlineStr": val = _text(c.find("m:is", NS))
                elif t == "b": val = None if v is None else ("TRUE" if v.text == "1" else "FALSE")
                else: val = v.text if v is not None else None
                while len(cells) <= i: cells.append(None)
                cells[i] = val
        out[sh.get("name")] = rows
    return out
