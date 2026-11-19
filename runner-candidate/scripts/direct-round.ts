import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { hashCanonicalStringSet } from "../src/crawler/runtimeBatchIdentity";
import { createPrismaCrawlRuntimeDeps } from "../src/db/crawlRuntimeRepository";
import { withPortableCrawlLease, type PortableLeaseDatabase } from "../src/crawler/portableCrawlLease";
import { runP0CrawlBatch } from "../src/crawler/runCrawlBatch";
import { createHttpOnlyOfficialSourceFetch, createOwnedSourceQualityFetch, SOURCE_QUALITY_POLICY_ID } from "../src/crawler/sourceQualityAdmission";
import type { PrismaClient } from "@prisma/client";
import { describePortableRuntimeError } from "../src/crawler/portableRuntimeDiagnostics";
import { recoverDirectBatches } from "./recover-direct";
import { withLocalOfficialDom } from "../src/crawler/localOfficialSourceFetch";
import { withWorkdayRequestPolicy } from "../src/crawler/workdayRequestPolicy";
import type { SourceTransportObservation } from "../src/crawler/sourceFetchFailure";
import { dailySlotMs, slotAt } from "../../pipeline/frequency.mjs";
import { readSourceCompletion } from "../../pipeline/round-coverage";
import { NOVO_NATIVE_RETRY } from "../src/crawler/novoNativeGatewayRetry";

type Route = { sourceId: string; companyId: string; route: "PORTABLE" | "TRUE_A" | "TRUE_B"; sourceConfigSha256: string };
const workdaySources = new Set([
  "source-biogen-china-social", "source-organon-china-social", "source-pfizer-china-social"
]);

function interleaveWorkday<T extends { sourceId: string }>(routes: readonly T[]): T[] {
  const workday = routes.filter(row => workdaySources.has(row.sourceId));
  const others = routes.filter(row => !workdaySources.has(row.sourceId));
  const ordered: T[] = [];
  let start = 0;
  for (const [index, row] of workday.entries()) {
    const end = Math.ceil((index + 1) * others.length / (workday.length + 1));
    ordered.push(...others.slice(start, end), row);
    start = end;
  }
  ordered.push(...others.slice(start));
  return ordered;
}

export function pacedWorkdaySourceTimeout(sourceId: string): number | undefined {
  if (sourceId === "source-pfizer-china-social") return 30 * 60_000;
  return undefined;
}

export async function loadDirectPlans() {
  const { rows } = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8")) as { rows: Route[] };
  const plans = buildStagedSourceCrawlPlans(candidateCompanies);
  if (rows.length !== 36 || new Set(rows.map(row => row.sourceId)).size !== 36) throw Error("EXACT_36_SOURCE_CATALOG_REQUIRED");
  return rows.map(row => {
    const plan = plans.find(plan => plan.source.id === row.sourceId);
    if (!plan || plan.company.id !== row.companyId || sourcePlanConfigSha256(plan) !== row.sourceConfigSha256 ||
        !["PORTABLE", "TRUE_A", "TRUE_B"].includes(row.route)) throw Error(`SOURCE_CATALOG_MISMATCH:${row.sourceId}`);
    return { ...row, plan };
  });
}

export function selectDirectRoutes<T extends {sourceId:string}>(routes:readonly T[],onlySourceIds?:readonly string[]):readonly T[] {
  if(onlySourceIds===undefined)return routes;
  const requested=new Set(onlySourceIds),known=new Set(routes.map(row=>row.sourceId));
  if(onlySourceIds.length===0||requested.size!==onlySourceIds.length||onlySourceIds.some(id=>!known.has(id)))
    throw Error("INVALID_SOURCE_SELECTION");
  return routes.filter(row=>requested.has(row.sourceId));
}

export function identityForSource(candidate: { id: string; commitSha: string; rosterHash: string; sourcePlanHash: string; sourceConfigHash: string; adapterBundleHash: string }, sourceId: string) {
  return { releaseCandidateId: candidate.id, commitSha: candidate.commitSha, rosterSha256: candidate.rosterHash,
    sourcePlanSha256: candidate.sourcePlanHash, sourceConfigSha256: candidate.sourceConfigHash,
    adapterBundleSha256: candidate.adapterBundleHash, batchKind: "SCHEDULED" as const, ownerId: "direct-scheduler",
    expectedPlannedSourceIds: [sourceId], expectedPlannedSourceCount: 1,
    expectedPlannedSourceSetSha256: hashCanonicalStringSet([sourceId]) };
}

