# Model output drop-in folder

The portal shows a prediction layer only for windows that have a file here. Nothing is
interpolated or invented for missing windows.

**File name:** `<window_id>.geojson`. Window IDs come from `/api/windows`, e.g. `2026-27-W01`
(15–29 Dec 2026). The convention is half-open `[start, end)`.

**Geometry:** Polygon / MultiPolygon cells (preferred) or Points, in EPSG:4326.

**Required feature properties**

| field | meaning |
|---|---|
| `risk_class` | e.g. `Low`, `Moderate`, `Considerable`, `High`, `Very High` |
| `score` | raw model score (optional) |
| `score_type` | `susceptibility_class`, `risk_category` or `calibrated_probability` |
| `model_version` | must match `model/model_card.json` |
| `run_time` | ISO timestamp of the model run |
| `input_start`, `input_end` | time range of the input data |
| `lead_time_days` | actual forecast lead time (0 = nowcast / susceptibility) |
| `uncertainty` | e.g. `low` / `medium` / `high`, or an interval |
