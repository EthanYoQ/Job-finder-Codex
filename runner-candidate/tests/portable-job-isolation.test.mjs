import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {memoryDb} from './memory-db.mjs';
import {loadDirectPlans,identityForSource} from '../scripts/direct-round.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {runP0CrawlBatch} from '../src/crawler/runCrawlBatch.ts';
import {createOwnedSourceQualityFetch,issueSourceQualityAdmission,SOURCE_QUALITY_POLICY_ID} from '../src/crawler/sourceQualityAdmission.ts';
import {archiveSourceEvidence} from '../src/crawler/artifactArchive.ts';
import {bindRuntimeEvidenceArtifactIds} from '../src/crawler/runtimeAtomicEvidence.ts';
import {buildJobDedupeKey} from '../src/crawler/normalizedJob.ts';
import {withPortableCrawlLease} from '../src/crawler/portableCrawlLease.ts';
import {selectPortableSourceSnapshots,projectPortableSourceJobs} from '../../web-candidate/src/domain/portablePublicSnapshot.ts';

test('quarantined list jobs retain old data in the public snapshot without a false source-count drop',async()=>{
 const workspaceRoot=await mkdtemp(join(tmpdir(),'portable-job-isolation-')),originalFetch=globalThis.fetch;
 const route=(await loadDirectPlans()).find(row=>row.sourceId==='source-abbvie-china-social'),plan=route.plan;
 let broken=false;
 globalThis.fetch=async url=>{
  assert.equal(String(url),plan.source.officialEntryUrl);
  const body='<span class="attrax-pagination__results-of--2" data-total-pages="1"></span><span class="attrax-pagination__total-results">32</span>'+Array.from({length:32},(_,index)=>`<div class="attrax-vacancy-tile"><a class="attrax-vacancy-tile__title" href="/zh-hans/job/role-jid-${index+1}">${broken&&index>0?'':`${broken?'Updated':'Original'} role ${index+1}`}</a><div class="attrax-vacancy-tile__location-freetext"><span class="attrax-vacancy-tile__item-value">Shanghai, Shanghai</span></div><div class="attrax-vacancy-tile__option-location"><span class="attrax-vacancy-tile__item-value">China</span></div></div>`).join('');
  return {status:200,url:String(url),headers:new Headers({'content-type':'text/html'}),text:async()=>body};
 };
 try{
  const prior=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});assert.equal(prior.jobs.length,32);
  const binding={releaseCandidateId:'isolation-prior',batchId:'isolation-prior-batch',sourceResultId:'isolation-prior-result',sourceConfigSha256:route.sourceConfigSha256,adapterVersion:'a'.repeat(64)},evidenceSubdirectory='evidence';
  const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:prior.fetchEvidence.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:prior.fetchEvidence.artifacts})});
  const admission=await issueSourceQualityAdmission({plan,result:prior,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});assert.equal(admission.status,'ACCEPTED');
  const previous=prior.jobs.map(record=>({record,dedupeKey:buildJobDedupeKey(record),lifecycleStatus:'ACTIVE',missingSuccessfulCrawlCount:0,firstSeenAt:admission.receipt.issuedAt,lastSeenAt:admission.receipt.issuedAt}));
  const priorReceipt={receipt:admission.receipt,receiptSha256:admission.receiptSha256,expectedBinding:admission.receipt.binding};
  const baseline={sourceId:plan.source.id,sourceResultId:binding.sourceResultId,sourceConfigSha256:route.sourceConfigSha256,certificateGrade:SOURCE_QUALITY_POLICY_ID,certificateSha256:admission.receiptSha256,certifiedJobCount:32,verifiedAt:admission.receipt.issuedAt,certificate:admission.receipt,previousSourceResultId:null,previousJobCount:null,changeReason:'PLAN_BOUND_REPLAY_CONFIRMED_INITIAL'};
  broken=true;
  const memory=memoryDb(),writes=[],members=[];
  memory.db.job.upsert=async args=>writes.push(args);memory.db.lifecycleSetEvidenceMember.create=async({data})=>members.push(data);
  const candidate={id:'isolation-current',commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};
  const result=await withPortableCrawlLease(memory.db,lease=>runP0CrawlBatch([plan],{db:memory.db,identity:identityForSource(candidate,plan.source.id),now:()=>new Date(),workspaceRoot,evidenceSubdirectory,publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,portableLease:lease,
   getPreviousJobs:async()=>previous,getRecentObservations:async()=>[],isBaselineCompleted:async()=>true,getTrustedCompletenessBaseline:async()=>baseline,getFirstAcceptedCurrentPolicyReceipt:async()=>priorReceipt,fetch:createOwnedSourceQualityFetch()}));
  assert.equal(result.status,'SUCCESS',JSON.stringify(memory.rows));assert.equal(memory.rows[0].atomicCommitState,'COMMITTED');assert.equal(memory.rows[0].completenessState,'VERIFIED');assert.equal(memory.rows[0].dedupeOutputCount,1);assert.equal(writes.length,32);
  for(const old of previous.slice(1)){
   const held=writes.find(write=>write.where.sourceId_dedupeKey.dedupeKey===old.dedupeKey);assert.equal(held.update.officialTitle,old.record.officialTitle);assert.equal(held.update.lastSeenAt.toISOString(),old.lastSeenAt);assert.equal(held.update.lifecycleStatus,'ACTIVE');
  }
  const current={...memory.rows[0],batch:memory.batches[0]},priorRow={...current,id:binding.sourceResultId,releaseCandidateId:binding.releaseCandidateId,batchId:binding.batchId,startedAt:prior.observation.crawledAt,finishedAt:new Date(admission.receipt.issuedAt),dedupeOutputCount:32,completenessCertificate:admission.receipt,completenessCertificateSha256:admission.receiptSha256,batch:{id:binding.batchId,releaseCandidateId:binding.releaseCandidateId,kind:'SCHEDULED',status:'SUCCESS'}};
  const options={currentTime:new Date()},selection=selectPortableSourceSnapshots([plan],[priorRow,current],options)[0];
  const projected=projectPortableSourceJobs(selection,members,writes.map((write,index)=>({id:`job-${index}`,...write.create,...write.update})),options);
  assert.equal(projected.state,'PUBLISHING',projected.reasons.join(','));assert.equal(projected.jobs.length,32);assert.equal(projected.jobs.filter(job=>job.inGrace).length,31);
 }finally{globalThis.fetch=originalFetch;await rm(workspaceRoot,{recursive:true,force:true});}
});
