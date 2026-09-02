/* ================== Hi-fi setup ==================
   You name each component; the app looks its specs up via web search
   (through the gear function) and shows the pages it used, so every
   number is checkable. Anything search can't establish comes back blank
   rather than guessed, and every field stays editable by hand.
   The system evaluation is cached against a hash of the gear, so it
   only regenerates when you actually change something. */

var GEAR_SLOTS=[
  {k:"turntable", label:"Turntable",   required:true},
  {k:"cartridge", label:"Cartridge",   required:true},
  {k:"phono",     label:"Phono stage", hint:"skip if built into the turntable or amp"},
  {k:"amplifier", label:"Amplifier",   hint:"skip if speakers are active"},
  {k:"speakers",  label:"Speakers",    required:true}
];
function gearAll(){
  try{return JSON.parse(localStorage.getItem("gear")||"{}");}catch(e){return {};}
}
function gearSave(g){
  try{localStorage.setItem("gear",JSON.stringify(g));}catch(e){}
}
function gearHash(){
  var g=gearAll();
  return GEAR_SLOTS.map(function(s){
    var c=g[s.k];
    return s.k+":"+((c&&c.name)||"")+":"+((c&&c.specs&&c.specs.length)||0);
  }).join("|");
}

/* ---- signal chain diagram: only the components actually present ---- */
/* ---- the chain, drawn as the actual components ------------------
   Each slot gets a simple line-art icon of the real thing (platter and
   tonearm, cartridge body and stylus, a phono box, an amp with knobs,
   a speaker with drivers) rather than an identical labelled rectangle,
   so the diagram reads as a picture of your system. Everything stays
   on the currentColor stroke so it themes with the rest of the app. */
function iconTurntable(x,y){
  return "<g class='ico'>"+
    "<rect x='"+x+"' y='"+(y+12)+"' width='64' height='40' rx='4'></rect>"+
    "<circle cx='"+(x+26)+"' cy='"+(y+32)+"' r='14'></circle>"+
    "<circle cx='"+(x+26)+"' cy='"+(y+32)+"' r='2.5' class='fill'></circle>"+
    "<line x1='"+(x+52)+"' y1='"+(y+18)+"' x2='"+(x+38)+"' y2='"+(y+30)+"'></line>"+
    "<circle cx='"+(x+52)+"' cy='"+(y+18)+"' r='3'></circle>"+
    "</g>";
}
function iconCartridge(x,y){
  return "<g class='ico'>"+
    "<rect x='"+(x+14)+"' y='"+(y+14)+"' width='34' height='20' rx='3'></rect>"+
    "<line x1='"+(x+31)+"' y1='"+(y+34)+"' x2='"+(x+31)+"' y2='"+(y+46)+"'></line>"+
    "<polygon points='"+(x+28)+","+(y+46)+" "+(x+34)+","+(y+46)+" "+(x+31)+","+(y+52)+"' class='fill'></polygon>"+
    "<line x1='"+(x+18)+"' y1='"+(y+10)+"' x2='"+(x+44)+"' y2='"+(y+10)+"'></line>"+
    "</g>";
}
function iconPhono(x,y){
  return "<g class='ico'>"+
    "<rect x='"+(x+6)+"' y='"+(y+20)+"' width='52' height='26' rx='4'></rect>"+
    "<circle cx='"+(x+18)+"' cy='"+(y+33)+"' r='4'></circle>"+
    "<circle cx='"+(x+46)+"' cy='"+(y+33)+"' r='4'></circle>"+
    "<line x1='"+(x+28)+"' y1='"+(y+33)+"' x2='"+(x+37)+"' y2='"+(y+33)+"'></line>"+
    "</g>";
}
function iconAmp(x,y){
  return "<g class='ico'>"+
    "<rect x='"+(x+2)+"' y='"+(y+14)+"' width='60' height='38' rx='4'></rect>"+
    "<circle cx='"+(x+14)+"' cy='"+(y+33)+"' r='7'></circle>"+
    "<line x1='"+(x+14)+"' y1='"+(y+33)+"' x2='"+(x+14)+"' y2='"+(y+27)+"'></line>"+
    "<circle cx='"+(x+32)+"' cy='"+(y+33)+"' r='7'></circle>"+
    "<line x1='"+(x+32)+"' y1='"+(y+33)+"' x2='"+(x+36)+"' y2='"+(y+28)+"'></line>"+
    "<rect x='"+(x+44)+"' y='"+(y+26)+"' width='14' height='14' rx='2'></rect>"+
    "</g>";
}
function iconSpeakers(x,y){
  return "<g class='ico'>"+
    "<rect x='"+(x+8)+"' y='"+(y+8)+"' width='26' height='48' rx='3'></rect>"+
    "<circle cx='"+(x+21)+"' cy='"+(y+22)+"' r='5'></circle>"+
    "<circle cx='"+(x+21)+"' cy='"+(y+42)+"' r='8'></circle>"+
    "<rect x='"+(x+38)+"' y='"+(y+14)+"' width='20' height='42' rx='3'></rect>"+
    "<circle cx='"+(x+48)+"' cy='"+(y+26)+"' r='4'></circle>"+
    "<circle cx='"+(x+48)+"' cy='"+(y+43)+"' r='6'></circle>"+
    "</g>";
}
var GEAR_ICONS={turntable:iconTurntable,cartridge:iconCartridge,
                phono:iconPhono,amplifier:iconAmp,speakers:iconSpeakers};

