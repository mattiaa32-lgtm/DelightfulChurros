/* =================== Ask: mood-based picks from the shelf ============
   The model is told to copy artist/title verbatim from the collection,
   but we still resolve every pick against RECS before rendering \u2014 if
   it invents or mangles one, it simply doesn't appear rather than
   showing a record that isn't on the shelf. */
var chatStarted=false,chatHistory=[],chatBusy=false;
var chatMode="shelf";   /* "shelf" = play what I own, "new" = discover */
var SUGGESTIONS={
  shelf:["Something for a slow Sunday morning","I've got 90 minutes","Something loud",
         "Cooking dinner","Late night, lights low","Surprise me"],
  new:["More like my Coltrane records","Something heavier than I usually go",
       "Deep cuts in jazz-funk","Surprise me with something obscure"]
};
function renderPrompts(){
  document.getElementById("prompts").innerHTML=SUGGESTIONS[chatMode].map(function(s){
    return "<button class='chip' data-s=\""+esc(s)+"\">"+esc(s)+"</button>";}).join("");
}
function setChatMode(m){
  if(chatMode===m)return;
  chatMode=m;
  [].forEach.call(document.querySelectorAll("#chatmode .chip"),function(b){
    b.setAttribute("aria-pressed",b.dataset.m===m);});
  document.getElementById("askq").placeholder = m==="shelf"
    ? "What are you in the mood for?" : "What kind of thing are you after?";
  renderPrompts();
  setChatIntro();
}
/* The mode line is a status, not conversation: it sits above the log and
   is rewritten in place, so flipping the toggle repeatedly doesn't leave
   a trail of messages in the history. */
function setChatIntro(){
  var el=document.getElementById("chatintro");
  if(!el)return;
  el.textContent = chatMode==="shelf"
    ? "Picking from the records you own."
    : "Looking beyond your collection.";
}
function startChat(){
  chatStarted=true;
  renderPrompts();
  setChatIntro();
  if(!chatHistory.length){
    addBubble("ai","What are you in the mood for? Tell me a vibe, an activity, or how long you've got.");
  }
}
function addBubble(who,text){
  var log=document.getElementById("chatlog"),d=document.createElement("div");
  d.className="bub "+(who==="me"?"me":who==="err"?"ai err":"ai");
  d.textContent=text;
  log.appendChild(d);
  d.scrollIntoView({behavior:"smooth",block:"nearest"});
  return d;
}
function findRec(artist,title){
  var na=norm(artist||""),nt=norm(title||"");
  for(var i=0;i<RECS.length;i++){
    if(norm(RECS[i].a)===na&&norm(RECS[i].t)===nt)return i;
  }
  for(var j=0;j<RECS.length;j++){          // looser fallback on title
    if(norm(RECS[j].t)===nt)return j;
  }
  return -1;
}
function renderPicks(picks){
  if(!picks||!picks.length)return;
  var idxs=[];
  picks.forEach(function(p){
    var k=findRec(p.artist,p.title);
    if(k>-1&&idxs.indexOf(k)<0)idxs.push(k);
  });
  if(!idxs.length)return;
  var log=document.getElementById("chatlog"),wrap=document.createElement("div");
  wrap.className="picks";
  wrap.innerHTML=idxs.map(function(k){return rowHTML(RECS[k]);}).join("");
  log.appendChild(wrap);
  fillArt(wrap);
  wrap.scrollIntoView({behavior:"smooth",block:"nearest"});
}
function sendAsk(text){
  if(chatBusy||!text.trim())return;
  chatBusy=true;
  addBubble("me",text);
  var thinking=addBubble("ai","");
  thinking.innerHTML="<span class='dots'><span></span><span></span><span></span></span>";

  if(chatMode==="new"){
    /* discover mode: same endpoint and card layout as the daily picks,
       but driven by what they just asked for */
    aiFetchUser(API_BASE+"recommend",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({mode:"discover",records:collectionPayload(),count:3,
        brief:text,avoid:seenList(),
        adventurous:document.getElementById("advtoggle").getAttribute("aria-pressed")==="true",
        seed:"chat-"+Date.now()})
    }).then(function(res){
      if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;throw e;});}
      if(!res.ok)throw new Error("failed");
      return res.json();
    }).then(function(recs){
      thinking.remove();
      if(!Array.isArray(recs)||!recs.length){
        addBubble("ai","Nothing came to mind for that \u2014 try describing it differently?");
        chatBusy=false;return;
      }
      rememberSeen(recs);
      addBubble("ai","Three you don't own yet:");
      var log=document.getElementById("chatlog"),wrap=document.createElement("div");
      wrap.className="picks";
      wrap.innerHTML=recs.map(recCardHTML).join("");
      log.appendChild(wrap);
      fillRecArt(wrap);
      wrap.scrollIntoView({behavior:"smooth",block:"nearest"});
      chatBusy=false;
    }).catch(function(err){
      thinking.remove();
      addBubble("err",err.message==="busy"
        ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific, not in a few minutes."
          : "Hit the per-minute rate limit \u2014 give it a minute and try again.")
        : "Couldn't reach the recommender just now. Try again in a moment.");
      chatBusy=false;
    });
    return;
  }

  chatHistory.push({role:"user",text:text});
  aiFetchUser(API_BASE+"recommend",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({mode:"mood",records:collectionPayload(),
                         history:chatHistory.slice(0,-1),message:text})
  }).then(function(res){
    if(res.status===429){return res.json().catch(function(){return {};})
      .then(function(q){var e=new Error("busy");e.quota=q&&q.quota;throw e;});}
    if(!res.ok)throw new Error("failed");
    return res.json();
  }).then(function(d){
    thinking.remove();
    var reply=(d&&d.reply)?d.reply:"I couldn't come up with something there \u2014 try rephrasing?";
    addBubble("ai",reply);
    chatHistory.push({role:"assistant",text:reply});
    renderPicks(d&&d.picks);
    chatBusy=false;
  }).catch(function(err){
    thinking.remove();
    addBubble("err",err.message==="busy"
      ? (err.quota==="daily"
          ? "That's the free tier's daily quota \u2014 it resets at midnight Pacific, not in a few minutes."
          : "Hit the per-minute rate limit \u2014 give it a minute and try again.")
      : "Couldn't reach the recommender just now. Try again in a moment.");
    chatBusy=false;
  });
}
document.getElementById("asksend").addEventListener("click",function(){
  var el=document.getElementById("askq");sendAsk(el.value);el.value="";});
