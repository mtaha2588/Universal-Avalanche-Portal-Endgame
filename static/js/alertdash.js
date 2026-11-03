/* Avalanche Alert Forecast dashboard (home page tile "Avalanche Alert Forecast"): AlertDash.open().
   Full-screen dark-glass view of the live forecast engine (forecast/, /api/alertforecast/*): a 3D terrain map of the 0.25 deg
   tiles (clipped to the study area, static/alertdash/tiles_clip.json) for any of the 15 forecast days, one card per region, and a
   deep-dive panel for the exact place clicked: /api/alertforecast/point runs the ECMWF forecast for those coordinates at that
   place's own elevation through the same rule (portal/services/point_forecast.py), shown next to its 25 km tile.
   Built once and kept alive (shown / hidden), and warmed in the background, so it opens instantly.
   Honesty rules: every number comes from a forecast run; anything a run does not contain (e.g. ensemble probabilities when the
   ensemble was off or failed) is shown as "n/a", never estimated. */
"use strict";

const AlertDash = (() => {
  const API = "/api/alertforecast/";
  const LC = { 2: "#d7322b", 1: "#f2a93b", 0: "#22d3ee", "-1": "#94a3b8", "-2": "#a5b4fc" };
  const LS = { 2: "HIGH", 1: "MOD", 0: "LOW", "-1": "N/R", "-2": "N/C" };
  const LN = { 2: "High", 1: "Moderate", 0: "Low", "-1": "Not rated", "-2": "Not calibrated" };   // -2: glacier / perennial-snow tile
  const SOFT = "#5b9bf0";
  const HEAVY_MM = 25, MOD_MM = 10;          // forecast_core DEFAULTS: minimum 3-day snowfall for a High / Moderate storm alert
  const MIN_ELEV = 1200;                     // forecast_core DEFAULTS min_elev_m: below this a place is not rated
  const NEAR_DEG = 0.3;                      // = point_forecast.NEAR_DEG: farther from every tile centre is outside the forecast area
  const REGIONS = [
    { key: "Hindu Kush", name: "Hindu Kush", sub: "Chitral-Dir-Swat", col: "#00FFFF" },
    { key: "Karakoram", name: "Karakoram", sub: "Gilgit-Baltistan", col: "#FFFF00" },
    { key: "West Himalaya", name: "West Himalaya & Kashmir", sub: "Neelum-Leepa-Astore · Hazara", col: "#39FF00" }];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = v => v == null || v === "" || isNaN(v) ? null : +v;
  const f0 = v => num(v) == null ? "—" : Math.round(v).toLocaleString("en-GB");
  const f1 = v => num(v) == null ? "—" : (+v).toFixed(1);
  const mm = v => num(v) == null ? "—" : v >= 10 ? String(Math.round(v)) : (+v).toFixed(1);
  const pct = v => num(v) == null ? "n/a" : `${Math.round(v * 100)}%`;
  const dt = s => new Date(s + "T00:00:00Z");
  const wd = s => WD[dt(s).getUTCDay()], dd = s => s.slice(8, 10), mo = s => MO[+s.slice(5, 7) - 1];
  const fdate = s => `${mo(s)} ${dd(s)}`, ldate = s => `${wd(s)} ${+dd(s)} ${mo(s)} ${s.slice(0, 4)}`;
  const ll = (lat, lon) => `${lat.toFixed(4)}°N ${lon.toFixed(4)}°E`;
  const today = () => new Date().toISOString().slice(0, 10);
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lvl = p => p && p.level != null ? +p.level : -1;
  const regCol = r => r.col;     // the dashboard's own region colours (independent of the home map's SYS_COL)
  const barCol = (v, l) => (l === 2 || v >= HEAVY_MM) ? LC[2] : (l === 1 || v >= MOD_MM) ? LC[1] : SOFT;
  const SVG = b => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
  const IC = { back: SVG('<path d="M15 18l-6-6 6-6"/>'), play: SVG('<path d="M7 5v14l12-7z" fill="currentColor" stroke="none"/>'),
    pause: SVG('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
    chart: SVG('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>') };

  let el = null, map = null, gl = null, engine = "", L = null, T = new Map(), days = [], FC = {}, AG = {}, GMAX = {}, REG = REGIONS.slice();
  let CLIP = { tiles: {}, regions: {}, uncal: { type: "FeatureCollection", features: [] } }, UNC = new Map();   // uncalibrated grid tiles
  let dayIdx = 0, sel = null, hov = null, playT = 0, panelOn = false, cam0 = null, selRaf = 0, marks = [], bounds = null, firstShow = true, toastT = 0;
  let visible = false, buildFailed = false, buildPromise = null, keyH = null, moveRaf = 0, lastMove = null, moveFn = null;
  let place = null, pin = null, pickTok = 0, pDate = null;      // the clicked place, its pin, and the day shown in the panel

  // ------------------------------------------------------------ data
  async function fetchData(cache) {
    const get = u => fetch(u, { cache }).then(r => { if (!r.ok) throw new Error(`${u} answered ${r.status}`); return r.json(); });
    const [l, g, c] = await Promise.all([get(API + "latest"), get(API + "tiles.geojson").catch(() => null),
      get("/static/alertdash/tiles_clip.json").catch(() => null)]);
    if (!l.available) throw new Error(l.message || "No forecast has been produced yet. Run forecast/run_forecast.bat.");
    if (!g || !g.features || !g.features.length) throw new Error("The latest forecast run has no tile layer (alerts_tiles_daily.geojson).");
    if (c && c.tiles) {
      CLIP = { tiles: c.tiles || {}, regions: c.regions || {}, uncal: c.uncalibrated || { type: "FeatureCollection", features: [] } };
      UNC = new Map(CLIP.uncal.features.map(f => { const m = f.properties.tile_id.match(/N([\d.]+)_E([\d.]+)/), la = +m[1], lo = +m[2];
        return [f.properties.tile_id, Object.assign({ geom: f.geometry, w: lo - 0.125, e: lo + 0.125, s: la - 0.125, n: la + 0.125, c: [lo, la] }, f.properties)]; }));
    }
    return { l, g };
  }

  function index(l, g) {
    const prevDate = days[dayIdx];
    L = l; days = (l.days || []).slice(); T = new Map(); FC = {};
    for (const f of g.features) {
      const p = f.properties; let t = T.get(p.tile_id);
      if (!t) {
        const ring = f.geometry.coordinates[0], xs = ring.map(c => c[0]), ys = ring.map(c => c[1]);
        t = { id: p.tile_id, region: p.region, elev: num(p.elev_m), ring, w: Math.min(...xs), e: Math.max(...xs), s: Math.min(...ys), n: Math.max(...ys), by: {} };
        t.c = [(t.w + t.e) / 2, (t.s + t.n) / 2];
        t.geom = CLIP.tiles[p.tile_id] || { type: "Polygon", coordinates: [ring] };     // drawn only inside the area of interest
        T.set(p.tile_id, t);
      }
      t.by[p.date] = p;
    }
    if (!days.length) days = [...new Set(g.features.map(f => f.properties.date))].sort();
    const known = new Set(REGIONS.map(r => r.key)), extra = [...new Set([...T.values()].map(t => t.region))].filter(k => !known.has(k));
    REG = REGIONS.filter(r => [...T.values()].some(t => t.region === r.key)).concat(extra.map(k => ({ key: k, name: k, sub: "", col: "#e2e8f0" })));
    AG = {}; GMAX = {};
    for (const r of REG) AG[r.key] = days.map(d => {
      let max = -1, rated = 0, nm = 0, sum = 0, peak = 0, gust = 0, peakId = null;
      for (const t of T.values()) {
        if (t.region !== r.key) continue;
        const p = t.by[d], v = lvl(p); if (v < 0) continue;
        rated++; max = Math.max(max, v); if (v >= 1) nm++;
        const s = num(p.sf_3d_mm) || 0; sum += s; if (s > peak) { peak = s; peakId = t.id; }
        gust = Math.max(gust, num(p.gust_max_3d_ms) || 0);
      }
      return { date: d, max, rated, nm, mean: rated ? sum / rated : 0, peak, gust, peakId };
    });
    days.forEach((d, i) => { GMAX[d] = Math.max(-1, ...REG.map(r => AG[r.key][i].max)); });
    const ts = [...T.values()];
    bounds = [[Math.min(...ts.map(t => t.w)), Math.min(...ts.map(t => t.s))], [Math.max(...ts.map(t => t.e)), Math.max(...ts.map(t => t.n))]];
    // open on today's date (the run's first day is its issue date, which may be yesterday)
    const k = days.indexOf(prevDate && days.includes(prevDate) ? prevDate : today());
    dayIdx = k >= 0 ? k : 0;
    if (sel && !T.has(sel)) sel = null;
  }

  function dayFC(d) {
    if (!FC[d]) FC[d] = { type: "FeatureCollection", features: [...T.values()].map(t => ({ type: "Feature",
      geometry: t.geom, properties: Object.assign({ tile_id: t.id, region: t.region, level: -1 }, t.by[d] || {}) })) };
    return FC[d];
  }
  // Each region's outer outline: from the clip file (follows the study-area boundary), else the tile edges of only one tile.
  function regionOutlines() {
    const out = [];
    for (const r of REG) {
      if (CLIP.regions[r.key]) { out.push({ type: "Feature", properties: { region: r.key, col: regCol(r) }, geometry: CLIP.regions[r.key] }); continue; }
      const cnt = new Map(), seg = new Map();
      for (const t of T.values()) {
        if (t.region !== r.key) continue;
        const c = [[t.w, t.s], [t.e, t.s], [t.e, t.n], [t.w, t.n]];
        for (let k = 0; k < 4; k++) {
          const a = c[k], b = c[(k + 1) % 4], key = [a, b].map(p => p.map(v => v.toFixed(4)).join(",")).sort().join("|");
          cnt.set(key, (cnt.get(key) || 0) + 1); seg.set(key, [a, b]);
        }
      }
      out.push({ type: "Feature", properties: { region: r.key, col: regCol(r) }, geometry: { type: "MultiLineString", coordinates: [...cnt].filter(([, n]) => n === 1).map(([k]) => seg.get(k)) } });
    }
    return { type: "FeatureCollection", features: out };
  }
  const tileAt = (lon, lat) => [...T.values()].find(t => lon >= t.w && lon <= t.e && lat >= t.s && lat <= t.n) || null;
  const uncAt = (lon, lat) => [...UNC.values()].find(t => lon >= t.w && lon <= t.e && lat >= t.s && lat <= t.n) || null;
  const anyTile = id => T.get(id) || UNC.get(id) || null;
  const nearestDeg = (lon, lat) => Math.min(...[...T.values()].map(t => Math.hypot((t.c[0] - lon) * Math.cos(lat * Math.PI / 180), t.c[1] - lat)));

  // ------------------------------------------------------------ build once, then show / hide
  function ensureBuilt() {
    if (el && !buildFailed) return Promise.resolve();
    if (buildPromise) return buildPromise;
    if (buildFailed) { try { map && map.remove(); } catch { /* gone */ } map = null; el.remove(); el = null; buildFailed = false; }
    buildPromise = (async () => {
      el = document.createElement("div"); el.className = "ad"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Avalanche Alert Forecast dashboard");
      el.innerHTML = `
        <header class="ad-top ad-glass">
          <button type="button" class="ad-exit" title="Back to the command modules (Esc)">${IC.back}Command modules</button>
          <h2 class="ad-title">AVALANCHE ALERT FORECAST<small data-r="sub">Northern Pakistan · 0.25° tiles · ECMWF IFS</small></h2>
          <div class="ad-pills"><span class="ad-pill live" data-r="live"><i></i><span>LIVE · ECMWF FORECAST</span></span>
            <span class="ad-pill" data-r="upd">Last update: —</span><button type="button" class="ad-info" aria-expanded="false">ⓘ Method</button></div>
        </header>
        <div class="ad-banner" data-r="banner" hidden></div>
        <section class="ad-mapw" aria-label="3D terrain map of the forecast tiles">
          <div class="ad-map" id="ad-map"></div>
          <div class="ad-mtag"><span>Click any place for its own 15-day forecast</span><button type="button" data-a="reset" title="Back to the whole forecast area">⟲ Reset view</button>
            <button type="button" data-a="tilt" aria-pressed="true" title="Toggle 3D tilt">3D</button></div>
          <div class="ad-hud" data-r="hud"><em>TELEMETRY</em><br>Move the cursor over the map</div>
          <div class="ad-legend" data-r="legend"></div>
          <div class="ad-days"><button type="button" class="ad-play" aria-label="Play the forecast days" title="Play the 15 days (Space)">${IC.play}</button>
            <div class="ad-dlabel" data-r="dlabel"></div><div class="ad-dlist" role="group" aria-label="Forecast day"></div></div>
          <div class="ad-toast ad-glass" data-r="toast"></div>
        </section>
        <section class="ad-cards" aria-label="Regional overview"></section>
        <footer class="ad-foot"><p data-r="foot"></p><nav>
          <a href="${API}alerts_tiles_daily.csv" download>⇩ Tiles CSV</a><a href="${API}alerts_region_summary.csv" download>⇩ Regions CSV</a>
          <a href="${API}tiles.geojson" download="alerts_tiles_daily.geojson">⇩ GeoJSON</a><a href="${API}map.png" target="_blank" rel="noopener">Map PNG ↗</a></nav></footer>
        <button type="button" class="ad-fab" title="Open the 15-day inspector">${IC.chart}15-Day Place Inspector &amp; Detailed Graphs</button>
        <aside class="ad-panel" aria-label="15-day deep-dive for the selected place" aria-hidden="true">
          <div class="ad-ptop"><button type="button" class="ad-back">${IC.back}Back to Regional Dashboard</button><span>Esc</span></div>
          <div class="ad-pbody"></div>
        </aside>
        <div class="ad-pop ad-glass" data-r="pop" hidden></div>
        <div class="ad-load"><i></i><b>Preparing the 3D terrain and the latest forecast…</b></div>`;
      document.body.appendChild(el);
      const tt = document.createElement("div"); tt.className = "ad-tt"; tt.setAttribute("role", "tooltip"); el.appendChild(tt);
      wire();
      try {
        const [{ l, g }, mapCtx] = await Promise.all([fetchData("no-cache"), makeMap()]);
        index(l, g); renderStatic(); addLayers(mapCtx); pushMap(); setDay(dayIdx, true); fit(false);
      } catch (e) {
        console.warn("AlertDash:", e);
        el.querySelector(".ad-load").innerHTML = `<b>The alert forecast could not load</b><span>${esc(e.message)}</span>`;
        buildFailed = true;
        throw e;
      }
      el.querySelector(".ad-load").classList.add("off");
    })().finally(() => { buildPromise = null; });
    return buildPromise;
  }

  async function warm() { try { await ensureBuilt(); } catch { /* reported on open */ } }

  async function open() {
    try { await ensureBuilt(); } catch { if (el) show(); return; }
    show();
    refresh();
  }
  // the daily runs (03:00 / 15:00 PKT) also reach a tab that is left open
  setInterval(() => { if (visible && L) refresh(); }, 15 * 60 * 1000);
  function show() {
    visible = true;
    document.body.classList.add("ad-open");
    requestAnimationFrame(() => { el.classList.add("on"); if (map) map.resize(); if (firstShow && map) { fit(false); firstShow = false; } });
    if (sel) pulse(true);
    el.querySelector(".ad-exit").focus({ preventScroll: true });
  }
  function close() {
    if (!el || !visible) return;
    stopPlay(); pulse(false); popup(false); hideTip();
    visible = false;
    el.classList.remove("on");
    document.body.classList.remove("ad-open");
  }
  // A new run (scheduled task) is picked up on the next open, without a page reload.
  async function refresh() {
    try {
      const l = await fetch(API + "latest", { cache: "no-cache" }).then(r => r.json());
      if (!l.available) return;
      if (l.generated_utc !== L.generated_utc) {
        const { g } = await fetchData("no-cache");
        index(l, g); renderStatic(); pushMap(); setDay(dayIdx, true);
        if (panelOn) renderPanel();
      } else { L.status = l.status; L.thresholds = l.thresholds; header(); }
    } catch { /* keep what is on screen */ }
  }

  // ------------------------------------------------------------ static parts (header, cards, day list, legend, footer)
  function renderStatic() { header(); cards(); dayList(); legend(); foot(); }

  function header() {
    const g = L.generated_utc ? new Date(L.generated_utc) : null, live = el.querySelector('[data-r="live"]'), ban = el.querySelector('[data-r="banner"]');
    const pkt = g ? g.toLocaleString("en-US", { timeZone: "Asia/Karachi", month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
    el.querySelector('[data-r="upd"]').innerHTML = `Last update: <b>${esc(pkt)} PKT</b>`;
    const ageH = g ? (Date.now() - g.getTime()) / 36e5 : Infinity, st = L.status || {};
    live.className = "ad-pill " + (st.ok === false ? "fail" : ageH > 18 ? "stale" : "live");
    live.lastElementChild.textContent = st.ok === false ? "LAST RUN FAILED" : ageH > 18 ? "FORECAST OLDER THAN 18 H" : "LIVE · ECMWF FORECAST";
    const msg = st.ok === false ? `The last forecast run failed (${esc(st.message || "see forecast/logs")}). The maps show the last successful run, issued ${esc(pkt)} PKT.`
      : ageH > 18 ? `This forecast was issued ${Math.round(ageH)} hours ago (${esc(pkt)} PKT). The scheduled runs (about 15:00 and 03:00 PKT) have not replaced it; check forecast/output/status.json.` : "";
    ban.hidden = !msg; ban.className = "ad-banner" + (st.ok === false ? " fail" : ""); ban.innerHTML = msg;
    el.querySelector('[data-r="sub"]').textContent = `Northern Pakistan · ${T.size} tiles of 0.25° (~25 km) · issued for ${L.issued_for_date ? ldate(L.issued_for_date) : "—"} · ${days.length}-day lead`;
  }

  function cards() {
    const yMax = Math.max(HEAVY_MM + 5, ...REG.flatMap(r => AG[r.key].map(a => a.peak))) * 1.08;
    el.querySelector(".ad-cards").innerHTML = REG.map(r => {
      const A = AG[r.key], c = regCol(r), act = A.filter(a => a.max >= 1).length, peak = Math.max(0, ...A.map(a => a.peak)), gust = Math.max(0, ...A.map(a => a.gust));
      const n = [...T.values()].filter(t => t.region === r.key).length, nr = n - Math.max(0, ...A.map(a => a.rated));
      const cols = A.map((a, i) => {
        const h = Math.min(100, a.peak / yMax * 100), bc = barCol(a.peak, a.max), heavy = bc === LC[2];
        const tip = `<b>${esc(r.name)} · ${ldate(a.date)}</b><br><span class="k">Highest level:</span> ${a.max < 0 ? "not rated" : LN[a.max]}`
          + `<br><span class="k">Strongest 3-day snowfall:</span> ${mm(a.peak)} mm${a.peakId ? ` (${esc(a.peakId)})` : ""}<br><span class="k">Mean over rated tiles:</span> ${mm(a.mean)} mm`
          + `<br><span class="k">Tiles at Moderate or High:</span> ${a.nm} of ${a.rated}<br><span class="k">Strongest 3-day gust:</span> ${f1(a.gust)} m/s`;
        return `<button type="button" class="ad-col" data-i="${i}" data-tip="${esc(tip)}" aria-label="${esc(`${r.name}, ${ldate(a.date)}: ${a.max < 0 ? "not rated" : LN[a.max]}, strongest 3-day snowfall ${mm(a.peak)} millimetres`)}">
          <small>${wd(a.date)}</small><b>${dd(a.date)}</b><span class="ad-lv ${a.max < 0 ? "ln" : "l" + a.max}">${LS[a.max]}</span>
          <span class="ad-tr" style="--h:${h.toFixed(1)}%"><i class="ad-bar${heavy ? " hv" : ""}" style="--bc:${bc};--dl:${(i * 0.03).toFixed(2)}s"></i>${a.peak >= 0.5 ? `<em class="ad-val">${mm(a.peak)}</em>` : ""}</span></button>`;
      }).join("");
      return `<article class="ad-card" style="--rc:${c}">
        <button type="button" class="ad-ch" data-reg="${esc(r.key)}" title="Zoom the map to ${esc(r.name)}"><b>${esc(r.name.toUpperCase())}</b><span>${esc(r.sub)}${r.sub ? " · " : ""}${n} tiles${nr > 0 ? `, ${nr} not rated` : ""}</span></button>
        <div class="ad-met">
          <div title="Days in the ${days.length}-day window with at least one tile at Moderate or High"><small>Active alerts</small><b class="${act ? "alert" : ""}">${act}<em>of ${days.length} days</em></b></div>
          <div title="Strongest 3-day snowfall in any tile, water equivalent (about 1 cm of new snow per mm)"><small>Peak snow</small><b>${mm(peak)}<em>mm</em></b></div>
          <div title="Strongest 3-day maximum 10 m gust in any tile"><small>Max wind gust</small><b>${f1(gust)}<em>m/s</em></b></div></div>
        <div class="ad-cols" style="--n:${days.length}">${cols}</div>
        <p class="ad-cap" title="Bars: strongest 3-day snowfall in any tile of the region, mm water equivalent">Bars: strongest 3-day snow (mm w.e.) · red ≥ ${HEAVY_MM} mm or High · amber ≥ ${MOD_MM} mm or Moderate</p></article>`;
    }).join("");
  }

  function dayList() {
    const td = today();
    el.querySelector(".ad-dlist").innerHTML = days.map((d, i) => `<button type="button" class="ad-dbtn${d === td ? " today" : ""}" data-i="${i}" style="--pc:${GMAX[d] >= 1 ? LC[GMAX[d]] : "transparent"}"
      title="${esc(ldate(d))}${d === td ? " (today)" : ""}${GMAX[d] >= 1 ? ` · ${LN[GMAX[d]]} somewhere in the area` : ""}"><small>${d === td ? "Today" : i === 0 || dd(d) === "01" ? mo(d) : wd(d)}</small><b>${dd(d)}</b></button>`).join("");
  }
  function legend() {
    el.querySelector('[data-r="legend"]').innerHTML = `<b>Legend</b><span><i style="background:${LC[0]};opacity:.6"></i>Low</span><span><i style="background:${LC[1]}"></i>Moderate</span>
      <span><i style="background:${LC[2]}"></i>High</span><span><i class="ad-sw-nr"></i>Not rated (below ${MIN_ELEV.toLocaleString("en-GB")} m)</span>
      <span><i class="ad-sw-ice"></i>Glacier zone · not calibrated</span>`
      + REG.map(r => `<span><i style="background:none;border:2px solid ${regCol(r)};box-shadow:0 0 6px ${regCol(r)}"></i>${esc(r.name)}</span>`).join("")
      + `<span><i class="ad-sw-pin"></i>Selected place</span>`;
  }
  function foot() {
    el.querySelector('[data-r="foot"]').innerHTML = `Experimental alert based on forecast snowfall, wind and temperature for 25 km areas. It does not assess individual slopes and is not an official avalanche danger rating.
      Follow local authorities and NDMA/PDMA advisories. · Weather forecast: ECMWF IFS open data (CC BY 4.0), delivered by Open-Meteo.com. · Next update about 15:00 / 03:00 PKT.`;
  }

  // ------------------------------------------------------------ map
  async function makeMap() {
    let Lb = typeof bgMap !== "undefined" && bgMap.lib ? bgMap.lib() : null;
    if (!Lb) {
      if (!window.maplibregl) {
        const c = document.createElement("link"); c.rel = "stylesheet"; c.href = "/static/vendor/maplibre-gl.css"; document.head.appendChild(c);
        await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/static/vendor/maplibre-gl.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      }
      Lb = { gl: window.maplibregl, engine: "maplibre" };
    }
    ({ gl, engine } = Lb);
    if (window.MapPerf) MapPerf.tune(gl);
    const grade = { "raster-saturation": -0.3, "raster-brightness-max": 0.82, "raster-contrast": 0.1 };   // natural, slightly muted imagery
    const style = engine === "mapbox" ? "mapbox://styles/mapbox/satellite-v9" : { version: 8,
      sources: { sat: { type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
      layers: [{ id: "ad-ground", type: "background", paint: { "background-color": "#1a1d20" } }, { id: "sat", type: "raster", source: "sat", paint: grade }] };
    const o = { container: "ad-map", style, center: [73.6, 35.1], zoom: 6.3, pitch: 56, bearing: -8, maxPitch: 78, minZoom: 4.6,
      maxBounds: [[66.5, 30.5], [81, 39.5]], attributionControl: false, fadeDuration: 0 };
    map = new gl.Map(Object.assign(window.MapPerf ? MapPerf.opts(o) : o, { pixelRatio: Math.min(window.devicePixelRatio || 1, 2) }));
    map.addControl(new gl.AttributionControl({ compact: true }), "bottom-left");
    map.addControl(new gl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new gl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");
    const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    const [bnd, study] = await Promise.all([get("/api/layer/boundaries"), get("/api/layer/study_area"),
      new Promise((res, rej) => { map.once("load", res); map.on("error", ev => { const s = ev.error && ev.error.status; if (!map.loaded() && (s === 401 || s === 403)) rej(ev.error); }); })]);
    if (engine === "mapbox") try { Object.entries(grade).forEach(([k, v]) => map.setPaintProperty("satellite", k, v)); } catch { /* layer id differs */ }
    return { bnd, study };
  }

  function hatch() {
    const n = 12, c = document.createElement("canvas"); c.width = c.height = n;
    const x = c.getContext("2d"); x.strokeStyle = "rgba(255,255,255,0.5)"; x.lineWidth = 1.3;
    for (const o of [-n, 0, n]) { x.beginPath(); x.moveTo(o, n); x.lineTo(o + n, 0); x.stroke(); }
    return x.getImageData(0, 0, n, n);
  }
  function ice() {                     // sparse dots: "snow / ice, not calibrated"
    const n = 10, c = document.createElement("canvas"); c.width = c.height = n;
    const x = c.getContext("2d"); x.fillStyle = "rgba(224,231,255,0.85)";
    x.beginPath(); x.arc(2.5, 2.5, 1.1, 0, 7); x.arc(7.5, 7.5, 1.1, 0, 7); x.fill();
    return x.getImageData(0, 0, n, n);
  }

  function addLayers({ bnd, study }) {
    const dem = () => window.MapPerf ? MapPerf.dem() : { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12, tiles: [location.origin + "/api/dem/{z}/{x}/{y}.png?v=cop1"] };
    let demSrc = "ad-dem";
    map.addSource("ad-dem", dem());
    if (engine === "mapbox") try { map.addSource("ad-dem-hd", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 }); demSrc = "ad-dem-hd"; } catch { /* portal DEM */ }
    map.setTerrain({ source: demSrc, exaggeration: 1.45 });
    try {
      map.addSource("ad-shade", demSrc === "ad-dem-hd" ? { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 } : dem());
      map.addLayer({ id: "ad-relief", type: "hillshade", source: "ad-shade", paint: { "hillshade-exaggeration": 0.38, "hillshade-illumination-direction": 315,
        "hillshade-shadow-color": "rgba(3,6,12,0.7)", "hillshade-highlight-color": "rgba(255,255,255,0.12)", "hillshade-accent-color": "rgba(3,6,12,0.3)" } });
    } catch { /* engine without hillshade */ }
    try {
      if (engine === "mapbox") map.setFog({ range: [1.5, 12], color: "rgb(18,27,44)", "high-color": "rgb(38,58,96)", "horizon-blend": 0.1, "space-color": "rgb(8,12,22)", "star-intensity": 0 });
      else if (map.setSky) map.setSky({ "sky-color": "#0d1830", "horizon-color": "#22324d", "fog-color": "#0b1220", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.25 });
    } catch { /* no fog */ }

    const isL = v => ["==", ["get", "layer"], v];
    if (study) { map.addSource("ad-study", { type: "geojson", data: study });
      map.addLayer({ id: "ad-mask", type: "fill", source: "ad-study", filter: isL("mask"), paint: { "fill-color": "#02050c", "fill-opacity": 0.55 } }); }
    if (bnd) { map.addSource("ad-bnd", { type: "geojson", data: bnd });
      map.addLayer({ id: "ad-disp", type: "fill", source: "ad-bnd", filter: isL("disputed"), paint: { "fill-color": "#f59e0b", "fill-opacity": 0.05 } }); }

    map.addImage("ad-hatch", hatch());
    map.addImage("ad-ice", ice());
    // glacier / perennial-snow grid tiles: no calibration, so no alert colour; drawn so the map covers the whole range
    map.addSource("ad-glac", { type: "geojson", data: CLIP.uncal });
    map.addLayer({ id: "ad-glac-fill", type: "fill", source: "ad-glac", paint: { "fill-color": "#c7d2fe", "fill-opacity": 0.16 } });
    map.addLayer({ id: "ad-glac-dots", type: "fill", source: "ad-glac", paint: { "fill-pattern": "ad-ice", "fill-opacity": 0.75 } });
    map.addLayer({ id: "ad-glac-line", type: "line", source: "ad-glac", paint: { "line-color": "#c7d2fe", "line-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.18, 9.5, 0.5],
      "line-width": 0.8, "line-dasharray": [2, 2] } });
    map.addSource("ad-tiles", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const L0 = ["get", "level"], Z = (a, b) => ["interpolate", ["linear"], ["zoom"], 6, a, 9.5, b];
    map.addLayer({ id: "ad-dark", type: "fill", source: "ad-tiles", filter: ["<", L0, 0], paint: { "fill-color": "#0b1220", "fill-opacity": 0.38 } });
    map.addLayer({ id: "ad-hatch", type: "fill", source: "ad-tiles", filter: ["<", L0, 0], paint: { "fill-pattern": "ad-hatch", "fill-opacity": 0.42 } });
    map.addLayer({ id: "ad-fill", type: "fill", source: "ad-tiles", filter: [">=", L0, 0], paint: {
      "fill-color": ["match", L0, 2, LC[2], 1, LC[1], LC[0]], "fill-opacity": ["match", L0, 2, 0.6, 1, 0.48, 0.14], "fill-opacity-transition": { duration: 350 } } });
    // tile edges: faint at the overview so the terrain reads through, clearer when zoomed in; alert tiles always outlined
    map.addLayer({ id: "ad-tline", type: "line", source: "ad-tiles", paint: { "line-color": ["match", L0, 2, "#ff8a80", 1, "#ffd27a", 0, "#cffafe", "#e2e8f0"],
      "line-opacity": ["match", L0, 2, 0.95, 1, 0.9, Z(0.12, 0.42)], "line-width": ["match", L0, 2, 1.6, 1, 1.4, Z(0.5, 1)] } });
    map.addSource("ad-reg", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "ad-reg-glow", type: "line", source: "ad-reg", layout: { "line-join": "round" }, paint: { "line-color": ["get", "col"], "line-width": 8, "line-blur": 7, "line-opacity": 0.45 } });
    map.addLayer({ id: "ad-reg-line", type: "line", source: "ad-reg", layout: { "line-join": "round" }, paint: { "line-color": ["get", "col"], "line-width": 1.7, "line-opacity": 0.95 } });
    if (bnd) map.addLayer({ id: "ad-prov", type: "line", source: "ad-bnd", filter: isL("province"), paint: { "line-color": "#ffffff", "line-opacity": 0.3, "line-width": 0.9, "line-dasharray": [3, 2] } });
    if (study) {
      const kind = k => ["all", isL("border"), ["==", ["get", "kind"], k]];
      map.addLayer({ id: "ad-pak-glow", type: "line", source: "ad-study", filter: kind("international"), paint: { "line-color": "#fbbf24", "line-width": 8, "line-blur": 7, "line-opacity": 0.3 } });
      map.addLayer({ id: "ad-pak", type: "line", source: "ad-study", filter: kind("international"), paint: { "line-color": "#fde68a", "line-width": 1.6, "line-opacity": 0.9 } });
      map.addLayer({ id: "ad-claim", type: "line", source: "ad-study", filter: kind("claim"), paint: { "line-color": "#e2e8f0", "line-width": 1.4, "line-opacity": 0.75, "line-dasharray": [2, 2] } });
    }
    if (bnd) map.addLayer({ id: "ad-loc", type: "line", source: "ad-bnd", filter: ["all", isL("line"), ["==", ["get", "name"], "Line of Control"]], paint: { "line-color": "#f87171", "line-width": 2, "line-dasharray": [3, 2] } });
    map.addLayer({ id: "ad-hov", type: "line", source: "ad-tiles", filter: ["==", ["get", "tile_id"], ""], paint: { "line-color": "#ffffff", "line-width": 2, "line-opacity": 0.85 } });
    map.addLayer({ id: "ad-glac-hov", type: "line", source: "ad-glac", filter: ["==", ["get", "tile_id"], ""], paint: { "line-color": "#e0e7ff", "line-width": 2, "line-opacity": 0.85 } });
    map.addSource("ad-sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "ad-sel-glow", type: "line", source: "ad-sel", paint: { "line-color": "#ffffff", "line-width": 8, "line-blur": 6, "line-opacity": 0.4 } });
    map.addLayer({ id: "ad-sel", type: "line", source: "ad-sel", paint: { "line-color": "#ffffff", "line-width": 1.8, "line-dasharray": [2, 1.5] } });

    const PICK = ["ad-fill", "ad-dark", "ad-glac-fill"];
    map.on("mousemove", ev => { lastMove = ev; if (!moveRaf) moveRaf = requestAnimationFrame(onMove); });
    map.getCanvas().addEventListener("mouseleave", () => { setHover(null); hideTip(); });
    map.on("click", ev => {
      const f = map.queryRenderedFeatures(ev.point, { layers: PICK })[0];
      const id = f ? f.properties.tile_id : null, { lng, lat } = ev.lngLat;
      if (!id && nearestDeg(lng, lat) > NEAR_DEG) { toast("Outside the forecast area: click inside the tiles of Pakistan's northern mountains."); return; }
      stopPlay(); pickPlace(lat, lng, id || (tileAt(lng, lat) || uncAt(lng, lat) || {}).id || null);
    });
    map.on("move", hud);
    map.on("zoom", () => map.getContainer().classList.toggle("zclose", map.getZoom() > 8.3));
    moveFn = onMove;
    function onMove() {
      moveRaf = 0; const ev = lastMove; if (!ev || !visible) return;
      const f = map.queryRenderedFeatures(ev.point, { layers: PICK })[0], id = f ? f.properties.tile_id : null;
      setHover(id); map.getCanvas().style.cursor = id || nearestDeg(ev.lngLat.lng, ev.lngLat.lat) <= NEAR_DEG ? "crosshair" : "";
      hud(ev);
      if (!id) { hideTip(); return; }
      const h = el.querySelector('[data-r="hud"]');
      if (!T.has(id)) {
        const u = UNC.get(id);
        showTip(ev.originalEvent.clientX, ev.originalEvent.clientY, `<b>${ll(ev.lngLat.lat, ev.lngLat.lng)}</b>${h.dataset.elev ? ` · ${h.dataset.elev} m` : ""}`
          + `<br><span class="k">Tile ${esc(id)} · ${esc(u.region)} · mean ${f0(u.elev_m)} m</span><br><b style="color:${LC[-2]}">Glacier zone · not calibrated</b> <span class="k">(${esc(u.why)}: left out of the analysis team's calibration, so no alert level)</span>`
          + `<br><span class="k">Click for this exact place's 15-day weather forecast</span>`);
        return;
      }
      const t = T.get(id), p = t.by[days[dayIdx]] || {}, v = lvl(p);
      showTip(ev.originalEvent.clientX, ev.originalEvent.clientY, `<b>${ll(ev.lngLat.lat, ev.lngLat.lng)}</b>${h.dataset.elev ? ` · ${h.dataset.elev} m` : ""}`
        + `<br><span class="k">Tile ${esc(id)} · ${esc(t.region)} · ${fdate(days[dayIdx])}:</span> <b style="color:${LC[v]}">${LN[v]}</b>${v < 0 ? " (below avalanche terrain)" : ""}`
        + `<br><span class="k">Tile 3-day snowfall</span> ${mm(p.sf_3d_mm)} mm · <span class="k">gust</span> ${f1(p.gust_max_3d_ms)} m/s`
        + `<br><span class="k">Click for this exact place's 15-day forecast</span>`);
    }
  }

  function pushMap() {
    if (!map || !map.getSource("ad-tiles")) return;
    map.getSource("ad-reg").setData(regionOutlines());
    marks.forEach(m => m.remove());
    marks = REG.map(r => {
      const ts = [...T.values()].filter(t => t.region === r.key), c = [ts.reduce((s, t) => s + t.c[0], 0) / ts.length, ts.reduce((s, t) => s + t.c[1], 0) / ts.length];
      const d = document.createElement("div"); d.className = "ad-rl"; d.style.setProperty("--rc", regCol(r));
      d.innerHTML = `${esc(r.name)}${r.sub ? `<small>(${esc(r.sub)})</small>` : ""}`;
      return new gl.Marker({ element: d, anchor: "center" }).setLngLat(c).addTo(map);
    });
    setSelSource();
  }

  function setHover(id) {
    if (id === hov || !map) return; hov = id;
    map.setFilter("ad-hov", ["==", ["get", "tile_id"], id || ""]); map.setFilter("ad-glac-hov", ["==", ["get", "tile_id"], id || ""]);
  }
  function setSelSource() {
    if (!map || !map.getSource("ad-sel")) return;
    const t = sel && anyTile(sel);
    map.getSource("ad-sel").setData({ type: "FeatureCollection", features: t ? [{ type: "Feature", properties: {}, geometry: t.geom }] : [] });
  }
  // pin on the exact place, with a pulse and its coordinates / elevation
  function setPin(lat, lon, sub) {
    if (!pin) {
      const d = document.createElement("div"); d.className = "ad-pin";
      d.innerHTML = '<span class="ad-pin-l"></span><i class="ad-pin-r"></i><i class="ad-pin-d"></i>';
      pin = new gl.Marker({ element: d, anchor: "bottom" });
    }
    pin.getElement().querySelector(".ad-pin-l").innerHTML = `${ll(lat, lon)}<small>${esc(sub)}</small>`;
    pin.setLngLat([lon, lat]).addTo(map);
  }
  // the selected tile's outline breathes gently (only while the dashboard is on screen)
  function pulse(on) {
    cancelAnimationFrame(selRaf); selRaf = 0;
    if (!on || !map || reduce()) return;
    let last = 0;
    const step = now => {
      selRaf = requestAnimationFrame(step);
      if (now - last < 40) return; last = now;
      const k = (Math.sin(now / 420) + 1) / 2;
      try { map.setPaintProperty("ad-sel-glow", "line-opacity", 0.18 + 0.4 * k); map.setPaintProperty("ad-sel-glow", "line-width", 6 + 6 * k); } catch { /* style reloading */ }
    };
    selRaf = requestAnimationFrame(step);
  }

  function hud(ev) {
    const h = el.querySelector('[data-r="hud"]'); if (!h || !map) return;
    if (ev && ev.lngLat) {
      let elev = null;
      try { elev = engine === "mapbox" ? map.queryTerrainElevation(ev.lngLat, { exaggerated: false })
        : map.terrain && map.terrain.getElevationForLngLatZoom(ev.lngLat, map.transform.tileZoom) / (map.terrain.exaggeration || 1); } catch { /* tiles loading */ }
      h.dataset.pos = ll(ev.lngLat.lat, ev.lngLat.lng); h.dataset.elev = elev != null && !isNaN(elev) ? f0(elev) : "";
    }
    const t = hov && anyTile(hov);
    h.innerHTML = `<em>TELEMETRY</em><br>Cursor <b>${h.dataset.pos || "—"}</b><br>Terrain <b>${h.dataset.elev ? h.dataset.elev + " m" : "—"}</b> <span style="color:#64748b">(SRTM)</span>`
      + `<br>Tile <b>${t ? esc(hov) : "—"}</b>${t ? ` · ${f0(t.elev != null ? t.elev : t.elev_m)} m mean${T.has(hov) ? "" : " · glacier"}` : ""}<br>Zoom <b>${map.getZoom().toFixed(1)}</b> · Pitch <b>${Math.round(map.getPitch())}°</b> · Brg <b>${Math.round(map.getBearing())}°</b>`;
  }

  const pad = () => innerWidth > 1000 ? { top: 70, bottom: 80, left: 40, right: panelOn ? 600 : 60 } : { top: 40, bottom: 120, left: 20, right: 20 };
  const cam = () => ({ center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() });
  function fit(anim) {
    if (!map || !bounds) return;
    const c = map.cameraForBounds(bounds, { padding: pad(), bearing: -8 });
    if (c) map[anim ? "flyTo" : "jumpTo"](Object.assign(c, { pitch: el.querySelector('[data-a="tilt"]').getAttribute("aria-pressed") === "true" ? 56 : 0, bearing: -8, padding: { top: 0, bottom: 0, left: 0, right: 0 } }, anim ? { duration: 1500, essential: true } : {}));
  }
  function flyRegion(key) {
    const ts = [...T.values()].filter(t => t.region === key); if (!ts.length) return;
    const b = [[Math.min(...ts.map(t => t.w)), Math.min(...ts.map(t => t.s))], [Math.max(...ts.map(t => t.e)), Math.max(...ts.map(t => t.n))]];
    const c = map.cameraForBounds(b, { padding: pad(), bearing: map.getBearing() });
    if (c) map.flyTo(Object.assign(c, { pitch: 60, bearing: map.getBearing(), padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1500, essential: true }));
  }

  // ------------------------------------------------------------ day selection and playback
  function setDay(i, quiet) {
    if (!days.length) return;
    dayIdx = (i + days.length) % days.length;
    const d = days[dayIdx];
    pDate = d;
    if (map && map.getSource("ad-tiles")) map.getSource("ad-tiles").setData(dayFC(d));
    el.querySelectorAll(".ad-dbtn").forEach(b => b.classList.toggle("on", +b.dataset.i === dayIdx));
    el.querySelectorAll(".ad-col").forEach(b => b.classList.toggle("on", +b.dataset.i === dayIdx));
    const on = el.querySelector(".ad-dbtn.on"); if (on && !quiet) on.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.querySelector('[data-r="dlabel"]').innerHTML = `Map day<b>${wd(d)} ${fdate(d)}${d === today() ? " · today" : ""}</b>`;
    if (panelOn) panelDay();
    if (lastMove && hov && moveFn && !moveRaf) moveRaf = requestAnimationFrame(moveFn);     // keep the hover tooltip on the new day
  }
  function togglePlay() { if (playT) stopPlay(); else startPlay(); }
  function startPlay() {
    stopPlay(); const b = el.querySelector(".ad-play"); b.innerHTML = IC.pause; b.setAttribute("aria-label", "Pause");
    playT = setInterval(() => setDay(dayIdx + 1), reduce() ? 1600 : 950);
  }
  function stopPlay() { if (playT) clearInterval(playT); playT = 0; const b = el && el.querySelector(".ad-play"); if (b) { b.innerHTML = IC.play; b.setAttribute("aria-label", "Play the forecast days"); } }

  // ------------------------------------------------------------ the clicked place: exact-place forecast + its tile
  function defaultTile() {
    const h = (L.highlights || []).find(x => T.has(x.tile_id)); if (h) return h.tile_id;
    let best = null, bv = -1;
    for (const t of T.values()) for (const d of days) { const p = t.by[d], v = lvl(p) * 1000 + (num(p && p.sf_3d_mm) || 0); if (v > bv) { bv = v; best = t.id; } }
    return best;
  }
  async function pickPlace(lat, lon, tileId, fly = true) {
    const my = ++pickTok, prev = place;
    place = { lat, lon, tile: tileId, res: null, loading: true, err: null };
    sel = tileId; setSelSource(); pulse(visible); hideTip();
    setPin(lat, lon, "fetching the forecast for this place…");
    if (!panelOn) cam0 = cam();
    openPanel(); renderPanel();
    if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(Math.min(map.getZoom() + 0.7, 10.2), 8.6), pitch: 62, bearing: map.getBearing(), padding: pad(), duration: reduce() ? 0 : 1500, essential: true });
    let j = null;
    try { j = await fetch(`${API}point?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`).then(r => r.json()); }
    catch { j = { available: false, message: "The forecast for this place could not be downloaded (is the portal server running?)." }; }
    if (my !== pickTok) return;
    if (j.outside) {                      // the server's study-area check: put things back as they were
      toast(j.message); place = prev;
      if (prev) { sel = prev.tile; setSelSource(); setPin(prev.lat, prev.lon, prev.res ? `${f0(prev.res.elevation_m)} m` : ""); renderPanel(); }
      else { sel = null; setSelSource(); pin && pin.remove(); closePanel(); }
      return;
    }
    place.loading = false;
    if (j.available) { place.res = j; if (!place.tile && j.tile && j.level_kind === "calibrated") { place.tile = sel = j.tile.id; setSelSource(); } }
    else place.err = j.message || "The forecast for this place could not be downloaded right now.";
    setPin(lat, lon, j.available ? `${f0(j.elevation_m)} m · ${j.region}` : "tile forecast shown");
    renderPanel();
  }
  function openPanel() {
    panelOn = true; el.classList.add("panel-on");
    el.querySelector(".ad-panel").setAttribute("aria-hidden", "false");
    setTimeout(() => el.querySelector(".ad-back").focus({ preventScroll: true }), 60);
  }
  function closePanel() {
    if (!panelOn) return;
    panelOn = false; el.classList.remove("panel-on"); el.querySelector(".ad-panel").setAttribute("aria-hidden", "true"); hideTip();
    if (cam0 && map) map.flyTo(Object.assign({}, cam0, { padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: reduce() ? 0 : 1300, essential: true }));
    cam0 = null;
    el.querySelector(".ad-fab").focus({ preventScroll: true });
  }

  // What the panel shows: the exact place (when its forecast is in), else the 25 km tile.
  function ctx() {
    if (place && place.res) {
      const r = place.res, lk = r.level_kind || "calibrated", t = lk === "calibrated" && r.tile ? T.get(r.tile.id) : null;
      const S = lk === "none" ? r.days.map(d => Object.assign({}, d, { level: -2 })) : r.days;
      return { kind: "place", lk, t, dts: r.days.map(d => d.date), S, elev: num(r.elevation_m), tileS: t ? days.map(d => t.by[d] || {}) : [],
        region: r.region, grid: r.grid_tile, borrowed: lk === "indicative" ? r.tile : null };
    }
    const t = sel && T.get(sel), tileS = t ? days.map(d => t.by[d] || {}) : [];
    return { kind: "tile", lk: "calibrated", t, dts: days.slice(), S: tileS, elev: t ? t.elev : null, tileS, region: t ? t.region : (UNC.get(sel) || {}).region || "" };
  }
  function summary(c) {
    const S = c.S, dts = c.dts, what = c.kind === "place" ? "this place" : "this tile";
    if (!S.length) return "No forecast days available.";
    if (c.lk === "none") {
      let mi = 0; S.forEach((p, i) => { if ((num(p.sf_3d_mm) || 0) > (num(S[mi].sf_3d_mm) || 0)) mi = i; });
      const mx = num(S[mi].sf_3d_mm) || 0;
      return `No alert level here: this is a glacier / perennial-snow tile (${c.grid ? esc(c.grid.why) : "uncalibrated"}) that the analysis team left out of the calibration, and no calibrated tile is close enough to borrow from. `
        + (mx >= 1 ? `The weather forecast still applies: heaviest snowfall ${mm(mx)} mm water equivalent in the 3 days to ${wd(dts[mi])} ${fdate(dts[mi])}.`
          : `Little or no snowfall is forecast in the next ${dts.length} days.`);
    }
    if (!S.some(p => lvl(p) >= 0)) return `The ${c.kind === "place" ? "place" : "tile's mean"} elevation is about ${f0(c.elev)} m, below the ${MIN_ELEV.toLocaleString("en-GB")} m limit for avalanche terrain, so no alert level is issued for ${what}. Its snowfall and wind are shown for reference.`;
    let mi = 0; S.forEach((p, i) => { if ((num(p.sf_3d_mm) || 0) > (num(S[mi].sf_3d_mm) || 0)) mi = i; });
    const mx = num(S[mi].sf_3d_mm) || 0, fh = S.findIndex(p => lvl(p) === 2), fm = S.findIndex(p => lvl(p) >= 1);
    const a = mx >= 1 ? `Heaviest snowfall at ${what}: ${mm(mx)} mm water equivalent (about ${Math.round(mx)} cm of new snow) in the 3 days to ${wd(dts[mi])} ${fdate(dts[mi])}.`
      : `Little or no snowfall is forecast at ${what} in the next ${dts.length} days (largest 3-day total ${mm(mx)} mm).`;
    const b = fh >= 0 ? ` First High alert: ${wd(dts[fh])} ${fdate(dts[fh])}${fm >= 0 && fm < fh ? `, after a Moderate alert from ${fdate(dts[fm])}` : ""}.`
      : fm >= 0 ? ` First Moderate alert: ${wd(dts[fm])} ${fdate(dts[fm])}; no High alert in the window.` : ` No Moderate or High alert in the ${dts.length}-day window.`;
    return a + b + (c.lk === "indicative" ? " (Levels are indicative: thresholds borrowed from a nearby calibrated tile.)" : "");
  }

  function renderPanel() {
    const box = el.querySelector(".ad-pbody"), c = ctx(), t = c.t;
    if (!t && !place) { box.innerHTML = '<p class="ad-note">Click a place on the map.</p>'; return; }
    const r = REG.find(x => x.key === (c.region || (t && t.region))) || { name: c.region || "", col: "#e2e8f0", key: c.region };
    const W = Math.max(280, box.clientWidth - 32 - 26), st = box.scrollTop, same = box.dataset.for === `${place ? place.lat + "," + place.lon : sel}|${c.kind}`;
    box.dataset.for = `${place ? place.lat + "," + place.lon : sel}|${c.kind}`;
    const gt = c.grid || (sel && UNC.get(sel) ? { id: sel, why: UNC.get(sel).why, elev_m: UNC.get(sel).elev_m } : null);
    const tileChip = t ? `<span>Tile ${esc(t.id)} · mean ${f0(t.elev)} m</span>`
      : gt ? `<span class="nc">Tile ${esc(gt.id)} · ${esc(gt.why)} · mean ${f0(gt.elev_m)} m · not calibrated</span>`
      : c.borrowed ? `<span>Outside the tile grid</span>` : "";
    const lvlChip = c.lk === "indicative" && c.borrowed ? `<span class="ind">Indicative level · thresholds of tile ${esc(c.borrowed.id)} (${f1(c.borrowed.distance_km)} km)</span>`
      : c.lk === "none" ? '<span class="nc">No alert level · weather only</span>' : "";
    const note = !place || !place.res ? "The tile values below are for the whole ~25 km tile, not for this exact place."
      : `Forecast for these coordinates: ECMWF IFS (0.25°) adjusted by Open-Meteo to this place's elevation${c.lk === "calibrated" ? `, through the same alert rule as the tiles with the calibrated thresholds of tile ${esc(place.res.tile.id)}.`
        : c.lk === "indicative" ? `. This place is not in a calibrated tile, so its alert level uses the thresholds of the nearest calibrated tile (${esc(c.borrowed.id)}): indicative only.`
        : `. Its tile was left out of the calibration (${esc(gt ? gt.why : "uncalibrated")}), so the weather is shown without an alert level.`}`;
    let head;
    if (place) {
      head = `<div class="ad-loc" style="--rc:${regCol(r)}"><small>${esc(r.name)} · selected place</small><h3>${ll(place.lat, place.lon)}</h3>
        <div class="ad-chips"><span class="rg" style="--rc:${regCol(r)}">${esc(r.name)}</span>${c.kind === "place" ? `<span>Elevation ${f0(c.elev)} m (this place)</span>` : ""}${tileChip}${lvlChip}
          ${c.kind === "place" && c.lk !== "none" && c.elev != null && c.elev < MIN_ELEV ? '<span class="nr">Not rated · below avalanche terrain</span>' : ""}</div>
        ${place.loading ? '<div class="ad-wait"><i></i>Fetching the ECMWF forecast for this exact place…</div>' : ""}
        ${place.err ? `<p class="ad-warn">${esc(place.err)}${t ? " Showing the 25 km tile instead." : ""}</p>` : ""}
        <p class="ad-note">${note}</p></div>`;
    } else {
      head = `<div class="ad-loc" style="--rc:${regCol(r)}"><small>${esc(r.name)} · 0.25° forecast tile</small><h3>${esc(t.id)}</h3>
        <div class="ad-chips"><span class="rg" style="--rc:${regCol(r)}">${esc(r.name)}</span><span>Mean elevation ${f0(t.elev)} m</span><span>${ll(t.c[1], t.c[0])}</span></div>
        <p class="ad-note">The forecast is for this whole ~25 km tile (ECMWF IFS 0.25° grid). Click a place on the map for its own forecast.</p></div>`;
    }
    if (place && (place.loading || (place.err && !t))) { box.innerHTML = head; return; }
    const S = c.S, dts = c.dts, ens = c.tileS.some(p => num(p.p_moderate_ens) != null || num(p.p_high_ens) != null), P = c.kind === "place";
    box.innerHTML = head + `
      <div class="ad-sum">${esc(summary(c))}</div>
      <section class="ad-sec"><h4>15-day calendar <span>${P ? "this place · " : ""}click a day to show it on the map</span></h4>
        <div class="ad-mx">${S.map((p, i) => { const v = lvl(p);
          return `<button type="button" class="ad-mc" data-d="${dts[i]}" style="--lc:${v < 0 ? "#64748b" : LC[v]}" aria-label="${esc(`${ldate(dts[i])}: ${LN[v]}, 3-day snowfall ${mm(p.sf_3d_mm)} millimetres`)}">
            <small>${wd(dts[i])} ${fdate(dts[i])}</small><b>${mm(p.sf_3d_mm)}<em>mm</em></b><span class="ad-lv ${v === -2 ? "lc" : v < 0 ? "ln" : "l" + v}">${LS[v]}</span>
            ${P && num(p.tmax_c) != null ? `<small class="t">${Math.round(p.tmin_c)}° / ${Math.round(p.tmax_c)}°</small>` : ""}</button>`; }).join("")}</div>
        <div data-r="detail"></div></section>
      <section class="ad-sec"><h4>Snowfall <span>${P ? "this place · " : ""}${P ? "daily, 3-day and 7-day" : "3-day and 7-day"} totals, mm water equivalent</span></h4>${snowChart(S, W, dts, P)}
        <div class="ad-lg"><span><i style="background:${LC[2]}"></i>3-day ≥ ${HEAVY_MM} mm or High</span><span><i style="background:${LC[1]}"></i>≥ ${MOD_MM} mm or Moderate</span>
          <span><i style="background:${SOFT}"></i>below</span><span><i style="background:none;border-top:2px solid #c4b5fd;height:0;border-radius:0"></i>7-day total</span>
          ${P ? '<span><i style="background:#e2e8f0;width:6px;height:6px;border-radius:50%"></i>daily snowfall</span>' : ""}
          <span><i style="background:none;border-top:1px dashed #94a3b8;height:0;border-radius:0"></i>${MOD_MM} / ${HEAVY_MM} mm storm floors</span></div></section>
      <section class="ad-sec"><h4>${P ? "Temperature, wind and warming" : "Wind and warming"} <span>${P ? "this place · " : ""}${P ? "daily min / max °C · " : ""}3-day max gust · 3-day rise in daily max temperature</span></h4>
        ${P ? lineChart([{ vals: S.map(p => num(p.tmax_c)), col: "#fb923c", name: "Tmax" }, { vals: S.map(p => num(p.tmin_c)), col: "#60a5fa", name: "Tmin" }], W, dts, { unit: "°C", label: "Temperature", zero: true }) : ""}
        ${lineChart([{ vals: S.map(p => num(p.gust_max_3d_ms)), col: "#67e8f9", name: "Gust" }], W, dts, { unit: "m/s", label: "3-day gust", min: 0 })}
        ${lineChart([{ vals: S.map(p => num(p.tmax_rise_3d_c)), col: "#fbbf24", name: "Tmax rise" }], W, dts, { unit: "°C", label: "Tmax rise", zero: true })}</section>
      ${t ? `<section class="ad-sec"><h4>Tile indicators <span data-r="gday"></span></h4><div class="ad-gs" data-r="gauges"></div>
        <p class="ad-fine">These three are for the 25 km tile (${esc(t.id)}). ${ens ? `Ensemble probabilities: share of the ${L.ensemble_members || 51} ECMWF ensemble members that reach the level on that day.`
          : "Ensemble probabilities are not part of this run (the 51-member ensemble was off or its download failed), so they are shown as n/a rather than estimated."}
          The ML risk score is an experimental machine-learning score (0–1) trained on past avalanche disasters; it is secondary information, not the alert level.</p></section>`
        : `<section class="ad-sec"><h4>Tile indicators</h4><p class="ad-fine">Ensemble probabilities and the ML risk score exist only for the ${T.size} calibrated tiles; this place is not in one of them.</p></section>`}`;
    box.querySelectorAll(".ad-mc").forEach(b => b.onclick = () => pickDate(b.dataset.d));
    box.querySelectorAll(".ad-svg .hit").forEach(b => b.addEventListener("click", () => pickDate(b.dataset.d)));
    if (same) box.scrollTop = st; else box.scrollTop = 0;
    panelDay();
  }
  function pickDate(d) { stopPlay(); const i = days.indexOf(d); if (i >= 0) setDay(i); else { pDate = d; panelDay(); } }

  function panelDay() {
    const box = el.querySelector(".ad-pbody"); if (!box.querySelector(".ad-mx")) return;
    const c = ctx(), t = c.t, d = c.dts.includes(pDate) ? pDate : c.dts[0], i = c.dts.indexOf(d), p = c.S[i] || {}, v = lvl(p), P = c.kind === "place";
    const ti = days.indexOf(d), tp = t && ti >= 0 ? t.by[d] || {} : {};
    box.querySelectorAll(".ad-mc").forEach(b => b.classList.toggle("on", b.dataset.d === d));
    box.querySelectorAll(".ad-svg .hl").forEach(b => b.classList.toggle("on", b.dataset.d === d));
    const kv = (k, x) => `<div><small>${k}</small><b>${x}</b></div>`;
    box.querySelector('[data-r="detail"]').innerHTML = `<div class="ad-kv">
      <div><small>${esc(ldate(d))}${P ? " · this place" : ""}</small><b style="color:${LC[v]}">${LN[v]}</b></div>
      ${P ? kv("Snowfall that day", `${mm(p.snowfall_mm)} mm`) : ""}${kv("3-day snowfall", `${mm(p.sf_3d_mm)} mm`)}${kv("7-day snowfall", `${mm(p.sf_7d_mm)} mm`)}
      ${P ? kv("Temperature", num(p.tmax_c) == null ? "—" : `${f1(p.tmin_c)} / ${f1(p.tmax_c)} °C`) : ""}${P ? kv("Max gust that day", `${f1(p.gust_ms)} m/s`) : ""}
      ${kv("3-day max gust", `${f1(p.gust_max_3d_ms)} m/s`)}${kv("Tmax rise (3 d)", `${f1(p.tmax_rise_3d_c)} °C`)}${kv("Rain on snow (3 d)", `${mm(p.ros_3d_mm)} mm`)}
      ${kv("Snow depth", num(p.snow_depth_m) == null ? "—" : (+p.snow_depth_m).toFixed(2) + " m")}
      ${P && t ? `<div class="cmp"><small>Tile ${esc(t.id)} (25 km) that day</small><b style="color:${LC[lvl(tp)]}">${ti >= 0 ? LN[lvl(tp)] : "not in this run"}</b>${ti >= 0 ? `<em>3-day ${mm(tp.sf_3d_mm)} mm · gust ${f1(tp.gust_max_3d_ms)} m/s</em>` : ""}</div>` : ""}</div>`;
    const peak = k => { const xs = c.tileS.map(q => num(q[k])).filter(x => x != null); return xs.length ? Math.max(...xs) : null; };
    if (!box.querySelector('[data-r="gauges"]')) return;
    box.querySelector('[data-r="gday"]').textContent = `25 km tile · ${wd(d)} ${fdate(d)}`;
    box.querySelector('[data-r="gauges"]').innerHTML =
      gauge(num(tp.p_moderate_ens), LC[1], "Moderate or High", `ensemble · peak ${pct(peak("p_moderate_ens"))}`, pct)
      + gauge(num(tp.p_high_ens), LC[2], "High", `ensemble · peak ${pct(peak("p_high_ens"))}`, pct)
      + gauge(num(tp.student_risk), "#a5b4fc", "ML risk score", `experimental · peak ${peak("student_risk") == null ? "n/a" : peak("student_risk").toFixed(2)}`, x => x == null ? "n/a" : x.toFixed(2));
  }

  // ------------------------------------------------------------ charts (inline SVG, no library)
  const niceMax = v => { const s = [5, 10, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 300, 500]; return s.find(x => x >= v) || Math.ceil(v / 100) * 100; };
  function frame(W, H, m, yMin, yMax, unit, dts) {
    const iw = W - m.l - m.r, ih = H - m.t - m.b, bw = iw / dts.length;
    const y = v => m.t + ih - (v - yMin) / (yMax - yMin) * ih, x = i => m.l + bw * (i + 0.5);
    const ticks = [yMin, (yMin + yMax) / 2, yMax];
    let s = ticks.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(148,163,184,.12)"/>`
      + `<text x="${m.l - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${Math.round(v * 10) / 10}</text>`).join("");
    s += `<text x="${m.l}" y="${m.t - 5}" text-anchor="start">${unit}</text>`;
    s += dts.map((d, i) => `<text x="${x(i).toFixed(1)}" y="${H - m.b + 12}" text-anchor="middle">${dd(d)}</text>`
      + (i === 0 || dd(d) === "01" ? `<text x="${x(i).toFixed(1)}" y="${H - m.b + 23}" text-anchor="middle">${mo(d)}</text>` : "")).join("");
    const hl = dts.map((d, i) => `<rect class="hl" data-d="${d}" x="${(m.l + bw * i).toFixed(1)}" y="${m.t}" width="${bw.toFixed(1)}" height="${ih}" rx="3"/>`).join("");
    return { iw, ih, bw, x, y, s, hl };
  }
  const hits = (F, m, H, tips, dts) => dts.map((d, i) => `<rect class="hit" data-d="${d}" x="${(m.l + F.bw * i).toFixed(1)}" y="${m.t}" width="${F.bw.toFixed(1)}" height="${H - m.t - m.b + 14}" data-tip="${esc(tips[i])}"/>`).join("");

  function snowChart(S, W, dts, daily) {
    const H = 180, m = { l: 30, r: 6, t: 16, b: 28 };
    const s3 = S.map(p => num(p.sf_3d_mm)), s7 = S.map(p => num(p.sf_7d_mm)), s1 = S.map(p => num(p.snowfall_mm));
    const yMax = niceMax(Math.max(HEAVY_MM + 3, ...s3.filter(v => v != null), ...s7.filter(v => v != null)));
    const F = frame(W, H, m, 0, yMax, "mm", dts);
    const bars = s3.map((v, i) => { if (v == null) return ""; const c = barCol(v, lvl(S[i])), h = F.ih - (F.y(v) - m.t), bx = F.x(i) - F.bw * 0.3;
      return `<rect x="${bx.toFixed(1)}" y="${F.y(v).toFixed(1)}" width="${(F.bw * 0.6).toFixed(1)}" height="${Math.max(1.5, h).toFixed(1)}" rx="2" fill="${c}"${c === LC[2] ? ' style="filter:drop-shadow(0 0 4px rgba(215,50,43,.8))"' : ""}/>`
        + (v >= 0.5 ? `<text class="vl" x="${F.x(i).toFixed(1)}" y="${(F.y(v) - 3).toFixed(1)}" text-anchor="middle">${mm(v)}</text>` : ""); }).join("");
    const pts = s7.map((v, i) => v == null ? null : `${F.x(i).toFixed(1)},${F.y(v).toFixed(1)}`).filter(Boolean);
    const line = pts.length > 1 ? `<polyline points="${pts.join(" ")}" fill="none" stroke="#c4b5fd" stroke-width="1.6" stroke-linejoin="round" opacity=".9"/>`
      + s7.map((v, i) => v == null ? "" : `<circle cx="${F.x(i).toFixed(1)}" cy="${F.y(v).toFixed(1)}" r="2.2" fill="#c4b5fd"/>`).join("") : "";
    const dots = daily ? s1.map((v, i) => v == null || v < 0.1 ? "" : `<circle cx="${F.x(i).toFixed(1)}" cy="${F.y(v).toFixed(1)}" r="3" fill="#e2e8f0" stroke="#0b1220" stroke-width="1"/>`).join("") : "";
    const ref = [MOD_MM, HEAVY_MM].filter(v => v <= yMax).map(v => `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${F.y(v).toFixed(1)}" y2="${F.y(v).toFixed(1)}" stroke="${v === HEAVY_MM ? "rgba(215,50,43,.55)" : "rgba(242,169,59,.5)"}"/>`).join("");
    const tips = S.map((p, i) => `<b>${ldate(dts[i])}</b>${daily ? `<br><span class="k">Snowfall that day</span> ${mm(p.snowfall_mm)} mm` : ""}<br><span class="k">3-day snowfall</span> ${mm(p.sf_3d_mm)} mm<br><span class="k">7-day snowfall</span> ${mm(p.sf_7d_mm)} mm<br><span class="k">Level</span> ${LN[lvl(p)]}`);
    return `<svg class="ad-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Snowfall for the next ${dts.length} days">${F.hl}${F.s}${ref}${bars}${line}${dots}${hits(F, m, H, tips, dts)}</svg>`;
  }
  function lineChart(series, W, dts, o) {
    const H = 92, m = { l: 30, r: 6, t: 14, b: 26 }, xs = series.flatMap(s => s.vals).filter(v => v != null);
    if (!xs.length) return `<p class="ad-fine">${o.label}: not in this run.</p>`;
    let lo = o.min != null ? o.min : Math.min(0, ...xs), hi = Math.max(...xs, o.min != null ? 5 : 0);
    if (o.zero) { lo = Math.floor(Math.min(0, ...xs) - 1); hi = Math.ceil(Math.max(0, ...xs) + 1); if (hi - lo < 4) { lo -= 2; hi += 2; } } else hi = Math.ceil(hi * 1.15);
    const F = frame(W, H, m, lo, hi, `${o.label} (${o.unit})`, dts);
    let g = o.zero && lo < 0 && hi > 0 ? `<line x1="${m.l}" x2="${W - m.r}" y1="${F.y(0).toFixed(1)}" y2="${F.y(0).toFixed(1)}" stroke="rgba(226,232,240,.35)"/>` : "";
    for (const s of series) {
      const pts = s.vals.map((v, i) => v == null ? null : [F.x(i), F.y(v)]).filter(Boolean);
      const path = pts.map((p, k) => `${k ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
      const base = F.y(o.zero ? Math.max(lo, Math.min(hi, 0)) : lo);
      if (series.length === 1 && pts.length > 1) g += `<path d="${path}L${pts[pts.length - 1][0].toFixed(1)},${base.toFixed(1)}L${pts[0][0].toFixed(1)},${base.toFixed(1)}Z" fill="${s.col}" opacity=".12"/>`;
      g += `<path d="${path}" fill="none" stroke="${s.col}" stroke-width="2" stroke-linejoin="round"/>` + s.vals.map((v, i) => v == null ? "" : `<circle cx="${F.x(i).toFixed(1)}" cy="${F.y(v).toFixed(1)}" r="2.4" fill="${s.col}"/>`).join("");
    }
    const tips = dts.map((d, i) => `<b>${ldate(d)}</b>` + series.map(s => `<br><span class="k">${s.name}</span> ${f1(s.vals[i])} ${o.unit}`).join(""));
    const key = series.length > 1 ? series.map((s, k) => `<text x="${W - m.r - 4 - (series.length - 1 - k) * 46}" y="${m.t - 5}" text-anchor="end" style="fill:${s.col}">● ${s.name}</text>`).join("") : "";
    return `<svg class="ad-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.label)} for the next ${dts.length} days" style="margin-top:4px">${F.hl}${F.s}${key}${g}${hits(F, m, H, tips, dts)}</svg>`;
  }
  function gauge(v, col, label, sub, fmt) {
    const len = Math.PI * 46, k = v == null ? 0 : Math.max(0, Math.min(1, v));
    return `<div class="ad-g"><svg viewBox="0 0 120 68" aria-hidden="true"><path d="M14 60 A46 46 0 0 1 106 60" fill="none" stroke="rgba(148,163,184,.18)" stroke-width="9" stroke-linecap="round"${v == null ? ' stroke-dasharray="3 5"' : ""}/>
      ${v == null ? "" : `<path d="M14 60 A46 46 0 0 1 106 60" fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(len * k).toFixed(1)} ${len.toFixed(1)}" style="filter:drop-shadow(0 0 4px ${col})"/>`}</svg>
      <b class="${v == null ? "na" : ""}">${fmt(v)}</b><span>${esc(label)}</span><small>${esc(sub)}</small></div>`;
  }

  // ------------------------------------------------------------ method popover, tooltip, toast
  function popup(on) {
    const p = el.querySelector('[data-r="pop"]'), b = el.querySelector(".ad-info"); if (!p) return;
    if (on) {
      const th = L.thresholds || {}, va = th.validation || {}, row = (n, x) => x ? `<tr><td>${n}</td><td>${x.events_caught} of ${x.events}</td><td>${x.storms_caught} of ${x.storms}</td><td>${(x.false_alarm_rate * 100).toFixed(1)}%</td><td>${x.alarm_days_per_winter}</td></tr>` : "";
      p.innerHTML = `<h4>How the alert is made</h4>
        <p>${th.calibrated ? '<span class="ok">Calibrated thresholds</span> ' : ""}Each tile is checked against its own avalanche-weather thresholds, learned from 57 winters of ERA5 reanalysis and the recorded avalanche disasters.</p>
        <p style="font-size:11.5px">${esc(L.rule || "")}</p>
        ${va.moderate ? `<h4 style="margin-top:12px">Validation on past events</h4><table><tr><th>Level</th><th>Events caught</th><th>Storms caught</th><th>False alarms</th><th>Alarm days / winter</th></tr>${row("Moderate", va.moderate)}${row("High", va.high)}</table>` : ""}
        <ul><li>Forecast: ${esc(L.source || "ECMWF IFS 0.25° via Open-Meteo")}, ${days.length} days, issued for ${L.issued_for_date ? esc(ldate(L.issued_for_date)) : "—"}.</li>
          <li>A clicked place gets its own forecast: ECMWF for those coordinates at the place's own elevation (Open-Meteo downscaling), through the same rule with the thresholds of the tile it is in. Cached for 3 hours.</li>
          <li>Ensemble: ${L.ensemble_members ? `${L.ensemble_members} members` : "not in this run (probabilities shown as n/a)"}.</li>
          <li>${T.size} tiles of 0.25° (~25 km), drawn only inside the study area; places and tiles below ${MIN_ELEV.toLocaleString("en-GB")} m are not rated. Regions: forecast/config/regions.json.</li>
          <li>The ML risk score is experimental and secondary to the alert level.</li></ul>
        <p class="ad-fine">Experimental alert, not an official avalanche danger rating. Follow local authorities and NDMA/PDMA advisories.</p>`;
    }
    p.hidden = !on; b.setAttribute("aria-expanded", on);
  }
  function showTip(x, y, html) {
    const t = el.querySelector(".ad-tt"); t.innerHTML = html; t.classList.add("on");
    const r = t.getBoundingClientRect(), X = Math.min(innerWidth - r.width - 8, x + 14), Y = y + 16 + r.height > innerHeight ? y - r.height - 12 : y + 16;
    t.style.left = `${Math.max(8, X)}px`; t.style.top = `${Math.max(8, Y)}px`;
  }
  function hideTip() { const t = el && el.querySelector(".ad-tt"); if (t) t.classList.remove("on"); }
  function toast(msg) {
    const t = el.querySelector('[data-r="toast"]'); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200);
  }

  // ------------------------------------------------------------ events (bound once)
  function wire() {
    const q = s => el.querySelector(s);
    q(".ad-exit").onclick = close;
    q(".ad-info").onclick = e => { e.stopPropagation(); popup(q('[data-r="pop"]').hidden); };
    q(".ad-play").onclick = togglePlay;
    q(".ad-fab").onclick = () => {
      stopPlay();
      if (place || sel) { if (!panelOn) cam0 = cam(); openPanel(); renderPanel(); return; }
      const d = defaultTile(), t = d && T.get(d); if (t) pickPlace(t.c[1], t.c[0], t.id);
    };
    q(".ad-back").onclick = closePanel;
    q('[data-a="reset"]').onclick = () => fit(true);
    q('[data-a="tilt"]').onclick = e => { const on = e.currentTarget.getAttribute("aria-pressed") !== "true"; e.currentTarget.setAttribute("aria-pressed", on); e.currentTarget.textContent = on ? "3D" : "2D";
      map.easeTo({ pitch: on ? 56 : 0, duration: 900 }); };
    q(".ad-dlist").addEventListener("click", e => { const b = e.target.closest(".ad-dbtn"); if (b) { stopPlay(); setDay(+b.dataset.i); } });
    q(".ad-cards").addEventListener("click", e => {
      const c = e.target.closest(".ad-col"); if (c) { stopPlay(); setDay(+c.dataset.i); return; }
      const h = e.target.closest(".ad-ch"); if (h) flyRegion(h.dataset.reg);
    });
    el.addEventListener("mousemove", e => {
      if (e.target.closest && e.target.closest(".ad-map")) return;
      const s = e.target.closest && e.target.closest("[data-tip]");
      if (s) showTip(e.clientX, e.clientY, s.getAttribute("data-tip")); else hideTip();
    });
    el.addEventListener("pointerdown", e => { if (!e.target.closest('[data-r="pop"]') && !e.target.closest(".ad-info")) popup(false); });
    let rz = 0;
    addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (visible && panelOn) renderPanel(); }, 200); });
    keyH = e => {
      if (!el || !visible) return;
      const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
      if (e.key === "Escape") { if (!q('[data-r="pop"]').hidden) popup(false); else if (panelOn) closePanel(); else close(); e.preventDefault(); }
      else if (e.key === "ArrowRight" && !typing) { stopPlay(); setDay(dayIdx + 1); }
      else if (e.key === "ArrowLeft" && !typing) { stopPlay(); setDay(dayIdx - 1); }
      else if (e.key === " " && !typing && e.target.tagName !== "BUTTON") { e.preventDefault(); togglePlay(); }
      else return;
      e.stopImmediatePropagation();
    };
    addEventListener("keydown", keyH, true);
  }

  return { open, close, warm, isOpen: () => visible, map: () => map,
    state: () => ({ day: days[dayIdx], sel, panel: panelOn, tiles: T.size, days: days.length, place: place && { lat: place.lat, lon: place.lon, loading: place.loading, ok: !!place.res, err: place.err } }),
    pick: (lat, lon) => pickPlace(lat, lon, (tileAt(lon, lat) || {}).id || null), setDay: i => setDay(i) };   // test helpers
})();
window.AlertDash = AlertDash;
