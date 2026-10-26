/* Hindu Kush avalanche-terrain screening workspace.
   Everything shown comes from one imported run (scripts/build_hk_screening.py): the very-high
   release areas, the per-tile summary, the run's thresholds and its own figures. It is a
   terrain-susceptibility screening — not a forecast, not a probability, not validated. */
"use strict";

const HK = (() => {
  const ASPECTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const CLS = { low: "#ffffb2", moderate: "#fecc5c", high: "#fd8d3c", very_high: "#bd0026", runout: "#8c6bb1" };
  const HK_BOUNDS = [[71.05, 34.72], [74.23, 37.3]];
  const st = {
    run: null, hotspots: [], tiles: [], settlements: [], allSettlements: [], map: null, gl: null, ready: false,
    minHa: 120, facing: new Set(), tile: "", listN: 10, sel: null, terrain: false, base: "sat",
    overlay: true, overlayOp: 0.8, showHeat: false, showPts: true, showTiles: false, showSet: true,
    markers: [], tour: null, popup: null,
  };
  const $ = sel => document.querySelector(sel);
  // Small line icons for the floating KPI cards and layer rows.
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    peak: svg('<path d="m3 20 6-11 4 6 3-4 5 9H3z"/><path d="m7.5 12 1.5 1.5 1.5-1.5"/>'),
    warn: svg('<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/>'),
    flow: svg('<path d="M5 3c0 6 4 7 7 9s5 5 5 9"/><path d="M13 21h4.5v-4.5"/>'),
    pin: svg('<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
    grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  };
  // Sector colour of the aspect rose: yellow (few areas) -> dark red (most), the run's palette.
  const RAMP = ["#fecc5c", "#fd8d3c", "#e31a1c", "#bd0026"];
  const ramp = t => RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
  // Keep the class layer clear of the floating panels when framing the study area.
  const pad = () => window.innerWidth > 1500 ? { top: 112, bottom: 40, left: 230, right: 410 }
    : window.innerWidth > 1100 ? { top: 210, bottom: 40, left: 230, right: 410 } : 30;
  // The layer controls sit in the header dock, so only the icon rail (about 90 px) covers the map's left edge.
  const padMap = () => { const p = pad(); return typeof p === "number" ? p : { ...p, left: 110, top: Math.min(p.top, 112) }; };
  const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fc = f => ({ type: "FeatureCollection", features: f });

  // Nearest populated area (approximate town centre, no population figure): haversine distance and the compass
  // direction of the point as seen from the town.
  function nearestTown(lon, lat) {
    let best = null;
    const R = 6371.0088, rad = Math.PI / 180;
    st.allSettlements.forEach(t => {
      const [x, y] = t.geometry.coordinates, dp = (lat - y) * rad, dl = (lon - x) * rad;
      const a = Math.sin(dp / 2) ** 2 + Math.cos(y * rad) * Math.cos(lat * rad) * Math.sin(dl / 2) ** 2;
      const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
      if (!best || d < best.km) {
        const b = (Math.atan2(Math.sin(dl) * Math.cos(lat * rad), Math.cos(y * rad) * Math.sin(lat * rad) - Math.sin(y * rad) * Math.cos(lat * rad) * Math.cos(dl)) / rad + 360) % 360;
        best = { name: t.properties.name, km: d, dir: ASPECTS[Math.round(b / 45) % 8] };
      }
    });
    return best;
  }
  const nearText = (lon, lat) => { const n = nearestTown(lon, lat); return n ? (n.km < 1 ? "at" : `~${Math.round(n.km)} km ${n.dir} of`) + ` ${UI.esc(n.name)}` : "—"; };

  // ------------------------------------------------------------ data helpers
  function filtered() {
    return st.hotspots.filter(f => {
      const p = f.properties;
      return p.area_ha >= st.minHa && (!st.facing.size || st.facing.has(p.facing)) && (!st.tile || p.tile_id === st.tile);
    });
  }
  const filterQs = () => UI.qs({ min_ha: st.minHa > 5 ? st.minHa : "", facing: [...st.facing].join(","), tile: st.tile });

  // ------------------------------------------------------------ engine
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function loadCss(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
  }
  async function engine() {
    const token = S.config.mapbox_token;
    if (token) {
      loadCss("https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css");
      if (!window.mapboxgl) await loadScript("https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js");
      window.mapboxgl.accessToken = token;
      return ["mapbox", window.mapboxgl];
    }
    loadCss("/static/vendor/maplibre-gl.css");
    if (!window.maplibregl) await loadScript("/static/vendor/maplibre-gl.js");
    return ["maplibre", window.maplibregl];
  }

  function style(kind) {
    const t = S.config.mapbox_token;
    const mb = id => `https://api.mapbox.com/styles/v1/mapbox/${id}/tiles/256/{z}/{x}/{y}@2x?access_token=${t}`;
    const sources = kind === "mapbox" ? {
      sat: { type: "raster", tiles: [mb("satellite-v9")], tileSize: 256, attribution: "© Mapbox © Maxar" },
      dark: { type: "raster", tiles: [mb("dark-v11")], tileSize: 256, attribution: "© Mapbox © OpenStreetMap" },
      dem: MapPerf.dem(),
      demhs: MapPerf.dem(),
    } : {
      sat: { type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
             tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] },
      dark: { type: "raster", tileSize: 256, attribution: "© CARTO © OpenStreetMap contributors",
              tiles: ["https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png"] },
      dem: MapPerf.dem(),
      demhs: MapPerf.dem(),
    };
    return {
      version: 8, sources,
      glyphs: kind === "mapbox" ? "mapbox://fonts/mapbox/{fontstack}/{range}.pbf" : "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#0b1626" } },
        { id: "base-sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.25, "raster-brightness-max": 0.92 } },
        { id: "base-dark", type: "raster", source: "dark", layout: { visibility: "none" } },
        { id: "hs", type: "hillshade", source: "demhs", paint: { "hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#000", "hillshade-highlight-color": "#fff" } },
      ],
    };
  }

  // ------------------------------------------------------------ map
  async function initMap(el) {
    let kind, gl;
    try { [kind, gl] = await engine(); }
    catch { el.innerHTML = UI.empty("Map library could not be loaded", "<p>Check the internet connection. The hotspot list, charts and exports below still work.</p>"); return; }
    if (!document.body.contains(el)) return;
    let map;
    try {
      MapPerf.tune(gl);
      map = new gl.Map(MapPerf.opts({ container: el, style: style(kind), center: [72.64, 36.0], zoom: 5.6,
                         maxPitch: 75, attributionControl: true, hash: false, cooperativeGestures: false }));
    } catch {
      el.innerHTML = UI.empty("Interactive map unavailable", "<p>This browser cannot use WebGL. Enable hardware acceleration or use a current Chrome / Edge.</p>"); return;
    }
    st.map = map; st.gl = gl; st.engine = kind;
    map.addControl(new gl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new gl.ScaleControl({ maxWidth: 130, unit: "metric" }), "bottom-left");
    map.addControl(new gl.FullscreenControl({ container: el.closest(".hk-stage") }), "bottom-right");
    map.on("error", e => console.warn("HK map:", e && e.error && e.error.message));
    await new Promise(res => { if (map.isStyleLoaded()) res(); else { map.once("style.load", res); map.once("load", res); } });
    if (st.map !== map) return;
    map.fitBounds(HK_BOUNDS, { padding: padMap(), duration: 2600, essential: true });

    const ov = st.run.overlay || {};
    if (ov.available) {
      map.addSource("classes", { type: "image", url: ov.image, coordinates: ov.coordinates });
      map.addLayer({ id: "classes", type: "raster", source: "classes", paint: { "raster-opacity": st.overlayOp, "raster-resampling": "nearest", "raster-fade-duration": 0 } });
    }
    const bnd = await UI.api("layer/boundaries").catch(() => ({ features: [] }));
    if (st.map !== map) return;
    map.addSource("bnd", { type: "geojson", data: fc(bnd.features.filter(f => ["pakistan", "province"].includes(f.properties.layer))) });
    map.addLayer({ id: "bnd-prov", type: "line", source: "bnd", filter: ["==", ["get", "layer"], "province"],
                   paint: { "line-color": "#ffffff", "line-opacity": 0.55, "line-width": 1, "line-dasharray": [3, 2] } });
    map.addLayer({ id: "bnd-pak", type: "line", source: "bnd", filter: ["==", ["get", "layer"], "pakistan"],
                   paint: { "line-color": "#ffffff", "line-opacity": 0.9, "line-width": 1.8 } });

    map.addSource("tiles", { type: "geojson", data: fc(st.tiles) });
    map.addLayer({ id: "tile-pt", type: "circle", source: "tiles", layout: { visibility: st.showTiles ? "visible" : "none" }, paint: {
      "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "very_high_area_ha"]], 0, 3, 80, 22],
      "circle-color": "rgba(34,199,216,0.10)", "circle-stroke-color": "#22c7d8", "circle-stroke-width": 1.4 } });
    map.addLayer({ id: "tile-lbl", type: "symbol", source: "tiles", minzoom: 7.4, layout: { visibility: st.showTiles ? "visible" : "none",
      "text-field": ["get", "tile_id"], "text-font": ["Open Sans Semibold"], "text-size": 10.5, "text-allow-overlap": false },
      paint: { "text-color": "#bff6fc", "text-halo-color": "#04101d", "text-halo-width": 1.4 } });

    map.addSource("hs", { type: "geojson", data: fc(filtered()) });
    map.addLayer({ id: "hs-heat", type: "heatmap", source: "hs", maxzoom: 10, paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "area_ha"], 5, 0.15, 60, 0.6, 360, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 0.55, 9, 1.4],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 7, 9, 22],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 7.5, 0.85, 10, 0],
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.15, "rgba(254,204,92,0.35)",
                        0.4, "rgba(253,141,60,0.65)", 0.7, "rgba(227,26,28,0.85)", 1, "rgba(128,0,38,0.95)"] } });
    map.addLayer({ id: "hs-pt", type: "circle", source: "hs", minzoom: 7.2, paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7.2, ["interpolate", ["linear"], ["sqrt", ["get", "area_ha"]], 2.2, 1.6, 19, 7],
                        12, ["interpolate", ["linear"], ["sqrt", ["get", "area_ha"]], 2.2, 5, 19, 22]],
      "circle-color": ["interpolate", ["linear"], ["get", "max_score"], 0.65, "#fd8d3c", 0.85, "#e31a1c", 1, "#800026"],
      "circle-stroke-color": "#fff", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 7.2, 0.4, 12, 1.4],
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 7.2, 0, 7.8, 0.9] } });
    // The hover ring has its own one-point source: filtering the 16,388-point "hs" source would re-tile it on every hover.
    map.addSource("hs-hover", { type: "geojson", data: fc([]) });
    map.addLayer({ id: "hs-hover", type: "circle", source: "hs-hover", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 10, 12, 30], "circle-color": "rgba(254,204,92,0.22)",
      "circle-stroke-color": "#fecc5c", "circle-stroke-width": 2.2 } });
    map.addLayer({ id: "hs-sel", type: "circle", source: "hs", filter: ["==", ["get", "rank"], -1], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 9, 12, 28], "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#22c7d8", "circle-stroke-width": 3 } });

    map.addSource("set", { type: "geojson", data: fc(st.settlements) });
    map.addLayer({ id: "set-pt", type: "circle", source: "set", paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": "#0b1626", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: "set-lbl", type: "symbol", source: "set", layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"],
      "text-size": 12.5, "text-offset": [0, 1.05], "text-anchor": "top" }, paint: { "text-color": "#fff", "text-halo-color": "#04101d", "text-halo-width": 1.6 } });

    st.popup = new gl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "hk-tip" });
    map.on("mousemove", "hs-pt", e => {
      map.getCanvas().style.cursor = "pointer";
      const p = e.features[0].properties;
      hover(+p.rank);
      st.popup.setLngLat(e.lngLat).setHTML(tipHtml(p)).addTo(map);
    });
    map.on("mouseleave", "hs-pt", () => { map.getCanvas().style.cursor = ""; hover(null); st.popup.remove(); });
    map.on("click", "hs-pt", e => { e.preventDefault?.(); select(+e.features[0].properties.rank, false); });
    map.on("mousemove", "tile-pt", e => {
      if (map.queryRenderedFeatures(e.point, { layers: ["hs-pt"] }).length) return;
      map.getCanvas().style.cursor = "pointer";
      const p = e.features[0].properties;
      st.popup.setLngLat(e.lngLat).setHTML(`<div class="hk-tip-h">Analysis tile <b class="mono">${UI.esc(p.tile_id)}</b></div>
        ${(p.share_high_or_very_high * 100).toFixed(0)}% High/Very high · ${fmt(p.hotspots)} areas ≥ 5 ha<div class="muted">Click to inspect the tile</div>`).addTo(map);
    });
    map.on("mouseleave", "tile-pt", () => { map.getCanvas().style.cursor = ""; st.popup.remove(); });
    map.on("click", "tile-pt", e => {
      if (e.defaultPrevented) return;
      showTile(e.features[0].properties.tile_id);
    });
    map.on("mousemove", e => {
      const c = $("#hk-coord"); if (c) c.textContent = `${e.lngLat.lat.toFixed(4)}°N  ${e.lngLat.lng.toFixed(4)}°E`;
    });
    ["dragstart", "wheel", "touchstart"].forEach(ev => map.on(ev, e => { if (e.originalEvent) stopTour(); }));

    st.ready = true;
    applyLayers(); refreshMarkers();
    const eng = $("#hk-engine"); if (eng) eng.textContent = kind === "mapbox" ? "Mapbox GL JS v3" : "MapLibre GL JS (token-free)";
  }

  // Hover ring on the map, shared by map points, list rows and rank badges.
  function hover(rank) {
    const src = st.ready && st.map.getSource("hs-hover");
    if (!src) return;
    const f = rank == null ? null : filtered().find(x => x.properties.rank === rank);
    src.setData(fc(f ? [{ type: "Feature", geometry: f.geometry, properties: {} }] : []));
  }
  const tipHtml = p => `<div class="hk-tip-h"><span class="hk-rk ${p.rank <= 10 ? "top" : ""}">${p.rank}</span> <b>${fmt(p.area_ha, 1)} ha</b> very-high area</div>
    ${fmt(p.mean_elev_m)} m · ${fmt(p.mean_slope_deg, 1)}° · faces ${UI.esc(p.facing)}<br>
    <span class="muted">Screening index</span> <b>${fmt(p.max_score, 2)}</b> <span class="muted">(not a probability)</span>`;

  function vis(id, on) { if (st.map && st.map.getLayer(id)) st.map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }
  function applyLayers() {
    if (!st.ready) return;
    const m = st.map;
    vis("classes", st.overlay);
    if (m.getLayer("classes")) m.setPaintProperty("classes", "raster-opacity", st.overlayOp);
    vis("hs-heat", st.showHeat); vis("hs-pt", st.showPts);
    vis("tile-pt", st.showTiles); vis("tile-lbl", st.showTiles);
    vis("set-pt", st.showSet); vis("set-lbl", st.showSet);
    vis("base-sat", st.base === "sat"); vis("base-dark", st.base === "dark");
    vis("hs", st.base === "dark" || !st.terrain);
    if (st.terrain) { m.setTerrain({ source: "dem", exaggeration: 1.5 }); if (m.getPitch() < 30) m.easeTo({ pitch: 60, duration: 900 }); }
    else { m.setTerrain(null); if (m.getPitch() > 0) m.easeTo({ pitch: 0, bearing: 0, duration: 700 }); }
  }

  // Numbered badges for the hotspots currently in the list.
  function refreshMarkers() {
    st.markers.forEach(m => m.remove()); st.markers = [];
    if (!st.ready) return;
    filtered().slice(0, Math.min(st.listN, 25)).forEach(f => {
      const p = f.properties, d = document.createElement("button");
      d.type = "button"; d.className = "hk-badge" + (p.rank === st.sel ? " on" : "") + (p.rank <= 10 ? " top" : "");
      d.textContent = p.rank; d.title = `#${p.rank} · ${fmt(p.area_ha, 1)} ha`;
      d.addEventListener("click", ev => { ev.stopPropagation(); stopTour(); select(p.rank); });
      d.addEventListener("mouseenter", () => hover(p.rank));
      d.addEventListener("mouseleave", () => hover(null));
      st.markers.push(new st.gl.Marker({ element: d }).setLngLat(f.geometry.coordinates).addTo(st.map));
    });
  }

  function refreshData() {
    if (st.ready) st.map.getSource("hs").setData(fc(filtered()));
    if (window.HKF) HKF.refresh();
    refreshMarkers(); renderList(); renderRose(); renderElev(); renderExports();
  }

  // ------------------------------------------------------------ selection
  function select(rank, fly = true) {
    const f = st.hotspots.find(x => x.properties.rank === rank);
    if (!f) return;
    st.sel = rank;
    const p = f.properties, [lon, lat] = f.geometry.coordinates;
    if (st.ready) {
      st.map.setFilter("hs-sel", ["==", ["get", "rank"], rank]);
      if (fly) st.map.flyTo({ center: [lon, lat], zoom: 11.4, pitch: st.terrain ? 62 : 0, bearing: st.terrain ? -20 : 0, duration: 2600, essential: true });
    }
    document.querySelectorAll(".hk-badge:not(.mini)").forEach(b => b.classList.toggle("on", +b.textContent === rank));
    document.querySelectorAll(".hk-row").forEach(r => r.classList.toggle("sel", +r.dataset.rank === rank));
    const list = (window.HKF && HKF.order()) || filtered(), i = list.findIndex(x => x.properties.rank === rank);
    const tile = st.tiles.find(t => t.properties.tile_id === p.tile_id);
    const card = $("#hk-detail");
    if (!card) return;
    card.innerHTML = `<button class="close" aria-label="Close">×</button>
      <div class="eyebrow">Very-high release area · terrain screening</div>
      <h4><span class="hk-rk">#${p.rank}</span> ${fmt(p.area_ha, 1)} ha <small class="muted">of ${fmt(st.hotspots.length)}</small></h4>
      ${UI.dl([
        ["Centroid", `<span class="mono">${lat.toFixed(5)}°N, ${lon.toFixed(5)}°E</span>`],
        ["Mean elevation", `${fmt(p.mean_elev_m)} m`], ["Mean slope", `${fmt(p.mean_slope_deg, 1)}°`],
        ["Faces", `${UI.esc(p.facing)} <span class="muted">(${aspectWord(p.facing)})</span>`],
        ["Max screening score", `${fmt(p.max_score, 2)} <span class="muted">index 0–1, not a probability</span>`],
        ["Analysis tile", `<a href="#hindukush" data-tile="${UI.esc(p.tile_id)}" class="hk-tilelink mono">${UI.esc(p.tile_id)}</a>${tile ? ` <span class="muted">· ${(tile.properties.share_high_or_very_high * 100).toFixed(0)}% High/Very high</span>` : ""}`],
      ])}
      <div class="hk-dact">
        <button class="btn" type="button" data-step="-1" ${i <= 0 ? "disabled" : ""}>‹ Prev</button>
        <button class="btn" type="button" id="hk-copy">Copy coordinates</button>
        <a class="btn" href="https://maps.google.com/?q=${lat.toFixed(5)},${lon.toFixed(5)}" target="_blank" rel="noopener">Google Maps ↗</a>
        <button class="btn" type="button" data-step="1" ${i < 0 || i >= list.length - 1 ? "disabled" : ""}>Next ›</button>
      </div>
      <p class="hk-fine">Point = centroid of the contiguous Very-high area. Potential release terrain — requires field verification. Not a statement that an avalanche will occur.${p.rank <= 10 && st.run.overlay && st.run.overlay.available ? " The class layer is blank within about 3 km of this point: the source figure's numbered circle covers it, and the gap is not filled in." : ""}</p>`;
    card.hidden = false;
    card.querySelector(".close").onclick = () => { card.hidden = true; st.sel = null; if (st.ready) st.map.setFilter("hs-sel", ["==", ["get", "rank"], -1]); };
    card.querySelectorAll("[data-step]").forEach(b => b.onclick = () => { stopTour(); const n = list[i + +b.dataset.step]; if (n) select(n.properties.rank); });
    card.querySelector("#hk-copy").onclick = e => {
      navigator.clipboard?.writeText(`${lat.toFixed(5)}, ${lon.toFixed(5)}`).then(() => { e.target.textContent = "Copied ✓"; setTimeout(() => e.target.textContent = "Copy coordinates", 1400); });
    };
    card.querySelector(".hk-tilelink").onclick = e => { e.preventDefault(); showTile(p.tile_id); };
    const row = document.querySelector(`.hk-row[data-rank="${rank}"]`);
    if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  const aspectWord = a => ({ N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" }[a] || a);

  function showTile(id) {
    const t = st.tiles.find(x => x.properties.tile_id === id);
    if (!t) return;
    stopTour();
    st.tile = id; const sel = $("#hk-tile"); if (sel) sel.value = id;
    refreshData();
    const p = t.properties, [lon, lat] = t.geometry.coordinates;
    if (st.ready) st.map.flyTo({ center: [lon, lat], zoom: 9.6, pitch: st.terrain ? 50 : 0, duration: 2000 });
    const card = $("#hk-detail");
    const seg = ["low", "moderate", "high", "very_high", "runout"];
    card.innerHTML = `<button class="close" aria-label="Close">×</button>
      <div class="eyebrow">Analysis tile · terrain screening</div><h4 class="mono">${UI.esc(id)}</h4>
      <div class="hk-stack">${seg.map(k => `<i style="flex:${p["share_" + k]};background:${CLS[k]}" title="${k.replace("_", " ")}: ${(p["share_" + k] * 100).toFixed(1)}%"></i>`).join("")}
        <i style="flex:${Math.max(0, 1 - seg.reduce((a, k) => a + p["share_" + k], 0))};background:#2a3a52" title="Not avalanche terrain / no snow"></i></div>
      ${UI.dl([
        ["High + Very high", `${(p.share_high_or_very_high * 100).toFixed(1)}% of tile`],
        ["Very-high area", `${fmt(p.very_high_area_ha)} ha`], ["Very-high areas ≥ 5 ha", fmt(p.hotspots)],
        ["Tile area", p.tile_area_km2 ? `${fmt(p.tile_area_km2)} km² <span class="muted">(derived)</span>` : "—"],
        ["Max score", fmt(p.max_score, 3)], ["Tile centre", `<span class="mono">${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</span>`],
      ])}
      <div class="hk-dact"><button class="btn" type="button" id="hk-cleartile">Show all tiles</button></div>
      <p class="hk-fine">The hotspot list is now filtered to this tile. Grey = share of the tile that is not winter avalanche terrain.</p>`;
    card.hidden = false;
    card.querySelector(".close").onclick = () => card.hidden = true;
    card.querySelector("#hk-cleartile").onclick = () => { clearTile(); card.hidden = true; };
  }
  function clearTile() {
    st.tile = ""; const sel = $("#hk-tile"); if (sel) sel.value = "";
    refreshData();
    if (st.ready) st.map.fitBounds(HK_BOUNDS, { padding: padMap(), pitch: st.terrain ? 45 : 0, duration: 1500 });
  }

  // ------------------------------------------------------------ guided tour
  function startTour() {
    const list = filtered().slice(0, Math.min(st.listN, 10));
    if (!list.length) return;
    let k = 0;
    const step = () => { select(list[k].properties.rank); k = (k + 1) % list.length; };
    step();
    st.tour = setInterval(step, 6500);
    const b = $("#hk-tour"); if (b) { b.classList.add("on"); b.innerHTML = `${UI.ICON.pause} Stop tour`; }
  }
  function stopTour() {
    if (!st.tour) return;
    clearInterval(st.tour); st.tour = null;
    const b = $("#hk-tour"); if (b) { b.classList.remove("on"); b.innerHTML = `${UI.ICON.play} Tour top 10`; }
  }

  // ------------------------------------------------------------ side panel
  function renderList() {
    const el = $("#hk-list"); if (!el) return;
    const keep = el.scrollTop;
    const side = window.HKF && HKF.sideList(), title = $("#hk-side-t");
    if (title) title.textContent = side ? side.title : "Hotspots: where to look first";
    const list = filtered(), shown = list.slice(0, st.listN);
    $("#hk-count").innerHTML = side ? side.count : `<b>${fmt(list.length)}</b> of ${fmt(st.hotspots.length)} areas · ${fmt(list.reduce((a, f) => a + f.properties.area_ha, 0) / 100)} km²`;
    el.innerHTML = side ? side.html : shown.length ? shown.map(f => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      return `<button type="button" class="hk-row ${p.rank === st.sel ? "sel" : ""}" data-rank="${p.rank}">
        <span class="hk-rk ${p.rank <= 10 ? "top" : ""}">${p.rank}</span>
        <span class="hk-rmain"><b>${fmt(p.area_ha, 1)} ha</b> <span class="mono muted">${UI.esc(p.tile_id)}</span><br>
          <small>${fmt(p.mean_elev_m)} m · ${fmt(p.mean_slope_deg, 1)}° · ${UI.esc(p.facing)} · <span class="mono">${lat.toFixed(4)}, ${lon.toFixed(4)}</span></small></span>
        <span class="hk-ar" style="transform:rotate(${ASPECTS.indexOf(p.facing) * 45}deg)" title="Faces ${UI.esc(p.facing)}">↑</span></button>`;
    }).join("") : UI.empty("No areas match these filters", "<p>Lower the minimum area or clear the aspect / tile filter.</p>");
    el.scrollTop = keep;
    el.querySelectorAll(".hk-row").forEach(r => {
      r.addEventListener("click", () => {
        stopTour(); if (window.HKF) HKF.stopAll();
        if (r.dataset.fly) {   // weather tile: no hotspot to select, just go there
          const [lon, lat] = r.dataset.fly.split(",").map(Number);
          el.querySelectorAll(".hk-row").forEach(x => x.classList.toggle("sel", x === r));
          if (st.ready) st.map.flyTo({ center: [lon, lat], zoom: 9.8, pitch: st.terrain ? 55 : 0, duration: 2200, essential: true });
        } else select(+r.dataset.rank);
      });
      r.addEventListener("mouseenter", () => { if (r.dataset.rank) hover(+r.dataset.rank); });
      r.addEventListener("mouseleave", () => hover(null));
    });
  }

  // Aspect rose: 8 sectors sized by the number of matching very-high areas; click to filter.
  function renderRose() {
    const el = $("#hk-rose"); if (!el) return;
    const base = st.hotspots.filter(f => f.properties.area_ha >= st.minHa && (!st.tile || f.properties.tile_id === st.tile));
    const n = Object.fromEntries(ASPECTS.map(a => [a, 0]));
    base.forEach(f => { n[f.properties.facing] = (n[f.properties.facing] || 0) + 1; });
    const max = Math.max(1, ...Object.values(n)), cx = 90, cy = 90, R = 70;
    const pt = (ang, r) => [cx + r * Math.sin(ang), cy - r * Math.cos(ang)];
    const sectors = ASPECTS.map((a, i) => {
      const r = 14 + (R - 14) * Math.sqrt(n[a] / max), a0 = (i * 45 - 21) * Math.PI / 180, a1 = (i * 45 + 21) * Math.PI / 180;
      const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r), [lx, ly] = pt(i * 45 * Math.PI / 180, R + 12);
      const on = !st.facing.size || st.facing.has(a);
      return `<g class="hk-sec ${st.facing.has(a) ? "pick" : ""}" data-a="${a}"><title>${a}: ${fmt(n[a])} areas</title>
        <path d="M${cx},${cy} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z" fill="${on ? ramp(n[a] / max) : "#3b4b63"}" fill-opacity="${on ? 0.92 : 0.5}" stroke="#08111f" stroke-width="0.8"/>
        <text x="${lx}" y="${ly + 4}" text-anchor="middle">${a}</text></g>`;
    }).join("");
    el.innerHTML = `<svg viewBox="0 0 180 180" role="img" aria-label="Aspect rose of very-high areas">
      ${[0.33, 0.66, 1].map(k => `<circle cx="${cx}" cy="${cy}" r="${14 + (R - 14) * k}" fill="none" stroke="#29446a" stroke-dasharray="2 3"/>`).join("")}${sectors}</svg>
      <div class="hk-rose-n">${st.facing.size ? `Filter: <b>${[...st.facing].join(", ")}</b> <button type="button" id="hk-rose-clear">clear</button>` : "Click sectors to filter by aspect"}</div>`;
    el.querySelectorAll(".hk-sec").forEach(g => g.addEventListener("click", () => {
      const a = g.dataset.a; st.facing.has(a) ? st.facing.delete(a) : st.facing.add(a); stopTour(); refreshData();
    }));
    const c = el.querySelector("#hk-rose-clear"); if (c) c.onclick = () => { st.facing.clear(); refreshData(); };
  }

  function renderExports() {
    const el = $("#hk-exports"); if (!el) return;
    const q = filterQs();
    el.innerHTML = `<a class="btn" href="/api/export/hk_hotspots.csv${q}">⇩ CSV (filtered)</a><a class="btn" href="/api/export/hk_hotspots.geojson${q}">⇩ GeoJSON</a>`;
  }

  // ------------------------------------------------------------ charts
  function renderElev() {
    const el = $("#hk-elev"); if (!el) return;
    const list = filtered(), bins = {};
    list.forEach(f => { const b = Math.floor(f.properties.mean_elev_m / 250) * 250; bins[b] = (bins[b] || 0) + f.properties.area_ha / 100; });
    const keys = Object.keys(bins).map(Number).sort((a, b) => a - b);
    if (!keys.length) { el.innerHTML = UI.empty("No areas match the filters"); return; }
    const lo = keys[0], hi = keys[keys.length - 1], all = [];
    for (let k = lo; k <= hi; k += 250) all.push(k);
    const max = Math.max(...all.map(k => bins[k] || 0)), W = 520, H = 170, bw = W / all.length;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H + 26}" class="hk-hist">${all.map((k, i) => {
      const h = ((bins[k] || 0) / max) * H, t = k < 2500 ? 0.3 : k < 3500 ? 0.6 : k < 4500 ? 0.85 : 1;
      return `<rect x="${i * bw + 1}" y="${H - h}" width="${bw - 2}" height="${h}" rx="2" fill="${t < 0.5 ? "#fd8d3c" : t < 0.8 ? "#e31a1c" : t < 0.95 ? "#bd0026" : "#800026"}"><title>${k}–${k + 250} m: ${fmt(bins[k] || 0, 1)} km²</title></rect>
        ${i % 4 === 0 ? `<text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle">${(k / 1000).toFixed(k % 1000 ? 2 : 0)} km</text>` : ""}`;
    }).join("")}</svg>
    <p class="muted hk-cap">Very-high area (km²) by mean elevation of each area, 250 m bins, current filters. Hover a bar for values.</p>`;
  }

  function curve(xs, ys, xmax, unit, color) {
    const W = 260, H = 96, px = x => (Math.min(x, xmax) / xmax) * W, py = y => H - y * H;
    const pts = xs.map((x, i) => [x, ys[i]]).filter(([x]) => x <= xmax);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(" ");
    return `<svg viewBox="-6 -6 ${W + 12} ${H + 28}" class="hk-curve">
      <path d="M0,${H} H${W}" stroke="#29446a"/><path d="${d} L${W},${py(pts[pts.length - 1][1])}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>
      ${pts.map(([x, y]) => `<circle cx="${px(x)}" cy="${py(y)}" r="2.6" fill="${color}"><title>${x}${unit} → ${y}</title></circle>`).join("")}
      ${[0, 0.25, 0.5, 0.75, 1].map(k => `<text x="${k * W}" y="${H + 16}" text-anchor="${k === 0 ? "start" : k === 1 ? "end" : "middle"}">${Math.round(k * xmax).toLocaleString("en-GB")}${unit}</text>`).join("")}</svg>`;
  }

  function methodCard(run) {
    const s = run.settings || {};
    return `<div class="card hk-method"><h3>Method &amp; thresholds <span class="tag info">From settings_used.json</span></h3>
      <p class="muted" style="margin-top:0">${UI.esc(run.method)} Release areas must be about 1 ha or more; Very-high areas listed here are ≥ ${fmt(run.hotspot_min_ha)} ha.</p>
      <div class="grid g3">
        <div><div class="k-label">Slope factor</div>${s.slope_x ? curve(s.slope_x, s.slope_y, 70, "°", "#fd8d3c") : "—"}<p class="hk-cap muted">Peaks at 35–40°.</p></div>
        <div><div class="k-label">Elevation factor</div>${s.elev_x ? curve(s.elev_x, s.elev_y, 7000, " m", "#e31a1c") : "—"}<p class="hk-cap muted">Zero below ${fmt(s.min_snow_elev)} m (winter snow line).</p></div>
        <div><div class="k-label">Aspect factor</div>${s.aspect_score ? `<div class="hk-asp">${ASPECTS.map((a, i) => `<span><b>${a}</b><i style="height:${s.aspect_score[i] * 56}px"></i><small>${s.aspect_score[i]}</small></span>`).join("")}</div>` : "—"}
          <p class="hk-cap muted">Concave ${s.concave_score ?? "—"} · convex ${s.convex_score ?? "—"} (shape factor).</p></div>
      </div>
      ${UI.dl([["Classes", run.classes.filter(c => c.range).map(c => `<span class="hk-sw" style="background:${c.color}"></span>${UI.esc(c.label)} <span class="muted mono">${UI.esc(c.range)}</span>`).join("<br>")],
        ["Inputs", UI.esc(run.inputs)], ["Not included", UI.esc(run.not_included)], ["Validation", `<span class="tag warn">Not validated</span> ${UI.esc(run.validation)}`],
        ["Run", `<span class="mono">${UI.esc(run.run_id)}</span> · generated ${UI.esc(run.generated || "—")}`]])}
    </div>`;
  }

  function figures() {
    const figs = [["risk_map", "Avalanche terrain map with top 10"], ["top10_table", "Top 10 hotspots table"], ["top4_zoom", "Four largest areas, close-up"], ["risk_charts", "Area by class and top tiles"]];
    return `<div class="card"><h3>Run figures <span class="tag">As delivered by the analysis run</span></h3><div class="hk-figs">${figs.map(([f, t]) =>
      `<button type="button" class="hk-fig" data-src="/static/img/hindukush/${f}.jpg" data-t="${t}"><img src="/static/img/hindukush/${f}.jpg" alt="${t}" loading="lazy"><span>${t}</span></button>`).join("")}</div></div>`;
  }
  function lightbox(src, title) {
    const d = document.createElement("div");
    d.className = "hk-lb"; d.innerHTML = `<figure><img src="${src}" alt="${UI.esc(title)}"><figcaption>${UI.esc(title)} <span class="muted">· click or Esc to close</span></figcaption></figure>`;
    const close = () => { d.remove(); document.removeEventListener("keydown", esc); };
    const esc = e => { if (e.key === "Escape") close(); };
    d.addEventListener("click", close); document.addEventListener("keydown", esc);
    document.body.appendChild(d);
  }

  // ------------------------------------------------------------ page
  async function render(el) {
    dispose();
    const head = (actions = "") => `<div class="page-h"><div><div class="eyebrow">Hindu Kush · Avalanche terrain screening</div>
      <h2>Where the terrain can release avalanches</h2>
      <p>Every 30 m slope in the Hindu Kush study area scored from its steepness, elevation, aspect and shape, on winter-snow and glacier ground only. Red areas are where to look first: permanent terrain factors, <b>not a forecast</b>.</p></div>
      <div class="toolbar" style="margin:0">${actions}</div></div>`;
    el.innerHTML = head() + UI.loading("Loading Hindu Kush screening run…");
    const run = await UI.api("screening/hindukush");
    if (!run.available) {
      el.innerHTML = head() + UI.empty("No screening run imported", `<p>${UI.esc(run.message)}</p>`);
      return;
    }
    const [hs, tiles, set] = await Promise.all([UI.api("layer/hk_hotspots"), UI.api("layer/hk_tiles"), UI.api("settlements").catch(() => ({ features: [] }))]);
    st.run = run; st.hotspots = hs.features; st.tiles = tiles.features;
    st.allSettlements = set.features;
    st.settlements = set.features.filter(f => { const [x, y] = f.geometry.coordinates; return x >= 71.05 && x <= 74.23 && y >= 34.72 && y <= 37.3; });
    if (!document.body.contains(el)) return;

    const ca = run.class_area_km2, tot = Object.values(ca).reduce((a, b) => a + b, 0);
    const tileRank = st.tiles.slice().sort((a, b) => b.properties.share_high_or_very_high - a.properties.share_high_or_very_high);
    el.innerHTML = `<div class="hk-bar"><div class="hk-bar-t"><span class="eyebrow">Hindu Kush</span><b>Avalanche terrain screening</b>
        <span class="tag hk-tag" title="Screening layer, not a forecast or warning. It shows where slopes can release, from terrain that does not change; it says nothing about current snowpack or timing. The score is an index (0-1), not a probability, and has not been validated against observed avalanches. Locations need field verification.">Screening · not a forecast</span></div>
        <div class="hk-dock" role="toolbar" aria-label="Map layers">
          <span class="hk-dock-h">Layers</span>
          <label class="hk-chip c-cls" title="Terrain class overlay from the screening run"><input type="checkbox" id="hk-l-ov" ${st.overlay ? "checked" : ""} ${run.overlay && run.overlay.available ? "" : "disabled"}><i class="hk-li li-cls"></i><span>Terrain classes</span>
            <input type="range" class="hk-chip-op" id="hk-op" min="0.1" max="1" step="0.05" value="${st.overlayOp}" aria-label="Class layer opacity" title="Opacity"></label>
          <label class="hk-chip c-heat" title="Hotspot density (heat map)"><input type="checkbox" id="hk-l-heat" ${st.showHeat ? "checked" : ""}><i class="hk-li li-heat"></i><span>Density</span></label>
          <label class="hk-chip c-pts" title="Very-high areas, sized by hectares"><input type="checkbox" id="hk-l-pts" ${st.showPts ? "checked" : ""}><i class="hk-li li-pts"></i><span>Very-high</span></label>
          <label class="hk-chip c-tiles" title="Analysis tile summary"><input type="checkbox" id="hk-l-tiles" ${st.showTiles ? "checked" : ""}><i class="hk-li li-tiles"></i><span>Tiles</span></label>
          <label class="hk-chip c-set" title="Settlements (approximate town centres)"><input type="checkbox" id="hk-l-set" ${st.showSet ? "checked" : ""}><i class="hk-li li-set"></i><span>Settlements</span></label>
          <span class="hk-dock-sep"></span>
          <div class="hk-seg"><button type="button" data-b="sat" class="${st.base === "sat" ? "on" : ""}">Satellite</button><button type="button" data-b="dark" class="${st.base === "dark" ? "on" : ""}">Dark</button></div>
          <button type="button" class="hk-3d ${st.terrain ? "on" : ""}" id="hk-3d" title="Toggle 3D terrain"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 20 9 7l4 7 3-4 6 10z"/></svg>3D</button>
          <button type="button" class="hk-reset" id="hk-reset" title="Reset view" aria-label="Reset view"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg></button>
          <span class="hk-dock-sep"></span>
          <button class="btn primary hk-tourbtn" type="button" id="hk-tour">${UI.ICON.play} Tour top 10</button>
        </div></div>
      <div class="hk-stage no-kpi hk-docked">
        <div class="hk-mapwrap">
          <div id="hk-map" class="hk-map"></div>
          <div class="hk-legend">
            <div class="hk-ctl-h">Terrain class</div>
            ${run.classes.filter(c => c.in_overlay !== false).map(c => `<div><span class="hk-sw" style="background:${c.color}"></span>${UI.esc(c.label)}</div>`).join("")}
            <div class="hk-lg2"><span class="hk-dot"></span>Very-high area (size = ha)</div>
            <div class="hk-lg2"><span class="hk-badge mini top">1</span><span class="hk-badge mini">11</span>Rank by area</div>
            <div class="hk-lg2"><span class="hk-line"></span>Pakistan / province boundary</div>
          </div>
          <div class="hk-coord mono" id="hk-coord">Move over the map · scroll to zoom · right-drag to tilt</div>
          <aside class="map-detail hk-detail" id="hk-detail" hidden></aside>
        </div>

        <aside class="hk-side">
          <h3><span id="hk-side-t">Hotspots: where to look first</span> <span class="tag warn">Verify in field</span></h3>
          <div class="hk-filters">
            <div id="hk-rose" class="hk-rose"></div>
            <div class="hk-fctl">
              <label>Minimum area <b id="hk-minv">${st.minHa} ha</b><input type="range" id="hk-min" min="5" max="200" step="5" value="${st.minHa}"></label>
              <label>Tile <select id="hk-tile"><option value="">All ${st.tiles.length} tiles</option>${st.tiles.map(t => t.properties.tile_id).sort().map(t => `<option ${t === st.tile ? "selected" : ""}>${t}</option>`).join("")}</select></label>
              <label>Show <select id="hk-n">${[10, 25, 50, 100].map(n => `<option value="${n}" ${n === st.listN ? "selected" : ""}>Top ${n}</option>`).join("")}</select></label>
            </div>
          </div>
          <div class="hk-count muted" id="hk-count"></div>
          <div class="hk-list" id="hk-list"></div>
          <div class="hk-exp" id="hk-exports"></div>
        </aside>
      </div>

      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>Area by terrain class <span class="tag">All ${fmt(run.tiles)} tiles</span></h3>
          <div class="bars hk-cbars">${run.classes.filter(c => ca[c.id] != null).map(c => `<div class="bar"><span><span class="hk-sw" style="background:${c.color}"></span>${UI.esc(c.label)}</span>
            <span class="track"><span class="fill" style="width:${ca[c.id] / Math.max(...Object.values(ca)) * 100}%;background:${c.color}"></span></span><span class="v">${fmt(ca[c.id])} km²</span></div>`).join("")}</div>
          <div class="k-label hk-sh-l">Share of classified ground</div>
          <div class="hk-stack hk-share">${run.classes.filter(c => ca[c.id]).map(c => `<i style="flex:${ca[c.id]};background:${c.color}" title="${UI.esc(c.label)}: ${(ca[c.id] / tot * 100).toFixed(1)}%"><span>${ca[c.id] / tot >= 0.08 ? (ca[c.id] / tot * 100).toFixed(0) + "%" : ""}</span></i>`).join("")}</div>
          <p class="muted hk-cap">Computed from the per-tile class shares of the run (${fmt(tot)} km² classified). Ground that is not winter avalanche terrain is not counted.</p></div>
        <div class="card"><h3>Tiles with most High + Very-high ground <span class="tag info">Click to inspect</span></h3>
          <div class="bars hk-tbars">${tileRank.slice(0, 10).map(t => { const p = t.properties; return `<button type="button" class="bar" data-tile="${p.tile_id}"><span class="mono">${p.tile_id}</span>
            <span class="track"><span class="fill" style="width:${p.share_high_or_very_high / tileRank[0].properties.share_high_or_very_high * 100}%;background:linear-gradient(90deg,#fd8d3c,#bd0026)"></span></span><span class="v">${(p.share_high_or_very_high * 100).toFixed(0)}%</span></button>`; }).join("")}</div>
          <p class="muted hk-cap">Share of each tile's area classed High or Very high.</p></div>
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>Elevation of very-high areas <span class="tag">Follows filters</span></h3><div id="hk-elev"></div></div>
        ${figures()}
      </div>
      <div style="margin-top:14px">${methodCard(run)}</div>
      <p class="muted hk-cap" style="margin-top:10px">Map engine: <span id="hk-engine">loading…</span>. Class layer: ${UI.esc((run.overlay || {}).note || "not available")}
        Boundaries: Natural Earth (Pakistan view). Source: ${UI.esc((run.datasets[0] || {}).source || "")}.</p>`;

    wire(el);
    renderList(); renderRose(); renderElev(); renderExports();
    initMap(el.querySelector("#hk-map")).catch(e => console.error(e));
    if (window.HKF) HKF.toggle(el, true).catch(e => console.error(e));
  }

  function wire(el) {
    const on = (id, ev, fn) => { const n = el.querySelector(id); if (n) n.addEventListener(ev, fn); };
    on("#hk-l-ov", "change", e => { st.overlay = e.target.checked; applyLayers(); });
    on("#hk-op", "input", e => { st.overlayOp = +e.target.value; applyLayers(); });
    on("#hk-l-heat", "change", e => { st.showHeat = e.target.checked; applyLayers(); });
    on("#hk-l-pts", "change", e => { st.showPts = e.target.checked; applyLayers(); });
    on("#hk-l-tiles", "change", e => { st.showTiles = e.target.checked; applyLayers(); });
    on("#hk-l-set", "change", e => { st.showSet = e.target.checked; applyLayers(); });
    el.querySelectorAll(".hk-seg button").forEach(b => b.addEventListener("click", () => {
      st.base = b.dataset.b; el.querySelectorAll(".hk-seg button").forEach(x => x.classList.toggle("on", x === b)); applyLayers();
    }));
    on("#hk-3d", "click", e => { st.terrain = !st.terrain; e.currentTarget.classList.toggle("on", st.terrain); applyLayers(); });
    on("#hk-reset", "click", () => { stopTour(); if (st.ready) st.map.fitBounds(HK_BOUNDS, { padding: padMap(), pitch: st.terrain ? 45 : 0, bearing: 0, duration: 1400 }); });
    on("#hk-tour", "click", () => st.tour ? stopTour() : startTour());
    on("#hk-min", "input", e => { st.minHa = +e.target.value; el.querySelector("#hk-minv").textContent = st.minHa + " ha"; });
    on("#hk-min", "change", () => { stopTour(); refreshData(); });
    on("#hk-tile", "change", e => e.target.value ? showTile(e.target.value) : clearTile());
    on("#hk-n", "change", e => { st.listN = +e.target.value; refreshMarkers(); renderList(); });
    el.querySelectorAll(".hk-tbars .bar").forEach(b => b.addEventListener("click", () => {
      showTile(b.dataset.tile); el.querySelector(".hk-stage").scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    el.querySelectorAll(".hk-fig").forEach(b => b.addEventListener("click", () => lightbox(b.dataset.src, b.dataset.t)));
  }

  function dispose() {
    stopTour();
    if (window.HKF) HKF.off(true);
    st.markers.forEach(m => m.remove()); st.markers = [];
    if (st.map) { try { st.map.remove(); } catch { /* already detached */ } }
    st.map = null; st.ready = false; st.sel = null;
  }

  return { engine, style, IC, render, dispose, apply: applyLayers, state: st, filtered, renderList, select, nearText, nearestTown };
})();
window.HK = HK;
Views.hindukush = HK.render;
