/* Snow and ice on the upper mountain of each avalanche in the Historical Overview tour (static/js/histtour.js): SnowCap.local(map, anim).
   ILLUSTRATION from the portal's own DEM (/api/dem, Copernicus GLO-30), not observed snow: the satellite scenes are mostly
   snow-free, but an avalanche needs snow in its start zone. Rules, as in nature and in real winter imagery:
   - only on the upper mountain: a natural, irregular snowline ~450 m below the release (lower on shaded north faces), never
     in the valley: at least 350-650 m above where the avalanche stops, so rivers, forest belts and towns stay the real imagery;
   - solid where it lies (no forest showing through), so the contrast with the green forest below is crisp;
   - the steepest rock faces (> ~45 deg) stay bare; colour = the neutral white of the imagery's own snow, shaded by the sun;
   - the image fades out towards its edges: no visible boundary.
   Drawn into an image source draped on the terrain (Mapbox and MapLibre). */
"use strict";

window.SnowCap = (() => {
  const D2R = Math.PI / 180, R = 6378137;
  const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  const tiles = new Map();
  function tile(z, x, y) {
    const k = `${z}/${x}/${y}`;
    if (!tiles.has(k)) tiles.set(k, fetch(`/api/dem/${k}.png?v=cop1`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(b => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
      .then(img => {
        const c = document.createElement("canvas"); c.width = c.height = 256;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
        for (let i = 0; i < 65536; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        return h;
      })
      .catch(() => null));
    return tiles.get(k);
  }
  const tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
  const ty = (lat, z) => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * 2 ** z;
  const lon = (x, z) => x / 2 ** z * 360 - 180;
  const lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) / D2R;

  // value noise on a fixed world grid (zoom-12 pixels), for a natural, irregular snowline
  const hash = (ix, iy) => { let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vn = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1); return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy; };
  const fbm = (x, y) => vn(x, y) * 0.5 + vn(x * 2.03 + 17, y * 2.03) * 0.3 + vn(x * 4.1, y * 4.1 + 31) * 0.2;

  async function render(x0, y0, nx, ny, line, floor) {
    const z = 12, up = 2, W0 = nx * 256, H0 = ny * 256, H = new Float32Array(W0 * H0).fill(NaN);
    const got = await Promise.all(Array.from({ length: nx * ny }, (_, i) => tile(z, x0 + i % nx, y0 + (i / nx | 0))));
    if (!got.some(Boolean)) return null;
    got.forEach((t, i) => { if (!t) return; const ox = (i % nx) * 256, oy = (i / nx | 0) * 256;
      for (let r = 0; r < 256; r++) H.set(t.subarray(r * 256, r * 256 + 256), (oy + r) * W0 + ox); });
    const m = 2 * Math.PI * R * Math.cos(lat(y0 + ny / 2, z) * D2R) / (256 * 2 ** z);
    const at = (x, y) => H[Math.min(H0 - 1, Math.max(0, y)) * W0 + Math.min(W0 - 1, Math.max(0, x))];
    const GX = new Float32Array(W0 * H0), GY = new Float32Array(W0 * H0);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
      GX[y * W0 + x] = (at(x + 1, y) - at(x - 1, y)) / (2 * m); GY[y * W0 + x] = (at(x, y + 1) - at(x, y - 1)) / (2 * m);
    }
    const saz = 150 * D2R, sel = 32 * D2R, sx = Math.sin(saz) * Math.cos(sel), sn = Math.cos(saz) * Math.cos(sel), sz = Math.sin(sel);
    const Wo = W0 * up, Ho = H0 * up, cv = document.createElement("canvas"); cv.width = Wo; cv.height = Ho;
    const g = cv.getContext("2d"), img = g.createImageData(Wo, Ho), D = img.data, feather = 0.18 * Math.min(Wo, Ho);
    for (let oy = 0; oy < Ho; oy++) {
      const py = (oy + 0.5) / up - 0.5, y = Math.max(0, Math.min(H0 - 2, Math.floor(py))), fy = Math.min(1, Math.max(0, py - y));
      for (let ox = 0; ox < Wo; ox++) {
        const edge = Math.min(ox, Wo - 1 - ox, oy, Ho - 1 - oy) / feather; if (edge <= 0) continue;
        const px = (ox + 0.5) / up - 0.5, x = Math.max(0, Math.min(W0 - 2, Math.floor(px))), fx = Math.min(1, Math.max(0, px - x)), i = y * W0 + x;
        const bl = A => (A[i] * (1 - fx) + A[i + 1] * fx) * (1 - fy) + (A[i + W0] * (1 - fx) + A[i + W0 + 1] * fx) * fy;
        const h = bl(H); if (!(h > -500)) continue;
        if (h < floor + 300 || h < line - 420) continue;                                       // valleys and settlements: never
        const gx = bl(GX), gy = bl(GY), gm = Math.hypot(gx, gy), slope = Math.atan(gm) / D2R;
        const north = gm > 1e-4 ? gy / gm : 0;                                                  // +1 = faces north: shaded, snow lies lower
        const wx = x0 * 256 + px, wy = y0 * 256 + py;
        const n1 = fbm(wx / 40, wy / 40), n2 = vn(wx / 4, wy / 4), n3 = vn(wx / 1.3, wy / 1.3);
        const e = h + north * 160 * Math.min(1, slope / 20) + (n1 - 0.5) * 240 + (n2 - 0.5) * 70 + (n3 - 0.5) * 40;
        let cover = smooth(line - 110, line + 30, e) * smooth(floor + 350, floor + 650, h);     // a ragged, fairly sharp snowline
        cover *= 1 - 0.92 * smooth(44, 58, slope + (n2 - 0.5) * 16);                            // bare rock on the steepest faces
        cover *= smooth(0, 1, edge);                                                             // fades out towards the image edge
        if (cover < 0.02) continue;
        const nl = Math.hypot(gx, gy, 1), lam = Math.max(0, (-gx * sx + gy * sn + sz) / nl);
        // surface texture (wind crust, sastrugi, sun cups): slight brightness variation, as snow shows in imagery
        const k = Math.min(1, Math.max(0, 0.3 + 0.85 * lam + (n3 - 0.5) * 0.12 + (n2 - 0.5) * 0.08)), o = (oy * Wo + ox) * 4;
        // the imagery's own snow: neutral white in sun, grey-blue in shade
        D[o] = 150 + 98 * k; D[o + 1] = 157 + 91 * k; D[o + 2] = 168 + 77 * k; D[o + 3] = 250 * cover;
      }
    }
    g.putImageData(img, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    return { url: URL.createObjectURL(blob),
      coordinates: [[lon(x0, z), lat(y0, z)], [lon(x0 + nx, z), lat(y0, z)], [lon(x0 + nx, z), lat(y0 + ny, z)], [lon(x0, z), lat(y0 + ny, z)]] };
  }

  let tok = 0, url = null;
  const status = {};          // read-only diagnostics for headless checks
  // anim: the event's `anim` (path [lon, lat, elev, t, v], release.z)
  async function local(map, anim, before) {
    const my = ++tok, z = 12, pad = 0.045, path = anim.path;
    const relZ = (anim.release && anim.release.z) || path[0][2], floor = Math.min(...path.map(p => p[2]));
    const line = relZ - 450;                                                  // the start zone and the mountain above it are snow
    const lons = path.map(p => p[0]), lats = path.map(p => p[1]);
    const x0 = Math.floor(tx(Math.min(...lons) - pad * 1.25, z)), x1 = Math.floor(tx(Math.max(...lons) + pad * 1.25, z));
    const y0 = Math.floor(ty(Math.max(...lats) + pad, z)), y1 = Math.floor(ty(Math.min(...lats) - pad, z));
    const nx = Math.min(6, x1 - x0 + 1), ny = Math.min(6, y1 - y0 + 1);
    const im = await render(x0, y0, nx, ny, line, floor);
    if (my !== tok || !im || !map.getStyle()) { if (im) URL.revokeObjectURL(im.url); return; }
    if (map.getLayer("snowcap")) map.removeLayer("snowcap");
    if (map.getSource("snowcap")) map.removeSource("snowcap");
    if (url) URL.revokeObjectURL(url);
    url = im.url;
    map.addSource("snowcap", { type: "image", url: im.url, coordinates: im.coordinates });
    map.addLayer({ id: "snowcap", type: "raster", source: "snowcap", paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" } },
      before && map.getLayer(before) ? before : undefined);
    Object.assign(status, { line: Math.round(line), floor: Math.round(floor), tiles: nx * ny, ok: !!map.getLayer("snowcap") });
  }
  return { local, status };
})();
