"""
STEP 4 - Teacher-student avalanche model (version 2, ERA5 only)
 v2: local-percentile features, no ONI/month, storm-balanced weights,
     stronger regularisation (v1 memorised which winters had disasters)
================================================================
TEACHER  sees everything ERA5/ERA5-Land offers: snowfall, wind, temperature,
         snowpack internals (density, snow temperature, temperature gradient,
         faceting, albedo, melt), moisture transport, elevation,
         and each driver's LOCAL percentile (place-specific extremeness).
STUDENT  sees only variables that ECMWF forecasts and CMIP6 projections also
         provide (snowfall, precipitation, gusts, temperature rise, freezing
         level, snow depth / SWE, pressure drop, ENSO, elevation, local
         percentiles of those). It learns from the teacher's soft
         probabilities on ~all tile-days (knowledge distillation) plus the
         real avalanche labels, so it can run on forecasts and projections.

Labels: positive = tiles near an avalanche during its event window.
        Days without a report are NOT treated as "no avalanche" for sure
        (most avalanches are never reported): negatives are taken only from
        tiles near reported events (where reporting exists), and the rest of
        the region only receives teacher soft labels.
Physics guard-rails: monotonic constraints (more snowfall / gust / snow gain
        can never lower risk) keep the models sensible with few events.

Validation (honest): 5-fold cross-validation by WINTER - each model is tested
on winters it never saw. Teacher, student and the MODERATE rule are compared
at the SAME false-alarm rate (cluster level, like step 3).

Outputs (<processed>/model/):
  cv_comparison.csv        rule vs teacher vs student: storms/events caught, AUC
  event_scores.csv         out-of-sample risk score of every event
  feature_importance.csv   which drivers the student relies on
  hindcast_daily_risk.parquet  student + teacher daily risk, every tile, 1970-2026
  student.joblib, teacher.joblib, percentile_tables.parquet (for forecasting)

Usage
  pip install scikit-learn
  python step4_teacher_student.py "C:\\...\\processed" avalanche_events_master.csv
"""
import sys, os, glob
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
import joblib


RADIUS_DEG = 0.30
EXCLUDE_DAYS = 10
WINTER = [11, 12, 1, 2, 3, 4, 5]
N_NEG_TEACHER = 120_000
N_STUDENT_EXTRA = 150_000
ALPHA = 0.5            # weight of the true label vs teacher in the student target
SEED = 7

# v2: daily model uses LOCAL PERCENTILES (place-specific extremeness), which is what
# worked in step 3. ONI and month are NOT daily features: they are constant for a
# whole winter / month, so with 15 storms the model just memorised "which winters
# had disasters". ENSO is handled in the seasonal outlook (step 5) instead.
PCT_VARS = ["sf_3d_mm", "sf_5d_mm", "sf_7d_mm", "precip_3d_mm", "gust_max_3d_ms", "tmax_rise_3d_c",
            "tmean_3d_c", "ros_3d_mm", "dhs_3d_m", "dswe_3d_mm", "deg0l_max_3d_m", "mslp_drop_3d_hpa"]
TEACHER_PCT_VARS = ["tg_kpm", "facet_days_30d", "snow_density_kgm3", "snowtemp_mean_c", "melt_3d_mm",
                    "ivt_max_3d_kgms", "tcwv_max_3d_kgm2", "clear_nights_prior_7d", "snow_albedo"]
RAW_EXTRA = ["snowfall_mmwe", "sf_3d_mm", "sf_7d_mm", "gust_max_3d_ms", "tmax_rise_3d_c", "dhs_3d_m",
             "swe_mm", "snow_depth_m"]
COMMON = [v + "_p" for v in PCT_VARS] + ["snowpack", "elev_approx_m"]
TEACHER_ONLY = [v + "_p" for v in TEACHER_PCT_VARS] + ["facet_days_7d"]
MONO_UP = {"sf_3d_mm_p", "sf_5d_mm_p", "sf_7d_mm_p", "precip_3d_mm_p", "gust_max_3d_ms_p",
           "dhs_3d_m_p", "dswe_3d_mm_p", "snowpack"}
MONO_DOWN = {"mslp_drop_3d_hpa_p"}      # deeper pressure drop (lower value) = more storm


def gbm(features, seed=SEED):
    return HistGradientBoostingClassifier(
        max_depth=2, learning_rate=0.05, max_iter=150, min_samples_leaf=100,
        l2_regularization=5.0, random_state=seed,
        monotonic_cst=[1 if f in MONO_UP else (-1 if f in MONO_DOWN else 0) for f in features])


