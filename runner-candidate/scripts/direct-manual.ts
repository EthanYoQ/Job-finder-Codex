import type { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { assertLegacyAuditState, identityForSource, loadDirectPlans } from "./direct-round";
import { withPortableCrawlLease, PortableCrawlLeaseError, type PortableLeaseDatabase } from "../src/crawler/portableCrawlLease";
import { createPortableFencedRuntimeDatabase } from "../src/db/portableRuntimeDatabase";
import { createManualCrawlRequestRepository } from "../src/db/manualCrawlRequestRepository";
import { createPrismaCrawlRuntimeDeps } from "../src/db/crawlRuntimeRepository";
import { runManualCrawlWorker } from "../src/crawler/manualCrawlWorker";
import { createManualSourceBatchExecutor } from "../src/crawler/manualSourceBatchExecutor";
import { runP0CrawlBatch } from "../src/crawler/runCrawlBatch";
import { createHttpOnlyOfficialSourceFetch } from "../src/crawler/sourceQualityAdmission";
import { withLocalOfficialDom } from "../src/crawler/localOfficialSourceFetch";
import { runWithOfficialSourceCancellation } from "../src/crawler/officialHttpRuntimeLimits";
import { runIsolatedBGradeTraversalValidator } from "../src/crawler/isolatedBGradeTraversalValidator";
import { describePortableRuntimeError } from "../src/crawler/portableRuntimeDiagnostics";

export function assertFreshManualRequest(input: {
  request: { id: string; sourceId: string; createdAt: Date; status: string };
  registeredAt: Date; sourceIds: string[]; unresolvedRequests: Array<{ kind?: string; id?: string }>;
}) {
  if (input.unresolvedRequests.some(row => row.kind === "MANUAL_REQUEST" && row.id === input.request.id) ||
      !(input.request.createdAt.getTime() > input.registeredAt.getTime())) throw Error("LEGACY_MANUAL_REQUEST_FORBIDDEN");
  if (!input.sourceIds.includes(input.request.sourceId)) throw Error("MANUAL_SOURCE_OUT_OF_SCOPE");
  if (input.request.status !== "QUEUED") throw Error("MANUAL_REQUEST_NOT_FRESH_QUEUED");
}

/** One explicit request, original preview-only semantics, no queue scan or replay. */
export async function runDirectManual(input: {
  db: PrismaClient; leaseDb: PortableLeaseDatabase; candidateId: string; requestId: string; workspaceRoot: string;
}) {
  const audit = JSON.parse(await readFile(resolve(input.workspaceRoot, "migration-state.json"), "utf8"));
  assertLegacyAuditState(audit, input.candidateId);
  if (input.db === input.leaseDb) throw Error("SEPARATE_LEASE_CONNECTION_REQUIRED");
  const routes = await loadDirectPlans();
  const candidate = await input.db.releaseCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
  if (!["BUILDING", "READY_FOR_QA", "RELEASED"].includes(candidate.status)) throw Error("CANDIDATE_NOT_ACTIVE");
  const request = await input.db.manualCrawlRequest.findUniqueOrThrow({ where: { id: input.requestId } });
  assertFreshManualRequest({ request, registeredAt: candidate.createdAt,
    sourceIds: routes.map(row => row.sourceId), unresolvedRequests: audit.unresolvedRequests });
  const { plan } = routes.find(row => row.sourceId === request.sourceId)!;
  return withPortableCrawlLease(input.leaseDb, async lease => {
    const db = createPortableFencedRuntimeDatabase(input.db, lease);
    const repository = createManualCrawlRequestRepository({ db: db as never,
      queuedRequest: { id: request.id, createdAfter: candidate.createdAt },
      resolveClaimableSourceIds: async () => [request.sourceId] });
    const runtime = createPrismaCrawlRuntimeDeps(db as never);
    const execute = createManualSourceBatchExecutor({ plans: [plan],
      baseIdentity: identityForSource(candidate, request.sourceId), db: db as never,
      fetch: withLocalOfficialDom(createHttpOnlyOfficialSourceFetch()), now: () => new Date(), runtimeDeps: runtime,
      runP0CrawlBatch: (plans, deps) => runWithOfficialSourceCancellation(lease.signal, () => runP0CrawlBatch(plans, {
        ...deps, ...runtime, workspaceRoot: resolve(input.workspaceRoot), evidenceSubdirectory: "runtime-evidence",
        runIndependentTraversalValidator: args => runIsolatedBGradeTraversalValidator({ ...args,
          signal: args.signal ? AbortSignal.any([args.signal, lease.signal]) : lease.signal })
      })) });
    const errors: string[] = [];
    const result = await runManualCrawlWorker({ repository, executeSource: execute,
      ownerId: `direct-manual-${randomUUID()}`, signal: lease.signal, stopWhenIdle: true,
      onOperationalError: event => { errors.push(event.code); } });
    return { ...result, errors, requestId: request.id, mode: "PREVIEW_ONLY" as const };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, requestId, ...extra] = process.argv.slice(2);
  if (flag !== "--request-id" || !requestId || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId) || extra.length) throw Error("Usage: direct-manual.ts --request-id <new-request-id>");
  const candidateId = process.env.JOBFINDER_CANDIDATE_ID;
  if (!candidateId) throw Error("REGISTERED_CANDIDATE_ID_REQUIRED");
  const workspaceRoot = resolve(process.env.JOBFINDER_STATE_ROOT ?? "/data/job-finder");
  process.chdir(fileURLToPath(new URL("..", import.meta.url)));
  const { PrismaClient } = await import("@prisma/client");
  let db: PrismaClient | undefined, leaseDb: PrismaClient | undefined;
  try {
    let databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      if (!process.env.POSTGRES_PASSWORD) throw Error("POSTGRES_PASSWORD_REQUIRED");
      const { stdout } = await promisify(execFile)("docker", ["inspect", "--format", "{{.NetworkSettings.Networks.bridge.IPAddress}}", "jobfinder-postgres"], { timeout: 5_000 });
      if (isIP(stdout.trim()) !== 4) throw Error("POSTGRES_CONTAINER_ADDRESS_UNAVAILABLE");
      const url = new URL(`postgresql://jobfinder@${stdout.trim()}:5432/jobfinder?connection_limit=1&connect_timeout=10&pool_timeout=10`);
      url.password = process.env.POSTGRES_PASSWORD;
      databaseUrl = url.href;
    }
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    leaseDb = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    let result;
    for (;;) {
      try { result = await runDirectManual({ db, leaseDb, candidateId, requestId, workspaceRoot }); break; }
      catch (error) {
        // BUSY proves acquisition did not happen; no request has been claimed.
        // Any uncertain acquisition or execution error exits without a replay.
        if (!(error instanceof PortableCrawlLeaseError) || error.code !== "CRAWL_LEASE_BUSY") throw error;
        await delay(30_000);
      }
    }
    console.log(JSON.stringify(result));
    process.exitCode = result.claimedCount === 1 && result.successCount === 1 && result.errors.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "MANUAL_PREVIEW_NOT_COMPLETED", diagnostic: describePortableRuntimeError(error) }));
    process.exitCode = 1;
  } finally { await Promise.allSettled([db?.$disconnect(), leaseDb?.$disconnect()]); }
}
