import { isDeepStrictEqual } from 'node:util';
import { quarantineCompleteList, restoreQuarantinedList, JOB_QUARANTINE_PAGINATION, type JobQuarantine } from './jobQuarantine';
import { evaluatePaginationEvidence } from './paginationEvidence';
import { load } from 'cheerio';
import { ASTRAZENECA_DETAIL_CONFIG as CONFIG, ASTRAZENECA_DETAIL_PLAN_SHA256, astraZenecaDetailEnvelopeSchema, type AstraZenecaDetailClaim } from './astraZenecaDetailContract';
import { fetchAstraZenecaDetail, isAstraZenecaDetailUrl, reviewAstraZenecaDetailArtifact, type AstraZenecaDetailCapture } from './astraZenecaDetails';
import { astraZenecaListCity, astraZenecaTitleDisagrees, isAstraZenecaChina } from './astraZenecaLocations';
import { NormalizedJobRecordSchema, type NormalizedJobRecord } from './normalizedJob';
import { createHttpHtmlSourceFetch, type HttpHtmlClient } from './httpHtmlSourceFetch';
import { sourceAttemptTimeoutMs, currentOfficialSourceAttemptSignal, runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation } from './officialHttpRuntimeLimits';
import { parsePersistentSourceFetchEvidence, sha256Bytes, type PersistentSourceFetchEvidence } from './sourceFetchEvidence';
import { sourcePlanConfigSha256, type SourceCrawlPlan } from './sourcePlan';
import { validateStrictHtmlCompletenessProof } from './strictHtmlCompletenessProof';
import type { SourceFetchFunction, SourceFetchResult } from './runSourceCrawl';

const text=(s:string)=>s.normalize('NFC').replace(/\s+/gu,' ').trim();
export function hasAstraZenecaDetailPlan(plan:SourceCrawlPlan):boolean{
  return plan.adapterId==='html-table'&&plan.source.id==='source-astrazeneca-social'&&plan.company.id==='company-astrazeneca'&&sourcePlanConfigSha256(plan)===ASTRAZENECA_DETAIL_PLAN_SHA256;
}
function positiveInt(value:string|undefined):number{
  if(!value||!/^[1-9]\d*$/u.test(value)||!Number.isSafeInteger(Number(value)))throw Error('ASTRAZENECA_LIST_COUNT_INVALID');return Number(value);
}
/** Native inventory cardinality proves China scope; the country checkbox is not
 * claimed to be selected. Generic count/request/pagination proof stays mandatory. */
