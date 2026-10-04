// @vitest-environment node
import { describe, expect, it } from "vitest";
import { collectQiluMainPartitions } from "../../src/crawler/qiluDualPartitionMainCapture";
import { runWithOfficialSourceAttemptTimeout } from "../../src/crawler/officialHttpRuntimeLimits";

const now = () => new Date("2026-10-01T09:00:00.000Z");
const marketingUrl = "https://www.qilu-pharma.com/JobPosting_list.html";
const apiUrl = "https://qilu-pharma.zhiye.com/api/Jobad/GetJobAdPageList";
const marketingHtml = `<a href="https://qilu-pharma.zhiye.com/social">社会招聘（非营销类）</a>
<div class="e_loop-65"><div class="cbox-65 p_loopitem"><div class="e_text-83"><a href="/JobPosting_Detail/c-_detailId%3D12345.html">Synthetic marketing role</a></div><div class="e_text-86">山东省</div></div></div><div class="p_page"><a class="page_next disabled">下一页</a></div>`;
const rows = [
  { Id: "00000000-0000-4000-8000-000000000001", JobAdId: 1, JobAdName: "Synthetic non-marketing role", CategoryId: "1", Category: "社会招聘", Status: 1, LocNames: ["山东省·济南市"] },
  { Id: "00000000-0000-4000-8000-000000000002", JobAdId: 2, JobAdName: "Synthetic overseas role", CategoryId: "1", Category: "社会招聘", Status: 1, LocNames: ["美国"] }
];
function clients(marketingStatus = 200, nonMarketingStatus = 200) {
  const requests: string[] = [];
  return {
    requests,
    marketingHttp: async (request: { url: string }) => { requests.push(request.url); return { status: marketingStatus, body: marketingHtml, finalUrl: marketingUrl, contentType: "text/html", capturedAt: now().toISOString() }; },
    nonMarketingHttp: async (request: { url: string; body?: string }) => {
      requests.push(request.url); const body = JSON.parse(request.body ?? "{}");
      expect(body).toEqual({ PageIndex: 0, PageSize: 15, Category: ["1"], KeyWords: "", SpecialType: 0, PortalId: "", DisplayFields: ["Category", "LocId", "Org", "PostDate", "WorkWeChatQrCode"] });
      return { status: nonMarketingStatus, body: JSON.stringify({ Code: 200, Count: 2, Data: rows }), finalUrl: apiUrl, contentType: "application/json", capturedAt: now().toISOString() };
    }
  };
}

