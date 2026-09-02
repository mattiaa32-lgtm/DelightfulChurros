function paintArt(i,u){
  var nodes=document.querySelectorAll(".art[data-i='"+i+"']");
  [].forEach.call(nodes,function(el){
    var img=new Image();
    img.onload=function(){el.innerHTML="";el.appendChild(img);el.style.background="var(--surface2)";};
    img.src=u; img.alt="";
  });
}
/* Resolve *where a record currently lives* by content, never by a
   remembered array position: RECS gets replaced wholesale once the
   live Google Sheet loads (swapping out the baked-in copy), so any
   index captured before that swap can end up pointing at a totally
   different record by the time a slow network request finishes. */
function findIndexByAT(a,t){
  var na=norm(a),nt=norm(t);
  for(var k=0;k<RECS.length;k++){if(norm(RECS[k].a)===na&&norm(RECS[k].t)===nt)return k;}
  return -1;
}
function findIndexByDiscogsId(id){
  for(var k=0;k<RECS.length;k++){if(RECS[k].d===id)return k;}
  return -1;
}
/* `front` jumps the queue. The shelf backfills art for the whole
   collection at two requests at a time, so without this a handful of
   cards the user is actually looking at (Discover, chat answers, the
   wantlist) queue up behind ~180 background jobs and take half a
   minute to appear — which reads as "covers are broken". */
function cover(r,cb,front){
  if(r.img)return cb(r.img);
  var key="cov:"+norm(r.a)+"|"+norm(r.t),c=null;
  try{c=localStorage.getItem(key);}catch(e){}
  if(c)return cb(c);
  if(FAILED[key]||failedRecently(key,6))return cb(null);
  function ask(done){
    var term=encodeURIComponent(query(r));
    jsonp("https://itunes.apple.com/search?term="+term+"&entity=album&limit=1",function(d){
      var u=null;
      try{if(d&&d.results&&d.results[0]&&d.results[0].artworkUrl100)
        u=d.results[0].artworkUrl100.replace(/100x100/,"400x400");}catch(e){}
      if(u){cacheSet(key,u);}else{FAILED[key]=1;markFailed(key);}
      cb(u);if(done)done();
    });
  }
  /* Foreground requests skip the queue entirely rather than merely
     jumping it. The background sweep keeps both queue slots busy for
     minutes on end, so even a front-of-queue item waits; there are only
     ever a few on-screen cards, so firing them directly is safe. */
  if(front){ask(null);return;}
  Q.push(ask);
  pump();
}
/* ---- pressing-accurate cover art via the Discogs API ----
   Unauthenticated GET requests to /releases/{id} are CORS-friendly and
   need no key, but Discogs caps them at ~25/min. Two paths use this:
   1) whatever record you open gets checked right away;
   2) a slow background sweep (one call every 2.5s) works through the
      rest of the collection afterwards, so list thumbnails end up on
      the real pressing photo too \u2014 not just whatever iTunes matched,
      or nothing if iTunes found no match at all. A record only has no
      art once every path has come up empty: no Cover URL override, no
      Discogs id (or Discogs has no photo for that release), and iTunes
      couldn't find a matching album by artist + title. Everything here
      is cached in localStorage, so each record is only ever fetched
      once per browser. */
/* ---- Discogs: cover art AND release year -------------------------
   These used to be fetched together, gated on whether the record still
   needed artwork. That meant any record with art already resolved (or
   with a Cover URL frozen into the sheet) never had its year looked up
   at all — which is why the decade chart only recognised a handful of
   records. Year and art are now independent: a record is queued if it
   is missing EITHER.

   For the year we prefer the MASTER release, which is the original
   release year rather than the year of whichever pressing is on the
   shelf — a 2015 reissue of a 1971 record belongs in the 70s. Master
   years are cached by master id, so different pressings of the same
   album only cost one lookup between them. Everything here is cached
   permanently; nothing is re-fetched once known. */
/* Two different years, both worth knowing:
   - firstYear: when the album originally came out (the Discogs master).
     This is what the decade chart uses — a reissue belongs to the
     decade of the music, not of the repress.
   - pressYear: the year of the specific pressing on the shelf. */
