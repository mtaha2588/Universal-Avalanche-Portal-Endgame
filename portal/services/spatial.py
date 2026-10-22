"""Dependency-free geometry helpers (WGS84 / EPSG:4326 inputs).

Distances use the haversine formula on a spherical Earth (R = 6371.0088 km); accuracy is
~0.5 %, adequate for proximity screening, NOT for engineering measurement. If GeoPandas /
PyProj are installed, swap these for projected (e.g. UTM 43N, EPSG:32643) calculations.
"""
from __future__ import annotations

import math

EARTH_R_KM = 6371.0088


def haversine_km(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * math.asin(min(1.0, math.sqrt(a)))


def line_length_km(coords) -> float:
    return sum(haversine_km(*coords[i][:2], *coords[i + 1][:2]) for i in range(len(coords) - 1))


def point_in_ring(lon, lat, ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]
        xj, yj = ring[j][:2]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def point_in_polygon(lon, lat, geometry: dict) -> bool:
    gtype = geometry.get("type")
    polys = [geometry["coordinates"]] if gtype == "Polygon" else (
        geometry["coordinates"] if gtype == "MultiPolygon" else [])
    for poly in polys:
        if poly and point_in_ring(lon, lat, poly[0]) and not any(
                point_in_ring(lon, lat, hole) for hole in poly[1:]):
            return True
    return False


def point_segment_distance_km(px, py, ax, ay, bx, by) -> float:
    """Approximate point-to-segment distance using a local equirectangular projection."""
    k = math.cos(math.radians(py))
    ax_, bx_, px_ = ax * k, bx * k, px * k
    dx, dy = bx_ - ax_, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px_ - ax_) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = (ax_ + t * dx) / k, ay + t * dy
    return haversine_km(px, py, cx, cy)


def point_line_distance_km(lon, lat, coords) -> float:
    return min(point_segment_distance_km(lon, lat, *coords[i][:2], *coords[i + 1][:2])
               for i in range(len(coords) - 1))


def iter_lines(geometry: dict):
    if geometry["type"] == "LineString":
        yield geometry["coordinates"]
    elif geometry["type"] == "MultiLineString":
        yield from geometry["coordinates"]


def bbox_contains(bbox, lon, lat) -> bool:
    w, s, e, n = bbox
    return w <= lon <= e and s <= lat <= n


def classify_proximity(distance_km: float | None, intersects: bool, near_km: float = 2.0) -> str:
    """Keep 'intersects mapped hazard' distinct from 'merely nearby'."""
    if intersects:
        return "Intersects mapped hazard area"
    if distance_km is None:
        return "Not assessed (no hazard layer)"
    if distance_km <= near_km:
        return f"Within {near_km:g} km of mapped hazard"
    return "Outside screening distance"
