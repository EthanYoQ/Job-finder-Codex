import { randomUUID } from "node:crypto";
import {
  buildCrawlAttemptEvent,
  writeCrawlAttemptEvent,
  type CrawlAttemptEvent,
  type CrawlAttemptFailureCode
} from "./crawlAttemptEvidence";
import { classifyCrawlAttemptFailure } from "./crawlAttemptOrchestration";
import {
  buildTerminalCrawlSummary,
  collectConsecutiveSourceResultFailuresByCompany,
  crawlEvidenceIdentityFromRuntime,
  writeCrawlSummaryAtomic,
  type CrawlSummary
} from "./crawlSummary";
import { runFormalCleanup } from "./formalCleanup";
import { formatP0CrawlResult, type P0CrawlCommandResult } from "./p0CrawlCommand";
import { validateRuntimeBatchIdentity, type RuntimeBatchIdentity } from "./runtimeBatchIdentity";
import type { runCurrentStagedScheduledCrawl } from "./stagedScheduledCrawl";
import { resolveStagedCrawlEvidencePaths } from "./stagedCrawlEvidencePaths";
import {
  buildInitialQualificationPauseEvidence,
  writeInitialQualificationPauseEvidence,
  type InitialQualificationPauseEvidence
} from "./initialQualificationPauseEvidence";
import {
  countCompletedStagedQualificationRounds,
  resolveCurrentStagedScheduleAuthority
} from "./stagedScheduleAuthority";

export { resolveStagedCrawlEvidencePaths } from "./stagedCrawlEvidencePaths";

export function parseStagedCrawlArgs(args: readonly string[]): { force: boolean } {
  if (args.length === 0) return { force: false };
  if (args.length === 1 && args[0] === "--force") return { force: true };
  throw new Error("p0:staged-crawl accepts only --force as an optional full-plan operator flag");
}

type StagedScheduledCrawlResult = Awaited<ReturnType<typeof runCurrentStagedScheduledCrawl>>;

export type StagedInitialQualificationDecision =
  | {
    state: "CONTINUE_INITIAL_QUALIFICATION";
    completedRoundCount: number;
    stableCompanyCount: null;
    minimumStableCompanyCount: number;
  }
  | {
    state: "PAUSED_BELOW_MINIMUM";
    completedRoundCount: 2;
    stableCompanyCount: number;
    minimumStableCompanyCount: number;
  }
  | {
    state: "READY_FOR_QA";
    completedRoundCount: 2;
    stableCompanyCount: number;
    minimumStableCompanyCount: number;
  }
  | {
    state: "AWAITING_QA";
    completedRoundCount: null;
    stableCompanyCount: null;
    minimumStableCompanyCount: number;
  }
  | {
    state: "PER_COMPANY_PUBLICATION";
    completedRoundCount: null;
    stableCompanyCount: null;
    minimumStableCompanyCount: number;
  };

export interface StagedInitialQualificationReadiness {
  canRelease: boolean;
  stableCompanyCount: number;
  minimumStableCompanyCount: number;
  issues: readonly { code: string }[];
}

export interface StagedInitialQualificationDeps {
  loadReleaseCandidateState(identity: RuntimeBatchIdentity): Promise<{
    status: string;
    minimumStableCompanyCount: number;
  }>;
  countCompletedQualificationRounds(identity: RuntimeBatchIdentity): Promise<number>;
  loadProspectiveReadiness(
    identity: RuntimeBatchIdentity,
    minimumStableCompanyCount: number
  ): Promise<StagedInitialQualificationReadiness>;
  transitionReleaseCandidate(
    identity: RuntimeBatchIdentity,
    expectedStatus: "BUILDING",
    nextStatus: "INVALIDATED" | "READY_FOR_QA"
  ): Promise<number>;
}

