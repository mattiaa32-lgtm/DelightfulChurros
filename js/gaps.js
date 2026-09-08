/* =================== filling in the blanks ==========================
   Data arrives from several places — Discogs for records, covers,
   pressing years and masters; the AI for descriptions — and each has
   its own way of being interrupted: a timeout, a quota, a sync that
   ran before a feature existed. The result is a sheet with holes in
   different columns for different reasons.

   Rather than remembering which button fixes which column, this reports
   exactly what's missing and runs everything that can fill it. It is
   safe to press at any time: every underlying step only fills blanks
   and skips what's already there. */

function gapReport(){
  var g = { total: RECS.length, noId:[], noCover:[], noFirst:[], noPress:[],
            /* noPress is the pressing YEAR; noPressRec is the pressing
               RECOMMENDATION. They were briefly the same name, which
               made both counts wrong and pushed the totals past the
               number of records. */
            noCategory:[], noCube:[], noDesc:[], noRate:[], noPressRec:[], noOwned:[],
            noValue:[] };
  RECS.forEach(function(r){
    if (!r.d) g.noId.push(r);
    if (!r.img && !resolvedCover(r)) g.noCover.push(r);
    if (!r.fy) g.noFirst.push(r);
    if (!r.py) g.noPress.push(r);
    if (!(r.c || "").trim()) g.noCategory.push(r);
    if (isUnfiled(r)) g.noCube.push(r);
    if (!r.desc) g.noDesc.push(r);
    if (!r.rate) g.noRate.push(r);
    if (!r.press) g.noPressRec.push(r);
    if (!r.owned) g.noOwned.push(r);
    if (!r.val) g.noValue.push(r);
  });
  return g;
}

function renderGaps(){
  var el = document.getElementById("gapsbody");
  if (!el) return;
  var g = gapReport();

  /* key, label, records, why, which step fills it */
  var rows = [
    ["sync",  "Discogs Link",   g.noId,       "matched by artist and title when you sync"],
    ["sync",  "Cover",          g.noCover,    "comes from Discogs with the record"],
    ["years", "First Released", g.noFirst,    "looked up from the Discogs master release"],
    ["sync",  "Pressing Year",  g.noPress,    "comes from Discogs with the record"],
    ["sync",  "Category",       g.noCategory, "suggested from the Discogs genres"],
    [null,    "Cube",           g.noCube,     "you choose \u2014 see New arrivals"],
    ["desc",  "Description",    g.noDesc,     "written by the AI, and quota-limited"],
    ["rate",  "Rating",         g.noRate,     "scored once by the AI, then left alone"],
    ["press", "Preferred Pressing", g.noPressRec, "which pressing is worth owning"],
    ["owned", "Pressing Score", g.noOwned, "how good the copy you own is"],
    /* Not fillable from here: pricing runs as a slow background sweep
       (js/valuesweep.js) because Discogs' rate limit makes it a ten
       minute job, and a progress bar for that is worse than nothing. */
    [null,    "Value",          g.noValue, "priced in the background, a few at a time"]
  ];

  var fixable = {};
  rows.forEach(function(r){ if (r[0] && r[2].length) fixable[r[0]] = true; });
  var anyFixable = Object.keys(fixable).length > 0;

  el.innerHTML =
    "<p class='hint'>What the sheet is missing, out of <b>" + g.total + "</b> records.</p>" +
    rows.map(function(r){
      var n = r[2].length;
      return "<div class='gaprow" + (n ? "" : " done") + "'>" +
        "<span class='gapname'>" + esc(r[1]) + "</span>" +
        "<span class='gapn'>" + (n ? n + " missing" : "complete") + "</span>" +
        "<span class='gapwhy'>" + esc(r[3]) + "</span>" +
      "</div>";
    }).join("") +
    (anyFixable
      ? "<p class='hint' style='margin-top:14px'>What should it fill in?</p>" +
        "<div class='gappicks'>" +
          (fixable.sync ? pick("sync", "Discogs data", "links, covers, pressing years, categories") : "") +
          (fixable.years ? pick("years", "Release years", g.noFirst.length + " to look up") : "") +
          (fixable.desc ? pick("desc", "Descriptions", g.noDesc.length + " to write \u2014 about " + Math.ceil(g.noDesc.length/20) + " AI requests") : "") +
          (fixable.rate ? pick("rate", "Ratings",
            g.noRate.length + " to score \u2014 about " +
            Math.ceil(g.noRate.length/12) + " AI requests") : "") +
          (fixable.owned ? pick("owned", "Pressing scores",
            g.noOwned.length + " to assess \u2014 about " +
            Math.ceil(g.noOwned.length/12) + " AI requests") : "") +
          (fixable.value ? pick("value", "Values",
            (function(){
              /* Only records with a Discogs link can be priced, so the
                 number here is smaller than the missing count and the
                 difference would otherwise look like an off-by-one. */
              var priceable = g.noValue.filter(function(r){ return r.d; }).length;
              var skipped = g.noValue.length - priceable;
              return priceable + " to price" +
                (skipped ? " (" + skipped + " with no Discogs link can't be)" : "") +
                " \u2014 Discogs, not AI, so no quota cost";
            })()) : "") +
          (fixable.press ? pick("press", "Preferred pressings",
            g.noPressRec.length + " to research \u2014 about " +
            Math.ceil(g.noPressRec.length/12) + " AI requests") : "") +
        "</div>" +
        "<div class='prog' id='gapsprog' hidden><div class='progbar' id='gapsbar'></div></div>" +
        "<div class='addrow' style='margin-top:12px'>" +
          "<button class='chip' id='gapsfill'>Fill in what's missing</button>" +
          "<button class='chip gapsstop' id='gapsstop' hidden>Stop</button>" +
          "<span class='hint' id='gapsmsg'></span>" +
        "</div>"
      : "<p class='hint' style='margin-top:12px'>Nothing left that the app can fill.</p>");

  var b = document.getElementById("gapsfill");
  if (b) b.addEventListener("click", fillGaps);
}

