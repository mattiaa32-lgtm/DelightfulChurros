/* ================== Dashboard ==================
   Two layers, deliberately kept apart:
   - COMPUTED: counted from the real records. Facts, instant, no model.
   - JUDGED:   canonical coverage, gaps, character. Asked of the model,
               cached against a hash of the collection so it only ever
               regenerates when records are actually added or changed.
   No overall score out of ten anywhere: a generated number would look
   precise and wouldn't survive a regeneration. Bands and prose instead. */

function collectionHash(){
  var s=RECS.map(function(r){return r.a+"|"+r.t;}).sort().join(";");
  var h=0;
  for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}
  return String(h)+"."+RECS.length;
}
function catCounts(){
  var m={};
  RECS.forEach(function(r){m[r.c]=(m[r.c]||0)+1;});
  return Object.keys(m).map(function(c){return {cat:c,n:m[c]};})
    .sort(function(a,b){return b.n-a.n;});
}
function computedStats(){
  /* Two independent year series: when the music first came out (the
     Discogs master) and when the copy on the shelf was pressed. */
  var artists={},years=[],pyears=[],withId=0,withDesc=0;
  RECS.forEach(function(r){
    artists[r.a]=(artists[r.a]||0)+1;
    if(r.d)withId++;
    if(resolvedDesc(r))withDesc++;
    var y=cachedYear(r);
    if(y&&/^\d{4}$/.test(y))years.push(+y);
    var p=pressYear(r);
    if(p&&/^\d{4}$/.test(p))pyears.push(+p);
  });
  var names=Object.keys(artists);
  var deepest=names.sort(function(a,b){return artists[b]-artists[a];})[0];
  var cats=catCounts(),top=cats[0];
  function byDecade(list){
    var out={};
    list.forEach(function(y){var d=Math.floor(y/10)*10;out[d]=(out[d]||0)+1;});
    return Object.keys(out).sort().map(function(d){return {d:d,n:out[d]};});
  }
  return {
    total:RECS.length,
    artists:names.length,
    perArtist:names.length?(RECS.length/names.length).toFixed(1):"0",
    deepest:deepest, deepestN:deepest?artists[deepest]:0,
    cats:cats,
    topShare:top?Math.round(top.n/RECS.length*100):0,
    decades:byDecade(years),
    pdecades:byDecade(pyears),
    yearsKnown:years.length,
    pyearsKnown:pyears.length,
    withId:withId, withDesc:withDesc
  };
}
/* donut chart, drawn as SVG arcs in the category colours already used
   throughout the app so the shelf and the chart agree visually */
