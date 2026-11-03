"""
STEP 2 - What weather preceded each avalanche, and what are the thresholds?
==========================================================================
Uses the output of step1_prepare_era5.py plus an event list (avalanche_events.csv).

For every event:
  - takes the tiles around the event (default within 0.30 deg ~ the 3x3 tile block),
    preferring tiles NOT flagged as glacier / perennial snow;
  - builds a daily "cluster" series = the maximum of each driver over those tiles
    (location of old events is uncertain, so we look at the worst tile nearby);
  - EVENT value  = max over [date - uncertainty, date];
  - CONTROL days = the same cluster, same months (Nov-May), all other years and days,
    excluding +-10 days around any event -> the local climatology.

Outputs (in <out_dir>/thresholds/):
  event_driver_percentiles.csv   - each event: value of every driver and its
                                   percentile against local climatology
                                   (works even with a handful of events)
  driver_thresholds.csv          - per driver: AUC, best (Youden) threshold,
                                   hit rate and false-alarm rate at that threshold
                                   (only meaningful once you have >= ~15 events)
  event_<id>.png                 - 15 days before each event vs climatology band

Usage
  python step2_event_thresholds.py "D:\\ERA5_NPak\\processed" avalanche_events.csv
Needs: pandas, numpy, matplotlib
"""
import sys, os, glob
import numpy as np
import pandas as pd

RADIUS_DEG = 0.30
EXCLUDE_DAYS = 10
WINTER_MONTHS = [11, 12, 1, 2, 3, 4, 5]
LEAD_DAYS = 15

# drivers and the direction that means "more dangerous" (+1 higher, -1 lower)
DRIVERS = {
    "snowfall_mmwe": +1, "sf_3d_mm": +1, "sf_5d_mm": +1, "sf_7d_mm": +1,
    "precip_3d_mm": +1, "dhs_3d_m": +1, "dswe_3d_mm": +1,
    "ros_3d_mm": +1, "tmax_rise_3d_c": +1, "tmean_3d_c": +1, "melt_3d_mm": +1,
    "deg0l_max_3d_m": +1, "wind_on_snow_3d_ms": +1, "gust_max_3d_ms": +1,
    "facet_days_7d": +1, "facet_days_30d": +1, "clear_nights_prior_7d": +1,
    "mslp_drop_3d_hpa": -1, "ivt_max_3d_kgms": +1, "tcwv_max_3d_kgm2": +1,
    "snow_depth_m": +1, "swe_mm": +1,
}
PLOT_DRIVERS = ["sf_3d_mm", "dhs_3d_m", "tmax_rise_3d_c", "ros_3d_mm",
                "gust_max_3d_ms", "facet_days_7d"]


def load_features(proc_dir, tile_ids):
    files = glob.glob(os.path.join(proc_dir, "features", "era5_features_*"))
    parts = []
    for f in sorted(files):
        df = pd.read_parquet(f) if f.endswith(".parquet") else pd.read_csv(f)
        df = df[df["tile_id"].isin(tile_ids)]
        cols = ["tile_id", "date"] + [c for c in DRIVERS if c in df.columns]
        parts.append(df[cols])
    out = pd.concat(parts, ignore_index=True)
    out["date"] = pd.to_datetime(out["date"])
    return out


def auc_and_threshold(ev, ctl, sign):
    """Mann-Whitney AUC + Youden-optimal threshold."""
    ev, ctl = ev[~np.isnan(ev)] * sign, ctl[~np.isnan(ctl)] * sign
    if len(ev) == 0 or len(ctl) == 0:
        return np.nan, np.nan, np.nan, np.nan
    allv = np.concatenate([ev, ctl])
    ranks = pd.Series(allv).rank().values
    auc = (ranks[:len(ev)].sum() - len(ev) * (len(ev) + 1) / 2) / (len(ev) * len(ctl))
    cands = np.unique(ev)
    best = (-1, np.nan, np.nan, np.nan)
    for t in cands:
        hit = (ev >= t).mean()
        far = (ctl >= t).mean()
        if hit - far > best[0]:
            best = (hit - far, t, hit, far)
    return auc, best[1] * sign, best[2], best[3]


