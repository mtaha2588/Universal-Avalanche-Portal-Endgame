"""
STEP 3 - Local (per-tile) percentile thresholds, 2-level warning rules,
         and leave-one-storm-out validation
=======================================================================
Every tile gets its own thresholds = its own winter (Nov-May) percentiles,
because Neelum, Chitral and Astore have very different snow climates.

Rule family (grid search over percentile levels):
  STORM      sf_3d >= P_sf   (and >= 10 mm)  AND  gust_max_3d >= P_gust
  WARM-SNOW  tmax_rise_3d >= P_warm AND sf_7d >= P_sf7 AND swe >= 30 mm
             (warming right after fresh snow -> wet-snow avalanches)
  RAIN-SNOW  ros_3d >= P_ros AND swe >= 30 mm
  ALERT = STORM or WARM-SNOW or RAIN-SNOW   (unused parts switched off)

Scoring on the tile clusters around each event (tiles within 0.3 deg):
  hit        rule fires on any cluster tile on any day of the event window
  FAR        share of non-event winter days on which the rule fires in the cluster
  alarms/yr  mean alarm days per winter per cluster

Warning levels
  HIGH      best rule with FAR <= 2%
  MODERATE  best rule with FAR <= 5%
  "best" = most storms caught, then most events, then fewest false alarms.

Validation (leave-one-storm-out, LOSO)
  For each storm: choose the rule WITHOUT that storm's events, then check
  whether the chosen rule catches it. LOSO hit rate = the honest number to report.

Outputs (<processed>/rules/):
  rule_search.csv      every combination tested
  best_rules.csv       HIGH and MODERATE rules with scores
  event_hits.csv       per event: caught by HIGH / MODERATE / LOSO
  loso_validation.csv  per storm: rule chosen without it, caught or not
  tile_thresholds.csv  per tile ABSOLUTE threshold values for both levels

Usage
  python step3_local_rules.py "C:\\...\\processed" avalanche_events_master.csv
"""
import sys, os, glob, itertools
import numpy as np
import pandas as pd

RADIUS_DEG = 0.30
EXCLUDE_DAYS = 10
WINTER = [11, 12, 1, 2, 3, 4, 5]
SF_FLOOR_MM = 10.0
SWE_MIN_MM = 30.0
COLS = ["sf_3d_mm", "sf_7d_mm", "gust_max_3d_ms", "tmax_rise_3d_c", "ros_3d_mm", "swe_mm"]
PCT_COLS = ["sf_3d_mm", "sf_7d_mm", "gust_max_3d_ms", "tmax_rise_3d_c", "ros_3d_mm"]

OFF = None
P_SF = [90, 93, 95, 97, 99]
P_GUST = [OFF, 80, 90, 95]
P_WARM = [OFF, 85, 90, 95]
P_SF7 = [75, 85, 90]          # only used when P_WARM is on
P_ROS = [OFF, 97, 99]
LEVELS = {"HIGH": 0.02, "MODERATE": 0.05}


def load(proc, tiles_use):
    parts = []
    for f in sorted(glob.glob(os.path.join(proc, "features", "era5_features_*"))):
        df = pd.read_parquet(f, columns=["tile_id", "date"] + COLS) if f.endswith(".parquet") \
            else pd.read_csv(f, usecols=["tile_id", "date"] + COLS)
        parts.append(df[df.tile_id.isin(tiles_use)])
    d = pd.concat(parts, ignore_index=True)
    d["date"] = pd.to_datetime(d["date"])
    return d[d.date.dt.month.isin(WINTER)].reset_index(drop=True)


def read_events(path):
    ev = pd.read_csv(path)
    if "use_in_analysis" in ev:
        ev = ev[ev.use_in_analysis.astype(str).str.lower() == "yes"]
    ev = ev.dropna(subset=["lat", "lon"]).copy()
    if "date_start" in ev:
        ev["win_start"] = pd.to_datetime(ev.date_start.fillna(ev.get("date")))
        ev["win_end"] = pd.to_datetime(ev.date_end.fillna(ev.date_start))
    else:
        ev["win_end"] = pd.to_datetime(ev.date)
        ev["win_start"] = ev.win_end - pd.to_timedelta(ev.get("date_uncertainty_days", 0), unit="D")
    if "storm_id" not in ev:
        ev["storm_id"] = ev.event_id
    return ev.reset_index(drop=True)


def rule_grid():
    for psf, pg, pw, pr in itertools.product(P_SF, P_GUST, P_WARM, P_ROS):
        for p7 in (P_SF7 if pw is not OFF else [OFF]):
            yield {"P_sf3d": psf, "P_gust": pg, "P_warm": pw, "P_sf7d": p7, "P_ros": pr}


