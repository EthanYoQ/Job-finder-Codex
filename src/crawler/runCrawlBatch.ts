import {
  createBatchWithPendingSourceResults,
  executeAtomicSourceEvidenceCommit,
  terminatePendingSourceResult,
  type PrismaIngestionDb
} from "../db/ingestionRepository";
import {
  toSourceScheduleState,
  type PersistedCrawlObservationRow
} from "../db/crawlStateRepository";
import type { JobSnapshot } from "./lifecycle";
import { buildJobDedupeKey } from "./normalizedJob";
import {
  runSourceCrawl,
  SourceCrawlStageError,
  type SourceFetchFunction
} from "./runSourceCrawl";
import {
  hashCanonicalJobKeySet,
  validatePlannedSourceContract,
  type CrawlBatchKind,
  type RuntimeBatchIdentity
} from "./runtimeBatchIdentity";
import { isSourceDueForScheduledRun } from "./schedule";
import { validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import { buildPendingRuntimeBatch } from "./runtimeAtomicEvidence";
import { buildAtomicRuntimeCommit } from "./runtimeAtomicEvidence";
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

export interface P0CrawlBatchResult {
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

type CrawlBatchStatus = "RUNNING" | "INCOMPLETE" | "FAILED" | "SUCCESS";

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
  createBatchId?: () => string;
  workspaceRoot?: string;
  evidenceSubdirectory?: string;
  archiveEvidence?: typeof archiveSourceEvidence;
  verifyArchive?: typeof verifyArchivedSourceEvidence;
  executeAtomicCommit?: typeof executeAtomicSourceEvidenceCommit;
  recordOrphanedArtifacts?: (artifacts: readonly ArchivedEvidenceArtifact[]) => Promise<void>;
  getPreviousJobs(sourceId: string): Promise<readonly JobSnapshot[]>;
  getRecentObservations(sourceId: string): Promise<readonly PersistedCrawlObservationRow[]>;
  isBaselineCompleted(sourceId: string): Promise<boolean>;
}

export async function runP0CrawlBatch(
  plans: readonly SourceCrawlPlan[],
  deps: RunP0CrawlBatchDeps
): Promise<P0CrawlBatchResult> {
  for (const plan of plans) validateExecutablePlanChannelBinding(plan);
  validatePlannedSourceContract(
    deps.identity,
    plans.map((plan) => plan.source.id)
  );
  const batchStartedAt = resolveNow(deps.now);
  if (deps.identity.batchKind === "FULL_RELEASE") {
    const membership = await getStartupReleaseMembership();
    validateAuthoritativeReleaseMembership(membership, deps.identity, releaseMembersFromPlans(plans));
    validateIndependentSourceSurfaceOracle(await getStartupSourceSurfaceOracle(), membership, deps.identity, plans,
      batchStartedAt);
  }
  const trustedOracle = deps.identity.batchKind === "FULL_RELEASE" ? await getStartupSourceSurfaceOracle() : undefined;
  const batch = { id: (deps.createBatchId ?? deps.db.createBatchId ?? randomUUID)() };
  const plannedBatch = buildPendingRuntimeBatch(batch.id, plans, deps.identity, batchStartedAt, undefined, trustedOracle);
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
  let status: Exclude<CrawlBatchStatus, "RUNNING"> = "INCOMPLETE";
  let result: P0CrawlBatchResult | undefined;
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

      const baselineCompletedBeforeCrawl = await deps.isBaselineCompleted(plan.source.id);
      const previousJobs = await deps.getPreviousJobs(plan.source.id);
      const pending = plannedBatch.sources.find((source) => source.sourceId === plan.source.id)!;
      let crawlResult: Awaited<ReturnType<typeof runSourceCrawl>>;
      try {
        crawlResult = await runSourceCrawl(plan, {
          fetch: deps.fetch,
          isBaseline: !baselineCompletedBeforeCrawl
        });
      } catch (error) {
        if (error instanceof SourceCrawlStageError && error.stage === "FETCH") {
          transportFailedSourceCount += 1;
        } else if (error instanceof SourceCrawlStageError && error.stage === "ADAPTER") {
          transportSuccessfulSourceCount += 1;
          adapterFailedSourceCount += 1;
        }
        failedSourceCount += 1;
        await terminatePendingSourceResult({ id: pending.id, releaseCandidateId: deps.identity.releaseCandidateId,
          batchId: batch.id, sourceId: plan.source.id,
          transportState: error instanceof SourceCrawlStageError && error.stage === "ADAPTER" ? "SUCCEEDED" : "FAILED",
          adapterState: error instanceof SourceCrawlStageError && error.stage === "ADAPTER" ? "FAILED" : "SKIPPED",
          completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED",
          finishedAt: batchStartedAt, failureCode: "SOURCE_STAGE_FAILED",
          failureReason: "Source execution failed before atomic evidence commit" }, deps.db as never);
        terminalSourceIds.add(plan.source.id);
        throw error instanceof SourceCrawlStageError ? error.cause : error;
      }

      let committedCompletenessVerified = false;
      try {
        if (!crawlResult.fetchEvidence) throw new Error("strict fetch evidence is required for atomic runtime commit");
        const archived = await (deps.archiveEvidence ?? archiveSourceEvidence)({ workspaceRoot: deps.workspaceRoot ?? process.cwd(),
          releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id, sourceId: plan.source.id,
          sourceResultId: pending.id, evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence",
          captureTool: crawlResult.fetchEvidence.captureTool,
          formalRelease:deps.identity.batchKind==="FULL_RELEASE",
          artifacts: [
            ...crawlResult.fetchEvidence.artifacts,
            ...(crawlResult.priorTransportAttempts ?? []).flatMap((attempt) => attempt.fetchEvidence?.artifacts ?? [])
          ] });
        const verifiedArtifacts = await (deps.verifyArchive ?? verifyArchivedSourceEvidence)({ workspaceRoot: deps.workspaceRoot ?? process.cwd(),
          releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id, sourceId: plan.source.id,
          sourceResultId: pending.id, evidenceSubdirectory: deps.evidenceSubdirectory ?? "phase-1/runtime-evidence",
          formalRelease:deps.identity.batchKind==="FULL_RELEASE",
          artifacts: archived.artifacts });
        const commit = buildAtomicRuntimeCommit({ plan, pending, identity: deps.identity, batchId: batch.id,
          result: crawlResult, previousJobs, baselineCompletedBeforeCrawl, artifacts: verifiedArtifacts,
          ...(trustedOracle ? { trustedOracle } : {}) });
        await (deps.executeAtomicCommit ?? executeAtomicSourceEvidenceCommit)(commit, deps.db as never);
        committedCompletenessVerified = commit.sourceResult.completenessState === "VERIFIED";
        terminalSourceIds.add(plan.source.id);
        transportSuccessfulSourceCount += 1;
        adapterSuccessfulSourceCount += 1;
        if (committedCompletenessVerified) completenessVerifiedSourceCount += 1;
        else completenessIncompleteSourceCount += 1;
        atomicCommittedSourceCount += 1;
      } catch (error) {
        let propagatedError: unknown = error;
        if (error instanceof ArtifactArchiveError && error.orphanedFinalArtifacts.length > 0) {
          try {
            await (deps.recordOrphanedArtifacts ?? ((artifacts) => appendRuntimeOrphanLedger(
              deps.workspaceRoot ?? process.cwd(), deps.identity.releaseCandidateId,
              deps.evidenceSubdirectory ?? "phase-1/runtime-evidence", artifacts
            )))(error.orphanedFinalArtifacts);
          } catch {
            const safeLedgerError = new Error("ORPHAN_LEDGER_RECORDING_FAILED");
            propagatedError = new AggregateError(
              [error, safeLedgerError],
              "Artifact archive and orphan-ledger recording both failed"
            );
          }
        }
        await terminatePendingSourceResult({ id: pending.id, releaseCandidateId: deps.identity.releaseCandidateId,
          batchId: batch.id, sourceId: plan.source.id, transportState: crawlResult.truth.transportSuccess ? "SUCCEEDED" : "FAILED",
          adapterState: crawlResult.truth.transportSuccess
            ? (crawlResult.truth.adapterSuccess ? "SUCCEEDED" : "FAILED") : "SKIPPED",
          completenessState: "FAILED",
          atomicCommitState: crawlResult.truth.transportSuccess && crawlResult.truth.adapterSuccess ? "ROLLED_BACK" : "NOT_ATTEMPTED",
          finishedAt: crawlResult.observation.crawledAt,
          failureCode: "ATOMIC_EVIDENCE_COMMIT_FAILED", failureReason: "Atomic evidence commit failed" }, deps.db as never);
        terminalSourceIds.add(plan.source.id);
        atomicFailedSourceCount += 1;
        failedSourceCount += 1;
        if (!crawlResult.fetchEvidence || !crawlResult.truth.transportSuccess || !crawlResult.truth.adapterSuccess) {
          if (!crawlResult.truth.transportSuccess) transportFailedSourceCount += 1;
          else if (!crawlResult.truth.adapterSuccess) {
            transportSuccessfulSourceCount += 1;
            adapterFailedSourceCount += 1;
          }
          continue;
        }
        throw propagatedError;
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
        } else if (
          crawlResult.observation.completenessStatus === "INCOMPLETE" ||
          crawlResult.observation.completenessStatus === "NEEDS_MANUAL_COMPLETENESS_REVIEW"
        ) {
          blockedSourceCount += 1;
        }

        continue;
      }

      failedSourceCount += 1;
    }

    const hasExactSuccessfulDenominator =
      dueSourceCount === plans.length &&
      skippedSourceCount === 0 &&
      failedSourceCount === 0 &&
      blockedSourceCount === 0 &&
      transportSuccessfulSourceCount === plans.length &&
      transportFailedSourceCount === 0 &&
      adapterSuccessfulSourceCount === plans.length &&
      adapterFailedSourceCount === 0 &&
      completenessVerifiedSourceCount === plans.length &&
      completenessIncompleteSourceCount === 0 &&
      atomicCommittedSourceCount === plans.length &&
      atomicFailedSourceCount === 0;
    status = failedSourceCount > 0 ? "FAILED" : hasExactSuccessfulDenominator ? "SUCCESS" : "INCOMPLETE";
    result = {
      batchId: batch.id,
      plannedSourceCount: plans.length,
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
    };
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
        await terminatePendingSourceResult({ id: pending.id,
          releaseCandidateId: deps.identity.releaseCandidateId, batchId: batch.id,
          sourceId: pending.sourceId, transportState: "FAILED", adapterState: "SKIPPED",
          completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED",
          finishedAt: batchStartedAt, failureCode: "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL",
          failureReason: "Batch aborted before this source reached a terminal state" }, deps.db as never);
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
    if (sourceThrew) {
      throw new AggregateError(
        [thrownError, finalizationError],
        "Source execution and batch finalization both failed"
      );
    }
    throw finalizationError;
  }

  if (sourceThrew) {
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

function resolveNow(now: RunP0CrawlBatchDeps["now"]): Date {
  return now instanceof Date ? now : now();
}
