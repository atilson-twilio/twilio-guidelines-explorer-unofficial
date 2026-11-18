#!/usr/bin/env node
// Scrape Twilio's SMS and Voice country guidelines and write data/guidelines.json,
// data/changelog.json and ui/data.js (see output.js). These are published, so they never contain
// Weather Report data. If weather-report-data/ has CSVs, a merged copy goes to the local,
// gitignored data/local/ and ui/data.local.js as well.
//
// Usage: npm run scrape [-- --only GB,US] [--force] [--from-raw file.json] [--save-raw file.json]

import { scrapeRaw, INDEX_URLS } from "./raw.js";
import { normalize } from "./normalize.js";
import { PUBLIC, LOCAL, WEATHER_DIR, readJson, writeFile, writeOutputs, removeLocalOutputs } from "./output.js";
import { fetchHelpArticles, addHelpArticles, carryOverHelpArticles } from "./help.js";
import { loadWeatherReport, mergeWeather, stripWeather, reportWeather } from "./weather.js";

function parseArgs(argv) {
  const args = { force: false, only: null, fromRaw: null, saveRaw: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    else if (a === "--from-raw") args.fromRaw = argv[++i];
    else if (a === "--save-raw") args.saveRaw = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("Usage: npm run scrape [-- --only GB,US] [--force] [--from-raw file] [--save-raw file]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/** Refuse to replace a good dataset with one that looks broken (site redesign, outage, blocking). */
function sanityCheck(prev, next, errors) {
  const problems = [];
  if (!next.countries.length) problems.push("no countries scraped");
  if (prev) {
    if (next.countries.length < prev.countries.length * 0.9)
      problems.push(`country count dropped from ${prev.countries.length} to ${next.countries.length}`);
    if (next.columns.length < prev.columns.length * 0.8)
      problems.push(`column count dropped from ${prev.columns.length} to ${next.columns.length}`);
  }
  if (errors.length > 15) problems.push(`${errors.length} pages failed`);
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  let raw;
  if (args.fromRaw) raw = readJson(args.fromRaw);
  else {
    console.log("Fetching guideline pages from twilio.com ...");
    raw = await scrapeRaw({ only: args.only });
  }
  for (const e of raw.errors) console.warn(`  ! ${e}`);

  const next = normalize(raw.pages, { generatedAt: new Date().toISOString(), sources: INDEX_URLS });
  // Stripping is a no-op for current files; it cleans older ones that had the Weather Report merged in.
  const prevFile = readJson(PUBLIC.dataJson, null);
  const prev = prevFile && stripWeather(prevFile);

  // Help Center articles (alphanumeric registration, short code best practices). Not fatal: if the
  // Help Center can't be reached, keep the previous run's links rather than dropping the columns.
  try {
    if (!raw.help) {
      if (args.fromRaw) throw new Error("not in the --from-raw file");
      raw.help = await fetchHelpArticles();
    }
    const { matched, unmatched } = addHelpArticles(next, raw.help);
    console.log(`Help Center: ${Object.entries(matched).map(([id, n]) => `${n} countries for ${id}`).join(", ")}`);
    if (unmatched.length) console.warn(`  ! Help Center articles with no matching country (add to TITLE_ALIASES in scraper/help.js): ${unmatched.join(" | ")}`);
  } catch (err) {
    console.warn(`  ! Help Center articles not updated (${err.message})${carryOverHelpArticles(prev, next) ? "; kept the previous links" : ""}.`);
  }

  if (args.saveRaw) writeFile(args.saveRaw, JSON.stringify(raw));

  if (args.only) {
    // Partial runs are for testing: print a summary and don't touch the saved dataset.
    for (const c of next.countries) console.log(`${c.iso} ${c.name}: ${Object.keys(c.values).length} values`);
    console.log("(--only run: nothing written)");
    return;
  }

  const problems = sanityCheck(prev, next, raw.errors);
  if (problems.length && !args.force) {
    console.error(`Refusing to overwrite data: ${problems.join("; ")}. Re-run with --force to override.`);
    process.exit(1);
  }

  const changes = writeOutputs(prev, next, PUBLIC);

  const wr = loadWeatherReport(WEATHER_DIR);
  if (wr) {
    const prevLocal = readJson(LOCAL.dataJson, null);
    const merged = mergeWeather(next, wr, { previous: prevLocal });
    reportWeather(merged);
    writeOutputs(prevLocal, merged.dataset, LOCAL);
    console.log("Wrote the Weather Report merge to ui/data.local.js and data/local/ (local only, gitignored).");
  } else {
    removeLocalOutputs();
    console.log("No Weather Report CSVs in weather-report-data/; built guideline data only.");
  }

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  const voice = next.countries.filter((c) => c.urls.voice).length;
  console.log(
    `Done in ${secs}s: ${next.countries.length} countries (${voice} with voice), ${next.columns.length} columns, ` +
      `${prev ? `${changes.length} changed values since ${prev.generatedAt.slice(0, 10)}` : "first run"}.`,
  );
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
