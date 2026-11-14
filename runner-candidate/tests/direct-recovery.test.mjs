import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './memory-db.mjs';
import { recoverDirectBatches } from '../scripts/recover-direct.ts';
import { withPortableCrawlLease } from '../src/crawler/portableCrawlLease.ts';
import { nextP0SchedulerWindow, isSourceDueForScheduledRun } from '../src/crawler/schedule.ts';
import { hashCanonicalJobKeySet } from '../src/crawler/runtimeBatchIdentity.ts';

test('00:01 Beijing schedule retries missing sources and keeps same-day successes', () => {
  const start = new Date('2026-11-13T16:01:00Z');
  const noon = new Date('2026-11-14T04:01:00Z');
  const next = new Date('2026-11-14T16:01:00Z');
  const prior = {sourceId:'s', consecutiveFailureCount:0, lastSuccessfulCrawlAt:new Date('2026-11-13T04:01:00Z')};
  assert.equal(nextP0SchedulerWindow(noon).startsAt, start.toISOString());
  assert.equal(nextP0SchedulerWindow(noon, start).startsAt, next.toISOString());
  assert.equal(isSourceDueForScheduledRun(prior, start), true);
  assert.equal(isSourceDueForScheduledRun(prior, noon), true);
  const state = {...prior, lastSuccessfulCrawlAt:start};
  assert.equal(isSourceDueForScheduledRun(state, noon), false);
  assert.equal(isSourceDueForScheduledRun(state, next), true);
  assert.equal(isSourceDueForScheduledRun({...state, consecutiveFailureCount:3}, noon), false);
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
  const currentJobs = [{sourceId:'s',jobKey:'job-b'},{sourceId:'s',jobKey:'job-a'}];
  memory.db.lifecycleSetEvidenceMember.findMany = async ({where,select}) => {
    assert.deepEqual(where,{releaseCandidateId:'instabox-synthetic',batchId:'batch',sourceResultId:{in:['result']},setKind:'CURRENT'});
    assert.deepEqual(select,{sourceId:true,jobKey:true});
    return currentJobs;
  };
  await withPortableCrawlLease(memory.db, lease => recoverDirectBatches(memory.db, lease, 'instabox-synthetic', ['s']));
  assert.equal(memory.batches[0].status, 'SUCCESS');
  assert.equal(memory.batches[0].atomicCommittedCount, 1);
  assert.equal(memory.rows[0].atomicCommitState, 'COMMITTED');
  assert.equal(memory.batches[0].aggregateJobSetSha256,hashCanonicalJobKeySet(currentJobs));
  assert.notEqual(memory.batches[0].aggregateJobSetSha256,hashCanonicalJobKeySet([]));
  assert.equal(memory.jobWrites(), 0);
});

test('crash before atomic commit closes only the former fenced attempt and is safe to repeat', async () => {
  const memory = interrupted('PENDING');
  await withPortableCrawlLease(memory.db, async lease => {
    assert.equal(await recoverDirectBatches(memory.db, lease, 'instabox-synthetic', ['s']), 1);
    assert.equal(await recoverDirectBatches(memory.db, lease, 'instabox-synthetic', ['s']), 0);
  });
  assert.equal(memory.rows[0].atomicCommitState, 'NOT_ATTEMPTED');
  assert.equal(memory.rows[0].transportState, 'FAILED');
  assert.equal(memory.rows[0].adapterState, 'SKIPPED');
  assert.equal(memory.rows[0].failureCode, 'DIRECT_WORKER_INTERRUPTED');
  assert.equal(memory.batches[0].status, 'INCOMPLETE');
  assert.equal(memory.batches[0].aggregateJobSetSha256,hashCanonicalJobKeySet([]));
  assert.equal(memory.batches[0].finishedAt,memory.batches[0].heartbeatAt);
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
