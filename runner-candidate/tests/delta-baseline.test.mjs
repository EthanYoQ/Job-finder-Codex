import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrismaCrawlRuntimeDeps } from '../src/db/crawlRuntimeRepository.ts';
import { hashProjectionJson, hashDeltaManifest, JOB_PROJECTION_DELTA_SCHEMA, JOB_PERSISTED_PROJECTION_SCHEMA } from '../src/domain/jobProjectionDeltaReceipt.ts';

// These are synthetic reader envelopes, not source-admission fixtures.
function persisted(grade, wrapped=true) {
  const legacy={grade,syntheticReaderFixture:true};
  const binding={releaseCandidateId:'old-candidate',batchId:'old-batch',sourceId:'synthetic-source',sourceResultId:'old-result'};
  const time='2026-10-31T04:00:00.000Z';
  const delta={schemaVersion:JOB_PROJECTION_DELTA_SCHEMA,projectionSchemaVersion:JOB_PERSISTED_PROJECTION_SCHEMA,
    binding,verifiedAt:time,observedAt:time,legacyCertificate:legacy,legacyCertificateSha256:hashProjectionJson(legacy),
    detailEvidenceState:'UNKNOWN',members:[],manifestSha256:hashDeltaManifest([])};
  const certificate=wrapped?delta:legacy;
  return {id:binding.sourceResultId,releaseCandidateId:binding.releaseCandidateId,batchId:binding.batchId,sourceId:binding.sourceId,
    sourceConfigHash:'a'.repeat(64),adapterVersion:'synthetic',dedupeOutputCount:0,finishedAt:new Date(time),
    completenessCertificate:certificate,completenessCertificateSha256:hashProjectionJson(certificate),
    baselinePreviousSourceResultId:null,baselinePreviousJobCount:null,
    baselineChangeReason:grade==='A'?'OFFICIAL_EVIDENCE_CONFIRMED_INITIAL':'INDEPENDENT_VALIDATION_CONFIRMED_INITIAL'};
}
const read=row=>createPrismaCrawlRuntimeDeps({crawlBatchSourceResult:{findFirst:async()=>row}}).getTrustedCompletenessBaseline(row.sourceId);

for(const grade of ['A','B']) test(`${grade} delta baseline exposes the verified inner certificate without changing historical rows`,async()=>{
  const row=persisted(grade), before=JSON.stringify(row), inner=row.completenessCertificate.legacyCertificate;
  const baseline=await read(row);
  assert.deepEqual(baseline.certificate,inner);
  assert.equal(baseline.certificateGrade,grade);
  assert.equal(baseline.certificateSha256,hashProjectionJson(inner));
  assert.equal(baseline.sourceResultId,row.id);
  assert.equal(baseline.verifiedAt,row.finishedAt.toISOString());
  assert.equal(JSON.stringify(row),before);
  const plain=persisted(grade,false);
  assert.deepEqual(await read(plain),baseline);
});

test('delta baseline rejects corrupted hashes, bindings, time, and inner certificate before grade use',async()=>{
  const mutations=[
    [row=>{row.completenessCertificateSha256='0'.repeat(64);},/JOB_DELTA_RECEIPT_HASH_MISMATCH/],
    [row=>{row.batchId='another-batch';},/JOB_DELTA_BASELINE_TUPLE_MISMATCH/],
    [row=>{row.releaseCandidateId='another-candidate';},/JOB_DELTA_BASELINE_TUPLE_MISMATCH/],
    [row=>{row.sourceId='another-source';},/JOB_DELTA_BASELINE_TUPLE_MISMATCH/],
    [row=>{row.id='another-result';},/JOB_DELTA_BASELINE_TUPLE_MISMATCH/],
    [row=>{row.finishedAt=new Date('2026-10-31T04:00:01Z');},/JOB_DELTA_BASELINE_TIME_MISMATCH/],
    [row=>{row.completenessCertificate.legacyCertificate.grade='B';row.completenessCertificateSha256=hashProjectionJson(row.completenessCertificate);},/JOB_DELTA_LEGACY_CERTIFICATE_HASH_MISMATCH/]
  ];
  for(const [mutate,expected] of mutations){const row=persisted('A');mutate(row);await assert.rejects(read(row),expected);}
});

test('unwrapped baseline still enforces the original transition and count rules',async()=>{
  const row=persisted('A');row.baselineChangeReason='INDEPENDENT_VALIDATION_CONFIRMED_INITIAL';
  await assert.rejects(read(row),/transition reason does not match certificate grade/);
  const invalid=persisted('A');invalid.dedupeOutputCount=-1;
  await assert.rejects(read(invalid),/nonnegative integer/);
});