def apply_rule(r, P, raw):
    storm = (P["sf_3d_mm"] >= r["P_sf3d"]) & (raw["sf_3d_mm"] >= SF_FLOOR_MM)
    if r["P_gust"] is not OFF:
        storm &= P["gust_max_3d_ms"] >= r["P_gust"]
    alert = storm
    snowpack = raw["swe_mm"] >= SWE_MIN_MM
    if r["P_warm"] is not OFF:
        alert = alert | ((P["tmax_rise_3d_c"] >= r["P_warm"]) & (P["sf_7d_mm"] >= r["P_sf7d"]) & snowpack)
    if r["P_ros"] is not OFF:
        alert = alert | ((P["ros_3d_mm"] >= r["P_ros"]) & snowpack)
    return alert


def rule_text(r):
    s = f"STORM sf3d>=P{r['P_sf3d']:g}" + (f" & gust>=P{r['P_gust']:g}" if pd.notna(r["P_gust"]) else "")
    if pd.notna(r["P_warm"]):
        s += f" | WARM-SNOW tmax_rise>=P{r['P_warm']:g} & sf7d>=P{r['P_sf7d']:g} & swe>=30"
    if pd.notna(r["P_ros"]):
        s += f" | RAIN-SNOW ros3d>=P{r['P_ros']:g} & swe>=30"
    return s


def pick(res, hits, ev, cap, exclude_storm=None):
    """best rule under a FAR cap, optionally ignoring one storm's events."""
    keep = (ev.storm_id != exclude_storm).values if exclude_storm is not None else np.ones(len(ev), bool)
    H = hits[:, keep]
    storms = ev.storm_id.values[keep]
    us = np.unique(storms)
    storm_hit = np.stack([H[:, storms == s].any(1) for s in us], 1).mean(1)
    ev_hit = H.mean(1)
    ok = res.FAR_cluster_days.values <= cap
    if not ok.any():
        return None
    order = np.lexsort((res.FAR_cluster_days.values, -ev_hit, -storm_hit))
    order = [i for i in order if ok[i]]
    return order[0]


