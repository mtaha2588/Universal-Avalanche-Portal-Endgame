/* Avalanche Prediction Portal: interview demo player.
   The film (assets/demo.mp4) is a screen recording of the running portal (scripts/record_demo.py); chapter times come from
   data/chapters.json and every figure in the captions from data/facts.json (scripts/build_demo_data.py, read from the
   portal's own data files). Nothing here is a live forecast. */
(function () {
  "use strict";
  const CFG = window.DEMO_CONFIG || {}, SALT = "avalanche-portal-demo:", OPEN_S = 6, CARD_S = 7;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)], body = document.body;
  const film = $("#film"), bar = $("#bar");
  const fmtN = n => n == null ? "—" : Number(n).toLocaleString("en-GB");
  const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const day = iso => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let F = {}, CH = [], dur = 0, cur = -1, opening = null, cardT = null, idleT = null, started = false, ready = false, wantStart = false;

  /* ------------------------------------------------------------ captions: every number from facts.json */
  function captions() {
    const g = F.glaciers || {}, s = g.systems || {}, fc = F.forecast || {}, v = (fc.validation || {}).moderate || {}, h = F.history || {},
      p = F.projections || {}, p85 = p.ssp585_2081_2100 || {}, e = F.era5 || {}, sc = F.screening || {};
    const runOk = fc.last_run_ok !== false;
    return {
      intro: { t: "Opening: Earth to Pakistan", pts: [
        `Study area: <b>${fmtN(g.study_area_km2)} km²</b>, Pakistan-administered, official boundaries (Jammu &amp; Kashmir shown as disputed)`,
        `<b>${fmtN(g.total)}</b> glaciers, <b>${fmtN(Math.round(g.km2))} km²</b> of ice, from the Randolph Glacier Inventory v7.0`,
        "The storm, the relief scan and the globe are drawn live by the portal from its own DEM tiles"],
        src: "Portal opening sequence · RGI v7.0 (NSIDC, 2023) · Natural Earth boundaries, Pakistan view" },
      mapping: { t: "Northern Pakistan: terrain mapping", pts: [
        "Elevation tint, 1,000 m contours and a mapping network built from the portal's DEM at run time",
        `The three RGI v7.0 sub-region extents: Hindu Kush, Karakoram and West Himalaya, <b>${fmtN(Math.round(g.km2))} km²</b> of ice in all`,
        "A visualization of the terrain, not glacier-flow data"],
        src: "Copernicus DEM GLO-30 / SRTM · RGI v7.0 sub-region extents" },
      home: { t: "Command portal: three glacier systems", pts: [
        `Hindu Kush <b>${fmtN((s["Hindu Kush"] || {}).n)}</b> · Karakoram <b>${fmtN((s.Karakoram || {}).n)}</b> · West Himalaya <b>${fmtN((s["West Himalaya"] || {}).n)}</b> glaciers inside the study area`,
        `Largest named glacier: ${(s.Karakoram || {}).largest || "—"}, <b>${fmtN((s.Karakoram || {}).largest_km2)} km²</b>; summits to <b>${fmtN((s.Karakoram || {}).zmax_m)} m</b>`,
        "3D satellite terrain with every module one click away"],
        src: "Glacier outlines: RGI v7.0 · Terrain: Copernicus DEM GLO-30 / SRTM" },
      screening: { t: "Hotspots and avalanche simulation", pts: [
        `<b>${fmtN(sc.very_high_areas)}</b> very-high avalanche-terrain areas mapped from the DEM across <b>${fmtN(sc.tiles)}</b> Hindu Kush tiles`,
        "An avalanche tour flies to each hotspot and runs a sliding-block simulation down the real slope",
        "Terrain screening and an illustrative simulation: an index, not a forecast or a run-out prediction"],
        src: "Hindu Kush terrain-screening run · Voellmy-type sliding block on the portal DEM" },
      karakoram: { t: "Karakoram: the Batura model", pts: [
        "Ten hotspots supplied by NGT on 3D satellite terrain, with risk index, class, slope and elevation",
        "The Batura Glacier avalanche (1974) replayed from the NGT model's own path, times and speeds",
        "Model reconstruction, not an observation; labelled as such on screen"],
        src: "NGT hotspot list · NGT Batura 1974 model outputs" },
      alert: { t: "15-day Avalanche Alert Forecast", pts: [
        `<b>${fmtN(fc.tiles)}</b> tiles of 0.25° (~25 km), each with its own thresholds from <b>${fc.winters || 57}</b> ERA5 winters, plus a terrain danger matrix`,
        `Validation: the Moderate rule warned of <b>${v.events_caught}/${v.events}</b> documented avalanche events, false-alarm rate <b>${v.false_alarm_rate != null ? (v.false_alarm_rate * 100).toFixed(1) : "—"} %</b>`,
        `Click any place for its own 15-day forecast, downscaled to that elevation. Run shown: issued for <b>${day(fc.issued_for)}</b>${runOk ? "" : " (the last attempt hit the free data service's rate limit; the banner says so)"}`],
        src: `${fc.source || "ECMWF IFS"} · runs twice daily on the portal server` },
      tour3d: { t: "3D cinematic tour", pts: [
        "The same events on a CesiumJS globe: world terrain, painted winter snow and the avalanche body in 3D",
        "Each illustrative run is re-routed down the fall line of Cesium's own terrain, keeping the scenario's times and speeds",
        "Shares its event list with the 2D tour; the two stay in step"],
        src: "CesiumJS 1.122 · Cesium World Terrain · Mapbox satellite imagery" },
      history: { t: "Historical avalanches replayed in 3D", pts: [
        `<b>${fmtN(h.records)}</b> compiled avalanche records, <b>${fmtN(h.located)}</b> placed on the map, <b>${fmtN(h.replayed_3d)}</b> replayed on real terrain`,
        `<b>${fmtN(h.deaths_reported)}</b> deaths as reported in the records`,
        "Runs start from the peak above each documented place: illustrative scenarios, never presented as observed paths"],
        src: "NGT compiled event inventory · OpenStreetMap geocoding · portal DEM" },
      climate: { t: "Climate records and projections to 2100", pts: [
        `ERA5-Land winters: <b>${fmtN(e.tiles)}</b> tiles × <b>${fmtN(e.winters)}</b> winters (${e.period || "1970-2010"})`,
        `CMIP6 (NASA NEX-GDDP), adjusted to ERA5, <b>${(p.models || {}).ssp245 || "—"}</b> / <b>${(p.models || {}).ssp585 || "—"}</b> climate models per scenario`,
        `Very-high emissions, 2081-2100: avalanche-alarm days <b>${p.alarm_days_baseline} → ${p85.alarm_days}</b> a winter; snow share <b>${p85.snow_share_change_pts > 0 ? "+" : "−"}${Math.abs(p85.snow_share_change_pts).toFixed(1)} points</b>`],
        src: `Baseline ${p.baseline || "1995-2014"} · projections of weather conditions, not of avalanche numbers` },
      models: { t: "Model framework", pts: [
        "Physics: ECMWF weather for the next 15 days and CMIP6 climate to 2100",
        "Rule engine: each tile's calibrated thresholds turn the weather into a warning level",
        "Machine learning (gradient boosting) runs as a second opinion; it does not override the rule"],
        src: "Model scores and validation are shown only where the analysis package provides them" },
      kkh: { t: "Karakoram Highway safety tour", pts: [
        "The CPEC safety tour flies the road itself, braking for every High-exposure stretch",
        "Each kilometre is classed by the forecast of the tiles it crosses, with settlements, structures and glaciers alongside",
        "Potential exposure only: requires verification, never a road-closure statement"],
        src: "Road and settlement layers · forecast tiles · portal DEM profile" },
    };
  }

  /* ------------------------------------------------------------ data */
  const getJSON = u => fetch(u, { cache: "no-cache" }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  Promise.all([getJSON("data/facts.json"), getJSON("data/chapters.json")]).then(([f, c]) => {
    F = f || {}; CH = (c && c.chapters) || []; dur = (c && c.duration) || 0;
    buildChapters(); buildEnd();
    if (c && c.recorded) $("#note").textContent = `Recorded from the running portal · ${day(c.recorded)} · not a live forecast`;
    else $("#note").textContent = "Recorded from the running portal · not a live forecast";
  });

  /* ------------------------------------------------------------ the film buffers from the moment the page opens (behind the
     code screen and the title), and starts only when the browser can play it through without stopping */
  (function preload() {
    const loadBar = $("#load-bar");
    const pct = () => { const d = film.duration, b = film.buffered; if (!d || !b.length) return 0; return Math.min(1, b.end(b.length - 1) / d); };
    const done = () => { if (ready) return; ready = true; $(".load").classList.add("done"); if (loadBar) loadBar.style.width = "100%"; if (wantStart) afterOpening(); };
    film.addEventListener("progress", () => { if (loadBar && !ready) loadBar.style.width = (pct() * 100).toFixed(1) + "%"; if (pct() > 0.999) done(); });
    film.addEventListener("canplaythrough", done);
    film.addEventListener("error", () => { $("#gate-msg").textContent = "The recording could not be loaded."; });
    film.load();
  })();

  /* ------------------------------------------------------------ access code (browser-side courtesy door, see config.js) */
  async function sha256(text) {
    if (window.crypto && crypto.subtle) {
      const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
    }
    return sha256js(text);
  }
  function sha256js(ascii) {   // small fallback for pages opened without a secure context
    const rr = (v, n) => (v >>> n) | (v << (32 - n)), K = [], H = []; let p = 2;
    for (let n = 0; n < 64; p++) { let prime = true; for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
      if (prime) { if (n < 8) H[n] = (Math.pow(p, 1 / 2) * 4294967296) | 0; K[n++] = (Math.pow(p, 1 / 3) * 4294967296) | 0; } }
    const bytes = [...new TextEncoder().encode(ascii)], bits = bytes.length * 8; bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bits >>> (i * 8)) & 255);
    for (let i = 0; i < bytes.length; i += 64) {
      const w = []; for (let j = 0; j < 16; j++) w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
      let [a, b, c, d, e, f, g, h] = H;
      for (let j = 0; j < 64; j++) {
        if (j >= 16) { const s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3), s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10); w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0; }
        const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0, t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = H.map((x, k) => (x + [a, b, c, d, e, f, g, h][k]) | 0);
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  const pins = $$(".pin input");
  pins.forEach((inp, i) => {
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(-1); if (inp.value && i < 3) pins[i + 1].focus(); if (pins.every(x => x.value)) $("#gate-form").requestSubmit(); });
    inp.addEventListener("keydown", e => { if (e.key === "Backspace" && !inp.value && i > 0) pins[i - 1].focus(); });
    inp.addEventListener("paste", e => { const d = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 4); if (d.length === 4) { e.preventDefault(); d.split("").forEach((x, k) => pins[k].value = x); $("#gate-form").requestSubmit(); } });
  });
  $("#gate-form").addEventListener("submit", async e => {
    e.preventDefault();
    const code = pins.map(x => x.value).join("");
    if (!/^\d{4}$/.test(code)) return;
    if ((await sha256(SALT + code)) === CFG.codeHash) { try { sessionStorage.setItem("demo-ok", "1"); } catch { /* private mode */ } unlock(); }
    else { const g = $("#gate"); $("#gate-msg").textContent = "That code is not right. Please try again."; g.classList.remove("bad"); void g.offsetWidth; g.classList.add("bad"); pins.forEach(x => x.value = ""); pins[0].focus(); }
  });
  let passed = false; try { passed = sessionStorage.getItem("demo-ok") === "1"; } catch { /* */ }
  if (!CFG.codeHash || passed) setTimeout(unlock, 50); else pins[0].focus();

  function unlock() { body.classList.remove("is-gate"); startOpening(); }

  /* ------------------------------------------------------------ opening title, then the film */
  function startOpening() {
    started = false; hideCard(); $("#end").hidden = true; film.pause(); film.currentTime = 0;
    body.classList.add("is-open"); body.classList.remove("paused");
    clearTimeout(opening); opening = setTimeout(afterOpening, reduce ? 1500 : OPEN_S * 1000);
  }
  function afterOpening() {
    clearTimeout(opening); wantStart = true;
    if (!ready) return;                       // keep the title up until the film is fully loaded
    wantStart = false; body.classList.remove("is-open"); started = true; film.play().catch(() => body.classList.add("paused")); poke();
  }

  /* ------------------------------------------------------------ chapters + progress */
  function buildChapters() {
    const box = $("#chaps"), C = captions();
    box.innerHTML = CH.map((c, i) => { const len = (i + 1 < CH.length ? CH[i + 1].start : dur) - c.start;
      return `<button type="button" role="tab" data-i="${i}" style="--w:${Math.max(1, len).toFixed(2)}" aria-label="${i + 1}. ${(C[c.id] || c).t || c.title}"><i></i><span>${i + 1}. ${(C[c.id] || {}).t || c.title}</span></button>`; }).join("");
    box.querySelectorAll("button").forEach(b => b.onclick = () => go(+b.dataset.i));
  }
  function chapterAt(t) { let k = 0; CH.forEach((c, i) => { if (t + 0.05 >= c.start) k = i; }); return k; }
  function go(i) {
    if (!CH.length) return; i = Math.max(0, Math.min(CH.length - 1, i));
    if (body.classList.contains("is-open")) { clearTimeout(opening); body.classList.remove("is-open"); started = true; }
    $("#end").hidden = true; film.currentTime = CH[i].start + 0.01; cur = -1; if (film.paused && started) film.play().catch(() => {});
    tick();
  }
  function tick() {
    const t = film.currentTime || 0, d = film.duration || dur || 1;
    $("#time").textContent = `${fmtT(t)} / ${fmtT(d)}`;
    const k = chapterAt(t);
    $$("#chaps button").forEach((b, i) => { const s = CH[i].start, e = i + 1 < CH.length ? CH[i + 1].start : d;
      b.querySelector("i").style.width = (t >= e ? 100 : t <= s ? 0 : (t - s) / (e - s) * 100) + "%"; b.setAttribute("aria-selected", i === k); });
    if (k !== cur && started) { cur = k; showCard(k); }
  }
  film.addEventListener("timeupdate", tick);
  film.addEventListener("seeked", tick);
  film.addEventListener("play", () => body.classList.remove("paused"));
  film.addEventListener("pause", () => body.classList.add("paused"));
  film.addEventListener("ended", () => { hideCard(); $("#end").hidden = false; body.classList.add("paused"); body.classList.remove("idle"); });
  (function loop() { if (!film.paused) tick(); requestAnimationFrame(loop); })();

  function showCard(k) {
    const c = CH[k], C = captions()[c.id] || { t: c.title, pts: [], src: "" };
    $("#c-num").textContent = String(k + 1).padStart(2, "0"); $("#c-of").textContent = `of ${String(CH.length).padStart(2, "0")}`;
    $("#c-title").textContent = C.t; $("#c-points").innerHTML = C.pts.map(p => `<li>${p}</li>`).join(""); $("#c-src").textContent = C.src;
    $("#now").textContent = C.t;
    const card = $("#card"); card.classList.remove("on"); void card.offsetWidth; card.classList.add("on");
    clearTimeout(cardT); cardT = setTimeout(hideCard, CARD_S * 1000);
  }
  function hideCard() { clearTimeout(cardT); $("#card").classList.remove("on"); }

  /* ------------------------------------------------------------ end card: architecture (as built in the repository) */
  function buildEnd() {
    const fc = F.forecast || {};
    const cols = [
      ["Open data", ["ERA5 / ERA5-Land reanalysis", "ECMWF IFS forecasts (Open-Meteo)", "NASA NEX-GDDP-CMIP6", "RGI v7.0 glacier inventory", "Copernicus DEM / SRTM", "NGT avalanche records"]],
      ["Python engine", [`Per-tile thresholds (${fc.tiles || 150} tiles, ${fc.winters || 57} winters)`, "Alert rule + terrain danger matrix", "ML classifier as a second opinion", "Scheduled runs twice a day"]],
      ["Flask API", ["Waitress server, JSON API", "CSV / GeoJSON exports with metadata", "DEM tile cache", "Data catalogue with source and status"]],
      ["Web portal", ["Mapbox GL / MapLibre 3D maps", "CesiumJS cinematic tour", "Dashboards, playback, inspectors", "Printable situation brief"]],
    ];
    $("#arch").innerHTML = cols.map(([h, l]) => `<div class="col"><h3>${h}</h3><ul>${l.map(x => `<li>${x}</li>`).join("")}</ul></div>`).join("");
    $("#end-note").innerHTML = "Decision support only: outputs are not official avalanche warnings unless validated and issued by NDMA / PDMA / GBDMA / SDMA. " +
      "This page is a recording of the running system; the forecast engine itself runs on the portal server.";
    const a = $("#src-link"); if (CFG.repo) a.href = CFG.repo; else a.hidden = true;
  }

  /* ------------------------------------------------------------ controls */
  function toggle() { if (body.classList.contains("is-open")) return afterOpening(); if (!$("#end").hidden) return startOpening(); film.paused ? film.play() : film.pause(); poke(); }
  function fullscreen() { const el = document.documentElement; if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el); else (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
  function exit() { if (document.fullscreenElement) document.exitFullscreen(); film.pause(); location.href = CFG.repo || "./"; }
  const act = { play: toggle, prev: () => go((cur < 0 ? chapterAt(film.currentTime) : cur) - (film.currentTime - (CH[cur] || {}).start > 2 ? 0 : 1)), next: () => go((cur < 0 ? 0 : cur) + 1),
    skip: afterOpening, replay: startOpening, full: fullscreen, exit };
  document.addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b && act[b.dataset.act]) { e.preventDefault(); act[b.dataset.act](); } });
  film.addEventListener("click", toggle);
  document.addEventListener("keydown", e => {
    if (body.classList.contains("is-gate") || e.target.matches("input")) return;
    const k = e.key;
    if (k === " " || k === "k") { e.preventDefault(); toggle(); }
    else if (k === "ArrowRight") act.next(); else if (k === "ArrowLeft") act.prev();
    else if (k === "f" || k === "F") fullscreen();
    else if (k === "Escape" && body.classList.contains("is-open")) afterOpening();
    poke();
  });

  /* controls fade out while the film plays and the pointer rests */
  function poke() { body.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => { if (!film.paused && started && !bar.matches(":hover")) body.classList.add("idle"); }, 2600); }
  ["mousemove", "touchstart", "pointerdown"].forEach(ev => document.addEventListener(ev, poke, { passive: true }));
})();
