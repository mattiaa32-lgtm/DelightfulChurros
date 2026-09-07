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

  /* Its cube-mates, in shelf order \u2014 those are the only sensible
     neighbours, since position is meaningful only within a cube. */
  var peers = RECS.filter(function(r){ return r.k === rec.k && r.row !== rec.row; })
    .sort(function(x, y){ return (x.pos || 0) - (y.pos || 0); });

  document.getElementById("movetitle").textContent = rec.a + " \u2014 " + rec.t;
  document.getElementById("movebody").innerHTML =
    "<p class='hint'>Currently " + (rec.pos || "unplaced") + " in " +
      esc(CUBE_NAMES[rec.k] || ("cube " + rec.k)) + ". Choose where it should sit.</p>" +
    "<select id='moveafter'>" +
      "<option value='0'>First in this cube</option>" +
      peers.map(function(p){
        return "<option value='" + p.row + "'>After " + esc(p.a + " \u2014 " + p.t) + "</option>";
      }).join("") +
    "</select>" +
    "<div class='addrow' style='margin-top:12px'>" +
      "<button class='chip' id='movedo'>Move it</button>" +
      "<span class='hint' id='movemsg'></span>" +
    "</div>";

  wrap.hidden = false;
  document.getElementById("movedo").addEventListener("click", doMove);
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

  var afterRow = document.getElementById("moveafter").value;
  var cube = moveFor.k;

  /* Rebuild the cube's order with the record lifted out and dropped back
     in at its new place, then write consecutive numbers. Only the rows
     whose number actually changes are sent. */
  var inCube = RECS.filter(function(r){ return r.k === cube; })
    .sort(function(x, y){ return (x.pos || 0) - (y.pos || 0); });

  var without = inCube.filter(function(r){ return r.row !== moveFor.row; });
  var at = 0;
  if (afterRow !== "0"){
    for (var i = 0; i < without.length; i++){
      if (String(without[i].row) === String(afterRow)){ at = i + 1; break; }
    }
  }
  without.splice(at, 0, moveFor);

  var cells = [];
  without.forEach(function(r, i){
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
    msg.textContent = "Moved to position " + (at + 1) + ", " +
      (cells.length - 1) + " other record" + (cells.length === 2 ? "" : "s") +
      " shifted. Pull down to refresh.";
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
