/* =================== the slow price sweep ===========================
   Pricing 192 records means 192 Discogs calls against a 60-a-minute
   ceiling. Run as a foreground job with a progress bar it kept stalling
   part way and looked broken; and watching a bar for ten minutes is a
   poor use of anyone's attention.

   So it runs the way the cover sweep does: quietly, a small batch at a
   time, whenever the app is open, picking up wherever it stopped. No
   bar, no waiting. If it takes three sessions to work through the
   collection, nothing is waiting on it \u2014 the headline valuation is a
   single call and arrives immediately.

   It is deliberately unhurried: half of Discogs' allowance, and it
   yields entirely whenever anything you actually asked for is running. */

var SWEEP_BATCH = 15;
var sweepStopped = false;
var sweepRunning = false;

function sweepState(){
  try { return JSON.parse(localStorage.getItem("valueSweep") || "{}"); }
  catch (e) { return {}; }
}
function noteSweep(patch){
  var s = sweepState();
  Object.keys(patch).forEach(function(k){ s[k] = patch[k]; });
  try { localStorage.setItem("valueSweep", JSON.stringify(s)); } catch (e) {}
}

function sweepValues(){
  if (sweepRunning || sweepStopped) return;
  if (!isOwner() || !RECS.length) return;

  /* Nothing to do if every priceable record already has a value. */
  var missing = RECS.filter(function(r){ return r.d && !r.val; }).length;
  if (!missing){ noteSweep({ done: true, at: Date.now() }); return; }

  sweepRunning = true;

  (function step(){
    if (sweepStopped){ sweepRunning = false; return; }
    fetch("/api/fill", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "value", passphrase: ownerPass(), limit: SWEEP_BATCH })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || !d.ok){ sweepRunning = false; return; }
      noteSweep({ at: Date.now(), remaining: d.remaining, done: !!d.done });
      paintSweep(d);
      if (d.done){
        sweepRunning = false;
        /* the collection changed value; record the point */
        if (typeof takeSnapshot === "function") takeSnapshot(function(){});
        return;
      }
      /* Wait exactly as long as Discogs asked, or a comfortable gap. */
      setTimeout(step, d.pause ? (d.pause * 1000) : 4000);
    })
    .catch(function(){
      /* A network blip shouldn't end the sweep for the session. */
      setTimeout(step, 30000);
    });
  })();
}

/* A quiet line on the Value tab, if it happens to be open. No bar: this
   is background work and there is nothing to wait for. */
function paintSweep(d){
  var el = document.getElementById("sweepnote");
  if (!el) return;
  el.textContent = d.done
    ? "All records priced."
    : "Pricing in the background \u2014 " + d.remaining + " to go. " +
      "It carries on while the app is open and resumes next time.";
}

if (typeof onDataReady === "function"){
  onDataReady(function(){ setTimeout(sweepValues, 12000); });
}
