// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";
import { GILEAD_ENDPOINT, GILEAD_SYNTHETIC_AGES, syntheticGileadBody, syntheticGileadRow } from "../helpers/gileadYello";
import { CITY_PENDING } from "../../src/domain/jobLocation";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";

const NOW = "2026-10-02T01:00:00.000Z";
const plan = () => structuredClone(buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-gilead-china-social")!);
async function capture(body = syntheticGileadBody()) {
  const p = plan();
  const fetched = await createOfficialJsonSourceFetch({now: () => new Date(NOW), http: async () => ({status: 200, finalUrl: GILEAD_ENDPOINT, contentType: "application/json", capturedAt: NOW, body})})(p);
  const result = await runSourceCrawl(p, {fetch: () => fetched, isBaseline: false});
  return {plan: p, fetched, result};
}
const replay = (c: Awaited<ReturnType<typeof capture>>, evidence = c.result.fetchEvidence!, jobs = c.result.jobs, p = c.plan) => replayStrictSourceQualityEvidence({plan: p, evidence, jobs, paginationEvaluation: c.result.paginationEvaluation!, reconciliation: c.result.reconciliation!, capturedAt: NOW});

describe("Gilead source-local public age preservation", () => {
  it("pins its preservation policy and binds all ten labels without inventing publication timestamps", async () => {
    const c = await capture();
    expect(c.plan).toMatchObject({officialJsonFetch: {publicAgePolicy: "GILEAD_PUBLIC_AGE_PRESERVATION_V1"}});
    expect(c.result.truth.completenessVerified).toBe(true);
    expect(c.result.jobs).toHaveLength(10);
    expect(c.result.jobs.map(j => j.cities)).toEqual(GILEAD_SYNTHETIC_AGES.map((_, i) => [i === 0 || i === 7 ? "北京" : "上海"]));
    expect(c.result.jobs.every(j => j.officialPublishedAt === undefined)).toBe(true);
    expect(c.result.fetchEvidence!.fetchCounts).toEqual({rawCount: 10, parsedCount: 10, validCount: 10, parseDiscardCount: 0, validationDiscardCount: 0});
    expect(c.result.fetchEvidence!.fetchLosses).toEqual([]);
    for (const [index, job] of c.result.jobs.entries()) {
      expect(job.evidence).toMatchObject({gileadPublicAge: {policy: "GILEAD_PUBLIC_AGE_PRESERVATION_V1", rawLabel: GILEAD_SYNTHETIC_AGES[index],
        classification: index < 3 ? {kind: "RELATIVE_WEEKS", amount: index + 1} : {kind: "YEARLESS_MONTH_DAY"},
        exactDateStatus: "UNKNOWN", timeWindowStatus: "TIME_WINDOW_UNAVAILABLE", capturedAt: NOW,
        artifactLogicalKey: c.result.fetchEvidence!.artifacts[0]!.logicalKey,
        rowLocator: `$.html|li.search-results__item[${index}]|.search-results__post-time`, rowSha256: expect.stringMatching(/^[0-9a-f]{64}$/u)}});
    }
  });

  it("preserves an old relative label without dropping its job or claiming freshness or closure", async () => {
    const fresh = await capture(syntheticGileadBody([syntheticGileadRow(0, "1w")]));
    const old = await capture(syntheticGileadBody([syntheticGileadRow(0, "2y")]));
    expect(old.result.truth.completenessVerified).toBe(true);
    expect(old.result.jobs).toHaveLength(1);
    expect(old.result.jobs[0]!.officialPublishedAt).toBeUndefined();
    expect(old.result.jobs[0]!.evidence).toMatchObject({gileadPublicAge: {rawLabel: "2y", classification: {kind: "RELATIVE_YEARS", amount: 2}, timeWindowStatus: "TIME_WINDOW_UNAVAILABLE"}});
    expect(old.result.jobs[0]!.evidence).not.toEqual(fresh.result.jobs[0]!.evidence);
    expect(replay(old, old.result.fetchEvidence!, fresh.result.jobs)).toBe(false);
  });

  it.each(["Dec 31", "Feb 29"])("preserves plausible yearless %s without inferring a year or calling it future", async label => {
    const c = await capture(syntheticGileadBody([syntheticGileadRow(0, label)]));
    expect(c.result.truth.completenessVerified).toBe(true);
    expect(c.result.jobs[0]!.officialPublishedAt).toBeUndefined();
    expect(c.result.jobs[0]!.evidence).toMatchObject({gileadPublicAge: {rawLabel: label, classification: {kind: "YEARLESS_MONTH_DAY"}}});
  });

  it.each([
    {label: "NEW", classification: {kind: "NEW_MARKER"}},
    {label: "4d", classification: {kind: "RELATIVE_DAYS", amount: 4}}
  ])("preserves $label without inferring publication time", async ({label, classification}) => {
    const c = await capture(syntheticGileadBody([syntheticGileadRow(0, label)]));
    expect(replay(c)).toBe(true);
    expect(c.result.jobs[0]!.officialPublishedAt).toBeUndefined();
    expect(c.result.jobs[0]!.evidence.gileadPublicAge).toMatchObject({rawLabel: label, classification,
      exactDateStatus: "UNKNOWN", timeWindowStatus: "TIME_WINDOW_UNAVAILABLE"});
  });

  it.each(["", "new", "NEW Today", "0d", "-1d", "4.5d", "-1w", "in 2w", "tomorrow", "Feb 30", "Sep 31", "Jan 0", "Sep 3, 2026", "1.5w", "999999999999999999999w", "nonsense"])("holds malformed or unsupported label %j with archived raw evidence", async label => {
    const body = syntheticGileadBody([syntheticGileadRow(0, label)]);
    const c = await capture(body);
    expect(c.fetched.ok).toBe(false);
    expect(c.result.truth.completenessVerified).toBe(false);
    expect(c.result.observation.completenessStatus).toBe("FAILED");
    expect(c.result.fetchEvidence!.artifacts[0]!.body).toBe(body);
    expect(c.result.fetchEvidence!.declaredCompleteness).toBeUndefined();
    expect(c.result.observation.failureReason).toMatch(/GILEAD_PUBLIC_AGE_INVALID/);
  });

  it.each(["missing", "same", "conflicting"])("holds %s age nodes without accepting a verified zero", async mutation => {
    const row = syntheticGileadRow(0).replace('<div class="search-results__post-time pull-right">1w</div>', mutation === "missing" ? "" : `<div class="search-results__post-time">1w</div><div class="search-results__post-time">${mutation === "same" ? "1w" : "2y"}</div>`);
    const c = await capture(syntheticGileadBody([row]));
    expect(c.fetched.ok).toBe(false);
    expect(c.result.truth.completenessVerified).toBe(false);
    expect(c.result.fetchEvidence!.declaredCompleteness).toBeUndefined();
    expect(c.result.observation.failureReason).toMatch(/GILEAD_PUBLIC_AGE_INVALID/);
  });

  it("keeps exact age text including whitespace and uses only the canonical city-pending marker for uncertain China locality", async () => {
    const c = await capture(syntheticGileadBody([syntheticGileadRow(0, "  1w\n", "China - Beijing / Shanghai")]));
    expect(c.result.truth.completenessVerified).toBe(true);
    expect(c.result.jobs[0]!.cities).toEqual([CITY_PENDING]);
    expect(c.result.jobs[0]!.evidence).toMatchObject({gileadPublicAge: {rawLabel: "  1w\n", classification: {kind: "RELATIVE_WEEKS", amount: 1}}});
  });

  it.each(["title", "location"])("replays the adapter's deterministic %s whitespace cleanup while preserving the raw row", async field => {
    let row = syntheticGileadRow(0, " 1w\n", field === "location" ? "China - Beijing\t/ Shanghai" : "China - Beijing");
    if (field === "title") row = row.replace("Synthetic Gilead role 0", "Synthetic  Gilead\nrole 0");
    const c = await capture(syntheticGileadBody([row]));
    expect(c.result.truth.completenessVerified).toBe(true);
    expect(c.result.jobs[0]!.officialTitle).toBe("Synthetic Gilead role 0");
    expect(c.result.jobs[0]!.locationRaw).toBe(field === "location" ? "China - Beijing / Shanghai" : "China - Beijing");
    expect(c.result.jobs[0]!.evidence.gileadPublicAge!.rawLabel).toBe(" 1w\n");
    expect(String(c.result.fetchEvidence!.artifacts[0]!.body)).toContain(JSON.stringify(row).slice(1, -1));
  });

  it("rejects normalized mutations of title, raw location, city, URL, ID, exact date and every age-evidence field", async () => {
    const c = await capture();
    const mutations: Array<(job: any) => void> = [j => j.officialTitle = "Forged title", j => j.locationRaw = "China - Shanghai", j => j.cities = ["上海"],
      j => j.officialUrl = c.result.jobs[1]!.officialUrl, j => j.sourceJobId = "forged", j => j.officialPublishedAt = NOW,
      j => delete j.evidence.gileadPublicAge, j => j.evidence.gileadPublicAge.rawLabel = "2y", j => j.evidence.gileadPublicAge.classification = {kind: "RELATIVE_YEARS", amount: 2},
      j => j.evidence.gileadPublicAge.rowSha256 = "a".repeat(64), j => j.evidence.gileadPublicAge.rowLocator = "other", j => j.evidence.gileadPublicAge.artifactLogicalKey = "other",
      j => j.evidence.gileadPublicAge.capturedAt = "2026-10-01T00:00:00.000Z", j => j.evidence.gileadPublicAge.timeWindowStatus = "VERIFIED_183_DAYS"];
    for (const mutate of mutations) { const jobs = structuredClone(c.result.jobs); mutate(jobs[0]); expect(replay(c, c.result.fetchEvidence!, jobs)).toBe(false); }
  });

  it("binds exact row hashes and rejects a rehashed raw age/title/location change paired with stale output", async () => {
    const c = await capture();
    for (const [before, after] of [[">1w<", ">2y<"], ["Synthetic Gilead role 0", "Other title"], ["China - Beijing", "China - Shanghai"]]) {
      const evidence = structuredClone(c.result.fetchEvidence!);
      evidence.artifacts[0]!.body = String(evidence.artifacts[0]!.body).replace(before!, after!);
      evidence.pages[0]!.responseFingerprintSha256 = createHash("sha256").update(String(evidence.artifacts[0]!.body)).digest("hex");
      expect(replay(c, evidence)).toBe(false);
    }
    for (const field of ["rawJobIds", "validJobIds"] as const) { const evidence = structuredClone(c.result.fetchEvidence!); evidence.pages[0]![field][0] = `sha256:${"a".repeat(64)}`; expect(replay(c, evidence)).toBe(false); }
  });

  it("rejects forged row hashes even when generic pagination hashes and counts are recomputed", async () => {
    const c = await capture();
    for (const field of ["rawJobIds", "validJobIds"] as const) {
      const evidence = structuredClone(c.result.fetchEvidence!);
      evidence.pages[0]![field][0] = `sha256:${"f".repeat(64)}`;
      const policy = {expectedChannelIds: [], filteredOutput: true, allowPositiveOfficialTotalCountAfterAdapterReconciliation: true};
      const canonical = deriveCanonicalPaginationEvidence({evidence, ...policy});
      const evaluation = evaluatePaginationEvidence({evidence: canonical, ...policy});
      expect(evaluation.safeCompleteness).toBe(true);
      expect(replayStrictSourceQualityEvidence({plan: c.plan, evidence: canonical, jobs: c.result.jobs,
        paginationEvaluation: evaluation, reconciliation: c.result.reconciliation!, capturedAt: NOW})).toBe(false);
    }
  });

  it("does not let a transformed fetch payload change the official fields while retaining its raw receipt", async () => {
    const c = await capture();
    for (const patch of [{title: "Forged"}, {locationRaw: "China - Shanghai"}, {cities: ["上海"]}, {officialUrl: "https://gilead.yello.co/jobs/SSSSSSSSSSSSSSSSSSSS99"}]) {
      const fetched = structuredClone(c.fetched);
      if (!fetched.ok || !("payload" in fetched)) throw Error();
      Object.assign((fetched.payload as {jobs: Record<string, unknown>[]}).jobs[0]!, patch);
      const result = await runSourceCrawl(c.plan, {fetch: () => fetched, isBaseline: false});
      expect(result.truth.completenessVerified).toBe(false);
    }
  });

  it("rejects forged source/company/policy and keeps country/filter/terminal/count proof strict", async () => {
    const c = await capture();
    for (const change of [(p: any) => p.source.id = "source-other-social", (p: any) => p.company.id = "company-other", (p: any) => delete p.officialJsonFetch.publicAgePolicy,
      (p: any) => p.officialJsonFetch.publicAgePolicy = "INFER_YEAR", (p: any) => p.officialJsonFetch.locationFilterId = 73]) {
      const p = structuredClone(c.plan); change(p); expect(replay(c, c.result.fetchEvidence!, c.result.jobs, p)).toBe(false);
    }
    for (const body of [syntheticGileadBody(undefined, {more_requisitions: true}), syntheticGileadBody(undefined, {count_on_page: 9}), syntheticGileadBody([syntheticGileadRow(0, "1w", "China - Hong Kong")])]) {
      expect((await capture(body)).fetched.ok).toBe(false);
    }
  });
});
