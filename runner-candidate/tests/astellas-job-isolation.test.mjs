import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createHttpHtmlSourceFetch} from '../src/crawler/httpHtmlSourceFetch.ts';
import {acquireAstellasPdfCities,replayAstellasPdfCities} from '../src/crawler/astellasPdfCityAcquisition.ts';
import {sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidenceAsync} from '../src/crawler/runSourceCrawl.ts';

test('Astellas unavailable PDFs and malformed list titles quarantine jobs without claiming an empty source',async()=>{
 const at='2026-11-06T00:00:00.000Z',plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astellas-china-social');
 for(const badTitle of [false,true]){
  const body=`<div class="cmp-accordion" data-cmp-is="accordion">${[1,2].map(id=>`<a href="/content/dam/astellas-com/global/zh/role-${id}.pdf"><span>${badTitle&&id===2?'':`Synthetic Role ${id}`}</span></a>`).join('')}</div>`;
  const capture=createHttpHtmlSourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,body,finalUrl:url,contentType:'text/html',capturedAt:at})});
  const list=await capture(plan);assert.equal(list.ok,true);assert.equal(list.fetchEvidence.fetchCounts.rawCount,2);
  // No PDF runtime or network is needed to replay an explicitly unavailable capture.
  const listJobs=badTitle?[1]:[1,2],evidence={...list.fetchEvidence,astellasPdfLocations:{schemaVersion:'astellas-owned-pdf-cities-v1',runtimeCapability:{available:false,code:'PDF_RUNTIME_UNAVAILABLE'},sourceConfigSha256:sourcePlanConfigSha256(plan),listArtifactLogicalKey:list.fetchEvidence.artifacts[0].logicalKey,entries:listJobs.map(id=>({sourceJobId:`role-${id}`,officialUrl:`https://www.astellas.com/content/dam/astellas-com/global/zh/role-${id}.pdf`,outcome:{ok:false,code:'PDF_RUNTIME_UNAVAILABLE'}}))}};
  const replay=await replayAstellasPdfCities(plan,evidence,at,false);assert.equal(replay.jobs.length,0);assert.equal(replay.listEvidence.jobQuarantines.length,2);assert.equal(replay.listEvidence.fetchCounts.rawCount,2);
  const {evaluatePaginationEvidence}=await import('../src/crawler/paginationEvidence.ts');
  const {JOB_QUARANTINE_PAGINATION}=await import('../src/crawler/jobQuarantine.ts');
  const isolated={...replay.listEvidence,astellasPdfLocations:evidence.astellasPdfLocations};
  const paginationEvaluation=evaluatePaginationEvidence({evidence:isolated,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,...JOB_QUARANTINE_PAGINATION});
  const result=await runSourceCrawl(plan,{fetch:async()=>({...list,fetchEvidence:isolated,paginationEvaluation}),isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,JSON.stringify(result.truth));assert.equal(result.jobs.length,0);assert.equal(result.fetchEvidence.jobQuarantines.length,2);
  const changed=structuredClone(isolated);changed.jobQuarantines[0].officialUrl='https://www.astellas.com/wrong.pdf';
  assert.equal(await replayStrictSourceQualityEvidenceAsync({plan,evidence:changed,paginationEvaluation,reconciliation:result.reconciliation,jobs:[],capturedAt:at}),false);
 }
});
