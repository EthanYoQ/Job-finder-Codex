import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createAmgenManualWorkdaySourceFetch,validateStrictAmgenManualWorkdayEvidence} from '../src/crawler/amgenManualWorkdaySourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
import {WorkdayCooldownError} from '../src/crawler/workdayRequestPolicy.ts';
import {evaluatePaginationEvidence} from '../src/crawler/paginationEvidence.ts';

const at='2026-11-06T00:00:00.000Z',origin='https://careers.amgen.com',wd='https://amgen.wd1.myworkdayjobs.com',china='6cb77610a8a543aea2d6bc10457e35d4';
const rows=[1,2,3].map(i=>({id:String(1000+i),title:`Synthetic Role ${i}`,url:`${origin}/en/job/shanghai/role-${i}/87/${1000+i}`,req:`R-${i}`,path:`/job/Shanghai/Role_R-${i}`}));
function entry(pageRows=rows,page=1,total=pageRows.length){
 const totalPages=Math.max(1,Math.ceil(total/12));
 const attributes={'location':'China','location-type':'2','location-path':'1814991','organization-ids':'87','keywords':'','total-job-results':total,'total-pages':totalPages,'current-page':page,'records-per-page':'12','ajax-post-url':'/en/search-jobs/resultspost','show-radius':'False','latitude':'35','longitude':'105','sort-direction':'0','facet-type':'0'};
 return `<section id="search-filters" data-radius-unit-type="0"></section><section id="search-results" ${Object.entries(attributes).map(([k,v])=>`data-${k}="${v}"`).join(' ')}><ul id="search-results-jobs">${pageRows.map(row=>`<li><a data-job-id="${row.id}" href="${row.url}"><h3>${row.title}</h3></a><button class="js-save-job-btn" data-job-id="${row.id}" data-org-id="87"></button></li>`).join('')}</ul><nav class="pagination"><a class="next${page===totalPages?' disabled':''}" data-display-type="Jobs"></a></nav></section>`;
}
function identity(row){return `<link rel="canonical" href="${row.url}"><h1>${row.title}</h1><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:row.req,url:row.url,title:row.title,description:'Synthetic official description with enough complete content.',hiringOrganization:{name:'Amgen'},jobLocation:[{address:{addressCountry:'China',addressLocality:'Shanghai',addressRegion:'Shanghai'}}]})}</script>`;}
function application(row,mode){const country={id:china,descriptor:'China'};return JSON.stringify({userAuthenticated:false,jobPostingInfo:{jobReqId:mode==='wrong-id'&&row===rows[1]?'R-999':row.req,jobPostingId:row.path.split('/').at(-1),jobPostingSiteId:'Careers',externalUrl:`${wd}/Careers${row.path}`,title:row.title,posted:true,canApply:true,country,jobRequisitionLocation:{descriptor:'China - Shanghai',country:{...country,alpha2Code:'CN'}},location:'China - Shanghai',jobDescription:'Synthetic official description with enough complete content.'}});}
test('Amgen fails the source and retains the response when a required request fails', async (t) => {
 const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === 'source-amgen-china-social');
 const lookup = `${wd}/wday/cxs/amgen/Careers/jobs`;
 const firstApplication = `${wd}/wday/cxs/amgen/Careers${rows[0].path}`;
 const urls = [plan.source.officialEntryUrl, lookup, rows[0].url, firstApplication];
 for (const [failedAt, status] of [[0, 429], [1, 503], [1, 429], [3, 429]]) await t.test(`request ${failedAt + 1}, HTTP ${status}`, async () => {
  const body = `<html>Request failed with HTTP ${status}</html>`;
  const calls = [];
  const fetch = createAmgenManualWorkdaySourceFetch({now: () => new Date(at), http: async ({url}) => {
   calls.push(url);
   const meta = {finalUrl: url, capturedAt: at};
   if (url === urls[failedAt]) return {...meta, status, body, contentType: 'text/html', retryAfter: {value: '60', delayMs: 60000}};
   if (url === plan.source.officialEntryUrl) return {...meta, status: 200, body: entry(), contentType: 'text/html'};
   if (url === lookup) {
    const jobPostings = rows.map(row => ({title: row.title, externalPath: row.path, locationsText: 'China - Shanghai', bulletFields: [row.req]}));
    const facets = [{facetParameter: 'LocationCountry', values: [{id: china, descriptor: 'China', count: rows.length}]}];
    return {...meta, status: 200, body: JSON.stringify({total: rows.length, jobPostings, facets}), contentType: 'application/json'};
   }
   if (url === rows[0].url) return {...meta, status: 200, body: identity(rows[0]), contentType: 'text/html'};
   assert.fail(`Unexpected request: ${url}`);
  }});
  const result = await fetch(plan);
  assert.equal(result.ok, false);
  assert.deepEqual(result.transportFailure, {code: `OFFICIAL_HTTP_${status}`, retryable: true, retryAfterMs: 60000, stage: failedAt === 0 ? 'ENTRY' : failedAt === 1 ? 'FACET_COUNTRY' : 'PAGE'});
  assert.deepEqual(calls, urls.slice(0, failedAt + 1));
  assert.ok(result.fetchEvidence, 'Failed response must be retained as evidence');
  if (failedAt === 0) {
   assert.ok(result.fetchEvidence.supportingArtifactOnlyFailure);
   assert.equal(result.fetchEvidence.pages.length, 0);
  } else {
   assert.equal(result.fetchEvidence.supportingArtifactOnlyFailure, undefined);
   assert.equal(result.fetchEvidence.pages.length, 1);
   assert.equal(result.fetchEvidence.declaredCompleteness, undefined);
   assert.equal(result.fetchEvidence.pages[0].declaredTotal, rows.length);
   assert.deepEqual(result.fetchEvidence.fetchCounts, {rawCount: 3, parsedCount: 3, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 3});
   assert.equal(result.fetchEvidence.fetchLosses.length, rows.length);
   assert.equal(validateStrictAmgenManualWorkdayEvidence(plan, result.fetchEvidence, []), false);
  }
  const response = result.fetchEvidence.artifacts.at(-1);
  assert.equal(response.httpStatus, status);
  assert.equal(response.body, body);
 });
});

