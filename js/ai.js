/* =================== the AI request gate ============================
   Every call to /api/* goes through here.

   The problem this solves: the app runs two long background sweeps
   (descriptions, then release years) that each fire a request every few
   seconds for as long as the app is open. Gemini's free tier limits
   requests per minute across the whole key, so pressing "Look up" on a
   piece of gear, or opening Discover, would land on top of a sweep and
   come back 429 \u2014 even though the user had made only one request.

   So: one queue for everything, with two priorities.

     "user"        something was tapped and someone is waiting. Jumps the
                   queue, and pauses the background sweeps for a while so
                   the next few slots are free for follow-up requests.
     "background"  the sweeps. Yields to anything user-initiated, and
                   stops entirely for a cooling-off period after a 429.

   Spacing adapts: it widens after a rate limit and eases back after a
   run of clean responses, so it settles near whatever the account
   actually allows instead of a number guessed up front. */

/* Gemini's free tier allows about 10 requests per MINUTE across the
   whole key (and roughly 1,000 a day). Spacing requests evenly wasn't
   enough on its own: a gap of 4.2s is ~14/min, already over the line,
   so the sweeps alone could exhaust the minute and leave nothing for a
   tap. This now enforces a hard rolling-window ceiling as well.

   AI_RPM is deliberately below the real limit, and background work is
   cut off earlier still (AI_RPM_BG), so there is always headroom for
   something the user actually asked for.

   If you enable billing on the Google Cloud project the ceiling rises
   to thousands per minute — you are not charged unless you exceed the
   free quota — at which point AI_RPM can go up a lot. */
var AI_RPM = 8;                // total requests allowed per rolling minute
var AI_RPM_BG = 5;             // background stops here, leaving 3 for taps
var AI_RPD = 900;              // daily ceiling across every AI endpoint

var AI_GAP_MIN = 4200;         // floor between requests
var AI_GAP_MAX = 45000;        // ceiling once we've been throttled
var aiGap = AI_GAP_MIN;
var aiLast = 0;
var aiStreakOK = 0;
var aiPausedUntil = 0;         // background sweeps held off until this time
var aiQueueUser = [];
var aiQueueBg = [];
var aiBusy = false;
var aiPending = null;          // job currently holding the slot
var aiPendingTimer = null;     // its pre-request delay, cancellable
var aiWindow = [];             // timestamps of recent requests

function aiPrune(){
  var cutoff = Date.now() - 60000;
  while (aiWindow.length && aiWindow[0] < cutoff) aiWindow.shift();
}
function aiUsedThisMinute(){ aiPrune(); return aiWindow.length; }
/* How long until a slot frees up, for the given ceiling. */
function aiWaitForSlot(limit){
  aiPrune();
  if (aiWindow.length < limit) return 0;
  return Math.max(0, aiWindow[aiWindow.length - limit] + 60000 - Date.now()) + 250;
}
function aiDayKey(){
  var d = new Date();
  return "airpd:" + d.getFullYear() + "-" + ("0"+(d.getMonth()+1)).slice(-2) +
         "-" + ("0"+d.getDate()).slice(-2);
}
function aiDayCount(){
  try { return +localStorage.getItem(aiDayKey()) || 0; } catch(e){ return 0; }
}
function aiDaySpend(){
  try { localStorage.setItem(aiDayKey(), String(aiDayCount() + 1)); } catch(e){}
}
function aiDayExhausted(){ return aiDayCount() >= AI_RPD; }

function aiPauseBackground(ms){
  aiPausedUntil = Math.max(aiPausedUntil, Date.now() + (ms || 25000));
}
function aiBackgroundPaused(){
  return Date.now() < aiPausedUntil;
}
function aiWiden(){
  aiGap = Math.min(AI_GAP_MAX, Math.round(aiGap * 1.9));
  aiStreakOK = 0;
  aiPauseBackground(60000);     // give the minute window time to clear
}
function aiNarrow(){
  if (++aiStreakOK >= 6 && aiGap > AI_GAP_MIN) {
    aiGap = Math.max(AI_GAP_MIN, Math.round(aiGap / 1.4));
    aiStreakOK = 0;
  }
}

