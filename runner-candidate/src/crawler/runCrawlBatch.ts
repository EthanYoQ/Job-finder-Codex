import { isProvenUnstartedBatchAbort } from "../domain/unstartedBatchAbort";
import { getPortableCoverageScope } from "../release/portableCoveragePolicy";
import { getPortableSourceCoverageHold } from "../release/portableSourceCoverageHolds";
import { SOURCE_QUALITY_POLICY_ID, getSourceQualityPolicy, issueSourceQualityAdmission } from "./sourceQualityAdmission";
import { createPortableFencedRuntimeDatabase } from "../db/portableRuntimeDatabase";
import type { SourceQualityPublicationInput } from "./sourceQualityPublication";
import { heartbeatPortableCrawlLease, type PortableCrawlLease, type PortableLeaseDatabase } from "./portableCrawlLease";
import {
  createBatchWithPendingSourceResults,
  executeAtomicSourceEvidenceCommit,
  executePortableAtomicSourceEvidenceCommit,
  executeFailedSourceEvidenceCommit,
  executeManualFailedSourceEvidenceCommit,
  executeManualSourceEvidenceCommit,
  inspectPersistedAtomicCommitOutcome,
  inspectPersistedFailedSourceEvidenceCommitOutcome,
  readPersistedBatchSourceResults,
  terminateManualPendingSourceResult,
  terminatePendingSourceResult,
  type AtomicSourceEvidenceCommit,
  type PersistedBatchSourceResultRow,
  type PrismaIngestionDb,
  type ManualSourceCommitFence,
  type PendingSourceTerminalInput
} from "../db/ingestionRepository";
import {
  toSourceScheduleState,
  type PersistedCrawlObservationRow
} from "../db/crawlStateRepository";
import type { JobSnapshot } from "./lifecycle";
import { buildJobDedupeKey } from "./normalizedJob";
import {
  createSourceFetchAttemptTracker,
  markInitialSourceFetchAttempt,
  runSourceCrawl,
  SourceCrawlStageError,
  type SourceFetchAttemptTracker,
  type SourceFetchFunction,
  type SourceCrawlResult
} from "./runSourceCrawl";
import {
  hashCanonicalJobKeySet,
  validatePlannedSourceContract,
  type CrawlBatchKind,
  type RuntimeBatchIdentity
} from "./runtimeBatchIdentity";
import { isSourceDueForScheduledRun } from "./schedule";
import { sourcePlanConfigSha256, validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import { safeSourceTransportFailureReason } from "./sourceFetchFailure";
import {
  atomicEvidencePersistenceStage,
  atomicEvidenceFailureCode,
  sourceExecutionFailureCode,
  sourceFailureDiagnosticBundle,
  transportFailureDiagnosticBundle
} from "./sourceFailureDiagnostics";
import { safeProfileBoundSourceFailureReason } from "./profileBoundSourceEvidence";
import { isSafeHtmlFailureCode } from "./httpHtmlSourceFetch";
import {
  bindRuntimeEvidenceArtifactIds,
  buildAtomicRuntimeCommit,
  buildFailedRuntimeEvidenceCommit,
  buildPendingRuntimeBatch
} from "./runtimeAtomicEvidence";
import { createHash, randomUUID } from "node:crypto";
import { bayerHybridFinishedAt } from "./bayerMokaRenderedTraversal";
import { sanofiChineseIndependentFinishedAt } from "./sanofiChineseRenderedTraversal";
import { bindSanofiChineseIndependentArtifact, isSanofiChinesePlan } from "./sanofiChineseNative";
import { archiveSourceEvidence, verifyArchivedSourceEvidence, ArtifactArchiveError,
  type ArchivedEvidenceArtifact } from "./artifactArchive";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { releaseMembersFromPlans, validateAuthoritativeReleaseMembership,
} from "./authoritativeReleaseMembership";
import { getStartupReleaseMembership } from "./releaseMembershipAuthority";
import { getStartupSourceSurfaceOracle } from "./sourceSurfaceOracleAuthority";
import { validateIndependentSourceSurfaceOracle } from "./independentSourceSurfaceOracle";
import {
  isOfficialSourceAttemptTimeout,
  OfficialSourceAttemptTimeoutError,
  runWithOfficialSourceAttemptTimeout,
  runWithOfficialSourceCancellation,
  sourceAttemptTimeoutMs
} from "./officialHttpRuntimeLimits";
import {
  bGradeTraversalValidationMatchesCurrentJobs,
  readReusableBGradeTraversalValidation,
  requiresBGradeTraversalCertificate,
  BAYER_INDEPENDENT_ORIGINAL_LOCATOR,
  SANOFI_INDEPENDENT_ORIGINAL_LOCATOR,
  type SanofiIndependentArchiveBinding,
  type BGradeValidationTrigger,
  type BGradeIndependentTraversalValidation
} from "./traversalCertificate";
import { runIsolatedBGradeTraversalValidator } from "./isolatedBGradeTraversalValidator";
import {
  classifyBGradeIndependentTraversalFailure,
  safeBGradeIndependentTraversalFailureReason,
  type BGradeIndependentTraversalFailureCode
} from "./independentTraversalDiagnostics";
import { requiresAGradeOfficialTotalCertificate } from "./completenessCertificate";
import {
  evaluateCompletenessAnomalyForCrawl,
  comparablePortableBaseline,
  selectCompletenessValidationTrigger,
  type PersistedTrustedCompletenessBaseline
} from "./completenessAnomalyPolicy";

export interface P0CrawlBatchResult {
  status: Exclude<CrawlBatchStatus, "RUNNING">;
  batchId: string;
  plannedSourceCount: number;
  dueSourceCount: number;
  transportSuccessfulSourceCount: number;
  transportFailedSourceCount: number;
  adapterSuccessfulSourceCount: number;
  adapterFailedSourceCount: number;
  completenessVerifiedSourceCount: number;
  completenessIncompleteSourceCount: number;
  atomicCommittedSourceCount: number;
  atomicFailedSourceCount: number;
  successfulSourceCount: number;
  failedSourceCount: number;
  blockedSourceCount: number;
  skippedSourceCount: number;
}

interface CrawlBatchRecord {
  id: string;
}

export type CrawlBatchStatus = "RUNNING" | "INCOMPLETE" | "FAILED" | "SUCCESS";

export function resolveP0CrawlBatchTerminalStatus(input: {
  batchKind: CrawlBatchKind;
  failedSourceCount: number;
  atomicFailedSourceCount: number;
  hasExactSuccessfulDenominator: boolean;
}): Exclude<CrawlBatchStatus, "RUNNING"> {
  if (input.atomicFailedSourceCount > 0) return "FAILED";
  if (input.hasExactSuccessfulDenominator) return "SUCCESS";
  if (input.batchKind === "SCHEDULED") return "INCOMPLETE";
  return input.failedSourceCount > 0 ? "FAILED" : "INCOMPLETE";
}

type PersistedBatchSummary = Omit<
  P0CrawlBatchResult,
  "status" | "batchId" | "plannedSourceCount"
>;

export function summarizePersistedBatchSourceResults(
  plannedSourceIds: readonly string[],
  rows: readonly PersistedBatchSourceResultRow[],
  portableMode = false
): PersistedBatchSummary {
  const planned = new Set(plannedSourceIds);
  if (planned.size !== plannedSourceIds.length || rows.length !== planned.size) {
    throw new Error("PERSISTED_BATCH_SOURCE_SET_MISMATCH");
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (!planned.has(row.sourceId) || seen.has(row.sourceId)) {
      throw new Error("PERSISTED_BATCH_SOURCE_SET_MISMATCH");
    }
    if (row.transportState === "PENDING" || row.adapterState === "PENDING" ||
        row.completenessState === "PENDING" || row.atomicCommitState === "PENDING") {
      throw new Error("PERSISTED_BATCH_SOURCE_NOT_TERMINAL");
    }
    seen.add(row.sourceId);
  }

  const skipped = rows.filter((row) => isPersistedSourceSkip(row, portableMode));
  const due = rows.filter((row) => !isPersistedSourceSkip(row, portableMode));
  const successful = due.filter((row) => row.transportState === "SUCCEEDED" &&
    row.adapterState === "SUCCEEDED" && row.completenessState === "VERIFIED" &&
    row.atomicCommitState === "COMMITTED" && row.failureCode === null);
  const blocked = due.filter((row) => row.transportState === "SUCCEEDED" &&
    row.adapterState === "SUCCEEDED" &&
    (row.completenessState === "INCOMPLETE" ||
      row.completenessState === "NEEDS_MANUAL_COMPLETENESS_REVIEW") &&
    row.atomicCommitState === "COMMITTED" && row.failureCode === null);

  return {
    dueSourceCount: due.length,
    transportSuccessfulSourceCount: due.filter((row) => row.transportState === "SUCCEEDED").length,
    transportFailedSourceCount: due.filter((row) => row.transportState === "FAILED" &&
      (portableMode || row.failureCode !== "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL")).length,
    adapterSuccessfulSourceCount: due.filter((row) => row.adapterState === "SUCCEEDED").length,
    adapterFailedSourceCount: due.filter((row) => row.adapterState === "FAILED").length,
    completenessVerifiedSourceCount: successful.length,
    completenessIncompleteSourceCount: blocked.length,
    atomicCommittedSourceCount: due.filter((row) => row.atomicCommitState === "COMMITTED").length,
    atomicFailedSourceCount: due.filter((row) =>
      row.atomicCommitState === "FAILED" || row.atomicCommitState === "ROLLED_BACK").length,
    successfulSourceCount: successful.length,
    failedSourceCount: due.length - successful.length - blocked.length,
    blockedSourceCount: blocked.length,
    skippedSourceCount: skipped.length
  };
}

const PORTABLE_SKIP_REASONS: Readonly<Record<string,string>> = Object.freeze({
  USER_AUTHORIZED_COVERAGE_EXCLUSION: "Source is excluded from the current required coverage by the owner",
  SOURCE_COVERAGE_REVIEW_PENDING: "Official source coverage is under review; no acquisition was attempted",
  SOURCE_QUALITY_POLICY_NOT_REVIEWED: "Current source policy is not yet admitted; no acquisition was attempted"
});
function isPersistedSourceSkip(row: PersistedBatchSourceResultRow, portableMode: boolean): boolean {
  if (portableMode && row.transportState === "SKIPPED" && isProvenUnstartedBatchAbort(row, new Date(), "RUNNING")) return true;
  return row.transportState === "SKIPPED" && row.adapterState === "SKIPPED" &&
    row.completenessState === "FAILED" && row.atomicCommitState === "NOT_ATTEMPTED" &&
    (row.failureCode === "SOURCE_NOT_DUE" || row.failureCode !== null && Object.hasOwn(PORTABLE_SKIP_REASONS,row.failureCode));
}

interface PrismaCrawlBatchDb {
  create(args: {
    data: {
      releaseCandidateId: string;
      commitSha: string;
      rosterSha256: string;
      sourcePlanSha256: string;
      sourceConfigSha256: string;
      adapterBundleSha256: string;
      kind: CrawlBatchKind;
      plannedSourceIds: string[];
      plannedSourceSetSha256: string;
      plannedSourceCount: number;
      transportSucceededCount: 0;
      transportFailedCount: 0;
      adapterSucceededCount: 0;
      adapterFailedCount: 0;
      completenessVerifiedCount: 0;
      completenessIncompleteCount: 0;
      atomicCommittedCount: 0;
      atomicFailedCount: 0;
      failedSourceCount: 0;
      blockedSourceCount: 0;
      skippedSourceCount: 0;
      ownerId: string;
      heartbeatAt: Date;
      startedAt: Date;
      status: "RUNNING";
    };
  }): Promise<CrawlBatchRecord>;
  update(args: {
    where: { id: string };
    data: {
      transportSucceededCount: number;
      transportFailedCount: number;
      adapterSucceededCount: number;
      adapterFailedCount: number;
      completenessVerifiedCount: number;
      completenessIncompleteCount: number;
      atomicCommittedCount: number;
      atomicFailedCount: number;
      failedSourceCount: number;
      blockedSourceCount: number;
      skippedSourceCount: number;
      aggregateJobSetSha256: string;
      heartbeatAt: Date;
      finishedAt: Date;
      status: Exclude<CrawlBatchStatus, "RUNNING">;
    };
  }): Promise<unknown>;
}

export interface RunP0CrawlBatchDeps {
  db: PrismaIngestionDb & {
    $transaction<T>(operation: (transaction: any) => Promise<T>): Promise<T>;
    crawlBatch: PrismaCrawlBatchDb;
    createBatchId?: () => string;
  };
  fetch: SourceFetchFunction;
  now: Date | (() => Date);
  identity: RuntimeBatchIdentity;
  force?: boolean;
  sourceAdmissionPolicy?: typeof SOURCE_QUALITY_POLICY_ID;
  publicationPolicy?: "SOURCE_ATOMIC_LAST_GOOD_V1";
  portableLease?: PortableCrawlLease;
  getFirstAcceptedCurrentPolicyReceipt?(sourceId: string, sourceConfigSha256: string): Promise<SourceQualityPublicationInput["firstAcceptedCurrentPolicyReceipt"]>;
  sourceAttemptTimeoutMs?: number;
  createBatchId?: () => string;
  workspaceRoot?: string;
  evidenceSubdirectory?: string;
  archiveEvidence?: typeof archiveSourceEvidence;
  verifyArchive?: typeof verifyArchivedSourceEvidence;
  executeAtomicCommit?: typeof executeAtomicSourceEvidenceCommit;
  executeManualAtomicCommit?: typeof executeManualSourceEvidenceCommit;
  executeFailedEvidenceCommit?: typeof executeFailedSourceEvidenceCommit;
  executeManualFailedEvidenceCommit?: typeof executeManualFailedSourceEvidenceCommit;
  inspectAtomicCommitOutcome?: typeof inspectPersistedAtomicCommitOutcome;
  inspectFailedEvidenceCommitOutcome?: typeof inspectPersistedFailedSourceEvidenceCommitOutcome;
  terminateManualSourceResult?: typeof terminateManualPendingSourceResult;
  readPersistedBatchSourceResults?: typeof readPersistedBatchSourceResults;
  manualRequestFence?: ManualSourceCommitFence;
  recordOrphanedArtifacts?: (artifacts: readonly ArchivedEvidenceArtifact[]) => Promise<void>;
  getPreviousJobs(sourceId: string): Promise<readonly JobSnapshot[]>;
  getRecentObservations(sourceId: string): Promise<readonly PersistedCrawlObservationRow[]>;
  isBaselineCompleted(sourceId: string): Promise<boolean>;
  getTrustedCompletenessBaseline?(
    sourceId: string
  ): Promise<PersistedTrustedCompletenessBaseline | null>;
  runIndependentTraversalValidator?: typeof runIsolatedBGradeTraversalValidator;
}

async function terminateRuntimeSourceResult(
  input: PendingSourceTerminalInput,
  deps: RunP0CrawlBatchDeps
): Promise<void> {
  if (deps.identity.batchKind === "MANUAL_SOURCE") {
    await (deps.terminateManualSourceResult ?? terminateManualPendingSourceResult)(
      input, deps.manualRequestFence!, deps.db as never);
    return;
  }
  await terminatePendingSourceResult(input, deps.db as never);
}

async function captureIndependentTraversal(plan: SourceCrawlPlan, pending: { sourceConfigHash: string; officialSurfaceIds: string[]; officialChannelIds: string[] }, deps: RunP0CrawlBatchDeps, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new OfficialSourceAttemptTimeoutError(timeoutMs)), timeoutMs);
  try {
    return await (deps.runIndependentTraversalValidator ?? runIsolatedBGradeTraversalValidator)({
      sourceId: plan.source.id, companyId: plan.company.id, entryUrl: plan.source.officialEntryUrl,
      sourceConfigSha256: pending.sourceConfigHash, surfaceIds: pending.officialSurfaceIds,
      channelIds: pending.officialChannelIds,
      signal: deps.portableLease ? AbortSignal.any([controller.signal, deps.portableLease.signal]) : controller.signal
    });
  } finally { clearTimeout(timer); }
}

