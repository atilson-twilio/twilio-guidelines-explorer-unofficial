// Twilio's "Weather Report": a Google Sheet of what Twilio actually sells today, per country
// (phone number types, porting, short codes, alphanumeric sender IDs). It is often more current
// than the guideline pages. Internal data: the merged output is local only (see output.js).
//
// Input: each tab of the sheet exported as CSV (File → Download → Comma-separated values) into
// weather-report-data/. Tabs are recognised by their header row, so file names don't matter.
//
// Output: extra "wr.*" columns merged into the normalized dataset, plus a cross-check column
// listing where the two sources disagree. Cells keep the usual { t, s } shape, with
//   d: ISO date of the most recent status change (when the sheet records one).
//
// The Weather Report wins: where it answers a question the guideline page also answers (PAIRS)
// and the two disagree, or the guideline page has no answer, the guideline cell is replaced by
// the Weather Report's answer. The original guideline cell is kept in `ov` (and its text below
// the new first line), so stripWeather() can restore it.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const WR_CHANNEL = "wr";

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, CRLF or LF. */
export function parseCsv(text) {
  const s = text.replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (s[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((f) => f.trim()));
}

// Which tab a CSV is, from its header row.
const TABS = [
  { key: "porting", test: (h) => h.includes("Twilio Porting Requirements Updates") },
  { key: "senderId", test: (h) => h.includes("Frequency") && h.includes("Disclaimer") },
  { key: "numbers", test: (h) => h.includes("Price") && h.includes("Status") },
  { key: "shortCode", test: (h, rows) => rows.length && rows.every((r) => /^short code$/i.test(r.Type)) },
];

/** Read every CSV in `dir`. Returns null when the folder is missing or empty. */
export function loadWeatherReport(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv")).sort();
  if (!files.length) return null;
  const tabs = {};
  const hash = crypto.createHash("sha256");
  let mtime = 0;
  for (const file of files) {
    const full = path.join(dir, file);
    const text = fs.readFileSync(full, "utf8");
    hash.update(file).update(text);
    mtime = Math.max(mtime, fs.statSync(full).mtimeMs);
    const [header, ...data] = parseCsv(text);
    const head = header.map((h) => h.trim());
    const rows = data.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").replace(/\r\n?/g, "\n").trim()])));
    const tab = TABS.find((t) => t.test(head, rows));
    if (!tab) throw new Error(`Weather Report: can't tell which tab ${file} is (header: ${head.join(", ")})`);
    if (tabs[tab.key]) throw new Error(`Weather Report: ${file} and ${tabs[tab.key].file} look like the same tab`);
    tabs[tab.key] = { file, rows };
  }
  return { tabs, hash: hash.digest("hex").slice(0, 16), modifiedAt: new Date(mtime).toISOString() };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

// Weather Report names that don't match a guideline page's country name.
const COUNTRY_ALIASES = {
  "brunei darussalam": "BN",
  congo: "CG",
  "cote d ivoire": "CI",
  "holy see": "VA",
  lao: "LA",
  "u s virgin islands": "VI",
};

const normName = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/[^a-z]+/g, " ")
    .trim();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3/1/2024 2:55 PM" → "2024-03-01" (the sheet uses US month/day order). */
function isoDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || "");
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}
const fmtDate = (iso) => (iso ? `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}` : "");

/** List prices are written with decimal commas ("8,25"). */
const price = (s) => s.replace(/(\d),(\d)/g, "$1.$2");

// Status wording → badge status. "Paused" stays "limited" for display but counts as
// unavailable when cross-checking, since new numbers can't be bought while paused.
const STATUSES = [
  [/^(ga|api & console|standard porting)$/i, "yes"],
  [/^pre-registration required/i, "yes"],
  [/^(private offering|beta|preview|scouting|custom porting|custom service|available by request|paused)/i, "limited"],
  [/^(not available|unavailable|discontinued)$/i, "no"],
];
const classify = (status) => STATUSES.find(([re]) => re.test(status))?.[1] || "info";
const RANK = { yes: 0, limited: 1, info: 2, no: 3 };

