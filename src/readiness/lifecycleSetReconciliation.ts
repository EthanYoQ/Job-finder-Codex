import { canonicalStringSetSha256 } from "../crawler/sourceFetchEvidence";
import type { LifecycleStatus } from "../crawler/lifecycle";

export type LifecycleSetIssueCode = "SET_HASH_MISMATCH" | "DUPLICATE_KEY" | "MIXED_TUPLE" |
  "CURRENT_GRACE_OVERLAP" | "VISIBLE_UNION_MISMATCH" | "GRACE_ENTRY_INVALID" |
  "CURRENT_ENTRY_INVALID" | "HIDDEN_ENTRY_VISIBLE" | "SET_EVIDENCE_MISSING" |
  "LIFECYCLE_ENTRY_INVALID" | "LIFECYCLE_ENTRY_ORPHAN";
export interface LifecycleTuple { releaseCandidateId:string; batchId:string; sourceResultId:string; sourceId:string }
export interface LifecycleSetEntry extends LifecycleTuple { key:string; status:LifecycleStatus; missingSuccessfulCrawlCount:number }
export interface LifecycleSetEvidence extends LifecycleTuple {
  currentKeys:readonly string[]; currentSha256:string;
  graceEntries:readonly LifecycleSetEntry[]; graceSha256:string;
  visibleKeys:readonly string[]; visibleSha256:string;
  lifecycleEntries:readonly LifecycleSetEntry[];
}
export interface LifecycleSetReconciliation { currentCount:number; graceCount:number; visibleCount:number;
  currentSha256:string; graceSha256:string; visibleSha256:string }

export function reconcileLifecycleSets(evidence:LifecycleSetEvidence):LifecycleSetReconciliation {
  if(!evidence) fail("SET_EVIDENCE_MISSING");
  const tuple=tupleOf(evidence); const current=unique(evidence.currentKeys); const visible=unique(evidence.visibleKeys);
  const grace=unique(evidence.graceEntries.map(entry=>entry.key)); const lifecycle=unique(evidence.lifecycleEntries.map(entry=>entry.key));
  for(const entry of [...evidence.graceEntries,...evidence.lifecycleEntries]) if(tupleOf(entry)!==tuple) fail("MIXED_TUPLE");
  if(current.some(key=>grace.includes(key)))fail("CURRENT_GRACE_OVERLAP");
  const entries=new Map(evidence.lifecycleEntries.map(entry=>[entry.key,entry]));
  if(current.some(key=>{const entry=entries.get(key);return !entry||entry.status!=="ACTIVE"||entry.missingSuccessfulCrawlCount!==0}))fail("CURRENT_ENTRY_INVALID");
  if(evidence.graceEntries.some(entry=>entry.status!=="ACTIVE"||entry.missingSuccessfulCrawlCount!==1||entries.get(entry.key)?.status!=="ACTIVE"||entries.get(entry.key)?.missingSuccessfulCrawlCount!==1))fail("GRACE_ENTRY_INVALID");
  const union=unique([...current,...grace]); if(!same(union,visible))fail("VISIBLE_UNION_MISMATCH");
  if(lifecycle.length!==evidence.lifecycleEntries.length)fail("DUPLICATE_KEY");
  for(const entry of evidence.lifecycleEntries){
    const inCurrent=current.includes(entry.key),inGrace=grace.includes(entry.key),inVisible=visible.includes(entry.key);
    if(entry.status==="ACTIVE"&&entry.missingSuccessfulCrawlCount===0){if(!inCurrent||!inVisible||inGrace)fail("LIFECYCLE_ENTRY_ORPHAN");continue}
    if(entry.status==="ACTIVE"&&entry.missingSuccessfulCrawlCount===1){if(!inGrace||!inVisible||inCurrent)fail("LIFECYCLE_ENTRY_ORPHAN");continue}
    if(entry.status==="SUSPECTED_OFFLINE"&&entry.missingSuccessfulCrawlCount===2){if(inCurrent||inGrace||inVisible)fail("HIDDEN_ENTRY_VISIBLE");continue}
    if(entry.status==="OFFLINE"&&entry.missingSuccessfulCrawlCount>=3){if(inCurrent||inGrace||inVisible)fail("HIDDEN_ENTRY_VISIBLE");continue}
    fail("LIFECYCLE_ENTRY_INVALID");
  }
  const hashes={currentSha256:canonicalStringSetSha256(current),graceSha256:canonicalStringSetSha256(grace),visibleSha256:canonicalStringSetSha256(visible)};
  if(hashes.currentSha256!==evidence.currentSha256||hashes.graceSha256!==evidence.graceSha256||hashes.visibleSha256!==evidence.visibleSha256)fail("SET_HASH_MISMATCH");
  return {currentCount:current.length,graceCount:grace.length,visibleCount:visible.length,...hashes};
}

function unique(values:readonly string[]):string[]{if(values.some(value=>typeof value!=="string"||!value.trim())||new Set(values).size!==values.length)fail("DUPLICATE_KEY");return [...values].sort((a,b)=>Buffer.from(a).compare(Buffer.from(b)))}
function same(a:readonly string[],b:readonly string[]):boolean{return a.length===b.length&&a.every((value,index)=>value===b[index])}
function tupleOf(value:LifecycleTuple):string {const fields=[value.releaseCandidateId,value.batchId,value.sourceResultId,value.sourceId];if(fields.some(field=>typeof field!=="string"||!field.trim()))fail("MIXED_TUPLE");return fields.join("\0")}
function fail(code:LifecycleSetIssueCode):never{throw new Error(code)}
