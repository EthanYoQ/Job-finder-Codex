import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pages,detail} from './novo-synthetic-pages.ts';
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

for(const mode of ['short-description','bound-empty-shell','unbound-empty-shell'])test(`Novo ${mode} preserves UNKNOWN without blocking proven jobs or publishing unbound pages`,async()=>{
  const workspaceRoot=await mkdtemp(join(tmpdir(),'novo-grace-'));
  const oldFetch=globalThis.fetch;
  let insufficient=false;
  globalThis.fetch=async url=>{
    const page=pages.get(String(url));
    assert.ok(page,`Unexpected synthetic URL: ${url}`);
    const body=insufficient&&String(url)===detail(2)?mode==='short-description'?page.body.replace(
      'Develop synthetic laboratory procedures and maintain documented quality controls for research teams.','*'):
      `<link rel="canonical" href="${mode==='bound-empty-shell'?detail(2):detail(1)}"><div id="careerjobdisplay"><h1></h1><div class="job-display-details right-column"></div></div>`:page.body;
    return {status:200,url:page.finalUrl,headers:new Headers({'content-type':page.contentType}),text:async()=>body};
  };
  try {
    const route=(await loadDirectPlans()).find(row=>row.sourceId==='source-novo-nordisk-china-social');
    const plan=route.plan;
    const prior=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});
    const binding={releaseCandidateId:'synthetic-prior',batchId:'synthetic-prior-batch',sourceResultId:'synthetic-prior-result',sourceConfigSha256:route.sourceConfigSha256,adapterVersion:'a'.repeat(64)};
    const evidenceSubdirectory='evidence';
    const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:prior.fetchEvidence.captureTool,
      artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:prior.fetchEvidence.artifacts})});
    const admission=await issueSourceQualityAdmission({plan,result:prior,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});
    assert.equal(admission.status,'ACCEPTED');
    const record=prior.jobs.find(job=>job.officialUrl===detail(2));
    assert.ok(record);
    const old={record,dedupeKey:buildJobDedupeKey(record),lifecycleStatus:'ACTIVE',missingSuccessfulCrawlCount:0,
      firstSeenAt:admission.receipt.issuedAt,lastSeenAt:admission.receipt.issuedAt};
    const priorReceipt={receipt:admission.receipt,receiptSha256:admission.receiptSha256,expectedBinding:admission.receipt.binding};
    const candidate={id:'instabox-synthetic',commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};
    insufficient=true;
    let previous=structuredClone(old);
    for(let round=0;round<3;round++) {
      const memory=memoryDb(),writes=[],members=[];
      memory.db.job.upsert=async args=>writes.push(args);
      memory.db.lifecycleSetEvidenceMember.create=async({data})=>members.push(data);
      const result=await withPortableCrawlLease(memory.db,lease=>runP0CrawlBatch([plan],{
        db:memory.db,identity:identityForSource(candidate,plan.source.id),now:()=>new Date(),workspaceRoot,evidenceSubdirectory,
        publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,portableLease:lease,
        getPreviousJobs:async()=>round===2?[]:[previous],getRecentObservations:async()=>[],isBaselineCompleted:async()=>true,
        getTrustedCompletenessBaseline:async()=>null,getFirstAcceptedCurrentPolicyReceipt:async()=>priorReceipt,
        fetch:createOwnedSourceQualityFetch()
      }));
      assert.equal(result.status,'SUCCESS');
      assert.equal(memory.rows[0].completenessState,'VERIFIED');
      assert.equal(memory.rows[0].atomicCommitState,'COMMITTED');
      assert.equal(memory.rows[0].dedupeOutputCount,1);
      const held=writes.find(write=>write.where.sourceId_dedupeKey.dedupeKey===old.dedupeKey);
      if(round===2){assert.equal(held,undefined);assert.equal(writes.length,1);continue;}
      assert.ok(held);assert.equal(held.update.lifecycleStatus,'ACTIVE');assert.equal(held.update.missingSuccessCount,1);
      assert.equal(held.update.lastSeenAt.toISOString(),old.lastSeenAt);
      assert.equal(held.update.officialTitle,old.record.officialTitle);assert.equal(held.update.officialUrl,old.record.officialUrl);
      assert.deepEqual(members.filter(member=>member.jobKey===old.dedupeKey).map(member=>member.setKind).sort(),['GRACE','VISIBLE']);
      assert.equal(writes.length,2); // Known valid row + retained UNKNOWN; explicit closure stays absent.
      const current={...memory.rows[0],batch:memory.batches[0]};
      const priorRow={...current,id:binding.sourceResultId,releaseCandidateId:binding.releaseCandidateId,batchId:binding.batchId,
        startedAt:prior.observation.crawledAt,finishedAt:new Date(admission.receipt.issuedAt),
        dedupeOutputCount:admission.receipt.counts.finalUniqueJobCount,completenessCertificate:admission.receipt,
        completenessCertificateSha256:admission.receiptSha256,batch:{id:binding.batchId,releaseCandidateId:binding.releaseCandidateId,kind:'SCHEDULED',status:'SUCCESS'}};
      const options={currentTime:new Date()};
      const selection=selectPortableSourceSnapshots([plan],[priorRow,current],options)[0];
      const projected=projectPortableSourceJobs(selection,members,writes.map((write,index)=>({id:`job-${index}`,...write.create,...write.update})),options);
      assert.equal(projected.state,'PUBLISHING',projected.reasons.join(','));
      assert.equal(projected.jobs.length,2);
      const visibleOld=projected.jobs.find(job=>job.officialUrl===old.record.officialUrl);
      assert.equal(visibleOld.inGrace,true);assert.equal(visibleOld.lastSeenAt,old.lastSeenAt);
      previous={...structuredClone(old),missingSuccessfulCrawlCount:1};
    }
  } finally {
    globalThis.fetch=oldFetch;
    await rm(workspaceRoot,{recursive:true,force:true});
  }
});
