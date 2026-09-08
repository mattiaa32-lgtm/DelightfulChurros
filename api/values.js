// Vercel Function: /api/values
//
// Records what the collection is worth, and starts a series.
//
// Discogs gives a price suggestion per release, by condition. That is
// what copies are LISTED at, not what they sell for, and a thin market
// makes any single record noisy — so the per-record number is a rough
// guide and the aggregates are the trustworthy part.
//
// Nothing anywhere can tell you what the collection was worth last year.
// So this stores a dated snapshot each time it runs: min, median and max
// across the collection, by cube and by category. A month from now that
// is a real series; today it is one point, which is the honest starting
// position.
//
// Column N holds each record's current value, so the sheet stays the
// source of truth and the history stays small.
//
// POST { passphrase, limit?, snapshot? }

import { sheetCall, getConfig } from "./_sheet.js";

const UA = "ShelfVinylApp/1.0";
const GAP_MS = 1100;                 // ~55/min, inside Discogs' ceiling

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

function median(xs) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
    const cfg = await getConfig(["discogs_token", "discogs_secret", "discogs_user"]);
    if (!cfg.discogs_token) return res.status(400).json({ error: "Discogs isn't connected" });
    const auth = {
      "Authorization": oauthAuth(cfg.discogs_token, cfg.discogs_secret || ""),
      "User-Agent": UA, "Accept": "application/json"
    };

    const sheet = await sheetCall({ action: "read" });
    const rows = ((sheet && sheet.values) || []).slice(1);

    /* --- take the snapshot from what's already recorded --- */
    if (body.snapshot === true) {
      const vals = [], byCube = {}, byCat = {};
      rows.forEach(function (r) {
        const v = parseFloat(String(r[13] || "").replace(/[^\d.]/g, ""));
        if (!isFinite(v) || v <= 0) return;
        vals.push(v);
        const cube = String(r[3] || "").trim() || "?";
        const cat = String(r[2] || "").trim() || "Uncategorised";
        (byCube[cube] = byCube[cube] || []).push(v);
        (byCat[cat] = byCat[cat] || []).push(v);
      });
      if (!vals.length) return res.status(400).json({ error: "no values recorded yet" });

      const roll = (xs) => ({
        n: xs.length,
        total: +xs.reduce((a, b) => a + b, 0).toFixed(2),
        min: +Math.min.apply(null, xs).toFixed(2),
        median: +median(xs).toFixed(2),
        max: +Math.max.apply(null, xs).toFixed(2)
      });
      const point = {
        date: new Date().toISOString().slice(0, 10),
        all: roll(vals),
        cubes: Object.fromEntries(Object.keys(byCube).map((k) => [k, roll(byCube[k])])),
        cats: Object.fromEntries(Object.keys(byCat).map((k) => [k, roll(byCat[k])]))
      };

      let hist = [];
      try {
        const prev = await sheetCall({ action: "getConfig", key: "value_history" });
        if (prev && prev.value) hist = JSON.parse(prev.value) || [];
      } catch (e) { hist = []; }
      /* One point per day: running it twice in an afternoon should not
         put two dots on the chart. */
      hist = hist.filter(function (p) { return p.date !== point.date; });
      hist.push(point);
      hist = hist.slice(-400);
      await sheetCall({ action: "setConfig", key: "value_history", value: JSON.stringify(hist) });

      /* The aggregates above answer "what is it all worth"; they cannot
         answer "what has THIS record done". So the same snapshot is also
         written per record to a Values tab \u2014 one column per date,
         readable and chartable in the spreadsheet itself. */
      const perRecord = [];
      rows.forEach(function (r) {
        const v = parseFloat(String(r[13] || "").replace(/[^\d.]/g, ""));
        const id = String(r[4] || "").trim();
        if (id && isFinite(v) && v > 0) {
          perRecord.push({ id: id, artist: r[0], title: r[1], value: v });
        }
      });
      let perRecordSaved = 0;
      try {
        const vs = await sheetCall({ action: "valueSnap",
                                     values: perRecord, date: point.date });
        perRecordSaved = (vs && vs.records) || 0;
      } catch (e) { /* aggregates are saved either way */ }

      return res.status(200).json({ ok: true, snapshot: true, point: point,
                                    points: hist.length, perRecord: perRecordSaved });

    }

    /* --- refresh the per-record values --- */
    const todo = [];
    rows.forEach(function (r, i) {
      const id = String(r[4] || "").trim();
      if (id) todo.push({ row: i + 2, id: id, have: String(r[13] || "").trim() });
    });

    /* Oldest first, so repeated runs work round the collection rather
       than redoing the same records. */
    const stale = todo.filter((t) => !t.have).concat(todo.filter((t) => t.have));
    const chunk = stale.slice(0, limit);

    const cells = [];
    let checked = 0, priced = 0;
    for (const item of chunk) {
      checked++;
      try {
        await sleep(GAP_MS);
        const r = await fetch("https://api.discogs.com/marketplace/price_suggestions/" +
                              item.id, { headers: auth });
        if (r.status === 429) break;                  // resume next call
        if (!r.ok) continue;
        const d = await r.json();
        /* Suggestions come per condition; the near-mint figure is the
           fairest single number for a collection that isn't for sale. */
        const pick = d["Near Mint (NM or M-)"] || d["Very Good Plus (VG+)"] ||
                     d["Mint (M)"] || Object.values(d || {})[0];
        const v = pick && pick.value;
        if (isFinite(v) && v > 0) {
          cells.push({ row: item.row, col: 14, value: Math.round(v * 100) / 100 });
          priced++;
        }
      } catch (e) { /* leave it for the next run */ }
    }

    if (cells.length) await sheetCall({ action: "setCells", cells: cells });

    const remaining = Math.max(0, stale.length - checked);
    return res.status(200).json({
      ok: true, checked: checked, priced: priced,
      remaining: remaining, done: remaining === 0
    });
  } catch (err) {
    return res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}
