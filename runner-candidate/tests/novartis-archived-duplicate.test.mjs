import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {acquireNovartisNativePartitions} from '../src/crawler/novartisNativePartitions.ts';
import {defaultHttpHtmlClient} from '../src/crawler/httpHtmlSourceFetch.ts';
import {parseArtifactArchiveDrafts} from '../src/crawler/sourceFetchEvidence.ts';

test('archived duplicate REQ rows retain only safe cache diagnostics on failure',async t=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/novartis-duplicate-rows.json',import.meta.url),'utf8'));
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-novartis-social');
 const row=n=>`<tr><td class="views-field-field-job-title"><a href="/careers/career-search/job/details/req-${10000000+n}-synthetic">Synthetic ${n}</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`;
 // Only the two duplicate rows are real projections. The compact two-page
 // envelope and nine other rows are synthetic, not a production capture.
 async function capture(duplicate,withHeaders){
  const calls=[];
  const fetch=t.mock.method(globalThis,'fetch',async (request,init)=>{
   calls.push([request,init.method,init.headers]);const url=new URL(request),page=Number(url.searchParams.get('page')??0);
   let body;
   if(request===plan.source.officialEntryUrl)body='<div class="view-header">Showing 11 results</div><select name="functional_area[]"><option value="FCT_SA">Sales</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>';
   else{
    const next=new URL(url);next.searchParams.set('page','1');
    const rows=page?(duplicate?fixture.rows[1].html:row(10)):fixture.rows[0].html+Array.from({length:9},(_,i)=>row(i+1)).join('');
    body=`<div class="view-header">Showing 11 results</div><table class="views-table"><tbody>${rows}</tbody></table><div class="pagination"><span class="active"><a class="page-link" title="page ${page+1} out of 2 pages"></a></span><a rel="next" ${page?'class="disabled"':`href="${next.href}"`}></a></div>`;
   }
   const response=new Response(body,{headers:{'content-type':'text/html',...(withHeaders?{
    age:'120','cache-status':'edge; hit; key="private; fwd=stale, value", "shield"; fwd=uri-miss; detail="private"',
    'x-drupal-cache':'HIT','set-cookie':'private=secret'
   }:{})}});
   Object.defineProperty(response,'url',{value:request});
   return response;
  });
  try{return {result:await acquireNovartisNativePartitions(plan,defaultHttpHtmlClient),calls};}
  finally{fetch.mock.restore();}
 }
 const complete=await capture(false,true);assert.equal(complete.result.ok,true,complete.result.failureReason);
 assert.equal(complete.result.fetchEvidence.fetchCounts.validCount,11);
 const key='novartis-list-cache-diagnostics';
 assert.equal(complete.result.fetchEvidence.artifacts.some(a=>a.logicalKey===key),false);
 const baseline=await capture(true,false);
 const duplicate=await capture(true,true);assert.equal(duplicate.result.ok,false);
 assert.equal(duplicate.result.failureReason,'NOVARTIS_NATIVE_PARTITIONS_INCOMPLETE');
 assert.equal(duplicate.calls.length,3,'Stops at the incomplete traversal when no alternative sort is advertised');
 assert.deepEqual(duplicate.calls,baseline.calls);
 assert.equal(duplicate.result.failureReason,baseline.result.failureReason);
 const evidence=duplicate.result.fetchEvidence;
 const artifacts=parseArtifactArchiveDrafts({captureTool:evidence.captureTool,artifacts:evidence.artifacts}).artifacts;
 const diagnostic=artifacts.find(a=>a.logicalKey===key);
 assert.equal(diagnostic.kind,'COMMAND_OUTPUT');
 assert.deepEqual(JSON.parse(diagnostic.body),artifacts.filter(a=>a.logicalKey!==key).map(a=>({
  logicalKey:a.logicalKey,bodySha256:createHash('sha256').update(a.body).digest('hex'),
  cache:{ageSeconds:120,cacheStatus:['hit','fwd=uri-miss'],drupalCache:'HIT'}
 })));
});
