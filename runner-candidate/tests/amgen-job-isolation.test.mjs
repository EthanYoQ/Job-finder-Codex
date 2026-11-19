import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createAmgenRadancySourceFetch,validateStrictAmgenRadancyEvidence} from '../src/crawler/amgenRadancySourceFetch.ts';
import {validateStrictAmgenRadancyEvidence as validateWebAmgenRadancyEvidence} from '../../web-candidate/src/crawler/amgenRadancySourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
import {evaluatePaginationEvidence} from '../src/crawler/paginationEvidence.ts';

const at='2026-11-06T00:00:00.000Z',origin='https://careers.amgen.com',wd='https://amgen.wd1.myworkdayjobs.com';
const rows=[1,2,3].map(i=>({id:String(1000+i),title:`Synthetic Role ${i}`,url:`${origin}/en/job/shanghai/role-${i}/87/${1000+i}`,req:`R-${i}`,path:`/job/China---Shanghai/Role_R-${i}`}));
function entry(pageRows=rows,page=1,total=pageRows.length){
 const totalPages=Math.max(1,Math.ceil(total/12));
 const attributes={'location':'China','location-type':'2','location-path':'1814991','organization-ids':'87','keywords':'','total-job-results':total,'total-pages':totalPages,'current-page':page,'records-per-page':'12','ajax-post-url':'/en/search-jobs/resultspost','show-radius':'False','latitude':'35','longitude':'105','sort-direction':'0','facet-type':'0'};
 return `<section id="search-filters" data-radius-unit-type="0"></section><section id="search-results" ${Object.entries(attributes).map(([k,v])=>`data-${k}="${v}"`).join(' ')}><ul id="search-results-jobs">${pageRows.map(row=>`<li><a data-job-id="${row.id}" href="${row.url}"><h3>${row.title}</h3></a><button class="js-save-job-btn" data-job-id="${row.id}" data-org-id="87"></button></li>`).join('')}</ul><nav class="pagination"><a class="next${page===totalPages?' disabled':''}" data-display-type="Jobs"></a></nav></section>`;
}
function detailHtml(row,reqOverride){
 const req=reqOverride??row.req;
 return `<link rel="canonical" href="${row.url}"><h1>${row.title}</h1><a class="job-apply" data-apply-url="${wd}/Careers${row.path}/apply">Apply</a><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:req,url:row.url,title:row.title,description:'<p>Synthetic official description with enough complete content.</p>',hiringOrganization:{name:'Amgen'},jobLocation:[{address:{addressCountry:'China',addressLocality:'Shanghai',addressRegion:'Shanghai'}}]})}</script>`;
}

test('Amgen fails the source and retains the response when a required list or blocked request fails',async(t)=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-amgen-china-social');
 const page2Rows=Array.from({length:13},(_,i)=>({id:String(3000+i),title:`Paged Role ${i}`,url:`${origin}/en/job/shanghai/paged-${i}/87/${3000+i}`,req:`R-${30+i}`,path:`/job/China---Shanghai/Paged_R-${30+i}`}));
 const postUrl=`${origin}/en/search-jobs/resultspost`;
 for(const [label,failedAt,status] of [['entry 429',0,429],['page2 503',1,503],['page2 429',1,429],['all-details 429',2,429]])await t.test(label,async()=>{
  const body=`<html>Request failed with HTTP ${status}</html>`;
  const calls=[];
  const fetch=createAmgenRadancySourceFetch({now:()=>new Date(at),http:async({url,method,body:reqBody})=>{
   calls.push(url);assert.ok(url.startsWith(origin),`Zero Workday requests allowed: ${url}`);
   const meta={finalUrl:url,capturedAt:at};
   if(failedAt===0&&url===plan.source.officialEntryUrl)return {...meta,status,body,contentType:'text/html',retryAfter:{value:'60',delayMs:60000}};
   if(url===plan.source.officialEntryUrl)return {...meta,status:200,body:entry(failedAt===2?rows:page2Rows.slice(0,12),1,failedAt===2?rows.length:page2Rows.length),contentType:'text/html'};
   if(url===postUrl){
    assert.equal(method,'POST');
    if(failedAt===1)return {...meta,status,body,contentType:'text/html',retryAfter:{value:'60',delayMs:60000}};
    return {...meta,status:200,body:JSON.stringify({results:entry(page2Rows.slice(12),2,page2Rows.length)}),contentType:'application/json'};
   }
   if(failedAt===2)return {...meta,status,body,contentType:'text/html',retryAfter:{value:'60',delayMs:60000}};
   assert.fail(`Unexpected request: ${url} (${reqBody??''})`);
  }});
  const result=await fetch(plan);
  assert.equal(result.ok,false);
  assert.deepEqual(result.transportFailure,{code:`OFFICIAL_HTTP_${status}`,retryable:true,retryAfterMs:60000,stage:failedAt===0?'ENTRY':'PAGE'});
  assert.ok(result.fetchEvidence,'Failed response must be retained as evidence');
  if(failedAt===2){
   assert.equal(result.fetchEvidence.pages.length,1);
   assert.deepEqual(result.fetchEvidence.fetchCounts,{rawCount:3,parsedCount:3,validCount:0,parseDiscardCount:0,validationDiscardCount:3});
   assert.equal(validateStrictAmgenRadancyEvidence(plan,result.fetchEvidence,[]),false);
  }else{
   assert.ok(result.fetchEvidence.supportingArtifactOnlyFailure);
   assert.equal(result.fetchEvidence.pages.length,0);
  }
 });
});

