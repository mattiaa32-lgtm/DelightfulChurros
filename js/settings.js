/* =================== settings ========================================
   The footer had grown a link per feature and was heading for a dozen.
   They're now behind one entry point, grouped by how often you'd touch
   them: the collection you tend regularly, connections rarely, this
   device almost never.

   Each item still opens the panel it always did — this only changes how
   you get there, so nothing about those screens had to change. The
   settings sheet closes as it hands over, otherwise you'd be reading the
   panel underneath through a dialog. */

function openSettings(){
  var w = document.getElementById("setwrap");
  if (w) w.hidden = false;
}
function closeSettings(){
  var w = document.getElementById("setwrap");
  if (w) w.hidden = true;
}

(function(){
  var link = document.getElementById("settingslink");
  var wrap = document.getElementById("setwrap");
  if (!link || !wrap) return;

  link.addEventListener("click", function(e){ e.preventDefault(); openSettings(); });
  document.getElementById("setclose").addEventListener("click", closeSettings);
  wrap.addEventListener("click", function(e){
    if (e.target.id === "setwrap") closeSettings();
  });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape" && !wrap.hidden) closeSettings();
  });

  /* Every item inside opens something else, so the sheet gets out of the
     way. The handlers for those panels are bound by their own modules;
     this just closes over the top of them. */
  [].forEach.call(wrap.querySelectorAll(".setitem"), function(b){
    b.addEventListener("click", function(){ setTimeout(closeSettings, 60); });
  });
})();
