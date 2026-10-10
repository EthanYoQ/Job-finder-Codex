import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { replayStrictSourceQualityEvidence, runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { exactNovoChinaQualityPlan, parseNovoChinaResponse, replayNovoChinaRows } from "../../src/crawler/novoChinaQuality";

export const NOVO_CAPTURED_AT = "2026-10-02T01:44:06.473Z";
export const NOVO_BODY_SHA256 = "dbcb26cdb6364e210447c946610dbf51a33680efc5d7a9e6c823c0b368a9c9f3";
export const NOVO_ENDPOINT = "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";
const body = readFileSync("tests/fixtures/novo-nordisk/retained-china-list-20261002.json", "utf8");
const htmlCaptures: Record<string, { body: string; finalUrl: string; contentType: string }> = JSON.parse(gunzipSync(readFileSync("tests/fixtures/novo-nordisk/retained-native-applications-20261002.json.gz")).toString());
const rawBody = () => JSON.parse(body);
const planForNovo = () => getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-novo-nordisk-china-social")!;

async function capture(mutate?: (root: ReturnType<typeof rawBody>) => void, plan = planForNovo()) {
  const raw = rawBody(); mutate?.(raw);
  const fetch = createOfficialJsonSourceFetch({ now: () => new Date(NOVO_CAPTURED_AT), http: async request => {
    expect(request.method).toBe("GET");
    if (request.url !== NOVO_ENDPOINT) {
      const retained = htmlCaptures[request.url]; if (!retained) throw Error(`Unexpected URL ${request.url}`);
      return { status: 200, ...retained, capturedAt: NOVO_CAPTURED_AT };
    }
    return { status: 200, finalUrl: NOVO_ENDPOINT, contentType: "application/json;charset=utf-8", capturedAt: NOVO_CAPTURED_AT,
      body: mutate ? JSON.stringify(raw) : body };
  } });
  const result = await runSourceCrawl(plan, { fetch, isBaseline: true });
  return { plan, result };
}

const mutations: Array<[string, (root: ReturnType<typeof rawBody>) => void]> = [
  ...["jobCountry", "jobState", "jobCity"].flatMap(field => ["label", "value"].map(part =>
    [`${field}.${part}`, (root: ReturnType<typeof rawBody>) => { root.data.jobs[0][field][part] = "United States"; }] as [string, (root: ReturnType<typeof rawBody>) => void])),
  ["foreign country pair", root => { root.data.jobs[0].jobCountry = { label: "United States", value: "United States" }; }],
  ["state mismatch", root => { root.data.jobs[0].jobState = { label: "Shanghai", value: "Shanghai" }; }],
  ["unknown city", root => { root.data.jobs[0].jobCity = { label: "Atlantis", value: "Atlantis" }; root.data.jobs[0].jobLocationLabel = "China, Atlantis"; }],
  ["location conflict", root => { root.data.jobs[0].jobLocationLabel = "China, Shanghai"; }],
  ["foreign location", root => { root.data.jobs[0].jobLocationLabel = "United States, Beijing"; }],
  ["unknown country", root => { root.data.jobs[0].jobCountry = { label: "Unknown", value: "Unknown" }; }],
  ["job locale", root => { root.data.jobs[0].jobLocale = "zh_CN"; }],
  ["id locale", root => { root.data.jobs[0].jobId = "346138.zh_CN"; }],
  ["noncanonical id", root => { root.data.jobs[0].jobId = "346138.en_GB/other"; }],
  ["duplicate id", root => { root.data.jobs[1].jobId = root.data.jobs[0].jobId; }],
  ["shadow country", root => { root.data.jobs[0].country = "United States"; }],
  ["shadow city", root => { root.data.jobs[0].jobCity.city = "Boston"; }],
  ["shadow date", root => { root.data.jobs[0].publishedAt = NOVO_CAPTURED_AT; }],
  ["root status", root => { root.status = 500; }],
  ["root message", root => { root.message = "failed"; }],
  ["country echo", root => { root.data.countriesParam = ["United States"]; }],
  ["mixed country echo", root => { root.data.countriesParam = ["China", "United States"]; }],
  ["locale echo", root => { root.data.localeParam = "en_GB"; }],
  ["keyword filter", root => { root.data.keywordParam = "sales"; }],
  ["category filter", root => { root.data.categoriesParam = ["Research"]; }],
  ["root shadow country", root => { root.data.country = "United States"; }],
  ["total disagreement", root => { root.data.totalMatches = 28; }],
  ["shadow total", root => { root.data.total = 100; }],
  ["missing country", root => { delete root.data.jobs[0].jobCountry; }],
  ["missing state", root => { delete root.data.jobs[0].jobState; }],
  ["missing city value", root => { delete root.data.jobs[0].jobCity.value; }],
  ["root shadow", root => { root.country = "United States"; }],
  ["city facet conflict", root => { root.data.cities[0].value = "Boston"; }],
  ["state facet conflict", root => { root.data.states[0].label = "Boston"; }],
  ["subcategory shadow", root => { root.data.jobs[0].jobSubCategory.country = "United States"; }]
];

describe("Novo China retained raw-row proof", () => {
  it("reconciles 27 native list rows to 20 active and 7 explicit closures, retaining unknown dates", async () => {
    expect(Buffer.byteLength(body)).toBe(21691);
    expect(createHash("sha256").update(body).digest("hex")).toBe(NOVO_BODY_SHA256);
    const { plan, result } = await capture();
    expect(plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "novo-nordisk" && plan.officialJsonFetch.cityScopePolicy).toBe("NOVO_CHINA_NESTED_LOCATION_V2");
    expect(result).toMatchObject({ status: "SUCCESS", truth: { completenessVerified: true }, fetchEvidence: { fetchCounts: { rawCount: 27, parsedCount: 27, validCount: 20, parseDiscardCount: 0, validationDiscardCount: 7 } } });
    expect(result.jobs).toHaveLength(20);
    expect(result.fetchEvidence!.fetchLosses).toHaveLength(7);
    expect(result.jobs.every(job => job.officialUrl.startsWith("https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/"))).toBe(true);
    expect(result.jobs.find(job => job.officialUrl.includes("346130"))?.officialTitle).toBe("Research Associate, Rodent Pharmacology");
    expect(result.jobs.every(job => job.officialPublishedAt === undefined && job.category === "其他")).toBe(true);
    expect(Object.fromEntries([...new Set(result.jobs.flatMap(job => job.cities))].map(city => [city, result.jobs.filter(job => job.cities.includes(city)).length]))).toEqual({ 北京: 15, 上海: 2, 大庆: 1, 松原: 1, 长春: 1 });
    expect(result.fetchEvidence!.artifacts[0]!.body).toBe(body);
    const changed = await capture(root => { root.data.jobs = root.data.jobs.filter((row: { jobId: string }) => row.jobId !== "345696.en_GB"); root.data.totalMatches--; });
    expect(changed.result).toMatchObject({ status: "SUCCESS", fetchEvidence: { fetchCounts: { rawCount: 26, validCount: 19, validationDiscardCount: 7 } } });
  });
  it("rejects unavailable application status rather than counting it closed", async () => {
    const key = Object.keys(htmlCaptures).find(url => url.includes("career_job_req_id=346138"))!;
    const original = htmlCaptures[key]!.body;
    try {
      htmlCaptures[key]!.body = "<html>Request blocked</html>";
      const { result } = await capture();
      expect(result.status).toBe("FAILED");
      expect(result.jobs).toEqual([]);
      expect(result.fetchEvidence?.fetchLosses).toEqual([]);
    } finally { htmlCaptures[key]!.body = original; }
  });
  it.each(mutations)("fails closed for %s", async (_name, mutate) => {
    const { result } = await capture(mutate);
    expect(result.truth.completenessVerified).toBe(false);
  });
  it.each(["officialTitle", "locationRaw", "officialUrl", "sourceJobId", "cities", "officialPublishedAt"])("rejects forged output %s during strict replay", async field => {
    const { plan, result } = await capture();
    const jobs = structuredClone(result.jobs), job = jobs[0]!;
    if (field === "cities") job.cities = ["上海"];
    else if (field === "officialPublishedAt") job.officialPublishedAt = NOVO_CAPTURED_AT;
    else if (field === "officialUrl") job.officialUrl = "https://www.novonordisk.com/careers/find-a-job/job-ad.999999.en_GB.html";
    else if (field === "officialTitle") job.officialTitle = "Forged title";
    else if (field === "locationRaw") job.locationRaw = "China, Shanghai";
    else job.sourceJobId = "official-json:sha256:" + "b".repeat(64);
    expect(replayStrictSourceQualityEvidence({ plan, evidence: result.fetchEvidence!, paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!, jobs, capturedAt: NOVO_CAPTURED_AT })).toBe(false);
  });
  it.each(["rawJobIds", "validJobIds"] as const)("rejects a substituted %s row hash", async field => {
    const { plan, result } = await capture(), evidence = structuredClone(result.fetchEvidence!);
    evidence.pages[0]![field][0] = "sha256:" + "b".repeat(64);
    expect(replayNovoChinaRows(plan, evidence, result.jobs, NOVO_CAPTURED_AT)).toBe(false);
    expect(replayStrictSourceQualityEvidence({ plan, evidence, paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!, jobs: result.jobs, capturedAt: NOVO_CAPTURED_AT })).toBe(false);
  });
  it("rejects duplicate JSON keys rather than accepting the final value", () => {
    expect(parseNovoChinaResponse(body.replace(/"status":\s*200/u, '"status":500,"status":200'))).toBeUndefined();
    expect(parseNovoChinaResponse(body.replace('"jobCountry":', '"jobCountry":{"label":"United States","value":"United States"},"jobCountry":'))).toBeUndefined();
  });
  it.each(["sourceKind", "atsKind", "officialChineseCompanyName", "listUrl", "auxiliaryChineseTitle", "entry", "chain", "capturedAt", "snapshot", "pdf"])("rejects forged output metadata %s", async field => {
    const { plan, result } = await capture(), jobs = structuredClone(result.jobs), job = jobs[0]!;
    if (field === "sourceKind") Object.assign(job, { sourceKind: "CAMPUS" });
    else if (field === "atsKind") job.atsKind = "WORKDAY";
    else if (field === "officialChineseCompanyName") job.officialChineseCompanyName = "Other company";
    else if (field === "listUrl") job.listUrl = "https://www.example.com/jobs";
    else if (field === "auxiliaryChineseTitle") job.auxiliaryChineseTitle = "Invented title";
    else if (field === "entry") job.evidence.officialEntryUrl = "https://www.example.com/jobs";
    else if (field === "chain") job.evidence.officialChainEvidenceUrl = "https://www.example.com/careers";
    else if (field === "capturedAt") job.evidence.capturedAt = "2026-10-02T01:44:06.474Z";
    else if (field === "snapshot") job.evidence.rawSnapshotRef = "unbound-snapshot";
    else job.evidence.astellasPdfLocation = { country: "中国", status: "CITY_SPECIFIC" };
    expect(replayStrictSourceQualityEvidence({ plan, evidence: result.fetchEvidence!, paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!, jobs, capturedAt: NOVO_CAPTURED_AT })).toBe(false);
  });
  it.each(["rawBodySha256", "redactionDescriptors", "bodyRepresentation"])("rejects raw artifact %s provenance", async field => {
    const { plan, result } = await capture(), evidence = structuredClone(result.fetchEvidence!);
    if (field === "rawBodySha256") evidence.artifacts[0]!.rawBodySha256 = NOVO_BODY_SHA256;
    else if (field === "redactionDescriptors") evidence.artifacts[0]!.redactionDescriptors = [{ kind: "UPSTREAM_ERROR_TEXT", count: 1 }];
    else evidence.artifacts[0]!.bodyRepresentation = "REDACTED";
    expect(replayNovoChinaRows(plan, evidence, result.jobs, NOVO_CAPTURED_AT)).toBe(false);
  });
  it.each(["source", "company", "entry", "endpoint", "policy", "mapping", "chain"])("rejects a transplanted %s binding", mutation => {
    const plan = structuredClone(planForNovo());
    expect(exactNovoChinaQualityPlan(plan)).toBe(true);
    if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "novo-nordisk") throw Error("Novo plan");
    if (mutation === "source") plan.source.id = "source-transplanted-novo";
    else if (mutation === "company") plan.company.id = "company-transplanted-novo";
    else if (mutation === "entry") plan.source.officialEntryUrl += "&location=Beijing";
    else if (mutation === "endpoint") plan.officialJsonFetch.endpointUrl += "&country=China";
    else if (mutation === "policy") plan.officialJsonFetch.cityScopePolicy = "NOVO_CHINA_MAINLAND_JOB_CITY_V1";
    else if (mutation === "mapping") plan.json.fields.officialPublishedAt = "date";
    else plan.source.officialChainEvidenceUrl = "https://www.example.com/careers";
    expect(exactNovoChinaQualityPlan(plan)).toBe(false);
  });
});
