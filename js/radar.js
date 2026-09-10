/* =================== release radar ==================================
   What's coming out that this collection suggests an interest in.

   Narrowing is the whole point: a feed of everything being pressed is
   noise. The endpoint gets the artists you actually collect \u2014 weighted
   so the ones you own several of come first \u2014 rather than the whole
   shelf, and is told to prefer reissues of those.

   Cached for a week on the device. Grounded search is the most
   quota-expensive thing in the app and the answer barely moves day to
   day, so there's nothing to gain from checking more often. */

var RADAR_EVERY_MS = 7 * 24 * 3600 * 1000;
var radarRetries = 0;
var radarCheckedShared = false;
var radarTab = "new";

/* Anything not clearly a reissue counts as new. The model returns
   "new album", "album", "anniversary edition", "repress" and variants,
   so an unfamiliar word must not make an entry vanish from both tabs. */
function isReissue(r){
  return /reissu|repress|anniversar|remaster/i.test(String(r.kind || ""));
}

/* Counts down out loud, so a wait looks like a wait rather than a
   stall, then runs the next thing. */
function countdown(secs, tick, done){
  tick(secs);
  var t = setInterval(function(){
    secs--;
    if (secs <= 0){ clearInterval(t); done(); return; }
    tick(secs);
  }, 1000);
}

/* Artists you own more than one of, most first, then the singles. Two
   records by someone is the clearest signal in the collection that a
   third would be welcome. */
function radarArtists(){
  var count = {};
  RECS.forEach(function(r){
    var a = (r.a || "").trim();
    if (a) count[a] = (count[a] || 0) + 1;
  });
  return Object.keys(count).sort(function(x, y){
    if (count[y] !== count[x]) return count[y] - count[x];
    return x.localeCompare(y);
  }).slice(0, 60);
}

/* Held in the sheet rather than the browser, so every device shows the
   same list. Two devices each doing their own weekly search produced two
   different radars and spent the search allowance twice. A local copy is
   kept as well, purely so the tab can draw something immediately while
   the shared one loads. */
/* Records saved to the wantlist but not yet acquired. Anything already
   marked as arrived is dropped \u2014 it is on the shelf now, and the
   collection list already covers it. */
function wantedForRadar(){
  if (typeof wantList !== "function") return [];
  var open = wantList().filter(function(e){ return e && !e.got && (e.artist || e.title); });
  /* Watched records first and without limit; the rest fill what is left
     of a reasonable prompt. */
  var watched = open.filter(function(e){ return e.watch; });
  var rest = open.filter(function(e){ return !e.watch; }).slice(-30);
  return watched.concat(rest)
    /* Plain strings: the prompt reads these as a list, and objects
       arrived as "[object Object]". */
    .map(function(e){
      return (e.artist || "") + " \u2014 " + (e.title || "");
    });
}

function radarCache(){
  try { return JSON.parse(localStorage.getItem("radar") || "null"); }
  catch (e) { return null; }
}
function saveRadar(items){
  var payload = { at: Date.now(), items: items };
  try { localStorage.setItem("radar", JSON.stringify(payload)); } catch (e) {}
  if (typeof shareResult === "function") shareResult("radar", payload);
}

/* The shared copy, if it is newer than this device's. */
function sharedRadar(cb){
  fetch("/api/sheet", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ action:"getConfig", key:"radar_shared" })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    var p = null;
    try { p = JSON.parse((d && d.value) || "null"); } catch (e) {}
    cb(p);
  })
  .catch(function(){ cb(null); });
}

