"""
run_forecast.py - Northern Pakistan avalanche alert forecast
============================================================
One script for both computers:
  * analysis PC  : point it at the "processed" folder (steps 1-5 outputs)
  * portal PC    : run it inside the deployment package folder

  python run_forecast.py [FOLDER]                     live ECMWF forecast (default)
  python run_forecast.py [FOLDER] --replay 2005-02-08 replay a past date from ERA5 features
  python run_forecast.py [FOLDER] --check             show what the API returns
  options: --no-ensemble  --apikey KEY  --features DIR (ERA5 feature files for replay)

FOLDER defaults to the folder this script is in.
Settings: <package>/config/settings.json (optional), API key also from env AVALANCHE_APIKEY.

Live outputs (package layout)                 Live outputs (processed layout)
  output/latest/   newest forecast              processed/forecast/run_<date>/
  output/archive/<date>_<HHMM>/  every run
  output/status.json  last run ok / failed
  logs/forecast_<YYYY-MM>.log
Files in each run folder: alerts_latest.json, alerts_tiles_daily.geojson,
  alerts_tiles_daily.csv, alerts_region_summary.csv, alert_maps.png
"""
import sys, os, glob, re, json, argparse, shutil, traceback
from datetime import datetime, timezone
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forecast_core as fc  # noqa: E402


def layout(base):
    """find inputs in either the processed folder or the deployment package"""
    if os.path.exists(os.path.join(base, "rules", "tile_thresholds.csv")):
        return {"kind": "processed",
                "thresholds": os.path.join(base, "rules", "tile_thresholds.csv"),
                "model": os.path.join(base, "model", "student.joblib"),
                "pct": os.path.join(base, "model", "percentile_tables.parquet"),
                "student_thr": os.path.join(base, "model", "student_thresholds.csv"),
                "features": os.path.join(base, "features"),
                "out_live": os.path.join(base, "forecast"),
                "settings": os.path.join(base, "settings.json"),
                "logs": os.path.join(base, "forecast", "logs")}
    if os.path.exists(os.path.join(base, "data", "tile_thresholds.csv")):
        return {"kind": "package",
                "thresholds": os.path.join(base, "data", "tile_thresholds.csv"),
                "model": os.path.join(base, "data", "student.joblib"),
                "pct": os.path.join(base, "data", "percentile_tables.parquet"),
                "student_thr": os.path.join(base, "data", "student_thresholds.csv"),
                "features": os.path.join(base, "era5_features"),
                "out_live": os.path.join(base, "output"),
                "settings": os.path.join(base, "config", "settings.json"),
                "logs": os.path.join(base, "logs")}
    sys.exit(f"Cannot find tile_thresholds.csv under {base} (expected rules/ or data/ subfolder).")


class Log:
    def __init__(self, folder):
        os.makedirs(folder, exist_ok=True)
        self.path = os.path.join(folder, f"forecast_{datetime.now():%Y-%m}.log")

    def __call__(self, msg=""):
        print(msg)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n")


def load_cfg(path):
    cfg = dict(fc.DEFAULTS)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cfg.update({k: v for k, v in json.load(f).items() if not k.startswith("_")})
    return cfg


def replay_input(features_dir, tiles, day, cfg):
    day = pd.Timestamp(day)
    start = day - pd.Timedelta(days=cfg["past_days"] + 3)
    end = day + pd.Timedelta(days=cfg["forecast_days"] - 1)
    cols = ["tile_id", "date", "snowfall_mmwe", "precip_mm", "rain_mm", "t2m_max_c", "t2m_mean_c",
            "gust10_max_ms", "mslp_hpa", "snow_depth_m", "deg0l_m", "swe_mm"]
    parts = []
    for f in sorted(glob.glob(os.path.join(features_dir, "era5_features_*"))):
        yrs = [int(y) for y in re.findall(r"(\d{4})", os.path.basename(f))]
        if yrs and (yrs[-1] < start.year or yrs[0] > end.year):
            continue
        df = pd.read_parquet(f) if f.endswith(".parquet") else pd.read_csv(f)
        df = df[[c for c in cols if c in df.columns]]
        df["date"] = pd.to_datetime(df.date)
        parts.append(df[(df.date >= start) & (df.date <= end) & df.tile_id.isin(tiles.tile_id)])
    if not parts or sum(len(p) for p in parts) == 0:
        sys.exit(f"No ERA5 features around {day.date()} in {features_dir}")
    d = pd.concat(parts, ignore_index=True)
    d["member"] = 0
    return d, day


def write_status(out_live, ok, msg, issued=None):
    os.makedirs(out_live, exist_ok=True)
    p = os.path.join(out_live, "status.json")
    st = {}
    if os.path.exists(p):
        try:
            st = json.load(open(p))
        except Exception:
            st = {}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    st.update({"last_attempt_utc": now, "ok": ok, "message": msg})
    if ok:
        st.update({"last_success_utc": now, "issued_for_date": issued})
    json.dump(st, open(p, "w"), indent=1)


