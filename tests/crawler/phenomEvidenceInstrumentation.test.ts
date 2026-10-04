import { createCipheriv } from "node:crypto";
import { createMokaSourceFetch } from "../../src/crawler/mokaSourceFetch";
import { organonBootstrap, organonRow } from "../fixtures/organonChinaQuality";
import { lillyBootstrap, syntheticLillyRow, syntheticLillyNativeDetailBody } from "../helpers/lillyPhenom";
import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { OfficialHttpTimeoutError } from "../../src/crawler/officialHttpRuntimeLimits";
import {
  createSourceFetchAttemptTracker,
  runSourceCrawl
} from "../../src/crawler/runSourceCrawl";
import { createSourceFetchRouter } from "../../src/crawler/sourceFetchRouter";
import { evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import {
  canonicalStringSetSha256,
  sha256Bytes
} from "../../src/crawler/sourceFetchEvidence";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  sourcePlanConfigSha256,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";

const capturedAt = "2026-07-11T00:00:00.000Z";
const entryUrl = "https://careers.example.test/cn/zh/search-results?keywords=China";
const widgetUrl = "https://careers.example.test/widgets";
const refNum = "REFNUM-SHOULD-STAY-OPAQUE";
const gskWidgetUrl = "https://jobs.gsk.com/widgets";
const GENERIC_LOCATION_PHENOM_SOURCES = [
  "source-lilly-china-social",
  "source-organon-china-social",
  "source-ucb-china-social",
  "source-merck-china-social"
] as const;
const GENERIC_LOCATION_VALUES = [
  "Remote",
  "Multiple Locations",
  "Various Locations",
  "Global",
  "Hybrid"
] as const;

const plan = {
  adapterId: "official-json",
  company: { id: "company-phenom", officialChineseName: "Phenom 测试公司" },
  source: {
    id: "source-phenom-social",
    companyId: "company-phenom",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: entryUrl,
    officialChainEvidenceUrl: "https://careers.example.test/cn/zh/search-results"
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    }
  },
  officialJsonFetch: {
    kind: "phenom",
    detailBaseUrl: "https://careers.example.test/cn/zh/job",
    countryFilter: "China",
    pageSize: 1,
    maxPages: 5
  }
} satisfies SourceCrawlPlan;

function entryHtml(overrides = ""): string {
  return `<script>var phApp={"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":"page18"${overrides}};</script>`;
}

/** Historical offline Phenom contract. Current GSK production uses the native Moka source. */
function gskPlan(): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  const current = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-gsk-china-social");
  if (current?.adapterId !== "official-json" || !current.moka) throw new Error("Expected current GSK Moka plan");
  const historical = structuredClone(current);
  delete historical.moka;
  delete historical.transientRetryPolicy;
  historical.source.atsKind = "OFFICIAL_JSON";
  historical.source.officialEntryUrl = "https://jobs.gsk.com/cn/zh/search-results?keywords=China";
  historical.source.officialChainEvidenceUrl = "https://www.gsk-china.com/zh-cn/careers/";
  historical.json = { jobsPath: "jobs", fields: { sourceJobId: "sourceJobId", officialTitle: "title",
    officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" }, defaultCategory: "其他" };
  historical.officialJsonFetch = { kind: "phenom", detailBaseUrl: "https://jobs.gsk.com/gb/en/job",
    derivedDetailIdField: "jobSeqNo", mixedLocationScopePolicy: "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1",
    countryFilter: "China", allowedApplyOrigins: ["https://gsk.wd5.myworkdayjobs.com"],
    allowedEntryRedirect: { origin: "https://jobs.gsk.com", pathname: "/gb/en" }, pageSize: 50, maxPages: 3 };
  return historical;
}

function gskEntryHtml(): string {
  return `<script type="application/json">${JSON.stringify({
    phApp: {
      widgetApiEndpoint: gskWidgetUrl,
      country: "cn",
      deviceType: "desktop",
      locale: "zh_cn",
      refNum,
      pageName: "search-results",
      pageId: "page18"
    }
  })}</script>`;
}

function gskJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return job("GSK-MULTI-CN", {
    country: "Singapore",
    location: "Singapore",
    city: "Singapore",
    multi_location: ["Singapore", "Shanghai, China"],
    applyUrl: "https://jobs.gsk.com/cn/zh/job/GSK-MULTI-CN",
    ...overrides
  });
}

async function fetchExactGsk(rawJob: Record<string, unknown>) {
  return fetchExactGskJobs([rawJob]);
}

async function fetchExactGskJobs(rawJobs: Array<Record<string, unknown>>) {
  const stagedPlan = gskPlan();
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(capturedAt),
    http: async (request) => request.method === "POST"
      ? response(facetPageBody(rawJobs, rawJobs.length, 0, []), gskWidgetUrl, "application/json")
      : response(gskEntryHtml(), stagedPlan.source.officialEntryUrl, "text/html")
  });
  return { stagedPlan, fetched: await fetcher(stagedPlan) };
}

async function fetchCurrentGskNative(hydrate = false) {
  const stagedPlan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-gsk-china-social")!;
  const iv = "de7c21ed8d6f50fe", key = "6e9ecb8e9c6c1a5e";
  const fetch = createMokaSourceFetch({ now: () => new Date(capturedAt), http: async request => {
    let body: string;
    if (request.method === "GET") {
      const init = { org: { id: "gsk" }, siteId: "148067", mode: "social", aesIv: iv,
        jobCustomFields: [{ id: 273744, name: "Req status", type: "select_info", detail: ["Open", "Frozen", "Filled", "Close"] }] };
      body = `<input id="init-data" value="${JSON.stringify(init).replaceAll('"', '&quot;')}">`;
    } else if (request.url === "https://app.mokahr.com/api/outer/ats-apply/website/job") {
      body = JSON.stringify({ id: "synthetic-gsk-open-1", orgId: "gsk", locations: [{ country: "中国", cityName: "上海" }] });
    } else {
      expect((request.body as Record<string, unknown>).customFields).toEqual({ "273744": { values: ["Open"] } });
      const cipher = createCipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(iv));
      const value = { success: true, data: { jobStats: { total: 1 }, offset: 0, jobs: [{ id: "synthetic-gsk-open-1",
        title: "Synthetic medical role", status: "open", locations: hydrate ? [] : [{ country: "中国", cityName: "上海" }] }] } };
      body = JSON.stringify({ necromancer: key, data: cipher.update(JSON.stringify(value), "utf8", "base64") + cipher.final("base64") });
    }
    return { status: 200, body, finalUrl: request.url.replace(/#.*$/, ""),
      contentType: request.method === "GET" ? "text/html" : "application/json", capturedAt };
  } });
  return { stagedPlan, fetched: await fetch(stagedPlan) };
}

function liveShapedGskJobs(): Array<Record<string, unknown>> {
  return [
    gskJob({
      jobSeqNo: "GHVGPAGB444750EXTERNALENGB",
      jobId: "444750",
      reqId: "Job Code: J003698",
      location: "Collegeville, Pennsylvania, United States of America",
      city: "Collegeville",
      country: "United States of America",
      multi_location: [
        "Collegeville, Pennsylvania, United States of America",
        "PuDong New District, Shanghai, China",
        "Philadelphia, Pennsylvania, United States of America",
        "Singapore"
      ],
      applyUrl: ""
    }),
    gskJob({
      jobSeqNo: "GSK-SINGAPORE-WITH-SHANGHAI",
      reqId: "Job Code: GSK-SG-1",
      location: "Singapore",
      city: "Singapore",
      country: "Singapore",
      multi_location: ["Singapore", "Shanghai, China"],
      applyUrl: "https://gsk.wd5.myworkdayjobs.com/en-US/GSKCareers/job/GSK-SG-1"
    }),
    gskJob({
      jobSeqNo: "GSK-SHANGHAI-PRIMARY",
      reqId: "Job Code: GSK-CN-1",
      location: "Shanghai, China",
      city: "Shanghai",
      country: "China",
      multi_location: ["Shanghai, China"],
      applyUrl: "https://gsk.wd5.myworkdayjobs.com/en-US/GSKCareers/job/GSK-CN-1"
    })
  ];
}

function exactPhenomPlan(sourceId: string): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  const staged = buildStagedSourceCrawlPlans(candidateCompanies);
  const value = getPlanBySourceId(staged, sourceId);
  if (value?.adapterId !== "official-json" || value.officialJsonFetch?.kind !== "phenom") {
    throw new Error(`Expected exact staged Phenom plan ${sourceId}`);
  }
  return value;
}

function rochePlan(): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  return exactPhenomPlan("source-roche-china-social");
}

function merckEntryHtml(): string {
  return `<script>var phApp={"widgetApiEndpoint":"https://careers.emdgroup.com/widgets","country":"us","deviceType":"desktop","locale":"en_us","refNum":"MQAEGZUS","pageName":"search-results","pageId":"page18"};</script><script>phApp.pageId = "page18-ds";</script>`;
}

function bindMerckUiSelections(
  body: string,
  selected: Record<string, string[]>
): string {
  const root = JSON.parse(body) as {
    refineSearch: { data: Record<string, unknown> };
  };
  if (Object.keys(selected).length > 0) root.refineSearch.data.ui_selections = selected;
  return JSON.stringify(root);
}

function rocheEntryHtml(): string {
  return `<script>var phApp={"widgetApiEndpoint":"https://careers.roche.com/widgets","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"ROCHGLOBAL","pageName":"search-results","pageId":"page11"};</script><script>phApp.pageId = "page11-ds";</script>`;
}

function rocheJob(id: string): Record<string, unknown> {
  const reqId = `202609-${parseInt(sha256Bytes(Buffer.from(id)).sha256.slice(0, 6), 16)}`;
  return {jobSeqNo: `ROCHGLOBAL${reqId.replace("-", "")}EXTERNALZHCN`, reqId, jobId:reqId,
    title: `Roche role ${id}`, location:"上海, 中国大陆", city:"上海", country:"中国大陆", category:"销售 & 市场",
    multi_location:["上海, 中国大陆"], postedDate:"2026-07-01T00:00:00.000+0000", siteType:"external", visibilityType:"External",
    jobVisibility:["external"], locale:"zh_cn", applyUrl:`https://roche.wd3.myworkdayjobs.com/roche-ext/job/Shanghai/Role_${reqId}/apply`};
}
function rocheDetailBody(raw: Record<string,unknown>): string {
  return JSON.stringify({jobPostingInfo:{title:raw.title,jobReqId:raw.reqId,jobPostingId:`Role_${raw.reqId}`,jobPostingSiteId:"roche-ext",
    externalUrl:(raw.applyUrl as string).replace(/\/apply$/, ""),location:"Shanghai",country:{descriptor:"China"},posted:true,canApply:true,
    startDate:"2026-07-01",jobDescription:"Responsible for official recruitment activities."}});
}

