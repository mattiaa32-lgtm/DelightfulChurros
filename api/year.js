// Vercel Function: /api/year
// Last-resort lookup for an album's ORIGINAL release year, using Gemini
// with Google Search grounding so the answer comes from the web rather
// than the model's recollection. Only called for records that Discogs
// and MusicBrainz both failed to resolve, so volume is low.
//
// GET /api/year?artist=...&title=...
// -> { year: "1971", source: "https://..." }  or  { year: null }

const MODEL = "gemini-3.5-flash-lite";

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

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
              MODEL + ":generateContent";

  function body(withSearch) {
    const b = {
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: "user",
        parts: [{ text: "Album: " + title + "\nArtist: " + artist +
                        "\n\nWhat year did this album FIRST come out?" }]
      }],
      generationConfig: { maxOutputTokens: 300 }
    };
    if (withSearch) b.tools = [{ google_search: {} }];
    return JSON.stringify(b);
  }

  async function call(withSearch) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: body(withSearch)
    });
  }

  try {
    let apiRes = await call(true);
    // if grounding isn't available on this key, fall back to ungrounded
    if (apiRes.status === 400) apiRes = await call(false);

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(apiRes.status === 429 ? 429 : 502).json({
        error: "upstream error",
        upstreamStatus: apiRes.status,
        quota: /per day|daily|PerDay/i.test(errText) ? "daily" : "rate",
        detail: errText.slice(0, 300)
      });
    }

    const data = await apiRes.json();
    const cand = data && data.candidates && data.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    const raw = ((parts && parts.map(p => p.text || "").join("")) || "")
      .replace(/```json/gi, "").replace(/```/g, "").trim();

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
