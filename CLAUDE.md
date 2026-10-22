# Pakistan Avalanche Intelligence & Early-Warning Portal

Decision-support web portal for NDMA, Next Generation Technologies (NGT). It is shown to senior and
foreign officials, so visual polish matters. Data honesty matters more.

## Run and test

- `run.bat` creates `.venv`, installs requirements, starts the server and opens Chrome full screen at http://127.0.0.1:5000/
- `python app.py` serves with Waitress. Set `FLASK_DEBUG=1` in `.env` for auto-reload while editing.
- `python -m pytest -q` runs 20 tests (date windows, spatial logic, API, exports, security, Hindu Kush screening).
- Restart the server after editing anything in `templates/`, because Flask caches templates when not
  in debug mode. Edits to `static/` only need a browser refresh (Ctrl+F5).

## Public deployment (Oracle Cloud Always Free)

- Guide: `deploy/DEPLOY.md`. One command from Windows: `deploy\deploy.ps1 -Ip <ip> -Key <private key>` builds
  `dist/avalanche-portal.zip` (`deploy/make_bundle.py`; no .venv/caches, includes `.env`), uploads it and runs
  `deploy/setup_server.sh` on Ubuntu: app in `/opt/avalanche-portal`, systemd service `avalanche-portal` (Waitress on
  127.0.0.1:5000), nginx on 80/443, free HTTPS for `<ip-with-dashes>.sslip.io` via certbot. Re-running updates in place.
- Optional login: `/etc/nginx/.portal_users` (htpasswd) is picked up by the installer.
- Railway (chosen host): `Dockerfile` (auto-detected; railway.json is deprecated by Railway from 2026-12-01), guide `deploy/RAILWAY.md`. `.env` is
  excluded by `.railwayignore` / `.dockerignore`; MAPBOX_TOKEN and SECRET_KEY are Railway variables. Update with
  `railway up --service avalanche-portal --detach`. The process uses ~450 MB RAM after all layers are loaded.

## Pages and routes

- `/` serves `templates/home.html`, the single-screen home: module tiles that open modal windows, the
  season slot bar and the selected-window panel. It is sent raw with `send_from_directory`, NOT through
  Jinja, because its JS uses `${}` template literals. Do not put Jinja syntax in it.
- `/portal` renders `templates/portal.html`, the live portal (SPA with hash routes such as `#map`).
  `?window=2026-27-W03&region=karakoram` preselects the context. The Home button links to `/`.
- `/portal#hindukush` is the Hindu Kush terrain-screening page (`static/js/hindukush.js`, registered as
  `Views.hindukush`; it owns its own map in `#hk-map` and is disposed when you navigate away). Linked from the side
  nav, the Mountain System Explorer card and the home page's Hindu Kush card.
- `/report` renders `templates/report.html`, the printable brief.
- `/api/*` is the JSON API in `app.py`. Exports are at `/api/export/<dataset>.<csv|geojson>`.
- Navigation stays in one tab. Only external source links may use `target="_blank"`.

## Code map

| Area | File |
|---|---|
| Routes and API | `app.py` |
| Settings and env | `config.py`, `.env` (copy `.env.example`; holds the optional `MAPBOX_TOKEN`) |
| 15-day windows | `portal/services/windows.py` |
| Distances, point-in-polygon | `portal/services/spatial.py` |
| Data loading, exposure and road analysis | `portal/services/data_store.py` |
| CSV/GeoJSON with metadata | `portal/services/exports.py` |
| Portal boot, intro, slot bar, autoplay | `static/js/app.js` |
| Map (MapLibre, or Mapbox when a token is set) | `static/js/map.js` |
| Page renderers | `static/js/views.js` |
| Hindu Kush screening page | `static/js/hindukush.js` (styles: `.hk-*` at the end of `portal.css`) |
| Helpers, icons, season phases | `static/js/ui.js` |
| Portal styles | `static/css/portal.css` (home.html has its own inline CSS) |

## Data (all EPSG:4326 GeoJSON)

- Register every dataset in `data/catalog.json` with source, date, CRS, resolution, limitations and
  status (`seed | reference | indicative | loaded`). A missing file shows as "Not loaded" automatically.