export async function finalizeStagedInitialQualification(
  identity: RuntimeBatchIdentity,
  deps: StagedInitialQualificationDeps
): Promise<StagedInitialQualificationDecision> {
  validateRuntimeBatchIdentity(identity);
  if (identity.batchKind !== "SCHEDULED" || identity.ownerId !== "staged-scheduler") {
    throw new Error("STAGED_INITIAL_QUALIFICATION_IDENTITY_INVALID");
  }
  const candidate = await deps.loadReleaseCandidateState(identity);
  const { status, minimumStableCompanyCount } = candidate;
  if (!Number.isSafeInteger(minimumStableCompanyCount) ||
      minimumStableCompanyCount < 1 || minimumStableCompanyCount > 60) {
    throw new Error("STAGED_INITIAL_QUALIFICATION_MINIMUM_INVALID");
  }
  if (status === "READY_FOR_QA") {
    return Object.freeze({
      state: "AWAITING_QA",
      completedRoundCount: null,
      stableCompanyCount: null,
      minimumStableCompanyCount
    });
  }
  if (status === "RELEASED") {
    return Object.freeze({
      state: "PER_COMPANY_PUBLICATION",
      completedRoundCount: null,
      stableCompanyCount: null,
      minimumStableCompanyCount
    });
  }
  if (status !== "BUILDING") {
    throw new Error(`STAGED_INITIAL_QUALIFICATION_STATUS_INVALID:${status || "MISSING"}`);
  }

  const completedRoundCount = await deps.countCompletedQualificationRounds(identity);
  if (!Number.isSafeInteger(completedRoundCount) || completedRoundCount < 0) {
    throw new Error("STAGED_INITIAL_QUALIFICATION_ROUND_COUNT_INVALID");
  }
  if (completedRoundCount > 2) {
    throw new Error(`STAGED_INITIAL_QUALIFICATION_ROUND_LIMIT_REACHED:${completedRoundCount}`);
  }
  if (completedRoundCount < 2) {
    return Object.freeze({
      state: "CONTINUE_INITIAL_QUALIFICATION",
      completedRoundCount,
      stableCompanyCount: null,
      minimumStableCompanyCount
    });
  }

  const readiness = await deps.loadProspectiveReadiness(identity, minimumStableCompanyCount);
  if (
    !Number.isSafeInteger(readiness.stableCompanyCount) ||
    readiness.stableCompanyCount < 0 ||
    readiness.minimumStableCompanyCount !== minimumStableCompanyCount
  ) {
    throw new Error("STAGED_INITIAL_QUALIFICATION_READINESS_INVALID");
  }
  const belowMinimum = readiness.stableCompanyCount < minimumStableCompanyCount;
  if (!belowMinimum && !readiness.canRelease) {
    const codes = readiness.issues.map(({ code }) => code).join(",") || "UNKNOWN";
    throw new Error(`STAGED_INITIAL_QUALIFICATION_READINESS_FAILED:${codes}`);
  }
  const nextStatus = belowMinimum ? "INVALIDATED" : "READY_FOR_QA";
  const updatedCount = await deps.transitionReleaseCandidate(identity, "BUILDING", nextStatus);
  if (updatedCount !== 1) {
    throw new Error(`Staged initial qualification transition must update exactly one identity-bound candidate; updated ${updatedCount}`);
  }
  if (belowMinimum) {
    return Object.freeze({
      state: "PAUSED_BELOW_MINIMUM",
      completedRoundCount: 2,
      stableCompanyCount: readiness.stableCompanyCount,
      minimumStableCompanyCount
    });
  }
  return Object.freeze({
    state: "READY_FOR_QA",
    completedRoundCount: 2,
    stableCompanyCount: readiness.stableCompanyCount,
    minimumStableCompanyCount
  });
}

export function formatInitialQualificationPauseNotification(
  decision: Extract<StagedInitialQualificationDecision, { state: "PAUSED_BELOW_MINIMUM" }>
): string {
  return `PAUSED_BELOW_MINIMUM: ${decision.stableCompanyCount}/${decision.minimumStableCompanyCount} stable companies after exactly two completed qualification rounds; no third round is allowed.`;
}

