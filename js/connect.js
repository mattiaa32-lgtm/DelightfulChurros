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
          "<button class='chip' id='conndisc'>Disconnect</button>" +
        "</div>" +
        "<label class='synclab'><input type='checkbox' id='connwipe'> " +
          "Also empty the collection, to start over with another account</label>" +
        "<p class='hint' id='connmsg'></p>";
      document.getElementById("conndisc").addEventListener("click", doDisconnect);
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
      setTimeout(renderConnect, 1200);
    } else {
      msg.textContent = (d && d.error) || "Couldn't disconnect.";
    }
  })
  .catch(function(){ msg.textContent = "Couldn't reach the server."; });
}

(function(){
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
