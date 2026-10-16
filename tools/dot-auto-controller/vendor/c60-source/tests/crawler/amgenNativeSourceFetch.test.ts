import { expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";

it("binds Amgen to the original manual TalentBrew entry instead of silently substituting the Workday list", () => {
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-amgen-china-social")!;
  expect(plan.source.officialEntryUrl).toBe("https://careers.amgen.com/en/search-jobs/China/87/2/1814991/35/105/50/2");
  expect(plan.adapterId === "official-json" && plan.profileBoundSource?.kind).toBe("amgen-manual-workday-lookup");
});

import { AMGEN_NATIVE_CONFIG, createAmgenNativeSourceFetch, validateStrictAmgenNativeEvidence } from "../../src/crawler/amgenNativeSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { safeProfileBoundSourceFailureReason } from "../../src/crawler/profileBoundSourceEvidence";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createHash } from "node:crypto";
import { amgenFixture, AMGEN_ENDPOINT, AMGEN_TIME } from "../helpers/amgenNativeFixture";
const plan = () => {
  const p = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-amgen-china-social")!;
  if (p.adapterId !== "official-json") throw Error("Expected Amgen official-json plan");
  return { ...p, profileBoundSource: { kind: "amgen-native-china" as const, config: AMGEN_NATIVE_CONFIG } };
};
const hash = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
async function acquire(total = 13) {
  const fixture = amgenFixture(total), p = plan();
  const result = await runSourceCrawl(p, { fetch: createAmgenNativeSourceFetch({ http: fixture.http, now: () => new Date(AMGEN_TIME) }) });
  return { fixture, p, result };
}
it("replays the historical V1 identities but cannot issue a new certificate after the V2 profile replaces it", async () => {
  const { result, fixture, p } = await acquire();
  expect(result.status).toBe("SUCCESS");
  expect(result.jobs).toHaveLength(13);
  expect(result.jobs.map(j => j.sourceJobId)).toEqual(fixture.rows.map(r => r.sourceJobId));
  expect(result.jobs.every(j => j.officialPublishedAt === undefined)).toBe(true);
  expect(fixture.requests.filter(r => r.url === AMGEN_ENDPOINT).map(r => [r.method, JSON.parse(r.body!).CurrentPage])).toEqual([["POST", 2]]);
  expect(validateStrictAmgenNativeEvidence(p, result.fetchEvidence!, result.jobs)).toBe(true);
  const artifact = result.fetchEvidence!.artifacts.find(a => a.logicalKey === result.fetchEvidence!.declaredCompleteness!.artifactLogicalKey)!;
  const decision = issueAGradeOfficialTotalCertificate({ plan: p, transportSuccess: true, adapterSuccess: true, evidence: result.fetchEvidence!, paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!, jobs: result.jobs, officialArtifactSha256: hash(artifact.body), binding: { releaseCandidateId: "test-amgen", batchId: "test-amgen-batch", sourceResultId: "test-amgen-result", sourceConfigSha256: sourcePlanConfigSha256(p) } });
  expect(decision).toEqual({ status: "REJECTED", blockerCodes: ["SCOPE_MISMATCH"] });
});
it("fails closed for a changed total, wrong page, repeated IDs, or unsupported scope", async () => {
  for (const mutate of [
    (body: string) => body.replace(/data-total-job-results=\\"13\\"/g, 'data-total-job-results=\\"14\\"'),
    (body: string) => body.replace(/data-current-page=\\"2\\"/g, 'data-current-page=\\"1\\"'),
    (body: string) => body.replaceAll("100000012", "100000000"),
    (body: string) => body.replaceAll("China", "Hong Kong")
  ]) {
    const fixture = amgenFixture();
    const result = await runSourceCrawl(plan(), { fetch: createAmgenNativeSourceFetch({ http: async r => { const response = await fixture.http(r); return r.url === AMGEN_ENDPOINT ? { ...response, body: mutate(response.body) } : response; } }) });
    expect(result.status).toBe("FAILED");
  }
});
it("rejects changed application ID, inactive application and changed native apply target", async () => {
  for (const field of ["jobReqId", "canApply", "externalUrl"] as const) {
    const fixture = amgenFixture(1); Object.assign(fixture.rows[0]!.info, { [field]: field === "canApply" ? false : "wrong" });
    const result = await runSourceCrawl(plan(), { fetch: createAmgenNativeSourceFetch({ http: fixture.http }) });
    expect(result.status).toBe("FAILED");
  }
});
it("replays all normalized fields and exact archived pagination rather than trusting claims", async () => {
  const { p, result } = await acquire();
  for (const mutate of [
    (r: typeof result) => { r.jobs[0]!.cities = ["北京"]; },
    (r: typeof result) => { r.jobs[0]!.officialTitle = "changed"; },
    (r: typeof result) => { r.jobs[0]!.sourceJobId += "-1"; },
    (r: typeof result) => { r.fetchEvidence!.pages[1]!.returnedPage = 99; },
    (r: typeof result) => { r.fetchEvidence!.artifacts.pop(); },
    (r: typeof result) => { r.fetchEvidence!.artifacts[1]!.extractorLocator += "changed"; },
    (r: typeof result) => { r.fetchEvidence!.artifacts[0]!.bodyRepresentation = "REDACTED"; }
  ]) { const copy = structuredClone(result); mutate(copy); expect(validateStrictAmgenNativeEvidence(p, copy.fetchEvidence!, copy.jobs)).toBe(false); }
});
it("does not count two native posting paths for the same Workday requisition twice", async () => {
  const fixture = amgenFixture(2), first = fixture.rows[0]!, second = fixture.rows[1]!, old = second.req;
  second.req = first.req;
  second.detail = second.detail.replaceAll(old, first.req);
  second.apiUrl = second.apiUrl.replaceAll(old, first.req);
  second.info.jobReqId = first.req;
  second.info.jobPostingId = second.info.jobPostingId!.replaceAll(old, first.req);
  second.info.externalUrl = second.info.externalUrl.replaceAll(old, first.req);
  const result = await runSourceCrawl(plan(), { fetch: createAmgenNativeSourceFetch({ http: fixture.http }) });
  expect(result.status).toBe("FAILED");
});
it("stops before retaining a source archive that exceeds the cumulative body budget", async () => {
  const fixture = amgenFixture(20), padding = " ".repeat(900 * 1024);
  const result = await createAmgenNativeSourceFetch({ http: async request => {
    const response = await fixture.http(request);
    return request.url.includes("/job/") ? { ...response, body: response.body + padding } : response;
  } })(plan());
  expect(result.ok).toBe(false);
  expect(fixture.requests.length).toBeLessThan(42);
  expect(result.fetchEvidence!.artifacts.reduce((n, a) => n + Buffer.byteLength(a.body), 0)).toBeLessThanOrEqual(32 * 1024 * 1024);
});
it.each([
  { name: "main heading", code: "AMGEN_NATIVE_DETAIL_TITLE_CONFLICT", mutate: (html: string) => html.replace(/<h1>[^<]+<\/h1>/u, "<h1>Product Owner - Digital Lab Platform</h1>") },
  { name: "native apply identity", code: "AMGEN_NATIVE_DETAIL_APPLY_ID_CONFLICT", mutate: (html: string) => html.replace('data-job-id="100000000"', 'data-job-id="100333338432"') }
])("retains a specific safe failure code for a conflicting $name and never fetches its application", async ({ code, mutate }) => {
  const fixture = amgenFixture(1); fixture.rows[0]!.detail = mutate(fixture.rows[0]!.detail);
  const result = await runSourceCrawl(plan(), { fetch: createAmgenNativeSourceFetch({ http: fixture.http }) });
  expect(result.status).toBe("FAILED");
  expect(result.failureReason).toBe(code);
  expect(safeProfileBoundSourceFailureReason(plan(), code)).toBe(code);
  expect(safeProfileBoundSourceFailureReason(plan(), "untrusted upstream text")).toBeUndefined();
  expect(result.fetchEvidence!.supportingArtifactOnlyFailure?.code).toBe(code);
  expect(fixture.requests.map(r => r.url)).toEqual([fixture.requests[0]!.url, fixture.rows[0]!.url]);
});