export function assertLegacyAuditState(state: unknown, candidateId: string) {
  const audit = state as { unresolvedRequests?: unknown; legacyCandidateIds?: unknown; candidateId?: unknown; replayLegacy?: unknown } | null;
  if (!audit || !Array.isArray(audit.unresolvedRequests) || !Array.isArray(audit.legacyCandidateIds)) throw Error("MIGRATION_AUDIT_STATE_REQUIRED");
  if (!candidateId.startsWith("instabox-") || audit.candidateId !== candidateId || audit.legacyCandidateIds.includes(candidateId)) throw Error("NEW_INSTABOX_CANDIDATE_REQUIRED");
  if (audit.replayLegacy !== false) throw Error("LEGACY_REPLAY_FORBIDDEN");
  // Historical UNKNOWN stays UNKNOWN. This entry only creates fresh batches;
  // it accepts no request, batch or source-result ID to replay from this archive.
}

export async function assertNoUnresolvedWrites(db: Pick<PrismaClient, "crawlBatchSourceResult" | "crawlBatch">, candidateId: string, sourceIds: string[]) {
  // recoverDirectBatches owns this same scope. Historical writers were stopped
  // at cutover; their archived states neither prove rollback nor block new work.
  const scope = { releaseCandidateId: candidateId, ownerId: "direct-scheduler", kind: "SCHEDULED" as const };
  const pending = await db.crawlBatchSourceResult.findFirst({
    where: { releaseCandidateId: candidateId, sourceId: { in: sourceIds }, atomicCommitState: "PENDING", batch: { is: scope } }, select: { id: true, batchId: true }
  });
  if (pending) throw Error(`RECONCILE_PENDING_COMMIT:${pending.batchId}:${pending.id}`);
  const running = await db.crawlBatch.findFirst({ where: { ...scope, status: "RUNNING" }, select: { id: true } });
  if (running) throw Error(`RECONCILE_RUNNING_BATCH:${running.id}`);
}

export function canStartScheduledSource(windowStart: number, now = Date.now()): boolean {
  return now >= windowStart && now < windowStart + dailySlotMs;
}

