/** Synthetic, in-memory source closure tests. No dependency copies, generated
 * artifact writes, freshcase install, DB, browser, or network tool is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withKnownNotDispatchedScenarios} from './source-seal-harness.mjs';
const HOST=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const body=fs.readFileSync(path.join(HOST,'functions/body.template.js'),'utf8');
const block=body.slice(body.indexOf('const sourceCycleIdentity='),body.indexOf('let roundInFlight='));
const check=(yes,code)=>{if(!yes)throw Error(code);};
const unit=cycle=>new Function('sourceCycle','check',block+'\nreturn {createSourceSeal,consumeClosedSource,issueForSyntheticUnit(result,fact){closedSourceResults.set(result,{cycle:sourceCycleIdentity,fact});}};')(cycle,check);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('source result authority is private, one-shot, and cycle/factory specific',()=>{
 const cycle=Object.freeze({}),first=unit(cycle),second=unit(cycle),result={status:'HOLD'},fact=Object.freeze({kind:'KNOWN_NOT_DISPATCHED'});
 first.issueForSyntheticUnit(result,fact);
 for(const [owner,value,expected] of [[first,{...result},cycle],[first,JSON.parse(JSON.stringify(result)),cycle],[first,result,{}],[second,result,cycle],[first,{status:'LIVE_ROUND_VERIFIED',safe:true},cycle]])assert.throws(()=>owner.consumeClosedSource(value,expected),/SOURCE_CLOSE_CAPABILITY_REQUIRED/);
 assert.equal(first.consumeClosedSource(result,cycle),fact);
 assert.throws(()=>first.consumeClosedSource(result,cycle),/SOURCE_CLOSE_CAPABILITY_REQUIRED/);
 const old=unit(undefined);old.issueForSyntheticUnit(result,fact);assert.throws(()=>old.consumeClosedSource(result,undefined),/SOURCE_CLOSE_CAPABILITY_REQUIRED/);
});
test('seal rejects new mutation while original Promise and command session drain',async()=>{
 const seal=unit({}).createSourceSeal(),pending=deferred();
 const tracked=seal.track(()=>pending.promise,r=>seal.observeCommand(r));
 seal.seal();assert.equal(seal.state,'SEALING');assert.throws(()=>seal.running(),/SOURCE_SEALED/);assert.throws(()=>seal.finish(true),/SOURCE_AUXILIARY_NOT_SETTLED/);
 pending.resolve({session_id:17,output:''});await tracked;
 assert.equal(seal.settled,false);assert.throws(()=>seal.finish(true),/SOURCE_AUXILIARY_NOT_SETTLED/);
 await seal.track(()=>Promise.resolve({session_id:17,exit_code:0,output:''}),r=>seal.observeCommand(r,17));
 assert.equal(seal.settled,true);seal.finish(true);assert.equal(seal.state,'SAFELY_CLOSED');assert.throws(()=>seal.settling(),/SOURCE_ALREADY_CLOSED/);
});
test('rejected, foreign, malformed, or lost helper terminal stays global hold',async()=>{
 for(const bad of ['reject','foreign','missing','malformed']){
  const seal=unit({}).createSourceSeal();
  await seal.track(()=>Promise.resolve({session_id:3,output:''}),r=>seal.observeCommand(r));
  if(bad==='reject')await assert.rejects(seal.track(()=>Promise.reject(Error('original failure')),r=>seal.observeCommand(r,3)));
  else await seal.track(()=>Promise.resolve(bad==='foreign'?{session_id:4,exit_code:0}:bad==='missing'?{output:''}:{session_id:3,exit_code:'0'}),r=>seal.observeCommand(r,3));
  seal.seal();assert.equal(seal.settled,false);assert.throws(()=>seal.finish(true),/SOURCE_AUXILIARY_NOT_SETTLED/);seal.finish(false);assert.equal(seal.state,'GLOBAL_HOLD');
 }
});
test('Biogen body retains the exact same source sealing implementation',()=>{
 const other=fs.readFileSync(path.join(HOST,'biogen/body.template.js'),'utf8');
 assert.equal(other,body.replaceAll('source-takeda-china-social','source-biogen-china-social').replaceAll('company-takeda-china','company-biogen-china'));
});
test('Hengrui body retains source sealing with its actual source and company identities',()=>{const h=fs.readFileSync(path.join(HOST,'hengrui/body.template.js'),'utf8');assert.equal(h,body.replaceAll('source-takeda-china-social','source-hengrui-social').replaceAll('company-takeda-china','company-hengrui'));});
// Optional already-existing fixture: tests reuse data in memory only. This is
// source-body composition against synthetic ports, not a measured build/install.
const fixturePath=process.env.SOURCE_SEAL_FIXTURE;
test('actual source body retains original successful and held control flows', {skip:!fixturePath}, async()=>{
 const fixtureData=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
 const original=fs.readFileSync(path.join(HOST,'functions-entry.js'),'utf8');
 const permits=fs.readFileSync(path.join(HOST,'functions/private-live-permits.js'),'utf8');
 const bodyStart=original.indexOf('// Trusted composition body.'),bodyEnd=original.indexOf(permits);
 assert.ok(bodyStart>=0&&bodyEnd>bodyStart);
 const base=original.slice(bodyStart,bodyEnd).match(/const BASE='([^']+)';/)[1];
 let bundle=original.slice(0,bodyStart)+body.replace('__JOBFINDER_FIXED_DEPLOYMENT_ROOT__',base)+'\n'+original.slice(bodyEnd);
 const activation={enabled:true,mode:'LIVE',deploymentSha256:'c'.repeat(64)};
 const deployment={kind:'LIVE_DEPLOYMENT',fixturePreloadSha256:null,expectedRow:{...fixtureData.context.candidateRow,id:'fixed-functions-v4-unregistered'}};
 const query="BEGIN READ ONLY; SET LOCAL statement_timeout='4s'; SELECT clock_timestamp() AS \"checkedAt\",to_jsonb(r) AS candidate FROM public.\"ReleaseCandidate\" r WHERE id='fixed-functions-v4-unregistered'; COMMIT;\n";
 bundle=bundle.replace(/^const ACTIVATION=.*\n/,'const ACTIVATION=Object.freeze('+JSON.stringify(activation)+');\n').replace(/^const DEPLOYMENT=.*\n/m,'const DEPLOYMENT='+JSON.stringify(deployment)+';\n').replace(/^const BOOTSTRAP_SQL=.*\n/m,()=> 'const BOOTSTRAP_SQL='+JSON.stringify(query)+';\n');
 const cases=['success','not-due','delayed-ack','slow-terminal','preflight-pending','record-deferred-terminal','record-deferred-hold','mark-deferred-terminal','mark-deferred-hold','record-half-frame','mark-half-frame','pending-late','tool-reject','tool-isError','tool-bad-result','raw-diagnostic-failure','ui-hold','initial-malformed','not-due-child-nonzero','not-due-missing-terminal','known-not-dispatched','known-may-have-been-sent','known-signal','known-half-frame'];
 let harness=fs.readFileSync(path.join(HOST,'tests/full-composition-v8-harness.js'),'utf8');
 const creation="const api=new Function('tools','Date','notify',actualBundle)(syntheticTools,TestDate,x=>safeNotices.push(x));";
 assert.equal(harness.split(creation).length,2);
 harness=withKnownNotDispatchedScenarios(harness);
 harness=harness.replace(creation,"const api=await sourceFactory(actualBundle,syntheticTools,TestDate,x=>safeNotices.push(x),name);");
 harness=harness.slice(0,harness.indexOf('const reports=[];const prod='))+`const reports=[];for(const name of ${JSON.stringify(cases)})reports.push(await scenario(name));return reports;`;
 const safe=new Set(['success','not-due','delayed-ack','slow-terminal','preflight-pending','known-not-dispatched']);
 async function sourceFactory(source,tools,Date,notify,name){
  const cycle=Object.freeze({}),api=new Function('tools','Date','notify','lifecycleScope','sourceCycle',source.replace('return Object.freeze({runLiveRound});','return Object.freeze({runLiveRound,consumeClosedSource});'))(tools,Date,notify,{assertOriginal(){}},cycle);
  let first=true;
  return {async runLiveRound(){
   const result=await api.runLiveRound();
   if(first){first=false;
    assert.throws(()=>api.consumeClosedSource({...result},cycle),/SOURCE_CLOSE_CAPABILITY_REQUIRED/);
    assert.throws(()=>api.consumeClosedSource(JSON.parse(JSON.stringify(result)),cycle),/SOURCE_CLOSE_CAPABILITY_REQUIRED/);
    assert.throws(()=>api.consumeClosedSource(result,{}),/SOURCE_CLOSE_CAPABILITY_REQUIRED/);
    if(safe.has(name)){const fact=api.consumeClosedSource(result,cycle);assert.equal(fact.kind,name==='not-due'?'NOT_DUE':name==='known-not-dispatched'?'KNOWN_NOT_DISPATCHED':'VERIFIED');if(name==='known-not-dispatched'){assert.equal(result.status,'HOLD');assert.equal(result.pipe.childExit,1);assert.equal(result.publicationCallCount,0);assert.equal(fact.terminalReceiptSha256,'e'.repeat(64));}assert.equal(fact.sourceId,'source-takeda-china-social');assert.equal(fact.releaseSha256,activation.deploymentSha256);assert.match(fact.factsSha256,/^[a-f0-9]{64}$/);}
    assert.throws(()=>api.consumeClosedSource(result,cycle),/SOURCE_CLOSE_CAPABILITY_REQUIRED/);
   }
   return result;
  }};
 }
 const AF=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AF('bundle','fixtureData','digestSource','mode','deploymentInfo','productionBundle','notify','sourceFactory',harness);
 const reports=await run(bundle,fixtureData,fs.readFileSync(path.join(HOST,'functions/sha256.js'),'utf8'),'LIVE',{deployment,activation},original,()=>{},sourceFactory);
 assert.equal(reports.length,cases.length);
});

for(const name of ['biogen','hengrui','ucb','viatris'])test(name+' retains exact private source sealing and one-shot capability block',()=>{
 const other=fs.readFileSync(path.join(HOST,name+'/body.template.js'),'utf8');
 assert.equal(other.slice(other.indexOf('const sourceCycleIdentity='),other.indexOf('let roundInFlight=')),block);
});
