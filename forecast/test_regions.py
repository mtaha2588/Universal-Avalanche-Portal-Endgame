"""
test_regions.py - every tile gets exactly one region (user request)
=====================================================================
Standalone, not part of the main portal's `pytest tests` run (forecast/ has its own
dependencies; see README_PORTAL.md). Run from the forecast/ folder:
    python test_regions.py
or, if pytest is installed in the same environment:
    pytest test_regions.py -v
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forecast_core as fc  # noqa: E402

THREE_REGIONS = {"Hindu Kush", "Karakoram", "West Himalaya"}


def _tile_centres():
    """Every tile centre the live forecast actually rates, from data/tile_thresholds.csv."""
    import pandas as pd
    tt = pd.read_csv(os.path.join(HERE, "data", "tile_thresholds.csv"))
    ll = tt.tile_id.str.extract(r"N([\d.]+)_E([\d.]+)").astype(float)
    return list(zip(ll[0], ll[1]))


def test_every_tile_gets_exactly_one_region():
    for lat, lon in _tile_centres():
        r = fc.region(lat, lon)
        assert r in THREE_REGIONS, f"tile at {lat},{lon} got an unknown region: {r!r}"


def test_region_partition_is_total_and_disjoint_on_a_grid():
    """Every (lat, lon) on a fine grid across the study area gets exactly one of the 3 names
    (the rule is three nested conditions over the whole plane, so this also catches gaps/overlaps
    a reviewer might introduce by editing config/regions.json's numbers inconsistently)."""
    lat = 32.0
    while lat <= 38.0:
        lon = 69.0
        while lon <= 78.0:
            r = fc.region(lat, lon)
            assert r in THREE_REGIONS, f"({lat:.2f},{lon:.2f}) -> {r!r}"
            lon += 0.1
        lat += 0.1


def test_region_config_is_loaded():
    with open(os.path.join(HERE, "config", "regions.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    assert set(cfg["names"].values()) == THREE_REGIONS
    # forecast_core must actually be reading this file, not just the hardcoded fallback
    fc._regions_cfg = None  # noqa: SLF001 - force a re-read for this check
    r = fc._regions()
    assert r["lon_hindu_kush_max"] == cfg["lon_hindu_kush_max"]
    assert r["lat_split"] == cfg["lat_split"]
    assert r["lon_karakoram_min"] == cfg["lon_karakoram_min"]


def test_user_example_points():
    # Hindu Raj / Ghizer / Yasin band: lat >= 35.1, lon < 73.6 -> Hindu Kush
    assert fc.region(36.0, 73.0) == "Hindu Kush"
    # Hazara / lower Kohistan / Neelum / Leepa / Astore: lat < 35.1, lon >= 72.8 -> West Himalaya
    assert fc.region(34.5, 73.2) == "West Himalaya"
    # Karakoram: lat >= 35.1, lon >= 73.6
    assert fc.region(36.0, 75.0) == "Karakoram"
    # Chitral-Dir-Swat: lon < 72.8 -> Hindu Kush, at any latitude
    assert fc.region(34.0, 72.0) == "Hindu Kush"
    assert fc.region(37.0, 72.0) == "Hindu Kush"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    ok = 0
    for t in tests:
        try:
            t()
            print(f"  ok  {t.__name__}")
            ok += 1
        except AssertionError as e:
            print(f"FAIL  {t.__name__}: {e}")
    print(f"\n{ok}/{len(tests)} passed")
    sys.exit(0 if ok == len(tests) else 1)
