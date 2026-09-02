/* =================== adding a record ================================
   Two halves. First, a jump to Discogs so the release can be found and
   its id copied. Second \u2014 the useful part \u2014 working out where the
   record actually belongs on the shelf.

   The collection is sorted: category, then artist, then title, with
   leading articles ignored on both. A person's name files under their
   surname; a band files under its first word. Nothing here reorders the
   shelf on its own; it tells you where the record goes and what it sits
   between, and gives you the row to paste into the sheet. */

/* Same labels the position filter chips use. */
var CUBE_NAMES={1:"Top left",2:"Top right",3:"Bottom left",4:"Bottom right"};

var ARTICLES = /^(the|a|an|los|las|les|le|la|el|die|der|das|het|de)\s+/i;

function sortName(s){
  return norm(String(s || "").replace(ARTICLES, "")).trim();
}

/* Filing convention.

   An earlier version guessed that any two-word name was a person and
   filed it under the second word. That is wrong far more often than it
   is right: King Crimson, Pink Floyd, Black Sabbath and Deep Purple are
   all bands, and all would have been misfiled under Crimson, Floyd,
   Sabbath and Purple.

   So the default is the band convention \u2014 file under the name as
   written, minus any leading article. To file a person under their
   surname, write them in the sheet the way a library would: "Davis,
   Miles". That is explicit, needs no guessing, and is already how a
   couple of entries in the collection are written. */
function artistSortKey(a){
  var raw = String(a || "").trim();
  var m = /^(.*),\s*(.+)$/.exec(raw);
  if (m) {
    /* "Davis, Miles" files under Davis; "Chemical Brothers, The" is the
       article convention and files under Chemical Brothers. */
    if (ARTICLES.test(m[2] + " ")) return sortName(m[1]);
    return norm(sortName(m[1]) + " " + sortName(m[2]));
  }
  return sortName(raw);
}

function recordSortKey(r){
  return artistSortKey(r.a) + "|" + sortName(r.t);
}

/* Where would this record sit? Returns the cube, the index within it,
   and the records either side. */
function placeRecord(artist, title, category){
  var inCat = RECS.filter(function(r){ return r.c === category; });
  if (!inCat.length) {
    return { cube: null, before: null, after: null, count: 0, unknownCategory: true };
  }
  var key = artistSortKey(artist) + "|" + sortName(title);
  var sorted = inCat.slice().sort(function(x, y){
    return recordSortKey(x).localeCompare(recordSortKey(y));
  });
  var at = 0;
  while (at < sorted.length && recordSortKey(sorted[at]).localeCompare(key) < 0) at++;
  var anchor = sorted[Math.min(at, sorted.length - 1)];
  return {
    cube: anchor.k,
    cubeName: CUBE_NAMES[anchor.k] || ("cube " + anchor.k),
    position: at + 1,
    count: sorted.length,
    before: at > 0 ? sorted[at - 1] : null,
    after: at < sorted.length ? sorted[at] : null
  };
}

function renderPlacement(){
  var a = (document.getElementById("addartist").value || "").trim();
  var t = (document.getElementById("addtitle").value || "").trim();
  var c = document.getElementById("addcat").value;
  var el = document.getElementById("placement");
  if (!a || !t) { el.innerHTML = ""; return; }

  var p = placeRecord(a, t, c);
  if (p.unknownCategory) {
    el.innerHTML = "<p class='hint'>Nothing in that category yet, so this would start it.</p>";
    return;
  }
  el.innerHTML =
    "<div class='placewhere'>Goes in <b>" + esc(p.cubeName) + "</b>, " +
      "position " + p.position + " of " + (p.count + 1) + " in " + esc(c) + "</div>" +
    "<p class='placenb'>" +
      (p.before ? "After &nbsp;" + esc(p.before.a) + " \u2014 " + esc(p.before.t) + "<br>" : "At the start<br>") +
      (p.after ? "Before " + esc(p.after.a) + " \u2014 " + esc(p.after.t) : "At the end") +
    "</p>" +
    "<p class='hint'>Filed under \u201c" + esc(artistSortKey(a).split(" ")[0]) + "\u201d.</p>";
}

var pending = {};   /* the Discogs release currently chosen */

