/* Shelf service worker
   ---------------------------------------------------------------
   Deliberately conservative about the app's own code. A service
   worker that serves cached HTML/JS first is the classic way to end
   up staring at an old build after a deploy, so:

     app shell (html/css/js)  network first, cache as fallback
     images (covers, icons)   cache first, they never change
     the Google Sheet CSV     network first, cache as fallback
     /api/* (the AI calls)    never cached, never intercepted

   The cache name carries a version. Bump SW_VERSION when the shell
   changes; everything under an older name is deleted on activate. */

var SW_VERSION = "v15";
var SHELL_CACHE = "shelf-shell-" + SW_VERSION;
var MEDIA_CACHE = "shelf-media-" + SW_VERSION;

var SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/data.js",
  "js/covers.js",
  "js/shelf.js",
  "js/want.js",
  "js/discover.js",
  "js/chat.js",
  "js/dashboard.js",
  "js/hifi.js",
  "js/backup.js",
  "js/ai.js",
  "js/icons.js",
  "js/ptr.js",
  "js/auth.js",
  "js/add.js",
  "js/ptr.js",
  "js/auth.js",
  "js/app.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-180.png",
  "icon-192.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      // one missing file shouldn't block the whole install
      .catch(function () {})
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        if (n !== SHELL_CACHE && n !== MEDIA_CACHE) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isImage(req, url) {
  return req.destination === "image" ||
         /\.(png|jpg|jpeg|webp|gif|svg)(\?|$)/i.test(url.pathname);
}
/* Webfonts are immutable and cross-origin; cache them like images so the
   app doesn't fall back to system type when offline. */
function isFont(req, url) {
  return req.destination === "font" ||
         url.hostname === "fonts.gstatic.com" ||
         url.hostname === "fonts.googleapis.com";
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // Never touch the serverless functions: responses are per-request and
  // an offline stale answer would be worse than a clear failure.
  if (url.pathname.indexOf("/api/") === 0) return;

  // Cover art and icons: immutable URLs, so cache first and keep them.
  if (isImage(req, url) || isFont(req, url)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) {
            var copy = res.clone();
            caches.open(MEDIA_CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return hit; });
      })
    );
    return;
  }

  // Everything else (shell + the published sheet): network first so a
  // deploy or a sheet edit lands immediately, cache only as a fallback.
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && (url.origin === self.location.origin ||
                            url.hostname === "docs.google.com")) {
        var copy = res.clone();
        caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        // navigations fall back to the cached page rather than an error
        if (req.mode === "navigate") return caches.match("index.html");
        return new Response("", { status: 504, statusText: "Offline" });
      });
    })
  );
});
