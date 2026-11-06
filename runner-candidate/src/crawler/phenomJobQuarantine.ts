import {isDeepStrictEqual} from 'node:util';
import {irreversibleOfficialJsonEvidenceId,persistentOfficialJsonJobId,safeOfficialJsonId} from './officialJsonEvidence';
import {sanitizeEvidenceHttpUrl,type PersistentSourceFetchEvidence} from './sourceFetchEvidence';
import {jobQuarantineLossesMatch,type JobQuarantine} from './jobQuarantine';
import type {SourceCrawlPlan} from './sourcePlan';
import {rocheNativeDetailUrl} from './rocheChinaQuality';

export function hasPhenomJobQuarantine(plan:SourceCrawlPlan):boolean{
 return plan.adapterId==='official-json'&&plan.officialJsonFetch?.kind==='phenom'&&['source-merck-china-social','source-ucb-china-social','source-lilly-china-social','source-organon-china-social','source-roche-china-social'].includes(plan.source.id);
}
export function phenomRawId(raw:unknown):string|undefined{
 if(!raw||typeof raw!=='object')return undefined;
 const row=raw as Record<string,unknown>;
 for(const value of [row.jobSeqNo,row.reqId,row.jobId])if(typeof value==='string'&&value.trim())return value.trim();
 return undefined;
}
export function phenomJobQuarantine(raw:unknown,pageSequence:number,recordIndex:number,pageKey:string,code:string):JobQuarantine{
 const id=phenomRawId(raw),known=id&&safeOfficialJsonId(id)?id:undefined;
 return {pageSequence,recordIndex,rawLocator:`${pageKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex,raw])}`,code,
  validJobId:known?irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId(known)):`unidentified:${pageSequence}:${recordIndex}`,...(known?{sourceJobId:persistentOfficialJsonJobId(known)}:{})};
}
/** Every quarantine remains tied to a physical row of the original complete list. */
export function verifyPhenomJobQuarantines(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence):boolean{
 try{
  if(!hasPhenomJobQuarantine(plan)||!jobQuarantineLossesMatch(evidence))return false;
  const config=plan.adapterId==='official-json'&&plan.officialJsonFetch;
  if(!config||config.kind!=='phenom')return false;
  const expectedKeys=new Set(evidence.pages.flatMap(page=>{
   const artifact=evidence.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey)!;
   return JSON.parse(artifact.body as string).refineSearch.data.jobs.flatMap((raw:Record<string,unknown>|null)=>raw?['lilly','organon','roche'].map(family=>`${family}-detail-${raw.reqId}`):[]);
  }));
  if(evidence.artifacts.some(a=>/^(?:lilly|organon|roche)-detail-/u.test(a.logicalKey)&&!expectedKeys.has(a.logicalKey)))return false;
  return evidence.jobQuarantines!.every(q=>{
   const page=evidence.pages[q.pageSequence]!,artifact=evidence.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey)!;
   const raw=JSON.parse(artifact.body as string).refineSearch.data.jobs[q.recordIndex];
   if(!isDeepStrictEqual(q,phenomJobQuarantine(raw,q.pageSequence,q.recordIndex,page.artifactLogicalKey,q.code)))return false;
   const detail=raw&&evidence.artifacts.find(a=>a.logicalKey===`${plan.source.id.includes('roche')?'roche':plan.source.id.includes('lilly')?'lilly':'organon'}-detail-${raw.reqId}`);
   if(detail){
    const expected=plan.source.id.includes('roche')?rocheNativeDetailUrl(raw):raw.applyUrl;
    if(!expected||detail.requestedUrl!==sanitizeEvidenceHttpUrl(expected)||detail.finalUrl!==detail.requestedUrl||detail.bodyRepresentation==='REDACTED')return false;
   }
   return true;
  });
 }catch{return false;}
}
