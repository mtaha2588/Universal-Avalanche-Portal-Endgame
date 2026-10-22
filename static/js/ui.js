/* Shared helpers and global portal state. */
"use strict";

window.S = {
  config: null,
  region: "all",
  season: null,
  windows: [],
  window: null,      // selected window id
  regions: [],
  catalog: [],
  predictionWindows: [],
  model: null,
  listeners: [],
};

const UI = {
  esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },
  dash(v) { return v === null || v === undefined || v === "" ? '<span class="muted">—</span>' : UI.esc(v); },
  qs(obj) {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") p.set(k, v); });
    const s = p.toString();
    return s ? "?" + s : "";
  },
  async api(path, params) {
    const res = await fetch("/api/" + path + (params ? UI.qs(params) : ""), { headers: { Accept: "application/json" } });
    let body;
    try { body = await res.json(); } catch { throw new Error(`Unexpected response (${res.status})`); }
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  },
  loading(msg = "Loading…") { return `<div class="state-loading">${UI.esc(msg)}</div>`; },
  error(e) { return `<div class="state-error"><b>Could not load data.</b> ${UI.esc(e.message || e)}</div>`; },
  empty(title, body) { return `<div class="empty"><b>${UI.esc(title)}</b>${body || ""}</div>`; },
  regionName(id) {
    const r = S.regions.find(r => r.properties.id === id);
    return r ? r.properties.name : "Northern Pakistan (combined)";
  },
  currentWindow() { return S.windows.find(w => w.id === S.window) || null; },
  statusTag(status) {
    const map = {
      loaded: ["ok", "Loaded"], seed: ["warn", "Seed — verify"], reference: ["info", "Reference"],
      indicative: ["warn", "Indicative"], missing: ["bad", "Not loaded"], error: ["bad", "Error"],
    };
    const [cls, label] = map[status] || ["", status];
    return `<span class="tag ${cls}">${UI.esc(label)}</span>`;
  },
  verifTag(v) {
    return v === "Verified" ? '<span class="tag ok">Verified</span>' : `<span class="tag warn">${UI.esc(v || "Unverified")}</span>`;
  },
  fmtNum(n) { return n === null || n === undefined ? "—" : Number(n).toLocaleString("en-GB"); },
  onChange(fn) { S.listeners.push(fn); },
  emit(what) { S.listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } }); },
  exportUrl(dataset, fmt, extra = {}) {
    return `/api/export/${dataset}.${fmt}` + UI.qs({ region: S.region, window: S.window, ...extra });
  },
  dl(items) {
    return `<dl class="kv">${items.map(([k, v]) => `<dt>${UI.esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
  },
};
window.UI = UI;

/* Stroke icons used by the side navigation and slot bar. */
const _P = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
UI.ICON = {
  overview: _P('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  map: _P('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  outlook: _P('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M7 13h3M7 17h3M14 13h3"/>'),
  mountain: _P('<path d="m3 20 6-11 4 6 3-4 5 9H3z"/>'),
  hotspot: _P('<path d="m3 20 6-11 4 6 3-4 5 9H3z"/><circle cx="17" cy="6" r="3"/><path d="M17 1.5v1.2M17 9.3v1.2M12.5 6h1.2M20.3 6h1.2"/>'),
  settle: _P('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10M10 20v-5h4v5"/>'),
  road: _P('<path d="M7 21 10 3M17 21 14 3M12 6v2M12 11v2M12 16v2"/>'),
  history: _P('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  shield: _P('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="M12 9v6M9 12h6"/>'),
  data: _P('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  report: _P('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6M12 12v6M9 15l3 3 3-3"/>'),
  info: _P('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  snow: _P('<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
};

/* Season phases: windows are grouped by the month they start in (descriptive labels only). */
UI.PHASES = [
  { m: 12, name: "Dec", label: "Phase 1 · Early winter", c: "#22d3ee" },
  { m: 1, name: "Jan", label: "Phase 2 · Peak winter", c: "#60a5fa" },
  { m: 2, name: "Feb", label: "Phase 3 · Late winter", c: "#a78bfa" },
  { m: 3, name: "Mar", label: "Phase 4 · Spring transition", c: "#f59e0b" },
  { m: 4, name: "Apr", label: "Phase 5 · Melt onset", c: "#34d399" },
];
UI.fmtDay = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
