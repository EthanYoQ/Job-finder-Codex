import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  runP0CrawlBatch,
  resolveP0CrawlBatchTerminalStatus,
  summarizePersistedBatchSourceResults,
  type P0CrawlBatchResult,
  type RunP0CrawlBatchDeps
} from "../../src/crawler/runCrawlBatch";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { buildDiscoverySourcePlanCandidates, buildStagedSourceCrawlPlans, expectedChannelSetHash, getPlanBySourceId, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import type { JobSnapshot } from "../../src/crawler/lifecycle";
import { candidateCompanies } from "../../src/data/companyRegistry";
import {
  executeAtomicSourceEvidenceCommit,
  type AtomicSourceEvidenceCommit,
  type PrismaIngestionTransactionClient
} from "../../src/db/ingestionRepository";
import { canonicalReleaseMembersSha256, releaseMembersFromPlans,
  type AuthoritativeReleaseMembershipArtifact } from "../../src/crawler/authoritativeReleaseMembership";
import { evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import type { PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { hashCanonicalJobKeySet } from "../../src/crawler/runtimeBatchIdentity";

const IDENTITY_BASE = {
  releaseCandidateId: "p0-rc-20260710-001",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  rosterSha256: "a".repeat(64),
  sourcePlanSha256: "b".repeat(64),
  sourceConfigSha256: "c".repeat(64),
  adapterBundleSha256: "d".repeat(64),
  batchKind: "SCHEDULED" as const,
  ownerId: "phase1-task4-test"
};

function identityForPlans(
  expectedPlans: readonly SourceCrawlPlan[],
  batchKind: "FULL_RELEASE" | "SCHEDULED" | "MANUAL_SOURCE" | "BASELINE" = "SCHEDULED"
) {
  const expectedPlannedSourceIds = expectedPlans.map((plan) => plan.source.id).sort();
  return {
    ...IDENTITY_BASE,
    batchKind,
    expectedPlannedSourceIds,
    expectedPlannedSourceSetSha256: createHash("sha256")
      .update(JSON.stringify(expectedPlannedSourceIds), "utf8")
      .digest("hex"),
    expectedPlannedSourceCount: expectedPlannedSourceIds.length
  };
}

const NOW = new Date("2026-07-08T01:00:00.000Z");
const CAPTURED_AT = "2026-07-08T01:05:00.000Z";
type AtomicCommitExecutor = NonNullable<RunP0CrawlBatchDeps["executeAtomicCommit"]>;
const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/crawler/fixtures"
);
const plans = buildDiscoverySourcePlanCandidates(candidateCompanies).map((plan) => {
  const expectedChannels = [{ channelId: `source:${plan.source.id}:default`, kind: "SOCIAL" as const }];
  return { ...plan, expectedChannels, expectedChannelSetHash: expectedChannelSetHash(expectedChannels) };
});

function readFixture(path: string): string {
  return readFileSync(resolve(fixtureDirectory, path), "utf8");
}

function planFor(sourceId: string): SourceCrawlPlan {
  const plan = getPlanBySourceId(plans, sourceId);

  if (!plan) {
    throw new Error(`Missing source crawl plan for ${sourceId}`);
  }

  return plan;
}

function makeJob(overrides: Partial<NormalizedJobRecord> = {}): NormalizedJobRecord {
  const sourceJobId = overrides.sourceJobId ?? "existing-job";

  return {
    companyId: "company-test",
    sourceId: "source-novartis-social",
    sourceKind: "SOCIAL",
    atsKind: "OFFICIAL_HTML",
    officialChineseCompanyName: "Test Pharma",
    officialTitle: `Medical role ${sourceJobId}`,
    officialUrl: `https://example.com/jobs/${sourceJobId}`,
    sourceJobId,
    locationRaw: "Shanghai",
    cities: ["Shanghai"],
    category: "医学事务",
    isBaseline: false,
    evidence: {
      officialEntryUrl: "https://example.com/jobs",
      officialChainEvidenceUrl: "https://example.com/careers",
      capturedAt: CAPTURED_AT
    },
    ...overrides
  };
}

function makeSnapshot(
  record: NormalizedJobRecord,
  overrides: Partial<JobSnapshot> = {}
): JobSnapshot {
  return {
    dedupeKey: buildJobDedupeKey(record),
    record,
    lifecycleStatus: "ACTIVE",
    missingSuccessfulCrawlCount: 0,
    firstSeenAt: "2026-07-07T00:00:00.000Z",
    lastSeenAt: "2026-07-07T12:00:00.000Z",
    ...overrides
  };
}

function strictSuccessfulFetch(plan: SourceCrawlPlan, sourceJobId = "later-job") {
  if (plan.adapterId !== "official-json" || plan.json?.jobsPath !== "jobs") {
    throw new Error(`Test helper requires a jobs-root official-json plan: ${plan.source.id}`);
  }
  const channelId = plan.expectedChannels?.[0]?.channelId;
  if (!channelId) throw new Error(`Test helper requires a bound channel: ${plan.source.id}`);
  const payload = {
    jobs: [{
      sourceJobId,
      title: `Role ${sourceJobId}`,
      officialUrl: `https://jobs.example.cn/${plan.source.id}/${sourceJobId}`,
      locationRaw: "上海",
      cities: ["上海"]
    }]
  };
  const body = JSON.stringify(payload);
  const logicalKey = `${plan.source.id}-page-0`;
  const fetchEvidence: PersistentSourceFetchEvidence = {
    captureTool: { name: "source-isolation-test", version: "1" },
    artifacts: [{
      id: logicalKey,
      logicalKey,
      kind: "PAGINATION_PAGE",
      channelId,
      requestedUrl: "https://jobs.example.cn/api/jobs",
      finalUrl: "https://jobs.example.cn/api/jobs",
      httpStatus: 200,
      contentType: "application/json",
      capturedAt: CAPTURED_AT,
      body,
      bodyRepresentation: "EXACT",
      extractorLocator: "json:total"
    }],
    pages: [{
      sequence: 0,
      artifactLogicalKey: logicalKey,
      channelId,
      requestedPage: 1,
      returnedPage: 1,
      requestedPageSize: 1,
      returnedPageSize: 1,
      rawJobIds: [sourceJobId],
      validJobIds: [sourceJobId],
      declaredTotal: 1,
      declaredCount: 1,
      declaredPages: 1,
      responseFingerprintSha256: createHash("sha256").update(body).digest("hex"),
      termination: "DECLARED_TOTAL_REACHED",
      anomalyCodes: [],
      capturedAt: CAPTURED_AT
    }],
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT",
      value: 1,
      artifactLogicalKey: logicalKey,
      extractorLocator: "json:total",
      scope: "CHANNEL",
      channelId
    },
    fetchCounts: {
      rawCount: 1,
      parsedCount: 1,
      validCount: 1,
      parseDiscardCount: 0,
      validationDiscardCount: 0
    },
    fetchLosses: []
  };
  const paginationEvaluation = evaluatePaginationEvidence({
    evidence: fetchEvidence,
    expectedChannelIds: [channelId],
    filteredOutput: true
  });
  return {
    ok: true as const,
    capturedAt: CAPTURED_AT,
    payload,
    fetchEvidence,
    paginationEvaluation
  };
}

function strategyDeclaredArtifactUrl(plan: SourceCrawlPlan): string {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json strategy plan");
  const entry = new URL(plan.source.officialEntryUrl);
  if (plan.officialJsonFetch?.kind === "phenom") return new URL("/widgets", entry.origin).toString();
  if (plan.officialJsonFetch?.kind === "beisen-zhiye-2022") {
    return new URL("/api/Jobad/GetJobAdPageList", entry.origin).toString();
  }
  throw new Error(`No declared-artifact URL fixture for ${plan.officialJsonFetch?.kind ?? "none"}`);
}

function inMemoryArchiveDeps(): Pick<RunP0CrawlBatchDeps, "archiveEvidence" | "verifyArchive"> {
  const archiveEvidence: NonNullable<RunP0CrawlBatchDeps["archiveEvidence"]> = async (request) => ({
    artifacts: request.artifacts.map((draft) => {
      const bytes = typeof draft.body === "string" ? Buffer.from(draft.body) : Buffer.from(draft.body);
      return {
        id: draft.id,
        logicalKey: draft.logicalKey,
        releaseCandidateId: request.releaseCandidateId,
        batchId: request.batchId,
        sourceId: request.sourceId,
        sourceResultId: request.sourceResultId,
        ...(draft.channelId ? { channelId: draft.channelId } : {}),
        kind: draft.kind,
        ...(draft.requestedUrl ? { requestedUrl: draft.requestedUrl } : {}),
        ...(draft.finalUrl ? { finalUrl: draft.finalUrl } : {}),
        ...(draft.httpStatus ? { httpStatus: draft.httpStatus } : {}),
        ...(draft.contentType ? { contentType: draft.contentType } : {}),
        capturedAt: new Date(draft.capturedAt),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteCount: bytes.byteLength,
        path: `test/${request.sourceId}/${draft.id}`,
        extractorLocator: draft.extractorLocator,
        captureToolName: request.captureTool.name,
        captureToolVersion: request.captureTool.version
      };
    }),
    orphanedFinalArtifacts: []
  });
  const verifyArchive: NonNullable<RunP0CrawlBatchDeps["verifyArchive"]> = async (request) => request.artifacts;
  return { archiveEvidence, verifyArchive };
}

async function captureRejection(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}

function fakeDb() {
  const calls = {
    batchesCreated: [] as unknown[],
    batchesUpdated: [] as unknown[],
    observations: [] as unknown[],
    jobs: [] as unknown[],
    pendingSourceResults: [] as unknown[],
    terminalSourceResults: [] as unknown[]
  };
  const sourceResults = new Map<string, Record<string, unknown>>();

  const crawlObservation = {
    create: vi.fn((args: unknown) => {
      calls.observations.push(args);
      return Promise.resolve(args);
    })
  };
  const job = {
    upsert: vi.fn((args: unknown) => {
      calls.jobs.push(args);
      return Promise.resolve(args);
    })
  };
  const terminalUpdateMany = vi.fn(async (args: unknown) => {
    calls.terminalSourceResults.push(args);
    const update = args as { where: Record<string, unknown>; data: Record<string, unknown> };
    const id = String(update.where.id ?? "");
    const row = sourceResults.get(id);
    if (!row || Object.entries(update.where).some(([key, value]) => row[key] !== value)) {
      return { count: 0 };
    }
    Object.assign(row, update.data);
    return { count: 1 };
  });

  const persistAtomicSourceResult = (result: AtomicSourceEvidenceCommit["sourceResult"]): void => {
    const row = sourceResults.get(result.id);
    if (!row || row.atomicCommitState !== "PENDING") {
      throw new Error("Expected matching fake PENDING source result");
    }
    Object.assign(row, result);
  };

  return {
    calls,
    createBatchId: () => "batch-1",
    $transaction: async <T>(
      operation: (transaction: PrismaIngestionTransactionClient) => Promise<T>,
      _options?: { maxWait?: number; timeout?: number }
    ): Promise<T> => operation({
      $queryRawUnsafe: async (_sql: string, ...values: unknown[]) => [{ id: values[0] }],
      crawlObservation,
      job,
      crawlBatch: {
        create: async (args: unknown) => {
          calls.batchesCreated.push(args);
          return args;
        }
      },
      crawlBatchSourceResult: {
        create: async (args: unknown) => {
          calls.pendingSourceResults.push(args);
          const data = { ...(args as { data: Record<string, unknown> }).data };
          sourceResults.set(String(data.id), data);
          return args;
        },
        updateMany: terminalUpdateMany
      },
      evidenceArtifact: { create: async (args: unknown) => args },
      paginationEvidence: { create: async (args: unknown) => args },
      lossLedgerEntry: { create: async (args: unknown) => args },
      transportAttemptEvidence: { create: async (args: unknown) => args },
      transportAttemptArtifact: { create: async (args: unknown) => args },
      lifecycleSetEvidenceMember: { create: async (args: unknown) => args }
    } as never),
    crawlBatch: {
      create: vi.fn((args: unknown) => {
        calls.batchesCreated.push(args);
        return Promise.resolve({ id: "batch-1" });
      }),
      update: vi.fn((args: unknown) => {
        calls.batchesUpdated.push(args);
        return Promise.resolve(args);
      })
    },
    crawlBatchSourceResult: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const row = sourceResults.get(args.where.id);
        return row ? { ...row } : null;
      }),
      findMany: vi.fn(async (args: { where: { releaseCandidateId: string; batchId: string } }) =>
        [...sourceResults.values()]
          .filter((row) => row.releaseCandidateId === args.where.releaseCandidateId &&
            row.batchId === args.where.batchId)
          .sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId)))
          .map((row) => ({
            sourceId: row.sourceId,
            transportState: row.transportState,
            adapterState: row.adapterState,
            completenessState: row.completenessState,
            atomicCommitState: row.atomicCommitState,
            failureCode: row.failureCode
          }))
      )
    },
    crawlObservation,
    job,
    terminalUpdateMany,
    persistAtomicSourceResult
  };
}

