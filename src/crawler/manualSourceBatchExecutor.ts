import type { RuntimeDeps } from "./p0CrawlCommand";
import {
  canonicalizePlannedSourceIds,
  hashCanonicalStringSet,
  validateRuntimeBatchIdentity,
  type RuntimeBatchIdentity
} from "./runtimeBatchIdentity";
import type { RunP0CrawlBatchDeps, P0CrawlBatchResult } from "./runCrawlBatch";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { SourceFetchFunction } from "./runSourceCrawl";

export function createManualSourceBatchExecutor(input: {
  plans: readonly SourceCrawlPlan[];
  baseIdentity: RuntimeBatchIdentity;
  db: RunP0CrawlBatchDeps["db"];
  fetch: SourceFetchFunction;
  runtimeDeps: RuntimeDeps;
  now: Date | (() => Date);
  runP0CrawlBatch(
    plans: readonly SourceCrawlPlan[],
    deps: RunP0CrawlBatchDeps
  ): Promise<P0CrawlBatchResult>;
}) {
  validateRuntimeBatchIdentity(input.baseIdentity);
  return async (request: {
    requestId: string;
    sourceId: string;
    ownerId: string;
  }): Promise<{ batchId: string; status: P0CrawlBatchResult["status"] }> => {
    const matchingPlans = input.plans.filter((plan) => plan.source.id === request.sourceId);
    if (matchingPlans.length !== 1) {
      throw new Error("Manual crawl requires exactly one canonical source plan");
    }
    const sourceIds = canonicalizePlannedSourceIds([request.sourceId]);
    const identity: RuntimeBatchIdentity = {
      ...input.baseIdentity,
      batchKind: "MANUAL_SOURCE",
      ownerId: request.ownerId,
      expectedPlannedSourceIds: sourceIds,
      expectedPlannedSourceSetSha256: hashCanonicalStringSet(sourceIds),
      expectedPlannedSourceCount: sourceIds.length
    };
    validateRuntimeBatchIdentity(identity);
    const batch = await input.runP0CrawlBatch(matchingPlans, {
      db: input.db,
      fetch: input.fetch,
      now: input.now,
      identity,
      force: true,
      manualRequestFence: { requestId: request.requestId, ownerId: request.ownerId },
      ...input.runtimeDeps
    });
    return { batchId: batch.batchId, status: batch.status };
  };
}
