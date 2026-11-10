/* Historic avalanche tour (Historical Overview on the home page): HistTour.open({ focus, tour }).
   A full-screen 3D satellite map of the compiled historical records (/api/history/events, scripts/build_history_events.py) and a guided,
   user-started tour through the located snow / ice avalanches. Each event: establishing flight onto the real terrain -> blowing snow
   (atmosphere) -> release, flow, powder cloud and deposit (Avalanche engine, static/js/avalanche.js) -> the historical record, then the
   tour flows on to the next event by itself (pause with Space). Playback speed and the event pins (year markers) are in the control bar.
   Honesty rules: every record field is shown as compiled; paths are ILLUSTRATIVE scenarios on the DEM (the records contain no path),
   except Batura 1974, which plays the NGT model reconstruction unchanged. Weather in the scene is atmosphere only; documented
   conditions are quoted from the record. */
"use strict";

const HistTour = (() => {
  const BATURA = "/static/history/batura_1974/";
  const TIER = { A: "Coordinates in the record", B: "Place found in OpenStreetMap", C: "Nearest named place", D: "Valley / district only", E: "Not located" };
  const CONF = { high: "#34d399", medium: "#fbbf24", low: "#f87171", "very low": "#f87171", model: "#a78bfa" };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const SPEEDS = [0.5, 0.75, 1, 1.5, 2, 3];
  const DWELL = 4200;                   // ms the record stays on screen before the tour moves on (at 1x)
  const D2R = Math.PI / 180;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n, d = 0) => n == null || n === "" || isNaN(n) ? "—" : (+n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fdate = s => { if (!s) return ""; const p = s.split("-"); return p.length === 1 ? p[0] : p.length === 2 ? `${MON[+p[1] - 1]} ${p[0]}` : `${+p[2]} ${MON[+p[1] - 1]} ${p[0]}`; };
  const dateOf = p => p.date ? fdate(p.date) : p.date_start ? (p.date_end && p.date_end !== p.date_start ? `${fdate(p.date_start)} – ${fdate(p.date_end)}` : fdate(p.date_start)) : "Date unknown";
  const sortKey = p => p.date_start || p.date || "9999";
  const year = p => (sortKey(p) || "").slice(0, 4);
  const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem("ht-" + k); localStorage.setItem("ht-" + k, v); } catch { /* storage off */ } return null; };

  // Control-bar icons (24 px grid, drawn in currentColor).
  const SVG = b => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
  const IC = {
    prev: SVG('<path d="M6.5 5.5v13"/><path d="M18 6.2v11.6L9.6 12z" fill="currentColor" stroke="none"/>'),
    next: SVG('<path d="M17.5 5.5v13"/><path d="M6 6.2v11.6l8.4-5.8z" fill="currentColor" stroke="none"/>'),
    play: SVG('<path d="M8.5 5.6v12.8L19 12z" fill="currentColor" stroke="none"/>'),
    pause: SVG('<rect x="6.6" y="5.5" width="3.6" height="13" rx="1.1" fill="currentColor" stroke="none"/><rect x="13.8" y="5.5" width="3.6" height="13" rx="1.1" fill="currentColor" stroke="none"/>'),
    replay: SVG('<path d="M4.8 12a7.2 7.2 0 1 0 2.2-5.2"/><path d="M4.6 4.6v4.3h4.3"/>'),
    speed: SVG('<path d="M4.2 16.8a8.4 8.4 0 1 1 15.6 0"/><path d="M7.1 9.6l.9.7M12 6.2v1.1M16.9 9.6l-.9.7M5.6 13.6h1.1M17.3 13.6h1.1" stroke-width="1.5"/>'
      + '<g class="ht-needle"><path d="M12 14.6 12 8.6" stroke-width="2"/></g><circle cx="12" cy="14.6" r="1.9" fill="currentColor" stroke="none"/>'),
    pins: SVG('<circle class="ht-ring" cx="12" cy="10.2" r="8.6" stroke-width="1.2"/><path d="M12 20.6s-5.6-5-5.6-9.6a5.6 5.6 0 0 1 11.2 0c0 4.6-5.6 9.6-5.6 9.6z"/>'
      + '<circle cx="12" cy="11" r="2" fill="currentColor" stroke="none"/>'),
  };

  let el = null, map = null, gl = null, engine = "", data = null, stops = [], allStops = null, cur = -1, ctl = null, tok = 0, paused = false, touring = false;
  let adv = null, markers = [], wx = null, keyH = null, downH = null, ended = false, speed = 1;
  let pinsOn = false, evMarks = [], focusRec = null, dcRaf = 0;
  // Built once, kept alive and only ever hidden/shown after that (user: no loading time): the DOM, the MapLibre/Mapbox map, its
  // terrain and tiles all persist across open()/close(), so after the first build every open is instant. `visible` (not `el`)
  // is the "is the tour on screen" flag; `warm()` runs the whole build ahead of time, in the background, before the user ever opens it.
  let visible = false, buildFailed = false, buildPromise = null;
  // ------------------------------------------------------------ data
  async function load() {
    if (data) return data;
    const [ev, csv, feats, ext] = await Promise.all([
      fetch("/api/history/events").then(r => r.json()),
      fetch(BATURA + "3d/avalanche_path_with_time.csv").then(r => r.ok ? r.text() : "").catch(() => ""),
      fetch(BATURA + "3d/avalanche_features.geojson").then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] })),
      fetch(BATURA + "summit_extension.json").then(r => r.ok ? r.json() : null).catch(() => null)]);
    if (!ev.available) throw new Error(ev.message || "historical events not built");
    const recs = ev.features.map(f => ({ ...f.properties, geom: f.geometry && f.geometry.coordinates }));
    // Batura 1974: the NGT model reconstruction (path, times and speeds unchanged), shown as its own kind of event.
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
      // Start at the peak above the model's release (user request): the illustrative extension (summit_extension.json, built by
      // scripts/build_history_events.py) runs first; the model's own points, times and speeds follow unchanged, only shifted in time.
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
    }
    recs.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    data = { recs, meta: ev.metadata || {} };
    stops = recs.filter(r => r.anim);
    return data;
  }

  // ------------------------------------------------------------ build (once), open / close (show / hide)
  // The DOM, the map, its terrain source and its tiles are expensive to build but cheap to keep: built once by ensureBuilt(),
  // then only ever hidden (close) or shown (open) again, so after the first build there is no loading screen, ever.
  // warm() runs ensureBuilt() ahead of time, in the background, so even the very first open is already warm by the time it happens.
  function ensureBuilt() {
    if (el && !buildFailed) return Promise.resolve();
    if (buildPromise) return buildPromise;
    if (buildFailed) { el.remove(); el = null; buildFailed = false; }
    buildPromise = (async () => {
      el = document.createElement("div"); el.className = "ht"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Historic avalanche tour");
      el.innerHTML = `
      <div class="ht-map" id="ht-map"></div><canvas class="ht-wx" aria-hidden="true"></canvas><div class="ht-vig" aria-hidden="true"></div>
      <div class="ht-bars" aria-hidden="true"><i></i><i></i></div>
      <header class="ht-top">
        ${window.HOME_BTN || ""}<button type="button" class="ht-exit" title="Close the tour (Esc)">← Historical Overview</button>
        <div class="ht-brand"><b>Historic avalanche tour</b><span>Pakistan · compiled records 1974–2026 · illustrative scenarios on real terrain</span></div>
        <div class="ht-tools"><button type="button" class="ht-3d" title="3D Cinematic Tour" aria-label="3D Cinematic Tour"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 19.5 9 8.5l3.6 6 2.4-3.8 6.5 8.8z"/><path d="M7.2 11.6 9 13l1.6-1.5"/><path d="M16.5 4.5h4v4M20.5 4.5l-3 3" stroke-width="1.5"/></svg></button><button type="button" class="ht-overview" title="Show every record on the map">Event map</button>
          <button type="button" class="ht-listbtn" aria-pressed="true">Records</button><button type="button" class="ht-fs" title="Full screen">⛶</button></div>
      </header>
      <aside class="ht-list" aria-label="Historical records"><div class="ht-lh"><b>Records <em class="ht-cnt"></em></b><label><input type="checkbox" class="ht-only"> only tour events</label></div>
        <nav class="ht-jump" aria-label="Jump to a decade"></nav><div class="ht-items"></div>
        <div class="ht-lf"><span><i class="f"></i>tour event</span><span><i></i>record only</span><span><em class="sev s3">deaths</em>as reported</span></div></aside>
      <aside class="ht-rec" aria-live="polite"></aside>
      <div class="ht-cap" aria-live="polite"></div>
      <div class="ht-end" hidden></div>
      <div class="ht-start" hidden></div>
      <nav class="ht-ctl" aria-label="Tour controls">
        <button type="button" data-a="prev" data-tip="Previous event  ←" aria-label="Previous event">${IC.prev}</button>
        <button type="button" data-a="play" class="big" data-tip="Play / pause  Space" aria-label="Play or pause">${IC.play}</button>
        <button type="button" data-a="replay" data-tip="Replay this avalanche" aria-label="Replay this avalanche">${IC.replay}</button>
        <button type="button" data-a="next" data-tip="Skip to the following event  →" aria-label="Skip to the following event">${IC.next}</button>
        <div class="ht-prog"><span class="ht-pt">Tour</span><div class="ht-pb"><i></i></div></div>
        <span class="ht-sep" aria-hidden="true"></span>
        <div class="ht-spdw">
          <button type="button" class="ht-ic ht-spd" data-tip="Playback speed  − / +" aria-haspopup="true" aria-expanded="false" aria-label="Playback speed">${IC.speed}<b class="ht-spd-v"></b></button>
          <div class="ht-spd-pop" role="menu" hidden><small>Playback speed</small><div class="ht-spd-row">${SPEEDS.map(s => `<button type="button" role="menuitemradio" data-s="${s}">${s}×</button>`).join("")}</div>
            <span>Flights, avalanche and the pause between events</span></div>
        </div>
        <button type="button" class="ht-ic ht-pins" data-tip="Event pins: location and year  P" aria-pressed="false" aria-label="Show event pins">${IC.pins}</button>
      </nav>
      <div class="ht-load"><i></i><b>Loading the historical records and 3D terrain…</b></div>`;
      document.body.appendChild(el);
      const q = s => el.querySelector(s);
      q(".ht-exit").onclick = close;
      q(".ht-fs").onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => {}); };
      q(".ht-overview").onclick = () => overview(true);
      q(".ht-3d").onclick = () => open3d();
      q(".ht-listbtn").onclick = () => setList(!el.classList.contains("list-on"));
      q(".ht-only").onchange = renderList;
      el.querySelectorAll(".ht-ctl [data-a]").forEach(b => b.onclick = () => action(b.dataset.a));
      q(".ht-spd").onclick = () => speedPop(q(".ht-spd-pop").hidden);
      el.querySelectorAll(".ht-spd-row button").forEach(b => b.onclick = () => { setSpeed(+b.dataset.s); speedPop(false); });
      q(".ht-pins").onclick = () => setPins(!pinsOn);
      downH = e => { if (el && visible && !e.target.closest(".ht-spdw")) speedPop(false); };
      document.addEventListener("pointerdown", downH, true);
      keyH = e => {
        if (!el || !visible) return;
        const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
        if (e.key === "Escape") { if (!q(".ht-spd-pop").hidden) { speedPop(false); e.preventDefault(); } else if (document.fullscreenElement) return; else { e.preventDefault(); close(); } }
        else if (e.key === " " && !typing && e.target.tagName !== "BUTTON") { e.preventDefault(); action("play"); }
        else if (e.key === "ArrowRight") action("next");
        else if (e.key === "ArrowLeft") action("prev");
        else if ((e.key === "+" || e.key === "=") && !typing) stepSpeed(1);
        else if ((e.key === "-" || e.key === "_") && !typing) stepSpeed(-1);
        else if ((e.key === "p" || e.key === "P") && !typing) { if (map && data) setPins(!pinsOn); }
        else return;
        e.stopImmediatePropagation();
      };
      addEventListener("keydown", keyH, true);
      setList(innerWidth > 1100);
      try {
        await Promise.all([load(), makeMap()]);
      } catch (e) {
        console.warn("HistTour:", e);
        q(".ht-load").innerHTML = `<b>The tour could not start</b><span>${esc(e.message)}. The portal server must be running (run.bat).</span>`;
        try { map && map.remove(); } catch { /* never got that far */ } map = null;
        buildFailed = true;
        throw e;
      }
      wx = Wx(q(".ht-wx"));
      addLayers();
      q(".ht-load").classList.add("off");
    })().finally(() => { buildPromise = null; });
    return buildPromise;
  }

  // Runs the whole build in the background, before the user ever opens the tour (called once the Historical Overview tile is
  // opened, and again proactively on page idle), so by the time open() runs there is nothing left to load.
  async function warm() { try { await ensureBuilt(); } catch { /* open() will report it if the user actually opens the tour */ } }

  async function open(opt = {}) {
    const sp = +pref("speed"); speed = SPEEDS.includes(sp) ? sp : 1;
    try {
      await ensureBuilt();
    } catch (e) {
      console.warn("HistTour:", e);
      return;
    }
    if (!el) return;
    if (opt.only) { allStops = stops; stops = opt.only.map(id => stops.find(r => r.event_id === id)).filter(Boolean); }   // a chosen few (the showreel), until close()
    visible = true;
    document.body.classList.add("ht-open");
    requestAnimationFrame(() => el.classList.add("on"));
    setSpeed(speed, true);
    setList(innerWidth > 1100);
    warmAll();
    renderList();
    if (pref("pins") === "1") setPins(true);
    const f = opt.focus && data.recs.find(r => r.event_id === opt.focus);
    if (opt.tour) start(opt.at ? Math.max(0, stops.findIndex(r => r.event_id === opt.at)) : 0);
    else if (f) focus(f, false);
    else overview(false);
  }

  function close() {
    if (!el || !visible) return;
    stopRun(true); clearAdv(); tok++;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    speedPop(false);
    if (wx) wx.level(0);           // kept alive (not stopped): resuming it on the next open needs no rebuild
    if (dcRaf) cancelAnimationFrame(dcRaf); dcRaf = 0;
    markers.forEach(m => m.remove()); markers = [];
    if (pinsOn) { ["ht-pt", "ht-pt-halo"].forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible"); }); el.classList.remove("pins-on"); }
    const pb = el.querySelector(".ht-pins"); if (pb) { pb.setAttribute("aria-pressed", false); pb.setAttribute("aria-label", "Show event pins"); }
    evMarks.forEach(m => m.mk.remove()); evMarks = []; pinsOn = false; focusRec = null;
    cur = -1; paused = false; touring = false;
    if (allStops) { stops = allStops; allStops = null; }
    visible = false;
    el.classList.remove("on");
    document.body.classList.remove("ht-open");
  }

  // ------------------------------------------------------------ playback speed
  function speedPop(on) {
    const p = el && el.querySelector(".ht-spd-pop"); if (!p) return;
    p.hidden = !on; el.querySelector(".ht-spd").setAttribute("aria-expanded", on);
  }
  function stepSpeed(d) { const i = SPEEDS.indexOf(speed); setSpeed(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + d))]); }
  function setSpeed(s, quiet) {
    const old = speed; speed = SPEEDS.includes(s) ? s : 1;
    if (!quiet) pref("speed", speed);
    const b = el.querySelector(".ht-spd"), i = SPEEDS.indexOf(speed);
    b.querySelector(".ht-spd-v").textContent = `${speed}×`;
    b.style.setProperty("--needle", `${-70 + 140 * i / (SPEEDS.length - 1)}deg`);
    b.classList.toggle("fast", speed > 1); b.classList.toggle("slow", speed < 1);
    el.querySelectorAll(".ht-spd-row button").forEach(x => x.setAttribute("aria-checked", +x.dataset.s === speed));
    if (ctl && ctl.speed) ctl.speed(speed);
    if (adv) { adv.left *= old / speed; adv.total *= old / speed; }
  }

  // ------------------------------------------------------------ map
  async function makeMap() {
    let L = typeof bgMap !== "undefined" && bgMap.lib ? bgMap.lib() : null;        // the home map's engine (Mapbox with a token, else MapLibre)
    if (!L) {
      if (!window.maplibregl) {
        const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/static/vendor/maplibre-gl.css"; document.head.appendChild(l);
        await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/static/vendor/maplibre-gl.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      }
      L = { gl: window.maplibregl, engine: "maplibre" };
    }
    ({ gl, engine } = L);
    if (window.MapPerf) MapPerf.tune(gl);
    const style = engine === "mapbox" ? "mapbox://styles/mapbox/satellite-v9" : { version: 8,
      sources: { sat: { type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
      layers: [{ id: "sat", type: "raster", source: "sat" }] };
    const o = { container: "ht-map", style, bounds: [[69.5, 33.2], [78.2, 37.3]], fitBoundsOptions: { padding: 60 }, pitch: 0, maxPitch: 80, attributionControl: false, fadeDuration: 0 };
    // High-detail rendering for the tour (user request): full screen pixel density (up to 2x) and a larger in-memory tile cache so
    // flights between events and replays reuse tiles instead of reloading them. No MSAA antialias: it made the first draw ~15x slower
    // on machines without a strong GPU (measured), and the tour must never lag.
    map = new gl.Map(Object.assign(window.MapPerf ? MapPerf.opts(o) : o,
      { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), maxTileCacheSize: 3000 }));
    map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new gl.NavigationControl({ visualizePitch: true }), "bottom-right");
    await new Promise((res, rej) => {
      map.once("load", res);
      map.on("error", ev => { const s = ev.error && ev.error.status; if (!map.loaded() && (s === 401 || s === 403)) rej(ev.error); });
    });
    map.addSource("ht-dem", window.MapPerf ? MapPerf.dem() : { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12, tiles: [location.origin + "/api/dem/{z}/{x}/{y}.png?v=cop1"] });
    // Terrain detail: on Mapbox, Mapbox's own terrain DEM (to zoom 14; sharper ridges, gullies and faces than the portal's
    // 30 m zoom-12 tiles, used live, not stored). MapLibre keeps the portal's tiles. The avalanche engine's own heights still
    // come from the portal DEM; everything it draws is placed with the map's rendered terrain, so it stays on the slope.
    let demSrc = "ht-dem";
    if (engine === "mapbox") {
      try { map.addSource("ht-dem-hd", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 }); demSrc = "ht-dem-hd"; }
      catch { /* keep the portal DEM */ }
    }
    map.setTerrain({ source: demSrc, exaggeration: 1.2 });
    // faint relief shading from the same terrain: small ridges and gullies read crisply, without looking painted
    try {
      // a source of its own: Mapbox renders terrain and hillshade from one raster-dem source badly (it warns about it)
      if (demSrc === "ht-dem-hd") map.addSource("ht-dem-shade", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
      else map.addSource("ht-dem-shade", window.MapPerf ? MapPerf.dem() : { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12, tiles: [location.origin + "/api/dem/{z}/{x}/{y}.png?v=cop1"] });
      map.addLayer({ id: "ht-relief", type: "hillshade", source: "ht-dem-shade", paint: { "hillshade-exaggeration": 0.22, "hillshade-illumination-direction": 315,
        "hillshade-shadow-color": "rgba(20,24,30,0.55)", "hillshade-highlight-color": "rgba(255,255,255,0.12)", "hillshade-accent-color": "rgba(20,24,30,0.25)" } });
    } catch { /* engine without hillshade */ }
    // Under the imagery: the average colour of these mountains, so a tile still loading reads as distant ground, never black.
    try {
      const first = (map.getStyle().layers || [])[0];
      map.addLayer({ id: "ht-ground", type: "background", paint: { "background-color": "#5a5a4c" } }, first && first.id);
    } catch { /* style without layers */ }
    // atmospheric depth: blue-grey high-altitude haze (documentary grade); no stars, no neon
    try {
      if (engine === "mapbox") map.setFog({ range: [0.8, 7], color: "rgb(176,192,214)", "high-color": "rgb(54,84,128)", "horizon-blend": 0.09, "space-color": "rgb(92,120,158)", "star-intensity": 0 });   // daytime sky above the horizon, not black
      else if (map.setSky) map.setSky({ "sky-color": "#3b5b86", "horizon-color": "#b8c7da", "fog-color": "#b0c0d6", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.2 });
    } catch { /* engine without fog */ }
    map.on("dragstart", () => holdAdv(true));          // the user is looking around: the tour waits
    map.on("move", declutter);
  }

  function addLayers() {
    const ok = data.recs.filter(r => r.geom);
    const pts = ok.filter(r => "ABC".includes(r.loc.tier)), areas = ok.filter(r => r.loc.tier === "D");
    const feat = (r, g) => ({ type: "Feature", properties: { id: r.event_id, tour: r.anim ? 1 : 0, tier: r.loc.tier }, geometry: g });
    const circle = ([lo, la], km) => { const c = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * 2 * Math.PI; c.push([lo + Math.cos(a) * km / (111.32 * Math.cos(la * D2R)), la + Math.sin(a) * km / 110.57]); } return c; };
    map.addSource("ht-area", { type: "geojson", data: { type: "FeatureCollection", features: areas.map(r => feat(r, { type: "Polygon", coordinates: [circle(r.geom, 14)] })) } });
    map.addLayer({ id: "ht-area", type: "fill", source: "ht-area", paint: { "fill-color": "#94a3b8", "fill-opacity": 0.08 } });
    map.addLayer({ id: "ht-area-l", type: "line", source: "ht-area", paint: { "line-color": "#cbd5e1", "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [2, 2] } });
    map.addSource("ht-pt", { type: "geojson", data: { type: "FeatureCollection", features: pts.map(r => feat(r, { type: "Point", coordinates: r.geom })) } });
    map.addLayer({ id: "ht-pt-halo", type: "circle", source: "ht-pt", filter: ["==", ["get", "tour"], 1],
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 10, 16], "circle-color": "#ef4444", "circle-opacity": 0.28, "circle-blur": 0.6, "circle-pitch-alignment": "map" } });
    map.addLayer({ id: "ht-pt", type: "circle", source: "ht-pt",
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["==", ["get", "tour"], 1], 5, 3.5], 10, 7],
        "circle-color": ["case", ["==", ["get", "tour"], 1], "#ef4444", "#3b0a10"], "circle-stroke-color": ["case", ["==", ["get", "tour"], 1], "#fee2e2", "#dc2626"],
        "circle-stroke-width": 1.6 } });
    ["ht-pt", "ht-area"].forEach(id => {
      map.on("click", id, e => { const f = e.features && e.features[0]; const r = f && data.recs.find(x => x.event_id === f.properties.id); if (r) { stopTour(); focus(r, true); } });
      map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
    });
  }

  // ------------------------------------------------------------ event pins (location + year of every placed record)
  const pinKind = r => r.model ? "model reference point" : r.loc.tier === "D" ? "approximate area" : "documented place";
  function setPins(on) {
    if (!map || !data) return;
    pinsOn = on; pref("pins", on ? "1" : "0");
    const b = el.querySelector(".ht-pins"); b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", on ? "Hide event pins" : "Show event pins");
    el.classList.toggle("pins-on", on);
    evMarks.forEach(m => m.mk.remove()); evMarks = [];
    ["ht-pt", "ht-pt-halo"].forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "none" : "visible"); });
    if (on) {
      const recs = data.recs.filter(r => r.geom), step = Math.min(70, 1500 / Math.max(1, recs.length));
      recs.forEach((r, i) => {
        const d = document.createElement("button"); d.type = "button";
        d.className = `ht-ev${r.anim ? " tour" : ""}${r.model ? " model" : ""}${r.loc.tier === "D" ? " area" : ""}`;
        d.style.setProperty("--d", `${Math.round(i * step)}ms`);
        d.setAttribute("aria-label", `${dateOf(r)}, ${r.location}`);
        const dz = deaths(r) || (r.model ? "model reconstruction" : "deaths not stated");
        d.innerHTML = `<i class="ht-ev-pulse"></i><i class="ht-ev-dot"></i>
          <span class="ht-ev-y"><b>${esc(year(r) || "?")}</b><em>${esc(pinKind(r))}</em></span>
          <span class="ht-ev-card"><small>${esc(dateOf(r))}${r.anim ? ` · <i>❄ ${r.model ? "model" : "scenario"}</i>` : ""}</small><b>${esc(r.location)}</b>
            <em>${esc(dz)}</em><span>${esc(r.region || "")}${r.region ? " · " : ""}${esc(pinKind(r))}</span></span>`;
        d.onclick = e => { e.stopPropagation(); stopTour(); focus(r, true); };
        evMarks.push({ r, el: d, mk: new gl.Marker({ element: d, anchor: "center" }).setLngLat(r.geom).addTo(map) });
      });
    }
    placePin(focusRec); markCur(); declutter();
  }
  function markCur() { evMarks.forEach(m => m.el.classList.toggle("cur", m.r === focusRec)); }
  // Year labels that would overlap a more important one fold away to a dot (hover still opens them).
  function declutter() {
    if (dcRaf || !pinsOn || !evMarks.length) return;
    dcRaf = requestAnimationFrame(() => {
      dcRaf = 0; if (!map) return;
      const rank = m => (m.r === focusRec ? 1e6 : 0) + (m.r.anim ? 1e4 : 0) + (+m.r.deaths || 0), placed = [];
      for (const m of evMarks.slice().sort((a, b) => rank(b) - rank(a))) {
        const p = map.project(m.r.geom), w = m.r === focusRec ? 120 : 22, bx = [p.x - w, p.y - 34, p.x + w, p.y - 10];
        const hit = placed.some(q => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1]);
        m.el.classList.toggle("tuck", hit); if (!hit) placed.push(bx);
      }
    });
  }

  // ------------------------------------------------------------ panels
  function setList(on) { el.classList.toggle("list-on", on); el.querySelector(".ht-listbtn").setAttribute("aria-pressed", on); }
  const tierBadge = r => `<span class="ht-tier t${r.loc.tier}" title="${esc(TIER[r.loc.tier])}">${r.loc.tier} · ${esc(TIER[r.loc.tier])}</span>`;
  const confBadge = c => `<span class="ht-conf" style="--c:${CONF[(c || "").toLowerCase()] || "#94a3b8"}">${c === "model" ? "model reconstruction" : "confidence " + esc(c || "—")}</span>`;
  const kindBadge = r => r.model ? '<span class="ht-kind model">Model reconstruction · NGT</span>'
    : r.anim ? '<span class="ht-kind ill">Illustrative scenario on real terrain</span>' : '<span class="ht-kind none">Record only · no animation</span>';
  const deaths = r => r.deaths === "" || r.deaths == null ? "" : `${r.deaths} ${+r.deaths === 1 ? "death" : "deaths"} reported`;
  const deathsTxt = r => r.deaths === "" || r.deaths == null ? (r.model ? "not part of the model" : "not stated") : `${r.deaths}`;

  // Each decade has one colour, used by the list, its jump bar and the record panel's timeline.
  const DEC = { 1970: "#a78bfa", 1980: "#60a5fa", 1990: "#22d3ee", 2000: "#34d399", 2010: "#fbbf24", 2020: "#fb7185" };
  const decOf = r => { const y = +year(r); return y > 1900 ? Math.floor(y / 10) * 10 : 0; };
  const decCol = d => DEC[d] || "#94a3b8";
  const sev = n => n >= 20 ? 3 : n >= 5 ? 2 : n > 0 ? 1 : 0;

  function renderList() {
    if (!el || !data) return;
    const only = el.querySelector(".ht-only").checked, box = el.querySelector(".ht-items"), recs = data.recs.filter(r => !only || r.anim), groups = [];
    recs.forEach(r => { const d = decOf(r); let g = groups[groups.length - 1]; if (!g || g.d !== d) groups.push(g = { d, recs: [] }); g.recs.push(r); });
    el.querySelector(".ht-cnt").textContent = recs.length;
    const item = r => {
      const n = +r.deaths || 0;
      return `<button type="button" class="ht-item${r.anim ? " tour" : ""}${r === focusRec ? " cur" : ""}" data-id="${esc(r.event_id)}"><i class="ht-i-dot" aria-hidden="true"></i>
        <span class="ht-i-d">${esc(dateOf(r))}${r.anim ? `<i class="pl">${r.model ? "◆ model" : "▶ scenario"}</i>` : ""}</span><b>${esc(r.location)}</b>
        <span class="ht-i-m">${n ? `<em class="sev s${sev(n)}">${fmt(n)} ${n === 1 ? "death" : "deaths"}</em>` : `<em class="sev s0">${r.model ? "model reconstruction" : "deaths not stated"}</em>`}
          ${r.region ? `<span>${esc(r.region)}</span>` : ""}<i class="tier t${r.loc.tier}" title="Location: ${esc(TIER[r.loc.tier])}">${r.loc.tier}</i></span></button>`;
    };
    box.innerHTML = groups.map(g => {
      const nt = g.recs.filter(r => r.anim).length;
      return `<section class="ht-grp" style="--dc:${decCol(g.d)}" data-d="${g.d}"><div class="ht-dec"><b>${g.d ? g.d + "s" : "Undated"}</b>
        <span>${g.recs.length} record${g.recs.length > 1 ? "s" : ""}${nt ? ` · ${nt} on tour` : ""}</span></div>${g.recs.map(item).join("")}</section>`;
    }).join("");
    const jump = el.querySelector(".ht-jump");
    jump.innerHTML = groups.map(g => `<button type="button" data-d="${g.d}" style="--dc:${decCol(g.d)}" title="${g.d ? g.d + "s" : "Undated"}">${g.d ? `’${String(g.d).slice(2)}s` : "?"}<em>${g.recs.length}</em></button>`).join("");
    jump.querySelectorAll("button").forEach(b => b.onclick = () => { const s = box.querySelector(`.ht-grp[data-d="${b.dataset.d}"]`); if (s) box.scrollTo({ top: s.offsetTop - box.offsetTop, behavior: reduce() ? "auto" : "smooth" }); });
    const spy = () => {
      let on = null; box.querySelectorAll(".ht-grp").forEach(s => { if (s.offsetTop - box.offsetTop <= box.scrollTop + 8) on = s.dataset.d; });
      jump.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.d === (on ?? (groups[0] && String(groups[0].d)))));
    };
    box.onscroll = spy; spy();
    box.querySelectorAll(".ht-item").forEach(b => b.onclick = () => { const r = data.recs.find(x => x.event_id === b.dataset.id); stopTour(); focus(r, true); });
    const c = box.querySelector(".cur"); if (c) c.scrollIntoView({ block: "nearest" });
  }

  // ---- record panel: hero, stat tiles, timeline of every record, tabbed details
  const CONFN = { high: 3, medium: 2, low: 1, "very low": 1 };
  const TIERN = { A: 5, B: 4, C: 3, D: 2, E: 1 }, TIERC = { A: "#86efac", B: "#7dd3fc", C: "#fcd34d", D: "#cbd5e1", E: "#94a3b8" };
  const meter = (n, of, col) => `<span class="rc-meter" style="--c:${col}">${Array.from({ length: of }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;
  let tab = "overview", recShown = null;

  // Every dated record on one axis; same-year records stack. Hover reads it in the header, click opens it.
  function timeline(r) {
    const dated = data.recs.filter(x => +year(x) > 1900), ys = dated.map(x => +year(x));
    const y0 = Math.floor(Math.min(...ys) / 10) * 10, y1 = Math.ceil((Math.max(...ys) + 1) / 10) * 10, pos = y => ((y - y0) / (y1 - y0) * 100).toFixed(2);
    const ticks = [], bands = [];
    for (let y = y0; y <= y1; y += 10) {
      ticks.push(`<span style="left:${pos(y)}%">’${String(y).slice(2)}</span>`);
      if (y < y1) bands.push(`<i class="rc-band" style="left:${pos(y)}%;width:${(1000 / (y1 - y0)).toFixed(2)}%;--dc:${decCol(y)}"></i>`);
    }
    const cnt = {};
    const dots = dated.map(x => { const y = +year(x), k = cnt[y] = (cnt[y] || 0) + 1;
      return `<button type="button" class="rc-td${x.anim ? " tour" : ""}${x === r ? " cur" : ""}" style="left:${pos(y + 0.5)}%;--k:${k - 1};--dc:${decCol(decOf(x))}" data-id="${esc(x.event_id)}" aria-label="${esc(dateOf(x) + ", " + x.location)}"></button>`; }).join("");
    const head = r ? `${year(r)} · event ${dated.indexOf(r) + 1} of ${dated.length}` : `${dated.length} dated records · point at a dot`;
    const st = Math.min(8, 26 / Math.max(1, Math.max(...Object.values(cnt)) - 1));      // the tallest same-year stack fits the track
    return `<div class="rc-tl"><div class="rc-tl-h"><b>Timeline</b><span data-def="${esc(head)}">${esc(head)}</span></div>
      <div class="rc-tl-tr" style="--st:${st.toFixed(2)}px">${bands.join("")}${dots}</div><div class="rc-tl-x">${ticks.join("")}</div></div>`;
  }
  function wireTimeline(box) {
    const h = box.querySelector(".rc-tl-h span");
    box.querySelectorAll(".rc-td").forEach(b => {
      const x = data.recs.find(q => q.event_id === b.dataset.id);
      b.onmouseenter = b.onfocus = () => { h.textContent = `${dateOf(x)} · ${x.location}${deaths(x) ? " · " + deaths(x) : ""}`; h.classList.add("hot"); };
      b.onmouseleave = b.onblur = () => { h.textContent = h.dataset.def; h.classList.remove("hot"); };
      b.onclick = () => { if (x === focusRec) return; stopTour(); focus(x, true); };
    });
  }
  function countUp(box) {
    box.querySelectorAll(".cu[data-v]").forEach(cu => {
      const v = +cu.dataset.v; if (!v) return;
      if (reduce()) { cu.textContent = fmt(v); return; }
      const t0 = performance.now(), st = now => { const k = Math.min(1, (now - t0) / 1100); cu.textContent = fmt(Math.round(v * (1 - Math.pow(1 - k, 3)))); if (k < 1 && el) requestAnimationFrame(st); };
      requestAnimationFrame(st);
    });
  }

  function renderRecord(r) {
    const a = r.anim, box = el.querySelector(".ht-rec"), osm = r.loc.osm ? `https://www.openstreetmap.org/${r.loc.osm}` : null;
    const srcs = String(r.sources || "").split(/;\s*/).filter(Boolean), fresh = recShown !== r; recShown = r;
    const conf = (r.confidence || "").toLowerCase(), cc = CONF[conf] || "#94a3b8", noDeaths = r.deaths === "" || r.deaths == null;
    const tabs = [["overview", "Overview"], ...(a ? [["scenario", r.model ? "Model" : "Scenario"]] : []), ["location", "Location"], ["sources", `Sources${srcs.length ? `<em>${srcs.length}</em>` : ""}`]];
    if (!tabs.some(t => t[0] === tab)) tab = "overview";
    const how = a ? (r.model ? (a.extended ? `The tour starts this avalanche at the peak above (${fmt(a.extended.peak_z)} m) with an illustrative sliding-block run down to the model's release point (${fmt(a.model_release_z)} m). From there: the NGT notebook's model outputs (path, times, speeds), copied unchanged; not an observation.`
        : "Release point, path, times and speeds are the NGT notebook's model outputs, copied unchanged; not an observation.")
      : `Not the recorded path: the records give no path. A release on a steep (28–55°) high slope ${a.mode === "band" ? "at the elevation given in the record" : "above the documented place"} was found on the portal DEM (Copernicus GLO-30, ~30 m) and a sliding block with textbook Voellmy friction (μ 0.20, ξh 4,000 m/s², not calibrated) was run down the real terrain${a.place_dist_m != null ? `; it passes ${fmt(a.place_dist_m)} m from the documented place` : ""}.`) : "";
    const pane = {
      overview: () => `
        <dl class="rc-kv"><div><dt>Event type</dt><dd>${esc(r.event_type || "—")}</dd></div><div><dt>Who was affected</dt><dd>${esc(r.who_affected || "—")}</dd></div>
          ${a ? "" : `<div><dt>Animation</dt><dd class="muted">${esc(r.anim_reason || "No animation.")}</dd></div>`}</dl>
        <div class="rc-q${r.weather_context ? "" : " none"}"><i aria-hidden="true">❄</i><div><b>Documented conditions</b>
          <p>${r.weather_context ? esc(r.weather_context) : "None recorded. Snow and wind in the scene are atmosphere only."}</p></div></div>
        ${r.context_notes ? `<div class="rc-note"><b>Notes in the record</b><p class="clamp">${esc(r.context_notes)}</p><button type="button" class="rc-more" hidden>Show more</button></div>` : ""}`,
      scenario: () => `
        <div class="rc-sim">
          ${recordZ(r, a) ? `<div><small>Struck (record)</small><b>${fmt(recordZ(r, a))}<em>m</em></b><span>about, as recorded</span></div>` : ""}
          <div><small>${recordZ(r, a) ? "Start · illustrative" : "Release"}</small><b>${fmt(a.release.z)}<em>m</em></b><span>${a.release.slope_deg ? `${fmt(a.release.slope_deg)}° slope` : "elevation"}</span></div>
          <div><small>Path length</small><b>${fmt(a.length_m)}<em>m</em></b><span>${fmt(a.length_m / 1000, 1)} km run</span></div>
          <div><small>Vertical drop</small><b>${fmt(a.drop_m)}<em>m</em></b><span>${fmt(a.release.z)} → ${fmt(a.release.z - a.drop_m)} m</span></div>
          <div class="pk"><small>Peak speed</small><b>${fmt(a.vmax_ms)}<em>m/s</em></b><span>${fmt(a.vmax_ms * 3.6)} km/h</span><i style="--v:${Math.min(1, a.vmax_ms / 80).toFixed(3)}"></i></div>
        </div>
        <details class="rc-how"><summary>How this ${r.model ? "reconstruction" : "scenario"} was made</summary><p>${how}</p></details>`,
      location: () => `
        <div class="rc-lq" style="--c:${TIERC[r.loc.tier] || "#94a3b8"}"><div><small>Location quality</small><b>${r.loc.tier} · ${esc(TIER[r.loc.tier])}</b></div>${meter(TIERN[r.loc.tier] || 0, 5, TIERC[r.loc.tier] || "#94a3b8")}</div>
        <p class="rc-p">${esc(r.loc.note)}</p>
        ${r.geom ? `<div class="rc-co"><span>${r.geom[1].toFixed(4)}° N · ${r.geom[0].toFixed(4)}° E</span>${osm ? `<a href="${osm}" target="_blank" rel="noopener">OpenStreetMap ↗</a>` : ""}</div>` : ""}`,
      sources: () => `<ol class="rc-src">${srcs.map(s => `<li>${esc(s)}</li>`).join("") || "<li>—</li>"}</ol>`,
    };
    const ti = tabs.findIndex(t => t[0] === tab);
    box.innerHTML = `
      <div class="rc-hero">
        <div class="ht-r-eb"><span>${esc(r.event_id)}</span>${kindBadge(r)}</div>
        <h3>${esc(r.location)}</h3>
        <div class="rc-meta"><span>${esc(dateOf(r))}</span>${r.region ? `<span>${esc(r.region)}</span>` : ""}${r.elevation_m ? `<span>${esc(r.elevation_m)} m</span>` : ""}</div>
        ${r.date_precision ? `<div class="rc-prec">${esc(r.date_precision)}</div>` : ""}
      </div>
      <div class="rc-stats">
        <div class="d"><b class="cu" data-v="${noDeaths ? 0 : +r.deaths || 0}">${noDeaths ? "—" : fresh && !reduce() && +r.deaths ? "0" : fmt(+r.deaths || 0)}</b><small>${noDeaths ? `deaths · ${esc(deathsTxt(r))}` : +r.deaths === 1 ? "death reported" : "deaths reported"}</small></div>
        <div><b>${esc(r.injured || "—")}</b><small>injured</small></div>
        <div><b style="color:${cc}">${r.model ? "model" : esc(r.confidence || "—")}</b><small>confidence</small>${r.model ? "" : meter(CONFN[conf] || 0, 3, cc)}</div>
      </div>
      ${timeline(r)}
      <div class="rc-tabs" role="tablist" style="--n:${tabs.length};--i:${ti}">${tabs.map(([k, l]) => `<button type="button" role="tab" data-t="${k}" aria-selected="${k === tab}">${l}</button>`).join("")}<i aria-hidden="true"></i></div>
      <div class="rc-pane" role="tabpanel">${pane[tab]()}</div>
      <div class="rc-act">
        ${a ? `<button type="button" class="ht-r-play">▶ ${stops.indexOf(r) === cur && ctl ? "Replay" : "Play"} the ${r.model ? "reconstruction" : "scenario"}</button>` : ""}
        ${r.model ? '<button type="button" class="ht-r-open">Open the full Batura reconstruction →</button>' : ""}
      </div>`;
    if (fresh) box.scrollTop = 0;
    const wirePane = p => {
      const n = p.querySelector(".rc-note p"), mb = p.querySelector(".rc-more");
      if (n && mb && n.scrollHeight > n.clientHeight + 2) { mb.hidden = false; mb.onclick = () => { const open = n.classList.toggle("clamp"); mb.textContent = open ? "Show more" : "Show less"; }; }
    };
    wirePane(box.querySelector(".rc-pane"));
    box.querySelectorAll(".rc-tabs button").forEach((b, i) => b.onclick = () => {
      if (b.dataset.t === tab) return;
      tab = b.dataset.t;
      box.querySelectorAll(".rc-tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
      box.querySelector(".rc-tabs").style.setProperty("--i", i);
      const old = box.querySelector(".rc-pane"), np = old.cloneNode(false); np.innerHTML = pane[tab](); old.replaceWith(np); wirePane(np);
    });
    wireTimeline(box);
    if (fresh) countUp(box);
    const pb = box.querySelector(".ht-r-play"); if (pb) pb.onclick = () => start(stops.indexOf(r), false);
    const ob = box.querySelector(".ht-r-open"); if (ob) ob.onclick = () => { close(); if (typeof openEvent === "function") openEvent("batura_1974"); };
  }

  function caption(r, i) {
    const c = el.querySelector(".ht-cap");
    if (!r) { c.classList.remove("on"); return; }
    c.innerHTML = `<small>${i != null ? `Event ${String(i + 1).padStart(2, "0")} / ${stops.length} · ` : ""}${esc(dateOf(r))}</small>
      <b>${esc(r.location)}</b><span>${esc(r.region || "")}${deaths(r) ? ` · ${esc(deaths(r))}` : ""} · ${r.model ? "model reconstruction" : r.anim ? "illustrative scenario on real terrain"
        : r.geom ? "historical record · no animation" : "historical record · location not known"}</span>`;
    c.classList.remove("on"); void c.offsetWidth; c.classList.add("on");
  }

  function progress() {
    const p = el.querySelector(".ht-prog");
    p.querySelector(".ht-pt").textContent = cur >= 0 ? `Event ${cur + 1} of ${stops.length}` : `${stops.length} avalanches · ${data.recs.filter(r => !r.model).length} records`;
    p.querySelector("i").style.width = cur >= 0 ? `${(cur + 1) / stops.length * 100}%` : "0";
    const playing = (ctl && !paused && !ended && ctl.running()) || (adv && !adv.held);
    const b = el.querySelector('[data-a="play"]'); b.innerHTML = playing ? IC.pause : IC.play; b.classList.toggle("on", !!playing);
  }

  // ------------------------------------------------------------ camera helpers
  const padding = () => innerWidth > 1100 ? { top: 90, bottom: 120, left: el.classList.contains("list-on") ? 360 : 40, right: 420 } : { top: 70, bottom: 150, left: 20, right: 20 };
  function establish(a, first) {
    const p = a.path, r = p[0], e = p[p.length - 1], m = p[Math.floor(p.length * 0.4)];
    const dx = (e[0] - r[0]) * Math.cos(r[1] * D2R), dy = e[1] - r[1], down = Math.atan2(dx, dy) / D2R;
    const L = Math.max(600, a.length_m || 1000), z = Math.max(10.6, Math.min(12.8, 13.4 - Math.log2(L / 1000) * 0.9));
    return { camera: { center: [m[0], m[1]], zoom: z - 0.9, pitch: 74, bearing: down + 180 - 34 }, ms: reduce() ? 0 : (first ? 4200 : 3000) / speed };
  }

  // ------------------------------------------------------------ overview and single records
  function overview(fly, done) {
    stopTour(); caption(null);
    el.classList.remove("ht-cine");
    hideEnd();
    const s = el.querySelector(".ht-start");
    const compiled = data.recs.filter(r => !r.model), located = compiled.filter(r => r.geom).length;
    const ys = data.recs.map(r => +year(r)).filter(y => y > 1900), span = `${Math.min(...ys)}–${Math.max(...ys)}`;
    const choose = `<div class="ht-s-btn"><button type="button" class="go">${done ? "↻ Replay the tour" : "▶ Start the guided tour"} · ${stops.length} avalanches</button>
        <button type="button" class="ghost">Explore the map</button></div>`;
    s.innerHTML = done ? `<small>Tour complete</small><h2>${stops.length} avalanches replayed</h2>
      <p>Every located snow / ice avalanche replayed on the real terrain, and the NGT model reconstruction of Batura 1974. All ${compiled.length} records, including those
      without an animation, stay on the event map and in the records list.</p>
      ${choose}
      <p class="fine">Paths are illustrative scenarios placed by terrain analysis, not recorded paths. Casualty figures are as reported. Not a forecast or warning.</p>`
      : `<small>Signature experience</small><h2>Historic avalanches of northern Pakistan</h2>
      <p>${compiled.length} records compiled from news archives, the HiAVAL database and mountaineering journals, ${span}. ${located} can be placed on the map and
      ${stops.length - 1} located snow / ice avalanches can be replayed on the real terrain where they happened, plus the NGT model reconstruction of Batura 1974.</p>
      <div class="ht-legend"><span><i class="lp tour"></i>In the tour: avalanche replayed in 3D</span><span><i class="lp"></i>Record only: on the map, not animated</span><span><i class="la"></i>Valley / district only</span></div>
      ${choose}
      <p class="fine">The tour plays the ${stops.length} animated avalanches in date order by itself. Paths are illustrative scenarios placed by terrain analysis, not recorded paths. Casualty figures are as reported. Not a forecast or warning.</p>`;
    s.hidden = false;
    s.querySelector(".go").onclick = () => start(0);
    s.querySelector(".ghost").onclick = () => { s.hidden = true; if (!pinsOn) setPins(true); };
    const box = el.querySelector(".ht-rec"), byTier = Object.keys(TIER).map(k => [k, compiled.filter(r => r.loc.tier === k).length]), tmax = Math.max(1, ...byTier.map(t => t[1]));
    const unplaced = compiled.filter(r => !r.geom);
    box.innerHTML = `
      <div class="rc-hero"><div class="ht-r-eb"><span>Event map</span></div><h3>All compiled records</h3>
        <p class="rc-lead">Click a pin, a dot on the timeline or a record in the list to open it.</p></div>
      <div class="rc-stats">
        <div class="d"><b class="cu" data-v="${compiled.length}">${reduce() ? compiled.length : 0}</b><small>compiled records</small></div>
        <div><b class="cu" data-v="${located}">${reduce() ? located : 0}</b><small>placed on map</small></div>
        <div><b class="cu" data-v="${stops.length}">${reduce() ? stops.length : 0}</b><small>animated</small></div>
      </div>
      ${timeline(null)}
      ${unplaced.length ? `<div class="rc-sec"><b>Not on the map · ${unplaced.length}</b><p class="rc-p2">No place in these records could be located, so they have no pin. Open one to read it.</p>
        ${unplaced.map(r => `<button type="button" class="rc-un" data-id="${esc(r.event_id)}"><span>${esc(dateOf(r))}</span><b>${esc(r.location)}</b>
          ${+r.deaths ? `<em class="sev s${sev(+r.deaths)}">${fmt(+r.deaths)} ${+r.deaths === 1 ? "death" : "deaths"}</em>` : ""}</button>`).join("")}</div>` : ""}
      <div class="rc-sec"><b>Location quality</b>
        ${byTier.map(([k, n]) => `<div class="rc-bar" style="--c:${TIERC[k]};--w:${(n / tmax * 100).toFixed(1)}%"><span><i>${k}</i>${esc(TIER[k])}</span><u><s></s></u><em>${n}</em></div>`).join("")}</div>
      <details class="rc-how"><summary>How the records were placed</summary>
        <p>${esc(data.meta.method || "")}</p><p>Geocoder: ${esc(data.meta.geocoder || "OpenStreetMap Nominatim")}</p></details>`;
    recShown = null; wireTimeline(box); countUp(box); box.scrollTop = 0;
    box.querySelectorAll(".rc-un").forEach(b => b.onclick = () => focus(data.recs.find(x => x.event_id === b.dataset.id), false));
    cur = -1; setFocus(null); renderList(); progress();
    const cam = map.cameraForBounds([[69.8, 33.6], [77.6, 37.0]], { padding: padding() });
    map.flyTo({ ...cam, pitch: 38, bearing: 0, duration: fly && !reduce() ? 2600 : 0, essential: true });
    if (wx) wx.level(0.12);
  }

  // The record card docks at the top of the side panel; the record details move down under it.
  function hideEnd() { el.querySelector(".ht-end").hidden = true; el.classList.remove("end-on"); }

  function focus(r, fly) {
    el.querySelector(".ht-start").hidden = true; hideEnd();
    const i = stops.indexOf(r); cur = i;
    renderRecord(r); renderList(); progress(); caption(r, i >= 0 ? i : null); setFocus(r);
    if (r.anim) {
      snowFor(r);
      const est = establish(r.anim, false);
      map.flyTo({ ...est.camera, duration: fly && !reduce() ? 2600 : 0, essential: true, padding: padding() });
    } else if (r.geom) map.flyTo({ center: r.geom, zoom: r.loc.tier === "D" ? 8.6 : 11.2, pitch: 60, bearing: 0, duration: fly && !reduce() ? 2400 : 0, essential: true, padding: padding() });
    if (wx) wx.level(0.18);
  }

  // Warm every event in the background (user: no loading time): each path's portal terrain (start, middle, end) for the avalanche
  // engine, one after another and only when the browser is idle, so the first event is never slowed. The service worker keeps the
  // tiles (static/sw.js), so the next visit is instant too.
  function warmAll() {
    if (!window.Avalanche || !Avalanche.prefetch || !stops.length) return;
    const pts = [];
    stops.forEach(r => { const p = r.anim.path; [p[0], p[Math.floor(p.length / 2)], p[p.length - 1]].forEach(q => pts.push(q)); });
    const idle = window.requestIdleCallback || (f => setTimeout(f, 120));
    let k = 0;
    const next = () => { if (!el || k >= pts.length) return; Avalanche.prefetch(pts[k][0], pts[k][1]); k++; idle(next, { timeout: 800 }); };
    setTimeout(next, 1500);
  }
  // The elevation the record itself gives (elevation_m, e.g. "about 5700 (200 m above Camp II)"), if the animated path passes it.
  const recordZ = (r, a) => { const m = String(r.elevation_m || "").replace(/,/g, "").match(/\d{3,4}/); if (!m || !a || !a.path) return null;
    const z = +m[0], hi = a.path[0][2], lo = Math.min(...a.path.map(p => p[2])); return z <= hi && z >= lo ? z : null; };
  // Snow and ice on the event's upper mountain (static/js/snowcap.js): peaks and start zone only, never in valleys or towns.
  const snowFor = r => { if (window.SnowCap && r.anim) SnowCap.local(map, r.anim, "ht-area").catch(() => {}); };

  function setFocus(r) {
    focusRec = r; placePin(r); markCur(); declutter();
    el.querySelectorAll(".ht-item").forEach(b => b.classList.toggle("cur", !!r && b.dataset.id === r.event_id));
    const c = el.querySelector(".ht-item.cur"); if (c) c.scrollIntoView({ block: "nearest" });
  }
  function placePin(r) {
    markers.forEach(m => m.remove()); markers = [];
    if (!r || !r.geom || r.model || pinsOn) return;       // with the event pins on, the current pin carries this label
    const d = document.createElement("div"); d.className = "ht-pin" + (r.loc.tier === "D" ? " area" : "");
    d.innerHTML = `<div class="ht-pin-l">${r.loc.tier === "D" ? "Approximate area" : "Documented place"}<small>${esc(r.loc.tier === "C" ? "nearest named place" : TIER[r.loc.tier])}</small></div><i></i>`;
    markers.push(new gl.Marker({ element: d, anchor: "bottom" }).setLngLat(r.geom).addTo(map));
  }

  // ------------------------------------------------------------ the tour
  function stopRun(fast) { if (ctl) { try { ctl.stop(fast); } catch { /* gone */ } } ctl = null; if (window.Avalanche) Avalanche.stop(true); }
  function stopTour() { tok++; stopRun(true); clearAdv(); paused = false; touring = false; if (el) { el.classList.remove("ht-cine", "paused", "held"); progress(); } }

  // The hand-over to the following event: the record stays up for a moment, a thin bar fills, and the tour moves on by itself.
  function clearAdv() { if (adv) cancelAnimationFrame(adv.raf); adv = null; if (el) el.classList.remove("held"); }
  function holdAdv(on) { if (!adv || !el) return; adv.held = on; adv.last = performance.now(); el.classList.toggle("held", on); progress(); }
  function scheduleNext() {
    clearAdv();
    const total = (reduce() ? 6500 : DWELL) / speed, lastOne = cur >= stops.length - 1, my = tok;
    adv = { left: total, total, last: performance.now(), held: false, raf: 0 };
    const tick = now => {
      if (!adv || my !== tok || !el) return;
      if (!adv.held) adv.left -= now - adv.last;
      adv.last = now;
      const bar = el.querySelector(".ht-next-b i"); if (bar) bar.style.transform = `scaleX(${Math.min(1, 1 - Math.max(0, adv.left) / adv.total)})`;
      if (adv.left <= 0) { clearAdv(); if (lastOne) overview(true, true); else start(cur + 1, true); return; }
      adv.raf = requestAnimationFrame(tick);
    };
    adv.raf = requestAnimationFrame(tick);
    progress();
  }

  async function start(i, autoNext = true) {
    if (!stops.length || !window.Avalanche) return;
    i = (i + stops.length) % stops.length;
    const my = ++tok; clearAdv(); stopRun(true); paused = false; ended = false; touring = autoNext;
    el.classList.remove("paused", "held");
    const r = stops[i], a = r.anim, first = cur < 0;
    cur = i;
    el.querySelector(".ht-start").hidden = true; hideEnd();
    setList(false);                                   // the scene gets the screen; the list stays one click away
    el.classList.add("ht-cine");
    renderRecord(r); renderList(); caption(r, i); setFocus(r); progress();
    const est = establish(a, first);
    snowFor(r);
    if (wx) { wx.wind(r); wx.level(0.35); }
    // warm the next event's terrain tiles while this one plays, so the next flight lands on a loaded mountain
    const nx = stops[(i + 1) % stops.length];
    if (nx && nx.anim && Avalanche.prefetch) { const p0 = nx.anim.path[0], pm = nx.anim.path[Math.floor(nx.anim.path.length / 2)];
      Avalanche.prefetch(p0[0], p0[1]); Avalanche.prefetch(pm[0], pm[1]); }
    const path = a.path.map(p => ({ lon: p[0], lat: p[1], elev: p[2], t: p[3], v: p[4] }));
    const runRate = r.model ? 5 : Math.max(2, (a.duration_s || 60) / 6.5);
    const rz = recordZ(r, a);
    ctl = Avalanche.play(map, {
      lon: path[0].lon, lat: path[0].lat, path, seed: (parseInt(String(r.event_id).replace(/\D/g, ""), 10) || 7) * 31,
      // massive slabs (user request): a release several hundred metres wide
      // idleMs: wait (at most) for the map to finish loading imagery and terrain before the avalanche starts: no black gaps
      halfWidth: r.model ? 180 : a.mode === "band" ? 160 : 180, rate: runRate, speed, flyMs: reduce() ? 0 : 1700 / speed, idleMs: 4000, hold: null,
      side: 30, drift: 20, shake: 2.6, padding: padding(), hudHost: el, hudClass: "ht-hud", keys: false, look: "real",
      intro: { camera: est.camera, ms: est.ms, hold: reduce() ? 0 : 700 / speed, idleMs: 6000, label: "Establishing the mountain" },
      head: r.model ? "Avalanche reconstruction" : "Avalanche scenario", tag: r.model ? "model · not observed" : "illustrative · not the recorded path",
      // the record's own elevation leads; the animation's start is labelled illustrative, so the two never read as a contradiction
      title: `${r.location}`, sub: rz ? `${dateOf(r)} · struck at about ${fmt(rz)} m (record) · illustrative start ${fmt(a.release.z)} m · ${fmt(a.length_m)} m run`
        : `${dateOf(r)} · release ${fmt(a.release.z)} m${a.release.slope_deg ? ` · ${fmt(a.release.slope_deg)}° slope` : ""} · ${fmt(a.length_m)} m run`,
      releaseLabel: rz ? "START · ILLUSTRATIVE" : "RELEASE",
      mark: rz ? { z: rz, head: "RECORD", text: `struck about ${fmt(rz)} m` } : null,
      releaseNote: a.release.slope_deg ? `${fmt(a.release.slope_deg)}°` : "",
      note: (r.model ? (a.extended ? `Starts at the peak (${fmt(a.extended.peak_z)} m): an illustrative sliding-block run down to the NGT model's release at ${fmt(a.model_release_z)} m; from there the model's own path, times and speeds, unchanged. Played at 5×. Snow, cloud and blocks are illustration.`
          : "NGT model reconstruction: path, times and speeds copied unchanged, played at 5×. Snow, cloud and blocks are illustration. Drag the timeline to scrub; point at the profile to read any spot.")
        : a.route_to_place ? "Illustrative scenario on the real terrain: released at the highest ground above the place and run down a downhill route to the documented place with a textbook sliding-block model, the mass kept moving (at least 6 m/s) over flatter benches. Not the recorded path, not a forecast. Drag the timeline to scrub."
        : "Illustrative scenario on the real terrain: released at the highest ground above the place and run down its fall line with a textbook sliding-block model. Not the recorded path, not a forecast. Drag the timeline to scrub."),
      onStop: () => { if (my === tok) finish(r, my, false); },
      onScrub: () => holdAdv(true),
    });
    progress();
    // atmosphere follows the phases: approach -> wind builds before the release -> calmer during the flow -> settles
    (async () => {
      await wait(est.ms * 0.55); if (my !== tok || !wx) return; wx.level(0.85);
      await wait(est.ms * 0.45 + (700 + 1700 + 900) / speed); if (my !== tok || !wx) return; wx.level(0.45);
    })();
    await ctl.done;
    if (my !== tok) return;
    finish(r, my, autoNext);
  }

  function finish(r, my, autoNext) {
    if (!el || my !== tok) return;
    ended = true; paused = false;
    el.classList.remove("ht-cine", "paused");
    if (wx) wx.level(0.15);
    const e = el.querySelector(".ht-end"), n = stops[cur + 1], lastOne = cur >= stops.length - 1;
    e.innerHTML = `<div class="ht-e-h"><i aria-hidden="true">✓</i><div><small>${r.model ? "Reconstruction" : "Scenario"} complete · ${esc(dateOf(r))}</small><h4>${esc(r.location)}</h4></div></div>
      ${autoNext ? `<div class="ht-next"><div class="ht-next-t">${lastOne ? "<b>Tour complete</b><span>returning to the event map</span>"
          : `<b>Coming up</b><span>${esc(dateOf(n))} · ${esc(n.location)}</span>`}<em>paused · press ▶ to continue</em></div><div class="ht-next-b"><i></i></div></div>` : ""}
      <div class="ht-e-btn"><button type="button" data-a="replay">↻ Replay</button>${autoNext ? "" : `<button type="button" data-a="tour" class="go">▶ Continue the tour</button>`}<button type="button" data-a="map">Back to the map</button></div>`;
    e.hidden = false;
    el.style.setProperty("--end-h", `${e.offsetHeight}px`); el.classList.add("end-on");
    e.querySelectorAll("[data-a]").forEach(b => b.onclick = () => b.dataset.a === "map" ? overview(true) : b.dataset.a === "tour" ? start(cur + 1, true) : action(b.dataset.a));
    renderRecord(r);
    if (autoNext) scheduleNext();
    progress();
  }

  function action(a) {
    if (!el || !data) return;
    if (a === "next") return start(cur < 0 ? 0 : cur + 1, true);
    if (a === "prev") return start(cur <= 0 ? stops.length - 1 : cur - 1, true);
    if (a === "replay") return start(cur < 0 ? 0 : cur, touring || cur < 0);
    if (a === "play") {
      if (adv) { holdAdv(!adv.held); return; }
      if (ended) return start(cur, touring);
      if (ctl && ctl.running()) { paused = !paused; ctl.pause(paused); if (wx) wx.freeze(paused); el.classList.toggle("paused", paused); progress(); return; }
      return start(cur < 0 ? 0 : cur, true);
    }
  }

  // ------------------------------------------------------------ atmosphere: wind-driven snow in screen space (illustration, not weather data)
  function Wx(cv) {
    const ctx = cv.getContext("2d"), N = 320, P = [];
    let lvl = 0, target = 0, ang = -0.18, raf = 0, frozen = false, last = performance.now();
    const rnd = (a, b) => a + Math.random() * (b - a);
    const seed = p => { p.x = rnd(-0.1, 1.1); p.y = rnd(-0.1, 1.1); p.z = Math.random(); p.l = rnd(6, 26); p.a = rnd(0.25, 0.9); return p; };
    for (let i = 0; i < N; i++) P.push(seed({}));
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      lvl += (target - lvl) * Math.min(1, dt * 1.6);
      const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      if (lvl < 0.01 || reduce()) return;
      const n = Math.round(N * Math.min(1, lvl)), cx = Math.cos(ang), cy = Math.sin(ang) * -1;
      ctx.lineCap = "round";
      for (let i = 0; i < n; i++) {
        const p = P[i], sp = (0.25 + p.z * 0.9) * (0.4 + lvl) * speed;
        if (!frozen) { p.x += cx * sp * dt; p.y += (cy * sp + 0.05 + p.z * 0.08) * dt + Math.sin(now / 700 + i) * 0.0006; }
        if (p.x > 1.1 || p.y > 1.1 || p.x < -0.15 || p.y < -0.15) { seed(p); p.x = cx > 0 ? -0.1 : 1.1; }
        const X = p.x * w, Y = p.y * h, L = p.l * (0.4 + p.z) * (0.5 + lvl);
        ctx.globalAlpha = p.a * lvl * (0.25 + p.z * 0.6);
        ctx.strokeStyle = "#eef5ff"; ctx.lineWidth = 0.6 + p.z * 1.6;
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - cx * L, Y - cy * L * 0.5 - L * 0.08); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    raf = requestAnimationFrame(frame);
    return {
      level: v => { target = v; }, freeze: f => { frozen = f; },
      wind: r => { const s = parseInt(String(r.event_id).replace(/\D/g, ""), 10) || 1; ang = ((s * 37) % 50 - 25) * D2R; },   // varied per event, decorative
      stop: () => cancelAnimationFrame(raf),
    };
  }

  // ------------------------------------------------------------ 3D Cinematic Tour (/tour3d, static/tour3d/): a full-screen overlay on top of this tour.
  // It opens at the event on screen (or the first) and, when closed, this tour carries on from the event the 3D tour was showing.
  let f3d = null;
  function open3d() {
    if (f3d) return;
    const list = allStops || stops, r = cur >= 0 ? stops[cur] : null, n = r ? list.indexOf(r) + 1 : 0;
    if (visible) stopTour();                                       // the 2D scene holds still underneath
    if (wx) wx.level(0);                                           // and its snowfall stops drawing
    // nothing else on this page draws while the 3D tour is open (the home map stops its orbit; the page's maps are hidden):
    // only one 3D scene renders at a time
    document.body.classList.add("t3d-open");
    f3d = document.createElement("iframe"); f3d.className = "ht3d-frame"; f3d.title = "3D Cinematic Tour"; f3d.allow = "fullscreen";
    f3d.src = (n > 0 ? `/tour3d?stop=${n}&` : "/tour3d?") + `t0=${Date.now()}`;
    document.body.appendChild(f3d); f3d.focus();
  }
  addEventListener("message", e => {
    if (e.origin !== location.origin || !e.data || e.data.type !== "tour3d:close" || !f3d) return;
    f3d.remove(); f3d = null;
    document.body.classList.remove("t3d-open");
    const id = e.data.id;
    if (!id) return;
    if (visible) { const list = stops, i = list.findIndex(r => r.event_id === id); start(i >= 0 ? i : 0, true); }
    else open({ tour: true, at: id });
  });

  return { open, close, load, warm, open3d, isOpen: () => visible, map: () => map, DEC };   // map(): test helper; DEC: decade colours (home page module)
})();
window.HistTour = HistTour;
