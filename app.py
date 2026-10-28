"""Flask entry point for the Pakistan Avalanche Intelligence & Early-Warning Portal.

Run:  python app.py      (then open http://127.0.0.1:5000)
"""
from __future__ import annotations

import gzip
import json
import logging
import threading
from datetime import date
from pathlib import Path

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, send_from_directory

from config import Config
from portal.services import exports, hotspot_register
from portal.services.data_store import DataStore
from portal.services.windows import generate_windows, season_label, window_for_date

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("portal")

EXPORTABLE = {"incidents", "settlements", "roads", "regions", "hk_hotspots", "hk_tiles"}


def _iso(s: str | None) -> str | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        abort(400, description="Dates must be YYYY-MM-DD")


def default_season_year(today: date) -> int:
    """In-season -> current season; off-season (15 Apr – 14 Dec) -> the upcoming season."""
    if (today.month, today.day) >= (12, 15):
        return today.year
    if (today.month, today.day) < (4, 15):
        return today.year - 1
    return today.year


def create_app(config: type[Config] = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config)
    store = DataStore(config.DATA_DIR, config.MODEL_DIR, config.STALE_AFTER_HOURS)
    app.extensions["store"] = store

    def region_arg():
        r = request.args.get("region") or "all"
        try:
            store.region_bbox(r)
        except KeyError:
            abort(400, description="Unknown region")
        return r

    # ------------------------------------------------------------------ pages
    @app.get("/")
    def home():
        # Served as a static file: the page contains JS template literals that Jinja must not parse.
        return send_from_directory(app.template_folder, "home.html")

    @app.get("/sw.js")
    def service_worker():
        # Map tile cache. Served from the root so its scope covers / and /portal; never cached itself, so updates apply.
        resp = send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    # Terrain elevation tiles (open AWS Terrain Tiles, terrarium PNG) for every 3D map. Tiles downloaded by scripts/fetch_dem.py
    # are served from disk and cached by the browser for a year (they never change); anything else is redirected to the public copy.
    dem_dir = config.DATA_DIR / "dem" / "terrarium"

    @app.get("/api/dem/<int:z>/<int:x>/<int:y>.png")
    def dem_tile(z: int, x: int, y: int):
        if not (0 <= z <= 15 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
            abort(404)
        if (dem_dir / str(z) / str(x) / f"{y}.png").is_file():
            resp = send_from_directory(dem_dir / str(z) / str(x), f"{y}.png", mimetype="image/png", max_age=31536000)
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            resp = redirect(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", 302)
            resp.headers["Cache-Control"] = "public, max-age=86400"
        resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp

    @app.get("/portal")
    def portal():
        return render_template("portal.html", title=config.PORTAL_TITLE, version=config.PORTAL_VERSION)

    @app.get("/report")
    def report():
        region = region_arg()
        window = request.args.get("window")
        reg = next((r["properties"] for r in store.regions() if r["properties"]["id"] == region), None)
        return render_template(
            "report.html", title=config.PORTAL_TITLE, version=config.PORTAL_VERSION,
            region=reg, window=window, summary=store.summary(region, window),
            incidents=store.incidents(region=region), settlements=store.settlements(region, window),
            roads=store.roads(region, window), model=store.model_card(), catalog=store.catalog(),
            today=date.today().isoformat(), disclaimer=exports.DISCLAIMER)

    # -------------------------------------------------------------------- api
    @app.get("/api/config")
    def api_config():
        today = date.today()
        cur = window_for_date(today)
        return jsonify(
            title=config.PORTAL_TITLE, version=config.PORTAL_VERSION,
            mapbox_token=config.MAPBOX_TOKEN, map_engine="mapbox" if config.MAPBOX_TOKEN else "maplibre",
            today=today.isoformat(), default_season=default_season_year(today),
            in_season=cur is not None and cur.contains(today) and (today.month, today.day) != (4, 15),
            current_window=cur.id if cur else None, stale_after_hours=config.STALE_AFTER_HOURS)

    @app.get("/api/windows")
    def api_windows():
        try:
            year = int(request.args.get("season", default_season_year(date.today())))
        except ValueError:
            abort(400, description="season must be a year")
        if not 2000 <= year <= 2100:
            abort(400, description="season out of range")
        available = set(store.prediction_windows())
        wins = []
        for w in generate_windows(year, config.WINDOW_DAYS):
            d = w.to_dict()
            d["prediction_available"] = w.id in available
            wins.append(d)
        return jsonify(season=season_label(year), start_year=year,
                       convention="Half-open [start, end); final window may be shorter",
                       windows=wins)

    @app.get("/api/catalog")
    def api_catalog():
        return jsonify(datasets=store.catalog(), prediction_windows=store.prediction_windows())

    @app.get("/api/model")
    def api_model():
        return jsonify(store.model_card())

    @app.get("/api/regions")
    def api_regions():
        return jsonify(type="FeatureCollection", features=store.regions(), metadata=store.meta("regions"))

    @app.get("/api/summary")
    def api_summary():
        return jsonify(store.summary(region_arg(), request.args.get("window")))

    @app.get("/api/incidents")
    def api_incidents():
        a = request.args
        feats = store.incidents(region=region_arg(), date_from=_iso(a.get("from")), date_to=_iso(a.get("to")),
                                verification=a.get("verification"), q=(a.get("q") or "")[:100] or None)
        return jsonify(type="FeatureCollection", features=feats, metadata=store.meta("incidents"))

    @app.get("/api/settlements")
    def api_settlements():
        feats = store.settlements(region_arg(), request.args.get("window"), request.args.get("exposure"))
        return jsonify(type="FeatureCollection", features=feats, metadata=store.meta("settlements"))

    @app.get("/api/roads")
    def api_roads():
        feats = store.roads(region_arg(), request.args.get("window"))
        return jsonify(type="FeatureCollection", features=feats, metadata=store.meta("roads"))

    @app.get("/api/predictions")
    def api_predictions():
        window = request.args.get("window")
        fc = store.predictions(window)
        if fc is None:
            return jsonify(available=False, window=window,
                           message="No model output exists for this window. Nothing is shown in its place."), 200
        return jsonify(available=True, window=window, **fc)

    glacier_cache = {}
    glacier_lock = threading.Lock()

    def build_glacier_cache():
        """Serialise + gzip the 14 MB layer and compute its per-system summary, once per file version."""
        meta = store.meta("glaciers")
        if not meta or meta["status"] == "missing":
            return None
        key = meta.get("file_modified")
        with glacier_lock:
            if glacier_cache.get("key") != key:
                feats = store.features("glaciers")
                body = json.dumps({"type": "FeatureCollection", "features": feats, "metadata": meta},
                                  separators=(",", ":"), ensure_ascii=False).encode("utf-8")
                systems = {}
                for f in feats:
                    p = f["properties"]
                    s = systems.setdefault(p["system"], {"n": 0, "km2": 0.0, "bbox": [180.0, 90.0, -180.0, -90.0]})
                    s["n"] += 1
                    s["km2"] += p["area_km2"]
                    polys = [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"]
                    b = s["bbox"]
                    for poly in polys:
                        for x, y in poly[0]:
                            b[0], b[1], b[2], b[3] = min(b[0], x), min(b[1], y), max(b[2], x), max(b[3], y)
                for s in systems.values():
                    b = s.pop("bbox")
                    s["km2"] = round(s["km2"], 1)
                    s["center"] = [round((b[0] + b[2]) / 2, 4), round((b[1] + b[3]) / 2, 4)]
                summary = {"systems": systems, "source": meta.get("source"), "note": meta.get("limitations")}
                glacier_cache.update(key=key, raw=body, gz=gzip.compress(body, 6), summary=summary)
        return glacier_cache

    def warm_layers():
        """Startup warm-up: the home-page glacier layer is gzipped before the first visitor asks for it."""
        gz_entry("glaciers_pk")
        build_glacier_cache()

    app.extensions["warm_glaciers"] = lambda: warm_layers()

    @app.get("/api/glaciers/pakistan")
    def glacier_pakistan_summary():
        """Per-system glacier counts, areas, elevation range and outline dates inside the Pakistan study area."""
        p = config.DATA_DIR / "glaciers" / "pakistan_summary.json"
        if not p.exists():
            abort(404)
        return jsonify(json.loads(p.read_text(encoding="utf-8")))

    @app.get("/api/layer/glaciers/summary")
    def glacier_summary():
        cache = build_glacier_cache()
        if not cache:
            abort(404)
        return jsonify(cache["summary"])

    def glacier_response():
        """14 MB static layer served pre-gzipped; browsers then cache it."""
        if not build_glacier_cache():
            abort(404)
        key = glacier_cache["key"]
        etag = f'"glaciers-{key}"'
        if request.headers.get("If-None-Match") == etag:
            return Response(status=304, headers={"ETag": etag})
        use_gz = "gzip" in request.headers.get("Accept-Encoding", "")
        resp = Response(glacier_cache["gz"] if use_gz else glacier_cache["raw"], mimetype="application/json")
        if use_gz:
            resp.headers["Content-Encoding"] = "gzip"
        resp.headers.update({"ETag": etag, "Cache-Control": "public, max-age=86400", "Vary": "Accept-Encoding"})
        return resp

    def hk_hotspot_filter(feats, a):
        """Filters shared by the Hindu Kush screening page and its exports."""
        try:
            min_ha = float(a.get("min_ha") or 0)
            top = int(a["top"]) if a.get("top") else None
        except ValueError:
            abort(400, description="min_ha and top must be numbers")
        facing = {f for f in (a.get("facing") or "").upper().split(",") if f in {"N", "NE", "E", "SE", "S", "SW", "W", "NW"}}
        tile = (a.get("tile") or "").strip()
        out = [f for f in feats if (f["properties"].get("area_ha") or 0) >= min_ha
               and (not facing or f["properties"].get("facing") in facing)
               and (not tile or f["properties"].get("tile_id") == tile)]
        return out[:top] if top else out

    gz_cache = {}

    def gz_entry(dataset_id):
        """Serialise and gzip a layer once per file version (10 MB -> ~1.5 MB). None if the file is missing."""
        meta = store.meta(dataset_id)
        if not meta or meta["status"] == "missing":
            return None
        hit = gz_cache.get(dataset_id)
        if not hit or hit[0] != meta.get("file_modified"):
            body = json.dumps({"type": "FeatureCollection", "features": store.features(dataset_id), "metadata": meta},
                              separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            hit = gz_cache[dataset_id] = (meta.get("file_modified"), body, gzip.compress(body, 6))
        return hit

    def gzipped_layer(dataset_id):
        """Larger layers are served pre-gzipped, with an ETag per file version."""
        hit = gz_entry(dataset_id)
        if not hit:
            abort(404)
        etag = f'"{dataset_id}-{hit[0]}"'
        if request.headers.get("If-None-Match") == etag:
            return Response(status=304, headers={"ETag": etag})
        use_gz = "gzip" in request.headers.get("Accept-Encoding", "")
        resp = Response(hit[2] if use_gz else hit[1], mimetype="application/json")
        if use_gz:
            resp.headers["Content-Encoding"] = "gzip"
        resp.headers.update({"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"})
        return resp

    @app.get("/api/screening/hindukush")
    def api_hk_screening():
        """Run metadata for the Hindu Kush terrain screening (thresholds, class areas, overlay bounds)."""
        p = config.DATA_DIR / "screening" / "hk_run.json"
        if not p.exists():
            return jsonify(available=False, message="No Hindu Kush screening run imported. Run scripts/build_hk_screening.py."), 200
        run = json.loads(p.read_text(encoding="utf-8"))
        ov = run.get("overlay") or {}
        ov["available"] = (Path(app.root_path) / ov["image"].lstrip("/")).exists() if ov.get("image") else False
        return jsonify(available=True, datasets=[store.meta("hk_hotspots"), store.meta("hk_tiles")], **run)

    @app.get("/api/karakoram/hotspots")
    def api_kk_hotspots():
        """The 10 Karakoram hotspots supplied for the demo (scripts/build_kk_hotspots.py). Served as supplied."""
        p = config.DATA_DIR / "karakoram" / "kk_hotspots.geojson"
        if not p.exists():
            return jsonify(available=False, message="No Karakoram hotspots imported. Run scripts/build_kk_hotspots.py."), 200
        return jsonify(available=True, **json.loads(p.read_text(encoding="utf-8")))

    @app.get("/api/history/events")
    def api_history_events():
        """Compiled historical avalanche records of Pakistan with location quality and illustrative paths
        (scripts/build_history_events.py). Every CSV field is served unchanged."""
        p = config.DATA_DIR / "history" / "events" / "pk_events.geojson"
        if not p.exists():
            return jsonify(available=False, message="No historical events built. Run scripts/build_history_events.py."), 200
        return jsonify(available=True, **json.loads(p.read_text(encoding="utf-8")))

    @app.get("/api/forecast/snow")
    def api_snow_forecast():
        """Run metadata for the 2026-27 snow outlook (method, skill, thresholds, coverage caveats)."""
        p = config.DATA_DIR / "forecast" / "snow_2026_27.json"
        if not p.exists():
            return jsonify(available=False, message="No snow outlook imported. Run scripts/build_snow_forecast.py."), 200
        return jsonify(available=True, datasets=[store.meta(i) for i in ("snow_stations", "hk_zones", "hk_tiles_windows")],
                       **json.loads(p.read_text(encoding="utf-8")))

    era5_cache = {}

    @app.get("/api/climate/era5_winter")
    def api_era5_winter():
        """Winter (DJF) climate 1970-2010 from ERA5-Land, 305 tiles (scripts/build_era5_winter.py). Served pre-gzipped."""
        p = config.DATA_DIR / "climate" / "era5_winter.json"
        if not p.exists():
            return jsonify(available=False, message="No ERA5 winter run imported. Run scripts/build_era5_winter.py."), 200
        mt = p.stat().st_mtime_ns
        if era5_cache.get("mt") != mt:
            body = b'{"available":true,' + p.read_bytes()[1:]
            era5_cache.update(mt=mt, raw=body, gz=gzip.compress(body, 6))
        etag = f'"era5w-{mt}"'
        if request.headers.get("If-None-Match") == etag:
            return Response(status=304, headers={"ETag": etag})
        use_gz = "gzip" in request.headers.get("Accept-Encoding", "")
        resp = Response(era5_cache["gz" if use_gz else "raw"], mimetype="application/json")
        if use_gz:
            resp.headers["Content-Encoding"] = "gzip"
        resp.headers.update({"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"})
        return resp

    @app.get("/api/climate/era5_winter/<name>.csv")
    def api_era5_winter_csv(name):
        """The two supplied CSVs, unchanged."""
        if name not in ("regional_means_winter", "tile_year_values_winter"):
            abort(404)
        return send_from_directory(config.DATA_DIR / "climate" / "era5_winter", f"{name}.csv", as_attachment=True, mimetype="text/csv")

    @app.get("/api/layer/<dataset_id>")
    def api_layer(dataset_id):
        if dataset_id not in {"hazard_zones", "roads", "regions", "glaciers", "boundaries", "glacier_regions", "glacier_extents",
                              "major_glaciers", "hk_hotspots", "hk_tiles", "snow_stations", "hk_zones", "hk_tiles_windows",
                              "glaciers_pk", "glaciers_context", "glacier_extents_pk", "major_glaciers_pk", "study_area"}:
            abort(404)
        if dataset_id == "glaciers":
            return glacier_response()
        if dataset_id in ("hk_hotspots", "glaciers_pk", "glaciers_context"):
            return gzipped_layer(dataset_id)
        return jsonify(type="FeatureCollection", features=store.features(dataset_id),
                       metadata=store.meta(dataset_id))

    @app.get("/api/preparedness")
    def api_preparedness():
        return jsonify(store.preparedness())

    # ------------------------------------------------------- regional hotspot register
    def register_args():
        try:
            min_ha = float(request.args.get("min_ha") or 120)
        except ValueError:
            abort(400, description="min_ha must be a number")
        return max(5.0, min(min_ha, 1000.0))

    @app.get("/api/hotspots/regions")
    def api_region_hotspots():
        """Per-region hotspot lists with timeline, location and nearest populated area (Reports & exports window)."""
        return jsonify(hotspot_register.build(store, register_args()))

    @app.get("/api/export/region_hotspots.<fmt>")
    def api_export_region_hotspots(fmt):
        if fmt not in ("csv", "geojson"):
            abort(404)
        reg = (request.args.get("region") or "all").lower()
        data = hotspot_register.build(store, register_args())
        if not data["available"]:
            abort(404)
        groups = [g for g in data["regions"] if reg in ("all", g["id"])]
        if not groups:
            abort(400, description="Unknown region")
        feats = [f for g in groups for f in g["features"]]
        meta = {"dataset": "Regional hotspot register " + data["season"], "source": data["source"],
                "regions": [g["name"] for g in groups], "basis": [g["note"] for g in groups],
                "modelled_windows": [w["id"] + " " + w["label"] for w in data["windows"]], "not_modelled": data["not_modelled"],
                "nearest_populated_note": data["populated_note"], "min_ha_hindu_kush": data["min_ha"],
                "limitations": data["disclaimer"]}
        body = ("﻿" + exports.to_csv(feats, meta)) if fmt == "csv" else exports.to_geojson(feats, meta)   # BOM: Excel reads UTF-8
        fname = f"pak-avalanche_hotspots_{reg}_{date.today():%Y%m%d}.{fmt}"
        return Response(body, mimetype="text/csv" if fmt == "csv" else "application/geo+json",
                        headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    @app.get("/api/export/<dataset_id>.<fmt>")
    def api_export(dataset_id, fmt):
        if dataset_id not in EXPORTABLE or fmt not in ("csv", "geojson"):
            abort(404)
        a = request.args
        region, window = region_arg(), a.get("window")
        if dataset_id == "incidents":
            feats = store.incidents(region=region, date_from=_iso(a.get("from")), date_to=_iso(a.get("to")),
                                    verification=a.get("verification"), q=(a.get("q") or "")[:100] or None)
        elif dataset_id == "settlements":
            feats = store.settlements(region, window, a.get("exposure"))
        elif dataset_id == "roads":
            feats = store.roads(region, window)
        elif dataset_id == "hk_hotspots":
            feats = hk_hotspot_filter(store.features("hk_hotspots"), a)
        elif dataset_id == "hk_tiles":
            feats = store.features("hk_tiles")
        else:
            feats = store.regions()
        m = store.meta(dataset_id) or {}
        meta = {"dataset": m.get("title", dataset_id), "source": m.get("source"),
                "data_date": m.get("data_date"), "limitations": m.get("limitations"),
                "field_definitions": m.get("fields"),
                "filters": {"region": region, "window": window,
                            **{k: v for k, v in a.items() if k not in ("region", "window")}}}
        body = exports.to_csv(feats, meta) if fmt == "csv" else exports.to_geojson(feats, meta)
        mime = "text/csv" if fmt == "csv" else "application/geo+json"
        fname = f"pak-avalanche_{dataset_id}_{region}_{date.today():%Y%m%d}.{fmt}"
        return Response(body, mimetype=mime, headers={"Content-Disposition": f'attachment; filename="{fname}"'})

    # ----------------------------------------------------------------- errors
    @app.errorhandler(400)
    @app.errorhandler(404)
    def client_error(e):
        if request.path.startswith("/api/"):
            return jsonify(error=getattr(e, "description", "Bad request")), e.code
        return e

    @app.errorhandler(Exception)
    def server_error(e):
        if hasattr(e, "code") and isinstance(getattr(e, "code"), int) and e.code < 500:
            return e
        log.exception("Unhandled error on %s", request.path)
        return jsonify(error="Internal error. The incident has been logged."), 500

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        return resp

    return app


app = create_app()

if __name__ == "__main__":
    log.info("Portal starting on http://%s:%s", Config.HOST, Config.PORT)
    # Prepare the large glacier layer in the background so the first visitor does not wait for it.
    threading.Thread(target=app.extensions["warm_glaciers"], daemon=True).start()
    if Config.DEBUG:
        # Auto-reloading development server; only when FLASK_DEBUG=1.
        app.run(host=Config.HOST, port=Config.PORT, debug=True)
    else:
        try:
            from waitress import serve
        except ImportError:
            log.error("Waitress is not installed. Run: pip install -r requirements.txt")
            raise SystemExit(1)
        serve(app, host=Config.HOST, port=Config.PORT, threads=8)
