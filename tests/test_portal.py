import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app, default_season_year  # noqa: E402
from portal.services import spatial  # noqa: E402
from portal.services.windows import generate_windows, window_for_date  # noqa: E402


# ------------------------------------------------------------------ windows
def test_windows_cover_season_without_overlap():
    wins = generate_windows(2026)
    assert wins[0].start == date(2026, 12, 15)
    assert wins[-1].end == date(2027, 4, 15)
    for a, b in zip(wins, wins[1:]):
        assert a.end == b.start                      # contiguous, half-open
    days = [w.start + timedelta(d) for w in wins for d in range(w.days)]
    assert len(days) == len(set(days)) == (date(2027, 4, 15) - date(2026, 12, 15)).days
    assert all(w.days == 15 for w in wins[:-1]) and 1 <= wins[-1].days <= 15


def test_leap_year_season():
    wins = generate_windows(2027)  # Feb 2028 has 29 days
    assert sum(w.days for w in wins) == (date(2028, 4, 15) - date(2027, 12, 15)).days


def test_window_for_date_boundaries():
    w1, w2 = generate_windows(2026)[:2]
    assert window_for_date(w1.last_day).id == w1.id
    assert window_for_date(w2.start).id == w2.id
    assert window_for_date(date(2027, 4, 15)) is None   # end date excluded
    assert window_for_date(date(2026, 7, 1)) is None


def test_default_season():
    assert default_season_year(date(2026, 10, 14)) == 2026
    assert default_season_year(date(2027, 1, 10)) == 2026
    assert default_season_year(date(2026, 12, 15)) == 2026


# ------------------------------------------------------------------ spatial
def test_haversine_known_distance():
    # Gilgit -> Skardu straight-line is roughly 125 km
    d = spatial.haversine_km(74.3089, 35.9208, 75.6333, 35.2971)
    assert 115 < d < 140


def test_point_in_polygon_with_hole():
    sq = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
                                             [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]}
    assert spatial.point_in_polygon(1, 1, sq)
    assert not spatial.point_in_polygon(5, 5, sq)
    assert not spatial.point_in_polygon(11, 5, sq)


def test_classify_proximity_distinguishes_intersect_and_near():
    assert spatial.classify_proximity(0, True).startswith("Intersects")
    assert spatial.classify_proximity(1.0, False).startswith("Within")
    assert spatial.classify_proximity(5.0, False).startswith("Outside")
    assert spatial.classify_proximity(None, False).startswith("Not assessed")


# ---------------------------------------------------------------------- api
@pytest.fixture()
def client():
    app = create_app()
    app.testing = True
    return app.test_client()


def test_home_portal_and_report(client):
    home = client.get("/")
    assert home.status_code == 200 and b'href="/portal"' in home.data
    portal = client.get("/portal")
    assert portal.status_code == 200 and b'class="home-btn" href="/#home"' in portal.data
    r = client.get("/report?region=karakoram")
    assert r.status_code == 200 and b"Decision support" in r.data


def test_dem_tiles_local_or_redirect(client, tmp_path):
    # A tile on disk is served with a long cache; anything else is redirected to the public open-data copy.
    from config import Config

    class Cfg(Config):
        DATA_DIR = tmp_path
    (tmp_path / "dem" / "terrarium" / "3" / "5").mkdir(parents=True)
    (tmp_path / "dem" / "terrarium" / "3" / "5" / "3.png").write_bytes(b"PNG fake")
    c = create_app(Cfg).test_client()
    hit = c.get("/api/dem/3/5/3.png")
    assert hit.status_code == 200 and hit.data == b"PNG fake" and "immutable" in hit.headers["Cache-Control"]
    miss = c.get("/api/dem/3/5/2.png")
    assert miss.status_code == 302 and miss.headers["Location"].endswith("/elevation-tiles-prod/terrarium/3/5/2.png")
    assert c.get("/api/dem/3/9/2.png").status_code == 404      # outside the tile grid


def test_windows_api(client):
    j = client.get("/api/windows?season=2026").get_json()
    assert j["windows"][0]["id"] == "2026-27-W01"
    assert j["windows"][0]["end_exclusive"] == "2026-12-30"


