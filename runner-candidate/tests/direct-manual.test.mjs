import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFreshManualRequest } from '../scripts/direct-manual.ts';
import { createManualSourceBatchExecutor } from '../src/crawler/manualSourceBatchExecutor.ts';
import { runManualCrawlWorker } from '../src/crawler/manualCrawlWorker.ts';
import { loadDirectPlans, identityForSource } from '../scripts/direct-round.ts';
import { withPortableCrawlLease } from '../src/crawler/portableCrawlLease.ts';
import { createPortableFencedRuntimeDatabase } from '../src/db/portableRuntimeDatabase.ts';
import { runP0CrawlBatch } from '../src/crawler/runCrawlBatch.ts';
import { memoryDb } from './memory-db.mjs';

test('manual execution accepts only a post-registration queued request outside the legacy audit', () => {
  const input = { request: { id: 'new', sourceId: 's', status: 'QUEUED', createdAt: new Date('2026-10-31T01:00:01Z') },
    registeredAt: new Date('2026-10-31T01:00:00Z'), sourceIds: ['s'], unresolvedRequests: [{kind:'MANUAL_REQUEST',id:'old'}] };
  assert.doesNotThrow(() => assertFreshManualRequest(input));
  for (const request of [
    {...input.request, id:'old'}, {...input.request, createdAt:input.registeredAt},
    {...input.request, createdAt:new Date('2026-10-30')}
  ]) assert.throws(() => assertFreshManualRequest({...input, request}), /LEGACY_MANUAL_REQUEST_FORBIDDEN/);
  for (const status of ['RUNNING','SUCCESS','FAILED']) {
    assert.throws(() => assertFreshManualRequest({...input,request:{...input.request,status}}), /MANUAL_REQUEST_NOT_FRESH_QUEUED/);
  }
  assert.throws(() => assertFreshManualRequest({...input,sourceIds:[]}), /MANUAL_SOURCE_OUT_OF_SCOPE/);
});

test('native manual worker forces a preview despite a recent successful schedule and preserves Job rows on failure', async () => {
  const {plan} = (await loadDirectPlans()).find(row => row.route === 'TRUE_A');
  const memory = memoryDb(), requestId = 'new-request', ownerId = 'direct-manual-test';
  const originalQuery = memory.db.$queryRawUnsafe;
  memory.db.$queryRawUnsafe = async (sql,...values) => {
    if (sql.includes('FROM "ManualCrawlRequest"') || sql.includes('FROM "CrawlBatch"')) return [{id:values[0]}];
    return originalQuery(sql,...values);
  };
  const candidate = {id:'instabox-test',commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};
  let captures = 0, status = 'QUEUED';
  const result = await withPortableCrawlLease(memory.db, async lease => {
    const execute = createManualSourceBatchExecutor({plans:[plan],baseIdentity:identityForSource(candidate,plan.source.id),
      db:createPortableFencedRuntimeDatabase(memory.db,lease),now:()=>new Date('2026-10-31T04:05:00Z'),runP0CrawlBatch,
      fetch:async()=>{captures++;return {ok:false,capturedAt:'2026-10-31T04:05:00Z',failureReason:'SYNTHETIC_FAILURE'};},
      runtimeDeps:{getPreviousJobs:async()=>[],getRecentObservations:async()=>[{sourceId:plan.source.id,successful:true,crawledAt:'2026-10-31T04:04:00Z'}],isBaselineCompleted:async()=>false}});
    return runManualCrawlWorker({ownerId,stopWhenIdle:true,signal:lease.signal,executeSource:execute,
      repository:{claimNext:async()=>{if(status!=='QUEUED')return null;status='RUNNING';return {id:requestId,sourceId:plan.source.id,attemptCount:1};},
        heartbeat:async()=>{},finishSuccess:async()=>{status='SUCCESS';},finishFailed:async()=>{status='FAILED';}}});
  });
  assert.equal(captures,1);
  assert.equal(result.failedCount,1);
  assert.equal(status,'FAILED');
  assert.equal(memory.batches[0].kind,'MANUAL_SOURCE');
  assert.equal(memory.batches[0].manualCrawlRequestId,requestId);
  assert.equal(memory.rows[0].atomicCommitState,'NOT_ATTEMPTED');
  assert.equal(memory.jobWrites(),0);
});
