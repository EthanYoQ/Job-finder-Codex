import type { CandidateCompany } from "../data/companyRegistry";
import type { CompanyRegistrySyncDb, CompanyRegistrySyncResult } from "../db/companyRegistrySync";
import type { PrismaCrawlRuntimeDb } from "../db/crawlRuntimeRepository";
import type { RunP0CrawlBatchDeps, P0CrawlBatchResult } from "./runCrawlBatch";
import type { SourceFetchFunction } from "./runSourceCrawl";
import type { SourceCrawlPlan } from "./sourcePlan";

export interface P0CrawlOptions {
  help: boolean;
  sourceIds: string[];
  force?: boolean;
}

export interface P0CrawlCommandResult {
  syncedCompanyCount: number;
  syncedSourceCount: number;
  batch: P0CrawlBatchResult;
}

export interface RuntimeDeps {
  getPreviousJobs: RunP0CrawlBatchDeps["getPreviousJobs"];
  getRecentObservations: RunP0CrawlBatchDeps["getRecentObservations"];
  isBaselineCompleted: RunP0CrawlBatchDeps["isBaselineCompleted"];
}

export interface RunP0CrawlCommandDeps {
  plans: readonly SourceCrawlPlan[];
  companies: readonly CandidateCompany[];
  options: P0CrawlOptions;
  db: CompanyRegistrySyncDb & PrismaCrawlRuntimeDb & RunP0CrawlBatchDeps["db"];
  fetch: SourceFetchFunction;
  now: Date | (() => Date);
  syncPlannedSourcesToDb(
    plans: readonly SourceCrawlPlan[],
    companies: readonly CandidateCompany[],
    db: CompanyRegistrySyncDb
  ): Promise<CompanyRegistrySyncResult>;
  createRuntimeDeps(db: PrismaCrawlRuntimeDb): RuntimeDeps;
  runP0CrawlBatch(
    plans: readonly SourceCrawlPlan[],
    deps: RunP0CrawlBatchDeps
  ): Promise<P0CrawlBatchResult>;
}

export function parseP0CrawlArgs(args: readonly string[]): P0CrawlOptions {
  const sourceIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") {
      return { help: true, sourceIds: [] };
    }

    if (arg === "--source-id") {
      const sourceId = args[index + 1];
      if (!sourceId || sourceId.startsWith("--")) {
        throw new Error("--source-id requires a value");
      }

      sourceIds.push(sourceId);
      index += 1;
      continue;
    }

    if (arg === "--force") {
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help: false, sourceIds, force: args.includes("--force") };
}

export function selectP0CrawlPlans(
  plans: readonly SourceCrawlPlan[],
  options: P0CrawlOptions
): SourceCrawlPlan[] {
  if (options.sourceIds.length === 0) {
    return [...plans];
  }

  const planBySourceId = new Map(plans.map((plan) => [plan.source.id, plan]));
  return options.sourceIds.map((sourceId) => {
    const plan = planBySourceId.get(sourceId);
    if (!plan) {
      throw new Error(`Unknown source id: ${sourceId}`);
    }

    return plan;
  });
}

export async function runP0CrawlCommand({
  plans,
  companies,
  options,
  db,
  fetch,
  now,
  syncPlannedSourcesToDb,
  createRuntimeDeps,
  runP0CrawlBatch
}: RunP0CrawlCommandDeps): Promise<P0CrawlCommandResult> {
  const selectedPlans = selectP0CrawlPlans(plans, options);
  const syncResult = await syncPlannedSourcesToDb(selectedPlans, companies, db);
  const runtimeDeps = createRuntimeDeps(db);
  const batchDeps = {
    db,
    fetch,
    now,
    ...runtimeDeps,
    ...(options.force === undefined ? {} : { force: options.force })
  };
  const batch = await runP0CrawlBatch(selectedPlans, batchDeps);

  return {
    syncedCompanyCount: syncResult.companyCount,
    syncedSourceCount: syncResult.sourceCount,
    batch
  };
}

export function formatP0CrawlResult(result: P0CrawlCommandResult): string {
  return [
    "# P0 Crawl Batch",
    "",
    `Synced companies: ${result.syncedCompanyCount}`,
    `Synced sources: ${result.syncedSourceCount}`,
    `Batch id: ${result.batch.batchId}`,
    `Planned sources: ${result.batch.plannedSourceCount}`,
    `Due sources: ${result.batch.dueSourceCount}`,
    `Successful sources: ${result.batch.successfulSourceCount}`,
    `Failed sources: ${result.batch.failedSourceCount}`,
    `Skipped sources: ${result.batch.skippedSourceCount}`
  ].join("\n");
}
