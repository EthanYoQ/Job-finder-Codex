import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
import {GILEAD_YELLO_BOARD} from '../src/crawler/gileadPublicAge.ts';

test('Gilead: individual damaged rows retain prior jobs while complete good rows update',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-gilead-china-social'),at='2026-11-06T00:00:00.000Z';
 const row=(id,title='Role',location='China - Shanghai',extra='')=>`<li class="search-results__item"><div class="search-results__flag"><img alt="${location==='China - Hong Kong'?'Hong Kong':'China'} flag" src="/assets/images/flags/${location==='China - Hong Kong'?'hk':'cn'}.png"></div><div class="search-results__jobinfo"><a class="search-results__req_title" href="/jobs/${id}?job_board_id=${GILEAD_YELLO_BOARD}">${title}</a><div><span>${location}</span><span>Regular</span><span>Full time</span></div></div><div class="search-results__post-time">Recently posted</div>${extra}</li>`;
 for(const mode of ['good','title','unknown','two-unbound','hong-kong-and-quarantine','cosmetic','missing-list','duplicate']){
  let rows=[row('A'.repeat(22)),row('B'.repeat(22),mode==='title'?'':'Role',mode==='unknown'?'Unknown':'China - Shanghai')];
  if(mode==='two-unbound')rows.push('<li class="search-results__item">Bad row</li>','<li class="search-results__item">Bad row</li>');
  if(mode==='hong-kong-and-quarantine'){rows[1]=row('B'.repeat(22),'','China - Shanghai');rows.push(row('C'.repeat(22),'Role','China - Hong Kong'));}
  if(mode==='duplicate')rows[1]=row('A'.repeat(22));
  if(mode==='cosmetic')rows=rows.map(s=>s.replace('/assets/images/flags/cn.png','/new-flag.svg').replace('</a>','</a><span class="badge">New</span>'));
  const count=rows.length+(mode==='missing-list'?1:0),body=JSON.stringify({html:rows.join(''),count_on_page:count,more_requisitions:false,query:'',filters:JSON.stringify([{label:'Locations',id:32,has_conditions:false,answers:[{id:72,label:'China'}],answer_type:'multiple_select'}]),text_filters:'[]',display_count_text:`${count} Results`});
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,body,finalUrl:url,contentType:'application/json',capturedAt:at})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(['missing-list','duplicate'].includes(mode)){assert.equal(result.truth.completenessVerified,false,mode);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(result.jobs.length,['title','unknown','hong-kong-and-quarantine'].includes(mode)?1:2,mode);
  if(['title','unknown','two-unbound','hong-kong-and-quarantine'].includes(mode)){
   const evidence=structuredClone(result.fetchEvidence);assert.equal(evidence.jobQuarantines.length,mode==='two-unbound'?2:1);
   evidence.jobQuarantines[0].sourceJobId='wrong';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});