function chainSVG(){
  var g=gearAll();
  var present=GEAR_SLOTS.filter(function(s){return g[s.k]&&g[s.k].name;});
  if(!present.length)return "";
  var bw=118,bh=74,gap=30,pad=10,top=14;
  var w=present.length*bw+(present.length-1)*gap+pad*2;
  var parts=[];
  present.forEach(function(s,i){
    var x=pad+i*(bw+gap),c=g[s.k];
    var draw=GEAR_ICONS[s.k]||iconPhono;
    parts.push(
      "<g class='node' data-k='"+s.k+"' role='button' tabindex='0'>"+
        "<rect x='"+x+"' y='"+top+"' width='"+bw+"' height='"+bh+"' rx='10' class='nhit'></rect>"+
        draw(x+27,top+2)+
        "<text x='"+(x+bw/2)+"' y='"+(top+bh+16)+"' text-anchor='middle' class='nlab'>"+
          esc(s.label)+"</text>"+
        "<text x='"+(x+bw/2)+"' y='"+(top+bh+31)+"' text-anchor='middle' class='nname'>"+
          esc(shortName(c.name))+"</text></g>");
    if(i<present.length-1){
      var ax=x+bw, ay=top+bh/2;
      parts.push("<line x1='"+ax+"' y1='"+ay+"' x2='"+(ax+gap-7)+"' y2='"+ay+
        "' class='wire'></line>"+
        "<polygon points='"+(ax+gap-7)+","+(ay-4)+" "+(ax+gap)+","+ay+" "+
        (ax+gap-7)+","+(ay+4)+"' class='wirehead'></polygon>");
    }
  });
  return "<div class='chainwrap'><svg viewBox='0 0 "+w+" "+(top+bh+42)+"' class='chain' "+
    "style='min-width:"+w+"px' role='img' aria-label='Signal chain'>"+
    parts.join("")+"</svg></div>";
}
function shortName(n){
  n=String(n||"");
  return n.length>22?n.slice(0,21)+"\u2026":n;
}

/* ---- component editor rows ---- */
function renderGearRows(){
  var g=gearAll();
  document.getElementById("gearrows").innerHTML=GEAR_SLOTS.map(function(s){
    var c=g[s.k]||{};
    var n=(c.specs||[]).length;
    return "<div class='gearrow'>"+
      "<div class='glabel'>"+esc(s.label)+
        (s.hint?"<span class='ghint'>"+esc(s.hint)+"</span>":"")+"</div>"+
      "<div class='ginput'>"+
        "<input type='text' data-k='"+s.k+"' value=\""+esc(c.name||"")+"\" "+
          "placeholder='e.g. Rega Planar 3' aria-label='"+esc(s.label)+" model'>"+
        "<button class='chip glook' data-k='"+s.k+"'>"+(c.name?"Refresh":"Look up")+"</button>"+
      "</div>"+
      (c.name?"<div class='gstat'>"+
        (n?n+" spec"+(n===1?"":"s")+(c.grounded?" \u00b7 from web":" \u00b7 unverified"):"no specs yet")+
        " \u00b7 <a href='#' class='gopen' data-k='"+s.k+"'>details</a></div>":"")+
      "</div>";
  }).join("");
  document.getElementById("gearchain").innerHTML=chainSVG();
}

