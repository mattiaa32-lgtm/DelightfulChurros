// Vercel Function: /api/discogs-years
//
// Fills column H, the year the album FIRST came out, from the Discogs
// master release. Column I already holds the pressing year, which comes
// free with the collection; the master is what tells you a 2015 repress
// is really a 1971 record.
//
// Deliberately resumable. Roughly one master lookup per record, at
// Discogs' 60/minute authenticated limit, is minutes of work for a
// decent collection — well past what one serverless invocation gets.
// So each call does a bounded chunk and reports what's left, and the
// client keeps calling until it's done. Anything already written stays
// written, so an interruption costs nothing.
//
// POST { passphrase, limit? }
// -> { ok, filled, remaining, done, checked }

import { sheetCall } from "./_sheet.js";

const UA = "ShelfVinylApp/1.0";
const GAP_MS = 1100;          // ~55/min, just inside Discogs' ceiling

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function yearFrom(d) {
  if (!d) return "";
  if (d.year) return String(d.year);
  const m = /(\d{4})/.exec(String(d.released || d.released_formatted || ""));
  return m ? m[1] : "";
}

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

  const limit = Math.min(60, Math.max(1, parseInt(body.limit, 10) || 40));

  try {
    const token = (await sheetCall({ action: "getConfig", key: "discogs_token" })).value;
    const secret = (await sheetCall({ action: "getConfig", key: "discogs_secret" })).value;
    const user = (await sheetCall({ action: "getConfig", key: "discogs_user" })).value;
    if (!token || !user) return res.status(400).json({ error: "Discogs isn't connected" });

    const auth = () => ({
      "Authorization": oauthAuth(token, secret || ""),
      "User-Agent": UA, "Accept": "application/json"
    });

    // ---- which rows still need a first-release year ----
    const sheet = await sheetCall({ action: "read" });
    const rows = ((sheet && sheet.values) || []).slice(1);
    const todo = [];
    rows.forEach(function (r, i) {
      const id = String(r[4] || "").trim();
      const have = String(r[7] || "").trim();
      if (id && !/^\d{4}$/.test(have)) todo.push({ row: i + 2, id: id });
    });

    if (!todo.length) {
      return res.status(200).json({ ok: true, filled: 0, remaining: 0, done: true, checked: 0 });
    }

    /* master_id comes free with the collection listing, so one cheap
       paginated pass avoids a per-record release lookup. */
    const masterOf = {};
    let page = 1, pages = 1;
    while (page <= pages && page <= 40) {
      const r = await fetch("https://api.discogs.com/users/" + encodeURIComponent(user) +
        "/collection/folders/0/releases?per_page=100&page=" + page, { headers: auth() });
      if (!r.ok) break;
      const d = await r.json();
      (d.releases || []).forEach(function (rel) {
        const b = rel.basic_information || {};
        if (b.id) masterOf[String(b.id)] = b.master_id ? String(b.master_id) : "";
      });
      pages = (d.pagination && d.pagination.pages) || 1;
      page++;
    }

    // ---- look up masters for this chunk ----
    const chunk = todo.slice(0, limit);
    const cells = [];
    const masterYear = {};          // cached: pressings share masters
    let checked = 0;

    for (const item of chunk) {
      checked++;
      const mid = masterOf[item.id];

      if (mid && masterYear[mid] !== undefined) {
        if (masterYear[mid]) cells.push({ row: item.row, col: 8, value: masterYear[mid] });
        continue;
      }

      let year = "";
      try {
        if (mid) {
          await sleep(GAP_MS);
          const mr = await fetch("https://api.discogs.com/masters/" + mid, { headers: auth() });
          if (mr.status === 429) break;           // rate limited: stop, resume next call
          if (mr.ok) year = yearFrom(await mr.json());
          masterYear[mid] = year;
        } else {
          /* No master: a standalone release, so its own year IS the
             original. Taken from the sheet's pressing year to avoid
             another request. */
          const r = rows[item.row - 2];
          year = String((r && r[8]) || "").trim();
          if (!/^\d{4}$/.test(year)) year = "";
        }
      } catch (e) { /* leave it for the next run */ }

      if (year) cells.push({ row: item.row, col: 8, value: year });
    }

    if (cells.length) {
      for (let i = 0; i < cells.length; i += 200) {
        await sheetCall({ action: "setCells", cells: cells.slice(i, i + 200) });
      }
    }

    const remaining = Math.max(0, todo.length - checked);
    return res.status(200).json({
      ok: true,
      filled: cells.length,
      checked: checked,
      remaining: remaining,
      done: remaining === 0
    });
  } catch (err) {
    return res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}
