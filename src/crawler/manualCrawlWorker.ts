import type { ManualCrawlRequestRepository } from "../db/manualCrawlRequestRepository";

export type ManualCrawlWorkerRepository = Pick<
  ManualCrawlRequestRepository,
  "claimNext" | "heartbeat" | "finishSuccess" | "finishFailed"
>;

export type ManualSourceExecutionResult = {
  batchId: string;
  status: "SUCCESS" | "FAILED" | "INCOMPLETE";
};

export type ManualCrawlWorkerResult = {
  claimedCount: number;
  successCount: number;
  failedCount: number;
  ownershipLostCount: number;
};

type HeartbeatCallback = () => Promise<void>;

export type ManualCrawlWorkerInput = {
  repository: ManualCrawlWorkerRepository;
  executeSource(input: {
    requestId: string;
    sourceId: string;
    ownerId: string;
  }): Promise<ManualSourceExecutionResult>;
  ownerId: string;
  signal?: AbortSignal;
  now?: () => Date;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  idlePollMs?: number;
  stopWhenIdle?: boolean;
  scheduleHeartbeat?: (callback: HeartbeatCallback, intervalMs: number) => () => void;
  sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  onOperationalError?: (event: {
    code: "CLAIM_FAILED" | "HEARTBEAT_FAILED" | "OWNERSHIP_LOST" | "TERMINAL_UPDATE_FAILED";
    requestId?: string;
  }) => void;
};

const DEFAULT_LEASE_DURATION_MS = 5 * 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_POLL_MS = 2_000;

export async function runManualCrawlWorker(input: ManualCrawlWorkerInput): Promise<ManualCrawlWorkerResult> {
  assertWorkerConfiguration(input);
  const now = input.now ?? (() => new Date());
  const sleep = input.sleep ?? waitForTimeoutOrAbort;
  const scheduleHeartbeat = input.scheduleHeartbeat ?? scheduleHeartbeatInterval;
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const idlePollMs = input.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
  const result: ManualCrawlWorkerResult = {
    claimedCount: 0,
    successCount: 0,
    failedCount: 0,
    ownershipLostCount: 0
  };

  while (!input.signal?.aborted) {
    const claimTime = now();
    let claimed: Awaited<ReturnType<ManualCrawlWorkerRepository["claimNext"]>>;
    try {
      claimed = await input.repository.claimNext({
        ownerId: input.ownerId,
        now: claimTime,
        leaseExpiresAt: futureLease(claimTime, leaseDurationMs)
      });
    } catch {
      input.onOperationalError?.({ code: "CLAIM_FAILED" });
      if (input.stopWhenIdle) break;
      await sleep(idlePollMs, input.signal);
      continue;
    }

    if (!claimed) {
      if (input.stopWhenIdle) break;
      await sleep(idlePollMs, input.signal);
      continue;
    }

    result.claimedCount += 1;
    await processClaimedRequest({
      input,
      claimed,
      result,
      now,
      leaseDurationMs,
      heartbeatIntervalMs,
      scheduleHeartbeat
    });
  }

  return result;
}

