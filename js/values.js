/* =================== what it's worth =================================
   Discogs prices are what copies are LISTED at, not what they sell for,
   and a thin market makes any single record noisy. So the per-record
   number is a rough guide and the totals are the part to trust.

   Nothing can tell you what the collection was worth last year, so this
   starts a series today: a dated snapshot each time it runs, and a chart
   that fills in over the coming months. One point is an honest starting
   position rather than a fabricated history. */

function valueHistory(cb){
  fetch("/api/sheet", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ action:"getConfig", key:"value_history" })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var h = [];
    try { h = JSON.parse((d && d.value) || "[]") || []; } catch (e) {}
    cb(h);
  })
  .catch(function(){ cb([]); });
}

function money(n){
  return "\u00a3" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function renderValues(){
  var el = document.getElementById("valuesbody");
  if (!el) return;
  el.innerHTML = "<p class='hint'>Loading\u2026</p>";

  valueHistory(function(hist){
    var priced = RECS.filter(function(r){ return r.val; }).length;
    var latest = hist.length ? hist[hist.length - 1] : null;

    var head =
      "<p class='hint'>What copies are listed at on Discogs \u2014 not what they'd " +
        "sell for. Single records are noisy; the totals are the meaningful part. " +
        "<b>" + priced + "</b> of " + RECS.length + " priced.</p>";

    if (!latest){
      el.innerHTML = head +
        "<p class='hint'>No snapshot yet. Refresh the prices, then take one \u2014 " +
          "that's the first point on the chart.</p>" + valueActions();
      wireValues();
      return;
    }

    var a = latest.all;
    el.innerHTML = head +
      "<div class='valgrid'>" +
        /* Three totals rather than one: the collection valued as if
           every copy were rough, typical, or mint. The spread is the
           honest picture \u2014 a single figure hides how wide it is. */
        valTile("If rough", money(latest.low || a.total), "whole collection") +
        valTile("Typical", money(latest.mid || a.total), a.n + " records") +
        valTile("If mint", money(latest.high || a.total), "whole collection") +
        valTile("Median record", money(a.median), "half are worth more") +
      "</div>" +
      (hist.length > 1
        ? sparkline(hist) +
          "<p class='hint'>" + hist.length + " snapshots since " +
            esc(hist[0].date) + ".</p>"
        : "<p class='hint'>One snapshot, taken " + esc(latest.date) + ". " +
          "Take another in a few weeks and this becomes a trend.</p>") +
      byGroup("By cube", latest.cubes, function(k){ return CUBE_NAMES[k] || ("Cube " + k); }) +
      byGroup("By category", latest.cats, function(k){ return k; }) +
      valueActions();
    wireValues();
  });
}

function valTile(label, big, sub){
  return "<div class='valtile'><div class='ktitle'>" + esc(label) + "</div>" +
    "<div class='valbig'>" + esc(big) + "</div>" +
    "<div class='ksub'>" + esc(sub) + "</div></div>";
}

function byGroup(title, obj, nameOf){
  var keys = Object.keys(obj || {});
  if (!keys.length) return "";
  keys.sort(function(x, y){ return obj[y].total - obj[x].total; });
  return "<div class='valsec'><div class='ktitle'>" + esc(title) + "</div>" +
    keys.map(function(k){
      return "<div class='valrow'><span>" + esc(nameOf(k)) + "</span>" +
        "<span class='valn'>" + money(obj[k].total) +
        " <small>median " + money(obj[k].median) + "</small></span></div>";
    }).join("") + "</div>";
}

/* A plain line, drawn from the snapshots themselves. Enough to see a
   direction; the numbers above are what you'd actually read. */
function sparkline(hist){
  var vals = hist.map(function(p){ return p.all.total; });
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  var span = (hi - lo) || 1;
  var w = 300, h = 60;
  var pts = vals.map(function(v, i){
    var x = vals.length === 1 ? w / 2 : (i / (vals.length - 1)) * w;
    var y = h - ((v - lo) / span) * (h - 8) - 4;
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  return "<svg class='valspark' viewBox='0 0 " + w + " " + h + "' preserveAspectRatio='none'>" +
    "<polyline points='" + pts + "' fill='none' stroke='var(--accent)' stroke-width='2'/></svg>";
}

function valueActions(){
  /* Fetching prices lives in "Fill in the blanks" with every other
     top-up job; having a second button here meant two places doing the
     same thing. A manual snapshot stays, for taking a point deliberately
     rather than waiting for the weekly one. */
  return "<p class='hint'>Prices are fetched in <b>Fill in the blanks</b>, " +
      "alongside everything else that tops the sheet up.</p>" +
    "<div class='addrow' style='margin-top:10px'>" +
      "<button class='chip' id='valsnap'>Take a snapshot now</button>" +
    "</div><p class='hint' id='valmsg'></p>";
}

function wireValues(){
  var msg = function(t){ var m = document.getElementById("valmsg"); if (m) m.textContent = t; };

  var rb = document.getElementById("valrefresh");
  if (rb) rb.addEventListener("click", function(){
    if (!isOwner()){ msg("Unlock editing first."); return; }
    rb.disabled = true;
    var done = 0;
    (function step(){
      fetch("/api/fill", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ mode: "value", passphrase: ownerPass(), limit: 40 })
      })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d || !d.ok){ msg((d && (d.detail || d.error)) || "Couldn't fetch prices."); rb.disabled = false; return; }
        done += d.priced;
        if (!d.done){
          msg("Pricing\u2026 " + done + " done, " + d.remaining + " to go.");
          setTimeout(step, 400);
        } else {
          msg("Priced " + done + " record" + (done === 1 ? "" : "s") + ".");
          rb.disabled = false;
        }
      })
      .catch(function(){ msg("Couldn't reach the pricing service."); rb.disabled = false; });
    })();
  });

  var sb = document.getElementById("valsnap");
  if (sb) sb.addEventListener("click", function(){
    if (!isOwner()){ msg("Unlock editing first."); return; }
    msg("Taking a snapshot\u2026");
    fetch("/api/fill", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ mode: "value", passphrase: ownerPass(), snapshot: true })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || !d.ok){ msg((d && d.error) || "Couldn't take a snapshot."); return; }
      msg("Snapshot " + d.points + " recorded.");
      renderValues();
    })
    .catch(function(){ msg("Couldn't reach the service."); });
  });
}

