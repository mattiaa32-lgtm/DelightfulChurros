// Shared Gemini caller.
// Vercel does not route files beginning with an underscore, so this is a
// library rather than an endpoint.
//
// Why a chain of models: Gemini's rate limits are applied per project
// PER MODEL, so a model that has exhausted its requests-per-day still
// leaves every other model's allowance untouched. Rather than failing
// when the primary is spent, we walk down the list until one answers.
// The models below are all in the same Flash-Lite/Flash class, so the
// output is comparable — this is about which bucket the request is
// billed against, not about dropping to something much weaker.

export const MODEL_CHAIN = [
  "gemini-3.5-flash-lite",   // primary
  "gemini-2.5-flash-lite",   // separate quota, similar output
  "gemini-2.0-flash-lite",   // older, typically the most generous limits
  "gemini-2.5-flash"         // last resort: smaller RPD but more capable
];

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";

/* Remembers, for this warm serverless instance, which model last worked
   so we don't re-burn a failing model's quota on every request. Resets
   whenever the instance is recycled, which is fine — it's an
   optimisation, not state we depend on. */
let preferred = null;

/* Discovered from the API rather than hard-coded. Model names change,
   and a name this key cannot use returns 404 — walking a list of
   guesses wastes a round trip each. Asking once for the real list makes
   the chain correct for whatever the key actually has. Cached for the
   life of the warm instance. */
let discovered = null;

function orderedModels() {
  if (!preferred) return MODEL_CHAIN;
  return [preferred].concat(MODEL_CHAIN.filter((m) => m !== preferred));
}

async function listModels(apiKey) {
  if (discovered) return discovered;
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
      { headers: { "x-goog-api-key": apiKey } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const names = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).indexOf("generateContent") > -1)
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => /flash|lite/i.test(n))       // the free-tier workhorses
      .filter((n) => !/vision|embedding|tts|image|audio|live/i.test(n));
    if (!names.length) return null;
    /* Cheapest first: lite variants, then plain flash. Within each,
       newer version numbers first. */
    names.sort(function (a, b) {
      const liteA = /lite/i.test(a) ? 0 : 1, liteB = /lite/i.test(b) ? 0 : 1;
      if (liteA !== liteB) return liteA - liteB;
      return b.localeCompare(a, undefined, { numeric: true });
    });
    discovered = names.slice(0, 8);
    return discovered;
  } catch (e) {
    return null;
  }
}

/**
 * Calls Gemini, walking the model chain past any that are rate limited.
 *
 * buildBody(model) must return the request body for a given model, so
 * callers can vary generationConfig per model if they need to.
 *
 * Resolves to { ok, status, data, model, text, quota, quotaId, detail }.
 */
export async function callGemini(apiKey, buildBody, opts) {
  opts = opts || {};
  let models = orderedModels();
  const attempted = [];
  let last = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    attempted.push(model);
    let res;
    try {
      res = await fetch(ENDPOINT + model + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: buildBody(model)
      });
    } catch (err) {
      last = { ok: false, status: 0, detail: String(err && err.message) };
      continue;
    }

    if (res.ok) {
      preferred = model;
      const data = await res.json();
      const cand = data && data.candidates && data.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      const text = ((parts || []).map((p) => p.text || "").join("") || "").trim();
      return { ok: true, status: 200, data, cand, text, model };
    }

    const body = await res.text();
    const qm = body.match(/"quotaId"\s*:\s*"([^"]+)"/);
    last = {
      ok: false,
      status: res.status,
      model,
      quotaId: qm ? qm[1] : null,
      attempted: attempted.slice(),
      quota: /PerDay/i.test(qm ? qm[1] : "") || /per day|daily/i.test(body)
        ? "daily" : "rate",
      detail: body.slice(0, 300)
    };

    // 429 (out of quota) and 404 (model not available to this key) are
    // both worth trying the next model for. Anything else is a real
    // error with the request itself, so stop.
    if (res.status !== 429 && res.status !== 404) break;
    if (preferred === model) preferred = null;
  }

  /* Every name we knew about failed. Before giving up, ask the API what
     this key can actually use \u2014 the list may include models we do not
     have hard-coded, each with its own untouched daily allowance. */
  if (last && (last.status === 429 || last.status === 404)) {
    const real = await listModels(apiKey);
    const fresh = (real || []).filter((m) => attempted.indexOf(m) === -1);
    for (let i = 0; i < fresh.length; i++) {
      const model = fresh[i];
      attempted.push(model);
      try {
        const res = await fetch(ENDPOINT + model + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: buildBody(model)
        });
        if (res.ok) {
          preferred = model;
          const data = await res.json();
          const cand = data && data.candidates && data.candidates[0];
          const parts = cand && cand.content && cand.content.parts;
          const text = ((parts || []).map((p) => p.text || "").join("") || "").trim();
          return { ok: true, status: 200, data, cand, text, model, attempted };
        }
        const body = await res.text();
        const qm = body.match(/"quotaId"\s*:\s*"([^"]+)"/);
        last = { ok: false, status: res.status, model,
                 quotaId: qm ? qm[1] : null,
                 quota: /PerDay/i.test(qm ? qm[1] : "") ? "daily" : "rate",
                 detail: body.slice(0, 300) };
      } catch (e) { /* try the next one */ }
    }
  }

  if (last) last.attempted = attempted;
  return last || { ok: false, status: 502, detail: "no model responded", attempted };
}