def test_region_filter(client):
    allinc = client.get("/api/incidents").get_json()["features"]
    hk = client.get("/api/incidents?region=hindu_kush").get_json()["features"]
    assert 0 < len(hk) < len(allinc)
    assert client.get("/api/incidents?region=nowhere").status_code == 400


def test_bad_date_rejected(client):
    assert client.get("/api/incidents?from=yesterday").status_code == 400


def test_no_fabricated_predictions(client):
    j = client.get("/api/predictions?window=2026-27-W01").get_json()
    assert j["available"] is False and "features" not in j


def test_settlements_not_assessed_without_hazard_layer(client):
    feats = client.get("/api/settlements").get_json()["features"]
    assert feats and all(f["properties"]["exposure_category"].startswith("Not assessed") for f in feats)


def test_exports_match_filters(client):
    gj = json.loads(client.get("/api/export/incidents.geojson?region=karakoram").data)
    api = client.get("/api/incidents?region=karakoram").get_json()
    assert len(gj["features"]) == len(api["features"])
    assert gj["metadata"]["crs"].startswith("EPSG:4326") and "disclaimer" in gj["metadata"]
    csv = client.get("/api/export/settlements.csv?region=hindu_kush").data.decode()
    assert csv.startswith("# dataset:") and "lon,lat" in csv
    assert client.get("/api/export/secret.csv").status_code == 404


def test_path_traversal_in_window(client):
    j = client.get("/api/predictions?window=../../config").get_json()
    assert j["available"] is False


def test_glacier_layer_is_official_rgi(client):
    j = client.get("/api/layer/glaciers").get_json()
    systems = {f["properties"]["system"] for f in j["features"]}
    assert systems == {"Hindu Kush", "Karakoram", "West Himalaya"}
    assert len(j["features"]) == 37562
    assert "RGI" in j["metadata"]["source"] and j["metadata"]["status"] == "reference"


def test_boundary_layers(client):
    b = client.get("/api/layer/boundaries").get_json()
    layers = {f["properties"]["layer"] for f in b["features"]}
    assert layers == {"pakistan", "province", "disputed", "line"}
    names = {f["properties"]["name"] for f in b["features"] if f["properties"]["layer"] == "province"}
    assert {"Gilgit-Baltistan", "Khyber Pakhtunkhwa", "Azad Jammu & Kashmir"} <= names and "F.A.T.A." not in names
    assert any(f["properties"]["name"] == "Line of Control" for f in b["features"])
    r = client.get("/api/layer/glacier_regions").get_json()
    assert sorted(f["properties"]["o2region"] for f in r["features"]) == ["14-01", "14-02", "14-03"]


def test_glacier_extents_and_major_glaciers(client):
    e = client.get("/api/layer/glacier_extents").get_json()
    assert sorted(f["properties"]["name"] for f in e["features"]) == ["Hindu Kush", "Karakoram", "West Himalaya"]
    m = client.get("/api/layer/major_glaciers").get_json()
    names = {f["properties"]["name"] for f in m["features"]}
    assert {"Siachen Glacier", "Baltoro Glacier", "Biafo Glacier", "Batura Glacier"} <= names
    assert all(n.lower() != "nan" and not re.match(r"^[A-Z]{2}\d", n) for n in names)  # no blanks, no inventory codes


# ------------------------------------------------------- Hindu Kush screening
def test_hk_screening_run_and_layers(client):
    run = client.get("/api/screening/hindukush").get_json()
    if not run["available"]:
        pytest.skip("No Hindu Kush screening run imported")
    assert run["score_type"] == "screening_index"           # never presented as a probability
    hs = client.get("/api/layer/hk_hotspots").get_json()["features"]
    assert len(hs) == run["hotspots"]
    ranks = [f["properties"]["rank"] for f in hs]
    assert ranks == sorted(ranks) and ranks[0] == 1
    assert all(f["properties"]["area_ha"] >= run["hotspot_min_ha"] for f in hs)
    assert len(client.get("/api/layer/hk_tiles").get_json()["features"]) == run["tiles"]


def test_hk_export_filters(client):
    if not client.get("/api/screening/hindukush").get_json()["available"]:
        pytest.skip("No Hindu Kush screening run imported")
    r = client.get("/api/export/hk_hotspots.geojson?min_ha=200&facing=N,NW")
    feats = json.loads(r.data)["features"]
    assert r.status_code == 200 and feats
    assert all(f["properties"]["area_ha"] >= 200 and f["properties"]["facing"] in ("N", "NW") for f in feats)
    assert client.get("/api/export/hk_hotspots.csv?min_ha=abc").status_code == 400


