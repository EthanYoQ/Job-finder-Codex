import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,request,unknown,successful,databaseError,atomicSql,exists,waitFor,child} from './harness.mjs';

// Public platform wrapper with wholly invented reason. No real review text.
export const rejected={content:[{type:'text',text:'This action was rejected due to unacceptable risk.\nReason: Synthetic review refusal for an offline test.'}],isError:true};
const assertNoFinal=async(f,r)=>{
 assert.equal(await exists(f.path(r,'response.json')),false);
 assert.equal(await exists(f.path(r,'host-result.json')),false);
 assert.equal((await f.json(r,'dispatch.json')).state,'MAY_HAVE_BEEN_SENT');
};
async function hold(f,r){await f.put(r);f.rawQueue.push(rejected);return f.h.sqlDispatch(r,f.dir,r.payload.sql);}

test('exact platform review refusal keeps UNKNOWN, one dispatch and one private hold, with no final response or replay',async t=>{
 const f=await fixture(t),r=request(),before=JSON.stringify(r),result=await hold(f,r);
 assert.equal(result.status,'AWAITING_OWNER_RECONCILIATION');assert.equal(result.outcome,'UNKNOWN');assert.equal(result.responseDeferred,true);
 await assertNoFinal(f,r);assert.equal(await readFile(f.path(r,'request.json'),'utf8'),before);
 const diagnostic=await f.json(r,'review-hold.json');
 assert.equal(diagnostic.requestId,r.requestId);assert.equal(diagnostic.requestSha256,r.requestSha256);assert.equal(diagnostic.projectId,r.payload.projectId);
 assert.equal(diagnostic.dispatchBefore,r.payload.dispatchBefore);assert.equal(diagnostic.expiresAt,r.expiresAt);
 assert.equal(diagnostic.noWriteEstablished,false);assert.equal(diagnostic.retryAuthorized,false);
 assert.ok(!JSON.stringify(diagnostic).includes('Synthetic review refusal'));assert.ok(!JSON.stringify(diagnostic).includes(r.payload.sql));
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{project_id:r.payload.projectId,query:r.payload.sql});
 await assert.rejects(f.h.sqlDispatch(r,f.dir,r.payload.sql),/EEXIST/);assert.equal(f.calls.length,1);await assertNoFinal(f,r);
});

test('unapproved or expired holds never cause automatic SQL, success, lease release or marker removal',async t=>{
 const f=await fixture(t),r=request({duration:500,dispatchDuration:350});await hold(f,r);
 const marker=await readFile(f.path(r,'dispatch.json'),'utf8');
 await delay(Math.max(1,Date.parse(r.expiresAt)-Date.now()+10));
 await assert.rejects(f.h.sqlDispatch(r,f.dir,r.payload.sql),/BUDGET_EXHAUSTED|REQUEST_EXPIRED/);
 await assertNoFinal(f,r);assert.equal(f.calls.length,1);assert.equal(await readFile(f.path(r,'dispatch.json'),'utf8'),marker);
});

test('same-bound owner success can write the sole response and resume the actual relay before its original cutoff',async t=>{
 const f=await fixture(t),c=await child(t,f,1800);f.rawQueue.push(rejected);
 await f.h.sqlDispatch(c.r,f.dir,c.r.payload.sql);await assertNoFinal(f,c.r);
 // Simulate the externally owned, separately authorized once-only retry AFTER
 // its exact read-only reconciliation. This fixture is not runtime authority.
 assert.ok(Date.now()<Date.parse(c.r.payload.dispatchBefore));
 assert.equal(await readFile(f.path(c.r,'request.json'),'utf8'),JSON.stringify(c.r));
 f.rawQueue.push(successful());
 const raw=await f.tools.mcp__codex_apps__supabase_execute_sql({project_id:c.r.payload.projectId,query:c.r.payload.sql});
 await f.h.respond(c.r,f.dir,{status:'SUCCEEDED',rows:f.h.rows(raw)});
 const ack=await waitFor(()=>c.events.find(e=>e.event==='ACKNOWLEDGED'));assert.ok(ack.at<Date.parse(c.r.expiresAt));
 await assert.rejects(f.h.respond(c.r,f.dir,unknown),/EEXIST|RESPONSE_ALREADY_EXISTS/);
 assert.equal((await f.json(c.r,'response.json')).result.status,'SUCCEEDED');assert.equal(f.calls.length,2);
 const next=await waitFor(()=>f.h.next(f.dir));assert.equal(next.kind,'READ_OUTCOME');
 f.rawQueue.push(successful());await f.h.sqlDispatch(next,f.dir,next.payload.sql);assert.equal((await c.finished).code,0);
});

