import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const channel='0beb3022-3214-4333-a2e7-20786c4916d5';
const entry=`https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/${channel}/officeWebsite.mob`;
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const same=(a:string[],b:string[],name:string)=>assert.deepEqual([...a].sort(),[...b].sort(),name);
const unique=(a:string[],name:string)=>assert.equal(new Set(a).size,a.length,name);
/** Supplemental PORTABLE review. Call only after the original exact HTTP archive replay passes.
 * DOM observations remain DOM observations; no network request or B certificate is fabricated. */
export function reviewCspcDomHttp(input:{dom:any;applications:any;plan:any;replayedEvidence:any;
  runStartedAt:string;dispatchBefore:string;now:string}) {
 const {dom,applications,plan,replayedEvidence}=input;
 assert.equal(plan.source.id,'source-cspc-social');assert.equal(plan.source.officialEntryUrl,entry);
 assert.equal(dom.schema,'dot-cloud-cdp-dom-navigation-observation-v1');
 assert.equal(dom.purpose,'CURRENT_RUN_INDEPENDENT_DOM_OBSERVATION');
 assert.equal(dom.sourceId,plan.source.id);assert.equal(dom.entryUrl,entry);assert.equal(dom.channelId,channel);
 assert.equal(dom.networkCapture,false);assert.equal(dom.sourceConfigurationCandidateCountIsOfficialTotal,false);
 assert.equal(dom.applicationObservationsPending,false);
 assert.deepEqual(dom.listFilters,{keyword:'',selectedFilters:[]},'UNFILTERED_SOCIAL_CHANNEL');
 const start=Date.parse(input.runStartedAt),deadline=Date.parse(input.dispatchBefore),now=Date.parse(input.now);
 assert(Number.isFinite(start)&&Number.isFinite(deadline)&&Number.isFinite(now)&&start<=now&&now<deadline,'CURRENT_CONTROL_WINDOW');
 const observed=(value:string)=>{const n=Date.parse(value);assert(Number.isFinite(n)&&n>=start&&n<=now&&n<deadline,'CURRENT_RUN_OBSERVATION_TIME');return n;};
 assert(observed(dom.observationStartedAt)<=observed(dom.observationCompletedAt));
 const identity=(value:string,id:string)=>{const u=new URL(value);assert.equal(u.origin+u.pathname,entry);assert.equal(u.searchParams.get('jumpPageId'),'detail');assert.equal(u.searchParams.get('detailRequestId'),id);assert.equal(u.searchParams.get('rootId'),'cspc');assert.equal(u.searchParams.get('configId'),channel);assert.equal(u.searchParams.get('recruitWay'),'e264521b-64fa-4e3b-aec7-720913ac635d');};
 assert(Array.isArray(dom.rows)&&dom.rows.length>0);const ids=dom.rows.map((r:any)=>r.officialId);unique(ids,'UNIQUE_DOM_IDS');
 unique(dom.rows.map((r:any)=>String(r.row.index)),'UNIQUE_LIST_ORDINALS');
 same(dom.rows.map((r:any)=>String(r.row.index)),dom.rows.map((_:any,i:number)=>String(i)),'COMPLETE_LIST_ORDINALS');
 const t=dom.terminal;assert.equal(t.disabledNextCount,1);assert.equal(t.disabledJumpNextCount,1);assert.equal(t.enabledNextCount,0);assert.equal(t.loadMoreCount,0);assert.equal(t.rowCount,ids.length);assert(observed(t.readStartedAt)<=observed(t.readCompletedAt));
 assert(typeof dom.listSnapshotAfter==='string'&&dom.listSnapshotAfter.includes('全部岗位'),'LIST_SCOPE');
 const api=replayedEvidence.artifacts.filter((a:any)=>a.logicalKey===`redsea-${channel}-api`);assert.equal(api.length,1);
 const response=JSON.parse(api[0].body);assert.equal(response.state,'1');assert.equal(response.total,'');assert(Array.isArray(response.jsonList));observed(api[0].capturedAt);
 const rows=response.jsonList,apiIds=rows.map((r:any)=>r.REQUEST_ID);unique(apiIds,'UNIQUE_HTTP_IDS');same(ids,apiIds,'DOM_HTTP_BIDIRECTIONAL_ID_SET');
 const byId=new Map<string,any>(rows.map((r:any)=>[r.REQUEST_ID,r]));
 for(const r of dom.rows){
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.officialId));identity(r.url,r.officialId);
  assert.equal(r.sourceJobId,`${channel}:${r.officialId}`);const raw=byId.get(r.officialId);
  assert.equal(r.row.title,raw.PUBLISH_NAME,'DOM_HTTP_TITLE');assert(r.row.text.includes(raw.PUBLISH_NAME));
  assert(typeof r.snapshot==='string'&&r.snapshot.includes(raw.PUBLISH_NAME)&&r.snapshot.includes('岗位职责')&&r.snapshot.includes('投递'),'DETAIL_DOM_LOADED');
  for(const field of ['JOB_DUTY','JOB_REQUEST']){assert(typeof raw[field]==='string'&&raw[field].trim(),'HTTP_DETAIL_PRESENT');for(const line of raw[field].split(/\r?\n/).map((v:string)=>v.trim()).filter(Boolean))assert(r.snapshot.replace(/\s/g,'').includes(line.replace(/\s/g,'')),'DOM_HTTP_DETAIL_CONTENT');}
  assert(observed(r.clickStartedAt)<=observed(r.navigationReadCompletedAt),'TRUE_CLICK_WINDOW');
  assert(observed(r.navigationReadCompletedAt)<=observed(r.readCompletedAt));assert(observed(r.readStartedAt)<=observed(r.readCompletedAt));
 }
 const insufficient=rows.filter((r:any)=>String(r.JOB_DUTY??'').trim()==='1'&&String(r.JOB_REQUEST??'').trim()==='1').map((r:any)=>r.REQUEST_ID);
 assert.equal(applications.schema,'dot-cloud-cdp-application-entry-observation-v1');assert.equal(applications.sourceId,plan.source.id);
 unique(applications.observations.map((r:any)=>r.officialId),'UNIQUE_APPLICATION_OBSERVATIONS');
 same(applications.observations.map((r:any)=>r.officialId),insufficient,'ALL_PLACEHOLDER_DETAILS_OBSERVED');
 for(const a of applications.observations){identity(a.url,a.officialId);assert.equal(a.sourceJobId,`${channel}:${a.officialId}`);
  assert.equal(a.detailState,'DETAIL_INSUFFICIENT');assert.equal(a.applicationState,'LOGIN_REQUIRED_POST_LOGIN_STATUS_UNVERIFIED');
  assert.equal(a.personalDataEntered,false);assert.equal(a.loginPerformed,false);assert.equal(a.applicationSubmitted,false);
  assert(observed(a.clickStartedAt)<=observed(a.clickCompletedAt));assert(observed(a.readStartedAt)<=observed(a.readCompletedAt));assert(observed(a.clickCompletedAt)<=observed(a.readCompletedAt));
  assert(typeof a.snapshot==='string'&&/登录/.test(a.snapshot)&&/密码|验证码|手机号/.test(a.snapshot),'LOGIN_REQUIRED_DOM');
 }
 const scopeArtifact=replayedEvidence.artifacts.find((a:any)=>a.logicalKey===`redsea-${channel}-candidate-scope`);
 const scope=scopeArtifact?JSON.parse(scopeArtifact.body):null;
 if(scope){assert.equal(scope.channelId,channel);same(scope.returnedIds,ids,'SCOPE_HTTP_IDS');assert.equal(scope.responseBodySha256,hash(api[0].body),'SCOPE_HTTP_HASH');assert.equal(scope.officialDeclaredTotal,null);}
 return {status:'PASS',retrievalPath:'CDP_DOM_NAVIGATION_PLUS_INDEPENDENT_HTTP',domSha256:hash(dom),applicationsSha256:hash(applications),httpBodySha256:hash(api[0].body),visibleIds:[...ids].sort(),detailInsufficientIds:insufficient,applicationState:'LOGIN_REQUIRED_POST_LOGIN_STATUS_UNVERIFIED',unexplainedCandidateIds:scope?.unexplainedCandidateIds??[],unexplainedCandidatesRemainUnknown:true,configurationCountIsOfficialTotal:false,observedAt:dom.observationStartedAt,checkedAt:input.now};
}
