import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expected, fakePort } from './synthetic.mjs';

const source = readFileSync(new URL('../functions-bundle.js', import.meta.url), 'utf8');
function runtime() {
  const timers = new Map(); let next = 0;
  const set = (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; };
  const api = runInNewContext(source, { Date, setTimeout: set, clearTimeout: id => timers.delete(id) });
  return { api, timers, expire() { assert.equal(timers.size, 1); [...timers.values()][0].callback(); } };
}
async function flush() { for (let n = 0; n < 12; n++) await Promise.resolve(); }
test('standalone functions bundle needs no URL/performance/structuredClone/Node/tool globals', async () => {
  const { api } = runtime(), e = expected(), port = fakePort(e);
  assert.equal((await api.runPublicVerification({ expected: e, port })).status, 'PASS_LIST_AND_SOURCE_TIME_ONLY');
  assert.equal((await api.runPublicVerification({ expected: e })).reason, 'BROWSER_PORT_UNBOUND');
});
test('native timeout keeps exact pending port promise and late observation without retry', async () => {
  const { api, expire, timers } = runtime(), e = expected();
  let resolve; const pending = new Promise(r => { resolve = r; });
  const originalPort = fakePort(e); let actualObservation, calls = 0;
  const port = { enabled: true, kind: 'SYNTHETIC', targetKey: api.TARGET.key,
    execute(request) { calls++; originalPort.execute(request).then(o => { actualObservation = o; }); return pending; } };
  const controller = api.createPublicVerifier({ expected: e, port }), running = controller.run();
  await flush(); assert.equal([...timers.values()][0].ms, api.LIMITS.stepMs); expire();
  const r = await running; assert.equal(r.reason, 'BROWSER_PROTOCOL_TIMEOUT'); assert.equal(r.pendingActionOutcome, 'UNKNOWN');
  assert.equal(controller.pendingOperation, pending); assert.equal(calls, 1);
  resolve(actualObservation); await pending; await flush();
  assert.equal(controller.events.at(-1).outcome, 'LATE_OBSERVATION_NO_CONTINUATION');
  assert.equal(calls, 1); assert.equal(r.status, 'HOLD');
});
test('late non-timeout rejection is exposed with original identity and no continuation', async () => {
  const { api, expire } = runtime(), e = expected(); let reject;
  const pending = new Promise((_, r) => { reject = r; }); let calls = 0;
  const port = { enabled: true, kind: 'SYNTHETIC', targetKey: api.TARGET.key, execute() { calls++; return pending; } };
  const controller = api.createPublicVerifier({ expected: e, port }), running = controller.run();
  await flush(); expire(); assert.equal((await running).status, 'HOLD');
  const error = new Error('late ordinary exception'); reject(error); await flush();
  assert.equal(controller.lateError, error); assert.equal(controller.pendingOperation, pending);
  await assert.rejects(controller.pendingOperation, actual => actual === error);
  assert.equal(controller.events.at(-1).outcome, 'LATE_ERROR_NO_CONTINUATION'); assert.equal(calls, 1);
});
test('clock jumps forward do not permit further UI actions', async () => {
  let now = Date.now();
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const api = runInNewContext(source, { Date: TestDate, setTimeout, clearTimeout });
  const e = expected(), p = fakePort(e, { mutate(o) { now += 121_000; o.observedAt = new TestDate().toISOString(); } });
  const r = await api.runPublicVerification({ expected: e, port: p });
  assert.equal(r.reason, 'TOTAL_DEADLINE_EXPIRED'); assert.equal(p.calls.length, 1);
});
test('clock moves backwards holds instead of extending time budget', async () => {
  let now = Date.now();
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const api = runInNewContext(source, { Date: TestDate, setTimeout, clearTimeout });
  const e = expected(); let calls = 0;
  const p = fakePort(e, { mutate(o) { calls++; o.observedAt = new TestDate().toISOString(); if (calls === 1) now -= 1; } });
  const r = await api.runPublicVerification({ expected: e, port: p });
  // Even before deadline comparison, the impossible observation interval is fail closed.
  assert.equal(r.reason, 'UNVERIFIED_OBSERVATION_TIME'); assert.equal(p.calls.length, 1);
});
for (const elapsedMs of [15_000,16_000]) test(`settlement at ${elapsedMs}ms fails per-step deadline even before timer callback`, async () => {
  let now = Date.now(), calls = 0;
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const api = runInNewContext(source, { Date: TestDate, setTimeout, clearTimeout });
  const e = expected(), p = fakePort(e, { mutate(o) {
    if (calls++ === 0) now += elapsedMs;
    o.observedAt = new TestDate().toISOString();
  } });
  const r = await api.runPublicVerification({ expected: e, port: p });
  assert.equal(r.status, 'HOLD'); assert.equal(r.reason, 'STEP_DEADLINE_EXPIRED');
  assert.equal(p.calls.length, 1); assert.equal(r.events.at(-1).outcome, 'SETTLED_AFTER_DEADLINE_NO_CONTINUATION');
  assert.equal(Date.parse(r.events[0].finishedAt) - Date.parse(r.events[0].startedAt), elapsedMs);
});
for(const rewind of [false,true])test(`outer deadline poisons adapter before late tool settlement (clock rewind=${rewind})`,async()=>{
  const start=Date.now();let now=start,dateCalls=0,timer,calls=0,settle;
  class TestDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){if(++dateCalls===3)now+=5;return now;}}
  const api=runInNewContext(source,{Date:TestDate,setTimeout:fn=>(timer=fn,1),clearTimeout:()=>{}});
  const pending=new Promise(resolve=>settle=resolve);
  const decoder={kind:'REVIEWED_ACTUAL_AX_DECODER',assertStartupResult(){},decodeAx(){throw Error('must not observe after timeout');}};
  const port=api.createCuaBrowserPort({enabled:true,decoder,toolCall(){calls++;return pending;}});
  const controller=api.createPublicVerifier({expected:expected(),port}),running=controller.run();await flush();
  now=start+15000;timer();const result=await running;assert.equal(result.status,'HOLD');assert.equal(calls,1);
  if(rewind)now=start+100;
  settle({});await flush();assert.equal(calls,1);assert.equal(controller.events.at(-1).outcome,'LATE_ERROR_NO_CONTINUATION');
});
