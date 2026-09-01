import { describe, expect, it } from "vitest";
import {
  assertPlanBoundHtmlValidationMatchKey,
  capturePlanBoundHtmlRenderedTraversal,
  PLAN_BOUND_HTML_TRAVERSAL_POLICIES,
  PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS,
  isPlanBoundHtmlTraversalSourceId
} from "../../src/crawler/planBoundHtmlTraversalValidator";

describe("plan-bound HTML traversal registry", () => {
  it("has unique active IDs and source-bound policy identities", () => {
    expect(new Set(PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS).size).toBe(
      PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS.length
    );
    for (const sourceId of PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS) {
      const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
      expect(isPlanBoundHtmlTraversalSourceId(sourceId)).toBe(true);
      expect(policy.companyId).toMatch(/^company-/u);
      expect(policy.entryUrl).toMatch(/^https:\/\//u);
      expect(policy.rowSelector).toBeTruthy();
      expect(policy.maxPages).toBeGreaterThan(0);
    }
  });

  it("preserves Novartis China filters and Kelun's selected marketing category", () => {
    const novartis = new URL(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-novartis-social"].entryUrl);
    expect(novartis.hostname).toBe("www.novartis.com.cn");
    expect(novartis.searchParams.getAll("country[]")).toEqual(["LOC_CN"]);
    expect(novartis.searchParams.get("field_job_posted_date")).toBe("All");

    const kelun = new URL(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-kelun-social"].entryUrl);
    expect(kelun.searchParams.get("p")).toBe("1^2");
    expect(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-kelun-social"].key).toEqual({
      kind: "TEXT_SOURCE_JOB_ID",
      selector: "td:nth-child(1) a",
      sourceJobIdPattern: "\\b(J\\d+)\\b"
    });
  });

  it("extracts stable text source IDs while preserving duplicate raw observations", async () => {
    const sourceId = "source-kelun-social";
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const renderedTitles = ["市场经理 (J13184)", "市场经理（J13184）", "产品经理 (J12879)"];
    const readyAndRows = {
      first: () => ({ waitFor: async () => undefined }),
      evaluateAll: async () => renderedTitles
    };
    const noNext = {
      count: async () => 0
    };
    const page = {
      goto: async () => ({ status: () => 200, url: () => "https://kelun.zhiye.com/social" }),
      url: () => "https://kelun.zhiye.com/social",
      locator: (selector: string) => selector === PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].nextSelector
        ? noNext
        : readyAndRows
    };
    const captured = await capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => ({ newPage: async () => page as never, close: async () => undefined })
    });

    const expectedRaw = [
      `${sourceId}:J13184`,
      `${sourceId}:J13184`,
      `${sourceId}:J12879`
    ].sort();
    expect(captured.pages[0]).toMatchObject({
      rawMatchKeys: expectedRaw,
      matchKeys: [...new Set(expectedRaw)]
    });
    for (const matchKey of captured.pages[0]!.matchKeys) {
      expect(() => assertPlanBoundHtmlValidationMatchKey(sourceId, matchKey)).not.toThrow();
    }
    expect(() => assertPlanBoundHtmlValidationMatchKey(sourceId, `${sourceId}:not-a-requisition`))
      .toThrow("text source job ID is invalid");
  });
});
