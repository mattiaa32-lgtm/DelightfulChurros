/* =================== pull to refresh ================================
   Added to the home screen, the app runs in standalone mode: no address
   bar, no reload button, and iOS does not provide its own pull-to-
   refresh there. So a new deploy would not be picked up until the page
   happened to be reloaded some other way.

   This adds the familiar gesture: drag down from the top of the page,
   past a threshold, and release. It also asks the service worker to
   check for a new version before reloading, so the refresh actually
   fetches the new build rather than re-running the cached one.

   Care is taken not to fight the app's other gestures \u2014 the record
   sheet and chat panel are themselves drag-to-dismiss, and several
   rows scroll sideways. */
(function(){
  var THRESHOLD = 78;        // how far to pull before it will fire
  var MAX = 130;             // furthest the indicator travels
  var startY = 0, startX = 0, pulling = false, armed = false, dy = 0;
  var bar = null;

  function standalone(){
    return window.matchMedia("(display-mode: standalone)").matches ||
           window.navigator.standalone === true;
  }
  function indicator(){
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "ptr";
    bar.innerHTML = "<span class='ptr-spin'></span>";
    document.body.appendChild(bar);
    return bar;
  }
  function setPull(px, spinning){
    var el = indicator();
    var t = Math.min(px, MAX);
    el.style.transform = "translateY(" + t + "px)";
    el.style.opacity = String(Math.min(1, px / THRESHOLD));
    el.classList.toggle("ready", px >= THRESHOLD);
    el.classList.toggle("spinning", !!spinning);
  }
  function reset(animate){
    var el = indicator();
    el.style.transition = animate ? "transform .22s, opacity .22s" : "";
    el.style.transform = "translateY(-60px)";
    el.style.opacity = "0";
    el.classList.remove("ready", "spinning");
    if (animate) setTimeout(function(){ el.style.transition = ""; }, 240);
  }

  /* A pull only counts when the page is genuinely at the top and the
     touch did not begin inside something that handles its own drag or
     scrolls horizontally. */
  function eligible(e){
    if (e.touches.length !== 1) return false;
    if (window.scrollY > 0) return false;
    var t = e.target;
    if (t.closest && t.closest(".chatwrap, #sheet, .grab, .head, .chathead")) return false;
    if (t.closest && t.closest(".chips, .decs, .tabs, .prompts, #exportarea, input, textarea")) return false;
    var open = document.querySelector("#sheet.open") ||
               (document.getElementById("chatwrap") &&
                !document.getElementById("chatwrap").hidden);
    return !open;
  }

  document.addEventListener("touchstart", function(e){
    armed = eligible(e);
    if (!armed) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    pulling = false; dy = 0;
  }, { passive: true });

  document.addEventListener("touchmove", function(e){
    if (!armed) return;
    var y = e.touches[0].clientY, x = e.touches[0].clientX;
    var down = y - startY, across = Math.abs(x - startX);
    /* ignore anything that looks like a sideways swipe */
    if (across > Math.abs(down)) { armed = false; return; }
    if (down <= 0) { if (pulling) { pulling = false; reset(true); } return; }
    if (window.scrollY > 0) { armed = false; if (pulling) reset(true); return; }
    pulling = true;
    dy = down * 0.5;                    // resistance, so it feels elastic
    setPull(dy);
  }, { passive: true });

  document.addEventListener("touchend", function(){
    if (!armed || !pulling) { armed = false; return; }
    armed = false;
    if (dy < THRESHOLD) { pulling = false; reset(true); return; }
    setPull(THRESHOLD, true);
    refresh();
  });

  function refresh(){
    /* Ask the service worker to look for a new build first, otherwise
       the reload may just replay what is already cached. */
    var done = false;
    function go(){
      if (done) return;
      done = true;
      window.location.reload();
    }
    setTimeout(go, 2500);               // never hang on a slow check
    if ("serviceWorker" in navigator && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration()
        .then(function(reg){ return reg ? reg.update() : null; })
        .then(go, go);
    } else {
      go();
    }
  }

  /* Only meaningful without browser chrome; in a normal tab Safari and
     Chrome already provide this. */
  if (standalone()) {
    document.documentElement.classList.add("ptr-on");
    reset(false);
  }
})();
