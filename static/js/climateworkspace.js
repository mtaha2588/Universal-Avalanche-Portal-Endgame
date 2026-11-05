/* Climate workspace: first page of the Climate Data module (static/js/climatedata.js, styles static/css/climatedata.css, classes cw-*).
   One satellite map (home page's GL engine) carrying the ERA5-Land winter run (305 tiles x 41 winters, /api/climate/era5_winter) as a live canvas
   layer, a control panel, a yearly summary, six trend charts and one playback bar. Every colour, number and line comes from the run's own values.
   Honesty rules kept from the module: the run ends with winter 2010 (2011-2025 is stated as not supplied, never filled), 1974 is flagged estimated
   (hatched, left out of means / trends), glacier cells held at ERA5-Land's fixed snow store are marked. Two display-only blends, both stated on
   screen: "Smooth" interpolates between tile centres (the "Tiles" mode shows the raw grid) and fill colours cross-fade between winters while
   playing. Tooltips, charts and statistics always give a tile's / winter's own value. */
window.ClimateWS = (function () {
  const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = (v, d = 0) => v == null || isNaN(v) ? "—" : (+v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", "−");
  const sgn = (v, d) => (v > 0 ? "+" : v < 0 ? "−" : "±") + nf(Math.abs(v), d);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const $ = (el, s) => el.querySelector(s), $$ = (el, s) => [...el.querySelectorAll(s)];

  const KEYS = ["t2m", "snowd", "cover", "snowf", "precip", "melt"];
  const TAPE = { t2m: "Temperature", snowd: "Snow depth", snowf: "Snowfall", cover: "Snow cover", precip: "Precipitation", melt: "Snowmelt" };
  const TREND_ORDER = ["t2m", "snowd", "snowf", "cover", "precip", "melt"];
  const REGS = [{ k: "pakistan", l: "Northern Pakistan", s: "N. Pakistan", in: "in Northern Pakistan" }, { k: "Hindu_Kush", l: "Hindu Kush", s: "Hindu Kush", in: "in the Hindu Kush" },
                { k: "Karakoram", l: "Karakoram", s: "Karakoram", in: "in the Karakoram" }, { k: "Western_Himalaya", l: "Western Himalaya", s: "W. Himalaya", in: "in the Western Himalaya" }];
  // the 305 tiles span 70.5-78.0 E, 33.75-37.25 N
  const LON0 = 70.5, LON1 = 78.0, LAT0 = 33.75, LAT1 = 37.25, HALF = 0.125, GW = 30, GH = 14, HW = 600, HH = 280;
  const KX = Math.cos(35.5 * Math.PI / 180), ASP = (LON1 - LON0) * KX / (LAT1 - LAT0);
  const CAP = { snowd: 3300 };   // ERA5-Land's fixed glacier store (3,333 cm): those cells are not measured snow
  const RAMPS = {
    t2m: ["#2b0a8f", "#1a3fe0", "#0aa5e8", "#12c98a", "#8fdc2a", "#ffe11a", "#ff8a12", "#e01a12", "#8f0a0a"],
    // low to high: light = little, dark = a lot (owner's request; temperature keeps its cold-to-hot scale)
    snowd: ["#f2fbff", "#a5dbff", "#4b9bf5", "#2159bd", "#15305c"], cover: ["#f0fdff", "#7fe3f0", "#1aa3c7", "#0e5a73", "#0b2433"],
    snowf: ["#faf7ff", "#cdb8ff", "#8f5cf0", "#5b2bb0", "#1e1245"], precip: ["#f3fff6", "#a3ecb8", "#22b573", "#0f6b52", "#0b2a22"],
    melt: ["#fff4df", "#ffbd6b", "#e0701a", "#8a3a0a", "#2a1406"],
  };
  const LINE = { t2m: "#22d3ee", snowd: "#a78bfa", snowf: "#84cc16", cover: "#fb923c", precip: "#38bdf8", melt: "#f472b6" };
  const NAME = { t2m: "Air temperature (2 m)", snowd: "Snow depth", cover: "Snow cover", snowf: "Snowfall (seasonal total)", precip: "Precipitation (seasonal total)", melt: "Snowmelt (seasonal total)" };
  const TAB = { t2m: "Temperature", snowd: "Snow Depth", cover: "Snow Cover", snowf: "Snowfall", precip: "Precipitation", melt: "Snowmelt" };
  const SPEEDS = [1, 2, 4, 8];
  const RANGES = [[1970, 2010], [1970, 1979], [1980, 1989], [1990, 1999], [2000, 2010]];
  const PLACES = [["AFGHANISTAN", 70.15, 35.75], ["CHINA", 77.55, 37.42], ["NORTHERN PAKISTAN", 73.4, 34.95]];
  const CONTEXT = [["Khyber Pakhtunkhwa", 70.9, 32.75], ["Punjab", 72.27, 30.87], ["Balochistan", 65.66, 28.48], ["Sindh", 68.76, 26.15], ["IRAN", 59.4, 29.4], ["INDIA", 76.6, 29.6]];
  const IIOJK = "Indian Illegally Occupied Jammu &amp; Kashmir";
  const VIEW_N = [[LON0 - .75, LAT0 - .6], [LON1 + .55, LAT1 + .25]], VIEW_PK = [[60.4, 23.4], [80.2, 37.5]];
  const dirCol = (v, x) => v === "t2m" ? (x > 0 ? "#f87171" : "#60a5fa") : (x > 0 ? "#2dd4bf" : "#d8b365");   // warming red / cooling blue, more teal / less sand

  const ic = (p, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const SNOW = '<path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17M12 6l-2.5-2M12 6l2.5-2M12 18l-2.5 2M12 18l2.5 2"/>';
  const ICON = { t2m: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>', snowd: SNOW, cover: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    snowf: '<path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5A3.3 3.3 0 0 1 17.5 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01"/>', precip: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.500 10 12 3 12 3z"/>', melt: '<path d="M3 9c3-3 5 3 9 0s6 3 9 0M3 15c3-3 5 3 9 0s6 3 9 0"/>' };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function lut(stops) {
    const css = [], u32 = new Uint32Array(256);
    for (let k = 0; k < 256; k++) { const t = k / 255 * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(t)), f = t - i, a = hex(stops[i]), b = hex(stops[i + 1]), c = a.map((x, j) => Math.round(x + (b[j] - x) * f));
      css.push(`rgb(${c.join(",")})`); u32[k] = (c[2] << 16) | (c[1] << 8) | c[0]; }
    return { css, u32 };
  }
  const niceStep = s => { const p = Math.pow(10, Math.floor(Math.log10(s))), f = s / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const YT = merc(LAT1), YB = merc(LAT0);

  let W = null;

  function html() { return `<div class="cw" id="cw" tabindex="-1"><p class="desc cw-load">Loading the winter climate run…</p></div>`; }
  function fail(root, msg) { const el = root && $(root, "#cw"); if (el) el.innerHTML = `<p class="desc cw-load">The climate workspace needs the portal server and an imported run (scripts/build_era5_winter.py). ${esc(msg || "")}</p>`; }

  /* ------------------------------------------------------------------ start / stop */
  function start(root, d) {
    const el = $(root, "#cw"); if (!el) return;
    destroy();
    const Y = d.meta.years, N = Y.length, EST = d.meta.estimated, tiles = d.tiles, VARS = Object.fromEntries(d.meta.vars.map(v => [v.key, v]));
    W = { root, el, d, Y, N, EST, tiles, VARS, pos: 0, yi: 0, playing: false, speed: 1, v: "t2m", r: "pakistan", hover: -1, pin: -1, lo: 0, hi: N - 1, mode: "smooth", six: false, tab: "trends",
          panels: {}, vals: {}, sc: {}, geo: null, raf: 0, last: 0, charts: {}, ro: null, mo: [], map: null, gl: null, heatKey: "", fb: null };
    // value of tile ti in winter yi = vals[v][ti * N + yi]
    KEYS.forEach(v => { const a = new Float32Array(tiles.length * N); tiles.forEach((t, ti) => t.v[v].forEach((x, yi) => { a[ti * N + yi] = x; })); W.vals[v] = a; W.sc[v] = scale(v); });
    W.cell = new Map(tiles.map((t, ti) => [Math.round((t.lat - 33.875) / .25) + "," + Math.round((t.lon - 70.625) / .25), ti]));
    build(); wire(); prepareHeat();
    const me = W;
    W.ro = new ResizeObserver(() => { if (W !== me) return; layoutAll(); if (me.map) me.map.resize(); requestDraw(); });
    W.ro.observe($(el, ".cw-mapwrap"));
    // the window is re-rendered on every open: the map and observers go with it
    const win = document.getElementById("win"), body = document.getElementById("win-body");
    const gone = () => { if (W === me && (!document.body.contains(el) || (win && !win.classList.contains("open")))) destroy(); };
    if (win) { const a = new MutationObserver(gone); a.observe(win, { attributes: true, attributeFilter: ["class"] }); W.mo.push(a); }
    if (body) { const b = new MutationObserver(gone); b.observe(body, { childList: true }); W.mo.push(b); }
    fetchGeo().then(() => { if (W !== me) return; buildMask(); W.heatKey = ""; startMap(); layoutAll(); requestDraw(); });
    syncStats(); layoutAll(); requestDraw();
    W.auto = true; resume();   // loops from the moment the page opens; the pause icon stops it
  }
  function resume() { if (W && W.auto && !W.playing && W.el.getClientRects().length && !matchMedia("(prefers-reduced-motion: reduce)").matches) play(); }
  function destroy() {
    if (!W) return;
    if (W.raf) cancelAnimationFrame(W.raf);
    W.playing = false; if (W.ro) W.ro.disconnect(); W.mo.forEach(m => m.disconnect());
    if (W.map) try { W.map.remove(); } catch { /* already gone */ }
    W = null;
  }

  // colour scale of one variable, fixed over all winters (1-99 % of the observed winters), glacier-store cells left out of the snow-depth range
  function scale(v) {
    const xs = [], a = W.vals[v], N = W.N;
    W.tiles.forEach((_, ti) => { for (let yi = 0; yi < N; yi++) { if (W.EST[yi]) continue; const x = a[ti * N + yi]; if (CAP[v] && x >= CAP[v]) continue; xs.push(x); } });
    xs.sort((p, q) => p - q);
    const q = p => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    let lo = q(.01), hi = q(.99);
    if (v === "cover") { lo = 0; hi = 100; } else if (v !== "t2m") lo = Math.min(lo, 0);
    if (hi <= lo) hi = lo + 1;
    const L = lut(RAMPS[v]), k = 255 / (hi - lo);
    return { lo, hi, stops: RAMPS[v], u32: L.u32, k, at: x => L.css[Math.round(clamp((x - lo) * k, 0, 255))] };
  }

  async function fetchGeo() {
    const me = W;
    try {
      const g = await fetch("/api/layer/boundaries").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const rings = [], prov = [], lines = [], fc = g.features || [];
      fc.forEach(f => { const p = f.properties || {}, gm = f.geometry; if (!gm) return;
        const polys = gm.type === "Polygon" ? [gm.coordinates] : gm.type === "MultiPolygon" ? gm.coordinates : [];
        if (p.layer === "pakistan") polys.forEach(pl => pl.forEach(r => rings.push(r)));
        else if (p.layer === "province") polys.forEach(pl => pl.forEach(r => prov.push(r)));
        else if (p.layer === "line") (gm.type === "LineString" ? [gm.coordinates] : gm.type === "MultiLineString" ? gm.coordinates : []).forEach(l => lines.push(l));
      });
      if (W === me) W.geo = { rings, prov, lines, fc };
    } catch { if (W === me) W.geo = null; }
  }

  /* ------------------------------------------------------------------ markup */
  function build() {
    const { el, Y, N } = W, V = k => W.VARS[k], dims = [new Set(W.tiles.map(t => t.lon)).size, new Set(W.tiles.map(t => t.lat)).size];
    const pct = y => (y - Y[0]) / (Y[N - 1] - Y[0]) * 100;
    el.innerHTML = `
    <aside class="cw-ctl" aria-label="Data control">
      <h3>${ic('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6"/>', 22)}Data Control</h3>
      <div class="cw-f"><label>Dataset</label><div class="cw-ro">${ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 16)}<span>ERA5-Land winter run</span></div>
        <p class="cw-ok"><i></i>Loaded · ${W.tiles.length} tiles × ${N} winters</p></div>
      <div class="cw-f"><label>${ic('<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>', 15)}Variable selection</label><select data-sv aria-label="Variable">${KEYS.map(k => `<option value="${k}">${esc(NAME[k])}</option>`).join("")}</select></div>
      <div class="cw-f"><label>${ic('<path d="M3 20l6-11 4 6 3-4 5 9z"/>', 15)}Statistics for</label><select data-sr aria-label="Statistics region">${REGS.map(r => `<option value="${r.k}">${esc(r.l)}</option>`).join("")}</select></div>
      <div class="cw-f"><label>${ic('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>', 15)}Dimensions</label>
        <div class="cw-dims"><div><small>X · Lon</small><b>${dims[0]}</b></div><div><small>Y · Lat</small><b>${dims[1]}</b></div><div><small>Time</small><b>${N}</b></div><div><small>Cell</small><b>0.25°</b></div></div></div>
      <div class="cw-f"><label>${ic('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', 15)}Map display</label>
        <div class="cw-seg" role="group" aria-label="Map display"><button type="button" data-mode="smooth" class="on" title="Interpolated between tile centres, for display only">Smooth</button><button type="button" data-mode="tiles" title="The run's own 25 km grid">Tiles</button></div></div>
      <div class="cw-f"><label>${ic('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.500 2M9 2h6"/>', 15)}Time slider</label>
        <div class="cw-rng"><input type="range" data-slider min="0" max="${N - 1}" step="any" value="0" aria-label="Winter"></div><div class="cw-ends"><span>${Y[0]}</span><span>${Y[N - 1]}</span></div></div>
      <button type="button" class="cw-playbig" data-tl="play"><span data-pi>▶</span><b data-pl>Play Animation</b></button>
      <div class="cw-f"><label>${ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 15)}Quick select dates</label>
        <div class="cw-rowa"><select data-range aria-label="Date range">${RANGES.map((r, i) => `<option value="${i}">${r[0]} – ${r[1]}</option>`).join("")}</select><button type="button" class="cw-apply" data-apply>Apply</button></div></div>
      <p class="cw-src">Reanalysis (a model of past weather), not station measurements. The run ends with winter 2010.</p>
    </aside>

    <section class="cw-mapcol">
      <div class="cw-tabs" role="tablist" aria-label="Climate layer">${KEYS.map(k => `<button type="button" role="tab" data-ly="${k}" class="${k === W.v ? "on" : ""}">${ic(ICON[k], 17)}${TAB[k]}</button>`).join("")}
        <button type="button" class="cw-six-b" data-six aria-pressed="false">${ic('<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>', 16)}All six</button>
        <button type="button" class="cw-full-b" data-full aria-pressed="false"><span>View Full Map</span>${ic('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>', 15)}</button></div>
      <div class="cw-mapwrap">
        <div class="cw-gl" id="cw-gl"></div>
        <div class="cw-fallback" hidden><canvas></canvas></div>
        <div class="cw-lgv" aria-label="Colour scale"><b data-lgt></b><i data-lgb></i><div data-lgl></div></div>
        <div class="cw-mtag"><b data-mt></b><span data-mn></span></div>
        <span class="cw-est" hidden>1974 · estimated in the run</span>
        <div class="cw-tip" hidden></div>
        <div class="cw-sixg" hidden>${KEYS.map(k => `<figure class="cw-p" data-p="${k}"><header><b>${TAB[k]}</b><strong data-pv>—</strong><em>${esc(V(k).unit)}</em><span data-pd></span></header><div class="cw-cv"><canvas></canvas><div class="cw-tip" hidden></div></div><div class="cw-lg"><span data-lo></span><i style="background:linear-gradient(90deg,${W.sc[k].stops.join(",")})"></i><span data-hi></span></div></figure>`).join("")}</div>
      </div>
    </section>

    <aside class="cw-sum">
      <div class="cw-card cw-ys"><header><h3>${ic('<path d="M5 20v-8M12 20V5M19 20v-5"/>', 22)}Yearly Summary</h3><div class="cw-step"><button type="button" data-tl="prev" aria-label="Previous winter">‹</button><b data-yr></b><button type="button" data-tl="next" aria-label="Next winter">›</button></div></header><div class="cw-rows"></div></div>
      <div class="cw-card cw-ins"><h4>${ic('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.500 10.900c.6.500 1 1.200 1 2.100h5c0-.900.400-1.600 1-2.100A6 6 0 0 0 12 3z"/>', 17)}Key Insights</h4><p data-ins></p></div>
    </aside>

    <section class="cw-low">
      <div class="cw-ltabs" role="tablist">${[["trends", "Historical Trends", '<path d="M4 19V5M4 19h16M7.500 15l3.500-4.500 3 2.500 5-6.500"/>'], ["spatial", "Spatial Analysis", '<circle cx="7" cy="17" r="2.500"/><circle cx="17" cy="16" r="2.500"/><circle cx="12" cy="7" r="2.500"/>'], ["stats", "Statistics", '<path d="M5 20v-8M12 20V5M19 20v-5"/>'], ["data", "Data Explorer", '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>']].map(t => `<button type="button" role="tab" data-lt="${t[0]}" class="${t[0] === W.tab ? "on" : ""}">${ic(t[2], 16)}${t[1]}</button>`).join("")}
        <div class="cw-tape" aria-hidden="true"><span class="lv"><i></i><b data-ty></b><small>change from the previous winter</small></span><div class="tw"><div class="tr" data-tr></div></div></div><span class="cw-ltnote" data-ltn></span></div>
      <div class="cw-lp" data-lp="trends"><div class="cw-charts">${TREND_ORDER.map(k => `<article class="cw-ch" data-cv="${k}" style="--lc:${LINE[k]}"><header>${ic(ICON[k], 15)}<b>${TAB[k]}<span> Trend</span></b><em>${esc(V(k).unit)}</em></header><div class="cw-chs"><div class="cw-tip" hidden></div></div></article>`).join("")}</div></div>
      <div class="cw-lp" data-lp="spatial" hidden></div>
      <div class="cw-lp" data-lp="stats" hidden></div>
      <div class="cw-lp" data-lp="data" hidden></div>
    </section>

    <div class="cw-pb" role="group" aria-label="Playback">
      <button type="button" class="cw-rb" data-tl="prev" aria-label="Previous winter" title="Previous winter (←)">${ic('<path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z" fill="currentColor"/>')}</button>
      <button type="button" class="cw-rb pp" data-tl="play" aria-label="Play" title="Play / pause (space)"><span data-pi>▶</span></button>
      <button type="button" class="cw-rb" data-tl="next" aria-label="Next winter" title="Next winter (→)">${ic('<path d="M13 6l7 6-7 6zM4 6l7 6-7 6z" fill="currentColor"/>')}</button>
      <label class="cw-spd">Speed <select data-speed aria-label="Winters per second">${SPEEDS.map(s => `<option value="${s}"${s === W.speed ? " selected" : ""}>${s}×</option>`).join("")}</select></label>
      <div class="cw-pbt"><div class="cw-rng"><input type="range" data-slider min="0" max="${N - 1}" step="any" value="0" aria-label="Winter"><i class="cw-e" style="left:${pct(1974)}%" title="1974: estimated in the run"></i></div>
        <div class="cw-ticks">${[1970, 1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010].map(y => y % 10 ? `<button type="button" class="yd" data-jy="${y}" style="left:${pct(y)}%" aria-label="Winter ${y}" title="${y}"></button>` : `<button type="button" data-jy="${y}" style="left:${pct(y)}%">${y}</button>`).join("")}</div></div>
      <div class="cw-now"><b><span data-year></span> <em>/ ${Y[N - 1]}</em></b><small data-ysub></small></div>
      <label class="cw-go">${ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 16)}Go to Year<input type="number" min="${Y[0]}" max="${Y[N - 1]}" step="1" value="${Y[0]}" aria-label="Jump to winter"></label>
    </div>`;
    KEYS.forEach(k => { const p = $(el, `.cw-p[data-p="${k}"]`), cv = $(p, "canvas"), sc = W.sc[k], dec = V(k).decimals ?? 1;
      W.panels[k] = { v: k, cv, ctx: cv.getContext("2d"), wrap: $(p, ".cw-cv"), tip: $(p, ".cw-tip"), key: "" };
      $(p, "[data-lo]").textContent = nf(sc.lo, dec); $(p, "[data-hi]").textContent = nf(sc.hi, dec) + " " + V(k).unit; });
    const fb = $(el, ".cw-fallback canvas");
    W.fb = { v: W.v, cv: fb, ctx: fb.getContext("2d"), wrap: $(el, ".cw-fallback"), tip: $(el, ".cw-mapwrap > .cw-tip"), big: true, key: "" };
    legend(); buildCharts();
  }

  function legend() {
    const { el, v } = W, sc = W.sc[v], m = W.VARS[v], step = niceStep((sc.hi - sc.lo) / 4), lab = [];
    for (let t = Math.ceil(sc.lo / step) * step; t <= sc.hi + 1e-9; t += step) lab.push(t + 0);
    $(el, "[data-lgt]").textContent = m.unit;
    $(el, "[data-lgb]").style.background = `linear-gradient(0deg,${sc.stops.join(",")})`;
    $(el, "[data-lgl]").innerHTML = lab.map(t => `<span style="bottom:${(t - sc.lo) / (sc.hi - sc.lo) * 100}%">${nf(t, step < 1 ? 1 : 0)}</span>`).join("");
    $(el, "[data-mt]").textContent = NAME[v];
    $(el, "[data-mn]").textContent = (CAP[v] ? "Dotted: glacier store, not measured snow · " : "") + (W.mode === "smooth" ? "Smoothed between 25 km tiles for display · hover for a tile's value" : "The run's own 25 km tiles");
    $(el, "[data-sv]").value = v;
    $$(el, "[data-ly]").forEach(b => { b.classList.toggle("on", b.dataset.ly === v); b.setAttribute("aria-selected", b.dataset.ly === v); });
    $$(el, ".cw-p").forEach(p => p.classList.toggle("sel", p.dataset.p === v));
    $$(el, ".cw-ch").forEach(p => p.classList.toggle("sel", p.dataset.cv === v));
  }

  /* ------------------------------------------------------------------ interaction */
  function wire() {
    const { el } = W;
    $(el, "[data-sv]").onchange = e => setVar(e.target.value);
    $(el, "[data-sr]").onchange = e => { W.r = e.target.value; syncStats(); buildCharts(); };
    $$(el, "[data-ly]").forEach(b => b.onclick = () => { setSix(false); setVar(b.dataset.ly); });
    $$(el, "[data-mode]").forEach(b => b.onclick = () => { W.mode = b.dataset.mode; $$(el, "[data-mode]").forEach(x => x.classList.toggle("on", x === b)); W.heatKey = ""; legend(); requestDraw(); });
    $(el, "[data-six]").onclick = () => setSix(!W.six);
    $(el, "[data-full]").onclick = () => setFull(!el.classList.contains("mapfull"));
    $$(el, "[data-lt]").forEach(b => b.onclick = () => { W.tab = b.dataset.lt; $$(el, "[data-lt]").forEach(x => x.classList.toggle("on", x === b)); $$(el, "[data-lp]").forEach(p => { p.hidden = p.dataset.lp !== W.tab; }); renderLower(); });
    $$(el, ".cw-p").forEach(p => { const k = p.dataset.p, P = W.panels[k]; canvasEvents(P, k);
      p.addEventListener("click", () => { setVar(k); setSix(false); }); });
    canvasEvents(W.fb, null);
    $$(el, "[data-tl]").forEach(b => b.onclick = () => { const a = b.dataset.tl;
      if (a === "play") return W.playing ? stop() : play();
      stop(); setPos(Math.round(W.pos) + (a === "next" ? 1 : -1)); });
    $(el, "[data-speed]").onchange = e => { W.speed = +e.target.value; };
    $$(el, "[data-jy]").forEach(b => b.onclick = () => { stop(); setPos(+b.dataset.jy - W.Y[0]); });
    $$(el, "[data-slider]").forEach(s => { s.oninput = () => { stop(); setPos(parseFloat(s.value)); }; s.onchange = () => setPos(Math.round(parseFloat(s.value))); });
    $(el, "[data-apply]").onclick = () => { const r = RANGES[+$(el, "[data-range]").value]; W.lo = r[0] - W.Y[0]; W.hi = r[1] - W.Y[0]; stop(); setPos(W.lo); syncStats(); };
    const goIn = $(el, ".cw-go input");
    const jump = () => { const y = Math.round(+goIn.value); if (!(y >= W.Y[0] && y <= W.Y[W.N - 1])) { goIn.classList.add("bad"); return; } goIn.classList.remove("bad"); stop(); setPos(y - W.Y[0]); };
    goIn.onchange = jump; goIn.onkeydown = e => { if (e.key === "Enter") jump(); e.stopPropagation(); };
    el.addEventListener("keydown", e => {
      if (e.target.matches("input[type=number], select")) return;
      if (e.key === "Escape" && el.classList.contains("mapfull")) { setFull(false); e.stopPropagation(); return; }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); stop(); setPos(Math.round(W.pos) + (e.key === "ArrowRight" ? 1 : -1)); }
      else if (e.key === " " && !e.target.matches("button")) { e.preventDefault(); W.playing ? stop() : play(); }
    });
  }
  function setFull(on) {
    const { el, root } = W; el.classList.toggle("mapfull", on); root.classList.toggle("mapfull", on);
    const b = $(el, "[data-full]"); b.setAttribute("aria-pressed", on); $(b, "span").textContent = on ? "Exit Full Map" : "View Full Map";
    layoutAll(); if (W.map) W.map.resize(); requestDraw();
  }
  function setSix(on) {
    W.six = on; const { el } = W; $(el, ".cw-sixg").hidden = !on;
    const b = $(el, "[data-six]"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
    $(el, ".cw-lgv").hidden = on; $(el, ".cw-mtag").hidden = on; $$(el, "[data-ly]").forEach(x => x.classList.toggle("dim", on));
    layoutAll(); requestDraw();
  }
  function setVar(k) {
    W.v = k; W.fb.v = k; W.fb.key = ""; W.heatKey = ""; legend(); renderSummary(); renderLower(); requestDraw();
  }
  const tileAt = (lon, lat) => { const ti = W.cell.get(Math.round((lat - 33.875) / .25) + "," + Math.round((lon - 70.625) / .25)); return ti == null ? -1 : ti; };
  function setHover(ti) { if (ti !== W.hover) { W.hover = ti; selSync(); if (W.tab === "spatial") renderLower(); if (W.six) requestDraw(); } }
  function setPin(ti) { W.pin = ti === W.pin ? -1 : ti; selSync(); if (W.tab === "spatial") renderLower(); requestDraw(); }
  function tipHtml(ti, v) {
    const t = W.tiles[ti], m = W.VARS[v], x = W.vals[v][ti * W.N + W.yi];
    return `<b>Tile ${esc(t.id.replace("_", " "))}</b><span>${esc(TAB[v])} · winter ${W.Y[W.yi]}${W.EST[W.yi] ? " (estimated)" : ""}<strong>${nf(x, m.decimals ?? 1)} ${esc(m.unit)}</strong></span>${CAP[v] && x >= CAP[v] ? '<small class="warn">Glacier cell at ERA5-Land\'s fixed snow store, not measured snow</small>' : ""}<small>Click to pin · details in Spatial Analysis</small>`;
  }
  function placeTip(tip, wrap, x, y) { const r = wrap.getBoundingClientRect(); tip.style.left = clamp(x + 14, 0, r.width - 230) + "px"; tip.style.top = clamp(y - 18, 0, r.height - 90) + "px"; }
  function canvasEvents(P, varKey) {
    const at = e => { const r = P.cv.getBoundingClientRect(); return tileAt(LON0 + (e.clientX - r.left) / r.width * (LON1 - LON0), LAT1 - (e.clientY - r.top) / r.height * (LAT1 - LAT0)); };
    P.cv.addEventListener("mousemove", e => { const ti = at(e), r = P.wrap.getBoundingClientRect(); setHover(ti);
      if (ti < 0) { P.tip.hidden = true; return; } P.tip.innerHTML = tipHtml(ti, P.v); P.tip.hidden = false; placeTip(P.tip, P.wrap, e.clientX - r.left, e.clientY - r.top); });
    P.cv.addEventListener("mouseleave", () => { P.tip.hidden = true; setHover(-1); });
    if (!varKey) P.cv.addEventListener("click", e => setPin(at(e)));
  }

  /* ------------------------------------------------------------------ timeline */
  function setPos(p) {
    W.pos = clamp(p, 0, W.N - 1);
    const yi = Math.round(W.pos); $$(W.el, "[data-slider]").forEach(s => { s.value = W.pos; s.style.setProperty("--p", (W.pos / (W.N - 1) * 100) + "%"); });
    if (yi !== W.yi) { W.yi = yi; syncStats(); }
    requestDraw();
  }
  function play() { if (W.pos >= W.hi - 1e-6 || W.pos < W.lo) setPos(W.lo); W.playing = true; W.hold = 0; W.last = performance.now(); setPlayBtn(); W.el.classList.add("live"); W.tapeY = null; markCharts(); requestDraw(); }
  function stop() { if (!W) return; W.auto = false; W.playing = false; setPlayBtn(); W.el.classList.remove("live"); TREND_ORDER.forEach(v => { const c = W.charts[v]; if (c) $(c.svg, ".clp").setAttribute("width", c.Wd); }); markCharts(); }
  function setPlayBtn() {
    $$(W.el, "[data-pi]").forEach(i => { i.textContent = W.playing ? "❚❚" : "▶"; });
    $(W.el, "[data-pl]").textContent = W.playing ? "Pause Animation" : "Play Animation";
    $$(W.el, '[data-tl="play"]').forEach(b => { b.classList.toggle("on", W.playing); b.setAttribute("aria-label", W.playing ? "Pause" : "Play"); });
  }
  function requestDraw() { if (!W || W.raf) return; W.raf = requestAnimationFrame(frame); }
  function frame(ts) {
    if (!W) return; W.raf = 0;
    if (!W.el.getClientRects().length) { if (W.playing) { stop(); W.auto = true; } return; }   // view hidden: it carries on when shown again
    if (W.playing) {
      const dt = Math.min(100, ts - W.last) / 1000; W.last = ts;
      const np = W.pos + W.speed * dt;
      if (W.hold > 0) { W.hold -= dt; if (W.hold <= 0) { W.hold = 0; setPos(W.lo); } }
      else if (np >= W.hi) { setPos(W.hi); W.hold = 1; } else setPos(np);
    }
    if (W.playing) liveCharts();
    if (W.six) KEYS.forEach(k => drawPanel(W.panels[k]));
    else { drawHeat(); if (!W.fb.wrap.hidden) drawPanel(W.fb); }
    const est = W.EST[W.yi]; $(W.el, ".cw-mapwrap > .cw-est").hidden = !est;
    if (W.playing) requestDraw();
  }

  /* ------------------------------------------------------------------ the live map layer: a canvas source on the GL map */
  function prepareHeat() {
    const col0 = new Int16Array(HW), colF = new Float32Array(HW), colN = new Int16Array(HW), row0 = new Int16Array(HH), rowF = new Float32Array(HH), rowN = new Int16Array(HH);
    for (let x = 0; x < HW; x++) { const g = (LON0 + (x + .5) / HW * (LON1 - LON0) - 70.625) / .25, c = Math.floor(g); col0[x] = clamp(c, -1, GW - 1); colF[x] = g - c; colN[x] = clamp(Math.round(g), 0, GW - 1); }
    for (let y = 0; y < HH; y++) { const m = YT - (y + .5) / HH * (YT - YB), lat = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI, g = (lat - 33.875) / .25, r = Math.floor(g); row0[y] = clamp(r, -1, GH - 1); rowF[y] = g - r; rowN[y] = clamp(Math.round(g), 0, GH - 1); }
    const cv = document.createElement("canvas"); cv.width = HW; cv.height = HH;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(HW, HH);
    const cell = new Int32Array(GW * GH).fill(-1); W.tiles.forEach((t, ti) => { cell[Math.round((t.lat - 33.875) / .25) * GW + Math.round((t.lon - 70.625) / .25)] = ti; });
    W.heat = { cv, ctx, img, px: new Uint32Array(img.data.buffer), V: new Float32Array((GW + 2) * (GH + 2)), mask: new Uint8Array(HW * HH).fill(255), col0, colF, colN, row0, rowF, rowN, cell, hatch: patt(ctx, "est"), dots: patt(ctx, "dots") };
  }
  const hx = lon => (lon - LON0) / (LON1 - LON0) * HW, hy = lat => (YT - merc(lat)) / (YT - YB) * HH;
  function buildMask() {
    if (!W.geo || !W.geo.rings.length) return;
    const c = document.createElement("canvas"); c.width = HW; c.height = HH; const x = c.getContext("2d", { willReadFrequently: true }), p = new Path2D();
    W.geo.rings.forEach(r => { r.forEach((q, i) => i ? p.lineTo(hx(q[0]), hy(q[1])) : p.moveTo(hx(q[0]), hy(q[1]))); p.closePath(); });
    x.fillStyle = "#fff"; x.fill(p, "evenodd");
    const d = x.getImageData(0, 0, HW, HH).data, m = W.heat.mask; for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
  }
  function drawHeat() {
    const H = W.heat, v = W.v, key = v + "|" + W.pos + "|" + W.mode + "|" + W.yi; if (key === W.heatKey) return; W.heatKey = key;
    const a = W.vals[v], N = W.N, sc = W.sc[v], i0 = Math.min(N - 1, Math.floor(W.pos)), i1 = Math.min(N - 1, i0 + 1), f = W.pos - i0, V = H.V, GP = GW + 2, smooth = W.mode === "smooth";
    V.fill(NaN);
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) { const ti = H.cell[r * GW + c]; if (ti >= 0) { const o = ti * N; V[(r + 1) * GP + c + 1] = a[o + i0] + (a[o + i1] - a[o + i0]) * f; } }
    const { px, mask, col0, colF, colN, row0, rowF, rowN } = H, U = sc.u32, k = sc.k, lo = sc.lo;
    for (let y = 0, q = 0; y < HH; y++) {
      const r0 = (row0[y] + 1) * GP, r1 = r0 + GP, fy = rowF[y], rn = (rowN[y] + 1) * GP;
      for (let x = 0; x < HW; x++, q++) {
        const al = mask[q]; if (!al) { px[q] = 0; continue; }
        let val;
        if (smooth) {
          const c = col0[x] + 1, fx = colF[x], v00 = V[r0 + c], v10 = V[r0 + c + 1], v01 = V[r1 + c], v11 = V[r1 + c + 1];
          let w = 0, s = 0, g;
          g = (1 - fx) * (1 - fy); if (v00 === v00) { w += g; s += g * v00; }
          g = fx * (1 - fy); if (v10 === v10) { w += g; s += g * v10; }
          g = (1 - fx) * fy; if (v01 === v01) { w += g; s += g * v01; }
          g = fx * fy; if (v11 === v11) { w += g; s += g * v11; }
          if (!w) { px[q] = 0; continue; } val = s / w;
        } else { val = V[rn + colN[x] + 1]; if (val !== val) { px[q] = 0; continue; } }
        let t = (val - lo) * k; t = t < 0 ? 0 : t > 255 ? 255 : t + .5 | 0;
        px[q] = ((al << 24) | U[t]) >>> 0;
      }
    }
    const ctx = H.ctx; ctx.putImageData(H.img, 0, 0);
    if (CAP[v] || W.EST[W.yi]) { ctx.save(); ctx.globalCompositeOperation = "source-atop";
      if (CAP[v]) { ctx.fillStyle = H.dots; W.tiles.forEach((t, ti) => { if (a[ti * N + W.yi] >= CAP[v]) { const x = hx(t.lon - HALF), y = hy(t.lat + HALF); ctx.fillRect(x, y, hx(t.lon + HALF) - x, hy(t.lat - HALF) - y); } }); }
      if (W.EST[W.yi]) { ctx.fillStyle = H.hatch; ctx.fillRect(0, 0, HW, HH); }
      ctx.restore(); }
    if (W.src) { W.src.play(); clearTimeout(W.srcT); W.srcT = setTimeout(() => { if (W && W.src) W.src.pause(); }, 160); }
  }

  async function loadEngine() {
    let Lb = typeof bgMap !== "undefined" && bgMap.lib ? bgMap.lib() : null;
    if (!Lb) {
      if (!window.maplibregl) {
        const c = document.createElement("link"); c.rel = "stylesheet"; c.href = "/static/vendor/maplibre-gl.css"; document.head.appendChild(c);
        await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/static/vendor/maplibre-gl.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      }
      Lb = { gl: window.maplibregl, engine: "maplibre" };
    }
    return Lb;
  }
  async function startMap() {
    const me = W;
    try {
      const { gl, engine } = await loadEngine(); if (W !== me) return;
      if (window.MapPerf) MapPerf.tune(gl);
      const grade = { "raster-saturation": -0.45, "raster-brightness-max": 0.62, "raster-contrast": 0.08 };
      const style = engine === "mapbox" ? "mapbox://styles/mapbox/satellite-v9" : { version: 8,
        sources: { sat: { type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
        layers: [{ id: "cw-ground", type: "background", paint: { "background-color": "#0a1424" } }, { id: "sat", type: "raster", source: "sat", paint: grade }] };
      const o = { container: "cw-gl", style, bounds: VIEW_N, minZoom: 3.4, maxZoom: 11, maxBounds: [[50, 16], [92, 44]], pitchWithRotate: false, dragRotate: false, attributionControl: false, fadeDuration: 0 };
      const map = new gl.Map(Object.assign(window.MapPerf ? MapPerf.opts(o) : o, { pixelRatio: Math.min(window.devicePixelRatio || 1, 2) }));
      W.map = map; W.gl = gl;
      map.addControl(new gl.NavigationControl({ showCompass: true }), "top-left");
      map.addControl(new gl.ScaleControl({ maxWidth: 130, unit: "metric" }), "bottom-left");
      map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
      await new Promise((res, rej) => { map.once("load", res); map.on("error", ev => { const s = ev.error && ev.error.status; if (!map.loaded() && (s === 401 || s === 403)) rej(ev.error); }); setTimeout(() => rej(new Error("map timeout")), 45000); });
      if (W !== me) return;
      if (engine === "mapbox") try { Object.entries(grade).forEach(([k, v]) => map.setPaintProperty("satellite", k, v)); } catch { /* layer id differs */ }
      const H = W.heat;
      map.addSource("cw-heat", { type: "canvas", canvas: H.cv, animate: true, coordinates: [[LON0, LAT1], [LON1, LAT1], [LON1, LAT0], [LON0, LAT0]] });
      W.src = map.getSource("cw-heat");
      map.addLayer({ id: "cw-heat", type: "raster", source: "cw-heat", paint: { "raster-opacity": .9, "raster-fade-duration": 0, "raster-resampling": "linear" } });
      try { // the mountains read through the colours
        map.addSource("cw-shade", window.MapPerf ? MapPerf.dem() : { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12, tiles: [location.origin + "/api/dem/{z}/{x}/{y}.png?v=cop1"] });
        map.addLayer({ id: "cw-relief", type: "hillshade", source: "cw-shade", paint: { "hillshade-exaggeration": .55, "hillshade-illumination-direction": 315, "hillshade-shadow-color": "rgba(0,0,0,.62)", "hillshade-highlight-color": "rgba(255,255,255,.2)", "hillshade-accent-color": "rgba(0,0,0,.28)" } });
      } catch { /* engine without hillshade */ }
      if (W.geo) {
        map.addSource("cw-bnd", { type: "geojson", data: { type: "FeatureCollection", features: W.geo.fc } });
        const isL = v => ["==", ["get", "layer"], v];
        // context only, quieter the further from the study: the rest of Pakistan a little, neighbouring countries more (same official view as the front page)
        map.addLayer({ id: "cw-dim", type: "fill", source: "cw-bnd", filter: isL("pakistan"), paint: { "fill-color": "#020617", "fill-opacity": .34 } }, "cw-heat");
        const off = await fetch("/static/geo/official_view.geojson").then(r => r.ok ? r.json() : null).catch(() => null);
        if (W !== me) return;
        if (off) { map.addSource("cw-off", { type: "geojson", data: off }); map.addLayer({ id: "cw-mask", type: "fill", source: "cw-off", filter: isL("mask"), paint: { "fill-color": "#020617", "fill-opacity": .66 } });
          map.addLayer({ id: "cw-iiojk", type: "fill", source: "cw-off", filter: isL("iiojk"), paint: { "fill-opacity": 0 } }); }
        map.addLayer({ id: "cw-ctx", type: "fill", source: "cw-bnd", filter: isL("province"), paint: { "fill-opacity": 0 } });
        map.addLayer({ id: "cw-ctxhl", type: "line", source: "cw-bnd", filter: ["==", ["get", "name"], ""], paint: { "line-color": "#bae6fd", "line-width": 1.6, "line-opacity": .8 } });
        map.addLayer({ id: "cw-prov", type: "line", source: "cw-bnd", filter: isL("province"), paint: { "line-color": "#ffffff", "line-opacity": .55, "line-width": .9 } });
        map.addLayer({ id: "cw-loc", type: "line", source: "cw-bnd", filter: isL("line"), paint: { "line-color": "#fbbf24", "line-width": 1.2, "line-dasharray": [3, 2] } });
        map.addLayer({ id: "cw-glow", type: "line", source: "cw-bnd", filter: isL("pakistan"), paint: { "line-color": "#67e8f9", "line-opacity": .3, "line-width": 5, "line-blur": 3 } });
        map.addLayer({ id: "cw-out", type: "line", source: "cw-bnd", filter: isL("pakistan"), paint: { "line-color": "#f0fbff", "line-width": 1.5 } });
      }
      map.addSource("cw-sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "cw-sel", type: "line", source: "cw-sel", paint: { "line-color": ["get", "c"], "line-width": 2.2 } });
      const placed = {}; PLACES.forEach(([n, lon, lat]) => { const e = document.createElement("span"); e.className = "cw-place" + (n.includes("PAKISTAN") ? " main" : ""); e.textContent = n; placed[n] = new gl.Marker({ element: e }).setLngLat([lon, lat]).addTo(map); });
      CONTEXT.forEach(([n, lon, lat]) => { const e = document.createElement("span"); e.className = "cw-place ctx" + (n === n.toUpperCase() ? " far" : ""); e.textContent = n; new gl.Marker({ element: e }).setLngLat([lon, lat]).addTo(map); });
      { const e = document.createElement("span"); e.className = "cw-place ctx iiojk"; e.innerHTML = `<i>◂ </i>${IIOJK}<small>disputed territory</small>`; const mk = new gl.Marker({ element: e }).setLngLat([76.6, 33.42]).addTo(map), mw = $(W.el, ".cw-mapwrap");
        // zoomed out the north is too small for its labels: this one moves beside the border, the others step back
        const zoomed = () => { const low = map.getZoom() < 4.6; mw.classList.toggle("low", low); mk.setLngLat(low ? [83.4, 33.6] : [76.6, 33.42]); placed.AFGHANISTAN.setLngLat(low ? [66.2, 34.4] : [70.15, 35.75]); }; map.on("zoom", zoomed); zoomed(); }
      const wrap = $(W.el, ".cw-mapwrap"), tip = $(wrap, ":scope > .cw-tip");
      wrap.insertAdjacentHTML("beforeend", `<div class="cw-scope" role="group" aria-label="Map view"><button type="button" data-scope="n" class="on">Northern study area</button><button type="button" data-scope="pk">All Pakistan</button></div>`);
      $$(wrap, "[data-scope]").forEach(b => b.onclick = () => { $$(wrap, "[data-scope]").forEach(x => x.classList.toggle("on", x === b)); map.fitBounds(b.dataset.scope === "pk" ? VIEW_PK : VIEW_N, { padding: b.dataset.scope === "pk" ? { top: 66, bottom: 40, left: 16, right: 16 } : 0, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900 }); });
      // around the study area the map only names what is under the cursor: no values exist there
      const ctxHit = pt => { const lay = ["cw-ctx", "cw-iiojk"].filter(l => map.getLayer(l)); return lay.length ? map.queryRenderedFeatures(pt, { layers: lay })[0] : null; };
      const ctxHl = name => { if (map.getLayer("cw-ctxhl")) map.setFilter("cw-ctxhl", ["all", ["==", ["get", "layer"], "province"], ["==", ["get", "name"], name || ""]]); };
      map.on("mousemove", e => { const ti = tileAt(e.lngLat.lng, e.lngLat.lat); setHover(ti); map.getCanvas().style.cursor = ti >= 0 ? "crosshair" : "";
        if (ti >= 0) { ctxHl(""); tip.innerHTML = tipHtml(ti, W.v); tip.hidden = false; placeTip(tip, wrap, e.point.x, e.point.y); return; }
        const f = ctxHit(e.point), p = f && f.properties; ctxHl(p && p.layer === "province" ? p.name : "");
        tip.innerHTML = !f ? `<b>Outside Pakistan</b><span>Shown for context only</span>` : p.layer === "province" ? `<b>${esc(p.name)}</b><span>Outside the northern study area</span>` : `<b>${IIOJK}</b><span>Disputed territory · no study data here</span>`;
        tip.hidden = false; placeTip(tip, wrap, e.point.x, e.point.y); });
      map.on("mouseout", () => { tip.hidden = true; setHover(-1); ctxHl(""); });
      map.on("click", e => { const ti = tileAt(e.lngLat.lng, e.lngLat.lat); if (ti >= 0) setPin(ti); });
      W.heatKey = ""; selSync(); requestDraw();
    } catch (e) {
      console.warn("ClimateWS map:", e);
      if (W !== me) return;
      if (W.map) try { W.map.remove(); } catch { /* */ } W.map = null; W.src = null;
      $(W.el, ".cw-gl").hidden = true; W.fb.wrap.hidden = false; layoutAll(); requestDraw();   // no base map: the same data on a plain canvas
    }
  }
  function selSync() {
    if (!W.map || !W.map.getSource || !W.map.getSource("cw-sel")) return;
    const box = (ti, c) => { const t = W.tiles[ti]; return { type: "Feature", properties: { c }, geometry: { type: "LineString", coordinates: [[t.lon - HALF, t.lat - HALF], [t.lon + HALF, t.lat - HALF], [t.lon + HALF, t.lat + HALF], [t.lon - HALF, t.lat + HALF], [t.lon - HALF, t.lat - HALF]] } }; };
    const fs = []; if (W.pin >= 0) fs.push(box(W.pin, "#facc15")); if (W.hover >= 0 && W.hover !== W.pin) fs.push(box(W.hover, "#ffffff"));
    W.map.getSource("cw-sel").setData({ type: "FeatureCollection", features: fs });
  }

  /* ------------------------------------------------------------------ canvas maps: "All six" view, and the single map when no base map loads */
  const patt = (ctx, kind) => { const c = document.createElement("canvas"); c.width = c.height = 8; const x = c.getContext("2d");
    if (kind === "est") { x.strokeStyle = "rgba(226,232,240,.38)"; x.lineWidth = 1.6; x.beginPath(); x.moveTo(0, 8); x.lineTo(8, 0); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke(); }
    else { x.fillStyle = "rgba(240,249,255,.85)"; x.beginPath(); x.arc(4, 4, 1.3, 0, 7); x.fill(); }
    return ctx.createPattern(c, "repeat"); };
  function layoutAll() {
    if (!W) return;
    if (W.six) KEYS.forEach(k => sizeCanvas(W.panels[k]));
    if (!W.fb.wrap.hidden) sizeCanvas(W.fb);
  }
  function sizeCanvas(P) {
    const box = P.wrap.getBoundingClientRect(); if (!box.width || !box.height) return;
    let h = box.height, w = h * ASP; if (w > box.width) { w = box.width; h = w / ASP; }
    w = Math.floor(w); h = Math.floor(h); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (P.cv.width !== w * dpr || P.cv.height !== h * dpr) { P.cv.width = w * dpr; P.cv.height = h * dpr; P.key = ""; }
    P.cv.style.width = w + "px"; P.cv.style.height = h + "px"; P.w = w; P.h = h; P.dpr = dpr;
  }
  // static parts cached in two layers per size: a frame only repaints the 305 tile fills, the overlays and the selection outlines
  function geoPaths(P) {
    const g = W.geo, key = P.w + "x" + P.h + (g ? "g" : "");
    if (P.key === key) return P;
    P.key = key; P.px = lon => (lon - LON0) / (LON1 - LON0) * P.w; P.py = lat => (LAT1 - lat) / (LAT1 - LAT0) * P.h;
    P.est = patt(P.ctx, "est"); P.dots = patt(P.ctx, "dots");
    const px = P.px, py = P.py, w = P.w, h = P.h, cw = (px(LON0 + .25) - px(LON0)) + .7, ch = (py(LAT1 - .25) - py(LAT1)) + .7;
    const layer = () => { const c = document.createElement("canvas"); c.width = P.cv.width; c.height = P.cv.height; const x = c.getContext("2d"); x.setTransform(P.dpr, 0, 0, P.dpr, 0, 0); return [c, x]; };
    let out = null, prov = null, loc = null;
    if (g) {
      const ring = (q, r) => { r.forEach((c, i) => i ? q.lineTo(px(c[0]), py(c[1])) : q.moveTo(px(c[0]), py(c[1]))); };
      out = new Path2D(); g.rings.forEach(r => { ring(out, r); out.closePath(); });
      prov = new Path2D(); g.prov.forEach(r => ring(prov, r));
      loc = new Path2D(); g.lines.forEach(l => ring(loc, l));
    }
    const [cutC, cx] = layer();
    cx.fillStyle = "#07101e"; cx.fillRect(0, 0, w, h);
    cx.strokeStyle = "rgba(125,170,255,.09)"; cx.lineWidth = 1; cx.beginPath();
    for (let lo = 71; lo < LON1; lo++) { cx.moveTo(px(lo), 0); cx.lineTo(px(lo), h); } for (let la = 34; la < LAT1; la++) { cx.moveTo(0, py(la)); cx.lineTo(w, py(la)); } cx.stroke();
    if (out) { cx.globalCompositeOperation = "destination-out"; cx.fill(out, "evenodd"); cx.globalCompositeOperation = "source-over"; }
    P.cut = cutC;
    const [ovC, ox] = layer();
    ox.save(); if (out) ox.clip(out, "evenodd");
    if (!P.big) { ox.strokeStyle = "rgba(4,9,18,.34)"; ox.lineWidth = .6; ox.beginPath();
      W.tiles.forEach(t => ox.rect(px(t.lon - HALF), py(t.lat + HALF), cw - .7, ch - .7)); ox.stroke(); }
    ox.restore();
    if (g) { ox.lineJoin = "round"; ox.strokeStyle = "rgba(186,230,253,.32)"; ox.lineWidth = .8; ox.stroke(prov);
      ox.setLineDash([5, 4]); ox.strokeStyle = "rgba(251,191,36,.7)"; ox.lineWidth = 1; ox.stroke(loc); ox.setLineDash([]);
      ox.strokeStyle = "rgba(125,211,252,.22)"; ox.lineWidth = 4.5; ox.stroke(out); ox.strokeStyle = "#8fdcff"; ox.lineWidth = 1.3; ox.stroke(out); }
    P.over = ovC; P.cw = cw; P.ch = ch;
    return P;
  }
  function drawPanel(P) {
    if (!P || !P.w) return;
    geoPaths(P);
    const v = P.v, ctx = P.ctx, w = P.w, h = P.h, a = W.vals[v], N = W.N, sc = W.sc[v], px = P.px, py = P.py, cw = P.cw, ch = P.ch;
    const i0 = Math.min(N - 1, Math.floor(W.pos)), i1 = Math.min(N - 1, i0 + 1), f = W.pos - i0, tl = W.tiles;
    ctx.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
    ctx.fillStyle = "#0c1a2e"; ctx.fillRect(0, 0, w, h);
    if (P.big) { drawHeat(); ctx.drawImage(W.heat.cv, 0, 0, w, h); }
    else for (let ti = 0; ti < tl.length; ti++) { const o = ti * N, x = a[o + i0] + (a[o + i1] - a[o + i0]) * f, t = tl[ti]; ctx.fillStyle = sc.at(x); ctx.fillRect(px(t.lon - HALF), py(t.lat + HALF), cw, ch); }
    if (CAP[v] && !P.big) { ctx.fillStyle = P.dots; for (let ti = 0; ti < tl.length; ti++) if (a[ti * N + W.yi] >= CAP[v]) ctx.fillRect(px(tl[ti].lon - HALF), py(tl[ti].lat + HALF), cw, ch); }
    if (W.EST[W.yi] && !P.big) { ctx.fillStyle = P.est; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(P.cut, 0, 0, w, h); ctx.drawImage(P.over, 0, 0, w, h);
    const mark = (ti, col, lw) => { if (ti < 0) return; const t = tl[ti]; ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.strokeRect(px(t.lon - HALF) + .5, py(t.lat + HALF) + .5, cw - 1.7, ch - 1.7); };
    mark(W.pin, "#facc15", 2); if (W.hover !== W.pin) mark(W.hover, "#ffffff", 1.6);
  }

  /* ------------------------------------------------------------------ statistics */
  const sv = (v, r) => W.d.regional[v][r || W.r];
  const reg = () => REGS.find(r => r.k === W.r);
  function delta(v, yi = W.yi) {
    if (yi < 1) return null; const s = sv(v).values, a = s[yi], b = s[yi - 1];
    return { abs: a - b, pct: v !== "t2m" && b > 0 ? (a - b) / b * 100 : null, est: W.EST[yi] || W.EST[yi - 1], prev: W.Y[yi - 1] };
  }
  const chip = (v, d) => { if (!d) return ""; const m = W.VARS[v]; return `<span class="cw-d" style="color:${dirCol(v, d.abs)}" title="Change since winter ${d.prev}">${d.abs > 0 ? "▲" : d.abs < 0 ? "▼" : "•"} ${sgn(d.abs, Math.min(m.decimals ?? 1, 1))}</span>`; };
  function syncStats() {
    const { el, Y, yi, N } = W, est = W.EST[yi];
    $(el, "[data-year]").textContent = Y[yi]; $(el, "[data-yr]").textContent = Y[yi];
    const rng = W.lo > 0 || W.hi < N - 1 ? ` · playing ${Y[W.lo]}–${Y[W.hi]}` : "";
    $(el, "[data-ysub]").textContent = est ? "Estimated in the run" + rng : `2011–2025 not in the run${rng}`;
    $(el, ".cw-go input").value = Y[yi]; $(el, ".cw-go input").classList.remove("bad");
    KEYS.forEach(k => { const p = $(el, `.cw-p[data-p="${k}"]`), m = W.VARS[k]; $(p, "[data-pv]").textContent = nf(sv(k).values[yi], m.decimals ?? 1); $(p, "[data-pd]").innerHTML = chip(k, delta(k)); });
    renderSummary(); markCharts(); renderLower();
  }
  function renderSummary() {
    const { el, yi, Y, V = W.VARS } = W, r = reg();
    const rows = [["t2m", `${r.s} avg. temperature`], ["snowd", "Avg. snow depth"], ["cover", "Snow cover"], ["snowf", "Total snowfall"]];
    $(el, ".cw-rows").innerHTML = rows.map(([k, l]) => `<button type="button" class="cw-r${k === W.v ? " on" : ""}" data-rv="${k}" style="--lc:${LINE[k]}"><i>${ic(ICON[k], 26)}</i><span><small>${esc(l)}</small><b>${nf(sv(k).values[yi], V[k].decimals ?? 1)} <em>${esc(V[k].unit)}</em>${chip(k, delta(k))}</b></span></button>`).join("");
    $$(el, "[data-rv]").forEach(b => b.onclick = () => { setSix(false); setVar(b.dataset.rv); });
    const an = k => sv(k).values[yi] - sv(k).mean_observed, T = an("t2m"), mS = sv("snowf").mean_observed, Sp = mS > 0 ? an("snowf") / mS * 100 : null;
    const tTxt = Math.abs(T) < .05 ? "close to the 1970–2010 average temperature" : `${nf(Math.abs(T), 1)} °C ${T < 0 ? "colder" : "warmer"} than the 1970–2010 average`;
    const sTxt = Sp == null ? "" : Math.abs(Sp) < 1 ? ", with snowfall close to average" : `, with snowfall ${nf(Math.abs(Sp), 0)} % ${Sp < 0 ? "below" : "above"} average`;
    $(el, "[data-ins]").innerHTML = `Winter ${Y[yi]} was ${tTxt}${sTxt} ${esc(r.in)}.${W.EST[yi] ? " This winter is flagged estimated in the run." : ""}`;
  }

  /* ------------------------------------------------------------------ lower panel */
  function renderLower() {
    const { el, tab } = W; if (tab === "trends") { $(el, "[data-ltn]").textContent = `${reg().l} · click a chart to jump to that winter`; return; }
    $(el, "[data-ltn]").textContent = tab === "spatial" ? `${TAB[W.v]} · winter ${W.Y[W.yi]}` : tab === "stats" ? `${reg().l} · winter ${W.Y[W.yi]}` : "The run's own files and pages";
    const host = $(el, `[data-lp="${tab}"]`);
    if (tab === "spatial") renderSpatial(host); else if (tab === "stats") renderStats(host); else if (!host.firstChild) renderData(host);
  }
  function renderSpatial(host) {
    const { v, yi, N, tiles, Y } = W, m = W.VARS[v], dec = m.decimals ?? 1, a = W.vals[v], ti = W.hover >= 0 ? W.hover : W.pin;
    const by = tiles.map((t, i) => ({ t, i, x: a[i * N + yi], tr: t.tr[v] }));
    const name = t => esc(t.id.replace("_", " "));
    const list = (arr, f) => arr.map(o => `<button type="button" class="cw-li" data-ti="${o.i}"><span>${name(o.t)}</span><b>${f(o)}</b></button>`).join("");
    const hi = by.slice().sort((p, q) => q.x - p.x).slice(0, 4), lo = by.slice().sort((p, q) => p.x - q.x).slice(0, 4), tr = by.slice().sort((p, q) => Math.abs(q.tr) - Math.abs(p.tr)).slice(0, 4);
    const insp = ti < 0 ? `<p class="cw-fine">Hover the map to read a 25 km tile; click to pin it.</p>` : (() => { const t = tiles[ti]; return `<div class="cw-tid"><b>${name(t)}</b><span>${nf(t.frac * 100, 0)} % inside Pakistan · temp–snow r ${nf(t.r_t2m_snowd, 2)}</span>${ti === W.pin ? '<button type="button" class="cw-unpin">unpin</button>' : ""}</div><div class="cw-kvs">${KEYS.map(k => { const mk = W.VARS[k]; return `<div class="cw-kv${k === v ? " on" : ""}"><span>${TAB[k]}</span><b>${nf(W.vals[k][ti * N + yi], mk.decimals ?? 1)} ${esc(mk.unit)}</b><i style="color:${dirCol(k, t.tr[k])}">${sgn(t.tr[k], mk.decimals ?? 1)}/dec</i></div>`; }).join("")}</div>`; })();
    host.innerHTML = `<div class="cw-sp"><section class="wide"><h6>Tile inspector · winter ${Y[yi]}</h6>${insp}</section>
      <section><h6>Highest tiles</h6>${list(hi, o => `${nf(o.x, dec)} ${esc(m.unit)}${CAP[v] && o.x >= CAP[v] ? " *" : ""}`)}${CAP[v] && hi[0].x >= CAP[v] ? '<p class="cw-fine">* Glacier store, not measured snow.</p>' : ""}</section>
      <section><h6>Lowest tiles</h6>${list(lo, o => `${nf(o.x, dec)} ${esc(m.unit)}`)}</section>
      <section><h6>Largest change, 1970–2010</h6>${list(tr, o => `<span style="color:${dirCol(v, o.tr)}">${sgn(o.tr, dec)}/dec</span>`)}</section></div>`;
    $$(host, "[data-ti]").forEach(b => b.onclick = () => { const i = +b.dataset.ti; W.pin = i; selSync(); renderLower(); requestDraw(); if (W.map) W.map.easeTo({ center: [tiles[i].lon, tiles[i].lat], duration: 500 }); });
    const u = $(host, ".cw-unpin"); if (u) u.onclick = () => setPin(W.pin);
  }
  function renderStats(host) {
    const { yi, Y } = W;
    const rows = KEYS.map(k => { const m = W.VARS[k], dec = m.decimals ?? 1, s = sv(k), d = delta(k), ob = s.values.map((x, i) => ({ x, i })).filter(o => !W.EST[o.i]), hi = ob.reduce((a, b) => b.x > a.x ? b : a), lo = ob.reduce((a, b) => b.x < a.x ? b : a), an = s.values[yi] - s.mean_observed;
      return `<tr class="${k === W.v ? "on" : ""}" data-rv="${k}"><th>${esc(TAB[k])} <em>${esc(m.unit)}</em></th><td><b>${nf(s.values[yi], dec)}</b></td><td style="color:${d ? dirCol(k, d.abs) : ""}">${d ? sgn(d.abs, dec) : "—"}</td><td>${nf(s.mean_observed, dec)}</td><td style="color:${dirCol(k, an)}">${sgn(an, dec)}</td><td style="color:${dirCol(k, s.trend_per_decade)}">${sgn(s.trend_per_decade, dec)}</td><td>${Y[hi.i]} · ${nf(hi.x, dec)}</td><td>${Y[lo.i]} · ${nf(lo.x, dec)}</td></tr>`; }).join("");
    host.innerHTML = `<div class="cw-tw"><table class="cw-tb"><thead><tr><th>Layer</th><th>Winter ${Y[yi]}</th><th>Since ${yi ? Y[yi - 1] : "—"}</th><th>1970–2010 mean</th><th>Against mean</th><th>Trend / decade</th><th>Highest winter</th><th>Lowest winter</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    $$(host, "[data-rv]").forEach(r => r.onclick = () => setVar(r.dataset.rv));
  }
  function renderData(host) {
    const m = W.d.meta;
    host.innerHTML = `<div class="cw-dx"><div class="cw-dxb"><button type="button" data-goto="1"><b>Original figures</b><span>The run's maps and charts, unchanged</span></button><button type="button" data-goto="2"><b>Explore the numbers</b><span>Decades, regions, tile map, snow vs temperature</span></button>
        <a href="/api/climate/era5_winter/regional_means_winter.csv" download><b>⇩ Regional means</b><span>CSV, unchanged</span></a><a href="/api/climate/era5_winter/tile_year_values_winter.csv" download><b>⇩ Every tile, every winter</b><span>CSV, unchanged</span></a></div>
      <div class="cw-cov" aria-label="Coverage 1970 to 2026">${Array.from({ length: 57 }, (_, i) => 1970 + i).map(y => `<i class="${y <= 2010 ? (y === 1974 ? "e" : "d") : y < 2026 ? "g" : "o"}" title="${y <= 2010 ? (y === 1974 ? y + ": estimated in the run" : "Winter " + y + ": data") : y < 2026 ? y + ": not in the supplied run" : "2026–27: seasonal outlook"}"></i>`).join("")}
        <span><b>1970</b><em class="d">1970–2010 · 41 winters</em><em class="g">2011–2025 · not in the supplied run</em><em class="o">2026–27 · outlook (other scale)</em><b>2026</b></span></div>
      <p class="cw-fine">${esc(m.reanalysis_note)} ${esc(m.estimated_note)} ${esc(m.cover_note)} ${esc(m.cap_note)} Colour scales are fixed over all 41 winters. While playing, colours blend between winters for readability; numbers are always the winter shown.</p></div>`;
    $$(host, "[data-goto]").forEach(b => b.onclick = () => { const t = $(W.root, `[data-pg="${b.dataset.goto}"]`); if (t) t.click(); });
  }

  /* ------------------------------------------------------------------ trend charts */
  function buildCharts() {
    const { Y, EST } = W, Wd = 250, Ht = 150, L = 30, R = 10, T = 22, B = 20, x0 = Y[0] - .5, x1 = Y[W.N - 1] + .5, X = y => L + (y - x0) / (x1 - x0) * (Wd - L - R);
    TREND_ORDER.forEach(v => {
      const m = W.VARS[v], dec = m.decimals ?? 1, host = $(W.el, `.cw-ch[data-cv="${v}"] .cw-chs`), s = sv(v), vals = s.values;
      let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo || 1) * .1; lo -= pad; hi += pad;
      const step = niceStep((hi - lo) / 3), Yp = x => T + (hi - x) / (hi - lo) * (Ht - T - B);
      let g = ""; for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) g += `<line x1="${L}" x2="${Wd - R}" y1="${Yp(t)}" y2="${Yp(t)}" class="gr"/><text x="${L - 4}" y="${Yp(t) + 3}" class="ay" text-anchor="end">${nf(t + 0, step < 1 ? (step < .1 ? 2 : 1) : 0)}</text>`;
      [1970, 1990, 2010].forEach(y => { g += `<text x="${X(y)}" y="${Ht - 6}" class="ay" text-anchor="middle">${y}</text>`; });
      const line = vals.map((x, i) => `${i ? "L" : "M"}${X(Y[i]).toFixed(1)},${Yp(x).toFixed(1)}`).join("");
      g += `<defs><linearGradient id="cwg-${v}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${LINE[v]}" stop-opacity=".32"/><stop offset="1" stop-color="${LINE[v]}" stop-opacity="0"/></linearGradient></defs>`;
      g += `<clipPath id="cwc-${v}"><rect class="clp" x="0" y="0" width="${Wd}" height="${Ht}"/></clipPath><path d="${line}" class="cl gh" stroke="${LINE[v]}"/><g clip-path="url(#cwc-${v})"><path d="${line}L${X(Y[W.N - 1])},${Ht - B}L${X(Y[0])},${Ht - B}Z" fill="url(#cwg-${v})"/><path d="${line}" class="cl" stroke="${LINE[v]}"/></g>`;
      const eI = EST.findIndex(Boolean); if (eI >= 0) g += `<circle cx="${X(Y[eI])}" cy="${Yp(vals[eI])}" r="2.800" class="es" stroke="${LINE[v]}"><title>1974: estimated in the run</title></circle>`;
      g += `<line class="lvl" x1="${L}" stroke="${LINE[v]}"/><line class="cur" y1="${T}" y2="${Ht - B}"/><circle class="rng" r="4" fill="${LINE[v]}"/><circle class="cdot" r="4" fill="${LINE[v]}"/><g class="call"><rect rx="5" height="17" y="1"/><text y="13" text-anchor="middle"></text></g><line class="xh" y1="${T}" y2="${Ht - B}" style="display:none"/><rect class="hit" x="${L}" y="${T}" width="${Wd - L - R}" height="${Ht - T - B}"/>`;
      const old = $(host, "svg"); if (old) old.remove();
      host.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(NAME[v])} each winter 1970 to 2010, ${esc(reg().l)}">${g}</svg>`);
      const svg = $(host, "svg"); W.charts[v] = { X, Yp, svg, s, dec, Wd, L };
      const tip = $(host, ".cw-tip"), xh = $(svg, ".xh"), hit = $(svg, ".hit");
      const yearAt = e => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return clamp(Math.round(x0 + (p.x - L) / (Wd - L - R) * (x1 - x0)), Y[0], Y[W.N - 1]); };
      hit.onmousemove = e => { const y = yearAt(e), i = y - Y[0]; xh.setAttribute("x1", X(y)); xh.setAttribute("x2", X(y)); xh.style.display = "";
        tip.innerHTML = `<b>Winter ${y}${EST[i] ? ' <em class="e">estimated</em>' : ""}</b>` + REGS.map(r => `<span>${esc(r.s)}<strong>${nf(sv(v, r.k).values[i], dec)} ${esc(m.unit)}</strong></span>`).join("");
        tip.hidden = false; const r = host.getBoundingClientRect(); tip.style.left = clamp((X(y) / Wd) * r.width + 10, 0, Math.max(0, r.width - 170)) + "px"; tip.style.bottom = "100%"; tip.style.top = "auto"; };
      hit.onmouseleave = () => { tip.hidden = true; xh.style.display = "none"; };
      hit.onclick = e => { const y = yearAt(e); stop(); if (W.v !== v) setVar(v); setPos(y - Y[0]); };
    });
    markCharts();
  }
  function markCharts() {
    if (!W) return;
    TREND_ORDER.forEach(v => { const c = W.charts[v]; if (!c) return; const val = c.s.values[W.yi], x = c.X(W.Y[W.yi]), y = c.Yp(val), m = W.VARS[v], $s = q => $(c.svg, q);
      $s(".cur").setAttribute("x1", x); $s(".cur").setAttribute("x2", x); $s(".cdot").setAttribute("cx", x); $s(".cdot").setAttribute("cy", y);
      const prev = W.playing && W.yi > 0 ? c.s.values[W.yi - 1] : null, dir = prev == null ? "" : val > prev ? "up" : val < prev ? "dn" : "";
      $s(".call").setAttribute("class", "call " + dir);
      const txt = `${dir === "up" ? "▲ " : dir === "dn" ? "▼ " : ""}${nf(val, Math.min(c.dec, 1))} ${m.unit}`, bw = txt.length * 5.7 + 12, bx = clamp(x - bw / 2, 26, c.Wd - bw - 2); c.bw = bw;
      $s(".call rect").setAttribute("x", bx); $s(".call rect").setAttribute("width", bw); $s(".call text").setAttribute("x", bx + bw / 2); $s(".call text").textContent = txt; });
    if (W.playing && W.tapeY !== W.yi) updateTape();
  }
  // while playing: winters played so far stay bright, the marker glides along the same line (straight between two winters' values). Numbers are always the winter shown.
  function liveCharts() {
    const i = Math.min(Math.floor(W.pos), W.N - 2), f = W.pos - i;
    TREND_ORDER.forEach(v => { const c = W.charts[v]; if (!c) return; const a = c.s.values[i], b = c.s.values[i + 1], x = c.X(W.Y[i] + f), y = c.Yp(a + (b - a) * f), $s = q => $(c.svg, q);
      $s(".clp").setAttribute("width", x); $s(".cur").setAttribute("x1", x); $s(".cur").setAttribute("x2", x); $s(".lvl").setAttribute("x2", x); $s(".lvl").setAttribute("y1", y); $s(".lvl").setAttribute("y2", y);
      [".cdot", ".rng"].forEach(q => { $s(q).setAttribute("cx", x); $s(q).setAttribute("cy", y); });
      const bx = clamp(x - c.bw / 2, 26, c.Wd - c.bw - 2); $s(".call rect").setAttribute("x", bx); $s(".call text").setAttribute("x", bx + c.bw / 2); });
  }
  function updateTape() {
    W.tapeY = W.yi; const yi = W.yi, el = W.el;
    $(el, "[data-ty]").textContent = `Winter ${W.Y[yi]}`;
    const items = TREND_ORDER.map(v => { const c = W.charts[v]; if (!c) return ""; const m = W.VARS[v], d = Math.min(c.dec, 1), val = c.s.values[yi], ch = yi > 0 ? val - c.s.values[yi - 1] : null, cls = ch > 0 ? "up" : ch < 0 ? "dn" : "";
      return `<span><b>${esc(TAPE[v])}</b> ${nf(val, d)} ${esc(m.unit)}${ch == null ? "" : ` <em class="${cls}">${ch > 0 ? "▲" : ch < 0 ? "▼" : "="} ${nf(Math.abs(ch), d)}</em>`}</span>`; }).join("");
    $(el, "[data-tr]").innerHTML = items + items;
    const n = $(el, "[data-year]"); n.classList.remove("tk"); void n.getBoundingClientRect(); n.classList.add("tk");
  }

  return { html, start, fail, resume, map: () => W && W.map };
})();
