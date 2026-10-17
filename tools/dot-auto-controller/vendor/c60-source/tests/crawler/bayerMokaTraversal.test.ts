import { assertBGradePublicSnapshot } from "../helpers/assertBGradePublicSnapshot";
import { assertBGradePilotContext } from "../helpers/assertBGradePilotContext";
import { captureBayerIndependentDetails, type BayerDomCapture } from "../../src/crawler/bayerMokaRenderedTraversal";
import { replayBayerMedicalTraversal } from "../../src/crawler/bayerMokaScope";
import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMokaSourceFetch, type MokaHttpClient } from "../../src/crawler/mokaSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { replayOfficialJsonRenderedTraversal } from "../../src/crawler/officialJsonRenderedTraversalValidator";
import { createOfficialJsonRenderedTraversalValidation, issueBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { MOKA_RECENT_JSON_CONFIG } from "../../src/crawler/companyRecruitmentProfiles/shared";

const NOW = "2026-10-02T17:00:00.000Z";
const IV = "0123456789abcdef", KEY = "abcdef0123456789";
const ENTRY = "https://app.mokahr.com/social-recruitment/bayer/148387?locale=zh-CN#/jobs";
export function bayerTestPlan(): SourceCrawlPlan {
  const previous = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-bayer-healthcare-social")!;
  return { ...previous, adapterId: "official-json", source: { ...previous.source, atsKind: "MOKA", officialEntryUrl: ENTRY },
    json: MOKA_RECENT_JSON_CONFIG, moka: { expectedOrgId: "bayer", expectedSiteId: "148387", expectedMode: "social",
      campaignUrl: "https://app.mokahr.com/social-recruitment/bayer/148387", hydrateMissingLocationsFromDetail: true,
      allowDetailSiteIdOmission: true, scopeExclusionProof: "BAYER_MEDICAL_OPEN_REQUISITIONS_V1" } } as SourceCrawlPlan;
}
function field(name: string, value: string) { return { name, value }; }
function row(n: number, status = "open") {
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, orgId: "bayer", title: `职位 ${n}`,
    status, publishedAt: "2026-09-01T09:00:00", showIsCampus: false };
}
function detail(n: number, status = "open") {
  return { ...row(n, status), locations: [], customFields: {
    "283170": field("Division", "Pharmaceuticals"), "290891": field("国家", "China"), "289157": field("城市", "BeiJing"),
    "291952": field("职位暂停开始时间", status === "pause" ? "2026-08-18" : ""), "298038": field("职位暂停结束时间", "") } };
}
function encrypted(value: unknown) {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(KEY), Buffer.from(IV));
  return JSON.stringify({ data: cipher.update(JSON.stringify(value), "utf8", "base64") + cipher.final("base64"), necromancer: KEY });
}
async function collect(options: { changeList?: (rows: any[]) => void; changeDetails?: (details: any[]) => void } = {}) {
  const rows = [row(1), row(2, "pause"), row(3)];
  const details = [detail(1), detail(2, "pause"), detail(3)];
  options.changeList?.(rows); options.changeDetails?.(details);
  const requests: Parameters<MokaHttpClient>[0][] = [];
  const http: MokaHttpClient = async request => {
    requests.push(request);
    const bootstrap = { aesIv: IV, mode: "social", siteId: "148387", org: { id: "bayer", siteId: 148387 },
      jobCustomFields: [{ id: 283170, name: "Division", type: "select_info", detail: ["Pharmaceuticals", "Consumer Health", "Crop Science"] }] };
    const body = request.method === "GET" ? `<input id="init-data" value='${JSON.stringify(bootstrap)}'>`
      : request.url.endsWith("jobs/v2") ? encrypted({ success: true, data: { jobStats: { orgId: "bayer", total: rows.length }, jobs: rows } })
        : encrypted({ success: true, data: details.find(r => r.id === request.body?.jobId) });
    return { status: 200, body, finalUrl: request.method === "GET" ? ENTRY.split("#")[0] : request.url,
      contentType: request.method === "GET" ? "text/html" : "application/json", capturedAt: NOW };
  };
  const plan = bayerTestPlan();
  const fetched = await createMokaSourceFetch({ http, now: () => new Date(NOW) })(plan);
  const result = await runSourceCrawl(plan, { fetch: async () => fetched });
  return { requests, fetched, result, plan, rows, details, http };
}

