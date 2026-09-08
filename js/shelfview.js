/* =================== the shelf, as a shelf =========================
   The app could tell you where a record belongs but gave you no way to
   work through a cube \u2014 after a reorganise you'd be tapping 192 records
   one at a time to re-file them.

   This draws the actual cube grid. Tap a cube and it lists what should
   be in it, in position order, grouped by category: the thing you hold
   up next to the real shelf while putting records back. */

var svCube = null;

function shelfCounts(){
  var m = {};
  RECS.forEach(function(r){ m[r.k] = (m[r.k] || 0) + 1; });
  return m;
}

function renderShelfView(){
  var el = document.getElementById("shelfviewbody");
  if (!el) return;
  var counts = shelfCounts();
  var n = cubeCount();
  var grid = "";
  for (var i = 1; i <= n; i++){
    grid += "<button class='svcube" + (svCube === i ? " on" : "") + "' data-cube='" + i + "'>" +
      "<span class='svname'>" + esc(CUBE_NAMES[i] || ("Cube " + i)) + "</span>" +
      "<span class='svn'>" + (counts[i] || 0) + "</span>" +
    "</button>";
  }
  el.innerHTML = "<div class='svgrid'>" + grid + "</div>" +
                 "<div id='svlist'></div>";
  [].forEach.call(el.querySelectorAll(".svcube"), function(b){
    b.addEventListener("click", function(){
      svCube = (svCube === +this.dataset.cube) ? null : +this.dataset.cube;
      renderShelfView();
    });
  });
  if (svCube) renderCubeList();
}

function renderCubeList(){
  var el = document.getElementById("svlist");
  if (!el) return;
  var list = RECS.filter(function(r){ return r.k === svCube; })
    .sort(function(x, y){ return (x.pos || 0) - (y.pos || 0); });

  if (!list.length){
    el.innerHTML = "<p class='hint'>Nothing filed here yet.</p>";
    return;
  }

  /* Grouped by category, in the order they run along the shelf, so the
     headings match what you're actually looking at. */
  var out = "", lastCat = null;
  list.forEach(function(r){
    if (r.c !== lastCat){
      out += "<div class='svcat'>" +
        "<span class='cmdot' style='background:" + (COLORS[r.c] || "#7E7973") + "'></span>" +
        esc(r.c || "No category") + "</div>";
      lastCat = r.c;
    }
    out += "<div class='svrow' data-i='" + r.i + "'>" +
      "<span class='svpos'>" + (r.pos || "\u2013") + "</span>" +
      "<span class='svrec'><b>" + esc(r.a) + "</b> \u2014 " + esc(r.t) + "</span>" +
    "</div>";
  });

  el.innerHTML =
    "<div class='svhead'>" + esc(CUBE_NAMES[svCube]) + " \u00b7 " + list.length +
      " record" + (list.length === 1 ? "" : "s") + "</div>" + out;

  /* Tapping a line opens the record, so this doubles as a way in. */
  [].forEach.call(el.querySelectorAll(".svrow"), function(row){
    row.addEventListener("click", function(){
      if (typeof open === "function") open(+this.dataset.i);
    });
  });
}

(function(){
  var link = document.getElementById("shelfviewlink");
  if (!link) return;
  link.addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("shelfviewbox");
    box.classList.toggle("show");
    if (box.classList.contains("show")){
      renderShelfView();
      box.scrollIntoView({ behavior:"smooth", block:"start" });
    }
  });
})();
