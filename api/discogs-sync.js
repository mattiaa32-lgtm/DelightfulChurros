// Vercel Function: /api/discogs-sync
//
// Pulls your Discogs collection and merges it into the sheet.
//
// The rules, in order of importance:
//
//   1. It NEVER deletes a row. A record you own but haven't catalogued
//      on Discogs stays on your shelf. A record removed from Discogs is
//      reported, not removed here.
//   2. It NEVER overwrites something you set. Category, cube, position
//      and description are yours; the sync only ever fills blanks.
//   3. New releases are appended with artist, title, id, cover and
//      pressing year filled, and category/cube left empty so they show
//      up as needing filing.
//
// Matching is on the Discogs release id where present, falling back to
// artist + title so rows added by hand still match.
//
// POST { passphrase, dryRun? }
// Owner only. dryRun reports what would change without writing.

import { sheetCall } from "./_sheet.js";
import { suggestCategory } from "./_categorise.js";

const UA = "ShelfVinylApp/1.0";

function ownerOK(given) {
  const owner = process.env.OWNER_PASSPHRASE;
  if (!owner) return false;
  const a = String(given || ""), b = String(owner);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function oauthAuth(token, tokenSecret) {
  const f = {
    oauth_consumer_key: process.env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: Math.random().toString(36).slice(2) + Date.now(),
    oauth_signature_method: "PLAINTEXT",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    oauth_token: token,
    oauth_signature: process.env.DISCOGS_CONSUMER_SECRET + "&" + tokenSecret
  };
  return "OAuth " + Object.keys(f)
    .map((k) => k + '="' + encodeURIComponent(f[k]) + '"').join(", ");
}

const norm = (s) => String(s == null ? "" : s)
  .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) { return res.status(400).json({ error: "bad JSON body" }); }

  if (!ownerOK(body.passphrase)) {
    return res.status(403).json({ error: "not unlocked for editing" });
  }

  try {
    const token = (await sheetCall({ action: "getConfig", key: "discogs_token" })).value;
    const secret = (await sheetCall({ action: "getConfig", key: "discogs_secret" })).value;
    const user = (await sheetCall({ action: "getConfig", key: "discogs_user" })).value;
    if (!token || !user) {
      return res.status(400).json({ error: "Discogs isn't connected" });
    }

    // ---- 1. the whole collection, a page at a time ----
    const items = [];
    let page = 1, pages = 1;
    while (page <= pages && page <= 40) {          // 40 x 100 = 4,000 records
      const r = await fetch("https://api.discogs.com/users/" +
        encodeURIComponent(user) + "/collection/folders/0/releases" +
        "?per_page=100&sort=added&sort_order=desc&page=" + page, {
        headers: { "Authorization": oauthAuth(token, secret || ""),
                   "User-Agent": UA, "Accept": "application/json" }
      });
      if (!r.ok) {
        const t = await r.text();
        return res.status(r.status === 429 ? 429 : 502)
          .json({ error: "Discogs refused the collection request", detail: t.slice(0, 200) });
      }
      const d = await r.json();
      (d.releases || []).forEach(function (rel) {
        const b = rel.basic_information || {};
        const artist = ((b.artists || [])[0] || {}).name || "";
        items.push({
          id: String(b.id || ""),
          artist: String(artist).replace(/\s*\(\d+\)$/, "").trim(),
          title: String(b.title || "").trim(),
          year: b.year ? String(b.year) : "",
          cover: b.cover_image || b.thumb || "",
          /* genres and styles were being thrown away; they are what
             makes a sensible category suggestion possible */
          tags: (b.genres || []).concat(b.styles || []),
          masterId: b.master_id ? String(b.master_id) : ""
        });
      });
      pages = (d.pagination && d.pagination.pages) || 1;
      page++;
    }

    // ---- 2. what's already in the sheet ----
    const sheet = await sheetCall({ action: "read" });
    const values = (sheet && sheet.values) || [];
    const header = values[0] || [];
    const rows = values.slice(1);

    const byId = {}, byName = {};
    rows.forEach(function (r, i) {
      const rowNum = i + 2;                        // 1-based, past the header
      const id = String(r[4] || "").trim();
      if (id) byId[id] = { row: rowNum, r: r };
      const k = norm(r[0]) + "|" + norm(r[1]);
      if (k !== "|") byName[k] = { row: rowNum, r: r };
    });

    // ---- 3. work out the changes ----
    /* Suggestions must come from the user's own categories, so they are
       read from the sheet. If the sheet has none yet (a fresh import),
       the client sends its list instead. */
    const catSet = {};
    rows.forEach(function (r) {
      const c = String(r[2] || "").trim();
      if (c) catSet[c] = true;
    });
    let cats = Object.keys(catSet);
    if (!cats.length && Array.isArray(body.categories)) cats = body.categories;

    let suggested = 0;
    const cells = [];            // fills for existing rows
    const newRows = [];          // records not in the sheet at all
    const seen = {};
    let filledCover = 0, filledYear = 0;

    items.forEach(function (it) {
      const hit = (it.id && byId[it.id]) ||
                  byName[norm(it.artist) + "|" + norm(it.title)];
      if (hit) {
        seen[hit.row] = true;
        const r = hit.r;
        // fill blanks only, never overwrite
        if (!String(r[4] || "").trim() && it.id) {
          cells.push({ row: hit.row, col: 5, value: it.id });
        }
        if (!String(r[5] || "").trim() && it.cover) {
          cells.push({ row: hit.row, col: 6, value: it.cover }); filledCover++;
        }
        if (!String(r[8] || "").trim() && it.year) {
          cells.push({ row: hit.row, col: 9, value: it.year }); filledYear++;
        }
        /* a row imported before suggestions existed, still uncategorised */
        if (!String(r[2] || "").trim()) {
          const cat = suggestCategory(it.tags, cats, it.artist);
          if (cat) { cells.push({ row: hit.row, col: 3, value: cat }); suggested++; }
        }
      } else {
        /* Category is a SUGGESTION; cube is deliberately left blank, and
           that blank is what marks the record as still needing review. */
        const cat = suggestCategory(it.tags, cats, it.artist);
        if (cat) suggested++;
        // artist, title, category, cube, id, cover, description, first, pressing, position
        newRows.push([it.artist, it.title, cat, "", it.id, it.cover, "", "", it.year, ""]);
      }
    });

    // in the sheet but no longer in Discogs — reported, never touched
    const orphans = [];
    rows.forEach(function (r, i) {
      if (!seen[i + 2] && String(r[0] || "").trim()) {
        orphans.push({ row: i + 2, artist: r[0], title: r[1] });
      }
    });

    const summary = {
      collection: items.length,
      inSheet: rows.length,
      toAdd: newRows.length,
      toFill: cells.length,
      filledCover: filledCover,
      filledYear: filledYear,
      suggested: suggested,
      notInDiscogs: orphans.length,
      orphans: orphans.slice(0, 20),
      sample: newRows.slice(0, 8).map(function (r) { return r[0] + " \u2014 " + r[1]; })
    };

    if (body.dryRun === true) {
      return res.status(200).json(Object.assign({ ok: true, dryRun: true }, summary));
    }

    // ---- 4. write ----
    if (cells.length) {
      // batched so a large sync isn't hundreds of round trips
      for (let i = 0; i < cells.length; i += 200) {
        await sheetCall({ action: "setCells", cells: cells.slice(i, i + 200) });
      }
    }
    /* In blocks rather than one request per record: a full import used
       to be hundreds of sequential round trips and timed out partway,
       leaving the sheet half-filled. */
    for (let i = 0; i < newRows.length; i += 150) {
      await sheetCall({ action: "appendRows", rows: newRows.slice(i, i + 150) });
    }

    await sheetCall({ action: "setConfig", key: "last_sync",
                      value: new Date().toISOString() });

    return res.status(200).json(Object.assign({ ok: true }, summary));
  } catch (err) {
    return res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}
