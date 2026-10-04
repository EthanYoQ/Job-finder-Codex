import { describe, expect, it, vi } from "vitest";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { verifyAtomicRuntimeCommitAttestation } from "../../src/crawler/runtimeAtomicEvidence";
import { runP0CrawlBatch } from "../../src/crawler/runCrawlBatch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { executeAtomicSourceEvidenceCommit } from "../../src/db/ingestionRepository";
import { archiveSourceEvidence, verifyArchivedSourceEvidence, ArtifactArchiveError } from "../../src/crawler/artifactArchive";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeBatchIdentity } from "../../src/crawler/runtimeBatchIdentity";
import {
  buildStagedSourceCrawlPlans,
  expectedChannelSetHash,
  sourcePlanConfigSha256,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { sourcePlanOracleConfigSha256 } from "../../src/crawler/independentSourceSurfaceOracle";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createNovoSingleJobHttp } from "../helpers/novoSingleJobFixture";
import { createOfficialJsonRenderedTraversalValidation } from "../../src/crawler/traversalCertificate";
import {
  irreversibleOfficialJsonEvidenceId,
  persistentOfficialJsonJobId
} from "../../src/crawler/officialJsonEvidence";

const sha = "a".repeat(64);

function channelBound(plan: SourceCrawlPlan): SourceCrawlPlan {
  const expectedChannels = [{ channelId: `source:${plan.source.id}:default`, kind: "SOCIAL" as const }];
  return { ...plan, source: { ...plan.source, surfaceId: plan.source.surfaceId ?? `surface:${plan.source.id}` },
    expectedChannels, expectedChannelSetHash: expectedChannelSetHash(expectedChannels),
    transportPolicy: plan.transportPolicy ?? { primary: "DIRECT_HTTP" } };
}

