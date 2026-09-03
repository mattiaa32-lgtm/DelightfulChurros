/* Reads a response defensively. An endpoint that isn't deployed returns
   an HTML 404 page; calling .json() on that throws, and the resulting
   catch reports a network problem when the real answer is "that file
   isn't there". Reading text first keeps the actual cause visible. */
function readJSON(r){
  return r.text().then(function(txt){
    var d = null;
    try { d = JSON.parse(txt); } catch (e) {}
    return { ok: r.ok, status: r.status, d: d, raw: txt };
  });
}
function failMsg(x, what){
  if (!x.d){
    /* 504 is the platform killing a slow function, which is a very
       different thing from the file being missing. */
    if (x.status === 504 || x.status === 408){
      return "The sync timed out partway. Anything it managed to write is saved \u2014 " +
             "run it again and it will pick up where it stopped.";
    }
    return "The " + what + " endpoint returned " + x.status + " and not JSON \u2014 " +
           "api/discogs-sync.js may not be deployed.";
  }
  return (x.d.detail ? x.d.error + " \u2014 " + String(x.d.detail).slice(0, 140)
                     : (x.d.error || "Request failed")) + " (HTTP " + x.status + ")";
}

/* =================== connecting to Discogs ==========================
   OAuth, so your Discogs password never reaches this app: the Connect
   button sends you to Discogs' own site to log in and authorise, and
   what comes back is a token you can revoke from your Discogs settings
   whenever you like.

   The token is stored in a hidden tab of the Google Sheet rather than
   in the browser, so every device you own is connected at once and
   disconnecting works from anywhere.

   Disconnecting and wiping the collection are deliberately separate.
   Switching accounts shouldn't be able to delete a shelf by accident,
   so clearing is a second, explicitly confirmed choice \u2014 and the
   Apps Script copies the tab before emptying it either way. */

/* A badge in the header, so the connection state is visible without
   opening anything. The last known state is cached and shown instantly,
   then refreshed in the background \u2014 otherwise the badge flickers
   through "unknown" on every load while the check round-trips. */
function paintConnBadge(state, user){
  var b = document.getElementById("connbadge");
  if (!b) return;
  b.className = "connbadge " + state;
  if (state === "on"){
    b.title = "Connected to Discogs as " + (user || "your account");
    b.innerHTML = svcIcon("discogs", false, 13) + "<span>" + esc(user || "Connected") + "</span>";
  } else if (state === "off"){
    b.title = "Not connected to Discogs";
    b.innerHTML = svcIcon("discogs", false, 13) + "<span>Not connected</span>";
  } else {
    b.title = "Checking the Discogs connection";
    b.innerHTML = svcIcon("discogs", false, 13) + "<span>\u2026</span>";
  }
}
function cachedConn(){
  try { return JSON.parse(localStorage.getItem("connState") || "null"); }
  catch (e) { return null; }
}
function refreshConnBadge(){
  var c = cachedConn();
  paintConnBadge(c ? (c.connected ? "on" : "off") : "unknown", c && c.user);
  connStatus(function(d){
    var state = { connected: !!d.connected, user: d.user || null };
    try { localStorage.setItem("connState", JSON.stringify(state)); } catch (e) {}
    paintConnBadge(state.connected ? "on" : "off", state.user);
  });
}

function connStatus(cb){
  fetch("/api/discogs-auth", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ action:"status" })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){ cb(d || {}); })
  .catch(function(){ cb({ connected:false, error:true }); });
}

