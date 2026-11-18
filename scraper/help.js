// Twilio Help Center articles linked per country: alphanumeric sender ID registration (documents
// required) and short code best practices. Adds one link column for each to the dataset.
//
// help.twilio.com is a JavaScript app, but it loads each section's article list from a public JSON
// endpoint, so no browser is needed: one request per section returns every article's id and title.
// Articles are matched to countries by topic (title pattern), then by a country name in the title.

import { fetchText } from "./fetch.js";

const SECTIONS_API = "https://www.twilio.com/console/help-center/v1/knowledge-base/sections/";
const ARTICLE_URL = "https://help.twilio.com/articles/";

export const HELP_COLUMNS = [
  {
    id: "sms.alpha.help.registration-article",
    channel: "sms",
    group: "alpha",
    groupLabel: "Alphanumeric sender ID",
    sub: "Help Center",
    label: "Registration article",
    description: "Twilio Help Center article on registering an alphanumeric sender ID in this country (documents required and instructions).",
    kind: "link",
    section: 205104768, // help.twilio.com/sections/205104768-SMS
    // "Documents Required and Instructions to Register Your Alphanumeric Sender ID in X",
    // "How to Register Your Alphanumeric Sender ID in X", "Registering Your Alphanumeric Sender ID for X…",
    // "Alphanumeric Sender ID Registration Process in X". Generic articles have no country and are skipped.
    topic: /alphanumeric sender id/i,
    also: /regist/i,
    after: /^sms\.alpha\./, // placed after the last column of this group
  },
  {
    id: "sms.numbers.short-code.best-practices-article",
    channel: "sms",
    group: "numbers",
    groupLabel: "Long codes and short codes",
    sub: "Short code",
    label: "Best practices article",
    description: "Twilio Help Center article on short code best practices for this country.",
    kind: "link",
    section: 205112927, // help.twilio.com/sections/205112927-Short-Codes
    topic: /short codes?\s+best practi[cs]es/i, // "X Short Code(s) Best Practices" / "…Practises"
    after: /^sms\.numbers\.short-code\./,
  },
];

// Ways titles name countries that differ from the guideline pages' names (lower case).
const TITLE_ALIASES = {
  uae: "AE",
  "united arab emirates": "AE",
  uk: "GB",
  swedish: "SE",
  russia: "RU",
  vietnam: "VN",
  turkey: "TR",
  "south korea": "KR",
  korea: "KR",
  tanzania: "TZ",
  usa: "US",
  "united states": "US",
};

const norm = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();

/** Finds the country a title is about: the longest country name or alias appearing as whole words. */
function countryMatcher(countries) {
  const names = new Map(Object.entries(TITLE_ALIASES));
  for (const c of countries) {
    names.set(norm(c.name), c.iso);
    // "Korea, Republic of" style names: also try the part before the comma.
    if (c.name.includes(",")) names.set(norm(c.name.split(",")[0]), c.iso);
  }
  const keys = [...names.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  return (title) => {
    const t = ` ${norm(title)} `;
    const key = keys.find((k) => t.includes(` ${k} `));
    return key ? names.get(key) : null;
  };
}

/** Download the article lists of the Help Center sections used by HELP_COLUMNS. */
export async function fetchHelpArticles() {
  const out = {};
  for (const col of HELP_COLUMNS) {
    if (out[col.section]) continue;
    const { html } = await fetchText(SECTIONS_API + col.section);
    const articles = JSON.parse(html)?.data?.section?.articles;
    if (!Array.isArray(articles) || !articles.length) throw new Error(`Help Center section ${col.section} returned no articles`);
    out[col.section] = articles.map((a) => ({ id: String(a.id), title: String(a.title || "").replace(/\s+/g, " ").trim() }));
  }
  return out;
}

const escHtml = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

/**
 * Add the Help Center link columns to a normalized dataset (mutates it).
 * @returns {{ matched: Record<string, number>, unmatched: string[] }}
 */
export function addHelpArticles(dataset, sections) {
  const find = countryMatcher(dataset.countries);
  const byIso = new Map(dataset.countries.map((c) => [c.iso, c]));
  const matched = {};
  const unmatched = [];

  for (const col of HELP_COLUMNS) {
    const perCountry = new Map();
    for (const a of sections[col.section] || []) {
      if (!col.topic.test(a.title) || (col.also && !col.also.test(a.title))) continue;
      const iso = find(a.title);
      if (!iso || !byIso.has(iso)) {
        // Titles like "Alphanumeric Sender ID Registration in the Twilio Console" are general, not per country.
        if (!/twilio console$/i.test(a.title)) unmatched.push(a.title);
        continue;
      }
      if (!perCountry.has(iso)) perCountry.set(iso, []);
      perCountry.get(iso).push({ ...a, url: ARTICLE_URL + a.id });
    }

    for (const [iso, list] of perCountry) {
      list.sort((a, b) => a.title.localeCompare(b.title));
      byIso.get(iso).values[col.id] = {
        t: list.map((a) => a.title).join("\n"),
        h: list.map((a) => `<p><a href="${a.url}">${escHtml(a.title)}</a></p>`).join(""),
        s: "info",
        u: list.map((a) => a.url),
      };
    }
    matched[col.id] = perCountry.size;

    const { section, topic, also, after, ...column } = col;
    const meta = { ...column, coverage: perCountry.size };
    const existing = dataset.columns.findIndex((c) => c.id === col.id);
    if (existing >= 0) dataset.columns[existing] = meta;
    else {
      let at = -1;
      dataset.columns.forEach((c, i) => after.test(c.id) && (at = i));
      dataset.columns.splice(at >= 0 ? at + 1 : dataset.columns.length, 0, meta);
    }
  }
  return { matched, unmatched };
}

/** Copy the Help Center columns from a previous dataset (used when the Help Center can't be reached). */
export function carryOverHelpArticles(prev, next) {
  if (!prev) return false;
  const ids = new Set(HELP_COLUMNS.map((c) => c.id));
  const cols = prev.columns.filter((c) => ids.has(c.id));
  if (!cols.length) return false;
  const prevByIso = new Map(prev.countries.map((c) => [c.iso, c]));
  for (const c of next.countries) {
    const p = prevByIso.get(c.iso);
    if (p) for (const id of ids) if (p.values[id]) c.values[id] = p.values[id];
  }
  for (const col of cols) {
    const def = HELP_COLUMNS.find((h) => h.id === col.id);
    let at = -1;
    next.columns.forEach((c, i) => def.after.test(c.id) && (at = i));
    next.columns.splice(at >= 0 ? at + 1 : next.columns.length, 0, col);
  }
  return true;
}
