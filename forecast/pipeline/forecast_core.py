"""
forecast_core.py - shared engine of the avalanche alert forecast
================================================================
Used by step6_forecast.py (analysis PC: live + replay) and by
run_forecast.py (portal PC). Contains: download from Open-Meteo (ECMWF IFS),
daily aggregation, avalanche drivers, the alert rule (with the final
safeguards), student risk score, and all output files for the portal.

Alert rule (per tile, thresholds = tile's own ERA5 winter percentiles, step 3)
  MODERATE  STORM  3-day snowfall >= P95 and >= 10 mm  AND  3-day max gust >= P95
            WARM   3-day Tmax rise >= P95 AND 7-day snowfall >= P90 and >= 20 mm AND snowpack
  HIGH      STORM  3-day snowfall >= P99 and >= 25 mm  AND  3-day max gust >= P90
            WARM   same warm part as above (HIGH thresholds)
  Tiles with mean elevation below MIN_ELEV_M are not rated (no avalanche terrain).
  The two floors (25 mm, 20 mm) and the elevation mask were added after the
  forecast replays showed High alerts in low-snow / low-elevation tiles.
"""
import os, re, json, time, shutil
import numpy as np
import pandas as pd

DET_URL = "https://api.open-meteo.com/v1/ecmwf"
ENS_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"
HOURLY = ["temperature_2m", "precipitation", "rain", "snowfall", "snow_depth",
          "wind_gusts_10m", "pressure_msl", "freezing_level_height"]
LEVELS = {0: "Low", 1: "Moderate", 2: "High"}
COLORS = {0: "#d9e3ea", 1: "#f2a93b", 2: "#d7322b"}
MASKED = -1                                   # "not rated" (below avalanche terrain)

DEFAULTS = {
    "min_elev_m": 1200,            # tiles below this mean elevation are not rated
    "moderate_sf3d_floor_mm": 10,  # minimum 3-day snowfall for a MODERATE storm alert
    "high_sf3d_floor_mm": 25,      # minimum 3-day snowfall for a HIGH storm alert
    "warm_sf7d_floor_mm": 20,      # minimum 7-day snowfall for a warm-snow alert
    "snowpack_depth_m": 0.05,      # forecast snow depth that counts as a snowpack
    "snowpack_sf7d_mm": 30,        # ... or this much snow in the last 7 days
    "past_days": 7, "forecast_days": 15,
    "batch_deterministic": 50, "batch_ensemble": 8,
}


def region(lat, lon):
    if lon < 72.8:
        return "Hindu Kush (Chitral-Dir-Swat)"
    if lon < 73.6:
        return "Kohistan-Hazara"
    if lat < 35.1:
        return "Kashmir (Neelum-Leepa-Astore)"
    return "Karakoram (Gilgit-Baltistan)"


# ------------------------------------------------------------------ download
def get_json(url, params, apikey=None, tries=5):
    import requests
    if apikey:
        params = dict(params, apikey=apikey)
    for k in range(tries):
        try:
            r = requests.get(url, params=params, timeout=180)
            if r.status_code == 429:
                time.sleep(20 * (k + 1)); continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if k == tries - 1:
                raise RuntimeError(f"Open-Meteo request failed: {e}")
            time.sleep(5 * (k + 1))


def fetch(url, tiles, extra, batch, apikey=None, label="", log=print):
    out = []
    for i in range(0, len(tiles), batch):
        t = tiles.iloc[i:i + batch]
        params = {"latitude": ",".join(f"{v:.3f}" for v in t.lat),
                  "longitude": ",".join(f"{v:.3f}" for v in t.lon),
                  "elevation": ",".join(f"{v:.0f}" for v in t.elev_approx_m),
                  "hourly": ",".join(HOURLY), "models": "ecmwf_ifs025",
                  "wind_speed_unit": "ms", "precipitation_unit": "mm",
                  "timezone": "GMT", "cell_selection": "nearest"} | extra
        js = get_json(url, params, apikey)
        js = js if isinstance(js, list) else [js]
        for tid, loc in zip(t.tile_id, js):
            h = loc.get("hourly", {})
            times = pd.to_datetime(h.get("time", []))
            cols = {}
            for key, vals in h.items():
                if key == "time":
                    continue
                m = re.match(r"^(.*?)(?:_member(\d+))?$", key)
                cols.setdefault(int(m.group(2) or 0), {})[m.group(1)] = np.array(
                    [np.nan if v is None else v for v in vals], dtype="float64")
            for mem, dd in cols.items():
                df = pd.DataFrame(dd)
                df["time"], df["member"], df["tile_id"] = times, mem, tid
                out.append(df)
        log(f"   {label}: {min(i + batch, len(tiles))}/{len(tiles)} tiles")
        time.sleep(1.0)
    return pd.concat(out, ignore_index=True)


