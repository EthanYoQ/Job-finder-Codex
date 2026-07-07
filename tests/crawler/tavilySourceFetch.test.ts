import { describe, expect, it } from "vitest";
import { createTavilyKeyRing } from "../../src/crawler/tavily";
import { createTavilySourceFetch } from "../../src/crawler/tavilySourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const htmlPlan: SourceCrawlPlan = {
  adapterId: "html-table",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_HTML",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://example.com/careers",
    officialChainEvidenceUrl: "https://example.com"
  },
  table: {
    rowSelector: "tr",
    fields: {
      officialTitle: { selector: ".title" },
      officialUrl: { selector: ".title a", attribute: "href" },
      locationRaw: { selector: ".city" }
    }
  }
};

const jsonPlan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: htmlPlan.company,
  source: { ...htmlPlan.source, atsKind: "OFFICIAL_JSON" },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "url",
      locationRaw: "location"
    }
  }
};

describe("createTavilySourceFetch", () => {
  it("extracts only the official entry URL and returns HTML content for html-table plans", async () => {
    const calls: unknown[] = [];
    const fetch = createTavilySourceFetch({
      keyRing: createTavilyKeyRing(["key-1"]),
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      extract: async (call) => {
        calls.push(call);
        return {
          ok: true,
          data: {
            results: [{ url: "https://example.com/careers", rawContent: "<table><tr></tr></table>" }],
            failedResults: []
          }
        };
      }
    });

    await expect(fetch(htmlPlan)).resolves.toEqual({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      html: "<table><tr></tr></table>"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      apiKey: "key-1",
      urls: ["https://example.com/careers"],
      extractDepth: "advanced"
    });
  });

  it("parses JSON raw content for official-json plans", async () => {
    const fetch = createTavilySourceFetch({
      keyRing: createTavilyKeyRing(["key-1"]),
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      extract: async () => ({
        ok: true,
        data: {
          results: [{ url: "https://example.com/careers", rawContent: "{\"jobs\":[{\"id\":\"1\"}]}" }],
          failedResults: []
        }
      })
    });

    await expect(fetch(jsonPlan)).resolves.toEqual({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      payload: { jobs: [{ id: "1" }] }
    });
  });

  it("returns a failed fetch result when Tavily has no usable official content", async () => {
    const fetch = createTavilySourceFetch({
      keyRing: createTavilyKeyRing(["key-1"]),
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      extract: async () => ({ ok: true, data: { results: [], failedResults: [] } })
    });

    await expect(fetch(htmlPlan)).resolves.toEqual({
      ok: false,
      capturedAt: "2026-07-08T00:00:00.000Z",
      failureReason: "Tavily returned no content for https://example.com/careers"
    });
  });
});
