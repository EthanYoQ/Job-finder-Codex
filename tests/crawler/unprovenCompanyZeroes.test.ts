import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { htmlTableAdapter } from "../../src/crawler/adapters/htmlTable";
import { P0_LAUNCH_MANIFEST } from "../../src/release/launchManifest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import {
  createPlanBoundHtmlBrowserTraversalValidation,
  evaluateBGradeValidationRequirement,
  issueBGradeTraversalCertificate,
  parseBGradeIndependentTraversalValidation,
  readReusableBGradeTraversalValidation,
  verifyBGradeTraversalCertificateReceipt
} from "../../src/crawler/traversalCertificate";
import type { BGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";

type Candidate = Parameters<typeof issueBGradeTraversalCertificate>[0];
type LegacyFixture = {
  capturedAt: string;
  body: string;
  candidate: Omit<Candidate, "now"> & { now: string };
  certificate: BGradeTraversalCertificate;
  certificateSha256: string;
};
const sourceIds = ["source-otsuka-china-social", "source-sandoz-china-social"] as const;
function fixture(sourceId: typeof sourceIds[number]): LegacyFixture {
  // Deliberately frozen pre-fix output: rebuilding via current constructors would
  // hide whether admission rejects previously issued, correctly hashed zeroes.
  return JSON.parse(readFileSync(`tests/fixtures/unproven-company-zeroes/${sourceId}.json`, "utf8"));
}

describe.each(sourceIds)("fail-closed zero qualification for %s", sourceId => {
  it("keeps the original source and removes its unsupported explicit-empty marker", () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
    if (plan?.adapterId !== "html-table") throw new Error("missing source plan");
    const legacy = fixture(sourceId).candidate.plan;
    expect(plan.source).toEqual(legacy.source);
    expect(plan.company).toEqual(legacy.company);
    expect(plan.table.staticPublicList?.explicitEmptyState).toBeUndefined();
    expect(P0_LAUNCH_MANIFEST.companies).toHaveLength(41);
    expect(getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-otsuka-china-social-2"))
      .toBeUndefined();
  });

  it.each(["OFFICIAL_TOTAL_COUNT", "COMPLETE_PAGE_TRAVERSAL"] as const)(
    "rejects a legacy %s declaration even with its original source-bound plan", kind => {
      const { candidate } = fixture(sourceId);
      if (candidate.plan.adapterId !== "html-table") throw new Error("missing legacy HTML plan");
      const evidence = candidate.evidence;
      evidence.declaredCompleteness!.kind = kind;
      evidence.declaredCompleteness!.value = kind === "OFFICIAL_TOTAL_COUNT" ? 0 : 1;
      evidence.pages[0]!.termination = kind === "OFFICIAL_TOTAL_COUNT" ? "EMPTY_PAGE" : "NEXT_ABSENT";
      expect(validateStrictHtmlCompletenessProof(candidate.plan, evidence)).toBe(false);
    }
  );

  it("rejects a forged generic static-zero policy for the same frozen source", () => {
    const { candidate } = fixture(sourceId);
    if (candidate.plan.adapterId !== "html-table") throw new Error("missing legacy HTML plan");
    candidate.plan.table.completenessProof = { kind: "STATIC_PUBLIC_LIST" };
    expect(validateStrictHtmlCompletenessProof(candidate.plan, candidate.evidence)).toBe(false);
  });

  it("rejects new independent empty validation creation", () => {
    const { certificate } = fixture(sourceId);
    const validation = certificate.independentValidation;
    expect(() => createPlanBoundHtmlBrowserTraversalValidation({
      sourceId,
      companyId: validation.companyId,
      sourceConfigSha256: validation.sourceConfigSha256,
      surfaceIds: validation.surfaceIds,
      channelIds: validation.channelIds,
      pages: [{ pageNumber: 1, declaredTotalPages: 1, matchKeys: [], rawMatchKeys: [], nextControlPresent: false }],
      observedAt: validation.observedAt,
      expiresAt: validation.expiresAt
    })).toThrow("empty-list policy mismatch");
  });

  it("rejects parsing a legacy correctly hashed empty validation", () => {
    expect(() => parseBGradeIndependentTraversalValidation(fixture(sourceId).certificate.independentValidation))
      .toThrow("empty-list policy mismatch");
  });

  it.each(["CURRENT_RUN", "REUSED"] as const)("rejects %s legacy validation eligibility", validationExecution => {
    const legacy = fixture(sourceId);
    expect(evaluateBGradeValidationRequirement({
      trigger: "STABLE_RUN", validationExecution,
      validation: legacy.certificate.independentValidation,
      now: new Date(legacy.candidate.now)
    })).toMatchObject({ acceptable: false, reason: "VALIDATION_INVALID" });
  });

  it("rejects certificate issuance using a previously certifiable zero candidate", () => {
    const { candidate } = fixture(sourceId);
    const decision = issueBGradeTraversalCertificate({ ...candidate, now: new Date(candidate.now) });
    expect(decision).toMatchObject({ status: "REJECTED", resultingGrade: "C" });
    if (decision.status !== "REJECTED") throw new Error("unsupported zero certified");
    expect(decision.blockerCodes).toContain("MAIN_TRAVERSAL_INCOMPLETE");
    expect(decision.blockerCodes).toContain("VALIDATION_REFRESH_REQUIRED");
  });

  it("rejects reuse of a correctly hashed legacy certificate even at its original valid time", () => {
    const legacy = fixture(sourceId);
    expect(() => readReusableBGradeTraversalValidation({
      certificate: legacy.certificate, certificateSha256: legacy.certificateSha256,
      sourceConfigSha256: legacy.certificate.binding.sourceConfigSha256,
      now: new Date(legacy.candidate.now)
    })).toThrow("empty-list policy mismatch");
  });

  it("rejects receipt admission of a correctly hashed legacy zero certificate", () => {
    const legacy = fixture(sourceId);
    expect(() => verifyBGradeTraversalCertificateReceipt({
      certificate: legacy.certificate, certificateSha256: legacy.certificateSha256,
      expected: { ...legacy.certificate.binding, ...legacy.certificate.output },
      now: new Date(legacy.candidate.now)
    })).toThrow("validation unavailable: VALIDATION_INVALID");
  });

  it("preserves existing positive-row parsing without asserting completeness", () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
    if (plan?.adapterId !== "html-table") throw new Error("missing source plan");
    const html = sourceId === "source-otsuka-china-social"
      ? '<section class="container Box"><div data-job-id="regression-role">药品质量经理</div></section>'
      : '<main><section class="elementor elementor-1709"><a href="/jobs/regression-role/">药品质量经理</a></section></main>';
    const result = htmlTableAdapter.extract({ company: plan.company, source: plan.source,
      capturedAt: fixture(sourceId).capturedAt, html, table: plan.table });
    expect(result.status).toBe("SUCCESS");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ sourceId, companyId: plan.company.id, officialTitle: "药品质量经理", locationRaw: "中国" });
  });
});
