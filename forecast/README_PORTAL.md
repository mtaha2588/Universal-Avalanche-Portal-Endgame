# Northern Pakistan Avalanche Alert Forecast: portal package

This folder produces a daily avalanche **alert forecast** for about 150 tiles (25 km × 25 km) across the Hindu Kush, Kohistan–Hazara, Kashmir (Neelum–Leepa–Astore) and Karakoram. It downloads the latest ECMWF weather forecast and checks it against avalanche thresholds learned from 57 winters of ERA5 data and the recorded avalanche disasters. It then writes files a web portal can display.

Nothing in this folder needs the ERA5 archive to run the daily forecast.

This copy is wired into the main portal already (see `PORTAL_INTEGRATION.md` in this folder): the Flask app serves `output/latest/*` under `/api/alertforecast/*`, and the home page has an "Avalanche Alert Forecast" module that reads it. Re-running `run_forecast.bat` (or the scheduled task) is all that's needed to refresh what the portal shows — no server restart, no code change.

---

## 1. Requirements

- Windows 10/11 (Linux or macOS also work; use `python` instead of the `.bat` files)
- Python 3.10 or newer, ticked "Add python.exe to PATH" during install
- Internet access to `api.open-meteo.com` and `ensemble-api.open-meteo.com` (HTTPS, port 443)
- About 50 MB of disk space, plus about 3 MB per archived run

## 2. Install (once)

Double-click `install.bat`, or in a terminal inside this folder:

```
python -m pip install -r requirements.txt
```

## 3. Test

```
run_forecast.bat --check
run_forecast.bat
```

- `--check` downloads one point and lists the variables. Every line except `freezing_level_height` should show data.
- The second command runs the full forecast (2–5 minutes). It prints the highest alert level per region for the next 10 days and writes `output\latest\`.

## 4. Run automatically

Run `schedule_task.bat` once, as the user who will own the task. It creates two daily Windows tasks:

| Task | Time (Pakistan) | Uses ECMWF run |
|---|---|---|
| Avalanche Forecast 00z | 15:00 | 00 UTC |
| Avalanche Forecast 12z | 03:00 | 12 UTC |

To keep it running when nobody is logged in, open Task Scheduler, select each task, open Properties and choose "Run whether user is logged on or not".

**Not run automatically yet on this machine** — `schedule_task.bat` only sets up the Windows task when you run it yourself; nothing in this project does that for you silently.

## 5. Output files for the portal

Every run writes to `output\latest\`, replacing the previous run only once the new one is complete. A copy goes to `output\archive\<date>_<time>UTC\`.

| File | Use |
|---|---|
| `alerts_latest.json` | Main file for dashboards: issue date, regions per day, highlights, colours |
| `alerts_tiles_daily.geojson` | Map layer: one 0.25° square per tile per day. Filter on `date` or `lead_day` |
| `alerts_tiles_daily.csv` | Same as the GeoJSON, as a table |
| `alerts_region_summary.csv` | Highest level and counts per region and day |
| `alert_maps.png` | Ready-made 10-day map panel |
| `output\status.json` | Health check: `ok`, `last_success_utc`, `message` |

### Alert levels and colours

| level | level_name | Colour | Meaning |
|---|---|---|---|
| 2 | High | `#d7322b` | Extreme snow loading for this area (top 1% of its winter days) or warming after heavy fresh snow |
| 1 | Moderate | `#f2a93b` | Unusual snow loading with strong wind (top 5%), or warming after fresh snow |
| 0 | Low | `#d9e3ea` | No avalanche-loading signal in the forecast |
| -1 | Not rated | white, hatched | Tile too low (mean elevation below 1200 m) to have avalanche terrain |

### `alerts_latest.json`

