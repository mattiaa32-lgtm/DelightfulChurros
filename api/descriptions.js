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

const SYSTEM = [
  "You label records in a vinyl collection app.",
  "Reply with exactly two short clauses joined by a period, plain text only \u2014",
  "no quotes, no preamble, no markdown, under 160 characters total.",
  "First clause: a concrete fact about the release itself (its place in the",
  "artist's discography, the year, or the label) \u2014 only state something",
  "you're genuinely confident about, and omit it rather than invent a",
  "specific detail you're unsure of.",
  "Second clause: what the album actually sounds like \u2014 mood, energy,",
  "key instrumentation, vocal style."
].join(" ");

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

  /* Small by design: the free tier's per-minute allowance is the binding
     constraint, not the function's time budget. */
  const limit = Math.min(12, Math.max(1, parseInt(body.limit, 10) || 6));

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

    for (const item of chunk) {
      const prompt =
        "Artist: " + item.artist +
        "\nAlbum: " + item.title +
        "\nGenre category (from the collector's own sheet): " + (item.cat || "unknown") +
        "\nRelease year (if known): " + (item.year || "unknown") +
        "\n\nWrite the two-clause description now.";

      const out = await callGemini(apiKey, function () {
        return JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 120, thinkingConfig: { thinkingBudget: 0 } }
        });
      });

      if (!out.ok) {
        /* Out of quota: stop cleanly rather than burning the rest of the
           chunk on calls that will also fail. */
        if (out.status === 429) { quotaHit = out.quota || "rate"; break; }
        continue;                       // a one-off failure: skip this record
      }
      const text = String(out.text || "").replace(/\s+/g, " ").trim();
      if (text) cells.push({ row: item.row, col: 7, value: text.slice(0, 300) });
    }

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
