// Vercel Function: /api/evaluate
//
// Fills two columns:
//   K  Rating    a score out of 10 for the album itself
//   L  Pressing  which pressing is worth owning, and why
//
// On the score being stable: it is computed ONCE and written to the
// sheet, so it never changes afterwards — that, not the model settings,
// is what stops it drifting. Temperature is pinned to 0 and a fixed seed
// sent so the first computation is as deterministic as the API allows,
// but the durable answer is that a filled cell is never recomputed.
//
// On the pressing: for well-documented releases there is real consensus
// about which cut to look for. For plenty of records there isn't, and
// the prompt says so explicitly rather than inventing a recommendation.
//
// Batched the same way as descriptions: the free tier limits requests,
// not words, so one request covers a dozen records.
//
// POST { passphrase, limit? }
// -> { ok, filled, checked, remaining, done, quota? }

import { sheetCall, getConfig } from "./_sheet.js";
import { callGemini } from "./_gemini.js";

const BATCH = 12;

const SYSTEM = [
  "You assess records for a serious vinyl collector's own catalogue.",
  "You will be given a numbered list of albums. Assess EVERY one.",
  "",
  "For each, return these things.",
  "",
  "\"rating\": a number from 1 to 10, one decimal place, for the ALBUM \u2014 not",
  "the pressing. Judge lasting significance and quality as the critical and",
  "collector consensus sees it, not personal taste. Use the range honestly:",
  "9+ is reserved for records widely held to be among the greatest; 8-8.9 is",
  "a major, admired work; 7-7.9 is strong; 5-6.9 is ordinary; below 5 is",
  "poorly regarded. Most records are not 8s.",
  "",
  "\"why\": one short sentence justifying that rating \u2014 what the record did,",
  "or where it sits in the artist's work, or why it is held in that regard.",
  "This is shown beside the number: a score with no argument behind it is",
  "exactly what makes a score untrustworthy.",
  "",
  "\"pressing\": one or two sentences on which pressing is worth owning \u2014 an",
  "original on a named label, a particular respected reissue, a mastering to",
  "seek out or avoid. Name what a person can actually search for. Do NOT",
  "invent catalogue numbers or matrix codes.",
  "IMPORTANT: if there is no meaningful consensus about pressings for this",
  "record, say exactly that in plain words \u2014 for example \"No pressing is",
  "particularly sought after; any clean copy is fine.\" An honest \"nothing to",
  "note\" is far more useful than an invented recommendation.",
  "",
  "CONSISTENCY: the owned score and the pressing recommendation are shown",
  "side by side, so they must agree. If their copy IS the pressing you would",
  "recommend, say so and score it high \u2014 do not recommend a pressing they",
  "already own as though they lacked it. If Discogs gives no reissue or",
  "repress marking and the year matches the original release, treat it as an",
  "original rather than assuming a later repress. Where the details genuinely",
  "do not settle which pressing it is, say that plainly instead of inventing",
  "a provenance.",
  "",
  "Reply with ONLY a JSON object keyed by the number you were given:",
  '"owned": a score 0-10 for the pressing THEY OWN, given the label, catalogue',
  '          number and year supplied with it, then one sentence on what makes',
  '          that pressing good or unremarkable \u2014 mastering, plant, era,',
  '          scarcity. An original in a good year scores high; a competent',
  '          modern repress is middling; a thin-sounding budget reissue is low.',
  '          If the pressing details are unknown, return null rather than',
  '          guessing.',
  "",
  "Reply with ONLY a JSON object keyed by the numbers you were given:",
  '{"1":{"rating":8.6,"why":"...","pressing":"...","owned":{"score":9.1,"why":"..."}},',
  '  "2":{"rating":6.2,"why":"...","pressing":"...","owned":{"score":5.0,"why":"..."}}}',
  "Include every number. No markdown fences, no commentary."
].join("\n");

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

