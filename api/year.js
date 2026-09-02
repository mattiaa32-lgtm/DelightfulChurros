// Vercel Function: /api/year
// Last-resort lookup for an album's ORIGINAL release year, using Gemini
// with Google Search grounding so the answer comes from the web rather
// than the model's recollection. Only called for records that Discogs
// and MusicBrainz both failed to resolve, so volume is low.
//
// GET /api/year?artist=...&title=...
// -> { year: "1971", source: "https://..." }  or  { year: null }

import { callGemini } from "./_gemini.js";

/* Model choice now lives in _gemini.js: quotas are per model, so a
   request refused by one is retried against the next. */

const SYSTEM = [
  "You find the ORIGINAL release year of a music album \u2014 the year the album",
  "first came out, not the year of a reissue, remaster or repress.",
  "Search the web to confirm before answering.",
  "Reply with ONLY a JSON object, no markdown fences:",
  '{"year":"1971"}  or  {"year":null} if you genuinely cannot establish it.',
  "The year must be four digits. Never guess: if sources disagree or you",
  "cannot find the album, return null rather than an invented year."
].join("\n");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  const params = req.query || {};
  const artist = (params.artist || "").trim();
  const title = (params.title || "").trim();
  if (!artist || !title) {
    return res.status(400).json({ error: "artist and title are required" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured on this site" });
  }

  function buildBody(model) {
    return JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: "user",
        parts: [{ text: "Album: " + title + "\nArtist: " + artist +
                        "\n\nWhat year did this album FIRST come out?" }]
      }],
      generationConfig: {
        maxOutputTokens: 300,
        thinkingConfig: { thinkingBudget: 0 }
      }
    });
  }

  try {
    const out = await callGemini(apiKey, buildBody);
    if (!out.ok) {
      return res.status(out.status === 429 ? 429 : 502).json({
        error: "upstream error", upstreamStatus: out.status,
        quota: out.quota || "rate", quotaId: out.quotaId || null,
        detail: out.detail || ""
      });
    }

    const cand = out.cand;
    const raw = String(out.text || "").replace(/```json/gi, "").replace(/```/g, "").trim();

    let year = null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.year && /^\d{4}$/.test(String(parsed.year))) {
        year = String(parsed.year);
      }
    } catch (e) {
      const m = /\b(1[89]\d{2}|20[0-4]\d)\b/.exec(raw);
      if (m) year = m[1];
    }

    // surface a grounding source so the value is checkable
    let source = null;
    const gm = cand && cand.groundingMetadata;
    if (gm && Array.isArray(gm.groundingChunks) && gm.groundingChunks.length) {
      const c0 = gm.groundingChunks[0];
      source = (c0 && c0.web && (c0.web.uri || c0.web.url)) || null;
    }

    return res.status(200).json({ year: year, source: source });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
