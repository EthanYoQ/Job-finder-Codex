import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createWorkdaySourceFetch} from '../src/crawler/workdaySourceFetch.ts';
import {createCslOfficialPortalSourceFetch,validateStrictCslOfficialPortalEvidence} from '../src/crawler/cslOfficialPortalSourceFetch.ts';
import {validateStrictCslOfficialPortalEvidence as validateWebCslOfficialPortalEvidence} from '../../web-candidate/src/crawler/cslOfficialPortalSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

const at='2026-11-06T00:00:00.000Z',countryId='6cb77610a8a543aea2d6bc10457e35d4';

test('CSL official portal reports a limited or unavailable list with its response evidence',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-csl-china-social');
 for(const status of [429,503]){
  const body='<html>Temporarily unavailable</html>';
  const fetch=createCslOfficialPortalSourceFetch({now:()=>new Date(at),http:async({url})=>{
   assert.equal(url,plan.source.officialEntryUrl);
   return {status,finalUrl:url,contentType:'text/html',capturedAt:at,body,retryAfter:{value:'60',delayMs:60000}};
  }});
  const result=await fetch(plan);
  assert.equal(result.ok,false);
  assert.deepEqual(result.transportFailure,{code:`OFFICIAL_HTTP_${status}`,retryable:true,retryAfterMs:60000,stage:'ENTRY'});
  assert.equal(result.fetchEvidence.artifacts[0].httpStatus,status);
  assert.equal(result.fetchEvidence.artifacts[0].body,body);
 }
});

test('source-biogen-china-social: complete list rows can update despite an invalid job',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-biogen-china-social');
 const rows=[1,2].map(index=>({title:`Role ${index}`,externalPath:`/job/Shanghai-China/Role_REQ${index}-1`,locationsText:'Shanghai, China',bulletFields:[`REQ${index}`]}));
 for(const mode of ['good','missing-title','non-object','two-unidentified']){
  const data=structuredClone(rows);if(mode!=='good')data[1]=mode==='non-object'?null:{...data[1],title:''};
  if(mode==='two-unidentified'){data[1]=null;data.push(null);}
  const fetch=createWorkdaySourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,finalUrl:url,contentType:'application/json',capturedAt:at,body:JSON.stringify({total:data.length,jobPostings:data,userAuthenticated:false,facets:[{facetParameter:'locationCountry',values:[{id:countryId,descriptor:'China',count:data.length}]}]})})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(result.jobs.length,mode==='good'?2:1);
  if(mode!=='good'){
   assert.equal(result.fetchEvidence.fetchCounts.rawCount,data.length);assert.equal(result.fetchEvidence.jobQuarantines.length,mode==='two-unidentified'?2:1);
   const changed=structuredClone(result.fetchEvidence);changed.jobQuarantines[0].sourceJobId='wrong';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence:changed,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});

