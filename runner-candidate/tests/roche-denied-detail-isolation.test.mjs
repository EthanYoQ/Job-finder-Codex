import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
import {replayStrictSourceQualityEvidence as replayWebStrictSourceQualityEvidence} from '../../web-candidate/src/crawler/runSourceCrawl.ts';
import {rocheDeniedDetail,rocheNativeDetailUrl,rochePhenomListDetail} from '../src/crawler/rocheChinaQuality.ts';
import {persistentOfficialJsonJobId} from '../src/crawler/officialJsonEvidence.ts';
import {archiveSourceEvidence,verifyArchivedSourceEvidence} from '../src/crawler/artifactArchive.ts';
import {buildAtomicRuntimeCommit,buildPendingRuntimeBatch,verifyAtomicRuntimeCommitForPersistence} from '../src/crawler/runtimeAtomicEvidence.ts';
import {canonicalStringSetSha256} from '../src/crawler/sourceFetchEvidence.ts';
import {buildJobDedupeKey} from '../src/crawler/normalizedJob.ts';
const started = "2026-10-02T12:00:00.000Z";
const denial=JSON.stringify({errorCode:'S22',httpStatus:403,message:'permission denied'});
const raw = { reqId: "202609-123373", jobId: "202609-123373", jobSeqNo: "ROCHGLOBAL202609123373EXTERNALZHCN",
  title: "Role", applyUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext/job/Shanghai/Role_202609-123373/apply",
  postedDate: "2026-09-30T00:00:00.000+0000", country: "中国大陆", location: "上海, 中国大陆", multi_location: ["上海, 中国大陆"],
  siteType: "external", visibilityType: "External", jobVisibility: ["external"], locale: "zh_cn" };
function detailArtifact(row = raw) {
  const url = rocheNativeDetailUrl(row);
  return { id: `roche-detail-${row.reqId}`, logicalKey: `roche-detail-${row.reqId}`, kind: "ATS_API_RESPONSE", requestedUrl: url, finalUrl: url, httpStatus: 200,
    contentType: "application/json", capturedAt: "2026-10-02T12:02:00.000Z", bodyRepresentation: "EXACT",
    extractorLocator: "roche-workday-jobposting-v1", body: "{}" };
}

