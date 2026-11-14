import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture} from './jnj-observation-fixture.mjs';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {createJnjCareersDomSourceFetch} from '../src/crawler/jnjCareersDomEvidence.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

test('JNJ: bad list fields or individual native detail failures preserve old jobs while good jobs update',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'jnj-row-isolation-')),oldRoot=process.env.JOBFINDER_STATE_ROOT;process.env.JOBFINDER_STATE_ROOT=directory;
 t.after(async()=>{if(oldRoot===undefined)delete process.env.JOBFINDER_STATE_ROOT;else process.env.JOBFINDER_STATE_ROOT=oldRoot;await rm(directory,{recursive:true,force:true});});
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-johnson-innovative-medicine-social').plan;
 for(const mode of ['good','title','foreign','malformed-link','two-unbound','detail-title','missing-detail','no-apply','detail-unavailable','duplicate','missing-page']){
  const input=fixture(mode==='two-unbound'?5:3),$=load(input.list.fragment.html),second=$('[data-id="r-000002"]');
  if(mode==='title'){second.find('a').text('');input.list.fragment.items[1].links[0].title='';}
  if(mode==='foreign')second.find('.PagePromo-location').text('Tokyo');
  if(mode==='malformed-link'){second.removeAttr('data-id').find('a').attr('href','https://[');input.list.fragment.items[1].links[0].url='https://[';input.details.splice(1,1);}
  if(mode==='two-unbound'){
   for(const n of [1,2]){$(`[data-id="r-00000${n+1}"]`).replaceWith('<li class="PageList-items-item card-job">Broken</li>');input.list.fragment.items[n]={text:'Broken',links:[]};}
   input.details.splice(1,2);
  }
  if(mode==='detail-title')input.details[1].heading='Different title';
  if(mode==='missing-detail')input.details.splice(1,1);
  if(mode==='no-apply')input.details[1].applyLinks=[];
  if(mode==='detail-unavailable')input.details[1]={kind:'JNJ_DETAIL_CAPTURE_UNAVAILABLE',expectedUrl:input.details[1].expectedUrl,sourceJobId:'r-000002',observedAt:input.details[1].observedAt,code:'JNJ_DETAIL_CAPTURE_FAILED',httpStatus:503};
  if(mode==='duplicate'){second.attr('data-id','r-000001').find('a').attr('href',input.list.fragment.items[0].links[0].url);input.list.fragment.items[1].links[0].url=input.list.fragment.items[0].links[0].url;}
  if(mode==='missing-page')input.list.heading='Displaying 1 to 20 of 21 matching jobs';
  input.list.fragment.html=$.html($('#js-job-search-results')[0]);input.list.fragment.htmlLength=input.list.fragment.html.length;
  const fetch=createJnjCareersDomSourceFetch({lists:[JSON.stringify(input.list)],details:input.details.map(d=>JSON.stringify(d))});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(['duplicate','missing-page'].includes(mode)){assert.equal(result.truth.completenessVerified,false,mode);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.observation)}`);
  assert.equal(result.jobs.length,['good','two-unbound'].includes(mode)?3:2,mode);
  if(mode!=='good'){
   const evidence=structuredClone(result.fetchEvidence);assert.equal(evidence.jobQuarantines.length,mode==='two-unbound'?2:1);evidence.jobQuarantines[0].sourceJobId='wrong';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:result.observation.crawledAt.toISOString()}),false);
  }
 }
});

import {memoryDb} from './memory-db.mjs';
import {identityForSource} from '../scripts/direct-round.ts';
import {withPortableCrawlLease} from '../src/crawler/portableCrawlLease.ts';
import {runP0CrawlBatch} from '../src/crawler/runCrawlBatch.ts';
import {verifyAGradeCompletenessCertificateReceipt} from '../src/crawler/completenessCertificate.ts';

test('JNJ native DOM atomic admission accepts good and isolated jobs with a persistable certificate',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-johnson-innovative-medicine-social').plan;
 const workspaceRoot=await mkdtemp(join(tmpdir(),'jnj-atomic-isolation-'));
 try{for(const mode of ['good','bad-title','missing-detail','unbound']){
  const memory=memoryDb(),candidate={id:`synthetic-jnj-${mode}`,commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};
  const fetch=async(...args)=>{const input=fixture(3),stamp=new Date().toISOString();input.list.observedAt=stamp;for(const detail of input.details)detail.observedAt=stamp;
   if(mode==='bad-title'){const $=load(input.list.fragment.html);$('[data-id="r-000002"] a').text('');input.list.fragment.html=$.html($('#js-job-search-results')[0]);input.list.fragment.items[1].links[0].title='';}
   if(mode==='missing-detail')input.details.splice(1,1);
   if(mode==='unbound'){const $=load(input.list.fragment.html);$('[data-id="r-000002"]').replaceWith('<li class="PageList-items-item card-job">Broken</li>');input.list.fragment.html=$.html($('#js-job-search-results')[0]);input.list.fragment.items[1]={text:'Broken',links:[]};input.details.splice(1,1);}
   input.list.fragment.htmlLength=input.list.fragment.html.length;for(const detail of input.details)detail.body.htmlLength=detail.body.html.length;
   return createJnjCareersDomSourceFetch({lists:[JSON.stringify(input.list)],details:input.details.map(d=>JSON.stringify(d))})(...args);
  };
  const result=await withPortableCrawlLease(memory.db,lease=>runP0CrawlBatch([plan],{db:memory.db,identity:identityForSource(candidate,plan.source.id),now:()=>new Date(),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',portableLease:lease,workspaceRoot,fetch,getPreviousJobs:async()=>[],getRecentObservations:async()=>[],isBaselineCompleted:async()=>false,getTrustedCompletenessBaseline:async()=>null,getFirstAcceptedCurrentPolicyReceipt:async()=>null}));
  const row=memory.rows[0];assert.equal(result.status,'SUCCESS',`${mode}: ${JSON.stringify(row)}`);assert.equal(row.atomicCommitState,'COMMITTED');assert.equal(row.dedupeOutputCount,mode==='good'?3:2);
  assert.equal(verifyAGradeCompletenessCertificateReceipt({certificate:JSON.parse(JSON.stringify(row.completenessCertificate)),certificateSha256:row.completenessCertificateSha256,expected:{releaseCandidateId:candidate.id,batchId:result.batchId,sourceResultId:row.id,sourceId:plan.source.id,sourceConfigSha256:row.sourceConfigHash}}).status,'PASS');
 }}finally{await rm(workspaceRoot,{recursive:true,force:true});}
});
