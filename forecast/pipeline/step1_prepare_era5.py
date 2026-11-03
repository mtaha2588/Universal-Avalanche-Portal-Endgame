"""
STEP 1 - Clean ERA5 daily tiles and build avalanche driver features
====================================================================
Northern Pakistan snow-avalanche project (ERA5 / ERA5-Land, 0.25 deg tiles)

What it does
  1. Reads every ERA5_NPak_daily_*.csv in a folder (single years or multi-year
     files like 1970_1974, "Copy of ..." names are fine), in date order.
  2. Fixes known problems in the extraction:
       - hs_m is PHYSICAL snow depth (m), not m w.e.  -> renamed snow_depth_m
       - hs_phys_m divided by density twice -> dropped
       - tg_snow_kpm recomputed with the correct depth
       - snow_cover_frac is 0-100 -> renamed snow_cover_pct
       - ptype_max_code was spatially averaged (not a valid code) -> dropped
       - empty columns (pressure levels) dropped automatically
  3. Builds multi-day avalanche drivers per tile (new-snow load, rain on snow,
     warming, wind loading, faceting, clear nights, moisture transport...).
     A 10-day buffer is carried across files so rolling windows don't break
     at year boundaries.
  4. Writes one feature file per input file + a tile table with approximate
     elevation and a glacier / perennial-snow flag + a QC report.

Usage (Windows example)
  python step1_prepare_era5.py "D:\\ERA5_NPak" "D:\\ERA5_NPak\\processed"

Needs: pandas, numpy (pyarrow optional -> parquet, else csv.gz)
"""
import sys, re, glob, os
import numpy as np
import pandas as pd

BUFFER_DAYS = 30            # history carried between files for rolling windows
FACET_TG = 10.0             # K/m, temperature gradient that favours faceting
MIN_DEPTH_TG = 0.10         # m, only compute gradient with >= 10 cm of snow
CLEAR_NIGHT_TCC = 0.3       # night cloud cover below this = clear night
SNOW_ON_GROUND_SWE = 10.0   # mm, "snowpack present" for rain-on-snow
SNOW_DAY_MM = 1.0           # mm w.e., a "snowing" day for wind loading

DROP_ALWAYS = ["hs_phys_m", "ptype_max_code", "tg_snow_kpm"]

try:
    import pyarrow  # noqa: F401
    FMT = "parquet"
except ImportError:
    FMT = "csv.gz"


def first_year(path):
    yrs = re.findall(r"(19\d{2}|20\d{2})", os.path.basename(path))
    return int(yrs[0]) if yrs else 9999


def clean(df):
    df = df.drop(columns=[c for c in DROP_ALWAYS if c in df.columns])
    df = df.rename(columns={"hs_m": "snow_depth_m", "snow_cover_frac": "snow_cover_pct"})
    df["date"] = pd.to_datetime(df["date"])
    # correct snowpack temperature gradient (ground - surface) / depth
    d = df["snow_depth_m"]
    df["tg_kpm"] = np.where(d >= MIN_DEPTH_TG,
                            (df["soil1_mean_c"] - df["skin_mean_c"]) / d, np.nan)
    if {"viwve_kgms", "viwvn_kgms"} <= set(df.columns):
        df["ivt_kgms"] = np.hypot(df["viwve_kgms"], df["viwvn_kgms"])
    return df


