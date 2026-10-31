import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDirectPlans, assertNoUnresolvedWrites } from '../scripts/direct-round.ts';
import { readPortableScheduleObservations } from '../src/db/portableScheduleObservations.ts';
import { toSourceScheduleState } from '../src/db/crawlStateRepository.ts';
import { isSourceDueForScheduledRun } from '../src/crawler/schedule.ts';

const now=new Date('2026-10-31T05:00:00Z');
const sourceIds=['source-cspc-social','source-merck-china-social','source-novo-nordisk-china-social','source-organon-china-social'];
const routes=await loadDirectPlans();
for(const sourceId of sourceIds)test(`${sourceId} clearly uncommitted failure can retry in the same slot`,async()=>{
  const route=routes.find(row=>row.sourceId===sourceId);
  assert.ok(route,sourceId);assert.equal(route.route,'PORTABLE');
  const row={id:'failed',sourceId,sourceConfigHash:route.sourceConfigSha256,
    startedAt:new Date('2026-10-31T04:05:00Z'),finishedAt:new Date('2026-10-31T04:06:00Z'),
    transportState:'FAILED',adapterState:'SKIPPED',completenessState:'FAILED',atomicCommitState:'NOT_ATTEMPTED',
    failureCode:'SOURCE_TRANSPORT_FAILED',failureReason:'SYNTHETIC_FAILURE',blockerCode:null,blockerReason:null,
    completenessCertificate:null,completenessCertificateSha256:null,batch:{id:'b',kind:'SCHEDULED',status:'INCOMPLETE'}};
  const before=JSON.stringify(row);
  const observations=await readPortableScheduleObservations({findMany:async()=>[row]},route.plan,now);
  assert.equal(observations.length,1);assert.equal(observations[0].successful,false);
  assert.equal(isSourceDueForScheduledRun(toSourceScheduleState(sourceId,observations),now),true);
  assert.equal(JSON.stringify(row),before);
});

test('same-slot success stays deduplicated even after failures; previous-slot success does not block retries',()=>{
  const failures=Array.from({length:3},(_,index)=>({successful:false,crawledAt:new Date(`2026-10-31T04:0${index+7}:00Z`)}));
  assert.equal(isSourceDueForScheduledRun(toSourceScheduleState('s',[...failures,{successful:true,crawledAt:new Date('2026-10-31T04:04:00Z')}]),now),false);
  assert.equal(isSourceDueForScheduledRun(toSourceScheduleState('s',[...failures,{successful:true,crawledAt:new Date('2026-10-31T03:59:00Z')}]),now),true);
});

test('allowing failed captures to retry does not bypass an unresolved new-runner write',async()=>{
  const db={crawlBatchSourceResult:{findFirst:async()=>({id:'pending-result',batchId:'pending-batch'})},crawlBatch:{findFirst:async()=>null}};
  await assert.rejects(assertNoUnresolvedWrites(db,'instabox-current',['s']),/RECONCILE_PENDING_COMMIT/);
});
