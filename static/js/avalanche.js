/* Avalanche animation on the 3D maps of #hindukush and #karakoram (Avalanche.play).
   A canvas over the map draws the slab fracture at the release point, the dense flow, the powder cloud, the scoured
   track and the deposit, with a live read-out. Every point is placed with map.project(), which follows the map's own
   3D terrain, so the snow stays on the slope while the camera moves.
   Where the motion comes from:
   - "sim" (Hindu Kush hotspots): a sliding-block run with Voellmy-type friction on the portal's 30 m DEM tiles, starting
     at the hotspot. ILLUSTRATIVE: the friction values are textbook defaults, not calibrated. Not a run-out prediction.
   - "model" (Batura 1974): the NGT notebook's own path, times and speeds (avalanche_path_with_time.csv), unchanged.
   Particles, cloud, blocks and shake are visual effects around that path, not modelled quantities. */
"use strict";

const Avalanche = (() => {
  const G = 9.81, R = 6378137, Z = 12, D2R = Math.PI / 180;
  const MU = 0.2, XIH = 4000;            // Coulomb friction and Voellmy turbulence term (xi x flow height, m/s²): textbook defaults
  const J = 7;                           // mesh nodes across the path
  const PRE = 0.5, CRACK = 0.35, REL = PRE + CRACK;   // playback seconds: target lock, fracture, then the flow starts
  let slow = 1;                          // test hook: Avalanche.slowmo(8) plays 8x slower (headless screenshots)
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (n, d = 0) => n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  // Speed ratio 0..1 -> cyan, amber, rose (the read-out bar's colours).
  const heat = k => { k = clamp(k, 0, 1); const [a, b, t] = k < 0.5 ? [[34, 211, 238], [251, 191, 36], k * 2] : [[251, 191, 36], [244, 63, 94], k * 2 - 1];
    return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))]; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function rng(seed) {
    let a = (Math.abs(Math.round(seed * 9973)) + 1) >>> 0;
    return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // ------------------------------------------------------------ DEM (the same terrarium tiles the map uses)
  const tiles = new Map();
  function tile(x, y) {
    const key = x + "/" + y;
    if (!tiles.has(key)) {
      tiles.set(key, fetch(`/api/dem/${Z}/${x}/${y}.png?v=cop1`)
        .then(r => { if (!r.ok) throw new Error("DEM tile " + r.status); return r.blob(); })
        .then(b => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
        .then(img => {
          const c = document.createElement("canvas"); c.width = c.height = 256;
          const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
          for (let i = 0; i < 65536; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
          return h;
        })
        .catch(e => { tiles.delete(key); throw e; }));
    }
    return tiles.get(key);
  }
  const tx = lon => (lon + 180) / 360 * (1 << Z);
  const ty = lat => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * (1 << Z);
  // Elevation sampler (bilinear) over the 3 x 3 tiles around a point: at least ~8 km in every direction.
  async function demAround(lon, lat) {
    const cx = Math.floor(tx(lon)), cy = Math.floor(ty(lat)), got = {};
    await Promise.allSettled([-1, 0, 1].flatMap(i => [-1, 0, 1].map(j => tile(cx + i, cy + j).then(h => { got[(cx + i) + "/" + (cy + j)] = h; }))));
    if (!got[cx + "/" + cy]) throw new Error("terrain tiles unavailable");
    const at = (px, py) => { const X = Math.floor(px / 256), Y = Math.floor(py / 256), t = got[X + "/" + Y]; return t ? t[(py - Y * 256) * 256 + (px - X * 256)] : NaN; };
    return (lo, la) => {
      const px = tx(lo) * 256 - 0.5, py = ty(la) * 256 - 0.5, x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
      return lerp(lerp(at(x0, y0), at(x0 + 1, y0), fx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), fx), fy);
    };
  }
  const prefetch = (lon, lat) => { demAround(lon, lat).catch(() => {}); };

  // Local metric frame (metres east / north of an origin).
  function frameAt(lon0, lat0) {
    const kx = R * D2R * Math.cos(lat0 * D2R), ky = R * D2R;
    return { xy: (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky], ll: (x, y) => [lon0 + x / kx, lat0 + y / ky] };
  }

  // ------------------------------------------------------------ motion
  // Sliding block on the DEM: gravity along the surface, Coulomb + Voellmy friction against the motion.
  // The hotspot point is the centroid of a release area that can be a kilometre across; for a curved area it can even fall
  // on the valley floor. Try starts across the area (a circle of the area's size): prefer those at or above the area's
  // mean elevation, then the largest vertical drop.
  function simulate(h, o) {
    const grad = (x, y, e = 40) => [(h(x + e, y) - h(x - e, y)) / (2 * e), (h(x, y + e) - h(x, y - e)) / (2 * e)];
    const crown = (x, y) => {   // walk up the steep slope (> 30°) to the top of the release area, at most 300 m
      for (let d = 0; d < 300; d += 15) {
        const [gx, gy] = grad(x, y), m = Math.hypot(gx, gy);
        if (!(m > 0.58)) break;
        const nx = x + gx / m * 15, ny = y + gy / m * 15;
        if (!(h(nx, ny) > h(x, y))) break;
        x = nx; y = ny;
      }
      return [x, y];
    };
    const Ra = Math.max(150, Math.sqrt((o.areaHa || 20) * 1e4 / Math.PI)), band = o.elev ? o.elev - 250 : -Infinity;
    const starts = [crown(0, 0), [0, 0]];
    [0.35, 0.7, 1].forEach(f => { for (let a = 0; a < 8; a++) starts.push(crown(Math.cos(a * Math.PI / 4 + f) * Ra * f, Math.sin(a * Math.PI / 4 + f) * Ra * f)); });
    let out = null, best = -Infinity;
    for (const st of starts) {
      const p = slide(h, grad, ...st); if (p.length < 4) continue;
      const a = p[0], b = p[p.length - 1], score = (a.z - b.z) + (a.z >= band ? 1e5 : 0) + Math.min(b.d, 400);
      if (score > best) { out = p; best = score; }
    }
    if (!out) return null;
    // Smooth the track (the DEM gradient is noisy at 30 m).
    const k = 6;
    return out.map((p, i) => {
      if (i < 2 || i > out.length - 3) return p;
      let sx = 0, sy = 0, c = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(out.length - 1, i + k); j++) { sx += out[j].x; sy += out[j].y; c++; }
      return { ...p, x: sx / c, y: sy / c };
    });
  }
  function slide(h, grad, x, y) {
    const out = [], dt = 0.2;
    let vx = 0, vy = 0, t = 0, dist = 0;
    { const [gx, gy] = grad(x, y), m = Math.hypot(gx, gy) || 1; vx = -gx / m * 2; vy = -gy / m * 2; }   // the slab breaks loose
    for (let n = 0; n < 2400; n++) {
      const z = h(x, y); if (!isFinite(z)) break;
      const [gx, gy] = grad(x, y), m = Math.hypot(gx, gy) || 1e-6, cos = 1 / Math.sqrt(1 + m * m), sin = m * cos;
      const v = Math.hypot(vx, vy), along = v > 0.01 ? -(gx * vx + gy * vy) / v : 0;
      out.push({ x, y, z, t, d: dist, v: v * Math.sqrt(1 + along * along) });
      let ax = -gx / m * G * sin * cos, ay = -gy / m * G * sin * cos;
      if (v > 0.01) { const f = (MU * G * cos + G * v * v / (cos * cos) / XIH) * cos; ax -= vx / v * f; ay -= vy / v * f; }   // v is the map-plane speed; drag uses the speed along the slope
      const nvx = vx + ax * dt, nvy = vy + ay * dt;
      if (nvx * vx + nvy * vy <= 0 || (Math.hypot(nvx, nvy) < 0.6 && t > 4)) break;    // friction has stopped it
      vx = nvx; vy = nvy;
      const sx = vx * dt, sy = vy * dt; x += sx; y += sy; dist += Math.hypot(sx, sy); t += dt;
      if (dist > 6500 || t > 300) break;
    }
    if (out.length > 1) { const l = out[out.length - 1]; out.push({ x, y, z: h(x, y) || l.z, t: t + dt, d: dist, v: 0 }); }
    return out;
  }

  // Coarse model path -> smooth curve (Catmull-Rom on x/y, linear on elevation, time and speed).
  function catmull(p) {
    const out = [];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], d = p[Math.min(p.length - 1, i + 2)];
      for (let k = 0; k < 8; k++) {
        const t = k / 8, t2 = t * t, t3 = t2 * t, cr = (A, B, C, D) => 0.5 * (2 * B + (C - A) * t + (2 * A - 5 * B + 4 * C - D) * t2 + (3 * B - A - 3 * C + D) * t3);
        out.push({ x: cr(a.x, b.x, c.x, d.x), y: cr(a.y, b.y, c.y, d.y), z: lerp(b.z, c.z, t), t: lerp(b.t, c.t, t), v: lerp(b.v, c.v, t) });
      }
    }
    out.push({ ...p[p.length - 1] });
    return out;
  }

  // Uniform samples along the path (plus an extension past the run-out for the powder cloud), the mesh and the particles.
  function build(pts, F, o) {
    const n = pts.length, c = [0];
    for (let i = 1; i < n; i++) c[i] = c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const L = Math.max(c[n - 1], 1), ds = Math.max(10, L / 90), N = Math.floor(L / ds) + 1, EXT = Math.ceil(420 / ds), NT = N + EXT;
    const X = new Float64Array(NT), Y = new Float64Array(NT), H = new Float32Array(NT), T = new Float32Array(NT), V = new Float32Array(NT);
    let j = 0;
    const back = pts[Math.max(0, n - 1 - Math.max(2, Math.round(n / 12)))], last = pts[n - 1];
    let ex = last.x - back.x, ey = last.y - back.y; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    for (let i = 0; i < NT; i++) {
      const s = i * ds;
      if (s <= L) {
        while (j < n - 2 && c[j + 1] < s) j++;
        const f = clamp((s - c[j]) / ((c[j + 1] - c[j]) || 1), 0, 1), a = pts[j], b = pts[j + 1];
        X[i] = lerp(a.x, b.x, f); Y[i] = lerp(a.y, b.y, f); H[i] = lerp(a.z, b.z, f); T[i] = lerp(a.t, b.t, f); V[i] = lerp(a.v, b.v, f);
      } else { X[i] = last.x + ex * (s - L); Y[i] = last.y + ey * (s - L); H[i] = last.z; T[i] = last.t; V[i] = 0; }
    }
    for (let i = 1; i < NT; i++) if (T[i] < T[i - 1]) T[i] = T[i - 1];
    const Tend = T[N - 1];
    // Tangent / left normal, smoothed over ~±60 m.
    const NX = new Float64Array(NT), NY = new Float64Array(NT), w6 = Math.max(1, Math.round(60 / ds));
    for (let i = 0; i < NT; i++) {
      const a = Math.max(0, i - w6), b = Math.min(NT - 1, i + w6), dx = X[b] - X[a], dy = Y[b] - Y[a], d = Math.hypot(dx, dy) || 1;
      NX[i] = -dy / d; NY[i] = dx / d;
    }
    const w0 = o.halfWidth || 120, wt = 0.38 * w0 + 18, wf = 1.15 * w0;
    const W = s => s < 0.22 * L ? lerp(w0, wt, smooth(s / (0.22 * L))) : s < 0.78 * L ? wt
      : s <= L ? lerp(wt, wf, smooth((s - 0.78 * L) / (0.22 * L))) : wf * (1 + (s - L) / 500);
    const Umax = 1.3 * Math.max(w0, wf * 1.7);
    const MLON = new Float64Array(NT * J), MLAT = new Float64Array(NT * J);
    for (let i = 0; i < NT; i++) for (let k = 0; k < J; k++) {
      const u = (k / (J - 1) * 2 - 1) * Umax, [lo, la] = F.ll(X[i] + NX[i] * u, Y[i] + NY[i] * u);
      MLON[i * J + k] = lo; MLAT[i * J + k] = la;
    }
    let vmax = 0, svmax = 0;
    for (let i = 0; i < N; i++) if (V[i] > vmax) { vmax = V[i]; svmax = i * ds; }
    const g = { L, ds, N, NT, X, Y, H, T, V, Tend, W, w0, Umax, MLON, MLAT, vmax: Math.max(vmax, 1), svmax, F };
    // Front position at time t: invert T(s).
    g.sF = t => {
      if (t <= 0) return 0; if (t >= Tend) return L;
      let a = 0, b = N - 1;
      while (b - a > 1) { const m = (a + b) >> 1; if (T[m] < t) a = m; else b = m; }
      return (a + clamp((t - T[a]) / ((T[b] - T[a]) || 1), 0, 1)) * ds;
    };
    g.at = (A, s) => { const f = clamp(s / ds, 0, NT - 1), i = Math.min(NT - 2, f | 0); return A[i] + (A[i + 1] - A[i]) * (f - i); };
    g.ll = s => { const f = clamp(s / ds, 0, NT - 1), i = Math.min(NT - 2, f | 0), a = f - i; return F.ll(lerp(X[i], X[i + 1], a), lerp(Y[i], Y[i + 1], a)); };

    // Particles: k = 0 head ... 1 tail. Tail particles travel slower and stop higher up the track (the deposit forms along it).
    const r = rng(o.seed || 1), NC = o.path ? 1800 : 1400, P = [];
    for (let i = 0; i < NC; i++) {
      const k = 1 - i / (NC - 1), f = 1 - 0.36 * Math.pow(k, 1.25);
      const stop = k < 0.12 ? L * (1 + r() * 0.08) : L * (1 - 0.34 * Math.pow(k, 1.5) * (0.4 + 0.6 * r()));
      P.push({ k, f, stop, gk: Math.max(1, stop / L), s0: r() * 70 - 10, xi: ((r() + r() + r()) / 1.5 - 1) * (k < 0.12 ? 0.8 : 1),
        ph: r() * 6.283, r: (8 + r() * 15) * (k < 0.1 ? 1.35 : 1), zA: 2 + r() * 7, sp: (r() * 4) | 0 });
    }
    let endT = Tend;
    P.forEach(p => { endT = Math.max(endT, (Tend > 0 ? T[Math.min(N - 1, Math.round(Math.min(L, p.stop / p.gk) / ds))] : 0) / p.f); });
    g.P = P; g.endT = endT + 0.5;
    // Powder cloud puffs, born at the front in proportion to speed squared. look "real" (histtour.js): as filmed avalanches show,
    // the suspension cloud billows far higher and wider than the dense core, outruns it a little and hangs in the air long after
    // the debris has stopped, then drifts and settles.
    const RL = o.look === "real", NPF = RL ? 170 : o.path ? 420 : 280, cdf = [], steps = 240;
    let acc = 0;
    for (let i = 0; i <= steps; i++) { const t = Tend * i / steps, v = g.at(V, g.sF(t)); acc += Math.max(0, v - 6) ** 2; cdf.push(acc); }
    g.C = [];
    if (acc > 0) for (let i = 0; i < NPF; i++) {
      const q = r() * acc; let a = 0; while (a < steps && cdf[a] < q) a++;
      const tb = Tend * a / steps, sb = Math.max(0, g.sF(tb) - r() * 35), vb = g.at(V, sb);
      g.C.push({ tb, sb, vb, ub: (r() * 2 - 1) * 0.9, r0: 14 + r() * 16, adv: vb * (1.3 + r() * 1.3) * (RL ? 1.25 : 1), Hc: (10 + vb * (1.0 + r() * 1.0)) * (RL ? 1.7 : 1),
        // "real": short-lived puffs, so the cloud stays at the moving head and leaves no fog trail
        gr: (35 + vb * 1.7 + r() * 40) * (RL ? 1.25 : 1), life: ((o.path ? 2.6 : 1.4) + r() * (o.path ? 2.4 : 1.3)) * (RL ? 0.55 : 1), a: 0.13 + r() * 0.17, sp: (r() * 3) | 0 });
    }
    // Airborne spray thrown off the flanks of the head, born like the cloud (more at higher speed). Visual effect only.
    g.E = [];
    if (acc > 0) for (let i = 0, ne = o.path ? 220 : 160; i < ne; i++) {
      const q = r() * acc; let a = 0; while (a < steps && cdf[a] < q) a++;
      const tb = Tend * a / steps, sb = g.sF(tb), vb = g.at(V, sb);
      if (vb < 8) continue;
      g.E.push({ tb, sb, vb, side: r() < 0.5 ? -1 : 1, lat: 15 + vb * (1 + r() * 2), fw: vb * (0.5 + r() * 1.1),
        hp: 12 + vb * (0.6 + r() * 1.0), life: 0.7 + r() * 0.9, sz: 1 + r() * 1.8 });
    }
    // Slab blocks that break up in the first part of the run.
    g.B = Array.from({ length: 70 }, () => ({ s0: r() * 70 - 8, xi: r() * 2 - 1, k: 0.05 + r() * 0.5, size: 9 + r() * 15,
      rot: r() * 6.283, spin: (r() - 0.5) * 9, life: (0.18 + r() * 0.3) * Tend, ar: 0.5 + r() * 0.5 }));
    // Crown fracture line across the slab.
    g.K = Array.from({ length: 27 }, (_, i) => ({ u: (i / 26 * 2 - 1) * w0 * 1.05, s: -6 + r() * 9 }));
    // look "real": blocks of the deposit, densest towards the toe where the slowing slab piles up
    g.D = RL ? Array.from({ length: 220 }, () => ({ s: L * (0.72 + 0.28 * Math.pow(r(), 0.45)), xi: (r() * 2 - 1) * 0.9, size: 2.2 + r() * 4.8, rot: r() * 6.283, ar: 0.5 + r() * 0.5 })) : [];
    return g;
  }

  async function prepare(o) {
    const F = frameAt(o.lon, o.lat);
    let pts, raw = 0;
    if (o.path) {
      const xy = o.path.map(p => { const [x, y] = F.xy(p.lon, p.lat); return { x, y, z: p.elev, t: p.t, v: p.v }; });
      for (let i = 1; i < xy.length; i++) raw += Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
      pts = catmull(xy);
    }
    else { const H = await demAround(o.lon, o.lat); pts = simulate((x, y) => H(...F.ll(x, y)), o); }
    if (!pts || pts.length < 4) throw new Error("no downhill path from this point on the DEM");
    const g = build(pts, F, o);
    g.dk = raw ? raw / g.L : 1;          // read-outs use the model's own path length, not the smoothed curve's
    return g;
  }

  // ------------------------------------------------------------ sprites
  let SPR = null;
  function sprites() {
    if (SPR) return SPR;
    const r = rng(7);
    const mk = (n, draw) => { const c = document.createElement("canvas"); c.width = c.height = n; draw(c.getContext("2d"), n); return c; };
    // Lumpy snow ball lit from above: overlapping soft blobs, shaded towards the bottom.
    const lump = (n, blobs, light, shade, hard) => mk(n, (x) => {
      for (let i = 0; i < blobs; i++) {
        const a = r() * 6.283, d = r() * n * 0.2, cx = n / 2 + Math.cos(a) * d, cy = n / 2 + Math.sin(a) * d, rr = n * (0.17 + r() * 0.15);
        const gr = x.createRadialGradient(cx, cy - rr * 0.2, 0, cx, cy, rr);
        gr.addColorStop(0, light); gr.addColorStop(hard, light); gr.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.fill();
      }
      x.globalCompositeOperation = "source-atop";
      const lg = x.createLinearGradient(0, n * 0.25, 0, n); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(1, shade);
      x.fillStyle = lg; x.fillRect(0, 0, n, n);
    });
    const flow = [0, 1, 2, 3].map(() => lump(64, 9, "rgba(255,255,255,0.97)", "rgba(112,138,178,0.9)", 0.45));
    const debris = [0, 1, 2, 3].map(() => lump(64, 12, "rgba(232,239,248,0.97)", "rgba(110,128,158,0.85)", 0.62));
    const dust = [0, 1, 2].map(() => lump(128, 14, "rgba(250,252,255,0.6)", "rgba(132,155,192,0.62)", 0.25));
    // look "real": cauliflower billows with firmer edges and grey, shaded undersides, as in film of powder avalanches
    const billow = [0, 1, 2].map(() => lump(128, 8, "rgba(244,243,239,0.92)", "rgba(124,122,117,0.85)", 0.55));
    const shadow = mk(64, (x, n) => { const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, "rgba(6,14,28,0.6)"); g.addColorStop(1, "rgba(6,14,28,0)"); x.fillStyle = g; x.fillRect(0, 0, n, n); });
    const glow = mk(128, (x, n) => { const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(200,240,255,0.7)"); g.addColorStop(1, "rgba(80,200,255,0)"); x.fillStyle = g; x.fillRect(0, 0, n, n); });
    return (SPR = { flow, debris, dust, billow, shadow, glow });
  }

  // ------------------------------------------------------------ one run
  let cur = null;
  function stop(fast) { if (cur) cur.stop(fast); }
  function play(map, o) { stop(true); const c = run(map, o); cur = c; return c; }

  function run(map, o) {
    let dead = false, started = false, raf = 0, resolveDone, fading = 0, fadeDur = 900, g = null, finished = false, t0Cam = null;
    const ctl = { done: new Promise(res => { resolveDone = res; }) };
    const box = map.getContainer(), stage = box.closest(".hk-stage") || box.parentElement;
    const cv = document.createElement("canvas"); cv.className = "av-cv";
    box.insertBefore(cv, box.querySelector(".mapboxgl-control-container,.maplibregl-control-container"));
    const ctx = cv.getContext("2d"), S = sprites();
    const hud = document.createElement("div"); hud.className = "av-hud" + (o.path ? " model" : "") + (o.hudClass ? " " + o.hudClass : "");
    hud.innerHTML = `<div class="av-top"><span class="av-live"></span><b>${esc(o.head || (o.path ? "Avalanche reconstruction" : "Avalanche simulation"))}</b>
        <span class="av-tag">${esc(o.tag || (o.path ? "model · not observed" : "illustrative"))}</span><button type="button" class="av-x" title="Stop (Esc)" aria-label="Stop">×</button></div>
      <div class="av-t">${esc(o.title)}</div><div class="av-s">${esc(o.sub || "")}</div>
      <div class="av-ph"><i></i><span data-k="ph">Locating release zone…</span></div>
      <div class="av-tl" title="Drag to scrub through the avalanche"><div class="av-tl-tr"><i class="av-tl-f"></i><b class="av-tl-k"></b></div><div class="av-tl-m"></div></div>
      <div class="av-grid">
        <div><small>Front speed</small><b data-k="v">—</b><em>m/s</em><u data-k="kmh"></u><span class="av-bar"><i data-k="bar"></i></span></div>
        <div><small>Distance</small><b data-k="d">—</b><em>m</em><u data-k="dl"></u></div>
        <div><small>Vertical drop</small><b data-k="h">—</b><em>m</em><u data-k="el"></u></div>
        <div><small>Elapsed</small><b data-k="t">—</b><em>s</em><u data-k="rate"></u></div>
      </div>
      <canvas class="av-prof" width="560" height="132"></canvas>
      <p class="av-note">${esc(o.note || "")}</p>`;
    (o.hudHost || stage || box).appendChild(hud);
    if (stage) stage.classList.add("av-on");
    const q = k => hud.querySelector(`[data-k="${k}"]`);
    const ui = { ph: q("ph"), v: q("v"), kmh: q("kmh"), bar: q("bar"), d: q("d"), dl: q("dl"), h: q("h"), el: q("el"), t: q("t"), rate: q("rate") };
    const prof = hud.querySelector(".av-prof"), pctx = prof.getContext("2d");
    const onKey = e => { if (e.key === "Escape" && o.keys !== false) { ctl.stop(); if (o.onStop) o.onStop(); } };
    document.addEventListener("keydown", onKey);
    hud.querySelector(".av-x").onclick = () => { ctl.stop(); if (o.onStop) o.onStop(); };

    function remove() {
      if (dead) return; dead = true;
      cancelAnimationFrame(raf); cv.remove(); hud.remove(); box.style.transform = "";
      document.removeEventListener("keydown", onKey);
      if (stage && cur === ctl) stage.classList.remove("av-on");
      if (cur === ctl) cur = null;
      resolveDone();
    }
    ctl.stop = fast => {
      if (dead) return;
      if (!started) { remove(); return; }
      if (fading) { if (fast) remove(); return; }
      fadeDur = fast ? 420 : 900; fading = performance.now();
      if (fast) hud.remove(); else hud.classList.add("out");
      box.style.transform = "";
      resolveDone();
    };
    ctl.running = () => !dead;
    // Pause freezes the playback clock and the camera drift; resume continues the drift for the time that is left.
    let paused = false, speed = clamp(+o.speed || 1, 0.25, 4), scrub = false, hoverS = null;
    // look "real": no game effects (target lock, neon speed trail, glows, flashes, shock rings, glints); snow, cloud and debris only.
    const RL = o.look === "real";
    const reDrift = () => {
      const left = Math.max(0.3, (flowP + settle) - Math.max(0, clock - REL));
      map.easeTo({ ...drift, duration: left * 1000 * slow / speed, easing: t => t, essential: true, padding: o.padding });
    };
    const rateTxt = () => { const k = rate * speed; return `×${fmt(k, k < 10 ? 1 : 0)} speed`; };
    ctl.paused = () => paused;
    ctl.pause = on => {
      if (dead || on === paused) return;
      paused = on;
      hud.classList.toggle("paused", on);
      if (on) { map.stop(); box.style.transform = ""; }
      else if (drift && !fading && !scrub) reDrift();
    };
    // Playback speed (1 = the default pace); the camera drift is re-timed for the part that is left.
    ctl.speed = k => {
      if (k == null) return speed;
      speed = clamp(+k || 1, 0.25, 4);
      if (started) ui.rate.textContent = rateTxt();
      if (drift && !paused && !fading && !scrub) reDrift();
      return speed;
    };

    // Timeline: drag to scrub. The camera is left where the user is; the drift resumes on release.
    const tl = hud.querySelector(".av-tl-tr"), tlF = hud.querySelector(".av-tl-f"), tlK = hud.querySelector(".av-tl-k");
    const total = () => REL + flowP + settle;
    const seek = e => { const b = tl.getBoundingClientRect(); clock = clamp((e.clientX - b.left) / (b.width || 1), 0, 1) * total(); lastKey = ""; };
    tl.addEventListener("pointerdown", e => {
      if (!started || fading) return;
      scrub = true; tl.setPointerCapture(e.pointerId); map.stop(); box.style.transform = ""; hud.classList.add("scrub"); seek(e);
      if (o.onScrub) o.onScrub();
    });
    tl.addEventListener("pointermove", e => { if (scrub) seek(e); });
    const endScrub = () => { if (!scrub) return; scrub = false; hud.classList.remove("scrub"); if (camMoved && drift && !paused && !fading) reDrift(); };
    tl.addEventListener("pointerup", endScrub); tl.addEventListener("pointercancel", endScrub);
    // Profile hover: read elevation and speed at any point of the path; the point is marked on the mountain.
    prof.addEventListener("pointermove", e => {
      if (!g) return;
      const b = prof.getBoundingClientRect(), pad = 8 * b.width / prof.width;
      hoverS = clamp((e.clientX - b.left - pad) / ((b.width - 2 * pad) || 1), 0, 1) * g.L;
    });
    prof.addEventListener("pointerleave", () => { hoverS = null; });

    (async () => {
      try {
        if (o.intro) {
          ui.ph.textContent = o.intro.label || "Approach";
          map.flyTo({ ...o.intro.camera, duration: o.intro.ms || 2400, essential: true, padding: o.padding });
          await moved(map, (o.intro.ms || 2400) + 600);
          if (dead) return;
          // hold on the mountain until its imagery and terrain have loaded (no black gaps when the avalanche starts), at most idleMs
          if (o.intro.idleMs && !(map.loaded && map.loaded())) ui.ph.textContent = "Loading the mountain…";
          await Promise.all([wait(o.intro.hold || 700), o.intro.idleMs ? idle(map, o.intro.idleMs) : null]);
          if (dead) return;
        }
        g = await prepare(o);
        if (dead) return;
        let cam = camera(map, g, o);
        if (RL) cam = await clearView(map, g, cam, o);              // "real": never look at the slope through another mountain
        if (dead) return;
        ui.ph.textContent = "Approaching release zone";
        map.flyTo({ ...cam, duration: o.flyMs || 1300, essential: true, curve: 1.25, padding: o.padding });
        await moved(map, (o.flyMs || 1300) + 600);
        if (dead) return;
        await idle(map, o.idleMs || 500);
        if (dead) return;
        t0Cam = cam;
        start();
      } catch (e) {
        console.warn("Avalanche:", e.message);
        ui.ph.textContent = "No animation here: " + e.message;
        setTimeout(remove, 1600);
      }
    })();

    // ---------------------------------------------------------- frame loop
    let rate = 1, flowP = 1, settle = 1, clock = 0, lastNow = 0, PX = null, PY = null, SC = null, lastKey = "", frameN = 0;
    let OX = 0, OY = 0, OS = 0;
    // look "real": offscreen layers for the dense-flow body and the powder cloud
    const fx = document.createElement("canvas"), fxc = fx.getContext("2d"), cl = document.createElement("canvas"), clc = cl.getContext("2d");
    // snow grains / clods on the flowing surface (look "real"): a tile of light and dark specks that slides downhill with the flow
    const grain = (() => { const c = document.createElement("canvas"); c.width = c.height = 96; const x = c.getContext("2d"), q = rng(11);
      for (let i = 0; i < 520; i++) { const lt = q() < 0.55, r = 0.4 + q() * (lt ? 1.5 : 1.1);
        x.fillStyle = lt ? `rgba(255,255,253,${0.5 + q() * 0.5})` : `rgba(96,98,104,${0.18 + q() * 0.3})`;
        x.beginPath(); x.arc(q() * 96, q() * 96, r, 0, 7); x.fill(); }
      return c; })();
    let grainPat = null;
    const sized = (c, w, h, k) => { const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k)); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } };

    // The dense flow as one body of snow, the way it looks on film: a tongue that stretches as the head outruns the tail, wide
    // lobed head that surges, turbulent flanks, shaded edges and surface streaks moving with the flow. When the front stops the
    // body freezes into the deposit tongue over the last ~30 % of the run.
    function body(ts, sFront, w, h, dpr, shown) {
      const L = g.L, fr = Math.min(ts, g.Tend);                                   // ripples freeze once stopped
      const sH = Math.min(sFront, L), sT = Math.min(g.sF(ts * 0.6), L * 0.7);
      if (sH < 2) return;
      const wid = s => {
        const f = (s - sT) / Math.max(1, sH - sT);                                   // 0 tail ... 1 head
        const env = 0.55 + 0.4 * smooth(f / 0.5) + 0.28 * smooth((f - 0.72) / 0.28);    // heavy, bulging head
        const rip = 1 + 0.12 * Math.sin(s / 21 + fr * 2.6) + 0.07 * Math.sin(s / 7.5 - fr * 4.1) + 0.04 * Math.sin(s / 3.1 + fr * 7);
        return g.W(Math.min(s, L)) * env * rip;
      };
      const N = 70, Lp = [], Rp = [], cap = [];
      for (let i = 0; i <= N; i++) { const s = sT + (sH - sT) * i / N, ww = wid(s); P(s, -ww); Lp.push(OX, OY); P(s, ww); Rp.push(OX, OY); }
      const wH = wid(sH), surge = ts < g.Tend ? 0.18 * Math.sin(ts * 3.3) : 0;
      for (let q = 1; q < 16; q++) { const a = q / 16 * Math.PI, lob = 1 + surge + 0.22 * Math.abs(Math.sin(q * 1.9 + fr * 1.4));
        P(sH + Math.sin(a) * wH * 0.5 * lob, -Math.cos(a) * wH); cap.push(OX, OY); }
      const trace = c => { c.beginPath(); c.moveTo(Lp[0], Lp[1]); for (let i = 2; i < Lp.length; i += 2) c.lineTo(Lp[i], Lp[i + 1]);
        for (let i = 0; i < cap.length; i += 2) c.lineTo(cap[i], cap[i + 1]); for (let i = Rp.length - 2; i >= 0; i -= 2) c.lineTo(Rp[i], Rp[i + 1]); c.closePath(); };
      P(sH, 0); const hx = OX, hy = OY, hS = OS;
      sized(fx, w, h, dpr); fxc.setTransform(dpr, 0, 0, dpr, 0, 0); fxc.clearRect(0, 0, w, h);
      fxc.globalCompositeOperation = "source-over"; fxc.globalAlpha = 1; fxc.filter = "none";
      if (!grainPat) grainPat = fxc.createPattern(grain, "repeat");
      // the track it has run over keeps a THIN layer of avalanche snow (the ground shows through, more so high up where it scoured),
      // much thinner than the thick deposit at the end (user request); ragged edges
      if (sT > 3) {
        const tw = s => g.W(Math.min(s, L)) * (0.42 + 0.1 * s / L + 0.08 * Math.sin(s / 33) + 0.05 * Math.sin(s / 9.5 + 1.3));
        fxc.beginPath();
        for (let i = 0; i <= 60; i++) { const s = sT * i / 60; P(s, -tw(s)); i ? fxc.lineTo(OX, OY) : fxc.moveTo(OX, OY); }
        for (let i = 60; i >= 0; i--) { const s = sT * i / 60; P(s, tw(s)); fxc.lineTo(OX, OY); }
        fxc.closePath();
        P(0, 0); const t0x = OX, t0y = OY; P(sT, 0);
        const lg = fxc.createLinearGradient(t0x, t0y, OX, OY); lg.addColorStop(0, "rgba(236,235,231,0.34)"); lg.addColorStop(1, "rgba(236,235,231,0.62)");
        fxc.fillStyle = lg; fxc.fill();
        if (grainPat) { fxc.save(); fxc.clip(); if (grainPat.setTransform && typeof DOMMatrix !== "undefined") grainPat.setTransform(new DOMMatrix());
          fxc.globalAlpha = 0.3; fxc.fillStyle = grainPat; fxc.fillRect(0, 0, w, h); fxc.restore(); }
      }
      if (sH - sT >= 2) {
        trace(fxc); fxc.fillStyle = "rgb(229,227,222)"; fxc.fill();      // churned debris: a touch greyer than the untouched slope
        fxc.save(); trace(fxc); fxc.clip();
        // shaded flanks (the flow is a raised mass, its edges turn away from the light)
        fxc.lineJoin = "round"; fxc.strokeStyle = "rgba(118,116,112,0.7)"; fxc.lineWidth = clamp(wH * hS * 0.7, 4, 30); trace(fxc); fxc.stroke();
        fxc.strokeStyle = "rgba(98,97,94,0.35)"; fxc.lineWidth = clamp(wH * hS * 0.25, 2, 10); trace(fxc); fxc.stroke();
        // surface streaks, moving downstream while it flows
        fxc.lineCap = "round"; fxc.setLineDash([14, 22]); fxc.lineDashOffset = -(fr * 38) % 36;
        [-0.62, -0.38, -0.14, 0.1, 0.34, 0.58].forEach((lane, k) => {
          fxc.beginPath();
          for (let i = 0; i <= 40; i++) { const s = sT + (sH - sT) * i / 40; P(s, lane * wid(s)); i ? fxc.lineTo(OX, OY) : fxc.moveTo(OX, OY); }
          fxc.strokeStyle = k % 2 ? "rgba(255,255,255,0.85)" : "rgba(138,137,132,0.4)"; fxc.lineWidth = k % 2 ? 1.6 : 1.1; fxc.stroke();
        });
        fxc.setLineDash([]);
        // tumbling snow: the grain texture moving downhill (tail -> head on screen) while it flows, frozen in the deposit
        if (grainPat && grainPat.setTransform && typeof DOMMatrix !== "undefined") {
          P(sT, 0); const dx = hx - OX, dy = hy - OY, dl = Math.hypot(dx, dy) || 1, mv = (fr * 14) % 96;
          grainPat.setTransform(new DOMMatrix().translate(dx / dl * mv, dy / dl * mv));
          fxc.globalAlpha = 0.6; fxc.fillStyle = grainPat; fxc.fillRect(0, 0, w, h); fxc.globalAlpha = 1;
        }
        // the head: fresh powder boiling up, brightest; the tail duller and greyer as it slows and thins
        if (ts < g.Tend) { const rr = Math.max(14, wH * hS * 2.2), gr = fxc.createRadialGradient(hx, hy, 0, hx, hy, rr);
          gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(1, "rgba(255,255,255,0)"); fxc.fillStyle = gr; fxc.fillRect(hx - rr, hy - rr, rr * 2, rr * 2); }
        P(sT, 0); const tg = fxc.createLinearGradient(OX, OY, hx, hy); tg.addColorStop(0, "rgba(128,126,120,0.35)"); tg.addColorStop(0.5, "rgba(128,126,120,0)");
        fxc.fillStyle = tg; fxc.fillRect(0, 0, w, h);
        fxc.restore();
        // a dark rim so the white mass stands out on snow-covered slopes too
        fxc.strokeStyle = "rgba(52,51,48,0.85)"; fxc.lineWidth = 1.8; trace(fxc); fxc.stroke();
        // the deposit is THICK: once the front has stopped, a raised pile with a shaded lower edge under it (metres of debris)
        if (ts >= g.Tend) {
          const th = clamp(wH * hS * 0.12, 2, 7);
          fxc.save(); fxc.globalCompositeOperation = "destination-over"; fxc.fillStyle = "rgb(150,148,143)"; fxc.translate(0, th); trace(fxc); fxc.fill();
          fxc.fillStyle = "rgb(112,110,106)"; fxc.translate(0, th * 0.6); trace(fxc); fxc.fill(); fxc.restore();
        }
        // its ground shadow, soft, on the downhill side, behind everything drawn so far
        fxc.save(); fxc.globalCompositeOperation = "destination-over"; fxc.filter = "blur(6px)"; fxc.globalAlpha = 0.78; fxc.fillStyle = "rgb(20,19,17)";
        fxc.translate(3, 7); trace(fxc); fxc.fill(); fxc.restore();
      }
      eraseHidden(fxc);                                                              // nothing drawn over a nearer mountain
      ctx.save(); ctx.globalAlpha = shown; ctx.filter = "blur(0.6px)"; ctx.drawImage(fx, 0, 0, w, h); ctx.restore();
    }    // Blocky deposit: angular snow blocks left where the body has passed (debris, stauchwall at the toe).
    function debris(ts, sFront, shown) {
      for (const d of g.D) {
        if ((d.s > sFront && ts < g.Tend) || !visAt(d.s)) continue;
        P(d.s, d.xi * g.W(d.s) * 0.75);
        const sz = clamp(d.size * OS, 1.1, 7), x = OX, y = OY;
        ctx.save(); ctx.translate(x, y); ctx.rotate(d.rot); ctx.globalAlpha = 0.9 * shown;
        ctx.fillStyle = "rgba(22,21,19,0.35)"; ctx.fillRect(-sz * 0.9 + 1, -sz * d.ar * 0.9 + 1.5, sz * 1.9, sz * d.ar * 1.9);
        ctx.fillStyle = "#efeeea"; ctx.strokeStyle = "rgba(98,96,92,0.6)"; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-sz, -sz * d.ar); ctx.lineTo(sz * 0.85, -sz * d.ar * 0.75); ctx.lineTo(sz, sz * d.ar); ctx.lineTo(-sz * 0.75, sz * d.ar * 0.9); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.restore();
      }
    }
    const CX = new Float32Array(2000), CY = new Float32Array(2000), CR = new Float32Array(2000), CA = new Float32Array(2000), CM = new Uint8Array(2000);
    function start() {
      started = true;
      rate = o.rate || Math.max(1, g.endT / (o.flowSec || 3.4));
      flowP = g.endT / rate; settle = RL ? 3.4 : o.path ? 2.6 : 1.1;     // "real": time for the powder cloud to drift and settle
      PX = new Float32Array(g.NT * J); PY = new Float32Array(g.NT * J); SC = new Float32Array(g.NT);
      ui.rate.textContent = rateTxt();
      // Timeline phase marks (playback clock, independent of the speed setting).
      let ivm = 0; for (let i = 1; i < g.N; i++) if (g.V[i] > g.V[ivm]) ivm = i;
      const mk = [["Release", PRE], ["Peak", REL + g.T[ivm] / rate], ["Run-out", REL + g.Tend / rate]];
      const xs = mk.map(([, t]) => clamp(t / total(), 0, 1) * 100), lo = xs.map((x, i) => i > 0 && x - xs[i - 1] < 16);   // close marks: second label drops a row
      hud.querySelector(".av-tl-m").innerHTML = mk.map(([n], i) => `<span class="m${i}${lo[i] && !lo[i - 1] ? " lo" : ""}" style="left:${xs[i].toFixed(1)}%">${n}</span>`).join("");
      hud.querySelector(".av-tl").classList.toggle("av-tl2", lo.some(Boolean));
      lastNow = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function mesh() {
      for (let n = 0; n < g.NT * J; n++) { const p = map.project([g.MLON[n], g.MLAT[n]]); PX[n] = p.x; PY[n] = p.y; }
      for (let i = 0; i < g.NT; i++) { const a = i * J; SC[i] = Math.hypot(PX[a + J - 1] - PX[a], PY[a + J - 1] - PY[a]) / (2 * g.Umax); }
    }
    // look "real": which parts of the path a nearer ridge hides from the current camera. The map's own terrain says what ground is
    // seen at each path point's screen position; if that is far from the path point, something nearer is in front of it.
    let VIS = null;
    function vis() {
      if (!VIS) VIS = new Uint8Array(g.NT).fill(1);
      const mid = J >> 1;
      for (let i = 0; i < g.NT; i++) {
        const k = i * J + mid, x = PX[k], y = PY[k];
        if (!(x > -50 && y > -50 && x < box.clientWidth + 50 && y < box.clientHeight + 50)) { VIS[i] = 1; continue; }
        const ll = map.unproject([x, y]), la = g.MLAT[k];
        const d = Math.hypot((ll.lng - g.MLON[k]) * 111320 * Math.cos(la * D2R), (ll.lat - la) * 110574);
        // a nearer ridge puts the seen ground kilometres off; steep faces seen obliquely give a few hundred metres without any ridge
        VIS[i] = d < Math.max(350, g.W(Math.min(i * g.ds, g.L)) * 2) ? 1 : 0;
      }
      for (let i = 1; i < g.NT - 1; i++) if (VIS[i - 1] && VIS[i + 1]) VIS[i] = 1;        // a single odd sample is noise
    }
    const visAt = s => !VIS || VIS[clamp(Math.round(s / g.ds), 0, g.NT - 1)] === 1;
    // cut the hidden stretches out of an offscreen layer (whole width of the mesh row)
    function eraseHidden(c) {
      if (!VIS) return;
      c.save(); c.globalCompositeOperation = "destination-out"; c.globalAlpha = 1; c.fillStyle = "#000"; c.filter = "blur(2px)";
      c.beginPath();
      for (let i = 0; i < g.NT - 1; i++) {
        if (VIS[i] && VIS[i + 1]) continue;
        const a = i * J, b = a + J;
        c.moveTo(PX[a], PY[a]); c.lineTo(PX[a + J - 1], PY[a + J - 1]); c.lineTo(PX[b + J - 1], PY[b + J - 1]); c.lineTo(PX[b], PY[b]); c.closePath();
      }
      c.fill(); c.restore();
    }
    // Screen position of path coordinate (s along, u across, metres) -> OX, OY; OS = pixels per metre there.
    function P(s, u) {
      const fi = clamp(s / g.ds, 0, g.NT - 1.001), i = fi | 0, a = fi - i;
      const fj = clamp((u / g.Umax + 1) / 2 * (J - 1), 0, J - 1.001), j = fj | 0, b = fj - j;
      const k0 = i * J + j, k1 = k0 + J;
      OX = lerp(lerp(PX[k0], PX[k0 + 1], b), lerp(PX[k1], PX[k1 + 1], b), a);
      OY = lerp(lerp(PY[k0], PY[k0 + 1], b), lerp(PY[k1], PY[k1 + 1], b), a);
      OS = lerp(SC[i], SC[i + 1], a);
    }

    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = box.clientWidth, h = box.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); lastKey = ""; }
      const c = map.getCenter(), key = `${c.lng.toFixed(6)},${c.lat.toFixed(6)},${map.getZoom().toFixed(4)},${map.getBearing().toFixed(3)},${map.getPitch().toFixed(3)},${w},${h}`;
      frameN++;
      if (key !== lastKey || frameN % 15 === 0) { mesh(); lastKey = key; }
      if (RL && (!VIS || frameN % 5 === 1)) vis();
      let fade = 1;
      if (fading) { fade = 1 - (now - fading) / fadeDur; if (fade <= 0) { remove(); return; } }
      // Playback clock: at most 0.1 s per frame, so a slow machine sees slow motion instead of skipped phases.
      if (!paused && !scrub) clock += Math.min(Math.max(0, now - lastNow), 100) / 1000 / slow * speed;
      lastNow = now;
      const tp = clock, ts = Math.min(Math.max(0, tp - REL) * rate, g.endT + settle * rate);
      const sFront = g.sF(ts), vF = ts > 0 && ts < g.Tend ? g.at(g.V, sFront) : 0;
      const sinP = Math.sin(map.getPitch() * D2R), terr = map.getTerrain && map.getTerrain(), exg = (terr && +terr.exaggeration) || 1, up = sinP * exg;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";

      // Cinematic camera drift and shake.
      if (tp >= REL && !camMoved && !reduce() && !fading && !paused && !scrub) {
        camMoved = true;
        const [lo, la] = g.ll(g.L * 0.62);
        drift = { center: [lo, la], bearing: t0Cam.bearing + (o.drift ?? 14), zoom: t0Cam.zoom + 0.15 };
        map.easeTo({ ...drift, duration: (flowP + settle) * 1000 * slow / speed, easing: t => t, essential: true, padding: o.padding });
      }
      if (!reduce() && !fading && !paused && !scrub) {
        const crackKick = tp > PRE && tp < REL + 0.6 ? 3.2 * (1 - smooth((tp - PRE) / 1.1)) : 0;
        const amp = (o.shake ?? 2.4) * Math.pow(vF / g.vmax, 2) + crackKick;
        box.style.transform = amp > 0.05 ? `translate3d(${((Math.random() - 0.5) * 2 * amp).toFixed(2)}px,${((Math.random() - 0.5) * 2 * amp).toFixed(2)}px,0)` : "";
      }

      const shown = smooth((tp - PRE - CRACK * 0.4) / 0.3) * fade;   // flow particles appear as the slab shatters
      const L = g.L;

      // 1. Scoured track behind the front.
      const sTrack = Math.min(L * 1.02, Math.max(0, sFront));
      if (sTrack > 4 && shown > 0 && !RL) {                                        // "real": body() draws the white track instead
        ctx.beginPath();
        const st = Math.max(g.ds / 2, sTrack / 60);
        for (let s = 0; s <= sTrack; s += st) { P(s, -g.W(s) * 0.8); s === 0 ? ctx.moveTo(OX, OY) : ctx.lineTo(OX, OY); }
        for (let s = sTrack; s >= 0; s -= st) { P(s, g.W(s) * 0.8); ctx.lineTo(OX, OY); }
        ctx.closePath();
        ctx.fillStyle = RL ? `rgba(150,148,142,${0.16 * shown})` : `rgba(150,172,205,${0.22 * shown})`; ctx.fill();                   // scoured, compacted snow: slightly darker and bluer
        ctx.strokeStyle = `rgba(255,255,255,${(RL ? 0.18 : 0.4) * shown})`; ctx.lineWidth = 1.1; ctx.stroke();
      }
      if (sTrack > 4 && shown > 0 && !RL) {
        // Speed trail down the centre line, coloured by the front speed there (cyan -> amber -> rose, as in the read-out bar).
        const st2 = Math.max(g.ds, sTrack / 70), ta = shown * (ts < g.Tend ? 1 : 0.55 + 0.45 * (1 - smooth((ts - g.Tend) / (rate * 1.2))));
        ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
        for (let pass = 0; pass < 2; pass++) {
          ctx.lineWidth = pass ? 2 : 7;
          for (let s = 0; s < sTrack; s += st2) {
            const s2 = Math.min(sTrack, s + st2), [cr, cg, cb] = heat(g.at(g.V, s) / g.vmax);
            P(s, 0); const x0 = OX, y0 = OY; P(s2, 0);
            ctx.globalAlpha = ta * (pass ? 0.7 : 0.16); ctx.strokeStyle = `rgb(${cr},${cg},${cb})`;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(OX, OY); ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      }

      // 2. Cloud shadows on the ground.
      const C = g.C;
      if (shown > 0) for (let i = 0; i < C.length; i++) {
        const p = C[i], age = (ts - p.tb) / rate; if (age < 0 || age > p.life) continue;
        const s = p.sb + p.adv * (1 - Math.exp(-age / 0.55)), u = p.ub * g.W(Math.min(s, L)) * (1 + 0.35 * age);
        const a = p.a * smooth(age / 0.18) * (1 - smooth((age - p.life * 0.45) / (p.life * 0.55)));
        P(s, u); const rr = Math.min(240, (p.r0 + p.gr * Math.pow(age, 0.7)) * OS * 1.1);
        ctx.globalAlpha = a * 0.55 * fade; ctx.drawImage(S.shadow, OX - rr + rr * 0.25, OY - rr * 0.6, rr * 2, rr * 1.4);
      }

      // 3. Dense flow and deposit. "real": one continuous body of snow (see body()) and the blocky deposit; otherwise particles.
      if (RL && shown > 0) { body(ts, sFront, w, h, dpr, shown); debris(ts, sFront, shown); }
      const Pn = g.P, n = Pn.length;
      if (shown > 0 && !RL) {
        for (let i = 0; i < n; i++) {
          const p = Pn[i];
          let s = Math.min(p.s0 + g.sF(ts * p.f) * p.gk, p.stop);
          const moving = ts > 0 && s < p.stop - 0.5, vr = moving ? clamp(g.at(g.V, s) / g.vmax, 0, 1) : 0;
          if (moving) s += 4 * Math.sin(ts * 1.9 + p.ph);
          const wv = g.W(s), u = p.xi * wv + 0.16 * wv * Math.sin(s / 38 + p.ph) * (moving ? 1 : 0.6);
          const zz = moving ? p.zA * Math.abs(Math.sin(ts * 2.6 + p.ph)) * vr : 0;
          P(s, u);
          CX[i] = OX; CY[i] = OY - zz * OS * up; CR[i] = clamp(p.r * OS * (moving ? 1.05 : 0.55), moving ? 2.2 : 1.4, moving ? 26 : 10); CM[i] = moving ? 1 : 0;
          CA[i] = shown * (moving ? 0.9 : 0.86);
        }
        for (let i = 0; i < n; i += 2) {
          const rr = CR[i] * 1.6; ctx.globalAlpha = CA[i] * (CM[i] ? 0.62 : 0.45);              // contact shadow: reads on bright snowfields too
          ctx.drawImage(S.shadow, CX[i] - rr * 0.8, CY[i] - rr * 0.35, rr * 2, rr * 1.4);
        }
        for (let i = 0; i < n; i++) {
          const rr = CR[i], fl = CM[i] ? 1 : 0.62; ctx.globalAlpha = CA[i];   // deposited snow lies flat
          ctx.drawImage((CM[i] ? S.flow : S.debris)[Pn[i].sp], CX[i] - rr, CY[i] - rr * fl, rr * 2, rr * 2 * fl);
        }
        // Motion streaks at the head (snow spray).
        ctx.lineCap = "round";
        for (let i = Math.floor(n * 0.86); i < n; i++) {
          if (!CM[i]) continue;
          const p = Pn[i], s = Math.min(p.s0 + g.sF(ts * p.f) * p.gk, p.stop), v = g.at(g.V, s); if (v < 12) continue;
          const wv = g.W(s), u = p.xi * wv + 0.16 * wv * Math.sin(s / 38 + p.ph);
          P(Math.max(0, s - Math.min(70, v * 1.4)), u);
          ctx.globalAlpha = 0.28 * shown; ctx.strokeStyle = "#f4f9ff"; ctx.lineWidth = Math.max(1, CR[i] * 0.8);
          ctx.beginPath(); ctx.moveTo(OX, OY); ctx.lineTo(CX[i], CY[i]); ctx.stroke();
        }
        // Glowing head and the bow wave across the front.
        if (ts > 0 && ts < g.Tend && !RL) {
          const vr = clamp(vF / g.vmax, 0, 1), wf = g.W(sFront);
          ctx.globalCompositeOperation = "lighter";
          P(sFront, 0); const rr = Math.max(28, wf * OS * 1.9);
          ctx.globalAlpha = 0.34 * vr * vr * shown; ctx.drawImage(S.glow, OX - rr, OY - rr * 0.8, rr * 2, rr * 1.6);
          for (let pass = 0; pass < 2; pass++) {
            ctx.beginPath();
            for (let q = 0; q <= 18; q++) { const f = q / 18 * 2 - 1; P(sFront + 14 * (1 - f * f), f * wf * 1.05); q ? ctx.lineTo(OX, OY) : ctx.moveTo(OX, OY); }
            ctx.globalAlpha = shown * vr * (pass ? 0.55 : 0.2); ctx.strokeStyle = pass ? "#ffffff" : "#bae6fd"; ctx.lineWidth = pass ? 1.6 : 6; ctx.stroke();
          }
          ctx.globalCompositeOperation = "source-over";
        }
      }

      // 4. Slab blocks tumbling and breaking up.
      if (shown > 0) for (const b of g.B) {
        if (ts > b.life) continue;
        const s = Math.min(b.s0 + g.sF(ts * (1 - 0.3 * b.k)), L), wv = g.W(s), lf = 1 - smooth((ts - b.life * 0.6) / (b.life * 0.4));
        if (RL && !visAt(s)) continue;
        P(s, b.xi * wv * 0.9);
        const sz = Math.max(1.6, b.size * OS * (0.6 + 0.4 * lf)), rot = b.rot + b.spin * ts / Math.max(rate, 1) * 0.6;
        ctx.save(); ctx.translate(OX, OY - sz * 0.4); ctx.rotate(rot); ctx.globalAlpha = shown * lf;
        ctx.fillStyle = RL ? "#f1f0ec" : "#f3f7fd"; ctx.strokeStyle = RL ? "rgba(92,90,86,.75)" : "rgba(70,92,126,.75)"; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-sz, -sz * b.ar); ctx.lineTo(sz * 0.9, -sz * b.ar * 0.8); ctx.lineTo(sz, sz * b.ar); ctx.lineTo(-sz * 0.8, sz * b.ar * 0.9); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.restore();
      }

      // 4b. Airborne spray: ballistic arcs off the flanks of the head.
      if (shown > 0 && g.E.length) {
        ctx.globalCompositeOperation = RL ? "source-over" : "lighter"; ctx.lineCap = "round"; ctx.strokeStyle = "#f4f9ff";
        const at = (e, a) => {
          const s = e.sb + e.fw * (1 - Math.exp(-a / 0.5)), f = a / e.life, z = 4 * e.hp * f * (1 - f);
          P(s, e.side * (g.W(Math.min(s, L)) * 0.7 + e.lat * (1 - Math.exp(-a / 0.45))));
          return [OX, OY - z * OS * up];
        };
        for (const e of g.E) {
          const age = (ts - e.tb) / rate; if (age < 0 || age > e.life) continue;
          const [x1, y1] = at(e, age), [x0, y0] = at(e, Math.max(0, age - 0.07));
          ctx.globalAlpha = shown * 0.8 * (1 - smooth(age / e.life)); ctx.lineWidth = e.sz;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // 5. Powder cloud, with ice-crystal glints catching the light. "real": the puffs go onto a half-size layer that is blurred as a
      // whole, so they merge into one smoky suspension cloud instead of separate balls.
      const cc = RL ? clc : ctx;
      if (RL) { sized(cl, w, h, 0.5); clc.setTransform(0.5, 0, 0, 0.5, 0, 0); clc.clearRect(0, 0, w, h); }
      if (shown > 0) for (let i = 0; i < C.length; i++) {
        const p = C[i], age = (ts - p.tb) / rate; if (age < 0 || age > p.life) continue;
        const s = p.sb + p.adv * (1 - Math.exp(-age / 0.55)), u = p.ub * g.W(Math.min(s, L)) * (1 + 0.35 * age);
        const z = p.Hc * (1 - Math.exp(-age / 0.45)), a = p.a * smooth(age / 0.18) * (1 - smooth((age - p.life * 0.45) / (p.life * 0.55)));
        P(s, u); const rr = Math.min(RL ? 200 : 170, Math.max(6, (p.r0 + p.gr * Math.pow(age, 0.7)) * OS * 1.1)), cy = OY - z * OS * up;
        // "real": a big puff is thinner (the same snow spread over more air), so the cloud stays billowy instead of a solid white mass
        cc.globalAlpha = a * fade * (RL ? clamp(60 / rr, 0.18, 1) : 1); cc.drawImage((RL ? S.billow : S.dust)[p.sp], OX - rr, cy - rr, rr * 2, rr * 2);
        if (i % 4 === 0 && !RL) {
          const tw = Math.sin(tp * 9 + i * 2.1);
          if (tw > 0.55) {
            const gx = OX + Math.sin(i * 1.3) * rr * 0.45, gy = cy + Math.cos(i * 1.7) * rr * 0.35, k = (tw - 0.55) / 0.45, l = 2 + k * 4;
            ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = Math.min(1, a * 4) * k * fade; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(gx - l, gy); ctx.lineTo(gx + l, gy); ctx.moveTo(gx, gy - l); ctx.lineTo(gx, gy + l); ctx.stroke();
            ctx.globalCompositeOperation = "source-over";
          }
        }
      }
      if (RL && shown > 0) {
        eraseHidden(clc); ctx.save(); ctx.globalAlpha = 1; ctx.filter = "blur(3px)"; ctx.drawImage(cl, 0, 0, w, h); ctx.restore();
      }

      // 6. Release: target lock, fracture line, flash and ground shock ring.
      ctx.globalAlpha = fade;
      P(0, 0); const cx0 = OX, cy0 = OY;
      if (tp < PRE + 0.1 && !RL) {
        const k = smooth(tp / PRE), rr = lerp(70, 22, k), rot = tp * 2.2;
        ctx.strokeStyle = `rgba(34,211,238,${0.9 * (1 - smooth((tp - PRE) / 0.1))})`; ctx.lineWidth = 2;
        for (let q = 0; q < 4; q++) { ctx.beginPath(); ctx.arc(cx0, cy0, rr, rot + q * Math.PI / 2, rot + q * Math.PI / 2 + 0.9); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(cx0, cy0, 3, 0, 7); ctx.fillStyle = "#22d3ee"; ctx.fill();
      }
      if (tp > PRE) {
        const k = smooth((tp - PRE) / CRACK), K = g.K, half = K.length >> 1;
        const lineA = 1 - 0.55 * smooth((tp - REL - 0.4) / 0.8);
        ctx.lineJoin = "round";
        // the crown: a clean break running across the slope; "real" draws it as the dark shadowed step it is, without the glow
        (RL ? [[`rgba(18,30,52,${0.8 * lineA})`, 2.6], [`rgba(255,255,255,${0.9 * lineA})`, 1.1]] : [[`rgba(150,230,255,${0.55 * lineA})`, 5], [`rgba(255,255,255,${lineA})`, 1.8]]).forEach(([col, lw]) => {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
          const lo = Math.max(0, Math.round(half - k * half)), hi = Math.min(K.length - 1, Math.round(half + k * half));
          for (let i = lo; i <= hi; i++) { P(K[i].s, K[i].u); i === lo ? ctx.moveTo(OX, OY) : ctx.lineTo(OX, OY); }
          ctx.stroke();
        });
        // Crown wall left behind once the slab has gone.
        if (tp > REL) {
          ctx.strokeStyle = `rgba(20,34,58,${0.7 * smooth((tp - REL) / 0.6)})`; ctx.lineWidth = 2.4; ctx.beginPath();
          K.forEach((q, i) => { P(q.s + 3, q.u); i ? ctx.lineTo(OX, OY + 1.5) : ctx.moveTo(OX, OY + 1.5); }); ctx.stroke();
        }
        const ft = RL ? 99 : tp - PRE;      // "real": no flash, glow or shock ring
        if (ft < 0.35 && !reduce()) {   // brief release flash over the whole scene
          ctx.globalAlpha = 0.12 * (1 - smooth(ft / 0.35)) * fade; ctx.fillStyle = "#eaf6ff"; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = fade;
        }
        if (ft < 0.8) {   // flash
          const a = (1 - smooth(ft / 0.8)), rr = 40 + ft * 260;
          ctx.globalAlpha = a * 0.85 * fade; ctx.drawImage(S.glow, cx0 - rr, cy0 - rr, rr * 2, rr * 2); ctx.globalAlpha = fade;
        }
        if (ft < 1.4) {   // shock ring on the ground
          const rm = 30 + 700 * smooth(ft / 1.4), [lo0, la0] = g.ll(0), F0 = frameAt(lo0, la0);
          ctx.strokeStyle = `rgba(190,240,255,${0.75 * (1 - smooth(ft / 1.4))})`; ctx.lineWidth = 2; ctx.beginPath();
          for (let q = 0; q <= 40; q++) { const an = q / 40 * 6.2832, p = map.project(F0.ll(Math.cos(an) * rm, Math.sin(an) * rm)); q ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
          ctx.stroke();
        }
      }
      // Impact ring where the run stops.
      if (ts >= g.Tend && !RL) {
        const fr = (ts - g.Tend) / rate;
        if (fr < 1.6) {
          const rm = 20 + 380 * smooth(fr / 1.6), [loL, laL] = g.ll(L), FL = frameAt(loL, laL);
          ctx.strokeStyle = `rgba(249,168,212,${0.7 * (1 - smooth(fr / 1.6)) * fade})`; ctx.lineWidth = 2; ctx.beginPath();
          for (let q = 0; q <= 40; q++) { const an = q / 40 * 6.2832, p = map.project(FL.ll(Math.cos(an) * rm, Math.sin(an) * rm)); q ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
          ctx.stroke();
        }
      }

      // 7. Call-outs.
      ctx.globalAlpha = fade;
      const H0 = g.H[0];
      if (tp > PRE) { P(0, 0); callout(OX, OY, o.releaseLabel || "RELEASE", `${fmt(H0)} m${o.releaseNote ? " · " + o.releaseNote : ""}`, "#22d3ee", smooth((tp - PRE) / 0.4), -1); }
      // the record's own elevation, marked where the path passes it (e.g. "struck about 5,700 m"), once the front has got there
      if (o.mark && g.markS == null) { g.markS = -1; for (let i = 0; i < g.N; i++) if (g.H[i] <= o.mark.z) { g.markS = i * g.ds; break; } }
      if (o.mark && g.markS >= 0 && sFront >= g.markS && visAt(g.markS)) {
        P(g.markS, 0); callout(OX, OY, o.mark.head, o.mark.text, "#f87171", smooth((sFront - g.markS) / (L * 0.06)), 1);
      }
      if (sFront > g.svmax + 5 && g.vmax > 5) { P(g.svmax, 0); callout(OX, OY, "PEAK SPEED", `${fmt(g.vmax)} m/s · ${fmt(g.vmax * 3.6)} km/h`, "#fbbf24", smooth((sFront - g.svmax) / (L * 0.12)), 1); }
      if (ts >= g.Tend) { P(L, 0); callout(OX, OY, "RUN-OUT", `${fmt(L * g.dk)} m · drop ${fmt(H0 - g.H[g.N - 1])} m`, "#f472b6", smooth((ts - g.Tend) / (rate * 0.5)), -1); }
      // Point picked on the profile: a locator beam on the mountain.
      if (hoverS != null && !fading) {
        P(Math.min(hoverS, L), 0); const pr = 7 + 3 * Math.sin(now / 160);
        ctx.globalAlpha = 1; ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(OX, OY, pr, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(OX, OY - pr); ctx.lineTo(OX, OY - 54); ctx.stroke();
        ctx.fillStyle = "#22d3ee"; ctx.beginPath(); ctx.arc(OX, OY, 2.6, 0, 7); ctx.fill();
        const zH = g.at(g.H, Math.min(hoverS, L - 0.01)), t1 = `${fmt(hoverS * g.dk)} m along`, t2 = `${fmt(zH)} m · ${fmt(g.at(g.V, Math.min(hoverS, L)))} m/s`;
        ctx.font = "600 11px Inter, 'Segoe UI', sans-serif"; const bw = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 16;
        ctx.fillStyle = "rgba(5,12,24,.88)"; ctx.strokeStyle = "rgba(34,211,238,.8)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(OX - bw / 2, OY - 92, bw, 36, 6) : ctx.rect(OX - bw / 2, OY - 92, bw, 36); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#a5f3fc"; ctx.textAlign = "center"; ctx.fillText(t1, OX, OY - 77); ctx.fillStyle = "#fff"; ctx.fillText(t2, OX, OY - 62); ctx.textAlign = "left";
      }

      // Read-out and timeline.
      if (frameN % 3 === 0 && !fading) readout(tp, ts, sFront, vF);
      if (!fading) { const f = clamp(tp / total(), 0, 1) * 100; tlF.style.width = f + "%"; tlK.style.left = f + "%"; }
      if (!finished && tp > REL + flowP + settle) {
        finished = true; resolveDone();
        if (o.hold != null) setTimeout(() => ctl.stop(), o.hold);
      }
    }
    let camMoved = false, drift = null;

    function callout(x, y, h1, h2, col, a, side) {
      if (a <= 0.01) return;
      const dx = 26 * side, dy = -46, bx = x + dx, by = y + dy;
      ctx.save(); ctx.globalAlpha *= a;
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.lineTo(bx + 14 * side, by); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      ctx.font = "700 10px Inter, 'Segoe UI', sans-serif"; const w1 = ctx.measureText(h1).width;
      ctx.font = "600 12px Inter, 'Segoe UI', sans-serif"; const w2 = ctx.measureText(h2).width;
      const bw = Math.max(w1, w2) + 18, bh = 36, lx = side > 0 ? bx + 14 : bx - 14 - bw;
      ctx.fillStyle = "rgba(5,12,24,.84)"; ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx, by - bh / 2, bw, bh, 6) : ctx.rect(lx, by - bh / 2, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.font = "700 10px Inter, 'Segoe UI', sans-serif"; ctx.fillText(h1, lx + 9, by - 4);
      ctx.fillStyle = "#fff"; ctx.font = "600 12px Inter, 'Segoe UI', sans-serif"; ctx.fillText(h2, lx + 9, by + 11);
      ctx.restore();
    }

    function readout(tp, ts, sFront, vF) {
      const H0 = g.H[0], L = g.L;
      let ph;
      if (tp < PRE) ph = "Release zone locked";
      else if (tp < REL) ph = "Slab fracture";
      else if (ts < g.Tend) ph = sFront < g.svmax * 0.85 ? "Acceleration" : sFront < g.svmax * 1.15 + g.ds ? "Peak velocity" : "Deceleration";
      else if (ts < g.endT) ph = "Run-out · deposition";
      else ph = "Deposit settled";
      ui.ph.textContent = ph; hud.dataset.ph = ph.split(" ")[0].toLowerCase();
      const d = Math.min(sFront, L), dz = H0 - g.at(g.H, Math.min(d, L - 0.01));
      ui.v.textContent = fmt(vF); ui.kmh.textContent = `${fmt(vF * 3.6)} km/h`; ui.bar.style.width = `${clamp(vF / g.vmax, 0, 1) * 100}%`;
      ui.d.textContent = fmt(d * g.dk); ui.dl.textContent = `of ${fmt(L * g.dk)} m`;
      ui.h.textContent = fmt(dz); ui.el.textContent = `${fmt(H0)} → ${fmt(g.at(g.H, Math.min(d, L - 0.01)))} m`;
      ui.t.textContent = fmt(Math.min(ts, g.Tend), 1);
      // Profile: elevation (filled) and front speed (line) against distance.
      const W = prof.width, Hh = prof.height, pad = 8, N = g.N;
      let zmin = Infinity, zmax = -Infinity; for (let i = 0; i < N; i++) { zmin = Math.min(zmin, g.H[i]); zmax = Math.max(zmax, g.H[i]); }
      const xs = s => pad + (W - 2 * pad) * s / L, yz = z => pad + 6 + (Hh - 2 * pad - 18) * (1 - (z - zmin) / ((zmax - zmin) || 1)), yv = v => Hh - pad - (Hh - 2 * pad - 10) * v / g.vmax;
      pctx.clearRect(0, 0, W, Hh);
      const grd = pctx.createLinearGradient(0, 0, 0, Hh); grd.addColorStop(0, "rgba(160,200,255,.45)"); grd.addColorStop(1, "rgba(60,90,140,.05)");
      pctx.beginPath(); pctx.moveTo(xs(0), Hh - pad); for (let i = 0; i < N; i++) pctx.lineTo(xs(i * g.ds), yz(g.H[i])); pctx.lineTo(xs(L), Hh - pad); pctx.closePath(); pctx.fillStyle = grd; pctx.fill();
      pctx.beginPath(); for (let i = 0; i < N; i++) { const x = xs(i * g.ds), y = yz(g.H[i]); i ? pctx.lineTo(x, y) : pctx.moveTo(x, y); } pctx.strokeStyle = "rgba(220,235,255,.55)"; pctx.lineWidth = 2; pctx.stroke();
      pctx.beginPath(); for (let i = 0; i < N && i * g.ds <= d; i++) { const x = xs(i * g.ds), y = yz(g.H[i]); i ? pctx.lineTo(x, y) : pctx.moveTo(x, y); } pctx.strokeStyle = "#fff"; pctx.lineWidth = 4; pctx.stroke();
      pctx.beginPath(); for (let i = 0; i < N; i++) { const x = xs(i * g.ds), y = yv(g.V[i]); i ? pctx.lineTo(x, y) : pctx.moveTo(x, y); } pctx.strokeStyle = "rgba(251,191,36,.9)"; pctx.lineWidth = 2; pctx.setLineDash([6, 4]); pctx.stroke(); pctx.setLineDash([]);
      pctx.fillStyle = "#22d3ee"; pctx.beginPath(); pctx.arc(xs(d), yz(g.at(g.H, Math.min(d, L - 0.01))), 6, 0, 7); pctx.fill();
      if (hoverS != null) {
        const hx = xs(hoverS);
        pctx.strokeStyle = "rgba(34,211,238,.9)"; pctx.lineWidth = 2; pctx.setLineDash([4, 4]); pctx.beginPath(); pctx.moveTo(hx, pad); pctx.lineTo(hx, Hh - pad); pctx.stroke(); pctx.setLineDash([]);
        pctx.strokeStyle = "#22d3ee"; pctx.lineWidth = 3; pctx.beginPath(); pctx.arc(hx, yz(g.at(g.H, Math.min(hoverS, L - 0.01))), 7, 0, 7); pctx.stroke();
      }
      pctx.font = "600 18px Inter, 'Segoe UI', sans-serif"; pctx.fillStyle = "rgba(220,235,255,.8)"; pctx.fillText("elevation", pad + 2, Hh - pad - 4);
      pctx.fillStyle = "rgba(251,191,36,.95)"; pctx.textAlign = "right"; pctx.fillText("speed", W - pad - 2, pad + 14); pctx.textAlign = "left";
    }
    return ctl;
  }

  // Camera that looks up the path from the lower side, three-quarter view, the whole run in frame.
  function camera(map, g, o) {
    const [lo0, la0] = g.ll(0), [lo1, la1] = g.ll(g.L), [lm, lam] = g.ll(g.L * 0.45);
    const dx = (lo1 - lo0) * Math.cos(la0 * D2R), dy = la1 - la0, down = Math.atan2(dx, dy) / D2R;
    const el = map.getContainer(), pad = o.padding || {}, hEff = Math.max(260, el.clientHeight - (pad.top || 0) - (pad.bottom || 0)),
      wEff = Math.max(260, el.clientWidth - (pad.left || 0) - (pad.right || 0));
    // Fit both screen axes. Vertically the path spans its run along the view (foreshortened by the pitch) PLUS its vertical drop
    // (raised by the terrain exaggeration): on a 2,000 m face the drop dominates, and ignoring it put the release above the frame.
    const pitch = o.pitch || 62, side = (o.side ?? 28) * D2R, terr = map.getTerrain && map.getTerrain(), exg = (terr && +terr.exaggeration) || 1;
    const drop = Math.max(0, g.H[0] - g.H[g.N - 1]), L = Math.max(g.L, 300);
    const vM = L * Math.cos(side) * Math.cos(pitch * D2R) + drop * exg * Math.sin(pitch * D2R) + 2 * g.w0 * Math.cos(pitch * D2R);
    const hM = L * Math.abs(Math.sin(side)) + 2.6 * g.w0;
    const mpp = 1.3 * Math.max(vM / hEff, hM / wEff, 600 / Math.min(hEff, wEff));
    const zoom = clamp(Math.log2(40075016.686 * Math.cos(lam * D2R) / (512 * mpp)), 10.8, 14.8);
    // centre on the path point half way up the screen's vertical extent (distance along the view + height), not half way along the ground
    const sv = s => -s * Math.cos(side) * Math.cos(pitch * D2R) + g.at(g.H, Math.min(s, g.L)) * exg * Math.sin(pitch * D2R);
    let vmin = Infinity, vmax = -Infinity; for (let i = 0; i < g.N; i++) { const v = sv(i * g.ds); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
    let sc = g.L * 0.45, best = Infinity;
    for (let i = 0; i < g.N; i++) { const d = Math.abs(sv(i * g.ds) - (vmin + vmax) / 2); if (d < best) { best = d; sc = i * g.ds; } }
    const [lc, lac] = g.ll(sc);
    return { center: [lc, lac], zoom, pitch, bearing: down + 180 + (o.side ?? 28) };
  }
  // A view where no nearer ridge hides the path: line of sight on the DEM from the camera to points along the path, for bearings
  // around the default and a few lower pitches; the clearest wins (ties go to the default view). Changes bearing / pitch only.
  async function clearView(map, g, cam, o) {
    let h;
    try { const H = await demAround(o.lon, o.lat); h = (x, y) => H(...g.F.ll(x, y)); } catch { return cam; }
    const el = map.getContainer(), terr = map.getTerrain && map.getTerrain(), exg = (terr && +terr.exaggeration) || 1;
    const [cx, cy] = g.F.xy(cam.center[0], cam.center[1]), cz = (h(cx, cy) || g.H[0]) * exg;
    const mpp = 40075016.686 * Math.cos(cam.center[1] * D2R) / (512 * 2 ** cam.zoom), dist = 1.5 * el.clientHeight * mpp;   // camera to centre
    const pts = []; for (let i = 0; i < g.N; i += Math.max(1, Math.floor(g.N / 36))) pts.push([g.X[i], g.Y[i], (h(g.X[i], g.Y[i]) || g.H[i]) * exg]);
    const seen = (b, p) => {
      const bx = Math.sin(b * D2R), by = Math.cos(b * D2R), ex = cx - bx * dist * Math.sin(p * D2R), ey = cy - by * dist * Math.sin(p * D2R), ez = cz + dist * Math.cos(p * D2R);
      let ok = 0;
      for (const [px, py, pz] of pts) {
        let clear = true;
        for (let k = 1; k < 40 && clear; k++) {
          const f = k / 40 * 0.6;                                     // the first 60 % from the path towards the camera: where ridges hide it
          const z = h(px + (ex - px) * f, py + (ey - py) * f);
          if (isFinite(z) && z * exg > pz + (ez - pz) * f + 8) clear = false;
        }
        ok += clear;
      }
      return ok / pts.length;
    };
    let best = cam, bs = -1;
    for (const p of [cam.pitch, cam.pitch - 10, cam.pitch - 20]) for (const db of [0, -20, 20, -40, 40, -65, 65, -95, 95]) {
      const sc = seen(cam.bearing + db, p) - Math.abs(db) / 4000 - (cam.pitch - p) / 3000;
      if (sc > bs + 1e-9) { bs = sc; best = { ...cam, bearing: cam.bearing + db, pitch: p }; }
    }
    return best;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const moved = (map, ms) => new Promise(r => { let t = null; const f = () => { clearTimeout(t); map.off("moveend", f); r(); }; t = setTimeout(f, ms); map.on("moveend", f); });
  const idle = (map, ms) => new Promise(r => { if (map.loaded && map.loaded()) return r(); let t = null; const f = () => { clearTimeout(t); map.off("idle", f); r(); }; t = setTimeout(f, ms); map.on("idle", f); });

  return { play, stop, prefetch, active: () => !!cur, slowmo: k => { slow = Math.max(1, +k || 1); } };
})();
window.Avalanche = Avalanche;
