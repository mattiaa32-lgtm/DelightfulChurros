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

import { sheetCall } from "./_sheet.js";
import { callGemini } from "./_gemini.js";

const BATCH = 12;

const SYSTEM = [
  "You assess records for a serious vinyl collector's own catalogue.",
  "You will be given a numbered list of albums. Assess EVERY one.",
  "",
  "For each, return two things.",
  "",
  "\"rating\": a number from 1 to 10, one decimal place, for the ALBUM \u2014 not",
  "the pressing. Judge lasting significance and quality as the critical and",
  "collector consensus sees it, not personal taste. Use the range honestly:",
  "9+ is reserved for records widely held to be among the greatest; 8-8.9 is",
  "a major, admired work; 7-7.9 is strong; 5-6.9 is ordinary; below 5 is",
  "poorly regarded. Most records are not 8s.",
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
  "Reply with ONLY a JSON object keyed by the number you were given:",
  '{"1":{"rating":8.6,"pressing":"..."},"2":{"rating":6.2,"pressing":"..."}}',
  "Include every number. No markdown fences, no commentary."
].join("\n");

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
  const only = (body.only === "rate" || body.only === "press") ? body.only : null;

  try {
    const sheet = await sheetCall({ action: "read" });
    const rows = ((sheet && sheet.values) || []).slice(1);

    const todo = [];
    rows.forEach(function (r, i) {
      const artist = String(r[0] || "").trim();
      const title = String(r[1] || "").trim();
      const rating = String(r[10] || "").trim();
      const pressing = String(r[11] || "").trim();
      const wantRating = only !== "press" && !rating;
      const wantPressing = only !== "rate" && !pressing;
      if (artist && title && (wantRating || wantPressing)) {
        todo.push({
          row: i + 2, artist, title,
          year: String(r[7] || "").trim(),
          press: String(r[8] || "").trim(),
          haveRating: !!rating || only === "press",
          havePressing: !!pressing || only === "rate"
        });
      }
    });

    if (!todo.length) {
      return res.status(200).json({ ok: true, filled: 0, checked: 0, remaining: 0, done: true });
    }

    const chunk = todo.slice(0, limit);
    const listing = chunk.map(function (it, n) {
      return (n + 1) + ". " + it.artist + " \u2014 " + it.title +
             (it.year ? " (" + it.year + ")" : "") +
             (it.press && it.press !== it.year ? ", copy pressed " + it.press : "");
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
          cells.push({ row: it.row, col: 11, value: num.toFixed(1) });
          wrote = true;
        }
      }
      if (!it.havePressing && v.pressing) {
        const p = String(v.pressing).replace(/\s+/g, " ").trim();
        if (p) { cells.push({ row: it.row, col: 12, value: p.slice(0, 400) }); wrote = true; }
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
