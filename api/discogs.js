// Vercel Function: /api/discogs
//
// Proxies the Discogs API. Exists for three reasons:
//   1. Discogs requires a token for search; putting it in the browser
//      would hand it to every guest who opens the shelf.
//   2. Discogs requires a User-Agent, which browsers refuse to set.
//   3. api.discogs.com sends no CORS headers for authenticated calls.
//
// Environment variable:
//   DISCOGS_TOKEN     a personal access token from
//                     https://www.discogs.com/settings/developers
//   DISCOGS_USER      your Discogs username (for collection sync)
//
// POST { action, ... }
//   "search"     { q, page }        search releases
//   "release"    { id }             one release, full detail
//   "collection" { page, perPage }  your collection, a page at a time
//
//   "addToCollection" { id, passphrase }   owner only — modifies Discogs
//
// Everything except addToCollection is read-only. That one action can
// change your Discogs account, so it requires the owner passphrase, the
// same gate the sheet writes use — otherwise anyone who opened the
// shelf could add records to your collection.

const UA = "ShelfVinylApp/1.0 +https://github.com/";

/* Credentials now come from the OAuth connection stored in the sheet.
   DISCOGS_TOKEN is still honoured as a fallback so an existing setup
   keeps working until it's reconnected properly. */
async function sheetGet(key) {
  const url = process.env.SHEET_WEBHOOK_URL, secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) return null;
  try {
    const first = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: secret, action: "getConfig", key: key }),
      redirect: "manual"
    });
    let r = first;
    if (first.status >= 300 && first.status < 400) {
      const loc = first.headers.get("location");
      if (loc) r = await fetch(loc, { method: "GET", redirect: "follow" });
    }
    const d = JSON.parse(await r.text());
    return d && d.value ? d.value : null;
  } catch (e) { return null; }
}

function oauthAuth(token, tokenSecret) {
  const f = {
    oauth_consumer_key: process.env.DISCOGS_CONSUMER_KEY,
    oauth_nonce: Math.random().toString(36).slice(2) + Date.now(),
    oauth_signature_method: "PLAINTEXT",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    oauth_token: token,
    oauth_signature: process.env.DISCOGS_CONSUMER_SECRET + "&" + tokenSecret
  };
  return "OAuth " + Object.keys(f)
    .map((k) => k + '="' + encodeURIComponent(f[k]) + '"').join(", ");
}

