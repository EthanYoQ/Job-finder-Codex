import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {acquireNovartisNativePartitions,replayNovartisNativePartitions} from '../src/crawler/novartisNativePartitions.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {legacySortEvidence} from './novartis-legacy-fixture.mjs';

const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-novartis-social');
const ids=Array.from({length:12},(_,i)=>`REQ-${10000000+i}`);
const detail=id=>`https://www.novartis.com.cn/careers/career-search/job/details/${id.toLowerCase()}-test`;
const row=id=>`<tr><td class="views-field-field-job-title"><a href="${detail(id)}">Job ${id}</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`;
function page(url,rows,total,p,advertise=true){
 const next=new URL(url);next.searchParams.set('page','1');const reverse=new URL(url);reverse.searchParams.delete('page');reverse.searchParams.set('sort','desc');
 return `<div class="view-header">Showing ${total} results</div><table class="views-table">${advertise?`<thead><tr><th><a href="${reverse.href}">Site</a></th></tr></thead>`:''}<tbody>${rows.map(row).join('')}</tbody></table><div class="pagination"><span class="active"><a class="page-link" title="page ${p+1} out of 2 pages"></a></span><a rel="next" ${p?'class="disabled"':`href="${next.href}"`}></a></div>`;
}
async function capture(mode='complete'){
 const at=new Date().toISOString(),requests=[];
 const fetched=await acquireNovartisNativePartitions(plan,async req=>{
  requests.push(req.url);const u=new URL(req.url),field=u.searchParams.get('functional_area[0]'),reverse=u.searchParams.get('sort')==='desc',p=Number(u.searchParams.get('page')??0);
  const extra=mode.startsWith('ascending-only'),ordered=extra?ids.slice(1):ids.slice(0,11);
  let html;
  if(req.url===plan.source.officialEntryUrl)html=`<div class="view-header">Showing 11 results</div><select name="functional_area[]"><option value="FCT_RD">Research</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>`;
  else if(u.pathname.includes('/job/details/'))html=`<h1>Job ${ids[0]}</h1><article>Job ID ${ids[0]}<p>A current description for this official job.</p>${mode==='ascending-only-unknown'?'':`<a href="https://platform.moseeker.com/m/customize/page/novartis?job_number=${ids[0]}">Apply to Job</a>`}</article>`;
  else if(field&&!reverse){const rows=p?[mode==='date-complete'?ids[10]:ids[0]]:ids.slice(0,10);html=page(req.url,rows,11,p,mode!=='no-native-reverse');}
  else {const changedSlug=!field&&mode==='ascending-only-new-slug',values=changedSlug?ids:ordered;const rows=p?(mode==='reverse-changing-total'||changedSlug?ids.slice(10,12):[values[10]]):values.slice(0,10);html=page(req.url,mode==='reverse-overlap'&&p?[ordered[0]]:rows,changedSlug||reverse&&p&&mode==='reverse-changing-total'?12:11,p);if(changedSlug)html=html.replaceAll(`${ids[0].toLowerCase()}-test`,`${ids[0].toLowerCase()}-updated`);}
  if(!field&&p&&mode==='default-known-slug')html=page(req.url,[ids[0]],11,p).replace(detail(ids[0]),detail(ids[0]).replace('-test','-updated'));
  if(field&&reverse&&mode==='foreign')html=html.replaceAll('>China</td>','>Japan</td>');
  return {status:field&&reverse&&mode==='blocked'?403:200,body:html,finalUrl:req.url,contentType:'text/html',capturedAt:at};
 });return {fetched,requests};
}

