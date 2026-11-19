import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,realpath,rm,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {loadDirectPlans,selectDirectRoutes,runDirectRound} from '../runner-candidate/scripts/direct-round.ts';
import {searchPortableSnapshot} from '../web-candidate/src/server/portablePublicationApi.ts';
import {readRoundCoverage} from './round-coverage.ts';
import {enrichSanofiPublicationClassification} from './sanofi-publication-classification.ts';
import {archiveInactiveSnapshots,selectRoundSnapshotHandle} from './snapshot-handle.ts';
import {SOURCE_QUALITY_POLICY_ID} from '../web-candidate/src/crawler/sourceQualityAdmission.ts';
import {PORTABLE_COVERAGE_POLICY_ID} from '../web-candidate/src/release/portableCoveragePolicy.ts';

const routes=await loadDirectPlans(),sourceIds=routes.map(row=>row.sourceId);
const retryIds=['source-novo-nordisk-china-social','source-pfizer-china-social','source-sanofi-china-social'];
const results=retryIds.map(sourceId=>({sourceId,status:'SUCCESS',failedSourceCount:0,blockedSourceCount:0}));
const slot=String(Date.parse('2026-10-31T16:01:00Z'));

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
    assert.equal(query.where.startedAt.gte.toISOString(),'2026-10-31T16:01:00.000Z');
    assert.equal(query.where.finishedAt.gte.toISOString(),'2026-10-31T16:01:00.000Z');
    assert.equal(query.where.finishedAt.lt.toISOString(),'2026-11-01T16:01:00.000Z');
    assert.equal(query.select._count.select.evidenceArtifacts.where.OR[0].extractorLocator,'novartis-default-discovery-exhausted');
    return acceptedIds.map((sourceId,index)=>({sourceId,batchId:`batch-${sourceId}`,atomicCommitState:'COMMITTED',completenessState:'VERIFIED',lossLedgerEntries:[],_count:{lossLedgerEntries:index===0?held:0,evidenceArtifacts:Number(unresolved&&sourceId==='source-novartis-social')}}));
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
  assert.equal(unresolved.capturedSources.length,36);
  const isolated=await readRoundCoverage(database(sourceIds,2),'instabox-test',slot,sourceIds,results);
  assert.equal(isolated.complete,true);assert.equal(isolated.quarantinedJobCount,2);
  assert.equal(isolated.capturedSources.length,36);
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
  const medical=row('R2877312','46635895745','medical-science-liaison','32115904','Medical');
  const marketing=row('R2877313','46635895746','product-manager','32123712','Marketing');
  const bd=row('R2877314','46635895747','bd-lead','32158656','Strategy &amp; Business Development');
  const training=row('R2875592','46350248512','dbu-commercial-intern','32102016','Human Resources');
  const duplicate=row('R9999901','9999901','duplicate','32102208','Sales');
  const conflict=row('R9999902','9999902','conflict','32102272','Sales');
  const otherId=row('R9999903','9999903','different-req','32102208','Sales');
  otherId.sourceJobId='sanofi-req:R9999904';
  const body=JSON.stringify({schemaVersion:'official-json-browser-network-traversal-v1',sourceId:tuple.sourceId,retrievalPath,
    pages:[{rawRows:[quality,medical,marketing,bd,training,duplicate,duplicate,conflict,otherId]}]});
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
  const jobs=[job('quality','R2877311'),job('medical','R2877312',{officialTitle:'Associate Partner'}),
    job('marketing','R2877313',{officialTitle:'Product Lead'}),job('bd','R2877314',{officialTitle:'Partnership Lead'}),
    job('manual','R2877311',{categoryManuallyCorrected:true}),job('grace','R2877311',{inGrace:true}),
    job('title-classified','R2877311',{officialTitle:'Sales Manager'}),job('old','R2877311',{sourceResultId:'old-result'}),
    job('unsupported','R2875592',{officialTitle:'DBU-Commercial Intern-天津'}),job('duplicate','R9999901'),job('conflict','R9999902'),job('other-id','R9999903')];
  const snapshot={sources:[{companyId:'company-sanofi-china',sourceId:tuple.sourceId,state:'PUBLISHING',selectedSourceResultId:tuple.sourceResultId,jobs}],
    companies:[{id:'company-sanofi-china',companyName:'赛诺菲中国',pinyin:'sainuofei',required:true,publishingSourceIds:[tuple.sourceId],jobs:structuredClone(jobs)}],
    lastUpdatedAt:null,coverage:{requiredCompanyCount:1,excludedCompanyCount:0},totalJobs:jobs.length};
  const baseline=structuredClone(snapshot);
  assert.equal(await enrichSanofiPublicationClassification(dbFor([{...rowMetadata,sha256:'0'.repeat(64)}]),workspaceRoot,snapshot),0);
  assert.deepEqual(snapshot,baseline);
  assert.equal(await enrichSanofiPublicationClassification(dbFor([rowMetadata]),workspaceRoot,snapshot),4);
  const expectedJobs=[
    {...jobs[0],category:'质量'},{...jobs[1],category:'医学事务'},
    {...jobs[2],category:'市场'},{...jobs[3],category:'商务'},
    ...jobs.slice(4)
  ];
  for(const group of [...snapshot.sources,...snapshot.companies]) {
    assert.deepEqual(group.jobs,expectedJobs);
  }
  assert.equal(snapshot.sources[0].jobs[0],snapshot.companies[0].jobs[0]);
  assert.equal(snapshot.totalJobs,jobs.length);
  const filtered=searchPortableSnapshot({city:'全部城市',categories:['质量']},snapshot);
  assert.deepEqual(filtered.companies.flatMap(company=>company.jobs.map(job=>job.id)),['quality']);
});

