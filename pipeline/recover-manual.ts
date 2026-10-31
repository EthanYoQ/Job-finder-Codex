import type { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertLegacyAuditState, loadDirectPlans } from "../runner-candidate/scripts/direct-round";
import { assertFreshManualRequest } from "../runner-candidate/scripts/direct-manual";

const execute = promisify(execFile);
const requestSelect = { id: true, sourceId: true, createdAt: true, status: true } as const;

/** Inspect before starting: a timed-out launcher may already have started the unit. */
export async function recoverQueuedManualPreviews(input: {
  db: Pick<PrismaClient, "releaseCandidate" | "manualCrawlRequest">;
  candidateId: string; workspaceRoot: string;
  inspectUnit?: (unit: string) => Promise<string>;
  startUnit?: (unit: string) => Promise<unknown>;
}) {
  const audit = JSON.parse(await readFile(resolve(input.workspaceRoot, "migration-state.json"), "utf8"));
  assertLegacyAuditState(audit, input.candidateId);
  const candidate = await input.db.releaseCandidate.findUniqueOrThrow({ where: { id: input.candidateId },
    select: { createdAt: true, status: true } });
  if (!["BUILDING", "READY_FOR_QA", "RELEASED"].includes(candidate.status)) throw Error("CANDIDATE_NOT_ACTIVE");
  const sourceIds = (await loadDirectPlans()).map(row => row.sourceId);
  const legacyIds = audit.unresolvedRequests.filter((row: {kind?:string;id?:unknown}) =>
    row.kind === "MANUAL_REQUEST" && typeof row.id === "string").map((row: {id:string}) => row.id);
  const requests = await input.db.manualCrawlRequest.findMany({ where: {
    status: "QUEUED", createdAt: { gt: candidate.createdAt }, sourceId: { in: sourceIds }, id: { notIn: legacyIds }
  }, select: requestSelect });
  const inspect = input.inspectUnit ?? (async unit => (await execute("systemctl", ["show", unit,
    "--property=LoadState", "--property=ActiveState", "--property=Job"], { timeout: 5_000 })).stdout);
  const start = input.startUnit ?? (unit => execute("sudo", ["-n", "systemctl", "start", "--no-block", unit], { timeout: 2_000 }));
  const result = { queuedCount: requests.length, startRequestedCount: 0, activeCount: 0,
    skippedCount: 0, unconfirmedCount: 0, notStartedCount: 0 };
  for (const request of requests) {
    try {
      assertFreshManualRequest({ request, registeredAt: candidate.createdAt, sourceIds, unresolvedRequests: audit.unresolvedRequests });
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.id)) throw Error("INVALID_MANUAL_REQUEST_ID");
    } catch { result.skippedCount++; continue; }
    const unit = `jobfinder-manual@${request.id}.service`;
    let state: Record<string, string>;
    try {
      state = Object.fromEntries((await inspect(unit)).trim().split(/\r?\n/).map(line => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }));
    } catch { result.unconfirmedCount++; continue; }
    if (state.LoadState !== "loaded" || state.ActiveState === undefined || state.Job === undefined) {
      result.unconfirmedCount++; continue;
    }
    if (!["inactive", "failed"].includes(state.ActiveState) || !["", "0"].includes(state.Job)) {
      result.activeCount++; continue;
    }
    // Recheck after the systemd read; another launcher may have claimed it meanwhile.
    const current = await input.db.manualCrawlRequest.findUnique({ where: { id: request.id }, select: requestSelect });
    try {
      if (!current) throw Error("MANUAL_REQUEST_MISSING");
      assertFreshManualRequest({ request: current, registeredAt: candidate.createdAt, sourceIds, unresolvedRequests: audit.unresolvedRequests });
    } catch { result.skippedCount++; continue; }
    try { await start(unit); result.startRequestedCount++; }
    catch (error) {
      const failure = error as {killed?:boolean;signal?:unknown};
      if (failure.killed || failure.signal) result.unconfirmedCount++;
      else result.notStartedCount++;
      // Never retry an uncertain start here. A later round must inspect the unit and DB again.
    }
  }
  return result;
}