export function replayAstraZenecaList(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,capturedAt:string,isBaseline:boolean):NormalizedJobRecord[]{
  return reviewAstraZenecaList(plan,evidence,capturedAt,isBaseline).rows.map(row=>row.job);
}
function reviewAstraZenecaList(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,capturedAt:string,isBaseline:boolean):{rows:Array<{job:NormalizedJobRecord;pageSequence:number;recordIndex:number}>;quarantines:JobQuarantine[]}{
  if(!hasAstraZenecaDetailPlan(plan)||plan.adapterId!=='html-table'||evidence.astraZenecaDetails||evidence.astellasPdfLocations||!validateStrictHtmlCompletenessProof(plan,evidence))throw Error('ASTRAZENECA_LIST_PROOF_INVALID');
  const accepted:Array<{job:NormalizedJobRecord;pageSequence:number;recordIndex:number}>=[],quarantines:JobQuarantine[]=[];
  const seen=new Set<string>(),urls=new Set<string>();let retained=0;
  for(const [pageIndex,page] of evidence.pages.entries()){
    const artifact=evidence.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey)!;
    if(typeof artifact.body!=='string')throw Error('ASTRAZENECA_LIST_BODY_INVALID');
    retained+=Buffer.byteLength(artifact.body,'utf8');if(retained>CONFIG.maxRetainedBytes)throw Error('ASTRAZENECA_LIST_BUDGET_INVALID');
    if(page.responseFingerprintSha256!==sha256Bytes(Buffer.from(artifact.body,'utf8')).sha256)throw Error('ASTRAZENECA_LIST_FINGERPRINT_INVALID');
    const $=load(artifact.body),root=$('#search-results'),facets=$('input[data-facet-type="2"]');
    const total=positiveInt(root.attr('data-total-job-results')),pages=positiveInt(root.attr('data-total-pages'));
    if(root.length!==1||facets.length!==1||facets.attr('data-id')!=='1814991'||facets.attr('data-display')!=='中国'||positiveInt(facets.attr('data-count'))!==total||root.attr('data-total-results')!==String(total)||total!==evidence.fetchCounts.rawCount||pages!==evidence.pages.length||positiveInt(root.attr('data-current-page'))!==pageIndex+1||positiveInt(root.attr('data-records-per-page'))!==15||pages!==Math.ceil(total/15))throw Error('ASTRAZENECA_LIST_COUNTRY_OR_PAGE_INVALID');
    const facetId=facets.attr('id');const label=facetId?$(`label[for="${facetId}"]`):null;
    if(!label||label.length!==1||text(label.find('b.filter').text())!=='中国'||text(label.children('b').last().text())!==String(total))throw Error('ASTRAZENECA_LIST_COUNTRY_INVALID');
    const rows=$('#search-results-list li');if(rows.length!==(pageIndex===pages-1?total-pageIndex*15:15))throw Error('ASTRAZENECA_LIST_PAGE_CARDINALITY_INVALID');
    for(const [recordIndex,row] of rows.toArray().entries()){
      const el=$(row),a=el.find('a.search-results-link'),title=a.find('h2'),location=el.find('span.job-location');
      const id=a.attr('data-job-id')??'',officialTitle=text(title.text()),locationRaw=text(location.text());
      let officialUrl:string|undefined;try{officialUrl=new URL(a.attr('href')??'',plan.source.officialEntryUrl).href;}catch{}
      const identity=officialUrl!==undefined&&isAstraZenecaDetailUrl(officialUrl,id);
      if(identity&&(seen.has(id)||urls.has(officialUrl!)))throw Error('ASTRAZENECA_LIST_IDENTITY_INVALID');
      if(identity){seen.add(id);urls.add(officialUrl!);}
      let china=true;
      for(const indicator of el.find('[data-country],[data-country-code]').addBack('[data-country],[data-country-code]').toArray()){
        for(const attr of ['data-country','data-country-code']){const raw=$(indicator).attr(attr);if(raw!==undefined&&!isAstraZenecaChina(raw))china=false;}
      }
      const isolate=()=>quarantines.push({pageSequence:pageIndex,recordIndex,validJobId:page.rawJobIds[recordIndex]!,rawLocator:`${page.artifactLogicalKey}#row:${recordIndex}`,
        ...(identity?{sourceJobId:id,officialUrl}:{}),code:'JOB_LIST_ROW_INVALID'});
      if(!identity||a.length!==1||title.length!==1||location.length!==1||!china){isolate();continue;}
      const city=astraZenecaListCity(locationRaw),pending=!city||astraZenecaTitleDisagrees(officialTitle,[city]);
      const parsed=NormalizedJobRecordSchema.safeParse({companyId:plan.company.id,sourceId:plan.source.id,sourceKind:'SOCIAL',atsKind:plan.source.atsKind,officialChineseCompanyName:plan.company.officialChineseName,officialTitle,officialUrl,listUrl:plan.source.officialEntryUrl,sourceJobId:id,locationRaw,cities:pending?[CONFIG.pendingCity]:[city],category:plan.table.defaultCategory??'其他',isBaseline,evidence:{officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,capturedAt}});
      if(!parsed.success){isolate();continue;}
      accepted.push({job:parsed.data,pageSequence:pageIndex,recordIndex});
    }
  }
  if(accepted.length+quarantines.length!==evidence.fetchCounts.rawCount)throw Error('ASTRAZENECA_LIST_COUNT_INVALID');return {rows:accepted,quarantines};
}
/** Source-specific default/cap. Explicit caller and environment limits may only shorten it. */
export function astraZenecaSourceAttemptTimeoutMs(configuredTimeoutMs?:number,env:Readonly<Record<string,string|undefined>>=process.env):number{
  return Math.min(CONFIG.sourceTimeoutMs,configuredTimeoutMs??(env.P0_SOURCE_ATTEMPT_TIMEOUT_MS===undefined?CONFIG.sourceTimeoutMs:sourceAttemptTimeoutMs(env)));
}
/** The source-local owned list transport retains only complete bounded UTF-8 bodies.
 * Generic HTML pagination/replay stays unchanged. No caller transport hook is exposed. */
