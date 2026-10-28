/* Page renderers. Every number shown is computed from API data; missing data renders an explicit state. */
"use strict";

const Views = (() => {
  const h = (eyebrow, title, desc, actions = "") =>
    `<div class="page-h"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ""}</div><div class="toolbar" style="margin:0">${actions}</div></div>`;

  const exportBtns = (ds, extra) =>
    `<a class="btn" href="${UI.exportUrl(ds, "csv", extra)}">⇩ CSV</a><a class="btn" href="${UI.exportUrl(ds, "geojson", extra)}">⇩ GeoJSON</a>`;

  // Mini SVG locator: projects a region bbox and real point data into the combined extent.
  function locator(bbox, points) {
    const [W, S_, E, N] = [70.8, 33.8, 77.8, 37.1];
    const x = lon => ((lon - W) / (E - W)) * 300, y = lat => ((N - lat) / (N - S_)) * 120;
    const r = bbox ? `<rect x="${x(bbox[0])}" y="${y(bbox[3])}" width="${x(bbox[2]) - x(bbox[0])}" height="${y(bbox[1]) - y(bbox[3])}" fill="rgba(34,199,216,.12)" stroke="#22c7d8" stroke-dasharray="4 3"/>` : "";
    const pts = points.map(p => `<circle cx="${x(p.c[0])}" cy="${y(p.c[1])}" r="${p.k === "i" ? 3.2 : 1.8}" fill="${p.k === "i" ? "none" : "#c9d6e6"}" stroke="${p.k === "i" ? "#f0b44a" : "none"}" stroke-width="1.4"/>`).join("");
    return `<svg viewBox="0 0 300 120" preserveAspectRatio="none">${r}${pts}</svg>`;
  }

  // ------------------------------------------------------------------ overview
  async function overview(el) {
    el.innerHTML = h("National Overview", `Situation summary — ${UI.esc(UI.regionName(S.region))}`,
      "Consolidated status of data, model output and recorded incidents for the selected region and reporting window.") + UI.loading();
    const [sum, inc] = await Promise.all([UI.api("summary", { region: S.region, window: S.window }), UI.api("incidents", { region: S.region })]);
    const w = UI.currentWindow();
    const fatal = inc.features.reduce((a, f) => a + (f.properties.fatalities_reported || 0), 0);
    const modelOk = sum.model_status !== "not_connected";
    const ready = S.catalog.map(d => {
      const cls = { loaded: "ok", seed: "warn", reference: "ok", indicative: "warn" }[d.status] || "bad";
      return `<li><span class="dot ${cls}"></span>${UI.esc(d.title)} ${UI.statusTag(d.status)}</li>`;
    }).join("") + `<li><span class="dot ${modelOk ? "ok" : "bad"}"></span>Avalanche prediction model <span class="tag ${modelOk ? "ok" : "bad"}">${modelOk ? UI.esc(sum.model_status) : "Not connected"}</span></li>`;

    el.innerHTML = h("National Overview", `Situation summary — ${UI.esc(UI.regionName(S.region))}`,
      "Consolidated status of data, model output and recorded incidents for the selected region and reporting window.",
      `<a class="btn primary" href="#map">Open risk map →</a><a class="btn" href="/report${UI.qs({ region: S.region, window: S.window })}">Printable brief</a>`) + `
      <div class="grid g6" style="margin-bottom:14px">
        <div class="card kpi"><div class="k-label">Reporting window</div><div class="k-val" style="font-size:18px">${w ? UI.esc(w.label) : "—"}</div><div class="k-note mono">${w ? w.id : ""} · ${w ? w.days : 0} days</div></div>
        <div class="card kpi ${sum.prediction_available ? "" : "warn"}"><div class="k-label">Model output</div><div class="k-val" style="font-size:18px">${sum.prediction_available ? "Available" : "None"}</div><div class="k-note">${sum.prediction_available ? "for selected window" : "No prediction is shown for this window"}</div></div>
        <div class="card kpi warn"><div class="k-label">Recorded incidents</div><div class="k-val">${sum.incidents_total}</div><div class="k-note">${sum.incidents_verified} verified · seed catalogue</div></div>
        <div class="card kpi warn"><div class="k-label">Reported fatalities</div><div class="k-val">${UI.fmtNum(fatal)}</div><div class="k-note">Sum of unverified seed records</div></div>
        <div class="card kpi"><div class="k-label">Reference settlements</div><div class="k-val">${sum.settlements_total}</div><div class="k-note">Town centres in region</div></div>
        <div class="card kpi ${sum.roads_total ? "" : "warn"}"><div class="k-label">Road segments analysed</div><div class="k-val">${sum.roads_total}</div><div class="k-note">${sum.roads_total ? "OSM centerlines" : "Road dataset not loaded"}</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>Data &amp; model readiness</h3><ul class="ready">${ready}</ul></div>
        <div class="card"><h3>Recorded incidents in region <span class="tag warn">Seed — verify</span></h3>
          ${inc.features.length ? `<div class="bars">${inc.features.slice().sort((a, b) => (b.properties.event_date || "").localeCompare(a.properties.event_date || "")).map(f => {
            const p = f.properties, max = Math.max(...inc.features.map(x => x.properties.fatalities_reported || 0), 1);
            return `<div class="bar"><span>${UI.esc((p.event_date || "").slice(0, 7))} · ${UI.esc(p.district)}</span><span class="track"><span class="fill" style="width:${(p.fatalities_reported || 0) / max * 100}%;background:var(--amber)"></span></span><span class="v">${UI.dash(p.fatalities_reported)}</span></div>`;
          }).join("")}</div><p class="muted" style="font-size:11.5px;margin:12px 0 0">Bars: reported fatalities per event (unverified). Historical records are incomplete — absence of a recorded incident does not prove absence of hazard.</p>`
          : UI.empty("No recorded incidents in this region", "<p>The seed catalogue is incomplete; this is not evidence of low hazard.</p>")}
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- outlook
  async function outlook(el) {
    const w = UI.currentWindow();
    el.innerHTML = h("15-Day Risk Outlook", `Season ${UI.esc(S.windows[0] ? S.windows[0].season : "")} — reporting windows`,
      "The season (15 Dec – 15 Apr) is divided into consecutive 15-day <b>reporting windows</b> using half-open intervals [start, end). A reporting window is an organisational period, <b>not</b> a claim that the model can forecast 15 days ahead.") + `
      <div class="timeline" id="tl">${S.windows.map(x => {
        const isToday = S.config.today >= x.start && S.config.today < x.end_exclusive;
        return `<div class="win ${x.id === S.window ? "sel" : ""} ${isToday ? "today" : ""}" data-id="${x.id}">
          <div class="w-id">${x.id}</div><div class="w-d">${UI.esc(x.label)}</div>
          <div class="w-s">${x.days} days · ${x.prediction_available ? '<span style="color:var(--accent)">model output</span>' : "no model output"}</div></div>`;
      }).join("")}</div>
      <div id="win-detail" style="margin-top:16px">${UI.loading()}</div>`;
    el.querySelectorAll(".win").forEach(d => d.addEventListener("click", () => App.setWindow(d.dataset.id)));
    if (!w) { el.querySelector("#win-detail").innerHTML = UI.empty("No window selected"); return; }

    const pred = await UI.api("predictions", { window: w.id });
    const m = S.model || {};
    const card = `<div class="card"><h3>Selected window <span class="mono" style="color:var(--accent)">${w.id}</span></h3>${UI.dl([
      ["Interval", `<span class="mono">[${w.start}, ${w.end_exclusive})</span>`], ["Days covered", `${UI.esc(w.label)} (${w.days} days)`],
      ["Model", m.model_name ? UI.esc(m.model_name) + " " + UI.esc(m.model_version || "") : '<span class="tag bad">Not connected</span>'],
      ["Output type", UI.dash(m.output_type)], ["Max validated lead time", m.max_validated_lead_time_days != null ? m.max_validated_lead_time_days + " days" : '<span class="muted">Not established</span>'],
    ])}</div>`;
    let body;
    if (!pred.available) {
      body = `<div class="notice warn"><strong>No model output for this window.</strong> The portal does not interpolate, extrapolate or fill gaps.
        To display predictions, write <code>data/predictions/${w.id}.geojson</code> (format: <code>data/predictions/README.md</code>) and complete <code>model/model_card.json</code>.</div>`;
    } else {
      const counts = {};
      pred.features.forEach(f => { const k = f.properties.risk_class || "Unclassified"; counts[k] = (counts[k] || 0) + 1; });
      const total = pred.features.length, p0 = (pred.features[0] || {}).properties || {};
      const isProb = p0.score_type === "calibrated_probability";
      body = `<div class="grid g2"><div class="card"><h3>Class distribution (${total} cells)</h3><div class="bars">${Object.entries(counts).map(([k, v]) =>
        `<div class="bar"><span>${UI.esc(k)}</span><span class="track"><span class="fill" style="width:${v / total * 100}%;background:${RISK_COLORS[k] || "#7f93ae"}"></span></span><span class="v">${v}</span></div>`).join("")}</div></div>
        <div class="card"><h3>Run metadata</h3>${UI.dl([["Score type", UI.esc(p0.score_type || "undeclared") + (isProb ? "" : ' <span class="muted">(not a probability)</span>')],
          ["Run time", UI.dash(p0.run_time)], ["Input range", `${UI.dash(p0.input_start)} → ${UI.dash(p0.input_end)}`], ["Lead time", p0.lead_time_days != null ? p0.lead_time_days + " days" : "—"],
          ["Model version", UI.dash(p0.model_version)], ["Uncertainty", UI.dash(p0.uncertainty)]])}</div></div>
        <div class="table-wrap" style="margin-top:14px"><table class="data"><thead><tr><th>#</th><th>Risk class</th><th>${isProb ? "Probability" : "Score"}</th><th>Uncertainty</th><th>Lead (d)</th></tr></thead><tbody>
        ${pred.features.slice(0, 500).map((f, i) => `<tr><td class="num">${i + 1}</td><td>${UI.esc(f.properties.risk_class)}</td><td class="num">${UI.dash(f.properties.score)}</td><td>${UI.dash(f.properties.uncertainty)}</td><td class="num">${UI.dash(f.properties.lead_time_days)}</td></tr>`).join("")}
        </tbody></table></div>`;
    }
    el.querySelector("#win-detail").innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,360px) 1fr;align-items:start">${card}<div>${body}<a class="btn" href="#map">View window on map →</a></div></div>`;
  }

  // -------------------------------------------------------------- mountains
  async function mountains(el) {
    el.innerHTML = h("Mountain System Explorer", "Regional workspaces",
      "Selecting a workspace filters the map, incidents, settlements, roads and outlook across the portal.") + UI.loading();
    const [inc, set] = await Promise.all([UI.api("incidents"), UI.api("settlements")]);
    const ptsIn = bbox => [...set.features.map(f => ({ c: f.geometry.coordinates, k: "s" })), ...inc.features.map(f => ({ c: f.geometry.coordinates, k: "i" }))]
      .filter(p => !bbox || (p.c[0] >= bbox[0] && p.c[0] <= bbox[2] && p.c[1] >= bbox[1] && p.c[1] <= bbox[3]));
    const order = ["all", "hindu_kush", "karakoram", "western_himalaya"];
    const cards = order.map(id => S.regions.find(r => r.properties.id === id)).filter(Boolean).map(r => {
      const p = r.properties, inside = ptsIn(p.id === "all" ? null : p.bbox);
      return `<div class="card region-card ${S.region === p.id ? "sel" : ""}" data-id="${p.id}">
        <div class="mini">${locator(p.id === "all" ? null : p.bbox, ptsIn(null))}</div>
        <h3>${UI.esc(p.name)} ${S.region === p.id ? '<span class="tag info">Active</span>' : ""}</h3>
        <div class="muted" style="font-size:12px">${UI.esc(p.boundary_note)}</div>
        <div class="stat-row"><span><b>${inside.filter(x => x.k === "i").length}</b>incidents</span><span><b>${inside.filter(x => x.k === "s").length}</b>settlements</span>
        <span><b class="mono" style="font-size:12px">${p.bbox.join(", ")}</b>bbox W,S,E,N</span></div>
        ${p.id === "hindu_kush" ? `<a class="btn hk-open" href="#hindukush">Terrain screening &amp; hotspots →</a>` : p.id === "karakoram" ? `<a class="btn hk-open" href="#karakoram">Hotspots →</a>` : ""}</div>`;
    }).join("");
    const meta = S.catalog.find(d => d.id === "regions") || {};
    el.innerHTML = h("Mountain System Explorer", "Regional workspaces",
      "Selecting a workspace filters the map, incidents, settlements, roads and outlook across the portal.") +
      `<div class="notice warn"><strong>Boundary status: indicative.</strong> ${UI.esc(meta.limitations || "")} <span class="muted">Resolution: ${UI.esc(meta.resolution || "—")}.</span></div>
      <div class="grid g4">${cards}</div>
      <p class="muted" style="font-size:11.5px;margin-top:10px">Locator: ○ amber = incident (proxy location) · ● = reference settlement. Plotted from loaded data only.</p>`;
    el.querySelectorAll(".region-card").forEach(c => c.addEventListener("click", e => { if (!e.target.closest(".hk-open")) App.setRegion(c.dataset.id); }));
  }

  // ------------------------------------------------------------ settlements
  async function settlements(el, st = {}) {
    const exposure = st.exposure || "all";
    el.innerHTML = h("Settlement Exposure", `Settlements — ${UI.esc(UI.regionName(S.region))}`,
      "Exposure distinguishes settlements <b>inside</b> a mapped hazard/runout area from those merely <b>near</b> one. No exposure is inferred without a hazard layer.",
      exportBtns("settlements", { exposure })) + UI.loading();
    const res = await UI.api("settlements", { region: S.region, window: S.window, exposure });
    const rows = res.features, hazardOk = rows.some(r => r.properties.hazard_layer_available);
    el.innerHTML = h("Settlement Exposure", `Settlements — ${UI.esc(UI.regionName(S.region))}`,
      "Exposure distinguishes settlements <b>inside</b> a mapped hazard/runout area from those merely <b>near</b> one. No exposure is inferred without a hazard layer.",
      exportBtns("settlements", { exposure })) +
      (hazardOk ? "" : `<div class="notice warn"><strong>Exposure not assessed.</strong> No mapped hazard / runout layer (<code>data/hazard_zones.geojson</code>) is loaded, so every settlement is reported as “Not assessed”. Proximity to recorded incidents is shown instead.</div>`) +
      `<div class="toolbar"><label>Exposure category<select id="f-exp">
        ${["all", "Intersects", "Within", "Outside", "Not assessed"].map(v => `<option ${v === exposure ? "selected" : ""} value="${v}">${v === "all" ? "All" : v}</option>`).join("")}</select></label>
        <span class="spacer"></span><span class="muted">${rows.length} settlements · source: ${UI.esc((res.metadata || {}).source || "")}</span></div>` +
      (rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Settlement</th><th>Admin area</th><th>District</th><th>Lon</th><th>Lat</th><th>Position quality</th><th>Population</th><th>Exposure</th><th>Hazard category</th><th>Dist. km</th><th>Incidents ≤10 km</th><th>Model class</th></tr></thead><tbody>
        ${rows.map(f => { const p = f.properties; return `<tr data-lon="${p.lon}" data-lat="${p.lat}"><td><b>${UI.esc(p.name)}</b></td><td>${UI.esc(p.admin_area)}</td><td>${UI.esc(p.district)}</td>
          <td class="num">${(+p.lon).toFixed(4)}</td><td class="num">${(+p.lat).toFixed(4)}</td><td>${UI.esc(p.coord_quality)}</td><td class="num">${p.population ? UI.fmtNum(p.population) : '<span class="muted">not loaded</span>'}</td>
          <td><span class="tag ${p.exposure_category.startsWith("Intersects") ? "bad" : p.exposure_category.startsWith("Within") ? "warn" : ""}">${UI.esc(p.exposure_category)}</span></td>
          <td>${UI.dash(p.intersecting_hazard_category)}</td><td class="num">${UI.dash(p.distance_to_hazard_km)}</td><td class="num">${p.incidents_within_10km}</td><td>${p.model_output ? UI.esc(p.model_output.risk_class) : '<span class="muted">—</span>'}</td></tr>`; }).join("")}
        </tbody></table></div><p class="muted" style="font-size:11.5px">Click a row to locate it on the map. Exposure method: ${UI.esc(rows[0].properties.exposure_method)}.</p>`
        : UI.empty("No settlements match these filters"));
    el.querySelector("#f-exp").addEventListener("change", e => settlements(el, { exposure: e.target.value }));
    el.querySelectorAll("tbody tr").forEach(tr => tr.addEventListener("click", () => { location.hash = "map"; setTimeout(() => MapView.focus(+tr.dataset.lon, +tr.dataset.lat), 600); }));
  }

  // ------------------------------------------------------------------- roads
  async function roads(el) {
    const head = () => h("Highway & Infrastructure Risk", `Road segment review — ${UI.esc(UI.regionName(S.region))}`,
      "Ranked review of road segments by mapped-hazard intersection and proximity to recorded incidents. Wording is limited to <b>potential exposure</b>; the portal never states that a road is closed.", exportBtns("roads"));
    el.innerHTML = head() + UI.loading();
    const res = await UI.api("roads", { region: S.region, window: S.window });
    const rows = res.features, meta = S.catalog.find(d => d.id === "roads") || {};
    if (meta.status === "missing") {
      el.innerHTML = head() + UI.empty("Road centerline dataset not loaded",
        `<p>Download real OpenStreetMap highway centerlines (motorway, trunk, primary, secondary) for the study area:</p>
         <p><code>python scripts/fetch_osm.py roads</code></p><p class="muted">Basemap roads remain visible on the map but are not analysed until this file exists. Data © OpenStreetMap contributors (ODbL).</p>`);
      return;
    }
    el.innerHTML = head() + `<div class="notice"><strong>Status wording:</strong> “Potential exposure — requires verification” is the strongest statement made. Road status must be confirmed with NHA / FWO / district administration.</div>` +
      (rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Rank</th><th>Road</th><th>Route</th><th>Class</th><th>Length km</th><th>Hazard-affected km</th><th>Incidents ≤5 km</th><th>Method</th><th>Status</th></tr></thead><tbody>
        ${rows.map(f => { const p = f.properties; return `<tr><td class="num">${p.review_rank}</td><td>${UI.dash(p.name)}</td><td>${UI.dash(p.ref)}</td><td>${UI.dash(p.highway)}</td><td class="num">${p.length_km}</td>
        <td class="num">${UI.dash(p.hazard_affected_km)}</td><td>${p.relevant_incidents.length ? p.relevant_incidents.map(UI.esc).join(", ") : '<span class="muted">none</span>'}</td><td style="font-size:11.5px">${UI.esc(p.exposure_method)}</td>
        <td><span class="tag ${p.status_wording.startsWith("Potential") ? "warn" : ""}">${UI.esc(p.status_wording)}</span></td></tr>`; }).join("")}</tbody></table></div>`
        : UI.empty("No road segments in this region"));
  }

  // --------------------------------------------------------------- incidents
  async function incidents(el, st = {}) {
    const f = { from: st.from || "", to: st.to || "", verification: st.verification || "all", q: st.q || "" };
    const head = () => h("Historical Incidents", `Incident catalogue — ${UI.esc(UI.regionName(S.region))}`,
      "Event date is kept separate from report date. Locations marked <b>proxy</b> are reference points (village, valley, district), not impact points.",
      exportBtns("incidents", f));
    el.innerHTML = head() + UI.loading();
    const res = await UI.api("incidents", { region: S.region, ...f });
    const rows = res.features;
    el.innerHTML = head() + `<div class="notice warn"><strong>Caveat:</strong> historical reports are incomplete and unevenly distributed. Absence of a recorded incident does not prove absence of avalanche hazard. Current records are <b>unverified seed records</b> pending reconciliation with NDMA / PDMA / GBDMA / SDMA archives.</div>
      <div class="toolbar">
        <label>From<input type="date" id="f-from" value="${f.from}"></label><label>To<input type="date" id="f-to" value="${f.to}"></label>
        <label>Verification<select id="f-ver">${["all", "Verified", "Unverified seed record"].map(v => `<option ${v === f.verification ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Search<input type="search" id="f-q" value="${UI.esc(f.q)}" placeholder="place, district, source…"></label>
        <button class="btn" id="f-apply">Apply</button><span class="spacer"></span><span class="muted">${rows.length} records</span></div>` +
      (rows.length ? `<div class="grid" style="grid-template-columns:1fr minmax(0,380px);align-items:start"><div class="table-wrap"><table class="data"><thead><tr><th>ID</th><th>Event date</th><th>Report date</th><th>Location</th><th>District</th><th>Location type</th><th>Fatalities (rep.)</th><th>Verification</th></tr></thead><tbody>
        ${rows.map((x, i) => { const p = x.properties; return `<tr data-i="${i}"><td class="mono">${UI.esc(p.incident_id)}</td><td class="num">${UI.esc(p.event_date)}</td><td class="num">${UI.dash(p.report_date)}</td>
        <td>${UI.esc(p.location_name)}</td><td>${UI.esc(p.district)}</td><td><span class="tag warn">${UI.esc(p.coord_type)}</span></td><td class="num">${UI.dash(p.fatalities_reported)}</td><td>${UI.verifTag(p.verification_status)}</td></tr>`; }).join("")}
        </tbody></table></div><div class="card" id="inc-detail"><div class="muted">Select a record to see full detail and provenance.</div></div></div>`
        : UI.empty("No incidents match these filters", "<p>This does not indicate absence of hazard.</p>"));
    const apply = () => incidents(el, { from: el.querySelector("#f-from").value, to: el.querySelector("#f-to").value, verification: el.querySelector("#f-ver").value, q: el.querySelector("#f-q").value });
    el.querySelector("#f-apply").addEventListener("click", apply);
    el.querySelector("#f-q").addEventListener("keydown", e => { if (e.key === "Enter") apply(); });
    el.querySelectorAll("tbody tr").forEach(tr => tr.addEventListener("click", () => {
      el.querySelectorAll("tbody tr").forEach(t => t.classList.remove("sel")); tr.classList.add("sel");
      const x = rows[+tr.dataset.i], p = x.properties;
      el.querySelector("#inc-detail").innerHTML = `<div class="eyebrow">${UI.esc(p.incident_id)}</div><h3>${UI.esc(p.location_name)}</h3>${UI.dl([
        ["Event type", UI.dash(p.event_type)], ["Event date", `${UI.esc(p.event_date)} <span class="muted">(${UI.esc(p.date_precision)} precision)</span>`], ["Report date", UI.dash(p.report_date)],
        ["Admin area", `${UI.esc(p.admin_area)} · ${UI.esc(p.district)}`], ["Coordinates", `<span class="mono">${x.geometry.coordinates.join(", ")}</span>`],
        ["Location type", `<span class="tag warn">${UI.esc(p.coord_type)}</span> ${UI.esc(p.coord_precision)}`], ["Description", UI.dash(p.description)],
        ["Fatalities", `${UI.dash(p.fatalities_reported)} <span class="muted">reported</span>`], ["Injuries", UI.dash(p.injuries_reported)], ["Impact note", UI.dash(p.impact_note)],
        ["Source", UI.dash(p.source_org)], ["Source URL", p.source_url ? `<a href="${UI.esc(p.source_url)}" target="_blank" rel="noopener">${UI.esc(p.source_url)}</a>` : '<span class="muted">to be added</span>'],
        ["Verification", UI.verifTag(p.verification_status)], ["Audit notes", UI.dash(p.notes)]])}
        <div style="margin-top:12px"><button class="btn" id="inc-map">Show on map</button></div>`;
      el.querySelector("#inc-map").onclick = () => { location.hash = "map"; setTimeout(() => MapView.focus(...x.geometry.coordinates), 600); };
    }));
  }

  // ------------------------------------------------------------ preparedness
  async function preparedness(el) {
    el.innerHTML = UI.loading();
    const d = await UI.api("preparedness");
    el.innerHTML = h("Precautions & Preparedness", "General preparedness guidance", "") +
      `<div class="notice warn"><strong>${UI.esc(d.review_status)}.</strong> ${UI.esc(d.general_notice)} Review date: ${UI.dash(d.review_date)}.</div>
      <div class="grid g2">${d.audiences.map(a => `<div class="card"><h3>${UI.esc(a.title)}</h3><ul class="prep">${a.items.map(i => `<li>${UI.esc(i)}</li>`).join("")}</ul></div>`).join("")}</div>
      <div class="card" style="margin-top:14px"><h3>Sources</h3><ul class="prep">${d.sources.map(s => `<li>${UI.esc(s.name)} — <a href="${UI.esc(s.url)}" target="_blank" rel="noopener">${UI.esc(s.url)}</a></li>`).join("")}</ul>
      <p class="muted" style="font-size:12px;margin:8px 0 0">The portal does not issue evacuation orders and does not certify any location as safe. Location-specific instructions come only from the competent authority.</p></div>`;
  }

  // -------------------------------------------------------------------- data
  async function data(el) {
    el.innerHTML = UI.loading();
    const [cat, m] = await Promise.all([UI.api("catalog"), UI.api("model")]);
    S.catalog = cat.datasets; S.model = m;
    const modelRows = [["Status", m.status === "not_connected" ? '<span class="tag bad">Not connected</span>' : `<span class="tag ok">${UI.esc(m.status)}</span>`],
      ["Model / version", `${UI.dash(m.model_name)} ${UI.dash(m.model_version)}`], ["Output type", UI.dash(m.output_type)], ["Study area", UI.dash(m.study_area)],
      ["Spatial resolution", UI.dash(m.spatial_resolution)], ["Temporal resolution", UI.dash(m.temporal_resolution)],
      ["Max validated lead time", m.max_validated_lead_time_days != null ? m.max_validated_lead_time_days + " days" : '<span class="muted">Not established</span>'],
      ["Inputs", (m.inputs || []).length ? m.inputs.map(UI.esc).join(", ") : '<span class="muted">None documented</span>'],
      ["Training labels", UI.dash(m.training_labels)], ["Class balance", UI.dash(m.class_balance)], ["Validation", UI.dash(m.validation_method)],
      ["Metrics", Object.keys(m.metrics || {}).length ? Object.entries(m.metrics).map(([k, v]) => `${UI.esc(k)}: ${UI.esc(v)}`).join("<br>") : '<span class="muted">None reported — not invented</span>'],
      ["Last trained", UI.dash(m.last_trained)], ["Known limitations", (m.known_limitations || []).map(UI.esc).join("<br>")]];
    el.innerHTML = h("Data & Model Management", "Dataset registry and model card", "Every layer on the portal is traceable to an entry below. Freshness checks apply to operational inputs.") +
      `<div class="table-wrap" style="margin-bottom:16px"><table class="data"><thead><tr><th>Dataset</th><th>Status</th><th>Features</th><th>Kind</th><th>Source</th><th>Data date</th><th>File modified</th><th>Resolution</th><th>Limitations</th></tr></thead><tbody>
      ${cat.datasets.map(d => `<tr><td><b>${UI.esc(d.title)}</b><div class="mono muted" style="font-size:11px">${UI.esc(d.file)}</div></td><td>${UI.statusTag(d.status)}${d.stale ? ' <span class="tag warn">Stale</span>' : ""}</td>
        <td class="num">${UI.dash(d.feature_count)}</td><td>${UI.dash(d.kind)}</td><td style="font-size:12px">${UI.dash(d.source)}</td><td class="num">${UI.dash(d.data_date)}</td><td class="num" style="font-size:11.5px">${UI.dash(d.file_modified)}</td>
        <td style="font-size:12px">${UI.dash(d.resolution)}</td><td style="font-size:12px">${UI.dash(d.limitations)}</td></tr>`).join("")}</tbody></table></div>
      <div class="grid g2"><div class="card"><h3>Model card</h3>${UI.dl(modelRows)}</div>
      <div class="card"><h3>Prediction outputs</h3>${cat.prediction_windows.length ? `<ul class="ready">${cat.prediction_windows.map(w => `<li><span class="dot ok"></span><span class="mono">${UI.esc(w)}</span></li>`).join("")}</ul>`
        : UI.empty("No prediction files", `<p>${UI.esc(m.integration_instructions || "")}</p>`)}</div></div>`;
  }

  // ----------------------------------------------------------------- reports
  async function reports(el) {
    const w = UI.currentWindow();
    el.innerHTML = h("Reports / Exports", "Download data and printable briefs",
      `Exports apply the current context — region <b>${UI.esc(UI.regionName(S.region))}</b>, window <b class="mono">${UI.esc(S.window || "—")}</b> — and embed source, CRS, data date, field definitions and disclaimer.`) +
      `<div class="grid g3">
        <div class="card"><h3>Historical incidents</h3><p class="muted">Seed catalogue with provenance and verification status.</p>${exportBtns("incidents")}</div>
        <div class="card"><h3>Settlement exposure</h3><p class="muted">Settlement table with exposure method and proximity metrics.</p>${exportBtns("settlements")}</div>
        <div class="card"><h3>Road segment review</h3><p class="muted">Ranked segments with evidence (requires road dataset).</p>${exportBtns("roads")}</div>
        <div class="card"><h3>Study-area extents</h3><p class="muted">Indicative rectangles — not official boundaries.</p>${exportBtns("regions")}</div>
        <div class="card" style="grid-column:span 2"><h3>Printable situation brief</h3><p class="muted">One-page brief for ${UI.esc(UI.regionName(S.region))}${w ? `, window ${UI.esc(w.label)}` : ""}: key findings, data timestamps, model status, sources and disclaimers. Use the browser's Print → Save as PDF. The brief is <b>not</b> an officially approved product.</p>
          <a class="btn primary" href="/report${UI.qs({ region: S.region, window: S.window })}">Open printable brief →</a></div>
      </div>`;
  }

  // ------------------------------------------------------------------- about
  async function about(el) {
    el.innerHTML = h("Settings / About", "About this portal", "") + `<div class="grid g2">
      <div class="card"><h3>Portal</h3>${UI.dl([["Name", UI.esc(S.config.title)], ["Version", UI.esc(S.config.version)], ["Owner", "National Disaster Management Authority — Next Generation Technologies (NGT)"],
        ["Map engine", MapView.engine ? UI.esc(MapView.engine) : (S.config.map_engine + " (loads with map)")], ["Mapbox token", S.config.mapbox_token ? '<span class="tag ok">Configured</span>' : '<span class="tag warn">Not configured — open basemaps used</span>'],
        ["Stale threshold", S.config.stale_after_hours + " h"], ["Season convention", "15 Dec – 15 Apr; 15-day half-open windows; last window may be shorter"]])}</div>
      <div class="card"><h3>How to read this portal</h3><ul class="prep">
        <li><b>Susceptibility</b> (terrain), <b>model predictions</b>, <b>observed incidents</b> and <b>officially issued alerts</b> are different things and are labelled separately.</li>
        <li>Hazard, exposure, vulnerability and confidence are kept as separate concepts. No combined priority score is computed until its formula and weights are approved.</li>
        <li>A score is labelled a probability only when calibrated and validated as such.</li>
        <li>Basemap borders and names are supplied by the basemap provider and do not represent an official position of the Government of Pakistan.</li>
        <li>Operational decisions require authorised review and knowledge of local conditions.</li></ul></div></div>
      <div class="card" style="margin-top:14px"><h3>Map tile cache <span class="tag info">This browser</span></h3><div id="cache-stats">${UI.loading("Reading cache…")}</div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Tiles you have already viewed are drawn from this computer instead of the network. Mapbox and Esri tiles are kept only as long as
        the provider allows (Mapbox 12 h, Esri 24 h, per their Cache-Control headers); open AWS terrain tiles 30 days; map libraries until their version changes.
        Portal pages and data are never cached here, so updates always show.</p></div>`;
    const box = el.querySelector("#cache-stats");
    const show = async () => {
      const s = window.MapPerf && await MapPerf.stats();
      if (!box.isConnected) return;
      if (!s) { box.innerHTML = `<p class="muted">Cache not active yet (it starts after the first page load, and needs a current Chrome / Edge / Firefox).</p>`; return; }
      const c = s.counts, n = k => Object.entries(c).filter(([key]) => key.startsWith(k)).reduce((a, [, v]) => a + v, 0);
      box.innerHTML = UI.dl([["Provider tiles (Mapbox / Esri)", n("map-tiles").toLocaleString("en-GB")], ["Open terrain tiles", n("map-open").toLocaleString("en-GB")],
        ["Map libraries", n("map-lib").toLocaleString("en-GB")], ["Storage used by portal", s.usageMB == null ? "—" : s.usageMB.toFixed(1) + " MB"]])
        + `<button class="btn" type="button" id="cache-clear" style="margin-top:8px">Clear map cache</button>`;
      box.querySelector("#cache-clear").onclick = async e => { e.target.disabled = true; await MapPerf.clear(); show(); };
    };
    show();
  }

  return { overview, outlook, mountains, settlements, roads, incidents, preparedness, data, reports, about };
})();
window.Views = Views;
