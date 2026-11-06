import {redseaNativeJobId} from './redseaCandidateScope';
import {isDeepStrictEqual as same} from 'node:util';
import {normalizeRedseaJob} from './officialJsonSourceFetch';
import {officialJsonAdapter} from './adapters/officialJson';
import {jobQuarantineLoss,quarantineFetchLosses,quarantineCompleteList,jobQuarantineLossesMatch,JOB_QUARANTINE_PAGINATION,type JobQuarantine} from './jobQuarantine';
import {irreversibleOfficialJsonEvidenceId,persistentOfficialJsonJobId} from './officialJsonEvidence';
import {evaluatePaginationEvidence} from './paginationEvidence';
import {sanitizeEvidenceHttpUrl,type PersistentSourceFetchEvidence} from './sourceFetchEvidence';
import type {SourceCrawlPlan} from './sourcePlan';
import type {SourceFetchResult} from './runSourceCrawl';
import type {NormalizedJobRecord} from './normalizedJob';
export function hasRedseaJobQuarantine(plan:SourceCrawlPlan):boolean{return plan.source.id==='source-cspc-social'&&plan.adapterId==='official-json'&&plan.officialJsonFetch?.kind==='redsea-zp-channel';}
const id=(raw:any)=>redseaNativeJobId(raw?.REQUEST_ID);
export const redseaRawObservationId=(raw:unknown,page:number,index:number)=>irreversibleOfficialJsonEvidenceId(id(raw)??[page,index,raw]);
function rowAt(evidence:PersistentSourceFetchEvidence,page:number,index:number):unknown{const p=evidence.pages[page]!,a=evidence.artifacts.find(a=>a.logicalKey===p.artifactLogicalKey)!;return JSON.parse(String(a.body)).jsonList[index];}
function quarantine(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,pageSequence:number,recordIndex:number,unboundDom=false):JobQuarantine{
 const raw=rowAt(evidence,pageSequence,recordIndex),nativeId=id(raw),page=evidence.pages[pageSequence]!,channel=page.channelId!;
 const u=new URL(plan.source.officialEntryUrl);u.search=new URLSearchParams({jumpPageId:'detail',detailRequestId:nativeId??'',rootId:'cspc'}).toString();
 return {pageSequence,recordIndex,rawLocator:`${page.artifactLogicalKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex,raw])}`,validJobId:nativeId?persistentOfficialJsonJobId(nativeId):redseaRawObservationId(raw,pageSequence,recordIndex),code:unboundDom?'CSPC_DOM_IDENTITY_UNRESOLVED':'CSPC_JOB_UNVERIFIED',...(nativeId&&!unboundDom?{sourceJobId:`${channel}:${nativeId}`,officialUrl:sanitizeEvidenceHttpUrl(u.href)}:{})};
}
export function isolateRedseaJobs(plan:SourceCrawlPlan,fetched:SourceFetchResult,failedIndices:readonly number[]=[],unboundDomIndices:readonly number[]=[]):SourceFetchResult{
 if(!hasRedseaJobQuarantine(plan)||!fetched.ok||!fetched.fetchEvidence||!fetched.paginationEvaluation?.safeCompleteness)return fetched;
 let evidence=quarantineFetchLosses(fetched.fetchEvidence,loss=>{
  if(loss.details.code.startsWith('DUPLICATE_')||loss.details.code==='CONFLICTING_OFFICIAL_ID')return undefined;
  const page=loss.details.pageSequence,index=loss.details.recordIndex;return page!==undefined&&index!==undefined?quarantine(plan,fetched.fetchEvidence!,page,index):undefined;
 });
 const rows=[...new Set(failedIndices)].filter(index=>!evidence.jobQuarantines?.some(q=>q.pageSequence===0&&q.recordIndex===index)).map(index=>quarantine(plan,evidence,0,index,unboundDomIndices.includes(index)));
 evidence=quarantineCompleteList(evidence,rows);
 if(unboundDomIndices.length){const changed=(evidence.jobQuarantines??[]).map(q=>unboundDomIndices.includes(q.recordIndex)?quarantine(plan,evidence,q.pageSequence,q.recordIndex,true):q);
  evidence={...evidence,jobQuarantines:changed,fetchLosses:evidence.fetchLosses.map(loss=>{const q=changed.find(q=>q.rawLocator===loss.rawLocator);return q?jobQuarantineLoss(q,evidence.pages[q.pageSequence]!.capturedAt):loss;})};
 }
 const held=new Set(evidence.jobQuarantines?.flatMap(q=>{const native=id(rowAt(evidence,q.pageSequence,q.recordIndex));return native?[`${evidence.pages[q.pageSequence]!.channelId}:${native}`]:[];}));
 const payload='payload'in fetched?fetched.payload as {jobs:any[]}:undefined;
 return {...fetched,...(payload?{payload:{...payload,jobs:payload.jobs.filter(job=>!held.has(job.sourceJobId))}}:{}),fetchEvidence:evidence,
  paginationEvaluation:evaluatePaginationEvidence({evidence,expectedChannelIds:evidence.pages.map(p=>p.channelId!),filteredOutput:true,...JOB_QUARANTINE_PAGINATION})};
}
export function replayRedseaJobs(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,output:readonly NormalizedJobRecord[],capturedAt:string):boolean{
 try{
  if(!hasRedseaJobQuarantine(plan)||plan.adapterId!=='official-json'||evidence.pages.length!==1||evidence.jobQuarantines?.length&&!jobQuarantineLossesMatch(evidence))return false;
  const page=evidence.pages[0]!,a=evidence.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey)!,raw=JSON.parse(String(a.body)).jsonList as unknown[],jobs:any[]=[],losses:PersistentSourceFetchEvidence['fetchLosses']=[],expectedQ:JobQuarantine[]=[];
  for(const [index,value] of raw.entries()){
   const held=evidence.jobQuarantines?.find(q=>q.pageSequence===0&&q.recordIndex===index);
   if(held){const q=quarantine(plan,evidence,0,index,held.code==='CSPC_DOM_IDENTITY_UNRESOLVED');if(!same(q,held))return false;expectedQ.push(q);losses.push(jobQuarantineLoss(q,page.capturedAt));continue;}
   const row=normalizeRedseaJob({origin:new URL(plan.source.officialEntryUrl).origin,channelQrId:page.channelId!,rootId:'cspc',job:value});if(!row.ok)return false;jobs.push(row.job);
  }
  if(!same(expectedQ,evidence.jobQuarantines??[])||!same(losses,evidence.fetchLosses)||!same(page.rawJobIds,raw.map((v,n)=>redseaRawObservationId(v,0,n)))||!same(page.validJobIds,jobs.map(j=>persistentOfficialJsonJobId(j.sourceJobId.split(':').at(-1)!))))return false;
  const result=officialJsonAdapter.extract({company:plan.company,source:plan.source,json:plan.json,payload:{jobs},capturedAt,isBaseline:output[0]?.isBaseline??true});
  return result.status==='SUCCESS'&&same(result.jobs,output);
 }catch{return false;}
}
