import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createGrifolsChinaSourceFetch,validateStrictGrifolsChinaEvidence} from '../src/crawler/grifolsChinaSourceFetch.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';

test('Grifols nationwide wording is not tied to one sentence; foreign or unbound locations remain rejected',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-grifols-china-social');
 const url='https://jobsearch.grifols.com/job/Home-Office-Test/1409962833/';
 const list='<span class="paginationLabel">Results <b>1 – 1</b> of <b>1</b></span><table id="searchresults" aria-label="Search results for China. Page 1 of 1, Results 1 to 1 of 1"><tbody><tr class="data-row"><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Home-Office-Test/1409962833/">Test job</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Home Office, CN</span></td></tr></tbody></table>';
 async function capture(content,withFailedSecond=false,badListTitle=false){
  const now=new Date(),at=now.toISOString();
  const fetch=createGrifolsChinaSourceFetch({now:()=>now,http:async({url:requested})=>{
   const secondUrl=url.replace('1409962833','1409962834');
   assert([plan.source.officialEntryUrl,url,...(withFailedSecond?[secondUrl]:[])].includes(requested));
   const detail=`<link rel="canonical" href="${url}"><div class="jobDisplayShell" itemscope itemtype="http://schema.org/JobPosting"><span itemprop="jobLocation"><span itemprop="address"><meta itemprop="streetAddress" content="Home Office, CN"></span></span><div class="jobDisplay"><div class="content">${content}</div></div></div>`;
   let secondRow=/<tr class="data-row">.*<\/tr>/u.exec(list)[0].replaceAll('1409962833','1409962834');if(badListTitle)secondRow=secondRow.replace('Test job','');
   const fullList=withFailedSecond?list.replace('1 – 1','1 – 2').replace('of <b>1</b>','of <b>2</b>').replace('Results 1 to 1 of 1','Results 1 to 2 of 2').replace('</tbody>',secondRow+'</tbody>'):list;
   return {status:requested===secondUrl?503:200,body:requested===secondUrl?'Synthetic unavailable':requested===url?detail:fullList,finalUrl:requested,contentType:'text/html',capturedAt:at};
  }});
  return fetch(plan);
 }
 for(const location of ['Open to candidates across China, not limited to Shanghai.','Open to candidates across China','Throughout mainland China.','Open to candidates across China, not limited to Beijing']){
  const fetched=await capture(`<p><b>Location: ${location}</b></p>`);assert(fetched.ok,fetched.failureReason);
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched});
  assert.equal(result.status,'SUCCESS');assert.deepEqual(result.jobs[0].cities,['全国']);
  assert.equal(result.jobs[0].locationRaw,'Home Office, CN');
  assert(validateStrictGrifolsChinaEvidence(plan,fetched.fetchEvidence,result.jobs));
 }
 for(const content of ['<p><b>Location: Open to candidates across China, not limited to Tokyo.</b></p>',
  '<p><b>Location: Open to candidates across China, not limited to 东京.</b></p>',
  '<p><b>Location: Open to candidates across China, not limited to 香港.</b></p>',
  '<p><b>Location: Open to candidates across China.</b> or Hong Kong</p>',
  '<p><b>Location: Outside China</b></p>','<p><b>Location:</b></p><p>Open to candidates across China.</p>']){
  const fetched=await capture(content);assert.equal(fetched.ok,true,content);
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched});assert.equal(result.jobs.length,0,content);
  assert.equal(result.truth.completenessVerified,true,content);
 }
 const partial=await capture('<p><b>Location: Open to candidates across China.</b></p>',true);
 const isolated=await runSourceCrawl(plan,{fetch:async()=>partial});
 assert.equal(isolated.truth.completenessVerified,true);assert.equal(isolated.jobs.length,1);assert.equal(isolated.fetchEvidence.jobQuarantines[0].sourceJobId,'1409962834');
 const badList=await capture('<p><b>Location: Open to candidates across China.</b></p>',true,true);
 const listIsolated=await runSourceCrawl(plan,{fetch:async()=>badList});assert.equal(listIsolated.truth.completenessVerified,true);assert.equal(listIsolated.jobs.length,1);assert.equal(listIsolated.fetchEvidence.jobQuarantines[0].code,'JOB_LIST_ROW_INVALID');
});