- `incidents.geojson`: 4 seed records with proxy locations and unverified, as-reported casualty
  figures. Keep `event_date` separate from `report_date`.
- `settlements.geojson`: 20 approximate town centres with no population figures.
- `regions.geojson`: indicative bounding boxes, NOT official mountain-system boundaries.
- Not yet supplied: `roads.geojson` (create it with `python scripts/fetch_osm.py roads`),
  `hazard_zones.geojson`, susceptibility and snow cover.
- Model outputs go in `data/predictions/<window_id>.geojson` (format in `data/predictions/README.md`).
  Model documentation goes in `model/model_card.json`, whose status is currently `not_connected`.

## Hindu Kush terrain screening

- Imported from one notebook run with `python scripts/build_hk_screening.py <run folder>` (needs numpy + Pillow;
  use the system Python, they are not in `requirements.txt`). Current run: `hindukush_avalanche_risk_20261015_0939`.
- Writes `data/screening/hk_hotspots.geojson` (16,388 Very-high areas ≥ 5 ha, centroid points, ranked by area),
  `hk_tiles.geojson` (98 tile centres with class shares), `hk_run.json` (thresholds, class areas, overlay bounds) and
  `static/img/hindukush/` (the run's figures + `hk_classes.png`).
- `hk_classes.png` is the run's figure `01_avalanche_risk_map.png`, georeferenced from its axis ticks (fit residual
  ≈0.0006°), colour-matched to the five classes and resampled to Web Mercator (~200 m display pixels). The figure's labels
  and top-10 circles leave blank holes there; they are deliberately NOT filled. The "winter snow, not steep" class is
  omitted (it is indistinguishable from label boxes). Replace with the real GeoTIFF if the notebook ever exports one.
- API: `/api/screening/hindukush`, `/api/layer/hk_hotspots` (gzipped), `/api/layer/hk_tiles`, exports
  `/api/export/hk_hotspots.<csv|geojson>?min_ha=&facing=N,NE&tile=`.
- It is terrain susceptibility: label it "screening", the score is an index (not a probability), not validated, not a
  forecast. It uses the run's yellow→dark-red palette, never the model-prediction palette.

## Home-page glacier background

- `data/glaciers/rgi7_region14_systems.geojson`: the 37,562 official RGI v7.0 Region 14 glacier outlines
  (simplified about 30 m), built by `scripts/build_glaciers.py` from `Downloads/rgi2000-v7.0-g-14_south_asia_west.zip`.
  `system` = RGI sub-region (14-01 Hindu Kush, 14-02 Karakoram, 14-03 West Himalaya). Not clipped to any
  border; the sub-regions include glaciers in India, China and Afghanistan. Served at `/api/layer/glaciers`.
- home.html draws it on a 3D map: Mapbox GL JS v3 with satellite and terrain when `MAPBOX_TOKEN` is set,
  otherwise MapLibre with Esri imagery and AWS terrain. Terrain starts at 2× vertical exaggeration (DEFAULT_EXAG, labelled in the Layers panel; slider back to 1× = true elevation). Glacier fill fades with zoom so satellite detail stays visible.
- "Explore 3D" (or `/#explore`) hides the modules; Esc returns. The camera orbits slowly and tours the
  three systems; any user interaction pauses it.
- Loading speed: the server gzips the 14 MB layer once (about 2.5 MB) and warms it in a background thread at
  startup; `/api/layer/glaciers/summary` gives the chips their counts and centres; MapLibre fetches and parses
  the full file in its worker (`data: "/api/layer/glaciers"`), so the page never blocks. The map and the
  glacier data load in parallel.
- Glacier systems are shown two ways: `rgi7_system_extents.geojson` (main, glowing outline: envelope of each system's
  RGI outlines merged within ~5 km, clipped to its GTN-G region so the three never overlap; rebuild with
  `scripts/build_extents.py`) and the official GTN-G region limits (thin dashed).
