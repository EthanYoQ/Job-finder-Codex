import type { PrismaClient } from "@prisma/client";
import { assertPortableCrawlLeaseOwned, type PortableCrawlLease } from "../src/crawler/portableCrawlLease";
import { createPortableFencedRuntimeDatabase } from "../src/db/portableRuntimeDatabase";
import { readPersistedBatchSourceResults, terminatePendingSourceResult } from "../src/db/ingestionRepository";
import { summarizePersistedBatchSourceResults, resolveP0CrawlBatchTerminalStatus } from "../src/crawler/runCrawlBatch";
import { hashCanonicalJobKeySet } from "../src/crawler/runtimeBatchIdentity";

/** Only this new runner's fenced transactions can be recovered this way. Never replay a commit. */
export async function recoverDirectBatches(db: PrismaClient, lease: PortableCrawlLease, candidateId: string, sourceIds: string[]) {
  assertPortableCrawlLeaseOwned(lease);
  if (!candidateId.startsWith("instabox-")) throw Error("NEW_INSTABOX_CANDIDATE_REQUIRED");
  const fenced = createPortableFencedRuntimeDatabase(db, lease);
  const batches = await db.crawlBatch.findMany({ where: {
    status: "RUNNING", releaseCandidateId: candidateId, ownerId: "direct-scheduler", kind: "SCHEDULED"
  }, select: { id: true, plannedSourceIds: true } });
  for (const batch of batches) {
    const planned = batch.plannedSourceIds;
    if (!Array.isArray(planned) || planned.length !== 1 || typeof planned[0] !== "string" || !sourceIds.includes(planned[0])) {
      throw Error("DIRECT_RECOVERY_SOURCE_SCOPE_MISMATCH");
    }
    const binding = { releaseCandidateId: candidateId, batchId: batch.id };
    let rows = await readPersistedBatchSourceResults(binding, db as never);
    if (rows.length !== 1 || rows[0]!.sourceId !== planned[0]) throw Error("DIRECT_RECOVERY_SOURCE_SCOPE_MISMATCH");
    const row = rows[0]!;
    if (row.atomicCommitState === "PENDING") {
      if (typeof row.id !== "string") throw Error("DIRECT_RECOVERY_SOURCE_ID_REQUIRED");
      // Acquiring the shared row lease waited for the former writer's transaction.
      // A remaining PENDING tuple therefore has no atomic Job commit; the old holder
      // cannot publish after takeover. Preserve its evidence and close this attempt.
      await terminatePendingSourceResult({ ...binding, id: row.id, sourceId: row.sourceId,
        transportState: "FAILED", adapterState: "SKIPPED", completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED",
        finishedAt: new Date(), failureCode: "DIRECT_WORKER_INTERRUPTED",
        failureReason: "New lease acquired; previous fenced attempt has no committed source result"
      }, fenced as never);
      rows = await readPersistedBatchSourceResults(binding, db as never);
    }
    const summary = summarizePersistedBatchSourceResults(planned as string[], rows, true);
    const status = resolveP0CrawlBatchTerminalStatus({ batchKind: "SCHEDULED",
      failedSourceCount: summary.failedSourceCount, atomicFailedSourceCount: summary.atomicFailedSourceCount,
      hasExactSuccessfulDenominator: summary.successfulSourceCount === planned.length });
    const committedResultIds = rows.filter(result => result.atomicCommitState === "COMMITTED" &&
      result.completenessState === "VERIFIED").map(result => result.id!);
    const currentJobs = committedResultIds.length === 0 ? [] : await db.lifecycleSetEvidenceMember.findMany({
      where: { ...binding, sourceResultId: { in: committedResultIds }, setKind: "CURRENT" },
      select: { sourceId: true, jobKey: true }
    });
    const finishedAt = new Date();
    await fenced.crawlBatch.update({ where: { id: batch.id }, data: {
      status, finishedAt, heartbeatAt: finishedAt, aggregateJobSetSha256: hashCanonicalJobKeySet(currentJobs),
      transportSucceededCount: summary.transportSuccessfulSourceCount, transportFailedCount: summary.transportFailedSourceCount,
      adapterSucceededCount: summary.adapterSuccessfulSourceCount, adapterFailedCount: summary.adapterFailedSourceCount,
      completenessVerifiedCount: summary.completenessVerifiedSourceCount, completenessIncompleteCount: summary.completenessIncompleteSourceCount,
      atomicCommittedCount: summary.atomicCommittedSourceCount, atomicFailedCount: summary.atomicFailedSourceCount,
      failedSourceCount: summary.failedSourceCount, blockedSourceCount: summary.blockedSourceCount, skippedSourceCount: summary.skippedSourceCount
    } });
  }
  return batches.length;
}
