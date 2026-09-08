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

function radarCache(){
  try { return JSON.parse(localStorage.getItem("radar") || "null"); }
  catch (e) { return null; }
}
function saveRadar(items){
  try { localStorage.setItem("radar", JSON.stringify({ at: Date.now(), items: items })); }
  catch (e) {}
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
  el.innerHTML =
    (c && c.at ? "<p class='hint'>Checked " + esc(agoText(c.at)) + ". " +
      "Dates are as announced \u2014 worth confirming before counting on one.</p>" : "") +
    items.map(function(r){
      var q = encodeURIComponent((r.artist || "") + " " + (r.title || ""));
      return "<div class='rec'>" +
        "<div class='rtop'><span class='rart' data-a=\"" + esc(r.artist || "") +
          "\" data-t=\"" + esc(r.title || "") + "\"></span>" +
        "<span class='rinfo'>" +
          "<span class='ra'>" + esc(r.artist || "") + "</span>" +
          "<div class='rt'>" + esc(r.title || "") + "</div>" +
          "<div class='rmeta'>" + esc([r.kind, r.when].filter(Boolean).join(" \u00b7 ")) + "</div>" +
        "</span></div>" +
        (r.why ? "<p class='rwhy'>" + esc(r.why) + "</p>" : "") +
        "<div class='rlinks'>" +
          (typeof svcIcon === "function"
            ? "<a href='https://www.discogs.com/search/?q=" + q + "&type=release' " +
              "target='_blank' rel='noopener'>" + svcIcon("discogs", true) + "Discogs</a>" : "") +
          (r.source ? "<span class='radarsrc'>via " + esc(r.source) + "</span>" : "") +
        "</div>" +
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
