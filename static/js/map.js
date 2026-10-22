/* Interactive map: Mapbox GL JS when MAPBOX_TOKEN is configured, otherwise MapLibre GL with
   token-free basemaps. All overlays come from the portal API; nothing is drawn without data. */
"use strict";

const RISK_COLORS = { "Low": "#3a9b8c", "Moderate": "#c9b94e", "Considerable": "#db8c3c", "High": "#c9563f", "Very High": "#8d2d4b" };

const MapView = (() => {
  let gl = null, map = null, ready = false, engine = null, loadFailed = false;
  const data = { incidents: [], settlements: [], roads: [], hazards: [], predictions: null };

  const LAYERS = [
    { id: "predictions", label: "Model-predicted risk", sw: "linear-gradient(90deg,#3a9b8c,#c9b94e,#c9563f)", visible: true, opacity: 0.6, layers: ["pred-fill"], prop: "fill-opacity" },
    { id: "hazards", label: "Mapped hazard / runout zones", sw: "#db8c3c", visible: true, opacity: 0.45, layers: ["haz-fill"], prop: "fill-opacity" },
    { id: "incidents", label: "Historical incidents (proxy loc.)", sw: "#e3a93f", visible: true, opacity: 0.25, layers: ["inc-halo", "inc-pt"], prop: null },
    { id: "settlements", label: "Settlements", sw: "#e4ecf6", visible: true, opacity: 1, layers: ["set-pt", "set-lbl"], prop: null },
    { id: "roads", label: "Roads / highways (analysed)", sw: "#22c7d8", visible: true, opacity: 0.9, layers: ["road-line"], prop: "line-opacity" },
    { id: "regions", label: "Study-area extents (indicative)", sw: "transparent;border:1px dashed #22c7d8", visible: true, opacity: 1, layers: ["reg-line", "reg-sel"], prop: null },
    { id: "hillshade", label: "Terrain hillshade (DEM)", sw: "linear-gradient(135deg,#ddd,#333)", visible: true, opacity: 0.35, layers: ["hillshade"], prop: "hillshade-exaggeration" },
    { id: "snow", label: "Snow cover (satellite)", sw: "#ffffff", visible: false, opacity: 0.5, layers: [], prop: null, why: "No operational snow product connected" },
    { id: "uncertainty", label: "Uncertainty / data quality", sw: "#7f93ae", visible: false, opacity: 0.5, layers: [], prop: null, why: "Requires model uncertainty field" },
  ];
  const BASEMAPS = [
    { id: "sat", label: "Satellite" }, { id: "topo", label: "Terrain" }, { id: "dark", label: "Dark" },
  ];
  let basemap = "sat";

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function loadCss(href) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); }

  async function loadEngine() {
    const token = S.config.mapbox_token;
    if (token) {
      engine = "mapbox";
      loadCss("https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css");
      await loadScript("https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js");
      gl = window.mapboxgl; gl.accessToken = token;
    } else {
      engine = "maplibre";
      loadCss("/static/vendor/maplibre-gl.css");
      await loadScript("/static/vendor/maplibre-gl.js");
      gl = window.maplibregl;
    }
  }

  function baseStyle() {
    const t = S.config.mapbox_token;
    const mb = id => `https://api.mapbox.com/styles/v1/mapbox/${id}/tiles/256/{z}/{x}/{y}@2x?access_token=${t}`;
    const sources = engine === "mapbox" ? {
      sat: { type: "raster", tiles: [mb("satellite-streets-v12")], tileSize: 256, attribution: "© Mapbox © OpenStreetMap © Maxar" },
      topo: { type: "raster", tiles: [mb("outdoors-v12")], tileSize: 256, attribution: "© Mapbox © OpenStreetMap" },
      dark: { type: "raster", tiles: [mb("dark-v11")], tileSize: 256, attribution: "© Mapbox © OpenStreetMap" },
      dem: { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512 },
    } : {
      sat: { type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
             tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] },
      satref: { type: "raster", tileSize: 256, attribution: "Reference © Esri",
                tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"] },
      topo: { type: "raster", tileSize: 256, maxzoom: 17, attribution: "© OpenTopoMap (CC-BY-SA) © OpenStreetMap contributors",
              tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png"] },
      dark: { type: "raster", tileSize: 256, attribution: "© CARTO © OpenStreetMap contributors",
              tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"] },
      dem: { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Elevation: Terrain Tiles (AWS Open Data, Mapzen)",
             tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"] },
    };
    const layers = [
      { id: "bg", type: "background", paint: { "background-color": "#0b1626" } },
      { id: "base-sat", type: "raster", source: "sat" },
      { id: "base-topo", type: "raster", source: "topo", layout: { visibility: "none" } },
      { id: "base-dark", type: "raster", source: "dark", layout: { visibility: "none" } },
      { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#000", "hillshade-highlight-color": "#fff" } },
    ];
    if (sources.satref) layers.push({ id: "base-satref", type: "raster", source: "satref", paint: { "raster-opacity": 0.85 } });
    return {
      version: 8, sources, layers,
      glyphs: engine === "mapbox" ? "mapbox://fonts/mapbox/{fontstack}/{range}.pbf" : "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    };
  }

  const fc = features => ({ type: "FeatureCollection", features: features || [] });

  // Uncertainty circle (km) around proxy incident locations, parsed from coord_precision "±N km".
  function halo(f) {
    const m = /±\s*(\d+(?:\.\d+)?)\s*km/.exec(f.properties.coord_precision || "");
    const rKm = m ? parseFloat(m[1]) : 5;
    const [lon, lat] = f.geometry.coordinates, pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      pts.push([lon + (rKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.cos(a), lat + (rKm / 110.57) * Math.sin(a)]);
    }
    return { type: "Feature", properties: { ...f.properties, radius_km: rKm }, geometry: { type: "Polygon", coordinates: [pts] } };
  }

  function addOverlays() {
    const src = (id, d) => map.addSource(id, { type: "geojson", data: d });
    src("regions", fc(S.regions.filter(r => r.properties.id !== "all")));
    src("hazards", fc()); src("predictions", fc()); src("roads", fc());
    src("settlements", fc()); src("incidents", fc()); src("inc-halos", fc());

    map.addLayer({ id: "pred-fill", type: "fill", source: "predictions", paint: {
      "fill-color": ["match", ["get", "risk_class"], ...Object.entries(RISK_COLORS).flat(), "#7f93ae"], "fill-opacity": 0.6 } });
    map.addLayer({ id: "haz-fill", type: "fill", source: "hazards", paint: { "fill-color": "#db8c3c", "fill-opacity": 0.45, "fill-outline-color": "#ffb36b" } });
    map.addLayer({ id: "reg-line", type: "line", source: "regions", paint: { "line-color": "#22c7d8", "line-width": 1.2, "line-dasharray": [3, 3], "line-opacity": 0.7 } });
    map.addLayer({ id: "reg-sel", type: "line", source: "regions", filter: ["==", ["get", "id"], "__none__"], paint: { "line-color": "#22c7d8", "line-width": 2.6 } });
    map.addLayer({ id: "road-line", type: "line", source: "roads", paint: { "line-color": "#22c7d8", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.2, 10, 3], "line-opacity": 0.9 } });
    map.addLayer({ id: "inc-halo", type: "fill", source: "inc-halos", paint: { "fill-color": "#e3a93f", "fill-opacity": 0.14, "fill-outline-color": "#e3a93f" } });
    map.addLayer({ id: "inc-pt", type: "circle", source: "incidents", paint: {
      "circle-radius": 7, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#f0b44a", "circle-stroke-width": 2.5 } });
    map.addLayer({ id: "set-pt", type: "circle", source: "settlements", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3, 10, 6], "circle-color": "#e4ecf6", "circle-stroke-color": "#0b1626", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: "set-lbl", type: "symbol", source: "settlements", minzoom: 6.2, layout: {
      "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top" },
      paint: { "text-color": "#ffffff", "text-halo-color": "#07101c", "text-halo-width": 1.6 } });

    ["inc-pt", "set-pt", "road-line", "haz-fill", "pred-fill", "inc-halo"].forEach(l => {
      map.on("click", l, e => { e.preventDefault?.(); showDetail(l, e.features[0]); });
      map.on("mouseenter", l, () => map.getCanvas().style.cursor = "pointer");
      map.on("mouseleave", l, () => map.getCanvas().style.cursor = "");
    });
  }

  function availability(id) {
    const cat = id2cat => S.catalog.find(d => d.id === id2cat);
    switch (id) {
      case "predictions": return data.predictions ? [true] : [false, S.window ? `No model output for ${S.window}` : "No window selected"];
      case "hazards": return data.hazards.length ? [true] : [false, "hazard_zones.geojson not loaded"];
      case "roads": return data.roads.length ? [true] : [false, (cat("roads") || {}).status === "missing" ? "Run scripts/fetch_osm.py roads" : "No roads in region"];
      case "incidents": return data.incidents.length ? [true, "Seed records — proxy locations"] : [false, "No incidents for filter"];
      case "settlements": return data.settlements.length ? [true, "Reference town centres"] : [false, "None in region"];
      case "regions": return [true, "Not official boundaries"];
      case "hillshade": return [true, engine === "mapbox" ? "Mapbox Terrain-DEM" : "AWS Terrain Tiles (Mapzen)"];
      default: return [false, LAYERS.find(l => l.id === id).why];
    }
  }

  function renderLayerPanel() {
    const list = document.getElementById("layer-list");
    list.innerHTML = LAYERS.map(l => {
      const [ok, why] = availability(l.id);
      return `<div class="layer ${ok ? "" : "disabled"}" data-id="${l.id}">
        <label class="layer-row">
          <input type="checkbox" ${l.visible && ok ? "checked" : ""} ${ok ? "" : "disabled"}>
          <span class="sw" style="background:${l.sw}"></span>${UI.esc(l.label)}
          ${ok ? "" : '<span class="tag">No data</span>'}
        </label>
        ${l.prop && ok ? `<div class="op">Opacity <input type="range" min="0" max="1" step="0.05" value="${l.opacity}"></div>` : ""}
        ${why ? `<div class="why">${UI.esc(why)}</div>` : ""}
      </div>`;
    }).join("");
    list.querySelectorAll(".layer").forEach(div => {
      const l = LAYERS.find(x => x.id === div.dataset.id);
      div.querySelector("input[type=checkbox]").addEventListener("change", e => { l.visible = e.target.checked; applyVisibility(); });
      const r = div.querySelector("input[type=range]");
      if (r) r.addEventListener("input", e => {
        l.opacity = +e.target.value;
        l.layers.forEach(id => map.getLayer(id) && map.setPaintProperty(id, l.prop, l.opacity));
      });
    });
    renderLegend();
  }

  function applyVisibility() {
    if (!ready) return;
    LAYERS.forEach(l => l.layers.forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", l.visible && availability(l.id)[0] ? "visible" : "none");
    }));
    BASEMAPS.forEach(b => {
      map.setLayoutProperty("base-" + b.id, "visibility", b.id === basemap ? "visible" : "none");
    });
    if (map.getLayer("base-satref")) map.setLayoutProperty("base-satref", "visibility", basemap === "sat" ? "visible" : "none");
  }

  function renderLegend() {
    const rows = [];
    if (data.predictions) {
      const st = (data.predictions.features[0] || {}).properties || {};
      rows.push(`<div class="panel-h">Model output — ${UI.esc(st.score_type || "type not declared")}</div>`);
      Object.entries(RISK_COLORS).forEach(([k, c]) => rows.push(`<div class="li"><span class="sw" style="background:${c}"></span>${k}</div>`));
    }
    rows.push(`<div class="li"><span class="ring" style="border:2.5px solid #f0b44a"></span>Incident (proxy location)</div>`);
    rows.push(`<div class="li"><span class="sw" style="background:rgba(227,169,63,.25);border:1px solid #e3a93f"></span>Location uncertainty radius</div>`);
    rows.push(`<div class="li"><span class="ring" style="background:#e4ecf6"></span>Settlement (reference)</div>`);
    if (data.roads.length) rows.push(`<div class="li"><span class="sw" style="background:#22c7d8;height:3px"></span>Road centerline (OSM)</div>`);
    rows.push(`<div class="li"><span class="sw" style="border:1px dashed #22c7d8"></span>Study area — indicative, not official</div>`);
    document.getElementById("map-legend").innerHTML = rows.join("");
  }

  function renderBasemapSeg() {
    const seg = document.getElementById("basemap-seg");
    seg.innerHTML = BASEMAPS.map(b => `<button type="button" data-b="${b.id}" class="${b.id === basemap ? "on" : ""}">${b.label}</button>`).join("");
    seg.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
      basemap = btn.dataset.b; renderBasemapSeg(); applyVisibility();
    }));
  }

  function renderDate() {
    const w = UI.currentWindow();
    document.getElementById("map-date").innerHTML =
      `<b>Region:</b> ${UI.esc(UI.regionName(S.region))}<br><b>Window:</b> ${w ? UI.esc(w.label) + ` <span class="mono muted">${w.id}</span>` : "—"}<br>` +
      `<b>Model layer:</b> ${data.predictions ? "available" : '<span style="color:#f0c97a">no model output for this window</span>'}`;
  }

  function showDetail(layer, f) {
    const p = f.properties, el = document.getElementById("map-detail");
    const meta = id => S.catalog.find(d => d.id === id) || {};
    let title = "", rows = [], dsId = "";
    if (layer === "inc-pt" || layer === "inc-halo") {
      dsId = "incidents"; title = p.location_name;
      rows = [["Incident ID", `<span class="mono">${UI.esc(p.incident_id)}</span>`], ["Event date", UI.dash(p.event_date) + ` <span class="muted">(${UI.esc(p.date_precision)})</span>`],
        ["Report date", UI.dash(p.report_date)], ["Location type", `<span class="tag warn">${UI.esc(p.coord_type)}</span> ${UI.esc(p.coord_precision)}`],
        ["Description", UI.dash(p.description)], ["Fatalities", `${UI.dash(p.fatalities_reported)} <span class="muted">reported</span>`],
        ["Impact note", UI.dash(p.impact_note)], ["Source", UI.dash(p.source_org)], ["Verification", UI.verifTag(p.verification_status)], ["Notes", UI.dash(p.notes)]];
    } else if (layer === "set-pt") {
      dsId = "settlements"; title = p.name;
      rows = [["Admin area", UI.dash(p.admin_area)], ["District", UI.dash(p.district)], ["Coordinates", `<span class="mono">${f.geometry.coordinates.map(c => (+c).toFixed(4)).join(", ")}</span>`],
        ["Position quality", UI.dash(p.coord_quality)], ["Population", p.population ? UI.fmtNum(p.population) : '<span class="muted">Not loaded</span>'],
        ["Exposure", UI.dash(p.exposure_category)], ["Incidents ≤10 km", UI.dash(p.incidents_within_10km)]];
    } else if (layer === "road-line") {
      dsId = "roads"; title = p.name || p.ref || p.osm_id;
      rows = [["Route", UI.dash(p.ref)], ["Class", UI.dash(p.highway)], ["Length (km)", UI.dash(p.length_km)], ["Hazard-affected km", UI.dash(p.hazard_affected_km)],
        ["Relevant incidents", UI.dash((Array.isArray(p.relevant_incidents) ? p.relevant_incidents : JSON.parse(p.relevant_incidents || "[]")).join(", "))], ["Status", UI.dash(p.status_wording)], ["OSM ID", UI.dash(p.osm_id)]];
    } else if (layer === "pred-fill") {
      dsId = null; title = `Model output — ${p.risk_class}`;
      rows = Object.entries(p).map(([k, v]) => [k, UI.dash(v)]);
    } else {
      dsId = "hazard_zones"; title = p.category || "Hazard zone";
      rows = Object.entries(p).map(([k, v]) => [k, UI.dash(v)]);
    }
    const m = dsId ? meta(dsId) : { title: "Model prediction", source: (S.model || {}).model_name };
    el.innerHTML = `<button class="close" aria-label="Close">×</button><div class="eyebrow">${UI.esc(m.title || "")}</div><h4>${UI.esc(title)}</h4>
      ${UI.dl(rows)}
      <div class="notice" style="margin-top:12px;font-size:12px"><strong>Source:</strong> ${UI.esc(m.source || "—")}<br><strong>Limitations:</strong> ${UI.esc(m.limitations || "—")}</div>`;
    el.hidden = false;
    el.querySelector(".close").onclick = () => el.hidden = true;
  }

  async function refreshData() {
    const params = { region: S.region, window: S.window };
    const [inc, set, roads, haz, pred] = await Promise.all([
      UI.api("incidents", { region: S.region }), UI.api("settlements", params), UI.api("roads", params),
      UI.api("layer/hazard_zones"), S.window ? UI.api("predictions", { window: S.window }) : Promise.resolve({ available: false }),
    ]);
    data.incidents = inc.features; data.settlements = set.features; data.roads = roads.features;
    data.hazards = haz.features; data.predictions = pred.available ? pred : null;
    if (!ready) return;
    map.getSource("incidents").setData(fc(data.incidents));
    map.getSource("inc-halos").setData(fc(data.incidents.map(halo)));
    map.getSource("settlements").setData(fc(data.settlements));
    map.getSource("roads").setData(fc(data.roads));
    map.getSource("hazards").setData(fc(data.hazards));
    map.getSource("predictions").setData(fc(data.predictions ? data.predictions.features : []));
    map.setFilter("reg-sel", ["==", ["get", "id"], S.region]);
    renderLayerPanel(); applyVisibility(); renderDate();
  }

  function zoomToRegion() {
    if (!ready) return;
    const r = S.regions.find(r => r.properties.id === S.region);
    if (r) {
      const [w, s, e, n] = r.properties.bbox, narrow = map.getContainer().clientWidth < 700;
      map.resize();
      map.fitBounds([[w, s], [e, n]], { padding: narrow ? 20 : { top: 40, bottom: 40, left: 330, right: 60 }, duration: 1200 });
    }
  }

  function setupSearch() {
    const inp = document.getElementById("map-search"), out = document.getElementById("search-results");
    inp.addEventListener("input", () => {
      const q = inp.value.trim().toLowerCase();
      if (q.length < 2) { out.innerHTML = ""; return; }
      const hits = [
        ...S.regions.filter(r => r.properties.name.toLowerCase().includes(q)).map(r => ({ t: r.properties.name, k: "Region", bbox: r.properties.bbox })),
        ...data.settlements.filter(f => f.properties.name.toLowerCase().includes(q)).map(f => ({ t: f.properties.name, k: "Settlement", c: f.geometry.coordinates, f, l: "set-pt" })),
        ...data.incidents.filter(f => (f.properties.location_name + f.properties.incident_id).toLowerCase().includes(q)).map(f => ({ t: f.properties.location_name, k: "Incident", c: f.geometry.coordinates, f, l: "inc-pt" })),
      ].slice(0, 8);
      out.innerHTML = hits.length ? hits.map((h, i) => `<button type="button" data-i="${i}">${UI.esc(h.t)}<small>${h.k}</small></button>`).join("") : '<span class="muted" style="font-size:12px">No matches in loaded data</span>';
      out.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
        const h = hits[+b.dataset.i];
        if (h.bbox) map.fitBounds([[h.bbox[0], h.bbox[1]], [h.bbox[2], h.bbox[3]]], { padding: 40 });
        else { map.flyTo({ center: h.c, zoom: 9.5, duration: 1500 }); showDetail(h.l, h.f); }
        out.innerHTML = ""; inp.value = "";
      }));
    });
  }

  async function init() {
    const banner = document.getElementById("map-banner");
    try {
      await loadEngine();
    } catch (e) {
      loadFailed = true;
      banner.hidden = false;
      banner.innerHTML = "<b>Map library could not be loaded.</b> Check the internet connection. All tables, exports and reports remain available.";
      return;
    }
    if (engine === "maplibre") {
      banner.hidden = false;
      banner.innerHTML = "No <code>MAPBOX_TOKEN</code> configured — using open basemaps (Esri, OpenTopoMap, CARTO). Add a restricted token in <code>.env</code> to enable Mapbox.";
      setTimeout(() => banner.hidden = true, 7000);
    }
    try {
      MapPerf.tune(gl);
      map = new gl.Map(MapPerf.opts({ container: "map-canvas", style: baseStyle(), center: [74.0, 35.4], zoom: 6.1, maxPitch: 70, attributionControl: true, hash: false }));
    } catch (e) {
      loadFailed = true;
      banner.hidden = false;
      banner.innerHTML = "<b>This browser cannot display the interactive map (WebGL unavailable).</b> Enable hardware acceleration or use a current Chrome / Edge / Firefox. Tables, exports and reports remain available.";
      return;
    }
    map.addControl(new gl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new gl.ScaleControl({ maxWidth: 140, unit: "metric" }), "bottom-right");
    map.addControl(new gl.FullscreenControl(), "bottom-right");
    map.on("error", e => console.warn("Map error:", e && e.error && e.error.message));
    // Overlays only need the style, not every basemap tile.
    await new Promise(res => { if (map.isStyleLoaded()) res(); else { map.once("style.load", res); map.once("load", res); } });
    if (ready) return;
    addOverlays();
    ready = true;
    renderBasemapSeg(); setupSearch();
    await refreshData();
    zoomToRegion();
    document.getElementById("foot-engine").textContent =
      `Map engine: ${engine === "mapbox" ? "Mapbox GL JS v3" : "MapLibre GL JS v4 (token-free)"} · Basemap boundaries are shown as provided by the basemap vendor`;
  }

  let initPromise = null;
  return {
    async show() {
      document.getElementById("map-view").hidden = false;
      if (!initPromise) initPromise = init().catch(e => { console.error(e); });
      await initPromise;
      if (map) setTimeout(() => map.resize(), 30);
    },
    hide() { document.getElementById("map-view").hidden = true; },
    async onContextChange(what) {
      if (!initPromise || loadFailed) return;
      await initPromise;
      await refreshData();
      if (what === "region") zoomToRegion();
    },
    focus(lon, lat) { if (map) map.flyTo({ center: [lon, lat], zoom: 9.5 }); },
    get engine() { return engine; },
  };
})();
window.MapView = MapView;