function pick(key, label, note){
  return "<label class='gappick'><input type='checkbox' class='gapcb' value='" + key +
    "' checked> <span><b>" + esc(label) + "</b><br><span class='ahint'>" +
    esc(note) + "</span></span></label>";
}

/* One bar for the whole run, so a long fill shows movement rather than
   a frozen button. */
function setProgress(done, total){
  var wrap = document.getElementById("gapsprog");
  var bar = document.getElementById("gapsbar");
  if (!wrap || !bar) return;
  if (!total){ wrap.hidden = true; return; }
  wrap.hidden = false;
  /* Clamped: the total is estimated from the first batch, and a later
     batch can report more work than that estimate. A bar that runs past
     the end looks broken. */
  var pct = Math.round(done / Math.max(1, total) * 100);
  bar.style.width = Math.min(100, Math.max(2, pct)) + "%";
}

/* Runs only the chosen steps, in the order their data depends on: the
   sync first (records, covers, pressing years, categories), then the
   master-year lookups, which need the ids the sync provides, then the
   descriptions, which are the slow quota-bound part. */
/* Set by the stop button. Every loop checks it between batches, so
   stopping is immediate in practice and never leaves a half-written
   batch \u2014 whatever finished is already saved. */
var gapsAborted = false;

function fillGaps(){
  var msg = document.getElementById("gapsmsg");
  var btn = document.getElementById("gapsfill");
  function say(t){ if (msg) msg.textContent = t; }
  if (!isOwner()){ say("Unlock editing first."); return; }

  var want = {};
  [].forEach.call(document.querySelectorAll(".gapcb"), function(cb){
    if (cb.checked) want[cb.value] = true;
  });
  if (!Object.keys(want).length){ say("Pick at least one thing to fill."); return; }

  gapsAborted = false;
  if (btn) btn.disabled = true;
  var stop = document.getElementById("gapsstop");
  if (stop){
    stop.hidden = false;
    stop.onclick = function(){
      gapsAborted = true;
      stop.hidden = true;
      say("Stopping\u2026 anything already written is saved.");
    };
  }
  var steps = ["sync","years","value","desc","rate","press","owned"]
    .filter(function(k){ return want[k]; });
  var stepNo = 0;

  function finish(note){
    if (btn) btn.disabled = false;
    var st = document.getElementById("gapsstop");
    if (st) st.hidden = true;
    setProgress(0, 0);
    say(note || "Done. Pull down to refresh.");
    setTimeout(function(){
      if (typeof loadSheet === "function") loadSheet();
      setTimeout(renderGaps, 1500);
    }, 400);
  }

  function nextStep(){
    if (gapsAborted) return finish("Stopped. Everything written so far is saved.");
    if (stepNo >= steps.length) return finish();
    var step = steps[stepNo++];
    setProgress(stepNo - 1, steps.length);

    if (step === "sync"){
      say("Syncing from Discogs\u2026");
      fetch("/api/discogs-sync", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ passphrase: ownerPass(),
          categories: (typeof COLORS !== "undefined") ? Object.keys(COLORS) : [] })
      })
      .then(readJSON)
      .then(function(x){
        var d = x.d;
        if (!x.ok || !d || !d.ok) return finish(failMsg(x, "sync"));
        var bits = [];
        if (d.toAdd) bits.push("added " + d.toAdd);
        if (d.toFill) bits.push("filled " + d.toFill);
        if (d.suggested) bits.push("suggested " + d.suggested);
        say(bits.length ? bits.join(", ") + "." : "Nothing new from Discogs.");
        nextStep();
      })
      .catch(function(e){ finish(String(e && e.message || e)); });
      return;
    }

    if (step === "years"){
      fillYears({ el: msg, asText: true, then: nextStep });
      return;
    }

    /* descriptions and evaluations both work the same way: small
       batches, looping, with the bar tracking records rather than
       steps since these are the long ones */
    /* Rating and pressing advice are separate choices \u2014 you may want a
       score without pressing research, or the reverse \u2014 so each is its
       own step and tells the endpoint which field to fill. */
    var isEval = (step === "rate" || step === "press" || step === "owned");
    /* All three fill jobs share one endpoint now (Vercel caps a Hobby
       deployment at twelve functions), so the mode says which. */
    /* Prices come from Discogs rather than the AI, so they cost no
       quota and can run in larger batches. */
    var isValue = (step === "value");
    var endpoint = "/api/fill";
    var mode = isValue ? "value" : isEval ? "eval" : "desc";
    var noun = step === "rate" ? "rating"
             : step === "press" ? "pressing note"
             : step === "owned" ? "pressing score"
             : step === "value" ? "price"
             : "description";
    /* Smaller batches for values: Discogs' window is the constraint, so
       shorter runs with the remaining-quota check between them get
       further than long sprints that trip the limit. */
    var size = isValue ? 20 : isEval ? 12 : 20;
    var extra = isEval ? { only: step } : {};
    var total = 0, written = 0;
    (function batch(){
      fetch(endpoint, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify(Object.assign(
          { mode: mode, passphrase: ownerPass(), limit: size }, extra))
      })
      .then(readJSON)
      .then(function(x){
        var d = x.d;
        if (!x.ok || !d || !d.ok) return finish(failMsg(x, noun + "s"));
        written += (d.filled !== undefined) ? d.filled : (d.priced || 0);
        total = Math.max(total, written + d.remaining);
        setProgress(written, total || 1);
        if (d.quota){
          return finish("Wrote " + written + " " + noun + (written===1?"":"s") +
            ", then hit the " + (d.quota === "daily" ? "daily" : "per-minute") +
            " AI limit. " + (d.quota === "daily"
              ? "It resets at midnight Pacific."
              : "Wait a minute and press again.") +
            " Everything written is saved.");
        }
        if (gapsAborted) return finish("Stopped after " + written + " " + noun +
          (written === 1 ? "" : "s") + ". Everything written is saved.");
        /* Discogs said nothing could be priced \u2014 repeating that for
           another 150 records helps nobody. */
        if (d.note && d.priced === 0 && written === 0 && !d.rateLimited) return finish(d.note);
        /* Rate limited: wait it out and carry on, rather than stopping
           at twenty-odd records as though the job were finished. */
        if (d.rateLimited && !gapsAborted){
          var wait = (d.retryAfter || 60);
          say("Discogs rate limit \u2014 waiting " + wait + "s, then carrying on. " +
              written + " done so far.");
          setTimeout(batch, wait * 1000);
          return;
        }
        if (!d.done){
          /* A rate-limited batch asks for a pause rather than reporting
             completion, so the run waits it out and carries on instead
             of stopping partway. */
          var wait = d.pause ? d.pause * 1000 : (isValue ? 300 : 1200);
          say(d.pause
            ? "Pausing " + d.pause + "s for Discogs\u2019 rate limit \u2014 " +
              written + " priced, " + d.remaining + " to go. It carries on by " +
              "itself; you can also close this and it resumes next time."
            : "Writing " + noun + "s\u2026 " + written + " of " + total + ".");
          setTimeout(batch, wait);
        } else {
          say("Wrote " + written + " " + noun + (written===1?"":"s") + ".");
          /* Once prices are current, record the point \u2014 otherwise the
             history only moves when someone remembers to press the
             button in the Value panel. */
          /* Always snapshot after a value run, even one that priced
             nothing new: the collection figure comes from Discogs in a
             single call and may well have moved regardless. */
          if (isValue){
            fetch(endpoint, {
              method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({ mode:"value", passphrase: ownerPass(), snapshot:true })
            }).then(function(){ nextStep(); }, function(){ nextStep(); });
          } else {
            nextStep();
          }
        }
      })
      .catch(function(e){ finish(String(e && e.message || e)); });
    })();
  }

  nextStep();
}

(function(){
  var link = document.getElementById("gapslink");
  if (!link) return;
  link.addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("gapsbox");
    box.classList.toggle("show");
    if (box.classList.contains("show")){
      renderGaps();
      box.scrollIntoView({ behavior:"smooth", block:"center" });
    }
  });
})();
