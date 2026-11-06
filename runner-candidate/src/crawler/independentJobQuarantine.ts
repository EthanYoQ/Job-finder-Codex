import { load } from 'cheerio';
import { mokaJobQuarantine, mokaRawLocator } from './mokaJobQuarantine';
import { decryptBayerArtifact } from './bayerMokaScope';
import { decodeServierArtifact } from './servierMokaScope';
import { quarantineCompleteList, JOB_QUARANTINE_PAGINATION } from './jobQuarantine';
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from './paginationEvidence';
import { reconcileAdapterRows } from './adapters/reconciliation';
import { replayStrictSourceQualityEvidence, type SourceCrawlResult } from './runSourceCrawl';
import type { SourceCrawlPlan } from './sourcePlan';
import { createHash } from 'node:crypto';
import { jobQuarantineLossesMatch } from './jobQuarantine';
import { canonicalStringSetSha256, type PersistentSourceFetchEvidence } from './sourceFetchEvidence';
import type { OfficialJsonRenderedPageCapture, OfficialJsonRenderedReplay } from './officialJsonRenderedTraversalValidator';

export const INDEPENDENT_JOB_ISOLATION_SOURCES = new Set([
  'source-bayer-healthcare-social', 'source-servier-china-social',
  'source-pfizer-china-social', 'source-sanofi-china-social'
]);
export interface IndependentJobQuarantine {
  ledger: Array<{rawLocatorSha256:string;pageSequence:number;recordIndex:number}>;
  rawEvidenceIds: string[];
  mainRawEvidenceIdSetSha256: string;
}
const sort = (values:Iterable<string>) => [...values].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));

/** Match the two complete lists. Unidentified damaged slots remain ambiguous;
 * their possible counterparts are withheld, never assigned a guessed identity. */
export function bindIndependentJobQuarantines(
  sourceId:string, evidence:PersistentSourceFetchEvidence, replay:OfficialJsonRenderedReplay
):IndependentJobQuarantine|undefined {
  if (!evidence.jobQuarantines?.length) return;
  if (!INDEPENDENT_JOB_ISOLATION_SOURCES.has(sourceId) || !jobQuarantineLossesMatch(evidence))
    throw Error('INDEPENDENT_JOB_QUARANTINE_LEDGER_INVALID');
  const raw=evidence.pages.flatMap(p=>p.rawJobIds), independent=new Set(replay.rawEvidenceIds);
  if (raw.length!==replay.rawCount || independent.size!==raw.length || new Set(raw).size!==raw.length)
    throw Error('INDEPENDENT_JOB_QUARANTINE_LIST_MISMATCH');
  const quarantined=new Set(evidence.jobQuarantines.map(q=>evidence.pages[q.pageSequence]!.rawJobIds[q.recordIndex]!));
  const verified=raw.filter(id=>!quarantined.has(id));
  if (verified.some(id=>!independent.has(id))) throw Error('INDEPENDENT_JOB_QUARANTINE_LIST_MISMATCH');
  const bound=new Set<string>();let unidentified=0;
  for(const q of evidence.jobQuarantines){
    const id=evidence.pages[q.pageSequence]!.rawJobIds[q.recordIndex]!;
    if(independent.has(id))bound.add(id);
    else if(!q.sourceJobId&&!q.officialUrl)unidentified++;
    else throw Error('INDEPENDENT_JOB_QUARANTINE_IDENTITY_MISMATCH');
  }
  const known=new Set([...verified,...bound]),ambiguous=replay.rawEvidenceIds.filter(id=>!known.has(id));
  if(ambiguous.length!==unidentified)throw Error('INDEPENDENT_JOB_QUARANTINE_LIST_MISMATCH');
  return {ledger:evidence.jobQuarantines.map(q=>({rawLocatorSha256:createHash('sha256').update(q.rawLocator).digest('hex'),
    pageSequence:q.pageSequence,recordIndex:q.recordIndex})),rawEvidenceIds:sort([...bound,...ambiguous]),mainRawEvidenceIdSetSha256:canonicalStringSetSha256(raw)};
}

