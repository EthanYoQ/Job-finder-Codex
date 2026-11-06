import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

for(const sourceId of ['source-cttq-social','source-shanghai-pharma-social','source-fosun-pharma-social','source-hansoh-social'])test(`${sourceId}: damaged list rows are isolated after complete native pagination`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId),at='2026-11-06T00:00:00.000Z';
 const originals=[1,2].map(index=>({Id:`${index}1111111-1111-4111-8111-111111111111`,JobAdName:`Synthetic social role ${index}`,LocNames:['江苏省·淮安市'],Category:'社会招聘',CategoryId:'1',Status:1,Kind:'全职'}));
 for(const mode of ['missing-title','non-object','social-conflict']){
  const rows=structuredClone(originals);rows[1]=mode==='non-object'?null:{...rows[1],...(mode==='missing-title'?{JobAdName:''}:{Category:'校园招聘'})};
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url,method})=>{
   let body;
   if(method==='POST')body={Code:200,Count:2,PageIndex:0,Data:rows};
   else{const row=originals.find(row=>new URL(url).searchParams.get('jobAdId')===row.Id);assert.ok(row);body={Code:200,Data:{...row,Duty:'Synthetic responsibilities'}};}
   return {status:200,body:JSON.stringify(body),finalUrl:url,contentType:'application/json',capturedAt:at};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.truth)}`);assert.equal(result.jobs.length,1);
  assert.equal(result.fetchEvidence.jobQuarantines.length,1);assert.equal(result.fetchEvidence.fetchCounts.rawCount,2);assert.equal(result.fetchEvidence.fetchCounts.parseDiscardCount,0);
  const changed=structuredClone(result.fetchEvidence);changed.jobQuarantines[0].sourceJobId='wrong-job';
  assert.equal(replayStrictSourceQualityEvidence({plan,evidence:changed,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
 }
});
