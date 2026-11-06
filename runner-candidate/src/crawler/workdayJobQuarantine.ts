import {isDeepStrictEqual} from 'node:util';
import {quarantineFetchLosses,jobQuarantineLossesMatch,type JobQuarantine} from './jobQuarantine';
import {sanitizeEvidenceHttpUrl,sha256Bytes,type PersistentSourceFetchEvidence} from './sourceFetchEvidence';
import {isSafeAdapterUrl} from './adapters/safeAdapterValue';
import type {SourceCrawlPlan} from './sourcePlan';

const hash=(value:string)=>sha256Bytes(Buffer.from(value,'utf8')).sha256;
export function hasWorkdayJobQuarantine(plan:SourceCrawlPlan):boolean{
 return plan.adapterId==='official-json'&&!!plan.workday&&['source-biogen-china-social','source-csl-china-social'].includes(plan.source.id);
}
function rowQuarantine(plan:SourceCrawlPlan,raw:unknown,pageSequence:number,recordIndex:number,rawLocator:string,code:string):JobQuarantine{
 const path=raw&&typeof raw==='object'&&'externalPath'in raw&&typeof raw.externalPath==='string'?raw.externalPath:undefined;
 const valid=path&&path.startsWith('/job/')&&!/[?#\u0000-\u001f\u007f]/u.test(path)&&isSafeAdapterUrl(path,plan.source.officialEntryUrl);
 const id=valid?`workday:sha256:${hash(path)}`:undefined;
 const site=plan.adapterId==='official-json'?plan.workday?.site:undefined;
 return {pageSequence,recordIndex,rawLocator,code,validJobId:id?`sha256:${hash(JSON.stringify(id))}`:`unidentified:${pageSequence}:${recordIndex}`,
  ...(id&&site?{sourceJobId:id,officialUrl:sanitizeEvidenceHttpUrl(new URL(plan.source.officialEntryUrl).origin+'/'+site+path)}:{})};
}
export function isolateWorkdayJobRows(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence):PersistentSourceFetchEvidence{
 if(!hasWorkdayJobQuarantine(plan))return evidence;
 return quarantineFetchLosses(evidence,loss=>{
  const pageSequence=loss.details.pageSequence,recordIndex=loss.details.recordIndex;
  if(pageSequence===undefined||recordIndex===undefined||!loss.details.code||loss.details.code.startsWith('DUPLICATE_'))return undefined;
  const page=evidence.pages[pageSequence],artifact=evidence.artifacts.find(a=>a.logicalKey===page?.artifactLogicalKey);if(!artifact)return undefined;
  const root=JSON.parse(typeof artifact.body==='string'?artifact.body:Buffer.from(artifact.body).toString('utf8'));
  return rowQuarantine(plan,root.jobPostings[recordIndex],pageSequence,recordIndex,loss.rawLocator,loss.details.code);
 });
}
export function verifyWorkdayJobQuarantines(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence):boolean{
 try{
  if(!hasWorkdayJobQuarantine(plan)||!jobQuarantineLossesMatch(evidence))return false;
  return evidence.jobQuarantines!.every(row=>{
   const page=evidence.pages[row.pageSequence],artifact=evidence.artifacts.find(a=>a.logicalKey===page?.artifactLogicalKey);if(!artifact)return false;
   const root=JSON.parse(typeof artifact.body==='string'?artifact.body:Buffer.from(artifact.body).toString('utf8')),raw=root.jobPostings[row.recordIndex];
   const locator=`${page!.artifactLogicalKey}#page-${row.pageSequence}#record-${row.recordIndex}#sha256:${hash(JSON.stringify(raw))}`;
   return isDeepStrictEqual(row,rowQuarantine(plan,raw,row.pageSequence,row.recordIndex,locator,row.code));
  });
 }catch{return false;}
}
