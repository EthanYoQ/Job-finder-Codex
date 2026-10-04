import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { captureServierIndependentDetails, replayServierHybridTraversal, servierHybridFinishedAt, servierHybridObservedAt,
  validateServierDomCapture, type ServierDomCapture } from "../../src/crawler/servierMokaRenderedTraversal";
import { decodeServierArtifact, SERVIER_MOKA_CAMPAIGN, SERVIER_MOKA_DETAIL } from "../../src/crawler/servierMokaScope";
import type { MokaHttpClient, MokaHttpRequest, MokaHttpResponse } from "../../src/crawler/mokaSourceFetch";
import type { OfficialJsonRenderedPageCapture } from "../../src/crawler/officialJsonRenderedTraversalValidator";

// These are synthetic replay fixtures, not native-browser capture evidence or production certificates.
const OBSERVED_AT = "2026-10-03T04:00:00.000Z", HTTP_AT = "2026-10-03T04:10:00.000Z";
const IV = "0123456789abcdef", KEY = "abcdef0123456789";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const officialId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const evidenceId = (n: number) => `sha256:${hash(JSON.stringify(officialId(n)))}`;
const canonical = (ids: string[]) => ids.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
function encrypted(value: unknown): string {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(KEY), Buffer.from(IV));
  return JSON.stringify({ data: cipher.update(JSON.stringify(value), "utf8", "base64") + cipher.final("base64"), necromancer: KEY });
}
function detail(n: number): Record<string, unknown> {
  return { id: officialId(n), orgId: "shiweiya", title: `职位 ${n}`, status: "open", closedAt: null,
    publishedAt: n === 1 ? "2024-05-08T14:56:52" : "2026-09-01T09:00:00", showIsCampus: true,
    jobDescription: "<p>Complete official responsibilities and requirements for this open role.</p>",
    locations: n === 1 ? [] : [{ country: "中国", countryDescription: "中国", cityName: "北京市", cityId: 110000, provinceName: "北京市" }],
    locDepCampusList: [{ locationIds: n === 1 ? [] : [110000] }], customFields: {} };
}
function domFixture(total = 95): ServierDomCapture {
  return { schemaVersion: "servier-cua-dom-list-v1", observedAt: OBSERVED_AT,
    pages: Array.from({ length: Math.ceil(total / 30) }, (_, index) => ({
      url: `${SERVIER_MOKA_CAMPAIGN}#/jobs${index ? `?page=${index + 1}&pageSize=30` : ""}`,
      capturedAt: new Date(Date.parse(OBSERVED_AT) + index * 1000).toISOString(),
      summaryText: `已选 0 条件 | ${total} 结果`, pageNumber: index + 1, pageSize: 30, selectedFilters: [],
      nextDisabled: index === Math.ceil(total / 30) - 1,
      paginationHtml: `<button class="sd-Pagination-is-active">${index + 1}</button><button class="sd-Pagination-forward"${index === Math.ceil(total / 30) - 1 ? " disabled" : ""}></button>`,
      rows: Array.from({ length: Math.min(30, total - index * 30) }, (_, rowIndex) => {
        const n = index * 30 + rowIndex + 1;
        return { href: `#/job/${officialId(n)}`, titleHtml: `<span>职位 ${n}</span>`,
          publishedHtml: `<span>发布于 ${String(detail(n).publishedAt).slice(0, 10)}</span>` };
      })
    })) };
}
async function collect(options: {
  total?: number; plaintext?: boolean; dom?: ServierDomCapture; nowAt?: string;
  responseChange?: (response: MokaHttpResponse, request: MokaHttpRequest) => void;
  detailChange?: (detail: Record<string, unknown>) => void;
} = {}) {
  const dom = options.dom ?? domFixture(options.total), requests: MokaHttpRequest[] = [];
  const responses: MokaHttpResponse[] = [], receipts: { body: string; capturedAt: string }[] = [];
  let current = Date.parse(options.nowAt ?? HTTP_AT);
  const http: MokaHttpClient = async request => {
    requests.push(structuredClone(request)); current++;
    let body: string;
    if (request.method === "GET") {
      body = `<input id="init-data" value='${JSON.stringify({ aesIv: IV, mode: "social", siteId: "47734", org: { id: "shiweiya", siteId: 47734 } })}'>`;
    } else {
      const data = detail(Number(String(request.body?.jobId).slice(-12))); options.detailChange?.(data);
      body = (options.plaintext ? JSON.stringify : encrypted)({ success: true, data });
    }
    const response: MokaHttpResponse = { status: 200, body, finalUrl: request.url,
      contentType: request.method === "GET" ? "text/html" : "application/json", capturedAt: new Date(current).toISOString() };
    options.responseChange?.(response, request); responses.push(structuredClone(response)); return response;
  };
  const result = await captureServierIndependentDetails({ dom, http, now: () => new Date(current),
    onReceipt: async (receipt, sequence) => { expect(sequence).toBe(receipts.length); receipts.push(structuredClone(receipt)); } });
  return { ...result, dom, requests, responses, receipts };
}
function payload(pages: readonly OfficialJsonRenderedPageCapture[], index = 0): Record<string, any> {
  return pages[0]!.rawRows[index]!.rawPayload;
}
function changeDetail(pages: readonly OfficialJsonRenderedPageCapture[], change: (data: Record<string, unknown>) => void, index = 0) {
  const receipt = payload(pages, index).detailResponse;
  const root = decodeServierArtifact(receipt, IV); change(root.data as Record<string, unknown>);
  receipt.body = encrypted(root); receipt.bodySha256 = hash(receipt.body);
}

