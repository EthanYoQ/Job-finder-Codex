import { isDeepStrictEqual } from 'node:util';
import { projectSanofiIndependentJobs, replaySanofiChineseNative, sanofiChineseDecisionIdentity, sanofiRawEvidenceId, assertSanofiForeignHeaderPair, SANOFI_CN_PAGINATION_POLICY } from './sanofiChineseNative';
import { replaySanofiChineseIndependent } from './sanofiChineseRenderedTraversal';
import { quarantinePfizerIndependentJobs } from './pfizerWorkdayTraversal';
import { load } from 'cheerio';
import { mokaJobQuarantine, mokaRawLocator } from './mokaJobQuarantine';
import { decryptBayerArtifact } from './bayerMokaScope';
import { decodeServierArtifact } from './servierMokaScope';
import { quarantineIndependentRows, JOB_QUARANTINE_PAGINATION, INDEPENDENT_IDENTITY_UNRESOLVED, isUnboundJobQuarantine } from './jobQuarantine';
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
    else if(isUnboundJobQuarantine(q))unidentified++;
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
export function isolateIndependentJobs(plan:SourceCrawlPlan,result:SourceCrawlResult,pages:readonly OfficialJsonRenderedPageCapture[]):SourceCrawlResult {
  if(!INDEPENDENT_JOB_ISOLATION_SOURCES.has(plan.source.id)||!result.fetchEvidence||result.status!=='SUCCESS'||!result.truth.transportSuccess||!result.truth.adapterSuccess)return result;
  const held=new Set(pages.flatMap(p=>p.rawRows).filter(r=>['UNKNOWN_JOB','UNKNOWN_GEOGRAPHY','UNKNOWN_IDENTITY'].includes(r.scopeMarker)||plan.source.id==='source-pfizer-china-social'&&r.scopeMarker==='UNKNOWN').map(r=>r.rawEvidenceId));
  const evidence=result.fetchEvidence;
  const independentIds=new Set(pages.flatMap(p=>p.rawRows).map(r=>r.rawEvidenceId)),unresolved=new Set<string>();
  if(pages.some(p=>p.rawRows.some(r=>r.scopeMarker==='UNKNOWN_IDENTITY')))for(const page of evidence.pages)for(const id of page.rawJobIds)if(!independentIds.has(id)){held.add(id);unresolved.add(id);}
  if(plan.source.id==='source-sanofi-china-social'){
    const baseline=result.jobs[0]?.isBaseline??true,main=replaySanofiChineseNative(plan,evidence,baseline),peer=replaySanofiChineseIndependent(pages),byId=new Map(peer.decisions.map(d=>[d.id,d]));
    const rawIds=new Set(peer.rawEvidenceIds),unbound=new Set<string>(),special=new Set(main.anomalies.map(a=>a.id));
    // An unidentified independent slot cannot identify which unseen old job disappeared.
    for(const page of evidence.pages)for(const id of page.rawJobIds)if(!rawIds.has(id)){held.add(id);unbound.add(id);}
    for(const own of main.decisions){
      const other=byId.get(own.id),rawId=sanofiRawEvidenceId(own.id);
      if(!other){held.add(rawId);if(!rawIds.has(rawId))unbound.add(rawId);continue;}
      if(!isDeepStrictEqual(sanofiChineseDecisionIdentity(own),sanofiChineseDecisionIdentity(other))){held.add(rawId);if(own.reqId!==other.reqId||own.sourceJobId!==other.sourceJobId||own.officialUrl!==other.officialUrl||own.applyUrl!==other.applyUrl)unbound.add(rawId);}
      else if(special.has(own.id)&&!isDeepStrictEqual(own,other))held.add(rawId);
    }
    const ownDescription=main.anomalies.filter(a=>a.code==='SANOFI_CN_REPLACEMENT_CHARACTER_NATIVE_AUTHORITY');
    for(const anomaly of [...ownDescription,...peer.descriptionAnomalies])if(!isDeepStrictEqual(ownDescription.find(a=>a.id===anomaly.id),peer.descriptionAnomalies.find(a=>a.id===anomaly.id)))held.add(sanofiRawEvidenceId(anomaly.id));
    for(const anomaly of main.anomalies)if(anomaly.code==='SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY'){
      try{const own=byId.get(anomaly.id);if(!own)throw Error('Header identity unavailable');assertSanofiForeignHeaderPair(anomaly,own,byId.get(anomaly.foreignId),pages.flatMap(p=>p.rawRows).find(r=>(r.rawPayload.domRow as {id:string}).id===anomaly.id)?.rawPayload);}catch{held.add(sanofiRawEvidenceId(anomaly.id));}
    }
    if(!held.size)return result;
    const projected=projectSanofiIndependentJobs(plan,evidence,held,unbound,baseline);
    return projected.evidence===evidence?result:projectIndependentIsolation(plan,result,projected.evidence,projected.jobs);
  }
  if(!held.size)return result;
  if(plan.source.id==='source-pfizer-china-social'){
    const reviewed=quarantinePfizerIndependentJobs(evidence,held,unresolved);if(reviewed===evidence)return result;
    return projectIndependentIsolation(plan,result,reviewed);
  }
  const entry=evidence.artifacts.find(a=>a.logicalKey==='moka-entry-0000');
  if(!entry)throw Error('INDEPENDENT_MOKA_MAIN_ENTRY_MISSING');
  const iv=JSON.parse(load(typeof entry.body==='string'?entry.body:Buffer.from(entry.body).toString('utf8'))('#init-data').attr('value')??'null')?.aesIv;
  const added=evidence.pages.flatMap((page,pageSequence)=>{
    const artifact=evidence.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey);if(!artifact)throw Error('INDEPENDENT_MOKA_MAIN_PAGE_MISSING');
    const root=(plan.source.id==='source-bayer-healthcare-social'?decryptBayerArtifact:decodeServierArtifact)(artifact,iv),rows=(root.data as {jobs:unknown[]}).jobs;
    return page.rawJobIds.flatMap((id,recordIndex)=>held.has(id)?[mokaJobQuarantine(rows[recordIndex],pageSequence,recordIndex,mokaRawLocator(rows[recordIndex],page.artifactLogicalKey,pageSequence,recordIndex),unresolved.has(id)?INDEPENDENT_IDENTITY_UNRESOLVED:'INDEPENDENT_JOB_UNVERIFIED')]:[]);
  });
  if(!added.length)return result;
  return projectIndependentIsolation(plan,result,quarantineIndependentRows(evidence,added));
}