# ------------------------------------------------------------------ historical events (compiled records + illustrative paths)
def test_history_events_keep_records_and_label_paths(client):
    import csv
    r = client.get("/api/history/events").get_json()
    assert r["available"] and "Illustrative" in r["metadata"]["method"]
    excluded = {"PK027"}                                                   # left out at the user's request (scripts/build_history_events.py EXCLUDED)
    src = {row["event_id"]: row for row in csv.DictReader((ROOT / "data/history/events/avalanche_events_pakistan_compiled.csv").open(encoding="utf-8"))
           if row["event_id"] not in excluded}
    feats = r["features"]
    assert len(feats) == len(src)
    for f in feats:
        p = f["properties"]
        for k, v in src[p["event_id"]].items():              # every compiled field is served unchanged
            assert p[k] == v
        assert p["loc"]["tier"] in "ABCDE"
        if p["loc"]["tier"] in "DE" or p["anim"] is None:
            assert p["anim"] is None and p["anim_reason"]   # valley-only / unlocated / non-avalanche records are never animated
        else:
            a = p["anim"]
            assert a["path"][0][2] > a["path"][-1][2] and a["drop_m"] > 0 and a["length_m"] > 200
        if p["loc"]["tier"] == "E":
            assert f["geometry"] is None
    ids = {f["properties"]["event_id"]: f["properties"] for f in feats}
    assert "PK027" not in ids and ids["PK038"]["anim"] is None              # earthquake candidate removed; glacier movement not animated


ROOT = Path(__file__).resolve().parents[1]


# ------------------------------------------------------------------ snow outlook 2026-27
def test_snow_outlook_api_states_its_limits(client):
    r = client.get("/api/forecast/snow").get_json()
    assert r["available"] and (r["thresholds_cm_3d"]["elevated"], r["thresholds_cm_3d"]["high"]) == (30.0, 50.0)
    assert r["inventory_events_matched"] == 0 and "not learned" in r["thresholds_cm_3d"]["note"]
    assert r["method_by_range"]["Hindu Kush"] == "Normal (no change)"
    cov = {c["id"]: c for c in r["window_coverage"]}
    assert cov["2026-27-W07"]["days_in_data"] == 15 and cov["2026-27-W09"]["days_in_data"] == 0


def test_snow_stations_leave_unmodelled_windows_empty(client):
    feats = client.get("/api/layer/snow_stations").get_json()["features"]
    assert len(feats) == 36
    for f in feats:
        p = f["properties"]
        assert p["h09"] is None and p["s09"] is None   # 14 Apr: no data, never estimated
        assert p["forecast_cm"] > 0 and p["range80_cm"][0] <= p["forecast_cm"] <= p["range80_cm"][1] + 1e-6
    hk = [f["properties"] for f in feats if f["properties"]["range"] == "Hindu Kush"]
    assert all(abs(p["pct_of_normal"] - 100) < 1e-6 for p in hk)


def test_era5_winter_climate_keeps_estimated_year_out(client):
    r = client.get("/api/climate/era5_winter").get_json()
    m = r["meta"]
    assert r["available"] and m["years"][0] == 1970 and m["years"][-1] == 2010 and len(r["tiles"]) == m["tiles"] == 305
    assert [y for y, e in zip(m["years"], m["estimated"]) if e] == [1974] and "excluded" in m["estimated_note"]
    assert "not station measurements" in m["reanalysis_note"]
    assert all(0 <= v <= 100 for t in r["tiles"] for v in t["v"]["cover"])   # supplied 0-10,000, shown as %
    assert all(len(t["v"]["t2m"]) == 41 for t in r["tiles"])
    assert client.get("/api/climate/era5_winter/tile_year_values_winter.csv").status_code == 200
    assert client.get("/api/climate/era5_winter/secret.csv").status_code == 404