const DISPLAY = { "pre-registration required, available via senderid form": "Pre-registration via Sender ID form" };
const display = (status) => DISPLAY[status.toLowerCase()] || status;

/** "Supplier Constraints." → "Supplier constraints" so the same reason reads the same everywhere. */
const reason = (s) =>
  /^(supplier|systematic|regulatory|system) (constraints|limitations)\.?$/i.test(s)
    ? s[0].toUpperCase() + s.slice(1).toLowerCase().replace(/\.$/, "")
    : s;

function changeLine(row, statusKey, prefix = "") {
  const date = isoDate(row["Date Of Status Change"]);
  const prev = row["Previous Status"];
  if (prev && date) return `${prefix}Changed from ${prev} on ${fmtDate(date)}`;
  if (prev) return `${prefix}Previously ${prev}`;
  if (date) return `${prefix}Status set ${fmtDate(date)}`;
  return "";
}

const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const latest = (rows) => rows.map((r) => isoDate(r["Date Of Status Change"])).sort().pop() || "";

/**
 * One cell from one or more sheet rows (e.g. Australia lists Mobile three times, once per capability).
 * The first line is the best status; the rest are details.
 */
function statusCell(rows, statusKey, details, { summary = false, capabilities = true } = {}) {
  const best = rows.slice().sort((a, b) => RANK[classify(a[statusKey])] - RANK[classify(b[statusKey])])[0];
  const status = best[statusKey];
  const many = rows.length > 1;
  const lines = [display(status)];
  if (many) lines.push(...rows.map((r) => `${r.Capability}: ${display(r[statusKey])}`));
  else if (capabilities && rows[0].Capability) lines.push(`Capabilities: ${rows[0].Capability}`);
  if (!summary) lines.push(...uniq(rows.map((r) => changeLine(r, statusKey, many ? `${r.Capability}: ` : ""))));
  lines.push(...details(rows));
  const d = latest(rows);
  const cell = { t: uniq(lines).join("\n"), s: classify(status) };
  if (d) cell.d = d;
  if (/^paused$/i.test(status)) cell.paused = true;
  return cell;
}

function addressLines(rows) {
  const out = [];
  for (const r of rows) {
    const biz = r["Businesses Address Requirement"];
    const ind = r["Individual's Address Requirements"];
    if (biz && biz === ind) out.push(`Address: ${biz}`);
    else {
      if (biz) out.push(`Address (business): ${biz}`);
      if (ind) out.push(`Address (individual): ${ind}`);
    }
  }
  return out;
}

const numberDetails = (rows) => [
  ...uniq(rows.map((r) => r.Price && `Twilio list price: ${price(r.Price)}`)),
  ...uniq(rows.map((r) => r["Expected Delivery"] && `Expected delivery: ${r["Expected Delivery"]}`)),
  ...uniq(rows.map((r) => r["Customer-ready explanation"] && `Note: ${reason(r["Customer-ready explanation"])}`)),
  ...uniq(rows.map((r) => r["Reseller Limitations"] && `Resellers: ${r["Reseller Limitations"]}`)),
  ...uniq(rows.map((r) => !NUMBER_TYPES.some((n) => n.label.toLowerCase() === r.Type.toLowerCase()) && `Listed as: ${r.Type}`)),
  ...uniq(addressLines(rows)),
];

const portingDetails = (rows) => [
  ...uniq(rows.map((r) => r["Expected Delivery"] && `Expected porting time: ${r["Expected Delivery"]}`)),
  ...uniq(rows.map((r) => r.Notes && `Note: ${r.Notes}`)),
];

const senderIdDetails = (rows) => [
  ...uniq(rows.map((r) => r.Price && `Twilio list price: ${price(r.Price)}${r.Frequency ? ` (${r.Frequency.toLowerCase()})` : ""}`)),
  ...uniq(rows.map((r) => r.Disclaimer && `Fee: ${r.Disclaimer}`)),
];

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const NUMBER_TYPES = [
  { key: "local", label: "Local", match: /^local$/i },
  { key: "mobile", label: "Mobile", match: /^mobile$/i },
  { key: "national", label: "National", match: /^national\b/i },
  { key: "toll-free", label: "Toll-Free", match: /^toll.?free$/i },
];
const typeOf = (t) => NUMBER_TYPES.find((n) => n.match.test(t))?.key || "other";

