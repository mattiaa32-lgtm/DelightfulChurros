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

var AI_GAP_MIN = 4200;         // floor between requests
var AI_GAP_MAX = 45000;        // ceiling once we've been throttled
var aiGap = AI_GAP_MIN;
var aiLast = 0;
var aiStreakOK = 0;
var aiPausedUntil = 0;         // background sweeps held off until this time
var aiQueueUser = [];
var aiQueueBg = [];
var aiBusy = false;

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
  else if (aiQueueBg.length && !aiBackgroundPaused()) job = aiQueueBg.shift();
  if (!job) return;

  aiBusy = true;
  var wait = Math.max(0, aiLast + aiGap - Date.now());
  /* A user is waiting on this one, so don't sit on it for the full gap;
     a short courtesy delay is enough to avoid bursting. */
  if (job.priority === "user") wait = Math.min(wait, 900);

  setTimeout(function(){
    aiLast = Date.now();
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
        aiBusy = false;
        setTimeout(aiPump, 30);
      }, function(){
        aiBusy = false;
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
