/* The little grid beside each row, drawn to whatever shape the shelf
   actually is rather than always four squares. */
function mini(r){var n=cubeCount(),o="";for(var i=0;i<n;i++){o+="<i"+(i===r.k-1?" class='on'":"")+"></i>";}
  return "<span class='mini' aria-hidden='true'>"+o+"</span>";}

function render(){
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
  el.innerHTML=list.map(rowHTML).join("");
  fillArt(el);
}
function rowHTML(r){
  return "<button class='row' data-i='"+r.i+"'>"+artBox(r)+
    "<span class='meta'><span class='artist'>"+esc(r.a)+"</span>"+
    "<span class='title'>"+esc(r.t)+"</span></span>"+
    (r.d?"":"<span class='badge'>Wanted</span>")+mini(r)+"</button>";
}

function holes(r){var n=cubeCount(),o="";for(var i=0;i<n;i++){
  o+="<div class='hole"+(i===r.k-1?" on":"")+"'>"+CUBE_NAMES[i+1]+"</div>";}return o;}

/* Renders "8.0 \u2014 identity \u2014 reasoning" as a labelled score with its
   argument underneath. The stored string may have one dash or two: the
   record score has no identity, the pressing score does. */
function money0(n){
  return "\u00a3" + Math.round(Number(n) || 0).toLocaleString();
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

function open(i){
  var r=RECS[i];
  var inCube=RECS.filter(function(x){return x.k===r.k;});
  var before=inCube[r.p-2],after=inCube[r.p];
  var nb="";
  nb+=before?"After <b>"+esc(before.a)+" \u2014 "+esc(before.t)+"</b>.<br>"
            :"First record in the cube.<br>";
  nb+=after?"Before <b>"+esc(after.a)+" \u2014 "+esc(after.t)+"</b>."
           :"Last record in the cube.";
  var sp="https://open.spotify.com/search/"+encodeURIComponent(artistQ(r.a)+" "+titleQ(r.t));
  var dc=r.d?"https://www.discogs.com/release/"+r.d
            :"https://www.discogs.com/search/?type=release&q="+
             encodeURIComponent(artistQ(r.a)+" "+titleQ(r.t));
  document.getElementById("card").innerHTML=
    "<div class='grab'></div>"+
    "<div class='head'>"+artBox(r)+"<div class='hmeta'>"+
      (r.d?"":"<div class='wish'>Not on the shelf yet</div>")+
      "<div class='d-artist'>"+esc(r.a)+"</div>"+
      "<div class='d-title' id='dtitle'>"+esc(r.t)+"</div>"+
      "<div class='d-desc' data-i='"+r.i+"'>"+(r.desc?esc(r.desc):"")+"</div></div></div>"+
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
      "<div class='valspread'><span><b>"+esc(money0(r.valLo||r.val))+"</b><small>rough</small></span>"+
      "<span class='vmid'><b>"+esc(money0(r.val))+"</b><small>typical</small></span>"+
      "<span><b>"+esc(money0(r.valHi||r.val))+"</b><small>mint</small></span></div>"+
      "<p class='hint'>Listed prices by condition on Discogs, not sale prices.</p></div>" : "")+
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
  fillArt(document.getElementById("card"));
  upgradeDetailArt(r);
  upgradeDetailDesc(r);
}
function close(){document.getElementById("sheet").classList.remove("open");}

document.getElementById("results").addEventListener("click",function(e){
  var b=e.target.closest(".row");if(b)open(+b.dataset.i);});
document.getElementById("sheet").addEventListener("click",function(e){
  if(e.target.id==="sheet"||e.target.classList.contains("close"))close();});
document.addEventListener("keydown",function(e){if(e.key==="Escape")close();});

/* ---- drag the card down to dismiss it, from the handle or the header ---- */
(function(){
  var sheetEl=document.getElementById("sheet"),card=document.getElementById("card");
  var dragging=false,startY=0,startT=0,lastY=0,lastT=0;
  card.addEventListener("pointerdown",function(e){
    if(!e.target.closest(".grab,.head"))return;
    dragging=true;
    startY=lastY=e.clientY; startT=lastT=e.timeStamp;
    card.style.transition="none";
    if(card.setPointerCapture)card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove",function(e){
    if(!dragging)return;
    lastY=e.clientY; lastT=e.timeStamp;
    var dy=Math.max(0,lastY-startY);
    card.style.transform="translateY("+dy+"px)";
    sheetEl.style.opacity=String(Math.max(0.4,1-dy/500));
  });
  function release(){
    if(!dragging)return;
    dragging=false;
    var dy=Math.max(0,lastY-startY),dt=Math.max(1,lastT-startT),v=dy/dt;
    card.style.transition=""; sheetEl.style.opacity="";
    if(dy>90||(dy>36&&v>0.5))close();
    card.style.transform="";
  }
  card.addEventListener("pointerup",release);
  card.addEventListener("pointercancel",release);
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
