/* =================== filing ==========================================
   A record arrives from Discogs with a suggested category but no cube,
   and that empty cube is what marks it as unfiled.

   Because categories live in fixed cubes, filing is mostly not a
   per-record job: say which cube each category belongs to once, and
   every record follows. That turns filing a whole imported collection
   into a few taps rather than one per record.

   Positions are assigned at the same time, sparse (10, 20, 30...) and
   in the filing order \u2014 artist then title, articles ignored \u2014 so a
   record can later be moved between two others without renumbering.

   Everything is written in batches: one request per hundred cells
   rather than one per record. */

var CUBE_NAMES = { 1: "Top left", 2: "Top right", 3: "Bottom left", 4: "Bottom right" };

function unfiledRecords(){
  return RECS.filter(function(r){ return !r.k || !String(r.k).match(/^[1-4]$/); });
}
/* A record is unfiled when the sheet's Cube cell is empty. adopt()
   defaults a blank cube to 1 so the shelf still renders, so the blank
   has to be read from the row itself rather than from r.k. */
function isUnfiled(r){ return !r.cubeSet; }

function cubeMap(){
  var m = {};
  try { m = JSON.parse(localStorage.getItem("cubeMap") || "{}"); } catch (e) {}
  /* Seed from what's already on the shelf: whichever cube a category's
     records mostly sit in is the cube that category lives in. */
  var tally = {};
  RECS.forEach(function(r){
    if (!r.c || !r.cubeSet) return;
    tally[r.c] = tally[r.c] || {};
    tally[r.c][r.k] = (tally[r.c][r.k] || 0) + 1;
  });
  Object.keys(tally).forEach(function(cat){
    if (m[cat]) return;
    var best = null, n = -1;
    Object.keys(tally[cat]).forEach(function(k){
      if (tally[cat][k] > n) { n = tally[cat][k]; best = +k; }
    });
    if (best) m[cat] = best;
  });
  return m;
}
function saveCubeMap(m){
  try { localStorage.setItem("cubeMap", JSON.stringify(m)); } catch (e) {}
}

function renderFiling(){
  var el = document.getElementById("filingbody");
  if (!el) return;
  var unfiled = RECS.filter(isUnfiled);
  var map = cubeMap();

  /* every category in use, plus any the app knows about */
  var cats = {};
  RECS.forEach(function(r){ if (r.c) cats[r.c] = (cats[r.c] || 0) + 1; });
  Object.keys(COLORS).forEach(function(c){ if (!cats[c]) cats[c] = 0; });
  var names = Object.keys(cats).sort(function(a, b){ return cats[b] - cats[a]; });

  var noCat = unfiled.filter(function(r){ return !r.c; }).length;

  el.innerHTML =
    "<p class='hint'>" +
      (unfiled.length
        ? "<b>" + unfiled.length + "</b> record" + (unfiled.length === 1 ? "" : "s") +
          " have no cube yet." +
          (noCat ? " " + noCat + " also have no category \u2014 set those below or in the sheet." : "")
        : "Everything has a cube. Nothing to file.") +
    "</p>" +
    "<div class='cubemap'>" +
      names.map(function(c){
        return "<div class='cmrow'>" +
          "<span class='cmdot' style='background:" + (COLORS[c] || "#7E7973") + "'></span>" +
          "<span class='cmname'>" + esc(c) + "</span>" +
          "<span class='cmn'>" + cats[c] + "</span>" +
          "<select class='cmsel' data-cat=\"" + esc(c) + "\">" +
            "<option value=''>\u2014</option>" +
            [1,2,3,4].map(function(k){
              return "<option value='" + k + "'" +
                     (map[c] === k ? " selected" : "") + ">" + CUBE_NAMES[k] + "</option>";
            }).join("") +
          "</select></div>";
      }).join("") +
    "</div>" +
    "<div class='addrow'>" +
      "<button class='chip' id='filingapply'>File " + unfiled.length + " record" +
        (unfiled.length === 1 ? "" : "s") + "</button>" +
      "<button class='chip' id='filingrenum'>Renumber positions</button>" +
    "</div>" +
    "<p class='hint' id='filingmsg'></p>";

  [].forEach.call(el.querySelectorAll(".cmsel"), function(sel){
    sel.addEventListener("change", function(){
      var m = cubeMap();
      if (this.value) m[this.dataset.cat] = +this.value;
      else delete m[this.dataset.cat];
      saveCubeMap(m);
    });
  });
  document.getElementById("filingapply").addEventListener("click", applyFiling);
  document.getElementById("filingrenum").addEventListener("click", function(){
    applyFiling(true);
  });
}