def add_features(df):
    """Rolling drivers, computed per tile on a date-sorted frame."""
    df = df.sort_values(["tile_id", "date"]).reset_index(drop=True)
    g = df.groupby("tile_id", sort=False)

    def roll(col, w, how="sum"):
        r = g[col].rolling(w, min_periods=1)
        r = getattr(r, how)()
        return r.reset_index(level=0, drop=True)

    # 1. New-snow load (main dry-slab trigger)
    for w in (3, 5, 7):
        df[f"sf_{w}d_mm"] = roll("snowfall_mmwe", w)
    df["precip_3d_mm"] = roll("precip_mm", 3)
    df["dhs_3d_m"] = df["snow_depth_m"] - g["snow_depth_m"].shift(3)
    df["dswe_3d_mm"] = df["swe_mm"] - g["swe_mm"].shift(3)

    # 2. Rain on snow (wet-snow trigger)
    snow_yday = g["swe_mm"].shift(1) >= SNOW_ON_GROUND_SWE
    df["ros_mm"] = np.where(snow_yday, df["rain_mm"], 0.0)
    df["ros_3d_mm"] = roll("ros_mm", 3)

    # 3. Warming / melt (wet-snow & spring avalanches)
    df["tmax_rise_3d_c"] = df["t2m_max_c"] - g["t2m_max_c"].shift(3)
    df["tmean_3d_c"] = roll("t2m_mean_c", 3, "mean")
    df["melt_3d_mm"] = roll("snowmelt_mm", 3)
    if "deg0l_m" in df.columns:
        df["deg0l_max_3d_m"] = roll("deg0l_m", 3, "max")

    # 4. Wind loading: strongest wind on snowing days
    df["wind_on_snow_ms"] = np.where(df["snowfall_mmwe"] >= SNOW_DAY_MM, df["ws10_max_ms"], 0.0)
    df["wind_on_snow_3d_ms"] = roll("wind_on_snow_ms", 3, "max")
    df["gust_max_3d_ms"] = roll("gust10_max_ms", 3, "max")

    # 5. Weak layers: faceting days and clear nights before the storm
    df["facet_day"] = (df["tg_kpm"] > FACET_TG).astype("int8")
    df["facet_days_7d"] = roll("facet_day", 7)
    df["facet_days_30d"] = roll("facet_day", 30)
    df["clear_night"] = (df["tcc_night"] < CLEAR_NIGHT_TCC).astype("int8")
    # clear nights in the 7 days BEFORE the last 3 days (surface hoar then buried)
    df["clear_nights_prior_7d"] = g["clear_night"].shift(3).groupby(df["tile_id"]).rolling(7, min_periods=1).sum().reset_index(level=0, drop=True)

    # 6. Storm signature
    df["mslp_drop_3d_hpa"] = df["mslp_hpa"] - g["mslp_hpa"].shift(3)
    if "ivt_kgms" in df.columns:
        df["ivt_max_3d_kgms"] = roll("ivt_kgms", 3, "max")
    if "tcwv_kgm2" in df.columns:
        df["tcwv_max_3d_kgm2"] = roll("tcwv_kgm2", 3, "max")

    # season labels
    m = df["date"].dt.month
    df["winter_year"] = np.where(m >= 10, df["date"].dt.year + 1, df["date"].dt.year)
    df["season"] = np.select([m.isin([11, 12, 1, 2]), m.isin([3, 4, 5])],
                             ["dry_winter", "spring_wet"], "summer_autumn")
    return df


