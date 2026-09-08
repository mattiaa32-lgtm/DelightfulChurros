/* =================== the cube picker ================================
   The cube filter used to be a row of chips \u2014 All, Top left, Top right
   \u2014 which said nothing about the shelf. Drawing the actual grid instead
   means the control looks like the thing it controls, and the record
   counts are visible without tapping.

   Tapping a cube filters the shelf to it and opens a summary of what's
   in there: which categories, how many of each, in shelf order. Tapping
   it again, or All, puts everything back. Nothing here is destructive \u2014
   it is a view, and every state is one tap from every other. */

var svOpenSummary = false;

function shelfCounts(){
  var m = {};
  RECS.forEach(function(r){ m[r.k] = (m[r.k] || 0) + 1; });
  return m;
}

var svOpenPicker = false;

function renderCubePicker(){
  var el = document.getElementById("cubepick");
  if (!el) return;
  var counts = shelfCounts();
  var n = cubeCount();
  var cur = (typeof cubeFilter !== "undefined") ? cubeFilter : 0;

  /* Collapsed by default: the grid is a control, not the content, and
     on a phone it was pushing the records themselves below the fold.
     The header carries the current state, so collapsing loses nothing. */
  var label = cur
    ? (CUBE_NAMES[cur] || ("Cube " + cur)) + " \u00b7 " + (counts[cur] || 0) + " records"
    : "All cubes \u00b7 " + RECS.length + " records";

  var grid = "";
  for (var i = 1; i <= n; i++){
    var c = counts[i] || 0;
    grid += "<button class='svcube" + (cur === i ? " on" : "") + "' data-cube='" + i + "'>" +
      "<span class='svn'>" + c + "</span>" +
      "<span class='svname'>" + esc(CUBE_NAMES[i] || ("Cube " + i)) + "</span>" +
    "</button>";
  }

  el.innerHTML =
    "<button class='cubehead" + (cur ? " filtered" : "") + "' id='cubehead' " +
        "aria-expanded='" + svOpenPicker + "'>" +
      "<span class='cubeicon'>" + gridIcon(n) + "</span>" +
      "<span class='cubelabel'>" + esc(label) + "</span>" +
      (cur ? "<span class='cubeclear' id='cubeclear'>Clear</span>" : "") +
      "<span class='cubechev'>" + (svOpenPicker ? "\u2303" : "\u2304") + "</span>" +
    "</button>" +
    (svOpenPicker ? "<div class='svgrid'>" + grid + "</div>" : "") +
    "<div id='svsummary'></div>";

  document.getElementById("cubehead").addEventListener("click", function(e){
    if (e.target.id === "cubeclear"){
      e.stopPropagation();
      setCubeFilter(0); renderCubePicker();
      return;
    }
    svOpenPicker = !svOpenPicker;
    renderCubePicker();
  });

  [].forEach.call(el.querySelectorAll(".svcube"), function(b){
    b.addEventListener("click", function(){
      var k = +this.dataset.cube;
      if (cur === k){ setCubeFilter(0); }
      else { setCubeFilter(k); svOpenSummary = true; }
      renderCubePicker();
    });
  });

  if (cur) renderCubeSummary(cur);
}

/* A tiny version of the shelf, so the collapsed header still says what
   the control is. */
function gridIcon(n){
  var s = shelfShape(), out = "";
  for (var i = 0; i < s.rows * s.cols; i++) out += "<i></i>";
  return "<span class='gridicon' style='grid-template-columns:repeat(" +
         s.cols + ",1fr)'>" + out + "</span>";
}

/* What's in the cube, by category, in the order they run along it.
   Collapsed by default after the first look, since the list below is
   the thing you actually came for. */
function renderCubeSummary(cube){
  var el = document.getElementById("svsummary");
  if (!el) return;
  var list = RECS.filter(function(r){ return r.k === cube; })
    .sort(function(x, y){ return (x.pos || 0) - (y.pos || 0); });

  var groups = [], last = null;
  list.forEach(function(r){
    var c = r.c || "No category";
    if (c !== last){ groups.push({ cat: c, n: 0, from: r.pos }); last = c; }
    groups[groups.length - 1].n++;
    groups[groups.length - 1].to = r.pos;
  });

  el.innerHTML =
    "<button class='svtoggle' id='svtoggle' aria-expanded='" + svOpenSummary + "'>" +
      esc(CUBE_NAMES[cube]) + " \u00b7 " + list.length + " record" +
      (list.length === 1 ? "" : "s") +
      "<span class='svchev'>" + (svOpenSummary ? "\u2303" : "\u2304") + "</span></button>" +
    (svOpenSummary
      ? "<div class='svsum'>" + (groups.length
          ? groups.map(function(g){
              return "<div class='svsumrow'>" +
                "<span class='cmdot' style='background:" + (COLORS[g.cat] || "#7E7973") + "'></span>" +
                "<span class='svsumcat'>" + esc(g.cat) + "</span>" +
                "<span class='svsumn'>" + g.n + "<small> \u00b7 " +
                  (g.from === g.to ? "position " + g.from : g.from + "\u2013" + g.to) +
                "</small></span></div>";
            }).join("")
          : "<p class='hint'>Nothing filed here yet.</p>") + "</div>"
      : "");

  document.getElementById("svtoggle").addEventListener("click", function(){
    svOpenSummary = !svOpenSummary;
    renderCubeSummary(cube);
  });
}

/* Redrawn whenever the collection changes, so the counts stay honest. */
if (typeof onDataReady === "function") onDataReady(renderCubePicker);
renderCubePicker();