test('Amgen exposes a closed 4-page discovery after a supplemental lookup fails without admitting jobs', async (t) => {
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-amgen-china-social');
 const inventory=Array.from({length:48},(_,i)=>({id:String(2000+i),title:`Synthetic Discovery ${i}`,url:`${origin}/en/job/shanghai/discovery-${i}/87/${2000+i}`}));
 for(const mode of ['429','cooldown','network','partial-page','duplicate-id','changed-total'])await t.test(mode,async()=>{
  const calls=[];
  const fetch=createAmgenManualWorkdaySourceFetch({now:()=>new Date(at),http:async(request)=>{
   calls.push(request);
   const meta={finalUrl:request.url,capturedAt:at};
   if(request.url.endsWith('/jobs')){
    if(mode==='cooldown')throw new WorkdayCooldownError(429,60000);
    if(mode==='network')throw Object.assign(Error('Synthetic reset'),{code:'ECONNRESET'});
    return {...meta,status:429,body:'Synthetic rate limit',contentType:'text/html',retryAfter:{value:'60',delayMs:60000}};
   }
   const page=request.body?JSON.parse(request.body).CurrentPage:1;
   if(mode==='partial-page'&&page===2)return {...meta,status:429,body:'Synthetic rate limit',contentType:'text/html'};
   const pageRows=inventory.slice((page-1)*12,page*12);
   if(mode==='duplicate-id'&&page===2)pageRows[0]=inventory[0];
   const html=entry(pageRows,page,mode==='changed-total'&&page===2?47:48);
   return {...meta,status:200,body:page===1?html:JSON.stringify({results:html}),contentType:page===1?'text/html':'application/json'};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.status,'FAILED');
  assert.deepEqual(result.truth,{transportSuccess:false,adapterSuccess:false,completenessVerified:false});
  assert.equal(result.jobs.length,0);
  const evidence=result.fetchEvidence;
  if(['partial-page','duplicate-id','changed-total'].includes(mode)){
   assert.equal(calls.some(request=>request.url.endsWith('/jobs')),false);
   assert.equal(evidence.supportingArtifactOnlyFailure.code,'AMGEN_MANUAL_WORKDAY_INVALID');
   assert.equal(evidence.pages.length,0);
   assert.equal(evidence.fetchCounts.rawCount,0);
   assert.equal(evidence.declaredCompleteness,undefined);
   if(mode==='partial-page')assert.equal(result.transportFailure.stage,'PAGE');
   return;
  }
  assert.equal(calls.length,5);
  assert.deepEqual(evidence.fetchCounts,{rawCount:48,parsedCount:48,validCount:0,parseDiscardCount:0,validationDiscardCount:48});
  assert.equal(evidence.pages.length,4);
  assert.equal(evidence.pages.at(-1).termination,'NEXT_ABSENT');
  assert.equal(new Set(evidence.pages.flatMap(page=>page.rawJobIds)).size,48);
  assert.equal(evidence.pages.flatMap(page=>page.validJobIds).length,0);
  assert.equal(evidence.fetchLosses.length,48);
  assert.equal(evidence.jobQuarantines,undefined);
  assert.equal(evidence.pages.every(page=>page.declaredTotal===48&&page.declaredPages===4),true);
  assert.equal(result.observation.expectedJobCount,undefined);
  assert.equal(result.transportFailure.stage,'FACET_COUNTRY');
  assert.equal(result.transportFailure.code,mode==='network'?'OFFICIAL_NETWORK_ERROR':mode==='cooldown'?'OFFICIAL_REQUEST_DEFERRED':'OFFICIAL_HTTP_429');
  assert.equal(evidence.artifacts.length,mode==='429'?5:4);
  assert.equal(validateStrictAmgenManualWorkdayEvidence(plan,evidence,[]),false);
  assert.equal(evaluatePaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true,allowPositiveOfficialTotalCountAfterAdapterReconciliation:true,allowIndependentlyVerifiedProfileBoundExclusions:true}).verifiedEligible,false);
 });
});

