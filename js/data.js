/* All serverless calls go through here — one place to change if the
   hosting platform ever moves again. On Vercel, files in /api are
   served at /api/<name>. */
var API_BASE="/api/";

/* -----------------------------------------------------------------
   Live data from a published Google Sheet: paste the CSV link below.
   Sheets > File > Share > Publish to web > pick the sheet > CSV.
   Columns: Artist | Record name | Category | Cube | Discogs id |
            Cover URL | Description | First released | Pressing year |
            Position
   The last three are optional and work the same way: the app fetches
   them itself (Cover URL from Discogs/iTunes; Description written by
   Gemini (free tier) via a small Vercel function \u2014 see api/describe.js)
   and caches the result on-device, so neither column is required \u2014
   they're there as a manual override, or as somewhere to paste the
   "Freeze resolved covers & descriptions" export once you're happy
   with what's been found, so every phone gets the same answer
   instantly instead of each one re-discovering it.
   Leave SHEET_CSV_URL empty to use the copy baked into this file.
----------------------------------------------------------------- */
var SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQUg2spQKZ0jlI9zOLeypO2OTbxaCu41RmvimMzP5BXhoViDdrKdhxjwBUz1MeYOtKYNZCONAz2f-LO/pub?gid=1433214942&single=true&output=csv";

var DB = {"recs":[],"colors":{"Classic rock, hard rock & blues":"#C86A4A","Metal & heavy":"#828C99","Funk, soul & R&B":"#C2953F","Prog & psychedelic":"#9A72B4","Pink Floyd":"#C06B70","Fusion, jazz-funk & global groove":"#A38468","Electronic & ambient":"#5289B5","Pop, soft rock & singer-songwriter":"#BC6C97","Reggae & dub":"#5FA277","Jazz":"#9BAA57","Indie, post-punk & alternative":"#7580BE","Hip-hop":"#4A9B95"}};
var RECS = DB.recs, COLORS = DB.colors;
var cubeFilter = 0;
var catFilter = "";
var CUBE_NAMES = ["Top left","Top right","Bottom left","Bottom right"];

function norm(s){return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/^(the|a|an)\s+/,"").replace(/[^a-z0-9 ]/g,"");}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c];});}
function matches(r,terms){
  var hay = norm(r.a)+" "+norm(r.t), alt = norm(r.a.replace(/,\s*The$/,""))+" "+norm(r.t);
  return terms.every(function(t){return hay.indexOf(t)>-1||alt.indexOf(t)>-1;});
}
function artistQ(a){var m=/^(.*),\s*The$/.exec(a);return m?"The "+m[1]:a.replace(/\s+feat\..*$/i,"");}
function titleQ(t){return t.replace(/\s*\([^)]*\)\s*$/,"");}

/* ---- cover art: iTunes lookup, cached, throttled ---- */
var Q=[],running=0;
function pump(){while(running<2&&Q.length){running++;Q.shift()(function(){running--;setTimeout(pump,400);});}}
function jsonp(url,cb){
  var name="__cb"+(jsonp.n=(jsonp.n||0)+1),s=document.createElement("script"),done=false;
  function clean(){try{delete window[name];}catch(e){window[name]=null;}if(s.parentNode)s.parentNode.removeChild(s);}
  window[name]=function(d){done=true;cb(d);clean();};
  s.onerror=function(){if(!done){done=true;cb(null);clean();}};
  s.src=url+"&callback="+name;document.head.appendChild(s);
  setTimeout(function(){if(!done){done=true;cb(null);clean();}},9000);
}
var FIXA={"Maze feat. Frankie Beverly":"Maze","King Tubby Meets The Roots Radics":"King Tubby",
  "Yngwie J. Malmsteen's Rising Force":"Yngwie Malmsteen","Various Artists":"",
  "John Coltrane Quartet, The":"John Coltrane","Frank Zappa & The Mothers":"Frank Zappa",
  "Yuki T-Groove Takahashi & George Kano":"Yuki Takahashi","Roy Ayers Ubiquity":"Roy Ayers"};
var FIXT={"War / No More Trouble / Exodus":"Exodus","Boston / Don't Look Back":"Boston",
  "Pink Floyd At Pompeii MCMLXXII":"Live At Pompeii",
  "Soundtrack From The Film \u201cMore\u201d":"More",
  "Book Of Exit: Sacred System Dub Chamber 4":"Dub Chamber 4",
  "House Of The Rising Sun":"The Best Of The Animals"};
var FAILED={};
function query(r){
  var a=FIXA.hasOwnProperty(r.a)?FIXA[r.a]:artistQ(r.a);
  var t=FIXT[r.t]||titleQ(r.t);
  return (a+" "+t).trim();
}

/* ---- "the collection has settled" -------------------------------
   The app renders the baked-in copy first, then swaps in the live sheet.
   Anything keyed on the CONTENTS of the collection (the dashboard
   assessment is hashed against it) must wait for that swap, or it
   computes one hash before the sheet lands and a different one after —
   which looked like the assessment regenerating on every deploy. */
var dataReady=false, dataWaiters=[];
function onDataReady(fn){
  if(dataReady)return fn();
  dataWaiters.push(fn);
}
function markDataReady(){
  if(dataReady)return;
  dataReady=true;
  dataWaiters.splice(0).forEach(function(f){try{f();}catch(e){}});
}

