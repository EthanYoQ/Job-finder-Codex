import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,request,unknown,successful,root,exists,sha} from './harness.mjs';
const canonical=join(root,'../review-response-hold-20261006T1347Z');
const refused={isError:true,content:[{type:'text',text:'This action was rejected due to unacceptable risk.\nReason: Synthetic offline target verification.'}]};

for(const source of ['grifols','biogen']){
 test(source+': exact source adaptation and recorded before/after hashes',async()=>{
  const verification=JSON.parse(await readFile(join(root,'targets',source,'TARGET_VERIFICATION.json'),'utf8'));
  for(const change of verification.changes){
   const name=change.path.slice('host/'.length);
   for(const variant of ['baseline','revised']){
    const reference=await readFile(join(canonical,variant,name),'utf8');
    const bytes=await readFile(join(root,'targets',source,variant,name));
    const expected=reference.replaceAll(':merck:',':'+source+':').replaceAll('source-merck-china-social','source-'+source+'-china-social').replaceAll('/hosts-next/merck/host/','/hosts-next/'+source+'/host/');
    assert.equal(bytes.toString(),expected);assert.equal(sha(bytes),change[variant==='baseline'?'beforeSha256':'afterSha256']);
   }
  }
 });
 test(source+': hold uses its namespace and path; original expiry drains to UNKNOWN with one SQL call',async t=>{
  const f=await fixture(t,'targets/'+source+'/revised'),r=request({duration:400,dispatchDuration:300});await f.put(r);f.rawQueue.push(refused);
  const out=await f.h.sqlDispatch(r,f.dir,r.payload.sql);assert.equal(out.status,'AWAITING_OWNER_RECONCILIATION');assert.equal(out.outcome,'UNKNOWN');
  assert.equal(await exists(f.path(r,'response.json')),false);assert.equal(await exists(f.path(r,'host-result.json')),false);
  assert.equal((await f.json(r,'dispatch.json')).state,'MAY_HAVE_BEEN_SENT');assert.equal((await f.json(r,'review-hold.json')).retryAuthorized,false);
  assert.ok([...f.memory.keys()].every(key=>key.startsWith('deadlineCandidate47b:'+source+':')));
  assert.ok(f.commands.every(command=>command.startsWith('env JOBFINDER_CLOUD_SOURCE_ID=source-'+source+'-china-social ')));
  assert.throws(()=>f.run('expire-undispatched',r.requestId,r.requestSha256),/REQUEST_NOT_EXPIRED/);
  await delay(Math.max(1,Date.parse(r.expiresAt)-Date.now()+10));assert.equal(await f.h.next(f.dir),undefined);
  assert.deepEqual((await f.json(r,'response.json')).result,unknown);assert.equal(f.calls.length,1);
  const before=await readFile(f.path(r,'response.json'),'utf8');
  await assert.rejects(f.h.respond(r,f.dir,{status:'SUCCEEDED',rows:[]}),/RESPONSE_ALREADY_EXISTS/);
  assert.equal(await readFile(f.path(r,'response.json'),'utf8'),before);assert.equal(f.calls.length,1);
 });
 test(source+': same-bound synthetic owner success is unique and never replayed by the helper',async t=>{
  const f=await fixture(t,'targets/'+source+'/revised'),r=request();await f.put(r);f.rawQueue.push(refused);await f.h.sqlDispatch(r,f.dir,r.payload.sql);
  await assert.rejects(f.h.sqlDispatch(r,f.dir,r.payload.sql),/EEXIST/);assert.equal(f.calls.length,1);
  // Fixture only: the unchanged external owner is responsible for actual
  // reconciliation and authorization. No new runtime authority is introduced.
  f.rawQueue.push(successful());const raw=await f.tools.mcp__codex_apps__supabase_execute_sql({project_id:r.payload.projectId,query:r.payload.sql});
  await f.h.respond(r,f.dir,{status:'SUCCEEDED',rows:f.h.rows(raw)});assert.equal((await f.json(r,'response.json')).result.status,'SUCCEEDED');
  const before=await readFile(f.path(r,'response.json'),'utf8');await assert.rejects(f.h.respond(r,f.dir,unknown),/EEXIST|RESPONSE_ALREADY_EXISTS/);
  assert.equal(await readFile(f.path(r,'response.json'),'utf8'),before);assert.equal(f.calls.length,2);
 });
}
test('the previously frozen canonical manifest is unchanged',async()=>{
 assert.equal(sha(await readFile(join(canonical,'DELIVERY_MANIFEST.json'))),'2b09c6371961d436831b425942a583c2135e135450605504a73f6633cab3d386');
});