export interface StagedCrawlRuntime {
  run(): Promise<StagedScheduledCrawlResult>;
  loadConsecutiveFailuresByCompany(identity: RuntimeBatchIdentity): Promise<Record<string, number>>;
  finalizeInitialQualification?(
    identity: RuntimeBatchIdentity
  ): Promise<StagedInitialQualificationDecision>;
  disconnect(): Promise<void>;
}

interface StagedOperationalLock {
  release(): Promise<void>;
}

interface StagedOperationalFileLock {
  close(): Promise<void>;
}

export interface StagedCrawlOperationDeps {
  acquireAdvisoryLock(): Promise<StagedOperationalLock>;
  acquireFileLock(): Promise<StagedOperationalFileLock>;
  unlinkFileLock(): Promise<void>;
  assertBrowserReady(): Promise<void>;
  createRuntime(): Promise<StagedCrawlRuntime>;
  writeAttemptEvent(directory: string, event: CrawlAttemptEvent): Promise<void>;
  writeSummary(path: string, summary: CrawlSummary): Promise<{ sha256: string }>;
  writeInitialQualificationPauseEvidence(
    path: string,
    evidence: InitialQualificationPauseEvidence
  ): Promise<void>;
  notifyInitialQualificationPause?(
    message: string,
    decision: Extract<StagedInitialQualificationDecision, { state: "PAUSED_BELOW_MINIMUM" }>
  ): void;
  now(): Date;
}

export interface StagedCrawlOperationInput {
  attemptId: string;
  startedAt: Date;
  capturedAt: Date;
  attemptDir: string;
  summaryPath: string;
  initialQualificationPausePath: string;
  schedulerOwnsAttempt: boolean;
  deps: StagedCrawlOperationDeps;
}

export interface StagedCrawlOperationResult {
  exitCode: 0 | 1;
  commandResult: StagedScheduledCrawlResult;
  summaryBinding: { batchId: string; summarySha256: string };
  initialQualificationDecision: StagedInitialQualificationDecision | null;
}