async function archiveAndVerifyRuntimeEvidence(input: {
  deps: RunP0CrawlBatchDeps;
  batchId: string;
  plan: SourceCrawlPlan;
  pending: { id: string };
  result: SourceCrawlResult & { fetchEvidence: NonNullable<SourceCrawlResult["fetchEvidence"]> };
  onArchived?: (artifacts: readonly ArchivedEvidenceArtifact[]) => void;
}): Promise<readonly ArchivedEvidenceArtifact[]> {
  const { deps, batchId, plan, pending, result } = input;
  const artifacts = bindRuntimeEvidenceArtifactIds({
    releaseCandidateId: deps.identity.releaseCandidateId,
    batchId,
    sourceId: plan.source.id,
    sourceResultId: pending.id,
    artifacts: [
      ...result.fetchEvidence.artifacts,
      ...(result.priorTransportAttempts ?? []).flatMap((attempt) => attempt.fetchEvidence?.artifacts ?? [])
    ]
  });
  const archived = await (deps.archiveEvidence ?? archiveSourceEvidence)({
    workspaceRoot: deps.workspaceRoot ?? process.cwd(),
    releaseCandidateId: deps.identity.releaseCandidateId,
    batchId,
    sourceId: plan.source.id,
    sourceResultId: pending.id,
    evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence",
    captureTool: result.fetchEvidence.captureTool,
    formalRelease: deps.identity.batchKind === "FULL_RELEASE",
    artifacts
  });
  input.onArchived?.(archived.artifacts);
  return (deps.verifyArchive ?? verifyArchivedSourceEvidence)({
    workspaceRoot: deps.workspaceRoot ?? process.cwd(),
    releaseCandidateId: deps.identity.releaseCandidateId,
    batchId,
    sourceId: plan.source.id,
    sourceResultId: pending.id,
    evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence",
    formalRelease: deps.identity.batchKind === "FULL_RELEASE",
    artifacts: archived.artifacts
  });
}

