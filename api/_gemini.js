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

/* A starting guess only. The models a key actually has are discovered
   from the API — these names drift between releases, and asking for one
   that does not exist wastes a round trip on a 404. Cheap models first:
   the lite variants have far larger daily allowances. */
export const MODEL_CHAIN = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash"
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
    /* Filtering on "flash|pro" matched nano-banana-pro (images) and
       lyria-pro (music), which were then asked to run a web search.
       The filter has to be positive about what a text model IS, not
       just what its name contains. */
    const names = (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).indexOf("generateContent") > -1)
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => /^gemini-/i.test(n))
      .filter((n) => !/nano|banana|lyria|imagen|veo|embedding|tts|vision|audio|live|image|music|thinking/i.test(n));

    /* Order by what actually answers a grounded question well and has
       headroom: full flash models first, then pro, then the lite ones,
       and released versions before previews. */
    const rank = function (n) {
      var r = /lite/i.test(n) ? 2 : /-pro/i.test(n) ? 1 : 0;
      if (/preview|exp/i.test(n)) r += 0.5;
      return r;
    };
    names.sort(function (a, b) {
      var d1 = rank(a) - rank(b);
      if (d1) return d1;
      return b.localeCompare(a, undefined, { numeric: true });   // newer first
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
/* Not every model accepts every generation option, and the ones that
   don't answer 400 INVALID_ARGUMENT with no indication of which field
   was the problem. `thinkingConfig` and `responseMimeType` are both
   optimisations rather than requirements, so on a 400 they are stripped
   and the request retried. Doing this here means every endpoint gets it
   — previously each had to remember, and most didn't. */
/* Google usually attaches a RetryInfo saying how long to wait. Where the
   quota id is missing that hint is the only honest signal: seconds mean a
   per-minute limit, an hour means the daily one is gone. Telling someone
   to "try again in a minute" when the daily allowance is spent just sends
   them back to a button that cannot work. */
function readQuota(body) {
  const qm = body.match(/"quotaId"\s*:\s*"([^"]+)"/);
  const rd = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  const retryAfter = rd ? Math.round(parseFloat(rd[1])) : null;
  let quota;
  if (/PerDay/i.test(qm ? qm[1] : "") || /per day|daily/i.test(body)) quota = "daily";
  else if (retryAfter !== null && retryAfter > 120) quota = "daily";
  else if (retryAfter !== null) quota = "rate";
  else quota = "unknown";
  return { quotaId: qm ? qm[1] : null, quota, retryAfter };
}

async function postWithFallbacks(model, apiKey, buildBody) {
  const raw = buildBody(model);
  const variants = [raw];

  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }

  if (parsed && parsed.generationConfig) {
    const g = parsed.generationConfig;
    if (g.thinkingConfig) {
      const a = JSON.parse(raw);
      delete a.generationConfig.thinkingConfig;
      variants.push(JSON.stringify(a));
    }
    if (g.responseMimeType) {
      const b = JSON.parse(raw);
      delete b.generationConfig.responseMimeType;
      if (b.generationConfig.thinkingConfig) delete b.generationConfig.thinkingConfig;
      variants.push(JSON.stringify(b));
    }
  }

  let res = null;
  for (let i = 0; i < variants.length; i++) {
    res = await fetch(ENDPOINT + model + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: variants[i]
    });
    if (res.status !== 400) return res;      // 400 is the only one worth retrying
  }
  return res;
}

export async function callGemini(apiKey, buildBody, opts) {
  opts = opts || {};
  let models = orderedModels();

  /* Grounded calls are handled differently, and the usage figures show
     why: the capable models allow as few as FIVE requests a minute.
     Walking a chain of four in quick succession spends that ceiling on
     retries and the last attempt is refused \u2014 which reads as "the
     allowance is gone" when the daily count is barely touched.
     
     So: ask the API which models this key actually has (the hard-coded
     names were guesses and mostly do not exist here), pick the capable
     ones, and try at most two with a pause between. */
  if (opts.grounded) {
    const real = await listModels(apiKey);
    const capable = (real || models).filter(function (m) { return !/lite/i.test(m); });
    models = (capable.length ? capable : (real || models)).slice(0, 2);
  }
  const attempted = [];
  let last = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    /* A capable model may allow only five requests a minute, so a
       second attempt fired immediately is refused by the first one's
       own footprint. */
    if (opts.grounded && i > 0) await new Promise(function (r) { setTimeout(r, 12000); });
    attempted.push(model);
    let res;
    try {
      res = await postWithFallbacks(model, apiKey, buildBody);
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
    const q = readQuota(body);
    last = {
      ok: false,
      status: res.status,
      model,
      quotaId: q.quotaId,
      quota: q.quota,
      retryAfter: q.retryAfter,
      attempted: attempted.slice(),
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
        const q = readQuota(body);
        last = { ok: false, status: res.status, model,
                 quotaId: q.quotaId, quota: q.quota, retryAfter: q.retryAfter,
                 detail: body.slice(0, 300) };
      } catch (e) { /* try the next one */ }
    }
  }

  if (last) last.attempted = attempted;
  return last || { ok: false, status: 502, detail: "no model responded", attempted };
}
