import { describe, expect, it, vi } from "vitest";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import {
  createBatchWithPendingSourceResults,
  terminatePendingSourceResult,
  type PlannedBatchWithSourcesInput,
  type PrismaPlannedBatchDb,
  type PrismaPendingSourceTerminalDb
} from "../../src/db/ingestionRepository";

const H = "a".repeat(64);
const START = new Date("2026-07-10T08:00:00.000Z");
const FINISH = new Date("2026-07-10T08:01:00.000Z");

function validPlan(): PlannedBatchWithSourcesInput {
  const plannedSourceIds = ["source-1", "source-2"];
  return {
    batch: {
      id: "batch-1", releaseCandidateId: "rc-1", commitSha: "1672ab167e2841887c3b1667b11bbafc5c35106a",
      rosterSha256: H, sourcePlanSha256: H, sourceConfigSha256: H, adapterBundleSha256: H,
      kind: "FULL_RELEASE", plannedSourceIds,
      plannedSourceSetSha256: hashCanonicalStringSet(plannedSourceIds), plannedSourceCount: 2,
      ownerId: "worker-1", heartbeatAt: START, startedAt: START
    },
    sources: plannedSourceIds.map((sourceId, index) => ({
      id: `result-${index + 1}`, sourceId, sourceConfigHash: H,
      adapterVersion: `adapter@${index + 1}`, officialEntryId: `entry-${index + 1}`,
      officialSurfaceIds: [`surface-${index + 1}`], officialChannelIds: [`channel-${index + 1}`],
      startedAt: START
    }))
  };
}

function plannedDb(failSource = false): PrismaPlannedBatchDb & {
  calls: { transactions: number; batches: unknown[]; sources: unknown[]; fences: unknown[] }
} {
  const calls = { transactions: 0, batches: [] as unknown[], sources: [] as unknown[], fences: [] as unknown[] };
  return {
    calls,
    $transaction: vi.fn(async (operation) => {
      calls.transactions += 1;
      const pending = { batches: [] as unknown[], sources: [] as unknown[] };
      const result = await operation({
        $queryRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
          calls.fences.push({ sql, values }); return [{ id: values[0] }];
        }),
        crawlBatch: { create: vi.fn(async (args) => { pending.batches.push(args); return args; }) },
        crawlBatchSourceResult: { create: vi.fn(async (args) => {
          if (failSource) throw new Error("injected pending row failure");
          pending.sources.push(args); return args;
        }) }
      });
      calls.batches.push(...pending.batches);
      calls.sources.push(...pending.sources);
      return result;
    })
  };
}

