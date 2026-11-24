import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createGrifolsChinaSourceFetch,validateStrictGrifolsChinaEvidence} from '../src/crawler/grifolsChinaSourceFetch.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {createHash} from 'node:crypto';
import {sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {issueAGradeOfficialTotalCertificate,verifyAGradeCompletenessCertificateReceipt} from '../src/crawler/completenessCertificate.ts';

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

test('Grifols a bad detail and a proven foreign exclusion do not block a verified sibling certificate',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-grifols-china-social'),at=new Date().toISOString();
 const url=n=>`https://jobsearch.grifols.com/job/Home-Office-Test/${1409962800+n}/`;
 const list=`<span class="paginationLabel">Results <b>1 – 3</b> of <b>3</b></span><table id="searchresults" aria-label="Search results for China. Page 1 of 1, Results 1 to 3 of 3"><tbody>${[1,2,3].map(n=>`<tr class="data-row"><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="${url(n)}">Synthetic role ${n}</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Home Office, CN</span></td></tr>`).join('')}</tbody></table>`;
 const fetched=createGrifolsChinaSourceFetch({now:()=>new Date(at),http:async request=>{
  if(request.url===plan.source.officialEntryUrl)return {status:200,body:list,finalUrl:request.url,contentType:'text/html',capturedAt:at};
  const n=[1,2,3].find(n=>request.url===url(n));assert(n);
  return {status:n===3?503:200,body:n===3?'Unavailable':`<link rel="canonical" href="${url(n)}"><div class="jobDisplayShell" itemscope itemtype="http://schema.org/JobPosting"><span itemprop="jobLocation"><span itemprop="address"><meta itemprop="streetAddress" content="Home Office, CN"></span></span><div class="jobDisplay"><div class="content"><p><b>Location: ${n===2?'APAC:Hong Kong:Home Office:Hong Kong':'Open to candidates across China.'}</b></p></div></div></div>`,finalUrl:request.url,contentType:'text/html',capturedAt:at};
 }});
 const result=await runSourceCrawl(plan,{fetch:fetched,isBaseline:false});assert.equal(result.truth.completenessVerified,true);assert.equal(result.jobs.length,1);assert.equal(result.fetchEvidence.jobQuarantines.length,1);
 const binding={releaseCandidateId:'synthetic-grifols',batchId:'synthetic-mixed',sourceResultId:'result-mixed',sourceConfigSha256:sourcePlanConfigSha256(plan)},official=result.fetchEvidence.artifacts.find(a=>a.logicalKey===result.fetchEvidence.declaredCompleteness.artifactLogicalKey);
 const decision=issueAGradeOfficialTotalCertificate({binding,plan,transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(official.body).digest('hex')});
 assert.equal(decision.status,'CERTIFIED',JSON.stringify(decision));assert.equal(decision.certificate.counts.finalUniqueJobCount,1);assert.equal(decision.certificate.legalScopeExclusionLedger.length,1);assert.equal(decision.certificate.jobQuarantineLedger.length,1);
 assert.equal(verifyAGradeCompletenessCertificateReceipt({certificate:JSON.parse(JSON.stringify(decision.certificate)),certificateSha256:decision.certificateSha256,expected:{...binding,sourceId:plan.source.id}}).status,'PASS');
});
