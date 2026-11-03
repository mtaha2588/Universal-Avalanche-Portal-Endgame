"""
STEP 5 - El Nino / La Nina (ENSO) and avalanche conditions, 1970-2026
=====================================================================
Question: do El Nino or La Nina winters change avalanche danger in northern
Pakistan, and how?

Two levels of evidence
  A. The recorded avalanche events -> ENSO phase of each event's winter.
     (only ~16 storms: descriptive, not statistical proof)
  B. ALL 57 winters of ERA5 -> per winter and region:
       - MODERATE-rule alarm days (from step 3 tile_thresholds.csv)
       - total winter snowfall, number of extreme 3-day snowfall days
       - warm-spell days on snowpack
     compared between El Nino, La Nina and neutral winters, with a
     permutation test (is the difference bigger than chance?).

ENSO index: NOAA CPC Oceanic Nino Index (ONI), DJF season of each winter
(winter 2005 = Nov 2004 - May 2005, uses DJF 2004/05).
El Nino: ONI >= +0.5, La Nina: ONI <= -0.5, else neutral.
(NOAA's official episode definition needs 5 overlapping seasons; DJF alone
is the standard simple winter classification.)

Usage
  python step5_enso.py "C:\\...\\processed" avalanche_events_master.csv
Outputs in <processed>/enso/
"""
import sys, os, glob
import numpy as np
import pandas as pd

# NOAA CPC ONI, DJF (year = January), from cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
ONI_DJF = {1970: .46, 1971: -1.29, 1972: -.57, 1973: 1.55, 1974: -1.87, 1975: -.56, 1976: -1.49,
           1977: .71, 1978: .71, 1979: .19, 1980: .62, 1981: -.27, 1982: -.05, 1983: 2.14, 1984: -.63,
           1985: -1.01, 1986: -.40, 1987: 1.18, 1988: .63, 1989: -1.64, 1990: .18, 1991: .35, 1992: 1.54,
           1993: .13, 1994: .07, 1995: .88, 1996: -.88, 1997: -.41, 1998: 2.22, 1999: -1.51, 2000: -1.47,
           2001: -.76, 2002: -.15, 2003: .90, 2004: .34, 2005: .62, 2006: -.86, 2007: .62, 2008: -1.76,
           2009: -.89, 2010: 1.47, 2011: -1.29, 2012: -.71, 2013: -.24, 2014: -.24, 2015: .73, 2016: 2.50,
           2017: -.08, 2018: -.71, 2019: .99, 2020: .71, 2021: -.99, 2022: -.76, 2023: -.55, 2024: 1.84,
           2025: -.46, 2026: -.39}
WINTER = [11, 12, 1, 2, 3, 4, 5]
COLS = ["tile_id", "date", "winter_year", "snowfall_mmwe", "sf_3d_mm", "sf_7d_mm",
        "gust_max_3d_ms", "tmax_rise_3d_c", "swe_mm"]
N_PERM = 5000


def phase(v):
    return "El Nino" if v >= 0.5 else ("La Nina" if v <= -0.5 else "Neutral")


def region(lat, lon):
    if lon < 72.8:
        return "Hindu Kush (Chitral-Dir-Swat)"
    if lon < 73.6:
        return "Kohistan-Hazara"
    if lat < 35.1:
        return "Kashmir (Neelum-Leepa-Astore)"
    return "Karakoram (Gilgit-Baltistan)"


def perm_test(x, groups, a, b, rng):
    """two-sided permutation p-value for mean(a) - mean(b)."""
    m = np.isin(groups, [a, b])
    x, g = x[m], groups[m]
    if (g == a).sum() < 2 or (g == b).sum() < 2:
        return np.nan, np.nan
    obs = x[g == a].mean() - x[g == b].mean()
    cnt = 0
    for _ in range(N_PERM):
        gp = rng.permutation(g)
        if abs(x[gp == a].mean() - x[gp == b].mean()) >= abs(obs):
            cnt += 1
    return obs, (cnt + 1) / (N_PERM + 1)