describe("planned-source PENDING state machine", () => {
  it("creates one batch and the exact PENDING source-result set atomically", async () => {
    const input = validPlan();
    const db = plannedDb();
    await createBatchWithPendingSourceResults(input, db);
    expect(db.calls.transactions).toBe(1);
    expect(db.calls.batches).toHaveLength(1);
    expect(db.calls.sources).toHaveLength(2);
    expect(db.calls.batches[0]).toMatchObject({ data: {
      id: "batch-1", status: "RUNNING", plannedSourceIds: ["source-1", "source-2"],
      plannedSourceCount: 2, transportSucceededCount: 0, atomicCommittedCount: 0,
      finishedAt: null, aggregateJobSetSha256: null
    }});
    expect(db.calls.sources[0]).toMatchObject({ data: {
      id: "result-1", sourceId: "source-1", releaseCandidateId: "rc-1", batchId: "batch-1",
      transportState: "PENDING", adapterState: "PENDING", completenessState: "PENDING",
      atomicCommitState: "PENDING", sourceConfigHash: H, adapterVersion: "adapter@1",
      officialEntryId: "entry-1", officialSurfaceIds: ["surface-1"], officialChannelIds: ["channel-1"],
      finishedAt: null, rawCount: 0, discardCount: 0, expectedJobCount: null,
      canonicalCurrentJobSetSha256: null, failureCode: null
    }});
  });

  it("rolls back the batch and every source row when a PENDING row fails", async () => {
    const db = plannedDb(true);
    await expect(createBatchWithPendingSourceResults(validPlan(), db)).rejects.toThrow(/pending row failure/i);
    expect(db.calls.batches).toEqual([]);
    expect(db.calls.sources).toEqual([]);
  });

  it("locks and binds the exact owned request before creating a MANUAL_SOURCE batch", async () => {
    const input = validPlan();
    input.batch.kind = "MANUAL_SOURCE";
    input.batch.manualCrawlRequestId = "request-1";
    input.batch.plannedSourceIds = ["source-1"];
    input.batch.plannedSourceCount = 1;
    input.batch.plannedSourceSetSha256 = hashCanonicalStringSet(["source-1"]);
    input.sources = [input.sources[0]!];
    const db = plannedDb();
    await createBatchWithPendingSourceResults(input, db);
    expect(db.calls.fences[0]).toMatchObject({
      sql: expect.stringContaining("clock_timestamp()"),
      values: ["request-1", "worker-1", "source-1"]
    });
    expect(db.calls.batches[0]).toMatchObject({ data: { kind: "MANUAL_SOURCE",
      manualCrawlRequestId: "request-1" } });
  });

  const rejectsBeforeTransaction = (name: string, mutate: (input: PlannedBatchWithSourcesInput) => void) =>
    it(name, async () => {
      const input = validPlan(); mutate(input); const db = plannedDb();
      await expect(createBatchWithPendingSourceResults(input, db)).rejects.toThrow();
      expect(db.calls.transactions).toBe(0);
    });

  rejectsBeforeTransaction("rejects an empty source set", (x) => { x.sources = []; });
  rejectsBeforeTransaction("rejects a missing source", (x) => { x.sources.pop(); });
  rejectsBeforeTransaction("rejects an extra source", (x) => { x.sources.push({ ...x.sources[0]!, id: "result-3", sourceId: "source-3" }); });
  rejectsBeforeTransaction("rejects a duplicate source", (x) => { x.sources[1]!.sourceId = "source-1"; });
  rejectsBeforeTransaction("rejects a mis-hashed source set", (x) => { x.batch.plannedSourceSetSha256 = "b".repeat(64); });
  rejectsBeforeTransaction("rejects incomplete source metadata", (x) => { x.sources[0]!.officialEntryId = " "; });

  it("terminal ROLLED_BACK conditionally updates one PENDING row without official evidence writes", async () => {
    const calls: unknown[] = [];
    const db: PrismaPendingSourceTerminalDb = {
      $transaction: vi.fn(async (operation) => operation({ crawlBatchSourceResult: {
        updateMany: vi.fn(async (args) => { calls.push(args); return { count: 1 }; })
      } }))
    };
    await terminatePendingSourceResult({
      id: "result-1", releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1",
      transportState: "SUCCEEDED", adapterState: "SUCCEEDED", completenessState: "FAILED",
      atomicCommitState: "ROLLED_BACK", finishedAt: FINISH,
      failureCode: "HTTP_TIMEOUT", failureReason: "Official endpoint timed out"
    }, db);
    expect(calls).toEqual([{ where: {
      id: "result-1", releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1",
      atomicCommitState: "PENDING"
    }, data: expect.objectContaining({ atomicCommitState: "ROLLED_BACK", completenessState: "FAILED" }) }]);
  });

  for (const terminal of [
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "FAILED", adapterState: "SKIPPED" },
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "BLOCKED", adapterState: "SKIPPED" },
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "SKIPPED", adapterState: "SKIPPED" },
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "SUCCEEDED", adapterState: "FAILED" },
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "SUCCEEDED", adapterState: "BLOCKED" },
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "SUCCEEDED", adapterState: "SKIPPED" },
    { atomicCommitState: "FAILED", transportState: "SUCCEEDED", adapterState: "SUCCEEDED" },
    { atomicCommitState: "ROLLED_BACK", transportState: "SUCCEEDED", adapterState: "SUCCEEDED" }
  ] as const) {
    it(`allows ${terminal.atomicCommitState} ${terminal.transportState}/${terminal.adapterState}`, async () => {
      const db: PrismaPendingSourceTerminalDb = { $transaction: vi.fn(async (operation) => operation({
        crawlBatchSourceResult: { updateMany: vi.fn(async () => ({ count: 1 })) }
      })) };
      await expect(terminatePendingSourceResult({
        id: "result-1", releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1",
        ...terminal, completenessState: "FAILED", finishedAt: FINISH,
        failureCode: "TERMINAL_FAILURE", failureReason: "truthful terminal failure"
      }, db)).resolves.toBeUndefined();
    });
  }

  for (const terminal of [
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "FAILED", adapterState: "FAILED" },
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "BLOCKED", adapterState: "BLOCKED" },
    { atomicCommitState: "NOT_ATTEMPTED", transportState: "SUCCEEDED", adapterState: "SUCCEEDED" },
    { atomicCommitState: "FAILED", transportState: "FAILED", adapterState: "SKIPPED" },
    { atomicCommitState: "FAILED", transportState: "SUCCEEDED", adapterState: "FAILED" },
    { atomicCommitState: "ROLLED_BACK", transportState: "FAILED", adapterState: "SKIPPED" },
    { atomicCommitState: "ROLLED_BACK", transportState: "SUCCEEDED", adapterState: "FAILED" }
  ] as const) {
    it(`rejects ${terminal.atomicCommitState} ${terminal.transportState}/${terminal.adapterState} before transaction`, async () => {
      const db: PrismaPendingSourceTerminalDb = { $transaction: vi.fn() as PrismaPendingSourceTerminalDb["$transaction"] };
      await expect(terminatePendingSourceResult({
        id: "result-1", releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1",
        ...terminal, completenessState: "FAILED", finishedAt: FINISH,
        failureCode: "TERMINAL_FAILURE", failureReason: "truthful terminal failure"
      }, db)).rejects.toThrow(/terminal failure state/i);
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  }

  it("rejects a second terminal transition when no PENDING row matches", async () => {
    const db: PrismaPendingSourceTerminalDb = { $transaction: vi.fn(async (operation) => operation({
      crawlBatchSourceResult: { updateMany: vi.fn(async () => ({ count: 0 })) }
    })) };
    await expect(terminatePendingSourceResult({
      id: "result-1", releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1",
      transportState: "SUCCEEDED", adapterState: "SUCCEEDED", completenessState: "FAILED",
      atomicCommitState: "FAILED", finishedAt: FINISH,
      failureCode: "HTTP_TIMEOUT", failureReason: "Official endpoint timed out"
    }, db)).rejects.toThrow(/matching PENDING/i);
  });
});