def test_history_tour_keeps_its_own_class_names_and_crest_releases(client):
    # home.html's intro overlay owns `.cine` (pointer-events: none); the tour once reused it and its controls stopped taking clicks
    js = client.get("/static/js/histtour.js").data
    assert b'classList.add("cine")' not in js and b'classList.add("ht-cine")' in js and b'look: "real"' in js
    # snow on the upper mountain only: never near the run-out (valleys, towns), fading out at the image edge (no boundary)
    assert b"/static/js/snowcap.js" in client.get("/").data and b"SnowCap.local" in js
    sc = client.get("/static/js/snowcap.js").data
    assert b"floor + 300" in sc and b"smooth(0, 1, edge)" in sc
    feats = client.get("/api/history/events").get_json()["features"]
    rel = [f["properties"]["anim"]["release"] for f in feats if f["properties"].get("anim") and f["properties"]["anim"].get("mode") in ("impact", "band")]
    assert rel and all(r["below_crest_m"] <= 250 for r in rel)          # every path starts at the summit / top of its slope
    imp = [f["properties"]["anim"] for f in feats if f["properties"].get("anim") and f["properties"]["anim"].get("mode") == "impact"]
    assert imp and all(a["place_dist_m"] <= 2600 for a in imp)          # comes down towards the documented place (stored, shown)

def test_home_map_official_view_of_jammu_kashmir(client):
    # front page shows the whole of Jammu & Kashmir with Pakistan (official map), Indian-held part labelled; study area unchanged
    import json
    r = json.loads(client.get("/static/geo/official_view.geojson").data)
    layers = {f["properties"]["layer"]: f for f in r["features"]}
    assert set(layers) == {"mask", "iiojk"} and layers["iiojk"]["properties"]["name"] == "Indian Illegally Occupied Jammu & Kashmir"
    home = client.get("/").data
    assert b"/static/geo/official_view.geojson" in home and b"Indian Illegally Occupied" in home


def test_home_alert_forecast_dashboard_is_wired(client):
    home = client.get("/").data
    assert b'id: "alertforecast"' in home and b"dash: true" in home and b"AlertDash.open()" in home
    assert b"/static/js/alertdash.js" in home and b"/static/css/alertdash.css" in home and b"AlertDash.warm()" in home
    js = client.get("/static/js/alertdash.js").data
    assert b'"/api/alertforecast/"' in js and b'"latest"' in js and b'"tiles.geojson"' in js
    # the texts README_PORTAL.md section 6 asks the portal to show
    assert b"ECMWF IFS open data (CC BY 4.0), delivered by Open-Meteo.com." in js
    assert b"It does not assess individual slopes and is not an official avalanche danger rating." in js
    assert b"Next update about 15:00 / 03:00 PKT" in js and b"Back to Regional Dashboard" in js


def test_alertforecast_api_serves_calibrated_three_region_run(client):
    # forecast/data/ now holds the analysis team's calibrated per-tile thresholds (thresholds_meta.json says so);
    # the regions come from forecast/config/regions.json (Hindu Kush, Karakoram, West Himalaya).
    r = client.get("/api/alertforecast/latest").get_json()
    assert r["available"] is True
    assert r["thresholds"]["calibrated"] is True and r["thresholds"]["validation"]["high"]["events"] > 0
    assert r["days"] and r["regions"] and "rule" in r
    assert {g["region"] for g in r["regions"]} <= {"Hindu Kush", "Karakoram", "West Himalaya"}
    geo = client.get("/api/alertforecast/tiles.geojson").get_json()
    assert geo["type"] == "FeatureCollection" and len(geo["features"]) > 0
    f0 = geo["features"][0]["properties"]
    assert "tile_id" in f0 and "level" in f0 and "date" in f0 and "sf_3d_mm" in f0
    assert len({f["properties"]["tile_id"] for f in geo["features"]}) * len(r["days"]) == len(geo["features"])
    assert client.get("/api/alertforecast/alerts_tiles_daily.csv").status_code == 200
    assert client.get("/api/alertforecast/alerts_region_summary.csv").status_code == 200
    assert client.get("/api/alertforecast/secret.csv").status_code == 404


