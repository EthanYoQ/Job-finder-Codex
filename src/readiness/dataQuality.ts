import type { CompletenessEvidenceKind, CompletenessStatus } from "../domain/company";
import { reconcileLifecycleSets, type LifecycleSetEvidence, type LifecycleSetIssueCode } from "./lifecycleSetReconciliation";

export type P0DataQualityIssueCode =
  | "MISSING_LATEST_OBSERVATION"
  | "LATEST_OBSERVATION_FAILED"
  | "MISSING_COMPLETENESS_STATUS"
  | "COMPLETENESS_NOT_VERIFIED"
  | "VISIBLE_JOB_COUNT_MISMATCH"
  | "EXPECTED_JOB_COUNT_MISMATCH"
  | "UNPLANNED_VISIBLE_JOBS"
  | "HIGH_RISK_LOW_COUNT_WITHOUT_STRONG_COMPLETENESS_EVIDENCE"
  | "LEGACY_COUNT_ONLY_NOT_RELEASE_ELIGIBLE"
  | "OBSERVATION_TUPLE_MISMATCH"
  | "STRUCTURED_CURRENT_COUNT_MISMATCH"
  | LifecycleSetIssueCode;

export interface P0DataQualityObservation {
  releaseCandidateId?: string;
  batchId?: string;
  sourceResultId?: string;
  sourceId?: string;
  successful: boolean;
  structuredJobCount: number;
  expectedJobCount: number | null;
  completenessStatus: CompletenessStatus | null;
  completenessEvidenceKind?: CompletenessEvidenceKind | null;
  completenessEvidenceUrl: string | null;
  completenessBlockerReason: string | null;
  totalPages?: number | null;
  pagesVisited?: number | null;
  crawledAt: Date;
  failureReason: string | null;
}

export interface P0DataQualityIssue {
  sourceId: string;
  code: P0DataQualityIssueCode;
  message: string;
  observedCount?: number;
  expectedCount?: number | null;
  activeVisibleCount?: number;
  evidenceUrl?: string | null;
  evidenceKind?: CompletenessEvidenceKind | null;
  completenessStatus?: CompletenessStatus | null;
  blockerReason?: string | null;
}

export interface P0DataQualityInput {
  mode?: "LEGACY_DIAGNOSTIC" | "STRICT_SET_EVIDENCE";
  plannedSourceIds: readonly string[];
  latestObservationsBySource: Readonly<Record<string, P0DataQualityObservation | undefined>>;
  activeVisibleJobCountsBySource: Readonly<Record<string, number | undefined>>;
  unplannedActiveVisibleJobCountsBySource?: Readonly<Record<string, number | undefined>>;
  highRiskLowCountSourceIds?: readonly string[];
  lifecycleSetEvidenceBySource?: Readonly<Record<string,LifecycleSetEvidence|undefined>>;
}

export interface P0DataQualityReport {
  plannedSourceCount: number;
  issueCount: number;
  issues: P0DataQualityIssue[];
  canPass: boolean;
  mode: "LEGACY_DIAGNOSTIC" | "STRICT_SET_EVIDENCE";
  releaseEligible: boolean;
}

export function getP0DataQualityReport(input: P0DataQualityInput): P0DataQualityReport {
  const mode=input.mode ?? "LEGACY_DIAGNOSTIC";
  const highRiskSources = new Set(input.highRiskLowCountSourceIds ?? []);
  const issues = [
    ...input.plannedSourceIds.flatMap((sourceId) =>
      issuesForSource({
        sourceId,
        latestObservation: input.latestObservationsBySource[sourceId],
        activeVisibleJobCount: strictVisibleCount(input,sourceId,issuesForSetEvidence(input,sourceId)),
        highRiskLowCount: highRiskSources.has(sourceId), strictMode:mode==="STRICT_SET_EVIDENCE"
      })
    ),
    ...unplannedVisibleJobIssues(input.unplannedActiveVisibleJobCountsBySource ?? {})
  ];

  const setIssues=mode==="STRICT_SET_EVIDENCE"?input.plannedSourceIds.flatMap(sourceId=>issuesForSetEvidence(input,sourceId)):[];
  issues.push(...setIssues);
  return {
    plannedSourceCount: input.plannedSourceIds.length,
    issueCount: issues.length,
    issues,
    canPass: issues.length === 0 && mode==="STRICT_SET_EVIDENCE",
    mode, releaseEligible:mode==="STRICT_SET_EVIDENCE"
  };
}