/* Works out every cell that needs writing, then sends them in batches.
   `renumberAll` also rewrites positions for records that already have
   one, which is what you want after moving a category to another cube. */
function applyFiling(renumberAll){
  var msg = document.getElementById("filingmsg");
  if (!isOwner()){ msg.textContent = "Unlock editing first."; return; }
  var map = cubeMap();
  var cells = [];
  var targets = renumberAll === true ? RECS.slice() : RECS.filter(isUnfiled);

  var missing = [];
  targets.forEach(function(r){
    if (!r.c) { missing.push(r); return; }
    var cube = map[r.c];
    if (!cube) { missing.push(r); return; }
    if (r.k !== cube || !r.cubeSet) cells.push({ row: r.row, col: 4, value: cube });
  });

  if (!cells.length && !renumberAll){
    msg.textContent = missing.length
      ? "Nothing to file \u2014 " + missing.length + " record" +
        (missing.length === 1 ? " has" : "s have") + " no category, or its category has no cube set."
      : "Nothing to file.";
    return;
  }

  /* positions, per cube, in filing order */
  var byCube = {};
  RECS.forEach(function(r){
    var cube = (r.c && map[r.c]) || (r.cubeSet ? r.k : null);
    if (!cube) return;
    (byCube[cube] = byCube[cube] || []).push(r);
  });
  Object.keys(byCube).forEach(function(k){
    byCube[k].sort(function(x, y){
      return recordSortKey(x).localeCompare(recordSortKey(y));
    });
    byCube[k].forEach(function(r, i){
      var pos = (i + 1) * 10;
      if (renumberAll === true || r.pos === null || !r.cubeSet){
        if (r.pos !== pos) cells.push({ row: r.row, col: 10, value: pos });
      }
    });
  });

  msg.textContent = "Writing " + cells.length + " cell" + (cells.length === 1 ? "" : "s") + "\u2026";
  var i = 0;
  function next(){
    if (i >= cells.length){
      msg.textContent = "Done. " + (missing.length
        ? missing.length + " record" + (missing.length === 1 ? "" : "s") +
          " still need a category or a cube for it. " : "") +
        "Pull down to refresh.";
      return;
    }
    var batch = cells.slice(i, i + 100);
    i += 100;
    sheetWrite("setCells", { cells: batch }, function(err){
      if (err){ msg.textContent = "Write failed: " + err.message; return; }
      next();
    });
  }
  next();
}

(function(){
  var link = document.getElementById("filinglink");
  if (!link) return;
  link.addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("filingbox");
    box.classList.toggle("show");
    if (box.classList.contains("show")){
      renderFiling();
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
})();

/* ---- a prompt on the shelf, so filing doesn't need discovering ----
   Records arrive from a sync with no cube, and nothing on the shelf
   would otherwise say so: they'd just quietly pile up in cube 1. */
function renderFilingBanner(){
  var el = document.getElementById("filingbanner");
  if (!el || typeof RECS === "undefined") return;
  var n = RECS.filter(isUnfiled).length;
  if (!n || !isOwner()){ el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = "<b>" + n + "</b> record" + (n === 1 ? "" : "s") +
    " not filed into a cube yet. <a href='#' id='filingopen'>File them</a>";
  document.getElementById("filingopen").addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("filingbox");
    box.classList.add("show");
    renderFiling();
    box.scrollIntoView({ behavior:"smooth", block:"center" });
  });
}
onDataReady(renderFilingBanner);
