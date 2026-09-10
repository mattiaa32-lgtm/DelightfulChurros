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

/* CUBE_NAMES lives in data.js */

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
  /* Filing writes cube numbers to the sheet from this map, so two
     devices disagreeing about it is worse than cosmetic. */
  if (typeof pushShared === "function") pushShared();
}

/* Where a category sits WITHIN its cube. Two categories sharing a cube
   otherwise interleave alphabetically by artist, which is not how a
   shelf works \u2014 you keep the metal together, then the jazz. Stored
   separately from the cube map so an existing layout keeps working; a
   category with no order falls to the end, alphabetically. */
function catOrder(){
  var o = {};
  try { o = JSON.parse(localStorage.getItem("catOrder") || "{}"); } catch (e) {}
  return o;
}
function saveCatOrder(o){
  try { localStorage.setItem("catOrder", JSON.stringify(o)); } catch (e) {}
  if (typeof pushShared === "function") pushShared();
}
function orderOf(cat){
  var o = catOrder();
  return (typeof o[cat] === "number") ? o[cat] : 999;
}

/* 1..n for the configured shelf. */
function cubeList(){
  var out = [], n = (typeof cubeCount === "function") ? cubeCount() : 4;
  for (var i = 1; i <= n; i++) out.push(i);
  return out;
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
    /* Grouped by cube, so the screen shows the shelf rather than an
       alphabetical list: which categories share a cube, and in what
       order they run along it. */
    (function(){
      var groups = { 0:[] };
      cubeList().forEach(function(n){ groups[n] = []; });
      names.forEach(function(c){ (groups[map[c] || 0]).push(c); });
      Object.keys(groups).forEach(function(k){
        groups[k].sort(function(a, b){
          var d = orderOf(a) - orderOf(b);
          return d !== 0 ? d : a.localeCompare(b);
        });
      });
      return "<div class='cubemap'>" + cubeList().concat([0]).map(function(k){
        var list = groups[k];
        if (!list.length) return "";
        return "<div class='cubegrp'><div class='cubehd'>" +
            (k ? esc(CUBE_NAMES[k]) : "No cube yet") + "</div>" +
          list.map(function(c, i){
            return "<div class='cmrow'>" +
              "<span class='cmdot' style='background:" + (COLORS[c] || "#7E7973") + "'></span>" +
              "<span class='cmname'>" + esc(c) + "</span>" +
              "<span class='cmn'>" + cats[c] + "</span>" +
              (k ? "<span class='cmmove'>" +
                "<button class='cmarrow' data-up=\"" + esc(c) + "\"" +
                  (i === 0 ? " disabled" : "") + " aria-label='Move up'>\u2191</button>" +
                "<button class='cmarrow' data-down=\"" + esc(c) + "\"" +
                  (i === list.length - 1 ? " disabled" : "") + " aria-label='Move down'>\u2193</button>" +
              "</span>" : "") +
              "<select class='cmsel' data-cat=\"" + esc(c) + "\">" +
                "<option value=''>\u2014</option>" +
                /* however many cubes the shelf actually has */
                cubeList().map(function(n){
                  return "<option value='" + n + "'" +
                         (map[c] === n ? " selected" : "") + ">" + CUBE_NAMES[n] + "</option>";
                }).join("") +
              "</select></div>";
          }).join("") + "</div>";
      }).join("") + "</div>";
    })() +
    /* The shelf's shape belongs here: it is the thing everything else on
       this screen is arranged against. */
    (function(){
      var sh = shelfShape();
      return "<div class='shapebar'><span class='ktitle'>Shelf shape</span>" +
        "<span class='shapectl'>" +
          "<select id='shaperows'>" + [1,2,3,4,5,6].map(function(n){
            return "<option value='" + n + "'" + (sh.rows === n ? " selected" : "") +
                   ">" + n + "</option>"; }).join("") + "</select>" +
          "<span class='shapex'>\u00d7</span>" +
          "<select id='shapecols'>" + [1,2,3,4,5,6].map(function(n){
            return "<option value='" + n + "'" + (sh.cols === n ? " selected" : "") +
                   ">" + n + "</option>"; }).join("") + "</select>" +
        "</span></div>" +
        "<p class='hint'>" + (sh.rows * sh.cols) + " cubes. Changing this doesn't move " +
          "anything \u2014 it only changes what's available to file into.</p>";
    })() +
    "<div class='addrow'>" +
      "<button class='chip' id='filingapply'>File " + unfiled.length + " record" +
        (unfiled.length === 1 ? "" : "s") + "</button>" +
      "<button class='chip' id='filingrenum'>Renumber positions</button>" +
      "<button class='chip' id='filingyears'>Save known years</button>" +
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
  /* Moving a category swaps its order with its neighbour in the same
     cube, then re-renders. Order is only meaningful within a cube, so
     the numbers are normalised per cube each time to stay tidy. */
  [].forEach.call(el.querySelectorAll(".cmarrow"), function(btn){
    btn.addEventListener("click", function(){
      var cat = this.dataset.up || this.dataset.down;
      var dir = this.dataset.up ? -1 : 1;
      var m = cubeMap(), cube = m[cat];
      if (!cube) return;
      var peers = Object.keys(m).filter(function(c){ return m[c] === cube; })
        .sort(function(a, b){
          var d = orderOf(a) - orderOf(b);
          return d !== 0 ? d : a.localeCompare(b);
        });
      var at = peers.indexOf(cat);
      var to = at + dir;
      if (at < 0 || to < 0 || to >= peers.length) return;
      peers.splice(to, 0, peers.splice(at, 1)[0]);
      var o = catOrder();
      peers.forEach(function(c, i){ o[c] = i; });
      saveCatOrder(o);
      renderFiling();
    });
  });
  ["shaperows", "shapecols"].forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", function(){
      saveShelfShape(+document.getElementById("shaperows").value,
                     +document.getElementById("shapecols").value);
      renderFiling();
      if (typeof render === "function") render();
    });
  });
  document.getElementById("filingapply").addEventListener("click", applyFiling);
  document.getElementById("filingrenum").addEventListener("click", function(){
    applyFiling(true);
  });
  var yb = document.getElementById("filingyears");
  if (yb) yb.addEventListener("click", saveKnownYears);
}

