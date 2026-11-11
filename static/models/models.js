/* Model Framework & Prediction Engines (static/models/, page /models, opened from the home tile in a full-screen overlay).
   Two sub-tabs: Global & Physics Models (overview, climate model, weather forecast model, rule engine) and Machine Learning Models (overview,
   ML model, teacher-student). Every figure on these pages is read from the portal's own files:
     /api/models/framework      forecast/data: calibrated rule, its validation, per-tile thresholds, student score thresholds, region split
     /api/alertforecast/latest  the live ECMWF IFS run of the forecast engine (regions x 15 days, highlights, status)
     /api/climate/projections   the analysis team's CMIP6 (NASA NEX-GDDP) projection package
   Where the package does not contain something the brief asks for (feature importance, ROC curves, the teacher model, live station
   telemetry) the page says so instead of drawing it. Model descriptions follow forecast/pipeline/step4_teacher_student.py. */
const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 0) => n == null || !isFinite(n) ? "—" : (+n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const C = { phys: "#3B82F6", rule: "#F59E0B", ml: "#22C55E", hk: "#22d3ee", kk: "#f43f5e", wh: "#4ade80", lo: "#94a3b8", mod: "#F59E0B", high: "#ef4444" };
const REGC = { "Hindu Kush": C.hk, "Karakoram": C.kk, "West Himalaya": C.wh };
const IC = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICO = {
  close: IC('<path d="M6 6l12 12M18 6L6 18"/>'), home: IC('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'),
  globe: IC('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'), cloud: IC('<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.6 1.5A3.5 3.5 0 0 0 7 18z"/><path d="M8 21l1-2M12 21l1-2M16 21l1-2"/>'),
  rule: IC('<path d="M4 5h16M4 12h10M4 19h6"/><path d="m15 16 2 2 4-4"/>'), brain: IC('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>'),
  net: IC('<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="19" cy="17" r="2"/><path d="M7 7l3 4M7 17l3-4M14 11l3-3M14 13l3 3"/>'),
  distil: IC('<rect x="3" y="3" width="10" height="8" rx="2"/><rect x="13" y="15" width="8" height="6" rx="2"/><path d="M8 11v3a3 3 0 0 0 3 3h2"/>'), grid: IC('<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/>'),
};

// ------------------------------------------------------------------ the owner's film: framed on the overview, an ambient glow everywhere
// The file has black pillarbox bars (content ≈ x 76-1188 of 1280): the frame crops them (aspect 1112:720, object-fit cover) and the
// ambient canvas samples only the picture. The film stays playing while hidden behind content pages, so the glow keeps moving.
const Film = (() => {
  const vid = $("#mf-vid"), fig = $("#mf-film"), amb = $("#mf-amb"), ac = amb.getContext("2d"), btn = $('[data-film="play"]');
  let raf = 0, last = 0;
  const draw = now => { raf = requestAnimationFrame(draw); if (now - last < 66 || vid.readyState < 2) return; last = now;   // ~15 fps is plenty for a glow
    const sw = vid.videoWidth, sh = vid.videoHeight, cx = sw * 0.06, cw = sw * 0.87; ac.drawImage(vid, cx, 0, cw, sh, 0, 0, amb.width, amb.height); };
  const play = () => { if (calm) { vid.currentTime = 0.6; return; } vid.play().catch(() => {}); };
  vid.addEventListener("loadeddata", () => { play(); if (!raf) raf = requestAnimationFrame(draw); });
  if (vid.readyState >= 2) { play(); raf = requestAnimationFrame(draw); }
  btn.onclick = () => { if (vid.paused) { vid.play().catch(() => {}); btn.textContent = "❚❚"; btn.setAttribute("aria-label", "Pause the film"); }
    else { vid.pause(); btn.textContent = "▶"; btn.setAttribute("aria-label", "Play the film"); } };
  $('[data-film="full"]').onclick = () => { (fig.requestFullscreen || fig.webkitRequestFullscreen || (() => {})).call(fig); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) vid.pause(); else if (btn.textContent === "❚❚") play(); });
  // the overview puts the framed film into its own slot; every other page leaves only the ambient glow. Moving the element (not cloning it)
  // keeps one decoder and the play position; it is taken out BEFORE a page is replaced, so the video is never detached and paused.
  const home = fig.parentNode, anchor = fig.nextSibling;
  return {
    place(slot) { if (!slot) return; slot.appendChild(fig); fig.classList.add("inline"); requestAnimationFrame(() => fig.classList.add("on")); },
    unplace() { fig.classList.remove("on", "inline"); if (fig.parentNode !== home) home.insertBefore(fig, anchor); },
    amb(v) { document.body.style.setProperty("--amb", String(v)); },
    hero() {}, dim() {},
    stop() { vid.pause(); cancelAnimationFrame(raf); },
  };
})();
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
const scene = Film;

// ------------------------------------------------------------------ shell
const app = $("#mf-app");
const TABS = [
  { id: "phys", t: "Global & Physics Models", s: "Physics-based simulations & deterministic rules", c: C.phys, ic: ICO.globe,
    pages: [["overview", "Overview & comparison", ICO.grid], ["climate", "Climate model · 2030–2100", ICO.globe], ["weather", "Weather forecast · 15 days", ICO.cloud], ["rules", "Rule engine · thresholds", ICO.rule]] },
  { id: "ml", t: "Machine Learning Models", s: "Data-driven pattern recognition & distillation", c: C.ml, ic: ICO.brain,
    pages: [["overview", "Overview · AI framework", ICO.grid], ["model", "ML model · pattern recognition", ICO.net], ["distill", "Teacher–student · distillation", ICO.distil]] },
];
app.innerHTML = `
  <header class="mf-top">
    <div class="mf-brand"><b>Model Framework &amp; Prediction Engines</b><span>${esc(app.dataset.title || "")} · NDMA decision-support portal</span></div>
    <div class="mf-tele" data-tele aria-label="Data pipelines"></div>
    <button type="button" class="mf-ib" data-a="close" title="Front page (Esc)" aria-label="Back to the front page">${ICO.home}</button>
    <button type="button" class="mf-ib" data-a="close" title="Close (Esc)" aria-label="Close">${ICO.close}</button>
  </header>
  <nav class="mf-nav" aria-label="Model groups">
    <div class="mf-tabs">${TABS.map(t => `<button type="button" class="mf-tab" data-tab="${t.id}" style="--c:${t.c}">${t.ic}<span><b>${esc(t.t)}</b><small>${esc(t.s)}</small></span></button>`).join("")}</div>
    <div class="mf-pages" data-pages></div>
  </nav>
  <main class="mf-main" data-main tabindex="-1"></main>
  <footer class="mf-foot">Decision support only, not an official warning. Physics models and rules are kept apart from the machine-learning score; a score is not a probability unless it is calibrated.
    Sources: forecast/data (analysis team package 2026-10-30), ECMWF IFS open data via Open-Meteo, NASA NEX-GDDP-CMIP6, ERA5 / ERA5-Land.</footer>`;
const close = () => { scene.stop(); if (window.parent !== window) window.parent.postMessage({ type: "kkh:close" }, location.origin); else location.href = "/#home"; };
app.addEventListener("click", e => { const a = e.target.closest("[data-a]"); if (a && a.dataset.a === "close") close(); });
addEventListener("keydown", e => { if (e.key === "Escape") close(); });

// ------------------------------------------------------------------ model inputs (forecast/pipeline/step4_teacher_student.py)
const STU = ["sf_3d_mm", "sf_5d_mm", "sf_7d_mm", "precip_3d_mm", "gust_max_3d_ms", "tmax_rise_3d_c", "tmean_3d_c", "ros_3d_mm", "dhs_3d_m", "dswe_3d_mm", "deg0l_max_3d_m", "mslp_drop_3d_hpa"];
const TEA = ["tg_kpm", "facet_days_30d", "snow_density_kgm3", "snowtemp_mean_c", "melt_3d_mm", "ivt_max_3d_kgms", "tcwv_max_3d_kgm2", "clear_nights_prior_7d", "snow_albedo"];
const NAME = { sf_3d_mm: "3-day snowfall", sf_5d_mm: "5-day snowfall", sf_7d_mm: "7-day snowfall", precip_3d_mm: "3-day precipitation", gust_max_3d_ms: "3-day max gust", tmax_rise_3d_c: "3-day Tmax rise",
  tmean_3d_c: "3-day mean temperature", ros_3d_mm: "rain on snow", dhs_3d_m: "snow-depth change", dswe_3d_mm: "SWE change", deg0l_max_3d_m: "freezing level", mslp_drop_3d_hpa: "pressure drop",
  tg_kpm: "snow temperature gradient", facet_days_30d: "faceting days (30 d)", snow_density_kgm3: "snow density", snowtemp_mean_c: "snow temperature", melt_3d_mm: "3-day melt", ivt_max_3d_kgms: "moisture transport (IVT)",
  tcwv_max_3d_kgm2: "column water vapour", clear_nights_prior_7d: "clear nights (7 d)", snow_albedo: "snow albedo" };
const UP = ["sf_3d_mm", "sf_5d_mm", "sf_7d_mm", "precip_3d_mm", "gust_max_3d_ms", "dhs_3d_m", "dswe_3d_mm"];

// ------------------------------------------------------------------ data
const J = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
const D = { fw: null, al: null, pj: null, src: null, places: [] };
const ready = Promise.all([J("/api/models/framework"), J("/api/alertforecast/latest"), J("/api/climate/projections"), J("/api/settlements"), J("/static/kkh/data/kkh_inventory.json"),
  J("/static/models/media/models_sources.json")])        // NGT's "Models and sources" sheet (avalanche_models_sources.xlsx, 11 Nov 2026), cells unchanged
  .then(([fw, al, pj, st, inv, src]) => {
    Object.assign(D, { fw, al, pj, src });
    const feats = st && (st.features || (st.data && st.data.features) || st.rows) || [];
    feats.forEach(f => { const p = f.properties || f, c = f.geometry && f.geometry.coordinates; if (c && p.name) D.places.push({ name: p.name, lon: c[0], lat: c[1], kind: "town centre (approximate)" }); });
    const h = inv && inv.glaciers && inv.glaciers.rows.find(r => r.Glacier === "Hispar"), hl = h && parseFloat(h["Latitude (°N)"]), ho = h && parseFloat(h["Longitude (°E)"]);
    if (isFinite(hl) && isFinite(ho)) D.places.push({ name: "Hispar", lon: ho, lat: hl, kind: "glacier (KKH inventory coordinate)" });
    tele(); buildNav();
  });

