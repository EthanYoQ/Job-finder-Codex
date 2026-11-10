import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {acquireNovartisNativePartitions,replayNovartisNativePartitions} from '../src/crawler/novartisNativePartitions.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';
import {legacySortEvidence} from './novartis-legacy-fixture.mjs';
test('native date sorting preserves coverage, historical replay and unknown-detail accounting',async()=>{
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-novartis-social');
// The live form, including a new category, owns partition discovery.
const fields=['QA','SA','DD','NEW'].map(x=>'FCT_'+x);
const url=(id)=>`https://www.novartis.com.cn/careers/career-search/job/details/${id.toLowerCase()}-test`;
const row=(id)=>`<tr><td class="views-field-field-job-title"><a href="${url(id)}">Job ${id}</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`;
const page=(ids,n=ids.length)=>`<div class="view-header">Showing ${n} results</div><table class="views-table"><tbody>${ids.length?ids.map(row).join(''):'<tr><td colspan="5" class="empty message">No content has been found.</td></tr>'}</tbody></table>`;
const root=page([],2)+`<select name="functional_area[]">${fields.map(v=>`<option value="${v}">${v}</option>`).join('')}</select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>`;
const ids=['REQ-10000001','REQ-10000002','REQ-10000003'];
async function capture(mode='present',location='Shanghai (Shanghai)',alternative='',primaryCountry='China'){
 const at=new Date().toISOString();const requests=[];
 const fetched=await acquireNovartisNativePartitions(plan,async req=>{requests.push(req.url);const u=new URL(req.url),field=u.searchParams.get('functional_area[0]');
 if(field)assert.equal(u.searchParams.get('order'),'发布日期');
 let html=req.url===plan.source.officialEntryUrl?root:field?page(field==='FCT_QA'?[ids[0]]:field==='FCT_SA'?[ids[1]]:[]):page(ids);
 if(field==='FCT_SA'&&['duplicate-page','changing-total'].includes(mode)){
  const p=Number(u.searchParams.get('page')??0),ten=Array.from({length:10},(_,i)=>`REQ-${10000010+i}`),next=new URL(u);next.searchParams.set('page','1');
  html=page(p?(mode==='duplicate-page'?[ten[0]]:['REQ-10000020','REQ-10000021']):ten,p&&mode==='changing-total'?12:11)+
   `<div class="pagination"><span class="active"><a class="page-link" title="page ${p+1} out of 2 pages"></a></span><a rel="next" ${p?'class="disabled"':`href="${next.href}"`}></a></div>`;
 }
 if(u.pathname.includes('/job/details/'))html=`<h1>Job ${ids[2]}</h1><article>Job ID ${ids[2]}<p>${mode==='closed'?'This job is no longer available':'A real substantive job description for this identity.'}</p>${mode==='present'?`<a href="https://platform.moseeker.com/m/customize/page/novartis?job_number=${ids[2]}">Apply to Job</a>`:''}</article>`;
 return {status:200,body:html.replaceAll('views-field-field-job-country">China</td>',`views-field-field-job-country">${primaryCountry}${alternative?`<div class="alternative-locations">${alternative}</div>`:''}</td>`).replaceAll('Shanghai (Shanghai)',location),finalUrl:req.url,contentType:'text/html',capturedAt:at};});return {fetched,at,requests};
}
const c=await capture();if(!c.fetched.ok)console.log(c.fetched.failureReason,c.fetched.fetchEvidence?.artifacts.map(a=>a.logicalKey));assert(c.fetched.ok);assert.equal(c.fetched.fetchEvidence.fetchCounts.validCount,3);
const e=c.fetched.fetchEvidence;const audit=replayNovartisNativePartitions(plan,e).audit;assert.equal(audit.indexDeclaredTotal,2);assert.equal(audit.observedUniqueCount,3);assert(!c.requests.some(u=>u.includes('moseeker')));
assert.equal(e.captureTool.version,'10');
const version9=structuredClone(e);version9.captureTool.version='9';assert.equal(replayNovartisNativePartitions(plan,version9).audit.observedUniqueCount,3);
const siteLegacy=legacySortEvidence(e,'5','站点');
assert.equal(replayNovartisNativePartitions(plan,siteLegacy).audit.observedUniqueCount,3);
assert.equal(replayNovartisNativePartitions(plan,legacySortEvidence(e,'7','站点')).audit.observedUniqueCount,3);
const legacy=structuredClone(e);legacy.captureTool.version='4';
assert.throws(()=>replayNovartisNativePartitions(plan,legacy),'Version 4 remains bound to title ordering');
const titleLegacy=legacySortEvidence(e,'4','职位名称');
assert.equal(replayNovartisNativePartitions(plan,titleLegacy).audit.observedUniqueCount,3);
titleLegacy.captureTool.version='5';
assert.throws(()=>replayNovartisNativePartitions(plan,titleLegacy),'Version 5 remains bound to site ordering');
for(const mode of ['duplicate-page','changing-total'])assert.equal((await capture(mode)).fetched.ok,false,mode);
assert(c.requests.some(url=>new URL(url).searchParams.get('functional_area[0]')==='FCT_NEW'));
for(const [name,mutate] of [
 ['missing partition',(x)=>{x.artifacts=x.artifacts.filter((a)=>a.logicalKey!=='novartis-partition-FCT_DD-0')}],
 ['fake index total',(x)=>{x.artifacts[0].body=x.artifacts[0].body.replace('Showing 2','Showing 3')}],
 ['scope changed',(x)=>{x.artifacts.find((a)=>a.logicalKey==='novartis-partition-FCT_QA-0').finalUrl='https://www.novartis.com.cn/careers/career-search'}],
 ['apply identity changed',(x)=>{const a=x.artifacts.find((a)=>a.logicalKey.includes('detail-'));a.body=a.body.replace('job_number=REQ-10000003','job_number=REQ-10000099')}],
 ['ledger forged',(x)=>{x.fetchCounts.validCount=2}]
]){const x=structuredClone(e);mutate(x);assert.throws(()=>replayNovartisNativePartitions(plan,x));}
const unknownCapture=await capture('unknown');assert(unknownCapture.fetched.ok);assert.equal(replayNovartisNativePartitions(plan,unknownCapture.fetched.fetchEvidence).audit.noOmissionVerified,false);const closed=await capture('closed');assert(closed.fetched.ok);assert.equal(closed.fetched.fetchEvidence.fetchCounts.validCount,2);
for(const [location,city] of [['Shanghai (Shanghai)','上海'],['Newtown (Qinghai)',CITY_PENDING]]){
 const next=await capture('present',location);
 const result=await runSourceCrawl(plan,{fetch:async()=>next.fetched,isBaseline:false});
 assert.equal(result.status,'SUCCESS',JSON.stringify(result.diagnostics));
 assert.equal(result.observation.completenessStatus,'VERIFIED');
 assert(result.jobs.every(j=>j.locationRaw===location&&j.cities.length===1&&j.cities[0]===city));
}
for(const location of ['Taipei','臺灣','Amsterdam, Netherlands']){const held=await capture('present',location);assert(held.fetched.ok);assert.equal(held.fetched.fetchEvidence.fetchCounts.validCount,0);assert.equal(held.fetched.fetchEvidence.jobQuarantines.length,2);}
for(const alternative of ['China','Japan','Hong Kong','China / Japan']){
 const next=await capture('present','Shanghai (Shanghai)',alternative);assert(next.fetched.ok);
 assert(next.fetched.html.includes(`<div class="alternative-locations">${alternative}</div>`),'Retain the official alternative placements');
 assert(next.fetched.fetchEvidence.artifacts.some(a=>typeof a.body==='string'&&a.body.includes(alternative)));
 const result=await runSourceCrawl(plan,{fetch:async()=>next.fetched,isBaseline:false});
 assert.equal(result.status,'SUCCESS',JSON.stringify(result.diagnostics));
 assert(result.jobs.every(job=>job.locationRaw==='Shanghai (Shanghai)'&&job.cities.join(',')==='上海'));
}
const foreign=await capture('present','Shanghai (Shanghai)','China','Japan');assert(foreign.fetched.ok);assert.equal(foreign.fetched.fetchEvidence.fetchCounts.validCount,0);

});

