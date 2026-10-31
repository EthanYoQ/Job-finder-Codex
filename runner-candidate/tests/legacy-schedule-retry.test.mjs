import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrismaCrawlRuntimeDeps } from '../src/db/crawlRuntimeRepository.ts';
import { toSourceScheduleState } from '../src/db/crawlStateRepository.ts';
import { isSourceDueForScheduledRun } from '../src/crawler/schedule.ts';

const sourceId='source-pfizer-china-social';
const now=new Date('2026-10-31T10:00:00Z');
const observedAt=new Date('2026-10-31T09:00:00Z');
async function schedule(rows) {
  const before=JSON.stringify(rows);
  const runtime=createPrismaCrawlRuntimeDeps({crawlObservation:{findMany:async query=>{
    assert.equal(query.where.sourceId,sourceId);
    assert.deepEqual(query.select.sourceResult,{select:{completenessState:true,atomicCommitState:true}});
    return rows;
  }}});
  const result=toSourceScheduleState(sourceId,await runtime.getRecentObservations(sourceId));
  assert.equal(JSON.stringify(rows),before);
  return result;
}

test('TRUE_B adapter success with committed but unverified evidence remains retryable in the same slot',async()=>{
  const state=await schedule([{crawledAt:observedAt,successful:true,
    sourceResult:{completenessState:'NEEDS_MANUAL_COMPLETENESS_REVIEW',atomicCommitState:'COMMITTED'}}]);
  assert.equal(state.lastSuccessfulCrawlAt,undefined);
  assert.equal(state.consecutiveFailureCount,1);
  assert.equal(isSourceDueForScheduledRun(state,now),true);
});

test('only verified and committed bound observations deduplicate a slot',async()=>{
  for(const sourceResult of [null,
    {completenessState:'VERIFIED',atomicCommitState:'PENDING'},
    {completenessState:'VERIFIED',atomicCommitState:'ROLLED_BACK'},
    {completenessState:'FAILED',atomicCommitState:'NOT_ATTEMPTED'}]) {
    const state=await schedule([{crawledAt:observedAt,successful:true,sourceResult}]);
    assert.equal(state.lastSuccessfulCrawlAt,undefined);
  }
  const accepted={crawledAt:new Date('2026-10-31T08:00:00Z'),successful:true,
    sourceResult:{completenessState:'VERIFIED',atomicCommitState:'COMMITTED'}};
  const failed={crawledAt:observedAt,successful:true,
    sourceResult:{completenessState:'NEEDS_MANUAL_COMPLETENESS_REVIEW',atomicCommitState:'COMMITTED'}};
  const state=await schedule([failed,accepted]);
  assert.equal(isSourceDueForScheduledRun(state,now),false);
  assert.equal(isSourceDueForScheduledRun(state,new Date('2026-10-31T16:01:00Z')),true);
  assert.equal((await schedule([{...accepted,successful:false}])).lastSuccessfulCrawlAt,undefined);
});
