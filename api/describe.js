// Netlify Function: /.netlify/functions/describe
// Generates a short, two-clause description of a record \u2014 a concrete
// fact about the release, and what it actually sounds like \u2014 using
// Google's Gemini API (free tier: gemini-3.5-flash-lite). The API key
// lives only here, as a Netlify environment variable, never in the
// browser.
//
// If this ever returns a 404 naming a replacement model, Google has
// retired this one \u2014 swap the MODEL constant below for whatever the
// error message names. That's the only change needed.
//
// Called as: /.netlify/functions/describe?artist=...&title=...&category=...&year=...
// artist and title are required; category and year are optional hints
// (year usually comes from Discogs, category from your sheet) that
// help Gemini avoid guessing at things it isn't sure of.

const MODEL = "gemini-3.5-flash-lite";

const SYSTEM_PROMPT = [
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const params = req.query || {};
  const artist = (params.artist || "").trim();
  const title = (params.title || "").trim();
  const category = (params.category || "").trim();
  const year = (params.year || "").trim();

  if (!artist || !title) {
    return res.status(400).json({ error: "artist and title are required" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured on this site" });
  }

  const prompt =
    "Artist: " + artist +
    "\nAlbum: " + title +
    "\nGenre category (from the collector's own sheet): " + (category || "unknown") +
    "\nRelease year (from Discogs, if known): " + (year || "unknown") +
    "\n\nWrite the two-clause description now.";

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    MODEL + ":generateContent";

  function buildBody(includeThinking) {
    const body = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 120 }
    };
    // Disabling "thinking" keeps these one-line labels fast and cheap,
    // but not every model accepts the setting \u2014 if it's rejected we
    // retry without it rather than failing the whole request.
    if (includeThinking) {
      body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    return JSON.stringify(body);
  }

  async function callGemini(includeThinking) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: buildBody(includeThinking)
    });
  }

  try {
    let apiRes = await callGemini(true);
    if (apiRes.status === 400) {
      apiRes = await callGemini(false);
    }

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      // Pass the upstream status through (as our own status where it's
      // meaningful, e.g. 429 rate-limited) so the client can back off
      // and retry rather than treating every failure the same.
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
    const text = ((parts && parts[0] && parts[0].text) || "").trim();

    return res.status(200).json({ text: text });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
