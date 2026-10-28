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
      if (v > 0.01) { const f = (MU * G * cos + G * v * v / XIH) * cos; ax -= vx / v * f; ay -= vy / v * f; }
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
    // Powder cloud puffs, born at the front in proportion to speed squared.
    const NPF = o.path ? 420 : 280, cdf = [], steps = 240;
    let acc = 0;
    for (let i = 0; i <= steps; i++) { const t = Tend * i / steps, v = g.at(V, g.sF(t)); acc += Math.max(0, v - 6) ** 2; cdf.push(acc); }
    g.C = [];
    if (acc > 0) for (let i = 0; i < NPF; i++) {
      const q = r() * acc; let a = 0; while (a < steps && cdf[a] < q) a++;
      const tb = Tend * a / steps, sb = Math.max(0, g.sF(tb) - r() * 35), vb = g.at(V, sb);
      g.C.push({ tb, sb, vb, ub: (r() * 2 - 1) * 0.9, r0: 14 + r() * 16, adv: vb * (1.3 + r() * 1.3), Hc: 10 + vb * (1.0 + r() * 1.0),
        gr: 35 + vb * 1.7 + r() * 40, life: (o.path ? 2.6 : 1.4) + r() * (o.path ? 2.4 : 1.3), a: 0.13 + r() * 0.17, sp: (r() * 3) | 0 });
    }
    // Slab blocks that break up in the first part of the run.
    g.B = Array.from({ length: 70 }, () => ({ s0: r() * 70 - 8, xi: r() * 2 - 1, k: 0.05 + r() * 0.5, size: 9 + r() * 15,
      rot: r() * 6.283, spin: (r() - 0.5) * 9, life: (0.18 + r() * 0.3) * Tend, ar: 0.5 + r() * 0.5 }));
    // Crown fracture line across the slab.
    g.K = Array.from({ length: 27 }, (_, i) => ({ u: (i / 26 * 2 - 1) * w0 * 1.05, s: -6 + r() * 9 }));
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
    const flow = [0, 1, 2, 3].map(() => lump(64, 9, "rgba(255,255,255,0.96)", "rgba(140,165,200,0.8)", 0.45));
    const debris = [0, 1, 2, 3].map(() => lump(64, 12, "rgba(232,239,248,0.97)", "rgba(110,128,158,0.85)", 0.62));
    const dust = [0, 1, 2].map(() => lump(128, 14, "rgba(250,252,255,0.55)", "rgba(165,185,215,0.55)", 0.25));
    const shadow = mk(64, (x, n) => { const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, "rgba(6,14,28,0.6)"); g.addColorStop(1, "rgba(6,14,28,0)"); x.fillStyle = g; x.fillRect(0, 0, n, n); });
    const glow = mk(128, (x, n) => { const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(200,240,255,0.7)"); g.addColorStop(1, "rgba(80,200,255,0)"); x.fillStyle = g; x.fillRect(0, 0, n, n); });
    return (SPR = { flow, debris, dust, shadow, glow });
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
    const hud = document.createElement("div"); hud.className = "av-hud" + (o.path ? " model" : "");
    hud.innerHTML = `<div class="av-top"><span class="av-live"></span><b>${o.path ? "Avalanche reconstruction" : "Avalanche simulation"}</b>
        <span class="av-tag">${o.path ? "model · not observed" : "illustrative"}</span><button type="button" class="av-x" title="Stop (Esc)" aria-label="Stop">×</button></div>
      <div class="av-t">${esc(o.title)}</div><div class="av-s">${esc(o.sub || "")}</div>
      <div class="av-ph"><i></i><span data-k="ph">Locating release zone…</span></div>
      <div class="av-grid">
        <div><small>Front speed</small><b data-k="v">—</b><em>m/s</em><u data-k="kmh"></u><span class="av-bar"><i data-k="bar"></i></span></div>
        <div><small>Distance</small><b data-k="d">—</b><em>m</em><u data-k="dl"></u></div>
        <div><small>Vertical drop</small><b data-k="h">—</b><em>m</em><u data-k="el"></u></div>
        <div><small>Elapsed</small><b data-k="t">—</b><em>s</em><u data-k="rate"></u></div>
      </div>
      <canvas class="av-prof" width="560" height="132"></canvas>
      <p class="av-note">${esc(o.note || "")}</p>`;
    (stage || box).appendChild(hud);
    if (stage) stage.classList.add("av-on");
    const q = k => hud.querySelector(`[data-k="${k}"]`);
    const ui = { ph: q("ph"), v: q("v"), kmh: q("kmh"), bar: q("bar"), d: q("d"), dl: q("dl"), h: q("h"), el: q("el"), t: q("t"), rate: q("rate") };
    const prof = hud.querySelector(".av-prof"), pctx = prof.getContext("2d");
    const onKey = e => { if (e.key === "Escape") { ctl.stop(); if (o.onStop) o.onStop(); } };
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

    (async () => {
      try {
        if (o.intro) {
          ui.ph.textContent = o.intro.label || "Approach";
          map.flyTo({ ...o.intro.camera, duration: o.intro.ms || 2400, essential: true, padding: o.padding });
          await moved(map, (o.intro.ms || 2400) + 600);
          if (dead) return;
          await wait(o.intro.hold || 700);
          if (dead) return;
        }
        g = await prepare(o);
        if (dead) return;
        const cam = camera(map, g, o);
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
    const CX = new Float32Array(2000), CY = new Float32Array(2000), CR = new Float32Array(2000), CA = new Float32Array(2000), CM = new Uint8Array(2000);
    function start() {
      started = true;
      rate = o.rate || Math.max(1, g.endT / (o.flowSec || 3.4));
      flowP = g.endT / rate; settle = o.path ? 2.6 : 1.1;
      PX = new Float32Array(g.NT * J); PY = new Float32Array(g.NT * J); SC = new Float32Array(g.NT);
      ui.rate.textContent = `×${fmt(rate, rate < 10 ? 1 : 0)} speed`;
      lastNow = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function mesh() {
      for (let n = 0; n < g.NT * J; n++) { const p = map.project([g.MLON[n], g.MLAT[n]]); PX[n] = p.x; PY[n] = p.y; }
      for (let i = 0; i < g.NT; i++) { const a = i * J; SC[i] = Math.hypot(PX[a + J - 1] - PX[a], PY[a + J - 1] - PY[a]) / (2 * g.Umax); }
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
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5), w = box.clientWidth, h = box.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); lastKey = ""; }
      const c = map.getCenter(), key = `${c.lng.toFixed(6)},${c.lat.toFixed(6)},${map.getZoom().toFixed(4)},${map.getBearing().toFixed(3)},${map.getPitch().toFixed(3)},${w},${h}`;
      frameN++;
      if (key !== lastKey || frameN % 15 === 0) { mesh(); lastKey = key; }
      let fade = 1;
      if (fading) { fade = 1 - (now - fading) / fadeDur; if (fade <= 0) { remove(); return; } }
      // Playback clock: at most 0.1 s per frame, so a slow machine sees slow motion instead of skipped phases.
      clock += Math.min(Math.max(0, now - lastNow), 100) / 1000 / slow; lastNow = now;
      const tp = clock, ts = Math.min(Math.max(0, tp - REL) * rate, g.endT + settle * rate);
      const sFront = g.sF(ts), vF = ts > 0 && ts < g.Tend ? g.at(g.V, sFront) : 0;
      const sinP = Math.sin(map.getPitch() * D2R), terr = map.getTerrain && map.getTerrain(), exg = (terr && +terr.exaggeration) || 1, up = sinP * exg;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";

      // Cinematic camera drift and shake.
      if (tp >= REL && !camMoved && !reduce() && !fading) {
        camMoved = true;
        const [lo, la] = g.ll(g.L * 0.62);
        map.easeTo({ center: [lo, la], bearing: t0Cam.bearing + (o.drift ?? 14), zoom: t0Cam.zoom + 0.3, duration: (flowP + settle) * 1000 * slow, easing: t => t, essential: true, padding: o.padding });
      }
      if (!reduce() && !fading) {
        const crackKick = tp > PRE && tp < REL + 0.6 ? 3.2 * (1 - smooth((tp - PRE) / 1.1)) : 0;
        const amp = (o.shake ?? 2.4) * Math.pow(vF / g.vmax, 2) + crackKick;
        box.style.transform = amp > 0.05 ? `translate3d(${((Math.random() - 0.5) * 2 * amp).toFixed(2)}px,${((Math.random() - 0.5) * 2 * amp).toFixed(2)}px,0)` : "";
      }

      const shown = smooth((tp - PRE - CRACK * 0.4) / 0.3) * fade;   // flow particles appear as the slab shatters
      const L = g.L;

      // 1. Scoured track behind the front.
      const sTrack = Math.min(L * 1.02, Math.max(0, sFront));
      if (sTrack > 4 && shown > 0) {
        ctx.beginPath();
        const st = Math.max(g.ds / 2, sTrack / 60);
        for (let s = 0; s <= sTrack; s += st) { P(s, -g.W(s) * 0.8); s === 0 ? ctx.moveTo(OX, OY) : ctx.lineTo(OX, OY); }
        for (let s = sTrack; s >= 0; s -= st) { P(s, g.W(s) * 0.8); ctx.lineTo(OX, OY); }
        ctx.closePath();
        ctx.fillStyle = `rgba(226,238,255,${0.2 * shown})`; ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${0.32 * shown})`; ctx.lineWidth = 1.1; ctx.stroke();
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

      // 3. Dense flow and deposit: positions first, then shadows, then snow.
      const Pn = g.P, n = Pn.length;
      if (shown > 0) {
        for (let i = 0; i < n; i++) {
          const p = Pn[i];
          let s = Math.min(p.s0 + g.sF(ts * p.f) * p.gk, p.stop);
          const moving = ts > 0 && s < p.stop - 0.5, vr = moving ? clamp(g.at(g.V, s) / g.vmax, 0, 1) : 0;
          if (moving) s += 4 * Math.sin(ts * 1.9 + p.ph);
          const wv = g.W(s), u = p.xi * wv + 0.16 * wv * Math.sin(s / 38 + p.ph) * (moving ? 1 : 0.6);
          const zz = moving ? p.zA * Math.abs(Math.sin(ts * 2.6 + p.ph)) * vr : 0;
          P(s, u);
          CX[i] = OX; CY[i] = OY - zz * OS * up; CR[i] = clamp(p.r * OS * (moving ? 1.05 : 0.7), moving ? 2.2 : 1.6, moving ? 26 : 14); CM[i] = moving ? 1 : 0;
          CA[i] = shown * (moving ? 0.9 : 0.94);
        }
        for (let i = 0; i < n; i += 2) {
          const rr = CR[i] * 1.6; ctx.globalAlpha = CA[i] * 0.35;
          ctx.drawImage(S.shadow, CX[i] - rr * 0.8, CY[i] - rr * 0.5, rr * 2, rr * 1.4);
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
      }

      // 4. Slab blocks tumbling and breaking up.
      if (shown > 0) for (const b of g.B) {
        if (ts > b.life) continue;
        const s = Math.min(b.s0 + g.sF(ts * (1 - 0.3 * b.k)), L), wv = g.W(s), lf = 1 - smooth((ts - b.life * 0.6) / (b.life * 0.4));
        P(s, b.xi * wv * 0.9);
        const sz = Math.max(1.6, b.size * OS * (0.6 + 0.4 * lf)), rot = b.rot + b.spin * ts / Math.max(rate, 1) * 0.6;
        ctx.save(); ctx.translate(OX, OY - sz * 0.4); ctx.rotate(rot); ctx.globalAlpha = shown * lf;
        ctx.fillStyle = "#f3f7fd"; ctx.strokeStyle = "rgba(70,92,126,.75)"; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-sz, -sz * b.ar); ctx.lineTo(sz * 0.9, -sz * b.ar * 0.8); ctx.lineTo(sz, sz * b.ar); ctx.lineTo(-sz * 0.8, sz * b.ar * 0.9); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.restore();
      }

      // 5. Powder cloud.
      if (shown > 0) for (let i = 0; i < C.length; i++) {
        const p = C[i], age = (ts - p.tb) / rate; if (age < 0 || age > p.life) continue;
        const s = p.sb + p.adv * (1 - Math.exp(-age / 0.55)), u = p.ub * g.W(Math.min(s, L)) * (1 + 0.35 * age);
        const z = p.Hc * (1 - Math.exp(-age / 0.45)), a = p.a * smooth(age / 0.18) * (1 - smooth((age - p.life * 0.45) / (p.life * 0.55)));
        P(s, u); const rr = Math.min(170, Math.max(6, (p.r0 + p.gr * Math.pow(age, 0.7)) * OS * 1.1));
        ctx.globalAlpha = a * fade; ctx.drawImage(S.dust[p.sp], OX - rr, OY - z * OS * up - rr, rr * 2, rr * 2);
      }

      // 6. Release: target lock, fracture line, flash and ground shock ring.
      ctx.globalAlpha = fade;
      P(0, 0); const cx0 = OX, cy0 = OY;
      if (tp < PRE + 0.1) {
        const k = smooth(tp / PRE), rr = lerp(70, 22, k), rot = tp * 2.2;
        ctx.strokeStyle = `rgba(34,211,238,${0.9 * (1 - smooth((tp - PRE) / 0.1))})`; ctx.lineWidth = 2;
        for (let q = 0; q < 4; q++) { ctx.beginPath(); ctx.arc(cx0, cy0, rr, rot + q * Math.PI / 2, rot + q * Math.PI / 2 + 0.9); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(cx0, cy0, 3, 0, 7); ctx.fillStyle = "#22d3ee"; ctx.fill();
      }
      if (tp > PRE) {
        const k = smooth((tp - PRE) / CRACK), K = g.K, half = K.length >> 1;
        const lineA = 1 - 0.55 * smooth((tp - REL - 0.4) / 0.8);
        ctx.lineJoin = "round";
        [[`rgba(150,230,255,${0.55 * lineA})`, 5], [`rgba(255,255,255,${lineA})`, 1.8]].forEach(([col, lw]) => {
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
        const ft = tp - PRE;
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

      // 7. Call-outs.
      ctx.globalAlpha = fade;
      const H0 = g.H[0];
      if (tp > PRE) { P(0, 0); callout(OX, OY, "RELEASE", `${fmt(H0)} m${o.releaseNote ? " · " + o.releaseNote : ""}`, "#22d3ee", smooth((tp - PRE) / 0.4), -1); }
      if (sFront > g.svmax + 5 && g.vmax > 5) { P(g.svmax, 0); callout(OX, OY, "PEAK SPEED", `${fmt(g.vmax)} m/s · ${fmt(g.vmax * 3.6)} km/h`, "#fbbf24", smooth((sFront - g.svmax) / (L * 0.12)), 1); }
      if (ts >= g.Tend) { P(L, 0); callout(OX, OY, "RUN-OUT", `${fmt(L * g.dk)} m · drop ${fmt(H0 - g.H[g.N - 1])} m`, "#f472b6", smooth((ts - g.Tend) / (rate * 0.5)), -1); }

      // Read-out.
      if (frameN % 3 === 0 && !fading) readout(tp, ts, sFront, vF);
      if (!finished && tp > REL + flowP + settle) {
        finished = true; resolveDone();
        if (o.hold != null) setTimeout(() => ctl.stop(), o.hold);
      }
    }
    let camMoved = false;

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
    const span = Math.max(g.L + 2 * g.w0, 600), zoom = clamp(Math.log2(40075016.686 * Math.cos(lam * D2R) * 0.8 * Math.min(hEff * 1.3, wEff) / (512 * span)), 11.2, 14.8);
    return { center: [lm, lam], zoom, pitch: o.pitch || 62, bearing: down + 180 + (o.side ?? 28) };
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const moved = (map, ms) => new Promise(r => { let t = null; const f = () => { clearTimeout(t); map.off("moveend", f); r(); }; t = setTimeout(f, ms); map.on("moveend", f); });
  const idle = (map, ms) => new Promise(r => { if (map.loaded && map.loaded()) return r(); let t = null; const f = () => { clearTimeout(t); map.off("idle", f); r(); }; t = setTimeout(f, ms); map.on("idle", f); });

  return { play, stop, prefetch, active: () => !!cur, slowmo: k => { slow = Math.max(1, +k || 1); } };
})();
window.Avalanche = Avalanche;
