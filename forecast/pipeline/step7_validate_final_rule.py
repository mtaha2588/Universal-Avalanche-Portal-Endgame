"""
STEP 7 - Check the final forecast rule against the recorded avalanches
=====================================================================
The forecast rule now has two safeguards that step 3 did not have:
  - HIGH needs at least 25 mm of 3-day snowfall; the warm-snow part needs
    at least 20 mm of 7-day snowfall
  - tiles below 1200 m mean elevation are not rated
This script scores the ORIGINAL step-3 rule and the FINAL rule on the same
events and winters (1970-2026, Nov-May), so you can see what the safeguards
cost (missed events) and gain (fewer false alarms).

Scoring is the same as step 3: tiles within 0.3 deg of each event; an event is
caught if any of its tiles is at the level on any day of its window; false
alarms = share of non-event winter days on which the level is reached.
Settings (floors, elevation) are read from settings.json if present.

Usage
  python step7_validate_final_rule.py "C:\\...\\processed" avalanche_events_master.csv
Output: processed\\rules\\final_rule_validation.csv and event_hits_final.csv
"""
import sys, os, glob
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import forecast_core as fc          # noqa: E402
from run_forecast import load_cfg   # noqa: E402

RADIUS_DEG = 0.30
EXCLUDE_DAYS = 10
WINTER = [11, 12, 1, 2, 3, 4, 5]
COLS = ["tile_id", "date", "sf_3d_mm", "sf_7d_mm", "gust_max_3d_ms", "tmax_rise_3d_c", "ros_3d_mm", "swe_mm"]


def main(proc, events_csv):
    cfg = load_cfg(os.path.join(proc, "settings.json"))
    tt = pd.read_csv(os.path.join(proc, "rules", "tile_thresholds.csv")).set_index("tile_id")
    ll = tt.index.to_series().str.extract(r"N([\d.]+)_E([\d.]+)").astype(float)
    tt["lat"], tt["lon"] = ll[0].values, ll[1].values

    print("loading features ...")
    parts = []
    for f in sorted(glob.glob(os.path.join(proc, "features", "era5_features_*"))):
        df = pd.read_parquet(f, columns=COLS) if f.endswith(".parquet") else pd.read_csv(f, usecols=COLS)
        parts.append(df[df.tile_id.isin(tt.index)])
    d = pd.concat(parts, ignore_index=True)
    d["date"] = pd.to_datetime(d.date)
    d = d[d.date.dt.month.isin(WINTER)].reset_index(drop=True)
    d["snowpack"] = (d.swe_mm >= 30).astype(float)
    n_winters = d.date.dt.year.nunique()

    levels = {"original (step 3)": fc.apply_rules(d, tt, cfg, final=False),
              "final (forecast)": fc.apply_rules(d, tt, cfg, final=True)}

    ev = pd.read_csv(events_csv)
    if "use_in_analysis" in ev:
        ev = ev[ev.use_in_analysis.astype(str).str.lower() == "yes"]
    ev = ev.dropna(subset=["lat", "lon"]).copy()
    ev["ws"] = pd.to_datetime(ev.date_start.fillna(ev.get("date")))
    ev["we"] = pd.to_datetime(ev.date_end.fillna(ev.date_start))
    use = tt   # tile_thresholds.csv already holds only the usable seasonal-snow tiles

    rows, near = {}, np.zeros(len(d), bool)
    clusters = {}
    for _, e in ev.iterrows():
        dist = np.hypot(use.lat - e.lat, (use.lon - e.lon) * np.cos(np.radians(e.lat)))
        ts = set(use.index[dist <= RADIUS_DEG])
        on = d.tile_id.isin(ts).values
        r = np.where(on & (d.date >= e.ws).values & (d.date <= e.we).values)[0]
        if len(r):
            rows[e.event_id], clusters[e.event_id] = r, ts
            near |= on & (d.date >= e.ws - pd.Timedelta(days=EXCLUDE_DAYS)).values \
                       & (d.date <= e.we + pd.Timedelta(days=EXCLUDE_DAYS)).values
    ev = ev[ev.event_id.isin(rows)].reset_index(drop=True)
    day = (d.date - d.date.min()).dt.days.values
    ctl = []
    for k, ts in clusters.items():
        idx = np.where(d.tile_id.isin(ts).values & ~near)[0]
        u, inv = np.unique(day[idx], return_inverse=True)
        ctl.append((idx, inv, len(u)))

    summ, hits_tab = [], ev[["event_id", "storm_id"]].copy()
    for name, lv in levels.items():
        for k, lab in [(1, "MODERATE"), (2, "HIGH")]:
            a = lv >= k
            hit = np.array([a[rows[i]].any() for i in ev.event_id])
            far, apy = [], []
            for idx, inv, nd in ctl:
                flag = np.bincount(inv, weights=a[idx], minlength=nd) > 0
                far.append(flag.mean()); apy.append(flag.sum() / n_winters)
            summ.append({"rule": name, "level": lab, "events_caught": int(hit.sum()), "events": len(hit),
                         "storms_caught": int(pd.Series(hit).groupby(ev.storm_id.values).any().sum()),
                         "storms": ev.storm_id.nunique(),
                         "false_alarm_rate": round(float(np.mean(far)), 4),
                         "alarm_days_per_winter": round(float(np.mean(apy)), 2)})
            hits_tab[f"{lab}_{name.split()[0]}"] = hit
        nr = (lv == fc.MASKED)
        masked_events = [i for i in ev.event_id if nr[rows[i]].all()]
        if masked_events:
            print(f"{name}: events whose tiles are all below {cfg['min_elev_m']} m: {', '.join(masked_events)}")
    summ = pd.DataFrame(summ)
    out = os.path.join(proc, "rules")
    summ.to_csv(os.path.join(out, "final_rule_validation.csv"), index=False)
    hits_tab.to_csv(os.path.join(out, "event_hits_final.csv"), index=False)
    print("\n=== ORIGINAL vs FINAL RULE (all winters, Nov-May) ===")
    print(summ.to_string(index=False))
    lost = hits_tab[(hits_tab.MODERATE_original) & (~hits_tab.MODERATE_final)].event_id.tolist()
    lost_h = hits_tab[(hits_tab.HIGH_original) & (~hits_tab.HIGH_final)].event_id.tolist()
    print("\nEvents lost at MODERATE by the safeguards:", ", ".join(lost) or "none")
    print("Events lost at HIGH by the safeguards:", ", ".join(lost_h) or "none")
    print(f"Settings used: High floor {cfg['high_sf3d_floor_mm']} mm, warm floor {cfg['warm_sf7d_floor_mm']} mm, "
          f"minimum elevation {cfg['min_elev_m']} m")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
