/* Karakoram hotspots (#karakoram).
   Shows the 10 hotspots supplied for the Karakoram demo (data/karakoram/kk_hotspots.geojson, built by
   scripts/build_kk_hotspots.py), drawn as stars in the same style, on the same 3D satellite base map, as the Hindu Kush page.
   No timeline: the supplied list has no reporting window. The risk index is an index (not a probability), not validated. */
"use strict";

const KK = (() => {
  const VIEW = { center: [75.45, 36.45], zoom: 7.5, pitch: 55, bearing: -12 };
  const BOX = [73.0, 35.0, 76.8, 37.2];                      // populated places inside this box are offered
  const GREEN = "#22c55e";
  const RED = "#ff2b2b";                                     // general-risk star, as on the Hindu Kush page
  const ICON = {
    general: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.9l-5.8 3.1 1.4-6.4L2.7 9.2l6.5-.7z"/></svg>',
    hk: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.5 20 9 6.5l4.2 6.8 2.6-3.6L22.5 20z"/></svg>',
    pop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/></svg>',
    av: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20 9 5l3 5"/><path d="M12 10c1.5 3 4 5 9 6"/><circle cx="16" cy="13" r="1.3" fill="currentColor"/><circle cx="19.5" cy="18.5" r="1.1" fill="currentColor"/><circle cx="13" cy="17" r="1.6" fill="currentColor"/></svg>',
  };
  // Batura Glacier avalanche, 9 Aug 1974: the NGT notebook's model path, times and speeds (Historical Overview, catalog id history_batura_1974).
  const BATURA = "/static/history/batura_1974/3d/";
  const BATURA_REF = [74.65, 36.5333];                       // "Batura Glacier reference point" in avalanche_features.geojson
  const ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const st = { map: null, gl: null, ready: false, hot: [], towns: [], allTowns: [], list: true, pop: false, base: "sat", terrain: true, sel: null, popup: null };
  const $ = s => document.querySelector(s);
  const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fc = f => ({ type: "FeatureCollection", features: f });
  const pad = () => window.innerWidth > 1500 ? { top: 112, bottom: 40, left: 230, right: 410 } : window.innerWidth > 1100 ? { top: 210, bottom: 40, left: 230, right: 410 } : 30;

  function starImage() {
    const c = document.createElement("canvas"); c.width = c.height = 96; const x = c.getContext("2d");
    x.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 20 : 45, a = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(48 + r * Math.cos(a), 50 + r * Math.sin(a)); }
    x.closePath(); x.fillStyle = "#fff"; x.fill();          // SDF mask: colour comes from icon-color
    return x.getImageData(0, 0, 96, 96);
  }

  // Nearest of the 20 approximate town centres: haversine distance and the direction of the point as seen from the town.
  function nearText(lon, lat) {
    const R = 6371.0088, rad = Math.PI / 180; let best = null;
    st.allTowns.forEach(t => {
      const [x, y] = t.geometry.coordinates, dp = (lat - y) * rad, dl = (lon - x) * rad;
      const a = Math.sin(dp / 2) ** 2 + Math.cos(y * rad) * Math.cos(lat * rad) * Math.sin(dl / 2) ** 2, d = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
      if (!best || d < best.km) {
        const b = (Math.atan2(Math.sin(dl) * Math.cos(lat * rad), Math.cos(y * rad) * Math.sin(lat * rad) - Math.sin(y * rad) * Math.cos(lat * rad) * Math.cos(dl)) / rad + 360) % 360;
        best = { name: t.properties.name, km: d, dir: ASPECTS[Math.round(b / 45) % 8] };
      }
    });
    return best ? `~${Math.round(best.km)} km ${best.dir} of ${UI.esc(best.name)}` : "—";
  }
  const country = p => p.country === "China" ? `<span class="tag warn" style="white-space:normal" title="The supplied address places this point in Xinjiang, China">Outside Pakistan (per address)</span>` : "";

  // ------------------------------------------------------------ map
  async function initMap(el) {
    let kind, gl;
    try { [kind, gl] = await HK.engine(); }
    catch { el.innerHTML = UI.empty("Map library could not be loaded", "<p>Check the internet connection.</p>"); return; }
    if (!document.body.contains(el)) return;
    let map;
    try { MapPerf.tune(gl); map = new gl.Map(MapPerf.opts({ container: el, style: HK.style(kind), center: VIEW.center, zoom: 5.8, maxPitch: 75, attributionControl: true, hash: false })); }
    catch { el.innerHTML = UI.empty("Interactive map unavailable", "<p>This browser cannot use WebGL.</p>"); return; }
    st.map = map; st.gl = gl;
    map.addControl(new gl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new gl.ScaleControl({ maxWidth: 130, unit: "metric" }), "bottom-left");
    map.addControl(new gl.FullscreenControl({ container: el.closest(".hk-stage") }), "bottom-right");
    map.on("error", e => console.warn("KK map:", e && e.error && e.error.message));
    await new Promise(res => { if (map.isStyleLoaded()) res(); else { map.once("style.load", res); map.once("load", res); } });
    if (st.map !== map) return;

    const bnd = await UI.api("layer/boundaries").catch(() => ({ features: [] }));
    if (st.map !== map) return;
    map.addSource("bnd", { type: "geojson", data: fc(bnd.features.filter(f => ["pakistan", "province", "line"].includes(f.properties.layer))) });
    map.addLayer({ id: "bnd-prov", type: "line", source: "bnd", filter: ["==", ["get", "layer"], "province"],
                   paint: { "line-color": "#ffffff", "line-opacity": 0.55, "line-width": 1, "line-dasharray": [3, 2] } });
    map.addLayer({ id: "bnd-pak", type: "line", source: "bnd", filter: ["==", ["get", "layer"], "pakistan"],
                   paint: { "line-color": "#ffffff", "line-opacity": 0.9, "line-width": 1.8 } });
    map.addLayer({ id: "bnd-loc", type: "line", source: "bnd", filter: ["==", ["get", "layer"], "line"],
                   paint: { "line-color": "#ffd6a0", "line-opacity": 0.9, "line-width": 1.6, "line-dasharray": [4, 3] } });

    map.addSource("kk", { type: "geojson", data: fc(st.hot) });
    map.addSource("kkpop", { type: "geojson", data: fc(st.towns.map(f => ({ type: "Feature", geometry: f.geometry, properties: { name: f.properties.name } }))) });
    if (!map.hasImage("star-sdf")) map.addImage("star-sdf", starImage(), { pixelRatio: 2, sdf: true });
    map.addLayer({ id: "kk-star", type: "symbol", source: "kk", layout: { "icon-image": "star-sdf", "icon-size": 0.62, "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-color": RED, "icon-halo-color": "#0b0f18", "icon-halo-width": 1.8 } });
    map.addLayer({ id: "kk-sel", type: "circle", source: "kk", filter: ["==", ["get", "rank"], -1], paint: {
      "circle-radius": 16, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#22c7d8", "circle-stroke-width": 2.6 } });
    map.addLayer({ id: "kk-rank", type: "symbol", source: "kk", layout: { "text-field": ["to-string", ["get", "rank"]], "text-font": ["Open Sans Semibold"],
      "text-size": 12, "text-offset": [0, -1.5], "text-allow-overlap": true, "text-ignore-placement": true },
      paint: { "text-color": "#fff", "text-halo-color": "#04101d", "text-halo-width": 1.8 } });
    map.addLayer({ id: "kkpop-pt", type: "circle", source: "kkpop", layout: { visibility: "none" },
      paint: { "circle-color": GREEN, "circle-radius": 5.5, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: "kkpop-lbl", type: "symbol", source: "kkpop", minzoom: 6.5, layout: { visibility: "none", "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"],
      "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" }, paint: { "text-color": "#bbf7d0", "text-halo-color": "#06160c", "text-halo-width": 1.6 } });

    st.popup = new gl.Popup({ closeButton: false, offset: 12, className: "hk-tip" });
    const over = (id, fn) => { map.on("mousemove", id, e => { map.getCanvas().style.cursor = "pointer"; fn(e); }); map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; st.popup.remove(); }); };
    over("kk-star", e => {
      const p = e.features[0].properties;
      st.popup.setLngLat(e.lngLat).setHTML(`<div class="hk-tip-h"><span style="color:${RED}">★</span> General risk hotspot <b>#${p.rank}</b> <span class="muted">${UI.esc(p.class)}</span></div>
        Risk index <b>${fmt(p.risk_index, 2)}</b> <span class="muted">(not a probability)</span><br>${fmt(p.elev_m)} m · ${fmt(p.slope_deg)}°`).addTo(map);
    });
    over("kkpop-pt", e => st.popup.setLngLat(e.lngLat).setHTML(`<div class="hk-tip-h"><b>${UI.esc(e.features[0].properties.name)}</b> <span class="muted">populated</span></div>
      Approximate town centre. The source gives no population figure.`).addTo(map));
    map.on("click", "kk-star", e => select(+e.features[0].properties.rank, false));
    map.on("mousemove", e => { const c = $("#kk-coord"); if (c) c.textContent = `${e.lngLat.lat.toFixed(4)}°N  ${e.lngLat.lng.toFixed(4)}°E`; });

    st.ready = true;
    apply();
    map.easeTo({ ...VIEW, duration: 2600, padding: { top: 70, bottom: 150, left: 230, right: window.innerWidth > 1100 ? 420 : 20 } });
    // First visit in this browser session: play the Batura avalanche once, after the opening camera move.
    let seen = true;
    try { seen = !!sessionStorage.getItem("kk-batura"); sessionStorage.setItem("kk-batura", "1"); } catch { /* storage blocked: do not autoplay */ }
    if (!seen && !matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(() => { if (st.map === map && !Avalanche.active()) batura(); }, 3000);
    const eng = $("#kk-engine"); if (eng) eng.textContent = kind === "mapbox" ? "Mapbox GL JS v3" : "MapLibre GL JS (token-free)";
  }

  function vis(id, on) { if (st.map && st.map.getLayer(id)) st.map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }
  function apply() {
    if (!st.ready) return;
    const m = st.map;
    vis("kk-star", st.list); vis("kk-rank", st.list); vis("kk-sel", st.list);
    vis("kkpop-pt", st.pop); vis("kkpop-lbl", st.pop);
    vis("base-sat", st.base === "sat"); vis("base-dark", st.base === "dark");
    vis("hs", st.base === "dark" || !st.terrain);
    if (st.terrain) { m.setTerrain({ source: "dem", exaggeration: 1.5 }); if (m.getPitch() < 30) m.easeTo({ pitch: 55, duration: 900 }); }
    else { m.setTerrain(null); if (m.getPitch() > 0) m.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
  }

  // ------------------------------------------------------------ selection and list
  function select(rank, fly = true) {
    const f = st.hot.find(x => x.properties.rank === rank); if (!f) return;
    st.sel = rank;
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    if (st.ready) {
      st.map.setFilter("kk-sel", ["==", ["get", "rank"], rank]);
      if (fly && window.Avalanche) Avalanche.stop();
      if (fly) st.map.flyTo({ center: [lon, lat], zoom: 11, pitch: st.terrain ? 60 : 0, bearing: st.terrain ? -20 : 0, duration: 2400, essential: true, padding: { top: 90, bottom: 120, left: 230, right: window.innerWidth > 1100 ? 740 : 20 } });
    }
    document.querySelectorAll(".hk-row").forEach(r => r.classList.toggle("sel", +r.dataset.rank === rank));
    const card = $("#kk-detail"); if (!card) return;
    const i = st.hot.indexOf(f);
    card.innerHTML = `<button class="close" aria-label="Close">×</button>
      <div class="eyebrow">General risk hotspot · Karakoram</div>
      <h4><span class="hk-rk">#${p.rank}</span> ${UI.esc(p.class)} <small class="muted">of ${st.hot.length}</small></h4>
      ${UI.dl([
        ["Location", `<span class="mono">${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</span>`],
        ["Risk index", `${fmt(p.risk_index, 2)} <span class="muted">index 0–1, not a probability</span>`],
        ["Class", UI.esc(p.class)], ["Elevation", `${fmt(p.elev_m)} m`], ["Slope", `${fmt(p.slope_deg)}°`],
        ["Nearest town", nearText(lon, lat)],
        ["Place", `<span dir="auto">${UI.esc(p.place_name)}</span> ${country(p)}`],
        ["Address", `<span dir="auto" class="muted" style="overflow-wrap:anywhere;display:block">${UI.esc(p.full_address)}</span>`],
      ])}
      <div class="hk-dact">
        <button class="btn" type="button" data-step="-1" ${i <= 0 ? "disabled" : ""}>‹ Prev</button>
        <button class="btn" type="button" id="kk-copy">Copy coordinates</button>
        <a class="btn" href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener">Google Maps ↗</a>
        <button class="btn" type="button" data-step="1" ${i >= st.hot.length - 1 ? "disabled" : ""}>Next ›</button>
      </div>
      <p class="hk-fine">Potential release terrain: requires field verification. Not a statement that an avalanche will occur.</p>`;
    card.hidden = false;
    card.querySelector(".close").onclick = () => { card.hidden = true; st.sel = null; if (st.ready) st.map.setFilter("kk-sel", ["==", ["get", "rank"], -1]); };
    card.querySelectorAll("[data-step]").forEach(b => b.onclick = () => { const n = st.hot[i + +b.dataset.step]; if (n) select(n.properties.rank); });
    card.querySelector("#kk-copy").onclick = e => navigator.clipboard?.writeText(`${lat.toFixed(5)}, ${lon.toFixed(5)}`).then(() => { e.target.textContent = "Copied ✓"; setTimeout(() => e.target.textContent = "Copy coordinates", 1400); });
  }

  function renderList() {
    const side = $("#kk-side"); if (!side) return;
    side.hidden = !st.list;
    $("#kk-list").innerHTML = st.hot.map(f => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      return `<button type="button" class="hk-row ${p.rank === st.sel ? "sel" : ""}" data-rank="${p.rank}"><span class="hk-rk top">★</span>
        <span class="hk-rmain"><b>#${p.rank} ${UI.esc(p.class)}</b> <span class="muted">· risk ${fmt(p.risk_index, 2)}</span><br>
          <small><span class="mono">${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</span><br>near ${nearText(lon, lat)} · ${fmt(p.elev_m)} m · ${fmt(p.slope_deg)}°${p.country === "China" ? " · outside Pakistan (per address)" : ""}</small></span><span></span></button>`;
    }).join("");
    document.querySelectorAll("#kk-list .hk-row").forEach(r => r.addEventListener("click", () => select(+r.dataset.rank)));
  }

  // ------------------------------------------------------------ Batura avalanche (model reconstruction)
  let baturaData = null;
  async function baturaLoad() {
    if (baturaData) return baturaData;
    const [csv, feats] = await Promise.all([fetch(BATURA + "avalanche_path_with_time.csv").then(r => { if (!r.ok) throw new Error("path " + r.status); return r.text(); }),
      fetch(BATURA + "avalanche_features.geojson").then(r => r.json()).catch(() => ({ features: [] }))]);
    const lines = csv.trim().split(/\r?\n/), head = lines[0].split(",");
    const col = k => head.indexOf(k);
    const path = lines.slice(1).map(l => { const v = l.split(",").map(Number); return { lon: v[col("lon")], lat: v[col("lat")], elev: v[col("elevation_m")], t: v[col("time_s")], v: v[col("speed_ms")] }; });
    const rel = (feats.features.find(f => /Release point/.test(f.properties.name)) || { properties: {} }).properties;
    return (baturaData = { path, rel });
  }
  async function batura() {
    if (!st.ready || !window.Avalanche) return;
    if (Avalanche.active()) { Avalanche.stop(); syncAv(false); return; }
    let d;
    try { d = await baturaLoad(); } catch (e) { console.warn("Batura path:", e.message); return; }
    if (!st.ready) return;
    const p0 = d.path[0], pl = d.path[d.path.length - 1], vmax = Math.max(...d.path.map(p => p.v)), r = d.rel;
    syncAv(true);
    const run = Avalanche.play(st.map, {
      lon: p0.lon, lat: p0.lat, path: d.path, seed: 1974, halfWidth: 110, rate: 5, flyMs: 2600, idleMs: 1500, hold: 14000, side: 38, drift: 22, shake: 3,
      padding: window.innerWidth > 1100 ? { top: 190, bottom: 60, left: 310, right: 420 } : { top: 60, bottom: 40, left: 20, right: 20 },
      intro: { camera: { center: BATURA_REF, zoom: 10.4, pitch: 62, bearing: -28 }, ms: 2600, hold: 900, label: "Batura Glacier, Karakoram" },
      title: "Batura Glacier avalanche · 9 Aug 1974",
      sub: `Release ${fmt(r.elevation_m || p0.elev)} m · slope ${fmt(r.slope_deg)}° · aspect ${fmt(r.aspect_deg)}° · run-out ${fmt(pl.elev)} m in ${fmt(pl.t)} s · max ${fmt(vmax, 1)} m/s`,
      releaseNote: r.slope_deg ? `slope ${fmt(r.slope_deg)}°` : "",
      note: "Model reconstruction from the NGT notebook: release point, path, times and speeds are copied unchanged (avalanche_path_with_time.csv), played at 5× speed. Snow particles, powder cloud and blocks are illustration. Not an observation, not a forecast.",
      onStop: () => syncAv(false),
    });
    run.done.then(() => setTimeout(() => syncAv(Avalanche.active()), 15000));
  }
  function syncAv(on) { document.querySelectorAll('[data-k="batura"],#kk-batura').forEach(b => b.classList.toggle("on", on)); }

  function syncRail() {
    document.querySelector('.hkf-ic[data-k="general"]')?.classList.toggle("on", st.list);
    document.querySelector('.hkf-ic[data-k="pop"]')?.classList.toggle("on", st.pop);
    const c = $("#kk-cnt"); if (c) c.innerHTML = `<span><em style="color:${RED}">★</em> ${st.hot.length} hotspots</span>${st.pop ? `<span><em style="color:${GREEN}">●</em> ${st.towns.length} populated</span>` : ""}`;
  }

  // ------------------------------------------------------------ page
  async function render(el) {
    dispose();
    const head = `<div class="page-h"><div><div class="eyebrow">Karakoram · Hotspots</div><h2>Where to look first in the Karakoram</h2>
      <p>The ten highest-ranked hotspots supplied for the Karakoram, shown at their exact coordinates. Terrain-based ranking: <b>not a forecast</b>.</p></div></div>`;
    el.innerHTML = head + UI.loading("Loading Karakoram hotspots…");
    const [hs, set] = await Promise.all([UI.api("karakoram/hotspots"), UI.api("settlements").catch(() => ({ features: [] }))]);
    if (!hs.available) { el.innerHTML = head + UI.empty("No Karakoram hotspots imported", `<p>${UI.esc(hs.message)}</p>`); return; }
    st.hot = hs.features; st.allTowns = set.features;
    st.towns = set.features.filter(f => { const [x, y] = f.geometry.coordinates; return x >= BOX[0] && x <= BOX[2] && y >= BOX[1] && y <= BOX[3]; });
    st.list = true; st.pop = false; st.sel = null; st.base = "sat"; st.terrain = true;
    if (!document.body.contains(el)) return;
    const idx = st.hot.map(f => f.properties.risk_index), el_ = st.hot.map(f => f.properties.elev_m), sl = st.hot.map(f => f.properties.slope_deg);
    const n = c => st.hot.filter(f => f.properties.class === c).length;
    const kpi = (cls, ic, label, val, note) => `<div class="hk-kpi ${cls}"><i>${ic}</i><div><div class="k-label">${label}</div><div class="k-val">${val}</div><div class="k-note">${note}</div></div></div>`;

    el.innerHTML = head + `<div class="hk-bar"><div class="hk-bar-t"><span class="eyebrow">Karakoram</span><b>Hotspots</b>
        <span class="tag hk-tag" title="Hotspots supplied by NGT from a terrain-based ranking. The risk index is an index (0-1), not a probability, and has not been validated against observed avalanches. Locations need field verification.">Screening · not a forecast</span></div>
        <div class="toolbar" style="margin:0"><button type="button" class="btn primary" id="kk-batura" title="Batura Glacier avalanche, 9 Aug 1974 (model reconstruction)">${UI.ICON.play} Batura avalanche</button><a class="btn" href="#hindukush">← Hindu Kush</a><a class="btn" href="#mountains">All mountain systems</a></div></div>
      <div class="hk-stage hk-fc-on">
        <div class="hk-mapwrap">
          <div id="hk-map" class="hk-map"></div>
          <div class="hk-ctl">
            <div class="hk-ctl-h">Layers</div>
            <div class="hk-seg"><button type="button" data-b="sat" class="on">Satellite</button><button type="button" data-b="dark">Dark</button></div>
            <button type="button" class="hk-3d on" id="kk-3d">3D terrain</button>
            <button type="button" class="hk-reset" id="kk-reset">Reset view</button>
          </div>
          <div class="hkf-rail">
            <button type="button" class="hkf-ic general" data-k="general" title="General risk: red stars and the hotspot list (click a row to go to it)"><span>${ICON.general}</span><em>General risk</em></button>
            <button type="button" class="hkf-ic pop" data-k="pop" title="Show populated areas (green dots)"><span>${ICON.pop}</span><em>Populated</em></button>
            <button type="button" class="hkf-ic av" data-k="batura" title="Batura Glacier avalanche, 9 Aug 1974: model reconstruction played on the 3D map (Esc stops)"><span>${ICON.av}</span><em>Batura avalanche</em></button>
            <a class="hkf-ic hkgo" href="#hindukush" title="Go to the Hindu Kush region"><span>${ICON.hk}</span><em>Hindu Kush</em></a>
          </div>
          <div class="hkf-cap"><small>Karakoram · supplied hotspots</small><b>General risk</b><div class="hkf-cnt" id="kk-cnt" style="justify-content:center"></div></div>
          <div class="hkf" style="right:auto;max-width:600px;max-height:none"><div class="hkf-h"><span class="tag info">Supplied by NGT · not a model output</span></div>
            <div class="hkf-key"><span><em class="k-st" style="color:${RED}">★</em><b>Red star</b> general-risk hotspot, numbered by rank (1 = highest risk index).</span>
              <span><i style="background:${GREEN};border-radius:50%"></i><b>Green dot</b> populated area (approximate town centre; no population figure).</span>
              <span class="hkf-fine">Dashed orange line = Line of Control / indeterminate frontier; Pakistan's view of the boundaries (Natural Earth). Hotspots 9 and 10 lie in Xinjiang, China, according to the supplied addresses.</span></div></div>
          <div class="hk-coord mono" id="kk-coord">Move over the map · scroll to zoom · right-drag to tilt</div>
          <aside class="map-detail hk-detail" id="kk-detail" style="overflow-x:hidden" hidden></aside>
        </div>
        <div class="hk-kpis">
          ${kpi("k-vh", HK.IC.warn, "Hotspots", fmt(st.hot.length), "supplied, ranked 1–" + st.hot.length)}
          ${kpi("k-hi", HK.IC.peak, "Highest risk index", fmt(Math.max(...idx), 2), `lowest ${fmt(Math.min(...idx), 2)} · index, not probability`)}
          ${kpi("k-ar", HK.IC.pin, "Class", `${n("Considerable")}<small> Considerable</small>`, `${n("Moderate")} Moderate`)}
          ${kpi("k-ti", HK.IC.grid, "Elevation", `${fmt(Math.min(...el_))}–${fmt(Math.max(...el_))}<small> m</small>`, "supplied values")}
          ${kpi("k-ro", HK.IC.flow, "Slope", `${fmt(Math.min(...sl))}–${fmt(Math.max(...sl))}<small> °</small>`, "supplied values")}
          ${kpi("k-run", HK.IC.clock, "Populated places", fmt(st.towns.length), "approximate town centres")}
        </div>
        <aside class="hk-side" id="kk-side" hidden>
          <h3><span>General risk: Karakoram hotspots</span> <span class="tag warn">Verify in field</span></h3>
          <div class="hk-count muted"><b>${st.hot.length}</b> hotspots · click a row to go there</div>
          <div class="hk-list" id="kk-list"></div>
          <div class="hk-exp"><a class="btn" href="/api/karakoram/hotspots">⇩ GeoJSON</a></div>
        </aside>
      </div>
      <p class="muted hk-cap" style="margin-top:10px">Map engine: <span id="kk-engine">loading…</span>. Hotspots as supplied (coordinates, risk index, class, elevation and slope unchanged). Risk index is not a probability and is not validated.
        Populated places: approximate town centres from the portal's reference list. Boundaries: Natural Earth (Pakistan view).</p>`;

    renderList(); syncRail();
    el.querySelector('.hkf-ic[data-k="general"]').onclick = () => { st.list = !st.list; renderList(); syncRail(); };
    el.querySelector('.hkf-ic[data-k="pop"]').onclick = () => { st.pop = !st.pop; apply(); syncRail(); };
    el.querySelector('.hkf-ic[data-k="batura"]').onclick = batura;
    el.querySelector("#kk-batura").onclick = batura;
    el.querySelectorAll(".hk-seg button").forEach(b => b.addEventListener("click", () => {
      st.base = b.dataset.b; el.querySelectorAll(".hk-seg button").forEach(x => x.classList.toggle("on", x === b)); apply();
    }));
    el.querySelector("#kk-3d").onclick = e => { st.terrain = !st.terrain; e.currentTarget.classList.toggle("on", st.terrain); apply(); };
    el.querySelector("#kk-reset").onclick = () => { if (st.ready) st.map.easeTo({ ...VIEW, pitch: st.terrain ? VIEW.pitch : 0, duration: 1400 }); };
    initMap(el.querySelector("#hk-map")).catch(e => console.error(e));
  }

  function dispose() {
    if (window.Avalanche) Avalanche.stop(true);
    if (st.map) { try { st.map.remove(); } catch { /* already detached */ } }
    st.map = null; st.ready = false; st.sel = null;
  }

  return { render, dispose, state: st };
})();
window.KK = KK;
Views.karakoram = KK.render;