def main(proc_dir, events_csv):
    out_dir = os.path.join(proc_dir, "thresholds")
    os.makedirs(out_dir, exist_ok=True)
    tiles = pd.read_csv(os.path.join(proc_dir, "tiles.csv"))
    ev = pd.read_csv(events_csv)
    if "use_in_analysis" in ev.columns:
        ev = ev[ev["use_in_analysis"].astype(str).str.lower() == "yes"]
    ev = ev.dropna(subset=["lat", "lon"]).copy()
    # event window: date_start..date_end if given, else date +- uncertainty
    if "date_start" in ev.columns:
        ev["win_start"] = pd.to_datetime(ev["date_start"].fillna(ev.get("date")))
        ev["date"] = pd.to_datetime(ev["date_end"].fillna(ev["date_start"]))
    else:
        ev["date"] = pd.to_datetime(ev["date"])
        unc = ev.get("date_uncertainty_days", 0)
        ev["win_start"] = ev["date"] - pd.to_timedelta(pd.Series(unc, index=ev.index).fillna(0), unit="D")
    if "storm_id" not in ev.columns:
        ev["storm_id"] = ev["event_id"]
    if "place" not in ev.columns:
        ev["place"] = ev.get("location", ev["event_id"])
    ev = ev.reset_index(drop=True)

    # assign tiles to each event
    clusters = {}
    for _, e in ev.iterrows():
        d = np.hypot(tiles.lat - e.lat, (tiles.lon - e.lon) * np.cos(np.radians(e.lat)))
        near = tiles[d <= RADIUS_DEG]
        good = near[near.use_for_thresholds]
        if len(good):
            clusters[e.event_id] = (good.tile_id.tolist(), "seasonal-snow tiles")
        elif len(near):
            clusters[e.event_id] = (near.tile_id.tolist(), "ONLY glacier/perennial tiles nearby")
        else:
            clusters[e.event_id] = ([], "outside grid")

    need = sorted({t for v in clusters.values() for t in v[0]})
    feats = load_features(proc_dir, need)
    first, last = feats.date.min(), feats.date.max()
    drivers = [c for c in DRIVERS if c in feats.columns]

    rows, ev_vals, ctl_vals = [], {k: [] for k in drivers}, {k: [] for k in drivers}
    for _, e in ev.iterrows():
        tids, note = clusters[e.event_id]
        base = {"event_id": e.event_id, "storm_id": e.storm_id, "date": e.date.date(),
                "place": e.place, "n_tiles": len(tids), "tile_note": note}
        if not tids or not (first <= e.date <= last):
            base["status"] = "no ERA5 data for this date/location yet"
            rows.append(base)
            continue
        cl = feats[feats.tile_id.isin(tids)].groupby("date")[drivers].max()
        win = cl.loc[e.win_start: e.date]
        # controls: same cluster, winter months, away from any event
        mask = cl.index.month.isin(WINTER_MONTHS)
        for d0 in ev.date:
            mask &= ~((cl.index >= d0 - pd.Timedelta(days=EXCLUDE_DAYS)) &
                      (cl.index <= d0 + pd.Timedelta(days=EXCLUDE_DAYS)))
        ctl = cl[mask]
        base["status"] = f"ok ({len(ctl)} control days)"
        for k in drivers:
            sgn = DRIVERS[k]
            v = (win[k] * sgn).max() * sgn
            pct = (ctl[k].dropna() * sgn < v * sgn).mean() * 100
            base[k] = round(float(v), 2)
            base[k + "_pctile"] = round(float(pct), 1)
            ev_vals[k].append(v)
            ctl_vals[k].append(ctl[k].values)
        rows.append(base)
        plot_event(e, cl, ctl, out_dir)

    res = pd.DataFrame(rows)
    res.to_csv(os.path.join(out_dir, "event_driver_percentiles.csv"), index=False)

    n_ok = res["status"].str.startswith("ok").sum()
    th = []
    for k in drivers:
        if not ev_vals[k]:
            continue
        auc, t, hit, far = auc_and_threshold(np.array(ev_vals[k], float),
                                             np.concatenate(ctl_vals[k]).astype(float), DRIVERS[k])
        th.append({"driver": k, "n_events": len(ev_vals[k]),
                   "n_storms": res.loc[res["status"].str.startswith("ok"), "storm_id"].nunique(),
                   "AUC": round(auc, 3),
                   "threshold": round(t, 2), "hit_rate": round(hit, 2),
                   "false_alarm_rate": round(far, 3)})
    th = pd.DataFrame(th, columns=["driver", "n_events", "n_storms", "AUC", "threshold",
                                   "hit_rate", "false_alarm_rate"]).sort_values("AUC", ascending=False)
    th.to_csv(os.path.join(out_dir, "driver_thresholds.csv"), index=False)

    print(f"Events analysed: {n_ok} of {len(ev)} (ERA5 data {first.date()} to {last.date()})")
    if n_ok < 15:
        print("NOTE: fewer than 15 events -> read the per-event percentiles; "
              "AUC/threshold table is indicative only.")
    print(f"Independent storms among them: {res.loc[res['status'].str.startswith('ok'), 'storm_id'].nunique()}")
    show = ["event_id", "date", "status"] + [k + "_pctile" for k in PLOT_DRIVERS if k + "_pctile" in res]
    print(res[show].to_string(index=False))
    print("\nTop drivers by AUC:\n", th.head(10).to_string(index=False))
    print("\nOutputs in", out_dir)


def plot_event(e, cl, ctl, out_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    drv = [k for k in PLOT_DRIVERS if k in cl.columns]
    seg = cl.loc[e.date - pd.Timedelta(days=LEAD_DAYS): e.date + pd.Timedelta(days=2)]
    days = (seg.index - e.date).days
    fig, axes = plt.subplots(2, 3, figsize=(12, 6), sharex=True)
    for ax, k in zip(axes.flat, drv):
        same_month = ctl[ctl.index.month == e.date.month][k].dropna()
        if len(same_month):
            p10, p50, p90, p99 = np.percentile(same_month, [10, 50, 90, 99])
            ax.axhspan(p10, p90, color="#d9d9d9", lw=0, label="climatology p10-p90")
            ax.axhline(p50, color="#9a9a9a", lw=1)
            ax.axhline(p99, color="#9a9a9a", lw=1, ls="--", label="p99")
        ax.plot(days, seg[k], color="#1f5fa8", lw=2, marker="o", ms=4, label="before event")
        ax.axvline(0, color="#333333", lw=1)
        ax.set_title(k, fontsize=10)
        ax.grid(axis="y", color="#eeeeee")
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
    axes[0, 0].legend(fontsize=7, frameon=False)
    for ax in axes[1]:
        ax.set_xlabel("days relative to avalanche")
    fig.suptitle(f"{e.event_id}  {e.place}  {e.date.date()}  (cluster max of nearby tiles)", fontsize=11)
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, f"event_{e.event_id}.png"), dpi=120)
    plt.close(fig)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