export async function runStagedCrawlOperation(
  input: StagedCrawlOperationInput
): Promise<StagedCrawlOperationResult> {
  const authority = { advisoryLockAcquired: false, fileLockAcquired: false };
  if (!input.schedulerOwnsAttempt) {
    await input.deps.writeAttemptEvent(input.attemptDir, buildCrawlAttemptEvent({
      attemptId: input.attemptId,
      state: "RUNNING",
      startedAt: input.startedAt,
      finishedAt: null,
      identity: null,
      authority,
      canonicalSummaryBinding: null,
      failureCode: null
    }));
  }

  let advisoryLock: StagedOperationalLock | undefined;
  let fileLock: StagedOperationalFileLock | undefined;
  let runtime: StagedCrawlRuntime | undefined;
  let commandResult: StagedScheduledCrawlResult | undefined;
  let summaryBinding: { batchId: string; summarySha256: string } | undefined;
  let initialQualificationDecision: StagedInitialQualificationDecision | null = null;
  let initialQualificationPauseEvidence: InitialQualificationPauseEvidence | null = null;
  let terminalError: unknown;
  let completedNonSuccess = false;
  let failureCode: CrawlAttemptFailureCode = "CRAWL_EXECUTION_FAILED";
  let executionStarted = false;
  let operationStage: "EXECUTION" | "QUALIFICATION_PAUSE" | "SOURCE_HEALTH" | "PUBLISH" | undefined;

  try {
    advisoryLock = await input.deps.acquireAdvisoryLock();
    authority.advisoryLockAcquired = true;
    fileLock = await input.deps.acquireFileLock();
    authority.fileLockAcquired = true;
    await input.deps.assertBrowserReady();
    runtime = await input.deps.createRuntime();

    executionStarted = true;
    operationStage = "EXECUTION";
    commandResult = await runtime.run();
    initialQualificationDecision = runtime.finalizeInitialQualification
      ? await runtime.finalizeInitialQualification(commandResult.identity)
      : null;

    let consecutiveFailures: Record<string, number>;
    try {
      operationStage = "SOURCE_HEALTH";
      consecutiveFailures = await runtime.loadConsecutiveFailuresByCompany(commandResult.identity);
    } catch (error) {
      operationStage = "PUBLISH";
      summaryBinding = await publishSummary(input, commandResult, null);
      operationStage = "SOURCE_HEALTH";
      throw error;
    }

    operationStage = "PUBLISH";
    summaryBinding = await publishSummary(input, commandResult, consecutiveFailures);
    if (initialQualificationDecision?.state === "PAUSED_BELOW_MINIMUM") {
      operationStage = "QUALIFICATION_PAUSE";
      initialQualificationPauseEvidence = buildInitialQualificationPauseEvidence({
        attemptId: input.attemptId,
        identity: commandResult.identity,
        batchId: commandResult.batch.batchId,
        canonicalSummarySha256: summaryBinding.summarySha256,
        completedRoundCount: initialQualificationDecision.completedRoundCount,
        stableCompanyCount: initialQualificationDecision.stableCompanyCount,
        minimumStableCompanyCount: initialQualificationDecision.minimumStableCompanyCount,
        recordedAt: input.deps.now()
      });
      await input.deps.writeInitialQualificationPauseEvidence(
        input.initialQualificationPausePath,
        initialQualificationPauseEvidence
      );
    }
    if (!isOperationallySuccessfulScheduledBatch(commandResult.batch)) {
      terminalError = new Error(`Staged crawl ended ${commandResult.batch.status}`);
      completedNonSuccess = true;
      failureCode = "CRAWL_EXECUTION_FAILED";
    }
  } catch (error) {
    terminalError = error;
    completedNonSuccess = false;
    failureCode = classifyCrawlAttemptFailure({
      advisoryLockAcquired: authority.advisoryLockAcquired,
      fileLockAcquired: authority.fileLockAcquired,
      executionStarted,
      operationStage
    });
  } finally {
    try {
      await runFormalCleanup([
        ...(runtime ? [{ name: "Prisma disconnect", run: () => runtime!.disconnect() }] : []),
        ...(fileLock ? [
          { name: "filesystem lock close", run: () => fileLock!.close() },
          { name: "filesystem lock unlink", run: () => input.deps.unlinkFileLock() }
        ] : []),
        ...(advisoryLock ? [{ name: "PostgreSQL advisory lock release", run: () => advisoryLock!.release() }] : [])
      ]);
    } catch (error) {
      terminalError = error;
      completedNonSuccess = false;
      failureCode = classifyCrawlAttemptFailure({
        advisoryLockAcquired: authority.advisoryLockAcquired,
        fileLockAcquired: authority.fileLockAcquired,
        executionStarted,
        operationStage,
        cleanupFailed: true
      });
    }
  }

  const completedOperationally = terminalError === undefined && commandResult !== undefined &&
    isOperationallySuccessfulScheduledBatch(commandResult.batch) && summaryBinding !== undefined;
  const pauseDecision = initialQualificationDecision?.state === "PAUSED_BELOW_MINIMUM"
    ? initialQualificationDecision
    : null;
  const completedPauseEvidence =
    pauseDecision && initialQualificationPauseEvidence && summaryBinding &&
    (completedOperationally || completedNonSuccess)
    ? initialQualificationPauseEvidence
    : null;
  const paused = completedPauseEvidence !== null;
  await input.deps.writeAttemptEvent(input.attemptDir, buildCrawlAttemptEvent({
    attemptId: input.attemptId,
    state: paused ? "PAUSED" : completedOperationally ? "SUCCESS" : "FAILED",
    startedAt: input.startedAt,
    finishedAt: input.deps.now(),
    identity: commandResult ? crawlEvidenceIdentityFromRuntime(commandResult.identity) : null,
    authority,
    canonicalSummaryBinding: paused || completedOperationally ? summaryBinding! : null,
    failureCode: paused || completedOperationally ? null : failureCode,
    initialQualificationPause: completedPauseEvidence ? {
      reasonCode: completedPauseEvidence.reasonCode,
      notificationKey: completedPauseEvidence.notificationKey,
      completedRoundCount: completedPauseEvidence.completedRoundCount,
      stableCompanyCount: completedPauseEvidence.stableCompanyCount,
      minimumStableCompanyCount: completedPauseEvidence.minimumStableCompanyCount
    } : null
  }));

  if (pauseDecision && completedPauseEvidence) {
    input.deps.notifyInitialQualificationPause?.(
      formatInitialQualificationPauseNotification(pauseDecision),
      pauseDecision
    );
  }

  if (terminalError !== undefined && !completedNonSuccess) throw terminalError;
  if (!commandResult || !summaryBinding) throw new Error("Staged crawl returned no publishable command result");
  return {
    exitCode: paused || !isOperationallySuccessfulScheduledBatch(commandResult.batch) ? 1 : 0,
    commandResult,
    summaryBinding,
    initialQualificationDecision
  };
}

