/* =================== new arrivals ===================================
   After the first import, a sync brings in a handful of records, not a
   collection. Re-presenting every category each time is the wrong shape
   for that: the question is only ever "where does this new one go".

   So filing is split in two:
     Shelf layout   which category lives in which cube. Set once, and
                    changed only when you rearrange the shelves.
     New arrivals   the records that came in without a cube. Each shows
                    a suggested category and the position it would take,
                    both changeable, and they can be filed in one go.

   Position is computed from the same rule the shelf sorts by (artist,
   then title, articles ignored), so the suggestion is simply where the
   record would naturally fall. Accepting it needs no thought; the
   override is there for the records that don't belong in alphabetical
   order. */

function arrivals(){
  return RECS.filter(isUnfiled);
}

/* Where a record would land, given its category and the shelf layout.
   Falls back to the layout when the category has no records yet, so a
   brand-new category still gets a cube. */
function suggestPlacement(rec, category){
  var map = cubeMap();
  /* Placement is worked out against records already ON the shelf. The
     unfiled ones must be excluded: they default to cube 1 until filed,
     so including them drags every suggestion into cube 1 and can even
     make a record its own neighbour. */
  var filed = RECS.filter(function(x){
    return x.c === category && !isUnfiled(x) && x.row !== rec.row;
  });

  /* The cube comes from where that category actually lives \u2014 the
     layout setting first, then whatever the filed records agree on. */
  var cube = map[category] || null;
  if (!cube && filed.length){
    var tally = {};
    filed.forEach(function(x){ tally[x.k] = (tally[x.k] || 0) + 1; });
    cube = +Object.keys(tally).sort(function(a, b){ return tally[b] - tally[a]; })[0];
  }

  var key = recordSortKey(rec);
  var sorted = filed.slice().sort(function(x, y){
    return recordSortKey(x).localeCompare(recordSortKey(y));
  });
  var at = 0;
  while (at < sorted.length && recordSortKey(sorted[at]).localeCompare(key) < 0) at++;

  return {
    cube: cube,
    cubeName: cube ? (CUBE_NAMES[cube] || ("cube " + cube)) : null,
    position: at + 1,
    count: sorted.length,
    before: at > 0 ? sorted[at - 1] : null,
    after: at < sorted.length ? sorted[at] : null
  };
}

function renderArrivals(){
  var el = document.getElementById("arrivalsbody");
  if (!el) return;
  var list = arrivals();

  if (!list.length){
    el.innerHTML = "<p class='hint'>Nothing waiting \u2014 everything on the shelf " +
      "has a cube. New records appear here after a sync.</p>";
    return;
  }

  var cats = Object.keys(COLORS).sort();
  el.innerHTML =
    "<p class='hint'><b>" + list.length + "</b> record" + (list.length === 1 ? "" : "s") +
      " came in without a place on the shelf. The category is a suggestion from " +
      "Discogs' own genres; the position is where it would fall alphabetically.</p>" +
    list.map(function(r){
      var opts = ["<option value=''>\u2014 pick a category \u2014</option>"]
        .concat(cats.map(function(c){
          return "<option value=\"" + esc(c) + "\"" +
                 (c === r.c ? " selected" : "") + ">" + esc(c) + "</option>";
        })).join("");
      return "<div class='arow' data-row='" + r.row + "' data-i='" + r.i + "'>" +
        artBox(r, "arart") +
        "<div class='ameta'>" +
          "<div class='aartist'>" + esc(r.a) + "</div>" +
          "<div class='atitle'>" + esc(r.t) + "</div>" +
          "<select class='acat' data-row='" + r.row + "'>" + opts + "</select>" +
          "<div class='aplace' data-place='" + r.row + "'></div>" +
        "</div>" +
      "</div>";
    }).join("") +
    "<div class='addrow' style='margin-top:14px'>" +
      "<button class='chip' id='arrfile'>File these " + list.length + "</button>" +
      "<span class='hint' id='arrmsg'></span>" +
    "</div>";

  fillArt(el);
  list.forEach(function(r){ paintPlacement(r); });

  [].forEach.call(el.querySelectorAll(".acat"), function(sel){
    sel.addEventListener("change", function(){
      var rec = RECS.filter(function(x){ return String(x.row) === String(this.dataset.row); }, this)[0];
      if (rec){ rec.c = this.value; paintPlacement(rec); }
    });
  });
  document.getElementById("arrfile").addEventListener("click", fileArrivals);
}

function paintPlacement(rec){
  var el = document.querySelector(".aplace[data-place='" + rec.row + "']");
  if (!el) return;
  if (!rec.c){ el.innerHTML = "<span class='ahint'>Pick a category to place it</span>"; return; }
  var p = suggestPlacement(rec, rec.c);
  if (!p.cube){
    el.innerHTML = "<span class='ahint'>No cube set for this category yet \u2014 " +
                   "set one in Shelf layout</span>";
    return;
  }
  var where = p.count
    ? "position " + p.position + " of " + (p.count + 1)
    : "first in this category";
  /* before/after are records, not strings \u2014 naming the neighbour is
     the useful part, so it needs formatting rather than interpolating */
  var neighbour = "";
  if (p.before) neighbour = " \u00b7 after " + esc(p.before.a + ", " + p.before.t);
  else if (p.after) neighbour = " \u00b7 before " + esc(p.after.a + ", " + p.after.t);
  el.innerHTML = "<span class='ahint'>\u2192 <b>" + esc(p.cubeName) + "</b>, " +
    where + neighbour + "</span>";
}

function fileArrivals(){
  var msg = document.getElementById("arrmsg");
  function say(t){ if (msg) msg.textContent = t; }
  if (!isOwner()){ say("Unlock editing first."); return; }

  var list = arrivals();
  var cells = [];
  var skipped = 0;

  list.forEach(function(r){
    if (!r.c){ skipped++; return; }
    var p = suggestPlacement(r, r.c);
    if (!p.cube){ skipped++; return; }
    cells.push({ row: r.row, col: 3, value: r.c });        /* category  */
    cells.push({ row: r.row, col: 4, value: p.cube });     /* cube      */
    cells.push({ row: r.row, col: 10, value: p.position * 10 }); /* position */
  });

  if (!cells.length){
    say(skipped ? "Give them a category first." : "Nothing to file.");
    return;
  }
  say("Filing\u2026");
  sheetWrite("setCells", { cells: cells }, function(err){
    if (err){
      say(err.message === "read-only" ? "Unlock editing first." : "Couldn't write: " + err.message);
      return;
    }
    var n = cells.length / 3;
    if (typeof afterRecordAdded === "function") afterRecordAdded();
    say("Filed " + n + " record" + (n === 1 ? "" : "s") +
        (skipped ? ", " + skipped + " still need a category" : "") +
        ".");
  });
}

(function(){
  var link = document.getElementById("arrivalslink");
  if (!link) return;
  link.addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("arrivalsbox");
    box.classList.toggle("show");
    if (box.classList.contains("show")){
      renderArrivals();
      box.scrollIntoView({ behavior:"smooth", block:"center" });
    }
  });
})();