function facetPageBodyWithoutFrom(
  jobs: unknown[],
  totalHits: number,
  aggregations: Array<{ field: string; value: Record<string, unknown> }> = []
): string {
  return JSON.stringify({ refineSearch: { totalHits, data: { jobs, aggregations } } });
}

type RocheNetworkFailureStage = "ENTRY" | "FACET_GLOBAL" | "FACET_COUNTRY" | "PAGE";
type RocheNetworkFailureMode = "TIMEOUT" | "HTTP_503" | "HTTP_403";

async function fetchRocheWithNetworkFailure(
  failureStage: RocheNetworkFailureStage,
  failureMode: RocheNetworkFailureMode
) {
  const stagedPlan = rochePlan();
  const professional = rocheJob("ROCHE-PROFESSIONAL");
  const internship = rocheJob("ROCHE-INTERNSHIP");
  internship.category = "实习 & 发展项目";
  const bodies = [
    facetPageBody([], 3, 0, [{ field: "country", value: { 中国大陆: 2, 瑞士: 1 } }]),
    facetPageBody([professional, internship], 2, 0, [{
      field: "category",
      value: { "销售 & 市场": 1, "实习 & 发展项目": 1 }
    }]),
    facetPageBodyWithoutFrom([professional], 1)
  ];
  const postStages: RocheNetworkFailureStage[] = ["FACET_GLOBAL", "FACET_COUNTRY", "PAGE"];
  let postIndex = 0;
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(capturedAt),
    http: async (request) => {
      const stage = request.method === "POST" ? postStages[postIndex]! : "ENTRY";
      if (stage === failureStage) {
        if (failureMode === "TIMEOUT") throw new OfficialHttpTimeoutError();
        return response("{}", request.url, request.method === "POST" ? "application/json" : "text/html", {
          status: failureMode === "HTTP_503" ? 503 : 403
        });
      }
      if (request.method !== "POST") {
        return response(rocheEntryHtml(), stagedPlan.source.officialEntryUrl, "text/html");
      }
      const body = bodies[postIndex];
      postIndex += 1;
      if (body === undefined) throw new Error("fixture omitted a Roche response");
      return response(body, "https://careers.roche.com/widgets", "application/json");
    }
  });
  return fetcher(stagedPlan);
}

function exactPhenomEntryHtml(widgetEndpoint: string): string {
  return `<script type="application/json">${JSON.stringify({
    phApp: {
      widgetApiEndpoint: widgetEndpoint,
      country: "cn",
      deviceType: "desktop",
      locale: "zh_cn",
      refNum,
      pageName: "search-results",
      pageId: "page18"
    }
  })}</script>`;
}

function exactPhenomBodies(
  stagedPlan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  rawJob: Record<string, unknown>
): string[] {
  const config = stagedPlan.officialJsonFetch;
  if (config?.kind !== "phenom") throw new Error("Expected exact Phenom config");
  if (stagedPlan.source.id === "source-lilly-china-social") return [JSON.stringify({refineSearch: {status: 200, hits: 1, totalHits: 1, data: {jobs: [rawJob], aggregations: [], ui_selections: {country: ["China"]}}}})];
  if (!config.facetScope) return [facetPageBody([rawJob], 1, 0, [])];

  if (stagedPlan.source.id === "source-merck-china-social") {
    const formalJob = { ...rawJob };
    return [
      facetPageBody([], 1, 0, [{ field: "country", value: { China: 1 } }]),
      facetPageBody([], 1, 0, [{ field: "businessSector", value: { Healthcare: 1 } }]),
      facetPageBody([formalJob], 1, 0, [{ field: "jobLevelId", value: { Professional: 1 } }]),
      facetPageBody([formalJob], 1, 0, []),
      facetPageBody([formalJob], 1, 0, [])
    ];
  }

  const facet = config.facetScope;
  const modern = "exclusionFacet" in facet && facet.exclusionFacet !== undefined;
  const exclusionField = modern ? facet.exclusionFacet.field : "category";
  const excluded = modern ? facet.exclusionFacet.descriptors : facet.categoryExcludeDescriptors;
  const allowed = "Professional";
  const excludedCounts = Object.fromEntries(excluded.map((descriptor) => [descriptor, 1]));
  const excludedZeroes = Object.fromEntries(excluded.map((descriptor) => [descriptor, 0]));
  const globalTotal = 1 + excluded.length;
  const country = facet.countryIncludeDescriptor;
  const formalJob = { ...rawJob, [exclusionField]: allowed };
  return [
    facetPageBody([], globalTotal, 0, [
      { field: "country", value: { [country]: 1, Belgium: excluded.length } },
      ...(modern ? [{ field: exclusionField, value: { [allowed]: 1, ...excludedCounts } }] : [])
    ]),
    facetPageBody([], 1, 0, [
      { field: exclusionField, value: { [allowed]: 1, ...excludedZeroes } }
    ]),
    facetPageBody([formalJob], 1, 0, [])
  ];
}

async function fetchExactPhenomLocation(sourceId: string, location: string) {
  const stagedPlan = exactPhenomPlan(sourceId);
  const config = stagedPlan.officialJsonFetch;
  if (config?.kind !== "phenom") throw new Error("Expected exact Phenom config");
  const country = config.facetScope?.countryIncludeDescriptor ?? config.countryFilter ?? "China";
  const widgetEndpoint = new URL("/widgets", stagedPlan.source.officialEntryUrl).toString();
  const rawJob = {
    jobSeqNo: `GENERIC-${sourceId}-${location.replace(/[^A-Za-z0-9._-]+/gu, "-")}`,
    ...(sourceId === "source-ucb-china-social" ? { postedDate: "2026-07-01T05:54:14.000+0000" } : {}),
    title: `Medical role ${location}`,
    location,
    city: sourceId === "source-ucb-china-social" ? location.split(",")[0]!.trim() : location,
    country,
    applyUrl: `${config.detailBaseUrl.replace(/\/$/u, "")}/generic-location`
  };
  if (sourceId === "source-merck-china-social") Object.assign(rawJob, {
    title: "Medical role", jobVisibility: ["external", "internal"], visibilityType: "External", siteType: "external", externalApply: false,
    jobSeqNo: "MQAEGZUS304084EXTERNALENUS", reqId: "304084", jobId: "304084", applyUrl: "",
    postedDate: "2026-09-29T12:05:11.334+0000", city: location.split(",")[0]!.trim(), state: "Shanghai",
    cityState: "Shanghai, Shanghai", cityStateCountry: location, latitude: "31.22222", longitude: "121.45806",
    multi_location: [location], isMultiLocation: false,
    multi_location_array: [{location, latlong: {lat:31.22222,lon:121.45806}}]
  });
  if (sourceId === "source-organon-china-social") Object.assign(rawJob, organonRow(1,"Shanghai",{location,city:location.split(",")[0]!.trim()}));
  if (sourceId === "source-lilly-china-social") Object.assign(rawJob, syntheticLillyRow(), {location, city: location.split(",")[0]!.trim()});
  const bodies = exactPhenomBodies(stagedPlan, rawJob);
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(capturedAt),
    http: async (request) => {
      if (request.method === "POST") {
        let body = bodies.shift()!;
        if (sourceId === "source-merck-china-social") {
          const selected = (JSON.parse(request.body ?? "{}") as {
            selected_fields?: Record<string, string[]>;
          }).selected_fields ?? {};
          body = bindMerckUiSelections(body, selected);
        }
        return response(body, widgetEndpoint, "application/json");
      }
      if (sourceId === "source-lilly-china-social" && request.url === rawJob.applyUrl) {
        return response(syntheticLillyNativeDetailBody(rawJob), request.url, "text/html");
      }
      return response(sourceId === "source-roche-china-social" ? rocheEntryHtml() :
        sourceId === "source-merck-china-social" ? merckEntryHtml() :
        sourceId === "source-organon-china-social" ? `<script>var phApp=${JSON.stringify(organonBootstrap)};</script>` :
        sourceId === "source-lilly-china-social" ? `<script>var phApp=${JSON.stringify(lillyBootstrap)};</script>` :
        sourceId === "source-ucb-china-social" ? `<script>var phApp=${JSON.stringify({
          widgetApiEndpoint: widgetEndpoint, country: "global", deviceType: "desktop", locale: "zh_global",
          refNum: "UCB1GLOBAL", pageName: "search-results", pageId: "page17"
        })};</script>` : exactPhenomEntryHtml(widgetEndpoint),
        stagedPlan.source.officialEntryUrl, "text/html");
    }
  });
  return { stagedPlan, fetched: await fetcher(stagedPlan) };
}

function response(
  body: string,
  url: string,
  contentType: string,
  overrides: Partial<OfficialJsonHttpResponse> = {}
): OfficialJsonHttpResponse {
  return { status: 200, body, finalUrl: url, contentType, capturedAt, ...overrides };
}

function job(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobSeqNo: id,
    title: `Medical role ${id}`,
    location: "Shanghai, China",
    city: "Shanghai",
    country: "China",
    applyUrl: `https://careers.example.test/cn/zh/job/${id}`,
    ...overrides
  };
}

function pageBody(jobs: unknown[], totalHits?: unknown, from?: unknown): string {
  return JSON.stringify({
    refineSearch: {
      ...(totalHits === undefined ? {} : { totalHits }),
      ...(from === undefined ? {} : { from }),
      data: { jobs }
    }
  });
}

function facetPageBody(
  jobs: unknown[],
  totalHits: number,
  from: number,
  aggregations: Array<{ field: string; value: Record<string, unknown> }>
): string {
  return JSON.stringify({
    refineSearch: { totalHits, from, data: { jobs, aggregations } }
  });
}

function withoutOpaqueBodies(value: unknown): string {
  const clone = structuredClone(value) as { fetchEvidence?: { artifacts?: Array<Record<string, unknown>> } };
  for (const artifact of clone.fetchEvidence?.artifacts ?? []) artifact.body = "[OPAQUE]";
  return JSON.stringify(clone);
}

