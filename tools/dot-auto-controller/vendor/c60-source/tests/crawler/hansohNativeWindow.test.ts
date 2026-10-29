import { validateStrictHansohNativeWindowEvidence } from "../../src/crawler/hansohNativeWindowEvidence";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpResponse } from "../../src/crawler/officialJsonSourceFetch";
import { finalizeOfficialJsonEvidenceBundle } from "../../src/crawler/officialJsonEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { requestContractV2Locator } from "../../src/crawler/strictPageRequestContract";

const NOW = "2026-10-01T11:00:35.000Z";
const ENTRY = "https://hspharm.zhiye.com/social";
const ENDPOINT = "https://hspharm.zhiye.com/api/Jobad/GetJobAdPageList";
const DISPLAY = ["Category", "Kind", "LocId", "Salary", "Degree", "YearsOfWorking", "ClassificationOne", "WorkWeChatQrCode", "PostDate"];
type Plan = Extract<SourceCrawlPlan, {adapterId: "official-json"}>;
function canonicalPlan(): Plan { return getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-hansoh-social") as Plan; }
function nativePlan(): Plan {
  const plan = structuredClone(canonicalPlan());
  if (plan.officialJsonFetch?.kind !== "beisen-zhiye-2022") throw Error("Missing Hansoh");
  delete plan.officialJsonFetch.changedWithinDays;
  plan.officialJsonFetch.postDateWithinDays = 180;
  plan.officialJsonFetch.displayFields = [...DISPLAY];
  return plan;
}
function row(n: number, extra: Record<string, unknown> = {}) {
  return { Id: `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`, JobAdId: n, JobAdName: `职位 ${n}`,
    Category: "社会招聘", CategoryId: "1", Status: 1, Kind: "全职", LocNames: ["上海市"], PostDate: "2026-09-01T12:00:00", ...extra };
}
function body(sequence = 0) { return {PageIndex: sequence, PageSize: 100, PostDate: [180], Category: ["1"], KeyWords: "", SpecialType: 0, PortalId: "", DisplayFields: [...DISPLAY]}; }
async function collect(rows = [row(1)], options: {plan?: Plan; response?: Partial<OfficialJsonHttpResponse>; total?: number; returnedPage?: boolean} = {}) {
  const plan = options.plan ?? nativePlan(); const requests: Record<string, unknown>[] = [];
  const fetched = await createOfficialJsonSourceFetch({now: () => new Date(NOW), http: async request => {
    const parsed = JSON.parse(request.body!); requests.push(parsed); const index = parsed.PageIndex as number;
    return { status: 200, finalUrl: ENDPOINT, contentType: "application/json; charset=utf-8", capturedAt: NOW,
      body: JSON.stringify({Code: 200, Count: options.total ?? rows.length, ...(options.returnedPage ? {PageIndex: index} : {}), Data: rows.slice(index*100, (index+1)*100)}), ...options.response };
  }})(plan);
  const result = await runSourceCrawl(plan, {fetch: async () => fetched});
  return {plan, fetched, result, requests};
}
function rehash(fetched: any) {
  for (const page of fetched.fetchEvidence.pages) {
    const artifact = fetched.fetchEvidence.artifacts.find((a: any) => a.logicalKey === page.artifactLogicalKey);
    page.responseFingerprintSha256 = createHash("sha256").update(artifact.body).digest("hex");
  }
  const rebuilt = finalizeOfficialJsonEvidenceBundle({...fetched.fetchEvidence, allowMissingReturnedPage: true});
  fetched.fetchEvidence = rebuilt.evidence; fetched.paginationEvaluation = rebuilt.evaluation;
}

describe("Hansoh native half-year request and independent replay", () => {
  it("replays the observed Huaian district and preserves the original location", async () => {
    const observed = {Id: "5ce20cd6-59de-44a0-95a1-76eabe12be05", LocNames: ["江苏省·淮安市·淮安区"], PostDate: "2026-10-15T18:55:19"};
    const {result} = await collect([row(1, observed)]);
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs[0].locationRaw).toBe("江苏省·淮安市·淮安区");
    expect(result.jobs[0].cities).toEqual(["淮安区"]);
    const rejected = await collect([row(1, {...observed, LocNames: ["江苏省·淮安市·未知区"]})]);
    expect(rejected.result.truth.completenessVerified).toBe(false);
    expect(rejected.result.observation.completenessBlockerReason).toBe("HANSOH_UNRECOGNIZED_MAINLAND_LOCATION");
  });

  it("binds the canonical source to the native 180-day filter without altering United Lab's 183-day policy", () => {
    expect(canonicalPlan().officialJsonFetch).toEqual(nativePlan().officialJsonFetch);
    const united = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-united-lab-social") as Plan;
    expect(united.officialJsonFetch).toMatchObject({changedWithinDays: 183});
  });
  it("replays a native-filter positive total with exact main projection and no local ChangeDate inference", async () => {
    const {plan, fetched, result, requests} = await collect([row(1, {ChangeDate: "0001-01-01T00:00:00"})]);
    expect(requests).toEqual([body()]);
    expect(fetched.fetchEvidence?.artifacts[0]?.bodyRepresentation).toBe("EXACT");
    expect(validateStrictHansohNativeWindowEvidence(nativePlan(), result.fetchEvidence!, result.jobs)).toBe(true);
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.fetchEvidence?.fetchCounts).toEqual({rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0});
    expect(result.observation).toMatchObject({structuredJobCount: 1, expectedJobCount: 1, completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT"});
  });
  it("preserves exact complete three-page accounting without pinning live IDs or count", async () => {
    const {result, requests} = await collect(Array.from({length: 203}, (_, i) => row(i+1)));
    expect(validateStrictHansohNativeWindowEvidence(nativePlan(), result.fetchEvidence!, result.jobs)).toBe(true);
    expect(result.truth.completenessVerified).toBe(true); expect(result.jobs).toHaveLength(203);
    expect(requests).toEqual([body(0), body(1), body(2)]);
    expect(result.fetchEvidence?.pages.map(p => p.returnedPage)).toEqual([null, null, null]);
  });
  it("accepts the source's seven-digit publication timestamp precision unchanged", async () => {
    const {result} = await collect([row(1, {PostDate: "2026-09-10T13:50:54.3682272"})]);
    expect(result.truth.completenessVerified).toBe(true);
  });
  it.each(["兼职", "实习", "劳务工", null, undefined])("does not add a full-time-only restriction to social jobs: %j", async Kind => {
    const {result} = await collect([row(1, {Kind})]);
    expect(result.truth.completenessVerified).toBe(true);
  });
  it.each([0, "1", undefined, null, 2])("does not certify an unproven status marker %j", async Status => {
    const {result} = await collect([row(1, {Status})]);
    expect(result.truth.completenessVerified).toBe(false);
  });
  it.each([undefined, null, "", "0001-01-01T00:00:00", "2026-02-30T12:00:00", "bad", 123])("does not fabricate a projected publication date from %j", async PostDate => {
    const {result} = await collect([row(1, {PostDate})]); expect(result.truth.completenessVerified).toBe(false);
  });
  it.each(["火星", "APAC", "香港", "美国", "上海·香港", "江苏省·南京市·未知区"])("does not certify unproved geography %s", async location => {
    const {result} = await collect([row(1, {LocNames: [location]})]); expect(result.truth.completenessVerified).toBe(false);
  });
  it.each([{Country: "美国"}, {CountryName: "火星"}, {City: "北京"}, {LocName: {}}, {Category: "校园招聘"}])("rejects conflicting raw metadata %j", async extra => {
    expect((await collect([row(1, extra)])).result.truth.completenessVerified).toBe(false);
  });
  it.each(["江苏省·连云港市·连云区", "湖南省·长沙市·浏阳市", "上海市·浦东新区", "江苏省·常州市·新北区", "云南省·大理白族自治州", "山东省·东营市/滨州市"])("supports exact observed mainland hierarchy %s", async location => {
    const {result} = await collect([row(1, {LocNames: [location]})]); expect(validateStrictHansohNativeWindowEvidence(nativePlan(), result.fetchEvidence!, result.jobs)).toBe(true);
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs[0]?.locationRaw).toBe(location);
    for (const extra of [{Country: "美国"}, {City: "北京"}]) {
      expect((await collect([row(1, {LocNames: [location], ...extra})])).result.truth.completenessVerified).toBe(false);
    }
  });
  it.each(["source", "company", "entry", "chain", "date", "display", "pageSize", "maxPages", "json", "fallback"])("rejects changed %s plan binding", async field => {
    const {plan, fetched} = await collect(); const altered = structuredClone(plan) as any;
    if (field === "source") altered.source.id = "source-other-social";
    if (field === "company") altered.company.id = "company-other";
    if (field === "entry") altered.source.officialEntryUrl = "https://other.zhiye.com/social/jobs";
    if (field === "chain") altered.source.officialChainEvidenceUrl = ENTRY;
    if (field === "date") altered.officialJsonFetch.changedWithinDays = 183;
    if (field === "display") altered.officialJsonFetch.displayFields = ["Category", "Kind", "LocId", "PostDate", "ClassificationOne", "WorkWeChatQrCode"];
    if (field === "pageSize") altered.officialJsonFetch.pageSize = 20;
    if (field === "maxPages") altered.officialJsonFetch.maxPages = 100;
    if (field === "json") altered.json.fields.officialTitle = "other";
    if (field === "fallback") altered.officialJsonFetch.defaultLocationRaw = "中国";
    expect(sourcePlanConfigSha256(altered)).not.toBe(sourcePlanConfigSha256(plan));
    expect((await runSourceCrawl(altered, {fetch: async () => fetched})).truth.completenessVerified).toBe(false);
  });
  it.each(["PostDate", "Category", "KeyWords", "DisplayFields", "PageSize"])("rejects a differently captured request %s", async field => {
    const {plan, fetched} = await collect(); const forged = structuredClone(fetched) as any;
    const artifact = forged.fetchEvidence.artifacts[0]; const request: any = body();
    if (field === "PostDate") delete request.PostDate; else request[field] = field === "PageSize" ? 20 : [];
    artifact.extractorLocator = requestContractV2Locator(artifact.extractorLocator.split("|request-contract-v2")[0], {
      family: "beisen", role: "page", method: "POST", url: ENDPOINT, body: request,
      coordinate: {sequence: 0, requestedPage: 0, requestedPageSize: 100}
    });
    forged.fetchEvidence.declaredCompleteness.extractorLocator = artifact.extractorLocator; rehash(forged);
    expect((await runSourceCrawl(plan, {fetch: async () => forged})).truth.completenessVerified).toBe(false);
  });
  it.each(["title", "officialUrl", "locationRaw", "cities"])("rejects output-only %s corruption", async field => {
    const {plan, fetched} = await collect(); const forged = structuredClone(fetched) as any;
    forged.payload.jobs[0][field] = field === "cities" ? ["北京"] : field === "officialUrl" ? "https://hspharm.zhiye.com/social/detail?jobAdId=other" : "北京";
    expect((await runSourceCrawl(plan, {fetch: async () => forged})).truth.completenessVerified).toBe(false);
  });
  it.each(["Count", "Code", "PostDate", "bodyRepresentation", "capturedAt", "finalUrl", "httpStatus", "contentType"])("rejects raw/metadata tampering %s even after page rehash", async field => {
    const {plan, fetched} = await collect(); const forged = structuredClone(fetched) as any; const artifact = forged.fetchEvidence.artifacts[0];
    const data = JSON.parse(artifact.body);
    if (field === "Count") data.Count = 2;
    else if (field === "Code") data.Code = 500;
    else if (field === "PostDate") delete data.Data[0].PostDate;
    else if (field === "bodyRepresentation") artifact.bodyRepresentation = "REDACTED";
    else if (field === "capturedAt") artifact.capturedAt = "not-a-date";
    else if (field === "finalUrl") artifact.finalUrl = "https://other.zhiye.com/api/Jobad/GetJobAdPageList";
    else if (field === "httpStatus") artifact.httpStatus = 302;
    else artifact.contentType = "text/html";
    artifact.body = JSON.stringify(data);
    // Invalid schema values must fail closed at the normal parser too.
    try { rehash(forged); } catch { /* preserve malformed evidence for gate */ }
    expect((await runSourceCrawl(plan, {fetch: async () => forged})).truth.completenessVerified).toBe(false);
  });
});
