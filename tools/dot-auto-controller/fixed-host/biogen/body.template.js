// Trusted composition body. Compiled with captured tools and embedded/pinned sources.
// LIVE capability constructors are private and share the original state machines.
// The production build exposes only no-argument runLiveRound; activation is pinned.
// No caller callback, SQL, launch command, config path, token or status is input.
const BASE='__JOBFINDER_FIXED_DEPLOYMENT_ROOT__';
const REPO=BASE+'/runtime-checkout/tools/dot-auto-controller/vendor/c60-source';
const HOST=REPO+'/ops/cloud-pilot-host';
const PROJECT='yiopvxysxrtrnvqxwgbx',SOURCE='source-biogen-china-social';
const shellQuote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const CLI_SCRIPT=BASE+'/candidate/fixed-preimport-launch.py';
const STABLE_CLI_SCRIPT=BASE.slice(0,BASE.lastIndexOf('/'))+'/.'+BASE.slice(BASE.lastIndexOf('/')+1)+'.lifecycle-owner/cli-entry.py';
const cliVerifier="import hashlib,os,stat,sys\np="+JSON.stringify(STABLE_CLI_SCRIPT)+"\nfd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)\ntry:\n s=os.fstat(fd);assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and not s.st_mode&0o022\n with os.fdopen(os.dup(fd),'rb') as f:b=f.read()\n assert hashlib.sha256(b).hexdigest()=="+JSON.stringify(STABLE_CLI_SHA256)+"\nfinally:os.close(fd)\nexec(compile(b,p,'exec'),{'__name__':'__main__','__file__':p})";
const cli=(operation,roundId)=>{check(['prepare','accept-bootstrap','launch','read-projections','record-tool-result','read-publication-data','record-dispatch-data','accept-reconciliation','classify-context','close-no-publication','read-dispatch-state','close-known-not-dispatched'].includes(operation),'FIXED_OPERATION');check(operation==='prepare'?roundId===undefined:/^round-[a-f0-9]{32}$/.test(roundId),'FIXED_ROUND_ID');return 'JOBFINDER_FIXED_LOCAL_MODE='+ACTIVATION.mode+' JOBFINDER_FIXED_DEPLOYMENT_SHA256='+ACTIVATION.deploymentSha256+' /usr/bin/python3 -I -c '+shellQuote(cliVerifier)+' '+shellQuote(operation)+(roundId?' '+shellQuote(roundId):'');};
const AF=Object.getPrototypeOf(async function(){}).constructor;
const own=Object.hasOwn;
const check=(x,code)=>{if(!x)throw Error(code);};
const fixedTools=Object.freeze({exec_command:tools.exec_command,write_stdin:tools.write_stdin,
 apply_patch:tools.apply_patch,mcp__codex_apps__supabase_execute_sql:tools.mcp__codex_apps__supabase_execute_sql,
 mcp__cua_repl__js:tools.mcp__cua_repl__js});