function tele() {
  const al = D.al, st = al && al.status, fw = D.fw, pj = D.pj;
  const chip = (on, label, sub) => `<span class="mf-tc ${on === true ? "ok" : on === false ? "off" : "na"}"><i></i><b>${esc(label)}</b><small>${esc(sub)}</small></span>`;
  $("[data-tele]").innerHTML = [
    chip(st ? !!st.ok : null, "ECMWF IFS", st ? `run ${al.issued_for_date} · ${st.ok ? "ok" : "failed"}` : "no run found"),
    chip(fw && fw.meta && fw.meta.calibrated ? true : null, "ERA5 reanalysis", fw && fw.meta ? `57 winters · ${fw.meta.tile_count} tiles calibrated` : "not loaded"),
    chip(pj && pj.available ? true : null, "CMIP6 SSP2-4.5 / 5-8.5", pj && pj.available ? `NEX-GDDP · ${pj.generated}` : "not loaded"),
    chip(fw && fw.student_file_bytes ? true : null, "ML student", fw && fw.student_file_bytes ? `${fmt(fw.student_file_bytes / 1024, 1)} KB model file` : "not supplied"),
    chip(false, "AWS telemetry", "no station feed connected"),
  ].join("");
}

// ------------------------------------------------------------------ router
let cur = { tab: "phys", page: "overview" };
function go(tab, page, push = true) {
  const T = TABS.find(t => t.id === tab) || TABS[0]; page = T.pages.some(p => p[0] === page) ? page : T.pages[0][0]; cur = { tab: T.id, page };
  if (push) history.replaceState(null, "", `#${T.id}/${page}`);
  $$("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === T.id));
  $("[data-pages]").style.setProperty("--c", T.c);
  $("[data-pages]").innerHTML = T.pages.map(([id, t, ic]) => `<button type="button" class="mf-pg${id === page ? " on" : ""}" data-page="${id}">${ic}${esc(t)}</button>`).join("");
  const isHero = T.id === "phys" && page === "overview";
  Film.unplace();                                                     // (before the page is replaced: see Film)
  document.body.classList.toggle("mf-hero", isHero); document.body.classList.add("mf-onepage");   // every page is one screen (owner's rule)
  FITS.length = 0;
  Film.amb(isHero ? 0.5 : 0.32);
  const main = $("[data-main]"); main.classList.remove("in"); void main.offsetWidth; main.onscroll = null;
  main.innerHTML = `<div class="mf-load"><i></i>Loading the model files…</div>`;
  ready.then(() => { if (cur.tab !== T.id || cur.page !== page) return; main.innerHTML = PAGES[`${T.id}/${page}`](); main.scrollTop = 0; main.classList.add("in"); animate(main); (AFTER[`${T.id}/${page}`] || (() => {}))(main); });
}
app.addEventListener("click", e => { const t = e.target.closest("[data-tab]"); if (t) go(t.dataset.tab, "overview"); const p = e.target.closest("[data-page]"); if (p) go(cur.tab, p.dataset.page);
  const j = e.target.closest("[data-go]"); if (j) { const [a, b] = j.dataset.go.split("/"); go(a, b); } });
addEventListener("hashchange", () => { const [a, b] = location.hash.slice(1).split("/"); go(a, b, false); });

// count-ups, bar growth and line drawing when a page appears
function animate(root) {
  $$("[data-count]", root).forEach(el => { const to = +el.dataset.count, d = +(el.dataset.dec || 0); if (calm) { el.textContent = fmt(to, d); return; }
    const t0 = performance.now(), dur = 1100; const f = now => { const u = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - u, 3); el.textContent = fmt(to * e, d); if (u < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("vis"); io.unobserve(e.target); } }), { threshold: 0.12 });
  $$(".mf-rev", root).forEach(el => io.observe(el));
}

// ------------------------------------------------------------------ small chart kit (SVG)
// charts are drawn at the exact pixel size of their panel (fit()), so text stays 11 px and nothing grows with the window width
const FITS = [];                                                        // re-drawn on resize, cleared on every page change
// measured one frame later: by then the legend / bars added after the chart in the same step are laid out, so the size is final
function fit(el, render) { if (!el) return; const run = () => { if (!el.isConnected) return; const W = Math.max(120, el.clientWidth), H = Math.max(60, el.clientHeight); el.innerHTML = render(W, H); };
  FITS.push(run); el.innerHTML = ""; requestAnimationFrame(run); }
let fitT = 0; addEventListener("resize", () => { clearTimeout(fitT); fitT = setTimeout(() => FITS.forEach(f => f()), 120); });
function lineChart({ series, xs, xLabel = i => xs[i], yFmt = v => fmt(v, 1), h = 240, W = 720, bands = [], refs = [], unit = "", every = 1 }) {
  const H = h, L = 46, R = 12, T = 12, B = 24, iw = W - L - R, ih = H - T - B;
  const all = series.flatMap(s => s.v).concat(bands.flatMap(b => b.lo.concat(b.hi)), refs.map(r => r.v)).filter(v => v != null && isFinite(v));
  let lo = Math.min(0, ...all), hi = Math.max(...all, 1e-9); const pad = (hi - lo) * 0.12 || 1; hi += pad; if (lo < 0) lo -= pad;
  const x = i => L + (xs.length < 2 ? iw / 2 : iw * i / (xs.length - 1)), y = v => T + ih - ih * (v - lo) / (hi - lo);
  const ticks = 4, tk = Array.from({ length: ticks + 1 }, (_, k) => lo + (hi - lo) * k / ticks);
  const path = v => v.map((p, i) => p == null ? null : `${x(i).toFixed(1)},${y(p).toFixed(1)}`).filter(Boolean).join(" L");
  const step = Math.max(every, Math.ceil(xs.length / Math.max(2, Math.floor(iw / 46))));   // x labels never collide
  return `<svg class="mf-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
    ${tk.map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${esc(yFmt(v))}</text>`).join("")}
    ${xs.map((_, i) => i % step && i !== xs.length - 1 ? "" : `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(xLabel(i))}</text>`).join("")}
    ${bands.map(b => `<path d="M${b.hi.map((v, i) => `${x(i)},${y(v)}`).join(" L")} L${b.lo.map((v, i) => `${x(i)},${y(v)}`).reverse().join(" L")} Z" fill="${b.c}" opacity=".16" class="mf-fade"/>`).join("")}
    ${refs.map(r => `<line x1="${L}" x2="${W - R}" y1="${y(r.v)}" y2="${y(r.v)}" stroke="${r.c}" stroke-dasharray="5 5" stroke-width="1.4"/><text x="${W - R}" y="${y(r.v) - 6}" text-anchor="end" fill="${r.c}">${esc(r.t)}</text>`).join("")}
    ${series.map(s => `<path d="M${path(s.v)}" fill="none" stroke="${s.c}" stroke-width="${s.w || 2.6}" stroke-linejoin="round" stroke-linecap="round" pathLength="1" class="mf-draw" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>
      ${s.v.map((v, i) => v == null ? "" : `<circle cx="${x(i)}" cy="${y(v)}" r="${s.dot || 3.4}" fill="#0b1222" stroke="${s.c}" stroke-width="2" class="mf-pop" style="animation-delay:${0.5 + i * 0.04}s"><title>${esc(s.n)} · ${esc(xLabel(i))}: ${esc(yFmt(v))}${unit}</title></circle>`).join("")}`).join("")}
  </svg>`;
}
const legend = items => `<div class="mf-leg">${items.map(([c, t, dash]) => `<span><i style="background:${dash ? `repeating-linear-gradient(90deg,${c} 0 5px,transparent 5px 8px)` : c}"></i>${esc(t)}</span>`).join("")}</div>`;
const card = (title, body, cls = "", c = "") => `<section class="mf-card mf-rev ${cls}" ${c ? `style="--c:${c}"` : ""}>${title ? `<h3>${title}</h3>` : ""}${body}</section>`;
const head = (kicker, title, lede, c, b) => `<header class="mf-ph mf-rev" style="--c:${c}"><span class="mf-k">${kicker}${b ? ` ${badge(b)}` : ""}</span><h1>${title}</h1>${lede ? `<p>${lede}</p>` : ""}</header>`;
const stat = (v, label, d = 0, suf = "", c = "") => `<div class="mf-stat" ${c ? `style="--c:${c}"` : ""}><b><span data-count="${v}" data-dec="${d}">0</span>${suf}</b><small>${label}</small></div>`;
const none = t => `<div class="mf-none">${t}</div>`;
// NGT's sheet: one row per technology, its links, and the CMIP6 model list from the climate row's "Details"
const srcRow = tech => D.src && D.src.models ? D.src.models.find(r => r.Technology === tech) : null;
const srcLinks = tech => D.src && D.src.links ? D.src.links.filter(r => r.Technology === tech) : [];
const cmipModels = () => { const r = srcRow("Climate model"), m = r && /Models:\s*([^.]+)\./.exec(r.Details || ""); return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : []; };
const linkBtns = tech => srcLinks(tech).map(l => `<a class="mf-link" href="${esc(l.URL)}" target="_blank" rel="noopener">${esc(l["Link name"])} ↗</a>`).join("");
// a headline figure that reads at a glance: big number, what it counts, and one plain line of what that means
const kpi = (v, unit, what, plain, c, d = 0) => `<div class="mf-kpi" style="--c:${c}"><b><span data-count="${v}" data-dec="${d}">0</span>${unit ? `<em>${unit}</em>` : ""}</b><span>${what}</span><small>${plain}</small></div>`;
// model-type badge: ● Physics-based · ● Rule engine · ● AI / ML engine (used on every card and nav card)
const BADGE = { phys: ["Physics-based", C.phys], rule: ["Rule engine", C.rule], ml: ["AI / ML engine", C.ml] };
const badge = k => `<span class="mf-badge" style="--c:${BADGE[k][1]}"><i></i>${BADGE[k][0]}</span>`;
// a tiny inline chart for the navigation cards (no axes: shape only)
function spark(vals, c, { bars = false, h = 34, w = 150 } = {}) {
  const v = vals.filter(x => x != null && isFinite(x)); if (!v.length) return `<div class="mf-spk empty">no data</div>`;
  const lo = Math.min(...v, 0), hi = Math.max(...v) || 1, x = i => w * i / Math.max(1, vals.length - 1), y = n => h - 2 - (h - 6) * (n - lo) / ((hi - lo) || 1);
  if (bars) { const bw = w / vals.length; return `<svg class="mf-spk" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${vals.map((n, i) => n == null ? "" : `<rect class="mf-grow" style="animation-delay:${i * .03}s" x="${i * bw + 0.8}" y="${y(n)}" width="${bw - 1.6}" height="${h - 2 - y(n)}" rx="1.5" fill="${c}" opacity="${0.45 + 0.55 * (n - lo) / ((hi - lo) || 1)}"/>`).join("")}</svg>`; }
  const pts = vals.map((n, i) => n == null ? null : `${x(i).toFixed(1)},${y(n).toFixed(1)}`).filter(Boolean);
  return `<svg class="mf-spk" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="M${pts.join(" L")} L${w},${h} L0,${h} Z" fill="${c}" opacity=".14"/><path d="M${pts.join(" L")}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" pathLength="1" class="mf-draw"/></svg>`;
}
// clickable preview card: badge, title, mechanism, a live micro-chart and the figure it is drawn from
const navCard = ({ to, badge: b, t, mech, target, horizon, chart, foot }) => `<button type="button" class="mf-nc mf-rev" data-go="${to}" style="--c:${BADGE[b][1]}">
  <span class="mf-nc-h">${badge(b)}<em>${esc(horizon)}</em></span><b>${esc(t)}</b><span class="mf-nc-m">${esc(mech)}</span>
  <span class="mf-nc-c">${chart}</span><span class="mf-nc-f">${foot}</span><span class="mf-nc-t">${esc(target)}</span><span class="mf-nc-go">Explore ${esc(t.split(" ")[0].toLowerCase())} →</span></button>`;

// ------------------------------------------------------------------ the architecture flow (owner's first reference picture), animated
const FLOW = () => `<div class="mf-flow mf-rev">
  <div class="mf-fr two"><div class="mf-fb" style="--c:${C.phys}"><b>Historical data</b><span>ERA5 / ERA5-Land reanalysis, avalanche records, historical snowfall and temperature</span></div>
    <div class="mf-fb" style="--c:#a855f7"><b>Future climate data</b><span>CMIP6 climate models (NASA NEX-GDDP), SSP2-4.5 and SSP5-8.5</span></div></div>
  <div class="mf-fa"><i></i></div>
  <div class="mf-fr"><div class="mf-fb wide" style="--c:#64748b"><b>Data preprocessing and bias correction</b><span>Quality control, spatial alignment to 0.25° tiles, gaps flagged, bias-corrected model data, each tile's own percentiles</span></div></div>
  <div class="mf-fa"><i></i></div>
  <div class="mf-fr group"><em>Two parallel prediction approaches</em>
    <div class="mf-fb" style="--c:${C.rule}" data-go="phys/rules"><b>Rule engine</b><span>Snowfall thresholds with wind and warming conditions → Low / Moderate / High</span></div>
    <div class="mf-fb" style="--c:${C.ml}" data-go="ml/distill"><b>ML engine</b><span>Teacher–student model and learned risk patterns → a 0–1 risk score</span></div></div>
  <div class="mf-fa"><i></i></div>
  <div class="mf-fr"><div class="mf-fb wide" style="--c:#38bdf8"><b>Risk assessment and validation</b><span>Warnings compared with ML scores, ensemble forecasts and historical performance (documented events and storms)</span></div></div>
  <div class="mf-fa"><i></i></div>
  <div class="mf-fr"><div class="mf-fb wide hero" style="--c:${C.ml}"><b>NDMA Web-GIS decision-support portal</b><span>Maps · warning levels · 10–15-day outlook · 2030–2100 projections</span></div></div>
