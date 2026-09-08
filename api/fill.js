// Vercel Function: /api/fill
//
// One route for the three "work through the collection filling a column"
// jobs: descriptions, ratings and pressing notes, and market values.
//
// They were separate functions until the deployment hit Vercel's limit
// of twelve. Merging these three was the natural choice: they share a
// shape — owner-gated, batched, resumable, writing one column — so the
// only thing that differed was which column and which source. The
// implementations still live in their own files; this only routes.
//
// POST { mode: "desc" | "eval" | "value", ...their own parameters }

import { handler as descHandler } from "./_fill_desc.js";
import { handler as evalHandler } from "./_fill_eval.js";
import { handler as valueHandler } from "./_fill_value.js";

const ROUTES = { desc: descHandler, eval: evalHandler, value: valueHandler };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) { return res.status(400).json({ error: "bad JSON body" }); }

  const fn = ROUTES[String(body.mode || "")];
  if (!fn) {
    return res.status(400).json({
      error: "unknown mode",
      detail: "expected one of: " + Object.keys(ROUTES).join(", ")
    });
  }
  /* The sub-handlers read req.body, so pass it through unchanged. */
  return fn({ method: req.method, body: body, headers: req.headers || {} }, res);
}