const observationNotify=typeof notify==='function'?notify:null;
const SAFE_ERROR_CODES=new Set(["SOURCE_SEALED", "SOURCE_CLOSE_CAPABILITY_REQUIRED", "SOURCE_ORIGINAL_AUXILIARY_PROMISE", "SOURCE_AUXILIARY_NOT_SETTLED", "SOURCE_ALREADY_CLOSED", "SOURCE_NOT_SEALING", "SOURCE_CYCLE_ALREADY_STARTED", "ACTUAL_CONSUMED_SAME_SESSION_REVIEW", "ACTUAL_FRESH_BOOTSTRAP_LAUNCH", "ADAPTED_IO_PIN", "AUTHORIZATION_INVALID_OR_CONSUMED", "AUTHORIZING", "BATCH_TRANSPORT_FUNCTION_SHAPE", "BATCH_TRANSPORT_SOURCE_HASH", "BOOTSTRAP_DELIMITER", "CALL_UNCERTAIN", "CAPTURED_OFFICIAL_PORT", "CAPTURED_OFFICIAL_TOOL_PORT", "CAPTURE_ADMISSION_BINDING", "CHILD_CLOSED_AWAIT_TOOL", "CHILD_TERMINAL", "COMMITTED", "COMMITTED_EXACT", "COMMITTED_RECEIPT_REQUIRED", "CONSUMED", "CONSUMED_LIVE_REVIEW_REQUIRED", "CONTEXT_PACKET_BINDING", "CONTEXT_SOURCE_BINDING", "CONTEXT_SQL_EXACT", "CONTEXT_UTC", "CRAWL_LEASE_LOST", "DB_RECONCILED_COMMITTED", "DISABLED", "DISABLED_UNQUALIFIED", "DISPATCH_ALREADY_CLAIMED", "DISPATCH_DATA_WX_RECEIPT", "DISPATCH_INTENT_FAILED_OR_UNCERTAIN", "DISPATCH_INTENT_UNCERTAIN", "DISPATCH_UNCERTAIN", "DRAIN_ORIGINAL_HELPER_COMMAND", "EVIDENCE_ARRAY_SHAPE", "EVIDENCE_CYCLE", "EVIDENCE_NON_DATA_VALUE", "EVIDENCE_NUMBER_NOT_FINITE", "EVIDENCE_PROPERTY_DESCRIPTOR", "EVIDENCE_PROTOTYPE", "EVIDENCE_SYMBOL_KEY", "EXACT_PUBLISH_REQUEST", "FAILED", "FAILED_OR_UNCERTAIN", "FAILED_UNKNOWN", "FIXED_ACTIVATION_QUALIFICATION", "FIXED_BINDING_IDENTITY", "FIXED_BOOTSTRAP_ACCEPTED", "FIXED_BOOTSTRAP_QUERY_BINDING", "FIXED_CAPTURE_ADMISSION", "FIXED_CORE_SOURCE_SHA", "FIXED_DEPLOYMENT_QUALIFICATION", "FIXED_DISPATCH_DATA_RECORDED", "FIXED_HELPER_COMMAND_RECEIPT", "FIXED_HOST_CONFIG", "FIXED_HOST_CONFIG_KEYS", "FIXED_INPUT_DELIMITER", "FIXED_LOCAL_FOREIGN_SESSION", "FIXED_LOCAL_RECEIPT", "FIXED_LOCAL_SESSION", "FIXED_NEW_IDENTITY", "FIXED_NO_PUBLICATION_CLOSED", "FIXED_OPERATION", "FIXED_PREFLIGHT", "FIXED_PREFLIGHT_KIND", "FIXED_PREFLIGHT_MODE", "FIXED_PUBLICATION_DATA", "FIXED_ROUND_ID", "FIXED_TOOL_RESULT_RECORDED", "FULFILLED", "GATE_GRANT_BINDING", "HELD", "HOLD", "HOST_COMMAND", "HOST_COMMAND_EXIT_SHAPE", "HOST_COMMAND_FOREIGN_SESSION", "HOST_COMMAND_MISSING_TERMINAL", "HOST_COMMAND_OUTPUT_SHAPE", "HOST_COMMAND_POLL_REJECTED", "HOST_COMMAND_SCOPE", "HOST_COMMAND_SESSION", "HOST_COMMAND_TOOL_SHAPE", "HOST_CONFIG_BINDING", "HOST_CONFIG_REQUIRED", "HOST_DB_STARTED_KIND", "HOST_EXPIRY_RESULT", "HOST_FIXED_ROUND", "HOST_MULTIPLE_PENDING_REQUESTS", "HOST_NEXT_REQUEST_CHANGED", "HOST_PENDING_METADATA", "HOST_READ_CHANGED", "HOST_READ_INCOMPLETE", "HOST_REQUEST_CHANGED", "HOST_RESPONSE_HASH", "HOST_RESPONSE_TOO_LARGE", "HOST_SAVE", "HOST_SAVE_USE_RESPOND", "HOST_SOURCE_ENV", "HOST_SQL_BINDING", "HOST_SQL_RESULT_SHAPE", "HOST_SQL_ROWS_INVALID", "HOST_SQL_ROWS_MISSING", "HOST_SQL_TOOL_ERROR", "INTENT_PENDING", "INVALID_ARGUMENT", "JOBFINDER_BOOTSTRAP_RAW_", "JOBFINDER_FIXED_DATA_", "JOBFINDER_SETTLED_RAW_", "LIVE", "LIVE_DEPLOYMENT", "LIVE_FIXTURE_OR_REGISTRATION_REJECTED", "LIVE_ROUND_VERIFIED", "LIVE_TERMINAL_AUTHORITY_REQUIRED", "LIVE_VERIFIED", "MAY_HAVE_BEEN_INVOKED", "MAY_HAVE_BEEN_RECORDED", "MAY_HAVE_BEEN_SENT", "MISSING", "MISSING_FAILED_OR_IDENTITY_LOST", "MISSING_OR_UNVERIFIED", "NATIVE_PORTABLE_CONNECTOR_V1", "NOT_ATTEMPTED", "NOT_INVOKED", "NOT_WRITTEN_EXPIRED", "NO_PUBLICATION", "NO_PUBLICATION_TERMINAL_RECEIPT", "OBSERVER_SETTLEMENT_FAILED", "OFFICIAL_BOOTSTRAP_EXACT_16_FIELDS", "OFFLINE_REVIEW_ONLY", "OPAQUE_CAPABILITY_BINDING", "ORIGINAL_BOOTSTRAP_AGE", "ORIGINAL_BOOTSTRAP_LAUNCH_AGE", "ORIGINAL_BOOTSTRAP_RECEIPT_BINDING", "ORIGINAL_BOOTSTRAP_SINGLE_ROW", "ORIGINAL_BOOTSTRAP_TIMESTAMP_CHANGED", "ORIGINAL_BOOTSTRAP_TOOL_ERROR", "ORIGINAL_BOOTSTRAP_TOOL_PROMISE", "ORIGINAL_CHILD_NOT_SUCCESSFULLY_TERMINAL", "ORIGINAL_CHILD_TERMINAL", "ORIGINAL_CHILD_TERMINAL_NOT_VERIFIED", "ORIGINAL_DEADLINE_ORDER", "ORIGINAL_DEADLINE_REQUIRED", "ORIGINAL_DISPATCH_DEADLINE_EXPIRED", "ORIGINAL_LIVE_REVIEW_REQUIRED", "ORIGINAL_LIVE_SESSION_REQUIRED", "ORIGINAL_MARK_CLI_ACK", "ORIGINAL_NATIVE_PROMISE_REQUIRED", "ORIGINAL_OBSERVER_DEADLINE_CHECKED", "ORIGINAL_OUTCOME_OBSERVED", "ORIGINAL_OUTER_DEADLINE_EXPIRED", "ORIGINAL_PUBLICATION_DATA_BINDING", "ORIGINAL_PUBLICATION_PENDING_AFTER_SESSION_TERMINAL", "ORIGINAL_PUBLICATION_RESPONSE_DEADLINE_EXPIRED", "ORIGINAL_PUBLICATION_SESSION_NO_LONGER_LIVE", "ORIGINAL_RAW_RECORDED", "ORIGINAL_RAW_WX_RECEIPT", "ORIGINAL_READONLY_RECONCILIATION_RECEIPT", "ORIGINAL_READ_DEADLINE_OBSERVED", "ORIGINAL_READ_OUTCOME_AUTHORITY_REQUIRED", "ORIGINAL_READ_OUTCOME_DEADLINE_EXPIRED", "ORIGINAL_READ_OUTCOME_DEADLINE_OR_IDENTITY", "ORIGINAL_READ_OUTCOME_NOT_TIMELY", "ORIGINAL_READ_OUTCOME_REQUEST_NOT_BOUND", "ORIGINAL_READ_OUTCOME_REQUEST_NOT_VERIFIED", "ORIGINAL_READ_OUTCOME_REQUEST_REQUIRED", "ORIGINAL_READ_OUTCOME_SQL_BINDING", "ORIGINAL_READ_PROMISE", "ORIGINAL_RECOVERY_PROMISE", "ORIGINAL_RECOVERY_TOOL_ERROR", "ORIGINAL_REQUEST_HASH_OR_PROJECT", "ORIGINAL_REQUEST_KEYS", "ORIGINAL_RESPONSE_ACTUAL_BYTES", "ORIGINAL_RESPONSE_CLI_ACK", "ORIGINAL_RESPONSE_PROMISE_REQUIRED", "ORIGINAL_ROUND_STILL_ACTIVE", "ORIGINAL_SESSION_CHANGED", "ORIGINAL_SESSION_DRAINED_BEFORE_PENDING_SERVICE", "ORIGINAL_STARTED", "ORIGINAL_TOOL_DRAINED", "ORIGINAL_TOOL_INVOCATION_NOT_BOUND", "ORIGINAL_TOOL_PROMISE_IDENTITY", "ORIGINAL_TOOL_RAW_SERIALIZATION", "ORIGINAL_UNKNOWN_RECONCILIATION_EARLIEST_FRESH_ROUND", "ORIGINAL_WX_MARKER_BINDING", "OUTCOME_REQUIRES_LIVE_HOST", "OUTCOME_VERIFIED", "OWNED_LIVE_REVIEW", "P0001", "PASS_LIST_AND_SOURCE_TIME_ONLY", "PASS_ORIGINAL_CLI_BATCHED_RESPONSE", "PENDING", "PIPE_ALREADY_STARTED", "PIPE_BUFFER_SIZE", "PIPE_CLOCK", "PIPE_DEADLINE_ORDER", "PIPE_DISPATCH_EXPIRED", "PIPE_FOREIGN_SESSION", "PIPE_FRAME_JSON", "PIPE_FRAME_SIZE", "PIPE_HASH", "PIPE_ID", "PIPE_INTEGRITY_HELD", "PIPE_LAUNCH_BINDING", "PIPE_LIVE_SESSION_REQUIRED", "PIPE_NATURAL_NONZERO_TERMINAL", "PIPE_NOT_DISPATCHABLE", "PIPE_NOT_RAW_STREAM", "PIPE_NO_LIVE_OUTCOME", "PIPE_NO_LIVE_REVIEW", "PIPE_OUTCOME_HASH", "PIPE_OUTCOME_NOT_VERIFIED", "PIPE_OUTCOME_ORDER", "PIPE_OUTCOME_TOOL_MISMATCH", "PIPE_OUTCOME_TUPLE", "PIPE_OUTCOME_TYPE", "PIPE_OUTER_EXPIRED", "PIPE_POLL_STATE", "PIPE_REAL_PORT_DISABLED", "PIPE_RELAY_REQUEST_MISMATCH", "PIPE_REVIEW_ORDER", "PIPE_SCHEMA", "PIPE_SCOPE", "PIPE_SEQUENCE", "PIPE_START_ORDER", "PIPE_TERMINAL", "PIPE_TIME", "PIPE_TOOL_EXIT", "PIPE_TOOL_PORT", "PIPE_TOOL_SHAPE", "PIPE_TYPE", "PIPE_UNKNOWN_EVENT", "PIPE_UNTRUSTED_OUTPUT", "PRODUCER_OUTCOME_VERIFIED_V1", "PRODUCER_REVIEW_CONSUMED_V1", "PROTOCOL_HOLD", "PUBLICATION_NOT_INVOKED", "PUBLIC_TEST_FACTORY_CANNOT_LIVE", "PUBLISH", "PUBLISH_ALREADY_OR_UNCERTAIN", "PUBLISH_REQUEST_REQUIRED", "PUBLISH_STARTED", "READY", "READ_CONTEXT", "READ_CONTEXT_RESULT", "READ_OUTCOME", "READ_OUTCOME_NOT_BOUND", "READ_OUTCOME_NOT_COMMITTED_EXACT", "READ_OUTCOME_NOT_VERIFIED", "READ_OUTCOME_ORDER", "READ_OUTCOME_REQUEST", "READ_PUBLICATION_CONTEXT", "READ_RESPONDED", "READ_SQL_REQUIRED", "READ_UNCERTAIN", "REAL_CONNECTOR_PORT_DISABLED", "RECORDED_EXCLUSIVE", "RECOVERY_BINDING_IDENTITY", "RECOVERY_COMMITTED_HELD_UNTIL_ORIGINAL_DEADLINE", "RECOVERY_COMMITTED_NEXT_PREFLIGHT", "RECOVERY_COMMITTED_RECEIPT", "RECOVERY_DATA_HASHES", "RECOVERY_FRESH_ROUND_ONLY", "RECOVERY_HOLD", "RECOVERY_ORIGINAL_SELECT_ONLY", "RECOVERY_REQUIRED", "REJECTED", "RESPONSE_NOT_CONFIRMED_EXACT", "RESPONSE_PENDING", "RESPONSE_WRITE_FAILED_OR_UNCERTAIN", "RESTART_CANNOT_RECREATE_ORIGINAL_CHILD", "RESTART_LOST_LIVE_AUTHORITY", "RESTORED", "RESTORED_READ_ONLY", "REVIEW_CONSUMED", "REVIEW_OBSERVED", "REVIEW_READY", "ROLLED_BACK", "ROLLED_BACK_EXACT", "SETTLED_ORIGINAL_RAW_REQUIRED", "SKIPPED_NOT_DUE", "STARTED", "STARTING", "SUCCEEDED", "SUPPORTED_TOOL_INTERFACE_REQUIRED", "TAKEDA_PORTABLE_CONNECTOR_V1", "TERMINATED", "TEST_ONLY", "TEST_ONLY_PORT_AND_GATE_REQUIRED", "TEST_ONLY_ROUND_VERIFIED", "TEST_ONLY_SYNTHETIC_PORT", "TEST_ONLY_VERIFIED", "THREW", "TOOL_CALL_THROW_UNKNOWN", "TOOL_ENDED", "TOOL_PENDING", "TOOL_REJECTED_UNKNOWN", "TOOL_RESULT_UNKNOWN", "TRUSTED_SYNTHETIC_TOOL_PORT", "UI_COMMITTED_RECEIPT_BINDING", "UI_MEMBER_UNIQUE", "UI_PROJECTION_RECEIPT_HASH", "UI_PROJECTION_SET", "UNCERTAIN", "UNKNOWN", "UNKNOWN_HOST_ERROR", "UNVERIFIED", "VERIFIED_SUCCESS", "VISIBLE", "WAITING_ORIGINAL_EVIDENCE", "WRITE_FAILED_OR_UNCERTAIN", "WRITE_PENDING", "WRITE_UNCERTAIN", "WRITTEN_EXACT", "WRITTEN_EXACT_LATE"]);
const safeErrorCode=e=>{try{const m=String(e?.message??e).match(/^(?:Error: )?([A-Z][A-Z0-9_]{2,100})(?::|$)/),c=m?.[1];return SAFE_ERROR_CODES.has(c)?c:'UNKNOWN_HOST_ERROR';}catch{return 'UNKNOWN_HOST_ERROR';}};
const pause=()=>new Promise(resolve=>setTimeout(resolve,1));
const sha=s=>responseDigest(s).sha256;
const checkedSources=()=>{
 for(const [name,s] of Object.entries(SOURCES))check(sha(s)===PINS[name],'FIXED_SOURCE_SHA:'+name);
 check(sha(OBSERVER_CORE_SOURCE)===OBSERVER_CORE_SHA256&&sha(PIPE_CORE_SOURCE)===PIPE_CORE_SHA256,'FIXED_CORE_SOURCE_SHA');
 const pipe=PipeCoreScope.publicTest,observer=ObserverCoreScope.publicTest,ui=new Function('return (\n'+SOURCES.ui+'\n);')();
 return {pipe,observer,ui};
};
async function local(cmd,commandTools=fixedTools){let r=await commandTools.exec_command({cmd,workdir:BASE,max_output_tokens:100000,yield_time_ms:1000}),output=r.output;const localSession=r.session_id;if(localSession!==undefined){check(Number.isSafeInteger(localSession),'FIXED_LOCAL_SESSION');while(r.exit_code===undefined){r=await commandTools.write_stdin({session_id:localSession,chars:'',max_output_tokens:100000,yield_time_ms:1000});check(r.session_id===undefined||r.session_id===localSession,'FIXED_LOCAL_FOREIGN_SESSION');output+=r.output;}}check(r.exit_code===0,'FIXED_LOCAL_RECEIPT');return JSON.parse(output);}
const data=x=>JSON.parse(JSON.stringify(x));
const deepFreeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}return x;};
const inputCommand=(cmd,value)=>{const input=JSON.stringify(value)+'\n',delimiter='JOBFINDER_FIXED_DATA_'+sha(input);check(!input.includes('\n'+delimiter+'\n'),'FIXED_INPUT_DELIMITER');return cmd+" <<'"+delimiter+"'\n"+input+delimiter;};
const localInput=(cmd,value)=>local(inputCommand(cmd,value));
const original=r=>{const {expired,dispatchRecorded,...request}=r;check(Object.keys(request).sort().join(',')==='expiresAt,kind,payload,requestId,requestSha256,schemaVersion','ORIGINAL_REQUEST_KEYS');const {requestSha256,...body}=request;check(request.schemaVersion===1&&sha(JSON.stringify(body))===requestSha256&&request.payload.projectId===PROJECT,'ORIGINAL_REQUEST_HASH_OR_PROJECT');return request;};
const responseBytes=(r,result)=>JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,result});
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
// Private lexical authority. Neither a reported status nor serialized receipt is
// a close capability. A factory without an owning cycle issues no capability.
const sourceCycleIdentity=typeof sourceCycle==='undefined'?null:sourceCycle;
const closedSourceResults=new WeakMap();
function consumeClosedSource(result,expectedCycle){
 const authority=closedSourceResults.get(result);
 check(sourceCycleIdentity!==null&&typeof sourceCycleIdentity==='object'&&expectedCycle===sourceCycleIdentity&&authority?.cycle===sourceCycleIdentity,'SOURCE_CLOSE_CAPABILITY_REQUIRED');
 closedSourceResults.delete(result);
 return authority.fact;
}
function createSourceSeal(){
 let state='RUNNING',uncertain=false;
 const promises=new Set(),sessions=new Set();
 const running=()=>check(state==='RUNNING','SOURCE_SEALED');
 const settling=()=>check(state==='RUNNING'||state==='SEALING','SOURCE_ALREADY_CLOSED');
 const observeCommand=(receipt,expectedSession)=>{
  if(!receipt||typeof receipt!=='object'||receipt.isError===true){uncertain=true;return;}
  const id=receipt.session_id;
  if(expectedSession!==undefined&&id!==undefined&&id!==expectedSession)uncertain=true;
  if(id!==undefined){if(!Number.isSafeInteger(id)||id<=0)uncertain=true;else sessions.add(id);}
  if(receipt.exit_code!==undefined){
   if(!Number.isInteger(receipt.exit_code))uncertain=true;
   else {if(expectedSession!==undefined)sessions.delete(expectedSession);if(id!==undefined)sessions.delete(id);}
  }else if(id===undefined&&expectedSession===undefined)uncertain=true;
 };
 const track=(invoke,receiptObserver)=>{
  settling();let promise;
  try{promise=invoke();}catch(e){uncertain=true;throw e;}
  if(!(promise instanceof Promise)){uncertain=true;throw Error('SOURCE_ORIGINAL_AUXILIARY_PROMISE');}
  promises.add(promise);
  return promise.then(value=>{settling();receiptObserver?.(value);return value;},error=>{uncertain=true;throw error;}).finally(()=>promises.delete(promise));
 };
 return Object.freeze({running,settling,track,observeCommand,
  get state(){return state;},get settled(){return promises.size===0&&sessions.size===0&&!uncertain;},
  seal(){if(state==='RUNNING')state='SEALING';else check(state==='SEALING','SOURCE_ALREADY_CLOSED');},
  finish(safe){check(state==='SEALING','SOURCE_NOT_SEALING');check(!safe||(promises.size===0&&sessions.size===0&&!uncertain),'SOURCE_AUXILIARY_NOT_SETTLED');state=safe?'SAFELY_CLOSED':'GLOBAL_HOLD';},
  abandon(){if(state!=='SAFELY_CLOSED')state='GLOBAL_HOLD';}
 });
}
let roundInFlight=false,sourceRoundIssued=false;
async function runFixedRound(){
 check(!roundInFlight,'ORIGINAL_ROUND_STILL_ACTIVE');
 if(sourceCycleIdentity!==null){check(typeof sourceCycleIdentity==='object'&&!sourceRoundIssued,'SOURCE_CYCLE_ALREADY_STARTED');sourceRoundIssued=true;}
 roundInFlight=true;
 try{return await executeFixedRound();}finally{roundInFlight=false;}
}
async function executeFixedRound(){
 const sourceSeal=createSourceSeal();
 let sourceRoundId=null,sourceConfig=null;
 // All helper awaits use this original-command tracker. After sealing, only
 // fixed read-only inspection and durable audit/close commands may start.
 // Existing commands are drained unchanged; their final receipts may still be
 // consumed as evidence, but cannot open another response/dispatch continuation.
 const sealingCommandAllowed=cmd=>{
  if(typeof cmd!=='string')return false;
  if(sourceConfig!==null){
   const prefix='JOBFINDER_CONNECTOR_HOST_SHA256='+shellQuote(sourceConfig.bindingSha256)+' JOBFINDER_CLOUD_SOURCE_ID='+shellQuote(SOURCE)+' JOBFINDER_CONNECTOR_ROUND_ID='+shellQuote(sourceRoundId)+' /usr/bin/python3 -I '+shellQuote(sourceConfig.root+'/connector-host-launch.py')+' ';
   if(['connector-read','connector-context'].some(op=>cmd.startsWith(prefix+shellQuote('host-files.mts')+' '+op+' '))||cmd===prefix+shellQuote('host-files.mts')+' connector-validate'||cmd.startsWith(prefix+shellQuote('relay-files.mjs')+' next-meta '))return true;
  }
  return sourceRoundId!==null&&['read-projections','record-tool-result','read-publication-data','classify-context','close-no-publication','read-dispatch-state','close-known-not-dispatched'].some(op=>{const prefix=cli(op,sourceRoundId);return cmd===prefix||cmd.startsWith(prefix+" <<'");});
 };
 const commandTools=Object.freeze({...fixedTools,
  exec_command(args){sourceSeal.settling();if(sourceSeal.state!=='RUNNING')check(sealingCommandAllowed(args?.cmd),'SOURCE_SEALED');return sourceSeal.track(()=>fixedTools.exec_command(args),r=>sourceSeal.observeCommand(r));},
  write_stdin(args){return sourceSeal.track(()=>fixedTools.write_stdin(args),r=>sourceSeal.observeCommand(r,args.session_id));},
  apply_patch(patch){sourceSeal.running();return sourceSeal.track(()=>fixedTools.apply_patch(patch),r=>{check(r?.isError!==true,'HOST_SAVE');});}
 });
 const sourceLocal=cmd=>local(cmd,commandTools),sourceLocalInput=(cmd,value)=>sourceLocal(inputCommand(cmd,value));
 try{
 const mode=ACTIVATION.mode,isLive=mode==='LIVE';
 check(['LIVE','TEST_ONLY'].includes(mode)&&/^[a-f0-9]{64}$/.test(ACTIVATION.deploymentSha256),'FIXED_ACTIVATION_QUALIFICATION');
 check(Object.values(fixedTools).every(v=>typeof v==='function'),'SUPPORTED_TOOL_INTERFACE_REQUIRED');
 const {pipe,observer:ob,ui}=checkedSources();
 const compileOriginalReadOutcome=new Function('tuple',READ_OUTCOME_COMPILER);
 // Preflight output is data. The fixed pinned program owns source/runtime/deps
 // qualification and creates a fresh challenge/config before starting a child.
 let prepared=await sourceLocal(cli('prepare'));
 if(prepared.kind==='DISABLED_UNQUALIFIED')return {status:'DISABLED_UNQUALIFIED',productionQualified:false};
 let reconciliation=null;
 const validatePrepared=p=>{
  check(p&&p.mode===mode,'FIXED_PREFLIGHT_MODE');
  const roundId=p.roundId;check(/^round-[a-f0-9]{32}$/.test(roundId),'FIXED_ROUND_ID');
  const seed=pipe.validateLaunchSeed(p.seed),cfg=deepFreeze(data(p.cfg));
  check(seed.projectId===PROJECT&&seed.sourceId===SOURCE&&seed.candidateId===DEPLOYMENT.expectedRow.id&&seed.batchId==='fixed-v4-'+roundId.slice(6),'FIXED_NEW_IDENTITY');
  check(cfg.repo===REPO&&cfg.root===HOST&&cfg.project===PROJECT&&cfg.sourceId===SOURCE&&cfg.mode==='NATIVE_PORTABLE_CONNECTOR_V1'&&cfg.roundId===roundId&&cfg.taskRoot===BASE+'/rounds/'+roundId+'/connector-host-task'&&cfg.relayDirectory===cfg.taskRoot+'/relay'&&/^[a-f0-9]{64}$/.test(cfg.bindingSha256),'FIXED_HOST_CONFIG');
  check(Object.keys(cfg).sort().join(',')==='bindingSha256,mode,project,relayDirectory,repo,root,roundId,sourceId,taskRoot','FIXED_HOST_CONFIG_KEYS');
  return {seed,cfg,roundId};
 };
 const makeHelper=async cfg=>{
  const stateStore=new Map([['cloudPilotHostConfig',cfg],['cloudPilotBatchedReadTransport',ADAPTED_TRANSPORT]]);
  check(sha(ADAPTED_HELPER)===ADAPTED_HELPER_SHA256&&sha(ADAPTED_TRANSPORT)===ADAPTED_TRANSPORT_SHA256,'ADAPTED_IO_PIN');
  return new AF('tools','load','store','notify',ADAPTED_HELPER)(commandTools,key=>stateStore.get(key),(key,v)=>stateStore.set(key,v),observationNotify);
 };
 if(prepared.kind==='RECOVERY_REQUIRED'){
  const old=validatePrepared(prepared),oldTuple={releaseCandidateId:old.seed.candidateId,batchId:old.seed.batchId,sourceId:SOURCE,sourceResultId:old.seed.batchId+'--'+SOURCE};
  check(ob.equalEvidenceData(prepared.originalTuple,oldTuple)&&prepared.readQuery===compileOriginalReadOutcome(oldTuple)&&prepared.querySha256===sha(prepared.readQuery),'RECOVERY_ORIGINAL_SELECT_ONLY');
  check(['requestSha256','sqlSha256','recoveryDataSha256'].every(k=>/^[a-f0-9]{64}$/.test(prepared[k]))&&typeof prepared.originalPublishExpiresAt==='string'&&Number.isFinite(Date.parse(prepared.originalPublishExpiresAt)),'RECOVERY_DATA_HASHES');
  const oldHelper=await makeHelper(old.cfg),oldBinding=await oldHelper.binding();check(oldBinding.relayDirectory===old.cfg.relayDirectory&&oldBinding.candidateId===old.seed.candidateId&&oldBinding.buildContentSha256===old.seed.buildSha256,'RECOVERY_BINDING_IDENTITY');
  const rawPromise=fixedTools.mcp__codex_apps__supabase_execute_sql({project_id:PROJECT,query:prepared.readQuery});check(rawPromise instanceof Promise,'ORIGINAL_RECOVERY_PROMISE');
  const raw=await rawPromise;check(raw&&raw.isError!==true,'ORIGINAL_RECOVERY_TOOL_ERROR');oldHelper.rows(raw);
  const rawBytes=JSON.stringify(raw)+'\n',record={schemaVersion:1,roundId:old.roundId,querySha256:prepared.querySha256,rawSha256:sha(rawBytes),rawBytes,requestId:prepared.requestId,requestSha256:prepared.requestSha256,recoveryDataSha256:prepared.recoveryDataSha256};
  const recovered=await sourceLocalInput(cli('accept-reconciliation',old.roundId),record);
  const previous=recovered.previous;check(previous&&previous.schemaVersion===1&&previous.roundId===old.roundId&&previous.requestId===record.requestId&&previous.requestSha256===record.requestSha256&&previous.querySha256===record.querySha256&&previous.rawSha256===record.rawSha256&&previous.recoveryDataSha256===record.recoveryDataSha256&&previous.originalPublishExpiresAt===prepared.originalPublishExpiresAt&&previous.ui==='UNVERIFIED'&&previous.oldLaunchPermitRestored===false&&previous.oldPublicationPermitRestored===false&&previous.oldIpcRestored===false&&previous.actualObservationCrawledAtRead===false&&(recovered.kind==='RECOVERY_HOLD'?recovered.publicationCalls===0:recovered.oldPublicationCalls===0),'ORIGINAL_READONLY_RECONCILIATION_RECEIPT');
  if(recovered.kind==='RECOVERY_HOLD')return {status:'HOLD',databaseStatus:'UNKNOWN',sourceHeld:true,newBatchAllowed:false,reconciliation:recovered,productionQualified:false};
  check(previous.databaseStatus==='DB_RECONCILED_COMMITTED','RECOVERY_COMMITTED_RECEIPT');
  if(recovered.kind==='RECOVERY_COMMITTED_HELD_UNTIL_ORIGINAL_DEADLINE')return {status:'HOLD',databaseStatus:'DB_RECONCILED_COMMITTED',observationDueCheckPending:true,ui:'UNVERIFIED',originalLiveAuthorityRestored:false,sourceHeld:true,newBatchAllowed:false,newRoundCreated:false,originalPublishExpiresAt:prepared.originalPublishExpiresAt,rawSha256:record.rawSha256,productionQualified:false};
  check(Date.now()>=Date.parse(prepared.originalPublishExpiresAt),'ORIGINAL_UNKNOWN_RECONCILIATION_EARLIEST_FRESH_ROUND');
  check(recovered.kind==='RECOVERY_COMMITTED_NEXT_PREFLIGHT'&&recovered.next?.roundId!==old.roundId,'RECOVERY_FRESH_ROUND_ONLY');reconciliation={roundId:old.roundId,status:'DB_RECONCILED_COMMITTED',observationDueCheckPending:true,ui:'UNVERIFIED',originalLiveAuthorityRestored:false,rawSha256:record.rawSha256};prepared=recovered.next;
 }
 check(prepared.kind==='FIXED_PREFLIGHT','FIXED_PREFLIGHT_KIND');
 const {seed,cfg,roundId}=validatePrepared(prepared);sourceRoundId=roundId;sourceConfig=cfg;
 check(prepared.qualification?.configSha256===ACTIVATION.deploymentSha256&&prepared.qualification.expectedRowSha256===sha(canonical(DEPLOYMENT.expectedRow)),'FIXED_DEPLOYMENT_QUALIFICATION');
 const h=await makeHelper(cfg),b=await h.binding(),dir=cfg.relayDirectory;
 check(b.relayDirectory===dir&&b.candidateId===seed.candidateId&&b.buildContentSha256===seed.buildSha256,'FIXED_BINDING_IDENTITY');
 const ACCEPT_BOOTSTRAP=cli('accept-bootstrap',roundId),PROJECTIONS=cli('read-projections',roundId),RECORD_TOOL=cli('record-tool-result',roundId);
 const bootstrap=prepared.bootstrap;
 check(bootstrap&&bootstrap.projectId===PROJECT&&bootstrap.query===BOOTSTRAP_SQL&&bootstrap.querySha256===sha(bootstrap.query),'FIXED_BOOTSTRAP_QUERY_BINDING');
 const rawBootstrapPromise=fixedTools.mcp__codex_apps__supabase_execute_sql({project_id:PROJECT,query:bootstrap.query});
 check(rawBootstrapPromise instanceof Promise,'ORIGINAL_BOOTSTRAP_TOOL_PROMISE');
 const bootstrapRaw=await rawBootstrapPromise;
 check(bootstrapRaw&&bootstrapRaw.isError!==true,'ORIGINAL_BOOTSTRAP_TOOL_ERROR');
 // JSON serializes embedded newlines; the only literal newline is ours. No raw
 // tool text is executable shell or Python. The fixed CLI decodes the original
 // envelope and validates the exact registered candidate row before wx writes.
 const bootstrapRows=h.rows(bootstrapRaw);check(bootstrapRows.length===1&&typeof bootstrapRows[0].checkedAt==='string','ORIGINAL_BOOTSTRAP_SINGLE_ROW');
 check(bootstrapRows[0].candidate&&Object.keys(DEPLOYMENT.expectedRow).length===16&&Object.keys(DEPLOYMENT.expectedRow).every(k=>ob.equalEvidenceData(bootstrapRows[0].candidate[k],DEPLOYMENT.expectedRow[k])),'OFFICIAL_BOOTSTRAP_EXACT_16_FIELDS');
 check(!isLive||(DEPLOYMENT.fixturePreloadSha256===null&&prepared.qualification.kind==='LIVE_DEPLOYMENT'&&DEPLOYMENT.kind==='LIVE_DEPLOYMENT'),'LIVE_FIXTURE_OR_REGISTRATION_REJECTED');
 const rawText=JSON.stringify(bootstrapRaw)+'\n',rawSha256=sha(rawText);
 const delimiter='JOBFINDER_BOOTSTRAP_RAW_'+rawSha256;
 check(!rawText.includes('\n'+delimiter+'\n'),'BOOTSTRAP_DELIMITER');
 const accepted=await sourceLocal(ACCEPT_BOOTSTRAP+" <<'"+delimiter+"'\n"+rawText+delimiter);
 check(accepted.kind==='FIXED_BOOTSTRAP_ACCEPTED'&&accepted.requestSha256===bootstrap.querySha256&&accepted.rawSha256===rawSha256&&ob.equalEvidenceData(accepted.seed,seed)&&ob.equalEvidenceData(accepted.cfg,cfg)&&/^[a-f0-9]{64}$/.test(accepted.bootstrapSha256),'ORIGINAL_BOOTSTRAP_RECEIPT_BINDING');
 check(accepted.checkedAt===bootstrapRows[0].checkedAt,'ORIGINAL_BOOTSTRAP_TIMESTAMP_CHANGED');
 const bootstrapCheckedAt=Date.parse(accepted.checkedAt);
 check(Number.isSafeInteger(bootstrapCheckedAt)&&Date.now()>=bootstrapCheckedAt&&Date.now()-bootstrapCheckedAt<50000,'ORIGINAL_BOOTSTRAP_AGE');
 let session=null,actualTerminal=null,observer=null,publishRequest=null,readRequest=null,readAck=null,uiResult=null;
 const launchExpectation=deepFreeze({schemaVersion:1,roundId,seed,cfg,bindingSha256:cfg.bindingSha256,querySha256:bootstrap.querySha256,rawSha256,bootstrapSha256:accepted.bootstrapSha256,checkedAt:accepted.checkedAt});
 const LAUNCH=inputCommand(cli('launch',roundId),launchExpectation);
 let pendingPublish=null,rawEvidenceTask=null,rawEvidenceReceipt=null,serviceDone=false,held=false,outcomeAccepted=false,outcomeObservedAt=null,terminalObservedAt=null,notDueCandidate=null,publicationPathSeen=false;
 let hostStage='LAUNCH',publicationCallCount=0;const pollCounts={calls:0,receipts:0,nonemptyChunks:0,outputChars:0};
 const notifiedHolds=new Set();
 const errors=[],events=[],seen=new Set(),reviews=new WeakMap(),outcomes=new WeakMap(),terminals=new WeakMap();
 const event=(kind,extra={})=>events.push({kind,at:Date.now(),...extra});
 const safeObservation=(kind,code=null)=>{try{let s;try{s=consumer.snapshot();}catch{s={};}const os=observer?.snapshot();const fact={kind,code,stage:hostStage,sourceState:sourceSeal.state,observedAt:Date.now(),roundId,originalSessionId:Number.isSafeInteger(session)?session:null,requestSha256:publishRequest?.requestSha256??null,childEnded:s.childEnded??null,toolEnded:s.toolEnded??null,pendingFrame:s.pendingFrame??null,pipeHeld:s.held??null,integrityHeld:s.integrityHeld??null,pipeStatus:s.status??null,sequence:s.sequence??null,publicationCalls:publicationCallCount,hasOriginalPublicationPromise:pendingPublish instanceof Promise,publicationSettled:!!observer?.rawToolFact,databaseStatus:os?.status??'NO_PUBLICATION',intent:os?.intent??null,tool:os?.tool??null,faults:(os?.faults??[]).map(c=>SAFE_ERROR_CODES.has(c)?c:'UNKNOWN_HOST_ERROR'),polls:{...pollCounts}};events.push(fact);observationNotify?.(fact);}catch{}};
 const setHostStage=stage=>{if(hostStage!==stage){hostStage=stage;safeObservation('FIXED_HOST_PHASE');}};
 const hold=e=>{held=true;errors.push(String(e?.message??e));event('HOLD',{code:String(e?.message??e)});const code=safeErrorCode(e);if(!notifiedHolds.has(code)){notifiedHolds.add(code);safeObservation('FIXED_HOST_HOLD',code);}};
 const issue=(map,fact)=>{const key=Object.freeze({});map.set(key,deepFreeze(fact));return key;};
 const accept=map=>({accept(key,expected){const f=map.get(key);check(f&&ob.equalEvidenceData(f.expected,expected),'OPAQUE_CAPABILITY_BINDING');map.delete(key);return f;}});
 const toolsPort=Object.freeze({kind:isLive?'CAPTURED_OFFICIAL_TOOL_PORT':'TRUSTED_SYNTHETIC_TOOL_PORT',async launch(){sourceSeal.running();check(Date.now()>=bootstrapCheckedAt&&Date.now()-bootstrapCheckedAt<60000,'ORIGINAL_BOOTSTRAP_LAUNCH_AGE');const r=await fixedTools.exec_command({cmd:LAUNCH,workdir:BASE,max_output_tokens:20000,yield_time_ms:1000});check(Number.isSafeInteger(r.session_id),'ORIGINAL_LIVE_SESSION_REQUIRED');session=r.session_id;if(r.exit_code!==undefined){actualTerminal=r;terminalObservedAt=Date.now();}sourceSeal.running();return r;},async poll(id){pollCounts.calls++;check(id===session,'ORIGINAL_SESSION_CHANGED');const r=await fixedTools.write_stdin({session_id:id,chars:'',max_output_tokens:20000,yield_time_ms:1000});pollCounts.receipts++;if(typeof r.output==='string'&&r.output.length){pollCounts.nonemptyChunks++;pollCounts.outputChars+=r.output.length;}if(r.session_id!==undefined)check(r.session_id===session,'ORIGINAL_SESSION_CHANGED');if(r.exit_code!==undefined){actualTerminal=r;terminalObservedAt=Date.now();sourceSeal.seal();serviceDone=true;}return r;}});
 const launchPermit=Object.freeze({});
 if(isLive)liveLaunchPermits.set(launchPermit,deepFreeze({kind:'ACTUAL_FRESH_BOOTSTRAP_LAUNCH',seed,checkedAt:bootstrapCheckedAt,port:toolsPort,expectation:launchExpectation}));
 const consumer=isLive?createLiveConsumer(launchPermit):pipe.createOwnedSessionConsumer({launch:seed,toolsPort,mode:'TEST_ONLY',clock:()=>Date.now()});
 const tuple=()=>({releaseCandidateId:seed.candidateId,batchId:seed.batchId,sourceId:seed.sourceId,sourceResultId:seed.batchId+'--'+seed.sourceId});
 const expected=()=>({requestId:publishRequest.requestId,requestSha256:publishRequest.requestSha256,tuple:tuple(),outerDeadline:consumer.snapshot().outerDeadline});
 async function mark(r){
  // The original command makes the sole requestId.dispatch.json wx marker.
  // Its nonzero exit is fatal; a missing/late result never creates retry rights.
  sourceSeal.running();const ack=await h.mark(r,dir);sourceSeal.running();
  check(ack?.marked===true&&ack.requestId===r.requestId,'ORIGINAL_MARK_CLI_ACK');
  const file=await h.readFile(dir+'/'+r.requestId+'.dispatch.json');sourceSeal.running();const m=JSON.parse(file.text);
  check(sha(file.text)===file.hash&&m.schemaVersion===1&&m.requestId===r.requestId&&m.requestSha256===r.requestSha256&&m.kind===r.kind&&m.state==='MAY_HAVE_BEEN_SENT','ORIGINAL_WX_MARKER_BINDING');
  return {marked:true,exclusive:true,requestId:r.requestId,requestSha256:r.requestSha256};
 }
 async function respond(r,result){
  sourceSeal.running();const ack=await h.respond(r,dir,result);sourceSeal.settling();
  check(r.kind==='PUBLISH'?(ack?.written===true&&ack.requestId===r.requestId&&ack.kind===r.kind):(ack?.status==='PASS_ORIGINAL_CLI_BATCHED_RESPONSE'&&ack.requestId===r.requestId&&ack.kind===r.kind),'ORIGINAL_RESPONSE_CLI_ACK');
  const bytes=responseBytes(r,result),file=await h.readFile(dir+'/'+r.requestId+'.response.json');
  sourceSeal.settling();check(file.text===bytes&&file.hash===sha(bytes),'ORIGINAL_RESPONSE_ACTUAL_BYTES');
  return {written:true,exclusive:true,requestId:r.requestId,requestSha256:r.requestSha256,result,bytes,sha256:sha(bytes)};
 }
 const canObserveOriginalOutcome=(allowTerminal=false)=>{const s=consumer.snapshot();return !!observer&&!!publishRequest&&Number.isSafeInteger(session)&&s.consumed&&!s.held&&!s.pendingFrame&&(allowTerminal||(!s.childEnded&&!s.toolEnded));};
 async function observeOutcome(){
  if(outcomeAccepted||!readAck||!consumer.snapshot().outcomeSeen)return;
  check(readRequest&&canObserveOriginalOutcome(true),'OUTCOME_REQUIRES_LIVE_HOST');
  const bound={type:'PRODUCER_OUTCOME_VERIFIED_V1',tuple:tuple(),readRequestSha256:readRequest.requestSha256,responseSha256:readAck.sha256};
  consumer.acceptExpectedOutcome(bound);consumer.consumeOutcome();outcomeAccepted=true;outcomeObservedAt=Date.now();
  await observer.observeReadOutcome(issue(outcomes,{kind:'READ_OUTCOME',expected:expected(),state:'COMMITTED_EXACT',observedAt:outcomeObservedAt,originalRequest:readRequest}));
  event('ORIGINAL_OUTCOME_OBSERVED',{observedAt:outcomeObservedAt,committedExact:observer.snapshot().outcome==='COMMITTED_EXACT'});
 }
 async function publish(r){
  sourceSeal.running();check(!publishRequest&&!held&&!r.expired&&!r.dispatchRecorded,'PUBLISH_ALREADY_OR_UNCERTAIN');
  setHostStage('WAIT_OWNED_REVIEW');publicationPathSeen=true;publishRequest=deepFreeze(original(r));
  while(!consumer.snapshot().reviewSeen&&!consumer.snapshot().toolEnded&&!consumer.snapshot().held){sourceSeal.running();await pause();sourceSeal.running();}
  const s=consumer.snapshot();check(s.reviewSeen&&!s.held&&!s.toolEnded,'ORIGINAL_LIVE_REVIEW_REQUIRED');
  consumer.acceptExpectedRequest({...seed,outerDeadline:s.outerDeadline,sourceResultId:tuple().sourceResultId,requestId:publishRequest.requestId,requestSha256:publishRequest.requestSha256,sqlSha256:sha(publishRequest.payload.sql),dispatchBefore:Date.parse(publishRequest.payload.dispatchBefore),expiresAt:Date.parse(publishRequest.expiresAt)});
  sourceSeal.running();const grant=consumer.consumeReview();
  const token=issue(reviews,{mode:isLive?'OWNED_LIVE_REVIEW':'OFFLINE_REVIEW_ONLY',request:publishRequest,dispatchBefore:grant.dispatchBefore,expiresAt:grant.expiresAt,outerDeadline:grant.outerDeadline,tuple:tuple()});
  setHostStage('READ_PUBLICATION_DATA');safeObservation('ORIGINAL_REVIEW_CONSUMED');
  sourceSeal.running();const recoveryData=await sourceLocal(cli('read-publication-data',roundId));sourceSeal.running();
  check(recoveryData.kind==='FIXED_PUBLICATION_DATA'&&recoveryData.originalPublishExpiresAt===publishRequest.expiresAt&&recoveryData.roundId===roundId&&ob.equalEvidenceData(recoveryData.seed,seed)&&ob.equalEvidenceData(recoveryData.originalTuple,tuple())&&/^[a-f0-9]{64}$/.test(recoveryData.receiptSha256)&&recoveryData.requestId===publishRequest.requestId&&recoveryData.requestSha256===publishRequest.requestSha256&&recoveryData.sqlSha256===sha(publishRequest.payload.sql)&&/^[a-f0-9]{64}$/.test(recoveryData.recoveryDataSha256),'ORIGINAL_PUBLICATION_DATA_BINDING');
  setHostStage('RECORD_DISPATCH_DATA');
  sourceSeal.running();const recorded=await sourceLocalInput(cli('record-dispatch-data',roundId),{schemaVersion:1,roundId,seed,requestId:publishRequest.requestId,requestSha256:publishRequest.requestSha256,sqlSha256:sha(publishRequest.payload.sql),recoveryDataSha256:recoveryData.recoveryDataSha256});
  sourceSeal.running();check(recorded.kind==='FIXED_DISPATCH_DATA_RECORDED'&&recorded.roundId===roundId&&recorded.requestId===publishRequest.requestId&&recorded.requestSha256===publishRequest.requestSha256&&recorded.sqlSha256===sha(publishRequest.payload.sql)&&recorded.grantsAuthority===false&&recorded.recoveryDataSha256===recoveryData.recoveryDataSha256,'DISPATCH_DATA_WX_RECEIPT');
  const observerOptions={request:publishRequest,authorization:token,mode:'TEST_ONLY',now:()=>Date.now(),schedule:(callback,delay)=>setTimeout(()=>{callback();safeObservation('ORIGINAL_OBSERVER_DEADLINE_CHECKED');},delay),cancel:clearTimeout,
   consumeAuthorization(key,r){sourceSeal.running();const g=reviews.get(key);check(g&&ob.equalEvidenceData(g.request,r),'CONSUMED_LIVE_REVIEW_REQUIRED');reviews.delete(key);return g;},
   originalTerminalAuthority:accept(terminals),readOutcomeAuthority:accept(outcomes),
  };
  const assertOriginalPublicationLive=()=>{sourceSeal.running();const current=consumer.snapshot();check(!held&&session===publicationSession&&!current.held&&!current.pendingFrame&&!current.childEnded&&!current.toolEnded&&current.consumed&&Date.now()<grant.dispatchBefore,'ORIGINAL_PUBLICATION_SESSION_NO_LONGER_LIVE');};
  const publicationSession=session;
  const publicationPort=Object.freeze({kind:isLive?'CAPTURED_OFFICIAL_PORT':'TEST_ONLY_SYNTHETIC_PORT',markIntent({request}){setHostStage('MARK_ORIGINAL_INTENT');assertOriginalPublicationLive();return mark(request);},
    publish({request}){check(ob.equalEvidenceData(request,publishRequest),'EXACT_PUBLISH_REQUEST');setHostStage('PUBLISH_ORIGINAL_TOOL');assertOriginalPublicationLive();
     // Deliberately neither async nor h.sqlDispatch: retain the exact official
     // tool Promise. It is never raced, canceled, replaced or replayed.
     publicationCallCount++;check(publicationCallCount===1,'ORIGINAL_TOOL_INVOCATION_NOT_BOUND');
     pendingPublish=fixedTools.mcp__codex_apps__supabase_execute_sql({project_id:PROJECT,query:request.payload.sql});return pendingPublish;
    },writeResponseOnce({request,result}){return respond(request,result);}});
  if(isLive){const permit=Object.freeze({});livePublicationPermits.set(permit,deepFreeze({kind:'ACTUAL_CONSUMED_SAME_SESSION_REVIEW',port:publicationPort,sessionId:session,currentSession:()=>session,binding:grant,options:Object.freeze(observerOptions)}));observer=createLiveObserver(permit);}
  else observer=ob.createDispatchObserver({...observerOptions,testOnlyPort:publicationPort});
  sourceSeal.running();await observer.dispatch();sourceSeal.settling();safeObservation('ORIGINAL_DISPATCH_OBSERVED');
  const originalPromiseBound=publicationCallCount===1&&pendingPublish instanceof Promise&&observer.liveToolPromise===pendingPublish;
  if(!originalPromiseBound)hold(Error(publicationCallCount===0?'PUBLICATION_NOT_INVOKED':'ORIGINAL_TOOL_INVOCATION_NOT_BOUND'));
  if(originalPromiseBound)check(observer.liveToolPromise===pendingPublish,'ORIGINAL_TOOL_PROMISE_IDENTITY');
  const rawSettlement=observer.settlementPromise??(publicationCallCount===1&&observer.rawToolFact?Promise.resolve():null);
  if(rawSettlement)rawEvidenceTask=rawSettlement.then(async()=>{
   const fact=observer.rawToolFact;check(fact&&['FULFILLED','REJECTED','THREW'].includes(fact.type),'SETTLED_ORIGINAL_RAW_REQUIRED');
   const value=fact.type==='FULFILLED'?fact.value:{error:{name:String(fact.value?.name??'Error'),message:String(fact.value?.message??fact.value),stack:String(fact.value?.stack??'')}};
   const rawBytes=JSON.stringify(value);check(typeof rawBytes==='string','ORIGINAL_TOOL_RAW_SERIALIZATION');
   const record={requestId:publishRequest.requestId,requestSha256:publishRequest.requestSha256,kind:'PUBLISH',settlementType:fact.type,observedAt:fact.observedAt,rawBytes,rawSha256:sha(rawBytes)},input=JSON.stringify(record)+'\n',delimiter='JOBFINDER_SETTLED_RAW_'+sha(input);
   sourceSeal.settling();const ack=await sourceLocal(RECORD_TOOL+" <<'"+delimiter+"'\n"+input+delimiter);
   sourceSeal.settling();check(ack.kind==='FIXED_TOOL_RESULT_RECORDED'&&ack.requestId===record.requestId&&ack.requestSha256===record.requestSha256&&ack.rawSha256===record.rawSha256&&ack.settlementType===record.settlementType,'ORIGINAL_RAW_WX_RECEIPT');rawEvidenceReceipt=ack;event('ORIGINAL_RAW_RECORDED',{settlementType:record.settlementType,rawSha256:record.rawSha256});
  }).catch(e=>hold(e));
  if(originalPromiseBound){event('PUBLISH_STARTED');safeObservation('ORIGINAL_PUBLISH_PROMISE_BOUND');}
  else event('PUBLICATION_NOT_CONFIRMED_STARTED',{publicationCallCount});
 }
 async function read(r){
  sourceSeal.running();const request=original(r);setHostStage(['READ_CONTEXT','READ_PUBLICATION_CONTEXT','READ_OUTCOME'].includes(request.kind)?request.kind:'UNKNOWN_READ');check(!r.expired&&!r.dispatchRecorded&&(!held||(request.kind==='READ_OUTCOME'&&canObserveOriginalOutcome())),'READ_UNCERTAIN');
  let sql=request.payload.sql;
  if(request.kind==='READ_CONTEXT'||request.kind==='READ_PUBLICATION_CONTEXT'){
   const p=JSON.parse(await h.cmd('node '+h.q(cfg.root+'/host-files.mts')+' connector-context '+h.q(dir+'/'+request.requestId+'.request.json')));
   sourceSeal.running();check(p.requestId===request.requestId&&p.requestSha256===request.requestSha256&&p.candidateId===b.candidateId&&p.buildContentSha256===b.buildContentSha256,'CONTEXT_PACKET_BINDING');sql=p.sql;
   if(request.kind==='READ_CONTEXT')check(request.payload.sourceId===SOURCE&&request.payload.sourceConfigSha256===b.sourceConfigSha256,'CONTEXT_SOURCE_BINDING');
   else {publicationPathSeen=true;check(sql===request.payload.sql,'CONTEXT_SQL_EXACT');}
  }else{
   check(request.kind==='READ_OUTCOME'&&observer&&!readRequest,'READ_OUTCOME_ORDER');
   check(sql===compileOriginalReadOutcome(tuple()),'ORIGINAL_READ_OUTCOME_SQL_BINDING');readRequest=request;
   sourceSeal.running();await observer.observeReadOutcomeRequest(issue(outcomes,{kind:'READ_OUTCOME_REQUEST',expected:expected(),originalRequest:request}));sourceSeal.running();
  }
  check(typeof sql==='string'&&sql.length>0,'READ_SQL_REQUIRED');sourceSeal.running();await mark(request);sourceSeal.running();
  const originalReadPromise=fixedTools.mcp__codex_apps__supabase_execute_sql({project_id:PROJECT,query:sql});check(originalReadPromise instanceof Promise,'ORIGINAL_READ_PROMISE');
  const readDeadline=Date.parse(request.expiresAt),readTimer=setTimeout(()=>safeObservation('ORIGINAL_READ_DEADLINE_OBSERVED'),Math.max(0,Math.min(2**31-1,readDeadline-Date.now())));
  let raw;try{raw=await originalReadPromise;}finally{clearTimeout(readTimer);}sourceSeal.running();const rows=h.rows(raw);
  let result={status:'SUCCEEDED',rows};
  if(request.kind==='READ_CONTEXT'){check(rows.length===1&&rows[0].context,'READ_CONTEXT_RESULT');result=rows[0].context;check(/^\d{4}-\d\d-\d\dT.*(?:Z|[+]00:00)$/.test(result.checkedAt),'CONTEXT_UTC');result={...result,checkedAt:new Date(result.checkedAt).toISOString()};}
  sourceSeal.running();const captureStartedAtMs=Date.now(),ack=await respond(request,result);sourceSeal.settling();
  if(request.kind==='READ_CONTEXT'){
   const input={schemaVersion:1,requestId:request.requestId,requestSha256:request.requestSha256,responseSha256:ack.sha256,captureStartedAtMs};
   const classified=await sourceLocalInput(cli('classify-context',roundId),input);
   sourceSeal.settling();check(classified.kind==='FIXED_CAPTURE_ADMISSION'&&classified.inputSha256===sha(JSON.stringify(input)+'\n')&&typeof classified.due==='boolean','CAPTURE_ADMISSION_BINDING');
   if(!classified.due)notDueCandidate=deepFreeze({requestId:request.requestId,requestSha256:request.requestSha256,responseSha256:ack.sha256,captureStartedAtMs,observedAt:classified.observedAt,nextDueAt:classified.nextDueAt});
  }
  if(request.kind==='READ_OUTCOME'){readAck={...ack,raw};await observeOutcome();}
  event('READ_RESPONDED',{requestKind:request.kind});
 }
 try{await consumer.start();event('ORIGINAL_STARTED');setHostStage('SERVICE_ORIGINAL_SESSION');safeObservation('ORIGINAL_SESSION_STARTED');}catch(e){hold(e);}
 // A malformed initial frame does not erase the original tool session. Start
 // may throw after a successful exec; drain that same session to real terminal.
 const service=(async()=>{while(!serviceDone){try{sourceSeal.running();const r=await h.next(dir);if(sourceSeal.state!=='RUNNING')break;if(!r||seen.has(r.requestId)){await pause();continue;}if(held&&!(r.kind==='READ_OUTCOME'&&canObserveOriginalOutcome())){await pause();continue;}seen.add(r.requestId);if(r.kind==='PUBLISH')await publish(r);else await read(r);}catch(e){hold(e);await pause();}}})();
 // Always drain the same session even after protocol/SQL/hash failure. The
 // wrapper enforces its original deadline; no replacement worker is launched.
 try{while(!consumer.snapshot().toolEnded){if(session===null)break;try{const before=consumer.snapshot();await consumer.poll();const after=consumer.snapshot();if(after.sequence!==before.sequence||after.pendingFrame!==before.pendingFrame||after.toolEnded||pollCounts.receipts%25===0)safeObservation('ORIGINAL_POLL_RECEIPT');await observeOutcome();}catch(e){hold(e);await new Promise(resolve=>setTimeout(resolve,1000));}const pipeState=consumer.snapshot();if(pipeState.held){held=true;const code=pipeState.integrityHeld?'PIPE_INTEGRITY_HELD':'PIPE_NATURAL_NONZERO_TERMINAL';if(!notifiedHolds.has(code)){notifiedHolds.add(code);safeObservation('FIXED_HOST_HOLD',code);}}}}
 finally{sourceSeal.seal();serviceDone=true;safeObservation('ORIGINAL_SESSION_DRAINED_BEFORE_PENDING_SERVICE');await service;sourceSeal.settling();}
 // Process the final OUTCOME+CHILD_TERMINAL+exit chunk after a delayed write ack.
 try{await observeOutcome();}catch(e){hold(e);}
 event('ORIGINAL_TOOL_DRAINED',{toolPending:!!observer&&!observer.rawToolFact});
 if(observer){
  // Keep the cell and original promise alive after local terminal or expiry.
  // Late settlement is observational only; the observer writes no late response.
  if(observer.settlementPromise){if(!observer.rawToolFact)safeObservation('ORIGINAL_PUBLICATION_PENDING_AFTER_SESSION_TERMINAL');await observer.settlementPromise;sourceSeal.settling();}
  if(observer.liveResponsePromise){try{await observer.liveResponsePromise;}catch{}sourceSeal.settling();}
  if(rawEvidenceTask){await rawEvidenceTask;sourceSeal.settling();}
  const s=consumer.snapshot();
  if(actualTerminal)await observer.observeOriginalTerminal(issue(terminals,{kind:'ORIGINAL_CHILD_TERMINAL',expected:expected(),observedAt:terminalObservedAt,originalSessionId:String(session),originalLaunchSha256:sha(LAUNCH),wrapper:{state:'TERMINATED',exitCode:actualTerminal.exit_code,signal:null,reaped:true},child:{state:'TERMINATED',exitCode:s.childExit,signal:s.childSignal,reaped:s.childEnded}}));
 }
 const dbVerified=isLive?'LIVE_VERIFIED':'TEST_ONLY_VERIFIED';
 if(!held&&observer?.snapshot().status===dbVerified){try{
  // Pure sidecar data from the same original packet mapper. Authority remains
  // the exact live READ_OUTCOME committed receipt, never the sidecar itself.
  const projectionData=await sourceLocal(PROJECTIONS),rows=JSON.parse(readAck.bytes).result.rows;
  check(rows.length===1&&rows[0].row?.atomicCommitState==='COMMITTED','COMMITTED_RECEIPT_REQUIRED');
  const row=rows[0].row,receipt=row.completenessCertificate;
  check(sha(canonical(receipt))===row.completenessCertificateSha256&&ob.equalEvidenceData(receipt.binding,tuple()),'UI_COMMITTED_RECEIPT_BINDING');
  const members=receipt.members.filter(m=>m.setKind==='VISIBLE'),fields=['companyId','sourceId','dedupeKey','sourceJobId','officialTitle','officialUrl','listUrl','locationRaw','city','cities','officialPublishedAt','missingSuccessCount','lifecycleStatus','visibleInFrontend','isNew'];
  check(Array.isArray(projectionData.projections)&&projectionData.projections.length===members.length,'UI_PROJECTION_SET');
  const jobs=members.map(m=>{const match=projectionData.projections.filter(p=>p.dedupeKey===m.jobKey);check(match.length===1,'UI_MEMBER_UNIQUE');const p=match[0],projection=Object.fromEntries(fields.map(k=>[k,p[k]]));check(fields.every(k=>own(p,k))&&sha(canonical({schemaVersion:'job-persisted-projection-v1',projection}))===m.jobProjectionSha256,'UI_PROJECTION_RECEIPT_HASH');return {sourceJobId:p.sourceJobId,officialTitle:p.officialTitle,officialUrl:p.officialUrl};});
  const evidence={schemaVersion:1,readRequestSha256:readRequest.requestSha256,responseSha256:readAck.sha256,receiptSha256:row.completenessCertificateSha256,batchId:seed.batchId,sourceId:SOURCE,companyId:'company-biogen-china',observedAt:receipt.observedAt,jobs,removedIds:[]};
  const e={batchId:seed.batchId,sourceId:SOURCE,companyId:'company-biogen-china',observedAt:receipt.observedAt,expectedFileSha256:sha(JSON.stringify(evidence)),jobs,removedIds:[]};
  const port=ui.createCuaBrowserPort({enabled:true,toolCall:fixedTools.mcp__cua_repl__js});
  uiResult=await ui.createPublicVerifier({expected:e,port}).run();
  check(uiResult.status==='PASS_LIST_AND_SOURCE_TIME_ONLY','PUBLIC_UI_NOT_ACCEPTED:'+uiResult.status);
 }catch(e){hold(e);}}
 const terminal=consumer.snapshot(),notDueVerified=!held&&!terminal.held&&!publicationPathSeen&&!publishRequest&&!!notDueCandidate&&terminal.childEnded&&terminal.toolEnded&&terminal.childExit===0&&terminal.childSignal===null&&terminal.toolExit===0;
 let noPublicationReceipt=null;
 if(notDueVerified){noPublicationReceipt=await sourceLocalInput(cli('close-no-publication',roundId),{schemaVersion:1,roundId,seed,originalSessionId:session,wrapperExitCode:actualTerminal.exit_code,childExitCode:terminal.childExit,childSignal:terminal.childSignal,pipeHeld:terminal.held,outcomeConsumed:false,noPublishDispatch:true});check(noPublicationReceipt.kind==='FIXED_NO_PUBLICATION_CLOSED'&&noPublicationReceipt.roundId===roundId&&ob.equalEvidenceData(noPublicationReceipt.seed,seed)&&noPublicationReceipt.newSuccessRecorded===false,'NO_PUBLICATION_TERMINAL_RECEIPT');}
 let knownNotDispatchedReceipt=null;
 // Actual same-host terminal/call facts are authority to close a proved failure.
 // File and packet data only narrow it; they never restore publication rights.
 if(errors.length===0&&publicationPathSeen&&publicationCallCount===0&&pendingPublish===null&&actualTerminal&&terminal.exactNaturalTerminal===true&&!terminal.integrityHeld&&!terminal.pendingFrame&&!terminal.outcomeConsumed&&terminal.childExit===actualTerminal.exit_code){
  try{
   const classification=await sourceLocal(cli('read-dispatch-state',roundId));
   if(classification.publicationState==='KNOWN_NOT_DISPATCHED'){
    check(classification.kind==='FIXED_DISPATCH_CLASSIFICATION'&&classification.roundId===roundId&&ob.equalEvidenceData(classification.seed,seed)&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(classification.requestId)&&classification.newRoundAllowed===false&&classification.grantsAuthority===false&&['requestSha256','markerSha256','responseSha256','recoveryDataSha256'].every(k=>/^[a-f0-9]{64}$/.test(classification[k])),'KNOWN_NOT_DISPATCHED_CLASSIFICATION_BINDING');
    const actualRequestFile=await h.readFile(dir+'/'+classification.requestId+'.request.json');
    check(actualRequestFile.hash===sha(actualRequestFile.text),'KNOWN_NOT_DISPATCHED_REQUEST_BYTES');
    const failureRequest=original(JSON.parse(actualRequestFile.text));
    check(failureRequest.kind==='PUBLISH'&&failureRequest.requestId===classification.requestId&&failureRequest.requestSha256===classification.requestSha256&&failureRequest.expiresAt===classification.originalPublishExpiresAt&&Date.now()>=Date.parse(failureRequest.expiresAt)&&(!publishRequest||ob.equalEvidenceData(failureRequest,publishRequest)),'KNOWN_NOT_DISPATCHED_REQUEST_BINDING');
    const packetData=await sourceLocal(cli('read-publication-data',roundId));
    check(packetData.kind==='FIXED_PUBLICATION_DATA'&&packetData.roundId===roundId&&ob.equalEvidenceData(packetData.seed,seed)&&ob.equalEvidenceData(packetData.originalTuple,tuple())&&packetData.requestId===failureRequest.requestId&&packetData.requestSha256===failureRequest.requestSha256&&packetData.sqlSha256===sha(failureRequest.payload.sql)&&packetData.originalPublishExpiresAt===failureRequest.expiresAt&&packetData.recoveryDataSha256===classification.recoveryDataSha256,'KNOWN_NOT_DISPATCHED_PACKET_BINDING');
    check(publicationCallCount===0&&pendingPublish===null,'KNOWN_NOT_DISPATCHED_INVOCATION_CHANGED');
    const input={schemaVersion:1,roundId,seed,originalSessionId:session,wrapperExitCode:actualTerminal.exit_code,childExitCode:terminal.childExit,childSignal:terminal.childSignal,pipeHeld:terminal.held,terminalIntegrity:'EXACT_NATURAL_TERMINAL',outcomeConsumed:false,publicationInvoked:false,publicationPromisePresent:false,requestId:failureRequest.requestId,requestSha256:failureRequest.requestSha256,markerSha256:classification.markerSha256,responseSha256:classification.responseSha256,recoveryDataSha256:classification.recoveryDataSha256};
    const closed=await sourceLocalInput(cli('close-known-not-dispatched',roundId),input);
    check(closed.kind==='FIXED_KNOWN_NOT_DISPATCHED_CLOSED'&&closed.roundId===roundId&&ob.equalEvidenceData(closed.seed,seed)&&closed.requestId===failureRequest.requestId&&closed.requestSha256===failureRequest.requestSha256&&/^[a-f0-9]{64}$/.test(closed.terminalReceiptSha256)&&closed.oldPublicationCalls===0&&closed.newSuccessRecorded===false&&closed.oldFailurePreserved===true&&closed.oldPermitRestored===false,'KNOWN_NOT_DISPATCHED_CLOSED_BINDING');
    knownNotDispatchedReceipt=closed;event('ORIGINAL_KNOWN_NOT_DISPATCHED_CLOSED');
   }
  }catch(e){hold(e);}
 }
 const databaseCommitFact=observer?.snapshot().outcome==='COMMITTED_EXACT'?observer.originalEvidence.outcome:null;
 const result={knownNotDispatchedReceipt,publicationCallCount,pollCounts,roundId,reconciliation,databaseCommitFact,noPublicationReceipt,notDue:notDueVerified?notDueCandidate:null,rawEvidenceReceipt,bootstrap:{requestSha256:bootstrap.querySha256,rawSha256,bootstrapSha256:accepted.bootstrapSha256,checkedAt:accepted.checkedAt,originalPromiseRetained:rawBootstrapPromise instanceof Promise},status:held?'HOLD':notDueVerified?'SKIPPED_NOT_DUE':uiResult?.status==='PASS_LIST_AND_SOURCE_TIME_ONLY'?(isLive?'LIVE_ROUND_VERIFIED':'TEST_ONLY_ROUND_VERIFIED'):observer?.snapshot().status??'NO_PUBLICATION',databaseStatus:observer?.snapshot().status??'NO_PUBLICATION',pipe:consumer.snapshot(),observer:observer?.snapshot()??null,ui:uiResult,errors,events,outcomeObservedAt,terminalObservedAt,sameOriginalPromise:observer?pendingPublish instanceof Promise&&observer.liveToolPromise===pendingPublish:null,sourceHeld:true,releaseEligible:false,newBatchAllowed:false,productionQualified:false};
 const finalTerminal=consumer.snapshot();
 const originalSettled=sourceSeal.settled&&serviceDone&&actualTerminal&&Number.isSafeInteger(session)&&finalTerminal.exactNaturalTerminal===true&&!finalTerminal.integrityHeld&&!finalTerminal.pendingFrame&&actualTerminal.exit_code===finalTerminal.childExit;
 const verified=originalSettled&&!held&&result.status===(isLive?'LIVE_ROUND_VERIFIED':'TEST_ONLY_ROUND_VERIFIED')&&observer?.snapshot().status===dbVerified&&publicationCallCount===1&&pendingPublish instanceof Promise&&observer.liveToolPromise===pendingPublish&&!!observer.rawToolFact&&!!rawEvidenceReceipt&&!!readAck&&finalTerminal.outcomeConsumed&&uiResult?.status==='PASS_LIST_AND_SOURCE_TIME_ONLY';
 const notDue=originalSettled&&notDueVerified&&!!noPublicationReceipt&&publicationCallCount===0&&pendingPublish===null&&!observer&&!finalTerminal.outcomeConsumed;
 // Any host-level exception may be an integrity failure. Only the original
 // natural nonzero terminal itself can accompany this narrow safe failure.
 const knownNotDispatched=originalSettled&&errors.length===0&&!!knownNotDispatchedReceipt&&publicationCallCount===0&&pendingPublish===null&&!observer?.rawToolFact&&!observer?.liveToolPromise&&!observer?.liveResponsePromise&&!finalTerminal.outcomeConsumed;
 const closeKind=verified?'VERIFIED':notDue?'NOT_DUE':knownNotDispatched?'KNOWN_NOT_DISPATCHED':null;
 sourceSeal.finish(closeKind!==null);
 if(closeKind!==null&&sourceCycleIdentity!==null){
  const fact=deepFreeze({kind:closeKind,sourceId:SOURCE,roundId,releaseSha256:ACTIVATION.deploymentSha256,seed,originalSessionId:session,terminalReceiptSha256:knownNotDispatchedReceipt?.terminalReceiptSha256??noPublicationReceipt?.terminalReceiptSha256??null,
   factsSha256:sha(canonical({kind:closeKind,roundId,seed,originalSessionId:session,terminal:finalTerminal,publicationCallCount,rawEvidenceReceipt,noPublicationReceipt,knownNotDispatchedReceipt}))});
  closedSourceResults.set(result,{cycle:sourceCycleIdentity,fact});
  deepFreeze(result);
 }
 return result;
 }finally{if(sourceSeal.state!=='SAFELY_CLOSED'&&sourceSeal.state!=='GLOBAL_HOLD')sourceSeal.abandon();}
}
// The build appends the sole fixed public entry. Private constructors, permits,
// callbacks, SQL and configuration selectors never leave this lexical scope.
