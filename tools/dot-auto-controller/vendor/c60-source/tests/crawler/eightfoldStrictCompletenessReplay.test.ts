import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import {
  runSourceCrawl,
  supportsStrictOfficialTotalCertificate,
  type SourceFetchResult
} from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const CAPTURED_AT = "2026-09-02T02:00:00.000Z";

function canonicalPlan(): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  const plan = getPlanBySourceId(
    buildStagedSourceCrawlPlans(candidateCompanies),
    "source-bms-china-social"
  );
  if (plan?.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "eightfold-pcsx") {
    throw new Error("Expected canonical BMS Eightfold plan");
  }
  return plan;
}

function response(body: string, finalUrl: string): OfficialJsonHttpResponse {
  return {
    status: 200,
    body,
    finalUrl,
    contentType: "application/json; charset=utf-8",
    capturedAt: CAPTURED_AT
  };
}

function position(index: number): Record<string, unknown> {
  return {
    id: `synthetic-${index}`,
    name: `Synthetic role ${index}`,
    positionUrl: `/careers/job/synthetic-${index}`,
    postedTs: 1786406400,
    locations: ["Shanghai - CN"],
    standardizedLocations: ["Shanghai, Shanghai, CN"],
    workLocationOption: "onsite",
    locationFlexibility: null
  };
}

async function exactFetch(
  plan = canonicalPlan(),
  requestedUrls: string[] = []
): Promise<Extract<SourceFetchResult, { ok: true }>> {
  const jobs = Array.from({ length: 11 }, (_, index) => position(index));
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(CAPTURED_AT),
    http: async ({ url }) => {
      requestedUrls.push(url);
      const start = Number(new URL(url).searchParams.get("start"));
      return response(JSON.stringify({
        status: 200,
        data: { count: jobs.length, positions: jobs.slice(start, start + 10) }
      }), url);
    }
  });
  const fetched = await fetcher(plan);
  if (!fetched.ok) throw new Error(fetched.failureReason);
  return fetched;
}

async function crawl(plan: SourceCrawlPlan, fetched: Extract<SourceFetchResult, { ok: true }>) {
  return runSourceCrawl(plan, { fetch: async () => fetched });
}

describe("BMS Eightfold strict completeness replay", () => {
  it("promotes only the exact lossless PCSx query sequence", async () => {
    const plan = canonicalPlan();
    const requestedUrls: string[] = [];
    const fetched = await exactFetch(plan, requestedUrls);

    expect(requestedUrls).toEqual([
      "https://jobs.bms.com/api/pcsx/search?domain=bms.com&query=&location=china&start=0&sort_by=distance",
      "https://jobs.bms.com/api/pcsx/search?domain=bms.com&query=&location=china&start=10&sort_by=distance"
    ]);
    expect(supportsStrictOfficialTotalCertificate(plan)).toBe(true);
    expect(await crawl(plan, fetched)).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 11, structuredJobCount: 11 }
    });
  });

  it.each([
    ["domain", { domain: "example.com" }],
    ["location", { location: "global" }],
    ["detailBaseUrl", { detailBaseUrl: "https://jobs.bms.com/careers/other" }],
    ["pageSize", { pageSize: 20 }],
    ["maxPages", { maxPages: 6 }]
  ] as const)("fails closed when %s drifts", async (_name, override) => {
    const plan = canonicalPlan();
    const fetched = await exactFetch(plan);
    const changed = {
      ...plan,
      officialJsonFetch: { ...plan.officialJsonFetch!, ...override }
    } as SourceCrawlPlan;

    expect(supportsStrictOfficialTotalCertificate(changed)).toBe(false);
    expect((await crawl(changed, fetched)).truth.completenessVerified).toBe(false);
  });

  it.each([
    ["domain", (url: URL) => url.searchParams.set("domain", "example.com")],
    ["location", (url: URL) => url.searchParams.set("location", "global")],
    ["start", (url: URL) => url.searchParams.set("start", "1")],
    ["sort_by", (url: URL) => url.searchParams.set("sort_by", "title")],
    ["extra query", (url: URL) => url.searchParams.set("extra", "1")]
  ] as const)("rejects replay when the PCSx %s query is changed", async (_name, mutate) => {
    const plan = canonicalPlan();
    const fetched = structuredClone(await exactFetch(plan));
    const artifact = fetched.fetchEvidence?.artifacts[0];
    if (!artifact?.requestedUrl) throw new Error("Expected first Eightfold artifact");
    const url = new URL(artifact.requestedUrl);
    mutate(url);
    artifact.requestedUrl = url.toString();
    artifact.finalUrl = url.toString();

    expect((await crawl(plan, fetched)).truth.completenessVerified).toBe(false);
  });
});
