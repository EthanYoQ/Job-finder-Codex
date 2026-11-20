import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRetrySchedule,maxDailyTransientRetries,mergeRetrySources,readRetryCheckpoint,readRetrySources,retrySourcesSchema,roundIdSchema,roundManualIntervention,saveRetryCheckpoint,selectDueSourceIds,shouldCountRoundRetryAttempt,sourceRetryBackoffMs} from './retry-schedule.ts';
import {dailySlotMs,slotAt} from './frequency.mjs';
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

test('legacy provenance uses the configured snapshots directory and rejects another root',()=>{
  const slot='1794950460000',roundId='a'.repeat(32),sha256='b'.repeat(64);
  const snapshots=resolve('.runtime/.cache/custom-collector/snapshots');
  const legacy={slot,status:'SNAPSHOT_SAVED',sha256,snapshotFile:join(snapshots,`public-${sha256}.json`),capturedSources:[]};
  assert.equal(roundManualIntervention(slot,roundId,legacy,snapshots),true);
  assert.equal(roundManualIntervention(slot,roundId,legacy,resolve('.runtime/.cache/other/snapshots')),false);
  assert.equal(roundManualIntervention(slot,roundId,{...legacy,snapshotFile:`public-${sha256}.json`},snapshots),false);
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

test('CSL real response time anchors the policy floor instead of the later wave completion',()=>{
  const sourceId='source-csl-china-social',actualResponseAt=1794975468412,observedRetryAt=1794977868412;
  const finishedAt=1794977565790;
  const schedule=buildRetrySchedule({sourceConfigHashes:new Map([[sourceId,'a'.repeat(64)]]),completeSourceIds:new Set(),
    previous:[{sourceId,retryAt:observedRetryAt,lastActualRequestAt:actualResponseAt}],attemptedSourceIds:new Set([sourceId]),
    outcomes:[{sourceId,retryAt:observedRetryAt,observedActualHttp:true,lastActualRequestAt:actualResponseAt}],now:finishedAt});
  assert.equal(schedule.nextRetryAt,observedRetryAt);
  assert.equal(schedule.retrySources[0].lastActualRequestAt,actualResponseAt);
  assert.deepEqual(selectDueSourceIds([sourceId],new Set(),schedule.retrySources,observedRetryAt-1),[]);
  assert.deepEqual(selectDueSourceIds([sourceId],new Set(),schedule.retrySources,observedRetryAt),[sourceId]);
});

test('response-clock backoff preserves its policy minimum and longer official or persisted deadlines',()=>{
  const actualResponseAt=now-35*60_000;
  for(const [officialRetryAt,previousRetryAt] of [
    [actualResponseAt+60_000,0], [actualResponseAt+2*3600_000,0], [actualResponseAt+2*3600_000,actualResponseAt+3*3600_000]
  ]) {
    const schedule=build({completeSourceIds:new Set(['source-roche','source-novo']),attemptedSourceIds:new Set(['source-amgen']),
      previous:previousRetryAt?[{sourceId:'source-amgen',retryAt:previousRetryAt}]:[],
      outcomes:[{sourceId:'source-amgen',retryAt:officialRetryAt,observedActualHttp:true,lastActualRequestAt:actualResponseAt}]});
    assert.equal(schedule.nextRetryAt,Math.max(actualResponseAt+sourceRetryBackoffMs,officialRetryAt,previousRetryAt));
  }
});

test('insufficient current refusal evidence keeps the completion-clock fallback',()=>{
  const actualResponseAt=now-35*60_000;
  for(const outcome of [
    {sourceId:'source-amgen',retryAt:now+60_000,lastActualRequestAt:actualResponseAt},
    {sourceId:'source-amgen',observedActualHttp:true,lastActualRequestAt:actualResponseAt},
    {sourceId:'source-amgen',retryAt:now+60_000,observedActualHttp:true}
  ]) {
    const schedule=build({attemptedSourceIds:new Set(['source-amgen']),
      previous:[{sourceId:'source-amgen',retryAt:now-1,lastActualRequestAt:actualResponseAt}],outcomes:[outcome]});
    assert.equal(schedule.retrySources.find(row=>row.sourceId==='source-amgen').retryAt,now+sourceRetryBackoffMs);
  }
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

test('progressive retry backoff scales 5m -> 15m and caps at 15m without a daily slot',()=>{
  assert.equal(sourceRetryBackoffMs,5*60_000);
  assert.equal(maxDailyTransientRetries,2);
  const expected=[5,15,15];
  let previous=[];
  for(const [attempt,minutes] of expected.entries()) {
    const schedule=buildRetrySchedule({
      sourceConfigHashes:new Map([['source-jnj',hashes.get('source-amgen')]]),
      completeSourceIds:new Set(),previous,attemptedSourceIds:new Set(['source-jnj']),
      outcomes:[{sourceId:'source-jnj',observedActualHttp:true,actualRequestCount:1,lastActualRequestAt:now}],now
    });
    assert.equal(schedule.nextRetryAt,now+minutes*60_000,`attempt ${attempt}`);
    previous=schedule.retrySources;
    assert.equal(previous[0].actualRequestCount,attempt+1);
  }
});

test('daily schedule allows two quick transient retries (5m -> 15m), one 4h off-peak challenge retry, and resets count next day',()=>{
  const slotNumber=slotAt(now),slot=String(slotNumber),nextSlotAt=slotNumber+dailySlotMs;
  const targetHashes=new Map([['source-pfizer',hashes.get('source-amgen')],['source-jnj',hashes.get('source-roche')]]);

  // First challenged (403/429) failure schedules an off-peak retry (+4h, capped at nextSlotAt), even on live checkpoint observation before actualRequestCount is added.
  const challengedLiveCheckpoint=buildRetrySchedule({
    sourceConfigHashes:targetHashes,completeSourceIds:new Set(['source-jnj']),previous:[],
    attemptedSourceIds:new Set(['source-pfizer']),
    outcomes:[{sourceId:'source-pfizer',observedActualHttp:true,challenged:true,lastActualRequestAt:now,retryAt:now+1800_000}],
    now,slot
  });
  assert.equal(challengedLiveCheckpoint.nextRetryAt,now+4*60*60_000);
  const challengedFirst=buildRetrySchedule({
    sourceConfigHashes:targetHashes,completeSourceIds:new Set(['source-jnj']),previous:[],
    attemptedSourceIds:new Set(['source-pfizer']),
    outcomes:[{sourceId:'source-pfizer',observedActualHttp:true,challenged:true,actualRequestCount:1,lastActualRequestAt:now,retryAt:now+1800_000}],
    now,slot
  });
  assert.deepEqual(challengedLiveCheckpoint,challengedFirst);
  assert.equal(challengedFirst.nextRetryAt,now+4*60*60_000);
  assert.equal(challengedFirst.retrySources[0].slot,slot);
  assert.equal(challengedFirst.retrySources[0].actualRequestCount,1);

  // Second challenged failure in the same daily slot defers to tomorrow's 00:01 slot (both live checkpoint & round summary).
  const t2=now+4*60*60_000+1000;
  const challengedSecondLive=buildRetrySchedule({
    sourceConfigHashes:targetHashes,completeSourceIds:new Set(['source-jnj']),previous:challengedLiveCheckpoint.retrySources,
    attemptedSourceIds:new Set(['source-pfizer']),
    outcomes:[{sourceId:'source-pfizer',observedActualHttp:true,challenged:true,lastActualRequestAt:t2,retryAt:t2+1800_000}],
    now:t2,slot
  });
  assert.equal(challengedSecondLive.nextRetryAt,nextSlotAt);
  const challengedSecond=buildRetrySchedule({
    sourceConfigHashes:targetHashes,completeSourceIds:new Set(['source-jnj']),previous:challengedLiveCheckpoint.retrySources,
    attemptedSourceIds:new Set(['source-pfizer']),
    outcomes:[{sourceId:'source-pfizer',observedActualHttp:true,challenged:true,actualRequestCount:1,lastActualRequestAt:t2,retryAt:t2+1800_000}],
    now:t2,slot
  });
  assert.deepEqual(challengedSecondLive,challengedSecond);
  assert.equal(challengedSecond.nextRetryAt,nextSlotAt);
  assert.equal(challengedSecond.retrySources[0].actualRequestCount,2);

  // Explicit longer Retry-After overrides +4h and nextSlotAt.
  const longChallenged=buildRetrySchedule({
    sourceConfigHashes:targetHashes,completeSourceIds:new Set(['source-jnj']),previous:[],
    attemptedSourceIds:new Set(['source-pfizer']),
    outcomes:[{sourceId:'source-pfizer',observedActualHttp:true,challenged:true,actualRequestCount:1,lastActualRequestAt:now,retryAt:now+36*3600_000}],
    now,slot
  });
  assert.equal(longChallenged.nextRetryAt,now+36*3600_000);

  // Transient error retries at 5m, 15m, then after the 3rd attempt (2nd retry fails) defers to tomorrow's 00:01 slot.
  let prev=[];
  const expectedTargets=[now+5*60_000,now+15*60_000,nextSlotAt];
  for(const [attempt,expectedTarget] of expectedTargets.entries()) {
    const sched=buildRetrySchedule({
      sourceConfigHashes:new Map([['source-jnj',hashes.get('source-roche')]]),
      completeSourceIds:new Set(),previous:prev,attemptedSourceIds:new Set(['source-jnj']),
      outcomes:[{sourceId:'source-jnj',observedActualHttp:true,actualRequestCount:1,lastActualRequestAt:now}],
      now,slot
    });
    assert.equal(sched.nextRetryAt,expectedTarget,`scheduled attempt ${attempt}`);
    prev=sched.retrySources;
    assert.equal(prev[0].actualRequestCount,attempt+1);
    assert.equal(prev[0].slot,slot);
  }

  // Rolling over to the next daily slot resets actualRequestCount back to 1 (5m first retry).
  const day2=slotNumber+dailySlotMs+60_000,slot2=String(slotNumber+dailySlotMs);
  const nextDay=buildRetrySchedule({
    sourceConfigHashes:new Map([['source-jnj',hashes.get('source-roche')]]),
    completeSourceIds:new Set(),previous:prev,attemptedSourceIds:new Set(['source-jnj']),
    outcomes:[{sourceId:'source-jnj',observedActualHttp:true,actualRequestCount:1,lastActualRequestAt:day2}],
    now:day2,slot:slot2
  });
  assert.equal(nextDay.nextRetryAt,day2+5*60_000);
  assert.equal(nextDay.retrySources[0].actualRequestCount,1);
  assert.equal(nextDay.retrySources[0].slot,slot2);
});

test('mergeRetrySources isolates legacy slotless counts from slotted retry counts',()=>{
  const slot=String(slotAt(now));
  const t1=now+60_000,t2=now+120_000;
  const legacy=[{sourceId:'source-jnj',retryAt:t2,actualRequestCount:5}];
  const slottedWithCount=[{sourceId:'source-jnj',retryAt:t1,slot,actualRequestCount:1}];
  const slottedNoCount=[{sourceId:'source-jnj',retryAt:t1,slot}];

  assert.deepEqual(mergeRetrySources(legacy,slottedWithCount),[{sourceId:'source-jnj',retryAt:t2,slot,actualRequestCount:1}]);
  assert.deepEqual(mergeRetrySources(slottedWithCount,legacy),[{sourceId:'source-jnj',retryAt:t2,slot,actualRequestCount:1}]);
  assert.deepEqual(mergeRetrySources(legacy,slottedNoCount),[{sourceId:'source-jnj',retryAt:t2,slot}]);
  assert.deepEqual(mergeRetrySources(slottedNoCount,legacy),[{sourceId:'source-jnj',retryAt:t2,slot}]);
});

test('pre-acquisition skips and errors do not consume the daily source retry budget',()=>{
  const slot=String(slotAt(now));
  assert.equal(shouldCountRoundRetryAttempt({status:'SKIPPED_ALREADY_COMMITTED_IN_WINDOW'}),false);
  assert.equal(shouldCountRoundRetryAttempt({status:'FAILED'}),false);
  assert.equal(shouldCountRoundRetryAttempt({status:'COMPLETED',skippedSourceCount:1,transportSuccessfulSourceCount:0,transportFailedSourceCount:0}),false);
  assert.equal(shouldCountRoundRetryAttempt({status:'COMPLETED',transportFailedSourceCount:1}),true);
  assert.equal(shouldCountRoundRetryAttempt({status:'COMPLETED',transportSuccessfulSourceCount:1}),true);

  const schedule=buildRetrySchedule({
    sourceConfigHashes:new Map([['source-jnj',hashes.get('source-roche')]]),
    completeSourceIds:new Set(),previous:[],attemptedSourceIds:new Set(['source-jnj']),
    outcomes:[],now,slot
  });
  assert.equal(schedule.nextRetryAt,now+5*60_000);
  assert.equal(schedule.retrySources[0].actualRequestCount,undefined);
});
