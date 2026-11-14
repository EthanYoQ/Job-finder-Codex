import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {createHttpHtmlSourceFetch} from '../src/crawler/httpHtmlSourceFetch.ts';
import {replayAstraZenecaList,replayAstraZenecaDetails} from '../src/crawler/astraZenecaDetailAcquisition.ts';
import {reviewAstraZenecaDetailArtifact,astraZenecaArtifactKey} from '../src/crawler/astraZenecaDetails.ts';
import {ASTRAZENECA_DETAIL_CONFIG as config} from '../src/crawler/astraZenecaDetailContract.ts';
import {quarantineCompleteList,JOB_QUARANTINE_PAGINATION} from '../src/crawler/jobQuarantine.ts';
import {evaluatePaginationEvidence} from '../src/crawler/paginationEvidence.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {archiveSourceEvidence,verifyArchivedSourceEvidence} from '../src/crawler/artifactArchive.ts';
import {buildAtomicRuntimeCommit,buildPendingRuntimeBatch,verifyAtomicRuntimeCommitForPersistence} from '../src/crawler/runtimeAtomicEvidence.ts';
import {canonicalStringSetSha256,sha256Bytes} from '../src/crawler/sourceFetchEvidence.ts';
import {buildJobDedupeKey} from '../src/crawler/normalizedJob.ts';

