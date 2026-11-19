import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDirectPlans } from '../runner-candidate/scripts/direct-round.ts';
import { candidateCompanies } from '../web-candidate/src/data/companyRegistry.ts';
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from '../web-candidate/src/crawler/sourcePlan.ts';
import { getSourceQualityPolicy } from '../web-candidate/src/crawler/sourceQualityAdmission.ts';
import { selectPortableSourceSnapshots,verifiedMembers } from '../web-candidate/src/domain/portablePublicSnapshot.ts';
import { validateSavedSnapshot } from '../web-candidate/src/server/savedPublicSnapshot.ts';
import {hashCanonicalStringSet} from '../web-candidate/src/crawler/runtimeBatchIdentity.ts';
import {createHash} from 'node:crypto';
import {B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION,SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION,BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION} from '../web-candidate/src/crawler/traversalCertificate.ts';

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

test('compact to full native B receipt keeps the prior verified visibility floor',()=>{
 for(const [sourceId,compact] of [['source-sanofi-china-social',SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION],['source-bayer-healthcare-social',BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION]]){
  const route=routes.find(r=>r.sourceId===sourceId),plan=reader.find(p=>p.source.id===sourceId),times=['2026-11-06T00:00:00.000Z','2026-11-06T00:10:00.000Z'];
  const rows=times.map((at,i)=>({id:`result-${i}`,releaseCandidateId:'instabox-synthetic',batchId:`batch-${i}`,sourceId,sourceConfigHash:route.sourceConfigSha256,
   transportState:'SUCCEEDED',adapterState:'SUCCEEDED',completenessState:'VERIFIED',atomicCommitState:'COMMITTED',startedAt:new Date(at),finishedAt:new Date(at),dedupeOutputCount:1,
   completenessCertificateSha256:'a'.repeat(64),completenessCertificate:{schemaVersion:i?B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION:compact,counts:{finalUniqueJobCount:1,quarantinedJobCount:i}},observations:[{crawledAt:new Date(at)}],
   batch:{id:`batch-${i}`,releaseCandidateId:'instabox-synthetic',kind:'SCHEDULED',status:'SUCCESS'}}));
  const selection=selectPortableSourceSnapshots([plan],rows,{currentTime:new Date(times[1])})[0];assert.equal(selection.state,'PUBLISHING');assert.equal(selection.selectedSourceResultId,'result-1');assert.equal(selection.visibilityFloor,times[0]);
 }
});

test('the daily reader exports committed Merck jobs and holds invalid membership', async () => {
  const route = routes.find(row => row.sourceId === 'source-merck-china-social');
  const plan = reader.find(plan => plan.source.id === route.sourceId);
  const at = '2026-10-31T00:00:00.000Z';
  const row = { id: 'synthetic-result', releaseCandidateId: 'instabox-synthetic', batchId: 'synthetic-batch', sourceId: route.sourceId,
    sourceConfigHash: route.sourceConfigSha256, transportState: 'SUCCEEDED', adapterState: 'SUCCEEDED', completenessState: 'VERIFIED', atomicCommitState: 'COMMITTED',
    failureCode: null, failureReason: null, blockerCode: null, blockerReason: null, startedAt: new Date(at), finishedAt: new Date(at), dedupeOutputCount: 1,
    canonicalCurrentJobSetSha256: hashCanonicalStringSet(['merck-job']), canonicalGraceJobSetSha256: hashCanonicalStringSet([]),
    canonicalVisibleJobSetSha256: hashCanonicalStringSet(['merck-job']), observations: [],
    completenessCertificateSha256: 'a'.repeat(64), completenessCertificate: { schemaVersion: 'plan-bound-source-quality-v1', policyId: 'PLAN_BOUND_SOURCE_QUALITY_V1',
      observation: { crawledAt: at }, counts: { finalUniqueJobCount: 1 } },
    batch: { id: 'synthetic-batch', releaseCandidateId: 'instabox-synthetic', kind: 'SCHEDULED', status: 'SUCCESS', startedAt: new Date(at), finishedAt: new Date(at) } };
  const legacyRow = { ...row, sourceConfigHash: '3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38' };
  const members = ['CURRENT', 'VISIBLE'].map(setKind => ({ setKind, jobKey: 'merck-job',
    jobKeySha256: createHash('sha256').update('merck-job').digest('hex'), lifecycleStatus: 'ACTIVE', missingCount: 0,
    releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceId: row.sourceId, sourceResultId: row.id }));
  const job = { id: 'job-1', dedupeKey: 'merck-job', companyId: route.companyId, sourceId: route.sourceId, officialTitle: 'Sales Representative',
    officialUrl: 'https://careers.example.com/job-1', officialPublishedAt: null, city: '北京', cities: ['北京'], locationRaw: '北京', category: 'SALES',
    isNew: false, lastSeenAt: new Date(at), lifecycleStatus: 'ACTIVE', visibleInFrontend: true, missingSuccessCount: 0 };

  const { readPortablePublicSnapshot } = await import('../web-candidate/src/db/portablePublicSnapshotRepository.ts');
  const read = async (result, lifecycleMembers) => validateSavedSnapshot(await readPortablePublicSnapshot({
    async $transaction(operation, options) {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      assert.equal(options.timeout, 120_000);
      return operation({
        $queryRawUnsafe: async () => [result],
        lifecycleSetEvidenceMember: { findMany: async () => lifecycleMembers },
        job: { findMany: async () => [job] }
      });
    }
  }, { currentTime: new Date(at) }, [plan]));
  const current = await read(row, members);
  assert.equal(current.totalJobs, 1);
  assert.equal(current.lastUpdatedAt, at);
  assert.deepEqual(current.sources[0].jobs.map(({ id, sourceResultId, category }) => ({ id, sourceResultId, category })),
    [{ id: job.id, sourceResultId: row.id, category: '销售' }]);
  assert.deepEqual(await read(legacyRow, members), current);

  const invalid = await read(legacyRow, members.slice(0, 1));
  assert.equal(invalid.totalJobs, 0);
  assert.equal(invalid.sources[0].state, 'HOLD');
  assert.ok(invalid.sources[0].reasons.includes('PROJECTION_INTEGRITY_HOLD'));
});