(function(){
  var link = document.getElementById("addlink");
  if (!link) return;

  function toggleAdd(e){
    e.preventDefault();
    var box = document.getElementById("addbox");
    box.classList.toggle("show");
    if (!box.classList.contains("show")) return;
    var sel = document.getElementById("addcat");
    if (!sel.options.length) {
      sel.innerHTML = Object.keys(COLORS).map(function(c){
        return "<option>" + esc(c) + "</option>";
      }).join("");
    }
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  link.addEventListener("click", toggleAdd);
  var top = document.getElementById("addtop");
  if (top) top.addEventListener("click", toggleAdd);

  /* Search Discogs from inside the app. Picking a result fills in the
     artist, title, id, cover and year, so the only thing left to decide
     is the category. */
  document.getElementById("adddiscogs-search").addEventListener("click", function(e){
    e.preventDefault();
    var a = (document.getElementById("addartist").value || "").trim();
    var t = (document.getElementById("addtitle").value || "").trim();
    var q = (a + " " + t).trim();
    if (!q) return;
    var out = document.getElementById("addresults");
    out.innerHTML = "<p class='hint'>Searching Discogs\u2026</p>";
    fetch("/api/discogs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search", q: q })
    })
    .then(function(r){
      /* A missing endpoint returns an HTML 404, which would blow up
         .json() and land in the catch as a vague network error. Read it
         as text first so the real cause can be reported. */
      return r.text().then(function(txt){
        var d = null;
        try { d = JSON.parse(txt); } catch (e) {}
        return { ok: r.ok, status: r.status, d: d, raw: txt };
      });
    })
    .then(function(x){
      if (!x.d) {
        out.innerHTML = "<p class='hint'>The Discogs endpoint returned " + x.status +
          " and not JSON \u2014 api/discogs.js is probably not deployed yet.</p>";
        return;
      }
      if (!x.ok || !x.d.results) {
        out.innerHTML = "<p class='hint'>" +
          esc(x.d.error || "Discogs request failed") +
          (x.d.detail ? " \u2014 " + esc(String(x.d.detail).slice(0, 120)) : "") +
          " (HTTP " + x.status + ")</p>";
        return;
      }
      if (!x.d.results.length) { out.innerHTML = "<p class='hint'>Nothing found.</p>"; return; }
      out.innerHTML = x.d.results.map(function(r){
        var meta = [r.year, r.country, r.format, r.label].filter(Boolean).join(" \u00b7 ");
        return "<button class='dgr' data-id='" + r.id + "' data-title=\"" + esc(r.title) + "\">" +
          (r.thumb ? "<img src='" + esc(r.thumb) + "' alt='' loading='lazy'>" : "<span class='dgr-ph'></span>") +
          "<span class='dgr-m'><span class='dgr-t'>" + esc(r.title) + "</span>" +
          "<span class='dgr-s'>" + esc(meta) + "</span></span></button>";
      }).join("");
    })
    .catch(function(err){
      out.innerHTML = "<p class='hint'>Network error reaching /api/discogs: " +
        esc(String(err && err.message || err)) + "</p>";
    });
  });

  /* Picking a release fills the form from Discogs' own data. */
  document.getElementById("addresults").addEventListener("click", function(e){
    var b = e.target.closest(".dgr");
    if (!b) return;
    var id = b.dataset.id;
    document.getElementById("addresults").innerHTML = "<p class='hint'>Fetching release\u2026</p>";
    fetch("/api/discogs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", id: id })
    })
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d && d.artist) document.getElementById("addartist").value = d.artist;
      if (d && d.title)  document.getElementById("addtitle").value = d.title;
      document.getElementById("adddiscogs").value = id;
      pending = d || {};
      document.getElementById("addresults").innerHTML =
        "<p class='hint'>Selected: " + esc((d.artist || "") + " \u2014 " + (d.title || "")) +
        (d.year ? " (" + esc(String(d.year)) + ")" : "") + "</p>";
      renderPlacement();
    })
    .catch(function(){
      document.getElementById("addresults").innerHTML =
        "<p class='hint'>Couldn't load that release.</p>";
    });
  });

  /* Write the row straight into the sheet \u2014 owner only. */
  document.getElementById("addsave").addEventListener("click", function(){
    var a = (document.getElementById("addartist").value || "").trim();
    var t = (document.getElementById("addtitle").value || "").trim();
    var c = document.getElementById("addcat").value;
    var id = (document.getElementById("adddiscogs").value || "").trim();
    var msg = document.getElementById("addmsg");
    if (!a || !t) { msg.textContent = "Artist and title are needed."; return; }
    var p = placeRecord(a, t, c);
    var cube = p.cube || 1;
    var row = [a, t, c, cube, id,
               pending.cover || "", "",              /* cover, description */
               pending.year || "", pending.year || ""]; /* first released, pressing */
    msg.textContent = "Saving\u2026";
    sheetWrite("appendRow", { row: row }, function(err){
      if (err) {
        if (err.message === "read-only") {
          msg.textContent = "Unlock editing first (the button in the header).";
          return;
        }
        msg.innerHTML = "Couldn't write to the sheet: " + esc(err.message) +
          (err.detail ? "<br><span class='hint' style='opacity:.75'>" +
            esc(String(err.detail).slice(0, 180)) + "</span>" : "") +
          (err.detail && /<html|sign in|accounts\.google/i.test(String(err.detail))
            ? "<br><span class='hint'>Google returned a web page instead of data \u2014 " +
              "usually the Apps Script deployment's <b>Who has access</b> is not set to " +
              "<b>Anyone</b>, or a new version hasn't been deployed since the code changed.</span>"
            : "");
        return;
      }

      /* Only reached once the sheet has actually confirmed the row.
         Discogs is the record of what you own, so it's updated too; a
         failure here is reported but not fatal, since the shelf itself
         is already correct. */
      if (id && document.getElementById("adddiscogs-sync").checked) {
        msg.textContent = "Added to the shelf, adding to Discogs\u2026";
        fetch("/api/discogs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "addToCollection", id: id, passphrase: ownerPass() })
        })
        .then(function(r){ return r.json().catch(function(){ return {}; }); })
        .then(function(d){
          msg.textContent = (d && d.ok)
            ? "Added to the shelf and your Discogs collection. Pull down to refresh."
            : "Added to the shelf. Discogs didn't accept it" +
              (d && d.error ? " (" + d.error + ")" : "") + " \u2014 add it there by hand.";
        })
        .catch(function(){
          msg.textContent = "Added to the shelf. Couldn't reach Discogs to add it there.";
        });
      } else {
        msg.textContent = "Added. Pull down to refresh and it'll appear on the shelf.";
      }
      ["addartist","addtitle","adddiscogs"].forEach(function(id2){
        document.getElementById(id2).value = "";
      });
      document.getElementById("addresults").innerHTML = "";
      document.getElementById("placement").innerHTML = "";
      pending = {};
    });
  });

  ["addartist", "addtitle", "adddiscogs"].forEach(function(id){
    document.getElementById(id).addEventListener("input", renderPlacement);
  });
  document.getElementById("addcat").addEventListener("change", renderPlacement);
})();