function issuesForSetEvidence(input:P0DataQualityInput,sourceId:string):P0DataQualityIssue[] {
  if((input.mode??"LEGACY_DIAGNOSTIC")!=="STRICT_SET_EVIDENCE")return [];
  const evidence=input.lifecycleSetEvidenceBySource?.[sourceId]; if(!evidence)return [{sourceId,code:"SET_EVIDENCE_MISSING",message:"Strict lifecycle set evidence is missing."}];
  try{
    const sets=reconcileLifecycleSets(evidence);const observation=input.latestObservationsBySource[sourceId];
    if(evidence.sourceId!==sourceId||!observation||observation.releaseCandidateId!==evidence.releaseCandidateId||observation.batchId!==evidence.batchId||observation.sourceResultId!==evidence.sourceResultId||observation.sourceId!==sourceId)
      return [{sourceId,code:"OBSERVATION_TUPLE_MISMATCH",message:"Strict observation, planned source and lifecycle evidence tuple do not match."}];
    if(observation.structuredJobCount!==sets.currentCount)return [{sourceId,code:"STRUCTURED_CURRENT_COUNT_MISMATCH",message:"Structured job count does not equal the reconciled current set count."}];
    const callerVisible=input.activeVisibleJobCountsBySource[sourceId];
    if(callerVisible!==undefined&&callerVisible!==sets.visibleCount)return [{sourceId,code:"VISIBLE_JOB_COUNT_MISMATCH",message:"Caller visible count contradicts the reconciled visible set.",activeVisibleCount:callerVisible}];
    return [];
  }catch(error){const code=(error instanceof Error?error.message:"SET_EVIDENCE_MISSING") as LifecycleSetIssueCode;return [{sourceId,code,message:`Lifecycle set reconciliation failed: ${code}.`}];}
}
function strictVisibleCount(input:P0DataQualityInput,sourceId:string,setIssues:P0DataQualityIssue[]):number {
  if((input.mode??"LEGACY_DIAGNOSTIC")!=="STRICT_SET_EVIDENCE")return input.activeVisibleJobCountsBySource[sourceId]??0;
  if(setIssues.length)return 0;return reconcileLifecycleSets(input.lifecycleSetEvidenceBySource![sourceId]!).visibleCount;
}

function unplannedVisibleJobIssues(
  countsBySource: Readonly<Record<string, number | undefined>>
): P0DataQualityIssue[] {
  return Object.entries(countsBySource)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([sourceId, count]) => ({
      sourceId,
      code: "UNPLANNED_VISIBLE_JOBS",
      message: `Unplanned source has ${count ?? 0} active visible jobs in the frontend.`,
      activeVisibleCount: count ?? 0
    }));
}

