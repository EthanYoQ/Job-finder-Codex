/** Fixed, single-round TEST_ONLY composition. No production ports or callbacks. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,readdir,mkdir,writeFile,open,link,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createOwnedSessionConsumer} from '../connector-gate/pipe-protocol.mjs';
import {createPublicVerifier} from '../public-verification/machine.mjs';
import {fixture as syntheticUiPort} from './synthetic-ui-port.mjs';
import {parseJobProjectionDeltaReceipt,hashJobPersistedProjection} from '../vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
const ROOT=resolve(import.meta.dirname,'..'),PRODUCER=join(ROOT,'vendor/c60-source');
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const {createDispatchObserver}=new Function(readFileSync(join(ROOT,'connector-gate/dispatch-observer.functions.js'),'utf8'))();
const plain=(v:any)=>JSON.parse(JSON.stringify(v));
function checkedRequest(raw:Buffer){const r=JSON.parse(raw.toString('utf8'));assert.deepEqual(Object.keys(r).sort(),['expiresAt','kind','payload','requestId','requestSha256','schemaVersion']);const {requestSha256,...body}=r;assert.equal(sha(JSON.stringify(body)),requestSha256);assert.equal(r.schemaVersion,1);assert.equal(r.payload.projectId,'yiopvxysxrtrnvqxwgbx');return r;}
async function readOriginalRequest(file:string){const cutoff=Date.now()+1000;for(;;){const bytes=await readFile(file);try{return checkedRequest(bytes);}catch(error){if(!(error instanceof SyntaxError)||Date.now()>=cutoff)throw error;await delay(5);}}}
const envelope=(r:any,result:any)=>Buffer.from(JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,result}));
function toolRows(rows:any[]){return {content:[{type:'text',text:JSON.stringify({result:'\n<untrusted-data-fixed-synthetic>\n'+JSON.stringify(rows)+'\n</untrusted-data-fixed-synthetic>'})}]};}

export async function runOneRound(scenario:string,directory:string){
 assert(['success','sql-tamper','late-result','publish-rejection','bad-outcome','pending-until-terminal','coalesced-final','delayed-read-ack','slow-child-terminal','held-outcome-chunk'].includes(scenario),'FIXED_SCENARIO_ONLY');
 assert.equal(process.env.JOBFINDER_FIXED_HOST_MODE,'TEST_ONLY','REAL_PORT_DISABLED');
 const at=Date.now(),build=JSON.parse(await readFile(join(PRODUCER,'build-identity.json'),'utf8'));
 const seed={projectId:'yiopvxysxrtrnvqxwgbx',candidateId:'synthetic-fixed-host-unregistered',sourceId:'source-takeda-china-social',batchId:'fixed-'+randomUUID(),buildSha256:build.contentSha256,launchChallenge:randomBytes(32).toString('hex')};
 await mkdir(directory,{mode:0o700});await mkdir(join(directory,'relay'));
 const relay=join(directory,'relay'),sessionId=101,events:any[]=[];
 let child:any,ended:any=null,terminalAt=0,stop=false,pipeFailure:string|null=null,observer:any=null,publishRequest:any=null,readRequest:any=null,readResponse:Buffer|null=null,publishCalls=0,intentWrites=0,responseWrites=0,clockOffset=0,rawPromise:any=null,rawResult:any=null,p0:any=null,ui:any=null,expected:any=null;
 const chunks:string[]=[];
 const terminalCapability=new WeakMap<object,any>(),outcomeCapability=new WeakMap<object,any>(),reviewCapability=new WeakMap<object,any>();
 let launchDigest='',settlementTask:Promise<void>|null=null,deferredResolve:((v:any)=>void)|null=null,drainedWhileToolPending=false;
 const emit=(event:string,more:any={})=>events.push({sequence:events.length,event,at:Date.now(),...more});
 const next=async()=>{while(!chunks.length&&!ended)await delay(5);return chunks.splice(0).join('');};
 const wrapperError=await open(join(directory,'wrapper-stderr.log'),'wx',0o600);
 const toolsPort={kind:'TRUSTED_SYNTHETIC_TOOL_PORT',async launch(){
  const args=[join(ROOT,'connector-gate/run-with-owned-publication-pipe.mjs'),JSON.stringify(seed),join(directory,'diagnostics'),'1800000','--',process.execPath,'--require',join(ROOT,'test/no-network.cjs'),'--import',join(ROOT,'node_modules/tsx/dist/loader.mjs'),join(ROOT,'fixed-host/p0-fixture-child.mts'),directory,JSON.stringify(seed),scenario];
  launchDigest=sha(JSON.stringify({node:process.execPath,args,cwd:PRODUCER}));
  // Minimal non-secret environment. No credentials are inherited.
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',JOBFINDER_OWNED_PIPE_MODE:'TEST_ONLY',JOBFINDER_CLOUD_SOURCE_ID:seed.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'};
  child=spawn(process.execPath,args,{cwd:PRODUCER,env,stdio:['ignore','pipe',wrapperError.fd]});
  child.stdout.setEncoding('utf8');child.stdout.on('data',(s:string)=>chunks.push(s));
  child.once('error',(error:any)=>{ended={code:127,signal:null,error:String(error)};terminalAt=Date.now();});
  child.once('close',(code:number,signal:string)=>{ended={code,signal};terminalAt=Date.now();emit('ACTUAL_WRAPPER_TOOL_TERMINAL',{code,signal});});
  return {session_id:sessionId,output:await next()};
 },async poll(id:number){assert.equal(id,sessionId);if(scenario==='held-outcome-chunk'&&consumer.snapshot().consumed){while(!ended&&!chunks.some(part=>part.includes('OUTCOME_VERIFIED')))await delay(5);stopped();while(!ended)await delay(5);}if(scenario==='coalesced-final'&&consumer.snapshot().consumed){while(!ended)await delay(5);}const output=await next();return {session_id:sessionId,output,...(ended?{exit_code:ended.code}: {})};}};
 const consumer=createOwnedSessionConsumer({launch:seed,toolsPort,mode:'TEST_ONLY'} as any);
 let serviceError:any=null;
 const stopped=()=>{if(child&&!ended)child.kill('SIGTERM');};
 const writeResponse=async(r:any,result:any)=>{const bytes=envelope(r,result),temp=join(relay,r.requestId+'.response-'+randomUUID()+'.tmp'),dest=join(relay,r.requestId+'.response.json');await writeFile(temp,bytes,{flag:'wx',mode:0o600});try{await link(temp,dest);}finally{await unlink(temp);}return bytes;};
 const authority=(map:WeakMap<object,any>)=>({accept:async(token:object,want:any)=>{const fact=map.get(token);assert(fact,'LIVE_CAPABILITY_REQUIRED');map.delete(token);assert.deepEqual(fact.expected,want);return fact;}});
 const boundExpected=()=>({requestId:publishRequest.requestId,requestSha256:publishRequest.requestSha256,tuple:{releaseCandidateId:seed.candidateId,batchId:seed.batchId,sourceId:seed.sourceId,sourceResultId:seed.batchId+'--'+seed.sourceId},outerDeadline:consumer.snapshot().outerDeadline});
 let outcomeProcessing:Promise<void>|null=null,readOutcomeVerifiedAt:number|null=null;
 const consumeAvailableOutcome=async()=>{
  if(outcomeProcessing){await outcomeProcessing;return;}
  const current=consumer.snapshot();if(current.held||pipeFailure||!current.outcomeSeen||current.outcomeConsumed||!readRequest||!readResponse||!observer)return;
  outcomeProcessing=(async()=>{
   const matching={type:'PRODUCER_OUTCOME_VERIFIED_V1',tuple:boundExpected().tuple,readRequestSha256:readRequest.requestSha256,responseSha256:sha(readResponse!)};
   consumer.acceptExpectedOutcome(matching);consumer.consumeOutcome();
   readOutcomeVerifiedAt=Date.now();
   const token=Object.freeze({});outcomeCapability.set(token,{kind:'READ_OUTCOME',expected:boundExpected(),state:'COMMITTED_EXACT',observedAt:readOutcomeVerifiedAt,originalRequest:readRequest});await observer.observeReadOutcome(token);emit('LIVE_OUTCOME_CONSUMED',matching);
  })().catch(error=>{pipeFailure??=String(error?.message??error);emit('OUTCOME_HELD_CONTINUE_DRAIN',{code:pipeFailure});stopped();});await outcomeProcessing;
 };
 const service=(async()=>{const seen=new Set<string>();while(!stop){
  for(const name of await readdir(relay)){
   if(!name.endsWith('.request.json')||seen.has(name))continue;
   const r=await readOriginalRequest(join(relay,name));
   if(r.kind==='PUBLISH')continue;
   seen.add(name);emit('ORIGINAL_RELAY_REQUEST',{kind:r.kind,requestSha256:r.requestSha256});
   if(r.kind==='READ_CONTEXT'||r.kind==='READ_PUBLICATION_CONTEXT'){
    const context={...JSON.parse(await readFile(join(directory,'synthetic-context.json'),'utf8')),checkedAt:new Date().toISOString()};
    await writeResponse(r,r.kind==='READ_CONTEXT'?context:{status:'SUCCEEDED',rows:[{context}]});
   }else if(r.kind==='READ_OUTCOME'){
    assert(observer&&publishRequest);assert.equal(readRequest,null);readRequest=r;
    const token=Object.freeze({});outcomeCapability.set(token,{kind:'READ_OUTCOME_REQUEST',expected:boundExpected(),originalRequest:r});await observer.observeReadOutcomeRequest(token);
    const model=JSON.parse(await readFile(join(directory,'synthetic-db-model.json'),'utf8'));assert.equal(model.sqlSha256,sha(publishRequest.payload.sql));
    const row=plain(model.row);if(scenario==='bad-outcome')row.dedupeOutputCount++;
    const rows=[{row,batch:model.batch,holderId:model.holderId}];
    // Preserve exact synthetic official-envelope raw fact independently of file bytes.
    const rawOfficial=toolRows(rows);await writeFile(join(directory,'read-outcome-tool-raw.json'),JSON.stringify(rawOfficial),{flag:'wx'});
    const written=await writeResponse(r,{status:'SUCCEEDED',rows});if(scenario==='delayed-read-ack'){await delay(100);emit('DELAYED_ORIGINAL_READ_WRITE_ACK');}readResponse=written;await consumeAvailableOutcome();
    emit('READ_OUTCOME_RESPONSE_WRITTEN',{requestSha256:r.requestSha256,responseSha256:sha(readResponse),rawToolSha256:sha(JSON.stringify(rawOfficial))});
   }else throw Error('UNEXPECTED_FIXED_RELAY_KIND:'+r.kind);
  }
  await delay(5);
 }})().catch(error=>{serviceError=error;stopped();});
 try {
  await consumer.start();emit('OWNED_STARTED',{outerDeadline:consumer.snapshot().outerDeadline});
  while(true){
   const s=consumer.snapshot();
   if(s.reviewSeen&&!publishRequest){
    for(const name of await readdir(relay)){if(name.endsWith('.request.json')){const r=await readOriginalRequest(join(relay,name));if(r.kind==='PUBLISH'){assert.equal(publishRequest,null);publishRequest=r;}}}
    assert(publishRequest,'ORIGINAL_PUBLISH_REQUEST_REQUIRED');
    if(scenario==='sql-tamper'){
     publishRequest.payload.sql+='\n-- synthetic exact-byte tamper';const {requestSha256,...body}=publishRequest;publishRequest.requestSha256=sha(JSON.stringify(body));
     await writeFile(join(directory,'tampered-request-test-only.json'),JSON.stringify(publishRequest),{flag:'wx'});
    }
    const binding={...seed,outerDeadline:s.outerDeadline,sourceResultId:seed.batchId+'--'+seed.sourceId,requestId:publishRequest.requestId,requestSha256:publishRequest.requestSha256,sqlSha256:sha(publishRequest.payload.sql),expiresAt:Date.parse(publishRequest.expiresAt),dispatchBefore:Date.parse(publishRequest.payload.dispatchBefore)};
    try {consumer.acceptExpectedRequest(binding);}catch(error){pipeFailure=(error as Error).message;emit('EXACT_REQUEST_HELD',{code:pipeFailure});stopped();continue;}
    // The private capability is minted only from the live, one-use pipe consume.
    // No exposed callback, JSON PASS, caller token, or configurable predicate.
    const consumed=consumer.consumeReview(),token=Object.freeze({});
    const grant={mode:'OFFLINE_REVIEW_ONLY',request:plain(publishRequest),dispatchBefore:consumed.dispatchBefore,expiresAt:consumed.expiresAt,outerDeadline:consumed.outerDeadline,tuple:boundExpected().tuple};
    reviewCapability.set(token,grant);emit('LIVE_REVIEW_CONSUMED',{requestSha256:consumed.requestSha256});
    observer=createDispatchObserver({request:publishRequest,authorization:token,
     consumeAuthorization:async(t:object,r:any)=>{const value=reviewCapability.get(t);assert(value,'LIVE_REVIEW_CAPABILITY_REQUIRED');reviewCapability.delete(t);assert.deepEqual(value.request,r);return value;},
     originalTerminalAuthority:authority(terminalCapability),readOutcomeAuthority:authority(outcomeCapability),mode:'TEST_ONLY',now:()=>Date.now()+clockOffset,
     testOnlyPort:{kind:'TEST_ONLY_SYNTHETIC_PORT',async markIntent({request:r}:any){assert.deepEqual(await readOriginalRequest(join(relay,r.requestId+'.request.json')),r);assert(Date.now()<Date.parse(r.expiresAt)&&Date.now()<Date.parse(r.payload.dispatchBefore));await writeFile(join(relay,r.requestId+'.dispatch.json'),JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,state:'MAY_HAVE_BEEN_SENT',markedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});intentWrites++;emit('WX_INTENT');return {marked:true,exclusive:true,requestId:r.requestId,requestSha256:r.requestSha256};},
      publish({request:r}:any){assert.equal(++publishCalls,1);assert.deepEqual(r,publishRequest);emit('SINGLE_SYNTHETIC_TOOL_INVOKED');
       rawPromise=new Promise((resolve,reject)=>{if(scenario==='pending-until-terminal'){deferredResolve=resolve;setTimeout(()=>{clockOffset=Date.parse(r.expiresAt)-Date.now()+1;observer.observeDeadline();emit('PENDING_TOOL_DEADLINE_UNKNOWN');stopped();},20);return;}setTimeout(()=>{if(scenario==='publish-rejection'){reject(Error('SYNTHETIC_TOOL_REJECTED_AFTER_DISPATCH'));return;}rawResult=toolRows([]);resolve(rawResult);},scenario==='late-result'?50:5);});
       if(scenario==='late-result')clockOffset=Date.parse(r.expiresAt)-Date.now()+1;
       return rawPromise;
      },async writeResponseOnce({request:r,result,flag}:any){assert.equal(flag,'wx');await writeResponse(r,result);responseWrites++;emit('PUBLISH_RESPONSE_FROM_SETTLED_TOOL',{status:result.status});return {written:true,exclusive:true,requestId:r.requestId,requestSha256:r.requestSha256,result};}}});
    await observer.dispatch();assert.strictEqual(observer.liveToolPromise,rawPromise);await assert.rejects(observer.dispatch(),/ALREADY_CLAIMED/);
    settlementTask=observer.settlementPromise.then(async()=>{assert.strictEqual(observer.liveToolPromise,rawPromise);await writeFile(join(directory,'publish-tool-raw.json'),JSON.stringify(observer.rawToolFact,(key,value)=>value instanceof Error?{name:value.name,message:value.message}:value),{flag:'wx'});emit('ORIGINAL_TOOL_PROMISE_SETTLED',{observer:observer.snapshot()});if(scenario==='late-result'||scenario==='publish-rejection'){assert.equal(observer.snapshot().status,'UNKNOWN');stopped();}});
   }
   await consumeAvailableOutcome();
   if(consumer.snapshot().toolEnded)break;
   if(!consumer.snapshot().toolEnded){try{await consumer.poll();}catch(error){pipeFailure??=(error as Error).message;stopped();if(consumer.snapshot().toolEnded)break;}}
  }
  // Drain ends only on same original session terminal, even when held.
  stop=true;await service;if(serviceError)throw serviceError;await wrapperError.close();
  await consumeAvailableOutcome();let snapshot=consumer.snapshot();emit('DRAIN_FINISHED',{snapshot});

  snapshot=consumer.snapshot();
  if(scenario==='pending-until-terminal'){assert.equal(observer.rawToolFact,null);assert(snapshot.childEnded&&snapshot.toolEnded);assert.equal(observer.snapshot().status,'UNKNOWN');drainedWhileToolPending=true;emit('PENDING_ORIGINAL_PROMISE_RETAINED_AFTER_DRAIN');assert.strictEqual(observer.liveToolPromise,rawPromise);assert(deferredResolve);(deferredResolve as unknown as (value:any)=>void)(toolRows([]));}
  if(settlementTask)await settlementTask;
  if(observer){const token=Object.freeze({});terminalCapability.set(token,{kind:'ORIGINAL_CHILD_TERMINAL',expected:boundExpected(),observedAt:terminalAt,originalSessionId:String(sessionId),originalLaunchSha256:launchDigest,
   wrapper:{state:'TERMINATED',exitCode:ended.code,signal:ended.signal,reaped:true},child:{state:'TERMINATED',exitCode:snapshot.childExit,signal:snapshot.childSignal,reaped:snapshot.childEnded}});await observer.observeOriginalTerminal(token);}
  if(['success','coalesced-final','delayed-read-ack','slow-child-terminal'].includes(scenario)){
   assert.equal(observer.snapshot().status,'TEST_ONLY_VERIFIED');if(scenario==='slow-child-terminal'){assert(readOutcomeVerifiedAt!<Date.parse(readRequest.expiresAt));assert(terminalAt>Date.parse(readRequest.expiresAt));assert(terminalAt<snapshot.outerDeadline!);}assert(snapshot.outcomeConsumed&&snapshot.childEnded&&snapshot.toolEnded&&!snapshot.held);
   p0=JSON.parse(await readFile(join(directory,'p0-result.json'),'utf8'));assert.equal(p0.outcome.state,'COMMITTED_EXACT');
   // UI expectation derives from the exact verified readback receipt. Projection
   // fixture bytes are data; every visible row must match its committed hash.
   const row=JSON.parse(readResponse!.toString('utf8')).result.rows[0].row,receipt=parseJobProjectionDeltaReceipt(row.completenessCertificate,row.completenessCertificateSha256);
   assert.deepEqual(receipt.binding,boundExpected().tuple);const members=receipt.members.filter(m=>m.setKind==='VISIBLE'),model=JSON.parse(await readFile(join(directory,'synthetic-db-model.json'),'utf8'));
   const jobs=members.map(m=>{const matches=model.projections.filter((p:any)=>p.dedupeKey===m.jobKey);assert.equal(matches.length,1);const p=matches[0];assert.equal(hashJobPersistedProjection(p),m.jobProjectionSha256);return {sourceJobId:p.sourceJobId,officialTitle:p.officialTitle,officialUrl:p.officialUrl};});
   assert.equal(model.projections.length,members.length);assert.equal(jobs.length,2);
   const expectedEvidence={schemaVersion:1,readRequestSha256:readRequest.requestSha256,responseSha256:sha(readResponse!),receiptSha256:row.completenessCertificateSha256,batchId:seed.batchId,sourceId:seed.sourceId,companyId:'company-takeda-china',observedAt:receipt.observedAt,jobs,removedIds:[]};const expectedBytes=Buffer.from(JSON.stringify(expectedEvidence));await writeFile(join(directory,'expected-evidence.json'),expectedBytes,{flag:'wx'});
   expected={batchId:seed.batchId,sourceId:seed.sourceId,companyId:'company-takeda-china',observedAt:receipt.observedAt,expectedFileSha256:sha(expectedBytes),jobs,removedIds:[]};
   const uiFixture=syntheticUiPort(expected,{consent:true});ui=await createPublicVerifier({expected,port:uiFixture.port} as any).run();
   assert.equal(ui.status,'PASS_LIST_AND_SOURCE_TIME_ONLY');assert.equal(ui.ordinaryReloadCount,0);assert(uiFixture.calls.every((c:any)=>!c.code.includes('fetch(')));
   await writeFile(join(directory,'ui-port-calls.json'),JSON.stringify(uiFixture.calls,null,2),{flag:'wx'});emit('UI_RECEIPT_BOUND_LIST_AND_SOURCE_TIME',{status:ui.status});
  }else if(scenario==='sql-tamper'){assert.equal(publishCalls,0);assert.equal(intentWrites,0);assert.equal(pipeFailure,'PIPE_RELAY_REQUEST_MISMATCH');assert(snapshot.held);}
  else {assert.equal(publishCalls,1);assert.equal(observer.snapshot().status,'UNKNOWN');assert.equal(ui,null);if(scenario==='late-result'||scenario==='pending-until-terminal'){assert.equal(responseWrites,0);assert.equal(observer.rawToolFact.type,'FULFILLED');}if(scenario==='held-outcome-chunk'){assert.equal(snapshot.outcomeSeen,true);assert.equal(snapshot.outcomeConsumed,false);assert(snapshot.held);}if(scenario==='bad-outcome'){assert.equal(snapshot.outcomeSeen,false);assert.equal(snapshot.childExit,1);}}
  assert.equal((await readdir(relay)).filter(name=>name.endsWith('.dispatch.json')).length,intentWrites);assert(snapshot.toolEnded&&snapshot.childEnded);assert(Date.now()<snapshot.outerDeadline!);
  const report={schemaVersion:1,scenario,status:'SYNTHETIC_FIXED_ROUND_ASSERTIONS_PASS',elapsedMs:Date.now()-at,integrity:{sourceManifestSha256:process.env.JOBFINDER_FIXED_MANIFEST_SHA256??null,trustedRootSha256:process.env.JOBFINDER_FIXED_ROOT_SHA256??null},readOutcomeVerifiedAt,seed,launchDigest,publishCalls,intentWrites,responseWrites,drainedWhileToolPending,pipeFailure,pipe:snapshot,observer:observer?.snapshot()??null,p0,ui,expected,events,
   scope:{p0Entry:'ORIGINAL_EXPORTED_FUNCTION',http:'TWO_PAGE_SYNTHETIC_OWNED_FETCH',database:'SYNTHETIC_NO_SQL_EXECUTION',execSession:'NODE_OWNED_CHILD_SYNTHETIC_TOOL_PORT',ui:'SYNTHETIC_CUA_ADAPTER_EXECUTING_FIXED_CALL_STRINGS',lateClock:['late-result','pending-until-terminal'].includes(scenario)?'OBSERVER_ONLY_SYNTHETIC_ADVANCE':'REAL_WALL_CLOCK',productionQualified:false,releaseEligible:false,newBatchAllowed:false}};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});return report;
 }catch(error){
  // Every unexpected host failure still drains the same owned session. Logs or
  // waiting for OS close alone are not a replacement for parsing final frames.
  stopped();if(child){while(!consumer.snapshot().toolEnded){try{await consumer.poll();}catch(pollError){pipeFailure??=String((pollError as Error).message);if(String((pollError as Error).message)==='PIPE_POLL_STATE')break;}}}
  if(settlementTask)await settlementTask;throw error;
 }finally {stop=true;stopped();await service;while(child&&!ended)await delay(5);await wrapperError.close().catch(()=>{});}
}
const [scenario,directory]=process.argv.slice(2);
if(scenario&&directory){try{const r=await runOneRound(scenario,resolve(directory));console.log(JSON.stringify({status:r.status,scenario,elapsedMs:r.elapsedMs,report:join(directory,'report.json'),publishCalls:r.publishCalls,ui:r.ui?.status??null}));}catch(error){console.error(error);process.exitCode=1;}}
