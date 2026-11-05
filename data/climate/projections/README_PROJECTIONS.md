# Avalanche-condition projections to 2100: portal guide

These files show how often the weather that causes avalanches in northern Pakistan is projected
to occur in each 5-year window from 2025 to 2100, compared with 1995-2014, under two emission
scenarios. They are fixed results: unlike the daily forecast, nothing needs to run on a schedule.
Replace the files when the analysis team sends an update.

## Files

| File | Use |
|---|---|
| `projections_summary.json` | All numbers for charts and tables |
| `projections_tiles.geojson` | Map layer: one 0.25 deg square per tile, change per scenario and period |
| `projections_by_region.csv` | Same numbers as a flat table |
| `chart_*.png`, `map_*.png` | Ready-made figures |

## `projections_summary.json`

```
{
  "generated": "2026-11-03",
  "baseline_period": "1995-2014",
  "scenarios": {"ssp245": {"name": "...", "models": [...]}, "ssp585": {...}},
  "metrics": {"alarm_days_moderate": {"label": "...", "unit": "days per winter"}, ...},
  "periods_5yr": ["2025", "2030", ..., "2100"],     # "2030" = winters 2026-2030
  "periods_20yr": ["2021-2040", ..., "2081-2100"],
  "groups": [
    {"group": "ALL northern Pakistan", "group_type": "all",
     "baseline": {"alarm_days_moderate": 5.1, ...},
     "series": {"ssp245": {"2030": {"alarm_days_moderate": {"value": 4.1, "change_pct": -20,
                                     "change_pct_min": -29, "change_pct_max": 1,
                                     "models_more": 1, "models_less": 2}, ...}, ...}}}
  ]
}
```

`group_type` is `all`, `region` (Hindu Kush, Kohistan-Hazara, Kashmir, Karakoram) or `band`
(elevation: below 2500 m, 2500-3500 m, above 3500 m).
`change_pct` is the median over the climate models; `change_pct_min` / `change_pct_max` give the
model range. `models_more` / `models_less` count models projecting more / fewer alarm days.

## Suggested display

1. **Line chart per region:** x = 5-year window (2025 ... 2100), y = `change_pct` of
   `alarm_days_moderate`, one line per scenario (SSP2-4.5 blue `#2f6f8f`, SSP5-8.5 red `#c2412d`),
   shaded band from `change_pct_min` to `change_pct_max`. Zero line = 1995-2014.
2. **Map:** `projections_tiles.geojson`, colour by `alarm_days_change_pct` with a diverging
   scale (blue = fewer, red = more, white = no change), with selectors for scenario and period.
3. **Summary cards:** the four 20-year periods for "ALL northern Pakistan".
4. **Snow-to-rain card:** `snow_share_pct` change in percentage points; this is the most robust signal.

## Text the portal should show

- "Projected change in avalanche-favourable weather (heavy snow with wind, warming after fresh
  snow) compared with 1995-2014. Based on NASA NEX-GDDP-CMIP6 climate projections (CC0), median
  and range of the climate models listed. These are projections of weather conditions, not of
  avalanche numbers or losses; exposure from roads and settlements is not included."
- "5-year windows vary strongly with natural climate variability (for example El Nino); use the
  20-year periods for trends."
