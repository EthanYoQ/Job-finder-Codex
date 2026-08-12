import { describe, expect, it, vi } from "vitest";
import {
  ManualCrawlRequestRepositoryError,
  P0_MANUAL_CRAWL_SOURCE_IDS,
  createManualCrawlRequestRepository,
  type ManualCrawlRequestDb
} from "../../src/db/manualCrawlRequestRepository";
import { MANUAL_CRAWL_MAX_LEASE_DURATION_MS } from "../../src/domain/manualCrawlLeasePolicy";

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

  it.each([
    "source-sinopharm-social",
    "source-3sbio-social",
    "source-apeloa-social",
    "source-xinhua-pharma-social",
    "source-tianjin-pharma-social",
    "source-dongyangguang-social"
  ])("rejects %s because it is outside the frozen launch authority", async (sourceId) => {
    const fixture = fakeDb({ source: {
      id: sourceId,
      companyId: `company-${sourceId.slice("source-".length, -"-social".length)}`,
      kind: "SOCIAL",
      atsKind: "MOKA",
      status: "VERIFIED_SCRAPABLE"
    } });
    await expect(createManualCrawlRequestRepository({ db: fixture.db }).enqueue({
      sourceId, requestedById: "admin", ip: "ip", userAgent: "ua"
    })).rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(fixture.calls.requestCreate).toHaveLength(0);
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
    expect(calls.raw[0].sql).toContain("clock_timestamp()");
    expect(calls.raw[0].sql).toContain("INTERVAL '1 millisecond'");
    expect(calls.raw[0].values.slice(0, 2)).toEqual(["worker-1", LEASE_DURATION_MS]);
    expect(calls.raw[0].sql).toContain('JOIN "RecruitmentSource"');
    expect(calls.raw[0].values[2]).toEqual(P0_MANUAL_CRAWL_SOURCE_IDS);
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
    expect(calls.raw[0].sql).toContain('source."id" = ANY($3::text[])');
  });

  it("re-resolves the claim authority for every queue claim", async () => {
    const fixture = fakeDb({ claimRows: [] });
    const resolveClaimableSourceIds = vi.fn()
      .mockResolvedValueOnce(["source-roche-china-social"])
      .mockResolvedValueOnce(["source-pfizer-china-social"]);
    const repository = createManualCrawlRequestRepository({
      db: fixture.db,
      evaluateEligibility: eligible,
      resolveClaimableSourceIds
    });

    await repository.claimNext({ ownerId: "worker", leaseDurationMs: LEASE_DURATION_MS });
    await repository.claimNext({ ownerId: "worker", leaseDurationMs: LEASE_DURATION_MS });

    expect(resolveClaimableSourceIds).toHaveBeenCalledTimes(2);
    expect(fixture.calls.raw.map((call: { values: unknown[] }) => call.values[2])).toEqual([
      ["source-roche-china-social"], ["source-pfizer-china-social"]
    ]);
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
    await expect(repository.claimNext({ ownerId: "worker", leaseDurationMs: MANUAL_CRAWL_MAX_LEASE_DURATION_MS }))
      .resolves.toBeNull();
    await expect(repository.claimNext({ ownerId: "worker", leaseDurationMs: MANUAL_CRAWL_MAX_LEASE_DURATION_MS + 1 }))
      .rejects.toMatchObject({ code: "INVALID_OWNER_OR_LEASE" });
    await expect(repository.claimNext({ ownerId: "worker", leaseDurationMs: Number.MAX_SAFE_INTEGER }))
      .rejects.toMatchObject({ code: "INVALID_OWNER_OR_LEASE" });
    expect(fixture.calls.transactionCount).toBe(1);
  });

  it("heartbeats only a RUNNING request owned by the caller", async () => {
    const wrong = fakeDb({ mutationRows: [] });
    const repository = createManualCrawlRequestRepository({ db: wrong.db, evaluateEligibility: eligible });
    await expect(repository.heartbeat({ requestId: "request-1", ownerId: "other", leaseDurationMs: LEASE_DURATION_MS }))
      .rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    expect(wrong.calls.eventCreate).toHaveLength(0);
    expect(wrong.calls.raw[0].sql).toMatch(/leaseExpiresAt"\s*>\s*clock_timestamp\(\)/);
    expect(wrong.calls.raw[0].sql).toContain('"heartbeatAt" = clock_timestamp()');
  });

  it("finishes successfully with an owned RUNNING CAS and MANUAL_SOURCE batch binding", async () => {
    const { db, calls } = fakeDb();
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await repository.finishSuccess({ requestId: "request-1", ownerId: "worker-1", crawlBatchId: "batch-1" });
    expect(calls.requestFind).toHaveLength(0);
    expect(calls.batchFind).toHaveLength(0);
    expect(calls.raw.at(-1).sql).toMatch(/leaseExpiresAt"\s*>\s*clock_timestamp\(\)/);
    expect(calls.raw.at(-1).sql).toContain('"finishedAt" = clock_timestamp()');
    expect(calls.raw.at(-1).values).toEqual(["request-1", "worker-1", "batch-1"]);
    expect(calls.raw).toHaveLength(4);
    expect(calls.raw[0].sql).toMatch(/FROM "ManualCrawlRequest"[\s\S]+FOR UPDATE/);
    expect(calls.raw[1].sql).toMatch(/FROM "CrawlBatch"[\s\S]+FOR UPDATE/);
    expect(calls.raw[1].sql).toContain('"ownerId" = $2');
    expect(calls.raw[1].sql).toContain('"plannedSourceIds" = jsonb_build_array($4::text)');
    expect(calls.raw[2].sql).toMatch(/FROM "CrawlBatchSourceResult"[\s\S]+FOR UPDATE/);
    expect(calls.raw[3].sql).toMatch(/^\s*UPDATE "ManualCrawlRequest"/);
    expect(calls.eventCreate[0]).toEqual({ data: expect.objectContaining({
      eventType: "SUCCEEDED", actor: "SYSTEM", ownerId: "worker-1", fromStatus: "RUNNING", toStatus: "SUCCESS"
    }) });
  });

  it.each([
    ["different source", { plannedSourceIds: ["source-2"] }],
    ["failed batch", { status: "FAILED" }],
    ["batch bound to another request", { manualCrawlRequestId: "request-other" }],
    ["batch owned by an old worker", { ownerId: "worker-old" }],
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
    expect(fixture.calls.raw.length).toBeGreaterThanOrEqual(2);
    expect(fixture.calls.raw.some((call: { sql: string }) => /^\s*UPDATE "ManualCrawlRequest" AS request/.test(call.sql)))
      .toBe(false);
    expect(fixture.calls.eventCreate).toHaveLength(0);
  });

  it("stores only an allow-listed safe error code and never a stack or secret", async () => {
    const { db, calls } = fakeDb();
    const repository = createManualCrawlRequestRepository({ db, evaluateEligibility: eligible });
    await repository.finishFailed({ requestId: "request-1", ownerId: "worker-1", failureCode: "SOURCE_CRAWL_FAILED" });
    expect(calls.raw[0].sql).toMatch(/leaseExpiresAt"\s*>\s*clock_timestamp\(\)/);
    expect(calls.raw[0].sql).toContain('"finishedAt" = clock_timestamp()');
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
    const fixture = fakeDb({ mutationRows: [], requestLockRows: [] });
    const repository = createManualCrawlRequestRepository({ db: fixture.db, evaluateEligibility: eligible });
    await expect(repository.heartbeat({ requestId: "request-1", ownerId: "worker-old",
      leaseDurationMs: LEASE_DURATION_MS })).rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    await expect(repository.finishSuccess({ requestId: "request-1", ownerId: "worker-old",
      crawlBatchId: "batch-1" })).rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    await expect(repository.finishFailed({ requestId: "request-1", ownerId: "worker-old",
      failureCode: "SOURCE_CRAWL_FAILED" })).rejects.toMatchObject({ code: "OWNERSHIP_LOST" });
    expect(fixture.calls.eventCreate).toHaveLength(0);
    expect(fixture.calls.raw.every((call: { sql: string }) => call.sql.includes("clock_timestamp()"))).toBe(true);
  });
});

type FakeOptions = {
  source?: { id: string; companyId: string; kind: "SOCIAL"; atsKind: "MOKA"; status: "VERIFIED_SCRAPABLE" } | null;
  createError?: unknown;
  claimRows?: unknown[];
  updateCount?: number;
  mutationRows?: unknown[];
  requestLockRows?: unknown[];
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
        id: "batch-1", kind: "MANUAL_SOURCE", status: "SUCCESS", ownerId: "worker-1",
        manualCrawlRequestId: "request-1",
        plannedSourceIds: ["source-1"],
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
      if (sql.includes("WITH candidate")) return options.claimRows ?? [];
      if (sql.includes('SELECT "id", "sourceId" FROM "ManualCrawlRequest"')) {
        return options.requestLockRows ?? [{ id: "request-1", sourceId: "source-1" }];
      }
      const batch = {
        id: "batch-1", kind: "MANUAL_SOURCE", status: "SUCCESS", ownerId: "worker-1",
        manualCrawlRequestId: "request-1", plannedSourceIds: ["source-1"],
        sourceResults: [{ sourceId: "source-1", transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
          completenessState: "VERIFIED", atomicCommitState: "COMMITTED" }],
        ...options.batch
      } as Record<string, any>;
      if (sql.includes('SELECT "id" FROM "CrawlBatch"')) {
        const [requestId, ownerId, batchId, sourceId] = values;
        const valid = batch.id === batchId && batch.kind === "MANUAL_SOURCE" && batch.status === "SUCCESS" &&
          batch.ownerId === ownerId && batch.manualCrawlRequestId === requestId &&
          Array.isArray(batch.plannedSourceIds) && batch.plannedSourceIds.length === 1 &&
          batch.plannedSourceIds[0] === sourceId;
        return valid ? [{ id: batch.id }] : [];
      }
      if (sql.includes('FROM "CrawlBatchSourceResult"')) return batch.sourceResults;
      return options.mutationRows ?? [{ id: "request-1" }];
    }
  };
  const db: any = { async $transaction<T>(callback: (client: any) => Promise<T>) {
    calls.transactionCount += 1;
    return callback(tx);
  } };
  return { db, calls };
}
