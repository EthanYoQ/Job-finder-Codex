import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {memoryDb} from './memory-db.mjs';
import {loadDirectPlans,identityForSource} from '../scripts/direct-round.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {withLocalOfficialDom} from '../src/crawler/localOfficialSourceFetch.ts';
import {runP0CrawlBatch} from '../src/crawler/runCrawlBatch.ts';
import {withPortableCrawlLease} from '../src/crawler/portableCrawlLease.ts';
import {createOwnedSourceQualityFetch,SOURCE_QUALITY_POLICY_ID} from '../src/crawler/sourceQualityAdmission.ts';
import {hashCanonicalStringSet} from '../src/crawler/runtimeBatchIdentity.ts';

function cspcWithoutIndependentRows(plan){
 const channel='0beb3022-3214-4333-a2e7-20786c4916d5',id='11111111-1111-4111-8111-111111111111';
 const alphabet='y!89(*z02BCcdD_bEeGHIJKLmnNOPQopRMSTqrUklVstWXYZafgh3ij1uvwx456A7',standard='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
 const wrapped=[...Buffer.from(id).toString('base64').replace(/=+$/,'')].map(c=>alphabet[standard.indexOf(c)]).join('')+'yyryrtweasdasd';
 const encoded=wrapped.slice(0,2)+wrapped.slice(-3)+wrapped.slice(2,-3);
 let httpResult,fetchAccepted=false;
 const native=createOfficialJsonSourceFetch({http:async request=>{
  return {status:200,finalUrl:request.url,capturedAt:new Date().toISOString(),contentType:request.method==='POST'?'application/json':'text/html',
   body:request.method==='POST'?JSON.stringify({state:'1',total:'',jsonList:[{REQUEST_ID:id,PUBLISH_NAME:'Synthetic role',WORK_PLACE:'石家庄',JOB_DUTY:'研究工作',JOB_REQUEST:'具有实验能力'}]}):request.url===plan.source.officialEntryUrl?'<html>Official</html>':`<script>var requestId=${JSON.stringify(encoded)};</script>`};
 }});
 const fetch=withLocalOfficialDom(async(...args)=>httpResult=await native(...args),async()=>{
  const at=new Date().toISOString();
  return {dom:{schema:'dot-cloud-cdp-dom-navigation-observation-v1',purpose:'CURRENT_RUN_INDEPENDENT_DOM_OBSERVATION',sourceId:plan.source.id,
   entryUrl:plan.source.officialEntryUrl,channelId:channel,networkCapture:false,sourceConfigurationCandidateCountIsOfficialTotal:false,
   applicationObservationsPending:false,listFilters:{keyword:'',selectedFilters:[]},observationStartedAt:at,observationCompletedAt:at,
   terminal:{disabledNextCount:1,disabledJumpNextCount:1,enabledNextCount:0,loadMoreCount:0,rowCount:0,readStartedAt:at,readCompletedAt:at},rows:[]},
   applications:{schema:'dot-cloud-cdp-application-entry-observation-v1',sourceId:plan.source.id,observations:[]}};
 });
 return {fetch:async(...args)=>{const result=await fetch(...args);fetchAccepted=result.ok;return result;},
  httpResult:()=>httpResult,fetchAccepted:()=>fetchAccepted};
}

test('a source without sufficient list evidence leaves its jobs untouched while another source commits',async()=>{
 const routes=await loadDirectPlans(),healthy=routes.find(p=>p.sourceId==='source-abbvie-china-social').plan,
  failed=routes.find(p=>p.sourceId==='source-cspc-social').plan;
 const cache=fileURLToPath(new URL('../../.runtime/.cache/',import.meta.url));await mkdir(cache,{recursive:true});
 const workspaceRoot=await mkdtemp(join(cache,'publication-boundaries-'));
 const memory=memoryDb(),writes=[];memory.db.job.upsert=async args=>writes.push(args);
 const candidate={id:'synthetic-publication',commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};
 const ids=[healthy.source.id,failed.source.id].sort(),identity={...identityForSource(candidate,healthy.source.id),
  expectedPlannedSourceIds:ids,expectedPlannedSourceCount:ids.length,expectedPlannedSourceSetSha256:hashCanonicalStringSet(ids)};
 const html='<span class="attrax-pagination__results-of--2" data-total-pages="1"></span><span class="attrax-pagination__total-results">1</span>'+
  '<div class="attrax-vacancy-tile"><a class="attrax-vacancy-tile__title" href="/zh-hans/job/synthetic-jid-1">Synthetic role</a><div class="attrax-vacancy-tile__location-freetext"><span class="attrax-vacancy-tile__item-value">Shanghai, Shanghai</span></div><div class="attrax-vacancy-tile__option-location"><span class="attrax-vacancy-tile__item-value">China</span></div></div>';
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async url=>{assert.equal(String(url),healthy.source.officialEntryUrl);return {status:200,url:String(url),headers:new Headers({'content-type':'text/html'}),text:async()=>html};};
 const healthyFetch=createOwnedSourceQualityFetch();
 const cspc=cspcWithoutIndependentRows(failed);
 try{
  const result=await withPortableCrawlLease(memory.db,lease=>runP0CrawlBatch([failed,healthy],{
   db:memory.db,identity,now:()=>new Date(),workspaceRoot,evidenceSubdirectory:'evidence',publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,portableLease:lease,
   getPreviousJobs:async()=>[],getRecentObservations:async()=>[],isBaselineCompleted:async()=>false,getTrustedCompletenessBaseline:async()=>null,getFirstAcceptedCurrentPolicyReceipt:async()=>null,
   fetch:async(plan,tracker)=>plan.source.id===failed.source.id?cspc.fetch(plan,tracker):healthyFetch(plan,tracker)
  }));
  assert.equal(cspc.httpResult().ok,true);
  assert.equal(cspc.httpResult().fetchEvidence.fetchCounts.rawCount,1);
  assert.equal(cspc.fetchAccepted(),false);
  assert.equal(result.status,'INCOMPLETE');
  assert.equal(memory.rows.find(row=>row.sourceId===failed.source.id).atomicCommitState,'NOT_ATTEMPTED');
  assert.equal(memory.rows.find(row=>row.sourceId===healthy.source.id).atomicCommitState,'COMMITTED');
  assert.equal(memory.rows.find(row=>row.sourceId===healthy.source.id).completenessState,'VERIFIED');
  assert.equal(writes.length,1);assert.equal(writes[0].create.sourceId,healthy.source.id);
 }finally{globalThis.fetch=originalFetch;await rm(workspaceRoot,{recursive:true,force:true});}
});
