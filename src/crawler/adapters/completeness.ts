import type { CompletenessEvidence, CrawlObservation } from "../../domain/company";

type CompletenessObservationFields = Pick<
  CrawlObservation,
  | "expectedJobCount"
  | "completenessStatus"
  | "completenessEvidenceKind"
  | "completenessEvidenceUrl"
  | "completenessBlockerReason"
  | "totalPages"
  | "pageSize"
  | "pagesVisited"
>;

export function completenessObservationFields({
  completeness,
  expectedJobCount,
  structuredJobCount,
  defaultEvidenceUrl
}: {
  completeness: CompletenessEvidence | undefined;
  expectedJobCount?: number;
  structuredJobCount: number;
  defaultEvidenceUrl: string;
}): Partial<CompletenessObservationFields> {
  // Only explicit transport evidence may describe an official expected count.
  // Adapter configuration and observed rows are not official provenance.
  const officialExpectedJobCount = completeness?.expectedJobCount;
  const expectedCountMismatch =
    officialExpectedJobCount !== undefined && structuredJobCount !== officialExpectedJobCount;
  const explicitNonVerifiedStatus = completeness?.completenessStatus === "VERIFIED"
    ? "NEEDS_MANUAL_COMPLETENESS_REVIEW"
    : completeness?.completenessStatus;
  const inferredStatus = expectedCountMismatch
    ? "INCOMPLETE"
    : explicitNonVerifiedStatus ??
      (officialExpectedJobCount === undefined ? undefined : "NEEDS_MANUAL_COMPLETENESS_REVIEW");
  const inferredEvidenceKind = completeness?.completenessEvidenceKind;
  const inferredEvidenceUrl = completeness?.completenessEvidenceUrl;
  const blockerReason =
    expectedCountMismatch && !completeness?.completenessBlockerReason
      ? `Structured ${structuredJobCount} jobs after adapter normalization, expected ${officialExpectedJobCount} official jobs`
      : completeness?.completenessBlockerReason;

  return {
    // Quantitative fields are reconstructed only at the strict fetch-evidence boundary.
    ...(inferredStatus === undefined ? {} : { completenessStatus: inferredStatus }),
    ...(inferredEvidenceKind === undefined
      ? {}
      : { completenessEvidenceKind: inferredEvidenceKind }),
    ...(inferredEvidenceUrl === undefined ? {} : { completenessEvidenceUrl: inferredEvidenceUrl }),
    ...(blockerReason === undefined ? {} : { completenessBlockerReason: blockerReason }),
  };
}
