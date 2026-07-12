import { describe, expect, it, vi } from "vitest";
import {
  ManualCrawlRequestRepositoryError,
  createManualCrawlRequestRepository,
  type ManualCrawlRequestDb
} from "../../src/db/manualCrawlRequestRepository";

const LEASE_DURATION_MS = 5 * 60_000;
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
    const { db } = fakeDb({ createError: Object.assign(new Error("duplicate"), {
      code: "P2002", meta: { target: "ManualCrawlRequest_one_active_per_source" }
    }) });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await expect(repository.enqueue({ sourceId: "source-1", requestedById: "admin", ip: "ip", userAgent: "ua" }))
      .rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
  });

  it("accepts the PostgreSQL constraint metadata shape for the named active-source index", async () => {
    const { db } = fakeDb({ createError: Object.assign(new Error("duplicate"), {
      code: "P2002", meta: { constraint: "ManualCrawlRequest_one_active_per_source" }
    }) });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await expect(repository.enqueue({ sourceId: "source-1", requestedById: "admin", ip: "ip", userAgent: "ua" }))
      .rejects.toMatchObject({ code: "ALREADY_ACTIVE" });
  });

  it.each([
    ["primary key", { target: "ManualCrawlRequest_pkey" }],
    ["unknown unique", undefined]
  ])("rethrows a %s P2002 instead of reporting ALREADY_ACTIVE", async (_label, meta) => {
    const original = Object.assign(new Error("other unique violation"), { code: "P2002", meta });
    const { db } = fakeDb({ createError: original });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await expect(repository.enqueue({ sourceId: "source-1", requestedById: "admin", ip: "ip", userAgent: "ua" }))
      .rejects.toBe(original);
  });

  it("claims through one parameterized SKIP LOCKED CTE and records a system transition", async () => {
    const { db, calls } = fakeDb({ claimRows: [{ id: "request-1", sourceId: "source-1", attemptCount: 1 }] });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    const claimed = await repository.claimNext({ ownerId: "worker-1", leaseDurationMs: LEASE_DURATION_MS });

    expect(claimed).toMatchObject({ id: "request-1", attemptCount: 1 });
    expect(calls.raw).toHaveLength(1);
    expect(calls.raw[0].sql).toContain("FOR UPDATE OF request, source SKIP LOCKED");
    expect(calls.raw[0].sql).toMatch(/WITH\s+candidate[\s\S]+UPDATE\s+"ManualCrawlRequest"/);
    expect(calls.raw[0].sql).toContain("CURRENT_TIMESTAMP");
    expect(calls.raw[0].sql).toContain("INTERVAL '1 millisecond'");
    expect(calls.raw[0].values.slice(0, 2)).toEqual(["worker-1", LEASE_DURATION_MS]);
    expect(calls.raw[0].sql).toContain('JOIN "RecruitmentSource"');
    expect(calls.raw[0].values[2]).not.toContain("company-humanwell");
    expect(calls.raw[0].values[2]).not.toContain("company-north-china-pharma");
    expect(calls.raw[0].values.some((value: unknown) => value instanceof Date)).toBe(false);
    expect(calls.eventCreate[0]).toEqual({ data: expect.objectContaining({
      requestId: "request-1", eventType: "CLAIMED", actor: "SYSTEM", adminUserId: null,
      ownerId: "worker-1", toStatus: "RUNNING"
    }) });
  });

  it("returns null when a competing claimant already won", async () => {
    const { db, calls } = fakeDb({ claimRows: [] });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await expect(repository.claimNext({ ownerId: "worker-2", leaseDurationMs: LEASE_DURATION_MS })).resolves.toBeNull();
    expect(calls.eventCreate).toHaveLength(0);
  });

  it("does not claim a historically queued request after source eligibility or exclusion policy drifts", async () => {
    const { db, calls } = fakeDb({ claimRows: [] });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await expect(repository.claimNext({ ownerId: "worker-1", leaseDurationMs: LEASE_DURATION_MS })).resolves.toBeNull();
    expect(calls.raw[0].sql).toContain('source."status" = \'VERIFIED_SCRAPABLE\'');
    expect(calls.raw[0].sql).toContain('source."kind" = \'SOCIAL\'');
    expect(calls.raw[0].sql).toContain('source."companyId" = ANY($3::text[])');
  });

  it("marks a lease-expired RUNNING row as reclaimed from RUNNING", async () => {
    const { db, calls } = fakeDb({
      claimRows: [{ id: "request-1", sourceId: "source-1", attemptCount: 2, previousStatus: "RUNNING" }]
    });
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await repository.claimNext({ ownerId: "worker-2", leaseDurationMs: LEASE_DURATION_MS });
    expect(calls.eventCreate[0]).toEqual({ data: expect.objectContaining({
      eventType: "LEASE_RECLAIMED", fromStatus: "RUNNING", toStatus: "RUNNING", ownerId: "worker-2"
    }) });
  });

  it("rejects blank owners and invalid lease durations before opening a transaction", async () => {
    const fixture = fakeDb();
    const repository = createManualCrawlRequestRepository({ db: fixture.db, evaluateEligibility: eligible });
    await expect(repository.claimNext({ ownerId: " ", leaseDurationMs: LEASE_DURATION_MS }))
      .rejects.toMatchObject({ code: "INVALID_OWNER_OR_LEASE" });
    await expect(repository.heartbeat({ requestId: "request-1", ownerId: "worker", leaseDurationMs: 0 }))
      .rejects.toMatchObject({ code: "INVALID_OWNER_OR_LEASE" });
    expect(fixture.calls.transactionCount).toBe(0);
  });

  it("heartbeats only a RUNNING request owned by the caller", async () => {
    const wrong = fakeDb({ mutationRows: [] });
    const repository = createManualCrawlRequestRepository({ db: wrong.db, evaluateEligibility: eligible });
    await expect(repository.heartbeat({ requestId: "request-1", ownerId: "other", leaseDurationMs: LEASE_DURATION_MS }))
      .rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    expect(wrong.calls.eventCreate).toHaveLength(0);
    expect(wrong.calls.raw[0].sql).toMatch(/leaseExpiresAt"\s*>\s*CURRENT_TIMESTAMP/);
    expect(wrong.calls.raw[0].sql).toContain('"heartbeatAt" = CURRENT_TIMESTAMP');
  });

  it("finishes successfully with an owned RUNNING CAS and MANUAL_SOURCE batch binding", async () => {
    const { db, calls } = fakeDb();
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await repository.finishSuccess({ requestId: "request-1", ownerId: "worker-1", crawlBatchId: "batch-1" });
    expect(calls.requestFind[0]).toEqual({
      where: { id: "request-1" }, select: { id: true, sourceId: true, ownerId: true, status: true }
    });
    expect(calls.batchFind[0]).toEqual({ where: { id: "batch-1" }, select: expect.objectContaining({
      id: true, kind: true, status: true, plannedSourceIds: true, sourceResults: expect.any(Object)
    }) });
    expect(calls.raw.at(-1).sql).toMatch(/leaseExpiresAt"\s*>\s*CURRENT_TIMESTAMP/);
    expect(calls.raw.at(-1).sql).toContain('"finishedAt" = CURRENT_TIMESTAMP');
    expect(calls.raw.at(-1).values).toEqual(["request-1", "worker-1", "batch-1"]);
    expect(calls.eventCreate[0]).toEqual({ data: expect.objectContaining({
      eventType: "SUCCEEDED", actor: "SYSTEM", ownerId: "worker-1", fromStatus: "RUNNING", toStatus: "SUCCESS"
    }) });
  });

  it.each([
    ["different source", { plannedSourceIds: ["source-2"] }],
    ["failed batch", { status: "FAILED" }],
    ["incomplete source result", { sourceResults: [{
      sourceId: "source-1", transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
      completenessState: "INCOMPLETE", atomicCommitState: "COMMITTED"
    }] }]
  ])("rejects success binding for a %s", async (_label, batch) => {
    const fixture = fakeDb({ batch });
    const repository = createManualCrawlRequestRepository({ db: fixture.db, evaluateEligibility: eligible });
    await expect(repository.finishSuccess({
      requestId: "request-1", ownerId: "worker-1", crawlBatchId: "batch-1"
    })).rejects.toMatchObject({ code: "INVALID_MANUAL_BATCH" });
    expect(fixture.calls.raw).toHaveLength(0);
  });

  it("stores only an allow-listed safe error code and never a stack or secret", async () => {
    const { db, calls } = fakeDb();
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await repository.finishFailed({ requestId: "request-1", ownerId: "worker-1", failureCode: "SOURCE_CRAWL_FAILED" });
    expect(calls.raw[0].sql).toMatch(/leaseExpiresAt"\s*>\s*CURRENT_TIMESTAMP/);
    expect(calls.raw[0].sql).toContain('"finishedAt" = CURRENT_TIMESTAMP');
    expect(calls.raw[0].values).toEqual(["request-1", "worker-1", "SOURCE_CRAWL_FAILED"]);
    await expect(repository.finishFailed({
      requestId: "request-1", ownerId: "worker-1", failureCode: "SK_LIVE_SUPERSECRET123"
    })).rejects.toMatchObject({ code: "UNSAFE_FAILURE_CODE" });
  });

  it("does not move a terminal request backward when the owner CAS affects zero rows", async () => {
    const terminal = fakeDb({ mutationRows: [] });
    const repository = createManualCrawlRequestRepository({ db: terminal.db, evaluateEligibility: eligible });
    await expect(repository.finishSuccess({
      requestId: "request-1", ownerId: "worker-1", crawlBatchId: "batch-1"
    })).rejects.toBeInstanceOf(ManualCrawlRequestRepositoryError);
    expect(terminal.calls.eventCreate).toHaveLength(0);
  });

  it("does not let an expired old owner revive, succeed, or fail before reclaim", async () => {
    const fixture = fakeDb({ mutationRows: [] });
    const repository = createManualCrawlRequestRepository({ db: fixture.db, evaluateEligibility: eligible });
    await expect(repository.heartbeat({ requestId: "request-1", ownerId: "worker-old",
      leaseDurationMs: LEASE_DURATION_MS })).rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    await expect(repository.finishSuccess({ requestId: "request-1", ownerId: "worker-old",
      crawlBatchId: "batch-1" })).rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    await expect(repository.finishFailed({ requestId: "request-1", ownerId: "worker-old",
      failureCode: "SOURCE_CRAWL_FAILED" })).rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    expect(fixture.calls.eventCreate).toHaveLength(0);
    expect(fixture.calls.raw.every((call: { sql: string }) => call.sql.includes("CURRENT_TIMESTAMP"))).toBe(true);
  });
});

type FakeOptions = {
  source?: { id: string; companyId: string; kind: "SOCIAL"; atsKind: "MOKA"; status: "VERIFIED_SCRAPABLE" } | null;
  createError?: unknown;
  claimRows?: unknown[];
  updateCount?: number;
  mutationRows?: unknown[];
  batch?: Record<string, unknown>;
};

function fakeDb(options: FakeOptions = {}): { db: ManualCrawlRequestDb; calls: Record<string, any> } {
  const calls: Record<string, any> = {
    sourceFind: [], requestFind: [], batchFind: [], requestCreate: [], requestUpdateMany: [], eventCreate: [], auditCreate: [], raw: [], transactionCount: 0
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
      return {
        id: "batch-1", kind: "MANUAL_SOURCE", status: "SUCCESS", plannedSourceIds: ["source-1"],
        sourceResults: [{ sourceId: "source-1", transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
          completenessState: "VERIFIED", atomicCommitState: "COMMITTED" }],
        ...options.batch
      };
    } },
    manualCrawlRequest: {
      async create(args: unknown) { calls.requestCreate.push(args); if (options.createError) throw options.createError; return { id: "request-1" }; },
      async findUnique(args: unknown) {
        calls.requestFind.push(args);
        return { id: "request-1", sourceId: "source-1", ownerId: "worker-1", status: "RUNNING" };
      },
      async updateMany(args: unknown) { calls.requestUpdateMany.push(args); return { count: options.updateCount ?? 1 }; }
    },
    manualCrawlRequestEvent: { async create(args: unknown) { calls.eventCreate.push(args); return { id: "event-1" }; } },
    adminAuditEvent: { async create(args: unknown) { calls.auditCreate.push(args); return { id: "audit-1" }; } },
    async $queryRawUnsafe(sql: string, ...values: unknown[]) {
      calls.raw.push({ sql, values });
      return sql.includes("WITH candidate") ? (options.claimRows ?? []) : (options.mutationRows ?? [{ id: "request-1" }]);
    }
  };
  const db: any = { async $transaction<T>(callback: (client: any) => Promise<T>) {
    calls.transactionCount += 1;
    return callback(tx);
  } };
  return { db, calls };
}
