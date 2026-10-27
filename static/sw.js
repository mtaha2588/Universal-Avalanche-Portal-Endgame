/* Map cache service worker (served at /sw.js, scope /).

   Keeps map tiles and map libraries in Cache Storage so a tile already seen is drawn from disk instead of the network.
   - Mapbox, Esri, CARTO tiles / styles / glyphs: kept only as long as the provider's own Cache-Control max-age allows
     (Mapbox 12 h, Esri 24 h). Their terms allow caching within those headers, not permanent storage or bulk download.
   - AWS Terrain Tiles (open data), including the portal's own copy at /api/dem/, and the MapLibre demo glyphs: kept for 30 days.
   - Versioned map libraries (mapbox-gl-js vX.Y.Z) and /static/vendor: cache-first.
   - The portal's own pages, JS, CSS and /api data (except /api/dem terrain tiles) are NOT cached here, so edits and data rebuilds always show. */
"use strict";

const VER = "v2";
const TILES = `map-tiles-${VER}`;       // provider tiles, expiry from their headers
const OPEN = `map-open-${VER}`;         // open-data tiles, 30 days
const LIB = `map-lib-${VER}`;           // versioned libraries and static vendor files
const KEEP = [TILES, OPEN, LIB];
const MAX = { [TILES]: 9000, [OPEN]: 15000, [LIB]: 400 };
const OPEN_TTL = 30 * 24 * 3600;
const STAMP = "sw-fetched";             // header added to stored copies: seconds since epoch at fetch time

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("map-") && !KEEP.includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

function route(url) {
  const h = url.hostname, p = url.pathname;
  if (h === "api.mapbox.com" && p.startsWith("/mapbox-gl-js/v")) return LIB;
  if (h === "api.mapbox.com" || h.endsWith(".tiles.mapbox.com") || h === "server.arcgisonline.com" || h.endsWith(".basemaps.cartocdn.com")) {
    if (p.startsWith("/events") || p.startsWith("/map-sessions")) return null;   // telemetry / billing calls: never touch
    return TILES;
  }
  if (h === "s3.amazonaws.com" && p.startsWith("/elevation-tiles-prod/")) return OPEN;
  if (h === "demotiles.maplibre.org") return OPEN;
  if (url.origin === self.location.origin && p.startsWith("/static/vendor/")) return LIB;
  if (url.origin === self.location.origin && p.startsWith("/api/dem/")) return OPEN;   // open terrain tiles, never change
  return null;
}

// Cache key: Mapbox adds a per-session `sku` billing parameter to tile URLs; leaving it in would make every session miss.
function keyOf(url) {
  const u = new URL(url);
  u.searchParams.delete("sku");
  return u.toString();
}

function maxAge(res) {
  const cc = res.headers.get("Cache-Control") || "";
  if (/no-store|private/i.test(cc)) return 0;
  const m = /max-age=(\d+)/i.exec(cc);
  return m ? +m[1] : 0;
}

async function store(cacheName, key, res) {
  const ttl = cacheName === TILES ? maxAge(res) : cacheName === OPEN ? OPEN_TTL : 365 * 24 * 3600;
  if (!ttl) return;
  const headers = new Headers(res.headers);
  headers.set(STAMP, String(Math.floor(Date.now() / 1000)));
  headers.set("sw-ttl", String(ttl));
  const body = await res.blob();
  const cache = await caches.open(cacheName);
  await cache.put(key, new Response(body, { status: res.status, statusText: res.statusText, headers }));
  trim(cacheName);
}

const fresh = r => {
  const t = +r.headers.get(STAMP), ttl = +r.headers.get("sw-ttl");
  return t && ttl && Date.now() / 1000 - t < ttl;
};

let trimming = {};
async function trim(name) {
  if (trimming[name]) return;
  trimming[name] = true;
  try {
    const cache = await caches.open(name), keys = await cache.keys();
    const over = keys.length - MAX[name];
    if (over > 0) for (const k of keys.slice(0, over + Math.floor(MAX[name] * 0.1))) await cache.delete(k);   // oldest first
  } finally { trimming[name] = false; }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  const name = route(url);
  if (!name) return;
  const key = keyOf(req.url);
  let saved = null;
  const done = new Promise(res => { saved = res; });
  e.waitUntil(done);                    // keep the worker alive until the copy is stored
  e.respondWith((async () => {
    // A cache problem (quota, private window, storage disabled) must never cost the user the tile: fall back to the network.
    let hit = null;
    try { hit = await (await caches.open(name)).match(key); } catch { /* no cache: network only */ }
    if (hit && fresh(hit)) { saved(); return hit; }
    try {
      // <script>/<link> tags ask in no-cors mode, which gives an unreadable (opaque) answer; these hosts send
      // Access-Control-Allow-Origin: *, so ask in cors mode to be able to read the headers and keep a copy.
      const res = await (req.mode === "no-cors" && url.origin !== self.location.origin
        ? fetch(req.url, { mode: "cors", credentials: "omit" }).catch(() => fetch(req)) : fetch(req));
      if (res.ok && res.type !== "opaque") store(name, key, res.clone()).catch(() => {}).finally(saved);
      else saved();
      return res;
    } catch (err) {
      saved();
      // Offline: only open-data and library copies may be served past their freshness; provider tiles may not.
      if (hit && name !== TILES) return hit;
      throw err;
    }
  })());
});

// Page -> worker: cache statistics and clearing (used by Settings / About).
self.addEventListener("message", e => {
  const port = e.ports && e.ports[0];
  if (!port) return;
  (async () => {
    if (e.data === "clear") { for (const k of KEEP) await caches.delete(k); port.postMessage({ ok: true }); return; }
    if (e.data === "stats") {
      const out = {};
      for (const k of KEEP) { const c = await caches.open(k), keys = await c.keys(); out[k] = keys.length; }
      port.postMessage(out);
    }
  })();
});
