import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

const source=await readFile(new URL('./host-helper-functions.js',import.meta.url),'utf8');
const fixture=JSON.parse(await readFile(new URL('./fixed-read-fixture.json',import.meta.url),'utf8'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const hash=s=>createHash('sha256').update(s).digest('hex');
const initial=Date.parse('2026-10-05T21:35:57.000Z');
const iso=t=>new Date(t).toISOString();

async function harness(t,{kind='READ_PUBLICATION_CONTEXT',sql=fixture.sql,steps=[],mutateDiskOnRetry=false,expires=initial+1640000}={}){
 t.mock.timers.enable({apis:['Date'],now:initial});
 const body={schemaVersion:1,requestId:randomUUID(),kind,expiresAt:iso(expires),payload:{projectId:fixture.cfg.project,sql,dispatchBefore:iso(expires-25000)}};
 const request={...body,requestSha256:hash(JSON.stringify(body))};
 const events=[],saved=[],stores=new Map();let calls=0,reads=0;
 const tools={
  exec_command:async({cmd})=>{
   if(cmd.includes(' mark-dispatch ')){events.push('mark');return {exit_code:0,output:'{}'};}
   if(cmd.includes(' respond ')){events.push('respond');return {exit_code:0,output:'{}'};}
   reads++;let disk=request;
   if(mutateDiskOnRetry&&reads>1)disk={...request,payload:{...request.payload,sql:'SELECT altered'}};
   const bytes=JSON.stringify(disk);return {exit_code:0,output:JSON.stringify({text:bytes,sha256:hash(bytes),charCount:bytes.length,next:null})};
  },
  apply_patch:async patch=>{events.push('save');const lines=patch.split('\n').filter(x=>x.startsWith('+')).map(x=>x.slice(1));saved.push(JSON.parse(lines.join('\n')));return {};},
  mcp__codex_apps__supabase_execute_sql:async args=>{
   events.push('sql');calls++;assert.deepEqual(args,{project_id:request.payload.projectId,query:request.payload.sql});
   const started=Date.now(),step=steps[calls-1]??{};
   t.mock.timers.setTime(started+(step.delay??1000));
   if(step.throw)throw new Error(step.throw);
   if(step.rawError)return step.rawError;
   const checkedAt=step.checkedAt??iso(started+500);
   const context={checkedAt,sourceId:fixture.cfg.sourceId,sourceConfigSha256:fixture.cfg.sourceConfigSha256,candidateRow:{id:fixture.candidateId},jobs:[],...step.context};
   const rows=kind==='READ_PUBLICATION_CONTEXT'?[{context}]:[];
   return {content:[{type:'text',text:JSON.stringify({result:'\n<untrusted-data-test>\n'+JSON.stringify(rows)+'\n</untrusted-data-test>'})}]};
  }
 };
 const helper=await new AsyncFunction('tools','load','store','notify',source)(tools,()=>fixture.cfg,(k,v)=>stores.set(k,v),()=>{});
 return {request,events,saved,stores,run:()=>helper.sqlDispatch(request,'/synthetic',request.payload.sql),calls:()=>calls};
}

test('normal fixed context read dispatches, marks and responds exactly once',async t=>{
 const h=await harness(t);const result=await h.run();assert.equal(result.status,'SUCCEEDED');assert.equal(h.calls(),1);
 assert.deepEqual(h.events,['mark','sql','save','respond']);assert.equal(result.rows[0].context.checkedAt,iso(initial+500));
});
test('old then fresh: one same-query reread, original marker, original response bytes retained',async t=>{
 const h=await harness(t,{steps:[{delay:223000},{delay:1000}]});const result=await h.run();assert.equal(h.calls(),2);
 assert.equal(h.events.filter(x=>x==='mark').length,1);assert.equal(h.events.filter(x=>x==='respond').length,1);
 assert.equal(result.rows[0].context.checkedAt,iso(initial+223500));
 const attempts=h.saved[0].diagnostic.contextReadAttempts;assert.equal(attempts.length,2);
 const oldRaw=JSON.parse(attempts[0].toolResult.content[0].text).result;assert.ok(oldRaw.includes(iso(initial+500)));
 assert.equal(h.request.expiresAt,iso(initial+1640000));assert.equal(h.request.payload.dispatchBefore,iso(initial+1615000));
});
test('old then old: stop after one refresh and preserve the real stale response for producer rejection',async t=>{
 const h=await harness(t,{steps:[{delay:223000},{delay:223000}]});const result=await h.run();assert.equal(h.calls(),2);
 assert.equal(result.status,'SUCCEEDED');const checked=Date.parse(result.rows[0].context.checkedAt);assert.ok(checked<Date.now()-61000);
 assert.equal(h.saved[0].diagnostic.contextReadAttempts.length,2);assert.equal(h.events.filter(x=>x==='mark').length,1);
});
test('first SQL completes after original total deadline: no refresh and no retimestamp',async t=>{
 const h=await harness(t,{expires:initial+100000,steps:[{delay:223000}]});const result=await h.run();assert.equal(h.calls(),1);
 assert.equal(result.rows[0].context.checkedAt,iso(initial+500));assert.equal(h.saved[0].diagnostic.responseExpired,true);
});
test('dispatch reserve exhausted but overall deadline open: no refresh',async t=>{
 const h=await harness(t,{expires:initial+240000,steps:[{delay:223000}]});const result=await h.run();assert.equal(h.calls(),1);
 assert.equal(result.rows[0].context.checkedAt,iso(initial+500));assert.ok(Date.now()<Date.parse(h.request.expiresAt));
});
test('query errors retain original error envelope and never trigger reread',async t=>{
 const raw={isError:true,content:[{type:'text',text:'original SQL error'}]};
 const h=await harness(t,{steps:[{rawError:raw}]});const result=await h.run();assert.equal(h.calls(),1);
 assert.deepEqual(result,{status:'FAILED',outcome:'UNKNOWN',code:'UNKNOWN'});assert.deepEqual(h.saved[0].diagnostic.toolResult,raw);
});
test('a thrown transport error is not retried',async t=>{
 const h=await harness(t,{steps:[{throw:'original transport exception'}]});const result=await h.run();assert.equal(h.calls(),1);
 assert.equal(result.status,'FAILED');assert.match(h.saved[0].diagnostic.error.message,/original transport exception/);
});
test('PUBLISH and lease writes are never retried',async t=>{
 for(const kind of ['PUBLISH','LEASE_ACQUIRE','LEASE_RENEW','LEASE_RELEASE']){
  const h=await harness(t,{kind,sql:'synthetic write, never sent to DB',steps:[{delay:223000}]});
  const result=await h.run();assert.equal(result.status,'SUCCEEDED');assert.equal(h.calls(),1);assert.equal(h.events.filter(x=>x==='mark').length,1);
  t.mock.timers.reset();
 }
});
test('same kind with any changed fixed SQL is rejected before dispatch',async t=>{
 const h=await harness(t,{sql:fixture.sql+' SELECT 1;'});await assert.rejects(h.run(),/HOST_PUBLICATION_CONTEXT_SQL_BINDING/);assert.equal(h.calls(),0);assert.deepEqual(h.events,[]);
});
test('wrong source, config or candidate context fails closed without reread',async t=>{
 for(const context of [{sourceId:'wrong'},{sourceConfigSha256:'wrong'},{candidateRow:{id:'wrong'}}]){
  const h=await harness(t,{steps:[{delay:223000,context}]});const result=await h.run();assert.equal(h.calls(),1);assert.equal(result.status,'FAILED');
  assert.match(h.saved[0].diagnostic.error.message,/HOST_PUBLICATION_CONTEXT_IDENTITY/);t.mock.timers.reset();
 }
});
test('request mutation between reads blocks refresh without deleting the marker',async t=>{
 const h=await harness(t,{mutateDiskOnRetry:true,steps:[{delay:223000}]});const result=await h.run();assert.equal(h.calls(),1);assert.equal(result.status,'FAILED');
 assert.equal(h.events.filter(x=>x==='mark').length,1);assert.match(h.saved[0].diagnostic.error.message,/HOST_REQUEST_CHANGED/);
});
test('invalid, future and pre-attempt timestamps are unchanged and not retried',async t=>{
 for(const checkedAt of ['invalid',iso(initial+100000),iso(initial-2000)]){
  const h=await harness(t,{steps:[{checkedAt}]});const result=await h.run();assert.equal(h.calls(),1);assert.equal(result.rows[0].context.checkedAt,checkedAt);t.mock.timers.reset();
 }
});
test('original dispatch deadline is enforced immediately before initial SQL',async t=>{
 const h=await harness(t,{expires:initial+25000});await assert.rejects(h.run(),/HOST_LOCAL_COMMAND_BUDGET_EXHAUSTED/);assert.equal(h.calls(),0);
 assert.deepEqual(h.events,[]);
});
