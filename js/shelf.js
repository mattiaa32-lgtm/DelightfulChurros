/* The little grid beside each row, drawn to whatever shape the shelf
   actually is rather than always four squares. */
function mini(r){var n=cubeCount(),o="";for(var i=0;i<n;i++){o+="<i"+(i===r.k-1?" class='on'":"")+"></i>";}
  return "<span class='mini' aria-hidden='true'>"+o+"</span>";}

/* True until the sheet has been read once. Without this the app opens
   showing "no records found", which reads as an empty collection rather
   than one still arriving \u2014 and the shelf takes a moment because it is
   a published CSV, not a local file. */
var COLLECTION_LOADING = true;

/* Drawn immediately, before anything else runs \u2014 render() may not have
   been called yet when the page first paints, and an empty results area
   is what makes the app look like it has no records. */
(function(){
  var res = document.getElementById("results");
  if (res && !res.innerHTML.trim()){
    res.innerHTML = (typeof skeletonHTML === "function"
        ? skeletonHTML(shelfView() === "grid" ? "tile" : "row", 8)
        : "<div class='loading'><span class='spinner'></span>" +
          "<span>Gathering your collection\u2026</span></div>");
  }
})();

function render(){
  if (COLLECTION_LOADING && !RECS.length){
    var res = document.getElementById("results");
    if (res) res.innerHTML =
      (typeof skeletonHTML === "function"
        ? skeletonHTML(shelfView() === "grid" ? "tile" : "row", 8)
        : "<div class='loading'><span class='spinner'></span>" +
          "<span>Gathering your collection\u2026</span></div>");
    return;
  }
  var q=document.getElementById("q").value.trim();
  var terms=norm(q).split(/\s+/).filter(Boolean);
  var list=RECS.filter(function(r){
    if(cubeFilter&&r.k!==cubeFilter)return false;
    if(catFilter&&r.c!==catFilter)return false;
    return terms.length?matches(r,terms):true;});
  document.getElementById("count").textContent=
    list.length+(list.length===RECS.length?" records":" of "+RECS.length);
  var el=document.getElementById("results");
  if(!list.length){
    /* Two different empty states. An empty COLLECTION is first-run and
       needs instructions; an empty SEARCH just needs a nudge. */
    if(!RECS.length){
      el.innerHTML=
        "<div class='firstrun'>"+
          "<p class='fr-h'>Nothing on the shelf yet</p>"+
          "<p>This app reads your collection from a Google Sheet. It's empty, "+
            "so there's nothing to show.</p>"+
          "<p>Unlock editing with the button in the header, then add records \u2014 "+
            "either straight into the sheet, or with <b>Add a record</b> above.</p>"+
        "</div>";
      return;
    }
    el.innerHTML="<p class='empty'>Nothing matching \u201c"+esc(q)+"\u201d.<br>"+
      "Try part of the artist name, or one word from the title.</p>";return;}
  SHELF_ORDER=list.map(function(r){return r.i;});
  var grid=shelfView()==="grid";
  el.classList.toggle("grid",grid);
  el.innerHTML=list.map(grid?tileHTML:rowHTML).join("");
  fillArt(el);
  paintViewToggle();
}
/* List or cover grid. Kept in the shared settings, so the shelf looks
   the same on every device. */
function shelfView(){
  try { return localStorage.getItem("shelfView") === "grid" ? "grid" : "list"; }
  catch (e) { return "list"; }
}

/* The records currently on screen, in order. Swiping through the card
   follows this \u2014 so it walks the cube or search you are looking at,
   not the whole collection. */
var SHELF_ORDER = [];

/* A cover, large, with the title and artist beneath: how a crate is
   browsed. The same click handler as a row, so it opens the same card. */
function tileHTML(r){
  return "<button class='row tile' data-i='"+r.i+"'>"+artBox(r,"tileart")+
    "<span class='tmeta'><span class='title'>"+esc(r.t)+"</span>"+
    "<span class='artist'>"+esc(r.a)+"</span></span></button>";
}

function rowHTML(r){
  return "<button class='row' data-i='"+r.i+"'>"+artBox(r)+
    /* Title first: the album is what you are looking for, the artist
       tells you which one. Same order everywhere a record appears. */
    "<span class='meta'><span class='title'>"+esc(r.t)+"</span>"+
    "<span class='artist'>"+esc(r.a)+"</span></span>"+
    (r.d?"":"<span class='badge'>Wanted</span>")+mini(r)+"</button>";
}

