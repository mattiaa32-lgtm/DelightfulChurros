/* =================== moving one record ==============================
   Shelf layout moves whole categories; New arrivals places incoming
   records. Neither lets you shift a record already on the shelf, which
   until now meant editing column J in the spreadsheet \u2014 fine at a
   laptop, useless standing in front of the shelf.

   The interaction is "put this after X" rather than dragging. You don't
   move a record twenty-three places, you decide it belongs next to
   something; and dragging through forty records on a phone is miserable.

   Only the moved record is renumbered where possible: positions are
   consecutive, so inserting means shifting the ones after it, but the
   records before it are left alone. */

var moveFor = null;

function openMove(rec){
  moveFor = rec;
  var wrap = document.getElementById("movewrap");
  if (!wrap) return;
  document.getElementById("movetitle").textContent = rec.a + " \u2014 " + rec.t;
  document.getElementById("movebody").innerHTML =
    "<p class='hint'>Currently " + (rec.pos || "unplaced") + " in " +
      esc(CUBE_NAMES[rec.k] || ("cube " + rec.k)) + ".</p>" +
    "<label class='movelab'>Category</label>" +
    "<select id='movecat'>" +
      Object.keys(COLORS).sort().map(function(c){
        return "<option value=\"" + esc(c) + "\"" + (c === rec.c ? " selected" : "") +
               ">" + esc(c) + "</option>";
      }).join("") +
    "</select>" +
    "<label class='movelab'>Position</label>" +
    "<select id='moveafter'></select>" +
    "<div class='addrow' style='margin-top:14px'>" +
      "<button class='chip' id='movedo'>Move it</button>" +
      "<span class='hint' id='movemsg'></span>" +
    "</div>";

  document.getElementById("movecat").addEventListener("change", fillMoveTargets);
  document.getElementById("movedo").addEventListener("click", doMove);
  fillMoveTargets();
  wrap.hidden = false;
}

/* Neighbours within the CHOSEN category, not the whole cube. A cube can
   hold forty records across several categories; scrolling all of them to
   find the right spot defeats the point. The first entry is "before X"
   so the top of a category is reachable \u2014 with only "after", there is
   no way to say "put it first". */
function fillMoveTargets(){
  var sel = document.getElementById("moveafter");
  var cat = document.getElementById("movecat").value;
  if (!sel) return;

  var peers = RECS.filter(function(r){
    return r.c === cat && (!moveFor || r.row !== moveFor.row);
  }).sort(function(x, y){ return (x.pos || 0) - (y.pos || 0); });

  if (!peers.length){
    sel.innerHTML = "<option value='first'>First in this category</option>";
    return;
  }
  sel.innerHTML =
    "<option value='before:" + peers[0].row + "'>Before " +
      esc(peers[0].a + " \u2014 " + peers[0].t) + "</option>" +
    peers.map(function(p){
      return "<option value='after:" + p.row + "'>After " +
             esc(p.a + " \u2014 " + p.t) + "</option>";
    }).join("");
  sel.value = "after:" + peers[peers.length - 1].row;   /* default: at the end */
}

function closeMove(){
  var w = document.getElementById("movewrap");
  if (w) w.hidden = true;
  moveFor = null;
}

function doMove(){
  var msg = document.getElementById("movemsg");
  if (!isOwner()){ msg.textContent = "Unlock editing first."; return; }
  if (!moveFor) return;

  var cat = document.getElementById("movecat").value;
  var choice = document.getElementById("moveafter").value;

  /* A category lives in a cube, so changing the category moves the
     record between cubes too \u2014 otherwise it would sit in a cube its
     category doesn't belong to. */
  var map = (typeof cubeMap === "function") ? cubeMap() : {};
  var cube = map[cat] || moveFor.k;

  var inCube = RECS.filter(function(r){ return r.k === cube && r.row !== moveFor.row; })
    .sort(function(x, y){ return (x.pos || 0) - (y.pos || 0); });

  var at = inCube.length;
  if (choice === "first"){
    at = 0;
  } else {
    var parts = String(choice).split(":");
    var where = parts[0], row = parts[1];
    for (var i = 0; i < inCube.length; i++){
      if (String(inCube[i].row) === String(row)){
        at = (where === "before") ? i : i + 1;
        break;
      }
    }
  }

  var order = inCube.slice();
  order.splice(at, 0, moveFor);

  var cells = [];
  if (cat !== moveFor.c) cells.push({ row: moveFor.row, col: 3, value: cat });
  if (cube !== moveFor.k) cells.push({ row: moveFor.row, col: 4, value: cube });
  order.forEach(function(r, i){
    var pos = i + 1;
    if (r.pos !== pos) cells.push({ row: r.row, col: 10, value: pos });
  });

  if (!cells.length){ msg.textContent = "It's already there."; return; }

  msg.textContent = "Moving\u2026";
  sheetWrite("setCells", { cells: cells }, function(err){
    if (err){
      msg.textContent = err.message === "read-only"
        ? "Unlock editing first." : "Couldn't write: " + err.message;
      return;
    }
    if (typeof reloadCollection === "function") reloadCollection();
    msg.textContent = "Moved to position " + (at + 1) +
      (cat !== moveFor.c ? " in " + cat : "") + ".";
  });
}

(function(){
  var wrap = document.getElementById("movewrap");
  if (!wrap) return;
  document.getElementById("moveclose").addEventListener("click", closeMove);
  wrap.addEventListener("click", function(e){ if (e.target.id === "movewrap") closeMove(); });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape" && !wrap.hidden) closeMove();
  });
  /* The button lives inside the record sheet, which is rebuilt each time
     a record is opened, so this is delegated. */
  document.addEventListener("click", function(e){
    var b = e.target.closest("#movebtn");
    if (!b) return;
    var r = RECS[+b.dataset.i];
    if (r) openMove(r);
  });
})();
