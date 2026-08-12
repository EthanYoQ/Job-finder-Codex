import {
  createBatchWithPendingSourceResults,
  executeAtomicSourceEvidenceCommit,
  executeManualSourceEvidenceCommit,
  inspectPersistedAtomicCommitOutcome,
  readPersistedBatchSourceResults,
  terminatePendingSourceResult,
  type AtomicSourceEvidenceCommit,
  type PersistedBatchSourceResultRow,
  type PrismaIngestionDb,
  type ManualSourceCommitFence
} from "../db/ingestionRepository";
import {
  toSourceScheduleState,
  type PersistedCrawlObservationRow
} from "../db/crawlStateRepository";
import type { JobSnapshot } from "./lifecycle";
import { buildJobDedupeKey } from "./normalizedJob";
import {
  createSourceFetchAttemptTracker,
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
import { validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import { safeSourceTransportFailureReason } from "./sourceFetchFailure";
import {
  sourceFailureDiagnosticBundle,
  transportFailureDiagnosticBundle
} from "./sourceFailureDiagnostics";
import { safeProfileBoundSourceFailureReason } from "./profileBoundSourceEvidence";
import {
  bindRuntimeEvidenceArtifactIds,
  buildAtomicRuntimeCommit,
  buildPendingRuntimeBatch
} from "./runtimeAtomicEvidence";
import { randomUUID } from "node:crypto";
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
  runWithOfficialSourceAttemptTimeout,
  sourceAttemptTimeoutMs
} from "./officialHttpRuntimeLimits";
import {
  readReusableViatrisTraversalValidation,
  requiresBGradeTraversalCertificate,
  runViatrisBrowserTraversalValidator,
  viatrisTraversalValidationMatchesCurrentJobs,
  type BGradeValidationTrigger,
  type ViatrisBrowserTraversalValidation
} from "./traversalCertificate";
import { requiresAGradeOfficialTotalCertificate } from "./completenessCertificate";
import {
  evaluateCompletenessAnomaly,
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
  rows: readonly PersistedBatchSourceResultRow[]
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

  const skipped = rows.filter(isPersistedSourceNotDue);
  const due = rows.filter((row) => !isPersistedSourceNotDue(row));
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
      row.failureCode !== "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL").length,
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

function isPersistedSourceNotDue(row: PersistedBatchSourceResultRow): boolean {
  return row.transportState === "SKIPPED" && row.adapterState === "SKIPPED" &&
    row.completenessState === "FAILED" && row.atomicCommitState === "NOT_ATTEMPTED" &&
    row.failureCode === "SOURCE_NOT_DUE";
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
  sourceAttemptTimeoutMs?: number;
  createBatchId?: () => string;
  workspaceRoot?: string;
  evidenceSubdirectory?: string;
  archiveEvidence?: typeof archiveSourceEvidence;
  verifyArchive?: typeof verifyArchivedSourceEvidence;
  executeAtomicCommit?: typeof executeAtomicSourceEvidenceCommit;
  executeManualAtomicCommit?: typeof executeManualSourceEvidenceCommit;
  inspectAtomicCommitOutcome?: typeof inspectPersistedAtomicCommitOutcome;
  readPersistedBatchSourceResults?: typeof readPersistedBatchSourceResults;
  manualRequestFence?: ManualSourceCommitFence;
  recordOrphanedArtifacts?: (artifacts: readonly ArchivedEvidenceArtifact[]) => Promise<void>;
  getPreviousJobs(sourceId: string): Promise<readonly JobSnapshot[]>;
  getRecentObservations(sourceId: string): Promise<readonly PersistedCrawlObservationRow[]>;
  isBaselineCompleted(sourceId: string): Promise<boolean>;
  getTrustedCompletenessBaseline?(
    sourceId: string
  ): Promise<PersistedTrustedCompletenessBaseline | null>;
  runIndependentTraversalValidator?: typeof runViatrisBrowserTraversalValidator;
}

export async function runP0CrawlBatch(
  plans: readonly SourceCrawlPlan[],
  deps: RunP0CrawlBatchDeps
): Promise<P0CrawlBatchResult> {
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
      const recentObservations = await deps.getRecentObservations(plan.source.id);
      const sourceState = toSourceScheduleState(plan.source.id, recentObservations);

      if (
        deps.identity.batchKind !== "FULL_RELEASE" &&
        !deps.force &&
        !isSourceDueForScheduledRun(sourceState, batchStartedAt)
      ) {
        const pending = plannedBatch.sources.find((source) => source.sourceId === plan.source.id)!;
        await terminatePendingSourceResult({ id: pending.id, releaseCandidateId: deps.identity.releaseCandidateId,
          batchId: batch.id, sourceId: plan.source.id, transportState: "SKIPPED", adapterState: "SKIPPED",
          completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED", finishedAt: batchStartedAt,
          failureCode: "SOURCE_NOT_DUE", failureReason: "Source was not due for this scheduled batch" }, deps.db as never);
        terminalSourceIds.add(plan.source.id);
        skippedSourceCount += 1;
        continue;
      }

      dueSourceCount += 1;

      const trustedCompletenessBaseline = deps.getTrustedCompletenessBaseline
        ? await deps.getTrustedCompletenessBaseline(plan.source.id)
        : null;
      const certificateBaselineRequired = requiresAGradeOfficialTotalCertificate(plan) ||
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
      try {
        crawlResult = await runWithOfficialSourceAttemptTimeout(
          () => runSourceCrawl(plan, {
            fetch: deps.fetch,
            isBaseline: !baselineCompletedBeforeCrawl,
            attemptTracker
          }),
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
        await terminatePendingSourceResult({ id: pending.id, releaseCandidateId: deps.identity.releaseCandidateId,
          batchId: batch.id, sourceId: plan.source.id,
          transportState: error instanceof SourceCrawlStageError && error.stage === "ADAPTER" ? "SUCCEEDED" : "FAILED",
          adapterState: error instanceof SourceCrawlStageError && error.stage === "ADAPTER" ? "FAILED" : "SKIPPED",
          completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED",
          finishedAt: batchStartedAt, failureCode: "SOURCE_STAGE_FAILED",
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
        }, deps.db as never);
        terminalSourceIds.add(plan.source.id);
        failedSourceCount += 1;
        continue;
      }

      let independentTraversalValidation: ViatrisBrowserTraversalValidation | undefined;
      let independentTraversalValidationExecution: "CURRENT_RUN" | "REUSED" | undefined;
      let independentTraversalValidationTrigger: BGradeValidationTrigger | undefined;
      const anomaly = certificateBaselineRequired
        ? evaluateCompletenessAnomalyForCrawl(plan, crawlResult, trustedCompletenessBaseline)
        : { independentValidationRequired: false, triggerCodes: [], countChange: null };
      const completenessAnomalyTriggerCodes: readonly string[] = anomaly.triggerCodes;
      if (requiresBGradeTraversalCertificate(plan)) {
        independentTraversalValidationTrigger = selectCompletenessValidationTrigger({
          baseline: trustedCompletenessBaseline,
          currentSourceConfigSha256: pending.sourceConfigHash,
          anomaly
        });
        const mainPathCanBeCertified = crawlResult.truth.transportSuccess && crawlResult.truth.adapterSuccess;
        if (mainPathCanBeCertified || anomaly.independentValidationRequired) {
          if (independentTraversalValidationTrigger === "STABLE_RUN" &&
              trustedCompletenessBaseline?.certificateGrade === "B") {
            try {
              independentTraversalValidation = readReusableViatrisTraversalValidation({
                certificate: trustedCompletenessBaseline.certificate,
                certificateSha256: trustedCompletenessBaseline.certificateSha256,
                sourceConfigSha256: pending.sourceConfigHash,
                now: crawlResult.observation.crawledAt
              });
              if (viatrisTraversalValidationMatchesCurrentJobs(
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
              independentTraversalValidation = await (
                deps.runIndependentTraversalValidator ?? runViatrisBrowserTraversalValidator
              )({
                entryUrl: plan.source.officialEntryUrl,
                sourceConfigSha256: pending.sourceConfigHash,
                surfaceIds: pending.officialSurfaceIds,
                channelIds: pending.officialChannelIds
              });
              independentTraversalValidationExecution = "CURRENT_RUN";
            } catch {
              // Missing independent evidence is a C-grade completeness outcome, not an atomic transport failure.
              independentTraversalValidation = undefined;
              independentTraversalValidationExecution = undefined;
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
        const profileBoundFailureReason = crawlResult.status === "FAILED"
          ? safeProfileBoundSourceFailureReason(plan, crawlResult.failureReason)
          : undefined;
        await terminatePendingSourceResult({
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
              : profileBoundFailureReason ?? "Source transport failed"
            : "Source adapter failed",
          ...(transportFailed
            ? transportFailureDiagnosticBundle(crawlResult.transportFailure, attemptTracker)
            : sourceFailureDiagnosticBundle(
                "OFFICIAL_SOURCE_REVIEW_REQUIRED",
                "ADAPTER_FAILED_CLOSED",
                attemptTracker
              ))
        }, deps.db as never);
        terminalSourceIds.add(plan.source.id);
        failedSourceCount += 1;
        continue;
      }

      let committedCompletenessVerified = false;
      let retainedArtifacts: readonly ArchivedEvidenceArtifact[] = [];
      let commit: AtomicSourceEvidenceCommit | undefined;
      let atomicFailureCode:
        | "EVIDENCE_ARCHIVE_FAILED"
        | "EVIDENCE_VERIFICATION_FAILED"
        | "ATOMIC_COMMIT_BUILD_FAILED"
        | "ATOMIC_EVIDENCE_COMMIT_FAILED"
        | "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT" = "ATOMIC_COMMIT_BUILD_FAILED";
      try {
        if (!crawlResult.fetchEvidence) throw new Error("strict fetch evidence is required for atomic runtime commit");
        const artifacts = bindRuntimeEvidenceArtifactIds({
          releaseCandidateId: deps.identity.releaseCandidateId,
          batchId: batch.id,
          sourceId: plan.source.id,
          sourceResultId: pending.id,
          artifacts: [
            ...crawlResult.fetchEvidence.artifacts,
            ...(crawlResult.priorTransportAttempts ?? []).flatMap((attempt) => attempt.fetchEvidence?.artifacts ?? [])
          ]
        });
        atomicFailureCode = "EVIDENCE_ARCHIVE_FAILED";
        const archived = await (deps.archiveEvidence ?? archiveSourceEvidence)({ workspaceRoot: deps.workspaceRoot ?? process.cwd(),
          releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id, sourceId: plan.source.id,
          sourceResultId: pending.id, evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence",
          captureTool: crawlResult.fetchEvidence.captureTool,
          formalRelease:deps.identity.batchKind==="FULL_RELEASE",
          artifacts });
        retainedArtifacts = archived.artifacts;
        atomicFailureCode = "EVIDENCE_VERIFICATION_FAILED";
        const verifiedArtifacts = await (deps.verifyArchive ?? verifyArchivedSourceEvidence)({ workspaceRoot: deps.workspaceRoot ?? process.cwd(),
          releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id, sourceId: plan.source.id,
          sourceResultId: pending.id, evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence",
          formalRelease:deps.identity.batchKind==="FULL_RELEASE",
          artifacts: archived.artifacts });
        retainedArtifacts = verifiedArtifacts;
        atomicFailureCode = "ATOMIC_COMMIT_BUILD_FAILED";
        commit = buildAtomicRuntimeCommit({ plan, pending, identity: deps.identity, batchId: batch.id,
          result: crawlResult, previousJobs, baselineCompletedBeforeCrawl, artifacts: verifiedArtifacts,
          attemptTracker,
          ...(independentTraversalValidation ? {
            independentTraversalValidation,
            independentTraversalValidationExecution: independentTraversalValidationExecution!,
            independentTraversalValidationTrigger: independentTraversalValidationTrigger!,
            completedAt: new Date(Math.max(
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
            atomicFailureCode = classifyAtomicCommitFailureCode(error);
            const safeCommitError = new Error(atomicFailureCode);
            try {
              await terminatePendingSourceResult({ id: pending.id,
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
              }, deps.db as never);
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
          await terminatePendingSourceResult({ id: pending.id, releaseCandidateId: deps.identity.releaseCandidateId,
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
          }, deps.db as never);
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
          retryCount: 0
        };
        const sourceExecutionStarted = attemptTracker.fetchAttemptCount > 0;
        await terminatePendingSourceResult({ id: pending.id,
          releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id,
          sourceId: pending.sourceId, transportState: "FAILED", adapterState: "SKIPPED",
          completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED",
          finishedAt: batchStartedAt, failureCode: "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL",
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
        }, deps.db as never);
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
      persistedRows
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

function classifyAtomicCommitFailureCode(error: unknown):
  "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT" | "ATOMIC_EVIDENCE_COMMIT_FAILED" {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "P2028"
    ? "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT"
    : "ATOMIC_EVIDENCE_COMMIT_FAILED";
}

function resolveNow(now: RunP0CrawlBatchDeps["now"]): Date {
  return now instanceof Date ? now : now();
}

function evaluateCompletenessAnomalyForCrawl(
  plan: SourceCrawlPlan,
  result: SourceCrawlResult,
  baseline: PersistedTrustedCompletenessBaseline | null
) {
  const pages = result.fetchEvidence?.pages ?? [];
  const finalPage = pages.length > 0 ? pages[pages.length - 1]! : undefined;
  const terminalSignalProven = finalPage !== undefined &&
    finalPage.nextPageSignalAfter === null &&
    ["NEXT_ABSENT", "EMPTY_PAGE", "DECLARED_TOTAL_REACHED"].includes(finalPage.termination);
  const pagination = plan.adapterId === "html-table" ? plan.table.pagination : undefined;
  const suspiciousAdapterCapacity = pagination?.pageSize !== undefined &&
      pages.length === pagination.maxPages
    ? pagination.pageSize * pagination.maxPages
    : undefined;
  return evaluateCompletenessAnomaly({
    baseline,
    currentJobCount: result.jobs.length,
    ...(result.paginationEvaluation ? {
      paginationAnomalyCodes: result.paginationEvaluation.derivedAnomalyCodes
    } : {}),
    ...(finalPage ? {
      finalPage: {
        returnedPageSize: finalPage.returnedPageSize ?? null,
        requestedPageSize: finalPage.requestedPageSize ?? null,
        terminalSignalProven,
        nextSignalPresent: finalPage.nextPageSignalAfter !== null
      }
    } : {}),
    ...(suspiciousAdapterCapacity === undefined ? {} : { suspiciousAdapterCapacity })
  });
}