function projectIndependentIsolation(plan:SourceCrawlPlan,result:SourceCrawlResult,evidence:PersistentSourceFetchEvidence,proposedJobs?:readonly SourceCrawlResult['jobs'][number][]):SourceCrawlResult{
 if(result.status!=='SUCCESS')return result;
 const prior=new Set(result.fetchEvidence?.jobQuarantines?.map(q=>q.rawLocator)??[]);
 const added=(evidence.jobQuarantines??[]).filter(q=>['INDEPENDENT_JOB_UNVERIFIED',INDEPENDENT_IDENTITY_UNRESOLVED].includes(q.code)&&!prior.has(q.rawLocator)),ids=new Set(added.map(q=>q.sourceJobId));
 const jobs=proposedJobs??result.jobs.filter(job=>!ids.has(job.sourceJobId));
 const options={expectedChannelIds:[],filteredOutput:true,...JOB_QUARANTINE_PAGINATION,...(plan.source.id==='source-pfizer-china-social'?{allowLaterZeroDeclaredTotalAfterExactReconciliation:true,allowAuditedTraversalScopeExclusions:true}:plan.source.id==='source-sanofi-china-social'?SANOFI_CN_PAGINATION_POLICY:{})};
 const reviewed=deriveCanonicalPaginationEvidence({evidence,...options}),paginationEvaluation=evaluatePaginationEvidence({evidence:reviewed,...options});
 const reconciled=reconcileAdapterRows(jobs.length,jobs.length,jobs,[]),updated={...result,...reconciled,fetchEvidence:reviewed,paginationEvaluation,observation:{...result.observation,structuredJobCount:jobs.length}};
 if(!replayStrictSourceQualityEvidence({plan,evidence:reviewed,paginationEvaluation,reconciliation:reconciled.reconciliation,jobs:reconciled.jobs,capturedAt:result.observation.crawledAt.toISOString()}))throw Error('INDEPENDENT_JOB_QUARANTINE_REPLAY_FAILED');
 return updated;
}
