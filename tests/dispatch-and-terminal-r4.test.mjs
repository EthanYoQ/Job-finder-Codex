// PURE_SYNTHETIC_OFFLINE: reads actual candidate source only. Every command,
// SQL call, poll, file mutation and clock below is an isolated in-memory stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,basename,dirname} from 'node:path';
import vm from 'node:vm';
const P=resolve(dirname(new URL(import.meta.url).pathname),'..'),R=resolve(P,'../..');
const ownerName='hansoh-fosun-c51-r4-20261007T2149Z';
const factories=new Map();
for(const key of ['hansoh','fosun']){
 const ownerRoot=P+'/payload/owner-adaptations/'+ownerName,hostRoot=P+'/payload/hosts/'+key+'/host';
 const fixturePath=P+'/synthetic-runtime/owner-adaptations/'+ownerName+'/tests/generated-'+key+'-full-chain.test.mjs';
 let harness=readFileSync(fixturePath,'utf8').split("\ntest('all real input baselines")[0].replace(/^import .*;\n/gm,'');
 const replaceOne=(a,b)=>{assert.equal(harness.split(a).length,2,a);harness=harness.replace(a,b);};
 replaceOne("const here=dirname(new URL(import.meta.url).pathname), project=resolve(here,'..');",'const here='+JSON.stringify(ownerRoot+'/tests')+',project='+JSON.stringify(ownerRoot)+';');
 replaceOne("const root=manifest.runtimeRoot+'/hosts/"+key+"/host';",'const root='+JSON.stringify(hostRoot)+';');
 harness=harness.replace(/^const relayCode=.*$/m,'const relayCode=original("relay-files.mjs").replace('+JSON.stringify(R+'/hosts/'+key+'/host')+',root).split("\\n").slice(3).join("\\n");');
 const a=harness.indexOf(' const previousExec=tools.exec_command;'),b=harness.indexOf(' const input=',a);assert(a>0&&b>a);
 harness=harness.slice(0,a)+' const owner=directOwner;const runFullEntry=()=>{throw Error("DISABLED_ENTRY");};\n'+harness.slice(b);
 replaceOne('get now(){return now;}};','get now(){return now;},advance(ms){now+=ms;}};');
 replaceOne("readRequest=packet('READ_OUTCOME','SELECT original synthetic read outcome')","readRequest=packet(options.readKind??'READ_OUTCOME','SELECT original synthetic read outcome')");
 replaceOne("if(cmd.includes('review-packet-envelope.mts'))output=JSON.stringify({validated:true,requestId:request.requestId,requestSha256:request.requestSha256,declarationMode:'FROZEN_COMPILER_SHARED_JSON_V1'});","if(cmd.includes('review-packet-envelope.mts')){output=JSON.stringify({validated:true,requestId:request.requestId,requestSha256:request.requestSha256,declarationMode:'FROZEN_COMPILER_SHARED_JSON_V1'});options.afterEnvelope?.({state,clock,ns});}");
 replaceOne('output=await runRelay(action,args.slice(2));','output=await runRelay(action,args.slice(2));if(action==="mark-dispatch")options.afterMark?.({state,clock,ns,kind:args[2]===request.requestId?"PUBLISH":"OTHER"});');
 replaceOne('return options.malformedTerminal?','options.afterTerminal?.({state,clock,ns});return options.malformedTerminal?');
 replaceOne("const p=args[1],txt=await memfs.readFile(p);","const p=args[1],txt=await memfs.readFile(p);if(p.endsWith(request.requestId+'.request.json'))options.afterRequestRead?.({state,clock,ns});if(p.endsWith('.request.json')&&!p.endsWith(request.requestId+'.request.json'))options.afterOtherRequestRead?.({state,clock,ns});if(p.includes('/monitor-exec-evidence/'))options.afterEvidenceRead?.({state,clock,ns});if(p.includes('/owner-relay-evidence/'))options.afterOwnerEvidenceRead?.({state,clock,ns});");
 replaceOne("if(p.endsWith('/diagnostics/process.jsonl')&&options.switchScopeOnBudgetRead)","if(p.endsWith('/diagnostics/process.jsonl'))options.afterBudgetRead?.({state,clock,ns});if(p.endsWith('/diagnostics/process.jsonl')&&options.switchScopeOnBudgetRead)");
 replaceOne('return {exit_code:0,output};','if(cmd.includes("collections.Counter")&&pollCalls>0)options.afterTerminalStatus?.({state,clock,ns});return {exit_code:0,output};');
 replaceOne("files.set(path,data+(path.includes('owner-relay-evidence')?(options.evidenceSuffix??'\\n'):'\\n'));return {};","files.set(path,data+(path.includes('owner-relay-evidence')?(options.evidenceSuffix??'\\n'):'\\n'));if(path.includes('/monitor-exec-evidence/'))options.afterEvidenceSave?.({state,clock,ns});if(path.includes('/owner-relay-evidence/'))options.afterOwnerEvidenceSave?.({state,clock,ns});return {};");
 assert(!harness.includes('spawnSync')&&!harness.includes('child_process')&&!harness.includes('import('));
 factories.set(key,vm.runInNewContext(harness+'\nfixture;',{assert,readFileSync,createHash,randomUUID,resolve,join,basename,dirname,vm,console,setImmediate}));
}
const mutate=(kind,replace=false)=>({state,ns})=>{
 const scalars={run:['refreshCurrentRun','/synthetic-new-run'],batch:['refreshCurrentBatch','synthetic-new-batch'],session:['refreshSession',99999]};
 if(scalars[kind]){const [k,v]=scalars[kind];state.set(ns+k,v);return;}
 const paths={candidateVersion:['registeredCandidateBinding',['candidate','version'],52],candidateId:['registeredCandidateBinding',['candidate','id'],'other'],build:['registeredCandidateBinding',['build','contentSha256'],'0'.repeat(64)],source:['cloudPilotHostConfig',['sourceId'],'source-other'],config:['cloudPilotHostConfig',['sourceConfigSha256'],'0'.repeat(64)],project:['cloudPilotHostConfig',['project'],'other'],root:['cloudPilotHostConfig',['root'],'/other'],requestSql:['cloudPilotPublishRequest',['payload','sql'],'SELECT changed'],requestHash:['cloudPilotPublishRequest',['requestSha256'],'0'.repeat(64)],requestId:['cloudPilotPublishRequest',['requestId'],'other'],requestExpiry:['cloudPilotPublishRequest',['expiresAt'],'2099-01-01T00:00:00Z'],requestCutoff:['cloudPilotPublishRequest',['payload','dispatchBefore'],'2099-01-01T00:00:00Z'],reviewHash:['publicationReview',['sqlSha256'],'0'.repeat(64)],reviewSource:['publicationReview',['sourceResult','sourceId'],'other']};
 const [k,path,value]=paths[kind];const obj=replace?JSON.parse(JSON.stringify(state.get(ns+k))):state.get(ns+k);let leaf=obj;for(const p of path.slice(0,-1))leaf=leaf[p];leaf[path.at(-1)]=value;if(replace)state.set(ns+k,obj);
};
const assertNoAccepted=f=>{assert.equal(f.state.has(f.ns+'lastPortableExecTerminalAccepted'),false);assert.notEqual(f.state.get(f.ns+'lastPortableExecPoll')?.validated,true);};
const boundary=f=>f.state.get(f.ns+'sqlDispatchBoundary:'+f.request.requestId);
for(const key of ['hansoh','fosun']){
 const fixture=factories.get(key);
 for(const window of ['afterBudgetRead','afterEnvelope','afterRequestRead','afterMark']){
  for(const kind of ['run','batch','session','candidateVersion','candidateId','build','source','config','project','root','requestSql','requestHash','requestId','requestExpiry','requestCutoff','reviewHash','reviewSource']){
   for(const replacement of (['run','batch','session'].includes(kind)?[false]:[false,true])){
    test(`${key}: ${window} rejects ${kind} ${replacement?'replacement':'in-place'}`,async()=>{
     const f=await fixture({[window]:mutate(kind,replacement)});const result=await f.clock.finish(f.owner(f.input));
     assert.equal(f.publishCalls,0);assert.equal(f.pollCalls,0);assertNoAccepted(f);assert.notEqual(result.status,'PROCESS_TERMINATED');assert.equal(result.retryAuthorized,false);assert.equal(result.noWriteEstablished,false);
     if(window!=='afterBudgetRead'){assert.equal(boundary(f)?.toolInvocationAttempted,false);assert.equal(boundary(f)?.transportOutcome,'NOT_INVOKED');assert.equal(boundary(f)?.requestMayBeMarked,true);}
     if(window==='afterMark')assert.equal(f.files.has(f.dir+'/'+f.request.requestId+'.dispatch.json'),true);
    });
   }
  }
 }
 for(const window of ['afterEnvelope','afterRequestRead','afterMark'])for(const deadline of ['originalBudget','dispatchBefore','expiresAt'])test(`${key}: ${window} rejects expired ${deadline} without SQL`,async()=>{
  let advance=deadline==='originalBudget'?200:deadline==='dispatchBefore'?55001:60001;
  const f=await fixture({[window]:({clock})=>clock.advance(advance)});
  if(deadline==='originalBudget')f.files.set(f.run+'/diagnostics/process.jsonl',JSON.stringify({schemaVersion:1,event:'WRAPPER_START',timeoutMs:1800000,recordedAt:new Date(f.start-1799900).toISOString(),outerDeadline:f.start+100})+'\n');
  const result=await f.clock.finish(f.owner(f.input));assert.equal(f.publishCalls,0);assert.equal(boundary(f)?.toolInvocationAttempted,false);assertNoAccepted(f);assert.equal(result.retryAuthorized,false);assert.equal(f.request.expiresAt,new Date(f.start+60000).toISOString());
 });
 for(const guard of ['missing','async','promise','false','throw'])test(`${key}: PUBLISH ${guard} guard cannot invoke SQL`,async()=>{
  const f=await fixture();const guards={missing:undefined,async:async()=>true,promise:()=>Promise.resolve(true),false:()=>false,throw:()=>{throw Error('SYNTHETIC_REJECT');}};
  await assert.rejects(f.input.stages.h.sqlDispatch(f.input.request,f.dir,f.input.sql,guards[guard]));assert.equal(f.publishCalls,0);
  if(['promise','false','throw'].includes(guard)){assert.equal(boundary(f).markCompleted,true);assert.equal(boundary(f).toolInvocationAttempted,false);assert.equal(f.files.has(f.dir+'/'+f.request.requestId+'.dispatch.json'),true);}
  else assert.equal(f.files.has(f.dir+'/'+f.request.requestId+'.dispatch.json'),false);
 });
 for(const window of ['afterTerminal','afterEvidenceSave','afterEvidenceRead','afterTerminalStatus','afterOwnerEvidenceSave','afterOwnerEvidenceRead'])for(const kind of ['run','batch','session','candidateVersion','build','source','config','requestHash'])test(`${key}: ${window} ${kind} cannot accept old terminal`,async()=>{
  const f=await fixture({[window]:mutate(kind,true)});const result=await f.clock.finish(f.owner(f.input));assert.equal(f.publishCalls,1);assert.equal(f.pollCalls,1);assertNoAccepted(f);assert.notEqual(result.status,'PROCESS_TERMINATED');
  const retained=[...f.files].filter(([p])=>p.includes('/monitor-exec-evidence/'));assert.equal(retained.length,1);assert.equal(JSON.stringify(JSON.parse(retained[0][1]).raw),JSON.stringify(f.terminal));
 });
 for(const kind of ['run','batch','session','candidateVersion','config','requestHash'])test(`${key}: owner READ_OUTCOME mark await rejects ${kind} before SQL`,async()=>{
  const f=await fixture({afterMark:args=>{if(args.kind==='OTHER')mutate(kind,true)(args);}});const result=await f.clock.finish(f.owner(f.input));
  assert.equal(f.publishCalls,1);assert.equal(f.events.filter(x=>x.event==='READ_OUTCOME_TOOL').length,0);assertNoAccepted(f);assert.notEqual(result.status,'PROCESS_TERMINATED');
  const rows=[...f.state].filter(([k])=>k.startsWith(f.ns+'sqlDispatchBoundary:')).map(([,v])=>v);assert.equal(rows.length,2);const read=rows.find(x=>x.requestId!==f.request.requestId);assert.equal(read.markCompleted,true);assert.equal(read.toolInvocationAttempted,false);
 });
 test(`${key}: owner READ_OUTCOME deadline expiry during mark keeps marker without SQL`,async()=>{
  const f=await fixture({afterMark:args=>{if(args.kind==='OTHER')args.clock.advance(60001);}});await f.clock.finish(f.owner(f.input));assert.equal(f.publishCalls,1);assert.equal(f.events.filter(x=>x.event==='READ_OUTCOME_TOOL').length,0);
  const read=[...f.state].filter(([k])=>k.startsWith(f.ns+'sqlDispatchBoundary:')).map(([,v])=>v).find(x=>x.requestId!==f.request.requestId);assert.equal(read.toolInvocationAttempted,false);assert.equal(read.markCompleted,true);
 });
 test(`${key}: legitimate success records invocation but does not equate invocation with verified publication`,async()=>{
  const f=await fixture();const result=await f.clock.finish(f.owner(f.input));assert.equal(result.status,'PROCESS_TERMINATED');assert.equal(f.publishCalls,1);assert.equal(boundary(f).toolInvocationAttempted,true);assert.equal(boundary(f).transportOutcome,'UNKNOWN');assert.equal(result.publicationReconciled,false);assert.equal(result.noWriteEstablished,false);
 });
 for(const kind of ['LEASE_ACQUIRE','LEASE_RENEW','LEASE_RELEASE','READ_OUTCOME','READ_PUBLICATION_CONTEXT'])for(const window of ['afterOtherRequestRead','afterMark'])for(const scope of ['run','batch','session'])test(`${key}: ${kind} ${window} ${scope} mutation has no relay SQL`,async()=>{
  const hook=args=>{if(window==='afterOtherRequestRead'||args.kind==='OTHER')mutate(scope)(args);};
  const f=await fixture({readKind:kind,[window]:hook});await f.clock.finish(f.owner(f.input));assert.equal(f.publishCalls,1);assert.equal(f.events.filter(x=>x.event==='READ_OUTCOME_TOOL').length,0);assertNoAccepted(f);
 });

}

