# Twilio SMS & Voice Guidelines Explorer

A searchable, filterable table of Twilio's per-country [SMS](https://www.twilio.com/en-us/guidelines/sms),
[Voice](https://www.twilio.com/en-us/guidelines/voice) and [Porting](https://www.twilio.com/en-us/guidelines/porting)
guidelines, for answering questions like *"which
countries can we reach by SMS or voice from out-of-country numbers?"*

If you have access to Twilio's internal **Weather Report** sheet (phone number, porting, short code and
alphanumeric sender ID availability, with list prices), you can optionally merge it into your **local copy**.
That data is never committed or published: this repository contains only what's on
Twilio's public guideline pages. See [Add the Weather Report (local only)](#add-the-weather-report-local-only).

## Use it

**Download this repository** (green **Code** button → **Download ZIP**, or `git clone`), unzip it, and
**open `ui/index.html` in a browser.** That's it: no install or server, and it works offline. The data is
built in (see the scrape date at the top of the page).

- **Saved views** (top buttons) answer common questions, e.g. *SMS from out-of-country numbers* or
  *Voice from out-of-country numbers*.
- **Search** (`/` to focus) looks through every field, including long notes that aren't currently shown.
  Use quotes for phrases: `"verified caller id"`. When a match is in a hidden column, the row says where,
  with a link to show it.
- **Country lists**: paste or type several countries separated by commas, semicolons, tabs or new lines
  (e.g. a column copied from a spreadsheet) to show just those. Names, ISO codes and common aliases
  (USA, UK, UAE, Czechia…) all work; anything not recognised is listed next to the row count.
- **Column filters**: click ⏷ in a header to filter by status (Supported / Limited / Not supported …) or
  by text. The counts show how many countries each choice leaves.
- **Sort** by clicking a header. Click a **cell** for its full text and a link to Twilio's page. Click a
  **country** for everything Twilio publishes about it.
- **Compare**: tick 2 or more countries, then choose *Compare side by side*. Differences are highlighted.
- **Columns**: add any of the ~95 available fields.
- **Export CSV** downloads exactly what's on screen. **Copy link** copies a URL that reopens the current view.
- **Changes** lists what changed in Twilio's text between scrapes. Changed cells are outlined.
- **Porting**: *Porting requirements* shows Twilio's porting guidelines (28 countries) in full. For porting cells,
  the "more info" links go to the porting guideline page, then the country's porting FAQ on help.twilio.com
  (found automatically from the porting page).

With the Weather Report merged locally, you also get:

- **Weather Report columns** (green group header), next to the matching guideline column. A **dashed
  orange outline** means the two sources disagree. **The Weather Report wins**: the guideline column then shows
  the Weather Report's answer, marked *per Weather Report*, with the guideline page's text in the cell details.
  The same happens where the guideline page has no answer. Status changes in the last 90 days are noted under
  the badge.
- Three extra saved views: *Phone numbers*, *Number porting* (porting status by number type) and *Guidelines vs
  Weather Report* (every disagreement). Porting cells also link to the regulatory requirements page.

> Status badges (✓ / ! / ✕) are derived automatically from Twilio's wording and are a reading aid only.
> Twilio's linked guideline page is always the authoritative source.

## Refresh the data

Requires Node.js 18 or newer.

```sh
npm install
npm run scrape        # ~2 minutes; rewrites ui/data.js and data/
```

### Add the Weather Report (local only)

The Weather Report is an internal Twilio Google Sheet. It is read from CSV exports rather than the Google API,
and kept out of git: `weather-report-data/`, `data/local/` and `ui/data.local.js` are all in `.gitignore`.

1. In the sheet, for each of the 4 tabs: **File → Download → Comma-separated values (.csv)**.
2. Put the files in `weather-report-data/` (any file names work; tabs are recognised by their columns).
3. Run `npm run weather` to merge them in a second, without re-scraping. `npm run scrape` also merges whatever
   is in that folder.

The merge writes `ui/data.local.js` (loaded by `ui/index.html` in place of `ui/data.js`) and `data/local/`.
The published `ui/data.js` and `data/*.json` are never touched by it. Remove the CSVs and run `npm run scrape`
to go back to the public data; the local files are deleted.

The merge prints any Weather Report country it couldn't match to a guideline page; add spellings to
`COUNTRY_ALIASES` in [scraper/weather.js](scraper/weather.js). Status mapping: GA / API & Console / Standard
Porting / Pre-registration → supported; Private Offering / Beta / By request through Sales / Custom Porting /
Paused → limited; Not Available / Unavailable → not supported. A country missing from a tab shows as *Not listed*.
Prices are Twilio list prices as written in the sheet (decimal commas converted to points).

### Scrape options

Options: `npm run scrape -- --only GB,US` makes a quick test run that writes nothing. `--force` overrides the
safety check, which refuses to overwrite good data if a scrape returns far fewer countries or columns than
the last one (e.g. after a Twilio site redesign).

### Automatic weekly refresh

[.github/workflows/refresh.yml](.github/workflows/refresh.yml) re-scrapes every Monday and commits any changes,
so the data in the repository stays current: download or `git pull` to get the latest. You can also run it any
time from the Actions tab. It needs **Settings → Actions → General → Workflow permissions: Read and write**.
The workflow fails rather than commit if the data contains any Weather Report fields.

## Customise

- **Saved views:** edit [ui/presets.js](ui/presets.js). Hover a column in the Columns picker to see its id.
- **Look and feel:** [ui/styles.css](ui/styles.css). Colours are CSS variables at the top, and dark mode
  follows the OS setting.
- **App behaviour:** [ui/app.js](ui/app.js). Plain JavaScript with no framework or build step.

## How it works

```
scraper/
  raw.js        fetches the SMS, Voice and Porting index pages, then every country page (4 at a time, with retries)
  parse.js      turns each page's tables into { section, column, row, text, html } fields
  normalize.js  merges SMS + Voice + Porting per country (and finds each porting FAQ link), standardises names, classifies each value's status, diffs runs
  weather.js    reads the Weather Report CSVs, adds wr.* columns and cross-checks them against the guidelines
  output.js     writes the files below and records changes
  scrape.js     entry point for `npm run scrape`
  merge-weather.js  entry point for `npm run weather`
weather-report-data/  (local only) CSV exports of the Weather Report sheet's tabs
data/
  guidelines.json  the normalized dataset (handy for other tools)
  changelog.json   value-level changes detected on each run
  local/           (local only) the same two files with the Weather Report merged in
ui/
  index.html, app.js, styles.css, presets.js
  data.js          generated: window.GUIDELINES = { columns, countries, changelog }
  data.local.js    (local only) generated: the same, with the Weather Report merged in
```

Each column has an id such as `voice.callerid.outbound.international` (channel · table · sub-column · row).
Weather Report columns use the channel `wr` (e.g. `wr.shortcode.availability`, `wr.numbers.mobile.list-price`).
A column's `compare` names the column in the other source that answers the same question, and each country's
`conflicts` lists the cells where the two disagree.
Each value keeps Twilio's text (`t`), lightly sanitised HTML when it contains links or lists (`h`), and a status
(`s`): `yes`, `limited`, `notRequired`, `required`, `no`, `info` (free text) or `na` (blank / N/A).

The scraper uses only the public guideline pages, with a low request rate. If Twilio changes the page
layout, the scrape will fail its safety check rather than publish bad data. Start debugging in `parse.js`.
