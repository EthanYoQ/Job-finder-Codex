import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createHttpHtmlSourceFetch} from '../src/crawler/httpHtmlSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

test('Kelun: invalid title and unresolved geography isolate one job while full pages remain required',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-kelun-social'),at='2026-11-06T00:00:00.000Z';
 for(const mode of ['good','title','unknown','missing-link','malformed-link','foreign','duplicate','missing-page']){
  const rows=[1,2].map(id=>`<tr><td>${mode==='missing-link'&&id===2?'Broken':`<a href="/job_show/${mode==='duplicate'?1:id}">${mode==='title'&&id===2?'':`Role ${id}`}</a>`}</td><td>Social</td><td></td><td></td><td title="${id===2&&mode==='unknown'?'Unknown':id===2&&mode==='foreign'?'Japan':'四川省·成都市'}">${id===2&&mode==='unknown'?'Unknown':id===2&&mode==='foreign'?'Japan':'四川省·成都市'}</td></tr>`).join('');
  const body=`<table class="jobsTable">${mode==='malformed-link'?rows.replace('/job_show/2','https://['):rows}</table><a href="?p=1%5E2&PageIndex=${mode==='missing-page'?2:1}">Last</a>`;
  const fetch=createHttpHtmlSourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,body,finalUrl:url,contentType:'text/html',capturedAt:at})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(['duplicate','missing-page'].includes(mode)){assert.equal(result.truth.completenessVerified,false,mode);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(result.jobs.length,mode==='good'?2:1,mode);
  if(['title','unknown','missing-link','malformed-link'].includes(mode)){
   const evidence=structuredClone(result.fetchEvidence);assert.equal(evidence.jobQuarantines.length,1);evidence.jobQuarantines[0].sourceJobId='wrong';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});
