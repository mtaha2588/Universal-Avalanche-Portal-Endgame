/* Snow outlook 2026-27: the whole-north view (SF) and the Hindu Kush forecast mode (HKF).
   Everything comes from data/forecast/* (scripts/build_snow_forecast.py). It is a SEASONAL statistical
   outlook: totals are forecast, timing inside the season is the 1990-2025 average, danger days are
   snowfall-threshold counts. Not a weather forecast, not a probability, not validated. */
"use strict";

const SF = (() => {
  const RANGES = [["Hindu Kush", "#2a9d8f"], ["Karakoram", "#8ecae6"], ["Himalaya", "#e9c46a"]];
  const COL = Object.fromEntries(RANGES);
  // Forecast palette (blue -> magenta). Deliberately not the terrain-screening yellow -> red.
  const RAMP = ["#27406b", "#3f6fd1", "#7b5cf0", "#c243d6", "#ff4fb0"];
  const st = { meta: null, stations: null, map: null, win: 3, play: null, ready: false };
  const p2 = i => String(i).padStart(2, "0");
  const fmt = (n, d = 0) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function ramp(t) {
    t = Math.max(0, Math.min(1, t || 0)); const x = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
    const a = hex(RAMP[i]), b = hex(RAMP[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
  }
  const gradient = () => `linear-gradient(90deg,${RAMP.join(",")})`;
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2"/></svg>';

  async function load() {
    if (st.meta) return st;
    const meta = await UI.api("forecast/snow");
    if (!meta.available) return { meta };
    const fc = await UI.api("layer/snow_stations");
    st.meta = meta; st.stations = fc.features;
    st.wins = meta.windows; st.cov = Object.fromEntries(meta.window_coverage.map(c => [c.id, c]));
    st.mod = meta.windows.map((w, i) => i + 1).filter(i => { const c = st.cov[meta.windows[i - 1].id]; return c.days_in_data === c.days; });
    st.hmax = Math.max(...st.stations.flatMap(f => st.mod.map(i => f.properties["h" + p2(i)] || 0)));
    return st;
  }
  const wlabel = i => `${UI.fmtDay(st.wins[i - 1].start)} – ${UI.fmtDay(st.wins[i - 1].last_day)}`;
  const hv = (p, i) => p["h" + p2(i)];

  function notices(m) {
    const t = m.thresholds_cm_3d;
    return `<div class="notice warn sf-notice"><span class="tag warn">Seasonal outlook</span><span>
      <strong>Not a weather forecast and not a warning.</strong> The model forecasts each station's <b>winter snowfall total</b>; when it falls is the 1990–2025 average.
      Hindu Kush and Karakoram forecast <b>= normal (no method beat it)</b>; only the Himalaya departs from normal (El Niño analogs, small skill).
      Danger days count 3-day snowfall ≥ ${t.high} cm (HIGH) or ≥ ${t.elevated} cm (elevated) — <b>default thresholds, not learned from observed avalanches</b>. Not validated.
      The ENSO input (ONI ${m.enso_input.oni}) comes from the notebook and is not verified here. <b>1–15 April is not modelled</b> (data end 31 March).</span></div>`;
  }

  // Window picker used by both the map and the Hindu Kush mode. Unmodelled windows stay visible but disabled.
  function winBar(cur, id) {
    return `<div class="sf-wins" id="${id}">${st.wins.map((w, k) => {
      const i = k + 1, ok = st.mod.includes(i);
      return `<button type="button" data-w="${i}" class="${i === cur ? "on" : ""} ${ok ? "" : "off"}" ${ok ? "" : "disabled"}
        title="${w.id}: ${wlabel(i)}${ok ? "" : " — not modelled (data end 31 Mar)"}"><b>W${p2(i)}</b><span>${UI.fmtDay(w.start)}</span></button>`;
    }).join("")}<button type="button" class="sf-play" data-play title="Play through the season">${UI.ICON.play}</button></div>`;
  }
  const SLOT_MS = 5000;               // seconds per 15-day slot in the animation
  let tick = null;
  function wireBar(el, get, set) {
    tick = { get, set };
    el.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { set(+b.dataset.w); if (st.play) { stopPlay(); startPlay(); } });
    const pl = el.querySelector("[data-play]");
    if (pl) pl.onclick = () => (st.play ? stopPlay() : startPlay());
  }
  function startPlay() {
    if (!tick) return;
    if (st.play) clearInterval(st.play);
    const pl = document.querySelector("[data-play]");
    if (pl) { pl.innerHTML = UI.ICON.pause; pl.classList.add("on"); }
    st.play = setInterval(() => { const k = st.mod.indexOf(tick.get()); tick.set(st.mod[(k + 1) % st.mod.length]); }, SLOT_MS);
  }
  function stopPlay() {
    if (st.play) clearInterval(st.play); st.play = null;
    document.querySelectorAll(".sf-play").forEach(b => { b.innerHTML = UI.ICON.play; b.classList.remove("on"); });
  }
  const markBar = (el, w) => el.querySelectorAll("[data-w]").forEach(b => b.classList.toggle("on", +b.dataset.w === w));

  // ---------------------------------------------------------------- charts
  function heatmap() {
    const rows = RANGES.flatMap(([r]) => st.stations.filter(f => f.properties.range === r)
      .sort((a, b) => st.mod.reduce((s, i) => s + (hv(b.properties, i) || 0), 0) - st.mod.reduce((s, i) => s + (hv(a.properties, i) || 0), 0)));
    const cw = 62, ch = 17, L = 170, T = 40, W = L + cw * st.wins.length + 8, H = T + ch * rows.length + 6;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="sf-heat" role="img" aria-label="Expected HIGH-danger days per station and window">
      <defs><pattern id="sf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#0e1a2c"/><path d="M0 0v6" stroke="#29446a" stroke-width="2"/></pattern></defs>`;
    st.wins.forEach((w, k) => { svg += `<text x="${L + cw * k + cw / 2}" y="16" text-anchor="middle" class="sf-ax"><tspan font-weight="600">W${p2(k + 1)}</tspan></text>
      <text x="${L + cw * k + cw / 2}" y="30" text-anchor="middle" class="sf-ax2">${UI.fmtDay(w.start)}</text>`; });
    let prev = "";
    rows.forEach((f, r) => {
      const p = f.properties, y = T + ch * r;
      if (p.range !== prev) { svg += `<rect x="0" y="${y + 3}" width="3" height="${ch * rows.filter(x => x.properties.range === p.range).length - 6}" fill="${COL[p.range]}"/>`; prev = p.range; }
      svg += `<text x="${L - 8}" y="${y + 12.5}" text-anchor="end" class="sf-rl">${UI.esc(p.name)}</text>`;
      st.wins.forEach((w, k) => {
        const i = k + 1, v = hv(p, i), ok = st.mod.includes(i), x = L + cw * k;
        svg += ok && v != null
          ? `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${ramp(v / st.hmax)}"><title>${UI.esc(p.name)} · W${p2(i)} ${wlabel(i)}: ${fmt(v, 2)} expected HIGH-danger days</title></rect>
             <text x="${x + cw / 2}" y="${y + 12.5}" text-anchor="middle" class="sf-cv">${v >= 0.05 ? fmt(v, 1) : ""}</text>`
          : `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="url(#sf-hatch)"><title>Not modelled (data end 31 Mar)</title></rect>`;
      });
    });
    return svg + "</svg>";
  }

  function rangeBars() {
    const k = st.mod.length, W = 640, H = 230, L = 40, B = 36, T = 14, gw = (W - L - 8) / k;
    const mean = (r, i) => { const s = st.stations.filter(f => f.properties.range === r); return s.reduce((a, f) => a + (f.properties["s" + p2(i)] || 0), 0) / s.length; };
    const mx = Math.max(...RANGES.flatMap(([r]) => st.mod.map(i => mean(r, i))));
    const y = v => T + (H - T - B) * (1 - v / mx), bw = (gw - 14) / 3;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="sf-bars" role="img" aria-label="Forecast snow per window by range">`;
    [0, 0.5, 1].forEach(t => { s += `<line x1="${L}" x2="${W - 4}" y1="${y(mx * t)}" y2="${y(mx * t)}" class="sf-grid"/><text x="${L - 6}" y="${y(mx * t) + 4}" text-anchor="end" class="sf-ax2">${fmt(mx * t)}</text>`; });
    st.mod.forEach((i, j) => {
      RANGES.forEach(([r, c], q) => {
        const v = mean(r, i), x = L + gw * j + 7 + bw * q;
        s += `<path d="M${x},${H - B} V${y(v) + 3} a3,3 0 0 1 3,-3 h${bw - 8} a3,3 0 0 1 3,3 V${H - B} z" fill="${c}"><title>${r} · W${p2(i)} ${wlabel(i)}: ${fmt(v)} cm per station (mean)</title></path>`;
      });
      s += `<text x="${L + gw * j + gw / 2}" y="${H - 18}" text-anchor="middle" class="sf-ax"><tspan font-weight="600">W${p2(i)}</tspan></text><text x="${L + gw * j + gw / 2}" y="${H - 5}" text-anchor="middle" class="sf-ax2">${UI.fmtDay(st.wins[i - 1].start)}</text>`;
    });
    return s + "</svg>";
  }

  const legend = () => `<div class="sf-leg">${RANGES.map(([r, c]) => `<span><i style="background:${c}"></i>${r}</span>`).join("")}</div>`;
  const ramLeg = (label, a, b) => `<div class="sf-ramp"><span>${a}</span><i style="background:${gradient()}"></i><span>${b}</span><em>${label}</em></div>`;

  function table() {
    const rows = RANGES.flatMap(([r]) => st.stations.filter(f => f.properties.range === r).sort((a, b) => b.properties.high_days - a.properties.high_days));
    return `<div class="tbl-wrap"><table class="tbl sf-tbl"><thead><tr><th>Range</th><th>Station</th><th>Type</th><th class="n">Normal (cm)</th><th class="n">Forecast (cm)</th><th class="n">80 % range</th><th class="n">% normal</th>
      <th class="n">HIGH days (fc / normal)</th><th class="n">P(≥1 HIGH storm)</th><th>Busiest window</th><th>Method</th></tr></thead><tbody>${rows.map(f => {
        const p = f.properties, pk = st.mod.reduce((b, i) => (hv(p, i) || 0) > (hv(p, b) || 0) ? i : b, st.mod[0]);
        return `<tr><td><i class="sf-dot" style="background:${COL[p.range]}"></i>${UI.esc(p.range)}</td><td>${UI.esc(p.name)}</td><td>${UI.esc(p.type)}</td><td class="n">${fmt(p.normal_cm)}</td><td class="n">${fmt(p.forecast_cm)}</td>
          <td class="n">${fmt(p.range80_cm[0])}–${fmt(p.range80_cm[1])}</td><td class="n">${fmt(p.pct_of_normal)}</td><td class="n">${fmt(p.high_days, 1)} / ${fmt(p.normal_high_days, 1)}</td>
          <td class="n">${fmt(p.p_high_storm)} %</td><td>${hv(p, pk) > 0 ? `W${p2(pk)} · ${wlabel(pk)}` : "—"}</td><td class="muted">${UI.esc(p.method)}</td></tr>`;
      }).join("")}</tbody></table></div>`;
  }

  // ---------------------------------------------------------------- map
  async function initMap(el) {
    const wrap = el.closest(".sf-mapwrap");
    try {
      if (!document.querySelector('link[href="/static/vendor/maplibre-gl.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/static/vendor/maplibre-gl.css"; document.head.appendChild(l); }
      if (!window.maplibregl) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/static/vendor/maplibre-gl.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    } catch { el.innerHTML = UI.empty("Map library could not be loaded", ""); return; }
    if (!document.body.contains(el)) return;
    MapPerf.tune(maplibregl);
    const map = new maplibregl.Map(MapPerf.opts({ container: el, center: [74.3, 35.7], zoom: 5.5, attributionControl: true, style: {
      version: 8, glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: { sat: { type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1626" } }, { id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.5, "raster-brightness-max": 0.7 } }] } }));
    st.map = map; map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    await new Promise(r => map.once("load", r));
    if (st.map !== map) return;
    const bnd = await UI.api("layer/boundaries").catch(() => ({ features: [] }));
    map.addSource("bnd", { type: "geojson", data: { type: "FeatureCollection", features: bnd.features.filter(f => ["pakistan", "province"].includes(f.properties.layer)) } });
    map.addLayer({ id: "bnd", type: "line", source: "bnd", paint: { "line-color": "#fff", "line-opacity": 0.6, "line-width": 1.2 } });
    map.addSource("st", { type: "geojson", data: { type: "FeatureCollection", features: st.stations } });
    map.addLayer({ id: "st-pt", type: "circle", source: "st", paint: { "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": 0.92 } });
    map.addLayer({ id: "st-lbl", type: "symbol", source: "st", minzoom: 6.2, layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top" },
      paint: { "text-color": "#fff", "text-halo-color": "#07101c", "text-halo-width": 1.6 } });
    const pop = new maplibregl.Popup({ closeButton: false, offset: 12, className: "hk-tip" });
    map.on("mousemove", "st-pt", e => {
      map.getCanvas().style.cursor = "pointer"; const p = e.features[0].properties, v = p["h" + p2(st.win)];
      pop.setLngLat(e.lngLat).setHTML(`<div class="hk-tip-h"><b>${UI.esc(p.name)}</b> <span class="muted">${UI.esc(p.range)} · ${UI.esc(p.type)}</span></div>
        W${p2(st.win)} ${wlabel(st.win)}: <b>${v == null ? "not modelled" : fmt(v, 2)}</b> expected HIGH-danger days<br>Season forecast ${fmt(p.forecast_cm)} cm (${fmt(p.pct_of_normal)} % of normal)`).addTo(map);
    });
    map.on("mouseleave", "st-pt", () => { map.getCanvas().style.cursor = ""; pop.remove(); });
    st.ready = true; paintMap();
    const b = new maplibregl.LngLatBounds(); st.stations.forEach(f => b.extend(f.geometry.coordinates)); map.fitBounds(b, { padding: 50, duration: 1800 });
  }
  function paintMap() {
    if (!st.ready) return; const k = "h" + p2(st.win), m = st.map;
    const stops = [-1, "rgba(120,130,150,.55)", 0, ramp(0.02), ...RAMP.flatMap((c, i) => [Math.max(0.01, st.hmax * (i + 1) / RAMP.length), c])];
    m.setPaintProperty("st-pt", "circle-color", ["interpolate", ["linear"], ["coalesce", ["get", k], -1], ...stops]);
    m.setPaintProperty("st-pt", "circle-radius", ["interpolate", ["linear"], ["coalesce", ["get", k], 0], 0, 5, st.hmax, 24]);
  }

  // ---------------------------------------------------------------- page
  async function render(el) {
    dispose();
    const head = `<div class="page-h"><div><div class="eyebrow">Northern Pakistan · Winter ${st.meta ? st.meta.season : "2026-27"}</div><h2>Snow outlook, 15 December – 15 April</h2>
      <p>Hindu Kush, Karakoram and Himalaya: forecast winter snowfall at 36 stations and the expected number of heavy-snowfall (HIGH-danger) days in each 15-day reporting window.</p></div>
      <div class="toolbar" style="margin:0"><a class="btn primary" href="#hindukush">${ICON} Hindu Kush terrain × snow</a></div></div>`;
    el.innerHTML = head + UI.loading("Loading snow outlook…");
    await load();
    if (!st.stations) { el.innerHTML = head + UI.empty("No snow outlook imported", `<p>${UI.esc((st.meta || {}).message || "")}</p>`); return; }
    const m = st.meta, T = m.thresholds_cm_3d;
    const cards = RANGES.map(([r, c]) => { const g = m.ranges[r], sk = m.skill_pct_vs_normal[r], meth = m.method_by_range[r], best = Math.max(...Object.values(sk).filter((v, i) => i > 0));
      return `<div class="card kpi sf-rc" style="--c:${c}"><div class="k-label">${r} · ${g.stations} stations</div>
        <div class="k-val">${fmt(g.pct_of_normal)}<small> % of normal</small></div>
        <div class="k-note">Method: <b>${UI.esc(meth)}</b><br>HIGH-danger days per station ${fmt(g.high_days, 1)} (normal ${fmt(g.normal_high_days, 1)})<br>
        <span class="muted">Best skill vs normal ${fmt(best, 1)} %</span></div></div>`; }).join("");
    el.innerHTML = head + notices(m) + `<div class="grid g3" style="margin-bottom:14px">${cards}</div>
      <div class="card sf-mapcard"><h3>Stations by window <span class="tag info">Size and colour = expected HIGH-danger days</span></h3>
        <div class="sf-mapwrap"><div id="sf-map" class="sf-map"></div><div class="sf-ml">${ramLeg(`HIGH-danger days (≥ ${T.high} cm in 3 days)`, "0", fmt(st.hmax, 1))}<div class="sf-grey"><i></i>not modelled</div></div></div>
        <div id="sf-mw">${winBar(st.win, "sf-wb")}</div><div class="sf-wl muted" id="sf-wl"></div></div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>Forecast snow per window, mean per station <span class="tag">cm</span></h3>${rangeBars()}${legend()}
          <p class="muted hk-cap">Season total is forecast; its split across windows is the 1990–2025 average timing. W01–W07 cover 15 Dec – 29 Mar. The part of the season before 15 Dec (${fmt(st.stations.reduce((a, f) => a + f.properties.season_share_before_15dec, 0) / st.stations.length * 100)} % of the winter total on average) is not in a window.</p></div>
        <div class="card"><h3>Expected HIGH-danger days, every station <span class="tag">per window</span></h3><div class="sf-heatwrap">${heatmap()}</div>
          ${ramLeg("expected HIGH-danger days", "0", fmt(st.hmax, 1))}<p class="muted hk-cap">Hatched = not modelled: the data end on 31 March, so W08 (30 Mar – 13 Apr) and W09 (14 Apr) stay empty rather than estimated.</p></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>All stations <span class="tag warn">Verify before use</span></h3>${table()}</div>
      <div class="card" style="margin-top:14px"><h3>Method and limits</h3><ul class="sf-lim"><li>${UI.esc(m.method_note)}</li><li>${UI.esc(m.skill_note)}</li><li>${UI.esc(T.note)}</li><li>${UI.esc(m.coverage_note)}</li>
        <li>${UI.esc(m.enso_input.note)}</li><li>${UI.esc(m.validation)}</li><li>ERA5-Land (~9 km) underestimates snow on high ice; glacier stations are indicative.</li></ul>
        <p class="muted hk-cap">Source: ${UI.esc(m.source)}.</p></div>`;
    const bar = el.querySelector("#sf-mw"), setW = w => { st.win = w; markBar(bar, w); el.querySelector("#sf-wl").innerHTML = `<b>W${p2(w)}</b> · ${wlabel(w)} · ${st.wins[w - 1].days} days`; paintMap(); };
    wireBar(bar, () => st.win, setW); setW(st.win);
    initMap(el.querySelector("#sf-map")).catch(e => console.error(e));
  }
  function dispose() { stopPlay(); if (st.map) { try { st.map.remove(); } catch { /* detached */ } } st.map = null; st.ready = false; }

  return { render, dispose, load, st, ramp, ramLeg, winBar, wireBar, markBar, stopPlay, startPlay, SLOT_MS, wlabel, hv, p2, fmt, notices, RAMP, ICON, gradient };
})();
window.SF = SF;
Views.snowforecast = SF.render;

/* ---------------------------------------------------------------------------------------------
   Hindu Kush forecast mode. Default: an animated slot-by-slot view (15-day windows, 5 s each).
   Main hotspot (star, yellow -> dark red by risk): a DEM very-high area (>= the page's minimum area) where the nearest
   station forecasts >= 0.5 HIGH-danger days in that slot. Red dot: any other DEM very-high area.
   Dark blue dot: screening tile whose station forecasts heavy snow in that slot (darker = more).
   Green dot: populated area (approximate town centre). Screening and forecast only, not warnings.  */
const HKF = (() => {
  const C = { star: "#ff2b2b", red: "#e11d2e", navy: ["#9ec5ff", "#2456d6", "#06124a"], green: "#22c55e" };
  const LAB = { general: "General risk", dem: "DEM hotspots", wx: "Snow & weather", pop: "Populated" };
  const TIP = {
    general: "General risk: main hotspots (stars, yellow = lower to dark red = highest) and DEM hotspots (red dots)",
    dem: "DEM hotspots only: every very-high area above the minimum area (red dots)",
    wx: "Snow & weather only: screening tiles with heavy-snow days at their station (dark blue)",
  };
  const ICON = {
    general: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.9l-5.8 3.1 1.4-6.4L2.7 9.2l6.5-.7z"/></svg>',
    dem: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1.5 20 9 6.5l4.2 6.8 2.6-3.6L22.5 20z"/></svg>',
    wx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v20M4.2 6.9l15.6 10.2M19.8 6.9 4.2 17.1M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2"/></svg>',
    pop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/></svg>',
  };
  const { p2, fmt } = SF;
  // Star colour by combined risk r (0-1): yellow = lower, dark red = highest. Fixed scale, so slots compare.
  const STAR_STOPS = [[0, "#fde047"], [0.35, "#f59e0b"], [0.6, "#dc2626"], [1, "#7f1d1d"]];
  const STAR_RAMP = ["interpolate", ["linear"], ["get", "r"], ...STAR_STOPS.flat()];
  const STAR_GRAD = `linear-gradient(90deg,${STAR_STOPS.map(s => s[1]).join(",")})`;
  const fc = f => ({ type: "FeatureCollection", features: f });
  const SRC = ["fz", "fs", "fdem", "fwx", "fpop"];
  const LYR = ["fz-fill", "fz-line", "fs-pt", "fs-lbl", "fd-pt", "fd-star", "fw-pt", "fpop-pt", "fpop-lbl"];
  const hexStops = max => ["interpolate", ["linear"], ["coalesce", ["get", "X"], 0], 0, "rgba(39,64,107,.05)",
    ...SF.RAMP.flatMap((c, i) => [Math.max(0.01, max * (i + 1) / SF.RAMP.length), c])];
  const withKey = (e, k) => JSON.parse(JSON.stringify(e).replace('"X"', JSON.stringify(k)));
  const interact = e => { if (e.originalEvent) stopAll(); };
  // The timeline is the portal's slot bar at the top of the page (App); stop it and any old SF animation.
  const stopAll = () => { SF.stopPlay(); if (window.App) App.stopPlay(); };
  const playing = () => !!(window.App && App.playing());
  // Window number (1-9) of the slot selected in the top bar, if it belongs to the outlook season.
  const topWin = () => { const i = SF.st.wins.findIndex(w => w.id === S.window); return i >= 0 ? i + 1 : null; };

  let on = false, win = 3, data = null, saved = null, host = null, popup = null, regEl = null, rail = null, cap = null;
  let mode = "general", pop = false, cur = null, last = null;

  async function loadAll() {
    if (data) return data;
    const hk = HK.state;
    const [s, zones, tiles] = await Promise.all([SF.load(), UI.api("layer/hk_zones"), UI.api("layer/hk_tiles_windows")]);
    if (!s.stations) throw new Error("snow outlook not imported");
    const hkst = s.stations.filter(f => f.properties.range === "Hindu Kush");
    const hmax = Math.max(...hkst.flatMap(f => s.mod.map(i => f.properties["h" + p2(i)] || 0)));
    const tileP = Object.fromEntries(tiles.features.map(f => [f.properties.tile_id, f.properties]));
    return (data = { zones, tz: tiles, hkst, hmax: Math.max(hmax, 0.01), tileP, settle: hk.settlements || [] });
  }

  // One slot: DEM hotspots at or above the page's minimum area, and the weather tiles.
  function frame(w) {
    const hk = HK.state, h = "h" + p2(w), k = "k" + p2(w);
    const sh = Object.fromEntries(data.hkst.map(f => [f.properties.name, f.properties[h] || 0]));
    const wl = n => Math.min(1, (sh[n] || 0) / data.hmax);
    const dem = HK.filtered().map(f => {
      const p = f.properties, t = data.tileP[p.tile_id], ov = !!t && t[k] >= 2, st = t ? t.station : null;
      return { type: "Feature", geometry: f.geometry, properties: {
        id: p.rank, tile: p.tile_id, a: p.area_ha, sc: p.max_score, ov: ov ? 1 : 0, st, sh: sh[st] || 0,
        r: ov ? p.max_score * wl(st) : 0, elev: p.mean_elev_m, slope: p.mean_slope_deg } };
    });
    const wx = data.tz.features.filter(f => f.properties[k] >= 2).map(f => ({ type: "Feature", geometry: f.geometry,
      properties: { tile: f.properties.tile_id, st: f.properties.station, wl: wl(f.properties.station), sh: sh[f.properties.station] || 0 } }));
    return { dem, wx };
  }
  function summarise() {
    return SF.st.mod.map(w => {
      const fr = frame(w), stars = fr.dem.filter(f => f.properties.ov);
      return { w, stars: stars.length, dem: fr.dem.length, risk: stars.reduce((a, f) => a + f.properties.r, 0),
        top: stars.slice().sort((a, b) => b.properties.r - a.properties.r).slice(0, 3) };
    });
  }

  function starImage() {
    const c = document.createElement("canvas"); c.width = c.height = 96; const x = c.getContext("2d");
    x.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 20 : 45, a = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(48 + r * Math.cos(a), 50 + r * Math.sin(a)); }
    x.closePath(); x.fillStyle = "#fff"; x.fill();          // SDF mask: colour comes from icon-color
    return x.getImageData(0, 0, 96, 96);
  }

  async function toggle(el, auto) { on ? off() : await enter(el, auto); }

  async function enter(el, auto) {
    // The page no longer has a "Snow forecast" button (forecast mode is always on); a detached stand-in keeps the busy states harmless.
    const btn = el.querySelector("#hk-snow") || document.createElement("button"), hk = HK.state;
    btn.disabled = true; btn.classList.add("busy");
    try {
      for (let n = 0; n < 60 && !hk.ready; n++) await new Promise(r => setTimeout(r, 250));
      if (!hk.ready) throw new Error("map not ready");
      await loadAll();
    } catch (e) {
      btn.disabled = false; btn.classList.remove("busy");
      const d = el.querySelector("#hk-detail"); d.hidden = false; d.innerHTML = `<div class="state-error">Snow outlook unavailable: ${UI.esc(e.message)}</div>`;
      return;
    }
    if (!document.body.contains(el) || !hk.map) return;
    btn.disabled = false; btn.classList.remove("busy");
    on = true; host = el; btn.classList.add("on");
    const m = hk.map;
    saved = { overlay: hk.overlay, showPts: hk.showPts, showTiles: hk.showTiles, showSet: hk.showSet, terrain: hk.terrain };
    Object.assign(hk, { overlay: false, showPts: false, showTiles: false, showSet: false, terrain: true });
    el.querySelectorAll("#hk-l-ov,#hk-l-pts,#hk-l-tiles,#hk-l-set").forEach(c => { c.checked = false; });
    el.querySelector("#hk-3d").classList.add("on");

    m.addSource("fz", { type: "geojson", data: data.zones });
    m.addSource("fs", { type: "geojson", data: fc(data.hkst) });
    m.addSource("fdem", { type: "geojson", data: fc([]) });
    m.addSource("fwx", { type: "geojson", data: fc([]) });
    m.addSource("fpop", { type: "geojson", data: fc(data.settle.map(f => ({ type: "Feature", geometry: f.geometry, properties: { name: f.properties.name } }))) });
    if (!m.hasImage("star-sdf")) m.addImage("star-sdf", starImage(), { pixelRatio: 2, sdf: true });
    m.addLayer({ id: "fz-fill", type: "fill", source: "fz", paint: { "fill-opacity": 0.3, "fill-color-transition": { duration: 500 } } });
    m.addLayer({ id: "fz-line", type: "line", source: "fz", paint: { "line-color": "#d9c8ff", "line-width": 1, "line-dasharray": [2, 2], "line-opacity": 0.7 } });
    m.addLayer({ id: "fs-pt", type: "circle", source: "fs", paint: { "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-color-transition": { duration: 500 }, "circle-radius-transition": { duration: 500 } } });
    m.addLayer({ id: "fs-lbl", type: "symbol", source: "fs", layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": 11, "text-offset": [0, 1.4], "text-anchor": "top" },
      paint: { "text-color": "#e9e2ff", "text-halo-color": "#07101c", "text-halo-width": 1.6 } });
    m.addLayer({ id: "fw-pt", type: "circle", source: "fwx", paint: { "circle-color": ["interpolate", ["linear"], ["get", "wl"], 0, C.navy[0], 0.5, C.navy[1], 1, C.navy[2]],
      "circle-radius": ["interpolate", ["linear"], ["get", "wl"], 0, 4, 1, 11], "circle-stroke-color": "#fff", "circle-stroke-width": 1.4,
      "circle-color-transition": { duration: 500 }, "circle-radius-transition": { duration: 500 } } });
    m.addLayer({ id: "fd-pt", type: "circle", source: "fdem", paint: { "circle-color": C.red, "circle-stroke-color": "#ffd6d6", "circle-stroke-width": 0.8, "circle-opacity": 0.92,
      "circle-radius": ["interpolate", ["linear"], ["get", "sc"], 0.5, 3, 1, 9] } });
    m.addLayer({ id: "fd-star", type: "symbol", source: "fdem", filter: ["==", ["get", "ov"], 1], layout: { "icon-image": "star-sdf",
      "icon-size": 0.5, "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-color": STAR_RAMP, "icon-halo-color": "#0b0f18", "icon-halo-width": 1.6, "icon-color-transition": { duration: 500 } } });
    m.addLayer({ id: "fpop-pt", type: "circle", source: "fpop", paint: { "circle-color": C.green, "circle-radius": 5.5, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    m.addLayer({ id: "fpop-lbl", type: "symbol", source: "fpop", minzoom: 6.5, layout: { "text-field": ["get", "name"], "text-font": ["Open Sans Semibold"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" },
      paint: { "text-color": "#bbf7d0", "text-halo-color": "#06160c", "text-halo-width": 1.6 } });

    popup = new hk.gl.Popup({ closeButton: false, offset: 12, className: "hk-tip" });
    const over = (id, fn) => { m.on("mousemove", id, e => { m.getCanvas().style.cursor = "pointer"; fn(e); }); m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; popup.remove(); }); };
    over("fd-pt", tipDem); over("fd-star", tipDem); over("fw-pt", tipWx); over("fs-pt", tipSt); over("fpop-pt", tipPop);
    ["dragstart", "wheel", "touchstart"].forEach(ev => m.on(ev, interact));
    el.querySelector(".hk-stage").classList.add("hk-fc-on");
    HK.apply();
    m.easeTo({ center: [72.5, 35.7], zoom: 6.9, pitch: 55, bearing: -12, duration: 2600,
      padding: { top: 70, bottom: 60, left: el.querySelector(".hk-ctl") ? 230 : 110, right: window.innerWidth > 1100 ? 420 : 20 } });

    last = summarise();
    buildCap(el); buildRail(el);
    mode = "general"; pop = false;
    win = topWin() || SF.st.mod[0];
    setWin(win); applyMode();
    register(el);
    if (!auto) el.querySelector(".hk-stage").scrollIntoView({ behavior: "smooth", block: "start" });
    else if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(() => { if (on && !playing() && !HK.state.tour) App.startPlay(); }, 3200);
  }

  // ------------------------------------------------------------ tooltips
  const tipDem = e => {
    const p = e.features[0].properties;
    popup.setLngLat(e.lngLat).setHTML(`<div class="hk-tip-h">${p.ov ? "★ Main hotspot" : "● DEM hotspot"} <span class="muted">${fmt(p.a)} ha</span></div>
      Tile <b class="mono">${UI.esc(p.tile)}</b> · ${fmt(p.elev)} m · ${fmt(p.slope, 1)}°<br>Terrain score <b>${fmt(p.sc, 2)}</b> <span class="muted">(index, not a probability)</span><br>
      ${p.ov ? `Heavy snow in this slot at ${UI.esc(p.st)}: <b>${fmt(p.sh, 2)}</b> HIGH-danger days<br>Combined risk <b>${fmt(p.r, 2)}</b> <span class="muted">(0–1 index: terrain × snow, not a probability)</span>` : `<span class="muted">No heavy-snow slot at its station</span>`}`).addTo(HK.state.map);
  };
  const tipWx = e => {
    const p = e.features[0].properties;
    popup.setLngLat(e.lngLat).setHTML(`<div class="hk-tip-h"><b>${UI.esc(p.st)}</b> <span class="muted">snow / weather</span></div>
      Tile <b class="mono">${UI.esc(p.tile)}</b><br>This slot: <b>${fmt(p.sh, 2)}</b> HIGH-danger days expected at the station`).addTo(HK.state.map);
  };
  const tipSt = e => {
    const p = e.features[0].properties, v = p["h" + p2(win)];
    popup.setLngLat(e.lngLat).setHTML(`<div class="hk-tip-h"><b>${UI.esc(p.name)}</b> <span class="muted">station</span></div>
      Season forecast <b>${fmt(p.forecast_cm)} cm</b> (${fmt(p.pct_of_normal)} % of normal)<br>This slot: <b>${fmt(v, 2)}</b> HIGH-danger days`).addTo(HK.state.map);
  };
  const tipPop = e => {
    popup.setLngLat(e.lngLat).setHTML(`<div class="hk-tip-h"><b>${UI.esc(e.features[0].properties.name)}</b> <span class="muted">populated</span></div>
      Approximate town centre. The source gives no population figure.`).addTo(HK.state.map);
  };

  // ------------------------------------------------------------ panels
  function buildCap() {
    cap = document.createElement("div"); cap.className = "hkf-cap";
    host.querySelector(".hk-mapwrap").appendChild(cap);
  }

  function buildRail(el) {
    rail = document.createElement("div"); rail.className = "hkf-rail";
    rail.innerHTML = ["general", "dem", "wx"].map(id => `<button type="button" class="hkf-ic ${id}" data-m="${id}" title="${UI.esc(TIP[id])}"><span>${ICON[id]}</span><em>${LAB[id]}</em></button>`).join("")
      + `<button type="button" class="hkf-ic pop" data-pop title="Show populated areas (green dots)"><span>${ICON.pop}</span><em>${LAB.pop}</em></button>`
      + `<a class="hkf-ic kkgo" href="#karakoram" title="Go to the Karakoram region"><span>${ICON.dem}</span><em>Karakoram</em></a>`;
    rail.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { const id = b.dataset.m; mode = (id === "general" || mode === id) ? "general" : id; applyMode(); });
    rail.querySelector("[data-pop]").onclick = () => { pop = !pop; applyMode(); };
    el.querySelector(".hk-mapwrap").appendChild(rail);
  }

  function register(el) {
    const s = SF.st, tiles = data.tz.features.map(f => f.properties), rule = s.meta.threat_rules;
    const of = k => tiles.filter(t => t.threat_season === k);
    const short = ids => ids.map(id => "W" + id.slice(-2)).join(", ");
    const rowsOf = (arr, note) => arr.slice(0, 8).map(t => `<li><b class="mono">${UI.esc(t.tile_id)}</b> <span>${UI.esc(t.station)}</span> <em>${note(t)}</em></li>`).join("")
      + (arr.length > 8 ? `<li class="muted">+ ${arr.length - 8} more</li>` : "");
    const groups = [
      ["both", "Both: terrain and weather", "#ff3b5c", "Steep, susceptible terrain and heavy-snow days at the nearest station. Highest concern.", t => `both in ${short(t.both_windows)}`],
      ["terrain only", "Terrain only", "#f5a524", "Susceptible terrain with no heavy-snow slot at its station.", t => `${fmt(t.share_high_or_very_high * 100)} % high terrain`],
      ["weather only", "Weather only", "#38bdf8", "Heavy-snow slots at the station, but less high terrain on the tile.", t => `${fmt(t.share_high_or_very_high * 100)} % high terrain`],
    ];
    const card = document.createElement("div");
    card.className = "card hkf-reg";
    card.innerHTML = `<div class="hkf-reg-h"><div><div class="eyebrow">Threat register · screening</div><h3>Areas under threat: terrain, weather, or both</h3></div>
        <p class="muted">Terrain = tile has ≥ ${fmt(rule.terrain_high_share * 100)} % High or Very-high ground. Weather = nearest station forecasts ≥ ${fmt(rule.weather_high_days_per_window, 1)} HIGH-danger days in a 15-day slot. Screening cut-offs chosen for this portal, not validated.</p></div>
      <div class="thr-grid">${groups.map(([k, title, c, desc, note]) => { const rows = of(k).sort((a, b) => b.share_high_or_very_high - a.share_high_or_very_high);
        return `<section class="thr" style="--c:${c}"><header><i class="thr-dot" style="background:${c}"></i><b>${title}</b><strong>${rows.length}</strong></header><p>${desc}</p><ul class="thr-list">${rowsOf(rows, note)}</ul></section>`; }).join("")}
        <section class="thr" style="--c:#6b7a90"><header><i class="thr-dot" style="background:#6b7a90"></i><b>Neither</b><strong>${of("neither").length}</strong></header><p>No threshold reached in any slot. This is not an all-clear: the screening is coarse.</p></section></div>
      <p class="muted hkf-reg-f">Tiles outside a station zone (${s.meta.hk_tiles_blank} of ${s.meta.hk_tiles_blank + s.meta.hk_tiles_with_zone}) have no snow data and are not classed. Potential release terrain requires field verification; this is not a forecast for specific slopes or a warning.</p>`;
    regEl = card;
    el.querySelector(".hk-stage").insertAdjacentElement("afterend", card);
  }

  // ------------------------------------------------------------ slot change
  function applyMode() {
    const m = HK.state.map; if (!on || !m) return;
    const v = (id, show) => { if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", show ? "visible" : "none"); };
    const g = mode === "general", d = mode === "dem", x = mode === "wx";
    v("fd-pt", g || d); v("fd-star", g); v("fw-pt", x); v("fz-fill", x); v("fz-line", x); v("fs-pt", x); v("fs-lbl", x);
    v("fpop-pt", pop); v("fpop-lbl", pop);
    m.setFilter("fd-pt", g ? ["==", ["get", "ov"], 0] : null);
    rail.querySelectorAll("[data-m]").forEach(b => b.classList.toggle("on", b.dataset.m === mode));
    rail.querySelector("[data-pop]").classList.toggle("on", pop);
    texts(); HK.renderList();
  }

  // Right-hand list: follows the icon that is on. Every row is clickable and flies the map to its location.
  const SIDE = {
    general: "General risk: main hotspots this slot",
    dem: "DEM hotspots (terrain only)",
    wx: "Snow & weather tiles this slot",
  };
  function listRows() {
    if (!cur) return [];
    if (mode === "general") return cur.dem.filter(f => f.properties.ov).sort((a, b) => b.properties.r - a.properties.r);
    if (mode === "dem") return cur.dem.slice().sort((a, b) => b.properties.a - a.properties.a);
    return cur.wx.slice().sort((a, b) => b.properties.sh - a.properties.sh);
  }
  function order() { return on && mode !== "wx" ? listRows().slice(0, HK.state.listN).map(f => ({ properties: { rank: f.properties.id } })) : null; }
  function sideList() {
    if (!on || !cur) return null;
    const all = listRows(), rows = all.slice(0, HK.state.listN), wl = `${SF.wlabel(win)}`;
    const place = f => HK.nearText(...f.geometry.coordinates);
    const html = rows.length ? rows.map(f => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates, ll = `<span class="mono">${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E</span>`;
      if (mode === "wx") return `<button type="button" class="hk-row" data-fly="${lon},${lat}"><span class="hk-rk">≈</span>
        <span class="hk-rmain"><b>${UI.esc(p.tile)}</b> <span class="muted">snow / weather tile</span><br>
          <small>${fmt(p.sh, 2)} HIGH-danger days at ${UI.esc(p.st)} · ${ll}<br>near ${place(f)}</small></span></button>`;
      return `<button type="button" class="hk-row ${p.id === HK.state.sel ? "sel" : ""}" data-rank="${p.id}">
        <span class="hk-rk ${mode === "general" ? "top" : ""}">${mode === "general" ? "★" : p.id}</span>
        <span class="hk-rmain"><b>${fmt(p.a, 1)} ha</b> <span class="mono muted">${UI.esc(p.tile)}</span>${mode === "general" ? ` <span class="muted">· risk ${fmt(p.r, 2)}</span>` : ""}<br>
          <small>${ll}<br>near ${place(f)} · ${fmt(p.elev)} m · ${fmt(p.slope, 1)}°${mode === "general" ? ` · ${fmt(p.sh, 2)} snow days at ${UI.esc(p.st)}` : ""}</small></span></button>`;
    }).join("") : UI.empty(mode === "general" ? "No main hotspot in this slot" : "Nothing to list", "<p>" + (mode === "general" ? "No DEM hotspot shares a heavy-snow slot here" + ((w) => w.length ? `; main hotspots appear in ${w.map(x => "W" + p2(x.w)).join(", ")}. Use the slot bar to move there.` : ".")(last.filter(x => x.stars)) + " This is not an all-clear." : "Lower the minimum area or clear the filters.") + "</p>");
    const n = mode === "wx" ? "tiles" : "areas";
    return { title: SIDE[mode], html, count: `<b>${fmt(all.length)}</b> ${n} in ${wl}${all.length > rows.length ? ` · showing the first ${rows.length}` : ""} · click a row to go there` };
  }

  function texts() {
    if (!cur || !cap) return;
    const stars = cur.dem.filter(f => f.properties.ov).length, rest = cur.dem.length - stars, wx = cur.wx.length;
    const parts = mode === "general" ? [["#f59e0b", "★", `${stars} main hotspot${stars === 1 ? "" : "s"}`], [C.red, "●", `${rest} DEM only`]]
      : mode === "dem" ? [[C.red, "●", `${cur.dem.length} DEM hotspots`]] : [[C.navy[1], "●", `${wx} snow / weather tiles`]];
    if (pop) parts.push([C.green, "●", `${data.settle.length} populated`]);
    const idx = SF.st.mod.indexOf(win);
    cap.innerHTML = `<small>Winter ${SF.st.meta.season} · ${idx < 0 ? `W${p2(win)} · not modelled (snow data end 31 Mar)` : `slot ${idx + 1} of ${SF.st.mod.length} · 15 days each`}</small><b>${SF.wlabel(win)}</b>
      <div class="hkf-prog">${SF.st.mod.map((i, k) => `<i class="${i === win ? "on" : k < idx ? "past" : ""}"></i>`).join("")}</div>
      <div class="hkf-cnt">${parts.map(([c, g, t]) => `<span><em style="color:${c}">${g}</em> ${t}</span>`).join("")}</div>`;
  }

  function setWin(w) {
    win = w; const m = HK.state.map; if (!on || !m) return;
    cur = frame(w);
    m.getSource("fdem").setData(fc(cur.dem)); m.getSource("fwx").setData(fc(cur.wx));
    const h = "h" + p2(w);
    m.setPaintProperty("fz-fill", "fill-color", withKey(hexStops(data.hmax), h));
    m.setPaintProperty("fs-pt", "circle-color", withKey(hexStops(data.hmax), h));
    m.setPaintProperty("fs-pt", "circle-radius", ["interpolate", ["linear"], ["coalesce", ["get", h], 0], 0, 5, data.hmax, 14]);
    texts(); HK.renderList();
    if (playing()) m.easeTo({ bearing: m.getBearing() + 9, duration: 4600 });
  }

  function refresh() { if (on && cur) { setWin(win); } }
  // Called by the top slot bar: follow its window when it is one of the outlook season's windows.
  function fromTop() { const w = topWin(); if (on && w && w !== win) setWin(w); }

  function off(silent) {
    stopAll();
    const hk = HK.state, m = hk.map;
    if (m && !silent) {
      try {
        ["dragstart", "wheel", "touchstart"].forEach(ev => m.off(ev, interact));
        LYR.forEach(i => { if (m.getLayer(i)) m.removeLayer(i); });
        SRC.forEach(s => { if (m.getSource(s)) m.removeSource(s); });
        if (popup) popup.remove();
      } catch { /* map already detached */ }
    }
    [rail, cap, regEl].forEach(e => { if (e) e.remove(); });
    rail = cap = regEl = null;
    if (on && saved && !silent) {
      Object.assign(hk, saved);
      if (host) {
        host.querySelector("#hk-l-ov").checked = hk.overlay; host.querySelector("#hk-l-pts").checked = hk.showPts;
        host.querySelector("#hk-l-tiles").checked = hk.showTiles; host.querySelector("#hk-l-set").checked = hk.showSet;
        host.querySelector("#hk-3d").classList.toggle("on", hk.terrain);
        const stg = host.querySelector(".hk-stage"); if (stg) stg.classList.remove("hk-fc-on");
        const b = host.querySelector("#hk-snow"); if (b) b.classList.remove("on");
      }
      HK.apply();
      if (m) m.easeTo({ pitch: hk.terrain ? 45 : 0, bearing: 0, duration: 1200 });
    }
    on = false; saved = null; host = null; cur = null; last = null; mode = "general"; pop = false;
    if (!silent) HK.renderList();
  }
  return { toggle, off, refresh, fromTop, sideList, order, stopAll };
})();
window.HKF = HKF;
