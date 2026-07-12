import type { CandidateCompany } from "../data/companyRegistry";
import type { CompanyRegistrySyncDb, CompanyRegistrySyncResult } from "../db/companyRegistrySync";
import type { PrismaCrawlRuntimeDb } from "../db/crawlRuntimeRepository";
import type { RunP0CrawlBatchDeps, P0CrawlBatchResult } from "./runCrawlBatch";
import type { SourceFetchFunction } from "./runSourceCrawl";
import {
  canonicalizePlannedSourceIds,
  hashCanonicalStringSet,
  validatePlannedSourceContract,
  validateRuntimeBatchIdentity,
  validateRuntimeBatchMetadata,
  type CrawlBatchKind,
  type RuntimeBatchIdentity
} from "./runtimeBatchIdentity";
import { validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import { releaseMembersFromPlans, validateAuthoritativeReleaseMembership } from "./authoritativeReleaseMembership";
import { getStartupReleaseMembership } from "./releaseMembershipAuthority";
import { getStartupSourceSurfaceOracle } from "./sourceSurfaceOracleAuthority";
import { validateIndependentSourceSurfaceOracle } from "./independentSourceSurfaceOracle";

export interface P0CrawlOptions {
  help: boolean;
  sourceIds: string[];
  force?: boolean;
  identity?: RuntimeBatchIdentity;
}

export interface P0CrawlCommandResult {
  syncedCompanyCount: number;
  syncedSourceCount: number;
  hiddenUnplannedVisibleJobCount: number;
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
  identity: RuntimeBatchIdentity;
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
  const identityFields: Partial<Record<keyof RuntimeBatchIdentity, string>> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
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

    const identityField = identityFieldForArgument(arg);
    if (identityField) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      if (identityFields[identityField] !== undefined) {
        throw new Error(`Duplicate runtime identity flag: ${arg}`);
      }
      identityFields[identityField] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const identity = Object.keys(identityFields).length > 0
    ? (identityFields as unknown as RuntimeBatchIdentity)
    : undefined;
  return {
    help: false,
    sourceIds,
    force: args.includes("--force"),
    ...(identity ? { identity } : {})
  };
}

export function selectP0CrawlPlans(
  plans: readonly SourceCrawlPlan[],
  options: P0CrawlOptions,
  batchKind?: CrawlBatchKind
): SourceCrawlPlan[] {
  if (batchKind === "FULL_RELEASE" && options.sourceIds.length > 0) {
    throw new Error("FULL_RELEASE batches cannot use partial --source-id selection");
  }
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
  identity,
  db,
  fetch,
  now,
  syncPlannedSourcesToDb,
  createRuntimeDeps,
  runP0CrawlBatch
}: RunP0CrawlCommandDeps): Promise<P0CrawlCommandResult> {
  validateRuntimeBatchIdentity(identity);
  for (const plan of plans) validateExecutablePlanChannelBinding(plan);
  const selectedPlans = selectP0CrawlPlans(plans, options, identity.batchKind);
  validatePlannedSourceContract(identity, selectedPlans.map((plan) => plan.source.id));
  if (identity.batchKind === "FULL_RELEASE") {
    const membership = await getStartupReleaseMembership();
    validateAuthoritativeReleaseMembership(membership, identity, releaseMembersFromPlans(selectedPlans));
    const validationTime = now instanceof Date ? now : now();
    validateIndependentSourceSurfaceOracle(await getStartupSourceSurfaceOracle(), membership, identity, selectedPlans,
      validationTime);
  }
  const syncResult = await syncPlannedSourcesToDb(plans, companies, db);
  const runtimeDeps = createRuntimeDeps(db);
  const batchDeps = {
    db,
    fetch,
    now,
    identity,
    ...runtimeDeps,
    ...(options.force === undefined ? {} : { force: options.force })
  };
  const batch = await runP0CrawlBatch(selectedPlans, batchDeps);

  return {
    syncedCompanyCount: syncResult.companyCount,
    syncedSourceCount: syncResult.sourceCount,
    hiddenUnplannedVisibleJobCount: syncResult.hiddenUnplannedVisibleJobCount,
    batch
  };
}

export function requireP0RuntimeIdentity(
  options: P0CrawlOptions,
  expectedSourceIds?: readonly string[]
): RuntimeBatchIdentity {
  validateRuntimeBatchMetadata(options.identity);
  if (expectedSourceIds === undefined) {
    validateRuntimeBatchIdentity(options.identity);
    return options.identity;
  }
  const expectedPlannedSourceIds = canonicalizePlannedSourceIds(expectedSourceIds);
  const identity = {
    ...options.identity,
    expectedPlannedSourceIds,
    expectedPlannedSourceSetSha256: hashCanonicalStringSet(expectedPlannedSourceIds),
    expectedPlannedSourceCount: expectedPlannedSourceIds.length
  };
  validateRuntimeBatchIdentity(identity);
  return identity;
}

function identityFieldForArgument(
  argument: string
): keyof RuntimeBatchIdentity | undefined {
  const fields: Record<string, keyof RuntimeBatchIdentity> = {
    "--release-candidate-id": "releaseCandidateId",
    "--commit-sha": "commitSha",
    "--roster-sha256": "rosterSha256",
    "--source-plan-sha256": "sourcePlanSha256",
    "--source-config-sha256": "sourceConfigSha256",
    "--adapter-bundle-sha256": "adapterBundleSha256",
    "--batch-kind": "batchKind",
    "--owner-id": "ownerId"
  };
  return fields[argument];
}

export function formatP0CrawlResult(result: P0CrawlCommandResult): string {
  return [
    "# P0 Crawl Batch",
    "",
    `Synced companies: ${result.syncedCompanyCount}`,
    `Synced sources: ${result.syncedSourceCount}`,
    `Hidden unplanned visible jobs: ${result.hiddenUnplannedVisibleJobCount}`,
    `Batch id: ${result.batch.batchId}`,
    `Planned sources: ${result.batch.plannedSourceCount}`,
    `Due sources: ${result.batch.dueSourceCount}`,
    `Transport successful sources: ${result.batch.transportSuccessfulSourceCount}`,
    `Transport failed sources: ${result.batch.transportFailedSourceCount}`,
    `Adapter successful sources: ${result.batch.adapterSuccessfulSourceCount}`,
    `Adapter failed sources: ${result.batch.adapterFailedSourceCount}`,
    `Completeness verified sources: ${result.batch.completenessVerifiedSourceCount}`,
    `Completeness incomplete sources: ${result.batch.completenessIncompleteSourceCount}`,
    `Atomically committed sources: ${result.batch.atomicCommittedSourceCount}`,
    `Atomically failed sources: ${result.batch.atomicFailedSourceCount}`,
    `Strict successful sources: ${result.batch.successfulSourceCount}`,
    `Failed sources: ${result.batch.failedSourceCount}`,
    `Skipped sources: ${result.batch.skippedSourceCount}`
  ].join("\n");
}
