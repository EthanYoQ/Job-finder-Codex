import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './memory-db.mjs';
import { recoverDirectBatches } from '../scripts/recover-direct.ts';
import { withPortableCrawlLease } from '../src/crawler/portableCrawlLease.ts';
import { nextP0SchedulerWindow, isSourceDueForScheduledRun } from '../src/crawler/schedule.ts';

test('00:01/12:01 Beijing schedule deduplicates successful sources across retries and day rollover', () => {
  for (const boundary of ['2026-10-30T16:01:00Z', '2026-10-31T04:01:00Z', '2026-10-31T16:01:00Z']) {
    const now = new Date(boundary);
    assert.equal(nextP0SchedulerWindow(now).startsAt, now.toISOString());
    const prior = {sourceId:'s', consecutiveFailureCount:0, lastSuccessfulCrawlAt:new Date(+now - 12 * 3600_000)};
    assert.equal(isSourceDueForScheduledRun(prior, new Date(+now - 60_000)), false);
    assert.equal(isSourceDueForScheduledRun(prior, now), true);
    const state = {sourceId:'s', consecutiveFailureCount:0, lastSuccessfulCrawlAt:now};
    assert.equal(isSourceDueForScheduledRun(state, new Date(+now + 60_000)), false);
    assert.equal(isSourceDueForScheduledRun(state, new Date(+now + 12 * 3600_000)), true);
    assert.equal(isSourceDueForScheduledRun({...state, retryNotBefore:new Date(+now + 13 * 3600_000)}, new Date(+now + 12 * 3600_000)), false);
  }
});

function interrupted(state) {
  const memory = memoryDb();
  memory.batches.push({id:'batch', status:'RUNNING', releaseCandidateId:'instabox-synthetic', ownerId:'direct-scheduler', kind:'SCHEDULED', plannedSourceIds:['s']});
  memory.rows.push({id:'result', sourceId:'s', batchId:'batch', releaseCandidateId:'instabox-synthetic',
    transportState:state==='COMMITTED'?'SUCCEEDED':'PENDING', adapterState:state==='COMMITTED'?'SUCCEEDED':'PENDING',
    completenessState:state==='COMMITTED'?'VERIFIED':'PENDING', atomicCommitState:state, failureCode:null});
  memory.db.crawlBatch.findMany = async ({where}) => memory.batches.filter(row => Object.entries(where).every(([key,value]) => row[key] === value));
  return memory;
}

test('crash after atomic commit finalizes from persisted results without touching jobs', async () => {
  const memory = interrupted('COMMITTED');
  await withPortableCrawlLease(memory.db, lease => recoverDirectBatches(memory.db, lease, 'instabox-synthetic', ['s']));
  assert.equal(memory.batches[0].status, 'SUCCESS');
  assert.equal(memory.batches[0].atomicCommittedCount, 1);
  assert.equal(memory.rows[0].atomicCommitState, 'COMMITTED');
  assert.equal(memory.jobWrites(), 0);
});

test('crash before atomic commit closes only the former fenced attempt and is safe to repeat', async () => {
  const memory = interrupted('PENDING');
  await withPortableCrawlLease(memory.db, async lease => {
    assert.equal(await recoverDirectBatches(memory.db, lease, 'instabox-synthetic', ['s']), 1);
    assert.equal(await recoverDirectBatches(memory.db, lease, 'instabox-synthetic', ['s']), 0);
  });
  assert.equal(memory.rows[0].atomicCommitState, 'ROLLED_BACK');
  assert.equal(memory.rows[0].failureCode, 'DIRECT_WORKER_INTERRUPTED');
  assert.equal(memory.batches[0].status, 'FAILED');
  assert.equal(memory.jobWrites(), 0);
});

test('legacy candidate/owner and a caller without the owned lease cannot enter recovery', async () => {
  const memory = interrupted('PENDING');
  await assert.rejects(recoverDirectBatches(memory.db, {}, 'instabox-synthetic', ['s']), /CRAWL_LEASE_NOT_OWNED/);
  await withPortableCrawlLease(memory.db, async lease => {
    await assert.rejects(recoverDirectBatches(memory.db, lease, 'legacy-candidate', ['s']), /NEW_INSTABOX_CANDIDATE_REQUIRED/);
    memory.batches[0].ownerId = 'legacy-host';
    assert.equal(await recoverDirectBatches(memory.db, lease, 'instabox-synthetic', ['s']), 0);
  });
  assert.equal(memory.rows[0].atomicCommitState, 'PENDING');
  assert.equal(memory.batches[0].status, 'RUNNING');
});
