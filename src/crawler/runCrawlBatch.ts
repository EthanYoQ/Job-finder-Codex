import { executeIngestionCommands, type PrismaIngestionDb } from "../db/ingestionRepository";
import {
  toSourceScheduleState,
  type PersistedCrawlObservationRow
} from "../db/crawlStateRepository";
import { buildIngestionCommands } from "./ingestion";
import { applyCrawlObservation, type JobSnapshot } from "./lifecycle";
import { runSourceCrawl, type SourceFetchFunction } from "./runSourceCrawl";
import { isSourceDueForScheduledRun } from "./schedule";
import type { SourceCrawlPlan } from "./sourcePlan";

export interface P0CrawlBatchResult {
  batchId: string;
  plannedSourceCount: number;
  dueSourceCount: number;
  successfulSourceCount: number;
  failedSourceCount: number;
  skippedSourceCount: number;
}

interface CrawlBatchRecord {
  id: string;
}

interface PrismaCrawlBatchDb {
  create(args: { data: { startedAt: Date; status: "SUCCESS" } }): Promise<CrawlBatchRecord>;
  update(args: {
    where: { id: string };
    data: { finishedAt: Date; status: "SUCCESS" | "FAILED" };
  }): Promise<unknown>;
}

export interface RunP0CrawlBatchDeps {
  db: PrismaIngestionDb & {
    crawlBatch: PrismaCrawlBatchDb;
  };
  fetch: SourceFetchFunction;
  now: Date | (() => Date);
  getPreviousJobs(sourceId: string): Promise<readonly JobSnapshot[]>;
  getRecentObservations(sourceId: string): Promise<readonly PersistedCrawlObservationRow[]>;
  isBaselineCompleted(sourceId: string): Promise<boolean>;
}

export async function runP0CrawlBatch(
  plans: readonly SourceCrawlPlan[],
  deps: RunP0CrawlBatchDeps
): Promise<P0CrawlBatchResult> {
  const batchStartedAt = resolveNow(deps.now);
  const batch = await deps.db.crawlBatch.create({
    data: {
      startedAt: batchStartedAt,
      status: "SUCCESS"
    }
  });

  let dueSourceCount = 0;
  let successfulSourceCount = 0;
  let failedSourceCount = 0;
  let skippedSourceCount = 0;

  for (const plan of plans) {
    const recentObservations = await deps.getRecentObservations(plan.source.id);
    const sourceState = toSourceScheduleState(plan.source.id, recentObservations);

    if (!isSourceDueForScheduledRun(sourceState, batchStartedAt)) {
      skippedSourceCount += 1;
      continue;
    }

    dueSourceCount += 1;

    const baselineCompletedBeforeCrawl = await deps.isBaselineCompleted(plan.source.id);
    const previousJobs = await deps.getPreviousJobs(plan.source.id);
    const crawlResult = await runSourceCrawl(plan, {
      fetch: deps.fetch,
      isBaseline: !baselineCompletedBeforeCrawl
    });
    const lifecycleDecisions = applyCrawlObservation(previousJobs, crawlResult.jobs, {
      crawlSucceeded: crawlResult.status === "SUCCESS",
      observedAt: crawlResult.observation.crawledAt.toISOString(),
      baselineCompletedBeforeCrawl
    });
    const commands = buildIngestionCommands(crawlResult, lifecycleDecisions);

    await executeIngestionCommands(commands, { batchId: batch.id }, deps.db);

    if (crawlResult.status === "SUCCESS") {
      successfulSourceCount += 1;
      continue;
    }

    failedSourceCount += 1;
  }

  const batchFinishedAt = resolveNow(deps.now);
  const status = failedSourceCount > 0 ? "FAILED" : "SUCCESS";

  await deps.db.crawlBatch.update({
    where: { id: batch.id },
    data: {
      finishedAt: batchFinishedAt,
      status
    }
  });

  return {
    batchId: batch.id,
    plannedSourceCount: plans.length,
    dueSourceCount,
    successfulSourceCount,
    failedSourceCount,
    skippedSourceCount
  };
}

function resolveNow(now: RunP0CrawlBatchDeps["now"]): Date {
  return now instanceof Date ? now : now();
}
