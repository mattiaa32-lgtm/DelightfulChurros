// Shared Apps Script caller.
// Underscore-prefixed, so Vercel treats it as a library rather than a route.
//
// This existed in three separate copies across the API routes, which is
// how one endpoint could work while another failed against the same
// sheet: they had drifted. One implementation now, with the awkward
// parts handled once:
//
//   * Apps Script answers a POST with a 302 and expects the redirect
//     target to be fetched with a GET. Following it as a POST returns a
//     Google Drive page instead of the result.
//   * That redirect occasionally serves the Drive page anyway \u2014 a
//     transient Google behaviour rather than anything wrong with the
//     request \u2014 so a response that isn't JSON is retried once before
//     being treated as a failure.

/* Reads every setting, tolerating an Apps Script that predates
   getConfigAll by falling back to individual reads. */
export async function getConfig(keys) {
  try {
    const d = await sheetCall({ action: "getConfigAll" });
    if (d && d.config) return d.config;
  } catch (e) {
    if (!/unknown action/i.test(String(e && e.message))) throw e;
  }
  const out = {};
  for (const k of keys) {
    const d = await sheetCall({ action: "getConfig", key: k });
    out[k] = d && d.value;
  }
  return out;
}

export async function sheetCall(payload, opts) {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("sheet is not configured");

  /* Apps Script sometimes answers with Google's own HTML error page
     instead of the script's JSON, usually when it is briefly overloaded.
     Two tries 0.7s apart was not enough to outlast that. But the page can
     come back AFTER the script has already run, so only operations that
     are safe to repeat get the longer retry: reading, and writes that set
     cells to fixed values. Appending a row is not safe to repeat \u2014 a
     retry could add it twice \u2014 so it keeps the single short retry, and
     the reload that follows shows whether it landed. */
  const REPEATABLE = ["read", "getConfig", "getConfigAll", "setConfig", "setCells",
                      "setRows", "ping", "readValues", "valueSnap", "backup"];
  const safe = REPEATABLE.indexOf(String(payload && payload.action)) > -1;
  const attempts = (opts && opts.attempts) || (safe ? 4 : 2);
  const pauses = [1000, 2500, 5000];
  let lastRaw = "";

  for (let n = 0; n < attempts; n++) {
    try {
      const first = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ secret: secret }, payload)),
        redirect: "manual"
      });

      let r = first;
      if (first.status >= 300 && first.status < 400) {
        const loc = first.headers.get("location");
        if (loc) r = await fetch(loc, { method: "GET", redirect: "follow" });
      }

      const text = await r.text();
      lastRaw = text;

      let d = null;
      try { d = JSON.parse(text); } catch (e) { d = null; }

      if (d) {
        if (d.error){
          /* The script ran and refused (unauthorised, unknown action):
             repeating the request would get the same answer. */
          const se = new Error(d.error); se.script = true; throw se;
        }
        return d;
      }

      // Not JSON: usually Google's error page. Pause, longer each time.
      if (n < attempts - 1) {
        await new Promise((res) => setTimeout(res, pauses[n] || 5000));
        continue;
      }
    } catch (err) {
      // A refusal from the script itself is final. Anything else \u2014 a
      // dropped connection, a timeout \u2014 is worth another attempt.
      if (err && err.script) throw err;
      if (n >= attempts - 1) throw err;
      await new Promise((res) => setTimeout(res, pauses[n] || 5000));
    }
  }

  /* Say what it means rather than pasting Google's HTML. The raw text is
     kept on the error for anyone debugging. */
  const looksLikePage = /^\s*<!DOCTYPE|<html/i.test(String(lastRaw));
  const e = new Error(looksLikePage
    ? "Google's sheet service is busy and returned an error page instead of data"
    : "sheet returned: " + String(lastRaw).slice(0, 160));
  e.busy = looksLikePage;
  e.raw = String(lastRaw).slice(0, 300);
  throw e;
}