const fetchAstraZenecaListPage:HttpHtmlClient=async request=>{
  const source=currentOfficialSourceAttemptSignal();
  const signal=AbortSignal.any([AbortSignal.timeout(CONFIG.httpTimeoutMs),...(source?[source]:[])]);
  signal.throwIfAborted();
  const response=await fetch(request.url,{method:'GET',headers:request.headers,redirect:'error',credentials:'omit',signal});
  if(response.url!==request.url)throw Error('ASTRAZENECA_LIST_RESPONSE_INVALID');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>CONFIG.maxBodyBytes)){
    await response.body?.cancel();throw Error('ASTRAZENECA_LIST_BODY_TOO_LARGE');
  }
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader){
    const aborted=()=>{void reader.cancel().catch(()=>undefined);};
    signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();
    try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
      size+=value.byteLength;if(size>CONFIG.maxBodyBytes){await reader.cancel();throw Error('ASTRAZENECA_LIST_BODY_TOO_LARGE');}chunks.push(value);}}
    finally{signal.removeEventListener('abort',aborted);reader.releaseLock();}
  }
  return {status:response.status,body:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks,size)),
    finalUrl:response.url,contentType:response.headers.get('content-type')??'application/octet-stream',capturedAt:new Date().toISOString()};
};
/** Exact source constructor used by owned admission. The full list+detail
 * deadline is source-specific; existing cancellation remains authoritative. */
export function createAstraZenecaDetailSourceFetch():SourceFetchFunction{
  const list=createHttpHtmlSourceFetch({http:fetchAstraZenecaListPage});
  return async(plan,tracker)=>{
    if(!hasAstraZenecaDetailPlan(plan))throw Error('ASTRAZENECA_PLAN_INVALID');
    return runWithAstraZenecaSourceAttemptTimeout(async()=>acquireAstraZenecaDetails(plan,await list(plan,tracker)));
  };
}
/** Reserve bounded cleanup time INSIDE the hard source cap so abort-compliant
 * detail workers can retain all outcomes. The hard race remains authoritative. */
export async function runWithAstraZenecaSourceAttemptTimeout<T>(operation:()=>Promise<T>,timeoutMs=astraZenecaSourceAttemptTimeoutMs()):Promise<T>{
  const outer=currentOfficialSourceAttemptSignal(),stop=new AbortController();
  const maximum=Math.min(timeoutMs,CONFIG.sourceTimeoutMs);
  const reserve=Math.min(CONFIG.abortDrainMs,Math.max(1,Math.floor(maximum/5)));
  const timer=setTimeout(()=>stop.abort(),Math.max(0,maximum-reserve));
  try{return await runWithOfficialSourceAttemptTimeout(()=>runWithOfficialSourceCancellation(
    AbortSignal.any([stop.signal,...(outer?[outer]:[])]),operation),maximum);}
  finally{clearTimeout(timer);}
}
/** Only the owned constructor calls this in ordinary use. No transport injection.
 * Every native ID gets exactly one outcome, including cancellation and budgets. */