def main(proc, events_csv):
    out = os.path.join(proc, "rules")
    os.makedirs(out, exist_ok=True)
    tiles = pd.read_csv(os.path.join(proc, "tiles.csv"))
    use = tiles[tiles.use_for_thresholds]
    ev = read_events(events_csv)

    print("loading features ...")
    d = load(proc, set(use.tile_id))
    print("computing local percentiles ...")
    P = {c: (d.groupby("tile_id")[c].rank(pct=True) * 100).values for c in PCT_COLS}
    raw = {c: d[c].values for c in COLS}

    # clusters and event rows
    clusters, ev_rows = {}, {}
    near_event = np.zeros(len(d), bool)
    for _, e in ev.iterrows():
        dist = np.hypot(use.lat - e.lat, (use.lon - e.lon) * np.cos(np.radians(e.lat)))
        ts = set(use.tile_id[dist <= RADIUS_DEG])
        if not ts:
            continue
        on = d.tile_id.isin(ts).values
        rows = np.where(on & (d.date >= e.win_start).values & (d.date <= e.win_end).values)[0]
        if len(rows) == 0:
            continue
        clusters[e.event_id], ev_rows[e.event_id] = ts, rows
        near_event |= on & (d.date >= e.win_start - pd.Timedelta(days=EXCLUDE_DAYS)).values \
                          & (d.date <= e.win_end + pd.Timedelta(days=EXCLUDE_DAYS)).values
    skipped = sorted(set(ev.event_id) - set(ev_rows))
    if skipped:
        print("Skipped (no seasonal-snow tiles or no data):", ", ".join(skipped))
    ev = ev[ev.event_id.isin(ev_rows)].reset_index(drop=True)
    print(f"{len(ev)} events, {ev.storm_id.nunique()} storms used")

    # control rows per cluster, grouped by day (fast cluster-day aggregation)
    day_code = (d.date - d.date.min()).dt.days.values
    ctl = []
    for k, ts in clusters.items():
        idx = np.where(d.tile_id.isin(ts).values & ~near_event)[0]
        u, inv = np.unique(day_code[idx], return_inverse=True)
        ctl.append((idx, inv, len(u)))
    n_winters = d.date.dt.year.nunique()

    rules = list(rule_grid())
    print(f"searching {len(rules)} rule combinations ...")
    hits = np.zeros((len(rules), len(ev)), bool)
    far = np.zeros(len(rules))
    apy = np.zeros(len(rules))
    for i, r in enumerate(rules):
        a = apply_rule(r, P, raw)
        for j, k in enumerate(ev.event_id):
            hits[i, j] = a[ev_rows[k]].any()
        f, n = [], []
        for idx, inv, nd in ctl:
            flag = np.bincount(inv, weights=a[idx], minlength=nd) > 0
            f.append(flag.mean())
            n.append(flag.sum() / n_winters)
        far[i], apy[i] = np.mean(f), np.mean(n)

    res = pd.DataFrame(rules)
    storms = ev.storm_id.values
    us = np.unique(storms)
    res["hit_rate_events"] = hits.mean(1)
    res["hit_rate_storms"] = np.stack([hits[:, storms == s].any(1) for s in us], 1).mean(1)
    res["FAR_cluster_days"] = far
    res["alarm_days_per_winter"] = apy
    res["rule"] = [rule_text(r) for r in res.to_dict("records")]
    res.sort_values("FAR_cluster_days").to_csv(os.path.join(out, "rule_search.csv"), index=False)

    # ---- two warning levels
    chosen, best_rows = {}, []
    for lvl, cap in LEVELS.items():
        i = pick(res, hits, ev, cap)
        if i is None:
            print(f"No rule meets FAR <= {cap:.0%} for {lvl}")
            continue
        chosen[lvl] = i
        best_rows.append({"level": lvl, "FAR_cap": cap} | res.iloc[i].to_dict())
    best = pd.DataFrame(best_rows)
    best.to_csv(os.path.join(out, "best_rules.csv"), index=False)

    # ---- leave-one-storm-out
    loso = []
    for s in us:
        row = {"storm_id": s, "events": ",".join(ev.event_id[storms == s])}
        for lvl, cap in LEVELS.items():
            i = pick(res, hits, ev, cap, exclude_storm=s)
            row[f"{lvl}_rule"] = res.rule[i] if i is not None else ""
            row[f"{lvl}_caught"] = bool(hits[i, storms == s].any()) if i is not None else False
        loso.append(row)
    loso = pd.DataFrame(loso)
    loso.to_csv(os.path.join(out, "loso_validation.csv"), index=False)

    eh = ev[["event_id", "storm_id", "win_end"]].copy()
    for lvl, i in chosen.items():
        eh[f"{lvl}_caught"] = hits[i]
    eh = eh.merge(loso[["storm_id"] + [f"{l}_caught" for l in LEVELS]].rename(
        columns={f"{l}_caught": f"{l}_LOSO_storm_caught" for l in LEVELS}), on="storm_id", how="left")
    eh.to_csv(os.path.join(out, "event_hits.csv"), index=False)

    # ---- report
    print("\n=== WARNING LEVELS (local percentiles) ===")
    for _, b in best.iterrows():
        print(f"\n{b.level} (FAR cap {b.FAR_cap:.0%}):  {b.rule}")
        print(f"   events caught {b.hit_rate_events:.0%} | storms caught {b.hit_rate_storms:.0%} | "
              f"false alarms {b.FAR_cluster_days:.1%} of winter days | "
              f"{b.alarm_days_per_winter:.1f} alarm days/winter per area")
        missed = eh.event_id[~eh[f"{b.level}_caught"]].tolist()
        print("   missed:", ", ".join(missed) or "none")
    print("\n=== LEAVE-ONE-STORM-OUT (honest hit rate) ===")
    for lvl in LEVELS:
        if f"{lvl}_caught" in loso:
            print(f"   {lvl}: {loso[f'{lvl}_caught'].mean():.0%} of storms "
                  f"({loso[f'{lvl}_caught'].sum()} of {len(loso)})")
    if "MODERATE_rule" in loso:
        print(f"   MODERATE rule stable across folds: {loso.MODERATE_rule.value_counts().iloc[0]} of "
              f"{len(loso)} folds chose the same rule")

    # ---- absolute per-tile thresholds for both levels
    tt = use[["tile_id", "lon", "lat", "elev_approx_m"]].set_index("tile_id")
    g = d.groupby("tile_id")
    for lvl, i in chosen.items():
        r = res.iloc[i]
        tt[f"{lvl}_sf3d_mm"] = np.maximum(g.sf_3d_mm.quantile(r.P_sf3d / 100), SF_FLOOR_MM)
        if pd.notna(r.P_gust):
            tt[f"{lvl}_gust3d_ms"] = g.gust_max_3d_ms.quantile(r.P_gust / 100)
        if pd.notna(r.P_warm):
            tt[f"{lvl}_tmax_rise3d_c"] = g.tmax_rise_3d_c.quantile(r.P_warm / 100)
            tt[f"{lvl}_sf7d_mm"] = g.sf_7d_mm.quantile(r.P_sf7d / 100)
        if pd.notna(r.P_ros):
            tt[f"{lvl}_ros3d_mm"] = g.ros_3d_mm.quantile(r.P_ros / 100)
        tt[f"{lvl}_rule"] = r.rule
    tt.round(2).reset_index().to_csv(os.path.join(out, "tile_thresholds.csv"), index=False)
    print(f"\nTile thresholds written for {len(tt)} tiles. Outputs in {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
