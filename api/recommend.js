// Netlify Function: /.netlify/functions/recommend
//
// Two modes, both POST with a JSON body:
//
//   mode "mood"     \u2014 conversational. Given the collection, the chat
//                     history and a new message, suggests records the
//                     user ALREADY OWNS to play right now.
//   mode "discover" \u2014 one-shot. Suggests 1-3 great albums the user does
//                     NOT own, for widening taste.
//
// Both return JSON. The Gemini key stays server-side.
//
// If Gemini ever 404s naming a replacement model, swap MODEL below for
// whatever the error names \u2014 that's the only change needed.

const MODEL = "gemini-3.5-flash-lite";

const MOOD_SYSTEM = [
  "You are a friendly, knowledgeable record-shop regular helping someone choose what to play",
  "from THEIR OWN vinyl collection, which is listed below.",
  "",
  "Rules:",
  "- Only ever suggest records that appear in the collection list. Never invent one.",
  "- Treat one LP as roughly 40 minutes, one side as roughly 20. If they mention how long",
  "  they have, pick a set that fits and say roughly how long it runs.",
  "- If they give a mood, vibe, activity or weather, lead with that rather than genre.",
  "- Pick decisively. 1-3 records unless they ask for more. Say WHY each one fits their",
  "  mood in one short clause \u2014 no track-by-track breakdowns.",
  "- Be warm and brief. Two or three sentences of chat, not an essay.",
  "",
  "Reply with ONLY a JSON object, no markdown fences, in exactly this shape:",
  '{"reply":"your conversational answer","picks":[{"artist":"...","title":"..."}]}',
  "The artist and title in picks MUST be copied exactly as they appear in the collection",
  "list so the app can find them. picks may be empty if you are asking a question back."
].join("\n");

const DISCOVER_SYSTEM = [
  "You recommend albums to a serious vinyl collector who wants to discover records they",
  "do NOT already own. Their current collection is listed below \u2014 use it to understand",
  "their taste, and NEVER recommend anything already in it.",
  "",
  "Quality bar \u2014 this matters more than anything else:",
  "- Recommend genuinely great, significant albums. Canonical classics of their genre,",
  "  critically revered cult records, or important deep cuts.",
  "- Niche and obscure is welcome; RANDOM is not. Every pick must be a record a serious",
  "  listener would consider worth owning.",
  "- Do not pad with the most obvious mainstream choices they've certainly already heard,",
  "  unless it's a real gap in their collection.",
  "- Only recommend albums you are confident actually exist, with the correct artist.",
  "  If unsure, choose something you are sure of instead.",
  "",
  "Reply with ONLY a JSON array, no markdown fences, in exactly this shape:",
  '[{"artist":"...","title":"...","year":"1973","genre":"short genre label",',
  '"fits":"one of their category names, copied exactly",',
  '"sounds":"2-3 sentences on what it actually sounds like",',
  '"why":"1-2 sentences on why this collector specifically",',
  '"pressing":"which pressing is worth owning",',
  '"pressing_why":"one short clause on why that one",',
  '"pressing_search":"2-4 extra search words, e.g. Vertigo 1971"}]',
  "",
  "For 'fits', copy ONE of their category names EXACTLY as it appears in the list below.",
  "For 'sounds', be concrete and evocative \u2014 mood, energy, instrumentation, vocals,",
  "how the record unfolds. This is the main description, so give it real substance.",
  "For 'why', reference specific records they already own where you can.",
  "For 'pressing': name the pressing a collector would actually want \u2014 an original on a",
  "named label, a specific respected reissue, or a known remaster. Describe it in words a",
  "person can search for; do NOT invent catalogue numbers, matrix codes or exact release",
  "dates. If originals are absurdly expensive, say the good reissue is the sensible buy.",
  "If you are not confident which pressing is best, say so plainly (for example 'any decent",
  "reissue \u2014 no single standout') rather than guessing. 'pressing_why' is one short clause",
  "on sound quality, mastering or scarcity, and may be an empty string.",
  "'pressing_search' is extra words to narrow a Discogs search, or an empty string."
].join("\n");

