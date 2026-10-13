// Function body for AsyncFunction('observerAPI', source). TEST_ONLY synthetic
// ports only; no tools, network, credentials, filesystem, or production calls.
const {createDispatchObserver, restoreDispatchObserver, cloneEvidenceData, equalEvidenceData} = observerAPI;
const insist = (condition, code) => { if (!condition) throw Error('TEST_ONLY_SMOKE:' + code); };
const START = 1000000, EXPIRES = START + 165500, OUTER = EXPIRES + 120000;
let now = START;
const request = {schemaVersion:1, requestId:'TEST_ONLY_REQUEST', requestSha256:'TEST_ONLY_SHA', kind:'PUBLISH',
  expiresAt:new Date(EXPIRES).toISOString(), payload:{projectId:'TEST_ONLY_PROJECT',sql:'TEST_ONLY_SQL',
    dispatchBefore:new Date(EXPIRES-165000).toISOString()}};
const tuple = {batchId:'TEST_ONLY_BATCH',sourceId:'TEST_ONLY_SOURCE', optional:undefined};
const expected = {requestId:request.requestId, requestSha256:request.requestSha256, tuple, outerDeadline:OUTER};
const tokens = new WeakMap(), terminalTokens = new WeakMap(), outcomeTokens = new WeakMap();
const token = Object.freeze({}); tokens.set(token,true);
let calls = 0, marks = 0, writes = 0, resolveTool;
const originalPromise = new Promise(resolve => { resolveTool = resolve; });
const issue = (map,fact) => { const key=Object.freeze({});map.set(key,fact);return key; };
const authority = map => ({accept(key,binding){const fact=map.get(key);insist(!!fact&&equalEvidenceData(fact.expected,binding),'OPAQUE_BINDING');return fact;}});
const observer = createDispatchObserver({request, authorization:token, mode:'TEST_ONLY', now:()=>now,
  schedule:()=>1, cancel:()=>{},
  consumeAuthorization:async (key,exact)=>{
    insist(tokens.has(key)&&equalEvidenceData(exact,request),'ONE_SHOT_GATE');tokens.delete(key);
    return {request,dispatchBefore:EXPIRES-165000,expiresAt:EXPIRES,outerDeadline:OUTER,tuple,mode:'OFFLINE_REVIEW_ONLY'};
  },
  originalTerminalAuthority:authority(terminalTokens),readOutcomeAuthority:authority(outcomeTokens),
  testOnlyPort:{kind:'TEST_ONLY_SYNTHETIC_PORT',
    async markIntent(input){marks++;return {marked:true,exclusive:input.flag==='wx',requestId:request.requestId,requestSha256:request.requestSha256};},
    publish(){calls++;return originalPromise;},
    async writeResponseOnce(packet){writes++;return {written:true,exclusive:true,requestId:request.requestId,requestSha256:request.requestSha256,result:packet.result};}}
});
await observer.dispatch(); insist(observer.liveToolPromise===originalPromise,'ORIGINAL_PROMISE_IDENTITY');
now=EXPIRES-10;resolveTool({structuredContent:{result:'\n<untrusted-data-test>\n[]\n</untrusted-data-test>'}});
await observer.settlementPromise;now=EXPIRES+10;
insist(observer.snapshot().status==='WAITING_ORIGINAL_EVIDENCE','PUBLISH_PHASE_NOT_GLOBAL');
const readCutoff=Math.min(OUTER-60000,EXPIRES-5+60000);
const originalRequest={schemaVersion:1,kind:'READ_OUTCOME',requestId:'TEST_ONLY_READ',requestSha256:'TEST_ONLY_READ_SHA',
  expiresAt:new Date(readCutoff).toISOString(),payload:{projectId:request.payload.projectId,sql:'TEST_ONLY_READ_SQL',dispatchBefore:new Date(readCutoff-25000).toISOString()}};
await observer.observeReadOutcome(issue(outcomeTokens,{kind:'READ_OUTCOME',expected,originalRequest,observedAt:now,state:'COMMITTED_EXACT'}));
now=readCutoff+10;
await observer.observeOriginalTerminal(issue(terminalTokens,{kind:'ORIGINAL_CHILD_TERMINAL',expected,observedAt:now,
  originalSessionId:'TEST_ONLY_SESSION',originalLaunchSha256:'TEST_ONLY_LAUNCH',
  wrapper:{state:'TERMINATED',exitCode:0,signal:null,reaped:true},child:{state:'TERMINATED',exitCode:0,signal:null,reaped:true}}));
const state=observer.snapshot();insist(state.status==='TEST_ONLY_VERIFIED','ORIGINAL_EXIT_RESERVE');
insist(state.releaseEligible===false&&state.newBatchAllowed===false&&state.sourceHeld===true,'REAL_SOURCE_HELD');
let duplicate=false;try{await observer.dispatch();}catch{duplicate=true;}insist(duplicate&&calls===1&&marks===1&&writes===1,'NO_REPLAY');
const restored=restoreDispatchObserver({request,expected,now:()=>now});
insist(restored.snapshot().status==='UNKNOWN'&&restored.snapshot().releaseEligible===false,'RESTART_HOLD');
const disabled=createDispatchObserver({request,now:()=>now,schedule:()=>1,cancel:()=>{}});
let blocked=false;try{await disabled.dispatch();}catch{blocked=true;}insist(blocked,'REAL_PORT_DISABLED');
const copied=cloneEvidenceData({explicit:undefined,list:[undefined,-0,null]});
insist(Object.hasOwn(copied,'explicit')&&copied.list[0]===undefined&&Object.is(copied.list[1],-0),'UNDEFINED_AND_NEGATIVE_ZERO');
insist(!equalEvidenceData({}, {explicit:undefined}), 'ABSENT_DISTINCT_FROM_UNDEFINED');
return {kind:'TEST_ONLY_FUNCTIONS_HOST_SMOKE',passed:true,status:state.status,calls,marks,writes,
  releaseEligible:false,newBatchAllowed:false,realPort:'DISABLED',sameOriginalPromise:true,
  originalPhaseDeadlinesPreserved:true,strictUndefinedClone:true};
