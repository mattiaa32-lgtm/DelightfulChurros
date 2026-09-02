function mini(r){var o="";for(var i=0;i<4;i++){o+="<i"+(i===r.r*2+r.co?" class='on'":"")+"></i>";}
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

function holes(r){var o="";for(var i=0;i<4;i++){
  o+="<div class='hole"+(i===r.r*2+r.co?" on":"")+"'>"+CUBE_NAMES[i]+"</div>";}return o;}

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
    "<dl class='facts'>"+
      /* first release first, then the specific pressing on the shelf */
      (cachedYear(r)?"<dt>First released</dt><dd data-yr='first'>"+esc(cachedYear(r))+"</dd>":"")+
      (pressYear(r)?"<dt>This pressing</dt><dd data-yr='press'>"+esc(pressYear(r))+"</dd>":"")+
      "<dt>Section</dt><dd>"+esc(r.c)+"</dd>"+
      "<dt>Position in cube</dt><dd>"+r.p+" of "+r.n+" \u00b7 "+CUBE_NAMES[r.r*2+r.co]+
        "<div class='bar'><span style='left:calc("+((r.p-0.5)/r.n*100).toFixed(1)+"% - 1.5px)'></span></div></dd>"+
      "<dt>Either side</dt><dd class='nb'>"+nb+"</dd>"+
    "</dl>"+
    "<div class='links'>"+
      "<a class='lnk' href='"+dc+"' target='_blank' rel='noopener'>"+
        "<span class='dot' style='background:#EDEAE3'></span>"+
        "<span class='lt'>Discogs<small>"+(r.d?"Your pressing":"Search")+"</small></span></a>"+
      "<a class='lnk' href='"+sp+"' target='_blank' rel='noopener'>"+
        "<span class='dot' style='background:#1DB954'></span>"+
        "<span class='lt'>Spotify<small>Have a listen</small></span></a>"+
    "</div>"+
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

document.getElementById("chips").innerHTML=
  [["All",0],["Top left",1],["Top right",2],["Bottom left",3],["Bottom right",4]]
  .map(function(c,i){return "<button class='chip' aria-pressed='"+(i===0)+"' data-k='"+c[1]+"'>"+c[0]+"</button>";}).join("");
document.getElementById("chips").addEventListener("click",function(e){
  var b=e.target.closest(".chip");if(!b)return;
  cubeFilter=+b.dataset.k;
  [].forEach.call(this.querySelectorAll(".chip"),function(c){c.setAttribute("aria-pressed",c===b);});
  render();});

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
function exportedRows(){
  return RECS.map(function(r){
    var desc=resolvedDesc(r).replace(/[\t\r\n]+/g," ").trim();
    return resolvedCover(r)+"\t"+desc;
  }).join("\n");
}
document.getElementById("exportlink").addEventListener("click",function(e){
  e.preventDefault();
  var box=document.getElementById("exportbox");
  if(box.classList.contains("show")){box.classList.remove("show");return;}
  box.classList.add("show");
  var ta=document.getElementById("exportarea");
  ta.value=exportedRows();
  ta.focus();ta.select();
  box.scrollIntoView({behavior:"smooth",block:"center"});});

/* ---- optional Google Sheet ---- */