/* ---- free, keyless gear lookup via Wikipedia ------------------------
   The AI path needs quota, and the free Gemini tier runs out. Wikipedia
   has no key, no quota and decent coverage of hi-fi hardware \u2014 most
   turntables, cartridges, amplifiers and speakers worth naming have a
   page or are described on their maker's page. It gives a summary and
   often a photo, which is most of what the panel shows anyway.

   So: Wikipedia first, always. The AI is then asked for structured
   specs as a bonus, and if that fails (quota, rate limit, anything) the
   Wikipedia result simply stands on its own instead of the whole lookup
   failing. Cached per component name like everything else. */
function wikiGear(name,cb){
  var key="wgear:"+norm(name);
  var c=null; try{c=localStorage.getItem(key);}catch(e){}
  if(c){try{return cb(JSON.parse(c));}catch(e){return cb(null);}}
  var q=encodeURIComponent(name);
  fetch("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch="+q+
        "&format=json&origin=*&srlimit=3")
    .then(function(res){if(!res.ok)throw 0;return res.json();})
    .then(function(d){
      var hits=(d&&d.query&&d.query.search)||[];
      if(!hits.length)throw 0;
      return tryHit(hits,0);
    })
    .then(function(out){
      if(out){try{localStorage.setItem(key,JSON.stringify(out));}catch(e){}}
      cb(out||null);
    })
    .catch(function(){cb(null);});

  function tryHit(hits,i){
    if(i>=hits.length)return null;
    return fetch("https://en.wikipedia.org/api/rest_v1/page/summary/"+
      encodeURIComponent(hits[i].title.replace(/ /g,"_")))
      .then(function(r){if(!r.ok)throw 0;return r.json();})
      .then(function(s){
        if(!s||!s.extract||s.type==="disambiguation")return tryHit(hits,i+1);
        /* only accept a page that actually mentions the model, so a
           search for "Rega Planar 3" can't land on "Turntable" */
        var words=norm(name).split(/\s+/).filter(function(x){return x.length>1;});
        var hay=norm(s.title+" "+s.extract.slice(0,400));
        var hitCount=words.filter(function(x){return hay.indexOf(x)>-1;}).length;
        if(hitCount<Math.max(1,Math.ceil(words.length*0.6)))return tryHit(hits,i+1);
        return {
          title:s.title,
          summary:s.extract,
          url:(s.content_urls&&s.content_urls.desktop&&s.content_urls.desktop.page)||"",
          image:(s.thumbnail&&s.thumbnail.source)||""
        };
      })
      .catch(function(){return tryHit(hits,i+1);});
  }
}

