import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ArchivedEvidenceArtifact } from "../../src/crawler/artifactArchive";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import {
  irreversibleOfficialJsonEvidenceId,
  persistentOfficialJsonJobId
} from "../../src/crawler/officialJsonEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  sourcePlanConfigSha256
} from "../../src/crawler/sourcePlan";
import { canonicalStringSetSha256, sha256Bytes } from "../../src/crawler/sourceFetchEvidence";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import {
  createOfficialJsonRenderedTraversalValidation,
  verifyBGradeTraversalCertificateReceipt
} from "../../src/crawler/traversalCertificate";
import { executeAtomicSourceEvidenceCommit } from "../../src/db/ingestionRepository";
import { candidateCompanies } from "../../src/data/companyRegistry";

const CAPTURED_AT = "2026-09-02T00:00:00.000Z";
const EXPIRES_AT = "2026-09-09T00:00:00.000Z";
const SHA = "a".repeat(64);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function cutoffIso(at: string, days: number): string {
  const china = new Date(Date.parse(at) + 8 * 60 * 60 * 1000);
  return new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate() - days) -
    8 * 60 * 60 * 1000).toISOString();
}

function rawJob(id: string, changeDate: string): Record<string, unknown> {
  return {
    Id: id,
    JobAdId: id,
    JobAdName: `职位 ${id}`,
    LocNames: ["上海市"],
    Category: "社会招聘",
    CategoryId: "1",
    Kind: "全职",
    ChangeDate: changeDate
  };
}