function holes(r){var n=cubeCount(),o="";for(var i=0;i<n;i++){
  o+="<div class='hole"+(i===r.k-1?" on":"")+"'>"+CUBE_NAMES[i+1]+"</div>";}return o;}

/* Renders "8.0 \u2014 identity \u2014 reasoning" as a labelled score with its
   argument underneath. The stored string may have one dash or two: the
   record score has no identity, the pressing score does. */
/* Uses whatever currency the Value tab is set to, rather than a
   hard-coded pound sign \u2014 the figure is stored in DKK, so a fixed
   symbol was simply wrong. */
function money0(n){
  if (typeof ccy === "function") return ccy(n);
  return Math.round(Number(n) || 0).toLocaleString() + " kr";
}

function scoreBlock(label, raw){
  var parts = String(raw).split("\u2014").map(function(x){ return x.trim(); });
  var num = parts.shift() || "";
  var ident = "", why = "";
  if (parts.length > 1){ ident = parts.shift(); why = parts.join(" \u2014 "); }
  else { why = parts.join(" \u2014 "); }
  return "<div class='pressblock'>"+
    "<div class='presshead'><span class='ktitle'>"+esc(label)+"</span>"+
      "<span class='pressline'><b>"+esc(num)+"</b>/10"+
      (ident ? " \u00b7 " + esc(ident) : "")+"</span></div>"+
    (why ? "<p>"+esc(why)+"</p>" : "")+
  "</div>";
}

/* Where this record sits in what is on screen. Opened from somewhere
   else \u2014 the chat, the Top 10 \u2014 it isn't in the current list, so the
   whole shelf is the sequence instead. */