function donutSVG(cats,total){
  var cx=90,cy=90,r=62,w=26,acc=0,paths=[];
  cats.forEach(function(c){
    var frac=c.n/total, a0=acc*2*Math.PI-Math.PI/2;
    acc+=frac;
    var a1=acc*2*Math.PI-Math.PI/2;
    var large=frac>0.5?1:0;
    var x0=cx+r*Math.cos(a0),y0=cy+r*Math.sin(a0);
    var x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
    if(frac>=0.999){
      paths.push("<circle cx='"+cx+"' cy='"+cy+"' r='"+r+"' fill='none' stroke='"+
        (COLORS[c.cat]||"#8A8A8A")+"' stroke-width='"+w+"'></circle>");
    }else{
      paths.push("<path d='M "+x0.toFixed(2)+" "+y0.toFixed(2)+
        " A "+r+" "+r+" 0 "+large+" 1 "+x1.toFixed(2)+" "+y1.toFixed(2)+
        "' fill='none' stroke='"+(COLORS[c.cat]||"#8A8A8A")+
        "' stroke-width='"+w+"' data-cat=\""+esc(c.cat)+"\"></path>");
    }
  });
  return "<svg viewBox='0 0 180 180' class='donut' role='img' aria-label='Records per category'>"+
    paths.join("")+
    "<text x='90' y='86' text-anchor='middle' class='dnum'>"+total+"</text>"+
    "<text x='90' y='103' text-anchor='middle' class='dlab'>records</text></svg>";
}
function renderDashComputed(){
  var s=computedStats();
  document.getElementById("dashstats").innerHTML=
    "<div class='chartrow'>"+donutSVG(s.cats,s.total)+
      "<div class='legend'>"+s.cats.map(function(c){
        return "<button class='lgi' data-cat=\""+esc(c.cat)+"\">"+
          "<i style='background:"+(COLORS[c.cat]||"#8A8A8A")+"'></i>"+
          "<span class='lgn'>"+esc(c.cat)+"</span>"+
          "<span class='lgc'>"+c.n+"</span></button>";
      }).join("")+"</div>"+
    "</div>"+
    "<div class='kpis'>"+
      kpi("Artists",s.artists,"across "+s.total+" records")+
      kpi("Records per artist",s.perArtist,"deepest: "+esc(s.deepest||"\u2014")+" ("+s.deepestN+")")+
      kpi("Largest category",s.topShare+"%",(s.cats[0]?s.cats[0].cat:"\u2014"),
          s.cats[0]?s.cats[0].cat:null)+
      /* the headline number is the Discogs-linked count; the subtitle
         used to quote the *described* count, which made the two look
         inconsistent (98% over "178 of 178") */
      kpi("Linked to Discogs",Math.round(s.withId/s.total*100)+"%",
          s.withId+" of "+s.total+" \u00b7 "+(s.total-s.withId)+" still to link")+
    "</div>"+
    decadeCard("When the music came out",s.decades,"first",
      "Original release year, from the Discogs master \u2014 a reissue counts "+
      "in the decade of the album, not of the repress.",s.yearsKnown,s.total)+
    decadeCard("When my copies were pressed",s.pdecades,"press",
      "Pressing year of the specific record on your shelf.",s.pyearsKnown,s.total);
}
/* Both decade charts share one renderer; `kind` decides which drill-down
   opens when a bar is tapped. */
function decadeCard(title,rows,kind,note,known,total){
  if(!rows||!rows.length)return "";
  var max=Math.max.apply(null,rows.map(function(x){return x.n;}));
  return "<div class='deccard'><div class='ktitle'>"+esc(title)+"</div>"+
    "<div class='decs'>"+rows.map(function(d){
      return "<button class='dec' data-decade='"+d.d+"' data-kind='"+kind+"'>"+
        "<div class='decbar' style='height:"+Math.round(d.n/max*100)+"%'></div>"+
        "<div class='decl'>"+String(d.d).slice(2)+"s</div>"+
        "<div class='decn'>"+d.n+"</div></button>";
    }).join("")+"</div>"+
    "<p class='hint'>"+esc(note)+" Known for "+known+" of "+total+".</p></div>";
}
function kpi(label,value,sub,cat){
  /* when a KPI is about one category, make the whole tile a target */
  var tag=cat?"button":"div",attr=cat?" data-cat=\""+esc(cat)+"\"":"";
  return "<"+tag+" class='kpi"+(cat?" tappable":"")+"'"+attr+"><div class='ktitle'>"+esc(label)+"</div>"+
    "<div class='kval'>"+esc(String(value))+"</div>"+
    "<div class='ksub'>"+esc(sub||"")+"</div></"+tag+">";
}