export async function runDirectRound(input: { db: PrismaClient; leaseDb: PortableLeaseDatabase; candidateId: string; workspaceRoot: string; onlySourceIds?:string[]; slot?: string | null;
  prioritizeSelectedSources?: boolean; stopAtSlotEnd?: boolean; allowEmptySelection?: boolean;
  onSourceTransportObservation?: (observation: SourceTransportObservation) => void }) {
  const routes = await loadDirectPlans(), sourceIds = routes.map(row => row.sourceId);
  const selectedRoutes = input.allowEmptySelection && input.onlySourceIds?.length===0 ? [] : selectDirectRoutes(routes,input.onlySourceIds);
  const windowStart = Number(input.slot ?? slotAt());
  if (!Number.isSafeInteger(windowStart) || slotAt(windowStart) !== windowStart) throw Error("INVALID_SCHEDULE_SLOT");
  if (!input.candidateId.startsWith("instabox-")) throw Error("NEW_INSTABOX_CANDIDATE_REQUIRED");
  if (input.db === input.leaseDb) throw Error("SEPARATE_LEASE_CONNECTION_REQUIRED");
  return withPortableCrawlLease(input.leaseDb, lease => withWorkdayRequestPolicy(resolve(input.workspaceRoot), async () => {
    // Scheduled entry accepts a registered candidate, not historical request/result IDs.
    // The migration sidecar remains an audit input for manual-request admission only.
    const candidate = await input.db.releaseCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
    if (candidate.goalId !== "job-finder-instabox-migration") throw Error("NEW_INSTABOX_CANDIDATE_REQUIRED");
    if (!["BUILDING", "READY_FOR_QA", "RELEASED"].includes(candidate.status)) throw Error("CANDIDATE_NOT_ACTIVE");
    await recoverDirectBatches(input.db, lease, input.candidateId, sourceIds);
    await assertNoUnresolvedWrites(input.db, input.candidateId, sourceIds);
    const sources = await input.db.recruitmentSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, companyId: true } });
    if (routes.some(row => !sources.some(source => source.id === row.sourceId && source.companyId === row.companyId))) throw Error("RESTORED_SOURCE_CATALOG_REQUIRED");
    const completion = await readSourceCompletion(input.db,candidate.id,String(windowStart),selectedRoutes.map(row=>row.sourceId),
      new Map(selectedRoutes.map(row=>[row.sourceId,row.sourceConfigSha256])));
    const completedBySource = new Map(completion.filter(row=>row.complete).map(row=>[row.sourceId,row.batchId]));
    const portableFetch = createOwnedSourceQualityFetch(), certifiedFetch = withLocalOfficialDom(createHttpOnlyOfficialSourceFetch());
    const results = [];
    // Priority is retained within each group; Workday pacing still interleaves both groups.
    const orderedRoutes = input.prioritizeSelectedSources && input.onlySourceIds
      ? input.onlySourceIds.map(sourceId => selectedRoutes.find(row => row.sourceId === sourceId)!)
      : selectedRoutes;
    for (const row of interleaveWorkday(orderedRoutes)) {
      if (input.stopAtSlotEnd && !canStartScheduledSource(windowStart)) break;
      const batchId = completedBySource.get(row.sourceId);
      if (batchId) {
        results.push({ sourceId: row.sourceId, route: row.route, batchId, status: "SKIPPED_ALREADY_COMMITTED_IN_WINDOW" });
        continue;
      }
      const portable = row.route === "PORTABLE";
      const runtime = createPrismaCrawlRuntimeDeps(input.db as never, portable ? { portablePlans: [row.plan] } : {});
      const workdayTimeout = pacedWorkdaySourceTimeout(row.sourceId);
      try {
        const result = await runP0CrawlBatch([row.plan], {
          db: input.db as never, ...runtime, identity: identityForSource(candidate, row.sourceId), now: () => new Date(),
          publicationPolicy: "SOURCE_ATOMIC_LAST_GOOD_V1", portableLease: lease, force: true,
          ...(input.onSourceTransportObservation ? {onSourceTransportObservation:input.onSourceTransportObservation} : {}),
          ...(["source-johnson-innovative-medicine-social", "source-sanofi-china-social"].includes(row.sourceId) ? { sourceAttemptTimeoutMs: 30 * 60 * 1_000 } : {}),
          ...(workdayTimeout === undefined ? {} : { sourceAttemptTimeoutMs: workdayTimeout }),
          ...(row.sourceId === "source-novartis-social" ? { sourceAttemptTimeoutMs: 25 * 60 * 1_000 } : {}),
          ...(row.sourceId === "source-novo-nordisk-china-social" ? { sourceAttemptTimeoutMs: NOVO_NATIVE_RETRY.sourceMs } : {}),
          ...(portable ? { sourceAdmissionPolicy: SOURCE_QUALITY_POLICY_ID } : {}),
          workspaceRoot: resolve(input.workspaceRoot), evidenceSubdirectory: "runtime-evidence",
          fetch: portable ? portableFetch : certifiedFetch
        });
        results.push({ sourceId: row.sourceId, route: row.route, ...result });
      } catch (error) {
        if (lease.signal.aborted) throw error;
        // Preserve the original cause before a reconciliation check can replace it.
        console.error(JSON.stringify({sourceId:row.sourceId,diagnostic:describePortableRuntimeError(error),
          locations:error instanceof Error ? error.stack?.split("\n").filter(line=>/^\s+at /.test(line)&&line.includes("/data/job-finder/app/")).slice(0,6) : undefined}));
        await assertNoUnresolvedWrites(input.db, input.candidateId, sourceIds);
        // Keep driver messages private; a source failure does not stop other companies.
        results.push({ sourceId: row.sourceId, route: row.route, status: "FAILED", diagnostic: describePortableRuntimeError(error) });
      }
    }
    return results;
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--check", "--run"].includes(args[0]!)) throw Error("Usage: direct-round.ts --check | --run");
  if (args[0] === "--check") {
    console.log(JSON.stringify((await loadDirectPlans()).map(({ plan, ...row }) => ({ ...row, adapter: plan.adapterId })), null, 2));
  } else {
    if (!process.env.JOBFINDER_CANDIDATE_ID || !process.env.DATABASE_URL) throw Error("DATABASE_URL_AND_REGISTERED_CANDIDATE_ID_REQUIRED");
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient(), leaseDb = new PrismaClient();
    try {
      const results = await runDirectRound({ db, leaseDb, candidateId: process.env.JOBFINDER_CANDIDATE_ID, workspaceRoot: process.cwd() });
      console.log(JSON.stringify(results));
      process.exitCode = results.some(result => result.status === "FAILED" || ("failedSourceCount" in result && (result.failedSourceCount > 0 || result.blockedSourceCount > 0))) ? 1 : 0;
    } catch (error) {
      console.error(JSON.stringify({ status: "FAILED", diagnostic: describePortableRuntimeError(error) }));
      process.exitCode = 1;
    } finally { await Promise.allSettled([db.$disconnect(), leaseDb.$disconnect()]); }
  }
}
