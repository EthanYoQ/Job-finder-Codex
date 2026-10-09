import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRestrictedTransport, PROJECT_ID } from './restricted-transport.mjs';
import { createFileJournal } from './file-journal.mjs';
const authorityId='87654321-1234-4234-8234-123456789abc';
async function testJournal(dir){
 try{await writeFile(join(dir,'authority.json'),JSON.stringify({schemaVersion:1,authorityId,projectId:PROJECT_ID,initializedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 return createFileJournal(dir,{expectedAuthorityId:authorityId});
}
const base=1_800_000_000_000;
const binding=()=>({projectId:PROJECT_ID,sourceId:'source-test',sourceConfigSha256:'a'.repeat(64),candidateId:'candidate-60',batchId:'batch-01',sourceResultId:'batch-01--source-test',overallDeadline:base+500000,expiresAt:base+400000,dispatchBefore:base+235000});
const guards={assertScope:()=>true,verifyPublicationReady:async()=>true};
const compiler=async()=>({sql:'SET LOCAL statement_timeout=120000; DO $$ BEGIN NULL; END $$;',atomic:true});
test('REVIEW: UNKNOWN tuple cannot be resent after transport restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'independent-review-'));await chmod(dir,0o700);
 try{
  const journal=await testJournal(dir);let calls=0;
  const openConnection=async()=>({query:async()=>{calls++;throw Object.assign(Error('lost reply'),{code:'ECONNRESET'});},close:async()=>{}});
  const make=()=>createRestrictedTransport({compiler,journal,openConnection,activated:true,now:()=>base});
  const first=make(),p1=await first.prepare('PUBLISH',{},binding());
  assert.equal((await first.dispatch(p1.ticket,guards)).outcome,'UNKNOWN');
  const restarted=make(),p2=await restarted.prepare('PUBLISH',{},binding());
  assert.notEqual(p1.request.requestId,p2.request.requestId);
  assert.equal((await restarted.dispatch(p2.ticket,guards)).outcome,'UNKNOWN');
  assert.equal(calls,1,'The same original tuple must never be sent twice.');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('REVIEW: response deadline becomes durable UNKNOWN and closes without waiting',async()=>{
 let clock=base,finished,closeCalls=0,resolveQuery;
 const timers=new Map();let timerId=0;
 const schedule=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,due:clock+ms});return id;};
 const unschedule=id=>timers.delete(id);
 const transport=createRestrictedTransport({compiler,journal:{prepare:async()=>{},claim:async()=>{},finish:async(_,r)=>{finished=r;}},
  openConnection:async()=>({query:()=>new Promise(r=>{resolveQuery=r;}),close:()=>{closeCalls++;return new Promise(()=>{});}}),activated:true,now:()=>clock,schedule,unschedule});
 const p=await transport.prepare('PUBLISH',{},binding()),work=transport.dispatch(p.ticket,guards);
 await new Promise(r=>setImmediate(r));clock=binding().expiresAt;
 for(const [id,t] of timers)if(t.due<=clock){timers.delete(id);t.fn();}
 const result=await work;
 assert.equal(result.outcome,'UNKNOWN');assert.equal(result.code,'RESPONSE_DEADLINE');
 assert.deepEqual(finished,result);assert.equal(closeCalls,1);
 resolveQuery([{command:'SET',rows:[]},{command:'DO',rows:[]}]);
 await new Promise(r=>setImmediate(r));assert.deepEqual(finished,result);
});
test('REVIEW: acknowledged result is journaled while close remains pending',async()=>{
 let finished=false,resolveClose;
 const transport=createRestrictedTransport({compiler,journal:{prepare:async()=>{},claim:async()=>{},finish:async()=>{finished=true;}},
  openConnection:async()=>({query:async()=>[{command:'SET',rows:[]},{command:'DO',rows:[]}],close:()=>new Promise(r=>{resolveClose=r;})}),activated:true,now:()=>base});
 const p=await transport.prepare('PUBLISH',{},binding()),work=transport.dispatch(p.ticket,guards);
 await new Promise(r=>setImmediate(r));assert.equal(finished,true);
 resolveClose();await work;assert.equal(finished,true);
});
test('REVIEW: string false is not treated as activated',async()=>{
 let calls=0;
 const transport=createRestrictedTransport({compiler,journal:{prepare:async()=>{},claim:async()=>{},finish:async()=>{}},
  openConnection:async()=>({query:async()=>{calls++;return [{command:'SET',rows:[]},{command:'DO',rows:[]}];},close:async()=>{}}),activated:'false',now:()=>base});
 const p=await transport.prepare('PUBLISH',{},binding());
 assert.equal((await transport.dispatch(p.ticket,guards)).code,'ACTIVATION_REQUIRED');assert.equal(calls,0);
});
test('REVIEW: concurrent separately prepared publications share a semantic claim',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'independent-review-concurrent-'));await chmod(dir,0o700);
 try{
  const journal=await testJournal(dir);let calls=0;
  const make=()=>createRestrictedTransport({compiler,journal,activated:true,now:()=>base,openConnection:async()=>({query:async()=>{calls++;return [{command:'SET',rows:[]},{command:'DO',rows:[]}];},close:async()=>{}})});
  const t1=make(),t2=make(),[p1,p2]=await Promise.all([t1.prepare('PUBLISH',{},binding()),t2.prepare('PUBLISH',{},binding())]);
  const outcomes=await Promise.all([t1.dispatch(p1.ticket,guards),t2.dispatch(p2.ticket,guards)]);
  assert.equal(calls,1);assert.equal(outcomes.filter(r=>r.status==='SUCCEEDED').length,1);assert.equal(outcomes.filter(r=>r.outcome==='UNKNOWN').length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('REVIEW: partial semantic marker is a fail-closed crash fence',async()=>{
 const {writeFile}=await import('node:fs/promises');const {sha256}=await import('./restricted-transport.mjs');
 const dir=await mkdtemp(join(tmpdir(),'independent-review-partial-'));await chmod(dir,0o700);
 try{
  const b=binding(),key=sha256(JSON.stringify([b.projectId,b.candidateId,b.sourceId,b.batchId,b.sourceResultId]));
  await writeFile(join(dir,key+'.publish-identity.json'),'',{mode:0o600});
  const journal=await testJournal(dir);let calls=0;
  const transport=createRestrictedTransport({compiler,journal,activated:true,now:()=>base,openConnection:async()=>({query:async()=>{calls++;return [];},close:async()=>{}})});
  const p=await transport.prepare('PUBLISH',{},b),result=await transport.dispatch(p.ticket,guards);
  assert.equal(result.outcome,'UNKNOWN');assert.equal(calls,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('REVIEW: pg identity-read timeout disposes the half-open connection',async()=>{
 const {createPgConnectionFactory,WRITER_ROLE}=await import('./pg-connection.mjs');
 let closed=false,release;
 class Client {on(){} async connect(){} query(){return new Promise(r=>{release=r;});} async end(){closed=true;}}
 const host=`db.${PROJECT_ID}.supabase.co`;
 const config={projectId:PROJECT_ID,database:'postgres',port:5432,mode:'direct',host,verifiedHost:host,user:WRITER_ROLE,ca:'-----BEGIN CERTIFICATE-----\nTEST ONLY\n-----END CERTIFICATE-----'};
 const factory=createPgConnectionFactory({Client,config,passwordProvider:async()=> 'test-only-value-1234567890'});
 const work=factory({deadline:Date.now()+30,kind:'PUBLISH'}).then(()=> 'connected',()=> 'rejected');
 try{
  const outcome=await Promise.race([work,new Promise(r=>setTimeout(()=>r('still pending'),80))]);
  assert.equal(outcome,'rejected');assert.equal(closed,true);
 }finally{
  release?.({rows:[{role:WRITER_ROLE,session_role:WRITER_ROLE,database:'postgres',isolation:'read committed',synchronous_commit:'on',elevated:false}]});await work;
 }
});
