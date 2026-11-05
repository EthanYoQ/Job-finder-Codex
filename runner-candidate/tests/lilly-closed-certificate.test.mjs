import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {issueAGradeOfficialTotalCertificate,verifyAGradeCompletenessCertificateReceipt} from '../src/crawler/completenessCertificate.ts';
import {memoryDb} from './memory-db.mjs';
import {identityForSource} from '../scripts/direct-round.ts';
import {withPortableCrawlLease} from '../src/crawler/portableCrawlLease.ts';
import {runP0CrawlBatch} from '../src/crawler/runCrawlBatch.ts';

test('closed Lilly applications reconcile across pages and altered closure evidence remains rejected',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-lilly-china-social');
 const sample=JSON.parse(readFileSync(new URL('./fixtures/lilly-location-change.json',import.meta.url)));
 sample.postedDate='unknown';sample.dateCreated='unknown';sample.displayBadge='New';
 const rows=Array.from({length:51},(_,i)=>{const reqId=`R-${800000+i}`;return {...sample,reqId,jobId:reqId,jobSeqNo:`LILLUS${reqId.replace('-','')}EXTERNALENUS`,applyUrl:sample.applyUrl.replace(sample.reqId,reqId)};});
 const bootstrap={widgetApiEndpoint:'https://careers.lilly.com/widgets',country:'us',deviceType:'desktop',locale:'en_us',refNum:'LILLUS',pageName:'search-results',pageId:'page11-ds'};
 let page=0;
 const fetch=createOfficialJsonSourceFetch({allowBrowserFallback:false,http:async({url,method})=>{
  let body,contentType='text/html';
  if(url===plan.source.officialEntryUrl)body=`<script>var phApp=${JSON.stringify(bootstrap)};</script>`;
  else if(url===bootstrap.widgetApiEndpoint){assert.equal(method,'POST');const jobs=rows.slice(page*50,(++page)*50);body=JSON.stringify({refineSearch:{status:200,hits:jobs.length,totalHits:rows.length,data:{jobs,aggregations:[],ui_selections:{country:['China']}}}});contentType='application/json';}
  else {const i=rows.findIndex(r=>r.applyUrl===url);assert(i>=0,'unexpected request');const r=rows[i];body=i===0||i===50?`<meta property="og:url" content="${url}"><script>window.workday={tenant:'lilly',siteId:'LLY',postingAvailable:false};</script>`:`<script>window.workday={postingAvailable:true};</script><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:{value:r.reqId},title:r.title,description:'Role',datePosted:'2026-11-03',jobLocation:{address:{addressCountry:'China',addressLocality:'CN: Bao Ding'}}})}</script>`;}
  return {status:200,finalUrl:url,body,contentType,capturedAt:new Date().toISOString()};
 }});
 const result=await runSourceCrawl(plan,{fetch,isBaseline:false});assert.equal(result.status,'SUCCESS');assert.equal(result.jobs.length,49);
 assert(result.jobs.every(job=>job.officialPublishedAt===undefined));
 const evidence=result.fetchEvidence,binding={releaseCandidateId:'synthetic',batchId:'synthetic',sourceResultId:'synthetic-source',sourceConfigSha256:sourcePlanConfigSha256(plan)};
 const official=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness.artifactLogicalKey);
 const input={binding,plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(official.body).digest('hex')};
 const decision=issueAGradeOfficialTotalCertificate(input);assert.equal(decision.status,'CERTIFIED',JSON.stringify(decision));
 assert.deepEqual(decision.certificate.legalScopeExclusionLedger.map(x=>x.recordIndex),[0,50]);
 assert.equal(verifyAGradeCompletenessCertificateReceipt({certificate:decision.certificate,certificateSha256:decision.certificateSha256,expected:{...binding,sourceId:plan.source.id}}).status,'PASS');
 const changed=structuredClone(evidence);changed.fetchLosses[0].details.code='UNVERIFIED_FAILURE';
 assert.equal(issueAGradeOfficialTotalCertificate({...input,evidence:changed}).status,'REJECTED');
 const workspaceRoot=await mkdtemp(join(tmpdir(),'lilly-atomic-')),memory=memoryDb();
 try {
  page=0;
  const candidate={id:'synthetic-lilly',commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};
  const round=await withPortableCrawlLease(memory.db,lease=>runP0CrawlBatch([plan],{
   db:memory.db,identity:identityForSource(candidate,plan.source.id),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',portableLease:lease,
   workspaceRoot,fetch,now:()=>new Date(),createBatchId:()=> 'b',evidenceSubdirectory:'e',
   getPreviousJobs:async()=>[],getRecentObservations:async()=>[],isBaselineCompleted:async()=>false,
   getTrustedCompletenessBaseline:async()=>null,getFirstAcceptedCurrentPolicyReceipt:async()=>null
  }));
  assert.equal(round.status,'SUCCESS',JSON.stringify(memory.rows));
  assert.equal(memory.rows[0].atomicCommitState,'COMMITTED');assert.equal(memory.rows[0].completenessState,'VERIFIED');assert.equal(memory.jobWrites(),49);
 }finally{await rm(workspaceRoot,{recursive:true,force:true});}
});
