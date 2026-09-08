# Shelf

A personal vinyl collection app: browse what you own and where it sits on the
shelf, ask what to play, and get daily recommendations for records you don't
own yet.

Data comes from a published Google Sheet, so the collection stays editable in
a spreadsheet rather than in code.

## Layout

```
index.html          markup and script tags
css/app.css         all styling
js/data.js          sheet loading, baked-in fallback copy, API_BASE
js/covers.js        cover art, caching, request throttling
js/gaps.js          what the sheet is missing, and filling it
js/arrivals.js      placing newly synced records on the shelf
js/filing.js        which category lives in which cube
js/connect.js       Discogs connection and syncing
js/shelf.js         the shelf list, search, filters, record detail sheet
js/want.js          wantlist, and noticing when one arrives
js/move.js          moving a single record within its cube
js/discover.js      daily recommendations
js/chat.js          the ask panel, both modes, voice dictation
js/dashboard.js     collection stats and assessment
js/hifi.js          hi-fi setup, signal chain, system evaluation
api/*.js            serverless functions (Vercel)
```

## Deploying

1. Push this folder to a GitHub repo.
2. In Vercel, "Add New… → Project" and import the repo. No build command and
   no framework preset are needed — it's a static site plus `/api` functions.
3. In the project's Settings → Environment Variables, add:
   - `GEMINI_API_KEY` — a key from https://aistudio.google.com
4. Deploy. Every later push to the default branch redeploys automatically.

To verify the backend after deploying:

```
https://<your-app>.vercel.app/api/describe?artist=Can&title=Tago%20Mago
```

A JSON response containing `text` means the key and functions are working.

## The Google Sheet

Publish the sheet to the web as CSV (File → Share → Publish to web → CSV) and
put that link in `SHEET_CSV_URL` at the top of `js/data.js`.

Columns, in order:

| # | Column      | Required | Notes                                        |
|---|-------------|----------|----------------------------------------------|
| A | Artist      | yes      |                                              |
| B | Record name | yes      |                                              |
| C | Category    | yes      | free text; drives the colours and filters     |
| D | Cube        | yes      | 1–4                                          |
| E | Discogs id  | no       | release id; enables exact pressing artwork    |
| F | Cover URL   | no       | manual override / frozen export               |
| G | Description | no       | manual override / frozen export               |
| H | First released | no    | original release year / frozen export         |
| I | Pressing year  | no    | year of your copy / frozen export             |
| J | Position       | no    | explicit shelf order within a cube            |
| K | Rating         | no    | score out of 10, with its reasoning           |
| L | Preferred pressing | no | which pressing is worth owning              |
| M | Pressing score | no    | how good your copy is, with what it is        |
| N | Value          | no    | what a copy is listed at on Discogs           |

Position (J) is consecutive from 1 within each cube. Cube decides the run
order between cubes; within a cube, categories run in the order set on the
Shelf layout screen and records run alphabetically by artist then title, with
leading articles ignored.

Columns F to I are filled automatically at runtime and cached on the device.
The "Freeze resolved covers & descriptions" link on the Shelf tab exports them
so they can be pasted back into the sheet — after that, no lookups are needed
for those rows on any device.

## Offline

`sw.js` is a service worker that caches the app shell and cover art, so the
shelf, search, wantlist and setup all work with no connection. It is
network-first for HTML/CSS/JS, so a deploy always wins over the cache; images
are cache-first since their URLs never change; and `/api/*` is never cached.

When you change any file in `SHELL`, bump `SW_VERSION` in `sw.js` — older
caches are deleted automatically on the next activation.

## Serverless function count

Vercel's Hobby plan allows twelve functions per deployment. Files starting with
`_` are libraries, not routes, and do not count. `api/fill.js` exists because
of this: descriptions, evaluations and values were three routes and are now one,
selected by `mode`.

## Value history

Column N holds each record's CURRENT value. History is kept in two places:

- `Config!value_history` — dated aggregates (total, min, median, max; by cube
  and by category). This is what the chart draws.
- A hidden `Values` tab — one row per record, one column per snapshot date,
  so an individual record's history is readable and chartable in Sheets.

Both are refreshed weekly, automatically, the first time the app opens after a
week has passed. A repeat on the same date replaces that day's point.

## Backups

The app writes to the sheet unattended, so `js/safety.js` takes a dated copy of
the Collection tab once a week (a single hidden `Backup` tab, replaced each
time). Settings → Backup shows when the last copy and the last
successful write happened, and can take one on demand.

## Rate limits

Gemini's free tier allows roughly **10 requests per minute** and ~1,000 per day
across the whole key. The app enforces its own lower ceilings in `js/ai.js`:

- `AI_RPM` (8) — total requests per rolling minute
- `AI_RPM_BG` (5) — background sweeps stop here, leaving room for taps
- `AI_RPD` (900) — daily ceiling across every endpoint

Anything you tap jumps the queue and can preempt a background job that has not
yet sent its request.

**Enabling billing on the Google Cloud project raises the limit to thousands of
requests per minute, and you are not charged unless you exceed the free quota.**
If you do that, `AI_RPM` and `AI_RPM_BG` can be raised a long way and the
sweeps will finish in a fraction of the time.

## Keeping API usage down

The AI is only asked for something once, and the answer is cached on the device:

- **Cover art** — Discogs (exact pressing) then iTunes. Successes *and*
  failures are cached; a record that returns nothing is not retried for 72h.
- **Descriptions** — written into the sheet, 20 per AI request. Once a row
  has one it is never asked for again.
- **Collection assessment** and **category deep dives** — cached against a
  hash of the collection, so they only regenerate when records actually change.
- **System evaluation** — cached against a hash of the gear list.
- **Daily picks** — one call per day, cached per calendar day.
- **Decade drill-down** — no API call at all; computed from local data.

Two safety limits back this up: a hard ceiling of `AI_DAILY_CAP` description
calls per day (in `js/covers.js`), and a halt on the background sweep the
moment the API reports a rate limit, rather than retrying each record.

Google's free tier has both a per-minute and a per-day quota. The app now
reports which one was hit, since the daily one resets at midnight Pacific
rather than in a few minutes.