def pos_weights(y, row_storm, n_neg, share=0.2):
    """each STORM gets equal total weight (not each tile-day); positives = share of negatives."""
    w = np.ones(len(y))
    st = row_storm[y == 1]
    per = pd.Series(st).map(1 / pd.Series(st).value_counts()).values
    w[y == 1] = per / per.sum() * share * n_neg
    return w


def load(proc, tiles):
    want = set(PCT_VARS + TEACHER_PCT_VARS + RAW_EXTRA + ["facet_days_7d", "tile_id", "date", "winter_year"])
    parts = []
    for f in sorted(glob.glob(os.path.join(proc, "features", "era5_features_*"))):
        df = pd.read_parquet(f) if f.endswith(".parquet") else pd.read_csv(f)
        df = df[df.tile_id.isin(tiles.index)]
        df = df[[c for c in df.columns if c in want]]
        parts.append(df)
    d = pd.concat(parts, ignore_index=True)
    d["date"] = pd.to_datetime(d.date)
    d = d[d.date.dt.month.isin(WINTER)].reset_index(drop=True)
    d["snowpack"] = (d.swe_mm >= 30).astype("float32")
    d["elev_approx_m"] = tiles.elev_approx_m.reindex(d.tile_id).values
    for c in d.select_dtypes("float64"):
        d[c] = d[c].astype("float32")
    return d


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


def soft_fit(model, X, soft, w=None):
    """fit a classifier to soft targets via duplicated rows (cross-entropy with soft labels)."""
    n = len(X)
    w = np.ones(n) if w is None else w
    XX = pd.concat([X, X], ignore_index=True)
    yy = np.r_[np.ones(n), np.zeros(n)]
    ww = np.r_[soft * w, (1 - soft) * w]
    keep = ww > 1e-6
    model.fit(XX[keep], yy[keep], sample_weight=ww[keep])
    return model


def evaluate(score, d, ev, ev_rows, ctl_groups, far_targets):
    """cluster-level: threshold set so control cluster-days hit the target FAR."""
    ctl_max = np.concatenate([pd.Series(score[idx]).groupby(dy).max().values
                              for idx, dy in ctl_groups])
    ev_max = np.array([score[ev_rows[k]].max() for k in ev.event_id])
    out = {}
    # AUC (Mann-Whitney) events vs control cluster-days
    allv = np.r_[ev_max, ctl_max]
    r = pd.Series(allv).rank().values
    out["AUC"] = (r[:len(ev_max)].sum() - len(ev_max) * (len(ev_max) + 1) / 2) / (len(ev_max) * len(ctl_max))
    for far in far_targets:
        thr = np.quantile(ctl_max, 1 - far)
        hit = ev_max >= thr if len(np.unique(ctl_max)) > 2 else ev_max > thr
        out[f"events@{far:.1%}"] = hit.mean()
        out[f"storms@{far:.1%}"] = pd.Series(hit).groupby(ev.storm_id.values).any().mean()
    return out, ev_max