test('November 13 market pages recover through the native site sort', async () => {
 const fixture = JSON.parse(await readFile(new URL('./fixtures/novartis-marketing-site-order.json', import.meta.url), 'utf8'));
 const first = fixture.site[0].url;
 const sourceRoot = '<div class="view-header">Showing 33 results</div><select name="functional_area[]"><option value="FCT_MM">Marketing</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>';
 const rows = fixture.site.flatMap(page => page.rows);
 const escape = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const render = r => `<tr><td class="views-field-field-job-title"><a href="${escape(r.url)}">${escape(r.title)}</a></td><td class="views-field-field-job-country">${escape(r.country)}</td><td class="views-field-field-job-work-location">${escape(r.location)}</td></tr>`;
 const seen = [];
 const fetched = await acquireNovartisNativePartitions(plan, async request => {
  seen.push(request.url);
  const u = new URL(request.url), n = Number(u.searchParams.get('page') ?? 0);
  const field = u.searchParams.get('functional_area[0]');
  const site = field && u.searchParams.get('order') === '站点';
  const reverse = u.searchParams.get('sort') === 'desc';
  let body = sourceRoot;
  if (request.url !== plan.source.officialEntryUrl) {
   const archived = fixture.failed.find(p => p.key === `novartis-partition-FCT_MM-${reverse?'reverse-':''}${n}.html`);
   const count = !field ? 33 : site ? fixture.site[n].total : archived.total;
   const markup = !field ? rows.slice(n*10,n*10+10).map(render) : site ? fixture.site[n].rows.map(render) : archived.ids.map(row);
   const next = new URL(u);next.searchParams.set('page',String(n+1));
   const reverseUrl = new URL(u);reverseUrl.searchParams.delete('page');reverseUrl.searchParams.set('sort','desc');
   const headers = field ? `<thead><tr><th><a href="${escape(reverseUrl.href)}">日期</a></th><th><a href="${escape(first)}">站点</a></th></tr></thead>` : '';
   body = `<div class="view-header">Showing ${count} results</div><table class="views-table">${headers}<tbody>${markup.join('')}</tbody></table><nav class="pagination"><span class="active"><a class="page-link" title="page ${n+1} out of 4 pages"></a></span><a rel="next" ${n===3?'class="disabled"':`href="${escape(next.href)}"`}></a></nav>`;
  }
  return {status:200,contentType:'text/html',body,finalUrl:request.url,capturedAt:fixture.site[0].capturedAt};
 });
 assert.equal(fetched.ok,true,fetched.failureReason);
 const evidence = fetched.fetchEvidence;
 const partition = replayNovartisNativePartitions(plan,evidence).audit.partitions[0];
 assert.equal(partition.selectedOrder,'站点');
 assert.equal(partition.uniqueCount,33);
 assert.equal(seen.filter(url => new URL(url).searchParams.has('functional_area[0]')).length,12);
 assert.equal(evidence.pages.filter(p => p.channelId==='novartis:FCT_MM').length,4);
});

test('a complete date-ascending list needs no reverse or title traversal',async()=>{
 const {fetched,requests}=await capture('date-complete');assert(fetched.ok,fetched.failureReason);
 const partitionRequests=requests.filter(url=>new URL(url).searchParams.has('functional_area[0]'));
 assert.equal(partitionRequests.length,2);
 assert(partitionRequests.every(url=>{const u=new URL(url);return u.searchParams.get('order')==='发布日期'&&u.searchParams.get('sort')==='asc';}));
 const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});assert.equal(result.truth.completenessVerified,true);assert.equal(result.jobs.length,11);
});

test('only an advertised, independently complete reverse traversal can replace overlapping pages',async()=>{
 const {fetched,requests}=await capture();assert(fetched.ok,fetched.failureReason);
 const evidence=fetched.fetchEvidence,projected=replayNovartisNativePartitions(plan,evidence);
 assert.equal(evidence.captureTool.version,'13');assert.equal(evidence.fetchCounts.validCount,11);
 const legacy=legacySortEvidence(evidence,'6','站点');assert.equal(replayNovartisNativePartitions(plan,legacy).counts.validCount,projected.counts.validCount);
 assert.equal(projected.audit.partitions[0].selectedSort,'desc');assert.equal(projected.audit.partitions[0].discardedAscending.unique,10);
 assert.equal(requests.filter(url=>new URL(url).searchParams.get('sort')==='desc').length,2);
 assert(evidence.artifacts.some(a=>a.logicalKey==='novartis-partition-FCT_RD-0'));
 assert(evidence.pages.every(p=>!p.artifactLogicalKey.startsWith('novartis-partition-FCT_RD-')||p.artifactLogicalKey.includes('-reverse-')));
 const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
 assert.equal(result.status,'SUCCESS',JSON.stringify(result.diagnostics));assert.equal(result.jobs.length,11);assert.equal(result.observation.completenessStatus,'VERIFIED');
 for(const mutate of [e=>{e.artifacts=e.artifacts.filter(a=>a.logicalKey!=='novartis-partition-FCT_RD-0')},e=>{delete e.artifacts.find(a=>a.logicalKey==='novartis-partition-FCT_RD-0').channelId},e=>{e.captureTool.version='5'},e=>{e.artifacts.find(a=>a.logicalKey==='novartis-partition-FCT_RD-reverse-0').finalUrl='https://www.novartis.com.cn/careers/career-search?country[]=LOC_JP'}]){
  const changed=structuredClone(evidence);mutate(changed);assert.throws(()=>replayNovartisNativePartitions(plan,changed));
 }
 const foreign=await capture('foreign');assert(foreign.fetched.ok);assert.equal(foreign.fetched.fetchEvidence.fetchCounts.validCount,0);assert.equal(foreign.fetched.fetchEvidence.jobQuarantines.length,11);
 for(const mode of ['no-native-reverse','reverse-overlap','reverse-changing-total','blocked']){
  const bad=await capture(mode);assert.equal(bad.fetched.ok,false,mode);
  if(mode==='no-native-reverse')assert(!bad.requests.some(url=>new URL(url).searchParams.get('sort')==='desc'));
 }
});

