import test from 'node:test';
import assert from 'node:assert/strict';
import {bmsMainlandCities} from '../src/crawler/bmsMainlandGeography.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createHttpHtmlSourceFetch} from '../src/crawler/httpHtmlSourceFetch.ts';
import {validateStrictHtmlCompletenessProof} from '../src/crawler/strictHtmlCompletenessProof.ts';
import {createHash} from 'node:crypto';
import {createAmgenRadancySourceFetch} from '../src/crawler/amgenRadancySourceFetch.ts';
import {AMGEN_NATIVE_ENTRY} from '../src/crawler/amgenNativeSourceFetch.ts';

test('BMS mainland location formatting is not an admission whitelist',()=>{
 for(const standardized of ['Tianjin,CN','Tianjin, CN','Tianjin,Tianjin,CN'])
  assert.deepEqual(bmsMainlandCities({locations:['Tianjin - CN'],standardizedLocations:[standardized]}),['天津']);
 assert.deepEqual(bmsMainlandCities({locations:['Newtown - CN'],standardizedLocations:['Newtown,CN']}),[CITY_PENDING]);
 assert.deepEqual(bmsMainlandCities({locations:['Field - China'],standardizedLocations:['CN']}),[CITY_PENDING]);
 for(const [location,standardized,city] of [['Huhehaote - CN','Hohhot, Inner Mongolia, CN','呼和浩特'],['Zibo - CN','Zibo, Shandong, CN','淄博']])
  assert.deepEqual(bmsMainlandCities({locations:[location],standardizedLocations:[standardized]}),[city]);
 assert.deepEqual(bmsMainlandCities({locations:['Shanghai - CN'],standardizedLocations:['Beijing,CN']}),[CITY_PENDING]);
 for(const [location,standardized] of [['Tokyo','Tokyo,JP'],['Tokyo - CN','Tokyo,CN'],['Hong Kong','Hong Kong,CN'],['Tianjin','Tianjin'],['Tianjin','Tianjin,US']])
  assert.equal(bmsMainlandCities({locations:[location],standardizedLocations:[standardized]}),undefined);
});

test('Amgen keeps same-ID jobs on official Radancy portal with zero Workday HTTP requests',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-amgen-china-social');
 const title='Biopharmaceutical Rep-Lianyungang',updated='Sr '+title,req='R-256178';
 const native='https://careers.amgen.com/en/job/lianyungang/role/87/123';
 const external='/job/China---Lianyungang/Biopharmaceutical-Rep-Lianyungang_R-256178-1';
 const application='https://amgen.wd1.myworkdayjobs.com/Careers'+external;
 const description='<p>Official complete responsibilities and qualifications.</p>';
 const list=(rowTitle)=>`<div id="search-filters" data-radius-unit-type="0"></div><section id="search-results" data-location="China" data-location-type="2" data-location-path="1814991" data-organization-ids="87" data-keywords="" data-total-job-results="1" data-total-pages="1" data-current-page="1" data-records-per-page="12" data-ajax-post-url="/en/search-jobs/resultspost" data-show-radius="False" data-latitude="35" data-longitude="105" data-facet-type="0" data-sort-direction="0"><ul id="search-results-jobs"><li><a data-job-id="123" href="${native}"><h3>${rowTitle}</h3></a><button class="js-save-job-btn" data-job-id="123" data-org-id="87"></button></li></ul><div class="pagination"><a class="next disabled" data-display-type="Jobs"></a></div></section>`;
 async function capture({rowTitle=updated,reqId=req,applyUrl=`${application}/apply`,country='China'}={}){
  const seen=[];
  const schema={'@type':'JobPosting',url:native,title:rowTitle,identifier:reqId,hiringOrganization:{name:'Amgen'},description,jobLocation:[{address:{addressCountry:country,addressLocality:'Lianyungang',addressRegion:'Jiangsu'}}]};
  const detail=`<link rel="canonical" href="${native}"><h1>${rowTitle}</h1>${applyUrl?`<a class="job-apply" data-apply-url="${applyUrl}">Apply</a>`:''}<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
  const fetch=createAmgenRadancySourceFetch({http:async request=>{
   seen.push(request.url);
   assert.ok(!request.url.includes('myworkdayjobs.com'),`Unexpected Workday request: ${request.url}`);
   return {status:200,body:request.url===AMGEN_NATIVE_ENTRY?list(rowTitle):detail,finalUrl:request.url,contentType:'text/html',capturedAt:new Date().toISOString()};
  }});
  return {result:await fetch(plan),seen};
 }
 const {result,seen}=await capture();assert.equal(result.ok,true,result.failureReason);
 assert.equal(seen.length,2);
 assert.equal(result.payload.jobPostings[0].title,updated);
 assert.equal(result.payload.jobPostings[0].officialUrl,application);
 assert.equal(result.payload.jobPostings[0].sourceJobId,`workday:sha256:${createHash('sha256').update(external).digest('hex')}`);
 assert.deepEqual(result.payload.jobPostings[0].cities,['连云港']);
 for(const delta of [{reqId:'R-999'},{applyUrl:''},{country:'Japan'}]){
  const bad=await capture(delta);
  assert.equal(bad.result.ok,true);
  assert.equal(bad.result.payload.jobPostings.length,0);
  assert.equal(bad.result.fetchEvidence.jobQuarantines.length,1);
 }
});

test('AstraZeneca follows the official page total past the historical 25-page cap',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astrazeneca-social');
 async function capture(duplicate){
  const seen=[];
  const fetch=createHttpHtmlSourceFetch({http:async({url})=>{
   const page=Number(new URL(url).searchParams.get('p'));seen.push(page);
   const id=duplicate?1:page;
   const body=`<div id="search-results" data-total-pages="28" data-total-job-results="28"></div><div id="search-results-list"><li><a class="search-results-link" data-job-id="${id}" href="/job/shanghai/role/${id}"><h2>Role ${id}</h2></a><span class="job-location">Shanghai, China</span></li></div>`;
   return {status:200,body,finalUrl:url,contentType:'text/html',capturedAt:new Date().toISOString()};
  }});
  return {result:await fetch(plan),seen};
 }
 const {result,seen}=await capture(false);
 assert.equal(result.ok,true,result.failureReason);assert.equal(seen.length,28);assert.equal(seen.at(-1),28);
 assert.equal(result.paginationEvaluation.safeCompleteness,true);
 assert.equal(validateStrictHtmlCompletenessProof(plan,result.fetchEvidence),true);
 const duplicate=await capture(true);assert.equal(duplicate.result.ok,false);
});
