import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reconcileAdapterRows } from "../../src/crawler/adapters/reconciliation";
import type { NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { sha256Bytes, type PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createHttpHtmlSourceFetch } from "../../src/crawler/httpHtmlSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import type { ArchivedEvidenceArtifact } from "../../src/crawler/artifactArchive";
import {
  __testOnlyViatrisNextRenderedControlIndex,
  createViatrisBrowserTraversalValidation,
  evaluateBGradeValidationRequirement,
  issueBGradeTraversalCertificate,
  readReusableViatrisTraversalValidation,
  runViatrisBrowserTraversalValidator,
  viatrisTraversalValidationMatchesCurrentJobs,
  verifyBGradeTraversalCertificateReceipt
} from "../../src/crawler/traversalCertificate";

const capturedAt = "2026-08-12T12:00:00.000Z";
const now = new Date("2026-08-12T12:05:00.000Z");

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value), "utf8").digest("hex");
}

function plan() {
  const value = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-viatris-social");
  if (value?.adapterId !== "html-table") throw new Error("Expected staged Viatris plan");
  return value;
}

function job(sourceJobId: string): NormalizedJobRecord {
  return {
    companyId: "company-viatris",
    sourceId: "source-viatris-social",
    sourceKind: "SOCIAL",
    atsKind: "OFFICIAL_HTML",
    officialChineseCompanyName: "晖致中国",
    officialTitle: `Role ${sourceJobId}`,
    officialUrl: `https://careersite.tupu360.com/Viatris/position/detail?positionId=${sourceJobId}`,
    sourceJobId,
    locationRaw: "上海",
    cities: ["上海"],
    category: "其他",
    isBaseline: false,
    evidence: { officialEntryUrl: plan().source.officialEntryUrl, capturedAt }
  };
}

function primaryEvidence(idsByPage: readonly string[][] = [["v-1", "v-2"], ["v-3"]]): PersistentSourceFetchEvidence {
  const artifacts = idsByPage.map((ids, index) => {
    const body = JSON.stringify(ids);
    return {
      id: `main-${index}`,
      logicalKey: `main-${index}`,
      kind: (index === 0 ? "ATS_PAGE" : "PAGINATION_PAGE") as "ATS_PAGE" | "PAGINATION_PAGE",
      requestedUrl: index === 0 ? plan().source.officialEntryUrl : "https://careersite.tupu360.com/Viatris/position/nextPageList",
      finalUrl: index === 0 ? plan().source.officialEntryUrl : "https://careersite.tupu360.com/Viatris/position/nextPageList",
      httpStatus: 200,
      contentType: "text/html",
      capturedAt,
      body,
      extractorLocator: `tupu360-http-post-v1|page:${index + 1}`
    };
  });
  const pages = idsByPage.map((ids, index) => ({
    sequence: index,
    artifactLogicalKey: `main-${index}`,
    requestedOffset: index === 0 ? null : index * 10,
    requestedPageSize: index === 0 ? null : 10,
    rawJobIds: [...ids],
    validJobIds: [...ids],
    declaredPages: idsByPage.length,
    declaredCount: 10,
    nextPageSignalBefore: index === 0 ? "initial" : `offset-${index * 10}`,
    nextPageSignalAfter: index === idsByPage.length - 1 ? null : `offset-${(index + 1) * 10}`,
    responseFingerprintSha256: sha256Bytes(Buffer.from(artifacts[index]!.body, "utf8")).sha256,
    termination: (index === idsByPage.length - 1 ? "NEXT_ABSENT" : "CONTINUE") as "NEXT_ABSENT" | "CONTINUE",
    anomalyCodes: [] as [],
    capturedAt
  }));
  return deriveCanonicalPaginationEvidence({
    evidence: {
      captureTool: { name: "http-html", version: "1" },
      artifacts,
      pages,
      declaredCompleteness: {
        kind: "COMPLETE_PAGE_TRAVERSAL",
        value: pages.length,
        artifactLogicalKey: "main-0",
        extractorLocator: "tupu360-http-post-v1|page:1",
        scope: "SOURCE"
      },
      fetchCounts: {
        rawCount: idsByPage.flat().length,
        parsedCount: idsByPage.flat().length,
        validCount: idsByPage.flat().length,
        parseDiscardCount: 0,
        validationDiscardCount: 0
      },
      fetchLosses: []
    },
    expectedChannelIds: [],
    filteredOutput: true
  });
}

