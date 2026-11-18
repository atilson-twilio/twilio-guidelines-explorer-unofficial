// Polite HTTP fetching: limited concurrency, retries with backoff, identifiable user agent.

const USER_AGENT =
  "Mozilla/5.0 (compatible; twilio-guidelines-ui/1.0; +https://www.twilio.com/en-us/guidelines)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch a URL as text, retrying on network errors and 429/5xx responses. */
export async function fetchText(url, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, redirect: "follow" });
      if (res.ok) return { html: await res.text(), finalUrl: res.url };
      if (res.status !== 429 && res.status < 500) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err.fatal || attempt >= retries) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/** Run an async worker over items with at most `concurrency` in flight. Results keep input order. */
export async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}