export async function acquireAstraZenecaDetails(plan:SourceCrawlPlan,fetched:SourceFetchResult):Promise<SourceFetchResult>{
  if(!hasAstraZenecaDetailPlan(plan))throw Error('ASTRAZENECA_PLAN_INVALID');
  if(!fetched.ok)return fetched;
  if(!('html'in fetched)||!fetched.fetchEvidence)throw Error('ASTRAZENECA_LIST_EVIDENCE_REQUIRED');
  const list=parsePersistentSourceFetchEvidence(fetched.fetchEvidence);
  let jobs:NormalizedJobRecord[];
  try{jobs=replayAstraZenecaList(plan,list,fetched.capturedAt,true);}
  catch{
    // No unproven list may drive detail requests. Preserve the original bytes and
    // diagnostic rows; the mandatory envelope gate explicitly holds this source.
    return fetched;
  }
  const captures:Array<AstraZenecaDetailCapture|undefined>=new Array(jobs.length);let cursor=0,retained=list.artifacts.reduce((n,a)=>n+(typeof a.body==='string'?Buffer.byteLength(a.body):a.body.byteLength),0),reserved=0,blocked=false;
  const localDeadline=AbortSignal.timeout(CONFIG.sourceTimeoutMs),stop=new AbortController();
  const signal=AbortSignal.any([localDeadline,stop.signal,...(currentOfficialSourceAttemptSignal()?[currentOfficialSourceAttemptSignal()!]:[])]);
  const worker=async()=>{while(cursor<jobs.length){
    const index=cursor++,job=jobs[index]!;
    if(blocked){captures[index]={ok:false,code:'DETAIL_NOT_ATTEMPTED_AFTER_BLOCK'};continue;}
    if(signal.aborted){captures[index]={ok:false,code:'DETAIL_CANCELLED'};continue;}
    if(retained+reserved+2*CONFIG.maxBodyBytes>CONFIG.maxRetainedBytes){captures[index]={ok:false,code:'DETAIL_RETAINED_BUDGET_EXCEEDED'};continue;}
    reserved+=2*CONFIG.maxBodyBytes;
    const captured=await fetchAstraZenecaDetail({...job,sourceJobId:job.sourceJobId!},{signal,onBotBlock:()=>{blocked=true;}});reserved-=2*CONFIG.maxBodyBytes;
    captures[index]=captured;if(captured.artifact)retained+=captured.artifact.body.length;if(captured.applicationArtifact)retained+=captured.applicationArtifact.body.length;
    if(!captured.ok&&captured.code==='DETAIL_BOT_BLOCKED'){blocked=true;stop.abort();}
  }};
  await Promise.all(Array.from({length:CONFIG.concurrency},worker));
  const artifacts=[...list.artifacts];
  const entries=jobs.map((job,i)=>{const capture=captures[i];if(!capture)throw Error('ASTRAZENECA_DETAIL_OUTCOME_MISSING');if(capture.artifact)artifacts.push(capture.artifact);if(capture.applicationArtifact)artifacts.push(capture.applicationArtifact);
    return {sourceJobId:job.sourceJobId!,officialUrl:job.officialUrl,...(capture.artifact?{artifactLogicalKey:capture.artifact.logicalKey}:{}),...(capture.applicationArtifact?{applicationArtifactLogicalKey:capture.applicationArtifact.logicalKey}:{}),outcome:capture.ok?{ok:true as const,evidence:capture.evidence}:{ok:false as const,code:capture.code}};});
  const complete=parsePersistentSourceFetchEvidence({...list,artifacts,astraZenecaDetails:{schemaVersion:'astrazeneca-owned-details-v1',policy:CONFIG.policy,sourceConfigSha256:sourcePlanConfigSha256(plan),listArtifactLogicalKeys:list.artifacts.map(a=>a.logicalKey),entries}});
  const replay=replayAstraZenecaDetails(plan,complete,fetched.capturedAt,true),fetchEvidence=quarantineCompleteList(complete,replay.quarantines);
  return {...fetched,fetchEvidence,paginationEvaluation:evaluatePaginationEvidence({evidence:fetchEvidence,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,allowPositiveOfficialTotalCountAfterAdapterReconciliation:true,...(replay.quarantines.length?JOB_QUARANTINE_PAGINATION:{})})};
}
export function replayAstraZenecaDetails(plan:SourceCrawlPlan,supplied:PersistentSourceFetchEvidence,capturedAt:string,isBaseline:boolean):{listEvidence:PersistentSourceFetchEvidence;jobs:NormalizedJobRecord[];quarantines:JobQuarantine[];detailComplete:boolean;scopeReviewRequired:boolean}{
  if(!hasAstraZenecaDetailPlan(plan))throw Error('ASTRAZENECA_PLAN_INVALID');
  const evidence=parsePersistentSourceFetchEvidence(supplied),envelope=astraZenecaDetailEnvelopeSchema.parse(evidence.astraZenecaDetails);
  if(envelope.sourceConfigSha256!==sourcePlanConfigSha256(plan))throw Error('ASTRAZENECA_DETAIL_CONFIG_INVALID');
  const {astraZenecaDetails:_envelope,...base}=restoreQuarantinedList(evidence);
  const listEvidence=parsePersistentSourceFetchEvidence({...base,artifacts:envelope.listArtifactLogicalKeys.map(key=>{const artifact=evidence.artifacts.find(a=>a.logicalKey===key);if(!artifact)throw Error('ASTRAZENECA_LIST_ARTIFACT_MISSING');return artifact;})});
  const listReview=reviewAstraZenecaList(plan,listEvidence,capturedAt,isBaseline),jobs=listReview.rows.map(row=>row.job);
  const keys=[...envelope.listArtifactLogicalKeys,...envelope.entries.flatMap(e=>[e.artifactLogicalKey,e.applicationArtifactLogicalKey].filter((key):key is string=>key!==undefined))];
  if(envelope.entries.length!==jobs.length||new Set(keys).size!==keys.length||keys.length!==evidence.artifacts.length||evidence.artifacts.some(a=>!keys.includes(a.logicalKey)))throw Error('ASTRAZENECA_DETAIL_ARTIFACT_SET_INVALID');
  let retained=listEvidence.artifacts.reduce((n,a)=>n+Buffer.byteLength(a.body as string),0),detailComplete=true,scopeReviewRequired=false;
  const quarantines:JobQuarantine[]=[...listReview.quarantines],accepted:NormalizedJobRecord[]=[];
  const hasBlock=envelope.entries.some(e=>!e.outcome.ok&&e.outcome.code==='DETAIL_BOT_BLOCKED');
  for(const [index,job] of jobs.entries()){
    const entry=envelope.entries[index]!;
    if(entry.sourceJobId!==job.sourceJobId||entry.officialUrl!==job.officialUrl)throw Error('ASTRAZENECA_DETAIL_ROW_BINDING_INVALID');
    const artifact=entry.artifactLogicalKey?evidence.artifacts.find(a=>a.logicalKey===entry.artifactLogicalKey):undefined;
    const applicationArtifact=entry.applicationArtifactLogicalKey?evidence.artifacts.find(a=>a.logicalKey===entry.applicationArtifactLogicalKey):undefined;
    if(applicationArtifact&&!artifact)throw Error('ASTRAZENECA_DETAIL_ARTIFACT_MISSING');
    if(applicationArtifact)retained+=typeof applicationArtifact.body==='string'?Buffer.byteLength(applicationArtifact.body):applicationArtifact.body.byteLength;
    let claim:AstraZenecaDetailClaim|undefined;
    if(artifact){
      retained+=typeof artifact.body==='string'?Buffer.byteLength(artifact.body):artifact.body.byteLength;
      if(retained>CONFIG.maxRetainedBytes)throw Error('ASTRAZENECA_DETAIL_RETAINED_BUDGET_INVALID');
      const replay=reviewAstraZenecaDetailArtifact(artifact,{...job,sourceJobId:job.sourceJobId!},applicationArtifact);
      if(replay.ok){if(!entry.outcome.ok||!isDeepStrictEqual(replay.evidence,entry.outcome.evidence))throw Error('ASTRAZENECA_DETAIL_CLAIM_INVALID');claim=replay.evidence;}
      else if(entry.outcome.ok||(entry.outcome.code!==replay.code&&!(replay.code==='DETAIL_APPLICATION_REQUIRED'&&!applicationArtifact&&['DETAIL_RESPONSE_INVALID','DETAIL_BODY_TOO_LARGE','DETAIL_TRANSPORT_FAILED','DETAIL_CANCELLED','DETAIL_BOT_BLOCKED'].includes(entry.outcome.code))))throw Error('ASTRAZENECA_DETAIL_FAILURE_INVALID');
    }else if(entry.outcome.ok||!['DETAIL_RESPONSE_INVALID','DETAIL_BODY_TOO_LARGE','DETAIL_TRANSPORT_FAILED','DETAIL_CANCELLED','DETAIL_RETAINED_BUDGET_EXCEEDED','DETAIL_NOT_ATTEMPTED_AFTER_BLOCK','DETAIL_BOT_BLOCKED'].includes(entry.outcome.code))throw Error('ASTRAZENECA_DETAIL_ARTIFACT_MISSING');
    if(!entry.outcome.ok&&entry.outcome.code==='DETAIL_NOT_ATTEMPTED_AFTER_BLOCK'&&!hasBlock)throw Error('ASTRAZENECA_DETAIL_FAILURE_INVALID');
    if(!claim)detailComplete=false;
    if(claim?.scopeReviewCodes.length||(!entry.outcome.ok&&entry.outcome.code==='DETAIL_COUNTRY_INVALID'))scopeReviewRequired=true;
    job.cities=claim?[...claim.cities]:[CONFIG.pendingCity];
    job.evidence.astraZenecaDetail={...(claim?{country:'中国' as const}:{sourceCountryContext:'中国' as const}),status:claim?.locationStatus??'UNRESOLVED',listLocationRaw:job.locationRaw,
      ...(artifact?{artifactLogicalKey:artifact.logicalKey,bodySha256:sha256Bytes(artifact.body instanceof Uint8Array?artifact.body:Buffer.from(artifact.body)).sha256}:{}),
      ...(claim?{requisitionId:claim.requisitionId,detailLocations:claim.locations,...(claim.postedDay?{postedDay:claim.postedDay}:{}),...(claim.dateConflict?{dateConflict:claim.dateConflict}:{}),...(claim.application?{application:claim.application}:{}),scopeReviewCodes:claim.scopeReviewCodes,...(claim.employmentTypeRaw?{employmentTypeRaw:claim.employmentTypeRaw}:{}),...(claim.occupationalCategoryRaw?{occupationalCategoryRaw:claim.occupationalCategoryRaw}:{})}:{}),
      ...(!entry.outcome.ok?{failureCode:entry.outcome.code}:{})};
    if(!claim||claim.scopeReviewCodes.length){
      const {recordIndex,pageSequence}=listReview.rows[index]!;
      quarantines.push({sourceJobId:job.sourceJobId,officialUrl:job.officialUrl,pageSequence,recordIndex,validJobId:listEvidence.pages[pageSequence]!.rawJobIds[recordIndex]!,
        rawLocator:`${listEvidence.pages[pageSequence]!.artifactLogicalKey}#row:${recordIndex}`,code:claim?'JOB_SCOPE_UNRESOLVED':'JOB_DETAIL_UNAVAILABLE'});
    }else accepted.push(job);
  }
  quarantines.sort((a,b)=>a.pageSequence-b.pageSequence||a.recordIndex-b.recordIndex);
  if(evidence.jobQuarantines!==undefined&&!isDeepStrictEqual(evidence.jobQuarantines,quarantines))throw Error('ASTRAZENECA_JOB_QUARANTINE_INVALID');
  return {listEvidence:quarantineCompleteList(listEvidence,quarantines),jobs:accepted,quarantines,detailComplete,scopeReviewRequired};
}