const col = (group, groupLabel, id, label, sub, description, extra = {}) => ({
  id: `${WR_CHANNEL}.${group}.${id}`,
  channel: WR_CHANNEL,
  group,
  groupLabel,
  sub,
  label,
  description,
  kind: "status",
  ...extra,
});

const AVAIL = "Whether Twilio sells this today, from the Weather Report.";
const COLUMNS = [
  col("numbers", "Phone numbers", "sms-capable", "SMS-capable number", null,
    "Best availability of any non-toll-free number type that supports SMS. \"No SMS-capable number listed\" means the Weather Report lists this country's numbers, but none send SMS."),
  ...NUMBER_TYPES.map((n) => col("numbers", "Phone numbers", `${n.key}.availability`, "Availability", n.label, `${AVAIL} ${n.label} numbers.`)),
  ...NUMBER_TYPES.map((n) =>
    col("numbers", "Phone numbers", `${n.key}.list-price`, "Twilio list price", n.label, `Twilio's list price for ${n.label} numbers.`, {
      kind: "text",
      numeric: true,
    }),
  ),
  col("numbers", "Phone numbers", "other-types", "Other number types", null,
    "Specialised number types (shared cost, M2M, mass-communication ranges…).", { kind: "text" }),
  col("porting", "Number porting", "best", "Porting", null, "Best porting status across all number types."),
  ...NUMBER_TYPES.map((n) => col("porting", "Number porting", n.key, "Porting into Twilio", n.label, `Porting ${n.label} numbers into Twilio.`)),
  col("shortcode", "Short code", "availability", "Short code", null, "Whether Twilio sells short codes here today."),
  col("senderid", "Alphanumeric sender ID", "dynamic", "Dynamic", null, "Dynamic alphanumeric sender ID (no registration)."),
  col("senderid", "Alphanumeric sender ID", "pre-registered", "Pre-registered", null, "Pre-registered alphanumeric sender ID, via Twilio's Sender ID form."),
  col("check", "Cross-check", "disagreements", "Guidelines vs Weather Report", null,
    "Where the guideline page and the Weather Report disagree on availability, or the Weather Report covers something the guideline page doesn't.",
    { kind: "text" }),
];

const CHECK_ID = "wr.check.disagreements";

// Guideline column ↔ Weather Report column pairs that answer the same question.
const PAIRS = [
  { label: "Short code", gl: "sms.numbers.short-code.twilio-supported", wr: "wr.shortcode.availability" },
  { label: "Dynamic alphanumeric sender ID", gl: "sms.alpha.dynamic.twilio-supported", wr: "wr.senderid.dynamic" },
  { label: "Domestic long code (SMS)", gl: "sms.numbers.long-code-domestic.twilio-supported", wr: "wr.numbers.sms-capable" },
];

/** The guideline cell `gl` (possibly missing), replaced by the Weather Report's answer `w`. */
function override(gl, w, since) {
  const lines = [firstLine(w), `Per Twilio's Weather Report${since}.`];
  lines.push(gl && gl.s !== "na" ? `Guideline page says: ${gl.t}` : "No answer on the guideline page.");
  const cell = { t: lines.join("\n"), s: w.s, ov: gl || null };
  if (w.d) cell.d = w.d;
  return cell;
}

/** yes | no | unknown, for cross-checking. Limited counts as available; paused does not. */
function availability(v) {
  if (!v) return "unknown";
  if (v.paused || v.s === "no") return "no";
  if (v.s === "yes" || v.s === "limited") return "yes";
  return "unknown";
}

