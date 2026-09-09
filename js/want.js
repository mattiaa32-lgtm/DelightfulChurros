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
    /* Kept when the entry came from a Discogs search: the id is what
       lets the arrival check match it against the collection later, and
       the cover saves fetching art the search already returned. */
    id:rec.id||null, cover:rec.cover||null,
    added:new Date().toISOString().slice(0,10)
  });
  try{localStorage.setItem("wantlist",JSON.stringify(list.slice(-300)));}catch(e){}
  if(typeof pushLists==="function")pushLists();
  return true;
}
function wantRemove(artist,title){
  var k=wantKey(artist,title);
  var list=wantList().filter(function(w){return wantKey(w.artist,w.title)!==k;});
  try{localStorage.setItem("wantlist",JSON.stringify(list));}catch(e){}
  if(typeof pushLists==="function")pushLists();
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
/* A note on a wanted record: which pressing to look for, what you were
   told about it, where you saw it. The list is a hunting list, and the
   reason you wrote something down is often the useful part. */
/* Marks a wanted record for watching. Watched records are always sent
   to the radar and always reported back, however many there are \u2014 the
   unwatched ones compete for ten places by how well they fit. Wanting
   something and wanting to be told the moment it is pressed are
   different levels of interest, and only you know which is which. */
function wantWatch(artist, title){
  var list = wantList(), k = wantKey(artist, title), now = null;
  list.forEach(function(e){
    if (wantKey(e.artist, e.title) === k){ e.watch = !e.watch; now = e.watch; }
  });
  try { localStorage.setItem("wantlist", JSON.stringify(list)); } catch (e) {}
  if (typeof pushLists === "function") pushLists();
  return now;
}

function wantNote(artist, title, text){
  var list = wantList(), k = wantKey(artist, title), hit = false;
  list.forEach(function(e){
    if (wantKey(e.artist, e.title) === k){ e.note = text; hit = true; }
  });
  if (!hit) return false;
  try { localStorage.setItem("wantlist", JSON.stringify(list)); } catch (e) {}
  if (typeof pushLists === "function") pushLists();
  return true;
}

function renderWantView(){
  var el=document.getElementById("wantbody"),list=wantList();
  document.getElementById("wantcount").textContent=
    (function(){
      var open = list.filter(function(e){ return !e.got; }).length;
      return open ? open + (open === 1 ? " record" : " records") : "";
    })();
  if(!list.length){
    el.innerHTML="<p class='hint'>Nothing saved yet. Add records from Discover or "+
      "from the chat and they'll collect here.</p>";
    return;
  }
  /* Arrived records sit at the bottom, dimmed, rather than mixed in \u2014
     the list is for what you're still hunting. */
  var got = list.filter(function(e){ return e.got; });
  var want = list.filter(function(e){ return !e.got; });

  el.innerHTML =
    (want.length
      ? want.slice().reverse().map(function(r){
          /* The card, plus a note you can write on it. */
          return recCardHTML(r) +
            "<div class='wantnote' data-a=\"" + esc(r.artist || "") +
              "\" data-t=\"" + esc(r.title || "") + "\">" +
              (r.note
                ? "<p class='wantnotetext'>" + esc(r.note) + "</p>" +
                  "<button class='wantnotebtn'>Edit note</button>"
                : "<button class='wantnotebtn'>Add a note</button>") +
              "<button class='wantwatchbtn" + (r.watch ? " on" : "") + "'>" +
                (r.watch ? "\u2713 Watching for a pressing" : "Watch for a pressing") +
              "</button>" +
            "</div>";
        }).join("")
      : "<p class='hint'>Nothing left on the hunt \u2014 everything here has arrived.</p>") +
    (got.length
      ? "<div class='gotsec'><div class='ktitle'>Arrived \u2014 now on the shelf</div>" +
        got.slice().reverse().map(function(e){
          return "<div class='gotrow'>" + esc(e.artist || "") + " \u2014 " +
                 esc(e.title || "") + "</div>";
        }).join("") +
        "<div class='addrow' style='margin-top:10px'>" +
          "<button class='chip' id='wantclear'>Clear these " + got.length + "</button>" +
        "</div></div>"
      : "");

  fillRecArt(el);

  [].forEach.call(el.querySelectorAll(".wantnotebtn"), function(btn){
    btn.addEventListener("click", function(){
      var box = this.closest(".wantnote");
      var a = box.dataset.a, t = box.dataset.t;
      var cur = (wantList().filter(function(e){
        return wantKey(e.artist, e.title) === wantKey(a, t); })[0] || {}).note || "";
      box.innerHTML =
        "<textarea class='wantnotein' rows='2' placeholder='Which pressing, " +
          "where you saw it, what you were told\u2026'>" + esc(cur) + "</textarea>" +
        "<div class='addrow'><button class='chip wantnotesave'>Save</button>" +
        "<button class='chip wantnotecancel'>Cancel</button></div>";
      var ta = box.querySelector(".wantnotein");
      ta.focus();
      box.querySelector(".wantnotesave").addEventListener("click", function(){
        wantNote(a, t, ta.value.trim());
        renderWantView();
      });
      box.querySelector(".wantnotecancel").addEventListener("click", renderWantView);
    });
  });

  [].forEach.call(el.querySelectorAll(".wantwatchbtn"), function(btn){
    btn.addEventListener("click", function(){
      var box = this.closest(".wantnote");
      wantWatch(box.dataset.a, box.dataset.t);
      renderWantView();
    });
  });

  var cb = document.getElementById("wantclear");
  if (cb) cb.addEventListener("click", function(){ clearArrived(); renderWantView(); });
}

/* ---- closing the loop when you actually buy one --------------------
   The wantlist only ever grew. Nothing noticed when a record you wanted
   turned up in the collection, so over time it fills with things you
   already own \u2014 which makes it useless exactly when it should be most
   useful, standing in a shop.

   After the collection loads, anything on the list that now matches a
   record on the shelf is marked as arrived. It is not deleted silently:
   seeing "you got this" is the satisfying part, and a quiet deletion
   would look like data loss. */
function matchOwned(entry){
  var a = norm(entry.artist || ""), t = norm(entry.title || "");
  if (!a && !t) return null;
  for (var i = 0; i < RECS.length; i++){
    if (norm(RECS[i].a) === a && norm(RECS[i].t) === t) return RECS[i];
  }
  return null;
}

function reconcileWantlist(){
  var list = wantList();
  if (!list.length) return 0;
  var changed = 0;
  list.forEach(function(e){
    if (e.got) return;                       /* already known to have arrived */
    if (matchOwned(e)){ e.got = Date.now(); changed++; }
  });
  if (changed){
    try { localStorage.setItem("wantlist", JSON.stringify(list)); } catch (e) {}
  }
  return changed;
}

/* Clears everything already marked as arrived. Explicit, because the
   list is the only record that you once wanted these. */
function clearArrived(){
  var list = wantList().filter(function(e){ return !e.got; });
  try { localStorage.setItem("wantlist", JSON.stringify(list)); } catch (e) {}
  return list.length;
}

if (typeof onDataReady === "function") onDataReady(reconcileWantlist);


/* ---- the same wantlist on every device ----------------------------
   The wantlist and the listened marks lived only in the browser that
   made them, so a record saved on the phone was invisible on the laptop
   — and the wantlist is exactly the thing you want in your pocket in a
   shop and on the laptop when browsing.

   They now go through the sheet's Config tab, the same way the Discogs
   token does. Merging rather than replacing, so nothing is lost when two
   devices have both added things since the last sync. */
var LISTS_KEY = "device_lists_shared";
var listsSyncing = false;

function localLists(){
  var out = {};
  ["wantlist", "discseen2"].forEach(function(k){
    try { out[k] = JSON.parse(localStorage.getItem(k) || "[]"); } catch (e) { out[k] = []; }
  });
  return out;
}

function mergeById(mine, theirs, idOf){
  var seen = {}, out = [];
  mine.concat(theirs || []).forEach(function(e){
    var id = idOf(e);
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push(e);
  });
  return out;
}

function syncLists(cb){
  if (listsSyncing){ if (cb) cb(); return; }
  listsSyncing = true;

  fetch("/api/sheet", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ action:"getConfig", key: LISTS_KEY })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var remote = {};
    try { remote = JSON.parse((d && d.value) || "{}") || {}; } catch (e) {}
    var mine = localLists();

    var merged = {
      wantlist: mergeById(mine.wantlist || [], remote.wantlist || [],
        function(e){ return (e.artist || "") + "|" + (e.title || ""); }),
      discseen2: mergeById(mine.discseen2 || [], remote.discseen2 || [],
        function(e){ return e && e.k; })
    };

    try {
      localStorage.setItem("wantlist", JSON.stringify(merged.wantlist));
      localStorage.setItem("discseen2", JSON.stringify(merged.discseen2));
    } catch (e) {}

    /* Write back only if this device actually adds something, so a
       read-only device never rewrites the shared copy. */
    var grew = (merged.wantlist.length !== (remote.wantlist || []).length) ||
               (merged.discseen2.length !== (remote.discseen2 || []).length);
    if (grew && typeof sheetWrite === "function" && isOwner()){
      sheetWrite("setConfig", { key: LISTS_KEY, value: JSON.stringify(merged) },
                 function(){});
    }

    listsSyncing = false;
    if (typeof renderWantView === "function" &&
        document.getElementById("wantbody")) renderWantView();
    if (cb) cb();
  })
  .catch(function(){ listsSyncing = false; if (cb) cb(); });
}

