import {requiresAGradeCertificateSourceId} from "../../src/crawler/completenessCertificate";
import { describe, expect, it } from "vitest";
import {
  PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS,
  PLAN_BOUND_HTML_TRAVERSAL_POLICIES
} from "../../src/crawler/planBoundHtmlTraversalValidator";
import { requiresBGradeCertificateSourceId } from "../../src/crawler/traversalCertificate";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

describe("plan-bound HTML certificate scope", () => {
  it("retains required certificate gates during the Qilu composite migration", () => {
    expect(PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS).toEqual([
      "source-novartis-social",
      "source-astellas-china-social",
      "source-grand-pharma-social",
      "source-qilu-social",
      "source-kelun-social",
      "source-otsuka-china-social",
      "source-sandoz-china-social",
      "source-takeda-china-social"
    ]);
    const plans = buildStagedSourceCrawlPlans(candidateCompanies);
    for (const sourceId of PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS) {
      expect(getPlanBySourceId(plans, sourceId)?.adapterId).toBe(sourceId === "source-qilu-social" ? "official-json" : "html-table");
      expect(requiresBGradeCertificateSourceId(sourceId)).toBe(true);
    }
  });

  it("keeps Takeda B traversal and requires Chinese-only independent B for Sanofi", () => {
    expect(requiresBGradeCertificateSourceId("source-sanofi-china-social")).toBe(true);
    expect(requiresAGradeCertificateSourceId("source-sanofi-china-social")).toBe(false);
    for (const sourceId of [
      "source-takeda-china-social"
    ] as const) {
      expect(requiresBGradeCertificateSourceId(sourceId)).toBe(true);
      expect("talentbrewScope" in PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId]).toBe(false);
    }
  });

  it("binds Qilu's browser check to the current official corporate list", () => {
    expect(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-qilu-social"].entryUrl).toBe(
      "https://www.qilu-pharma.com/JobPosting_list.html"
    );
  });

  it("binds Kelun's browser check to the same manually selected category URL", () => {
    expect(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-kelun-social"].entryUrl).toBe(
      "https://kelun.zhiye.com/social?r=&p=1%5E2&c=&d=&k="
    );
  });
});
