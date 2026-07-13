import type { CandidateCompany } from "../data/companyRegistry";
import { isUserAuthorizedPhase1Exclusion } from "../data/phase1ScopePolicy";

export type PublicationState =
  | "PUBLISHING"
  | "VERIFYING"
  | "OFFICIAL_LINK_ONLY"
  | "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME"
  | "USER_AUTHORIZED_PHASE1_EXCLUSION";

export type PublicationHealth = "HEALTHY" | "DEGRADED" | "NOT_APPLICABLE";

export type PublicationReasonCode =
  | "ALL_CURRENT_STAGED_SOURCES_QUALIFIED"
  | "QUALIFIED_BUT_LATEST_WINDOW_UNHEALTHY"
  | "AWAITING_TWO_ADJACENT_SUCCESSES"
  | "CURRENT_CONFIG_HAS_NO_ATTEMPT"
  | "CURRENT_CONFIG_MISMATCH"
  | "LATEST_ATTEMPT_FAILED"
  | "OFFICIAL_ENTRY_NOT_AUTOMATED"
  | "OFFICIAL_ENTRY_UNDER_VERIFICATION"
  | "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME"
  | "USER_AUTHORIZED_PHASE1_EXCLUSION";

export interface CurrentStagedPublicationSource {
  companyId: string;
  sourceId: string;
  currentConfigSha256: string;
}

export type PublicationStableRequiredField = "COMPANY" | "TITLE" | "OFFICIAL_URL" | "LOCATION";

export interface PublicationAttemptObservation {
  id: string;
  sourceResultId: string | null;
  sourceId: string;
  sourceConfigSha256: string | null;
  crawledAt: Date;
  successful: boolean;
  transportSucceeded: boolean | null;
  adapterSucceeded: boolean | null;
  completenessVerified: boolean | null;
  atomicCommitSucceeded: boolean | null;
  structuredJobCount: number;
  expectedJobCount: number | null;
  completenessStatus:
    | "PENDING"
    | "VERIFIED"
    | "NEEDS_MANUAL_COMPLETENESS_REVIEW"
    | "INCOMPLETE"
    | "FAILED"
    | null;
  stableRequiredFields: readonly PublicationStableRequiredField[];
}

export interface PublicationAttempt {
  id: string;
  batchId: string;
  batchKind: "FULL_RELEASE" | "SCHEDULED" | "BASELINE";
  batchStatus: "RUNNING" | "INCOMPLETE" | "ABORTED" | "SUCCESS" | "FAILED";
  batchStartedAt: Date;
  batchFinishedAt: Date | null;
  sourceId: string;
  sourceStartedAt: Date;
  finishedAt: Date | null;
  sourceConfigHash: string;
  transportState: "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "SKIPPED";
  adapterState: "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "SKIPPED";
  completenessState: "PENDING" | "VERIFIED" | "NEEDS_MANUAL_COMPLETENESS_REVIEW" | "INCOMPLETE" | "FAILED";
  atomicCommitState: "PENDING" | "COMMITTED" | "ROLLED_BACK" | "NOT_ATTEMPTED" | "FAILED";
  dedupeOutputCount: number;
  expectedJobCount: number | null;
  officialEntryId: string | null;
  officialSurfaceIds: readonly string[];
  officialChannelIds: readonly string[];
  observations: readonly PublicationAttemptObservation[];
}

export interface SourcePublicationEvaluation {
  sourceId: string;
  currentConfigSha256: string;
  hasQualifiedCurrentConfig: boolean;
  latestWindowHealthy: boolean;
  qualifiedAt: Date | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  reasonCode: PublicationReasonCode;
}

export interface CompanyPublicationRecord {
  companyId: string;
  companyName: string;
  pinyinName: string;
  category: "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
  officialWebsiteUrl: string | null;
  officialCareersUrl: string | null;
  state: PublicationState;
  health: PublicationHealth;
  stagedSourceIds: string[];
  eligibleSourceIds: string[];
  qualifiedAt: Date | null;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  reasonCode: PublicationReasonCode;
}

export interface CompanyPublicationSnapshot {
  companies: CompanyPublicationRecord[];
  eligibleCompanyIds: string[];
  eligibleSourceIds: string[];
  countsByState: Record<PublicationState, number>;
  countsByHealth: Record<PublicationHealth, number>;
}