/* Push after any change, so the other device sees it next time it looks. */
function pushLists(){
  if (!isOwner() || typeof sheetWrite !== "function") return;
  var mine = localLists();
  sheetWrite("setConfig", { key: LISTS_KEY, value: JSON.stringify(mine) }, function(){});
}

if (typeof onDataReady === "function"){
  onDataReady(function(){ setTimeout(function(){ syncLists(); }, 6000); });
}

/* ---- adding one by hand -------------------------------------------
   Records reached the wantlist only from Discover or the chat, which
   missed the obvious case: reading about something, or standing in a
   shop, and wanting to note it down.

   It searches Discogs rather than taking free text, so the entry carries
   a release id and cover art \u2014 which is what lets the radar recognise it
   later and the arrival check spot it when you buy it. */
function wantSearch(){
  var q = (document.getElementById("wantq").value || "").trim();
  var out = document.getElementById("wantresults");
  if (!q){ out.innerHTML = ""; return; }

  out.innerHTML = "<p class='hint'>Searching Discogs\u2026</p>";
  /* POST with a JSON body \u2014 the endpoint reads req.body, so the GET with
     query parameters I first wrote never reached the search at all. */
  fetch("/api/discogs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    /* Masters, so one album appears once rather than as fifteen
       pressings you then have to choose between. */
    body: JSON.stringify({ action: "search", q: q, type: "master" })
  })
    .then(function(r){
      return r.text().then(function(t){
        var d = null; try { d = JSON.parse(t); } catch (e) {}
        return { ok: r.ok, status: r.status, d: d, raw: t };
      });
    })
    .then(function(x){
      if (!x.d){
        out.innerHTML = "<p class='hint'>The search endpoint returned " + x.status +
          " and not JSON \u2014 api/discogs.js may not be deployed.</p>";
        return;
      }
      if (!x.ok){
        out.innerHTML = "<p class='hint'>Discogs said: " +
          esc((x.d.detail || x.d.error || "something went wrong")) + "</p>";
        return;
      }
      var hits = x.d.results || [];
      if (!hits.length){
        out.innerHTML = "<p class='hint'>Nothing found. Try the artist and " +
          "album separately, or a different spelling.</p>";
        return;
      }
      out.innerHTML = hits.slice(0, 6).map(function(h, i){
        /* Discogs returns one "Artist - Title" string. */
        var parts = String(h.title || "").split(" - ");
        var artist = parts[0] || "";
        var title = parts.slice(1).join(" - ") || h.title || "";
        return "<div class='wantfound' data-i='" + i + "'" +
          " data-artist=\"" + esc(artist) + "\" data-title=\"" + esc(title) + "\"" +
          " data-id='" + esc(String(h.id || "")) + "'" +
          " data-cover=\"" + esc(h.thumb || "") + "\">" +
          (h.thumb ? "<img src='" + esc(h.thumb) + "' alt='' loading='lazy'>"
                   : "<span class='wantnoart'></span>") +
          "<span class='wantinfo'><b>" + esc(artist) + "</b>" +
          "<span>" + esc(title) +
            (h.year ? " \u00b7 " + esc(String(h.year)) : "") +
            (h.label ? " \u00b7 " + esc(h.label) : "") + "</span></span>" +
          "<span class='wantpick'>" +
            (wantHas(artist, title) ? "On the list" : "Add") + "</span>" +
        "</div>";
      }).join("");

      [].forEach.call(out.querySelectorAll(".wantfound"), function(row){
        row.addEventListener("click", function(){
          var a = this.dataset.artist, t = this.dataset.title;
          if (wantHas(a, t)) return;
          wantAdd({ artist: a, title: t,
                    id: this.dataset.id || null,
                    cover: this.dataset.cover || null });
          this.querySelector(".wantpick").textContent = "On the list";
          renderWantView();
          /* Entries from Discover and the chat carry a description; one
             added here had none, so the same list showed two visibly
             different kinds of entry. Fetched after saving, so the
             record appears at once and fills in when the text arrives. */
          describeWanted(a, t);
        });
      });
    })
    .catch(function(){
      out.innerHTML = "<p class='hint'>Couldn't reach Discogs just now.</p>";
    });
}