function aiPump(){
  if (aiBusy) return;
  var job = null;
  if (aiQueueUser.length) job = aiQueueUser.shift();
  else if (aiQueueBg.length && !aiBackgroundPaused() && !aiDayExhausted())
    job = aiQueueBg.shift();
  if (!job) return;

  aiBusy = true;
  aiPending = job;
  /* Two gates: the adaptive gap between requests, and the hard rolling
     ceiling. Background jobs are held to the lower ceiling so a tap
     always has slots left. */
  var limit = (job.priority === "user") ? AI_RPM : AI_RPM_BG;
  var slotWait = aiWaitForSlot(limit);
  var wait = Math.max(slotWait, aiLast + aiGap - Date.now());
  /* A user is waiting on this one, so don't sit on it for the full gap;
     a short courtesy delay is enough to avoid bursting. */
  if (job.priority === "user") wait = Math.min(wait, 900);

  aiPendingTimer = setTimeout(function(){
    aiPendingTimer = null;
    aiLast = Date.now();
    aiWindow.push(aiLast);
    aiDaySpend();
    /* A request that never settles would hold aiBusy forever and stall
       the whole queue \u2014 including anything the user taps. Race every
       job against a timeout so a stalled connection can't deadlock it. */
    var settled = false;
    var timer = setTimeout(function(){
      if (settled) return;
      settled = true;
      job.reject(new Error("timeout"));
      aiBusy = false;
      setTimeout(aiPump, 30);
    }, 45000);
    function done(){ clearTimeout(timer); }
    fetch(job.url, job.opts || {})
      .then(function(res){
        if (res.status === 429) {
          aiWiden();
          return res.json().catch(function(){ return {}; }).then(function(b){
            var daily = b && b.quota === "daily";
            /* A per-minute limit is transient, so a request someone is
               actually waiting on gets a couple of quiet retries before
               it's reported as a failure. A DAILY limit won't clear by
               waiting, so that one surfaces immediately. */
            if (job.priority === "user" && !daily && (job.tries || 0) < 2) {
              job.tries = (job.tries || 0) + 1;
              aiPauseBackground(60000);
              setTimeout(function(){
                aiQueueUser.unshift(job);
                aiPump();
              }, job.tries * 4000);
              return null;                 /* neither resolved nor rejected yet */
            }
            var e = new Error("busy");
            e.quota = b && b.quota;
            e.rateLimited = true;
            throw e;
          });
        }
        aiNarrow();
        return res;
      })
      .then(function(res){
        if (settled) return;              /* timed out already */
        if (res) { settled = true; done(); job.resolve(res); }
        /* res === null means the job was requeued for a retry; release
           the lock but leave the caller's promise pending */
        else { done(); }
      }, function(err){
        if (settled) return;
        settled = true; done(); job.reject(err);
      })
      .then(function(){
        aiBusy = false; aiPending = null;
        setTimeout(aiPump, 30);
      }, function(){
        aiBusy = false; aiPending = null;
        setTimeout(aiPump, 30);
      });
  }, wait);
}

/* Returns a promise resolving to the raw Response, so callers keep
   their existing res.ok / res.json() handling. */
function aiFetch(url, opts, priority){
  return new Promise(function(resolve, reject){
    var job = { url:url, opts:opts, priority:(priority === "user" ? "user" : "background"),
                resolve:resolve, reject:reject };
    if (job.priority === "user") {
      aiQueueUser.push(job);
      /* hold the sweeps back so follow-up taps aren't queued behind them */
      aiPauseBackground(25000);
      /* A background job that is still sitting in its pre-request delay
         is holding the slot without having sent anything. Cancel it and
         put it back, so the tap doesn't wait out a sweep's timer \u2014
         which could be tens of seconds. */
      if (aiPending && aiPending.priority !== "user" && aiPendingTimer) {
        clearTimeout(aiPendingTimer);
        aiPendingTimer = null;
        aiQueueBg.unshift(aiPending);
        aiPending = null;
        aiBusy = false;
      }
    } else {
      aiQueueBg.push(job);
    }
    aiPump();
  });
}
/* Convenience for the common "someone tapped something" case. */
function aiFetchUser(url, opts){ return aiFetch(url, opts, "user"); }
/* ...and for the sweeps, which must always yield to the above. */
function aiFetchBg(url, opts){ return aiFetch(url, opts, "background"); }