- `rgi7_major_glaciers.geojson`: largest named glaciers per system from RGI `glac_name` (inventory codes stripped).
  Labels are clickable; the "Fly to a glacier" selector outlines the glacier in white and holds the camera
  (the auto-tour stays paused for 10 minutes or until the user picks another view). Names appear by size and zoom.
- Mapbox key is in `.env` (MAPBOX_TOKEN, public pk.*). With it the home map uses Mapbox GL JS v3 (satellite-streets
  + terrain DEM + fog); Mapbox's own admin boundaries, state labels, road shields and POIs are hidden so only the
  portal's official boundary layer shows. A rejected key (401/403) falls back to MapLibre automatically.
- Layers panel 3D controls: 2D/3D tilt, vertical exaggeration slider (default 1× = true elevation), hillshade toggle.
- MapLibre is self-hosted in `static/vendor/` (v4.7.1, BSD-3). Mapbox GL JS still loads from api.mapbox.com.
- Fonts load asynchronously (`media="print" onload`); intros are 1.4 s (home) and 2.2 s (portal).
- `run.bat` reinstalls packages only when `requirements.txt` differs from `.venv/requirements.installed`.
- Boundary layers on the same map (built by `scripts/build_boundaries.py` from Natural Earth 1:10m and GTN-G 2023 / RGI v7.0 regions):
  `data/boundaries/pakistan_boundaries.geojson` has `layer` = pakistan (official view) | province (current names,
  former FATA merged into KP) | disputed (Pakistan-related only, Natural Earth notes) | line (LoC, indeterminate
  frontier); `data/glaciers/rgi7_o2_regions_14.geojson` holds the three official glacier-region boundaries.
  Served at `/api/layer/boundaries` and `/api/layer/glacier_regions`. Labels are DOM markers with a minimum zoom
  so the country view stays uncluttered; the Layers panel toggles each group.
- Headless screenshots with `--virtual-time-budget` miss this map (network tiles, 14 MB GeoJSON). Capture in
  real time through the DevTools protocol instead.

## Season window convention

The season runs 15 Dec → 15 Apr in 15-day half-open windows `[start, end)`. The last window is shorter.
IDs look like `2026-27-W01`. The home screen's JS duplicates this logic; keep it in sync with
`windows.py`. The slot-bar phase labels (Early winter … Melt onset) are descriptive only.

## Non-negotiable rules

- Never fabricate data: no invented incidents, coordinates, boundaries, populations, predictions or
  model metrics. Missing data is shown as missing.
- A reporting window is not a forecast lead time. Label a score as a probability only if it is calibrated.
- Never state that a road is closed. Use "potential exposure — requires verification".
- No evacuation orders and no "safe" claims. Keep the decision-support disclaimer visible.
- Keep susceptibility, model predictions, observed incidents and official alerts visually separate.
- Political boundaries come only from `data/boundaries/pakistan_boundaries.geojson` (Natural Earth, Pakistan point
  of view, requested by NDMA). Always show Jammu & Kashmir as disputed and the Line of Control as dashed, with the
  note in the home page's Layers panel. Never invent or hand-draw boundaries.

## Gotchas

- The map container id is `map-canvas`. An element with id `map` would make the browser scroll to it on `#map`.
- MapLibre's CSS overrides `.maplibregl-map { position: relative }`, which is why the selector is `#map-canvas.map`.
- Logos live at `static/img/ngt-logo.jpg` and `static/img/ndma-logo.png`.
- Screenshots in `static/img/screens/` are shown in home.html's module windows. Regenerate them after UI
  changes, for example with headless Chrome: `chrome --headless=new --window-size=1600,1000
  --virtual-time-budget=9000 --screenshot=<file> "http://127.0.0.1:5000/portal#<page>"`.

## Snow outlook 2026-27

- Imported from one notebook run with `python scripts/build_snow_forecast.py <run folder>` (system Python: pandas, numpy, shapely,
  pyproj). Current run: `Northern_Pakistan_Snow_Avalanche_2026_27`. Writes `data/forecast/snow_2026_27.json` (method, skill,
  thresholds, coverage), `snow_stations.geojson` (36 stations), `hk_zones.geojson`, `hk_tiles_windows.geojson`.