/* ---- judged layer, cached against the collection hash ---- */
function renderAssessment(a){
  var el=document.getElementById("dashjudge");
  el.innerHTML=
    "<div class='assess'>"+
      "<div class='ahead'>"+esc(a.headline||"")+"</div>"+
      (a.character?"<p class='achar'>"+esc(a.character)+"</p>":"")+
      (a.verdict?"<div class='averdict'>"+esc(a.verdict)+"</div>":"")+
      (Array.isArray(a.strengths)&&a.strengths.length?
        "<div class='ablock'><div class='ktitle'>Strengths</div>"+
        a.strengths.map(function(s){
          return "<p class='aitem'><b>"+esc(s.area||"")+"</b> \u2014 "+esc(s.note||"")+"</p>";
        }).join("")+"</div>":"")+
      (Array.isArray(a.gaps)&&a.gaps.length?
        "<div class='ablock'><div class='ktitle'>Gaps</div>"+
        a.gaps.map(function(g){
          return "<p class='aitem'><b>"+esc(g.area||"")+"</b> \u2014 "+esc(g.note||"")+
            (Array.isArray(g.examples)&&g.examples.length?
              "<span class='aex'>"+g.examples.map(esc).join(" \u00b7 ")+"</span>":"")+"</p>";
        }).join("")+"</div>":"")+
    "</div>";
}
var dashBusy=false;
function loadAssessment(force){
  if(dashBusy)return;
  var key="assess:"+collectionHash();
  if(!force){
    var c=null;try{c=localStorage.getItem(key);}catch(e){}
    if(c){try{renderAssessment(JSON.parse(c));return;}catch(e){}}
  }
  dashBusy=true;
  document.getElementById("dashjudge").innerHTML=
    "<p class='hint'><span class='dots'><span></span><span></span><span></span></span> Assessing the collection\u2026</p>";
  fetch(API_BASE+"analyze",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode:"collection",records:collectionPayload()})
  }).then(function(res){
    if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;throw e;});}
    if(!res.ok)throw new Error("failed");
    return res.json();
  }).then(function(a){
    try{localStorage.setItem(key,JSON.stringify(a));}catch(e){}
    renderAssessment(a);dashBusy=false;
  }).catch(function(err){
    document.getElementById("dashjudge").innerHTML="<p class='hint'>"+
      (err.message==="busy"
        ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific, not in a few minutes."
          : "Hit the per-minute rate limit \u2014 give it a minute and try again.")
        : "Couldn't reach the assessment service just now.")+"</p>";
    dashBusy=false;
  });
}

/* Decade drill-down. Deliberately local-only: the records and their
   cached Discogs years are already on the device, so listing them costs
   nothing. No API call is made for this. */
function openDecadeDive(dec,kind){
  var lo=+dec,hi=lo+9,hits=[],press=(kind==="press");
  RECS.forEach(function(r){
    var y=press?pressYear(r):cachedYear(r);
    if(y&&/^\d{4}$/.test(y)&&+y>=lo&&+y<=hi){
      hits.push({r:r,y:+y,other:press?cachedYear(r):pressYear(r)});
    }
  });
  hits.sort(function(a,b){return a.y-b.y||a.r.a.localeCompare(b.r.a);});
  var byCat={};
  hits.forEach(function(h){byCat[h.r.c]=(byCat[h.r.c]||0)+1;});
  var catLine=Object.keys(byCat).sort(function(a,b){return byCat[b]-byCat[a];})
    .map(function(c){return esc(c)+" ("+byCat[c]+")";}).join(" \u00b7 ");
  var el=document.getElementById("dashdive");
  el.hidden=false;
  el.innerHTML=
    "<div class='assess'>"+
      "<div class='divehead'><span class='ra'>"+String(lo).slice(2)+"s "+
        (press?"pressings":"originals")+"</span>"+
        "<button class='chip' id='diveclose'>Close</button></div>"+
      "<div class='ahead'>"+hits.length+" record"+(hits.length===1?"":"s")+
        (press?" pressed ":" originally released ")+lo+"\u2013"+hi+"</div>"+
      (catLine?"<p class='achar'>"+catLine+"</p>":"")+
      (hits.length
        ? "<div class='ablock'><div class='ktitle'>Records</div><p class='aitem'>"+
          hits.map(function(h){
            var extra=h.other?" ("+(press?"first out ":"pressed ")+h.other+")":"";
            return h.y+" \u2014 "+esc(h.r.a)+", "+esc(h.r.t)+extra;
          }).join("<br>")+"</p></div>"
        : "<p class='hint'>No release years known for this decade yet.</p>")+
    "</div>";
  document.getElementById("diveclose").addEventListener("click",function(){
    el.hidden=true;el.innerHTML="";
  });
  el.scrollIntoView({behavior:"smooth",block:"nearest"});
}