const ALLOWED_BATCH_KINDS = new Set(["FULL_RELEASE", "SCHEDULED", "BASELINE"]);
const ALLOWED_BATCH_STATUSES = new Set(["RUNNING", "INCOMPLETE", "ABORTED", "SUCCESS", "FAILED"]);
const REQUIRED_POSITIVE_FIELDS = ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"] as const;

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function assertSupportedBatchKind(attempt: PublicationAttempt): void {
  if (!ALLOWED_BATCH_KINDS.has(attempt.batchKind)) {
    throw new Error(`UNSUPPORTED_PUBLICATION_BATCH_KIND:${String(attempt.batchKind)}`);
  }
}

function assertSupportedBatchStatus(attempt: PublicationAttempt): void {
  if (!ALLOWED_BATCH_STATUSES.has(attempt.batchStatus)) {
    throw new Error(`UNSUPPORTED_PUBLICATION_BATCH_STATUS:${String(attempt.batchStatus)}`);
  }
}

function isInFlightAttempt(attempt: PublicationAttempt): boolean {
  return attempt.batchStatus === "RUNNING";
}

function isNonnegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function isQualifyingPublicationAttempt(
  attempt: PublicationAttempt,
  currentSource: CurrentStagedPublicationSource
): boolean {
  assertSupportedBatchKind(attempt);
  assertSupportedBatchStatus(attempt);
  if (
    attempt.sourceId !== currentSource.sourceId ||
    attempt.sourceConfigHash !== currentSource.currentConfigSha256 ||
    attempt.batchStatus === "RUNNING" ||
    attempt.batchFinishedAt === null ||
    attempt.finishedAt === null ||
    attempt.transportState !== "SUCCEEDED" ||
    attempt.adapterState !== "SUCCEEDED" ||
    attempt.atomicCommitState !== "COMMITTED" ||
    !isNonnegativeInteger(attempt.dedupeOutputCount) ||
    (attempt.expectedJobCount !== null && !isNonnegativeInteger(attempt.expectedJobCount)) ||
    attempt.observations.length !== 1
  ) {
    return false;
  }

  const observation = attempt.observations[0]!;
  if (
    observation.sourceResultId !== attempt.id ||
    observation.sourceId !== attempt.sourceId ||
    observation.sourceConfigSha256 !== attempt.sourceConfigHash ||
    observation.sourceConfigSha256 !== currentSource.currentConfigSha256 ||
    observation.successful !== true ||
    observation.transportSucceeded !== true ||
    observation.adapterSucceeded !== true ||
    observation.atomicCommitSucceeded !== true ||
    !isNonnegativeInteger(observation.structuredJobCount) ||
    (observation.expectedJobCount !== null && !isNonnegativeInteger(observation.expectedJobCount)) ||
    observation.structuredJobCount !== attempt.dedupeOutputCount ||
    observation.expectedJobCount !== attempt.expectedJobCount
  ) {
    return false;
  }

  const outputCount = attempt.dedupeOutputCount;
  const complete = attempt.completenessState === "VERIFIED" &&
    observation.completenessVerified === true && observation.completenessStatus === "VERIFIED";
  const partial = (attempt.completenessState === "INCOMPLETE" ||
      attempt.completenessState === "NEEDS_MANUAL_COMPLETENESS_REVIEW") &&
    observation.completenessVerified === false &&
    observation.completenessStatus === attempt.completenessState &&
    attempt.officialSurfaceIds.length > 0 && attempt.officialChannelIds.length > 0 &&
    attempt.officialSurfaceIds.every((value) => value.trim() !== "") &&
    attempt.officialChannelIds.every((value) => value.trim() !== "") &&
    new Set(attempt.officialSurfaceIds).size === attempt.officialSurfaceIds.length &&
    new Set(attempt.officialChannelIds).size === attempt.officialChannelIds.length;
  if (!complete && !partial) return false;
  if (complete && attempt.expectedJobCount !== null && outputCount !== attempt.expectedJobCount) return false;
  if (partial && (outputCount === 0 ||
      (attempt.expectedJobCount !== null && attempt.expectedJobCount < outputCount))) return false;
  if (outputCount === 0) return complete && attempt.expectedJobCount === 0;

  const stableFields = new Set(observation.stableRequiredFields);
  return REQUIRED_POSITIVE_FIELDS.every((field) => stableFields.has(field));
}

