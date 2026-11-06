import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {acquireNovartisNativePartitions,replayNovartisNativePartitions} from '../src/crawler/novartisNativePartitions.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

test('Novartis: complete partitions isolate damaged jobs and unavailable supplemental details',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-novartis-social');
 const ids=[1,2,3,4].map(n=>`REQ-1000000${n}`),url=id=>`https://www.novartis.com.cn/careers/career-search/job/details/${id.toLowerCase()}-test`;
 for(const mode of ['good','title','country','missing-link','detail-503','detail-transport','detail-clock-skew','detail-bad-link','unbound-discovery','bound-discovery','duplicate','incomplete']){
  const row=id=>`<tr><td class="views-field-field-job-title">${mode==='missing-link'&&id===ids[1]?'Broken':`<a href="${url(mode==='duplicate'&&id===ids[1]?ids[0]:id)}">${mode==='title'&&id===ids[1]?'':`Job ${id}`}</a>`}</td><td class="views-field-field-job-country">${mode==='country'&&id===ids[1]?'Japan':'China'}</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`;
  const page=(rows,count=rows.length)=>`<div class="view-header">Showing ${count} results</div><table class="views-table"><tbody>${rows.length?rows.map(row).join(''):'<tr><td class="empty message">No content has been found.</td></tr>'}</tbody></table>`;
  const root=page([],2)+'<select name="functional_area[]"><option value="FCT_QA">QA</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>';
  const futureTimestamp=new Date(Date.now()+60000).toISOString();
  const fetched=await acquireNovartisNativePartitions(plan,async request=>{
   const u=new URL(request.url),detail=u.pathname.includes('/job/details/');let html;
   if(request.url===plan.source.officialEntryUrl)html=root;
   else if(detail){const id=ids.find(id=>u.pathname.includes(id.toLowerCase()));if(['detail-transport','detail-clock-skew'].includes(mode)&&id===ids[2])throw Error('Synthetic transport failure');html=`<h1>Job ${id}</h1><article>Job ID ${id}<p>Current official job description.</p><a href="https://platform.moseeker.com/m/customize/page/novartis?job_number=${id}">Apply to Job</a></article>`;}
   else {html=u.searchParams.has('functional_area[0]')?page(ids.slice(0,2),mode==='incomplete'?3:2):page(ids);if(!u.searchParams.has('functional_area[0]')&&mode.endsWith('discovery'))html=html.replace(row(ids[2]),mode==='unbound-discovery'?'<tr><td>Broken</td></tr>':row(ids[2]).replace(`Job ${ids[2]}`,''));}
   if(detail&&mode==='detail-bad-link'&&u.pathname.includes(ids[2].toLowerCase()))html=html.replace(`https://platform.moseeker.com/m/customize/page/novartis?job_number=${ids[2]}`,'https://[');
   return {status:detail&&mode==='detail-503'&&u.pathname.includes(ids[2].toLowerCase())?503:200,body:html,finalUrl:request.url,contentType:'text/html',capturedAt:mode==='detail-clock-skew'?futureTimestamp:new Date().toISOString()};
  });
  if(['duplicate','incomplete'].includes(mode)){assert.equal(fetched.ok,false,mode);continue;}
  assert.equal(fetched.ok,true,`${mode}: ${fetched.failureReason}`);
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.observation)}`);
  assert.equal(result.jobs.length,mode==='good'?4:3,mode);
  const projected=replayNovartisNativePartitions(plan,result.fetchEvidence);
  if(mode.startsWith('detail-')||mode==='bound-discovery')assert(projected.unknownUrls.has(url(ids[2])));
  else if(mode==='unbound-discovery')assert.equal(projected.unboundUnknown,true);
  else if(mode!=='good'){
   assert.equal(result.fetchEvidence.jobQuarantines.length,1);const evidence=structuredClone(result.fetchEvidence);evidence.jobQuarantines[0].officialUrl='https://www.novartis.com.cn/incorrect';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:result.observation.crawledAt.toISOString()}),false);
  }
 }
});
