// Vercel Function: /api/radar
//
// Looks for records coming out in the next month or two that this
// collection suggests an interest in — reissues, anniversary pressings,
// new albums from artists already on the shelf.
//
// A caveat worth stating plainly: nothing publishes a structured feed of
// upcoming vinyl. Discogs catalogues what exists, not what is coming.
// So this uses Google Search grounding, which means results are good for
// well-covered artists and labels and thin for obscure ones. Every item
// carries the source it came from, and the model is told to return
// nothing rather than guess — an empty radar is a truthful answer.
//
// Weekly rather than daily: the answer barely changes day to day, and
// grounded search is the most quota-expensive thing here.
//
// POST { artists: [...], labels: [...], weeks?, avoid?: [...] }
// -> { items: [{ artist, title, kind, when, why, source }] }

import { callGemini } from "./_gemini.js";

const SYSTEM = [
  "You track upcoming vinyl releases for a collector.",
  "",
  "Search the web for records due out in the window given below that this",
  "collector would plausibly want: reissues or repressings of albums by",
  "artists they collect, anniversary editions, and new albums from those",
  "artists. Favour things actually announced with a date.",
  "",
  "Rules that matter more than filling the list:",
  "- Only include a release you found evidence for. Do NOT extrapolate",
  "  from an artist being active, and do not invent dates.",
  "- If you find nothing credible, return an empty array. An empty radar",
  "  is a correct answer and far better than plausible-sounding fiction.",
  "- Prefer vinyl. Ignore digital-only and streaming-only releases.",
  "- Do not list something the collector already owns.",
  "",
  "Reply with ONLY a JSON array, no markdown fences:",
  '[{"artist":"...","title":"...","kind":"reissue|new album|anniversary",',
  '  "when":"a date or month, as announced","why":"one line: why this collector",',
  '  "source":"the site you found it on"}]',
  "At most 8 items, most certain first."
].join("\n");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) { return res.status(400).json({ error: "bad JSON body" }); }

  const artists = (body.artists || []).slice(0, 60);
  if (!artists.length) return res.status(400).json({ error: "no artists supplied" });
  const weeks = Math.min(12, Math.max(2, parseInt(body.weeks, 10) || 8));

  const today = new Date().toISOString().slice(0, 10);
  const avoid = (body.avoid || []).slice(0, 60);

  const prompt =
    "Today is " + today + ". Look " + weeks + " weeks ahead.\n\n" +
    "Artists this collector owns (a sample):\n" + artists.join(", ") + "\n\n" +
    (avoid.length ? "Already suggested before, do not repeat:\n" + avoid.join("\n") + "\n\n" : "") +
    "Return the JSON array now.";

  try {
    /* Grounding is what makes this worth doing at all \u2014 without it the
       model would be recalling, not checking. It is also metered
       separately and tightly, so an ungrounded retry is pointless here:
       better to report that than to answer from memory and look
       authoritative about it. */
    const out = await callGemini(apiKey, function () {
      return JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1400 },
        tools: [{ google_search: {} }]
      });
    });

    if (!out.ok) {
      return res.status(out.status === 429 ? 429 : 502).json({
        error: out.status === 429
          ? "the web-search allowance is used up for now"
          : "the search failed",
        quota: out.quota, detail: out.detail
      });
    }

    let items = null;
    try {
      items = JSON.parse(String(out.text || "")
        .replace(/```json/gi, "").replace(/```/g, "").trim());
    } catch (e) {
      const m = String(out.text || "").match(/\[[\s\S]*\]/);
      if (m) { try { items = JSON.parse(m[0]); } catch (e2) { items = null; } }
    }
    if (!Array.isArray(items)) {
      return res.status(502).json({ error: "unparseable reply",
                                    detail: String(out.text || "").slice(0, 200) });
    }

    /* Surface the pages grounding actually used, so a claim about a
       release date can be checked rather than taken on faith. */
    const sources = [];
    const gm = out.cand && out.cand.groundingMetadata;
    if (gm && Array.isArray(gm.groundingChunks)) {
      gm.groundingChunks.forEach(function (c) {
        if (c && c.web && c.web.uri) {
          sources.push({ title: c.web.title || c.web.uri, url: c.web.uri });
        }
      });
    }

    return res.status(200).json({
      ok: true,
      items: items.slice(0, 8),
      sources: sources.slice(0, 6),
      grounded: sources.length > 0,
      checked: today
    });
  } catch (err) {
    return res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}
