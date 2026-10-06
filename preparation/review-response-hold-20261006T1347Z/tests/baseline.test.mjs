import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,request,unknown,successful,waitFor,child,exists} from './harness.mjs';

test('old handler irreversibly publishes UNKNOWN before owner can report an actual success',async t=>{
 const f=await fixture(t,'baseline'),c=await child(t,f,1200);
 f.rawQueue.push({isError:true,content:[{type:'text',text:'SYNTHETIC TOOL FAILURE'}]});
 assert.deepEqual(await f.h.sqlDispatch(c.r,f.dir,c.r.payload.sql),unknown);
 await waitFor(()=>c.events.find(e=>e.event==='FAILED'));
 assert.equal(c.events.find(e=>e.event==='ACKNOWLEDGED'),undefined);
 const before=await readFile(f.path(c.r,'response.json'),'utf8');
 await assert.rejects(f.h.respond(c.r,f.dir,{status:'SUCCEEDED',rows:[]}),/EEXIST|RESPONSE_ALREADY_EXISTS/);
 assert.equal(await readFile(f.path(c.r,'response.json'),'utf8'),before);
 assert.ok(!c.events.some(e=>e.event==='READ_OUTCOME'));
 const read=await waitFor(()=>c.events.find(e=>e.event==='READ_OUTCOME'));
 assert.ok(read.at>=Date.parse(c.r.expiresAt));
 const next=await waitFor(()=>f.h.next(f.dir));assert.equal(next.kind,'READ_OUTCOME');
 f.rawQueue.push(successful());await f.h.sqlDispatch(next,f.dir,next.payload.sql);
 assert.equal((await c.finished).code,0);
 assert.equal(f.calls.length,2);
});

test('omitting a response alone leaves two pending requests after the unchanged deadline',async t=>{
 const f=await fixture(t,'baseline'),c=await child(t,f,800);
 await f.h.mark(c.r,f.dir);
 await waitFor(()=>c.events.find(e=>e.event==='READ_OUTCOME'));
 await waitFor(()=>f.run('next-meta').length===2);
 await assert.rejects(f.h.next(f.dir),/HOST_MULTIPLE_PENDING_REQUESTS/);
 assert.equal(await exists(f.path(c.r,'response.json')),false);
 assert.equal(f.calls.length,0);
});

test('existing dispatch marker prevents a second sqlDispatch even before expiry',async t=>{
 const f=await fixture(t,'baseline'),r=request();await f.put(r);f.rawQueue.push(successful());
 await f.h.sqlDispatch(r,f.dir,r.payload.sql);
 await assert.rejects(f.h.sqlDispatch(r,f.dir,r.payload.sql),/EEXIST/);
 assert.equal(f.calls.length,1);
});