function compareAttempts(left: PublicationAttempt, right: PublicationAttempt): number {
  return left.batchStartedAt.getTime() - right.batchStartedAt.getTime() ||
    compareUtf8(left.batchId, right.batchId) ||
    left.sourceStartedAt.getTime() - right.sourceStartedAt.getTime() ||
    compareUtf8(left.id, right.id);
}

function maxDate(values: readonly (Date | null)[]): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (value !== null && (latest === null || value.getTime() > latest.getTime())) latest = value;
  }
  return latest;
}

export function evaluateSourcePublicationEligibility(
  currentSource: CurrentStagedPublicationSource,
  attempts: readonly PublicationAttempt[]
): SourcePublicationEvaluation {
  const duplicateKeys = new Set<string>();
  for (const attempt of attempts) {
    assertSupportedBatchKind(attempt);
    assertSupportedBatchStatus(attempt);
    if (attempt.sourceId !== currentSource.sourceId) {
      throw new Error(`PUBLICATION_SOURCE_ATTEMPT_TUPLE_DRIFT:${attempt.id}`);
    }
    const key = `${attempt.batchId}\u0000${attempt.sourceId}`;
    if (duplicateKeys.has(key)) throw new Error(`DUPLICATE_SOURCE_ATTEMPT:${attempt.batchId}:${attempt.sourceId}`);
    duplicateKeys.add(key);
  }

  const completedAttempts = [...attempts]
    .sort(compareAttempts)
    .filter((attempt) => !isInFlightAttempt(attempt));
  const qualifying = completedAttempts.map((attempt) =>
    isQualifyingPublicationAttempt(attempt, currentSource)
  );

  let qualifiedAt: Date | null = null;
  for (let index = 1; index < completedAttempts.length; index += 1) {
    if (qualifying[index - 1] === true && qualifying[index] === true) {
      qualifiedAt = completedAttempts[index]!.finishedAt;
      break;
    }
  }
  const hasQualifiedCurrentConfig = qualifiedAt !== null;
  const latestWindowHealthy = qualifying.length >= 2 &&
    qualifying[qualifying.length - 2] === true &&
    qualifying[qualifying.length - 1] === true;
  const lastAttemptAt = maxDate(completedAttempts.map(({ finishedAt }) => finishedAt));
  const lastSuccessAt = maxDate(completedAttempts.map((attempt, index) =>
    qualifying[index] === true ? attempt.finishedAt : null
  ));

  let reasonCode: PublicationReasonCode;
  if (hasQualifiedCurrentConfig) {
    reasonCode = latestWindowHealthy
      ? "ALL_CURRENT_STAGED_SOURCES_QUALIFIED"
      : "QUALIFIED_BUT_LATEST_WINDOW_UNHEALTHY";
  } else if (completedAttempts.length === 0) {
    reasonCode = "CURRENT_CONFIG_HAS_NO_ATTEMPT";
  } else {
    const latest = completedAttempts[completedAttempts.length - 1]!;
    if (qualifying[qualifying.length - 1] === true) {
      reasonCode = "AWAITING_TWO_ADJACENT_SUCCESSES";
    } else if (latest.sourceConfigHash !== currentSource.currentConfigSha256) {
      reasonCode = "CURRENT_CONFIG_MISMATCH";
    } else {
      reasonCode = "LATEST_ATTEMPT_FAILED";
    }
  }

  return {
    sourceId: currentSource.sourceId,
    currentConfigSha256: currentSource.currentConfigSha256,
    hasQualifiedCurrentConfig,
    latestWindowHealthy,
    qualifiedAt,
    lastAttemptAt,
    lastSuccessAt,
    reasonCode
  };
}

function deterministicOfficialCareersUrl(company: CandidateCompany): string | null {
  const source = [...company.sources]
    .filter(({ kind, officialEntryUrl }) => kind === "SOCIAL" && Boolean(officialEntryUrl?.trim()))
    .sort((left, right) =>
      compareUtf8(left.id, right.id) || compareUtf8(left.officialEntryUrl ?? "", right.officialEntryUrl ?? "")
    )[0];
  return source?.officialEntryUrl ?? null;
}

function hasOfficialLinkOnlyAuthority(company: CandidateCompany): boolean {
  return company.sources.some((source) =>
    source.kind === "SOCIAL" &&
    Boolean(source.officialEntryUrl?.trim()) &&
    Boolean(source.officialChainEvidenceUrl?.trim())
  );
}

