/* =================== Discover: daily picks you don't own =============
   Cached per calendar day so it's stable once fetched, and every pick
   ever shown is remembered and sent back as an exclusion list so the
   same record never comes round twice. */
function todayKey(){
  var d=new Date();
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}
/* ---- what's already been suggested -------------------------------
   Two different cooldowns, because "shown" and "actually heard" are
   different things:
   • marked as listened → held back for 6 months. You've heard it; it
     shouldn't crowd out new discoveries, but it can resurface later.
   • shown but not listened → held back for 45 days only. A record you
     never got round to is worth putting in front of you again sooner.
   Records are stored with a timestamp so both windows are rolling
   rather than "never again". */
var LISTENED_COOLDOWN_DAYS=180, SHOWN_COOLDOWN_DAYS=45;
function recKey(r){return (r.artist||"")+" \u2014 "+(r.title||"");}
function seenStore(){
  var raw=null;
  try{raw=JSON.parse(localStorage.getItem("discseen2")||"null");}catch(e){}
  if(Array.isArray(raw))return raw;
  /* migrate the old plain-string list, treating everything as shown */
  var old=[];
  try{old=JSON.parse(localStorage.getItem("discseen")||"[]");}catch(e){}
  var now=Date.now();
  var mig=old.map(function(k){return {k:k,ts:now,listened:false};});
  saveSeen(mig);
  return mig;
}
function saveSeen(list){
  try{localStorage.setItem("discseen2",JSON.stringify(list.slice(-400)));}catch(e){}
}
/* Only the records still inside their cooldown are sent to the model. */
function seenList(){
  var now=Date.now(),day=86400000;
  return seenStore().filter(function(e){
    var age=(now-(e.ts||0))/day;
    return age < (e.listened?LISTENED_COOLDOWN_DAYS:SHOWN_COOLDOWN_DAYS);
  }).map(function(e){return e.k;});
}
function rememberSeen(recs){
  var list=seenStore(),now=Date.now();
  recs.forEach(function(r){
    var k=recKey(r),hit=null;
    for(var i=0;i<list.length;i++)if(list[i].k===k){hit=list[i];break;}
    if(hit)hit.ts=now; else list.push({k:k,ts:now,listened:false});
  });
  saveSeen(list);
}
function isListened(r){
  var k=recKey(r),list=seenStore();
  for(var i=0;i<list.length;i++)if(list[i].k===k)return !!list[i].listened;
  return false;
}
function toggleListened(r){
  var k=recKey(r),list=seenStore(),now=Date.now(),hit=null;
  for(var i=0;i<list.length;i++)if(list[i].k===k){hit=list[i];break;}
  if(!hit){hit={k:k,ts:now,listened:false};list.push(hit);}
  hit.listened=!hit.listened;
  hit.ts=now;                 /* restart the clock from the mark */
  saveSeen(list);
  return hit.listened;
}
function listenBtn(r){
  var on=isListened(r);
  var data=esc(JSON.stringify({artist:r.artist,title:r.title}));
  return "<button class='listenbtn"+(on?" on":"")+"' data-listen=\""+data+"\">"+
    (on?"\u2713 Listened":"Mark as listened")+"</button>";
}
document.addEventListener("click",function(e){
  var b=e.target.closest("[data-listen]");
  if(!b)return;
  e.preventDefault();
  var rec=null;
  try{rec=JSON.parse(b.getAttribute("data-listen"));}catch(err){return;}
  var on=toggleListened(rec);
  b.classList.toggle("on",on);
  b.textContent=on?"\u2713 Listened":"Mark as listened";
});
function discLinks(r){
  var q=encodeURIComponent((r.artist||"")+" "+(r.title||""));
  var dq=q+(r.pressing_search?"+"+encodeURIComponent(r.pressing_search):"");
  return "<div class='rlinks'>"+
    "<a href='https://open.spotify.com/search/"+q+"' target='_blank' rel='noopener'>"+
      svcIcon("spotify",true)+"Spotify</a>"+
    "<a href='https://www.discogs.com/search/?q="+dq+"&type=release' target='_blank' rel='noopener'>"+
      svcIcon("discogs",true)+"Discogs</a>"+
    "<a href='https://www.youtube.com/results?search_query="+q+"' target='_blank' rel='noopener'>"+
      svcIcon("youtube",true)+"YouTube</a>"+
    "</div>";
}
/* cover art for a recommendation: reuses the same iTunes lookup and
   cache the shelf uses, via a stand-in record object */
