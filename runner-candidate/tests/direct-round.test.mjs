import { memoryDb } from './memory-db.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDirectPlans, identityForSource, assertLegacyReconciled, assertNoUnresolvedWrites } from '../scripts/direct-round.ts';
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

test('migration UNKNOWN cannot be cleared by an empty new database', () => {
  assert.throws(() => assertLegacyReconciled(undefined), /MIGRATION_RECONCILIATION_STATE_REQUIRED/);
  assert.throws(() => assertLegacyReconciled({ unresolvedRequests: [{ requestId: 'old-publish', outcome: 'UNKNOWN' }] }), /LEGACY_UNKNOWN_RECONCILE_ONLY/);
  assert.doesNotThrow(() => assertLegacyReconciled({ unresolvedRequests: [], holds: { oldSource: 'EXPIRED_APPROVAL' } }));
});

test('pending commits, unfinished batches and manual writers block a fresh round', async () => {
  const db = { crawlBatchSourceResult: { findFirst: async () => null }, crawlBatch: { findFirst: async () => null }, manualCrawlRequest: { findFirst: async () => null } };
  await assertNoUnresolvedWrites(db, ['s']);
  for (const [model, row, code] of [
    ['crawlBatchSourceResult', { id: 'r', batchId: 'b' }, /RECONCILE_PENDING_COMMIT:b:r/],
    ['crawlBatch', { id: 'b' }, /RECONCILE_RUNNING_BATCH:b/],
    ['manualCrawlRequest', { id: 'm' }, /RECONCILE_MANUAL_REQUEST:m/]
  ]) await assert.rejects(assertNoUnresolvedWrites({ ...db, [model]: { findFirst: async () => row } }, ['s']), code);
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
