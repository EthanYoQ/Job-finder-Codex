import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,request,unknown,root,exists} from './harness.mjs';
test('Astellas target differs only in existing namespace, source environment and relay directory',async()=>{
 for(const name of ['host-helper-functions.js','relay-files.mjs'])for(const variant of ['baseline','revised']){
  const canonical=await readFile(join(root,variant,name),'utf8');
  const target=await readFile(join(root,'targets/astellas',variant,name),'utf8');
  assert.equal(target,canonical.replaceAll(':merck:',':astellas:').replaceAll('source-merck-china-social','source-astellas-china-social').replaceAll('/hosts-next/merck/host/','/hosts-next/astellas/host/'));
 }
});
test('exact Astellas candidate handles hold and original expiry with no extra mock SQL',async t=>{
 const f=await fixture(t,'targets/astellas/revised'),r=request({duration:300,dispatchDuration:200});await f.put(r);
 f.rawQueue.push({isError:true,content:[{type:'text',text:'This action was rejected due to unacceptable risk.\nReason: Synthetic test.'}]});
 const result=await f.h.sqlDispatch(r,f.dir,r.payload.sql);assert.equal(result.responseDeferred,true);assert.equal(await exists(f.path(r,'response.json')),false);
 await delay(Math.max(1,Date.parse(r.expiresAt)-Date.now()+5));assert.equal(await f.h.next(f.dir),undefined);
 assert.deepEqual((await f.json(r,'response.json')).result,unknown);assert.equal(f.calls.length,1);
});
