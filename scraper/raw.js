// Step 1 of the scrape: download every SMS, Voice and Porting country page and parse its tables.

import { fetchText, mapLimit } from "./fetch.js";
import { parseGuidelinePage, parseIndexPage } from "./parse.js";

export const INDEX_URLS = {
  sms: "https://www.twilio.com/en-us/guidelines/sms",
  voice: "https://www.twilio.com/en-us/guidelines/voice",
  porting: "https://www.twilio.com/en-us/guidelines/porting",
};

/**
 * @param {{ concurrency?: number, only?: string[], log?: (msg: string) => void }} opts
 * @returns {Promise<{ pages: { channel: string, iso: string, name: string, url: string, fields: import("./parse.js").RawField[], descriptions: Record<string, string> }[], errors: string[] }>}
 */
export async function scrapeRaw({ concurrency = 4, only, log = console.log } = {}) {
  const jobs = [];
  for (const [channel, indexUrl] of Object.entries(INDEX_URLS)) {
    const { html } = await fetchText(indexUrl);
    let countries = parseIndexPage(html, indexUrl);
    if (!countries.length) throw new Error(`No countries found on ${indexUrl}; the page layout may have changed.`);
    if (only?.length) countries = countries.filter((c) => only.includes(c.iso));
    log(`${channel}: ${countries.length} countries`);
    for (const c of countries) jobs.push({ channel, ...c });
  }

  const errors = [];
  let done = 0;
  const pages = await mapLimit(jobs, concurrency, async (job) => {
    try {
      const { html, finalUrl } = await fetchText(job.url);
      const { fields, descriptions } = parseGuidelinePage(html, finalUrl);
      if (!fields.length) {
        errors.push(`${job.channel} ${job.iso}: no guideline tables found (${job.url})`);
        return null;
      }
      return { ...job, url: finalUrl, fields, descriptions };
    } catch (err) {
      errors.push(`${job.channel} ${job.iso}: ${err.message}`);
      return null;
    } finally {
      if (++done % 25 === 0 || done === jobs.length) log(`  fetched ${done}/${jobs.length}`);
    }
  });

  return { pages: pages.filter(Boolean), errors };
}