def main(proc, events_csv):
    out = os.path.join(proc, "enso")
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(1)
    tt = pd.read_csv(os.path.join(proc, "rules", "tile_thresholds.csv")).set_index("tile_id")
    tt["region"] = [region(a, o) for a, o in zip(tt.lat, tt.lon)]

    # ---------------- A. events
    ev = pd.read_csv(events_csv)
    if "use_in_analysis" in ev:
        ev = ev[ev.use_in_analysis.astype(str).str.lower() == "yes"].copy()
    d0 = pd.to_datetime(ev["date_end"].fillna(ev["date_start"]))
    ev["winter_year"] = np.where(d0.dt.month >= 10, d0.dt.year + 1, d0.dt.year)
    ev["ONI_DJF"] = ev.winter_year.map(ONI_DJF)
    ev["ENSO_phase"] = ev.ONI_DJF.map(phase)
    ev["deaths_num"] = pd.to_numeric(ev["deaths"].astype(str).str.extract(r"(\d+)")[0], errors="coerce")
    keep = [c for c in ["event_id", "storm_id", "date_end", "location", "deaths", "winter_year",
                        "ONI_DJF", "ENSO_phase"] if c in ev]
    ev[keep].to_csv(os.path.join(out, "events_enso.csv"), index=False)
    st = ev.groupby("storm_id").agg(winter=("winter_year", "first"), phase=("ENSO_phase", "first"),
                                    deaths=("deaths_num", "sum"))
    first_w = int(ev.winter_year.min())
    base = pd.Series({y: phase(v) for y, v in ONI_DJF.items() if y >= first_w}).value_counts()
    summ = pd.DataFrame({"winters_in_record": base,
                         "winters_with_avalanche_disaster": st.groupby("phase").winter.nunique(),
                         "storms": st.groupby("phase").size(),
                         "deaths": st.groupby("phase").deaths.sum()}).fillna(0).astype(int)
    summ["share_of_winters_with_disaster"] = (summ.winters_with_avalanche_disaster /
                                              summ.winters_in_record).round(2)
    summ.to_csv(os.path.join(out, "events_by_phase.csv"))
    print(f"A. Recorded events ({first_w}-2026), by ENSO phase of the winter:")
    print(summ.to_string())

    # ---------------- B. all winters from ERA5
    print("\nB. loading ERA5 features (all winters) ...")
    parts = []
    for f in sorted(glob.glob(os.path.join(proc, "features", "era5_features_*"))):
        df = pd.read_parquet(f, columns=COLS) if f.endswith(".parquet") else pd.read_csv(f, usecols=COLS)
        parts.append(df[df.tile_id.isin(tt.index)])
    d = pd.concat(parts, ignore_index=True)
    d["date"] = pd.to_datetime(d.date)
    d = d[d.date.dt.month.isin(WINTER)]
    t = tt.reindex(d.tile_id)
    snowpack = d.swe_mm.values >= 30
    storm = (d.sf_3d_mm.values >= t.MODERATE_sf3d_mm.values)
    if "MODERATE_gust3d_ms" in t:
        storm &= d.gust_max_3d_ms.values >= t.MODERATE_gust3d_ms.values
    warm = np.zeros(len(d), bool)
    if "MODERATE_tmax_rise3d_c" in t:
        warm = (d.tmax_rise_3d_c.values >= t.MODERATE_tmax_rise3d_c.values) & \
               (d.sf_7d_mm.values >= t.MODERATE_sf7d_mm.values) & snowpack
    p99 = d.groupby("tile_id").sf_3d_mm.transform(lambda s: s.quantile(0.99)).values
    d = d.assign(alarm=storm | warm, storm_alarm=storm, warm_alarm=warm,
                 extreme_sf=(d.sf_3d_mm.values >= p99) & (d.sf_3d_mm.values >= 10),
                 region=t.region.values)
    # drop incomplete winters
    ndays = d.groupby("winter_year").date.nunique()
    full = ndays[ndays >= 200].index
    d = d[d.winter_year.isin(full)]

    per_tile = d.groupby(["winter_year", "region", "tile_id"]).agg(
        alarm_days=("alarm", "sum"), storm_alarm_days=("storm_alarm", "sum"),
        warm_alarm_days=("warm_alarm", "sum"), extreme_sf_days=("extreme_sf", "sum"),
        snowfall_total_mm=("snowfall_mmwe", "sum")).reset_index()
    rows = []
    for (w, r), g in per_tile.groupby(["winter_year", "region"]):
        rows.append({"winter_year": w, "region": r} | g.drop(columns=["winter_year", "region", "tile_id"]).mean().to_dict())
    for w, g in per_tile.groupby("winter_year"):
        rows.append({"winter_year": w, "region": "ALL northern Pakistan"} |
                    g.drop(columns=["winter_year", "region", "tile_id"]).mean().to_dict())
    win = pd.DataFrame(rows)
    win["ONI_DJF"] = win.winter_year.map(ONI_DJF)
    win["phase"] = win.ONI_DJF.map(phase)
    win.round(2).to_csv(os.path.join(out, "winters_by_region.csv"), index=False)

    metrics = ["alarm_days", "storm_alarm_days", "warm_alarm_days", "extreme_sf_days", "snowfall_total_mm"]
    res = []
    for r, g in win.groupby("region"):
        for m in metrics:
            x, ph = g[m].values, g.phase.values
            en, ln, ne = (g.loc[g.phase == p, m].mean() for p in ["El Nino", "La Nina", "Neutral"])
            diff, p = perm_test(x, ph, "El Nino", "La Nina", rng)
            rho = pd.Series(x).rank().corr(pd.Series(g.ONI_DJF.values).rank())  # Spearman without scipy
            res.append({"region": r, "metric": m, "El_Nino_mean": en, "La_Nina_mean": ln,
                        "Neutral_mean": ne, "ElNino_minus_LaNina": diff,
                        "pct_change_vs_LaNina": 100 * diff / ln if ln else np.nan,
                        "p_value_perm": p, "spearman_rho_with_ONI": rho,
                        "n_winters": len(g)})
    res = pd.DataFrame(res).round(3)
    res.to_csv(os.path.join(out, "enso_effect_by_region.csv"), index=False)
    print(f"\nB. All {win.winter_year.nunique()} full winters - El Nino vs La Nina "
          f"(p < 0.05 = unlikely to be chance):")
    show = res[res.metric.isin(["alarm_days", "extreme_sf_days", "snowfall_total_mm", "warm_alarm_days"])]
    print(show[["region", "metric", "El_Nino_mean", "La_Nina_mean", "Neutral_mean",
                "pct_change_vs_LaNina", "p_value_perm", "spearman_rho_with_ONI"]].to_string(index=False))

    plot(win, out)
    print("\nOutputs in", out)