describe("runP0CrawlBatch", () => {
  it("derives terminal counters from persisted source rows instead of stale process counters", () => {
    const rows = [
      ...Array.from({ length: 13 }, (_, index) => ({
        sourceId: `verified-${index}`,
        transportState: "SUCCEEDED" as const,
        adapterState: "SUCCEEDED" as const,
        completenessState: "VERIFIED" as const,
        atomicCommitState: "COMMITTED" as const,
        failureCode: null
      })),
      ...Array.from({ length: 31 }, (_, index) => ({
        sourceId: `blocked-${index}`,
        transportState: "SUCCEEDED" as const,
        adapterState: "SUCCEEDED" as const,
        completenessState: "INCOMPLETE" as const,
        atomicCommitState: "COMMITTED" as const,
        failureCode: null
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        sourceId: `transport-${index}`,
        transportState: "FAILED" as const,
        adapterState: "SKIPPED" as const,
        completenessState: "FAILED" as const,
        atomicCommitState: "NOT_ATTEMPTED" as const,
        failureCode: "SOURCE_TRANSPORT_FAILED"
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        sourceId: `atomic-${index}`,
        transportState: "SUCCEEDED" as const,
        adapterState: "SUCCEEDED" as const,
        completenessState: "FAILED" as const,
        atomicCommitState: "ROLLED_BACK" as const,
        failureCode: "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT"
      }))
    ];

    expect(summarizePersistedBatchSourceResults(rows.map((row) => row.sourceId), rows)).toMatchObject({
      dueSourceCount: 51,
      transportSuccessfulSourceCount: 46,
      transportFailedSourceCount: 5,
      adapterSuccessfulSourceCount: 46,
      adapterFailedSourceCount: 0,
      completenessVerifiedSourceCount: 13,
      completenessIncompleteSourceCount: 31,
      atomicCommittedSourceCount: 44,
      atomicFailedSourceCount: 2,
      successfulSourceCount: 13,
      failedSourceCount: 7,
      blockedSourceCount: 31,
      skippedSourceCount: 0
    });
  });

  it("recovers a commit-boundary timeout only when the persisted COMMITTED result matches exactly", async () => {
    const plan = planFor("source-roche-china-social");
    const db = fakeDb();
    const p2028 = Object.assign(new Error("must not be persisted"), { code: "P2028" });
    const orphanLedger = vi.fn(async () => undefined);
    const inspectAtomicCommitOutcome = vi.fn(async () => ({ state: "COMMITTED_EXACT" as const }));
    const executeAtomicCommit = vi.fn(async () => { throw p2028; });
    const readPersistedBatchSourceResults = vi.fn(async () => [{
      sourceId: plan.source.id,
      transportState: "SUCCEEDED" as const,
      adapterState: "SUCCEEDED" as const,
      completenessState: "VERIFIED" as const,
      atomicCommitState: "COMMITTED" as const,
      failureCode: null
    }]);

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch: async () => strictSuccessfulFetch(plan),
      now: NOW,
      force: true,
      identity: identityForPlans([plan]),
      ...inMemoryArchiveDeps(),
      executeAtomicCommit,
      inspectAtomicCommitOutcome,
      readPersistedBatchSourceResults,
      recordOrphanedArtifacts: orphanLedger,
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      completenessVerifiedSourceCount: 1,
      atomicCommittedSourceCount: 1,
      failedSourceCount: 0
    });
    expect(executeAtomicCommit).toHaveBeenCalledOnce();
    expect(inspectAtomicCommitOutcome).toHaveBeenCalledOnce();
    expect(orphanLedger).not.toHaveBeenCalled();
    expect(db.calls.terminalSourceResults).toEqual([]);
  });

  it("classifies a confirmed PENDING timeout safely before orphaning and rollback", async () => {
    const plan = planFor("source-roche-china-social");
    const db = fakeDb();
    const p2028 = Object.assign(new Error("authorization: Bearer must-not-leak"), { code: "P2028" });
    const orphanLedger = vi.fn(async () => undefined);

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch: async () => strictSuccessfulFetch(plan),
      now: NOW,
      force: true,
      identity: identityForPlans([plan]),
      ...inMemoryArchiveDeps(),
      executeAtomicCommit: vi.fn(async () => { throw p2028; }),
      inspectAtomicCommitOutcome: async () => ({ state: "PENDING" }),
      readPersistedBatchSourceResults: async () => [{
        sourceId: plan.source.id,
        transportState: "SUCCEEDED",
        adapterState: "SUCCEEDED",
        completenessState: "FAILED",
        atomicCommitState: "ROLLED_BACK",
        failureCode: "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT"
      }],
      recordOrphanedArtifacts: orphanLedger,
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(result).toMatchObject({ status: "FAILED", atomicFailedSourceCount: 1, failedSourceCount: 1 });
    expect(orphanLedger).toHaveBeenCalledOnce();
    expect(db.calls.terminalSourceResults).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({
        failureCode: "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT",
        failureReason: "Atomic evidence processing failed"
      })
    }));
    expect(JSON.stringify(db.calls)).not.toContain("must-not-leak");
  });

  it.each(["CONFLICT", "INSPECTION_THROW"] as const)(
    "fails closed without orphaning when commit outcome inspection returns %s",
    async (inspectionCase) => {
      const plan = planFor("source-roche-china-social");
      const db = fakeDb();
      const orphanLedger = vi.fn(async () => undefined);
      const rejection = await captureRejection(() => runP0CrawlBatch([plan], {
        db,
        fetch: async () => strictSuccessfulFetch(plan),
        now: NOW,
        force: true,
        identity: identityForPlans([plan]),
        ...inMemoryArchiveDeps(),
        executeAtomicCommit: async () => { throw Object.assign(new Error("private commit detail"), { code: "P2028" }); },
        inspectAtomicCommitOutcome: async () => {
          if (inspectionCase === "INSPECTION_THROW") throw new Error("private inspection detail");
          return { state: "CONFLICT" };
        },
        readPersistedBatchSourceResults: async () => [{ sourceId: plan.source.id,
          transportState: "SUCCEEDED", adapterState: "SUCCEEDED", completenessState: "VERIFIED",
          atomicCommitState: "COMMITTED", failureCode: null }],
        recordOrphanedArtifacts: orphanLedger,
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      }));

      expect(rejection).toMatchObject({ code: "ATOMIC_COMMIT_OUTCOME_UNVERIFIED" });
      expect(orphanLedger).not.toHaveBeenCalled();
      expect(db.calls.terminalSourceResults).toEqual([]);
      expect(db.calls.batchesUpdated).toContainEqual(expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" })
      }));
      expect(JSON.stringify(db.calls)).not.toMatch(/private commit detail|private inspection detail/);
    }
  );

  it("does not orphan artifacts when a PENDING result concurrently becomes COMMITTED before rollback", async () => {
    const plan = planFor("source-roche-china-social");
    const db = fakeDb();
    const orphanLedger = vi.fn(async () => undefined);
    let attemptedCommit: AtomicSourceEvidenceCommit | undefined;
    db.terminalUpdateMany.mockImplementationOnce(async () => {
      if (!attemptedCommit) throw new Error("Expected attempted commit");
      db.persistAtomicSourceResult(attemptedCommit.sourceResult);
      return { count: 0 };
    });

    const rejection = await captureRejection(() => runP0CrawlBatch([plan], {
      db,
      fetch: async () => strictSuccessfulFetch(plan),
      now: NOW,
      force: true,
      identity: identityForPlans([plan]),
      ...inMemoryArchiveDeps(),
      executeAtomicCommit: async (commit) => {
        attemptedCommit = commit;
        throw Object.assign(new Error("commit boundary timeout"), { code: "P2028" });
      },
      inspectAtomicCommitOutcome: async () => ({ state: "PENDING" }),
      recordOrphanedArtifacts: orphanLedger,
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    }));

    expect(rejection).toMatchObject({ code: "ATOMIC_COMMIT_OUTCOME_UNVERIFIED" });
    expect(orphanLedger).not.toHaveBeenCalled();
    expect(db.calls.batchesUpdated).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED" })
    }));
  });

  it("uses contradictory persisted source rows instead of successful in-process counters", async () => {
    const plan = planFor("source-roche-china-social");
    const db = fakeDb();
    const result = await runP0CrawlBatch([plan], {
      db,
      fetch: async () => strictSuccessfulFetch(plan),
      now: NOW,
      force: true,
      identity: identityForPlans([plan]),
      ...inMemoryArchiveDeps(),
      executeAtomicCommit: async (commit) => db.persistAtomicSourceResult(commit.sourceResult),
      readPersistedBatchSourceResults: async () => [{ sourceId: plan.source.id,
        transportState: "FAILED", adapterState: "SKIPPED", completenessState: "FAILED",
        atomicCommitState: "NOT_ATTEMPTED", failureCode: "SOURCE_TRANSPORT_FAILED" }],
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(result).toMatchObject({ status: "INCOMPLETE", transportSuccessfulSourceCount: 0,
      transportFailedSourceCount: 1, atomicCommittedSourceCount: 0, failedSourceCount: 1 });
    expect(db.calls.batchesUpdated).toContainEqual(expect.objectContaining({ data: expect.objectContaining({
      transportSucceededCount: 0, transportFailedCount: 1, atomicCommittedCount: 0,
      failedSourceCount: 1
    }) }));
  });

  it.each(["MISSING", "EXTRA", "DUPLICATE", "PENDING"] as const)(
    "fails closed before batch finalization for %s persisted source rows",
    async (rowCase) => {
      const plan = planFor("source-roche-china-social");
      const db = fakeDb();
      const verified = { sourceId: plan.source.id, transportState: "SUCCEEDED" as const,
        adapterState: "SUCCEEDED" as const, completenessState: "VERIFIED" as const,
        atomicCommitState: "COMMITTED" as const, failureCode: null };
      const rows = rowCase === "MISSING" ? [] : rowCase === "EXTRA" ? [verified, { ...verified, sourceId: "unexpected-source" }]
        : rowCase === "DUPLICATE" ? [verified, { ...verified }]
          : [{ ...verified, transportState: "PENDING" as const, adapterState: "PENDING" as const,
            completenessState: "PENDING" as const, atomicCommitState: "PENDING" as const }];

      await expect(runP0CrawlBatch([plan], {
        db,
        fetch: async () => strictSuccessfulFetch(plan),
        now: NOW,
        force: true,
        identity: identityForPlans([plan]),
        ...inMemoryArchiveDeps(),
        executeAtomicCommit: async (commit) => db.persistAtomicSourceResult(commit.sourceResult),
        readPersistedBatchSourceResults: async () => rows,
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      })).rejects.toThrow("PERSISTED_BATCH_SUMMARY_UNAVAILABLE");
      expect(db.calls.batchesUpdated).toEqual([]);
    }
  );

  it("rejects a caller-forged one-source artifact with matching identity before fetch", async () => {
    const plan = planFor("source-hengrui-social");
    const identity = identityForPlans([plan], "FULL_RELEASE");
    const members = releaseMembersFromPlans([plan]);
    const content = { schemaVersion: 6 as const, kind: "FULL_RELEASE" as const,sourceTreeSha256:"8".repeat(64),runtimeTreeSha256:"7".repeat(64), releaseCandidateId: identity.releaseCandidateId,
      commitSha: identity.commitSha, rosterSha256: identity.rosterSha256,
      sourcePlanSha256: identity.sourcePlanSha256, sourceConfigSha256: identity.sourceConfigSha256,
      adapterBundleSha256: identity.adapterBundleSha256,
      oracleAuthority: { oracleRawFileSha256: "1".repeat(64), oracleContentSha256: "2".repeat(64),
        reviewProvenanceRootSha256: "3".repeat(64), hopChainProvenanceRootSha256: "4".repeat(64),
        reviewSignedPayloadSha256: "5".repeat(64), hopChainSignedPayloadSha256: "6".repeat(64),
        reviewKeyId: "review-key", hopChainKeyId: "hop-key", producerIdentity: "7".repeat(64) }, members,
      memberSetSha256: canonicalReleaseMembersSha256(members) };
    const forged = { ...content, contentSha256: createHash("sha256")
      .update(JSON.stringify(content)).digest("hex") } satisfies AuthoritativeReleaseMembershipArtifact;
    const fetch = vi.fn();
    await expect(runP0CrawlBatch([plan], { db: fakeDb(), fetch, now: NOW, identity,
      authoritativeReleaseMembership: forged, getPreviousJobs: async () => [],
      getRecentObservations: async () => [], isBaselineCompleted: async () => true } as never))
      .rejects.toThrow("startup membership authority");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a self-derived one-source FULL_RELEASE before persistence or fetch", async () => {
    const plan = planFor("source-hengrui-social");
    const db = fakeDb();
    const fetch = vi.fn();
    await expect(runP0CrawlBatch([plan], {
      db, fetch, now: NOW, identity: identityForPlans([plan], "FULL_RELEASE"),
      getPreviousJobs: async () => [], getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    })).rejects.toThrow("startup membership authority");
    expect(db.calls.batchesCreated).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires adapter-success accounting in the batch result contract", () => {
    expectTypeOf<P0CrawlBatchResult["adapterSuccessfulSourceCount"]>().toEqualTypeOf<number>();
  });

  it("rejects an unbound caller-constructed plan before batch persistence or fetch", async () => {
    const db = fakeDb();
    const fetch = vi.fn();
    const { expectedChannels: _channels, expectedChannelSetHash: _hash, ...unbound } =
      planFor("source-hengrui-social");
    await expect(runP0CrawlBatch([unbound as SourceCrawlPlan], {
      db, fetch, now: NOW, identity: identityForPlans([unbound as SourceCrawlPlan]),
      getPreviousJobs: async () => [], getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    })).rejects.toThrow("channel binding is required");
    expect(db.calls.batchesCreated).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing runtime identity before batch creation or source fetch", async () => {
    const db = fakeDb();
    const fetch = vi.fn();

    await expect(
      runP0CrawlBatch([planFor("source-hengrui-social")], {
        db,
        fetch,
        now: NOW,
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      } as never)
    ).rejects.toThrow("runtime identity");

    expect(db.calls.batchesCreated).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects blank runtime identity fields before batch creation", async () => {
    const db = fakeDb();

    await expect(
      runP0CrawlBatch([planFor("source-hengrui-social")], {
        db,
        fetch: vi.fn(),
        now: NOW,
        identity: { ...identityForPlans([planFor("source-hengrui-social")]), commitSha: "  " },
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      } as never)
    ).rejects.toThrow("commitSha");

    expect(db.calls.batchesCreated).toEqual([]);
  });

  it("rejects duplicate planned source ids before database writes", async () => {
    const db = fakeDb();
    const plan = planFor("source-hengrui-social");

    await expect(
      runP0CrawlBatch([plan, plan], {
        db,
        fetch: vi.fn(),
        now: NOW,
        identity: identityForPlans([plan]),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      } as never)
    ).rejects.toThrow("Duplicate planned source id");

    expect(db.calls.batchesCreated).toEqual([]);
  });

  it("rejects an empty FULL_RELEASE without complete trusted oracle authority before database writes", async () => {
    const db = fakeDb();

    await expect(
      runP0CrawlBatch([], {
        db,
        fetch: vi.fn(),
        now: NOW,
        identity: identityForPlans([], "FULL_RELEASE"),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      } as never)
    ).rejects.toThrow(/membership|oracle|trusted|authority/i);

    expect(db.calls.batchesCreated).toEqual([]);
  });

  it("rejects prefiltered FULL_RELEASE plans against the authoritative identity", async () => {
    const first = planFor("source-hengrui-social");
    const second = planFor("source-astrazeneca-social");
    const db = fakeDb();

    await expect(
      runP0CrawlBatch([first], {
        db,
        fetch: vi.fn(),
        now: NOW,
        identity: identityForPlans([first, second], "FULL_RELEASE"),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      } as never)
    ).rejects.toThrow("planned source");

    expect(db.calls.batchesCreated).toEqual([]);
  });

  it("rejects authoritative planned-source hash and count mismatches before writes", async () => {
    const plan = planFor("source-hengrui-social");

    for (const identity of [
      { ...identityForPlans([plan]), expectedPlannedSourceSetSha256: "0".repeat(64) },
      { ...identityForPlans([plan]), expectedPlannedSourceCount: 2 }
    ]) {
      const db = fakeDb();
      await expect(
        runP0CrawlBatch([plan], {
          db,
          fetch: vi.fn(),
          now: NOW,
          identity,
          getPreviousJobs: async () => [],
          getRecentObservations: async () => [],
          isBaselineCompleted: async () => true
        } as never)
      ).rejects.toThrow("planned source");
      expect(db.calls.batchesCreated).toEqual([]);
    }
  });

  it("persists complete runtime provenance and exact planned source-set identity", async () => {
    const db = fakeDb();
    const plan = planFor("source-astrazeneca-social");
    const identity = identityForPlans([plan]);

    await runP0CrawlBatch([plan], {
      db,
      fetch: vi.fn(),
      now: NOW,
      identity,
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [
        { crawledAt: new Date("2026-07-08T00:15:00.000Z"), successful: true }
      ],
      isBaselineCompleted: async () => true
    } as never);

    expect(db.calls.batchesCreated).toEqual([
      {
        data: expect.objectContaining({
          releaseCandidateId: identity.releaseCandidateId,
          commitSha: identity.commitSha,
          rosterSha256: identity.rosterSha256,
          sourcePlanSha256: identity.sourcePlanSha256,
          sourceConfigSha256: identity.sourceConfigSha256,
          adapterBundleSha256: identity.adapterBundleSha256,
          kind: identity.batchKind,
          plannedSourceIds: [plan.source.id],
          plannedSourceSetSha256: "2aa1d044e5809c3773f08f3c63a0f0e6827e71ab7360f2959829a9f8a90ab20e",
          plannedSourceCount: 1,
          transportSucceededCount: 0,
          transportFailedCount: 0,
          adapterSucceededCount: 0,
          adapterFailedCount: 0,
          completenessVerifiedCount: 0,
          completenessIncompleteCount: 0,
          atomicCommittedCount: 0,
          atomicFailedCount: 0,
          failedSourceCount: 0,
          blockedSourceCount: 0,
          skippedSourceCount: 0,
          ownerId: identity.ownerId,
          heartbeatAt: NOW,
          startedAt: NOW,
          status: "RUNNING"
        })
      }
    ]);
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({
        transportSucceededCount: 0,
        transportFailedCount: 0,
        adapterSucceededCount: 0,
        adapterFailedCount: 0,
        completenessVerifiedCount: 0,
        completenessIncompleteCount: 0,
        atomicCommittedCount: 0,
        atomicFailedCount: 0,
        failedSourceCount: 0,
        blockedSourceCount: 0,
        skippedSourceCount: 1,
        aggregateJobSetSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
        finishedAt: NOW,
        heartbeatAt: NOW,
        status: "INCOMPLETE"
      })
    });
  });

  it("makes aggregate job-key hashing order-stable and sensitive to equal-count key changes", async () => {
    const plan = planFor("source-hengrui-social");
    const runWithIds = async (ids: readonly string[]) => {
      const db = fakeDb();
      await runP0CrawlBatch([plan], {
        db,
        now: NOW,
        identity: identityForPlans([plan], "BASELINE"),
        force: true,
        fetch: async () => ({
          ok: true as const,
          capturedAt: CAPTURED_AT,
          completeness: {
            completenessStatus: "VERIFIED" as const,
            expectedJobCount: ids.length,
            completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
            completenessEvidenceUrl: plan.source.officialEntryUrl
          },
          payload: {
            success: true,
            data: {
              jobs: ids.map((id) => ({
                id,
                title: `Role ${id}`,
                officialUrl: `https://app.mokahr.com/apply/hengrui/11111#/job/${id}`,
                locationRaw: "上海市",
                cities: ["上海市"]
              }))
            }
          }
        }),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      } as never);

      return (db.calls.batchesUpdated[0] as { data: { aggregateJobSetSha256: string } }).data
        .aggregateJobSetSha256;
    };

    const first = await runWithIds(["job-a", "job-b"]);
    const reordered = await runWithIds(["job-b", "job-a"]);
    const changed = await runWithIds(["job-a", "job-c"]);

    expect(reordered).toBe(first);
    // Uncommitted source output must never affect the committed aggregate hash.
    expect(changed).toBe(first);
  });

  it("skips a source when the current schedule window is not due", async () => {
    const plan = planFor("source-astrazeneca-social");
    const db = fakeDb();
    const fetch = vi.fn(async () => ({
      ok: true as const,
      capturedAt: CAPTURED_AT,
      html: readFixture("astrazeneca-search-results.html")
    }));

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      identity: identityForPlans([plan]),
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [
        {
          crawledAt: new Date("2026-07-08T00:15:00.000Z"),
          successful: true
        }
      ],
      isBaselineCompleted: async () => true
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
    expect(result).toMatchObject({
      status: "INCOMPLETE",
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 0,
      adapterSuccessfulSourceCount: 0,
      successfulSourceCount: 0,
      failedSourceCount: 0,
      skippedSourceCount: 1
    });
    expect(db.calls.batchesCreated[0]).toEqual({
      data: expect.objectContaining({ startedAt: NOW, status: "RUNNING" })
    });
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({ finishedAt: NOW, status: "INCOMPLETE" })
    });
  });

  it("runs a source in the current schedule window when force is enabled", async () => {
    const plan = planFor("source-hengrui-social");
    const db = fakeDb();
    const fetch = vi.fn(async () => ({
      ok: true as const,
      capturedAt: CAPTURED_AT,
      completeness: {
        completenessStatus: "VERIFIED" as const,
        expectedJobCount: 1,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
        completenessEvidenceUrl: plan.source.officialEntryUrl,
        totalPages: 1,
        pageSize: 50,
        pagesVisited: 1
      },
      payload: {
        success: true,
        data: {
          jobs: [
            {
              id: "hengrui-job-1",
              title: "Research Chief",
              officialUrl: "https://app.mokahr.com/apply/hengrui/11111#/job/hengrui-job-1",
              locationRaw: "上海市",
              cities: ["上海市"]
            }
          ]
        }
      }
    }));

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      identity: identityForPlans([plan]),
      force: true,
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [
        {
          crawledAt: new Date("2026-07-08T00:15:00.000Z"),
          successful: true
        }
      ],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      plannedSourceCount: 1,
      dueSourceCount: 1,
      adapterSuccessfulSourceCount: 1,
      successfulSourceCount: 0,
      failedSourceCount: 1,
      skippedSourceCount: 0
    });
  });

  it("counts adapter success separately and finalizes incomplete when completeness is not verified", async () => {
    const plan = planFor("source-hengrui-social");
    const db = fakeDb();
    const fetch = vi.fn(async () => ({
      ok: true as const,
      capturedAt: CAPTURED_AT,
      completeness: {
        completenessStatus: "INCOMPLETE" as const,
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
        completenessEvidenceUrl: plan.source.officialEntryUrl,
        completenessBlockerReason: "Only one of two expected jobs was observed"
      },
      payload: {
        success: true,
        data: {
          jobs: [
            {
              id: "hengrui-job-1",
              title: "Research Chief",
              officialUrl: "https://app.mokahr.com/apply/hengrui/11111#/job/hengrui-job-1",
              locationRaw: "上海市",
              cities: ["上海市"]
            }
          ]
        }
      }
    }));

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      identity: identityForPlans([plan]),
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(result).toMatchObject({
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      adapterSuccessfulSourceCount: 1,
      successfulSourceCount: 0,
      failedSourceCount: 1,
      skippedSourceCount: 0
    });
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({ finishedAt: NOW, status: "FAILED" })
    });
  });

  it("keeps source failures fatal outside scheduled batches and keeps atomic failures fatal everywhere", () => {
    expect(resolveP0CrawlBatchTerminalStatus({
      batchKind: "FULL_RELEASE",
      failedSourceCount: 1,
      atomicFailedSourceCount: 0,
      hasExactSuccessfulDenominator: false
    })).toBe("FAILED");
    expect(resolveP0CrawlBatchTerminalStatus({
      batchKind: "SCHEDULED",
      failedSourceCount: 1,
      atomicFailedSourceCount: 0,
      hasExactSuccessfulDenominator: false
    })).toBe("INCOMPLETE");
    expect(resolveP0CrawlBatchTerminalStatus({
      batchKind: "SCHEDULED",
      failedSourceCount: 1,
      atomicFailedSourceCount: 1,
      hasExactSuccessfulDenominator: false
    })).toBe("FAILED");
  });

  it("does not succeed when one planned source is verified and another is skipped", async () => {
    const verifiedPlan = planFor("source-hengrui-social");
    const skippedPlan = planFor("source-astrazeneca-social");
    const db = fakeDb();
    const fetch = vi.fn(async (plan: SourceCrawlPlan) => {
      expect(plan).toBe(verifiedPlan);

      return {
        ok: true as const,
        capturedAt: CAPTURED_AT,
        completeness: {
          completenessStatus: "VERIFIED" as const,
          expectedJobCount: 1,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
          completenessEvidenceUrl: plan.source.officialEntryUrl
        },
        payload: {
          success: true,
          data: {
            jobs: [
              {
                id: "hengrui-job-1",
                title: "Research Chief",
                officialUrl: "https://app.mokahr.com/apply/hengrui/11111#/job/hengrui-job-1",
                locationRaw: "上海市",
                cities: ["上海市"]
              }
            ]
          }
        }
      };
    });

    const result = await runP0CrawlBatch([verifiedPlan, skippedPlan], {
      db,
      fetch,
      now: NOW,
      identity: identityForPlans([verifiedPlan, skippedPlan]),
      getPreviousJobs: async () => [],
      getRecentObservations: async (sourceId: string) =>
        sourceId === skippedPlan.source.id
          ? [
              {
                crawledAt: new Date("2026-07-08T00:15:00.000Z"),
                successful: true
              }
            ]
          : [],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      batchId: "batch-1",
      plannedSourceCount: 2,
      dueSourceCount: 1,
      adapterSuccessfulSourceCount: 1,
      successfulSourceCount: 0,
      failedSourceCount: 1,
      skippedSourceCount: 1
    });
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({ finishedAt: NOW, status: "FAILED" })
    });
  });

  it("runs due sources through fetch, lifecycle, and ingestion upserts", async () => {
    const plan = planFor("source-novartis-social");
    const db = fakeDb();
    const previousJob = makeJob({
      sourceId: plan.source.id,
      atsKind: plan.source.atsKind,
      officialChineseCompanyName: plan.company.officialChineseName,
      sourceJobId: "old-job",
      officialUrl: "https://www.novartis.com/careers/jobs/old-job"
    });
    const fetch = vi.fn(async (receivedPlan: SourceCrawlPlan) => {
      expect(receivedPlan).toBe(plan);
      return {
        ok: true as const,
        capturedAt: CAPTURED_AT,
        completeness: {
          completenessStatus: "VERIFIED" as const,
          expectedJobCount: 1,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
          completenessEvidenceUrl: plan.source.officialEntryUrl,
          totalPages: 1,
          pageSize: 1,
          pagesVisited: 1
        },
        html: readFixture("novartis-table.html")
      };
    });

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      identity: identityForPlans([plan]),
      getPreviousJobs: async (sourceId: string) =>
        sourceId === plan.source.id ? [makeSnapshot(previousJob)] : [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      adapterSuccessfulSourceCount: 1,
      successfulSourceCount: 0,
      failedSourceCount: 1,
      skippedSourceCount: 0
    });
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toHaveLength(0);
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({ finishedAt: NOW, status: "FAILED" })
    });
  });

  it("records failed observations without upserting lifecycle job changes", async () => {
    const plan = planFor("source-astrazeneca-social");
    const db = fakeDb();
    const previousJob = makeJob({
      sourceId: plan.source.id,
      atsKind: plan.source.atsKind,
      officialChineseCompanyName: plan.company.officialChineseName,
      sourceJobId: "previous-job",
      officialUrl: "https://careers.example.com/jobs/previous-job"
    });
    const fetchFailure = "temporary upstream 503";
    const fetch = vi.fn(async () => ({
      ok: false as const,
      capturedAt: CAPTURED_AT,
      failureReason: fetchFailure
    }));

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      identity: identityForPlans([plan]),
      getPreviousJobs: async () => [makeSnapshot(previousJob)],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      transportFailedSourceCount: 1,
      adapterSuccessfulSourceCount: 0,
      atomicFailedSourceCount: 0,
      successfulSourceCount: 0,
      failedSourceCount: 1,
      skippedSourceCount: 0
    });
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
    expect(db.calls.terminalSourceResults).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({
        transportState: "FAILED",
        adapterState: "SKIPPED",
        atomicCommitState: "NOT_ATTEMPTED",
        failureCode: "SOURCE_TRANSPORT_FAILED"
      })
    }));
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({ finishedAt: NOW, status: "INCOMPLETE" })
    });
  });

  it("isolates a thrown fetch failure and atomically commits the later due source", async () => {
    const failedPlan = planFor("source-astrazeneca-social");
    const successfulPlan = planFor("source-roche-china-social");
    const batchPlans = [failedPlan, successfulPlan];
    const db = fakeDb();
    const fetchError = new Error("first source network timeout");
    const previousFailedJob = makeJob({
      sourceId: failedPlan.source.id,
      atsKind: failedPlan.source.atsKind,
      officialChineseCompanyName: failedPlan.company.officialChineseName,
      sourceJobId: "failed-source-existing-job",
      officialUrl: "https://careers.example.cn/failed-source-existing-job"
    });
    const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async (commit) => {
      db.persistAtomicSourceResult(commit.sourceResult);
    });
    const fetch = vi.fn(async (plan: SourceCrawlPlan) => {
      if (plan.source.id === failedPlan.source.id) throw fetchError;
      return strictSuccessfulFetch(successfulPlan);
    });

    const result = await runP0CrawlBatch(batchPlans, {
      db,
      fetch,
      now: NOW,
      force: true,
      identity: identityForPlans(batchPlans),
      executeAtomicCommit,
      ...inMemoryArchiveDeps(),
      getPreviousJobs: async (sourceId) =>
        sourceId === failedPlan.source.id ? [makeSnapshot(previousFailedJob)] : [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(executeAtomicCommit).toHaveBeenCalledTimes(1);
    expect(executeAtomicCommit.mock.calls[0]![0].sourceResult.sourceId).toBe(successfulPlan.source.id);
    expect(executeAtomicCommit.mock.calls[0]![0].commands.every((command) =>
      command.type !== "UPSERT_JOB" || command.record.sourceId !== failedPlan.source.id)).toBe(true);
    expect(result).toEqual({
      status: "INCOMPLETE",
      batchId: "batch-1",
      plannedSourceCount: 2,
      dueSourceCount: 2,
      transportSuccessfulSourceCount: 1,
      transportFailedSourceCount: 1,
      adapterSuccessfulSourceCount: 1,
      adapterFailedSourceCount: 0,
      completenessVerifiedSourceCount: 0,
      completenessIncompleteSourceCount: 1,
      atomicCommittedSourceCount: 1,
      atomicFailedSourceCount: 0,
      successfulSourceCount: 0,
      failedSourceCount: 1,
      blockedSourceCount: 1,
      skippedSourceCount: 0
    });
    expect(db.calls.jobs).toEqual([]);
    expect((db.calls.batchesUpdated[0] as { data: { aggregateJobSetSha256: string } }).data
      .aggregateJobSetSha256).toBe(hashCanonicalJobKeySet([{
        sourceId: successfulPlan.source.id,
        jobKey: `${successfulPlan.source.id}:later-job`
      }]));
  });

  it("times out one source attempt and still commits the later due source", async () => {
    const timedOutPlan = planFor("source-astrazeneca-social");
    const successfulPlan = planFor("source-roche-china-social");
    const batchPlans = [timedOutPlan, successfulPlan];
    const db = fakeDb();
    const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async (commit) => {
      db.persistAtomicSourceResult(commit.sourceResult);
    });
    const fetch = vi.fn(async (plan: SourceCrawlPlan) => {
      if (plan.source.id === timedOutPlan.source.id) {
        return await new Promise<never>(() => undefined);
      }
      return strictSuccessfulFetch(successfulPlan);
    });

    const result = await runP0CrawlBatch(batchPlans, {
      db,
      fetch,
      now: NOW,
      force: true,
      sourceAttemptTimeoutMs: 25,
      identity: identityForPlans(batchPlans),
      executeAtomicCommit,
      ...inMemoryArchiveDeps(),
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(executeAtomicCommit).toHaveBeenCalledTimes(1);
    expect(executeAtomicCommit.mock.calls[0]![0].sourceResult.sourceId).toBe(successfulPlan.source.id);
    expect(result).toMatchObject({
      plannedSourceCount: 2,
      dueSourceCount: 2,
      transportFailedSourceCount: 1,
      atomicCommittedSourceCount: 1,
      failedSourceCount: 1
    });
    expect(db.calls.terminalSourceResults).toContainEqual(expect.objectContaining({
      where: expect.objectContaining({ sourceId: timedOutPlan.source.id }),
      data: expect.objectContaining({ transportState: "FAILED" })
    }));
  });

  it("isolates an adapter execution throw and commits the later due source", async () => {
    const failedPlan = planFor("source-qilu-social");
    const successfulPlan = planFor("source-roche-china-social");
    const batchPlans = [failedPlan, successfulPlan];
    const db = fakeDb();
    const adapterError = new Error("first source adapter exploded");
    const poisonedPayload = {};
    Object.defineProperty(poisonedPayload, "jobs", {
      enumerable: true,
      get: () => { throw adapterError; }
    });
    const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async (commit) => {
      db.persistAtomicSourceResult(commit.sourceResult);
    });

    const result = await runP0CrawlBatch(batchPlans, {
      db,
      fetch: async (plan) => plan.source.id === failedPlan.source.id
        ? { ok: true as const, capturedAt: CAPTURED_AT, payload: poisonedPayload }
        : strictSuccessfulFetch(successfulPlan),
      now: NOW,
      force: true,
      identity: identityForPlans(batchPlans),
      executeAtomicCommit,
      ...inMemoryArchiveDeps(),
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(executeAtomicCommit).toHaveBeenCalledTimes(1);
    expect(executeAtomicCommit.mock.calls[0]![0].sourceResult.sourceId).toBe(successfulPlan.source.id);
    expect(result).toMatchObject({
      status: "INCOMPLETE",
      plannedSourceCount: 2,
      dueSourceCount: 2,
      transportSuccessfulSourceCount: 2,
      transportFailedSourceCount: 0,
      adapterSuccessfulSourceCount: 1,
      adapterFailedSourceCount: 1,
      atomicCommittedSourceCount: 1,
      atomicFailedSourceCount: 0,
      failedSourceCount: 1,
      blockedSourceCount: 1
    });
  });

  it.each(["archive", "verification", "build", "atomic commit"] as const)(
    "isolates a source-local %s failure and commits the later due source",
    async (failureStage) => {
      const failedPlan = planFor("source-qilu-social");
      const successfulPlan = planFor("source-roche-china-social");
      const batchPlans = [failedPlan, successfulPlan];
      const db = fakeDb();
      const sourceError = new Error(`first source ${failureStage} failed`);
      const archiveDeps = inMemoryArchiveDeps();
      const archiveEvidence: NonNullable<RunP0CrawlBatchDeps["archiveEvidence"]> = vi.fn(
        async (request) => {
          if (failureStage === "archive" && request.sourceId === failedPlan.source.id) throw sourceError;
          return archiveDeps.archiveEvidence!(request);
        }
      );
      const verifyArchive: NonNullable<RunP0CrawlBatchDeps["verifyArchive"]> = vi.fn(
        async (request) => {
          if (failureStage === "verification" && request.sourceId === failedPlan.source.id) throw sourceError;
          if (failureStage === "build" && request.sourceId === failedPlan.source.id) {
            return request.artifacts.map((artifact: (typeof request.artifacts)[number]) => ({
              ...artifact,
              bodyRepresentation: "REDACTED"
            })) as never;
          }
          return archiveDeps.verifyArchive!(request);
        }
      );
      const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async (commit) => {
        if (failureStage === "atomic commit" && commit.sourceResult.sourceId === failedPlan.source.id) {
          throw sourceError;
        }
        db.persistAtomicSourceResult(commit.sourceResult);
      });

      const result = await runP0CrawlBatch(batchPlans, {
        db,
        fetch: async (plan) => strictSuccessfulFetch(plan),
        now: NOW,
        force: true,
        identity: identityForPlans(batchPlans),
        archiveEvidence,
        verifyArchive,
        executeAtomicCommit,
        recordOrphanedArtifacts: async () => undefined,
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      });

      expect(executeAtomicCommit.mock.calls.at(-1)![0].sourceResult.sourceId).toBe(successfulPlan.source.id);
      expect(result).toMatchObject({
        status: "FAILED",
        plannedSourceCount: 2,
        dueSourceCount: 2,
        transportSuccessfulSourceCount: 2,
        transportFailedSourceCount: 0,
        adapterSuccessfulSourceCount: 2,
        adapterFailedSourceCount: 0,
        completenessVerifiedSourceCount: 0,
        completenessIncompleteSourceCount: 1,
        atomicCommittedSourceCount: 1,
        atomicFailedSourceCount: 1,
        successfulSourceCount: 0,
        failedSourceCount: 1,
        blockedSourceCount: 1,
        skippedSourceCount: 0
      });
      expect((db.calls.batchesUpdated[0] as { data: { aggregateJobSetSha256: string } }).data
        .aggregateJobSetSha256).toBe(hashCanonicalJobKeySet([{
          sourceId: successfulPlan.source.id,
          jobKey: `${successfulPlan.source.id}:later-job`
        }]));
      const expectedFailureCode = {
        archive: "EVIDENCE_ARCHIVE_FAILED",
        verification: "EVIDENCE_VERIFICATION_FAILED",
        build: "ATOMIC_COMMIT_BUILD_FAILED",
        "atomic commit": "ATOMIC_EVIDENCE_COMMIT_FAILED"
      }[failureStage];
      expect(db.calls.terminalSourceResults).toContainEqual(expect.objectContaining({
        where: expect.objectContaining({ sourceId: failedPlan.source.id }),
        data: expect.objectContaining({
          failureCode: expectedFailureCode,
          failureReason: "Atomic evidence processing failed"
        })
      }));
    }
  );

  it("retains the source and terminalization errors when source-stage terminalization fails", async () => {
    const failedPlan = planFor("source-astrazeneca-social");
    const laterPlan = planFor("source-roche-china-social");
    const batchPlans = [failedPlan, laterPlan];
    const db = fakeDb();
    const sourceError = new Error("source fetch failed");
    const terminalError = new Error("terminal source write failed");
    db.terminalUpdateMany.mockRejectedValueOnce(terminalError);
    const fetch = vi.fn(async (plan: SourceCrawlPlan) => {
      if (plan.source.id === failedPlan.source.id) throw sourceError;
      return strictSuccessfulFetch(laterPlan);
    });

    const rejection = await captureRejection(() =>
      runP0CrawlBatch(batchPlans, {
        db,
        fetch,
        now: NOW,
        force: true,
        identity: identityForPlans(batchPlans),
        executeAtomicCommit: vi.fn(async () => undefined),
        ...inMemoryArchiveDeps(),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      })
    );

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors).toEqual([sourceError, terminalError]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when post-commit rollback terminalization cannot be confirmed", async () => {
    const failedPlan = planFor("source-qilu-social");
    const laterPlan = planFor("source-roche-china-social");
    const batchPlans = [failedPlan, laterPlan];
    const db = fakeDb();
    const atomicError = new Error("source atomic commit failed");
    const terminalError = new Error("terminal source write failed");
    const orphanLedger = vi.fn(async () => undefined);
    db.terminalUpdateMany.mockRejectedValueOnce(terminalError);
    const fetch = vi.fn(async (plan: SourceCrawlPlan) => strictSuccessfulFetch(plan));
    const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async (commit) => {
      if (commit.sourceResult.sourceId === failedPlan.source.id) throw atomicError;
    });

    const rejection = await captureRejection(() =>
      runP0CrawlBatch(batchPlans, {
        db,
        fetch,
        now: NOW,
        force: true,
        identity: identityForPlans(batchPlans),
        executeAtomicCommit,
        recordOrphanedArtifacts: orphanLedger,
        ...inMemoryArchiveDeps(),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      })
    );

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors).toEqual([
      expect.objectContaining({ code: "ATOMIC_COMMIT_OUTCOME_UNVERIFIED" }),
      new Error("PERSISTED_BATCH_SUMMARY_UNAVAILABLE")
    ]);
    expect(JSON.stringify(rejection)).not.toContain(terminalError.message);
    expect(orphanLedger).not.toHaveBeenCalled();
    expect(db.calls.batchesUpdated).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(executeAtomicCommit).toHaveBeenCalledTimes(1);
  });

  it("retains source, terminalization, and batch-finalization errors together", async () => {
    const failedPlan = planFor("source-astrazeneca-social");
    const laterPlan = planFor("source-roche-china-social");
    const batchPlans = [failedPlan, laterPlan];
    const db = fakeDb();
    const sourceError = new Error("source fetch failed");
    const terminalError = new Error("terminal source write failed");
    const finalizationError = new Error("batch finalization failed");
    db.terminalUpdateMany.mockRejectedValueOnce(terminalError);
    db.crawlBatch.update = vi.fn(async () => { throw finalizationError; });
    const fetch = vi.fn(async (plan: SourceCrawlPlan) => {
      if (plan.source.id === failedPlan.source.id) throw sourceError;
      return strictSuccessfulFetch(laterPlan);
    });

    const rejection = await captureRejection(() =>
      runP0CrawlBatch(batchPlans, {
        db,
        fetch,
        now: NOW,
        force: true,
        identity: identityForPlans(batchPlans),
        executeAtomicCommit: vi.fn(async () => undefined),
        ...inMemoryArchiveDeps(),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      })
    );

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors).toEqual([
      sourceError,
      terminalError,
      finalizationError
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns an incomplete scheduled batch when a thrown fetch failure is terminalized", async () => {
    const plan = planFor("source-astrazeneca-social");
    const db = fakeDb();
    const fetchError = new Error("network timeout");
    const fetch = vi.fn(async () => {
      throw fetchError;
    });

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      identity: identityForPlans([plan]),
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "INCOMPLETE", failedSourceCount: 1 });
    expect(db.calls.batchesCreated[0]).toEqual({
      data: expect.objectContaining({ startedAt: NOW, status: "RUNNING" })
    });
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({
        transportSucceededCount: 0,
        transportFailedCount: 1,
        adapterSucceededCount: 0,
        adapterFailedCount: 0,
        failedSourceCount: 1,
        finishedAt: NOW,
        status: "INCOMPLETE"
      })
    });
  });

  it("counts adapter throws after successful transport without inventing transport failure", async () => {
    const basePlan = planFor("source-astrazeneca-social");
    const adapterError = new Error("adapter exploded");
    const throwingPlan = { ...basePlan } as SourceCrawlPlan;
    Object.defineProperty(throwingPlan, "adapterId", { get: () => { throw adapterError; } });
    const db = fakeDb();

    await expect(
      runP0CrawlBatch([throwingPlan], {
        db,
        fetch: async () => ({ ok: true as const, capturedAt: CAPTURED_AT, html: "<html></html>" }),
        now: NOW,
        identity: identityForPlans([throwingPlan]),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      })
    ).rejects.toThrow(adapterError);

    expect(db.calls.batchesUpdated).toEqual([]);
  });

  it("counts wrong successful-fetch shape as transport success and adapter failure", async () => {
    const plan = planFor("source-hengrui-social");
    const db = fakeDb();

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch: async () => ({ ok: true as const, capturedAt: CAPTURED_AT, html: "<html></html>" }),
      now: NOW,
      identity: identityForPlans([plan]),
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(result).toMatchObject({
      status: "INCOMPLETE",
      transportSuccessfulSourceCount: 1,
      transportFailedSourceCount: 0,
      adapterSuccessfulSourceCount: 0,
      adapterFailedSourceCount: 1,
      atomicFailedSourceCount: 0,
      failedSourceCount: 1
    });
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.terminalSourceResults).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({
        transportState: "SUCCEEDED",
        adapterState: "FAILED",
        atomicCommitState: "NOT_ATTEMPTED",
        failureCode: "SOURCE_ADAPTER_FAILED"
      })
    }));
  });

  it("counts pre-read exceptions once without inventing stage failures", async () => {
    const plan = planFor("source-hengrui-social");
    const db = fakeDb();

    await expect(
      runP0CrawlBatch([plan], {
        db,
        fetch: vi.fn(),
        now: NOW,
        identity: identityForPlans([plan]),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => { throw new Error("state read failed"); },
        isBaselineCompleted: async () => true
      })
    ).rejects.toThrow("state read failed");

    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({
        transportFailedCount: 0,
        adapterFailedCount: 0,
        failedSourceCount: 1,
        status: "FAILED"
      })
    });
  });

  it("excludes rolled-back job keys from the terminal aggregate hash", async () => {
    const plan = planFor("source-hengrui-social");
    const db = fakeDb();
    db.$transaction = vi.fn(async () => { throw new Error("transaction rolled back"); });

    await expect(
      runP0CrawlBatch([plan], {
        db,
        now: NOW,
        identity: identityForPlans([plan]),
        force: true,
        fetch: async () => ({
          ok: true as const,
          capturedAt: CAPTURED_AT,
          completeness: {
            completenessStatus: "VERIFIED" as const,
            expectedJobCount: 1,
            completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
            completenessEvidenceUrl: plan.source.officialEntryUrl
          },
          payload: { success: true, data: { jobs: [{ id: "rolled-back", title: "Role", officialUrl: "https://example.com/rolled-back", locationRaw: "上海", cities: ["上海"] }] } }
        }),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      })
    ).rejects.toThrow("transaction rolled back");

    expect(db.calls.batchesUpdated).toEqual([]);
  });

  it("preserves the original source error when terminal finalization also fails", async () => {
    const plan = planFor("source-hengrui-social");
    const sourceError = new Error("source failed");
    const finalizationError = new Error("finalization failed");
    const db = fakeDb();
    db.crawlBatch.update = vi.fn(async () => { throw finalizationError; });

    let rejection: unknown;
    try {
      await runP0CrawlBatch([plan], {
        db,
        fetch: async () => { throw sourceError; },
        now: NOW,
        identity: identityForPlans([plan]),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors).toEqual([sourceError, finalizationError]);
  });

  it("preserves the original source error when the terminal clock also fails", async () => {
    const plan = planFor("source-hengrui-social");
    const sourceError = new Error("source failed");
    const clockError = new Error("terminal clock failed");
    const db = fakeDb();
    let clockCalls = 0;
    let rejection: unknown;

    try {
      await runP0CrawlBatch([plan], {
        db,
        fetch: async () => { throw sourceError; },
        now: () => {
          clockCalls += 1;
          if (clockCalls === 1) return NOW;
          throw clockError;
        },
        identity: identityForPlans([plan]),
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors).toEqual([sourceError, clockError]);
    expect(db.calls.batchesUpdated).toEqual([]);
  });

  it("finalizes the scheduled batch as incomplete for an undefined thrown source failure", async () => {
    const plan = planFor("source-astrazeneca-social");
    const db = fakeDb();
    const fetch = vi.fn(async () => {
      throw undefined;
    });
    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      identity: identityForPlans([plan]),
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(result).toMatchObject({ status: "INCOMPLETE", failedSourceCount: 1 });
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({ finishedAt: NOW, status: "INCOMPLETE" })
    });
  });

  it("uses globally unique deterministic artifact ids across sources, batches, and release candidates", async () => {
    const stagedPlans = buildStagedSourceCrawlPlans(candidateCompanies);
    const firstPlan = getPlanBySourceId(stagedPlans, "source-qilu-social")!;
    const secondPlan = getPlanBySourceId(stagedPlans, "source-roche-china-social")!;
    const archivedRows: Array<{
      id: string;
      logicalKey: string;
      releaseCandidateId: string;
      batchId: string;
      sourceId: string;
      sourceResultId: string;
      path: string;
    }> = [];
    const artifactRows: Array<Record<string, unknown>> = [];
    const paginationRows: Array<Record<string, unknown>> = [];
    const transportArtifactRows: Array<Record<string, unknown>> = [];
    const observationRows: Array<Record<string, unknown>> = [];
    const atomicErrors: string[] = [];
    const persistedArtifactIds = new Set<string>();
    const commits: Array<Parameters<AtomicCommitExecutor>[0]> = [];
    const archiveDeps = inMemoryArchiveDeps();

    const archiveEvidence: NonNullable<RunP0CrawlBatchDeps["archiveEvidence"]> = async (request) => {
      const archived = await archiveDeps.archiveEvidence!(request);
      archivedRows.push(...archived.artifacts);
      return archived;
    };
    const atomicTransaction = {
      evidenceArtifact: { create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = String(data.id);
        if (persistedArtifactIds.has(id)) throw new Error(`EvidenceArtifact_pkey duplicate: ${id}`);
        persistedArtifactIds.add(id);
        artifactRows.push(data);
      } },
      paginationEvidence: { create: async ({ data }: { data: Record<string, unknown> }) => {
        paginationRows.push(data);
      } },
      lossLedgerEntry: { create: async () => undefined },
      transportAttemptEvidence: { create: async () => undefined },
      transportAttemptArtifact: { create: async ({ data }: { data: Record<string, unknown> }) => {
        transportArtifactRows.push(data);
      } },
      crawlObservation: { create: async ({ data }: { data: Record<string, unknown> }) => {
        observationRows.push(data);
      } },
      job: { upsert: async () => undefined },
      lifecycleSetEvidenceMember: { create: async () => undefined },
      crawlBatchSourceResult: { updateMany: async () => ({ count: 1 }) }
    };
    const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async (commit) => {
      commits.push(commit);
      try {
        await executeAtomicSourceEvidenceCommit(commit, {
          $transaction: async <T>(operation: (value: typeof atomicTransaction) => Promise<T>) =>
            operation(atomicTransaction)
        });
      } catch (error) {
        atomicErrors.push(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
    const fetchWithSharedLogicalKeys = (plan: SourceCrawlPlan) => {
      const fetched = strictSuccessfulFetch(plan, `${plan.source.id}-job`);
      const channelId = plan.expectedChannels![0]!.channelId;
      const mainLogicalKey = "official-html-page-0000";
      fetched.fetchEvidence.artifacts[0]!.id = mainLogicalKey;
      fetched.fetchEvidence.artifacts[0]!.logicalKey = mainLogicalKey;
      const declaredArtifactUrl = strategyDeclaredArtifactUrl(plan);
      fetched.fetchEvidence.artifacts[0]!.requestedUrl = declaredArtifactUrl;
      fetched.fetchEvidence.artifacts[0]!.finalUrl = declaredArtifactUrl;
      fetched.fetchEvidence.pages[0]!.artifactLogicalKey = mainLogicalKey;
      fetched.fetchEvidence.declaredCompleteness!.artifactLogicalKey = mainLogicalKey;
      fetched.fetchEvidence.declaredCompleteness!.kind = "OFFICIAL_TOTAL_PAGES";
      const priorBody = JSON.stringify({ sourceId: plan.source.id, failed: true });
      const priorFetchEvidence: PersistentSourceFetchEvidence = {
        captureTool: { name: "source-isolation-test", version: "1" },
        artifacts: [{
          id: "phenom-entry-0000",
          logicalKey: "phenom-entry-0000",
          kind: "OFFICIAL_COMPANY_PAGE",
          requestedUrl: "https://jobs.example.cn/careers",
          finalUrl: "https://jobs.example.cn/careers",
          httpStatus: 200,
          contentType: "application/json",
          capturedAt: CAPTURED_AT,
          body: priorBody,
          bodyRepresentation: "EXACT",
          extractorLocator: "json:entry"
        }],
        pages: [],
        supportingArtifactOnlyFailure: { code: "HCM_DIRECT_FAILED" },
        fetchCounts: {
          rawCount: 0,
          parsedCount: 0,
          validCount: 0,
          parseDiscardCount: 0,
          validationDiscardCount: 0
        },
        fetchLosses: []
      };
      return {
        ...fetched,
        completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" as const },
        paginationEvaluation: evaluatePaginationEvidence({
          evidence: fetched.fetchEvidence,
          expectedChannelIds: [channelId],
          filteredOutput: true
        }),
        priorTransportAttempts: [{
          transport: "DIRECT_HTTP" as const,
          outcome: "FAILED" as const,
          code: "HCM_DIRECT_FAILED" as const,
          capturedAt: CAPTURED_AT,
          fetchEvidence: priorFetchEvidence
        }]
      };
    };
    const runs = [
      { plans: [firstPlan, secondPlan], batchId: "batch-shared-1", releaseCandidateId: "p0-rc-shared-1" },
      { plans: [firstPlan], batchId: "batch-shared-2", releaseCandidateId: "p0-rc-shared-1" },
      { plans: [firstPlan], batchId: "batch-shared-3", releaseCandidateId: "p0-rc-shared-2" }
    ];

    for (const run of runs) {
      const db = fakeDb();
      const result = await runP0CrawlBatch(run.plans, {
        db,
        fetch: async (plan) => fetchWithSharedLogicalKeys(plan),
        now: NOW,
        force: true,
        createBatchId: () => run.batchId,
        identity: { ...identityForPlans(run.plans), releaseCandidateId: run.releaseCandidateId },
        archiveEvidence,
        verifyArchive: archiveDeps.verifyArchive!,
        executeAtomicCommit: async (commit) => {
          await executeAtomicCommit(commit, db as never);
          db.persistAtomicSourceResult(commit.sourceResult);
        },
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      });
      expect(atomicErrors).toEqual([]);
      expect(result.atomicCommittedSourceCount).toBe(run.plans.length);
      expect(result.atomicFailedSourceCount).toBe(0);
    }

    expect(commits).toHaveLength(4);
    expect(archivedRows).toHaveLength(8);
    expect(artifactRows).toHaveLength(8);
    expect(paginationRows).toHaveLength(4);
    expect(transportArtifactRows).toHaveLength(4);
    expect(observationRows).toHaveLength(4);
    expect(new Set(archivedRows.map((artifact) => artifact.id)).size).toBe(8);
    expect(new Set(archivedRows.map((artifact) => artifact.logicalKey))).toEqual(
      new Set(["official-html-page-0000", "phenom-entry-0000"])
    );
    for (const archived of archivedRows) {
      const expectedId = createHash("sha256").update(JSON.stringify([
        "runtime-evidence-artifact-v1",
        archived.releaseCandidateId,
        archived.batchId,
        archived.sourceId,
        archived.sourceResultId,
        archived.logicalKey
      ]), "utf8").digest("hex");
      expect(archived.id).toBe(expectedId);
      expect(archived.id).toMatch(/^[0-9a-f]{64}$/);
      expect(archived.path).toContain(archived.id);
      const commit = commits.find((candidate) =>
        candidate.sourceResult.releaseCandidateId === archived.releaseCandidateId &&
        candidate.sourceResult.batchId === archived.batchId &&
        candidate.sourceResult.sourceId === archived.sourceId &&
        candidate.sourceResult.id === archived.sourceResultId
      )!;
      expect(commit.artifacts.find((artifact) => artifact.logicalKey === archived.logicalKey)?.id)
        .toBe(archived.id);
    }
    for (const row of paginationRows) {
      const artifact = artifactRows.find((candidate) =>
        candidate.releaseCandidateId === row.releaseCandidateId &&
        candidate.batchId === row.batchId &&
        candidate.sourceId === row.sourceId &&
        candidate.sourceResultId === row.sourceResultId &&
        archivedRows.find((archived) => archived.id === candidate.id)?.logicalKey === "official-html-page-0000"
      );
      expect(row.artifactId).toBe(artifact?.id);
    }
    for (const row of transportArtifactRows) {
      const artifact = archivedRows.find((candidate) =>
        candidate.releaseCandidateId === row.releaseCandidateId &&
        candidate.batchId === row.batchId &&
        candidate.sourceId === row.sourceId &&
        candidate.sourceResultId === row.sourceResultId &&
        candidate.logicalKey === "phenom-entry-0000"
      );
      expect(row.artifactId).toBe(artifact?.id);
    }
    for (const row of observationRows) {
      const artifact = archivedRows.find((candidate) =>
        candidate.releaseCandidateId === row.releaseCandidateId &&
        candidate.batchId === row.batchId &&
        candidate.sourceId === row.sourceId &&
        candidate.sourceResultId === row.sourceResultId &&
        candidate.logicalKey === "official-html-page-0000"
      );
      expect(row.officialEvidenceArtifactId).toBe(artifact?.id);
    }
  });
});
