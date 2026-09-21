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

import { callGemini } from "./_gemini.js";

/* Model choice now lives in _gemini.js: quotas are per model, so a
   request refused by one is retried against the next. */

/* The chat was briefed only to pick something to play, in two or three
   sentences \u2014 so a question about an album, an artist, a pressing or a
   piece of gear got squeezed into a record suggestion. It is now a music
   companion who knows the collection: it answers what is asked, holds a
   conversation, and suggests records when that is what would help. The
   reply shape is unchanged, and picks were always allowed to be empty. */
const CHAT_RULES = [
  "How to answer:",
  "- Answer what they actually asked. A question about an artist, an album's",
  "  history, a genre, a pressing, a label, a piece of hi-fi, or anything else",
  "  about music gets a real answer \u2014 not a record suggestion in its place.",
  "- Suggest records only when they ask for one, or when a suggestion",
  "  genuinely helps answer the question. Most general questions need none.",
  "- Be concise. Two to four sentences is the default. Go longer only when",
  "  they ask for depth or detail. Never repeat yourself.",
  "- It is a conversation: earlier messages are included, so follow on",
  "  naturally from them rather than starting over each time.",
  "- Be accurate. If you are not sure of a fact, date or pressing detail,",
  "  say so rather than stating a guess as fact.",
  "- Plain text. Separate paragraphs with a blank line. No markdown, no",
  "  asterisks, no headings, no bullet symbols.",
  "- You can talk about anything in their collection below: what they own,",
  "  how much of an artist, what sits in which genre."
].join("\n");

/* "What to play": one job, done well. It sees far more about each record
   than the general chat \u2014 description, album score, pressing score, year
   \u2014 so it can choose on how records actually sound and how good the
   copy is, not just on genre. Answers are short and always come back as
   records from the shelf. */
const MOOD_SYSTEM = [
  "You help someone choose what to play right now from THEIR OWN vinyl",
  "collection, listed below with what is known about each record: year,",
  "a short description, an album score out of 10, and a score for their",
  "particular copy.",
  "",
  "- Only suggest records from the list. Never invent one.",
  "- Use what you know about each record, not just its genre: how it sounds,",
  "  how good it is, and how good their copy is when sound quality matters.",
  "- Treat one LP as roughly 40 minutes, one side as roughly 20. If they say",
  "  how long they have, pick a set that fits and say roughly how long it runs.",
  "- If they give a mood, activity or weather, lead with that, not genre.",
  "- Pick decisively: 1-3 records unless they ask for more.",
  "- Be brief: one or two sentences overall, with one short clause per pick",
  "  on why it fits. The records appear as cards, so do not describe them.",
  "- If what they want is unclear, ask one short question and leave picks",
  "  empty.",
  "- Plain text, no markdown.",
  "",
  "Reply with ONLY a JSON object, no other text before or after it:",
  '{"reply":"your answer","picks":[{"artist":"...","title":"..."}]}',
  "Copy artist and title in picks exactly as they appear in the list."
].join("\n");

/* "Ask": everything that isn't choosing what to play \u2014 questions about
   music, artists, labels, pressings, hi-fi; discovering records they
   don't own; and broader questions about the collection itself. */
