/* =================== closing panels =================================
   Six panels open inline on the shelf \u2014 add a record, new arrivals,
   fill in the blanks, shelf layout, Discogs, backup \u2014 and none had a
   way to close. You could re-tap the item that opened it, but that
   means remembering which one it was, and on a phone the opener has
   usually scrolled off the top by then.

   Rather than editing six modules, a close button is attached to any
   panel as it opens, and Escape closes whichever is showing. Panels are
   found by class rather than by name, so one added later is covered
   without changing anything here. */

var PANEL_IDS = ["addbox", "arrivalsbox", "gapsbox", "filingbox", "connbox", "safetybox", "shelfviewbox", "valuesbox"];

function closePanel(box){
  if (!box) return;
  box.classList.remove("show");
}
function closeAllPanels(except){
  PANEL_IDS.forEach(function(id){
    var b = document.getElementById(id);
    if (b && b !== except) closePanel(b);
  });
}

/* Adds the button once, the first time a panel is shown. */
function decoratePanel(box){
  if (!box || box.querySelector(".panelclose")) return;
  var btn = document.createElement("button");
  btn.className = "panelclose";
  btn.type = "button";
  btn.setAttribute("aria-label", "Close");
  btn.innerHTML = "&times;";
  btn.addEventListener("click", function(){ closePanel(box); });
  box.insertBefore(btn, box.firstChild);
}

(function(){
  /* Watch for a panel gaining .show, whoever opened it. A mutation
     observer avoids having to wrap six different open functions, and
     keeps working for any panel added later. */
  var boxes = PANEL_IDS.map(function(id){ return document.getElementById(id); })
                       .filter(Boolean);
  if (!boxes.length) return;

  /* Decorate up front rather than reacting to the class change: a
     MutationObserver fires asynchronously, so the button would be
     missing for a frame after opening \u2014 long enough to tap through. */
  boxes.forEach(decoratePanel);

  var obs = new MutationObserver(function(muts){
    muts.forEach(function(m){
      var box = m.target;
      if (box.classList.contains("show")){
        decoratePanel(box);
      }
    });
  });
  boxes.forEach(function(b){ obs.observe(b, { attributes: true, attributeFilter: ["class"] }); });

  document.addEventListener("keydown", function(e){
    if (e.key !== "Escape") return;
    boxes.forEach(function(b){ if (b.classList.contains("show")) closePanel(b); });
  });

  /* Tapping the page outside an open panel closes it \u2014 the usual
     phone gesture. Clicks inside the panel, or on whatever opened it,
     are left alone. */
  document.addEventListener("click", function(e){
    var open = boxes.filter(function(b){ return b.classList.contains("show"); })[0];
    if (!open) return;
    if (open.contains(e.target)) return;
    if (e.target.closest(".setitem, .addtop, #settingslink, .connbadge")) return;
    closePanel(open);
  });
})();
