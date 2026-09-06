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
            noCategory:[], noCube:[], noDesc:[] };
  RECS.forEach(function(r){
    if (!r.d) g.noId.push(r);
    if (!r.img && !resolvedCover(r)) g.noCover.push(r);
    if (!r.fy) g.noFirst.push(r);
    if (!r.py) g.noPress.push(r);
    if (!(r.c || "").trim()) g.noCategory.push(r);
    if (isUnfiled(r)) g.noCube.push(r);
    if (!r.desc) g.noDesc.push(r);
  });
  return g;
}

function renderGaps(){
  var el = document.getElementById("gapsbody");
  if (!el) return;
  var g = gapReport();

  var rows = [
    ["Discogs link",     g.noId,       "matched by artist and title when you sync"],
    ["Cover",            g.noCover,    "comes from Discogs with the record"],
    ["First released",   g.noFirst,    "looked up from the Discogs master release"],
    ["Pressing year",    g.noPress,    "comes from Discogs with the record"],
    ["Category",         g.noCategory, "suggested from the Discogs genres"],
    ["Cube",             g.noCube,     "you choose \u2014 see New arrivals"],
    ["Description",      g.noDesc,     "written by the AI, and quota-limited"]
  ];

  var anyMissing = rows.some(function(r){ return r[1].length; });

  el.innerHTML =
    "<p class='hint'>What the sheet is missing, out of <b>" + g.total + "</b> records.</p>" +
    rows.map(function(r){
      var n = r[1].length;
      return "<div class='gaprow" + (n ? "" : " done") + "'>" +
        "<span class='gapname'>" + esc(r[0]) + "</span>" +
        "<span class='gapn'>" + (n ? n + " missing" : "complete") + "</span>" +
        "<span class='gapwhy'>" + esc(r[2]) + "</span>" +
      "</div>";
    }).join("") +
    (anyMissing
      ? "<div class='addrow' style='margin-top:14px'>" +
          "<button class='chip' id='gapsfill'>Fill in what's missing</button>" +
          "<span class='hint' id='gapsmsg'></span>" +
        "</div>"
      : "<p class='hint' style='margin-top:12px'>Nothing missing.</p>");

  var b = document.getElementById("gapsfill");
  if (b) b.addEventListener("click", fillGaps);
}

/* Runs the steps in the order their data depends on: the sync first
   (records, covers, pressing years, categories), then the master-year
   lookups, which need the Discogs ids the sync provides. */
function fillGaps(){
  var msg = document.getElementById("gapsmsg");
  var btn = document.getElementById("gapsfill");
  function say(t){ if (msg) msg.textContent = t; }
  if (!isOwner()){ say("Unlock editing first."); return; }
  if (btn) btn.disabled = true;

  say("Syncing from Discogs\u2026");
  fetch("/api/discogs-sync", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ passphrase: ownerPass(),
      categories: (typeof COLORS !== "undefined") ? Object.keys(COLORS) : [] })
  })
  .then(readJSON)
  .then(function(x){
    var d = x.d;
    if (!x.ok || !d || !d.ok) throw new Error(failMsg(x, "sync"));
    var bits = [];
    if (d.toAdd) bits.push("added " + d.toAdd);
    if (d.toFill) bits.push("filled " + d.toFill + " cell" + (d.toFill===1?"":"s"));
    if (d.suggested) bits.push("suggested " + d.suggested + " categor" +
                               (d.suggested===1?"y":"ies"));
    say((bits.length ? bits.join(", ") + ". " : "") + "Looking up release years\u2026");
    /* fillYears reports into the same line and calls back when done */
    fillYears({ el: msg, asText: true, then: function(){
      if (btn) btn.disabled = false;
      /* re-read the sheet so the report reflects what just happened */
      setTimeout(function(){
        if (typeof loadSheet === "function") loadSheet();
        setTimeout(renderGaps, 1500);
      }, 400);
    }});
  })
  .catch(function(err){
    say(String(err && err.message || err));
    if (btn) btn.disabled = false;
  });
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
