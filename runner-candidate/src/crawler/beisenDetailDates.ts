import { isDeepStrictEqual } from 'node:util';
import {quarantineCompleteList,JOB_QUARANTINE_PAGINATION,type JobQuarantine} from './jobQuarantine';
import {isBeisenListQuarantine,verifyBeisenListQuarantines,beisenRawObservationId} from './beisenJobQuarantine';
import {evaluatePaginationEvidence} from './paginationEvidence';
import { createHash } from 'node:crypto';
import type { SourceCrawlPlan } from './sourcePlan';
import type { SourceFetchResult } from './runSourceCrawl';
import type { NormalizedJobRecord } from './normalizedJob';
import { beisenZhiyeDetailUrl, citiesFromBeisenLocation, beisenDomesticRecordScopeReview, type OfficialJsonHttpClient } from './officialJsonSourceFetch';
import { officialJsonAdapter } from './adapters/officialJson';
import { officialJsonNetworkArtifact, persistentOfficialJsonJobId, irreversibleOfficialJsonEvidenceId } from './officialJsonEvidence';
import { sanitizeEvidenceHttpUrl, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft } from './sourceFetchEvidence';
import { hasUniqueJsonObjectKeys } from './strictJsonObjectKeys';
import { currentOfficialSourceAttemptSignal, officialHttpTimeoutMs } from './officialHttpRuntimeLimits';
import type { OfficialJsonHttpRequest, OfficialJsonHttpResponse } from './officialJsonSourceFetch';

