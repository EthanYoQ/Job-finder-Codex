import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { runSourceCrawl, type SourceFetchResult } from "../../src/crawler/runSourceCrawl";
import type { PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { replayBiSemanticCompleteness } from "../../src/crawler/biSemanticCompleteness";
import { replayBiUiSemanticContract } from "../../src/crawler/biUiSemanticContract";
import { requiresBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { requiresAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/bi/20261001-exact-evidence.json"), "utf8")) as PersistentSourceFetchEvidence;
const START = "2026-10-01T10:07:02.505Z";
const END = "2026-10-01T10:07:15.329Z";
const plan = () => structuredClone(getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-boehringer-ingelheim-china-social")!);
type Row = Record<string, string>;

async function crawl(options: {
  script?: (body: string) => string;
  rows?: (rows: Row[], root: any) => void;
  body?: (body: string) => string;
  plan?: (plan: SourceCrawlPlan) => void;
  fetched?: (result: Extract<SourceFetchResult, { ok: true }>) => void;
} = {}) {
  const p = plan(); options.plan?.(p);
  let calls = 0;
  const fetch = createOfficialJsonSourceFetch({ now: () => new Date(calls === 0 ? START : END), http: async request => {
    calls++;
    const a = fixture.artifacts[request.url.includes("/scripts/recruit.js") ? 0 : 1]!;
    let body = String(a.body);
    if (request.url.includes("/scripts/recruit.js")) body = options.script?.(body) ?? body;
    else {
      if (options.rows) { const root = JSON.parse(body.slice(13, -1)); options.rows(root.resultbody.joblist, root); body = `jsoncallback(${JSON.stringify(root)})`; }
      body = options.body?.(body) ?? body;
    }
    return { status: 200, body, finalUrl: request.url, capturedAt: a.capturedAt, contentType: a.contentType! };
  } });
  return runSourceCrawl(p, { fetch: async (...args) => { const fetched = await fetch(...args); if (fetched.ok) options.fetched?.(fetched); return fetched; } });
}

describe("BI reconstructed source semantic completeness, not acquisition or formal qualification", () => {
  it("proves the exact retained 44-row capture without executing the script", async () => {
    const result = await crawl();
    expect(result.status).toBe("SUCCESS");
    expect(result.jobs).toHaveLength(44);
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.observation.expectedJobCount).toBe(44);
    expect(result.fetchEvidence!.artifacts.map(a => createHash("sha256").update(String(a.body)).digest("hex"))).toEqual([
      "d15f393b33b9ba30d3de39c3f8be140fcc79fab42224caa0d2e58a591ad2c777",
      "3d27c7755a1068d869cafc60b5f9c31bad60a7f29aee9310660a899ac5001f89"
    ]);
  });
  it("allows new subsidiary IDs and cosmetic names on the unchanged group board", async () => {
    const result = await crawl({ rows: rows => { rows[0]!.coid = "99999999"; rows[0]!.coname = "新增集团子公司"; } });
    expect(result.truth.completenessVerified).toBe(true);
  });
  it("reconciles each actual UI exclusion and persists the UI-visible count", async () => {
    const result = await crawl({ rows: rows => { rows[0]!.jobname = "Intern ID205901"; rows[0]!.jobareaname = "南昌"; rows[0]!.workareaname = "南昌"; rows[0]!.ejobareaname = "Nanchang"; rows[0]!.eworkareaname = "Nanchang"; } });
    expect(result.jobs).toHaveLength(43);
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.observation.expectedJobCount).toBe(43);
  });
  it.each(["上海市·Singapore", "上海HongKong", "香港", "新城市", "上海、北京"])("rejects coherent raw/output unknown full location %s", async location => {
    const result = await crawl({ rows: rows => { rows[0]!.jobareaname = location; rows[0]!.workareaname = location; } });
    expect(result.truth.completenessVerified).toBe(false);
  });
  it.each(["ctmid", "workareaname", "ejobareaname", "eworkareaname"])("rejects contradictory raw coordinate %s", async field => {
    const result = await crawl({ rows: rows => { rows[0]![field] = field === "ctmid" ? "9999" : "Singapore"; } });
    expect(result.truth.completenessVerified).toBe(false);
  });
  it.each([
    (s: string) => `${s}\njobList = [];`,
    (s: string) => s.replace("return !sxsPosCode.some", "return sxsPosCode.some"),
    (s: string) => s.replace('ctmid: "3479"', 'ctmid: "9999"'),
    (s: string) => s.replace("keyword: null", 'keyword: "intern"'),
    (s: string) => s.replace("filteredJobList.length; index++", "filteredJobList.length - 1; index++")
  ])("rejects whole-script, branch, request, or output-loop drift", async script => {
    expect((await crawl({ script })).truth.completenessVerified).toBe(false);
  });
  it("rejects duplicate JSON keys", async () => {
    expect((await crawl({ body: body => body.replace('"status":"1"', '"status":"0","status":"1"') })).truth.completenessVerified).toBe(false);
  });
  it("rejects duplicated raw IDs even if all ledgers are regenerated", async () => {
    expect((await crawl({ rows: rows => { rows[1]!.jobid = rows[0]!.jobid!; } })).truth.completenessVerified).toBe(false);
  });
  it("rejects undeclared response filters and unclosed totals", async () => {
    expect((await crawl({ rows: (_rows, root) => { root.resultbody.hasMore = true; } })).truth.completenessVerified).toBe(false);
    expect((await crawl({ rows: (_rows, root) => { root.resultbody.totalnum = "45"; } })).truth.completenessVerified).toBe(false);
  });
  it.each(["title", "locationRaw", "officialUrl", "cities", "sourceJobId"])("rejects changed normalized field %s", async field => {
    expect((await crawl({ fetched: r => { if ("payload" in r) (r.payload as any).jobs[0][field] = field === "cities" ? ["上海"] : "changed"; } })).truth.completenessVerified).toBe(false);
  });
  it.each([
    (p: any) => { p.source.id = "source-other-social"; },
    (p: any) => { p.company.id = "company-other"; },
    (p: any) => { p.officialJsonFetch.ctmid = "9999"; },
    (p: any) => { p.json.defaultCategory = "研发"; },
    (p: any) => { p.source.officialEntryUrl += "?keyword=intern"; },
    (p: any) => { p.executionAuthority = undefined; }
  ])("rejects source, company, config, filter, or staged authority swaps", async mutate => {
    expect((await crawl({ plan: mutate })).truth.completenessVerified).toBe(false);
  });
  it.each([
    (e: PersistentSourceFetchEvidence) => { e.captureTool.name = "imported"; },
    (e: PersistentSourceFetchEvidence) => { e.artifacts[0]!.httpStatus = 201; },
    (e: PersistentSourceFetchEvidence) => { e.artifacts[1]!.contentType = "image/png"; },
    (e: PersistentSourceFetchEvidence) => { e.artifacts[1]!.extractorLocator += "|hidden-filter"; },
    (e: PersistentSourceFetchEvidence) => { e.artifacts[1]!.capturedAt = "2020-01-01T00:00:00.000Z"; },
    (e: PersistentSourceFetchEvidence) => { e.artifacts[0]!.requestedUrl = "https://example.com/script.js"; }
  ])("rejects unchanged body with invalid capture/request metadata", async mutate => {
    expect((await crawl({ fetched: r => { mutate(r.fetchEvidence!); } })).truth.completenessVerified).toBe(false);
  });
  it("projects the complete pinned AST request and exclusions without evaluating any code", () => {
    expect(replayBiUiSemanticContract(String(fixture.artifacts[0]!.body))).toEqual({
      params: { ctmid: "3479", pagesize: 500, pagenum: 1, sort: "issuedate", sequence: "0",
        keyword: null, jobarea: null, functype: null, divid: null, poscode: null },
      exclusions: [
        {code:"205901",jobareaname:"南昌"}, {code:"204542",jobareaname:"上海"},
        {code:"204542",jobareaname:"北京"}, {code:"204023",jobareaname:"上海"},
        {code:"205909",jobareaname:"上海"}, {code:"206067",jobareaname:"上海"},
        {code:"207401",jobareaname:"上海"}, {code:"205538",jobareaname:"上海"}
      ]
    });
  });
  it("still requires independent B-grade evidence and does not activate A-grade issuance", () => {
    expect(requiresBGradeTraversalCertificate(plan())).toBe(true);
    expect(requiresAGradeOfficialTotalCertificate(plan())).toBe(false);
  });
  it("compares every complete normalized output object including category and capture metadata", async () => {
    const result = await crawl();
    expect(replayBiSemanticCompleteness(plan(), result.fetchEvidence!, result.jobs, START)).toBeDefined();
    for (const mutation of [
      (j: any) => { j.category = "医学事务"; },
      (j: any) => { j.companyId = "company-other"; },
      (j: any) => { j.officialChineseCompanyName = "other"; },
      (j: any) => { j.sourceKind = "CAMPUS"; },
      (j: any) => { j.listUrl = "https://example.com"; },
      (j: any) => { j.auxiliaryChineseTitle = "invented"; },
      (j: any) => { j.officialPublishedAt = "2026-01-01T00:00:00.000Z"; },
      (j: any) => { j.evidence.capturedAt = END; },
      (j: any) => { j.evidence.rawSnapshotRef = "unbound"; }
    ]) {
      const jobs = structuredClone(result.jobs); mutation(jobs[0]);
      expect(replayBiSemanticCompleteness(plan(), result.fetchEvidence!, jobs, START)).toBeUndefined();
    }
  });
  it("rejects a coherent extra exclusion/count receipt against unchanged raw bytes", async () => {
    const result = await crawl({ rows: rows => {
      rows[0]!.jobname = "Intern ID204542"; // The actual Beijing exclusion
    } });
    expect(result.truth.completenessVerified).toBe(true);
    const e = structuredClone(result.fetchEvidence!);
    e.fetchCounts.rawCount++; e.fetchCounts.parsedCount++; e.fetchCounts.validationDiscardCount++;
    e.declaredCompleteness!.value++;
    e.pages[0]!.declaredTotal!++; e.pages[0]!.declaredCount!++;
    e.fetchLosses.push({ ...structuredClone(e.fetchLosses[0]!), details: { code: "OFFICIAL_UI_EXCLUSION", recordIndex: 44 } });
    expect(replayBiSemanticCompleteness(plan(), e, result.jobs, START)).toBeUndefined();
  });
  it("rejects missing artifacts, repeated pages, redacted bytes and forged loss indexes", async () => {
    const result = await crawl({ rows: rows => { rows[0]!.jobname = "Intern ID204542"; } });
    expect(result.truth.completenessVerified).toBe(true);
    for (const mutate of [
      (e: PersistentSourceFetchEvidence) => { e.artifacts.pop(); },
      (e: PersistentSourceFetchEvidence) => { e.pages.push(structuredClone(e.pages[0]!)); },
      (e: PersistentSourceFetchEvidence) => { e.artifacts[1]!.bodyRepresentation = "REDACTED"; },
      (e: PersistentSourceFetchEvidence) => { e.fetchLosses[0]!.details!.recordIndex = 1; },
      (e: PersistentSourceFetchEvidence) => { e.pages[0]!.rawJobIds[0] = "sha256:unknown"; },
      (e: PersistentSourceFetchEvidence) => { e.pages[0]!.validJobIds[0] = "sha256:unknown"; }
    ]) {
      const e = structuredClone(result.fetchEvidence!); mutate(e);
      expect(replayBiSemanticCompleteness(plan(), e, result.jobs, START)).toBeUndefined();
    }
  });
  it("does not reinterpret an error/empty payload as an explicit official zero", async () => {
    expect((await crawl({ body: () => 'jsoncallback({"status":"0","message":"error","resultbody":{"totalnum":"0","joblist":[]}})' })).truth.completenessVerified).toBe(false);
    expect((await crawl({ body: () => 'jsoncallback({"status":"1","message":"接口调用成功","resultbody":{"joblist":[]}})' })).truth.completenessVerified).toBe(false);
  });
});