/* ---- spec lookup ---- */
function lookupGear(k){
  var input=document.querySelector("#gearrows input[data-k='"+k+"']");
  var name=(input&&input.value||"").trim();
  if(!name)return;
  var btn=document.querySelector(".glook[data-k='"+k+"']");
  if(btn){btn.textContent="\u2026";btn.disabled=true;}

  function save(patch){
    var cur=gearAll();
    cur[k]=cur[k]||{};
    Object.keys(patch).forEach(function(p){
      if(patch[p]!==undefined&&patch[p]!==null&&patch[p]!=="")cur[k][p]=patch[p];
    });
    cur[k].name=cur[k].name||name;
    gearSave(cur);
  }
  function finish(){
    if(btn){btn.textContent="Look up";btn.disabled=false;}
    renderGearRows();
    openGear(k);
  }

  /* step 1 \u2014 Wikipedia. No key, no quota, so this is the part that
     always works. */
  wikiGear(name,function(wiki){
    if(wiki){
      save({name:wiki.title||name,summary:wiki.summary,
            image:wiki.image,wikiUrl:wiki.url});
    }else{
      save({name:name});
    }

    /* step 2 \u2014 structured specs from the AI, if there's quota left.
       Failure here is not an error: the Wikipedia result stands, and the
       panel just says specs couldn't be fetched. */
    aiFetchUser(API_BASE+"gear",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({mode:"specs",kind:k,name:name})
    }).then(function(res){
      if(!res.ok)throw 0;
      return res.json();
    }).then(function(d){
      save({
        name:(d&&d.found&&d.resolved_name)?d.resolved_name:undefined,
        maker:(d&&d.maker)||undefined,
        specs:(d&&Array.isArray(d.specs)&&d.specs.length)?d.specs:undefined,
        summary:(d&&d.summary)||undefined,
        sound:(d&&d.sound)||undefined,
        sources:(d&&d.sources)||undefined,
        grounded:!!(d&&d.grounded),
        found:!!(d&&d.found)
      });
      finish();
    }).catch(function(){
      /* quota gone or lookup failed \u2014 keep whatever Wikipedia gave us */
      var cur=gearAll();
      if(cur[k])cur[k].specsUnavailable=!(cur[k].specs&&cur[k].specs.length);
      gearSave(cur);
      finish();
    });
  });
}

function openGear(k){
  var g=gearAll(),c=g[k];
  if(!c||!c.name)return;
  var slot=GEAR_SLOTS.filter(function(s){return s.k===k;})[0];
  var q=encodeURIComponent((c.maker?c.maker+" ":"")+c.name);
  document.getElementById("gearcard").innerHTML=
    "<div class='grab' id='gearcardgrab'></div>"+
    "<div class='d-artist'>"+esc(slot?slot.label:k)+"</div>"+
    "<div class='d-title'>"+esc(c.name)+"</div>"+
    (c.maker?"<div class='rmeta'>"+esc(c.maker)+"</div>":"")+
    (c.image?"<img class='gimg' src='"+esc(c.image)+"' alt='' loading='lazy'>":"")+
    (c.specsUnavailable?"<p class='hint'>Specifications couldn't be fetched \u2014 the AI "+
      "lookup is out of quota for now. The description below is from Wikipedia; you can "+
      "type any specs in yourself and they'll be kept.</p>":"")+
    (c.summary?"<p class='gsum'>"+esc(c.summary)+"</p>":"")+
    (c.sound?"<p class='rsounds'>"+esc(c.sound)+"</p>":"")+
    ((c.specs&&c.specs.length)?
      "<div class='ablock'><div class='ktitle'>Specifications</div>"+
      "<table class='spectab'>"+c.specs.map(function(s,i){
        return "<tr><td>"+esc(s.label)+"</td><td>"+
          "<input class='specval' data-k='"+k+"' data-i='"+i+"' value=\""+
          esc(s.value||"")+"\" aria-label=\""+esc(s.label)+"\"></td></tr>";
      }).join("")+"</table>"+
      "<p class='hint'>Edit any value if you know better \u2014 yours is kept.</p></div>"
      :"<p class='hint'>No specs found. You can add them by hand once you have them.</p>")+
    ((c.sources&&c.sources.length)?
      "<div class='ablock'><div class='ktitle'>Sources</div>"+
      c.sources.map(function(s){
        return "<a class='srcl' href='"+esc(s.url)+"' target='_blank' rel='noopener'>"+
          esc(s.title)+"</a>";
      }).join("")+"</div>"
      :(c.name?"<p class='hint'>No web sources were used \u2014 treat these specs as unverified.</p>":""))+
    "<div class='ablock' id='geardetail'></div>"+
    "<div class='rlinks'>"+
      (c.wikiUrl?"<a href='"+esc(c.wikiUrl)+"' target='_blank' rel='noopener'>Wikipedia</a>":"")+
      "<button class='glink' id='gearmore' data-k='"+k+"'>What reviewers say</button>"+
      "<a href='https://www.google.com/search?q="+q+"&tbm=isch' target='_blank' rel='noopener'>Photos</a>"+
    "</div>"+
    "<button class='close'>Close</button>";
  document.getElementById("gearsheet").classList.add("open");
}
function closeGear(){document.getElementById("gearsheet").classList.remove("open");}