const SOURCES = {
  'source-cttq-social': {companyId:'company-cttq',origin:'https://cttq.zhiye.com',portalId:'9e6ff1d5-1f08-4bbc-858c-d55e87fcb6d2'},
  'source-shanghai-pharma-social': {companyId:'company-shanghai-pharma',origin:'https://sph.zhiye.com',portalId:'7a15f32c-f4f2-4581-806c-d94b52cd9a7e'}
} as const;
const FIELDS=['jobAdName','Duty','Require','Category','Kind','LocId','PostDate','EndTime','Salary','Degree','YearsOfWorking','ClassificationOne','ClassificationTwo','Org','HeadCount'];
const POLICY='BEISEN_NATIVE_DETAIL_POSTDATE_V1';
const MAX_BODY=256*1024,MAX_RETAINED=16*1024*1024;
const clean=(s:string)=>s.replace(/\s+/gu,' ').trim();
const key=(id:string)=>`beisen-detail-${id}`;
function source(plan:SourceCrawlPlan){
  const value=SOURCES[plan.source.id as keyof typeof SOURCES];
  if(!value||plan.company.id!==value.companyId||plan.source.companyId!==value.companyId||plan.source.officialEntryUrl!==`${value.origin}/social/jobs`||plan.adapterId!=='official-json'||plan.officialJsonFetch?.kind!=='beisen-zhiye-2022'||plan.officialJsonFetch.category!=='1'||plan.officialJsonFetch.detailPath!=='social/detail'||plan.officialJsonFetch.geographyScope!=='DOMESTIC_OFFICIAL_TENANT'||plan.officialJsonFetch.detailPostedDatePolicy!==POLICY||plan.json.fields.officialPublishedAt!=='officialPublishedAt')throw Error('BEISEN_DETAIL_DATE_PLAN_INVALID');
  return value;
}
export function hasBeisenDetailDatePlan(plan:SourceCrawlPlan):boolean{
  return plan.adapterId==='official-json'&&plan.officialJsonFetch?.kind==='beisen-zhiye-2022'&&plan.officialJsonFetch.detailPostedDatePolicy===POLICY;
}
function url(plan:SourceCrawlPlan,id:string):string{
  const value=source(plan),out=new URL('/api/JobAd/GetJobAdInfo',value.origin);
  out.search=new URLSearchParams({jobAdId:id,category:'1',displayFields:JSON.stringify(FIELDS),portalId:value.portalId}).toString();return out.href;
}
function json(body:string|Uint8Array):Record<string,unknown>{
  const text=typeof body==='string'?body:Buffer.from(body).toString('utf8');
  if(!hasUniqueJsonObjectKeys(text))throw Error('BEISEN_DETAIL_DATE_JSON_INVALID');
  const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('BEISEN_DETAIL_DATE_JSON_INVALID');return value;
}
function rows(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence):Array<Record<string,unknown>&{Id:string;JobAdName:string;LocNames:string[];$pageSequence:number;$recordIndex:number}>{
  if(plan.adapterId!=='official-json'||plan.officialJsonFetch?.kind!=='beisen-zhiye-2022')throw Error('BEISEN_DETAIL_DATE_PLAN_INVALID');
  const config=plan.officialJsonFetch,size=config.pageSize??100;let total:number|undefined;
  const listQuarantines=(evidence.jobQuarantines??[]).filter(isBeisenListQuarantine);
  if(evidence.jobQuarantines?.length&&!verifyBeisenListQuarantines(plan,evidence))throw Error('BEISEN_JOB_QUARANTINE_INVALID');
  const result=evidence.pages.flatMap((page,index)=>{
    const artifact=evidence.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey);if(!artifact||artifact.logicalKey!==`beisen-page-${String(index).padStart(4,'0')}`||artifact.httpStatus!==200||artifact.bodyRepresentation==='REDACTED')throw Error('BEISEN_DETAIL_DATE_LIST_MISSING');
    const body=json(artifact.body),count=body.Count;
    if(body.Code!==200||!Array.isArray(body.Data)||typeof count!=='number'||!Number.isSafeInteger(count)||count<0||total!==undefined&&total!==count)throw Error('BEISEN_DETAIL_DATE_LIST_INVALID');
    total=count;const expectedPages=Math.max(1,Math.ceil(count/size)),next=index+1<expectedPages;
    if(evidence.pages.length!==expectedPages||expectedPages>(config.maxPages??50)||body.Data.length!==Math.min(size,count-index*size)||page.sequence!==index||page.requestedPage!==index||page.requestedPageSize!==size||page.returnedPage!==(body.PageIndex??null)||body.PageIndex!==undefined&&body.PageIndex!==index||page.declaredTotal!==count||page.nextPageSignalBefore!==(index===0?null:`page:${index}`)||page.nextPageSignalAfter!==(next?`page:${index+1}`:null)||page.termination!==(count===0?'EMPTY_PAGE':next?'CONTINUE':'NEXT_ABSENT')||page.responseFingerprintSha256!==createHash('sha256').update(artifact.body).digest('hex'))throw Error('BEISEN_DETAIL_DATE_PAGE_INVALID');
    const values=body.Data.flatMap((raw,recordIndex)=>{
      if(listQuarantines.some(q=>q.pageSequence===index&&q.recordIndex===recordIndex))return [];
      if(!raw||typeof raw!=='object'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(raw.Id)||typeof raw.JobAdName!=='string'||!Array.isArray(raw.LocNames)||!raw.LocNames.length||!raw.LocNames.every((v:unknown)=>typeof v==='string'&&v.trim())||raw.Category!=='社会招聘'||raw.CategoryId!=='1')throw Error('BEISEN_DETAIL_DATE_LIST_ROW_INVALID');
      const country=raw.Country??raw.CountryName;if(country!==undefined&&typeof country!=='string'||beisenDomesticRecordScopeReview(country,raw.LocNames,raw.LocNames.join(' / '),config.geographyScope,config.mixedLocationPolicy).scope!=='CHINA')throw Error('BEISEN_DETAIL_DATE_LIST_SCOPE_INVALID');
      return [{...raw,$pageSequence:index,$recordIndex:recordIndex}];
    });
    const rawIds=body.Data.map((raw,recordIndex)=>beisenRawObservationId(raw,index,recordIndex)).sort();
    const validIds=values.filter(row=>!evidence.jobQuarantines?.some(q=>!isBeisenListQuarantine(q)&&q.pageSequence===index&&q.recordIndex===row.$recordIndex)).map(raw=>irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId(raw.Id))).sort();
    if(new Set(rawIds).size!==body.Data.length||!isDeepStrictEqual([...page.rawJobIds].sort(),rawIds)||!isDeepStrictEqual([...page.validJobIds].sort(),validIds))throw Error('BEISEN_DETAIL_DATE_PAGE_IDS_INVALID');
    return values;
  });
  const quarantined=evidence.jobQuarantines?.length??0;
  if(total===undefined||result.length+listQuarantines.length!==total||evidence.fetchCounts.rawCount!==total||evidence.fetchCounts.parsedCount!==total||evidence.fetchCounts.validCount+quarantined!==total||evidence.fetchCounts.parseDiscardCount||evidence.fetchCounts.validationDiscardCount!==quarantined||evidence.fetchLosses.length!==quarantined||evidence.declaredCompleteness?.kind!=='OFFICIAL_TOTAL_COUNT'||evidence.declaredCompleteness.value!==total||evidence.declaredCompleteness.scope!=='SOURCE'||evidence.declaredCompleteness.artifactLogicalKey!==evidence.pages[0]!.artifactLogicalKey)throw Error('BEISEN_DETAIL_DATE_TOTAL_INVALID');
  return result;
}
/** The epoch and native China-local timestamp must independently agree.
 * Missing, sentinel, malformed or conflicting values remain unknown in raw evidence. */
