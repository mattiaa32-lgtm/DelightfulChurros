/* =================== one app, several devices =======================
   Settings drifted between devices because each kept its own copy: the
   shelf's shape, which category lives in which cube, the order within a
   cube, and the hi-fi setup were all browser-local. Change the layout on
   the laptop and the phone still showed the old one \u2014 and since filing
   writes cube numbers to the sheet from that map, the two could actively
   disagree about where a record belongs.

   None of these are per-device by nature. There is one shelf and one
   hi-fi. They live in the sheet now, and the browser copy is only a
   cache so the app can draw before the sheet answers.

   Anything genuinely local stays local: the owner passphrase, and the
   "when did this last run" timestamps, which are about this device's
   own housekeeping. */

var SHARED_KEYS = ["shelfShape", "cubeMap", "catOrder", "gear"];
var SHARED_CONFIG = "app_state";

function localShared(){
  var out = {};
  SHARED_KEYS.forEach(function(k){
    try { var v = localStorage.getItem(k); if (v) out[k] = v; } catch (e) {}
  });
  return out;
}

/* Pulls the shared copy and adopts anything this device doesn't have or
   has an older version of. Last write wins, which is right here: these
   are settings, not accumulating lists, and a stale layout overwriting a
   new one is the failure worth avoiding. */
function pullShared(cb){
  fetch("/api/sheet", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ action:"getConfig", key: SHARED_CONFIG })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var remote = null;
    try { remote = JSON.parse((d && d.value) || "null"); } catch (e) {}
    if (!remote || !remote.at){ if (cb) cb(false); return; }

    var mineAt = 0;
    try { mineAt = +localStorage.getItem("app_state_at") || 0; } catch (e) {}
    if (remote.at <= mineAt){ if (cb) cb(false); return; }

    var changed = false;
    SHARED_KEYS.forEach(function(k){
      if (!remote.state || !remote.state[k]) return;
      var cur = null;
      try { cur = localStorage.getItem(k); } catch (e) {}
      if (cur === remote.state[k]) return;
      try { localStorage.setItem(k, remote.state[k]); changed = true; } catch (e) {}
    });
    try { localStorage.setItem("app_state_at", String(remote.at)); } catch (e) {}

    if (changed){
      /* The shape and the cube map drive what is drawn, so redraw. */
      if (typeof applyShelfShapeCSS === "function") applyShelfShapeCSS();
      if (typeof CUBE_NAMES !== "undefined" && typeof buildCubeNames === "function"){
        CUBE_NAMES = buildCubeNames();
      }
      if (typeof redrawEverything === "function") redrawEverything();
    }
    if (cb) cb(changed);
  })
  .catch(function(){ if (cb) cb(false); });
}

/* Called after anything in SHARED_KEYS changes. */
function pushShared(){
  if (typeof isOwner !== "function" || !isOwner()) return;
  if (typeof sheetWrite !== "function") return;
  var at = Date.now();
  try { localStorage.setItem("app_state_at", String(at)); } catch (e) {}
  sheetWrite("setConfig", {
    key: SHARED_CONFIG,
    value: JSON.stringify({ at: at, state: localShared() })
  }, function(){});
}

if (typeof onDataReady === "function"){
  onDataReady(function(){ setTimeout(function(){ pullShared(); }, 2500); });
}
