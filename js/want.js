/* ---- wantlist: records you don't own but want, saved on-device ----
   Populated from Discover cards and from chat recommendations. Kept
   separate from RECS (which mirrors your sheet) so nothing here can be
   confused with something you actually own. */

function wantList(){
  try{return JSON.parse(localStorage.getItem("wantlist")||"[]");}catch(e){return [];}
}
function wantKey(artist,title){return norm(artist||"")+"|"+norm(title||"");}
function wantHas(artist,title){
  var k=wantKey(artist,title);
  return wantList().some(function(w){return wantKey(w.artist,w.title)===k;});
}
function wantAdd(rec){
  if(!rec||!rec.artist||!rec.title)return false;
  if(wantHas(rec.artist,rec.title))return false;
  var list=wantList();
  list.push({
    artist:rec.artist, title:rec.title,
    year:rec.year||"", genre:rec.genre||"", fits:rec.fits||"",
    sounds:rec.sounds||"", why:rec.why||"",
    pressing:rec.pressing||"", pressing_why:rec.pressing_why||"",
    pressing_search:rec.pressing_search||"",
    added:new Date().toISOString().slice(0,10)
  });
  try{localStorage.setItem("wantlist",JSON.stringify(list.slice(-300)));}catch(e){}
  return true;
}
function wantRemove(artist,title){
  var k=wantKey(artist,title);
  var list=wantList().filter(function(w){return wantKey(w.artist,w.title)!==k;});
  try{localStorage.setItem("wantlist",JSON.stringify(list));}catch(e){}
}
/* one delegated handler covers every want button on the page, wherever
   it was rendered from \u2014 discover cards, chat picks, the wantlist itself */
document.addEventListener("click",function(e){
  var b=e.target.closest("[data-want]");
  if(!b)return;
  e.preventDefault();
  var rec=null;
  try{rec=JSON.parse(b.getAttribute("data-want"));}catch(err){return;}
  if(wantHas(rec.artist,rec.title)){
    wantRemove(rec.artist,rec.title);
    b.textContent="+ Wantlist";b.classList.remove("on");
  }else{
    wantAdd(rec);
    b.textContent="\u2713 On wantlist";b.classList.add("on");
  }
  if(!document.getElementById("view-want").hidden)renderWantView();
});
function wantBtn(rec){
  var on=wantHas(rec.artist,rec.title);
  var data=esc(JSON.stringify({
    artist:rec.artist,title:rec.title,year:rec.year||"",genre:rec.genre||"",
    fits:rec.fits||"",sounds:rec.sounds||"",why:rec.why||"",
    pressing:rec.pressing||"",pressing_why:rec.pressing_why||"",
    pressing_search:rec.pressing_search||""
  }));
  return "<button class='wantbtn"+(on?" on":"")+"' data-want=\""+data+"\">"+
         (on?"\u2713 On wantlist":"+ Wantlist")+"</button>";
}
function renderWantView(){
  var el=document.getElementById("wantbody"),list=wantList();
  document.getElementById("wantcount").textContent=
    (function(){
      var open = list.filter(function(e){ return !e.got; }).length;
      return open ? open + (open === 1 ? " record" : " records") : "";
    })();
  if(!list.length){
    el.innerHTML="<p class='hint'>Nothing saved yet. Add records from Discover or "+
      "from the chat and they'll collect here.</p>";
    return;
  }
  /* Arrived records sit at the bottom, dimmed, rather than mixed in \u2014
     the list is for what you're still hunting. */
  var got = list.filter(function(e){ return e.got; });
  var want = list.filter(function(e){ return !e.got; });

  el.innerHTML =
    (want.length
      ? want.slice().reverse().map(function(r){ return recCardHTML(r); }).join("")
      : "<p class='hint'>Nothing left on the hunt \u2014 everything here has arrived.</p>") +
    (got.length
      ? "<div class='gotsec'><div class='ktitle'>Arrived \u2014 now on the shelf</div>" +
        got.slice().reverse().map(function(e){
          return "<div class='gotrow'>" + esc(e.artist || "") + " \u2014 " +
                 esc(e.title || "") + "</div>";
        }).join("") +
        "<div class='addrow' style='margin-top:10px'>" +
          "<button class='chip' id='wantclear'>Clear these " + got.length + "</button>" +
        "</div></div>"
      : "");

  fillRecArt(el);
  var cb = document.getElementById("wantclear");
  if (cb) cb.addEventListener("click", function(){ clearArrived(); renderWantView(); });
}

/* ---- closing the loop when you actually buy one --------------------
   The wantlist only ever grew. Nothing noticed when a record you wanted
   turned up in the collection, so over time it fills with things you
   already own \u2014 which makes it useless exactly when it should be most
   useful, standing in a shop.

   After the collection loads, anything on the list that now matches a
   record on the shelf is marked as arrived. It is not deleted silently:
   seeing "you got this" is the satisfying part, and a quiet deletion
   would look like data loss. */
function matchOwned(entry){
  var a = norm(entry.artist || ""), t = norm(entry.title || "");
  if (!a && !t) return null;
  for (var i = 0; i < RECS.length; i++){
    if (norm(RECS[i].a) === a && norm(RECS[i].t) === t) return RECS[i];
  }
  return null;
}

function reconcileWantlist(){
  var list = wantList();
  if (!list.length) return 0;
  var changed = 0;
  list.forEach(function(e){
    if (e.got) return;                       /* already known to have arrived */
    if (matchOwned(e)){ e.got = Date.now(); changed++; }
  });
  if (changed){
    try { localStorage.setItem("wantlist", JSON.stringify(list)); } catch (e) {}
  }
  return changed;
}

/* Clears everything already marked as arrived. Explicit, because the
   list is the only record that you once wanted these. */
function clearArrived(){
  var list = wantList().filter(function(e){ return !e.got; });
  try { localStorage.setItem("wantlist", JSON.stringify(list)); } catch (e) {}
  return list.length;
}

if (typeof onDataReady === "function") onDataReady(reconcileWantlist);