function canonicalOfficialSocialSourceIds(company: CandidateCompany): string[] {
  return [...new Set(company.sources
    .filter((source) =>
      source.kind === "SOCIAL" &&
      Boolean(source.officialEntryUrl?.trim()) &&
      Boolean(source.officialChainEvidenceUrl?.trim())
    )
    .map(({ id }) => id))]
    .sort(compareUtf8);
}

function aggregateVerifyingReason(evaluations: readonly SourcePublicationEvaluation[]): PublicationReasonCode {
  const priorities: PublicationReasonCode[] = [
    "LATEST_ATTEMPT_FAILED",
    "CURRENT_CONFIG_MISMATCH",
    "AWAITING_TWO_ADJACENT_SUCCESSES",
    "CURRENT_CONFIG_HAS_NO_ATTEMPT"
  ];
  return priorities.find((reason) => evaluations.some(({ reasonCode }) => reasonCode === reason)) ??
    "CURRENT_CONFIG_HAS_NO_ATTEMPT";
}

export function evaluateCompanyPublicationState(
  company: CandidateCompany,
  currentSources: readonly CurrentStagedPublicationSource[],
  sourceEvaluations: readonly SourcePublicationEvaluation[]
): CompanyPublicationRecord {
  const orderedSources = [...currentSources].sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
  if (orderedSources.some(({ companyId }) => companyId !== company.id)) {
    throw new Error(`PUBLICATION_SOURCE_COMPANY_TUPLE_DRIFT:${company.id}`);
  }
  if (new Set(orderedSources.map(({ sourceId }) => sourceId)).size !== orderedSources.length) {
    throw new Error(`DUPLICATE_CURRENT_PUBLICATION_SOURCE:${company.id}`);
  }

  const evaluationBySourceId = new Map<string, SourcePublicationEvaluation>();
  for (const evaluation of sourceEvaluations) {
    if (evaluationBySourceId.has(evaluation.sourceId)) {
      throw new Error(`DUPLICATE_SOURCE_PUBLICATION_EVALUATION:${evaluation.sourceId}`);
    }
    evaluationBySourceId.set(evaluation.sourceId, evaluation);
  }
  const orderedEvaluations = orderedSources.map((source) => {
    const evaluation = evaluationBySourceId.get(source.sourceId);
    if (!evaluation || evaluation.currentConfigSha256 !== source.currentConfigSha256) {
      throw new Error(`PUBLICATION_SOURCE_EVALUATION_TUPLE_DRIFT:${source.sourceId}`);
    }
    return evaluation;
  });
  if (evaluationBySourceId.size !== orderedEvaluations.length) {
    throw new Error(`UNPLANNED_SOURCE_PUBLICATION_EVALUATION:${company.id}`);
  }

  const stagedSourceIds = orderedSources.map(({ sourceId }) => sourceId);
  const officialCareersUrl = deterministicOfficialCareersUrl(company);
  const lastAttemptAt = maxDate(orderedEvaluations.map(({ lastAttemptAt }) => lastAttemptAt));
  const lastSuccessAt = maxDate(orderedEvaluations.map(({ lastSuccessAt }) => lastSuccessAt));
  let state: PublicationState;
  let health: PublicationHealth = "NOT_APPLICABLE";
  let reasonCode: PublicationReasonCode;
  let eligibleSourceIds: string[] = [];
  let qualifiedAt: Date | null = null;

  if (isUserAuthorizedPhase1Exclusion(company.id)) {
    state = "USER_AUTHORIZED_PHASE1_EXCLUSION";
    reasonCode = "USER_AUTHORIZED_PHASE1_EXCLUSION";
  } else if (company.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME") {
    state = "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME";
    reasonCode = "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME";
  } else if (orderedSources.length > 0) {
    const stagedSourceIdSet = new Set(stagedSourceIds);
    const allOfficialSourcesStaged = canonicalOfficialSocialSourceIds(company)
      .every((sourceId) => stagedSourceIdSet.has(sourceId));
    const allQualified = allOfficialSourcesStaged && orderedEvaluations.every((evaluation) =>
      evaluation.hasQualifiedCurrentConfig && evaluation.qualifiedAt !== null
    );
    if (!allOfficialSourcesStaged) {
      state = "VERIFYING";
      reasonCode = "OFFICIAL_ENTRY_NOT_AUTOMATED";
    } else if (allQualified) {
      state = "PUBLISHING";
      eligibleSourceIds = [...stagedSourceIds];
      qualifiedAt = maxDate(orderedEvaluations.map(({ qualifiedAt: sourceQualifiedAt }) => sourceQualifiedAt));
      const allHealthy = orderedEvaluations.every(({ latestWindowHealthy }) => latestWindowHealthy);
      health = allHealthy ? "HEALTHY" : "DEGRADED";
      reasonCode = allHealthy
        ? "ALL_CURRENT_STAGED_SOURCES_QUALIFIED"
        : "QUALIFIED_BUT_LATEST_WINDOW_UNHEALTHY";
    } else {
      state = "VERIFYING";
      reasonCode = aggregateVerifyingReason(orderedEvaluations);
    }
  } else if (hasOfficialLinkOnlyAuthority(company)) {
    state = "OFFICIAL_LINK_ONLY";
    reasonCode = "OFFICIAL_ENTRY_NOT_AUTOMATED";
  } else {
    state = "VERIFYING";
    reasonCode = "OFFICIAL_ENTRY_UNDER_VERIFICATION";
  }

  return {
    companyId: company.id,
    companyName: company.officialChineseName,
    pinyinName: company.pinyinName,
    category: company.category,
    officialWebsiteUrl: company.officialWebsiteUrl ?? null,
    officialCareersUrl,
    state,
    health,
    stagedSourceIds,
    eligibleSourceIds,
    qualifiedAt,
    lastAttemptAt,
    lastSuccessAt,
    reasonCode
  };
}

