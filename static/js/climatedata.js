/* Climate Data module of the home page (window tab "Climate Data", styles static/css/climatedata.css, classes cd-*).
   Page 1 is the live climate workspace (static/js/climateworkspace.js, classes cw-*); pages 2-3 are the run's original figures and the
   interactive numbers below.
   Winter (Dec-Feb) climate 1970-2010 from the imported ERA5-Land run (/api/climate/era5_winter, scripts/build_era5_winter.py)
   plus the 2026-27 seasonal snow outlook (/api/forecast/snow). The run has no winters 2011-2025: that span is drawn empty and
   labelled, never filled. 1974 is flagged estimated by the run: hatched, left out of means, running means and trends. */
window.ClimateData = (function () {
  const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = (v, d = 0) => v == null || isNaN(v) ? "—" : (+v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (v, d) => (v > 0 ? "+" : v < 0 ? "−" : "±") + nf(Math.abs(v), d);
  let DATA = null, FC = null;
  const load = () => DATA ? Promise.resolve(DATA) : fetch("/api/climate/era5_winter").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { if (d.available === false || !d.meta) throw new Error(d.message || "no data"); DATA = d; return d; });
  const loadFc = () => FC ? Promise.resolve(FC) : fetch("/api/forecast/snow").then(r => r.ok ? r.json() : null).catch(() => null).then(d => (FC = d));

  // three mountain systems: the same hues as the glacier systems on the home map, softened for lines on the dark window
  const REG = [{ k: "Hindu_Kush", l: "Hindu Kush", c: "#22d3ee", fc: "Hindu Kush" }, { k: "Karakoram", l: "Karakoram", c: "#fb7185", fc: "Karakoram" },
               { k: "Western_Himalaya", l: "Western Himalaya", c: "#4ade80", fc: "Himalaya" }];
  const ALL = { k: "pakistan", l: "All 305 tiles", c: "#e2e8f0" };
  const DEC = { 1970: "#a78bfa", 1980: "#60a5fa", 1990: "#22d3ee", 2000: "#34d399", 2010: "#fbbf24", 2020: "#fb7185" };   // = HistTour.DEC
  // colour ramps per variable family (same families as the portal's Snow page, kept apart from forecast / screening palettes)
  const RAMP = {
    temp: ["#1d4ed8", "#60a5fa", "#cbd5e1", "#f87171", "#b91c1c"], snow: ["#0b1a33", "#1e3a8a", "#2563eb", "#7dd3fc", "#f0f9ff"],
    fall: ["#140b2e", "#4c1d95", "#7c3aed", "#c4b5fd", "#f5f3ff"], melt: ["#06221a", "#065f46", "#10b981", "#a7f3d0"],
    wind: ["#1c140a", "#78350f", "#d97706", "#fde68a"], trend: ["#8c510a", "#d8b365", "#cbd5e1", "#5ab4ac", "#01665e"],
  };
  const VF = { t2m: "temp", tmin: "temp", snowd: "snow", cover: "snow", swe: "snow", snowf: "fall", precip: "fall", melt: "melt", wind: "wind" };
  const SHORT = { t2m: "Air temperature", tmin: "Min. temperature", snowd: "Snow depth", cover: "Snow cover", swe: "Snow water eq.", snowf: "Snowfall", precip: "Precipitation", melt: "Snowmelt", wind: "Wind" };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const ramp = (stops, t) => { t = Math.max(0, Math.min(1, t)); const p = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i, a = hex(stops[i]), b = hex(stops[i + 1]);
    return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * f)).join(",")})`; };
  const grad = stops => `linear-gradient(90deg, ${stops.join(",")})`;

  // the run's own figures (static/img/era5_winter/), shown unchanged on the second page
  const IMG = "/static/img/era5_winter/";
  const FIGS = [{ f: "A_snapshots_every_5_years.png", t: "Every 5 winters", d: "Temperature, snow depth and snowfall maps every five winters, 1970–2010" },
                { f: "D_regional_timeseries.png", t: "Regional means", d: "Winter means of each mountain system, every winter 1970–2010" },
                { f: "B_trend_per_decade.png", t: "Trend per decade", d: "Change per decade 1970–2010 for six variables, tile by tile" },
                { f: "C_snow_temperature_link.png", t: "Snow–temperature link", d: "Correlation of winter temperature and snow depth in each tile" },
                { f: "0_study_area.png", t: "Study area", d: "The 305 tiles of 0.25° inside the Pakistan border" }];

  // Three pages inside the tab, switched with icon buttons (no long scroll): animations, original figures, interactive numbers.
  const ICO = p => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const PAGES = [
    { t: "Climate workspace", d: "Six live maps, timeline and trends", ic: ICO('<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><path d="M13 19l3-3.5 2.5 2 2.5-4"/>') },
    { t: "Original figures", d: "Maps and charts of the run", ic: ICO('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5.2-5.2L6 20"/>') },
    { t: "Explore the numbers", d: "Interactive charts and tile map", ic: ICO('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M7.5 15l3.5-4.5 3 2.5 5-6.5"/>') },
  ];

  // views inside "Explore the numbers", each fitting the screen; the variable / region chips drive the first four
  const SUBS = ["Time series", "Decades", "Regions", "Tile map", "Snow & temperature", "Data & notes"];

  // top bar: the portal's real modules, each opening as usual
  const NAV = [["climate", "Climate Data"], ["history", "Historical Overview"], ["alertforecast", "Avalanche Alert Forecast"], ["exposure", "Settlements"], ["reports", "Reports"]];

  // two views in the module's banner: the existing dashboard, unchanged, and the projections to 2100 (static/js/climateprojections.js)
  const VIEWS = [{ k: "forecast", t: "Historical Climate Records Since 1970", s: "Climate workspace · data 1970–2010" }, { k: "proj", t: "Projection Till 2100", s: "2 scenarios · baseline 1995–2014" }];
  let VIEW = "forecast";   // remembered while the page is open

  let S = null;   // state of the open window
  function html(m) {
    setTimeout(init);
    const yrs = Array.from({ length: 57 }, (_, i) => 1970 + i);
    return `<section class="cd ws" id="cd">
    <header class="cx-top"><div class="cx-brand"><img src="/static/img/ndma-logo.png" alt="NDMA"><img src="/static/img/ngt-logo.jpg" alt="NGT"><span><b>Snow Avalanche Prediction Using AI</b><small>NDMA · NGT avalanche portal</small></span></div>
      <nav class="cx-nav" aria-label="Portal modules">${NAV.map(n => `<button type="button" data-mod="${n[0]}" class="${n[0] === "climate" ? "on" : ""}"${n[0] === "climate" ? ' aria-current="page"' : ""}>${n[1]}</button>`).join("")}</nav>
      <span class="cx-badge">Module 06 : Winter Snow &amp; Climate<i data-bd>Data 1970 – 2010</i></span>
      ${window.HOME_BTN || ""}<button type="button" class="cx-x" data-back aria-label="Back to modules" title="Back to modules">✕</button></header>
    <div class="cx-hero"><div class="cx-ht"><h4 data-ht>Winter Snow &amp; Climate of the North</h4><p data-hs>Explore historical climate patterns across Northern Pakistan</p></div>
      <div class="cx-vtabs" role="tablist" aria-label="Climate views">${VIEWS.map(v => `<button type="button" role="tab" data-view="${v.k}" aria-selected="false"><b>${v.t}</b><small>${v.s}</small></button>`).join("")}</div>
      <span class="cx-src" data-src hidden><b>Data: NASA NEX-GDDP-CMIP6</b>Downscaled, bias-corrected · CC0</span>
      <div class="cd-mini"><div><b data-k="win">—</b><span>winters</span></div><div><b data-k="tiles">—</b><span>tiles</span></div>
        <div class="w"><b data-k="warm">—</b><span>°C / decade</span></div><div class="c"><b data-k="cov">—</b><span>cover pts / decade</span></div></div></div>

    <div class="cd-view" data-v-pane="forecast">
    <nav class="cd-nav" aria-label="Climate data pages">${PAGES.map((p, i) => `<button type="button" data-pg="${i}" class="${i ? "" : "on"}" aria-pressed="${!i}">
      <i aria-hidden="true">${p.ic}</i><span><b>${p.t}</b><em>${p.d}</em></span></button>`).join("")}</nav>

    <div class="cd-page" data-page="0">${window.ClimateWS ? ClimateWS.html() : '<p class="desc">The climate workspace did not load.</p>'}</div>

    <div class="cd-page" data-page="1" hidden>
    <div class="hx-sh"><h5>Original figures</h5><span>From the run, unchanged · click a figure to enlarge</span></div>
    <div class="cd-orig">
      <div class="cd-otabs">${FIGS.map((g, i) => `<button type="button" data-fi="${i}" class="${i ? "" : "on"}">${esc(g.t)}</button>`).join("")}</div>
      <figure class="cd-ofig"><img data-of src="${IMG + FIGS[0].f}" alt="${esc(FIGS[0].d)}"><figcaption data-oc>${esc(FIGS[0].d)}</figcaption></figure>
    </div>
    </div>

    <div class="cd-page" data-page="2" hidden>
    <div class="cd-span" aria-label="Coverage 1970 to 2026">${yrs.map(y => `<i class="${y <= 2010 ? (y === 1974 ? "e" : "d") : y < 2026 ? "g" : "o"}" title="${y <= 2010 ? (y === 1974 ? `${y}: estimated in the run` : `Winter ${y}: data`) : y < 2026 ? `${y}: not in the supplied run` : "2026–27: seasonal outlook"}"></i>`).join("")}
      <span class="cd-span-l"><b>1970</b><em class="d">1970–2010 · 41 winters, reanalysis</em><em class="g">2011–2025 · not in the supplied run</em><em class="o">2026–27 · outlook</em><b>2026</b></span></div>
    <div class="cd-subnav" role="tablist">${SUBS.map((s, i) => `<button type="button" role="tab" data-sub="${i}" class="${i ? "" : "on"}" aria-selected="${!i}">${s}</button>`).join("")}</div>
    <div class="cd-ctl" id="cd-series"><div class="cd-chips" data-role="var"></div><div class="cd-chips reg" data-role="reg"></div></div>

    <div class="cd-sub" data-sub-pane="0">
      <div class="hx-sh"><h5><span data-t="vt">—</span> <em data-t="vu">—</em></h5><span data-t="vs">Thin line = each winter · thick = 5-winter average · dashed = trend 1970–2010</span></div>
      <div class="cd-chart"><div class="cd-svg"><p class="desc">Loading the winter climate run…</p></div><div class="cd-tip" hidden></div></div>
      <div class="cd-legend"></div>
    </div>
    <div class="cd-sub" data-sub-pane="1" hidden>
      <div class="hx-sh"><h5>Decade by decade</h5><span>Mean of each decade against the 1970–2010 winter mean · 1974 left out</span></div>
      <div class="cd-decs"></div>
    </div>
    <div class="cd-sub" data-sub-pane="2" hidden>
      <div class="hx-sh"><h5>Three mountain systems</h5><span>Winter mean and change per decade, 1970–2010 · with the 2026–27 snow outlook</span></div>
      <div class="cd-regs"></div>
    </div>
    <div class="cd-sub" data-sub-pane="3" hidden>
      <div class="hx-sh" id="cd-map"><h5>Tile map <em data-t="my">—</em></h5><span>305 tiles · hover a tile for its value</span></div>
      <div class="cd-mapw">
        <div class="cd-mapbar"><div class="hx-f"><button type="button" data-mm="year" class="on">One winter</button><button type="button" data-mm="trend">Trend per decade</button></div>
          <button type="button" class="cd-play" aria-label="Play the winters">▶</button><input type="range" min="1970" max="2010" value="2010" step="1" aria-label="Winter"><b class="cd-yr">2010</b></div>
        <div class="cd-canvas"><canvas></canvas><div class="cd-tip" hidden></div></div>
        <div class="cd-mapleg"><span data-t="lo">—</span><i></i><span data-t="hi">—</span><em data-t="ln"></em></div>
      </div>
    </div>
    <div class="cd-sub" data-sub-pane="4" hidden>
      <div class="cd-two">
        <div><div class="hx-sh"><h5>Warmer winter, less snow?</h5><span>All tiles · one dot per winter</span></div><div class="cd-scat"></div></div>
        <div><div class="hx-sh"><h5>Per tile, from the run</h5><span>Original figure C · click to enlarge</span></div>
          <button type="button" class="cd-fig" data-zoom="C_snow_temperature_link.png"><img src="${IMG}C_snow_temperature_link.png" alt="Temperature–snow correlation per tile" loading="lazy"><span>Temperature–snow correlation in each tile</span></button></div>
      </div>
    </div>
    <div class="cd-sub" data-sub-pane="5" hidden>
      <div class="cd-dl"><span><b>The data</b>: the two CSV files of the run, unchanged.</span>
        <a href="/api/climate/era5_winter/regional_means_winter.csv" download>⇩ Regional means · CSV</a><a href="/api/climate/era5_winter/tile_year_values_winter.csv" download>⇩ Every tile, every winter · CSV</a></div>
      <p class="rfoot cd-notes">—</p>
    </div>
    </div>
    </div>
    <div class="cd-view" data-v-pane="proj" hidden>${window.ClimateProjections ? ClimateProjections.html() : '<p class="desc">The projections did not load.</p>'}</div></section>`;
  }

  function init() {
    const root = document.getElementById("cd"); if (!root) return;
    root.querySelector("[data-back]").onclick = () => window.closeWin && closeWin();
    const heroT = root.querySelector("[data-ht]").innerHTML, heroS = root.querySelector("[data-hs]").textContent;
    const setView = v => {
      if (v === "forecast" && window.ClimateWS) setTimeout(() => ClimateWS.resume());
      VIEW = v; const proj = v === "proj";
      root.querySelectorAll("[data-view]").forEach(b => { const on = b.dataset.view === v; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
      root.querySelectorAll("[data-v-pane]").forEach(p => { p.hidden = p.dataset.vPane !== v; });
      root.classList.toggle("pv", proj); root.querySelector("[data-src]").hidden = !proj;
      root.querySelector("[data-bd]").textContent = proj ? "Projections to 2100" : "Data 1970 – 2010";
      root.querySelector("[data-ht]").innerHTML = proj ? "Northern Pakistan Climate &amp; Risk Projections" : heroT;
      root.querySelector("[data-hs]").textContent = proj ? "Downscaled projections based on NASA NEX-GDDP-CMIP6 data" : heroS;
      const body = document.getElementById("win-body"); if (body) body.scrollTop = 0;
      if (proj && window.ClimateProjections) ClimateProjections.open(root.querySelector("#prj"));
    };
    root.querySelectorAll("[data-view]").forEach(b => {
      b.onclick = () => setView(b.dataset.view);
      b.onkeydown = e => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault(); e.stopPropagation(); const n = VIEWS[(VIEWS.findIndex(v => v.k === b.dataset.view) + 1) % VIEWS.length].k; setView(n); root.querySelector(`[data-view="${n}"]`).focus(); };
    });
    setView(VIEW);
    root.querySelectorAll("[data-mod]").forEach(b => b.onclick = () => { const i = M.findIndex(m => m.id === b.dataset.mod); if (b.dataset.mod !== "climate" && i >= 0) openWin(i); else { root.querySelector('[data-view="forecast"]').click(); root.querySelector('[data-pg="0"]').click(); } });
    root.querySelectorAll("[data-pg]").forEach(b => b.onclick = () => {
      const k = b.dataset.pg;
      root.querySelectorAll("[data-pg]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
      root.querySelectorAll(".cd-page").forEach(p => { p.hidden = p.dataset.page !== k; });   // the workspace pauses itself when its page is hidden
      root.classList.toggle("ws", k === "0");
      if (k === "2" && S) drawAll();                     // charts measure their box: draw them once the page is visible
      const body = document.getElementById("win-body"); if (body) body.scrollTop = 0;
    });
    root.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => {
      const k = b.dataset.sub;
      root.querySelectorAll("[data-sub]").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b); });
      root.querySelectorAll(".cd-sub").forEach(p => { p.hidden = p.dataset.subPane !== k; });
      root.querySelector(".cd-ctl").hidden = +k >= 4;     // the variable / region chips drive the first four views only
      if (S) drawAll();
      const body = document.getElementById("win-body"); if (body) body.scrollTop = 0;
    });
    const of = root.querySelector("[data-of]");
    root.querySelectorAll("[data-fi]").forEach(b => b.onclick = () => { const g = FIGS[+b.dataset.fi];
      root.querySelectorAll("[data-fi]").forEach(x => x.classList.toggle("on", x === b));
      of.src = IMG + g.f; of.alt = g.d; root.querySelector("[data-oc]").textContent = g.d; });
    const zoom = (src, cap) => window.lightbox ? lightbox(src, cap) : null;   // the home page's own in-page viewer, never a new tab
    of.onclick = () => zoom(of.src, root.querySelector("[data-oc]").textContent);
    root.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => zoom(IMG + b.dataset.zoom, b.textContent.trim()));
    Promise.all([load(), loadFc()]).then(([d, fc]) => { if (document.getElementById("cd") === root) { if (window.ClimateWS) ClimateWS.start(root, d); start(root, d, fc); } })
      .catch(e => { if (window.ClimateWS) ClimateWS.fail(root, e.message); root.querySelector(".cd-svg").innerHTML = `<p class="desc">The winter climate run needs the portal server and an imported run (scripts/build_era5_winter.py). ${esc(e.message || "")}</p>`; });
  }

  function start(root, d, fc) {
    const Y = d.meta.years, EST = d.meta.estimated, VARS = d.meta.vars, obs = i => !EST[i];
    S = { root, d, fc, v: "t2m", r: "compare", mm: "year", year: Y.length - 1, play: 0 };
    const set = (k, v) => { const b = root.querySelector(`[data-k="${k}"]`); if (b) b.textContent = v; };
    set("win", Y.filter((_, i) => obs(i)).length + 1); set("tiles", d.meta.tiles);
    set("warm", sgn(d.regional.t2m.pakistan.trend_per_decade, 2)); set("cov", sgn(d.regional.cover.pakistan.trend_per_decade, 2));
    root.querySelector('[data-k="win"]').parentNode.title = "41 winters, 1970–2010; 1974 is flagged estimated and left out of every trend";

    root.querySelector('[data-role="var"]').innerHTML = VARS.map(v => `<button type="button" data-v="${v.key}" style="--vc:${RAMP[VF[v.key]][VF[v.key] === "temp" ? 4 : 3]}"><i></i>${esc(SHORT[v.key] || v.label)}</button>`).join("");
    root.querySelector('[data-role="reg"]').innerHTML = [{ k: "compare", l: "Compare the three", c: "linear-gradient(90deg,#22d3ee,#fb7185,#4ade80)" }, ALL, ...REG]
      .map(r => `<button type="button" data-r="${r.k}" style="--rc:${r.c}"><i></i>${esc(r.l)}</button>`).join("");
    root.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { S.v = b.dataset.v; drawAll(); });
    root.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { S.r = b.dataset.r; drawAll(); });

    const rng = root.querySelector('.cd-mapbar input'), playB = root.querySelector(".cd-play");
    rng.oninput = () => { S.year = Y.indexOf(+rng.value); drawMap(); };
    root.querySelectorAll("[data-mm]").forEach(b => b.onclick = () => { S.mm = b.dataset.mm; root.querySelectorAll("[data-mm]").forEach(x => x.classList.toggle("on", x === b)); drawMap(); });
    playB.onclick = () => {
      if (S.play) { clearInterval(S.play); S.play = 0; playB.textContent = "▶"; return; }
      if (S.mm !== "year") root.querySelector('[data-mm="year"]').click();
      if (S.year >= Y.length - 1) S.year = -1;
      playB.textContent = "❚❚";
      S.play = setInterval(() => {
        if (!document.getElementById("cd")) { clearInterval(S.play); return; }
        S.year++; if (S.year >= Y.length - 1) { S.year = Y.length - 1; clearInterval(S.play); S.play = 0; playB.textContent = "▶"; }
        rng.value = Y[S.year]; drawMap();
      }, 650);
    };
    let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => document.getElementById("cd") && drawMap(), 150); });

    drawScatter(); drawAll();
    root.querySelector(".cd-notes").innerHTML = `<b>How to read this.</b> ${esc(d.meta.reanalysis_note)} ${esc(d.meta.estimated_note)} ${esc(d.meta.trend_note)}
      ${esc(d.meta.cover_note)} ${esc(d.meta.cap_note)} The supplied run ends with winter 2010; winters 2011–2025 are not in it and are left empty, not estimated.
      The 2026–27 figures come from the separate seasonal snow outlook (ERA5-Land daily stations, normal = 1990–2025) and are not on the same scale. Source: ${esc(d.meta.source)}`;
  }

  const meta = k => S.d.meta.vars.find(v => v.key === k);
  const series = (v, r) => S.d.regional[v][r];
  // 5-winter centred running mean over observed winters (needs at least 3 of the 5)
  const run5 = vals => vals.map((_, i) => { const w = []; for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < vals.length && !S.d.meta.estimated[j] && vals[j] != null) w.push(vals[j]);
    return w.length >= 3 ? w.reduce((a, b) => a + b, 0) / w.length : null; });

  function drawAll() {
    const root = S.root, v = S.v, mv = meta(v);
    root.querySelectorAll("[data-v]").forEach(b => b.classList.toggle("on", b.dataset.v === v));
    root.querySelectorAll("[data-r]").forEach(b => b.classList.toggle("on", b.dataset.r === S.r));
    root.querySelector('[data-t="vt"]').textContent = `${mv.label}${S.r === "compare" ? " · three systems" : " · " + (S.r === "pakistan" ? ALL.l : REG.find(r => r.k === S.r).l)}`;
    root.querySelector('[data-t="vu"]').textContent = mv.unit;
    root.querySelector('[data-t="vs"]').textContent = S.r === "compare" ? "Thin = each winter · thick = 5-winter average · labels at the 2010 end" : "Thin line = each winter · thick = 5-winter average · dashed = trend 1970–2010";
    drawSeries(); drawDecs(); drawMap(); drawRegs();
  }

  /* ---------- main series 1970-2026 ---------- */
  function drawSeries() {
    const { d, v } = S, Y = d.meta.years, EST = d.meta.estimated, mv = meta(v), dec = mv.decimals ?? 1;
    const regs = S.r === "compare" ? REG : [S.r === "pakistan" ? ALL : REG.find(r => r.k === S.r)];
    const W = 1000, H = 330, L = 60, R = 18, T = 22, B = 34, x0 = 1969.4, x1 = 2027.6;
    const X = y => L + (y - x0) / (x1 - x0) * (W - L - R);
    let lo = Infinity, hi = -Infinity;
    regs.forEach(r => series(v, r.k).values.forEach(x => { if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }));
    const pad = (hi - lo || 1) * .08; lo -= pad; hi += pad;
    const step = niceStep((hi - lo) / 5), t0 = Math.ceil(lo / step) * step;
    const Yp = val => T + (hi - val) / (hi - lo) * (H - T - B);
    const ticks = []; for (let t = t0; t <= hi; t += step) ticks.push(t);
    const path = (vals, skipEst) => { let s = "", pen = false; vals.forEach((val, i) => { if (val == null || (skipEst && EST[i])) { pen = false; return; } s += `${pen ? "L" : "M"}${X(Y[i]).toFixed(1)},${Yp(val).toFixed(1)}`; pen = true; }); return s; };
    const gx = X(2010.5), gx2 = X(2025.5), ox = X(2027.4), ex = X(1974);
    let g = `<defs><pattern id="cdh" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="rgba(148,163,184,.04)"/><line x1="0" y1="0" x2="0" y2="7" stroke="rgba(148,163,184,.22)" stroke-width="2"/></pattern>
      <linearGradient id="cdo" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fb7185" stop-opacity=".35"/><stop offset="1" stop-color="#fb7185" stop-opacity=".04"/></linearGradient></defs>`;
    g += ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Yp(t)}" y2="${Yp(t)}" class="gr${Math.abs(t) < step / 1e3 && VF[v] === "temp" ? " z" : ""}"/><text x="${L - 8}" y="${Yp(t) + 4}" class="ax" text-anchor="end">${nf(t, step < 1 ? (step < .1 ? 2 : 1) : 0)}</text>`).join("");
    [1970, 1980, 1990, 2000, 2010, 2020].forEach(y => { g += `<text x="${X(y)}" y="${H - 12}" class="ax" text-anchor="middle">${y}</text><line x1="${X(y)}" x2="${X(y)}" y1="${H - B}" y2="${H - B + 5}" class="gr"/>`; });
    // honest gaps: 1974 estimated, 2011-2025 not supplied, 2026-27 outlook (no value on this scale)
    g += `<rect x="${ex - 7}" y="${T}" width="14" height="${H - T - B}" fill="url(#cdh)"/><text x="${ex}" y="${T - 7}" class="ax sm" text-anchor="middle">1974 est.</text>`;
    g += `<rect x="${gx}" y="${T}" width="${gx2 - gx}" height="${H - T - B}" fill="url(#cdh)" rx="6"/>
      <text x="${(gx + gx2) / 2}" y="${(T + H - B) / 2 - 6}" class="gap" text-anchor="middle">2011–2025</text><text x="${(gx + gx2) / 2}" y="${(T + H - B) / 2 + 12}" class="ax" text-anchor="middle">not in the supplied run</text>`;
    g += `<rect x="${gx2 + 3}" y="${T}" width="${ox - gx2 - 3}" height="${H - T - B}" fill="url(#cdo)" rx="5"/><text x="${(gx2 + ox) / 2 + 1}" y="${T + 16}" class="ax sm o" text-anchor="middle">2026–27</text>
      <text x="${(gx2 + ox) / 2 + 1}" y="${T + 30}" class="ax sm o" text-anchor="middle">outlook ↓</text>`;
    regs.forEach(r => {
      const s = series(v, r.k), vals = s.values, rm = run5(vals);
      g += `<path d="${path(vals, false)}" class="yl" stroke="${r.c}"/>`;
      vals.forEach((val, i) => { if (val != null && !EST[i]) g += `<circle cx="${X(Y[i]).toFixed(1)}" cy="${Yp(val).toFixed(1)}" r="2.2" fill="${r.c}" class="dt"/>`; });
      vals.forEach((val, i) => { if (val != null && EST[i]) g += `<circle cx="${X(Y[i]).toFixed(1)}" cy="${Yp(val).toFixed(1)}" r="3.4" class="es" stroke="${r.c}"/>`; });
      g += `<path d="${path(rm, false)}" class="rm" stroke="${r.c}" style="--len:2400"/>`;
      if (regs.length === 1) {   // OLS line through (mean year, mean value) of the observed winters
        const oy = Y.filter((_, i) => !EST[i]), mx = oy.reduce((a, b) => a + b, 0) / oy.length, b = s.trend_per_decade / 10, a = s.mean_observed;
        g += `<line x1="${X(1970)}" x2="${X(2010)}" y1="${Yp(a + b * (1970 - mx))}" y2="${Yp(a + b * (2010 - mx))}" class="tr"/>
          <text x="${X(2010) - 4}" y="${Yp(a + b * (2010 - mx)) - 8}" class="lab" text-anchor="end">${sgn(s.trend_per_decade, dec)} ${esc(mv.unit)} / decade</text>`;
      } else {
        const last = rm.length - 1 - [...rm].reverse().findIndex(x => x != null);
        g += `<circle cx="${X(Y[last])}" cy="${Yp(rm[last])}" r="4.5" fill="${r.c}" class="end"/><text x="${X(Y[last]) + 9}" y="${Yp(rm[last]) + 4}" class="lab">${esc(r.l)}</text>`;
      }
    });
    g += `<line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/><rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
    const box = S.root.querySelector(".cd-svg");
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(mv.label)} each winter 1970 to 2010">${g}</svg>`;
    S.root.querySelector(".cd-legend").innerHTML = (regs.length > 1 ? regs.map(r => `<span><i style="background:${r.c}"></i>${esc(r.l)}</span>`).join("") : "")
      + `<span><i class="h"></i>Estimated (1974) · not supplied (2011–2025)</span>${["snowd", "swe"].includes(v) ? '<span class="warn">Karakoram includes glacier tiles held at ERA5-Land\'s fixed snow store</span>' : ""}`;
    // crosshair + tooltip
    const svg = box.querySelector("svg"), xh = svg.querySelector(".xh"), tip = S.root.querySelector(".cd-chart .cd-tip");
    svg.querySelector(".hit").addEventListener("mousemove", e => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const yr = Math.round(x0 + (p.x - L) / (W - L - R) * (x1 - x0)), i = Y.indexOf(yr);
      xh.setAttribute("x1", X(yr)); xh.setAttribute("x2", X(yr)); xh.style.display = "";
      let h;
      if (i >= 0) h = `<b>Winter ${yr}${EST[i] ? ' <em class="e">estimated</em>' : ""}</b>` + regs.map(r => { const s = series(v, r.k), rm = run5(s.values)[i];
        return `<span><i style="background:${r.c}"></i>${esc(r.l)}<strong>${nf(s.values[i], dec)} ${esc(mv.unit)}</strong>${rm != null ? `<small>5-yr ${nf(rm, dec)}</small>` : ""}</span>`; }).join("");
      else if (yr > 2010 && yr < 2026) h = `<b>Winter ${yr}</b><span>Not in the supplied run (it ends with 2010). Nothing is filled in.</span>`;
      else if (yr >= 2026) h = `<b>Winter 2026–27</b><span>Seasonal snow outlook: see the three system cards below.</span>`;
      else { tip.hidden = true; return; }
      tip.innerHTML = h; tip.hidden = false;
      const r = box.getBoundingClientRect(), xp = (X(yr) / W) * r.width;
      tip.style.left = Math.min(r.width - 230, Math.max(0, xp + 14)) + "px"; tip.style.top = "10px";
    });
    svg.querySelector(".hit").addEventListener("mouseleave", () => { tip.hidden = true; xh.style.display = "none"; });
  }
  const niceStep = s => { const p = Math.pow(10, Math.floor(Math.log10(s))), f = s / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };

  /* ---------- decade cards ---------- */
  function drawDecs() {
    const { d, v } = S, Y = d.meta.years, EST = d.meta.estimated, mv = meta(v), dec = mv.decimals ?? 1;
    const rk = S.r === "compare" ? "pakistan" : S.r, s = series(v, rk), base = s.mean_observed, temp = VF[v] === "temp";
    const decs = [1970, 1980, 1990, 2000, 2010].map(x => { const w = s.values.filter((val, i) => Y[i] >= x && Y[i] < x + 10 && !EST[i] && val != null);
      return { x, n: w.length, m: w.length ? w.reduce((a, b) => a + b, 0) / w.length : null }; });
    const amax = Math.max(1e-9, ...decs.filter(q => q.m != null).map(q => Math.abs(q.m - base)));
    const fcR = S.fc && S.fc.ranges ? S.fc.ranges : null;
    const regLabel = rk === "pakistan" ? ALL.l : REG.find(r => r.k === rk).l;
    S.root.querySelector(".cd-decs").innerHTML = decs.map((q, k) => {
      const an = q.m - base, w = Math.abs(an) / amax * 50, pos = an >= 0;
      const col = temp ? (pos ? "#f87171" : "#60a5fa") : (pos ? "#2dd4bf" : "#d8b365");
      return `<div class="cd-dec" style="--dc:${DEC[q.x]};--i:${k}"><b>${q.x === 2010 ? "2010" : q.x + "s"}</b>
        <span class="cd-dec-v"><strong>${nf(q.m, dec)}</strong> ${esc(mv.unit)}</span>
        <span class="cd-dec-bar"><i style="--w:${w.toFixed(1)}%;--bc:${col};${pos ? "left:50%" : "right:50%"}"></i></span>
        <span class="cd-dec-m">${sgn(an, dec)} vs 1970–2010 · ${q.n} winter${q.n > 1 ? "s" : ""}${q.x === 1970 ? " (1974 out)" : ""}</span></div>`;
    }).join("") + `<div class="cd-dec none" style="--dc:${DEC[2010]}"><b>2011–19</b><span class="cd-dec-v"><strong>—</strong></span><span class="cd-dec-bar"></span><span class="cd-dec-m">Not in the supplied run</span></div>
      <div class="cd-dec fc" style="--dc:${DEC[2020]}"><b>2026–27</b><span class="cd-dec-v cd-dec-fc">${fcR ? REG.map(r => `<span><i style="background:${r.c}"></i>${nf(fcR[r.fc].pct_of_normal, 0)} %</span>`).join("") : "<strong>—</strong>"}</span>
        <span class="cd-dec-m">${fcR ? "Snow outlook, % of normal snowfall (1990–2025) · not this scale" : "No outlook loaded"}</span></div>`
      + `<p class="cd-dec-note">${esc(regLabel)} · ${esc(mv.label)}</p>`;
  }

  /* ---------- tile map (canvas) ---------- */
  const SCALE = {};
  function scaleFor(v, trend) {
    const key = v + (trend ? ":t" : ""); if (SCALE[key]) return SCALE[key];
    const xs = []; S.d.tiles.forEach(t => { if (trend) { if (t.tr[v] != null) xs.push(t.tr[v]); } else t.v[v].forEach((x, i) => { if (x != null && !S.d.meta.estimated[i]) xs.push(x); }); });
    xs.sort((a, b) => a - b); const q = p => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    let lo = q(.01), hi = q(.99), div = trend || VF[v] === "temp";
    if (div) { const m = Math.max(Math.abs(lo), Math.abs(hi)); lo = -m; hi = m; }
    const stops = trend ? (VF[v] === "temp" ? RAMP.temp : RAMP.trend) : RAMP[VF[v]];
    return (SCALE[key] = { lo, hi, stops, f: x => ramp(stops, (x - lo) / (hi - lo || 1)) });
  }
  const PEAKS = [["K2", 35.881, 76.513], ["Nanga Parbat", 35.237, 74.589], ["Tirich Mir", 36.255, 71.842], ["Batura", 36.53, 74.53]];
  function drawMap() {
    const root = S.root, v = S.v, mv = meta(v), dec = mv.decimals ?? 1, Y = S.d.meta.years, trend = S.mm === "trend", sc = scaleFor(v, trend);
    const wrap = root.querySelector(".cd-canvas"), cv = wrap.querySelector("canvas"), tip = wrap.querySelector(".cd-tip");
    const lon0 = 70.5, lon1 = 78.0, lat0 = 33.75, lat1 = 37.25, kx = Math.cos(35.5 * Math.PI / 180);
    // the map's height fits the screen (240-470 px), so its view needs no scrolling
    const asp = (lat1 - lat0) / ((lon1 - lon0) * kx), Wc = Math.round(Math.min(wrap.clientWidth || 800, Math.max(240, Math.min(470, innerHeight - 630)) / asp)), Hc = Math.round(Wc * asp), dpr = window.devicePixelRatio || 1;
    cv.width = Wc * dpr; cv.height = Hc * dpr; cv.style.width = Wc + "px"; cv.style.height = Hc + "px";
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, Wc, Hc);
    const px = lon => (lon - lon0) / (lon1 - lon0) * Wc, py = lat => (lat1 - lat) / (lat1 - lat0) * Hc, cw = Wc / 30, chh = Hc / 14;
    const val = t => trend ? t.tr[v] : t.v[v][S.year];
    S.d.tiles.forEach(t => { const x = val(t); c.fillStyle = x == null ? "rgba(148,163,184,.15)" : sc.f(x);
      c.globalAlpha = .55 + .45 * Math.min(1, t.frac); c.beginPath(); c.roundRect(px(t.lon - .125) + 1, py(t.lat + .125) + 1, cw - 2, chh - 2, 3); c.fill(); });
    c.globalAlpha = 1; c.font = "600 11px Inter, system-ui, sans-serif";
    PEAKS.forEach(([n, la, lo]) => { const x = px(lo), y = py(la); c.fillStyle = "#fff"; c.strokeStyle = "#0b1220"; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 3.2, 0, 7); c.fill(); c.stroke(); c.lineWidth = 3; c.strokeText(n, x + 6, y - 5); c.fillText(n, x + 6, y - 5); });
    root.querySelector('[data-t="my"]').textContent = trend ? `${SHORT[v]} · change per decade 1970–2010` : `${SHORT[v]} · winter ${Y[S.year]}${S.d.meta.estimated[S.year] ? " (estimated)" : ""}`;
    root.querySelector(".cd-yr").textContent = trend ? "1970–2010" : Y[S.year];
    root.querySelector(".cd-mapbar input").disabled = trend;
    const u = trend ? `${mv.unit} / decade` : mv.unit;
    root.querySelector('[data-t="lo"]').textContent = `${nf(sc.lo, dec)}`; root.querySelector('[data-t="hi"]').textContent = `${nf(sc.hi, dec)} ${u}`;
    root.querySelector(".cd-mapleg i").style.background = grad(sc.stops);
    root.querySelector('[data-t="ln"]').textContent = trend ? (VF[v] === "temp" ? "blue = cooling · red = warming" : "brown = less · teal = more") : "Fixed scale over all winters (1–99 %)";
    cv.onmousemove = e => {
      const r = cv.getBoundingClientRect(), lon = lon0 + (e.clientX - r.left) / Wc * (lon1 - lon0), lat = lat1 - (e.clientY - r.top) / Hc * (lat1 - lat0);
      const t = S.d.tiles.find(t => Math.abs(t.lon - lon) <= .125 && Math.abs(t.lat - lat) <= .125);
      if (!t) { tip.hidden = true; return; }
      const x = val(t), cap = ["snowd", "swe"].includes(v) && !trend && x != null && x >= (v === "snowd" ? 3333 : 9999);
      tip.innerHTML = `<b>Tile ${esc(t.id.replace("_", " "))}</b><span>${trend ? "Change per decade" : "Winter " + Y[S.year]}<strong>${x == null ? "—" : (trend ? sgn(x, dec) : nf(x, dec))} ${esc(u)}</strong></span>
        <span>Temp–snow r<strong>${nf(t.r_t2m_snowd, 2)}</strong></span><span>Inside Pakistan<strong>${nf(t.frac * 100, 0)} %</strong></span>${cap ? '<small class="warn">Glacier cell at the fixed snow store, not measured snow</small>' : ""}`;
      tip.hidden = false; tip.style.left = cv.offsetLeft + Math.min(Wc - 220, e.clientX - r.left + 14) + "px"; tip.style.top = Math.max(0, e.clientY - r.top - 20) + "px";
    };
    cv.onmouseleave = () => { tip.hidden = true; };
  }

  /* ---------- region cards ---------- */
  function spark(vals, color) {
    const rm = run5(vals), xs = rm.filter(x => x != null), lo = Math.min(...xs), hi = Math.max(...xs), W = 220, H = 46;
    let s = "", pen = false; rm.forEach((x, i) => { if (x == null) { pen = false; return; } s += `${pen ? "L" : "M"}${(i / (rm.length - 1) * W).toFixed(1)},${(H - 4 - (x - lo) / (hi - lo || 1) * (H - 8)).toFixed(1)}`; pen = true; });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${s}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }
  function drawRegs() {
    const { d, v, fc } = S, mv = meta(v), dec = mv.decimals ?? 1;
    S.root.querySelector(".cd-regs").innerHTML = REG.map(r => {
      const g = k => d.regional[k][r.k], o = fc && fc.ranges ? fc.ranges[r.fc] : null, meth = fc && fc.method_by_range ? fc.method_by_range[r.fc] : "";
      const row = (k, lab) => { const s = g(k), m = meta(k); return `<div class="cd-kv"><span>${lab}</span><b>${nf(s.mean_observed, m.decimals ?? 1)} <em>${esc(m.unit)}</em></b><i class="${s.trend_per_decade > 0 ? "up" : "dn"}">${sgn(s.trend_per_decade, m.decimals ?? 1)}/dec</i></div>`; };
      return `<article class="cd-reg" style="--rc:${r.c}"><header><h6>${esc(r.l)}</h6><button type="button" data-rr="${r.k}">Show in chart →</button></header>
        <div class="cd-sp"><small>${esc(SHORT[v])}, 5-winter average · 1970–2010</small>${spark(g(v).values, r.c)}<span>${sgn(g(v).trend_per_decade, dec)} ${esc(mv.unit)} per decade</span></div>
        ${row("t2m", "Winter temperature")}${row("snowd", "Snow depth")}${row("cover", "Snow cover")}${row("snowf", "Snowfall, season")}
        <div class="cd-out">${o ? `<b>2026–27 outlook</b><strong>${nf(o.pct_of_normal, 0)} %</strong><span>of normal snowfall · ${nf(o.high_days, 1)} heavy-snow days (normal ${nf(o.normal_high_days, 1)}) · ${o.stations} stations · ${esc(meth)}</span>`
          : "<span>2026–27 outlook not loaded.</span>"}</div></article>`;
    }).join("");
    S.root.querySelectorAll("[data-rr]").forEach(b => b.onclick = () => { S.r = b.dataset.rr; drawAll(); S.root.querySelector("#cd-series").scrollIntoView({ behavior: "smooth" }); });
  }

  /* ---------- temperature vs snow depth scatter (all tiles) ---------- */
  function drawScatter() {
    const d = S.d, Y = d.meta.years, EST = d.meta.estimated, tx = d.regional.t2m.pakistan.values, sy = d.regional.snowd.pakistan.values;
    const pts = Y.map((y, i) => ({ y, x: tx[i], s: sy[i], e: EST[i] })).filter(p => p.x != null && p.s != null);
    const W = 520, H = 300, L = 52, R = 14, T = 14, B = 38;
    const xl = Math.min(...pts.map(p => p.x)) - .3, xh = Math.max(...pts.map(p => p.x)) + .3, yl = Math.min(...pts.map(p => p.s)) - 4, yh = Math.max(...pts.map(p => p.s)) + 4;
    const X = x => L + (x - xl) / (xh - xl) * (W - L - R), Yp = s => T + (yh - s) / (yh - yl) * (H - T - B);
    const VIR = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"];
    const ob = pts.filter(p => !p.e), mx = ob.reduce((a, p) => a + p.x, 0) / ob.length, my = ob.reduce((a, p) => a + p.s, 0) / ob.length;
    const b = ob.reduce((a, p) => a + (p.x - mx) * (p.s - my), 0) / ob.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    let g = "";
    for (let t = Math.ceil(yl / 10) * 10; t <= yh; t += 10) g += `<line x1="${L}" x2="${W - R}" y1="${Yp(t)}" y2="${Yp(t)}" class="gr"/><text x="${L - 7}" y="${Yp(t) + 4}" class="ax" text-anchor="end">${t}</text>`;
    for (let t = Math.ceil(xl); t <= xh; t++) g += `<text x="${X(t)}" y="${H - 20}" class="ax" text-anchor="middle">${t}</text>`;
    g += `<text x="${(L + W - R) / 2}" y="${H - 4}" class="ax" text-anchor="middle">Winter air temperature, °C</text><text x="12" y="${(T + H - B) / 2}" class="ax" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">Snow depth, cm</text>`;
    g += `<line x1="${X(xl + .2)}" x2="${X(xh - .2)}" y1="${Yp(my + b * (xl + .2 - mx))}" y2="${Yp(my + b * (xh - .2 - mx))}" class="tr"/>`;
    g += pts.map(p => `<circle cx="${X(p.x).toFixed(1)}" cy="${Yp(p.s).toFixed(1)}" r="5.5" ${p.e ? `class="es" stroke="#94a3b8"` : `fill="${ramp(VIR, (p.y - 1970) / 40)}" class="sd"`}><title>Winter ${p.y}${p.e ? " (estimated, not in r)" : ""}: ${nf(p.x, 2)} °C, ${nf(p.s, 1)} cm</title></circle>`).join("");
    S.root.querySelector(".cd-scat").innerHTML = `<div class="cd-r"><b>r = ${nf(d.meta.pakistan_scatter_r, 2)}</b><span>Weak link across all tiles: a warmer winter only slightly tends to mean less snow. Per tile (figure C) the link is strongest in the lower southern tiles and weak or slightly positive in the high north.</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Winter temperature against snow depth, all tiles">${g}</svg>
      <div class="cd-legend sm"><span><i style="background:${grad(VIR)};width:60px"></i>1970 → 2010</span><span><i class="h"></i>1974, estimated</span></div>`;
  }

  return { html };
})();
