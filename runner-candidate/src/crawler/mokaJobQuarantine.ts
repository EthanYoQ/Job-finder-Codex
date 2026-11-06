import {isDeepStrictEqual} from 'node:util';
import {irreversibleOfficialJsonEvidenceId} from './officialJsonEvidence';
import type {PersistentSourceFetchEvidence} from './sourceFetchEvidence';
import type {MokaFetchConfig} from './sourcePlan';
import {requestContractV2Locator} from './strictPageRequestContract';
import type {JobQuarantine} from './jobQuarantine';

export function mokaRawJobId(raw:unknown):string|undefined{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
 const id=(raw as Record<string,unknown>).id;
 return typeof id==='string'?id.trim()||undefined:typeof id==='number'&&Number.isSafeInteger(id)?String(id):undefined;
}
export function mokaRawObservationId(raw:unknown,pageSequence:number,recordIndex:number):string{
 return irreversibleOfficialJsonEvidenceId(mokaRawJobId(raw)??['missing-id',pageSequence,recordIndex,raw]);
}
export function mokaJobQuarantine(raw:unknown,pageSequence:number,recordIndex:number,rawLocator:string,code:string):JobQuarantine{
 const id=mokaRawJobId(raw),sourceJobId=id?irreversibleOfficialJsonEvidenceId(id):undefined;
 return {pageSequence,recordIndex,rawLocator,code,validJobId:sourceJobId??`unidentified:${pageSequence}:${recordIndex}`,...(sourceJobId?{sourceJobId}:{})};
}
/** The owning replay still checks every list request, raw row, duplicate and good output. */
export function mokaQuarantineAt(evidence:PersistentSourceFetchEvidence,raw:unknown,pageSequence:number,recordIndex:number,rawLocator:string):JobQuarantine|undefined{
 const row=evidence.jobQuarantines?.find(q=>q.pageSequence===pageSequence&&q.recordIndex===recordIndex);
 if(!row)return;
 if(!isDeepStrictEqual(row,mokaJobQuarantine(raw,pageSequence,recordIndex,rawLocator,row.code)))throw Error('MOKA_JOB_QUARANTINE_IDENTITY_MISMATCH');
 return row;
}
export function mokaQuarantinedDetailKey(evidence:PersistentSourceFetchEvidence,row:JobQuarantine,id:string|undefined,config:MokaFetchConfig):string|undefined{
 const key=`moka-detail-${String(row.pageSequence).padStart(4,'0')}-${String(row.recordIndex).padStart(4,'0')}`,artifact=evidence.artifacts.find(a=>a.logicalKey===key);
 if(!artifact)return;
 const url='https://app.mokahr.com/api/outer/ats-apply/website/job';
 if(!id||artifact.requestedUrl!==url||artifact.extractorLocator!==requestContractV2Locator(`moka-detail-v2|request:jobId64=${Buffer.from(id,'utf8').toString('base64url')}`,
  {family:'moka',role:'detail',method:'POST',url,body:{orgId:config.expectedOrgId,siteId:config.expectedSiteId,jobId:id,locale:'zh-CN'},coordinate:{sequence:row.pageSequence,recordIndex:row.recordIndex}}))throw Error('MOKA_QUARANTINED_DETAIL_BINDING_INVALID');
 return key;
}