async function processClaimedRequest(context: {
  input: ManualCrawlWorkerInput;
  claimed: NonNullable<Awaited<ReturnType<ManualCrawlWorkerRepository["claimNext"]>>>;
  result: ManualCrawlWorkerResult;
  now: () => Date;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  scheduleHeartbeat: NonNullable<ManualCrawlWorkerInput["scheduleHeartbeat"]>;
}): Promise<void> {
  const { input, claimed, result, now, leaseDurationMs, heartbeatIntervalMs, scheduleHeartbeat } = context;
  let heartbeatAuthorityUncertain = false;
  let heartbeatOwnershipLost = false;
  let heartbeatInFlight: Promise<void> | undefined;

  const heartbeat = async (): Promise<void> => {
    if (heartbeatAuthorityUncertain || heartbeatInFlight) return;
    heartbeatInFlight = (async () => {
      const heartbeatTime = now();
      try {
        await input.repository.heartbeat({
          requestId: claimed.id,
          ownerId: input.ownerId,
          now: heartbeatTime,
          leaseExpiresAt: futureLease(heartbeatTime, leaseDurationMs)
        });
      } catch (error) {
        heartbeatAuthorityUncertain = true;
        heartbeatOwnershipLost = isOwnershipLost(error);
        input.onOperationalError?.({
          code: heartbeatOwnershipLost ? "OWNERSHIP_LOST" : "HEARTBEAT_FAILED",
          requestId: claimed.id
        });
      } finally {
        heartbeatInFlight = undefined;
      }
    })();
    await heartbeatInFlight;
  };

  const cancelHeartbeat = scheduleHeartbeat(heartbeat, heartbeatIntervalMs);
  let execution: ManualSourceExecutionResult | undefined;
  let executionFailed = false;
  try {
    execution = await input.executeSource({
      requestId: claimed.id,
      sourceId: claimed.sourceId,
      ownerId: input.ownerId
    });
    executionFailed = execution.status !== "SUCCESS";
  } catch {
    executionFailed = true;
  } finally {
    cancelHeartbeat();
    await heartbeatInFlight;
  }

  if (heartbeatAuthorityUncertain) {
    if (heartbeatOwnershipLost) result.ownershipLostCount += 1;
    return;
  }

  const terminalTime = now();
  try {
    if (executionFailed || !execution) {
      await input.repository.finishFailed({
        requestId: claimed.id,
        ownerId: input.ownerId,
        failureCode: "SOURCE_CRAWL_FAILED",
        now: terminalTime
      });
      result.failedCount += 1;
      return;
    }
    await input.repository.finishSuccess({
      requestId: claimed.id,
      ownerId: input.ownerId,
      crawlBatchId: execution.batchId,
      now: terminalTime
    });
    result.successCount += 1;
  } catch (error) {
    if (isOwnershipLost(error)) {
      result.ownershipLostCount += 1;
      input.onOperationalError?.({ code: "OWNERSHIP_LOST", requestId: claimed.id });
      return;
    }
    if (hasErrorCode(error, "INVALID_MANUAL_BATCH")) {
      try {
        await input.repository.finishFailed({
          requestId: claimed.id,
          ownerId: input.ownerId,
          failureCode: "MANUAL_CRAWL_FAILED",
          now: terminalTime
        });
        result.failedCount += 1;
      } catch (failureError) {
        if (isOwnershipLost(failureError)) {
          result.ownershipLostCount += 1;
          input.onOperationalError?.({ code: "OWNERSHIP_LOST", requestId: claimed.id });
          return;
        }
        input.onOperationalError?.({ code: "TERMINAL_UPDATE_FAILED", requestId: claimed.id });
      }
      return;
    }
    input.onOperationalError?.({ code: "TERMINAL_UPDATE_FAILED", requestId: claimed.id });
  }
}

function scheduleHeartbeatInterval(callback: HeartbeatCallback, intervalMs: number): () => void {
  const timer = setInterval(() => void callback(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function futureLease(now: Date, leaseDurationMs: number): Date {
  return new Date(now.getTime() + leaseDurationMs);
}

function isOwnershipLost(error: unknown): boolean {
  return hasErrorCode(error, "OWNERSHIP_LOST");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function assertWorkerConfiguration(input: ManualCrawlWorkerInput): void {
  const values = [
    input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
    input.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    input.idlePollMs ?? DEFAULT_IDLE_POLL_MS
  ];
  if (input.ownerId.trim() === "" || values.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Manual crawl worker configuration is invalid");
  }
  if (values[1]! >= values[0]!) {
    throw new Error("Manual crawl heartbeat interval must be shorter than the lease");
  }
}

async function waitForTimeoutOrAbort(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, durationMs);
    timer.unref?.();
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}