def check(tiles, apikey):
    p = {"latitude": f"{tiles.lat.iloc[0]:.3f}", "longitude": f"{tiles.lon.iloc[0]:.3f}",
         "hourly": ",".join(fc.HOURLY), "models": "ecmwf_ifs025", "forecast_days": 2,
         "wind_speed_unit": "ms", "timezone": "GMT"}
    js = fc.get_json(fc.DET_URL, p, apikey)
    print("deterministic hourly_units:", json.dumps(js.get("hourly_units", {}), indent=1))
    for k, v in js.get("hourly", {}).items():
        if k != "time":
            print(f"  {k:24s} first values {v[:6]}  all-null={all(x is None for x in v)}")
    je = fc.get_json(fc.ENS_URL, p, apikey)
    keys = list(je.get("hourly", {}).keys())
    print(f"ensemble: {len(keys)} hourly keys")
    for v in fc.HOURLY:
        mem = [k for k in keys if re.match(rf"^{v}(_member\d+)?$", k)]
        nonnull = [k for k in mem if any(x is not None for x in je['hourly'][k])]
        print(f"  {v:24s} keys {len(mem):3d}, with data {len(nonnull):3d}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Avalanche alert forecast")
    ap.add_argument("folder", nargs="?", default=HERE)
    ap.add_argument("--replay")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--no-ensemble", action="store_true")
    ap.add_argument("--apikey")
    ap.add_argument("--features")
    ap.add_argument("--if-stale", type=float, metavar="HOURS",
                    help="skip the live run if the last success is younger than HOURS (catch-up at logon)")
    a = ap.parse_args(argv)
    L = layout(os.path.abspath(a.folder))
    if a.if_stale is not None and not (a.check or a.replay) and fresh(L["out_live"], a.if_stale):
        print(f"last successful run is younger than {a.if_stale:g} h - nothing to do")
        return
    lock = None if (a.check or a.replay) else take_lock(L["out_live"])
    if lock is False:
        print("another forecast run is in progress - nothing to do")
        return
    try:
        _main(a, L)
    finally:
        if lock:
            try:
                os.remove(lock)
            except OSError:
                pass


def fresh(out_live, hours):
    """True when status.json records a success within the last `hours`"""
    try:
        st = json.load(open(os.path.join(out_live, "status.json")))
        t = datetime.strptime(st["last_success_utc"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() < hours * 3600
    except Exception:
        return False


def take_lock(out_live, stale_s=3 * 3600):
    """one run at a time (scheduled + catch-up triggers can overlap); a lock older than 3 h is abandoned"""
    os.makedirs(out_live, exist_ok=True)
    p = os.path.join(out_live, "run.lock")
    if os.path.exists(p) and datetime.now().timestamp() - os.path.getmtime(p) < stale_s:
        return False
    with open(p, "w") as f:
        f.write(str(os.getpid()))
    return p


def _main(a, L):
    cfg = load_cfg(L["settings"])
    apikey = a.apikey or cfg.get("apikey") or os.environ.get("AVALANCHE_APIKEY") or None
    log = Log(L["logs"])

    tt = pd.read_csv(L["thresholds"]).set_index("tile_id")
    # exact tile centres from the tile id (N35.125_E71.625); csv values may be rounded
    ll = tt.index.to_series().str.extract(r"N([\d.]+)_E([\d.]+)").astype(float)
    tt["lat"], tt["lon"] = ll[0].values, ll[1].values
    tiles = tt[["lon", "lat", "elev_approx_m"]].reset_index()
    tiles["region"] = [fc.region(la, lo) for la, lo in zip(tiles.lat, tiles.lon)]
    thr = None
    if os.path.exists(L["student_thr"]):
        s = pd.read_csv(L["student_thr"], index_col=0).iloc[:, 0]
        thr = float(s.iloc[-1])                         # 5 % false-alarm level

    if a.check:
        check(tiles, apikey)
        return

    if a.replay:
        daily, day0 = replay_input(a.features or L["features"], tiles, a.replay, cfg)
        res, meta = fc.run(tiles, tt, cfg, mode="replay", replay_daily=daily, day0=day0,
                           model_path=L["model"], pct_path=L["pct"], student_thr=thr, log=log)
        out = os.path.join(L["out_live"], f"replay_{day0.date()}")
        rs = fc.write_outputs(res, meta, tiles, out, log=log)
        fc.print_summary(res, meta, rs, out, log)
        return

    # ---- live
    try:
        res, meta = fc.run(tiles, tt, cfg, mode="live", apikey=apikey, ensemble=not a.no_ensemble
                           and cfg.get("ensemble", True), model_path=L["model"], pct_path=L["pct"],
                           student_thr=thr, log=log)
        stamp = datetime.now(timezone.utc).strftime("%H%M")
        if L["kind"] == "package":
            tmp = os.path.join(L["out_live"], "_latest_tmp")
            shutil.rmtree(tmp, ignore_errors=True)
            rs = fc.write_outputs(res, meta, tiles, tmp, log=log)
            latest = os.path.join(L["out_live"], "latest")
            shutil.rmtree(latest, ignore_errors=True)
            os.replace(tmp, latest)
            arch = os.path.join(L["out_live"], "archive", f"{meta['issued_for_date']}_{stamp}UTC")
            shutil.copytree(latest, arch, dirs_exist_ok=True)
            keep = int(cfg.get("keep_archive_days", 400))
            for old in glob.glob(os.path.join(L["out_live"], "archive", "*")):
                try:
                    if (pd.Timestamp.now() - pd.Timestamp(os.path.basename(old)[:10])).days > keep:
                        shutil.rmtree(old, ignore_errors=True)
                except Exception:
                    pass
            out = latest
        else:
            out = os.path.join(L["out_live"], f"run_{meta['issued_for_date']}")
            rs = fc.write_outputs(res, meta, tiles, out, log=log)
        write_status(L["out_live"], True, "forecast completed", meta["issued_for_date"])
        fc.print_summary(res, meta, rs, out, log)
    except Exception as e:
        log("FORECAST FAILED: " + "".join(traceback.format_exception_only(type(e), e)).strip())
        log(traceback.format_exc())
        write_status(L["out_live"], False, f"{type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