test('a second owner tool refusal has no automatic final response or third SQL call',async t=>{
 const f=await fixture(t),r=request();await hold(f,r);f.rawQueue.push(rejected);
 const raw=await f.tools.mcp__codex_apps__supabase_execute_sql({project_id:r.payload.projectId,query:r.payload.sql});
 assert.throws(()=>f.h.rows(raw),/HOST_SQL_TOOL_ERROR/);
 await assertNoFinal(f,r);assert.equal(f.calls.length,2);
 await assert.rejects(f.h.sqlDispatch(r,f.dir,r.payload.sql),/EEXIST/);assert.equal(f.calls.length,2);
});

test('transport exceptions and ordinary cancellations keep the original final UNKNOWN path',async t=>{
 for(const value of [new Error('Synthetic connection lost'),new Error(rejected.content[0].text),{isError:true,content:[{type:'text',text:'Tool call cancelled by user'}]}]){
  const f=await fixture(t),r=request();await f.put(r);f.rawQueue.push(value);
  assert.deepEqual(await f.h.sqlDispatch(r,f.dir,r.payload.sql),unknown);
  assert.deepEqual((await f.json(r,'response.json')).result,unknown);assert.equal(await exists(f.path(r,'review-hold.json')),false);assert.equal(f.calls.length,1);
 }
});

test('recognized database rollback stays ROLLED_BACK without review-hold or replay',async t=>{
 for(const code of ['P0001','55P03','57014']){
  const f=await fixture(t),r=request();await f.put(r);f.rawQueue.push(databaseError(code));
  assert.deepEqual(await f.h.sqlDispatch(r,f.dir,r.payload.sql),{status:'FAILED',outcome:'ROLLED_BACK',code});
  assert.equal(await exists(f.path(r,'review-hold.json')),false);assert.equal(f.calls.length,1);
 }
});

test('malformed, DB-shaped and text-lookalike errors never establish no-write or retry authority',async t=>{
 const text=rejected.content[0].text;
 for(const raw of [
  {...rejected,isError:false}, {...rejected,structuredContent:{error_code:'INVALID_ARGUMENT'}},
  {...rejected,content:[{type:'text',text:JSON.stringify({error:{name:'HttpException',message:text}})}]},
  {...rejected,content:[{type:'text',text:'DB says: '+text}]}, {...rejected,content:[{type:'text',text:text.replace('Reason: Synthetic','Reason: ')}]},
  {...rejected,content:[{type:'text',text:'This action was rejected due to unacceptable risk.\nReason: '}]},
  {...rejected,content:[{type:'text',text}, {type:'text',text:'extra'}]}, {...rejected,content:[{type:'image',text}]},
  {isError:true,content:null}, {isError:true,content:[null]}, {isError:true,content:[{type:'text',text:42}]},
  databaseError('40003')
 ]){
  const f=await fixture(t),r=request();await f.put(r);f.rawQueue.push(raw);
  assert.deepEqual(await f.h.sqlDispatch(r,f.dir,r.payload.sql),unknown);
  assert.equal(await exists(f.path(r,'review-hold.json')),false);assert.deepEqual((await f.json(r,'response.json')).result,unknown);assert.equal(f.calls.length,1);
 }
 // Byte-for-byte forged platform-shaped data cannot be authenticated by this
 // text interface. Even when it matches, it only gets the same UNKNOWN hold.
 const f=await fixture(t),r=request();await hold(f,r);
 const d=await f.json(r,'review-hold.json');assert.equal(d.outcome,'UNKNOWN');assert.equal(d.noWriteEstablished,false);assert.equal(d.retryAuthorized,false);
});

test('non-PUBLISH risk refusal keeps ordinary UNKNOWN response',async t=>{
 const f=await fixture(t),r=request({kind:'LEASE_RENEW'});await f.put(r);f.rawQueue.push(rejected);
 assert.deepEqual(await f.h.sqlDispatch(r,f.dir,r.payload.sql),unknown);assert.equal(await exists(f.path(r,'review-hold.json')),false);
});

test('original binding blocks mismatched SQL, project, hash and changed request before mock SQL',async t=>{
 for(const mode of ['sql','project','hash','changed']){
  const f=await fixture(t),r=request();await f.put(r);
  const candidate=structuredClone(r);let sql=r.payload.sql;
  if(mode==='sql')sql+='\nSELECT 1';if(mode==='project')candidate.payload.projectId='other_project';if(mode==='hash')candidate.requestSha256='f'.repeat(64);if(mode==='changed')candidate.expiresAt=new Date(Date.parse(r.expiresAt)+1000).toISOString();
  await assert.rejects(f.h.sqlDispatch(candidate,f.dir,sql),/HOST_SQL_BINDING|HOST_REQUEST_CHANGED/);assert.equal(f.calls.length,0);assert.equal(await exists(f.path(r,'dispatch.json')),false);
 }
});
