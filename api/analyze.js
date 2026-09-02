// Netlify Function: /.netlify/functions/analyze
//
// POST { mode: "collection" | "category", records: [...], category?: "..." }
//
// Returns the JUDGEMENT layer only. All countable metrics (category
// counts, artist depth, decade spread, catalogue completeness) are
// computed client-side from the real data \u2014 they are facts and don't
// need a model. This endpoint supplies the things a model is actually
// good at: canonical coverage, named gaps, and character.
//
// Deliberately NO overall numeric score. A model-generated "7.4/10"
// looks precise and isn't reproducible; bands and prose are honest.

import { callGemini } from "./_gemini.js";

/* Model choice now lives in _gemini.js: quotas are per model, so a
   request refused by one is retried against the next. */

const COLLECTION_SYSTEM = [
  "You assess a serious vinyl collector's collection. You are knowledgeable, direct and",
  "specific \u2014 a well-read record shop owner, not a flatterer.",
  "",
  "Rules:",
  "- Be concrete. Name actual records and artists, never vague praise.",
  "- Do NOT give a numeric score out of 10 or 100. Use descriptive bands only.",
  "- Be honest about weaknesses. A collection with real gaps should hear about them.",
  "- Only name records you are confident exist.",
  "",
  "Reply with ONLY this JSON object, no markdown fences:",
  '{"headline":"one sentence characterising this collection",',
  '"character":"2-4 sentences on what this collection says about the listener\'s taste",',
  '"strengths":[{"area":"...","note":"one sentence, naming records they own"}],',
  '"gaps":[{"area":"...","note":"what is missing and why it matters","examples":["Artist \\u2014 Album"]}],',
  '"verdict":"a descriptive band, e.g. deep and focused, light on modern jazz"}',
  "Give 2-4 strengths and 2-4 gaps. Each 'examples' array holds 1-3 records they do NOT own."
].join("\n");

const CATEGORY_SYSTEM = [
  "You assess ONE category within a serious vinyl collector's collection.",
  "You are knowledgeable, direct and specific.",
  "",
  "Rules:",
  "- Be concrete: name actual records, both theirs and ones they're missing.",
  "- No numeric scores. Descriptive judgement only.",
  "- Only name records you are confident exist.",
  "- Judge this category on its own terms, against what a strong collection in this",
  "  genre would look like \u2014 not against the rest of their shelf.",
  "",
  "Reply with ONLY this JSON object, no markdown fences:",
  '{"headline":"one sentence on the state of this category",',
  '"assessment":"3-5 sentences: what they have, how well it covers the genre,',
  '              which of their records are the strongest holdings",',
  '"canonical_held":["Artist \\u2014 Album they own that is essential to this genre"],',
  '"missing":[{"artist":"...","title":"...","why":"one clause on why it matters here"}],',
  '"verdict":"a descriptive band for this category"}',
  "List up to 5 canonical_held and 3-5 missing. Missing must NOT be records they own."
].join("\n");

function lines(records, filterCat) {
  if (!Array.isArray(records)) return "";
  return records
    .filter(function (r) { return !filterCat || r.c === filterCat; })
    .slice(0, 400)
    .map(function (r) {
      return "- " + String(r.a || "").slice(0, 80) + " \u2014 " +
             String(r.t || "").slice(0, 80) +
             (!filterCat && r.c ? " [" + String(r.c).slice(0, 40) + "]" : "") +
             (r.y ? " (" + r.y + ")" : "");
    })
    .join("\n");
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

  const isCategory = p.mode === "category" && p.category;
  const body = lines(p.records, isCategory ? p.category : null);
  if (!body) {
    return res.status(400).json({ error: "no records supplied" });
  }

  const system = isCategory
    ? CATEGORY_SYSTEM + "\n\nCATEGORY: " + p.category + "\n\nTHEIR RECORDS IN IT:\n" + body
    : COLLECTION_SYSTEM + "\n\nTHEIR COLLECTION:\n" + body;

  function buildBody(model) {
    return JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: "Return the JSON now." }] }],
      generationConfig: {
        maxOutputTokens: 1400,
        responseMimeType: "application/json",
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
        detail: out.detail || "" });
    }
    const raw = String(out.text || "")
      .replace(/```json/gi, "").replace(/```/g, "").trim();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed) {
      return res.status(502).json({ error: "unparseable reply" });
    }
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