test('native A-grade quarantines retain verified GRACE jobs in the public projection',()=>{
 const route=routes.find(row=>row.sourceId==='source-lilly-china-social'),plan=reader.find(plan=>plan.source.id===route.sourceId),at='2026-11-06T00:00:00.000Z';
 const row={id:'synthetic-result',releaseCandidateId:'instabox-synthetic',batchId:'synthetic-batch',sourceId:route.sourceId,sourceConfigHash:route.sourceConfigSha256,
  transportState:'SUCCEEDED',adapterState:'SUCCEEDED',completenessState:'VERIFIED',atomicCommitState:'COMMITTED',failureCode:null,failureReason:null,blockerCode:null,blockerReason:null,
  startedAt:new Date(at),finishedAt:new Date(at),dedupeOutputCount:1,canonicalCurrentJobSetSha256:hashCanonicalStringSet(['current']),canonicalGraceJobSetSha256:hashCanonicalStringSet(['held']),canonicalVisibleJobSetSha256:hashCanonicalStringSet(['current','held']),
  completenessCertificateSha256:'a'.repeat(64),batch:{id:'synthetic-batch',releaseCandidateId:'instabox-synthetic',kind:'SCHEDULED',status:'SUCCESS'}};
 const members=[['CURRENT','current',0],['GRACE','held',1],['VISIBLE','current',0],['VISIBLE','held',1]].map(([setKind,jobKey,missingCount])=>({releaseCandidateId:row.releaseCandidateId,batchId:row.batchId,sourceId:row.sourceId,sourceResultId:row.id,setKind,jobKey,jobKeySha256:createHash('sha256').update(jobKey).digest('hex'),lifecycleStatus:'ACTIVE',missingCount}));
 for(const quarantined of [false,true]){
  const receipt={schemaVersion:'a-grade-official-total-v2',grade:'A',observedAt:at,counts:{finalUniqueJobCount:1,validationDiscardCount:quarantined?1:0},...(quarantined?{jobQuarantineLedger:[{rawLocatorSha256:'b'.repeat(64),pageSequence:0,recordIndex:1}]}:{})};
  const selected=selectPortableSourceSnapshots([plan],[{...row,completenessCertificate:receipt}],{currentTime:new Date(at)})[0];assert.equal(selected.state,'PUBLISHING');
  assert.deepEqual([...verifiedMembers(selected.selected,members).keys()],quarantined?['current','held']:['current']);
 }
});

