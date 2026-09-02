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

/* ---- spec lookup ---- */
function lookupGear(k){
  var g=gearAll();
  var input=document.querySelector("#gearrows input[data-k='"+k+"']");
  var name=(input&&input.value||"").trim();
  if(!name)return;
  var slot=GEAR_SLOTS.filter(function(s){return s.k===k;})[0];
  var btn=document.querySelector(".glook[data-k='"+k+"']");
  if(btn){btn.textContent="\u2026";btn.disabled=true;}
  fetch(API_BASE+"gear",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode:"specs",kind:k,name:name})
  }).then(function(res){
    if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;throw e;});}
    if(!res.ok)throw new Error("failed");
    return res.json();
  }).then(function(d){
    var cur=gearAll();
    cur[k]={
      name:(d&&d.found&&d.resolved_name)?d.resolved_name:name,
      maker:(d&&d.maker)||"",
      specs:(d&&Array.isArray(d.specs))?d.specs:[],
      summary:(d&&d.summary)||"",
      sound:(d&&d.sound)||"",
      sources:(d&&d.sources)||[],
      grounded:!!(d&&d.grounded),
      found:!!(d&&d.found)
    };
    gearSave(cur);
    renderGearRows();
    openGear(k);
  }).catch(function(err){
    var cur=gearAll();
    cur[k]=cur[k]||{};cur[k].name=name;
    gearSave(cur);
    renderGearRows();
    alert(err.message==="busy"
      ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific, not in a few minutes."
          : "Hit the per-minute rate limit \u2014 give it a minute and try again.")
      : "Couldn't look that up just now. The name is saved; try Look up again later.");
  });
}

/* ---- component detail panel ---- */
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
    (c.found===false?"<p class='hint'>Couldn't identify this one from a search \u2014 "+
      "the specs below may be incomplete. Check the model name, or fill them in yourself.</p>":"")+
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
    "<div class='rlinks'>"+
      "<a href='https://www.google.com/search?q="+q+"+specifications' target='_blank' rel='noopener'>Search the web</a>"+
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
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;throw e;});}
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
