import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {acquireNovartisNativePartitions} from '../src/crawler/novartisNativePartitions.ts';

test('archived duplicate REQ rows cannot certify a complete traversal',async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/novartis-duplicate-rows.json',import.meta.url),'utf8'));
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-novartis-social');
 const row=n=>`<tr><td class="views-field-field-job-title"><a href="/careers/career-search/job/details/req-${10000000+n}-synthetic">Synthetic ${n}</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`;
 // Only the two duplicate rows are real projections. The compact two-page
 // envelope and nine other rows are synthetic, not a production capture.
 async function capture(duplicate){
  const calls=[];
  const result=await acquireNovartisNativePartitions(plan,async request=>{
   calls.push(request.url);const url=new URL(request.url),page=Number(url.searchParams.get('page')??0);
   let body;
   if(request.url===plan.source.officialEntryUrl)body='<div class="view-header">Showing 11 results</div><select name="functional_area[]"><option value="FCT_SA">Sales</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>';
   else{
    const next=new URL(url);next.searchParams.set('page','1');
    const rows=page?(duplicate?fixture.rows[1].html:row(10)):fixture.rows[0].html+Array.from({length:9},(_,i)=>row(i+1)).join('');
    body=`<div class="view-header">Showing 11 results</div><table class="views-table"><tbody>${rows}</tbody></table><div class="pagination"><span class="active"><a class="page-link" title="page ${page+1} out of 2 pages"></a></span><a rel="next" ${page?'class="disabled"':`href="${next.href}"`}></a></div>`;
   }
   return {status:200,body,finalUrl:request.url,contentType:'text/html',capturedAt:new Date().toISOString()};
  });
  return {result,calls};
 }
 const complete=await capture(false);assert.equal(complete.result.ok,true,complete.result.failureReason);
 assert.equal(complete.result.fetchEvidence.fetchCounts.validCount,11);
 const duplicate=await capture(true);assert.equal(duplicate.result.ok,false);
 assert.equal(duplicate.result.failureReason,'NOVARTIS_NATIVE_PARTITIONS_INCOMPLETE');
 assert.equal(duplicate.calls.length,3,'Stops at the incomplete traversal when no alternative sort is advertised');
});