export function beisenNativePublishedAt(raw:Record<string,unknown>):string|undefined{
  const value=raw.PostDate,epoch=raw.PostDateInt;
  const parts=typeof value==='string'?/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,7})?$/.exec(value):null;
  if(!parts||typeof epoch!=='number'||!Number.isSafeInteger(epoch)||epoch<=0)return undefined;
  const parsed=Date.parse(`${value}+08:00`);
  if(!Number.isFinite(parsed)||parsed!==epoch||new Date(parsed+8*3600000).toISOString().slice(0,19)!==parts[1])return undefined;
  return new Date(epoch).toISOString();
}
function verifyDetail(plan:SourceCrawlPlan,row:ReturnType<typeof rows>[number],artifact:SourceFetchArtifactDraft,capturedAt:string):string|undefined{
  const expected=sanitizeEvidenceHttpUrl(url(plan,row.Id)),started=Date.parse(capturedAt),observed=Date.parse(artifact.capturedAt);
  if(artifact.logicalKey!==key(row.Id)||artifact.kind!=='ATS_API_RESPONSE'||artifact.requestedUrl!==expected||artifact.finalUrl!==expected||artifact.httpStatus!==200||artifact.bodyRepresentation!=='EXACT'||artifact.extractorLocator!==POLICY||!Number.isFinite(started)||!Number.isFinite(observed)||observed<started||observed>started+30*60_000)throw Error('BEISEN_DETAIL_DATE_ARTIFACT_INVALID');
  const root=json(artifact.body),raw=root.Data as Record<string,unknown>|undefined;
  if(root.Code!==200||!raw||raw.Id!==row.Id||raw.JobAdName!==row.JobAdName||raw.CategoryId!=='1'||raw.Category!=='社会招聘'||raw.Status!==1||typeof raw.Kind==='string'&&/(?:校园|校招|campus)/iu.test(raw.Kind)||!isDeepStrictEqual(raw.LocNames,row.LocNames)||!(typeof raw.Duty==='string'&&raw.Duty.trim()||typeof raw.Require==='string'&&raw.Require.trim()))throw Error('BEISEN_DETAIL_DATE_IDENTITY_INVALID');
  return beisenNativePublishedAt(raw);
}
/** Dates enrich an already scoped list job. A missing date response is not a bad job;
 * a same-ID native scope conflict is isolated instead of blocking its company. */
