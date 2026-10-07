
const A=Object.getPrototypeOf(async function(){}).constructor;
const s=await new A(load("proxyNode22:fosun:cloudPilotHostStages"))();
const ns="proxyNode22:fosun:",run=load(ns+"refreshCurrentRun"),dir=run+"/relay";
const activeSession=load(ns+"refreshSession"),activeBatch=load(ns+"refreshCurrentBatch");
const assertCurrentScope=()=>{
 if(load(ns+"refreshCurrentRun")!==run||load(ns+"refreshCurrentBatch")!==activeBatch||load(ns+"refreshSession")!==activeSession)throw Error("ORIGINAL_EXEC_MONITOR_SCOPE_CHANGED");
 if(typeof s.assertOwnerScope==='function')s.assertOwnerScope();
};
if(!Number.isSafeInteger(activeSession)||activeSession<1)throw Error("NO_ORIGINAL_EXEC_SESSION");
const leaseKey=ns+"durableMonitorLease:"+run,previous=load(leaseKey);
if(previous?.active)throw Error("ORIGINAL_EXEC_MONITOR_ALREADY_ACTIVE");
if(previous&&(previous.run!==run||previous.originalSessionId!==activeSession||!Number.isFinite(previous.loopStarted)||!Number.isFinite(previous.stopAt)))throw Error("ORIGINAL_EXEC_MONITOR_LEASE_BINDING");
const publicationRequest=load(ns+"cloudPilotPublishRequest");
const publicationOwner=publicationRequest?.requestId?load(ns+"publishMonitorOwner:"+publicationRequest.requestId):null;
if(publicationOwner?.active&&publicationOwner.identity?.run===run&&
 JSON.stringify(s.monitorOwnerIdentity)!==JSON.stringify(publicationOwner.identity))throw Error("ORIGINAL_EXEC_PUBLICATION_OWNER_ACTIVE");
