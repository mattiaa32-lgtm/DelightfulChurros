/* =================== value, as its own tab ==========================
   Prices come from Discogs in DKK and are stored that way, so the series
   has one unit and never needs re-fetching to change currency. Anything
   else is converted for display only, and the rate is stated \u2014 an
   unlabelled converted figure invites more trust than it deserves.

   The chart follows whatever the shelf is filtered to: pick a cube or a
   category and the totals and history narrow with it. */

var VAL_CCY = "DKK";
var VAL_RATES = { DKK: 1, EUR: 0.134, USD: 0.145, GBP: 0.112 };
var valFilter = { cube: 0, cat: "" };

function ccy(n){
  var v = (Number(n) || 0) * (VAL_RATES[VAL_CCY] || 1);
  var sym = { DKK: "kr", EUR: "\u20ac", USD: "$", GBP: "\u00a3" }[VAL_CCY] || "";
  var s = Math.round(v).toLocaleString();
  return VAL_CCY === "DKK" ? s + " " + sym : sym + s;
}

function valRecords(){
  return RECS.filter(function(r){
    if (!r.val) return false;
    if (valFilter.cube && r.k !== valFilter.cube) return false;
    if (valFilter.cat && r.c !== valFilter.cat) return false;
    return true;
  });
}

function valStats(list){
  var mid = [];
  list.forEach(function(r){ mid.push(r.val); });
  var sum = function(a){ return a.reduce(function(x, y){ return x + y; }, 0); };
  var med = function(a){
    if (!a.length) return 0;
    var s = a.slice().sort(function(x, y){ return x - y; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return {
    n: list.length,
    total: sum(mid),
    median: med(mid),
    dearest: list.slice().sort(function(x, y){ return y.val - x.val; })[0],
    cheapest: list.slice().sort(function(x, y){ return x.val - y.val; })[0]
  };
}

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

var VAL_LATEST = null;

function renderValueTab(){
  var el = document.getElementById("valuebody");
  if (!el) return;
  var list = valRecords();
  var s = valStats(list);
  var priced = RECS.filter(function(r){ return r.val; }).length;

  el.innerHTML =
    ccyBar() +
    valFilters() +
    (VAL_LATEST && VAL_LATEST.dgMid
      ? "<div class='valgrid'>" +
          valTile("Minimum", ccy(VAL_LATEST.dgMin), "Discogs, whole collection") +
          valTile("Median", ccy(VAL_LATEST.dgMid), "Discogs, whole collection") +
          valTile("Maximum", ccy(VAL_LATEST.dgMax), "Discogs, whole collection") +
        "</div>" +
        "<p class='hint'>Discogs' own valuation of the collection \u2014 the same " +
          "three figures it shows on a release page, for everything you own. " +
          "The breakdowns below use per-record listings, which run lower.</p>"
      : "") +
    (s.n
      ? "<div class='valgrid'>" +
          valTile("Sum of listings", ccy(s.total), s.n + " record" + (s.n === 1 ? "" : "s")) +
          valTile("Median record", ccy(s.median), "half are worth more") +
          (s.dearest ? valTile("Dearest", ccy(s.dearest.val),
            s.dearest.a + " \u2014 " + s.dearest.t) : "") +
        "</div>"
      : "<p class='hint'>Nothing priced in this selection yet.</p>") +
    "<div id='valchart'></div>" +
    "<div class='addrow' style='margin-top:14px'>" +
      "<button class='chip' id='valsnap'>Take a snapshot now</button>" +
      "<span class='hint' id='valmsg'></span>" +
    "</div>" +
    "<p class='hint' id='sweepnote'></p>" +
    "<p class='hint'>Prices are what copies are <b>listed</b> at on Discogs, not " +
      "what they sold for \u2014 Discogs doesn't publish sale history through its API. " +
      priced + " of " + RECS.length + " records priced; fill the rest from " +
      "<b>Fill in the blanks</b>.</p>";

  wireValueTab();
  valueHistory(function(hist){
    var prev = VAL_LATEST;
    VAL_LATEST = hist.length ? hist[hist.length - 1] : null;
    drawValueChart(hist);
    /* Redraw once, when the headline figures first arrive. */
    if (!prev && VAL_LATEST && VAL_LATEST.dgMid) renderValueTab();
  });
}

function ccyBar(){
  return "<div class='ccybar'>" +
    ["DKK","EUR","USD","GBP"].map(function(c){
      return "<button class='chip ccyb" + (VAL_CCY === c ? " on" : "") +
             "' data-ccy='" + c + "'>" + c + "</button>";
    }).join("") +
    (VAL_CCY === "DKK" ? "" :
      "<span class='hint ccynote'>converted at " + VAL_RATES[VAL_CCY] +
      " per kr \u2014 approximate</span>") +
  "</div>";
}

function valFilters(){
  var cubes = [];
  for (var i = 1; i <= cubeCount(); i++) cubes.push(i);
  var cats = Object.keys(COLORS).sort();
  return "<div class='valfilters'>" +
    "<select id='valcube'><option value='0'>All cubes</option>" +
      cubes.map(function(k){
        return "<option value='" + k + "'" + (valFilter.cube === k ? " selected" : "") +
               ">" + esc(CUBE_NAMES[k]) + "</option>"; }).join("") +
    "</select>" +
    "<select id='valcat'><option value=''>All categories</option>" +
      cats.map(function(c){
        return "<option value=\"" + esc(c) + "\"" + (valFilter.cat === c ? " selected" : "") +
               ">" + esc(c) + "</option>"; }).join("") +
    "</select>" +
  "</div>";
}

function valTile(label, big, sub){
  return "<div class='valtile'><div class='ktitle'>" + esc(label) + "</div>" +
    "<div class='valbig'>" + esc(big) + "</div>" +
    "<div class='ksub'>" + esc(sub) + "</div></div>";
}

/* Three lines, one per figure, over whatever snapshots exist. With a
   single point there is nothing to draw, and saying so beats an empty
   box that looks broken. */
function drawValueChart(hist){
  var el = document.getElementById("valchart");
  if (!el) return;

  var pts = hist.filter(function(p){ return p && p.date; });
  if (pts.length < 2){
    el.innerHTML = "<p class='hint'>" +
      (pts.length ? "One snapshot so far, from " + esc(pts[0].date) +
                    ". The chart appears once there are two."
                  : "No snapshots yet. One is taken automatically each week.") + "</p>";
    return;
  }

  /* Discogs' three figures where they exist, falling back to our sum of
     listings for older snapshots that predate them. */
  var hasDg = pts.some(function(p){ return p.dgMid; });
  var series = hasDg
    ? [{ key: "dgMin", label: "Minimum", colour: "#7E7973" },
       { key: "dgMid", label: "Median",  colour: "var(--accent)" },
       { key: "dgMax", label: "Maximum", colour: "#9BAA57" }]
    : [{ key: "mid", label: "Sum of listings", colour: "var(--accent)" }];
  var all = [];
  pts.forEach(function(p){
    series.forEach(function(s){ if (p[s.key]) all.push(p[s.key]); });
  });
  if (!all.length){ el.innerHTML = ""; return; }
  var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
  var span = (hi - lo) || 1, w = 320, h = 110, pad = 6;

  var lines = series.map(function(s){
    var d = pts.map(function(p, i){
      var v = p[s.key];
      if (!v) return null;
      var x = (i / (pts.length - 1)) * w;
      var y = h - ((v - lo) / span) * (h - pad * 2) - pad;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).filter(Boolean).join(" ");
    return d ? "<polyline points='" + d + "' fill='none' stroke='" + s.colour +
               "' stroke-width='2' stroke-linejoin='round'/>" : "";
  }).join("");

  el.innerHTML =
    "<svg class='valchart' viewBox='0 0 " + w + " " + h + "' preserveAspectRatio='none'>" +
      lines + "</svg>" +
    "<div class='vallegend'>" +
      series.map(function(s){
        return "<span><i style='background:" + s.colour + "'></i>" + s.label + "</span>";
      }).join("") +
      "<span class='valdates'>" + esc(pts[0].date) + " \u2192 " +
        esc(pts[pts.length - 1].date) + "</span>" +
    "</div>";
}

/* Asks Discogs what the collection is worth and records the point. One
   call, so it is quick even when per-record pricing has not finished \u2014
   the headline figures do not depend on it. */
function takeSnapshot(cb){
  fetch("/api/fill", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ mode:"value", passphrase: ownerPass(), snapshot: true })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){ cb(d && d.ok ? null : new Error((d && d.error) || "failed"), d); })
  .catch(function(e){ cb(e, null); });
}

function wireValueTab(){
  var sb = document.getElementById("valsnap");
  if (sb) sb.addEventListener("click", function(){
    var m = document.getElementById("valmsg");
    if (!isOwner()){ if (m) m.textContent = "Unlock editing first."; return; }
    if (m) m.textContent = "Asking Discogs\u2026";
    sb.disabled = true;
    takeSnapshot(function(err, d){
      sb.disabled = false;
      if (err){ if (m) m.textContent = "Couldn't take a snapshot: " + err.message; return; }
      VAL_LATEST = null;
      renderValueTab();
      var m2 = document.getElementById("valmsg");
      if (m2) m2.textContent = d.fromDiscogs
        ? "Snapshot taken from Discogs' own valuation."
        : "Snapshot taken from the listings we have.";
    });
  });
  [].forEach.call(document.querySelectorAll(".ccyb"), function(b){
    b.addEventListener("click", function(){ VAL_CCY = this.dataset.ccy; renderValueTab(); });
  });
  var cu = document.getElementById("valcube");
  if (cu) cu.addEventListener("change", function(){
    valFilter.cube = +this.value; renderValueTab();
  });
  var ca = document.getElementById("valcat");
  if (ca) ca.addEventListener("change", function(){
    valFilter.cat = this.value; renderValueTab();
  });
}

/* ---- weekly, unattended ---- */
var VALUE_EVERY_MS = 7 * 24 * 3600 * 1000;
function lastValueRun(){
  try { return +localStorage.getItem("lastValueRun") || 0; } catch (e) { return 0; }
}
function noteValueRun(){
  try { localStorage.setItem("lastValueRun", String(Date.now())); } catch (e) {}
}
function weeklyValueRun(){
  if (!isOwner() || !RECS.length) return;
  if (Date.now() - lastValueRun() < VALUE_EVERY_MS) return;
  var rounds = 0;
  (function step(){
    if (++rounds > 20) return;
    fetch("/api/fill", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ mode:"value", passphrase: ownerPass(), limit: 40 })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || !d.ok) return;
      if (!d.done){ setTimeout(step, (d.pause || 1) * 1000); return; }
      fetch("/api/fill", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ mode:"value", passphrase: ownerPass(), snapshot: true })
      }).then(function(){ noteValueRun(); }, function(){});
    })
    .catch(function(){});
  })();
}
if (typeof onDataReady === "function"){
  onDataReady(function(){ setTimeout(weeklyValueRun, 25000); });
}

