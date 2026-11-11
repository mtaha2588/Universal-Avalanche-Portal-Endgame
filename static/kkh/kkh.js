/* Settlement & Infrastructure tab (static/kkh/kkh.html, served at /kkh, opened from the portal's tab in a full-screen overlay).
   One module, nothing on window. Its own Mapbox map: created when the page opens, removed when it closes.

   Data (all in static/kkh/data/):
   - kkh_route.geojson          the Karakoram Highway N-35 from OpenStreetMap (relation 2441750), the G314 in China (context) and the towns on it
   - kkh_infrastructure.geojson tunnels, avalanche galleries, bridges and the Sost dry port on the route (OpenStreetMap)
   - kkh_inventory.json         CPEC_KKH_Glacier_Inventory.xlsx, every value exactly as in the workbook, plus computed road distances
   Labels only where the source has a name. Glaciers and settlements whose coordinates are "Not found" in the inventory are listed but
   not drawn: they are never placed by guess. Population is always shown as the inventory's low-high range. */

// what this page reports to the server while it starts (/kkh/log): stages and errors, so a blank tab can be diagnosed
const report = (stage, msg = "") => { try { navigator.sendBeacon("/kkh/log", new Blob([JSON.stringify({ stage, msg: String(msg).slice(0, 280) })], { type: "application/json" })); } catch { /* offline */ } };
report("start", `${innerWidth}x${innerHeight} ${navigator.userAgent.slice(0, 70)}`);
addEventListener("error", e => report("error", `${e.message} @${(e.filename || "").split("/").pop()}:${e.lineno}`));
addEventListener("unhandledrejection", e => report("reject", e.reason && (e.reason.message || e.reason)));
const cfg = JSON.parse(document.getElementById("kkh-cfg").textContent || "{}");
const V = cfg.v || 0;
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 0) => (+n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const dShortK = s => { const d = new Date(String(s) + "T00:00:00Z"); return isNaN(d) ? String(s) : `${d.getUTCDate()} ${"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[d.getUTCMonth()]}`; };
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
    <button type="button" class="kkh-btn" data-a="3d" title="Drive the highway in 3D, coloured by danger">${I.mtn}CPEC Safety Tour</button>
    <button type="button" class="kkh-btn kkh-x" data-a="close" title="Close (Esc)" aria-label="Close">${I.close}</button></header>
  <aside class="kkh-side" aria-label="Glaciers along the road"><h4>Glaciers along the KKH</h4><div class="kkh-sub" data-sub>—</div><div class="kkh-list" data-list></div></aside>
  <aside class="kkh-card" aria-live="polite"></aside>
  <div class="kkh-leg" data-leg></div>
  <section class="kkh-tl" aria-label="Events timeline"><h4>Events on the KKH · glacier surges, outburst floods and alerts, on a time axis <span>click an event for its record · hatched = approximate date</span></h4><div class="kkh-ev" data-ev></div></section>
  <div class="kkh-toast" data-toast></div>
  <div class="kkh-load" data-load><b>Karakoram Highway</b><span>Loading the road, glaciers and terrain…</span></div>`);
const toast = t => { const el = $("[data-toast]"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.k); toast.k = setTimeout(() => el.classList.remove("on"), 3600); };
const inFrame = window.parent && window.parent !== window;
function close() { if (map) { map.remove(); map = null; } if (inFrame) window.parent.postMessage({ type: "kkh:close" }, location.origin); else location.href = "/#home"; }
app.addEventListener("click", e => {
  const a = e.target.closest("[data-a]"); if (!a) return;
  if (a.dataset.a === "close") close();
  if (a.dataset.a === "3d") routeTour ? routeTour() : toast("The forecast is still loading: try again in a moment.");
});
addEventListener("keydown", e => { if (e.key === " " && pauseRouteTour && pauseRouteTour()) { e.preventDefault(); return; } if (e.key === "Escape") { if (stopRouteTour && stopRouteTour()) return; if ($(".kkh-card").classList.contains("on")) { $(".kkh-card").classList.remove("on"); app.classList.remove("kkh-carded"); } else close(); } });

// ------------------------------------------------------------------ data
const get = p => fetch(`/static/kkh/data/${p}?v=${V}`).then(r => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
let map = null, routeTour = null, stopRouteTour = null, pauseRouteTour = null;
Promise.all([get("kkh_route.geojson"), get("kkh_infrastructure.geojson"), get("kkh_inventory.json"),
  fetch("/api/layer/boundaries").then(r => r.ok ? r.json() : null).catch(() => null), fetch("/static/geo/official_view.geojson").then(r => r.ok ? r.json() : null).catch(() => null)])
  .then(d => { report("data", `route ${d[0].features.length} · infra ${d[1].features.length} · glaciers ${d[2].glaciers.rows.length}`); start(d); })
  .catch(e => { report("data-fail", e.message); $("[data-load]").innerHTML = `<b>The tab could not load its data</b><span>${esc(e.message)}</span>`; });

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
  try {                                                                 // (a map that cannot start must not stop the list, cards and timeline)
  if (!window.mapboxgl) throw new Error("the Mapbox library did not load (network or blocker)");
  if (!mapboxgl.supported || !mapboxgl.supported()) throw new Error("this browser has WebGL switched off");
  mapboxgl.accessToken = cfg.mapboxToken;
  map = new mapboxgl.Map({ container: "kkh-map", style: "mapbox://styles/mapbox/satellite-v9", center: [74.3, 35.4], zoom: 6, pitch: 48, bearing: -12, antialias: true,
    customAttribution: "© OpenStreetMap contributors · glacier inventory: CPEC_KKH_Glacier_Inventory.xlsx", projection: "mercator" });
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
  map.on("error", e => report("map-error", (e.error && e.error.message) || e.message || "map error"));
  map.once("load", () => report("map-load"));
  map.once("idle", () => report("map-idle"));
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
    report("style", "layers added");
    readyRes();                                                       // the extra layers (glaciers, forecast) go on top now
  });
  } catch (e) {
    report("map-fail", e.message);
    map = null;
    $("[data-load]").classList.add("off");
    $("#kkh-map").innerHTML = `<div style="position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:24px;color:#fca5a5">
      <b style="font-size:16px">The 3D map could not start: ${esc(e.message)}</b><span style="color:#a3b3c8">The glacier list, cards and events below still work.</span></div>`;
  }

  // ---------------------------------------------------------------- all glaciers near the road, and the avalanche chance along it
  // (1) every glacier of Glacier_Slope_Distance_KKH_CPEC.csv (6,778, within 50 km of the road) coloured by its mean slope class, with the
  //     RGI 7.0 outlines; (2) the road next to a glacier within 5 km (the CSV's distance) on 30-45 degree slopes, in red; (3) the portal's
  //     avalanche alert forecast (forecast/, ECMWF IFS, 0.25 degree tiles, 15 days) on the tiles the road crosses, with the road coloured
  //     by that day's level. Slope classes describe the terrain; the alert levels are the forecast's own.
  const SLOPE = [["under 25°", "#93c5fd", s => s < 25], ["25–30°", "#facc15", s => s >= 25 && s < 30], ["30–45° · prime avalanche terrain", "#f97316", s => s >= 30 && s <= 45], ["over 45° · frequent sluffs", "#c084fc", s => s > 45]];
  const slopeOf = s => SLOPE.find(x => x[2](s)) || SLOPE[0];
  const more = Promise.all([get("kkh_glaciers.geojson"), get("kkh_glacier_outlines.geojson"),
    fetch("/api/alertforecast/tiles.geojson").then(r => r.ok ? r.json() : null).catch(() => null), fetch("/api/alertforecast/latest").then(r => r.ok ? r.json() : null).catch(() => null)])
    .then(d => { report("more", `glaciers ${d[0].features.length} · outlines ${d[1].features.length} · forecast tiles ${d[2] ? d[2].features.length : 0}`); return d; })
    .catch(e => { report("more-fail", e.message); return null; });
  let GL = [], FC = null, days = [], day = null, tileAt = () => null;
  const tkey = (lon, lat) => `${Math.floor(lon / 0.25)}_${Math.floor(lat / 0.25)}`;
  more.then(d => {
    if (!d) return;
    const [gl, , fc] = d;
    GL = gl.features;
    GL.forEach(f => { const s = f.properties.slope_mean; f.properties.cls = slopeOf(s)[0]; f.properties.col = slopeOf(s)[1]; });
    // the road next to a steep glacier within 5 km: the 4 km of road around that glacier's nearest road point
    const exp = GL.filter(f => f.properties.prone && f.properties.dist_km != null && f.properties.dist_km <= 5).map(f => f.properties.road_km);
    const onRed = k => exp.some(r => Math.abs(r - k) <= 2);
    const segs = []; let curS = null, expKm = 0;
    line.forEach((p, i) => { if (onRed(ch[i])) { if (!curS) { curS = []; segs.push(curS); } curS.push(p); if (i && curS.length > 1) expKm += ch[i] - ch[i - 1]; } else curS = null; });
    redKmGl = expKm; redSegs = segs.filter(s => s.length > 1);
    // forecast tiles the road crosses (and their neighbours, so a valley's tiles show)
    if (fc && fc.features && fc.features.length) {
      const near = new Set(); line.forEach(p => { const i = Math.floor(p[0] / 0.25), j = Math.floor(p[1] / 0.25); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) near.add(`${i + a}_${j + b}`); });
      const by = new Map();
      fc.features.forEach(f => { const c = f.geometry.coordinates[0][0], k = tkey(c[0] + 0.01, c[1] + 0.01); if (!near.has(k)) return;
        const dt = f.properties.date; if (!by.has(dt)) by.set(dt, new Map()); by.get(dt).set(k, f); });
      days = [...by.keys()].sort(); day = days[0];
      FC = by; tileAt = (lon, lat, dt = day) => (FC.get(dt) || new Map()).get(tkey(lon, lat)) || null;
    }
    ready.then(addMore);
  });
  let redKmGl = 0, redSegs = [], readyRes; const ready = new Promise(r => { readyRes = r; });
  function roadByLevel(dt) {
    // the N-35 split into runs by the alert level of the tile under each vertex; km per level
    const runs = [], kmBy = new Map(); let cur = null;
    line.forEach((p, i) => { const t = tileAt(p[0], p[1], dt), lv = t ? t.properties.level : -9, col = t ? t.properties.color : "#64748b", nm = t ? t.properties.level_name : "no forecast tile";
      if (!cur || cur.lv !== lv) { cur = { lv, col, nm, pts: cur ? [cur.pts[cur.pts.length - 1]] : [] }; runs.push(cur); }
      cur.pts.push(p); if (i) kmBy.set(nm, (kmBy.get(nm) || 0) + (ch[i] - ch[i - 1])); });
    return { fc: { type: "FeatureCollection", features: runs.filter(r => r.pts.length > 1).map(r => ({ type: "Feature", properties: { col: r.col, lv: r.lv }, geometry: { type: "LineString", coordinates: r.pts } })) }, kmBy };
  }
  function addMore() {
    if (!map) return;
    more.then(d => {
      if (!d || !map) return;
      const before = map.getLayer("kkh-glow2") ? "kkh-glow2" : undefined;
      // glacier outlines (RGI 7.0) and glacier points (the CSV)
      map.addSource("kkh-outl", { type: "geojson", data: d[1] });
      map.addLayer({ id: "kkh-outl-f", type: "fill", source: "kkh-outl", paint: { "fill-color": "#e0f2fe", "fill-opacity": 0.16 } }, before);
      map.addLayer({ id: "kkh-outl-l", type: "line", source: "kkh-outl", minzoom: 8, paint: { "line-color": "#bae6fd", "line-width": 0.8, "line-opacity": 0.55 } }, before);
      map.addSource("kkh-gall", { type: "geojson", data: { type: "FeatureCollection", features: GL } });
      map.addLayer({ id: "kkh-gall", type: "circle", source: "kkh-gall", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["interpolate", ["linear"], ["sqrt", ["get", "area_km2"]], 0, 1.4, 5, 4], 11, ["interpolate", ["linear"], ["sqrt", ["get", "area_km2"]], 0, 3, 5, 10]],
        "circle-color": ["get", "col"], "circle-opacity": 0.85, "circle-stroke-color": "#0b1222", "circle-stroke-width": 0.6 } }, before);
      map.addLayer({ id: "kkh-gall-t", type: "symbol", source: "kkh-gall", filter: ["has", "name"], minzoom: 9, layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": "#e0f2fe", "text-halo-color": "#000", "text-halo-width": 1.3 } });
      // the road next to steep glaciers
      map.getSource("kkh-red").setData({ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: redSegs } });
      // the avalanche alert forecast along the road
      if (FC) {
        map.addSource("kkh-fc", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        // forecast squares drawn like a map, not a paint spill: no solid fill over the 3D relief (it smeared across ridges), but a light
        // tint + fine diagonal hatching for Moderate / High, a crisp outline in the level's colour, and only a faint grid line for Low
        const hatch = (id, rgb) => { if (map.hasImage(id)) return; const n = 12, c = document.createElement("canvas"); c.width = c.height = n; const g = c.getContext("2d");
          g.strokeStyle = `rgba(${rgb},.85)`; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, n); g.lineTo(n, 0); g.moveTo(-n / 2, n / 2); g.lineTo(n / 2, -n / 2); g.moveTo(n / 2, n * 1.5); g.lineTo(n * 1.5, n / 2); g.stroke();
          map.addImage(id, g.getImageData(0, 0, n, n), { pixelRatio: 2 }); };
        hatch("kkh-hatch-1", "255,163,26"); hatch("kkh-hatch-2", "255,45,85");
        map.addLayer({ id: "kkh-fc", type: "fill", source: "kkh-fc", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["<=", ["get", "level"], 0], 0, 0.07] } }, "kkh-outl-f");
        [1, 2].forEach(lv => map.addLayer({ id: `kkh-fc-h${lv}`, type: "fill", source: "kkh-fc", filter: ["==", ["get", "level"], lv], paint: { "fill-pattern": `kkh-hatch-${lv}`, "fill-opacity": 0.55 } }, "kkh-outl-f"));
        map.addLayer({ id: "kkh-fc-l", type: "line", source: "kkh-fc", layout: { "line-join": "miter" }, paint: { "line-color": ["case", [">=", ["get", "level"], 1], ["get", "color"], "#cbd5e1"],
          "line-width": ["case", [">=", ["get", "level"], 1], 1.6, 0.5], "line-opacity": ["case", [">=", ["get", "level"], 1], 0.95, 0.22] } }, "kkh-outl-f");
        map.addSource("kkh-lvl", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "kkh-lvl", type: "line", source: "kkh-lvl", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "col"], "line-width": ["case", [">=", ["get", "lv"], 1], 4.2, 0], "line-opacity": 0.95 } }, "kkh-red");
        setDay(day);
      }
      map.on("click", "kkh-gall", e => csvCard(e.features[0].properties));
      map.on("mouseenter", "kkh-gall", () => { map.getCanvas().style.cursor = "pointer"; }); map.on("mouseleave", "kkh-gall", () => { map.getCanvas().style.cursor = ""; });
      map.on("click", "kkh-fc", e => { if (map.queryRenderedFeatures(e.point, { layers: ["kkh-gall", "kkh-gl", "kkh-st"] }).length) return; fcPopup(e); });
      legendMore();
      initDanger();
      report("more-layers", `red ${redKmGl.toFixed(1)} km`);
    });
  }
  const fcPop = map ? new mapboxgl.Popup({ className: "kkh-pop", closeButton: true, offset: 6 }) : null;
  function fcPopup(e) {
    const p = e.features[0].properties;
    fcPop.setLngLat(e.lngLat).setHTML(`<b>${esc(p.level_name)}</b> · forecast for ${esc(p.date)} (lead day ${p.lead_day})<br>tile ${esc(p.tile_id)} · ${esc(p.region)} · ${fmt(p.elev_m)} m<br>
      snowfall 3 d ${fmt(p.sf_3d_mm, 1)} mm · 7 d ${fmt(p.sf_7d_mm, 1)} mm<br>gust max 3 d ${fmt(p.gust_max_3d_ms, 1)} m/s · snow depth ${fmt(p.snow_depth_m, 2)} m<br><small>ECMWF IFS through the portal's alert forecast engine</small>`).addTo(map);
  }
  function setDay(dt) {
    day = dt;
    if (!map || !FC || !map.getSource("kkh-fc")) return;
    map.getSource("kkh-fc").setData({ type: "FeatureCollection", features: [...(FC.get(dt) || new Map()).values()] });
    const r = roadByLevel(dt); map.getSource("kkh-lvl").setData(r.fc);
    document.querySelectorAll("[data-day]").forEach(b => b.classList.toggle("on", b.dataset.day === dt));
    const box = document.querySelector("[data-daykm]");
    if (box) box.innerHTML = [...r.kmBy.entries()].sort((a, b) => b[1] - a[1]).map(([n, k]) => `<span>${esc(n)} <b>${fmt(k)} km</b></span>`).join(" · ");
  }
  function legendMore() {
    const leg = document.querySelector("[data-leg]"); if (!leg) return;
    const lv = FC ? [...new Map([...FC.values()].flatMap(m => [...m.values()]).map(f => [f.properties.level, [f.properties.level_name, f.properties.color]])).entries()].sort((a, b) => a[0] - b[0]) : [];
    leg.insertAdjacentHTML("afterbegin", `<div style="color:#7dd3fc;font-weight:700;letter-spacing:.08em;font-size:10.5px">GLACIERS NEAR THE ROAD (${fmt(GL.length)})</div>
      ${SLOPE.map(s => `<div><i class="d" style="background:${s[1]}"></i>Mean slope ${esc(s[0])}</div>`).join("")}
      <div><i class="l" style="background:#e0f2fe;opacity:.5;height:8px"></i>Glacier outline (RGI 7.0)</div>
      <div><i class="l" style="background:#facc15"></i>Road beside a 30–45° glacier within 5 km: ${fmt(redKmGl, 1)} km</div>
      ${FC ? `<div style="color:#7dd3fc;font-weight:700;letter-spacing:.08em;font-size:10.5px;margin-top:6px">AVALANCHE ALERT FORECAST (squares, for the picked day)</div>${lv.map(([, [n, c]]) => `<div><i class="d" style="background:${c}"></i>${esc(n)}</div>`).join("")}` : ""}
      <hr style="border:0;border-top:1px solid rgba(170,200,235,.16);margin:6px 0">`);
    if (false) {                                                        // (replaced by the danger panel, initDanger)
      app.insertAdjacentHTML("beforeend", `<div class="kkh-days" data-days><b>Avalanche forecast day</b>${days.map(dt => `<button type="button" data-day="${dt}">${esc(dt.slice(5))}</button>`).join("")}<span class="kkh-daykm" data-daykm></span></div>`);
      document.querySelector("[data-days]").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (b) setDay(b.dataset.day); });
      setDay(day);
    }
  }
  function csvCard(p) {
    const lv = tileAt(...(GL.find(f => f.properties.id === p.id) || { geometry: { coordinates: [0, 0] } }).geometry.coordinates);
    const rows = [["GLIMS id", p.id], ["Name", p.name || "not named"], ["Range", p.range], ["Area", `${fmt(p.area_km2, 3)} km²`], ["Distance to KKH / CPEC (CSV)", `${fmt(p.dist_km, 2)} km`],
      ["Mean elevation", `${fmt(p.elev_mean_m)} m`], ["Slope mean / median", `${fmt(p.slope_mean, 1)}° / ${fmt(p.slope_median, 1)}°`], ["Slope min – max (sd)", `${fmt(p.slope_min, 1)}° – ${fmt(p.slope_max, 1)}° (${fmt(p.slope_std, 1)}°)`],
      ["Avalanche terrain (slope)", p.cls], ["Nearest road point", `km ${fmt(p.road_km, 1)} from Hasan Abdal (centroid ${fmt(p.centroid_road_km, 1)} km from the line)`],
      ["Alert forecast here", lv ? `${lv.properties.level_name} on ${lv.properties.date} (tile ${lv.properties.tile_id})` : "no forecast tile"]];
    show(`<div class="kkh-eb"><span>Glacier · Glacier_Slope_Distance_KKH_CPEC.csv</span><span class="kkh-sp"></span><button type="button" class="kkh-close" aria-label="Close">×</button></div>
      <h3>${esc(p.name || p.id)}</h3><div class="kkh-pills"><span style="color:${esc(p.col)}">${esc(p.cls)}</span>${lv ? `<span>Forecast: ${esc(lv.properties.level_name)}</span>` : ""}</div>
      <dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      <p class="kkh-fine">Slope classes describe the terrain (most slab avalanches start on 30–45° slopes); they are not a forecast. The alert level is the portal's forecast for the 0.25° tile around the glacier's centre.</p>`);
  }
  // side list, second tab: the glaciers nearest the road (the CSV's distance), the closest first
  function renderNear() {
    const side = document.querySelector(".kkh-side"); if (!side || side.querySelector("[data-tabs]")) return;
    const near = GL.filter(f => f.properties.dist_km != null && f.properties.dist_km <= 5).sort((a, b) => a.properties.dist_km - b.properties.dist_km);
    side.querySelector("h4").insertAdjacentHTML("afterend", `<div class="kkh-tabs" data-tabs><button type="button" class="on" data-t="inv">Inventory ${G.length}</button><button type="button" data-t="near" title="Glaciers within 5 km of the road">≤ 5 km · ${fmt(near.length)}</button></div>`);
    const list = side.querySelector("[data-list]"), sub = side.querySelector("[data-sub]"), invHTML = list.innerHTML, invSub = sub.textContent;
    const nearHTML = near.map(f => { const p = f.properties; return `<button type="button" class="kkh-item" data-csv="${esc(p.id)}" title="${esc(p.cls)} · ${fmt(p.area_km2, 2)} km²"><span class="kkh-km">${fmt(p.dist_km, 1)} km</span>
      <span><b><i class="kkh-sd" style="background:${p.col}"></i>${esc(p.name || "unnamed")}</b><small>km ${fmt(p.road_km)} · ${esc(String(p.cls).split(" · ")[0])}</small></span></button>`; }).join("");
    side.querySelector("[data-tabs]").addEventListener("click", e => {
      const b = e.target.closest("[data-t]"); if (!b) return;
      side.querySelectorAll("[data-tabs] button").forEach(x => x.classList.toggle("on", x === b));
      if (b.dataset.t === "near") { list.innerHTML = nearHTML; sub.textContent = "closest first · dot = mean slope"; }
      else { list.innerHTML = invHTML; sub.textContent = invSub; }
    });
    list.addEventListener("click", e => { const b = e.target.closest("[data-csv]"); if (!b) return; const f = GL.find(x => x.properties.id === b.dataset.csv); if (!f) return;
      csvCard(f.properties); if (map) map.flyTo({ center: f.geometry.coordinates, zoom: 12, pitch: 62, duration: calm ? 0 : 2400, essential: true, padding: { right: innerWidth > 860 ? 420 : 0 } }); });
  }
  more.then(d => { if (d) renderNear(); });
  // ---------------------------------------------------------------- danger along the road: 15-day forecast x terrain, and the route tour
  // One class per kilometre of road, from data only (a screening, not an official warning):
  //   High      forecast alert High, or a 30-45 degree glacier within 5 km AND forecast 3-day snowfall of 25 mm or more
  //   Elevated  forecast alert Moderate, or such a glacier AND 10 mm or more, or a recorded outburst flood site (inventory events)
  //   Watch     such a glacier with less snow forecast, or 10 mm or more with no steep glacier beside the road
  //   Lower     none of these;   Not rated: no forecast tile there and no steep glacier
  // 10 mm and 25 mm are the alert forecast's own snowfall floors for Moderate and High. "15 days" takes each kilometre's worst day.
  // GREEN  relatively safe / lower identified exposure: none of the indicators below (never "safe": no record is not no hazard)
  // ORANGE moderate exposure: a 30-45 degree glacier within 5 km, or 10 mm+ forecast snowfall in 3 days, or alert Moderate, or a historical
  //        avalanche record within 5 km of the road (proximity only: not proof that it reached the road)
  // RED    high exposure: alert High, or steep glacier AND 25 mm+ snowfall, or a recorded event that damaged the highway here (observed)
  // colours picked to read on dark satellite imagery and apart from each other (and from the glacier slope classes): mint green, amber, crimson
  const DZ = [["Relatively safe · lower identified exposure", "#22E07A"], ["Moderate exposure", "#FFA31A"], ["High exposure", "#FF2D55"], ["Not rated", "#8A9AB0"]];
  const DZS = ["Lower exposure", "Moderate", "High", "Not rated"];
  let HIST = [], STN = [], selN = 15, hiddenC = [];
  const SNW = [[25, "#ef4444", "25 mm or more"], [10, "#f59e0b", "10–25 mm"], [1, "#38bdf8", "1–10 mm"], [0.05, "#bae6fd", "under 1 mm"], [-1, "#475569", "none"]];
  const snowCol = v => v == null ? "#94a3b8" : SNW.find(x => v >= x[0])[1];
  const ptAt = k => { let a = 0, b = ch.length - 1; while (b - a > 1) { const m = (a + b) >> 1; if (ch[m] < k) a = m; else b = m; }
    const f = Math.max(0, Math.min(1, (k - ch[a]) / ((ch[b] - ch[a]) || 1))); return [line[a][0] + (line[b][0] - line[a][0]) * f, line[a][1] + (line[b][1] - line[a][1]) * f]; };
  const slice = (k0, k1) => { const out = [ptAt(k0)]; for (let i = 0; i < ch.length; i++) if (ch[i] > k0 && ch[i] < k1) out.push(line[i]); out.push(ptAt(k1)); return out; };
  const NK = Math.floor(ch[ch.length - 1]);
  const towns = route.features.filter(f => f.properties.id === "town").map(f => f.properties).sort((a, b) => a.chainage_km - b.chainage_km);
  let KM = [], mode = "danger", selDay = null, tour = null;
  const dIdx = () => selDay != null ? days.indexOf(selDay) : selN < days.length ? [0, selN] : null;      // one day, the first N days, or all 15
  function buildKM() {
    const steepG = GL.filter(f => f.properties.prone && f.properties.dist_km != null && f.properties.dist_km <= 5), evKm = [];
    inv.events.rows.forEach(ev => { const txt = String(ev["Glacier / place"]).toLowerCase();
      S.filter(s => s.located && txt.includes(s.name.toLowerCase())).forEach(s => { let bk = 0, bd = 1e9; for (let i = 0; i < line.length; i += 3) { const d = km(line[i], [s.lon, s.lat]); if (d < bd) { bd = d; bk = ch[i]; } }
        if (bd <= 5) evKm.push({ k: bk, ev, s: s.name }); }); });
    // each located settlement: its nearest road kilometre and the straight-line distance to it (for "the road beside it")
    S.forEach(s => { if (!s.located) return; let bd = 1e9, bk = 0; for (let i = 0; i < line.length; i += 2) { const d = km(line[i], [s.lon, s.lat]); if (d < bd) { bd = d; bk = ch[i]; } } s.rk = bk; s.rd = bd; });
    KM = [];
    for (let k = 0; k <= NK; k++) { const p = ptAt(k);
      KM.push({ k, p, tiles: days.map(dt => { const t = tileAt(p[0], p[1], dt); return t ? t.properties : null; }), gl: steepG.filter(f => Math.abs(f.properties.road_km - k) <= 2), ev: evKm.filter(e => Math.abs(e.k - k) <= 2), hist: HIST.filter(h => Math.abs(h.k - k) <= 2) }); }
  }
  function classOf(o, di) {
    const T = (di == null ? o.tiles : Array.isArray(di) ? o.tiles.slice(di[0], di[1]) : [o.tiles[di]]).filter(Boolean), has = T.length > 0;
    let sf = null, lv = null, when = null;
    T.forEach(t => { if (sf == null || (t.sf_3d_mm || 0) > sf) { sf = t.sf_3d_mm || 0; when = t.date; } if (lv == null || t.level > lv) lv = t.level; });
    const steep = o.gl.length > 0;
    const c = lv >= 2 || (steep && sf >= 25) || o.ev.length ? 2 : lv >= 1 || steep || sf >= 10 || o.hist.length ? 1 : has ? 0 : 3;
    return { c, sf, lv, when, steep, has };
  }
  const colOf = q => mode === "snow" ? snowCol(q.sf) : DZ[q.c][1];
  function paint() {
    if (!map || !map.getSource("kkh-dz")) return;
    const di = dIdx(), Q = KM.map(o => classOf(o, di)), feats = [], labs = []; let k0 = 0, col = null, cc = null;
    const flush = k1 => { const c = mode === "snow" ? -1 : cc;
      feats.push({ type: "Feature", properties: { col, c }, geometry: { type: "LineString", coordinates: slice(k0, k1) } });
      if (c === 2 && k1 - k0 >= 2) labs.push({ type: "Feature", properties: { c, len: k1 - k0, t: `HIGH EXPOSURE\nkm ${fmt(k0)}–${fmt(k1)}` }, geometry: { type: "Point", coordinates: ptAt((k0 + k1) / 2) } }); };
    KM.forEach((o, i) => { const c = colOf(Q[i]); if (col == null) { col = c; cc = Q[i].c; } if (c !== col) { flush(o.k); k0 = o.k; col = c; cc = Q[i].c; } });
    flush(ch[ch.length - 1]);
    map.getSource("kkh-dz").setData({ type: "FeatureCollection", features: feats });
    if (map.getSource("kkh-dzlab")) map.getSource("kkh-dzlab").setData({ type: "FeatureCollection", features: labs });
    // settlements and structures take the class of the road beside them (settlements: nearest road km, if within 5 km)
    if (mode !== "snow") {
      const cAt = k => k == null || k > NK + 1 ? -1 : Q[Math.max(0, Math.min(NK, Math.round(k)))].c;
      if (map.getSource("kkh-st")) map.getSource("kkh-st").setData({ type: "FeatureCollection", features: S.filter(s => s.located).map(s => ({ type: "Feature",
        properties: { name: s.name, hi: s.hi || 0, dz: s.rd != null && s.rd <= 5 ? cAt(s.rk) : -1 }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })) });
      infra.features.forEach(f => { f.properties.dz = cAt(f.properties.chainage_km); });
      if (map.getSource("kkh-infra")) map.getSource("kkh-infra").setData(infra);
    }
    const kmBy = new Map(); KM.forEach(o => { const q = classOf(o, dIdx()), n = mode === "snow" ? (q.sf == null ? "no forecast tile" : SNW.find(x => q.sf >= x[0])[2]) : DZ[q.c][0]; kmBy.set(n, (kmBy.get(n) || 0) + 1); });
    const sum = document.querySelector("[data-dzsum]");
    const order = mode === "snow" ? SNW.map(x => x[2]).concat("no forecast tile") : [DZ[2][0], DZ[1][0], DZ[0][0], DZ[3][0]];
    const ent = order.filter(n => kmBy.has(n)).map(n => [n, kmBy.get(n), mode === "snow" ? (SNW.find(x => x[2] === n) || [0, "#94a3b8"])[1] : DZ.find(x => x[0] === n)[1]]);
    // the summary card: a donut of the whole road by class (animated), the km in each class as big figures, what period it describes
    if (sum) {
      const tot = ent.reduce((s, e) => s + e[1], 0) || 1, R = 38, Cf = 2 * Math.PI * R; let acc = 0;
      const lab = n => mode === "snow" ? n.replace(" or more", "+") : ["Lower", "Moderate", "High", "Not rated"][DZ.findIndex(x => x[0] === n)];
      sum.innerHTML = `<div class="kkh-don"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${R}" class="trk"/>
          ${ent.map(([n, v, c], i) => { const len = v / tot * Cf, seg = `<circle cx="50" cy="50" r="${R}" stroke="${c}" stroke-dasharray="${Math.max(0, len - 1.2)} ${Cf}" stroke-dashoffset="${-acc}" style="animation-delay:${i * 0.12}s"><title>${esc(n)}: ${fmt(v)} km</title></circle>`; acc += len; return seg; }).join("")}</svg>
          <span><b>${fmt(NK)}</b><em>km</em></span></div>
        <div class="kkh-krs"><div class="kkh-kwhen">${selDay ? `Forecast for <b>${esc(dShortK(selDay))}</b>` : `Worst day · next <b>${selN === 1 ? "day" : selN === 2 ? "24 h" : selN + " days"}</b>`}</div>
          ${ent.map(([n, v, c]) => `<div class="kkh-kr" style="--c:${c}" title="${esc(n)}"><i></i><b>${fmt(v)}<small> km</small></b><span>${esc(lab(n))}</span><em>${fmt(v / tot * 100)}%</em></div>`).join("")}</div>`;
    }
    const meta = document.querySelector("[data-dzmeta]");
    if (meta) meta.innerHTML = `<b>${STN.length}</b> inspection stations · <b>${STN.filter(x => classOf(x.o, dIdx()).c === 2).length}</b> high · <b>${HIST.length}</b> avalanche record${HIST.length === 1 ? "" : "s"} ≤ 5 km`;
    drawProf(); drawDays();
  }
  // ---------------------------------------------------------------- the danger panel's two graphs
  // (1) hazard profile: road elevation along the N-35 (the portal's own DEM tiles, z9 ≈ 300 m cells, approximate) filled with each km's
  //     class colour, crimson columns over high-exposure stretches, forecast 3-day snowfall bars hanging from the top, stations, records, towns.
  // (2) road at risk per forecast day: km of High and Moderate road for each of the 15 days (click a column to pick that day).
  let ELEV = null, hovK = null, dayCols = [], tourK = null;
  // the panel is docked: the charts take what the screen allows (the summary card then stretches to the same row height: no empty band)
  const chartH = () => Math.max(92, Math.min(122, Math.round(innerHeight * 0.13)));
  // the docked panel's own height drives --dzh, so the side list, legend, card and caption always stop just above it
  const fit = () => { const p = document.querySelector("[data-days]"); if (!p || app.classList.contains("kkh-min")) return;
    p.classList.add("kkh-measure"); const h = p.scrollHeight; p.classList.remove("kkh-measure");   // measured at its natural height, so nothing is clipped
    app.style.setProperty("--dzh", `${Math.round(Math.min(innerHeight * 0.58, Math.max(200, h + 4)))}px`); };
  async function loadElev() {
    const z = 9, n = 2 ** z, tiles = new Map();
    const tp = p => { const s = Math.sin(p[1] * D2R); return [(p[0] + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
    const P = KM.map(o => tp(o.p)); P.forEach(([x, y]) => tiles.set(`${Math.floor(x)}/${Math.floor(y)}`, null));
    await Promise.all([...tiles.keys()].map(k => new Promise(res => { const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => { try { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0); tiles.set(k, { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width }); } catch { /* tainted */ } res(); };
      im.onerror = () => res(); im.src = `/api/dem/${z}/${k}.png`; })));
    const raw = P.map(([x, y]) => { const t = tiles.get(`${Math.floor(x)}/${Math.floor(y)}`); if (!t) return null; const px = Math.min(t.w - 1, Math.floor((x % 1) * t.w)), py = Math.min(t.w - 1, Math.floor((y % 1) * t.w)), i = (py * t.w + px) * 4;
      return t.d[i] * 256 + t.d[i + 1] + t.d[i + 2] / 256 - 32768; });
    if (raw.filter(v => v != null).length < raw.length * 0.6) return;   // too few tiles: keep the profile flat rather than half-drawn
    // a valley road sampled at ~300 m cells can catch a slope: median of ±2 km
    ELEV = raw.map((_, k) => { const w = raw.slice(Math.max(0, k - 2), k + 3).filter(v => v != null).sort((a, b) => a - b); return w.length ? w[w.length >> 1] : null; });
    drawProf();
  }
  function drawProf() {
    const cv = document.querySelector("[data-prof]"); if (!cv || !cv.clientWidth || !KM.length) return;
    const W = cv.clientWidth, H = chartH(), dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const L = 40, R = 10, T = 6, B = 20, iw = W - L - R, ih = H - T - B, di = dIdx(), Q = KM.map(o => classOf(o, di));
    const x = k => L + iw * k / NK, E = ELEV, ev = E ? E.filter(v => v != null) : [], emax = ev.length ? Math.ceil(Math.max(...ev) / 1000) * 1000 : 5000;
    const ey = e => T + ih - ih * 0.74 * Math.max(0, e == null ? 0 : e) / emax, eAt = k => E ? (E[k] != null ? E[k] : 0) : emax * 0.3;
    g.font = "9.5px Inter, system-ui, sans-serif"; g.textBaseline = "middle";
    // elevation grid: faint, labelled in km
    for (let e = 1000; e <= emax; e += 1000) { const y = Math.round(ey(e)) + 0.5; g.strokeStyle = "rgba(170,200,235,.07)"; g.lineWidth = 1; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#5f7088"; g.textAlign = "right"; g.fillText(`${fmt(e / 1000)} km`, L - 6, y); }
    // high-exposure stretches: soft crimson light columns, so the dangerous parts of the road catch the eye first
    Q.forEach((q, k) => { if (q.c === 2 && mode !== "snow") { const gr = g.createLinearGradient(0, T, 0, T + ih); gr.addColorStop(0, "rgba(255,45,85,0)"); gr.addColorStop(0.55, "rgba(255,45,85,.16)"); gr.addColorStop(1, "rgba(255,45,85,.42)"); g.fillStyle = gr; g.fillRect(x(k) - 1, T, Math.max(2.5, iw / NK + 2), ih); } });
    // the terrain profile: each km in its class colour, a glossy vertical gradient (bright at the road, fading to the base)
    const grads = new Map(), gradOf = c => { if (!grads.has(c)) { const gr = g.createLinearGradient(0, T + ih * 0.2, 0, T + ih); gr.addColorStop(0, c); gr.addColorStop(0.55, c + "99"); gr.addColorStop(1, c + "14"); grads.set(c, gr); } return grads.get(c); };
    for (let k = 0; k < NK; k++) { g.fillStyle = gradOf(colOf(Q[k])); g.beginPath(); g.moveTo(x(k), ey(eAt(k))); g.lineTo(x(k + 1) + 0.6, ey(eAt(k + 1))); g.lineTo(x(k + 1) + 0.6, T + ih); g.lineTo(x(k), T + ih); g.fill(); }
    // the road line: lit white crest with a soft glow
    g.save(); g.shadowColor = "rgba(255,255,255,.55)"; g.shadowBlur = 6; g.strokeStyle = "#ffffff"; g.lineWidth = 1.6; g.lineJoin = "round";
    g.beginPath(); for (let k = 0; k <= NK; k++) { const px = x(k), py = ey(eAt(k)); k ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); g.restore();
    g.strokeStyle = "rgba(170,200,235,.22)"; g.lineWidth = 1; g.beginPath(); g.moveTo(L, T + ih + 0.5); g.lineTo(W - R, T + ih + 0.5); g.stroke();
    // forecast snowfall (3 days, worst in the picked days): rounded icicle bars hanging from the top, cyan to violet with the amount;
    // 10 and 25 mm are the alert forecast's own floors
    const sfH = ih * 0.34, sfMax = 30, sy = v => T + sfH * Math.min(1, v / sfMax), bwS = Math.max(1.2, iw / NK + 0.3);
    const sg = g.createLinearGradient(0, T, 0, T + sfH); sg.addColorStop(0, "rgba(129,140,248,.95)"); sg.addColorStop(1, "rgba(165,243,252,.55)");
    Q.forEach((q, k) => { if (q.sf > 0.05) { g.fillStyle = q.sf >= 10 ? sg : "rgba(125,211,252,.35)"; g.fillRect(x(k), T, bwS, sy(q.sf) - T); } });
    [[10, "10 mm"], [25, "25 mm"]].forEach(([v, t]) => { const y = Math.round(sy(v)) + 0.5; g.strokeStyle = v === 25 ? "rgba(255,45,85,.45)" : "rgba(255,163,26,.45)"; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = v === 25 ? "#fda4af" : "#fcd34d"; g.textAlign = "right"; g.fillText(t, W - R - 2, y - 5); });
    // historical avalanche records (white rings above the road) and inspection stations (numbered badges with a halo in their class colour)
    HIST.forEach(h => { const k = Math.round(h.k); g.strokeStyle = "#fff"; g.lineWidth = 1.8; g.beginPath(); g.arc(x(k), ey(eAt(k)) - 11, 3.8, 0, 7); g.stroke(); g.beginPath(); g.moveTo(x(k), ey(eAt(k)) - 7); g.lineTo(x(k), ey(eAt(k)) - 2); g.stroke(); });
    STN.forEach(s => { const k = s.k, c = DZ[classOf(s.o, di).c][1], px = x(k), py = ey(eAt(k));
      const hg = g.createRadialGradient(px, py, 2, px, py, 15); hg.addColorStop(0, c + "88"); hg.addColorStop(1, c + "00"); g.fillStyle = hg; g.beginPath(); g.arc(px, py, 15, 0, 7); g.fill();
      g.fillStyle = "#0b1222"; g.strokeStyle = c; g.lineWidth = 2.2; g.beginPath(); g.arc(px, py, 7.5, 0, 7); g.fill(); g.stroke();
      g.fillStyle = "#fff"; g.textAlign = "center"; g.font = "800 9px Inter, system-ui, sans-serif"; g.fillText(String(s.n), px, py + 0.5); g.font = "9.5px Inter, system-ui, sans-serif"; });
    // towns along the bottom
    const tl = ["Hasan Abdal", "Abbottabad", "Besham", "Dasu", "Chilas", "Gilgit", "Aliabad", "Sost"];
    g.textAlign = "center"; let lastX = -99;
    towns.filter(t => tl.includes(t.name)).forEach(t => { const px = Math.max(L + 24, Math.min(W - R - 30, x(t.chainage_km))); if (px - lastX < 58) return; lastX = px;
      g.strokeStyle = "rgba(170,200,235,.35)"; g.beginPath(); g.moveTo(x(t.chainage_km) + 0.5, T + ih); g.lineTo(x(t.chainage_km) + 0.5, T + ih + 4); g.stroke(); g.fillStyle = "#a3b3c8"; g.fillText(t.name, px, H - 7); });
    g.fillStyle = "#a3b3c8"; g.textAlign = "right"; g.fillText("Khunjerab ▸", W - R, H - 7);
    // the tour's position (while touring): a glowing marker on the profile that moves with the camera
    if (tourK != null) { const px = Math.round(x(tourK)) + 0.5, py = ey(eAt(tourK)), c = colOf(Q[tourK]);
      const gr = g.createLinearGradient(0, T, 0, T + ih); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(255,255,255,.28)"); g.fillStyle = gr; g.fillRect(px - 7, T, 14, ih);
      g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + ih); g.stroke();
      g.fillStyle = c; g.strokeStyle = "#fff"; g.lineWidth = 2.5; g.beginPath(); g.arc(px, py, 6, 0, 7); g.fill(); g.stroke();
      g.font = "bold 10px Inter, system-ui, sans-serif"; g.textAlign = px > W - 90 ? "right" : "left"; g.fillStyle = "#fff"; g.fillText(`TOUR · km ${fmt(tourK)}`, px + (px > W - 90 ? -9 : 9), T + 10); g.font = "9.5px Inter, system-ui, sans-serif"; }
    // hover crosshair
    if (hovK != null) { const px = Math.round(x(hovK)) + 0.5; g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 1; g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + ih); g.stroke();
      g.fillStyle = colOf(Q[hovK]); g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(px, ey(eAt(hovK)), 4.5, 0, 7); g.fill(); g.stroke(); }
  }
  function drawDays() {
    const cv = document.querySelector("[data-dchart]"); if (!cv || !cv.clientWidth || !days.length) return;
    const W = cv.clientWidth, H = chartH(), dpr = devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const T = 16, B = 26, ih = H - T - B, n = days.length, gap = 3, bw = (W - gap * (n - 1)) / n;
    const cnt = days.map((_, d) => { let hi = 0, mo = 0; KM.forEach(o => { const c = classOf(o, d).c; if (c === 2) hi++; else if (c === 1) mo++; }); return [hi, mo]; });
    const mx = Math.max(10, ...cnt.map(([a, b]) => a + b)), inRange = d => selDay ? days[d] === selDay : d < selN;
    dayCols = [];
    g.font = "9.5px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const rr = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, [r, r, 2, 2]); else g.rect(x, y, w, h); };
    const gH = g.createLinearGradient(0, T, 0, T + ih); gH.addColorStop(0, "#ff5c7a"); gH.addColorStop(1, "#c8143c");
    const gM = g.createLinearGradient(0, T, 0, T + ih); gM.addColorStop(0, "#ffc35a"); gM.addColorStop(1, "#e08a00");
    cnt.forEach(([hi, mo], d) => { const x0 = d * (bw + gap), on = inRange(d);
      g.fillStyle = on ? "rgba(56,189,248,.08)" : "rgba(255,255,255,.022)"; rr(x0, T, bw, ih, 5); g.fill();                 // the column's track
      const hH = ih * hi / mx, mH = ih * mo / mx, r = Math.min(5, bw / 3);
      g.globalAlpha = on ? 1 : 0.35;
      if (mH > 0) { g.fillStyle = gM; rr(x0 + 1, T + ih - hH - mH, bw - 2, mH + (hH > 0 ? r : 0), hH > 0 ? r : r); g.fill(); }
      if (hH > 0) { g.fillStyle = gH; rr(x0 + 1, T + ih - hH, bw - 2, hH, mH > 0 ? 0 : r); g.fill(); }
      if (on && hi + mo) { g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(x0 + 2, T + ih - hH - mH + 1, Math.max(1, (bw - 4) * 0.35), Math.max(0, hH + mH - 2)); }   // a light sheen
      g.globalAlpha = 1;
      // value labels only where they fit (or on the day picked / the worst day), so neighbouring numbers never collide
      if (hi + mo && (bw >= 24 || hi + mo === mx || selDay === days[d])) { g.fillStyle = on ? "#eef4fb" : "#73859c"; g.fillText(fmt(hi + mo), x0 + bw / 2, Math.max(T + 6, T + ih - hH - mH - 7)); }
      const dt = new Date(days[d] + "T00:00:00Z"); g.fillStyle = selDay === days[d] ? "#fff" : on ? "#cbd5e1" : "#64748b";
      g.fillText(String(dt.getUTCDate()), x0 + bw / 2, H - 17); g.fillStyle = "#56657a"; g.fillText("SMTWTFS"[dt.getUTCDay()], x0 + bw / 2, H - 6);
      if (selDay === days[d]) { g.strokeStyle = "#fff"; g.lineWidth = 1.5; rr(x0 + 0.75, T + 0.75, bw - 1.5, ih - 1.5, 5); g.stroke(); }
      if (d === 0) { g.fillStyle = "#67e8f9"; g.font = "700 8.5px Inter, system-ui, sans-serif"; g.textAlign = "left"; g.fillText("TODAY", x0, T - 6); g.textAlign = "center"; g.font = "9.5px Inter, system-ui, sans-serif"; }
      dayCols.push([x0, x0 + bw, days[d]]); });
  }
  function drawMx(cv, onlyTop) {
    if (!cv || !cv.clientWidth) return;
    const W = cv.clientWidth, RH = 9, H0 = onlyTop ? 10 : 16, LB = onlyTop ? 0 : 46, H = onlyTop ? H0 : H0 + 4 + days.length * RH, dpr = devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px"; const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const x = k => LB + (W - LB) * k / NK, cw = (W - LB) / NK + 0.6, rowY = r => r === 0 ? 0 : H0 + 4 + (r - 1) * RH, rowH = r => r === 0 ? H0 : RH - 1;
    for (let r = 0; r < (onlyTop ? 1 : days.length + 1); r++) { const di = r === 0 ? (onlyTop ? dIdx() : null) : r - 1;
      KM.forEach(o => { g.fillStyle = colOf(classOf(o, di)); g.fillRect(x(o.k), rowY(r), cw, rowH(r)); });
      if (!onlyTop) { g.fillStyle = "#cbd5e1"; g.font = "10px Inter, sans-serif"; g.textBaseline = "middle"; g.fillText(r === 0 ? "15 days" : days[di].slice(5), 0, rowY(r) + rowH(r) / 2 + 0.5); } }
    if (!onlyTop) { const sr = selDay == null ? 0 : days.indexOf(selDay) + 1; g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect(LB + 0.75, rowY(sr) - 0.5, W - LB - 1.5, rowH(sr) + 1); }
  }
  function pick(dt) {
    selDay = dt;
    if (dt) setDay(dt);
    else if (map && map.getSource("kkh-fc")) {                          // a range: each tile's worst day in it
      const best = new Map();
      days.slice(0, selN).forEach(d => (FC.get(d) || new Map()).forEach((f, k) => { const b = best.get(k); if (!b || f.properties.level > b.properties.level || (f.properties.level === b.properties.level && f.properties.sf_3d_mm > b.properties.sf_3d_mm)) best.set(k, f); }));
      map.getSource("kkh-fc").setData({ type: "FeatureCollection", features: [...best.values()] });
    }
    document.querySelectorAll("[data-n]").forEach(b => b.classList.toggle("on", !dt && +b.dataset.n === selN));
    paint(); drawStations();
  }
  const why = (o, q) => { const out = [];
    if (o.gl.length) { const nm = [...new Set(o.gl.map(f => f.properties.name).filter(Boolean))].slice(0, 3); out.push(`${o.gl.length} glacier${o.gl.length > 1 ? "s" : ""} on 30–45° slopes within 5 km${nm.length ? ` (${nm.join(", ")})` : ""}`); }
    if (!q.has) out.push("outside the forecast tiles: snow not rated here");
    else { out.push(q.sf > 0.05 ? `forecast snowfall up to ${fmt(q.sf, 1)} mm in 3 days${selDay ? "" : ` (${q.when})`}` : "no snowfall in the forecast"); if (q.lv != null) out.push(`alert level: ${q.lv === -1 ? "not rated (below 1,200 m)" : ["Low", "Moderate", "High"][q.lv]}`); }
    if (o.ev.length) out.push(`recorded here (observed): ${o.ev[0].ev.Date}, ${o.ev[0].ev.Event}`);
    o.hist.forEach(h => out.push(`historical avalanche record ${h.p.event_id} (${h.p.date || h.p.date_start || "date unknown"}) ${fmt(h.d, 1)} km from the road: proximity only`));
    return out; };
  const section = k => { let a = towns[0], b = towns[towns.length - 1]; for (const t of towns) { if (t.chainage_km <= k) a = t; else { b = t; break; } } return a === b ? a.name : `${a.name} → ${b.name}`; };
  // the route tour: the camera drives the highway from Hasan Abdal to Khunjerab Pass, slower and closer where the class is higher.
  // Smooth by construction. ONE controller writes a free camera every frame and every quantity in it is eased:
  //  - it aims at a smoothed copy of the road (switchbacks averaged out over ~1 km) and heads along a longer smoothed stretch (~3.5 km),
  //    so the view never jerks sideways at a hairpin;
  //  - the speed follows a per-km pace that is itself smoothed (slowing starts before a dangerous stretch, not at it) and eased in time;
  //  - the camera height comes from the road's terrain height, low-passed, so it does not bob over every ridge (jumpTo re-reads the
  //    terrain under the centre every frame: that was the vibration);
  //  - stations are reached by braking, held with a slow swing around them, and left by accelerating (no easeTo, no jump back).
  // Touching the map pauses the tour and hands the camera over; Resume blends back from wherever the user left it.
  const TS = 0.1, AHEAD = 2.5;
  const angd = d => ((d % 360) + 540) % 360 - 180;
  const ease = (cur, tgt, dt, tau) => cur + (tgt - cur) * (1 - Math.exp(-dt / tau));
  const sstep = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const blur1 = (a, r, passes) => { const n = a.length; for (let p = 0; p < passes; p++) { const o = new Float64Array(n); let s = 0; const g = i => a[Math.max(0, Math.min(n - 1, i))];
      for (let i = -r; i <= r; i++) s += g(i); for (let i = 0; i < n; i++) { o[i] = s / (2 * r + 1); s += g(i + r + 1) - g(i - r); } a = o; } return a; };
  let TRK = null;
  function track() {
    if (TRK) return TRK;
    const n = Math.floor(ch[ch.length - 1] / TS) + 1, X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = ptAt(i * TS); X[i] = p[0]; Y[i] = p[1]; }
    TRK = { n, nx: blur1(X, 12, 2), ny: blur1(Y, 12, 2), fx: blur1(X, 35, 2), fy: blur1(Y, 35, 2) };
    return TRK;
  }
  const tAt = (A, B, s) => { const f = Math.max(0, Math.min(TRK.n - 1, s / TS)), i = Math.min(TRK.n - 2, Math.floor(f)), u = f - i; return [A[i] + (A[i + 1] - A[i]) * u, B[i] + (B[i + 1] - B[i]) * u]; };
  const brgOf = (p, a) => Math.atan2((a[0] - p[0]) * Math.cos(p[1] * D2R), a[1] - p[1]) / D2R;
  const headAt = s => brgOf(tAt(TRK.fx, TRK.fy, s - 2), tAt(TRK.fx, TRK.fy, s + 4));
  const kAt = (A, s) => { const f = Math.max(0, Math.min(NK, s)), i = Math.min(NK - 1, Math.floor(f)); return A[i] + (A[i + 1] - A[i]) * (f - i); };
  // camera pose looking at T (at height te) from distance L along the view ray: L is Mapbox's own camera distance at that zoom (fov 36.87°)
  function camPose(T, te, brg, pitch, zoom) {
    const H = map.getCanvas().clientHeight || innerHeight, L = 1.5 * H * 40075016.686 * Math.cos(T[1] * D2R) / (512 * 2 ** zoom);
    const mc = mapboxgl.MercatorCoordinate.fromLngLat(T, te), u = mc.meterInMercatorCoordinateUnits(), dh = L * Math.sin(pitch * D2R) * u;
    return { x: mc.x - Math.sin(brg * D2R) * dh, y: mc.y + Math.cos(brg * D2R) * dh, z: mc.z + L * Math.cos(pitch * D2R) * u, pitch, brg };
  }
  function setPose(P) { const fc = map.getFreeCameraOptions(); fc.position = new mapboxgl.MercatorCoordinate(P.x, P.y, P.z); fc.setPitchBearing(P.pitch, P.brg); map.setFreeCameraOptions(fc); }
  function getPose() { const p = map.getFreeCameraOptions().position; return { x: p.x, y: p.y, z: p.z, pitch: map.getPitch(), brg: map.getBearing() }; }
  const mixPose = (A, B, u) => ({ x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u, z: A.z + (B.z - A.z) * u, pitch: A.pitch + (B.pitch - A.pitch) * u, brg: A.brg + angd(B.brg - A.brg) * u });
  // while touring, the 6,778 glacier dots step back so the coloured road and its danger zones lead
  const DIM = [["kkh-gall", "circle-opacity", 0.85, 0.38], ["kkh-outl-f", "fill-opacity", 0.16, 0.08], ["kkh-gall-t", "text-opacity", 1, 0], ["kkh-gl-t", "text-opacity", 1, 0.55]];
  const dim = on => DIM.forEach(([id, p, a, b]) => { if (map && map.getLayer(id)) map.setPaintProperty(id, p, on ? b : a); });
  function startTour() {
    if (!map || tour || !KM.length) return;
    hideCard(); app.classList.add("kkh-touring"); report("tour", "start"); track(); dim(true);
    const cap = document.querySelector("[data-cap]"), di = dIdx();
    const Q = KM.map(o => classOf(o, di)), C = Q.map(q => q.c);
    // pace (km/s at 1×) and zoom per km; the minimum over ±3 km then two blurs, so braking starts ahead of a stretch
    const minR = (a, r) => a.map((_, i) => { let m = Infinity; for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) m = Math.min(m, a[j]); return m; });
    const SP = blur1(Float64Array.from(minR(C.map(c => c === 2 ? 5 : c === 1 ? 10 : 17), 3)), 5, 2);
    const ZP = blur1(Float64Array.from(C.map(c => c === 2 ? 11.45 : c === 1 ? 11.15 : 10.9)), 6, 2);
    const nextHi = new Int32Array(NK + 2).fill(-1); for (let k = NK; k >= 0; k--) nextHi[k] = C[k] === 2 ? k : nextHi[k + 1];
    const hiEnd = new Int32Array(NK + 2).fill(-1); for (let k = NK; k >= 0; k--) hiEnd[k] = C[k] === 2 ? (C[k + 1] === 2 ? hiEnd[k + 1] : k) : -1;
    drawMx(cap.querySelector("[data-strip]"), true);
    const veh = document.createElement("div"); veh.className = "kkh-veh"; veh.innerHTML = "<i></i><i></i><b></b>"; veh.style.setProperty("--c", "#7dd3fc");
    const marker = new mapboxgl.Marker({ element: veh, occludedOpacity: 0.35 }).setLngLat(ptAt(0)).addTo(map);
    const z0 = ZP[0], b0 = headAt(0), T0 = tAt(TRK.nx, TRK.ny, AHEAD);
    const t = tour = { s: 0, v: 0, brg: b0, orbit: 0, zoom: z0, pitch: 63, te: 0, next: 0, dwell: 0, side: 1, paused: false, user: false, speed: 1, phase: "open",
      blend: null, last: performance.now(), ui: 0, whyT: 0, cls: -2, marker, raf: 0, openT: 0, endAt: 0, off: () => {} };
    const put = (sel, s) => { const el = cap.querySelector(sel); if (el && el.textContent !== s) el.textContent = s; };
    const chip = (s, col) => { put("[data-c]", s); cap.querySelector("[data-c]").style.background = col; };
    // opening: all of Pakistan, then down onto the start of the highway in the tour's own framing
    chip("CPEC · N-35", "#7dd3fc"); put("[data-sec]", "Karakoram Highway: Hasan Abdal → Khunjerab Pass"); put("[data-kmtxt]", `${fmt(NK)} km`);
    put("[data-ahead]", `${STN.length} inspection stations`);
    put("[data-why]", `Green: lower identified exposure · amber: moderate · crimson: high (striped). Tinted bands = the 5 km exposure zone where the road is moderate or high. N-35 begins at Hasan Abdal, about 40 km north-west of Islamabad.`);
    cap.querySelector("[data-pos]").style.left = "0%";
    map.stop(); map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    map.jumpTo({ center: [71.2, 31.2], zoom: 4.5, pitch: 0, bearing: 0 });
    map.flyTo({ center: T0, zoom: z0, pitch: 63, bearing: b0, duration: calm ? 0 : 6500, curve: 1.5, essential: true });
    const go = () => { if (tour !== t || t.phase !== "open") return; clearTimeout(t.openT); t.phase = "run"; t.last = performance.now();
      const e0 = map.getTerrain() ? map.queryTerrainElevation(ptAt(AHEAD)) : 0; t.te = e0 || 0; t.blend = { from: getPose(), t0: performance.now(), dur: 1500 }; };
    map.once("moveend", go); t.openT = setTimeout(go, calm ? 60 : 8000);
    // touching the map: pause, and the camera is the user's until Resume
    const cc = map.getCanvasContainer(), onUser = () => { if (tour !== t || t.user) return; t.user = true; t.paused = true; map.stop(); pauseLabel(); };
    cc.addEventListener("pointerdown", onUser); cc.addEventListener("wheel", onUser, { passive: true });
    t.off = () => { cc.removeEventListener("pointerdown", onUser); cc.removeEventListener("wheel", onUser); };
    pauseLabel();
    function stationCap(st, n) {
      const q = classOf(st.o, di), el = map.queryTerrainElevation ? map.queryTerrainElevation(st.o.p, { exaggerated: false }) : null;
      t.cls = -2;                                                       // the road caption refreshes when the drive resumes
      chip(`Station ${n} of ${STN.length} · ${DZS[q.c]}`, DZ[q.c][1]); put("[data-sec]", section(st.k));
      put("[data-kmtxt]", `km ${fmt(st.k)} · ${st.o.p[1].toFixed(3)}°N ${st.o.p[0].toFixed(3)}°E${el != null ? ` · ${fmt(el)} m` : ""}`);
      put("[data-ahead]", "Inspection stop"); put("[data-why]", why(st.o, q).join(" · ")); veh.style.setProperty("--c", DZ[q.c][1]);
    }
    function roadCap(k, now) {
      const c = C[k], changed = c !== t.cls;
      if (changed) { t.cls = c; chip(DZS[c], DZ[c][1]); veh.style.setProperty("--c", DZ[c][1]); veh.classList.toggle("hi", c === 2); }
      put("[data-sec]", section(k)); put("[data-kmtxt]", `km ${fmt(k)} of ${fmt(NK)}`);
      if (tourK !== k) { tourK = k; drawProf(); }                       // the bottom profile follows the drive
      const nh = nextHi[k], he = hiEnd[k];
      put("[data-ahead]", c === 2 && he >= k ? `High exposure for the next ${fmt(he - k + 1)} km` : nh > k ? `Next high-exposure stretch in ${fmt(nh - k)} km` : "No high-exposure stretch ahead");
      if (changed || now - t.whyT > 1100) { t.whyT = now; put("[data-why]", why(KM[k], Q[k]).join(" · ")); }   // (readable: the reasons do not flicker per km)
    }
    const step = now => {
      if (tour !== t) return;
      const dt = Math.min(0.1, (now - t.last) / 1000); t.last = now;
      if (t.phase !== "open") {
        const st = STN[t.next], goal = st ? st.k : NK, dist = goal - t.s;
        if (t.paused && t.dwell) t.dwell += dt * 1000;                  // a paused hold keeps its remaining time
        if (t.dwell && now >= t.dwell) t.dwell = 0;
        if (!t.dwell && st && dist < 0.35) { t.dwell = now + 4800 / t.speed; t.next++; t.side = -t.side; stationCap(st, t.next); }
        if (t.phase === "run" && !st && dist < 0.3) { t.phase = "end"; t.endAt = now + 2600; chip("Khunjerab Pass", "#7dd3fc"); put("[data-ahead]", "Route tour complete"); }
        if (t.phase === "end" && now >= t.endAt) { stopTour(true); return; }
        const stop = t.paused || t.dwell || t.phase === "end";
        const want = stop ? 0 : kAt(SP, t.s) * t.speed * (0.05 + 0.95 * sstep((dist - 0.2) / 7));
        t.v = ease(t.v, want, dt, want < t.v ? 0.5 : 1.2);              // brake firmly, pull away gently
        t.s = Math.min(NK, t.s + t.v * dt);
        const dw = t.dwell ? 1 : 0;
        t.brg += angd(headAt(t.s) - t.brg) * (1 - Math.exp(-dt / 1.0));
        t.orbit = ease(t.orbit, dw * 30 * t.side, dt, 1.4);
        t.zoom = ease(t.zoom, kAt(ZP, t.s) + dw * 0.55, dt, 1.5);
        t.pitch = ease(t.pitch, dw ? 57 : 63, dt, 1.5);
        const aim = Math.min(NK, t.s + AHEAD), e = map.getTerrain() ? map.queryTerrainElevation(ptAt(aim)) : 0;
        if (e != null) t.te = ease(t.te, e, dt, 0.9);
        let P = camPose(tAt(TRK.nx, TRK.ny, aim), t.te, t.brg + t.orbit, t.pitch, t.zoom);
        if (t.blend) { const u = sstep((now - t.blend.t0) / t.blend.dur); P = mixPose(t.blend.from, P, u); if (u >= 1) t.blend = null; }
        if (!t.user) setPose(P);
        marker.setLngLat(ptAt(t.s));
        cap.querySelector("[data-pos]").style.left = `${t.s / NK * 100}%`;
        if (!t.dwell && t.phase === "run" && now - t.ui > 140) { t.ui = now; roadCap(Math.min(NK, Math.round(t.s)), now); }
      }
      t.raf = requestAnimationFrame(step);
    };
    t.raf = requestAnimationFrame(step);
  }
  function pauseLabel() { const b = document.querySelector("[data-tp]"); if (b && tour) b.textContent = tour.paused ? (tour.user ? "▶ Resume tour" : "▶ Resume") : "❚❚ Pause"; }
  function tourPause() {
    if (!tour) return; const t = tour; t.paused = !t.paused;
    if (!t.paused && t.user) { t.user = false; t.blend = { from: getPose(), t0: performance.now(), dur: 1700 }; }
    pauseLabel();
  }
  function stopTour(done) {
    if (!tour) return; const t = tour; tour = null;
    cancelAnimationFrame(t.raf); clearTimeout(t.openT); t.off(); t.marker.remove(); app.classList.remove("kkh-touring"); tourK = null; drawProf();
    if (!map) return; dim(false); map.stop();
    map.easeTo({ pitch: 52, zoom: map.getZoom() - (done === true ? 1.6 : 0.4), duration: calm ? 0 : done === true ? 3400 : 1500, essential: true, easing: x => 1 - Math.pow(1 - x, 3) });
    if (done === true) toast("Route tour complete: Khunjerab Pass");
  }
  // inspection stations, found from the data: every high-exposure stretch, every historical record near the road, then the longest
  // moderate stretches; at least 30 km apart, at most 8
  function buildStations() {
    const runs = []; let cur = null;
    KM.forEach(o => { const c = classOf(o, null).c; if (c === 1 || c === 2) { if (!cur || cur.c !== c) { cur = { c, a: o.k, b: o.k }; runs.push(cur); } cur.b = o.k; } else cur = null; });
    const cand = runs.filter(r => r.c === 2).map(r => (r.a + r.b) / 2).concat(HIST.map(h => h.k), runs.filter(r => r.c === 1).sort((x, y) => (y.b - y.a) - (x.b - x.a)).map(r => (r.a + r.b) / 2));
    for (const gap of [30, 45, 60, 90]) { STN = []; cand.forEach(k => { k = Math.round(k); if (!STN.some(x => Math.abs(x.k - k) < gap)) STN.push({ k, o: KM[Math.max(0, Math.min(NK, k))] }); }); if (STN.length <= 8) break; }
    STN = STN.slice(0, 8).sort((a, b) => a.k - b.k); STN.forEach((x, i) => { x.n = i + 1; });
  }
  function drawStations() {
    if (map && map.getSource("kkh-stn")) map.getSource("kkh-stn").setData({ type: "FeatureCollection", features: STN.map(x => ({ type: "Feature", properties: { n: String(x.n), col: DZ[classOf(x.o, dIdx()).c][1] }, geometry: { type: "Point", coordinates: x.o.p } })) });
  }
  function stationCard(x) {
    const q = classOf(x.o, dIdx()), el = map.queryTerrainElevation ? map.queryTerrainElevation(x.o.p, { exaggerated: false }) : null, o = x.o;
    const nt = towns.slice().sort((a, b) => Math.abs(a.chainage_km - x.k) - Math.abs(b.chainage_km - x.k))[0];
    const rows = [["Highway segment", `N-35 km ${fmt(x.k)} from Hasan Abdal · ${section(x.k)}`], ["Coordinates", `${o.p[1].toFixed(4)}° N, ${o.p[0].toFixed(4)}° E`], ["Elevation (terrain model)", el != null ? `${fmt(el)} m` : "not available"],
      ["Nearest town on the road", `${nt.name} (${fmt(Math.abs(nt.chainage_km - x.k))} km along the road)`], ["Safety classification", DZ[q.c][0]],
      ["Historical avalanche records ≤ 5 km", o.hist.length ? o.hist.map(h => `${h.p.event_id}: ${h.p.location || ""} (${h.p.date || h.p.date_start || "date unknown"}), ${fmt(h.d, 1)} km from the road`).join("; ") + ". Proximity only: not proof that it reached the road." : "none in the compiled records (not proof of no hazard)"],
      ["Recorded damage to the highway (observed)", o.ev.length ? o.ev.map(e => `${e.ev.Date}: ${e.ev.Event} ${e.ev.Impact}`).join(" ") : "none in the inventory's events"],
      ["Forecast (model output)", q.has ? `snowfall up to ${fmt(q.sf, 1)} mm in 3 days${q.when ? ` (${q.when})` : ""}; alert level ${q.lv === -1 ? "not rated (below 1,200 m)" : ["Low", "Moderate", "High"][q.lv]}` : "no forecast tile here: not rated"],
      ["Steep glaciers ≤ 5 km (terrain, inferred)", o.gl.length ? o.gl.slice(0, 6).map(f => `${f.properties.name || f.properties.id} (${fmt(f.properties.slope_mean, 1)}°, ${fmt(f.properties.dist_km, 1)} km)`).join("; ") + (o.gl.length > 6 ? ` and ${o.gl.length - 6} more` : "") : "none on 30–45° slopes"]];
    show(`<div class="kkh-eb"><span>Inspection station ${x.n} of ${STN.length}</span><span class="kkh-sp"></span><button type="button" class="kkh-close" aria-label="Close">×</button></div>
      <h3>${esc(section(x.k))}</h3><div class="kkh-pills"><span style="background:${DZ[q.c][1]};color:#0b1222;font-weight:800">${esc(DZS[q.c])}</span><span class="road">km ${fmt(x.k)}</span></div>
      <dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      <p class="kkh-fine">Observed = recorded events; model output = the portal's alert forecast (ECMWF IFS); inferred = terrain slope classes. A screening for monitoring and preparedness, not an official warning. Sources: OpenStreetMap (road), your glacier CSV and inventory, the portal's compiled avalanche records.</p>`);
    map.flyTo({ center: o.p, zoom: 11.8, pitch: 62, duration: calm ? 0 : 2200, essential: true, padding: { right: innerWidth > 860 ? 420 : 0 } });
  }
  async function initDanger() {
    if (!map || !FC) return;
    // historical avalanche records (the portal's compiled events) with their real distance to the highway; the N-35 corridor (5 km each side)
    const [he, corr] = await Promise.all([fetch("/api/history/events").then(r => r.ok ? r.json() : null).catch(() => null), fetch("/api/roadcorridor/corridor.geojson").then(r => r.ok ? r.json() : null).catch(() => null)]);
    if (!map) return;
    if (he && he.features) he.features.forEach(f => { const c = f.geometry && f.geometry.coordinates; if (!c) return; let bd = 1e9, bk = 0;
      for (let i = 0; i < line.length; i += 2) { const d = km(line[i], c); if (d < bd) { bd = d; bk = ch[i]; } } if (bd <= 5) HIST.push({ k: bk, d: bd, p: f.properties, c }); });
    const n35 = corr && corr.features && corr.features.find(f => f.properties.ref === "N-35");
    if (n35) { map.addSource("kkh-cor", { type: "geojson", data: n35 });
      map.addLayer({ id: "kkh-cor", type: "fill", source: "kkh-cor", paint: { "fill-color": "#38bdf8", "fill-opacity": 0.05 } }, "kkh-glow2");
      map.addLayer({ id: "kkh-cor-l", type: "line", source: "kkh-cor", paint: { "line-color": "#7dd3fc", "line-width": 1, "line-opacity": 0.55, "line-dasharray": [3, 2] } }, "kkh-glow2"); }
    buildKM(); buildStations();
    ["kkh-red", "kkh-lvl"].forEach(l => map.getLayer(l) && map.setLayoutProperty(l, "visibility", "none"));   // the danger line carries both
    // the base road's orange glow would tint every class: it becomes a dark shadow under the danger colours
    if (map.getLayer("kkh-glow2")) { map.setPaintProperty("kkh-glow2", "line-color", "#000"); map.setPaintProperty("kkh-glow2", "line-opacity", 0.4); }
    if (map.getLayer("kkh-glow")) { map.setPaintProperty("kkh-glow", "line-color", "#05080f"); map.setPaintProperty("kkh-glow", "line-opacity", 0.6); }
    // the road, drawn by danger class, from the bottom up:
    //   zone   the 5 km exposure band each side (10 km wide on the ground, scaled with zoom), tinted only where the road is Moderate or High
    //   pulse  a slow breathing glow on High stretches;  glow / case / core: the coloured road on a dark casing;  hi: white hazard stripes on High
    const GW = z => 10000 / (40075016.686 * Math.cos(35.5 * D2R) / (512 * 2 ** z));
    const RND = { "line-cap": "round", "line-join": "round" };
    map.addSource("kkh-dz", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    // (a 10 km blurred band draped over 3D peaks looked like spilt paint: the band is now ~1.2 km on the ground, crisp-edged, hugging the road)
    map.addLayer({ id: "kkh-dz-zone", type: "line", source: "kkh-dz", layout: RND, paint: { "line-color": ["get", "col"], "line-width": ["interpolate", ["exponential", 2], ["zoom"], 5, Math.max(6, GW(5) * 0.12), 12.5, GW(12.5) * 0.12],
      "line-opacity": ["case", ["==", ["get", "c"], 2], 0.3, 0.18] } }, "kkh-glow2");
    map.addLayer({ id: "kkh-dz-pulse", type: "line", source: "kkh-dz", layout: RND, paint: { "line-color": DZ[2][1], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 8, 11, 15], "line-blur": 1.5,
      "line-opacity": 0.2, "line-opacity-transition": { duration: 1500, delay: 0 } } }, "kkh-kmk");
    map.addLayer({ id: "kkh-dz-glow", type: "line", source: "kkh-dz", layout: RND, paint: { "line-color": ["get", "col"], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 7, 11, 12], "line-blur": 2,
      "line-opacity": ["match", ["get", "c"], 2, 0.5, 1, 0.35, 0.14] } }, "kkh-kmk");
    map.addLayer({ id: "kkh-dz-case", type: "line", source: "kkh-dz", layout: RND, paint: { "line-color": "#04070d", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 5.5, 11, 10.5], "line-opacity": 0.85 } }, "kkh-kmk");
    map.addLayer({ id: "kkh-dz", type: "line", source: "kkh-dz", layout: RND, paint: { "line-color": ["get", "col"], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 11, 7] } }, "kkh-kmk");
    map.addLayer({ id: "kkh-dz-hi", type: "line", source: "kkh-dz", layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 11, 2.4],
      "line-dasharray": [1.4, 2.2], "line-opacity": 0.9 } }, "kkh-kmk");
    map.addSource("kkh-dzlab", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "kkh-dzlab", type: "symbol", source: "kkh-dzlab", minzoom: 7, layout: { "text-field": ["get", "t"], "text-size": 10.5, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-letter-spacing": 0.06,
      "text-offset": [0, -1.4], "text-anchor": "bottom", "symbol-sort-key": ["-", 0, ["get", "len"]] }, paint: { "text-color": "#ffe4ea", "text-halo-color": "#6b0018", "text-halo-width": 1.8 } });
    const DZF = { "kkh-dz-zone": ["in", ["get", "c"], ["literal", [1, 2]]], "kkh-dz-pulse": ["==", ["get", "c"], 2], "kkh-dz-glow": null, "kkh-dz-case": null, "kkh-dz": null, "kkh-dz-hi": ["==", ["get", "c"], 2], "kkh-dzlab": null };
    const dzFilter = () => Object.entries(DZF).forEach(([id, f]) => { const h = ["!", ["in", ["get", "c"], ["literal", hiddenC]]]; if (map.getLayer(id)) map.setFilter(id, f ? ["all", f, h] : h); });
    dzFilter();
    if (!calm) { let up = false; const pulse = setInterval(() => { if (!map) { clearInterval(pulse); return; } if (document.hidden || !map.getLayer("kkh-dz-pulse")) return;
      up = !up; map.setPaintProperty("kkh-dz-pulse", "line-opacity", up ? 0.62 : 0.12); }, 1500); }
    // settlements and structures: filled / ringed with the class of the road beside them (set in paint())
    const DZM = ["match", ["get", "dz"], 0, DZ[0][1], 1, DZ[1][1], 2, DZ[2][1], 3, DZ[3][1], "#e2e8f0"];
    if (map.getLayer("kkh-st")) { map.setPaintProperty("kkh-st", "circle-color", DZM); map.setPaintProperty("kkh-st", "circle-opacity", 0.9); map.setPaintProperty("kkh-st", "circle-stroke-color", "#ffffff"); map.setPaintProperty("kkh-st", "circle-stroke-width", 2); }
    if (map.getLayer("kkh-st-t")) map.setPaintProperty("kkh-st-t", "text-color", ["match", ["get", "dz"], 2, "#ffd0da", 1, "#ffe2b8", "#f1f5f9"]);
    ["kkh-infra", "kkh-bridge"].forEach(id => { if (map.getLayer(id)) { map.setPaintProperty(id, "circle-stroke-color", ["match", ["get", "dz"], 1, DZ[1][1], 2, DZ[2][1], "#0b1222"]); map.setPaintProperty(id, "circle-stroke-width", ["match", ["get", "dz"], 2, 2.4, 1, 1.8, 1]); } });
    map.addSource("kkh-hist", { type: "geojson", data: { type: "FeatureCollection", features: HIST.map(h => ({ type: "Feature", properties: { t: `${h.p.event_id} · ${fmt(h.d, 1)} km from road` }, geometry: { type: "Point", coordinates: h.c } })) } });
    map.addLayer({ id: "kkh-hist", type: "circle", source: "kkh-hist", paint: { "circle-radius": 7, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
    map.addLayer({ id: "kkh-hist-t", type: "symbol", source: "kkh-hist", minzoom: 8, layout: { "text-field": ["get", "t"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] }, paint: { "text-color": "#fff", "text-halo-color": "#000", "text-halo-width": 1.4 } });
    map.addSource("kkh-stn", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "kkh-stn-g", type: "circle", source: "kkh-stn", paint: { "circle-radius": 19, "circle-color": ["get", "col"], "circle-opacity": 0.28, "circle-blur": 0.7 } });
    map.addLayer({ id: "kkh-stn", type: "circle", source: "kkh-stn", paint: { "circle-radius": 10, "circle-color": "#0b1222", "circle-stroke-color": ["get", "col"], "circle-stroke-width": 2.5 } });
    map.addLayer({ id: "kkh-stn-t", type: "symbol", source: "kkh-stn", layout: { "text-field": ["get", "n"], "text-size": 11.5, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"], "text-allow-overlap": true }, paint: { "text-color": "#fff" } });
    map.on("click", "kkh-stn", e => { const x = STN.find(s => String(s.n) === e.features[0].properties.n); if (x) stationCard(x); });
    map.on("mouseenter", "kkh-stn", () => { map.getCanvas().style.cursor = "pointer"; }); map.on("mouseleave", "kkh-stn", () => { map.getCanvas().style.cursor = ""; });
    const LY = [["CPEC highway route", ["kkh-road", "kkh-glow", "kkh-glow2", "kkh-kmk", "kkh-kmk-t"]], ["5 km road exposure corridor", ["kkh-cor", "kkh-cor-l"]], ["Relatively safe sections", 0], ["Moderate exposure sections", 1], ["High exposure sections", 2],
      ["Historical avalanche locations", ["kkh-hist", "kkh-hist-t"]], ["Predicted avalanche zones (forecast tiles)", ["kkh-fc", "kkh-fc-h1", "kkh-fc-h2", "kkh-fc-l"]], ["Glacier systems", ["kkh-outl-f", "kkh-outl-l", "kkh-gall", "kkh-gall-t", "kkh-gl", "kkh-gl-h", "kkh-gl-t"]],
      ["Settlements and structures", ["kkh-st", "kkh-st-t", "kkh-town", "kkh-town-t", "kkh-infra", "kkh-infra-t", "kkh-bridge"]], ["Inspection stations", ["kkh-stn", "kkh-stn-g", "kkh-stn-t"]], ["DEM terrain (3D relief)", "dem"]];
    const lab = ["Abbottabad", "Besham", "Dasu", "Chilas", "Gilgit", "Aliabad", "Sost"];
    // the panel sits at the BOTTOM of the page (the map keeps the whole screen); its controls are a thin bar on top of it
    app.insertAdjacentHTML("beforeend", `<div class="kkh-days kkh-dzp" data-days><div class="kkh-dzh"><span class="kkh-dzt"><i></i><b>Highway danger</b><em>next 15 days · N-35, Hasan Abdal → Khunjerab</em></span>
        <span class="kkh-seg"><button type="button" class="on" data-mode="danger">Exposure</button><button type="button" data-mode="snow">Snowfall</button></span>
        <span class="kkh-seg">${[[1, "Today"], [2, "24 h"], [3, "3 days"], [7, "7 days"], [15, "15 days"]].map(([n, t]) => `<button type="button" data-n="${n}">${t}</button>`).join("")}</span>
        <details class="kkh-lyr"><summary>Layers</summary><div>${LY.map((l, i) => `<label><input type="checkbox" checked data-ly="${i}">${esc(l[0])}</label>`).join("")}</div></details>
        <span class="kkh-sp"></span><span class="kkh-smeta" data-dzmeta></span><button type="button" class="kkh-go" data-tour>▶ START CPEC SAFETY TOUR</button>
        <button type="button" class="kkh-min" data-min title="Hide the panel and give the map the whole screen">▾</button></div>
      <div class="kkh-gr">
        <div class="kkh-gs" data-dzsum aria-live="polite"></div>
        <div class="kkh-gp"><div class="kkh-gt"><span>Hazard profile · where along the road</span><span class="kkh-sp"></span>
          <span class="kkh-gk"><i style="background:linear-gradient(180deg,#a5f3fc,#818cf8)"></i>3-day snowfall <i style="background:#fff;height:2px"></i>Road elevation <i style="background:rgba(255,45,85,.55)"></i>High stretch <i class="o" style="border-color:#fff"></i>Avalanche record</span></div>
          <canvas data-prof title="Hover to read any kilometre; click to fly there"></canvas><div class="kkh-tip" data-tip></div></div>
        <div class="kkh-gd"><div class="kkh-gt"><span>km of road at risk · per day</span><span class="kkh-sp"></span><span class="kkh-gk"><i style="background:${DZ[2][1]}"></i>High <i style="background:${DZ[1][1]}"></i>Moderate</span></div>
          <canvas data-dchart title="km of road in High / Moderate exposure on each forecast day. Click a day to show it; click it again for the range."></canvas></div>
      </div></div>
      <div class="kkh-cap" data-cap><div class="kkh-cap-t"><span class="kkh-chip" data-c></span><b data-sec></b><span data-kmtxt></span><span class="kkh-ahead" data-ahead></span><span class="kkh-sp"></span>
        <button type="button" data-tdock title="Move this panel to the left side, standing vertically (or back to the bottom)">⇤ Dock left</button><button type="button" data-tp>❚❚ Pause</button><button type="button" data-ts>1×</button><button type="button" data-tx>Stop tour</button></div>
        <div class="kkh-cap-w" data-why></div><div class="kkh-cap-b"><canvas data-strip></canvas><i data-pos></i></div>
        <div class="kkh-cap-l">${DZ.map(d => `<span><i style="background:${d[1]}"></i>${esc(d[0])}</span>`).join("")}<span class="kkh-sp"></span><span>Screening from the forecast and terrain · not an official warning</span></div></div>`);
    const pnl = document.querySelector("[data-days]"), cv = pnl.querySelector("[data-prof]"), dcv = pnl.querySelector("[data-dchart]"), tip = pnl.querySelector("[data-tip]");
    pnl.addEventListener("click", e => {
      const m = e.target.closest("[data-mode]"); if (m) { mode = m.dataset.mode; pnl.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("on", b === m)); paint(); }
      if (e.target.closest("[data-tour]")) startTour();
      if (e.target.closest("[data-min]")) { const on = app.classList.toggle("kkh-min"); e.target.closest("[data-min]").textContent = on ? "▴" : "▾";
        if (on) app.style.removeProperty("--dzh");
        setTimeout(() => { drawProf(); drawDays(); if (!on) fit(); if (map) map.resize(); }, 320); }
      const nb = e.target.closest("[data-n]"); if (nb) { selN = +nb.dataset.n; pick(null); }
    });
    pnl.addEventListener("change", e => { const cb = e.target.closest("[data-ly]"); if (!cb) return; const l = LY[+cb.dataset.ly][1], on = cb.checked;
      if (Array.isArray(l)) l.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
      else if (l === "dem") map.setTerrain(on ? { source: "kkh-dem", exaggeration: 1.35 } : null);
      else { hiddenC = on ? hiddenC.filter(c => c !== l) : hiddenC.concat(l); dzFilter(); } });
    // profile: hover reads the kilometre (class, elevation, snowfall, reasons); click flies there
    const kOf = e => { const b = cv.getBoundingClientRect(), x = e.clientX - b.left; return x < 40 || x > b.width - 10 ? null : Math.max(0, Math.min(NK, Math.round((x - 40) / (b.width - 50) * NK))); };
    cv.addEventListener("mousemove", e => { const k = kOf(e); if (k === hovK) return; hovK = k; drawProf();
      if (k == null) { tip.classList.remove("on"); return; }
      const o = KM[k], q = classOf(o, dIdx()), el = ELEV && ELEV[k] != null ? `${fmt(ELEV[k])} m` : "—", b = cv.getBoundingClientRect();
      tip.innerHTML = `<div class="kkh-tip-h"><span class="kkh-chip" style="background:${DZ[q.c][1]}">${esc(DZS[q.c])}</span><b>km ${fmt(k)}</b><span>${esc(section(k))}</span></div>
        <div class="kkh-tip-r"><span>Road elevation <b>${el}</b></span><span>3-day snowfall <b>${q.sf == null ? "no tile" : `${fmt(q.sf, 1)} mm`}</b></span><span>Alert <b>${q.lv == null ? "—" : q.lv === -1 ? "not rated" : ["Low", "Moderate", "High"][q.lv]}</b></span></div>
        <div class="kkh-tip-w">${esc(why(o, q).join(" · "))}</div>`;
      const px = e.clientX - b.left; tip.style.left = `${Math.max(150, Math.min(b.width - 150, px))}px`; tip.classList.add("on"); });
    cv.addEventListener("mouseleave", () => { hovK = null; tip.classList.remove("on"); drawProf(); });
    cv.addEventListener("click", e => { const k = kOf(e); if (k == null) return; const o = KM[k]; map.flyTo({ center: o.p, zoom: 11.2, pitch: 62, duration: calm ? 0 : 2200, essential: true }); });
    dcv.addEventListener("click", e => { const x = e.clientX - dcv.getBoundingClientRect().left, c = dayCols.find(([a, b]) => x >= a - 1.5 && x <= b + 1.5); if (c) pick(selDay === c[2] ? null : c[2]); });
    dcv.style.cursor = "pointer";
    loadElev();
    const cap = document.querySelector("[data-cap]");
    cap.querySelector("[data-tx]").onclick = () => stopTour();
    cap.querySelector("[data-tp]").onclick = tourPause;
    // the tour caption: at the bottom centre (default) or docked on the left as a vertical panel; the choice is remembered
    const dockBtn = cap.querySelector("[data-tdock]"), setDock = on => { app.classList.toggle("kkh-capleft", on); dockBtn.textContent = on ? "⇥ Bottom" : "⇤ Dock left";
      try { localStorage.setItem("kkh.capDock", on ? "left" : "bottom"); } catch { /* private mode */ } const st = cap.querySelector("[data-strip]"); if (st && tour) drawMx(st, true); };
    let dockLeft = false; try { dockLeft = localStorage.getItem("kkh.capDock") === "left"; } catch { /* private mode */ }
    setDock(dockLeft); dockBtn.onclick = () => setDock(!app.classList.contains("kkh-capleft"));
    cap.querySelector("[data-ts]").onclick = e => { if (tour) { tour.speed = tour.speed === 1 ? 2 : tour.speed === 2 ? 0.5 : 1; e.target.textContent = `${tour.speed}×`; } };
    const relayout = () => { drawProf(); drawDays(); fit(); };
    addEventListener("resize", relayout);
    requestAnimationFrame(relayout);
    // concise legend (owner: thin side bars, only the crucial information): one short line per symbol; the full rule is the ⓘ tooltip
    const RULE = "Crimson = alert High, or a 30–45° glacier within 5 km with 25 mm+ snowfall in 3 days, or recorded damage to the highway. Amber = such a glacier within 5 km, or 10 mm+ snowfall, or alert Moderate, or a historical avalanche record within 5 km (proximity only). Green = lower identified exposure, never “safe”. A screening, not an official warning.";
    const sw = (s, t) => `<div>${s}<span>${t}</span></div>`, ln = bg => `<i class="l" style="background:${bg}"></i>`, dt = st => `<i class="d" style="${st}"></i>`;
    document.querySelector("[data-leg]").innerHTML = `<h5>Road danger <b class="kkh-info" title="${esc(RULE)}" tabindex="0">ⓘ</b></h5>
      ${sw(ln(DZ[2][1] + ";background-image:repeating-linear-gradient(90deg,transparent 0 5px,#fff 5px 7px)"), "High")}${sw(ln(DZ[1][1]), "Moderate")}${sw(ln(DZ[0][1]), "Lower")}${sw(ln(DZ[3][1]), "Not rated")}
      ${sw(`<i class="l kkh-hb"></i>`, "Forecast square")}
      ${sw(dt(`background:${DZ[2][1]};border:2px solid #fff`), "Settlement · road's class")}
      ${sw(dt(`background:#0b1222;border:2px solid ${DZ[1][1]}`), "Inspection station")}
      ${sw(dt("background:transparent;border:2.5px solid #fff"), "Avalanche record ≤ 5 km")}
      <h5>Glaciers · mean slope</h5><div class="kkh-leg2">${SLOPE.map(s => `<span><i class="d" style="background:${s[1]}"></i>${esc(s[0].split(" · ")[0].replace("under ", "< ").replace("over ", "> "))}</span>`).join("")}</div>
      <div class="att">© OpenStreetMap · RGI 7.0 · ECMWF IFS</div>`;
    const tl = document.querySelector(".kkh-tl"); if (tl) tl.remove();     // (owner: the events strip is removed from the page)
    routeTour = startTour; stopRouteTour = () => { const on = !!tour; stopTour(); return on; }; pauseRouteTour = () => { if (!tour) return false; tourPause(); return true; };
    pick(null);
    report("danger", `${STN.length} stations · ${HIST.length} historical within 5 km · corridor ${n35 ? "yes" : "no"}`);
  }
  // ---------------------------------------------------------------- side list: glaciers in road order (located), then the rest
  const along = G.filter(g => g.located).sort((a, b) => a.c.road_chainage_km - b.c.road_chainage_km), rest = G.filter(g => !g.located);
  const conf = c => `<span class="kkh-tag ${esc(String(c || "").toLowerCase())}">${esc(c || "—")}</span>`;
  // concise rows (owner): road km · name · confidence, and one short second line; the full inventory row opens on click
  $("[data-sub]").textContent = `${along.length} of ${G.length} located · km on the road`;
  $("[data-list]").innerHTML = along.map(g => `<button type="button" class="kkh-item" data-g="${esc(g.name)}" title="${esc(g.r.Type || "")}"><span class="kkh-km">km ${fmt(g.c.road_chainage_km)}</span>
      <span><b>${esc(base(g.name))}${conf(g.r.Confidence)}</b><small>${fmt(g.c.road_distance_km, 1)} km off${g.hazard ? ' · <em class="kkh-hz">hazard</em>' : ""}</small></span></button>`).join("")
    + `<div class="kkh-sec">Not located (${rest.length})</div>`
    + rest.map(g => `<button type="button" class="kkh-item kkh-nl" data-g="${esc(g.name)}" title="${esc(g.r["Relation to CPEC / KKH"] || "")}"><span class="kkh-km">—</span>
      <span><b>${esc(base(g.name))}${conf(g.r.Confidence)}</b></span></button>`).join("");
  $("[data-list]").addEventListener("click", e => { const b = e.target.closest("[data-g]"); if (!b) return; glacierCard(G.find(g => g.name === b.dataset.g), true); });

  // ---------------------------------------------------------------- legend
  $("[data-leg]").innerHTML = `
    <div><i class="l" style="background:#ffb020;box-shadow:0 0 8px #ff8a00"></i>Karakoram Highway N-35 · ${fmt(n35.properties.length_km, 1)} km</div>
    <div><i class="l" style="background:repeating-linear-gradient(90deg,#fbbf24 0 6px,transparent 6px 10px);opacity:.7"></i>G314, China (context)</div>
    <div><i class="d" style="background:#bae6fd;border-color:#ff3b4e;border-width:2px"></i>Inventory glacier (its coordinate) · red ring = hazard noted</div>
    <div data-legst><i class="d" style="background:#34d399"></i>Settlement · size = population (high end of range)</div>
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
    // the class of the road beside it (same screening as the road colour; it describes the road, not the settlement itself)
    const rk = KM.length && s.rk != null && s.rd <= 5 ? Math.max(0, Math.min(NK, Math.round(s.rk))) : null, rq = rk != null ? classOf(KM[rk], dIdx()) : null;
    const road = rq ? `<div class="kkh-comp" style="border-color:${DZ[rq.c][1]}66;background:${DZ[rq.c][1]}14"><b style="color:${DZ[rq.c][1]}">Road beside it: ${esc(DZ[rq.c][0])}</b><br>
        N-35 km ${fmt(rk)} (${fmt(s.rd, 1)} km away) · ${esc(why(KM[rk], rq).join(" · "))}<br><small>The highway screening for the days picked above; it is the road's class, not an assessment of the settlement.</small></div>` : "";
    show(`<div class="kkh-eb"><span>Settlement · inventory row ${s.r._row}</span><span class="kkh-sp"></span><button type="button" class="kkh-close" aria-label="Close">×</button></div>
      <h3>${esc(s.name)}</h3>
      <div class="kkh-pills">${conf(s.r.Confidence)}<span>Population (range): ${esc(range)}</span>${rq ? `<span style="background:${DZ[rq.c][1]};color:#0b1222;font-weight:800">${esc(DZS[rq.c])} road</span>` : ""}</div>${road}
      ${dl(s.r, inv.settlements.columns, ["Settlement", "Sources", "Confidence", "Midpoint estimate"])}
      <h4 style="margin:14px 0 0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc">Sources</h4>${srcList(s.r.Sources)}
      <p class="kkh-fine">${esc(inv.settlements.notes.join(" "))} Population is shown as the inventory's range, never as one number.</p>`);
    if (s.located && map) map.flyTo({ center: [s.lon, s.lat], zoom: 11, pitch: 60, duration: calm ? 0 : 2400, essential: true, padding: { right: innerWidth > 860 ? 420 : 0 } });
  }
  function eventCard(ev, i) {
    document.querySelectorAll(".kkh-tl [data-i]").forEach(b => b.classList.toggle("on", +b.dataset.i === i));
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
  // ---------------------------------------------------------------- events on a true time axis
  // Each inventory event sits at its own date (ranges drawn as spans, "approx." / "late" dates hatched); colour = kind of event, read from
  // the event's own wording (surge, outburst flood / lake, alert). Dates are parsed from the inventory text only, never invented.
  const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function when(s) {
    const t = String(s || ""), yrs = (t.match(/\b(19|20)\d{2}\b/g) || []).map(Number); if (!yrs.length) return null;
    const ms = (t.toLowerCase().match(/[a-z]+/g) || []).map(w => MON[w.slice(0, 3)]).filter(v => v != null), day = (t.match(/^\s*(\d{1,2})\s+[A-Za-z]/) || [])[1];
    const late = /\blate\b/i.test(t), early = /\bearly\b/i.test(t), approx = /approx|late|early|mid|circa|~/i.test(t), y0 = yrs[0], y1 = yrs[yrs.length - 1];
    if (!ms.length) return { a: y0, b: y1 + 1, approx, range: true };              // "2018–2019": the whole years
    const m0 = ms[0], m1 = ms[ms.length - 1], off = day ? (day - 1) / 31 : late ? 0.62 : early ? 0.05 : 0;
    const a = y0 + (m0 + off) / 12; return { a, b: day ? a : y1 + (m1 + 1) / 12, approx, range: !day };   // a month or "May–Aug": to its end
  }
  const KIND = [["Alert issued", "#fbbf24", /alert|warning|met office/i], ["Glacier surge", "#c084fc", /surge|advanc|blocked/i], ["Outburst flood / lake", "#38bdf8", /flood|glof|outburst|lake|burst/i], ["Other", "#e2e8f0", /./]];
  const EVT = inv.events.rows.map((ev, i) => ({ ev, i, w: when(ev.Date), kind: KIND.find(k => k[2].test(`${ev.Event || ""} ${ev.Impact || ""}`)) }));
  function renderTimeline() {
    const box = $("[data-ev]"), ok = EVT.filter(e => e.w); if (!box) return; if (!ok.length) { box.innerHTML = `<span class="kkh-nf">No dated events in the inventory.</span>`; return; }
    const now = new Date(), nowY = now.getUTCFullYear() + now.getUTCMonth() / 12 + (now.getUTCDate() - 1) / 365;
    const y0 = Math.floor(Math.min(...ok.map(e => e.w.a))) - 0.4, y1 = Math.max(Math.ceil(Math.max(...ok.map(e => e.w.b))), Math.ceil(nowY)) + 0.2, X = y => `${((y - y0) / (y1 - y0) * 100).toFixed(3)}%`;
    const counts = KIND.map(k => [k, EVT.filter(e => e.kind === k).length]).filter(([, n]) => n);
    const years = []; for (let y = Math.ceil(y0); y <= Math.floor(y1); y++) years.push(y);
    const sorted = ok.slice().sort((a, b) => a.w.a - b.w.a); sorted.forEach((e, j) => { e.lane = j % 2; });
    box.innerHTML = `<div class="kkh-tls"><b>${EVT.length}</b><span>recorded events<br>${Math.floor(Math.min(...ok.map(e => e.w.a)))} – ${Math.floor(Math.max(...ok.map(e => e.w.a)))}</span>
        <div>${counts.map(([k, n]) => `<em style="--c:${k[1]}">${n} ${esc(k[0].toLowerCase())}</em>`).join("")}</div></div>
      <div class="kkh-tla">
        ${years.map(y => `<span class="kkh-tly" style="left:${X(y)}">${y}</span>`).join("")}
        <i class="kkh-tlnow" style="left:${X(nowY)}"><span>today</span></i>
        ${sorted.map(e => { const k = e.kind, wide = e.w.range && e.w.b - e.w.a > 0.02;
          const f = (e.w.a - y0) / (y1 - y0), edge = f < 0.12 ? " st" : f > 0.86 ? " en" : "";   // labels near the ends open inwards
          return `<button type="button" class="kkh-tle l${e.lane}${e.w.approx ? " ap" : ""}${edge}" data-i="${e.i}" style="--c:${k[1]};left:${X(e.w.a)}">
            ${wide ? `<s style="width:calc(${X(e.w.b)} - ${X(e.w.a)})"></s>` : ""}<u></u>
            <span><b>${esc(e.ev.Date)}</b>${esc(base(e.ev["Glacier / place"]))}<small>${esc(e.ev.Event)}</small></span></button>`; }).join("")}
      </div>`;
    // spans are sized against the axis, not the button: set them in pixels once laid out
    const ax = box.querySelector(".kkh-tla"), W = ax.clientWidth;
    box.querySelectorAll(".kkh-tle").forEach(b => { const e = EVT[+b.dataset.i], s = b.querySelector("s"); if (s) s.style.width = `${Math.max(4, (e.w.b - e.w.a) / (y1 - y0) * W)}px`; });
    // labels never overlap: each goes above or below the axis, wherever its measured width fits; if neither lane is free it starts after
    // the nearer one ends and is shortened to the room it has (the full text is in its tooltip and record card)
    const lanes = [-1e9, -1e9], GAP = 8;
    [...box.querySelectorAll(".kkh-tle")].sort((a, b) => a.offsetLeft - b.offsetLeft).forEach(b => {
      const sp = b.querySelector(":scope > span"), px = b.offsetLeft; sp.style.maxWidth = "220px"; let w = sp.offsetWidth;
      let left = Math.max(0, Math.min(W - w, px - w / 2)), lane = lanes.findIndex(end => end + GAP <= left);
      if (lane < 0) { lane = lanes[0] <= lanes[1] ? 0 : 1; left = lanes[lane] + GAP; if (left + w > W) { w = Math.max(70, W - left); sp.style.maxWidth = `${w}px`; } }
      b.classList.remove("l0", "l1", "st", "en"); b.classList.add(`l${lane}`); sp.style.transform = `translateX(${Math.round(left - px)}px)`;
      b.title = `${EVT[+b.dataset.i].ev.Date} · ${EVT[+b.dataset.i].ev["Glacier / place"]} · ${EVT[+b.dataset.i].ev.Event}`; lanes[lane] = left + w; });
  }
  renderTimeline(); addEventListener("resize", renderTimeline);
  $("[data-ev]").addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) eventCard(inv.events.rows[+b.dataset.i], +b.dataset.i); });
}
