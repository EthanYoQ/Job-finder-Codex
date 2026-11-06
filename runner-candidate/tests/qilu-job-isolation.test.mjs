import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {createQiluDualPartitionSourceFetch,validateStrictQiluDualPartitionEvidence} from '../src/crawler/qiluDualPartitionSourceFetch.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
const at='2026-11-06T04:00:00.000Z',marketing='https://www.qilu-pharma.com/JobPosting_list.html';
const job=n=>({Id:`${n}1111111-1111-4111-8111-111111111111`,JobAdName:`Research role ${n}`,LocNames:['山东省·济南市'],Category:'社会招聘',CategoryId:'1',Status:1,Kind:'全职',JobAdId:n});
test('Qilu isolates bad jobs in either complete required partition',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-qilu-social').plan;
 for(const mode of ['good','marketing-title','marketing-url','marketing-foreign-url','marketing-two-errors','nonmarketing-title','new-city','location-alias','alternate-conflict','closed-status','missing-status','two-unbound','foreign','duplicate','missing-page','missing-chain']){
  const raw=[1,2,3].map(job);
  if(mode==='new-city'){raw[1].Country='China';raw[1].LocNames=['新的中国城市'];}if(mode==='location-alias'){raw[1].LocName='济南市';raw[1].City='济南';}if(mode==='closed-status')raw[1].Status=0;if(mode==='missing-status')delete raw[1].Status;if(mode==='alternate-conflict')raw[1].City='Tokyo';if(mode==='nonmarketing-title')raw[1].JobAdName='';if(mode==='two-unbound')raw.splice(1,2,null,null);if(mode==='foreign'){raw[1].Country='United States';raw[1].LocNames=['美国'];}if(mode==='duplicate')raw[1]=raw[0];
  const html=`<div class="e_loop-65">${[1,2,3].map(n=>`<div class="cbox-65 p_loopitem"><div class="e_text-83"><a href="${n===2&&mode==='marketing-url'?'https://[':(n===2&&mode==='marketing-foreign-url'||n===1&&mode==='marketing-two-errors')?'https://foreign.invalid/Role':'/JobPosting_Detail/'+n+'.html'}">${n===2&&['marketing-title','marketing-two-errors'].includes(mode)?'':'Marketing role '+n}</a></div><div class="e_text-86">济南</div></div>`).join('')}</div>${mode==='missing-chain'?'':'<a href="https://qilu-pharma.zhiye.com/social">社会招聘 非营销</a>'}`;
  const fetch=createQiluDualPartitionSourceFetch({now:()=>new Date(at),marketingHttp:async req=>({status:200,body:html,finalUrl:req.url,contentType:'text/html',capturedAt:at}),nonMarketingHttp:async req=>({status:200,body:JSON.stringify({Code:200,Count:mode==='missing-page'?16:raw.length,PageIndex:0,Data:raw}),finalUrl:req.url,contentType:'application/json',capturedAt:at})});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(['duplicate','missing-page','missing-chain'].includes(mode)){assert.equal(result.truth.completenessVerified,false,mode);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,pagination:result.paginationEvaluation,own:validateStrictQiluDualPartitionEvidence(plan,result.fetchEvidence,result.jobs)})}`);
  assert.equal(result.jobs.length,['good','new-city','location-alias'].includes(mode)?6:['two-unbound','marketing-two-errors'].includes(mode)?4:5,mode);
  assert.equal(validateStrictQiluDualPartitionEvidence(plan,result.fetchEvidence,result.jobs),true,mode);
  if(!['good','new-city','location-alias','foreign'].includes(mode)){const e=structuredClone(result.fetchEvidence);assert.equal(e.jobQuarantines.length,['two-unbound','marketing-two-errors'].includes(mode)?2:1);e.jobQuarantines[0].sourceJobId='incorrect';assert.equal(validateStrictQiluDualPartitionEvidence(plan,e,result.jobs),false);}
 }
});