function renderRadar(items, note){
  var el = document.getElementById("radarbody");
  if (!el) return;
  if (note && !items){ el.innerHTML = "<p class='hint'>" + note + "</p>"; return; }

  if (!items || !items.length){
    el.innerHTML = "<p class='hint'>Nothing found for the next couple of months. " +
      "That's a real answer rather than an error \u2014 there often isn't anything " +
      "announced that fits a particular collection.</p>";
    return;
  }

  var c = radarCache();

  /* Two tabs: what is coming out, and what is being pressed again. They
     answer different questions, and mixed together the handful of new
     albums disappeared among the reissues. */
  /* Wantlist matches are their own tab: you asked for those specifically,
     so they should not have to be found among twenty other releases. */
  /* Also deduplicated here, so a list cached before this fix still
     renders correctly rather than needing a fresh search. */
  var uniq = [], marks = {};
  items.forEach(function(r){
    var k = norm(r.artist || "") + "|" + norm(r.title || "");
    if (marks[k]) return;
    marks[k] = true;
    uniq.push(r);
  });
  items = uniq;

  var want = items.filter(function(r){ return r.wantlist; });
  var rest = items.filter(function(r){ return !r.wantlist; });
  var fresh = rest.filter(function(r){ return !isReissue(r); });
  var again = rest.filter(isReissue);
  var show = radarTab === "old" ? again : radarTab === "want" ? want : fresh;

  /* Grouped by the collector's own categories, best-scoring first
     within each: a flat list of ten mixed releases is harder to scan
     than four short ones under headings you already think in. */
  var groups = {};
  show.forEach(function(r){
    var k = (r.category && String(r.category).trim()) || "Other";
    (groups[k] = groups[k] || []).push(r);
  });
  var order = Object.keys(groups).sort(function(a, b){
    var ba = Math.max.apply(null, groups[a].map(function(x){ return +x.score || 0; }));
    var bb = Math.max.apply(null, groups[b].map(function(x){ return +x.score || 0; }));
    return bb - ba;
  });

  el.innerHTML =
    "<div class='radartabs'>" +
      "<button class='radartab" + (radarTab === "new" ? " on" : "") + "' data-t='new'>" +
        "New albums <span>" + fresh.length + "</span></button>" +
      "<button class='radartab" + (radarTab === "old" ? " on" : "") + "' data-t='old'>" +
        "Reissues <span>" + again.length + "</span></button>" +
      "<button class='radartab" + (radarTab === "want" ? " on" : "") + "' data-t='want'>" +
        "Wantlist <span>" + want.length + "</span></button>" +
    "</div>" +
    (c && c.at ? "<p class='hint'>Checked " + esc(agoText(c.at)) + ". " +
      "Dates are as announced \u2014 worth confirming before counting on one.</p>" : "") +
    (!show.length
      ? "<p class='hint'>" + (radarTab === "new"
          ? "Nothing new announced that fits \u2014 try the other tabs."
          : radarTab === "want"
            ? "Nothing announced for anything on your wantlist. Mark records " +
              "with <b>Watch for a pressing</b> and they'll be checked every time."
            : "No reissues found this time \u2014 try the other tabs.") + "</p>"
      : "") +
    order.map(function(cat){
      var list = groups[cat].sort(function(x, y){ return (+y.score || 0) - (+x.score || 0); });
      return "<div class='radargrp'>" +
        "<div class='radarcat'>" +
          "<span class='cmdot' style='background:" +
            ((typeof COLORS !== "undefined" && COLORS[cat]) || "#7E7973") + "'></span>" +
          esc(cat) + "</div>" +
        list.map(function(r){
          var q = encodeURIComponent((r.artist || "") + " " + (r.title || ""));
          var sc = (+r.score || 0);
          return "<div class='rec'>" +
            "<div class='rtop'><span class='rart' data-a=\"" + esc(r.artist || "") +
              "\" data-t=\"" + esc(r.title || "") + "\"></span>" +
            "<span class='rinfo'>" +
              "<span class='ra'>" + esc(r.artist || "") + "</span>" +
              "<div class='rt'>" + esc(r.title || "") + "</div>" +
              "<div class='rmeta'>" + esc([r.kind, r.when].filter(Boolean).join(" \u00b7 ")) + "</div>" +
            "</span>" +
            (sc ? "<span class='radarscore'>" + sc.toFixed(1) + "</span>" : "") +
            "</div>" +
            /* What the album IS, then why it suits them — two different
               questions, and the first is the one a stranger to the
               record needs answered. */
            (r.about ? "<p class='rsounds'>" + esc(r.about) + "</p>" : "") +
            (r.why ? "<p class='rwhy'>" + esc(r.why) + "</p>" : "") +
            /* No Discogs link: these are unreleased, so the search
               would return nothing or, worse, an older pressing that
               looks like the thing being announced. The source is the
               useful link \u2014 it is where the date came from. */
            (r.source
              ? "<div class='rlinks'><span class='radarsrc'>via " +
                esc(r.source) + "</span></div>"
              : "") +
          "</div>";
        }).join("") +
      "</div>";
    }).join("");

  [].forEach.call(el.querySelectorAll(".radartab"), function(b){
    b.addEventListener("click", function(){
      radarTab = this.dataset.t;
      renderRadar(items);
    });
  });

  if (typeof fillRecArt === "function") fillRecArt(el);
}

function agoText(ts){
  var d = Math.round((Date.now() - ts) / 86400000);
  return d < 1 ? "today" : d === 1 ? "yesterday" : d + " days ago";
}