const mode=s.monitorInvocationMode??load(ns+"durableMonitorInvocationMode");
if(!["start","resume"].includes(mode))throw Error("ORIGINAL_EXEC_MONITOR_MODE_REQUIRED");
const generation=(previous?.generation??0)+1;
// This synchronous flag only prevents reentry in the same functions store.
// It is not an atomic cross-isolate/process lock or publisher authority.
const lease={active:true,generation,run,originalSessionId:activeSession};
if(!s.monitorBudgetCheckOnly)store(leaseKey,lease);
let loopStarted,stopAt,budget;
let lastHeartbeat=0,lastStatus=0,lastPoll=0,sequence=0,status={},originalExec={state:"UNKNOWN"};
const iso=()=>new Date().toISOString();
const errorData=(value,seen=new Set())=>{
 if(value===null||typeof value!=="object")return typeof value==="undefined"?null:value;
 if(seen.has(value))return "[Circular]";
 seen.add(value);const out=Array.isArray(value)?[]:{};
 for(const key of Object.getOwnPropertyNames(value))out[key]=errorData(value[key],seen);
 seen.delete(value);return out;
};
const freshness=(record,at=record?.recordedAt??record?.sampledAt??record?.at)=>{
 const when=Date.parse(at),ageMs=Number.isFinite(when)?Date.now()-when:null;
 return {recordedAt:at??null,ageMs,state:!record||!Object.keys(record).length?"MISSING":ageMs===null?"TIMESTAMP_MISSING":ageMs<0?"TIMESTAMP_FUTURE":ageMs>55000?"STALE":"RECENT"};
};
const levels=()=>({
 wrapper:{state:status.process?.event==="CHILD_EXIT"?"TERMINATED":"UNKNOWN",record:status.process??null,freshness:freshness(status.process)},
 supervisor:{state:status.supervisor?"RECEIPT_PRESENT":"UNKNOWN",record:status.supervisor??null},
 observer:{state:status.observer?.status==="TARGET_TREE_EXITED"?"OBSERVED_EXIT":"UNKNOWN",record:status.observer??null,
  lastSample:status.lastSample??null,freshness:freshness(status.lastSample)},
 http:{lastAt:status.lastAt??null,freshness:freshness(status.lastAt?{recordedAt:status.lastAt}:null)},
 durableReadError:status.durableReadError??null
});
const unresolved=(classification,extra={})=>{
 const diagnostic={at:iso(),classification,originalSessionId:activeSession,levels:levels(),originalExec,...extra};
 store(ns+"lastPortableExecPoll",diagnostic);notify(diagnostic);
 text({status:"ORIGINAL_EXEC_UNKNOWN",...diagnostic,outcome:"UNKNOWN",successfulCompletionEligible:false,retryAuthorized:false});
};
const readStatus=async()=>{
 try{return JSON.parse(await s.h.cmd("python3 - "+s.h.q(run)+" <<'PY'\nimport json,pathlib,sys,collections\np=pathlib.Path(sys.argv[1])\ndef lines(n):\n q=p/n\n return [json.loads(x) for x in q.read_text().splitlines() if x] if q.exists() else []\ndef obj(n):\n q=p/n\n return json.loads(q.read_text()) if q.exists() else None\na=lines('diagnostics/process.jsonl');b=lines('diagnostics/http-requests.jsonl');c=lines('memory-observation/samples.jsonl');last=a[-1] if a else {};counts=collections.Counter(x.get('event') for x in b);print(json.dumps({'process':last,'supervisor':obj('cancel-control/terminal.json'),'observer':obj('memory-observation/summary.json'),'lastSample':c[-1] if c else None,'http':dict(counts),'lastAt':b[-1].get('recordedAt') if b else None}))\nPY",4000,Math.min(stopAt,Date.now()+90000)));}
 catch(error){return {durableReadError:{at:iso(),error:errorData(error),message:String(error)}};}
};
try{
 // The original durable wrapper launch is the budget authority, including after
 // store loss. Never synthesize a fresh Date.now()+30min deadline on resume.
 try{
  const budgetPath=run+"/diagnostics/process.jsonl";
  const raw=(await s.h.readFile(budgetPath)).text;
  const starts=raw.split("\n").filter(x=>x.trim()).map(x=>JSON.parse(x)).filter(x=>x.event==="WRAPPER_START");
  if(starts.length!==1)throw Error("ORIGINAL_EXEC_BUDGET_START_MISSING_OR_DUPLICATE");
  const start=starts[0],recordedAt=Date.parse(start.recordedAt);
  // Actual wrapper: outerDeadline=Date.now()+timeoutMs before marker/fsync.
  // marker.recordedAt can be later; it must never become a new budget start.
  stopAt=start.outerDeadline;loopStarted=stopAt-start.timeoutMs;
  if(start.schemaVersion!==1||!Number.isSafeInteger(start.timeoutMs)||start.timeoutMs<1||start.timeoutMs>30*60*1000||
   !Number.isSafeInteger(loopStarted)||!Number.isSafeInteger(stopAt)||!Number.isFinite(recordedAt)||
   recordedAt<loopStarted||recordedAt>Date.now()||loopStarted>Date.now()||
   (start.run!==undefined&&start.run!==run)||
   (previous&&(previous.loopStarted!==loopStarted||previous.stopAt!==stopAt)))throw Error("ORIGINAL_EXEC_BUDGET_INVALID_OR_CHANGED");
  budget={source:budgetPath,loopStarted,stopAt,run,originalSessionId:activeSession};
  if(s.expectedMonitorBudget&&JSON.stringify(budget)!==JSON.stringify(s.expectedMonitorBudget))throw Error("ORIGINAL_EXEC_BUDGET_CHANGED_AFTER_PREFLIGHT");
  Object.assign(lease,{loopStarted,stopAt});
 }catch(error){unresolved("ORIGINAL_EXEC_BUDGET_UNAVAILABLE_NO_PUBLISH",{budgetError:String(error)});return;}
 if(Date.now()>=stopAt){unresolved("ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED",{budget});return;}
 if(s.monitorBudgetCheckOnly){text({status:"MONITOR_BUDGET_VERIFIED",mode,budget});return;}
 store(leaseKey,lease);
 // Evidence names remain distinct after a lost store/generation counter.
 const invocationId=Date.now()+"-"+Math.random().toString(36).slice(2);
 while(Date.now()<stopAt){
  assertCurrentScope();
  let req;try{req=await s.h.next(dir);}catch(error){if(!(Date.now()-loopStarted<60000&&String(error).includes("ENOENT")&&String(error).includes("scandir '"+dir+"'")))throw error;}
  if(Date.now()>=stopAt)break;
  if(req){
   notify({at:iso(),phase:req.kind,requestId:req.requestId,expiresAt:req.expiresAt});
   const out=await s.handle(req,dir);store(ns+"freshLastRelayResult",out);
   notify({at:iso(),phase:req.kind,status:out.status,rowCount:out.rows?.length});
   if(req.kind==="PUBLISH"){text(out);break;}
  }
  if(Date.now()-lastStatus>20000){status=await readStatus();assertCurrentScope();store(ns+"portableCurrentProcessStatus",status);lastStatus=Date.now();}
  // One serialized poll path serves capture and terminal observation. It never
  // stops servicing relay requests to enter a competing terminal-only loop.
  if((!sequence||Date.now()-lastPoll>=20000)&&Date.now()<stopAt){
   assertCurrentScope();
   const startedAt=iso();let poll,pollError;
   try{poll=await tools.write_stdin({session_id:activeSession,chars:"",yield_time_ms:Math.min(1000,stopAt-Date.now()),max_output_tokens:100000});}
   catch(error){pollError={message:String(error),detail:errorData(error)};}
   lastPoll=Date.now();sequence++;
   const evidencePath=run+"/monitor-exec-evidence/monitor-"+generation+"-"+invocationId+"/poll-"+sequence+".json";
   const evidence={schemaVersion:1,run,originalSessionId:activeSession,generation,sequence,startedAt,at:iso(),stopAt,
    ...pollError?{error:pollError}:{raw:poll}};
   // Raw means the complete object returned by the tool, whose stdout may
   // already be truncated by max_output_tokens. Retain it even if saving fails.
   // No classification, running notice, or next poll precedes readback.
   store(ns+"lastPortableExecPollRaw",evidence);
   try{
    const serialized=JSON.stringify(evidence);await s.h.save(evidencePath,evidence);
    const saved=(await s.h.readFile(evidencePath,Math.min(stopAt,Date.now()+90000))).text;
    if(saved!==serialized&&saved!==serialized+"\n")throw Error("MONITOR_POLL_EVIDENCE_READBACK");
   }catch(error){unresolved("ORIGINAL_EXEC_EVIDENCE_UNSAVED_NO_RETRY",{evidencePath,evidenceError:String(error)});return;}
   store(ns+"lastPortableExecPollRaw",{...evidence,evidencePath,evidenceVerified:true});
   // Keep the full original response before rejecting a changed owner scope.
   assertCurrentScope();
   if(pollError){unresolved("ORIGINAL_EXEC_POLL_UNRESOLVED_NO_RETRY",{evidencePath,error:pollError});return;}
   if(!poll||poll.isError||poll.cancelled===true||/unknown|cancel|reject|denied/i.test(String(poll.status??""))){
    unresolved("ORIGINAL_EXEC_TOOL_UNRESOLVED_NO_RETRY",{evidencePath});return;
   }
   if(poll.exit_code!==undefined&&poll.session_id===undefined){
    originalExec={state:"TERMINATED",sessionId:activeSession,exitCode:poll.exit_code,observedAt:evidence.at};
    // The terminal tool response can race the durable writer. Read once after
    // saving it; missing/conflicting wrapper evidence still cannot mean success.
    status=await readStatus();assertCurrentScope();store(ns+"portableCurrentProcessStatus",status);
    if(status.process?.event!=="CHILD_EXIT"||!Number.isInteger(poll.exit_code)||poll.exit_code!==status.process.wrapperExitCode){
     unresolved(status.process?.event!=="CHILD_EXIT"?"DURABLE_WRAPPER_TERMINAL_MISSING":"DURABLE_EXIT_TOOL_EXIT_MISMATCH",{evidencePath,terminalToolPoll:poll});return;
    }
    store(ns+"lastPortableExecPoll",{at:iso(),originalSessionId:activeSession,exit_code:poll.exit_code});
    text({status:"PROCESS_TERMINATED",levels:levels(),originalExec,terminalToolPoll:poll,evidencePath,evidenceVerified:true});return;
   }
   if(poll.session_id!==activeSession||poll.exit_code!==undefined){unresolved("ORIGINAL_EXEC_POLL_SHAPE_UNKNOWN",{evidencePath});return;}
   originalExec={state:"RUNNING_AT_LAST_POLL",sessionId:activeSession,observedAt:evidence.at,evidencePath};
   store(ns+"lastPortableExecPoll",{at:iso(),originalSessionId:activeSession,session_id:activeSession,classification:"ORIGINAL_EXEC_RUNNING",evidencePath});
  }
  if(Date.now()-lastHeartbeat>55000){notify({at:iso(),status:"MONITOR_OBSERVATION",levels:levels(),originalExec});lastHeartbeat=Date.now();}
  if(Date.now()<stopAt)await new Promise(resolve=>setTimeout(resolve,Math.min(1200,stopAt-Date.now())));
 }
 if(Date.now()>=stopAt)unresolved("ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED");
}finally{
 if(!s.monitorBudgetCheckOnly){
  // An unverified placeholder is not a resumable budget. Preserve any earlier
  // verified deadline, or release only this same-store placeholder on failure.
  const verified=Number.isFinite(lease.loopStarted)&&Number.isFinite(lease.stopAt);
  store(leaseKey,verified?{...lease,active:false,finishedAt:iso(),pollCount:sequence}
   :previous?{...previous,active:false,finishedAt:iso(),budgetReadFailed:true}:null);
 }
}
