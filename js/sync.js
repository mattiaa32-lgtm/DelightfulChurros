/* =================== keeping devices in step =======================
   This replaces two modules that were doing closely related jobs: one
   shared generated results (picks, radar, assessments), the other shared
   settings (shelf shape, cube map, hi-fi). Both polled the sheet, both
   kept their own timestamps, and the split was an artefact of the order
   they were written in rather than a real distinction.

   One index entry now carries everything a device needs to know:

     { at:   when the settings last changed
       state:{ shelfShape, cubeMap, catOrder, gear }
       keys: { disc: <ts>, radar: <ts>, assess: <ts>, ... }
       coll:  when the collection last changed }

   That is one small read per poll and it answers three questions at
   once: have the settings moved, has anything been generated, and has
   the collection itself changed. Payloads are fetched only when their
   timestamp has moved.

   The browser keeps local copies throughout. Those are a cache so a tab
   can draw before the network answers; the sheet is the truth. */

var SYNC_INDEX = "gen_index";
var SYNC_POLL_MS = 45000;
var SHARED_KEYS = ["shelfShape", "cubeMap", "catOrder", "gear"];

var syncHandlers = {};
var syncSeen = {};
var syncStarted = false;
var syncFailed = null;      /* what last failed to publish, if anything */

/* ---- registration ---- */
function onShared(key, adopt){
  syncHandlers[key] = adopt;
  try { syncSeen[key] = +localStorage.getItem("seen:" + key) || 0; } catch (e) {}
}
function noteSeen(key, at){
  syncSeen[key] = at;
  try { localStorage.setItem("seen:" + key, String(at)); } catch (e) {}
}

/* ---- reading ---- */
function readConfig(key, cb){
  fetch("/api/sheet", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ action:"getConfig", key: key })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var v = null;
    try { v = JSON.parse((d && d.value) || "null"); } catch (e) {}
    cb(v);
  })
  .catch(function(){ cb(null); });
}

/* ---- writing, and saying so when it fails ----
   Everything here is best-effort by nature, but silence was the wrong
   default: a failed publish means another device never sees the result,
   and nothing said so. Now it is recorded and shown. */
function writeIndex(mutate, cb){
  readConfig(SYNC_INDEX, function(idx){
    idx = idx || {};
    mutate(idx);
    sheetWrite("setConfig", { key: SYNC_INDEX, value: JSON.stringify(idx) },
      function(err){
        if (err) noteSyncFailure("index", err);
        else clearSyncFailure();
        if (cb) cb(err);
      });
  });
}

function noteSyncFailure(what, err){
  syncFailed = { what: what, at: Date.now(),
                 msg: (err && err.message) || "write failed" };
  paintSyncWarning();
}
function clearSyncFailure(){
  if (!syncFailed) return;
  syncFailed = null;
  paintSyncWarning();
}

/* A quiet line, not a dialog: nothing is lost on this device, the other
   one simply has not been told. */
function paintSyncWarning(){
  var el = document.getElementById("syncwarn");
  if (!el) return;
  if (!syncFailed){ el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = "Couldn't share the last result with your other devices \u2014 " +
    syncFailed.msg + ". Everything is saved here; they'll catch up when the " +
    "connection does.";
}

/* ---- publishing a generated result ---- */
function shareResult(key, payload){
  if (typeof isOwner !== "function" || !isOwner()) return;
  if (typeof sheetWrite !== "function") return;
  var at = Date.now();
  noteSeen(key, at);
  sheetWrite("setConfig", { key: "gen:" + key,
                            value: JSON.stringify({ at: at, payload: payload }) },
    function(err){
      if (err){ noteSyncFailure(key, err); return; }
      /* Index after payload, so a device that sees a new timestamp
         always finds the content already there. */
      writeIndex(function(idx){
        idx.keys = idx.keys || {};
        idx.keys[key] = at;
      });
    });
}

/* ---- publishing settings ---- */
function localShared(){
  var out = {};
  SHARED_KEYS.forEach(function(k){
    try { var v = localStorage.getItem(k); if (v) out[k] = v; } catch (e) {}
  });
  return out;
}

function pushShared(){
  if (typeof isOwner !== "function" || !isOwner()) return;
  if (typeof sheetWrite !== "function") return;
  var at = Date.now();
  try { localStorage.setItem("app_state_at", String(at)); } catch (e) {}
  writeIndex(function(idx){
    idx.at = at;
    idx.state = localShared();
  });
}

/* Called when this device changes the collection, so others reload. */
function noteCollectionChanged(){
  if (typeof isOwner !== "function" || !isOwner()) return;
  var at = Date.now();
  try { localStorage.setItem("coll_at", String(at)); } catch (e) {}
  writeIndex(function(idx){ idx.coll = at; });
}

/* ---- one poll, three questions ---- */
function pollShared(){
  readConfig(SYNC_INDEX, function(idx){
    if (!idx) return;

    /* 1. settings */
    var mineAt = 0;
    try { mineAt = +localStorage.getItem("app_state_at") || 0; } catch (e) {}
    if (idx.at && idx.state && idx.at > mineAt){
      var changed = false;
      SHARED_KEYS.forEach(function(k){
        if (!idx.state[k]) return;
        var cur = null;
        try { cur = localStorage.getItem(k); } catch (e) {}
        if (cur === idx.state[k]) return;
        try { localStorage.setItem(k, idx.state[k]); changed = true; } catch (e) {}
      });
      try { localStorage.setItem("app_state_at", String(idx.at)); } catch (e) {}
      if (changed){
        if (typeof applyShelfShapeCSS === "function") applyShelfShapeCSS();
        if (typeof buildCubeNames === "function") CUBE_NAMES = buildCubeNames();
        if (typeof redrawEverything === "function") redrawEverything();
      }
    }

    /* 2. the collection itself \\u2014 a record added on another device was
          previously invisible here until the next reload. */
    var collMine = 0;
    try { collMine = +localStorage.getItem("coll_at") || 0; } catch (e) {}
    if (idx.coll && idx.coll > collMine){
      try { localStorage.setItem("coll_at", String(idx.coll)); } catch (e) {}
      if (typeof reloadCollection === "function") reloadCollection();
    }

    /* 3. generated results, fetched only when their stamp has moved */
    var keys = idx.keys || {};
    Object.keys(keys).forEach(function(key){
      if (!syncHandlers[key]) return;
      if (!(keys[key] > (syncSeen[key] || 0))) return;
      readConfig("gen:" + key, function(rec){
        if (!rec || !rec.payload) return;
        noteSeen(key, rec.at || keys[key]);
        try { syncHandlers[key](rec.payload); } catch (e) {}
      });
    });
  });
}

/* Kept for callers that used the old name. */
function pullShared(cb){ pollShared(); if (cb) cb(false); }

(function(){
  if (typeof onDataReady !== "function") return;
  onDataReady(function(){
    setTimeout(pollShared, 3000);
    if (syncStarted) return;
    syncStarted = true;
    setInterval(function(){
      /* Only while someone is looking: a backgrounded tab polling the
         sheet spends requests for nothing. */
      if (document.visibilityState === "visible") pollShared();
    }, SYNC_POLL_MS);
    document.addEventListener("visibilitychange", function(){
      if (document.visibilityState === "visible") pollShared();
    });
  });
})();
