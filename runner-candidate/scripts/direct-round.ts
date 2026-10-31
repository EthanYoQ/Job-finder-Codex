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

type Route = { sourceId: string; companyId: string; route: "PORTABLE" | "TRUE_A" | "TRUE_B"; sourceConfigSha256: string };
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

export async function runDirectRound(input: { db: PrismaClient; leaseDb: PortableLeaseDatabase; candidateId: string; workspaceRoot: string }) {
  const routes = await loadDirectPlans(), sourceIds = routes.map(row => row.sourceId);
  assertLegacyAuditState(JSON.parse(await readFile(resolve(input.workspaceRoot, "migration-state.json"), "utf8")), input.candidateId);
  if (input.db === input.leaseDb) throw Error("SEPARATE_LEASE_CONNECTION_REQUIRED");
  return withPortableCrawlLease(input.leaseDb, async lease => {
    await recoverDirectBatches(input.db, lease, input.candidateId, sourceIds);
    await assertNoUnresolvedWrites(input.db, input.candidateId, sourceIds);
    const candidate = await input.db.releaseCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
    if (!["BUILDING", "READY_FOR_QA", "RELEASED"].includes(candidate.status)) throw Error("CANDIDATE_NOT_ACTIVE");
    const sources = await input.db.recruitmentSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, companyId: true } });
    if (routes.some(row => !sources.some(source => source.id === row.sourceId && source.companyId === row.companyId))) throw Error("RESTORED_SOURCE_CATALOG_REQUIRED");
    const portableFetch = createOwnedSourceQualityFetch(), certifiedFetch = withLocalOfficialDom(createHttpOnlyOfficialSourceFetch());
    const results = [];
    for (const row of routes) {
      const portable = row.route === "PORTABLE";
      const runtime = createPrismaCrawlRuntimeDeps(input.db as never, portable ? { portablePlans: [row.plan] } : {});
      try {
        const result = await runP0CrawlBatch([row.plan], {
          db: input.db as never, ...runtime, identity: identityForSource(candidate, row.sourceId), now: () => new Date(),
          publicationPolicy: "SOURCE_ATOMIC_LAST_GOOD_V1", portableLease: lease,
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
  });
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
