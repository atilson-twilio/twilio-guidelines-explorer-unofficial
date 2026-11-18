// Parses a Twilio country guideline page (SMS or Voice) into structured fields.
//
// Every guideline page holds a series of tables inside section#guideline-tables.
// Two shapes occur:
//   1. Key/value tables: the first header cell is the table title ("Locale Summary",
//      "Guidelines"), and each row is <label> | <value>.
//   2. Grid tables: header cells name the columns ("Inbound" / "Outbound",
//      "Pre-registration" / "Dynamic", ...), and each row is <label> | <value per column>.
//      Voice grids carry their title in the first header cell ("Reachability", "Caller ID");
//      SMS sender-ID grids have an empty first header cell and an <h3> above the table
//      ("Alphanumeric", "Long codes and short codes").
//
// Label cells contain a bold label followed by an explanatory description; we keep
// only the bold part as the label.

import * as cheerio from "cheerio";

/** @typedef {{ section: string, column: string|null, row: string, text: string, html: string }} RawField */

/** Collapse whitespace and trim. */
export function clean(s) {
  return (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Text content of a cell, keeping paragraph and line breaks as newlines. */
function cellText($, el) {
  const $el = $(el).clone();
  $el.find("br").replaceWith("\n");
  $el.find("p, li, div").each((_, n) => {
    $(n).prepend(n.tagName === "li" ? "\n• " : "\n");
    $(n).append("\n");
  });
  return $el
    .text()
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    // A bullet followed by a block element (<li><p>…) leaves a lone "•"; join it to the next line.
    .reduce((out, l) => (out.length && out[out.length - 1] === "•" ? (out[out.length - 1] = `• ${l}`, out) : (out.push(l), out)), [])
    .join("\n");
}

/** Sanitised inner HTML of a cell's rich text: keeps only simple formatting tags and safe links. */
function cellHtml($, el, baseUrl) {
  const $rte = $(el).find(".pricing-table-rte").first();
  const $root = ($rte.length ? $rte : $(el)).clone();
  const allowed = new Set(["p", "br", "b", "strong", "i", "em", "ul", "ol", "li", "a"]);
  $root.find("*").each((_, n) => {
    const $n = $(n);
    const tag = n.tagName?.toLowerCase();
    if (!allowed.has(tag)) {
      $n.replaceWith($n.contents());
      return;
    }
    const href = tag === "a" ? $n.attr("href") : null;
    for (const attr of Object.keys(n.attribs || {})) $n.removeAttr(attr);
    if (href) {
      try {
        const url = new URL(href, baseUrl);
        if (url.protocol === "http:" || url.protocol === "https:") {
          // Some pages link to the Console with an author's Account SID in the path; drop it (the
          // Console opens the reader's own account) so no SIDs end up in the data.
          url.pathname = url.pathname.replace(/\/account\/AC[0-9a-f]{32}(?=\/|$)/i, "") || "/";
          $n.attr("href", url.href.replace(/AC[0-9a-f]{32}/gi, ""));
          $n.attr("target", "_blank");
          $n.attr("rel", "noopener noreferrer");
        }
      } catch {
        /* drop malformed links */
      }
    }
  });
  return clean($root.html())
    .replace(/<p>\s*(<br>\s*)*<\/p>/g, "")
    .replace(/(<br>\s*)+<\/p>/g, "</p>");
}

/**
 * Split a label/header cell into its bold label and the explanatory description after it,
 * e.g. "ISO code" + "The International Organization for Standardization two character ...".
 */
function cellLabel($, el) {
  const full = clean($(el).text());
  const bold = $(el).find("b, strong").first();
  const label = clean(bold.length ? bold.text() : full)
    .replace(/^\s*-\s*/, "")
    .replace(/DomesticPre-registration/g, "Domestic Pre-registration");
  const description = bold.length && full.startsWith(clean(bold.text())) ? clean(full.slice(clean(bold.text()).length)) : "";
  return { label, description };
}

/**
 * Parse a guideline page.
 * @param {string} html
 * @param {string} url page URL, used to resolve relative links
 * @returns {{ fields: RawField[], descriptions: Record<string, string> }}
 *   descriptions maps "section|row" and "section|column" to the help text Twilio shows under labels.
 */
export function parseGuidelinePage(html, url) {
  const $ = cheerio.load(html);
  /** @type {RawField[]} */
  const fields = [];
  /** @type {Record<string, string>} */
  const descriptions = {};

  // Most pages wrap the tables in section#guideline-tables (sometimes several sections share
  // that id); a few omit the id, so fall back to the pricing tables inside <main>.
  let scope = $("section#guideline-tables");
  if (!scope.find("table").length) scope = $("main").first();

  // Walk headings and tables in document order so untitled tables can borrow the last heading.
  let lastHeading = null;
  scope.find("h2, h3, h4, table").each((_, el) => {
    if (el.tagName !== "table") {
      lastHeading = clean($(el).text()) || lastHeading;
      return;
    }
    const headers = $(el).find("thead th").toArray().map((th) => cellLabel($, th));
    const columns = headers.slice(1);
    const isGrid = columns.some((c) => c.label);
    const section = headers[0]?.label || lastHeading || "Other";
    if (headers[0]?.description) descriptions[`${section}|`] = headers[0].description;
    columns.forEach((c) => c.description && (descriptions[`${section}|${c.label}`] = c.description));

    $(el)
      .find("tbody tr")
      .each((_, tr) => {
        const cells = $(tr).children("td").toArray();
        if (cells.length < 2) return;
        const { label: row, description } = cellLabel($, cells[0]);
        if (!row) return;
        if (description) descriptions[`${section}|${row}`] = description;
        cells.slice(1).forEach((td, i) => {
          fields.push({
            section,
            column: isGrid ? columns[i]?.label || `Column ${i + 1}` : null,
            row,
            text: cellText($, td),
            html: cellHtml($, td, url),
          });
        });
      });
  });

  return { fields, descriptions };
}

/**
 * Parse the country index page (SMS or Voice landing page) into country links.
 * @returns {{ iso: string, name: string, url: string }[]}
 */
export function parseIndexPage(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = new Map();
  $("a.card-icon__overlay").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    const url = new URL(href, baseUrl);
    const m = url.pathname.match(/\/guidelines\/([a-z]{2})\//i);
    if (!m) return;
    const iso = m[1].toUpperCase();
    const label = clean($(a).attr("aria-label") || "");
    const name = label.replace(/\s*\([A-Z]{2}\)\s*$/, "") || iso;
    if (!out.has(iso)) out.set(iso, { iso, name, url: url.href });
  });
  return [...out.values()];
}