/* ---- weekly, on its own ---------------------------------------------
   A value series is only useful if the points keep coming, and nobody
   remembers to press a button every Sunday. So the first time the app is
   opened after a week has passed, it refreshes the prices and takes a
   snapshot in the background.

   Prices are the slow part \u2014 one Discogs call per record \u2014 so this
   works through them in batches and only snapshots once they are done.
   Interrupting it costs nothing: the next open picks up where it
   stopped, and a snapshot on a date that already has one replaces it
   rather than adding a second point. */
var VALUE_EVERY_MS = 7 * 24 * 3600 * 1000;

function lastValueRun(){
  try { return +localStorage.getItem("lastValueRun") || 0; } catch (e) { return 0; }
}
function noteValueRun(){
  try { localStorage.setItem("lastValueRun", String(Date.now())); } catch (e) {}
}

function weeklyValueRun(){
  if (!isOwner()) return;
  if (Date.now() - lastValueRun() < VALUE_EVERY_MS) return;
  if (!RECS.length) return;

  var rounds = 0;
  (function step(){
    if (++rounds > 12) return;          /* don't grind forever in one session */
    fetch("/api/fill", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ mode: "value", passphrase: ownerPass(), limit: 40 })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || !d.ok) return;
      if (!d.done){ setTimeout(step, 1500); return; }
      /* prices are current: record the point */
      fetch("/api/fill", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ mode: "value", passphrase: ownerPass(), snapshot: true })
      })
      .then(function(r){ return r.json(); })
      .then(function(){ noteValueRun(); })
      .catch(function(){});
    })
    .catch(function(){});
  })();
}

if (typeof onDataReady === "function"){
  onDataReady(function(){ setTimeout(weeklyValueRun, 25000); });
}

(function(){
  var link = document.getElementById("valueslink");
  if (!link) return;
  link.addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("valuesbox");
    box.classList.toggle("show");
    if (box.classList.contains("show")){
      renderValues();
      box.scrollIntoView({ behavior:"smooth", block:"start" });
    }
  });
})();
