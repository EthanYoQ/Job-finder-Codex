import { describe, expect, it } from "vitest";
import { buildFixedCohortCompletenessAudit, type FixedCohortAuditSourceInput } from
  "../../src/release/fixedCohortCompletenessAudit";
import { P0_LAUNCH_MANIFEST } from "../../src/release/launchManifest";

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
      ...source.paginationEvidence[0]!, channelId: secondChannel, sequence: 2,
      declaredTotal: 20, declaredCount: 20, declaredPages: 1
    }];
    source.pagesVisited = 2; source.totalPages = 2;
    let row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) => sourceId === source.sourceId)!;
    expect(row.paginationByChannel).toHaveLength(2);
    source.paginationEvidence = source.paginationEvidence.map((page, index) => index === 1 ? { ...page, sequence: 3 } : page);
    row = buildFixedCohortCompletenessAudit(value).companies.find(({ sourceId }) => sourceId === source.sourceId)!;
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
    expect(buildFixedCohortCompletenessAudit(manifest).repairFrontier.find(({ sourceIds }) =>
      sourceIds.includes(manifest.sources[1]!.sourceId))?.rootCause).toBe("MANIFEST_BINDING_MISMATCH");
  });
});

function input(): { generatedAt: Date; releaseCandidateId: string; batchId: string; observedSourceIds: string[];
  sources: FixedCohortAuditSourceInput[] } {
  const sources = P0_LAUNCH_MANIFEST.companies.map((company): FixedCohortAuditSourceInput => ({
      sourceResultId: `result:${company.source.sourceId}`, companyId: company.companyId, sourceId: company.source.sourceId,
      adapterFamily: company.source.sourceId.split("-")[1] ?? "unknown",
      grade: "C", sourceConfigSha256: "a".repeat(64), canonicalJobSetSha256: "b".repeat(64), certificate: null,
      certificateSha256: null, plannedSurfaceIds: [`surface:${company.source.sourceId}`],
      plannedChannelIds: [`channel:${company.source.sourceId}`], officialSurfaceIds: [`surface:${company.source.sourceId}`],
      officialChannelIds: [`channel:${company.source.sourceId}`], evidenceArtifacts: [{ id: `artifact:${company.source.sourceId}`,
        path: `evidence/${company.source.sourceId}.json`, sha256: "c".repeat(64) }],
      paginationEvidence: [{ artifactId: `artifact:${company.source.sourceId}`, sequence: 1,
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
      failureDiagnosticCode: null, failureCode: null
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
