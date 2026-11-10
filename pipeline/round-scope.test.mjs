import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {loadDirectPlans,selectDirectRoutes,runDirectRound} from '../runner-candidate/scripts/direct-round.ts';
import {searchPortableSnapshot} from '../web-candidate/src/server/portablePublicationApi.ts';
import {readRoundCoverage} from './round-coverage.ts';
import {enrichSanofiPublicationClassification} from './sanofi-publication-classification.ts';

const routes=await loadDirectPlans(),sourceIds=routes.map(row=>row.sourceId);
const retryIds=['source-novo-nordisk-china-social','source-pfizer-china-social','source-sanofi-china-social'];
const results=retryIds.map(sourceId=>({sourceId,status:'SUCCESS',failedSourceCount:0,blockedSourceCount:0}));
const slot=String(Date.parse('2026-10-31T04:01:00Z'));

test('one-off selection preserves the full default and excludes unrequested sources',()=>{
  assert.equal(selectDirectRoutes(routes).length,36);
  assert.deepEqual(new Set(selectDirectRoutes(routes,retryIds).map(row=>row.sourceId)),new Set(retryIds));
  assert.equal(selectDirectRoutes(routes,retryIds).some(row=>row.sourceId==='source-johnson-innovative-medicine-social'),false);
  assert.equal(routes.length,36);
});

test('empty, duplicate and unknown selections fail before migration state or DB access',async()=>{
  for(const onlySourceIds of [[],[''],[retryIds[0],retryIds[0]],['source-unknown'],[retryIds[0],'']]) {
    assert.throws(()=>selectDirectRoutes(routes,onlySourceIds),/INVALID_SOURCE_SELECTION/);
    await assert.rejects(runDirectRound({onlySourceIds}),/INVALID_SOURCE_SELECTION/);
  }
});

function database(acceptedIds,held=0,unresolved=false) {
  return {crawlBatchSourceResult:{findMany:async query=>{
    assert.deepEqual(query.where.sourceId.in,sourceIds);
    assert.equal(query.where.releaseCandidateId,'instabox-test');
    assert.equal(query.where.atomicCommitState,'COMMITTED');
    assert.equal(query.where.completenessState,'VERIFIED');
    assert.equal(query.where.finishedAt.gte.toISOString(),'2026-10-31T04:01:00.000Z');
    assert.equal(query.where.finishedAt.lt.toISOString(),'2026-10-31T16:01:00.000Z');
    assert.equal(query.select._count.select.evidenceArtifacts.where.extractorLocator,'novartis-default-discovery-exhausted');
    return acceptedIds.map((sourceId,index)=>({sourceId,batchId:`batch-${sourceId}`,_count:{lossLedgerEntries:index===0?held:0,evidenceArtifacts:Number(unresolved&&sourceId==='source-novartis-social')}}));
  }}};
}

test('three successful retries never reduce the 36-source completion denominator',async()=>{
  const partial=await readRoundCoverage(database(retryIds),'instabox-test',slot,sourceIds,results);
  assert.equal(partial.complete,false);assert.equal(partial.capturedSources.length,3);
  const earlier=sourceIds.filter(id=>id!=='source-johnson-innovative-medicine-social');
  const accumulated=await readRoundCoverage(database(earlier),'instabox-test',slot,sourceIds,results);
  assert.equal(accumulated.complete,false);assert.equal(accumulated.capturedSources.length,35);
  const full=await readRoundCoverage(database(sourceIds),'instabox-test',slot,sourceIds,results);
  assert.equal(full.complete,true);assert.equal(full.capturedSources.length,36);
  assert.equal(full.quarantinedJobCount,0);
  const unresolved=await readRoundCoverage(database(sourceIds,0,true),'instabox-test',slot,sourceIds,results);
  assert.equal(unresolved.complete,true);
  assert.equal(unresolved.unresolvedCoverage,true);
  assert.equal(unresolved.quarantinedJobCount,0);
  const isolated=await readRoundCoverage(database(sourceIds,2),'instabox-test',slot,sourceIds,results);
  assert.equal(isolated.complete,true);assert.equal(isolated.quarantinedJobCount,2);
  assert.equal((await readRoundCoverage(database(sourceIds),'instabox-test',slot,sourceIds,[{status:'FAILED'}])).complete,false);
  assert.equal((await readRoundCoverage(database(sourceIds),'instabox-test',null,sourceIds,results)).complete,false);
});