function renderConnect(){
  /* If the container is missing the panel would open blank with no clue
     why, so fall back to the box itself rather than silently doing
     nothing. */
  var el = document.getElementById("connbody") || document.getElementById("connbox");
  if (!el) return;
  el.innerHTML = "<p class='hint'>Checking\u2026</p>";
  connStatus(function(d){
    if (d.error){
      el.innerHTML = "<p class='hint'>Couldn't reach the connection service.</p>";
      return;
    }
    /* The store being unreachable looks identical to "not connected"
       unless it's said out loud \u2014 which is why connecting appeared to
       work and then never stick. */
    if (d.storeError){
      el.innerHTML =
        "<p class='connwho'>Not connected \u2014 and the connection can't be saved</p>" +
        "<p class='hint'>" + esc(d.storeError) + "</p>" +
        (d.hint ? "<p class='hint'>" + esc(d.hint) + "</p>" : "");
      return;
    }
    if (!d.configured){
      el.innerHTML = "<p class='hint'>Discogs OAuth isn't set up on the server yet \u2014 " +
        "DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET need to be set.</p>";
      return;
    }
    if (d.connected){
      el.innerHTML =
        "<p class='connwho'>Connected as <b>" + esc(d.user || "your account") + "</b></p>" +
        "<p class='hint'>Your collection can be synced into the sheet. " +
          "Records, covers and years come from Discogs; category, cube and " +
          "position stay yours.</p>" +
        "<div class='addrow'>" +
          "<button class='chip' id='connsync'>Sync from Discogs</button>" +
          "<button class='chip' id='connpreview'>Preview changes</button>" +
        "</div>" +
        "<div id='syncout'></div>" +
        "<div class='addrow'>" +
          "<button class='chip' id='conndisc'>Disconnect</button>" +
        "</div>" +
        "<label class='synclab'><input type='checkbox' id='connwipe'> " +
          "Also empty the collection, to start over with another account</label>" +
        "<p class='hint' id='connmsg'></p>";
      document.getElementById("conndisc").addEventListener("click", doDisconnect);
      document.getElementById("connsync").addEventListener("click", function(){ doSync(false); });
      document.getElementById("connpreview").addEventListener("click", function(){ doSync(true); });
    } else {
      el.innerHTML =
        "<p class='connwho'>Not connected</p>" +
        "<p class='hint'>You'll be sent to Discogs to log in and authorise. " +
          "Your password never passes through this app, and you can revoke " +
          "access from your Discogs settings at any time.</p>" +
        "<div class='addrow'><button class='chip' id='conngo'>Connect to Discogs</button></div>" +
        "<p class='hint' id='connmsg'></p>";
      document.getElementById("conngo").addEventListener("click", function(){
        if (!isOwner()){
          document.getElementById("connmsg").textContent =
            "Unlock editing first (the button in the header).";
          return;
        }
        window.location.href = "/api/discogs-auth?step=start&pass=" +
                               encodeURIComponent(ownerPass());
      });
    }
  });
}

/* The sync only adds and fills blanks, but it still touches the sheet,
   so "Preview changes" runs exactly the same comparison and reports what
   it would do without writing anything. Worth using the first time. */
function doSync(dryRun){
  var out = document.getElementById("syncout");
  if (!isOwner()){ out.innerHTML = "<p class='hint'>Unlock editing first.</p>"; return; }
  out.innerHTML = "<p class='hint'>" +
    (dryRun ? "Comparing with Discogs\u2026" : "Syncing\u2026 this can take a minute for a large collection.") +
    "</p>";
  fetch("/api/discogs-sync", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ passphrase: ownerPass(), dryRun: !!dryRun,
                           categories: (typeof COLORS!=="undefined") ? Object.keys(COLORS) : [] })
  })
  .then(readJSON)
  .then(function(x){
    var d = x.d;
    if (!x.ok || !d || !d.ok){
      out.innerHTML = "<p class='hint'>" + esc(failMsg(x, "sync")) + "</p>";
      return;
    }
    var lines = [];
    lines.push("<b>" + d.collection + "</b> in your Discogs collection, <b>" +
               d.inSheet + "</b> rows in the sheet.");
    lines.push(dryRun ? "Would add <b>" + d.toAdd + "</b> new record" + (d.toAdd===1?"":"s") + "."
                      : "Added <b>" + d.toAdd + "</b> new record" + (d.toAdd===1?"":"s") + ".");
    if (d.suggested) lines.push((dryRun ? "Would suggest" : "Suggested") + " a category for <b>" +
      d.suggested + "</b> record" + (d.suggested===1?"":"s") + " from its Discogs genres.");
    if (d.toFill) lines.push((dryRun ? "Would fill" : "Filled") + " <b>" + d.toFill +
      "</b> blank cell" + (d.toFill===1?"":"s") + " (" + d.filledCover + " covers, " +
      d.filledYear + " years).");
    if (d.notInDiscogs) lines.push("<b>" + d.notInDiscogs + "</b> row" +
      (d.notInDiscogs===1?" is":"s are") + " not in Discogs \u2014 left untouched.");
    var html = "<p class='hint'>" + lines.join("<br>") + "</p>";
    if (d.sample && d.sample.length){
      html += "<p class='hint' style='opacity:.75'>" +
        d.sample.map(esc).join("<br>") +
        (d.toAdd > d.sample.length ? "<br>\u2026and " + (d.toAdd - d.sample.length) + " more" : "") +
        "</p>";
    }
    if (!dryRun) html += "<p class='hint'>Pull down to refresh and see them on the shelf. " +
      "New records have no category or cube yet.</p>";
    out.innerHTML = html;
  })
  .catch(function(err){
    out.innerHTML = "<p class='hint'>Network error calling /api/discogs-sync: " +
      esc(String(err && err.message || err)) + "</p>";
  });
}

