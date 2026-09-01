import { describe, expect, it } from "vitest";
import {
  PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS,
  PLAN_BOUND_HTML_TRAVERSAL_POLICIES
} from "../../src/crawler/planBoundHtmlTraversalValidator";
import { requiresBGradeCertificateSourceId } from "../../src/crawler/traversalCertificate";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

describe("plan-bound HTML certificate scope", () => {
  it("requires certificates only for sources that still use the matching HTML method", () => {
    expect(PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS).toEqual([
      "source-novartis-social",
      "source-astellas-china-social",
      "source-grand-pharma-social",
      "source-kelun-social"
    ]);
    const plans = buildStagedSourceCrawlPlans(candidateCompanies);
    for (const sourceId of PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS) {
      expect(getPlanBySourceId(plans, sourceId)?.adapterId).toBe("html-table");
      expect(requiresBGradeCertificateSourceId(sourceId)).toBe(true);
    }
  });

  it("does not retain obsolete certificate gates after a source changes method or identity", () => {
    for (const sourceId of [
      "source-fosun-pharma-social",
      "source-otsuka-china-social-2",
      "source-sanofi-china-social",
      "source-takeda-china-social"
    ]) {
      expect(requiresBGradeCertificateSourceId(sourceId)).toBe(false);
    }
  });

  it("binds Kelun's browser check to the same manually selected category URL", () => {
    expect(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-kelun-social"].entryUrl).toBe(
      "https://kelun.zhiye.com/social?r=&p=1%5E2&c=&d=&k="
    );
  });
});
