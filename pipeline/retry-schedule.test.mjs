import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRetrySchedule,mergeRetrySources,readRetryCheckpoint,readRetrySources,retrySourcesSchema,roundIdSchema,roundManualIntervention,saveRetryCheckpoint,selectDueSourceIds,sourceRetryBackoffMs} from './retry-schedule.ts';
import {canStartScheduledSource} from '../runner-candidate/scripts/direct-round.ts';
import {mkdtemp,mkdir,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const now=Date.parse('2026-11-18T01:00:00Z');
const hashes=new Map([['source-amgen','a'.repeat(64)],['source-roche','b'.repeat(64)],['source-novo','c'.repeat(64)]]);
const ids=[...hashes.keys()];
const build=(changes={})=>buildRetrySchedule({sourceConfigHashes:hashes,completeSourceIds:new Set(),previous:[],
  attemptedSourceIds:new Set(),outcomes:[],now,...changes});

test('manual intervention stays with its slot through later successful automatic waves',()=>{
  const slot='1794950460000',roundId='a'.repeat(32);
  assert.equal(roundManualIntervention(slot,undefined,undefined),true);
  const manual={slot,manualIntervention:true};
  const automatic={slot,roundId,complete:true,manualIntervention:roundManualIntervention(slot,roundId,manual)};
  assert.equal(automatic.manualIntervention,true);
  assert.equal(roundManualIntervention(slot,'b'.repeat(32),automatic),true);
  assert.equal(roundManualIntervention(String(Number(slot)+24*3600_000),roundId,automatic),false);
  assert.equal(roundManualIntervention(null,undefined,manual),false);
});

test('legacy unattributed collection requires a genuine same-slot snapshot receipt',()=>{
  const slot='1794950460000',roundId='a'.repeat(32),sha256='b'.repeat(64);
  const legacy={slot,status:'SNAPSHOT_SAVED',sha256,snapshotFile:`/data/job-finder/snapshots/public-${sha256}.json`,capturedSources:[]};
  assert.equal(roundManualIntervention(slot,roundId,legacy),true);
  assert.equal(roundManualIntervention(slot,roundId,{slot,complete:false}),false);
  assert.equal(roundManualIntervention(slot,roundId,{...legacy,slot:'1794864060000'}),false);
  assert.equal(roundManualIntervention(slot,roundId,{...legacy,roundId,manualIntervention:false}),false);
  assert.equal(roundManualIntervention(slot,roundId,{...legacy,snapshotFile:undefined}),false);
});

test('two-hour Retry-After survives receipt serialization and waits until the exact deadline',()=>{
  const retryAt=now+2*3600_000;
  const schedule=build({completeSourceIds:new Set(['source-novo','source-roche']),attemptedSourceIds:new Set(['source-amgen']),
    outcomes:[{sourceId:'source-amgen',retryAt,lastActualRequestAt:now}]});
  const persisted=readRetrySources(JSON.parse(JSON.stringify(schedule)),hashes);
  assert.equal(schedule.nextRetryAt,retryAt);
  assert.deepEqual(selectDueSourceIds(ids,new Set(['source-novo','source-roche']),persisted,retryAt-1),[]);
  assert.deepEqual(selectDueSourceIds(ids,new Set(['source-novo','source-roche']),persisted,retryAt),['source-amgen']);
});

test('successful source is removed even if a stale scheduling record says it is due',()=>{
  const previous=[{sourceId:'source-amgen',retryAt:now-1}];
  const completeSourceIds=new Set(['source-amgen']);
  assert.deepEqual(selectDueSourceIds(ids,completeSourceIds,previous,now),['source-roche','source-novo']);
  assert.equal(build({previous,completeSourceIds}).retrySources.some(row=>row.sourceId==='source-amgen'),false);
});

test('deferred sources keep their deadline and request history without consuming an actual request',()=>{
  const previous=[{sourceId:'source-amgen',retryAt:now+7200_000,lastActualRequestAt:now-1000,actualRequestCount:4}];
  const schedule=build({previous,attemptedSourceIds:new Set(['source-amgen']),
    outcomes:[{sourceId:'source-amgen',retryAt:now+7200_000}]});
  const deferred=schedule.retrySources.find(row=>row.sourceId==='source-amgen');
  assert.equal(deferred.retryAt,previous[0].retryAt);
  assert.equal(deferred.lastActualRequestAt,previous[0].lastActualRequestAt);
  assert.equal(deferred.actualRequestCount,4);
});

test('sources with no actual observation are tried before the tenant requested most recently',()=>{
  const previous=[{sourceId:'source-amgen',retryAt:now,lastActualRequestAt:now-1},
    {sourceId:'source-roche',retryAt:now,lastActualRequestAt:now-2}];
  assert.deepEqual(selectDueSourceIds(ids,new Set(),previous,now),['source-novo','source-roche','source-amgen']);
});

test('local deferral does not renew cooling, while a real refusal keeps the policy backoff',()=>{
  const retryAt=now+60_000;
  const base={attemptedSourceIds:new Set(['source-amgen'])};
  const deferred=build({...base,outcomes:[{sourceId:'source-amgen',retryAt,locallyDeferred:true,observedActualHttp:false}]});
  assert.equal(deferred.retrySources.find(row=>row.sourceId==='source-amgen').retryAt,retryAt);
  const refused=build({...base,outcomes:[{sourceId:'source-amgen',retryAt,locallyDeferred:true,observedActualHttp:true}]});
  assert.equal(refused.retrySources.find(row=>row.sourceId==='source-amgen').retryAt,now+sourceRetryBackoffMs);
});

test('an idle activation does not restart the backoff clock',()=>{
  const previous=ids.map(sourceId=>({sourceId,retryAt:now+300_000}));
  const schedule=build({previous,now:now+60_000});
  assert.equal(schedule.nextRetryAt,now+300_000);
  assert.deepEqual(selectDueSourceIds(ids,new Set(),schedule.retrySources,now+60_000),[]);
});

test('incomplete observed execution uses fallback backoff but does not invent request counts',()=>{
  const schedule=build({attemptedSourceIds:new Set(ids)});
  assert.equal(schedule.nextRetryAt,now+sourceRetryBackoffMs);
  assert.ok(schedule.retrySources.every(row=>row.actualRequestCount===undefined&&row.lastActualRequestAt===undefined));
});

test('completed round has no next retry, while untouched pending sources remain due',()=>{
  assert.deepEqual(build({completeSourceIds:new Set(ids)}),{retrySources:[]});
  assert.equal(build().nextRetryAt,now);
});

test('legacy receipts are accepted, incompatible source configurations are not reused',()=>{
  assert.deepEqual(readRetrySources({slot:'1794950460000',complete:false},hashes),[]);
  const schedule=build();
  assert.equal(readRetrySources(schedule,new Map([['source-amgen','d'.repeat(64)]])).length,0);
});

test('cooldown deadline remains valid across daily slot changes',()=>{
  const retryAt=now+30*3600_000;
  const previous=readRetrySources({slot:'1794864060000',retrySources:[{sourceId:'source-amgen',retryAt}]},hashes);
  assert.deepEqual(selectDueSourceIds(['source-amgen'],new Set(),previous,now+24*3600_000),[]);
});

test('invalid schedules fail closed and round IDs cannot contain path segments',()=>{
  for(const rows of [[{sourceId:'source-amgen',retryAt:-1}],Array(37).fill({sourceId:'source-amgen',retryAt:now}),
    [{sourceId:'source-amgen',retryAt:now},{sourceId:'source-amgen',retryAt:now}]]) {
    assert.equal(retrySourcesSchema.safeParse(rows).success,false);
  }
  assert.equal(roundIdSchema.safeParse('../round').success,false);
  assert.equal(roundIdSchema.safeParse('a'.repeat(32)).success,true);
});

test('automatic collection stops starting sources at the exact slot boundary',()=>{
  assert.equal(canStartScheduledSource(now,now-1),false);
  assert.equal(canStartScheduledSource(now,now),true);
  assert.equal(canStartScheduledSource(now,now+24*3600_000-1),true);
  assert.equal(canStartScheduledSource(now,now+24*3600_000),false);
  const pending=build({previous:[{sourceId:'source-amgen',retryAt:now-1000}],attemptedSourceIds:new Set()});
  assert.equal(pending.retrySources.find(row=>row.sourceId==='source-amgen').retryAt,now-1000);
});

test('source Retry-After checkpoint survives a crash before the wave receipt is written',async t=>{
  const cache=resolve('.runtime/.cache');
  await mkdir(cache,{recursive:true});
  const root=await mkdtemp(join(cache,'retry-checkpoint-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'source-retry-checkpoint.json');
  assert.deepEqual(readRetryCheckpoint(file,hashes),[]);
  const retryAt=now+2*3600_000;
  const checkpoint=build({completeSourceIds:new Set(['source-amgen','source-roche']),attemptedSourceIds:new Set(['source-novo']),
    outcomes:[{sourceId:'source-novo',retryAt,observedActualHttp:true,lastActualRequestAt:now}]}).retrySources;
  saveRetryCheckpoint(file,checkpoint);
  // Simulate a new collector process with an older receipt and the durable source checkpoint.
  const restored=mergeRetrySources([{sourceId:'source-novo',retryAt:now}],readRetryCheckpoint(file,hashes));
  assert.deepEqual(selectDueSourceIds(['source-novo'],new Set(),restored,retryAt-1),[]);
  assert.deepEqual(selectDueSourceIds(['source-novo'],new Set(),restored,retryAt),['source-novo']);
  assert.deepEqual(await readdir(root),['source-retry-checkpoint.json']);
  assert.equal(restored[0].lastActualRequestAt,now);
});
