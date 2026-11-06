/* "Intro +" showreel of the home page (button beside "Intro" on the map bar): the portal plays itself as a looping film.
   Scenes: cinematic intro -> front page (3 s) -> Historical Overview tour, the three best-documented avalanches (BEST) -> Hindu Kush hotspots (5 s) ->
   Karakoram hotspots (5 s) -> Climate Data: Historical Climate Records (5 s), Projection Till 2100 (5 s) -> Avalanche Alert Forecast (6 s) -> front page (5 s) -> loop. The real modules run live; this
   file only directs them. Scenes crossfade with no black between them: each next scene loads out of sight behind the one playing and is
   only uncovered when it has drawn. Chapter lower-thirds, a chapter progress line and an auto-hiding cursor make it read as a film. "Home" (or Esc) stops it at any moment and returns to the front page. Pause / resume (small round button, Space) stops the whole page at the frame on screen: see FilmClock. */
"use strict";

/* One clock for the film. The opening, the tour and the dashboards run on map camera flights, animation frames, many timers and CSS, so no module-by-module
   pause could hold them all. While frozen, performance.now stands still, animation frames and timers wait and CSS animations are held; on resume everything carries
   on as if no time had passed. performance.now is replaced here, when this file loads, because the map libraries keep a reference to it when they load (later).
   Frames and timers are replaced on the first film only, and only do anything different while frozen. */
const FilmClock = (() => {
  const real = performance.now.bind(performance);
  let offset = 0, frozenAt = 0, frozen = false, installed = false, seq = 1e9, held = [];
  const now = () => (frozen ? frozenAt : real()) - offset;
  performance.now = now;
  const frames = new Map(), timers = new Map();
  const nRaf = window.requestAnimationFrame.bind(window), nCaf = window.cancelAnimationFrame.bind(window);
  const nSet = window.setTimeout.bind(window), nClr = window.clearTimeout.bind(window);
  const armFrame = (id, e) => { e.n = nRaf(t => { if (!frames.has(id)) return; if (frozen) { e.n = 0; return; } frames.delete(id); e.cb(t - offset); }); };
  const armTimer = (id, e) => { e.n = nSet(() => { if (!timers.has(id)) return; if (frozen) { e.n = 0; return; } if (now() < e.due - 1) { armTimer(id, e); return; } timers.delete(id); e.fn(...e.args); }, Math.max(0, e.due - now())); };
  function install() {
    if (installed) return; installed = true;
    window.requestAnimationFrame = cb => { const id = ++seq, e = { cb, n: 0 }; frames.set(id, e); if (!frozen) armFrame(id, e); return id; };
    window.cancelAnimationFrame = id => { const e = frames.get(id); if (e) { frames.delete(id); if (e.n) nCaf(e.n); } else nCaf(id); };
    window.setTimeout = (fn, ms, ...args) => { if (typeof fn !== "function") return nSet(fn, ms, ...args); const id = ++seq, e = { fn, args, due: now() + (+ms || 0), n: 0 }; timers.set(id, e); if (!frozen) armTimer(id, e); return id; };
    window.clearTimeout = id => { const e = timers.get(id); if (e) { timers.delete(id); if (e.n) nClr(e.n); } else nClr(id); };
  }
  function freeze(docs, keep) {
    if (frozen) return;
    frozenAt = real(); frozen = true;
    held = [];
    docs.forEach(d => { try { d.getAnimations().forEach(a => { const t = a.effect && a.effect.target; if (a.playState === "running" && !(t && keep && keep(t))) { a.pause(); held.push(a); } }); d.querySelectorAll("video").forEach(v => { if (!v.paused) { v.pause(); held.push(v); } }); } catch { /* frame gone */ } });
  }
  function thaw() {
    if (!frozen) return;
    offset += real() - frozenAt; frozen = false;
    frames.forEach((e, id) => { if (!e.n) armFrame(id, e); });
    timers.forEach((e, id) => { if (!e.n) armTimer(id, e); });
    held.forEach(a => { try { const r = a.play(); if (r && r.catch) r.catch(() => {}); } catch { /* gone */ } });
    held = [];
  }
  return { install, freeze, thaw, frozen: () => frozen };
})();