function ownerOK(given) {
  const owner = process.env.OWNER_PASSPHRASE;
  if (!owner) return false;
  const a = String(given || ""), b = String(owner);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  const limit = Math.min(25, Math.max(1, parseInt(body.limit, 10) || BATCH));
  /* "rate" or "press" fills just that column; anything else fills both.
     They are separate choices: a score and pressing research are
     different questions, and you may want one without the other. */
  const only = ["rate","press","owned"].indexOf(body.only) > -1 ? body.only : null;

  try {
    const sheet = await sheetCall({ action: "read" });
    const rows = ((sheet && sheet.values) || []).slice(1);

    const todo = [];
    rows.forEach(function (r, i) {
      const artist = String(r[0] || "").trim();
      const title = String(r[1] || "").trim();
      const rating = String(r[10] || "").trim();
      const pressing = String(r[11] || "").trim();
      const owned = String(r[12] || "").trim();          // column M
      const wantRating = only !== "press" && !rating;
      const wantPressing = only !== "rate" && !pressing;
      const wantOwned = only !== "rate" && only !== "press" && !owned;
      if (artist && title && (wantRating || wantPressing || wantOwned)) {
        todo.push({
          row: i + 2, artist, title,
          year: String(r[7] || "").trim(),
          press: String(r[8] || "").trim(),
          id: String(r[4] || "").trim(),
          haveRating: !!rating || only === "press",
          havePressing: !!pressing || only === "rate",
          haveOwned: !!owned || only === "rate" || only === "press"
        });
      }
    });

    if (!todo.length) {
      return res.status(200).json({ ok: true, filled: 0, checked: 0, remaining: 0, done: true });
    }

    /* What pressing do they actually own? The collection listing carries
       the label and catalogue number of the exact release, so this part
       is fact rather than inference \u2014 only the judgement of it comes
       from the model. One paginated pass covers the whole collection. */
    let pressingOf = {};
    if (only !== "rate" && only !== "press") {   /* identity needed for the owned score */
      try {
        const cfg = await getConfig(["discogs_token", "discogs_secret", "discogs_user"]);
        if (cfg.discogs_token && cfg.discogs_user) {
          const auth = {
            "Authorization": oauthAuth(cfg.discogs_token, cfg.discogs_secret || ""),
            "User-Agent": "ShelfVinylApp/1.0", "Accept": "application/json"
          };
          let page = 1, pages = 1;
          while (page <= pages && page <= 40) {
            const r = await fetch("https://api.discogs.com/users/" +
              encodeURIComponent(cfg.discogs_user) +
              "/collection/folders/0/releases?per_page=100&page=" + page,
              { headers: auth });
            if (!r.ok) break;
            const d = await r.json();
            (d.releases || []).forEach(function (rel) {
              const b = rel.basic_information || {};
              const lab = (b.labels || [])[0] || {};
              if (!b.id) return;
              /* A catalogue number alone does not identify a pressing:
                 PCS 7009 covers the 1966 first press and every repress
                 since. Discogs' format descriptors are what separate
                 them \u2014 "Reissue", "Repress", "Stereo", "Mono" \u2014 so
                 they have to be sent too, along with the country. */
              const fmt = (b.formats || [])[0] || {};
              const descs = (fmt.descriptions || []).join(", ");
              pressingOf[String(b.id)] = [
                b.country || "",
                lab.name || "",
                lab.catno || "",
                b.year ? String(b.year) : "",
                descs
              ].filter(Boolean).join(" \u00b7 ");
            });
            pages = (d.pagination && d.pagination.pages) || 1;
            page++;
          }
        }
      } catch (e) { pressingOf = {}; }
    }

    const chunk = todo.slice(0, limit);
    const listing = chunk.map(function (it, n) {
      /* The copy they own, identified from Discogs — label, catalogue
         number and year. This is what the owned-pressing score is
         judged against, so it has to reach the model. */
      var owned = (it.id && pressingOf[it.id]) || "";
      return (n + 1) + ". " + it.artist + " \u2014 " + it.title +
             (it.year ? " (" + it.year + ")" : "") +
             "\n   their copy: " + (owned || "unknown");
    }).join("\n");

    const out = await callGemini(apiKey, function () {
      return JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text:
          "Assess these " + chunk.length + " albums:\n\n" + listing }] }],
        generationConfig: {
          maxOutputTokens: 180 * chunk.length + 400,
          temperature: 0,        /* as repeatable as the API allows */
          seed: 7,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 }
        }
      });
    });

    if (!out.ok) {
      if (out.status === 429) {
        return res.status(200).json({
          ok: true, filled: 0, checked: 0,
          remaining: todo.length, done: true, quota: out.quota || "rate"
        });
      }
      return res.status(502).json({
        error: "the model refused the request",
        detail: out.detail, model: out.model || null
      });
    }

    let parsed = null;
    try {
      parsed = JSON.parse(String(out.text || "").replace(/```json/gi, "").replace(/```/g, "").trim());
    } catch (e) { parsed = null; }
    if (!parsed) {
      return res.status(502).json({
        error: "unparseable reply",
        detail: String(out.text || "").slice(0, 200)
      });
    }

    const cells = [];
    let filled = 0;
    chunk.forEach(function (it, n) {
      const v = parsed[String(n + 1)] || parsed[n + 1];
      if (!v) return;
      let wrote = false;
      if (!it.haveRating && v.rating !== undefined && v.rating !== null) {
        const num = Number(v.rating);
        if (isFinite(num) && num > 0 && num <= 10) {
          /* score and reasoning in one cell, separated by an em dash \u2014
             the app splits on it to show the number large and the
             argument beside it */
          const why = String(v.why || "").replace(/\s+/g, " ").trim();
          cells.push({ row: it.row, col: 11,
                       value: num.toFixed(1) + (why ? " \u2014 " + why : "") });
          wrote = true;
        }
      }
      if (!it.havePressing && v.pressing) {
        const p = String(v.pressing).replace(/\s+/g, " ").trim();
        if (p) { cells.push({ row: it.row, col: 12, value: p.slice(0, 400) }); wrote = true; }
      }
      if (!it.haveOwned && v.owned && v.owned.score !== undefined && v.owned.score !== null) {
        const n2 = Number(v.owned.score);
        if (isFinite(n2) && n2 >= 0 && n2 <= 10) {
          const ident = (it.id && pressingOf[it.id]) || "";
          const why2 = String(v.owned.why || "").replace(/\s+/g, " ").trim();
          /* score, what the pressing IS, then why it's worth that \u2014 the
             identity is Discogs' fact, only the judgement is the model's */
          cells.push({ row: it.row, col: 13, value:
            n2.toFixed(1) + (ident ? " \u2014 " + ident : "") +
            (why2 ? " \u2014 " + why2 : "") });
          wrote = true;
        }
      }
      if (wrote) filled++;
    });

    if (cells.length) await sheetCall({ action: "setCells", cells: cells });

    const remaining = Math.max(0, todo.length - filled);
    return res.status(200).json({
      ok: true, filled: filled, checked: chunk.length,
      remaining: remaining, done: remaining === 0
    });
  } catch (err) {
    return res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}
