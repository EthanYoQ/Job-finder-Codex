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
    value.sources = value.sources.slice(1);
    const report = buildFixedCohortCompletenessAudit(value);
    expect(report.decision).toBe("AUDIT_INVALID");
    expect(report.invalidReasons).toContain("AUDIT_SOURCE_DENOMINATOR_MISMATCH");
    expect(report.companies).toHaveLength(49);
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
    Object.assign(value.sources[1]!, { failureCategory: "OFFICIAL_SOURCE_REVIEW_REQUIRED", failureDiagnosticCode: "CONFIG_CHANGED" });
    Object.assign(value.sources[2]!, { adapterState: "FAILED", failureCategory: "UNCLASSIFIED_SOURCE_FAILURE" });
    const classes = buildFixedCohortCompletenessAudit(value).companies.reduce<Record<string, string | null>>((all, row) => {
      all[row.sourceId] = row.failureClass; return all;
    }, {});
    expect(classes[value.sources[0]!.sourceId]).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
    expect(classes[value.sources[1]!.sourceId]).toBe("CONFIGURATION_ERROR");
    expect(classes[value.sources[2]!.sourceId]).toBe("PRODUCT_DEFECT");
    expect(classes[value.sources[3]!.sourceId]).toBe("EVIDENCE_INSUFFICIENT");
  });
});

function input(): { generatedAt: Date; releaseCandidateId: string; batchId: string; sources: FixedCohortAuditSourceInput[] } {
  return {
    generatedAt: new Date("2026-08-13T00:00:00.000Z"), releaseCandidateId: "rc-1", batchId: "batch-1",
    sources: P0_LAUNCH_MANIFEST.companies.map((company): FixedCohortAuditSourceInput => ({
      sourceResultId: `result:${company.source.sourceId}`, companyId: company.companyId, sourceId: company.source.sourceId,
      adapterFamily: company.source.sourceId.split("-")[1] ?? "unknown",
      grade: "C", sourceConfigSha256: "a".repeat(64), canonicalJobSetSha256: "b".repeat(64), certificate: null,
      certificateSha256: null, officialSurfaceIds: [`surface:${company.source.sourceId}`], officialChannelIds: [],
      evidenceLocations: [`evidence/${company.source.sourceId}.json`], expectedEvidenceKind: null, expectedJobCount: null,
      pagesVisited: 1, totalPages: 1, finalJobCount: 10, transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
      completenessState: "VERIFIED", atomicCommitState: "COMMITTED", failureCategory: null,
      failureDiagnosticCode: null, failureCode: null
    }))
  };
}

function thinCertificate(source: FixedCohortAuditSourceInput, releaseCandidateId: string, batchId: string): unknown {
  return { grade: source.grade, binding: { releaseCandidateId, batchId, sourceId: source.sourceId,
    sourceConfigSha256: source.sourceConfigSha256 }, scope: { companyId: source.companyId, sourceId: source.sourceId },
    output: { canonicalJobSetSha256: source.canonicalJobSetSha256 } };
}