describe("Qilu required main partitions", () => {
  it("collects both existing drivers sequentially under one company/source", async () => {
    const deps = clients(); const result = await collectQiluMainPartitions({ ...deps, now });
    expect(deps.requests).toEqual([marketingUrl, apiUrl]);
    expect(result.state).toBe("COLLECTED"); expect(result.qualificationEligible).toBe(false);
    expect(result.partitions.map((partition) => partition.partitionId)).toEqual(["qilu-marketing", "qilu-non-marketing"]);
    expect(result.candidateRecords).toHaveLength(2);
    expect(new Set(result.candidateRecords.map((job) => job.sourceId))).toEqual(new Set(["source-qilu-social"]));
    expect(result.rawObservationCount).toBe(3); expect(result.scopeDiscardCount).toBe(1);
    expect(result).not.toHaveProperty("officialTotal"); expect(result).not.toHaveProperty("certificate");
    expect(result.crossPartitionEquivalence).toBe("NOT_ESTABLISHED");
  });
  it.each([[503, 200], [200, 503]])("does not expose a successful subset when a required partition fails (%i/%i)", async (marketingStatus, nonMarketingStatus) => {
    const result = await collectQiluMainPartitions({ ...clients(marketingStatus, nonMarketingStatus), now });
    expect(result.state).toBe("INCOMPLETE"); expect(result.candidateRecords).toEqual([]);
    expect(result.partitions).toHaveLength(2); expect(result.qualificationEligible).toBe(false);
  });
  it("requires the captured marketing page to link the non-marketing social route", async () => {
    const deps = clients(); deps.marketingHttp = async () => ({ status: 200, body: marketingHtml.replace('href="https://qilu-pharma.zhiye.com/social"', 'href="https://qilu-pharma.zhiye.com/campus"'), finalUrl: marketingUrl, contentType: "text/html", capturedAt: now().toISOString() });
    const result = await collectQiluMainPartitions({ ...deps, now });
    expect(result.state).toBe("INCOMPLETE"); expect(result.failureCodes).toContain("QILU_NONMARKETING_OFFICIAL_CHAIN_MISSING");
  });
  it("does not turn a first-page prefix into a collected source", async () => {
    const deps = clients(); deps.nonMarketingHttp = async () => ({ status: 200, body: JSON.stringify({ Code: 200, Count: 16, Data: rows }), finalUrl: apiUrl, contentType: "application/json", capturedAt: now().toISOString() });
    const result = await collectQiluMainPartitions({ ...deps, now });
    expect(result.state).toBe("INCOMPLETE"); expect(result.candidateRecords).toEqual([]);
  });
  it("honors an inherited cancellation before starting the second partition", async () => {
    const deps = clients(); const first = deps.marketingHttp;
    deps.marketingHttp = async (request) => { await new Promise((resolve) => setTimeout(resolve, 30)); return first(request); };
    let pending: ReturnType<typeof collectQiluMainPartitions> | undefined;
    await expect(runWithOfficialSourceAttemptTimeout(() => { pending = collectQiluMainPartitions({ ...deps, now }); return pending; }, 5)).rejects.toThrow("Official source attempt exceeded");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(deps.requests).toEqual([marketingUrl]);
    expect((await pending)!.partitions.map((partition) => partition.state)).toEqual(["ABORTED", "NOT_ATTEMPTED"]);
  });
  it("keeps matching titles at different official URLs as separate records", async () => {
    const deps = clients(); deps.nonMarketingHttp = async () => ({ status: 200, body: JSON.stringify({ Code: 200, Count: 2, Data: [{ ...rows[0], JobAdName: "Synthetic marketing role" }, rows[1]] }), finalUrl: apiUrl, contentType: "application/json", capturedAt: now().toISOString() });
    const result = await collectQiluMainPartitions({ ...deps, now });
    expect(result.state).toBe("COLLECTED"); expect(result.candidateRecords).toHaveLength(2);
    expect(new Set(result.candidateRecords.map((job) => job.officialUrl)).size).toBe(2);
  });
  it("does not accept ambiguous-geography loss as reviewed foreign exclusion", async () => {
    const deps = clients(); deps.nonMarketingHttp = async () => ({ status: 200, body: JSON.stringify({ Code: 200, Count: 2, Data: [rows[0], { ...rows[1], LocNames: ["APAC"] }] }), finalUrl: apiUrl, contentType: "application/json", capturedAt: now().toISOString() });
    const result = await collectQiluMainPartitions({ ...deps, now });
    expect(result.state).toBe("INCOMPLETE"); expect(result.candidateRecords).toEqual([]);
  });
  it("does not accept an out-of-scope country outside the Qilu reviewed exclusion rule", async () => {
    const deps = clients(); deps.nonMarketingHttp = async () => ({ status: 200, body: JSON.stringify({ Code: 200, Count: 2, Data: [rows[0], { ...rows[1], LocNames: ["日本"] }] }), finalUrl: apiUrl, contentType: "application/json", capturedAt: now().toISOString() });
    const result = await collectQiluMainPartitions({ ...deps, now });
    expect(result.state).toBe("INCOMPLETE"); expect(result.candidateRecords).toEqual([]);
  });
  it("rejects a marketing job URL outside the reviewed official detail namespace", async () => {
    const deps = clients(); deps.marketingHttp = async () => ({ status: 200, body: marketingHtml.replace('/JobPosting_Detail/c-_detailId%3D12345.html', 'https://example.invalid/job/12345'), finalUrl: marketingUrl, contentType: "text/html", capturedAt: now().toISOString() });
    const result = await collectQiluMainPartitions({ ...deps, now });
    expect(result.state).toBe("INCOMPLETE"); expect(result.candidateRecords).toEqual([]);
    expect(result.failureCodes).toContain("QILU_MARKETING_JOB_IDENTITY_INVALID");
  });
});
