# Snow Avalanche Prediction Using AI

Portal title on every page (home header, intro, portal top bar, report, exports: `config.PORTAL_TITLE`). Formerly
"Pakistan Avalanche Intelligence & Early-Warning Portal".

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

- `/` serves `templates/home.html`, the single-screen home: module tiles that open modal windows over the
  3D glacier map. It is sent raw with `send_from_directory`, NOT through
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
| Portal boot, intro, router, region / window context | `static/js/app.js` |
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
`windows.py`. The season slot bars (the 15 Dec → 15 Apr window tabs on top of the home page and the portal), the
home "Season Timeline" module and the overview's season strip were REMOVED at the user's request; do not bring them back.
The window is chosen with the portal's "Reporting window" selector (and `?window=`); the home page passes the current window.

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
- Hindu Kush forecast mode (default on `#hindukush`): the slot follows the portal's "Reporting window" selector (App.setWindow -> HKF.fromTop;
  W08/W09 are not modelled; there is no autoplay since the top slot bar was removed). The on-map snow-outlook panel and the KPI cards were removed
  (`.hk-stage.no-kpi`, taller map). DEM hotspots use the page's
  minimum area (default 120 ha). Main hotspot (red star) = DEM very-high area in a tile whose nearest station forecasts
  >= 0.5 HIGH-danger days in that slot. Red dot = other DEM hotspots. Dark blue = weather tiles. Green = populated (approximate).
  Icon rail: General risk / DEM hotspots / Snow & weather, plus a Populated toggle.

## Winter climate 1970-2010 (ERA5-Land)

- Second tab of the Snow page (side-nav snow icon): `/portal#snowclimate` (`static/js/snowclimate.js`, global `SC`, `Views.snowclimate`; styles `.sc-*` at
  the end of `portal.css`). `SF.tabs()` draws the "Outlook 2026-27 | Winter climate 1970-2010" switch on both pages; app.js keeps the snow nav item active.
- Imported with `python scripts/build_era5_winter.py <ERA5_Pakistan_results_winter folder>` (system Python + numpy): `data/climate/era5_winter.json`
  (305 tiles x 41 winters x 9 variables, regional series, per-tile trends and temp-snow r), the two CSVs copied unchanged to `data/climate/era5_winter/`,
  figures + MP4s to `static/img/era5_winter/`. API `/api/climate/era5_winter` (gzipped), CSVs at `/api/climate/era5_winter/<name>.csv` (whitelisted).
- Honesty: reanalysis, not observations, not validated. 1974 is flagged estimated by the run: hatched, excluded from every trend / correlation.
  Snow cover was supplied 0-10,000 under a % label: divided by 100. Glacier cells sit at ERA5-Land's fixed store (depth 3,333 cm, SWE 10,000 mm),
  which inflates Karakoram depth / SWE; the tile inspector says so. Trends are OLS per decade, no significance test. Computed r = -0.11 (all tiles,
  observed winters) vs the run's figure C -0.12 (its own year set).
