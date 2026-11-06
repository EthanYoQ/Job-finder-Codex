import {isDeepStrictEqual} from 'node:util';
import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import type {AnyNode} from 'domhandler';
import type {HtmlTableConfig} from './adapters/types';
import {htmlTableAdapter,readField} from './adapters/htmlTable';
import {containsSensitiveAdapterValue,isSafeAdapterUrl} from './adapters/safeAdapterValue';
import {reconcileAdapterRows} from './adapters/reconciliation';
import {selectHtmlTableRows} from './htmlTableRows';
import {quarantineCompleteList,restoreQuarantinedList,JOB_QUARANTINE_PAGINATION,type JobQuarantine} from './jobQuarantine';
import {evaluatePaginationEvidence} from './paginationEvidence';
import {sanitizeEvidenceHttpUrl,type PersistentSourceFetchEvidence} from './sourceFetchEvidence';
import type {SourceCrawlPlan} from './sourcePlan';
import type {SourceFetchResult} from './runSourceCrawl';
import type {NormalizedJobRecord} from './normalizedJob';

/** A damaged row without an identity is an observation at a physical position. */
export function htmlRowObservationId($:ReturnType<typeof load>,row:AnyNode,table:HtmlTableConfig,pageSequence:number,recordIndex:number):string{
 const fields=table.fields;
 const url=readField($,row,fields.officialUrl);
 const known=fields.sourceJobId?readField($,row,fields.sourceJobId):fields.sourceJobIdParts?fields.sourceJobIdParts.every(field=>readField($,row,field)):url&&isSafeAdapterUrl(url,'https://identity.invalid');
 const raw=$.html(row),value=known?raw:JSON.stringify([pageSequence,recordIndex,raw]);
 return `html-row:sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** These list-only producers use the same HTML adapter in capture and replay.
 * Detail/PDF/partition producers keep their owning source-specific projections. */
export function hasHtmlRowQuarantine(plan:SourceCrawlPlan):plan is Extract<SourceCrawlPlan,{adapterId:'html-table'}>{
 return plan.adapterId==='html-table'&&['source-abbvie-china-social','source-takeda-china-social','source-viatris-social','source-astellas-china-social','source-qilu-social'].includes(plan.source.id);
}
export function reviewHtmlJobRows(plan:Extract<SourceCrawlPlan,{adapterId:'html-table'}>,evidence:PersistentSourceFetchEvidence,capturedAt:string,isBaseline:boolean):{jobs:NormalizedJobRecord[];quarantines:JobQuarantine[]}{
 const raw=restoreQuarantinedList(evidence),jobs:NormalizedJobRecord[]=[],quarantines:JobQuarantine[]=[];
 for(const [pageSequence,page] of raw.pages.entries()){
  const artifact=raw.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey);
  if(typeof artifact?.body!=='string')throw Error('HTML_JOB_QUARANTINE_ORIGINAL_MISSING');
  const html=plan.table.pagination?.ajaxMode==='talentbrew'?JSON.parse(artifact.body).results:artifact.body;
  if(typeof html!=='string')throw Error('HTML_JOB_QUARANTINE_ORIGINAL_INVALID');
  const input={company:plan.company,source:plan.source,table:plan.table,html,capturedAt,isBaseline};
  const result=htmlTableAdapter.extract(input),$=load(html),rows=selectHtmlTableRows($,plan.table);
  if(rows.length!==page.rawJobIds.length||!result.reconciliation)throw Error('HTML_JOB_QUARANTINE_ROW_COUNT_INVALID');
  const qiluIdentity=(value:string)=>{try{const u=new URL(value,plan.source.officialEntryUrl);return u.origin==='https://www.qilu-pharma.com'&&u.pathname.startsWith('/JobPosting_Detail/')&&!u.search&&!u.hash&&!u.username&&!u.password;}catch{return false;}};
  const wrongIdentity=plan.source.id==='source-qilu-social'?rows.flatMap((row,rawIndex)=>{const url=readField($,row,plan.table.fields.officialUrl);return url&&!qiluIdentity(url)?[{rawIndex}]:[];}):[];
  jobs.push(...result.jobs.filter(job=>plan.source.id!=='source-qilu-social'||qiluIdentity(job.officialUrl)));
  for(const loss of [...result.reconciliation.adapterLosses,...wrongIdentity.filter(row=>!result.reconciliation!.adapterLosses.some(loss=>loss.rawIndex===row.rawIndex))]){
   const row=rows[loss.rawIndex];if(!row)throw Error('HTML_JOB_QUARANTINE_ROW_MISSING');
   const id=plan.table.fields.sourceJobId?readField($,row,plan.table.fields.sourceJobId):undefined;
   const rawUrl=readField($,row,plan.table.fields.officialUrl);
   const officialUrl=rawUrl&&(plan.source.id!=='source-qilu-social'||qiluIdentity(rawUrl))&&isSafeAdapterUrl(rawUrl,plan.source.officialEntryUrl)?sanitizeEvidenceHttpUrl(new URL(rawUrl,plan.source.officialEntryUrl).href):undefined;
   quarantines.push({pageSequence,recordIndex:loss.rawIndex,validJobId:page.rawJobIds[loss.rawIndex]!,rawLocator:`${page.artifactLogicalKey}#row:${loss.rawIndex}`,
    ...(id&&!containsSensitiveAdapterValue(id)?{sourceJobId:id}:{}),...(officialUrl?{officialUrl}:{}),code:'JOB_ROW_NORMALIZATION_FAILED'});
  }
 }
 return {jobs:reconcileAdapterRows(jobs.length,jobs.length,jobs,[]).jobs,quarantines:quarantines.sort((a,b)=>a.pageSequence-b.pageSequence||a.recordIndex-b.recordIndex)};
}
export function isolateHtmlJobRows(plan:SourceCrawlPlan,fetched:SourceFetchResult):SourceFetchResult{
 if(!hasHtmlRowQuarantine(plan)||!fetched.ok||!fetched.fetchEvidence||!fetched.paginationEvaluation?.safeCompleteness||fetched.fetchEvidence.fetchLosses.length)return fetched;
 const reviewed=reviewHtmlJobRows(plan,fetched.fetchEvidence,fetched.capturedAt,true);
 if(!reviewed.quarantines.length)return fetched;
 const evidence=quarantineCompleteList(fetched.fetchEvidence,reviewed.quarantines);
 return {...fetched,fetchEvidence:evidence,paginationEvaluation:evaluatePaginationEvidence({evidence,expectedChannelIds:[...new Set(evidence.pages.flatMap(page=>page.channelId??[]))],filteredOutput:true,
  ...(plan.table.pagination?.ajaxMode===undefined?{allowMissingReturnedPage:true}:{}),...JOB_QUARANTINE_PAGINATION})};
}
export function replayHtmlJobRows(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,jobs:readonly NormalizedJobRecord[],capturedAt:string):boolean{
 if(!hasHtmlRowQuarantine(plan))return false;
 const reviewed=reviewHtmlJobRows(plan,evidence,capturedAt,jobs[0]?.isBaseline??true);
 return isDeepStrictEqual(reviewed.quarantines,evidence.jobQuarantines)&&isDeepStrictEqual(reviewed.jobs,jobs);
}