def hourly_to_daily(h):
    h = h.copy()
    h["date"] = h.time.dt.floor("D")
    if "rain" in h and h["rain"].notna().any():
        h["snow_we"] = (h["precipitation"] - h["rain"]).clip(lower=0)
    else:   # Open-Meteo snowfall is cm of snow; 1 mm of water = 0.7 cm
        h["snow_we"] = h.get("snowfall", np.nan) / 0.7
    agg = {"snow_we": "sum", "precipitation": "sum", "rain": "sum", "temperature_2m": ["max", "mean"],
           "wind_gusts_10m": "max", "pressure_msl": "mean", "snow_depth": "mean",
           "freezing_level_height": "mean"}
    agg = {k: v for k, v in agg.items() if k in h}
    g = h.groupby(["tile_id", "member", "date"])
    d = g.agg(agg)
    d.columns = ["_".join(c) for c in d.columns]
    d["n_hours"] = g.size()
    d = d.reset_index().rename(columns={
        "snow_we_sum": "snowfall_mmwe", "precipitation_sum": "precip_mm", "rain_sum": "rain_mm",
        "temperature_2m_max": "t2m_max_c", "temperature_2m_mean": "t2m_mean_c",
        "wind_gusts_10m_max": "gust10_max_ms", "pressure_msl_mean": "mslp_hpa",
        "snow_depth_mean": "snow_depth_m", "freezing_level_height_mean": "deg0l_m"})
    for c in ["snowfall_mmwe", "precip_mm", "rain_mm", "t2m_max_c", "t2m_mean_c", "gust10_max_ms",
              "mslp_hpa", "snow_depth_m", "deg0l_m"]:
        if c not in d:
            d[c] = np.nan
    return d[d.n_hours >= 18].drop(columns="n_hours")       # drop incomplete days at the ends


# ------------------------------------------------------------------ drivers + rule
def drivers(d, cfg=DEFAULTS):
    d = d.sort_values(["tile_id", "member", "date"]).reset_index(drop=True)
    g = d.groupby(["tile_id", "member"], sort=False)

    def roll(col, w, how="sum"):
        return getattr(g[col].rolling(w, min_periods=1), how)().reset_index(level=[0, 1], drop=True)

    for w in (3, 5, 7):
        d[f"sf_{w}d_mm"] = roll("snowfall_mmwe", w)
    d["precip_3d_mm"] = roll("precip_mm", 3)
    if "swe_mm" in d and d["swe_mm"].notna().any():               # replay from ERA5
        pack = d["swe_mm"] >= 30
    else:                                                           # forecast
        pack = (d["snow_depth_m"] >= cfg["snowpack_depth_m"]) | (d["sf_7d_mm"] >= cfg["snowpack_sf7d_mm"])
    d["snowpack"] = pack.astype(float)
    g = d.groupby(["tile_id", "member"], sort=False)
    d["ros_mm"] = np.where(g["snowpack"].shift(1).fillna(0).values > 0, d["rain_mm"], 0.0)
    d["ros_3d_mm"] = roll("ros_mm", 3)
    d["tmax_rise_3d_c"] = d["t2m_max_c"] - g["t2m_max_c"].shift(3)
    d["tmean_3d_c"] = roll("t2m_mean_c", 3, "mean")
    d["gust_max_3d_ms"] = roll("gust10_max_ms", 3, "max")
    d["mslp_drop_3d_hpa"] = d["mslp_hpa"] - g["mslp_hpa"].shift(3)
    d["dhs_3d_m"] = d["snow_depth_m"] - g["snow_depth_m"].shift(3)
    d["dswe_3d_mm"] = (d["swe_mm"] - g["swe_mm"].shift(3)) if "swe_mm" in d else np.nan
    d["deg0l_max_3d_m"] = roll("deg0l_m", 3, "max")
    return d