describe("filtered Beisen B-grade atomic commit", () => {
  it.each([
    ["source-united-lab-social", "company-united-lab"]
  ] as const)("lets an exact B certificate establish completeness for %s and rejects bypasses", async (
    sourceId,
    companyId
  ) => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
    if (plan?.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "beisen-zhiye-2022" ||
        plan.officialJsonFetch.changedWithinDays !== 183 || !plan.source.surfaceId || !plan.expectedChannels?.[0]) {
      throw new Error(`Missing filtered Beisen plan ${sourceId}`);
    }
    const includedId = "00000000-0000-4000-8000-000000000001";
    const excludedId = "00000000-0000-4000-8000-000000000002";
    const rows = [
      rawJob(includedId, "2026-09-01T12:00:00"),
      rawJob(excludedId, "2026-03-01T12:00:00")
    ];
    const endpoint = new URL("/api/Jobad/GetJobAdPageList", plan.source.officialEntryUrl).toString();
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(CAPTURED_AT),
      http: async () => ({
        status: 200,
        body: JSON.stringify({ Code: 200, Count: rows.length, PageIndex: 0, Data: rows }),
        finalUrl: endpoint,
        contentType: "application/json; charset=utf-8",
        capturedAt: CAPTURED_AT
      })
    });
    const fetched = await fetcher(plan);
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: false },
      observation: { structuredJobCount: 1, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { fetchCounts: { rawCount: 2, validCount: 1, validationDiscardCount: 1 } },
      paginationEvaluation: { safeCompleteness: true }
    });
    if (!result.fetchEvidence || !result.paginationEvaluation || !result.reconciliation) {
      throw new Error("Missing filtered Beisen evidence");
    }

    const sourceIds = [sourceId];
    const identity = {
      releaseCandidateId: "rc-filtered-beisen",
      commitSha: SHA,
      rosterSha256: SHA,
      sourcePlanSha256: SHA,
      sourceConfigSha256: SHA,
      adapterBundleSha256: SHA,
      batchKind: "SCHEDULED" as const,
      ownerId: "filtered-beisen-test",
      expectedPlannedSourceIds: sourceIds,
      expectedPlannedSourceSetSha256: canonicalStringSetSha256(sourceIds),
      expectedPlannedSourceCount: 1
    };
    const batchId = "batch-filtered-beisen";
    const pending = buildPendingRuntimeBatch(
      batchId,
      [plan],
      identity,
      new Date("2026-09-01T23:59:00.000Z")
    ).sources[0]!;
    const archived: ArchivedEvidenceArtifact[] = result.fetchEvidence.artifacts.map((artifact) => {
      const bytes = typeof artifact.body === "string" ? Buffer.from(artifact.body, "utf8") : Buffer.from(artifact.body);
      const digest = sha256Bytes(bytes);
      return {
        id: artifact.id,
        logicalKey: artifact.logicalKey,
        releaseCandidateId: identity.releaseCandidateId,
        batchId,
        sourceId,
        sourceResultId: pending.id,
        ...(artifact.channelId ? { channelId: artifact.channelId } : {}),
        kind: artifact.kind,
        ...(artifact.requestedUrl ? { requestedUrl: artifact.requestedUrl } : {}),
        ...(artifact.finalUrl ? { finalUrl: artifact.finalUrl } : {}),
        ...(artifact.httpStatus ? { httpStatus: artifact.httpStatus } : {}),
        ...(artifact.contentType ? { contentType: artifact.contentType } : {}),
        capturedAt: new Date(artifact.capturedAt),
        ...digest,
        path: `outputs/p0-rc/${identity.releaseCandidateId}/${artifact.logicalKey}.json`,
        extractorLocator: artifact.extractorLocator,
        captureToolName: result.fetchEvidence!.captureTool.name,
        captureToolVersion: result.fetchEvidence!.captureTool.version
      };
    });
    const cutoffAt = cutoffIso(CAPTURED_AT, plan.officialJsonFetch.changedWithinDays);
    const independentValidation = createOfficialJsonRenderedTraversalValidation({
      sourceId,
      companyId,
      sourceConfigSha256: sourcePlanConfigSha256(plan),
      surfaceIds: [plan.source.surfaceId],
      channelIds: plan.expectedChannels.map(({ channelId }) => channelId),
      pages: [{
        channelId: plan.expectedChannels[0].channelId,
        pageNumber: 1,
        declaredTotalPages: 1,
        declaredTotalJobs: 2,
        uiRequestCandidateIds: [],
        rawRows: rows.map((rawPayload, recordIndex) => ({
          sourceJobId: persistentOfficialJsonJobId(String(rawPayload.Id)),
          rawEvidenceId: irreversibleOfficialJsonEvidenceId(rawPayload.Id),
          scopeMarker: JSON.stringify({ locations: ["上海市"], changeDate: rawPayload.ChangeDate, cutoffAt }),
          scopeDecision: recordIndex === 0 ? "INCLUDED_MAINLAND" as const : "EXCLUDED_AUDITED" as const,
          recordIndex,
          rawPayload
        })),
        nextControlPresent: false
      }],
      observedAt: CAPTURED_AT,
      expiresAt: EXPIRES_AT
    });

    const uncertified = buildAtomicRuntimeCommit({
      plan,
      pending,
      identity,
      batchId,
      result,
      previousJobs: [],
      baselineCompletedBeforeCrawl: true,
      artifacts: archived,
      completedAt: new Date(CAPTURED_AT)
    });
    expect(uncertified.sourceResult).toMatchObject({
      completenessState: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      completenessCertificate: null,
      blockerCode: "B_GRADE_CERTIFICATE_NOT_ISSUED"
    });

    const certified = buildAtomicRuntimeCommit({
      plan,
      pending,
      identity,
      batchId,
      result,
      previousJobs: [],
      baselineCompletedBeforeCrawl: true,
      artifacts: archived,
      independentTraversalValidation: independentValidation,
      independentTraversalValidationExecution: "CURRENT_RUN",
      independentTraversalValidationTrigger: "INITIAL_QUALIFICATION",
      completedAt: new Date(CAPTURED_AT)
    });
    expect(certified.sourceResult).toMatchObject({
      completenessState: "VERIFIED",
      completenessCertificate: { grade: "B" }
    });
    expect(certified.sourceResult.blockerCode).toBeUndefined();
    const transaction = vi.fn(async () => { throw new Error("TRANSACTION_REACHED"); });
    await expect(executeAtomicSourceEvidenceCommit(certified, { $transaction: transaction } as never))
      .rejects.toThrow(/TRANSACTION_REACHED/u);
    expect(transaction).toHaveBeenCalledOnce();

    const certificate = certified.sourceResult.completenessCertificate;
    const certificateSha256 = certified.sourceResult.completenessCertificateSha256;
    if (!certificate || !certificateSha256) throw new Error("Expected B certificate");
    const expected = {
      releaseCandidateId: identity.releaseCandidateId,
      batchId,
      sourceResultId: pending.id,
      sourceId,
      companyId,
      sourceConfigSha256: pending.sourceConfigHash,
      surfaceIds: pending.officialSurfaceIds,
      channelIds: pending.officialChannelIds,
      canonicalJobSetSha256: certified.sourceResult.canonicalOutputSetSha256,
      adapterReconciliationSha256: certified.sourceResult.adapterReconciliationSha256,
      collisionLedgerSha256: certified.sourceResult.collisionLedgerSha256,
      canonicalRawEvidenceIdSetSha256: certified.observationProvenance.canonicalRawSha256
    };
    expect(verifyBGradeTraversalCertificateReceipt({
      certificate,
      certificateSha256,
      expected,
      now: new Date(CAPTURED_AT)
    })).toMatchObject({ status: "PASS", sourceId, finalUniqueJobCount: 1 });
    expect(() => verifyBGradeTraversalCertificateReceipt({
      certificate,
      certificateSha256,
      expected: { ...expected, sourceId: "source-other" },
      now: new Date(CAPTURED_AT)
    })).toThrow(/binding mismatch/iu);
    expect(() => verifyBGradeTraversalCertificateReceipt({
      certificate,
      certificateSha256,
      expected: { ...expected, canonicalJobSetSha256: "b".repeat(64) },
      now: new Date(CAPTURED_AT)
    })).toThrow(/reconciliation commitment mismatch/iu);
    expect(() => verifyBGradeTraversalCertificateReceipt({
      certificate,
      certificateSha256,
      expected: { ...expected, canonicalRawEvidenceIdSetSha256: "b".repeat(64) },
      now: new Date(CAPTURED_AT)
    })).toThrow(/raw evidence commitment mismatch/iu);
    expect(() => verifyBGradeTraversalCertificateReceipt({
      certificate,
      certificateSha256: "b".repeat(64),
      expected,
      now: new Date(CAPTURED_AT)
    })).toThrow(/certificate hash mismatch/iu);
    const fakeCount = structuredClone(certificate) as typeof certificate & {
      counts: { finalUniqueJobCount: number };
    };
    fakeCount.counts.finalUniqueJobCount += 1;
    expect(() => verifyBGradeTraversalCertificateReceipt({
      certificate: fakeCount,
      certificateSha256: sha256(fakeCount),
      expected,
      now: new Date(CAPTURED_AT)
    })).toThrow(/equations do not reconcile/iu);
  });
});
