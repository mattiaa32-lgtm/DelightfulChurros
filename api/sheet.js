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

export async function sheetCall(payload, opts) {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("sheet is not configured");

  const attempts = (opts && opts.attempts) || 2;
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
        if (d.error) throw new Error(d.error);
        return d;
      }

      // Not JSON: usually the transient Drive page. Pause and try again.
      if (n < attempts - 1) {
        await new Promise((res) => setTimeout(res, 700));
        continue;
      }
    } catch (err) {
      // A real error from the script (unauthorised, unknown action) is
      // final — only retry when we got something unparseable back.
      if (err && err.message && !/^sheet returned/.test(err.message)) throw err;
      if (n >= attempts - 1) throw err;
      await new Promise((res) => setTimeout(res, 700));
    }
  }

  throw new Error("sheet returned: " + String(lastRaw).slice(0, 160));
}
