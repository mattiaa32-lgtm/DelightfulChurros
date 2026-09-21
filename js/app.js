/* =================== tabs & bootstrap =================== */
var VIEWS=["shelf","dash","discover","radar","value","want","hifi"];
function showView(v){
  VIEWS.forEach(function(n){
    var el=document.getElementById("view-"+n);
    if(el)el.hidden=(n!==v);
  });
  document.getElementById("shelfhead").hidden=(v!=="shelf");
  [].forEach.call(document.querySelectorAll("#tabs .tab"),function(b){
    b.setAttribute("aria-pressed",b.dataset.v===v);
  });
  /* each view loads its own data the first time it's opened, so nothing
     hits the network until you actually go looking for it */
  if(v==="discover")loadDaily(false);
  if(v==="radar")loadRadarIfReady();
  if(v==="value"&&typeof renderValueTab==="function")renderValueTab();
  if(v==="want")renderWantView();
  if(v==="dash")loadDash();
  if(v==="hifi")loadHifi();
}
document.getElementById("tabs").addEventListener("click",function(e){
  var b=e.target.closest(".tab");if(b)showView(b.dataset.v);});

/* payload shared by the AI views: just enough for the model to work
   with, never the whole record objects */
/* What the chat and recommenders know about each record. It used to be
   artist, title and genre \u2014 enough to match names, not to choose well.
   The description, album score and pressing score are already in the
   sheet, and they are what "something that sounds great tonight"
   actually depends on. Trimmed, so two hundred records stay a modest
   request. */
function collectionPayload(){
  function num(raw){ var m=/^\s*(\d+(?:\.\d+)?)/.exec(String(raw||"")); return m?m[1]:""; }
  return RECS.map(function(r){
    var o={a:r.a,t:r.t,c:r.c};
    var y=cachedYear(r);
    if(y)o.y=y;
    if(r.desc)o.d=String(r.desc).replace(/\s+/g," ").slice(0,160);
    var s=num(r.rate); if(s)o.s=s;
    if(r.owned){
      /* score, and which copy it is: "8.0 Germany · Vertigo · 6360 050 · 1971" */
      var parts=String(r.owned).split("\u2014");
      var ps=num(parts[0]);
      if(ps)o.p=ps+(parts[1]?" "+parts[1].trim().slice(0,70):"");
    }
    return o;
  });
}

/* ---- bootstrap ---- */
if (typeof applyShelfShapeCSS === "function") applyShelfShapeCSS();
renderCatChips();
render();
warmDiscogsCache();
warmDescCache();
loadSheet();
/* the year fallback runs on a delay so the Discogs sweep gets first go
   at each record; it then only chases what Discogs couldn't answer */
/* The background year sweep is gone: years now come from Discogs during
   a sync and live in the sheet, so there is nothing to chase here. */
