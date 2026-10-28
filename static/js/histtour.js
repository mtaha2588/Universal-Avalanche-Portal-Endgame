/* Historic avalanche tour (Historical Overview on the home page): HistTour.open({ focus, tour }).
   A full-screen 3D satellite map of the compiled historical records (/api/history/events, scripts/build_history_events.py) and a guided,
   user-started tour through the located snow / ice avalanches. Each stop: establishing flight onto the real terrain -> blowing snow
   (atmosphere) -> release, flow, powder cloud and deposit (Avalanche engine, static/js/avalanche.js) -> the historical record.
   Honesty rules: every record field is shown as compiled; paths are ILLUSTRATIVE scenarios on the DEM (the records contain no path),
   except Batura 1974, which plays the NGT model reconstruction unchanged. Weather in the scene is atmosphere only; documented
   conditions are quoted from the record. */
"use strict";

const HistTour = (() => {
  const BATURA = "/static/history/batura_1974/";
  const TIER = { A: "Coordinates in the record", B: "Place found in OpenStreetMap", C: "Nearest named place", D: "Valley / district only", E: "Not located" };
  const CONF = { high: "#34d399", medium: "#fbbf24", low: "#f87171", "very low": "#f87171", model: "#a78bfa" };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const D2R = Math.PI / 180;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n, d = 0) => n == null || n === "" || isNaN(n) ? "—" : (+n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const fdate = s => { if (!s) return ""; const p = s.split("-"); return p.length === 1 ? p[0] : p.length === 2 ? `${MON[+p[1] - 1]} ${p[0]}` : `${+p[2]} ${MON[+p[1] - 1]} ${p[0]}`; };
  const dateOf = p => p.date ? fdate(p.date) : p.date_start ? (p.date_end && p.date_end !== p.date_start ? `${fdate(p.date_start)} – ${fdate(p.date_end)}` : fdate(p.date_start)) : "Date unknown";
  const sortKey = p => p.date_start || p.date || "9999";
  const year = p => (sortKey(p) || "").slice(0, 4);

  let el = null, map = null, gl = null, engine = "", data = null, stops = [], cur = -1, ctl = null, tok = 0, auto = true, paused = false;
  let countdown = 0, markers = [], wx = null, keyH = null, ended = false;

  // ------------------------------------------------------------ data
  async function load() {
    if (data) return data;
    const [ev, csv, feats] = await Promise.all([
      fetch("/api/history/events").then(r => r.json()),
      fetch(BATURA + "3d/avalanche_path_with_time.csv").then(r => r.ok ? r.text() : "").catch(() => ""),
      fetch(BATURA + "3d/avalanche_features.geojson").then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] }))]);
    if (!ev.available) throw new Error(ev.message || "historical events not built");
    const recs = ev.features.map(f => ({ ...f.properties, geom: f.geometry && f.geometry.coordinates }));
    // Batura 1974: the NGT model reconstruction (path, times and speeds unchanged), shown as its own kind of stop.
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
    }
    recs.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    data = { recs, meta: ev.metadata || {} };
    stops = recs.filter(r => r.anim);
    return data;
  }

  // ------------------------------------------------------------ open / close
  async function open(opt = {}) {
    if (el) close();
    el = document.createElement("div"); el.className = "ht"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Historic avalanche tour");
    el.innerHTML = `
      <div class="ht-map" id="ht-map"></div><canvas class="ht-wx" aria-hidden="true"></canvas><div class="ht-vig" aria-hidden="true"></div>
      <div class="ht-bars" aria-hidden="true"><i></i><i></i></div>
      <header class="ht-top">
        <button type="button" class="ht-exit" title="Close the tour (Esc)">← Historical Overview</button>
        <div class="ht-brand"><b>Historic avalanche tour</b><span>Pakistan · compiled records 1974–2026 · illustrative scenarios on real terrain</span></div>
        <div class="ht-tools"><button type="button" class="ht-overview" title="Show every record on the map">Event map</button>
          <button type="button" class="ht-listbtn" aria-pressed="true">Records</button><button type="button" class="ht-fs" title="Full screen">⛶</button></div>
      </header>
      <aside class="ht-list" aria-label="Historical records"><div class="ht-lh"><b>Records</b><label><input type="checkbox" class="ht-only"> only tour stops</label></div><div class="ht-items"></div></aside>
      <aside class="ht-rec" aria-live="polite"></aside>
      <div class="ht-cap" aria-live="polite"></div>
      <div class="ht-end" hidden></div>
      <div class="ht-start" hidden></div>
      <nav class="ht-ctl" aria-label="Tour controls">
        <button type="button" data-a="prev" title="Previous stop (←)">⏮</button>
        <button type="button" data-a="play" class="big" title="Play / pause (Space)">▶</button>
        <button type="button" data-a="replay" title="Replay this avalanche">↻</button>
        <button type="button" data-a="next" title="Skip to the next stop (→)">⏭</button>
        <div class="ht-prog"><span class="ht-pt">Tour</span><div class="ht-pb"><i></i></div></div>
        <label class="ht-auto" title="Continue to the next stop after the record is shown"><input type="checkbox" checked> auto-continue</label>
      </nav>
      <div class="ht-load"><i></i><b>Loading the historical records and 3D terrain…</b></div>`;
    document.body.appendChild(el);
    document.body.classList.add("ht-open");
    requestAnimationFrame(() => el.classList.add("on"));
    const q = s => el.querySelector(s);
    q(".ht-exit").onclick = close;
    q(".ht-fs").onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => {}); };
    q(".ht-overview").onclick = () => overview(true);
    q(".ht-listbtn").onclick = () => setList(!el.classList.contains("list-on"));
    q(".ht-only").onchange = renderList;
    q(".ht-auto input").onchange = e => { auto = e.target.checked; if (!auto) clearCountdown(); };
    el.querySelectorAll(".ht-ctl [data-a]").forEach(b => b.onclick = () => action(b.dataset.a));
    keyH = e => {
      if (!el) return;
      if (e.key === "Escape") { if (document.fullscreenElement) return; e.preventDefault(); close(); }
      else if (e.key === " " && !/INPUT|BUTTON|SELECT/.test(e.target.tagName)) { e.preventDefault(); action("play"); }
      else if (e.key === "ArrowRight") action("next");
      else if (e.key === "ArrowLeft") action("prev");
      else return;
      e.stopImmediatePropagation();
    };
    addEventListener("keydown", keyH, true);
    auto = !reduce(); q(".ht-auto input").checked = auto;
    setList(innerWidth > 1100);
    try {
      await Promise.all([load(), makeMap()]);
    } catch (e) {
      console.warn("HistTour:", e);
      q(".ht-load").innerHTML = `<b>The tour could not start</b><span>${esc(e.message)}. The portal server must be running (run.bat).</span>`;
      return;
    }
    if (!el) return;
    wx = Wx(q(".ht-wx"));
    addLayers();
    q(".ht-load").classList.add("off");
    renderList();
    const f = opt.focus && data.recs.find(r => r.event_id === opt.focus);
    if (opt.tour) start(0);
    else if (f) focus(f, false);
    else overview(false);
  }

  function close() {
    if (!el) return;
    stopRun(true); clearCountdown(); tok++;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    removeEventListener("keydown", keyH, true);
    if (wx) wx.stop(); wx = null;
    markers.forEach(m => m.remove()); markers = [];
    try { map && map.remove(); } catch { /* already gone */ }
    map = null; cur = -1; paused = false;
    el.remove(); el = null;
    document.body.classList.remove("ht-open");
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
    map = new gl.Map(window.MapPerf ? MapPerf.opts(o) : o);
    map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new gl.NavigationControl({ visualizePitch: true }), "bottom-right");
    await new Promise((res, rej) => {
      map.once("load", res);
      map.on("error", ev => { const s = ev.error && ev.error.status; if (!map.loaded() && (s === 401 || s === 403)) rej(ev.error); });
    });
    map.addSource("ht-dem", window.MapPerf ? MapPerf.dem() : { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12, tiles: [location.origin + "/api/dem/{z}/{x}/{y}.png?v=cop1"] });
    map.setTerrain({ source: "ht-dem", exaggeration: 1.2 });
    // atmospheric depth: blue-grey high-altitude haze (documentary grade); no stars, no neon
    try {
      if (engine === "mapbox") map.setFog({ range: [0.8, 7], color: "rgb(176,192,214)", "high-color": "rgb(54,84,128)", "horizon-blend": 0.09, "space-color": "rgb(8,14,26)", "star-intensity": 0 });
      else if (map.setSky) map.setSky({ "sky-color": "#3b5b86", "horizon-color": "#b8c7da", "fog-color": "#b0c0d6", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.2 });
    } catch { /* engine without fog */ }
    map.on("dragstart", () => { if (countdown) clearCountdown(); });
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
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 10, 16], "circle-color": "#e0f2fe", "circle-opacity": 0.18, "circle-blur": 0.6, "circle-pitch-alignment": "map" } });
    map.addLayer({ id: "ht-pt", type: "circle", source: "ht-pt",
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["==", ["get", "tour"], 1], 5, 3.5], 10, 7],
        "circle-color": ["case", ["==", ["get", "tour"], 1], "#f8fafc", "#94a3b8"], "circle-stroke-color": ["case", ["==", ["get", "tour"], 1], "#38bdf8", "#1e293b"],
        "circle-stroke-width": 1.6 } });
    ["ht-pt", "ht-area"].forEach(id => {
      map.on("click", id, e => { const f = e.features && e.features[0]; const r = f && data.recs.find(x => x.event_id === f.properties.id); if (r) { stopTour(); focus(r, true); } });
      map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
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

  function renderList() {
    if (!el || !data) return;
    const only = el.querySelector(".ht-only").checked, box = el.querySelector(".ht-items");
    let y0 = "";
    box.innerHTML = data.recs.filter(r => !only || r.anim).map(r => {
      const dec = (year(r) || "????").slice(0, 3) + "0s", head = dec !== y0 ? `<div class="ht-dec">${dec}</div>` : ""; y0 = dec;
      const si = stops.indexOf(r);
      return `${head}<button type="button" class="ht-item ${r.anim ? "tour" : ""} ${si === cur && si >= 0 ? "cur" : ""}" data-id="${esc(r.event_id)}">
        <span class="ht-i-d">${esc(dateOf(r))}</span><b>${esc(r.location)}</b>
        <span class="ht-i-m">${deaths(r) ? `<em>${esc(deaths(r))}</em>` : ""}${r.anim ? `<i class="snow">❄ ${r.model ? "model" : "scenario"}</i>` : ""}<i class="tier t${r.loc.tier}">${r.loc.tier}</i></span></button>`;
    }).join("");
    box.querySelectorAll(".ht-item").forEach(b => b.onclick = () => { const r = data.recs.find(x => x.event_id === b.dataset.id); stopTour(); focus(r, true); });
    const c = box.querySelector(".cur"); if (c) c.scrollIntoView({ block: "nearest" });
  }

  function renderRecord(r) {
    const a = r.anim, box = el.querySelector(".ht-rec"), osm = r.loc.osm ? `https://www.openstreetmap.org/${r.loc.osm}` : null;
    const srcs = String(r.sources || "").split(/;\s*/).filter(Boolean);
    box.innerHTML = `
      <div class="ht-r-eb"><span>${esc(r.event_id)}</span>${kindBadge(r)}</div>
      <h3>${esc(r.location)}</h3>
      <div class="ht-r-date"><b>${esc(dateOf(r))}</b><span>${esc(r.date_precision || "")}</span></div>
      <div class="ht-r-badges">${confBadge(r.confidence)}${tierBadge(r)}</div>
      <dl class="ht-r-kv">
        <dt>Deaths (as reported)</dt><dd class="big">${esc(deathsTxt(r))}</dd>
        <dt>Injured</dt><dd>${esc(r.injured || "—")}</dd>
        <dt>Event type</dt><dd>${esc(r.event_type)}</dd>
        <dt>Who was affected</dt><dd>${esc(r.who_affected || "—")}</dd>
        <dt>Region</dt><dd>${esc(r.region || "—")}${r.elevation_m ? ` · ${esc(r.elevation_m)} m (record)` : ""}</dd>
      </dl>
      <h6>Documented conditions</h6><p class="${r.weather_context ? "" : "muted"}">${r.weather_context ? esc(r.weather_context) : "No weather is recorded for this event. Snow and wind in the scene are atmosphere only."}</p>
      ${r.context_notes ? `<h6>Notes in the record</h6><p>${esc(r.context_notes)}</p>` : ""}
      <h6>Location</h6><p>${esc(r.loc.note)}${osm ? ` <a href="${osm}" target="_blank" rel="noopener">OpenStreetMap ↗</a>` : ""}${r.geom ? `<br><span class="mono">${r.geom[1].toFixed(4)}° N, ${r.geom[0].toFixed(4)}° E</span>` : ""}</p>
      ${a ? `<h6>${r.model ? "Model reconstruction" : "Illustrative scenario"}</h6>
        <div class="ht-r-sim"><div><b>${fmt(a.release.z)} m</b><span>release${a.release.slope_deg ? ` · ${fmt(a.release.slope_deg)}°` : ""}</span></div>
          <div><b>${fmt(a.length_m)} m</b><span>path length</span></div><div><b>${fmt(a.drop_m)} m</b><span>vertical drop</span></div>
          <div><b>${fmt(a.vmax_ms)} m/s</b><span>peak speed (${fmt(a.vmax_ms * 3.6)} km/h)</span></div></div>
        <p class="fine">${r.model ? "Release point, path, times and speeds are the NGT notebook's model outputs, copied unchanged; not an observation."
          : `Not the recorded path: the records give no path. A release on a steep (28–55°) high slope ${a.mode === "band" ? "at the elevation given in the record" : "above the documented place"} was found on the portal DEM (Copernicus GLO-30, ~30 m) and a sliding block with textbook Voellmy friction (μ 0.20, ξh 4,000 m/s², not calibrated) was run down the real terrain${a.place_dist_m != null ? `; it passes ${fmt(a.place_dist_m)} m from the documented place` : ""}.`}</p>`
      : `<h6>Animation</h6><p class="muted">${esc(r.anim_reason || "No animation.")}</p>`}
      <h6>Sources</h6><ul class="ht-r-src">${srcs.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
      ${r.model ? '<button type="button" class="ht-r-open">Open the full Batura reconstruction →</button>' : ""}
      ${a ? `<button type="button" class="ht-r-play">▶ ${stops.indexOf(r) === cur && ctl ? "Replay" : "Play"} the ${r.model ? "reconstruction" : "scenario"}</button>` : ""}`;
    box.scrollTop = 0;
    const pb = box.querySelector(".ht-r-play"); if (pb) pb.onclick = () => { const i = stops.indexOf(r); start(i, false); };
    const ob = box.querySelector(".ht-r-open"); if (ob) ob.onclick = () => { close(); if (typeof openEvent === "function") openEvent("batura_1974"); };
  }

  function caption(r, i) {
    const c = el.querySelector(".ht-cap");
    if (!r) { c.classList.remove("on"); return; }
    c.innerHTML = `<small>${i != null ? `Stop ${String(i + 1).padStart(2, "0")} / ${stops.length} · ` : ""}${esc(dateOf(r))}</small>
      <b>${esc(r.location)}</b><span>${esc(r.region || "")}${deaths(r) ? ` · ${esc(deaths(r))}` : ""} · ${r.model ? "model reconstruction" : r.anim ? "illustrative scenario on real terrain" : "record only"}</span>`;
    c.classList.remove("on"); void c.offsetWidth; c.classList.add("on");
  }

  function progress() {
    const p = el.querySelector(".ht-prog");
    p.querySelector(".ht-pt").textContent = cur >= 0 ? `Stop ${cur + 1} of ${stops.length}` : `${stops.length} tour stops · ${data.recs.filter(r => !r.model).length} records`;
    p.querySelector("i").style.width = cur >= 0 ? `${(cur + 1) / stops.length * 100}%` : "0";
    el.querySelector('[data-a="play"]').textContent = ctl && !paused && !ended && ctl.running() || countdown ? "❚❚" : "▶";
  }

  // ------------------------------------------------------------ camera helpers
  const padding = () => innerWidth > 1100 ? { top: 90, bottom: 120, left: el.classList.contains("list-on") ? 360 : 40, right: 420 } : { top: 70, bottom: 150, left: 20, right: 20 };
  function establish(a, first) {
    const p = a.path, r = p[0], e = p[p.length - 1], m = p[Math.floor(p.length * 0.4)];
    const dx = (e[0] - r[0]) * Math.cos(r[1] * D2R), dy = e[1] - r[1], down = Math.atan2(dx, dy) / D2R;
    const L = Math.max(600, a.length_m || 1000), z = Math.max(10.6, Math.min(12.8, 13.4 - Math.log2(L / 1000) * 0.9));
    return { camera: { center: [m[0], m[1]], zoom: z - 0.9, pitch: 74, bearing: down + 180 - 34 }, ms: reduce() ? 0 : first ? 4200 : 3000 };
  }

  // ------------------------------------------------------------ overview and single records
  function overview(fly) {
    stopTour(); caption(null);
    el.classList.remove("cine");
    el.querySelector(".ht-end").hidden = true;
    const s = el.querySelector(".ht-start");
    const compiled = data.recs.filter(r => !r.model), located = compiled.filter(r => r.geom).length;
    s.innerHTML = `<small>Signature experience</small><h2>Historic avalanches of northern Pakistan</h2>
      <p>${compiled.length} records compiled from news archives, the HiAVAL database and mountaineering journals; ${located} can be placed on the map and
      ${stops.length - 1} located snow / ice avalanches can be replayed on the real terrain where they happened, plus the NGT model reconstruction of Batura 1974.</p>
      <div class="ht-legend"><span><i class="lp tour"></i>Tour stop: illustrative scenario (or model)</span><span><i class="lp"></i>Located record, not animated</span><span><i class="la"></i>Valley / district only</span></div>
      <div class="ht-s-btn"><button type="button" class="go">▶ Start the guided tour</button><button type="button" class="ghost">Explore the map</button></div>
      <p class="fine">Paths are illustrative scenarios placed by terrain analysis, not recorded paths. Casualty figures are as reported. Not a forecast or warning.</p>`;
    s.hidden = false;
    s.querySelector(".go").onclick = () => start(0);
    s.querySelector(".ghost").onclick = () => { s.hidden = true; };
    el.querySelector(".ht-rec").innerHTML = `<div class="ht-r-eb"><span>Event map</span></div><h3>All compiled records</h3>
      <p>Click a point, an area or a record in the list to read it. White points with a blue ring are tour stops.</p>
      <dl class="ht-r-kv"><dt>Compiled records</dt><dd class="big">${compiled.length}</dd><dt>Placed on the map</dt><dd>${located}</dd><dt>Tour stops</dt><dd>${stops.length}</dd>
        <dt>Geocoder</dt><dd>${esc(data.meta.geocoder || "OpenStreetMap Nominatim")}</dd></dl>
      <h6>Location quality</h6><ul class="ht-r-src">${Object.entries(TIER).map(([k, v]) => `<li><span class="ht-tier t${k}">${k}</span> ${esc(v)}: ${compiled.filter(r => r.loc.tier === k).length}</li>`).join("")}</ul>
      <h6>Method</h6><p class="fine">${esc(data.meta.method || "")}</p>`;
    cur = -1; renderList(); progress();
    const cam = map.cameraForBounds([[69.8, 33.6], [77.6, 37.0]], { padding: padding() });
    map.flyTo({ ...cam, pitch: 38, bearing: 0, duration: fly && !reduce() ? 2600 : 0, essential: true });
    if (wx) wx.level(0.12);
  }

  function focus(r, fly) {
    el.querySelector(".ht-start").hidden = true; el.querySelector(".ht-end").hidden = true;
    const i = stops.indexOf(r); cur = i;
    renderRecord(r); renderList(); progress(); caption(r, i >= 0 ? i : null); placePin(r);
    if (r.anim) {
      const est = establish(r.anim, false);
      map.flyTo({ ...est.camera, duration: fly && !reduce() ? 2600 : 0, essential: true, padding: padding() });
    } else if (r.geom) map.flyTo({ center: r.geom, zoom: r.loc.tier === "D" ? 8.6 : 11.2, pitch: 60, bearing: 0, duration: fly && !reduce() ? 2400 : 0, essential: true, padding: padding() });
    if (wx) wx.level(0.18);
  }

  function placePin(r) {
    markers.forEach(m => m.remove()); markers = [];
    if (!r || !r.geom || r.model) return;
    const d = document.createElement("div"); d.className = "ht-pin" + (r.loc.tier === "D" ? " area" : "");
    d.innerHTML = `<div class="ht-pin-l">${r.loc.tier === "D" ? "Approximate area" : "Documented place"}<small>${esc(r.loc.tier === "C" ? "nearest named place" : TIER[r.loc.tier])}</small></div><i></i>`;
    markers.push(new gl.Marker({ element: d, anchor: "bottom" }).setLngLat(r.geom).addTo(map));
  }

  // ------------------------------------------------------------ the tour
  function stopRun(fast) { if (ctl) { try { ctl.stop(fast); } catch { /* gone */ } } ctl = null; if (window.Avalanche) Avalanche.stop(true); }
  function stopTour() { tok++; stopRun(true); clearCountdown(); paused = false; if (el) { el.classList.remove("cine"); progress(); } }
  function clearCountdown() { if (countdown) { clearInterval(countdown); countdown = 0; } if (el) { const n = el.querySelector(".ht-cd"); if (n) n.remove(); progress(); } }

  async function start(i, autoNext = auto) {
    if (!stops.length || !window.Avalanche) return;
    i = (i + stops.length) % stops.length;
    const my = ++tok; clearCountdown(); stopRun(true); paused = false; ended = false;
    const r = stops[i], a = r.anim, first = cur < 0;
    cur = i;
    el.querySelector(".ht-start").hidden = true; el.querySelector(".ht-end").hidden = true;
    setList(false);                                   // the scene gets the screen; the list stays one click away
    el.classList.add("cine");
    renderRecord(r); renderList(); caption(r, i); placePin(r); progress();
    const est = establish(a, first);
    if (wx) { wx.wind(r); wx.level(0.35); }
    const path = a.path.map(p => ({ lon: p[0], lat: p[1], elev: p[2], t: p[3], v: p[4] }));
    const runRate = r.model ? 5 : Math.max(2, (a.duration_s || 60) / 6.5);
    ctl = Avalanche.play(map, {
      lon: path[0].lon, lat: path[0].lat, path, seed: (parseInt(String(r.event_id).replace(/\D/g, ""), 10) || 7) * 31,
      halfWidth: r.model ? 110 : a.mode === "band" ? 105 : 80, rate: runRate, flyMs: reduce() ? 0 : 1700, idleMs: 1200, hold: null,
      side: 30, drift: 20, shake: 2.6, padding: padding(), hudHost: el, hudClass: "ht-hud", keys: false,
      intro: { camera: est.camera, ms: est.ms, hold: reduce() ? 0 : 700, label: "Establishing the mountain" },
      head: r.model ? "Avalanche reconstruction" : "Avalanche scenario", tag: r.model ? "model · not observed" : "illustrative · not the recorded path",
      title: `${r.location}`, sub: `${dateOf(r)} · release ${fmt(a.release.z)} m${a.release.slope_deg ? ` · ${fmt(a.release.slope_deg)}° slope` : ""} · ${fmt(a.length_m)} m run`,
      releaseNote: a.release.slope_deg ? `${fmt(a.release.slope_deg)}°` : "",
      note: r.model ? "NGT model reconstruction: path, times and speeds copied unchanged, played at 5×. Snow, cloud and blocks are illustration."
        : "Illustrative scenario on the real terrain: release found by terrain analysis, motion from a textbook sliding-block model. Not the recorded path, not a forecast.",
      onStop: () => { if (my === tok) finish(r, my, false); },
    });
    progress();
    // atmosphere follows the phases: approach -> wind builds before the release -> calmer during the flow -> settles
    (async () => {
      await wait(est.ms * 0.55); if (my !== tok || !wx) return; wx.level(0.85);
      await wait(est.ms * 0.45 + 700 + 1700 + 900); if (my !== tok || !wx) return; wx.level(0.45);
    })();
    await ctl.done;
    if (my !== tok) return;
    finish(r, my, autoNext);
  }

  function finish(r, my, autoNext) {
    if (!el || my !== tok) return;
    ended = true;
    el.classList.remove("cine");
    if (wx) wx.level(0.15);
    const e = el.querySelector(".ht-end");
    e.innerHTML = `<small>Historical record · ${esc(dateOf(r))}</small><h4>${esc(r.location)}</h4>
      <div class="ht-e-kv"><div><b class="cu" data-v="${+r.deaths || 0}">${r.deaths === "" || r.deaths == null ? "—" : "0"}</b><span>${+r.deaths === 1 ? "death" : "deaths"} reported</span></div>
        <div><b>${esc(r.injured || "—")}</b><span>injured</span></div><div><b>${esc(r.confidence || "—")}</b><span>confidence</span></div></div>
      <p>${esc(r.who_affected || r.event_type)}</p>
      <div class="ht-e-btn"><button type="button" data-a="replay">↻ Replay</button><button type="button" data-a="next" class="go">Next stop →</button><button type="button" data-a="map">Back to the map</button></div>`;
    e.hidden = false;
    e.querySelectorAll("[data-a]").forEach(b => b.onclick = () => b.dataset.a === "map" ? overview(true) : action(b.dataset.a));
    const cu = e.querySelector(".cu"), v = +cu.dataset.v;
    if (v && !reduce()) { const t0 = performance.now(); const st = now => { const k = Math.min(1, (now - t0) / 1100); cu.textContent = Math.round(v * (1 - Math.pow(1 - k, 3))); if (k < 1 && el) requestAnimationFrame(st); }; requestAnimationFrame(st); }
    else if (v) cu.textContent = v;
    renderRecord(r);
    if (autoNext && cur < stops.length - 1) {
      let n = 8;
      const cd = document.createElement("div"); cd.className = "ht-cd"; e.appendChild(cd);
      const tick = () => { cd.textContent = `Next stop in ${n} s · press Space to stay`; };
      tick();
      countdown = setInterval(() => { if (--n <= 0) { clearCountdown(); start(cur + 1); } else tick(); }, 1000);
    }
    progress();
  }

  function action(a) {
    if (!el || !data) return;
    if (a === "next") return start(cur < 0 ? 0 : cur + 1);
    if (a === "prev") return start(cur <= 0 ? stops.length - 1 : cur - 1);
    if (a === "replay") return start(cur < 0 ? 0 : cur, false);
    if (a === "play") {
      if (countdown) { clearCountdown(); return; }
      if (ended) return start(cur, false);
      if (ctl && ctl.running()) { paused = !paused; ctl.pause(paused); if (wx) wx.freeze(paused); el.classList.toggle("paused", paused); progress(); return; }
      return start(cur < 0 ? 0 : cur);
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
        const p = P[i], sp = (0.25 + p.z * 0.9) * (0.4 + lvl);
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
      wind: r => { const s = parseInt(String(r.event_id).replace(/\D/g, ""), 10) || 1; ang = ((s * 37) % 50 - 25) * D2R; },   // varied per stop, decorative
      stop: () => cancelAnimationFrame(raf),
    };
  }

  return { open, close, load, isOpen: () => !!el, map: () => map };          // map(): test helper
})();
window.HistTour = HistTour;
