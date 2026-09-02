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
    list.length?list.length+(list.length===1?" record":" records"):"";
  if(!list.length){
    el.innerHTML="<p class='hint'>Nothing saved yet. Add records from Discover or "+
      "from the chat and they'll collect here.</p>";
    return;
  }
  el.innerHTML=list.slice().reverse().map(function(r){return recCardHTML(r);}).join("");
  fillRecArt(el);
}