test('Sanofi enrichment uses verified own-REQ metadata without changing public membership',async t=>{
  const workspaceRoot=await realpath(await mkdtemp(join(tmpdir(),'jobfinder-sanofi-publication-')));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  const tuple={releaseCandidateId:'instabox-test',batchId:'batch-test',sourceId:'source-sanofi-china-social',sourceResultId:'result-test'};
  const key='sanofi-cn-independent-original-v1', retrievalPath='CUA_CHINESE_DOM_LIST_PLUS_NEW_NATIVE_HTTP';
  const row=(req,id,slug,categoryId,label)=>{
    const url=`https://jobs.sanofi.cn/工作/${slug}/3036/${id}`;
    const body=`<head><meta name="job-category-ids" content="${categoryId}"><meta name="job-ats-req-id" content="${req}"><meta name="gtm_tbcn_jobcategory" content="${label}" data-gtm-prop="tbcn-jobcategory"></head>`;
    return {sourceJobId:`sanofi-req:${req}`,scopeMarker:'PUBLISHING',scopeDecision:'INCLUDED_MAINLAND',rawPayload:{captureMethod:retrievalPath,
      domRow:{id,url},detailResponse:{method:'GET',status:200,url,finalUrl:url,body}}};
  };
  // Identity and head-meta excerpts from the archived a2f5b911 independent capture.
  const quality=row('R2877311','46635895744','m-and-s-analytical-expertise-and-transfer-manager-beijing','32102272','Quality');
  const training=row('R2875592','46350248512','dbu-commercial-intern','32102016','Human Resources');
  const duplicate=row('R9999901','9999901','duplicate','32102208','Sales');
  const conflict=row('R9999902','9999902','conflict','32102272','Sales');
  const otherId=row('R9999903','9999903','different-req','32102208','Sales');
  otherId.sourceJobId='sanofi-req:R9999904';
  const body=JSON.stringify({schemaVersion:'official-json-browser-network-traversal-v1',sourceId:tuple.sourceId,retrievalPath,
    pages:[{rawRows:[quality,training,duplicate,duplicate,conflict,otherId]}]});
  const path=`outputs/p0-rc/instabox-test/runtime-evidence/artifacts/batch-test/${tuple.sourceId}/result-test/archive-test--${key}.bin`;
  await mkdir(dirname(join(workspaceRoot,path)),{recursive:true});
  await writeFile(join(workspaceRoot,path),body);
  const rowMetadata={...tuple,id:'archive-test',kind:'COMMAND_OUTPUT',path,extractorLocator:key,
    capturedAt:new Date('2026-11-06T20:07:10.678Z'),captureToolName:'playwright-core-local-chromium',captureToolVersion:'1',
    byteCount:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')};
  const dbFor=artifacts=>({crawlBatchSourceResult:{findFirst:async({where})=>{
    assert.deepEqual(where,{id:tuple.sourceResultId,sourceId:tuple.sourceId,completenessState:'VERIFIED',atomicCommitState:'COMMITTED'});
    return {...tuple,id:tuple.sourceResultId,evidenceArtifacts:artifacts};
  }}});
  const job=(id,req,overrides={})=>({id,sourceId:tuple.sourceId,sourceResultId:tuple.sourceResultId,category:'其他',
    officialTitle:'M&S-Analytical Expertise and Transfer Manager-Beijing',officialUrl:`https://www.ajinga.com/ats/job-detail-new/13537/${req}/c/`,
    city:'北京',cities:['北京'],locationRaw:'北京市',officialPublishedAt:null,inGrace:false,...overrides});
  const jobs=[job('quality','R2877311'),job('manual','R2877311',{categoryManuallyCorrected:true}),job('grace','R2877311',{inGrace:true}),
    job('title-classified','R2877311',{officialTitle:'Sales Manager'}),job('old','R2877311',{sourceResultId:'old-result'}),
    job('unsupported','R2875592',{officialTitle:'DBU-Commercial Intern-天津'}),job('duplicate','R9999901'),job('conflict','R9999902'),job('other-id','R9999903')];
  const snapshot={sources:[{companyId:'company-sanofi-china',sourceId:tuple.sourceId,state:'PUBLISHING',selectedSourceResultId:tuple.sourceResultId,jobs}],
    companies:[{id:'company-sanofi-china',companyName:'赛诺菲中国',pinyin:'sainuofei',required:true,publishingSourceIds:[tuple.sourceId],jobs:structuredClone(jobs)}],
    lastUpdatedAt:null,coverage:{requiredCompanyCount:1,excludedCompanyCount:0},totalJobs:jobs.length};
  const baseline=structuredClone(snapshot);
  assert.equal(await enrichSanofiPublicationClassification(dbFor([{...rowMetadata,sha256:'0'.repeat(64)}]),workspaceRoot,snapshot),0);
  assert.deepEqual(snapshot,baseline);
  assert.equal(await enrichSanofiPublicationClassification(dbFor([rowMetadata]),workspaceRoot,snapshot),1);
  for(const group of [...snapshot.sources,...snapshot.companies]) {
    assert.deepEqual(group.jobs,[{...jobs[0],category:'质量'},...jobs.slice(1)]);
  }
  assert.equal(snapshot.sources[0].jobs[0],snapshot.companies[0].jobs[0]);
  assert.equal(snapshot.totalJobs,jobs.length);
  const filtered=searchPortableSnapshot({city:'全部城市',categories:['质量']},snapshot);
  assert.deepEqual(filtered.companies.flatMap(company=>company.jobs.map(job=>job.id)),['quality']);
});
