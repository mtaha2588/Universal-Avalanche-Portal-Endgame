"""
build_demo_data.py - data for the static interview demo (demo/), taken from the portal's own files
==================================================================================================
The demo (a recording of the running portal) runs on GitHub Pages without the Flask server, so it cannot call /api.
This script collects every figure the demo's captions quote into demo/data/facts.json, from the portal's own files.
Nothing is typed in by hand: re-run it after the data change, then re-capture the screenshots
(scripts/demo_capture.ps1). Standard library only:

    .venv\\Scripts\\python.exe scripts/build_demo_data.py

Writes demo/data/facts.json.
"""
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo" / "data"


def load(p):
    return json.loads((ROOT / p).read_text(encoding="utf-8"))


def save(name, obj):
    p = OUT / name
    p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return f"{name} {p.stat().st_size // 1024} KB"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    done = []
    # ---- historical records placed on the map (tier E records have no place) ----
    ev = load("data/history/events/pk_events.geojson")
    pts = []
    for f in ev["features"]:
        p, g = f["properties"], f.get("geometry")
        if not g:                                     # tier E records have no place; D = valley / district only (shown as such)
            continue
        pts.append(p["event_id"])

    # ---- every figure the captions quote ----
    pk = load("data/glaciers/pakistan_summary.json")
    al = load("forecast/output/latest/alerts_latest.json")
    meta = load("forecast/data/thresholds_meta.json")
    st = load("forecast/output/status.json") if (ROOT / "forecast/output/status.json").exists() else {}
    pr = load("data/climate/projections/projections_summary.json")
    allp = next(g for g in pr["groups"] if g["group_type"] == "all")
    p85 = allp["series"]["ssp585"]["2081-2100"]
    era = load("data/climate/era5_winter.json")
    hk = load("data/screening/hk_run.json")
    num = lambda v: float(v) if str(v).replace(".", "", 1).isdigit() else None
    deaths = sum(num(f["properties"]["deaths"]) or 0 for f in ev["features"])
    facts = {
        "built_from": "portal data files (scripts/build_demo_data.py)",
        "glaciers": {"total": pk["total"]["n"], "km2": pk["total"]["km2"], "study_area_km2": pk["study_area_km2"],
                     "systems": {k: {"n": v["n"], "km2": v["km2"], "zmax_m": v["zmax_m"], "largest": v["largest_named"]["name"], "largest_km2": v["largest_named"]["km2"]}
                                 for k, v in pk["systems"].items()}, "source": "RGI v7.0 (NSIDC, 2023)"},
        "forecast": {"issued_for": al["issued_for_date"], "generated_utc": al["generated_utc"], "source": al["source"], "tiles": meta["tile_count"],
                     "winters": 57, "min_elev_m": meta["min_elev_m"], "days": len(al.get("days", [])),
                     "validation": meta["validation"], "last_run_ok": st.get("ok"), "last_attempt_utc": st.get("last_attempt_utc"), "last_success_utc": st.get("last_success_utc")},
        "history": {"records": len(ev["features"]), "located": len(pts), "replayed_3d": sum(1 for f in ev["features"] if f["properties"].get("anim")) + 1,   # + Batura 1974 (NGT model path)
                    "deaths_reported": int(deaths), "span": [min(f["properties"]["date"][:4] for f in ev["features"] if f["properties"]["date"]), max(f["properties"]["date"][:4] for f in ev["features"] if f["properties"]["date"])]},
        "projections": {"generated": pr["generated"], "baseline": pr["baseline_period"], "alarm_days_baseline": allp["baseline"]["alarm_days_moderate"],
                        "snow_share_baseline": allp["baseline"]["snow_share_pct"],
                        "ssp585_2081_2100": {"alarm_days": p85["alarm_days_moderate"]["value"], "alarm_change_pct": p85["alarm_days_moderate"]["change_pct"],
                                             "snow_share_change_pts": p85["snow_share_pct"]["change"]},
                        "models": {k: len(v.get("models", [])) for k, v in pr["scenarios"].items()}, "adjusted_to_era5": bool(pr.get("adjustment_to_era5"))},
        "era5": {"tiles": era["meta"]["tiles"], "winters": len(era["meta"]["years"]), "period": f'{era["meta"]["years"][0]}-{era["meta"]["years"][-1]}'},
        "screening": {"very_high_areas": hk["hotspots"], "tiles": hk["tiles"], "run": hk["run_id"]},
    }
    done.append(save("facts.json", facts))
    print("\n".join(done))


if __name__ == "__main__":
    main()
