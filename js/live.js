/* =================== one app, kept in step ==========================
   Anything the app generates \u2014 the day's picks, the radar, a collection
   assessment, a category dive, a system evaluation, a spec lookup \u2014 was
   cached in the browser that asked for it. Generate on the laptop and
   the phone knew nothing about it, and would spend another AI request
   producing something slightly different.

   Rather than teaching each feature to share, they all go through here:
   generated results are written to the sheet under their own key, and a
   small index records when each last changed. Devices poll the index,
   which is a few hundred bytes, and fetch only what has actually moved.

   The result is that generating something anywhere shows up everywhere,
   without anyone pressing refresh.

   Local caches are kept as well \u2014 they are what lets a tab draw before
   the network answers. The sheet is the source of truth; the browser is
   a cache of it. */

var LIVE_INDEX = "gen_index";
var LIVE_POLL_MS = 45000;
var liveHandlers = {};      /* key -> function(payload) */
var liveSeen = {};          /* key -> timestamp this device has adopted */
var livePolling = false;

/* A feature registers what to do when a newer result arrives. */
function onShared(key, adopt){
  liveHandlers[key] = adopt;
  try { liveSeen[key] = +localStorage.getItem("seen:" + key) || 0; } catch (e) {}
}

function noteSeen(key, at){
  liveSeen[key] = at;
  try { localStorage.setItem("seen:" + key, String(at)); } catch (e) {}
}

/* Publish a generated result. Writes the payload, then bumps the index
   so other devices know to come and get it. */
function shareResult(key, payload){
  if (typeof isOwner !== "function" || !isOwner()) return;
  if (typeof sheetWrite !== "function") return;
  var at = Date.now();
  noteSeen(key, at);
  sheetWrite("setConfig", { key: "gen:" + key,
                            value: JSON.stringify({ at: at, payload: payload }) },
    function(){
      /* The index is written after the payload, so a device that sees a
         new timestamp always finds the content already there. */
      readConfig(LIVE_INDEX, function(idx){
        idx = idx || {};
        idx[key] = at;
        sheetWrite("setConfig", { key: LIVE_INDEX, value: JSON.stringify(idx) },
                   function(){});
      });
    });
}

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

/* One small read tells us whether anything changed at all. */
function pollShared(){
  readConfig(LIVE_INDEX, function(idx){
    if (!idx) return;
    Object.keys(idx).forEach(function(key){
      if (!liveHandlers[key]) return;
      if (!(idx[key] > (liveSeen[key] || 0))) return;
      readConfig("gen:" + key, function(rec){
        if (!rec || !rec.payload) return;
        noteSeen(key, rec.at || idx[key]);
        try { liveHandlers[key](rec.payload); } catch (e) {}
      });
    });
  });
}

(function(){
  if (typeof onDataReady !== "function") return;
  onDataReady(function(){
    setTimeout(pollShared, 3000);
    if (!livePolling){
      livePolling = true;
      setInterval(function(){
        /* Only while the app is actually in front of someone: polling a
           backgrounded tab spends requests for nothing. */
        if (document.visibilityState === "visible") pollShared();
      }, LIVE_POLL_MS);
      document.addEventListener("visibilitychange", function(){
        if (document.visibilityState === "visible") pollShared();
      });
    }
  });
})();
