import { describe, expect, it } from "vitest";
import { createUnsupportedSourceFetch } from "../../src/crawler/unsupportedSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const plan = {
  adapterId: "official-json",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "WORKDAY",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://example.com/jobs",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  json: {
    jobsPath: "jobs",
    fields: {
      officialTitle: "title",
      officialUrl: "url",
      locationRaw: "location"
    }
  }
} satisfies SourceCrawlPlan;

describe("createUnsupportedSourceFetch", () => {
  it("fails formal crawls for source plans without a deterministic fetcher", async () => {
    const fetch = createUnsupportedSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z")
    });

    await expect(fetch(plan)).resolves.toEqual({
      ok: false,
      capturedAt: "2026-07-08T00:00:00.000Z",
      failureReason:
        "Formal readiness crawl is not configured for WORKDAY source source-test-social"
    });
  });
});
