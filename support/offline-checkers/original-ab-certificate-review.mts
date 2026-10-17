import assert from 'node:assert/strict';
// Review only: replay original issuers; never dispatch or acquire a lease.
export async function reviewOriginalABCertificate(V:string,d:any,native:any,independentValidation?:unknown,now=new Date()){
 const {issueAGradeOfficialTotalCertificate,verifyAGradeCompletenessCertificateReceipt}=await import(V+'/src/crawler/completenessCertificate.ts');
 const {requiresBGradeTraversalCertificate,issueBGradeTraversalCertificate,verifyBGradeTraversalCertificateReceipt}=await import(V+'/src/crawler/traversalCertificate.ts');
 const {createHash}=await import('node:crypto');
 const certificate=d.receipt.legacyCertificate,certificateSha256=d.receipt.legacyCertificateSha256;
 const expected={releaseCandidateId:d.terminal.releaseCandidateId,batchId:d.terminal.batchId,sourceResultId:d.terminal.id,sourceId:d.terminal.sourceId,sourceConfigSha256:d.terminal.sourceConfigHash,companyId:d.plan.company.id};
 assert.equal(d.plan.source.id,expected.sourceId);assert.equal(native.status,'SUCCESS');
 const input={plan:d.plan,binding:{releaseCandidateId:expected.releaseCandidateId,batchId:expected.batchId,sourceResultId:expected.sourceResultId,sourceConfigSha256:expected.sourceConfigSha256},transportSuccess:native.truth.transportSuccess,adapterSuccess:native.truth.adapterSuccess,evidence:native.fetchEvidence,paginationEvaluation:native.paginationEvaluation,reconciliation:native.reconciliation,jobs:native.jobs};
 let issued;
 if(requiresBGradeTraversalCertificate(d.plan)){
  assert.equal(expected.sourceId,'source-pfizer-china-social','UNIMPLEMENTED_B_UI_ROUTE');
  assert.equal(certificate.schemaVersion,'b-grade-independent-traversal-v2');
  assert.deepEqual(certificate.validationPolicy,{trigger:'INITIAL_QUALIFICATION',execution:'CURRENT_RUN'});
  assert.deepEqual(independentValidation,certificate.independentValidation,'CURRENT_UI_ORIGINAL_BINDING');
  const {canonicalStringSetSha256}=await import(V+'/src/crawler/sourceFetchEvidence.ts');
  const canonicalRawEvidenceIdSetSha256=canonicalStringSetSha256(native.fetchEvidence.pages.flatMap((p:any)=>p.rawJobIds));
  verifyBGradeTraversalCertificateReceipt({certificate,certificateSha256,expected:{...expected,
   surfaceIds:d.terminal.officialSurfaceIds,channelIds:d.terminal.officialChannelIds,
   canonicalJobSetSha256:d.terminal.canonicalOutputSetSha256,
   adapterReconciliationSha256:d.terminal.adapterReconciliationSha256,
   collisionLedgerSha256:d.terminal.collisionLedgerSha256,canonicalRawEvidenceIdSetSha256},now});
  issued=issueBGradeTraversalCertificate({...input,independentValidation,validationExecution:'CURRENT_RUN',trigger:'INITIAL_QUALIFICATION',now:new Date(certificate.issuedAt)});
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
