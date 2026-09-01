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
    expect(novartis.searchParams.getAll("country[0]")).toEqual(["LOC_CN"]);
    expect(novartis.searchParams.get("field_job_posted_date")).toBe("All");

    const kelun = new URL(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-kelun-social"].entryUrl);
    expect(kelun.searchParams.get("p")).toBe("1^2");
    expect(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-kelun-social"].key).toEqual({
      kind: "OFFICIAL_URL",
      selector: "td:nth-child(1) a",
      origin: "https://kelun.zhiye.com",
      pathPrefix: "/job_show/",
      dedupe: "URL_SOURCE_JOB_ID",
      sourceJobIdPattern: "/job_show/([1-9][0-9]*)$",
      queryContext: "KELUN_CATEGORY_PAGE"
    });
  });

  it("keeps distinct Kelun detail rows even when the displayed requisition code repeats", async () => {
    const sourceId = "source-kelun-social";
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const renderedUrls = [
      "https://kelun.zhiye.com/job_show/230898225?r=&p=1%5E2&c=&d=&k=",
      "https://kelun.zhiye.com/job_show/230895908?r=&p=1%5E2&c=&d=&k=",
      "https://kelun.zhiye.com/job_show/230890785?r=&p=1%5E2&c=&d=&k="
    ];
    const readyAndRows = {
      first: () => ({ waitFor: async () => undefined }),
      evaluateAll: async () => renderedUrls
    };
    const noNext = {
      count: async () => 0
    };
    const page = {
      goto: async () => ({ status: () => 200, url: () => entryUrl }),
      url: () => entryUrl,
      locator: (selector: string) => selector === PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].nextSelector
        ? noNext
        : readyAndRows
    };
    const captured = await capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => ({ newPage: async () => page as never, close: async () => undefined })
    });

    const expectedRaw = renderedUrls.map((url) => `${sourceId}:${new URL(url).pathname.split("/").at(-1)}`).sort();
    expect(captured.pages[0]).toMatchObject({
      rawMatchKeys: expectedRaw,
      matchKeys: expectedRaw
    });
    for (const matchKey of captured.pages[0]!.matchKeys) {
      expect(() => assertPlanBoundHtmlValidationMatchKey(sourceId, matchKey)).not.toThrow();
    }
    expect(() => assertPlanBoundHtmlValidationMatchKey(sourceId, `${sourceId}:not-a-detail-id`))
      .toThrow("source job ID is invalid");
  });

  it("rejects repeated Kelun observations of the same official detail row", async () => {
    const sourceId = "source-kelun-social";
    const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
    const rows = {
      first: () => ({ waitFor: async () => undefined }),
      evaluateAll: async () => [
        "https://kelun.zhiye.com/job_show/230898225?r=&p=1%5E2&c=&d=&k=",
        "https://kelun.zhiye.com/job_show/230898225?r=&p=1%5E2&c=&d=&k="
      ]
    };
    const page = {
      goto: async () => ({ status: () => 200, url: () => policy.entryUrl }),
      url: () => policy.entryUrl,
      locator: (selector: string) => selector === policy.nextSelector ? { count: async () => 0 } : rows
    };

    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl: policy.entryUrl,
      launchBrowser: async () => ({ newPage: async () => page as never, close: async () => undefined })
    })).rejects.toThrow("duplicate match keys on one page");
  });

  it("preserves Kelun's source-bound filters on every browser page", async () => {
    const sourceId = "source-kelun-social";
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    let currentUrl: string = entryUrl;
    const rows = {
      first: () => ({ waitFor: async () => undefined }),
      evaluateAll: async () => [currentUrl.includes("PageIndex=2")
        ? "https://kelun.zhiye.com/job_show/20002?p=1%5E2&PageIndex=2"
        : "https://kelun.zhiye.com/job_show/20001?r=&p=1%5E2&c=&d=&k="]
    };
    const next = {
      count: async () => currentUrl.includes("PageIndex=2") ? 0 : 1,
      nth: () => ({
        getAttribute: async (name: string) => name === "href" ? "/social/?p=1%5E2&PageIndex=2" : null,
        isVisible: async () => true
      })
    };
    const page = {
      goto: async (url: string) => {
        currentUrl = url;
        return { status: () => 200, url: () => url };
      },
      url: () => currentUrl,
      locator: (selector: string) => selector === PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].nextSelector
        ? next
        : rows
    };
    const captured = await capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => ({ newPage: async () => page as never, close: async () => undefined })
    });
    expect(captured.pages.map((page) => page.matchKeys)).toEqual([
      [`${sourceId}:20001`],
      [`${sourceId}:20002`]
    ]);
  });

  it("rejects a TalentBrew next link that escapes the registered China traversal", async () => {
    const sourceId = "source-sanofi-china-social";
    const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
    const rows = {
      first: () => ({ waitFor: async () => undefined }),
      evaluateAll: async () => ["https://jobs.sanofi.com/en/job/beijing/example/2649/12345"]
    };
    const next = {
      count: async () => 1,
      nth: () => ({
        getAttribute: async (name: string) => name === "href"
          ? "/en/location/global-jobs/2649/1814991/2/2"
          : null,
        isVisible: async () => true
      })
    };
    const page = {
      goto: async () => ({ status: () => 200, url: () => policy.entryUrl }),
      url: () => policy.entryUrl,
      locator: (selector: string) => selector === policy.nextSelector ? next : rows
    };

    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl: policy.entryUrl,
      launchBrowser: async () => ({ newPage: async () => page as never, close: async () => undefined })
    })).rejects.toThrow("path page coordinate mismatch");
  });

  it.each([
    "source-otsuka-china-social",
    "source-sandoz-china-social"
  ] as const)("proves %s as an independently rendered terminal empty list without hard-coding zero", async sourceId => {
    const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
    const ready = { first: () => ({ waitFor: async () => undefined }) };
    const rows = { evaluateAll: async () => [] };
    const noNext = { count: async () => 0 };
    const page = {
      goto: async () => ({ status: () => 200, url: () => policy.entryUrl }),
      url: () => policy.entryUrl,
      locator: (selector: string) => selector === policy.readySelector
        ? ready
        : selector === policy.rowSelector
          ? rows
          : noNext
    };
    const captured = await capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl: policy.entryUrl,
      launchBrowser: async () => ({ newPage: async () => page as never, close: async () => undefined })
    });
    expect(captured.pages).toEqual([{
      pageNumber: 1,
      declaredTotalPages: 1,
      matchKeys: [],
      rawMatchKeys: [],
      nextControlPresent: false
    }]);
  });
});