</div>`;

// ------------------------------------------------------------------ pages
const PAGES = {}, AFTER = {};
// the navigation cards of both overview pages: each one's micro-chart is drawn from the same files as its page
let NAVC = [];
function buildNav() {
  const pj = D.pj, al = D.al, fw = D.fw, g = pj && pj.groups && pj.groups[0], mt = "alarm_days_moderate";
  const ps = pj && pj.periods_5yr || [], pv = g ? ps.map(p => { const q = (g.series.ssp585 || {})[p]; return q && q[mt] ? q[mt].value : null; }) : [];
  const base = g ? g.baseline[mt] : null, lastP = pv.filter(v => v != null).slice(-1)[0];
  const sf = al && al.regions ? al.days.map(d => Math.max(...al.regions.map(r => { const x = r.days.find(y => y.date === d); return x && x.max_sf3d_mm || 0; }))) : [];
  const peak = sf.length ? Math.max(...sf) : null, pkDay = sf.length ? al.days[sf.indexOf(peak)] : null;
  const th = fw && fw.tiles ? fw.tiles.map(t => t.MODERATE_sf3d_mm) : [], hist = Array.from({ length: 14 }, (_, i) => th.filter(v => v >= i * 5 && v < i * 5 + 5).length);
  const vm = fw && fw.validation ? fw.validation.find(r => r.rule.startsWith("final") && r.level === "MODERATE") : null;
  const risk = al && al.regions ? al.days.map(d => Math.max(...al.regions.map(r => { const x = r.days.find(y => y.date === d); return x && x.max_student_risk || 0; }))) : [];
  NAVC = [
    { to: "phys/climate", badge: "phys", t: "Climate Model", mech: "Physics-based mathematical simulation of the whole atmosphere", target: "Long-term projections under SSP2-4.5 & SSP5-8.5", horizon: "2030–2100",
      chart: spark(pv, C.phys), foot: lastP != null && base ? `<b>${fmt(lastP, 2)}</b> alarm days/winter by ${ps.slice(-1)[0]} <em>vs ${fmt(base, 2)} in ${pj.baseline_period}</em>` : "projection package not loaded" },
    { to: "phys/weather", badge: "phys", t: "Weather Forecast Model", mech: "Physics-based numerical weather prediction (ECMWF IFS)", target: "Medium-range avalanche-weather outlook", horizon: "10–15 days",
      chart: spark(sf, "#38bdf8", { bars: true }), foot: peak != null ? `peak <b>${fmt(peak, 1)} mm</b> of snow in 3 days <em>${pkDay}</em>` : "no run loaded" },
    { to: "phys/rules", badge: "rule", t: "Rule-Based System", mech: "Multi-condition thresholds: snowfall, wind, warming", target: "Automated Moderate / High warning levels", horizon: "every run",
      chart: spark(hist, C.rule, { bars: true }), foot: vm ? `<b>${vm.events_caught}/${vm.events}</b> documented events caught <em>${fmt(+vm.false_alarm_rate * 100, 1)}% false alarms</em>` : "thresholds not loaded" },
    { to: "ml/model", badge: "ml", t: "Machine Learning Model", mech: "Gradient-boosted trees on each place's own percentiles", target: "A 0–1 avalanche risk score per tile and day", horizon: "every run",
      chart: spark(risk, C.ml), foot: risk.length ? `highest score in the run <b>${fmt(Math.max(...risk), 3)}</b> <em>uncalibrated</em>` : "no run loaded" },
    { to: "ml/distill", badge: "ml", t: "Teacher–Student Model", mech: "Knowledge distillation into a forecastable student", target: "Runs on ECMWF forecasts and CMIP6 projections", horizon: "every run",
      chart: `<div class="mf-ts">${[["Teacher", STU.length + TEA.length + 3, C.phys], ["Student", STU.length + 2, C.ml]].map(([n, v, c]) => `<span style="--c:${c};--w:${v / (STU.length + TEA.length + 3) * 100}%"><em>${n}</em><i></i><b>${v}</b></span>`).join("")}</div>`,
      foot: fw && fw.student_file_bytes ? `student ships as <b>${fmt(fw.student_file_bytes / 1024, 1)} KB</b> <em>inputs it can get from a forecast</em>` : "model file not supplied" },
  ];
}
// ---- overview: ONE screen, no scrolling (owner's request). Left: the owner's film. Right: the three engines as a pipeline, top to bottom,
// each with one big figure from its own file, one plain sentence, a live mini-chart and its source (NGT's sheet). Every number is read, not typed.
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dShort = s => { const d = new Date(s + "T00:00:00Z"); return isNaN(d) ? s : `${d.getUTCDate()} ${MON3[d.getUTCMonth()]}`; };
const dRange = ds => !ds.length ? "" : ds.length === 1 ? dShort(ds[0]) : `${dShort(ds[0]).split(" ")[0]}–${dShort(ds[ds.length - 1])}`;
function facts() {
  const pj = D.pj, al = D.al, fw = D.fw, F = { cl: null, wx: null, ru: null };
  if (pj && pj.available) {
    const g = pj.groups.find(x => x.group_type === "all") || pj.groups[0], m = "alarm_days_moderate", ps = pj.periods_5yr;
    const last = sc => { const s = g.series[sc] || {}, k = ps.filter(p => s[p] && s[p][m]); return k.length ? { p: k[k.length - 1], ...s[k[k.length - 1]][m] } : null; };
    F.cl = { base: g.baseline[m], s585: last("ssp585"), s245: last("ssp245"), ps, series: ["ssp245", "ssp585"].map(sc => ps.map(p => { const q = (g.series[sc] || {})[p]; return q && q[m] ? q[m].value : null; })) };
  }
  if (al && al.regions) {
    const rn = r => r.region || r.name, all = al.regions.flatMap(r => r.days.map(d => ({ ...d, region: rn(r) })));
    const pk = all.reduce((a, b) => (b.max_sf3d_mm || 0) > (a.max_sf3d_mm || 0) ? b : a, all[0]);
    const byDay = al.days.map(d => { const xs = all.filter(x => x.date === d); return { d, sf: Math.max(...xs.map(x => x.max_sf3d_mm || 0)), lv: Math.max(...xs.map(x => x.max_level ?? 0)) }; });
    const warn = al.regions.map(r => ({ r: rn(r), days: r.days.filter(x => x.tiles_moderate_or_high).map(x => x.date), hi: r.days.some(x => x.tiles_high) })).filter(x => x.days.length);
    const today = al.regions.map(r => ({ r: rn(r), lv: r.days[0] ? r.days[0].max_level : null, n: r.days[0] ? r.days[0].max_level_name : "—" }));
    F.wx = { pk, byDay, warn, today, run: al.issued_for_date, src: al.source, n: al.days.length };
  }
  if (fw && fw.validation) { const v = Object.fromEntries(fw.validation.filter(r => r.rule.startsWith("final")).map(r => [r.level, r])); F.ru = { m: v.MODERATE, h: v.HIGH, tiles: fw.meta && fw.meta.tile_count, s: fw.settings }; }
  return F;
}
function miniClimate(f) {
  // y from 0 (an honest scale: the fall to ~2 days is a real fall, not a zoomed wiggle); the baseline label sits below its line
  const W = 300, H = 112, L = 4, R = 4, T = 6, B = 16, ps = f.ps, n = ps.length, all = f.series.flat().concat([f.base]).filter(v => v != null);
  const lo = 0, hi = Math.max(...all) * 1.05, x = i => L + (W - L - R) * i / (n - 1), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const line = (vals, c, w) => `<path d="M${vals.map((v, i) => v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`).filter(Boolean).join(" L")}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" class="mf-draw"/>`;
  return `<svg class="mf-mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line x1="${L}" x2="${W - R}" y1="${y(f.base)}" y2="${y(f.base)}" stroke="#e2e8f0" stroke-dasharray="4 4" stroke-width="1.2" opacity=".7"/>
    <text x="${W - R}" y="${y(f.base) + 12}" class="mf-mt" text-anchor="end">1995–2014: ${fmt(f.base, 1)} days / winter</text>
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(160,190,230,.18)"/>
    ${line(f.series[0], "#38bdf8", 2.2)}${line(f.series[1], "#f97316", 2.8)}
    <circle cx="${x(n - 1)}" cy="${y(f.series[1][n - 1])}" r="4" fill="#f97316" class="mf-pop" style="animation-delay:1.4s"/>
    <text x="${L}" y="${H - 4}" class="mf-mt">${ps[0]}</text><text x="${W - R}" y="${H - 4}" class="mf-mt" text-anchor="end">${ps[n - 1]}</text></svg>`;
}
function miniWeather(f) {
  const W = 300, H = 112, T = 14, B = 18, n = f.byDay.length, bw = W / n, mx = Math.max(30, ...f.byDay.map(d => d.sf)) * 1.08, y = v => T + (H - T - B) * (1 - v / mx);
  const col = lv => lv >= 2 ? C.high : lv >= 1 ? C.mod : "#38bdf8";
  return `<svg class="mf-mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${[10, 25].map(v => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 25 ? C.high : C.mod}" stroke-dasharray="3 4" stroke-width="1" opacity=".75"/>`).join("")}
    <text x="${W - 2}" y="${y(25) - 3}" class="mf-mt" text-anchor="end">25 mm High floor</text><text x="${W - 2}" y="${y(10) + 10}" class="mf-mt" text-anchor="end">10 mm Moderate floor</text>
    ${f.byDay.map((d, i) => `<rect class="mf-grow" style="animation-delay:${i * 0.035}s" x="${i * bw + 1.5}" y="${y(d.sf)}" width="${bw - 3}" height="${H - B - y(d.sf)}" rx="2" fill="${col(d.lv)}" opacity="${d.lv >= 1 ? 1 : 0.75}"><title>${dShort(d.d)}: ${fmt(d.sf, 1)} mm in 3 days</title></rect>`).join("")}
    <text x="1" y="${H - 4}" class="mf-mt">${dShort(f.byDay[0].d)}</text><text x="${W - 1}" y="${H - 4}" class="mf-mt" text-anchor="end">${dShort(f.byDay[n - 1].d)}</text></svg>`;
}
function miniRule(f) {
  const s = f.s || {}, chip = (t, c) => `<span style="--c:${c}">${t}</span>`;
  return `<div class="mf-logic">
    <div>${chip(`3-day snow ≥ P95 <small>& ≥ ${fmt(s.moderate_sf3d_floor_mm)} mm</small>`, C.phys)}<i>AND</i>${chip("3-day gust ≥ P95", C.phys)}<b style="--c:${C.mod}">MODERATE</b></div>
    <div>${chip(`3-day snow ≥ P99 <small>& ≥ ${fmt(s.high_sf3d_floor_mm)} mm</small>`, C.phys)}<i>AND</i>${chip("3-day gust ≥ P90", C.phys)}<b style="--c:${C.high}">HIGH</b></div>
    <em>or the warm-snow path: Tmax rise ≥ P95 after heavy 7-day snow on a snowpack · tiles below ${fmt(s.min_elev_m)} m not rated</em></div>`;
}
PAGES["phys/overview"] = () => {
  const F = facts(), cl = F.cl, wx = F.wx, ru = F.ru;
  const srcLine = tech => { const r = srcRow(tech); return r ? esc(r["Repository / source"]) : ""; };
  const lvName = lv => lv == null ? "—" : lv >= 2 ? "High" : lv >= 1 ? "Moderate" : lv < 0 ? "Not rated" : "Low";
  const lvCol = lv => lv >= 2 ? C.high : lv >= 1 ? C.mod : "#94a3b8";
  const engine = ({ k, b, name, horizon, how, big, unit, say, chart, src, to, extra = "" }) => `
    <section class="mf-eng mf-rev" style="--c:${BADGE[b][1]}" data-go="${to}" tabindex="0" role="link" aria-label="${esc(name)}: open its page">
      <div class="mf-eng-id"><span class="mf-eng-n">${k}</span>${badge(b)}<h2>${esc(name)}</h2><span class="mf-eng-hz">${horizon}</span><p>${esc(how)}</p></div>
      <div class="mf-eng-fig"><b>${big}${unit ? `<em>${unit}</em>` : ""}</b><p>${say}</p>${extra}<small>${src}</small></div>
      <div class="mf-eng-chart">${chart}</div>
      <span class="mf-eng-go">Open ${esc(name.toLowerCase())} →</span>
    </section>`;
  const cl585 = cl && cl.s585, cl245 = cl && cl.s245;
  return `<div class="mf-one">
    <aside class="mf-one-l">
      <span class="mf-k">Sub-tab 1 · Global &amp; Physics Models</span>
      <h1>Three engines behind every <em>avalanche warning</em></h1>
      <p>Physics simulates the atmosphere for the decades ahead and for the next 15 days; a rule then turns the forecast into a warning level for every 25 km square of the mountains.</p>
      <div class="mf-one-film" data-filmslot></div>
    </aside>
    <div class="mf-one-r">
      ${engine({ k: 1, b: "phys", name: "Climate model", horizon: "2030 – 2100", how: "Physics-based simulation of the whole atmosphere, under two emission scenarios.", to: "phys/climate",
        big: cl585 ? `▼ ${fmt(Math.abs(cl585.change_pct), 0)}` : "—", unit: cl585 ? "%" : "",
        say: cl585 ? `fewer <b>avalanche-alarm days</b> per winter by ${cl585.p} under the high-emission path SSP5-8.5 (${fmt(cl585.value, 1)} days); <b style="color:#38bdf8">SSP2-4.5: ▼ ${fmt(Math.abs(cl245.change_pct), 0)} %</b>` : "projection package not loaded",
        chart: cl ? miniClimate(cl) + `<div class="mf-mleg"><span style="--c:#38bdf8">SSP2-4.5</span><span style="--c:#f97316">SSP5-8.5</span></div>` : "", src: `${srcLine("Climate model")} · ${cmipModels().length || "—"} models` })}
      <div class="mf-pipe"><i></i><span>the same rule is run on the projected climate and on tomorrow's weather</span></div>
      ${engine({ k: 2, b: "phys", name: "Weather forecast", horizon: "next 15 days", how: "Physics-based numerical weather prediction, run twice a day.", to: "phys/weather",
        big: wx ? fmt(wx.pk.max_sf3d_mm, 0) : "—", unit: wx ? "mm" : "",
        say: wx ? `of snow in 3 days by <b>${dShort(wx.pk.date)}</b> in the <b>${esc(wx.pk.region)}</b>, the heaviest of the next ${wx.n} days` : "no forecast run found",
        chart: wx ? miniWeather(wx) + `<div class="mf-mleg"><span style="--c:#38bdf8">Low</span><span style="--c:${C.mod}">Moderate</span><span style="--c:${C.high}">High</span><em>highest 3-day snowfall per day</em></div>` : "",
        src: wx ? `${srcLine("Weather forecast model") || esc(wx.src)} · run ${dShort(wx.run)}` : "" })}
      <div class="mf-pipe"><i></i><span>forecast → each square's own thresholds → warning level</span></div>
      ${engine({ k: 3, b: "rule", name: "Rule engine", horizon: "every forecast day", how: "Predefined snowfall, wind and warming thresholds for each square.", to: "phys/rules",
        big: ru ? `${ru.m.events_caught}<span class="mf-of">/${ru.m.events}</span>` : "—", unit: "",
        say: ru ? `past avalanches the Moderate rule would have warned of, with <b>${fmt(+ru.m.false_alarm_rate * 100, 1)} %</b> false alarms (High: ${ru.h.events_caught}/${ru.h.events})` : "threshold files not loaded",
        extra: wx ? `<div class="mf-today"><span>Today</span>${wx.today.map(t => `<em style="--c:${lvCol(t.lv)}">${esc(t.r)} · ${esc(lvName(t.lv))}</em>`).join("")}
          ${wx.warn.length ? `<span>Ahead</span>${wx.warn.map(w => `<em style="--c:${w.hi ? C.high : C.mod}">${esc(w.r)} · ${w.hi ? "High" : "Moderate"} ${dRange(w.days)}</em>`).join("")}` : `<span>Ahead</span><em style="--c:#94a3b8">no Moderate in ${wx.n} days</em>`}</div>` : "",
        chart: ru ? miniRule(ru) : "", src: `${srcLine("Rule-based system") || "Built in-house"} · ${ru && ru.tiles ? `${ru.tiles} squares` : ""}` })}
    </div>
  </div>`;
};
AFTER["phys/overview"] = root => {
  Film.place($("[data-filmslot]", root));
  root.addEventListener("keydown", e => { const s = e.target.closest(".mf-eng"); if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); const [a, b] = s.dataset.go.split("/"); go(a, b); } });
};