function optionalDetail(plan:SourceCrawlPlan,row:ReturnType<typeof rows>[number],artifact:SourceFetchArtifactDraft|undefined,capturedAt:string):{quarantine:boolean;date?:string}{
  if(!artifact)return {quarantine:false};
  try{
    const data=json(artifact.body).Data as Record<string,unknown>|undefined;
    if(artifact.httpStatus===200&&data?.Id===row.Id&&(typeof data.Kind==='string'&&/(?:校园|校招|campus)/iu.test(data.Kind)||data.Category!==undefined&&data.Category!=='社会招聘'||data.CategoryId!==undefined&&data.CategoryId!=='1'||data.Status!==undefined&&data.Status!==1))return {quarantine:true};
    if(artifact.httpStatus===200&&data?.Id===row.Id){
      const country=data.Country??data.CountryName,locations=data.LocNames;
      if(typeof country==='string'||Array.isArray(locations)&&locations.length>0&&locations.every(v=>typeof v==='string'&&v.trim())){
        const parts=Array.isArray(locations)&&locations.every(v=>typeof v==='string')?locations as string[]:row.LocNames;
        if(beisenDomesticRecordScopeReview(typeof country==='string'?country:undefined,parts,parts.join(' / '),'DOMESTIC_OFFICIAL_TENANT').scope!=='CHINA')return {quarantine:true};
      }
    }
    const date=verifyDetail(plan,row,artifact,capturedAt);
    return {quarantine:false,...(date?{date}:{})};
  }catch{return {quarantine:false};}
}
function quarantineRow(plan:SourceCrawlPlan,row:ReturnType<typeof rows>[number],evidence:PersistentSourceFetchEvidence):JobQuarantine{
  if(plan.adapterId!=='official-json'||plan.officialJsonFetch?.kind!=='beisen-zhiye-2022')throw Error('BEISEN_DETAIL_DATE_PLAN_INVALID');
  const pageSequence=row.$pageSequence,recordIndex=row.$recordIndex;
  return {sourceJobId:persistentOfficialJsonJobId(row.Id),officialUrl:sanitizeEvidenceHttpUrl(beisenZhiyeDetailUrl(plan.source.officialEntryUrl,'social/detail',row.Id)),pageSequence,recordIndex,
    validJobId:irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId(row.Id)),rawLocator:`${evidence.pages[pageSequence]!.artifactLogicalKey}#row:${recordIndex}`,code:'JOB_SCOPE_UNRESOLVED'};
}
async function fetchDetail(request:OfficialJsonHttpRequest,sourceSignal:AbortSignal,onBlocked:()=>void):Promise<OfficialJsonHttpResponse>{
  const signal=AbortSignal.any([sourceSignal,AbortSignal.timeout(officialHttpTimeoutMs())]);signal.throwIfAborted();
  const response=await fetch(request.url,{method:'GET',headers:request.headers??{},redirect:'error',credentials:'omit',signal});
  if(response.status===403||response.status===429)onBlocked();
  const length=response.headers.get('content-length');
  if(response.url!==request.url||length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_BODY)){await response.body?.cancel();throw Error('BEISEN_DETAIL_RESPONSE_INVALID');}
  const reader=response.body?.getReader();if(!reader)throw Error('BEISEN_DETAIL_BODY_MISSING');
  const chunks:Uint8Array[]=[];let size=0;const aborted=()=>{void reader.cancel().catch(()=>undefined);};
  signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
  try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
    size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw Error('BEISEN_DETAIL_BODY_LIMIT');}chunks.push(value);
  }}finally{signal.removeEventListener('abort',aborted);reader.releaseLock();}
  return {status:response.status,body:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)),finalUrl:response.url,contentType:response.headers.get('content-type')??'application/octet-stream',capturedAt:new Date().toISOString()};
}
/** Only exact native public details are fetched for optional posted-date enrichment.
 * Native list rows and counts survive a partial request failure for diagnosis. */