function doDisconnect(){
  var msg = document.getElementById("connmsg");
  var wipe = document.getElementById("connwipe").checked;
  if (!isOwner()){ msg.textContent = "Unlock editing first."; return; }
  if (wipe && !window.confirm(
      "This will disconnect Discogs AND empty the collection.\n\n" +
      "A dated copy of the tab is made first, so it can be recovered.\n\n" +
      "Continue?")) return;
  msg.textContent = "Disconnecting\u2026";
  fetch("/api/discogs-auth", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ action:"disconnect", passphrase: ownerPass(),
                           clearCollection: wipe })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (d && d.ok){
      msg.textContent = wipe
        ? "Disconnected and cleared " + (d.cleared || 0) + " records. Pull down to refresh."
        : "Disconnected.";
      refreshConnBadge();
      setTimeout(renderConnect, 1200);
    } else {
      msg.textContent = (d && d.error) || "Couldn't disconnect.";
    }
  })
  .catch(function(){ msg.textContent = "Couldn't reach the server."; });
}

(function(){
  refreshConnBadge();
  var badge = document.getElementById("connbadge");
  if (badge) badge.addEventListener("click", function(){
    var box = document.getElementById("connbox");
    box.classList.add("show");
    renderConnect();
    box.scrollIntoView({ behavior:"smooth", block:"center" });
  });
  var link = document.getElementById("connlink");
  if (!link) return;
  link.addEventListener("click", function(e){
    e.preventDefault();
    var box = document.getElementById("connbox");
    box.classList.toggle("show");
    if (box.classList.contains("show")){
      renderConnect();
      box.scrollIntoView({ behavior:"smooth", block:"center" });
    }
  });
})();


/* ---- sync from the shelf ------------------------------------------
   The connection panel is the right home for connecting, but syncing is
   something you do routinely \u2014 after buying a record \u2014 so it also
   sits on the shelf itself. Same call, with the result reported in
   place rather than opening a panel. */
(function(){
  var btn = document.getElementById("synctop");
  if (!btn) return;

  function showLastSync(){
    var el = document.getElementById("synced");
    if (!el) return;
    var t = null;
    try { t = localStorage.getItem("lastSyncAt"); } catch (e) {}
    if (!t) { el.textContent = ""; return; }
    var mins = Math.round((Date.now() - (+t)) / 60000);
    el.textContent = mins < 1 ? "Synced just now"
      : mins < 60 ? "Synced " + mins + " min ago"
      : mins < 1440 ? "Synced " + Math.round(mins / 60) + "h ago"
      : "Synced " + Math.round(mins / 1440) + "d ago";
  }
  showLastSync();

  btn.addEventListener("click", function(){
    var el = document.getElementById("synced");
    if (!isOwner()){ el.textContent = "Unlock editing first."; return; }
    btn.disabled = true;
    var was = btn.innerHTML;
    btn.innerHTML = "\u21bb &nbsp;Syncing\u2026";
    el.textContent = "Checking Discogs\u2026";
    fetch("/api/discogs-sync", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ passphrase: ownerPass(),
                             categories: (typeof COLORS!=="undefined") ? Object.keys(COLORS) : [] })
    })
    .then(readJSON)
    .then(function(x){
      btn.disabled = false; btn.innerHTML = was;
      var d = x.d;
      if (!x.ok || !d || !d.ok){
        el.textContent = failMsg(x, "sync");
        return;
      }
      try { localStorage.setItem("lastSyncAt", String(Date.now())); } catch (e) {}
      if (d.toAdd || d.toFill || d.suggested){
        var bits = [];
        if (d.toAdd) bits.push("added " + d.toAdd);
        if (d.suggested) bits.push("suggested " + d.suggested + " categor" +
                                   (d.suggested === 1 ? "y" : "ies"));
        if (d.toFill) bits.push("filled " + d.toFill + " blank cell" +
                                (d.toFill === 1 ? "" : "s"));
        el.textContent = bits.join(", ").replace(/^./, function(c){ return c.toUpperCase(); }) +
                         ". Pull down to refresh.";
      } else {
        el.textContent = "Already up to date \u2014 nothing new on Discogs.";
      }
    })
    .catch(function(err){
      btn.disabled = false; btn.innerHTML = was;
      el.textContent = "Network error calling /api/discogs-sync: " +
        String(err && err.message || err);
    });
  });
})();
