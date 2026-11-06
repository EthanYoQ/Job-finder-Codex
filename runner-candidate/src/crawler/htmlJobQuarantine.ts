import {isDeepStrictEqual} from 'node:util';
import {load} from 'cheerio';
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

/** These list-only producers use the same HTML adapter in capture and replay.
 * Detail/PDF/partition producers keep their owning source-specific projections. */
export function hasHtmlRowQuarantine(plan:SourceCrawlPlan):plan is Extract<SourceCrawlPlan,{adapterId:'html-table'}>{
 return plan.adapterId==='html-table'&&['source-abbvie-china-social','source-takeda-china-social','source-viatris-social'].includes(plan.source.id);
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
  jobs.push(...result.jobs);
  for(const loss of result.reconciliation.adapterLosses){
   const row=rows[loss.rawIndex];if(!row)throw Error('HTML_JOB_QUARANTINE_ROW_MISSING');
   const id=plan.table.fields.sourceJobId?readField($,row,plan.table.fields.sourceJobId):undefined;
   const rawUrl=readField($,row,plan.table.fields.officialUrl);
   const officialUrl=rawUrl&&isSafeAdapterUrl(rawUrl,plan.source.officialEntryUrl)?sanitizeEvidenceHttpUrl(new URL(rawUrl,plan.source.officialEntryUrl).href):undefined;
   quarantines.push({pageSequence,recordIndex:loss.rawIndex,validJobId:page.rawJobIds[loss.rawIndex]!,rawLocator:`${page.artifactLogicalKey}#row:${loss.rawIndex}`,
    ...(id&&!containsSensitiveAdapterValue(id)?{sourceJobId:id}:{}),...(officialUrl?{officialUrl}:{}),code:'JOB_ROW_NORMALIZATION_FAILED'});
  }
 }
 return {jobs:reconcileAdapterRows(jobs.length,jobs.length,jobs,[]).jobs,quarantines};
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
