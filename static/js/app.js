/* Boot, intro sequence, router and global context (region / season / window). */
"use strict";
// One fluorescent colour per reporting window, shared with the home page; SLOT_INK keeps the text readable on it.
const SLOT_COL = ["#FF0000", "#FF3D00", "#FFFF00", "#39FF00", "#00FFFF", "#0047FF", "#8F00FF", "#FF00FF", "#D00020"];
const SLOT_INK = ["#fff", "#fff", "#0a0a0a", "#0a0a0a", "#0a0a0a", "#fff", "#fff", "#fff", "#fff"];

const App = (() => {
  const view = () => document.getElementById("view");
  let current = null;

  // Logos: if the official NDMA logo file is absent, show a neutral text badge instead.
  function wireLogoFallbacks() {
    document.querySelectorAll("img[data-fallback]").forEach(img => {
      const fail = () => { img.hidden = true; const fb = img.parentElement.querySelector("." + img.dataset.fallback); if (fb) fb.hidden = false; };
      if (img.complete && img.naturalWidth === 0) fail(); else img.addEventListener("error", fail);
    });
  }

  async function loadWindows() {
    const res = await UI.api("windows", { season: S.season });
    S.windows = res.windows;
    const today = S.config.today;
    const cur = S.windows.find(w => today >= w.start && today < w.end_exclusive);
    if (!S.windows.some(w => w.id === S.window)) S.window = (cur || S.windows[0]).id;
    fillWindowSelect();
  }

  function fillWindowSelect() {
    document.getElementById("sel-window").innerHTML = S.windows.map(w =>
      `<option value="${w.id}" ${w.id === S.window ? "selected" : ""}>${w.label}${w.prediction_available ? " ●" : ""}</option>`).join("");
    renderSlots();
  }

  // ---------------------------------------------------------- slot bar
  let playTimer = null;
  function renderSlots() {
    const bar = document.getElementById("slotbar");
    if (!bar || !S.windows.length) return;
    const today = S.config.today, idx = S.windows.findIndex(w => w.id === S.window);
    const groups = UI.PHASES.map(ph => ({ ...ph, wins: S.windows.filter(w => +w.start.slice(5, 7) === ph.m) })).filter(g => g.wins.length);
    bar.innerHTML = groups.map(g => {
      const active = g.wins.some(w => w.id === S.window);
      return `<div class="sgroup ${active ? "active" : ""}" style="--pc:${g.c};flex:${g.wins.length}">
        <div class="sg-h"><b>${g.name}</b>${UI.esc(g.label)}</div>
        <div class="sg-b">${g.wins.map(w => {
          const isToday = today >= w.start && today < w.end_exclusive;
          return `<button type="button" class="slot ${w.id === S.window ? "sel" : ""}" data-id="${w.id}" style="--pc:${SLOT_COL[S.windows.indexOf(w) % SLOT_COL.length]};--ink:${SLOT_INK[S.windows.indexOf(w) % SLOT_INK.length]}" title="${w.id}: [${w.start}, ${w.end_exclusive})${w.prediction_available ? " · model output" : " · no model output"}">
            ${isToday ? '<span class="flag today">TODAY</span>' : w.prediction_available ? '<span class="flag model">MODEL</span>' : ""}
            ${UI.fmtDay(w.start)} – ${UI.fmtDay(w.last_day)}<small>${w.id.slice(-3)} · ${w.days}d</small></button>`;
        }).join("")}</div></div>`;
    }).join("") + `<div class="splay">
        <button type="button" id="slot-play" aria-label="${playTimer ? "Pause" : "Play"} window animation">${playTimer ? UI.ICON.pause : UI.ICON.play}</button>
        <div class="lbl"><small>${playTimer ? "PLAYING" : "WINDOW"}</small><b>${idx >= 0 ? S.windows[idx].id.slice(-3) : "—"}</b>
          <span>${idx + 1} of ${S.windows.length}</span><div class="prog"><i style="width:${((idx + 1) / S.windows.length) * 100}%"></i></div></div></div>`;
    bar.querySelectorAll(".slot").forEach(b => b.addEventListener("click", () => { stopPlay(); setWindow(b.dataset.id); }));
    bar.querySelector("#slot-play").addEventListener("click", () => playTimer ? stopPlay() : startPlay());
  }
  // On #hindukush the slot bar drives the snow-outlook timeline: 5 s per slot, skipping windows the outlook does not model.
  const hkPlay = () => current === "hindukush" && window.SF && SF.st.wins;
  function startPlay() {
    if (playTimer) clearInterval(playTimer);
    playTimer = setInterval(() => {
      let i = S.windows.findIndex(w => w.id === S.window);
      for (let k = 0; k < S.windows.length; k++) {
        i = (i + 1) % S.windows.length;
        if (!hkPlay()) break;
        const n = SF.st.wins.findIndex(w => w.id === S.windows[i].id) + 1;
        if (n && SF.st.mod.includes(n)) break;
      }
      setWindow(S.windows[i].id);
    }, hkPlay() ? SF.SLOT_MS : 3500);
    renderSlots();
  }
  function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; renderSlots(); } }

  function fillHeader() {
    document.getElementById("sel-region").innerHTML = S.regions.map(r =>
      `<option value="${r.properties.id}" ${r.properties.id === S.region ? "selected" : ""}>${UI.esc(r.properties.short)}</option>`).join("");
    const years = [];
    for (let y = S.config.default_season; y >= S.config.default_season - 6; y--) years.push(y);
    document.getElementById("sel-season").innerHTML = years.map(y =>
      `<option value="${y}" ${y === S.season ? "selected" : ""}>${y}-${String((y + 1) % 100).padStart(2, "0")}${y === S.config.default_season && !S.config.in_season ? " (upcoming)" : ""}</option>`).join("");
    fillWindowSelect();
    updateChips();
  }

  function updateChips() {
    const loaded = S.catalog.filter(d => d.file_modified);
    const latest = loaded.map(d => d.file_modified).sort().pop();
    const stale = S.catalog.some(d => d.stale);
    const opMissing = S.catalog.some(d => d.operational && d.status === "missing");
    const fresh = document.getElementById("chip-fresh");
    fresh.className = "chip " + (stale || opMissing ? "warn" : "ok");
    fresh.textContent = `Data: ${latest ? latest.slice(0, 10) : "—"}${stale ? " · stale" : opMissing ? " · no live inputs" : ""}`;
    fresh.title = "Most recent dataset update. Operational inputs (snow, weather) " + (opMissing ? "are not connected." : "are connected.");
    const m = document.getElementById("chip-model");
    const connected = S.model && S.model.status !== "not_connected";
    m.className = "chip " + (connected ? "info" : "warn");
    m.textContent = connected ? `Model: ${S.model.model_version || S.model.status}` : "Model: not connected";
  }

  async function render(name) {
    const target = Views[name] ? name : (name === "map" ? "map" : "overview");
    if (current === "hindukush" && target !== "hindukush" && window.HK) { stopPlay(); HK.dispose(); }
    if (current === "karakoram" && target !== "karakoram" && window.KK) KK.dispose();
    if (current === "snowforecast" && target !== "snowforecast" && window.SF) SF.dispose();
    current = target;
    document.querySelectorAll(".sidenav a").forEach(a => a.classList.toggle("active", a.dataset.view === target));
    document.getElementById("sidenav").classList.remove("open");
    document.body.classList.toggle("map-mode", target === "map");
    if (target === "map") {
      view().hidden = true; view().innerHTML = "";
      window.scrollTo(0, 0);
      await MapView.show();
      return;
    }
    MapView.hide(); view().hidden = false;
    view().style.animation = "none"; void view().offsetWidth; view().style.animation = "";
    try { await Views[target](view()); }
    catch (e) { console.error(e); view().innerHTML = UI.error(e); }
    window.scrollTo({ top: 0 });
  }

  async function contextChanged(what) {
    updateChips();
    MapView.onContextChange(what);
    // The Hindu Kush screening is static terrain analysis: region / window changes do not alter it.
    if (current && current !== "map" && current !== "hindukush" && current !== "karakoram" && current !== "snowforecast") await render(current);
  }

  async function setRegion(id) {
    S.region = id; document.getElementById("sel-region").value = id;
    await contextChanged("region");
  }
  async function setWindow(id) {
    S.window = id; document.getElementById("sel-window").value = id;
    renderSlots();
    if (current === "hindukush" && window.HKF) HKF.fromTop();
    await contextChanged("window");
  }

  function wireNavIcons() {
    document.querySelectorAll(".ni[data-ic]").forEach(i => { i.innerHTML = UI.ICON[i.dataset.ic] || ""; });
  }

  function wireHeader() {
    document.getElementById("sel-region").addEventListener("change", e => setRegion(e.target.value));
    document.getElementById("sel-window").addEventListener("change", e => setWindow(e.target.value));
    document.getElementById("sel-season").addEventListener("change", async e => {
      stopPlay(); S.season = +e.target.value; S.window = null; await loadWindows(); await contextChanged("window");
    });
    document.getElementById("nav-toggle").addEventListener("click", () => document.getElementById("sidenav").classList.toggle("open"));
    window.addEventListener("hashchange", () => render(location.hash.slice(1)));
  }

  // ------------------------------------------------------------------ intro
  function intro() {
    const el = document.getElementById("intro");
    const status = document.getElementById("intro-status"), bar = document.querySelector(".intro-progress i");
    let seen = false;
    try { seen = sessionStorage.getItem("introSeen") === "1"; } catch { /* storage unavailable */ }
    const minTime = seen ? 300 : 2200;
    const t0 = performance.now();
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      el.classList.add("done");
      try { sessionStorage.setItem("introSeen", "1"); } catch { /* ignore */ }
      setTimeout(() => el.remove(), 1000);
    };
    document.getElementById("intro-skip").addEventListener("click", close);
    return {
      step(msg, pct) { status.textContent = msg; bar.style.width = pct + "%"; },
      async finish() {
        const wait = Math.max(0, minTime - (performance.now() - t0));
        await new Promise(r => setTimeout(r, wait));
        close();
      },
      fail(msg) { status.textContent = msg; status.style.color = "#f2a197"; },
    };
  }

  async function boot() {
    wireLogoFallbacks(); wireNavIcons();
    const I = intro();
    try {
      I.step("Connecting to portal services…", 15);
      S.config = await UI.api("config");
      S.season = S.config.default_season;
      I.step("Loading mountain-system study areas…", 35);
      S.regions = (await UI.api("regions")).features;
      const qp = new URLSearchParams(location.search);
      if (qp.get("region") && S.regions.some(r => r.properties.id === qp.get("region"))) S.region = qp.get("region");
      const m = /^(\d{4})-\d{2}-W\d{2}$/.exec(qp.get("window") || "");
      if (m) { S.season = +m[1]; S.window = qp.get("window"); }
      I.step("Building seasonal reporting windows…", 55);
      await loadWindows();
      I.step("Checking dataset registry and freshness…", 75);
      S.catalog = (await UI.api("catalog")).datasets;
      I.step("Reading model card…", 90);
      S.model = await UI.api("model");
      I.step("Ready.", 100);
    } catch (e) {
      I.fail("Could not reach portal services: " + e.message);
      console.error(e);
      return;
    }
    fillHeader(); wireHeader();
    // Map tiles can be slow on poor links; never hold the intro on them.
    render(location.hash.slice(1) || "overview").catch(e => console.error(e));
    await I.finish();
  }

  document.addEventListener("DOMContentLoaded", boot);
  return { setRegion, setWindow, render, startPlay, stopPlay, playing: () => !!playTimer };
})();
window.App = App;