for(const mode of ['detail','list-title'])test(`complete Astra list isolates ${mode} while other jobs update`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astrazeneca-social');
 const at='2026-11-06T00:00:00.000Z',oldAt='2026-11-05T00:00:00.000Z';
 const fetched=await createHttpHtmlSourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,finalUrl:url,contentType:'text/html',capturedAt:at,
  body:`<div id="search-results" data-total-pages="1" data-total-job-results="2" data-total-results="2" data-current-page="1" data-records-per-page="15"></div><input id="cn" data-facet-type="2" data-id="1814991" data-display="中国" data-count="2"><label for="cn"><b class="filter">中国</b><b>2</b></label><ul id="search-results-list">${[1000,1001].map(id=>`<li data-country="China"><a class="search-results-link" data-job-id="${id}" href="/job/shanghai/role/12977/${id}"><h2>${mode==='list-title'&&id===1001?'':`Role ${id}`}</h2></a><span class="job-location">Shanghai Shanghai</span></li>`).join('')}</ul>`})})(plan);
 assert.equal(fetched.ok,true,JSON.stringify(fetched));
 const list=replayAstraZenecaList(plan,fetched.fetchEvidence,at,false),job=list[0],req='TP1000';
 const posting={'@context':'https://schema.org','@type':'JobPosting',identifier:req,title:job.officialTitle,url:job.officialUrl,datePosted:'2026-11-05',description:'Research responsibilities.',hiringOrganization:{'@type':'Organization',name:'AstraZeneca'},jobLocation:[{'@type':'Place',address:{'@type':'PostalAddress',addressLocality:'Shanghai',addressRegion:'Shanghai',addressCountry:'China'}}]};
 const body=`<link rel="canonical" href="${job.officialUrl}"><meta name="job-ats-req-id" content="${req}"><script type="application/ld+json">${JSON.stringify(posting)}</script><section class="job-description-title" data-job-id="1000" data-org-id="12977"><h1>${job.officialTitle}</h1></section><section class="job-description" data-job-id="1000" data-org-id="12977"><div class="job-id"><b>职位 ID</b> ${req}</div><div class="job-locations">Shanghai, Shanghai, China</div><div class="job-date">发布日期 11/05/2026</div><div class="ats-description">Research responsibilities.</div><a class="job-apply" data-job-id="1000" href="https://careersite.tupu360.com/astrazeneca/position/detail?positionId=test1000">Apply</a></section>`;
 const key=astraZenecaArtifactKey('1000'),artifact={id:key,logicalKey:key,kind:'ATS_PAGE',requestedUrl:job.officialUrl,finalUrl:job.officialUrl,httpStatus:200,contentType:'text/html',capturedAt:at,body:Buffer.from(body),bodyRepresentation:'EXACT',extractorLocator:config.extractor};
 const reviewed=reviewAstraZenecaDetailArtifact(artifact,job);assert.equal(reviewed.ok,true,reviewed.code);
 const complete={...fetched.fetchEvidence,artifacts:[...fetched.fetchEvidence.artifacts,artifact],astraZenecaDetails:{schemaVersion:'astrazeneca-owned-details-v1',policy:config.policy,sourceConfigSha256:sourcePlanConfigSha256(plan),listArtifactLogicalKeys:fetched.fetchEvidence.artifacts.map(a=>a.logicalKey),entries:[{sourceJobId:job.sourceJobId,officialUrl:job.officialUrl,artifactLogicalKey:key,outcome:{ok:true,evidence:reviewed.evidence}},...(mode==='detail'?[{sourceJobId:list[1].sourceJobId,officialUrl:list[1].officialUrl,outcome:{ok:false,code:'DETAIL_TRANSPORT_FAILED'}}]:[])]}};
 const replay=replayAstraZenecaDetails(plan,complete,at,false);
 const fetchEvidence=quarantineCompleteList(complete,replay.quarantines);
 const paginationEvaluation=evaluatePaginationEvidence({evidence:fetchEvidence,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,...JOB_QUARANTINE_PAGINATION});
 const result=await runSourceCrawl(plan,{fetch:async()=>({...fetched,fetchEvidence,paginationEvaluation}),isBaseline:false});
 assert.equal(result.truth.completenessVerified,true,JSON.stringify(result.truth));assert.equal(result.jobs.length,1);
 const corrupt=structuredClone(fetchEvidence);corrupt.jobQuarantines[0].sourceJobId='1000';
 assert.throws(()=>replayAstraZenecaDetails(plan,corrupt,at,false),/JOB_QUARANTINE_INVALID/);
 const priorRecords=[list[0],{...list[0],sourceJobId:'1001',officialUrl:list[0].officialUrl.replace(/1000$/,'1001')}];
 const previous=priorRecords.map(record=>({dedupeKey:buildJobDedupeKey(record),record:{...record,officialTitle:'Previous title'},lifecycleStatus:'ACTIVE',missingSuccessfulCrawlCount:0,firstSeenAt:oldAt,lastSeenAt:oldAt}));
 const identity={releaseCandidateId:'astra-isolation-test',commitSha:'a'.repeat(64),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED',ownerId:'test',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:canonicalStringSetSha256([plan.source.id]),expectedPlannedSourceCount:1};
 const batchId='astra-isolation-batch',pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(oldAt)).sources[0],workspaceRoot=await mkdtemp(join(tmpdir(),'astra-isolation-'));
 try{
  const binding={workspaceRoot,releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:plan.source.id,sourceResultId:pending.id,evidenceSubdirectory:'evidence'};
  const archived=await archiveSourceEvidence({...binding,captureTool:fetchEvidence.captureTool,artifacts:fetchEvidence.artifacts});
  const artifacts=await verifyArchivedSourceEvidence({...binding,artifacts:archived.artifacts});
  const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,baselineCompletedBeforeCrawl:true,artifacts,completedAt:new Date(at),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',previousJobs:previous});
  assert.equal(commit.sourceResult.completenessState,'VERIFIED');
  await verifyAtomicRuntimeCommitForPersistence(commit);
  const held=commit.commands.find(c=>c.type==='UPSERT_JOB'&&c.dedupeKey===previous[1].dedupeKey);
  assert.deepEqual(held.record,previous[1].record);assert.equal(held.lastSeenAt,oldAt);assert.equal(held.lifecycleStatus,'ACTIVE');
  const good=commit.commands.find(c=>c.type==='UPSERT_JOB'&&c.dedupeKey===previous[0].dedupeKey);
  assert.equal(good.record.officialTitle,'Role 1000');assert.equal(good.lastSeenAt,at);
 }finally{await rm(workspaceRoot,{recursive:true,force:true});}
});

