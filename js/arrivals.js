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

/* Opens the review panel and puts it in front of you. Called after any
   import \u2014 the sync button, the Discogs panel, a manual add \u2014 because a
   record appearing on the shelf without anyone deciding where it goes is
   how a collection quietly stops matching the actual shelf. Nothing is
   filed until you say so. */
function reviewArrivals(count){
  var box = document.getElementById("arrivalsbox");
  if (!box) return;
  box.classList.add("show");
  renderArrivals(count);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderArrivals(justArrived){
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
    (justArrived
      ? "<p class='arrnew'><b>" + justArrived + " record" +
        (justArrived === 1 ? "" : "s") + " just arrived.</b> Nothing has been " +
        "placed yet \u2014 decide where each one goes below.</p>"
      : "") +
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
          /* Category and position are the same question asked twice, so
             they sit together. Both are suggestions and both can be
             changed here \u2014 there is no second screen to go through. */
          "<select class='apos' data-row='" + r.row + "'></select>" +
          "<div class='aplace' data-place='" + r.row + "'></div>" +
        "</div>" +
      "</div>";
    }).join("") +
    "<div class='addrow' style='margin-top:14px'>" +
      "<button class='chip' id='arrfile'>File these " + list.length + "</button>" +
      "<span class='hint' id='arrmsg'></span>" +
    "</div>";

  fillArt(el);
  list.forEach(function(r){ paintPositions(r, r.c); paintPlacement(r); });

  [].forEach.call(el.querySelectorAll(".acat"), function(sel){
    sel.addEventListener("change", function(){
      var row = this.dataset.row;
      var rec = RECS.filter(function(x){ return String(x.row) === String(row); })[0];
      if (!rec) return;
      rec.c = this.value;
      /* The positions belong to the category, so they are rebuilt when
         it changes rather than offering neighbours from the old one. */
      paintPositions(rec, this.value);
      paintPlacement(rec);
    });
  });

  document.getElementById("arrfile").addEventListener("click", fileArrivals);
}

/* Fills the position dropdown for one row: every place it could go
   within the chosen category, with the suggested one selected. */
function paintPositions(rec, cat){
  var sel = document.querySelector(".apos[data-row='" + rec.row + "']");
  if (!sel) return;
  if (!cat){ sel.innerHTML = "<option>\u2014 pick a category first \u2014</option>";
             sel.disabled = true; return; }
  sel.disabled = false;

  var peers = RECS.filter(function(x){
    return x.c === cat && !isUnfiled(x) && x.row !== rec.row;
  }).sort(function(x, y){ return (x.pos || 0) - (y.pos || 0); });

  var p = suggestPlacement(rec, cat);
  var suggested = p.before ? ("after:" + p.before.row)
                : p.after  ? ("before:" + p.after.row)
                : "first";

  sel.innerHTML = (peers.length
    ? "<option value='before:" + peers[0].row + "'>Before " +
        esc(peers[0].a + " \u2014 " + peers[0].t) + "</option>" +
      peers.map(function(x){
        return "<option value='after:" + x.row + "'>After " +
               esc(x.a + " \u2014 " + x.t) + "</option>";
      }).join("")
    : "<option value='first'>First in this category</option>");
  sel.value = suggested;
  if (!sel.value) sel.value = sel.options[sel.options.length - 1].value;
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
  var where = p.cubeName ? "goes in " + p.cubeName : "";
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

  /* Honour what was chosen on each row rather than recomputing: the
     dropdowns are the decision, and recalculating quietly ignored any
     change. Positions are consecutive from 1 within a cube, so the
     records after an insertion shift up by one. */
  var byCube = {};
  list.forEach(function(r){
    if (!r.c){ skipped++; return; }
    var map = cubeMap();
    var cube = map[r.c];
    if (!cube){ skipped++; return; }

    var sel = document.querySelector(".apos[data-row='" + r.row + "']");
    var choice = sel ? sel.value : null;

    /* Build the cube's running order once, then insert into it. */
    if (!byCube[cube]){
      byCube[cube] = RECS.filter(function(x){ return x.k === cube && !isUnfiled(x); })
                         .sort(function(x, y){ return (x.pos || 0) - (y.pos || 0); });
    }
    var order = byCube[cube];

    var at = order.length;
    if (choice === "first" || !choice){
      /* first within its category, which is not necessarily first in
         the cube when the cube holds several categories */
      at = 0;
      for (var i = 0; i < order.length; i++){
        if (order[i].c === r.c){ at = i; break; }
        at = i + 1;
      }
    } else {
      var parts = String(choice).split(":");
      for (var j = 0; j < order.length; j++){
        if (String(order[j].row) === String(parts[1])){
          at = (parts[0] === "before") ? j : j + 1;
          break;
        }
      }
    }
    order.splice(at, 0, r);

    cells.push({ row: r.row, col: 3, value: r.c });      /* category */
    cells.push({ row: r.row, col: 4, value: cube });     /* cube     */
  });

  /* One pass at the end, so several arrivals into the same cube
     renumber against each other rather than fighting. */
  Object.keys(byCube).forEach(function(cube){
    byCube[cube].forEach(function(x, i){
      var pos = i + 1;
      if (x.pos !== pos) cells.push({ row: x.row, col: 10, value: pos });
    });
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
    var n = list.filter(function(r){ return r.c; }).length;
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