document.getElementById("askq").addEventListener("keydown",function(e){
  if(e.key==="Enter"){sendAsk(this.value);this.value="";}});
document.getElementById("prompts").addEventListener("click",function(e){
  var b=e.target.closest(".chip");if(b)sendAsk(b.dataset.s);});

/* ---- floating chat button: opens the panel, drag the header down to
   dismiss it (same gesture as the record sheet) ---- */
function openChat(){
  document.getElementById("chatwrap").hidden=false;
  if(!chatStarted)startChat();
  setTimeout(function(){document.getElementById("askq").focus();},60);
}
function closeChat(){
  var p=document.getElementById("chatpanel");
  p.style.transform="";
  document.getElementById("chatwrap").hidden=true;
}
document.getElementById("fab").addEventListener("click",openChat);
document.getElementById("chatclose").addEventListener("click",closeChat);
document.getElementById("chatwrap").addEventListener("click",function(e){
  if(e.target.id==="chatwrap")closeChat();});
document.addEventListener("keydown",function(e){
  if(e.key==="Escape"&&!document.getElementById("chatwrap").hidden)closeChat();});
(function(){
  var panel=document.getElementById("chatpanel"),head=document.querySelector(".chathead");
  var dragging=false,startY=0,lastY=0,startT=0,lastT=0;
  head.addEventListener("pointerdown",function(e){
    /* Never start a drag from an interactive control. setPointerCapture
       redirects the subsequent pointerup to the header, which cancels
       the click on whatever was actually pressed \u2014 that's why the mode
       toggle worked on touch but did nothing with a mouse. */
    if(e.target.closest(".chatclose,#chatmode,button,a,input"))return;
    dragging=true;startY=lastY=e.clientY;startT=lastT=e.timeStamp;
    panel.style.transition="none";
    if(head.setPointerCapture)head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove",function(e){
    if(!dragging)return;
    lastY=e.clientY;lastT=e.timeStamp;
    var dy=Math.max(0,lastY-startY);
    panel.style.transform="translateY("+dy+"px)";
  });
  function release(){
    if(!dragging)return;
    dragging=false;
    var dy=Math.max(0,lastY-startY),dt=Math.max(1,lastT-startT),v=dy/dt;
    panel.style.transition="";
    if(dy>90||(dy>36&&v>0.5))closeChat();
    panel.style.transform="";
  }
  head.addEventListener("pointerup",release);
  head.addEventListener("pointercancel",release);
})();

document.getElementById("chatmode").addEventListener("click",function(e){
  var b=e.target.closest(".chip");if(b)setChatMode(b.dataset.m);});

/* ---- voice dictation via the Web Speech API ----------------------
   Supported in Safari (iOS 14.5+) and Chrome; the mic button stays
   hidden entirely where it isn't, rather than showing a control that
   does nothing. Interim results stream into the box as you speak, and
   the final transcript is left in the input to edit or send \u2014 it does
   NOT auto-send, so a misheard phrase can be fixed first. */
(function(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  var micBtn=document.getElementById("askmic");
  if(!SR||!micBtn)return;
  micBtn.hidden=false;

  var rec=new SR(),listening=false,base="";
  rec.continuous=false;
  rec.interimResults=true;
  rec.lang=(navigator.language||"en-US");

  function stop(){
    listening=false;
    micBtn.classList.remove("rec");
    micBtn.setAttribute("aria-label","Dictate");
    try{rec.stop();}catch(e){}
  }
  micBtn.addEventListener("click",function(){
    if(listening)return stop();
    base=document.getElementById("askq").value.trim();
    try{rec.start();}catch(e){return;}
    listening=true;
    micBtn.classList.add("rec");
    micBtn.setAttribute("aria-label","Stop dictating");
  });
  rec.onresult=function(e){
    var txt="";
    for(var i=e.resultIndex;i<e.results.length;i++)txt+=e.results[i][0].transcript;
    var el=document.getElementById("askq");
    el.value=(base?base+" ":"")+txt.trim();
  };
  rec.onerror=function(){stop();};
  rec.onend=function(){stop();};
})();
