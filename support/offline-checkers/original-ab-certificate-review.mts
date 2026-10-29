import assert from 'node:assert/strict';
// Review only: replay original issuers; never dispatch or acquire a lease.
export async function reviewOriginalABCertificate(V:string,d:any,native:any,independentValidation?:unknown,now=new Date()){
 const {issueAGradeOfficialTotalCertificate,verifyAGradeCompletenessCertificateReceipt}=await import(V+'/src/crawler/completenessCertificate.ts');
 const {requiresBGradeTraversalCertificate,issueBGradeTraversalCertificate,verifyBGradeTraversalCertificateReceipt,isCurrentBGradeCertificateSchema,SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION,BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION}=await import(V+'/src/crawler/traversalCertificate.ts');
 const {createHash}=await import('node:crypto');
 const certificate=d.receipt.legacyCertificate,certificateSha256=d.receipt.legacyCertificateSha256;
 const expected={releaseCandidateId:d.terminal.releaseCandidateId,batchId:d.terminal.batchId,sourceResultId:d.terminal.id,sourceId:d.terminal.sourceId,sourceConfigSha256:d.terminal.sourceConfigHash,companyId:d.plan.company.id};
 assert.equal(d.plan.source.id,expected.sourceId);assert.equal(native.status,'SUCCESS');
 const input={plan:d.plan,binding:{releaseCandidateId:expected.releaseCandidateId,batchId:expected.batchId,sourceResultId:expected.sourceResultId,sourceConfigSha256:expected.sourceConfigSha256},transportSuccess:native.truth.transportSuccess,adapterSuccess:native.truth.adapterSuccess,evidence:native.fetchEvidence,paginationEvaluation:native.paginationEvaluation,reconciliation:native.reconciliation,jobs:native.jobs};
 let issued;
 if(requiresBGradeTraversalCertificate(d.plan)){
  assert(['source-pfizer-china-social','source-bayer-healthcare-social','source-servier-china-social','source-sanofi-china-social'].includes(expected.sourceId),'UNIMPLEMENTED_B_UI_ROUTE');
  assert(isCurrentBGradeCertificateSchema(certificate.schemaVersion),'CURRENT_B_CERTIFICATE_REQUIRED');
  assert.deepEqual(certificate.validationPolicy,{trigger:'INITIAL_QUALIFICATION',execution:'CURRENT_RUN'});
  let compactArchive;const bayer=certificate.schemaVersion===BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION;
  if(certificate.schemaVersion===SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION||bayer){
   assert.equal(expected.sourceId,bayer?'source-bayer-healthcare-social':'source-sanofi-china-social');
   assert(Buffer.isBuffer(independentValidation),'SANOFI_INDEPENDENT_ORIGINAL_BYTES_REQUIRED');
   const raw=independentValidation;independentValidation=JSON.parse(raw.toString('utf8'));
   compactArchive={artifacts:d.decoded.filter((x:any)=>x.table==='EvidenceArtifact').flatMap((x:any)=>x.rows),independentOriginal:{sha256:createHash('sha256').update(raw).digest('hex'),byteCount:raw.length,canonicalArtifactSha256:(independentValidation as any).artifactSha256}};
  }else assert.deepEqual(independentValidation,certificate.independentValidation,'CURRENT_UI_ORIGINAL_BINDING');
  const {canonicalStringSetSha256}=await import(V+'/src/crawler/sourceFetchEvidence.ts');
  const canonicalRawEvidenceIdSetSha256=canonicalStringSetSha256(native.fetchEvidence.pages.flatMap((p:any)=>p.rawJobIds));
  verifyBGradeTraversalCertificateReceipt({certificate,certificateSha256,expected:{...expected,
   surfaceIds:d.terminal.officialSurfaceIds,channelIds:d.terminal.officialChannelIds,
   canonicalJobSetSha256:d.terminal.canonicalOutputSetSha256,
   adapterReconciliationSha256:d.terminal.adapterReconciliationSha256,
   collisionLedgerSha256:d.terminal.collisionLedgerSha256,canonicalRawEvidenceIdSetSha256,
   ...((expected.sourceId==='source-sanofi-china-social'||bayer)?{[bayer?'bayerArtifacts':'sanofiArtifacts']:d.decoded.filter((x:any)=>x.table==='EvidenceArtifact').flatMap((x:any)=>x.rows)}:{})},now});
  issued=issueBGradeTraversalCertificate({...input,...(compactArchive?{[bayer?'bayerArchive':'sanofiArchive']:compactArchive}:{}),independentValidation,validationExecution:'CURRENT_RUN',trigger:'INITIAL_QUALIFICATION',now:new Date(certificate.issuedAt)});
 }else{
  assert.equal(certificate.schemaVersion,'a-grade-official-total-v2');
  verifyAGradeCompletenessCertificateReceipt({certificate,certificateSha256,expected});
  const artifact=native.fetchEvidence.artifacts.find((a:any)=>a.logicalKey===native.fetchEvidence.declaredCompleteness?.artifactLogicalKey);assert(artifact);
  issued=issueAGradeOfficialTotalCertificate({...input,officialArtifactSha256:createHash('sha256').update(artifact.body).digest('hex')});
 }
 assert.equal(issued.status,'CERTIFIED',JSON.stringify(issued));
 assert.deepEqual(issued.certificate,certificate,'ORIGINAL_AB_CERTIFICATE_REISSUE');
 assert.equal(issued.certificateSha256,certificateSha256);
 assert(now.getTime()<Date.parse(d.terminal.startedAt)+30*60_000,'ORIGINAL_CAPTURE_EXPIRED');
 return {originalCertificateReissued:true,grade:certificate.schemaVersion.startsWith('a-')?'A':'B'};
}