def plot(win, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    regs = [r for r in win.region.unique() if r != "ALL northern Pakistan"]
    regs = ["ALL northern Pakistan"] + sorted(regs)
    col = {"El Nino": "#c0392b", "La Nina": "#1f5fa8", "Neutral": "#9a9a9a"}
    fig, axes = plt.subplots(1, len(regs), figsize=(4 * len(regs), 4), sharey=False)
    for ax, r in zip(np.atleast_1d(axes), regs):
        g = win[win.region == r]
        for p in ["La Nina", "Neutral", "El Nino"]:
            s = g[g.phase == p]
            ax.scatter(s.ONI_DJF, s.alarm_days, s=28, color=col[p], label=p, edgecolor="white", lw=0.8)
        z = np.polyfit(g.ONI_DJF, g.alarm_days, 1)
        xs = np.linspace(g.ONI_DJF.min(), g.ONI_DJF.max(), 10)
        ax.plot(xs, np.polyval(z, xs), color="#333333", lw=1)
        ax.axvline(0.5, color="#dddddd", lw=1, ls="--"); ax.axvline(-0.5, color="#dddddd", lw=1, ls="--")
        ax.set_title(r, fontsize=9)
        ax.set_xlabel("ONI (DJF)")
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
    np.atleast_1d(axes)[0].set_ylabel("MODERATE alarm days per winter (tile mean)")
    np.atleast_1d(axes)[0].legend(fontsize=7, frameon=False)
    fig.suptitle("Avalanche-alarm days per winter vs ENSO, 1970-2026 (ERA5)", fontsize=11)
    fig.tight_layout()
    fig.savefig(os.path.join(out, "enso_alarm_days.png"), dpi=120)
    plt.close(fig)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
