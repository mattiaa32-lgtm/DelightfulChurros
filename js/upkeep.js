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
  reloadCollection(function(){
    /* An added record has no cube either, so it goes through the same
       review as anything from a sync. */
    if (typeof reviewArrivals === "function") reviewArrivals(1);
  });
  /* Let the other devices know, so they reload too rather than showing a
     collection that is quietly one record behind. */
  if (typeof noteCollectionChanged === "function") noteCollectionChanged();

  setTimeout(function(){
    if (typeof fillYears === "function") fillYears({ el: null, asText: true });
    if (typeof takeSnapshot === "function") takeSnapshot(function(){});
    if (typeof sweepValues === "function") sweepValues();
    /* Years and price were covered; the AI columns were not, so a new
       record sat there with no description, no score and no pressing
       note until someone ran Fill in the blanks by hand. */
    enrichNewRecords();
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

/* Fills the AI columns for anything missing them. One batch of each,
   which covers a handful of new arrivals; a larger backlog is what Fill
   in the blanks is for, and this leaves that alone.

   Runs quietly and one at a time: these share a small per-minute
   allowance, and firing them together is what exhausts it. */
function enrichNewRecords(){
  if (!isOwner() || typeof RECS === "undefined") return;

  var jobs = [];
  if (RECS.some(function(r){ return !r.desc; })) jobs.push({ mode: "desc", limit: 20 });
  if (RECS.some(function(r){ return !r.rate; })) jobs.push({ mode: "eval", only: "rate", limit: 12 });
  if (RECS.some(function(r){ return !r.press; })) jobs.push({ mode: "eval", only: "press", limit: 12 });
  if (RECS.some(function(r){ return !r.owned; })) jobs.push({ mode: "eval", only: "owned", limit: 12 });
  if (!jobs.length) return;

  (function next(i){
    if (i >= jobs.length){
      if (typeof reloadCollection === "function") reloadCollection();
      return;
    }
    var j = jobs[i];
    fetch("/api/fill", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ passphrase: ownerPass() }, j))
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      /* A quota refusal stops the round rather than burning the rest of
         the allowance on requests that will also be refused. */
      if (d && d.quota) return;
      setTimeout(function(){ next(i + 1); }, 4000);
    })
    .catch(function(){ setTimeout(function(){ next(i + 1); }, 4000); });
  })(0);
}

/* ---- ready before you look ----------------------------------------
   Discover and the radar used to generate only when their tab was
   opened, so the picks were never waiting for you and the radar sat
   empty until someone thought to visit it.

   Now the first unlocked device to open the app each day makes the
   day's picks, and the first each week runs the radar. Both are
   published to the sheet, so every other device \u2014 including guest ones
   \u2014 simply receives them.

   Only unlocked devices generate. Neither endpoint checks the
   passphrase, and a guest scanning the shelf's QR code should not be
   the one spending the day's AI allowance.

   Staggered: the picks are one request, the radar is three grounded
   ones with pauses between, and the capable models allow only a few
   requests a minute. */
var lastUpkeepDay = null;

function readyUpkeep(){
  if (typeof isOwner !== "function" || !isOwner()) return;
  if (typeof RECS === "undefined" || !RECS.length) return;

  var today = (typeof todayKey === "function") ? todayKey()
            : new Date().toISOString().slice(0, 10);
  if (lastUpkeepDay === today) return;       /* once per day per session */
  lastUpkeepDay = today;

  /* Today's picks: loadDaily checks this device, then the sheet, and
     only asks the AI if nobody has made today's set yet. */
  setTimeout(function(){
    if (typeof loadDaily === "function") loadDaily(false);
  }, 8000);

  /* The radar, when it is a week old. Same order: local, shared, search. */
  setTimeout(function(){
    if (typeof loadRadar !== "function" || typeof radarCache !== "function") return;
    var c = radarCache();
    var every = (typeof RADAR_EVERY_MS !== "undefined") ? RADAR_EVERY_MS : 7 * 86400000;
    if (!c || !c.at || Date.now() - c.at > every) loadRadar(false);
  }, 40000);
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

  /* 3. Anything still missing its AI columns. */
  enrichNewRecords();

  /* 4. The slow per-record price sweep picks itself up from here. */
  if (typeof sweepValues === "function") setTimeout(sweepValues, 20000);
}

if (typeof onDataReady === "function"){
  onDataReady(function(){ setTimeout(readyUpkeep, 2000); });
  /* The day can turn over while the app sits open in a tab or on a
     phone's home screen; coming back to it is when to notice. */
  document.addEventListener("visibilitychange", function(){
    if (document.visibilityState === "visible") readyUpkeep();
  });
}

if (typeof onDataReady === "function"){
  /* Well after the app has settled: none of this is urgent, and it
     should never compete with something the user is waiting for. */
  onDataReady(function(){ setTimeout(weeklyUpkeep, 15000); });
}