test('archived default discovery exhaustion keeps closed partitions and marks absent jobs unknown',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/novartis-default-exhausted-page.json',import.meta.url),'utf8'));
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-novartis-social');
 const originalPlan=JSON.stringify(plan),id='REQ-10000001';
 const row=`<tr><td class="views-field-field-job-title"><a href="/careers/career-search/job/details/${id.toLowerCase()}-synthetic">Synthetic role</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`;
 const list=(count=1)=>`<div class="view-header">Showing ${count} results</div><table class="views-table"><tbody>${row}</tbody></table>`;
 const root=list()+'<select name="functional_area[]"><option value="FCT_QA">QA</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>';
 async function capture(mode='good'){
  const calls=[];
  const fetched=await acquireNovartisNativePartitions(plan,async request=>{
   calls.push(request.url);const u=new URL(request.url),page=Number(u.searchParams.get('page')??0),partition=u.searchParams.has('functional_area[0]');
   let html,finalUrl=request.url;
   if(request.url===plan.source.officialEntryUrl)html=root;
   else if(partition)html=mode==='primary-empty'?fixture.html:list(mode==='primary-missing'?2:1);
   else if(page===fixture.requestedPageIndex||mode==='first-empty'){
    html=fixture.html;
    if(mode==='in-range')html=html.replace('Showing 458 results','Showing 468 results');
    if(mode==='wrong-active')html=html.replace('page 46 活跃','page 47 活跃');
    if(mode==='next-enabled')html=html.replace('page-link btn disabled','page-link btn');
    if(mode==='nonempty-next')html=html.replace('href="" title="转到下一页"','href="?page=47" title="转到下一页"');
    if(mode==='wrong-scope'){const changed=new URL(request.url);changed.searchParams.set('country[]','LOC_JP');finalUrl=changed.href;}
   }else{
    // Synthetic earlier pages exercise the real native Next chain; only the final fragment is archived evidence.
    const next=new URL(u);next.searchParams.set('page',String(page+1));
    html=list(463)+`<nav class="pagination"><li class="active"><span class="page-link" title="page ${page+1} 活跃 out of 47 pages"></span></li><a rel="next" href="${next.href}">Next</a></nav>`;
   }
   return {status:200,contentType:'text/html',body:html,finalUrl,capturedAt:fixture.capturedAt+'Z'};
  });
  return {fetched,calls};
 }
 const {fetched,calls}=await capture();
 assert.equal(fetched.ok,true,fetched.failureReason);
 assert.equal(calls.length,49,'Root, one closed primary partition and 47 existing default pages; no extra requests');
 const projected=replayNovartisNativePartitions(plan,fetched.fetchEvidence);
 assert.equal(fetched.fetchEvidence.captureTool.version,'10');
 assert.equal(projected.counts.validCount,1);assert.equal(projected.unboundUnknown,true);
 assert.equal(projected.audit.noOmissionVerified,false);
 assert.ok(projected.audit.anomalyCodes.includes('NOVARTIS_DEFAULT_DISCOVERY_EXHAUSTED'));
 assert.equal(projected.audit.partitions[0].uniqueCount,1);
 const last=fetched.fetchEvidence.artifacts.find(a=>a.logicalKey==='novartis-partitions-default-46');
 assert.equal(last.body,fixture.html,'Keep the archived fragment unchanged');
 for(const version of ['4','5','6','7','8','9']){
  const legacy=structuredClone(fetched.fetchEvidence);legacy.captureTool.version=version;
  assert.throws(()=>replayNovartisNativePartitions(plan,legacy));
 }
 for(const mode of ['in-range','wrong-active','next-enabled','nonempty-next','wrong-scope','first-empty','primary-empty','primary-missing']){
  const bad=await capture(mode);assert.equal(bad.fetched.ok,false,mode);
 }
 assert.equal(JSON.stringify(plan),originalPlan,'The configured source plan stays unchanged');
});
