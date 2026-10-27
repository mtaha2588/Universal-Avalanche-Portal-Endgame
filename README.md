# Snow Avalanche Prediction Using AI

NDMA — Next Generation Technologies (NGT). A decision-support portal for avalanche
situational awareness in northern Pakistan (Hindu Kush, Karakoram, Western Himalaya).

> **Decision support only.** Outputs are not official warnings unless they are validated and issued
> by NDMA / PDMA / GBDMA / SDMA.

## Run locally (Windows)

Double-click **`run.bat`**. It creates a virtual environment, installs dependencies, starts the server
and opens **Google Chrome** full screen on the home screen (`http://127.0.0.1:5000/`). Press any key in
the `run.bat` window to stop the portal.

- `/` is the home screen: season window slot bar and module launcher.
- `/portal` is the live portal (map, outlook, tables). Its **Home** button returns to `/`.
- `/portal?window=2026-27-W03#map` opens a specific window and page directly.

Or run it manually:

```bash
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env            # optional: add MAPBOX_TOKEN
python app.py                     # http://127.0.0.1:5000  (Waitress server)
python -m pytest -q               # 15 tests
```

The map needs an internet connection for the map library and basemap tiles. Everything else runs
offline.

## Before presenting

1. **NDMA logo:** save the official logo as `static/img/ndma-logo.png`. If the file is missing, the
   portal shows a neutral "NDMA" text badge in its place.
2. **Mapbox (optional):** put a public `pk.` token in `.env` as `MAPBOX_TOKEN` and restrict it to your
   domain. Without a token the portal uses Esri imagery, OpenTopoMap and CARTO basemaps through MapLibre.
3. **Road analysis:** run `python scripts/fetch_osm.py roads` to download real OSM highway centerlines.
   The Highway & Infrastructure page and the map's road layer then become active.

## Architecture

```
app.py                       Flask routes (pages, JSON API, exports, printable report)
config.py                    Environment-based configuration (no secrets in code)
portal/services/windows.py   Season / 15-day half-open window generator
portal/services/spatial.py   Haversine, point-in-polygon, line distance (dependency-free)
portal/services/data_store.py  Dataset registry, filtering, exposure & road analysis
portal/services/exports.py   CSV / GeoJSON with provenance metadata
data/catalog.json            Registry: source, date, CRS, resolution and limitations per dataset
data/predictions/            Drop-in folder for model outputs, one GeoJSON per window
model/model_card.json        Model documentation (currently: not connected)
templates/home.html          Home screen (module launcher, season slot bar)
templates/portal.html        Live portal shell; templates/report.html printable brief
static/                      CSS, JS (app, map, views, ui), logos, module screenshots
scripts/fetch_osm.py         Real road and settlement data from OpenStreetMap
tests/                       Window, spatial, API, export and security tests
```

## Data status: what is real and what is not

| Dataset | Status | Notes |
|---|---|---|
| Study-area extents | Indicative | Rectangles used for filtering only. **Not official boundaries.** Replace with GMBA or another documented dataset. |
| Settlements | Reference | 20 district and tehsil centres, approximate to ±2–5 km. No population figures. |
| Incidents | Seed | 4 widely reported events. Locations are proxies. Casualty figures are as reported and **unverified**. Reconcile with NDMA records and add source URLs. |
| Roads | Not loaded | Run `scripts/fetch_osm.py roads`. |
| Hazard / runout zones | Not loaded | Needed before settlement or road exposure can be assessed. |
| Prediction model | Not connected | Add outputs to `data/predictions/<window_id>.geojson` and complete the model card. |

The portal never fills these gaps with synthetic data. Missing layers are shown as "No data" or
"Not assessed".

## 15-day windows

The season runs from 15 Dec to 15 Apr and is split into half-open windows `[start, end)`. Window IDs
look like `2026-27-W01`. The last window is shorter. These are **reporting windows**. They do not
define forecast lead time, which is set by the model card's `max_validated_lead_time_days`.

## Deployment notes

A local server is only reachable from this computer. To serve the portal to others:

- `python app.py` already serves through Waitress (production WSGI server). Set `HOST=0.0.0.0` to listen on the network,
  behind HTTPS.
- Add authentication and role-based access if the portal will hold operational or sensitive data.
- Confirm data licences (OSM ODbL, Esri, Mapbox terms) before public use.
- Have subject-matter experts review thresholds, the preparedness text and incident records.
