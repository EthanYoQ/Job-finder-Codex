/** Generated cores with synthetic ports only. No network, DB, child or browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const entry=fs.readFileSync(new URL('./functions-entry.js',import.meta.url),'utf8');
const value=name=>JSON.parse(entry.match(new RegExp('^const '+name+'=(.*);$','m'))[1]);
const privateKey=Object.freeze({});
const pipeSource=value('PIPE_CORE_SOURCE'),observerSource=value('OBSERVER_CORE_SOURCE');
const pipe=new Function('PRIVATE_LIVE_CORE_KEY',pipeSource)(privateKey);
const observer=new Function('PRIVATE_LIVE_CORE_KEY',observerSource)(privateKey);
const launch={projectId:'yiopvxysxrtrnvqxwgbx',candidateId:'synthetic-candidate',sourceId:'source-viatris-social',batchId:'synthetic-batch',buildSha256:'a'.repeat(64),launchChallenge:'b'.repeat(64),outerDeadline:200000};
const seed=pipe.publicTest.seedFromLaunch(launch);
const binding={...launch,sourceResultId:'synthetic-result',requestId:'synthetic-request',requestSha256:'c'.repeat(64),sqlSha256:'d'.repeat(64),dispatchBefore:120000,expiresAt:130000};
const frame=(n,event,data=launch,detail={})=>pipe.publicTest.makeFrame(n,event,data,detail);

test('generated core SHA pins independently match embedded exact bytes',()=>{
  for(const [name,source] of [['PIPE_CORE',pipeSource],['OBSERVER_CORE',observerSource]])
    assert.equal(createHash('sha256').update(source).digest('hex'),value(name+'_SHA256'));
});
test('public factories cannot request LIVE and forged private identity cannot enable it',async()=>{
  assert.throws(()=>pipe.publicTest.createOwnedSessionConsumer({launch:seed,mode:'LIVE'}),/PUBLIC_TEST_FACTORY_CANNOT_LIVE/);
  assert.throws(()=>observer.publicTest.createDispatchObserver({mode:'LIVE'}),/PUBLIC_TEST_FACTORY_CANNOT_LIVE/);
  const p=pipe.core({launch:seed,mode:'LIVE',clock:()=>100000},{key:{},port:{kind:'CAPTURED_OFFICIAL_TOOL_PORT',launch(){throw Error('MUST_NOT_RUN');},poll(){}}});
  await assert.rejects(p.start(),/PIPE_REAL_PORT_DISABLED/);
});
test('fixed pipe rejects other source and mismatched exact request tuple',async()=>{
  assert.throws(()=>pipe.publicTest.validateLaunch({...launch,sourceId:'source-ucb-china-social'}),/PIPE_SCOPE/);
  const p=pipe.publicTest.createOwnedSessionConsumer({launch:seed,mode:'TEST_ONLY',clock:()=>100000,toolsPort:{kind:'TRUSTED_SYNTHETIC_TOOL_PORT',async launch(){return {session_id:1,output:frame(0,'STARTED')+frame(1,'REVIEW_CONSUMED',binding)};},async poll(){throw Error('UNEXPECTED_POLL');}}});
  await p.start();assert.throws(()=>p.acceptExpectedRequest({...binding,requestId:'other-request'}),/PIPE_RELAY_REQUEST_MISMATCH/);
  assert.equal(p.snapshot().integrityHeld,true);assert.equal(p.snapshot().dispatchAllowed,false);
});
test('private LIVE pipe retains one-shot exact review and terminal facts',async()=>{
  let calls=0;
  const p=pipe.core({launch:seed,mode:'LIVE',clock:()=>100000},{key:privateKey,port:{kind:'CAPTURED_OFFICIAL_TOOL_PORT',async launch(){calls++;return {session_id:4,output:frame(0,'STARTED')+frame(1,'REVIEW_CONSUMED',binding)};},async poll(id){assert.equal(id,4);return {session_id:4,output:frame(2,'CHILD_TERMINAL',launch,{exitCode:0,signal:null}),exit_code:0};}}});
  await p.start();p.acceptExpectedRequest(binding);assert.deepEqual(p.consumeReview(),binding);
  assert.throws(()=>p.consumeReview(),/PIPE_NOT_DISPATCHABLE/);await assert.rejects(p.start(),/PIPE_ALREADY_STARTED/);
  await p.poll();assert.equal(p.snapshot().exactNaturalTerminal,true);assert.equal(p.snapshot().integrityHeld,false);assert.equal(calls,1);
});
test('half frame or mismatched terminal never becomes exact natural terminal',async()=>{
  for(const suffix of ['partial',frame(1,'CHILD_TERMINAL',launch,{exitCode:0,signal:null})]){
    const p=pipe.publicTest.createOwnedSessionConsumer({launch:seed,mode:'TEST_ONLY',clock:()=>100000,toolsPort:{kind:'TRUSTED_SYNTHETIC_TOOL_PORT',async launch(){return {session_id:3,output:frame(0,'STARTED')};},async poll(){return {session_id:3,output:suffix,exit_code:1};}}});
    await p.start();await p.poll();assert.equal(p.snapshot().exactNaturalTerminal,false);assert.equal(p.snapshot().integrityHeld,true);
  }
});
// Exercise the canonical observer behavioral suite against this profile's
// generated public TEST core. Only its import and the stricter public-LIVE error
// are adapted. Its original native-Promise/deadline/one-shot cases remain intact.
const suiteUrl=new URL('../../connector-gate/dispatch-observer.test.mjs',import.meta.url);
let suite=fs.readFileSync(suiteUrl,'utf8');
suite=suite.replace(/^import .*;\n/gm,'');
suite=suite.replace("createDispatchObserver({ ...f.config, mode: 'LIVE' }), /REAL_CONNECTOR_PORT_DISABLED/", "createDispatchObserver({ ...f.config, mode: 'LIVE' }), /PUBLIC_TEST_FACTORY_CANNOT_LIVE/");
suite=suite.replaceAll('import.meta.url',JSON.stringify(suiteUrl.href));
new Function('test','assert','readFile','createDispatchObserver','restoreDispatchObserver',suite)(test,assert,readFile,observer.publicTest.createDispatchObserver,observer.publicTest.restoreDispatchObserver);
