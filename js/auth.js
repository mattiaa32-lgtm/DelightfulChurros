/* =================== owner vs guest ==================================
   Anyone with the link (or the QR code) can browse the shelf. Editing
   is gated behind a passphrase held on the server.

   Worth being precise about what this does and doesn't do. Hiding the
   edit buttons is only presentation \u2014 a determined guest could unhide
   them. The actual protection is that the sheet's write URL never
   reaches the browser: every write goes through /api/sheet, which
   checks the passphrase server-side before forwarding anything. So a
   guest with dev tools can reveal a button, press it, and still get a
   403. The UI state below is for clarity, not security. */

var OWNER_KEY = "shelfOwner";

function isOwner(){
  try{ return localStorage.getItem(OWNER_KEY) ? true : false; }catch(e){ return false; }
}
function ownerPass(){
  try{ return localStorage.getItem(OWNER_KEY) || ""; }catch(e){ return ""; }
}
function setOwner(pass){
  try{
    if(pass) localStorage.setItem(OWNER_KEY, pass);
    else localStorage.removeItem(OWNER_KEY);
  }catch(e){}
  applyOwnerState();
}

/* Adds a class to <html> so CSS can hide editing affordances, and
   updates the button label. */
function applyOwnerState(){
  document.documentElement.classList.toggle("is-owner", isOwner());
  document.documentElement.classList.toggle("is-guest", !isOwner());
  var b = document.getElementById("ownerbtn");
  if (b) b.textContent = isOwner() ? "Editing on" : "Guest";
}

/* Verifies against the server rather than trusting local state, so a
   stale or wrong passphrase is caught at unlock time instead of failing
   later on the first write. */
function verifyOwner(pass, cb){
  fetch("/api/sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verify", passphrase: pass })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){ cb(!!(d && d.ok), d); })
  .catch(function(){ cb(false, null); });
}

function openOwnerPanel(){
  var wrap = document.getElementById("ownerwrap");
  if (!wrap) return;
  wrap.hidden = false;
  var msg = document.getElementById("ownermsg");
  var inp = document.getElementById("ownerpass");
  if (isOwner()){
    msg.textContent = "Editing is unlocked on this device.";
    inp.value = "";
    document.getElementById("ownerdo").textContent = "Lock again";
  } else {
    msg.textContent = "You're browsing as a guest \u2014 everything is visible, "+
                      "nothing can be changed. Enter the passphrase to edit.";
    document.getElementById("ownerdo").textContent = "Unlock editing";
    setTimeout(function(){ inp.focus(); }, 60);
  }
}
function closeOwnerPanel(){
  var w = document.getElementById("ownerwrap");
  if (w) w.hidden = true;
}

/* ---- wiring ---- */
(function(){
  var btn = document.getElementById("ownerbtn");
  if (!btn) return;
  btn.addEventListener("click", openOwnerPanel);

  var wrap = document.getElementById("ownerwrap");
  wrap.addEventListener("click", function(e){
    if (e.target.id === "ownerwrap") closeOwnerPanel();
  });
  document.getElementById("ownerclose").addEventListener("click", closeOwnerPanel);

  document.getElementById("ownerdo").addEventListener("click", function(){
    var msg = document.getElementById("ownermsg");
    if (isOwner()){
      setOwner(null);
      msg.textContent = "Locked. This device is back to guest access.";
      document.getElementById("ownerdo").textContent = "Unlock editing";
      return;
    }
    var pass = document.getElementById("ownerpass").value;
    if (!pass) return;
    msg.textContent = "Checking\u2026";
    verifyOwner(pass, function(ok, d){
      if (ok){
        setOwner(pass);
        msg.textContent = "Unlocked. You can edit on this device now.";
        document.getElementById("ownerdo").textContent = "Lock again";
        document.getElementById("ownerpass").value = "";
      } else if (d && d.error) {
        msg.textContent = d.error;
      } else {
        msg.textContent = "That passphrase didn't match.";
      }
    });
  });
  document.getElementById("ownerpass").addEventListener("keydown", function(e){
    if (e.key === "Enter") document.getElementById("ownerdo").click();
  });

  applyOwnerState();
})();

/* ---- the only way the app writes to the sheet ---- */
function sheetWrite(action, payload, cb){
  if (!isOwner()){
    if (cb) cb(new Error("read-only"), null);
    return;
  }
  fetch("/api/sheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ action: action, passphrase: ownerPass() }, payload || {}))
  })
  .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
  .then(function(x){
    if (!x.ok || (x.d && x.d.error)) {
      var e = new Error((x.d && x.d.error) || "write failed");
      /* carry what the sheet actually returned \u2014 an HTML sign-in page
         and a script error look identical without it */
      e.detail = x.d && x.d.detail;
      if (cb) cb(e, null);
      return;
    }
    if (cb) cb(null, x.d);
  })
  .catch(function(err){ if (cb) cb(err, null); });
}
