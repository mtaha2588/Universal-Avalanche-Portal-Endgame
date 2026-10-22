"""Loads datasets declared in data/catalog.json and runs the exposure / infrastructure analysis.

Every dataset carries provenance metadata. Missing files are reported as 'missing' — they are
never replaced with synthetic values.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path

from . import spatial

log = logging.getLogger(__name__)

HAZARD_SCREEN_KM = 2.0       # settlement "nearby" threshold
INCIDENT_SCREEN_KM = 10.0    # incidents counted as "relevant" within this distance
ROAD_INCIDENT_KM = 5.0


def _read_json(path: Path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


class DataStore:
    def __init__(self, data_dir: Path, model_dir: Path, stale_after_hours: int = 48):
        self.data_dir = Path(data_dir)
        self.model_dir = Path(model_dir)
        self.pred_dir = self.data_dir / "predictions"
        self.stale_after_hours = stale_after_hours
        self._cache: dict[str, tuple[float, object]] = {}

    # ------------------------------------------------------------------ loading
    def _load(self, path: Path):
        """mtime-aware cache so dropping in new files needs no restart."""
        key = str(path)
        mtime = path.stat().st_mtime
        hit = self._cache.get(key)
        if hit and hit[0] == mtime:
            return hit[1]
        obj = _read_json(path)
        self._cache[key] = (mtime, obj)
        return obj

    def catalog(self) -> list[dict]:
        entries = self._load(self.data_dir / "catalog.json")["datasets"]
        now = datetime.now(timezone.utc)
        out = []
        for e in entries:
            e = dict(e)
            p = self.data_dir / e["file"]
            if p.exists():
                try:
                    fc = self._load(p)
                    e["feature_count"] = len(fc.get("features", [])) if isinstance(fc, dict) else None
                    e["status"] = e.get("status") or "loaded"
                    modified = datetime.fromtimestamp(p.stat().st_mtime, timezone.utc)
                    e["file_modified"] = modified.isoformat(timespec="seconds")
                    if e.get("operational"):
                        age_h = (now - modified).total_seconds() / 3600
                        e["stale"] = age_h > self.stale_after_hours
                except (OSError, ValueError) as exc:
                    log.warning("Failed to read %s: %s", p.name, exc)
                    e["status"], e["feature_count"] = "error", None
            else:
                e["status"], e["feature_count"] = "missing", 0
            out.append(e)
        return out

    def meta(self, dataset_id: str) -> dict | None:
        return next((d for d in self.catalog() if d["id"] == dataset_id), None)

    def features(self, dataset_id: str) -> list[dict]:
        m = self.meta(dataset_id)
        if not m or m["status"] not in ("loaded", "seed", "reference", "indicative"):
            return []
        return self._load(self.data_dir / m["file"]).get("features", [])

    def regions(self) -> list[dict]:
        return self.features("regions")

    def region_bbox(self, region_id: str | None):
        if not region_id or region_id == "all":
            return None
        for f in self.regions():
            if f["properties"]["id"] == region_id:
                return f["properties"]["bbox"]
        raise KeyError(region_id)

    def model_card(self) -> dict:
        p = self.model_dir / "model_card.json"
        return self._load(p) if p.exists() else {"status": "not_connected"}

    def preparedness(self) -> dict:
        return self._load(self.data_dir / "preparedness.json")

    # ------------------------------------------------------------- predictions
    def prediction_windows(self) -> list[str]:
        if not self.pred_dir.exists():
            return []
        return sorted(p.stem for p in self.pred_dir.glob("*.geojson"))

    def predictions(self, window_id: str | None) -> dict | None:
        if not window_id:
            return None
        safe = "".join(c for c in window_id if c.isalnum() or c in "-_")
        p = self.pred_dir / f"{safe}.geojson"
        return self._load(p) if p.exists() else None

    # ----------------------------------------------------------------- filters
    @staticmethod
    def _point(f):
        g = f.get("geometry") or {}
        return g.get("coordinates")[:2] if g.get("type") == "Point" else None

    def _in_region(self, f, bbox) -> bool:
        if bbox is None:
            return True
        pt = self._point(f)
        if pt:
            return spatial.bbox_contains(bbox, *pt)
        for line in spatial.iter_lines(f["geometry"]):
            if any(spatial.bbox_contains(bbox, *c[:2]) for c in line):
                return True
        return False

    def incidents(self, region=None, date_from=None, date_to=None, verification=None, q=None):
        bbox = self.region_bbox(region)
        out = []
        for f in self.features("incidents"):
            p = f["properties"]
            if not self._in_region(f, bbox):
                continue
            ev = p.get("event_date") or ""
            if date_from and ev[:10] < date_from:
                continue
            if date_to and ev[:10] > date_to:
                continue
            if verification and verification != "all" and p.get("verification_status") != verification:
                continue
            if q and q.lower() not in json.dumps(p, ensure_ascii=False).lower():
                continue
            out.append(f)
        return out

    # ---------------------------------------------------------------- analysis
    def _hazard_polys(self, window_id):
        polys = [f for f in self.features("hazard_zones")
                 if f["geometry"]["type"] in ("Polygon", "MultiPolygon")]
        pred = self.predictions(window_id)
        pred_polys = [f for f in (pred or {}).get("features", [])
                      if f["geometry"]["type"] in ("Polygon", "MultiPolygon")]
        return polys, pred_polys

    @staticmethod
    def _poly_distance_km(lon, lat, poly_feature) -> float:
        g = poly_feature["geometry"]
        rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
        return min(spatial.point_line_distance_km(lon, lat, r) for r in rings)

    def settlements(self, region=None, window_id=None, exposure=None):
        bbox = self.region_bbox(region)
        hazards, preds = self._hazard_polys(window_id)
        incidents = self.features("incidents")
        rows = []
        for f in self.features("settlements"):
            if not self._in_region(f, bbox):
                continue
            lon, lat = self._point(f)
            p = dict(f["properties"])
            hit = next((h for h in hazards if spatial.point_in_polygon(lon, lat, h["geometry"])), None)
            dist = None
            if hazards and not hit:
                dist = round(min(self._poly_distance_km(lon, lat, h) for h in hazards), 2)
            p["hazard_layer_available"] = bool(hazards)
            p["intersecting_hazard_category"] = hit["properties"].get("category") if hit else None
            p["distance_to_hazard_km"] = 0.0 if hit else dist
            p["exposure_category"] = spatial.classify_proximity(dist, bool(hit), HAZARD_SCREEN_KM) \
                if hazards else "Not assessed (no hazard layer)"
            p["exposure_method"] = ("Point-in-polygon vs mapped hazard zones; haversine edge distance"
                                    if hazards else "None — hazard/runout layer not loaded")
            pred_hit = next((h for h in preds if spatial.point_in_polygon(lon, lat, h["geometry"])), None)
            p["model_output"] = pred_hit["properties"] if pred_hit else None
            near = [i for i in incidents
                    if spatial.haversine_km(lon, lat, *self._point(i)) <= INCIDENT_SCREEN_KM]
            p["incidents_within_10km"] = len(near)
            p["lon"], p["lat"] = lon, lat
            if exposure and exposure != "all" and not p["exposure_category"].startswith(exposure):
                continue
            rows.append({"type": "Feature", "geometry": f["geometry"], "properties": p})
        return rows

    def roads(self, region=None, window_id=None):
        bbox = self.region_bbox(region)
        hazards, _ = self._hazard_polys(window_id)
        incidents = self.features("incidents")
        rows = []
        for f in self.features("roads"):
            if not self._in_region(f, bbox):
                continue
            p = dict(f["properties"])
            total = affected = 0.0
            for line in spatial.iter_lines(f["geometry"]):
                for a, b in zip(line, line[1:]):
                    seg = spatial.haversine_km(*a[:2], *b[:2])
                    total += seg
                    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                    if any(spatial.point_in_polygon(*mid, h["geometry"]) for h in hazards):
                        affected += seg
            rel = []
            for i in incidents:
                ipt = self._point(i)
                d = min(spatial.point_line_distance_km(*ipt, line)
                        for line in spatial.iter_lines(f["geometry"]))
                if d <= ROAD_INCIDENT_KM:
                    rel.append(i["properties"].get("incident_id"))
            p.update(
                length_km=round(total, 2),
                hazard_affected_km=round(affected, 2) if hazards else None,
                relevant_incidents=rel,
                exposure_method=("Segment-midpoint in mapped hazard polygon" if hazards
                                 else "Hazard layer not loaded — incident proximity only"),
                status_wording="Potential exposure — requires verification" if (affected or rel)
                else "No exposure evidence in loaded data",
            )
            rows.append({"type": "Feature", "geometry": f["geometry"], "properties": p})
        rows.sort(key=lambda r: (-(r["properties"]["hazard_affected_km"] or 0),
                                 -len(r["properties"]["relevant_incidents"])))
        for rank, r in enumerate(rows, 1):
            r["properties"]["review_rank"] = rank
        return rows

    def summary(self, region=None, window_id=None) -> dict:
        inc = self.incidents(region=region)
        verified = [i for i in inc if i["properties"].get("verification_status") == "Verified"]
        return {
            "region": region or "all",
            "window": window_id,
            "incidents_total": len(inc),
            "incidents_verified": len(verified),
            "settlements_total": len(self.settlements(region, window_id)),
            "roads_total": len(self.roads(region, window_id)),
            "prediction_available": self.predictions(window_id) is not None,
            "prediction_windows": self.prediction_windows(),
            "model_status": self.model_card().get("status", "not_connected"),
            "generated": date.today().isoformat(),
        }
