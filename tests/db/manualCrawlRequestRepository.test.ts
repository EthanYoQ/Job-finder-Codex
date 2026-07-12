import { describe, expect, it, vi } from "vitest";
import {
  ManualCrawlRequestRepositoryError,
  createManualCrawlRequestRepository,
  type ManualCrawlRequestDb
} from "../../src/db/manualCrawlRequestRepository";

const NOW = new Date("2026-07-13T00:00:00.000Z");
const LEASE = new Date("2026-07-13T00:05:00.000Z");
const eligible = vi.fn(() => ({ eligible: true as const }));

describe("manual crawl request repository", () => {
  it("atomically validates the source, enqueues it and records the real admin actor", async () => {
    const { db, calls } = fakeDb();
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });

    await expect(repository.enqueue({
      sourceId: "source-1", requestedById: "admin-1", reason: "verify", ip: "127.0.0.1", userAgent: "vitest"
    })).resolves.toEqual({ id: "request-1" });

    expect(calls.sourceFind).toEqual([{ where: { id: "source-1" }, select: expect.any(Object) }]);
    expect(calls.requestCreate[0]).toEqual({ data: expect.objectContaining({
      sourceId: "source-1", requestedById: "admin-1", status: "QUEUED", reason: "verify"
    }) });
    expect(calls.eventCreate[0]).toEqual({ data: expect.objectContaining({
      requestId: "request-1", eventType: "ENQUEUED", actor: "ADMIN", adminUserId: "admin-1",
      ownerId: null, fromStatus: null, toStatus: "QUEUED"
    }) });
    expect(calls.auditCreate).toHaveLength(1);
    expect(calls.transactionCount).toBe(1);
  });

  it("rejects missing and ineligible sources before creating a request", async () => {
    const missing = fakeDb({ source: null });
    await expect(createManualCrawlRequestRepository({ db: missing.db, evaluateEligibility: eligible })
      .enqueue({ sourceId: "missing", requestedById: "admin", ip: "ip", userAgent: "ua" }))
      .rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
    expect(missing.calls.requestCreate).toHaveLength(0);

    const excluded = fakeDb();
    const repository = createManualCrawlRequestRepository({
      db: excluded.db,
      evaluateEligibility: () => ({ eligible: false, code: "AUTHORIZED_EXCLUSION" })
    });
    await expect(repository.enqueue({ sourceId: "source-1", requestedById: "admin", ip: "ip", userAgent: "ua" }))
      .rejects.toMatchObject({ code: "AUTHORIZED_EXCLUSION" });
    expect(excluded.calls.requestCreate).toHaveLength(0);
  });

  it("maps the active-source unique violation to a stable result", async () => {
    const { db } = fakeDb({ createError: Object.assign(new Error("duplicate"), { code: "P2002" }) });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await expect(repository.enqueue({ sourceId: "source-1", requestedById: "admin", ip: "ip", userAgent: "ua" }))
      .rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
  });

  it("claims through one parameterized SKIP LOCKED CTE and records a system transition", async () => {
    const { db, calls } = fakeDb({ claimRows: [{ id: "request-1", sourceId: "source-1", attemptCount: 1 }] });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    const claimed = await repository.claimNext({ ownerId: "worker-1", now: NOW, leaseExpiresAt: LEASE });

    expect(claimed).toMatchObject({ id: "request-1", attemptCount: 1 });
    expect(calls.raw).toHaveLength(1);
    expect(calls.raw[0].sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(calls.raw[0].sql).toMatch(/WITH\s+candidate[\s\S]+UPDATE\s+"ManualCrawlRequest"/);
    expect(calls.raw[0].sql).toContain("$1");
    expect(calls.raw[0].values).toEqual([NOW, "worker-1", LEASE]);
    expect(calls.eventCreate[0]).toEqual({ data: expect.objectContaining({
      requestId: "request-1", eventType: "CLAIMED", actor: "SYSTEM", adminUserId: null,
      ownerId: "worker-1", toStatus: "RUNNING"
    }) });
  });

  it("returns null when a competing claimant already won", async () => {
    const { db, calls } = fakeDb({ claimRows: [] });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await expect(repository.claimNext({ ownerId: "worker-2", now: NOW, leaseExpiresAt: LEASE })).resolves.toBeNull();
    expect(calls.eventCreate).toHaveLength(0);
  });

  it("marks a lease-expired RUNNING row as reclaimed from RUNNING", async () => {
    const { db, calls } = fakeDb({
      claimRows: [{ id: "request-1", sourceId: "source-1", attemptCount: 2, previousStatus: "RUNNING" }]
    });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await repository.claimNext({ ownerId: "worker-2", now: NOW, leaseExpiresAt: LEASE });
    expect(calls.eventCreate[0]).toEqual({ data: expect.objectContaining({
      eventType: "LEASE_RECLAIMED", fromStatus: "RUNNING", toStatus: "RUNNING", ownerId: "worker-2"
    }) });
  });

  it("heartbeats only a RUNNING request owned by the caller", async () => {
    const wrong = fakeDb({ updateCount: 0 });
    const repository = createManualCrawlRequestRepository({ db: wrong.db, evaluateEligibility: eligible });
    await expect(repository.heartbeat({ requestId: "request-1", ownerId: "other", now: NOW, leaseExpiresAt: LEASE }))
      .rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    expect(wrong.calls.eventCreate).toHaveLength(0);
  });

  it("finishes successfully with an owned RUNNING CAS and MANUAL_SOURCE batch binding", async () => {
    const { db, calls } = fakeDb();
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await repository.finishSuccess({ requestId: "request-1", ownerId: "worker-1", crawlBatchId: "batch-1", now: NOW });
    expect(calls.batchFind[0]).toEqual({ where: { id: "batch-1" }, select: { id: true, kind: true } });
    expect(calls.requestUpdateMany[0]).toEqual({
      where: { id: "request-1", ownerId: "worker-1", status: "RUNNING" },
      data: expect.objectContaining({ status: "SUCCESS", crawlBatchId: "batch-1", finishedAt: NOW })
    });
    expect(calls.eventCreate[0]).toEqual({ data: expect.objectContaining({
      eventType: "SUCCEEDED", actor: "SYSTEM", ownerId: "worker-1", fromStatus: "RUNNING", toStatus: "SUCCESS"
    }) });
  });

  it("stores only an allow-listed safe error code and never a stack or secret", async () => {
    const { db, calls } = fakeDb();
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await repository.finishFailed({ requestId: "request-1", ownerId: "worker-1", failureCode: "SOURCE_CRAWL_FAILED", now: NOW });
    expect(calls.requestUpdateMany[0]).toEqual({
      where: { id: "request-1", ownerId: "worker-1", status: "RUNNING" },
      data: expect.objectContaining({ status: "FAILED", failureCode: "SOURCE_CRAWL_FAILED", finishedAt: NOW })
    });
    await expect(repository.finishFailed({
      requestId: "request-1", ownerId: "worker-1", failureCode: "password=secret\nError: stack", now: NOW
    })).rejects.toMatchObject({ code: "UNSAFE_FAILURE_CODE" });
  });

  it("does not move a terminal request backward when the owner CAS affects zero rows", async () => {
    const terminal = fakeDb({ updateCount: 0 });
    const repository = createManualCrawlRequestRepository({ db: terminal.db, evaluateEligibility: eligible });
    await expect(repository.finishSuccess({
      requestId: "request-1", ownerId: "worker-1", crawlBatchId: "batch-1", now: NOW
    })).rejects.toBeInstanceOf(ManualCrawlRequestRepositoryError);
    expect(terminal.calls.eventCreate).toHaveLength(0);
  });
});

