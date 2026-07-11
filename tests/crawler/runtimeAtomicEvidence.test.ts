import { describe, expect, it, vi } from "vitest";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { verifyAtomicRuntimeCommitAttestation } from "../../src/crawler/runtimeAtomicEvidence";
import { runP0CrawlBatch } from "../../src/crawler/runCrawlBatch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { executeAtomicSourceEvidenceCommit } from "../../src/db/ingestionRepository";
import { archiveSourceEvidence, verifyArchivedSourceEvidence, ArtifactArchiveError } from "../../src/crawler/artifactArchive";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeBatchIdentity } from "../../src/crawler/runtimeBatchIdentity";
import { expectedChannelSetHash, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const sha = "a".repeat(64);

function channelBound(plan: SourceCrawlPlan): SourceCrawlPlan {
  const expectedChannels = [{ channelId: `source:${plan.source.id}:default`, kind: "SOCIAL" as const }];
  return { ...plan, source: { ...plan.source, surfaceId: plan.source.surfaceId ?? `surface:${plan.source.id}` },
    expectedChannels, expectedChannelSetHash: expectedChannelSetHash(expectedChannels) };
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
    expect(planned.sources[0]?.adapterVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(planned.sources[0]?.officialEntryId).toBeNull();
    expect(planned.sources[0]?.officialSurfaceIds).toEqual([]);
    expect(planned.sources[0]?.officialChannelIds).toEqual([]);
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
      getRecentObservations: async () => { throw new Error("pre-read failed"); }, isBaselineCompleted: async () => true
    })).rejects.toThrow("pre-read failed");
    expect(terminal.map((row) => row.sourceId)).toEqual(ids);
  });

  it("builds a validated full atomic bundle from strict crawl, lifecycle and archive truth", async () => {
    const plan = channelBound({
      adapterId: "official-json", company: { id: "company-1", officialChineseName: "公司" },
      source: { id: "source-1", companyId: "company-1", kind: "SOCIAL", atsKind: "OFFICIAL_JSON",
        status: "VERIFIED_SCRAPABLE", officialEntryUrl: "https://example.com/jobs",
        officialChainEvidenceUrl: "https://example.com/jobs" },
      json: { jobsPath: "jobs", fields: { sourceJobId: "id", officialTitle: "title", officialUrl: "url", locationRaw: "location" } }
    } as SourceCrawlPlan);
    const identity = { releaseCandidateId: "p0-rc-20260710-001", commitSha: sha,
      rosterSha256: sha, sourcePlanSha256: sha, sourceConfigSha256: sha,
      adapterBundleSha256: sha, batchKind: "SCHEDULED" as const, ownerId: "owner-1",
      expectedPlannedSourceIds: ["source-1"],
      expectedPlannedSourceSetSha256: (await import("node:crypto")).createHash("sha256").update('["source-1"]').digest("hex"),
      expectedPlannedSourceCount: 1 };
    const oracle = { auditId: "phase2-audit-fixture", sources: { "source-1": {
      officialEntryId: "entry-1", officialSurfaceIds: ["surface-1"], officialChannelIds: ["channel-1"],
      artifactLogicalKeyToSurfaceId: { "page-0": "surface-1" },
      artifactLogicalKeyToChannelId: { "page-0": "channel-1" }
    } } };
    const pending = buildPendingRuntimeBatch("batch-1", [plan], identity,
      new Date("2026-07-10T00:00:00Z"), oracle).sources[0]!;
    const body = JSON.stringify({ jobs: [{ id: "1", title: "Role", url: "https://example.com/jobs/1", location: "上海" }] });
    const channelId = pending.officialChannelIds[0]!;
    const evidence = { captureTool: { name: "test", version: "1" }, artifacts: [{ id: "page-0", logicalKey: "page-0",
      kind: "PAGINATION_PAGE" as const, channelId, requestedUrl: "https://example.com/api/jobs", finalUrl: "https://example.com/api/jobs",
      httpStatus: 200, contentType: "application/json", capturedAt: "2026-07-10T00:00:01Z", body,
      extractorLocator: "json:total" }], pages: [{ sequence: 0, artifactLogicalKey: "page-0", channelId,
      requestedPage: 1, returnedPage: 1, requestedPageSize: 1, returnedPageSize: 1, rawJobIds: ["1"], validJobIds: ["1"],
      declaredTotal: 1, declaredCount: 1, declaredPages: 1,
      responseFingerprintSha256: (await import("node:crypto")).createHash("sha256").update(body).digest("hex"),
      termination: "DECLARED_TOTAL_REACHED" as const, anomalyCodes: [], capturedAt: "2026-07-10T00:00:01Z" }],
      declaredCompleteness: { kind: "OFFICIAL_TOTAL_PAGES" as const, value: 1, artifactLogicalKey: "page-0",
        extractorLocator: "json:total", scope: "CHANNEL" as const, channelId },
      fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: [] };
    const evaluation = evaluatePaginationEvidence({ evidence, expectedChannelIds: [channelId], filteredOutput: true });
    expect(evaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: true });
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: true, capturedAt: "2026-07-10T00:00:01Z",
      payload: JSON.parse(body), fetchEvidence: evidence, paginationEvaluation: evaluation }) });
    expect(result.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
    const workspaceRoot = await mkdtemp(join(tmpdir(), "task5h-runtime-archive-"));
    const archiveResult = await archiveSourceEvidence({ workspaceRoot,
      releaseCandidateId: identity.releaseCandidateId, batchId: "batch-1", sourceId: "source-1",
      sourceResultId: pending.id, evidenceSubdirectory: "phase-1/runtime-evidence",
      captureTool: evidence.captureTool, artifacts: evidence.artifacts });
    const archived = await verifyArchivedSourceEvidence({ workspaceRoot,
      releaseCandidateId: identity.releaseCandidateId, batchId: "batch-1", sourceId: "source-1",
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
    expect(commit.artifacts).toHaveLength(1);
    expect(commit.pagination).toHaveLength(1);
    expect(commit.sourceResult.canonicalGraceJobSetSha256).toBe(
      (await import("../../src/crawler/sourceFetchEvidence")).canonicalStringSetSha256([]));
    const incompleteResult = structuredClone(result);
    incompleteResult.truth.completenessVerified = false;
    const incompleteCommit = buildAtomicRuntimeCommit({ plan, pending, identity, batchId: "batch-1",
      result: incompleteResult, previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: archived, oracle });
    expect(incompleteCommit.sourceResult.completenessState).toBe("INCOMPLETE");
    expect(incompleteCommit.commands.filter((command) => command.type === "UPSERT_JOB")).toEqual([]);
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
      const runtimeTx = { ...tx,
        crawlBatch: { create: async () => undefined },
        crawlBatchSourceResult: {
          create: async () => undefined,
          updateMany: async (args: unknown) => { terminalUpdates.push(args); return { count: 1 }; }
        }
      };
      const runtimeDb = {
        createBatchId: () => `batch-fault-${fault}`,
        $transaction: async <T>(operation: (value: typeof runtimeTx) => Promise<T>) => operation(runtimeTx),
        crawlBatch: { update: async (args: unknown) => { batchUpdates.push(args); } }
      };
      const fail = async () => { throw new Error(`${fault} injected`); };
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
        executeAtomicCommit: fault === "atomic" ? fail as never : async () => undefined,
        recordOrphanedArtifacts: async (artifacts) => {
          orphanLedger.push(...artifacts);
          if (fault === "orphan-ledger") throw new Error("authorization: Bearer example-placeholder");
        }
      });
      if (fault === "orphan-ledger") {
        let rejection: unknown;
        try { await invocation; } catch (error) { rejection = error; }
        expect(rejection).toBeInstanceOf(AggregateError);
        const errors = (rejection as AggregateError).errors;
        expect(errors).toHaveLength(2);
        expect(errors[0]).toBeInstanceOf(ArtifactArchiveError);
        expect((errors[0] as ArtifactArchiveError).orphanedFinalArtifacts).toEqual([archived[0]]);
        expect((errors[0] as Error).message).toContain("orphan injected");
        expect((errors[1] as Error).message).toBe("ORPHAN_LEDGER_RECORDING_FAILED");
        expect((errors[1] as Error).cause).toBeUndefined();
        expect(Reflect.ownKeys(errors[1] as object)).toEqual(["stack", "message"]);
        expect((errors[1] as Error).message).not.toMatch(/password|authorization|cookie|bearer|topsecret/i);
      } else {
        await expect(invocation).rejects.toThrow(fault === "orphan" ? "orphan injected" : `${fault} injected`);
      }
      if (fault === "orphan") expect(orphanLedger).toEqual([archived[0]]);
      if (fault === "orphan-ledger") expect(orphanLedger).toEqual([archived[0]]);
      expect(terminalUpdates.at(-1)).toEqual(expect.objectContaining({
        data: expect.objectContaining({ atomicCommitState: "ROLLED_BACK", failureCode: "ATOMIC_EVIDENCE_COMMIT_FAILED" })
      }));
      expect(batchUpdates.at(-1)).toEqual(expect.objectContaining({
        data: expect.objectContaining({ atomicCommittedCount: 0, atomicFailedCount: 1,
          completenessVerifiedCount: 0, aggregateJobSetSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945" })
      }));
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  });
});