/* ---- a record's own history --------------------------------------
   The Values tab holds one row per record and one column per snapshot
   date, so a record's line is a row of that table. It is fetched once
   per session and kept in memory: asking per record would be a request
   every time a record is opened, for a chart that rarely changes. */
var VAL_SERIES = null;      // { discogsId: [{date, value}, ...] }
var VAL_SERIES_ASKED = false;

function loadValueSeries(cb){
  if (VAL_SERIES) return cb(VAL_SERIES);
  if (VAL_SERIES_ASKED) return cb(null);
  VAL_SERIES_ASKED = true;
  fetch("/api/sheet", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ action:"readValues" })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var rows = (d && d.values) || [];
    if (rows.length < 2){ VAL_SERIES = {}; return cb(VAL_SERIES); }
    var header = rows[0];
    var out = {};
    rows.slice(1).forEach(function(r){
      var id = String(r[0] || "").trim();
      if (!id) return;
      var series = [];
      for (var c = 3; c < header.length; c++){
        var v = parseFloat(String(r[c] == null ? "" : r[c]).replace(/[^\d.]/g, ""));
        if (isFinite(v) && v > 0) series.push({ date: String(header[c]), value: v });
      }
      if (series.length) out[id] = series;
    });
    VAL_SERIES = out;
    cb(VAL_SERIES);
  })
  .catch(function(){ VAL_SERIES = {}; cb(VAL_SERIES); });
}

