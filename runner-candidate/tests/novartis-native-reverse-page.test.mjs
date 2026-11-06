import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {acquireNovartisNativePartitions,replayNovartisNativePartitions} from '../src/crawler/novartisNativePartitions.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';

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
  else if(field&&!reverse){const rows=p?[ids[0]]:ids.slice(0,10);html=page(req.url,rows,11,p,mode!=='no-native-reverse');}
  else {const changedSlug=!field&&mode==='ascending-only-new-slug',values=changedSlug?ids:ordered;const rows=p?(mode==='reverse-changing-total'||changedSlug?ids.slice(10,12):[values[10]]):values.slice(0,10);html=page(req.url,mode==='reverse-overlap'&&p?[ordered[0]]:rows,changedSlug||reverse&&p&&mode==='reverse-changing-total'?12:11,p);if(changedSlug)html=html.replaceAll(`${ids[0].toLowerCase()}-test`,`${ids[0].toLowerCase()}-updated`);}
  if(field&&reverse&&mode==='foreign')html=html.replaceAll('>China</td>','>Japan</td>');
  return {status:field&&reverse&&mode==='blocked'?403:200,body:html,finalUrl:req.url,contentType:'text/html',capturedAt:at};
 });return {fetched,requests};
}

test('only an advertised, independently complete reverse traversal can replace overlapping pages',async()=>{
 const {fetched,requests}=await capture();assert(fetched.ok,fetched.failureReason);
 const evidence=fetched.fetchEvidence,projected=replayNovartisNativePartitions(plan,evidence);
 assert.equal(evidence.captureTool.version,'6');assert.equal(evidence.fetchCounts.validCount,11);
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
