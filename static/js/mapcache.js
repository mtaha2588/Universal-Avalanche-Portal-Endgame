/* Map speed: registers the tile-cache service worker (/sw.js) and holds the shared map options.
   Loaded by home.html and portal.html before any map script. See static/sw.js for what is cached and for how long. */
"use strict";

const MapPerf = (() => {
  // Open connections to the tile hosts early, before the map library asks for its first tile.
  ["https://api.mapbox.com", "https://server.arcgisonline.com", "https://s3.amazonaws.com"].forEach(href => {
    const l = document.createElement("link"); l.rel = "preconnect"; l.href = href; l.crossOrigin = "anonymous";
    document.head.appendChild(l);
  });

  const ready = ("serviceWorker" in navigator && location.protocol !== "file:")
    ? navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(e => { console.warn("map cache unavailable:", e.message); return null; })
    : Promise.resolve(null);

  // Engine-wide settings, applied once per library before its first map.
  const tuned = new WeakSet();
  function tune(gl) {
    if (!gl || tuned.has(gl)) return;
    tuned.add(gl);
    const workers = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    try {
      if (typeof gl.setWorkerCount === "function") gl.setWorkerCount(workers); else gl.workerCount = workers;
      if (typeof gl.setMaxParallelImageRequests === "function") gl.setMaxParallelImageRequests(24); else gl.maxParallelImageRequests = 24;
      if (typeof gl.prewarm === "function") gl.prewarm();     // start the web workers now, not on the first map
    } catch (e) { console.warn("map tuning skipped:", e.message); }
  }

  // Per-map options: keep many decoded tiles in memory (panning back is instant), do not re-request tiles that expire
  // mid-session, cap the drawing resolution, draw CJK labels with a local font instead of downloading glyph ranges, skip performance telemetry.
  const opts = extra => Object.assign({
    maxTileCacheSize: 1500,
    refreshExpiredTiles: false,
    localIdeographFontFamily: "'Noto Sans', 'Microsoft YaHei', sans-serif",
    performanceMetricsCollection: false,
    fadeDuration: 120,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),   // 4K / 200 % screens would otherwise draw 4x the pixels
  }, extra);

  // Terrain elevation for every 3D map: open AWS Terrain Tiles (terrarium), served by the portal itself from data/dem
  // (scripts/fetch_dem.py) with a one-year browser cache; tiles not on disk are redirected to the public copy (app.py).
  // Not Mapbox's DEM: Mapbox's terms forbid storing their tiles, these may be kept.
  const dem = () => ({ type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12,   // z12 is the last local level; deeper zooms overzoom it, so the ground never switches data source (that made it jump)
    tiles: [location.origin + "/api/dem/{z}/{x}/{y}.png?v=cop1"], attribution: "Elevation: Copernicus DEM GLO-30 (c) DLR e.V. / Airbus, provided under COPERNICUS by the EU and ESA; Terrain Tiles (AWS Open Data; SRTM) for the country view" });

  // Cache statistics / clearing, answered by the service worker.
  async function ask(msg) {
    const reg = await ready, sw = reg && (reg.active || navigator.serviceWorker.controller);
    if (!sw) return null;
    return new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = e => res(e.data); sw.postMessage(msg, [ch.port2]); setTimeout(() => res(null), 4000); });
  }
  async function stats() {
    const counts = await ask("stats");
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    return counts && { counts, usageMB: est ? est.usage / 1048576 : null };
  }
  const clear = () => ask("clear");

  return { tune, opts, ready, stats, clear, dem };
})();
window.MapPerf = MapPerf;
