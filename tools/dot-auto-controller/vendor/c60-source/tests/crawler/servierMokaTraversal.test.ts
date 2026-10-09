import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { canonicalStringSetSha256, sha256Bytes } from "../../src/crawler/sourceFetchEvidence";
import { executeAtomicSourceEvidenceCommit } from "../../src/db/ingestionRepository";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import type { ArchivedEvidenceArtifact } from "../../src/crawler/artifactArchive";
import { createMokaSourceFetch, type MokaHttpClient } from "../../src/crawler/mokaSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { assertServierUnknownLifecyclePreserved, isServierTraversalPlan, replayServierTraversal, servierIndependentDetailScope, servierDetailScope,
  SERVIER_MOKA_ENTRY, SERVIER_MOKA_DETAIL, SERVIER_UNKNOWN_CODE } from "../../src/crawler/servierMokaScope";
import { captureServierIndependentDetails, type ServierDomCapture } from "../../src/crawler/servierMokaRenderedTraversal";
import { createOfficialJsonRenderedTraversalValidation, issueBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { assertBGradePublicSnapshot } from "../helpers/assertBGradePublicSnapshot";

const NOW = "2026-10-03T05:00:00.000Z", IV = "0123456789abcdef", KEY = "abcdef0123456789";
const plan = () => buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-servier-china-social")!;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const eid = (n: number) => `sha256:${createHash("sha256").update(JSON.stringify(id(n))).digest("hex")}`;
const row = (n: number) => ({id: id(n), orgId: "shiweiya", title: `职位 ${n}`, status: "open", publishedAt: "2026-10-03T12:00:00", showIsCampus: false});
const detail = (n: number) => ({...row(n), showIsCampus: true, jobDescription: "真实公开职责要求内容用于完整正文的合成测试，不作为生产证据。", closedAt: null,
  locations: n === 1 ? [] : [{country: "中国", countryDescription: "中国", cityName: "北京市", cityId: 110000, provinceName: "北京市"}],
  locDepCampusList: [{locationIds: n === 1 ? [] : [1]}], customFields: {}});
function encrypted(data: unknown) {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(KEY), Buffer.from(IV));
  return JSON.stringify({data: cipher.update(JSON.stringify(data), "utf8", "base64") + cipher.final("base64"), necromancer: KEY});
}
async function collect(count = 3, mutate?: (details: ReturnType<typeof detail>[]) => void) {
  const rows = Array.from({length: count}, (_, n) => row(n + 1));
  const details = Array.from({length: count}, (_, n) => detail(n + 1)); mutate?.(details);
  const requests: Parameters<MokaHttpClient>[0][] = [];
  const http: MokaHttpClient = async request => {
    requests.push(request);
    const offset = Number(request.body?.offset ?? 0);
    const body = request.method === "GET" ? `<input id="init-data" value='${JSON.stringify({aesIv: IV, mode: "social", siteId: "47734", org: {id: "shiweiya"}})}'>`
      : request.url.endsWith("jobs/v2") ? encrypted({success: true, data: {jobStats: {orgId: "shiweiya", total: count}, jobs: rows.slice(offset, offset + 50)}})
      : encrypted({success: true, data: details.find(d => d.id === request.body?.jobId)});
    return {status: 200, body, finalUrl: request.url, contentType: request.method === "GET" ? "text/html" : "application/json", capturedAt: NOW};
  };
  const p = plan(), fetched = await createMokaSourceFetch({http, now: () => new Date(NOW)})(p);
  const result = await runSourceCrawl(p, {fetch: async () => fetched});
  return {rows, details, requests, http, fetched, result, plan: p};
}
function dom(rows: ReturnType<typeof row>[]): ServierDomCapture {
  return {schemaVersion: "servier-cua-dom-list-v1", observedAt: NOW, pages: Array.from({length: Math.ceil(rows.length / 30)}, (_, index) => ({
    url: `${SERVIER_MOKA_ENTRY}#/jobs?page=${index + 1}&pageSize=30`, capturedAt: NOW,
    summaryText: `已选 0 条件 | ${rows.length} 结果`, pageNumber: index + 1, pageSize: 30,
    nextDisabled: index === Math.ceil(rows.length / 30) - 1, selectedFilters: [],
    paginationHtml: `<button class="sd-Pagination-is-active">${index + 1}</button><button class="sd-Pagination-forward"${index === Math.ceil(rows.length / 30) - 1 ? " disabled" : ""}></button>`,
    rows: rows.slice(index * 30, (index + 1) * 30).map(r => ({href: `#/job/${r.id}`, titleHtml: `<span>${r.title}</span>`, publishedHtml: "<span>发布于 2026-10-03</span>"}))
  }))};
}

