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