- API: `/api/forecast/snow`, `/api/layer/snow_stations|hk_zones|hk_tiles_windows`. UI: `static/js/snowforecast.js`
  (`Views.snowforecast`, route `#snowforecast`, and `HKF`, the forecast mode behind the "Snow forecast 2026-27" button on `#hindukush`).
- It is a SEASONAL statistical outlook: totals are forecast, timing inside the season is the 1990-2025 average, danger days
  are 3-day snowfall counts (>= 50 cm HIGH, >= 30 cm elevated). Hindu Kush and Karakoram forecast = normal (no method beat it by > 1 %);
  Himalaya uses El Nino analogs. Thresholds are notebook defaults, not learned (no avalanche inventory matched). ONI 2.5 is a
  notebook input, not verified. Not validated, not a probability.
- The model data end 31 Mar: W01-W07 are complete, W08 has 2 of 15 days, W09 none. They stay empty (hatched), never estimated.
  To cover 1-15 Apr, re-run the notebook with April in `WINTER_MONTHS`, then rerun the build script.
- Hindu Kush zones are nearest-station areas (<= 60 km, inside Pakistan), no interpolation. Tile glow index = 100 x tile share of
  High/Very-high terrain x station HIGH-danger days / maximum: a relative ranking. 38 of 98 tiles are blank (outside Pakistan or too far).
- Palette is blue -> magenta, kept apart from the yellow -> red terrain-screening palette.
- Hindu Kush forecast mode (default on `#hindukush`): the portal's top slot bar IS the timeline (App.setWindow -> HKF.fromTop; its play button
  steps 5 s per slot and skips W08/W09, which the outlook does not model). The on-map snow-outlook panel and the KPI cards were removed
  (`.hk-stage.no-kpi`, taller map). DEM hotspots use the page's
  minimum area (default 120 ha). Main hotspot (red star) = DEM very-high area in a tile whose nearest station forecasts
  >= 0.5 HIGH-danger days in that slot. Red dot = other DEM hotspots. Dark blue = weather tiles. Green = populated (approximate).
  Icon rail: General risk / DEM hotspots / Snow & weather, plus a Populated toggle.

## Home-page glacier map: Pakistan study area

- Built by `python scripts/build_study_area.py <rgi2000-v7.0-g-14_south_asia_west.zip>` (system Python: geopandas, shapely, pyproj). Study area =
  union of the province / territory polygons in `pakistan_boundaries.geojson` (Pakistan-administered area incl. Gilgit-Baltistan and AJK;
  India-administered J&K, Siachen and the Shaksgam Valley are outside). Nothing is hand-drawn.
- Writes `data/boundaries/study_area.geojson` (study polygon, world mask, border split into `international` solid and `claim` dashed),
  `data/glaciers/rgi7_pakistan.geojson` (12,888 RGI outlines clipped to the study area; `area_km2` = official whole-glacier area,
  `area_pk_km2` = inside part, plus zmin/zmed/zmax, slope, aspect, lmax, src_date), `rgi7_context.geojson` (outlines outside, grey, on demand),
  `rgi7_system_extents_pk.geojson`, `rgi7_major_glaciers_pk.geojson` (`in_study_area`), `pakistan_summary.json`.
- API: `/api/glaciers/pakistan`, `/api/layer/glaciers_pk|glaciers_context|glacier_extents_pk|major_glaciers_pk|study_area` (big ones gzipped, warmed at startup).
- home.html: clicking a glacier, system chip, province, disputed area or border opens the `#ginfo` panel (name, RGI ID, centroid, elevation, area, source);
  `#readout` shows cursor coordinates and DEM elevation; the Layers panel has toggles for boundaries, study-area mask, outlines, systems, region limits,
  names, grey context glaciers, satellite, 3D terrain, hillshade. Selecting a system fades the other two.
- `.shell` now has `pointer-events: none` (only its controls are clickable). Before, it covered the viewport and the map never got mouse input.
- Test helpers: `bgMap.pick(x, y)`, `bgMap.clickAt(x, y)`, `bgMap.layerState(ids)`, `bgMap.terrainInfo()`.