function isOperationallySuccessfulScheduledBatch(batch: StagedScheduledCrawlResult["batch"]): boolean {
  return batch.status === "SUCCESS" ||
    (batch.status === "INCOMPLETE" && batch.atomicFailedSourceCount === 0);
}

export async function runProductionStagedCrawlCli(
  env: NodeJS.ProcessEnv = process.env,
  options: { force?: boolean } = {}
): Promise<0 | 1> {
  const capturedAt = new Date();
  const { attemptDir, summaryPath, initialQualificationPausePath } = resolveStagedCrawlEvidencePaths(env);
  const result = await runStagedCrawlOperation({
    attemptId: env.P0_CRAWL_ATTEMPT_ID ?? randomUUID(),
    startedAt: env.P0_CRAWL_ATTEMPT_STARTED_AT ? new Date(env.P0_CRAWL_ATTEMPT_STARTED_AT) : capturedAt,
    capturedAt,
    attemptDir,
    summaryPath,
    initialQualificationPausePath,
    schedulerOwnsAttempt: env.P0_CRAWL_ATTEMPT_OWNER === "scheduler",
    deps: {
      acquireAdvisoryLock: async () => {
        const { acquireFormalAdvisoryLock } = await import("./formalAdvisoryLock");
        return acquireFormalAdvisoryLock({ databaseUrl: env.DATABASE_URL ?? "" });
      },
      acquireFileLock: async () => {
        const { acquireFormalCrawlLock } = await import("./formalCrawlLock");
        return acquireFormalCrawlLock();
      },
      unlinkFileLock: async () => {
        const [{ unlink }, { FORMAL_CRAWL_LOCK_PATH }] = await Promise.all([
          import("node:fs/promises"),
          import("./formalCrawlLock")
        ]);
        await unlink(FORMAL_CRAWL_LOCK_PATH).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      },
      assertBrowserReady: async () => {
        const { assertFormalBrowserReady } = await import("../readiness/formalBrowserPreflight");
        await assertFormalBrowserReady();
      },
      createRuntime: () => createProductionRuntime(options.force === true),
      writeAttemptEvent: writeCrawlAttemptEvent,
      writeSummary: writeCrawlSummaryAtomic,
      writeInitialQualificationPauseEvidence,
      notifyInitialQualificationPause: (message) => console.error(message),
      now: () => new Date()
    }
  });
  console.log(formatP0CrawlResult(result.commandResult as P0CrawlCommandResult));
  return result.exitCode;
}