- Palettes: diverging blue-red (temperature), blues (snow), violets (snowfall), greens (melt), sand (wind), brown-teal (non-temperature trends):
  separate from the forecast (blue -> magenta) and screening (yellow -> red) palettes. Colour scales are fixed over all years (1-99 % quantiles).

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
  The right dock is one column of module tabs (dark glass; each tab's colour is only an accent: left bar, icon badge, faint tint); Incidents, Precautions, Data & Model, How it works, Principles
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
- Terrain elevation for EVERY 3D map (home Mapbox + MapLibre, map.js, hindukush.js) is `MapPerf.dem()`: open AWS Terrain Tiles (terrarium,
  SRTM-based, z12 = ~30 m) served by the portal at `/api/dem/{z}/{x}/{y}.png` from `data/dem/terrarium` (one-year immutable cache + the
  worker's `map-open` cache). Build with `python scripts/fetch_dem.py` (6,658 tiles, ~400 MB: glacier systems to z12, Pakistan to z9); missing tiles
  302 to the public copy. `data/dem/` IS committed to git (so a GitHub ZIP runs offline-terrain out of the box; largest tile 141 KB) but docker-ignored; the Dockerfile downloads it in its own layer. Zoom 10-12 over the glacier systems (70-78 E, 33-38 N; 5,841 tiles, 340 MB) are rebuilt from Copernicus DEM GLO-30 by `scripts/build_dem_copernicus.py` (scratch venv: rasterio, numpy, Pillow, scipy; heights rounded to whole metres; z0-9 stay SRTM-based AWS tiles). Attribution: Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved. Mapbox's DEM is no longer used, and
  Mapbox tiles must never be bulk-downloaded or stored beyond their headers (their terms) — the user asked for that and was told no.
- Bump `VER` in sw.js to drop old caches. Headless Chrome inside the Bash sandbox cannot open CacheStorage ("Unexpected internal error");
  test the cache with a profile outside the sandbox.

## Home-page cinematic intro

- `bgMap.intro()` in home.html (styles `.cine-*`, overlay `#cine`): Mapbox globe from orbit -> Pakistan (study-area mask dims to 0.8, official border
  glow pulses) -> Hindu Kush / Karakoram / West Himalaya (fly-in, radar ping, system glow pulse, count-up figures, dive to the largest named glacier with
  its outline highlighted) -> overview of all three. Plays EVERY time `/` is opened or reloaded (the user wants the storm and globe always seen;
  the old once-per-session rule hid it), and with `/#intro`; not with `/#home` (the portal's Home button), another deep link or reduced motion. "▶ Intro" chip replays it; any click, wheel, Esc or Space skips.
- Only camera moves and highlight styling: boundary geometry is untouched, every figure comes from `/api/glaciers/pakistan`. MapLibre (no token) has no
  globe and starts from a flat world view. Libraries stay Mapbox/MapLibre + CSS keyframes; Three.js/GSAP were considered and not needed.
- Idle orbit steps at ~30 fps and stops while a module window is open (GPU load).
- Map smoothness rules (home.html): never change a filter or a data-driven paint expression on the `glaciers` source at runtime; Mapbox /
  MapLibre then re-tile all 12,888 outlines (this was the intro's stutter). Glaciers are drawn as per-system layers `glacier-fill-hk|kk|wh` and
  `glacier-line-*` with fixed filters; system dimming changes only zoom constants (`paintSelection`), and the selected outline is feature-state
  `sel` (`selOutline(id)`). Intro pulses use paint transitions, not per-frame `setPaintProperty`. The intro preloads each next leg's tiles with
  `flyTo({preloadOnly})` (Mapbox only, only while the camera is still: flyTo stops any running move) and its panels use no
  `backdrop-filter`. Intro look: the ORIGINAL intro (glacier colours, camera path, pitch-72 glacier dive, white
  outline of the largest glacier) at the user's exaggeration setting; experiments with bare terrain, a glacier fly-through and an intro-only
  exaggeration boost were rejected. Smoothness: `warm()` preloads every stop's destination tiles during the Pakistan chapter, and `settle()`
  holds each arrival until the map is "idle" (max 1.8 / 2.2 s) so the orbit starts on full-detail terrain. Relief: hillshade lit from 315°
  (exaggeration 0.6) and Mapbox Terrain v2 contour lines (`contour-line` from z9.5, labelled every 5th/10th line from z11, Layers toggle
  "Contour lines", Mapbox only). `move()` listens for `moveend` only after starting the move (a stale synchronous moveend used to skip legs).
- Intro relief mode (`relief(true|false)`): while the intro plays, glacier fills drop to a tint (0.2 at z5) and outlines to 0.7, the
  system tint (`ext-fill`) to `EXT_FILL.relief`, and hillshade exaggeration rises 0.6 -> 0.9, so the DEM relief is not hidden under three
  coloured surfaces. Terrain heights and exaggeration are unchanged. Test helper `bgMap.jump(camera)` holds a fixed view for screenshots.
- Storm prelude (`Storm` in home.html, `#storm`, styles `.storm-*`): plays whenever the intro plays, including "▶ Intro" replays (`intro()` calls
  `Storm.play()`). ~5 s: dense canvas snow (four depth layers batched as one Path2D each + fine specks), aurora, light rays, out-of-focus flakes, glints, then a cyan scan that traces
  the real relief of northern Pakistan from the portal's DEM tiles (`/api/dem/7/89-91/50.png`, 70.3-78.8 E, 34.3-36.6 N: latitude profiles,
  contours 3,000-7,000 m, summits = local maxima > 6,000 m), the title "Snow Avalanche Prediction Using AI" (the page header keeps the portal name) and the quote "Reading glaciers before they move."
  `intro()` awaits `Storm.clear()` (at least 5 s after start, at most 12 s; the DEM grid is fetched once at page load), and the snow blows clear onto chapter 1's wide view.
  Storm HUD (`.storm-hud`, `.sh-*`): corner brackets, a boot log of what the intro really loads, UTC clock, scan longitude, DEM cells scanned, running max
  cell elevation, a graticule draped on the relief and a reticle on the highest 3.4 km DEM cell (Nanga Parbat massif). Every read-out comes from the DEM grid.
  Canvas rule: every `ctx.save()` in `Storm.frame` needs its `restore()`; a missing one once shifted all the snow half a screen to the right.
  `body.storming` hides the home panels meanwhile. Esc / Space / click skips storm and intro.
- Header badges flip to the same official logo file on the back (no generated stand-in faces).
- Storm -> globe integration (Mapbox): at intro start the map goes to a small globe low on the screen (`stormPadding()`, zoom 0.45) and starts
  turning (`spin()`, one jumpTo per frame, 14°/s slowing near 40°E so it never passes Pakistan). After the storm's terrain scan (`GLOBE_AT` 3 s)
  the storm opens a feathered window onto it (`Storm.globe` returns the globe's screen circle; cyan rim + orbiting ticks; relief fades to 40 %),
  snow still falling over it, plus two dashed orbit rings with running nodes. Blue "tech mapping" net ON the globe (`techNet()`, Mapbox
  layers `tnet-glow|line|node`: 15° graticule, nodes every 30°; decorative geometry, not data) from the start until the camera comes down
  to Pakistan. Heavy snow: a blizzard (up to 2,600 streaks, longer and brighter) for the whole storm (heavy snow kept throughout).
  The storm holds until the globe has been on screen `GLOBE_HOLD_S` (2.5 s; skip and the 12 s cap still win). The DEM reticle / summit marks
  fade as the window opens. `Storm.globe` is cleared only in `finish()`; `body.stormfade` (clear -> finish) keeps the chapter bar and badge
  hidden until the storm has fully faded, and the Skip button sits below the storm's read-out meanwhile. When the storm clears, chapter 1 eases the SAME globe up and larger (padding -> `introPadding()`) and on to
  Pakistan, starting at the spin's speed (ease-out), so there is no cut. A skip stops the spin and restores fog / labels.
- Holographic globe (user's reference: a blue "tech" Earth with dotted continents and orbit rings; built by the page, nothing copied):
  `holoMap(on)` fades the satellite raster out and draws navy oceans (Mapbox Streets `water`) over dotted blue land (`holo-tint` +
  `holo-dots` background pattern), blue `GLOBE_FOG`, blue-tinted soft hillshade; `Holo` is a canvas overlay (`#holo`, above the storm
  while it plays, below the captions after) drawing halo + rim, light spikes, three tilted orbit rings whose far half hides behind the
  globe, running particles, and the lock on Pakistan (green hexagon reticle, radar ping, label "PAKISTAN · STUDY AREA · <km²>" from
  `/api/glaciers/pakistan`). Inside the storm it opens with the window (`Storm.gOpen`). At the zoom-in (`later(1600)`) the hologram
  dissolves back to satellite and `Holo.out()` fades the overlay; a skip calls `holoMap(false)` + `Holo.stop()`.
- Chapter order: 1 Pakistan (with the globe) -> 2 Northern Pakistan -> 3-5 the systems. Chapter 1 (Mapbox): the storm clears onto the turning Earth
  (globe, `GLOBE_FOG` atmosphere + stars, world mask and Mapbox place labels off), which turns west to east for 4 s until Pakistan faces
  the camera (caption "Chapter 1 · Pakistan / Snow Avalanche Prediction Using AI", `long` two-line title), then zooms 3.8 s to Pakistan: `PAGE_FOG`,
  labels (`showLabels`) and the spotlight come back on the way down, the "Pakistan" study-area caption with figures, border glow, short orbit.
  MapLibre (no globe) starts on Pakistan. Chapters 1+2 now take about 19 s (they were about 30 s with the separate globe prologue).
- Intro chapter 2 "Northern Pakistan": the camera tilts onto a wide oblique 3D view of all three systems,
  then pulls back (7 s), the systems light up one by one, then the DEM / mapping layers and the HUD come on and stay for the whole intro.
  `Intel` in home.html (layers `ci-*`, HUD `#ci-legend` / `#ci-hud`, styles `.ci-*`), loaded only when an intro plays (`Intel.load()`):
  system colours `INTRO_COLORS` (= `SYS_COL`, see "One palette") on the RGI v7.0 extents (`ext` source); DEM elevation tint + 1,000 m contours (marching squares, ~2 km) from the z7 DEM mosaic x 89-91, y 49-51; mapping
  network = highest DEM point per 0.12° cell inside a system, linked to neighbours, draped on terrain (a VISUALIZATION, not glacier-flow data);
  icy RGI outlines (`ci-ice`, replaces the coloured glacier layers during the intro); Hindu Kush screening hotspots >= 120 ha.
  HUD: DEM elevation / slope / aspect at the camera target (z12 tiles, Horn 3x3), selected 15-day window (model "not connected", per-window
  snowfall bars of the nearest outlook station), weather card = nearest snow-outlook station; live temperature / wind / precipitation show
  "No live weather feed connected" (none exists). Glacier flow paths and snow cover are listed as no data. Layers are added once at opacity 0
  under the storm and only fade afterwards (no re-tiling); `ci-tint` is also set to visibility none when off (draped rasters can linger).
- Chapter 2 "tech mapping" look (division view only): `Intel.grade(true)` recolours the DEM hillshade blue/cyan (same relief), contours every
  500 m (1,000 m lines brighter + glow) and a fine 0.045° mesh, node halos, `Intel.wake()` glow beats (paint transitions), and a screen-space
  scan sweep + faint grid (`.ci-scan`, class `scan` on `#cine`; decorative, not data). Grade and scan end with chapter 2.
- Memory / lag rule for the intro: contours and the fine mesh are PRE-DRAWN into one 1536 px canvas (`ci-lines`, image source, blob URL) draped on
  the terrain, never GeoJSON. As vector GeoJSON they were ~136,000 segments and crashed Chrome ("Out of Memory") on a laptop. The build runs in
  steps (`await idle()`) with typed arrays and a rasterised system mask, so the storm keeps animating; HK screening comes pre-filtered from
  `/api/export/hk_hotspots.geojson?min_ha=120`. Measured (headless, 20 s): JS heap 105 -> 65 MB, longest main-thread stall 1.5 s -> 0.77 s
  (the page's own map start-up is 0.69 s). No CSS blend modes over the map (a full-screen re-blend every frame).

## Climate Data (home module)

- Home module "Climate Data" (`special: "climate"` in home.html, after Historical Overview; UI `static/js/climatedata.js` → `ClimateData.html(m)`,
  styles `static/css/climatedata.css`). Reads `/api/climate/era5_winter` and `/api/forecast/snow` only. Opens full page (`openWin` adds `.win.full`)
  with a "Back to modules" button. Order: the run's own mp4 (`static/img/era5_winter/`) as the main player, then the original PNG figures large,
  then the interactive charts. Everything stays in the portal: figures enlarge in the home `lightbox()`, no `target="_blank"` links.
- Shows a 1970–2026 axis, but the supplied run ends at winter 2010: 2011–2025 is drawn as an empty hatched band ("not in the supplied run"), never filled.
  2026–27 is the separate seasonal snow outlook (% of normal snowfall), labelled "not this scale". 1974 is estimated: hatched, left out of trends,
  decade means and the scatter. Snow depth / SWE glacier caps (3,333 cm / 10,000 mm) are flagged in the map tooltip.

## Historical overview (past events)

- Home module "Historical Overview" (`special: "history"` in home.html; `HIST` array, `historyHTML` / `openEvent` / `pane`). Event cards open a detail
  view with key figures, tabs 3D presentation | Figures | What changed | Summary | Downloads, and the "model reconstruction, not observation" note.
- Batura Glacier avalanche, 09 Aug 1974: NGT notebook outputs copied unchanged into `static/history/batura_1974/` (`story.html` = the supplied
  `batura_avalanche_3D_story.html`, self-contained WebGL2, embedded same-origin in an iframe only after "Play"; figures, mp4, CSV, slide text, `3d/`
  GLB/OBJ/GeoTIFF/CSV). The 14.7 MB `batura_terrain.obj` was left out (same mesh as the GLB). Catalog id `history_batura_1974`
  (`data/history/batura_1974/avalanche_features.geojson`). Release point, path, speed and duration are model estimates; weather is one ~28 km ERA5 tile.
- "On the map" (default mode of the full-page 3D experience, `bxMap()` / `.bxm-*`; "3D story" and "Video" stay as other modes): the model's own DEM tile
  (dem_m.tif, 522 x 332 cells, 74.2493-74.9501 E, 36.4001-36.7605 N, PixelIsArea) draped as an image source at its exact extent on the 3D
  satellite map, plus its outline, the release zone cells, the speed-coloured path, release / run-out / reference points, the ERA5 tile and the
  official boundaries. Camera tour Pakistan -> tile -> avalanche, then a replay of the model run (5x, as section D). Built by
  `python scripts/build_batura_map.py` (system Python, numpy + Pillow) into `static/history/batura_1974/map/` (tile.png rows resampled to Web
  Mercator spacing so the 4-corner image sits on its cells; tile.json; release_zone.geojson). Uses `bgMap.lib()` (the home map's engine).
  Its map container selector is `.bxm .bxm-map`: Mapbox CSS sets `.mapboxgl-map { position: relative }`, which made it 0 px tall.
- To add an event: copy its outputs to `static/history/<id>/`, add an entry to `HIST`, register it in `data/catalog.json`.

## Avalanche animation (Hindu Kush tour, Karakoram Batura)

- `static/js/avalanche.js` (`Avalanche.play(map, opts)`, loaded by portal.html before hindukush.js): a canvas over the 3D map (`.av-cv`, inside the map
  container) + read-out panel (`.av-hud`, in `.hk-stage`; `.hk-stage.av-on` hides the detail card, legend and caption). Points are placed with
  `map.project()` on a path mesh (7 nodes across), so the snow follows the map's own terrain while the camera moves. Release lock -> slab fracture
  (flash, ground shock ring) -> dense flow (1,400-1,800 particles) + powder cloud + slab blocks + scoured track -> deposit; call-outs RELEASE /
  PEAK SPEED / RUN-OUT; camera drift and a light shake (none with reduced motion). Esc or x stops it.
- Hindu Kush "Avalanche tour" (`#hk-tour`): visits the general-risk stars of the current slot (`HKF.order()`, else top 10 by area), ~6 s each
  (fly 1.3 s, flow 3.4 s). Motion = sliding block with Voellmy-type friction (mu 0.20, xi*h 4,000 m/s², textbook defaults, NOT calibrated) on the
  portal's DEM tiles; starts are searched across the release area (a centroid can sit on the valley floor) preferring >= mean elevation - 250 m.
  Labelled ILLUSTRATIVE: not a forecast or run-out prediction. Map drag ends the tour but lets the current run finish.
- Karakoram: "Batura avalanche" (rail + toolbar; autoplays once per browser session) plays the NGT model's own path, times and speeds
  (`static/history/batura_1974/3d/avalanche_path_with_time.csv`, release props from `avalanche_features.geojson`) at 5x. It starts from the model's
  release point (4,607 m), not from a summit. Labelled "model · not observed".
- Playback clock advances at most 0.1 s per frame (slow machines get slow motion, not skipped phases). Test hook: `Avalanche.slowmo(6)`.
- Engine styles live in `static/css/avalanche.css` (portal.html and home.html). Options used by the historic tour: `head` / `tag` (labels), `hudHost`,
  `hudClass`, `keys: false` (no Esc), `ctl.pause(bool)`. Voellmy drag uses the speed ALONG the slope (v_map / cos); the old map-plane speed gave
  100+ m/s on steep faces. `camera()` fits the vertical drop x exaggeration as well as the run (a 2,000 m face put the release above the frame).

## Historic avalanche tour (Historical Overview)

- Data: `data/history/events/avalanche_events_pakistan_compiled.csv` (39 records supplied by NGT, unchanged) -> `python scripts/build_history_events.py`
  (system Python, numpy + Pillow; `--refresh-osm` re-asks OpenStreetMap) -> `pk_events.geojson` + `osm_geocode.json` (Nominatim answers, with OSM ids).
  API `/api/history/events`; catalog id `history_events_pk`. Every CSV field is served unchanged (test checks this).
- Location quality `loc.tier`: A coordinates in the record, B place found in OSM, C nearest named place (named in `loc.note`), D valley / district only
  (dashed 14 km area, never animated), E not located. The per-record rules (`GEO` in the script) were checked by hand against the OSM answers.
  PK007 Gayari: the record's coordinates are at 5,822 m on the DEM (record says ~4,000 m base), so OSM "Gyari" (3,775 m) is used and the note says why.
- Paths (`anim`, 21 records): ILLUSTRATIVE. Release cells = 28-55 deg slopes on the local z12 DEM (the peaks / ridges / glacier walls above the place);
  vectorised sliding block (same physics as the engine). `impact`: the run that reaches the documented place at the place's own height (+-150 m) with
  the largest drop; `band`: release at the record's elevation (K2 Bottleneck, Broad Peak C2-C3, Shispare ~5,700 m, Shounter Pass above 4,420 m).
  Not animated: earthquake candidate, "unclear", rain-triggered landslides, glacier movement, summer "doubtful" events, D/E locations.
  Releases start at the peak (user request with sketches: break at the ridge top / summit, fall down the big face below it). `impact`:
  `peak_run` takes peaks within 4 km of the place (higher than everything within ~90 m, >= 300 m above the place), lets sliding blocks run
  from 60 m below each top down the terrain by themselves, and keeps the highest peak whose run comes within 2.5 km of the place (then its
  biggest drop). The run does NOT have to end at the documented place any more: `place_dist_m` (0-2.5 km) says how close it comes. `band`
  events (user: these too from the peak) use `peak_run(..., band=z, through=...)`: the highest peak above whose run comes down through the
  record's elevation (Shispare 7,587 m through ~5,700 m, K2 8,554 m through the Bottleneck, Broad Peak 7,974 m). Track behind the flow =
  thin, partly transparent snow; deposit = thick raised pile with more, larger blocks. Earlier steps (crest preference `headroom`, `climb`)
  still pick the fallback. `slope_deg` = steepest ~100 m of the first 500 m. The script needs numpy + Pillow (not in the project .venv).
- Batura 1974 in the tour starts at the peak above the model's release (user request): `batura_extension()` in the build script writes
  `static/history/batura_1974/summit_extension.json` (climb to the top, start where the fall line first reaches 25 deg, sliding block
  down to the model's release at 4,607 m). histtour.js prepends it; the model's own points / times / speeds follow unchanged (time-shifted)
  and the HUD and record panel say which part is which. The model files themselves are untouched.
- Snow and ice on the event's upper mountain: `static/js/snowcap.js` (`SnowCap.local(map, anim)`, z12 DEM around the path). User rules:
  ice only on the peaks / upper slopes, never in valleys, rivers or towns; crisp contrast with the forest; no visible boundary; colour like
  the imagery's own snow. So: ragged snowline ~450 m below the release (lower on north faces), nothing within 300-650 m above the run-out,
  solid where it lies (no forest showing through), bare rock above ~45 deg, neutral white with sun shading and slight texture, faded out over
  the outer 18 % of the image. (An earlier version, wintersnow.js, was bluish, translucent and hard-edged; the user rejected it.)
- The tour engine runs with `look: "real"` (avalanche.js): the dense flow is one continuous body (`body()`: wide tongue with a heavy lobed
  surging head, turbulent flanks, shaded edges, moving surface streaks, dark rim and ground shadow, freezes into the deposit tongue) plus angular
  deposit blocks (`debris()`); release half-width 150-180 m (massive slabs, histtour.js). Colours are the neutral, slightly warm white / grey of
  real snow in the imagery, not blue. The powder cloud is short-lived, at the head only (no fog trail), on a blurred half-size layer. No target
  lock, neon speed trail, glow, flash, shock or impact rings, glints. Other 3D maps keep the default particle look.
  The canvas has no depth test, so (user: it was drawn over the mountain in front) `clearView` picks bearing / pitch by DEM line of sight
  before the flight, and `vis()` / `eraseHidden()` cut out every stretch the map's own terrain shows to be behind a nearer ridge
  (map.unproject at the path point lands far from it), for the body, trail, cloud and blocks. The run-over track stays white (snow debris,
  static grain), not bare ground.
- "Intro +" (map bar, beside Intro): `static/js/showreel.js` (`Showreel.start/stop`) plays the portal as a looping film: full intro
  (`bgMap.intro`, waits on `bgMap.introOn`) -> front page 3 s -> HistTour guided tour at 2x until event 6 begins (events 1-5) -> /portal
  #hindukush and #karakoram in preloaded full-screen iframes, 5 s each -> Climate Data pages 0-2, 3 s each -> front page 5 s -> loop.
  Dip-to-black cuts, chapter lower-thirds, chapter progress line, auto-hidden cursor. Home button / Esc (captured first) stops it.
- Front-page map, official view (user request): `scripts/build_official_view.py` (shapely) writes `static/geo/official_view.geojson`:
  the study-area mask minus Indian Illegally Occupied Jammu & Kashmir + Siachen, and the IIOJK polygon. home.html swaps in that mask,
  draws the J&K outer edge solid like the rest of the boundary, drops the amber tint on J&K and labels it "Indian Illegally Occupied
  Jammu & Kashmir · disputed territory"; LoC stays dashed. Picture only: the study area (analysis, glacier counts) is unchanged.
- Climate Data tab: three pages behind icon buttons (`PAGES`: Animations, Original figures, Explore the numbers), no long scroll;
  Explore has six views (`SUBS`), each sized to fit the full-page window (CSS `.win.full ...` heights, tile map height from innerHeight).
- Speed / quality (user: no loading time, sharper): sw.js v3 keeps up to 30,000 provider tiles (within their max-age), 40,000 open
  terrain tiles and the portal's own media (/static/img, /static/history) for 7 days; all maps draw at up to 2x pixel density
  (mapcache.js, 3,000 tiles in memory); the tour prefetches every event's terrain when idle (`warmAll`).
- Record vs animation elevations (user: contradicting values look bad): where the record gives `elevation_m` and the path passes it
  (PK014, PK003, PK013, PK011, PK007), `recordZ` puts the record value first: HUD subtitle "struck at about X m (record) · illustrative
  start Y m", a red "RECORD · struck about X m" call-out on the path where it passes X, start label "START · ILLUSTRATIVE", and a
  "Struck (record)" figure in the record card.
- Per-event route to the place (`sim.to_place`, PK016 Lowari Top, user sketch: the debris must lie at the documented place):
  `route_down` (downhill Dijkstra, 45 m grid) from the summit start to the place, `run_along(..., vmin=6)` keeps the mass moving over
  the benches near the pass; `anim.route_to_place` is stored and the HUD note says so.
- Tour terrain quality: on Mapbox the tour uses Mapbox's terrain DEM (mapbox-terrain-dem-v1, to z14, live, not cached by the SW) for
  terrain and a separate copy for a faint hillshade (`ht-relief`); pixelRatio up to 2, maxTileCacheSize 3000. No `antialias`: it made
  the first draw ~90 s instead of ~10 s in software rendering (measured headless). MapLibre keeps the portal DEM.
- Tour loading: the avalanche waits for the map to be idle (imagery + terrain loaded) after each flight (`intro.idleMs` 6 s, `idleMs`
  4 s, upper bounds); the next event's terrain is prefetched while one plays; a ground-coloured `ht-ground` background layer, a sky-blue fog
  space colour and a sky/ground CSS gradient replace black wherever tiles are still loading. app.py sends `Cache-Control: no-cache` for
  /static/js and /static/css so browsers never keep running an old script after an update (they did: a removed snow layer kept showing).
- Do not reuse `.cine` (home.html's intro overlay, `pointer-events: none`) in the tour: the tour's playing state is `ht-cine`. Reusing it once made the
  whole tour ignore the mouse during playback (pause / speed did nothing; only the keyboard worked). Test guards it.
- UI: `static/js/histtour.js` (`HistTour.open({tour|focus})`, styles `static/css/histtour.css`), started only by the user from the module's banner or a
  record card (never autoplayed). Full-screen 3D satellite map (`bgMap.lib()` engine, terrain x1.2, documentary grade, fog), records list, record panel,
  events: establishing flight (letterbox + lower-third) -> wind-driven snow (screen-space canvas, atmosphere only; documented weather is quoted from the
  record) -> Avalanche engine -> conclusion card (deaths as reported, confidence) -> the tour flows on to the following event by itself after a short
  "Coming up" bar (no button press; Space / dragging the map / scrubbing pauses it); after the last event it returns to a "Tour complete" card.
  Wording: say "event", never "stop" / "next stop". Controls (SVG icons): prev, play/pause (Space), replay, skip (arrows), playback speed gauge
  (0.5-3x, -/+ keys, scales flights, avalanche and the hand-over; remembered in localStorage), event pins (P: DOM markers with the year that pop in
  chronologically, hover card with place / date / deaths, labels declutter by priority; replace the circle layer while on), Event map, exit (Esc).
  Batura 1974 is an event with the NGT model path ("model reconstruction"). Test helper: `HistTour.map()`.
- The tour plays only records with an `anim` (22: 21 scenarios + Batura), in date order. Records without an animation are NOT in the tour (user's decision)
  but stay in the records list, the event map pins and the "Not on the map" list. Pins and map points are danger red (filled = animated).
- PK027 (Pattan earthquake area, no avalanche documented) is removed from the portal at the user's request: `EXCLUDED` in
  `scripts/build_history_events.py`; it remains in the source CSV only.
- Side panel: hero chips, stat tiles (deaths count up, confidence meter), decade-banded timeline of every record (hover reads, click opens), tabs
  Overview / Scenario / Location / Sources. Records list: decade jump bar, one colour per decade (`DEC`, shared with the home module via `HistTour.DEC`),
  rail + dots (filled = animated), deaths badges graded by the reported number. Event-map panel lists the 7 records that cannot be pinned.
- Home module (`historyHTML`, `.hx-*`): drifting relief hero with stats, records-by-decade bars (click filters), featured Batura card, searchable records grid.
- Engine extras (avalanche.js, all pages): `o.speed` / `ctl.speed(k)`, draggable timeline with Release / Peak / Run-out marks (`o.onScrub`), profile
  hover marks that point on the mountain, speed-coloured trail, glowing head + bow wave, airborne spray, cloud glints, release flash, run-out impact ring.
  All are visual effects around the same path; none changes the modelled quantities.

## One palette (home page)

- `SLOT_COL` (fluorescent set, defined above `M` in home.html; originally the season tabs' colours) is the only palette: module tabs take `TAB_COL[id]`, the three glacier
  systems take `SYS_COL` (Hindu Kush #00FFFF, Karakoram #FF0000, West Himalaya #39FF00), and the mountain-system tabs use exactly those.
  `GLACIER_COLORS` and `INTRO_COLORS` both point at `SYS_COL`; `GLACIER_LIGHT` holds the bright outline tints.