export async function acquireBeisenDetailDates(plan:SourceCrawlPlan,fetched:SourceFetchResult,http?:OfficialJsonHttpClient,now:()=>Date=()=>new Date()):Promise<SourceFetchResult>{
  if(!hasBeisenDetailDatePlan(plan)||!fetched.ok)return fetched;
  if(!fetched.fetchEvidence||!('payload'in fetched)||fetched.fetchEvidence.fetchLosses.some(loss=>loss.details.code!=='JOB_QUARANTINED')||!fetched.paginationEvaluation?.safeCompleteness)return fetched;
  let list:ReturnType<typeof rows>;
  try{source(plan);list=rows(plan,fetched.fetchEvidence);}catch{return fetched;}
  const payload=fetched.payload as {jobs:Array<{sourceJobId:string;officialPublishedAt?:string}>};
  if(!Array.isArray(payload?.jobs)||list.length!==payload.jobs.length||new Set(list.map(r=>r.Id)).size!==list.length)return fetched;
  const elapsed=now().getTime()-Date.parse(fetched.capturedAt);
  if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=18*60_000)return fetched;
  const outer=currentOfficialSourceAttemptSignal(),signal=AbortSignal.any([AbortSignal.timeout(18*60_000-elapsed),...(outer?[outer]:[])]);
  const results:Array<SourceFetchArtifactDraft|undefined>=new Array(list.length);let cursor=0,blocked=false,reserved=0;
  let retained=fetched.fetchEvidence.artifacts.reduce((n,a)=>n+(typeof a.body==='string'?Buffer.byteLength(a.body):a.body.byteLength),0);
  const transport=http??((request)=>fetchDetail(request,signal,()=>{blocked=true;}));
  const worker=async()=>{while(cursor<list.length&&!blocked&&!signal.aborted){
    if(retained+reserved+MAX_BODY>MAX_RETAINED)return;reserved+=MAX_BODY;const i=cursor++,row=list[i]!;
    try{const requestedUrl=url(plan,row.Id),response=await transport({url:requestedUrl,method:'GET',headers:{langType:'zh_CN','X-Requested-With':'XMLHttpRequest',Referer:`${source(plan).origin}/social/detail?jobAdId=${row.Id}`}});
      if(Buffer.byteLength(response.body)>MAX_BODY)throw Error('BEISEN_DETAIL_BODY_LIMIT');
      const artifact=officialJsonNetworkArtifact({id:key(row.Id),logicalKey:key(row.Id),kind:'ATS_API_RESPONSE',requestedUrl,response,extractorLocator:POLICY,bodyRepresentation:'EXACT'});results[i]=artifact;retained+=Buffer.byteLength(response.body);
      if(response.status===403||response.status===429)blocked=true;
      const date=optionalDetail(plan,row,artifact,fetched.capturedAt).date,job=payload.jobs.find(j=>j.sourceJobId===persistentOfficialJsonJobId(row.Id));
      if(!job)throw Error('BEISEN_DETAIL_DATE_OUTPUT_ID_INVALID');if(date)job.officialPublishedAt=date;
    }catch{/* List identity and scope do not depend on supplementary date availability. */}
    finally{reserved-=MAX_BODY;}
  }};
  await Promise.all(Array.from({length:6},worker));
  const quarantines=list.flatMap((row,index)=>optionalDetail(plan,row,results[index],fetched.capturedAt).quarantine?[quarantineRow(plan,row,fetched.fetchEvidence!)]:[]);
  const heldIds=new Set(quarantines.map(row=>row.sourceJobId));payload.jobs=payload.jobs.filter(job=>!heldIds.has(job.sourceJobId));
  const evidence=quarantineCompleteList({...fetched.fetchEvidence,artifacts:[...fetched.fetchEvidence.artifacts,...results.filter((a):a is SourceFetchArtifactDraft=>a!==undefined)]},quarantines);
  return {...fetched,payload,fetchEvidence:evidence,paginationEvaluation:quarantines.length?evaluatePaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,...JOB_QUARANTINE_PAGINATION}):fetched.paginationEvaluation};
}
/** Supplementary detail bytes are individually validated before the unmodified
 * list-only A proof receives its own original page artifacts. */
