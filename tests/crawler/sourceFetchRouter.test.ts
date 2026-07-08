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

const beisenPlan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: {
    id: "company-fosun-pharma",
    officialChineseName: "上海复星医药（集团）股份有限公司"
  },
  source: {
    id: "source-fosun-pharma-social",
    companyId: "company-fosun-pharma",
    kind: "SOCIAL",
    atsKind: "BEISEN_ZHIYE",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://fosunpharma.zhiye.com/social",
    officialChainEvidenceUrl: "https://www.fosunpharma.com/careers"
  },
  json: {
    jobsPath: "jobs",
    fields: {
      officialTitle: "jobName",
      officialUrl: "applyUrl",
      locationRaw: "city"
    }
  }
};

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

  it("routes html-table plans to the direct HTML fetcher when provided", async () => {
    const calls: string[] = [];
    const plan = {
      ...beisenPlan,
      adapterId: "html-table",
      table: {
        rowSelector: "tr",
        fields: {
          officialTitle: { selector: "td:nth-child(1)" },
          officialUrl: { selector: "a", attribute: "href" },
          locationRaw: { selector: "td:nth-child(2)" }
        }
      }
    } as const;

    const router = createSourceFetchRouter({
      moka: async () => {
        calls.push("moka");
        return { ok: false, capturedAt: "2026-07-08T00:00:00.000Z", failureReason: "wrong" };
      },
      html: async () => {
        calls.push("html");
        return { ok: true, capturedAt: "2026-07-08T00:00:00.000Z", html: "<table></table>" };
      },
      fallback: async () => {
        calls.push("fallback");
        return { ok: false, capturedAt: "2026-07-08T00:00:00.000Z", failureReason: "wrong" };
      }
    });

    await expect(router(plan)).resolves.toMatchObject({ ok: true, html: "<table></table>" });
    expect(calls).toEqual(["html"]);
  });

  it("routes Workday sources to the Workday fetcher when provided", async () => {
    const calls: string[] = [];
    const router = createSourceFetchRouter({
      moka: async () => {
        calls.push("moka");
        return { ok: false, capturedAt, failureReason: "wrong" };
      },
      workday: async () => {
        calls.push("workday");
        return { ok: true, capturedAt, payload: { jobPostings: [] } };
      },
      fallback: async () => {
        calls.push("fallback");
        return { ok: false, capturedAt, failureReason: "wrong" };
      }
    });

    await expect(router(planWithAtsKind("WORKDAY"))).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual(["workday"]);
  });

  it("routes Hotjob Wecruit sources to the Hotjob fetcher when provided", async () => {
    const calls: string[] = [];
    const router = createSourceFetchRouter({
      moka: async () => {
        calls.push("moka");
        return { ok: false, capturedAt, failureReason: "wrong" };
      },
      hotjob: async () => {
        calls.push("hotjob");
        return { ok: true, capturedAt, payload: { jobs: [] } };
      },
      fallback: async () => {
        calls.push("fallback");
        return { ok: false, capturedAt, failureReason: "wrong" };
      }
    });

    await expect(router(planWithAtsKind("HOTJOB_WECRUIT"))).resolves.toMatchObject({ ok: true });
    expect(calls).toEqual(["hotjob"]);
  });
});
