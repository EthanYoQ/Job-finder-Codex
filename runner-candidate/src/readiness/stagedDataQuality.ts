import { reconcileLifecycleSets, type LifecycleSetEvidence } from "./lifecycleSetReconciliation";

export type StagedDataQualityIssueCode =
  | "ELIGIBLE_SOURCE_SET_INVALID"
  | "LATEST_SOURCE_RESULT_MISSING"
  | "LATEST_SOURCE_RESULT_NOT_RELEASE_ELIGIBLE"
  | "OBSERVATION_MISMATCH"
  | "LIFECYCLE_SET_INVALID"
  | "PUBLIC_JOB_SET_MISMATCH"
  | "PUBLIC_JOB_FIELDS_INVALID";

export interface StagedDataQualityIssue {
  code: StagedDataQualityIssueCode;
  message: string;
  sourceId?: string;
}

export interface StagedDataQualityObservation {
  releaseCandidateId: string;
  batchId: string;
  sourceResultId: string;
  sourceId: string;
  sourceConfigSha256: string | null;
  successful: boolean;
  transportSucceeded: boolean | null;
  adapterSucceeded: boolean | null;
  completenessVerified: boolean | null;
  atomicCommitSucceeded: boolean | null;
  structuredJobCount: number;
  expectedJobCount: number | null;
  completenessStatus: string | null;
  canonicalOutputSha256: string | null;
  canonicalGraceSha256: string | null;
  canonicalVisibleSha256: string | null;
}

export interface StagedDataQualitySourceResult {
  releaseCandidateId: string;
  batchId: string;
  sourceResultId: string;
  sourceId: string;
  sourceConfigHash: string;
  batchKind: string;
  transportState: string;
  adapterState: string;
  completenessState: string;
  atomicCommitState: string;
  dedupeOutputCount: number;
  expectedJobCount: number | null;
  canonicalOutputSetSha256: string | null;
  canonicalCurrentJobSetSha256: string | null;
  canonicalGraceJobSetSha256: string | null;
  canonicalVisibleJobSetSha256: string | null;
  observation: StagedDataQualityObservation;
  lifecycleSetEvidence: LifecycleSetEvidence;
}

export interface StagedPublicVisibleJob {
  sourceId: string;
  dedupeKey: string;
  companyId: string;
  officialTitle: string;
  officialUrl: string;
  locationRaw: string;
}

export interface StagedEligibleSource {
  sourceId: string;
  companyId: string;
  currentConfigSha256: string;
}

export interface StagedDataQualityInput {
  releaseCandidateId: string;
  eligibleSources: StagedEligibleSource[];
  latestSourceResults: StagedDataQualitySourceResult[];
  publicVisibleJobs: StagedPublicVisibleJob[];
}

export interface StagedDataQualityReport {
  canRelease: boolean;
  eligibleSourceCount: number;
  publicVisibleJobCount: number;
  issues: StagedDataQualityIssue[];
}

