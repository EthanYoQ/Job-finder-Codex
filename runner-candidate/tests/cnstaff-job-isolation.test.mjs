import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
test('Daiichi CNStaff native bad jobs are isolated with the full page retained',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-daiichi-sankyo-china-social'),at='2026-11-06T00:00:00.000Z';
 for(const mode of ['good','missing-title','non-object','foreign']){
  const rows=[1,2].map(id=>({job_publish_id:String(id),job_id:String(id),job_name_show:`Synthetic Role ${id}`,job_address_name:'上海',country:'China'}));
  if(mode==='missing-title')rows[1].job_name_show='';if(mode==='non-object')rows[1]=null;if(mode==='foreign'){rows[1].job_address_name='Tokyo';rows[1].country='Japan';}
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,body:JSON.stringify({list:rows,total:2,page:{code:'',limit:'0,15',now:1,pageSize:15,total:1}}),finalUrl:url,contentType:'application/json',capturedAt:at})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);assert.equal(result.jobs.length,mode==='good'?2:1);
  if(mode!=='good'){assert.equal(result.fetchEvidence.jobQuarantines.length,1);const bad=structuredClone(result.fetchEvidence);bad.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:bad,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
 }
});
