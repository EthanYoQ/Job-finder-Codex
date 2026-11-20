import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAbbvieChinaRowScope,reviewedAbbvieCity} from '../src/crawler/abbvieChinaRowScope.ts';
import {htmlTableAdapter} from '../src/crawler/adapters/htmlTable.ts';
import {profile_abbvie_china} from '../src/crawler/companyRecruitmentProfiles/profiles/abbvie-china.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createHttpHtmlSourceFetch} from '../src/crawler/httpHtmlSourceFetch.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {runWithOfficialSourceCancellation} from '../src/crawler/officialHttpRuntimeLimits.ts';

const row=(location,option)=>`<div class="attrax-vacancy-tile">
<a class="attrax-vacancy-tile__title" href="/zh-hans/job/test-jid-123">Test role</a>
<div class="attrax-vacancy-tile__location-freetext"><span class="attrax-vacancy-tile__item-value">${location}</span></div>
<div class="attrax-vacancy-tile__option-location attrax-vacancy-tile__option-location--${option.toLowerCase()}"><span class="attrax-vacancy-tile__item-value">${option}</span></div>
<div class="attrax-vacancy-tile__option-job-type"><span class="attrax-vacancy-tile__item-value">Full-time</span></div>
<span class="attrax-vacancy-tile__expiry-value">01/01/0001</span></div>`;
const extract=html=>htmlTableAdapter.extract({html,table:profile_abbvie_china.sources[0].executionConfig.table,
 company:{id:'company-abbvie-china',officialChineseName:'艾伯维'},
 source:{id:'source-abbvie-china-social',companyId:'company-abbvie-china',kind:'SOCIAL',atsKind:'OFFICIAL_HTML',status:'VERIFIED',officialEntryUrl:'https://careers.abbvie.com/zh-hans/jobs'},
 capturedAt:'2026-11-02T05:03:00.000Z'});

test('official Guangdong province-only location preserves raw geography and has no invented city',()=>{
 const html=row('Guangdong, GD','Guangdong');
 assert.equal(validateAbbvieChinaRowScope(html),true);
 assert.equal(reviewedAbbvieCity('Guangdong, GD'),undefined);
 const result=extract(html);
 assert.equal(result.jobs.length,1);
 assert.equal(result.jobs[0].locationRaw,'Guangdong, GD');
 assert.deepEqual(result.jobs[0].cities,[CITY_PENDING]);
});
test('city rows retain their city beside a province-only row',()=>{
 const html=row('Guangdong, GD','Guangdong')+row('Shanghai, Shanghai','Shanghai').replaceAll('jid-123','jid-124');
 assert.equal(validateAbbvieChinaRowScope(html),true);
 assert.deepEqual(extract(html).jobs.map(j=>j.cities),[[CITY_PENDING],['上海']]);
});

test('null optional JSON-LD country does not abort an otherwise proven mainland row',()=>{
 const html=row('Shanghai, Shanghai','China').replace('</div>',`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',jobLocation:{address:{addressCountry:null}}})}</script></div>`);
 assert.equal(validateAbbvieChinaRowScope(html),true);
 assert.equal(extract(html).jobs.length,1);
});
test('unproven and foreign locations remain outside the accepted scope',()=>{
 for(const [location,option] of [['Guangdong, XX','Guangdong'],['Guangdong, GD','Hong Kong'],['Hong Kong, HK','Hong Kong'],['Taipei, Taiwan','Taipei'],['Unknown, GD','Unknown'],['Taipei, Henan','China']])
  assert.equal(validateAbbvieChinaRowScope(row(location,option)),false,location+' / '+option);
});
test('optional display labels and domestic disagreement do not invalidate China scope',()=>{
 for(const location of ['Beijing, Guangdong Province','Newtown, Unknown']){
  const html=row(location,'China').replace('Full-time','Part-time').replace('01/01/0001','Tomorrow').replace('attrax-vacancy-tile__option-location--china','attrax-vacancy-tile__option-location--new');
  assert(validateAbbvieChinaRowScope(html));assert.deepEqual(extract(html).jobs[0].cities,[CITY_PENDING]);
 }
 const conflict=row('Shanghai, Shanghai','Beijing');assert(validateAbbvieChinaRowScope(conflict));assert.deepEqual(extract(conflict).jobs[0].cities,[CITY_PENDING]);
 const foreign=row('Shanghai, Shanghai','China').replace('</div>',`<script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',jobLocation:{address:{addressCountry:'Singapore'}}})}</script></div>`);
 assert.equal(validateAbbvieChinaRowScope(foreign),false);
 assert.equal(validateAbbvieChinaRowScope(row('Shanghai, Shanghai','China').replace('class="attrax-vacancy-tile"','class="attrax-vacancy-tile" data-location="Singapore"')),false);
});
test('official mainland province admits new city labels without inventing a city',()=>{
 for(const [location,option,city] of [['Puyang, Henan','China','濮阳'],['Deyang, Sichuan','Sichuan','德阳'],['Tongren, Guizhou','China',CITY_PENDING],['Sanya, Hainan','China',CITY_PENDING]]){
  const html=row(location,option);assert.equal(validateAbbvieChinaRowScope(html),true);
  const result=extract(html);assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].locationRaw,location);
  assert.deepEqual(result.jobs[0].cities,[city]);
 }
});
test('AbbVie follows eleven declared official pages and still rejects a duplicate row',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-abbvie-china-social');
 async function capture(duplicate){
  const seen=[];const fetch=createHttpHtmlSourceFetch({http:async({url})=>{
   const page=Number(new URL(url).searchParams.get('page')??1);seen.push(page);
   const html=`<span class="attrax-pagination__results-of--2" data-total-pages="11"></span><span class="attrax-pagination__total-results">11</span>`+row('Newtown, Henan','China').replaceAll('jid-123',`jid-${duplicate?123:123+page}`);
   return {status:200,body:html,finalUrl:url,contentType:'text/html',capturedAt:new Date().toISOString()};
  }});
  return {result:await runSourceCrawl(plan,{fetch,isBaseline:false}),seen};
 }
 const ok=await capture(false);assert.equal(ok.result.status,'SUCCESS',JSON.stringify(ok.result.diagnostics));assert.equal(ok.result.jobs.length,11);assert.equal(ok.seen.length,11);
 const duplicate=await capture(true);assert.notEqual(duplicate.result.status,'SUCCESS');
});

test('an exhausted source budget stops a huge declared traversal without dispatching more pages',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-abbvie-china-social');
 const controller=new AbortController(),seen=[];
 const fetch=createHttpHtmlSourceFetch({http:async({url})=>{
  const page=Number(new URL(url).searchParams.get('page')??1);seen.push(page);
  if(page===2)controller.abort(Error('source attempt budget exhausted'));
  return {status:200,body:`<span class="attrax-pagination__results-of--2" data-total-pages="1000000"></span>`+row('Shanghai, Shanghai','China'),finalUrl:url,contentType:'text/html',capturedAt:new Date().toISOString()};
 }});
 const result=await runWithOfficialSourceCancellation(controller.signal,()=>fetch(plan));
 assert.equal(result.ok,false);assert.deepEqual(seen,[1,2]);
 assert.equal(result.fetchEvidence.artifacts.length,2);
});