test('Phenom-only Roche keeps mixed-location roles, Fuzhou pending, and quarantines broken rows with zero Workday calls',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-roche-china-social');
 const legacyDenied={...raw,reqId:'202610-125686',jobId:'202610-125686',jobSeqNo:'ROCHGLOBAL202610125686EXTERNALZHCN',applyUrl:raw.applyUrl.replaceAll(raw.reqId,'202610-125686')};
 const legacyArtifact={...detailArtifact(legacyDenied),httpStatus:403,body:denial};
 assert.equal(rocheDeniedDetail(legacyDenied,legacyArtifact,started),true);
 for(const patch of [{httpStatus:429},{finalUrl:'https://invalid.example'},{capturedAt:'2026-10-01T00:00:00Z'},{body:JSON.stringify({errorCode:'OTHER',httpStatus:403,message:'permission denied'})}])
  assert.equal(rocheDeniedDetail(legacyDenied,{...legacyArtifact,...patch},started),false);

 const altRow={...raw,reqId:'202609-124049',jobId:'202609-124049',jobSeqNo:'ROCHGLOBAL202609124049EXTERNALZHCN',
  title:'Value Stream SPOC - Infrastructure Business Analyst (APAC)',
  country:'马来西亚',location:'Petaling Jaya, 雪兰莪, 马来西亚',city:'Petaling Jaya',state:'雪兰莪',
  multi_location:['Petaling Jaya, 雪兰莪, 马来西亚','上海, 中国大陆'],
  applyUrl:'https://roche.wd3.myworkdayjobs.com/roche-ext/job/Petaling-Jaya/Value-Stream-SPOC---Infrastructure-Business-Analyst--APAC-_202609-124049/apply'};
 const fuzhouRow={...raw,reqId:'202610-125687',jobId:'202610-125687',jobSeqNo:'ROCHGLOBAL202610125687EXTERNALZHCN',
  title:'Fuzhou Specialist',location:'抚州, 福建, 中国大陆',multi_location:['抚州, 福建, 中国大陆'],
  applyUrl:raw.applyUrl.replaceAll(raw.reqId,'202610-125687')};
 const altFuzhouRow={...altRow,reqId:'202610-125688',jobId:'202610-125688',jobSeqNo:'ROCHGLOBAL202610125688EXTERNALZHCN',
  title:'Combined Petaling Jaya and Fuzhou Role',
  multi_location:['Petaling Jaya, 雪兰莪, 马来西亚','抚州, 福建, 中国大陆'],
  applyUrl:altRow.applyUrl.replaceAll(altRow.reqId,'202610-125688')};
 const badRow={...raw,reqId:'202610-126799',jobId:'202610-126799',jobSeqNo:'ROCHGLOBAL202610126799EXTERNALZHCN',
  title:'',applyUrl:raw.applyUrl.replaceAll(raw.reqId,'202610-126799')};
 const wuxiRow={...raw,reqId:'202610-126800',jobId:'202610-126800',jobSeqNo:'ROCHGLOBAL202610126800EXTERNALZHCN',
  title:'Wuxi Rep',location:'无锡, 江苏, 中国大陆',multi_location:['无锡, 江苏, 中国大陆'],
  applyUrl:raw.applyUrl.replaceAll(raw.reqId,'202610-126800')};
 assert.deepEqual(rochePhenomListDetail(fuzhouRow)?.cities,[CITY_PENDING]);
 assert.deepEqual(rochePhenomListDetail(altFuzhouRow)?.cities,[CITY_PENDING]);
 assert.deepEqual(rochePhenomListDetail(wuxiRow)?.cities,['无锡']);

 const runRows=async(list)=>{
  let posts=0,clock=0;const visited=[];
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(clock++===0?started:'2026-10-02T12:00:03.000Z'),http:async request=>{
   visited.push(request.url);
   assert.ok(!request.url.includes('/wday/cxs/'),`Zero Workday calls allowed: ${request.url}`);
   const body=request.method==='POST'?JSON.stringify({refineSearch:{totalHits:list.length,data:{jobs:posts++===0?[]:list,aggregations:posts===1?[{field:'country',value:{中国大陆:list.length}}]:[]}}})
    :'<script>var phApp={"widgetApiEndpoint":"https://careers.roche.com/widgets","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"ROCHGLOBAL","pageName":"search-results","pageId":"page11-ds"};</script>';
   return {status:200,body,finalUrl:request.url,capturedAt:request.url===plan.source.officialEntryUrl?'2026-10-02T12:00:01.000Z':'2026-10-02T12:00:02.000Z',contentType:request.method==='POST'?'application/json':'text/html'};
  }});
  return runSourceCrawl(plan,{fetch});
 };

 const rows=[raw,altRow,fuzhouRow,altFuzhouRow,wuxiRow,badRow];
 const result=await runRows(rows);
 assert.equal(result.truth.completenessVerified,true,JSON.stringify(result.observation));
 assert.equal(result.jobs.length,5);
 assert.equal(result.jobs.find(j=>j.sourceJobId===persistentOfficialJsonJobId(fuzhouRow.jobSeqNo))?.cities[0],CITY_PENDING);
 assert.equal(result.jobs.find(j=>j.sourceJobId===persistentOfficialJsonJobId(altFuzhouRow.jobSeqNo))?.cities[0],CITY_PENDING);
 assert.deepEqual(result.jobs.find(j=>j.sourceJobId===persistentOfficialJsonJobId(altRow.jobSeqNo))?.cities,['上海']);
 assert.deepEqual(result.jobs.find(j=>j.sourceJobId===persistentOfficialJsonJobId(wuxiRow.jobSeqNo))?.cities,['无锡']);
 assert.deepEqual(result.fetchEvidence.fetchCounts,{rawCount:6,parsedCount:6,validCount:5,parseDiscardCount:0,validationDiscardCount:1});
 assert.equal(result.fetchEvidence.jobQuarantines.length,1);

 const clean=await runRows([raw,altRow,fuzhouRow,altFuzhouRow,wuxiRow]);
 assert.equal(clean.truth.completenessVerified,true,JSON.stringify(clean.observation));
 assert.equal(clean.jobs.length,5);
 assert.equal(replayStrictSourceQualityEvidence({plan,evidence:clean.fetchEvidence,paginationEvaluation:clean.paginationEvaluation,reconciliation:clean.reconciliation,jobs:clean.jobs,capturedAt:clean.jobs[0].evidence.capturedAt}),true);
 assert.equal(replayWebStrictSourceQualityEvidence({plan,evidence:clean.fetchEvidence,paginationEvaluation:clean.paginationEvaluation,reconciliation:clean.reconciliation,jobs:clean.jobs,capturedAt:clean.jobs[0].evidence.capturedAt}),true);

 const oldAt='2026-10-01T12:00:00.000Z',at='2026-10-02T12:00:03.000Z';
 const identity={releaseCandidateId:'roche-isolation-test',commitSha:'a'.repeat(64),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED',ownerId:'test',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:canonicalStringSetSha256([plan.source.id]),expectedPlannedSourceCount:1};
 const batchId='roche-isolation-batch',pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(started)).sources[0];
 const workspaceRoot=await mkdtemp(join(tmpdir(),'roche-isolation-'));
 try{
  const binding={workspaceRoot,releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:plan.source.id,sourceResultId:pending.id,evidenceSubdirectory:'evidence'};
  const archived=await archiveSourceEvidence({...binding,captureTool:result.fetchEvidence.captureTool,artifacts:result.fetchEvidence.artifacts});
  const artifacts=await verifyArchivedSourceEvidence({...binding,artifacts:archived.artifacts});
  for(const [state,count] of [['ACTIVE',0],['ACTIVE',1],['OFFLINE',3]]){
   const heldPrior={...structuredClone(result.jobs[0]),officialTitle:'Old exact title',officialUrl:badRow.applyUrl,sourceJobId:persistentOfficialJsonJobId(badRow.jobSeqNo),evidence:{...result.jobs[0].evidence,capturedAt:oldAt}};
   const previousJobs=[{dedupeKey:buildJobDedupeKey(heldPrior),record:heldPrior,lifecycleStatus:state,missingSuccessfulCrawlCount:count,firstSeenAt:oldAt,lastSeenAt:oldAt}];
   const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,baselineCompletedBeforeCrawl:true,artifacts,completedAt:new Date(at),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',previousJobs});
   assert.equal(commit.sourceResult.completenessState,'VERIFIED');await verifyAtomicRuntimeCommitForPersistence(commit);
   const held=commit.commands.find(c=>c.type==='UPSERT_JOB'&&c.dedupeKey===previousJobs[0].dedupeKey);
   assert.deepEqual(held.record,heldPrior);assert.equal(held.lastSeenAt,oldAt);assert.equal(held.lifecycleStatus,state);assert.equal(held.missingSuccessfulCrawlCount,state==='ACTIVE'?1:count);
  }
 }finally{await rm(workspaceRoot,{recursive:true,force:true});}
});

