import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildFixedCohortCompletenessAudit, parseFixedCohortCompletenessAuditReport,
  type FixedCohortAuditSourceInput } from
  "../../src/release/fixedCohortCompletenessAudit";
import { P0_LAUNCH_MANIFEST } from "../../src/release/launchManifest";
import { projectFailedFixedCohortAuditSource } from "../../src/release/fixedCohortAuditSourceProjection";

describe("fixed cohort completeness audit", () => {
  it("reports every frozen company and creates deterministic repair groups of at most five", () => {
    const report = buildFixedCohortCompletenessAudit(input());
    expect(report.decision).toBe("AUDIT_COMPLETE");
    expect(report.companyCount).toBe(50);
    expect(report.foreignCompanyCount).toBe(30);
    expect(report.companies).toHaveLength(50);
    expect(report.companies.every(({ blockers }) => blockers.includes("A_OR_B_CERTIFICATE_MISSING"))).toBe(true);
    expect(report.repairFrontier.every(({ companyIds }) => companyIds.length >= 1 && companyIds.length <= 5)).toBe(true);
    expect(new Set(report.repairFrontier.flatMap(({ companyIds }) => companyIds)).size).toBe(50);
  });

  it("reads only a content-bound exact frozen-cohort audit", () => {
    const report = buildFixedCohortCompletenessAudit(input());
    expect(parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(report)))).toEqual(report);

    const tampered = { ...report, companyCount: 49 };
    expect(() => parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(tampered))))
      .toThrow(/hash/u);

    const { contentSha256: _oldHash, ...base } = report;
    const missing = { ...base, companies: base.companies.slice(1) };
    const rehashed = { ...missing, contentSha256: createHash("sha256").update(JSON.stringify(missing)).digest("hex") };
    expect(() => parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(rehashed))))
      .toThrow(/cohort/u);
    expect(() => parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify({ ...report, extra: true }))))
      .toThrow(/schema/u);

    const thinRows = base.companies.map(({ companyId, sourceId }) => ({ companyId, sourceId, blockers: [] }));
    const thinBase = { ...base, companies: thinRows, repairFrontier: [] };
    const thin = { ...thinBase, contentSha256: createHash("sha256").update(JSON.stringify(thinBase)).digest("hex") };
    expect(() => parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(thin))))
      .toThrow(/company evidence/u);
  });

  it("round-trips a real failed source without pretending a canonical output commitment exists", () => {
    const value = input(), failed = value.sources[0]!;
    Object.assign(failed, { canonicalJobSetSha256: null, evidenceArtifacts: [], paginationEvidence: [], pagesVisited: 0,
      expectedEvidenceKind: null, transportState: "FAILED", adapterState: "SKIPPED", completenessState: "FAILED",
      atomicCommitState: "NOT_ATTEMPTED", failureCategory: "UNCLASSIFIED_SOURCE_FAILURE",
      failureDiagnosticCode: "FETCH_FAILED_CLOSED", failureCode: "SOURCE_TRANSPORT_FAILED" });
    const report = buildFixedCohortCompletenessAudit(value);
    expect(report.companies.find(({ sourceId }) => sourceId === failed.sourceId)?.blockers)
      .toContain("EVIDENCE_COMMITMENT_INVALID");
    expect(parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(report)))).toEqual(report);
  });

  it("preserves an atomic rollback identity and failure code when the transaction wrote no observation", () => {
    const value = input(), existing = value.sources[0]!;
    value.sources[0] = projectFailedFixedCohortAuditSource({
      plan: { companyId: existing.companyId, sourceId: existing.sourceId, adapterFamily: existing.adapterFamily,
        plannedSurfaceIds: existing.plannedSurfaceIds, plannedChannelIds: existing.plannedChannelIds },
      result: { sourceResultId: "persisted-atomic-failure", sourceConfigSha256: existing.sourceConfigSha256,
        officialSurfaceIds: existing.officialSurfaceIds, officialChannelIds: existing.officialChannelIds,
        expectedEvidenceKind: null, expectedJobCount: null, finalJobCount: 0,
        transportState: "SUCCEEDED", adapterState: "SUCCEEDED", completenessState: "FAILED",
        atomicCommitState: "ROLLED_BACK", blockerCode: null, failureCategory: "EVIDENCE_PERSISTENCE_FAILURE",
        failureDiagnosticCode: "EVIDENCE_PROCESSING_FAILED", failureCode: "ATOMIC_EVIDENCE_COMMIT_FAILED" }
    });
    const report = buildFixedCohortCompletenessAudit(value);
    const row = report.companies.find(({ sourceId }) => sourceId === existing.sourceId)!;
    expect(row).toMatchObject({ sourceResultId: "persisted-atomic-failure",
      failureCode: "ATOMIC_EVIDENCE_COMMIT_FAILED", failureClass: "PRODUCT_DEFECT", failureStage: "PERSISTENCE" });
    expect(report.repairFrontier.find(({ sourceIds }) => sourceIds.includes(existing.sourceId))?.rootCause)
      .toBe("ATOMIC_EVIDENCE_COMMIT_FAILED");
  });

  it("marks a missing or substituted frozen source as an invalid audit without hiding the other rows", () => {
    const value = input();
    value.observedSourceIds = value.observedSourceIds.slice(1);
    const report = buildFixedCohortCompletenessAudit(value);
    expect(report.decision).toBe("AUDIT_INVALID");
    expect(report.invalidReasons).toContain("OBSERVED_SOURCE_DENOMINATOR_MISMATCH");
    expect(report.companies).toHaveLength(50);
  });

  it("keeps all 50 report rows but invalidates a batch with no real source results or with an extra source", () => {
    const empty = input(); empty.observedSourceIds = [];
    expect(buildFixedCohortCompletenessAudit(empty)).toMatchObject({ decision: "AUDIT_INVALID" });
    const extra = input(); extra.observedSourceIds.push("source-substitute-social");
    expect(buildFixedCohortCompletenessAudit(extra).invalidReasons).toContain("OBSERVED_SOURCE_DENOMINATOR_MISMATCH");
  });

  it("does not treat a plausible or repeated job count as completeness proof", () => {
    const value = input();
    const first = value.sources[0]!;
    first.grade = "A";
    first.expectedJobCount = 100;
    first.finalJobCount = 100;
    first.certificate = thinCertificate(first, value.releaseCandidateId, value.batchId);
    first.certificateSha256 = null;
    const row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) => sourceId === first.sourceId);
    expect(row?.blockers).toContain("CERTIFICATE_INVALID");
  });

  it("distinguishes temporary, configuration, product and evidence failure classes", () => {
    const value = input();
    Object.assign(value.sources[0]!, { transportState: "FAILED", failureCategory: "TEMPORARY_OFFICIAL_SOURCE_FAILURE" });
    Object.assign(value.sources[1]!, { failureCategory: "OFFICIAL_SOURCE_REVIEW_REQUIRED",
      failureDiagnosticCode: "FETCH_FAILED_CLOSED", failureCode: "SOURCE_CONFIG_INVALID" });
    Object.assign(value.sources[2]!, { adapterState: "FAILED", failureCategory: "UNCLASSIFIED_SOURCE_FAILURE" });
    const classes = buildFixedCohortCompletenessAudit(value).companies.reduce<Record<string, string | null>>((all, row) => {
      all[row.sourceId] = row.failureClass; return all;
    }, {});
    expect(classes[value.sources[0]!.sourceId]).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
    expect(classes[value.sources[1]!.sourceId]).toBe("CONFIGURATION_ERROR");
    expect(classes[value.sources[2]!.sourceId]).toBe("PRODUCT_DEFECT");
    expect(classes[value.sources[3]!.sourceId]).toBe("EVIDENCE_INSUFFICIENT");
  });

  it("preserves a committed B-grade failure code as the repair root cause", () => {
    const value = input(), source = value.sources.find(({ sourceId }) => sourceId === "source-kelun-social")!;
    Object.assign(source, {
      completenessState: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      blockerCode: "B_GRADE_BROWSER_NAVIGATION_FAILED"
    });

    const report = buildFixedCohortCompletenessAudit(value);
    const row = report.companies.find(({ sourceId }) => sourceId === source.sourceId)!;
    expect(row).toMatchObject({ blockerCode: "B_GRADE_BROWSER_NAVIGATION_FAILED" });
    expect(report.repairFrontier.find(({ sourceIds }) => sourceIds.includes(source.sourceId))?.rootCause)
      .toBe("B_GRADE_BROWSER_NAVIGATION_FAILED");
    expect(parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(report)))).toEqual(report);
  });

  it("clusters legal diagnostics by explicit common root cause rather than incidental missing evidence", () => {
    const value = input();
    const diagnostics = ["OFFICIAL_HTTP_429", "OFFICIAL_HTTP_TIMEOUT"] as const;
    for (const [index, diagnostic] of diagnostics.entries()) {
      Object.assign(value.sources[index]!, { transportState: "FAILED", evidenceArtifacts: [], paginationEvidence: [],
        failureCategory: "TEMPORARY_OFFICIAL_SOURCE_FAILURE", failureDiagnosticCode: diagnostic });
    }
    const frontier = buildFixedCohortCompletenessAudit(value).repairFrontier;
    expect(frontier.some(({ rootCause }) => rootCause.endsWith("OFFICIAL_HTTP_429"))).toBe(true);
    expect(frontier.some(({ rootCause }) => rootCause.endsWith("OFFICIAL_HTTP_TIMEOUT"))).toBe(true);
  });

  it("rejects duplicated planned or observed scope ids", () => {
    const value = input();
    const source = value.sources[0]!;
    source.officialChannelIds = [source.plannedChannelIds[0]!, source.plannedChannelIds[0]!];
    expect(buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) =>
      sourceId === source.sourceId)?.blockers).toContain("OFFICIAL_SCOPE_MISMATCH");
  });

  it("keeps multi-channel pagination separate and rejects non-contiguous page evidence", () => {
    const value = input(), source = value.sources[0]!, secondChannel = "channel:second";
    source.plannedChannelIds = [...source.plannedChannelIds, secondChannel];
    source.officialChannelIds = [...source.officialChannelIds, secondChannel];
    source.paginationEvidence = [...source.paginationEvidence, {
      ...source.paginationEvidence[0]!, channelId: secondChannel, sequence: 1,
      declaredTotal: 20, declaredCount: 20, declaredPages: 1
    }];
    source.pagesVisited = 2; source.totalPages = 2;
    let row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) => sourceId === source.sourceId)!;
    expect(row.paginationByChannel).toHaveLength(2);
    source.paginationEvidence = source.paginationEvidence.map((page, index) => index === 1 ? { ...page, sequence: 2 } : page);
    row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) => sourceId === source.sourceId)!;
    expect(row.blockers).toContain("PAGINATION_EVIDENCE_INVALID");
  });

  it("treats null pagination channels as the one declared default channel", () => {
    const value = input(), source = value.sources[0]!;
    source.paginationEvidence = source.paginationEvidence.map((page) => ({ ...page, channelId: null }));
    const row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) => sourceId === source.sourceId)!;
    expect(row.blockers).not.toContain("PAGINATION_EVIDENCE_INVALID");
    expect(row.paginationByChannel).toEqual([expect.objectContaining({ channelId: source.officialChannelIds[0] })]);
  });

  it("replays an exact later-zero Workday declaration from the first official total", () => {
    const value = input();
    const source = value.sources.find(({ sourceId }) => sourceId === "source-amgen-china-social")!;
    const first = source.paginationEvidence[0]!;
    source.evidenceArtifacts = [...source.evidenceArtifacts, {
      id: "artifact:amgen:page-2", path: "evidence/amgen-page-2.json", sha256: "1".repeat(64)
    }];
    source.paginationEvidence = [
      { ...first, declaredTotal: 30, declaredCount: null, declaredPages: 2,
        nextPageSignalAfter: "20", termination: "CONTINUE" },
      { ...first, artifactId: "artifact:amgen:page-2", sequence: 1,
        requestedOffset: 20, returnedOffset: 20, requestedPage: 1, returnedPage: 1,
        responseFingerprintSha256: "2".repeat(64), rawJobIdSetSha256: "3".repeat(64),
        validJobIdSetSha256: "4".repeat(64), declaredTotal: 0, declaredCount: null,
        declaredPages: 0, nextPageSignalBefore: "20", nextPageSignalAfter: null,
        termination: "NEXT_ABSENT" }
    ];
    source.expectedEvidenceKind = "OFFICIAL_TOTAL_COUNT";
    source.expectedJobCount = 30;
    source.finalJobCount = 30;
    source.pagesVisited = 2;
    source.totalPages = null;

    const row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) =>
      sourceId === source.sourceId)!;
    expect(row.blockers).not.toContain("PAGINATION_EVIDENCE_INVALID");
    expect(row.paginationByChannel).toEqual([expect.objectContaining({
      declaredTotal: 30, declaredPages: 2, pageCount: 2
    })]);
  });

  it("rejects a later-zero Workday declaration when the final committed count disagrees", () => {
    const value = input();
    const source = value.sources.find(({ sourceId }) => sourceId === "source-amgen-china-social")!;
    const first = source.paginationEvidence[0]!;
    source.evidenceArtifacts = [...source.evidenceArtifacts, {
      id: "artifact:amgen:page-2", path: "evidence/amgen-page-2.json", sha256: "1".repeat(64)
    }];
    source.paginationEvidence = [
      { ...first, declaredTotal: 30, declaredCount: null, declaredPages: 2,
        nextPageSignalAfter: "20", termination: "CONTINUE" },
      { ...first, artifactId: "artifact:amgen:page-2", sequence: 1,
        requestedOffset: 20, returnedOffset: 20, requestedPage: 1, returnedPage: 1,
        responseFingerprintSha256: "2".repeat(64), rawJobIdSetSha256: "3".repeat(64),
        validJobIdSetSha256: "4".repeat(64), declaredTotal: 0, declaredCount: null,
        declaredPages: 0, nextPageSignalBefore: "20", nextPageSignalAfter: null,
        termination: "NEXT_ABSENT" }
    ];
    source.expectedEvidenceKind = "OFFICIAL_TOTAL_COUNT";
    source.expectedJobCount = 30;
    source.finalJobCount = 29;
    source.pagesVisited = 2;
    source.totalPages = 2;

    const row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) =>
      sourceId === source.sourceId)!;
    expect(row.blockers).toContain("PAGINATION_EVIDENCE_INVALID");
  });

  it("rejects a later-zero Workday declaration when the persisted total-page count disagrees", () => {
    const value = input();
    const source = value.sources.find(({ sourceId }) => sourceId === "source-amgen-china-social")!;
    const first = source.paginationEvidence[0]!;
    source.evidenceArtifacts = [...source.evidenceArtifacts, {
      id: "artifact:amgen:page-2", path: "evidence/amgen-page-2.json", sha256: "1".repeat(64)
    }];
    source.paginationEvidence = [
      { ...first, declaredTotal: 30, declaredCount: null, declaredPages: 2,
        nextPageSignalAfter: "20", termination: "CONTINUE" },
      { ...first, artifactId: "artifact:amgen:page-2", sequence: 1,
        requestedOffset: 20, returnedOffset: 20, requestedPage: 1, returnedPage: 1,
        responseFingerprintSha256: "2".repeat(64), rawJobIdSetSha256: "3".repeat(64),
        validJobIdSetSha256: "4".repeat(64), declaredTotal: 0, declaredCount: null,
        declaredPages: 0, nextPageSignalBefore: "20", nextPageSignalAfter: null,
        termination: "NEXT_ABSENT" }
    ];
    source.expectedEvidenceKind = "OFFICIAL_TOTAL_COUNT";
    source.expectedJobCount = 30;
    source.finalJobCount = 30;
    source.pagesVisited = 2;
    source.totalPages = 3;

    const row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) =>
      sourceId === source.sourceId)!;
    expect(row.blockers).toContain("PAGINATION_EVIDENCE_INVALID");
  });

  const laterZeroRejectionCases: readonly [string, {
    sourceId?: string;
    lastTermination?: string;
  }][] = [
    ["a non-audited source", { sourceId: "source-abbvie-china-social" }],
    ["a non-terminal last page", { lastTermination: "MAX_PAGE_LIMIT" }]
  ];
  it.each(laterZeroRejectionCases)(
    "rejects later-zero reconciliation for %s", (_label, mutation) => {
    const value = input();
    const source = value.sources.find(({ sourceId }) => sourceId === "source-amgen-china-social")!;
    const first = source.paginationEvidence[0]!;
    source.evidenceArtifacts = [...source.evidenceArtifacts, {
      id: "artifact:amgen:page-2", path: "evidence/amgen-page-2.json", sha256: "1".repeat(64)
    }];
    source.paginationEvidence = [
      { ...first, declaredTotal: 30, declaredPages: 2, nextPageSignalAfter: "20", termination: "CONTINUE" },
      { ...first, artifactId: "artifact:amgen:page-2", sequence: 1, declaredTotal: 0, declaredPages: 0,
        responseFingerprintSha256: "2".repeat(64), rawJobIdSetSha256: "3".repeat(64),
        validJobIdSetSha256: "4".repeat(64), termination: mutation.lastTermination ?? "NEXT_ABSENT" }
    ];
    source.expectedEvidenceKind = "OFFICIAL_TOTAL_COUNT";
    source.expectedJobCount = 30;
    source.finalJobCount = 30;
    source.pagesVisited = 2;
    source.totalPages = 2;
    if (mutation.sourceId) source.sourceId = mutation.sourceId;
    const row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceResultId }) =>
      sourceResultId === source.sourceResultId)!;
    expect(row.blockers).toContain("PAGINATION_EVIDENCE_INVALID");
    }
  );

  it("rejects an unlabelled pagination page when more than one official channel is declared", () => {
    const value = input(), source = value.sources[0]!;
    source.plannedChannelIds = [...source.plannedChannelIds, "channel:second"];
    source.officialChannelIds = [...source.officialChannelIds, "channel:second"];
    source.paginationEvidence = source.paginationEvidence.map((page) => ({ ...page, channelId: null }));
    const row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) => sourceId === source.sourceId)!;
    expect(row.blockers).toContain("PAGINATION_EVIDENCE_INVALID");
  });

  it("rejects a declared channel without pagination evidence and keeps derived config roots separate", () => {
    const value = input(), source = value.sources[0]!, missing = "channel:missing";
    source.plannedChannelIds = [...source.plannedChannelIds, missing];
    source.officialChannelIds = [...source.officialChannelIds, missing];
    const report = buildFixedCohortCompletenessAudit(value);
    expect(report.companies.find(({ sourceId }) => sourceId === source.sourceId)?.blockers)
      .toContain("PAGINATION_EVIDENCE_INVALID");
    const scopeRoot = report.repairFrontier.find(({ sourceIds }) => sourceIds.includes(source.sourceId))?.rootCause;
    expect(scopeRoot).toBe("PAGINATION_EVIDENCE_INVALID");
    const manifest = input(); manifest.sources[1]!.companyId = "company-substitute";
    manifest.sources[1]!.failureCode = "HTML_FETCH_FAILED";
    expect(buildFixedCohortCompletenessAudit(manifest).repairFrontier.find(({ sourceIds }) =>
      sourceIds.includes(manifest.sources[1]!.sourceId))?.rootCause).toBe("MANIFEST_BINDING_MISMATCH");
  });
});

