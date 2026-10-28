"""Import the ERA5-Land winter (Dec-Feb) climate results 1970-2010 for the Snow page.

    python scripts/build_era5_winter.py "C:/Users/PC/Downloads/ERA5_Pakistan_results_winter"

Reads the run folder as supplied (regional_means_winter.csv, tile_year_values_winter.csv, the PNG figures and the MP4
videos) and writes
    data/climate/era5_winter.json          tiles x years x variables, regional series, derived trends and correlations
    data/climate/era5_winter/*.csv         the two CSVs, copied unchanged (served for download)
    static/img/era5_winter/*               the figures and videos, copied unchanged

Values are copied as supplied, with two documented exceptions:
  * snow cover: the supplied column is labelled % but runs 0-10,000, so it is divided by 100 (0-100 %);
  * trends (OLS slope x 10, per decade) and correlations are derived here from the OBSERVED years only:
    rows flagged estimated=True (1974) are kept for display but never enter a trend or a correlation.
Needs numpy (system Python).
"""
import csv
import json
import shutil
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "climate" / "era5_winter.json"
RAW = ROOT / "data" / "climate" / "era5_winter"
IMG = ROOT / "static" / "img" / "era5_winter"

# key in the tile CSV (column position), key in the regional CSV, label, unit, decimals, scale applied
VARS = [
    ("t2m", 6, "t2m", "Air temperature (2 m)", "°C", 2, 1),
    ("tmin", 7, "tmin", "Minimum temperature", "°C", 2, 1),
    ("snowd", 8, "snowd", "Snow depth", "cm", 1, 1),
    ("cover", 9, "cover", "Snow cover", "%", 1, 0.01),
    ("swe", 10, "swe", "Snow water equivalent", "mm", 1, 1),
    ("snowf", 11, "snowf", "Snowfall (season total)", "mm w.e.", 1, 1),
    ("precip", 12, "precip", "Precipitation (season total)", "mm", 1, 1),
    ("melt", 13, "melt", "Snowmelt (season total)", "mm w.e.", 1, 1),
    ("wind", 14, "wind", "Wind speed (10 m)", "m/s", 2, 1),
]
REGIONS = [("pakistan", "All tiles"), ("Hindu_Kush", "Hindu Kush"), ("Karakoram", "Karakoram"), ("Western_Himalaya", "Western Himalaya")]
FILES = ["0_study_area.png", "A_snapshots_every_5_years.png", "B_trend_per_decade.png", "C_snow_temperature_link.png",
         "D_regional_timeseries.png", "1_Pakistan_6maps_5yrs_per_second.mp4", "2_Pakistan_snow_vs_temperature.mp4"]


def read_csv(p):
    # The supplied files carry a Latin-1 degree sign in two headers; column positions are used, not names.
    with open(p, newline="", encoding="latin-1") as f:
        rows = list(csv.reader(f))
    return rows[0], rows[1:]


def slope_per_decade(years, vals, obs):
    x, y = np.asarray(years, float)[obs], np.asarray(vals, float)[obs]
    ok = np.isfinite(y)
    if ok.sum() < 10 or np.ptp(y[ok]) == 0:
        return 0.0 if ok.sum() >= 10 else None
    return float(np.polyfit(x[ok], y[ok], 1)[0] * 10)


