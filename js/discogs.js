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
// Reads only. Nothing here can modify your Discogs account.

const UA = "ShelfVinylApp/1.0 +https://github.com/";

async function dg(path, token) {
  const sep = path.indexOf("?") > -1 ? "&" : "?";
  const res = await fetch("https://api.discogs.com" + path + sep +
                          "token=" + encodeURIComponent(token), {
    headers: { "User-Agent": UA, "Accept": "application/json" }
  });
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

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: "Discogs isn't connected",
      detail: "Set DISCOGS_TOKEN in the environment variables"
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
                           "&q=" + encodeURIComponent(q), token);
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
      const out = await dg("/releases/" + id, token);
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
      const user = process.env.DISCOGS_USER || body.user;
      if (!user) return res.status(400).json({ error: "DISCOGS_USER not set" });
      const page = Math.max(1, parseInt(body.page, 10) || 1);
      const per = Math.min(100, Math.max(1, parseInt(body.perPage, 10) || 100));
      const out = await dg("/users/" + encodeURIComponent(user) +
                           "/collection/folders/0/releases?per_page=" + per +
                           "&page=" + page, token);
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

    return res.status(400).json({ error: "unknown action" });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