describe("Phenom evidence instrumentation", () => {
  it("keeps current GSK routing bound to native Moka instead of the historical Phenom fixture", () => {
    const current = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-gsk-china-social");
    expect(current).toMatchObject({ adapterId: "official-json", source: { atsKind: "MOKA" },
      moka: { expectedOrgId: "gsk", expectedSiteId: "148067", requisitionStatusPolicy: "GSK_NATIVE_OPEN_REQUISITIONS_V1" } });
    expect(current && "officialJsonFetch" in current ? current.officialJsonFetch : undefined).toBeUndefined();
  });

  it("safely accepts the Roche static phApp fallback object with one separate literal pageId assignment", async () => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results"};
      phApp.pageId = "page11";
    </script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });

    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it("accepts the single audited -ds pageId refinement and uses it in the widget request", async () => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":"page11"};
    </script><script>phApp.pageId = "page11-ds";</script>`;
    const requestBodies: string[] = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? (requestBodies.push(request.body ?? ""), response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json"))
        : response(body, entryUrl, "text/html")
    });

    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(requestBodies[0] ?? "{}")).toMatchObject({ pageId: "page11-ds" });
  });

  it("accepts one standalone literal pageId only when it matches the complete bootstrap", async () => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":"page11"};
    </script><script>phApp.pageId = "page11";</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["computed", `phApp["pageId"] = "page11";`],
    ["dynamic", `phApp.pageId = makePageId();`],
    ["multiple", `phApp.pageId = "page11"; phApp.pageId = "page11";`],
    ["arbitrary suffix", `phApp.pageId = "page11-extra";`],
    ["different base", `phApp.pageId = "page12-ds";`],
    ["repeated refinement", `phApp.pageId = "page11-ds-ds";`]
  ])("rejects a %s pageId mutation after a complete bootstrap", async (_label, mutation) => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":"page11"};
    </script><script>${mutation}</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each([
    ["dynamic pageId", `phApp.pageId = makePageId();`],
    ["conflicting pageIds", `phApp.pageId = "page11"; phApp.pageId = "page12";`],
    ["computed pageId", `phApp["pageId"] = "page11";`]
  ])("rejects Roche-style config with %s", async (_label, pageIdSource) => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results"};
      ${pageIdSource}
    </script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it("proves a structured country/category facet scope before paginating the filtered jobs", async () => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        },
        pageSize: 2
      }
    } satisfies SourceCrawlPlan;
    const requests: Array<{ method?: string; body?: string }> = [];
    const bodies = [
      facetPageBody([], 10, 0, [{ field: "country", value: { 中国大陆: 4, 瑞士: 6 } }]),
      facetPageBody([job("SAMPLE", { country: "中国大陆", category: "销售 & 市场" })], 4, 0, [
        { field: "category", value: { "销售 & 市场": 2, "医学事务": 1, "实习 & 发展项目": 1 } }
      ]),
      facetPageBody([
        job("CN-1", { country: "中国大陆", category: "销售 & 市场" }),
        job("CN-2", { country: "中国大陆", category: "医学事务" })
      ], 3, 0, []),
      facetPageBody([
        job("CN-3", { country: "中国大陆", category: "销售 & 市场" })
      ], 3, 2, [])
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requests.push(request);
        return request.method === "POST"
          ? response(bodies.shift()!, widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html");
      }
    });

    const result = await fetcher(scopedPlan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 3, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: {
        artifacts: [
          { kind: "OFFICIAL_COMPANY_PAGE" },
          { kind: "ATS_API_RESPONSE" },
          { kind: "ATS_API_RESPONSE" },
          { kind: "PAGINATION_PAGE" },
          { kind: "PAGINATION_PAGE" }
        ],
        declaredCompleteness: { value: 3, scope: "SOURCE" },
        fetchCounts: { rawCount: 3, validCount: 3 }
      }
    });
    expect(requests.slice(1).map((request) => JSON.parse(request.body ?? "{}").selected_fields)).toEqual([
      {},
      { country: ["中国大陆"] },
      { country: ["中国大陆"], category: ["医学事务", "销售 & 市场"] },
      { country: ["中国大陆"], category: ["医学事务", "销售 & 市场"] }
    ]);
    if (!result.fetchEvidence) throw new Error("expected scoped evidence");
    const locators = result.fetchEvidence.artifacts.map((artifact) => artifact.extractorLocator);
    expect(locators.slice(1).every((locator) => locator.includes("selectedFields:sha256:"))).toBe(true);
    expect(new Set(locators.slice(1)).size).toBe(locators.length - 1);
    expect(locators.join("\n")).not.toContain("requestCountry");
  });

  it("proves and applies a source-configured job-level partition instead of assuming category semantics", async () => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "China",
          exclusionFacet: {
            field: "jobLevelId",
            descriptors: ["A - Current Student"]
          }
        },
        pageSize: 2
      }
    } satisfies SourceCrawlPlan;
    const requests: Array<{ method?: string; body?: string }> = [];
    const bodies = [
      facetPageBody([], 10, 0, [
        { field: "country", value: { China: 3, Germany: 7 } },
        { field: "jobLevelId", value: {
          "A - Current Student": 1,
          "B - Recent University Graduate(<1 year of experience)": 2,
          "C - Professional": 7
        } }
      ]),
      facetPageBody([job("SAMPLE", { jobLevelId: "C - Professional" })], 3, 0, [
        { field: "jobLevelId", value: { "A - Current Student": 1, "C - Professional": 2 } }
      ]),
      facetPageBody([
        job("CN-1", { jobLevelId: "C - Professional" }),
        job("CN-2", { jobLevelId: "C - Professional" })
      ], 2, 0, [])
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requests.push(request);
        return request.method === "POST"
          ? response(bodies.shift()!, widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html");
      }
    });

    const result = await fetcher(scopedPlan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 2 },
      fetchEvidence: { fetchCounts: { rawCount: 2, validCount: 2 } }
    });
    expect(requests.slice(1).map((request) => JSON.parse(request.body ?? "{}").selected_fields)).toEqual([
      {},
      { country: ["China"] },
      { country: ["China"], jobLevelId: ["C - Professional"] }
    ]);
  });

  it("derives a same-origin public detail URL from reqId when Phenom omits applyUrl", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("SEQ-301040", { reqId: "301040", applyUrl: "" })], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      payload: { jobs: [{ officialUrl: "https://careers.example.test/cn/zh/job/301040" }] },
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1 } }
    });
  });

  it("uses jobSeqNo for a derived Phenom detail URL only when the source profile opts in", async () => {
    const rawJob = job("GHVGPAGB444750EXTERNALENGB", {
      reqId: "Job Code: J003698",
      applyUrl: ""
    });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([rawJob], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const selectedJobSeqNoPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        derivedDetailIdField: "jobSeqNo"
      }
    } satisfies SourceCrawlPlan;

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ stage: "VALIDATION", details: { code: "UNSAFE_OFFICIAL_URL" } }]
      }
    });
    await expect(fetcher(selectedJobSeqNoPlan)).resolves.toMatchObject({
      ok: true,
      payload: {
        jobs: [{
          officialUrl: "https://careers.example.test/cn/zh/job/GHVGPAGB444750EXTERNALENGB"
        }]
      },
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1, validationDiscardCount: 0 } }
    });
  });

  it("accepts an excluded descriptor absent from the country partition only after global descriptor proof", async () => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "China",
          exclusionFacet: {
            field: "category",
            descriptors: ["Internships & Junior Positions"]
          }
        }
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 4, 0, [
        { field: "country", value: { China: 1, Belgium: 3 } },
        { field: "category", value: { Professional: 3, "Internships & Junior Positions": 1 } }
      ]),
      facetPageBody([job("SAMPLE", { category: "Professional" })], 1, 0, [
        { field: "category", value: { Professional: 1 } }
      ]),
      facetPageBody([job("CN-1", { category: "Professional" })], 1, 0, [])
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 1 },
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1 } }
    });
  });

  it("accepts an omitted offset only for an opt-in dynamically proven single-page facet result", async () => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "China",
          exclusionFacet: { field: "category", descriptors: ["Internships"] }
        },
        allowOmittedOffsetForSinglePage: true,
        pageSize: 50
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 4, 0, [
        { field: "country", value: { China: 1, Belgium: 3 } },
        { field: "category", value: { Professional: 3, Internships: 1 } }
      ]),
      facetPageBody([job("SAMPLE", { category: "Professional" })], 1, 0, [
        { field: "category", value: { Professional: 1 } }
      ]),
      JSON.stringify({ refineSearch: {
        totalHits: 1,
        data: { jobs: [job("CN-1", { category: "Professional" })] }
      } })
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 1, pagesVisited: 1 },
      fetchEvidence: { pages: [{ requestedOffset: 0, returnedOffset: 0, termination: "NEXT_ABSENT" }] }
    });
  });

  it.each(["ENTRY", "FACET_GLOBAL", "FACET_COUNTRY", "PAGE"] as const)(
    "exposes a bounded retry signal when Roche %s times out",
    async (stage) => {
      const fetched = await fetchRocheWithNetworkFailure(stage, "TIMEOUT");
      expect(fetched).toMatchObject({
        ok: false,
        failureReason: "Official recruitment request timed out",
        transportFailure: { code: "OFFICIAL_HTTP_TIMEOUT", retryable: true, stage }
      });
      if (stage !== "ENTRY") {
        expect(fetched.fetchEvidence).toMatchObject({
          pages: [],
          supportingArtifactOnlyFailure: { code: `PHENOM_${stage}_FAILED` }
        });
      }
    }
  );

  it.each(["ENTRY", "FACET_GLOBAL", "FACET_COUNTRY", "PAGE"] as const)(
    "exposes a bounded retry signal when Roche %s returns HTTP 503",
    async (stage) => {
      const fetched = await fetchRocheWithNetworkFailure(stage, "HTTP_503");
      expect(fetched).toMatchObject({
        ok: false,
        failureReason: "Official recruitment endpoint was temporarily unavailable (HTTP 503)",
        transportFailure: { code: "OFFICIAL_HTTP_503", retryable: true, stage },
        fetchEvidence: { artifacts: expect.arrayContaining([expect.objectContaining({ httpStatus: 503 })]) }
      });
      if (stage === "FACET_GLOBAL" || stage === "FACET_COUNTRY") {
        expect(fetched.fetchEvidence).toMatchObject({
          pages: [],
          supportingArtifactOnlyFailure: { code: `PHENOM_${stage}_FAILED` }
        });
      }
    }
  );

  it.each(["ENTRY", "FACET_GLOBAL", "FACET_COUNTRY", "PAGE"] as const)(
    "does not retry a non-temporary Roche %s HTTP 403",
    async (stage) => {
      const fetched = await fetchRocheWithNetworkFailure(stage, "HTTP_403");
      expect(fetched).toMatchObject({ ok: false });
      expect(fetched).not.toHaveProperty("transportFailure");
      if (stage === "FACET_GLOBAL" || stage === "FACET_COUNTRY") {
        expect(fetched.fetchEvidence).toMatchObject({
          pages: [],
          supportingArtifactOnlyFailure: { code: `PHENOM_${stage}_FAILED` },
          artifacts: expect.arrayContaining([expect.objectContaining({ httpStatus: 403 })])
        });
      }
    }
  );

  it("does not grant Roche request-bound omitted offsets to another Phenom source", async () => {
    const lilly = exactPhenomPlan("source-lilly-china-social");
    if (lilly.officialJsonFetch?.kind !== "phenom") throw new Error("Expected Lilly Phenom plan");
    const forged = {
      ...lilly,
      officialJsonFetch: {
        ...lilly.officialJsonFetch,
        requestBoundOmittedOffsetPolicy: "ROCHE_REQUEST_BOUND_OMITTED_OFFSET_V1",
        pageSize: 100
      }
    } as SourceCrawlPlan;
    const bodies = [facetPageBodyWithoutFrom([job("CN-1")], 1)];
    const fetched = await createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, new URL("/widgets", forged.source.officialEntryUrl).toString(), "application/json")
        : response(entryHtml().replaceAll(widgetUrl, new URL("/widgets", forged.source.officialEntryUrl).toString()),
          forged.source.officialEntryUrl, "text/html")
    })(forged);
    expect(fetched).toMatchObject({ ok: false });
  });

  it("accepts only an exact configured same-origin entry redirect and archives the observed final URL", async () => {
    const gskWidgetUrl = "https://jobs.gsk.com/widgets";
    const redirectedPlan = {
      ...plan,
      source: {
        ...plan.source,
        officialEntryUrl: "https://jobs.gsk.com/cn/zh/search-results?keywords=China"
      },
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        detailBaseUrl: "https://jobs.gsk.com/cn/zh/job",
        countryFilter: "China",
        allowedEntryRedirect: { origin: "https://jobs.gsk.com", pathname: "/gb/en" }
      }
    } satisfies SourceCrawlPlan;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(facetPageBody([], 0, 0, []), gskWidgetUrl, "application/json")
        : response(entryHtml().replaceAll(widgetUrl, gskWidgetUrl), "https://jobs.gsk.com/gb/en", "text/html")
    });

    const result = await fetcher(redirectedPlan);

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        artifacts: expect.arrayContaining([expect.objectContaining({
          logicalKey: "phenom-entry-0000",
          requestedUrl: expect.stringContaining("jobs.gsk.com/cn/zh/search-results"),
          finalUrl: "https://jobs.gsk.com/gb/en"
        })])
      }
    });

    const drifted = await createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(entryHtml().replaceAll(widgetUrl, gskWidgetUrl), "https://jobs.gsk.com/gb/en/search", "text/html")
    })(redirectedPlan);
    expect(drifted).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("final URL does not match")
    });
  });

  it.each([
    ["missing", { Professional: 4 }],
    ["renamed", { Professional: 3, "Internship Roles": 1 }]
  ])("fails closed when a globally proved exclusion descriptor is %s", async (_label, globalCategories) => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "China",
          exclusionFacet: { field: "category", descriptors: ["Internships"] }
        }
      }
    } satisfies SourceCrawlPlan;
    const bodies = [facetPageBody([], 4, 0, [
      { field: "country", value: { China: 1, Belgium: 3 } },
      { field: "category", value: globalCategories }
    ])];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom global exclusion facet is missing descriptors or is not a complete partition"
    });
  });

  it("fails closed when a modern country exclusion aggregation overlaps or miscounts its country total", async () => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "China",
          exclusionFacet: { field: "category", descriptors: ["Internships"] }
        }
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 4, 0, [
        { field: "country", value: { China: 2, Belgium: 2 } },
        { field: "category", value: { Professional: 3, Internships: 1 } }
      ]),
      facetPageBody([], 2, 0, [
        { field: "category", value: { Professional: 2, Internships: 1 } }
      ])
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom exclusion facet is not a complete mutually exclusive partition"
    });
  });

  it.each([
    ["raw count differs from the declared total", 50, 1, 0, false],
    ["declared total exceeds page size", 1, 2, 2, false],
    ["a later page omits from", 1, 2, 1, true]
  ])("does not apply the omitted-offset opt-in when %s", async (_label, pageSize, total, firstJobs, includeFirstPage) => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "China",
          exclusionFacet: { field: "category", descriptors: ["Internships"] }
        },
        allowOmittedOffsetForSinglePage: true,
        pageSize
      }
    } satisfies SourceCrawlPlan;
    const allowedJobs = Array.from({ length: total }, (_, index) =>
      job(`SAMPLE-${index}`, { category: "Professional" }));
    const bodies = [
      facetPageBody([], total + 1, 0, [
        { field: "country", value: { China: total, Belgium: 1 } },
        { field: "category", value: { Professional: total, Internships: 1 } }
      ]),
      facetPageBody(allowedJobs.slice(0, pageSize), total, 0, [
        { field: "category", value: { Professional: total } }
      ]),
      ...(includeFirstPage
        ? [facetPageBody(allowedJobs.slice(0, firstJobs), total, 0, [])]
        : []),
      JSON.stringify({ refineSearch: {
        totalHits: total,
        data: { jobs: allowedJobs.slice(includeFirstPage ? firstJobs : 0, includeFirstPage ? undefined : firstJobs) }
      } })
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom structured facet page requires own from"
    });
  });

  it.each([
    ["first page missing totalHits", 0, JSON.stringify({ refineSearch: { from: 0, data: { jobs: [] } } })],
    ["first page missing from", 0, JSON.stringify({ refineSearch: { totalHits: 2, data: { jobs: [] } } })],
    ["later page missing totalHits", 1, JSON.stringify({ refineSearch: { from: 1, data: { jobs: [] } } })],
    ["later page missing from", 1, JSON.stringify({ refineSearch: { totalHits: 2, data: { jobs: [] } } })]
  ])("fails structured scope immediately when %s", async (_label, failurePage, invalidBody) => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        },
        pageSize: 1
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 10, 0, [{ field: "country", value: { 中国大陆: 2, 瑞士: 8 } }]),
      facetPageBody([], 2, 0, [{
        field: "category", value: { "销售 & 市场": 2, "实习 & 发展项目": 0 }
      }]),
      ...(failurePage === 1
        ? [facetPageBody([job("CN-1", { country: "中国大陆", category: "销售 & 市场" })], 2, 0, [])]
        : []),
      invalidBody
    ];
    let postCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        if (request.method !== "POST") return response(entryHtml(), entryUrl, "text/html");
        postCount += 1;
        return response(bodies.shift()!, widgetUrl, "application/json");
      }
    });
    await expect(fetcher(scopedPlan)).resolves.toMatchObject({ ok: false });
    expect(postCount).toBe(3 + failurePage);
  });

  it("changes the formal evidence locator when the dynamically allowed category descriptor changes", async () => {
    const locatorFor = async (allowedCategory: string): Promise<string> => {
      const bodies = [
        facetPageBody([], 2, 0, [{ field: "country", value: { 中国大陆: 1, 瑞士: 1 } }]),
        facetPageBody([], 1, 0, [{
          field: "category", value: { [allowedCategory]: 1, "实习 & 发展项目": 0 }
        }]),
        facetPageBody([job("CN-1", { country: "中国大陆", category: allowedCategory })], 1, 0, [])
      ];
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async (request) => request.method === "POST"
          ? response(bodies.shift()!, widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html")
      });
      const result = await fetcher({
        ...plan,
        officialJsonFetch: {
          ...plan.officialJsonFetch,
          facetScope: {
            countryIncludeDescriptor: "中国大陆",
            categoryExcludeDescriptors: ["实习 & 发展项目"]
          }
        }
      });
      if (!result.ok || !result.fetchEvidence) throw new Error("expected scoped Phenom evidence");
      return result.fetchEvidence.artifacts.at(-1)!.extractorLocator;
    };

    await expect(locatorFor("销售 & 市场")).resolves.not.toBe(await locatorFor("医学事务"));
  });

  it("accepts only an explicitly configured HTTPS apply origin endorsed by the Phenom payload", async () => {
    const externalApplyUrl = "https://ats.example.test/jobs/CN-1/apply";
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1", { applyUrl: externalApplyUrl })], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    const result = await fetcher({
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        allowedApplyOrigins: ["https://ats.example.test"]
      }
    });
    expect(result).toMatchObject({ ok: true, payload: { jobs: [{ officialUrl: externalApplyUrl }] } });
  });

  it.each([
    ["HTTP origin", "http://ats.example.test", "http://ats.example.test/jobs/CN-1"],
    ["evil subdomain", "https://ats.example.test", "https://evil.ats.example.test/jobs/CN-1"],
    ["configured origin with path", "https://ats.example.test/jobs", "https://ats.example.test/jobs/CN-1"],
    ["unconfigured external origin", undefined, "https://ats.example.test/jobs/CN-1"]
  ])("rejects %s for Phenom apply URLs", async (_label, configuredOrigin, applyUrl) => {
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requestCount += 1;
        return request.method === "POST"
          ? response(pageBody([job("CN-1", { applyUrl })], 1, 0), widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html");
      }
    });
    const officialJsonFetch = configuredOrigin === undefined
      ? plan.officialJsonFetch
      : { ...plan.officialJsonFetch, allowedApplyOrigins: [configuredOrigin] };
    const result = await fetcher({ ...plan, officialJsonFetch });
    if (_label === "evil subdomain" || _label === "unconfigured external origin") {
      expect(result).toMatchObject({ ok: true, payload: { jobs: [] } });
      expect(result.fetchEvidence?.fetchLosses).toMatchObject([{ details: { code: "UNSAFE_OFFICIAL_URL" } }]);
    } else {
      expect(result).toMatchObject({ ok: false, failureReason: "Phenom official URL configuration is invalid" });
      expect(requestCount).toBe(0);
    }
  });

  it.each([
    [
      "country total drift",
      facetPageBody([job("S", { country: "中国大陆", category: "销售 & 市场" })], 3, 0, [
        { field: "category", value: { "销售 & 市场": 2, "实习 & 发展项目": 1 } }
      ])
    ],
    [
      "out-of-country sample",
      facetPageBody([job("S", { country: "瑞士", category: "销售 & 市场" })], 4, 0, [
        { field: "category", value: { "销售 & 市场": 3, "实习 & 发展项目": 1 } }
      ])
    ],
    [
      "category partition drift",
      facetPageBody([job("S", { country: "中国大陆", category: "销售 & 市场" })], 4, 0, [
        { field: "category", value: { "销售 & 市场": 2, "实习 & 发展项目": 1 } }
      ])
    ]
  ])("fails closed when the country preflight has %s", async (_label, countryBody) => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        }
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 10, 0, [{ field: "country", value: { 中国大陆: 4, 瑞士: 6 } }]),
      countryBody
    ];
    let postCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        if (request.method !== "POST") return response(entryHtml(), entryUrl, "text/html");
        postCount += 1;
        return response(bodies.shift()!, widgetUrl, "application/json");
      }
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({ ok: false });
    expect(postCount).toBe(2);
  });

  it("fails closed when filtered totals or records prove the server ignored the category scope", async () => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        }
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 10, 0, [{ field: "country", value: { 中国大陆: 4, 瑞士: 6 } }]),
      facetPageBody([], 4, 0, [{
        field: "category", value: { "销售 & 市场": 3, "实习 & 发展项目": 1 }
      }]),
      facetPageBody([job("IGNORED", { country: "中国大陆", category: "实习 & 发展项目" })], 4, 0, [])
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({ ok: false });
  });

  it.each([
    ["country", { country: "瑞士", category: "销售 & 市场" }],
    ["category", { country: "中国大陆", category: "实习 & 发展项目" }]
  ])("fails the current formal page immediately on a structured %s record drift", async (_label, drift) => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        }
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 2, 0, [{ field: "country", value: { 中国大陆: 1, 瑞士: 1 } }]),
      facetPageBody([], 1, 0, [{
        field: "category", value: { "销售 & 市场": 1, "实习 & 发展项目": 0 }
      }]),
      facetPageBody([job("DRIFT", drift)], 1, 0, [])
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    const result = await fetcher(scopedPlan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "Phenom structured facet record drifted outside the requested scope",
      fetchEvidence: {
        artifacts: [{}, {}, {}, { kind: "PAGINATION_PAGE" }],
        pages: [{ sequence: 0, termination: "FAILED", declaredTotal: 1 }]
      }
    });
  });
  it("retains exact entry and page artifacts, strict offsets and total coordinates while staying manual", async () => {
    const requests: Array<{ method?: string; body?: string }> = [];
    const bodies = [pageBody([job("CN-1")], 2, 0), pageBody([job("CN-2")], 2, 1)];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requests.push(request);
        return request.method === "POST"
          ? response(bodies.shift()!, widgetUrl, "application/json; charset=utf-8")
          : response(entryHtml(), entryUrl, "text/html; charset=utf-8");
      }
    });

    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        pagesVisited: 2
      },
      fetchEvidence: {
        artifacts: [
          { kind: "OFFICIAL_COMPANY_PAGE", body: entryHtml() },
          { kind: "PAGINATION_PAGE" },
          { kind: "PAGINATION_PAGE" }
        ],
        pages: [
          { requestedOffset: 0, returnedOffset: 0, declaredTotal: 2, termination: "CONTINUE" },
          { requestedOffset: 1, returnedOffset: 1, declaredTotal: 2, termination: "NEXT_ABSENT" }
        ],
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 2, scope: "SOURCE" },
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    if (!result.ok || !result.fetchEvidence || !("payload" in result)) throw new Error("expected Phenom evidence");
    expect(result.fetchEvidence.declaredCompleteness?.extractorLocator).toContain("json:$.refineSearch.totalHits");
    expect(result.fetchEvidence.artifacts[1]?.extractorLocator).toBe(
      result.fetchEvidence.declaredCompleteness?.extractorLocator
    );
    expect(result.fetchEvidence.pages.flatMap((page) => page.rawJobIds)).toEqual([
      expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
    ]);
    expect((result.payload as { jobs: Array<{ sourceJobId: string }> }).jobs[0]?.sourceJobId)
      .toMatch(/^official-json:sha256:[0-9a-f]{64}$/);
    expect(withoutOpaqueBodies(result)).not.toContain(refNum);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({
      from: 0,
      size: 1,
      selected_fields: { country: ["China"] },
      global: true
    });
  });

  it("retains an available entry artifact on wrong MIME and never parses its config", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(entryHtml(), entryUrl, "application/json")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE", body: entryHtml() }],
        pages: [{ termination: "FAILED" }]
      }
    });
    expect(withoutOpaqueBodies(result)).not.toContain(refNum);
  });

  it("accounts non-object, unknown/US scope, duplicate ID and credential-bearing URL exactly", async () => {
    const rawJobs = [
      null,
      job("UNKNOWN", { country: "", location: "Remote", city: "" }),
      job("US", { country: "United States", location: "Boston, United States", city: "Boston" }),
      job("CONFLICT", { country: "United States", location: "Shanghai, China", city: "Shanghai" }),
      job("CN-1"),
      job("CN-1", { title: "duplicate" }),
      job("LEAK", { applyUrl: "https://careers.example.test/cn/zh/job/LEAK?access_token=raw-secret" })
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody(rawJobs, 7, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, pageSize: 10 } });
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: {
        fetchCounts: { rawCount: 7, parsedCount: 6, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 5 },
        fetchLosses: [
          { stage: "PARSE", details: { code: "NON_OBJECT_RECORD", pageSequence: 0, recordIndex: 0 } },
          { stage: "VALIDATION", details: { code: "OUT_OF_SCOPE", pageSequence: 0, recordIndex: 1 } },
          { stage: "VALIDATION", details: { code: "OUT_OF_SCOPE", pageSequence: 0, recordIndex: 2 } },
          { stage: "VALIDATION", details: { code: "OUT_OF_SCOPE", pageSequence: 0, recordIndex: 3 } },
          { stage: "VALIDATION", details: { code: "DUPLICATE_OFFICIAL_ID", pageSequence: 0, recordIndex: 5 } },
          { stage: "VALIDATION", details: { code: "UNSAFE_OFFICIAL_URL", pageSequence: 0, recordIndex: 6 } }
        ]
      }
    });
    expect(withoutOpaqueBodies(result)).not.toContain("raw-secret");
  });

  it("classifies a cross-page ID overlap as retryable pagination snapshot drift", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        if (request.method !== "POST") return response(entryHtml(), entryUrl, "text/html");
        const from = JSON.parse(request.body ?? "{}").from as number;
        return response(
          pageBody(from === 0 ? [job("STABLE-JOB"), job("MOVING-JOB")] : [job("MOVING-JOB")], 3, from),
          widgetUrl,
          "application/json"
        );
      }
    });

    await expect(fetcher({
      ...plan,
      officialJsonFetch: { ...plan.officialJsonFetch, pageSize: 2 }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom pagination evidence failed: RAW_ID_OVERLAP_ACROSS_PAGES",
      transportFailure: {
        code: "OFFICIAL_PAGINATION_SNAPSHOT_DRIFT",
        retryable: true,
        stage: "PAGE"
      }
    });
  });


  it.each([225, 251])("closes Roche's %i unique IDs with the native 250-row request", async (total) => {
    const stagedPlan = rochePlan();
    if (stagedPlan.officialJsonFetch?.kind !== "phenom") throw new Error("Expected the Roche Phenom configuration");
    expect(stagedPlan.officialJsonFetch.pageSize).toBe(250);
    const jobs = Array.from({ length: total }, (_, i) => rocheJob(`ROCHE-${i}`));
    const requestedSizes: number[] = [];
    let post = 0;
    const fetched = await createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        if (request.url.includes("/wday/cxs/")) {
          const raw=jobs.find(job=>request.url.endsWith((job.applyUrl as string).split("/job/")[1]!.replace(/\/apply$/, "")))!;
          return response(rocheDetailBody(raw),request.url,"application/json");
        }
        if (request.method !== "POST") return response(rocheEntryHtml(), stagedPlan.source.officialEntryUrl, "text/html");
        const body = JSON.parse(request.body!);
        requestedSizes.push(body.size);
        const result = post++ === 0
          ? facetPageBody([], total, 0, [{ field: "country", value: { 中国大陆: total } }])
          : post === 2 ? facetPageBody([jobs[0]], total, 0, [])
          : facetPageBodyWithoutFrom(jobs.slice(body.from, body.from + body.size), total);
        return response(result, "https://careers.roche.com/widgets", "application/json");
      }
    })(stagedPlan);
    expect(requestedSizes.slice(0, 2)).toEqual([100, 100]);
    expect(requestedSizes.slice(2).every(size => size === 250)).toBe(true);
    const result = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(result.truth).toMatchObject({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
    expect(result.jobs).toHaveLength(total);
    expect(result.fetchEvidence?.pages).toHaveLength(Math.ceil(total / 250));
    const evidence = result.fetchEvidence!;
    const artifact = evidence.artifacts.find(a => a.logicalKey === evidence.declaredCompleteness!.artifactLogicalKey)!;
    expect(issueAGradeOfficialTotalCertificate({
      binding: { releaseCandidateId: "rc-roche", batchId: "batch-roche", sourceResultId: "result-roche", sourceConfigSha256: sourcePlanConfigSha256(stagedPlan) },
      plan: stagedPlan, transportSuccess: result.truth.transportSuccess, adapterSuccess: result.truth.adapterSuccess,
      evidence, paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!, jobs: result.jobs,
      officialArtifactSha256: sha256Bytes(typeof artifact.body === "string" ? Buffer.from(artifact.body) : artifact.body).sha256
    })).toMatchObject({ status: "CERTIFIED", certificate: { counts: { officialTotal: total, finalUniqueJobCount: total } } });
  });
  it("rejects Roche completeness when a byte-identical page overlap hides an official ID", async () => {
    const stagedPlan=rochePlan();
    const jobs=Array.from({length:250},(_,i)=>rocheJob(`ROCHE-${i}`));
    const bodies=[facetPageBody([],251,0,[{field:"country",value:{中国大陆:251}}]),facetPageBody([jobs[0]],251,0,[]),
      facetPageBodyWithoutFrom(jobs,251),facetPageBodyWithoutFrom([jobs[249]],251)];
    let index=0;
    const fetched=await createOfficialJsonSourceFetch({now:()=>new Date(capturedAt),http:async request=>
      request.method==="POST"?response(bodies[index++]!,"https://careers.roche.com/widgets","application/json"):
      response(rocheEntryHtml(),stagedPlan.source.officialEntryUrl,"text/html")})(stagedPlan);
    expect(fetched).toMatchObject({ok:false,fetchEvidence:{fetchCounts:{rawCount:251,parsedCount:251,validCount:251}},
      failureReason:"Roche official identity set does not close its declared total"});
    expect((await runSourceCrawl(stagedPlan,{fetch:async()=>fetched})).truth.completenessVerified).toBe(false);
  });

  it("selects an explicit mainland alternative from official multi_location values", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("MULTI-CN", {
            country: "Singapore",
            location: "Singapore",
            city: "Singapore",
            multi_location: ["Singapore", "Shanghai, China"]
          })], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      payload: { jobs: [{ sourceJobId: expect.any(String), locationRaw: "Shanghai, China" }] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, validationDiscardCount: 0 }
      }
    });
  });

  it("certifies and builds the atomic bundle for the current native GSK Open source", async () => {
    const { stagedPlan, fetched } = await fetchCurrentGskNative();
    expect(fetched).toMatchObject({
      ok: true,
      payload: { data: { jobs: [{ locationRaw: "上海", cities: ["上海"] }] } }
    });
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { structuredJobCount: 1, completenessStatus: "VERIFIED" },
      jobs: [{ locationRaw: "上海", cities: ["上海"] }]
    });
    if (!fetched.fetchEvidence || !fetched.paginationEvaluation || !crawled.reconciliation) {
      throw new Error("Expected complete GSK certificate inputs");
    }
    const declaration = fetched.fetchEvidence.declaredCompleteness!;
    const officialArtifact = fetched.fetchEvidence.artifacts.find(
      (artifact) => artifact.logicalKey === declaration.artifactLogicalKey
    )!;
    const certificateDecision = issueAGradeOfficialTotalCertificate({
      binding: {
        releaseCandidateId: "rc-gsk-e2e",
        batchId: "batch-gsk-e2e",
        sourceResultId: "result-gsk-e2e",
        sourceConfigSha256: sourcePlanConfigSha256(stagedPlan)
      },
      plan: stagedPlan,
      transportSuccess: crawled.truth.transportSuccess,
      adapterSuccess: crawled.truth.adapterSuccess,
      evidence: fetched.fetchEvidence,
      paginationEvaluation: fetched.paginationEvaluation,
      reconciliation: crawled.reconciliation,
      jobs: crawled.jobs,
      officialArtifactSha256: sha256Bytes(
        typeof officialArtifact.body === "string"
          ? Buffer.from(officialArtifact.body, "utf8")
          : officialArtifact.body
      ).sha256
    });
    expect(certificateDecision).toMatchObject({
      status: "CERTIFIED",
      certificate: { grade: "A", counts: { officialTotal: 1, finalUniqueJobCount: 1 } }
    });
    const sourceId = stagedPlan.source.id;
    const identity = {
      releaseCandidateId: "rc-gsk-e2e",
      commitSha: "c".repeat(40),
      rosterSha256: "d".repeat(64),
      sourcePlanSha256: "e".repeat(64),
      sourceConfigSha256: "f".repeat(64),
      adapterBundleSha256: "1".repeat(64),
      batchKind: "SCHEDULED" as const,
      ownerId: "certificate-e2e",
      expectedPlannedSourceIds: [sourceId],
      expectedPlannedSourceSetSha256: canonicalStringSetSha256([sourceId]),
      expectedPlannedSourceCount: 1
    };
    const batchId = "batch-gsk-e2e";
    const pending = buildPendingRuntimeBatch(
      batchId,
      [stagedPlan],
      identity,
      new Date(capturedAt)
    ).sources[0]!;
    const artifacts = fetched.fetchEvidence.artifacts.map((artifact) => {
      const bytes = typeof artifact.body === "string"
        ? Buffer.from(artifact.body, "utf8")
        : Buffer.from(artifact.body);
      const digest = sha256Bytes(bytes);
      return {
        id: artifact.id,
        logicalKey: artifact.logicalKey,
        releaseCandidateId: identity.releaseCandidateId,
        batchId,
        sourceId,
        sourceResultId: pending.id,
        kind: artifact.kind,
        ...(artifact.requestedUrl ? { requestedUrl: artifact.requestedUrl } : {}),
        ...(artifact.finalUrl ? { finalUrl: artifact.finalUrl } : {}),
        ...(artifact.httpStatus ? { httpStatus: artifact.httpStatus } : {}),
        ...(artifact.contentType ? { contentType: artifact.contentType } : {}),
        capturedAt: new Date(artifact.capturedAt),
        sha256: digest.sha256,
        byteCount: digest.byteCount,
        path: `outputs/gsk/${artifact.id}`,
        extractorLocator: artifact.extractorLocator,
        captureToolName: fetched.fetchEvidence!.captureTool.name,
        captureToolVersion: fetched.fetchEvidence!.captureTool.version
      };
    });
    expect(buildAtomicRuntimeCommit({
      plan: stagedPlan,
      pending,
      identity,
      batchId,
      result: crawled,
      previousJobs: [],
      baselineCompletedBeforeCrawl: true,
      artifacts
    }).sourceResult).toMatchObject({
      completenessState: "VERIFIED",
      completenessCertificateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      completenessCertificate: { grade: "A", binding: { sourceResultId: pending.id } }
    });
  });

  it("issues the shared A-grade contract for another exact same-scope official-total source", async () => {
    const { stagedPlan, fetched } = await fetchExactPhenomLocation(
      "source-lilly-china-social",
      "Shanghai, Shanghai, China"
    );
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    if (!fetched.fetchEvidence || !fetched.paginationEvaluation || !crawled.reconciliation) {
      throw new Error("Expected complete Lilly certificate inputs");
    }
    const declaration = fetched.fetchEvidence.declaredCompleteness!;
    const officialArtifact = fetched.fetchEvidence.artifacts.find(
      (artifact) => artifact.logicalKey === declaration.artifactLogicalKey
    )!;
    expect(issueAGradeOfficialTotalCertificate({
      binding: {
        releaseCandidateId: "rc-lilly-e2e",
        batchId: "batch-lilly-e2e",
        sourceResultId: "result-lilly-e2e",
        sourceConfigSha256: sourcePlanConfigSha256(stagedPlan)
      },
      plan: stagedPlan,
      transportSuccess: crawled.truth.transportSuccess,
      adapterSuccess: crawled.truth.adapterSuccess,
      evidence: fetched.fetchEvidence,
      paginationEvaluation: fetched.paginationEvaluation,
      reconciliation: crawled.reconciliation,
      jobs: crawled.jobs,
      officialArtifactSha256: sha256Bytes(
        typeof officialArtifact.body === "string"
          ? Buffer.from(officialArtifact.body, "utf8")
          : officialArtifact.body
      ).sha256
    })).toMatchObject({
      status: "CERTIFIED",
      certificate: {
        schemaVersion: "a-grade-official-total-v2",
        scope: {
          companyId: "company-lilly-china",
          sourceId: "source-lilly-china-social",
          verificationPolicy: "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1"
        },
        counts: { officialTotal: 1, finalUniqueJobCount: 1 }
      }
    });
  });

  it("normalizes all three historically shaped GSK records including a derived public detail URL", async () => {
    const { stagedPlan, fetched } = await fetchExactGskJobs(liveShapedGskJobs());
    expect(fetched).toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            officialUrl: "https://jobs.gsk.com/gb/en/job/GHVGPAGB444750EXTERNALENGB",
            locationRaw: "PuDong New District, Shanghai, China",
            cities: ["上海"]
          },
          { locationRaw: "Shanghai, China", cities: ["上海"] },
          { locationRaw: "Shanghai, China", cities: ["上海"] }
        ]
      },
      fetchEvidence: {
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3, validationDiscardCount: 0 },
        fetchLosses: []
      }
    });
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: false },
      observation: { structuredJobCount: 3, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }
    });
  });

  it("rejects an unsafe jobSeqNo even when the exact source selects it for a derived URL", async () => {
    const { fetched } = await fetchExactGsk(gskJob({
      jobSeqNo: "GHVGPAGB444750EXTERNALENGB/../../unsafe",
      reqId: "Job Code: J003698",
      applyUrl: ""
    }));
    expect(fetched).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 }
      }
    });
  });

  it("normalizes historical GSK Phenom when the official multi_location includes Bengaluru and one mainland alternative", async () => {
    const { stagedPlan, fetched } = await fetchExactGsk(gskJob({
      location: "Singapore, Singapore",
      multi_location: ["Singapore, Singapore", "Bengaluru, India", "Shanghai, Shanghai, China"]
    }));
    expect(fetched).toMatchObject({
      ok: true,
      payload: { jobs: [{ locationRaw: "Shanghai, Shanghai, China", cities: ["上海"] }] }
    });
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: false },
      observation: { structuredJobCount: 1, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      jobs: [{ locationRaw: "Shanghai, Shanghai, China", cities: ["上海"] }]
    });
  });

  it("independently accepts one audited literal pageId refinement used by an exact staged Phenom source", async () => {
    const stagedPlan = exactPhenomPlan("source-lilly-china-social");
    const config = stagedPlan.officialJsonFetch;
    if (config?.kind !== "phenom") throw new Error("Expected exact Phenom config");
    const widgetEndpoint = new URL("/widgets", stagedPlan.source.officialEntryUrl).toString();
    const rawJob = syntheticLillyRow();
    const bodies = exactPhenomBodies(stagedPlan, rawJob);
    const entry = `<script>var phApp = phApp || ${JSON.stringify({...lillyBootstrap, pageId: "page11"})};</script><script>phApp.pageId = "page11-ds";</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => request.method === "POST"
        ? response(bodies.shift()!, widgetEndpoint, "application/json")
        : request.url === rawJob.applyUrl
          ? response(syntheticLillyNativeDetailBody(rawJob), request.url, "text/html")
          : response(entry, stagedPlan.source.officialEntryUrl, "text/html")
    });
    const fetched = await fetcher(stagedPlan);
    expect(fetched.ok).toBe(true);
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED" }
    });
  });

  it.each(GENERIC_LOCATION_PHENOM_SOURCES.flatMap((sourceId) =>
    GENERIC_LOCATION_VALUES.map((location) => [sourceId, location] as const)
  ))("rejects exact staged %s when the China record uses generic location %s", async (sourceId, location) => {
    const { stagedPlan, fetched } = await fetchExactPhenomLocation(sourceId, location);
    expect(fetched).toMatchObject({
      ok: false,
      fetchEvidence: {
        fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "OUT_OF_SCOPE" } }]
      }
    });
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(crawled.truth.completenessVerified).toBe(false);
    expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it.each(GENERIC_LOCATION_PHENOM_SOURCES.flatMap((sourceId) =>
    ["Wuxi", "Shenyang", "Qingdao"].map((city) => [sourceId, city] as const)
  ))("preserves source-specific review requirements for %s unknown China city %s", async (sourceId, city) => {
    const stagedPlan = exactPhenomPlan(sourceId);
    const config = stagedPlan.officialJsonFetch;
    if (config?.kind !== "phenom") throw new Error("Expected exact Phenom config");
    const country = config.facetScope?.countryIncludeDescriptor ?? config.countryFilter ?? "China";
    const location = `${city}, ${country}`;
    const { fetched } = await fetchExactPhenomLocation(sourceId, location);
    if (sourceId === "source-ucb-china-social" || sourceId === "source-merck-china-social" || sourceId === "source-organon-china-social" || sourceId === "source-lilly-china-social") {
      expect(fetched).toMatchObject({ok:false,fetchEvidence:{fetchLosses:[{details:{code:
        sourceId === "source-ucb-china-social" ? "UCB_CITY_LOCATION_INVALID" : sourceId === "source-organon-china-social" ? "ORGANON_RAW_FIELDS_INVALID" : sourceId === "source-lilly-china-social" ? "LILLY_RAW_FIELDS_INVALID" : "MERCK_RAW_FIELDS_INVALID"}}]}});
      expect((await runSourceCrawl(stagedPlan,{fetch:async()=>fetched})).truth.completenessVerified).toBe(false);
      return;
    }
    expect(fetched).toMatchObject({ ok: true, payload: { jobs: [{ locationRaw: location, cities: [city] }] } });
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED" },
      jobs: [{ locationRaw: location, cities: [city] }]
    });
  });

  it.each(GENERIC_LOCATION_PHENOM_SOURCES)(
    "strict replay rejects generic location evidence for exact staged %s",
    async (sourceId) => {
      const stagedPlan = exactPhenomPlan(sourceId);
      const config = stagedPlan.officialJsonFetch;
      if (config?.kind !== "phenom") throw new Error("Expected exact Phenom config");
      const country = config.facetScope?.countryIncludeDescriptor ?? config.countryFilter ?? "China";
      const { fetched } = await fetchExactPhenomLocation(sourceId, (sourceId === "source-merck-china-social" || sourceId === "source-organon-china-social" || sourceId === "source-lilly-china-social")
        ? "Shanghai, Shanghai, China" : `${sourceId === "source-ucb-china-social" ? "Shanghai" : "Wuxi"}, ${country}`);
      if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected successful Phenom evidence");
      const forged = {
        ...fetched,
        fetchEvidence: {
          ...fetched.fetchEvidence,
          artifacts: fetched.fetchEvidence.artifacts.map((artifact) => {
            if (artifact.logicalKey !== "phenom-page-0000" || typeof artifact.body !== "string") return artifact;
            const root = JSON.parse(artifact.body) as {
              refineSearch: { data: { jobs: Array<Record<string, unknown>> } };
            };
            root.refineSearch.data.jobs[0] = {
              ...root.refineSearch.data.jobs[0],
              location: "Remote",
              city: "Remote"
            };
            return { ...artifact, body: JSON.stringify(root) };
          })
        }
      };
      const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => forged });
      expect(crawled.truth.completenessVerified).toBe(false);
      expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
    }
  );

  it.each(["Wuxi", "Shenyang", "Qingdao"])(
    "normalizes historical GSK Phenom with a safe official China city fallback for %s",
    async (city) => {
      const { stagedPlan, fetched } = await fetchExactGsk(gskJob({
        multi_location: ["Singapore", `${city}, China`]
      }));
      expect(fetched).toMatchObject({
        ok: true,
        payload: { jobs: [{ locationRaw: `${city}, China`, cities: [city] }] }
      });
      const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
      expect(crawled).toMatchObject({
        status: "SUCCESS",
        truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: false },
        observation: { structuredJobCount: 1, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
        jobs: [{ locationRaw: `${city}, China`, cities: [city] }]
      });
    }
  );

  it.each([
    ["foreign-only alternatives", ["Singapore", "Basel, Switzerland"]],
    ["a mixed ambiguous alternative", ["Singapore", "Shanghai / Singapore"]],
    ["two mainland alternatives", ["Singapore", "Shanghai, China", "Beijing, China"]],
    ["a mainland and foreign location mixed in one value", ["Singapore", "Shanghai, China / Singapore"]],
    ["an unknown alternative", ["Singapore", "Remote"]],
    ["an ambiguous alternative", ["Singapore", "Multiple Locations"]]
  ])("does not publish historical GSK Phenom with %s", async (_label, multiLocation) => {
    const { stagedPlan, fetched } = await fetchExactGsk(gskJob({ multi_location: multiLocation }));
    expect(fetched).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: {
      rawCount: 1, validCount: _label === "two mainland alternatives" ? 1 : 0,
      validationDiscardCount: _label === "two mainland alternatives" ? 0 : 1
    } } });
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(crawled.truth.completenessVerified).toBe(false);
    expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it("binds current GSK hydrated native-detail locations and rejects a swapped detail projection", async () => {
    const { stagedPlan, fetched } = await fetchCurrentGskNative(true);
    if (!fetched.ok || !fetched.fetchEvidence) throw Error("Expected hydrated native GSK evidence");
    const result = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs[0]?.cities).toEqual(["上海"]);
    const tampered = structuredClone(fetched);
    const detail = tampered.fetchEvidence!.artifacts.find(a => a.logicalKey.startsWith("moka-detail-"));
    if (!detail) throw Error("Expected exact native detail artifact");
    const body = JSON.parse(detail.body as string);
    body.locations = [{ country: "中国", cityName: "北京" }];
    detail.body = JSON.stringify(body);
    expect((await runSourceCrawl(stagedPlan, { fetch: async () => tampered })).truth.completenessVerified).toBe(false);
  });

  it.each([
    ["location", { locationRaw: "北京" }],
    ["cities", { cities: ["北京"] }],
    ["title", { title: "Altered medical role" }],
    ["identity", { id: "sha256:" + "a".repeat(64) }],
    ["URL", { officialUrl: "https://app.mokahr.com/social-recruitment/gsk/148067#/job/other" }]
  ])("rejects current GSK output %s that disagrees with native evidence", async (_label, override) => {
    const { stagedPlan, fetched } = await fetchCurrentGskNative();
    if (!fetched.ok || !("payload" in fetched)) throw Error("Expected current GSK native evidence");
    expect((await runSourceCrawl(stagedPlan, { fetch: async () => fetched })).truth.completenessVerified).toBe(true);
    const payload = structuredClone(fetched.payload) as { data: { jobs: Array<Record<string, unknown>> } };
    payload.data.jobs[0] = { ...payload.data.jobs[0], ...override };
    expect((await runSourceCrawl(stagedPlan, { fetch: async () => ({ ...fetched, payload }) })).truth.completenessVerified).toBe(false);
  });

  it.each(["company", "configuration", "campaign URL", "Open scope policy"])(
    "rejects current GSK native proof transplanted to another %s", async kind => {
      const { stagedPlan, fetched } = await fetchCurrentGskNative();
      expect((await runSourceCrawl(stagedPlan, { fetch: async () => fetched })).truth.completenessVerified).toBe(true);
      const changed = structuredClone(stagedPlan);
      if (changed.adapterId !== "official-json" || !changed.moka) throw Error("Expected GSK Moka plan");
      if (kind === "company") changed.company.id = changed.source.companyId = "company-transplanted";
      if (kind === "configuration") changed.moka.expectedSiteId = "other-site";
      if (kind === "campaign URL") changed.moka.campaignUrl = "https://app.mokahr.com/social-recruitment/gsk/other-site";
      if (kind === "Open scope policy") delete changed.moka.requisitionStatusPolicy;
      expect((await runSourceCrawl(changed, { fetch: async () => fetched })).truth.completenessVerified).toBe(false);
    }
  );

  it.each([
    ["slash-separated foreign city", "Shanghai / Singapore", "Shanghai"],
    ["foreign city beside China", "London, China", "London"],
    ["non-mainland region beside Shanghai", "Shanghai, Hong Kong", "Shanghai"],
    ["non-mainland code", "HK", "Shanghai"],
    ["foreign office suffix", "Singapore Office", "Shanghai"],
    ["Chinese foreign office suffix", "新加坡办公室", "上海"],
    ["ideographic comma boundary", "Shanghai、新加坡", "Shanghai"],
    ["parenthesized foreign location", "Shanghai（Singapore Office）", "Shanghai"],
    ["hyphenated foreign location", "Shanghai-Singapore", "Shanghai"],
    ["SAR suffix", "Hong Kong SAR", "Shanghai"],
    ["non-mainland airport-style code", "HKG", "Shanghai"]
  ])("rejects a China-tagged Phenom record with %s", async (_label, location, city) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CONFLICT", { country: "China", location, city })], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "OUT_OF_SCOPE" } }]
      }
    });
  });

  it("fails closed on an unclassified segment in a multi-segment China location", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("AMBIGUOUS", {
            country: "China", location: "office,Shanghai", city: "Shanghai"
          })], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 } }
    });
  });

  it.each([
    "上海市香港路100号",
    "武汉香港路",
    "北京美国大使馆附近",
    "上海英国领事馆附近"
  ])("does not treat a mainland address containing a foreign-name substring as foreign: %s", async (location) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("MAINLAND", { country: "China", location, city: "上海" })], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1, validationDiscardCount: 0 } }
    });
  });

  it("fails closed through D1 on unstable totals and retains both raw pages", async () => {
    const bodies = [pageBody([job("CN-1")], 3, 0), pageBody([job("CN-2")], 2, 1)];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{}, { kind: "PAGINATION_PAGE" }, { kind: "PAGINATION_PAGE" }] },
      paginationEvaluation: { safeCompleteness: false, derivedAnomalyCodes: ["TOTAL_CHANGED"] }
    });
  });

  it("retains invalid JSON and invalid jobs collection page evidence", async () => {
    for (const body of ["{", JSON.stringify({ refineSearch: { totalHits: 1, data: { jobs: {} } } })]) {
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async (request) => request.method === "POST"
          ? response(body, widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html")
      });
      const result = await fetcher(plan);
      expect(result).toMatchObject({
        ok: false,
        fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE", body }] }
      });
    }
  });

  it.each([
    ["missing entry metadata", { finalUrl: null as unknown as string }],
    ["false entry origin", { finalUrl: "https://evil.example.test/cn/zh/search-results?keywords=China" }],
    ["entry time before crawl", { capturedAt: "2026-07-10T23:59:59.999Z" }]
  ])("fails closed on %s", async (_label, overrides) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(entryHtml(), entryUrl, "text/html", overrides)
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({ ok: false });
    expect(withoutOpaqueBodies(result)).not.toContain(refNum);
  });

  it("retains the exact entry artifact when required widget config is missing", async () => {
    const body = "<html><body>no widget configuration</body></html>";
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE", body }] }
    });
  });

  it.each([
    [
      "scattered key/value fragments",
      `<script>{"widgetApiEndpoint":"${widgetUrl}"}</script><script>{"refNum":"${refNum}","locale":"zh_cn","deviceType":"desktop","country":"cn","pageName":"search-results","pageId":"page18"}</script>`
    ],
    [
      "invalid phApp JSON",
      `<script>var phApp={"widgetApiEndpoint":"${widgetUrl}","refNum":"${refNum}","locale":"zh_cn","deviceType":"desktop","country":"cn","pageName":"search-results","pageId":"page18";</script>`
    ],
    [
      "multiple conflicting phApp objects",
      `${entryHtml()}<script>var phApp={"widgetApiEndpoint":"https://careers.example.test/other-widgets","country":"cn","deviceType":"mobile","locale":"en_us","refNum":"OTHER","pageName":"other","pageId":"page99"};</script>`
    ],
    [
      "wrong-typed own field",
      `<script>var phApp={"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":18};</script>`
    ]
  ])("rejects %s instead of stitching config across HTML", async (_label, body) => {
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found",
      fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE", body }] }
    });
    expect(requestCount).toBe(1);
  });

  it.each([
    ["conditional", `if (enabled) { phApp.pageId = "page12"; }`],
    ["window", `window.phApp.pageId = "page12";`],
    ["globalThis", `globalThis.phApp.pageId = "page12";`],
    ["Object.assign", `Object.assign(phApp, { pageId: "page12" });`]
  ])("rejects a %s pageId mutation hidden after a valid bootstrap", async (_label, mutation) => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":"page11"};
    </script><script>${mutation}</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it("accepts one strict application/json script object containing one phApp object", async () => {
    const body = `<script type="application/json">${JSON.stringify({
      phApp: {
        widgetApiEndpoint: widgetUrl,
        country: "cn",
        deviceType: "desktop",
        locale: "zh_cn",
        refNum,
        pageName: "search-results",
        pageId: "page18"
      }
    })}</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }
    });
  });

  it("ignores phApp text inside comments, strings and templates while accepting the real assignment", async () => {
    const fake = `{"widgetApiEndpoint":"https://careers.example.test/evil","country":"us","deviceType":"mobile","locale":"en_us","refNum":"EVIL","pageName":"evil","pageId":"evil"}`;
    const body = `<script>
      // phApp = ${fake};
      const quoted = ${JSON.stringify(`phApp = ${fake}`)};
      const templated = \`phApp = ${fake}\`;
      /* window.phApp = ${fake}; */
      window.phApp = ${entryHtml().match(/phApp=(\{.*\});/u)?.[1]};
    </script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it("does not accept a phApp-looking assignment outside a real script element", async () => {
    const body = `<div>window.phApp = ${entryHtml().match(/phApp=(\{.*\});/u)?.[1]};</div>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it("rejects duplicate required JSON keys before JSON.parse can overwrite them", async () => {
    const body = `<script>window.phApp={"widgetApiEndpoint":"${widgetUrl}","refNum":"${refNum}","locale":"zh_cn","deviceType":"desktop","country":"cn","pageName":"search-results","pageId":"page18","pageId":"page99"};</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each([
    ["regex literal", (config: string) => `const matcher = /phApp = ${config.replaceAll("/", "\\/")}/;`],
    ["function default parameter", (config: string) => `function nested(phApp = ${config}) { return phApp; }`],
    ["local block declaration", (config: string) => `{ const phApp = ${config}; void phApp; }`],
    ["nested function declaration", (config: string) => `function nested() { const phApp = ${config}; return phApp; }`],
    ["nested IIFE assignment", (config: string) => `(() => { window.phApp = ${config}; })();`],
    ["computed window member", (config: string) => `window["phApp"] = ${config};`],
    ["other member alias", (config: string) => `holder.phApp = ${config};`]
  ])("rejects non-top-level executable config from %s", async (_label, source) => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const body = `<script>${source(config)}</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each(["var", "let", "const"] as const)(
    "accepts a top-level %s phApp object declaration",
    async (declaration) => {
      const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
      const body = `<script>${declaration} phApp = ${config};</script>`;
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async (request) => request.method === "POST"
          ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
          : response(body, entryUrl, "text/html")
      });
      await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
    }
  );

  it("accepts a top-level window.phApp assignment expression", async () => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const body = `<script>window.phApp = ${config};</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["spread", (config: string) => `const base = {}; const phApp = {...base, ${config.slice(1, -1)}};`],
    ["computed property", (config: string) => `const phApp = ${config.replace('"pageId"', '["pageId"]')};`],
    ["method", (config: string) => `const phApp = {helper(){}, ${config.slice(1, -1)}};`],
    ["dynamic required value", (config: string) => `const phApp = ${config.replace('"pageId":"page18"', '"pageId":makePageId()')};`]
  ])("rejects ambiguous top-level ObjectExpression using %s", async (_label, source) => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const body = `<script>${source(config)}</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each([
    "text/template",
    "text/plain",
    "application/ld+json",
    "application/x-phenom-config",
    "text/plain; text/javascript",
    "application/ld+json; charset=utf-8"
  ])("ignores inert script type %s even when its body contains phApp", async (type) => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const body = `<script type="${type}">const phApp = ${config};</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each([
    ["absent", undefined, "const"],
    ["empty", "", "const"],
    ["whitespace", "   ", "const"],
    ["text javascript", "text/javascript", "const"],
    ["application javascript", "application/javascript", "const"],
    ["case and MIME parameter", "  TEXT/JAVASCRIPT ; charset=UTF-8  ", "const"],
    ["module", "module", "const"]
  ] as const)("accepts executable script type %s", async (_label, type, declaration) => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const typeAttribute = type === undefined ? "" : ` type="${type}"`;
    const body = `<script${typeAttribute}>${declaration} phApp = ${config};</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it("keeps application/json with a MIME parameter on the strict JSON path", async () => {
    const body = `<script type=" Application/JSON ; charset=utf-8 ">${JSON.stringify({
      phApp: {
        widgetApiEndpoint: widgetUrl,
        country: "cn",
        deviceType: "desktop",
        locale: "zh_cn",
        refNum,
        pageName: "search-results",
        pageId: "page18"
      }
    })}</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["wrong page MIME", { contentType: "text/html" }],
    ["false page URL", { finalUrl: "https://evil.example.test/widgets" }],
    ["future page time", { capturedAt: "2026-07-11T00:00:00.001Z" }]
  ])("fails closed on %s while retaining every safely available prior artifact", async (_label, overrides) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json", overrides)
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({ ok: false });
    expect(result.fetchEvidence?.artifacts[0]).toMatchObject({ kind: "OFFICIAL_COMPANY_PAGE" });
  });

  it.each([
    [
      "repeated response and ID set",
      [pageBody([job("CN-1")], 3, 0), pageBody([job("CN-1")], 3, 0)],
      ["MAX_PAGES_WITH_NEXT", "REPEATED_JOB_ID_SET_WITH_NEXT", "REPEATED_RESPONSE_FINGERPRINT"]
    ],
    [
      "returned offset mismatch",
      [pageBody([job("CN-1")], 1, 7)],
      ["OFFSET_NOT_ADVANCING"]
    ],
    [
      "max page with next",
      [pageBody([job("CN-1")], 2, 0)],
      ["MAX_PAGES_WITH_NEXT"]
    ]
  ])("fails closed through D1 on %s", async (_label, suppliedBodies, expectedCodes) => {
    const bodies = [...suppliedBodies];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher({
      ...plan,
      officialJsonFetch: { ...plan.officialJsonFetch, maxPages: suppliedBodies.length }
    });
    expect(result).toMatchObject({ ok: false, paginationEvaluation: { safeCompleteness: false } });
    if (!result.paginationEvaluation) throw new Error("expected pagination evaluation");
    expect(result.paginationEvaluation.derivedAnomalyCodes).toEqual(expect.arrayContaining(expectedCodes));
  });

  it("fails closed through D1 on an intermediate empty page and retains the later page", async () => {
    const bodies = [
      pageBody([job("CN-1")], 3, 0),
      pageBody([], 3, 1),
      pageBody([job("CN-3")], 3, 2)
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, maxPages: 3 } });
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{}, {}, {}, {}] },
      paginationEvaluation: { derivedAnomalyCodes: ["INTERMEDIATE_EMPTY_PAGE", "MAX_PAGES_WITH_NEXT"] }
    });
  });

  it.each(["transport", "metadata"] as const)(
    "marks the last trusted page ABORTED when a later %s failure has no trustworthy response artifact",
    async (failureKind) => {
      let postCount = 0;
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async (request) => {
          if (request.method !== "POST") return response(entryHtml(), entryUrl, "text/html");
          postCount += 1;
          if (postCount === 1) {
            return response(pageBody([job("CN-1")], 3, 0), widgetUrl, "application/json");
          }
          if (failureKind === "transport") throw new Error("raw transport secret");
          return response(pageBody([job("CN-2")], 3, 1), widgetUrl, "application/json", {
            finalUrl: "https://evil.example.test/widgets"
          });
        }
      });
      const result = await fetcher(plan);
      expect(result).toMatchObject({
        ok: false,
        fetchEvidence: {
          artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE" }],
          pages: [{ sequence: 0, termination: "ABORTED", nextPageSignalAfter: "offset:1" }],
          fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1 }
        }
      });
      expect(JSON.stringify(result)).not.toContain("raw transport secret");
    }
  );

  it("adds a FAILED page when a later invalid JSON response has a trustworthy artifact", async () => {
    let postCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        if (request.method !== "POST") return response(entryHtml(), entryUrl, "text/html");
        postCount += 1;
        return postCount === 1
          ? response(pageBody([job("CN-1")], 3, 0), widgetUrl, "application/json")
          : response("{", widgetUrl, "application/json");
      }
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{}, {}, { kind: "PAGINATION_PAGE", body: "{" }],
        pages: [{ sequence: 0, termination: "CONTINUE" }, { sequence: 1, termination: "FAILED" }]
      }
    });
  });

  it("does not invent a total when totalHits is absent and keeps completeness manual", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], undefined, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, pageSize: 2 } });
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { pages: [{ declaredTotal: null, termination: "ABORTED" }] },
      paginationEvaluation: { safeCompleteness: false, verifiedEligible: false }
    });
    if (!result.ok) throw new Error("expected manual Phenom result");
    expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
    expect(result.completeness?.expectedJobCount).toBeUndefined();
  });

  it("keeps an empty no-total response ABORTED, manual and non-certifying", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([], undefined, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { pages: [{ rawJobIds: [], validJobIds: [], termination: "ABORTED" }] },
      paginationEvaluation: { safeCompleteness: false, verifiedEligible: false }
    });
  });

  it.each([null, -1, 1.5, "2"])('fails with retained evidence for invalid own totalHits %j', async (totalHits) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], totalHits, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE" }] }
    });
  });

  it("does not certify SOURCE scope when the configured facet is not exact China", async () => {
    const requests: Array<{ body?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requests.push(request);
        return request.method === "POST"
          ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html");
      }
    });
    const result = await fetcher({
      ...plan,
      officialJsonFetch: { ...plan.officialJsonFetch, countryFilter: "United States" }
    });
    expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({
      selected_fields: { country: ["United States"] }
    });
    if (!result.ok) throw new Error("expected non-China request to remain manual");
    expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
    expect(result.completeness?.expectedJobCount).toBeUndefined();
  });

  it("preserves success and failure evidence references through runSourceCrawl", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const fetchResult = await fetcher(plan);
    if (!fetchResult.ok || !fetchResult.fetchEvidence || !fetchResult.paginationEvaluation) {
      throw new Error("expected successful fetch evidence");
    }
    const success = await runSourceCrawl(plan, { fetch: async () => fetchResult });
    expect(success.fetchEvidence).toBe(fetchResult.fetchEvidence);
    expect(success.paginationEvaluation).toBe(fetchResult.paginationEvaluation);
    expect(withoutOpaqueBodies(success)).not.toContain(refNum);

    const failureFetch = { ...fetchResult, ok: false as const, failureReason: "safe failure" };
    const failure = await runSourceCrawl(plan, { fetch: async () => failureFetch });
    expect(failure.fetchEvidence).toBe(fetchResult.fetchEvidence);
    expect(failure.paginationEvaluation).toBe(fetchResult.paginationEvaluation);
  });
});
