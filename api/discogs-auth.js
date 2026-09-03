// Vercel Function: /api/discogs-auth
//
// Discogs uses OAuth 1.0a. Your password never reaches this app: you are
// sent to Discogs' own site to log in and authorise, and what comes back
// is a token that can be revoked from your Discogs settings at any time.
//
// Discogs accepts the PLAINTEXT signature method over HTTPS, so no
// HMAC-SHA1 signing is needed — the signature is simply the two secrets
// joined by an ampersand. That removes most of the usual OAuth 1.0a
// machinery.
//
// The resulting access token is stored in a hidden Config tab of the
// Google Sheet rather than in a browser, so every device you own is
// connected at once, and disconnecting works from anywhere.
//
// Environment variables:
//   DISCOGS_CONSUMER_KEY     from https://www.discogs.com/settings/developers
//   DISCOGS_CONSUMER_SECRET
//   SHEET_WEBHOOK_URL / SHEET_WEBHOOK_SECRET   (to store the token)
//   OWNER_PASSPHRASE         connect/disconnect are owner-only
//
// GET  /api/discogs-auth?step=start&pass=...   → redirects to Discogs
// GET  /api/discogs-auth?step=callback&...     → Discogs returns here
// POST /api/discogs-auth { action: "status" | "disconnect", passphrase }

const UA = "ShelfVinylApp/1.0";

