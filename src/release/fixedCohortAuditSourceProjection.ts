import type { FixedCohortAuditSourceInput } from "./fixedCohortCompletenessAudit";

export interface FailedFixedCohortPlanProjection {
  companyId: string;
  sourceId: string;
  adapterFamily: string;
  plannedSurfaceIds: readonly string[];
  plannedChannelIds: readonly string[];
}

export interface FailedFixedCohortResultProjection {
  sourceResultId: string;
  sourceConfigSha256: string;
  officialSurfaceIds: readonly string[];
  officialChannelIds: readonly string[];
  expectedEvidenceKind: string | null;
  expectedJobCount: number | null;
  finalJobCount: number;
  transportState: string;
  adapterState: string;
  completenessState: string;
  atomicCommitState: string;
  blockerCode: string | null;
  failureCategory: string | null;
  failureDiagnosticCode: string | null;
  failureCode: string | null;
}

export function projectFailedFixedCohortAuditSource(input: {
  plan: FailedFixedCohortPlanProjection;
  result: FailedFixedCohortResultProjection;
}): FixedCohortAuditSourceInput {
  return {
    sourceResultId: input.result.sourceResultId,
    companyId: input.plan.companyId,
    sourceId: input.plan.sourceId,
    adapterFamily: input.plan.adapterFamily,
    grade: "C",
    sourceConfigSha256: input.result.sourceConfigSha256,
    canonicalJobSetSha256: null,
    canonicalRawEvidenceIdSetSha256: null,
    certificate: null,
    certificateSha256: null,
    plannedSurfaceIds: input.plan.plannedSurfaceIds,
    plannedChannelIds: input.plan.plannedChannelIds,
    officialSurfaceIds: input.result.officialSurfaceIds,
    officialChannelIds: input.result.officialChannelIds,
    evidenceArtifacts: [],
    paginationEvidence: [],
    expectedEvidenceKind: input.result.expectedEvidenceKind,
    expectedJobCount: input.result.expectedJobCount,
    pagesVisited: 0,
    totalPages: null,
    finalJobCount: input.result.finalJobCount,
    transportState: input.result.transportState,
    adapterState: input.result.adapterState,
    completenessState: input.result.completenessState,
    atomicCommitState: input.result.atomicCommitState,
    blockerCode: input.result.blockerCode,
    failureCategory: input.result.failureCategory,
    failureDiagnosticCode: input.result.failureDiagnosticCode,
    failureCode: input.result.failureCode
  };
}