/* Works out every cell that needs writing, then sends them in batches.
   `renumberAll` also rewrites positions for records that already have
   one, which is what you want after moving a category to another cube. */
function applyFiling(renumberAll){
  var msg = document.getElementById("filingmsg");
  if (!isOwner()){ msg.textContent = "Unlock editing first."; return; }
  var map = cubeMap();
  var cells = [];
  /* Every record is considered, not just the unfiled ones.
     This screen's whole purpose is deciding which cube a category lives
     in \u2014 so changing one has to move the records already in it. Looking
     only at unfiled records meant the dropdown appeared to do nothing
     for an established category, while positions were rewritten anyway,
     which is a confusing half-result. Records whose cube already matches
     are skipped, so this stays cheap. */
  var missing = [];
  var moved = 0;
  RECS.forEach(function(r){
    if (!r.c) { missing.push(r); return; }
    var cube = map[r.c];
    if (!cube) { missing.push(r); return; }
    if (r.k !== cube || !r.cubeSet) {
      cells.push({ row: r.row, col: 4, value: cube });
      if (r.cubeSet) moved++;         // an already-filed record changing cube
    }
  });

  if (!cells.length && !renumberAll){
    msg.textContent = missing.length
      ? "Nothing to file \u2014 " + missing.length + " record" +
        (missing.length === 1 ? " has" : "s have") + " no category, or its category has no cube set."
      : "Nothing to file.";
    return;
  }

  /* Positions, per cube, consecutive from 1.
     They used to be spaced 10 apart so a record could be slipped between
     two others by hand. The app places records itself now, so the gaps
     bought nothing and made the numbers harder to read against a shelf.
     Within a cube the categories run in the order set on this screen,
     and records run alphabetically inside their category. */
  var byCube = {};
  RECS.forEach(function(r){
    var cube = (r.c && map[r.c]) || (r.cubeSet ? r.k : null);
    if (!cube) return;
    (byCube[cube] = byCube[cube] || []).push(r);
  });
  Object.keys(byCube).forEach(function(k){
    byCube[k].sort(function(x, y){
      var ox = orderOf(x.c), oy = orderOf(y.c);
      if (ox !== oy) return ox - oy;                       /* category run */
      if (x.c !== y.c) return x.c.localeCompare(y.c);      /* stable tie-break */
      return recordSortKey(x).localeCompare(recordSortKey(y));
    });
    byCube[k].forEach(function(r, i){
      var pos = i + 1;
      var changedCube = r.c && map[r.c] && r.k !== map[r.c];
      if (renumberAll === true || r.pos === null || !r.cubeSet || changedCube){
        if (r.pos !== pos) cells.push({ row: r.row, col: 10, value: pos });
      }
    });
  });

  msg.textContent = "Writing " + cells.length + " cell" + (cells.length === 1 ? "" : "s") + "\u2026";
  var i = 0;
  function next(){
    if (i >= cells.length){
      if (typeof reloadCollection === "function") reloadCollection();
      msg.textContent = "Done" + (moved ? " \u2014 moved " + moved + " record" +
        (moved === 1 ? "" : "s") + " to a different cube" : "") + ". " + (missing.length
        ? missing.length + " record" + (missing.length === 1 ? "" : "s") +
          " still need a category or a cube for it. " : "") +
        ".";
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
  el.innerHTML = "<b>" + n + "</b> new record" + (n === 1 ? "" : "s") +
    " to place on the shelf. <a href='#' id='filingopen'>Place " +
    (n === 1 ? "it" : "them") + "</a>";
  document.getElementById("filingopen").addEventListener("click", function(e){
    e.preventDefault();
    /* the banner is about new records, so it opens the arrivals list
       rather than the whole-shelf layout screen */
    var box = document.getElementById("arrivalsbox");
    box.classList.add("show");
    if (typeof renderArrivals === "function") renderArrivals();
    box.scrollIntoView({ behavior:"smooth", block:"center" });
  });
}
onDataReady(renderFilingBanner);

/* ---- persist the years the app already worked out ------------------
   The decade charts have been reading years from this browser's cache,
   filled by the background lookups. That means they exist on one device
   and nowhere else: clear the cache, or open the app on a laptop, and
   they're gone.

   The sheet is the durable copy, so this writes what's already known
   straight into column H. No API calls, no quota, no waiting — the
   values are sitting in localStorage already. Whatever genuinely isn't
   known yet is left for the Discogs master lookup. */
function saveKnownYears(){
  var msg = document.getElementById("filingmsg");
  function say(t){ if (msg) msg.textContent = t; }
  if (!isOwner()){ say("Unlock editing first."); return; }

  var cells = [];
  RECS.forEach(function(r){
    if (r.fy) return;                       /* already in the sheet */
    var y = (typeof cachedYear === "function") ? cachedYear(r) : "";
    if (/^\d{4}$/.test(y)) cells.push({ row: r.row, col: 8, value: y });
  });

  if (!cells.length){
    say("Nothing to save \u2014 no years cached that aren't already in the sheet.");
    return;
  }
  say("Saving " + cells.length + " year" + (cells.length === 1 ? "" : "s") + "\u2026");
  sheetWrite("setCells", { cells: cells }, function(err){
    if (err){
      say(err.message === "read-only" ? "Unlock editing first."
                                      : "Couldn't write: " + err.message);
      return;
    }
    say("Saved " + cells.length + " original release year" +
        (cells.length === 1 ? "" : "s") + " to the sheet.");
  });
}