describe("runtime atomic evidence planning", () => {
  it("creates an exact PENDING tuple for every planned source", () => {
    const identity: RuntimeBatchIdentity = {
      releaseCandidateId: "p0-rc-20260710-001", commitSha: sha, rosterSha256: sha,
      sourcePlanSha256: sha, sourceConfigSha256: sha, adapterBundleSha256: sha,
      batchKind: "FULL_RELEASE", ownerId: "owner-1",
      expectedPlannedSourceIds: ["source-1"], expectedPlannedSourceSetSha256: sha,
      expectedPlannedSourceCount: 1
    };
    const plan = channelBound({
      adapterId: "official-json", company: { id: "company-1", officialChineseName: "公司" },
      source: { id: "source-1", companyId: "company-1", kind: "SOCIAL", atsKind: "OFFICIAL_JSON",
        status: "VERIFIED_SCRAPABLE", officialEntryUrl: "https://example.com/jobs",
        officialChainEvidenceUrl: "https://example.com/jobs" },
      json: { jobsPath: "jobs", fields: { officialTitle: "title", officialUrl: "url", locationRaw: "location" } }
    } as SourceCrawlPlan);

    const planned = buildPendingRuntimeBatch("batch-1", [plan], identity, new Date("2026-07-10T00:00:00Z"));

    expect(planned.sources).toHaveLength(1);
    expect(planned.sources[0]).toMatchObject({
      id: "batch-1--source-1", sourceId: "source-1", startedAt: new Date("2026-07-10T00:00:00Z")
    });
    expect(planned.sources[0]?.sourceConfigHash).toMatch(/^[0-9a-f]{64}$/);
    expect(planned.sources[0]?.sourceConfigHash).toBe(sourcePlanConfigSha256(plan));
    const preSharedHelperDigest = "5215aa58bd349fe36a276470433b667d8fc82e57980da04f5ecebb5817b88979";
    expect(sourcePlanConfigSha256(plan)).toBe(preSharedHelperDigest);
    expect(sourcePlanOracleConfigSha256(plan)).toBe(preSharedHelperDigest);
    expect(planned.sources[0]?.adapterVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(planned.sources[0]?.officialEntryId).toBeNull();
    expect(planned.sources[0]?.officialSurfaceIds).toEqual([]);
    expect(planned.sources[0]?.officialChannelIds).toEqual([]);
  });

  it("binds scheduled staged sources to the canonical official surface and channels", () => {
    const expectedChannels = [{ channelId: "channel-1", kind: "SOCIAL" as const }];
    const plan = {
      adapterId: "official-json" as const,
      executionAuthority: "STAGED" as const,
      company: { id: "company-1", officialChineseName: "公司" },
      source: { id: "source-1", companyId: "company-1", kind: "SOCIAL" as const,
        atsKind: "OFFICIAL_JSON" as const, status: "VERIFIED_SCRAPABLE" as const,
        officialEntryUrl: "https://example.com/jobs", officialChainEvidenceUrl: "https://example.com/jobs",
        surfaceId: "surface-1" },
      expectedChannels,
      expectedChannelSetHash: expectedChannelSetHash(expectedChannels),
      json: { jobsPath: "jobs", fields: { officialTitle: "title", officialUrl: "url", locationRaw: "location" } }
    } satisfies SourceCrawlPlan;
    const identity: RuntimeBatchIdentity = {
      releaseCandidateId: "p0-rc-20260710-001", commitSha: sha, rosterSha256: sha,
      sourcePlanSha256: sha, sourceConfigSha256: sha, adapterBundleSha256: sha,
      batchKind: "SCHEDULED", ownerId: "owner-1", expectedPlannedSourceIds: ["source-1"],
      expectedPlannedSourceSetSha256: sha, expectedPlannedSourceCount: 1
    };

    const pending = buildPendingRuntimeBatch(
      "batch-1", [plan], identity, new Date("2026-07-10T00:00:00Z")
    ).sources[0]!;

    expect(pending).toMatchObject({
      officialEntryId: null,
      officialSurfaceIds: ["surface-1"],
      officialChannelIds: ["channel-1"]
    });
  });

  it("hashes the complete source plan canonically and changes for config or channel changes", () => {
    const plan = channelBound({
      adapterId: "official-json", company: { id: "company-1", officialChineseName: "公司" },
      source: { id: "source-1", companyId: "company-1", kind: "SOCIAL", atsKind: "OFFICIAL_JSON",
        status: "VERIFIED_SCRAPABLE", officialEntryUrl: "https://example.com/jobs",
        officialChainEvidenceUrl: "https://example.com/jobs" },
      json: { jobsPath: "jobs", fields: { officialTitle: "title", officialUrl: "url", locationRaw: "location" } }
    } as SourceCrawlPlan);
    if (plan.adapterId !== "official-json") throw new Error("Expected official JSON plan");
    const reordered = {
      expectedChannelSetHash: plan.expectedChannelSetHash,
      expectedChannels: plan.expectedChannels,
      json: plan.json,
      source: { ...plan.source },
      company: { ...plan.company },
      adapterId: plan.adapterId,
      transportPolicy: plan.transportPolicy
    } as SourceCrawlPlan;

    expect(sourcePlanConfigSha256(reordered)).toBe(sourcePlanConfigSha256(plan));
    expect(sourcePlanConfigSha256({
      ...plan,
      json: { ...plan.json, defaultCategory: "销售" }
    } as SourceCrawlPlan)).not.toBe(sourcePlanConfigSha256(plan));
    expect(sourcePlanConfigSha256({
      ...plan,
      source: { ...plan.source, officialEntryUrl: "https://example.com/changed" }
    })).not.toBe(sourcePlanConfigSha256(plan));
    expect(sourcePlanConfigSha256({
      ...plan,
      expectedChannels: [{ ...plan.expectedChannels![0]!, channelId: "changed-channel" }]
    })).not.toBe(sourcePlanConfigSha256(plan));
  });

  it("persists every PENDING source result before the first fetch", async () => {
    const events: string[] = [];
    const plan = channelBound({
      adapterId: "official-json", company: { id: "company-1", officialChineseName: "公司" },
      source: { id: "source-1", companyId: "company-1", kind: "SOCIAL", atsKind: "OFFICIAL_JSON",
        status: "VERIFIED_SCRAPABLE", officialEntryUrl: "https://example.com/jobs",
        officialChainEvidenceUrl: "https://example.com/jobs" },
      json: { jobsPath: "jobs", fields: { officialTitle: "title", officialUrl: "url", locationRaw: "location" } }
    } as SourceCrawlPlan);
    const expectedPlannedSourceIds = [plan.source.id];
    const identity = {
      releaseCandidateId: "p0-rc-20260710-001", commitSha: sha, rosterSha256: sha,
      sourcePlanSha256: sha, sourceConfigSha256: sha, adapterBundleSha256: sha,
      batchKind: "SCHEDULED" as const, ownerId: "owner-1", expectedPlannedSourceIds,
      expectedPlannedSourceSetSha256: (await import("node:crypto")).createHash("sha256")
        .update(JSON.stringify(expectedPlannedSourceIds)).digest("hex"), expectedPlannedSourceCount: 1
    };
    const transaction = {
      crawlBatch: { create: async () => { events.push("batch"); } },
      crawlBatchSourceResult: {
        create: async () => { events.push("pending"); },
        updateMany: async () => ({ count: 1 })
      },
      crawlObservation: { create: async () => undefined }, job: { upsert: async () => undefined },
      evidenceArtifact: { create: async () => undefined }, paginationEvidence: { create: async () => undefined },
      lossLedgerEntry: { create: async () => undefined }, transportAttemptEvidence: { create: async () => undefined },
      transportAttemptArtifact: { create: async () => undefined }
    };
    const db = {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) => operation(transaction),
      crawlBatch: { update: async () => undefined }
    };

    await runP0CrawlBatch([plan], {
      db: db as never, identity, now: new Date("2026-07-10T00:00:00Z"),
      createBatchId: () => "batch-atomic-1",
      fetch: async () => { events.push("fetch"); return { ok: false, capturedAt: "2026-07-10T00:00:01Z", failureReason: "UPSTREAM_FAILED" }; },
      readPersistedBatchSourceResults: async () => [{ sourceId: plan.source.id,
        transportState: "FAILED", adapterState: "SKIPPED", completenessState: "FAILED",
        atomicCommitState: "NOT_ATTEMPTED", failureCode: "SOURCE_TRANSPORT_FAILED" }],
      getPreviousJobs: async () => [], getRecentObservations: async () => [], isBaselineCompleted: async () => true
    });

    expect(events.slice(0, 3)).toEqual(["batch", "pending", "fetch"]);
  });

  it("terminally closes current and every unprocessed PENDING tuple after a pre-read failure", async () => {
    const base = channelBound({
      adapterId: "official-json", company: { id: "company-1", officialChineseName: "公司" },
      source: { id: "source-1", companyId: "company-1", kind: "SOCIAL", atsKind: "OFFICIAL_JSON",
        status: "VERIFIED_SCRAPABLE", officialEntryUrl: "https://example.com/jobs",
        officialChainEvidenceUrl: "https://example.com/jobs" },
      json: { jobsPath: "jobs", fields: { officialTitle: "title", officialUrl: "url", locationRaw: "location" } }
    } as SourceCrawlPlan);
    const second = channelBound({ ...base, source: { ...base.source, id: "source-2" } } as SourceCrawlPlan);
    const ids = ["source-1", "source-2"];
    const hash = (await import("node:crypto")).createHash("sha256").update(JSON.stringify(ids)).digest("hex");
    const terminal: Array<Record<string, unknown>> = [];
    const tx = { crawlBatch: { create: async () => undefined }, crawlBatchSourceResult: {
      create: async () => undefined, updateMany: async (args: { where: Record<string, unknown> }) => {
        terminal.push(args.where); return { count: 1 };
      } }, crawlObservation: { create: async () => undefined }, job: { upsert: async () => undefined } };
    const db = { createBatchId: () => "batch-close-all", $transaction: async <T>(fn: (v: typeof tx) => Promise<T>) => fn(tx),
      crawlBatch: { update: async () => undefined } };
    await expect(runP0CrawlBatch([base, second], { db: db as never, now: new Date("2026-07-10T00:00:00Z"),
      identity: { releaseCandidateId: "rc-1", commitSha: sha, rosterSha256: sha, sourcePlanSha256: sha,
        sourceConfigSha256: sha, adapterBundleSha256: sha, batchKind: "SCHEDULED", ownerId: "owner",
        expectedPlannedSourceIds: ids, expectedPlannedSourceSetSha256: hash, expectedPlannedSourceCount: 2 },
      fetch: async () => { throw new Error("must not fetch"); }, getPreviousJobs: async () => [],
      getRecentObservations: async () => { throw new Error("pre-read failed"); }, isBaselineCompleted: async () => true,
      readPersistedBatchSourceResults: async () => ids.map((sourceId) => ({ sourceId,
        transportState: "FAILED" as const, adapterState: "SKIPPED" as const,
        completenessState: "FAILED" as const, atomicCommitState: "NOT_ATTEMPTED" as const,
        failureCode: "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL" }))
    })).rejects.toThrow("pre-read failed");
    expect(terminal.map((row) => row.sourceId)).toEqual(ids);
  });

  it("builds a validated full atomic bundle from strict crawl, lifecycle and archive truth", async () => {
    const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(
      (candidate) => candidate.source.id === "source-novo-nordisk-china-social"
    );
    if (!plan || plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "novo-nordisk" ||
      !plan.source.surfaceId || !plan.expectedChannels?.[0]) {
      throw new Error("Missing canonical staged Novo Nordisk atomic-evidence plan");
    }
    const sourceId = plan.source.id;
    const surfaceId = plan.source.surfaceId;
    const channelId = plan.expectedChannels[0].channelId;
    const identity = { releaseCandidateId: "p0-rc-20260710-001", commitSha: sha,
      rosterSha256: sha, sourcePlanSha256: sha, sourceConfigSha256: sha,
      adapterBundleSha256: sha, batchKind: "SCHEDULED" as const, ownerId: "owner-1",
      expectedPlannedSourceIds: [sourceId],
      expectedPlannedSourceSetSha256: (await import("node:crypto")).createHash("sha256")
        .update(JSON.stringify([sourceId])).digest("hex"),
      expectedPlannedSourceCount: 1 };
    const pageLogicalKey = "official-json-page-0000";
    const oracle = { auditId: "phase2-audit-fixture", sources: { [sourceId]: {
      officialEntryId: "entry-1", officialSurfaceIds: [surfaceId],
      officialChannelIds: [channelId],
      artifactLogicalKeyToSurfaceId: { [pageLogicalKey]: surfaceId },
      artifactLogicalKeyToChannelId: { [pageLogicalKey]: channelId }
    } } };
    const pending = buildPendingRuntimeBatch("batch-1", [plan], identity,
      new Date("2026-07-10T00:00:00Z"), oracle).sources[0]!;
    const fetch = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-10T00:00:01.000Z"),
      http: createNovoSingleJobHttp("2026-07-10T00:00:01.000Z")
    });
    const fetched = await fetch(plan);
    if (!fetched.ok || !("payload" in fetched) || !fetched.fetchEvidence || !fetched.paginationEvaluation) {
      throw new Error(fetched.ok ? "Missing strict Novo evidence" : fetched.failureReason);
    }
    const body = JSON.stringify(fetched.payload);
    const evidence = fetched.fetchEvidence;
    const evaluation = fetched.paginationEvaluation;
    expect(evaluation).toMatchObject({ safeCompleteness: true });
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
    const workspaceRoot = await mkdtemp(join(tmpdir(), "task5h-runtime-archive-"));
    const archiveResult = await archiveSourceEvidence({ workspaceRoot,
      releaseCandidateId: identity.releaseCandidateId, batchId: "batch-1", sourceId,
      sourceResultId: pending.id, evidenceSubdirectory: "phase-1/runtime-evidence",
      captureTool: evidence.captureTool, artifacts: evidence.artifacts });
    const archived = await verifyArchivedSourceEvidence({ workspaceRoot,
      releaseCandidateId: identity.releaseCandidateId, batchId: "batch-1", sourceId,
      sourceResultId: pending.id, evidenceSubdirectory: "phase-1/runtime-evidence",
      artifacts: archiveResult.artifacts });

    const commit = buildAtomicRuntimeCommit({ plan, pending, identity, batchId: "batch-1", result,
      previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: archived, oracle });
    expect(() => verifyAtomicRuntimeCommitAttestation(commit)).not.toThrow();
    const transaction = vi.fn();
    await expect(executeAtomicSourceEvidenceCommit(structuredClone(commit), { $transaction: transaction } as never))
      .rejects.toThrow(/ATOMIC_RUNTIME_COMMIT_ATTESTATION_MISSING/);
    expect(transaction).not.toHaveBeenCalled();
    expect(commit.sourceResult).toMatchObject({ atomicCommitState: "COMMITTED", completenessState: "VERIFIED",
      canonicalCurrentJobSetSha256: commit.observationProvenance.canonicalOutputSha256 });
    expect(commit.artifacts).toHaveLength(4);
    expect(commit.pagination).toHaveLength(1);

    const browserSuccessResult = structuredClone(result);
    browserSuccessResult.priorTransportAttempts = [{
      transport: "BROWSER_SESSION",
      outcome: "SUCCEEDED",
      code: "HCM_BROWSER_SUCCEEDED",
      capturedAt: "2026-07-10T00:00:01Z"
    }];
    const browserSuccessCommit = buildAtomicRuntimeCommit({
      plan, pending, identity, batchId: "batch-1", result: browserSuccessResult,
      previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: archived, oracle
    });
    expect(browserSuccessCommit.artifacts).toHaveLength(4);
    expect(browserSuccessCommit.priorTransportAttempts[0]).toMatchObject({
      transport: "BROWSER_SESSION",
      outcome: "SUCCEEDED",
      code: "HCM_BROWSER_SUCCEEDED",
      artifactIds: browserSuccessCommit.artifacts.map(({ id }) => id)
    });

    const scheduledPlan = plan;
    const scheduledPending = buildPendingRuntimeBatch("scheduled-batch", [scheduledPlan], identity,
      new Date("2026-07-10T00:00:00Z")).sources[0]!;
    const scheduledCommit = buildAtomicRuntimeCommit({ plan: scheduledPlan, pending: scheduledPending,
      identity, batchId: "scheduled-batch", result, previousJobs: [],
      baselineCompletedBeforeCrawl: true, artifacts: archived });
    expect(scheduledCommit.sourceResult).toMatchObject({
      completenessState: "VERIFIED",
      officialSurfaceIds: [surfaceId],
      officialChannelIds: [channelId]
    });
    expect(scheduledCommit.commands.some((command) => command.type === "UPSERT_JOB")).toBe(true);

    const sourceScopedResult = structuredClone(result);
    delete sourceScopedResult.fetchEvidence!.artifacts[0]!.channelId;
    delete sourceScopedResult.fetchEvidence!.pages[0]!.channelId;
    sourceScopedResult.fetchEvidence!.declaredCompleteness = {
      ...sourceScopedResult.fetchEvidence!.declaredCompleteness!,
      scope: "SOURCE"
    };
    delete sourceScopedResult.fetchEvidence!.declaredCompleteness!.channelId;
    const sourceScopedArtifacts = archived.map(({ channelId: _channelId, ...artifact }) => artifact);
    const sourceScopedCommit = buildAtomicRuntimeCommit({ plan: scheduledPlan, pending: scheduledPending,
      identity, batchId: "scheduled-batch", result: sourceScopedResult, previousJobs: [],
      baselineCompletedBeforeCrawl: true, artifacts: sourceScopedArtifacts });
    expect(sourceScopedCommit.sourceResult.completenessState).toBe("VERIFIED");

    const rawBodySha256 = "b".repeat(64);
    const redactedCommit = buildAtomicRuntimeCommit({ plan: scheduledPlan, pending: scheduledPending,
      identity, batchId: "scheduled-batch", result, previousJobs: [], baselineCompletedBeforeCrawl: true,
      artifacts: archived.map((artifact) => ({ ...artifact, bodyRepresentation: "REDACTED" as const,
        rawBodySha256, redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: 1 }] })) });
    expect(redactedCommit.artifacts[0]?.redactionCommitmentSha256).toBe(rawBodySha256);
    expect(() => buildAtomicRuntimeCommit({ plan: scheduledPlan, pending: scheduledPending,
      identity, batchId: "scheduled-batch", result, previousJobs: [], baselineCompletedBeforeCrawl: true,
      artifacts: archived.map((artifact) => ({ ...artifact, bodyRepresentation: "REDACTED" as const,
        redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: 1 }] })) }))
      .toThrow(/redacted.*raw/i);

    const manualIdentity = { ...identity, batchKind: "MANUAL_SOURCE" as const, ownerId: "manual-worker" };
    const manualCommit = buildAtomicRuntimeCommit({ plan, pending, identity: manualIdentity, batchId: "batch-1", result,
      previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: archived, oracle });
    expect(manualCommit.commands.filter((command) => command.type === "UPSERT_JOB")).toEqual([]);
    expect(manualCommit.sourceResult.canonicalGraceJobSetSha256).toBe(
      (await import("../../src/crawler/sourceFetchEvidence")).canonicalStringSetSha256([]));
    expect(manualCommit.sourceResult.canonicalVisibleJobSetSha256).toBe(
      (await import("../../src/crawler/sourceFetchEvidence")).canonicalStringSetSha256([]));
    expect(commit.sourceResult.canonicalGraceJobSetSha256).toBe(
      (await import("../../src/crawler/sourceFetchEvidence")).canonicalStringSetSha256([]));
    const incompleteResult = structuredClone(result);
    incompleteResult.truth.completenessVerified = false;
    incompleteResult.observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
    incompleteResult.observation.completenessBlockerReason = "Official pages parsed; full traversal is not proven";
    incompleteResult.fetchEvidence!.declaredCompleteness = {
      ...incompleteResult.fetchEvidence!.declaredCompleteness!,
      kind: "OFFICIAL_TOTAL_PAGES"
    };
    const incompleteCommit = buildAtomicRuntimeCommit({ plan, pending, identity, batchId: "batch-1",
      result: incompleteResult, previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: archived, oracle });
    expect(incompleteCommit.sourceResult).toMatchObject({
      completenessState: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      blockerCode: "A_GRADE_CERTIFICATE_NOT_ISSUED",
      blockerReason: "A-grade official-total certificate was not issued: SCOPE_MISMATCH"
    });
    expect(incompleteCommit.commands.filter((command) => command.type === "UPSERT_JOB")).toHaveLength(1);
    const anomalousIncompleteCommit = buildAtomicRuntimeCommit({ plan, pending, identity, batchId: "batch-1",
      result: incompleteResult, previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: archived, oracle,
      completenessAnomalyTriggerCodes: ["TRUSTED_COUNT_DROP"] });
    expect(anomalousIncompleteCommit.commands.filter((command) => command.type === "UPSERT_JOB")).toEqual([]);
    expect(anomalousIncompleteCommit.sourceResult).toMatchObject({
      blockerCode: "COMPLETENESS_ANOMALY_UNVERIFIED",
      blockerReason: expect.stringContaining("TRUSTED_COUNT_DROP")
    });
    const partialJobUpsert = vi.fn(async () => undefined);
    const partialLifecycleMember = vi.fn(async () => undefined);
    const partialTx = {
      evidenceArtifact: { create: async () => undefined },
      paginationEvidence: { create: async () => undefined },
      lossLedgerEntry: { create: async () => undefined },
      transportAttemptEvidence: { create: async () => undefined },
      transportAttemptArtifact: { create: async () => undefined },
      crawlObservation: { create: async () => undefined },
      job: { upsert: partialJobUpsert },
      lifecycleSetEvidenceMember: { create: partialLifecycleMember },
      crawlBatchSourceResult: { updateMany: async () => ({ count: 1 }) }
    };
    await expect(executeAtomicSourceEvidenceCommit(incompleteCommit, {
      $transaction: async <T>(operation: (value: typeof partialTx) => Promise<T>) => operation(partialTx)
    })).resolves.toBeUndefined();
    expect(partialJobUpsert).toHaveBeenCalledTimes(1);
    expect(partialLifecycleMember).not.toHaveBeenCalled();
    partialJobUpsert.mockClear();
    await expect(executeAtomicSourceEvidenceCommit(anomalousIncompleteCommit, {
      $transaction: async <T>(operation: (value: typeof partialTx) => Promise<T>) => operation(partialTx)
    })).resolves.toBeUndefined();
    expect(partialJobUpsert).not.toHaveBeenCalled();
    const incompleteWithoutReason = structuredClone(incompleteResult);
    delete incompleteWithoutReason.observation.completenessBlockerReason;
    const incompleteWithoutReasonCommit = buildAtomicRuntimeCommit({
      plan,
      pending,
      identity,
      batchId: "batch-1",
      result: incompleteWithoutReason,
      previousJobs: [],
      baselineCompletedBeforeCrawl: true,
      artifacts: archived,
      oracle
    });
    expect(incompleteWithoutReasonCommit.sourceResult.blockerReason)
      .toBe("A-grade official-total certificate was not issued: SCOPE_MISMATCH");
    expect(incompleteWithoutReasonCommit.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION"))
      .toMatchObject({ observation: {
        completenessBlockerReason: "A-grade official-total certificate was not issued: SCOPE_MISMATCH"
      } });
    await expect(executeAtomicSourceEvidenceCommit(incompleteWithoutReasonCommit, {
      $transaction: async <T>(operation: (value: typeof partialTx) => Promise<T>) => operation(partialTx)
    })).resolves.toBeUndefined();
    const declarationlessResult = structuredClone(incompleteResult);
    delete declarationlessResult.fetchEvidence!.declaredCompleteness;
    delete declarationlessResult.observation.completenessEvidenceKind;
    delete declarationlessResult.observation.completenessEvidenceUrl;
    delete declarationlessResult.observation.expectedJobCount;
    delete declarationlessResult.observation.totalPages;
    delete declarationlessResult.observation.pageSize;
    delete declarationlessResult.observation.pagesVisited;
    const declarationlessCommit = buildAtomicRuntimeCommit({
      plan,
      pending,
      identity,
      batchId: "batch-1",
      result: declarationlessResult,
      previousJobs: [],
      baselineCompletedBeforeCrawl: true,
      artifacts: archived,
      oracle
    });
    expect(declarationlessCommit.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION"))
      .toMatchObject({ observation: { pagesVisited: declarationlessCommit.pagination.length } });
    await expect(executeAtomicSourceEvidenceCommit(declarationlessCommit, {
      $transaction: async <T>(operation: (value: typeof partialTx) => Promise<T>) => operation(partialTx)
    })).resolves.toBeUndefined();
    const tampered = buildAtomicRuntimeCommit({ plan, pending, identity, batchId: "batch-1", result,
      previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: archived, oracle });
    const job = tampered.commands.find((command) => command.type === "UPSERT_JOB");
    if (job?.type !== "UPSERT_JOB") throw new Error("expected attested job command");
    job.dedupeKey = `${job.dedupeKey}-replacement`;
    const replacementHash=(await import("../../src/crawler/sourceFetchEvidence")).canonicalStringSetSha256([job.dedupeKey]);
    tampered.sourceResult.canonicalCurrentJobSetSha256=replacementHash;
    tampered.sourceResult.canonicalVisibleJobSetSha256=replacementHash;
    tampered.sourceResult.canonicalOutputSetSha256=replacementHash;
    tampered.observationProvenance.canonicalOutputSha256=replacementHash;
    tampered.observationProvenance.canonicalVisibleSha256=replacementHash;
    await expect(executeAtomicSourceEvidenceCommit(tampered,{ $transaction: transaction } as never))
      .rejects.toThrow(/ATOMIC_RUNTIME_COMMIT_ATTESTATION_INVALID/);
    expect(transaction).not.toHaveBeenCalled();
    for (const kind of ["missing", "extra"] as const) {
      const changed=buildAtomicRuntimeCommit({plan,pending,identity,batchId:"batch-1",result,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:archived,oracle});
      const jobs=changed.commands.filter((command)=>command.type==="UPSERT_JOB");
      if(kind==="missing") changed.commands=changed.commands.filter((command)=>command.type!=="UPSERT_JOB");
      else changed.commands.push({...jobs[0]!,dedupeKey:`${jobs[0]!.dedupeKey}-extra`});
      const keys=changed.commands.filter((command)=>command.type==="UPSERT_JOB").map((command)=>command.dedupeKey);
      const hash=(await import("../../src/crawler/sourceFetchEvidence")).canonicalStringSetSha256(keys);
      changed.sourceResult.canonicalCurrentJobSetSha256=hash;changed.sourceResult.canonicalVisibleJobSetSha256=hash;
      changed.sourceResult.canonicalOutputSetSha256=hash;changed.observationProvenance.canonicalOutputSha256=hash;
      changed.observationProvenance.canonicalVisibleSha256=hash;
      await expect(executeAtomicSourceEvidenceCommit(changed,{ $transaction: transaction } as never))
        .rejects.toThrow(/ATOMIC_RUNTIME_COMMIT_ATTESTATION_INVALID/);
    }
    const tx = { evidenceArtifact: { create: async () => undefined }, paginationEvidence: { create: async () => undefined },
      lossLedgerEntry: { create: async () => undefined }, transportAttemptEvidence: { create: async () => undefined },
      transportAttemptArtifact: { create: async () => undefined }, crawlObservation: { create: async () => undefined },
      job: { upsert: async () => undefined }, lifecycleSetEvidenceMember:{create:async()=>undefined}, crawlBatchSourceResult: { updateMany: async () => ({ count: 1 }) } };
    await expect(executeAtomicSourceEvidenceCommit(commit, {
      $transaction: async <T>(operation: (value: typeof tx) => Promise<T>) => operation(tx)
    })).resolves.toBeUndefined();

    for (const fault of ["archive", "orphan", "orphan-ledger", "verify", "atomic"] as const) {
      const terminalUpdates: unknown[] = [];
      const batchUpdates: unknown[] = [];
      const jobUpsert = vi.fn();
      const observationCreate = vi.fn();
      const runtimeTx = { ...tx,
        job: { upsert: jobUpsert },
        crawlObservation: { create: observationCreate },
        crawlBatch: { create: async () => undefined },
        crawlBatchSourceResult: {
          create: async () => undefined,
          updateMany: async (args: unknown) => { terminalUpdates.push(args); return { count: 1 }; }
        }
      };
      const runtimeDb = {
        createBatchId: () => `batch-fault-${fault}`,
        $transaction: async <T>(operation: (value: typeof runtimeTx) => Promise<T>) => operation(runtimeTx),
        crawlBatch: { update: async (args: unknown) => {
          batchUpdates.push(args);
          if (fault === "orphan-ledger") throw new Error("batch finalization injected");
        } }
      };
      const fail = async () => { throw new Error(`${fault} injected`); };
      const atomicCommit = vi.fn(async () => {
        if (fault === "atomic") throw new Error("atomic injected");
      });
      const orphanLedger: unknown[] = [];
      const archiveFailure = async () => {
        if (fault === "orphan" || fault === "orphan-ledger") {
          throw new ArtifactArchiveError("orphan injected", [archived[0]!]);
        }
        throw new Error(`${fault} injected`);
      };
      const invocation = runP0CrawlBatch([plan], {
        db: runtimeDb as never, identity, now: new Date("2026-07-10T00:00:00Z"), force: true,
        fetch: async () => ({ ok: true, capturedAt: "2026-07-10T00:00:01Z",
          payload: JSON.parse(body), fetchEvidence: evidence, paginationEvaluation: evaluation }),
        getPreviousJobs: async () => [], getRecentObservations: async () => [], isBaselineCompleted: async () => true,
        archiveEvidence: fault === "archive" || fault === "orphan" || fault === "orphan-ledger"
          ? archiveFailure as never : async () => ({ artifacts: archived, orphanedFinalArtifacts: [] }),
        verifyArchive: fault === "verify" ? fail as never : async () => archived,
        executeAtomicCommit: atomicCommit as never,
        inspectAtomicCommitOutcome: async () => ({ state: "PENDING" }),
        readPersistedBatchSourceResults: async () => [{ sourceId,
          transportState: "SUCCEEDED", adapterState: "SUCCEEDED", completenessState: "FAILED",
          atomicCommitState: "ROLLED_BACK", failureCode: fault === "atomic"
            ? "ATOMIC_EVIDENCE_COMMIT_FAILED"
            : fault === "verify" ? "EVIDENCE_VERIFICATION_FAILED"
              : fault === "archive" || fault === "orphan" || fault === "orphan-ledger"
                ? "EVIDENCE_ARCHIVE_FAILED" : "ATOMIC_COMMIT_BUILD_FAILED" }],
        recordOrphanedArtifacts: async (artifacts) => {
          orphanLedger.push(...artifacts);
          if (fault === "orphan-ledger") throw new Error("authorization: Bearer example-placeholder");
        }
      });
      if (fault === "orphan-ledger") {
        let rejection: unknown;
        try { await invocation; } catch (error) { rejection = error; }
        expect(rejection).toBeInstanceOf(AggregateError);
        const outerErrors = (rejection as AggregateError).errors;
        expect(outerErrors).toHaveLength(2);
        expect(outerErrors[0]).toBeInstanceOf(AggregateError);
        expect((outerErrors[1] as Error).message).toBe("batch finalization injected");
        const errors = (outerErrors[0] as AggregateError).errors;
        expect(errors).toHaveLength(2);
        expect(errors[0]).toBeInstanceOf(ArtifactArchiveError);
        expect((errors[0] as ArtifactArchiveError).orphanedFinalArtifacts).toEqual([archived[0]]);
        expect((errors[0] as Error).message).toContain("orphan injected");
        expect((errors[1] as Error).message).toBe("ORPHAN_LEDGER_RECORDING_FAILED");
        expect((errors[1] as Error).cause).toBeUndefined();
        expect(Reflect.ownKeys(errors[1] as object)).toEqual(["stack", "message"]);
        expect((errors[1] as Error).message).not.toMatch(/password|authorization|cookie|bearer|topsecret/i);
      } else {
        await expect(invocation).resolves.toEqual({
          status: "FAILED",
          batchId: `batch-fault-${fault}`,
          plannedSourceCount: 1,
          dueSourceCount: 1,
          transportSuccessfulSourceCount: 1,
          transportFailedSourceCount: 0,
          adapterSuccessfulSourceCount: 1,
          adapterFailedSourceCount: 0,
          completenessVerifiedSourceCount: 0,
          completenessIncompleteSourceCount: 0,
          atomicCommittedSourceCount: 0,
          atomicFailedSourceCount: 1,
          successfulSourceCount: 0,
          failedSourceCount: 1,
          blockedSourceCount: 0,
          skippedSourceCount: 0
        });
      }
      if (fault === "archive") {
        expect(atomicCommit).not.toHaveBeenCalled();
        expect(jobUpsert).not.toHaveBeenCalled();
        expect(observationCreate).not.toHaveBeenCalled();
      }
      if (["orphan", "orphan-ledger"].includes(fault)) {
        expect(orphanLedger).toEqual([archived[0]]);
      } else if (["verify", "atomic"].includes(fault)) {
        expect(orphanLedger).toEqual(archived);
      } else {
        expect(orphanLedger).toEqual([]);
      }
      const expectedFailureCode = fault === "verify"
        ? "EVIDENCE_VERIFICATION_FAILED"
        : fault === "atomic"
          ? "ATOMIC_EVIDENCE_COMMIT_FAILED"
          : "EVIDENCE_ARCHIVE_FAILED";
      expect(terminalUpdates.at(-1)).toEqual(expect.objectContaining({
        data: expect.objectContaining({
          transportState: "SUCCEEDED",
          adapterState: "SUCCEEDED",
          completenessState: "FAILED",
          atomicCommitState: "ROLLED_BACK",
          failureCode: expectedFailureCode,
          failureReason: "Atomic evidence processing failed"
        })
      }));
      expect(batchUpdates.at(-1)).toEqual(expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          transportSucceededCount: 1,
          transportFailedCount: 0,
          adapterSucceededCount: 1,
          adapterFailedCount: 0,
          atomicCommittedCount: 0,
          atomicFailedCount: 1,
          failedSourceCount: 1,
          completenessVerifiedCount: 0,
          aggregateJobSetSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
        })
      }));
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  }, 15_000);
});