const firstLine = (v) => v.t.split("\n")[0];

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** Drop any Weather Report columns and values from a dataset (before re-merging a newer export). */
export function stripWeather(dataset) {
  const columns = dataset.columns.filter((c) => c.channel !== WR_CHANNEL).map(({ compare, ...c }) => c);
  const countries = dataset.countries.map(({ conflicts, ...c }) => {
    const values = Object.fromEntries(
      Object.entries(c.values)
        .filter(([id, v]) => !id.startsWith(`${WR_CHANNEL}.`) && !(v.ov === null))
        .map(([id, v]) => [id, v.ov || v]),
    );
    const { regulatory, ...urls } = c.urls;
    return { ...c, urls, values };
  });
  const { weatherReport, ...rest } = dataset;
  return { ...rest, columns, countries };
}

/**
 * Merge a loaded Weather Report into a normalized dataset (returns a new dataset).
 * @param {object} dataset  output of normalize(), without Weather Report columns
 * @param {ReturnType<typeof loadWeatherReport>} wr
 * @param {{ previous?: object }} opts  previous dataset, to keep the export date when files are unchanged
 */
export function mergeWeather(dataset, wr, { previous } = {}) {
  const byName = new Map(dataset.countries.map((c) => [normName(c.name), c]));
  const byIso = new Map(dataset.countries.map((c) => [c.iso, c]));
  const countries = new Map(dataset.countries.map((c) => [c.iso, { ...c, urls: { ...c.urls }, values: { ...c.values } }]));
  const unmatched = new Set();
  const find = (name) => {
    const c = byName.get(normName(name)) || byIso.get(COUNTRY_ALIASES[normName(name)]);
    if (!c) unmatched.add(name);
    return c && countries.get(c.iso);
  };
  const grouped = (rows, keyOf) => {
    const out = new Map();
    for (const r of rows) {
      const c = find(r.Country);
      if (!c) continue;
      if (!out.has(c.iso)) out.set(c.iso, { c, byKey: new Map() });
      const k = keyOf(r);
      const g = out.get(c.iso).byKey;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    }
    return out.values();
  };
  const { tabs } = wr;

  // Phone numbers: one availability + list price cell per type, and an SMS-capable summary.
  for (const { c, byKey } of grouped(tabs.numbers?.rows || [], (r) => typeOf(r.Type))) {
    for (const n of NUMBER_TYPES) {
      const rows = byKey.get(n.key);
      if (!rows) continue;
      c.values[`wr.numbers.${n.key}.availability`] = statusCell(rows, "Status", numberDetails);
      const prices = uniq(rows.map((r) => r.Price && price(r.Price)));
      if (prices.length) c.values[`wr.numbers.${n.key}.list-price`] = { t: prices.join(" / "), s: "info" };
    }
    const other = byKey.get("other");
    if (other)
      c.values["wr.numbers.other-types"] = {
        t: other.map((r) => `${r.Type} (${r.Capability}): ${r.Status}${r.Price ? ` · Twilio list price ${price(r.Price)}` : ""}`).join("\n"),
        s: "info",
      };
    // Toll-free is left out: it isn't a long code. Specialised types count (some countries only
    // offer SMS on technical-platform or M2M numbers).
    const sms = ["local", "mobile", "national", "other"].flatMap((k) => (byKey.get(k) || []).filter((r) => /sms/i.test(r.Capability)));
    c.values["wr.numbers.sms-capable"] = sms.length
      ? statusCell(sms.map((r) => ({ ...r, Capability: `${r.Type} (${r.Capability})` })), "Status", () => [], { summary: true })
      : { t: "No SMS-capable number listed", s: "no" };
    const reg = [...byKey.values()].flat().map((r) => r["Twilio Regulatory Requirements"]).find((u) => /^https?:\/\//.test(u));
    if (reg) c.urls.regulatory = reg;
  }

  // Porting.
  for (const { c, byKey } of grouped(tabs.porting?.rows || [], (r) => typeOf(r.Type))) {
    for (const n of NUMBER_TYPES) {
      const rows = byKey.get(n.key);
      if (rows) c.values[`wr.porting.${n.key}`] = statusCell(rows, "Status", portingDetails);
    }
    const all = [...byKey.values()].flat();
    c.values["wr.porting.best"] = statusCell(all.map((r) => ({ ...r, Capability: r.Type })), "Status", () => [], { summary: true });
  }

  // Short code and sender ID: one row per country.
  for (const { c, byKey } of grouped(tabs.shortCode?.rows || [], () => "sc"))
    c.values["wr.shortcode.availability"] = statusCell(byKey.get("sc"), "Current Status", () => [], { capabilities: false });
  for (const { c, byKey } of grouped(tabs.senderId?.rows || [], (r) => (/pre-?registered/i.test(r.Type) ? "pre-registered" : "dynamic")))
    for (const [k, rows] of byKey) c.values[`wr.senderid.${k}`] = statusCell(rows, "Current Status", senderIdDetails, { capabilities: false });

  // Cross-check against the guideline pages.
  let conflictCount = 0;
  for (const c of countries.values()) {
    const lines = [];
    const conflicts = [];
    for (const p of PAIRS) {
      const gl = c.values[p.gl];
      const w = c.values[p.wr];
      const a = availability(gl);
      const b = availability(w);
      if (b === "unknown") continue;
      const since = w.d ? ` (since ${fmtDate(w.d)})` : "";
      if (a !== "unknown" && a !== b) {
        conflicts.push(p.gl, p.wr);
        lines.push(`${p.label}: Guidelines say “${firstLine(gl)}”; Weather Report says “${firstLine(w)}”${since}. Showing the Weather Report.`);
      } else if (a === "unknown" && b === "yes" && p.wr !== "wr.numbers.sms-capable") {
        lines.push(`${p.label}: not covered by the Guidelines; Weather Report says “${firstLine(w)}”${since}`);
      }
      if (a !== b) c.values[p.gl] = override(gl, w, since);
    }
    if (lines.length) c.values[CHECK_ID] = { t: lines.join("\n"), s: "info" };
    if (conflicts.length) (c.conflicts = conflicts), conflictCount++;
  }

  // Tidy cells: `paused` only drives the cross-check.
  for (const c of countries.values())
    for (const v of Object.values(c.values)) if (v.paused) delete v.paused;

  const pairOf = new Map(PAIRS.flatMap((p) => [[p.gl, p.wr], [p.wr, p.gl]]));
  const coverage = (id) => [...countries.values()].filter((c) => c.values[id] && c.values[id].s !== "na").length;
  const columns = [
    ...dataset.columns.map((c) => (pairOf.has(c.id) ? { ...c, compare: pairOf.get(c.id) } : c)),
    ...COLUMNS.map((c) => ({ ...c, ...(pairOf.has(c.id) ? { compare: pairOf.get(c.id) } : {}), coverage: coverage(c.id) })),
  ];

  const allRows = Object.values(tabs).flatMap((t) => t.rows);
  const sameFiles = previous?.weatherReport?.hash === wr.hash;
  const weatherReport = {
    exportedAt: sameFiles ? previous.weatherReport.exportedAt : wr.modifiedAt,
    latestChange: latest(allRows),
    hash: wr.hash,
    files: Object.fromEntries(Object.entries(tabs).map(([k, t]) => [k, t.file])),
    countries: [...countries.values()].filter((c) => Object.keys(c.values).some((id) => id.startsWith("wr."))).length,
    conflicts: conflictCount,
  };
  const missing = TABS.map((t) => t.key).filter((k) => !tabs[k]);

  return {
    dataset: { ...dataset, weatherReport, columns, countries: [...countries.values()] },
    unmatched: [...unmatched].sort(),
    missing,
  };
}

/** Console summary of a merge, with warnings for anything that didn't map. */
export function reportWeather({ dataset, unmatched, missing }) {
  const w = dataset.weatherReport;
  console.log(
    `Weather Report: ${w.countries} countries, latest status change ${w.latestChange || "unknown"}, ` +
      `${w.conflicts} countries where it disagrees with the guidelines.`,
  );
  if (missing.length) console.warn(`  ! No CSV found for tab(s): ${missing.join(", ")}`);
  if (unmatched.length)
    console.warn(`  ! ${unmatched.length} Weather Report countries have no guideline page (add to COUNTRY_ALIASES in scraper/weather.js if they should): ${unmatched.join(", ")}`);
}