function input(): { generatedAt: Date; releaseCandidateId: string; batchId: string; observedSourceIds: string[];
  sources: FixedCohortAuditSourceInput[] } {
  const sources = P0_LAUNCH_MANIFEST.companies.map((company): FixedCohortAuditSourceInput => ({
      sourceResultId: `result:${company.source.sourceId}`, companyId: company.companyId, sourceId: company.source.sourceId,
      adapterFamily: company.source.sourceId.split("-")[1] ?? "unknown",
      grade: "C", sourceConfigSha256: "a".repeat(64), canonicalJobSetSha256: "b".repeat(64),
      canonicalRawEvidenceIdSetSha256: "e".repeat(64), certificate: null,
      certificateSha256: null, plannedSurfaceIds: [`surface:${company.source.sourceId}`],
      plannedChannelIds: [`channel:${company.source.sourceId}`], officialSurfaceIds: [`surface:${company.source.sourceId}`],
      officialChannelIds: [`channel:${company.source.sourceId}`], evidenceArtifacts: [{ id: `artifact:${company.source.sourceId}`,
        path: `evidence/${company.source.sourceId}.json`, sha256: "c".repeat(64) }],
      paginationEvidence: [{ artifactId: `artifact:${company.source.sourceId}`, sequence: 0,
        channelId: `channel:${company.source.sourceId}`, requestedCursor: null,
        returnedCursor: null, requestedOffset: 0, returnedOffset: 0, requestedPage: 1, returnedPage: 1,
        requestedPageSize: 20, returnedPageSize: 10, responseFingerprintSha256: "d".repeat(64),
        rawJobIdSetSha256: "e".repeat(64), validJobIdSetSha256: "f".repeat(64),
        declaredTotal: 10, declaredCount: 10, declaredPages: 1, nextPageSignalBefore: null,
        nextPageSignalAfter: null, termination: "NEXT_ABSENT", anomalyCodes: [],
        capturedAt: "2026-08-12T23:00:00.000Z" }],
      expectedEvidenceKind: "COMPLETE_PAGE_TRAVERSAL", expectedJobCount: 10,
      pagesVisited: 1, totalPages: 1, finalJobCount: 10, transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
      completenessState: "VERIFIED", atomicCommitState: "COMMITTED", failureCategory: null,
      blockerCode: null, failureDiagnosticCode: null, failureCode: null
    }));
  return {
    generatedAt: new Date("2026-08-13T00:00:00.000Z"), releaseCandidateId: "rc-1", batchId: "batch-1",
    observedSourceIds: sources.map(({ sourceId }) => sourceId), sources
  };
}

function thinCertificate(source: FixedCohortAuditSourceInput, releaseCandidateId: string, batchId: string): unknown {
  return { grade: source.grade, binding: { releaseCandidateId, batchId, sourceId: source.sourceId,
    sourceConfigSha256: source.sourceConfigSha256 }, scope: { companyId: source.companyId, sourceId: source.sourceId },
    output: { canonicalJobSetSha256: source.canonicalJobSetSha256 } };
}
