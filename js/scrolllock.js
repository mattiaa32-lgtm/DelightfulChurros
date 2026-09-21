/* =================== the page behind an overlay =====================
   A sheet, the chat, settings or the move panel should scroll on its
   own and leave the page behind it alone. CSS containment handles the
   end of a scroll, but on iOS a touch that starts on the dimmed
   backdrop still scrolls the page, and a long sheet could drag it
   along. So while any overlay is open, the page is pinned in place \u2014
   at its current scroll position, so closing the overlay does not
   jump you back to the top.

   Watches the overlays rather than being called by each of them: they
   open and close in half a dozen different modules, and one observer
   is harder to forget than six calls. */
(function(){
  var OVERLAYS = [
    { id: "sheet",     open: function(el){ return el.classList.contains("open"); } },
    { id: "gearsheet", open: function(el){ return el.classList.contains("open"); } },
    { id: "chatwrap",  open: function(el){ return !el.hidden; } },
    { id: "setwrap",   open: function(el){ return !el.hidden; } },
    { id: "movewrap",  open: function(el){ return !el.hidden; } }
  ];
  var savedY = 0, locked = false;

  function anyOpen(){
    return OVERLAYS.some(function(o){
      var el = document.getElementById(o.id);
      return el && o.open(el);
    });
  }

  function update(){
    var should = anyOpen();
    if (should === locked) return;
    locked = should;
    var html = document.documentElement, body = document.body;
    if (should){
      savedY = window.scrollY || window.pageYOffset || 0;
      body.style.top = (-savedY) + "px";
      html.classList.add("locked");
      body.classList.add("locked");
    } else {
      html.classList.remove("locked");
      body.classList.remove("locked");
      body.style.top = "";
      window.scrollTo(0, savedY);
    }
  }

  var obs = new MutationObserver(update);
  OVERLAYS.forEach(function(o){
    var el = document.getElementById(o.id);
    if (el) obs.observe(el, { attributes: true, attributeFilter: ["class", "hidden"] });
  });
})();
