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
  302 to the public copy. `data/dem/` is git/docker-ignored; the Dockerfile downloads it in its own layer. Mapbox's DEM is no longer used, and
  Mapbox tiles must never be bulk-downloaded or stored beyond their headers (their terms) — the user asked for that and was told no.
- Bump `VER` in sw.js to drop old caches. Headless Chrome inside the Bash sandbox cannot open CacheStorage ("Unexpected internal error");
  test the cache with a profile outside the sandbox.

## Home-page cinematic intro

- `bgMap.intro()` in home.html (styles `.cine-*`, overlay `#cine`): Mapbox globe from orbit -> Pakistan (study-area mask dims to 0.8, official border
  glow pulses) -> Hindu Kush / Karakoram / West Himalaya (fly-in, radar ping, system glow pulse, count-up figures, dive to the largest named glacier with
  its outline highlighted) -> overview of all three. About 75 s. Plays once per browser session (`sessionStorage.homeIntro`), always with `/#intro`,
  never with reduced motion or another deep link. "▶ Intro" chip replays it; any click, wheel, Esc or Space skips.
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

## One palette (home page)

- `SLOT_COL` (season tabs' fluorescent set, defined above `M` in home.html) is the only palette: module tabs take `TAB_COL[id]`, the three glacier
  systems take `SYS_COL` (Hindu Kush #00FFFF, Karakoram #FF0000, West Himalaya #39FF00), and the mountain-system tabs use exactly those.
  `GLACIER_COLORS` and `INTRO_COLORS` both point at `SYS_COL`; `GLACIER_LIGHT` holds the bright outline tints. The Season Timeline tab's accent
  bar is the full `SLOT_COL` gradient. Keep `SLOT_COL` in sync with app.js.
