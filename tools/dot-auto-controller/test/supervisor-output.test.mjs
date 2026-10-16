import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as supervisor from '../src/supervisor-child.mjs';
const cap=65536,sha=b=>createHash('sha256').update(b).digest('hex');
async function child(code){const launch={command:process.execPath,args:['-e',code],deadline:Date.now()+10000};return {launch,actual:await supervisor.observeOwnedChild({...launch,env:{...process.env,NODE_NO_WARNINGS:'1'}})};}
const emit=`const {once}=require('node:events');async function write(stream,bytes){if(!stream.write(bytes))await once(stream,'drain');}`;
test('real noisy child has bounded tails and full byte hashes without losing terminal capability',async()=>{
 const total=8*1024*1024;
 const {actual,launch}=await child(`${emit}(async()=>{const b=Buffer.alloc(65536,120);for(let i=0;i<128;i++){await write(process.stdout,b);await write(process.stderr,b);}await write(process.stdout,Buffer.from('OUT-END'));await write(process.stderr,Buffer.from('ERR-END'));})()`);
 assert.equal(Buffer.byteLength(actual.stdout),cap);assert.equal(Buffer.byteLength(actual.stderr),cap);
 assert(actual.stdout.endsWith('OUT-END'));assert(actual.stderr.endsWith('ERR-END'));
 for(const [stream,suffix] of [['stdout','OUT-END'],['stderr','ERR-END']]){const meta=actual.output[stream];assert.equal(meta.totalBytes,total+7);assert.equal(meta.retainedBytes,cap);assert.equal(meta.truncated,true);assert.equal(meta.sha256,sha(Buffer.concat([Buffer.alloc(total,120),Buffer.from(suffix)])));}
 assert.equal(supervisor.acceptOwnedChild(actual.token,launch).terminal.exitCode,0);
 assert.throws(()=>supervisor.acceptOwnedChild(JSON.parse(JSON.stringify(actual.token)),launch),/LIVE_OWNED_CHILD/);
});
test('short split UTF-8 output is preserved exactly and remains parseable',async()=>{
 const value={status:'测试成功',message:'🙂'};const bytes=Buffer.from(JSON.stringify(value));
 const {actual}=await child(`${emit}(async()=>{for(const b of Buffer.from(${JSON.stringify(bytes.toString('hex'))},'hex')){await write(process.stdout,Buffer.from([b]));await new Promise(r=>setImmediate(r));}})()`);
 assert.equal(actual.stdout,bytes.toString());assert.equal(actual.output.stdout.truncated,false);assert.equal(actual.output.stdout.sha256,sha(bytes));
 assert.deepEqual(supervisor.parseOwnedChildResult(actual),value);
});
test('truncated output cannot masquerade as a valid complete JSON result',async()=>{
 const {actual}=await child(`${emit}(async()=>{await write(process.stdout,Buffer.alloc(65536,120));await write(process.stdout,Buffer.from(' '.repeat(65534)+'{}'));})()`);
 assert.equal(actual.stdout.trim(),'{}');
 assert.throws(()=>supervisor.parseOwnedChildResult(actual),/ORIGINAL_STDOUT_TRUNCATED/);
});
test('bounded diagnostics do not truncate or replace the IPC proof',async()=>{
 const {actual,launch}=await child(`${emit}(async()=>{await write(process.stdout,Buffer.alloc(200000,120));process.send({type:'JOBFINDER_WRAPPER_TERMINAL_V1',wrapperPid:process.pid,childPid:321,proof:{type:'JOBFINDER_WORKER_TERMINAL_V1',batchId:'batch',sourceId:'source',nonce:'nonce',mutationAttempted:false,exitCode:1,errorCode:'TEST_FAILURE'}},()=>{process.exitCode=1;process.disconnect();});})()`);
 assert(Buffer.byteLength(actual.stdout)<=cap);
 assert.deepEqual(supervisor.acceptNoMutationFailure(actual.token,launch,{batchId:'batch',sourceId:'source',nonce:'nonce',childPid:321}),{exitCode:1,errorCode:'TEST_FAILURE',mutationAttempted:false});
 assert.throws(()=>supervisor.acceptOwnedChild(actual.token,launch),/LIVE_OWNED_CHILD/);
});
test('noisy failed child without IPC proof cannot claim a no-mutation release',async()=>{
 const {actual,launch}=await child(`${emit}(async()=>{await write(process.stderr,Buffer.alloc(200000,120));process.exitCode=1;})()`);
 assert(Buffer.byteLength(actual.stderr)<=cap);
 assert.throws(()=>supervisor.acceptNoMutationFailure(actual.token,launch,{batchId:'batch',sourceId:'source',nonce:'nonce',childPid:321}),/LIVE_PREMUTATION_FAILURE/);
});
test('complete structured stdout remains valid exactly at retention boundary',async()=>{
 // No native recovery result contains job projections; nevertheless preserve
 // complete JSON up to the cap, not merely current small result examples.
 const {actual}=await child(`process.stdout.write(JSON.stringify({data:'x'.repeat(${cap}-11)}))`);
 assert.equal(Buffer.byteLength(actual.stdout),cap);
 assert.equal(actual.output.stdout.truncated,false);
 assert.equal(supervisor.parseOwnedChildResult(actual).data.length,cap-11);
});
test('all native recovery result shapes fit and the full success envelope is preserved',async()=>{
 const batchId='auto-takeda-'+ 'a'.repeat(36);
 const results=[
 {status:'WAIT_ORIGINAL_PUBLICATION_CUTOFF',batchId,expiresAt:'2026-10-16T00:00:00.000Z',retryAuthorized:false},
 {status:'HELD_READONLY_RECONCILIATION',batchId,retryAuthorized:false},
 {status:'HELD_READONLY_RECONCILIATION',batchId,databaseState:'COMMITTED_CONFLICT',retryAuthorized:false},
 {status:'DB_AND_CURRENT_PUBLIC_RECONCILED',batchId,requestId:'a'.repeat(36),requestSha256:'b'.repeat(64),proofRecord:'recovery-'+'c'.repeat(36),retryAuthorized:false,releaseEligible:false}
 ];
 for(const result of results){const json=JSON.stringify(result);assert(Buffer.byteLength(json)<1024);const {actual}=await child(`console.log(${JSON.stringify(json)})`);assert.deepEqual(supervisor.parseOwnedChildResult(actual),result);}
});
test('both supervisor result consumers reject truncated stdout before JSON parsing',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../run-takeda.mjs',import.meta.url),'utf8');
 assert(source.includes('parseOwnedChildResult(observed)'));assert(source.includes('parseOwnedChildResult(completed)'));
 assert(!source.includes('JSON.parse(observed.stdout)'));assert(!source.includes('JSON.parse(completed.stdout)'));
 assert(source.includes('stdoutSha256:output.stdout.sha256,stderrSha256:output.stderr.sha256'));
});
