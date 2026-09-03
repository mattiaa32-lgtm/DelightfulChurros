// Vercel Function: /api/sheet
//
// The only route through which the Google Sheet can be modified.
//
// Why it exists: the Apps Script web app URL is a write capability for
// the sheet. If the browser held it, every guest who scanned the QR
// code would be able to edit the collection. So the URL and its shared
// secret live here as environment variables, are never sent to a
// client, and every write must present the owner passphrase.
//
// Reads are open (the shelf is meant to be shareable); writes are not.
//
// Environment variables:
//   SHEET_WEBHOOK_URL     the Apps Script web app URL
//   SHEET_WEBHOOK_SECRET  the SECRET constant from Code.gs
//   OWNER_PASSPHRASE      what you type into "Unlock editing"
//
// POST { action, ...payload, passphrase? }
//   action "read"                              open
//   action "verify"                            checks passphrase only
//   action "setCells" | "setRows" | "appendRow"  owner only

import { sheetCall } from "./_sheet.js";

const WRITE_ACTIONS = ["setCells", "setRows", "appendRow"];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const url = process.env.SHEET_WEBHOOK_URL;
  const secret = process.env.SHEET_WEBHOOK_SECRET;
  if (!url || !secret) {
    return res.status(500).json({
      error: "sheet write-back is not configured",
      detail: "SHEET_WEBHOOK_URL and SHEET_WEBHOOK_SECRET must be set"
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: "bad JSON body" });
  }

  const action = String(body.action || "");
  const owner = process.env.OWNER_PASSPHRASE;

  // Compare in constant time so the endpoint can't be used to guess the
  // passphrase a character at a time.
  function passOK(given) {
    if (!owner) return false;
    const a = String(given || ""), b = String(owner);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  if (action === "verify") {
    return res.status(200).json({ ok: passOK(body.passphrase) });
  }

  if (WRITE_ACTIONS.indexOf(action) > -1 && !passOK(body.passphrase)) {
    return res.status(403).json({ error: "not unlocked for editing" });
  }

  // Forward, swapping the caller's passphrase for the sheet's own secret.
  const forward = Object.assign({}, body);
  delete forward.passphrase;   /* the shared caller adds the sheet secret */

  try {
    const data = await sheetCall(forward, { attempts: 2 });
    /* The shared caller throws on a script error or an unparseable
       reply, so anything arriving here is a genuine response. */
    if (!data || data.ok !== true) {
      return res.status(502).json({
        error: "the sheet script didn't confirm the write",
        detail: JSON.stringify(data).slice(0, 200)
      });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({
      error: "couldn't reach the sheet",
      detail: String(err && err.message ? err.message : err)
    });
  }
}
