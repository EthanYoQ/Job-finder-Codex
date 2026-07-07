import { describe, expect, it } from "vitest";
import { createSourceFetchRouter } from "../../src/crawler/sourceFetchRouter";
import type { SourceFetchFunction } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const capturedAt = "2026-07-08T08:00:00.000Z";

function planWithAtsKind(atsKind: SourceCrawlPlan["source"]["atsKind"]): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "company-1", officialChineseName: "测试药企" },
    source: {
      id: `source-${atsKind}`,
      companyId: "company-1",
      kind: "SOCIAL",
      atsKind,
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: "https://example.com/jobs",
      officialChainEvidenceUrl: "https://example.com/careers"
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
}

describe("source fetch router", () => {
  it("routes Moka sources to the Moka fetcher", async () => {
    const calls: string[] = [];
    const moka: SourceFetchFunction = async () => {
      calls.push("moka");
      return { ok: true, capturedAt, payload: { data: { jobs: [] } } };
    };
    const fallback: SourceFetchFunction = async () => {
      calls.push("fallback");
      return { ok: false, capturedAt, failureReason: "unexpected fallback" };
    };

    const result = await createSourceFetchRouter({ moka, fallback })(planWithAtsKind("MOKA"));

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["moka"]);
  });

  it("routes non-Moka sources to the fallback fetcher", async () => {
    const calls: string[] = [];
    const moka: SourceFetchFunction = async () => {
      calls.push("moka");
      return { ok: false, capturedAt, failureReason: "unexpected moka" };
    };
    const fallback: SourceFetchFunction = async () => {
      calls.push("fallback");
      return { ok: true, capturedAt, payload: { data: { jobs: [] } } };
    };

    const result = await createSourceFetchRouter({ moka, fallback })(
      planWithAtsKind("OFFICIAL_JSON")
    );

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["fallback"]);
  });
});