## Home dock, Hindu Kush side list and regional hotspot register

- Home page: the left window panel and the "How it works" / "Launch" buttons are gone (the "Launch Live Portal" tile is an `<a href="/portal">`).
  The right dock is one column of module tabs styled like the season tabs; Incidents, Precautions, Data & Model, How it works, Principles
  and Live Preview tiles were removed. Modules renumber automatically.
- `#hindukush` forecast mode: the right-hand list follows the icon that is on (`HKF.sideList()` feeds `HK.renderList()`): General risk = main
  hotspots of the current slot, DEM hotspots = all DEM very-high areas, Snow & weather = heavy-snow tiles. Rows show coordinates and the nearest
  town (`HK.nearText`), and clicking one flies the map there. Aspect / tile / minimum-area filters apply to the map and the list alike.
- `portal/services/hotspot_register.py` builds the per-region list for the Reports & Exports window: `/api/hotspots/regions` and
  `/api/export/region_hotspots.<csv|geojson>?region=hindu_kush|karakoram|himalaya|all&min_ha=`. Hindu Kush = DEM hotspots in heavy-snow slots;
  Karakoram and Himalaya = snow-outlook STATIONS (no DEM screening exists for them), flagged `meets_threshold`. Nearest populated area is one of the
  20 approximate town centres, with distance and bearing.

## Karakoram hotspots (demo)

- `/portal#karakoram` (`static/js/karakoram.js`, `Views.karakoram`, global `KK`; side-nav "Karakoram Hotspots", home Karakoram tile). Same 3D satellite
  base map and star symbol as the Hindu Kush forecast mode, but NO timeline. Reuses `HK.engine/style/IC` and the `.hk-*` / `.hkf-*` styles.
- Data: the 10 hotspots supplied by NGT in `data/karakoram/hotspots.csv`, built with `python scripts/build_kk_hotspots.py` into `kk_hotspots.geojson`
  (coordinates, risk_index, class, elev_m, slope_deg copied unchanged; `country` read from the supplied address). API: `/api/karakoram/hotspots`.
- Entered from `#hindukush` via the "Karakoram" icon in the forecast-mode rail (and the "Karakoram →" toolbar button); the Karakoram rail has a
  "Hindu Kush" icon back. Stars are solid red (#ff2b2b, general risk) with the rank above; the right-hand list is open by default like Hindu Kush.
- Icon rail: General risk (toggles red stars + the hotspot list; click a row to fly there) and Populated (green dots = the portal's approximate town centres inside
  lon 73.0-76.8, lat 35.0-37.2; no population figures). `risk_index` is an index, not a probability.
- Hotspots 9 and 10 are in Xinjiang, China per the supplied addresses; they are shown and flagged "Outside Pakistan (per address)".

## Map tile cache and map speed

- `static/sw.js` (service worker, served at `/sw.js` with `Cache-Control: no-cache`, scope `/`) + `static/js/mapcache.js` (`MapPerf`, loaded by
  home.html and portal.html before any map script). Every map is created with `MapPerf.tune(gl)` + `new gl.Map(MapPerf.opts({...}))`.
- Caches: `map-tiles-v1` = Mapbox / Esri / CARTO responses, kept ONLY for the provider's Cache-Control max-age (Mapbox 12 h, Esri 24 h). Their
  terms forbid permanent storage and bulk pre-download, so do not add tile pre-fetching or longer lifetimes for them. `map-open-v1` = AWS
  terrain tiles + MapLibre demo glyphs (30 days). `map-lib-v1` = versioned mapbox-gl-js and `/static/vendor` (cache-first). Mapbox's `sku`
  billing parameter is stripped from cache keys. Portal pages, JS/CSS, images and `/api` are never cached by the worker.
- Measured on #hindukush: tile average 586 ms (first visit) -> 92 ms (second), mapbox-gl.js 1.1 s -> 0. Settings / About shows counts + "Clear map cache".
- Bump `VER` in sw.js to drop old caches. Headless Chrome inside the Bash sandbox cannot open CacheStorage ("Unexpected internal error");
  test the cache with a profile outside the sandbox.