/* ---- artwork for recommended records -----------------------------
   These aren't in the collection, so there's no Discogs id to work
   from — only artist and title. iTunes handles the well-known ones but
   misses plenty of the obscure records Discover is meant to surface, so
   MusicBrainz + the Cover Art Archive (both free, keyless and
   CORS-friendly) act as a second pass. If both come up empty the card
   keeps a lettered placeholder rather than an empty box. */
function recArtFallback(artist,title,cb){
  var key="mbart:"+norm(artist)+"|"+norm(title);
  var c=cacheGet(key);
  if(c)return cb(c==="0"?null:c);
  var q=encodeURIComponent('artist:"'+artist+'" AND releasegroup:"'+title+'"');
  fetch("https://musicbrainz.org/ws/2/release-group/?query="+q+"&fmt=json&limit=1")
    .then(function(res){if(!res.ok)throw 0;return res.json();})
    .then(function(d){
      var g=d&&d["release-groups"]&&d["release-groups"][0];
      if(!g||!g.id)throw 0;
      var url="https://coverartarchive.org/release-group/"+g.id+"/front-500";
      cacheSet(key,url);
      cb(url);
    })
    .catch(function(){cacheSet(key,"0");cb(null);});
}
function setRecArt(el,url,cb){
  var img=new Image();
  img.onload=function(){el.innerHTML="";el.appendChild(img);};
  img.onerror=function(){if(cb)cb();};      /* e.g. Cover Art Archive 404 */
  img.src=url; img.alt="";
}
function fillRecArt(scope){
  [].forEach.call((scope||document).querySelectorAll(".rart[data-a]"),function(el){
    if(el.dataset.done)return; el.dataset.done="1";
    var a=el.dataset.a,t=el.dataset.t;

    /* If the entry already carries a cover \u2014 a wantlist record added
       from a Discogs search does \u2014 use that one. Looking it up again by
       artist and title returned a different pressing's sleeve, so the
       record you added showed art you had not chosen. */
    if(el.dataset.cover){
      setRecArt(el,el.dataset.cover,function(){});
      return;
    }
    if(!el.innerHTML.trim()){
      el.innerHTML="<span class='rph'>"+esc((a||"?").charAt(0).toUpperCase())+"</span>";
    }
    var stub={a:a,t:t,img:null};
    cover(stub,function(u){
      if(u)return setRecArt(el,u,function(){tryFallback();});
      tryFallback();
    },true);   /* foreground: these cards are on screen now */
    function tryFallback(){
      recArtFallback(a,t,function(u2){ if(u2)setRecArt(el,u2); });
    }
  });
}
/* shared card renderer — used by Discover, the chat's "something new"
   answers, and the wantlist, so all three look and behave identically */
