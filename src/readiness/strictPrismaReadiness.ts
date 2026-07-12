import { createHash } from "node:crypto";
import type { P0ReadinessReport } from "./p0Readiness";
import {
  selectStrictFullReleaseReadiness,
  type StrictReadinessExpectation,
  type StrictReadinessBatch
} from "./strictPersistedReadiness";
import { getP0DataQualityReport } from "./dataQuality";
import {
  assertExactCanonicalPhase1InScopeRoster,
  canonicalPhase1RosterPolicyRecords,
  derivePhase1Scope
} from "../data/phase1ScopePolicy";
import { assertExactConfirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";

export interface StrictPrismaReadinessDb {
  crawlBatch: { findMany(args: Record<string, unknown>): Promise<StrictPrismaBatchRow[]> };
  releaseCandidate: { findUnique(args: Record<string, unknown>): Promise<StrictReleaseCandidateRow | null> };
  company: { findMany(args: Record<string, unknown>): Promise<StrictCompanyRow[]> };
}

interface StrictReleaseCandidateRow { id:string; status:string; commitSha:string; rosterHash:string; sourcePlanHash:string; sourceConfigHash:string; adapterBundleHash:string;sourceTreeHash:string;runtimeTreeHash:string }
interface StrictCompanyRow { id:string; inclusionReason:string; sources: readonly {id:string}[] }

interface StrictObservationRow {
  id: string; releaseCandidateId: string | null; batchId: string | null; sourceId: string;
  sourceResultId: string | null; atomicCommitSucceeded: boolean | null;
  completenessVerified: boolean | null; successful: boolean; crawledAt: Date;
  structuredJobCount: number; expectedJobCount: number | null; completenessStatus: string | null;
  completenessEvidenceKind: string | null; completenessEvidenceUrl: string | null;
  completenessBlockerReason: string | null; totalPages: number | null; pageSize: number | null;
  pagesVisited: number | null; stableRequiredFields: string[]; failureReason: string | null;
  canonicalOutputSha256: string | null; canonicalGraceSha256: string | null;
  canonicalVisibleSha256: string | null; artifactRedactionCommitmentSha256: string | null;
  officialEvidenceArtifactId: string | null;
}
type StrictPrismaSourceResult = StrictReadinessBatch["sourceResults"][number] & {
  observations: StrictObservationRow[];
  lifecycleSetMembers: StrictLifecycleMemberRow[];
  officialSurfaceIds: string[]; officialChannelIds: string[];
};
interface StrictLifecycleMemberRow {releaseCandidateId:string;batchId:string;sourceId:string;sourceResultId:string;setKind:"CURRENT"|"GRACE"|"VISIBLE";jobKey:string;jobKeySha256:string;lifecycleStatus:"ACTIVE"|"SUSPECTED_OFFLINE"|"OFFLINE";missingCount:number}
interface StrictPrismaBatchRow extends Omit<StrictReadinessBatch, "sourceResults"> {
  sourceResults: StrictPrismaSourceResult[];
}

export async function getStrictP0ReadinessReportFromDb(db: StrictPrismaReadinessDb,
  expected: StrictReadinessExpectation): Promise<P0ReadinessReport> {
  assertExactCanonicalPhase1InScopeRoster(expected.companyAudits.map(({ companyId, category }) => ({
    id: companyId,
    category
  })));
  const rc = await db.releaseCandidate.findUnique({ where: { id: expected.releaseCandidateId }, select: {
    id:true,status:true,commitSha:true,rosterHash:true,sourcePlanHash:true,sourceConfigHash:true,adapterBundleHash:true,sourceTreeHash:true,runtimeTreeHash:true } });
  if (!rc || !["READY_FOR_QA", "RELEASED"].includes(rc.status)) throw new Error("Release candidate is not release eligible");
  const bindings = [[rc.commitSha,expected.commitSha],[rc.rosterHash,expected.rosterSha256],
    [rc.sourcePlanHash,expected.sourcePlanSha256],[rc.sourceConfigHash,expected.sourceConfigSha256],
    [rc.adapterBundleHash,expected.adapterBundleSha256],[rc.sourceTreeHash,expected.sourceTreeSha256],[rc.runtimeTreeHash,expected.runtimeTreeSha256]];
  if (bindings.some(([actual,wanted])=>actual!==wanted)) throw new Error("Release candidate exact identity mismatch");
  const companies = await db.company.findMany({ select: { id:true,inclusionReason:true, sources:{ select:{id:true} } } });
  try {
    assertExactConfirmedCompanyRosterV3(companies.map((company) => ({
      id: company.id,
      category: category(company.inclusionReason)
    })));
  } catch {
    throw new Error("FULL_CONFIRMED_ROSTER_MISMATCH");
  }
  const sourceOwnership=new Map<string,string>();
  for(const member of expected.releaseMembers){
    const owner=`${member.companyId}\0${member.category}`;
    const prior=sourceOwnership.get(member.sourceId);
    if(prior&&prior!==owner)throw new Error("Trusted source membership has conflicting company ownership");
    sourceOwnership.set(member.sourceId,owner);
  }
  const expectedSourceIds=canonical([...sourceOwnership.keys()]);
  if(!equalExact(canonical(expected.plannedSourceIds),expectedSourceIds))throw new Error("Trusted planned source denominator does not match release membership");
  const expectedCompanySources = canonical([...sourceOwnership].map(([sourceId,owner])=>`${owner}\0${sourceId}`));
  const actualCompanySources = canonical(companies.flatMap(company=>company.sources.map(source=>`${company.id}\0${category(company.inclusionReason)}\0${source.id}`)));
  if (!equalExact(actualCompanySources,expectedCompanySources)) throw new Error("DB company/source roster does not exactly match trusted membership");
  const rows = await db.crawlBatch.findMany({ where: {
    kind: "FULL_RELEASE",
    releaseCandidateId: expected.releaseCandidateId, commitSha: expected.commitSha,
    rosterSha256: expected.rosterSha256, sourcePlanSha256: expected.sourcePlanSha256,
    sourceConfigSha256: expected.sourceConfigSha256, adapterBundleSha256: expected.adapterBundleSha256
  }, orderBy:{startedAt:"desc"}, include: { sourceResults: { include: { observations: true, lifecycleSetMembers:true } } } });
  const normalized = rows.map((batch) => ({ ...batch, sourceResults: batch.sourceResults.map((source) => {
    if (source.observations.length !== 1) throw new Error("Strict readiness requires exactly one source observation");
    const observation = source.observations[0]!;
    if (observation.releaseCandidateId !== batch.releaseCandidateId || observation.batchId !== batch.id ||
      observation.sourceId !== source.sourceId || observation.sourceResultId !== source.id ||
      observation.atomicCommitSucceeded !== true || observation.completenessVerified !== true ||
      observation.canonicalOutputSha256 !== source.canonicalOutputSetSha256 ||
      observation.canonicalGraceSha256 !== source.canonicalGraceJobSetSha256 ||
      observation.canonicalVisibleSha256 !== source.canonicalVisibleJobSetSha256) {
      throw new Error("Strict readiness observation tuple or canonical truth mismatch");
    }
    const lifecycle=new Map<string,{status:"ACTIVE"|"SUSPECTED_OFFLINE"|"OFFLINE";count:number}>();
    for(const member of source.lifecycleSetMembers){
      if(member.releaseCandidateId!==batch.releaseCandidateId||member.batchId!==batch.id||member.sourceId!==source.sourceId||member.sourceResultId!==source.id||
        member.jobKeySha256!==createHash("sha256").update(member.jobKey,"utf8").digest("hex"))throw new Error("Strict readiness lifecycle member tuple or key hash mismatch");
      const prior=lifecycle.get(member.jobKey);if(prior&&(prior.status!==member.lifecycleStatus||prior.count!==member.missingCount))throw new Error("Strict readiness lifecycle member projection mismatch");
      lifecycle.set(member.jobKey,{status:member.lifecycleStatus,count:member.missingCount});
    }
    const byKind=(kind:StrictLifecycleMemberRow["setKind"])=>source.lifecycleSetMembers.filter(x=>x.setKind===kind);
    const currentKeys=byKind("CURRENT").map(x=>x.jobKey),graceRows=byKind("GRACE"),visibleKeys=byKind("VISIBLE").map(x=>x.jobKey);
    const lifecycleSetEvidence={releaseCandidateId:batch.releaseCandidateId,batchId:batch.id,sourceResultId:source.id,sourceId:source.sourceId,
      currentKeys,currentSha256:source.canonicalCurrentJobSetSha256!,graceEntries:graceRows.map(x=>({...batchTuple(batch.id,source.id,source.sourceId,batch.releaseCandidateId),key:x.jobKey,status:x.lifecycleStatus,missingSuccessfulCrawlCount:x.missingCount})),
      graceSha256:source.canonicalGraceJobSetSha256!,visibleKeys,visibleSha256:source.canonicalVisibleJobSetSha256!,
      lifecycleEntries:[...lifecycle].map(([key,x])=>({...batchTuple(batch.id,source.id,source.sourceId,batch.releaseCandidateId),key,status:x.status,missingSuccessfulCrawlCount:x.count}))};
    return { ...source, officialEvidenceArtifactId: observation.officialEvidenceArtifactId,
      artifactRedactionCommitmentSha256: observation.artifactRedactionCommitmentSha256,lifecycleSetEvidence };
  }) }));
  const selected = selectStrictFullReleaseReadiness(normalized, expected);
  const latest=selected[0];
  const latestRaw=rowByIdOrThrow(rows,latest.id);
  const quality=getP0DataQualityReport({mode:"STRICT_SET_EVIDENCE",plannedSourceIds:expected.plannedSourceIds,
    latestObservationsBySource:Object.fromEntries(latestRaw.sourceResults.map(source=>{const observation=source.observations[0]!;return [source.sourceId,{...observation,
      releaseCandidateId:observation.releaseCandidateId!,batchId:observation.batchId!,sourceResultId:observation.sourceResultId!,
      completenessStatus:observation.completenessStatus as "VERIFIED"|"NEEDS_MANUAL_COMPLETENESS_REVIEW"|"INCOMPLETE"|"FAILED"|null,
      completenessEvidenceKind:observation.completenessEvidenceKind as never}]})),
    activeVisibleJobCountsBySource:{},lifecycleSetEvidenceBySource:Object.fromEntries(latest.sourceResults.map(source=>[source.sourceId,source.lifecycleSetEvidence]))});
  for(const batch of selected){
    const actualMembers=batch.sourceResults.flatMap(source=>{
      const row=rowBySource(rows,batch.id,source.sourceId);
      if(row.officialSurfaceIds.length!==row.officialChannelIds.length)throw new Error("DB surface/channel member projection is incomplete");
      return row.officialSurfaceIds.map((surfaceId,index)=>{const company=companyForSource(companies,source.sourceId);return {companyId:company.id,category:category(company.inclusionReason),sourceId:source.sourceId,surfaceId,channelId:row.officialChannelIds[index]!};});
    });
    if(!equalExact(canonicalMembers(actualMembers),canonicalMembers(expected.releaseMembers)))throw new Error("DB company/source/surface/channel members do not exactly match trusted membership");
  }
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const observationsBySource = Object.fromEntries(expected.plannedSourceIds.map((sourceId) => {
    const observations = selected.map((batch) => rowById.get(batch.id)!.sourceResults
      .find((row) => row.sourceId === sourceId)!.observations[0]!);
    return [sourceId, observations.map((observation) => ({ id: observation.id, sourceId: observation.sourceId,
      crawledAt: observation.crawledAt, successful: observation.successful,
      structuredJobCount: observation.structuredJobCount,
      ...(observation.expectedJobCount === null ? {} : { expectedJobCount: observation.expectedJobCount }),
      ...(observation.completenessStatus === null ? {} : { completenessStatus: observation.completenessStatus as never }),
      ...(observation.completenessEvidenceKind === null ? {} : { completenessEvidenceKind: observation.completenessEvidenceKind as never }),
      ...(observation.completenessEvidenceUrl === null ? {} : { completenessEvidenceUrl: observation.completenessEvidenceUrl }),
      ...(observation.totalPages === null ? {} : { totalPages: observation.totalPages }),
      ...(observation.pageSize === null ? {} : { pageSize: observation.pageSize }),
      ...(observation.pagesVisited === null ? {} : { pagesVisited: observation.pagesVisited }),
      stableRequiredFields: observation.stableRequiredFields as never }))];
  }));
  const requiredFields=["COMPANY","TITLE","OFFICIAL_URL","LOCATION"];
  const evidencedSourceIds=new Set<string>();
  for(const sourceId of expectedSourceIds){const observations=observationsBySource[sourceId]??[];
    if(observations.length===2&&observations.every(observation=>observation.successful&&observation.completenessStatus==="VERIFIED"&&
      ((observation.structuredJobCount===0&&observation.expectedJobCount===0)||requiredFields.every(field=>(observation.stableRequiredFields as readonly string[]).includes(field)))))evidencedSourceIds.add(sourceId);}
  const blockers=evidencedSourceIds.size===expectedSourceIds.length&&quality.canPass?[]:[{code:"OFFICIAL_LINK_DENOMINATOR_INCOMPLETE" as const,message:`Strict readiness requires observation and data-quality evidence for every planned official-link source; evidenced ${evidencedSourceIds.size} of ${expectedSourceIds.length}; data-quality issues ${quality.issueCount}.`}];
  const canonicalScope=derivePhase1Scope(canonicalPhase1RosterPolicyRecords);
  return {totalCandidates:canonicalScope.rosterCount,
    foreignPharmaCompanies:canonicalPhase1RosterPolicyRecords.filter(company=>company.category==="FOREIGN_PHARMA").length,
    domesticPharmaCompanies:canonicalPhase1RosterPolicyRecords.filter(company=>company.category==="DOMESTIC_PHARMA").length,
    phase1InScopeCompanies:canonicalScope.inScopeCompanies.length,
    authorizedExclusionCompanies:canonicalScope.authorizedExclusionCount,
    requiredOfficialLinkSources:expectedSourceIds.length,plannedOfficialLinkSources:expected.plannedSourceIds.length,
    crawlEvidencedOfficialLinkSources:evidencedSourceIds.size,
    noPublicOfficialCareersLinkCompanies:expected.companyAudits.filter(audit=>audit.status==="NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME").length,
    blockingEvidenceGapCompanies:0,sourcePlanOmissions:[],blockers,canLaunchP0:blockers.length===0};
}

const batchTuple=(batchId:string,sourceResultId:string,sourceId:string,releaseCandidateId:string)=>({releaseCandidateId,batchId,sourceResultId,sourceId});
const canonical=(values:readonly string[])=>[...values].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
const equalExact=(a:readonly string[],b:readonly string[])=>new Set(a).size===a.length&&new Set(b).size===b.length&&JSON.stringify(a)===JSON.stringify(b);
const canonicalMembers=(members:readonly {companyId:string;category:string;sourceId:string;surfaceId:string;channelId:string}[])=>canonical(members.map(x=>`${x.companyId}\0${x.category}\0${x.sourceId}\0${x.surfaceId}\0${x.channelId}`));
function companyForSource(companies:readonly StrictCompanyRow[],sourceId:string){const matches=companies.filter(c=>c.sources.some(s=>s.id===sourceId));if(matches.length!==1)throw new Error("DB source must belong to exactly one trusted company");return matches[0]!;}
function category(value:string){if(value!=="FOREIGN_PHARMA"&&value!=="DOMESTIC_PHARMA")throw new Error("DB company category is invalid");return value;}
function rowBySource(rows:readonly StrictPrismaBatchRow[],batchId:string,sourceId:string){const row=rows.find(x=>x.id===batchId)?.sourceResults.find(x=>x.sourceId===sourceId);if(!row)throw new Error("DB source-result member is missing");return row;}
function rowByIdOrThrow(rows:readonly StrictPrismaBatchRow[],batchId:string){const row=rows.find(x=>x.id===batchId);if(!row)throw new Error("DB batch is missing");return row;}
