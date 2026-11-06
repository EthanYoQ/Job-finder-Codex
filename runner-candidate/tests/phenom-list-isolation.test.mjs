import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
for(const sourceId of ['source-merck-china-social','source-ucb-china-social'])test(`${sourceId}: damaged list rows quarantine while complete good jobs update`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId),merck=sourceId.includes('merck'),at='2026-11-06T00:00:00.000Z';
 const origin=merck?'https://careers.emdgroup.com':'https://careers.ucb.com';
 const bootstrap={widgetApiEndpoint:`${origin}/widgets`,country:merck?'us':'global',deviceType:'desktop',locale:merck?'en_us':'zh_global',refNum:merck?'MQAEGZUS':'UCB1GLOBAL',pageName:'search-results',pageId:merck?'page18-ds':'page17-ds'};
 for(const mode of ['good','missing-title','non-object','foreign']){
  const rows=[1,2].map(id=>({jobSeqNo:merck?`MQAEGZUS${id}EXTERNALENUS`:`UCB${id}`,reqId:String(id),jobId:String(id),title:`Synthetic Role ${id}`,location:'Shanghai, Shanghai, China',city:'Shanghai',state:'Shanghai',country:'China',applyUrl:'',externalApply:false,visibilityType:'External',siteType:'external',jobVisibility:['external']}));
  if(mode==='missing-title')rows[1].title='';if(mode==='non-object')rows[1]=null;if(mode==='foreign'){rows[1].location='Tokyo, Japan';rows[1].country='Japan';}
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,body:url===plan.source.officialEntryUrl?`<script>var phApp=${JSON.stringify(bootstrap)};</script>`:JSON.stringify({refineSearch:{status:200,from:0,totalHits:2,data:{jobs:rows,aggregations:[],ui_selections:{country:['China']}}}}),finalUrl:url,contentType:url===plan.source.officialEntryUrl?'text/html':'application/json',capturedAt:at})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);assert.equal(result.jobs.length,mode==='good'?2:1);
  if(mode!=='good'){const bad=structuredClone(result.fetchEvidence);bad.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:bad,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
 }
});