test('discovery pages cannot veto an already verified REQ for a changed slug',async()=>{
 const {fetched,requests}=await capture('default-known-slug');assert(fetched.ok,fetched.failureReason);
 const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
 assert.equal(result.truth.completenessVerified,true);assert.equal(result.jobs.length,11);
 assert.equal(requests.some(url=>url.includes('/job/details/')),false);
});

test('ascending-only sightings keep the existing same-ID detail and UNKNOWN paths',async()=>{
 for(const mode of ['ascending-only-present','ascending-only-unknown','ascending-only-new-slug']){
  const {fetched,requests}=await capture(mode);assert(fetched.ok,fetched.failureReason);
  assert(requests.includes(mode==='ascending-only-new-slug'?detail(ids[0]).replace('-test','-updated'):detail(ids[0])));
  const projected=replayNovartisNativePartitions(plan,fetched.fetchEvidence);
  assert.equal(projected.audit.additionalAscendingDiscoveryCount,mode==='ascending-only-new-slug'?undefined:1);
  assert.equal(projected.audit.defaultObservedUniqueCount,mode==='ascending-only-new-slug'?12:11);
  assert.equal(fetched.fetchEvidence.fetchCounts.validCount,mode==='ascending-only-unknown'?11:12);
  assert.equal(projected.unknownUrls.has(detail(ids[0])),mode==='ascending-only-unknown');
 }
});