/* ---- sheet loading ---- */
function parseCSV(t){var rows=[],row=[],cell="",q=false;
  for(var i=0;i<t.length;i++){var ch=t[i];
    if(q){if(ch==='"'){if(t[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;}
    else if(ch==='"')q=true;
    else if(ch===","){row.push(cell);cell="";}
    else if(ch==="\n"){row.push(cell);rows.push(row);row=[];cell="";}
    else if(ch!=="\r")cell+=ch;}
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  return rows;}
var CUBEMAP={"1":[0,0],"2":[0,1],"3":[1,0],"4":[1,1]};
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


/* Turns sheet rows into records, in shelf order.
   ---------------------------------------------------------------
   Order used to be implicit: whatever order the rows happened to be in.
   That works until you want to move a record without moving its row,
   so there is now an explicit Position column (J).

   Position is per cube and sparse — 10, 20, 30 — so a record can be
   inserted between two others without renumbering everything around it.
   Rows with no position fall back to the filing rule (artist, then
   title, articles ignored) and sort after the positioned ones, so a
   half-filled column still behaves sensibly. */
function adopt(rows){
  var recs = rows.map(function(r){
    var c = (String(r[3]).match(/[1-4]/) || ["1"])[0], m = CUBEMAP[c];
    var posRaw = (r[9] === undefined || r[9] === null) ? "" : String(r[9]).trim();
    var pos = /^-?\d+(\.\d+)?$/.test(posRaw) ? parseFloat(posRaw) : null;
    return {
      a:(r[0]||"").trim(), t:(r[1]||"").trim(), c:(r[2]||"").trim(),
      k:+c, r:m[0], co:m[1],
      d:(r[4]||"").trim()||null,
      img:(r[5]||"").trim()||null,
      desc:(r[6]||"").trim()||null,
      /* frozen years from the sheet (columns H and I) \u2014 when
         present these are used as-is and nothing is looked up */
      fy:((r[7]||"").trim().match(/^\d{4}$/)||[null])[0],
      py:((r[8]||"").trim().match(/^\d{4}$/)||[null])[0],
      pos: pos,
      row: 0            /* filled in below: the sheet row, for writing back */
    };
  });

  /* Remember which sheet row each record came from, before sorting, so
     an edit can be written back to the right line. Row 1 is the header,
     so the first record is row 2. */
  recs.forEach(function(rec, i){ rec.row = i + 2; });

  recs.sort(function(x, y){
    if (x.k !== y.k) return x.k - y.k;                 /* cube first */
    var xp = x.pos, yp = y.pos;
    if (xp !== null && yp !== null) return xp - yp;    /* both positioned */
    if (xp !== null) return -1;                        /* positioned first */
    if (yp !== null) return 1;
    return recordSortKey(x).localeCompare(recordSortKey(y));  /* filing rule */
  });

  /* Position within the cube, and the cube's total, for the "4 of 46"
     line on each record. Computed after sorting so they match what is
     actually on screen. */
  var tot = {};
  recs.forEach(function(rec){ tot[rec.k] = (tot[rec.k] || 0) + 1; });
  var seen = {};
  recs.forEach(function(rec, i){
    seen[rec.k] = (seen[rec.k] || 0) + 1;
    rec.p = seen[rec.k];
    rec.n = tot[rec.k];
    rec.i = i;
  });
  return recs;
}

/* Applies whatever rows we ended up with, from either source. */
function applyRows(rows){
  rows = rows.filter(function(r){ return r.length>=4 && r[0]; });
  if(rows.length && /artist/i.test(String(rows[0][0]))) rows.shift();
  /* An empty sheet used to be treated as a failed load, so the app fell
     back to a copy baked into this file. That made a genuinely empty
     collection impossible to see. Zero rows is now a real state \u2014 the
     app shows the first-run message instead of stale data. */
  RECS = adopt(rows);
  RECS.forEach(function(r){ if(!COLORS[r.c]) COLORS[r.c]="#8A8A8A"; });
  renderCatChips();
  render();
  warmDiscogsCache();
  warmDescCache();
}

/* Two ways in.

   The published CSV is what the app has always used. It works without
   any setup, but Google serves it from a cache that can lag several
   minutes behind an edit — so a record added through the app was
   genuinely in the sheet and still invisible here.

   Once the Apps Script write-back is configured, /api/sheet can read
   the sheet directly, which is live. So: try the live read first, and
   fall back to the CSV if write-back isn't set up or the call fails. */
function loadSheet(){
  fetch("/api/sheet",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:"read"})
  })
  .then(function(res){ return res.ok ? res.json() : null; })
  .then(function(d){
    if(!d || !d.values || !d.values.length) throw 0;
    applyRows(d.values.map(function(r){
      return r.map(function(c){ return c==null ? "" : String(c); });
    }));
    markDataReady();
  })
  .catch(function(){ loadSheetCSV(); });
}

function loadSheetCSV(){
  if(!SHEET_CSV_URL){ markDataReady(); return; }
  /* a cache-buster on top of no-store: the published CSV is served by
     Google's own cache, which ignores request headers */
  var url = SHEET_CSV_URL + (SHEET_CSV_URL.indexOf("?")>-1?"&":"?") + "_=" + Date.now();
  fetch(url,{cache:"no-store"})
    .then(function(res){ if(!res.ok) throw 0; return res.text(); })
    .then(function(txt){ applyRows(parseCSV(txt)); markDataReady(); })
    .catch(function(){ markDataReady(); });
}