// ================================================================== every page is ONE SCREEN (owner's rule: no scrolling, readable at
// first look). A page = a one-line header (kicker, title, a two-line lede) + a grid of panels that share the remaining height exactly; charts
// are drawn at their panel's pixel size by fit(). Below 1100 px wide (or very short windows) the panels stack and the page may scroll.
const dash = (kicker, title, lede, c, b, body, cls = "") => `<div class="mf-dash ${cls}" style="--c:${c}">
  <header class="mf-dh mf-rev"><div><span class="mf-k">${kicker} ${b ? badge(b) : ""}</span><h1>${title}</h1></div>${lede ? `<p>${lede}</p>` : ""}</header>${body}</div>`;
const panel = (title, body, cls = "", c = "") => `<section class="mf-card mf-p mf-rev ${cls}" ${c ? `style="--c:${c}"` : ""}>${title ? `<h3>${title}</h3>` : ""}${body}</section>`;
const big = (v, unit, label, sub, c, d = 0) => `<div class="mf-big" style="--c:${c}"><b><span data-count="${v}" data-dec="${d}">0</span>${unit ? `<em>${unit}</em>` : ""}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
const lvC = lv => lv >= 2 ? C.high : lv >= 1 ? C.mod : lv < 0 ? "#475569" : "#2b4a6b";

// ---- climate model -------------------------------------------------------------------------------------------------------------------
const P = { scen: "ssp585", metric: "alarm_days_moderate", group: "ALL northern Pakistan", period: null };
PAGES["phys/climate"] = () => {
  const pj = D.pj;
  if (!pj || !pj.available) return dash("Module 1.1", "Climate Model · 2030–2100", "", C.phys, "phys", none("The projection package is not loaded (/api/climate/projections)."));
  const ms = Object.entries(pj.metrics), models = cmipModels();
  return dash("Module 1.1 · Global & Physics Models", "Climate Model · 2030–2100 projections",
    `The portal's own alarm rule run on bias-corrected CMIP6 climate models (NASA NEX-GDDP, 0.25°): how avalanche weather changes against ${esc(pj.baseline_period)}. A projection describes the climate of a period, not a forecast of any winter.`, C.phys, "phys", `
    <div class="mf-g mf-cl">
      <div class="mf-col">
        ${panel("", `<div data-pnow class="mf-fill"></div>`, "mf-now-p", C.phys)}
        ${panel("Core physics · solved on a 3D grid of the atmosphere", `<div class="mf-eq">
          <div><span>Mass</span><math><mfrac><mrow><mo>∂</mo><mi>ρ</mi></mrow><mrow><mo>∂</mo><mi>t</mi></mrow></mfrac><mo>+</mo><mo>∇</mo><mo>·</mo><mo>(</mo><mi>ρ</mi><mi mathvariant="bold">v</mi><mo>)</mo><mo>=</mo><mn>0</mn></math></div>
          <div><span>Momentum</span><math><mfrac><mrow><mi>D</mi><mi mathvariant="bold">v</mi></mrow><mrow><mi>D</mi><mi>t</mi></mrow></mfrac><mo>=</mo><mo>−</mo><mfrac><mn>1</mn><mi>ρ</mi></mfrac><mo>∇</mo><mi>p</mi><mo>−</mo><mn>2</mn><mi mathvariant="bold">Ω</mi><mo>×</mo><mi mathvariant="bold">v</mi><mo>+</mo><mi mathvariant="bold">g</mi><mo>+</mo><mi mathvariant="bold">F</mi></math></div>
          <div><span>Energy</span><math><msub><mi>c</mi><mi>p</mi></msub><mfrac><mrow><mi>D</mi><mi>T</mi></mrow><mrow><mi>D</mi><mi>t</mi></mrow></mfrac><mo>=</mo><mi>Q</mi></math></div></div>`, "", C.phys)}
        ${panel("The package", `<dl class="mf-dl sm"><div><dt>Data</dt><dd>NASA NEX-GDDP-CMIP6 · daily · 0.25° · bias-corrected</dd></div>
          <div><dt>Models</dt><dd>${(models.length ? models : [...new Set(Object.values(pj.scenarios).flatMap(s => s.models))]).map(esc).join(" · ")}</dd></div>
          </dl><div class="mf-links">${linkBtns("Climate model")}</div>`, "mf-pkg", C.phys)}
      </div>
      ${panel("", `<div class="mf-ctl">
          <span class="mf-seg" data-scen>${Object.entries(pj.scenarios).map(([k, s]) => `<button type="button" data-v="${k}" class="${k === P.scen ? "on" : ""}">${esc(s.name.split(" (")[0])}</button>`).join("")}</span>
          <select data-metric aria-label="Indicator">${ms.map(([k, m]) => `<option value="${k}" ${k === P.metric ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select>
          <select data-group aria-label="Area">${pj.groups.map(g => `<option ${g.group === P.group ? "selected" : ""}>${esc(g.group)}</option>`).join("")}</select>
          <span class="mf-slider"><span>Period</span><input type="range" data-period min="0" max="${pj.periods_5yr.length - 1}" step="1"><b data-plabel></b></span></div>
        <div class="mf-fill" data-pchart></div><div data-pleg></div>
        <h4 class="mf-h4">Change by area in the selected period <small>% against ${esc(pj.baseline_period)}</small></h4><div data-pregions></div>`, "mf-main-p", C.phys)}
    </div>`);
};
AFTER["phys/climate"] = root => {
  const pj = D.pj; if (!pj || !pj.available) return;
  const ps = pj.periods_5yr; if (P.period == null || !ps.includes(P.period)) P.period = ps.includes("2050") ? "2050" : ps[Math.floor(ps.length / 2)];
  const sl = $("[data-period]", root); sl.value = ps.indexOf(P.period);
  const draw = () => {
    const g = pj.groups.find(x => x.group === P.group) || pj.groups[0], m = pj.metrics[P.metric], base = g.baseline[P.metric];
    const xs = ps.filter(p => Object.values(g.series).some(s => s[p] && s[p][P.metric]));
    const ser = Object.entries(g.series).map(([k, s]) => ({ k, n: pj.scenarios[k].name, c: k === "ssp585" ? "#f97316" : "#38bdf8", v: xs.map(p => s[p] && s[p][P.metric] ? s[p][P.metric].value : null), w: k === P.scen ? 3.2 : 1.8,
      lo: xs.map(p => { const q = s[p] && s[p][P.metric]; return q && q.change_pct_min != null && base ? base * (1 + q.change_pct_min / 100) : null; }), hi: xs.map(p => { const q = s[p] && s[p][P.metric]; return q && q.change_pct_max != null && base ? base * (1 + q.change_pct_max / 100) : null; }) }));
    const bands = ser.filter(s => s.k === P.scen && s.lo.every(v => v != null)).map(s => ({ lo: s.lo, hi: s.hi, c: s.c }));
    FITS.length = 0;
    fit($("[data-pchart]", root), (W, H) => lineChart({ series: ser, xs, bands, W, h: H, refs: base != null ? [{ v: base, c: "#e2e8f0", t: `${pj.baseline_period}: ${fmt(base, 2)}` }] : [], yFmt: v => fmt(v, 1), unit: ` ${m.unit}` }));
    $("[data-pleg]", root).innerHTML = legend(ser.map(s => [s.c, s.n]).concat([["rgba(226,232,240,.8)", `baseline ${pj.baseline_period}`, true], ["rgba(249,115,22,.35)", "spread of the models (selected scenario)"]]));
    const q = (g.series[P.scen] || {})[P.period], v = q && q[P.metric], col = P.scen === "ssp585" ? "#f97316" : "#38bdf8";
    $("[data-plabel]", root).textContent = P.period;
    $("[data-pnow]", root).innerHTML = `<div class="mf-now2" style="--c:${col}"><span>${esc(pj.scenarios[P.scen].name)} · <b>${esc(P.period)}</b> · ${esc(P.group)}</span>
      <div class="mf-now2-n">${v ? `<b class="${v.change_pct >= 0 ? "up" : "dn"}">${v.change_pct >= 0 ? "▲" : "▼"} ${fmt(Math.abs(v.change_pct), 0)}<em>%</em></b>` : "<b>—</b>"}
        <span>${esc(m.label)}<br><strong>${v ? fmt(v.value, 2) : "—"}</strong> ${esc(m.unit)} <em>vs ${fmt(base, 2)} in ${esc(pj.baseline_period)}</em></span></div>
      ${v ? `<div class="mf-rng">models range ${fmt(v.change_pct_min, 0)} % … ${fmt(v.change_pct_max, 0)} %${v.models_more != null ? ` · ${v.models_more} model${v.models_more === 1 ? "" : "s"} more, ${v.models_less} less` : ""}</div>` : ""}</div>`;
    const rg = pj.groups.filter(x => x.group_type !== "all"), vals = rg.map(x => { const s = (x.series[P.scen] || {})[P.period]; return [x.group, s && s[P.metric] ? s[P.metric].change_pct : null]; });
    const mx = Math.max(10, ...vals.map(([, z]) => Math.abs(z || 0)));
    $("[data-pregions]", root).innerHTML = `<div class="mf-div2">${vals.map(([n, z]) => `<div class="mf-dr"><span>${esc(n)}</span><div class="mf-db"><i class="${z >= 0 ? "up" : "dn"}" style="--w:${z == null ? 0 : Math.abs(z) / mx * 50}%"></i></div><b>${z == null ? "—" : `${z >= 0 ? "+" : ""}${fmt(z, 0)} %`}</b></div>`).join("")}</div>`;
  };
  root.addEventListener("click", e => { const b = e.target.closest("[data-scen] [data-v]"); if (b) { P.scen = b.dataset.v; $$("[data-scen] button", root).forEach(x => x.classList.toggle("on", x === b)); draw(); } });
  $("[data-metric]", root).onchange = e => { P.metric = e.target.value; draw(); };
  $("[data-group]", root).onchange = e => { P.group = e.target.value; draw(); };
  sl.oninput = () => { P.period = ps[+sl.value]; draw(); };
  draw();
};

// ---- weather forecast model ----------------------------------------------------------------------------------------------------------
PAGES["phys/weather"] = () => {
  const al = D.al;
  if (!al || !al.regions) return dash("Module 1.2", "Weather Forecast · next 15 days", "", C.phys, "phys", none("No forecast run found (/api/alertforecast/latest)."));
  const rn = r => r.region || r.name || "Region", sr = srcRow("Weather forecast model");
  const peaks = al.regions.map(r => { const d = r.days.reduce((a, b) => (b.max_sf3d_mm || 0) > (a.max_sf3d_mm || 0) ? b : a, r.days[0]); return { r: rn(r), d }; });
  const mhDays = new Set(al.regions.flatMap(r => r.days.filter(x => x.tiles_moderate_or_high).map(x => x.date)));
  return dash("Module 1.2 · Global & Physics Models", "Weather Forecast · next 15 days",
    `${esc(al.source)}, run of ${dShort(al.issued_for_date)}: the snowfall, wind and warming that the rule engine turns into warning levels, for every 25 km square of the mountains.`, C.phys, "phys", `
    <div class="mf-g mf-wx">
      ${panel(`Highest 3-day snowfall in each region <small>any rated square · dashed lines = the rule's minimum snowfall for Moderate and High</small>`, `<div class="mf-fill" data-wsf></div><div data-wleg></div>`, "mf-main-p", C.phys)}
      <div class="mf-col">
        <div class="mf-peaks">${peaks.map(p => big(p.d ? p.d.max_sf3d_mm : 0, "mm", esc(p.r), p.d ? `peak 3-day snowfall · ${dShort(p.d.date)}` : "", REGC[p.r] || C.phys, 0)).join("")}</div>
        ${panel(`Warning level, day by day <small>highest level of any square in the region</small>`, `<div class="mf-cal" data-cal></div>
          <div class="mf-cal-leg"><span style="--c:${lvC(0)}">Low</span><span style="--c:${C.mod}">Moderate</span><span style="--c:${C.high}">High</span>
          <em>${mhDays.size ? `Moderate or High on ${mhDays.size} of ${al.days.length} days` : `no Moderate in ${al.days.length} days`}</em></div>`, "", C.rule)}
        ${panel("How the forecast is made", `<dl class="mf-dl sm">
          <div><dt>Model</dt><dd>${esc(al.source)}</dd></div>
          <div><dt>Reads</dt><dd>snowfall, rain, temperature, 10 m gusts, pressure, snow depth, freezing level</dd></div>
          <div><dt>Ensemble</dt><dd>${al.ensemble_members ? `${fmt(al.ensemble_members)} members in this run` : "51 members configured; this run has the main forecast only"}</dd></div>
          <div><dt>Not produced</dt><dd>700 hPa wind-vector and freezing-level contour maps</dd></div></dl><div class="mf-links">${linkBtns("Weather forecast model")}</div>`, "mf-facts", C.phys)}
      </div>
    </div>`);
};
AFTER["phys/weather"] = root => {
  const al = D.al; if (!al || !al.regions) return; const rn = r => r.region || r.name || "Region", xs = al.days;
  const ser = al.regions.map(r => ({ n: rn(r), c: REGC[rn(r)] || C.phys, v: xs.map(d => { const x = r.days.find(y => y.date === d); return x ? x.max_sf3d_mm : null; }) }));
  fit($("[data-wsf]", root), (W, H) => lineChart({ series: ser, xs, xLabel: i => dShort(xs[i]), W, h: H, unit: " mm", yFmt: v => fmt(v, 0),
    refs: [{ v: 10, c: C.mod, t: "10 mm · Moderate" }, { v: 25, c: C.high, t: "25 mm · High" }] }));
  $("[data-wleg]", root).innerHTML = legend(ser.map(s => [s.c, s.n]));
  // the calendar: one row per region, one cell per day, coloured by the highest level; the number = squares at Moderate or High
  $("[data-cal]", root).innerHTML = `<div class="mf-cal-g" style="--n:${xs.length}"><span></span>${xs.map(d => `<i>${new Date(d + "T00:00:00Z").getUTCDate()}</i>`).join("")}
    ${al.regions.map(r => `<span style="--rc:${REGC[rn(r)] || C.phys}">${esc(rn(r))}</span>${xs.map((d, k) => { const x = r.days.find(y => y.date === d) || {};
      return `<b class="mf-grow" style="--c:${lvC(x.max_level ?? -1)};animation-delay:${k * 0.03}s" title="${esc(rn(r))} · ${dShort(d)} · ${esc(x.max_level_name || "—")} · ${x.tiles_moderate_or_high || 0} squares at Moderate+ · ${fmt(x.max_sf3d_mm, 1)} mm / 3 days">${x.tiles_moderate_or_high ? x.tiles_moderate_or_high : ""}</b>`; }).join("")}`).join("")}</div>`;
};

// ---- rule engine ---------------------------------------------------------------------------------------------------------------------
const RS = { tile: null, sf3: 30, gust: 14, rise: 2, sf7: 40, pack: true };
const regionOf = (lat, lon, r) => { r = r || {}; const nm = r.names || { hindu_kush: "Hindu Kush", karakoram: "Karakoram", west_himalaya: "West Himalaya" };
  if (lon < (r.lon_hindu_kush_max ?? 72.8)) return nm.hindu_kush; if (lat >= (r.lat_split ?? 35.1)) return lon < (r.lon_karakoram_min ?? 73.6) ? nm.hindu_kush : nm.karakoram; return nm.west_himalaya; };
// forecast_core.apply_rules(final=True), line by line
function ruleLevel(t, x, s) {
  if (t.elev_approx_m < s.min_elev_m) return { lv: -1, why: [] };
  let lv = 0; const why = [];
  [[1, "MODERATE", s.moderate_sf3d_floor_mm], [2, "HIGH", s.high_sf3d_floor_mm]].forEach(([k, n, floor]) => {
    const c1 = x.sf3 >= t[`${n}_sf3d_mm`] && x.sf3 >= floor, c2 = x.gust >= t[`${n}_gust3d_ms`];
    const w = x.rise >= t[`${n}_tmax_rise3d_c`] && x.sf7 >= t[`${n}_sf7d_mm`] && x.pack && x.sf7 >= s.warm_sf7d_floor_mm;
    why.push({ n, storm: [c1, c2], warm: w }); if ((c1 && c2) || w) lv = Math.max(lv, k); });
  return { lv, why };
}
PAGES["phys/rules"] = () => {
  const fw = D.fw;
  if (!fw || !fw.available) return dash("Module 1.3", "Rule Engine", "", C.rule, "rule", none("The calibrated threshold files are not loaded (/api/models/framework)."));
  const v = Object.fromEntries(fw.validation.filter(r => r.rule.startsWith("final")).map(r => [r.level, r])), s = fw.settings;
  const ring = (a, b, label, c) => `<div class="mf-ring" style="--c:${c};--f:${b ? a / b : 0}"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="33" class="bg"/><circle cx="40" cy="40" r="33" class="fg" pathLength="1"/></svg><b>${a}<small>/${b}</small></b><span>${esc(label)}</span></div>`;
  const presets = ["Chitral", "Gilgit", "Hispar", "Skardu", "Naran", "Astore"].map(n => D.places.find(p => p.name === n)).filter(Boolean);
  return dash("Module 1.3 · Global & Physics Models", "Rule Engine · from forecast to warning level",
    `Each 25 km square has its own thresholds, taken from 57 winters of ERA5 (1970–2026). When the forecast crosses them, the engine raises the level. The same rule is checked against documented avalanches.`, C.rule, "rule", `
    <div class="mf-g mf-ru">
      ${panel("The rule", `<div class="mf-flow2">
        <div class="mf-fc" style="--c:${C.phys}"><span>1 · Heavy snowfall</span><b>3-day snow ≥ the square's 95th percentile</b><small>and ≥ ${fmt(s.moderate_sf3d_floor_mm)} mm · High: 99th and ≥ ${fmt(s.high_sf3d_floor_mm)} mm</small></div>
        <i class="mf-op">AND</i>
        <div class="mf-fc" style="--c:${C.phys}"><span>2 · Strong wind</span><b>3-day max gust ≥ the square's 95th percentile</b><small>High: ≥ 90th percentile</small></div>
        <i class="mf-op">OR</i>
        <div class="mf-fc" style="--c:#fb923c"><span>Warm-snow path</span><b>warming ≥ 95th after heavy 7-day snow</b><small>on a snowpack, ≥ ${fmt(s.warm_sf7d_floor_mm)} mm in 7 days</small></div>
        <i class="mf-op go">→</i>
        <div class="mf-fd"><em style="--c:${C.mod}">MODERATE</em><em style="--c:${C.high}">HIGH</em><small>no "Extreme" level · below ${fmt(s.min_elev_m)} m not rated</small></div></div>`, "mf-rule-p", C.rule)}
      ${panel("Tested on documented avalanches", `<div class="mf-rings">${ring(+v.MODERATE.events_caught, +v.MODERATE.events, "avalanches warned · Moderate", C.mod)}${ring(+v.MODERATE.storms_caught, +v.MODERATE.storms, "storms warned · Moderate", C.mod)}${ring(+v.HIGH.events_caught, +v.HIGH.events, "avalanches warned · High", C.high)}${ring(+v.HIGH.storms_caught, +v.HIGH.storms, "storms warned · High", C.high)}</div>
        <div class="mf-vstats"><span><b>${fmt(+v.MODERATE.false_alarm_rate * 100, 1)} %</b> false alarms · Moderate</span><span><b>${fmt(+v.MODERATE.alarm_days_per_winter, 1)}</b> alarm days / winter</span><span><b>${fmt(+v.HIGH.false_alarm_rate * 100, 1)} %</b> false alarms · High</span><span><b>${fmt(+v.HIGH.alarm_days_per_winter, 1)}</b> alarm days / winter</span></div>`, "mf-val-p", C.rule)}
      ${panel(`Threshold workbench <small>try a forecast on a real square · read-only: the live thresholds are not edited here</small>`, `
        <div class="mf-ctl"><span class="mf-lbl">Places</span>${presets.map(p => `<button type="button" class="mf-chipb" data-pre="${esc(p.name)}">${esc(p.name)}</button>`).join("")}
          <select data-tile aria-label="Square">${fw.tiles.slice().sort((a, b) => a.tile_id.localeCompare(b.tile_id)).map(t => `<option value="${esc(t.tile_id)}">${esc(t.tile_id)} · ${esc(regionOf(t.lat, t.lon, fw.regions))} · ${fmt(t.elev_approx_m)} m</option>`).join("")}</select></div>
        <div class="mf-wb"><div data-wbin></div><div data-wbout></div><div class="mf-sc"><div class="mf-fill" data-scatter></div><div data-scleg></div></div></div>`, "mf-wb-p", C.rule)}
    </div>`);
};
AFTER["phys/rules"] = root => {
  const fw = D.fw; if (!fw || !fw.available) return; const s = fw.settings, T = fw.tiles;
  const near = p => { let b = null, bd = 1e9; T.forEach(t => { const d = Math.hypot(t.lon - p.lon, t.lat - p.lat); if (d < bd) { bd = d; b = t; } }); return bd <= 0.35 ? b : null; };
  if (!RS.tile) { const g = D.places.find(p => p.name === "Gilgit"); RS.tile = (g && near(g) || T[0]).tile_id; }
  const sel = $("[data-tile]", root);
  const SL = [["sf3", "3-day snowfall", 0, 120, 1, "mm"], ["gust", "3-day max gust", 0, 30, 0.5, "m/s"], ["rise", "3-day warming", -10, 15, 0.5, "°C"], ["sf7", "7-day snowfall", 0, 200, 1, "mm"]];
  $("[data-wbin]", root).innerHTML = SL.map(([k, l, a, b, st, u]) => `<label class="mf-sl"><span>${l}<b data-kv="${k}">${fmt(RS[k], st < 1 ? 1 : 0)} ${u}</b></span><input type="range" min="${a}" max="${b}" step="${st}" value="${RS[k]}" data-k="${k}"></label>`).join("")
    + `<label class="mf-cb"><input type="checkbox" data-pack ${RS.pack ? "checked" : ""}> snowpack on the ground</label>`;
  const out = () => {
    FITS.length = 0;                                                  // (the scatter is this page's only fitted chart: do not pile up redraws)
    const t = T.find(x => x.tile_id === RS.tile) || T[0]; sel.value = t.tile_id;
    const r = ruleLevel(t, RS, s), LV = { "-1": ["Not rated", C.lo], 0: ["Low", "#cbd5e1"], 1: ["Moderate", C.mod], 2: ["High", C.high] }[r.lv];
    const row = (c, lab, val, thr, u) => `<div class="mf-cond ${c ? "ok" : ""}"><span>${lab}</span><div class="mf-cb2"><i style="width:${Math.min(100, thr ? val / thr * 60 : 0)}%"></i><u style="left:60%"></u></div><b>${fmt(val, 1)} / ${fmt(thr, 1)} ${u}</b></div>`;
    $("[data-wbout]", root).innerHTML = `<div class="mf-lamp" style="--c:${LV[1]}"><i></i><span>${esc(t.tile_id)} · ${esc(regionOf(t.lat, t.lon, fw.regions))} · ${fmt(t.elev_approx_m)} m</span><b>${LV[0]}</b></div>
      ${r.lv === -1 ? `<p class="mf-fine">This square lies below ${fmt(s.min_elev_m)} m: the engine does not rate it.</p>` : ["MODERATE", "HIGH"].map(n => { const w = r.why.find(x => x.n === n), c = n === "HIGH" ? C.high : C.mod, fl = n === "HIGH" ? s.high_sf3d_floor_mm : s.moderate_sf3d_floor_mm;
        return `<div class="mf-cset" style="--c:${c}"><h5>${n} ${(w.storm[0] && w.storm[1]) || w.warm ? "✓" : ""}</h5>${row(w.storm[0], "snowfall", RS.sf3, Math.max(t[`${n}_sf3d_mm`], fl), "mm")}${row(w.storm[1], "gust", RS.gust, t[`${n}_gust3d_ms`], "m/s")}
          <div class="mf-or ${w.warm ? "ok" : ""}">warm path ${w.warm ? "met" : "not met"} · warming ${fmt(RS.rise, 1)} / ${fmt(t[`${n}_tmax_rise3d_c`], 1)} °C</div></div>`; }).join("")}`;
    fit($("[data-scatter]", root), (W, H) => {
      const L = 40, B = 22, ex = T.map(x => x.elev_approx_m), ey = T.map(x => x.MODERATE_sf3d_mm), x0 = Math.min(...ex), x1 = Math.max(...ex), y1 = Math.max(...ey) * 1.08;
      const X = z => L + (W - L - 8) * (z - x0) / (x1 - x0), Y = z => H - B - (H - B - 8) * z / y1;
      return `<svg class="mf-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${[0, 0.5, 1].map(f => `<line class="g" x1="${L}" x2="${W}" y1="${Y(y1 * f)}" y2="${Y(y1 * f)}"/><text x="${L - 6}" y="${Y(y1 * f) + 4}" text-anchor="end">${fmt(y1 * f)} mm</text>`).join("")}
        <line x1="${X(s.min_elev_m)}" x2="${X(s.min_elev_m)}" y1="8" y2="${H - B}" stroke="#64748b" stroke-dasharray="4 4"/><text x="${X(s.min_elev_m) + 4}" y="18" fill="#94a3b8">${fmt(s.min_elev_m)} m · below: not rated</text>
        ${T.map((x, i) => `<circle data-tid="${esc(x.tile_id)}" cx="${X(x.elev_approx_m)}" cy="${Y(x.MODERATE_sf3d_mm)}" r="${x.tile_id === t.tile_id ? 7 : 3.6}" fill="${REGC[regionOf(x.lat, x.lon, fw.regions)] || C.phys}" fill-opacity="${x.tile_id === t.tile_id ? 1 : 0.72}" stroke="${x.tile_id === t.tile_id ? "#fff" : "none"}" stroke-width="2" style="cursor:pointer"><title>${esc(x.tile_id)} · ${fmt(x.elev_approx_m)} m · Moderate ${fmt(x.MODERATE_sf3d_mm, 1)} mm / High ${fmt(x.HIGH_sf3d_mm, 1)} mm</title></circle>`).join("")}
        <text x="${X(x0)}" y="${H - 5}">${fmt(x0)} m</text><text x="${W - 4}" y="${H - 5}" text-anchor="end">${fmt(x1)} m · square elevation</text></svg>`; });
    $("[data-scleg]", root).innerHTML = legend(Object.entries(REGC).map(([n, c]) => [c, n])) + `<p class="mf-fine">Each dot is one square: the snowfall it needs for Moderate. Click one to try it.</p>`;
  };
  root.addEventListener("input", e => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; RS[k] = +e.target.value; const u = SL.find(x => x[0] === k);
    $(`[data-kv="${k}"]`, root).textContent = `${fmt(RS[k], u[4] < 1 ? 1 : 0)} ${u[5]}`; out(); });
  root.addEventListener("change", e => { if (e.target.matches("[data-pack]")) { RS.pack = e.target.checked; out(); } if (e.target.matches("[data-tile]")) { RS.tile = e.target.value; out(); } });
  root.addEventListener("click", e => { const p = e.target.closest("[data-pre]"); if (p) { const pl = D.places.find(x => x.name === p.dataset.pre), t = pl && near(pl); if (t) { RS.tile = t.tile_id; out(); } }
    const c = e.target.closest("[data-tid]"); if (c) { RS.tile = c.dataset.tid; out(); } });
  out();
};

// ---- machine learning: overview ------------------------------------------------------------------------------------------------------
PAGES["ml/overview"] = () => {
  const fw = D.fw, th = fw ? fw.student_thresholds : [];
  const nav = NAVC.filter(c => c.to.startsWith("ml/"));
  return dash("Sub-tab 2 · Machine Learning Models", "Machine learning · <em>a second opinion</em> beside the rule",
    "A model learns from past avalanches which weather patterns came before them, and scores every square and day from 0 to 1. The score is shown next to the rule's warning level, never in its place, and it is not a probability.", C.ml, "ml", `
    <div class="mf-g mf-mlo">
      <div class="mf-kpi4">${big(STU.length + 2, "", "inputs the model uses", "all of them available in a weather forecast", C.ml)}${big(STU.length + TEA.length + 3, "", "inputs its teacher used", "including snowpack physics from ERA5", "#60a5fa")}
        ${big(5, "-fold", "tested on unseen winters", "every winter scored by a model that never saw it", C.rule)}${big(fw && fw.student_file_bytes ? fw.student_file_bytes / 1024 : 0, "KB", "model file", "small enough to run with every forecast", "#a78bfa", 0)}</div>
      ${panel("How it is built, in five steps", `<ol class="mf-steps2">
        <li><b>Learn from real avalanches</b><span>squares near a documented avalanche, in its days, are the examples; quiet days are not assumed safe</span></li>
        <li><b>Describe each day locally</b><span>every driver as that place's own percentile: how unusual it is there</span></li>
        <li><b>Teacher</b><span>a model with all reanalysis variables, forbidden to learn that more snow lowers risk</span></li>
        <li><b>Student</b><span>learns the teacher's answers using only forecastable inputs, so it runs on forecasts and projections</span></li>
        <li><b>Test on unseen winters</b><span>5-fold cross-validation by winter, at the rule's false-alarm rate</span></li></ol>`, "mf-steps-p", C.ml)}
      ${panel(`Today's run · highest score per region <small>dashed = the score at Moderate's false-alarm rate</small>`, `<div class="mf-fill" data-mlrisk></div><div data-mlleg></div>
        <div class="mf-th2">${th.map(r => `<span>at <b>${esc(Object.values(r)[0])}</b> false alarms → score ≥ <em>${fmt(+r.student_score_threshold, 2)}</em></span>`).join("")}</div>`, "mf-risk-p", C.ml)}
      <div class="mf-col mf-navcol">${nav.map(navCard).join("")}</div>
    </div>`);
};
AFTER["ml/overview"] = root => {
  const al = D.al, el = $("[data-mlrisk]", root); if (!al || !al.regions) { el.innerHTML = none("No forecast run."); return; }
  const rn = r => r.region || r.name, xs = al.days, ser = al.regions.map(r => ({ n: rn(r), c: REGC[rn(r)] || C.ml, v: xs.map(d => { const x = r.days.find(y => y.date === d); return x && x.max_student_risk != null ? x.max_student_risk : null; }) }));
  const th = D.fw && D.fw.student_thresholds.length ? +D.fw.student_thresholds[D.fw.student_thresholds.length - 1].student_score_threshold : null;
  fit(el, (W, H) => lineChart({ series: ser, xs, W, h: H, xLabel: i => dShort(xs[i]), yFmt: v => fmt(v, 2), refs: th ? [{ v: th, c: C.mod, t: `${fmt(th, 2)}` }] : [] }));
  $("[data-mlleg]", root).innerHTML = legend(ser.map(s => [s.c, s.n]));
};

// ---- machine learning: the model -----------------------------------------------------------------------------------------------------
PAGES["ml/model"] = () => dash("Module 2.1 · Machine Learning Models", "ML model · pattern recognition",
  "A neural network is the textbook picture of a learned model. The portal's model is a set of shallow decision trees (gradient boosting): it learns the same kind of non-linear pattern and stays explainable with only a few dozen documented avalanches.", C.ml, "ml", `
  <div class="mf-g mf-mlm">
    ${panel(`<span class="mf-seg sm" data-nv><button type="button" class="on" data-v="gb">This portal · boosted trees</button><button type="button" data-v="nn">Concept · neural network</button></span>`, `<div class="mf-fill mf-net" data-net></div><p class="mf-fine" data-netnote></p>`, "mf-main-p", C.ml)}
    <div class="mf-col">
      ${panel("The model", `<dl class="mf-dl sm"><div><dt>Algorithm</dt><dd>gradient-boosted decision trees (scikit-learn HistGradientBoosting)</dd></div><div><dt>Size</dt><dd>up to 150 trees, each 2 levels deep, learning rate 0.05</dd></div>
        <div><dt>Careful</dt><dd>at least 100 square-days per leaf; storms weighted evenly</dd></div><div><dt>Output</dt><dd>a score from 0 to 1 per square and day (not a probability)</dd></div>
        <div><dt>Runs</dt><dd>inside every forecast run; if it cannot load, the rule's warnings still work</dd></div></dl>`, "", C.ml)}
      ${panel("Physics guard-rails", `<p class="mf-lede">With few examples, the model is not allowed to learn the impossible. ▲ = more of this can never lower the score:</p>
        <div class="mf-mono">${UP.map(f => `<span class="up">▲ ${esc(NAME[f])}</span>`).join("")}<span class="up">▲ snowpack</span><span class="dn">▼ pressure (a deeper drop = more storm)</span></div>`, "", C.ml)}
      ${panel("Not in the package yet", `<p class="mf-fine mf-nf">Feature importance (SHAP or Gini) and ROC / AUC curves: step 4 of the pipeline writes them, but feature_importance.csv and cv_comparison.csv were not supplied. They are shown here once they are.</p>`, "mf-np", "#64748b")}
    </div>
  </div>`);
AFTER["ml/model"] = root => {
  const box = $("[data-net]", root), note = $("[data-netnote]", root); let mode = "gb";
  const draw = () => fit(box, (W, H) => {
    // the diagram is laid out on the panel's own size (columns at fixed fractions), so it always fills it without distortion
    const ins = mode === "nn" ? ["Wind", "Temperature", "Humidity", "Cloud cover"] : STU.slice(0, 8).map(f => NAME[f]).concat(["…and 6 more"]);
    const top = 34, bot = H - 22, yy = (n, i) => n === 1 ? (top + bot) / 2 : top + (bot - top) * i / (n - 1), xi = W * 0.2, xo = W * 0.8, r = Math.max(7, Math.min(16, (bot - top) / 18));
    let s = `<svg class="mf-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`; const pts = [];
    if (mode === "nn") {
      const outs = ["Avalanche warning", "No hazard"], hx = [W * 0.4, W * 0.6], L = [ins.map((_, i) => [xi, yy(ins.length, i)]), ...hx.map(x => Array.from({ length: 6 }, (_, i) => [x, yy(6, i)])), outs.map((_, i) => [xo, (top + bot) / 2 + (i - 0.5) * (bot - top) * 0.36])];
      for (let l = 0; l < L.length - 1; l++) L[l].forEach(a => L[l + 1].forEach(b => { s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="mf-edge"/>`; pts.push([a, b]); }));
      L.forEach((col, li) => col.forEach(([x, y]) => { s += `<circle cx="${x}" cy="${y}" r="${r}" class="mf-node ${li === 0 ? "in" : li === L.length - 1 ? "out" : ""}"/>`; }));
      [["Input layer", xi, "in"], ["Hidden layer", hx[0], ""], ["Hidden layer", hx[1], ""], ["Output layer", xo, "out"]].forEach(([t, x, c]) => { s += `<text x="${x}" y="16" text-anchor="middle" class="mf-lh ${c}">${t}</text>`; });
      ins.forEach((t, i) => { s += `<text x="${xi - r - 10}" y="${yy(ins.length, i) + 5}" text-anchor="end" class="mf-nl in">${esc(t)}</text>`; });
      outs.forEach((t, i) => { s += `<text x="${xo + r + 10}" y="${L[3][i][1] + 5}" class="mf-nl out">${esc(t)}</text>`; });
    } else {
      const tx = [0.38, 0.47, 0.56, 0.65].map(f => W * f), ty = top + (bot - top) * 0.24, d1 = (bot - top) * 0.2, d2 = (bot - top) * 0.4, sp = Math.min(30, W * 0.026);
      ins.forEach((t, i) => { const y = yy(ins.length, i); s += `<circle cx="${xi}" cy="${y}" r="7" class="mf-node in"/><text x="${xi - 14}" y="${y + 4}" text-anchor="end" class="mf-nl in sm">${esc(t)}</text>`;
        tx.forEach(x => { s += `<line x1="${xi}" y1="${y}" x2="${x}" y2="${ty}" class="mf-edge f"/>`; pts.push([[xi, y], [x, ty]]); }); });
      tx.forEach((x, k) => { s += `<g class="mf-tree" style="animation-delay:${k * 0.2}s"><circle cx="${x}" cy="${ty}" r="8"/><line x1="${x}" y1="${ty}" x2="${x - sp}" y2="${ty + d1}"/><line x1="${x}" y1="${ty}" x2="${x + sp}" y2="${ty + d1}"/>
        <circle cx="${x - sp}" cy="${ty + d1}" r="6"/><circle cx="${x + sp}" cy="${ty + d1}" r="6"/>${[[-sp, -sp * 1.5], [-sp, -sp * 0.5], [sp, sp * 0.5], [sp, sp * 1.5]].map(([a, b]) => `<line x1="${x + a}" y1="${ty + d1}" x2="${x + b}" y2="${ty + d2}"/><rect x="${x + b - 6}" y="${ty + d2}" width="12" height="12" rx="3"/>`).join("")}</g>`;
        s += `<line x1="${x}" y1="${ty + d2 + 14}" x2="${xo}" y2="${(top + bot) / 2}" class="mf-edge f"/>`; pts.push([[x, ty + d2 + 12], [xo, (top + bot) / 2]]); });
      s += `<text x="${W * 0.515}" y="${ty + d2 + 46}" text-anchor="middle" class="mf-nl">+ up to 146 more small trees, each a small correction</text><text x="${W * 0.515}" y="${ty + d2 + 66}" text-anchor="middle" class="mf-nl sm">the corrections are added up into one score</text>`;
      s += `<circle cx="${xo}" cy="${(top + bot) / 2}" r="${r + 4}" class="mf-node out"/><text x="${xo + r + 14}" y="${(top + bot) / 2 + 5}" class="mf-nl out">Score 0 – 1</text><text x="${xo + r + 14}" y="${(top + bot) / 2 + 24}" class="mf-nl sm">per square and day</text>`;
      [["Inputs · local percentiles", xi, "in"], ["Gradient-boosted trees", W * 0.515, ""], ["Output", xo, "out"]].forEach(([t, x, c]) => { s += `<text x="${x}" y="16" text-anchor="middle" class="mf-lh ${c}">${t}</text>`; });
    }
    if (!calm) pts.filter((_, i) => i % (mode === "nn" ? 3 : 2) === 0).forEach(([a, b], i) => { s += `<circle r="3" class="mf-sig"><animateMotion dur="${1.6 + (i % 5) * 0.25}s" begin="${(i % 9) * 0.18}s" repeatCount="indefinite" path="M${a[0]},${a[1]} L${b[0]},${b[1]}"/></circle>`; });
    note.textContent = mode === "nn" ? "Concept illustration of a neural network (inputs → hidden layers → output). It is not the portal's model." : "The portal's model: the place's percentile of each forecastable driver goes in; many small trees each add a correction; out comes one score.";
    return s + "</svg>"; });
  root.addEventListener("click", e => { const b = e.target.closest("[data-nv] [data-v]"); if (b) { mode = b.dataset.v; $$("[data-nv] button", root).forEach(x => x.classList.toggle("on", x === b)); FITS.length = 0; draw(); } });
  draw();
};

// ---- machine learning: teacher-student ---------------------------------------------------------------------------------------------
PAGES["ml/distill"] = () => {
  const fw = D.fw;
  return dash("Module 2.2 · Machine Learning Models", "Teacher–student · knowledge distillation",
    "The teacher learns from every reanalysis variable, including snowpack physics. The student copies the teacher's answers using only what a forecast or a climate projection provides, so one learned pattern scores both tomorrow and 2080.", C.ml, "ml", `
    <div class="mf-g mf-ds">
      ${panel("", `<div class="mf-dist">
        <div class="mf-tb t"><span>Teacher model</span><b>${STU.length + TEA.length + 3} inputs · all of ERA5 / ERA5-Land</b><div>${STU.concat(TEA).map(f => `<em class="${TEA.includes(f) ? "x" : ""}">${esc(NAME[f])}</em>`).join("")}<em>snowpack</em><em>elevation</em><em class="x">faceting days (7 d)</em></div>
          <small>trained on documented avalanches and 120,000 sampled quiet square-days</small></div>
        <div class="mf-dk"><canvas data-dcv></canvas><b>Knowledge distillation</b><small>the teacher scores ~150,000 more square-days;<br>the student learns ½ from those, ½ from real avalanches</small></div>
        <div class="mf-tb s"><span>Student model</span><b>${STU.length + 2} inputs · all available in a forecast</b><div>${STU.map(f => `<em>${esc(NAME[f])}</em>`).join("")}<em>snowpack</em><em>elevation</em></div>
          <small>runs on ECMWF forecasts and CMIP6 projections</small></div></div>
        <p class="mf-fine">Struck through: variables that exist only in reanalysis (snowpack internals, moisture transport, albedo). The teacher uses them; the student never sees them.</p>`, "mf-main-p", C.ml)}
      <div class="mf-g mf-bm3">
        ${panel("Answer time", `<div class="mf-bm" data-bm><b>…</b><small>measuring now</small></div><p class="mf-fine">Scores are computed once per forecast run; the map only reads them. This is how long this server takes to return every stored score, measured in your browser now.</p>`, "", C.ml)}
        ${panel("Model size", `<div class="mf-bm"><b>${fw && fw.student_file_bytes ? `${fmt(fw.student_file_bytes / 1024, 1)} KB` : "—"}</b><small>student.joblib, as shipped</small></div><p class="mf-fine">The teacher file is not in the package, so a compression ratio cannot be stated.</p>`, "", C.ml)}
        ${panel("Validation", `<div class="mf-bm"><b>5-fold</b><small>by winter, at the rule's false-alarm rate</small></div><p class="mf-fine">The comparison table (cv_comparison.csv) is not in the package. The rule's own test is on the rule-engine page.</p><button type="button" class="mf-chipb" data-go="phys/rules">Rule validation →</button>`, "", C.ml)}
      </div>
    </div>`);
};
AFTER["ml/distill"] = root => {
  const t0 = performance.now(); fetch("/api/alertforecast/tiles.geojson", { cache: "no-store" }).then(r => r.ok ? r.arrayBuffer() : null).then(b => { const ms = performance.now() - t0, el = $("[data-bm]", root); if (!el) return;
    el.innerHTML = b ? `<b>${fmt(ms)} ms</b><small>for ${fmt(b.byteLength / 1024)} KB of stored scores</small>` : `<b>—</b><small>not available</small>`; }).catch(() => {});
  const cv = $("[data-dcv]", root); if (!cv) return; const g = cv.getContext("2d"); let raf = 0;
  const parts = Array.from({ length: 80 }, (_, i) => ({ u: i / 80, y: Math.random(), s: 0.5 + Math.random() }));
  const f = () => { if (!cv.isConnected) return cancelAnimationFrame(raf); const W = cv.clientWidth, H = cv.clientHeight, d = Math.min(2, devicePixelRatio || 1); if (cv.width !== Math.round(W * d)) { cv.width = Math.round(W * d); cv.height = Math.round(H * d); }
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, "rgba(59,130,246,.05)"); gr.addColorStop(0.5, "rgba(34,197,94,.22)"); gr.addColorStop(1, "rgba(34,197,94,.05)"); g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, H * 0.08); g.bezierCurveTo(W * 0.5, H * 0.08, W * 0.5, H * 0.34, W, H * 0.36); g.lineTo(W, H * 0.64); g.bezierCurveTo(W * 0.5, H * 0.66, W * 0.5, H * 0.92, 0, H * 0.92); g.fill();
    parts.forEach(p => { p.u = (p.u + 0.004 * p.s * (calm ? 0 : 1)) % 1; const u = p.u, spread = (1 - u) * 0.84 + u * 0.26, y = H * (0.5 + (p.y - 0.5) * spread);
      g.fillStyle = `rgba(${Math.round(59 + (34 - 59) * u)},${Math.round(130 + (197 - 130) * u)},${Math.round(246 + (94 - 246) * u)},${0.9 * Math.sin(u * Math.PI)})`; g.beginPath(); g.arc(u * W, y, 2 + 1.6 * u, 0, 7); g.fill(); });
    raf = requestAnimationFrame(f); };
  raf = requestAnimationFrame(f);
};

// ------------------------------------------------------------------ start
const [h0, h1] = location.hash.slice(1).split("/"); go(h0 || "phys", h1 || "overview", false);
