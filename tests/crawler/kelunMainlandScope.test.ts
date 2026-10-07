// @vitest-environment node
/** Every title, ID, location row and browser observation below is invented.
 * No network, production SQL or live evidence is used. */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSyntheticKelunQuality, buildSyntheticKelunAtomicFixture, syntheticKelunRow as row, syntheticKelunPage as page } from "../helpers/kelunQualityFixture";
import { classifyKelunLocation, inspectKelunScopeRows, kelunScopeCounts, replayKelunMainlandScope, KELUN_CONFIG_SHA256 } from "../../src/crawler/kelunMainlandScope";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import { replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";
import { issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "../../src/crawler/sourceQualityAdmission";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { bGradeTraversalValidationMatchesCurrentJobs, createPlanBoundHtmlBrowserTraversalValidation, requiresBGradeTraversalCertificate, issueBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { sha256Bytes } from "../../src/crawler/sourceFetchEvidence";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function capture(bodies = [page([row("990010001", "四川省-成都市-青羊区"), row("990010002", "香港"), row("990010003", "北京市,上海市")])]) {
  const root = await mkdtemp(join(tmpdir(), "kelun-mainland-synthetic-")); dirs.push(root);
  return captureSyntheticKelunQuality(root, bodies);
}
function proof(input: Awaited<ReturnType<typeof capture>>, evidence = input.result.fetchEvidence!, jobs = input.result.jobs) {
  if (input.plan.adapterId !== "html-table") throw Error("PLAN");
  return validateStrictHtmlCompletenessProof(input.plan, evidence, jobs);
}
function replay(input: Awaited<ReturnType<typeof capture>>, evidence = input.result.fetchEvidence!, jobs = input.result.jobs) {
  return replayStrictSourceQualityEvidence({plan: input.plan, evidence, jobs, reconciliation: input.result.reconciliation!,
    paginationEvaluation: input.result.paginationEvaluation!, capturedAt: input.result.observation.crawledAt.toISOString()});
}

describe("Kelun source-bound mainland partition", () => {
  it.each(["四川省-成都市-青羊区", "四川省·成都市", "上海市", "北京市,四川省-成都市,上海市,浙江省-杭州市", "广东省", "中国-湖北省-武汉市"])("proves reviewed mainland %s", value => expect(classifyKelunLocation(value)).toBe("MAINLAND"));
  it.each(["香港", "中国-香港", "Hong Kong", "澳门", "澳門", "台湾", "Taiwan", "新加坡", "美国", "香港,澳门"])("excludes explicit outside %s", value => expect(classifyKelunLocation(value)).toBe("EXPLICIT_OUTSIDE"));
  it.each(["", "中国", "China", "全国", "待定", "远程", "上海市,香港", "香港,未知", "四川省-广州市", "四川省-成都市-未知区", "广东省-香港", "香港-深圳", "上海市-日本", "四川省-成都市...", "上海市,"])("holds ambiguous or conflicting %s", value => expect(classifyKelunLocation(value)).toBe("UNKNOWN"));

  it("retains full originals and positions; changes only the adapter-facing subset and existing exclusion ledger", async () => {
    const bodies = [page([row("990010001", "四川省-成都市-青羊区"), row("990010002", "香港"), row("990010003", "北京市,上海市")])];
    const input = await capture(bodies), evidence = input.result.fetchEvidence!;
    expect(input.requests).toHaveLength(1); expect(input.requests[0]!.url).toBe(input.plan.source.officialEntryUrl);
    expect(sourcePlanConfigSha256(input.plan)).toBe(KELUN_CONFIG_SHA256);
    expect(input.result.truth).toEqual({transportSuccess: true, adapterSuccess: true, completenessVerified: true});
    expect(evidence.artifacts.map(a => a.body)).toEqual(bodies);
    expect(kelunScopeCounts(inspectKelunScopeRows(input.plan, evidence))).toEqual({rawCount: 3, mainlandCount: 2, outsideCount: 1, unknownCount: 0});
    expect(evidence.fetchCounts).toEqual({rawCount: 3, parsedCount: 3, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 1});
    expect(evidence.pages[0]!.rawJobIds).toHaveLength(3); expect(evidence.pages[0]!.validJobIds).toHaveLength(2);
    expect(evidence.declaredCompleteness).toMatchObject({kind: "OFFICIAL_TOTAL_PAGES", value: 1});
    expect(evidence.fetchLosses[0]).toMatchObject({details: {code: "KELUN_EXPLICIT_OUTSIDE_MAINLAND", pageSequence: 0, recordIndex: 1}});
    expect(evidence.fetchLosses[0]!.rawLocator).toContain("row:1;id:990010002;html-row:sha256:");
    expect(input.result.jobs.map(j => j.sourceJobId)).toEqual(["990010001", "990010003"]);
    expect(replay(input)).toBe(true);
    const {admission, commit} = await buildSyntheticKelunAtomicFixture(input);
    expect(admission.receipt.counts).toMatchObject({rawCount: 3, validCount: 2, validationDiscardCount: 1, finalUniqueJobCount: 2});
    expect(admission.receipt.declaredCompleteness.value).toBe(1);
    expect(commit.lossLedger).toHaveLength(1);
    expect(() => verifySourceQualityAtomicCommit({plan: input.plan, commit})).not.toThrow();
  });

  it("keeps all pages, source filter, original ID sets and page-local positions across exclusions", async () => {
    const bodies = [page([row("990020001", "香港")], 3), page([row("990020002", "上海市"), row("990020003", "澳门")], 3), page([row("990020004", "北京市")], 3)];
    const input = await capture(bodies), evidence = input.result.fetchEvidence!;
    expect(input.requests).toHaveLength(3); expect(input.requests.every(r => new URL(r.url).searchParams.get("p") === "1^2")).toBe(true);
    expect(evidence.artifacts.map(a => a.body)).toEqual(bodies); expect(evidence.declaredCompleteness!.value).toBe(3);
    expect(evidence.pages.map(p => p.rawJobIds.length)).toEqual([1,2,1]); expect(evidence.pages.map(p => p.validJobIds.length)).toEqual([0,1,1]);
    expect(evidence.fetchLosses.map(l => [l.details.pageSequence, l.details.recordIndex])).toEqual([[0,0],[1,1]]);
    expect(proof(input)).toBe(true); expect(replay(input)).toBe(true);
  });

  it("preserves canonical detail query context without changing or dropping its parameters", async () => {
    const first = page([row("990025001", "上海市")], 2).replace('/job_show/990025001', '/job_show/990025001?r=&p=1%5E2&c=&d=&k=');
    const second = page([row("990025002", "北京市"), row("990025003", "香港")], 2)
      .replace('/job_show/990025002', '/job_show/990025002?p=1%5E2&PageIndex=2')
      .replace('/job_show/990025003', '/job_show/990025003?p=1%5E2&PageIndex=2');
    const input = await capture([first, second]);
    expect(proof(input)).toBe(true);
    expect(input.result.jobs.map(j => j.officialUrl)).toEqual([
      'https://kelun.zhiye.com/job_show/990025001?r=&p=1%5E2&c=&d=&k=',
      'https://kelun.zhiye.com/job_show/990025002?p=1%5E2&PageIndex=2'
    ]);
    const wrong = await capture([first, second.replaceAll('p=1%5E2&PageIndex=2', 'p=1%5E3&PageIndex=2')]);
    expect(wrong.result.truth.completenessVerified).toBe(false);
  });

  it("proves a zero mainland subset only from a nonempty, completely enumerated outside set", async () => {
    const input = await capture([page([row("990030001", "香港"), row("990030002", "美国")])]);
    expect(input.result.truth.completenessVerified).toBe(true); expect(input.result.jobs).toEqual([]);
    expect(input.result.fetchEvidence!.fetchCounts).toMatchObject({rawCount: 2, validCount: 0, validationDiscardCount: 2});
    const {admission} = await buildSyntheticKelunAtomicFixture(input);
    expect(admission.receipt.declaredCompleteness).toMatchObject({kind: "OFFICIAL_TOTAL_PAGES", value: 1});
    expect(admission.receipt.observation.expectedJobCount).toBeNull();
    const empty = await capture([page([])]); expect(empty.result.truth.completenessVerified).toBe(false);
    expect((await issueSourceQualityAdmission(empty)).status).toBe("REJECTED");
  });

  it.each(["ledgerOmitted", "ledgerForgedReason", "ledgerForgedId", "ledgerWrongIndex", "lossCount", "validIds", "missingPage", "missingMiddlePage", "changedPageFilter", "changedDeclaredTotal", "changedLocation", "changedOutputId", "omittedMainland", "outsidePromoted"])("rejects %s independently", async mutation => {
    const input = await capture(), evidence = structuredClone(input.result.fetchEvidence!);
    const jobs: NormalizedJobRecord[] = structuredClone(input.result.jobs);
    if (mutation === "ledgerOmitted") evidence.fetchLosses = [];
    if (mutation === "ledgerForgedReason") evidence.fetchLosses[0]!.details.code = "KELUN_GEOGRAPHY_UNKNOWN";
    if (mutation === "ledgerForgedId") evidence.fetchLosses[0]!.rawLocator = evidence.fetchLosses[0]!.rawLocator.replace("990010002", "990010001");
    if (mutation === "ledgerWrongIndex") evidence.fetchLosses[0]!.details.recordIndex = 0;
    if (mutation === "lossCount") evidence.fetchCounts.validCount = 3;
    if (mutation === "validIds") evidence.pages[0]!.validJobIds = [...evidence.pages[0]!.rawJobIds];
    if (mutation === "missingPage") evidence.artifacts = [];
    if (mutation === "missingMiddlePage") {
      const multi = await capture([page([row("990060001","上海市")],3),page([row("990060002","香港")],3),page([row("990060003","北京市")],3)]);
      const omitted = structuredClone(multi.result.fetchEvidence!); omitted.pages.splice(1,1); omitted.artifacts.splice(1,1);
      expect(proof(multi,omitted)).toBe(false); expect(replay(multi,omitted)).toBe(false); return;
    }
    if (mutation === "changedPageFilter") { const changed = new URL(evidence.artifacts[0]!.requestedUrl!); changed.searchParams.set('p','1^3'); evidence.artifacts[0]!.requestedUrl = changed.toString(); evidence.artifacts[0]!.finalUrl = changed.toString(); }
    if (mutation === "changedDeclaredTotal") evidence.declaredCompleteness!.value = 2;
    if (mutation === "changedLocation") { evidence.artifacts[0]!.body = String(evidence.artifacts[0]!.body).replaceAll("香港", "上海市"); evidence.pages[0]!.responseFingerprintSha256 = sha256Bytes(Buffer.from(String(evidence.artifacts[0]!.body))).sha256; }
    if (mutation === "changedOutputId") jobs[0]!.sourceJobId = "990010002";
    if (mutation === "omittedMainland") jobs.pop();
    if (mutation === "outsidePromoted") jobs.push({...jobs[0]!, sourceJobId: "990010002", locationRaw: "香港"});
    expect(proof(input, evidence, jobs)).toBe(false); expect(replay(input, evidence, jobs)).toBe(false);
  });

  it.each(["sameId", "outsideSameId", "sameIdAcrossPages", "missingId", "crossOrigin", "visibleConflict"])("holds invalid original identity or conflicting fields: %s", async mutation => {
    let bodies = [page([row("990040001", "上海市"), row("990040002", "香港")])];
    if (mutation === "sameId") bodies = [page([row("990040001", "上海市"), row("990040001", "北京市")])];
    if (mutation === "outsideSameId") bodies = [page([row("990040001", "上海市"), row("990040001", "香港")])];
    if (mutation === "sameIdAcrossPages") bodies = [page([row("990040001", "上海市")],2),page([row("990040001", "香港")],2)];
    if (mutation === "missingId") bodies[0] = bodies[0]!.replace("/job_show/990040002", "/job_show/bad");
    if (mutation === "crossOrigin") bodies[0] = bodies[0]!.replace("/job_show/990040002", "https://example.test/job_show/990040002");
    if (mutation === "visibleConflict") bodies = [page([row("990040001", "上海市", "香港")])];
    const input = await capture(bodies); expect(input.result.truth.completenessVerified).toBe(false);
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });

  it("preserves ACTIVE and GRACE last-good snapshots when any geography is unknown", async () => {
    const good = await capture(), input = await capture([page([row("990010001", "待定"), row("990010002", "香港"), row("990010003", "上海市")])]);
    const rows = inspectKelunScopeRows(input.plan, input.result.fetchEvidence!);
    expect(kelunScopeCounts(rows)).toEqual({rawCount: 3, mainlandCount: 1, outsideCount: 1, unknownCount: 1});
    expect(input.result.fetchEvidence!.declaredCompleteness).toBeUndefined();
    expect(input.result.truth.completenessVerified).toBe(false);
    const previousJobs = good.result.jobs.map((record, i) => ({dedupeKey: buildJobDedupeKey(record), record,
      lifecycleStatus: "ACTIVE" as const, missingSuccessfulCrawlCount: i ? 1 : 0,
      firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-02T00:00:00.000Z"}));
    const before = structuredClone(previousJobs), admission = await issueSourceQualityAdmission(input);
    expect(admission.status).toBe("REJECTED");
    expect(buildSourceQualityJobCommands({...input, admission, previousJobs, firstAcceptedCurrentPolicyReceipt: null, baselineCompletedBeforeCrawl: true}).jobCommands).toEqual([]);
    expect(previousJobs).toEqual(before);
  });

  it("retains the separate B-grade gate: legacy HTML v1 cannot relabel excluded rows as dedupe", async () => {
    const input = await capture(); expect(requiresBGradeTraversalCertificate(input.plan)).toBe(true);
    const rows = inspectKelunScopeRows(input.plan, input.result.fetchEvidence!), all = rows.map(r => `${input.plan.source.id}:${r.sourceJobId}`), included = input.result.jobs.map(buildJobDedupeKey);
    const common = {sourceId: "source-kelun-social" as const, companyId: input.plan.company.id, sourceConfigSha256: sourcePlanConfigSha256(input.plan),
      surfaceIds: [input.plan.source.surfaceId!], channelIds: input.plan.expectedChannels!.map(c => c.channelId), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString()};
    expect(() => createPlanBoundHtmlBrowserTraversalValidation({...common, pages: [{pageNumber: 1, declaredTotalPages: 1, rawMatchKeys: all, matchKeys: included, nextControlPresent: false}]})).toThrow();
    const validation = createPlanBoundHtmlBrowserTraversalValidation({...common, pages: [{pageNumber: 1, declaredTotalPages: 1, rawMatchKeys: all, matchKeys: all, nextControlPresent: false}]});
    expect(bGradeTraversalValidationMatchesCurrentJobs(validation, input.result.jobs)).toBe(false);
    const decision = issueBGradeTraversalCertificate({binding: input.binding, plan: input.plan, transportSuccess: true, adapterSuccess: true,
      evidence: input.result.fetchEvidence!, paginationEvaluation: input.result.paginationEvaluation!, reconciliation: input.result.reconciliation!, jobs: input.result.jobs,
      independentValidation: validation, validationExecution: "CURRENT_RUN", trigger: "STABLE_RUN", now: new Date()});
    expect(decision).toMatchObject({status: "REJECTED"});
  });

  it("rejects coherent original mutation after acquisition and refuses a saved receipt as new authority", async () => {
    const input = await capture();
    expect((await issueSourceQualityAdmission({...input,result:structuredClone(input.result)})).status).toBe("REJECTED");
    input.result.fetchEvidence!.artifacts[0]!.body = String(input.result.fetchEvidence!.artifacts[0]!.body).replaceAll("香港","上海市");
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status:"REJECTED",codes:["ACQUISITION_MUTATED"]});
  });

  it("does not lend Kelun exclusions to another source or a changed plan", async () => {
    const input = await capture(), changed = structuredClone(input.plan);
    changed.source.id = "source-unrelated-social";
    expect(replayKelunMainlandScope(changed, input.result.fetchEvidence!, input.result.jobs)).toBeUndefined();
    if (changed.adapterId !== "html-table") throw Error();
    expect(validateStrictHtmlCompletenessProof(changed, input.result.fetchEvidence!)).toBe(false);
    changed.source.id = "source-kelun-social"; changed.source.officialEntryUrl += "&other=1";
    expect(validateStrictHtmlCompletenessProof(changed, input.result.fetchEvidence!)).toBe(false);
  });
});