describe("Servier bounded open portal B integration", () => {
  it("keeps all 95 raw identities, publishes 94 China jobs and accounts for one open UNKNOWN without changing the denominator", async () => {
    const f = await collect(95);
    expect(f.fetched.ok, !f.fetched.ok ? f.fetched.failureReason : undefined).toBe(true);
    expect(f.result.truth).toEqual({transportSuccess: true, adapterSuccess: true, completenessVerified: true});
    expect(f.result.fetchEvidence?.fetchCounts).toEqual({rawCount: 95, parsedCount: 95, validCount: 94, parseDiscardCount: 0, validationDiscardCount: 1});
    expect(f.result.fetchEvidence?.pages.map(p => [p.rawJobIds.length, p.declaredTotal])).toEqual([[50, 95], [45, 95]]);
    expect(f.result.observation.expectedJobCount).toBeUndefined();
    expect(f.result.observation.completenessEvidenceKind).toBe("COMPLETE_PAGE_TRAVERSAL");
    expect(f.result.fetchEvidence?.fetchLosses[0]).toMatchObject({stage: "VALIDATION", details: {code: SERVIER_UNKNOWN_CODE, field: "locations", noteCode: "OFFICIAL_STATUS_OPEN_GEOGRAPHY_PENDING"}});
    expect(f.requests.filter(r => r.url === SERVIER_MOKA_DETAIL)).toHaveLength(95);
    expect(f.result.jobs).toHaveLength(94);
    expect(f.result.jobs.some(j => j.sourceJobId === eid(1))).toBe(false);
    expect(replayServierTraversal(f.plan, f.result.fetchEvidence!, f.result.jobs)).toEqual({excludedCount: 1, unknownOfficialIds: [id(1)]});
  });
  it("issues the existing B v2 proof from independent complete DOM and new details, retaining raw/pending set hashes", async () => {
    const f = await collect(4), before = f.requests.length;
    const captured = await captureServierIndependentDetails({dom: dom(f.rows), http: f.http, now: () => new Date(NOW)});
    expect(f.requests.slice(before).filter(r => r.url === SERVIER_MOKA_DETAIL)).toHaveLength(4);
    const validation = createOfficialJsonRenderedTraversalValidation({sourceId: f.plan.source.id as "source-servier-china-social", companyId: f.plan.company.id,
      sourceConfigSha256: sourcePlanConfigSha256(f.plan), surfaceIds: [f.plan.source.surfaceId!], channelIds: f.plan.expectedChannels!.map(c => c.channelId),
      pages: captured.pages, observedAt: NOW, expiresAt: "2026-10-04T05:00:00.000Z"});
    const decision = issueBGradeTraversalCertificate({plan: f.plan, binding: {releaseCandidateId: "rc-test", batchId: "batch-test", sourceResultId: "source-result-test", sourceConfigSha256: sourcePlanConfigSha256(f.plan)},
      transportSuccess: true, adapterSuccess: true, evidence: f.result.fetchEvidence!, paginationEvaluation: f.result.paginationEvaluation!, reconciliation: f.result.reconciliation!,
      jobs: f.result.jobs, independentValidation: validation, validationExecution: "CURRENT_RUN", trigger: "INITIAL_QUALIFICATION", now: new Date(NOW)});
    expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
    if (decision.status !== "CERTIFIED") throw Error("B fixture did not certify");
    expect(decision.certificate.counts).toMatchObject({mainUniqueJobCount: 3, finalUniqueJobCount: 3, validationDiscardCount: 1});
    await assertBGradePublicSnapshot(f.plan, f.result, decision.certificate);
    const sha = "a".repeat(64), batchId = "servier-atomic-test";
    const identity = {releaseCandidateId: "servier-rc-test", commitSha: "a".repeat(40), rosterSha256: sha, sourcePlanSha256: sha,
      sourceConfigSha256: sha, adapterBundleSha256: sha, batchKind: "SCHEDULED" as const, ownerId: "servier-test", expectedPlannedSourceIds: [f.plan.source.id],
      expectedPlannedSourceSetSha256: canonicalStringSetSha256([f.plan.source.id]), expectedPlannedSourceCount: 1};
    const pending = buildPendingRuntimeBatch(batchId, [f.plan], identity, new Date(NOW)).sources[0]!;
    const artifacts: ArchivedEvidenceArtifact[] = f.result.fetchEvidence!.artifacts.map(a => ({
      id: a.id, logicalKey: a.logicalKey, releaseCandidateId: identity.releaseCandidateId, batchId, sourceId: f.plan.source.id, sourceResultId: pending.id,
      kind: a.kind, ...(a.requestedUrl ? {requestedUrl: a.requestedUrl} : {}), ...(a.finalUrl ? {finalUrl: a.finalUrl} : {}),
      ...(a.httpStatus ? {httpStatus: a.httpStatus} : {}), ...(a.contentType ? {contentType: a.contentType} : {}),
      capturedAt: new Date(a.capturedAt), ...sha256Bytes(typeof a.body === "string" ? Buffer.from(a.body) : a.body),
      path: `outputs/p0-rc/servier-test/${a.logicalKey}.json`, extractorLocator: a.extractorLocator,
      captureToolName: f.result.fetchEvidence!.captureTool.name, captureToolVersion: f.result.fetchEvidence!.captureTool.version
    }));
    const input = {plan: f.plan, pending, identity, batchId, result: f.result, artifacts, previousJobs: [], baselineCompletedBeforeCrawl: false,
      independentTraversalValidation: validation, independentTraversalValidationExecution: "CURRENT_RUN" as const,
      independentTraversalValidationTrigger: "INITIAL_QUALIFICATION" as const, completedAt: new Date(NOW)};
    const commit = buildAtomicRuntimeCommit(input);
    expect(commit.sourceResult).toMatchObject({completenessState: "VERIFIED", completenessCertificate: {grade: "B"},
      expectedEvidenceKind: "COMPLETE_PAGE_TRAVERSAL", expectedJobCount: null, rawCount: 4, validCount: 3, validationDiscardCount: 1});
    expect(commit.lossLedger).toHaveLength(1);
    const transaction = vi.fn(async () => {throw Error("SYNTHETIC_TRANSACTION_REACHED");});
    await expect(executeAtomicSourceEvidenceCommit(commit, {$transaction: transaction} as never)).rejects.toThrow("SYNTHETIC_TRANSACTION_REACHED");
    expect(transaction).toHaveBeenCalledOnce();
    const prior = {...f.result.jobs[0]!, sourceJobId: eid(1), officialUrl: `${SERVIER_MOKA_ENTRY}#/job/${id(1)}`};
    expect(() => buildAtomicRuntimeCommit({...input, previousJobs: [{dedupeKey: buildJobDedupeKey(prior), record: prior,
      lifecycleStatus: "ACTIVE", missingSuccessfulCrawlCount: 0, firstSeenAt: NOW, lastSeenAt: NOW}]}))
      .toThrow("SERVIER_PREVIOUS_JOB_GEOGRAPHY_UNKNOWN_PRESERVE_LAST_GOOD");

  });
  it("rejects a previously stored job becoming geography-unknown before lifecycle can count it missing", async () => {
    const f = await collect();
    expect(() => assertServierUnknownLifecyclePreserved(f.plan, f.result.fetchEvidence!, f.result.jobs)).not.toThrow();
    const previous = {...f.result.jobs[0]!, sourceJobId: eid(1), officialUrl: `${SERVIER_MOKA_ENTRY}#/job/${id(1)}`};
    expect(() => assertServierUnknownLifecyclePreserved(f.plan, f.result.fetchEvidence!, [previous])).toThrow("SERVIER_PREVIOUS_JOB_GEOGRAPHY_UNKNOWN_PRESERVE_LAST_GOOD");
    expect(() => assertServierUnknownLifecyclePreserved(f.plan, f.result.fetchEvidence!, [{...previous, sourceJobId: "legacy-id"}])).toThrow("SERVIER_PREVIOUS_JOB_GEOGRAPHY_UNKNOWN_PRESERVE_LAST_GOOD");
  });
  it.each(["total", "request", "rawId", "lossIndex", "lossCode", "country", "status", "unknownId", "artifact", "outputCity", "outputDate"])("rejects tampered %s source evidence", async kind => {
    const f = await collect(), evidence = structuredClone(f.result.fetchEvidence!), jobs = structuredClone(f.result.jobs);
    if (kind === "total") evidence.pages[0]!.declaredTotal = 2;
    if (kind === "request") evidence.artifacts[1]!.extractorLocator += "changed";
    if (kind === "rawId") evidence.pages[0]!.rawJobIds.pop();
    if (kind === "lossIndex") evidence.fetchLosses[0]!.details.recordIndex = 1;
    if (kind === "lossCode") evidence.fetchLosses[0]!.details.code = "OUT_OF_SCOPE";
    if (kind === "country") evidence.fetchLosses[0]!.details.code = "SERVIER_WORKPLACE_COUNTRY_FOREIGN";
    if (kind === "status") evidence.fetchLosses[0]!.details.noteCode = "OFFICIAL_STATUS_CLOSED";
    if (kind === "unknownId") evidence.fetchLosses[0]!.rawLocator += "wrong-id";
    if (kind === "artifact") evidence.artifacts.pop();
    if (kind === "outputCity") jobs[0]!.cities = ["上海"];
    if (kind === "outputDate") jobs[0]!.officialPublishedAt = NOW;
    expect(replayServierTraversal(f.plan, evidence, jobs)).toBeUndefined();
  });
  it.each(["closed", "foreign", "conflictingLocationIds", "hiddenCountry", "blankBody", "wrongOrg"])("fails closed on %s detail instead of treating it as the reviewed UNKNOWN case", async kind => {
    const f = await collect(3, details => {
      const d = details[0]! as any;
      if (kind === "closed") d.status = "closed";
      if (kind === "foreign") d.locations = [{country: "France", cityName: "Paris"}];
      if (kind === "conflictingLocationIds") d.locDepCampusList = [{locationIds: [1]}];
      if (kind === "hiddenCountry") d.customFields = {x: {name: "国家", value: "France"}};
      if (kind === "blankBody") d.jobDescription = "";
      if (kind === "wrongOrg") d.orgId = "other";
    });
    expect(f.result.truth.completenessVerified).toBe(false);
  });
  it("rejects explicit list/detail location or closure conflicts and contradictory district IDs", () => {
    expect(() => servierDetailScope({...row(1), locations: [{country: "France", cityName: "Paris"}]}, detail(1))).toThrow();
    expect(() => servierDetailScope({...row(1), closedAt: NOW}, detail(1))).toThrow();
    for (const [cityName, cityId, provinceName, provinceId] of [["朝阳区", 110105, "北京市", 110000], ["下城区（旧）", 330103, "浙江", 330000]] as const) {
      const d = {...detail(2), locations: [{country: "中国", cityName, cityId, provinceName, provinceId}]};
      expect(servierIndependentDetailScope({id: id(2), title: row(2).title}, d).unknownGeography).toBe(false);
      d.locations[0]!.provinceId = 310000 as typeof provinceId;
      expect(() => servierIndependentDetailScope({id: id(2), title: row(2).title}, d)).toThrow();
    }
  });
  it("binds only the existing official Servier47734 plan and does not infer a country from JD remit", () => {
    expect(isServierTraversalPlan(plan())).toBe(true);
    const changed = structuredClone(plan()); changed.source.officialEntryUrl += "#/other";
    expect(isServierTraversalPlan(changed)).toBe(false);
    expect(servierIndependentDetailScope({id: id(1), title: row(1).title}, {...detail(1), jobDescription: "Responsibilities cover research in China and worldwide; this is not a workplace."})).toMatchObject({unknownGeography: true, locations: []});
  });
});