function browserValidation(idsByPage: readonly string[][] = [["v-1", "v-2"], ["v-3"]]) {
  return createViatrisBrowserTraversalValidation({
    sourceConfigSha256: sourcePlanConfigSha256(plan()),
    surfaceIds: [plan().source.surfaceId!],
    channelIds: plan().expectedChannels!.map(({ channelId }) => channelId),
    observedAt: capturedAt,
    expiresAt: "2026-08-19T12:00:00.000Z",
    pages: idsByPage.map((sourceJobIds, index) => ({
      pageNumber: index + 1,
      declaredTotalPages: idsByPage.length,
      sourceJobIds: [...sourceJobIds],
      nextControlPresent: index < idsByPage.length - 1
    }))
  });
}

function candidate(overrides: Partial<Parameters<typeof issueBGradeTraversalCertificate>[0]> = {}) {
  const sourcePlan = plan();
  const evidence = primaryEvidence();
  const rows = [job("v-1"), job("v-2"), job("v-3")];
  const reconciled = reconcileAdapterRows(rows.length, rows.length, rows, []);
  return {
    binding: {
      releaseCandidateId: "rc-1",
      batchId: "batch-1",
      sourceResultId: "result-1",
      sourceConfigSha256: sourcePlanConfigSha256(sourcePlan)
    },
    plan: sourcePlan,
    transportSuccess: true,
    adapterSuccess: true,
    evidence,
    paginationEvaluation: evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true }),
    reconciliation: reconciled.reconciliation,
    jobs: reconciled.jobs,
    independentValidation: browserValidation(),
    validationExecution: "CURRENT_RUN" as const,
    trigger: "INITIAL_QUALIFICATION" as const,
    now,
    ...overrides
  };
}