export function buildCompanyPublicationSnapshot(
  companies: readonly CandidateCompany[],
  currentSources: readonly CurrentStagedPublicationSource[],
  attempts: readonly PublicationAttempt[]
): CompanyPublicationSnapshot {
  const companyIds = new Set<string>();
  for (const company of companies) {
    if (companyIds.has(company.id)) throw new Error(`DUPLICATE_PUBLICATION_COMPANY:${company.id}`);
    companyIds.add(company.id);
  }

  const currentSourceIds = new Set<string>();
  for (const source of currentSources) {
    if (!companyIds.has(source.companyId)) throw new Error(`UNKNOWN_PUBLICATION_SOURCE_COMPANY:${source.companyId}`);
    if (currentSourceIds.has(source.sourceId)) throw new Error(`DUPLICATE_CURRENT_PUBLICATION_SOURCE:${source.sourceId}`);
    currentSourceIds.add(source.sourceId);
  }

  const plannedAttempts = attempts.filter(({ sourceId }) => currentSourceIds.has(sourceId));
  const evaluationsBySourceId = new Map<string, SourcePublicationEvaluation>();
  for (const source of currentSources) {
    evaluationsBySourceId.set(source.sourceId, evaluateSourcePublicationEligibility(
      source,
      plannedAttempts.filter(({ sourceId }) => sourceId === source.sourceId)
    ));
  }

  const records = companies.map((company) => {
    const sources = currentSources.filter(({ companyId }) => companyId === company.id);
    const evaluations = sources.map(({ sourceId }) => evaluationsBySourceId.get(sourceId)!);
    return evaluateCompanyPublicationState(company, sources, evaluations);
  }).sort((left, right) =>
    compareUtf8(left.pinyinName, right.pinyinName) || compareUtf8(left.companyId, right.companyId)
  );

  const countsByState: Record<PublicationState, number> = {
    PUBLISHING: 0,
    VERIFYING: 0,
    OFFICIAL_LINK_ONLY: 0,
    NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME: 0,
    USER_AUTHORIZED_PHASE1_EXCLUSION: 0
  };
  const countsByHealth: Record<PublicationHealth, number> = {
    HEALTHY: 0,
    DEGRADED: 0,
    NOT_APPLICABLE: 0
  };
  for (const record of records) {
    countsByState[record.state] += 1;
    countsByHealth[record.health] += 1;
  }

  return {
    companies: records,
    eligibleCompanyIds: records
      .filter(({ state }) => state === "PUBLISHING")
      .map(({ companyId }) => companyId)
      .sort(compareUtf8),
    eligibleSourceIds: [...new Set(records.flatMap(({ eligibleSourceIds }) => eligibleSourceIds))].sort(compareUtf8),
    countsByState,
    countsByHealth
  };
}
