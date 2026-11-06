import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createWorkdaySourceFetch} from '../src/crawler/workdaySourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

const at='2026-11-06T00:00:00.000Z',countryId='6cb77610a8a543aea2d6bc10457e35d4';
for(const sourceId of ['source-biogen-china-social','source-csl-china-social'])test(`${sourceId}: complete list rows can update despite an invalid job`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId),biogen=sourceId.includes('biogen');
 const rows=[1,2].map(index=>({title:`Role ${index}`,externalPath:biogen?`/job/Shanghai-China/Role_REQ${index}-1`:`/job/APAC-CN-Shanghai-CSL-Behring/Role_R-${index}`,locationsText:biogen?'Shanghai, China':'APAC, CN, Shanghai, CSL Behring',bulletFields:biogen?[`REQ${index}`]:['China',`R-${index}`]}));
 for(const mode of ['good','missing-title','non-object']){
  const data=structuredClone(rows);if(mode!=='good')data[1]=mode==='non-object'?null:{...data[1],title:''};
  const fetch=createWorkdaySourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,finalUrl:url,contentType:'application/json',capturedAt:at,body:JSON.stringify({total:2,jobPostings:data,userAuthenticated:false,facets:[{facetParameter:'locationCountry',values:[{id:countryId,descriptor:'China',count:2}]}]})})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);assert.equal(result.jobs.length,mode==='good'?2:1);
  if(mode!=='good'){
   assert.equal(result.fetchEvidence.fetchCounts.rawCount,2);assert.equal(result.fetchEvidence.jobQuarantines.length,1);
   const changed=structuredClone(result.fetchEvidence);changed.jobQuarantines[0].sourceJobId='wrong';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence:changed,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});

test('CSL closes both list pages before details and stops native requests after a 429',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-csl-china-social');
 const shanghai='APAC, CN, Shanghai, CSL Behring',beijing='APAC, CN, Beijing, CSL Behring';
 const rows=Array.from({length:22},(_,index)=>({title:`Role ${index+1}`,externalPath:`/job/APAC-CN-Shanghai-CSL-Behring/Role_R-${index+1}`,locationsText:index<3?'2 Locations':shanghai,bulletFields:['China',`R-${index+1}`]}));
 for(const mode of ['single-failure','rate-limit']){
  const events=[];let details=0;
  const fetch=createWorkdaySourceFetch({now:()=>new Date(at),http:async({url,body})=>{
   const offset=JSON.parse(body).offset;events.push(`LIST:${offset}`);
   return {status:200,finalUrl:url,contentType:'application/json',capturedAt:at,body:JSON.stringify({total:22,jobPostings:rows.slice(offset,offset+20),userAuthenticated:false,facets:[{facetParameter:'locationCountry',values:[{id:countryId,descriptor:'China',count:22}]}]})};
  },detailHttp:async({url})=>{
   assert.deepEqual(events.slice(0,2),['LIST:0','LIST:20']);details++;events.push('DETAIL');
   const row=rows.find(row=>url.endsWith(row.externalPath));assert.ok(row);
   const status=row===rows[0]?mode==='rate-limit'?429:503:200;
   const country={id:countryId,descriptor:'China'};
   return {status,finalUrl:url,contentType:'application/json',capturedAt:at,body:status!==200?'Synthetic unavailable':JSON.stringify({userAuthenticated:false,jobPostingInfo:{id:'a'.repeat(32),title:row.title,jobReqId:row.bulletFields[1],jobPostingId:row.externalPath.split('/').at(-1),jobPostingSiteId:plan.workday.site,externalUrl:new URL(plan.source.officialEntryUrl).origin+'/'+plan.workday.site+row.externalPath,posted:true,canApply:true,country,jobRequisitionLocation:{descriptor:shanghai,country:{...country,alpha2Code:'CN'}},location:shanghai,additionalLocations:[beijing]}})};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.truth)}`);assert.equal(result.jobs.length,mode==='rate-limit'?19:21);assert.equal(details,mode==='rate-limit'?1:3);
 }
});