const NEW_CHAT_SYSTEM = [
  "You are a friendly, knowledgeable music companion for a serious vinyl",
  "collector. Their collection is listed below with what is known about",
  "each record; use it to understand their taste and to answer questions",
  "about what they own.",
  "",
  CHAT_RULES,
  "",
  "Recommending records:",
  "- When they want suggestions, recommend albums they do NOT already own,",
  "  and put each one in picks \u2014 every album you recommend must be in picks,",
  "  or it will not appear as a card. Keep the reply itself short; the card",
  "  carries the detail.",
  "- Genuinely significant records: classics of their genre, revered cult",
  "  albums, important deep cuts. Niche is welcome, random is not.",
  "- Only albums you are confident exist, with the correct artist.",
  "- Up to 3 unless they ask for more.",
  "- When the question is about records they already own, answer in the",
  "  reply and leave picks empty.",
  "",
  "Reply with ONLY a JSON object, no other text before or after it:",
  '{"reply":"your answer","picks":[{"artist":"...","title":"...","year":"1973",',
  '"genre":"short label","fits":"one of their category names, copied exactly",',
  '"sounds":"2-3 sentences on what it sounds like",',
  '"why":"1-2 sentences on why this collector",',
  '"pressing":"which pressing is worth owning","pressing_why":"one short clause"}]}',
  "picks is empty whenever you are not recommending albums."
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

/* The first complete JSON object in a piece of text, optionally one that
   has a given key. String-aware, so braces inside quoted text don't
   throw the count off. */
function extractObject(text, needKey) {
  const t = String(text || "");
  for (let i = t.indexOf("{"); i > -1; i = t.indexOf("{", i + 1)) {
    let depth = 0, inStr = false, esc = false, j = i;
    for (; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    try {
      const o = JSON.parse(t.slice(i, j + 1));
      if (o && typeof o === "object" && !Array.isArray(o) && (!needKey || needKey in o)) return o;
    } catch (e) { /* not this one */ }
  }
  return null;
}
function extractArray(text) {
  const t = String(text || "");
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(t.slice(a, b + 1)); return Array.isArray(v) ? v : null; }
  catch (e) { return null; }
}

function collectionLines(records) {
  if (!Array.isArray(records)) return "";
  return records
    .slice(0, 400)
    .map(function (r) {
      const a = String(r.a || "").slice(0, 80);
      const t = String(r.t || "").slice(0, 80);
      const c = String(r.c || "").slice(0, 40);
      /* Year, album score, the copy's score and a short description, when
         the sheet has them: what choosing well depends on. */
      const bits = [];
      if (r.y) bits.push(String(r.y).slice(0, 4));
      if (r.s) bits.push("album " + String(r.s).slice(0, 4));
      if (r.p) bits.push("copy " + String(r.p).slice(0, 80));
      return "- " + a + " \u2014 " + t + (c ? " [" + c + "]" : "") +
             (bits.length ? " (" + bits.join("; ") + ")" : "") +
             (r.d ? ": " + String(r.d).slice(0, 160) : "");
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

  /* "one" describes a single named record, for something added to the
     wantlist by hand. Entries from Discover and the chat arrive with a
     description already; a manual add had none, so the same list held
     two visibly different kinds of entry. */
  const mode = payload.mode === "discover" ? "discover"
             : payload.mode === "one" ? "one" : "mood";
  const collection = collectionLines(payload.records);
  if (!collection) {
    return res.status(400).json({ error: "no records supplied" });
  }

  let system;
  let contents = [];

  if (mode === "one") {
    const artist = String(payload.artist || "").slice(0, 120);
    const title = String(payload.title || "").slice(0, 160);
    if (!artist && !title) return res.status(400).json({ error: "artist or title required" });

    system = [
      "You describe one record for a collector who has just added it to their",
      "wantlist. Reply with ONLY a JSON object, no markdown fences:",
      '{"year":"","genre":"","sounds":"","fits":"","why":"","pressing":"",',
      ' "pressing_why":""}',
      "",
      '  "sounds"  two or three sentences on what the record sounds like.',
      '  "fits"    which ONE of their categories it belongs in, copied exactly',
      "            from the list below.",
      '  "why"     one or two sentences on why it suits this collection,',
      "            naming records they already own where that is the reason.",
      '  "pressing" which pressing is worth hunting for \u2014 label and era, in',
      "            words that can be searched. Say plainly if there is no",
      "            consensus rather than inventing one.",
      '  "pressing_why" one sentence on why that pressing.',
      "",
      "Write about the record. Do not begin with \"The collector\" or describe",
      "them in the third person.",
      "",
      "THEIR CATEGORIES:\n" + (payload.categories || []).join("\n"),
      "",
      "THEIR COLLECTION:\n" + collection
    ].join("\n");

    contents.push({ role: "user", parts: [{ text:
      "Describe this record: " + artist + " \u2014 " + title }] });
  } else if (mode === "mood") {
    const cats = [];
    (payload.records || []).forEach(function (r) {
      if (r.c && cats.indexOf(r.c) < 0) cats.push(r.c);
    });
    system = (payload.scope === "new"
        ? NEW_CHAT_SYSTEM + "\n\nTHEIR CATEGORY NAMES (for 'fits'):\n" + cats.join("\n")
        : MOOD_SYSTEM) +
      "\n\nTHEIR COLLECTION:\n" + collection;
    const history = Array.isArray(payload.history) ? payload.history.slice(-16) : [];
    history.forEach(function (m) {
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.text || "").slice(0, 12000) }]
      });
    });
    contents.push({
      role: "user",
      /* Was 2,000 characters, which silently cut long messages short.
         This is a guard against runaway input, not a limit anyone
         writing a message should meet. */
      parts: [{ text: String(payload.message || "").slice(0, 12000) }]
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

  function buildBody(model) {
    const b = {
      system_instruction: { parts: [{ text: system }] },
      contents: contents,
      generationConfig: {
        /* A conversational answer, possibly with full record cards, needs
           more room than a three-line pick did. */
        maxOutputTokens: mode === "discover" ? 900 : mode === "one" ? 700 : 2400,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 }
      }
    };
    return JSON.stringify(b);
  }

  try {
    const out = await callGemini(apiKey, buildBody);
    if (!out.ok) {
      return res.status(out.status === 429 ? 429 : 502).json({
        error: "upstream error",
        upstreamStatus: out.status,
        quota: out.quota || "rate",
        quotaId: out.quotaId || null,
        detail: out.detail || ""
      });
    }

    const raw = stripFences(out.text || "");

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

    /* Models sometimes answer in prose and then append the JSON, or wrap
       the JSON in a sentence. The whole text then fails to parse, and the
       old fallback returned all of it as the reply \u2014 so the answer
       appeared twice, the second time as raw JSON, and any recommended
       record never became a card. Look for the JSON object inside the
       text first. (This block also held a stray copy of the "one" mode's
       request-building code, left by an earlier edit that replaced both
       copies of a matching line; it is gone.) */
    if (!parsed && mode !== "discover") {
      parsed = extractObject(raw, mode === "mood" ? "reply" : null);
    }
    if (!parsed && mode === "discover") {
      parsed = extractArray(raw);
    }

    if (!parsed) {
      if (mode === "mood") {
        /* Genuinely no JSON: show the prose, and only the prose. */
        const prose = raw.split(/\{\s*"reply"/)[0].trim();
        return res.status(200).json({ reply: prose || raw.trim(), picks: [] });
      }
      return res.status(502).json({ error: "unparseable reply" });
    }

    /* A chat answer must have a reply string and a picks list, whatever
       the model sent. */
    if (mode === "mood") {
      parsed = {
        reply: String((parsed && parsed.reply) || "").trim(),
        picks: Array.isArray(parsed && parsed.picks) ? parsed.picks : []
      };
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