async function snapshotFixture(t) {
  const cache=fileURLToPath(new URL('../.runtime/.cache/',import.meta.url));
  await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'snapshot-reuse-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const route=routes.find(row=>row.sourceId==='source-abbvie-china-social');
  const observedAt=new Date(Number(slot)+60_000).toISOString();
  const job={id:'synthetic-job',title:'Synthetic role',officialTitle:'Synthetic role',officialPublishedAt:null,
    city:'上海',cities:['上海'],locationRaw:'上海',category:'其他',isNew:false,officialUrl:'https://example.invalid/job',
    companyId:route.companyId,sourceId:route.sourceId,sourceResultId:'synthetic-result',lastSeenAt:observedAt,inGrace:false};
  const previous={schemaVersion:'portable-public-snapshot-v1',policyId:SOURCE_QUALITY_POLICY_ID,
    coveragePolicyId:PORTABLE_COVERAGE_POLICY_ID,generatedAt:observedAt,lastUpdatedAt:observedAt,totalJobs:1,
    companies:[{id:route.companyId,companyName:'Synthetic company',pinyin:'synthetic',category:'FOREIGN_PHARMA',
      sourceIds:[route.sourceId],publishingSourceIds:[route.sourceId],required:true,exclusionReason:null,
      health:'HEALTHY',coverage:'COMPLETE',jobs:[job]}],
    sources:[{companyId:route.companyId,sourceId:route.sourceId,currentConfigSha256:route.sourceConfigSha256,
      policyId:null,state:'PUBLISHING',health:'HEALTHY',freshness:'FRESH',reasons:[],visibilityFloor:observedAt,
      selectedSourceResultId:'synthetic-result',lastAttemptAt:observedAt,lastAcceptedAt:observedAt,lastSuccessAt:observedAt,
      lastAcceptedJobCount:1,visibleJobCount:1,staleJobCount:0,jobs:[structuredClone(job)]}],
    coverage:{companyCount:1,requiredCompanyCount:1,excludedCompanyCount:0,requiredSourceCount:1,
      excludedSourceCount:0,expectedSourceCount:1,sourceCount:1,unplannedSourceCount:0,publishingSourceCount:1,
      unsupportedSourceCount:0,heldSourceCount:0}};
  const bytes=JSON.stringify(previous,null,2),sha256=createHash('sha256').update(bytes).digest('hex');
  const snapshotFile=join(directory,`public-${sha256}.json`);
  const receipt={status:'SNAPSHOT_SAVED',slot,snapshotFile,sha256,bytes:Buffer.byteLength(bytes),
    generatedAt:previous.generatedAt,lastUpdatedAt:previous.lastUpdatedAt,totalJobs:previous.totalJobs,
    complete:true,capturedSources:[{sourceId:route.sourceId,batchId:'old-batch'}],sources:[{sourceId:route.sourceId,status:'SUCCESS'}]};
  await writeFile(snapshotFile,bytes);
  await writeFile(join(directory,'latest.json'),JSON.stringify(receipt));
  const fresh={...structuredClone(previous),generatedAt:new Date(Number(slot)+120_000).toISOString()};
  return {directory,previous,fresh,bytes,receipt};
}

test('a verified equal same-slot projection reuses exact prior bytes and time without carrying old outcome fields',async t=>{
  const fixture=await snapshotFixture(t),before=structuredClone(fixture.fresh);
  const handle=await selectRoundSnapshotHandle(fixture.directory,slot,fixture.fresh);
  assert.equal(handle.snapshotReused,true);
  for(const field of ['snapshotFile','sha256','bytes','generatedAt','lastUpdatedAt','totalJobs']){
    assert.equal(handle[field],fixture.receipt[field],field);
  }
  assert.equal('complete' in handle,false);
  assert.equal('capturedSources' in handle,false);
  assert.equal('sources' in handle,false);
  assert.deepEqual(fixture.fresh,before);
  assert.equal(await readFile(handle.snapshotFile,'utf8'),fixture.bytes);
});

