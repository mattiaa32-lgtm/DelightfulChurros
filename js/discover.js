/* =================== Discover: daily picks you don't own =============
   Cached per calendar day so it's stable once fetched, and every pick
   ever shown is remembered and sent back as an exclusion list so the
   same record never comes round twice. */
function todayKey(){
  var d=new Date();
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}
function seenList(){
  try{return JSON.parse(localStorage.getItem("discseen")||"[]");}catch(e){return [];}
}
function rememberSeen(recs){
  var seen=seenList();
  recs.forEach(function(r){
    var s=r.artist+" \u2014 "+r.title;
    if(seen.indexOf(s)<0)seen.push(s);
  });
  try{localStorage.setItem("discseen",JSON.stringify(seen.slice(-200)));}catch(e){}
}
function discLinks(r){
  var q=encodeURIComponent((r.artist||"")+" "+(r.title||""));
  var dq=q+(r.pressing_search?"+"+encodeURIComponent(r.pressing_search):"");
  return "<div class='rlinks'>"+
    "<a href='https://open.spotify.com/search/"+q+"' target='_blank' rel='noopener'>Listen on Spotify</a>"+
    "<a href='https://www.discogs.com/search/?q="+dq+"&type=release' target='_blank' rel='noopener'>Find on Discogs</a>"+
    "<a href='https://www.youtube.com/results?search_query="+q+"' target='_blank' rel='noopener'>YouTube</a>"+
    "</div>";
}
/* cover art for a recommendation: reuses the same iTunes lookup and
   cache the shelf uses, via a stand-in record object */
function fillRecArt(scope){
  [].forEach.call((scope||document).querySelectorAll(".rart[data-a]"),function(el){
    if(el.dataset.done)return; el.dataset.done="1";
    var stub={a:el.dataset.a,t:el.dataset.t,img:null};
    cover(stub,function(u){
      if(!u)return;
      var img=new Image();
      img.onload=function(){el.innerHTML="";el.appendChild(img);};
      img.src=u; img.alt="";
    },true);   /* foreground: these cards are on screen now */
  });
}
/* shared card renderer — used by Discover, the chat's "something new"
   answers, and the wantlist, so all three look and behave identically */
function recCardHTML(r){
  var meta=[r.year,r.genre].filter(Boolean).join(" \u00b7 ");
  return "<div class='rec'>"+
    "<div class='rtop'>"+
      "<span class='rart' data-a=\""+esc(r.artist||"")+"\" data-t=\""+esc(r.title||"")+"\"></span>"+
      "<span class='rinfo'>"+
        "<span class='ra'>"+esc(r.artist||"")+"</span>"+
        "<div class='rt'>"+esc(r.title||"")+"</div>"+
        (meta?"<div class='rmeta'>"+esc(meta)+"</div>":"")+
        (r.fits?"<span class='rfit'>Fits: "+esc(r.fits)+"</span>":"")+
      "</span>"+
    "</div>"+
    (r.sounds?"<p class='rsounds'>"+esc(r.sounds)+"</p>":"")+
    (r.why?"<p class='rwhy'>"+esc(r.why)+"</p>":"")+
    (r.pressing?"<p class='rpress'><b>Pressing:</b> "+esc(r.pressing)+
      (r.pressing_why?" \u2014 "+esc(r.pressing_why):"")+"</p>":"")+
    discLinks(r)+wantBtn(r)+"</div>";
}
function renderDaily(recs){
  var body=document.getElementById("discbody");
  if(!recs||!recs.length){
    body.innerHTML="<p class='hint'>Nothing came back \u2014 try again in a moment.</p>";return;
  }
  body.innerHTML=recs.map(recCardHTML).join("");
  fillRecArt(body);
}
var discBusy=false;
function loadDaily(force){
  if(discBusy)return;
  var key="disc:"+todayKey();
  document.getElementById("discdate").textContent=force?"A different set":"Today's picks";
  if(!force){
    var cached=null;try{cached=localStorage.getItem(key);}catch(e){}
    if(cached){try{renderDaily(JSON.parse(cached));return;}catch(e){}}
  }
  discBusy=true;
  document.getElementById("discbody").innerHTML=
    "<p class='hint'><span class='dots'><span></span><span></span><span></span></span> Finding something good\u2026</p>";
  fetch(API_BASE+"recommend",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode:"discover",records:collectionPayload(),count:3,
      adventurous:document.getElementById("advtoggle").getAttribute("aria-pressed")==="true",
      avoid:seenList(),seed:todayKey()+(force?"-"+Date.now():"")})
  }).then(function(res){
    if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;throw e;});}
    if(!res.ok)throw new Error("failed");
    return res.json();
  }).then(function(recs){
    if(!Array.isArray(recs))throw new Error("failed");
    try{localStorage.setItem(key,JSON.stringify(recs));}catch(e){}
    rememberSeen(recs);
    renderDaily(recs);
    discBusy=false;
  }).catch(function(err){
    document.getElementById("discbody").innerHTML="<p class='hint'>"+
      (err.message==="busy"
        ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific, not in a few minutes."
          : "Hit the per-minute rate limit \u2014 give it a minute and try again.")
        : "Couldn't reach the recommender just now. Try again in a moment.")+"</p>";
    discBusy=false;
  });
}
document.getElementById("discnew").addEventListener("click",function(e){
  e.preventDefault();loadDaily(true);});
document.getElementById("advtoggle").addEventListener("click",function(){
  var on=this.getAttribute("aria-pressed")==="true";
  this.setAttribute("aria-pressed",!on);
  loadDaily(true);});
document.getElementById("discseen").addEventListener("click",function(e){
  e.preventDefault();
  var seen=seenList(),body=document.getElementById("discbody");
  body.innerHTML=seen.length
    ? "<div class='seenlist'>"+seen.map(esc).join("<br>")+"</div>"
    : "<p class='hint'>Nothing recommended yet.</p>";
  document.getElementById("discdate").textContent="Previously recommended";
});