/* Drawn into whatever element is passed. Two points are the minimum for
   a line to mean anything; below that it says so rather than drawing a
   dot and implying a trend. */
function drawRecordValue(el, rec){
  if (!el || !rec || !rec.d) return;
  loadValueSeries(function(series){
    var s = series && series[String(rec.d)];
    if (!s || s.length < 2){
      el.innerHTML = "<p class='hint'>" +
        (s && s.length === 1
          ? "One reading so far, from " + esc(s[0].date) + ". A line needs two."
          : "No history yet \u2014 a reading is taken each week.") + "</p>";
      return;
    }
    var vals = s.map(function(p){ return p.value; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = (hi - lo) || 1, w = 260, h = 48, pad = 4;
    var pts = s.map(function(p, i){
      var x = (i / (s.length - 1)) * w;
      var y = h - ((p.value - lo) / span) * (h - pad * 2) - pad;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    var first = vals[0], last = vals[vals.length - 1];
    var delta = last - first;
    el.innerHTML =
      "<svg class='recspark' viewBox='0 0 " + w + " " + h + "' preserveAspectRatio='none'>" +
        "<polyline points='" + pts + "' fill='none' stroke='var(--accent)' stroke-width='2'/></svg>" +
      "<p class='hint'>" + esc(s[0].date) + " \u2192 " + esc(s[s.length - 1].date) + " \u00b7 " +
        ccy(first) + " \u2192 " + ccy(last) +
        (delta ? " (" + (delta > 0 ? "+" : "") + ccy(delta) + ")" : " (unchanged)") +
      "</p>";
  });
}