describe("Servier independent unfiltered DOM plus fresh detail traversal", () => {
  it.each([false, true])("replays the full 30+30+30+5 raw set and keeps the open UNKNOWN original (plaintext=%s)", async plaintext => {
    const fixture = await collect({ plaintext });
    expect(fixture.dom.pages.map(p => p.rows.length)).toEqual([30, 30, 30, 5]);
    expect(validateServierDomCapture(fixture.dom)).toBe(95);
    const replay = replayServierHybridTraversal(fixture.pages);
    expect(replay).toEqual({ rawCount: 95, excludedCount: 1,
      rawSourceJobIds: canonical(Array.from({ length: 95 }, (_, i) => evidenceId(i + 1))),
      rawEvidenceIds: canonical(Array.from({ length: 95 }, (_, i) => evidenceId(i + 1))),
      matchKeys: canonical(Array.from({ length: 94 }, (_, i) => evidenceId(i + 2))), excludedSourceJobIds: [evidenceId(1)] });
    expect(new Set([...replay.matchKeys, ...replay.excludedSourceJobIds]).size).toBe(95);
    expect(fixture.pages[0]!.rawRows[0]).toMatchObject({ scopeMarker: "UNKNOWN_GEOGRAPHY", scopeDecision: "EXCLUDED_AUDITED" });
    expect(decodeServierArtifact(payload(fixture.pages).detailResponse, IV).data).toMatchObject({ status: "open", locations: [], closedAt: null });
    expect(fixture.requests).toHaveLength(96);
    expect(fixture.requests[0]).toEqual({ url: SERVIER_MOKA_CAMPAIGN, method: "GET" });
    expect(fixture.requests.slice(1).map(r => r.url)).toEqual(Array.from({ length: 95 }, () => SERVIER_MOKA_DETAIL));
    expect(fixture.requests.slice(1).map(r => r.body)).toEqual(Array.from({ length: 95 }, (_, i) => ({
      orgId: "shiweiya", siteId: "47734", jobId: officialId(i + 1), locale: "zh-CN" })));
    expect(fixture.receipts.map(r => r.body)).toEqual(fixture.responses.map(r => r.body));
    expect(fixture.receipts.map(r => r.capturedAt)).toEqual(fixture.responses.map(r => r.capturedAt));
    expect(fixture.observedAt).toBe(OBSERVED_AT);
    expect(servierHybridObservedAt(fixture.pages)).toBe(OBSERVED_AT);
    expect(servierHybridFinishedAt(fixture.pages)).toBe(fixture.responses.at(-1)!.capturedAt);
  });

  it.each([1, 30, 31, 60, 61, 94, 96])("derives total and page boundaries rather than hard-coding 95: total=%s", async total => {
    const result = await collect({ total });
    expect(replayServierHybridTraversal(result.pages)).toMatchObject({ rawCount: total, excludedCount: 1 });
    expect(result.pages.flatMap(p => p.rawRows)).toHaveLength(total);
  });

  const invalidDomCases: [string, (dom: ServierDomCapture) => void][] = [
    ["selected native filter", d => { d.pages[0]!.selectedFilters = ["北京"]; }],
    ["nonzero summary filter", d => { d.pages[0]!.summaryText = "已选1条件 | 95结果"; }],
    ["hidden query filter", d => { d.pages[0]!.url += "?location=北京"; }],
    ["repeated URL parameter", d => { d.pages[1]!.url += "&page=2"; }],
    ["wrong site", d => { d.pages[0]!.url = d.pages[0]!.url.replace("47734", "148387"); }],
    ["wrong org alias", d => { d.pages[0]!.url = d.pages[0]!.url.replace("shiweiya", "servier"); }],
    ["foreign origin", d => { d.pages[0]!.url = d.pages[0]!.url.replace("app.mokahr.com", "example.com"); }],
    ["extra route query", d => { d.pages[0]!.url += "?page=1?search=x"; }],
    ["wrong page number", d => { d.pages[1]!.pageNumber = 1; }],
    ["wrong page URL", d => { d.pages[1]!.url = `${SERVIER_MOKA_CAMPAIGN}#/jobs`; }],
    ["wrong page size", d => { d.pages[0]!.pageSize = 50; }],
    ["missing final row", d => { d.pages[3]!.rows.pop(); }],
    ["duplicate ID", d => { d.pages[1]!.rows[0] = d.pages[0]!.rows[0]!; }],
    ["different total", d => { d.pages[1]!.summaryText = "已选0条件 | 96结果"; }],
    ["missing page", d => { d.pages.pop(); }],
    ["early disabled flag", d => { d.pages[0]!.nextDisabled = true; }],
    ["last next enabled", d => { d.pages[3]!.paginationHtml = d.pages[3]!.paginationHtml.replace(" disabled", ""); }],
    ["next control absent", d => { d.pages[3]!.paginationHtml = '<button class="sd-Pagination-is-active">4</button>'; }],
    ["aria-only disabled", d => { d.pages[3]!.paginationHtml = d.pages[3]!.paginationHtml.replace(" disabled", ' aria-disabled="true"'); }],
    ["wrong active native page", d => { d.pages[3]!.paginationHtml = d.pages[3]!.paginationHtml.replace(">4<", ">3<"); }],
    ["out of order DOM time", d => { d.pages[2]!.capturedAt = OBSERVED_AT; }],
    ["DOM over one hour", d => { d.pages[3]!.capturedAt = "2026-10-03T05:00:00.001Z"; }],
    ["observation time differs", d => { d.observedAt = "2026-10-03T04:00:00.001Z"; }],
    ["invalid calendar date", d => { d.pages[0]!.rows[0]!.publishedHtml = "发布于 2026-02-30"; }],
    ["missing native title", d => { d.pages[0]!.rows[0]!.titleHtml = "<span></span>"; }],
    ["malformed ID", d => { d.pages[0]!.rows[0]!.href = `#/job/${"-".repeat(36)}`; }]
  ];
  it.each(invalidDomCases)("rejects %s before making independent HTTP requests", async (_, change) => {
    const dom = domFixture(); change(dom); let requests = 0;
    const http: MokaHttpClient = async () => { requests++; throw new Error("HTTP must not be called"); };
    expect(() => validateServierDomCapture(dom)).toThrow();
    await expect(captureServierIndependentDetails({ dom, http, now: () => new Date(HTTP_AT) })).rejects.toThrow();
    expect(requests).toBe(0);
  });

  it.each(["2026-10-03T05:00:00.001Z", "2026-10-03T03:59:59.999Z", "2026-10-03T04:00:01.000Z"])("rejects stale or not-yet-completed DOM captures at %s", async nowAt => {
    let requests = 0;
    const http: MokaHttpClient = async () => { requests++; throw new Error("HTTP must not be called"); };
    await expect(captureServierIndependentDetails({ dom: domFixture(), http, now: () => new Date(nowAt) })).rejects.toThrow(/current one-hour run/);
    expect(requests).toBe(0);
  });

  it("does not accept a historical set-audit summary as native DOM capture", () => {
    const summary = { observedAt: OBSERVED_AT, filters: "已选0条件", displayedResultCount: 95,
      uiPageCounts: [30, 30, 30, 5], lastNextButtonDisabled: true, uiPages: [[officialId(1)]] };
    expect(() => validateServierDomCapture(summary as unknown as ServierDomCapture)).toThrow();
  });

  it("requires returned current-request timestamps and never supplies or restamps them", async () => {
    for (const capturedAt of [undefined, OBSERVED_AT, "2026-10-03T04:10:00.002Z"]) {
      await expect(collect({ total: 1, responseChange: response => {
        if (capturedAt === undefined) delete response.capturedAt; else response.capturedAt = capturedAt;
      } })).rejects.toThrow(/receipt/);
    }
  });

  const invalidReplayCases: [string, (pages: OfficialJsonRenderedPageCapture[]) => void][] = [
    ["changed original body", p => { payload(p).detailResponse.body += " "; }],
    ["changed HTTP status", p => { payload(p).detailResponse.status = 503; }],
    ["changed final URL", p => { payload(p).detailResponse.finalUrl += "/"; }],
    ["changed request method", p => { payload(p).detailResponse.method = "GET"; }],
    ["changed detail org request", p => { payload(p).detailResponse.requestBody.orgId = "bayer"; }],
    ["changed detail site request", p => { payload(p).detailResponse.requestBody.siteId = "148387"; }],
    ["changed detail ID request", p => { payload(p).detailResponse.requestBody.jobId = officialId(2); }],
    ["extra hidden detail query", p => { payload(p).detailResponse.requestBody.location = "北京"; }],
    ["detail older than entry", p => { payload(p).detailResponse.capturedAt = OBSERVED_AT; }],
    ["detail clock regression", p => { payload(p, 1).detailResponse.capturedAt = payload(p).entry.capturedAt; }],
    ["detail outside run window", p => { payload(p).detailResponse.capturedAt = "2026-10-03T05:00:00.001Z"; }],
    ["entry before final DOM", p => { payload(p).entry.capturedAt = OBSERVED_AT; }],
    ["missing bootstrap", p => { delete payload(p).entry; }],
    ["extra bootstrap", p => { payload(p, 1).entry = payload(p).entry; }],
    ["wrong bootstrap binding", p => { payload(p).entrySha256 = "0".repeat(64); }],
    ["different row DOM metadata", p => { payload(p, 1).domPage = { ...payload(p, 1).domPage, selectedFilters: ["上海"] }; }],
    ["renamed DOM title", p => { payload(p).domRow.titleHtml = "<span>Other role</span>"; }],
    ["renamed DOM date", p => { payload(p).domRow.publishedHtml = "发布于 2026-09-01"; }],
    ["unknown relabeled mainland", p => { p[0]!.rawRows[0]!.scopeDecision = "INCLUDED_MAINLAND"; }],
    ["unknown relabeled overseas", p => { p[0]!.rawRows[0]!.scopeMarker = "OVERSEAS"; }],
    ["unknown relabeled closed", p => { p[0]!.rawRows[0]!.scopeMarker = "closed"; }],
    ["wrong ID hash", p => { p[0]!.rawRows[0]!.sourceJobId = evidenceId(2); }],
    ["wrong evidence hash", p => { p[0]!.rawRows[0]!.rawEvidenceId = evidenceId(2); }],
    ["wrong row index", p => { p[0]!.rawRows[0]!.recordIndex = 1; }],
    ["wrong channel", p => { p[0]!.channelId = "source:source-bayer-healthcare-social:default"; }],
    ["changed declared total", p => { p[0]!.declaredTotalJobs = 94; }],
    ["changed declared page count", p => { p[0]!.declaredTotalPages = 1; }],
    ["network-list candidate IDs", p => { p[0]!.uiRequestCandidateIds = [evidenceId(1)]; }],
    ["invented terminal flag", p => { p[0]!.nextControlPresent = false; }],
    ["wrong capture path", p => { payload(p).captureMethod = "HTTP_MAIN_LIST"; }],
    ["detail closed", p => { changeDetail(p, d => { d.status = "closed"; }); }],
    ["detail different org", p => { changeDetail(p, d => { d.orgId = "bayer"; }); }],
    ["detail different site", p => { changeDetail(p, d => { d.siteId = "148387"; }); }],
    ["detail different official ID", p => { changeDetail(p, d => { d.id = officialId(2); }); }],
    ["detail different title", p => { changeDetail(p, d => { d.title = "Other role"; }); }],
    ["detail date mismatch", p => { changeDetail(p, d => { d.publishedAt = "2026-09-02T01:00:00"; }); }],
    ["unknown with contradictory location IDs", p => { changeDetail(p, d => { d.locDepCampusList = [{ locationIds: [110000] }]; }); }],
    ["overseas detail", p => { changeDetail(p, d => { d.locations = [{ country: "France" }]; }); }],
    ["missing detail description", p => { changeDetail(p, d => { d.jobDescription = ""; }); }]
  ];
  it.each(invalidReplayCases)("rejects %s without trusting changed commitments", async (_, change) => {
    const { pages } = await collect({ total: 31 }); change(pages);
    expect(() => replayServierHybridTraversal(pages)).toThrow();
  });

  it("rejects duplicate plaintext keys even if the attacker updates the body hash", async () => {
    const { pages } = await collect({ total: 1, plaintext: true });
    const receipt = payload(pages).detailResponse;
    receipt.body = receipt.body.replace('"success":true', '"success":false,"success":true');
    receipt.bodySha256 = hash(receipt.body);
    expect(() => replayServierHybridTraversal(pages)).toThrow(/duplicate/);
  });

  it("rejects duplicate encrypted payload keys", async () => {
    const { pages } = await collect({ total: 1 });
    const receipt = payload(pages).detailResponse;
    const cipher = createCipheriv("aes-128-cbc", Buffer.from(KEY), Buffer.from(IV));
    const source = `{"success":false,"success":true,"data":${JSON.stringify(detail(1))}}`;
    receipt.body = JSON.stringify({ data: cipher.update(source, "utf8", "base64") + cipher.final("base64"), necromancer: KEY });
    receipt.bodySha256 = hash(receipt.body);
    expect(() => replayServierHybridTraversal(pages)).toThrow(/duplicate/);
  });
});

it("accepts the native empty keyword and rejects a real search filter", () => {
  const dom = domFixture();
  for (const page of dom.pages) page.url += `${page.url.includes("?") ? "&" : "?"}keyword=`;
  expect(validateServierDomCapture(dom)).toBe(95);
  dom.pages[0]!.url += "x";
  expect(() => validateServierDomCapture(dom)).toThrow();
});
