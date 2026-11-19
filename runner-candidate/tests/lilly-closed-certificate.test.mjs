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
import {lillyPhenomListProjection} from '../src/crawler/lillyChinaQuality.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';
import {memoryDb} from './memory-db.mjs';
import {identityForSource} from '../scripts/direct-round.ts';
import {withPortableCrawlLease} from '../src/crawler/portableCrawlLease.ts';
import {runP0CrawlBatch} from '../src/crawler/runCrawlBatch.ts';

test('Phenom-only Lilly traversal reconciles across pages without Workday HTTP calls and retains last good on block',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-lilly-china-social');
 const sample=JSON.parse(readFileSync(new URL('./fixtures/lilly-location-change.json',import.meta.url)));
 sample.postedDate='unknown';sample.dateCreated='unknown';sample.displayBadge='New';
 const rows=Array.from({length:51},(_,i)=>{
  const reqId=`R-${800000+i}`;
  return {
   ...sample,reqId,jobId:reqId,jobSeqNo:`LILLUS${reqId.replace('-','')}EXTERNALENUS`,
   applyUrl:sample.applyUrl.replace(sample.reqId,reqId).replace('/China-Bao-Ding-/',i===0?'/China-Ka-Shi/':i===1?'/China-Unmapped-Prefecture/':'/China-Bao-Ding-/')
  };
 });
 assert.deepEqual(lillyPhenomListProjection(rows[0])?.cities,['喀什']);
 assert.deepEqual(lillyPhenomListProjection(rows[1])?.cities,[CITY_PENDING]);
 const bootstrap={widgetApiEndpoint:'https://careers.lilly.com/widgets',country:'us',deviceType:'desktop',locale:'en_us',refNum:'LILLUS',pageName:'search-results',pageId:'page11-ds'};
 let page=0,listMode='healthy',detailRequests=0;
 const fetch=createOfficialJsonSourceFetch({allowBrowserFallback:false,http:async({url,method})=>{
  let body,contentType='text/html';
  if(url===plan.source.officialEntryUrl)body=`<script>var phApp=${JSON.stringify(bootstrap)};</script>`;
  else if(url===bootstrap.widgetApiEndpoint){
   assert.equal(method,'POST');
   if(listMode!=='healthy')return {status:429,finalUrl:url,body:'Security Check',contentType,capturedAt:new Date().toISOString(),retryAfter:{value:'2700',delayMs:2700000}};
   const jobs=rows.slice(page*50,(++page)*50);
   body=JSON.stringify({refineSearch:{status:200,hits:jobs.length,totalHits:rows.length,data:{jobs,aggregations:[],ui_selections:{country:['China']}}}});
   contentType='application/json';
  }else{
   detailRequests+=1;
   assert.fail(`Unexpected Workday detail request: ${url}`);
  }
  return {status:200,finalUrl:url,body,contentType,capturedAt:new Date().toISOString()};
 }});
 const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
 assert.equal(result.status,'SUCCESS');
 assert.equal(detailRequests,0);
 assert.equal(result.jobs.length,51);
 assert.deepEqual(result.jobs[0].cities,['喀什']);
 assert.deepEqual(result.jobs[1].cities,[CITY_PENDING]);
 assert(result.jobs.every(job=>job.officialPublishedAt===undefined));
 const evidence=result.fetchEvidence,binding={releaseCandidateId:'synthetic',batchId:'synthetic',sourceResultId:'synthetic-source',sourceConfigSha256:sourcePlanConfigSha256(plan)};
 const official=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness.artifactLogicalKey);
 const input={binding,plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(official.body).digest('hex')};
 const decision=issueAGradeOfficialTotalCertificate(input);assert.equal(decision.status,'CERTIFIED',JSON.stringify(decision));
 assert.equal(decision.certificate.legalScopeExclusionLedger.length,0);
 assert.equal(verifyAGradeCompletenessCertificateReceipt({certificate:decision.certificate,certificateSha256:decision.certificateSha256,expected:{...binding,sourceId:plan.source.id}}).status,'PASS');
 assert.equal(verifyAGradeCompletenessCertificateReceipt({certificate:JSON.parse(JSON.stringify(decision.certificate)),certificateSha256:decision.certificateSha256,expected:{...binding,sourceId:plan.source.id}}).status,'PASS','Persisted no-quarantine certificates must retain their hash');
 const changed=structuredClone(evidence);changed.pages[0].declaredTotal=50;
 assert.equal(issueAGradeOfficialTotalCertificate({...input,evidence:changed}).status,'REJECTED');
 const workspaceRoot=await mkdtemp(join(tmpdir(),'lilly-atomic-'));
 try{
  page=0;
  const candidate={id:'synthetic-lilly',commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};
  const run=(memory,batchId)=>withPortableCrawlLease(memory.db,lease=>runP0CrawlBatch([plan],{
   db:memory.db,identity:identityForSource(candidate,plan.source.id),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',portableLease:lease,
   workspaceRoot,fetch,now:()=>new Date(),createBatchId:()=>batchId,evidenceSubdirectory:'e',
   getPreviousJobs:async()=>[],getRecentObservations:async()=>[],isBaselineCompleted:async()=>false,
   getTrustedCompletenessBaseline:async()=>null,getFirstAcceptedCurrentPolicyReceipt:async()=>null
  }));
  const memory=memoryDb();
  memory.db.crawlBatchSourceResult.findMany=async({where})=>memory.rows.filter(row=>row.batchId===where.batchId);
  const round=await run(memory,'b');
  assert.equal(round.status,'SUCCESS',JSON.stringify(memory.rows));
  assert.equal(memory.rows[0].atomicCommitState,'COMMITTED');assert.equal(memory.rows[0].completenessState,'VERIFIED');assert.equal(memory.jobWrites(),51);
  const lastGood=structuredClone(memory.rows[0]);
  page=0;listMode='blocked';
  await run(memory,'blocked');
  const attempt=memory.rows.at(-1);
  assert.equal(attempt.atomicCommitState,'NOT_ATTEMPTED');
  assert.equal(attempt.failureDiagnosticCode,'OFFICIAL_HTTP_429');
  assert.deepEqual(memory.rows[0],lastGood);
  assert.equal(memory.jobWrites(),51);
 }finally{await rm(workspaceRoot,{recursive:true,force:true});}
});
