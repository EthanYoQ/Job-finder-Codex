// @vitest-environment node
/** Invented titles/IDs only. Never live evidence or a production admission. */
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSyntheticGileadQuality, buildSyntheticGileadAtomicFixture } from "../helpers/gileadQualityFixture";
import { syntheticGileadBody, syntheticGileadRow } from "../helpers/gileadYello";
import { parseYelloJobBoardResponse, yelloScopeExclusionLoss } from "../../src/crawler/yelloJobBoardEvidence";
import { replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";
import { issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "../../src/crawler/sourceQualityAdmission";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { acquirePortableCrawlLease } from "../../src/crawler/portableCrawlLease";
import { compilePortableAtomicSourceEvidenceSql } from "../../src/db/ingestionRepository";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { selectPortableSourceSnapshots } from "../../src/domain/portablePublicSnapshot";
import { accepted, digest, FIRST, NOW } from "../helpers/portablePublicSnapshotFixture";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function capture(body: string) {
  const root = await mkdtemp(join(tmpdir(), "gilead-mainland-synthetic-")); dirs.push(root);
  return captureSyntheticGileadQuality(root, body);
}
function hongKong(index = 0, age = "NEW") {
  return syntheticGileadRow(index, age, "China - Hong Kong")
    .replace('alt="China flag"', 'alt="Hong Kong flag"').replace("/flags/cn.png", "/flags/hk.png");
}
const mainland = () => Array.from({ length: 10 }, (_, i) => syntheticGileadRow(i + 1, "1w", i === 0 ? "China - Beijing" : "China - Shanghai"));
const body = () => syntheticGileadBody([hongKong(), ...mainland()]);
function parsed(input: Awaited<ReturnType<typeof capture>>) {
  const p = input.plan;
  if (p.adapterId !== "official-json" || p.officialJsonFetch?.kind !== "yello-job-board") throw Error("PLAN");
  return parseYelloJobBoardResponse(String(input.result.fetchEvidence!.artifacts[0]!.body), p.officialJsonFetch);
}
function replay(input: Awaited<ReturnType<typeof capture>>, evidence = input.result.fetchEvidence!, jobs = input.result.jobs) {
  return replayStrictSourceQualityEvidence({ plan: input.plan, evidence, jobs,
    reconciliation: input.result.reconciliation!, paginationEvaluation: input.result.paginationEvaluation!,
    capturedAt: input.result.observation.crawledAt.toISOString() });
}

describe("Gilead original China result set with explicit mainland partition", () => {
  it("preserves all eleven rows, admits ten mainland jobs and archives one exact Hong Kong exclusion before age classification", async () => {
    const input = await capture(body()); const p = parsed(input); const evidence = input.result.fetchEvidence!;
    expect(input.requests).toHaveLength(1);
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(p.declaredTotal).toBe(11); expect(p.rows).toHaveLength(11); expect(p.jobs).toHaveLength(10); expect(p.excludedJobs).toHaveLength(1);
    expect(new Set(p.rows.map(row => row.officialId)).size).toBe(11);
    expect(p.excludedJobs[0]).toMatchObject({ rowIndex: 0, locationRaw: "China - Hong Kong", publicAgeRaw: "NEW", publicAgeStatus: "NOT_EVALUATED_OUT_OF_SCOPE" });
    expect(p.excludedJobs[0]).not.toHaveProperty("publicAgeClassification");
    expect(evidence.artifacts[0]!.body).toBe(body());
    expect(evidence.fetchCounts).toEqual({ rawCount: 11, parsedCount: 11, validCount: 10, parseDiscardCount: 0, validationDiscardCount: 1 });
    expect(evidence.declaredCompleteness).toMatchObject({ kind: "OFFICIAL_TOTAL_COUNT", value: 11, scope: "SOURCE" });
    expect(evidence.pages[0]).toMatchObject({ declaredTotal: 11, declaredCount: 11, termination: "NEXT_ABSENT" });
    expect(evidence.pages[0]!.rawJobIds).toHaveLength(11); expect(evidence.pages[0]!.validJobIds).toHaveLength(10);
    expect(evidence.fetchLosses).toEqual([yelloScopeExclusionLoss(p.excludedJobs[0]!, evidence.artifacts[0]!)]);
    expect(input.result.observation.expectedJobCount).toBe(11);
    expect(input.result.jobs).toHaveLength(10);
    expect(input.result.jobs[0]!.evidence.gileadPublicAge!.rowLocator).toContain("item[1]");
    expect(input.result.jobs.every(job => job.officialPublishedAt === undefined)).toBe(true);
    const { admission, commit } = await buildSyntheticGileadAtomicFixture(input);
    expect(admission.status).toBe("ACCEPTED");
    expect(admission.receipt.counts).toMatchObject({ rawCount: 11, finalUniqueJobCount: 10, validationDiscardCount: 1 });
    expect(admission.receipt.observation.expectedJobCount).toBe(11);
    expect(admission.receipt.declaredCompleteness.value).toBe(11);
    expect(commit.sourceResult).toMatchObject({ rawCount: 11, parsedCount: 11, validCount: 10, expectedJobCount: 11, validationDiscardCount: 1, dedupeOutputCount: 10 });
    expect(commit.lossLedger).toHaveLength(1);
    expect(commit.commands.filter(command => command.type === "UPSERT_JOB")).toHaveLength(10);
    expect(() => verifySourceQualityAtomicCommit({ plan: input.plan, commit })).not.toThrow();
    let holder = "";
    const lease = await acquirePortableCrawlLease({ $transaction: async work => work({ $queryRawUnsafe: async <T>(_sql: string, ...values: unknown[]) => { holder = String(values[1]); return [{ holderId: holder }] as T; } }) });
    const sql = await compilePortableAtomicSourceEvidenceSql(commit, lease);
    expect(sql).toContain('"LossLedgerEntry"'); expect(sql).toContain("GILEAD_VERIFIED_HONG_KONG_ONLY");
    // Compiler only: no SQL is executed and the lease above is entirely in memory.
  });

  it("keeps original positions when the excluded row is in the middle", async () => {
    const rows = mainland(); rows.splice(4, 0, hongKong());
    const input = await capture(syntheticGileadBody(rows));
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.fetchEvidence!.fetchLosses[0]!.details.recordIndex).toBe(4);
    expect(input.result.jobs[4]!.evidence.gileadPublicAge!.rowLocator).toContain("item[5]");
  });

  it("can prove zero mainland jobs from a complete explicitly excluded nonempty official set", async () => {
    const input = await capture(syntheticGileadBody([hongKong()]));
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.observation.expectedJobCount).toBe(1);
    expect(input.result.jobs).toEqual([]);
    const { admission } = await buildSyntheticGileadAtomicFixture(input);
    expect(admission.receipt.counts).toMatchObject({ rawCount: 1, validCount: 0, finalUniqueJobCount: 0, validationDiscardCount: 1 });
  });

  it.each(["duplicatesAcrossPartitions", "duplicateExcluded", "wrongFlag", "wrongCountry", "mixedLocation", "secondaryLocationContainer", "additionalLocationSpan", "unwrappedLocationText", "unwrappedJobInfoLocation", "nestedLocationInDepartment", "crossOrigin", "missingId", "unsupportedMacau", "unknownCountry", "ambiguousLocation", "inScopeUnreviewedAge", "countMismatch", "canContinue"])("holds %s without converting an unknown or invalid row into an exclusion", async mutation => {
    let hk = hongKong(); let rows = mainland(); const overrides: Record<string, unknown> = {};
    if (mutation === "duplicatesAcrossPartitions") hk = hongKong(1);
    if (mutation === "duplicateExcluded") rows.push(hongKong());
    if (mutation === "wrongFlag") hk = hk.replace("Hong Kong flag", "China flag");
    if (mutation === "wrongCountry") hk = hk.replace("China - Hong Kong", "Japan - Hong Kong");
    if (mutation === "mixedLocation") hk = hk.replace("China - Hong Kong", "China - Hong Kong / Shanghai");
    if (mutation === "secondaryLocationContainer") hk = hk.replace("</span></div></div>", "</span></div><div><span>China - Shanghai</span></div></div>");
    if (mutation === "additionalLocationSpan") hk = hk.replace("<span>Regular</span>", "<span>Regular</span><span>China - Shanghai</span>");
    if (mutation === "unwrappedLocationText") hk = hk.replace("China - Hong Kong</span>", "China - Hong Kong</span> / China - Shanghai");
    if (mutation === "unwrappedJobInfoLocation") hk = hk.replace("</a><div>", "</a>China - Shanghai<div>");
    if (mutation === "nestedLocationInDepartment") hk = hk.replace("Synthetic department", "Synthetic department<span>China - Shanghai</span>");
    if (mutation === "crossOrigin") hk = hk.replace('href="/jobs/', 'href="https://evil.example/jobs/');
    if (mutation === "missingId") hk = hk.replace(/\/jobs\/S+0/u, "/jobs/bad");
    if (mutation === "unsupportedMacau") hk = hk.replaceAll("Hong Kong", "Macau").replace("hk.png", "mo.png");
    if (mutation === "unknownCountry") hk = hk.replace("China - Hong Kong", "Unverified country - Unknown");
    if (mutation === "ambiguousLocation") hk = syntheticGileadRow(0, "1w", "China - Remote");
    if (mutation === "inScopeUnreviewedAge") rows[0] = syntheticGileadRow(1, "NEW Today", "China - Beijing");
    if (mutation === "countMismatch") { overrides.count_on_page = 10; overrides.display_count_text = "10 Results"; }
    if (mutation === "canContinue") overrides.more_requisitions = true;
    const input = await capture(syntheticGileadBody([hk, ...rows], overrides));
    expect(input.result.truth.completenessVerified).toBe(false);
    expect(input.result.jobs).toEqual([]);
    expect(input.result.fetchEvidence!.declaredCompleteness).toBeUndefined();
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });

  it("quarantines the exact unresolved row and keeps previous active/GRACE jobs untouched", async () => {
    const old = await capture(syntheticGileadBody(mainland()));
    const previousJobs = old.result.jobs.slice(0, 2).map((record, index) => ({ record, dedupeKey: buildJobDedupeKey(record), lifecycleStatus: "ACTIVE" as const,
      missingSuccessfulCrawlCount: index, firstSeenAt: FIRST, lastSeenAt: FIRST }));
    const before = structuredClone(previousJobs);
    const input = await capture(syntheticGileadBody([syntheticGileadRow(0, "1w", "China - Remote"), ...mainland().slice(2)]));
    expect(input.result.observation.failureReason).toBe("GILEAD_SCOPE_REVIEW_REQUIRED:row:0");
    expect(input.result.fetchEvidence!.fetchLosses[0]!.details).toMatchObject({ code: "GILEAD_SCOPE_REVIEW_REQUIRED", recordIndex: 0, field: "location" });
    const admission = await issueSourceQualityAdmission(input);
    expect(admission.status).toBe("REJECTED");
    const commands = buildSourceQualityJobCommands({ ...input, admission, previousJobs, firstAcceptedCurrentPolicyReceipt: null, baselineCompletedBeforeCrawl: true });
    expect(commands.jobCommands).toEqual([]); expect(previousJobs).toEqual(before);
  });

  it.each(["lossMissing", "lossExtra", "reason", "index", "locator", "ageNote", "rawId", "validId", "compactAgeIndex", "includeExcluded", "omitIncluded", "alterRawExclusion"])("rejects independent replay after %s mutation", async mutation => {
    const input = await capture(body()); const evidence = structuredClone(input.result.fetchEvidence!); const jobs: NormalizedJobRecord[] = structuredClone(input.result.jobs);
    if (mutation === "lossMissing") evidence.fetchLosses = [];
    if (mutation === "lossExtra") evidence.fetchLosses.push(structuredClone(evidence.fetchLosses[0]!));
    if (mutation === "reason") evidence.fetchLosses[0]!.reason = "unreviewed reason";
    if (mutation === "index") evidence.fetchLosses[0]!.details.recordIndex = 1;
    if (mutation === "locator") evidence.fetchLosses[0]!.rawLocator += "changed";
    if (mutation === "ageNote") evidence.fetchLosses[0]!.details.noteCode = "AGE_VERIFIED";
    if (mutation === "rawId") evidence.pages[0]!.rawJobIds[0] = `sha256:${"f".repeat(64)}`;
    if (mutation === "validId") evidence.pages[0]!.validJobIds[0] = `sha256:${"f".repeat(64)}`;
    if (mutation === "compactAgeIndex") jobs[0]!.evidence.gileadPublicAge!.rowLocator = "$.html|li.search-results__item[0]|.search-results__post-time";
    if (mutation === "includeExcluded") jobs.push(structuredClone(jobs[0]!));
    if (mutation === "omitIncluded") jobs.pop();
    if (mutation === "alterRawExclusion") {
      evidence.artifacts[0]!.body = String(evidence.artifacts[0]!.body).replace("Hong Kong", "Shanghai");
      evidence.pages[0]!.responseFingerprintSha256 = createHash("sha256").update(String(evidence.artifacts[0]!.body)).digest("hex");
    }
    expect(replay(input, evidence, jobs)).toBe(false);
  });

  it("rejects a coherently rehashed false exclusion after generic pagination passes", async () => {
    const input = await capture(body()); const evidence = structuredClone(input.result.fetchEvidence!);
    evidence.fetchLosses[0]!.details.recordIndex = 1;
    const policy = { expectedChannelIds: [], filteredOutput: true, allowPositiveOfficialTotalCountAfterAdapterReconciliation: true, allowIndependentlyVerifiedProfileBoundExclusions: true };
    const canonical = deriveCanonicalPaginationEvidence({ evidence, ...policy });
    const evaluation = evaluatePaginationEvidence({ evidence: canonical, ...policy });
    expect(evaluation.safeCompleteness).toBe(true);
    expect(replayStrictSourceQualityEvidence({ plan: input.plan, evidence: canonical, paginationEvaluation: evaluation,
      reconciliation: input.result.reconciliation!, jobs: input.result.jobs, capturedAt: input.result.observation.crawledAt.toISOString() })).toBe(false);
  });

  it("does not let imported evidence or transformed output become an owned admission", async () => {
    const input = await capture(body());
    expect(await issueSourceQualityAdmission({ ...input, result: structuredClone(input.result) })).toMatchObject({ status: "REJECTED", codes: ["OWNED_ACQUISITION_REQUIRED"] });
    input.result.jobs[0]!.locationRaw = "China - Hong Kong";
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });

  it("keeps durable reader raw/official eleven and visible ten distinct under existing schema", async () => {
    const input = await capture(body()); const f = accepted(FIRST, Array.from({ length: 10 }, (_, i) => `synthetic-${i}`), [], input.plan);
    Object.assign(f.receipt.counts, { rawCount: 11, parsedCount: 11, validationDiscardCount: 1 });
    f.receipt.observation.expectedJobCount = 11; f.receipt.declaredCompleteness.value = 11;
    Object.assign(f.result, { rawCount: 11, parsedCount: 11, validationDiscardCount: 1, discardCount: 1, expectedJobCount: 11 });
    f.result._count.lossLedgerEntries = 1; f.result.completenessCertificateSha256 = digest(f.receipt);
    const selected = selectPortableSourceSnapshots([input.plan], [f.result], { currentTime: NOW })[0]!;
    expect(selected.state).toBe("PUBLISHING"); expect(selected.lastAcceptedJobCount).toBe(10);
    expect(selected.selected!.result.expectedJobCount).toBe(11);
    f.result.validationDiscardCount = 0;
    expect(selectPortableSourceSnapshots([input.plan], [f.result], { currentTime: NOW })[0]!.state).toBe("HOLD");
  });

  it.each([
    "departmentLocationClass", "extraLocationDiv", "departmentDataLocation", "departmentLocationRole",
    "flagDataLocation", "wrapperDataLocation", "blankLocationClass", "mixedLocationClass",
    "unknownPlainSpan", "unwrappedShellLocation", "nestedTitleLocation", "unknownWrapperClass",
    "unexpectedAgeTag", "unexpectedJobInfoTag", "reorderedJobInfo", "flagBlockLocationRole"
  ])("holds an otherwise exact Hong Kong tuple with unreviewed same-row structure: %s", async mutation => {
    let hk = hongKong(0, "2d");
    const department = "<span>Synthetic department</span>";
    const age = '<div class="search-results__post-time pull-right">2d</div>';
    if (mutation === "departmentLocationClass") hk = hk.replace(department, '<span class="search-results__location">China - Shanghai</span>');
    if (mutation === "extraLocationDiv") hk = hk.replace(age, '<div class="search-results__location">China - Shanghai</div>' + age);
    if (mutation === "departmentDataLocation") hk = hk.replace(department, '<span data-location="China - Shanghai">Synthetic department</span>');
    if (mutation === "departmentLocationRole") hk = hk.replace(department, '<span role="location">China - Shanghai</span>');
    if (mutation === "flagDataLocation") hk = hk.replace('<img alt=', '<img data-location="China - Shanghai" alt=');
    if (mutation === "wrapperDataLocation") hk = hk.replace('<div class="clearfix">', '<div class="clearfix" data-location="Unknown">');
    if (mutation === "blankLocationClass") hk = hk.replace(department, '<span class="search-results__location"></span>');
    if (mutation === "mixedLocationClass") hk = hk.replace(department, '<span class="search-results__location">China - Hong Kong / Shanghai</span>');
    if (mutation === "unknownPlainSpan") hk = hk.replace(age, '<span>China - Shanghai</span>' + age);
    if (mutation === "unwrappedShellLocation") hk = hk.replace(age, 'China - Shanghai' + age);
    if (mutation === "nestedTitleLocation") hk = hk.replace('Synthetic Gilead role 0</a>', 'Synthetic Gilead role 0<span>China - Shanghai</span></a>');
    if (mutation === "unknownWrapperClass") hk = hk.replace('class="clearfix"', 'class="clearfix search-results__location"');
    if (mutation === "unexpectedAgeTag") hk = hk.replace(age, '<span class="search-results__post-time pull-right">2d</span>');
    if (mutation === "unexpectedJobInfoTag") hk = hk.replace('<div class="search-results__jobinfo pull-left">', '<section class="search-results__jobinfo pull-left">').replace('</span></div></div>', '</span></div></section>');
    if (mutation === "reorderedJobInfo") hk = hk.replace(/(<a class="search-results__req_title"[^>]*>[^<]*<\/a>)(<div><span>China - Hong Kong<\/span><span>Synthetic department<\/span><span>Regular<\/span><\/div>)/u, '$2$1');
    if (mutation === "flagBlockLocationRole") hk = hk.replace('class="search-results__flag pull-left"', 'class="search-results__flag pull-left" role="location"');
    const input = await capture(syntheticGileadBody([hk, ...mainland()]));
    expect(input.result.truth.completenessVerified).toBe(false);
    expect(input.result.jobs).toEqual([]);
    expect(input.result.observation.failureReason).toBe("GILEAD_SCOPE_REVIEW_REQUIRED:row:0");
    expect(input.result.fetchEvidence!.artifacts[0]!.body).toBe(syntheticGileadBody([hk, ...mainland()]));
    expect(input.result.fetchEvidence!.declaredCompleteness).toBeUndefined();
    expect(input.result.fetchEvidence!.fetchLosses.some(loss => loss.details.code === "GILEAD_VERIFIED_HONG_KONG_ONLY")).toBe(false);
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });

  it.each(["title", "department", "workType"])("does not interpret ordinary %s city words as extra geographic evidence", async field => {
    let hk = hongKong(0, "2d");
    if (field === "title") hk = hk.replace("Synthetic Gilead role 0", "Synthetic Shanghai and Beijing regional role");
    if (field === "department") hk = hk.replace("Synthetic department", "China - Shanghai / Unknown regional support");
    if (field === "workType") hk = hk.replace("<span>Regular</span>", "<span>Shanghai regional programme</span>");
    const input = await capture(syntheticGileadBody([hk, ...mainland()]));
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.fetchEvidence!.fetchCounts).toEqual({ rawCount: 11, parsedCount: 11, validCount: 10, parseDiscardCount: 0, validationDiscardCount: 1 });
    expect(parsed(input).excludedJobs[0]).toMatchObject({ publicAgeRaw: "2d", publicAgeStatus: "NOT_EVALUATED_OUT_OF_SCOPE" });
    expect(replay(input)).toBe(true);
  });

  it("keeps the reviewed optional language attribute without allowing unknown semantic attributes", async () => {
    const hk = hongKong(0, "2d").replace('class="search-results__req_title"', 'class="search-results__req_title" lang="en"');
    const input = await capture(syntheticGileadBody([hk, ...mainland()]));
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(parsed(input).excludedJobs[0]).toMatchObject({ rowIndex: 0, publicAgeRaw: "2d", publicAgeStatus: "NOT_EVALUATED_OUT_OF_SCOPE" });
    expect(replay(input)).toBe(true);
  });
});