def main(proc, events_csv):
    out = os.path.join(proc, "model")
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(SEED)
    tiles = pd.read_csv(os.path.join(proc, "tiles.csv")).set_index("tile_id")
    tiles = tiles[tiles.use_for_thresholds]
    ev = read_events(events_csv)

    print("loading features ...")
    d = load(proc, tiles)
    print(f"   {len(d):,} winter tile-days, {d.tile_id.nunique()} tiles, {d.winter_year.nunique()} winters")
    print("local percentiles ...")
    pct_tables = {}
    for v in [x for x in PCT_VARS + TEACHER_PCT_VARS if x in d.columns]:
        d[v + "_p"] = (d.groupby("tile_id")[v].rank(pct=True) * 100).astype("float32")
        if v in PCT_VARS:   # student variables: needed later to convert forecasts to percentiles
            pct_tables[v] = d.groupby("tile_id")[v].quantile(np.linspace(0, 1, 101)).unstack()
    pt = pd.concat(pct_tables, names=["var"]).reset_index()
    pt.columns = [str(c) for c in pt.columns]
    pt.to_parquet(os.path.join(out, "percentile_tables.parquet"), index=False)

    t_feats = [c for c in COMMON + TEACHER_ONLY if c in d.columns]
    s_feats = [c for c in COMMON if c in d.columns]
    print(f"teacher uses {len(t_feats)} variables, student {len(s_feats)}")

    # ---- labels
    clusters, ev_rows = {}, {}
    near = np.zeros(len(d), bool)
    pos = np.zeros(len(d), bool)
    row_storm = np.empty(len(d), dtype=object)
    for _, e in ev.iterrows():
        dist = np.hypot(tiles.lat - e.lat, (tiles.lon - e.lon) * np.cos(np.radians(e.lat)))
        ts = set(tiles.index[dist <= RADIUS_DEG])
        on = d.tile_id.isin(ts).values
        rows = np.where(on & (d.date >= e.win_start).values & (d.date <= e.win_end).values)[0]
        if not len(rows):
            continue
        clusters[e.event_id], ev_rows[e.event_id] = ts, rows
        pos[rows] = True
        row_storm[rows] = e.storm_id
        near |= on & (d.date >= e.win_start - pd.Timedelta(days=EXCLUDE_DAYS)).values \
                   & (d.date <= e.win_end + pd.Timedelta(days=EXCLUDE_DAYS)).values
    ev = ev[ev.event_id.isin(ev_rows)].reset_index(drop=True)
    print(f"{len(ev)} events / {ev.storm_id.nunique()} storms, {pos.sum()} positive tile-days")
    cl_tiles = set().union(*clusters.values())
    in_cl = d.tile_id.isin(cl_tiles).values
    neg_pool = np.where(in_cl & ~near)[0]
    other_pool = np.where(~in_cl)[0]
    day = (d.date - d.date.min()).dt.days.values
    ctl_groups = []
    for k, ts in clusters.items():
        idx = np.where(d.tile_id.isin(ts).values & ~near)[0]
        ctl_groups.append((idx, day[idx]))
    eval_rows = np.unique(np.r_[np.concatenate([g[0] for g in ctl_groups]), np.where(pos)[0]])

    # ---- MODERATE rule baseline (from step 3)
    rule = None
    ttp = os.path.join(proc, "rules", "tile_thresholds.csv")
    if os.path.exists(ttp):
        tt = pd.read_csv(ttp).set_index("tile_id").reindex(d.tile_id)
        a = (d.sf_3d_mm.values >= tt.MODERATE_sf3d_mm.values)
        if "MODERATE_gust3d_ms" in tt:
            a &= d.gust_max_3d_ms.values >= tt.MODERATE_gust3d_ms.values
        if "MODERATE_tmax_rise3d_c" in tt:
            a |= (d.tmax_rise_3d_c.values >= tt.MODERATE_tmax_rise3d_c.values) & \
                 (d.sf_7d_mm.values >= tt.MODERATE_sf7d_mm.values) & (d.swe_mm.values >= 30)
        rule = a.astype(float)
        ctl_max = np.concatenate([pd.Series(rule[idx]).groupby(dy).max().values for idx, dy in ctl_groups])
        rule_far = ctl_max.mean()
    else:
        rule_far = 0.037
    fars = sorted({0.02, float(rule_far), 0.05})

    # ---- cross-validation by winter
    groups = d.winter_year.values
    winters = np.unique(groups)
    k = min(5, len(winters))
    oof_t = np.full(len(d), np.nan, dtype="float32")
    oof_s = np.full(len(d), np.nan, dtype="float32")
    wfold = {w: i % k for i, w in enumerate(rng.permutation(winters))}
    fold_of = np.array([wfold[w] for w in groups])
    for f in range(k):
        print(f"fold {f + 1}/{k} ...")
        tr = fold_of != f
        te_rows = eval_rows[fold_of[eval_rows] == f]
        p_idx = np.where(pos & tr)[0]
        n_idx = rng.choice(neg_pool[tr[neg_pool]], min(N_NEG_TEACHER, tr[neg_pool].sum()), replace=False)
        if len(p_idx) == 0:
            continue
        idx = np.r_[p_idx, n_idx]
        y = np.r_[np.ones(len(p_idx)), np.zeros(len(n_idx))]
        w = pos_weights(y, row_storm[idx], len(n_idx))
        teacher = gbm(t_feats).fit(d.loc[idx, t_feats], y, sample_weight=w)

        # student: teacher-labelled rows + true labels
        o_idx = rng.choice(other_pool[tr[other_pool]], min(N_STUDENT_EXTRA, tr[other_pool].sum()), replace=False) \
            if len(other_pool) else np.array([], int)
        s_idx = np.r_[idx, o_idx]
        t_soft = teacher.predict_proba(d.loc[s_idx, t_feats])[:, 1]
        lab = np.r_[y, np.full(len(o_idx), np.nan)]
        soft = np.where(np.isnan(lab), t_soft, ALPHA * np.nan_to_num(lab) + (1 - ALPHA) * t_soft)
        student = soft_fit(gbm(s_feats), d.loc[s_idx, s_feats].reset_index(drop=True), soft)

        oof_t[te_rows] = teacher.predict_proba(d.loc[te_rows, t_feats])[:, 1]
        oof_s[te_rows] = student.predict_proba(d.loc[te_rows, s_feats])[:, 1]

    # ---- compare
    res, scores = [], {}
    for name, sc in [("teacher (all ERA5)", oof_t), ("student (forecastable only)", oof_s)]:
        sc = np.nan_to_num(sc, nan=0.0)
        m, ev_max = evaluate(sc, d, ev, ev_rows, ctl_groups, fars)
        res.append({"model": name, "validation": "out-of-sample (CV by winter)"} | m)
        scores[name] = ev_max
    if rule is not None:
        ev_hit = np.array([rule[ev_rows[k]].max() for k in ev.event_id]) > 0
        r = {"model": "MODERATE rule (step 3)", "validation": "in-sample; LOSO in step 3",
             "AUC": np.nan, f"events@{rule_far:.1%}": ev_hit.mean(),
             f"storms@{rule_far:.1%}": pd.Series(ev_hit).groupby(ev.storm_id.values).any().mean()}
        res.append(r)
        scores["rule_alarm"] = ev_hit.astype(int)
        lp = os.path.join(proc, "rules", "loso_validation.csv")
        if os.path.exists(lp):
            lo = pd.read_csv(lp)
            if "MODERATE_caught" in lo:
                res.append({"model": "MODERATE rule (step 3)", "validation": "LOSO",
                            f"storms@{rule_far:.1%}": lo.MODERATE_caught.mean()})
    res = pd.DataFrame(res)
    res.round(3).to_csv(os.path.join(out, "cv_comparison.csv"), index=False)
    es = ev[["event_id", "storm_id", "win_end"]].copy()
    for kname, v in scores.items():
        es[kname] = v
    es = es.round({c: 4 for c in es.columns if es[c].dtype.kind == "f"})
    es.to_csv(os.path.join(out, "event_scores.csv"), index=False)

    print("\n=== OUT-OF-SAMPLE COMPARISON (same false-alarm rate) ===")
    print(res.round(3).to_string(index=False))

    # ---- final models on all winters
    print("\ntraining final teacher and student on all winters ...")
    p_idx = np.where(pos)[0]
    n_idx = rng.choice(neg_pool, min(N_NEG_TEACHER, len(neg_pool)), replace=False)
    idx = np.r_[p_idx, n_idx]
    y = np.r_[np.ones(len(p_idx)), np.zeros(len(n_idx))]
    w = pos_weights(y, row_storm[idx], len(n_idx))
    teacher = gbm(t_feats).fit(d.loc[idx, t_feats], y, sample_weight=w)
    o_idx = rng.choice(other_pool, min(N_STUDENT_EXTRA, len(other_pool)), replace=False) \
        if len(other_pool) else np.array([], int)
    s_idx = np.r_[idx, o_idx]
    t_soft = teacher.predict_proba(d.loc[s_idx, t_feats])[:, 1]
    lab = np.r_[y, np.full(len(o_idx), np.nan)]
    soft = np.where(np.isnan(lab), t_soft, ALPHA * np.nan_to_num(lab) + (1 - ALPHA) * t_soft)
    student = soft_fit(gbm(s_feats), d.loc[s_idx, s_feats].reset_index(drop=True), soft)
    joblib.dump({"model": teacher, "features": t_feats}, os.path.join(out, "teacher.joblib"))
    joblib.dump({"model": student, "features": s_feats, "pct_vars": PCT_VARS},
                os.path.join(out, "student.joblib"))

    # thresholds on the final student score matching the FAR levels
    s_all = student.predict_proba(d[s_feats])[:, 1].astype("float32")
    t_all = teacher.predict_proba(d[t_feats])[:, 1].astype("float32")
    ctl_max = np.concatenate([pd.Series(s_all[i]).groupby(dy).max().values for i, dy in ctl_groups])
    thr = {f"{far:.1%}": float(np.quantile(ctl_max, 1 - far)) for far in fars}
    pd.Series(thr, name="student_score_threshold").to_csv(os.path.join(out, "student_thresholds.csv"))

    hc = pd.DataFrame({"tile_id": d.tile_id, "date": d.date, "student_risk": s_all, "teacher_risk": t_all})
    hc.to_parquet(os.path.join(out, "hindcast_daily_risk.parquet"), index=False)

    # importance (student)
    sub = rng.choice(len(s_idx), min(30_000, len(s_idx)), replace=False)
    Xs = d.loc[s_idx[sub], s_feats]
    ys = (soft[sub] > np.quantile(soft, 0.95)).astype(int)
    if ys.sum() > 5:
        pi = permutation_importance(student, Xs, ys, scoring="roc_auc", n_repeats=3, random_state=SEED)
        fi = pd.DataFrame({"feature": s_feats, "importance": pi.importances_mean}).sort_values(
            "importance", ascending=False)
        fi.round(4).to_csv(os.path.join(out, "feature_importance.csv"), index=False)
        print("\nStudent's most important drivers:")
        print(fi.head(10).round(4).to_string(index=False))
    print(f"\nScore thresholds (student): {thr}")
    print("Outputs in", out)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