def apply_rules(d, tt, cfg=DEFAULTS, final=True):
    """alert level per row: 0 Low, 1 Moderate, 2 High, -1 not rated (final rule only).
    final=False reproduces the original step-3 rule (no floors, no elevation mask)."""
    t = tt.reindex(d.tile_id)
    sf3, sf7 = d.sf_3d_mm.values, d.sf_7d_mm.values
    pack = d.snowpack.values > 0
    lvl = np.zeros(len(d), int)
    for k, name in [(1, "MODERATE"), (2, "HIGH")]:
        floor = 10.0
        if final:
            floor = cfg["moderate_sf3d_floor_mm"] if k == 1 else cfg["high_sf3d_floor_mm"]
        a = (sf3 >= t[f"{name}_sf3d_mm"].values) & (sf3 >= floor)
        if f"{name}_gust3d_ms" in t:
            a &= d.gust_max_3d_ms.values >= t[f"{name}_gust3d_ms"].values
        if f"{name}_tmax_rise3d_c" in t:
            w = (d.tmax_rise_3d_c.values >= t[f"{name}_tmax_rise3d_c"].values) & \
                (sf7 >= t[f"{name}_sf7d_mm"].values) & pack
            if final:
                w &= sf7 >= cfg["warm_sf7d_floor_mm"]
            a |= w
        if f"{name}_ros3d_mm" in t:
            a |= (d.ros_3d_mm.values >= t[f"{name}_ros3d_mm"].values) & pack
        lvl = np.where(a, np.maximum(lvl, k), lvl)
    if final:
        lvl = np.where(t.elev_approx_m.values < cfg["min_elev_m"], MASKED, lvl)
    return lvl


def student_score(d, model_path, pct_path, log=print):
    if not (os.path.exists(model_path) and os.path.exists(pct_path)):
        return None
    try:
        import joblib
        st = joblib.load(model_path)
    except Exception as e:      # e.g. different scikit-learn version on this PC
        log(f"   student model not used ({e.__class__.__name__}: {e})")
        return None
    pt = pd.read_parquet(pct_path)
    qcols = [c for c in pt.columns if c not in ("var", "tile_id")]
    qs = np.array([float(c) for c in qcols]) * 100
    X = pd.DataFrame(index=d.index)
    groups = d.groupby("tile_id").groups
    for f in st["features"]:
        if f.endswith("_p"):
            v = f[:-2]
            col = np.full(len(d), np.nan)
            tab = pt[pt["var"] == v].set_index("tile_id")[qcols]
            if v in d:
                for tid, idx in groups.items():
                    if tid not in tab.index:
                        continue
                    pos = d.index.get_indexer(idx)
                    vals = d[v].values[pos]
                    q = tab.loc[tid].values.astype(float)
                    qu, iu = np.unique(q, return_index=True)
                    ok = ~np.isnan(vals)
                    res = np.full(len(vals), np.nan)
                    res[ok] = np.interp(vals[ok], qu, qs[iu]) if len(qu) > 1 else 50.0
                    col[pos] = res
            X[f] = col
        else:
            X[f] = d[f].values if f in d else np.nan
    return st["model"].predict_proba(X[st["features"]])[:, 1]