function loadRadar(force, skipShared){
  var el = document.getElementById("radarbody");
  if (!el) return;

  var c = radarCache();
  /* Draw the local copy at once so the tab isn't blank, then check the
     shared one \u2014 previously the shared copy was only consulted when a
     device had NOTHING cached, so two devices that had each searched
     kept showing their own results forever. */
  if (!force && c && Date.now() - c.at < RADAR_EVERY_MS){
    renderRadar(c.items);
    {
      sharedRadar(function(p){
        if (p && p.items && p.at > c.at){
          try { localStorage.setItem("radar", JSON.stringify(p)); } catch (e) {}
          renderRadar(p.items);
        }
      });
    }
    return;
  }
  /* Nothing cached here: ask the sheet before searching. The guard is
     per call rather than per session \u2014 a session-long flag meant a
     device that checked once, before the sheet was reachable, never
     looked again, which is why two devices could stay out of step all
     day. */
  if (!force && !skipShared){
    sharedRadar(function(p){
      if (p && p.items && Date.now() - p.at < RADAR_EVERY_MS){
        try { localStorage.setItem("radar", JSON.stringify(p)); } catch (e) {}
        renderRadar(p.items);
      } else {
        loadRadar(force, true);      /* checked; go and search */
      }
    });
    return;
  }
  if (!RECS.length){
    renderRadar(null, "Nothing on the shelf yet \u2014 the radar works from what you collect.");
    return;
  }

  el.innerHTML = "<p class='hint'>Searching for upcoming pressings\u2026 " +
    "this takes a minute, in three passes.</p>";

  /* Three separate searches rather than one doing three jobs. Each gets
     a whole request to itself, which is what it takes to come back with
     ten rather than three. They run in turn with a pause, because the
     capable models allow only a few requests a minute. */
  var passes = ["new", "reissue", "wantlist"];
  var collected = [];
  var failures = [];
  var seen = {};

  function runPass(i){
    if (i >= passes.length){
      if (!collected.length){
        renderRadar(null, failures[0] || "Nothing found this time.");
        return;
      }
      saveRadar(collected);
      renderRadar(collected);
      return;
    }
    var p = passes[i];
    el.innerHTML = "<p class='hint'>Searching\u2026 " +
      (p === "new" ? "new albums" : p === "reissue" ? "reissues" : "your wantlist") +
      " (" + (i + 1) + " of 3)" +
      (collected.length ? " \u2014 " + collected.length + " found so far" : "") +
      "</p>";

    fetch("/api/radar", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pass: p,
        artists: radarArtists(),
        wanted: wantedForRadar(),
        watched: (typeof wantList === "function"
          ? wantList().filter(function(e){ return e && !e.got && e.watch; })
              .map(function(e){ return (e.artist || "") + " \u2014 " + (e.title || ""); })
          : []),
        weeks: 8,
        force: true,
        avoid: collected.map(function(x){ return x.artist + " \u2014 " + x.title; })
      })
    })
    .then(function(r){
      return r.text().then(function(t){
        var d = null; try { d = JSON.parse(t); } catch (e) {}
        return { ok: r.ok, status: r.status, d: d };
      });
    })
    .then(function(x){
      if (x.ok && x.d && x.d.items){
        x.d.items.forEach(function(it){
          if (p === "wantlist") it.wantlist = true;
          /* Three searches can each turn up the same record, and a
             watched one is especially likely to appear twice. Keep the
             first, since the passes run in priority order. */
          var k = norm(it.artist || "") + "|" + norm(it.title || "");
          if (!k.replace("|", "")) return;
          if (seen[k]){
            /* Keeping the first copy dropped the wantlist flag when an
               earlier pass had already found the record \u2014 so a watched
               album that IS being reissued vanished from the wantlist
               tab, which is the one place you wanted it. Merge instead
               of discarding. */
            if (it.wantlist) seen[k].wantlist = true;
            if (it.why && it.wantlist) seen[k].why = it.why;
            if (!seen[k].about && it.about) seen[k].about = it.about;
            return;
          }
          seen[k] = it;
          collected.push(it);
        });
      } else if (x.d){
        failures.push(esc(x.d.error || "A search failed.") +
          (x.d.note ? "<br><span style='opacity:.8'>" + esc(x.d.note) + "</span>" : ""));
      }
      /* A pause between passes: the models that can search allow only a
         few requests a minute. */
      setTimeout(function(){ runPass(i + 1); }, 14000);
    })
    .catch(function(){
      setTimeout(function(){ runPass(i + 1); }, 14000);
    });
  }

  runPass(0);
}

(function(){
  var link = document.getElementById("radarrefresh");
  if (link) link.addEventListener("click", function(e){ e.preventDefault(); loadRadar(true); });
})();


if (typeof onShared === "function"){
  onShared("radar", function(p){
    if (!p || !p.items) return;
    try { localStorage.setItem("radar", JSON.stringify(p)); } catch (e) {}
    if (!document.getElementById("view-radar").hidden) renderRadar(p.items);
  });
}
