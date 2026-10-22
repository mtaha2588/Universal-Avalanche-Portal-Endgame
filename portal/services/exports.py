"""CSV / GeoJSON exports that carry provenance metadata."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

DISCLAIMER = ("Decision-support output only. Not an official warning unless validated and "
              "authorised by the competent authority (NDMA / PDMA / SDMA).")


def _flatten(v):
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return "" if v is None else v


def to_geojson(features: list[dict], meta: dict) -> str:
    fc = {
        "type": "FeatureCollection",
        "metadata": {
            **meta,
            "crs": "EPSG:4326 (WGS84 lon/lat)",
            "exported_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "feature_count": len(features),
            "disclaimer": DISCLAIMER,
        },
        "features": features,
    }
    return json.dumps(fc, ensure_ascii=False, indent=1)


def to_csv(features: list[dict], meta: dict) -> str:
    buf = io.StringIO()
    # Commented metadata header; most tools (pandas: comment='#') skip it.
    for k, v in {**meta, "crs": "EPSG:4326", "disclaimer": DISCLAIMER,
                 "exported_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}.items():
        buf.write(f"# {k}: {_flatten(v)}\n")
    cols: list[str] = []
    for f in features:
        for k in f["properties"]:
            if k not in cols:
                cols.append(k)
    if features and features[0]["geometry"]["type"] == "Point":
        cols = [c for c in cols if c not in ("lon", "lat")] + ["lon", "lat"]
    else:
        cols.append("geometry_wkt_type")
    w = csv.writer(buf)
    w.writerow(cols)
    for f in features:
        p = dict(f["properties"])
        if f["geometry"]["type"] == "Point":
            p.setdefault("lon", f["geometry"]["coordinates"][0])
            p.setdefault("lat", f["geometry"]["coordinates"][1])
        else:
            p["geometry_wkt_type"] = f["geometry"]["type"] + " (see GeoJSON export)"
        w.writerow([_flatten(p.get(c)) for c in cols])
    return buf.getvalue()
