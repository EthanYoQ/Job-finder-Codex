import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl, type PersistentSourceFetchEvidence } from './sourceFetchEvidence';
import type { JobSnapshot } from './lifecycle';

export type JobQuarantine = NonNullable<PersistentSourceFetchEvidence['jobQuarantines']>[number];
export const JOB_QUARANTINE_PAGINATION = {
  allowPositiveOfficialTotalCountAfterAdapterReconciliation:true,
  allowIndependentlyVerifiedProfileBoundExclusions:true
} as const;

export function jobQuarantineLossesMatch(evidence:PersistentSourceFetchEvidence):boolean {
  const rows=evidence.jobQuarantines??[],losses=evidence.fetchLosses.filter(loss=>loss.details?.code==='JOB_QUARANTINED');
  return rows.length>0&&rows.length===losses.length&&new Set(rows.map(row=>`${row.pageSequence}:${row.recordIndex}`)).size===rows.length&&new Set(rows.map(row=>row.rawLocator)).size===rows.length&&rows.every(row=>
    evidence.pages[row.pageSequence]?.rawJobIds[row.recordIndex]!==undefined&&!evidence.pages[row.pageSequence]!.validJobIds.includes(row.validJobId)&&losses.some(loss=>loss.stage==='VALIDATION'&&loss.rawLocator===row.rawLocator&&
      loss.details.noteCode===row.code&&loss.details.pageSequence===row.pageSequence&&loss.details.recordIndex===row.recordIndex));
}

export function jobQuarantineLoss(row:JobQuarantine,recordedAt:string):PersistentSourceFetchEvidence['fetchLosses'][number] {
  return {stage:'VALIDATION',reason:'Job could not be verified; preserve prior data',rawLocator:row.rawLocator,
    details:{code:'JOB_QUARANTINED',noteCode:row.code,pageSequence:row.pageSequence,recordIndex:row.recordIndex},recordedAt};
}
/** Failed list rows are already absent from valid output; only their loss accounting changes. */
export function quarantineFetchLosses(evidence:PersistentSourceFetchEvidence,identify:(loss:PersistentSourceFetchEvidence['fetchLosses'][number])=>JobQuarantine|undefined):PersistentSourceFetchEvidence{
  const rows:JobQuarantine[]=[],counts={...evidence.fetchCounts};
  const fetchLosses=evidence.fetchLosses.map(loss=>{
    if(loss.details.code==='JOB_QUARANTINED')return loss;
    const row=identify(loss);if(!row)return loss;rows.push(row);
    if(loss.stage==='PARSE'){counts.parseDiscardCount--;counts.parsedCount++;counts.validationDiscardCount++;}
    return jobQuarantineLoss(row,loss.recordedAt??evidence.pages[row.pageSequence]!.capturedAt);
  });
  if(!rows.length)return evidence;
  return parsePersistentSourceFetchEvidence({...evidence,jobQuarantines:[...(evidence.jobQuarantines??[]),...rows].sort((a,b)=>a.pageSequence-b.pageSequence||a.recordIndex-b.recordIndex),fetchCounts:counts,fetchLosses});
}

/** Used after the list has closed; the original raw rows and page boundaries remain intact. */
export function quarantineCompleteList(evidence:PersistentSourceFetchEvidence,rows:JobQuarantine[]):PersistentSourceFetchEvidence {
  if(!rows.length)return evidence;
  const byPage=new Map<number,Set<string>>();
  for(const row of rows){
    const page=evidence.pages[row.pageSequence],id=row.validJobId;
    if(!page||page.rawJobIds[row.recordIndex]===undefined||!page.validJobIds.includes(id))throw Error('JOB_QUARANTINE_LIST_POSITION_INVALID');
    const own=byPage.get(row.pageSequence)??new Set<string>();
    if(own.has(id))throw Error('JOB_QUARANTINE_DUPLICATE_LIST_POSITION');
    own.add(id);byPage.set(row.pageSequence,own);
  }
  return parsePersistentSourceFetchEvidence({...evidence,jobQuarantines:[...(evidence.jobQuarantines??[]),...rows].sort((a,b)=>a.pageSequence-b.pageSequence||a.recordIndex-b.recordIndex),
    pages:evidence.pages.map((page,i)=>({...page,validJobIds:page.validJobIds.filter(id=>!byPage.get(i)?.has(id))})),
    fetchCounts:{...evidence.fetchCounts,validCount:evidence.fetchCounts.validCount-rows.length,validationDiscardCount:evidence.fetchCounts.validationDiscardCount+rows.length},
    fetchLosses:[...evidence.fetchLosses,...rows.map(row=>jobQuarantineLoss(row,evidence.pages[row.pageSequence]!.capturedAt))]});
}

/** Reconstruct only list metadata; source replay still checks every original page body and identity. */
export function restoreQuarantinedList(evidence:PersistentSourceFetchEvidence):PersistentSourceFetchEvidence {
  const rows=evidence.jobQuarantines??[];
  if(!rows.length)return evidence;
  const locators=new Set(rows.map(row=>row.rawLocator)),{jobQuarantines:_,...base}=evidence;
  return parsePersistentSourceFetchEvidence({...base,
    pages:evidence.pages.map((page,i)=>({...page,validJobIds:[...new Set([...page.validJobIds,...rows.filter(row=>row.pageSequence===i).map(row=>row.validJobId)])]})),
    fetchCounts:{...evidence.fetchCounts,validCount:evidence.fetchCounts.validCount+rows.length,validationDiscardCount:evidence.fetchCounts.validationDiscardCount-rows.length},
    fetchLosses:evidence.fetchLosses.filter(loss=>loss.details?.code!=='JOB_QUARANTINED'||!locators.has(loss.rawLocator))});
}

/** Workday title slugs may change while the native requisition remains the same. */
function sameWorkdayRequisition(left:string,right:string):boolean{
  try{
    const a=new URL(left),b=new URL(right),id=(url:URL)=>/_(R-\d+|REQ\d+)(?:-\d+)?$/u.exec(url.pathname)?.[1];
    return a.origin===b.origin&&a.pathname.split('/job/')[0]===b.pathname.split('/job/')[0]&&id(a)!==undefined&&id(a)===id(b);
  }catch{return false;}
}
/** An unidentified damaged row cannot prove any previously known job disappeared. */
export function quarantinedPriorJobKeys(evidence: PersistentSourceFetchEvidence, previous: readonly JobSnapshot[], currentKeys: ReadonlySet<string> = new Set()): Set<string> {
  const quarantines=evidence.jobQuarantines??[];
  const unbound=quarantines.some(row=>!row.sourceJobId&&!row.officialUrl);
  return new Set(previous.filter(job=>unbound&&!currentKeys.has(job.dedupeKey)||quarantines.some(row=>
    row.sourceJobId!==undefined&&row.sourceJobId===job.record.sourceJobId||
    row.officialUrl!==undefined&&(row.officialUrl===sanitizeEvidenceHttpUrl(job.record.officialUrl)||
      row.sourceJobId?.startsWith('workday:sha256:')&&job.record.sourceJobId?.startsWith('workday:sha256:')&&sameWorkdayRequisition(row.officialUrl,job.record.officialUrl))
  )).map(job=>job.dedupeKey));
}
