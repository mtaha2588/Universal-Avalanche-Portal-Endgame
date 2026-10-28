/* Winter climate 1970-2010 (SC): the "Winter climate" tab of the Snow page (#snowforecast).
   Data: data/climate/era5_winter.json (scripts/build_era5_winter.py) from the NGT ERA5-Land winter run:
   305 tiles of 0.25° inside the Pakistan border, Dec-Feb means / season totals for 41 winters.
   Reanalysis (a model reconstruction), not station measurements. 1974 is flagged estimated by the run: it is drawn
   hatched and never enters a trend or a correlation. Trends are least-squares slopes, not significance-tested. */
"use strict";

const SC = (() => {
  const REG = [["pakistan", "All tiles", "#e2e8f0"], ["Hindu_Kush", "Hindu Kush", "#2a9d8f"], ["Karakoram", "Karakoram", "#8ecae6"], ["Western_Himalaya", "Western Himalaya", "#e9c46a"]];
  const RAMP = {
    temp: ["#08306b", "#2166ac", "#67a9cf", "#d1e5f0", "#f7f7f7", "#fddbc7", "#ef8a62", "#b2182b", "#67001f"],
    snow: ["#16233a", "#24466e", "#2f73b0", "#5aa6e0", "#a6d4f5", "#eef8ff"],
    fall: ["#1c1533", "#382a6e", "#5e46b5", "#9479ec", "#d6caff"],
    melt: ["#10261f", "#1d5b4a", "#2f9a7a", "#6fd3b0", "#d6fff1"],
    wind: ["#1a1f2b", "#4a4a5e", "#8a7a5a", "#d6a647", "#ffe08a"],
    brbg: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f5f5f5", "#80cdc1", "#35978f", "#01665e", "#003c30"],
    rdbu: ["#67001f", "#b2182b", "#d6604d", "#f4a582", "#f7f7f7", "#92c5de", "#4393c3", "#2166ac", "#053061"],
  };
  // How each variable is coloured in the year view: ramp, scale, and whether 0 is the centre (temperatures).
  const STYLE = {
    t2m: { ramp: "temp", div: true }, tmin: { ramp: "temp", div: true },
    snowd: { ramp: "snow", log: true }, cover: { ramp: "snow" }, swe: { ramp: "snow", log: true },
    snowf: { ramp: "fall" }, precip: { ramp: "fall" }, melt: { ramp: "melt", log: true }, wind: { ramp: "wind" },
  };
  const SHORT = { t2m: "Air temp", tmin: "Min temp", snowd: "Snow depth", cover: "Snow cover", swe: "SWE", snowf: "Snowfall", precip: "Precip", melt: "Snowmelt", wind: "Wind" };
  const st = { d: null, map: null, ready: false, v: "t2m", mode: "year", yi: 40, play: null, pin: null, pop: null };
  const fmt = (n, d = 1) => n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (n, d = 2) => n == null ? "—" : (n > 0 ? "+" : n < 0 ? "−" : "±") + fmt(Math.abs(n), d);
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function mix(stops, t) {
    t = Math.max(0, Math.min(1, isFinite(t) ? t : 0)); const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    const a = hex(stops[i]), b = hex(stops[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
  }
  const grad = stops => `linear-gradient(90deg,${stops.join(",")})`;
  const V = k => st.d.meta.vars.find(v => v.key === k);
  const dec = k => V(k).decimals;
  const yrs = () => st.d.meta.years;
  const est = i => st.d.meta.estimated[i];
  const obsIdx = () => yrs().map((_, i) => i).filter(i => !est(i));

  async function load() {
    if (st.d) return st.d;
    const d = await UI.api("climate/era5_winter");
    if (!d.available) return d;
    st.d = d; st.yi = d.meta.years.length - 1;
    // Fixed colour scales per variable over all tiles and winters, so a colour means the same thing in every year.
    st.scale = {};
    d.meta.vars.forEach(({ key }) => {
      const all = d.tiles.flatMap(t => t.v[key]).filter(v => v != null).sort((a, b) => a - b);
      const q = p => all[Math.min(all.length - 1, Math.floor(p * (all.length - 1)))];
      const s = STYLE[key];
      st.scale[key] = { lo: s.log ? all[0] : q(0.01), hi: s.log ? all[all.length - 1] : q(0.99) };
      const tr = d.tiles.map(t => Math.abs(t.tr[key] || 0)).sort((a, b) => a - b);
      st.scale[key].tr = tr[Math.floor(0.97 * (tr.length - 1))] || 1;
    });
    return d;
  }

  // Value -> colour -------------------------------------------------------------------------------------------
  function tval(key, v) {
    const s = STYLE[key], { lo, hi } = st.scale[key];
    if (s.div) return v < 0 ? 0.5 - 0.5 * Math.min(1, v / lo) : 0.5 + 0.5 * Math.min(1, v / hi);
    if (s.log) return Math.log1p(Math.max(0, v - lo)) / Math.log1p(hi - lo);
    return (v - lo) / (hi - lo || 1);
  }
  const colYear = (key, v) => v == null ? "rgba(0,0,0,0)" : mix(RAMP[STYLE[key].ramp], tval(key, v));
  const trRamp = key => (STYLE[key].ramp === "temp" ? RAMP.temp : RAMP.brbg);
  const colTrend = (key, v) => v == null ? "rgba(0,0,0,0)" : mix(trRamp(key), 0.5 + 0.5 * v / st.scale[key].tr);
  const colCorr = v => v == null ? "rgba(0,0,0,0)" : mix(RAMP.rdbu, 0.5 + 0.5 * v);
  function tileColor(t) {
    if (st.mode === "trend") return colTrend(st.v, t.tr[st.v]);
    if (st.mode === "corr") return colCorr(t.r_t2m_snowd);
    return colYear(st.v, t.v[st.v][st.yi]);
  }
  function legend() {
    const u = V(st.v).unit;
    if (st.mode === "corr") return { g: grad(RAMP.rdbu), a: "−1", m: "0", b: "+1", t: "r · winter air temperature vs snow depth (year to year)" };
    if (st.mode === "trend") { const m = st.scale[st.v].tr; return { g: grad(trRamp(st.v)), a: sgn(-m, dec(st.v)), m: "0", b: sgn(m, dec(st.v)), t: `${V(st.v).label} · change per decade (${u})` }; }
    const s = STYLE[st.v], { lo, hi } = st.scale[st.v];
    const mid = s.div ? 0 : s.log ? lo + Math.expm1(Math.log1p(hi - lo) / 2) : (lo + hi) / 2;
    return { g: grad(RAMP[s.ramp]), a: fmt(lo, s.log ? 0 : dec(st.v) > 1 ? 1 : 0), m: fmt(mid, s.log || !s.div ? 0 : 0), b: fmt(hi, s.log ? 0 : dec(st.v) > 1 ? 1 : 0), t: `${V(st.v).label} · winter ${yrs()[st.yi]} (${u})${s.log ? " · log scale" : ""}` };
  }

  // National mean of the tile values (equal weight per tile) ---------------------------------------------------
  const natl = (key, i) => { const ts = st.d.tiles; return ts.reduce((a, t) => a + (t.v[key][i] || 0), 0) / ts.length; };
  const reg = (key, rg) => st.d.regional[key][rg];
  function ma5(arr) { return arr.map((_, i) => { const w = arr.slice(Math.max(0, i - 2), i + 3).filter(v => v != null); return w.reduce((a, b) => a + b, 0) / w.length; }); }
  function ols(xs, ys) {
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    return { b: sxy / sxx, a: my - (sxy / sxx) * mx, r: sxy / Math.sqrt(sxx * syy) };
  }

  // Charts ---------------------------------------------------------------------------------------------------
  function spark(vals, color, w = 220, h = 46) {
    const ok = vals.filter(v => v != null), mn = Math.min(...ok), mx = Math.max(...ok), n = vals.length;
    const X = i => 2 + (w - 4) * i / (n - 1), Y = v => h - 4 - (h - 8) * (v - mn) / ((mx - mn) || 1);
    const line = vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const m = ma5(vals), sm = m.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const e = yrs().map((_, i) => est(i) ? `<rect x="${X(i) - 3}" y="0" width="6" height="${h}" fill="url(#sc-hatch)"/>` : "").join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="sc-spark" preserveAspectRatio="none">${e}<path d="${line} L${X(n - 1)},${h} L${X(0)},${h} Z" fill="${color}" opacity=".10"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-opacity=".45" stroke-width="1"/><path d="${sm}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }

  function timeline() {
    const W = 900, H = 84, L = 6, B = 18, n = yrs().length, bw = (W - L * 2) / n;
    const vals = yrs().map((_, i) => natl(st.v, i)), mn = Math.min(...vals), mx = Math.max(...vals);
    const Y = v => 6 + (H - B - 10) * (1 - (v - mn) / ((mx - mn) || 1));
    let s = `<svg viewBox="0 0 ${W} ${H}" class="sc-tl" id="sc-tl" role="slider" aria-label="Winter" aria-valuemin="${yrs()[0]}" aria-valuemax="${yrs()[n - 1]}" aria-valuenow="${yrs()[st.yi]}" tabindex="0">`;
    vals.forEach((v, i) => {
      const x = L + bw * i, on = i === st.yi, c = st.mode === "year" ? colYear(st.v, v) : "#5b6f8f";
      s += `<g data-i="${i}" class="${on ? "on" : ""}"><rect x="${x + 1.5}" y="${Y(v)}" width="${bw - 3}" height="${H - B - Y(v)}" rx="2" fill="${est(i) ? "url(#sc-hatch)" : c}" ${on ? 'stroke="#fff" stroke-width="1.6"' : ""}/>
        <rect x="${x}" y="0" width="${bw}" height="${H}" fill="transparent"><title>Winter ${yrs()[i]} (Dec ${yrs()[i] - 1}–Feb ${yrs()[i]}?)</title></rect></g>`;
      if (yrs()[i] % 5 === 0) s += `<text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle" class="sf-ax2">${yrs()[i]}</text>`;
    });
    const x = L + bw * st.yi + bw / 2;
    s += `<line x1="${x}" x2="${x}" y1="0" y2="${H - B}" class="sc-tl-cur"/>`;
    return s + "</svg>";
  }

  function regionChart() {
    const W = 900, H = 300, L = 54, R = 14, T = 16, B = 30, n = yrs().length;
    const ser = REG.map(([k, l, c]) => ({ k, l, c, v: reg(st.v, k).values }));
    const all = ser.flatMap(s => s.v), mn = Math.min(...all), mx = Math.max(...all), pad = (mx - mn) * 0.08 || 1;
    const X = i => L + (W - L - R) * i / (n - 1), Y = v => T + (H - T - B) * (1 - (v - mn + pad) / (mx - mn + 2 * pad));
    let s = `<svg viewBox="0 0 ${W} ${H}" class="sc-rc" id="sc-rc">`;
    for (let k = 0; k <= 4; k++) { const v = mn - pad + (mx - mn + 2 * pad) * k / 4; s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="sf-grid"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="sf-ax2">${fmt(v, Math.abs(mx - mn) < 20 ? 1 : 0)}</text>`; }
    yrs().forEach((y, i) => { if (est(i)) s += `<rect x="${X(i) - 6}" y="${T}" width="12" height="${H - T - B}" fill="url(#sc-hatch)" opacity=".8"/><text x="${X(i)}" y="${T - 4}" text-anchor="middle" class="sf-ax2">estimated</text>`; if (y % 5 === 0) s += `<text x="${X(i)}" y="${H - 10}" text-anchor="middle" class="sf-ax2">${y}</text>`; });
    ser.forEach(o => {
      const p = o.v.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(""), m = ma5(o.v).map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
      s += `<path d="${p}" fill="none" stroke="${o.c}" stroke-opacity=".38" stroke-width="1.1"/><path d="${m}" fill="none" stroke="${o.c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="sc-ma"/>`;
    });
    s += `<line id="sc-rc-x" x1="${X(st.yi)}" x2="${X(st.yi)}" y1="${T}" y2="${H - B}" class="sc-cross"/>`;
    s += ser.map(o => `<circle cx="${X(st.yi)}" cy="${Y(o.v[st.yi])}" r="4" fill="${o.c}" stroke="#07101c" stroke-width="1.5"/>`).join("");
    s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" data-hit/>`;
    st.rcX = X; st.rcW = { L, R, W, n };
    return s + "</svg>";
  }

  function scatter() {
    const W = 440, H = 300, L = 50, R = 14, T = 14, B = 34;
    const t = reg("t2m", "pakistan").values, s = reg("snowd", "pakistan").values, o = obsIdx();
    const fit = ols(o.map(i => t[i]), o.map(i => s[i]));
    const xmn = Math.min(...t) - 0.3, xmx = Math.max(...t) + 0.3, ymn = Math.min(...s) - 4, ymx = Math.max(...s) + 4;
    const X = v => L + (W - L - R) * (v - xmn) / (xmx - xmn), Y = v => T + (H - T - B) * (1 - (v - ymn) / (ymx - ymn));
    let g = `<svg viewBox="0 0 ${W} ${H}" class="sc-sc">`;
    for (let k = 0; k <= 3; k++) { const v = ymn + (ymx - ymn) * k / 3, x = xmn + (xmx - xmn) * k / 3; g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="sf-grid"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" class="sf-ax2">${fmt(v, 0)}</text><text x="${X(x)}" y="${H - 16}" text-anchor="middle" class="sf-ax2">${fmt(x, 1)}</text>`; }
    g += `<text x="${(L + W - R) / 2}" y="${H - 2}" text-anchor="middle" class="sf-ax">Winter air temperature, all tiles (°C)</text><text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="sf-ax">Snow depth (cm)</text>`;
    g += `<line x1="${X(xmn)}" x2="${X(xmx)}" y1="${Y(fit.a + fit.b * xmn)}" y2="${Y(fit.a + fit.b * xmx)}" stroke="#cbd5e1" stroke-width="1.6" stroke-dasharray="5 4"/>`;
    yrs().forEach((y, i) => {
      const c = mix(["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"], i / (yrs().length - 1));
      g += `<circle cx="${X(t[i])}" cy="${Y(s[i])}" r="${i === st.yi ? 7 : 4.6}" fill="${est(i) ? "none" : c}" stroke="${i === st.yi ? "#fff" : est(i) ? "#94a3b8" : "rgba(7,16,28,.7)"}" stroke-width="${i === st.yi ? 2 : 1.2}" ${est(i) ? 'stroke-dasharray="2 2"' : ""} data-i="${i}" class="sc-dot"><title>Winter ${y}${est(i) ? " (estimated)" : ""}: ${fmt(t[i], 2)} °C · ${fmt(s[i], 0)} cm</title></circle>`;
    });
    return { svg: g + "</svg>", r: fit.r, slope: fit.b };
  }

  function matrix() {
    const cols = REG.map(r => r[0]);
    return `<div class="tbl-wrap"><table class="tbl sc-mx"><thead><tr><th>Variable</th><th class="n">Mean, all tiles</th>${REG.map(([, l, c]) => `<th class="n"><i class="sf-dot" style="background:${c}"></i>${l}</th>`).join("")}</tr></thead><tbody>
      ${st.d.meta.vars.map(v => {
        const trs = cols.map(c => reg(v.key, c).trend_per_decade), m = Math.max(...trs.map(Math.abs)) || 1, temp = STYLE[v.key].ramp === "temp";
        return `<tr data-v="${v.key}" class="${v.key === st.v ? "on" : ""}"><td><b>${UI.esc(v.label)}</b> <span class="muted">${UI.esc(v.unit)}</span></td><td class="n">${fmt(reg(v.key, "pakistan").mean_observed, v.decimals > 1 ? 1 : 0)}</td>
          ${trs.map(t => { const c = mix(temp ? RAMP.temp : RAMP.brbg, 0.5 + 0.42 * t / m); return `<td class="n"><span class="sc-chip" style="--c:${c}">${sgn(t, v.decimals)}</span></td>`; }).join("")}</tr>`;
      }).join("")}</tbody></table></div>`;
  }

  const FIG = {
    "0_study_area.png": ["Study window", "305 ERA5-Land tiles of 25 km inside the Pakistan border, shaded by mean tile elevation."],
    "A_snapshots_every_5_years.png": ["Every five winters", "Air temperature, snow depth and snowfall, Dec–Feb, 1970–2010."],
    "B_trend_per_decade.png": ["Trend per decade", "Six variables, observed winters only. The run's cover panel uses its 0–10,000 values (÷100 for %)."],
    "C_snow_temperature_link.png": ["Snow ↔ temperature", "Per-tile year-to-year correlation and the all-tiles scatter."],
    "D_regional_timeseries.png": ["Regional series", "Hindu Kush, Karakoram, Western Himalaya: yearly and 5-year mean."],
    "1_Pakistan_6maps_5yrs_per_second.mp4": ["Animation · six maps", "Five winters per second, 1970–2010."],
    "2_Pakistan_snow_vs_temperature.mp4": ["Animation · snow vs temperature", "Year by year, 1970–2010."],
  };
  function gallery() {
    return `<div class="sc-gal">${st.d.meta.figures.map(f => {
      const [t, c] = FIG[f] || [f, ""], src = `/static/img/era5_winter/${f}`, vid = f.endsWith(".mp4");
      return `<button type="button" class="sc-fig" data-src="${src}" data-t="${UI.esc(t)}" data-c="${UI.esc(c)}">
        ${vid ? `<video src="${src}#t=2" muted preload="metadata" playsinline></video><span class="sc-playic">${UI.ICON.play}</span>` : `<img src="${src}" alt="${UI.esc(t)}" loading="lazy">`}
        <span class="sc-figcap"><b>${UI.esc(t)}</b><em>${UI.esc(c)}</em></span></button>`;
    }).join("")}</div>`;
  }
  function lightbox(src, t, c) {
    const vid = src.endsWith(".mp4"), lb = document.createElement("div");
    lb.className = "sc-lb"; lb.innerHTML = `<div class="sc-lb-in">${vid ? `<video src="${src}" controls autoplay playsinline></video>` : `<img src="${src}" alt="${t}">`}
      <div class="sc-lb-cap"><b>${t}</b><span>${c}</span><a class="btn" href="${src}" download>Download</a><button type="button" class="btn" data-x>Close (Esc)</button></div></div>`;
    const close = () => { lb.remove(); document.removeEventListener("keydown", key, true); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    lb.onclick = e => { if (e.target === lb || e.target.closest("[data-x]")) close(); };
    document.addEventListener("keydown", key, true); document.body.appendChild(lb);
  }

  // Map ------------------------------------------------------------------------------------------------------
  function tileFC() {
    return { type: "FeatureCollection", features: st.d.tiles.map((t, i) => ({ type: "Feature", id: i, properties: { i },
      geometry: { type: "Polygon", coordinates: [[[t.lon - .125, t.lat - .125], [t.lon + .125, t.lat - .125], [t.lon + .125, t.lat + .125], [t.lon - .125, t.lat + .125], [t.lon - .125, t.lat - .125]]] } })) };
  }
  async function initMap(el) {
    try {
      if (!document.querySelector('link[href="/static/vendor/maplibre-gl.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/static/vendor/maplibre-gl.css"; document.head.appendChild(l); }
      if (!window.maplibregl) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "/static/vendor/maplibre-gl.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    } catch { el.innerHTML = UI.empty("Map library could not be loaded", ""); return; }
    if (!document.body.contains(el)) return;
    MapPerf.tune(maplibregl);
    const map = new maplibregl.Map(MapPerf.opts({ container: el, center: [74.3, 35.3], zoom: 5.6, attributionControl: true, style: {
      version: 8, sources: { sat: { type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics · ERA5-Land © ECMWF / Copernicus", tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"] } },
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1626" } }, { id: "sat", type: "raster", source: "sat", paint: { "raster-saturation": -0.7, "raster-brightness-max": 0.55 } }] } }));
    st.map = map; map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    // The style is inline, so the data layers can go on before the first satellite tiles arrive ("load" waits for them).
    if (!map.isStyleLoaded()) await new Promise(r => { map.once("style.load", r); map.once("load", r); });
    if (st.map !== map) return;
    map.addSource("tiles", { type: "geojson", data: tileFC() });
    map.addLayer({ id: "t-fill", type: "fill", source: "tiles", paint: { "fill-color": ["coalesce", ["feature-state", "c"], "rgba(0,0,0,0)"], "fill-opacity": 0.82 } });
    map.addLayer({ id: "t-line", type: "line", source: "tiles", paint: { "line-color": "#ffffff", "line-opacity": ["case", ["boolean", ["feature-state", "pin"], false], 1, ["boolean", ["feature-state", "hov"], false], 0.85, 0.1], "line-width": ["case", ["boolean", ["feature-state", "pin"], false], 2.6, ["boolean", ["feature-state", "hov"], false], 1.8, 0.5] } });
    st.ready = true; paint();
    map.fitBounds([[70.4, 33.7], [78.1, 37.15]], { padding: 30, duration: 1600 });
    const bnd = await UI.api("layer/boundaries").catch(() => ({ features: [] }));
    if (st.map !== map) return;
    const isL = l => ["==", ["get", "layer"], l];
    map.addSource("bnd", { type: "geojson", data: { type: "FeatureCollection", features: bnd.features } });
    map.addLayer({ id: "b-disp", type: "line", source: "bnd", filter: isL("disputed"), paint: { "line-color": "#f59e0b", "line-opacity": 0.7, "line-width": 1.2, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "b-prov", type: "line", source: "bnd", filter: isL("province"), paint: { "line-color": "#fff", "line-opacity": 0.35, "line-width": 0.9, "line-dasharray": [3, 2] } });
    map.addLayer({ id: "b-pak", type: "line", source: "bnd", filter: isL("pakistan"), paint: { "line-color": "#fff", "line-opacity": 0.9, "line-width": 1.6 } });
    map.addLayer({ id: "b-loc", type: "line", source: "bnd", filter: ["all", isL("line"), ["==", ["get", "name"], "Line of Control"]], paint: { "line-color": "#f87171", "line-width": 1.8, "line-dasharray": [3, 2] } });
    st.pop = new maplibregl.Popup({ closeButton: false, offset: 10, className: "hk-tip" });
    let hov = null;
    map.on("mousemove", "t-fill", e => {
      const i = e.features[0].id; map.getCanvas().style.cursor = "pointer";
      if (hov !== i) { if (hov != null) map.setFeatureState({ source: "tiles", id: hov }, { hov: false }); hov = i; map.setFeatureState({ source: "tiles", id: i }, { hov: true }); }
      st.pop.setLngLat(e.lngLat).setHTML(tipHTML(st.d.tiles[i])).addTo(map);
    });
    map.on("mouseleave", "t-fill", () => { map.getCanvas().style.cursor = ""; st.pop.remove(); if (hov != null) map.setFeatureState({ source: "tiles", id: hov }, { hov: false }); hov = null; });
    map.on("click", "t-fill", e => pinTile(e.features[0].id));
  }
  function tipHTML(t) {
    const v = V(st.v), y = yrs()[st.yi];
    const main = st.mode === "corr" ? `r (temp ↔ snow depth) <b>${fmt(t.r_t2m_snowd, 2)}</b>`
      : st.mode === "trend" ? `${UI.esc(v.label)}: <b>${sgn(t.tr[st.v], v.decimals)}</b> ${UI.esc(v.unit)} per decade`
      : `${UI.esc(v.label)}, winter ${y}${est(st.yi) ? " (estimated)" : ""}: <b>${fmt(t.v[st.v][st.yi], v.decimals)}</b> ${UI.esc(v.unit)}`;
    return `<div class="hk-tip-h"><b>Tile ${UI.esc(t.id)}</b> <span class="muted">${fmt(t.frac * 100, 0)} % inside Pakistan</span></div>${main}${spark(t.v[st.v], "#8ecae6", 200, 38)}<div class="muted" style="font-size:11px">Click to pin · 1970–2010</div>`;
  }
  function paint() {
    if (!st.ready) return;
    st.d.tiles.forEach((t, i) => st.map.setFeatureState({ source: "tiles", id: i }, { c: tileColor(t) }));
  }
  function pinTile(i) {
    if (st.pin != null && st.map) st.map.setFeatureState({ source: "tiles", id: st.pin }, { pin: false });
    st.pin = i; if (i != null && st.map) st.map.setFeatureState({ source: "tiles", id: i }, { pin: true });
    drawInspector();
  }
  function drawInspector() {
    const box = document.getElementById("sc-insp"); if (!box) return;
    if (st.pin == null) { box.hidden = true; return; }
    const t = st.d.tiles[st.pin], v = V(st.v), vals = t.v[st.v], o = obsIdx(), mn = Math.min(...o.map(i => vals[i])), mx = Math.max(...o.map(i => vals[i]));
    const y = o.reduce((a, i) => vals[i] > vals[a] ? i : a, o[0]), yl = o.reduce((a, i) => vals[i] < vals[a] ? i : a, o[0]);
    box.hidden = false;
    box.innerHTML = `<div class="sc-insp-h"><div><span class="eyebrow">Pinned tile</span><b>${UI.esc(t.id)}</b><span class="muted">${fmt(t.lat, 3)}° N · ${fmt(t.lon, 3)}° E · ${fmt(t.frac * 100, 0)} % in Pakistan</span></div><button type="button" class="sc-x" data-unpin aria-label="Unpin">×</button></div>
      <div class="sc-insp-k"><span>${UI.esc(v.label)} ${yrs()[st.yi]}</span><b>${fmt(vals[st.yi], v.decimals)} <small>${UI.esc(v.unit)}</small></b></div>
      ${spark(vals, "#a6d4f5", 260, 60)}
      <div class="sc-insp-g"><span>Trend / decade<b>${sgn(t.tr[st.v], v.decimals)}</b></span><span>Highest<b>${fmt(mx, v.decimals)} · ${yrs()[y]}</b></span><span>Lowest<b>${fmt(mn, v.decimals)} · ${yrs()[yl]}</b></span><span>r temp ↔ snow<b>${fmt(t.r_t2m_snowd, 2)}</b></span></div>
      ${t.v.snowd.some(x => x >= 3333) || t.v.swe.some(x => x >= 9999) ? '<p class="sc-cap-w">This tile reaches ERA5-Land\'s fixed glacier snow store: depth and SWE here are the model cap, not measured snow.</p>' : ""}`;
    box.querySelector("[data-unpin]").onclick = () => pinTile(null);
  }

  // Page state updates -------------------------------------------------------------------------------------
  function refresh(full) {
    paint();
    const L = legend(), lg = document.getElementById("sc-leg");
    if (lg) lg.innerHTML = `<div class="sc-leg-t">${UI.esc(L.t)}</div><i style="background:${L.g}"></i><div class="sc-leg-s"><span>${L.a}</span><span>${L.m}</span><span>${L.b}</span></div>`;
    const tl = document.getElementById("sc-tlw"); if (tl) { tl.innerHTML = timeline(); wireTimeline(); }
    document.querySelectorAll("#sc-vars [data-v]").forEach(b => b.classList.toggle("on", b.dataset.v === st.v));
    document.querySelectorAll("#sc-modes [data-m]").forEach(b => b.classList.toggle("on", b.dataset.m === st.mode));
    const vbar = document.getElementById("sc-vars"); if (vbar) vbar.classList.toggle("dim", st.mode === "corr");
    const yl = document.getElementById("sc-year");
    if (yl) yl.innerHTML = st.mode === "year" ? `<b>${yrs()[st.yi]}</b><span>Dec ${yrs()[st.yi] - 1} – Feb ${yrs()[st.yi]}${est(st.yi) ? ' · <em class="sc-est">estimated</em>' : ""}</span>`
      : st.mode === "trend" ? `<b>1970–2010</b><span>trend per decade · 1974 excluded</span>` : `<b>r</b><span>year-to-year · 1974 excluded</span>`;
    const nat = document.getElementById("sc-nat");
    if (nat) { const v = V(st.v); nat.innerHTML = `All tiles ${st.mode === "trend" ? "trend" : "mean"}: <b>${st.mode === "trend" ? sgn(reg(st.v, "pakistan").trend_per_decade, v.decimals) + " " + UI.esc(v.unit) + "/decade" : fmt(natl(st.v, st.yi), v.decimals) + " " + UI.esc(v.unit)}</b>`; }
    const rc = document.getElementById("sc-rcw"); if (rc && full) { rc.innerHTML = regionChart(); wireRegion(); document.getElementById("sc-rc-t").textContent = `${V(st.v).label} (${V(st.v).unit})`; }
    else if (rc) moveRegionCursor();
    const sc = document.getElementById("sc-scw"); if (sc) { sc.innerHTML = scatter().svg; wireScatter(); }
    if (full) document.querySelectorAll(".sc-mx tr[data-v]").forEach(r => r.classList.toggle("on", r.dataset.v === st.v));
    drawInspector();
    if (st.pop && st.pop.isOpen()) st.pop.remove();
  }
  function setYear(i) { if (i === st.yi && st.mode === "year") return; st.yi = Math.max(0, Math.min(yrs().length - 1, i)); if (st.mode !== "year") st.mode = "year"; refresh(false); }
  function moveRegionCursor() { const svg = document.getElementById("sc-rc"); if (!svg) return; document.getElementById("sc-rcw").innerHTML = regionChart(); wireRegion(); }
  function wireTimeline() {
    const svg = document.getElementById("sc-tl"); if (!svg) return;
    const at = e => { const r = svg.getBoundingClientRect(); return Math.floor((e.clientX - r.left) / r.width * yrs().length); };
    let drag = false;
    svg.onpointerdown = e => { drag = true; svg.setPointerCapture(e.pointerId); stop(); setYear(at(e)); };
    svg.onpointermove = e => { if (drag) setYear(at(e)); };
    svg.onpointerup = () => { drag = false; };
    svg.onkeydown = e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); stop(); setYear(st.yi + (e.key === "ArrowRight" ? 1 : -1)); requestAnimationFrame(() => document.getElementById("sc-tl")?.focus()); } };
  }
  function wireRegion() {
    const svg = document.getElementById("sc-rc"), tip = document.getElementById("sc-rc-tip"); if (!svg) return;
    const { L, R, W, n } = st.rcW, idx = e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W; return Math.max(0, Math.min(n - 1, Math.round((x - L) / (W - L - R) * (n - 1)))); };
    svg.onmousemove = e => {
      const i = idx(e), v = V(st.v), r = svg.getBoundingClientRect();
      tip.hidden = false; tip.style.left = `${Math.min(r.width - 190, Math.max(0, e.clientX - r.left + 14))}px`;
      tip.innerHTML = `<b>Winter ${yrs()[i]}</b>${est(i) ? ' <em class="sc-est">estimated</em>' : ""}${REG.map(([k, l, c]) => `<div><i style="background:${c}"></i>${l}<b>${fmt(reg(st.v, k).values[i], v.decimals)}</b></div>`).join("")}<span class="muted">Click to show on the map</span>`;
    };
    svg.onmouseleave = () => { tip.hidden = true; };
    svg.onclick = e => { stop(); setYear(idx(e)); };
  }
  function wireScatter() { document.querySelectorAll("#sc-scw .sc-dot").forEach(c => c.onclick = () => { stop(); setYear(+c.dataset.i); }); }

  const STEP_MS = 900;
  function start() {
    stop(); if (st.mode !== "year") { st.mode = "year"; refresh(false); }
    const b = document.getElementById("sc-play"); if (b) { b.innerHTML = UI.ICON.pause; b.classList.add("on"); }
    if (st.yi >= yrs().length - 1) setYear(0);
    st.play = setInterval(() => { if (st.yi >= yrs().length - 1) { stop(); return; } setYear(st.yi + 1); }, STEP_MS);
  }
  function stop() { if (st.play) clearInterval(st.play); st.play = null; const b = document.getElementById("sc-play"); if (b) { b.innerHTML = UI.ICON.play; b.classList.remove("on"); } }

  // Page -----------------------------------------------------------------------------------------------------
  async function render(el, head) {
    dispose();
    el.innerHTML = head + UI.loading("Loading 41 winters of ERA5-Land…");
    const d = await load();
    if (!d || !d.available) { el.innerHTML = head + UI.empty("No winter climate run imported", `<p>${UI.esc((d || {}).message || "Run scripts/build_era5_winter.py.")}</p>`); return; }
    const m = d.meta, o = obsIdx(), pk = k => reg(k, "pakistan");
    const t2 = pk("t2m").values, warm = o.reduce((a, i) => t2[i] > t2[a] ? i : a, o[0]), cold = o.reduce((a, i) => t2[i] < t2[a] ? i : a, o[0]);
    const sf = pk("snowf").values, wet = o.reduce((a, i) => sf[i] > sf[a] ? i : a, o[0]), dry = o.reduce((a, i) => sf[i] < sf[a] ? i : a, o[0]);
    const sc0 = scatter(), negShare = d.tiles.filter(t => t.r_t2m_snowd != null && t.r_t2m_snowd < 0).length / d.tiles.filter(t => t.r_t2m_snowd != null).length;
    const kpi = (cls, label, val, unit, note, sp) => `<div class="card kpi sc-k ${cls}"><div class="k-label">${label}</div><div class="k-val">${val}<small> ${unit}</small></div><div class="k-note">${note}</div>${sp || ""}</div>`;
    const tT = pk("t2m").trend_per_decade, sT = pk("snowf").trend_per_decade;
    el.innerHTML = head + `<svg width="0" height="0" style="position:absolute"><defs><pattern id="sc-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#1a2740"/><path d="M0 0v5" stroke="#5b6f8f" stroke-width="1.6"/></pattern></defs></svg>
      <div class="notice sc-notice"><span class="tag info">Reanalysis · 1970–2010</span><span><strong>${UI.esc(m.reanalysis_note)}</strong> ${UI.esc(m.estimated_note)} Trends are least-squares slopes, not tested for significance.
        Snow cover is shown ÷100 (supplied 0–10,000 under a % label). Glacier cells sit at ERA5-Land's fixed snow store, so Karakoram snow depth reflects that cap.</span></div>
      <div class="sc-hero">
        ${kpi("t", "Winter air temperature · trend", sgn(tT, 2), "°C / decade", `≈ ${sgn(tT * 4, 1)} °C over 40 winters (all 305 tiles). Warmest ${yrs()[warm]} (${fmt(t2[warm], 1)} °C), coldest ${yrs()[cold]} (${fmt(t2[cold], 1)} °C).`, spark(t2, "#ef8a62"))}
        ${kpi("s", "Season snowfall · trend", sgn(sT, 1), "mm w.e. / decade", `Mean ${fmt(pk("snowf").mean_observed, 0)} mm w.e. per winter. Snowiest ${yrs()[wet]} (${fmt(sf[wet], 0)}), least ${yrs()[dry]} (${fmt(sf[dry], 0)}).`, spark(sf, "#9479ec"))}
        ${kpi("c", "Snow cover · trend", sgn(pk("cover").trend_per_decade, 2), "% pts / decade", `Mean winter cover ${fmt(pk("cover").mean_observed, 1)} % of tile area, all tiles.`, spark(pk("cover").values, "#5aa6e0"))}
        ${kpi("r", "Temperature ↔ snow depth", fmt(sc0.r, 2), "r", `Warmer winters carry slightly less snow at national scale; ${fmt(negShare * 100, 0)} % of tiles show a negative link. A weak relation, not a forecast rule.`, "")}
      </div>
      <div class="sc-regs">${REG.slice(1).map(([k, l, c]) => `<div class="sc-reg" style="--c:${c}"><div class="sc-reg-h"><i></i>${l}</div>
        <div class="sc-reg-g"><span>Air temp<b>${fmt(reg("t2m", k).mean_observed, 1)} °C</b><em>${sgn(reg("t2m", k).trend_per_decade, 2)}/dec</em></span>
        <span>Snowfall<b>${fmt(reg("snowf", k).mean_observed, 0)} mm</b><em>${sgn(reg("snowf", k).trend_per_decade, 1)}/dec</em></span>
        <span>Snow depth<b>${fmt(reg("snowd", k).mean_observed, 0)} cm</b><em>${sgn(reg("snowd", k).trend_per_decade, 1)}/dec</em></span></div>${spark(reg("t2m", k).values, c, 260, 34)}</div>`).join("")}</div>
      <div class="card sc-atlas"><div class="sc-atlas-h"><h3>Winter atlas <span class="tag info">${m.tiles} tiles · 0.25° · Dec–Feb</span></h3>
        <div class="sc-seg" id="sc-modes"><button type="button" data-m="year">Year by year</button><button type="button" data-m="trend">Trend per decade</button><button type="button" data-m="corr">Temp ↔ snow link</button></div></div>
        <div class="sc-vars" id="sc-vars">${m.vars.map(v => `<button type="button" data-v="${v.key}" title="${UI.esc(v.label)} (${UI.esc(v.unit)})"><i style="background:${grad(RAMP[STYLE[v.key].ramp])}"></i>${SHORT[v.key]}</button>`).join("")}</div>
        <div class="sc-mapwrap"><div id="sc-map" class="sc-map"></div>
          <div class="sc-yearbox" id="sc-year"></div>
          <div class="sc-leg" id="sc-leg"></div>
          <aside class="sc-insp" id="sc-insp" hidden></aside></div>
        <div class="sc-tlbar"><button type="button" class="sc-playb" id="sc-play" title="Play 1970 → 2010">${UI.ICON.play}</button><div class="sc-tlw" id="sc-tlw"></div></div>
        <div class="sc-tlnote muted"><span id="sc-nat"></span><span>Bars: mean of all tiles per winter · drag or use ← → · hatched = estimated winter</span></div></div>
      <div class="sc-two">
        <div class="card"><h3>Regional winters <span class="tag" id="sc-rc-t"></span></h3><div class="sc-rcwrap"><div id="sc-rcw"></div><div class="sc-rctip" id="sc-rc-tip" hidden></div></div>
          <div class="sf-leg">${REG.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}<span class="muted">thin = each winter · thick = 5-winter mean</span></div></div>
        <div class="card"><h3>Warmer winter, less snow? <span class="tag">r ${fmt(sc0.r, 2)}</span></h3><div id="sc-scw"></div>
          <p class="muted hk-cap">One dot per winter (all tiles), coloured 1970 → 2010. Dashed: least-squares fit on observed winters (${sgn(sc0.slope, 1)} cm per °C). Click a dot to map that winter.</p></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Trend matrix <span class="tag">change per decade · observed winters</span></h3>${matrix()}
        <p class="muted hk-cap">Regional values are the run's own regional means. Click a row to map that variable. Colour shows direction within the row.</p></div>
      <div class="card" style="margin-top:14px"><h3>Figures and animations from the run <span class="tag">as supplied</span></h3>${gallery()}</div>
      <div class="card" style="margin-top:14px"><h3>Method and limits</h3><ul class="sf-lim"><li>${UI.esc(m.season)}. ${UI.esc(m.resolution)}.</li><li>${UI.esc(m.trend_note)}</li><li>${UI.esc(m.corr_note)}</li><li>${UI.esc(m.estimated_note)}</li><li>${UI.esc(m.cover_note)}</li><li>${UI.esc(m.cap_note)}</li><li>${UI.esc(m.reanalysis_note)}</li></ul>
        <div class="toolbar" style="margin-top:10px"><a class="btn" href="/api/climate/era5_winter/regional_means_winter.csv">Regional means (CSV)</a><a class="btn" href="/api/climate/era5_winter/tile_year_values_winter.csv">Tile × winter values (CSV)</a></div>
        <p class="muted hk-cap">Source: ${UI.esc(m.source)}.</p></div>`;
    el.querySelectorAll("#sc-vars [data-v]").forEach(b => b.onclick = () => { st.v = b.dataset.v; if (st.mode === "corr") st.mode = "year"; refresh(true); });
    el.querySelectorAll("#sc-modes [data-m]").forEach(b => b.onclick = () => { stop(); st.mode = b.dataset.m; refresh(false); });
    el.querySelectorAll(".sc-mx tr[data-v]").forEach(r => r.onclick = () => { st.v = r.dataset.v; refresh(true); el.querySelector(".sc-atlas").scrollIntoView({ behavior: "smooth", block: "start" }); });
    el.querySelectorAll(".sc-fig").forEach(b => b.onclick = () => lightbox(b.dataset.src, b.dataset.t, b.dataset.c));
    el.querySelector("#sc-play").onclick = () => (st.play ? stop() : start());
    refresh(true);
    initMap(el.querySelector("#sc-map")).catch(e => console.error(e));
  }
  function dispose() { stop(); if (st.map) { try { st.map.remove(); } catch { /* detached */ } } st.map = null; st.ready = false; st.pop = null; }

  return { render, dispose, load, st };
})();
window.SC = SC;
Views.snowclimate = el => SC.render(el, SF.tabs("snowclimate") + `<div class="page-h"><div><div class="eyebrow">Northern Pakistan · ERA5-Land reanalysis · December–February</div>
  <h2>Winter climate, 1970–2010</h2><p>Forty-one winters of air temperature, snow and snowfall on 305 tiles of 25 km inside Pakistan: how each winter compared, where it has warmed, and how closely snow followed temperature.</p></div>
  <div class="toolbar" style="margin:0"><a class="btn" href="#snowforecast">${SF.ICON} Outlook 2026-27</a></div></div>`);
