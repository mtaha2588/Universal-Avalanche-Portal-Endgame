# Thresholds: calibrated (not a preview)

`data/tile_thresholds.csv` is now the analysis team's real, calibrated file (`avalanche_portal_package_2026-10-30`,
2026-11-02), for 150 tiles across Hindu Kush, Kohistan-Hazara, Kashmir (Neelum-Leepa-Astore) and Karakoram. Each
tile's `MODERATE_*`/`HIGH_*` columns are that tile's own snowfall / gust / warming percentile from 57 winters of
ERA5 reanalysis (the step-3 output of `pipeline/`), not a fixed value shared across tiles. Validation against
documented historical events and storms is in `final_rule_validation.csv` (see `thresholds_meta.json`).

`data/student.joblib` + `percentile_tables.parquet` + `student_thresholds.csv` add an experimental machine-learning
risk score (`student_risk`, 0-1) alongside the rule-based alert; `run_forecast.py` uses it automatically when present
and falls back quietly (alerts still work) if the installed scikit-learn version doesn't match.

## History

An earlier version of this file documented a PREVIEW state: this portal had only `forecast_core.py` and no
calibration data, so every tile used the same fixed, literature-typical threshold rather than its own ERA5
percentile (real elevations, illustrative thresholds, clearly banner'd as not calibrated). That placeholder data is
kept in `_placeholder_backup/` for reference; `build_tile_grid.py` (the script that built it) is no longer used by
the live forecast but is left in place as a record of how the preview grid was built.

## To update when the analysis team sends a new `data/` folder

Replace this folder's contents (keep `config/` and `output/` as they are) and re-run `run_forecast.bat`. No code
change is needed anywhere -- `forecast_core.py` / `run_forecast.py` already read whatever is in `data/`.