test('source health, membership, public metadata or slot changes require a fresh snapshot handle',async t=>{
  const fixture=await snapshotFixture(t);
  const changes=[
    snapshot=>{snapshot.sources[0].health='DEGRADED';snapshot.companies[0].health='DEGRADED';},
    snapshot=>{snapshot.sources[0].lastAttemptAt=snapshot.generatedAt;},
    snapshot=>{snapshot.sources[0].reasons=['CURRENT_CAPTURE_FAILED'];},
    snapshot=>{snapshot.sources[0].jobs=[];snapshot.companies[0].jobs=[];snapshot.sources[0].visibleJobCount=0;snapshot.totalJobs=0;},
    snapshot=>{snapshot.sources[0].jobs[0].title='Corrected title';snapshot.companies[0].jobs[0].title='Corrected title';},
    snapshot=>{snapshot.coverage.heldSourceCount=1;}
  ];
  for(const change of changes){
    const snapshot=structuredClone(fixture.fresh);change(snapshot);
    const handle=await selectRoundSnapshotHandle(fixture.directory,slot,snapshot);
    assert.equal(handle.snapshotReused,false);
    assert.equal(handle.generatedAt,snapshot.generatedAt);
    assert.equal(handle.sha256,createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'));
  }
  for(const newSlot of [null,String(Number(slot)+24*3600_000)]){
    const handle=await selectRoundSnapshotHandle(fixture.directory,newSlot,fixture.fresh);
    assert.equal(handle.snapshotReused,false);
    assert.equal(handle.generatedAt,fixture.fresh.generatedAt);
  }
});

test('missing, corrupt, mismatched or unbound previous artifacts never authorize reuse',async t=>{
  const fixture=await snapshotFixture(t),latest=join(fixture.directory,'latest.json');
  for(const change of [{status:'UNKNOWN'},{slot:String(Number(slot)-24*3600_000)},{sha256:'z'.repeat(64)},
    {snapshotFile:join(fixture.directory,'outside.json')},{bytes:fixture.receipt.bytes+1},
    {generatedAt:fixture.fresh.generatedAt},{lastUpdatedAt:null},{totalJobs:2}]){
    await writeFile(latest,JSON.stringify({...fixture.receipt,...change}));
    assert.equal((await selectRoundSnapshotHandle(fixture.directory,slot,fixture.fresh)).snapshotReused,false);
  }
  await writeFile(latest,'{truncated');
  assert.equal((await selectRoundSnapshotHandle(fixture.directory,slot,fixture.fresh)).snapshotReused,false);
  await writeFile(latest,JSON.stringify(fixture.receipt));
  await writeFile(fixture.receipt.snapshotFile,fixture.bytes.replace('Synthetic role','Different role'));
  assert.equal((await selectRoundSnapshotHandle(fixture.directory,slot,fixture.fresh)).snapshotReused,false);
  await rm(fixture.receipt.snapshotFile);
  assert.equal((await selectRoundSnapshotHandle(fixture.directory,slot,fixture.fresh)).snapshotReused,false);
  await rm(latest);
  assert.equal((await selectRoundSnapshotHandle(fixture.directory,slot,fixture.fresh)).snapshotReused,false);
});

test('archiveInactiveSnapshots retains current + 4 newest raw, gzips older ones and prunes >30d archives',async t=>{
  const cache=fileURLToPath(new URL('../.runtime/.cache/',import.meta.url));
  await mkdir(cache,{recursive:true});
  const dir=await mkdtemp(join(cache,'snapshot-archive-ts-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const now=Date.now();
  const files=[];
  for(let i=0;i<7;i++){
    const data=JSON.stringify({i,pad:'x'.repeat(200)});
    const sha=createHash('sha256').update(data).digest('hex');
    const file=join(dir,`public-${sha}.json`);
    await writeFile(file,data);
    await utimes(file,(now-(7-i)*60_000)/1000,(now-(7-i)*60_000)/1000);
    files.push({file,data,sha});
  }
  const staleGz=join(dir,`public-${'f'.repeat(64)}.json.gz`);
  await writeFile(staleGz,Buffer.from('stale'));
  await utimes(staleGz,(now-31*24*3600_000)/1000,(now-31*24*3600_000)/1000);
  await archiveInactiveSnapshots(dir,files[0].file,now);
  const {readdir}=await import('node:fs/promises');
  const names=new Set(await readdir(dir));
  assert.equal(names.has(staleGz.split(/[\\/]/).at(-1)),false);
  assert.equal(names.has(files[0].file.split(/[\\/]/).at(-1)),true);
  for(const item of files.slice(3)) assert.equal(names.has(item.file.split(/[\\/]/).at(-1)),true);
  for(const item of files.slice(1,3)){
    const base=item.file.split(/[\\/]/).at(-1);
    assert.equal(names.has(base),false);
    assert.equal(names.has(base+'.gz'),true);
    assert.equal(gunzipSync(await readFile(item.file+'.gz')).toString('utf8'),item.data);
  }
});
