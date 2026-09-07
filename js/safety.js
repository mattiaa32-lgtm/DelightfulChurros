/* =================== keeping the sheet recoverable ==================
   The app writes to the sheet on its own now \u2014 syncs, descriptions,
   ratings, filing \u2014 so a bad run could damage a lot of rows with
   nothing obvious to roll back to.

   Two small things guard against that:

   \u2022 a weekly dated copy of the collection tab, taken automatically the
     first time the app is opened after a week has passed. It costs one
     request and a hidden tab, and means there is always a recent good
     state to compare against.
   \u2022 a record of when a write last succeeded, shown in settings. Silent
     write failures have bitten this app more than once, and "last
     written: three days ago" makes one visible without having to open
     the spreadsheet. */

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

/* Only the owner can write, so only the owner can back up. Silent by
   design: this is insurance, not something to announce. */
function backupSheetIfDue(force, cb){
  if (!isOwner()) { if (cb) cb(null); return; }
  var due = Date.now() - lastBackupAt() > BACKUP_EVERY_DAYS * 86400000;
  if (!force && !due) { if (cb) cb(null); return; }

  sheetWrite("backup", { keep: 8 }, function(err, d){
    if (!err) noteBackup();
    if (cb) cb(err, d);
  });
}

function renderSafety(){
  var el = document.getElementById("safetybody");
  if (!el) return;
  el.innerHTML =
    "<p class='hint'>The app writes to your sheet by itself, so it keeps a dated " +
      "copy of the collection tab once a week. They're hidden tabs named " +
      "<b>Backup " + new Date().toISOString().slice(0,10) + "</b>; the last eight are kept.</p>" +
    "<div class='saferow'><span>Last backup</span><b>" + esc(ago(lastBackupAt())) + "</b></div>" +
    "<div class='saferow'><span>Last successful write</span><b>" + esc(ago(lastWriteAt())) + "</b></div>" +
    "<div class='addrow' style='margin-top:12px'>" +
      "<button class='chip' id='safenow'>Back up the sheet now</button>" +
      "<span class='hint' id='safemsg'></span>" +
    "</div>";
  document.getElementById("safenow").addEventListener("click", function(){
    var m = document.getElementById("safemsg");
    if (!isOwner()){ m.textContent = "Unlock editing first."; return; }
    m.textContent = "Copying\u2026";
    backupSheetIfDue(true, function(err, d){
      if (err){ m.textContent = "Couldn't back up: " + err.message; return; }
      /* Re-render first, then write the message: rendering rebuilds the
         panel and would otherwise wipe what was just said. */
      var note = "Saved as " + ((d && d.name) || "a dated tab") +
        ((d && d.removed) ? ", removed " + d.removed + " old one" + (d.removed===1?"":"s") : "") + ".";
      renderSafety();
      var m2 = document.getElementById("safemsg");
      if (m2) m2.textContent = note;
    });
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
  /* Take the weekly copy in the background, once the collection has
     loaded and only if one is due. */
  if (typeof onDataReady === "function"){
    onDataReady(function(){ setTimeout(function(){ backupSheetIfDue(false); }, 8000); });
  }
})();
