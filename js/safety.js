/* =================== one backup, covering everything ================
   There used to be two: a file you downloaded with the wantlist and
   listened marks, and a dated copy of the sheet. Two things called
   "backup" in one settings panel is a good way to restore the wrong one
   in a hurry, so they're now a single action.

   What it saves:
     \u2022 the whole collection tab, into a hidden "Backup" tab
     \u2022 the wantlist and listened marks, which live only in a browser
       and are the one thing that cannot be rebuilt from anywhere else

   It replaces the previous backup rather than keeping a pile of dated
   copies. Google's own version history already covers going further
   back; what this adds is a single, findable last-known-good state.

   It runs itself once a week, and can be taken on demand. */

var BACKUP_EVERY_DAYS = 7;

function lastBackupAt(){
  try { return +localStorage.getItem("lastSheetBackup") || 0; } catch (e) { return 0; }
}
function noteBackup(){
  try { localStorage.setItem("lastSheetBackup", String(Date.now())); } catch (e) {}
}
function lastWriteAt(){
  try { return +localStorage.getItem("lastSheetWrite") || 0; } catch (e) { return 0; }
}
function noteWrite(){
  try { localStorage.setItem("lastSheetWrite", String(Date.now())); } catch (e) {}
}

function ago(ts){
  if (!ts) return "never";
  var mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  if (mins < 1440) return Math.round(mins / 60) + "h ago";
  return Math.round(mins / 1440) + "d ago";
}

/* The parts of this device that exist nowhere else. Covers and years
   are deliberately left out: they are in the sheet already, and sending
   them would bloat the payload for nothing. */
function deviceState(){
  var out = {};
  ["wantlist", "discseen2", "gear"].forEach(function(k){
    try { var v = localStorage.getItem(k); if (v) out[k] = v; } catch (e) {}
  });
  return JSON.stringify(out);
}

function backupNow(force, cb){
  if (!isOwner()) { if (cb) cb(null); return; }
  var due = Date.now() - lastBackupAt() > BACKUP_EVERY_DAYS * 86400000;
  if (!force && !due) { if (cb) cb(null); return; }
  sheetWrite("backup", { device: deviceState() }, function(err, d){
    if (!err) noteBackup();
    if (cb) cb(err, d);
  });
}

/* Pulls the wantlist and listened marks back out of the sheet's Config
   tab, where the backup stashed them. Merges rather than replaces, so a
   device with its own entries keeps them. */
function restoreDeviceLists(cb){
  fetch("/api/sheet", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "getConfig", key: "device_backup" })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (!d || !d.value) { cb(new Error("nothing stored in the sheet yet")); return; }
    var payload = {};
    try { payload = JSON.parse(d.value); } catch (e) {
      cb(new Error("the stored copy is unreadable")); return;
    }
    var added = 0;
    if (payload.wantlist) {
      added += mergeList("wantlist", payload.wantlist,
        function(e){ return (e && (e.artist + "|" + e.title)) || ""; });
    }
    if (payload.discseen2) {
      added += mergeList("discseen2", payload.discseen2,
        function(e){ return (e && e.k) || ""; });
    }
    if (payload.gear) {
      try { if (!localStorage.getItem("gear")) localStorage.setItem("gear", payload.gear); } catch (e) {}
    }
    cb(null, added);
  })
  .catch(function(){ cb(new Error("couldn't reach the sheet")); });
}

function renderSafety(){
  var el = document.getElementById("safetybody");
  if (!el) return;
  el.innerHTML =
    "<p class='hint'>The app writes to your sheet by itself, so once a week it " +
      "copies the collection into a hidden <b>Backup</b> tab, replacing the " +
      "previous copy. Your wantlist and listened marks go with it \u2014 they " +
      "exist nowhere else and can't be regenerated.</p>" +
    "<div class='saferow'><span>Last backup</span><b>" + esc(ago(lastBackupAt())) + "</b></div>" +
    "<div class='saferow'><span>Last successful write</span><b>" + esc(ago(lastWriteAt())) + "</b></div>" +
    "<div class='addrow' style='margin-top:12px'>" +
      "<button class='chip' id='safenow'>Back up now</button>" +
      "<button class='chip' id='saferestore'>Restore wantlist</button>" +
    "</div>" +
    "<p class='hint' id='safemsg'></p>" +
    "<p class='hint' style='margin-top:10px;opacity:.75'>You can also keep a copy " +
      "off the spreadsheet entirely: " +
      "<a href='#' id='safefile'>save a file</a> \u00b7 " +
      "<a href='#' id='safeload'>load one</a></p>";

  document.getElementById("safenow").addEventListener("click", function(){
    var m = document.getElementById("safemsg");
    if (!isOwner()){ m.textContent = "Unlock editing first."; return; }
    m.textContent = "Copying\u2026";
    backupNow(true, function(err, d){
      if (err){ m.textContent = "Couldn't back up: " + err.message; return; }
      var note = "Saved to the Backup tab" +
        ((d && d.rows) ? " \u2014 " + d.rows + " records" : "") +
        ((d && d.removed) ? ", cleared " + d.removed + (d.removed === 1 ? " old dated copy" : " old dated copies") : "") + ".";
      renderSafety();
      var m2 = document.getElementById("safemsg");
      if (m2) m2.textContent = note;
    });
  });

  document.getElementById("saferestore").addEventListener("click", function(){
    var m = document.getElementById("safemsg");
    m.textContent = "Looking in the sheet\u2026";
    restoreDeviceLists(function(err, added){
      m.textContent = err ? ("Couldn't restore: " + err.message)
        : (added ? "Restored " + added + " entr" + (added === 1 ? "y" : "ies") +
                   ". Reload to see them."
                 : "Nothing new \u2014 this device already has them all.");
    });
  });

  document.getElementById("safefile").addEventListener("click", function(e){
    e.preventDefault();
    if (typeof downloadBackup === "function") downloadBackup();
  });
  document.getElementById("safeload").addEventListener("click", function(e){
    e.preventDefault();
    var f = document.getElementById("restorefile");
    if (f) f.click();
  });
}

(function(){
  var link = document.getElementById("safetylink");
  if (link) link.addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("safetybox");
    box.classList.toggle("show");
    if (box.classList.contains("show")){
      renderSafety();
      box.scrollIntoView({ behavior:"smooth", block:"center" });
    }
  });
  if (typeof onDataReady === "function"){
    onDataReady(function(){ setTimeout(function(){ backupNow(false); }, 8000); });
  }
})();
