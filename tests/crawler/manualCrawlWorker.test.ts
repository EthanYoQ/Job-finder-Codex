import { describe, expect, it, vi } from "vitest";
import {
  manualCrawlWorkerExitCode,
  runManualCrawlWorker,
  type ManualCrawlWorkerRepository
} from "../../src/crawler/manualCrawlWorker";

describe("manual crawl request worker", () => {
  it("executes the claimed exact source and finishes only through repository success", async () => {
    const repository = fakeRepository([
      { id: "request-1", sourceId: "source-1", attemptCount: 1 },
      null
    ]);
    const executeSource = vi.fn(async () => ({ batchId: "batch-1", status: "SUCCESS" as const }));

    await runManualCrawlWorker({
      repository,
      executeSource,
      ownerId: "worker-1",
      stopWhenIdle: true
    });

    expect(executeSource).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "request-1", sourceId: "source-1", ownerId: "worker-1"
    }));
    expect(repository.finishSuccess).toHaveBeenCalledWith({
      requestId: "request-1", ownerId: "worker-1", crawlBatchId: "batch-1"
    });
    expect(repository.finishFailed).not.toHaveBeenCalled();
  });

  it("heartbeats the owned lease while execution is active", async () => {
    const repository = fakeRepository([
      { id: "request-1", sourceId: "source-1", attemptCount: 1 },
      null
    ]);
    const scheduled: Array<() => Promise<void>> = [];
    let resolveExecution!: (value: { batchId: string; status: "SUCCESS" }) => void;
    const execution = new Promise<{ batchId: string; status: "SUCCESS" }>((resolve) => {
      resolveExecution = resolve;
    });

    const running = runManualCrawlWorker({
      repository,
      executeSource: async () => execution,
      ownerId: "worker-1",
      stopWhenIdle: true,
      scheduleHeartbeat: (callback) => {
        scheduled.push(callback);
        return () => undefined;
      }
    });
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));
    await scheduled[0]!();
    expect(repository.heartbeat).toHaveBeenCalledWith({
      requestId: "request-1",
      ownerId: "worker-1",
      leaseDurationMs: 5 * 60_000
    });
    resolveExecution({ batchId: "batch-1", status: "SUCCESS" });
    await running;
  });

  it("does not publish a terminal transition after heartbeat ownership loss", async () => {
    const repository = fakeRepository([
      { id: "request-1", sourceId: "source-1", attemptCount: 2 },
      null
    ]);
    repository.heartbeat.mockRejectedValueOnce(Object.assign(new Error("lost"), { code: "OWNERSHIP_LOST" }));
    const scheduled: Array<() => Promise<void>> = [];
    let resolveExecution!: (value: { batchId: string; status: "SUCCESS" }) => void;
    const execution = new Promise<{ batchId: string; status: "SUCCESS" }>((resolve) => {
      resolveExecution = resolve;
    });

    const running = runManualCrawlWorker({
      repository,
      executeSource: async () => execution,
      ownerId: "worker-2",
      stopWhenIdle: true,
      scheduleHeartbeat: (callback) => {
        scheduled.push(callback);
        return () => undefined;
      }
    });
    await vi.waitFor(() => expect(scheduled).toHaveLength(1));
    await scheduled[0]!();
    resolveExecution({ batchId: "batch-2", status: "SUCCESS" });
    const result = await running;

    expect(repository.finishSuccess).not.toHaveBeenCalled();
    expect(repository.finishFailed).not.toHaveBeenCalled();
    expect(result.ownershipLostCount).toBe(1);
  });

  it("fails closed with a safe code and continues to the next request", async () => {
    const repository = fakeRepository([
      { id: "request-1", sourceId: "source-1", attemptCount: 1 },
      { id: "request-2", sourceId: "source-2", attemptCount: 1 },
      null
    ]);
    const executeSource = vi.fn()
      .mockRejectedValueOnce(new Error("token=secret-value"))
      .mockResolvedValueOnce({ batchId: "batch-2", status: "SUCCESS" as const });

    const result = await runManualCrawlWorker({
      repository,
      executeSource,
      ownerId: "worker-1",
      stopWhenIdle: true
    });

    expect(repository.finishFailed).toHaveBeenCalledWith({
      requestId: "request-1", ownerId: "worker-1", failureCode: "SOURCE_CRAWL_FAILED"
    });
    expect(repository.finishSuccess).toHaveBeenCalledWith(expect.objectContaining({ requestId: "request-2" }));
    expect(result).toMatchObject({ claimedCount: 2, successCount: 1, failedCount: 1 });
  });

  it("treats an unsuccessful batch as failure and never binds it as success", async () => {
    const repository = fakeRepository([
      { id: "request-1", sourceId: "source-1", attemptCount: 1 },
      null
    ]);

    await runManualCrawlWorker({
      repository,
      executeSource: async () => ({ batchId: "batch-1", status: "INCOMPLETE" }),
      ownerId: "worker-1",
      stopWhenIdle: true
    });

    expect(repository.finishSuccess).not.toHaveBeenCalled();
    expect(repository.finishFailed).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "SOURCE_CRAWL_FAILED"
    }));
  });

  it("fails an invalid success binding through the repository instead of leaving it RUNNING", async () => {
    const repository = fakeRepository([
      { id: "request-1", sourceId: "source-1", attemptCount: 1 },
      null
    ]);
    repository.finishSuccess.mockRejectedValueOnce(Object.assign(new Error("invalid"), {
      code: "INVALID_MANUAL_BATCH"
    }));

    await runManualCrawlWorker({
      repository,
      executeSource: async () => ({ batchId: "batch-1", status: "SUCCESS" }),
      ownerId: "worker-1",
      stopWhenIdle: true
    });

    expect(repository.finishFailed).toHaveBeenCalledWith({
      requestId: "request-1", ownerId: "worker-1", failureCode: "MANUAL_CRAWL_FAILED"
    });
  });

  it("stops gracefully after the active request when aborted", async () => {
    const repository = fakeRepository([
      { id: "request-1", sourceId: "source-1", attemptCount: 1 },
      { id: "request-2", sourceId: "source-2", attemptCount: 1 }
    ]);
    const controller = new AbortController();

    const result = await runManualCrawlWorker({
      repository,
      executeSource: async () => {
        controller.abort();
        return { batchId: "batch-1", status: "SUCCESS" };
      },
      ownerId: "worker-1",
      signal: controller.signal
    });

    expect(result.claimedCount).toBe(1);
    expect(repository.claimNext).toHaveBeenCalledTimes(1);
    expect(repository.finishSuccess).toHaveBeenCalledTimes(1);
  });

  it("reports a claim failure in --once mode as a nonzero worker outcome", async () => {
    const repository = fakeRepository([]);
    repository.claimNext.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await runManualCrawlWorker({
      repository,
      executeSource: vi.fn(),
      ownerId: "worker-1",
      stopWhenIdle: true
    });

    expect(result.claimFailureCount).toBe(1);
    expect(manualCrawlWorkerExitCode(result)).toBe(1);
  });
});

function fakeRepository(claims: Array<Awaited<ReturnType<ManualCrawlWorkerRepository["claimNext"]>>>):
ManualCrawlWorkerRepository & Record<"claimNext" | "heartbeat" | "finishSuccess" | "finishFailed", ReturnType<typeof vi.fn>> {
  return {
    claimNext: vi.fn(async () => claims.shift() ?? null),
    heartbeat: vi.fn(async () => undefined),
    finishSuccess: vi.fn(async () => undefined),
    finishFailed: vi.fn(async () => undefined)
  } as never;
}
