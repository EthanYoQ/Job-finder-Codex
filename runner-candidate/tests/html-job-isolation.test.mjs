import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createHttpHtmlSourceFetch} from '../src/crawler/httpHtmlSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

const at='2026-11-06T00:00:00.000Z';
for(const sourceId of ['source-abbvie-china-social','source-takeda-china-social','source-viatris-social'])test(`${sourceId}: one malformed list title does not block valid native rows`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId);
 for(const bad of [false,true]){
  const filters='<section id="search-filters"><input class="filter-checkbox"></section>';
  const root='<div id="search-results" data-ajax-url="/search/results" data-total-pages="1" data-total-job-results="2" data-current-page="1" data-records-per-page="20" data-location="China"></div>';
  let body;
  if(sourceId.includes('abbvie'))body='<span class="attrax-pagination__results-of--2" data-total-pages="1"></span><span class="attrax-pagination__total-results">2</span>'+[1,2].map(id=>`<div class="attrax-vacancy-tile"><a class="attrax-vacancy-tile__title" href="/zh-hans/job/role-jid-${id}">${bad&&id===2?'':`Role ${id}`}</a><div class="attrax-vacancy-tile__location-freetext"><span class="attrax-vacancy-tile__item-value">Shanghai, Shanghai</span></div><div class="attrax-vacancy-tile__option-location"><span class="attrax-vacancy-tile__item-value">China</span></div></div>`).join('');
  else if(sourceId.includes('takeda'))body=JSON.stringify({results:root+`<ul id="search-results-list">${[1,2].map(id=>`<li><button class="js-save-job-btn" data-job-id="${id}"></button><a href="/job/shanghai/role/${id}"><h2 class="title">${bad&&id===2?'':`Role ${id}`}</h2></a><span class="location">Shanghai, China</span></li>`).join('')}</ul>`,filters,hasJobs:true,hasContent:false});
  else body='<ul id="pageTurnUl"><li data-total-pages="1">共 1 页</li><li onclick="pageTurn(1,10)"></li></ul><div class="position-list-body">'+[1,2].map(id=>`<div class="position-item"><div class="e-title"><a href="/viatris/position/detail?positionId=${id}">${bad&&id===2?'':`Role ${id}`}</a></div><span class="e-city">上海</span></div>`).join('')+'</div>';
  const fetch=createHttpHtmlSourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,body:sourceId.includes('takeda')&&url===plan.source.officialEntryUrl?root+filters:body,finalUrl:url,contentType:sourceId.includes('takeda')&&url!==plan.source.officialEntryUrl?'application/json':'text/html',capturedAt:at})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,JSON.stringify({bad,truth:result.truth,observation:result.observation}));
  assert.equal(result.jobs.length,bad?1:2);
  if(bad){
   assert.equal(result.fetchEvidence.jobQuarantines[0].sourceJobId,'2');
   const changed=structuredClone(result.fetchEvidence);changed.jobQuarantines[0].sourceJobId='1';
   assert.equal(replayStrictSourceQualityEvidence({plan,evidence:changed,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});
