import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,request,unknown,successful,exists,waitFor,child} from './harness.mjs';
const rejected={content:[{type:'text',text:'This action was rejected due to unacceptable risk.\nReason: Synthetic offline refusal.'}],isError:true};
const expire=(f,r)=>f.run('expire-undispatched',r.requestId,r.requestSha256);
async function seed(f,{kind='PUBLISH',marker=true,hold=true}={}){
 const r=request({kind,duration:-100,dispatchDuration:-200});await f.put(r);
 if(marker)await writeFile(f.path(r,'dispatch.json'),JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,state:'MAY_HAVE_BEEN_SENT',markedAt:new Date(Date.now()-300).toISOString()}),{flag:'wx'});
 if(hold)await writeFile(f.path(r,'review-hold.json'),JSON.stringify({schemaVersion:1,classification:'PLATFORM_RISK_REVIEW_HOLD',requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,projectId:r.payload.projectId,dispatchBefore:r.payload.dispatchBefore,expiresAt:r.expiresAt,outcome:'UNKNOWN',noWriteEstablished:false,retryAuthorized:false,recordedAt:new Date(Date.now()-200).toISOString()}),{flag:'wx'});
 return r;
}
async function cli(f,...args){
 const proc=spawn(process.execPath,[join(f.host,'relay-files.mjs'),...args],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);
 return new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('exit',code=>resolve({code,stdout,stderr}));});
}

test('original expiry converts only a bound hold to one UNKNOWN and drains the real child READ_OUTCOME',async t=>{
 const f=await fixture(t),c=await child(t,f,1000);f.rawQueue.push(rejected);
 await f.h.sqlDispatch(c.r,f.dir,c.r.payload.sql);
 const marker=await readFile(f.path(c.r,'dispatch.json'),'utf8'),hold=await readFile(f.path(c.r,'review-hold.json'),'utf8');
 assert.throws(()=>expire(f,c.r),/REQUEST_NOT_EXPIRED/);assert.equal(await exists(f.path(c.r,'response.json')),false);
 const read=await waitFor(()=>c.events.find(e=>e.event==='READ_OUTCOME'));assert.ok(read.at>=Date.parse(c.r.expiresAt));
 await waitFor(()=>f.run('next-meta').length===2);
 const next=await f.h.next(f.dir);assert.equal(next.kind,'READ_OUTCOME');
 assert.deepEqual((await f.json(c.r,'response.json')).result,unknown);assert.equal(f.calls.length,1);
 assert.equal(await readFile(f.path(c.r,'dispatch.json'),'utf8'),marker);assert.equal(await readFile(f.path(c.r,'review-hold.json'),'utf8'),hold);
 f.rawQueue.push(successful());await f.h.sqlDispatch(next,f.dir,next.payload.sql);
 assert.equal((await c.finished).code,0);assert.equal(f.calls.length,2);assert.ok(c.events.find(e=>e.event==='DONE').at<Date.parse(c.r.expiresAt)+5000);
});

test('success before expiry wins permanently, including a stale-metadata expiry call',async t=>{
 const f=await fixture(t),r=request({duration:400,dispatchDuration:250});await f.put(r);f.rawQueue.push(rejected);await f.h.sqlDispatch(r,f.dir,r.payload.sql);
 assert.equal(f.run('next-meta').length,1);
 await f.h.respond(r,f.dir,{status:'SUCCEEDED',rows:[]});const before=await readFile(f.path(r,'response.json'),'utf8');
 await delay(Math.max(1,Date.parse(r.expiresAt)-Date.now()+5));assert.equal(expire(f,r).settled,true);
 assert.equal(await readFile(f.path(r,'response.json'),'utf8'),before);assert.equal(await f.h.next(f.dir),undefined);assert.equal(f.calls.length,1);
});

test('expiry UNKNOWN is idempotent and rejects a later success without changing the final response',async t=>{
 const f=await fixture(t),r=await seed(f),marker=await readFile(f.path(r,'dispatch.json'),'utf8');
 assert.equal(expire(f,r).settled,true);const before=await readFile(f.path(r,'response.json'),'utf8');
 assert.equal(expire(f,r).settled,true);assert.equal(await readFile(f.path(r,'response.json'),'utf8'),before);
 await assert.rejects(f.h.respond(r,f.dir,{status:'SUCCEEDED',rows:[]}),/RESPONSE_ALREADY_EXISTS/);
 assert.equal(await readFile(f.path(r,'response.json'),'utf8'),before);assert.equal(await readFile(f.path(r,'dispatch.json'),'utf8'),marker);assert.equal(f.calls.length,0);
});