def _fake_open_meteo(elev, storm_days):
    """An Open-Meteo hourly answer: dry except `storm_days` (offsets from today) of heavy snow and strong gusts."""
    from datetime import datetime, timezone
    base = datetime.now(timezone.utc).date() - timedelta(days=7)
    times, pr, ra, sn, tm, gu = [], [], [], [], [], []
    for d in range(22):
        day = base + timedelta(days=d)
        storm = (d - 7) in storm_days
        for h in range(24):
            times.append(f"{day.isoformat()}T{h:02d}:00")
            pr.append(3.0 if storm else 0.0); ra.append(0.0); sn.append(2.1 if storm else 0.0)
            tm.append(-6.0); gu.append(30.0 if storm else 5.0)
    n = len(times)
    return {"elevation": elev, "hourly": {"time": times, "precipitation": pr, "rain": ra, "snowfall": sn, "temperature_2m": tm,
            "wind_gusts_10m": gu, "snow_depth": [0.5] * n, "pressure_msl": [1010.0] * n, "freezing_level_height": [None] * n}}


def test_point_forecast_runs_the_tile_rule_for_the_exact_place():
    from portal.services.point_forecast import OutsideArea, PointForecast
    root = Path(__file__).resolve().parent.parent
    calls = []
    def fake(params):
        calls.append(params); return _fake_open_meteo(fake.elev, {4, 5, 6})
    pf = PointForecast(root / "forecast", root / "data" / "boundaries" / "study_area.geojson", fetch=fake)
    fake.elev = 4300.0
    r = pf.forecast(35.6, 74.4)                                 # inside tile N35.625_E74.375
    assert r["tile"]["id"] == "N35.625_E74.375" and r["tile"]["relation"] == "inside" and r["region"] == "Karakoram"
    assert len(r["days"]) == 15 and r["elevation_m"] == 4300.0
    assert "elevation" not in calls[0] and calls[0]["latitude"] == "35.6000"   # Open-Meteo adjusts to the place's own height
    lv = [d["level"] for d in r["days"]]
    assert lv[:4] == [0, 0, 0, 0] and max(lv[4:9]) == 2         # 3 days x 72 mm w.e. with 30 m/s gusts -> High
    assert r["days"][4]["snowfall_mm"] == pytest.approx(72.0) and r["days"][6]["sf_3d_mm"] == pytest.approx(216.0)
    assert pf.forecast(35.6, 74.4)["cached"] is True and len(calls) == 1
    fake.elev = 1000.0                                          # same weather below the 1,200 m avalanche-terrain limit
    assert {d["level"] for d in pf.forecast(35.62, 74.38)["days"]} == {-1}
    assert r["level_kind"] == "calibrated"
    fake.elev = 4400.0                                          # glacier tile N36.875_E75.125 (perennial snow, not calibrated)
    g = pf.forecast(36.85, 75.1)
    assert g["level_kind"] == "none" and g["tile"] is None and g["grid_tile"]["id"] == "N36.875_E75.125"
    assert {d["level"] for d in g["days"]} == {None} and max(d["sf_3d_mm"] for d in g["days"]) > 100   # weather, no level
    k = pf.forecast(36.32, 74.65)                               # Karimabad: perennial-snow tile, calibrated tile 33 km away
    assert k["level_kind"] == "indicative" and k["tile"]["relation"] == "borrowed" and k["grid_tile"]["id"] == "N36.375_E74.625"
    with pytest.raises(OutsideArea):
        pf.forecast(31.55, 74.34)                               # Lahore: no forecast tile anywhere near
    assert len(calls) == 4


def test_point_forecast_endpoint_validates_input(client):
    assert client.get("/api/alertforecast/point?lat=abc&lon=74").status_code == 400
    r = client.get("/api/alertforecast/point?lat=31.55&lon=74.34").get_json()
    assert r["available"] is False and r["outside"] is True
    home_js = client.get("/static/js/alertdash.js").data
    assert b"point?lat=" in home_js and b"/static/alertdash/tiles_clip.json" in home_js
    clip = client.get("/static/alertdash/tiles_clip.json").get_json()
    assert clip["tiles"] and set(clip["regions"]) == {"Hindu Kush", "Karakoram", "West Himalaya"}
    unc = clip["uncalibrated"]["features"]                      # glacier / perennial-snow tiles up to 37.125 N, no thresholds
    assert len(unc) > 80 and max(float(f["properties"]["tile_id"][1:7]) for f in unc) >= 37.0
    cal = {line.split(",")[0] for line in (Path(__file__).resolve().parent.parent / "forecast/data/tile_thresholds.csv").read_text().splitlines()[1:]}
    assert not cal & {f["properties"]["tile_id"] for f in unc}