/* ---- whole-system evaluation ---- */
function renderSystem(a){
  var el=document.getElementById("sysbody");
  var icon={good:"\u25CF",caution:"\u25B2",unknown:"\u25CB"};
  el.innerHTML="<div class='assess'>"+
    "<div class='ahead'>"+esc(a.headline||"")+"</div>"+
    (a.synergy?"<p class='achar'>"+esc(a.synergy)+"</p>":"")+
    (a.verdict?"<div class='averdict'>"+esc(a.verdict)+"</div>":"")+
    (Array.isArray(a.checks)&&a.checks.length?
      "<div class='ablock'><div class='ktitle'>Matching</div>"+
      a.checks.map(function(c){
        var st=(c.status||"unknown").toLowerCase();
        return "<p class='aitem chk "+esc(st)+"'><span class='chki'>"+
          (icon[st]||icon.unknown)+"</span><b>"+esc(c.label||"")+"</b> \u2014 "+
          esc(c.note||"")+"</p>";
      }).join("")+"</div>":"")+
    (a.weakest_link&&a.weakest_link.component?
      "<div class='ablock'><div class='ktitle'>Weakest link</div>"+
      "<p class='aitem'><b>"+esc(a.weakest_link.component)+"</b> \u2014 "+
      esc(a.weakest_link.why||"")+"</p></div>":"")+
    (a.upgrade_priority&&a.upgrade_priority.what?
      "<div class='ablock'><div class='ktitle'>Upgrade first</div>"+
      "<p class='aitem'><b>"+esc(a.upgrade_priority.what)+"</b> \u2014 "+
      esc(a.upgrade_priority.why||"")+
      (a.upgrade_priority.rough_budget?"<span class='aex'>"+
        esc(a.upgrade_priority.rough_budget)+"</span>":"")+"</p></div>":"")+
    "</div>";
}
var sysBusy=false;
function loadSystem(force){
  if(sysBusy)return;
  var g=gearAll();
  var named=GEAR_SLOTS.filter(function(s){return g[s.k]&&g[s.k].name;});
  var el=document.getElementById("sysbody");
  if(named.length<2){
    el.innerHTML="<p class='hint'>Add at least a couple of components above and "+
      "the system evaluation will appear here.</p>";
    return;
  }
  var key="sys:"+gearHash();
  if(!force){
    var c=null;try{c=localStorage.getItem(key);}catch(e){}
    if(c){try{renderSystem(JSON.parse(c));return;}catch(e){}}
  }
  sysBusy=true;
  el.innerHTML="<p class='hint'><span class='dots'><span></span><span></span><span></span></span> Evaluating the system\u2026</p>";
  fetch(API_BASE+"gear",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode:"system",gear:g})
  }).then(function(res){
    if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;
        e.quotaId=q&&q.quotaId;e.detail=q&&q.detail;throw e;});}
    if(!res.ok)throw new Error("failed");
    return res.json();
  }).then(function(a){
    try{localStorage.setItem(key,JSON.stringify(a));}catch(e){}
    renderSystem(a);sysBusy=false;
  }).catch(function(err){
    el.innerHTML="<p class='hint'>"+
      (err.message==="busy"
        ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific, not in a few minutes."
          : "Hit the per-minute rate limit \u2014 give it a minute and try again.")
        : "Couldn't evaluate the system just now.")+"</p>";
    sysBusy=false;
  });
}

