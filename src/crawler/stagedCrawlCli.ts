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
  collectConsecutiveFailuresByCompany,
  crawlEvidenceIdentityFromRuntime,
  writeCrawlSummaryAtomic,
  type CrawlSummary
} from "./crawlSummary";
import { runFormalCleanup } from "./formalCleanup";
import { formatP0CrawlResult, type P0CrawlCommandResult } from "./p0CrawlCommand";
import type { RuntimeBatchIdentity } from "./runtimeBatchIdentity";
import type { runCurrentStagedScheduledCrawl } from "./stagedScheduledCrawl";
import { resolveStagedCrawlEvidencePaths } from "./stagedCrawlEvidencePaths";

export { resolveStagedCrawlEvidencePaths } from "./stagedCrawlEvidencePaths";

type StagedScheduledCrawlResult = Awaited<ReturnType<typeof runCurrentStagedScheduledCrawl>>;

export interface StagedCrawlRuntime {
  run(): Promise<StagedScheduledCrawlResult>;
  loadConsecutiveFailuresByCompany(identity: RuntimeBatchIdentity): Promise<Record<string, number>>;
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
  now(): Date;
}

export interface StagedCrawlOperationInput {
  attemptId: string;
  startedAt: Date;
  capturedAt: Date;
  attemptDir: string;
  summaryPath: string;
  schedulerOwnsAttempt: boolean;
  deps: StagedCrawlOperationDeps;
}

export interface StagedCrawlOperationResult {
  exitCode: 0 | 1;
  commandResult: StagedScheduledCrawlResult;
  summaryBinding: { batchId: string; summarySha256: string };
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
  let terminalError: unknown;
  let completedNonSuccess = false;
  let failureCode: CrawlAttemptFailureCode = "CRAWL_EXECUTION_FAILED";
  let executionStarted = false;
  let operationStage: "EXECUTION" | "SOURCE_HEALTH" | "PUBLISH" | undefined;

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
    if (commandResult.batch.status !== "SUCCESS") {
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

  const succeeded = terminalError === undefined && commandResult?.batch.status === "SUCCESS" && summaryBinding !== undefined;
  await input.deps.writeAttemptEvent(input.attemptDir, buildCrawlAttemptEvent({
    attemptId: input.attemptId,
    state: succeeded ? "SUCCESS" : "FAILED",
    startedAt: input.startedAt,
    finishedAt: input.deps.now(),
    identity: commandResult ? crawlEvidenceIdentityFromRuntime(commandResult.identity) : null,
    authority,
    canonicalSummaryBinding: succeeded ? summaryBinding! : null,
    failureCode: succeeded ? null : failureCode
  }));

  if (terminalError !== undefined && !completedNonSuccess) throw terminalError;
  if (!commandResult || !summaryBinding) throw new Error("Staged crawl returned no publishable command result");
  return {
    exitCode: commandResult.batch.status === "SUCCESS" ? 0 : 1,
    commandResult,
    summaryBinding
  };
}

export async function runProductionStagedCrawlCli(
  env: NodeJS.ProcessEnv = process.env
): Promise<0 | 1> {
  const capturedAt = new Date();
  const { attemptDir, summaryPath } = resolveStagedCrawlEvidencePaths(env);
  const result = await runStagedCrawlOperation({
    attemptId: env.P0_CRAWL_ATTEMPT_ID ?? randomUUID(),
    startedAt: env.P0_CRAWL_ATTEMPT_STARTED_AT ? new Date(env.P0_CRAWL_ATTEMPT_STARTED_AT) : capturedAt,
    capturedAt,
    attemptDir,
    summaryPath,
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
      createRuntime: createProductionRuntime,
      writeAttemptEvent: writeCrawlAttemptEvent,
      writeSummary: writeCrawlSummaryAtomic,
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

async function createProductionRuntime(): Promise<StagedCrawlRuntime> {
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
        syncPlannedSourcesToDb,
        createRuntimeDeps: () => runtimeDeps,
        runP0CrawlBatch
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
        return collectConsecutiveFailuresByCompany(
          rows.map((row) => ({ companyId: row.companyId, sourceId: row.id })),
          runtimeDeps.getRecentObservations
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