var CARD_I=null;
function cardOrder(){
  return SHELF_ORDER.length ? SHELF_ORDER : RECS.map(function(r){return r.i;});
}
function open(i, dir){
  var r=RECS[i];
  CARD_I=i;
  var order=cardOrder();
  if(order.indexOf(i)<0) order=RECS.map(function(x){return x.i;});
  var pos=order.indexOf(i);
  var inCube=RECS.filter(function(x){return x.k===r.k;});
  var before=inCube[r.p-2],after=inCube[r.p];
  var nb="";
  nb+=before?"After <b>"+esc(before.t)+"</b> \u2014 "+esc(before.a)+".<br>"
            :"First record in the cube.<br>";
  nb+=after?"Before <b>"+esc(after.t)+"</b> \u2014 "+esc(after.a)+"."
           :"Last record in the cube.";
  var sp="https://open.spotify.com/search/"+encodeURIComponent(artistQ(r.a)+" "+titleQ(r.t));
  var dc=r.d?"https://www.discogs.com/release/"+r.d
            :"https://www.discogs.com/search/?type=release&q="+
             encodeURIComponent(artistQ(r.a)+" "+titleQ(r.t));
  document.getElementById("card").innerHTML=
    "<div class='grab'></div>"+
    /* The sleeve leads: it is the most recognisable thing about a
       record. It is also where you swipe \u2014 sideways for the next
       record on the shelf, down to close. */
    "<div class='hero'>"+
      "<button class='heronav prev' aria-label='Previous record'"+(pos>0?"":" disabled")+">\u2039</button>"+
      artBox(r,"heroart")+
      "<button class='heronav next' aria-label='Next record'"+(pos>-1&&pos<order.length-1?"":" disabled")+">\u203a</button>"+
    "</div>"+
    (order.length>1&&pos>-1?"<div class='herocount'>"+(pos+1)+" of "+order.length+"</div>":"")+
    "<div class='hmeta'>"+
      (r.d?"":"<div class='wish'>Not on the shelf yet</div>")+
      "<div class='d-title' id='dtitle'>"+esc(r.t)+"</div>"+
      "<div class='d-artist'>"+esc(r.a)+"</div>"+
      "<div class='d-desc' data-i='"+r.i+"'>"+(r.desc?esc(r.desc):"")+"</div></div>"+
    "<div class='shelf'>"+holes(r)+"</div>"+
    /* Three separate judgements, each labelled, because a bare number
       above "Pressing score" reads as if the two are the same thing.
       They answer different questions: how good the ALBUM is, how good
       the COPY you own is, and which copy would be better. */
    (r.rate ? scoreBlock("Record score", r.rate) : "")+
    (r.owned ? scoreBlock("Pressing score", r.owned) : "")+
    (r.press ? "<div class='pressblock'><span class='ktitle'>Preferred pressing</span>"+
      "<p>"+esc(r.press)+"</p></div>" : "")+
    (r.val ? "<div class='pressblock'><span class='ktitle'>What it's worth</span>"+
      "<div class='valspread'><span class='vmid'><b>"+esc(money0(r.val))+
        "</b><small>cheapest listed</small></span></div>"+
      "<p class='hint'>The cheapest copy for sale on Discogs right now. Not a sale "+
      "price \u2014 Discogs doesn't publish those through its API.</p>"+
      "<div class='recval' data-rv='"+esc(String(r.d||""))+"'></div></div>" : "")+
    "<dl class='facts'>"+
      /* first release first, then the specific pressing on the shelf */
      (cachedYear(r)?"<dt>First released</dt><dd data-yr='first'>"+esc(cachedYear(r))+"</dd>":"")+
      (pressYear(r)?"<dt>This pressing</dt><dd data-yr='press'>"+esc(pressYear(r))+"</dd>":"")+
      "<dt>Section</dt><dd>"+esc(r.c)+"</dd>"+
      "<dt>Position in cube</dt><dd>"+r.p+" of "+r.n+" \u00b7 "+CUBE_NAMES[r.k]+
        "<div class='bar'><span style='left:calc("+((r.p-0.5)/r.n*100).toFixed(1)+"% - 1.5px)'></span></div></dd>"+
      "<dt>Either side</dt><dd class='nb'>"+nb+"</dd>"+
    "</dl>"+
    "<div class='links'>"+
      "<a class='lnk' href='"+dc+"' target='_blank' rel='noopener'>"+
        svcIcon("discogs",true,17)+
        "<span class='lt'>Discogs<small>"+(r.d?"Your pressing":"Search")+"</small></span></a>"+
      "<a class='lnk' href='"+sp+"' target='_blank' rel='noopener'>"+
        svcIcon("spotify",true,17)+
        "<span class='lt'>Spotify<small>Have a listen</small></span></a>"+
      "<a class='lnk' href='https://www.youtube.com/results?search_query="+
        encodeURIComponent(artistQ(r.a)+" "+titleQ(r.t))+"' target='_blank' rel='noopener'>"+
        svcIcon("youtube",true,17)+
        "<span class='lt'>YouTube<small>Watch or listen</small></span></a>"+
    "</div>"+
    (isOwner() ? "<button class='chip owner-only' id='movebtn' data-i='"+r.i+"'>Move this record</button>" : "")+
    "<button class='close'>Close</button>";
  document.getElementById("sheet").classList.add("open");
  var cardEl=document.getElementById("card");
  /* Slide in from the side it came from, so moving through records
     reads as moving along the shelf. */
  cardEl.classList.remove("slide-l","slide-r");
  if(dir){ void cardEl.offsetWidth; cardEl.classList.add(dir>0?"slide-l":"slide-r"); }
  if(dir) cardEl.scrollTop=0;
  cardEl.querySelector(".heronav.prev").addEventListener("click",function(e){e.stopPropagation();step(-1);});
  cardEl.querySelector(".heronav.next").addEventListener("click",function(e){e.stopPropagation();step(1);});
  fillArt(cardEl);
  /* This record's own price history, from the weekly readings. */
  var rv = document.querySelector("#card .recval");
  if (rv && typeof drawRecordValue === "function") drawRecordValue(rv, r);
  upgradeDetailArt(r);
  upgradeDetailDesc(r);
}
function close(){document.getElementById("sheet").classList.remove("open");CARD_I=null;}

/* The next or previous record in the current sequence. */
function step(dir){
  if(CARD_I===null)return;
  var order=cardOrder();
  if(order.indexOf(CARD_I)<0) order=RECS.map(function(x){return x.i;});
  var to=order[order.indexOf(CARD_I)+dir];
  if(to===undefined)return;
  open(to,dir);
}

document.getElementById("results").addEventListener("click",function(e){
  var b=e.target.closest(".row");if(b)open(+b.dataset.i);});
document.getElementById("sheet").addEventListener("click",function(e){
  if(e.target.id==="sheet"||e.target.classList.contains("close"))close();});
