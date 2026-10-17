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
import { NOVO_CHINA_ENDPOINT, parseNovoChinaResponse, replayNovoChinaRows } from "../../src/crawler/novoChinaQuality";
import { listing, pages } from "../helpers/novoC60SyntheticFixture";

const CAPTURED_AT = "2026-07-15T00:01:00.000Z";
const SOURCE_ID = "source-novo-nordisk-china-social";

function exactNovoPlan(): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), SOURCE_ID);
  if (plan?.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "novo-nordisk") {
    throw new Error("Expected exact staged Novo Nordisk plan");
  }
  // This suite protects the pre-existing V1 behavior independently of the current profile.
  return { ...plan, officialJsonFetch: { ...plan.officialJsonFetch, cityScopePolicy: "NOVO_CHINA_MAINLAND_JOB_CITY_V1" } };
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
  ])("keeps legacy China Mainland jobCity extraction for %s / %s without current-profile qualification", async (jobId, city) => {
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
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: false },
      observation: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 1 },
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

// Synthetic rows only. The same nested schema now reuses already reviewed
// city/province pairs; it does not infer country or accept a list as an active JD.
function nestedListing(city: string, state: string) {
  const root = JSON.parse(listing);
  root.data.cities = [{ label: city, value: city }];
  root.data.states = [{ label: state, value: state }];
  for (const row of root.data.jobs) {
    row.jobCity = { label: city, value: city };
    row.jobState = { label: state, value: state };
    row.jobLocationLabel = `China, ${city}`;
  }
  return root;
}

describe("Novo nested shared geography", () => {
  it.each([
    ["Guangzhou", "Guangdong", "广州"], ["Guiyang", "Guizhou", "贵阳"],
    ["Taiyuan", "Shanxi", "太原"], ["Nanning", "Guangxi", "南宁"],
    ["Tianjin", "Tianjin", "天津"], ["Qingdao", "Shandong", "青岛"],
    ["Daqing", "Heilongjiang", "大庆"], ["Songyuan", "Jilin", "松原"]
  ])("normalizes the exact reviewed pair %s / %s", (city, state, expected) => {
    const parsed = parseNovoChinaResponse(JSON.stringify(nestedListing(city, state)));
    expect(parsed?.total).toBe(3);
    expect(parsed?.jobs.map(row => row.cities)).toEqual([[expected], [expected], [expected]]);
    expect(parsed?.jobs.every(row => row.locationRaw === `China, ${city}`)).toBe(true);
  });

  it.each([
    ["Guangzhou", "Guizhou"], ["Guiyang", "Guangdong"], ["Taiyuan", "Shaanxi"],
    ["Nanning", "Guangdong"], ["Tianjin", "Beijing"], ["Unknown", "Guangdong"],
    ["Hong Kong", "Hong Kong"], ["Taipei", "Taiwan"], ["Singapore", "Singapore"]
  ])("rejects unknown, conflicting or out-of-scope pair %s / %s", (city, state) => {
    expect(parseNovoChinaResponse(JSON.stringify(nestedListing(city, state)))).toBeUndefined();
  });

  it.each([
    ["country", (root: any) => { root.data.jobs[0].jobCountry = { label: "Unknown", value: "Unknown" }; }],
    ["state label", (root: any) => { root.data.jobs[0].jobState.label = "Guizhou"; }],
    ["city label", (root: any) => { root.data.jobs[0].jobCity.label = "Guiyang"; }],
    ["location", (root: any) => { root.data.jobs[0].jobLocationLabel = "China, Guiyang"; }],
    ["city facet", (root: any) => { root.data.cities.push({ label: "Unknown", value: "Unknown" }); }],
    ["state facet", (root: any) => { root.data.states.push({ label: "Unknown", value: "Unknown" }); }],
    ["missing facet", (root: any) => { root.data.cities = []; }],
    ["conflicting pair with valid facets", (root: any) => {
      root.data.states.push({ label: "Guizhou", value: "Guizhou" });
      root.data.cities.push({ label: "Guiyang", value: "Guiyang" });
      root.data.jobs[0].jobState = { label: "Guizhou", value: "Guizhou" };
    }],
    ["keyword echo", (root: any) => { root.data.keywordParam = "sales"; }],
    ["country echo", (root: any) => { root.data.countriesParam = ["China", "Singapore"]; }],
    ["category echo", (root: any) => { root.data.categoriesParam = ["Research"]; }],
    ["duplicate ID", (root: any) => { root.data.jobs[1].jobId = root.data.jobs[0].jobId; }]
  ] as const)("retains the %s contract on a shared geography row", (_name, mutate) => {
    const root = nestedListing("Guangzhou", "Guangdong"); mutate(root);
    expect(parseNovoChinaResponse(JSON.stringify(root))).toBeUndefined();
  });

  it.each([false, true])("still verifies each native JD and application, unavailable=%s", async unavailable => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), SOURCE_ID)!;
    const requests: string[] = [];
    const fetch = createOfficialJsonSourceFetch({ now: () => new Date(CAPTURED_AT), http: async request => {
      requests.push(request.url);
      const page = pages.get(request.url); if (!page) throw Error("Unexpected synthetic URL");
      const body = request.url === NOVO_CHINA_ENDPOINT ? JSON.stringify(nestedListing("Guangzhou", "Guangdong")) :
        unavailable && request.url.includes("career_job_req_id=") ? "<html>Unknown application state</html>" : page.body.replaceAll("Beijing, CN", "Guangzhou, CN");
      return { ...page, body, status: 200, capturedAt: CAPTURED_AT };
    } });
    const result = await runSourceCrawl(plan, { fetch, isBaseline: true });
    expect(requests[0]).toBe(NOVO_CHINA_ENDPOINT);
    expect(requests.some(url => url.includes("career_job_req_id="))).toBe(true);
    if (unavailable) {
      expect(result.status).toBe("FAILED"); expect(result.jobs).toEqual([]);
    } else {
      expect(result).toMatchObject({ status: "SUCCESS", truth: { completenessVerified: true } });
      expect(result.jobs.map(job => job.cities)).toEqual([["广州"], ["广州"]]);
      expect(result.fetchEvidence?.fetchLosses).toHaveLength(1);
      expect(replayNovoChinaRows(plan, result.fetchEvidence!, result.jobs, CAPTURED_AT)).toBe(true);
    }
  });
});