describe("source-bound official-total persistence", () => {
  it("commits the Boehringer API total only when the B certificate proves the official UI exclusion", async () => {
    const sourceId = "source-boehringer-ingelheim-china-social" as const;
    const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(
      ({ source }) => source.id === sourceId
    );
    if (!plan || plan.adapterId !== "official-json" || !plan.source.surfaceId || !plan.expectedChannels?.[0]) {
      throw new Error("Missing canonical Boehringer plan");
    }
    const capturedAt = "2026-09-02T00:00:00.000Z";
    const fetch = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        return {
          status: 200,
          body: request.url.includes("/scripts/recruit.js")
            ? `let sxsPosCode = [
                { code: "205909", jobareaname: "上海" },
              ]
              // official UI filters these rows before rendering`
            : `jsoncallback({"status":"1","message":"接口调用成功","resultbody":{"totalnum":"2","joblist":[
                {"jobid":"173472429","jobname":"Medical Advisor","jobareaname":"北京"},
                {"jobid":"173472430","jobname":"Intern ID205909","jobareaname":"上海"}
              ]}})`,
          finalUrl: request.url,
          contentType: request.url.includes("/scripts/recruit.js") ? "application/javascript" : "text/html",
          capturedAt
        };
      }
    });
    const result = await runSourceCrawl(plan, { fetch });
    if (!result.fetchEvidence || !result.paginationEvaluation || !result.reconciliation) {
      throw new Error("Missing Boehringer crawl evidence");
    }
    const sourceConfigSha256 = sourcePlanConfigSha256(plan);
    const independentValidation = createOfficialJsonRenderedTraversalValidation({
      sourceId,
      companyId: plan.company.id,
      sourceConfigSha256,
      surfaceIds: [plan.source.surfaceId],
      channelIds: plan.expectedChannels.map(({ channelId }) => channelId),
      pages: [{
        pageNumber: 1,
        declaredTotalPages: 1,
        declaredTotalJobs: 1,
        channelId: plan.expectedChannels[0].channelId,
        uiRequestCandidateIds: [],
        nextControlPresent: false,
        rawRows: [{
          sourceJobId: persistentOfficialJsonJobId("173472429"),
          rawEvidenceId: irreversibleOfficialJsonEvidenceId("173472429"),
          scopeMarker: "OFFICIAL_RENDERED_JOB_LINK",
          scopeDecision: "INCLUDED_MAINLAND",
          recordIndex: 0,
          rawPayload: { jobId: "173472429" }
        }]
      }],
      observedAt: capturedAt,
      expiresAt: "2026-09-09T00:00:00.000Z"
    });
    const expectedPlannedSourceIds = [plan.source.id];
    const identity: RuntimeBatchIdentity = {
      releaseCandidateId: "rc-boehringer", commitSha: sha, rosterSha256: sha,
      sourcePlanSha256: sha, sourceConfigSha256: sha, adapterBundleSha256: sha,
      batchKind: "SCHEDULED", ownerId: "test", expectedPlannedSourceIds,
      expectedPlannedSourceSetSha256: (await import("node:crypto")).createHash("sha256")
        .update(JSON.stringify(expectedPlannedSourceIds)).digest("hex"),
      expectedPlannedSourceCount: 1
    };
    const pending = buildPendingRuntimeBatch("batch-boehringer", [plan], identity,
      new Date(capturedAt)).sources[0]!;
    const workspaceRoot = await mkdtemp(join(process.cwd(), ".runtime", ".cache", "boehringer-persistence-"));
    try {
      const archiveResult = await archiveSourceEvidence({ workspaceRoot,
        releaseCandidateId: identity.releaseCandidateId, batchId: "batch-boehringer", sourceId: plan.source.id,
        sourceResultId: pending.id, evidenceSubdirectory: "phase-1/runtime-evidence",
        captureTool: result.fetchEvidence.captureTool, artifacts: result.fetchEvidence.artifacts });
      const archived = await verifyArchivedSourceEvidence({ workspaceRoot,
        releaseCandidateId: identity.releaseCandidateId, batchId: "batch-boehringer", sourceId: plan.source.id,
        sourceResultId: pending.id, evidenceSubdirectory: "phase-1/runtime-evidence",
        artifacts: archiveResult.artifacts });
      const commit = buildAtomicRuntimeCommit({
        plan, pending, identity, batchId: "batch-boehringer", result, previousJobs: [],
        baselineCompletedBeforeCrawl: false, artifacts: archived,
        independentTraversalValidation: independentValidation,
        independentTraversalValidationExecution: "CURRENT_RUN",
        independentTraversalValidationTrigger: "INITIAL_QUALIFICATION",
        completedAt: new Date("2026-09-02T00:01:00.000Z")
      });
      expect(commit.sourceResult).toMatchObject({
        expectedJobCount: 2,
        validationDiscardCount: 1,
        dedupeOutputCount: 1,
        completenessCertificate: { grade: "B", counts: { validationDiscardCount: 1, finalUniqueJobCount: 1 } }
      });
      const tx = {
        evidenceArtifact: { create: async () => undefined },
        paginationEvidence: { create: async () => undefined },
        lossLedgerEntry: { create: async () => undefined },
        transportAttemptEvidence: { create: async () => undefined },
        transportAttemptArtifact: { create: async () => undefined },
        crawlObservation: { create: async () => undefined },
        job: { upsert: async () => undefined },
        lifecycleSetEvidenceMember: { create: async () => undefined },
        crawlBatchSourceResult: { updateMany: async () => ({ count: 1 }) }
      };
      await expect(executeAtomicSourceEvidenceCommit(commit, {
        $transaction: async <T>(operation: (value: typeof tx) => Promise<T>) => operation(tx)
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
