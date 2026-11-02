/* "Intro +" showreel of the home page (button beside "Intro" on the map bar): the portal plays itself as a looping film.
   Scenes: cinematic intro -> front page (3 s) -> Historical Overview tour, first 5 avalanches -> Hindu Kush hotspots (5 s) ->
   Karakoram hotspots (5 s) -> Climate Data, its three pages (3 s each) -> front page (5 s) -> loop. The real modules run live; this
   file only directs them. A dip to black between scenes, chapter lower-thirds, a chapter progress line and an auto-hiding cursor
   make it read as a film, not a slide show. "Home" (or Esc) stops it at any moment and returns to the front page. */
"use strict";

window.Showreel = (() => {
  let on = false, tok = 0, ui = null, keyH = null, frames = {}, idleT = 0, moveH = null;
  const CH = [
    ["Opening", "Pakistan's glacier systems"], ["Command portal", "Front page"], ["Historical overview", "Avalanche events replayed on the terrain"],
    ["Hindu Kush", "Terrain screening & hotspots"], ["Karakoram", "Hotspots"], ["Climate data", "Winter snow & climate, 1970–2026"], ["Command portal", "Front page"],
  ];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const alive = my => on && my === tok;
  class Stop extends Error {}
  const sleep = async (my, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (!alive(my)) throw new Stop(); await wait(Math.min(200, end - Date.now())); } };
  const until = async (my, test, ms) => { const end = Date.now() + ms; while (Date.now() < end && !test()) { if (!alive(my)) throw new Stop(); await wait(250); } };

  const CSS = `
  .sr { position: fixed; inset: 0; z-index: 10050; pointer-events: none; font-family: Inter, "Segoe UI", system-ui, sans-serif; }
  .sr-dip { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity .7s ease; }
  .sr.dip .sr-dip { opacity: 1; }
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
  body.sr-on, body.sr-on * { cursor: none !important; } body.sr-on.sr-cur, body.sr-on.sr-cur * { cursor: auto !important; }
  body.sr-on .sr-home, body.sr-on .sr-home * { cursor: pointer !important; }`;

  function build() {
    if (!document.getElementById("sr-css")) { const s = document.createElement("style"); s.id = "sr-css"; s.textContent = CSS; document.head.appendChild(s); }
    ui = document.createElement("div"); ui.className = "sr";
    ui.innerHTML = `<div class="sr-vig"></div><div class="sr-dip"></div>
      <div class="sr-top"><span class="sr-live"><i></i>Portal showreel</span><button type="button" class="sr-home">⌂ Home <kbd>Esc</kbd></button></div>
      <div class="sr-lt"><small></small><b></b><span></span></div>
      <div class="sr-bar">${CH.map(() => "<i><b></b></i>").join("")}</div>`;
    document.body.appendChild(ui);
    ui.querySelector(".sr-home").onclick = stop;
  }
  // chapter title in the lower third and the chapter progress line (fills over the chapter's expected length)
  function chapter(k, ms) {
    const lt = ui.querySelector(".sr-lt");
    lt.classList.remove("in");
    setTimeout(() => { if (!ui) return; lt.querySelector("small").textContent = `${String(k + 1).padStart(2, "0")} · ${CH[k][0]}`;
      lt.querySelector("b").textContent = CH[k][0]; lt.querySelector("span").textContent = CH[k][1]; lt.classList.add("in"); }, 350);
    setTimeout(() => { if (ui) lt.classList.remove("in"); }, Math.max(2600, Math.min(ms - 600, 5200)));
    ui.querySelectorAll(".sr-bar i").forEach((b, i) => {
      const f = b.querySelector("b"); b.classList.toggle("done", i < k);
      f.style.transition = "none"; f.style.width = i < k ? "100%" : "0";
      if (i === k) { void f.offsetWidth; f.style.transition = `width ${ms}ms linear`; f.style.width = "100%"; }
    });
  }
  const dip = async (my, ms = 700) => { if (!alive(my) || !ui) throw new Stop(); ui.classList.add("dip"); await sleep(my, ms); };
  const undip = () => ui && ui.classList.remove("dip");

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
    try { if (typeof curW !== "undefined" && curW >= 0) closeWin(); } catch { /* no window */ }
  }

  async function loop(my) {
    for (;;) {
      // 1. the complete cinematic intro
      chapter(0, 60000); undip();
      const intro = bgMap.intro();
      await sleep(my, 1500);
      await until(my, () => !bgMap.introOn(), 180000);
      await Promise.resolve(intro).catch(() => {});
      // 2. front page, 3 s
      chapter(1, 3000); bgMap.focus("ALL"); await sleep(my, 3000);
      // 3. Historical Overview: the guided tour, first 5 avalanches (played at 2x)
      await dip(my); chapter(2, 150000);
      let oldSp = null; try { oldSp = localStorage.getItem("ht-speed"); localStorage.setItem("ht-speed", "2"); } catch { /* storage off */ }
      HistTour.open({ tour: true });
      await sleep(my, 1200); undip();
      const evNo = () => { const t = (document.querySelector(".ht-prog .ht-pt") || {}).textContent || ""; const m = t.match(/Event (\d+)/); return m ? +m[1] : 0; };
      await until(my, () => evNo() >= 1 || !HistTour.isOpen(), 60000);
      frame("hindukush"); frame("karakoram");                                   // the next scenes load while the avalanches play
      await until(my, () => evNo() >= 6 || !HistTour.isOpen(), 300000);       // events 1-5, stopped as the 6th begins
      try { if (oldSp == null) localStorage.removeItem("ht-speed"); else localStorage.setItem("ht-speed", oldSp); } catch { /* storage off */ }
      await dip(my); HistTour.close();
      // 4-5. Hindu Kush and Karakoram hotspots, 5 s each
      for (const [k, hash] of [[3, "hindukush"], [4, "karakoram"]]) {
        const f = frame(hash);
        await until(my, () => frameReady(f), 15000);
        chapter(k, 5000); f.classList.add("show"); await sleep(my, 400); undip();
        await sleep(my, 5000);
        await dip(my); f.classList.remove("show");
      }
      // 6. Climate Data: its three pages, 3 s each
      chapter(5, 9800);
      if (climateIdx() >= 0) openWin(climateIdx());
      await sleep(my, 500); undip();
      for (let p = 0; p < 3; p++) {
        const b = document.querySelector(`#cd [data-pg="${p}"]`); if (b) b.click();
        await sleep(my, 3000);
      }
      await dip(my); home();
      // 7. front page, 5 s, then the loop starts again
      bgMap.focus("ALL"); await sleep(my, 500); undip(); chapter(6, 5000); await sleep(my, 5000);
      await dip(my, 900);
    }
  }

  function start() {
    if (on) return;
    on = true; const my = ++tok;
    home();
    build();
    document.body.classList.add("sr-on");
    // Esc returns home; captured before the modules' own Esc handlers
    keyH = e => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stop(); } };
    addEventListener("keydown", keyH, true);
    moveH = () => { document.body.classList.add("sr-cur"); ui && ui.classList.remove("idle"); clearTimeout(idleT);
      idleT = setTimeout(() => { document.body.classList.remove("sr-cur"); ui && ui.classList.add("idle"); }, 2200); };
    addEventListener("mousemove", moveH); moveH();
    loop(my).catch(e => { if (!(e instanceof Stop)) { console.warn("showreel:", e); stop(); } });
  }
  function stop() {
    if (!on) return;
    on = false; tok++;
    removeEventListener("keydown", keyH, true); removeEventListener("mousemove", moveH); clearTimeout(idleT);
    try { if (bgMap.introOn()) bgMap.stopIntro(); } catch { /* not running */ }
    home();
    Object.values(frames).forEach(f => f.remove()); frames = {};
    if (ui) ui.remove(); ui = null;
    document.body.classList.remove("sr-on", "sr-cur");
    try { bgMap.focus("ALL"); } catch { /* map not ready */ }
  }
  return { start, stop, running: () => on };
})();
