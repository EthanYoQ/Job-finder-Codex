import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDirectPlans } from '../runner-candidate/scripts/direct-round.ts';
import { candidateCompanies } from '../web-candidate/src/data/companyRegistry.ts';
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from '../web-candidate/src/crawler/sourcePlan.ts';
import { getSourceQualityPolicy } from '../web-candidate/src/crawler/sourceQualityAdmission.ts';
import { selectPortableSourceSnapshots } from '../web-candidate/src/domain/portablePublicSnapshot.ts';

const routes = await loadDirectPlans(), reader = buildStagedSourceCrawlPlans(candidateCompanies);

test('all 36 writer source identities and configurations match the packaged reader', () => {
  for (const route of routes) {
    const plan = reader.find(plan => plan.source.id === route.sourceId);
    assert.ok(plan, route.sourceId);
    assert.equal(plan.company.id, route.companyId);
    assert.equal(sourcePlanConfigSha256(plan), route.sourceConfigSha256, route.sourceId);
    if (route.route === 'PORTABLE') assert.ok(getSourceQualityPolicy(plan), route.sourceId);
  }
});

test('a committed current Merck receipt is selected by the reader; an older configuration is not relabeled', () => {
  const route = routes.find(row => row.sourceId === 'source-merck-china-social');
  const plan = reader.find(plan => plan.source.id === route.sourceId);
  const at = '2026-10-31T00:00:00.000Z';
  const row = { id: 'synthetic-result', releaseCandidateId: 'instabox-synthetic', batchId: 'synthetic-batch', sourceId: route.sourceId,
    sourceConfigHash: route.sourceConfigSha256, transportState: 'SUCCEEDED', adapterState: 'SUCCEEDED', completenessState: 'VERIFIED', atomicCommitState: 'COMMITTED',
    failureCode: null, failureReason: null, blockerCode: null, blockerReason: null, startedAt: new Date(at), finishedAt: new Date(at), dedupeOutputCount: 1,
    completenessCertificateSha256: 'a'.repeat(64), completenessCertificate: { schemaVersion: 'plan-bound-source-quality-v1', policyId: 'PLAN_BOUND_SOURCE_QUALITY_V1',
      observation: { crawledAt: at }, counts: { finalUniqueJobCount: 1 } },
    batch: { id: 'synthetic-batch', releaseCandidateId: 'instabox-synthetic', kind: 'SCHEDULED', status: 'SUCCESS' } };
  const select = input => selectPortableSourceSnapshots([plan], [input], { currentTime: new Date(at) })[0];
  assert.equal(select(row).state, 'PUBLISHING');
  const old = select({ ...row, sourceConfigHash: '3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38' });
  assert.equal(old.selectedSourceResultId, null);
});