test('Amgen retains a complete manual list and isolates individual identity/application failures',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-amgen-china-social');
 for(const mode of ['good','503','429','wrong-id','transport','bad-list-title']){
  const calls=[];
  const fetch=createAmgenManualWorkdaySourceFetch({now:()=>new Date(at),http:async({url})=>{
   calls.push(url);let body,contentType='application/json',status=200;
   if(url===plan.source.officialEntryUrl){body=mode==='bad-list-title'?entry().replace(`<h3>${rows[1].title}</h3>`,'<h3></h3>'):entry();contentType='text/html';}
   else if(url.endsWith('/jobs'))body=JSON.stringify({total:3,jobPostings:rows.map(r=>({title:r.title,externalPath:r.path,locationsText:'China - Shanghai',bulletFields:[r.req]})),facets:[{facetParameter:'LocationCountry',values:[{id:china,descriptor:'China',count:3}]}]});
   else{const row=rows.find(r=>r.url===url||url.endsWith(r.path));assert.ok(row,url);
    if(url===row.url){body=identity(row);contentType='text/html';}
    else{if(row===rows[1]&&mode==='transport')throw Error('Synthetic unavailable');if(row===rows[1]&&['503','429'].includes(mode))status=Number(mode);body=status===200?application(row,mode):'Synthetic unavailable';}
   }
   return {status,body,finalUrl:url,contentType,capturedAt:at};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(result.jobs.length,mode==='good'?3:mode==='429'?1:2,mode);
  if(mode!=='good'){assert.equal(result.fetchEvidence.jobQuarantines.length,mode==='429'?2:1);const changed=structuredClone(result.fetchEvidence);changed.jobQuarantines[0].code='FABRICATED';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:changed,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
  if(mode==='429')assert.equal(calls.some(url=>url===rows[2].url),false);
 }
});
