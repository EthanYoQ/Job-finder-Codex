import {isDeepStrictEqual} from 'node:util';
import {quarantineFetchLosses,jobQuarantineLossesMatch,JOB_QUARANTINE_PAGINATION,type JobQuarantine} from './jobQuarantine';
import {evaluatePaginationEvidence} from './paginationEvidence';
import {irreversibleOfficialJsonEvidenceId,persistentOfficialJsonJobId} from './officialJsonEvidence';
import {sanitizeEvidenceHttpUrl,type PersistentSourceFetchEvidence} from './sourceFetchEvidence';
import type {SourceCrawlPlan} from './sourcePlan';
import type {SourceFetchResult} from './runSourceCrawl';

export function hasBeisenJobQuarantine(plan:SourceCrawlPlan):boolean{
 return plan.adapterId==='official-json'&&plan.officialJsonFetch?.kind==='beisen-zhiye-2022'&&
  ['source-cttq-social','source-shanghai-pharma-social','source-fosun-pharma-social','source-hansoh-social'].includes(plan.source.id);
}
export const isBeisenListQuarantine=(row:JobQuarantine)=>row.rawLocator.includes('#record:');
export function beisenQuarantineRow(plan:SourceCrawlPlan,raw:unknown,pageSequence:number,recordIndex:number,rawLocator:string,code:string):JobQuarantine{
 const id=raw&&typeof raw==='object'&&'Id'in raw&&typeof raw.Id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(raw.Id)?raw.Id.toLowerCase():undefined;
 const sourceJobId=id?persistentOfficialJsonJobId(id):undefined;
 const officialUrl=id?new URL('/social/detail',plan.source.officialEntryUrl):undefined;if(officialUrl)officialUrl.searchParams.set('jobAdId',id!);
 return {pageSequence,recordIndex,rawLocator,code,validJobId:sourceJobId?irreversibleOfficialJsonEvidenceId(sourceJobId):`unidentified:${pageSequence}:${recordIndex}`,
  ...(sourceJobId?{sourceJobId}:{}),...(officialUrl?{officialUrl:sanitizeEvidenceHttpUrl(officialUrl.href)}:{})};
}
export function verifyBeisenListQuarantines(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence):boolean{
 try{
  if(!hasBeisenJobQuarantine(plan)||!jobQuarantineLossesMatch(evidence))return false;
  if(evidence.jobQuarantines!.some(row=>!isBeisenListQuarantine(row))&&
    !(plan.adapterId==='official-json'&&plan.officialJsonFetch?.kind==='beisen-zhiye-2022'&&plan.officialJsonFetch.detailPostedDatePolicy==='BEISEN_NATIVE_DETAIL_POSTDATE_V1'))return false;
  return evidence.jobQuarantines!.filter(isBeisenListQuarantine).every(row=>{
   const page=evidence.pages[row.pageSequence],artifact=evidence.artifacts.find(a=>a.logicalKey===page?.artifactLogicalKey);
   if(!artifact)return false;
   const root=JSON.parse(typeof artifact.body==='string'?artifact.body:Buffer.from(artifact.body).toString('utf8')),raw=root.Data?.[row.recordIndex];
   const locator=`${page!.artifactLogicalKey}#record:${row.recordIndex}#${irreversibleOfficialJsonEvidenceId([row.recordIndex,raw])}`;
   return isDeepStrictEqual(row,beisenQuarantineRow(plan,raw,row.pageSequence,row.recordIndex,locator,row.code));
  });
 }catch{return false;}
}
/** Convert row failures only after the complete list traversal has returned.
 * Approved foreign exclusions and duplicate-identity failures retain their old rules. */
export function isolateBeisenJobRows(plan:SourceCrawlPlan,fetched:SourceFetchResult,keepForeignLoss:(raw:unknown)=>boolean):SourceFetchResult{
 if(!hasBeisenJobQuarantine(plan)||!fetched.ok||!fetched.fetchEvidence||!fetched.paginationEvaluation?.safeCompleteness)return fetched;
 const original=fetched.fetchEvidence,evidence=quarantineFetchLosses(original,loss=>{
  if(!loss.details.code||loss.details.code.startsWith('DUPLICATE_'))return undefined;
  const pageSequence=loss.details.pageSequence,recordIndex=loss.details.recordIndex;
  if(pageSequence===undefined||recordIndex===undefined)return undefined;
  const page=original.pages[pageSequence],artifact=original.artifacts.find(a=>a.logicalKey===page?.artifactLogicalKey);
  if(!page||!artifact)return undefined;
  const root=JSON.parse(typeof artifact.body==='string'?artifact.body:Buffer.from(artifact.body).toString('utf8')),raw=root.Data[recordIndex];
  if(loss.details.code==='OUT_OF_SCOPE'&&keepForeignLoss(raw))return undefined;
  return beisenQuarantineRow(plan,raw,pageSequence,recordIndex,loss.rawLocator,loss.details.code);
 });
 if(evidence===original)return fetched;
 return {...fetched,fetchEvidence:evidence,paginationEvaluation:evaluatePaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,...JOB_QUARANTINE_PAGINATION})};
}
