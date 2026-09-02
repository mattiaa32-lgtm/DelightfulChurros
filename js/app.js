/* =================== tabs & bootstrap =================== */
var VIEWS=["shelf","discover","want","dash","hifi"];
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
  if(v==="want")renderWantView();
  if(v==="dash")loadDash();
  if(v==="hifi")loadHifi();
}
document.getElementById("tabs").addEventListener("click",function(e){
  var b=e.target.closest(".tab");if(b)showView(b.dataset.v);});

/* payload shared by the AI views: just enough for the model to work
   with, never the whole record objects */
function collectionPayload(){
  return RECS.map(function(r){
    var o={a:r.a,t:r.t,c:r.c};
    var y=cachedYear(r);
    if(y)o.y=y;
    return o;
  });
}

/* ---- bootstrap ---- */
renderCatChips();
render();
warmDiscogsCache();
warmDescCache();
loadSheet();
/* the year fallback runs on a delay so the Discogs sweep gets first go
   at each record; it then only chases what Discogs couldn't answer */
onDataReady(function(){setTimeout(warmYearCache,20000);});