export function replayBeisenDetailDates(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,jobs:readonly NormalizedJobRecord[],capturedAt:string):PersistentSourceFetchEvidence{
  source(plan);if(evidence.artifacts.some(a=>a.logicalKey.startsWith('beisen-detail-')&&Buffer.byteLength(a.body)>MAX_BODY)||evidence.artifacts.reduce((n,a)=>n+Buffer.byteLength(a.body),0)>MAX_RETAINED)throw Error('BEISEN_DETAIL_BODY_LIMIT');
  if(plan.adapterId!=='official-json')throw Error('BEISEN_DETAIL_DATE_PLAN_INVALID');
  const list=rows(plan,evidence),byId=new Map(jobs.map(j=>[j.sourceJobId,j])),quarantines:JobQuarantine[]=[...(evidence.jobQuarantines??[]).filter(isBeisenListQuarantine)];
  const pageKeys=new Set(evidence.pages.map(p=>p.artifactLogicalKey)),detailKeys=new Set(list.map(r=>key(r.Id)));
  if(byId.size!==jobs.length||detailKeys.size!==list.length||new Set(evidence.artifacts.map(a=>a.logicalKey)).size!==evidence.artifacts.length||evidence.artifacts.some(a=>!pageKeys.has(a.logicalKey)&&!detailKeys.has(a.logicalKey)))throw Error('BEISEN_DETAIL_DATE_ARTIFACT_SET_INVALID');
  for(const row of list){const artifact=evidence.artifacts.find(a=>a.logicalKey===key(row.Id)),job=byId.get(persistentOfficialJsonJobId(row.Id));
    const reviewed=optionalDetail(plan,row,artifact,capturedAt);
    if(reviewed.quarantine){if(job)throw Error('BEISEN_QUARANTINED_JOB_CANNOT_BE_CURRENT');quarantines.push(quarantineRow(plan,row,evidence));continue;}
    if(!job||job.officialTitle!==clean(row.JobAdName)||job.locationRaw!==clean(row.LocNames.join(' / ')))throw Error('BEISEN_DETAIL_DATE_OUTPUT_INVALID');
    const date=reviewed.date;
    const projected=officialJsonAdapter.extract({company:plan.company,source:plan.source,json:plan.json,capturedAt,isBaseline:job.isBaseline,payload:{jobs:[{sourceJobId:persistentOfficialJsonJobId(row.Id),title:row.JobAdName,officialUrl:beisenZhiyeDetailUrl(plan.source.officialEntryUrl,'social/detail',row.Id),locationRaw:row.LocNames.join(' / '),cities:citiesFromBeisenLocation(row.LocNames),...(date?{officialPublishedAt:date}:{})}]}});
    if(projected.status!=='SUCCESS'||projected.jobs.length!==1||!isDeepStrictEqual(projected.jobs[0],job))throw Error('BEISEN_DETAIL_DATE_OUTPUT_INVALID');
  }
  quarantines.sort((a,b)=>a.pageSequence-b.pageSequence||a.recordIndex-b.recordIndex);
  if(jobs.length+quarantines.length!==evidence.fetchCounts.rawCount||!isDeepStrictEqual(evidence.jobQuarantines??[],quarantines))throw Error('BEISEN_JOB_QUARANTINE_INVALID');
  return {...evidence,artifacts:evidence.artifacts.filter(a=>pageKeys.has(a.logicalKey))};
}