describe("B-grade independent traversal certificate", () => {
  it("selects the current Tupu rendered data-attribute control without trusting presentation text", () => {
    expect(__testOnlyViatrisNextRenderedControlIndex([
      { action: "pageTurn", pageNumber: "2", pageSize: "10" },
      { action: "pageTurn", pageNumber: "3", pageSize: "10" },
      { action: "pageTurn", pageNumber: "2", pageSize: "10" }
    ], 2)).toBe(0);
    expect(__testOnlyViatrisNextRenderedControlIndex([
      { action: "pageTurn", pageNumber: "24", pageSize: "10" }
    ], 25)).toBe(-1);
  });

  it.each([
    [[{ action: "go", pageNumber: "2", pageSize: "10" }], "control"],
    [[{ action: "pageTurn", pageNumber: "2x", pageSize: "10" }], "control"],
    [[
      { action: "pageTurn", pageNumber: "2", pageSize: "10" },
      { action: "pageTurn", pageNumber: "3", pageSize: "20" }
    ], "page-size"]
  ] as const)("rejects untrusted rendered pagination declarations %#", (controls, message) => {
    expect(() => __testOnlyViatrisNextRenderedControlIndex(controls, 2)).toThrow(message);
  });

  it("certifies exact complete traversal from different HTTP and rendered-browser paths", () => {
    const decision = issueBGradeTraversalCertificate(candidate());
    expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
    if (decision.status !== "CERTIFIED") throw new Error("Expected certificate");
    expect(decision.certificate).toMatchObject({
      grade: "B",
      scope: {
        companyId: "company-viatris",
        surfaceIds: ["surface-viatris-social"],
        channelIds: ["source:source-viatris-social:default"]
      },
      mainTraversal: { retrievalPath: "HTTP_TUPU360_ENTRY_PLUS_POST", pageCount: 2 },
      independentValidation: { retrievalPath: "PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION", pageCount: 2 },
      counts: { mainUniqueJobCount: 3, independentUniqueJobCount: 3, finalUniqueJobCount: 3 }
    });
    expect(verifyBGradeTraversalCertificateReceipt({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      expected: {
        releaseCandidateId: "rc-1",
        batchId: "batch-1",
        sourceResultId: "result-1",
        sourceId: "source-viatris-social",
        companyId: "company-viatris",
        sourceConfigSha256: sourcePlanConfigSha256(plan()),
        surfaceIds: [plan().source.surfaceId!],
        channelIds: plan().expectedChannels!.map(({ channelId }) => channelId)
      },
      now
    })).toMatchObject({ status: "PASS", grade: "B", finalUniqueJobCount: 3 });
    expect(verifyBGradeTraversalCertificateReceipt({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      expected: {
        releaseCandidateId: "rc-1", batchId: "batch-1", sourceResultId: "result-1",
        sourceId: "source-viatris-social", sourceConfigSha256: sourcePlanConfigSha256(plan())
      },
      now: new Date("2026-08-14T12:00:00.000Z")
    })).toMatchObject({ status: "PASS", grade: "B" });
  });

  it("downgrades to C when a declared page or job is missing", () => {
    expect(issueBGradeTraversalCertificate(candidate({ independentValidation: browserValidation([["v-1", "v-2"]]) })))
      .toMatchObject({ status: "REJECTED", resultingGrade: "C", blockerCodes: expect.arrayContaining(["INDEPENDENT_JOB_SET_MISMATCH"]) });
    const missingMainPage = primaryEvidence([["v-1", "v-2"]]);
    missingMainPage.pages[0]!.declaredPages = 2;
    expect(issueBGradeTraversalCertificate(candidate({ evidence: missingMainPage })))
      .toMatchObject({ status: "REJECTED", resultingGrade: "C", blockerCodes: expect.arrayContaining(["MAIN_TRAVERSAL_INCOMPLETE"]) });
  });

  it("rejects same-path pseudo validation and missing declared scope", () => {
    const samePath = { ...browserValidation(), retrievalPath: "HTTP_TUPU360_ENTRY_PLUS_POST" as const };
    expect(issueBGradeTraversalCertificate(candidate({ independentValidation: samePath })))
      .toMatchObject({ status: "REJECTED", resultingGrade: "C", blockerCodes: expect.arrayContaining(["VALIDATOR_PATH_NOT_INDEPENDENT"]) });
    const missingSurface = { ...browserValidation(), surfaceIds: [] };
    expect(issueBGradeTraversalCertificate(candidate({ independentValidation: missingSurface })))
      .toMatchObject({ status: "REJECTED", resultingGrade: "C", blockerCodes: expect.arrayContaining(["SCOPE_MISMATCH"]) });
    const forged = { ...browserValidation(), canonicalJobIdSetSha256: "f".repeat(64) };
    expect(issueBGradeTraversalCertificate(candidate({ independentValidation: forged })))
      .toMatchObject({ status: "REJECTED", resultingGrade: "C", blockerCodes: expect.arrayContaining(["VALIDATION_REFRESH_REQUIRED"]) });
  });

  it("requires fresh execution for initial/config/anomaly triggers but permits unexpired stable reuse", () => {
    for (const trigger of ["INITIAL_QUALIFICATION", "CONFIG_CHANGED", "ANOMALY_TRIGGERED"] as const) {
      expect(evaluateBGradeValidationRequirement({ trigger, validationExecution: "REUSED", validation: browserValidation(), now }))
        .toMatchObject({ acceptable: false, mustRunNow: true });
    }
    expect(evaluateBGradeValidationRequirement({ trigger: "STABLE_RUN", validationExecution: "REUSED", validation: browserValidation(), now }))
      .toEqual({ acceptable: true, mustRunNow: false, reason: "UNEXPIRED_STABLE_EVIDENCE_REUSE" });
    expect(evaluateBGradeValidationRequirement({
      trigger: "STABLE_RUN",
      validationExecution: "REUSED",
      validation: { ...browserValidation(), expiresAt: "2026-08-12T12:05:00.000Z" },
      now
    })).toMatchObject({ acceptable: false, reason: "VALIDATION_EXPIRED" });
    expect(evaluateBGradeValidationRequirement({
      trigger: "INITIAL_QUALIFICATION",
      validationExecution: "CURRENT_RUN",
      validation: browserValidation(),
      now: new Date("2026-08-12T13:00:00.001Z")
    })).toMatchObject({ acceptable: false, reason: "CURRENT_RUN_VALIDATION_TOO_OLD" });
  });

  it("reuses only an unexpired hash-bound stable validation receipt", () => {
    const decision = issueBGradeTraversalCertificate(candidate());
    if (decision.status !== "CERTIFIED") throw new Error("Expected certificate");
    expect(readReusableViatrisTraversalValidation({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      sourceConfigSha256: sourcePlanConfigSha256(plan()),
      now
    })).toMatchObject({ retrievalPath: "PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION" });
    const reusable = readReusableViatrisTraversalValidation({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      sourceConfigSha256: sourcePlanConfigSha256(plan()),
      now
    });
    expect(viatrisTraversalValidationMatchesCurrentJobs(reusable, [job("v-1"), job("v-2"), job("v-3")]))
      .toBe(true);
    expect(viatrisTraversalValidationMatchesCurrentJobs(reusable, [job("v-1"), job("v-2"), job("v-4")]))
      .toBe(false);
    expect(() => readReusableViatrisTraversalValidation({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      sourceConfigSha256: sourcePlanConfigSha256(plan()),
      now: new Date("2026-08-20T12:05:00.000Z")
    })).toThrow(/expired/i);
    expect(() => readReusableViatrisTraversalValidation({
      certificate: decision.certificate,
      certificateSha256: "0".repeat(64),
      sourceConfigSha256: sourcePlanConfigSha256(plan()),
      now
    })).toThrow(/hash/i);
  });

  it("keeps historical Viatris v1 certificates reusable after v2 issuance begins", () => {
    const current = issueBGradeTraversalCertificate(candidate());
    if (current.status !== "CERTIFIED") throw new Error("Expected current certificate");
    if (current.certificate.schemaVersion !== "b-grade-independent-traversal-v2") {
      throw new Error("Expected current B-grade certificate v2");
    }
    const currentValidation = current.certificate.independentValidation;
    if (currentValidation.schemaVersion !== "viatris-browser-traversal-validator-v2") {
      throw new Error("Expected Viatris v2 validation");
    }
    const legacyPages = currentValidation.pages.map(({ matchKeys, ...page }) => ({ ...page, sourceJobIds: matchKeys }));
    const legacyValidation = {
      ...currentValidation,
      schemaVersion: "viatris-browser-traversal-validator-v1" as const,
      pages: legacyPages,
      canonicalJobIdSetSha256: currentValidation.canonicalMatchKeySetSha256,
      artifactSha256: sha256({
        sourceId: currentValidation.sourceId,
        retrievalPath: currentValidation.retrievalPath,
        pages: legacyPages,
        observedAt: currentValidation.observedAt
      })
    } as Record<string, unknown>;
    delete legacyValidation.matchKeyKind;
    delete legacyValidation.canonicalMatchKeySetSha256;
    const currentMain = current.certificate.mainTraversal;
    const legacyCertificate = {
      ...current.certificate,
      schemaVersion: "b-grade-independent-traversal-v1" as const,
      mainTraversal: {
        retrievalPath: "HTTP_TUPU360_ENTRY_PLUS_POST" as const,
        pageCount: currentMain.pageCount,
        terminalEvent: currentMain.terminalEvent,
        paginationTraceSha256: currentMain.paginationTraceSha256,
        canonicalJobIdSetSha256: currentMain.canonicalMatchKeySetSha256
      },
      independentValidation: legacyValidation,
      counts: { ...current.certificate.counts, validationDiscardCount: 0 as const }
    };
    expect(readReusableViatrisTraversalValidation({
      certificate: legacyCertificate,
      certificateSha256: sha256(legacyCertificate),
      sourceConfigSha256: sourcePlanConfigSha256(plan()),
      now
    })).toMatchObject({ schemaVersion: "viatris-browser-traversal-validator-v1" });
  });

  it("runs the representative Viatris HTTP crawl through an independent browser receipt into an atomic B-grade commit", async () => {
    const sourcePlan = plan();
    const row = (id: string) => `<div class="position-item"><div class="e-title"><a href="/Viatris/position/detail?positionId=${id}">Role ${id}</a></div><div class="e-city">上海</div></div>`;
    const page = (rows: string) => `<div class="position-list-body">${rows}</div><ul id="pageTurnUl"><li>共2页</li><li onclick="pageTurn(2,10.0)">2</li></ul>`;
    const fetched = await createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => ({
        status: 200,
        body: request.method === "POST" ? page(row("v-3")) : page(`${row("v-1")}${row("v-2")}`),
        finalUrl: request.url,
        contentType: "text/html; charset=utf-8",
        capturedAt
      })
    })(sourcePlan);
    expect(fetched).toMatchObject({ ok: true, fetchEvidence: { pages: [{}, {}] } });
    const result = await runSourceCrawl(sourcePlan, { fetch: async () => fetched });
    expect(result).toMatchObject({
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { structuredJobCount: 3, completenessStatus: "VERIFIED" }
    });
    if (!result.fetchEvidence) throw new Error("Expected exact Viatris fetch evidence");

    const sourceIds = [sourcePlan.source.id];
    const identity = {
      releaseCandidateId: "rc-1",
      commitSha: "commit-1",
      rosterSha256: "roster-1",
      sourcePlanSha256: "plan-1",
      sourceConfigSha256: "config-1",
      adapterBundleSha256: "adapter-1",
      batchKind: "SCHEDULED" as const,
      ownerId: "ticket-4-test",
      expectedPlannedSourceIds: sourceIds,
      expectedPlannedSourceSetSha256: hashCanonicalStringSet(sourceIds),
      expectedPlannedSourceCount: 1
    };
    const pending = buildPendingRuntimeBatch("batch-1", [sourcePlan], identity, new Date(capturedAt)).sources[0]!;
    const archived: ArchivedEvidenceArtifact[] = result.fetchEvidence.artifacts.map((artifact) => {
      const bytes = typeof artifact.body === "string" ? Buffer.from(artifact.body, "utf8") : Buffer.from(artifact.body);
      const digest = sha256Bytes(bytes);
      return {
        id: artifact.id,
        logicalKey: artifact.logicalKey,
        releaseCandidateId: identity.releaseCandidateId,
        batchId: "batch-1",
        sourceId: sourcePlan.source.id,
        sourceResultId: pending.id,
        ...(artifact.channelId ? { channelId: artifact.channelId } : {}),
        kind: artifact.kind,
        ...(artifact.requestedUrl ? { requestedUrl: artifact.requestedUrl } : {}),
        ...(artifact.finalUrl ? { finalUrl: artifact.finalUrl } : {}),
        ...(artifact.httpStatus ? { httpStatus: artifact.httpStatus } : {}),
        ...(artifact.contentType ? { contentType: artifact.contentType } : {}),
        capturedAt: new Date(artifact.capturedAt),
        sha256: digest.sha256,
        byteCount: digest.byteCount,
        path: `outputs/p0-rc/rc-1/${artifact.logicalKey}.html`,
        extractorLocator: artifact.extractorLocator,
        captureToolName: result.fetchEvidence!.captureTool.name,
        captureToolVersion: result.fetchEvidence!.captureTool.version
      };
    });
    const independentValidation = await runViatrisBrowserTraversalValidator({
      entryUrl: sourcePlan.source.officialEntryUrl,
      sourceConfigSha256: pending.sourceConfigHash,
      surfaceIds: pending.officialSurfaceIds,
      channelIds: pending.officialChannelIds,
      capture: async () => ({
        observedAt: capturedAt,
        pages: [
          { pageNumber: 1, declaredTotalPages: 2, sourceJobIds: ["v-1", "v-2"], nextControlPresent: true },
          { pageNumber: 2, declaredTotalPages: 2, sourceJobIds: ["v-3"], nextControlPresent: false }
        ]
      })
    });
    const uncertified = buildAtomicRuntimeCommit({
      plan: sourcePlan,
      pending,
      identity,
      batchId: "batch-1",
      result,
      previousJobs: [],
      baselineCompletedBeforeCrawl: true,
      artifacts: archived
    });
    expect(uncertified.sourceResult).toMatchObject({
      completenessState: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      completenessCertificate: null,
      blockerCode: "B_GRADE_CERTIFICATE_NOT_ISSUED"
    });
    const commit = buildAtomicRuntimeCommit({
      plan: sourcePlan,
      pending,
      identity,
      batchId: "batch-1",
      result,
      previousJobs: [],
      baselineCompletedBeforeCrawl: true,
      artifacts: archived,
      independentTraversalValidation: independentValidation,
      independentTraversalValidationExecution: "CURRENT_RUN",
      independentTraversalValidationTrigger: "ANOMALY_TRIGGERED",
      trustedCompletenessBaseline: {
        sourceId: sourcePlan.source.id,
        sourceResultId: "previous-verified-result",
        sourceConfigSha256: pending.sourceConfigHash,
        certificateGrade: "B",
        certificateSha256: "a".repeat(64),
        certifiedJobCount: 4,
        verifiedAt: "2026-08-11T12:00:00.000Z"
      }
    });
    expect(commit.sourceResult, JSON.stringify(commit.sourceResult)).toMatchObject({
      completenessState: "VERIFIED",
      completenessCertificate: { grade: "B", independentValidation: { validatorImplementationId: "viatris-playwright-ui-traversal-v1" } },
      completenessCertificateSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      baselinePreviousSourceResultId: "previous-verified-result",
      baselinePreviousJobCount: 4,
      baselineChangeReason: "INDEPENDENT_VALIDATION_CONFIRMED_DECREASE"
    });
  });
});