test('Amgen rejects partial, duplicate, or drifted multi-page Radancy lists and verifies complete 4-page closure',async(t)=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-amgen-china-social');
 const inventory=Array.from({length:48},(_,i)=>({id:String(2000+i),title:`Synthetic Discovery ${i}`,url:`${origin}/en/job/shanghai/discovery-${i}/87/${2000+i}`,req:`R-${200+i}`,path:`/job/China---Shanghai/Discovery_R-${200+i}`}));
 for(const mode of ['good','partial-page','duplicate-id','changed-total'])await t.test(mode,async()=>{
  const calls=[];
  const fetch=createAmgenRadancySourceFetch({now:()=>new Date(at),http:async(request)=>{
   calls.push(request);assert.ok(request.url.startsWith(origin),`Zero Workday requests allowed: ${request.url}`);
   const meta={finalUrl:request.url,capturedAt:at};
   if(request.url===plan.source.officialEntryUrl||request.url.endsWith('/resultspost')){
    const page=request.body?JSON.parse(request.body).CurrentPage:1;
    if(mode==='partial-page'&&page===2)return {...meta,status:429,body:'Synthetic rate limit',contentType:'text/html',retryAfter:{value:'60',delayMs:60000}};
    const pageRows=inventory.slice((page-1)*12,page*12);
    if(mode==='duplicate-id'&&page===2)pageRows[0]=inventory[0];
    const html=entry(pageRows,page,mode==='changed-total'&&page===2?47:48);
    return {...meta,status:200,body:page===1?html:JSON.stringify({results:html}),contentType:page===1?'text/html':'application/json'};
   }
   const row=inventory.find(r=>r.url===request.url);assert.ok(row,request.url);
   return {...meta,status:200,body:detailHtml(row),contentType:'text/html'};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(mode==='good'){
   assert.equal(result.truth.completenessVerified,true,JSON.stringify(result.observation));
   assert.equal(result.jobs.length,48);
   assert.equal(result.jobs[0].sourceJobId,`workday:sha256:${createHash('sha256').update(inventory[0].path).digest('hex')}`);
   assert.equal(validateWebAmgenRadancyEvidence(plan,result.fetchEvidence,result.jobs),true);
   return;
  }
  assert.equal(result.status,'FAILED');
  assert.deepEqual(result.truth,{transportSuccess:false,adapterSuccess:false,completenessVerified:false});
  assert.equal(result.jobs.length,0);
  const evidence=result.fetchEvidence;
  assert.equal(evidence.supportingArtifactOnlyFailure.code,'AMGEN_RADANCY_INVALID');
  assert.equal(evidence.pages.length,0);
  assert.equal(validateStrictAmgenRadancyEvidence(plan,evidence,[]),false);
  if(mode==='partial-page')assert.equal(result.transportFailure.stage,'PAGE');
 });
});

test('Amgen preserves HTTP 429 and Retry-After when response body exceeds byte limit',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-amgen-china-social');
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
   const fetch=createAmgenRadancySourceFetch({now:()=>new Date(at)});
   const result=await fetch(plan);
   assert.equal(result.ok,false,mode);
   assert.deepEqual(result.transportFailure,{code:'OFFICIAL_HTTP_429',retryable:true,retryAfterMs:60000,stage:'ENTRY'},mode);
   assert.equal(result.fetchEvidence,undefined,mode);
  }
 }finally{
  globalThis.fetch=originalFetch;
 }
});

test('Amgen retains a complete Radancy list, quarantines single non-challenge failures, and fails retryably on challenges or all-503 details',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-amgen-china-social');
 for(const mode of ['good','503','all-503','404-then-503','429','wrong-id','transport','bad-list-title']){
  const calls=[];
  const fetch=createAmgenRadancySourceFetch({now:()=>new Date(at),http:async({url})=>{
   calls.push(url);assert.ok(url.startsWith(origin),`Zero Workday requests allowed: ${url}`);
   let body,contentType='text/html',status=200;
   if(url===plan.source.officialEntryUrl){
    body=mode==='bad-list-title'?entry().replace(`<h3>${rows[1].title}</h3>`,'<h3></h3>'):entry();
   }else{
    const row=rows.find(r=>r.url===url);assert.ok(row,url);
    if(mode==='all-503')status=503;
    if(mode==='404-then-503')status=row===rows[0]?404:503;
    if(row===rows[1]&&mode==='transport')throw Error('Synthetic unavailable');
    if(row===rows[1]&&['503','429'].includes(mode))status=Number(mode);
    body=status===200?detailHtml(row,mode==='wrong-id'&&row===rows[1]?'R-999':row.req):'Synthetic unavailable';
   }
   return {status,body,finalUrl:url,contentType,capturedAt:at};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(mode==='429'||mode==='all-503'||mode==='404-then-503'){
   assert.equal(result.truth.transportSuccess,false,mode);
   assert.equal(result.truth.completenessVerified,false,mode);
   assert.equal(result.transportFailure?.code,mode==='429'?'OFFICIAL_HTTP_429':'OFFICIAL_HTTP_503',mode);
   assert.equal(result.transportFailure?.retryable,true,mode);
   assert.equal(result.fetchEvidence.pages.length,1,mode);
   if(mode==='429')assert.equal(calls.some(url=>url===rows[2].url),false);
   continue;
  }
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(result.jobs.length,mode==='good'?3:2,mode);
  if(mode==='good'){
   assert.equal(validateWebAmgenRadancyEvidence(plan,result.fetchEvidence,result.jobs),true);
   assert.equal(evaluatePaginationEvidence({evidence:result.fetchEvidence,expectedChannelIds:[],filteredOutput:true,allowPositiveOfficialTotalCountAfterAdapterReconciliation:true}).verifiedEligible,true);
  }else{
   assert.equal(result.fetchEvidence.jobQuarantines.length,1);
   const changed=structuredClone(result.fetchEvidence);changed.jobQuarantines[0].code='FABRICATED';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence:changed,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});
