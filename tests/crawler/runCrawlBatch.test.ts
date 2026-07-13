import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  runP0CrawlBatch,
  type P0CrawlBatchResult,
  type RunP0CrawlBatchDeps
} from "../../src/crawler/runCrawlBatch";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { buildDiscoverySourcePlanCandidates, expectedChannelSetHash, getPlanBySourceId, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import type { JobSnapshot } from "../../src/crawler/lifecycle";
import { candidateCompanies } from "../../src/data/companyRegistry";
import type { PrismaIngestionTransactionClient } from "../../src/db/ingestionRepository";
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

function fakeDb() {
  const calls = {
    batchesCreated: [] as unknown[],
    batchesUpdated: [] as unknown[],
    observations: [] as unknown[],
    jobs: [] as unknown[],
    pendingSourceResults: [] as unknown[],
    terminalSourceResults: [] as unknown[]
  };

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
    return { count: 1 };
  });

  return {
    calls,
    createBatchId: () => "batch-1",
    $transaction: async <T>(
      operation: (transaction: PrismaIngestionTransactionClient) => Promise<T>
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
          return args;
        },
        updateMany: terminalUpdateMany
      }
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
    crawlObservation,
    job,
    terminalUpdateMany
  };
}

describe("runP0CrawlBatch", () => {
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
      adapterSuccessfulSourceCount: 0,
      successfulSourceCount: 0,
      failedSourceCount: 1,
      skippedSourceCount: 0
    });
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({ finishedAt: NOW, status: "FAILED" })
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
    const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async () => undefined);
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
      status: "FAILED",
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
    const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async () => undefined);

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
      status: "FAILED",
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

  it.each(["archive", "verification", "atomic commit"] as const)(
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
          return archiveDeps.verifyArchive!(request);
        }
      );
      const executeAtomicCommit = vi.fn<AtomicCommitExecutor>(async (commit) => {
        if (failureStage === "atomic commit" && commit.sourceResult.sourceId === failedPlan.source.id) {
          throw sourceError;
        }
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
    }
  );

  it("aborts later sources when a failed source cannot be terminalized", async () => {
    const failedPlan = planFor("source-astrazeneca-social");
    const laterPlan = planFor("source-roche-china-social");
    const batchPlans = [failedPlan, laterPlan];
    const db = fakeDb();
    const terminalError = new Error("terminal source write failed");
    db.terminalUpdateMany.mockRejectedValue(terminalError);
    const fetch = vi.fn(async (plan: SourceCrawlPlan) => {
      if (plan.source.id === failedPlan.source.id) throw new Error("source fetch failed");
      return strictSuccessfulFetch(laterPlan);
    });
    let rejection: unknown;

    try {
      await runP0CrawlBatch(batchPlans, {
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
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(AggregateError);
    expect((rejection as AggregateError).errors[0]).toBe(terminalError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a failed batch when a thrown fetch failure is terminalized", async () => {
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
    expect(result).toMatchObject({ status: "FAILED", failedSourceCount: 1 });
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
        status: "FAILED"
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
      transportSuccessfulSourceCount: 1,
      transportFailedSourceCount: 0,
      adapterSuccessfulSourceCount: 0,
      adapterFailedSourceCount: 1,
      failedSourceCount: 1
    });
    expect(db.calls.observations).toEqual([]);
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

  it("finalizes the batch as failed for an undefined thrown source failure", async () => {
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

    expect(result).toMatchObject({ status: "FAILED", failedSourceCount: 1 });
    expect(db.calls.batchesUpdated[0]).toEqual({
      where: { id: "batch-1" },
      data: expect.objectContaining({ finishedAt: NOW, status: "FAILED" })
    });
  });
});
