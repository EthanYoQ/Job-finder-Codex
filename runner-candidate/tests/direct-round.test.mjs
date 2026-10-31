import { memoryDb } from './memory-db.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDirectPlans, identityForSource, assertLegacyAuditState, assertNoUnresolvedWrites } from '../scripts/direct-round.ts';
import { runP0CrawlBatch } from '../src/crawler/runCrawlBatch.ts';
import { withPortableCrawlLease } from '../src/crawler/portableCrawlLease.ts';
import { SOURCE_QUALITY_POLICY_ID, getSourceQualityPolicy } from '../src/crawler/sourceQualityAdmission.ts';
import { requiresAGradeOfficialTotalCertificate } from '../src/crawler/completenessCertificate.ts';
import { requiresBGradeTraversalCertificate } from '../src/crawler/traversalCertificate.ts';
import { validatePlannedSourceContract } from '../src/crawler/runtimeBatchIdentity.ts';

const candidate = { id: 'synthetic-candidate', commitSha: 'a'.repeat(40), rosterHash: 'b'.repeat(64),
  sourcePlanHash: 'c'.repeat(64), sourceConfigHash: 'd'.repeat(64), adapterBundleHash: 'e'.repeat(64) };
const routes = await loadDirectPlans();

test('catalog preserves all 36 original plans and the 20/12/4 admission split', () => {
  assert.equal(routes.length, 36);
  assert.deepEqual(Object.fromEntries(['PORTABLE', 'TRUE_A', 'TRUE_B'].map(route => [route, routes.filter(row => row.route === route).length])),
    { PORTABLE: 20, TRUE_A: 12, TRUE_B: 4 });
  for (const row of routes) {
    validatePlannedSourceContract(identityForSource(candidate, row.sourceId), [row.sourceId]);
    assert.ok(row.route === 'PORTABLE' ? getSourceQualityPolicy(row.plan)
      : row.route === 'TRUE_A' ? requiresAGradeOfficialTotalCertificate(row.plan) : requiresBGradeTraversalCertificate(row.plan));
  }
});

test('historical UNKNOWN remains in the audit while only a fresh candidate can run', () => {
  const id = 'instabox-new', audit = { candidateId: id, legacyCandidateIds: ['instabox-old'], replayLegacy: false,
    unresolvedRequests: [{ kind: 'SOURCE_RESULT', id: 'old-publish', outcome: 'UNKNOWN', sourceId: 's' }] };
  const before = JSON.stringify(audit);
  assert.doesNotThrow(() => assertLegacyAuditState(audit, id));
  assert.equal(JSON.stringify(audit), before);
  assert.throws(() => assertLegacyAuditState(undefined, id), /MIGRATION_AUDIT_STATE_REQUIRED/);
  assert.throws(() => assertLegacyAuditState({ ...audit, replayLegacy: true }, id), /LEGACY_REPLAY_FORBIDDEN/);
  assert.throws(() => assertLegacyAuditState({ ...audit, candidateId: 'instabox-old' }, 'instabox-old'), /NEW_INSTABOX_CANDIDATE_REQUIRED/);
  assert.throws(() => assertLegacyAuditState(audit, 'different-candidate'), /NEW_INSTABOX_CANDIDATE_REQUIRED/);
});

test('only unresolved writes from this candidate and direct scheduler block new work', async () => {
  const candidateId = 'instabox-new';
  const batches = [
    { id: 'legacy', releaseCandidateId: 'legacy-candidate', ownerId: 'direct-scheduler', kind: 'SCHEDULED', status: 'RUNNING' },
    { id: 'manual', releaseCandidateId: candidateId, ownerId: 'manual-owner', kind: 'MANUAL_SOURCE', status: 'RUNNING' },
    { id: 'other-owner', releaseCandidateId: candidateId, ownerId: 'legacy-owner', kind: 'SCHEDULED', status: 'RUNNING' }
  ];
  const pending = batches.map(batch => ({ id: `r-${batch.id}`, batchId: batch.id, releaseCandidateId: batch.releaseCandidateId, sourceId: 's', atomicCommitState: 'PENDING', batch }));
  const match = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'batch') return match(row.batch, value.is);
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
  const db = { crawlBatchSourceResult: { findFirst: async ({ where }) => pending.find(row => match(row, where)) ?? null },
    crawlBatch: { findFirst: async ({ where }) => batches.find(row => match(row, where)) ?? null },
    manualCrawlRequest: { findFirst: async () => { throw Error('historical manual requests must not be consumed'); } } };
  const before = JSON.stringify({ batches, pending });
  await assertNoUnresolvedWrites(db, candidateId, ['s']);
  assert.equal(JSON.stringify({ batches, pending }), before);
  const own = { id: 'own', releaseCandidateId: candidateId, ownerId: 'direct-scheduler', kind: 'SCHEDULED', status: 'RUNNING' };
  batches.push(own);
  await assert.rejects(assertNoUnresolvedWrites(db, candidateId, ['s']), /RECONCILE_RUNNING_BATCH:own/);
  pending.push({ id: 'own-result', batchId: own.id, releaseCandidateId: candidateId, sourceId: 's', atomicCommitState: 'PENDING', batch: own });
  await assert.rejects(assertNoUnresolvedWrites(db, candidateId, ['s']), /RECONCILE_PENDING_COMMIT:own:own-result/);
  own.status = 'FAILED';
  await assert.rejects(assertNoUnresolvedWrites(db, candidateId, ['s']), /RECONCILE_PENDING_COMMIT:own:own-result/);
});

test('A/B last-good runs cannot bypass the same owned lease as portable runs', async () => {
  const row = routes.find(row => row.route === 'TRUE_A');
  await assert.rejects(runP0CrawlBatch([row.plan], {
    identity: identityForSource(candidate, row.sourceId), publicationPolicy: 'SOURCE_ATOMIC_LAST_GOOD_V1'
  }), /Last-good scheduled publication requires an owned lease/);
});

for (const route of ['TRUE_A', 'TRUE_B', 'PORTABLE']) test(`${route} failed fresh capture closes its batch without replacing any old jobs`, async () => {
  const row = routes.find(row => row.route === route), memory = memoryDb();
  let captures = 0;
  const result = await withPortableCrawlLease(memory.db, lease => runP0CrawlBatch([row.plan], {
    db: memory.db, identity: identityForSource(candidate, row.sourceId), now: () => new Date(),
    publicationPolicy: 'SOURCE_ATOMIC_LAST_GOOD_V1', portableLease: lease,
    ...(route === 'PORTABLE' ? { sourceAdmissionPolicy: SOURCE_QUALITY_POLICY_ID } : {}),
    getPreviousJobs: async () => [], getRecentObservations: async () => [], isBaselineCompleted: async () => false,
    getTrustedCompletenessBaseline: async () => null, getFirstAcceptedCurrentPolicyReceipt: async () => null,
    runIndependentTraversalValidator: async () => { throw Error('SYNTHETIC_DOM_FAILURE'); },
    fetch: async () => { captures++; return { ok: false, capturedAt: new Date().toISOString(), failureReason: 'SYNTHETIC_NETWORK_FAILURE' }; }
  }));
  assert.equal(captures, route === 'TRUE_B' ? 0 : 1);
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(memory.jobWrites(), 0);
  assert.equal(memory.rows[0].atomicCommitState, 'NOT_ATTEMPTED');
  assert.equal(memory.batches[0].status, 'INCOMPLETE');
});
