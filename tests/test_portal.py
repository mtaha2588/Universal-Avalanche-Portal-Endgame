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
    src = {row["event_id"]: row for row in csv.DictReader((ROOT / "data/history/events/avalanche_events_pakistan_compiled.csv").open(encoding="utf-8"))}
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
    assert ids["PK027"]["anim"] is None and ids["PK038"]["anim"] is None    # earthquake candidate, glacier movement


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
