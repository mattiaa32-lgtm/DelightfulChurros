// Netlify Function: /.netlify/functions/gear
//
// POST { mode: "specs",  kind: "cartridge", name: "Ortofon 2M Blue" }
// POST { mode: "system", gear: { turntable: {...}, cartridge: {...}, ... } }
//
// "specs" uses Gemini's Google Search grounding so the numbers come from
// real pages rather than model memory, and returns the source URLs so
// the user can check them. Specs the search cannot establish come back
// null \u2014 never guessed. Every field stays editable client-side.
//
// "system" does the part a model is genuinely good at: interpreting the
// specs the user has confirmed, checking the real engineering
// relationships between components, and saying what to upgrade first.

import { callGemini } from "./_gemini.js";

/* Model choice now lives in _gemini.js: quotas are per model, so a
   request refused by one is retried against the next. */

const SPEC_FIELDS = {
  turntable:  ["drive type", "speeds", "tonearm", "tonearm effective mass", "built-in phono stage", "wow and flutter"],
  cartridge:  ["type (MM/MC)", "output voltage", "compliance (dynamic, 10Hz)", "recommended tracking force", "stylus profile", "recommended load"],
  phono:      ["supported types (MM/MC)", "gain", "input loading", "RIAA accuracy"],
  amplifier:  ["type (integrated/power/receiver)", "power per channel into 8 ohms", "power into 4 ohms", "built-in phono stage", "inputs"],
  speakers:   ["type (passive/active)", "sensitivity", "nominal impedance", "frequency response", "recommended amplifier power", "driver configuration"],
  receiver:   ["supported codecs", "output type", "DAC", "supported services"]
};

function specSystem(kind) {
  const fields = SPEC_FIELDS[kind] || ["key specifications"];
  return [
    "You look up the real, published specifications of a piece of hi-fi equipment,",
    "using web search. Accuracy matters far more than completeness.",
    "",
    "Rules:",
    "- Use the search results. Prefer the manufacturer's own page, then reputable",
    "  retailers or review sites.",
    "- If search does not establish a value, return null for it. NEVER guess, estimate,",
    "  or fill a value from memory. A null is a correct answer; a wrong number is not.",
    "- Keep values short and as published, including units (e.g. \"2.5 mV\", \"8 ohms\",",
    "  \"35 W\", \"18 \u00b5m/mN\").",
    "- If the product name is ambiguous or you cannot identify it, set \"found\" false.",
    "",
    "Reply with ONLY this JSON object, no markdown fences:",
    '{"found":true,"resolved_name":"the full product name as the maker writes it",',
    '"maker":"...","specs":[{"label":"...","value":"..."}],',
    '"summary":"2-3 sentences on what this component is and how it is regarded",',
    '"sound":"1-2 sentences on its sonic character, if reviews establish one, else null"}',
    "",
    "Look for these specifications in particular: " + fields.join(", ") + ".",
    "Include a spec only if you found a real value; omit it otherwise."
  ].join("\n");
}

const DETAIL_SYSTEM = [
  "You summarise what the audio press and owner community actually say about one",
  "piece of hi-fi equipment. Search the web first \u2014 this is a summary of published",
  "opinion, not your own impression.",
  "",
  "Reply with ONLY a JSON object, no markdown fences:",
  '{"overview":"2-3 sentences: what it is, where it sits in the market, its reputation",',
  '"strengths":["short phrase","short phrase"],',
  '"watch_outs":["short phrase","short phrase"],',
  '"pairs_with":"one sentence on what it partners well with",',
  '"verdict":"one sentence \u2014 who it suits"}',
  "",
  "2-4 items in each list, each a short phrase rather than a sentence.",
  "Report the consensus and note where reviewers disagree. If you cannot find real",
  "coverage of this product, say so plainly in overview rather than inventing praise."
].join("\n");

const SYSTEM_SYSTEM = [
  "You evaluate a complete hi-fi setup for a vinyl listener. You are a knowledgeable,",
  "direct dealer \u2014 useful, not flattering, and never inventing specifications.",
  "",
  "Judge the real engineering relationships, and say plainly when a spec needed to",
  "judge one is missing rather than assuming a value:",
  "- Cartridge compliance vs tonearm effective mass: resonance should land near 8-12 Hz.",
  "- Cartridge type and output vs phono stage gain and loading (MM vs MC mismatch).",
  "- Whether a separate phono stage is needed at all, or is being doubled up.",
  "- Amplifier power vs speaker sensitivity and impedance, for the room.",
  "- Any component clearly holding the rest back.",
  "",
  "Rules:",
  "- No numeric score out of 10. Descriptive bands only.",
  "- Be specific about WHY something matches or doesn't, in plain language.",
  "- 'upgrade_priority' is the single change that would most improve this system,",
  "  with an honest note if the system is already well balanced.",
  "",
  "Reply with ONLY this JSON object, no markdown fences:",
  '{"headline":"one sentence on this system as a whole",',
  '"synergy":"3-5 sentences on how well these components suit each other",',
  '"checks":[{"label":"e.g. Cartridge / tonearm match","status":"good|caution|unknown",',
  '           "note":"one or two sentences explaining it"}],',
  '"weakest_link":{"component":"...","why":"..."},',
  '"upgrade_priority":{"what":"...","why":"...","rough_budget":"a range, or null"},',
  '"verdict":"a descriptive band for the system"}'
].join("\n");