async function publishSummary(
  input: StagedCrawlOperationInput,
  commandResult: StagedScheduledCrawlResult,
  consecutiveFailuresByCompany: Record<string, number> | null
): Promise<{ batchId: string; summarySha256: string }> {
  const summary = buildTerminalCrawlSummary({
    identity: commandResult.identity,
    batch: commandResult.batch,
    capturedAt: input.capturedAt,
    finishedAt: input.deps.now(),
    consecutiveFailuresByCompany
  });
  const published = await input.deps.writeSummary(input.summaryPath, summary);
  return { batchId: commandResult.batch.batchId, summarySha256: published.sha256 };
}

async function createProductionRuntime(force = false): Promise<StagedCrawlRuntime> {
  const [
    { PrismaClient },
    { syncPlannedSourcesToDb },
    { createPrismaCrawlRuntimeDeps },
    { runP0CrawlBatch },
    { createMokaSourceFetch },
    { createHttpHtmlSourceFetch },
    { createWorkdaySourceFetch },
    { createHotjobWecruitSourceFetch },
    { createHotjobLegacySourceFetch },
    { createProfileBoundSourceFetch },
    { createOfficialJsonSourceFetch },
    { createUnsupportedSourceFetch },
    { createSourceFetchRouter },
    { runCurrentStagedScheduledCrawl }
  ] = await Promise.all([
    import("@prisma/client"),
    import("../db/companyRegistrySync"),
    import("../db/crawlRuntimeRepository"),
    import("./runCrawlBatch"),
    import("./mokaSourceFetch"),
    import("./httpHtmlSourceFetch"),
    import("./workdaySourceFetch"),
    import("./hotjobWecruitSourceFetch"),
    import("./hotjobLegacySourceFetch"),
    import("./profileBoundSourceFetch"),
    import("./officialJsonSourceFetch"),
    import("./unsupportedSourceFetch"),
    import("./sourceFetchRouter"),
    import("./stagedScheduledCrawl")
  ]);
  const fetch = createSourceFetchRouter({
    moka: createMokaSourceFetch(),
    html: createHttpHtmlSourceFetch(),
    officialJson: createOfficialJsonSourceFetch(),
    workday: createWorkdaySourceFetch(),
    hotjob: createHotjobWecruitSourceFetch(),
    hotjobLegacy: createHotjobLegacySourceFetch(),
    profileBoundSource: createProfileBoundSourceFetch(),
    fallback: createUnsupportedSourceFetch()
  });
  const prisma = new PrismaClient();
  try {
    const runtimeDb = prisma as unknown as Parameters<typeof createPrismaCrawlRuntimeDeps>[0];
    const commandDb = prisma as unknown as Parameters<typeof runCurrentStagedScheduledCrawl>[0]["db"];
    const runtimeDeps = createPrismaCrawlRuntimeDeps(runtimeDb);
    return {
      run: () => runCurrentStagedScheduledCrawl({
        db: commandDb,
        fetch,
        now: () => new Date(),
        force,
        syncPlannedSourcesToDb,
        createRuntimeDeps: () => runtimeDeps,
        runP0CrawlBatch
      }),
      finalizeInitialQualification: (identity) => finalizeStagedInitialQualification(identity, {
        loadReleaseCandidateState: async (candidateIdentity) => {
          const authority = await resolveCurrentStagedScheduleAuthority(prisma as never);
          assertExactQualificationIdentity(authority.identity, candidateIdentity);
          const row = await prisma.releaseCandidate.findUnique({
            where: { id: candidateIdentity.releaseCandidateId },
            select: { status: true, minimumStableCompanyCount: true }
          });
          if (!row) throw new Error("STAGED_INITIAL_QUALIFICATION_CANDIDATE_MISSING");
          return row;
        },
        countCompletedQualificationRounds: (candidateIdentity) =>
          countCompletedStagedQualificationRounds(prisma as never, candidateIdentity),
        loadProspectiveReadiness: async (candidateIdentity, minimumStableCompanyCount) => {
          const [
            { getCompanyPublicationSnapshotFromDb },
            { evaluateStagedReleaseReadiness }
          ] = await Promise.all([
            import("../db/publicationEligibilityRepository"),
            import("../readiness/stagedReleaseReadiness")
          ]);
          const authority = await resolveCurrentStagedScheduleAuthority(prisma as never);
          assertExactQualificationIdentity(authority.identity, candidateIdentity);
          const currentTime = new Date();
          const snapshot = await getCompanyPublicationSnapshotFromDb(
            prisma,
            async () => authority,
            { currentTime }
          );
          return evaluateStagedReleaseReadiness({
            snapshot,
            mode: "PHASE1",
            currentTime,
            releaseCandidateStatus: "READY_FOR_QA",
            minimumStableCompanyCount
          });
        },
        transitionReleaseCandidate: async (candidateIdentity, expectedStatus, nextStatus) => {
          const result = await prisma.releaseCandidate.updateMany({
            where: {
              id: candidateIdentity.releaseCandidateId,
              status: expectedStatus,
              commitSha: candidateIdentity.commitSha,
              rosterHash: candidateIdentity.rosterSha256,
              sourcePlanHash: candidateIdentity.sourcePlanSha256,
              sourceConfigHash: candidateIdentity.sourceConfigSha256,
              adapterBundleHash: candidateIdentity.adapterBundleSha256
            },
            data: { status: nextStatus }
          });
          return result.count;
        }
      }),
      loadConsecutiveFailuresByCompany: async (identity) => {
        const rows = await prisma.recruitmentSource.findMany({
          where: { id: { in: [...identity.expectedPlannedSourceIds] } },
          select: { id: true, companyId: true }
        });
        const actualIds = rows.map((row) => row.id).sort(compareUtf8);
        const expectedIds = [...identity.expectedPlannedSourceIds].sort(compareUtf8);
        if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
          throw new Error("Persisted staged sources do not match the resolved schedule authority");
        }
        const sourceResults = await prisma.crawlBatchSourceResult.findMany({
          where: {
            releaseCandidateId: identity.releaseCandidateId,
            sourceId: { in: expectedIds },
            finishedAt: { not: null },
            batch: { kind: "SCHEDULED" }
          },
          select: {
            id: true,
            sourceId: true,
            finishedAt: true,
            transportState: true,
            adapterState: true,
            completenessState: true,
            atomicCommitState: true,
            failureCode: true
          },
          orderBy: [{ finishedAt: "desc" }, { id: "desc" }]
        });
        return collectConsecutiveSourceResultFailuresByCompany(
          rows.map((row) => ({ companyId: row.companyId, sourceId: row.id })),
          sourceResults.filter((row): row is typeof row & { finishedAt: Date } => row.finishedAt !== null)
        );
      },
      disconnect: () => prisma.$disconnect()
    };
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function assertExactQualificationIdentity(
  actual: RuntimeBatchIdentity,
  expected: RuntimeBatchIdentity
): void {
  validateRuntimeBatchIdentity(actual);
  validateRuntimeBatchIdentity(expected);
  if (
    actual.releaseCandidateId !== expected.releaseCandidateId ||
    actual.commitSha !== expected.commitSha ||
    actual.rosterSha256 !== expected.rosterSha256 ||
    actual.sourcePlanSha256 !== expected.sourcePlanSha256 ||
    actual.sourceConfigSha256 !== expected.sourceConfigSha256 ||
    actual.adapterBundleSha256 !== expected.adapterBundleSha256 ||
    actual.batchKind !== expected.batchKind ||
    actual.ownerId !== expected.ownerId ||
    actual.expectedPlannedSourceSetSha256 !== expected.expectedPlannedSourceSetSha256 ||
    actual.expectedPlannedSourceCount !== expected.expectedPlannedSourceCount ||
    JSON.stringify(actual.expectedPlannedSourceIds) !== JSON.stringify(expected.expectedPlannedSourceIds)
  ) {
    throw new Error("STAGED_INITIAL_QUALIFICATION_IDENTITY_DRIFT");
  }
}