function recCardHTML(r){
  var meta=[r.year,r.genre].filter(Boolean).join(" \u00b7 ");
  return "<div class='rec'>"+
    "<div class='rtop'>"+
      /* Carry the cover the entry already has, so it is not looked up
         again and answered with a different pressing's sleeve. */
      "<span class='rart' data-a=\""+esc(r.artist||"")+"\" data-t=\""+esc(r.title||"")+"\""+
        (r.cover?" data-cover=\""+esc(r.cover)+"\"":"")+"></span>"+
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
    discLinks(r)+"<div class='ractions'>"+wantBtn(r)+listenBtn(r)+"</div></div>";
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
var discCheckedShared=false;

/* Today's picks as stored by whichever device generated them. Anything
   from an earlier day is ignored \u2014 the point is that today's three are
   the same everywhere, not that old ones are preserved. */
/* When this device last adopted or published a set. Comparing against
   the shared copy's stamp is what makes "the most recent generation
   wins" true rather than "whichever device asked first". */
function discStamp(){
  try{return +localStorage.getItem("disc_at")||0;}catch(e){return 0;}
}
function noteDiscStamp(t){
  try{localStorage.setItem("disc_at",String(t||Date.now()));}catch(e){}
}

function sharedPicks(cb){
  fetch("/api/sheet",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"getConfig",key:"disc_shared"})
  })
  .then(function(r){return r.json();})
  .then(function(d){
    var p=null;
    try{p=JSON.parse((d&&d.value)||"null");}catch(e){}
    /* Only today's, and only if it is newer than what this device last
       saw \u2014 otherwise a device would keep re-adopting its own set. */
    if(!p||p.day!==todayKey()){cb(null);return;}
    cb({recs:p.recs,at:p.at||0});
  })
  .catch(function(){cb(null);});
}
/* The radar shares the Discover tab: both answer "what should I get",
   one from taste and one from what is actually being pressed. */
function loadRadarIfReady(){
  if (typeof loadRadar === "function") loadRadar(false);
}

function loadDaily(force){
  if(discBusy)return;
  var key="disc:"+todayKey();
  document.getElementById("discdate").textContent=force?"A different set":"Today's picks";
  if(!force){
    var cached=null;try{cached=localStorage.getItem(key);}catch(e){}
    if(cached){
      try{
        renderDaily(JSON.parse(cached));
        /* Checked on every open rather than once per session: a
           once-only guard meant a device that checked before the sheet
           was reachable never looked again. */
        sharedPicks(function(p){
          if(p&&p.recs&&p.recs.length&&p.at>discStamp()){
            try{localStorage.setItem(key,JSON.stringify(p.recs));}catch(e){}
            noteDiscStamp(p.at);
            renderDaily(p.recs);
          }
        });
        return;
      }catch(e){}
    }
    /* Nothing on this device yet: another one may already have picked
       today's three. Two devices each generating their own meant two
       different sets of "today's picks", and two AI requests for one
       day's worth of suggestions. */
    if(!discCheckedShared){
      discCheckedShared=true;
      sharedPicks(function(p){
        if(p&&p.recs&&p.recs.length){
          try{localStorage.setItem(key,JSON.stringify(p.recs));}catch(e){}
          noteDiscStamp(p.at);
          rememberSeen(p.recs);
          renderDaily(p.recs);
        } else {
          loadDaily(force);
        }
      });
      return;
    }
  }
  discBusy=true;
  document.getElementById("discbody").innerHTML=
    "<p class='hint'><span class='dots'><span></span><span></span><span></span></span> Finding something good\u2026</p>";
  aiFetchUser(API_BASE+"recommend",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode:"discover",records:collectionPayload(),count:3,
      adventurous:document.getElementById("advtoggle").getAttribute("aria-pressed")==="true",
      avoid:seenList(),seed:todayKey()+(force?"-"+Date.now():"")})
  }).then(function(res){
    if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;throw e;});}
    if(!res.ok)return aiFail(res);
    return res.json();
  }).then(function(recs){
    if(!Array.isArray(recs))throw new Error("failed");
    try{localStorage.setItem(key,JSON.stringify(recs));}catch(e){}
    noteDiscStamp(Date.now());
    /* Share today's set, so every device shows the same three. */
    if(typeof sheetWrite==="function"&&typeof isOwner==="function"&&isOwner()){
      sheetWrite("setConfig",{key:"disc_shared",
        value:JSON.stringify({day:todayKey(),at:Date.now(),recs:recs})},function(){});
    }
    rememberSeen(recs);
    renderDaily(recs);
    discBusy=false;
  }).catch(function(err){
    document.getElementById("discbody").innerHTML="<p class='hint'>"+
      (err.message==="busy"
        ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific, not in a few minutes."
          : "Hit the per-minute rate limit \u2014 give it a minute and try again.")
        : aiErrText(err, "the recommender"))+"</p>";
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
