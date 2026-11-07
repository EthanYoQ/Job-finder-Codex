import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createHotjobLegacySourceFetch} from '../src/crawler/hotjobLegacySourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
test('CR Pharma malformed native rows do not block the remaining complete list',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-cr-pharma-social'),at='2026-11-06T00:00:00.000Z';
 for(const mode of ['good','missing-title','non-object','foreign']){
  const rows=[{PostId:'1',PostName:'Synthetic role 1',WorkPlace:'上海'},{PostId:'2',PostName:'Synthetic role 2',WorkPlace:'北京'}];
  if(mode==='missing-title')rows[1].PostName='';if(mode==='non-object')rows[1]=null;if(mode==='foreign')rows[1].WorkPlace='Tokyo, Japan';
  const fetch=createHotjobLegacySourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,body:JSON.stringify({data:{details:rows,rowCount:2,currentPage:1},pageCount:1,rowSize:plan.hotjobLegacy.pageSize??20}),finalUrl:url,contentType:'application/json',capturedAt:at})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);assert.equal(result.jobs.length,mode==='good'?2:1);
  if(mode!=='good'){assert.equal(result.fetchEvidence.jobQuarantines.length,1);const bad=structuredClone(result.fetchEvidence);bad.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:bad,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
 }
});