test('portableCommittedResultsSql unpacks certificates once, gates observations, and filters redundant SOURCE_NOT_DUE', async () => {
  const { portableCommittedResultsSql } = await import('../web-candidate/src/db/portablePublicSnapshotRepository.ts');
  const sql = portableCommittedResultsSql(reader);
  assert.match(sql, /\blatest_not_due AS\s*\(/);
  assert.match(sql, /NOT \(\([^)]*'SOURCE_NOT_DUE'[^)]*\) IS TRUE\) OR r\.id IN \(SELECT id FROM latest_not_due\)/);
  assert.match(sql, /CASE WHEN r\."atomicCommitState"='COMMITTED' AND r\."completenessState"='VERIFIED'\s+THEN \(SELECT coalesce\(jsonb_agg\(/);
  assert.match(sql, /LEFT JOIN LATERAL jsonb_to_record\(/);
});

test('Pfizer transition from prior B-grade to A-grade Delta preserves prior visibility and GRACE history', () => {
  const route = routes.find(row => row.sourceId === 'source-pfizer-china-social');
  const plan = reader.find(item => item.source.id === route.sourceId);
  const priorAt = '2026-11-15T16:05:00.000Z';
  const currentAt = '2026-11-19T16:05:00.000Z';
  const priorHash = '84aaab8bad3579630eec1b12d3f09236755b3a25d0b7751ca8584a9a53a83413';
  const sha = value => createHash('sha256').update(value).digest('hex');

  const priorRow = {
    id: 'pfizer-b-grade-prior',
    releaseCandidateId: 'instabox-synthetic',
    batchId: 'pfizer-prior-batch',
    sourceId: route.sourceId,
    sourceConfigHash: priorHash,
    transportState: 'SUCCEEDED',
    adapterState: 'SUCCEEDED',
    completenessState: 'VERIFIED',
    atomicCommitState: 'COMMITTED',
    failureCode: null,
    failureReason: null,
    blockerCode: null,
    blockerReason: null,
    startedAt: new Date(priorAt),
    finishedAt: new Date(priorAt),
    dedupeOutputCount: 2,
    canonicalCurrentJobSetSha256: hashCanonicalStringSet(['pfizer-kept', 'pfizer-grace']),
    canonicalGraceJobSetSha256: hashCanonicalStringSet([]),
    canonicalVisibleJobSetSha256: hashCanonicalStringSet(['pfizer-kept', 'pfizer-grace']),
    observations: [{ crawledAt: new Date(priorAt) }],
    completenessCertificateSha256: 'b'.repeat(64),
    completenessCertificate: {
      schemaVersion: B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION,
      counts: { finalUniqueJobCount: 2, validationDiscardCount: 0 },
      mainTraversal: {
        matchKeyKind: 'SOURCE_JOB_ID',
        canonicalMatchKeySetSha256: hashCanonicalStringSet(['kept', 'grace'])
      }
    },
    batch: { id: 'pfizer-prior-batch', releaseCandidateId: 'instabox-synthetic', kind: 'SCHEDULED', status: 'SUCCESS' }
  };

  const priorOnly = selectPortableSourceSnapshots([plan], [priorRow], { currentTime: new Date(priorAt) })[0];
  assert.equal(priorOnly.state, 'PUBLISHING');
  assert.equal(priorOnly.health, 'HEALTHY');
  assert.equal(priorOnly.policyId, 'STRICT_PLAN_BOUND_INDEPENDENT_TRAVERSAL_REPLAY_V2');
  assert.equal(priorOnly.selectedSourceResultId, priorRow.id);

  const deltaRow = {
    id: 'pfizer-a-grade-delta',
    releaseCandidateId: 'instabox-synthetic',
    batchId: 'pfizer-a-batch',
    sourceId: route.sourceId,
    sourceConfigHash: route.sourceConfigSha256,
    transportState: 'SUCCEEDED',
    adapterState: 'SUCCEEDED',
    completenessState: 'VERIFIED',
    atomicCommitState: 'COMMITTED',
    failureCode: null,
    failureReason: null,
    blockerCode: null,
    blockerReason: null,
    startedAt: new Date(currentAt),
    finishedAt: new Date(currentAt),
    dedupeOutputCount: 1,
    canonicalCurrentJobSetSha256: hashCanonicalStringSet(['pfizer-kept']),
    canonicalGraceJobSetSha256: hashCanonicalStringSet(['pfizer-grace']),
    canonicalVisibleJobSetSha256: hashCanonicalStringSet(['pfizer-kept', 'pfizer-grace']),
    observations: [{
      observedFrom: new Date(currentAt),
      observedTo: new Date(currentAt),
      crawledAt: new Date(currentAt),
      sourceId: route.sourceId,
      sourceResultId: 'pfizer-a-grade-delta',
      batchId: 'pfizer-a-batch',
      releaseCandidateId: 'instabox-synthetic',
      sourceConfigSha256: route.sourceConfigSha256,
      adapterVersion: '1'.repeat(64),
      successful: true,
      transportSucceeded: true,
      adapterSucceeded: true,
      completenessVerified: true,
      atomicCommitSucceeded: true,
      canonicalOutputSha256: hashCanonicalStringSet(['pfizer-kept'])
    }],
    adapterVersion: '1'.repeat(64),
    canonicalOutputSetSha256: hashCanonicalStringSet(['pfizer-kept']),
    completenessCertificateSha256: 'c'.repeat(64),
    completenessCertificate: {
      schemaVersion: 'job-projection-delta-receipt-v1',
      binding: {
        releaseCandidateId: 'instabox-synthetic',
        batchId: 'pfizer-a-batch',
        sourceResultId: 'pfizer-a-grade-delta',
        sourceId: route.sourceId
      },
      verifiedAt: currentAt,
      observedAt: currentAt,
      members: [
        ...(['CURRENT', 'VISIBLE'].map(setKind => ({
          releaseCandidateId: 'instabox-synthetic',
          batchId: 'pfizer-a-batch',
          sourceId: route.sourceId,
          sourceResultId: 'pfizer-a-grade-delta',
          setKind,
          jobKey: 'pfizer-kept',
          jobKeySha256: sha('pfizer-kept'),
          lifecycleStatus: 'ACTIVE',
          missingCount: 0,
          jobProjectionSha256: sha('proj-kept'),
          lastPresentResultId: 'pfizer-a-grade-delta',
          lastConfirmedObservedAt: currentAt,
          lifecycleLastSeenAt: currentAt
        }))),
        ...(['GRACE', 'VISIBLE'].map(setKind => ({
          releaseCandidateId: 'instabox-synthetic',
          batchId: 'pfizer-a-batch',
          sourceId: route.sourceId,
          sourceResultId: 'pfizer-a-grade-delta',
          setKind,
          jobKey: 'pfizer-grace',
          jobKeySha256: sha('pfizer-grace'),
          lifecycleStatus: 'ACTIVE',
          missingCount: 1,
          jobProjectionSha256: sha('proj-grace'),
          lastPresentResultId: priorRow.id,
          lastConfirmedObservedAt: priorAt,
          lifecycleLastSeenAt: priorAt
        })))
      ],
      legacyCertificate: {
        schemaVersion: 'a-grade-official-total-v2',
        grade: 'A',
        observedAt: currentAt,
        counts: { finalUniqueJobCount: 1, validationDiscardCount: 0 }
      }
    },
    batch: { id: 'pfizer-a-batch', releaseCandidateId: 'instabox-synthetic', kind: 'SCHEDULED', status: 'SUCCESS' }
  };

  const transitioned = selectPortableSourceSnapshots([plan], [priorRow, deltaRow], { currentTime: new Date(currentAt) })[0];
  assert.equal(transitioned.state, 'PUBLISHING', JSON.stringify(transitioned.reasons));
  assert.equal(transitioned.health, 'HEALTHY');
  assert.equal(transitioned.policyId, 'STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1');
  assert.equal(transitioned.selectedSourceResultId, deltaRow.id);
  assert.equal(transitioned.visibilityFloor, currentAt);
  const members = [
    ['CURRENT', 'pfizer-kept', 0],
    ['GRACE', 'pfizer-grace', 1],
    ['VISIBLE', 'pfizer-kept', 0],
    ['VISIBLE', 'pfizer-grace', 1]
  ].map(([setKind, jobKey, missingCount]) => ({
    releaseCandidateId: deltaRow.releaseCandidateId,
    batchId: deltaRow.batchId,
    sourceId: deltaRow.sourceId,
    sourceResultId: deltaRow.id,
    setKind,
    jobKey,
    jobKeySha256: sha(jobKey),
    lifecycleStatus: 'ACTIVE',
    missingCount
  }));
  assert.deepEqual([...verifiedMembers(transitioned.selected, members).keys()], ['pfizer-kept', 'pfizer-grace']);
});