/* Fills in what a manually added record sounds like, where it fits, and
   which pressing to hunt for \u2014 the same fields the chat provides. */
function describeWanted(artist, title){
  if (typeof aiFetchUser !== "function") return;
  var box = document.querySelector(".wantnote[data-a=\"" + artist + "\"]");
  aiFetchUser(API_BASE + "recommend", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "one", artist: artist, title: title,
      records: (typeof collectionPayload === "function") ? collectionPayload() : [],
      categories: (typeof COLORS !== "undefined") ? Object.keys(COLORS) : []
    })
  })
  .then(function(r){ return r.ok ? r.json() : null; })
  .then(function(d){
    if (!d) return;
    var list = wantList(), k = wantKey(artist, title), hit = false;
    list.forEach(function(e){
      if (wantKey(e.artist, e.title) !== k) return;
      hit = true;
      ["year","genre","sounds","fits","why","pressing","pressing_why"].forEach(function(f){
        if (d[f] && !e[f]) e[f] = d[f];
      });
    });
    if (!hit) return;
    try { localStorage.setItem("wantlist", JSON.stringify(list)); } catch (e) {}
    if (typeof pushLists === "function") pushLists();
    renderWantView();
  })
  .catch(function(){ /* the entry is saved either way */ });
}

(function(){
  var link = document.getElementById("wantaddlink");
  if (!link) return;
  link.addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("wantaddbox");
    box.classList.toggle("show");
    if (box.classList.contains("show")) document.getElementById("wantq").focus();
  });
  document.getElementById("wantsearch").addEventListener("click", wantSearch);
  var close = document.getElementById("wantaddclose");
  if (close) close.addEventListener("click", function(){
    document.getElementById("wantaddbox").classList.remove("show");
    document.getElementById("wantq").value = "";
    document.getElementById("wantresults").innerHTML = "";
  });
  document.getElementById("wantq").addEventListener("keydown", function(e){
    if (e.key === "Enter"){ e.preventDefault(); wantSearch(); }
  });
})();
