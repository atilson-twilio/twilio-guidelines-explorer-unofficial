// Twilio SMS & Voice Guidelines Explorer.
// Plain browser JavaScript, no build step. Data comes from data.js (window.GUIDELINES), replaced
// by data.local.js when present (same data plus the Weather Report, built locally and never
// published), and saved views from presets.js (window.GUIDELINE_PRESETS). Columns with channel
// "wr" come from Twilio's Weather Report sheet; `compare` on a column names the column in the other source
// that answers the same question, and country.conflicts lists cells where the two disagree.
(function () {
  "use strict";

  const DATA = window.GUIDELINES;
  if (!DATA) {
    document.body.innerHTML =
      '<p style="padding:40px;font:16px sans-serif">No data found. Run <code>npm run scrape</code> to generate <code>ui/data.js</code>.</p>';
    return;
  }

  // ---------------------------------------------------------------------------
  // Constants and lookups
  // ---------------------------------------------------------------------------

  const STATUS = {
    yes: { label: "Yes / supported", rank: 0 },
    limited: { label: "Limited / conditional", rank: 1 },
    notRequired: { label: "Not required", rank: 2 },
    required: { label: "Required", rank: 3 },
    info: { label: "Other / see text", rank: 4 },
    no: { label: "No / not supported", rank: 5 },
    na: { label: "N/A or blank", rank: 6 },
    none: { label: "No data published", rank: 7 },
  };

  const COLS = DATA.columns;
  const COL = new Map(COLS.map((c) => [c.id, c]));
  const COUNTRIES = DATA.countries;
  const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));
  const CHANNEL_LABEL = { sms: "SMS", voice: "Voice", porting: "Porting", wr: "Weather Report" };
  const WR = DATA.weatherReport || null;
  // Saved views, adjusted to the loaded data: the published build has no Weather Report, so its
  // columns, filters and sort drop out (see presets.js).
  const PRESETS = (window.GUIDELINE_PRESETS || [])
    .filter((p) => WR || !p.requiresWeatherReport)
    .map(({ withoutWeatherReport, requiresWeatherReport, ...p }) => {
      if (!WR) Object.assign(p, withoutWeatherReport);
      return {
        ...p,
        columns: (p.columns || []).filter((id) => COL.has(id)),
        filters: Object.fromEntries(Object.entries(p.filters || {}).filter(([id]) => COL.has(id))),
        sort: p.sort && (p.sort.id === "name" || COL.has(p.sort.id)) ? p.sort : null,
      };
    });
  // Weather Report status changes this recent get a note under the badge.
  const RECENT_DAYS = 90;
  const isRecent = (d) => d && Date.now() - new Date(d).getTime() < RECENT_DAYS * 864e5;

  // Lower-cased search text per country, built once.
  for (const c of COUNTRIES) {
    c._base = [c.name, c.iso, c.region, c.dialingCode, c.mcc].join(" ").toLowerCase();
    c._lc = {};
    for (const [id, v] of Object.entries(c.values)) c._lc[id] = (v.t || "").toLowerCase();
  }

  // Cells changed in the most recent recorded scrape run (outlined in the table), and the
  // latest recorded previous value for any cell (shown in the cell popover).
  const CHANGELOG = DATA.changelog || [];
  const LATEST_CHANGES = new Set();
  const PREVIOUS = new Map();
  CHANGELOG.slice()
    .reverse()
    .forEach((run, i, runs) => {
      for (const ch of run.changes) {
        PREVIOUS.set(`${ch.iso}|${ch.column}`, { date: run.date, before: ch.before });
        if (i === runs.length - 1) LATEST_CHANGES.add(`${ch.iso}|${ch.column}`);
      }
    });

  const REGIONS = (() => {
    const counts = new Map();
    for (const c of COUNTRIES) if (c.region) counts.set(c.region, (counts.get(c.region) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  })();

  const $ = (sel) => document.querySelector(sel);
  const el = {
    meta: $("#meta"),
    search: $("#search"),
    presets: $("#presets"),
    presetDesc: $("#preset-desc"),
    regions: $("#region-filter"),
    voiceOnly: $("#voice-only"),
    wrapText: $("#wrap-text"),
    activeFilters: $("#active-filters"),
    count: $("#count"),
    compareBar: $("#compare-bar"),
    compareLabel: $("#compare-label"),
    wrap: $("#table-wrap"),
    grid: $("#grid"),
    empty: $("#empty"),
    legend: $("#legend"),
    popover: $("#popover"),
    drawer: $("#drawer"),
    drawerTitle: $("#drawer-title"),
    drawerBody: $("#drawer-body"),
    scrim: $("#scrim"),
    toast: $("#toast"),
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** Escape text and wrap search-term matches in <mark>. */
  function hl(text, terms) {
    if (!terms.length || !text) return esc(text);
    const re = new RegExp(`(${terms.map(reEscape).join("|")})`, "gi");
    return String(text)
      .split(re)
      .map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)))
      .join("");
  }

  const ALLOWED_TAGS = new Set(["P", "BR", "B", "STRONG", "I", "EM", "UL", "OL", "LI", "A"]);
  /** Defence in depth: the scraper already sanitises, but never trust HTML in data.js blindly. */
  function sanitize(html) {
    const t = document.createElement("template");
    t.innerHTML = html;
    (function walk(node) {
      for (const child of [...node.children]) {
        walk(child);
        if (!ALLOWED_TAGS.has(child.tagName)) {
          child.replaceWith(...child.childNodes);
          continue;
        }
        const href = child.tagName === "A" ? child.getAttribute("href") : null;
        for (const a of [...child.attributes]) child.removeAttribute(a.name);
        if (href && /^https?:\/\//i.test(href)) {
          child.setAttribute("href", href);
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener noreferrer");
        }
      }
    })(t.content);
    return t.innerHTML;
  }

  /** Full value as display HTML: sanitised rich text when available, otherwise escaped plain text. */
  function richValue(v, terms = []) {
    if (!v) return '<span class="na">No data</span>';
    if (v.h && !terms.length) return `<div class="rich">${sanitize(v.h)}</div>`;
    return `<div class="plain">${hl(v.t || "—", terms)}</div>`;
  }

  /** Status badge for the first line, followed by the rest of the value (keeping links). */
  function badgeValue(v) {
    const first = v.t.split("\n")[0];
    const badge = `<span class="badge ${v.s}">${esc(first)}</span>`;
    if (v.h) {
      const t = document.createElement("template");
      t.innerHTML = sanitize(v.h);
      const lead = t.content.firstElementChild;
      if (lead && lead.textContent.trim() === first.trim()) lead.remove();
      return badge + (t.content.textContent.trim() ? `<div class="rich">${t.innerHTML}</div>` : "");
    }
    const rest = v.t.split("\n").slice(1).join("\n");
    return badge + (rest ? `<div class="plain">${esc(rest)}</div>` : "");
  }

  /** Values that should count as "the same" when comparing countries (ignores blank placeholders). */
  const compareKey = (v) => (!v || v.s === "na" ? "" : v.t.replace(/\s+/g, " ").trim().toLowerCase());

  const fullLabel = (col) =>
    [CHANNEL_LABEL[col.channel], col.groupLabel, col.sub, col.label].filter(Boolean).join(" · ");
  const groupKey = (col) => `${col.channel}.${col.group}`;
  const groupTitle = (col) => `${CHANNEL_LABEL[col.channel]} · ${col.groupLabel}`;

  function statusOf(country, col) {
    const v = country.values[col.id];
    return v ? v.s : "none";
  }

  function noDataText(country, col) {
    if (col.channel === "wr") return col.group === "check" ? "—" : "Not listed";
    if (col.channel === "porting" && !country.urls.porting) return "No porting guidelines";
    if (col.channel === "voice" && !country.urls.voice) return "No voice guidelines";
    if (col.channel === "sms" && !country.urls.sms) return "No SMS guidelines";
    return "—";
  }

  // Where to send people for more on a column, best first. For porting (the porting guideline
  // columns and the Weather Report porting group) that's the porting guideline page, then the
  // country's porting FAQ, then the regulatory page; for other Weather Report columns, the
  // regulatory page; for guideline columns, that channel's guideline page.
  function infoLinks(country, col) {
    const u = country.urls;
    const n = esc(country.name);
    const porting = [
      u.porting && { url: u.porting, text: `Twilio porting guidelines for ${n}` },
      u.portingFaq && { url: u.portingFaq, text: `${n} porting FAQ` },
    ];
    const regulatory = u.regulatory && { url: u.regulatory, text: `Twilio regulatory requirements for ${n}` };
    let links;
    if (col.channel === "porting" || (col.channel === "wr" && col.group === "porting")) links = [...porting, regulatory];
    else if (col.channel === "wr") links = [regulatory];
    else links = [u[col.channel] && { url: u[col.channel], text: `Open Twilio ${CHANNEL_LABEL[col.channel]} guidelines for ${n}` }];
    return links.filter(Boolean);
  }
  const linkHtml = (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${l.text} ↗</a>`;

  const flag = (iso) =>
    /^[A-Z]{2}$/.test(iso) ? String.fromCodePoint(...[...iso].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";

  function parseTerms(q) {
    const terms = [];
    String(q || "")
      .toLowerCase()
      .replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => {
        const t = (phrase || word || "").trim();
        if (t) terms.push(t);
      });
    return terms;
  }

  // Pasted country lists: a search containing commas, semicolons, pipes or tabs is read as a
  // list of countries (names, ISO codes or common aliases) when most of its parts name one.
  const normName = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/&/g, " and ")
      .replace(/\bst\b\.?/g, "saint")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^the /, "")
      .trim();
  const COUNTRY_ALIASES = {
    US: ["usa", "us", "united states of america", "america"],
    GB: ["uk", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
    AE: ["uae"],
    KR: ["korea", "republic of korea", "korea republic of"],
    CZ: ["czechia"],
    MK: ["north macedonia"],
    SZ: ["eswatini"],
    CI: ["cote d ivoire", "cote divoire"],
    CV: ["cabo verde"],
    MM: ["burma"],
    RU: ["russian federation"],
    VN: ["viet nam"],
    CD: ["drc", "dr congo", "congo kinshasa", "congo democratic republic of the"],
    CG: ["congo brazzaville", "congo republic"],
    NL: ["holland", "the netherlands"],
    MO: ["macau"],
    TR: ["turkiye"],
    LA: ["lao pdr", "lao people s democratic republic"],
    IR: ["iran islamic republic of"],
    SY: ["syrian arab republic"],
    TZ: ["tanzania united republic of"],
    BO: ["bolivia plurinational state of"],
    VE: ["venezuela bolivarian republic of"],
    MD: ["moldova republic of"],
    FM: ["micronesia federated states of"],
    PS: ["palestine state of", "palestinian territories"],
    TW: ["taiwan province of china"],
    HK: ["hong kong sar"],
    BN: ["brunei darussalam"],
    TL: ["east timor"],
    VG: ["bvi"],
    VI: ["usvi", "us virgin islands"],
  };
  const COUNTRY_BY_NAME = new Map();
  for (const c of COUNTRIES) COUNTRY_BY_NAME.set(normName(c.name), c);
  for (const [iso, names] of Object.entries(COUNTRY_ALIASES))
    if (BY_ISO.has(iso)) for (const n of names) COUNTRY_BY_NAME.set(normName(n), BY_ISO.get(iso));

  /** Countries named by one list item: exact name/alias, ISO code, else any name containing it. */
  function lookupCountries(item) {
    const n = normName(item);
    if (!n) return [];
    if (COUNTRY_BY_NAME.has(n)) return [COUNTRY_BY_NAME.get(n)];
    if (/^[a-z]{2}$/.test(n) && BY_ISO.has(n.toUpperCase())) return [BY_ISO.get(n.toUpperCase())];
    if (n.length < 4) return [];
    return COUNTRIES.filter((c) => normName(c.name).includes(n));
  }

  /** { isos, unmatched } when the query reads as a country list, otherwise null. */
  function parseCountryList(q) {
    if (parseCountryList.q === q) return parseCountryList.result;
    let result = null;
    if (/[,;|\t]/.test(q)) {
      const items = q.split(/[,;|\t]+/).map((s) => s.trim()).filter(Boolean);
      const isos = new Set();
      const unmatched = [];
      for (const item of items) {
        const found = lookupCountries(item);
        if (found.length) found.forEach((c) => isos.add(c.iso));
        else unmatched.push(item);
      }
      if (isos.size && unmatched.length <= items.length / 2) result = { isos, unmatched };
    }
    parseCountryList.q = q;
    parseCountryList.result = result;
    return result;
  }

  /** Free-text search terms, or none when the search is a country list. */
  const searchTerms = () => (parseCountryList(state.q) ? [] : parseTerms(state.q));

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.toast.hidden = true), 2200);
  }

  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

  // ---------------------------------------------------------------------------
  // State (mirrored to the URL hash so any view can be shared as a link)
  // ---------------------------------------------------------------------------

  const state = {
    preset: PRESETS[0]?.id || null,
    cols: [],
    q: "",
    regions: new Set(),
    voiceOnly: false,
    filters: {}, // { colId: { s?: string[], q?: string } }
    sort: null, // { id: colId | "name", dir: "asc" | "desc" }
    selected: new Set(),
    wrap: false,
  };

  const presetById = (id) => PRESETS.find((p) => p.id === id);
  const validCols = (ids) => (ids || []).filter((id) => COL.has(id));

  function applyPreset(id) {
    const p = presetById(id);
    if (!p) return;
    state.preset = p.id;
    state.cols = validCols(p.columns);
    state.filters = JSON.parse(JSON.stringify(p.filters || {}));
    state.sort = p.sort ? { ...p.sort } : null;
    state.voiceOnly = !!p.voiceOnly;
  }

  function presetModified() {
    const p = presetById(state.preset);
    if (!p) return true;
    return (
      validCols(p.columns).join(",") !== state.cols.join(",") ||
      JSON.stringify(p.filters || {}) !== JSON.stringify(state.filters) ||
      !!p.voiceOnly !== state.voiceOnly
    );
  }

  function writeHash() {
    const p = new URLSearchParams();
    if (state.preset) p.set("view", state.preset);
    const preset = presetById(state.preset);
    if (!preset || validCols(preset.columns).join(",") !== state.cols.join(",")) p.set("cols", state.cols.join(","));
    if (state.q) p.set("q", state.q);
    if (state.regions.size) p.set("region", [...state.regions].join("|"));
    if (state.voiceOnly !== !!preset?.voiceOnly) p.set("voice", state.voiceOnly ? "1" : "0");
    if (JSON.stringify(state.filters) !== JSON.stringify(preset?.filters || {})) p.set("f", JSON.stringify(state.filters));
    if (state.sort && JSON.stringify(state.sort) !== JSON.stringify(preset?.sort || null))
      p.set("sort", `${state.sort.id}:${state.sort.dir}`);
    if (!state.sort && preset?.sort) p.set("sort", "none");
    if (state.selected.size) p.set("sel", [...state.selected].join(","));
    if (state.wrap) p.set("wrap", "1");
    const hash = "#" + p.toString();
    if (hash === location.hash) return;
    try {
      history.replaceState(null, "", hash);
    } catch {
      location.replace(hash);
    }
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    applyPreset(presetById(p.get("view")) ? p.get("view") : state.preset);
    if (p.has("cols")) state.cols = validCols(p.get("cols").split(","));
    state.q = p.get("q") || "";
    state.regions = new Set((p.get("region") || "").split("|").filter((r) => REGIONS.includes(r)));
    if (p.has("voice")) state.voiceOnly = p.get("voice") === "1";
    if (p.has("f")) {
      try {
        const f = JSON.parse(p.get("f"));
        state.filters = Object.fromEntries(Object.entries(f).filter(([id]) => COL.has(id)));
      } catch {
        /* ignore malformed filter */
      }
    }
    if (p.has("sort")) {
      const [id, dir] = p.get("sort").split(":");
      state.sort = id === "none" ? null : (id === "name" || COL.has(id)) ? { id, dir: dir === "desc" ? "desc" : "asc" } : state.sort;
    }
    state.selected = new Set((p.get("sel") || "").split(",").filter((iso) => BY_ISO.has(iso)));
    state.wrap = p.get("wrap") === "1";
  }

  // ---------------------------------------------------------------------------
  // Filtering and sorting
  // ---------------------------------------------------------------------------

  function matchesColumnFilters(c, except) {
    for (const [id, f] of Object.entries(state.filters)) {
      if (id === except) continue;
      const col = COL.get(id);
      if (f.s?.length && !f.s.includes(statusOf(c, col))) return false;
      if (f.q && !(c._lc[id] || "").includes(f.q.toLowerCase())) return false;
    }
    return true;
  }

  /** Countries passing every filter except (optionally) one column's own filter. */
  function filteredCountries(exceptCol) {
    const list = parseCountryList(state.q);
    const terms = list ? [] : parseTerms(state.q);
    return COUNTRIES.filter((c) => {
      if (list && !list.isos.has(c.iso)) return false;
      if (state.voiceOnly && !c.urls.voice) return false;
      if (state.regions.size && !state.regions.has(c.region)) return false;
      if (!matchesColumnFilters(c, exceptCol)) return false;
      for (const t of terms) {
        if (c._base.includes(t)) continue;
        if (!Object.values(c._lc).some((s) => s.includes(t))) return false;
      }
      return true;
    });
  }

  function sortCountries(list) {
    const s = state.sort;
    const dir = s?.dir === "desc" ? -1 : 1;
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (!s || s.id === "name") return list.sort((a, b) => dir * byName(a, b));
    const col = COL.get(s.id);
    return list.sort((a, b) => {
      const sa = statusOf(a, col);
      const sb = statusOf(b, col);
      // Blank/missing values always sink to the bottom, whatever the direction.
      const blankA = sa === "na" || sa === "none";
      const blankB = sb === "na" || sb === "none";
      if (blankA !== blankB) return blankA ? 1 : -1;
      if (col.kind === "status" && sa !== sb) return dir * (STATUS[sa].rank - STATUS[sb].rank);
      const ta = a.values[col.id]?.t || "";
      const tb = b.values[col.id]?.t || "";
      if (col.numeric) return dir * (parseFloat(ta) - parseFloat(tb)) || byName(a, b);
      return (col.kind === "text" ? dir * ta.localeCompare(tb) : 0) || byName(a, b);
    });
  }

  /** Hidden columns that explain why a country matched the search, for terms not visible on screen. */
  function hiddenMatches(c, terms, visible) {
    const out = new Set();
    for (const t of terms) {
      if (c._base.includes(t)) continue;
      if ([...visible].some((id) => (c._lc[id] || "").includes(t))) continue;
      for (const [id, s] of Object.entries(c._lc)) if (!visible.has(id) && s.includes(t)) out.add(id);
    }
    return [...out];
  }

  // ---------------------------------------------------------------------------
  // Rendering: chrome (presets, regions, legend, meta)
  // ---------------------------------------------------------------------------

  function renderStatic() {
    const voiceCount = COUNTRIES.filter((c) => c.urls.voice).length;
    el.meta.textContent =
      `Scraped ${fmtDate(DATA.generatedAt)} · ${COUNTRIES.length} countries · ${voiceCount} with voice guidelines` +
      (WR ? ` · Weather Report exported ${fmtDate(WR.exportedAt)}` : "");
    el.legend.innerHTML =
      ["yes", "limited", "required", "notRequired", "no", "info"].map((s) => `<span class="badge ${s}">${esc(STATUS[s].label)}</span>`).join("") +
      (WR ? `<span class="legend-conflict" title="The guideline page and the Weather Report disagree; click the cell for both">Sources disagree</span>` : "");
    const btn = $("#btn-changes");
    btn.textContent = CHANGELOG.length ? `Changes (${fmtDate(CHANGELOG[0].date)})` : "Changes";
  }

  function renderPresets() {
    el.presets.innerHTML = PRESETS.map(
      (p) =>
        `<button type="button" data-preset="${esc(p.id)}" aria-pressed="${p.id === state.preset}" title="${esc(p.description || "")}">${esc(p.label)}</button>`,
    ).join("");
    const p = presetById(state.preset);
    el.presetDesc.textContent = p ? (p.description || "") + (presetModified() ? "  (modified)" : "") : "";
  }

  function renderRegions() {
    el.regions.innerHTML =
      `<button type="button" class="chip" data-region="" aria-pressed="${!state.regions.size}">All regions</button>` +
      REGIONS.map(
        (r) => `<button type="button" class="chip" data-region="${esc(r)}" aria-pressed="${state.regions.has(r)}">${esc(r)}</button>`,
      ).join("");
  }

  function renderActiveFilters() {
    const chips = Object.entries(state.filters).map(([id, f]) => {
      const col = COL.get(id);
      const parts = [];
      if (f.s?.length) parts.push(f.s.map((s) => STATUS[s]?.label || s).join(" or "));
      if (f.q) parts.push(`contains “${f.q}”`);
      return `<button type="button" class="chip" data-clear-filter="${esc(id)}" title="Remove filter">${esc(col.label)}${col.sub ? ` (${esc(col.sub)})` : ""}: ${esc(parts.join(", "))} ✕</button>`;
    });
    el.activeFilters.innerHTML = chips.join("");
  }

  function renderCompareBar() {
    const n = state.selected.size;
    el.compareBar.hidden = n === 0;
    el.compareLabel.textContent =
      n === 1 ? "1 country selected. Select another to compare." : `${n} countries selected: ${[...state.selected].map((i) => BY_ISO.get(i).name).join(", ")}`;
    $("#btn-compare").disabled = n < 2;
  }

  // ---------------------------------------------------------------------------
  // Rendering: the table
  // ---------------------------------------------------------------------------

  let viewRows = [];
  let viewCols = [];

  function renderTable() {
    const terms = searchTerms();
    viewCols = state.cols.map((id) => COL.get(id));
    viewRows = sortCountries(filteredCountries());
    const visible = new Set(state.cols);

    // Header row 1: column groups (consecutive columns in the same table).
    let groups = "";
    for (let i = 0; i < viewCols.length; ) {
      let j = i;
      while (j < viewCols.length && groupKey(viewCols[j]) === groupKey(viewCols[i])) j++;
      groups += `<th colspan="${j - i}" class="${viewCols[i].channel}">${esc(groupTitle(viewCols[i]))}</th>`;
      i = j;
    }

    const sortMark = (id) => (state.sort?.id === id ? `<span class="sort">${state.sort.dir === "desc" ? "▼" : "▲"}</span>` : "");
    const head =
      `<thead><tr class="groups"><th class="country"></th>${groups}</tr>` +
      `<tr class="cols"><th class="country" data-sort="name" tabindex="0">Country${sortMark("name")}</th>` +
      viewCols
        .map((col, i) => {
          const f = state.filters[col.id];
          const on = f && (f.s?.length || f.q);
          return (
            `<th class="col ${col.kind}${on ? " filtered" : ""}" data-c="${i}" data-sort="${esc(col.id)}" tabindex="0" title="${esc(col.description || fullLabel(col))}">` +
            `${col.sub ? `<span class="sub">${esc(col.sub)}</span>` : ""}${esc(col.label)}${sortMark(col.id)}` +
            `<button type="button" class="filter-btn${on ? " on" : ""}" data-filter="${i}" aria-label="Filter ${esc(col.label)}">⏷</button></th>`
          );
        })
        .join("") +
      "</tr></thead>";

    const body = viewRows
      .map((c, r) => {
        const hidden = terms.length ? hiddenMatches(c, terms, visible) : [];
        const hint = hidden.length
          ? `<span class="country-meta">Match in ${esc(hidden.slice(0, 2).map((id) => COL.get(id).label).join(", "))}${hidden.length > 2 ? ` +${hidden.length - 2}` : ""} · <a href="#" data-show-cols="${esc(hidden.join(","))}">show</a></span>`
          : "";
        const cells = viewCols
          .map((col, i) => {
            const v = c.values[col.id];
            const changed = LATEST_CHANGES.has(`${c.iso}|${col.id}`) ? " changed" : "";
            const conflict = c.conflicts?.includes(col.id) ? " conflict" : "";
            const attrs = `class="cell ${col.kind}${changed}${conflict}" data-r="${r}" data-c="${i}"`;
            if (!v) return `<td ${attrs}><span class="na">${esc(noDataText(c, col))}</span></td>`;
            if (v.s === "na") return `<td ${attrs}><span class="na">${hl(v.t || "—", terms)}</span></td>`;
            const lines = v.t.split("\n");
            if (col.kind === "status") {
              const more =
                lines.length > 1
                  ? `<span class="more">+ details</span><div class="cell-text details">${hl(lines.slice(1).join("\n"), terms)}</div>`
                  : "";
              const recent = isRecent(v.d) ? `<span class="recent">Changed ${esc(fmtDate(v.d))}</span>` : "";
              // Guideline cell replaced by the Weather Report's answer (see scraper/weather.js).
              const src = "ov" in v ? `<span class="src" title="The Weather Report wins over the guideline page; click for both">per Weather Report</span>` : "";
              return `<td ${attrs}><span class="badge ${v.s}" title="${esc(lines[0])}">${hl(lines[0], terms)}</span>${src}${recent}${more}</td>`;
            }
            return `<td ${attrs}><div class="cell-text">${hl(v.t, terms)}</div></td>`;
          })
          .join("");
        return (
          `<tr data-r="${r}"${state.selected.has(c.iso) ? ' class="selected"' : ""}>` +
          `<td class="country"><div class="country-cell"><input type="checkbox" data-select="${c.iso}" ${state.selected.has(c.iso) ? "checked" : ""} aria-label="Select ${esc(c.name)} to compare" />` +
          `<div><a href="#" class="country-name" data-country="${c.iso}">${hl(c.name, terms)}</a>` +
          `<span class="country-meta">${hl(c.iso, terms)} · ${hl(c.dialingCode, terms)} · ${esc(c.region)}</span>${hint}</div></div></td>` +
          `${cells}</tr>`
        );
      })
      .join("");

    el.grid.innerHTML = head + `<tbody>${body}</tbody>`;
    el.empty.hidden = viewRows.length > 0;
    el.wrap.classList.toggle("wrap", state.wrap);
    const list = parseCountryList(state.q);
    el.count.textContent =
      `${viewRows.length} of ${COUNTRIES.length} countries · ${viewCols.length} columns` +
      (list?.unmatched.length ? ` · not recognised: ${list.unmatched.join(", ")}` : "");
    el.count.title = list ? `Showing a pasted list of ${list.isos.size} countries` : "";
  }

  function render() {
    renderPresets();
    renderRegions();
    renderActiveFilters();
    renderCompareBar();
    renderTable();
    el.voiceOnly.checked = state.voiceOnly;
    el.wrapText.checked = state.wrap;
    if (document.activeElement !== el.search) el.search.value = state.q;
    writeHash();
  }

  // ---------------------------------------------------------------------------
  // Popovers: cell detail and column filter
  // ---------------------------------------------------------------------------

  let popoverAnchor = null;

  function openPopover(anchor, html) {
    el.popover.innerHTML = html;
    el.popover.hidden = false;
    popoverAnchor = anchor;
    const r = anchor.getBoundingClientRect();
    const pw = el.popover.offsetWidth;
    const ph = el.popover.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
    el.popover.style.left = `${left}px`;
    el.popover.style.top = `${top}px`;
  }

  function closePopover() {
    el.popover.hidden = true;
    popoverAnchor = null;
  }

  function showCellPopover(td) {
    const c = viewRows[+td.dataset.r];
    const col = viewCols[+td.dataset.c];
    const v = c.values[col.id];
    const prev = PREVIOUS.get(`${c.iso}|${col.id}`);
    const isWr = col.channel === "wr";
    const links = infoLinks(c, col);
    // The same question answered by the other source, side by side.
    const other = col.compare && COL.get(col.compare);
    const otherV = other && c.values[other.id];
    const conflict = c.conflicts?.includes(col.id);
    // The other column already shows this one's answer when it was overridden, so skip the repeat.
    const pair = other && !(otherV && "ov" in otherV)
      ? `<div class="pair${conflict ? " conflict" : ""}"><b>${conflict ? "Sources disagree. " : ""}${esc(groupTitle(other))} · ${esc(other.label)}${other.sub ? ` (${esc(other.sub)})` : ""}:</b>` +
        (otherV ? richValue(otherV) : `<p class="na">${esc(noDataText(c, other))}</p>`) +
        "</div>"
      : "";
    openPopover(
      td,
      `<h3>${esc(c.name)} · ${esc(col.label)}${col.sub ? ` (${esc(col.sub)})` : ""}</h3>` +
        `<p class="desc">${esc(groupTitle(col))}${col.description ? ` — ${esc(col.description)}` : ""}</p>` +
        (v ? richValue(v) : `<p class="na">${esc(noDataText(c, col))}</p>`) +
        pair +
        (isWr && WR ? `<p class="desc">From the Weather Report sheet exported ${esc(fmtDate(WR.exportedAt))}.</p>` : "") +
        (prev ? `<div class="was"><b>Changed in update of ${esc(fmtDate(prev.date))}.</b> Previously:\n${esc(prev.before || "(blank)")}</div>` : "") +
        `<div class="row"><div class="more-links">${links.map(linkHtml).join("")}</div>` +
        `<a href="#" data-country="${c.iso}">All details</a></div>`,
    );
  }

  function showFilterPopover(th) {
    const col = viewCols[+th.dataset.c];
    const f = state.filters[col.id] || {};
    // Counts reflect all other active filters, so you can see what each choice would leave.
    const base = filteredCountries(col.id);
    const counts = {};
    for (const c of base) {
      const s = statusOf(c, col);
      counts[s] = (counts[s] || 0) + 1;
    }
    const statuses = Object.keys(STATUS).filter((s) => counts[s] || f.s?.includes(s));
    openPopover(
      th,
      `<h3>Filter: ${esc(col.label)}${col.sub ? ` (${esc(col.sub)})` : ""}</h3>` +
        `<p class="desc">${esc(col.description || groupTitle(col))}</p>` +
        statuses
          .map(
            (s) =>
              `<label><input type="checkbox" data-fs="${s}" ${f.s?.includes(s) ? "checked" : ""} />` +
              `${s === "na" || s === "none" ? `<span class="na">${esc(STATUS[s].label)}</span>` : `<span class="badge ${s}">${esc(STATUS[s].label)}</span>`}` +
              `<span class="n">${counts[s] || 0}</span></label>`,
          )
          .join("") +
        `<input type="text" data-fq placeholder="Text contains…" value="${esc(f.q || "")}" />` +
        `<div class="buttons"><button type="button" data-fclear>Clear</button><button type="button" class="primary" data-fdone>Done</button></div>`,
    );
    el.popover.dataset.col = col.id;
    el.popover.querySelector("[data-fq]").focus();
  }

  function updateFilterFromPopover() {
    const id = el.popover.dataset.col;
    const s = [...el.popover.querySelectorAll("[data-fs]:checked")].map((i) => i.dataset.fs);
    const q = el.popover.querySelector("[data-fq]").value.trim();
    if (s.length || q) state.filters[id] = { ...(s.length ? { s } : {}), ...(q ? { q } : {}) };
    else delete state.filters[id];
    renderActiveFilters();
    renderPresets();
    renderTable();
    writeHash();
  }

  // ---------------------------------------------------------------------------
  // Drawer: country detail, compare, column picker, changes
  // ---------------------------------------------------------------------------

  function openDrawer(title, html, { wide = false } = {}) {
    closePopover();
    el.drawerTitle.textContent = title;
    el.drawerBody.innerHTML = html;
    el.drawer.classList.toggle("wide", wide);
    el.drawer.classList.add("open");
    el.drawer.setAttribute("aria-hidden", "false");
    el.scrim.hidden = false;
    el.drawerBody.scrollTop = 0;
  }

  function closeDrawer() {
    el.drawer.classList.remove("open");
    el.drawer.setAttribute("aria-hidden", "true");
    el.scrim.hidden = true;
  }

  /** Columns grouped by table, in dataset order. */
  function columnGroups(cols = COLS) {
    const groups = [];
    for (const col of cols) {
      const last = groups[groups.length - 1];
      if (last && last.key === groupKey(col)) last.cols.push(col);
      else groups.push({ key: groupKey(col), title: groupTitle(col), channel: col.channel, cols: [col] });
    }
    return groups;
  }

  /** One table rendered as a matrix: rows = labels, columns = sub-columns (Inbound/Outbound, sender types). */
  function groupMatrix(c, group) {
    const cols = group.cols.filter((col) => c.values[col.id]);
    if (!cols.length) return "";
    const subs = [...new Set(cols.filter((col) => col.sub).map((col) => col.sub))];
    const labels = [...new Set(cols.map((col) => col.label))];
    const find = (label, sub) => cols.find((col) => col.label === label && col.sub === sub);
    let html = `<h3>${esc(group.title)}</h3><table class="detail">`;
    if (subs.length) html += `<tr class="sub-head"><th></th>${subs.map((s) => `<th>${esc(s)}</th>`).join("")}</tr>`;
    for (const label of labels) {
      const whole = find(label, null);
      if (whole) {
        const v = c.values[whole.id];
        const cls = c.conflicts?.includes(whole.id) ? ' class="conflict"' : "";
        const value = whole.kind === "status" && v.s !== "info" && v.s !== "na" ? badgeValue(v) : richValue(v);
        html += `<tr><th title="${esc(whole.description)}">${esc(label)}</th><td colspan="${Math.max(1, subs.length)}"${cls}>${value}</td></tr>`;
        continue;
      }
      html +=
        `<tr><th>${esc(label)}</th>` +
        subs
          .map((s) => {
            const col = find(label, s);
            const v = col && c.values[col.id];
            if (!v) return "<td></td>";
            const cls = c.conflicts?.includes(col.id) ? ' class="conflict"' : "";
            return `<td${cls}>${col.kind === "status" && v.s !== "info" && v.s !== "na" ? badgeValue(v) : richValue(v)}</td>`;
          })
          .join("") +
        "</tr>";
    }
    return html + "</table>";
  }

  function showCountry(iso) {
    const c = BY_ISO.get(iso);
    const facts = [
      ["ISO", c.iso],
      ["Dialing code", c.dialingCode],
      ["Mobile country code", c.mcc],
      ["Region", c.region],
    ].filter(([, v]) => v);
    const links =
      ["sms", "voice", "porting"]
        .map((ch) =>
          c.urls[ch]
            ? `<a href="${esc(c.urls[ch])}" target="_blank" rel="noopener noreferrer">Twilio ${CHANNEL_LABEL[ch]} guidelines ↗</a>`
            : `<span class="na">No ${CHANNEL_LABEL[ch]} guidelines published</span>`,
        )
        .join("") +
      (c.urls.portingFaq ? `<a href="${esc(c.urls.portingFaq)}" target="_blank" rel="noopener noreferrer">Porting FAQ ↗</a>` : "") +
      (c.urls.regulatory ? `<a href="${esc(c.urls.regulatory)}" target="_blank" rel="noopener noreferrer">Twilio regulatory requirements ↗</a>` : "");
    const disagree = c.values["wr.check.disagreements"];
    const body =
      `<div class="links">${links}</div>` +
      (disagree ? `<div class="pair${c.conflicts ? " conflict" : ""}"><b>Guidelines vs Weather Report</b><div class="plain">${esc(disagree.t)}</div></div>` : "") +
      `<div class="facts">${facts.map(([k, v]) => `<span><b>${esc(k)}</b>${esc(v)}</span>`).join("")}</div>` +
      columnGroups()
        .map((g) => groupMatrix(c, g))
        .join("");
    openDrawer(`${flag(c.iso)} ${c.name}`, body);
  }

  function showCompare(onlyDiff = false, onlyVisible = false) {
    const list = [...state.selected].map((iso) => BY_ISO.get(iso));
    const cols = (onlyVisible ? state.cols.map((id) => COL.get(id)) : COLS).filter((col) => list.some((c) => c.values[col.id]));
    let rows = "";
    let shown = 0;
    for (const g of columnGroups(cols)) {
      let groupRows = "";
      for (const col of g.cols) {
        const differs = new Set(list.map((c) => compareKey(c.values[col.id]))).size > 1;
        if (onlyDiff && !differs) continue;
        shown++;
        groupRows +=
          `<tr class="${differs ? "differs" : ""}"><th title="${esc(col.description)}">${col.sub ? `<span class="sub">${esc(col.sub)}</span>` : ""}${esc(col.label)}</th>` +
          list
            .map((c) => {
              const v = c.values[col.id];
              if (!v) return `<td><span class="na">${esc(noDataText(c, col))}</span></td>`;
              const cls = c.conflicts?.includes(col.id) ? ' class="conflict"' : "";
              if (col.kind === "status" && v.s !== "na" && v.s !== "info") return `<td${cls}>${badgeValue(v)}</td>`;
              return `<td${cls}>${richValue(v)}</td>`;
            })
            .join("") +
          "</tr>";
      }
      if (groupRows) rows += `<tr class="sub-head"><th colspan="${list.length + 1}">${esc(g.title)}</th></tr>${groupRows}`;
    }
    const body =
      `<div class="compare-controls">` +
      `<label class="toggle"><input type="checkbox" id="cmp-diff" ${onlyDiff ? "checked" : ""}/> Only rows that differ</label>` +
      `<label class="toggle"><input type="checkbox" id="cmp-visible" ${onlyVisible ? "checked" : ""}/> Only columns shown in the table</label>` +
      `<span class="na">${shown} rows · differences highlighted</span></div>` +
      `<table class="detail compare"><thead><tr><th></th>${list.map((c) => `<th><a href="#" data-country="${c.iso}">${flag(c.iso)} ${esc(c.name)}</a></th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
    openDrawer(`Compare ${list.length} countries`, body, { wide: true });
    $("#cmp-diff").onchange = (e) => showCompare(e.target.checked, $("#cmp-visible").checked);
    $("#cmp-visible").onchange = (e) => showCompare($("#cmp-diff").checked, e.target.checked);
  }

  function showColumnPicker(filterText = "") {
    const q = filterText.toLowerCase();
    const selected = new Set(state.cols);
    const groups = columnGroups(COLS.filter((col) => !q || fullLabel(col).toLowerCase().includes(q) || col.id.includes(q)));
    const body =
      `<div class="col-picker"><input type="text" id="col-search" placeholder="Find a column…" value="${esc(filterText)}" />` +
      `<div class="buttons" style="display:flex;gap:8px;margin:8px 0"><button type="button" data-cols-reset>Reset to “${esc(presetById(state.preset)?.label || "view")}”</button><button type="button" data-cols-none>Clear all</button></div>` +
      groups
        .map(
          (g) =>
            `<div class="group"><div class="group-head"><h3>${esc(g.title)}</h3><span><button type="button" data-group-all="${esc(g.key)}">All</button> <button type="button" data-group-none="${esc(g.key)}">None</button></span></div>` +
            g.cols
              .map(
                (col) =>
                  `<label title="${esc(col.description || "")}\nid: ${esc(col.id)}"><input type="checkbox" data-col="${esc(col.id)}" ${selected.has(col.id) ? "checked" : ""}/>` +
                  `<span>${col.sub ? `<span class="sub">${esc(col.sub)} · </span>` : ""}${esc(col.label)}</span><span class="cov">${col.coverage} countries</span></label>`,
              )
              .join("") +
            "</div>",
        )
        .join("") +
      (groups.length ? "" : '<p class="na">No columns match.</p>') +
      "</div>";
    const wasOpen = el.drawer.classList.contains("open") && el.drawerTitle.textContent === "Columns";
    openDrawer("Columns", body);
    const input = $("#col-search");
    input.oninput = debounce(() => showColumnPicker(input.value), 120);
    if (wasOpen || filterText) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function showChanges() {
    const body = CHANGELOG.length
      ? `<div class="changes">` +
        CHANGELOG.map(
          (run) =>
            `<div class="run"><h3>${esc(fmtDate(run.date))} — ${run.changes.length} change${run.changes.length === 1 ? "" : "s"} since ${esc(fmtDate(run.previous))}</h3>` +
            `<table><thead><tr><th>Country</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>` +
            run.changes
              .slice(0, 300)
              .map((ch) => {
                const c = BY_ISO.get(ch.iso);
                const col = COL.get(ch.column);
                return `<tr><td>${c ? `<a href="#" data-country="${c.iso}">${esc(c.name)}</a>` : esc(ch.iso)}</td><td>${esc(col ? fullLabel(col) : ch.column === "*" ? "Country" : ch.column)}</td><td class="before">${esc(ch.before)}</td><td class="after">${esc(ch.after)}</td></tr>`;
              })
              .join("") +
            `</tbody></table>${run.changes.length > 300 ? `<p class="na">…and ${run.changes.length - 300} more (see data/changelog.json)</p>` : ""}</div>`,
        ).join("") +
        "</div>"
      : `<p>No changes recorded yet.</p><p class="na">Each time the scraper runs${WR ? " or a new Weather Report export is merged" : ""}, the new data is compared with the previous version and every changed value is recorded here. Cells changed in the latest update are outlined in the table.</p>`;
    openDrawer("Changes between updates", body, { wide: true });
  }

  // ---------------------------------------------------------------------------
  // Export and sharing
  // ---------------------------------------------------------------------------

  function exportCsv() {
    // Spreadsheets read a leading = + - @ (e.g. "+E.164", "+44", "---") as a formula; a leading
    // apostrophe makes them plain text instead.
    const q = (s) => `"${String(s ?? "").replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
    const showsPorting = viewCols.some((col) => col.channel === "porting" || (col.channel === "wr" && col.group === "porting"));
    const portingHead = showsPorting ? ["Porting guidelines URL", "Porting FAQ URL"] : [];
    const head = ["Country", "ISO", "Region", "Dialing code", ...viewCols.map(fullLabel), "SMS guidelines URL", "Voice guidelines URL", ...portingHead];
    const lines = [head.map(q).join(",")];
    for (const c of viewRows) {
      lines.push(
        [c.name, c.iso, c.region, c.dialingCode, ...viewCols.map((col) => c.values[col.id]?.t ?? ""), c.urls.sms || "", c.urls.voice || ""]
          .concat(showsPorting ? [c.urls.porting || "", c.urls.portingFaq || ""] : [])
          .map(q)
          .join(","),
      );
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `twilio-guidelines-${(presetById(state.preset)?.id || "view")}-${DATA.generatedAt.slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${viewRows.length} countries × ${viewCols.length} columns`);
  }

  async function copyLink() {
    writeHash();
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(location.protocol === "file:" ? "Link copied (it opens this view in this local copy only)" : "Link to this view copied");
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  const onSearch = debounce(() => {
    state.q = el.search.value.trim();
    renderTable();
    writeHash();
  }, 150);
  el.search.addEventListener("input", onSearch);
  // Inputs drop line breaks from pasted text, so a column copied from a spreadsheet would run
  // together; turn each line into a list item instead.
  el.search.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text") || "";
    if (!/[\r\n]/.test(text.trim())) return;
    e.preventDefault();
    const items = text.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean).join(", ");
    el.search.setRangeText(items, el.search.selectionStart, el.search.selectionEnd, "end");
    onSearch();
  });

  el.presets.addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    applyPreset(b.dataset.preset);
    render();
    el.wrap.scrollTo({ left: 0, top: 0 });
  });

  el.regions.addEventListener("click", (e) => {
    const b = e.target.closest("[data-region]");
    if (!b) return;
    const r = b.dataset.region;
    if (!r) state.regions.clear();
    else if (state.regions.has(r)) state.regions.delete(r);
    else state.regions.add(r);
    render();
  });

  el.voiceOnly.addEventListener("change", () => {
    state.voiceOnly = el.voiceOnly.checked;
    render();
  });
  el.wrapText.addEventListener("change", () => {
    state.wrap = el.wrapText.checked;
    el.wrap.classList.toggle("wrap", state.wrap);
    writeHash();
  });

  el.activeFilters.addEventListener("click", (e) => {
    const b = e.target.closest("[data-clear-filter]");
    if (!b) return;
    delete state.filters[b.dataset.clearFilter];
    render();
  });

  function toggleSort(id) {
    if (state.sort?.id !== id) state.sort = { id, dir: "asc" };
    else if (state.sort.dir === "asc") state.sort = { id, dir: "desc" };
    else state.sort = null;
    renderPresets();
    renderTable();
    writeHash();
  }

  el.grid.addEventListener("click", (e) => {
    const fb = e.target.closest("[data-filter]");
    if (fb) {
      e.stopPropagation();
      showFilterPopover(fb.closest("th"));
      return;
    }
    const th = e.target.closest("th[data-sort]");
    if (th) return toggleSort(th.dataset.sort);
    const show = e.target.closest("[data-show-cols]");
    if (show) {
      e.preventDefault();
      for (const id of show.dataset.showCols.split(",")) if (!state.cols.includes(id)) state.cols.push(id);
      render();
      return;
    }
    const name = e.target.closest("[data-country]");
    if (name) {
      e.preventDefault();
      showCountry(name.dataset.country);
      return;
    }
    if (e.target.matches("[data-select]")) return;
    const td = e.target.closest("td.cell");
    if (td) {
      e.stopPropagation();
      if (popoverAnchor === td) closePopover();
      else showCellPopover(td);
    }
  });

  el.grid.addEventListener("keydown", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggleSort(th.dataset.sort);
    }
  });

  el.grid.addEventListener("change", (e) => {
    const cb = e.target.closest("[data-select]");
    if (!cb) return;
    if (cb.checked) state.selected.add(cb.dataset.select);
    else state.selected.delete(cb.dataset.select);
    cb.closest("tr").classList.toggle("selected", cb.checked);
    renderCompareBar();
    writeHash();
  });

  el.popover.addEventListener("click", (e) => {
    const country = e.target.closest("[data-country]");
    if (country) {
      e.preventDefault();
      showCountry(country.dataset.country);
      return;
    }
    if (e.target.closest("[data-fclear]")) {
      el.popover.querySelectorAll("[data-fs]").forEach((i) => (i.checked = false));
      el.popover.querySelector("[data-fq]").value = "";
      updateFilterFromPopover();
      closePopover();
    } else if (e.target.closest("[data-fdone]")) closePopover();
  });
  el.popover.addEventListener("change", (e) => e.target.matches("[data-fs]") && updateFilterFromPopover());
  el.popover.addEventListener("input", debounce((e) => e.target.matches("[data-fq]") && updateFilterFromPopover(), 200));
  el.popover.addEventListener("keydown", (e) => e.key === "Enter" && e.target.matches("[data-fq]") && closePopover());

  document.addEventListener("click", (e) => {
    if (!el.popover.hidden && !el.popover.contains(e.target) && !e.target.closest("td.cell, [data-filter]")) closePopover();
  });
  el.wrap.addEventListener("scroll", () => !el.popover.hidden && closePopover(), { passive: true });
  window.addEventListener("resize", closePopover);

  el.drawerBody.addEventListener("click", (e) => {
    const country = e.target.closest("[data-country]");
    if (country) {
      e.preventDefault();
      showCountry(country.dataset.country);
      return;
    }
    const group = e.target.closest("[data-group-all], [data-group-none]");
    if (group) {
      const key = group.dataset.groupAll || group.dataset.groupNone;
      const ids = COLS.filter((col) => groupKey(col) === key).map((col) => col.id);
      if (group.dataset.groupAll) ids.forEach((id) => !state.cols.includes(id) && state.cols.push(id));
      else state.cols = state.cols.filter((id) => !ids.includes(id));
      render();
      showColumnPicker($("#col-search").value);
      return;
    }
    if (e.target.closest("[data-cols-reset]")) {
      state.cols = validCols(presetById(state.preset)?.columns);
      render();
      showColumnPicker($("#col-search").value);
    } else if (e.target.closest("[data-cols-none]")) {
      state.cols = [];
      render();
      showColumnPicker($("#col-search").value);
    }
  });
  el.drawerBody.addEventListener("change", (e) => {
    const cb = e.target.closest("[data-col]");
    if (!cb) return;
    const id = cb.dataset.col;
    if (cb.checked && !state.cols.includes(id)) state.cols.push(id);
    if (!cb.checked) state.cols = state.cols.filter((x) => x !== id);
    render();
  });

  $("#drawer-close").addEventListener("click", closeDrawer);
  el.scrim.addEventListener("click", closeDrawer);
  $("#btn-columns").addEventListener("click", () => showColumnPicker());
  $("#btn-changes").addEventListener("click", showChanges);
  $("#btn-export").addEventListener("click", exportCsv);
  $("#btn-link").addEventListener("click", copyLink);
  $("#btn-compare").addEventListener("click", () => showCompare());
  $("#btn-compare-clear").addEventListener("click", () => {
    state.selected.clear();
    render();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!el.popover.hidden) closePopover();
      else if (el.drawer.classList.contains("open")) closeDrawer();
      else if (document.activeElement === el.search && el.search.value) {
        el.search.value = "";
        onSearch();
      }
    } else if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      el.search.focus();
      el.search.select();
    }
  });

  window.addEventListener("hashchange", () => {
    readHash();
    render();
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  if (PRESETS[0]) applyPreset(PRESETS[0].id);
  else state.cols = COLS.slice(0, 8).map((c) => c.id);
  readHash();
  renderStatic();
  render();
})();