/* ---- per-category deep dive, opened from the chart or legend ---- */
function renderCatDive(cat,d){
  var el=document.getElementById("dashdive");
  el.innerHTML=
    "<div class='assess'>"+
      "<div class='divehead'><span class='ra'>"+esc(cat)+"</span>"+
        "<button class='chip' id='diveclose'>Close</button></div>"+
      "<div class='ahead'>"+esc(d.headline||"")+"</div>"+
      (d.assessment?"<p class='achar'>"+esc(d.assessment)+"</p>":"")+
      (d.verdict?"<div class='averdict'>"+esc(d.verdict)+"</div>":"")+
      (Array.isArray(d.canonical_held)&&d.canonical_held.length?
        "<div class='ablock'><div class='ktitle'>Key holdings</div><p class='aitem'>"+
        d.canonical_held.map(esc).join("<br>")+"</p></div>":"")+
      (Array.isArray(d.missing)&&d.missing.length?
        "<div class='ablock'><div class='ktitle'>Worth adding</div>"+
        d.missing.map(function(m){
          return "<div class='missrow'><div><b>"+esc(m.artist||"")+"</b> \u2014 "+
            esc(m.title||"")+(m.why?"<span class='aex'>"+esc(m.why)+"</span>":"")+"</div>"+
            wantBtn({artist:m.artist,title:m.title,fits:cat,why:m.why||""})+"</div>";
        }).join("")+"</div>":"")+
    "</div>";
  el.hidden=false;
  el.scrollIntoView({behavior:"smooth",block:"start"});
  document.getElementById("diveclose").addEventListener("click",function(){
    el.hidden=true;});
}
var diveBusy=false;
function openCatDive(cat){
  if(diveBusy||!cat)return;
  var key="dive:"+norm(cat)+":"+collectionHash();
  var c=null;try{c=localStorage.getItem(key);}catch(e){}
  if(c){try{renderCatDive(cat,JSON.parse(c));return;}catch(e){}}
  diveBusy=true;
  var el=document.getElementById("dashdive");
  el.hidden=false;
  el.innerHTML="<p class='hint'><span class='dots'><span></span><span></span><span></span></span> Looking at "+esc(cat)+"\u2026</p>";
  fetch(API_BASE+"analyze",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode:"category",category:cat,records:collectionPayload()})
  }).then(function(res){
    if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;throw e;});}
    if(!res.ok)throw new Error("failed");
    return res.json();
  }).then(function(d){
    try{localStorage.setItem(key,JSON.stringify(d));}catch(e){}
    renderCatDive(cat,d);diveBusy=false;
  }).catch(function(err){
    el.innerHTML="<p class='hint'>"+
      (err.message==="busy"
        ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific, not in a few minutes."
          : "Hit the per-minute rate limit \u2014 give it a minute and try again.")
        : "Couldn't load that category just now.")+"</p>";
    diveBusy=false;
  });
}
/* Every chart element that represents a slice of the collection is a
   drill-down target: pie arcs, legend rows, category KPI tiles and
   decade bars all route through here. */
document.getElementById("view-dash").addEventListener("click",function(e){
  var el=e.target.closest("[data-cat],[data-decade]");
  if(!el)return;
  var dec=el.getAttribute("data-decade");
  if(dec){openDecadeDive(dec,el.getAttribute("data-kind"));return;}
  var cat=el.getAttribute("data-cat")||el.dataset.cat;
  if(cat)openCatDive(cat);
});
document.getElementById("dashrefresh").addEventListener("click",function(e){
  e.preventDefault();loadAssessment(true);});

var dashDrawn=false;
function loadDash(){
  renderDashComputed();       /* always cheap, always current */
  /* wait for the live sheet before hashing the collection, so the
     cached assessment is found instead of being regenerated */
  onDataReady(function(){
    renderDashComputed();
    if(!dashDrawn){dashDrawn=true;loadAssessment(false);}
  });
}