def test_home_intro_plus_showreel_is_wired(client):
    home = client.get("/").data
    assert b'data-act="reel"' in home and b"/static/js/showreel.js" in home and b"stopIntro" in home
    js = client.get("/static/js/showreel.js").data
    assert b"HistTour.open" in js and b"/portal#" in js and b'data-pg="' in js and b"Escape" in js


def test_own_scripts_are_revalidated(client):
    # browsers must never keep running an old copy of the portal's own code after an update
    for p in ("/static/js/avalanche.js", "/static/js/histtour.js", "/static/css/histtour.css"):
        assert client.get(p).headers.get("Cache-Control") == "no-cache"


def test_home_climate_data_module_is_wired(client):
    home = client.get("/").data
    assert b'special: "climate"' in home and b"/static/js/climatedata.js" in home and b"/static/css/climatedata.css" in home
    js = client.get("/static/js/climatedata.js").data
    assert b"/api/climate/era5_winter" in js and b"/api/forecast/snow" in js and b"not in the supplied run" in js
    assert b"1_Pakistan_6maps_5yrs_per_second.mp4" in js and b'target="_blank"' not in js   # run's video first; nothing opens a new tab


def test_hk_snow_zones_and_tiles(client):
    zones = client.get("/api/layer/hk_zones").get_json()["features"]
    tiles = client.get("/api/layer/hk_tiles_windows").get_json()["features"]
    assert 0 < len(zones) <= 10 and 0 < len(tiles) < 98          # tiles without a station zone stay blank
    assert all(t["properties"]["dist_km"] <= 60 and 0 <= t["properties"]["c03"] <= 100 for t in tiles)


# ------------------------------------------------------- home-page study area (Pakistan-administered)
def test_study_area_and_neutral_border(client):
    s = client.get("/api/layer/study_area").get_json()
    layers = {(f["properties"]["layer"], f["properties"].get("kind")) for f in s["features"]}
    assert {("study_area", None), ("mask", None), ("border", "international"), ("border", "claim")} <= layers
    area = next(f["properties"]["area_km2"] for f in s["features"] if f["properties"]["layer"] == "study_area")
    assert 850_000 < area < 900_000                       # Pakistan-administered area at 1:10m scale


def test_glaciers_clipped_to_study_area(client):
    summ = client.get("/api/glaciers/pakistan").get_json()
    g = client.get("/api/layer/glaciers_pk").get_json()["features"]
    assert len(g) == summ["total"]["n"] and set(summ["systems"]) == {"Hindu Kush", "Karakoram", "West Himalaya"}
    for f in g:
        p = f["properties"]
        assert p["area_pk_km2"] <= p["area_km2"] + 1e-6 and p["rgi_id"].startswith("RGI2000-v7.0-G-14")
        assert p["clipped"] or abs(p["area_pk_km2"] - p["area_km2"]) < 1e-6
    for s in summ["systems"].values():
        assert 0 < s["n"] <= s["rgi_n"] and 0 < s["km2"] <= s["rgi_km2"]
    assert "Siachen Glacier" in summ["outside_majors"]    # India-administered: context layer only
    m = client.get("/api/layer/major_glaciers_pk").get_json()["features"]
    assert any(f["properties"]["name"] == "Baltoro Glacier" and f["properties"]["in_study_area"] for f in m)


def test_region_hotspot_register_and_exports(client):
    d = client.get("/api/hotspots/regions").get_json()
    assert d["available"] and [g["id"] for g in d["regions"]] == ["hindu_kush", "karakoram", "himalaya"]
    for g in d["regions"]:
        assert g["count"] == len(g["features"])
        for f in g["features"]:
            p = f["properties"]
            assert p["timeline"] and p["nearest_populated"] and p["nearest_distance_km"] is not None
    for fmt in ("csv", "geojson"):
        r = client.get(f"/api/export/region_hotspots.{fmt}?region=himalaya")
        assert r.status_code == 200 and "attachment" in r.headers["Content-Disposition"]
    assert client.get("/api/export/region_hotspots.csv?region=nowhere").status_code == 400