async function dg(path, cred, method) {
  let url = "https://api.discogs.com" + path;
  const headers = { "User-Agent": UA, "Accept": "application/json" };
  if (cred.oauth) headers["Authorization"] = oauthAuth(cred.token, cred.secret);
  else {
    const sep = path.indexOf("?") > -1 ? "&" : "?";
    url += sep + "token=" + encodeURIComponent(cred.token);
  }
  const res = await fetch(url, { method: method || "GET", headers: headers });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { ok: res.ok, status: res.status, data, raw: text.slice(0, 200) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const oauthToken = await sheetGet("discogs_token");
  const oauthSecret = await sheetGet("discogs_secret");
  const cred = oauthToken
    ? { oauth: true, token: oauthToken, secret: oauthSecret || "" }
    : (process.env.DISCOGS_TOKEN
        ? { oauth: false, token: process.env.DISCOGS_TOKEN } : null);
  if (!cred) {
    return res.status(400).json({
      error: "Discogs isn't connected",
      detail: "Connect your Discogs account from the app first"
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) { return res.status(400).json({ error: "bad JSON body" }); }

  try {
    if (body.action === "search") {
      const q = String(body.q || "").trim();
      if (!q) return res.status(400).json({ error: "q required" });
      const page = Math.max(1, parseInt(body.page, 10) || 1);
      const out = await dg("/database/search?type=release&per_page=12&page=" + page +
                           "&q=" + encodeURIComponent(q), cred);
      if (!out.ok) {
        return res.status(out.status === 429 ? 429 : 502)
                  .json({ error: "discogs error", status: out.status, detail: out.raw });
      }
      // Trim to what the app actually shows, so we're not shipping
      // several hundred KB of Discogs metadata to a phone.
      const results = (out.data.results || []).map(function (r) {
        return {
          id: r.id,
          title: r.title,                       // "Artist - Title"
          year: r.year || "",
          country: r.country || "",
          label: (r.label && r.label[0]) || "",
          format: (r.format || []).slice(0, 3).join(", "),
          thumb: r.cover_image || r.thumb || ""
        };
      });
      return res.status(200).json({ results: results });
    }

    if (body.action === "release") {
      const id = String(body.id || "").replace(/\D/g, "");
      if (!id) return res.status(400).json({ error: "id required" });
      const out = await dg("/releases/" + id, cred);
      if (!out.ok) {
        return res.status(502).json({ error: "discogs error", status: out.status });
      }
      const d = out.data || {};
      const artist = ((d.artists || [])[0] || {}).name || "";
      const img = (d.images || [])[0] || {};
      return res.status(200).json({
        id: d.id,
        artist: String(artist).replace(/\s*\(\d+\)$/, ""),   // "Nirvana (2)" → "Nirvana"
        title: d.title || "",
        year: d.year || "",
        masterId: d.master_id || null,
        cover: img.uri || img.uri150 || "",
        genres: (d.genres || []).concat(d.styles || []).slice(0, 5),
        label: ((d.labels || [])[0] || {}).name || ""
      });
    }

    if (body.action === "collection") {
      const user = (await sheetGet("discogs_user")) || process.env.DISCOGS_USER || body.user;
      if (!user) return res.status(400).json({ error: "DISCOGS_USER not set" });
      const page = Math.max(1, parseInt(body.page, 10) || 1);
      const per = Math.min(100, Math.max(1, parseInt(body.perPage, 10) || 100));
      const out = await dg("/users/" + encodeURIComponent(user) +
                           "/collection/folders/0/releases?per_page=" + per +
                           "&page=" + page, cred);
      if (!out.ok) {
        return res.status(out.status === 429 ? 429 : 502)
                  .json({ error: "discogs error", status: out.status, detail: out.raw });
      }
      const items = (out.data.releases || []).map(function (r) {
        const b = r.basic_information || {};
        const artist = ((b.artists || [])[0] || {}).name || "";
        return {
          id: b.id,
          artist: String(artist).replace(/\s*\(\d+\)$/, ""),
          title: b.title || "",
          year: b.year || "",
          cover: b.cover_image || b.thumb || ""
        };
      });
      const pg = (out.data.pagination) || {};
      return res.status(200).json({
        items: items,
        page: pg.page || page,
        pages: pg.pages || 1,
        total: pg.items || items.length
      });
    }

    if (body.action === "addToCollection") {
      const owner = process.env.OWNER_PASSPHRASE;
      const given = String(body.passphrase || "");
      let ok = false;
      if (owner && given.length === owner.length) {
        let diff = 0;
        for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ owner.charCodeAt(i);
        ok = diff === 0;
      }
      if (!ok) return res.status(403).json({ error: "not unlocked for editing" });

      const user = (await sheetGet("discogs_user")) || process.env.DISCOGS_USER;
      if (!user) return res.status(400).json({ error: "DISCOGS_USER not set" });
      const id = String(body.id || "").replace(/\D/g, "");
      if (!id) return res.status(400).json({ error: "id required" });

      // folder 1 is "Uncategorized"; folder 0 is the read-only "All" view
      const out = await dg("/users/" + encodeURIComponent(user) +
                           "/collection/folders/1/releases/" + id, cred, "POST");
      if (!out.ok) {
        return res.status(out.status === 429 ? 429 : 502).json({
          error: "couldn't add to Discogs",
          status: out.status,
          detail: out.raw
        });
      }
      return res.status(200).json({ ok: true, added: id });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
