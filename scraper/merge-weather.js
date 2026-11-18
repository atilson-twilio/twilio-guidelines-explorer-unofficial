#!/usr/bin/env node
// Re-merge the Weather Report CSVs in weather-report-data/ into the existing guideline data, without
// re-scraping Twilio's guideline pages. Run this after exporting a fresh copy of the sheet. Writes
// only the local, gitignored files (see output.js); the published data never changes here.
//
// Usage: npm run weather

import { PUBLIC, LOCAL, WEATHER_DIR, readJson, writeOutputs } from "./output.js";
import { loadWeatherReport, mergeWeather, stripWeather, reportWeather } from "./weather.js";

const guidelines = readJson(PUBLIC.dataJson, null);
if (!guidelines) {
  console.error("No data/guidelines.json yet. Run `npm run scrape` first.");
  process.exit(1);
}
const wr = loadWeatherReport(WEATHER_DIR);
if (!wr) {
  console.error("No CSV files in weather-report-data/. Export each tab of the Weather Report sheet as CSV into that folder.");
  process.exit(1);
}
const prev = readJson(LOCAL.dataJson, null);
const merged = mergeWeather(stripWeather(guidelines), wr, { previous: prev });
reportWeather(merged);
const changes = writeOutputs(prev, merged.dataset, LOCAL);
console.log(`Done: ${changes.length} changed values. Wrote ui/data.local.js and data/local/ (local only, gitignored).`);