function cachedYear(r){          /* first release — used for decades */
  if(!r.d)return "";
  var y=cacheGet("dfirst:"+r.d);
  return y&&y!=="0"?y:"";
}
function pressYear(r){
  if(!r.d)return "";
  var y=cacheGet("dpress:"+r.d);
  return y&&y!=="0"?y:"";
}
function needsDiscogs(r){
  if(!r.d)return false;
  var haveArt=r.img||cacheGet("dcog:"+r.d);
  var haveYear=cacheGet("dfirst:"+r.d)&&cacheGet("dpress:"+r.d);
  return !haveArt||!haveYear;
}
function fetchMasterYear(masterId,cb){
  var mk="myear:"+masterId,m=cacheGet(mk);
  if(m)return cb(m==="0"?null:m);
  fetch("https://api.discogs.com/masters/"+masterId)
    .then(function(res){if(!res.ok)throw 0;return res.json();})
    .then(function(d){
      var y=(d&&d.year)?String(d.year):null;
      cacheSet(mk,y||"0");
      cb(y);
    })
    .catch(function(){cb(null);});
}
/* Fetches the release once and stores whatever is still missing. */
function fetchDiscogs(r,cb){
  var artKey="dcog:"+r.d,yearKey="dfirst:"+r.d;
  var haveArt=cacheGet(artKey),haveYear=cacheGet(yearKey)&&cacheGet("dpress:"+r.d);
  if(haveArt&&haveYear)return cb(haveArt==="0"?null:haveArt);
  fetch("https://api.discogs.com/releases/"+r.d)
    .then(function(res){if(!res.ok)throw 0;return res.json();})
    .then(function(d){
      if(!haveArt){
        var im=d&&d.images&&d.images[0],u=(im&&(im.uri||im.uri150))||null;
        cacheSet(artKey,u||"0");
        haveArt=u||"0";
      }
      if(haveYear){cb(haveArt==="0"?null:haveArt);return;}
      var py=(d&&d.year)?String(d.year):null;
      cacheSet("dpress:"+r.d,py||"0");      /* this pressing */
      if(d&&d.master_id){
        fetchMasterYear(d.master_id,function(my){
          cacheSet(yearKey,my||py||"0");    /* original release */
          cb(haveArt==="0"?null:haveArt);
        });
      }else{
        cacheSet(yearKey,py||"0");
        cb(haveArt==="0"?null:haveArt);
      }
    })
    .catch(function(){cb(null);});
}
function coverDiscogs(r,cb){
  if(!r.d)return cb(null);
  var c=cacheGet("dcog:"+r.d);
  if(c&&cacheGet("dfirst:"+r.d))return cb(c==="0"?null:c);
  fetchDiscogs(r,cb);
}
function upgradeDetailArt(r){
  if(r.img)return;
  var id=r.d;
  coverDiscogs(r,function(u){
    if(!u)return;
    var k=findIndexByDiscogsId(id);
    if(k>-1)paintArt(k,u);
  });
}
var discogsQ=[],discogsQueued={},discogsRunning=false;
function pumpDiscogs(){
  if(discogsRunning||!discogsQ.length)return;
  discogsRunning=true;
  var r=discogsQ.shift(),id=r.d;
  fetchDiscogs(r,function(u){
    if(u&&!r.img){var k=findIndexByDiscogsId(id);if(k>-1)paintArt(k,u);}
    /* a master lookup can double the calls for one record, so keep the
       gap comfortably inside Discogs' ~25/min ceiling */
    setTimeout(function(){discogsRunning=false;pumpDiscogs();},3000);
  });
}
function warmDiscogsCache(){
  RECS.forEach(function(r){
    if(discogsQueued[r.d]||!needsDiscogs(r))return;
    discogsQueued[r.d]=1;
    discogsQ.push(r);
  });
  pumpDiscogs();
}
/* ---- a short two-part description \u2014 a concrete fact plus what it
   actually sounds like \u2014 written by Gemini's free tier via a small
   Vercel function (api/describe.js), so the API key
   never touches the browser. Grounded with whatever real data is on
   hand (the Discogs release year, once known, and your own category
   from the sheet) so it isn't just guessing.
   Gemini's free tier limits requests per minute, and the exact ceiling
   varies by model and account, so rather than guessing a safe fixed
   pace this adapts: a 429 (rate limited) widens the gap between calls
   and re-queues that record to try again, and the gap narrows back
   after a run of successes. Failures are never cached and never leave
   a record marked as done, so nothing gets silently skipped \u2014 worst
   case it's retried later or on the next reload. */
var AI_MIN_MS=4500,AI_MAX_MS=30000;
var AI_INTERVAL_MS=AI_MIN_MS;
var aiQ=[],aiRunning=false,aiStreak=0;
function pumpAI(){
  if(aiRunning||!aiQ.length)return;
  aiRunning=true;
  var job=aiQ.shift();
  job(function(){setTimeout(function(){aiRunning=false;pumpAI();},AI_INTERVAL_MS);});
}
function aiSlowDown(){
  AI_INTERVAL_MS=Math.min(AI_MAX_MS,Math.round(AI_INTERVAL_MS*1.8));
  aiStreak=0;
}
function aiSpeedUp(){
  if(++aiStreak>=8&&AI_INTERVAL_MS>AI_MIN_MS){
    AI_INTERVAL_MS=Math.max(AI_MIN_MS,Math.round(AI_INTERVAL_MS/1.3));
    aiStreak=0;
  }
}