export function evaluateStagedDataQuality(input: StagedDataQualityInput): StagedDataQualityReport {
  const issues: StagedDataQualityIssue[] = [];
  const eligibleSourceIds = canonical(input.eligibleSources.map(({ sourceId }) => sourceId));
  if (!input.releaseCandidateId.trim() || eligibleSourceIds.length === 0 ||
      eligibleSourceIds.length !== input.eligibleSources.length ||
      input.eligibleSources.some(({ sourceId, companyId, currentConfigSha256 }) =>
        !sourceId.trim() || !companyId.trim() || !/^[0-9a-f]{64}$/.test(currentConfigSha256))) {
    issues.push({
      code: "ELIGIBLE_SOURCE_SET_INVALID",
      message: "Eligible publication sources must be a unique non-empty current set."
    });
  }

  const eligibleSet = new Set(eligibleSourceIds);
  const eligibleBySource = new Map(input.eligibleSources.map((source) => [source.sourceId, source]));
  const resultsBySource = new Map<string, StagedDataQualitySourceResult[]>();
  for (const result of input.latestSourceResults) {
    const rows = resultsBySource.get(result.sourceId) ?? [];
    rows.push(result);
    resultsBySource.set(result.sourceId, rows);
    if (!eligibleSet.has(result.sourceId)) {
      issues.push({
        code: "ELIGIBLE_SOURCE_SET_INVALID",
        sourceId: result.sourceId,
        message: "A staged data-quality result is outside the eligible publication source set."
      });
    }
  }
  if (input.publicVisibleJobs.some(({ sourceId }) => !eligibleSet.has(sourceId))) {
    issues.push({
      code: "ELIGIBLE_SOURCE_SET_INVALID",
      message: "The public job projection contains a source outside the eligible set."
    });
  }

  for (const sourceId of eligibleSourceIds) {
    const results = resultsBySource.get(sourceId) ?? [];
    if (results.length !== 1) {
      issues.push({
        code: "LATEST_SOURCE_RESULT_MISSING",
        sourceId,
        message: `Expected exactly one latest source result; found ${results.length}.`
      });
      continue;
    }
    const result = results[0]!;
    const eligibleSource = eligibleBySource.get(sourceId)!;
    if (result.releaseCandidateId !== input.releaseCandidateId || result.batchKind !== "SCHEDULED" ||
        result.sourceConfigHash !== eligibleSource.currentConfigSha256 ||
        result.transportState !== "SUCCEEDED" || result.adapterState !== "SUCCEEDED" ||
        result.completenessState !== "VERIFIED" || result.atomicCommitState !== "COMMITTED") {
      issues.push({
        code: "LATEST_SOURCE_RESULT_NOT_RELEASE_ELIGIBLE",
        sourceId,
        message: "Latest source truth is not an exact successful scheduled atomic result."
      });
      continue;
    }

    const observation = result.observation;
    if (!sameTuple(result, observation) || observation.successful !== true ||
        observation.sourceConfigSha256 !== eligibleSource.currentConfigSha256 ||
        observation.transportSucceeded !== true || observation.adapterSucceeded !== true ||
        observation.completenessVerified !== true || observation.atomicCommitSucceeded !== true ||
        observation.completenessStatus !== "VERIFIED" ||
        !Number.isSafeInteger(observation.structuredJobCount) || observation.structuredJobCount < 0 ||
        observation.structuredJobCount !== result.dedupeOutputCount ||
        observation.expectedJobCount !== result.expectedJobCount ||
        (observation.expectedJobCount !== null && observation.expectedJobCount !== observation.structuredJobCount) ||
        result.canonicalOutputSetSha256 !== result.canonicalCurrentJobSetSha256 ||
        observation.canonicalOutputSha256 !== result.canonicalOutputSetSha256 ||
        observation.canonicalGraceSha256 !== result.canonicalGraceJobSetSha256 ||
        observation.canonicalVisibleSha256 !== result.canonicalVisibleJobSetSha256) {
      issues.push({
        code: "OBSERVATION_MISMATCH",
        sourceId,
        message: "Latest observation does not match the successful atomic source result."
      });
      continue;
    }

    let visibleKeys: string[];
    try {
      const sets = reconcileLifecycleSets(result.lifecycleSetEvidence);
      if (!sameTuple(result, result.lifecycleSetEvidence) || sets.currentCount !== observation.structuredJobCount ||
          sets.currentSha256 !== result.canonicalCurrentJobSetSha256 ||
          sets.graceSha256 !== result.canonicalGraceJobSetSha256 ||
          sets.visibleSha256 !== result.canonicalVisibleJobSetSha256) {
        throw new Error("tuple or current count mismatch");
      }
      visibleKeys = canonical(result.lifecycleSetEvidence.visibleKeys);
    } catch {
      issues.push({
        code: "LIFECYCLE_SET_INVALID",
        sourceId,
        message: "Committed lifecycle evidence does not reconcile for the public source."
      });
      continue;
    }

    const jobs = input.publicVisibleJobs.filter((job) => job.sourceId === sourceId);
    const actualKeys = canonical(jobs.map(({ dedupeKey }) => dedupeKey));
    if (actualKeys.length !== jobs.length || JSON.stringify(actualKeys) !== JSON.stringify(visibleKeys)) {
      issues.push({
        code: "PUBLIC_JOB_SET_MISMATCH",
        sourceId,
        message: "Database public jobs do not match the committed visible lifecycle set."
      });
    }
    if (jobs.some((job) => !validPublicJob(job))) {
      issues.push({
        code: "PUBLIC_JOB_FIELDS_INVALID",
        sourceId,
        message: "A public job is missing a required official field or safe web URL."
      });
    }
    if (jobs.some((job) => job.companyId !== eligibleSource.companyId)) {
      issues.push({
        code: "PUBLIC_JOB_FIELDS_INVALID",
        sourceId,
        message: "A public job is bound to the wrong company for its official source."
      });
    }
  }

  return {
    canRelease: issues.length === 0,
    eligibleSourceCount: eligibleSourceIds.length,
    publicVisibleJobCount: input.publicVisibleJobs.length,
    issues
  };
}

function sameTuple(
  left: Pick<StagedDataQualitySourceResult, "releaseCandidateId" | "batchId" | "sourceResultId" | "sourceId">,
  right: Pick<LifecycleSetEvidence, "releaseCandidateId" | "batchId" | "sourceResultId" | "sourceId">
): boolean {
  return left.releaseCandidateId === right.releaseCandidateId && left.batchId === right.batchId &&
    left.sourceResultId === right.sourceResultId && left.sourceId === right.sourceId;
}

function validPublicJob(job: StagedPublicVisibleJob): boolean {
  if (![job.companyId, job.dedupeKey, job.officialTitle, job.locationRaw].every((value) => value.trim())) return false;
  try {
    const url = new URL(job.officialUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}
