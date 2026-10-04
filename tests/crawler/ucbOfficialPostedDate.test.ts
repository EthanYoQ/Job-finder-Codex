import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { getSourceQualityPolicy } from "../../src/crawler/sourceQualityAdmission";

const capturedAt = "2026-10-01T10:11:47.457Z";
const postedDate = "2026-08-24T05:54:14.000+0000";
const officialPublishedAt = "2026-08-24T05:54:14.000Z";
function ucbPlan() {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-ucb-china-social");
  if (plan?.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") throw new Error("UCB plan missing");
  return plan;
}
function rawJob(overrides: Record<string, unknown> = {}) {
  return { jobSeqNo: "UCB1GLOBAL93941EXTERNALZHGLOBAL", jobId: "93941", reqId: "93941",
    title: "Senior Associate Scouting and Partnering (Scientific Search Evaluation)",
    location: "Shanghai, Shanghai, China", city: "Shanghai", country: "China",
    postedDate, dateCreated: "2026-08-24T12:15:38.356+0000", ...overrides };
}
async function fetchJobs(rows = [rawJob()], options: {
  plan?: SourceCrawlPlan; total?: number; from?: number; bootstrap?: Record<string, unknown>
} = {}) {
  const plan = options.plan ?? ucbPlan();
  let requests = 0;
  const fetched = await createOfficialJsonSourceFetch({
    allowBrowserFallback: false, now: () => new Date(capturedAt),
    http: async request => {
      requests++;
      if (requests > 2) throw new Error("No retained response for another request");
      if (request.method === "POST") return { status: 200, capturedAt, finalUrl: "https://careers.ucb.com/widgets",
        contentType: "application/json", body: JSON.stringify({ refineSearch: {
          totalHits: options.total ?? rows.length, ...(options.from === undefined ? {} : { from: options.from }), data: { jobs: rows, aggregations: [] }
        } }) };
      return { status: 200, capturedAt, finalUrl: plan.source.officialEntryUrl, contentType: "text/html",
        body: `<script>var phApp=${JSON.stringify({widgetApiEndpoint:"https://careers.ucb.com/widgets",country:"global",
          deviceType:"desktop",locale:"zh_global",refNum:"UCB1GLOBAL",pageName:"search-results",pageId:"page17",...options.bootstrap})};</script>` };
    }
  })(plan);
  return { plan, fetched, requests, result: await runSourceCrawl(plan, { fetch: async () => fetched }) };
}

describe("UCB official posted-date preservation without temporal admission", () => {
  it("preserves the exact official instant with unchanged raw and output counts", async () => {
    const { plan, fetched, result } = await fetchJobs();
    expect(fetched).toMatchObject({ ok: true, payload: { jobs: [{ officialPublishedAt }] }, fetchEvidence: {
      fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0 },
      fetchLosses: [], declaredCompleteness: { value: 1 }
    } });
    expect(result).toMatchObject({ jobs: [{ officialPublishedAt }], truth: { completenessVerified: true } });
    expect(result.jobs).toHaveLength(1);
    expect(getSourceQualityPolicy(plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    expect(sourcePlanConfigSha256(plan)).not.toBe("f2b511d8089acdbfa1604042d2eb3155be98cdf09d16cf15e4b6bee7a988260b");
  });

  it("preserves old postedDate despite recent dateCreated without excluding it by age", async () => {
    const { fetched, result } = await fetchJobs([rawJob({ postedDate: "2001-01-01T05:54:14.123+0000", dateCreated: "2026-09-30T00:00:00.000+0000" })]);
    expect(fetched).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1 }, fetchLosses: [] } });
    expect(result).toMatchObject({ jobs: [{ officialPublishedAt: "2001-01-01T05:54:14.123Z" }], truth: { completenessVerified: true } });
  });

  it("preserves a syntactically valid future raw date without temporal admission", async () => {
    const { plan, fetched, result } = await fetchJobs([rawJob({ postedDate: "2026-10-02T05:54:14.000+0000" })]);
    expect(fetched).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1 }, fetchLosses: [] } });
    expect(result).toMatchObject({ jobs: [{ officialPublishedAt: "2026-10-02T05:54:14.000Z" }], truth: { completenessVerified: true } });
    expect(getSourceQualityPolicy(plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
  });

  it.each([undefined, null, "", 1787550854, "2026-08-24", "2026-08-24T05:54:14.000", "2026-08-24T05:54:14.000Z",
    "2026-02-29T05:54:14.000+0000", "2026-04-31T05:54:14.000+0000", "0000-01-01T00:00:00.000+0000",
    "2026-08-24T24:00:00.000+0000", "2026-08-24T05:60:14.000+0000", "2026-08-24T05:54:60.000+0000",
    "2026-08-24T05:54:14.000+2400", "2026-08-24T05:54:14.000+0060",
    " 2026-08-24T05:54:14.000+0000", "2026-08-24T05:54:14.000+0000junk"])("fails closed and retains evidence for invalid postedDate %j", async value => {
    const { fetched, result } = await fetchJobs([rawJob({ postedDate: value })]);
    expect(fetched).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{}, {}], fetchCounts: { rawCount: 1, validCount: 0 },
      fetchLosses: [{ details: { code: "UCB_POSTED_DATE_INVALID", field: "postedDate", pageSequence: 0, recordIndex: 0 } }] } });
    expect(result.truth.completenessVerified).toBe(false);
  });

  it.each([
    ["2024-02-29T05:54:14.123+0000", "2024-02-29T05:54:14.123Z"],
    ["2026-08-24T05:54:14.123+0800", "2026-08-23T21:54:14.123Z"],
    ["2026-08-24T05:54:14.123-0530", "2026-08-24T11:24:14.123Z"],
    ["2026-10-01T10:11:47.457+0000", capturedAt]
  ])("preserves valid explicit-offset instant %s", async (raw, expected) => {
    const { result } = await fetchJobs([rawJob({ postedDate: raw })]);
    expect(result).toMatchObject({ jobs: [{ officialPublishedAt: expected }], truth: { completenessVerified: true } });
  });

  it.each([
    ["missing date", { officialPublishedAt: undefined }], ["changed date", { officialPublishedAt: "2026-08-24T12:15:38.356Z" }],
    ["changed ID", { sourceJobId: "other-job" }], ["changed title", { title: "Another role" }],
    ["changed URL", { officialUrl: "https://careers.ucb.com/global/en/job/other" }],
    ["changed location", { locationRaw: "Beijing, China" }], ["changed city", { cities: ["北京"] }]
  ])("independently rejects normalized payload with %s", async (_label, mutation) => {
    const { plan, fetched } = await fetchJobs();
    if (!fetched.ok || !("payload" in fetched)) throw new Error("Missing fetch result");
    const jobs = (fetched.payload as { jobs: object[] }).jobs.map(job => ({ ...job, ...mutation }));
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ...fetched, payload: { jobs } }) });
    expect(result.truth.completenessVerified).toBe(false);
  });

  it("binds replay to the original observation instant", async () => {
    const { plan, fetched, result } = await fetchJobs();
    if (!fetched.fetchEvidence || !fetched.paginationEvaluation || !result.reconciliation) throw new Error("Evidence missing");
    const input = { plan, evidence: fetched.fetchEvidence, paginationEvaluation: fetched.paginationEvaluation,
      reconciliation: result.reconciliation, jobs: result.jobs, capturedAt };
    expect(replayStrictSourceQualityEvidence(input)).toBe(true);
    expect(replayStrictSourceQualityEvidence({ ...input, capturedAt: "2026-08-01T00:00:00.000Z" })).toBe(false);
    expect(replayStrictSourceQualityEvidence({ ...input, capturedAt: "2026-10-02T00:00:00.000Z" })).toBe(false);
  });

  it.each(["country", "refNum", "locale", "pageId"])("rejects a changed UCB bootstrap %s", async field => {
    const { fetched } = await fetchJobs(undefined, { bootstrap: { [field]: "other" } });
    expect(fetched.ok).toBe(false);
  });

  it("does not let one preserved row justify an omitted offset when the raw total exceeds 50", async () => {
    const { fetched, result } = await fetchJobs([rawJob()], { total: 51 });
    expect(fetched.ok).toBe(false);
    expect(result.truth.completenessVerified).toBe(false);
  });

  it("rejects duplicate official IDs and foreign scope even when dates are valid", async () => {
    for (const rows of [[rawJob(), rawJob()], [rawJob({ country: "United States", location: "Boston, United States", city: "Boston" })]]) {
      const { result } = await fetchJobs(rows);
      expect(result.truth.completenessVerified).toBe(false);
    }
  });
  it("rejects dates swapped between two genuine raw IDs", async () => {
    const { plan, fetched } = await fetchJobs([rawJob(), rawJob({
      jobSeqNo: "UCB1GLOBAL93942EXTERNALZHGLOBAL", reqId: "93942", jobId: "93942",
      postedDate: "2026-09-24T05:54:14.000+0000"
    })]);
    if (!fetched.ok || !("payload" in fetched)) throw new Error("Missing fetch result");
    const original = (fetched.payload as { jobs: Array<Record<string, unknown>> }).jobs;
    const jobs = original.map((job, index) => ({ ...job, officialPublishedAt: original[1 - index]!.officialPublishedAt }));
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ...fetched, payload: { jobs } }) });
    expect(result.truth.completenessVerified).toBe(false);
  });

  it("leaves Organon's date interpretation and source config hash unchanged", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-organon-china-social");
    if (plan?.adapterId !== "official-json") throw new Error("Organon missing");
    expect(plan.json.fields.officialPublishedAt).toBeUndefined();
    expect(sourcePlanConfigSha256(plan)).toBe("c123a1e3fa44bc8e57f6b364718e2ff806de6c25703f9f7a4b1b9c9c186fabc7");
    const fetched = await createOfficialJsonSourceFetch({ now: () => new Date(capturedAt), http: async request => ({
      status: 200, capturedAt, finalUrl: request.url,
      contentType: request.method === "POST" ? "application/json" : "text/html",
      body: request.method === "POST" ? JSON.stringify({refineSearch:{totalHits:1,from:0,data:{jobs:[rawJob({
        applyUrl: "https://jobs.organon.com/cn/zh/job/93941", postedDate: "not a date"
      })],aggregations:[]}}}) : `<script>var phApp=${JSON.stringify({widgetApiEndpoint:"https://jobs.organon.com/widgets",
        country:"cn",deviceType:"desktop",locale:"zh_cn",refNum:"MECEUS",pageName:"search-results",pageId:"page18"})};</script>`
    }) })(plan);
    expect(fetched).toMatchObject({ok:true,payload:{jobs:[{sourceJobId:expect.any(String)}]}});
    if (!fetched.ok || !("payload" in fetched)) throw new Error("Fetch failed");
    expect((fetched.payload as {jobs:Array<Record<string,unknown>>}).jobs[0]).not.toHaveProperty("officialPublishedAt");
  });

  it.each(["company", "source", "date field", "country filter", "city policy", "copied policy"])("rejects altered UCB binding: %s", async kind => {
    const plan = ucbPlan();
    if (plan.officialJsonFetch?.kind !== "phenom") throw new Error("UCB missing");
    const changed = structuredClone(plan);
    if (kind === "company") changed.company.id = "company-other";
    if (kind === "source") changed.source.companyId = "company-other";
    if (kind === "date field") delete changed.json.fields.officialPublishedAt;
    if (kind === "country filter" && changed.officialJsonFetch?.kind === "phenom") changed.officialJsonFetch.countryFilter = "United States";
    if (kind === "city policy" && changed.officialJsonFetch?.kind === "phenom") delete changed.officialJsonFetch.cityScopePolicy;
    if (kind === "copied policy") changed.source.id = "source-other-social";
    const { fetched } = await fetchJobs(undefined, { plan: changed });
    expect(fetched.ok).toBe(false);
  });

  it.each([
    ["Yancheng, Jiangsu, China", "Yancheng"],
    ["Changsha, Chongqing, China", "Changsha"],
    ["Taiyuan, Yancheng, China", "Taiyuan"],
    ["Xian,  Shaanxi, China", "Xian  City"]
  ])("holds unreviewed or conflicting locality grammar %s", async (location, city) => {
    const { result } = await fetchJobs([rawJob({ location, city })]);
    expect(result.truth.completenessVerified).toBe(false);
  });

  it.each(["Beijing","NotShanghai"])("independently rejects coherent raw city %s with a forged matching output",async city=>{
    const {plan,fetched}=await fetchJobs();
    if(!fetched.ok||!("payload" in fetched)||!fetched.fetchEvidence)throw Error("Evidence missing");
    const evidence=structuredClone(fetched.fetchEvidence),artifact=evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!;
    const body=JSON.parse(artifact.body as string);body.refineSearch.data.jobs[0].city=city;artifact.body=JSON.stringify(body);
    evidence.pages[0]!.responseFingerprintSha256=createHash("sha256").update(artifact.body).digest("hex");
    const coherent=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true});
    const paginationEvaluation=evaluatePaginationEvidence({evidence:coherent,expectedChannelIds:[],filteredOutput:true});
    const payload={jobs:(fetched.payload as {jobs:object[]}).jobs.map(job=>({...job,cities:city==="Beijing"?["上海","北京"]:["上海"]}))};
    const result=await runSourceCrawl(plan,{fetch:async()=>({...fetched,fetchEvidence:coherent,paginationEvaluation,payload})});
    expect(result.truth.completenessVerified).toBe(false);
  });

  it("rejects a coherent raw and output location mutation that the fetcher considers ambiguous", async () => {
    const { plan, fetched } = await fetchJobs();
    if (!fetched.ok || !("payload" in fetched) || !fetched.fetchEvidence || !fetched.paginationEvaluation) throw new Error("Missing evidence");
    const evidence = structuredClone(fetched.fetchEvidence);
    const page = evidence.artifacts.find(artifact => artifact.logicalKey === "phenom-page-0000")!;
    const body = JSON.parse(page.body as string);
    body.refineSearch.data.jobs[0].location = "Shanghai, Atlantis";
    page.body = JSON.stringify(body);
    evidence.pages[0]!.responseFingerprintSha256 = createHash("sha256").update(page.body).digest("hex");
    const payload = {jobs:(fetched.payload as {jobs:object[]}).jobs.map(job=>({...job,locationRaw:"Shanghai, Atlantis"}))};
    const coherentEvidence = deriveCanonicalPaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true });
    const paginationEvaluation = evaluatePaginationEvidence({ evidence: coherentEvidence, expectedChannelIds: [], filteredOutput: true });
    expect(paginationEvaluation.safeCompleteness).toBe(true);
    const result = await runSourceCrawl(plan,{fetch:async()=>({...fetched,fetchEvidence:coherentEvidence,payload,paginationEvaluation})});
    expect(result.truth.completenessVerified).toBe(false);
  });

});