```json
{
  "issued_for_date": "2026-10-30",
  "generated_utc": "2026-10-30T10:02:11Z",
  "run_type": "live",
  "source": "ECMWF IFS 0.25 deg (open data) via Open-Meteo",
  "ensemble_members": 51,
  "rule": "MODERATE: ... HIGH: ...",
  "days": ["2026-10-30", "..."],
  "levels": {"0": "Low", "1": "Moderate", "2": "High", "-1": "Not rated"},
  "colors": {"0": "#d9e3ea", "1": "#f2a93b", "2": "#d7322b", "-1": "#ffffff"},
  "regions": [
    {"region": "Kashmir (Neelum-Leepa-Astore)",
     "days": [{"date": "2026-10-30", "max_level": 0, "max_level_name": "Low",
               "tiles_rated": 40, "tiles_moderate_or_high": 0, "tiles_high": 0,
               "max_sf3d_mm": 3.2, "max_p_moderate_ens": 0.0, "max_p_high_ens": 0.0,
               "max_student_risk": 0.01}]}
  ],
  "highlights": [
    {"date": "...", "tile_id": "N34.875_E74.125", "region": "...", "level": 2, "level_name": "High",
     "lat": 34.875, "lon": 74.125, "sf_3d_mm": 85.1, "gust_max_3d_ms": 18.7,
     "tmax_rise_3d_c": 3.4, "p_moderate_ens": 0.82, "p_high_ens": 0.45}
  ]
}
```

### GeoJSON feature properties

| Property | Meaning |
|---|---|
| `tile_id` | Tile centre, e.g. `N34.875_E74.125` |
| `region` | One of the four regions |
| `date`, `lead_day` | Forecast day (UTC) and days ahead (0 = today) |
| `level`, `level_name`, `color` | Alert level (see above) |
| `elev_m` | Approximate mean elevation of the tile |
| `sf_3d_mm`, `sf_7d_mm` | 3-day and 7-day snowfall, mm water equivalent (about 1 cm of new snow per mm) |
| `gust_max_3d_ms` | Strongest 10 m gust in 3 days, m/s |
| `tmax_rise_3d_c` | Rise in daily maximum temperature over 3 days, °C |
| `ros_3d_mm` | Rain falling on snow, 3 days, mm |
| `snow_depth_m` | Forecast snow depth |
| `p_moderate_ens`, `p_high_ens` | Share of the 51 ensemble members at Moderate+ / High (0–1) |
| `student_risk` | Experimental machine-learning risk score (0–1); show as secondary information only |

Coordinates are WGS84 (EPSG:4326). Each tile is a 0.25° square around its centre.

## 6. Text the portal should show

- Issue date and time (`issued_for_date`, `generated_utc`) and "Next update about 15:00 / 03:00 PKT".
- Attribution: "Weather forecast: ECMWF IFS open data (CC BY 4.0), delivered by Open-Meteo.com."
- Disclaimer: "Experimental alert based on forecast snowfall, wind and temperature for 25 km areas. It does not assess individual slopes and is not an official avalanche danger rating. Follow local authorities and NDMA/PDMA advisories."

## 7. Settings (`config\settings.json`)

| Setting | Default | Meaning |
|---|---|---|
| `apikey` | empty | Open-Meteo API key. Free use is for non-commercial purposes only; operational or commercial use needs a key |
| `ensemble` | true | Download the 51-member ensemble (adds probabilities, takes longer) |
| `min_elev_m` | 1200 | Tiles below this elevation are "Not rated" |
| `high_sf3d_floor_mm` | 25 | Minimum 3-day snowfall for High |
| `warm_sf7d_floor_mm` | 20 | Minimum 7-day snowfall for a warming alert |
| `keep_archive_days` | 400 | Archived runs older than this are deleted |

## 8. Updating thresholds or the model

The thresholds and model live in `data\`. When the analysis team sends a new `data` folder, replace it and keep `config` and `output`.

**Right now `data\tile_thresholds.csv` holds PREVIEW thresholds, not the real per-tile ERA5 percentiles** — see `data\THRESHOLDS_NOTE.md`. The portal says so prominently. Dropping in the analysis team's calibrated file (same file name, same columns) switches the whole system over automatically; no code change anywhere.

The `pipeline\` folder holds every analysis script (steps 1–7) on the analysis PC (not included in this portal copy). If you have the ERA5 CSV files in the same format (`ERA5_NPak_daily_<year>.csv`), the analysis team can rebuild everything there. To replay a past storm on this PC, point `--features` at a processed ERA5 features folder:

```
run_forecast.bat --replay 2005-02-08 --features "D:\ERA5\processed\features"
```

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `python` not recognised | Reinstall Python with "Add to PATH", or use `py` instead of `python` |
| `status.json` has `"ok": false` | Read `message` and `logs\forecast_<month>.log`. Usually no internet, or Open-Meteo is busy (HTTP 429): it retries, and the next scheduled run will try again |
| Run takes very long | Set `"ensemble": false` in settings to skip the ensemble |
| `student model not used` in the log | The scikit-learn version differs from the one the model was saved with. Alerts still work. Install the version in `requirements.txt` |
