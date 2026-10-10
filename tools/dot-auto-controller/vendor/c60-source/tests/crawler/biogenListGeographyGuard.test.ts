import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { exactBiogenListGeographyPlan } from "../../src/crawler/biogenListGeographyGuard";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { createWorkdaySourceFetch } from "../../src/crawler/workdaySourceFetch";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";
import { getSourceQualityPolicy } from "../../src/crawler/sourceQualityAdmission";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";

const capturedAt = "2026-10-01T10:11:40.471Z";
function plan() {
  return getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-biogen-china-social")!;
}
function row(overrides: Record<string, unknown> = {}) {
  return { title: "Medical Research Specialist", externalPath: "/job/Shanghai-China/Medical-Research-Specialist_REQ24110-1",
    locationsText: "Shanghai, China", postedOn: "Posted 30+ Days Ago", bulletFields: ["REQ24110"], ...overrides };
}
function responseBody(rows: Array<Record<string, unknown>>) {
  return { total: rows.length, jobPostings: rows, facets: [{ facetParameter: "locationMainGroup", values: [
    { facetParameter: "locationCountry", values: [{ descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4", count: rows.length }] },
    { facetParameter: "locations", values: [
      { descriptor: "Shanghai, China", id: "c20707a4650c018390f4e48ed845efa6", count: rows.filter(row => row.locationsText === "Shanghai, China").length },
      { descriptor: "Beijing, China", id: "1d1ae2cf252d013639674034b420cda4", count: rows.filter(row => row.locationsText === "Beijing, China").length }
    ].filter(value => value.count > 0) }
  ] }] };
}
async function capture(rows = [row()], mutateBody?: (body: ReturnType<typeof responseBody>) => void) {
  const source = plan();
  const body = responseBody(rows); mutateBody?.(body);
  const fetched = await createWorkdaySourceFetch({ now: () => new Date(capturedAt), http: async request => ({
    status: 200, finalUrl: request.url, contentType: "application/json", capturedAt,
    body: JSON.stringify(body)
  }) })(source);
  return { source, fetched, result: await runSourceCrawl(source, { fetch: async () => fetched }) };
}

describe("Biogen explicitly mainland city-pending policy", () => {
  it("accepts semantically identical configuration object key order", () => {
    const source = structuredClone(plan());
    if (source.adapterId !== "official-json" || !source.workday) throw Error("Biogen plan");
    source.workday = Object.fromEntries(Object.entries(source.workday).reverse()) as typeof source.workday;
    source.json.fields = Object.fromEntries(Object.entries(source.json.fields).reverse()) as typeof source.json.fields;
    expect(exactBiogenListGeographyPlan(source)).toBe(true);
  });
  it("preserves unknown exact dates on unambiguous rows under the exact policy", async () => {
    const { source, result } = await capture();
    expect(getSourceQualityPolicy(source)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ locationRaw: "Shanghai, China", cities: ["上海"] });
    expect(result.jobs[0]!.officialPublishedAt).toBeUndefined();
  });

  it.each([
    { locationsText: "2 Locations" }, { locationsText: "Multiple locations" }, { locationsText: "" },
    { locationsText: undefined }, { locationsText: "Shanghai, United States" },
    { locationsText: "Shanghai, China | Hong Kong" }, { locationsText: "Beijing, China" },
    { title: "Representative (Location: Atlantis)" }, { title: "Representative (Location: Hong Kong)" },
    { title: "Representative (Location: Boston)" }, { title: "Role (Location: Wuhan / Tokyo)" },
    { title: "Role (Location: Wuhan) (Location: Changsha)" }, { country: "United States" },
    { bulletFields: ["REQ999"] }, { externalPath: "/job/Shanghai-China/Other_REQ999-1" }
  ])("fails the complete source before slug/title enrichment for %j", async mutation => {
    const { fetched, result } = await capture([row(mutation)]);
    expect(fetched.ok).toBe(false);
    expect(result.truth.completenessVerified).toBe(false);
    expect(fetched.fetchEvidence?.artifacts).toHaveLength(1);
    expect(fetched.fetchEvidence?.fetchLosses[0]?.details?.code).toBe("BIOGEN_LIST_GEOGRAPHY_UNRESOLVED");
  });

  it("preserves all seven jobs and marks only the three explicit mainland city conflicts pending", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({
      title: ["Role", "Regional Security Lead, APAC", "Representative (Location: Wuhan)", "Role", "Representative (Location:Urumqi‌)", "MSL (Location: Changsha)", "Role"][i],
      externalPath: `/job/${i === 6 ? "Beijing" : "Shanghai"}-China/Role_REQ${24000 + i}-1`,
      locationsText: i === 6 ? "Beijing, China" : "Shanghai, China", bulletFields: [`REQ${24000 + i}`]
    }));
    const { fetched, result } = await capture(rows);
    expect(fetched).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: {
      rawCount: 7, parsedCount: 7, validCount: 7, validationDiscardCount: 0
    } } });
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs.map(job => job.cities)).toEqual([["上海"], ["上海"], ["城市待核"], ["上海"], ["城市待核"], ["城市待核"], ["北京"]]);
    expect(result.jobs.filter(job => job.cities.includes("城市待核")).every(job => job.locationRaw === "Shanghai, China")).toBe(true);
    expect(result.jobs.every(job => job.officialPublishedAt === undefined)).toBe(true);
  });

  it("never derives extra cities from arbitrary title words", async () => {
    const { result } = await capture([row({ title: "Beijing collaboration lead" })]);
    expect(result.jobs[0]?.cities).toEqual(["上海"]);
  });

  it.each(["opaque raw location", "conflicting title", "forged city", "invented date", "changed China facet", "changed location facet", "changed requisition ID"])("independent replay rejects %s", async mutation => {
    const { source, fetched, result } = await capture();
    if (!fetched.fetchEvidence || !result.reconciliation) throw Error("Missing fixture evidence");
    const evidence = structuredClone(fetched.fetchEvidence), jobs = structuredClone(result.jobs);
    if (mutation === "forged city") jobs[0]!.cities = ["北京"];
    else if (mutation === "invented date") jobs[0]!.officialPublishedAt = "2026-09-01T00:00:00.000Z";
    else {
      const body = JSON.parse(String(evidence.artifacts[0]!.body));
      if (mutation === "opaque raw location") body.jobPostings[0].locationsText = "2 Locations";
      else if (mutation === "changed China facet") body.facets[0].values[0].values[0].count = 2;
      else if (mutation === "changed location facet") body.facets[0].values[1].values[0].descriptor = "Beijing, China";
      else if (mutation === "changed requisition ID") body.jobPostings[0].bulletFields = ["REQ999"];
      else body.jobPostings[0].title = "Representative (Location: Wuhan)";
      evidence.artifacts[0]!.body = JSON.stringify(body);
      evidence.pages[0]!.responseFingerprintSha256 = createHash("sha256").update(String(evidence.artifacts[0]!.body)).digest("hex");
    }
    const canonical = deriveCanonicalPaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true });
    const paginationEvaluation = evaluatePaginationEvidence({ evidence: canonical, expectedChannelIds: [], filteredOutput: true });
    expect(replayStrictSourceQualityEvidence({ plan: source, evidence: canonical, paginationEvaluation,
      reconciliation: result.reconciliation, jobs, capturedAt })).toBe(false);
  });
  it.each(["missing facets", "missing China", "wrong China count", "wrong China ID", "foreign China descriptor", "duplicate China", "wrong location count", "unrecognized location", "duplicate ID"])("fails the source for %s", async mutation => {
    const { fetched, result } = await capture([row()], body => {
      const groups = body.facets[0]!.values;
      if (mutation === "missing facets") body.facets = [];
      else if (mutation === "missing China") groups[0]!.values = [];
      else if (mutation === "wrong China count") groups[0]!.values[0]!.count = 2;
      else if (mutation === "wrong China ID") groups[0]!.values[0]!.id = "foreign-id";
      else if (mutation === "foreign China descriptor") groups[0]!.values[0]!.descriptor = "United States";
      else if (mutation === "duplicate China") groups[0]!.values.push({ ...groups[0]!.values[0]! });
      else if (mutation === "wrong location count") groups[1]!.values[0]!.count = 2;
      else if (mutation === "unrecognized location") groups[1]!.values[0]!.descriptor = "2 Locations";
      else { body.jobPostings.push({ ...body.jobPostings[0]! }); body.total = 2; groups[0]!.values[0]!.count = 2; groups[1]!.values[0]!.count = 2; }
    });
    expect(fetched.ok).toBe(false); expect(result.truth.completenessVerified).toBe(false);
  });
});