document.addEventListener("keydown",function(e){
  if(e.key==="Escape")close();
  /* Arrow keys walk the shelf while a card is open. */
  if(CARD_I!==null&&document.getElementById("sheet").classList.contains("open")){
    if(e.key==="ArrowRight"){e.preventDefault();step(1);}
    if(e.key==="ArrowLeft"){e.preventDefault();step(-1);}
  }
});

/* ---- gestures on the card ----------------------------------------
   Sideways moves to the neighbouring record; down closes the card.
   The handle and the cover take both directions. The rest of the card
   scrolls normally, and still passes a clearly sideways swipe through,
   so you can browse without aiming for the cover.

   The direction is decided from the first few pixels of movement and
   then held, so a slightly diagonal swipe does not do both at once. */
(function(){
  var sheetEl=document.getElementById("sheet"),card=document.getElementById("card");
  var g=null;

  card.addEventListener("pointerdown",function(e){
    if(e.target.closest("a,button,select,input,textarea,label,.svc"))return;
    var both=!!e.target.closest(".grab,.hero");
    g={both:both,axis:null,x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,
       t0:e.timeStamp,t:e.timeStamp,id:e.pointerId};
  });

  card.addEventListener("pointermove",function(e){
    if(!g||e.pointerId!==g.id)return;
    g.x=e.clientX;g.y=e.clientY;g.t=e.timeStamp;
    var dx=g.x-g.x0,dy=g.y-g.y0;
    if(!g.axis){
      if(Math.abs(dx)<8&&Math.abs(dy)<8)return;
      if(Math.abs(dx)>Math.abs(dy)*1.2) g.axis="x";
      else if(g.both&&dy>0) g.axis="y";
      else { g=null; return; }          /* an ordinary vertical scroll */
      card.style.transition="none";
      if(card.setPointerCapture)card.setPointerCapture(e.pointerId);
    }
    if(g.axis==="x"){
      card.style.transform="translateX("+dx*0.6+"px)";
    } else {
      var d=Math.max(0,dy);
      card.style.transform="translateY("+d+"px)";
      sheetEl.style.opacity=String(Math.max(0.4,1-d/500));
    }
  });

  function release(e){
    if(!g)return;
    var dx=g.x-g.x0,dy=g.y-g.y0,dt=Math.max(1,g.t-g.t0),axis=g.axis;
    g=null;
    card.style.transition="";sheetEl.style.opacity="";card.style.transform="";
    if(axis==="x"){
      var v=Math.abs(dx)/dt;
      if(Math.abs(dx)>70||(Math.abs(dx)>30&&v>0.5)) step(dx<0?1:-1);
    } else if(axis==="y"){
      var vy=dy/dt;
      if(dy>90||(dy>36&&vy>0.5))close();
    }
  }
  card.addEventListener("pointerup",release);
  card.addEventListener("pointercancel",function(){
    if(!g)return; g=null;
    card.style.transition="";sheetEl.style.opacity="";card.style.transform="";
  });
})();

document.getElementById("q").addEventListener("input",render);
document.getElementById("dice").addEventListener("click",function(){
  var p=RECS.filter(function(r){return !cubeFilter||r.k===cubeFilter;});
  if(p.length)open(p[Math.floor(Math.random()*p.length)].i);});

/* The cube filter is drawn by js/shelfview.js as the shelf itself.
   setCubeFilter is how it drives this module. */
function setCubeFilter(k){
  cubeFilter = k || 0;
  render();
}

/* category chips: rebuilt whenever the category list can change (the
   sheet may introduce a category the baked-in copy didn't have) */
function renderCatChips(){
  var el=document.getElementById("catchips");
  el.innerHTML="<button class='chip' aria-pressed='"+(!catFilter)+"' data-c=''>All genres</button>"+
    Object.keys(COLORS).map(function(c){
      return "<button class='chip' aria-pressed='"+(c===catFilter)+"' data-c='"+esc(c)+"'>"+esc(c)+"</button>";
    }).join("");
}
document.getElementById("catchips").addEventListener("click",function(e){
  var b=e.target.closest(".chip");if(!b)return;
  catFilter=b.dataset.c;
  [].forEach.call(this.querySelectorAll(".chip"),function(c){c.setAttribute("aria-pressed",c===b);});
  render();});