/* ---- negative caching ------------------------------------------------
   Previously only SUCCESSES were cached. Anything that came back empty
   (no iTunes match, no AI result) or that failed because we were rate
   limited was retried from scratch on EVERY app open — so a single
   rate-limited session turned into hundreds of repeat requests the next
   time the app loaded. Failures are now remembered too, with a cooldown,
   and a hard daily ceiling backs that up. */
function cacheGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function cacheSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
function cacheDel(k){try{localStorage.removeItem(k);}catch(e){}}
var FAILP="!f2:";
function failedRecently(key,hours){
  var t=cacheGet(FAILP+key);
  if(!t)return false;
  if(Date.now()-(+t)<hours*3600000)return true;
  cacheDel(FAILP+key);
  return false;
}
function markFailed(key){cacheSet(FAILP+key,String(Date.now()));}
function dayStamp(){
  var d=new Date();
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}
/* Hard ceiling on AI description calls per day. The whole collection is
   a one-time cost of ~180; anything beyond this in a single day means
   something is looping, so we stop rather than burn the quota. */
var AI_DAILY_CAP=220;
function aiSpend(){
  var k="aibudget:"+dayStamp(),n=(+cacheGet(k)||0)+1;
  cacheSet(k,String(n));
  return n;
}
function aiBudgetExhausted(){return (+cacheGet("aibudget:"+dayStamp())||0)>=AI_DAILY_CAP;}
/* Set once a 429 comes back: stops the background sweep for the rest of
   the session instead of retrying each record several times over. */
var aiHalted=false;
function aiHalt(){aiHalted=true;}

function descAI(r,cb){
  var key="desc2:"+norm(r.a)+"|"+norm(r.t);
  var c=cacheGet(key);
  if(c)return cb(c);
  if(aiHalted||aiBudgetExhausted())return cb(null);
  /* don't re-ask for something that already came back empty today */
  if(failedRecently(key,24))return cb(null);
  aiQ.push(function(done){
    if(aiHalted||aiBudgetExhausted()){cb(null);done();return;}
    aiSpend();
    var qs="artist="+encodeURIComponent(artistQ(r.a))+
           "&title="+encodeURIComponent(titleQ(r.t))+
           "&category="+encodeURIComponent(r.c||"")+
           "&year="+encodeURIComponent(cachedYear(r));
    fetch(API_BASE+"describe?"+qs)
      .then(function(res){
        if(res.status===429){
          /* Stop the whole sweep rather than retrying this record: the
             old code queued up to 4 more attempts EACH, which is what
             turned one bad session into hundreds of calls. */
          aiHalt();
          throw 0;
        }
        if(!res.ok)throw 0;
        return res.json();
      })
      .then(function(d){
        var line=(d&&d.text)?d.text.trim():null;
        if(line){cacheSet(key,line);aiSpeedUp();}
        else markFailed(key);
        cb(line);done();
      })
      .catch(function(){
        if(!aiHalted)markFailed(key);   // empty result, not a rate limit
        cb(null);done();
      });
  });
  pumpAI();
}
function paintDesc(i,text){
  var el=document.querySelector(".d-desc[data-i='"+i+"']");
  if(el)el.textContent=text||"";
}
function upgradeDetailDesc(r){
  if(r.desc)return;
  descAI(r,function(t){
    if(!t)return;
    var k=findIndexByAT(r.a,r.t);
    if(k>-1)paintDesc(k,t);
  });
}
var descQueued={};
function warmDescCache(){
  if(aiHalted||aiBudgetExhausted())return;
  RECS.forEach(function(r){
    var dk=norm(r.a)+"|"+norm(r.t);
    if(r.desc||descQueued[dk])return;
    if(cacheGet("desc2:"+dk))return;
    if(failedRecently("desc2:"+dk,24))return;   // already tried, came back empty
    descQueued[dk]=1;
    descAI(r,function(t){
      if(!t)return;
      var k=findIndexByAT(r.a,r.t);
      if(k>-1)paintDesc(k,t);
    });
  });
}
function artBox(r,cls){
  var letter=esc(artistQ(r.a).charAt(0).toUpperCase());
  return "<span class='art "+(cls||"")+"' data-i='"+r.i+"' style='background:"+COLORS[r.c]+"'>"+
         "<span class='ph'>"+letter+"</span></span>";
}
function fillArt(scope){
  var nodes=(scope||document).querySelectorAll(".art[data-i]");
  [].forEach.call(nodes,function(el){
    if(el.dataset.done)return; el.dataset.done="1";
    var r=RECS[+el.dataset.i];
    cover(r,function(u){
      if(!u)return;
      var k=findIndexByAT(r.a,r.t);
      if(k>-1)paintArt(k,u);
    });
  });
}
