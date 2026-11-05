import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {createHttpHtmlSourceFetch} from '../src/crawler/httpHtmlSourceFetch.ts';
import {replayAstraZenecaList,replayAstraZenecaDetails} from '../src/crawler/astraZenecaDetailAcquisition.ts';
import {astraZenecaDetailEnvelopeSchema} from '../src/crawler/astraZenecaDetailContract.ts';

const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astrazeneca-social');
async function capture(country='China'){
 const fetch=createHttpHtmlSourceFetch({http:async({url})=>{
  const page=Number(new URL(url).searchParams.get('p')),offset=(page-1)*15;
  const rows=Array.from({length:Math.min(15,410-offset)},(_,i)=>{
   const id=String(1000+offset+i);
   return `<li data-country="${country}"><a class="search-results-link" data-job-id="${id}" href="/job/shanghai/role/12977/${id}"><h2>Sales role ${id}</h2></a><span class="job-location">Shanghai Shanghai</span></li>`;
  }).join('');
  const body=`<div id="search-results" data-total-pages="28" data-total-job-results="410" data-total-results="410" data-current-page="${page}" data-records-per-page="15"></div><input id="cn" data-facet-type="2" data-id="1814991" data-display="中国" data-count="410"><label for="cn"><b class="filter">中国</b><b>410</b></label><ul id="search-results-list">${rows}</ul>`;
  return {status:200,body,finalUrl:url,contentType:'text/html',capturedAt:new Date().toISOString()};
 }});
 return fetch(plan);
}

test('410 official jobs and 28 list pages enter detail replay without historical count caps',async()=>{
 const result=await capture();assert.equal(result.ok,true,result.failureReason);
 const jobs=replayAstraZenecaList(plan,result.fetchEvidence,result.capturedAt,false);assert.equal(jobs.length,410);
 const envelope=astraZenecaDetailEnvelopeSchema.parse({schemaVersion:'astrazeneca-owned-details-v1',policy:'ASTRAZENECA_OWNED_DETAILS_V1',
  sourceConfigSha256:sourcePlanConfigSha256(plan),listArtifactLogicalKeys:result.fetchEvidence.artifacts.map(a=>a.logicalKey),
  entries:jobs.map(j=>({sourceJobId:j.sourceJobId,officialUrl:j.officialUrl,outcome:{ok:false,code:'DETAIL_CANCELLED'}}))});
 const replay=value=>replayAstraZenecaDetails(plan,{...result.fetchEvidence,astraZenecaDetails:value},result.capturedAt,false);
 const pending=replay(envelope);assert.equal(pending.jobs.length,410);assert.equal(pending.detailComplete,false);
 assert.throws(()=>replay({...envelope,entries:envelope.entries.slice(1)}),/ARTIFACT_SET_INVALID/);
 const wrong=structuredClone(envelope);wrong.entries[0].sourceJobId='999999';assert.throws(()=>replay(wrong),/ROW_BINDING_INVALID/);
 const missingPage={...result.fetchEvidence,artifacts:result.fetchEvidence.artifacts.slice(1),pages:result.fetchEvidence.pages.slice(1)};
 assert.throws(()=>replayAstraZenecaList(plan,missingPage,result.capturedAt,false),/LIST_PROOF_INVALID/);
});

test('a large declared inventory does not admit explicit foreign rows',async()=>{
 const result=await capture('Japan');assert.equal(result.ok,true);
 assert.throws(()=>replayAstraZenecaList(plan,result.fetchEvidence,result.capturedAt,false),/LIST_COUNTRY_INVALID/);
});