/** Compare publishable jobs without changing any independent observation. */
export function projectIndependentJobQuarantines(
  replay:OfficialJsonRenderedReplay, pages:readonly OfficialJsonRenderedPageCapture[], rawEvidenceIds:readonly string[]
):OfficialJsonRenderedReplay {
  const held=new Set(rawEvidenceIds),rows=pages.flatMap(p=>p.rawRows),keys=new Set(rows.filter(r=>held.has(r.rawEvidenceId)).map(r=>r.sourceJobId));
  if(held.size!==rawEvidenceIds.length || rows.filter(r=>held.has(r.rawEvidenceId)).length!==held.size)
    throw Error('INDEPENDENT_JOB_QUARANTINE_IDENTITY_MISMATCH');
  const excluded=sort(new Set([...replay.excludedSourceJobIds,...keys]));
  return {...replay,matchKeys:replay.matchKeys.filter(key=>!keys.has(key)),excludedSourceJobIds:excluded,excludedCount:excluded.length};
}

/** A failed independent detail with a known native ID withholds that main job.
 * Both original response bodies remain intact and the source replays the result. */
export function isolateIndependentMokaJobs(plan:SourceCrawlPlan,result:SourceCrawlResult,pages:readonly OfficialJsonRenderedPageCapture[]):SourceCrawlResult {
  if(!['source-bayer-healthcare-social','source-servier-china-social'].includes(plan.source.id)||!result.fetchEvidence||result.status!=='SUCCESS'||!result.truth.transportSuccess||!result.truth.adapterSuccess)return result;
  const held=new Set(pages.flatMap(p=>p.rawRows).filter(r=>['UNKNOWN_JOB','UNKNOWN_GEOGRAPHY'].includes(r.scopeMarker)).map(r=>r.rawEvidenceId));
  if(!held.size)return result;
  const evidence=result.fetchEvidence,entry=evidence.artifacts.find(a=>a.logicalKey==='moka-entry-0000');
  if(!entry)throw Error('INDEPENDENT_MOKA_MAIN_ENTRY_MISSING');
  const iv=JSON.parse(load(typeof entry.body==='string'?entry.body:Buffer.from(entry.body).toString('utf8'))('#init-data').attr('value')??'null')?.aesIv;
  const added=evidence.pages.flatMap((page,pageSequence)=>{
    const artifact=evidence.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey);if(!artifact)throw Error('INDEPENDENT_MOKA_MAIN_PAGE_MISSING');
    const root=(plan.source.id==='source-bayer-healthcare-social'?decryptBayerArtifact:decodeServierArtifact)(artifact,iv),rows=(root.data as {jobs:unknown[]}).jobs;
    return page.rawJobIds.flatMap((id,recordIndex)=>held.has(id)&&page.validJobIds.includes(id)?[mokaJobQuarantine(rows[recordIndex],pageSequence,recordIndex,mokaRawLocator(rows[recordIndex],page.artifactLogicalKey,pageSequence,recordIndex),'INDEPENDENT_JOB_UNVERIFIED')]:[]);
  });
  if(!added.length)return result;
  const ids=new Set(added.map(q=>q.sourceJobId)),jobs=result.jobs.filter(job=>!ids.has(job.sourceJobId));
  if(jobs.length+added.length!==result.jobs.length)throw Error('INDEPENDENT_MOKA_MAIN_JOB_BINDING_INVALID');
  const reviewed=deriveCanonicalPaginationEvidence({evidence:quarantineCompleteList(evidence,added),expectedChannelIds:[],filteredOutput:true,...JOB_QUARANTINE_PAGINATION});
  const paginationEvaluation=evaluatePaginationEvidence({evidence:reviewed,expectedChannelIds:[],filteredOutput:true,...JOB_QUARANTINE_PAGINATION});
  const reconciled=reconcileAdapterRows(jobs.length,jobs.length,jobs,[]),updated={...result,...reconciled,fetchEvidence:reviewed,paginationEvaluation,observation:{...result.observation,structuredJobCount:jobs.length}};
  if(!replayStrictSourceQualityEvidence({plan,evidence:reviewed,paginationEvaluation,reconciliation:reconciled.reconciliation,jobs:reconciled.jobs,capturedAt:result.observation.crawledAt.toISOString()}))throw Error('INDEPENDENT_MOKA_QUARANTINE_REPLAY_FAILED');
  return updated;
}