// The two legacy stage-owned SQL calls also carry an owner's provided guard.
for(const key of ['hansoh','fosun'])for(const kind of ['READ_CONTEXT','CREATE_PENDING'])for(const window of ['read','mark'])test(`${key}: actual ${kind} stage ${window} await rechecks callback before its SQL`,async()=>{
 const root=R+'/hosts/'+key+'/host',sourceId=key==='hansoh'?'source-hansoh-social':'source-fosun-pharma-social';
 const cfg=JSON.parse(readFileSync(P+'/payload/hosts/'+key+'/host/host-config.json','utf8'));
 let calls=0,marker=false,current=1;const expected=1;
 const req={kind,requestId:'synthetic-stage',requestSha256:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',payload:{projectId:cfg.project,sourceId,sourceConfigSha256:cfg.sourceConfigSha256}};
 const h={cfg,q:x=>"'"+x+"'",machineJson:JSON.parse,cmd:async()=>JSON.stringify({requestId:req.requestId,requestSha256:req.requestSha256,projectId:cfg.project,output:'/synthetic/generated.sql',sha256:'b'.repeat(64)}),readFile:async()=>{if(window==='read')current=2;return {text:'SELECT synthetic',hash:'b'.repeat(64)};},mark:async()=>{marker=true;if(window==='mark')current=2;},rows:()=>[],respond:async()=>{throw Error('SHOULD_NOT_RESPOND');}};
 const context=vm.createContext({globalThis:{h},load:()=> 'return globalThis.h;',tools:{mcp__codex_apps__supabase_execute_sql:async()=>{calls++;return {}; }},store:()=>{}});
 const code=readFileSync(P+'/payload/hosts/'+key+'/host/host-stage-functions.js','utf8');const stages=await vm.runInContext('(async()=>{'+code+'})()',context);
 await assert.rejects(stages.handle(req,root+'/synthetic/relay',()=>{assert.equal(current,expected);return true;}));assert.equal(marker,true);assert.equal(calls,0);
});