test('Sales starts with title and tries each native date order at most once',async()=>{
 for(const mode of ['title-complete','date-complete','date-reverse-complete','title-only-unknown','all-overlap','title-missing-page','no-date-link','foreign-date-link','title-403','title-429','date-403','date-429']){
  const at=new Date().toISOString(),requests=[],unknown=mode==='title-only-unknown';
  const fetched=await acquireNovartisNativePartitions(plan,async req=>{
   requests.push(req.url);const u=new URL(req.url),field=u.searchParams.get('functional_area[0]'),p=Number(u.searchParams.get('page')??0),title=field&&u.searchParams.get('order')==='职位名称',reverse=u.searchParams.get('sort')==='desc';
   if(req.url===plan.source.officialEntryUrl)return {status:200,body:'<div class="view-header">Showing 11 results</div><select name="functional_area[]"><option value="FCT_SA">Sales</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>',finalUrl:req.url,contentType:'text/html',capturedAt:at};
   if(u.pathname.includes('/job/details/'))return {status:200,body:`<h1>Job ${ids[0]}</h1><article>Job ID ${ids[0]}<p>Current description without confirmed application status.</p></article>`,finalUrl:req.url,contentType:'text/html',capturedAt:at};
   const complete=!field||title&&mode==='title-complete'||field&&!title&&(reverse&&mode==='date-reverse-complete'||!reverse&&['date-complete','title-only-unknown'].includes(mode));
   const values=unknown&&!title?ids.slice(1):ids.slice(0,11),rows=p?[complete?values[10]:values[0]]:values.slice(0,10);
   let html=page(req.url,title&&p&&mode==='title-missing-page'?[]:rows,11,p);
   if(title&&mode!=='no-date-link'){
    const date=new URL(req.url);date.searchParams.delete('page');date.searchParams.set('order','发布日期');date.searchParams.set('sort','asc');if(mode==='foreign-date-link')date.searchParams.set('country[0]','LOC_JP');
    html=html.replace('</tr></thead>',`<th><a href="${date.href}">日期</a></th></tr></thead>`);
   }
   const blocked=field&&(title?mode.startsWith('title-'):mode.startsWith('date-'))&&/-(403|429)$/u.test(mode);
   return {status:blocked?Number(mode.slice(-3)):200,body:html,finalUrl:req.url,contentType:'text/html',capturedAt:at};
  });
  const partitionRequests=requests.map(url=>new URL(url)).filter(u=>u.searchParams.get('functional_area[0]')==='FCT_SA');
  assert.equal(partitionRequests[0].searchParams.get('order'),'职位名称');
  assert.equal(partitionRequests[0].searchParams.get('sort'),'asc');
  if(!['title-complete','date-complete','date-reverse-complete','title-only-unknown'].includes(mode)){
   assert.equal(fetched.ok,false,mode);
   const expected=mode==='all-overlap'?6:/^title-(403|429)$/u.test(mode)?1:/^date-(403|429)$/u.test(mode)?3:2;
   assert.equal(partitionRequests.length,expected,mode);
   continue;
  }
  assert.equal(fetched.ok,true,fetched.failureReason);
  const expected=['职位名称:asc','职位名称:asc'];
  if(mode!=='title-complete')expected.push('发布日期:asc','发布日期:asc');
  if(mode==='date-reverse-complete')expected.push('发布日期:desc','发布日期:desc');
  assert.deepEqual(partitionRequests.map(u=>`${u.searchParams.get('order')}:${u.searchParams.get('sort')}`),expected);
  const evidence=fetched.fetchEvidence,projected=replayNovartisNativePartitions(plan,evidence),audit=projected.audit.partitions[0];
  assert.equal(evidence.captureTool.version,'13');assert.equal(audit.uniqueCount,11);
  assert.equal(audit.selectedOrder,mode==='title-complete'?'职位名称':'发布日期');
  assert.equal(audit.selectedSort,mode==='date-reverse-complete'?'desc':'asc');
  assert.equal(audit.discardedTitleAscending?.unique,mode==='title-complete'?undefined:10);
  assert.equal(projected.unknownUrls.has(detail(ids[0])),unknown);
  assert.equal(projected.audit.noOmissionVerified,!unknown);
  assert.equal(evidence.pages.filter(p=>p.channelId==='novartis:FCT_SA').length,2);
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});assert.equal(result.truth.completenessVerified,true);assert.equal(result.jobs.length,11);
  const legacy=structuredClone(evidence);legacy.captureTool.version='12';assert.throws(()=>replayNovartisNativePartitions(plan,legacy));
 }
});

