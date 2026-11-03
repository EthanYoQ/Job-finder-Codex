import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {rocheDeniedDetail,rocheNativeDetailUrl,rocheQuarantinedSourceJobIds} from '../src/crawler/rocheChinaQuality.ts';
import {persistentOfficialJsonJobId} from '../src/crawler/officialJsonEvidence.ts';
import {archiveSourceEvidence,verifyArchivedSourceEvidence} from '../src/crawler/artifactArchive.ts';
import {buildAtomicRuntimeCommit,buildPendingRuntimeBatch,verifyAtomicRuntimeCommitForPersistence} from '../src/crawler/runtimeAtomicEvidence.ts';
import {canonicalStringSetSha256} from '../src/crawler/sourceFetchEvidence.ts';
import {buildJobDedupeKey} from '../src/crawler/normalizedJob.ts';
const started = "2026-10-02T12:00:00.000Z";
const raw = { reqId: "202609-123373", jobId: "202609-123373", jobSeqNo: "ROCHGLOBAL202609123373EXTERNALZHCN",
  title: "Role", applyUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext/job/Shanghai/Role_202609-123373/apply",
  postedDate: "2026-09-30T00:00:00.000+0000", country: "中国大陆", location: "上海, 中国大陆", multi_location: ["上海, 中国大陆"],
  siteType: "external", visibilityType: "External", jobVisibility: ["external"], locale: "zh_cn" };
const info = { title: "Role", jobReqId: raw.reqId, jobPostingId: "Role_202609-123373", jobPostingSiteId: "roche-ext",
  externalUrl: raw.applyUrl.replace(/\/apply$/, ""), location: "Shanghai", country: { descriptor: "China" },
  posted: true, canApply: true, jobDescription: "<p>Responsible for laboratory quality and process compliance.</p>", startDate: "2026-09-30" };
function artifact(row = raw, patch = {}) {
  const url = rocheNativeDetailUrl(row);
  return { id: `roche-detail-${row.reqId}`, logicalKey: `roche-detail-${row.reqId}`, kind: "ATS_API_RESPONSE", requestedUrl: url, finalUrl: url, httpStatus: 200,
    contentType: "application/json", capturedAt: "2026-10-02T12:02:00.000Z", bodyRepresentation: "EXACT",
    extractorLocator: "roche-workday-jobposting-v1", body: JSON.stringify({ jobPostingInfo: {...info, ...patch} }) };
}

test('bound Roche denials preserve each previous row while other details commit',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-roche-china-social');
 const denied=['202610-125686','202610-126799'].map(id=>({...raw,reqId:id,jobId:id,jobSeqNo:`ROCHGLOBAL${id.replace('-','')}EXTERNALZHCN`,applyUrl:raw.applyUrl.replaceAll(raw.reqId,id)}));
 const denial=JSON.stringify({errorCode:'S22',httpStatus:403,message:'permission denied'});
 for(const row of denied){
  const a={...artifact(row),httpStatus:403,body:denial};assert.equal(rocheDeniedDetail(row,a,started),true);
  for(const patch of [{httpStatus:429},{finalUrl:'https://invalid.example'},{capturedAt:'2026-10-01T00:00:00Z'},{body:JSON.stringify({errorCode:'OTHER',httpStatus:403,message:'permission denied'})}])
   assert.equal(rocheDeniedDetail(row,{...a,...patch},started),false);
 }
 let posts=0,clock=0;const visited=[];
 const fetch=createOfficialJsonSourceFetch({now:()=>new Date(clock++===0?started:'2026-10-02T12:00:03.000Z'),http:async request=>{
  visited.push(request.url);const isDenied=denied.some(row=>request.url===rocheNativeDetailUrl(row));
  const body=request.method==='POST'?JSON.stringify({refineSearch:{totalHits:3,data:{jobs:posts++===0?[]:[...denied,raw],aggregations:posts===1?[{field:'country',value:{中国大陆:3}}]:[]}}}):request.url.includes('/wday/cxs/')?(isDenied?denial:artifact().body):'<script>var phApp={"widgetApiEndpoint":"https://careers.roche.com/widgets","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"ROCHGLOBAL","pageName":"search-results","pageId":"page11-ds"};</script>';
  return {status:isDenied?403:200,body,finalUrl:request.url,capturedAt:request.url===plan.source.officialEntryUrl?'2026-10-02T12:00:01.000Z':'2026-10-02T12:00:02.000Z',contentType:request.method==='POST'||request.url.includes('/wday/cxs/')?'application/json':'text/html'};
 }});
 const result=await runSourceCrawl(plan,{fetch});assert.equal(result.truth.completenessVerified,true);assert.equal(result.jobs.length,1);assert(visited.includes(rocheNativeDetailUrl(raw)));
 assert.deepEqual(result.fetchEvidence.fetchCounts,{rawCount:3,parsedCount:3,validCount:1,parseDiscardCount:0,validationDiscardCount:2});
 assert.deepEqual([...rocheQuarantinedSourceJobIds(result.fetchEvidence)],denied.map(row=>persistentOfficialJsonJobId(row.jobSeqNo)));
 const altered=structuredClone(result.fetchEvidence);altered.fetchLosses[0].rawLocator='changed';assert.throws(()=>rocheQuarantinedSourceJobIds(altered),/UNBOUND/);
 const oldAt='2026-10-01T12:00:00.000Z',at='2026-10-02T12:00:03.000Z';
 const identity={releaseCandidateId:'roche-isolation-test',commitSha:'a'.repeat(64),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED',ownerId:'test',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:canonicalStringSetSha256([plan.source.id]),expectedPlannedSourceCount:1};
 const batchId='roche-isolation-batch',pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(started)).sources[0];
 const workspaceRoot=await mkdtemp(join(tmpdir(),'roche-isolation-'));
 try{
  const binding={workspaceRoot,releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:plan.source.id,sourceResultId:pending.id,evidenceSubdirectory:'evidence'};
  const archived=await archiveSourceEvidence({...binding,captureTool:result.fetchEvidence.captureTool,artifacts:result.fetchEvidence.artifacts});
  const artifacts=await verifyArchivedSourceEvidence({...binding,artifacts:archived.artifacts});
  for(const [state,count] of [['ACTIVE',0],['ACTIVE',1],['OFFLINE',3]]){
   const previousJobs=denied.map(row=>{const record={...structuredClone(result.jobs[0]),officialTitle:'Old exact title',officialUrl:row.applyUrl,sourceJobId:persistentOfficialJsonJobId(row.jobSeqNo),evidence:{...result.jobs[0].evidence,capturedAt:oldAt}};return {dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:state,missingSuccessfulCrawlCount:count,firstSeenAt:oldAt,lastSeenAt:oldAt};});
   const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,baselineCompletedBeforeCrawl:true,artifacts,completedAt:new Date(at),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',previousJobs});
   assert.equal(commit.sourceResult.completenessState,'VERIFIED');await verifyAtomicRuntimeCommitForPersistence(commit);
   for(const old of previousJobs){const held=commit.commands.find(c=>c.type==='UPSERT_JOB'&&c.dedupeKey===old.dedupeKey);assert.deepEqual(held.record,old.record);assert.equal(held.lastSeenAt,oldAt);assert.equal(held.lifecycleStatus,state);assert.equal(held.missingSuccessfulCrawlCount,state==='ACTIVE'?1:count);}
  }
 }finally{await rm(workspaceRoot,{recursive:true,force:true});}
});
