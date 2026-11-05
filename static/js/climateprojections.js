/* Projection Till 2100: second view of the Climate Data module (static/js/climatedata.js, styles static/css/climateprojections.css).
   Same page as the Historical Climate workspace (owner's request): it reuses that page's .cw-* classes, layout, chart drawing and playback animation; only the map and the values are its own.
   Fixed results from the analysis team (data/climate/projections, NASA NEX-GDDP-CMIP6): /api/climate/projections and /tiles.geojson.
   Every number comes from the package. Rules kept: value / change / % are medians over the climate models, so value + change need not equal the
   baseline exactly (stated in Data Explorer); the 5-year windows carry natural variability (stated on the page); the tile layer exists only for some periods, anything else names
   the closest layer; a tile with a zero baseline has no % change; grid tiles the package has no values for (static/projections/tiles_full.json) are drawn grey, never coloured. */
window.ClimateProjections = (function () {
  const API = "/api/climate/projections", IMG = "/static/img/projections/";
  const esc = t => String(t == null ? "" : t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = (v, d = 2) => v == null || isNaN(v) ? "—" : (+v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", "−");
  const sg = (v, d = 2) => { if (v == null || isNaN(v)) return "—"; const a = Math.abs(v); return +a.toFixed(d) === 0 ? nf(0, d) : (v > 0 ? "+" : "−") + nf(a, d); };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const $ = (el, s) => el.querySelector(s), $$ = (el, s) => [...el.querySelectorAll(s)];
  const per = p => p.replace("-", "–");
  const ic = (p, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SC = { ssp245: { l: "SSP2-4.5", n: "Moderate emissions", s: "Moderate" }, ssp585: { l: "SSP5-8.5", n: "Very high emissions", s: "Very high" } };
  const dirCol = x => x > 0 ? "#2dd4bf" : x < 0 ? "#d8b365" : "#94a3b8";   // same sense as the Historical page: more teal, less sand
  const ALL = "ALL northern Pakistan";
  const LABEL = { [ALL]: "Northern Pakistan", "Hindu Kush (Chitral-Dir-Swat)": "Hindu Kush", "Karakoram (Gilgit-Baltistan)": "Karakoram", "Kashmir (Neelum-Leepa-Astore)": "Kashmir", "Kohistan-Hazara": "Kohistan-Hazara", "below 2500 m": "Below 2,500 m", "2500-3500 m": "2,500–3,500 m", "above 3500 m": "Above 3,500 m" };
  const REGIONS = ["Karakoram (Gilgit-Baltistan)", "Kashmir (Neelum-Leepa-Astore)", "Kohistan-Hazara", "Hindu Kush (Chitral-Dir-Swat)"], BANDS = ["below 2500 m", "2500-3500 m", "above 3500 m"];
  const LABEL_SIDE = { "Hindu Kush (Chitral-Dir-Swat)": "right", "Kohistan-Hazara": "left" };   // their centres sit side by side
  // the package's own region rule (its forecast_core.region), used to label and highlight the map only
  const regionOf = (lat, lon) => lon < 72.8 ? REGIONS[3] : lon < 73.6 ? REGIONS[2] : lat < 35.1 ? REGIONS[1] : REGIONS[0];
  const I = { alarm: '<path d="M12 3L2.500 20h19z"/><path d="M12 10v4M12 17h.01"/>', storm: '<path d="M4 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M5 19h5"/>', snow: '<path d="M7 15a4 4 0 0 1 .500-8 5.500 5.500 0 0 1 10.500 1.500A3.300 3.300 0 0 1 17.500 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01"/>', flake: '<path d="M12 2v20M3.300 7l17.400 10M20.700 7L3.300 17"/>', warm: '<path d="M14 14.800V5a2 2 0 1 0-4 0v9.800a4 4 0 1 0 4 0z"/>', ground: '<path d="M3 20l6-11 4 6 3-4 5 9z"/>' };
  // the four map layers the package supplies
  const MET = { alarm_days_change_pct: { m: "alarm_days_moderate", t: "Alarm Days", n: "Avalanche-alarm days", ic: I.alarm, tile: "Alarm days" }, storm_days_change_pct: { m: "storm_alarm_days", t: "Storm Days", n: "Storm days", ic: I.storm, tile: "Storm days" },
    snowfall_change_pct: { m: "snowfall_mm", t: "Snowfall", n: "Winter snowfall", ic: I.snow, tile: "Snowfall" }, snow_share_change_pts: { m: "snow_share_pct", t: "Snow Share", n: "Share falling as snow", ic: I.flake, pts: true, tile: "Falling as snow" } };
  const CH = [{ k: "alarm_days_moderate", t: "Alarm Days", u: "days", c: "#22d3ee", d: 2, ic: I.alarm }, { k: "storm_alarm_days", t: "Storm Days", u: "days", c: "#a78bfa", d: 2, ic: I.storm }, { k: "warm_alarm_days", t: "Warm-Snow Days", u: "days", c: "#fb923c", d: 2, ic: I.warm },
    { k: "extreme_snow_days", t: "Extreme Snow", u: "days", c: "#84cc16", d: 2, ic: I.flake }, { k: "snowpack_days", t: "Snow on Ground", u: "days", c: "#38bdf8", d: 1, ic: I.ground }, { k: "snowfall_mm", t: "Winter Snowfall", u: "mm", c: "#f472b6", d: 1, ic: I.snow }];
  const ROWS = [["alarm_days_change_pct", "alarm_days_moderate", "Avalanche-alarm days", "days", 2, "#22d3ee", I.alarm], ["storm_days_change_pct", "storm_alarm_days", "Storm days", "days", 2, "#a78bfa", I.storm], ["snowfall_change_pct", "snowfall_mm", "Winter snowfall", "mm", 1, "#f472b6", I.snow], ["snow_share_change_pts", "snow_share_pct", "Falling as snow", "%", 1, "#60a5fa", I.flake]];
  const ALLM = [["alarm_days_moderate", "Avalanche-alarm days", "days"], ["alarm_days_high", "High-alarm days", "days"], ["storm_alarm_days", "Storm-type alarm days", "days"], ["warm_alarm_days", "Warm-snow alarm days", "days"], ["extreme_snow_days", "Extreme 3-day snowfall", "days"], ["snowfall_mm", "Winter snowfall", "mm w.e."], ["rain_on_snow_days", "Rain-on-snow days", "days"], ["snowpack_days", "Days with snow on the ground", "days"], ["snow_share_pct", "Snow share of precipitation", "%"]];
  const RAMP = ["#1d4e89", "#3d8bc4", "#9ecae1", "#f1f5f9", "#fdba74", "#ea580c", "#9a3412"], RAMP_AT = [-1, -.5, -.25, 0, .25, .5, 1], NODATA = "#7c8aa5";
  const FIGS = [["chart_alarm_days_moderate_by_region.png", "Alarm days by region"], ["chart_storm_alarm_days_by_region.png", "Storm days by region"], ["chart_warm_alarm_days_by_region.png", "Warm-snow days by region"], ["chart_snowfall_mm_by_region.png", "Snowfall by region"], ["chart_snowpack_days_by_region.png", "Snow on ground by region"], ["chart_alarm_days_by_elevation.png", "Alarm days by elevation"], ["map_alarm_days_change.png", "Change per tile"]];
  const PLACES = [["AFGHANISTAN", 70.15, 35.75, "far"], ["CHINA", 77.55, 37.42, "far"], ["Khyber Pakhtunkhwa", 70.9, 32.75, ""], ["Punjab", 72.27, 30.87, ""], ["Balochistan", 65.66, 28.48, ""], ["Sindh", 68.76, 26.15, ""], ["IRAN", 59.4, 29.4, "far"], ["INDIA", 76.6, 29.6, "far"]];
  const IIOJK = "Indian Illegally Occupied Jammu &amp; Kashmir", VIEW_N = [[69.75, 33.15], [78.55, 37.5]], VIEW_PK = [[60.4, 23.4], [80.2, 37.5]];

  // filters survive switching views and closing the window
  const P = { sc: "ssp245", g: ALL, hz: "5", per: "2025", tm: "alarm_days_change_pct", tab: "trends", speed: 1 };
  let D = null, TILES = null, FULL = null, V = null;

  function html() { return `<div class="cw prj" id="prj" tabindex="-1"><p class="desc cw-load">Loading the projections…</p></div>`; }

  function open(el) {
    if (!el) return;
    if (V && V.el === el) { if (V.map) V.map.resize(); resume(); return; }
    destroy();
    V = { el, root: el.closest("#cd"), map: null, raf: 0, playing: false, auto: true, pos: 0, hold: 0, last: 0, tapeI: null, charts: {}, mk: "", ro: null, mo: [], src: false, moved: false };
    const me = V, get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    Promise.all([D || fetch(API).then(r => r.json()), TILES || get(API + "/tiles.geojson"), FULL || get("/static/projections/tiles_full.json")]).then(([d, t, full]) => {
      if (V !== me) return;
      if (!d || d.available === false || !d.groups) throw new Error((d && d.message) || "no data");
      D = d; FULL = full && full.context ? full : { rated: {}, context: { type: "FeatureCollection", features: [] } };
      if (t && t.features && !TILES) { TILES = t; t.features.forEach(f => { const m = f.properties.tile_id.match(/N([\d.]+)_E([\d.]+)/); f.lat = +m[1]; f.lon = +m[2]; f.reg = regionOf(f.lat, f.lon); if (FULL.rated[f.properties.tile_id]) f.geometry = FULL.rated[f.properties.tile_id]; }); FULL.context.features.forEach(f => { f.properties.reg = regionOf(f.properties.lat, f.properties.lon); }); }
      if (!periods().includes(P.per)) P.per = periods()[0];
      V.pos = periods().indexOf(P.per);
      build(); wire(); renderAll(); startMap();
      V.ro = new ResizeObserver(() => { if (V === me && el.getClientRects().length) { if (V.map) V.map.resize(); else if (!$(el, ".prj-fb").hidden) drawFallback(); } });
      V.ro.observe($(el, ".cw-mapwrap"));
      const win = document.getElementById("win"), body = document.getElementById("win-body");
      const gone = () => { if (V === me && (!document.body.contains(el) || (win && !win.classList.contains("open")))) destroy(); };
      if (win) { const a = new MutationObserver(gone); a.observe(win, { attributes: true, attributeFilter: ["class"] }); V.mo.push(a); }
      if (body) { const b = new MutationObserver(gone); b.observe(body, { childList: true }); V.mo.push(b); }
      resume();
    }).catch(e => { if (V === me) el.innerHTML = `<p class="desc cw-load">The projections need the portal server and the imported package (data/climate/projections). ${esc(e.message || "")}</p>`; });
  }
  function destroy() {
    if (!V) return;
    if (V.raf) cancelAnimationFrame(V.raf); if (V.ro) V.ro.disconnect(); V.mo.forEach(m => m.disconnect());
    if (V.root) V.root.classList.remove("mapfull");
    if (V.map) try { V.map.remove(); } catch { /* already gone */ }
    hideTip(); V = null;
  }
  function resume() { if (V && V.auto && !V.playing && V.el.getClientRects().length && $(V.el, ".cw-ctl") && !reduce()) play(); }

  /* ------------------------------------------------------------------ data helpers */
  const group = g => D.groups.find(x => x.group === g);
  const cell = (g, sc, p, m) => { const G = group(g); return G && G.series[sc] && G.series[sc][p] ? G.series[sc][p][m] : null; };
  const periods = () => P.hz === "20" ? D.periods_20yr : D.periods_5yr;
  const yearOf = p => p.includes("-") ? (+p.slice(0, 4) + +p.slice(5)) / 2 : +p;
  const baseLabel = () => D.baseline_period.replace("-", "–");
  function setHorizon(hz) {
    if (hz === P.hz) return;
    const y = yearOf(P.per);
    if (hz === "20") P.per = D.periods_20yr.find(p => y >= +p.slice(0, 4) && y <= +p.slice(5)) || D.periods_20yr[0];
    else P.per = D.periods_5yr.reduce((a, b) => Math.abs(+b - y) < Math.abs(+a - y) ? b : a);
    P.hz = hz; V.pos = periods().indexOf(P.per);
  }

  /* ------------------------------------------------------------------ markup: the Historical page's own structure and classes */
  function build() {
    const opt = g => `<option value="${esc(g)}">${esc(LABEL[g])}</option>`, n = TILES ? TILES.features.length : 0, tabs = [["trends", "Projection Trends", '<path d="M4 19V5M4 19h16M7.500 15l3.500-4.500 3 2.500 5-6.500"/>'], ["regions", "Regions", '<path d="M3 20l6-11 4 6 3-4 5 9z"/>'], ["stats", "Statistics", '<path d="M5 20v-8M12 20V5M19 20v-5"/>'], ["data", "Data Explorer", '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>']];
    V.el.innerHTML = `
    <aside class="cw-ctl" aria-label="Projection control">
      <h3>${ic('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6"/>', 22)}Projection Control</h3>
      <div class="cw-f"><label>Dataset</label><div class="cw-ro">${ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 16)}<span>NASA NEX-GDDP-CMIP6</span></div><p class="cw-ok"><i></i>Loaded · ${n} tiles × ${D.periods_5yr.length + D.periods_20yr.length} periods</p></div>
      <div class="cw-f"><label>${ic('<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>', 15)}Variable selection</label><select data-pm aria-label="Map variable">${Object.keys(MET).map(k => `<option value="${k}">${esc(MET[k].n)}</option>`).join("")}</select></div>
      <div class="cw-f"><label>${ic('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', 15)}Emission scenario</label><div class="cw-seg" role="group" aria-label="Emission scenario">${Object.keys(SC).map(k => `<button type="button" data-psc="${k}" title="Scenario ${SC[k].l}">${SC[k].s}</button>`).join("")}</div></div>
      <div class="cw-f"><label>${ic('<path d="M3 20l6-11 4 6 3-4 5 9z"/>', 15)}Statistics for</label><select data-pg aria-label="Statistics area">${opt(ALL)}<optgroup label="Mountain regions">${REGIONS.map(opt).join("")}</optgroup><optgroup label="Elevation">${BANDS.map(opt).join("")}</optgroup></select></div>
      <div class="cw-f prj-dimf"><label>${ic('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>', 15)}Dimensions</label><div class="cw-dims"><div><small>Tiles</small><b>${n}</b></div><div><small>No data</small><b>${FULL.context.features.length}</b></div><div><small>Areas</small><b>${D.groups.length}</b></div><div><small>Cell</small><b>0.25°</b></div></div></div>
      <div class="cw-f"><label>${ic('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', 15)}Time horizon</label><div class="cw-seg" role="group" aria-label="Time horizon"><button type="button" data-phz="5">5-year</button><button type="button" data-phz="20">20-year</button></div></div>
      <div class="cw-f"><label>${ic('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.500 2M9 2h6"/>', 15)}Time slider</label><div class="cw-rng"><input type="range" class="prj-sl" min="0" step="any" value="0" aria-label="Period"></div><div class="cw-ends"><span data-pe0></span><span data-pe1></span></div></div>
      <button type="button" class="cw-playbig" data-pplay><span data-pi>▶</span><b data-pl>Play Animation</b></button>
      <div class="cw-f"><label>${ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 15)}Quick select dates</label><div class="cw-rowa"><select data-pquick aria-label="20-year period">${D.periods_20yr.map(q => `<option value="${q}">${per(q)}</option>`).join("")}</select><button type="button" class="cw-apply" data-papply>Apply</button></div></div>
      <p class="prj-src">Projections of weather conditions, not of avalanche numbers or losses. 5-year periods swing with natural climate; use the 20-year periods for trends.</p>
    </aside>
    <section class="cw-mapcol">
      <div class="cw-tabs" role="tablist" aria-label="Map layer">${Object.keys(MET).map(k => `<button type="button" role="tab" data-ptm="${k}">${ic(MET[k].ic, 17)}${MET[k].t}</button>`).join("")}
        <button type="button" class="cw-full-b" data-pfull aria-pressed="false"><span>View Full Map</span>${ic('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>', 15)}</button></div>
      <div class="cw-mapwrap"><div class="cw-gl" id="prj-gl"></div><div class="prj-fb" hidden></div>
        <div class="cw-lgv prj-lg" aria-label="Colour scale"><b data-lgt></b><i data-lgb></i><div data-lgl></div></div>
        <div class="cw-mtag"><b data-mt></b><span data-mn></span></div></div>
    </section>
    <aside class="cw-sum">
      <div class="cw-card cw-ys"><header><h3>${ic('<path d="M5 20v-8M12 20V5M19 20v-5"/>', 22)}Period Summary</h3><div class="cw-step"><button type="button" data-pst="-1" aria-label="Previous period">‹</button><b data-pnow2></b><button type="button" data-pst="1" aria-label="Next period">›</button></div></header><div class="cw-rows" data-prows></div></div>
      <div class="cw-card cw-ins"><h4>${ic('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.500 10.900c.6.500 1 1.200 1 2.100h5c0-.900.400-1.600 1-2.100A6 6 0 0 0 12 3z"/>', 17)}Key Insights</h4><p data-pins></p></div>
    </aside>
    <section class="cw-low">
      <div class="cw-ltabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" data-plt="${t[0]}">${ic(t[2], 16)}${t[1]}</button>`).join("")}
        <div class="cw-tape" aria-hidden="true"><span class="lv"><i></i><b data-pty></b><small>change from the previous period</small></span><div class="tw"><div class="tr" data-ptr></div></div></div><span class="cw-ltnote" data-pltn></span></div>
      <div class="cw-lp" data-plp="trends"><div class="cw-charts">${CH.map(c => `<article class="cw-ch" data-cv="${c.k}" style="--lc:${c.c}"><header>${ic(c.ic, 15)}<b>${c.t}</b><em>${c.u}</em></header><div class="cw-chs"><div class="cw-tip" hidden></div></div></article>`).join("")}</div></div>
      <div class="cw-lp" data-plp="regions" hidden></div><div class="cw-lp" data-plp="stats" hidden></div><div class="cw-lp" data-plp="data" hidden></div>
    </section>
    <div class="cw-pb" role="group" aria-label="Playback">
      <button type="button" class="cw-rb" data-pst="-1" aria-label="Previous period" title="Previous period (←)">${ic('<path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z" fill="currentColor"/>')}</button>
      <button type="button" class="cw-rb pp" data-pplay aria-label="Play" title="Play / pause (space)"><span data-pi>▶</span></button>
      <button type="button" class="cw-rb" data-pst="1" aria-label="Next period" title="Next period (→)">${ic('<path d="M13 6l7 6-7 6zM4 6l7 6-7 6z" fill="currentColor"/>')}</button>
      <label class="cw-spd">Speed <select data-pspeed aria-label="Periods per second"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
      <div class="cw-pbt"><div class="cw-rng"><input type="range" class="prj-sl" min="0" step="any" value="0" aria-label="Period"></div><div class="cw-ticks" data-pticks></div></div>
      <div class="cw-now"><b><span data-year></span> <em>/ 2100</em></b><small data-pnows></small></div>
      <label class="cw-go">${ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', 16)}Go to Period<select data-pgo aria-label="Go to period"></select></label>
    </div>`;
    // the small figures in the banner, like the Historical page's
    if (V.root && !$(V.root, ".prj-mini")) { const hero = $(V.root, ".cx-hero"); if (hero) hero.insertAdjacentHTML("beforeend", `<div class="cd-mini prj-mini"><div><b>${n}</b><span>tiles</span></div><div><b>2</b><span>scenarios</span></div><div><b>${D.periods_5yr.length + D.periods_20yr.length}</b><span>periods</span></div><div><b>${new Set(Object.values(D.scenarios).flatMap(s => s.models || [])).size}</b><span>climate models</span></div></div>`); }
  }

  function wire() {
    const el = V.el;
    $$(el, "[data-psc]").forEach(b => b.onclick = () => { P.sc = b.dataset.psc; renderAll(); });
    $$(el, "[data-phz]").forEach(b => b.onclick = () => { stop(); setHorizon(b.dataset.phz); renderAll(); });
    $$(el, "[data-ptm]").forEach(b => b.onclick = () => setLayer(b.dataset.ptm));
    $(el, "[data-pm]").onchange = e => setLayer(e.target.value);
    $(el, "[data-pg]").onchange = e => { P.g = e.target.value; renderAll(); };
    $$(el, "[data-pplay]").forEach(b => b.onclick = () => V.playing ? stop() : play());
    $$(el, "[data-pst]").forEach(b => b.onclick = () => { stop(); const n = periods().length; setIdx((periods().indexOf(P.per) + +b.dataset.pst + n) % n); });
    $$(el, ".prj-sl").forEach(s => s.oninput = e => { stop(); V.pos = +e.target.value; setIdx(Math.round(V.pos), true); syncSlider(); });
    $(el, "[data-papply]").onclick = () => { stop(); P.hz = "20"; P.per = $(el, "[data-pquick]").value; V.pos = periods().indexOf(P.per); renderAll(); };
    $(el, "[data-pspeed]").onchange = e => { P.speed = +e.target.value; };
    $(el, "[data-pgo]").onchange = e => { stop(); setIdx(periods().indexOf(e.target.value)); };
    $$(el, "[data-plt]").forEach(b => b.onclick = () => { P.tab = b.dataset.plt; renderLower(); });
    $(el, "[data-pfull]").onclick = () => setFull(!el.classList.contains("mapfull"));
    el.addEventListener("keydown", e => {
      if (e.target.matches("select, input")) return;
      if (e.key === "Escape" && el.classList.contains("mapfull")) { setFull(false); e.stopPropagation(); return; }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.target.matches("[data-view]")) { e.preventDefault(); stop(); const n = periods().length; setIdx((periods().indexOf(P.per) + (e.key === "ArrowRight" ? 1 : -1) + n) % n); }
      else if (e.key === " " && !e.target.matches("button")) { e.preventDefault(); V.playing ? stop() : play(); }
    });
  }
  function setFull(on) { const { el, root } = V; el.classList.toggle("mapfull", on); if (root) root.classList.toggle("mapfull", on); const b = $(el, "[data-pfull]"); b.setAttribute("aria-pressed", on); $(b, "span").textContent = on ? "Exit Full Map" : "View Full Map"; if (V.map) V.map.resize(); }
  function setLayer(k) { P.tm = k; renderTop(); renderMap(); if (P.tab === "regions") renderLower(); }

  /* ------------------------------------------------------------------ playback: same as the Historical page, loops until paused */
  function play() { if (V.playing) return; V.auto = true; V.playing = true; V.hold = 0; V.tapeI = null; V.pos = periods().indexOf(P.per); V.last = performance.now(); V.el.classList.add("live"); setPlayBtn(); markCharts(); V.raf = requestAnimationFrame(frame); }
  function stop(keepAuto) { if (!V) return; if (!keepAuto) V.auto = false; V.playing = false; if (V.raf) cancelAnimationFrame(V.raf); V.raf = 0; V.el.classList.remove("live"); if (!$(V.el, ".cw-ctl")) return; setPlayBtn(); Object.values(V.charts).forEach(c => $(c.svg, ".clp").setAttribute("width", c.Wd)); V.pos = periods().indexOf(P.per); syncSlider(); markCharts(); }
  function setPlayBtn() { $$(V.el, "[data-pi]").forEach(i => { i.textContent = V.playing ? "❚❚" : "▶"; }); $(V.el, "[data-pl]").textContent = V.playing ? "Pause Animation" : "Play Animation"; const b = $(V.el, ".cw-rb.pp"); b.classList.toggle("on", V.playing); b.setAttribute("aria-label", V.playing ? "Pause" : "Play"); }
  function frame(ts) {
    if (!V || !V.playing) return;
    if (!V.el.getClientRects().length) { stop(true); return; }   // view hidden: it carries on when shown again
    const dt = Math.min(100, ts - V.last) / 1000, n = periods().length - 1; V.last = ts;
    if (V.hold > 0) { V.hold -= dt; if (V.hold <= 0) { V.hold = 0; V.pos = 0; setIdx(0, true); } }
    else { V.pos += P.speed * dt * (P.hz === "20" ? .5 : 1); if (V.pos >= n) { V.pos = n; V.hold = 1; } const r = Math.round(V.pos); if (periods()[r] !== P.per) setIdx(r, true); }
    syncSlider(); liveCharts();
    V.raf = requestAnimationFrame(frame);
  }
  function setIdx(i, keepPos) { P.per = periods()[i]; if (!keepPos) V.pos = i; renderTop(); renderMap(); markCharts(); syncSlider(); if (P.tab === "regions" || P.tab === "stats") renderLower(); hideTip(); }
  function syncSlider() { const n = Math.max(1, periods().length - 1); $$(V.el, ".prj-sl").forEach(s => { s.max = n; s.value = V.pos; s.style.setProperty("--p", (V.pos / n * 100) + "%"); }); }

  /* ------------------------------------------------------------------ rendering */
  function renderAll() { if (!V || !$(V.el, ".cw-ctl")) return; hideTip(); renderTop(); ticks(); buildCharts(); renderMap(); renderLower(); syncSlider(); }
  function ticks() {
    const ps = periods(), n = ps.length - 1, el = V.el;
    $(el, "[data-pticks]").innerHTML = ps.map((p, i) => P.hz === "20" || i % 3 === 0 ? `<button type="button" data-pj="${i}" style="left:${i / n * 100}%">${per(p)}</button>` : `<button type="button" class="yd" data-pj="${i}" style="left:${i / n * 100}%" aria-label="${per(p)}" title="${per(p)}"></button>`).join("");
    $$(el, "[data-pj]").forEach(b => b.onclick = () => { stop(); setIdx(+b.dataset.pj); });
    $(el, "[data-pe0]").textContent = per(ps[0]); $(el, "[data-pe1]").textContent = per(ps[n]);
    $(el, "[data-pgo]").innerHTML = ps.map(p => `<option value="${p}">${per(p)}</option>`).join(""); $(el, "[data-pgo]").value = P.per;
  }
  function renderTop() {
    const el = V.el, past = baseLabel(), a = cell(P.g, P.sc, P.per, "alarm_days_moderate"), s = cell(P.g, P.sc, P.per, "snowfall_mm");
    const on = (q, attr, v) => $$(el, q).forEach(b => { const x = b.dataset[attr] === v; b.classList.toggle("on", x); });
    on("[data-psc]", "psc", P.sc); on("[data-phz]", "phz", P.hz); on("[data-ptm]", "ptm", P.tm);
    $$(el, "[data-ptm]").forEach(b => b.setAttribute("aria-selected", b.dataset.ptm === P.tm));
    $(el, "[data-pm]").value = P.tm; $(el, "[data-pg]").value = P.g; $(el, "[data-pspeed]").value = P.speed;
    const go = $(el, "[data-pgo]"); if (go.options.length) go.value = P.per;
    $(el, "[data-year]").textContent = per(P.per); $(el, "[data-pnow2]").textContent = per(P.per);
    $(el, "[data-pnows]").textContent = P.hz === "20" ? `20-year average · ${SC[P.sc].n.toLowerCase()}` : `Winters ${+P.per - 4}–${P.per} · ${SC[P.sc].n.toLowerCase()}`;
    $(el, "[data-prows]").innerHTML = ROWS.map(([k, m, l, u, d, col, ico]) => { const c = cell(P.g, P.sc, P.per, m), b = group(P.g).baseline[m], same = +Math.abs(c.change).toFixed(d) === 0;
      return `<button type="button" class="cw-r${k === P.tm ? " on" : ""}" data-prv="${k}" style="--lc:${col}" title="Was ${nf(b, d)} ${u} in ${past}"><i>${ic(ico, 26)}</i><span><small>${esc(l)} · was ${nf(b, d)}</small><b>${nf(c.value, d)} <em>${esc(u)}</em>${same ? "" : `<span class="cw-d" style="color:${dirCol(c.change)}">${c.change > 0 ? "▲" : "▼"} ${nf(Math.abs(c.change), d)}${u === "%" ? " pts" : ""}</span>`}</b></span></button>`; }).join("");
    $$(el, "[data-prv]").forEach(b => b.onclick = () => setLayer(b.dataset.prv));
    const part = (d, c, more, less, noun) => +Math.abs(c.change).toFixed(d) === 0 ? `no change in ${noun}` : `${nf(Math.abs(c.change), d)} ${c.change > 0 ? more : less} ${noun}`, n = a.models_more + a.models_less;
    $(el, "[data-pins]").textContent = `${LABEL[P.g]}, ${per(P.per)}: ${part(2, a, "more", "fewer", "alarm days")} and ${part(1, s, "mm more", "mm less", "snowfall")} a winter than in ${past}. Climate models (${n}): ${a.models_less} fewer alarm days, ${a.models_more} more.`;
    $(el, "[data-pltn]").textContent = `${LABEL[P.g]} · ${SC[P.sc].n} · click a chart to jump to that period`;
  }

  /* ---------- tooltip (on body, so no panel clips it) ---------- */
  let TIP = null;
  function showTip(e, h) { if (!TIP) { TIP = document.createElement("div"); TIP.className = "prj-tip"; document.body.appendChild(TIP); } TIP.innerHTML = h; TIP.style.display = "grid"; const r = TIP.getBoundingClientRect();
    TIP.style.left = clamp(e.clientX + 14, 6, innerWidth - r.width - 6) + "px"; TIP.style.top = clamp(e.clientY - r.height - 12, 6, innerHeight - r.height - 6) + "px"; }
  function hideTip() { if (TIP) TIP.style.display = "none"; }

  /* ------------------------------------------------------------------ six charts: same drawing as the Historical page, the values are the projected ones */
  const niceStep = s => { const p = Math.pow(10, Math.floor(Math.log10(s || 1))), f = s / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
  function buildCharts() {
    const ps = periods(), n = ps.length, xs = ps.map(yearOf), Wd = 250, Ht = 150, ML = 30, MR = 10, MT = 22, MB = 20, x0 = xs[0], x1 = xs[n - 1], X = y => ML + (y - x0) / (x1 - x0) * (Wd - ML - MR);
    V.charts = {};
    CH.forEach(c => {
      const host = $(V.el, `.cw-ch[data-cv="${c.k}"] .cw-chs`), vals = ps.map(p => cell(P.g, P.sc, p, c.k).value), base = group(P.g).baseline[c.k];
      let lo = Math.min(...vals, base), hi = Math.max(...vals, base); const pad = (hi - lo || 1) * .1; lo -= pad; hi += pad;
      const step = niceStep((hi - lo) / 3), Yp = v => MT + (hi - v) / (hi - lo) * (Ht - MT - MB);
      let g = ""; for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) g += `<line x1="${ML}" x2="${Wd - MR}" y1="${Yp(t)}" y2="${Yp(t)}" class="gr"/><text x="${ML - 4}" y="${Yp(t) + 3}" class="ay" text-anchor="end">${nf(t + 0, step < 1 ? (step < .1 ? 2 : 1) : 0)}</text>`;
      (P.hz === "20" ? [[xs[0], "2021"], [xs[n - 1], "2100"]] : [[2030, 2030], [2065, 2065], [2100, 2100]]).forEach(([y, t], i, a) => { g += `<text x="${X(y)}" y="${Ht - 6}" class="ay" text-anchor="${i === a.length - 1 ? "end" : i === 0 && P.hz === "20" ? "start" : "middle"}">${t}</text>`; });
      const line = vals.map((v, i) => `${i ? "L" : "M"}${X(xs[i]).toFixed(1)},${Yp(v).toFixed(1)}`).join("");
      g += `<defs><linearGradient id="prg-${c.k}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c.c}" stop-opacity=".32"/><stop offset="1" stop-color="${c.c}" stop-opacity="0"/></linearGradient><clipPath id="prc-${c.k}"><rect class="clp" x="0" y="0" width="${Wd}" height="${Ht}"/></clipPath></defs>`;
      g += `<line class="prj-base" x1="${ML}" x2="${Wd - MR}" y1="${Yp(base)}" y2="${Yp(base)}"><title>${baseLabel()}: ${nf(base, c.d)} ${c.u}</title></line><path d="${line}" class="cl gh" stroke="${c.c}"/><g clip-path="url(#prc-${c.k})"><path d="${line}L${X(x1)},${Ht - MB}L${X(x0)},${Ht - MB}Z" fill="url(#prg-${c.k})"/><path d="${line}" class="cl" stroke="${c.c}"/></g>`;
      g += `<line class="lvl" x1="${ML}" stroke="${c.c}"/><line class="cur" y1="${MT}" y2="${Ht - MB}"/><circle class="rng" r="4" fill="${c.c}"/><circle class="cdot" r="4" fill="${c.c}"/><g class="call"><rect rx="5" height="17" y="1"/><text y="13" text-anchor="middle"></text></g><line class="xh" y1="${MT}" y2="${Ht - MB}" style="display:none"/><rect class="hit" x="${ML}" y="${MT}" width="${Wd - ML - MR}" height="${Ht - MT - MB}"/>`;
      const old = $(host, "svg"); if (old) old.remove();
      host.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="${esc(c.t)}, ${esc(LABEL[P.g])}, projected to 2100">${g}</svg>`);
      const svg = $(host, "svg"), tip = $(host, ".cw-tip"), xh = $(svg, ".xh"), hit = $(svg, ".hit");
      V.charts[c.k] = { c, X, Yp, xs, svg, vals, Wd };
      const at = e => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()), y = x0 + (q.x - ML) / (Wd - ML - MR) * (x1 - x0); let b = 0; xs.forEach((v, i) => { if (Math.abs(v - y) < Math.abs(xs[b] - y)) b = i; }); return b; };
      hit.onmousemove = e => { const i = at(e), p = ps[i]; xh.setAttribute("x1", X(xs[i])); xh.setAttribute("x2", X(xs[i])); xh.style.display = "";
        tip.innerHTML = `<b>${per(p)}</b><span>${baseLabel()}<strong>${nf(base, c.d)} ${c.u}</strong></span>` + Object.keys(SC).map(s => `<span>${SC[s].s}<strong>${nf(cell(P.g, s, p, c.k).value, c.d)} ${c.u}</strong></span>`).join(""); tip.hidden = false;
        const r = host.getBoundingClientRect(); tip.style.left = clamp((X(xs[i]) / Wd) * r.width + 10, 0, Math.max(0, r.width - 170)) + "px"; tip.style.bottom = "100%"; tip.style.top = "auto"; };
      hit.onmouseleave = () => { tip.hidden = true; xh.style.display = "none"; };
      hit.onclick = e => { stop(); setIdx(at(e)); };
    });
    markCharts();
  }
  function markCharts() {
    const i = periods().indexOf(P.per); if (i < 0) return;
    Object.values(V.charts).forEach(o => { const val = o.vals[i], x = o.X(o.xs[i]), y = o.Yp(val), S = q => $(o.svg, q), c = o.c;
      S(".cur").setAttribute("x1", x); S(".cur").setAttribute("x2", x); S(".cdot").setAttribute("cx", x); S(".cdot").setAttribute("cy", y);
      const prev = V.playing && i > 0 ? o.vals[i - 1] : null, dir = prev == null ? "" : val > prev ? "up" : val < prev ? "dn" : "";
      S(".call").setAttribute("class", "call " + dir);
      const txt = `${dir === "up" ? "▲ " : dir === "dn" ? "▼ " : ""}${nf(val, c.d)} ${c.u}`, bw = txt.length * 5.7 + 12, bx = clamp(x - bw / 2, 26, o.Wd - bw - 2); o.bw = bw;
      S(".call rect").setAttribute("x", bx); S(".call rect").setAttribute("width", bw); S(".call text").setAttribute("x", bx + bw / 2); S(".call text").textContent = txt; });
    if (V.playing && V.tapeI !== P.per) updateTape();
  }
  function liveCharts() {
    const n = periods().length, i = Math.min(Math.floor(V.pos), n - 2), f = V.pos - i;
    Object.values(V.charts).forEach(o => { const a = o.vals[i], b = o.vals[i + 1], x = o.X(o.xs[i] + (o.xs[i + 1] - o.xs[i]) * f), y = o.Yp(a + (b - a) * f), S = q => $(o.svg, q);
      S(".clp").setAttribute("width", x); S(".cur").setAttribute("x1", x); S(".cur").setAttribute("x2", x); S(".lvl").setAttribute("x2", x); S(".lvl").setAttribute("y1", y); S(".lvl").setAttribute("y2", y);
      [".cdot", ".rng"].forEach(q => { S(q).setAttribute("cx", x); S(q).setAttribute("cy", y); });
      const bx = clamp(x - o.bw / 2, 26, o.Wd - o.bw - 2); S(".call rect").setAttribute("x", bx); S(".call text").setAttribute("x", bx + o.bw / 2); });
  }
  function updateTape() {
    V.tapeI = P.per; const i = periods().indexOf(P.per), el = V.el;
    $(el, "[data-pty]").textContent = per(P.per);
    const items = CH.map(c => { const o = V.charts[c.k]; if (!o) return ""; const v = o.vals[i], ch = i > 0 ? v - o.vals[i - 1] : null, same = ch != null && +Math.abs(ch).toFixed(c.d) === 0;
      return `<span><b>${esc(c.t)}</b> ${nf(v, c.d)} ${esc(c.u)}${ch == null ? "" : ` <em class="${same ? "" : ch > 0 ? "up" : "dn"}">${same ? "=" : (ch > 0 ? "▲ " : "▼ ") + nf(Math.abs(ch), c.d)}</em>`}</span>`; }).join("");
    $(el, "[data-ptr]").innerHTML = items + items;
    const n = $(el, "[data-year]"); n.classList.remove("tk"); void n.getBoundingClientRect(); n.classList.add("tk");
  }

  /* ------------------------------------------------------------------ lower tabs */
  function renderLower() {
    const el = V.el;
    $$(el, "[data-plt]").forEach(b => { const on = b.dataset.plt === P.tab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    $$(el, "[data-plp]").forEach(p => { p.hidden = p.dataset.plp !== P.tab; });
    if (P.tab === "regions") renderRegions(); else if (P.tab === "stats") renderStats(); else if (P.tab === "data") renderData();
  }
  function renderRegions() {
    const R = ROWS.find(r => r[0] === P.tm), [, m, l, u, d] = R, host = $(V.el, '[data-plp="regions"]'), st = host.scrollTop;
    host.innerHTML = `<div class="cw-tw"><table class="cw-tb"><thead><tr><th>${esc(l)}, ${per(P.per)}</th><th>${baseLabel()}</th><th>Projected</th><th>Change</th></tr></thead><tbody>${[ALL, ...REGIONS, ...BANDS].map(g => { const c = cell(g, P.sc, P.per, m), b = group(g).baseline[m];
      return `<tr data-pgr="${esc(g)}" class="${g === P.g ? "on" : ""}"><th>${esc(LABEL[g])}</th><td>${nf(b, d)} ${esc(u)}</td><td><b>${nf(c.value, d)} ${esc(u)}</b></td><td style="color:${dirCol(c.change)}">${c.change > 0 ? "▲" : c.change < 0 ? "▼" : "•"} ${nf(Math.abs(c.change), d)}${u === "%" ? " pts" : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
    host.scrollTop = st;
    $$(host, "[data-pgr]").forEach(r => r.onclick = () => { P.g = r.dataset.pgr; renderAll(); });
  }
  function renderStats() {
    const host = $(V.el, '[data-plp="stats"]'), G = group(P.g), st = host.scrollTop;
    host.innerHTML = `<div class="cw-tw"><table class="cw-tb"><thead><tr><th>${esc(LABEL[P.g])}, ${per(P.per)}, ${SC[P.sc].l}</th><th>${baseLabel()}</th><th>Projected</th><th>Change</th><th>Change %</th><th>Model range</th></tr></thead><tbody>${ALLM.map(([m, t, u]) => { const c = cell(P.g, P.sc, P.per, m);
      return `<tr><th>${esc(t)} <em>${esc(u)}</em></th><td>${nf(G.baseline[m])}</td><td><b>${nf(c.value)}</b></td><td style="color:${dirCol(c.change)}">${sg(c.change)}</td><td style="color:${dirCol(c.change_pct)}">${sg(c.change_pct, 1)} %</td><td>${sg(c.change_pct_min, 0)} to ${sg(c.change_pct_max, 0)} %</td></tr>`; }).join("")}</tbody></table></div>`;
    host.scrollTop = st;
  }
  function renderData() {
    const host = $(V.el, '[data-plp="data"]'); if ($(host, ".prj-nt")) return;
    const by = {}; FULL.context.features.forEach(f => { by[f.properties.why] = (by[f.properties.why] || 0) + 1; }); const n = TILES ? TILES.features.length : 0, ctx = FULL.context.features.length;
    host.innerHTML = `<div class="prj-nt"><div class="cw-dxb"><a href="${API}/projections_by_region.csv" download><b>⇩ All numbers · CSV</b><span>Every area, scenario, period</span></a><a href="${API}" download="projections_summary.json"><b>⇩ Summary · JSON</b><span>The same, structured</span></a><a href="${API}/tiles.geojson" download="projections_tiles.geojson"><b>⇩ Tile layer · GeoJSON</b><span>The map's tiles</span></a></div>
      <p class="cw-fine">Projected change in avalanche-favourable weather (heavy snow with wind, warming after fresh snow) compared with ${esc(baseLabel())}. Based on NASA NEX-GDDP-CMIP6 climate projections (CC0), median and range of the climate models listed. These are projections of weather conditions, not of avalanche numbers or losses; exposure from roads and settlements is not included.</p>
      <p class="cw-fine">5-year windows vary strongly with natural climate variability (for example El Niño); use the 20-year periods for trends. A window labelled 2030 covers winters 2026–2030. Value, change and % are each the median over the models, so value + change can differ slightly from the baseline. Snowfall is in mm of water equivalent. The dashed line on each chart is ${esc(baseLabel())}.</p>
      <p class="cw-fine"><b>Map:</b> ${n} tiles carry projections. ${ctx} grey tiles have no values in the package: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${esc(k)}`).join(", ")}. The tile layer is supplied for ${MAP_PERIODS().map(per).join(", ")} only. <b>Models:</b> ${Object.keys(SC).map(k => `${SC[k].l}: ${esc((D.scenarios[k].models || []).join(", "))}`).join(" · ")}</p>
      <div class="prj-figs">${FIGS.map(f => `<button type="button" data-fig="${f[0]}"><img src="${IMG + f[0]}" alt="${esc(f[1])}" loading="lazy"><span>${esc(f[1])}</span></button>`).join("")}</div></div>`;
    $$(host, "[data-fig]").forEach(b => b.onclick = () => window.lightbox && lightbox(IMG + b.dataset.fig, b.textContent.trim()));
  }

  /* ------------------------------------------------------------------ map: the package's own tiles on the Historical page's map */
  const MAP_PERIODS = () => (TILES && TILES.metadata && TILES.metadata.periods) || [];
  function mapPeriod() { const all = MAP_PERIODS(); if (all.includes(P.per)) return { p: P.per, near: false }; const same = all.filter(q => q.includes("-") === P.per.includes("-")), y = yearOf(P.per); return { p: (same.length ? same : all).reduce((a, b) => Math.abs(yearOf(b) - y) < Math.abs(yearOf(a) - y) ? b : a), near: true }; }
  const regionLabel = g => { const M = MET[P.tm], c = cell(g, P.sc, P.per, M.m), b = group(g).baseline[M.m], u = M.m === "snow_share_pct" ? "%" : M.m === "snowfall_mm" ? " mm" : " days", d = M.m === "snowfall_mm" || M.m === "snow_share_pct" ? 0 : 1; return `${nf(b, d)}${u === "%" ? "%" : ""} → ${nf(c.value, d)}${u}`; };
  const scaleMax = k => MET[k].pts ? 35 : 100;
  function colorFor(v, k) { if (v == null) return NODATA; const t = clamp(v / scaleMax(k), -1, 1); let i = 0; while (i < RAMP_AT.length - 2 && t > RAMP_AT[i + 1]) i++; const f = (t - RAMP_AT[i]) / (RAMP_AT[i + 1] - RAMP_AT[i]), a = RAMP[i], b = RAMP[i + 1], h = (s, o) => parseInt(s.slice(o, o + 2), 16); return `rgb(${[1, 3, 5].map(o => Math.round(h(a, o) + (h(b, o) - h(a, o)) * f)).join(",")})`; }
  const fillExpr = k => { const M = scaleMax(k); return ["case", ["==", ["get", "v"], null], NODATA, ["interpolate", ["linear"], ["get", "v"], ...RAMP_AT.flatMap((t, i) => [t * M, RAMP[i]])]]; };
  const regionSel = () => REGIONS.includes(P.g);
  function mapFC() { const { p } = mapPeriod(), key = `${P.sc}_${p}_${P.tm}`; return { type: "FeatureCollection", features: TILES.features.map(f => { const v = f.properties[key]; return { type: "Feature", geometry: f.geometry, properties: { tile_id: f.properties.tile_id, v: v == null ? null : v, on: !regionSel() || f.reg === P.g } }; }) }; }
  function contextFC() { return { type: "FeatureCollection", features: FULL.context.features.map(f => ({ type: "Feature", geometry: f.geometry, properties: { tile_id: f.properties.tile_id, on: !regionSel() || f.properties.reg === P.g } })) }; }
  function renderMap() {
    const el = V.el; if (!TILES) { $(el, ".cw-mapwrap").innerHTML = `<p class="cw-load">The tile layer is not available.</p>`; return; }
    const { p, near } = mapPeriod(), M = MET[P.tm];
    $(el, "[data-mt]").textContent = `${M.n}: where it changes`;
    $(el, "[data-mn]").textContent = `${SC[P.sc].n} · map colours for ${per(p)}${near ? " (closest supplied)" : ""} · hover for a tile's value`;
    $(el, "[data-lgt]").textContent = `vs ${baseLabel()}`;
    $(el, "[data-lgb]").style.background = `linear-gradient(0deg,${RAMP_AT.map((t, i) => `${RAMP[i]} ${(t + 1) * 50}%`).join(",")})`;
    $(el, "[data-lgl]").innerHTML = `<span style="bottom:100%">More</span><span style="bottom:50%">Same</span><span style="bottom:0%">Less</span>`;
    if (V.map && V.src) {
      const key = `${P.sc}|${p}|${P.tm}|${P.g}`;
      if (key !== V.mk) { V.mk = key; V.map.getSource("prj-t").setData(mapFC()); V.map.getSource("prj-c").setData(contextFC()); V.map.setPaintProperty("prj-fill", "fill-color", fillExpr(P.tm)); }
      $$(el, ".prj-rl").forEach(n => { const g = n.dataset.g, t = regionLabel(g); n.classList.toggle("on", g === P.g); n.querySelector("b").textContent = t; n.setAttribute("aria-label", `${LABEL[g]}: ${t}`); });
    } else if (!$(el, ".prj-fb").hidden) drawFallback();
  }
  const tileWord = (v, M) => { if (v == null) return "no past value to compare"; const a = Math.abs(v); if (+a.toFixed(0) === 0) return "about the same"; return M.pts ? `${nf(a, 0)} points ${v > 0 ? "higher" : "lower"}` : `${nf(a, 0)}% ${v > 0 ? "more" : "less"}`; };
  function tileTip(id) { const f = TILES.features.find(x => x.properties.tile_id === id), pr = f.properties, { p } = mapPeriod();
    return `<b>${esc(LABEL[f.reg])}</b><small>Elevation about ${nf(pr.elev_m, 0)} m · ${per(p)} against ${baseLabel()}</small>` + Object.keys(MET).map(k => `<span>${esc(MET[k].tile)}<strong>${tileWord(pr[`${P.sc}_${p}_${k}`], MET[k])}</strong></span>`).join(""); }
  function contextTip(id) { const pr = FULL.context.features.find(x => x.properties.tile_id === id).properties; return `<b>${esc(LABEL[pr.reg])}</b><small>Elevation about ${nf(pr.elev_m, 0)} m</small><span>No projection for this tile<strong>${esc(pr.why)}</strong></span>`; }
  async function startMap() {
    const me = V; if (!TILES) return;
    try {
      let Lb = typeof bgMap !== "undefined" && bgMap.lib ? bgMap.lib() : null;
      if (!Lb) { if (!window.maplibregl) { const c = document.createElement("link"); c.rel = "stylesheet"; c.href = "/static/vendor/maplibre-gl.css"; document.head.appendChild(c); await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/static/vendor/maplibre-gl.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); } Lb = { gl: window.maplibregl, engine: "maplibre" }; }
      if (V !== me) return;
      const { gl, engine } = Lb; if (window.MapPerf) MapPerf.tune(gl);
      const grade = { "raster-saturation": -0.45, "raster-brightness-max": 0.62, "raster-contrast": 0.08 };   // same ground as the Historical page
      const style = engine === "mapbox" ? "mapbox://styles/mapbox/satellite-v9" : { version: 8, sources: { sat: { type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } }, layers: [{ id: "prj-ground", type: "background", paint: { "background-color": "#0a1424" } }, { id: "sat", type: "raster", source: "sat", paint: grade }] };
      const o = { container: "prj-gl", style, bounds: VIEW_N, minZoom: 3.4, maxZoom: 10.5, maxBounds: [[50, 16], [92, 44]], dragRotate: false, pitchWithRotate: false, attributionControl: false, fadeDuration: 0 };
      const map = new gl.Map(Object.assign(window.MapPerf ? MapPerf.opts(o) : o, { pixelRatio: Math.min(window.devicePixelRatio || 1, 2) }));
      V.map = map;
      map.addControl(new gl.NavigationControl({ showCompass: true }), "top-left"); map.addControl(new gl.ScaleControl({ maxWidth: 130, unit: "metric" }), "bottom-left"); map.addControl(new gl.AttributionControl({ compact: true }), "bottom-right");
      await new Promise((res, rej) => { map.once("load", res); map.on("error", ev => { const s = ev.error && ev.error.status; if (!map.loaded() && (s === 401 || s === 403)) rej(ev.error); }); setTimeout(() => rej(new Error("map timeout")), 45000); });
      if (V !== me) return;
      if (engine === "mapbox") try { Object.entries(grade).forEach(([k, v]) => map.setPaintProperty("satellite", k, v)); } catch { /* layer id differs */ }
      const [bnd, off] = await Promise.all(["/api/layer/boundaries", "/static/geo/official_view.geojson"].map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)));
      if (V !== me) return;
      const isL = v => ["==", ["get", "layer"], v];
      if (bnd) { map.addSource("prj-b", { type: "geojson", data: bnd }); map.addLayer({ id: "prj-dim", type: "fill", source: "prj-b", filter: isL("pakistan"), paint: { "fill-color": "#020617", "fill-opacity": .34 } }); }
      map.addSource("prj-c", { type: "geojson", data: contextFC() });
      map.addLayer({ id: "prj-cfill", type: "fill", source: "prj-c", paint: { "fill-color": NODATA, "fill-opacity": ["case", ["get", "on"], .5, .12] } });
      map.addSource("prj-t", { type: "geojson", data: mapFC() });
      map.addLayer({ id: "prj-fill", type: "fill", source: "prj-t", paint: { "fill-color": fillExpr(P.tm), "fill-opacity": ["case", ["get", "on"], .9, .15], "fill-opacity-transition": { duration: 300 }, "fill-color-transition": { duration: 300 } } });
      try { map.addSource("prj-sh", window.MapPerf ? MapPerf.dem() : { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12, tiles: [location.origin + "/api/dem/{z}/{x}/{y}.png?v=cop1"] });
        map.addLayer({ id: "prj-rel", type: "hillshade", source: "prj-sh", paint: { "hillshade-exaggeration": .55, "hillshade-illumination-direction": 315, "hillshade-shadow-color": "rgba(0,0,0,.62)", "hillshade-highlight-color": "rgba(255,255,255,.2)", "hillshade-accent-color": "rgba(0,0,0,.28)" } }); } catch { /* engine without hillshade */ }
      if (off) { map.addSource("prj-off", { type: "geojson", data: off }); map.addLayer({ id: "prj-mask", type: "fill", source: "prj-off", filter: isL("mask"), paint: { "fill-color": "#020617", "fill-opacity": .66 } }); map.addLayer({ id: "prj-iiojk", type: "fill", source: "prj-off", filter: isL("iiojk"), paint: { "fill-opacity": 0 } }); }
      map.addLayer({ id: "prj-edge", type: "line", source: "prj-t", paint: { "line-color": "#0a1424", "line-opacity": ["case", ["get", "on"], .35, .05], "line-width": .5 } });
      map.addLayer({ id: "prj-cedge", type: "line", source: "prj-c", paint: { "line-color": "#0a1424", "line-opacity": ["case", ["get", "on"], .28, .05], "line-width": .5 } });
      if (bnd) { map.addLayer({ id: "prj-ctx", type: "fill", source: "prj-b", filter: isL("province"), paint: { "fill-opacity": 0 } });
        map.addLayer({ id: "prj-ctxhl", type: "line", source: "prj-b", filter: ["==", ["get", "name"], ""], paint: { "line-color": "#bae6fd", "line-width": 1.6, "line-opacity": .8 } });
        map.addLayer({ id: "prj-prov", type: "line", source: "prj-b", filter: isL("province"), paint: { "line-color": "#ffffff", "line-opacity": .55, "line-width": .9 } });
        map.addLayer({ id: "prj-loc", type: "line", source: "prj-b", filter: isL("line"), paint: { "line-color": "#fbbf24", "line-width": 1.2, "line-dasharray": [3, 2] } });
        map.addLayer({ id: "prj-glow", type: "line", source: "prj-b", filter: isL("pakistan"), paint: { "line-color": "#67e8f9", "line-opacity": .3, "line-width": 5, "line-blur": 3 } });
        map.addLayer({ id: "prj-out", type: "line", source: "prj-b", filter: isL("pakistan"), paint: { "line-color": "#f0fbff", "line-width": 1.5 } }); }
      map.addSource("prj-h", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "prj-hov", type: "line", source: "prj-h", paint: { "line-color": "#fff", "line-width": 2.2 } });
      const placed = {}; PLACES.forEach(([n, lon, lat, c]) => { const e = document.createElement("span"); e.className = "cw-place ctx" + (c ? " " + c : ""); e.textContent = n; placed[n] = new gl.Marker({ element: e }).setLngLat([lon, lat]).addTo(map); });
      const wrap = $(V.el, ".cw-mapwrap");
      { const e = document.createElement("span"); e.className = "cw-place ctx iiojk"; e.innerHTML = `<i>◂ </i>${IIOJK}<small>disputed territory</small>`; const mk = new gl.Marker({ element: e }).setLngLat([76.6, 33.42]).addTo(map);
        const zoomed = () => { const low = map.getZoom() < 4.6; wrap.classList.toggle("low", low); mk.setLngLat(low ? [83.4, 33.6] : [76.6, 33.42]); placed.AFGHANISTAN.setLngLat(low ? [66.2, 34.4] : [70.15, 35.75]); }; map.on("zoom", zoomed); zoomed(); }
      REGIONS.forEach(g => { const fs = TILES.features.filter(f => f.reg === g); if (!fs.length) return; const lon = fs.reduce((a, f) => a + f.lon, 0) / fs.length, lat = fs.reduce((a, f) => a + f.lat, 0) / fs.length, e = document.createElement("button"); e.type = "button"; e.className = "prj-rl" + (g === P.g ? " on" : ""); e.dataset.g = g; e.innerHTML = `${esc(LABEL[g])}<b></b>`;
        e.onclick = ev => { ev.stopPropagation(); P.g = P.g === g ? ALL : g; renderAll(); }; new gl.Marker({ element: e, anchor: LABEL_SIDE[g] || "center" }).setLngLat([lon, lat]).addTo(map); });
      wrap.insertAdjacentHTML("beforeend", `<div class="cw-scope" role="group" aria-label="Map view"><button type="button" data-scope="n" class="on">Northern study area</button><button type="button" data-scope="pk">All Pakistan</button></div>`);
      $$(wrap, "[data-scope]").forEach(b => b.onclick = () => { $$(wrap, "[data-scope]").forEach(x => x.classList.toggle("on", x === b)); map.fitBounds(b.dataset.scope === "pk" ? VIEW_PK : VIEW_N, { padding: b.dataset.scope === "pk" ? { top: 66, bottom: 40, left: 16, right: 16 } : 0, duration: reduce() ? 0 : 900 }); });
      let hv = null; const hoverGeom = g => map.getSource("prj-h").setData({ type: "FeatureCollection", features: g ? [{ type: "Feature", properties: {}, geometry: g }] : [] });
      const ctxHl = name => { if (map.getLayer("prj-ctxhl")) map.setFilter("prj-ctxhl", ["all", isL("province"), ["==", ["get", "name"], name || ""]]); };
      const leave = () => { hv = null; map.getCanvas().style.cursor = ""; hideTip(); hoverGeom(null); ctxHl(""); };
      map.on("mousemove", e => { const f = map.queryRenderedFeatures(e.point, { layers: ["prj-fill", "prj-cfill"] })[0];
        if (f) { ctxHl(""); map.getCanvas().style.cursor = "pointer"; const id = f.properties.tile_id, rated = f.layer.id === "prj-fill"; if (id !== hv) { hv = id; hoverGeom((rated ? TILES.features : FULL.context.features).find(x => x.properties.tile_id === id).geometry); } showTip(e.originalEvent, rated ? tileTip(id) : contextTip(id)); return; }
        hv = null; hoverGeom(null); map.getCanvas().style.cursor = "";
        const lay = ["prj-ctx", "prj-iiojk"].filter(l => map.getLayer(l)), c = lay.length ? map.queryRenderedFeatures(e.point, { layers: lay })[0] : null, p = c && c.properties; ctxHl(p && p.layer === "province" ? p.name : "");
        showTip(e.originalEvent, !c ? `<b>Outside Pakistan</b><span>Shown for context only</span>` : p.layer === "province" ? `<b>${esc(p.name)}</b><span>Outside the northern study area</span>` : `<b>${IIOJK}</b><span>Disputed territory · no study data here</span>`); });
      map.on("mouseout", leave);
      map.on("click", e => { const f = map.queryRenderedFeatures(e.point, { layers: ["prj-fill", "prj-cfill"] })[0]; if (!f) return; const id = f.properties.tile_id, r = f.layer.id === "prj-fill" ? TILES.features.find(x => x.properties.tile_id === id).reg : FULL.context.features.find(x => x.properties.tile_id === id).properties.reg; P.g = P.g === r ? ALL : r; renderAll(); });
      V.src = true; V.mk = ""; renderMap();
    } catch (e) {
      console.warn("ClimateProjections map:", e); if (V !== me) return;
      if (V.map) try { V.map.remove(); } catch { /* */ } V.map = null; V.src = false;
      $(V.el, ".cw-gl").hidden = true; $(V.el, ".prj-fb").hidden = false; drawFallback();
    }
  }
  // no base map: the same tiles as a plain drawing
  function drawFallback() {
    const host = $(V.el, ".prj-fb"), { p } = mapPeriod(), key = `${P.sc}_${p}_${P.tm}`, S = 100, kY = 1.22, lo0 = 70.3, la1 = 37.3, sel = regionSel();
    const rect = (lat, lon, attrs) => `<rect x="${((lon - .125 - lo0) * S).toFixed(1)}" y="${((la1 - lat - .125) * S * kY).toFixed(1)}" width="${.25 * S - 1}" height="${.25 * S * kY - 1}" rx="2" ${attrs}/>`;
    host.innerHTML = `<svg viewBox="0 0 ${7.9 * S} ${3.7 * S * kY}" role="img" aria-label="Change per tile">
      ${FULL.context.features.map(f => rect(f.properties.lat, f.properties.lon, `data-c="${esc(f.properties.tile_id)}" fill="${NODATA}" opacity="${!sel || f.properties.reg === P.g ? .55 : .12}"`)).join("")}
      ${TILES.features.map(f => rect(f.lat, f.lon, `data-id="${esc(f.properties.tile_id)}" fill="${colorFor(f.properties[key], P.tm)}" opacity="${!sel || f.reg === P.g ? 1 : .18}"`)).join("")}
      ${REGIONS.map(g => { const fs = TILES.features.filter(f => f.reg === g), x = fs.reduce((a, f) => a + f.lon, 0) / fs.length, y = fs.reduce((a, f) => a + f.lat, 0) / fs.length; return `<text data-g="${esc(g)}" x="${((x - lo0) * S).toFixed(1)}" y="${((la1 - y) * S * kY).toFixed(1)}" class="prj-fbl${g === P.g ? " on" : ""}" text-anchor="${LABEL_SIDE[g] === "right" ? "end" : LABEL_SIDE[g] === "left" ? "start" : "middle"}">${esc(LABEL[g])} ${regionLabel(g)}</text>`; }).join("")}</svg>`;
    const pick = g => { P.g = P.g === g ? ALL : g; hideTip(); renderAll(); };
    $$(host, "rect[data-id]").forEach(r => { r.onmousemove = e => showTip(e, tileTip(r.dataset.id)); r.onmouseleave = hideTip; r.onclick = () => pick(TILES.features.find(f => f.properties.tile_id === r.dataset.id).reg); });
    $$(host, "rect[data-c]").forEach(r => { r.onmousemove = e => showTip(e, contextTip(r.dataset.c)); r.onmouseleave = hideTip; r.onclick = () => pick(FULL.context.features.find(f => f.properties.tile_id === r.dataset.c).properties.reg); });
    $$(host, "text").forEach(t => t.onclick = () => pick(t.dataset.g));
  }

  return { html, open, map: () => V && V.map, state: () => Object.assign({}, P, { playing: !!(V && V.playing) }) };
})();
