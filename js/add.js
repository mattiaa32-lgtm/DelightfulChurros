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
    "<p class='hint'>Filed under \u201c" + esc(artistSortKey(a).split(" ")[0]) + "\u201d. " +
      "Paste this row into your sheet, then re-open the app:</p>" +
    "<textarea id='addrow' readonly rows='2'>" +
      esc([a, t, c, p.cube, (document.getElementById("adddiscogs").value || "").trim()].join("\t")) +
    "</textarea>";
}

(function(){
  var link = document.getElementById("addlink");
  if (!link) return;

  link.addEventListener("click", function(e){
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
  });

  /* Straight to a Discogs search for whatever has been typed, so the
     release (and its id) can be found without leaving the flow. */
  document.getElementById("adddiscogs-search").addEventListener("click", function(e){
    e.preventDefault();
    var a = (document.getElementById("addartist").value || "").trim();
    var t = (document.getElementById("addtitle").value || "").trim();
    var q = encodeURIComponent((a + " " + t).trim());
    window.open("https://www.discogs.com/search/?q=" + q + "&type=release", "_blank", "noopener");
  });

  ["addartist", "addtitle", "adddiscogs"].forEach(function(id){
    document.getElementById(id).addEventListener("input", renderPlacement);
  });
  document.getElementById("addcat").addEventListener("change", renderPlacement);
})();
