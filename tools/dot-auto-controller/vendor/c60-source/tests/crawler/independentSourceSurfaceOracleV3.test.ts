import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalPhase1InScopeRosterMembers } from "../../src/data/phase1ScopePolicy";
import {
  canonicalIndependentCompanyAuditsSha256,
  canonicalIndependentOracleMembersSha256,
  independentCoverageSetSha256,
  independentHopChainProvenanceRootSha256,
  independentReviewProvenanceRootSha256,
  type IndependentCompanyAudit
} from "../../src/crawler/independentSourceSurfaceOracle";
import { runIndependentOracleV3Scenario } from "./helpers/independentOracleV3Scenario";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function audits(): IndependentCompanyAudit[] {
  return canonicalPhase1InScopeRosterMembers.map(({ id: companyId, category }) => ({
    companyId,
    category,
    status: "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME",
    capturedAt: "2026-07-12T00:00:00.000Z",
    officialWebsiteUrl: `https://example.com/${companyId}`,
    officialWebsiteSha256: sha(`website:${companyId}`),
    officialEntryIds: [],
    evidenceArtifacts: [{ logicalKey: `official-website/${companyId}`, contentSha256: sha(`evidence:${companyId}`) }],
    reviewerId: "a".repeat(64),
    reviewArtifactSha256: sha(`review:${companyId}`),
    producerIdentity: "b".repeat(64),
    reviewerDecision: "APPROVED",
    reviewerStatus: "INDEPENDENT"
  }));
}

describe("independent source/surface oracle v3 company audits", () => {
  it("requires exactly the dynamic canonical Phase 1 in-scope ID/category set", () => {
    const complete = audits();
    expect(canonicalIndependentCompanyAuditsSha256(complete)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => canonicalIndependentCompanyAuditsSha256(complete.slice(1))).toThrow(/scope|roster|company/i);
    expect(() => canonicalIndependentCompanyAuditsSha256([...complete,
      { ...complete[0]!, companyId: "company-extra" }])).toThrow(/60|roster|company/i);
    expect(() => canonicalIndependentCompanyAuditsSha256(complete.map((audit, index) => index === 0
      ? { ...audit, category: audit.category === "FOREIGN_PHARMA" ? "DOMESTIC_PHARMA" : "FOREIGN_PHARMA" } : audit)))
      .toThrow(/category|scope|roster/i);
    expect(() => canonicalIndependentCompanyAuditsSha256([...complete.slice(1),
      { ...complete[0]!, companyId: "company-humanwell", category: "DOMESTIC_PHARMA" }]))
      .toThrow(/scope|roster|company/i);
    expect(() => canonicalIndependentCompanyAuditsSha256([...complete, complete[0]!]))
      .toThrow(/scope|roster|duplicate|company/i);
  });

  it("domain-separates and binds company audits and source members in coverage and provenance digests", () => {
    const complete = audits();
    const member = { companyId: complete[0]!.companyId, category: complete[0]!.category,
      sourceId: "source-1", surfaceId: "surface-1", channelId: "channel-1", officialEntryId: "entry-1",
      reviewerId: "a".repeat(64), reviewArtifactSha256: sha("review-member"), producerIdentity: "b".repeat(64),
      reviewerDecision: "APPROVED" as const, reviewerStatus: "INDEPENDENT" as const,
      officialEntrySha256: sha("entry"), officialFinalSha256: sha("final"), officialHopChainSha256: sha("hop"),
      chinaScope: "RESOLVED" as const, businessUnitScope: "RESOLVED" as const,
      legalEntityScope: "RESOLVED" as const, channelScope: "RESOLVED" as const,
      adapterId: "official-json", adapterConfigSha256: sha("config"), completenessEvidenceKind: "OFFICIAL_TOTAL",
      completenessEvidenceLocatorSha256: sha("locator"), completenessEvidenceContentSha256: sha("content"),
      expectedArtifacts: [{ logicalKey: "page-0", contentSha256: sha("page") }] };
    const auditSet = canonicalIndependentCompanyAuditsSha256(complete);
    const memberSet = canonicalIndependentOracleMembersSha256([member]);
    const coverage = independentCoverageSetSha256(complete, [member]);
    expect(coverage).not.toBe(auditSet);
    expect(coverage).not.toBe(memberSet);
    expect(independentCoverageSetSha256(complete.map((audit, index) => index === 0
      ? { ...audit, reviewArtifactSha256: sha("changed") } : audit), [member])).not.toBe(coverage);
    expect(independentReviewProvenanceRootSha256(complete, [member]))
      .not.toBe(independentReviewProvenanceRootSha256(complete, []));
    expect(independentHopChainProvenanceRootSha256(complete, [member]))
      .not.toBe(independentHopChainProvenanceRootSha256(complete, []));
  });

  it("accepts the canonical in-scope no-link audits with an empty denominator up to real signature verification", async () => {
    const result = await runIndependentOracleV3Scenario("valid-empty");
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/signing key.*production registry/i);
  });

  it("deeply freezes loaded company-audit records and nested arrays/artifacts", async () => {
    const result = await runIndependentOracleV3Scenario("freeze");
    expect(JSON.parse(result.output)).toEqual([true, true, true, true, true, true, true]);
  });

  it("rejects an incomplete company-audit set before signature verification", async () => {
    const result = await runIndependentOracleV3Scenario("missing-audit");
    expect(result.output).toMatch(/scope|roster|company.*set/i);
    expect(result.output).not.toMatch(/signing key.*production registry/i);
  });

  it("rejects an artifact roster hash different from confirmed V3", async () => {
    const result = await runIndependentOracleV3Scenario("roster-hash-tamper");
    expect(result.output).toMatch(/roster hash.*confirmed V3/i);
  });

  it.each([
    ["stale-audit", /fresh|stale|24/i],
    ["boundary-audit", /fresh|stale|24/i],
    ["future-audit", /future/i],
    ["mixed-age-audits", /fresh|stale|24/i]
  ] as const)("rejects %s before production signature acceptance", async (mode, error) => {
    const result = await runIndependentOracleV3Scenario(mode);
    expect(result.output).toMatch(error);
    expect(result.output).not.toMatch(/signing key.*production registry/i);
  });

  it.each([
    ["no-link-member", /no-link.*zero.*members/i],
    ["no-link-entry", /no-link.*zero.*official entries/i],
    ["has-link-no-member", /has-link.*members/i],
    ["audited-entry-omitted", /audited official entry.*omitted/i],
    ["member-entry-absent", /member official entry.*absent/i],
    ["member-category-mismatch", /category mismatch/i]
  ] as const)("rejects invalid company/member cross-binding: %s", async (mode, error) => {
    const result = await runIndependentOracleV3Scenario(mode);
    expect(result.output).toMatch(error);
    expect(result.output).not.toMatch(/signing key.*production registry/i);
  });

  it.each([
    ["audit-set-tamper", /company-audit-set hash mismatch/i],
    ["coverage-tamper", /coverage-set hash mismatch/i],
    ["review-root-tamper", /provenance root mismatch/i],
    ["hop-root-tamper", /provenance root mismatch/i],
    ["payload-coverage-tamper", /payload.*coverage set/i]
  ] as const)("rejects tampered combined digest/root/payload: %s", async (mode, error) => {
    const result = await runIndependentOracleV3Scenario(mode);
    expect(result.output).toMatch(error);
  });
});