function collectionLines(records) {
  if (!Array.isArray(records)) return "";
  return records
    .slice(0, 400)
    .map(function (r) {
      const a = String(r.a || "").slice(0, 80);
      const t = String(r.t || "").slice(0, 80);
      const c = String(r.c || "").slice(0, 40);
      return "- " + a + " \u2014 " + t + (c ? " [" + c + "]" : "");
    })
    .join("\n");
}

function stripFences(s) {
  return String(s || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured on this site" });
  }

  let payload;
  try {
    payload = JSON.parse(JSON.stringify(req.body || {}));
  } catch (e) {
    return res.status(400).json({ error: "bad JSON body" });
  }

  const mode = payload.mode === "discover" ? "discover" : "mood";
  const collection = collectionLines(payload.records);
  if (!collection) {
    return res.status(400).json({ error: "no records supplied" });
  }

  let system;
  let contents = [];

  if (mode === "mood") {
    system = MOOD_SYSTEM + "\n\nTHEIR COLLECTION:\n" + collection;
    const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];
    history.forEach(function (m) {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.text || "").slice(0, 2000) }]
      });
    });
    contents.push({
      role: "user",
      parts: [{ text: String(payload.message || "").slice(0, 2000) }]
    });
  } else {
    const cats = [];
    (payload.records || []).forEach(function (r) {
      if (r.c && cats.indexOf(r.c) < 0) cats.push(r.c);
    });
    system = DISCOVER_SYSTEM +
      "\n\nTHEIR CATEGORY NAMES (use one, verbatim, for 'fits'):\n" +
      cats.map(function (c) { return "- " + c; }).join("\n") +
      "\n\nTHEIR COLLECTION (never recommend these):\n" + collection;
    const count = Math.min(3, Math.max(1, parseInt(payload.count, 10) || 3));
    const adventure = payload.adventurous
      ? "Push them outside their comfort zone \u2014 adjacent or unfamiliar genres they seem ready for."
      : "Stay broadly within the territory their collection suggests, but go deeper than the obvious.";
    const avoid = Array.isArray(payload.avoid) && payload.avoid.length
      ? "\nAlso do NOT repeat any of these, already suggested before:\n" +
        payload.avoid.slice(0, 120).map(function (x) { return "- " + x; }).join("\n")
      : "";
    const brief = String(payload.brief || "").slice(0, 800);
    contents.push({
      role: "user",
      parts: [{
        text: "Recommend exactly " + count + " album(s). " + adventure + avoid +
              (brief ? "\n\nWHAT THEY ASKED FOR (this takes priority over general " +
                       "taste-matching, but the quality bar still applies):\n" + brief : "") +
              "\nSeed for variety (ignore its meaning, just don't repeat past picks): " +
              (payload.seed || "none") + "\n\nReturn the JSON array now."
      }]
    });
  }

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
              MODEL + ":generateContent";

  function body(includeThinking) {
    const b = {
      system_instruction: { parts: [{ text: system }] },
      contents: contents,
      generationConfig: {
        maxOutputTokens: mode === "discover" ? 1400 : 700,
        responseMimeType: "application/json"
      }
    };
    if (includeThinking) b.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    return JSON.stringify(b);
  }

  async function call(includeThinking) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: body(includeThinking)
    });
  }

  try {
    let apiRes = await call(true);
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
    const raw = stripFences((parts && parts[0] && parts[0].text) || "");

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

    if (!parsed) {
      // Model didn't return usable JSON. For mood we can still show the
      // prose; for discover there's nothing safe to render.
      if (mode === "mood") {
        return res.status(200).json({ reply: raw, picks: [] });
      }
      return res.status(502).json({ error: "unparseable reply" });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