function issuesForSource({
  sourceId,
  latestObservation,
  activeVisibleJobCount,
  highRiskLowCount
  ,strictMode
}: {
  sourceId: string;
  latestObservation: P0DataQualityObservation | undefined;
  activeVisibleJobCount: number;
  highRiskLowCount: boolean;
  strictMode:boolean;
}): P0DataQualityIssue[] {
  if (!latestObservation) {
    return [
      {
        sourceId,
        code: "MISSING_LATEST_OBSERVATION",
        message: "No crawl observation exists for this planned source."
      }
    ];
  }

  if (!latestObservation.successful) {
    return [
      {
        sourceId,
        code: "LATEST_OBSERVATION_FAILED",
        message: `Latest observation failed: ${latestObservation.failureReason ?? "unknown failure"}.`,
        observedCount: latestObservation.structuredJobCount,
        expectedCount: latestObservation.expectedJobCount,
        activeVisibleCount: activeVisibleJobCount,
        evidenceUrl: latestObservation.completenessEvidenceUrl,
        evidenceKind: latestObservation.completenessEvidenceKind ?? null,
        completenessStatus: latestObservation.completenessStatus,
        blockerReason: latestObservation.completenessBlockerReason
      }
    ];
  }

  const issues: P0DataQualityIssue[] = [];

  if (!latestObservation.completenessStatus) {
    issues.push(
      observationIssue({
        sourceId,
        code: "MISSING_COMPLETENESS_STATUS",
        message: "Latest successful observation is missing completeness status.",
        latestObservation,
        activeVisibleJobCount
      })
    );
  } else if (latestObservation.completenessStatus !== "VERIFIED") {
    issues.push(
      observationIssue({
        sourceId,
        code: "COMPLETENESS_NOT_VERIFIED",
        message: `Latest successful observation completeness status is ${latestObservation.completenessStatus}.`,
        latestObservation,
        activeVisibleJobCount
      })
    );
  }

  if(!strictMode && latestObservation.structuredJobCount!==activeVisibleJobCount)issues.push(observationIssue({sourceId,
    code:"VISIBLE_JOB_COUNT_MISMATCH",message:`Latest successful observation has ${latestObservation.structuredJobCount} structured jobs, but ${activeVisibleJobCount} active visible jobs are in the frontend.`,latestObservation,activeVisibleJobCount}));

  if (
    latestObservation.expectedJobCount !== null &&
    latestObservation.expectedJobCount !== latestObservation.structuredJobCount
  ) {
    issues.push(
      observationIssue({
        sourceId,
        code: "EXPECTED_JOB_COUNT_MISMATCH",
        message: `Official source expected ${latestObservation.expectedJobCount} jobs, but latest structured crawl produced ${latestObservation.structuredJobCount}.`,
        latestObservation,
        activeVisibleJobCount
      })
    );
  }

  if (
    highRiskLowCount &&
    latestObservation.structuredJobCount < 10 &&
    !hasStrongCompletenessEvidence(latestObservation)
  ) {
    issues.push(
      observationIssue({
        sourceId,
        code: "HIGH_RISK_LOW_COUNT_WITHOUT_STRONG_COMPLETENESS_EVIDENCE",
        message:
          "High-risk Top 30 pharma source has fewer than 10 structured jobs without strong completeness evidence.",
        latestObservation,
        activeVisibleJobCount
      })
    );
  }

  return issues;
}

function hasStrongCompletenessEvidence(observation: P0DataQualityObservation): boolean {
  if (
    observation.completenessStatus !== "VERIFIED" ||
    !observation.completenessEvidenceUrl?.trim()
  ) {
    return false;
  }

  if (observation.completenessEvidenceKind === "OFFICIAL_TOTAL_COUNT") {
    return (
      observation.expectedJobCount !== null &&
      observation.expectedJobCount === observation.structuredJobCount
    );
  }

  const pagesVisited = observation.pagesVisited;
  const hasPositivePagesVisited =
    typeof pagesVisited === "number" && Number.isInteger(pagesVisited) && pagesVisited >= 1;

  if (observation.completenessEvidenceKind === "COMPLETE_PAGE_TRAVERSAL") {
    return (
      hasPositivePagesVisited &&
      (observation.totalPages === null ||
        observation.totalPages === undefined ||
        observation.totalPages === pagesVisited)
    );
  }

  if (observation.completenessEvidenceKind === "OFFICIAL_TOTAL_PAGES") {
    const totalPages = observation.totalPages;
    return (
      hasPositivePagesVisited &&
      typeof totalPages === "number" &&
      Number.isInteger(totalPages) &&
      totalPages >= 1 &&
      totalPages === pagesVisited
    );
  }

  return false;
}

function observationIssue({
  sourceId,
  code,
  message,
  latestObservation,
  activeVisibleJobCount
}: {
  sourceId: string;
  code: P0DataQualityIssueCode;
  message: string;
  latestObservation: P0DataQualityObservation;
  activeVisibleJobCount: number;
}): P0DataQualityIssue {
  return {
    sourceId,
    code,
    message,
    observedCount: latestObservation.structuredJobCount,
    expectedCount: latestObservation.expectedJobCount,
    activeVisibleCount: activeVisibleJobCount,
    evidenceUrl: latestObservation.completenessEvidenceUrl,
    evidenceKind: latestObservation.completenessEvidenceKind ?? null,
    completenessStatus: latestObservation.completenessStatus,
    blockerReason: latestObservation.completenessBlockerReason
  };
}
