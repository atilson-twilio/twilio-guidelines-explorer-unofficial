// Step 2 of the scrape: turn raw per-page fields into one country × column dataset.
//
// Output shape (also documented in README.md):
// {
//   generatedAt, sources,
//   columns:   [{ id, channel, group, groupLabel, sub, label, description, kind, coverage }],
//   countries: [{ iso, name, region, dialingCode, mcc, urls: { sms, voice, porting, portingFaq }, values: { [columnId]: Cell } }]
// }
// Cell = { t: plain text, h?: html (only when it has formatting/links), s: status }
// status ∈ yes | no | required | notRequired | limited | na | info

import { clean } from "./parse.js";

// Canonical short keys and display labels for the sections (tables) Twilio publishes.
// Unknown sections still come through, under a slug of their title.
const SECTIONS = {
  sms: [
    { key: "general", label: "SMS guidelines", match: /^guidelines/i },
    { key: "alpha", label: "Alphanumeric sender ID", match: /^alphanumeric/i },
    { key: "numbers", label: "Long codes & short codes", match: /^long codes/i },
    { key: "tollfree", label: "Toll-free", match: /^toll.?free/i },
  ],
  voice: [
    { key: "reach", label: "Reachability", match: /^reachability/i },
    { key: "callerid", label: "Caller ID", match: /^caller id/i },
    { key: "dtmf", label: "DTMF", match: /^dtmf/i },
    { key: "emergency", label: "Emergency calling", match: /^emergency/i },
  ],
  porting: [{ key: "guidelines", label: "Porting guidelines", match: /^guidelines/i }],
  rcs: [{ key: "guidelines", label: "RCS guidelines", match: /^guidelines/i }],
};
const CHANNEL_ORDER = ["sms", "voice", "rcs", "porting"];