type FakeOptions = {
  source?: { id: string; companyId: string; kind: "SOCIAL"; atsKind: "MOKA"; status: "VERIFIED_SCRAPABLE" } | null;
  createError?: unknown;
  claimRows?: unknown[];
  updateCount?: number;
};

function fakeDb(options: FakeOptions = {}): { db: ManualCrawlRequestDb; calls: Record<string, any> } {
  const calls: Record<string, any> = {
    sourceFind: [], batchFind: [], requestCreate: [], requestUpdateMany: [], eventCreate: [], auditCreate: [], raw: [], transactionCount: 0
  };
  const tx: any = {
    recruitmentSource: { async findUnique(args: unknown) {
      calls.sourceFind.push(args);
      return options.source === undefined
        ? { id: "source-1", companyId: "company-roche", kind: "SOCIAL", atsKind: "MOKA", status: "VERIFIED_SCRAPABLE" }
        : options.source;
    } },
    crawlBatch: { async findUnique(args: unknown) {
      calls.batchFind.push(args);
      return { id: "batch-1", kind: "MANUAL_SOURCE" };
    } },
    manualCrawlRequest: {
      async create(args: unknown) { calls.requestCreate.push(args); if (options.createError) throw options.createError; return { id: "request-1" }; },
      async updateMany(args: unknown) { calls.requestUpdateMany.push(args); return { count: options.updateCount ?? 1 }; }
    },
    manualCrawlRequestEvent: { async create(args: unknown) { calls.eventCreate.push(args); return { id: "event-1" }; } },
    adminAuditEvent: { async create(args: unknown) { calls.auditCreate.push(args); return { id: "audit-1" }; } },
    async $queryRawUnsafe(sql: string, ...values: unknown[]) {
      calls.raw.push({ sql, values });
      return options.claimRows ?? [];
    }
  };
  const db: any = { async $transaction<T>(callback: (client: any) => Promise<T>) {
    calls.transactionCount += 1;
    return callback(tx);
  } };
  return { db, calls };
}
