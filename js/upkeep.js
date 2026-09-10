/* =================== keeping itself current =========================
   Several things need to happen after a record arrives, and several
   more on a weekly rhythm. Left to be remembered, they don't get done:
   a sync that never runs means the shelf drifts from Discogs, and a
   value snapshot that never runs means the chart has one point forever.

   So they run themselves. Everything here is cheap, idempotent and
   owner-only, and each remembers when it last ran so opening the app
   twice in a morning doesn't repeat the work.

   Order matters: the collection first, because everything else reads
   from it. */

var WEEK = 7 * 24 * 3600 * 1000;

function lastRun(key){
  try { return +localStorage.getItem("ran:" + key) || 0; } catch (e) { return 0; }
}
function noteRun(key){
  try { localStorage.setItem("ran:" + key, String(Date.now())); } catch (e) {}
}
function due(key, every){ return Date.now() - lastRun(key) > (every || WEEK); }

/* ---- after a record is added ------------------------------------
   A new record has no year, no description, no rating and no price, and
   the collection's value has changed. Rather than each caller
   remembering that list, they call this. */
function afterRecordAdded(){
  if (!isOwner()) return;

  /* Reload and REDRAW, rather than asking someone to pull down. A record
     you just added not appearing is the app looking broken; and the
     sheet write has already returned, so there is nothing to wait for
     beyond Google publishing the change. */
  reloadCollection();
  /* Let the other devices know, so they reload too rather than showing a
     collection that is quietly one record behind. */
  if (typeof noteCollectionChanged === "function") noteCollectionChanged();

  setTimeout(function(){
    if (typeof fillYears === "function") fillYears({ el: null, asText: true });
    if (typeof takeSnapshot === "function") takeSnapshot(function(){});
    if (typeof sweepValues === "function") sweepValues();
  }, 3000);
}

/* Re-reads the sheet and redraws whatever is on screen. The published
   CSV can lag a moment behind a write, so it tries twice \u2014 once
   immediately, once a few seconds later \u2014 and the second pass is
   harmless if the first already caught it. */
function reloadCollection(cb){
  var before = (typeof RECS !== "undefined") ? RECS.length : 0;

  function pass(n){
    if (typeof loadSheet !== "function") return;
    loadSheet();
    setTimeout(function(){
      var now = (typeof RECS !== "undefined") ? RECS.length : 0;
      redrawEverything();
      if (now === before && n < 2){ setTimeout(function(){ pass(n + 1); }, 4000); }
      else if (cb) cb(now);
    }, 1500);
  }
  pass(1);
}

/* Every view that reads the collection, redrawn in place. */
function redrawEverything(){
  [["render", null],
   ["renderCubePicker", null],
   ["renderCatChips", null],
   ["renderFilingBanner", null],
   ["renderDashComputed", null]
  ].forEach(function(f){
    if (typeof window[f[0]] === "function"){
      try { window[f[0]](); } catch (e) {}
    }
  });
  /* Panels only if they happen to be open. */
  var open = { arrivalsbox: "renderArrivals", gapsbox: "renderGaps",
               filingbox: "renderFiling", valuebody: "renderValueTab" };
  Object.keys(open).forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    var showing = el.classList.contains("show") ||
                  (id === "valuebody" && !document.getElementById("view-value").hidden);
    if (showing && typeof window[open[id]] === "function"){
      try { window[open[id]](); } catch (e) {}
    }
  });
}

/* ---- the weekly round -------------------------------------------- */
function weeklyUpkeep(){
  if (!isOwner() || typeof RECS === "undefined") return;

  /* 1. Discogs first: anything bought since last time. */
  if (due("sync")){
    fetch("/api/discogs-sync", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ passphrase: ownerPass(),
        categories: (typeof COLORS !== "undefined") ? Object.keys(COLORS) : [] })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || !d.ok) return;
      noteRun("sync");
      /* New arrivals need their original-release years. */
      if (d.toAdd && typeof fillYears === "function"){
        fillYears({ el: null, asText: true });
      }
      if (typeof loadSheet === "function") setTimeout(loadSheet, 2000);
    })
    .catch(function(){});
  }

  /* 2. A value point, whether or not per-record pricing has caught up:
        the collection figure is a single call. */
  if (due("valuesnap") && typeof takeSnapshot === "function"){
    takeSnapshot(function(err){ if (!err) noteRun("valuesnap"); });
  }

  /* 3. The slow per-record price sweep picks itself up from here. */
  if (typeof sweepValues === "function") setTimeout(sweepValues, 20000);
}

if (typeof onDataReady === "function"){
  /* Well after the app has settled: none of this is urgent, and it
     should never compete with something the user is waiting for. */
  onDataReady(function(){ setTimeout(weeklyUpkeep, 15000); });
}
