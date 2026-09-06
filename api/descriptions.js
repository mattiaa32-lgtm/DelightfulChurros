// Vercel Function: /api/descriptions
//
// Writes the short "what it sounds like" line into column G.
//
// Descriptions used to resolve into whichever browser happened to be
// open and stayed there, which meant they existed on one device and had
// to be copy-pasted into the sheet by hand. This puts them where every
// other field already lives.
//
// Resumable and small-batched, because these are the one thing here
// that costs AI quota: the free tier allows only a few requests a
// minute, so a chunk is deliberately modest and the client keeps
// calling. Everything written stays written, so stopping is free.
//
// POST { passphrase, limit? }
// -> { ok, filled, checked, remaining, done, quota? }

import { sheetCall } from "./_sheet.js";
import { callGemini } from "./_gemini.js";

/* One request per record was the wrong shape entirely. The free tier
   limits REQUESTS, not words, so asking for one description at a time
   spent the whole allowance on overhead: a couple of dozen records and
   the quota was gone. Describing twenty per request buys roughly twenty
   times as many records for the same quota, and is far faster besides. */
const BATCH = 20;

const SYSTEM = [
  "You label records in a vinyl collection app.",
  "You will be given a numbered list of albums. Describe EVERY one.",
  "",
  "For each album write exactly two short clauses joined by a period:",
  "first a concrete fact about the release (its place in the artist's",
  "discography, the year, or the label) \u2014 state only what you are",
  "genuinely confident about, and omit it rather than invent a detail;",
  "then what the album actually sounds like \u2014 mood, energy, key",
  "instrumentation, vocal style. Under 160 characters each.",
  "",
  "Reply with ONLY a JSON object mapping each number to its description,",
  "no markdown fences and no commentary:",
  '{"1":"...","2":"...","3":"..."}',
  "Include every number you were given. If you genuinely do not know an",
  "album, give the sound description alone rather than inventing facts."
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

  /* How many records to describe in ONE request. Larger means fewer
     requests against the quota, at the cost of a longer reply. */
  const limit = Math.min(40, Math.max(1, parseInt(body.limit, 10) || BATCH));

  try {
    const sheet = await sheetCall({ action: "read" });
    const rows = ((sheet && sheet.values) || []).slice(1);

    const todo = [];
    rows.forEach(function (r, i) {
      const artist = String(r[0] || "").trim();
      const title = String(r[1] || "").trim();
      const desc = String(r[6] || "").trim();
      if (artist && title && !desc) {
        todo.push({ row: i + 2, artist, title, cat: String(r[2] || "").trim(),
                    year: String(r[7] || r[8] || "").trim() });
      }
    });

    if (!todo.length) {
      return res.status(200).json({ ok: true, filled: 0, checked: 0, remaining: 0, done: true });
    }

    const chunk = todo.slice(0, limit);
    const cells = [];
    let quotaHit = null;

    /* Numbered so the reply can be mapped back to rows unambiguously \u2014
       matching on titles would break on near-duplicates. */
    const listing = chunk.map(function (it, n) {
      return (n + 1) + ". " + it.artist + " \u2014 " + it.title +
             (it.cat ? "  [" + it.cat + "]" : "") +
             (it.year ? "  (" + it.year + ")" : "");
    }).join("\n");

    const out = await callGemini(apiKey, function () {
      return JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text:
          "Describe these " + chunk.length + " albums:\n\n" + listing }] }],
        generationConfig: {
          maxOutputTokens: 120 * chunk.length + 400,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 }
        }
      });
    });

    if (!out.ok) {
      if (out.status === 429) {
        return res.status(200).json({
          ok: true, filled: 0, checked: 0,
          remaining: todo.length, done: true,
          quota: out.quota || "rate"
        });
      }
      return res.status(502).json({ error: "the model refused", detail: out.detail });
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

    chunk.forEach(function (it, n) {
      const v = parsed[String(n + 1)] || parsed[n + 1];
      if (!v) return;
      const text = String(v).replace(/\s+/g, " ").trim();
      if (text) cells.push({ row: it.row, col: 7, value: text.slice(0, 300) });
    });

    if (cells.length) {
      await sheetCall({ action: "setCells", cells: cells });
    }

    const remaining = Math.max(0, todo.length - cells.length);
    return res.status(200).json({
      ok: true,
      filled: cells.length,
      checked: chunk.length,
      remaining: remaining,
      done: remaining === 0 || !!quotaHit,
      quota: quotaHit
    });
  } catch (err) {
    return res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}