/* ---- wiring ---- */
document.getElementById("view-hifi").addEventListener("click",function(e){
  var look=e.target.closest(".glook");
  if(look){lookupGear(look.dataset.k);return;}
  var open=e.target.closest(".gopen");
  if(open){e.preventDefault();openGear(open.dataset.k);return;}
  var node=e.target.closest(".node");
  if(node){openGear(node.dataset.k);return;}
});
document.getElementById("view-hifi").addEventListener("change",function(e){
  var inp=e.target.closest("#gearrows input[data-k]");
  if(!inp)return;
  var g=gearAll(),k=inp.dataset.k;
  g[k]=g[k]||{};
  g[k].name=inp.value.trim();
  if(!g[k].name)delete g[k];
  gearSave(g);renderGearRows();
});
document.getElementById("gearsheet").addEventListener("click",function(e){
  if(e.target.id==="gearsheet"||e.target.classList.contains("close"))closeGear();});
document.getElementById("gearsheet").addEventListener("change",function(e){
  var inp=e.target.closest(".specval");
  if(!inp)return;
  var g=gearAll(),k=inp.dataset.k,i=+inp.dataset.i;
  if(g[k]&&g[k].specs&&g[k].specs[i]){
    g[k].specs[i].value=inp.value;
    gearSave(g);renderGearRows();
  }
});
document.getElementById("sysrefresh").addEventListener("click",function(e){
  e.preventDefault();loadSystem(true);});

function loadHifi(){
  renderGearRows();
  loadSystem(false);
}

/* ---- "what reviewers say": a summary in place of a search link ------
   Clicking through to a web search meant leaving the app to do the work
   yourself. This asks the grounded endpoint for a précis of published
   opinion and renders it here instead. Cached per component, so it is
   fetched once and then frozen like everything else \u2014 it only refetches
   if you change the component. */
function detailKey(name){return "gdet:"+norm(String(name||""));}
function renderGearDetail(d){
  var el=document.getElementById("geardetail");
  if(!el)return;
  if(!d){el.innerHTML="";return;}
  function bullets(title,arr){
    if(!Array.isArray(arr)||!arr.length)return "";
    return "<div class='ktitle' style='margin-top:11px'>"+title+"</div>"+
      "<ul class='glist'>"+arr.slice(0,4).map(function(x){
        return "<li>"+esc(String(x))+"</li>";}).join("")+"</ul>";
  }
  el.innerHTML=
    "<div class='ktitle'>What reviewers say</div>"+
    (d.overview?"<p class='gsum'>"+esc(d.overview)+"</p>":"")+
    bullets("Praised for",d.strengths)+
    bullets("Watch out for",d.watch_outs)+
    (d.pairs_with?"<p class='rsounds'>"+esc(d.pairs_with)+"</p>":"")+
    (d.verdict?"<p class='averdict'>"+esc(d.verdict)+"</p>":"");
}
function loadGearDetail(k){
  var c=gearAll()[k];
  if(!c||!c.name)return;
  var key=detailKey(c.name),btn=document.getElementById("gearmore");
  var cached=null;
  try{cached=localStorage.getItem(key);}catch(e){}
  if(cached){
    try{renderGearDetail(JSON.parse(cached));}catch(e){}
    if(btn)btn.remove();
    return;
  }
  if(btn){btn.textContent="Reading reviews\u2026";btn.disabled=true;}
  fetch(API_BASE+"gear",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode:"detail",kind:k,name:c.name})
  }).then(function(res){
    if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(qq){var e=new Error("busy");e.quota=qq&&qq.quota;throw e;});}
    if(!res.ok)throw new Error("failed");
    return res.json();
  }).then(function(d){
    try{localStorage.setItem(key,JSON.stringify(d));}catch(e){}
    renderGearDetail(d);
    if(btn)btn.remove();
  }).catch(function(err){
    if(btn){btn.disabled=false;btn.textContent="What reviewers say";}
    var el=document.getElementById("geardetail");
    if(el)el.innerHTML="<p class='hint'>"+(err.message==="busy"
      ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific."
          : "Hit the per-minute rate limit \u2014 try again shortly.")
      : "Couldn't reach the summariser just now.")+"</p>";
  });
}
document.addEventListener("click",function(e){
  var b=e.target.closest("#gearmore");
  if(b)loadGearDetail(b.dataset.k);
});