/* ---- QR ---- */
var qrObj=null;
function drawQR(){
  var v=document.getElementById("qrurl").value.trim();
  var box=document.getElementById("qr"),hint=document.getElementById("qrhint");
  box.innerHTML="";
  if(!/^https?:\/\/.+\..+/.test(v)){
    hint.textContent="Enter the address this page is published at \u2014 a phone can\u2019t open a file stored on your laptop.";
    return;}
  qrObj=new QRCode(box,{text:v,width:200,height:200,colorDark:"#131211",colorLight:"#ffffff"});
  hint.textContent="Point a phone camera at this. Print it and tape it to the side of the shelf.";
}
document.getElementById("qrlink").addEventListener("click",function(e){
  e.preventDefault();
  var box=document.getElementById("qrbox");
  if(box.classList.contains("show")){box.classList.remove("show");return;}
  box.classList.add("show");
  var f=document.getElementById("qrurl");
  if(!f.value){
    var here=location.href.split("#")[0];
    f.value=/^https?:/.test(here)&&!/^https?:\/\/localhost/.test(here)?here:"";
  }
  drawQR();
  box.scrollIntoView({behavior:"smooth",block:"center"});});
document.getElementById("qrurl").addEventListener("input",drawQR);

/* ---- freeze resolved covers & descriptions so they stop needing a
   lookup at all ---- Reads whatever's already been resolved on this
   phone straight out of localStorage \u2014 no new network calls \u2014 as
   one tab-separated row per record, in sheet order: Cover URL, then
   Description. Once pasted in, cover()/descAI() see r.img/r.desc
   set and skip the lookup for that row forever. */
function resolvedCover(r){
  if(r.img)return r.img;
  if(r.d){var c=null;try{c=localStorage.getItem("dcog:"+r.d);}catch(e){}
    if(c&&c!=="0")return c;}
  var c2=null;try{c2=localStorage.getItem("cov:"+norm(r.a)+"|"+norm(r.t));}catch(e){}
  return c2||"";
}
function resolvedDesc(r){
  if(r.desc)return r.desc;
  var c=null;try{c=localStorage.getItem("desc2:"+norm(r.a)+"|"+norm(r.t));}catch(e){}
  return (c&&c!=="0")?c:"";
}
/* The freeze/export panel lived here: it produced tab-separated rows to
   paste into the sheet by hand, back when the app could only read it.
   The app now writes covers, descriptions and years itself, so keeping a
   manual export around would just be a trap \u2014 it would look like the
   way to save things long after it stopped being needed.

   resolvedCover and resolvedDesc above are kept: the gap report uses
   them to tell "not resolved" from "resolved but not yet in the sheet". */

/* ---- optional Google Sheet ---- */


/* ---- list or grid -------------------------------------------------- */
function paintViewToggle(){
  var b=document.getElementById("viewtoggle");
  if(!b)return;
  var grid=shelfView()==="grid";
  b.setAttribute("aria-pressed",grid?"true":"false");
  b.setAttribute("aria-label",grid?"Show as a list":"Show as a grid of covers");
  b.title=grid?"Show as a list":"Show as a grid of covers";
  /* shows the view you would switch TO */
  b.innerHTML=grid
    ? "<svg viewBox='0 0 16 16' width='15' height='15' aria-hidden='true'><rect x='1' y='2.5' width='14' height='2' rx='1' fill='currentColor'/><rect x='1' y='7' width='14' height='2' rx='1' fill='currentColor'/><rect x='1' y='11.5' width='14' height='2' rx='1' fill='currentColor'/></svg>"
    : "<svg viewBox='0 0 16 16' width='15' height='15' aria-hidden='true'><rect x='1' y='1' width='6' height='6' rx='1' fill='currentColor'/><rect x='9' y='1' width='6' height='6' rx='1' fill='currentColor'/><rect x='1' y='9' width='6' height='6' rx='1' fill='currentColor'/><rect x='9' y='9' width='6' height='6' rx='1' fill='currentColor'/></svg>";
}
(function(){
  var b=document.getElementById("viewtoggle");
  if(!b)return;
  b.addEventListener("click",function(){
    try{localStorage.setItem("shelfView",shelfView()==="grid"?"list":"grid");}catch(e){}
    if(typeof pushShared==="function")pushShared();   /* same view on every device */
    render();
  });
  paintViewToggle();
})();