function gearLines(gear) {
  const out = [];
  Object.keys(gear || {}).forEach(function (k) {
    const g = gear[k];
    if (!g || !g.name) return;
    let s = "- " + k.toUpperCase() + ": " + g.name;
    if (Array.isArray(g.specs) && g.specs.length) {
      s += "\n" + g.specs
        .filter(function (x) { return x && x.label && x.value; })
        .map(function (x) { return "    " + x.label + ": " + x.value; })
        .join("\n");
    }
    out.push(s);
  });
  return out.join("\n");
}

/* Pulls the first balanced {...} or [...] out of a reply. Grounded
   answers frequently add a sentence before or after the JSON, and a
   greedy regex grabs that too and then fails to parse. */
function extractJSON(s) {
  s = String(s || "");
  for (let i = 0; i < s.length; i++) {
    const open = s[i];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { break; }
        }
      }
    }
  }
  return null;
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

  let p;
  try { p = JSON.parse(JSON.stringify(req.body || {})); }
  catch (e) { return res.status(400).json({ error: "bad JSON body" }); }

  const isSpecs = p.mode === "specs" || (!p.mode);
  const isDetail = p.mode === "detail";
  let system, userText, useSearch;

  if (isDetail) {
    const name = String(p.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    system = DETAIL_SYSTEM;
    userText = "Component type: " + (p.kind || "unknown") + "\nProduct: " + name +
               "\n\nReturn the JSON.";
    /* Grounding is metered separately from ordinary generation and its
       free-tier allowance runs out long before the general one \u2014 which
       is why the ungrounded system evaluation kept working while these
       lookups failed. It is now opt-in: the caller asks for it only when
       verified sourcing matters more than getting an answer at all. */
    useSearch = p.grounded === true;
  } else if (isSpecs) {
    const name = String(p.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    system = specSystem(String(p.kind || "").toLowerCase());
    userText = "Component type: " + (p.kind || "unknown") + "\nProduct: " + name +
               "\n\nReturn the JSON.";
    useSearch = p.grounded === true;
  } else {
    const g = gearLines(p.gear);
    if (!g) return res.status(400).json({ error: "no gear supplied" });
    system = SYSTEM_SYSTEM;
    userText = "THEIR SETUP:\n" + g +
               (p.room ? "\n\nRoom: " + String(p.room).slice(0, 200) : "") +
               "\n\nReturn the JSON now.";
    useSearch = false;
  }

  function makeBody(withSearch) {
    return function (model) {
      const b = {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          maxOutputTokens: 3000,
          thinkingConfig: { thinkingBudget: 0 }
        }
      };
      if (withSearch) b.tools = [{ google_search: {} }];
      else b.generationConfig.responseMimeType = "application/json";
      return JSON.stringify(b);
    };
  }

  try {
    let out = await callGemini(apiKey, makeBody(useSearch));
    let grounded = useSearch;
    /* Grounding has its own, much smaller allowance than plain
       generation, so if it is refused we retry ungrounded rather than
       failing outright. */
    if (useSearch && !out.ok) {
      const plain = await callGemini(apiKey, makeBody(false));
      if (plain.ok) { out = plain; grounded = false; }
    }
    if (!out.ok) {
      /* Pull out Google's own quota id when present \u2014 it names exactly
         which limit was hit (per-day vs per-minute, and for which
         model), which is the difference between "wait a minute" and
         "wait until tomorrow". */
      return res.status(out.status === 429 ? 429 : 502).json({
        error: "upstream error",
        upstreamStatus: out.status,
        quota: out.quota || "rate",
        quotaId: out.quotaId || null,
        attempted: out.attempted || [],
        detail: out.detail || ""
      });
    }

    const cand = out.cand;
    const raw = String(out.text || "")
      .replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = extractJSON(raw); }
    if (!parsed) {
      // include what actually came back so this is debuggable rather
      // than a blank "couldn't look that up"
      return res.status(502).json({
        error: "unparseable reply",
        detail: raw.slice(0, 200) || "(empty response)"
      });
    }

    // surface the pages the grounding actually used, so specs are checkable
    const sources = [];
    const gm = cand && cand.groundingMetadata;
    if (gm && Array.isArray(gm.groundingChunks)) {
      gm.groundingChunks.forEach(function (c) {
        if (c && c.web && c.web.uri) {
          sources.push({ title: c.web.title || c.web.uri, url: c.web.uri });
        }
      });
    }
    parsed.sources = sources.slice(0, 5);
    parsed.grounded = grounded && sources.length > 0;

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
