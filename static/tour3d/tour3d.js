/* 3D Cinematic Tour (/tour3d, templates/tour3d.html). A parallel CesiumJS version of the Historical Overview tour (static/js/histtour.js).
   Same events, order, coordinates, dates and text: it reads the same /api/history/events and the same Batura 1974 model files, merged
   exactly as HistTour.load() does. Nothing here is imported from the main map; CesiumJS is loaded on this page only.

   Per stop: drone-style approach flight -> slow orbit -> weather lead-up (only where the record has a daily series: Batura) ->
   release, flow, powder cloud and deposit along the stop's own path -> story card. Honesty rules (as the 2D tour):
   - the paths are the tour's own: ILLUSTRATIVE scenarios computed on the terrain (the records contain no path), except Batura 1974,
     which is the NGT model reconstruction; the label on screen says which.
   - approximate places (tier C/D: nearest named place, valley or district) get a pulsing uncertainty ring, not a pin.
   - low-confidence records get a short card only, no avalanche animation.
   - speeds, distances, drops and times in the read-out are the path's own values; snow, cloud and camera motion are illustration. */
"use strict";

(() => {
  // ------------------------------------------------------------ configuration (one line each)
  const CFG = {
    // Terrain, one value: "world" = Cesium World Terrain; "ion:<assetId>" = your own DEM uploaded to Cesium ion (e.g. the 8 m HMA DEM);
    // or the URL of self-hosted quantized-mesh tiles, e.g. "/static/terrain/hunza/". See static/tour3d/README.md.
    terrain: "world",
    terrainNote: "Cesium World Terrain · about 30 m source data over northern Pakistan (Cesium does not publish it per area) · coarser on cliffs and ridges",
    exaggeration: 1.0,           // vertical exaggeration: 1.0 = true relief (owner: only if enabled), e.g. 1.3 to enable
    imagery: "mapbox",           // "mapbox" (satellite-v9 with the portal's token) or "ion" (Cesium default imagery)
    sse: { stop: 1.4, flight: 2.0, intro: 1.7 },   // terrain detail: lower = sharper (coarser while flying and under the title)
    shadows: true,
    approachS: 7, orbitS: 4.5, cardS: 8, introMinS: 3, introMaxS: 10,   // seconds at 1x
  };
  { const q = new URLSearchParams(location.search); if (q.has("ex")) CFG.exaggeration = +q.get("ex") || 1; if (q.get("shadows") === "0") CFG.shadows = false; if (q.has("sse")) CFG.sse.stop = +q.get("sse") || CFG.sse.stop; }
  // test switches (profiling only): ?off=ov,warm,fx,body,snow
  const OFF = new Set((new URLSearchParams(location.search).get("off") || "").split(",").filter(Boolean));
  const T = window.TOUR3D || {};
  const BATURA = "/static/history/batura_1974/";
  const TIER = { A: "Coordinates in the record", B: "Place found in OpenStreetMap", C: "Nearest named place", D: "Valley / district only", E: "Not located" };
  const RING = { C: 2200, D: 6000, E: 9000 };                   // uncertainty ring radius (m) for approximate places
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const D2R = Math.PI / 180;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n, d = 0) => n == null || n === "" || isNaN(n) ? "—" : (+n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // the same helpers as histtour.js, so dates and order are identical
  const fdate = s => { if (!s) return ""; const p = s.split("-"); return p.length === 1 ? p[0] : p.length === 2 ? `${MON[+p[1] - 1]} ${p[0]}` : `${+p[2]} ${MON[+p[1] - 1]} ${p[0]}`; };
  const dateOf = p => p.date ? fdate(p.date) : p.date_start ? (p.date_end && p.date_end !== p.date_start ? `${fdate(p.date_start)} – ${fdate(p.date_end)}` : fdate(p.date_start)) : "Date unknown";
  const sortKey = p => p.date_start || p.date || "9999";
  const recordZ = (r, a) => { const m = String(r.elevation_m || "").replace(/,/g, "").match(/\d{3,4}/); if (!m || !a || !a.path) return null;
    const z = +m[0], hi = a.path[0][2], lo = Math.min(...a.path.map(p => p[2])); return z <= hi && z >= lo ? z : null; };
  // approximate place: the tour's own tier says so (C/D/E), or the inventory does (no coordinates, or a nearest place / valley only).
  // Only records with coordinates from the source (and the model reconstruction) get a pin.
  const PREC = { approx_place: "nearest named place", approx_valley: "valley only" };
  const invPrec = r => (r.inv && r.inv.lat && r.inv.lon) ? (r.inv.location_precision || "") : "none";
  // (a pin also needs the map point to be the source's point: within 1 km of the inventory's coordinates)
  const approx = r => !r.model && (["C", "D", "E"].includes((r.loc || {}).tier) || invPrec(r) !== "source_coords" || !(invKm(r) < 1));
  const approxWhy = r => ["C", "D", "E"].includes((r.loc || {}).tier) ? TIER[r.loc.tier] : invPrec(r) === "none" ? "the inventory has no coordinates"
    : invPrec(r) === "source_coords" ? `the source's coordinates are ${fmt(invKm(r), 0)} km away` : `inventory: ${PREC[invPrec(r)] || invPrec(r) || "precision not recorded"}`;
  const ringR = r => RING[(r.loc || {}).tier] || (invPrec(r) === "approx_valley" ? 6000 : invPrec(r) === "approx_place" ? 2200 : 3000);
  // distance (km) between the map point and the inventory's own coordinates, when both exist
  const invKm = r => { if (!r.geom || !r.inv || !r.inv.lat || !r.inv.lon) return null; const la = +r.inv.lat, lo = +r.inv.lon;
    return Math.hypot((lo - r.geom[0]) * 111.32 * Math.cos(la * D2R), (la - r.geom[1]) * 110.574); };
  const shortOnly = r => /^(low|very low)$/i.test(String(r.confidence || ""));
  const isModel = r => !!r.model;

  // ------------------------------------------------------------ data: the 2D tour's own sources, merged the same way (HistTour.load)
  async function load() {
    const [ev, csv, feats, ext, wx] = await Promise.all([
      fetch("/api/history/events").then(r => r.json()),
      fetch(BATURA + "3d/avalanche_path_with_time.csv").then(r => r.ok ? r.text() : "").catch(() => ""),
      fetch(BATURA + "3d/avalanche_features.geojson").then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] })),
      fetch(BATURA + "summit_extension.json").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(BATURA + "3d/daily_factors_window.csv").then(r => r.ok ? r.text() : "").catch(() => "")]);
    if (!ev.available) throw new Error(ev.message || "historical events not built");
    const recs = ev.features.map(f => ({ ...f.properties, geom: f.geometry && f.geometry.coordinates }));
    if (csv) {
      const L = csv.trim().split(/\r?\n/), h = L[0].split(","), c = k => h.indexOf(k);
      const path = L.slice(1).map(l => { const v = l.split(",").map(Number); return [v[c("lon")], v[c("lat")], v[c("elevation_m")], v[c("time_s")], v[c("speed_ms")]]; });
      const rel = (feats.features.find(f => /Release point/.test(f.properties.name)) || { properties: {} }).properties;
      const last = path[path.length - 1];
      recs.push({ event_id: "BATURA-1974", model: true, date: "1974-08-09", date_start: "1974-08-09", date_precision: "day (model reconstruction date)",
        location: "Batura Glacier, Hunza (Batura Muztagh)", region: "Gilgit-Baltistan", event_type: "snow avalanche (model reconstruction)",
        deaths: "", injured: "", who_affected: "", confidence: "model", weather_context: "", geom: [74.65, 36.5333],
        context_notes: "Reconstruction from ERA5 / ERA5-Land daily weather (tile N36.625 E74.625) and the Copernicus 120 m DEM by the NGT notebook. Release point, path, times and speeds are model outputs.",
        sources: "NGT notebook run Batura_1974_08_09_avalanche_outputs (static/history/batura_1974/)",
        loc: { tier: "A", note: "Glacier reference point and modelled path as supplied by the notebook.", source: "model" },
        anim: { mode: "model", path, release: { z: path[0][2], slope_deg: rel.slope_deg, aspect_deg: rel.aspect_deg }, length_m: Math.round(last.distance_m || 0),
          drop_m: Math.round(path[0][2] - last[2]), vmax_ms: Math.max(...path.map(p => p[4])), duration_s: last[3] } });
      const ld = L[L.length - 1].split(",").map(Number); recs[recs.length - 1].anim.length_m = Math.round(ld[c("distance_m")]);
      if (ext && ext.path && ext.path.length > 2) {
        const a = recs[recs.length - 1].anim, dt = ext.duration_s, km = (p, q) => Math.hypot((q[0] - p[0]) * 111320 * Math.cos(p[1] * D2R), (q[1] - p[1]) * 110574);
        let extL = 0; for (let k = 1; k < ext.path.length; k++) extL += km(ext.path[k - 1], ext.path[k]); extL += km(ext.path[ext.path.length - 1], path[0]);
        a.model_release_z = path[0][2];
        a.path = ext.path.concat(path.map(p => [p[0], p[1], p[2], p[3] + dt, p[4]]));
        a.release = { ...a.release, z: ext.peak_z };
        a.length_m += Math.round(extL); a.drop_m = Math.round(ext.peak_z - last[2]); a.duration_s = last[3] + dt;
        a.vmax_ms = Math.max(a.vmax_ms, ...ext.path.map(p => p[4]));
        a.extended = { peak_z: ext.peak_z, note: ext.note };
      }
      // the only record with a daily weather series: ERA5 days before the event (the 15 days up to the event are shown)
      if (wx) {
        const W = wx.trim().split(/\r?\n/), h2 = W[0].split(","), k = n => h2.indexOf(n);
        const days = W.slice(1).map(l => l.split(",")).map(v => ({ date: v[k("date")], d: +v[k("days_to_event")], sf: +v[k("snowfall_mmwe")], t: +v[k("t2m_max_c")] })).filter(o => o.d <= 0 && o.d > -15);
        if (days.length) recs[recs.length - 1].wx = { days, source: "ERA5-Land daily, tile N36.625 E74.625 (NGT notebook)" };
      }
    }
    recs.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const inv = await fetch("/api/history/inventory").then(r => r.ok ? r.json() : null).catch(() => null);
    if (inv && inv.rows) { const by = new Map(inv.rows.map(x => [x.event_id, x])); recs.forEach(r => { r.inv = by.get(r.event_id) || null; }); }
    return recs.filter(r => r.anim);
  }

  // ------------------------------------------------------------ page
  const root = $("#t3");
  const IC = s => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s}</svg>`;
  const I = { prev: IC('<path d="M6.5 5.5v13"/><path d="M18 6.2v11.6L9.6 12z" fill="currentColor" stroke="none"/>'), next: IC('<path d="M17.5 5.5v13"/><path d="M6 6.2v11.6l8.4-5.8z" fill="currentColor" stroke="none"/>'),
    play: IC('<path d="M8.5 5.6v12.8L19 12z" fill="currentColor" stroke="none"/>'), pause: IC('<rect x="6.6" y="5.5" width="3.6" height="13" rx="1.1" fill="currentColor" stroke="none"/><rect x="13.8" y="5.5" width="3.6" height="13" rx="1.1" fill="currentColor" stroke="none"/>'),
    list: IC('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'),
    close: IC('<path d="M6 6l12 12M18 6L6 18"/>'), map2d: IC('<path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>') };
  const params = new URLSearchParams(location.search);
  const inFrame = window.parent && window.parent !== window;

  let stops = [], cur = 0, speed = 1, paused = false, tok = 0, viewer = null, scene = null, EX = CFG.exaggeration, phase = "load";
  let zoomT = 1, zoomS = 1;                                               // the viewer's zoom (mouse wheel, + / - keys, buttons): 1 = the film's framing
  let fx = { factor: 1, ema: 16 }, shot = null, onTick = [], prepared = new Map(), stopEnts = [], fly = null;
  // load-time measurements (reported by the test): click -> first sharp frame, and each stop's time to sharp after its flight
  const M = { t0: +params.get("t0") || 0, pageStart: Date.now() - Math.round(performance.now()), firstSharpMs: null, introMs: null, stops: {}, fps: {} };
  let tileQ = 1;
  const sharp = () => !!scene && (scene.globe.tilesLoaded || tileQ === 0);

  function ui() {
    root.insertAdjacentHTML("beforeend", `
      <header class="t3-top"><div class="t3-brand"><b>3D Cinematic Tour</b><span>Historic avalanches of northern Pakistan · records as compiled · drone-style views on real terrain</span></div><span class="sp"></span>
        <button type="button" class="t3-ic t3-2d" data-a="2d" title="Back to the 2D tour at this stop">${I.map2d}View in 2D</button>
        <button type="button" class="t3-ic" data-a="close" title="Close (Esc)" aria-label="Close the 3D tour">${I.close}</button></header>
      <div class="t3-chip"></div>
      <section class="t3-hud" aria-live="polite"><h4 data-h="eb">Avalanche</h4><div class="ph" data-h="ph">—</div>
        <div class="g"><div><small>Front speed</small><b data-h="v">0</b><em>m/s</em></div><div><small>Distance</small><b data-h="s">0</b><em data-h="L">m</em></div>
          <div><small>Vertical drop</small><b data-h="z">0</b><em>m</em></div><div><small>Elapsed</small><b data-h="t">0</b><em data-h="x">s</em></div></div>
        <div class="bar"><i data-h="bar"></i></div><p data-h="note"></p></section>
      <section class="t3-wx" aria-live="polite"><h4>Weather lead-up</h4><div class="d" data-w="d">—</div><svg data-w="svg" viewBox="0 0 300 86" preserveAspectRatio="none"></svg><p data-w="src"></p></section>
      <aside class="t3-card" aria-live="polite"></aside>
      <div class="t3-lt"><small></small><b></b><span></span></div>
      <div class="t3-cred">${esc(CFG.terrain === "world" ? CFG.terrainNote : `Terrain: ${CFG.terrain}`)} · Imagery: ${CFG.imagery === "mapbox" ? "Mapbox satellite" : "Cesium ion"} · relief ×${fmt(CFG.exaggeration, 1)}</div>
      <aside class="t3-list" aria-label="Tour stops"><h4>Tour stops</h4><div data-l></div></aside>
      <div class="t3-open on boot"><small>Northern Pakistan · 1974 – 2026</small><h1>Avalanches on the real mountains</h1><p data-o>Historic avalanche records, flown in date order on the real terrain</p>
        <p class="fine">Records as compiled. Paths are illustrative scenarios on the terrain unless modelled. Snow, cloud and camera are illustration.</p><p class="ld" data-ld>Loading terrain and imagery…</p></div>
      <nav class="t3-ctl" aria-label="Tour controls">
        <button type="button" class="t3-ic" data-a="list" title="Stops (L)" aria-label="Stop list">${I.list}</button>
        <button type="button" class="t3-ic" data-a="prev" title="Previous (←)" aria-label="Previous stop">${I.prev}</button>
        <button type="button" class="t3-ic big" data-a="play" title="Play / pause (Space)" aria-label="Pause">${I.pause}</button>
        <button type="button" class="t3-ic" data-a="next" title="Next (→)" aria-label="Next stop">${I.next}</button>
        <div class="t3-tl"><div class="rail"></div><div class="fill"></div><div data-tl></div></div>
        <span class="t3-pos" data-pos>—</span>
        <div class="t3-spd" role="group" aria-label="Speed">${[0.5, 1, 2].map(s => `<button type="button" data-s="${s}" class="${s === 1 ? "on" : ""}">${s}×</button>`).join("")}</div>
        <div class="t3-zoom" role="group" aria-label="Zoom"><button type="button" class="t3-ic" data-z="in" title="Zoom in (mouse wheel or +)" aria-label="Zoom in">${IC('<path d="M12 6v12M6 12h12"/>')}</button>
        <button type="button" class="t3-ic" data-z="out" title="Zoom out (mouse wheel or -)" aria-label="Zoom out">${IC('<path d="M6 12h12"/>')}</button>
        <button type="button" class="t3-ic zr" data-z="reset" title="Back to the film's framing (0)" aria-label="Reset zoom">${IC('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.6h3.6"/>')}</button><span class="zl" data-zl>Scroll to zoom</span></div>
        <button type="button" class="t3-skip" data-a="skip" title="Skip the intro / this phase (S)">Skip ›</button>
      </nav>`);
    root.classList.toggle("calm", calm);
    root.querySelectorAll("[data-a]").forEach(b => b.onclick = () => act(b.dataset.a));
    root.querySelectorAll(".t3-spd button").forEach(b => b.onclick = () => setSpeed(+b.dataset.s));
    root.querySelectorAll("[data-z]").forEach(b => b.onclick = () => zoom(b.dataset.z === "in" ? 1 / 1.35 : b.dataset.z === "out" ? 1.35 : 0));
    // mouse wheel / trackpad pinch anywhere on the film (the card and the stop list keep their own scrolling)
    root.addEventListener("wheel", e => {
      if (e.target.closest(".t3-card, .t3-list")) return;
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      zoom(Math.exp(clamp(d, -240, 240) * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });
    addEventListener("keydown", e => {
      if (e.key === " ") { e.preventDefault(); act("play"); } else if (e.key === "ArrowRight") act("next"); else if (e.key === "ArrowLeft") act("prev");
      else if (e.key === "Escape") act("close"); else if (e.key === "l" || e.key === "L") act("list"); else if (e.key === "s" || e.key === "S") act("skip");
      else if (e.key === "+" || e.key === "=") zoom(1 / 1.35); else if (e.key === "-" || e.key === "_") zoom(1.35); else if (e.key === "0") zoom(0);
      else if (e.key === "1") setSpeed(0.5); else if (e.key === "2") setSpeed(1); else if (e.key === "3") setSpeed(2);
    });
  }
  const H = k => root.querySelector(`[data-h="${k}"]`);
  // zoom: f < 1 closer, f > 1 farther, 0 = back to the film's framing. From a quarter of the distance to 2.5 times it.
  let zlTimer = 0;
  function zoom(f) {
    zoomT = f === 0 ? 1 : clamp(zoomT * f, 0.25, 2.5);
    const zl = root.querySelector("[data-zl]"), pct = Math.round(100 / zoomT);
    zl.textContent = zoomT === 1 ? "Film framing" : `Zoom ${pct}%`; zl.classList.add("on"); root.querySelector(".t3-zoom").classList.toggle("moved", zoomT !== 1);
    clearTimeout(zlTimer); zlTimer = setTimeout(() => zl.classList.remove("on"), 1400);
  }
  function setSpeed(s) { speed = s; root.querySelectorAll(".t3-spd button").forEach(b => b.classList.toggle("on", +b.dataset.s === s)); }
  function back(mode) {
    const id = stops[cur] ? stops[cur].event_id : null;
    if (inFrame) window.parent.postMessage({ type: "tour3d:close", id, mode }, location.origin);
    else location.href = "/#home";
  }
  let skipNow = false;
  function act(a) {
    if (a === "close") return back("close");
    if (a === "2d") return back("2d");
    if (a === "list") return $(".t3-list").classList.toggle("on");
    if (a === "skip") { skipNow = true; return; }
    if (a === "play") { paused = !paused; const b = root.querySelector('[data-a="play"]'); b.innerHTML = paused ? I.play : I.pause; b.setAttribute("aria-label", paused ? "Play" : "Pause"); if (fly) fly.pause(paused); return; }
    if (a === "next" && stops.length) return go(Math.min(stops.length - 1, cur + 1));
    if (a === "prev" && stops.length) return go(Math.max(0, cur - 1));
  }
  function fail(title, msg) {
    const L = $("#t3-load"); L.classList.remove("off");
    L.innerHTML = `<div class="t3-fail"><h2>${esc(title)}</h2><p>${esc(msg)}</p><p>The 2D tour works as before.</p>
      <button type="button" class="t3-btn go" data-x>${inFrame ? "Back to the 2D tour" : "Open the portal"}</button></div>`;
    L.querySelector("[data-x]").onclick = () => back("close");
    phase = "failed";
  }

  // ------------------------------------------------------------ clock: everything waits on this, so pause / speed / skip apply everywhere
  let lastT = performance.now(), frameDt = 0;
  class Stop extends Error {}
  const frame = () => new Promise(r => requestAnimationFrame(r));
  async function hold(my, sec, each) {
    let t = 0;
    while (t < sec) {
      await frame(); if (my !== tok) throw new Stop();
      if (skipNow) { skipNow = false; break; }
      if (!paused) t += frameDt * speed;
      if (each) each(t / sec, t);
    }
  }

  // ------------------------------------------------------------ viewer
  async function makeViewer() {
    if (window.__cesiumFailed || !window.Cesium) throw Object.assign(new Error("CesiumJS could not be downloaded."), { title: "3D view unavailable" });
    if (!T.ionToken) throw Object.assign(new Error("No Cesium ion token is configured (CESIUM_ION_TOKEN in .env)."), { title: "3D view unavailable" });
    const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
    if (!gl) throw Object.assign(new Error("This browser or device has WebGL switched off."), { title: "3D view unavailable" });
    Cesium.Ion.defaultAccessToken = T.ionToken;
    // (20 per server smoothed the stream a little but made the first visit three times slower: 32 keeps the first view fast)
    Cesium.RequestScheduler.maximumRequests = 96; Cesium.RequestScheduler.maximumRequestsPerServer = 32;
    Cesium.RequestScheduler.requestsByServer = Object.assign(Cesium.RequestScheduler.requestsByServer || {}, { "assets.ion.cesium.com:443": 32, "api.mapbox.com:443": 32 });
    const terrain = CFG.terrain === "world" ? Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true })
      : /^ion:\d+$/.test(CFG.terrain) ? new Cesium.Terrain(Cesium.CesiumTerrainProvider.fromIonAssetId(+CFG.terrain.slice(4), { requestVertexNormals: true }))
      : new Cesium.Terrain(Cesium.CesiumTerrainProvider.fromUrl(CFG.terrain, { requestVertexNormals: true }));
    viewer = new Cesium.Viewer("t3-map", { terrain, baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, shadows: CFG.shadows && !calm,
      terrainShadows: CFG.shadows && !calm ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED, msaaSamples: 1, requestRenderMode: false });
    scene = viewer.scene;
    const terrainOk = new Promise((res, rej) => {
      terrain.readyEvent.addEventListener(res);
      terrain.errorEvent.addEventListener(e => rej(Object.assign(new Error((e && e.message) || "Cesium World Terrain could not load (token, quota or network)."), { title: "3D terrain unavailable" })));
    });
    // imagery: Mapbox satellite with the portal's token; Cesium's default imagery if Mapbox fails
    let layer = null, errs = 0, switched = false;
    const ionImagery = () => { if (switched) return; switched = true; if (layer) viewer.imageryLayers.remove(layer); viewer.imageryLayers.add(Cesium.ImageryLayer.fromWorldImagery()); };
    if (CFG.imagery === "mapbox" && T.mapboxToken) {
      layer = new Cesium.ImageryLayer(new Cesium.MapboxStyleImageryProvider({ styleId: "satellite-v9", accessToken: T.mapboxToken, tilesize: 512, scaleFactor: (window.devicePixelRatio || 1) > 1.2 }));
      viewer.imageryLayers.add(layer);
      layer.imageryProvider.errorEvent && layer.imageryProvider.errorEvent.addEventListener(() => { if (++errs > 12) ionImagery(); });
    } else ionImagery();
    // look: sun light at the event's date, atmosphere, fog, soft shadows, a slight vertical exaggeration
    const g = scene.globe;
    g.enableLighting = true; g.dynamicAtmosphereLighting = true; g.dynamicAtmosphereLightingFromSun = true; g.showGroundAtmosphere = true;
    g.depthTestAgainstTerrain = true; g.maximumScreenSpaceError = CFG.sse.stop; g.tileCacheSize = 2500; g.preloadSiblings = false; g.preloadAncestors = true;
    g.baseColor = Cesium.Color.fromCssColorString("#6b6a5c");
    scene.verticalExaggeration = EX;
    g.tileLoadProgressEvent.addEventListener(n => { tileQ = n; });
    scene.fog.enabled = true; scene.fog.density = 0.9e-4; scene.fog.minimumBrightness = 0.1;
    scene.fog.screenSpaceErrorFactor = 4;            // distant, hazy mountains: coarser tiles (far fewer to load and draw)
    scene.skyAtmosphere.show = true;
    scene.highDynamicRange = false; scene.postProcessStages.fxaa.enabled = true;   // true satellite colours: no tone mapping, no bloom (they blew out the snow)
    if (CFG.shadows && !calm) { const sm = viewer.shadowMap; sm.softShadows = true; sm.size = 4096; sm.darkness = 0.3; sm.maximumDistance = 18000; sm.normalOffset = true; sm.fadingEnabled = true; }
    viewer.clock.shouldAnimate = true;                 // particles advance with the scene clock (the sun moves a few minutes in a whole stop)
    scene.screenSpaceCameraController.enableInputs = false;            // the film drives the camera; the mouse wheel sets the zoom (zoomT)
    // frame clock and adaptive effects (particle counts follow the frame rate)
    scene.preRender.addEventListener(() => {
      const now = performance.now(); frameDt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      viewer.clock.multiplier = paused ? 0 : speed;
      zoomS += (zoomT - zoomS) * (1 - Math.exp(-frameDt * 7));
      if (snowMat && snowMat.uniforms.fade < 1) snowMat.uniforms.fade = Math.min(1, snowMat.uniforms.fade + frameDt / 1.6);
      fx.ema += (frameDt * 1000 - fx.ema) * 0.05;
      fx.factor = calm ? 0 : fx.ema < 21 ? 1 : fx.ema < 30 ? 0.65 : fx.ema < 45 ? 0.4 : 0.25;
      govern(now);
      if (phase !== "load") { const f = M.fps[phase] || (M.fps[phase] = { frames: 0, s: 0, slow: 0 }); f.frames++; f.s += frameDt; if (frameDt > 1 / 45) f.slow++; }
      if (shot) try { shot(frameDt * (paused ? 0 : speed)); } catch (e) { console.warn("shot", e); shot = null; }
      onTick.forEach(f => f(frameDt * (paused ? 0 : speed)));
    });
    await terrainOk;
  }
  // quality governor, aiming at 60 fps: steps down when frames are slow for a second (shadow map 4096 soft -> 2048 -> render scale 0.85
  // -> no shadows), back up after five steady seconds. Shadows are also off during flights (they cost most while tiles stream in).
  const Q = { level: 0, slowSince: 0, fastSince: 0, flying: false, min: 0 };
  function applyQ() {
    if (!viewer) return;
    const sm = viewer.shadowMap, sh = CFG.shadows && !calm;
    // levels: 0 shadows 4096 soft · 1 shadows 2048 hard · 2 no shadows · 3 no shadows, render scale 0.85.
    // Once a device has needed level 2 the shadows stay off (Q.min): switching them back on made frames slower than they gained.
    if (Q.level >= 2) Q.min = Math.max(Q.min, 2);
    if (sh) { sm.enabled = !Q.flying && Q.level < 2; const sz = Q.level >= 1 ? 2048 : 4096; if (sm.size !== sz) sm.size = sz; sm.softShadows = Q.level < 1; }
    viewer.resolutionScale = Q.level >= 3 ? 0.85 : 1;
  }
  function govern(now) {
    if (OFF.has("gov")) return;                                           // (profiling: quality held where ?q= put it)
    if (phase === "intro" || phase === "load") return;                    // the title covers loading; judge only what is seen
    // one level down after a second below 48 fps; one level back up after 4 s at 57 fps or better (never back to shadows, see applyQ)
    if (fx.ema > 21 && Q.level < 3) { Q.fastSince = 0; if (!Q.slowSince) Q.slowSince = now; else if (now - Q.slowSince > 1000) { Q.level++; Q.slowSince = now; applyQ(); } }
    else if (fx.ema < 17.5) { Q.slowSince = 0; if (!Q.fastSince) Q.fastSince = now; else if (now - Q.fastSince > 4000 && Q.level > Q.min) { Q.level--; Q.fastSince = now; applyQ(); } }
    else { Q.slowSince = 0; Q.fastSince = 0; }
  }
  const flying = on => { Q.flying = on; applyQ(); };
  { const q = new URLSearchParams(location.search).get("q"); if (q != null) Q.level = Q.min = clamp(+q || 0, 0, 3); }
  // keep a camera position at least m metres above the ground under it
  function clearOf(p, m) {
    const c = Cesium.Cartographic.fromCartesian(p); if (!c) return p;
    const gh = scene.globe.getHeight(c); if (gh == null || c.height >= gh + m) return p;
    c.height = gh + m; return Cesium.Cartographic.toCartesian(c, ell(), p);
  }
  function sunAt(r) {
    // light from the morning sun on the event's day (or 1 Feb of its year when only the year is known): 05:30 UTC = 10:30 in Pakistan
    const d = (r.date_start || r.date || "2000").slice(0, 10), iso = d.length === 10 ? d : d.length === 7 ? `${d}-15` : `${d}-02-01`;
    try { viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(`${iso}T05:30:00Z`); } catch { /* keep */ }
  }

  // ------------------------------------------------------------ overlays (project files only; J&K disputed, LoC dashed)
  async function overlays() {
    const [bnd, ov, gx] = await Promise.all([fetch("/api/layer/boundaries").then(r => r.json()).catch(() => null), fetch("/static/geo/official_view.geojson").then(r => r.json()).catch(() => null),
      fetch("/api/layer/glacier_extents").then(r => r.json()).catch(() => null)]);
    const E = viewer.entities;
    const rings = g => g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
    const lines = g => g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    const pl = (coords, width, material) => E.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArray(coords.flat()), width, material, clampToGround: true } });
    if (bnd && bnd.features) for (const f of bnd.features) {
      const p = f.properties || {};
      if (p.layer === "pakistan") rings(f.geometry).forEach(r => { pl(r, 4.5, new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: Cesium.Color.fromCssColorString("#fbbf24").withAlpha(0.85) })); });
      else if (p.layer === "province") rings(f.geometry).forEach(r => pl(r, 1.2, Cesium.Color.WHITE.withAlpha(0.28)));
      else if (p.layer === "line" && /Line of Control/i.test(p.name || "")) lines(f.geometry).forEach(l => pl(l, 2.5, new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString("#f87171"), dashLength: 18 })));
    }
    const iiojk = ov && ov.features && ov.features.find(f => f.properties.layer === "iiojk");
    if (iiojk) E.add({ position: Cesium.Cartesian3.fromDegrees(iiojk.properties.label_lon, iiojk.properties.label_lat), label: { text: "INDIAN ILLEGALLY OCCUPIED JAMMU & KASHMIR\ndisputed territory", font: "600 11px Inter, sans-serif",
      fillColor: Cesium.Color.fromCssColorString("#fde68a"), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(80000, 3.0e6), horizontalOrigin: Cesium.HorizontalOrigin.CENTER } });
    if (gx && gx.features) for (const f of gx.features) rings(f.geometry).forEach(r => pl(r, 1.4, Cesium.Color.fromCssColorString("#a5f3fc").withAlpha(0.35)));
  }

  // ------------------------------------------------------------ textures (drawn once)
  function tex(kind) {
    const c = document.createElement("canvas"), n = kind === "flake" ? 32 : 128; c.width = c.height = n; const g = c.getContext("2d");
    if (kind === "fan") {   // deposit: dense in the middle, broken and thinning towards the edge
      const c2 = document.createElement("canvas"); c2.width = c2.height = 256; const q = c2.getContext("2d");
      let s2 = 5; const rn = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
      for (let k = 0; k < 420; k++) { const a = rn() * 6.283, d = Math.pow(rn(), 0.65) * 118, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, rr = 3 + rn() * 9;
        q.fillStyle = `rgba(${236 + rn() * 19 | 0},${240 + rn() * 15 | 0},${245 + rn() * 10 | 0},${(0.85 - d / 150) * (0.5 + rn() * 0.5)})`; q.beginPath(); q.arc(x, y, rr, 0, 7); q.fill(); }
      return c2;
    }
    if (kind === "flake") { const r = g.createRadialGradient(16, 16, 0, 16, 16, 15); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 32, 32); return c; }
    if (kind === "block") {   // an angular snow block of the deposit: lit top, grey edge, a soft shadow under it
      const b = document.createElement("canvas"); b.width = b.height = 48; const q = b.getContext("2d");
      q.fillStyle = "rgba(22,21,19,.35)"; q.beginPath(); q.moveTo(8, 14); q.lineTo(42, 16); q.lineTo(44, 42); q.lineTo(10, 40); q.closePath(); q.fill();
      q.fillStyle = "#efeeea"; q.strokeStyle = "rgba(98,96,92,.75)"; q.lineWidth = 2; q.beginPath(); q.moveTo(5, 9); q.lineTo(39, 12); q.lineTo(41, 37); q.lineTo(8, 35); q.closePath(); q.fill(); q.stroke();
      const lg = q.createLinearGradient(0, 9, 0, 37); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(1, "rgba(120,122,128,.45)"); q.fillStyle = lg; q.fill();
      return b;
    }
    // a cauliflower puff: overlapping soft blobs, lit from above-left, a cooler underside
    let s = kind === "core" ? 7 : 13; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < 16; k++) {
      const x = 30 + rnd() * 68, y = 34 + rnd() * 62, rr = 16 + rnd() * 26, gr = g.createRadialGradient(x - rr * .25, y - rr * .3, 0, x, y, rr);
      gr.addColorStop(0, "rgba(255,255,255,.75)"); gr.addColorStop(.55, "rgba(242,246,252,.42)"); gr.addColorStop(1, "rgba(230,236,245,0)"); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    }
    // (the powder cloud: grey, shaded undersides, as filmed powder avalanches show; the core a little cooler)
    g.globalCompositeOperation = "source-atop"; const sh = g.createLinearGradient(0, 18, 0, 118); sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(1, kind === "cloud" ? "rgba(124,122,117,.82)" : "rgba(140,150,168,.6)"); g.fillStyle = sh; g.fillRect(0, 0, n, n);
    g.globalCompositeOperation = "destination-in"; const m = g.createRadialGradient(64, 66, 20, 64, 66, 64); m.addColorStop(0, "rgba(0,0,0,1)"); m.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = m; g.fillRect(0, 0, n, n);
    return c;
  }
  let TX = null;
  function pin(color) {
    const c = document.createElement("canvas"); c.width = 44; c.height = 60; const g = c.getContext("2d");
    g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 8; g.fillStyle = color; g.beginPath(); g.moveTo(22, 58); g.bezierCurveTo(8, 38, 4, 30, 4, 22); g.arc(22, 22, 18, Math.PI, 0); g.bezierCurveTo(40, 30, 36, 38, 22, 58); g.fill();
    g.shadowBlur = 0; g.fillStyle = "#fff"; g.beginPath(); g.arc(22, 22, 7, 0, 7); g.fill(); return c;
  }

  // ------------------------------------------------------------ geometry of a stop: its own path on the 3D terrain
  const ell = () => Cesium.Ellipsoid.WGS84;
  // ------------------------------------------------------------ the route down the 3D terrain (illustrative scenarios only)
  // The tour's scenario paths were computed by the 2D tour on its own, coarser elevation tiles; on Cesium's terrain they can cut
  // across a slope or a spur instead of running down it. From the same release point, the route here follows the fall line of the
  // 3D terrain itself, as snow and water do: steepest descent with some momentum, so it gathers into the gully and runs out on the
  // valley floor. The scenario's own times, speeds, distance and drop are kept and laid along it by fraction of the run.
  // The NGT model reconstruction (Batura) is never rerouted: its path is the model's output.
  async function reroute(P0) {
    const lon0 = P0[0][0], lat0 = P0[0][1], kx = 111320 * Math.cos(lat0 * D2R), ky = 110574;
    const xy0 = P0.map(p => [(p[0] - lon0) * kx, (p[1] - lat0) * ky]), c0 = [0];
    for (let i = 1; i < xy0.length; i++) c0.push(c0[i - 1] + Math.hypot(xy0[i][0] - xy0[i - 1][0], xy0[i][1] - xy0[i - 1][1]));
    const L0 = c0[c0.length - 1]; if (L0 < 200) return null;
    const m = Math.max(900, 0.35 * L0);
    const minx = Math.min(...xy0.map(p => p[0])) - m, maxx = Math.max(...xy0.map(p => p[0])) + m, miny = Math.min(...xy0.map(p => p[1])) - m, maxy = Math.max(...xy0.map(p => p[1])) + m;
    let gs = clamp(Math.max(maxx - minx, maxy - miny) / 130, 22, 60);
    const nx = Math.ceil((maxx - minx) / gs) + 1, ny = Math.ceil((maxy - miny) / gs) + 1, carto = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) carto.push(Cesium.Cartographic.fromDegrees(lon0 + (minx + i * gs) / kx, lat0 + (miny + j * gs) / ky));
    const got = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, carto);
    let H = Float64Array.from(got, c => c.height);
    if (H.some(h => !isFinite(h))) return null;
    { const S = new Float64Array(H.length);                                // one light smoothing pass (no single-cell noise steering it)
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0, w = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = clamp(i + di, 0, nx - 1), b = clamp(j + dj, 0, ny - 1), k = di || dj ? 1 : 2; s += H[b * nx + a] * k; w += k; }
        S[j * nx + i] = s / w; }
      H = S; }
    const Hb = (x, y) => { const u = clamp((x - minx) / gs, 0, nx - 1.001), v = clamp((y - miny) / gs, 0, ny - 1.001), i = u | 0, j = v | 0, a = u - i, b = v - j;
      return (H[j * nx + i] * (1 - a) + H[j * nx + i + 1] * a) * (1 - b) + (H[(j + 1) * nx + i] * (1 - a) + H[(j + 1) * nx + i + 1] * a) * b; };
    const inside = (x, y) => x > minx + gs && x < maxx - gs && y > miny + gs && y < maxy - gs;
    // the first direction: the scenario's own, over its first ~150 m (a release on a crest goes down the side it went down)
    let k0 = 1; while (k0 < xy0.length - 1 && c0[k0] < 150) k0++;
    let d = [xy0[k0][0], xy0[k0][1]], dl = Math.hypot(d[0], d[1]) || 1; d = [d[0] / dl, d[1] / dl];
    const step = clamp(L0 / 260, 8, 18), pts = [[0, 0]];
    let x = 0, y = 0, s = 0, flat = 0, climb = 0;
    while (s < L0 && inside(x, y)) {
      const gx = (Hb(x + gs, y) - Hb(x - gs, y)) / (2 * gs), gy = (Hb(x, y + gs) - Hb(x, y - gs)) / (2 * gs), gl = Math.hypot(gx, gy);
      const down = gl > 1e-4 ? [-gx / gl, -gy / gl] : d;
      const keep = s < 120 ? 0.75 : 0.55;                                  // momentum: more at the start, then the terrain leads
      let nd = [d[0] * keep + down[0] * (1 - keep), d[1] * keep + down[1] * (1 - keep)], nl = Math.hypot(nd[0], nd[1]) || 1; nd = [nd[0] / nl, nd[1] / nl];
      const z = Hb(x, y);
      if (Hb(x + nd[0] * step, y + nd[1] * step) > z + 0.2) nd = down;       // never run uphill when the slope offers a way down
      const zn = Hb(x + nd[0] * step, y + nd[1] * step);
      climb = zn > z ? climb + step : 0;
      if (climb > 60) break;                                               // in a hollow with no way out: it stops here
      d = nd; x += d[0] * step; y += d[1] * step; s += step; pts.push([x, y]);
      flat = gl < 0.07 ? flat + step : 0;                                  // under ~4 degrees for 250 m on the valley floor: run-out
      if (flat > 250 && s > 0.45 * L0) break;
    }
    if (pts.length < 8) return null;
    // smooth the line (moving average), resample evenly, lay the scenario's times, speeds and elevations along it by fraction
    const sm = pts.map((p, i) => { if (i < 2 || i > pts.length - 3) return p; let sx = 0, sy = 0; for (let k = -2; k <= 2; k++) { sx += pts[i + k][0]; sy += pts[i + k][1]; } return [sx / 5, sy / 5]; });
    const c = [0]; for (let i = 1; i < sm.length; i++) c.push(c[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]));
    const Ln = c[c.length - 1], N = clamp(Math.round(Ln / 20), 40, 220), at = (A, cc, q, k) => { let i = 0; while (i < cc.length - 2 && cc[i + 1] < q) i++; const f = clamp((q - cc[i]) / ((cc[i + 1] - cc[i]) || 1), 0, 1); return A[i][k] + (A[i + 1][k] - A[i][k]) * f; };
    const P = [], zh = [];
    for (let n = 0; n < N; n++) {
      const q = Ln * n / (N - 1), px = at(sm, c, q, 0), py = at(sm, c, q, 1), qo = L0 * n / (N - 1);
      P.push([lon0 + px / kx, lat0 + py / ky, Hb(px, py), at(P0, c0, qo, 3), at(P0, c0, qo, 4)]);
      zh.push(at(P0, c0, qo, 2));
    }
    return { P, zh };
  }
  async function prepare(r) {
    if (prepared.has(r.event_id)) return prepared.get(r.event_id);
    const job = (async () => {
      const a = r.anim;
      let P = a.path, zh = null, routed = false;
      if (!r.model && !OFF.has("route")) { const q = await reroute(a.path).catch(e => { console.warn("route:", e); return null; }); if (q) { P = q.P; zh = q.zh; routed = true; } }
      const cart = P.map(p => Cesium.Cartographic.fromDegrees(p[0], p[1]));
      let hs;
      try { hs = (await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cart)).map((c, i) => isFinite(c.height) ? c.height : P[i][2]); } catch { hs = P.map(p => p[2]); }
      const S = [0]; for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot((P[i][0] - P[i - 1][0]) * 111320 * Math.cos(P[i][1] * D2R), (P[i][1] - P[i - 1][1]) * 110574, P[i][2] - P[i - 1][2]));
      const pos = P.map((p, i) => Cesium.Cartesian3.fromDegrees(p[0], p[1], hs[i] * EX + 3));
      if (routed) {                                                        // read-outs: the scenario's own path length (not the redrawn line's)
        const Q = a.path; let L0 = 0; for (let i = 1; i < Q.length; i++) L0 += Math.hypot((Q[i][0] - Q[i - 1][0]) * 111320 * Math.cos(Q[i][1] * D2R), (Q[i][1] - Q[i - 1][1]) * 110574, Q[i][2] - Q[i - 1][2]);
        const k = L0 / Math.max(1, S[S.length - 1]); for (let i = 0; i < S.length; i++) S[i] *= k;
      }
      const T0 = P.map(p => p[3]), V = P.map(p => p[4]), L = S[S.length - 1];
      const mid = P[Math.floor(P.length * 0.45)], center = Cesium.Cartesian3.fromDegrees(mid[0], mid[1], hs[Math.floor(P.length * 0.45)] * EX);
      // flow direction (release -> run-out) and its side, in the local frame
      const up = ell().geodeticSurfaceNormal(center, new Cesium.Cartesian3()), east = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_Z, up, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const north = Cesium.Cartesian3.cross(up, east, new Cesium.Cartesian3());
      const p0 = P[0], p1 = P[P.length - 1], dE = (p1[0] - p0[0]) * 111320 * Math.cos(p0[1] * D2R), dN = (p1[1] - p0[1]) * 110574;
      const az = Math.atan2(dE, dN);                                        // heading of the flow (radians from north)
      const fwd = Cesium.Cartesian3.normalize(Cesium.Cartesian3.add(Cesium.Cartesian3.multiplyByScalar(east, Math.sin(az), new Cesium.Cartesian3()), Cesium.Cartesian3.multiplyByScalar(north, Math.cos(az), new Cesium.Cartesian3()), new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const side = Cesium.Cartesian3.cross(fwd, up, new Cesium.Cartesian3());
      const hw = r.model ? 180 : a.mode === "band" ? 160 : 180;
      const G = { r, a, P, hs, S, pos, T0, V, L, routed, Zh: zh || P.map(p => p[2]), center, up, east, north, fwd, side, az, hw, ground: hs.map(h => h * EX), vmax: Math.max(...V, 1), T: T0[T0.length - 1] };
      G.body = prepBody(G);                                                 // the snow-body mesh: built while the camera flies there
      G.body.catch(() => {});
      G.snow = prepSnow(G);                                                 // winter snow on the release peak
      G.snow.catch(() => {});
      return G;
    })();
    prepared.set(r.event_id, job);
    return job;
  }
  // position, speed and distance of the front at path time t (seconds)
  function frontAt(G, t) {
    const T0 = G.T0; let i = 0; while (i < T0.length - 2 && T0[i + 1] < t) i++;
    const f = clamp((t - T0[i]) / Math.max(1e-6, T0[i + 1] - T0[i]), 0, 1);
    return { i, f, pos: Cesium.Cartesian3.lerp(G.pos[i], G.pos[i + 1], f, new Cesium.Cartesian3()), v: G.V[i] + (G.V[i + 1] - G.V[i]) * f, s: G.S[i] + (G.S[i + 1] - G.S[i]) * f,
      z: G.Zh[i] + (G.Zh[i + 1] - G.Zh[i]) * f };
  }
  // ------------------------------------------------------------ winter snow on the release peak
  // The satellite imagery (Mapbox, Cesium ion) is a cloud-free composite, mostly a summer view: a slope that avalanched in winter can
  // show grass or rock. Around each stop's release zone only, the snow it would carry is painted on the terrain (illustration): above
  // a snowline just below the release, thinning out on rock steeper than ~55 degrees, ragged and wind-scoured at its edges, shaded
  // with the sun of the event's day the way Cesium shades the terrain itself, so it looks like the snow already in the imagery.
  const vnJS = (() => { const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const v = (x, y) => { const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j, u = f * f * (3 - 2 * f), w = g * g * (3 - 2 * g);
      return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - w) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * w; };
    return (x, y) => { let a = 0.5, s = 0; for (let k = 0; k < 4; k++) { s += a * v(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; }; })();
  function sunTime(r) {
    const d = (r.date_start || r.date || "2000").slice(0, 10), iso = d.length === 10 ? d : d.length === 7 ? `${d}-15` : `${d}-02-01`;
    try { return Cesium.JulianDate.fromIso8601(`${iso}T05:30:00Z`); } catch { return Cesium.JulianDate.now(); }
  }
  function sunDirWC(t) {
    const m = Cesium.Transforms.computeIcrfToFixedMatrix(t) || Cesium.Transforms.computeTemeToPseudoFixedMatrix(t);
    const p = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(t), w = Cesium.Matrix3.multiplyByVector(m, p, new Cesium.Cartesian3());
    return Cesium.Cartesian3.normalize(w, w);
  }
  async function prepSnow(G) {
    const P = G.P, rel = P[0], zr = rel[2], lon0 = rel[0], lat0 = rel[1], kx = 111320 * Math.cos(lat0 * D2R), ky = 110574;
    const R = clamp(0.4 * G.L, 1100, 2400), fx = Math.sin(G.az), fy = Math.cos(G.az);
    const cx = -fx * 0.3 * R, cy = -fy * 0.3 * R;                              // the zone's centre: a little upslope of the release
    const west = lon0 + (cx - R) / kx, east = lon0 + (cx + R) / kx, south = lat0 + (cy - R) / ky, north = lat0 + (cy + R) / ky;
    const N = 110, carto = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) carto.push(Cesium.Cartographic.fromDegrees(west + (east - west) * i / (N - 1), south + (north - south) * j / (N - 1)));
    let hs;
    try { hs = (await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, carto)).map(c => c.height); } catch { return null; }
    if (!hs.some(isFinite)) return null;
    hs = hs.map(h => isFinite(h) ? h : zr);
    await Cesium.GroundPrimitive.initializeTerrainHeights();
    const sp = 2 * R / (N - 1), Hg = (i, j) => hs[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
    // surface normal at every grid point (central differences), interpolated smoothly below (no faceted cells)
    const NX = new Float32Array(N * N), NY = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { NX[j * N + i] = (Hg(i + 1, j) - Hg(i - 1, j)) / (2 * sp); NY[j * N + i] = (Hg(i, j + 1) - Hg(i, j - 1)) / (2 * sp); }
    const bil = (A, u, v) => { const i = clamp(Math.floor(u), 0, N - 2), j = clamp(Math.floor(v), 0, N - 2), a = u - i, b = v - j;
      return (A[j * N + i] * (1 - a) + A[j * N + i + 1] * a) * (1 - b) + (A[(j + 1) * N + i] * (1 - a) + A[(j + 1) * N + i + 1] * a) * b; };
    // the sun of the event's day, in the zone's east-north-up frame
    const M = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(lon0, lat0)), sw = sunDirWC(sunTime(G.r)), col = k => new Cesium.Cartesian3(M[k * 4], M[k * 4 + 1], M[k * 4 + 2]);
    const sun = [Cesium.Cartesian3.dot(col(0), sw), Cesium.Cartesian3.dot(col(1), sw), Cesium.Cartesian3.dot(col(2), sw)];
    // the slow noise fields once per grid point (interpolated per pixel)
    const EN = new Float32Array(N * N), SN = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = -R + i * sp, y = -R + j * sp; EN[j * N + i] = vnJS(x / 260, y / 260); SN[j * N + i] = vnJS(x / 85 + 3.1, y / 85); }
    const S = 448, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const g = cv.getContext("2d"), im = g.createImageData(S, S), D = im.data;
    const rx = -cx, ry = -cy;                                                  // the release, in zone coordinates (m)
    for (let row = 0; row < S; row++) for (let c = 0; c < S; c++) {
      const u = c / (S - 1) * (N - 1), v = (1 - row / (S - 1)) * (N - 1), i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;   // row 0 = north
      const H = (Hg(i, j) * (1 - a) + Hg(i + 1, j) * a) * (1 - b) + (Hg(i, j + 1) * (1 - a) + Hg(i + 1, j + 1) * a) * b;
      const dzx = bil(NX, u, v), dzy = bil(NY, u, v);
      const nl = Math.hypot(dzx, dzy, 1), nx = -dzx / nl, ny = -dzy / nl, nz = 1 / nl, slope = Math.acos(nz) / D2R;
      const x = -R + 2 * R * c / (S - 1), y = R - 2 * R * row / (S - 1);
      const elev = smooth((H - (zr - 330)) / 280);                            // a snowline a little below the release
      const rock = 1 - smooth((slope - 50) / 14);                              // steep rock sheds its snow
      const edge = 1 - smooth((Math.hypot(x, y) / R + 0.32 * (bil(EN, u, v) - 0.5) - 0.55) / 0.4);
      const slab = 1 - smooth((Math.hypot(x - rx, y - ry) - 260) / 280);       // the release slope itself always carries the slab
      const scour = 0.8 + 0.2 * smooth((bil(SN, u, v) - 0.3) / 0.25);
      const cov = clamp(Math.max(slab * 0.97, elev * rock * edge) * scour, 0, 1);
      const I = clamp(0.9 * Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]) + 0.3, 0, 1);
      const shade = I * (0.62 + 0.38 * I) * (0.955 + 0.045 * bil(SN, u, v));   // the terrain's lighting, the photo's own shading, soft unevenness
      const k = (row * S + c) * 4;
      D[k] = Math.round(clamp(shade, 0, 1) * 255); D[k + 1] = Math.round(cov * 255); D[k + 2] = 0; D[k + 3] = 255;   // opaque: no premultiplied fringes
      if (c === S - 1 && row % 56 === 55) await new Promise(res => setTimeout(res, 0));   // a few rows per frame: no stutter while it is built
    }
    g.putImageData(im, 0, 0);
    return { rect: Cesium.Rectangle.fromDegrees(west, south, east, north), canvas: cv };
  }
  let snowPrim = null, snowMat = null, snowFor = null;
  function showSnow(G) {
    if (snowFor === G || OFF.has("snow")) return;
    snowFor = G;
    G.snow.then(Z => {
      if (!Z || snowFor !== G) return;
      if (snowPrim) { try { scene.primitives.remove(snowPrim); } catch { /* gone */ } snowPrim = null; }
      snowMat = new Cesium.Material({ translucent: true, fabric: { uniforms: { image: Z.canvas, fade: 0 }, source: `
        czm_material czm_getMaterial(czm_materialInput mi) {
          czm_material m = czm_getDefaultMaterial(mi);
          vec4 t = texture(image, mi.st);
          m.diffuse = vec3(0.925, 0.94, 0.96) * t.r;                  // snow, slightly blue in the shade
          m.alpha = t.g * 0.97 * fade;
          return m;
        }` } });
      snowPrim = scene.primitives.add(new Cesium.GroundPrimitive({ geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.RectangleGeometry({ rectangle: Z.rect }) }),
        appearance: new Cesium.MaterialAppearance({ material: snowMat, flat: true, translucent: true }), classificationType: Cesium.ClassificationType.TERRAIN }));
    }).catch(e => console.warn("snow cover:", e));
  }
  // ------------------------------------------------------------ the avalanche body (the 2D tour's "real" look, static/js/avalanche.js, in 3D)
  // A mesh along the stop's own path, draped on the 3D terrain (heights sampled from it): s = metres along the path (horizontal),
  // u = metres across it. A shader draws, from the playback state only: the crown fracture, the thin scoured track layer, the flowing
  // body (a tongue that stretches as the head outruns the tail, a lobed head that surges, shaded flanks, surface streaks and clods moving
  // downhill, a bright head, a greyer tail) and, once stopped, the thick deposit tongue with a shaded rim. Times and positions follow the
  // path's own times; the look is illustration.
  async function prepBody(G) {
    const P = G.P, lon0 = P[0][0], lat0 = P[0][1], kx = 111320 * Math.cos(lat0 * D2R), ky = 110574;
    const xy = P.map(p => [(p[0] - lon0) * kx, (p[1] - lat0) * ky]), c = [0];
    for (let i = 1; i < xy.length; i++) c.push(c[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    const L = Math.max(1, c[c.length - 1]), n = xy.length;
    const w0 = G.hw * 0.8, wt = 0.38 * w0 + 18, wf = 1.15 * w0, Umax = 1.6 * Math.max(w0, wf), pre = 20, post = wf * 1.15 + 40;
    const ds = Math.max(6, L / 220), NT = Math.ceil((L + pre + post) / ds) + 1, J = 31, lenX = (NT - 1) * ds;   // fine enough for the rounded body and the head
    const dir = (a, b) => { const dx = xy[b][0] - xy[a][0], dy = xy[b][1] - xy[a][1], d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; };
    const d0 = dir(0, Math.min(n - 1, 1)), d1 = dir(Math.max(0, n - 1 - Math.max(2, Math.round(n / 12))), n - 1);
    let j = 0;
    const at = s => {                                                      // centreline (straight before the start and past the end)
      if (s <= 0) return [xy[0][0] + d0[0] * s, xy[0][1] + d0[1] * s];
      if (s >= L) return [xy[n - 1][0] + d1[0] * (s - L), xy[n - 1][1] + d1[1] * (s - L)];
      if (c[j] > s) j = 0; while (j < n - 2 && c[j + 1] < s) j++;
      const f = clamp((s - c[j]) / ((c[j + 1] - c[j]) || 1), 0, 1); return [xy[j][0] + (xy[j + 1][0] - xy[j][0]) * f, xy[j][1] + (xy[j + 1][1] - xy[j][1]) * f];
    };
    const carto = [], st = new Float32Array(NT * J * 2), tan = [];
    for (let i = 0; i < NT; i++) {
      const s = -pre + i * ds, p = at(s), pa = at(s - 60), pb = at(s + 60), tx = pb[0] - pa[0], ty = pb[1] - pa[1], tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl, ny = tx / tl; tan.push([tx / tl, ty / tl]);
      for (let k = 0; k < J; k++) {
        const u = (k / (J - 1) * 2 - 1) * Umax;
        carto.push(Cesium.Cartographic.fromDegrees(lon0 + (p[0] + nx * u) / kx, lat0 + (p[1] + ny * u) / ky));
        st[(i * J + k) * 2] = (s + pre) / lenX; st[(i * J + k) * 2 + 1] = k / (J - 1);
      }
    }
    let hs;
    try { hs = (await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, carto)).map(q => q.height); } catch { hs = carto.map(() => NaN); }
    const zPath = s => { const f = clamp(s / L, 0, 1) * (n - 1), i = Math.min(n - 2, f | 0); return P[i][2] + (P[i + 1][2] - P[i][2]) * (f - i); };
    const pos = new Float64Array(NT * J * 3), H = new Float64Array(NT * J);
    for (let i = 0; i < NT; i++) for (let k = 0; k < J; k++) {
      const q = i * J + k, h = isFinite(hs[q]) ? hs[q] : zPath(-pre + i * ds); H[q] = h;
      const v = Cesium.Cartesian3.fromRadians(carto[q].longitude, carto[q].latitude, h * EX + 4);   // 4 m above the ground
      pos[q * 3] = v.x; pos[q * 3 + 1] = v.y; pos[q * 3 + 2] = v.z;
    }
    const idx = new Uint16Array((NT - 1) * (J - 1) * 6); let m = 0;
    for (let i = 0; i < NT - 1; i++) for (let k = 0; k < J - 1; k++) { const a = i * J + k, b = a + J; idx.set([a, b, a + 1, a + 1, b, b + 1], m); m += 6; }
    // the front at path time t: the path's own times, along the horizontal path length
    const sF = t => { const T0 = G.T0; if (t <= 0) return 0; if (t >= T0[n - 1]) return L; let i = 0; while (i < n - 2 && T0[i + 1] < t) i++;
      return c[i] + (c[i + 1] - c[i]) * clamp((t - T0[i]) / ((T0[i + 1] - T0[i]) || 1e-6), 0, 1); };
    const W = s => s < 0.22 * L ? w0 + (wt - w0) * smooth(s / (0.22 * L)) : s < 0.78 * L ? wt : s <= L ? wt + (wf - wt) * smooth((s - 0.78 * L) / (0.22 * L)) : wf * (1 + (s - L) / 500);
    // blocks of the deposit, densest towards the toe where the slowing slab piles up (positions on the mesh's own ground)
    let sd = 17; const rn = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const blocks = Array.from({ length: 200 }, () => {
      const s = L * (0.72 + 0.28 * Math.pow(rn(), 0.45)), u = (rn() * 2 - 1) * 0.9 * W(s) * 0.75;
      const i = clamp(Math.round((s + pre) / ds), 0, NT - 1), k = clamp(Math.round((u / Umax + 1) / 2 * (J - 1)), 0, J - 1), p = at(s), t = tan[i];
      return { s, size: 2.2 + rn() * 4.8, ar: 0.5 + rn() * 0.5, rot: rn() * 6.283,
        pos: Cesium.Cartesian3.fromDegrees(lon0 + (p[0] - t[1] * u) / kx, lat0 + (p[1] + t[0] * u) / ky, H[i * J + k] * EX + 5) };
    });
    // local downhill direction at s, as an ECEF vector (for the spray and the cloud)
    const fwdAt = s => { const t = tan[clamp(Math.round((s + pre) / ds), 0, NT - 1)], C3 = Cesium.Cartesian3;
      return C3.normalize(C3.add(C3.multiplyByScalar(G.east, t[0], new C3()), C3.multiplyByScalar(G.north, t[1], new C3()), new C3()), new C3()); };
    const geometry = () => {
      const g = new Cesium.Geometry({ attributes: Object.assign(new Cesium.GeometryAttributes(), {
          position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: pos.slice() }),
          st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: st.slice() }) }),
        indices: idx.slice(), primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(pos) });
      return Cesium.GeometryPipeline.computeNormal(g);
    };
    return { L, w0, wt, wf, Umax, pre, lenX, sF, W, blocks, fwdAt, geometry };
  }
  // shared by the vertex shader (the body's thickness: it is raised off the ground) and the fragment shader (shading of that relief)
  const BODY_COMMON = `
    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
    float Wd(float s) {
      if (s < 0.22 * lenL) return mix(wa, wb, smoothstep(0.0, 1.0, s / (0.22 * lenL)));
      if (s < 0.78 * lenL) return wb;
      if (s <= lenL) return mix(wb, wc, smoothstep(0.0, 1.0, (s - 0.78 * lenL) / (0.22 * lenL)));
      return wc * (1.0 + (s - lenL) / 500.0);
    }
    // thickness of the dense flow (m): a rounded tongue, thin at the tail, thicker towards the head; the moving head boils up
    // tallest; once stopped, the deposit piles up towards the toe. Dense flows are metres thick, their heads several times that.
    float thick(float s, float u) {
      if (sHead < 2.0) return 0.0;
      float au = abs(u), th = 0.0;
      if (s >= sTail && s <= sHead) {
        float f = (s - sTail) / max(1.0, sHead - sTail);
        float env = 0.55 + 0.4 * smoothstep(0.0, 0.5, f) + 0.28 * smoothstep(0.72, 1.0, f);
        float wid = Wd(min(s, lenL)) * env, q = au / max(wid, 1.0);
        float dome = sqrt(max(0.0, 1.0 - q * q));
        float body = mix(1.5, 5.5, smoothstep(0.0, 1.0, f)) + (1.0 - isDone) * 10.0 * (1.0 - smoothstep(0.0, wid * 1.8, sHead - s));
        th = body * dome * smoothstep(sTail, sTail + 70.0, s);
      } else if (s > sHead) {
        float wH = Wd(min(sHead, lenL)) * 1.23;
        float e = pow((s - sHead) / (0.5 * wH), 2.0) + pow(u / wH, 2.0);
        th = (5.5 + (1.0 - isDone) * 10.0) * sqrt(max(0.0, 1.0 - e));
      }
      if (isDone > 0.5) th *= mix(0.7, 1.5, smoothstep(0.6 * lenL, lenL, s));
      return th * thk;
    }`;
  const BODY_VS = `
    in vec3 position3DHigh;
    in vec3 position3DLow;
    in vec3 normal;
    in vec2 st;
    in float batchId;
    out vec3 v_positionEC;
    out vec3 v_normalEC;
    out vec2 v_st;
    ${"@COMMON@"}
    void main() {
      vec4 p = czm_computePosition();
      float s = st.x * lenX - sPre, u = (st.y * 2.0 - 1.0) * uMax;
      p.xyz += normal * thick(s, u);                                   // the body stands up off the ground
      v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
      v_normalEC = czm_normal * normal;
      v_st = st;
      gl_Position = czm_modelViewProjectionRelativeToEye * p;
    }`;
  const BODY_GLSL = BODY_COMMON + `
    czm_material czm_getMaterial(czm_materialInput mi) {
      czm_material m = czm_getDefaultMaterial(mi);
      float s = mi.st.x * lenX - sPre, u = (mi.st.y * 2.0 - 1.0) * uMax, au = abs(u);
      // surface frame from screen derivatives (taken here, outside any branch): d(position)/ds and d(position)/du in eye space
      vec3 pE = -mi.positionToEyeEC, dpx = dFdx(pE), dpy = dFdy(pE);
      vec2 su = vec2(s, u), dx2 = dFdx(su), dy2 = dFdy(su);
      float det = dx2.x * dy2.y - dx2.y * dy2.x;
      vec3 Ts = (dpx * dy2.y - dpy * dx2.y) / (abs(det) > 1e-9 ? det : 1e-9), Tu = (dpy * dx2.x - dpx * dy2.x) / (abs(det) > 1e-9 ? det : 1e-9);
      vec3 N = normalize(mi.normalEC);
      float rag = fbm(vec2(s / 38.0, u / 38.0)) - 0.5;                                  // ragged edges
      float a = 0.0; vec3 col = vec3(0.9);
      // crown fracture: the dark step where the slab broke away
      if (sHead > 1.0 && s > -7.0 && s < 2.0 && au < wa * 1.05 * (1.0 + 0.2 * rag)) {
        a = 0.88; col = vec3(0.17, 0.18, 0.2) * (0.75 + 0.5 * h21(vec2(floor(u / 7.0), 3.0)));
      }
      // the track it has run over keeps a thin, patchy layer of avalanche snow (the ground shows through where it scoured)
      if (s >= 2.0 && s < sTail) {
        float tw = Wd(s) * (0.42 + 0.1 * s / lenL + 0.08 * sin(s / 33.0) + 0.05 * sin(s / 9.5 + 1.3)) * (1.0 + 0.4 * rag);
        float k = 1.0 - smoothstep(tw * 0.8, tw, au);
        float patchy = smoothstep(0.28, 0.62, fbm(vec2(s, u) * 0.035 + 7.0));
        if (k > 0.0) { a = mix(0.3, 0.6, clamp(s / max(sTail, 1.0), 0.0, 1.0)) * k * (0.35 + 0.65 * patchy); col = vec3(0.925, 0.92, 0.905) * (0.82 + 0.3 * fbm(vec2(s, u) * 0.09)); }
      }
      // the dense flowing body
      if (sHead > 2.0 && s >= sTail - 4.0) {
        float f = (s - sTail) / max(1.0, sHead - sTail);
        float env = 0.55 + 0.4 * smoothstep(0.0, 0.5, f) + 0.28 * smoothstep(0.72, 1.0, f);      // heavy, bulging head
        float rip = 1.0 + 0.12 * sin(s / 21.0 + flowT * 2.6) + 0.07 * sin(s / 7.5 - flowT * 4.1) + 0.04 * sin(s / 3.1 + flowT * 7.0);
        float wid = Wd(min(s, lenL)) * env * rip * (1.0 + 0.25 * rag);
        float inside = 0.0;
        if (s <= sHead) inside = (1.0 - smoothstep(wid * 0.86, wid, au)) * smoothstep(sTail - 4.0, sTail + 70.0 + 40.0 * rag, s);
        else {                                                                                  // the lobed head
          float wH = Wd(min(sHead, lenL)) * 1.23, lob = 1.0 + surge + 0.22 * abs(sin(u / wH * 5.0 + flowT * 1.4));
          float e = pow((s - sHead) / (0.5 * wH * lob), 2.0) + pow(u / wH, 2.0);
          inside = 1.0 - smoothstep(0.78, 1.0, e + 0.25 * rag);
        }
        if (inside > 0.0) {
          // relief: the tongue's own rounded thickness plus clods and lumps (moving downhill while it flows), lit by the sun
          float sc = s - 0.5 * sHead * (1.0 - isDone);
          float lump = 1.6 * vn(vec2(sc * 0.07, u * 0.07)) + 0.7 * vn(vec2(sc * 0.19, u * 0.19 + 3.0));
          float h0 = thick(s, u) + lump * thk, e = 3.0;
          float hs = (thick(s + e, u) + thk * (1.6 * vn(vec2((sc + e) * 0.07, u * 0.07)) + 0.7 * vn(vec2((sc + e) * 0.19, u * 0.19 + 3.0))) - h0) / e;
          float hu = (thick(s, u + e) + thk * (1.6 * vn(vec2(sc * 0.07, (u + e) * 0.07)) + 0.7 * vn(vec2(sc * 0.19, (u + e) * 0.19 + 3.0))) - h0) / e;
          vec3 ts = Ts - N * dot(N, Ts), tu = Tu - N * dot(N, Tu);
          ts = ts / max(length(ts), 1e-6); tu = tu / max(length(tu), 1e-6);
          vec3 Nb = normalize(N - ts * hs - tu * hu);                                             // bumped smooth normal (no flat facets)
          m.normal = normalize(mix(N, Nb, inside));
          float q = au / max(wid, 1.0);
          vec3 cb = vec3(0.905, 0.898, 0.882);                                                   // churned debris, a touch greyer than fresh snow
          cb *= 1.0 - 0.3 * smoothstep(0.6, 1.0, q);                                             // flanks turn away from the light
          float ph = fract((s - 0.65 * sHead) / 60.0), lane = abs(fract(u / max(wid, 1.0) * 3.0 + 0.5) - 0.5);
          cb = mix(cb, vec3(1.0), 0.35 * smoothstep(0.38, 0.5, ph) * (1.0 - smoothstep(0.5, 0.62, ph)) * (1.0 - smoothstep(0.04, 0.12, lane)));
          cb *= 0.86 + 0.22 * vn(vec2(sc * 0.08, u * 0.08));                                     // tumbling clods
          cb = mix(cb, vec3(1.0), (1.0 - isDone) * 0.8 * (1.0 - smoothstep(0.0, wid * 2.2, abs(s - sHead))));   // fresh powder boiling at the head
          cb = mix(cb, vec3(0.5, 0.49, 0.47), 0.28 * (1.0 - smoothstep(0.0, 0.5, f)));           // the tail duller as it slows and thins
          float rim = smoothstep(0.88, 0.96, q) * (1.0 - smoothstep(0.96, 1.0, q));
          cb = mix(cb, vec3(0.24, 0.23, 0.22), rim * 0.6);                                       // a dark rim so it stands out on snow too
          col = mix(col, cb, inside); a = max(a, inside * 0.98);
        }
      }
      // lit the way Cesium lights the terrain (sun only, 0.3 ambient), and darkened a little more the way the photo's snow is
      float I = clamp(0.9 * max(dot(m.normal, czm_lightDirectionEC), 0.0) + 0.3, 0.0, 1.0);
      m.diffuse = vec3(0.0); m.specular = 0.0; m.emission = col * I * (0.62 + 0.38 * I); m.alpha = a * fade;
      return m;
    }`;
  // the vertex shader with the material's own uniform names (Cesium renames fabric uniforms, e.g. sHead -> sHead_3)
  const BODY_U = ["sHead", "sTail", "flowT", "lenL", "lenX", "sPre", "uMax", "wa", "wb", "wc", "isDone", "surge", "fade", "thk"];
  function bodyVS(mat) {
    let src = BODY_VS.replace("@COMMON@", BODY_COMMON);
    const decl = BODY_U.map(n => {
      const m = String(mat.shaderSource || "").match(new RegExp(`uniform\\s+float\\s+(${n}(?:_\\d+)?)\\s*;`)), id = m ? m[1] : n;
      src = src.replace(new RegExp(`\\b${n}\\b`, "g"), id);
      return `uniform float ${id};`;
    });
    return decl.join("\n") + "\n" + src;
  }
  // pre-load the next stop's terrain (deepest tiles along its path) and imagery (tiles around it), while this one plays
  async function prefetch(r) {
    if (!r) return;
    const G = await prepare(r).catch(() => null); if (!G) return;
    const lay = viewer.imageryLayers.get(0), pr = lay && lay.imageryProvider; if (!pr || !pr.requestImage) return;
    const ts = pr.tilingScheme, c = Cesium.Cartographic.fromCartesian(G.center), seen = new Set();
    for (const z of [9, 10, 11, 12, 13, 14]) {
      const t = ts.positionToTileXY(c, z); if (!t) continue; const span = z >= 13 ? 2 : 1;
      for (let dx = -span; dx <= span; dx++) for (let dy = -span; dy <= span; dy++) { const k = `${z}/${t.x + dx}/${t.y + dy}`; if (seen.has(k)) continue; seen.add(k); try { pr.requestImage(t.x + dx, t.y + dy, z); } catch { /* throttled */ } }
    }
  }

  // ------------------------------------------------------------ marker of a stop: a pin for located places, a pulsing ring for approximate ones
  function marker(r) {
    clearStop();
    const at = Cesium.Cartesian3.fromDegrees(r.geom ? r.geom[0] : r.anim.path[0][0], r.geom ? r.geom[1] : r.anim.path[0][1]);
    if (approx(r)) {
      const R = ringR(r);
      stopEnts.push(viewer.entities.add({ position: at, ellipse: { semiMajorAxis: new Cesium.CallbackProperty(() => R * (0.86 + 0.14 * Math.sin(performance.now() / 420)), false),
        semiMinorAxis: new Cesium.CallbackProperty(() => R * (0.86 + 0.14 * Math.sin(performance.now() / 420)), false),
        material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => Cesium.Color.fromCssColorString("#fde68a").withAlpha(0.07 + 0.04 * Math.sin(performance.now() / 520)), false)),
        outline: false, classificationType: Cesium.ClassificationType.TERRAIN } }));
      stopEnts.push(viewer.entities.add({ position: at, label: { text: `${r.location.split("(")[0].trim()}\nlocation approximate · ${approxWhy(r)}`.toUpperCase(), font: "700 11px Inter, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#fde68a"), outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY, showBackground: true, backgroundColor: Cesium.Color.fromCssColorString("#0b1222").withAlpha(0.7) } }));
    } else {
      stopEnts.push(viewer.entities.add({ position: at, billboard: { image: pin(r.model ? "#a78bfa" : "#f43f5e"), verticalOrigin: Cesium.VerticalOrigin.BOTTOM, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, scale: 0.75 },
        label: { text: `${r.location.split("(")[0].trim()}\n${r.model ? "model reconstruction" : TIER[(r.loc || {}).tier] || ""}`.toUpperCase(), font: "700 11px Inter, sans-serif", fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, pixelOffset: new Cesium.Cartesian2(0, -54),
          disableDepthTestDistance: Number.POSITIVE_INFINITY, showBackground: true, backgroundColor: Cesium.Color.fromCssColorString("#0b1222").withAlpha(0.7) } }));
    }
  }
  const fxPrims = [];
  function clearStop() {
    stopEnts.forEach(e => viewer.entities.remove(e)); stopEnts = [];
    fxPrims.forEach(p => { try { scene.primitives.remove(p); } catch { /* gone */ } }); fxPrims.length = 0; liveFx.length = 0;
    onTick = []; shot = null;
    ["hud", "wx", "card"].forEach(k => $(".t3-" + k).classList.remove("on")); $(".t3-chip").classList.remove("on");
  }

  // ------------------------------------------------------------ camera: flights, orbit and the drone that follows the front
  const HPR = (h, p, r) => new Cesium.HeadingPitchRange(h, p, r);
  function flyTo(my, center, hpr, sec, maxH) {
    flying(true);
    return new Promise((res, rej) => {
      const go = left => {
        const sphere = new Cesium.BoundingSphere(center, 1);
        viewer.camera.flyToBoundingSphere(sphere, { offset: hpr, duration: calm ? Math.max(left, 3) : left, maximumHeight: maxH, easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
          complete: () => { fly = null; flying(false); res(); }, cancel: () => { if (my !== tok) { fly = null; flying(false); rej(new Stop()); } } });
      };
      let start = performance.now(), dur = sec / speed, spent = 0;
      fly = { pause: p => { if (p) { spent += (performance.now() - start) / 1000; viewer.camera.cancelFlight(); } else { start = performance.now(); go(Math.max(0.6, dur - spent)); } } };
      go(dur);
    });
  }
  // slow orbit; with r0 the drone first glides in from range r0 to range over pushS seconds (the first stop's approach under the title)
  function orbitShot(G, range, pitch, h0, rate, r0, pushS = 5) {
    let h = h0, t = 0;
    let boost = 1;
    shot = dt => { t += dt; h += dt * rate; const k = r0 ? 1 - smooth(t / pushS) : 0;
      viewer.camera.lookAt(G.center, HPR(h, pitch - PUSH.dp * k, (range + ((r0 || range) - range) * k) * zoomS * boost));
      // zoomed in close, a ridge can come between: back off a little until the drone is clear of the ground again
      const c = viewer.camera.positionCartographic, gh = c && scene.globe.getHeight(c);
      boost = gh != null && c.height < gh + 220 ? Math.min(4, boost * 1.05) : Math.max(1, boost * 0.995); };
    return () => h;
  }
  const PUSH = { k: 1.08, dp: 0.03 };                                     // the first stop: the drone starts 8% farther out (the same tiles, loaded under the title)
  const releaseCam = () => { viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); };
  // a hovering drone: at heading h around the site (the orbit's own position, so its tiles are loaded), drifting slowly, a long lens
  // (narrowing from 40 to 26 degrees) following the front, a few metres of hand-held drift and the impact shake
  function hoverShot(G, getTarget, h0) {
    const C3 = Cesium.Cartesian3, R = orbitRange(G) * 0.92, P = -0.34; let h = h0, t = 0, shake = 0, camT = null;
    shot = dt => {
      t += dt; h += dt * 0.012;
      const tgt = getTarget(); if (!tgt) return;
      const off = new C3(-R * Math.cos(P) * Math.sin(h), -R * Math.cos(P) * Math.cos(h), -R * Math.sin(P));
      const p = Cesium.Matrix4.multiplyByPoint(enu(G.center), off, new C3());
      camT = camT ? C3.lerp(camT, tgt, 1 - Math.exp(-dt * 2.6), new C3()) : C3.clone(tgt);
      C3.lerp(camT, p, zoomS, p);                                       // the viewer's zoom: along the line of sight to the front
      const n = calm ? 0 : 1, sh = calm ? 0 : shake;
      C3.add(p, new C3(Math.sin(t * 0.9) * 3 * n + (Math.random() - .5) * sh * 14, Math.sin(t * 1.3 + 1) * 3 * n + (Math.random() - .5) * sh * 14, Math.sin(t * 0.7 + 2) * 2 * n + (Math.random() - .5) * sh * 10), p);
      clearOf(p, 260);
      const dir = C3.normalize(C3.subtract(camT, p, new C3()), new C3()), right = C3.normalize(C3.cross(dir, ell().geodeticSurfaceNormal(p, new C3()), new C3()), new C3());
      viewer.camera.frustum.fov = Cesium.Math.toRadians(40 - 12 * smooth(t / 6));
      viewer.camera.setView({ destination: p, orientation: { direction: dir, up: C3.cross(right, dir, new C3()) } });
      shake *= Math.exp(-dt * 2.4);
    };
    return { kick: a => { shake = Math.max(shake, a); } };
  }
  // a drone: placed beside and slightly behind the front, low over the slope; damped, with a little hand-held drift and an impact shake
  function droneShot(G, getTarget, opts) {
    const C3 = Cesium.Cartesian3; let camP = null, camT = null, t = 0, shake = 0;
    const o = Object.assign({ side: 850, back: 380, up: 330, clear: 320 }, opts);
    shot = dt => {
      t += dt;
      const tgt = getTarget(); if (!tgt) return;
      const want = C3.clone(tgt);
      C3.add(want, C3.multiplyByScalar(G.side, o.side, new C3()), want);
      C3.add(want, C3.multiplyByScalar(G.fwd, -o.back, new C3()), want);
      C3.add(want, C3.multiplyByScalar(G.up, o.up, new C3()), want);
      { const c = Cesium.Cartographic.fromCartesian(want), gh = scene.globe.getHeight(c), need = (gh == null ? 0 : gh) + o.clear;
        if (gh != null && c.height < need) { c.height = need; Cesium.Cartographic.toCartesian(c, ell(), want); } }
      const k = 1 - Math.exp(-dt * 1.6), kt = 1 - Math.exp(-dt * 3.2);
      camP = camP ? C3.lerp(camP, want, k, new C3()) : want; camT = camT ? C3.lerp(camT, tgt, kt, new C3()) : C3.clone(tgt);
      // hand-held drift (a few metres) and the shake (decays)
      const n = calm ? 0 : 1, sh = calm ? 0 : shake;
      const jit = new C3(Math.sin(t * 0.9) * 3.5 * n + (Math.random() - .5) * sh * 9, Math.sin(t * 1.3 + 1) * 3 * n + (Math.random() - .5) * sh * 9, Math.sin(t * 0.7 + 2) * 2.5 * n + (Math.random() - .5) * sh * 6);
      const p = C3.add(camP, jit, new C3());
      const dir = C3.normalize(C3.subtract(camT, p, new C3()), new C3());
      const right = C3.normalize(C3.cross(dir, ell().geodeticSurfaceNormal(p, new C3()), new C3()), new C3());
      const upv = C3.cross(right, dir, new C3());
      viewer.camera.setView({ destination: p, orientation: { direction: dir, up: upv } });
      shake *= Math.exp(-dt * 2.4);
    };
    return { kick: a => { shake = Math.max(shake, a); } };
  }

  // ------------------------------------------------------------ effects
  const liveFx = [];                                                      // this stop's particle systems (removed once their snow has settled)
  function particles(o) {
    if (OFF.has("fx")) return null;
    const ps = new Cesium.ParticleSystem(Object.assign({ sizeInMeters: true, lifetime: 1e6, loop: true }, o));
    scene.primitives.add(ps); fxPrims.push(ps); liveFx.push(ps); return ps;
  }
  // the airborne snow has settled: the particle systems leave the scene (left in, they were updated and drawn every frame until the
  // next stop and held the card and the climb at ~40 fps; measured)
  function dropFx() {
    while (liveFx.length) { const ps = liveFx.pop(); const k = fxPrims.indexOf(ps); if (k >= 0) fxPrims.splice(k, 1); try { scene.primitives.remove(ps); } catch { /* gone */ } }
  }
  const enu = p => Cesium.Transforms.eastNorthUpToFixedFrame(p);
  function snowfall(G) {
    const ps = particles({ image: TX.flake, sizeInMeters: false, imageSize: new Cesium.Cartesian2(5, 5), minimumImageSize: new Cesium.Cartesian2(3, 3), maximumImageSize: new Cesium.Cartesian2(7, 7),
      startColor: Cesium.Color.WHITE.withAlpha(0.9), endColor: Cesium.Color.WHITE.withAlpha(0.0), minimumParticleLife: 5, maximumParticleLife: 9, minimumSpeed: 0, maximumSpeed: 1,
      emissionRate: 0, emitter: new Cesium.BoxEmitter(new Cesium.Cartesian3(5000, 5000, 400)), modelMatrix: enu(Cesium.Cartesian3.add(G.center, Cesium.Cartesian3.multiplyByScalar(G.up, 1400, new Cesium.Cartesian3()), new Cesium.Cartesian3())),
      updateCallback: (p, dt) => { const d = Cesium.Cartesian3.normalize(p.position, new Cesium.Cartesian3()); Cesium.Cartesian3.multiplyByScalar(d, -160 * dt, d); Cesium.Cartesian3.add(p.position, d, p.position); } });
    return ps;
  }

  // ------------------------------------------------------------ weather lead-up (only a stop with a daily series)
  async function weather(my, r, G) {
    const W = r.wx; if (!W || !W.days.length) return;
    const box = $(".t3-wx"), svg = box.querySelector("[data-w=svg]"), mx = Math.max(1, ...W.days.map(d => d.sf)), n = W.days.length, bw = 300 / n;
    box.querySelector("[data-w=src]").textContent = `Daily snowfall (mm water equivalent) · ${W.source}`;
    svg.innerHTML = W.days.map((d, i) => `<rect x="${i * bw + 2}" y="86" width="${bw - 4}" height="0" rx="2" fill="#7dd3fc" opacity=".35" data-i="${i}"/>`).join("");
    box.classList.add("on");
    const snow = calm ? null : snowfall(G);
    orbitShot(G, Math.max(5200, G.L * 2.1), -0.32, G.az + Math.PI / 2 + 0.25, 0.05);
    const per = 0.55;
    await hold(my, n * per, (_, t) => {
      const i = Math.min(n - 1, Math.floor(t / per)), d = W.days[i];
      svg.querySelectorAll("rect").forEach((rc, k) => { if (k <= i) { const h = 80 * W.days[k].sf / mx; rc.setAttribute("y", 86 - h); rc.setAttribute("height", h); rc.setAttribute("opacity", k === i ? "1" : ".55"); } });
      box.querySelector("[data-w=d]").textContent = `${fdate(d.date)} · ${d.d === 0 ? "the day of the event" : `${-d.d} day${d.d === -1 ? "" : "s"} before`} · ${fmt(d.sf, 1)} mm`;
      if (snow) snow.emissionRate = 20 + 320 * (d.sf / mx) * fx.factor;   // scaled by that day's ERA5 snowfall (at most ~2,500 flakes)
    });
    if (snow) snow.emissionRate = 0;
    box.classList.remove("on");
  }

  // ------------------------------------------------------------ the avalanche
  let hAt = () => 0, fxFade = 0;                                         // fxFade: the airborne snow settles out faster (after the run)
  async function avalanche(my, G) {
    fxFade = 0;
    const r = G.r, a = G.a, C3 = Cesium.Cartesian3, E = viewer.entities;
    const rate = r.model ? 5 : Math.max(2, (a.duration_s || G.T) / 14);   // path seconds per screen second (the read-out says ×N)
    const chip = $(".t3-chip"); chip.textContent = r.model ? (a.extended ? "NGT model reconstruction · starts with an illustrative run from the summit · not observed" : "NGT model reconstruction · not observed") : "Illustrative animation, not the mapped avalanche path";
    chip.classList.toggle("model", !!r.model); chip.classList.add("on");
    const rz = recordZ(r, a);
    H("eb").textContent = r.model ? "Avalanche reconstruction" : "Avalanche scenario · illustrative";
    H("L").textContent = `of ${fmt(G.L)} m`; H("x").textContent = `s · ×${fmt(rate, rate < 10 ? 1 : 0)}`;
    H("note").textContent = r.model ? "Path, times and speeds: the NGT model's own. Snow, cloud and camera are illustration; the winter snow on the release peak is painted on." : "Times, speeds and distances: the tour's illustrative scenario (sliding-block model), drawn down the fall line of this 3D terrain from its release point. Snow, cloud and camera are illustration; the winter snow on the release peak is painted on (the satellite image is a summer view).";
    $(".t3-hud").classList.add("on");
    stopEnts.forEach(e => { if (e.label) e.label.show = false; });
    // labels on the slope: release, the record's own elevation where the path passes it
    const lab = (pos, text, color) => stopEnts.push(E.add({ position: pos, label: { text, font: "700 11px Inter, sans-serif", fillColor: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY, showBackground: true, backgroundColor: Cesium.Color.fromCssColorString("#0b1222").withAlpha(0.72) } }));
    lab(G.pos[0], `${rz ? "START · ILLUSTRATIVE" : r.model ? "START" : "RELEASE · ILLUSTRATIVE"} · ${fmt(a.release.z)} m${a.release.slope_deg ? ` · ${fmt(a.release.slope_deg)}°` : ""}`, "#a5f3fc");
    if (rz) { let k = 0; while (k < G.P.length - 1 && G.P[k][2] > rz) k++; lab(G.pos[k], `RECORD · struck about ${fmt(rz)} m`, "#fca5a5"); }
    // the snow body on the terrain (built while the camera flew in): crown, track layer, flowing tongue, deposit
    const B = await G.body.catch(e => { console.warn("avalanche body:", e); return null; });
    if (my !== tok) throw new Stop();
    let mat = null;
    if (B && !OFF.has("body")) {
      mat = new Cesium.Material({ translucent: true, fabric: { uniforms: { sHead: 0, sTail: 0, flowT: 0, lenL: B.L, lenX: B.lenX, sPre: B.pre, uMax: B.Umax,
        wa: B.w0, wb: B.wt, wc: B.wf, isDone: 0, surge: 0, fade: 1, thk: 1 }, source: BODY_GLSL } });
      const prim = new Cesium.Primitive({ geometryInstances: new Cesium.GeometryInstance({ geometry: B.geometry() }), asynchronous: false, allowPicking: false, compressVertices: false,
        appearance: new Cesium.MaterialAppearance({ material: mat, translucent: true, closed: false, faceForward: true, materialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED,
          vertexShaderSource: bodyVS(mat) }) });
      scene.primitives.add(prim); fxPrims.push(prim);
    }
    // blocks of the deposit (they appear where the front has passed, densest at the toe)
    const bc = B ? scene.primitives.add(new Cesium.BillboardCollection({ scene })) : null;
    if (bc) { fxPrims.push(bc); B.blocks.forEach(b => { b.bb = bc.add({ position: b.pos, image: TX.block, sizeInMeters: true, width: b.size * 2.2, height: b.size * 2.2 * b.ar, rotation: b.rot, color: Cesium.Color.WHITE.withAlpha(0) }); }); }
    // airborne snow: the powder cloud (billows born at the head in proportion to speed squared, rising higher and wider than the
    // dense flow, outrunning it a little, hanging and drifting long after it stopped), the dense boiling head, and spray off the flanks
    const up = G.up; let vNow = 0, fwdNow = Cesium.Cartesian3.clone(G.fwd);
    const wind = C3.multiplyByScalar(G.side, 1.6, new C3());
    const rnd = () => Math.random();
    const head = calm ? null : particles({ image: TX.core, imageSize: new Cesium.Cartesian2(26, 26), minimumImageSize: new Cesium.Cartesian2(14, 14), maximumImageSize: new Cesium.Cartesian2(40, 40),
      startScale: 1, endScale: 2.6, startColor: Cesium.Color.WHITE.withAlpha(0.92), endColor: Cesium.Color.fromCssColorString("#e7e5df").withAlpha(0), minimumParticleLife: 0.9, maximumParticleLife: 1.9,
      minimumSpeed: 1, maximumSpeed: 6, emissionRate: 0, emitter: new Cesium.SphereEmitter(G.hw * 0.35), modelMatrix: enu(G.pos[0]),
      updateCallback: (p, dt) => { if (fxFade) p._age += dt * 4; if (!p._k) { p._k = 1; C3.add(p.velocity, C3.multiplyByScalar(fwdNow, vNow * (0.45 + 0.4 * rnd()), new C3()), p.velocity); C3.add(p.velocity, C3.multiplyByScalar(up, 2 + 6 * rnd(), new C3()), p.velocity); }
        C3.multiplyByScalar(p.velocity, 1 - 1.4 * dt, p.velocity); } });
    const cloud = calm ? null : particles({ image: TX.cloud, imageSize: new Cesium.Cartesian2(70, 70), minimumImageSize: new Cesium.Cartesian2(48, 48), maximumImageSize: new Cesium.Cartesian2(100, 100),
      startScale: 0.9, endScale: 3.6, startColor: Cesium.Color.fromCssColorString("#f6f5f1").withAlpha(0.78), endColor: Cesium.Color.fromCssColorString("#c9c7c0").withAlpha(0), minimumParticleLife: 5, maximumParticleLife: 10,
      minimumSpeed: 1, maximumSpeed: 5, emissionRate: 0, emitter: new Cesium.SphereEmitter(G.hw * 0.5), modelMatrix: enu(G.pos[0]),
      updateCallback: (p, dt) => { if (fxFade) p._age += dt * 4; if (!p._k) { p._k = 1; C3.add(p.velocity, C3.multiplyByScalar(fwdNow, vNow * (0.55 + 0.5 * rnd()), new C3()), p.velocity); C3.add(p.velocity, C3.multiplyByScalar(up, 4 + vNow * (0.12 + 0.18 * rnd()), new C3()), p.velocity); }
        C3.add(p.velocity, C3.multiplyByScalar(up, 1.2 * dt, new C3()), p.velocity); C3.multiplyByScalar(p.velocity, 1 - 0.42 * dt, p.velocity); C3.add(p.position, C3.multiplyByScalar(wind, dt, new C3()), p.position); } });
    const spray = calm ? null : particles({ image: TX.core, imageSize: new Cesium.Cartesian2(9, 9), minimumImageSize: new Cesium.Cartesian2(5, 5), maximumImageSize: new Cesium.Cartesian2(14, 14),
      startScale: 1, endScale: 1.8, startColor: Cesium.Color.WHITE.withAlpha(0.9), endColor: Cesium.Color.WHITE.withAlpha(0), minimumParticleLife: 0.7, maximumParticleLife: 1.6,
      minimumSpeed: 0, maximumSpeed: 1, emissionRate: 0, emitter: new Cesium.SphereEmitter(G.hw * 0.2), modelMatrix: enu(G.pos[0]),
      updateCallback: (p, dt) => { if (fxFade) p._age += dt * 4; if (!p._k) { p._k = 1; const sd = rnd() < 0.5 ? -1 : 1;
          C3.add(p.velocity, C3.multiplyByScalar(G.side, sd * (15 + vNow * (1 + 2 * rnd())) * 0.6, new C3()), p.velocity);
          C3.add(p.velocity, C3.multiplyByScalar(fwdNow, vNow * (0.5 + 1.1 * rnd()), new C3()), p.velocity); C3.add(p.velocity, C3.multiplyByScalar(up, 12 + vNow * (0.6 + rnd()), new C3()), p.velocity); }
        C3.add(p.velocity, C3.multiplyByScalar(up, -9.8 * dt, new C3()), p.velocity); C3.multiplyByScalar(p.velocity, 1 - 0.6 * dt, p.velocity); } });
    // camera: a drone hovering where the orbit left it (sharp, loaded tiles), long lens following the front
    let F = frontAt(G, 0);
    const drone = hoverShot(G, () => F.pos, hAt());
    const fov0 = viewer.camera.frustum.fov;
    // the long lens (28 degrees) already shows finer ground per tile: a slightly higher error limit keeps the same metres per pixel
    // without asking for hundreds of extra tiles mid-run
    scene.globe.maximumScreenSpaceError = CFG.sse.stop * 1.25;
    // 1. the slab breaks: the crown fracture shows, a puff of snow at the release
    if (mat) mat.uniforms.sHead = 1.5;
    await hold(my, 1.6, k => { if (head) head.emissionRate = 40 * k * fx.factor; });
    // 2. the run, at the path's own times
    let tp = 0, impact = false, flowT = 0, shownTo = 0;
    const total = G.T + 0.0001, order = B ? B.blocks.slice().sort((x, y) => x.s - y.s) : [];
    const reveal = s => { while (shownTo < order.length && order[shownTo].s <= s) { order[shownTo].bb.color = Cesium.Color.WHITE.withAlpha(0.95); shownTo++; } };
    await hold(my, total / rate + 0.5, (_, t) => {
      const dt = Math.max(0, t * rate - tp) / rate; flowT += dt;
      tp = Math.min(total, t * rate); F = frontAt(G, tp); vNow = F.v;
      if (B) {
        const sH = B.sF(tp), sT = Math.min(B.sF(tp * 0.6), B.L * 0.7);
        fwdNow = B.fwdAt(sH);
        if (mat) { mat.uniforms.sHead = Math.max(1.5, sH); mat.uniforms.sTail = sT; mat.uniforms.flowT = flowT; mat.uniforms.surge = 0.18 * Math.sin(flowT * 3.3); }
        reveal(sH - 30);
      }
      const lift = h => enu(C3.add(F.pos, C3.multiplyByScalar(G.up, h, new C3()), new C3()));
      const kv = clamp(F.v / G.vmax, 0, 1), k2 = Math.pow(clamp((F.v - 6) / Math.max(1, G.vmax - 6), 0, 1), 2);
      if (head) { head.modelMatrix = lift(10); head.emissionRate = (40 + 200 * kv) * fx.factor; }
      if (cloud) { cloud.modelMatrix = lift(34); cloud.emissionRate = (5 + 64 * Math.pow(clamp((F.v - 6) / Math.max(1, G.vmax - 6), 0, 1), 1.4)) * fx.factor; }
      if (spray) { spray.modelMatrix = lift(6); spray.emissionRate = F.v > 8 ? (30 + 160 * k2) * fx.factor : 0; }
      H("ph").textContent = tp < G.T * 0.08 ? "Release" : F.v > G.vmax * 0.85 ? "Peak velocity" : tp < G.T * 0.85 ? "Flowing" : "Run-out · deposition";
      H("v").textContent = fmt(F.v, 0); H("s").textContent = fmt(F.s); H("z").textContent = fmt(a.release.z - F.z); H("t").textContent = fmt(tp, 1);
      H("bar").style.width = `${(F.s / G.L) * 100}%`;
      if (!impact && tp > G.T * 0.86) { impact = true; drone.kick(1); }
    });
    // 3. stopped: the body freezes into the deposit tongue, the blocks are all there, the powder cloud drifts and settles
    if (mat) { mat.uniforms.sHead = B.L; mat.uniforms.isDone = 1; mat.uniforms.surge = 0; }
    reveal(Infinity);
    const endP = G.P[G.P.length - 1], endPos = C3.fromDegrees(endP[0], endP[1]);
    stopEnts.push(E.add({ position: endPos, label: { text: `RUN-OUT · ${fmt(G.L)} m · drop ${fmt(a.release.z - G.Zh[G.Zh.length - 1])} m`, font: "700 11px Inter, sans-serif", fillColor: Cesium.Color.fromCssColorString("#fbcfe8"),
      outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: true, backgroundColor: Cesium.Color.fromCssColorString("#0b1222").withAlpha(0.72), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } }));
    H("ph").textContent = "Deposit settled"; H("v").textContent = "0";
    vNow = 0;
    // the cloud drifts and settles: for the second half of the hold it thins out (the climb then starts in clear air: big translucent
    // billows filling the view were what held the climb under 45 fps)
    await hold(my, 3.4, k => { if (head) head.emissionRate = 25 * (1 - k) * fx.factor; if (cloud) cloud.emissionRate = 4 * (1 - k) * fx.factor; if (spray) spray.emissionRate = 0; fxFade = k > 0.45 ? 1 : 0; });
    if (head) head.emissionRate = 0; if (cloud) cloud.emissionRate = 0;
    viewer.camera.frustum.fov = fov0; scene.globe.maximumScreenSpaceError = CFG.sse.stop;
  }

  // ------------------------------------------------------------ story card (the record, as compiled)
  function card(r, short) {
    const n = v => v === "" || v == null ? "not recorded" : fmt(v);
    const prec = r.date_precision ? `<span>${esc(r.date_precision)}</span>` : "";
    const src = String(r.sources || "").split(/\s*[;|]\s*/).filter(Boolean);
    const tag = r.model ? `<span class="tag model">Model reconstruction · NGT</span>` : short ? `<span class="tag short">Short card · ${esc(r.confidence)} confidence · no animation</span>` : `<span class="tag">Illustrative scenario on real terrain</span>`;
    const nr = v => v === "" || v == null ? '<em class="nr">not recorded</em>' : esc(v);
    const iv = r.inv, pt = r.geom ? `${r.geom[1]}, ${r.geom[0]}` : "";
    $(".t3-card").innerHTML = `<div class="eb"><span>${esc(r.event_id)}</span>${tag}</div>
      <h3>${esc(r.location)}</h3>
      <div class="pills"><span>${esc(dateOf(r))}</span>${prec}${r.region ? `<span>${esc(r.region)}</span>` : ""}${approx(r) ? `<span class="ap">Location approximate · ${esc(approxWhy(r))}</span>` : `<span>${esc(TIER[(r.loc || {}).tier] || "")}</span>`}</div>
      <div class="nums"><div class="d"><b>${r.model ? "—" : n(r.deaths)}</b><small>${r.model ? "Deaths · not part of the model" : "Deaths reported"}</small></div><div><b>${r.model ? "—" : n(r.injured)}</b><small>Injured</small></div>
        <div><b style="text-transform:capitalize">${esc(r.confidence || "—")}</b><small>Confidence</small></div></div>
      <dl><div><dt>Event type</dt><dd>${nr(r.event_type)}</dd></div>
        <div><dt>Who was affected</dt><dd>${nr(r.who_affected)}</dd></div>
        <div><dt>Elevation in the record</dt><dd>${r.elevation_m ? `${esc(r.elevation_m)} m` : nr("")}</dd></div>
        <div><dt>Weather context</dt><dd class="q">${r.weather_context ? esc(r.weather_context) : r.wx ? "ERA5-Land daily series shown in the lead-up." : nr("")}</dd></div>
        <div><dt>Notes in the record</dt><dd>${nr(r.context_notes)}</dd></div>
        <div><dt>Location</dt><dd>${(r.loc || {}).note ? esc(r.loc.note) : nr("")}${pt ? `<br><span class="co">Map point used here (as in the 2D tour): ${esc(pt)}</span>` : ""}</dd></div>
        ${r.model ? "" : `<div><dt>Inventory</dt><dd class="inv">${iv ? `coordinates ${iv.lat && iv.lon ? esc(`${iv.lat}, ${iv.lon}`) : '<em class="nr">not recorded</em>'}
          · location precision ${nr(iv.location_precision)}${iv.coord_note ? ` · ${esc(iv.coord_note)}` : ""} · use in analysis ${nr(iv.use_in_analysis)}
          ${invKm(r) != null && invKm(r) >= 1 ? `<br><span class="co dv">The inventory's coordinates are ${fmt(invKm(r), 1)} km from the map point used here (the 2D tour's point).</span>` : ""}` : '<em class="nr">not in the inventory</em>'}</dd></div>`}
        <div><dt>Sources</dt><dd>${src.length ? `<ul>${src.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : nr("")}</dd></div></dl>
      <p class="fine">${r.model ? "Release point, path, times and speeds are the NGT model's outputs." : short ? "Low-confidence record: shown as a card only." : "The record contains no path: the run on screen is an illustrative scenario on the terrain, not the recorded path."} Casualty figures as reported.</p>`;
    $(".t3-card").scrollTop = 0; $(".t3-card").classList.add("on");
  }
  function lowerThird(r, i) {
    const lt = $(".t3-lt");
    lt.querySelector("small").textContent = `${String(i + 1).padStart(2, "0")} / ${stops.length} · ${dateOf(r)}`;
    lt.querySelector("b").textContent = r.location.split("(")[0].trim();
    lt.querySelector("span").textContent = [r.region, r.event_type].filter(Boolean).join(" · ");
    lt.classList.add("in");
    return () => lt.classList.remove("in");
  }
  function timeline() {
    const tl = root.querySelector("[data-tl]");
    tl.innerHTML = stops.map((r, i) => `<button type="button" data-i="${i}" class="${shortOnly(r) ? "low" : ""}" style="left:${stops.length > 1 ? (i / (stops.length - 1)) * 100 : 0}%" aria-label="${esc(dateOf(r))} · ${esc(r.location)}"><span>${esc(sortKey(r).slice(0, 4))}</span></button>`).join("");
    tl.querySelectorAll("button").forEach(b => b.onclick = () => go(+b.dataset.i));
    root.querySelector("[data-l]").innerHTML = stops.map((r, i) => `<button type="button" data-i="${i}"><b>${esc(sortKey(r).slice(0, 4))}</b><span>${esc(r.location.split("(")[0].trim())}<em>${esc(dateOf(r))} · ${esc(r.confidence)}${approx(r) ? " · location approximate" : ""}</em></span></button>`).join("");
    root.querySelectorAll("[data-l] button").forEach(b => b.onclick = () => { $(".t3-list").classList.remove("on"); go(+b.dataset.i); });
  }
  function progress() {
    root.querySelectorAll("[data-tl] button").forEach((b, i) => { b.classList.toggle("cur", i === cur); b.classList.toggle("done", i < cur); });
    root.querySelectorAll("[data-l] button").forEach((b, i) => b.classList.toggle("cur", i === cur));
    root.querySelector(".t3-tl .fill").style.width = `${stops.length > 1 ? (cur / (stops.length - 1)) * 100 : 0}%`;
    root.querySelector("[data-pos]").textContent = `${cur + 1} / ${stops.length}`;
  }

  // ------------------------------------------------------------ one stop, start to end
  const orbitRange = G => Math.max(4200, G.L * 1.9), orbitHeading = G => G.az + Math.PI / 2 + 0.35;
  function watchSharp(id) {
    const t = performance.now(), rec = M.stops[id] = { sharpAfterFlightMs: null, queueAtLanding: tileQ };
    const f = () => { if (sharp()) { rec.sharpAfterFlightMs = Math.round(performance.now() - t); if (M.firstSharpMs == null) M.firstSharpMs = Date.now() - (M.t0 || M.pageStart); } else if (performance.now() - t < 60000) setTimeout(f, 100); };
    f();
  }
  let first = true;
  // a low drone pass down the track: a few hundred metres above the debris, looking ahead down the valley
  // after the run: the drone rises and pulls back from where it filmed the avalanche, its lens moving from the deposit to the whole
  // track, and ends exactly where the final wide orbit begins. It only sees ground already loaded (from farther away), so nothing new
  // has to stream in: a low pass over the track made every frame upload new close-up satellite tiles (a quarter of the main thread,
  // ~38 fps). Measured with the profiler, see CLAUDE.md.
  async function riseShot(my, G, hEnd) {
    const C3 = Cesium.Cartesian3, P = -0.55, R = wideRange(G) * zoomS;
    const off = new C3(-R * Math.cos(P) * Math.sin(hEnd), -R * Math.cos(P) * Math.cos(hEnd), -R * Math.sin(P));
    const p1 = Cesium.Matrix4.multiplyByPoint(enu(G.center), off, new C3()), p0 = C3.clone(viewer.camera.positionWC);
    const end = G.pos[G.pos.length - 1], t0 = C3.add(p0, C3.multiplyByScalar(viewer.camera.directionWC, C3.distance(p0, end), new C3()), new C3());
    const fov0 = viewer.camera.frustum.fov;
    shot = null; releaseCam();
    await hold(my, 5.5, k => {
      const e = smooth(k), e2 = smooth(clamp((k - 0.15) / 0.85, 0, 1));
      const cam = C3.lerp(p0, p1, e, new C3());
      C3.add(cam, C3.multiplyByScalar(ell().geodeticSurfaceNormal(cam, new C3()), 260 * Math.sin(Math.PI * e), new C3()), cam);   // an arc up, as a drone climbs
      clearOf(cam, 320);
      const tgt = C3.lerp(C3.lerp(t0, end, smooth(clamp(k / 0.3, 0, 1)), new C3()), G.center, e2, new C3());
      const dir = C3.normalize(C3.subtract(tgt, cam, new C3()), new C3()), right = C3.normalize(C3.cross(dir, ell().geodeticSurfaceNormal(cam, new C3()), new C3()), new C3());
      viewer.camera.setView({ destination: cam, orientation: { direction: dir, up: C3.cross(right, dir, new C3()) } });
    });
    viewer.camera.frustum.fov = fov0;
  }
  const wideRange = G => Math.max(5200, G.L * 2.4);
  // the next stop, loaded out of sight: its avalanche mesh and snow are built (that fetches its deepest terrain tiles along the path)
  // and its satellite tiles are requested, so they come from the browser cache when the flight gets there. (A second, hidden Cesium
  // view used to render the next stop too: a full extra frame on the same thread every few hundred ms, an uneven stutter.)
  async function warmNext(r) {
    if (!r || OFF.has("warm")) return;
    const G = await prepare(r).catch(() => null); if (!G) return;
    prefetch(r);
  }
  async function playStop(i, my) {
    cur = i; progress(); const r = stops[i]; phase = "approach";
    try { history.replaceState(null, "", `?stop=${i + 1}`); } catch { /* sandbox */ }
    clearStop(); sunAt(r);
    const G = await prepare(r);
    if (my !== tok) throw new Stop();
    marker(r);
    if (!shortOnly(r)) showSnow(G);
    const off = lowerThird(r, i);
    const range = orbitRange(G), h0 = orbitHeading(G);
    releaseCam();
    const push = first;                                                   // the first stop: the title fades onto it, then the drone glides in
    if (!first) {
      scene.globe.maximumScreenSpaceError = CFG.sse.flight;
      await flyTo(my, G.center, HPR(h0, -0.38, range * zoomS), CFG.approachS, 22000);
    }
    first = false;
    scene.globe.maximumScreenSpaceError = CFG.sse.stop;
    phase = "orbit";
    const hNow = orbitShot(G, range, -0.38, h0, 0.06, push ? range * PUSH.k : 0, 5); hAt = hNow;
    if (!push) watchSharp(r.event_id);
    // (the next stop is pre-loaded later, during the valley pass and the card: nothing competes with the orbit and the avalanche)
    await hold(my, push ? CFG.orbitS + 1.5 : CFG.orbitS);
    off();
    if (r.wx) { phase = "weather"; await weather(my, r, G); }
    if (shortOnly(r)) { phase = "card"; card(r, true); warmNext(stops[i + 1]); await hold(my, CFG.cardS); return; }
    phase = "avalanche";
    releaseCam();
    await avalanche(my, G);
    // low pass down the valley along the track, then the final wide shot, then the record
    warmNext(stops[i + 1]);
    const h = hNow();
    // the powder cloud has settled during the deposit hold: its particle systems leave the scene before the climb (kept in, they
    // held the climb at ~38 fps even when nearly empty; measured)
    dropFx();
    phase = "pass"; await riseShot(my, G, h + 0.6);                       // the drone climbs back to the wide view (no new ground to load)
    phase = "card";
    orbitShot(G, wideRange(G), -0.55, h + 0.6, 0.045);
    card(r, false);
    await hold(my, CFG.cardS);
  }
  async function run(from, my, intro) {
    try {
      if (intro) await opening(my, from);
      for (let i = from; i < stops.length; i++) await playStop(i, my);
      phase = "done";
      const lt = $(".t3-lt"); lt.querySelector("small").textContent = "Tour complete"; lt.querySelector("b").textContent = `${stops.length} avalanches`; lt.querySelector("span").textContent = "Pick a stop on the timeline to watch it again."; lt.classList.add("in");
    } catch (e) { if (!(e instanceof Stop)) { console.error(e); } }
  }
  function go(i) {
    const my = ++tok; viewer.camera.cancelFlight(); releaseCam(); skipNow = false;
    if (phase === "intro") { first = false; scene.globe.maximumScreenSpaceError = CFG.sse.stop; $(".t3-open").classList.remove("on", "boot"); }
    run(i, my, false);
  }
  // The title is on screen from the first frame (no loading screen). Behind it the drone already hovers at the first stop's opening view,
  // so its terrain and imagery load unseen (a little coarser first, then full detail); when they are in (at least introMinS, at most
  // introMaxS) the title fades straight onto that view and the drone glides in. No flight from space: nothing has to load twice.
  async function opening(my, from) {
    phase = "intro";
    const o = $(".t3-open"), G = await prepare(stops[from]);
    o.querySelector("[data-o]").textContent = `${stops.length} recorded avalanches, flown in date order on the real terrain`;
    sunAt(stops[from]);
    if (!shortOnly(stops[from])) showSnow(G);
    viewer.camera.lookAt(G.center, HPR(orbitHeading(G), -0.38 - PUSH.dp, orbitRange(G) * PUSH.k));
    scene.globe.maximumScreenSpaceError = CFG.sse.intro;
    const t = performance.now(), ld = o.querySelector("[data-ld]");
    let fineAt = 0, okSince = 0;
    await hold(my, CFG.introMaxS, () => {
      const now = performance.now(), s = (now - t) / 1000;
      if (!fineAt && sharp() && s > 0.5) { fineAt = now; scene.globe.maximumScreenSpaceError = CFG.sse.stop; tileQ = 1; }   // coarse level in: ask for full detail
      const ok = fineAt && now - fineAt > 800 && sharp();               // (the finer request needs a few frames to show in the queue)
      okSince = ok ? okSince || now : 0;
      ld.textContent = ok ? "Ready" : "Loading terrain and imagery…";
      if (s >= CFG.introMinS && ok && now - okSince > 300) skipNow = true;
    });
    scene.globe.maximumScreenSpaceError = CFG.sse.stop;
    M.introMs = Math.round(performance.now() - t);
    M.introSharp = !!sharp();
    if (M.firstSharpMs == null && sharp()) M.firstSharpMs = Date.now() - (M.t0 || M.pageStart);
    if (!sharp()) watchSharp(stops[from].event_id);
    else M.stops[stops[from].event_id] = { sharpAfterFlightMs: 0, queueAtLanding: tileQ, note: "first stop: sharp under the title" };
    releaseCam();
    o.classList.remove("on", "boot");
    const zl = root.querySelector("[data-zl]"); zl.classList.add("on"); clearTimeout(zlTimer); zlTimer = setTimeout(() => zl.classList.remove("on"), 3800);
  }

  // ------------------------------------------------------------ start
  async function start() {
    ui();
    if (matchMedia("(pointer: coarse)").matches && innerWidth < 820 && !params.has("force3d")) {
      root.insertAdjacentHTML("beforeend", `<div class="t3-gate"><h2>The 2D tour works best on phones</h2><p>The 3D cinematic tour needs a laptop or desktop graphics card. You can still try it.</p>
        <button type="button" class="t3-btn go" data-g="2d">Open the 2D tour</button><button type="button" class="t3-btn" data-g="3d">Try the 3D tour</button></div>`);
      const ok = await new Promise(res => root.querySelectorAll("[data-g]").forEach(b => b.onclick = () => res(b.dataset.g === "3d")));
      root.querySelector(".t3-gate").remove(); if (!ok) return back("2d");
    }
    try {
      const [st] = await Promise.all([load(), makeViewer()]);
      stops = st;
    } catch (e) {
      console.warn("tour3d:", e);
      return fail(e.title || "The 3D tour could not start", e.message || String(e));
    }
    // as data URLs: Cesium gives every billboard / particle with a canvas image its own copy in the texture atlas (a new upload for each
    // particle born, and the atlas keeps growing and being copied: the stutter). A URL is one shared atlas entry, uploaded once.
    TX = Object.fromEntries(["core", "cloud", "flake", "fan", "block"].map(k => [k, tex(k).toDataURL("image/png")]));
    timeline();
    if (!OFF.has("ov")) overlays().catch(e => console.warn("overlays:", e));
    const n = +params.get("stop"), from = n >= 1 && n <= stops.length ? n - 1 : 0;
    $("#t3-load").classList.add("off");
    phase = "ready";
    run(from, ++tok, true);
  }
  // test hooks (read only)
  window.T3 = { state: () => ({ phase, stop: cur + 1, id: stops[cur] && stops[cur].event_id, stops: stops.length, paused, speed, fps: Math.round(1000 / fx.ema), particles: fx.factor, sharp: !!sharp(), queue: tileQ, quality: Q.level, live: fxPrims.reduce((a, p) => a + ((p._particles && p._particles.length) || 0), 0) }),
    metrics: () => JSON.parse(JSON.stringify(M)),
    // what each stop shows, for the inventory check (tests/check_tour3d.py)
    shown: () => stops.map(r => ({ event_id: r.event_id, location: r.location, date: r.date || "", date_start: r.date_start || "", date_end: r.date_end || "", date_shown: dateOf(r), date_precision: r.date_precision || "",
      deaths: r.deaths == null ? "" : String(r.deaths), injured: r.injured == null ? "" : String(r.injured), who_affected: r.who_affected || "", confidence: r.confidence || "", sources: r.sources || "",
      weather_context: r.weather_context || "", map_point: r.geom ? [r.geom[1], r.geom[0]] : null, tier: (r.loc || {}).tier || "", approximate: approx(r), short_card: shortOnly(r), model: !!r.model,
      inventory: r.inv ? { lat: r.inv.lat, lon: r.inv.lon, location_precision: r.inv.location_precision, coord_note: r.inv.coord_note, use_in_analysis: r.inv.use_in_analysis } : null })),
    act, go: i => go(i - 1) };
  start();
})();