test('Roche Phenom-only rejects foreign-only rows and preserves rate-limit transport failure',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-roche-china-social');
 const foreignOnly={...raw,reqId:'202609-124050',jobId:'202609-124050',jobSeqNo:'ROCHGLOBAL202609124050EXTERNALZHCN',
  country:'马来西亚',city:'Petaling Jaya',location:'Petaling Jaya, 雪兰莪, 马来西亚',multi_location:['Petaling Jaya, 雪兰莪, 马来西亚'],
  applyUrl:'https://roche.wd3.myworkdayjobs.com/roche-ext/job/Petaling-Jaya/Role_202609-124050/apply'};
 const runMock=async(mode)=>{
  let posts=0;const visited=[];
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(started),http:async request=>{
   visited.push(request.url);
   if(mode==='429'&&request.method==='POST')return {status:429,body:'Rate Limited',finalUrl:request.url,capturedAt:started,contentType:'text/html',retryAfter:{value:'120',delayMs:120000}};
   const list=mode==='foreign'?[raw,foreignOnly]:[raw];
   const first=request.method==='POST'&&posts++===0;
   const body=request.method==='POST'?JSON.stringify({refineSearch:{totalHits:list.length,data:{jobs:first?[]:list,aggregations:first?[{field:'country',value:{中国大陆:list.length}}]:[]}}})
    :'<script>var phApp={"widgetApiEndpoint":"https://careers.roche.com/widgets","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"ROCHGLOBAL","pageName":"search-results","pageId":"page11-ds"};</script>';
   return {status:200,body,finalUrl:request.url,capturedAt:started,contentType:request.method==='POST'?'application/json':'text/html'};
  }});
  return {result:await runSourceCrawl(plan,{fetch}),visited};
 };
 const good=await runMock('good');
 assert.equal(good.result.truth.completenessVerified,true);
 assert.equal(good.visited.length,4);
 const foreign=await runMock('foreign');
 assert.equal(foreign.result.truth.completenessVerified,true);
 assert.equal(foreign.result.jobs.length,1);
 assert.equal(foreign.result.jobs.some(j=>j.sourceJobId===persistentOfficialJsonJobId(foreignOnly.jobSeqNo)),false);
 assert.equal(foreign.result.fetchEvidence.jobQuarantines.length,1);
 const limited=await runMock('429');
 assert.equal(limited.result.truth.transportSuccess,false);
 assert.equal(limited.result.transportFailure?.code,'OFFICIAL_HTTP_429');
});