# ------------------------------------------------------------------ whole run
def run(tiles, tt, cfg, mode="live", replay_daily=None, day0=None, apikey=None,
        ensemble=True, model_path=None, pct_path=None, student_thr=None, log=print):
    """returns (result frame with lead_day >= 0, metadata dict)"""
    ens_daily = None
    if mode == "replay":
        daily = replay_daily
        source = "ERA5 reanalysis (replay: what the system would have shown with a perfect forecast)"
    else:
        day0 = pd.Timestamp.now("UTC").tz_localize(None).floor("D")
        source = "ECMWF IFS 0.25 deg (open data) via Open-Meteo"
        log("downloading deterministic forecast ...")
        h = fetch(DET_URL, tiles, {"past_days": cfg["past_days"], "forecast_days": cfg["forecast_days"]},
                  cfg["batch_deterministic"], apikey, "deterministic", log)
        daily = hourly_to_daily(h)
        if ensemble:
            log("downloading 51-member ensemble ...")
            try:
                he = fetch(ENS_URL, tiles, {"past_days": cfg["past_days"], "forecast_days": cfg["forecast_days"]},
                           cfg["batch_ensemble"], apikey, "ensemble", log)
                ens_daily = hourly_to_daily(he)
            except Exception as e:
                log(f"   ensemble download failed, continuing without it: {e}")

    d = drivers(daily[daily.member == daily.member.min()].copy(), cfg)
    d["level"] = apply_rules(d, tt, cfg)
    d = d.merge(tiles[["tile_id", "region", "lat", "lon", "elev_approx_m"]], on="tile_id", how="left")
    if model_path:
        s = student_score(d, model_path, pct_path, log)
        if s is not None:
            d["student_risk"] = s
            if student_thr is not None:
                d["student_alert"] = d.student_risk >= student_thr

    if ens_daily is not None and len(ens_daily):
        e = drivers(ens_daily.copy(), cfg)
        if e["gust10_max_ms"].isna().all():
            gm = d.set_index(["tile_id", "date"]).gust_max_3d_ms
            e["gust_max_3d_ms"] = gm.reindex(pd.MultiIndex.from_frame(e[["tile_id", "date"]])).values
            log("   note: ensemble has no gusts; deterministic gusts used")
        e["level"] = apply_rules(e, tt, cfg)
        pr = e.groupby(["tile_id", "date"]).agg(
            p_moderate_ens=("level", lambda x: (x >= 1).mean()),
            p_high_ens=("level", lambda x: (x >= 2).mean()),
            n_members=("level", "size"),
            sf3d_ens_median=("sf_3d_mm", "median"),
            sf3d_ens_p90=("sf_3d_mm", lambda x: np.nanpercentile(x, 90))).reset_index()
        d = d.merge(pr, on=["tile_id", "date"], how="left")
        masked = d.level == MASKED
        d.loc[masked, ["p_moderate_ens", "p_high_ens"]] = np.nan

    d["lead_day"] = (d.date - day0).dt.days
    res = d[d.lead_day >= 0].copy()
    keep = ["tile_id", "region", "lat", "lon", "elev_approx_m", "date", "lead_day", "level",
            "snowfall_mmwe", "sf_3d_mm", "sf_7d_mm", "gust_max_3d_ms", "tmax_rise_3d_c", "ros_3d_mm",
            "snow_depth_m", "snowpack", "student_risk", "student_alert",
            "p_moderate_ens", "p_high_ens", "n_members", "sf3d_ens_median", "sf3d_ens_p90"]
    res = res[[c for c in keep if c in res]].reset_index(drop=True)
    res["level_name"] = res.level.map(lambda v: LEVELS.get(v, "Not rated"))
    meta = {"issued_for_date": str(pd.Timestamp(day0).date()),
            "generated_utc": pd.Timestamp.now("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
            "run_type": mode, "source": source,
            "ensemble_members": int(res.n_members.max()) if "n_members" in res and res.n_members.notna().any() else 0,
            "rule": rule_text(cfg)}
    return res, meta


def rule_text(cfg):
    return ("MODERATE: 3-day snowfall >= tile P95 (and >= %g mm) with 3-day max gust >= tile P95, "
            "or 3-day Tmax rise >= tile P95 after 7-day snowfall >= tile P90 (and >= %g mm) on a snowpack. "
            "HIGH: 3-day snowfall >= tile P99 (and >= %g mm) with gust >= tile P90, or the warm-snow part "
            "at HIGH thresholds. Tiles below %g m mean elevation are not rated."
            % (cfg["moderate_sf3d_floor_mm"], cfg["warm_sf7d_floor_mm"], cfg["high_sf3d_floor_mm"],
               cfg["min_elev_m"]))


# ------------------------------------------------------------------ outputs
def region_summary(res):
    r = res[res.level >= 0]
    rs = r.groupby(["region", "date"]).agg(
        max_level=("level", "max"),
        tiles_rated=("level", "size"),
        tiles_moderate_or_high=("level", lambda x: int((x >= 1).sum())),
        tiles_high=("level", lambda x: int((x >= 2).sum())),
        max_sf3d_mm=("sf_3d_mm", "max"),
        **({"max_p_moderate_ens": ("p_moderate_ens", "max"),
            "max_p_high_ens": ("p_high_ens", "max")} if "p_moderate_ens" in r else {}),
        **({"max_student_risk": ("student_risk", "max")} if "student_risk" in r else {})).reset_index()
    rs["max_level_name"] = rs.max_level.map(LEVELS)
    return rs


def _num(v, nd=2):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    try:
        return round(float(v), nd)
    except Exception:
        return v


INT_KEYS = {"level", "max_level", "tiles_rated", "tiles_moderate_or_high", "tiles_high", "lead_day"}


def _val(k, v, nd=3):
    if k in INT_KEYS and v is not None and not (isinstance(v, float) and np.isnan(v)):
        return int(v)
    if isinstance(v, str):
        return v
    return _num(v, nd)


def write_outputs(res, meta, tiles, out_dir, map_png=True, log=print):
    os.makedirs(out_dir, exist_ok=True)
    res = res.copy()
    res["date"] = pd.to_datetime(res.date).dt.strftime("%Y-%m-%d")
    days = sorted(res.date.unique())
    rs = region_summary(res)

    # 1. long table
    fl = {c: 3 for c in res.columns if res[c].dtype.kind == "f"}
    res.round(fl).to_csv(os.path.join(out_dir, "alerts_tiles_daily.csv"), index=False)
    rs.round({c: 3 for c in rs.columns if rs[c].dtype.kind == "f"}).to_csv(
        os.path.join(out_dir, "alerts_region_summary.csv"), index=False)

    # 2. GeoJSON: one feature per tile and day (filter on "date" or "lead_day" in the portal)
    feats = []
    for _, r in res.iterrows():
        lon, lat, h = r.lon, r.lat, 0.125
        props = {"tile_id": r.tile_id, "region": r.region, "date": r.date, "lead_day": int(r.lead_day),
                 "level": int(r.level), "level_name": r.level_name,
                 "color": COLORS.get(int(r.level), "#ffffff"),
                 "elev_m": _num(r.elev_approx_m, 0)}
        for c in ["sf_3d_mm", "sf_7d_mm", "gust_max_3d_ms", "tmax_rise_3d_c", "ros_3d_mm",
                  "snow_depth_m", "p_moderate_ens", "p_high_ens", "student_risk"]:
            if c in r:
                props[c] = _num(r[c], 3)
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "Polygon", "coordinates": [[
                          [lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h],
                          [lon - h, lat + h], [lon - h, lat - h]]]}})
    with open(os.path.join(out_dir, "alerts_tiles_daily.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "metadata": meta | {"days": days}, "features": feats}, f)

    # 3. compact JSON for dashboards
    js = meta | {"days": days, "levels": {str(k): v for k, v in LEVELS.items()} | {"-1": "Not rated"},
                 "colors": {str(k): v for k, v in COLORS.items()} | {"-1": "#ffffff"},
                 "regions": [], "highlights": []}
    for reg, g in rs.groupby("region"):
        js["regions"].append({"region": reg, "days": [
            {k: _val(k, v) for k, v in row.items() if k != "region"} for row in g.to_dict("records")]})
    hot = res[res.level >= 1].sort_values(["date", "level"], ascending=[True, False])
    for row in hot.to_dict("records"):
        js["highlights"].append({k: _val(k, row.get(k)) for k in ["date", "tile_id", "region", "level", "level_name",
                                 "lat", "lon", "sf_3d_mm", "gust_max_3d_ms", "tmax_rise_3d_c",
                                 "p_moderate_ens", "p_high_ens"] if k in row})
    with open(os.path.join(out_dir, "alerts_latest.json"), "w") as f:
        json.dump(js, f, indent=1)

    # 4. map panel
    if map_png:
        try:
            map_panel(res, tiles, days[:10], os.path.join(out_dir, "alert_maps.png"),
                      f"Avalanche alert level by tile - {meta['source']}\nissued {meta['issued_for_date']}",
                      ens="p_moderate_ens" in res)
        except Exception as e:
            log(f"   map not drawn: {e}")
    return rs


def map_panel(res, tiles, days, path, title, ens=False):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle, Patch
    n = len(days)
    ncol = min(n, 5)
    nrow = int(np.ceil(n / ncol))
    fig, axes = plt.subplots(nrow, ncol, figsize=(3.3 * ncol, 2.9 * nrow), squeeze=False)
    tl = tiles.set_index("tile_id")
    for ax, day in zip(axes.flat, days):
        r = res[res.date == day].set_index("tile_id")
        for tid, row in tl.iterrows():
            lv = int(r.level.get(tid, 0)) if tid in r.index else 0
            fc = COLORS.get(lv, "#ffffff")
            ax.add_patch(Rectangle((row.lon - .125, row.lat - .125), .25, .25, facecolor=fc,
                                   edgecolor="#c9d4dc" if lv == MASKED else "white", lw=.4,
                                   hatch="///" if lv == MASKED else None))
            if ens and tid in r.index and (r.loc[tid, "p_moderate_ens"] or 0) >= 0.3:
                ax.text(row.lon, row.lat, f"{r.loc[tid, 'p_moderate_ens'] * 100:.0f}", ha="center",
                        va="center", fontsize=4.5, color="#222")
        for x in (72.8, 73.6):
            ax.axvline(x, color="#9aa", lw=.5, ls="--")
        ax.plot([73.6, 77.5], [35.1, 35.1], color="#9aa", lw=.5, ls="--")
        ax.set_xlim(tl.lon.min() - .3, tl.lon.max() + .3)
        ax.set_ylim(tl.lat.min() - .3, tl.lat.max() + .3)
        ax.set_aspect(1 / np.cos(np.radians(35)))
        ax.set_title(pd.Timestamp(day).strftime("%a %d %b"), fontsize=9)
        ax.tick_params(labelsize=6)
    for ax in list(axes.flat)[n:]:
        ax.axis("off")
    handles = [Patch(color=COLORS[k]) for k in (0, 1, 2)] + [Patch(facecolor="#ffffff", edgecolor="#c9d4dc", hatch="///")]
    labels = ["Low", "Moderate", "High", "Not rated (low elevation)"]
    if ens:
        labels[0] += "   (numbers = % of ensemble members at Moderate+)"
    fig.legend(handles, labels, loc="lower center", ncol=4, fontsize=8, frameon=False)
    fig.suptitle(title, fontsize=10)
    fig.tight_layout(rect=(0, .05, 1, .95))
    fig.savefig(path, dpi=160)
    plt.close(fig)


def print_summary(res, meta, rs, out_dir, log=print):
    log(f"\n=== AVALANCHE ALERT FORECAST  ({meta['source']}) ===")
    log(f"issued for {meta['issued_for_date']} | {res.tile_id.nunique()} tiles "
        f"({int((res.groupby('tile_id')['level'].min() < 0).sum())} not rated, below elevation limit) | outputs in {out_dir}\n")
    if len(rs):
        piv = rs.pivot(index="region", columns="date", values="max_level_name").iloc[:, :10]
        piv.columns = [pd.Timestamp(c).strftime("%d %b") for c in piv.columns]
        log("Highest level per region and day:")
        log(piv.to_string())
    hot = res[res.level >= 1]
    if len(hot):
        log(f"\nTiles at Moderate or High: {hot.tile_id.nunique()} tiles on {hot.date.nunique()} days")
        show = [c for c in ["date", "tile_id", "region", "level_name", "sf_3d_mm", "gust_max_3d_ms",
                            "tmax_rise_3d_c", "p_moderate_ens", "student_risk"] if c in hot]
        h = hot.sort_values(["date", "level"], ascending=[True, False])[show].head(25)
        log(h.round({c: 2 for c in show if h[c].dtype.kind == "f"}).to_string(index=False))
    else:
        log("\nNo tile reaches Moderate or High in this forecast.")