def main(in_dir, out_dir):
    files = sorted(glob.glob(os.path.join(in_dir, "*ERA5_NPak_daily_*.csv")), key=first_year)
    if not files:
        sys.exit(f"No ERA5_NPak_daily_*.csv files in {in_dir}")
    os.makedirs(os.path.join(out_dir, "features"), exist_ok=True)

    buffer = None
    last_date = None
    tile_stats = []          # per tile per winter-year minimum SWE, mean sp, max swe
    tile_sets = []           # which tiles each file contains (boundary changes)
    qc = []
    for f in files:
        print("reading", os.path.basename(f))
        df = pd.read_csv(f)
        df = df.dropna(axis=1, how="all")          # empty pressure-level columns
        df = clean(df)
        n0 = len(df)
        df = df.drop_duplicates(["tile_id", "date"])
        if last_date is not None:
            df = df[df["date"] > last_date]          # remove overlap with previous file
        if df.empty:
            qc.append(f"{os.path.basename(f)}: fully overlapped, skipped")
            continue
        start, end = df["date"].min(), df["date"].max()
        expect = (end - start).days + 1
        per_tile = df.groupby("tile_id").size()
        qc.append(f"{os.path.basename(f)}: {start.date()} to {end.date()}, {df.tile_id.nunique()} tiles, "
                  f"rows {n0} (dupes/overlap removed {n0-len(df)}), tiles with missing days: "
                  f"{(per_tile < expect).sum()}")
        if last_date is not None and (start - last_date).days > 1:
            qc.append(f"   GAP: no data between {last_date.date()} and {start.date()}")

        tset = set(df["tile_id"].unique())
        if tile_sets and tset != tile_sets[-1]:
            qc.append(f"   TILE SET CHANGED: {len(tile_sets[-1] - tset)} tiles dropped, "
                      f"{len(tset - tile_sets[-1])} tiles added vs previous file")
        tile_sets.append(tset)
        n_new = len(df)
        full = pd.concat([buffer, df], ignore_index=True) if buffer is not None else df
        full = add_features(full)
        out = full[full["date"] >= start]
        out = out.astype({c: "float32" for c in out.select_dtypes("float64").columns})

        name = f"era5_features_{start.year}_{end.year}.{FMT}"
        path = os.path.join(out_dir, "features", name)
        out.to_parquet(path, index=False) if FMT == "parquet" else out.to_csv(path, index=False, compression="gzip")

        s = out.groupby(["tile_id", "winter_year"]).agg(swe_min=("swe_mm", "min"), swe_max=("swe_mm", "max"),
                                                       sp=("sp_hpa", "mean"), lon=("lon", "first"), lat=("lat", "first"))
        tile_stats.append(s.reset_index())

        keep_from = end - pd.Timedelta(days=BUFFER_DAYS - 1)
        raw_cols = [c for c in df.columns]
        buffer = df[df["date"] >= keep_from][raw_cols]
        last_date = end
        print(f"   wrote {name} ({n_new} rows)")

    # ---- tile table: elevation proxy + glacier/perennial flag
    ts = pd.concat(tile_stats)
    ts = ts.groupby(["tile_id", "winter_year"]).agg(swe_min=("swe_min", "min"), swe_max=("swe_max", "max"),
                                                   sp=("sp", "mean"), lon=("lon", "first"), lat=("lat", "first")).reset_index()
    tiles = ts.groupby("tile_id").agg(lon=("lon", "first"), lat=("lat", "first"), sp_hpa=("sp", "mean"),
                                      median_annual_min_swe_mm=("swe_min", "median"),
                                      max_swe_mm=("swe_max", "max")).reset_index()
    # standard-atmosphere height from surface pressure (approximate; replace with DEM mean later)
    tiles["elev_approx_m"] = (44330.8 * (1 - (tiles["sp_hpa"] / 1013.25) ** 0.190263)).round(0)
    tiles["glacier_capped"] = tiles["max_swe_mm"] >= 9990
    tiles["perennial_snow"] = tiles["median_annual_min_swe_mm"] > 50
    common = set.intersection(*tile_sets)
    tiles["in_all_files"] = tiles["tile_id"].isin(common)
    tiles["use_for_thresholds"] = (~(tiles["glacier_capped"] | tiles["perennial_snow"])
                                   & tiles["in_all_files"])
    tiles.to_csv(os.path.join(out_dir, "tiles.csv"), index=False)
    missing = tiles.loc[~tiles.in_all_files, "tile_id"].tolist()
    if missing:
        with open(os.path.join(out_dir, "tiles_not_in_all_years.txt"), "w") as fh:
            fh.write("\n".join(missing))

    qc.append("")
    qc.append(f"Tiles present in EVERY file: {len(common)} of {len(tiles)} "
              f"({len(missing)} excluded from thresholds, listed in tiles_not_in_all_years.txt)")
    qc.append(f"Tiles: {len(tiles)} | glacier-capped (SWE hits 10 m): {tiles.glacier_capped.sum()} | "
              f"perennial snow (snow never melts out): {tiles.perennial_snow.sum()} | "
              f"usable for thresholds: {tiles.use_for_thresholds.sum()}")
    qc.append(f"Approx. elevation range of usable tiles: "
              f"{tiles.loc[tiles.use_for_thresholds,'elev_approx_m'].min():.0f} - "
              f"{tiles.loc[tiles.use_for_thresholds,'elev_approx_m'].max():.0f} m")
    with open(os.path.join(out_dir, "qc_report.txt"), "w") as fh:
        fh.write("\n".join(qc))
    print("\n".join(qc))
    print("\nDone. Output in", out_dir)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])