for(const [fieldId,fallbackOrder,prefix] of [['FCT_RD','职位名称','title'],['FCT_MM','站点','site']])
test(`an advertised ${fieldId} ${prefix} traversal can replace two incomplete date traversals without unioning them`,async()=>{
 for(const mode of ['complete','title-overlap','title-missing-page','no-title-link','foreign-link','title-403','title-429']){
  const at=new Date().toISOString(),requests=[];
  const fetched=await acquireNovartisNativePartitions(plan,async req=>{
   requests.push(req.url);const u=new URL(req.url),field=u.searchParams.get('functional_area[0]'),p=Number(u.searchParams.get('page')??0),title=field&&u.searchParams.get('order')===fallbackOrder;
   if(req.url===plan.source.officialEntryUrl)return {status:200,body:`<div class="view-header">Showing 11 results</div><select name="functional_area[]"><option value="${fieldId}">Partition</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>`,finalUrl:req.url,contentType:'text/html',capturedAt:at};
   const last=field&&!title||title&&mode==='title-overlap'?ids[0]:ids[10];
   let html=page(req.url,p?[last]:ids.slice(0,10),11,p);
   if(field&&!title&&mode!=='no-title-link'){
    const link=new URL(req.url);link.searchParams.delete('page');link.searchParams.set('order',fallbackOrder);link.searchParams.set('sort','asc');if(mode==='foreign-link')link.searchParams.set('country[0]','LOC_JP');
    html=html.replace('</tr></thead>',`<th><a href="${link.href}">${fallbackOrder}</a></th></tr></thead>`);
   }
   if(title&&mode==='title-missing-page'&&p)html=page(req.url,[],11,p);
   return {status:title&&mode==='title-403'?403:title&&mode==='title-429'?429:200,body:html,finalUrl:req.url,contentType:'text/html',capturedAt:at};
  });
  if(mode!=='complete'){
   assert.equal(fetched.ok,false,mode);
   if(['no-title-link','foreign-link'].includes(mode))assert.equal(requests.some(url=>new URL(url).searchParams.has('functional_area[0]')&&new URL(url).searchParams.get('order')===fallbackOrder),false);
   if(mode==='title-403'||mode==='title-429')assert.equal(requests.filter(url=>new URL(url).searchParams.has('functional_area[0]')&&new URL(url).searchParams.get('order')===fallbackOrder).length,1);
   continue;
  }
  assert(fetched.ok,fetched.failureReason);const evidence=fetched.fetchEvidence,projected=replayNovartisNativePartitions(plan,evidence);
  assert.equal(evidence.captureTool.version,'13');assert.equal(projected.audit.partitions[0].selectedOrder,fallbackOrder);assert.equal(projected.audit.partitions[0].selectedSort,'asc');assert.equal(projected.audit.partitions[0].discardedDateReverse.unique,10);
  assert.equal(requests.filter(url=>new URL(url).searchParams.get('functional_area[0]')===fieldId).length,6);
  assert.equal(evidence.pages.filter(p=>p.channelId===`novartis:${fieldId}`).length,2);assert(evidence.pages.filter(p=>p.channelId===`novartis:${fieldId}`).every(p=>p.artifactLogicalKey.includes(`-${prefix}-`)));
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});assert.equal(result.truth.completenessVerified,true);assert.equal(result.jobs.length,11);
  const legacy=structuredClone(evidence);legacy.captureTool.version='6';assert.throws(()=>replayNovartisNativePartitions(plan,legacy),'Legacy schema cannot accept unproved extra traversals');
  legacy.captureTool.version='8';
  if(prefix==='site')assert.throws(()=>replayNovartisNativePartitions(plan,legacy));
  else assert.equal(replayNovartisNativePartitions(plan,legacy).audit.partitions[0].selectedOrder,fallbackOrder);
  for(const version of ['9','10','11','12']){
   legacy.captureTool.version=version;
   if(fieldId==='FCT_MM'&&Number(version)<11)assert.throws(()=>replayNovartisNativePartitions(plan,legacy));
   else assert.equal(replayNovartisNativePartitions(plan,legacy).audit.partitions[0].selectedOrder,fallbackOrder);
  }
  if(fieldId==='FCT_RD'){
   // The same synthetic date/date/title pages preserve the historical Sales contract.
   const sales=legacySortEvidence(evidence,'12','FCT_SA','FCT_RD');
   assert.equal(replayNovartisNativePartitions(plan,sales).audit.partitions[0].selectedOrder,'职位名称');
   for(const version of ['9','10','11','13']){
    sales.captureTool.version=version;assert.throws(()=>replayNovartisNativePartitions(plan,sales));
   }
   const siteKeys=JSON.parse(JSON.stringify(sales).replaceAll('FCT_SA-title-','FCT_SA-site-'));
   const historical=legacySortEvidence(siteKeys,'9','站点','职位名称');
   historical.artifacts=historical.artifacts.map((a,i)=>a.channelId==='novartis:FCT_SA'||a.logicalKey==='novartis-partitions-audit'?a:siteKeys.artifacts[i]);
   for(const version of ['9','10','11']){
    historical.captureTool.version=version;
    assert.equal(replayNovartisNativePartitions(plan,historical).audit.partitions[0].selectedOrder,'站点');
   }
   historical.captureTool.version='12';
   assert.throws(()=>replayNovartisNativePartitions(plan,historical),'Version 12 requires the Sales title fallback');
  }
 }
});