describe("Bayer medical native-scope B traversal", () => {
  it("requests the official division filter and reconciles paused originals without rewriting the official total", async () => {
    const { requests, fetched, result } = await collect();
    expect(fetched.ok, !fetched.ok ? fetched.failureReason : undefined).toBe(true);
    expect(requests[1]?.body).toMatchObject({ customFields: { "283170": { values: ["Pharmaceuticals", "Consumer Health"] } } });
    expect(result.fetchEvidence?.fetchCounts).toEqual({ rawCount: 3, parsedCount: 3, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 1 });
    expect(result.fetchEvidence?.pages[0]?.declaredTotal).toBe(3);
    expect(result.fetchEvidence?.declaredCompleteness?.kind).toBe("COMPLETE_PAGE_TRAVERSAL");
    expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe("BAYER_OFFICIAL_PAUSED");
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({ cities: ["北京"], officialPublishedAt: "2026-09-01T01:00:00.000Z" });
  });
  it.each(["BeiJing", "NanTong", "ChengDu", "ChongQing", "ShangHai"])("binds independent UI raw, paused and final sets into the existing B v2 certificate using %s", async city => {
    const { result, plan, rows, details } = await collect({ changeDetails: details => details.forEach(d => {
      d.customFields["289157"].value = city;
      if (city === "ChongQing") d.locations = [{ country: "中国", countryDescription: "中国", provinceName: "重庆市", cityName: "开州区", cityId: 500154 }];
      if (city === "ShangHai") d.locations = [{ country: "中国", countryDescription: "中国", provinceName: "上海市", cityName: "浦东新区", cityId: 310115 }];
    }) });
    if (city === "ChongQing" || city === "ShangHai") expect(result.jobs.every(j => j.cities.join() === (city === "ChongQing" ? "开州区" : "浦东新区"))).toBe(true);
    const entryBody = `<input id="init-data" value='${JSON.stringify({ aesIv: IV, mode: "social", siteId: "148387", org: { id: "bayer" } })}'>`;
    const receipt = (url: string, body: string, requestBody?: unknown) => ({ method: requestBody ? "POST" : "GET", url,
      ...(requestBody ? { requestBody } : {}), finalUrl: url, status: 200, body, capturedAt: NOW,
      bodySha256: createHash("sha256").update(body).digest("hex") });
    const domPage = { capturedAt: NOW,
      url: ENTRY + "?283170%5B0%5D=Pharmaceuticals&283170%5B1%5D=Consumer%20Health&page=1&pageSize=30",
      summaryText: "已选 1 条件 | 3 结果", pageNumber: 1, pageSize: 30, nextDisabled: true,
      selectedDivisions: ["Pharmaceuticals", "Consumer Health"],
      paginationHtml: '<button class="sd-Pagination-is-active">1</button><button class="sd-Pagination-forward" disabled></button>' };
    const pages = [{ channelId: plan.expectedChannels![0]!.channelId, pageNumber: 1, declaredTotalPages: 1, declaredTotalJobs: rows.length,
      uiRequestCandidateIds: [], nextControlPresent: false, rawRows: rows.map((listRow, recordIndex) => {
        const sourceJobId = `sha256:${createHash("sha256").update(JSON.stringify(listRow.id)).digest("hex")}`;
        const entry = receipt(ENTRY.split("#")[0]!, entryBody);
        return { sourceJobId, rawEvidenceId: sourceJobId, recordIndex, scopeMarker: listRow.status,
          scopeDecision: listRow.status === "open" ? "INCLUDED_MAINLAND" as const : "EXCLUDED_AUDITED" as const,
          rawPayload: { captureMethod: "CUA_DOM_LIST_PLUS_INDEPENDENT_HTTP_DETAILS", domPage,
            domRow: { href: `#/job/${listRow.id}`, titleHtml: `<span>${listRow.title}</span>`, publishedHtml: '<span>发布于 2026-09-01</span>' },
            ...(recordIndex === 0 ? { entry } : {}), entrySha256: entry.bodySha256,
            detailResponse: receipt("https://app.mokahr.com/api/outer/ats-apply/website/job", encrypted({ success: true, data: details[recordIndex] }),
              { orgId: "bayer", siteId: "148387", jobId: listRow.id, locale: "zh-CN" }) } };
      }) }];
    expect(replayOfficialJsonRenderedTraversal("source-bayer-healthcare-social" as any, pages)).toMatchObject({ rawCount: 3, excludedCount: 1 });
    for (const kind of ["domTitle", "filter", "pageBoundary", "httpBody", "httpTime", "httpIdentity", "relabelPause"] as const) {
      const invalid = structuredClone(pages) as any;
      const payload = invalid[0].rawRows[0].rawPayload;
      if (kind === "domTitle") payload.domRow.titleHtml = "<span>Different job</span>";
      if (kind === "filter") invalid[0].rawRows.forEach((r: any) => r.rawPayload.domPage.selectedDivisions = ["Crop Science"]);
      if (kind === "pageBoundary") invalid[0].rawRows.forEach((r: any) => r.rawPayload.domPage.paginationHtml = "<button>2</button>");
      if (kind === "httpBody") payload.detailResponse.body += " ";
      if (kind === "httpTime") payload.detailResponse.capturedAt = "2026-10-01T17:00:00.000Z";
      if (kind === "httpIdentity") payload.detailResponse.requestBody.jobId = rows[1]!.id;
      if (kind === "relabelPause") invalid[0].rawRows[1].scopeDecision = "INCLUDED_MAINLAND";
      expect(() => replayOfficialJsonRenderedTraversal("source-bayer-healthcare-social" as any, invalid), kind).toThrow();
    }
    const validation = createOfficialJsonRenderedTraversalValidation({ sourceId: "source-bayer-healthcare-social" as any,
      companyId: plan.company.id, sourceConfigSha256: sourcePlanConfigSha256(plan), surfaceIds: [plan.source.surfaceId!],
      channelIds: plan.expectedChannels!.map(c => c.channelId), pages, observedAt: NOW, expiresAt: "2026-10-03T17:00:00.000Z" });
    const certificate = issueBGradeTraversalCertificate({ plan, binding: { releaseCandidateId: "test-bayer", batchId: "test-batch",
      sourceResultId: "test-result", sourceConfigSha256: sourcePlanConfigSha256(plan) }, transportSuccess: true, adapterSuccess: true,
      evidence: result.fetchEvidence!, paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!,
      jobs: result.jobs, independentValidation: validation, validationExecution: "CURRENT_RUN", trigger: "INITIAL_QUALIFICATION", now: new Date(NOW) });
    expect(certificate).toMatchObject({ status: "CERTIFIED", certificate: { grade: "B", schemaVersion: "b-grade-independent-traversal-v2" } });
    if (certificate.status !== "CERTIFIED") throw Error("synthetic B rejected");
    await assertBGradePilotContext(plan, await assertBGradePublicSnapshot(plan, result, certificate.certificate));
  });
  it("drives fresh detail HTTP only from the independently enumerated DOM IDs", async () => {
    const { rows, http, requests } = await collect();
    const before = requests.length;
    const dom: BayerDomCapture = { schemaVersion: "bayer-cua-dom-list-v1", observedAt: NOW, pages: [{
      capturedAt: NOW, url: ENTRY + "?283170%5B0%5D=Pharmaceuticals&283170%5B1%5D=Consumer%20Health&page=1&pageSize=30",
      summaryText: "已选 1 条件 | 3 结果", pageNumber: 1, pageSize: 30, nextDisabled: true,
      selectedDivisions: ["Pharmaceuticals", "Consumer Health"],
      paginationHtml: '<button class="sd-Pagination-is-active">1</button><button class="sd-Pagination-forward" disabled></button>',
      rows: rows.map(r => ({ href: `#/job/${r.id}`, titleHtml: `<span>${r.title}</span>`, publishedHtml: '<span>发布于 2026-09-01</span>' }))
    }] };
    const captured = await captureBayerIndependentDetails({ dom, http: async request => ({ ...await http(request), capturedAt: "2026-10-02T17:10:00.000Z" }), now: () => new Date("2026-10-02T17:10:00.000Z") });
    expect(captured.observedAt).toBe(NOW);
    expect(requests.slice(before).map(r => r.url)).toEqual([ENTRY.split("#")[0], ...rows.map(() => "https://app.mokahr.com/api/outer/ats-apply/website/job")]);
    expect(requests.slice(before + 1).map(r => r.body?.jobId)).toEqual(rows.map(r => r.id));
    expect(captured.pages[0]!.rawRows.map(r => r.scopeDecision)).toEqual(["INCLUDED_MAINLAND", "EXCLUDED_AUDITED", "INCLUDED_MAINLAND"]);
    const missing = structuredClone(dom); missing.pages[0]!.rows.pop();
    const requestCount = requests.length;
    await expect(captureBayerIndependentDetails({ dom: missing, http, now: () => new Date(NOW) })).rejects.toThrow();
    expect(requests).toHaveLength(requestCount);
  });
  it.each(["2026-09-01T15:18", "2026-09-02T15:18"])("replays minute-only official timestamps in China time regardless of process TZ: %s", async publishedAt => {
    const { result, plan } = await collect({ changeList: rows => rows[0].publishedAt = publishedAt,
      changeDetails: rows => rows[0].publishedAt = publishedAt });
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]!.officialPublishedAt).toBe(`${publishedAt.slice(0, 10)}T07:18:00.000Z`);
    expect(replayBayerMedicalTraversal(plan, result.fetchEvidence!, result.jobs)).toEqual({ excludedCount: 1 });
  });
  it.each(["2026-13-01T15:18", "2026-09-01T25:18", "2026-09-01T15:61", "not-a-date"])("fails closed on invalid minute timestamps: %s", async publishedAt => {
    const { result } = await collect({ changeList: rows => rows[0].publishedAt = publishedAt,
      changeDetails: rows => rows[0].publishedAt = publishedAt });
    expect(result.truth.completenessVerified).toBe(false);
  });
  it("preserves an old but explicitly open official posting without adding a date exclusion", async () => {
    const { result } = await collect({ changeList: rows => rows[0].publishedAt = "2020-01-01T09:00:00",
      changeDetails: rows => rows[0].publishedAt = "2020-01-01T09:00:00" });
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]!.officialPublishedAt).toBe("2020-01-01T01:00:00.000Z");
  });
  it("resolves the official ChengDu city field when native locations are empty", async () => {
    const { result } = await collect({ changeDetails: details => details[0].customFields["289157"].value = "ChengDu" });
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs[0]!.cities).toEqual(["成都"]);
  });
  it.each(["Unknown", "STIT", "Taizhou", "Changshu", "Beijing / Chengdu", ""])("rejects unreviewed or non-city fallback %s", async city => {
    const { result } = await collect({ changeDetails: details => details[0].customFields["289157"].value = city });
    expect(result.truth.completenessVerified).toBe(false);
  });
  it.each(["country", "description", "province", "cityId"])("rejects conflicting district %s evidence", async kind => {
    const { result } = await collect({ changeDetails: details => {
      const location: Record<string, unknown> = { country: "中国", countryDescription: "中国", provinceName: "重庆市", cityName: "开州区", cityId: 500154 };
      if (kind === "country") location.country = "Germany";
      if (kind === "description") location.countryDescription = "德国";
      if (kind === "province") location.provinceName = "上海市";
      if (kind === "cityId") location.cityId = 500155;
      details[0].locations = [location];
    } });
    expect(result.truth.completenessVerified).toBe(false);
  });
  it.each(["total", "request", "rawId", "lossIndex", "lossCode", "artifact", "title", "location", "date"])("rejects tampered %s evidence or output", async kind => {
    const { result, plan } = await collect();
    const evidence = structuredClone(result.fetchEvidence!), jobs = structuredClone(result.jobs);
    if (kind === "total") evidence.pages[0]!.declaredTotal = 2;
    if (kind === "request") evidence.artifacts[1]!.extractorLocator += "changed";
    if (kind === "rawId") evidence.pages[0]!.rawJobIds.pop();
    if (kind === "lossIndex") evidence.fetchLosses[0]!.details.recordIndex = 0;
    if (kind === "lossCode") evidence.fetchLosses[0]!.details.code = "OUT_OF_SCOPE";
    if (kind === "artifact") evidence.artifacts.pop();
    if (kind === "title") jobs[0]!.officialTitle = "wrong";
    if (kind === "location") jobs[0]!.cities = ["上海"];
    if (kind === "date") jobs[0]!.officialPublishedAt = NOW;
    expect(replayBayerMedicalTraversal(plan, evidence, jobs)).toBeUndefined();
  });
  it.each(["unknown", "closed", ""]) ("fails closed on unreviewed status %s", async status => {
    const { result } = await collect({ changeList: rows => rows[1].status = status, changeDetails: rows => rows[1].status = status });
    expect(result.truth.completenessVerified).toBe(false);
  });
  it.each(["status", "division", "country", "city", "pauseStart", "pauseEnd", "id"]) ("rejects mismatched %s detail evidence", async kind => {
    const { result } = await collect({ changeDetails: details => {
      if (kind === "status") details[1].status = "open";
      if (kind === "division") details[0].customFields["283170"].value = "Crop Science";
      if (kind === "country") details[0].customFields["290891"].value = "Germany";
      if (kind === "city") details[0].customFields["289157"].value = "Unknown";
      if (kind === "pauseStart") details[1].customFields["291952"].value = "2026-99-99";
      if (kind === "pauseEnd") details[1].customFields["298038"].value = "2026-08-19";
      if (kind === "id") details[0].id = "other";
    } });
    expect(result.truth.completenessVerified).toBe(false);
  });
});
