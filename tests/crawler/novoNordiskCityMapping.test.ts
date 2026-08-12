import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const CAPTURED_AT = "2026-07-15T00:01:00.000Z";
const SOURCE_ID = "source-novo-nordisk-china-social";

function exactNovoPlan(): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), SOURCE_ID);
  if (plan?.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "novo-nordisk") {
    throw new Error("Expected exact staged Novo Nordisk plan");
  }
  return plan;
}

function responseFor(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  jobs: readonly Record<string, unknown>[]
): OfficialJsonHttpResponse {
  if (plan.officialJsonFetch?.kind !== "novo-nordisk") throw new Error("Novo config expected");
  return {
    status: 200,
    finalUrl: plan.officialJsonFetch.endpointUrl,
    contentType: "application/json; charset=utf-8",
    capturedAt: CAPTURED_AT,
    body: JSON.stringify({ data: { totalMatches: jobs.length, jobs } })
  };
}

async function fetchNovo(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  jobs: readonly Record<string, unknown>[]
) {
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(CAPTURED_AT),
    http: async () => responseFor(plan, jobs)
  });
  return fetcher(plan);
}

describe("exact Novo Nordisk China city mapping", () => {
  it.each([
    ["101.en_GB", "Wuxi"],
    ["102.en_GB", "Shenyang"],
    ["103.en_GB", "Xi'an"],
    ["104.en_GB", "Qingdao"],
    ["105.en_GB", "Hefei"]
  ])("keeps the verified China Mainland jobCity label for %s / %s", async (jobId, city) => {
    const plan = exactNovoPlan();
    const fetched = await fetchNovo(plan, [{
      jobId,
      jobTitle: `Medical Advisor ${city}`,
      jobLocationLabel: `China Mainland, ${city}`,
      jobCity: { label: city, value: city }
    }]);

    expect(fetched).toMatchObject({
      ok: true,
      payload: { jobs: [{ locationRaw: `China Mainland, ${city}`, cities: [city] }] },
      completeness: { expectedJobCount: 1 },
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1, validationDiscardCount: 0 } }
    });

    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1 },
      jobs: [{ cities: [city] }]
    });
  });

  it.each([
    ["foreign-only", "United States, Boston", "Boston"],
    ["unknown country", "Unknown Region, Wuxi", "Wuxi"]
  ])("rejects a %s row instead of manufacturing a China city", async (_label, location, city) => {
    const plan = exactNovoPlan();
    const fetched = await fetchNovo(plan, [{
      jobId: "201.en_GB",
      jobTitle: "Medical Advisor",
      jobLocationLabel: location,
      jobCity: { label: city, value: city }
    }]);

    expect(fetched).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 } }
    });
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled.truth.completenessVerified).toBe(false);
    expect(crawled.truth.adapterSuccess).toBe(false);
  });

  it("does not transplant the fallback to a different source identity", async () => {
    const plan = exactNovoPlan();
    const transplanted = {
      ...plan,
      source: { ...plan.source, id: "source-transplanted-novo-city-policy" }
    } as typeof plan;
    const fetched = await fetchNovo(transplanted, [{
      jobId: "301.en_GB",
      jobTitle: "Medical Advisor Wuxi",
      jobLocationLabel: "China Mainland, Wuxi",
      jobCity: { label: "Wuxi", value: "Wuxi" }
    }]);

    expect(fetched).toMatchObject({ ok: true, payload: { jobs: [{ cities: [] }] } });
    const crawled = await runSourceCrawl(transplanted, { fetch: async () => fetched });
    expect(crawled.truth.adapterSuccess).toBe(false);
    expect(crawled.truth.completenessVerified).toBe(false);
  });
});