def corr(a, b, obs):
    a, b = np.asarray(a, float)[obs], np.asarray(b, float)[obs]
    if np.std(a) == 0 or np.std(b) == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def main(run):
    run = Path(run)
    _, reg = read_csv(run / "regional_means_winter.csv")
    head_r, _ = read_csv(run / "regional_means_winter.csv")
    years = [int(r[0]) for r in reg]
    est = [r[1].strip().lower() == "true" for r in reg]
    obs = np.array([not e for e in est])
    col = {h: i for i, h in enumerate(head_r)}

    regional = {}
    for key, _, rkey, *_rest in VARS:
        dec, scale = _rest[2], _rest[3]
        regional[key] = {}
        for rg, _lbl in REGIONS:
            vals = [round(float(r[col[f"{rkey}_{rg}"]]) * scale, dec) for r in reg]
            regional[key][rg] = {"values": vals, "trend_per_decade": slope_per_decade(years, vals, obs),
                                 "mean_observed": float(np.mean(np.asarray(vals)[obs]))}

    _, rows = read_csv(run / "tile_year_values_winter.csv")
    tiles = {}
    for r in rows:
        t = tiles.setdefault(r[2], {"id": r[2], "lon": float(r[3]), "lat": float(r[4]), "frac": float(r[5]), "v": {}})
        yi = years.index(int(r[0]))
        for key, ci, _, _, _, dec, scale in VARS:
            t["v"].setdefault(key, [None] * len(years))[yi] = round(float(r[ci]) * scale, dec)
    out_tiles = []
    for t in sorted(tiles.values(), key=lambda t: (t["lat"], t["lon"])):
        t["tr"] = {k: (None if (s := slope_per_decade(years, t["v"][k], obs)) is None else round(s, 3)) for k, *_ in VARS}
        c = corr(t["v"]["t2m"], t["v"]["snowd"], obs)
        t["r_t2m_snowd"] = None if c is None else round(c, 3)
        out_tiles.append(t)

    pk_t = [np.mean([t["v"]["t2m"][i] for t in out_tiles]) for i in range(len(years))]
    pk_s = [np.mean([t["v"]["snowd"][i] for t in out_tiles]) for i in range(len(years))]
    meta = {
        "title": "Northern Pakistan winter climate 1970-2010 (ERA5-Land reanalysis)",
        "season": "Winter = December-February (DJF); season totals summed over DJF",
        "years": years, "estimated": est,
        "estimated_note": "1974 is flagged estimated in the supplied run (no complete source data). It is shown hatched and is excluded from every trend and correlation here.",
        "tiles": len(out_tiles), "resolution": "0.25° tiles (~25 km), ERA5-Land aggregated by the notebook",
        "regions": [{"key": k, "label": l} for k, l in REGIONS],
        "vars": [{"key": k, "label": l, "unit": u, "decimals": d} for k, _, _, l, u, d, _ in VARS],
        "cover_note": "Snow cover is supplied labelled % but runs 0-10,000; it is divided by 100 here (0-100 %).",
        "cap_note": "ERA5-Land holds glacier cells at a fixed snow store (snow depth 3,333 cm, SWE 10,000 mm). Tiles and regions with glaciers (Karakoram above all) show these caps, not measured snow.",
        "trend_note": "Trend = least-squares slope over the observed winters 1970-2010 (1974 excluded), per decade. Not tested for significance.",
        "corr_note": "Correlation = Pearson r between winter air temperature and snow depth, year to year, observed winters only.",
        "pakistan_scatter_r": round(corr(pk_t, pk_s, obs), 3),
        "source": "NGT ERA5 winter run (ERA5_Pakistan_results_winter): ERA5-Land monthly reanalysis via Google Earth Engine, aggregated to 0.25° tiles inside the Pakistan border",
        "reanalysis_note": "Reanalysis is a model reconstruction of past weather, not station measurements. Not validated against observations here.",
        "figures": [f for f in FILES if (run / f).exists()],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"meta": meta, "regional": regional, "tiles": out_tiles}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    RAW.mkdir(parents=True, exist_ok=True)
    for f in ("regional_means_winter.csv", "tile_year_values_winter.csv"):
        shutil.copy2(run / f, RAW / f)
    IMG.mkdir(parents=True, exist_ok=True)
    for f in meta["figures"]:
        shutil.copy2(run / f, IMG / f)
    print(f"{len(out_tiles)} tiles x {len(years)} winters -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    print("Pakistan t2m trend/decade", round(regional["t2m"]["pakistan"]["trend_per_decade"], 3),
          "| r(t2m, snowd) all tiles", meta["pakistan_scatter_r"])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "Downloads" / "ERA5_Pakistan_results_winter")