export async function runP0CrawlBatch(
  plans: readonly SourceCrawlPlan[],
  deps: RunP0CrawlBatchDeps
): Promise<P0CrawlBatchResult> {
  const portableMode = deps.sourceAdmissionPolicy === SOURCE_QUALITY_POLICY_ID;
  const lastGoodMode = portableMode || deps.publicationPolicy === "SOURCE_ATOMIC_LAST_GOOD_V1";
  if (lastGoodMode && (deps.identity.batchKind !== "SCHEDULED" || !deps.portableLease)) {
    throw new Error("Last-good scheduled publication requires an owned lease");
  }
  if (portableMode) {
    if (deps.identity.batchKind !== "SCHEDULED" || !deps.portableLease || !deps.getTrustedCompletenessBaseline || !deps.getFirstAcceptedCurrentPolicyReceipt) {
      throw new Error("Portable scheduled runs require an owned lease and durable quality baseline readers");
    }
  }
  if (lastGoodMode) {
    await heartbeatPortableCrawlLease(deps.db as unknown as PortableLeaseDatabase, deps.portableLease!);
    deps = { ...deps, db: createPortableFencedRuntimeDatabase(deps.db, deps.portableLease!) };
  } else if (deps.portableLease) throw new Error("Portable lease requires explicit last-good publication mode");
  const sourceTimeoutMs = deps.sourceAttemptTimeoutMs ?? sourceAttemptTimeoutMs();
  if (!Number.isSafeInteger(sourceTimeoutMs) || sourceTimeoutMs <= 0 || sourceTimeoutMs > 30 * 60 * 1_000) {
    throw new Error("Official source attempt timeout must be an integer from 1 through 1800000 milliseconds");
  }
  for (const plan of plans) validateExecutablePlanChannelBinding(plan);
  validatePlannedSourceContract(
    deps.identity,
    plans.map((plan) => plan.source.id)
  );
  if (deps.identity.batchKind === "MANUAL_SOURCE" && !deps.manualRequestFence) {
    throw new Error("MANUAL_SOURCE requires an owned request fence");
  }
  if (deps.identity.batchKind !== "MANUAL_SOURCE" && deps.manualRequestFence) {
    throw new Error("Manual request fence is valid only for MANUAL_SOURCE");
  }
  const batchStartedAt = resolveNow(deps.now);
  if (deps.identity.batchKind === "FULL_RELEASE") {
    const membership = await getStartupReleaseMembership();
    validateAuthoritativeReleaseMembership(membership, deps.identity, releaseMembersFromPlans(plans));
    validateIndependentSourceSurfaceOracle(await getStartupSourceSurfaceOracle(), membership, deps.identity, plans,
      batchStartedAt);
  }
  const trustedOracle = deps.identity.batchKind === "FULL_RELEASE" ? await getStartupSourceSurfaceOracle() : undefined;
  const batch = { id: (deps.createBatchId ?? deps.db.createBatchId ?? randomUUID)() };
  const plannedBatch = buildPendingRuntimeBatch(batch.id, plans, deps.identity, batchStartedAt, undefined,
    trustedOracle, deps.manualRequestFence?.requestId);
  await createBatchWithPendingSourceResults(
    plannedBatch,
    deps.db as never
  );

  let dueSourceCount = 0;
  let transportSuccessfulSourceCount = 0;
  let transportFailedSourceCount = 0;
  let adapterSuccessfulSourceCount = 0;
  let adapterFailedSourceCount = 0;
  let completenessVerifiedSourceCount = 0;
  let completenessIncompleteSourceCount = 0;
  let atomicCommittedSourceCount = 0;
  let atomicFailedSourceCount = 0;
  let successfulSourceCount = 0;
  let failedSourceCount = 0;
  let blockedSourceCount = 0;
  let skippedSourceCount = 0;
  const processedJobKeys: { sourceId: string; jobKey: string }[] = [];
  const terminalSourceIds = new Set<string>();
  const sourceAttemptTrackers = new Map<string, SourceFetchAttemptTracker>();
  let status: Exclude<CrawlBatchStatus, "RUNNING"> = "INCOMPLETE";
  let result: P0CrawlBatchResult | undefined;
  const sourceErrors: unknown[] = [];
  let sourceThrew = false;
  let thrownError: unknown;

  try {
    for (const plan of plans) {
      const policyHold = portableMode ? (
        getPortableCoverageScope().exclusions.some(excluded=>excluded.sourceId===plan.source.id)
          ? "USER_AUTHORIZED_COVERAGE_EXCLUSION"
          : getPortableSourceCoverageHold(plan.source.id) ??
            (getSourceQualityPolicy(plan) ? null : "SOURCE_QUALITY_POLICY_NOT_REVIEWED")
      ) : null;
      if(policyHold){
        const pending=plannedBatch.sources.find(source=>source.sourceId===plan.source.id)!;
        await terminateRuntimeSourceResult({id:pending.id,releaseCandidateId:deps.identity.releaseCandidateId,
          batchId:batch.id,sourceId:plan.source.id,transportState:"SKIPPED",adapterState:"SKIPPED",
          completenessState:"FAILED",atomicCommitState:"NOT_ATTEMPTED",finishedAt:new Date(),
          failureCode:policyHold,failureReason:PORTABLE_SKIP_REASONS[policyHold]!},deps);
        terminalSourceIds.add(plan.source.id);skippedSourceCount+=1;continue;
      }
      const recentObservations = await deps.getRecentObservations(plan.source.id);
      const sourceState = toSourceScheduleState(plan.source.id, recentObservations);

      if (
        deps.identity.batchKind !== "FULL_RELEASE" &&
        !deps.force &&
        !isSourceDueForScheduledRun(sourceState, batchStartedAt)
      ) {
        const pending = plannedBatch.sources.find((source) => source.sourceId === plan.source.id)!;
        await terminateRuntimeSourceResult({ id: pending.id, releaseCandidateId: deps.identity.releaseCandidateId,
          batchId: batch.id, sourceId: plan.source.id, transportState: "SKIPPED", adapterState: "SKIPPED",
          completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED", finishedAt: portableMode ? new Date() : batchStartedAt,
          failureCode: "SOURCE_NOT_DUE", failureReason: "Source was not due for this scheduled batch" }, deps);
        terminalSourceIds.add(plan.source.id);
        skippedSourceCount += 1;
        continue;
      }

      dueSourceCount += 1;

      if (deps.portableLease?.signal.aborted) throw new Error("PORTABLE_CRAWL_LEASE_LOST");
      const qualityRequired = portableMode;
      const loadedCompletenessBaseline = deps.getTrustedCompletenessBaseline
        ? await deps.getTrustedCompletenessBaseline(plan.source.id)
        : null;
      const trustedCompletenessBaseline = portableMode
        ? comparablePortableBaseline(loadedCompletenessBaseline, plan.source.id, sourcePlanConfigSha256(plan))
        : loadedCompletenessBaseline;
      const certificateBaselineRequired = qualityRequired || requiresAGradeOfficialTotalCertificate(plan) ||
        requiresBGradeTraversalCertificate(plan);
      const baselineCompletedBeforeCrawl = certificateBaselineRequired &&
          deps.getTrustedCompletenessBaseline
        ? trustedCompletenessBaseline !== null
        : await deps.isBaselineCompleted(plan.source.id);
      const previousJobs = await deps.getPreviousJobs(plan.source.id);
      const pending = plannedBatch.sources.find((source) => source.sourceId === plan.source.id)!;
      const attemptTracker = createSourceFetchAttemptTracker();
      sourceAttemptTrackers.set(plan.source.id, attemptTracker);
      let crawlResult: Awaited<ReturnType<typeof runSourceCrawl>>;
      let preCapturedValidation: BGradeIndependentTraversalValidation | undefined;
      try {
        // Compact dual-chain certificates bind every main artifact after this DOM observation.
        if (lastGoodMode && ["source-bayer-healthcare-social", "source-sanofi-china-social"].includes(plan.source.id)) {
          markInitialSourceFetchAttempt(attemptTracker);
          preCapturedValidation = await captureIndependentTraversal(plan, pending, deps, sourceTimeoutMs);
        }
        crawlResult = await runWithOfficialSourceAttemptTimeout(
          () => {
            const acquire = () => runSourceCrawl(plan, { fetch: deps.fetch,
              isBaseline: !baselineCompletedBeforeCrawl, attemptTracker });
            return deps.portableLease ? runWithOfficialSourceCancellation(deps.portableLease.signal, acquire) : acquire();
          },
          sourceTimeoutMs
        );
      } catch (error) {
        const sourceTimedOut = isOfficialSourceAttemptTimeout(error);
        if (sourceTimedOut || error instanceof SourceCrawlStageError && error.stage === "FETCH") {
          transportFailedSourceCount += 1;
        } else if (error instanceof SourceCrawlStageError && error.stage === "ADAPTER") {
          transportSuccessfulSourceCount += 1;
          adapterFailedSourceCount += 1;
        }
        const sourceError = error instanceof SourceCrawlStageError ? error.cause : error;
        sourceErrors.push(sourceError);
        await terminateRuntimeSourceResult({ id: pending.id, releaseCandidateId: deps.identity.releaseCandidateId,
          batchId: batch.id, sourceId: plan.source.id,
          transportState: error instanceof SourceCrawlStageError && error.stage === "ADAPTER" ? "SUCCEEDED" : "FAILED",
          adapterState: error instanceof SourceCrawlStageError && error.stage === "ADAPTER" ? "FAILED" : "SKIPPED",
          completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED",
          finishedAt: portableMode ? new Date() : batchStartedAt,
          failureCode: sourceTimedOut
            ? "SOURCE_ATTEMPT_TIMEOUT"
            : error instanceof SourceCrawlStageError && error.stage === "ADAPTER"
              ? "SOURCE_ADAPTER_EXECUTION_FAILED"
              : sourceExecutionFailureCode(sourceError),
          failureReason: sourceTimedOut
            ? "Source execution exceeded the per-source time limit before atomic evidence commit"
            : "Source execution failed before atomic evidence commit",
          ...(sourceTimedOut
            ? sourceFailureDiagnosticBundle(
                "SOURCE_TIME_LIMIT_REACHED",
                "SOURCE_ATTEMPT_TIMEOUT",
                attemptTracker
              )
            : error instanceof SourceCrawlStageError && error.stage === "ADAPTER"
              ? sourceFailureDiagnosticBundle(
                  "OFFICIAL_SOURCE_REVIEW_REQUIRED",
                  "ADAPTER_EXECUTION_FAILED",
                  attemptTracker
                )
              : sourceFailureDiagnosticBundle(
                  "UNCLASSIFIED_SOURCE_FAILURE",
                  "FETCH_EXECUTION_FAILED",
                  attemptTracker
                ))
        }, deps);
        terminalSourceIds.add(plan.source.id);
        failedSourceCount += 1;
        continue;
      }

      let independentTraversalValidation = preCapturedValidation;
      let independentTraversalValidationExecution: "CURRENT_RUN" | "REUSED" | undefined = preCapturedValidation ? "CURRENT_RUN" : undefined;
      let independentTraversalValidationTrigger: BGradeValidationTrigger | undefined;
      let independentTraversalFailureCode: BGradeIndependentTraversalFailureCode | undefined;
      let independentTraversalFailureReason: string | undefined;
      const anomaly = certificateBaselineRequired
        ? evaluateCompletenessAnomalyForCrawl(plan, crawlResult, trustedCompletenessBaseline)
        : { independentValidationRequired: false, triggerCodes: [], countChange: null };
      const completenessAnomalyTriggerCodes: readonly string[] = anomaly.triggerCodes;
      if (!portableMode && requiresBGradeTraversalCertificate(plan)) {
        independentTraversalValidationTrigger = selectCompletenessValidationTrigger({
          baseline: trustedCompletenessBaseline,
          currentSourceConfigSha256: pending.sourceConfigHash,
          anomaly
        });
        const mainPathCanBeCertified = crawlResult.truth.transportSuccess && crawlResult.truth.adapterSuccess;
        if (mainPathCanBeCertified || anomaly.independentValidationRequired) {
          if (!independentTraversalValidation && independentTraversalValidationTrigger === "STABLE_RUN" &&
              trustedCompletenessBaseline?.certificateGrade === "B") {
            try {
              independentTraversalValidation = readReusableBGradeTraversalValidation({
                certificate: trustedCompletenessBaseline.certificate,
                certificateSha256: trustedCompletenessBaseline.certificateSha256,
                sourceConfigSha256: pending.sourceConfigHash,
                now: crawlResult.observation.crawledAt
              });
              if (bGradeTraversalValidationMatchesCurrentJobs(
                independentTraversalValidation,
                crawlResult.jobs
              )) {
                independentTraversalValidationExecution = "REUSED";
              } else {
                independentTraversalValidation = undefined;
              }
            } catch {
              // Expired or malformed reusable evidence is refreshed through the independent path.
            }
          }
          if (!independentTraversalValidation) {
            try {
              independentTraversalValidation = await captureIndependentTraversal(plan, pending, deps, sourceTimeoutMs);
              independentTraversalValidationExecution = "CURRENT_RUN";
            } catch (error) {
              // Missing independent evidence is a C-grade completeness outcome, not an atomic transport failure.
              independentTraversalValidation = undefined;
              independentTraversalValidationExecution = undefined;
              independentTraversalFailureCode = classifyBGradeIndependentTraversalFailure(error);
              independentTraversalFailureReason = safeBGradeIndependentTraversalFailureReason(error);
            }
          }
        }
      }

      if (crawlResult.truth.transportSuccess) {
        transportSuccessfulSourceCount += 1;
        if (crawlResult.truth.adapterSuccess) adapterSuccessfulSourceCount += 1;
        else adapterFailedSourceCount += 1;
      } else {
        transportFailedSourceCount += 1;
      }

      if (!crawlResult.truth.transportSuccess || !crawlResult.truth.adapterSuccess) {
        const transportFailed = !crawlResult.truth.transportSuccess;
        const boundedFailureReason = crawlResult.status === "FAILED"
          ? safeProfileBoundSourceFailureReason(plan, crawlResult.failureReason) ??
            (plan.adapterId === "html-table" && isSafeHtmlFailureCode(crawlResult.failureReason)
              ? crawlResult.failureReason
              : undefined)
          : undefined;
        const terminal: PendingSourceTerminalInput = {
          id: pending.id,
          releaseCandidateId: deps.identity.releaseCandidateId,
          batchId: batch.id,
          sourceId: plan.source.id,
          transportState: transportFailed ? "FAILED" : "SUCCEEDED",
          adapterState: transportFailed ? "SKIPPED" : "FAILED",
          completenessState: "FAILED",
          atomicCommitState: "NOT_ATTEMPTED",
          finishedAt: crawlResult.observation.crawledAt,
          failureCode: transportFailed ? "SOURCE_TRANSPORT_FAILED" : "SOURCE_ADAPTER_FAILED",
          failureReason: transportFailed
            ? crawlResult.transportFailure
              ? safeSourceTransportFailureReason(crawlResult.transportFailure)
              : boundedFailureReason ?? "Source transport failed"
            : "Source adapter failed",
          ...(transportFailed
            ? transportFailureDiagnosticBundle(crawlResult.transportFailure, attemptTracker)
            : sourceFailureDiagnosticBundle(
                "OFFICIAL_SOURCE_REVIEW_REQUIRED",
                "ADAPTER_FAILED_CLOSED",
                attemptTracker
              ))
        };
        if (crawlResult.fetchEvidence) {
          let retainedFailureArtifacts: readonly ArchivedEvidenceArtifact[] = [];
          let failedCommit: ReturnType<typeof buildFailedRuntimeEvidenceCommit> | undefined;
          try {
            const verifiedArtifacts = await archiveAndVerifyRuntimeEvidence({
              deps,
              batchId: batch.id,
              plan,
              pending,
              result: crawlResult as SourceCrawlResult & {
                fetchEvidence: NonNullable<SourceCrawlResult["fetchEvidence"]>
              },
              onArchived: (artifacts) => { retainedFailureArtifacts = artifacts; }
            });
            retainedFailureArtifacts = verifiedArtifacts;
            failedCommit = buildFailedRuntimeEvidenceCommit({
              pending,
              identity: deps.identity,
              batchId: batch.id,
              evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence",
              result: crawlResult,
              terminal,
              artifacts: verifiedArtifacts
            });
            if (deps.identity.batchKind === "MANUAL_SOURCE") {
              await (deps.executeManualFailedEvidenceCommit ?? executeManualFailedSourceEvidenceCommit)(
                failedCommit, deps.manualRequestFence!, deps.db as never);
            } else {
              await (deps.executeFailedEvidenceCommit ?? executeFailedSourceEvidenceCommit)(
                failedCommit, deps.db as never);
            }
          } catch (error) {
            if (failedCommit && atomicEvidencePersistenceStage(error) === "OWNERSHIP_FENCE") {
              terminalSourceIds.add(plan.source.id);
              throw error;
            }
            if (failedCommit && atomicEvidencePersistenceStage(error) === "TRANSACTION_COMMIT") {
              let outcome: Awaited<ReturnType<typeof inspectPersistedFailedSourceEvidenceCommitOutcome>>;
              try {
                outcome = await (deps.inspectFailedEvidenceCommitOutcome ??
                  inspectPersistedFailedSourceEvidenceCommitOutcome)(failedCommit, deps.db as never);
              } catch {
                terminalSourceIds.add(plan.source.id);
                throw new AtomicCommitOutcomeUnverifiedError();
              }
              if (outcome.state === "COMMITTED_EXACT") {
                terminalSourceIds.add(plan.source.id);
                failedSourceCount += 1;
                continue;
              }
              if (outcome.state === "CONFLICT") {
                terminalSourceIds.add(plan.source.id);
                throw new AtomicCommitOutcomeUnverifiedError();
              }
            }
            if (retainedFailureArtifacts.length > 0) {
              await (deps.recordOrphanedArtifacts ?? ((artifacts) => appendRuntimeOrphanLedger(
                deps.workspaceRoot ?? process.cwd(), deps.identity.releaseCandidateId,
                deps.evidenceSubdirectory ?? "phase-1/runtime-evidence", artifacts
              )))(retainedFailureArtifacts);
            }
            sourceErrors.push(error);
            await terminateRuntimeSourceResult({
              ...terminal,
              failureCode: "EVIDENCE_ARCHIVE_FAILED",
              failureReason: "Failed source diagnostic evidence could not be archived and committed",
              ...sourceFailureDiagnosticBundle(
                "EVIDENCE_PERSISTENCE_FAILURE",
                "EVIDENCE_PROCESSING_FAILED",
                attemptTracker
              )
            }, deps);
          }
        } else {
          await terminateRuntimeSourceResult(terminal, deps);
        }
        terminalSourceIds.add(plan.source.id);
        failedSourceCount += 1;
        continue;
      }

      let committedCompletenessVerified = false;
      let retainedArtifacts: readonly ArchivedEvidenceArtifact[] = [];
      let commit: AtomicSourceEvidenceCommit | undefined;
      let atomicFailureCode = "ATOMIC_COMMIT_BUILD_FAILED";
      try {
        if (!crawlResult.fetchEvidence) throw new Error("strict fetch evidence is required for atomic runtime commit");
        if (isSanofiChinesePlan(plan) && independentTraversalValidation) {
          crawlResult.fetchEvidence = bindSanofiChineseIndependentArtifact(plan, crawlResult.fetchEvidence, independentTraversalValidation.artifactSha256);
        }
        atomicFailureCode = "EVIDENCE_ARCHIVE_FAILED";
        const verifiedArtifacts = [...await archiveAndVerifyRuntimeEvidence({
          deps,
          batchId: batch.id,
          plan,
          pending,
          result: crawlResult as SourceCrawlResult & {
            fetchEvidence: NonNullable<SourceCrawlResult["fetchEvidence"]>
          },
          onArchived: (artifacts) => {
            retainedArtifacts = artifacts;
            atomicFailureCode = "EVIDENCE_VERIFICATION_FAILED";
          }
        })];
        retainedArtifacts = verifiedArtifacts;
        let independentOriginal: SanofiIndependentArchiveBinding | undefined;
        const compactSource = plan.source.id === "source-bayer-healthcare-social" ? "bayer"
          : plan.source.id === "source-sanofi-china-social" ? "sanofi" : null;
        if (compactSource && independentTraversalValidation?.schemaVersion === "official-json-browser-network-traversal-v1") {
          const body = Buffer.from(JSON.stringify(independentTraversalValidation));
          const locator = compactSource === "bayer" ? BAYER_INDEPENDENT_ORIGINAL_LOCATOR : SANOFI_INDEPENDENT_ORIGINAL_LOCATOR;
          const tuple = { releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id, sourceId: plan.source.id, sourceResultId: pending.id };
          const archiveInput = { ...tuple, workspaceRoot: deps.workspaceRoot ?? process.cwd(),
            evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence" };
          const archived = await (deps.archiveEvidence ?? archiveSourceEvidence)({ ...archiveInput,
            captureTool: { name: "playwright-core-local-chromium", version: "1" },
            artifacts: bindRuntimeEvidenceArtifactIds({ ...tuple, artifacts: [{ id: locator, logicalKey: locator,
              extractorLocator: locator, kind: "COMMAND_OUTPUT", body, bodyRepresentation: "EXACT",
              capturedAt: compactSource === "bayer" ? bayerHybridFinishedAt(independentTraversalValidation.pages)
                : sanofiChineseIndependentFinishedAt(independentTraversalValidation.pages) }] }) });
          retainedArtifacts = [...verifiedArtifacts, ...archived.artifacts];
          const checked = await (deps.verifyArchive ?? verifyArchivedSourceEvidence)({ ...archiveInput, artifacts: archived.artifacts });
          verifiedArtifacts.push(...checked);
          independentOriginal = { sha256: createHash("sha256").update(body).digest("hex"), byteCount: body.length,
            canonicalArtifactSha256: independentTraversalValidation.artifactSha256 };
        }
        atomicFailureCode = "ATOMIC_COMMIT_BUILD_FAILED";
        const qualityAdmission = qualityRequired ? await issueSourceQualityAdmission({ plan, result: crawlResult,
          binding: { releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id, sourceResultId: pending.id,
            sourceConfigSha256: pending.sourceConfigHash, adapterVersion: pending.adapterVersion },
          archive: { workspaceRoot: deps.workspaceRoot ?? process.cwd(), evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence", artifacts: verifiedArtifacts }
        }) : undefined;
        const firstAcceptedCurrentPolicyReceipt = qualityRequired
          ? await deps.getFirstAcceptedCurrentPolicyReceipt!(plan.source.id, pending.sourceConfigHash) : undefined;
        commit = buildAtomicRuntimeCommit({ plan, pending, identity: deps.identity, batchId: batch.id,
          result: crawlResult, previousJobs, baselineCompletedBeforeCrawl, artifacts: verifiedArtifacts,
          attemptTracker,
          ...(lastGoodMode ? { publicationPolicy: "SOURCE_ATOMIC_LAST_GOOD_V1" as const, completedAt: new Date() } : {}),
          ...(independentOriginal && compactSource === "bayer" ? { bayerIndependentOriginal: independentOriginal } : {}),
          ...(independentOriginal && compactSource === "sanofi" ? { sanofiIndependentOriginal: independentOriginal } : {}),
          ...(portableMode ? { sourceAdmissionPolicy: SOURCE_QUALITY_POLICY_ID } : {}),
          ...(qualityAdmission ? { sourceQualityAdmission: qualityAdmission, firstAcceptedCurrentPolicyReceipt: firstAcceptedCurrentPolicyReceipt! } : {}),
          ...(independentTraversalFailureCode ? { independentTraversalFailureCode } : {}),
          ...(independentTraversalFailureReason ? { independentTraversalFailureReason } : {}),
          ...(independentTraversalValidation ? {
            independentTraversalValidation,
            independentTraversalValidationExecution: independentTraversalValidationExecution!,
            independentTraversalValidationTrigger: independentTraversalValidationTrigger!,
            completedAt: lastGoodMode ? new Date() : new Date(Math.max(
              crawlResult.observation.crawledAt.getTime(),
              Date.parse(independentTraversalValidation.observedAt)
            ))
          } : {}),
          trustedCompletenessBaseline,
          ...(completenessAnomalyTriggerCodes.length > 0 ? {
            completenessAnomalyTriggerCodes
          } : {}),
          ...(trustedOracle ? { trustedOracle } : {}) });
        atomicFailureCode = "ATOMIC_EVIDENCE_COMMIT_FAILED";
        if (deps.identity.batchKind === "MANUAL_SOURCE") {
          await (deps.executeManualAtomicCommit ?? executeManualSourceEvidenceCommit)(
            commit, deps.manualRequestFence!, deps.db as never);
        } else if (lastGoodMode) {
          // No injectable unfenced writer is used in portable mode.
          await executePortableAtomicSourceEvidenceCommit(commit, deps.portableLease!, deps.db as never);
        } else {
          await (deps.executeAtomicCommit ?? executeAtomicSourceEvidenceCommit)(commit, deps.db as never);
        }
        committedCompletenessVerified = commit.sourceResult.completenessState === "VERIFIED";
        terminalSourceIds.add(plan.source.id);
        if (committedCompletenessVerified) completenessVerifiedSourceCount += 1;
        else completenessIncompleteSourceCount += 1;
        atomicCommittedSourceCount += 1;
      } catch (error) {
        if (atomicFailureCode === "ATOMIC_EVIDENCE_COMMIT_FAILED" && commit) {
          let outcome: Awaited<ReturnType<typeof inspectPersistedAtomicCommitOutcome>>;
          try {
            outcome = await (deps.inspectAtomicCommitOutcome ?? inspectPersistedAtomicCommitOutcome)(
              commit,
              deps.db as never
            );
          } catch {
            terminalSourceIds.add(plan.source.id);
            throw new AtomicCommitOutcomeUnverifiedError();
          }
          if (outcome.state === "COMMITTED_EXACT") {
            committedCompletenessVerified = commit.sourceResult.completenessState === "VERIFIED";
            terminalSourceIds.add(plan.source.id);
            if (committedCompletenessVerified) completenessVerifiedSourceCount += 1;
            else completenessIncompleteSourceCount += 1;
            atomicCommittedSourceCount += 1;
          } else if (outcome.state === "CONFLICT") {
            terminalSourceIds.add(plan.source.id);
            throw new AtomicCommitOutcomeUnverifiedError();
          } else {
            atomicFailureCode = atomicEvidenceFailureCode(error);
            const safeCommitError = new Error(atomicFailureCode);
            try {
              await terminateRuntimeSourceResult({ id: pending.id,
                releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id,
                sourceId: plan.source.id, transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
                completenessState: "FAILED", atomicCommitState: "ROLLED_BACK",
                finishedAt: crawlResult.observation.crawledAt,
                failureCode: atomicFailureCode, failureReason: "Atomic evidence processing failed",
                ...sourceFailureDiagnosticBundle(
                  "EVIDENCE_PERSISTENCE_FAILURE",
                  "EVIDENCE_PROCESSING_FAILED",
                  attemptTracker
                )
              }, deps);
              terminalSourceIds.add(plan.source.id);
            } catch {
              terminalSourceIds.add(plan.source.id);
              throw new AtomicCommitOutcomeUnverifiedError();
            }
            let propagatedError: unknown = safeCommitError;
            if (retainedArtifacts.length > 0) {
              try {
                await (deps.recordOrphanedArtifacts ?? ((artifacts) => appendRuntimeOrphanLedger(
                  deps.workspaceRoot ?? process.cwd(), deps.identity.releaseCandidateId,
                  deps.evidenceSubdirectory ?? "phase-1/runtime-evidence", artifacts
                )))(retainedArtifacts);
              } catch {
                propagatedError = new AggregateError(
                  [safeCommitError, new Error("ORPHAN_LEDGER_RECORDING_FAILED")],
                  "Artifact retention and orphan-ledger recording both failed"
                );
              }
            }
            sourceErrors.push(propagatedError);
            atomicFailedSourceCount += 1;
            failedSourceCount += 1;
            continue;
          }
        } else {
          let propagatedError: unknown = error;
          const orphanedArtifacts = error instanceof ArtifactArchiveError && error.orphanedFinalArtifacts.length > 0
            ? error.orphanedFinalArtifacts
            : retainedArtifacts;
          if (orphanedArtifacts.length > 0) {
            try {
              await (deps.recordOrphanedArtifacts ?? ((artifacts) => appendRuntimeOrphanLedger(
                deps.workspaceRoot ?? process.cwd(), deps.identity.releaseCandidateId,
                deps.evidenceSubdirectory ?? "phase-1/runtime-evidence", artifacts
              )))(orphanedArtifacts);
            } catch {
              const safeLedgerError = new Error("ORPHAN_LEDGER_RECORDING_FAILED");
              propagatedError = new AggregateError(
                [error, safeLedgerError],
                "Artifact retention and orphan-ledger recording both failed"
              );
            }
          }
          sourceErrors.push(propagatedError);
          await terminateRuntimeSourceResult({ id: pending.id, releaseCandidateId: deps.identity.releaseCandidateId,
            batchId: batch.id, sourceId: plan.source.id, transportState: crawlResult.truth.transportSuccess ? "SUCCEEDED" : "FAILED",
            adapterState: crawlResult.truth.transportSuccess
              ? (crawlResult.truth.adapterSuccess ? "SUCCEEDED" : "FAILED") : "SKIPPED",
            completenessState: "FAILED",
            atomicCommitState: crawlResult.truth.transportSuccess && crawlResult.truth.adapterSuccess ? "ROLLED_BACK" : "NOT_ATTEMPTED",
            finishedAt: crawlResult.observation.crawledAt,
            failureCode: atomicFailureCode, failureReason: "Atomic evidence processing failed",
            ...sourceFailureDiagnosticBundle(
              "EVIDENCE_PERSISTENCE_FAILURE",
              "EVIDENCE_PROCESSING_FAILED",
              attemptTracker
            )
          }, deps);
          terminalSourceIds.add(plan.source.id);
          atomicFailedSourceCount += 1;
          failedSourceCount += 1;
          continue;
        }
      }

      for (const job of crawlResult.jobs) {
        processedJobKeys.push({
          sourceId: plan.source.id,
          jobKey: buildJobDedupeKey(job)
        });
      }

      if (crawlResult.truth.adapterSuccess) {
        if (committedCompletenessVerified) {
          successfulSourceCount += 1;
        } else {
          blockedSourceCount += 1;
        }

        continue;
      }

      failedSourceCount += 1;
    }

  } catch (error) {
    status = "FAILED";
    sourceThrew = true;
    thrownError = error;
  }

  const unterminated = plannedBatch.sources.filter((pending) => !terminalSourceIds.has(pending.sourceId));
  if (unterminated.length > 0) {
    const closureErrors: unknown[] = [];
    for (const pending of unterminated) {
      try {
        const attemptTracker = sourceAttemptTrackers.get(pending.sourceId) ?? {
          fetchAttemptCount: 0,
          retryCount: 0,
          retryReasonCodes: []
        };
        const sourceExecutionStarted = attemptTracker.fetchAttemptCount > 0;
        await terminateRuntimeSourceResult({ id: pending.id,
          releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id,
          sourceId: pending.sourceId, transportState: portableMode && !sourceExecutionStarted ? "SKIPPED" : "FAILED", adapterState: "SKIPPED",
          completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED",
          finishedAt: portableMode ? new Date() : batchStartedAt, failureCode: "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL",
          failureReason: sourceExecutionStarted
            ? "Source execution started but did not reach a persisted terminal result"
            : "Batch aborted before this source reached a terminal state",
          ...sourceFailureDiagnosticBundle(
            "UNCLASSIFIED_SOURCE_FAILURE",
            sourceExecutionStarted
              ? "FETCH_EXECUTION_FAILED"
              : "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL",
            attemptTracker
          )
        }, deps);
        terminalSourceIds.add(pending.sourceId);
      } catch (closureError) {
        closureErrors.push(closureError);
      }
    }
    failedSourceCount += unterminated.length;
    status = "FAILED";
    if (closureErrors.length > 0) {
      const closureFailure = new AggregateError(closureErrors, "Failed to close all PENDING source results");
      thrownError = sourceThrew ? new AggregateError([thrownError, closureFailure],
        "Source execution and PENDING closure both failed") : closureFailure;
      sourceThrew = true;
    }
  }

  let persistedSummary: PersistedBatchSummary;
  try {
    const persistedRows = await (deps.readPersistedBatchSourceResults ?? readPersistedBatchSourceResults)(
      { releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id },
      deps.db as never
    );
    persistedSummary = summarizePersistedBatchSourceResults(
      plans.map((plan) => plan.source.id),
      persistedRows,
      portableMode
    );
  } catch {
    const summaryFailure = new Error("PERSISTED_BATCH_SUMMARY_UNAVAILABLE");
    if (sourceThrew || sourceErrors.length > 0) {
      throw new AggregateError(
        [...sourceErrors, ...(sourceThrew ? [thrownError] : []), summaryFailure],
        "Source execution and persisted batch summary both failed"
      );
    }
    throw summaryFailure;
  }

  ({
    dueSourceCount,
    transportSuccessfulSourceCount,
    transportFailedSourceCount,
    adapterSuccessfulSourceCount,
    adapterFailedSourceCount,
    completenessVerifiedSourceCount,
    completenessIncompleteSourceCount,
    atomicCommittedSourceCount,
    atomicFailedSourceCount,
    successfulSourceCount,
    failedSourceCount,
    blockedSourceCount,
    skippedSourceCount
  } = persistedSummary);

  const hasExactSuccessfulDenominator =
    dueSourceCount === plans.length && skippedSourceCount === 0 && failedSourceCount === 0 &&
    blockedSourceCount === 0 && transportSuccessfulSourceCount === plans.length &&
    transportFailedSourceCount === 0 && adapterSuccessfulSourceCount === plans.length &&
    adapterFailedSourceCount === 0 && completenessVerifiedSourceCount === plans.length &&
    completenessIncompleteSourceCount === 0 && atomicCommittedSourceCount === plans.length &&
    atomicFailedSourceCount === 0;
  status = sourceThrew ? "FAILED" : resolveP0CrawlBatchTerminalStatus({
    batchKind: deps.identity.batchKind,
    failedSourceCount,
    atomicFailedSourceCount,
    hasExactSuccessfulDenominator
  });
  result = {
    status,
    batchId: batch.id,
    plannedSourceCount: plans.length,
    ...persistedSummary
  };

  try {
    const batchFinishedAt = resolveNow(deps.now);
    await deps.db.crawlBatch.update({
      where: { id: batch.id },
      data: {
        transportSucceededCount: transportSuccessfulSourceCount,
        transportFailedCount: transportFailedSourceCount,
        adapterSucceededCount: adapterSuccessfulSourceCount,
        adapterFailedCount: adapterFailedSourceCount,
        completenessVerifiedCount: completenessVerifiedSourceCount,
        completenessIncompleteCount: completenessIncompleteSourceCount,
        atomicCommittedCount: atomicCommittedSourceCount,
        atomicFailedCount: atomicFailedSourceCount,
        failedSourceCount,
        blockedSourceCount,
        skippedSourceCount,
        aggregateJobSetSha256: hashCanonicalJobKeySet(processedJobKeys),
        heartbeatAt: batchFinishedAt,
        finishedAt: batchFinishedAt,
        status
      }
    });
  } catch (finalizationError) {
    const executionErrors = [
      ...sourceErrors,
      ...(sourceThrew ? [thrownError] : [])
    ];
    if (executionErrors.length > 0) {
      throw new AggregateError(
        [...executionErrors, finalizationError],
        "Source execution and batch finalization both failed"
      );
    }
    throw finalizationError;
  }

  if (sourceThrew) {
    if (sourceErrors.length > 0) {
      throw new AggregateError(
        [...sourceErrors, thrownError],
        "Source failures and batch execution both failed"
      );
    }
    throw thrownError;
  }

  return result!;
}

async function appendRuntimeOrphanLedger(workspaceRoot: string, releaseCandidateId: string,
  evidenceSubdirectory: string, artifacts: readonly ArchivedEvidenceArtifact[]): Promise<void> {
  const directory = path.resolve(workspaceRoot, "outputs", "p0-rc", releaseCandidateId,
    ...evidenceSubdirectory.split("/"));
  await mkdir(directory, { recursive: true });
  const rows = artifacts.map((artifact) => JSON.stringify({
    releaseCandidateId: artifact.releaseCandidateId, batchId: artifact.batchId,
    sourceId: artifact.sourceId, sourceResultId: artifact.sourceResultId,
    artifactId: artifact.id, logicalKey: artifact.logicalKey, path: artifact.path,
    sha256: artifact.sha256, byteCount: artifact.byteCount,
    state: "ORPHANED_FINAL_ARTIFACT_NON_CERTIFYING"
  })).join("\n") + "\n";
  await appendFile(path.join(directory, "orphan-ledger.jsonl"), rows, { encoding: "utf8", flag: "a" });
}

class AtomicCommitOutcomeUnverifiedError extends Error {
  readonly code = "ATOMIC_COMMIT_OUTCOME_UNVERIFIED";

  constructor() {
    super("ATOMIC_COMMIT_OUTCOME_UNVERIFIED");
    this.name = "AtomicCommitOutcomeUnverifiedError";
  }
}

function resolveNow(now: RunP0CrawlBatchDeps["now"]): Date {
  return now instanceof Date ? now : now();
}
