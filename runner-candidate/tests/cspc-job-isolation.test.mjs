import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {withLocalOfficialDom} from '../src/crawler/localOfficialSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
const channel='0beb3022-3214-4333-a2e7-20786c4916d5',id=n=>`${n}1111111-1111-4111-8111-111111111111`;
const encode=ids=>{const alphabet='y!89(*z02BCcdD_bEeGHIJKLmnNOPQopRMSTqrUklVstWXYZafgh3ij1uvwx456A7',standard='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';const wrapped=[...Buffer.from(ids.join(',')).toString('base64').replace(/=+$/,'')].map(c=>alphabet[standard.indexOf(c)]).join('')+'yyryrtweasdasd';return wrapped.slice(0,2)+wrapped.slice(-3)+wrapped.slice(2,-3);};
test('CSPC complete HTTP and DOM lists isolate one damaged row or native detail',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-cspc-social').plan,entry=plan.source.officialEntryUrl;
 for(const mode of ['good','title','two-unbound','invalid-id','foreign','dom-failure','unbound-dom-failure','dom-content','placeholder','duplicate','missing-page','wrong-list-set']){
  const rows=[1,2,3].map(n=>({REQUEST_ID:id(n),PUBLISH_NAME:`岗位${n}`,WORK_PLACE:'石家庄',JOB_DUTY:'研究工作',JOB_REQUEST:'具有实验能力'})),calls=[];
  if(mode==='title')rows[1].PUBLISH_NAME='';if(mode==='two-unbound')rows.splice(1,2,null,null);if(mode==='invalid-id')rows[1].REQUEST_ID='not-a-native-id';if(mode==='foreign')rows[1].WORK_PLACE='Tokyo, Japan';if(mode==='placeholder'){rows[1].JOB_DUTY='1';rows[1].JOB_REQUEST='1';}if(mode==='duplicate')rows[1]=rows[0];
  const fetchHttp=createOfficialJsonSourceFetch({http:async request=>{calls.push('HTTP');return {status:200,body:request.method==='POST'?JSON.stringify({state:'1',total:'',...(mode==='missing-page'?{hasNext:true}:{}),jsonList:rows}):request.url===entry?'<html>Official</html>':`<script>var requestId=${JSON.stringify(encode([id(1),id(2),id(3)]))};</script>`,finalUrl:request.url,contentType:request.method==='POST'?'application/json':'text/html',capturedAt:new Date().toISOString()};}});
  const fetch=withLocalOfficialDom(fetchHttp,async()=>{
   assert.equal(calls.length,3,'Full native HTTP list is acquired before supplemental DOM requests');calls.push('DOM');const at=new Date().toISOString();
   const domRows=[1,2,3].map((n,index)=>({officialId:mode==='wrong-list-set'&&n===2?id(4):id(n),sourceJobId:`${channel}:${id(n)}`,row:{index,title:rows[index]?.PUBLISH_NAME??`岗位${n}`,text:rows[index]?.PUBLISH_NAME??`岗位${n}`},url:entry+'?'+new URLSearchParams({jumpPageId:'detail',detailRequestId:id(n),rootId:'cspc',configId:channel,recruitWay:'e264521b-64fa-4e3b-aec7-720913ac635d'}),snapshot:`岗位${n} 岗位职责 投递 研究工作 具有实验能力`,clickStartedAt:at,navigationReadCompletedAt:at,readStartedAt:at,readCompletedAt:at}));
   if(mode==='dom-failure')domRows[1].captureFailure=true;if(mode==='unbound-dom-failure'){delete domRows[1].officialId;domRows[1].captureFailure=true;}if(mode==='dom-content')domRows[1].snapshot='Incomplete detail';
   return {dom:{schema:'dot-cloud-cdp-dom-navigation-observation-v1',purpose:'CURRENT_RUN_INDEPENDENT_DOM_OBSERVATION',sourceId:plan.source.id,entryUrl:entry,channelId:channel,networkCapture:false,sourceConfigurationCandidateCountIsOfficialTotal:false,applicationObservationsPending:false,listFilters:{keyword:'',selectedFilters:[]},observationStartedAt:at,observationCompletedAt:at,terminal:{disabledNextCount:1,disabledJumpNextCount:1,enabledNextCount:0,loadMoreCount:0,rowCount:3,readStartedAt:at,readCompletedAt:at},rows:domRows},applications:{schema:'dot-cloud-cdp-application-entry-observation-v1',sourceId:plan.source.id,observations:[]}};
  });
  if(mode==='wrong-list-set'){await assert.rejects(runSourceCrawl(plan,{fetch,isBaseline:false}));continue;}
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(['duplicate','missing-page','wrong-list-set'].includes(mode)){assert.equal(result.truth.completenessVerified,false,mode);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.observation)}`);
  assert.equal(result.jobs.length,mode==='good'?3:mode==='two-unbound'?1:2,mode);
  if(mode!=='good'){const e=structuredClone(result.fetchEvidence);assert.equal(e.jobQuarantines.length,mode==='two-unbound'?2:1);e.jobQuarantines[0].sourceJobId='incorrect';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:e,jobs:result.jobs,capturedAt:result.observation.crawledAt.toISOString(),paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation}),false);}
 }
});
