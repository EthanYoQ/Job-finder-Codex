import { describe, expect, it } from "vitest";
import {
  createHttpHtmlSourceFetch,
  type HttpHtmlRequest,
  type HttpHtmlResponse
} from "../../src/crawler/httpHtmlSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const htmlPlan: SourceCrawlPlan = {
  adapterId: "html-table",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "BEISEN_ZHIYE",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://example.com/social",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  table: {
    rowSelector: "tr",
    fields: {
      officialTitle: { selector: "td:nth-child(1)" },
      officialUrl: { selector: "a", attribute: "href" },
      locationRaw: { selector: "td:nth-child(2)" }
    }
  }
};

const jsonPlan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: { id: "company-json", officialChineseName: "JSON药企" },
  source: {
    ...htmlPlan.source,
    id: "source-json-social",
    companyId: "company-json",
    atsKind: "OFFICIAL_JSON"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      officialTitle: "title",
      officialUrl: "url",
      locationRaw: "location"
    }
  }
};

describe("createHttpHtmlSourceFetch", () => {
  it("fetches direct HTML for html-table plans", async () => {
    const requests: HttpHtmlRequest[] = [];
    const fetchSource = createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request): Promise<HttpHtmlResponse> => {
        requests.push(request);
        return { status: 200, body: "<table><tr><td>岗位</td></tr></table>" };
      }
    });

    const result = await fetchSource(htmlPlan);

    expect(result).toEqual({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      html: "<table><tr><td>岗位</td></tr></table>"
    });
    expect(requests).toEqual([
      {
        url: "https://example.com/social",
        headers: { "User-Agent": "job-search-crawler/0.1" }
      }
    ]);
  });

  it("rejects non-html source plans without calling HTTP", async () => {
    const fetchSource = createHttpHtmlSourceFetch({
      http: async () => {
        throw new Error("must not be called");
      }
    });

    const result = await fetchSource(jsonPlan);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      failureReason: "Direct HTML source fetch only supports html-table plans"
    });
  });

  it("fails empty and non-2xx responses", async () => {
    const fetchSource = createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 403, body: "Forbidden" })
    });

    await expect(fetchSource(htmlPlan)).resolves.toMatchObject({
      ok: false,
      capturedAt: "2026-07-08T00:00:00.000Z",
      failureReason: "Direct HTML source returned HTTP 403"
    });

    const emptyFetch = createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 200, body: "   " })
    });

    await expect(emptyFetch(htmlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Direct HTML source returned empty content"
    });
  });
});
