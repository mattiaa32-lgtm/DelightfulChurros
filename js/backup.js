/* =================== backup & restore ================================
   Most of what the app knows can be rebuilt: covers, descriptions and
   years all come back from Discogs, MusicBrainz or the sheet. Two things
   cannot \u2014 the wantlist and the listened marks exist only here. This
   writes everything the app has cached to a single JSON file so clearing
   site data (or moving to a new phone) isn't a one-way door.

   Restore merges rather than overwrites: anything already on this device
   is kept, and the backup only fills gaps, so restoring an older file
   can't quietly delete newer wantlist entries. */
var BACKUP_PREFIXES=["cov:","dcog:","dfirst:","dpress:","myear:","yfix:",
                     "desc2:","mbart:","assess:","dive:","gear","gearsys:",
                     "wantlist","discseen2","disc:"];
function backupBlob(){
  var out={};
  for(var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i);
    for(var j=0;j<BACKUP_PREFIXES.length;j++){
      if(k.indexOf(BACKUP_PREFIXES[j])===0){out[k]=localStorage.getItem(k);break;}
    }
  }
  return {app:"shelf",version:1,saved:new Date().toISOString(),
          records:(typeof RECS!=="undefined"?RECS.length:0),data:out};
}
function downloadBackup(){
  var blob=new Blob([JSON.stringify(backupBlob(),null,1)],{type:"application/json"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  var d=new Date(),stamp=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
  a.href=url; a.download="shelf-backup-"+stamp+".json";
  document.body.appendChild(a); a.click();
  setTimeout(function(){URL.revokeObjectURL(url);a.remove();},1000);
}
/* wantlist and listened marks are lists, so they're merged entry by
   entry rather than replaced wholesale */
function mergeList(key,incoming,idOf){
  var mine=[];
  try{mine=JSON.parse(localStorage.getItem(key)||"[]");}catch(e){}
  if(!Array.isArray(mine))mine=[];
  var theirs=[];
  try{theirs=JSON.parse(incoming||"[]");}catch(e){}
  if(!Array.isArray(theirs))return 0;
  var seen={},added=0;
  mine.forEach(function(e){seen[idOf(e)]=1;});
  theirs.forEach(function(e){
    var id=idOf(e);
    if(id&&!seen[id]){mine.push(e);seen[id]=1;added++;}
  });
  try{localStorage.setItem(key,JSON.stringify(mine));}catch(e){}
  return added;
}
function restoreBackup(json){
  var b=null;
  try{b=JSON.parse(json);}catch(e){return {ok:false,msg:"That file isn't valid JSON."};}
  if(!b||b.app!=="shelf"||!b.data)return {ok:false,msg:"That doesn't look like a Shelf backup."};
  var filled=0,wl=0,ds=0;
  Object.keys(b.data).forEach(function(k){
    if(k==="wantlist"){wl=mergeList("wantlist",b.data[k],function(e){return (e&&(e.artist+"|"+e.title))||"";});return;}
    if(k==="discseen2"){ds=mergeList("discseen2",b.data[k],function(e){return (e&&e.k)||"";});return;}
    if(localStorage.getItem(k)===null){        /* fill gaps only */
      try{localStorage.setItem(k,b.data[k]);filled++;}catch(e){}
    }
  });
  return {ok:true,msg:"Restored "+filled+" cached items"+
    (wl?", "+wl+" wantlist record"+(wl===1?"":"s"):"")+
    (ds?", "+ds+" discovery record"+(ds===1?"":"s"):"")+
    ". Reload to see everything."};
}
(function(){
  var bl=document.getElementById("backuplink"),
      rl=document.getElementById("restorelink"),
      rf=document.getElementById("restorefile");
  if(!bl||!rl||!rf)return;
  bl.addEventListener("click",function(e){e.preventDefault();downloadBackup();});
  rl.addEventListener("click",function(e){e.preventDefault();rf.click();});
  rf.addEventListener("change",function(){
    var f=this.files&&this.files[0];
    if(!f)return;
    var fr=new FileReader();
    fr.onload=function(){
      var r=restoreBackup(String(fr.result));
      var el=document.getElementById("backupmsg");
      if(!el){
        el=document.createElement("p");
        el.id="backupmsg"; el.className="hint";
        rl.parentNode.appendChild(el);
      }
      el.textContent=r.msg;
    };
    fr.readAsText(f);
    this.value="";
  });
})();
