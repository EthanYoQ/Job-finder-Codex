// Fixed stable outer loader. This source and its embedded binding live outside
// the replaceable deployment. No public caller path, callback, token or status.
const LIFECYCLE_BINDING=__FIXED_LIFECYCLE_BINDING__;
const lifecycleDigest=new Function(__FIXED_SHA256_SOURCE__+'\nreturn responseDigest;')();
const lifecycleCheck=(ok,code)=>{if(!ok)throw Error(code);};
const lifecycleQuote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const lifecycleTools=Object.freeze({exec_command:tools.exec_command,write_stdin:tools.write_stdin,
 apply_patch:tools.apply_patch,mcp__codex_apps__supabase_execute_sql:tools.mcp__codex_apps__supabase_execute_sql,
 mcp__cua_repl__js:tools.mcp__cua_repl__js});
const lifecycleNotify=typeof notify==='function'?notify:null;
let lifecycleRunning=false;
async function runPinnedRound(){
 lifecycleCheck(arguments.length===0,'LIFECYCLE_NO_ARGUMENTS');
 if(LIFECYCLE_BINDING===null)return {status:'DISABLED',reason:'LIFECYCLE_BINDING_UNQUALIFIED',realToolCalls:0,productionQualified:false};
 lifecycleCheck(!lifecycleRunning,'LIFECYCLE_ROUND_IN_FLIGHT');lifecycleRunning=true;
 let session=null,holderId=null,serial=0,buffer='',ended=false,finished=false;
 // Each response is bound to this actual original session and strict sequence.
 const absorb=r=>{
  lifecycleCheck(r&&r.isError!==true&&typeof r.output==='string','LIFECYCLE_TOOL_SHAPE');
  if(r.session_id!==undefined)lifecycleCheck(r.session_id===session,'LIFECYCLE_FOREIGN_SESSION');
  buffer+=r.output.replaceAll('\r\n','\n');
  lifecycleCheck(buffer.length<=1024*1024,'LIFECYCLE_OUTPUT_LIMIT');
  if(r.exit_code!==undefined)ended=true;
  const at=buffer.indexOf('\n');
  if(at<0)return null;
  const raw=buffer.slice(0,at);buffer=buffer.slice(at+1);
  const value=JSON.parse(raw);
  lifecycleCheck(value.kind!=='LIFECYCLE_HOLD','LIFECYCLE_HOLDER_HOLD');
  return value;
 };
 const exchange=async(op,expected,allowExit=false,record=undefined)=>{
  lifecycleCheck(session!==null&&!ended,'LIFECYCLE_HOLDER_LOST');
  const current=++serial;
  let result=await lifecycleTools.write_stdin({session_id:session,chars:JSON.stringify({op,serial:current,...(record===undefined?{}:{record})})+'\n',yield_time_ms:1000,max_output_tokens:20000});
  let response=absorb(result);
  while(response===null&&!ended){result=await lifecycleTools.write_stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000});response=absorb(result);}
  lifecycleCheck(response&&response.kind===expected&&response.serial===current&&response.holderId===holderId,'LIFECYCLE_RESPONSE_BINDING');
  lifecycleCheck(allowExit||!ended,'LIFECYCLE_HOLDER_LOST');
  if(allowExit&&ended)lifecycleCheck(result.exit_code===0,'LIFECYCLE_FINISH_EXIT');
  return response;
 };
 try{
  const b=LIFECYCLE_BINDING;
  lifecycleCheck(b&&/^[a-f0-9]{64}$/.test(b.holderSha256)&&/^[a-f0-9]{64}$/.test(b.entrySha256)&&Number.isSafeInteger(b.entryBytes)&&b.entryBytes>0,'LIFECYCLE_BINDING');
  // Only trusted stable bytes are read here. Candidate reads start in holder
  // after SH + ACTIVE. The trusted binding is embedded, never loaded from BASE.
  const code="import hashlib,os,stat,sys\np="+JSON.stringify(b.holderPath)+"\nfd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)\ns=os.fstat(fd)\nassert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and not s.st_mode&0o022\nwith os.fdopen(fd,'rb') as f:raw=f.read()\nassert hashlib.sha256(raw).hexdigest()=="+JSON.stringify(b.holderSha256)+"\nexec(compile(raw,p,'exec'),{'__name__':'__main__','__file__':p})";
  const first=await lifecycleTools.exec_command({cmd:'/usr/bin/python3 -I -u -c '+lifecycleQuote(code),workdir:b.stableDirectory,tty:true,yield_time_ms:1000,max_output_tokens:20000});
  lifecycleCheck(Number.isSafeInteger(first.session_id)&&first.exit_code===undefined,'LIFECYCLE_ORIGINAL_SESSION');session=first.session_id;
  let ready=absorb(first);
  while(ready===null&&!ended)ready=absorb(await lifecycleTools.write_stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000}));
  if(ready?.kind==='LIFECYCLE_DISABLED_READY'){
   lifecycleCheck(!ended&&ready.serial===0&&/^[a-f0-9]{32}$/.test(ready.holderId)&&ready.entrySha256===b.entrySha256&&ready.entryBytes===b.entryBytes&&/^[a-f0-9]{64}$/.test(ready.disabledSha256),'LIFECYCLE_DISABLED_BINDING');
   holderId=ready.holderId;
   await exchange('ack-disabled','LIFECYCLE_DISABLED_FINISHED',true);
   while(!ended){const r=await lifecycleTools.write_stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000});absorb(r);if(ended)lifecycleCheck(r.exit_code===0,'LIFECYCLE_DISABLED_EXIT');}
   finished=true;return {status:'DISABLED',reason:'COMPLETE_NEVER_ACTIVATED_INSTALL',realToolCalls:0,lifecycle:{state:'DISABLED_INSTALL_VERIFIED',holderId,productionAuthority:false}};
  }
  lifecycleCheck(!ended&&ready?.kind==='LIFECYCLE_READY'&&ready.serial===0&&/^[a-f0-9]{32}$/.test(ready.holderId)&&ready.entrySha256===b.entrySha256&&ready.entryBytes===b.entryBytes,'LIFECYCLE_READY_BINDING');
  holderId=ready.holderId;
  let offset=0,parts=[];
  while(offset<b.entryBytes){const part=await exchange('read','LIFECYCLE_CHUNK');lifecycleCheck(part.offset===offset&&typeof part.text==='string'&&part.text.length>0&&part.text.length<=8192&&/^[\x00-\x7f]*$/.test(part.text)&&part.next===offset+part.text.length&&part.next<=b.entryBytes,'LIFECYCLE_CHUNK');parts.push(part.text);offset=part.next;}
  const bytes=parts.join('');lifecycleCheck(lifecycleDigest(bytes).sha256===b.entrySha256,'LIFECYCLE_ENTRY_PIN');
  // Final same-holder observation before eval. If holder dies immediately after
  // this check ACTIVE still fences all cooperating EX mutation paths.
  await exchange('ping','LIFECYCLE_ALIVE');
  const completedResults=new WeakSet();let sourceIndex=0,sourcePending=null,recordPending=false,releaseDigest=null;
  const assertOriginal=()=>lifecycleCheck(session!==null&&!ended&&!finished&&lifecycleRunning,'LIFECYCLE_ORIGINAL_SCOPE');
  const lifecycleScope=Object.freeze({assertOriginal,
   async sourceStarted(profile,releaseSha256){
    assertOriginal();lifecycleCheck(!recordPending&&sourcePending===null&&profile===['takeda','biogen','hengrui','ucb'][sourceIndex]&&/^[a-f0-9]{64}$/.test(releaseSha256)&&(!releaseDigest||releaseDigest===releaseSha256),'SEQUENCE_START_ORDER');
    releaseDigest=releaseSha256;sourcePending=profile;recordPending=true;
    try{await exchange('source-start','LIFECYCLE_SOURCE_STARTED',false,{profile,releaseSha256});assertOriginal();}finally{recordPending=false;}
   },
   async sourceSettled(profile,releaseSha256,fact){
    assertOriginal();lifecycleCheck(!recordPending&&sourcePending===profile&&profile===['takeda','biogen','hengrui','ucb'][sourceIndex]&&releaseSha256===releaseDigest&&fact&&['VERIFIED','NOT_DUE','KNOWN_NOT_DISPATCHED'].includes(fact.kind),'SEQUENCE_SETTLE_ORDER');recordPending=true;
    try{await exchange('source-settle','LIFECYCLE_SOURCE_SETTLED',false,{profile,releaseSha256,fact});assertOriginal();sourceIndex++;sourcePending=null;}finally{recordPending=false;}
   },
   closeCycle(result){assertOriginal();lifecycleCheck(sourceIndex===4&&sourcePending===null&&!recordPending&&result&&typeof result==='object','SEQUENCE_ALL_ORIGINAL_SOURCES_CLOSED');completedResults.add(result);}
  });
  const entry=new Function('tools','notify','lifecycleScope','Date',bytes)(lifecycleTools,lifecycleNotify,lifecycleScope,Date);
  lifecycleCheck(entry&&Object.keys(entry).join(',')==='runLiveRound'&&typeof entry.runLiveRound==='function','LIFECYCLE_ENTRY_API');
  // This is the actual original returned Promise, never a caller-provided fact.
  const originalRoundPromise=entry.runLiveRound();
  lifecycleCheck(originalRoundPromise instanceof Promise,'LIFECYCLE_ORIGINAL_PROMISE');
  const result=await originalRoundPromise;
  if(!completedResults.has(result)){await exchange('abandon','LIFECYCLE_UNKNOWN',true).catch(()=>{});return result;}
  completedResults.delete(result);
  await exchange('ping','LIFECYCLE_ALIVE');
  await exchange('finish','LIFECYCLE_FINISHED',true);
  // Reap the original holder before reporting that mutation may resume.
  while(!ended){const r=await lifecycleTools.write_stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000});absorb(r);if(ended)lifecycleCheck(r.exit_code===0,'LIFECYCLE_FINISH_EXIT');}
  finished=true;
  return {...result,lifecycle:{state:'ORIGINAL_ROUND_FINISHED',holderId,productionAuthority:false}};
 }finally{
  // Never clear ACTIVE in finally. Lost holder or uncertain operation stays HOLD.
  if(session!==null&&!ended&&!finished){try{await exchange('abandon','LIFECYCLE_UNKNOWN',true);}catch{}}
  lifecycleRunning=false;
 }
}
return Object.freeze({runPinnedRound});
