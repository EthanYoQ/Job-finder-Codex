import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
test('BMS invalid rows do not block other jobs after full native pagination',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-bms-china-social'),at='2026-11-06T00:00:00.000Z';
 for(const mode of ['good','missing-title','non-object','foreign','missing-page']){
  const rows=Array.from({length:12},(_,i)=>({id:String(i+1),name:`Synthetic Role ${i+1}`,positionUrl:`/careers/job/${i+1}`,locations:['Shanghai - CN'],standardizedLocations:['Shanghai,Shanghai,CN'],postedTs:1793836800}));
  if(mode==='missing-title')rows[1].name='';if(mode==='non-object')rows[1]=null;if(mode==='foreign')rows[1].standardizedLocations=['Tokyo,JP'];
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url})=>{
   const start=Number(new URL(url).searchParams.get('start')??0),body=JSON.stringify({status:200,data:{count:12,positions:rows.slice(start,start+10)}});
   return {status:mode==='missing-page'&&start>0?503:200,body,finalUrl:url,contentType:'application/json',capturedAt:at};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});if(mode==='missing-page'){assert.equal(result.truth.completenessVerified,false);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);assert.equal(result.jobs.length,mode==='good'?12:11);
  if(mode!=='good'){assert.equal(result.fetchEvidence.jobQuarantines.length,1);const bad=structuredClone(result.fetchEvidence);bad.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:bad,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
 }
});