test('concurrent owner success and expiry have exactly one immutable response winner',async t=>{
 for(let i=0;i<6;i++){
  const f=await fixture(t),r=await seed(f),result={status:'SUCCEEDED',rows:[]};
  await f.h.save(f.path(r,'host-result.json'),{requestId:r.requestId,requestSha256:r.requestSha256,result});
  const [a,b]=await Promise.all([cli(f,'respond',f.dir,f.path(r,'host-result.json')),cli(f,'expire-undispatched',f.dir,r.requestId,r.requestSha256)]);
  assert.equal(b.code,0);assert.ok(a.code===0||/EEXIST|RESPONSE_ALREADY_EXISTS/.test(a.stderr));
  const bytes=await readFile(f.path(r,'response.json'),'utf8'),final=JSON.parse(bytes);
  assert.equal(final.requestSha256,r.requestSha256);assert.deepEqual(final.result,a.code===0?result:unknown);
  assert.equal(expire(f,r).settled,true);assert.equal(await readFile(f.path(r,'response.json'),'utf8'),bytes);assert.equal(f.calls.length,0);
 }
});

test('without a hold, dispatched PUBLISH and non-PUBLISH requests keep DISPATCH_UNCERTAIN',async t=>{
 for(const options of [{hold:false},{kind:'LEASE_RENEW'}]){
  const f=await fixture(t),r=await seed(f,options);assert.deepEqual(expire(f,r),{settled:false,reason:'DISPATCH_UNCERTAIN',requestId:r.requestId});
  assert.equal(await exists(f.path(r,'response.json')),false);assert.equal(f.calls.length,0);
 }
});

test('wrong-bound, malformed, symlink or untrusted-authority holds fail closed at expiry',async t=>{
 const mutations={requestId:'00000000-0000-4000-8000-000000000000',requestSha256:'f'.repeat(64),kind:'LEASE_RENEW',projectId:'wrong_project',dispatchBefore:'2000-01-01T00:00:00.000Z',expiresAt:'2000-01-01T00:00:00.000Z',classification:'OTHER',outcome:'NOT_DISPATCHED',noWriteEstablished:true,retryAuthorized:true,schemaVersion:2,recordedAt:'invalid',extra:true};
 for(const [key,value] of Object.entries(mutations)){
  const f=await fixture(t),r=await seed(f),h=await f.json(r,'review-hold.json');h[key]=value;await writeFile(f.path(r,'review-hold.json'),JSON.stringify(h));
  assert.throws(()=>expire(f,r),/REVIEW_HOLD_BINDING/);assert.equal(await exists(f.path(r,'response.json')),false);assert.equal(f.calls.length,0);
 }
 for(const mode of ['malformed','symlink']){
  const f=await fixture(t),r=await seed(f);
  if(mode==='malformed')await writeFile(f.path(r,'review-hold.json'),'{');
  else {await unlink(f.path(r,'review-hold.json'));await symlink(f.path(r,'request.json'),f.path(r,'review-hold.json'));}
  assert.throws(()=>expire(f,r),/JSON|REVIEW_HOLD_FILE/);assert.equal(await exists(f.path(r,'response.json')),false);
 }
});

test('hold cannot turn a missing, wrong-bound or NOT_DISPATCHED marker into proof of no write',async t=>{
 for(const mode of ['missing','wrong','not-dispatched']){
  const f=await fixture(t),r=await seed(f,{marker:mode!=='missing'});
  if(mode!=='missing'){const m=await f.json(r,'dispatch.json');if(mode==='wrong')m.requestSha256='f'.repeat(64);else m.state='NOT_DISPATCHED';await writeFile(f.path(r,'dispatch.json'),JSON.stringify(m));}
  assert.throws(()=>expire(f,r),/ENOENT|DISPATCH_BINDING/);assert.equal(await exists(f.path(r,'response.json')),false);
  if(mode==='missing')assert.equal(await exists(f.path(r,'dispatch.json')),false);assert.equal(f.calls.length,0);
 }
});

test('unheld, undispatched expiry still produces the original NOT_DISPATCHED result',async t=>{
 const f=await fixture(t),r=await seed(f,{marker:false,hold:false});assert.equal(expire(f,r).settled,true);
 assert.deepEqual((await f.json(r,'response.json')).result,{status:'FAILED',outcome:'NOT_DISPATCHED',code:'REQUEST_EXPIRED'});assert.equal(f.calls.length,0);
});

test('an existing response for another binding is never overwritten or accepted as settled',async t=>{
 const f=await fixture(t),r=await seed(f),wrong={schemaVersion:1,requestId:r.requestId,requestSha256:'f'.repeat(64),kind:r.kind,result:{status:'SUCCEEDED',rows:[]}};
 const bytes=JSON.stringify(wrong);await writeFile(f.path(r,'response.json'),bytes,{flag:'wx'});
 assert.throws(()=>expire(f,r),/RESPONSE_ALREADY_EXISTS/);assert.equal(await readFile(f.path(r,'response.json'),'utf8'),bytes);assert.equal(f.calls.length,0);
});
