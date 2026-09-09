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
  return wantList()
    .filter(function(e){ return e && !e.got && (e.artist || e.title); })
    .slice(-40)
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
  if (typeof sheetWrite === "function" && typeof isOwner === "function" && isOwner()){
    sheetWrite("setConfig", { key: "radar_shared", value: JSON.stringify(payload) },
               function(){});
  }
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
  /* Grouped by the collector's own categories, best-scoring first
     within each: a flat list of ten mixed releases is harder to scan
     than four short ones under headings you already think in. */
  var groups = {};
  items.forEach(function(r){
    var k = (r.category && String(r.category).trim()) || "Other";
    (groups[k] = groups[k] || []).push(r);
  });
  var order = Object.keys(groups).sort(function(a, b){
    var ba = Math.max.apply(null, groups[a].map(function(x){ return +x.score || 0; }));
    var bb = Math.max.apply(null, groups[b].map(function(x){ return +x.score || 0; }));
    return bb - ba;
  });

  el.innerHTML =
    (c && c.at ? "<p class='hint'>Checked " + esc(agoText(c.at)) + ". " +
      "Dates are as announced \u2014 worth confirming before counting on one.</p>" : "") +
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

  if (typeof fillRecArt === "function") fillRecArt(el);
}

function agoText(ts){
  var d = Math.round((Date.now() - ts) / 86400000);
  return d < 1 ? "today" : d === 1 ? "yesterday" : d + " days ago";
}

function loadRadar(force){
  var el = document.getElementById("radarbody");
  if (!el) return;

  var c = radarCache();
  if (!force && c && Date.now() - c.at < RADAR_EVERY_MS){
    renderRadar(c.items);
    return;
  }
  /* Before searching, see whether another device already did it. */
  if (!force && !radarCheckedShared){
    radarCheckedShared = true;
    sharedRadar(function(p){
      if (p && p.items && Date.now() - p.at < RADAR_EVERY_MS){
        try { localStorage.setItem("radar", JSON.stringify(p)); } catch (e) {}
        renderRadar(p.items);
      } else {
        loadRadar(force);
      }
    });
    return;
  }
  if (!RECS.length){
    renderRadar(null, "Nothing on the shelf yet \u2014 the radar works from what you collect.");
    return;
  }

  el.innerHTML = "<p class='hint'>Searching for upcoming pressings\u2026 " +
    "this one takes a few seconds.</p>";

  fetch("/api/radar", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      artists: radarArtists(),
      /* The wantlist is the most direct statement of intent there is \u2014
         records you've decided you want but don't own. A new pressing of
         one of those matters more than a good guess from the shelf. */
      /* The wantlist is a stronger signal than the shelf: it is what you
         have decided you want but don't have. A reissue of something on
         it is the single most useful thing the radar can surface. */
      wanted: wantedForRadar(),
      categories: (typeof COLORS !== "undefined") ? Object.keys(COLORS) : [],
      weeks: 8,
      /* don't re-suggest what was already shown */
      avoid: (c && c.items ? c.items.map(function(i){ return i.artist + " \u2014 " + i.title; }) : [])
    })
  })
  .then(function(r){
    return r.text().then(function(t){
      var d = null; try { d = JSON.parse(t); } catch (e) {}
      return { ok: r.ok, status: r.status, d: d, raw: t };
    });
  })
  .then(function(x){
    if (!x.d){
      renderRadar(null, "The radar endpoint returned " + x.status +
        " and not JSON \u2014 api/radar.js may not be deployed.");
      return;
    }
    if (!x.ok){
      /* A 429 here is a per-minute ceiling, not an exhausted day: the
         capable models allow as few as five requests a minute. Making
         someone press the button again in twenty seconds is a poor way
         to spend their attention, so it waits and retries itself. */
      if (x.status === 429 && x.d.retryAfter && (radarRetries || 0) < 3){
        radarRetries = (radarRetries || 0) + 1;
        var secs = Math.max(5, Math.min(90, x.d.retryAfter + 3));
        countdown(secs, function(left){
          renderRadar(null, "Discogs\u2019 search model is busy \u2014 retrying in " +
            left + "s. (Its limit is a few requests a minute.)");
        }, function(){ loadRadar(force); });
        return;
      }
      radarRetries = 0;
      renderRadar(null,
        esc(x.d.error || "The search failed.") +
        (x.d.attempted ? "<br><span style='opacity:.7'>Tried: " +
          esc(x.d.attempted.join(", ")) + "</span>" : "") +
        (x.d.note ? "<br><span style='opacity:.8'>" + esc(x.d.note) + "</span>" : "") +
        (x.d.detail && !x.d.note ? "<br>" + esc(String(x.d.detail).slice(0,140)) : ""));
      return;
    }
    radarRetries = 0;
    var items = x.d.items || [];
    saveRadar(items);
    renderRadar(items);
  })
  .catch(function(err){
    renderRadar(null, "Couldn't reach the radar: " + esc(String(err && err.message || err)));
  });
}

(function(){
  var link = document.getElementById("radarrefresh");
  if (link) link.addEventListener("click", function(e){ e.preventDefault(); loadRadar(true); });
})();