test('CSL official portal verifies multi-page ItemList, raw control chars in JSON-LD, Field Sales pending, and single-job quarantine',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-csl-china-social');
 const wdOrigin='https://csl.wd1.myworkdayjobs.com/CSL_External';
 const jobs=[
  {portalUrl:'https://jobs.csl.com/en/jobs/senior-director-regional-ecosystem-lead-shanghai-en-r-287778',reqId:'R-287778',externalPath:'/job/APAC-CN-Shanghai-CSL-Behring/Medical-Science-Liaison_R-287778',locality:'Shanghai',region:'Shanghai',street:'Nanjing West Rd',title:'Medical Science Liaison'},
  {portalUrl:'https://jobs.csl.com/en/jobs/product-specialist-taiyuan-en-r-291057',reqId:'R-291057',externalPath:'/job/APAC-CN-Field-Sales-CSL-Behring/Territory-Manager_R-291057',locality:'',region:'',street:'Field Sales',title:'Territory Manager'}
 ];
 function listHtml(page){
  const item=jobs[page-1];
  const entityId=page===1?'https://jobs.csl.com/en/jobs?country=china':'https://jobs.csl.com/en/jobs?country=china&amp;page=2';
  const next=page===1?'<a rel="next" href="/en/jobs?country=china&amp;page=2">Next</a>':'';
  return `<main><p>View 2 jobs</p><p>Showing ${page} to ${page} of 2 results</p>${next}</main><script type="application/ld+json">${JSON.stringify({'@type':'ItemList',mainEntityOfPage:{'@id':entityId},itemListElement:[{position:1,url:item.portalUrl}]})}</script>`;
 }
 function detailHtml(item){
  // Intentionally embed literal \r\n\t inside description string literal to match live jobs.csl.com JSON-LD.
  const jsonLd=`{"@type":"JobPosting","title":"${item.title}","identifier":{"@type":"PropertyValue","name":"Job ID","value":"${item.reqId}"},"datePosted":"2026-11-18","description":"<p>Line 1\r\n\tLine 2 complete responsibilities.</p>","jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressCountry":"CN","addressLocality":"${item.locality}","addressRegion":"${item.region}","streetAddress":"${item.street}"}}}`;
  return `<script type="application/ld+json">${jsonLd}</script><a href="${wdOrigin}${item.externalPath}/apply">Apply on Workday</a>`;
 }
 for(const mode of ['good','single-failure','rate-limit-first','rate-limit-second','all-503','wrong-url-req']){
  const seen=[];
  const fetch=createCslOfficialPortalSourceFetch({now:()=>new Date(at),http:async({url})=>{
   seen.push(url);
   assert.ok(url.startsWith('https://jobs.csl.com/'),`Zero Workday requests allowed: ${url}`);
   if(url===plan.source.officialEntryUrl)return {status:200,finalUrl:url,contentType:'text/html',capturedAt:at,body:listHtml(1)};
   if(url===`${plan.source.officialEntryUrl}&page=2`)return {status:200,finalUrl:url,contentType:'text/html',capturedAt:at,body:listHtml(2)};
   const item=jobs.find(j=>j.portalUrl===url);assert.ok(item,url);
   if(mode==='all-503'){
    return {status:503,finalUrl:url,contentType:'text/html',capturedAt:at,body:'Unavailable'};
   }
   if(mode==='rate-limit-second'&&item===jobs[1]){
    return {status:429,finalUrl:url,contentType:'text/html',capturedAt:at,body:'Unavailable',retryAfter:{value:'60',delayMs:60000}};
   }
   if(item===jobs[0]&&['single-failure','rate-limit-first'].includes(mode)){
    return {status:mode==='rate-limit-first'?429:503,finalUrl:url,contentType:'text/html',capturedAt:at,body:'Unavailable',...(mode==='rate-limit-first'?{retryAfter:{value:'60',delayMs:60000}}:{})};
   }
   if(item===jobs[0]&&mode==='wrong-url-req'){
    return {status:200,finalUrl:url,contentType:'text/html',capturedAt:at,body:detailHtml({...item,reqId:'R-999999',externalPath:item.externalPath.replace('R-287778','R-999999')})};
   }
   return {status:200,finalUrl:url,contentType:'text/html',capturedAt:at,body:detailHtml(item)};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(mode==='rate-limit-first'||mode==='rate-limit-second'||mode==='all-503'){
   assert.equal(result.truth.transportSuccess,false,mode);
   assert.equal(result.transportFailure?.code,mode==='all-503'?'OFFICIAL_HTTP_503':'OFFICIAL_HTTP_429',mode);
   assert.equal(result.transportFailure?.retryable,true,mode);
   assert.equal(seen.length,mode==='rate-limit-first'?3:4,mode);
   continue;
  }
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(seen.length,4);
  if(mode==='good'){
   assert.equal(result.jobs.length,2);
   assert.equal(result.jobs[0].sourceJobId,`workday:sha256:${createHash('sha256').update(jobs[0].externalPath).digest('hex')}`);
   assert.equal(result.jobs[0].officialUrl,`${wdOrigin}${jobs[0].externalPath}`);
   assert.deepEqual(result.jobs[0].cities,['上海']);
   assert.equal(result.jobs[0].officialPublishedAt,'2026-11-18T00:00:00.000Z');
   assert.equal(result.jobs[1].sourceJobId,`workday:sha256:${createHash('sha256').update(jobs[1].externalPath).digest('hex')}`);
   assert.deepEqual(result.jobs[1].cities,[CITY_PENDING]);
   assert.equal(validateWebCslOfficialPortalEvidence(plan,result.fetchEvidence,result.jobs),true);
   const swapped=structuredClone(result.fetchEvidence);
   const altPath=jobs[0].externalPath.replace('R-287778','R-999999');
   const altId=`workday:sha256:${createHash('sha256').update(altPath).digest('hex')}`;
   const altJob={...result.jobs[0],sourceJobId:altId,officialUrl:`${wdOrigin}${altPath}`};
   const detailArtifact=swapped.artifacts.find(a=>a.logicalKey==='csl-portal-detail-0000');
   detailArtifact.body=detailArtifact.body.replaceAll('R-287778','R-999999');
   const reportArtifact=swapped.artifacts.find(a=>a.logicalKey==='csl-official-portal-binding-report');
   reportArtifact.body=reportArtifact.body.replaceAll('R-287778','R-999999');
   swapped.pages[0].validJobIds=[`sha256:${createHash('sha256').update(altId).digest('hex')}`];
   assert.equal(validateWebCslOfficialPortalEvidence(plan,swapped,[altJob,result.jobs[1]]),false);
  }else{
   assert.equal(result.jobs.length,1);
   assert.equal(result.fetchEvidence.jobQuarantines.length,1);
   const changed=structuredClone(result.fetchEvidence);changed.jobQuarantines[0].sourceJobId='wrong';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence:changed,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});

test('CSL official portal preserves HTTP 429 and Retry-After when response body exceeds byte limit',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-csl-china-social');
 const originalFetch=globalThis.fetch;
 try{
  for(const mode of ['declared','streamed']){
   globalThis.fetch=async()=>{
    const headers={'content-type':'text/html','retry-after':'60',...(mode==='declared'?{'content-length':'3000000'}:{})};
    if(mode==='declared')return new Response('Rate limited',{status:429,headers});
    const chunk=new Uint8Array(600_000).fill(65);
    const body=new ReadableStream({start(controller){for(let i=0;i<4;i++)controller.enqueue(chunk);controller.close();}});
    return new Response(body,{status:429,headers});
   };
   const fetch=createCslOfficialPortalSourceFetch({now:()=>new Date(at)});
   const result=await fetch(plan);
   assert.equal(result.ok,false,mode);
   assert.deepEqual(result.transportFailure,{code:'OFFICIAL_HTTP_429',retryable:true,retryAfterMs:60000,stage:'ENTRY'},mode);
   assert.equal(result.fetchEvidence,undefined,mode);
  }
 }finally{
  globalThis.fetch=originalFetch;
 }
});