function ownerOK(given) {
  const owner = process.env.OWNER_PASSPHRASE;
  if (!owner) return false;
  const a = String(given || ""), b = String(owner);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* The sheet doubles as the config store, so the token survives a browser
   being cleared and is shared across devices. */
async function sheetCall(payload) {
  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("sheet is not configured");
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
  try { return JSON.parse(text); }
  catch (e) { throw new Error("sheet returned: " + text.slice(0, 120)); }
}

function oauthHeader(fields) {
  return "OAuth " + Object.keys(fields)
    .map((k) => k + '="' + encodeURIComponent(fields[k]) + '"')
    .join(", ");
}

function baseFields() {
  return {
    oauth_consumer_key: process.env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: Math.random().toString(36).slice(2) + Date.now(),
    oauth_signature_method: "PLAINTEXT",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0"
  };
}

export default async function handler(req, res) {
  const key = process.env.DISCOGS_CONSUMER_KEY;
  const sec = process.env.DISCOGS_CONSUMER_SECRET;

  // ---- status / disconnect (POST) ----
  if (req.method === "POST") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    } catch (e) { return res.status(400).json({ error: "bad JSON body" }); }

    if (body.action === "status") {
      try {
        const r = await sheetCall({ action: "getConfig", key: "discogs_user" });
        /* An old Apps Script deployment has no getConfig and answers
           with an error instead of a value. That is a very different
           thing from "not connected yet", and reporting both the same
           way makes the connection look like it silently fails. */
        if (r && r.error) {
          return res.status(200).json({
            connected: false, user: null, configured: !!(key && sec),
            storeError: r.error,
            hint: "The Apps Script doesn't recognise getConfig \u2014 deploy a " +
                  "new version of Code.gs to the deployment whose URL is in " +
                  "SHEET_WEBHOOK_URL."
          });
        }
        return res.status(200).json({
          connected: !!(r && r.value),
          user: (r && r.value) || null,
          configured: !!(key && sec)
        });
      } catch (err) {
        return res.status(200).json({ connected: false, user: null,
          configured: !!(key && sec), storeError: String(err.message) });
      }
    }

    if (body.action === "disconnect") {
      if (!ownerOK(body.passphrase)) {
        return res.status(403).json({ error: "not unlocked for editing" });
      }
      try {
        await sheetCall({ action: "setConfig", key: "discogs_token", value: "" });
        await sheetCall({ action: "setConfig", key: "discogs_secret", value: "" });
        await sheetCall({ action: "setConfig", key: "discogs_user", value: "" });
        let cleared = 0;
        // Wiping the collection is a separate, explicit choice.
        if (body.clearCollection === true) {
          const r = await sheetCall({ action: "clearAll" });
          cleared = (r && r.cleared) || 0;
        }
        return res.status(200).json({ ok: true, cleared: cleared });
      } catch (err) {
        return res.status(502).json({ error: String(err.message) });
      }
    }

    return res.status(400).json({ error: "unknown action" });
  }

  if (req.method !== "GET") return res.status(405).json({ error: "GET or POST" });

  if (!key || !sec) {
    return res.status(500).send("Discogs OAuth isn't configured: set " +
      "DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET.");
  }

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const base = proto + "://" + host;
  const step = (req.query && req.query.step) || "start";

  // ---- step 1: ask Discogs for a request token, then send the user there
  if (step === "start") {
    if (!ownerOK(req.query.pass)) {
      return res.status(403).send("Not unlocked for editing.");
    }
    try {
      const fields = baseFields();
      fields.oauth_callback = base + "/api/discogs-auth?step=callback";
      fields.oauth_signature = sec + "&";
      const r = await fetch("https://api.discogs.com/oauth/request_token", {
        headers: { "Authorization": oauthHeader(fields), "User-Agent": UA }
      });
      const text = await r.text();
      if (!r.ok) return res.status(502).send("Discogs refused the request token: " +
                                             text.slice(0, 200));
      const p = new URLSearchParams(text);
      const token = p.get("oauth_token");
      const tokenSecret = p.get("oauth_token_secret");
      if (!token) return res.status(502).send("No request token in: " + text.slice(0, 200));

      /* The request secret is needed once, at callback. It goes in a
         short-lived HttpOnly cookie rather than the sheet: it is
         throwaway, and a round trip to Apps Script here would slow the
         redirect for no benefit. */
      res.setHeader("Set-Cookie",
        "dg_rs=" + encodeURIComponent(tokenSecret) +
        "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900");
      res.writeHead(302, {
        Location: "https://www.discogs.com/oauth/authorize?oauth_token=" +
                  encodeURIComponent(token)
      });
      return res.end();
    } catch (err) {
      return res.status(500).send("Couldn't start the Discogs connection: " + err.message);
    }
  }

  // ---- step 2: Discogs sends the user back here with a verifier
  if (step === "callback") {
    const token = req.query.oauth_token;
    const verifier = req.query.oauth_verifier;
    if (req.query.denied || !token || !verifier) {
      return res.status(200).send(page("Connection cancelled",
        "Discogs didn't authorise the connection. Nothing has changed."));
    }
    const cookie = String(req.headers.cookie || "");
    const m = /(?:^|;\s*)dg_rs=([^;]+)/.exec(cookie);
    const tokenSecret = m ? decodeURIComponent(m[1]) : "";

    try {
      const fields = baseFields();
      fields.oauth_token = token;
      fields.oauth_verifier = verifier;
      fields.oauth_signature = sec + "&" + tokenSecret;
      const r = await fetch("https://api.discogs.com/oauth/access_token", {
        method: "POST",
        headers: { "Authorization": oauthHeader(fields), "User-Agent": UA }
      });
      const text = await r.text();
      if (!r.ok) return res.status(200).send(page("Couldn't finish connecting",
        "Discogs said: " + text.slice(0, 200)));
      const p = new URLSearchParams(text);
      const accessToken = p.get("oauth_token");
      const accessSecret = p.get("oauth_token_secret");
      if (!accessToken) return res.status(200).send(page("Couldn't finish connecting",
        "No access token came back."));

      // who did we just connect as?
      const idFields = baseFields();
      idFields.oauth_token = accessToken;
      idFields.oauth_signature = sec + "&" + accessSecret;
      const who = await fetch("https://api.discogs.com/oauth/identity", {
        headers: { "Authorization": oauthHeader(idFields), "User-Agent": UA }
      });
      const idn = who.ok ? await who.json() : {};
      const username = idn.username || "";

      /* Discogs has authorised us, but the connection only persists if
         the token reaches the sheet. Check the write actually confirmed,
         otherwise this reports success and the app forgets immediately. */
      const w1 = await sheetCall({ action: "setConfig", key: "discogs_token", value: accessToken });
      if (!w1 || w1.ok !== true) {
        return res.status(200).send(page("Authorised, but not saved",
          "Discogs authorised the connection, but the token couldn't be stored in " +
          "the sheet, so it won't persist.<br><br>The sheet said: <code>" +
          esc(JSON.stringify(w1)).slice(0, 200) + "</code><br><br>" +
          "This usually means the Apps Script deployment is running an older " +
          "version of Code.gs without getConfig/setConfig."));
      }
      await sheetCall({ action: "setConfig", key: "discogs_secret", value: accessSecret });
      await sheetCall({ action: "setConfig", key: "discogs_user", value: username });

      res.setHeader("Set-Cookie", "dg_rs=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
      return res.status(200).send(page("Connected to Discogs",
        "Signed in as <b>" + esc(username) + "</b>. You can close this and go back to the app.",
        true));
    } catch (err) {
      return res.status(200).send(page("Couldn't finish connecting", esc(err.message)));
    }
  }

  return res.status(400).send("Unknown step.");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

/* A plain page for the callback, since this lands in a browser tab
   rather than in the app. */
function page(title, msg, ok) {
  return "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<style>body{margin:0;background:#0C0A08;color:#F4F0E8;font-family:system-ui,sans-serif;" +
    "display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}" +
    "div{max-width:34ch}h1{font-size:19px;margin:0 0 10px;letter-spacing:-.02em}" +
    "p{color:#8E877E;font-size:14px;line-height:1.6;margin:0 0 18px}" +
    "a{display:inline-block;color:#0C0A08;background:#B4653A;text-decoration:none;" +
    "padding:10px 16px;border-radius:6px;font-size:14px}</style>" +
    "<div><h1>" + title + "</h1><p>" + msg + "</p>" +
    (ok ? "<a href='/'>Back to the shelf</a>" : "<a href='/'>Back</a>") + "</div>";
}