// Porting pages link the country's porting FAQ under "How To Submit". The old support.twilio.com
// URLs redirect to help.twilio.com; store the current form. Japan links a Japanese and an English
// article; prefer the English one ("…-Porting").
const FAQ_LINK = /https?:\/\/(?:support|help)\.twilio\.com\/(?:hc\/[a-z-]+\/)?articles\/(\d+[^"'\s<>#?]*)/gi;
function portingFaq(fields) {
  const found = [];
  for (const f of fields) for (const m of (f.html || "").matchAll(FAQ_LINK)) found.push(`https://help.twilio.com/articles/${m[1]}`);
  return found.find((u) => /-Porting$/i.test(u)) || found[0] || null;
}

const LOCALE_SECTION = /^locale summary/i;

// Spelling variants seen in the wild, folded to one canonical label.
const ROW_ALIASES = { "senderid preserved": "Sender ID preserved" };
const COLUMN_ALIASES = { domestic: "Domestic Pre-registration", "toll free": "Toll-free" };
const REGION_ALIASES = { "middle east and africa": "Middle East & Africa", africa: "Middle East & Africa" };

// Voice Reachability rows that are free text for the whole row, even though the table has
// Inbound/Outbound columns. Twilio sometimes fills one cell, sometimes both; we merge them.
const WHOLE_ROW = /^(outbound restrictions|outbound requirements|best practices)$/i;

// Twilio's row descriptions for the voice grids ("Can in-locale numbers be reached from outside
// the locale?") are written from the inbound side, so combined with the Outbound column they read
// as the opposite of what the cell means. These plain-language versions replace them; Twilio's
// own wording is kept after them as "Twilio: …".
const VOICE_DESCRIPTIONS = {
  "reach.inbound.domestic": "Callers inside this country can call a Twilio number from this country.",
  "reach.inbound.international": "Callers outside this country can call a Twilio number from this country.",
  "reach.inbound.toll-free": "Callers inside this country can call a Twilio toll-free number from this country.",
  "reach.outbound.domestic":
    "Twilio can place calls to phones in this country using a caller ID (From number) from this same country.",
  "reach.outbound.international":
    "Twilio can place calls to phones in this country using a caller ID (From number) from a different country.",
  "reach.outbound.toll-free": "Twilio can place calls to phones in this country using a toll-free number from this country as the caller ID.",
  "callerid.inbound.domestic": "Caller ID you receive on a Twilio number here when the caller is in this country.",
  "callerid.inbound.international": "Caller ID you receive on a Twilio number here when the caller is outside this country.",
  "callerid.inbound.toll-free": "Caller ID you receive on a Twilio toll-free number here.",
  "callerid.outbound.domestic":
    "Whether a caller ID from this same country is shown to the person you call in this country, and in what format.",
  "callerid.outbound.international":
    "Whether a caller ID from a different country is shown to the person you call in this country, and in what format.",
  "callerid.outbound.toll-free": "Whether a toll-free caller ID from this country is shown to the person you call in this country.",
};

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function sectionFor(channel, title) {
  const known = SECTIONS[channel].find((s) => s.match.test(title));
  return known || { key: slug(title), label: title };
}

function describe(channel, sectionKey, column, row, desc, sectionTitle) {
  const twilio = [desc[`${sectionTitle}|${column}`], desc[`${sectionTitle}|${row}`]].filter(Boolean).join(" — ");
  const plain = channel === "voice" && column ? VOICE_DESCRIPTIONS[`${sectionKey}.${slug(column)}.${slug(row)}`] : null;
  return plain ? `${plain}${twilio ? ` (Twilio: ${twilio})` : ""}` : twilio;
}

const canonRow = (row) => ROW_ALIASES[row.toLowerCase()] || row;
const canonColumn = (col) => (col ? COLUMN_ALIASES[col.toLowerCase()] || col : null);

/** True for the placeholder values Twilio uses for "nothing here". */
export function isBlank(text) {
  const t = clean(text).toLowerCase();
  return !t || /^[-–—]+$/.test(t) || t === "n/a" || t === "n?a" || t === "na" || t === "not applicable";
}

/**
 * Classify a cell's text into a coarse status, based on its first line.
 * The original text is always kept; this only drives colouring and filtering.
 */
export function classify(text) {
  if (isBlank(text)) return "na";
  const firstRaw = clean(text.split("\n")[0]);
  const first = firstRaw.toLowerCase().replace(/[*.:]+$/, "").trim();
  // Words that turn a plain yes/no into "it depends" (per-operator exceptions, dates, best effort).
  const qualified = /\b(except|only|for the|for [A-Z]|limitation|non-guaranteed|not guaranteed|best effort|after|until)\b/i;
  const qualifiedAfter = (re) => qualified.test(firstRaw.replace(re, ""));

  if (/^not required\b/.test(first)) return "notRequired";
  if (/^required\b/.test(first)) return "required";
  if (/^(not supported|not available|no)\b|no longer supported|^temporarily suspended|^overwritten|^anonymous/.test(first)) {
    return qualifiedAfter(/^(not supported|not available|no)\b/i) ? "limited" : "no";
  }
  if (/^(non-guaranteed|not guaranteed|only)\b/.test(first)) return "limited";
  if (/^(supp+orted|support|yes|available)\b/.test(first)) return qualified.test(firstRaw) ? "limited" : "yes";
  // Caller ID formats: preserved as E.164 or local format; "(Non-guaranteed)" is best effort.
  if (/^\+?e\.?16[45]\b|^local\b/.test(first)) return qualified.test(firstRaw) ? "limited" : "yes";
  return "info";
}

/** Tidy short status-like values so badges read consistently ("+E164" → "+E.164", "local" → "Local"). */
function tidyText(text) {
  return text
    .replace(/^\+E16[45]\b/, "+E.164")
    .replace(/^E164\b/, "E.164")
    .replace(/^\+E154\b/, "+E.164")
    .replace(/^local\b/, "Local")
    .replace(/^Suppported\b/, "Supported")
    .replace(/\((not|non)[- ]guaranteed\)/gi, "(Non-guaranteed)")
    .replace(/^N\?A$/, "N/A");
}

/** Keep HTML only when it carries something beyond plain paragraphs (links, lists, emphasis). */
function usefulHtml(html) {
  return /<(a|ul|ol|li|b|strong|i|em)\b/i.test(html) ? html : undefined;
}

function mergeCells(cells) {
  const parts = cells.filter((c) => !isBlank(c.text));
  if (!parts.length) return { text: cells[0]?.text || "", html: "" };
  const seen = new Set();
  const unique = parts.filter((c) => !seen.has(c.text) && seen.add(c.text));
  return {
    text: unique.map((c) => c.text).join("\n"),
    html: unique.map((c) => c.html).join(""),
  };
}

/**
 * @param {{ channel: string, iso: string, name: string, url: string, fields: any[], descriptions?: Record<string,string> }[]} pages
 * @param {{ generatedAt: string, sources: Record<string,string> }} meta
 */
export function normalize(pages, meta) {
  const countries = new Map();
  const columns = new Map();
  const sectionOrder = Object.fromEntries(Object.entries(SECTIONS).map(([ch, secs]) => [ch, secs.map((s) => s.key)]));

  const country = (iso, name) => {
    if (!countries.has(iso)) countries.set(iso, { iso, name, region: "", dialingCode: "", mcc: "", urls: {}, values: {} });
    return countries.get(iso);
  };

  for (const page of pages) {
    const c = country(page.iso, page.name);
    c.urls[page.channel] = page.url;
    if (page.channel === "porting") {
      const faq = portingFaq(page.fields);
      if (faq) c.urls.portingFaq = faq;
    }
    const desc = page.descriptions || {};

    // Group fields by (section, row) so whole-row fields can be merged across columns.
    const groups = new Map();
    for (const f of page.fields) {
      if (LOCALE_SECTION.test(f.section)) {
        const v = clean(f.text);
        if (/^locale name$/i.test(f.row) && v) c.name = v;
        else if (/^region$/i.test(f.row) && v && (!c.region || page.channel === "sms")) c.region = REGION_ALIASES[v.toLowerCase()] || v;
        else if (/^dialing code$/i.test(f.row) && v) c.dialingCode = v;
        else if (/^mobile country code$/i.test(f.row) && v) c.mcc = v;
        continue;
      }
      const key = `${f.section}\u0000${canonRow(f.row)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }

    for (const fields of groups.values()) {
      const sec = sectionFor(page.channel, fields[0].section);
      const row = canonRow(fields[0].row);
      const wholeRow = page.channel === "voice" && sec.key === "reach" && WHOLE_ROW.test(row);
      const cells = wholeRow
        ? [{ column: null, ...mergeCells(fields) }]
        : fields.map((f) => ({ column: canonColumn(f.column), text: f.text, html: f.html }));

      for (const cell of cells) {
        const id = [page.channel, sec.key, cell.column && slug(cell.column), slug(row)].filter(Boolean).join(".");
        if (!columns.has(id)) {
          columns.set(id, {
            id,
            channel: page.channel,
            group: sec.key,
            groupLabel: sec.label,
            sub: cell.column,
            label: row,
            description: describe(page.channel, sec.key, cell.column, row, desc, fields[0].section),
            counts: {},
            order: columns.size,
          });
        }
        const text = tidyText(cell.text);
        const s = classify(text);
        const col = columns.get(id);
        col.counts[s] = (col.counts[s] || 0) + 1;
        const h = usefulHtml(cell.html);
        c.values[id] = h ? { t: text, h, s } : { t: text, s };
      }
    }
  }

  // RCS pages have no "supported" row: a country is RCS-supported when Twilio publishes an RCS
  // guideline page for it (the RCS index lists the countries where Twilio offers RCS).
  if (pages.some((p) => p.channel === "rcs")) {
    const id = "rcs.guidelines.supported";
    const counts = {};
    for (const c of countries.values()) {
      const v = c.urls.rcs ? { t: "Supported", s: "yes" } : { t: "Not supported", s: "no" };
      c.values[id] = v;
      counts[v.s] = (counts[v.s] || 0) + 1;
    }
    columns.set(id, {
      id,
      channel: "rcs",
      group: "guidelines",
      groupLabel: "RCS guidelines",
      sub: null,
      label: "RCS supported",
      description: "Supported when Twilio publishes RCS guidelines for this country (Twilio's RCS guideline index lists the countries where it offers RCS).",
      counts,
      order: -1, // first in its group
    });
  }

  // A column is a "status" column when most of its non-blank values classify cleanly;
  // otherwise it's free text (use-case restrictions, best practices, provisioning time...).
  const columnList = [...columns.values()]
    .map((col) => {
      const total = Object.values(col.counts).reduce((a, b) => a + b, 0);
      const filled = total - (col.counts.na || 0);
      const info = col.counts.info || 0;
      const kind = filled && info / filled <= 0.2 ? "status" : "text";
      const { counts, order, ...rest } = col;
      return { ...rest, kind, coverage: filled, _order: order };
    })
    .sort((a, b) => {
      if (a.channel !== b.channel) return CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel);
      const ga = sectionOrder[a.channel].indexOf(a.group);
      const gb = sectionOrder[b.channel].indexOf(b.group);
      if (ga !== gb) return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
      return a._order - b._order;
    })
    .map(({ _order, ...c }) => c);

  // Text columns keep a status too, but only "na" vs "info" is meaningful there.
  const textCols = new Set(columnList.filter((c) => c.kind === "text").map((c) => c.id));
  for (const c of countries.values()) {
    for (const [id, v] of Object.entries(c.values)) if (textCols.has(id) && v.s !== "na") v.s = "info";
  }

  return {
    ...meta,
    columns: columnList,
    countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Compare two normalized datasets cell by cell.
 * @returns {{ iso: string, column: string, before: string, after: string }[]}
 */
export function diff(prev, next) {
  if (!prev) return [];
  const prevByIso = new Map(prev.countries.map((c) => [c.iso, c]));
  const changes = [];
  for (const c of next.countries) {
    const p = prevByIso.get(c.iso);
    if (!p) {
      changes.push({ iso: c.iso, column: "*", before: "", after: "Country added" });
      continue;
    }
    const ids = new Set([...Object.keys(p.values), ...Object.keys(c.values)]);
    for (const id of ids) {
      const before = p.values[id]?.t ?? "";
      const after = c.values[id]?.t ?? "";
      if (clean(before) !== clean(after)) changes.push({ iso: c.iso, column: id, before, after });
    }
  }
  const nextIsos = new Set(next.countries.map((c) => c.iso));
  for (const p of prev.countries) if (!nextIsos.has(p.iso)) changes.push({ iso: p.iso, column: "*", before: "Country removed", after: "" });
  return changes;
}
