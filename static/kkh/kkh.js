/* Settlement & Infrastructure tab (static/kkh/kkh.html, served at /kkh, opened from the portal's tab in a full-screen overlay).
   One module, nothing on window. Its own Mapbox map: created when the page opens, removed when it closes.

   Data (all in static/kkh/data/):
   - kkh_route.geojson          the Karakoram Highway N-35 from OpenStreetMap (relation 2441750), the G314 in China (context) and the towns on it
   - kkh_infrastructure.geojson tunnels, avalanche galleries, bridges and the Sost dry port on the route (OpenStreetMap)
   - kkh_inventory.json         CPEC_KKH_Glacier_Inventory.xlsx, every value exactly as in the workbook, plus computed road distances
   Labels only where the source has a name. Glaciers and settlements whose coordinates are "Not found" in the inventory are listed but
   not drawn: they are never placed by guess. Population is always shown as the inventory's low-high range. */

const cfg = JSON.parse(document.getElementById("kkh-cfg").textContent || "{}");
const V = cfg.v || 0;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 0) => (+n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const D2R = Math.PI / 180;
const km = (a, b) => Math.hypot((b[0] - a[0]) * 111.32 * Math.cos((a[1] + b[1]) / 2 * D2R), (b[1] - a[1]) * 110.57);   // [lon, lat]
const NF = v => v == null || v === "" || v === "Not found" || v === "-";
const base = n => String(n || "").split(" (")[0].trim();
const HAZARD_KM = 5;
const IC = s => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s}</svg>`;
const I = { close: IC('<path d="M6 6l12 12M18 6L6 18"/>'), mtn: IC('<path d="M2.5 19.5 9 8.5l3.6 6 2.4-3.8 6.5 8.8z"/><path d="M7.2 11.6 9 13l1.6-1.5"/>') };

// ------------------------------------------------------------------ page
const app = $("#kkh-app");
app.insertAdjacentHTML("beforeend", `
  <header class="kkh-top"><div class="kkh-brand"><b>Settlement &amp; Infrastructure</b><span>Karakoram Highway N-35 · glaciers, settlements and events along the road (CPEC)</span></div>
    <span class="kkh-sp"></span>
    <button type="button" class="kkh-btn" data-a="3d" title="3D Cinematic Tour">${I.mtn}3D Tour</button>
    <button type="button" class="kkh-btn kkh-x" data-a="close" title="Close (Esc)" aria-label="Close">${I.close}</button></header>
  <aside class="kkh-side" aria-label="Glaciers along the road"><h4>Glaciers along the KKH</h4><div class="kkh-sub" data-sub>—</div><div class="kkh-list" data-list></div></aside>
  <aside class="kkh-card" aria-live="polite"></aside>
  <div class="kkh-leg" data-leg></div>
  <section class="kkh-tl" aria-label="Events timeline"><h4>Events timeline · surges and outburst floods near the KKH</h4><div class="kkh-ev" data-ev></div></section>
  <div class="kkh-toast" data-toast></div>
  <div class="kkh-load" data-load><b>Karakoram Highway</b><span>Loading the road, glaciers and terrain…</span></div>`);
const toast = t => { const el = $("[data-toast]"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.k); toast.k = setTimeout(() => el.classList.remove("on"), 3600); };
const inFrame = window.parent && window.parent !== window;
function close() { if (map) { map.remove(); map = null; } if (inFrame) window.parent.postMessage({ type: "kkh:close" }, location.origin); else location.href = "/#home"; }
app.addEventListener("click", e => {
  const a = e.target.closest("[data-a]"); if (!a) return;
  if (a.dataset.a === "close") close();
  if (a.dataset.a === "3d") toast("The 3D cinematic tour (/kkh3d) is the next step: one stop is shown for approval first.");
});
addEventListener("keydown", e => { if (e.key === "Escape") { if ($(".kkh-card").classList.contains("on")) { $(".kkh-card").classList.remove("on"); app.classList.remove("kkh-carded"); } else close(); } });

// ------------------------------------------------------------------ data
const get = p => fetch(`/static/kkh/data/${p}?v=${V}`).then(r => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
let map = null;
Promise.all([get("kkh_route.geojson"), get("kkh_infrastructure.geojson"), get("kkh_inventory.json"),
  fetch("/api/layer/boundaries").then(r => r.ok ? r.json() : null).catch(() => null), fetch("/static/geo/official_view.geojson").then(r => r.ok ? r.json() : null).catch(() => null)])
  .then(start).catch(e => { $("[data-load]").innerHTML = `<b>The tab could not load its data</b><span>${esc(e.message)}</span>`; });

function start([route, infra, inv, bnd, ov]) {
  const n35 = route.features.find(f => f.properties.id === "n35"), line = n35.geometry.coordinates;
  const ch = [0]; for (let i = 1; i < line.length; i++) ch.push(ch[i - 1] + km(line[i - 1], line[i]));
  const SRC = new Map(inv.notes_sources.sources.map(s => [s.id, s]));
  const comp = inv.computed.glaciers;
  const num = v => { const x = parseFloat(v); return isFinite(x) ? x : null; };
  // glaciers and settlements with their inventory coordinates (only those that have them are drawn)
  const G = inv.glaciers.rows.map(r => ({ r, name: r.Glacier, lat: num(r["Latitude (°N)"]), lon: num(r["Longitude (°E)"]), c: comp[r.Glacier] || {} }));
  const hazard = g => /surge/i.test(g.r.Type || "") || /GLOF|flood|outburst|lake|threat|blocked|surge/i.test(`${g.r["Hazard / notes"] || ""} ${g.r["Observed change"] || ""}`);
  G.forEach(g => { g.hazard = hazard(g); g.located = g.lat != null && g.lon != null; });
  const S = inv.settlements.rows.map(r => ({ r, name: r.Settlement, lat: num(r["Latitude (°N)"]), lon: num(r["Longitude (°E)"]), lo: num(r["Population (low)"]), hi: num(r["Population (high)"]) }));
  S.forEach(s => { s.located = s.lat != null && s.lon != null; });

  // road within HAZARD_KM of a located hazard glacier: red sections (from the inventory's coordinates; outlines once approved)
  const hz = G.filter(g => g.located && g.hazard), red = [];
  let cur = null, redKm = 0;
  line.forEach((p, i) => {
    const near = hz.some(g => km(p, [g.lon, g.lat]) <= HAZARD_KM);
    if (near) { if (!cur) { cur = []; red.push(cur); } cur.push(p); if (i) redKm += near && cur.length > 1 ? km(line[i - 1], p) : 0; } else cur = null;
  });
  // kilometre markers along the road (from Hasan Abdal), every 50 km
  const kmPts = [];
  for (let k = 50, i = 0; k < ch[ch.length - 1]; k += 50) {
    while (i < ch.length - 2 && ch[i + 1] < k) i++;
    const f = (k - ch[i]) / ((ch[i + 1] - ch[i]) || 1); kmPts.push({ type: "Feature", properties: { t: `km ${k}` }, geometry: { type: "Point", coordinates: [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f] } });
  }

  // ---------------------------------------------------------------- map
  mapboxgl.accessToken = cfg.mapboxToken;
  map = new mapboxgl.Map({ container: "kkh-map", style: "mapbox://styles/mapbox/satellite-v9", center: [74.3, 35.4], zoom: 6, pitch: 48, bearing: -12, antialias: true,
    customAttribution: "© OpenStreetMap contributors · glacier inventory: CPEC_KKH_Glacier_Inventory.xlsx", projection: "mercator" });
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
  addEventListener("pagehide", () => { if (map) map.remove(); });
  map.on("style.load", () => {
    // dark satellite with 3D terrain
    map.addSource("kkh-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
    map.setTerrain({ source: "kkh-dem", exaggeration: 1.35 });
    map.setFog({ color: "rgb(10,15,26)", "high-color": "rgb(14,24,48)", "horizon-blend": 0.06, "space-color": "rgb(2,4,10)", "star-intensity": 0.15 });
    const sat = map.getStyle().layers.find(l => l.type === "raster");
    if (sat) { map.setPaintProperty(sat.id, "raster-brightness-max", 0.62); map.setPaintProperty(sat.id, "raster-saturation", -0.25); map.setPaintProperty(sat.id, "raster-contrast", 0.08); }

    // boundaries from the project's own files (J&K disputed: LoC dashed, IIOJK labelled), as on the portal's other maps
    if (bnd && bnd.features) {
      map.addSource("kkh-bnd", { type: "geojson", data: bnd });
      map.addLayer({ id: "kkh-bnd-pk", type: "line", source: "kkh-bnd", filter: ["==", ["get", "layer"], "pakistan"], paint: { "line-color": "#fbbf24", "line-width": 1.6, "line-opacity": 0.7 } });
      map.addLayer({ id: "kkh-bnd-loc", type: "line", source: "kkh-bnd", filter: ["all", ["==", ["get", "layer"], "line"], ["in", "Line of Control", ["get", "name"]]], paint: { "line-color": "#f87171", "line-width": 1.6, "line-dasharray": [3, 2] } });
    }
    const iiojk = ov && ov.features && ov.features.find(f => f.properties.layer === "iiojk");
    if (iiojk) {
      map.addSource("kkh-iiojk", { type: "geojson", data: { type: "Feature", properties: { t: "INDIAN ILLEGALLY OCCUPIED\nJAMMU & KASHMIR\n(disputed territory)" }, geometry: { type: "Point", coordinates: [iiojk.properties.label_lon, iiojk.properties.label_lat] } } });
      map.addLayer({ id: "kkh-iiojk", type: "symbol", source: "kkh-iiojk", layout: { "text-field": ["get", "t"], "text-size": 11, "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#fde68a", "text-halo-color": "#000", "text-halo-width": 1.4 } });
    }

    // the road: G314 (context, dimmer), N-35 glowing, hazard sections in red, kilometre markers
    map.addSource("kkh-route", { type: "geojson", data: route });
    map.addLayer({ id: "kkh-g314", type: "line", source: "kkh-route", filter: ["==", ["get", "id"], "g314"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fbbf24", "line-width": 2, "line-opacity": 0.42, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "kkh-glow2", type: "line", source: "kkh-route", filter: ["==", ["get", "id"], "n35"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ff8a00", "line-width": 16, "line-opacity": 0.16, "line-blur": 10 } });
    map.addLayer({ id: "kkh-glow", type: "line", source: "kkh-route", filter: ["==", ["get", "id"], "n35"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffb020", "line-width": 6, "line-opacity": 0.45, "line-blur": 3 } });
    map.addLayer({ id: "kkh-road", type: "line", source: "kkh-route", filter: ["==", ["get", "id"], "n35"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffe1a3", "line-width": 2.2 } });
    map.addSource("kkh-red", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: red.filter(s => s.length > 1) } } });
    map.addLayer({ id: "kkh-red", type: "line", source: "kkh-red", layout: { "line-cap": "round" }, paint: { "line-color": "#ff3b4e", "line-width": 5, "line-blur": 1 } });
    map.addSource("kkh-kmk", { type: "geojson", data: { type: "FeatureCollection", features: kmPts } });
    map.addLayer({ id: "kkh-kmk", type: "circle", source: "kkh-kmk", paint: { "circle-radius": 3, "circle-color": "#0b1222", "circle-stroke-color": "#ffb020", "circle-stroke-width": 1.4 } });
    map.addLayer({ id: "kkh-kmk-t", type: "symbol", source: "kkh-kmk", minzoom: 6.6, layout: { "text-field": ["get", "t"], "text-size": 10, "text-offset": [0, 1], "text-anchor": "top", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#ffd58a", "text-halo-color": "#000", "text-halo-width": 1.2 } });

    // infrastructure on the route (OpenStreetMap): labelled only where OSM names it
    map.addSource("kkh-infra", { type: "geojson", data: infra });
    const KIND = ["match", ["get", "kind"], "tunnel", "#22d3ee", "avalanche gallery", "#c084fc", "dry port", "#a3e635", "#e2e8f0"];
    map.addLayer({ id: "kkh-bridge", type: "circle", source: "kkh-infra", filter: ["==", ["get", "kind"], "bridge"], minzoom: 8, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "length_m"], 0, 2.2, 400, 5], "circle-color": "#e2e8f0", "circle-stroke-color": "#0b1222", "circle-stroke-width": 1 } });
    map.addLayer({ id: "kkh-infra", type: "circle", source: "kkh-infra", filter: ["!=", ["get", "kind"], "bridge"], paint: { "circle-radius": 5, "circle-color": KIND, "circle-stroke-color": "#0b1222", "circle-stroke-width": 1.2 } });
    map.addLayer({ id: "kkh-infra-t", type: "symbol", source: "kkh-infra", filter: ["has", "name"], minzoom: 7.5, layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0.9, 0], "text-anchor": "left", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#e2e8f0", "text-halo-color": "#000", "text-halo-width": 1.3 } });

    // towns on the road
    map.addLayer({ id: "kkh-town", type: "circle", source: "kkh-route", filter: ["==", ["get", "id"], "town"], paint: { "circle-radius": 4, "circle-color": "#f8fafc", "circle-stroke-color": "#0b1222", "circle-stroke-width": 1.4 } });
    const invNames = S.filter(s => s.located).map(s => s.name);
    map.addLayer({ id: "kkh-town-t", type: "symbol", source: "kkh-route", filter: ["all", ["==", ["get", "id"], "town"], ["!", ["in", ["get", "name"], ["literal", invNames]]]], layout: { "text-field": ["get", "name"], "text-size": 12.5, "text-offset": [0.8, 0], "text-anchor": "left", "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"] }, paint: { "text-color": "#ffffff", "text-halo-color": "#000", "text-halo-width": 1.6 } });

    // glaciers (inventory coordinates) and settlements (sized by the inventory's population range)
    const gj = { type: "FeatureCollection", features: G.filter(g => g.located).map((g, k) => ({ type: "Feature", id: k, properties: { name: base(g.name), full: g.name, hazard: g.hazard }, geometry: { type: "Point", coordinates: [g.lon, g.lat] } })) };
    map.addSource("kkh-gl", { type: "geojson", data: gj });
    map.addLayer({ id: "kkh-gl-h", type: "circle", source: "kkh-gl", paint: { "circle-radius": 13, "circle-color": ["case", ["get", "hazard"], "#ff3b4e", "#7dd3fc"], "circle-opacity": 0.18, "circle-blur": 0.6 } });
    map.addLayer({ id: "kkh-gl", type: "circle", source: "kkh-gl", paint: { "circle-radius": 6, "circle-color": "#bae6fd", "circle-stroke-color": ["case", ["get", "hazard"], "#ff3b4e", "#0369a1"], "circle-stroke-width": 2 } });
    map.addLayer({ id: "kkh-gl-t", type: "symbol", source: "kkh-gl", layout: { "text-field": ["concat", ["get", "name"], " Glacier"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"] }, paint: { "text-color": "#bae6fd", "text-halo-color": "#000", "text-halo-width": 1.5 } });
    const sj = { type: "FeatureCollection", features: S.filter(s => s.located).map(s => ({ type: "Feature", properties: { name: s.name, hi: s.hi || 0 }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })) };
    map.addSource("kkh-st", { type: "geojson", data: sj });
    map.addLayer({ id: "kkh-st", type: "circle", source: "kkh-st", paint: { "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "hi"]], 0, 5, 50, 12], "circle-color": "#34d399", "circle-opacity": 0.55, "circle-stroke-color": "#ecfdf5", "circle-stroke-width": 1.4 } });
    map.addLayer({ id: "kkh-st-t", type: "symbol", source: "kkh-st", layout: { "text-field": ["get", "name"], "text-size": 11.5, "text-offset": [0, -1.5], "text-anchor": "bottom", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#bbf7d0", "text-halo-color": "#000", "text-halo-width": 1.4 } });

    // clicks
    map.on("click", "kkh-gl", e => glacierCard(G.find(g => g.name === e.features[0].properties.full), true));
    map.on("click", "kkh-st", e => settlementCard(S.find(s => s.name === e.features[0].properties.name)));
    const pop = new mapboxgl.Popup({ className: "kkh-pop", closeButton: false, offset: 10 });
    const tip = (layer, html) => { map.on("mouseenter", layer, e => { map.getCanvas().style.cursor = "pointer"; pop.setLngLat(e.features[0].geometry.coordinates).setHTML(html(e.features[0].properties)).addTo(map); });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; pop.remove(); }); };
    const ik = p => `<b>${esc(p.name || p.kind[0].toUpperCase() + p.kind.slice(1))}</b><br>${esc(p.kind)}${p.length_m ? ` · ${fmt(p.length_m)} m` : ""} · km ${p.chainage_km} from Hasan Abdal<br><small>OpenStreetMap way ${p.id}</small>`;
    tip("kkh-infra", ik); tip("kkh-bridge", ik);
    tip("kkh-town", p => `<b>${esc(p.name)}</b><br>km ${p.chainage_km} from Hasan Abdal<br><small>OpenStreetMap ${esc(p.osm)}</small>`);
    ["kkh-gl", "kkh-st"].forEach(l => { map.on("mouseenter", l, () => { map.getCanvas().style.cursor = "pointer"; }); map.on("mouseleave", l, () => { map.getCanvas().style.cursor = ""; }); });

    const b = line.reduce((bb, p) => bb.extend(p), new mapboxgl.LngLatBounds(line[0], line[0]));
    map.fitBounds(b, { padding: { left: innerWidth > 860 ? 340 : 30, right: 40, top: 80, bottom: 140 }, pitch: 42, bearing: -10, duration: 0 });
    map.once("idle", () => $("[data-load]").classList.add("off"));
    setTimeout(() => $("[data-load]").classList.add("off"), 9000);
  });

  // ---------------------------------------------------------------- side list: glaciers in road order (located), then the rest
  const along = G.filter(g => g.located).sort((a, b) => a.c.road_chainage_km - b.c.road_chainage_km), rest = G.filter(g => !g.located);
  const conf = c => `<span class="kkh-tag ${esc(String(c || "").toLowerCase())}">${esc(c || "—")}</span>`;
  $("[data-sub]").textContent = `${G.length} glaciers in the inventory · ${along.length} located · straight-line distance to the road from the inventory's coordinate`;
  $("[data-list]").innerHTML = along.map(g => `<button type="button" class="kkh-item" data-g="${esc(g.name)}"><span class="kkh-km">km ${fmt(g.c.road_chainage_km)}<small>${fmt(g.c.road_distance_km, 1)} km off</small></span>
      <span><b>${esc(base(g.name))}${conf(g.r.Confidence)}</b><span>${esc(g.r.Type || "")}${g.hazard ? " · hazard noted" : ""}</span></span></button>`).join("")
    + `<div class="kkh-sec">Location not in the inventory (${rest.length})</div>`
    + rest.map(g => `<button type="button" class="kkh-item kkh-nl" data-g="${esc(g.name)}"><span class="kkh-km">—<small>not located</small></span>
      <span><b>${esc(base(g.name))}${conf(g.r.Confidence)}</b><span>${esc(g.r["Relation to CPEC / KKH"] || "")}</span></span></button>`).join("");
  $("[data-list]").addEventListener("click", e => { const b = e.target.closest("[data-g]"); if (!b) return; glacierCard(G.find(g => g.name === b.dataset.g), true); });

  // ---------------------------------------------------------------- legend
  $("[data-leg]").innerHTML = `
    <div><i class="l" style="background:#ffb020;box-shadow:0 0 8px #ff8a00"></i>Karakoram Highway N-35 · ${fmt(n35.properties.length_km, 1)} km</div>
    <div><i class="l" style="background:repeating-linear-gradient(90deg,#fbbf24 0 6px,transparent 6px 10px);opacity:.7"></i>G314, China (context)</div>
    <div><i class="l" style="background:#ff3b4e"></i>Road within ${HAZARD_KM} km of a hazard glacier · ${redKm ? `${fmt(redKm, 1)} km` : "none from the located glaciers"}</div>
    <div><i class="d" style="background:#bae6fd;border-color:#ff3b4e;border-width:2px"></i>Glacier (inventory coordinate) · red ring = hazard noted</div>
    <div><i class="d" style="background:#34d399"></i>Settlement · size = population (high end of range)</div>
    <div><i class="d" style="background:#22d3ee"></i>Tunnel <i class="d" style="background:#c084fc;margin-left:6px"></i>Avalanche gallery <i class="d" style="background:#e2e8f0;margin-left:6px"></i>Bridge</div>
    <div><i class="d" style="background:#a3e635"></i>Sost dry port · <i class="d" style="background:#fff"></i>Town</div>
    <div class="att">Road, structures, towns: © OpenStreetMap contributors · values: the glacier inventory, as compiled</div>`;

  // ---------------------------------------------------------------- cards (every inventory field, its sources)
  const card = $(".kkh-card");
  const srcList = s => { const ids = String(s || "").split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
    return ids.length ? `<ol class="kkh-src">${ids.map(id => { const x = SRC.get(id); return `<li><b>${esc(id)}</b> ${x ? (x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.source)}</a>` : esc(x.source)) : "not in the source list"}</li>`; }).join("")}</ol>` : ""; };
  const dl = (rec, cols, skip) => `<dl>${cols.filter(c => !skip.includes(c)).map(c => `<div><dt>${esc(c)}</dt><dd>${NF(rec[c]) ? `<span class="kkh-nf">${esc(rec[c] == null || rec[c] === "" ? "not recorded" : rec[c])}</span>` : esc(rec[c])}</dd></div>`).join("")}</dl>`;
  function show(html) { card.innerHTML = html; card.scrollTop = 0; card.classList.add("on"); app.classList.add("kkh-carded"); card.querySelector(".kkh-close").onclick = hideCard; }
  function hideCard() { card.classList.remove("on"); app.classList.remove("kkh-carded"); }
  function glacierCard(g, fly) {
    if (!g) return;
    document.querySelectorAll(".kkh-item").forEach(b => b.classList.toggle("on", b.dataset.g === g.name));
    const c = g.c;
    show(`<div class="kkh-eb"><span>Glacier · inventory row ${g.r._row}</span><span class="kkh-sp"></span><button type="button" class="kkh-close" aria-label="Close">×</button></div>
      <h3>${esc(g.name)}</h3>
      <div class="kkh-pills">${conf(g.r.Confidence)}<span>${esc(g.r.Type || "")}</span>${c.located ? `<span class="road">km ${fmt(c.road_chainage_km)} of the KKH · ${fmt(c.road_distance_km, 1)} km away</span>` : ""}${g.hazard ? `<span style="color:#fca5a5">hazard noted</span>` : ""}</div>
      ${dl(g.r, inv.glaciers.columns, ["Glacier", "Sources", "Confidence"])}
      <div class="kkh-comp">${c.located ? `<b>Computed:</b> ${fmt(c.road_distance_km, 1)} km in a straight line from the inventory's coordinate to the nearest point of the highway, at km ${fmt(c.road_chainage_km, 1)} from Hasan Abdal. Not a flow-path distance; the glacier outline is not used yet.`
        : `<b>Not on the map:</b> the inventory gives no coordinates ("Not found"). A sourced coordinate (GLIMS / RGI outline) will be proposed for approval; nothing is guessed.`}</div>
      <h4 style="margin:14px 0 0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc">Sources</h4>${srcList(g.r.Sources)}
      <p class="kkh-fine">${esc(inv.glaciers.notes.join(" "))}</p>`);
    if (fly && g.located && map) map.flyTo({ center: [g.lon, g.lat], zoom: 10.6, pitch: 62, bearing: -20, duration: calm ? 0 : 2600, essential: true, padding: { right: innerWidth > 860 ? 420 : 0 } });
  }
  function settlementCard(s) {
    if (!s) return;
    const range = s.lo == null && s.hi == null ? "not recorded" : `${s.lo != null ? fmt(s.lo) : "?"} – ${s.hi != null ? fmt(s.hi) : "?"}`;
    show(`<div class="kkh-eb"><span>Settlement · inventory row ${s.r._row}</span><span class="kkh-sp"></span><button type="button" class="kkh-close" aria-label="Close">×</button></div>
      <h3>${esc(s.name)}</h3>
      <div class="kkh-pills">${conf(s.r.Confidence)}<span>Population (range): ${esc(range)}</span></div>
      ${dl(s.r, inv.settlements.columns, ["Settlement", "Sources", "Confidence", "Midpoint estimate"])}
      <h4 style="margin:14px 0 0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc">Sources</h4>${srcList(s.r.Sources)}
      <p class="kkh-fine">${esc(inv.settlements.notes.join(" "))} Population is shown as the inventory's range, never as one number.</p>`);
    if (s.located && map) map.flyTo({ center: [s.lon, s.lat], zoom: 11, pitch: 60, duration: calm ? 0 : 2400, essential: true, padding: { right: innerWidth > 860 ? 420 : 0 } });
  }
  function eventCard(ev, i) {
    document.querySelectorAll(".kkh-tl button").forEach((b, k) => b.classList.toggle("on", k === i));
    show(`<div class="kkh-eb"><span>Event · inventory row ${ev._row}</span><span class="kkh-sp"></span><button type="button" class="kkh-close" aria-label="Close">×</button></div>
      <h3>${esc(ev["Glacier / place"])}</h3><div class="kkh-pills"><span>${esc(ev.Date)}</span></div>
      ${dl(ev, inv.events.columns, ["Sources", "Glacier / place", "Date"])}
      <h4 style="margin:14px 0 0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc">Sources</h4>${srcList(ev.Sources)}`);
    // fly to the place when the inventory locates it (the glacier, else the settlement named); otherwise show the whole road
    const toks = String(ev["Glacier / place"]).split(/[\/;()]/).map(t => t.trim().toLowerCase()).filter(Boolean);
    const g = G.find(x => x.located && toks.some(t => base(x.name).toLowerCase() === t)), s = S.find(x => x.located && toks.some(t => x.name.toLowerCase().startsWith(t)));
    const at = g ? [g.lon, g.lat] : s ? [s.lon, s.lat] : null;
    if (map) at ? map.flyTo({ center: at, zoom: 10.8, pitch: 60, duration: calm ? 0 : 2400, essential: true, padding: { right: innerWidth > 860 ? 420 : 0 } })
      : map.fitBounds(line.reduce((bb, p) => bb.extend(p), new mapboxgl.LngLatBounds(line[0], line[0])), { padding: { left: 340, right: 440, top: 80, bottom: 140 }, duration: calm ? 0 : 2000 });
  }
  $("[data-ev]").innerHTML = inv.events.rows.map((ev, i) => `<button type="button" data-i="${i}"><b>${esc(ev.Date)}</b><span>${esc(ev["Glacier / place"])}</span><span style="color:#a3b3c8">${esc(ev.Event)}</span></button>`).join("");
  $("[data-ev]").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) eventCard(inv.events.rows[+b.dataset.i], +b.dataset.i); });
}