window.Showreel = (() => {
  let on = false, tok = 0, ui = null, keyH = null, clickH = null, frames = {}, idleT = 0, moveH = null;
  const CH = [
    ["Opening", "Pakistan's glacier systems"], ["Command portal", "Front page"], ["Historical overview", "Three avalanche events replayed on the terrain"],
    ["Hindu Kush", "Terrain screening & hotspots"], ["Karakoram", "Hotspots"], ["Historical climate records", "Northern Pakistan winters, 1970–2010"], ["Projection till 2100", "2 scenarios · baseline 1995–2014"],
    ["Avalanche alert forecast", "ECMWF IFS · daily tile alerts, 15-day lead"], ["Command portal", "Front page"],
  ];
  // Batura 1974: the only event with the NGT model's own path, times and speeds. Kohistan 2010: exactly located, high confidence, 102 deaths, clean terrain and a clear flow to the documented place.
  // Gayari 2012: the largest event (140 deaths), high confidence, recorded elevation. In date order.
  const BEST = ["BATURA-1974", "PK005", "PK007"];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const alive = my => on && my === tok;
  class Stop extends Error {}
  const sleep = async (my, ms) => { const end = performance.now() + ms; while (performance.now() < end) { if (!alive(my)) throw new Stop(); await wait(Math.min(200, end - performance.now())); } };
  const until = async (my, test, ms) => { const end = performance.now() + ms; while (performance.now() < end && !test()) { if (!alive(my)) throw new Stop(); await wait(250); } };

  const CSS = `
  .sr { position: fixed; inset: 0; z-index: 10050; pointer-events: none; font-family: Inter, "Segoe UI", system-ui, sans-serif; }
  .sr-vig { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.42)); }
  .sr-top { position: absolute; bottom: 22px; right: 24px; display: flex; align-items: center; gap: 10px; pointer-events: auto; transition: opacity .5s; }
  .sr.idle .sr-top { opacity: .35; } .sr.idle .sr-top:hover { opacity: 1; }
  .sr-live { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 999px; font: 700 10.5px/1 Inter, sans-serif; letter-spacing: .22em;
    text-transform: uppercase; color: #e2e8f0; background: rgba(2,6,23,.6); border: 1px solid rgba(255,255,255,.14); backdrop-filter: blur(10px); }
  .sr-live i { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 10px #ef4444; animation: sr-blink 1.6s infinite; }
  @keyframes sr-blink { 50% { opacity: .25; } }
  .sr-home { display: inline-flex; align-items: center; gap: 8px; padding: 9px 16px; border-radius: 999px; cursor: pointer; font: 700 13px Inter, sans-serif; color: #fff;
    background: linear-gradient(180deg, rgba(56,189,248,.9), rgba(37,99,235,.9)); border: 1px solid rgba(255,255,255,.25); box-shadow: 0 8px 24px rgba(37,99,235,.4); }
  .sr-home:hover { filter: brightness(1.12); }
  .sr-home kbd { font: 600 10px ui-monospace, monospace; padding: 2px 6px; border-radius: 5px; background: rgba(255,255,255,.18); }
  .sr-lt::before { content: ""; position: absolute; left: -44px; right: -120px; top: -40px; bottom: -40px; z-index: -1;
    background: radial-gradient(ellipse at 20% 70%, rgba(2,6,23,.82), rgba(2,6,23,.5) 45%, transparent 72%); }
  .sr-lt { position: absolute; left: 44px; bottom: 54px; z-index: 0; max-width: min(620px, 80vw); opacity: 0; transform: translateY(12px); transition: opacity .8s ease, transform .8s cubic-bezier(.16,.84,.24,1); }
  .sr-lt.in { opacity: 1; transform: none; }
  .sr-lt small { display: flex; align-items: center; gap: 12px; font: 700 11px ui-monospace, monospace; letter-spacing: .3em; text-transform: uppercase; color: #7dd3fc; text-shadow: 0 2px 8px #000; }
  .sr-lt small::before { content: ""; width: 40px; height: 2px; background: #38bdf8; box-shadow: 0 0 10px #38bdf8; }
  .sr-lt b { display: block; margin-top: 6px; font: 800 clamp(28px, 3.4vw, 46px)/1.05 Inter, sans-serif; color: #fff; letter-spacing: -.01em; text-shadow: 0 4px 24px rgba(0,0,0,.7); }
  .sr-lt span { display: block; margin-top: 6px; font: 500 15px Inter, sans-serif; color: #dbe4f0; text-shadow: 0 2px 10px #000; }
  .sr-bar { position: absolute; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: repeat(${CH.length}, 1fr); gap: 3px; padding: 0 3px 3px; }
  .sr-bar i { height: 3px; border-radius: 2px; background: rgba(255,255,255,.16); overflow: hidden; }
  .sr-bar i b { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #38bdf8, #a5f3fc); box-shadow: 0 0 8px #38bdf8; }
  .sr-bar i.done b { width: 100%; transition: none; }
  .sr-frame { position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; z-index: 10040; background: #05080f; opacity: 0; pointer-events: none; transition: opacity .7s ease; }
  .sr-frame.show { opacity: 1; }
  /* Climate Data and Alert Forecast pages are full of controls: a small title over the empty corner of the map, and the film's chip goes until the mouse moves */
  .sr.dense.idle .sr-top, .sr.dense.idle .sr-top:hover { opacity: 0; }
  .sr.dense .sr-lt { left: 19.5vw; bottom: 40vh; max-width: 340px; padding: 9px 14px; border-radius: 10px; background: rgba(5, 15, 34, .84); border: 1px solid rgba(125, 211, 252, .35); backdrop-filter: blur(6px); }
  .sr.dense .sr-lt::before { display: none; }
  .sr.dense .sr-lt small { display: none; }
  .sr.dense .sr-lt b { margin: 0; font-size: 20px; }
  .sr.dense .sr-lt span { margin-top: 3px; font-size: 12px; }
  .sr-pp { position: relative; flex: none; width: 36px; height: 36px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 50%; cursor: pointer; color: #e0f7ff; isolation: isolate;
    background: radial-gradient(circle at 35% 28%, rgba(125,211,252,.28), rgba(6,17,38,.92) 62%); box-shadow: 0 6px 18px rgba(2,6,23,.55), inset 0 0 0 1px rgba(255,255,255,.08); backdrop-filter: blur(10px); transition: transform .18s ease, box-shadow .18s ease, color .18s ease; }
  .sr-pp::before { content: ""; position: absolute; inset: -1.5px; z-index: -1; border-radius: 50%; padding: 1.5px; background: conic-gradient(from 0deg, #38bdf8, #a5f3fc 28%, rgba(56,189,248,.08) 55%, #2563eb 82%, #38bdf8);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: sr-ring 5s linear infinite; }
  @keyframes sr-ring { to { transform: rotate(360deg); } }
  .sr-pp:hover { transform: scale(1.09); color: #fff; box-shadow: 0 8px 22px rgba(56,189,248,.42), inset 0 0 0 1px rgba(255,255,255,.14); }
  .sr-pp:active { transform: scale(.95); }
  .sr-pp:focus-visible { outline: 2px solid #a5f3fc; outline-offset: 3px; }
  .sr-pp svg { grid-area: 1 / 1; width: 15px; height: 15px; fill: currentColor; transition: opacity .2s ease, transform .28s cubic-bezier(.3,1.5,.5,1); }
  .sr-pp .i-play { opacity: 0; transform: scale(.45) rotate(-90deg); }
  .sr.paused .sr-pp { color: #fde68a; box-shadow: 0 0 16px rgba(251,191,36,.38), inset 0 0 0 1px rgba(255,255,255,.1); }
  .sr.paused .sr-pp::before { background: conic-gradient(#fbbf24, #fde68a, #fbbf24); animation: none; }
  .sr.paused .sr-pp .i-pause { opacity: 0; transform: scale(.45) rotate(90deg); }
  .sr.paused .sr-pp .i-play { opacity: 1; transform: none; }
  .sr.paused .sr-top, .sr.paused .sr-top:hover { opacity: 1 !important; }
  .sr.paused .sr-live i { background: #fbbf24; box-shadow: 0 0 10px #fbbf24; animation: none; }
  /* full dashboards: icons only, in the free space of their header row, clear of every control */
  .sr.dense .sr-top { top: 70px; bottom: auto; left: 70.8vw; right: auto; gap: 8px; }
  .sr.dense .sr-live, .sr.dense .sr-home .sr-ht, .sr.dense .sr-home kbd { display: none; }
  .sr.dense .sr-home { width: 36px; height: 36px; padding: 0; justify-content: center; font-size: 16px; }
  /* the film runs edge to edge: no letterbox strips from the intro or the tour (they keep them when opened on their own) */
  body.sr-on .cine-bar, body.sr-on .ht-bars { display: none; }
  body.sr-on .ad { transition: opacity .7s ease; }
  body.sr-on .cd-view:not([hidden]) { animation: sr-fade .5s ease; }
  @keyframes sr-fade { from { opacity: .35; } }
  body.sr-on, body.sr-on * { cursor: none !important; } body.sr-on.sr-cur, body.sr-on.sr-cur * { cursor: auto !important; }
  body.sr-on .sr-home, body.sr-on .sr-home * { cursor: pointer !important; }`;

  function build() {
    if (!document.getElementById("sr-css")) { const s = document.createElement("style"); s.id = "sr-css"; s.textContent = CSS; document.head.appendChild(s); }
    ui = document.createElement("div"); ui.className = "sr";
    ui.innerHTML = `<div class="sr-vig"></div>
      <div class="sr-top"><span class="sr-live"><i></i><span data-sr-state>Portal showreel</span></span>
        <button type="button" class="sr-pp" aria-label="Pause the film" title="Pause (Space)"><svg class="i-pause" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.2" y="2" width="3.5" height="12" rx="1.1"/><rect x="9.3" y="2" width="3.5" height="12" rx="1.1"/></svg><svg class="i-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 2.5c0-.8.9-1.3 1.6-.9l7.2 5.5c.6.4.6 1.3 0 1.8L6.2 14.4c-.7.4-1.6-.1-1.6-.9z"/></svg></button>
        <button type="button" class="sr-home" aria-label="Stop the film and go to the front page" title="Front page (Esc)">⌂<span class="sr-ht"> Home </span><kbd>Esc</kbd></button></div>
      <div class="sr-lt"><small></small><b></b><span></span></div>
      <div class="sr-bar">${CH.map(() => "<i><b></b></i>").join("")}</div>`;
    document.body.appendChild(ui);
    ui.querySelector(".sr-home").onclick = stop;
    ui.querySelector(".sr-pp").onclick = e => { togglePause(); e.currentTarget.blur(); };
  }
  // chapter title in the lower third and the chapter progress line (fills over the chapter's expected length)
  function chapter(k, ms, titleMs) {
    const lt = ui.querySelector(".sr-lt");
    lt.classList.remove("in"); ui.classList.toggle("dense", k >= 5 && k <= 7);
    setTimeout(() => { if (!ui) return; lt.querySelector("small").textContent = `${String(k + 1).padStart(2, "0")} · ${CH[k][0]}`;
      lt.querySelector("b").textContent = CH[k][0]; lt.querySelector("span").textContent = CH[k][1]; lt.classList.add("in"); }, 350);
    setTimeout(() => { if (ui) lt.classList.remove("in"); }, titleMs || Math.max(2600, Math.min(ms - 600, 5200)));
    ui.querySelectorAll(".sr-bar i").forEach((b, i) => {
      const f = b.querySelector("b"); b.classList.toggle("done", i < k);
      f.style.transition = "none"; f.style.width = i < k ? "100%" : "0";
      if (i === k) { void f.offsetWidth; f.style.transition = `width ${ms}ms linear`; f.style.width = "100%"; }
    });
  }

  // the Hindu Kush and Karakoram modules live in the full portal page (/portal): shown in frames, loaded ahead of time
  function frame(hash) {
    if (frames[hash]) return frames[hash];
    const f = document.createElement("iframe"); f.className = "sr-frame"; f.src = `/portal#${hash}`; f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
    document.body.appendChild(f); frames[hash] = f; return f;
  }
  const frameReady = f => { try { const d = f.contentDocument; return d && d.readyState === "complete" && !!d.querySelector(".mapboxgl-canvas,.maplibregl-canvas"); } catch { return false; } };

  const climateIdx = () => (typeof M !== "undefined" ? M : []).findIndex(m => m.id === "climate");   // home.html's module list
  function home() {
    try { if (window.HistTour && HistTour.isOpen()) HistTour.close(); } catch { /* closed */ }
    try { if (window.AlertDash && AlertDash.isOpen()) AlertDash.close(); } catch { /* closed */ }
    try { if (typeof curW !== "undefined" && curW >= 0) closeWin(); } catch { /* no window */ }
  }

  // Loaded out of sight once the tour's last avalanche has finished, behind the conclusion card and the two hotspot frames: both Climate Data pages (a hidden page has no size, so each is
  // shown once behind the cover for its map to draw) and the alert dashboard. Their first appearance is then already on the finished page.
  const mapDrawn = m => { try { return !!m && m.isStyleLoaded() && m.areTilesLoaded(); } catch { return false; } };
  const cd = q => document.querySelector(`#cd ${q}`);
  async function prepare(my) {
    if (climateIdx() >= 0) {
      openWin(climateIdx());
      await until(my, () => { const b = cd('[data-view="forecast"]'); return b && b.onclick; }, 5000);
      cd('[data-pg="0"]').click(); cd('[data-view="forecast"]').click();
      await until(my, () => mapDrawn(window.ClimateWS && ClimateWS.map()), 8000);
      cd('[data-view="proj"]').click();
      await until(my, () => mapDrawn(window.ClimateProjections && ClimateProjections.map()), 8000);
      cd('[data-view="forecast"]').click();
    }
    if (window.AlertDash) { await AlertDash.warm(); await until(my, () => mapDrawn(AlertDash.map()), 6000); }
  }

  async function loop(my) {
    for (;;) {
      // 1. the complete cinematic intro
      chapter(0, 60000);
      const hk = frame("hindukush"), kk = frame("karakoram");                   // loaded during the storm, so nothing loads while an avalanche plays
      const intro = bgMap.intro();
      await sleep(my, 1500);
      await until(my, () => !bgMap.introOn(), 180000);
      await Promise.resolve(intro).catch(() => {});
      // 2. front page, 3 s; the tour finishes building behind it
      chapter(1, 3000); bgMap.focus("ALL");
      let tourOk = false; HistTour.warm().finally(() => { tourOk = true; });
      await sleep(my, 3000);
      await until(my, () => tourOk, 20000);
      // 3. Historical Overview: the guided tour, three events (played at 2x)
      chapter(2, 75000);
      let oldSp = null; try { oldSp = localStorage.getItem("ht-speed"); localStorage.setItem("ht-speed", "2"); } catch { /* storage off */ }
      await HistTour.open({ tour: true, only: BEST });
      const evNo = () => { const t = (document.querySelector(".ht-prog .ht-pt") || {}).textContent || ""; const m = t.match(/Event (\d+)/); return m ? +m[1] : 0; };
      const cardUp = () => { const e = document.querySelector(".ht-end"); return !!e && !e.hidden; };
      await until(my, () => (evNo() >= BEST.length && cardUp()) || !HistTour.isOpen(), 240000);   // the last avalanche has finished
      let ready = false; prepare(my).then(() => { ready = true; }, e => { ready = true; if (!(e instanceof Stop)) console.warn("showreel:", e); });
      await sleep(my, 1200);                                                   // its conclusion card, before the tour's own hand-over
      try { if (oldSp == null) localStorage.removeItem("ht-speed"); else localStorage.setItem("ht-speed", oldSp); } catch { /* storage off */ }
      // 4. Hindu Kush hotspots, 5 s, fading in over the tour
      await until(my, () => frameReady(hk) && frameReady(kk), 15000);
      chapter(3, 5000); hk.classList.add("show"); await sleep(my, 800); HistTour.close();
      await sleep(my, 4200);
      // 5. Karakoram hotspots, 5 s
      chapter(4, 5000); kk.classList.add("show"); await sleep(my, 800); hk.classList.remove("show"); await sleep(my, 4200);
      await until(my, () => ready, 15000);                                     // only ever holds this scene a little longer, never a blank screen
      // 6. Climate Data, Historical Climate Records, 5 s: the frame fades away and the page is there
      chapter(5, 5000, 2600); kk.classList.remove("show"); await sleep(my, 5000);
      // 7. Climate Data, Projection Till 2100, 5 s
      chapter(6, 5000, 2600); { const b = cd('[data-view="proj"]'); if (b) b.click(); } await sleep(my, 5000);
      // 8. Avalanche Alert Forecast, 6 s, fading in over Climate Data; the front page gets ready behind it
      chapter(7, 6000, 2600);
      if (window.AlertDash) { await AlertDash.open(); if (!alive(my)) { AlertDash.close(); throw new Stop(); } }
      await sleep(my, 800);
      try { if (curW >= 0) closeWin(); } catch { /* no window */ }
      bgMap.focus("ALL"); await sleep(my, 5200);
      // 9. front page, 5 s, then the loop starts again
      chapter(8, 5000); if (window.AlertDash) AlertDash.close(); await sleep(my, 5000);
    }
  }

  // Pause / resume: the picture holds on the frame on screen, the film's own controls stay alive
  function togglePause() {
    if (!on || !ui) return;
    const pp = ui.querySelector(".sr-pp"), lab = ui.querySelector("[data-sr-state]");
    if (FilmClock.frozen()) {
      FilmClock.thaw();
      ui.classList.remove("paused"); lab.textContent = "Portal showreel"; pp.setAttribute("aria-label", "Pause the film"); pp.title = "Pause (Space)";
      moveH();
    } else {
      ui.classList.remove("idle"); document.body.classList.add("sr-cur");
      ui.classList.add("paused"); lab.textContent = "Paused"; pp.setAttribute("aria-label", "Resume the film"); pp.title = "Resume (Space)";
      const docs = [document]; Object.values(frames).forEach(f => { try { if (f.classList.contains("show") && f.contentDocument) docs.push(f.contentDocument); } catch { /* frame gone */ } });
      FilmClock.freeze(docs, t => !!t.closest && !!t.closest(".sr"));
    }
  }

  function start() {
    if (on) return;
    FilmClock.install();
    on = true; const my = ++tok;
    home();
    build();
    document.body.classList.add("sr-on");
    // Esc returns home; captured before the modules' own Esc handlers
    keyH = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stop(); }
      else if (e.key === " ") { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) togglePause(); }
    };
    addEventListener("keydown", keyH, true);
    clickH = e => { if (e.target.closest && e.target.closest("[data-gohome]")) stop(); };   // the small front-page icon inside a tab ends the film too
    addEventListener("click", clickH, true);
    moveH = () => { document.body.classList.add("sr-cur"); ui && ui.classList.remove("idle"); clearTimeout(idleT);
      idleT = setTimeout(() => { document.body.classList.remove("sr-cur"); ui && ui.classList.add("idle"); }, 2200); };
    addEventListener("mousemove", moveH); moveH();
    loop(my).catch(e => { if (!(e instanceof Stop)) { console.warn("showreel:", e); stop(); } });
  }
  function stop() {
    if (!on) return;
    FilmClock.thaw();                                                          // whatever waited runs on, so it can close properly
    on = false; tok++;
    removeEventListener("keydown", keyH, true); removeEventListener("click", clickH, true); removeEventListener("mousemove", moveH); clearTimeout(idleT);
    try { if (bgMap.introOn()) bgMap.stopIntro(); } catch { /* not running */ }
    home();
    Object.values(frames).forEach(f => f.remove()); frames = {};
    if (ui) ui.remove(); ui = null;
    document.body.classList.remove("sr-on", "sr-cur");
    try { bgMap.focus("ALL"); } catch { /* map not ready */ }
  }
  return { start, stop, running: () => on };
})();
