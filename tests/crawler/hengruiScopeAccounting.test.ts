// Synthetic fixtures only. No saved official capture or business row is embedded here.
import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createMokaSourceFetch, type MokaHttpRequest } from "../../src/crawler/mokaSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate, verifyAGradeCompletenessCertificateReceipt } from "../../src/crawler/completenessCertificate";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";

const AT = "2026-10-01T00:00:00.000Z";
const IV = "0123456789abcdef";
const KEY = "fedcba9876543210";
const US = [{ cityName: "沃尔瑟姆", provinceName: "马萨诸塞州", country: "美国" }];
const HK = [{ cityName: "香港", provinceName: "香港", country: "中国", cityId: 810000, provinceId: 810000 }];
const CN = [{ cityName: "上海", provinceName: "上海", country: "中国" }];
const planFor = () => structuredClone(buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-hengrui-social")!);
function encrypt(value: unknown) {
  const cipher = createCipheriv("aes-128-cbc", KEY, IV);
  return JSON.stringify({ data: cipher.update(JSON.stringify(value), "utf8", "base64") + cipher.final("base64"), necromancer: KEY });
}
async function fixture(options: { rows?: any[]; total?: number; hydrate?: boolean; plan?: ReturnType<typeof planFor> } = {}) {
  const plan = options.plan ?? planFor();
  if (plan.adapterId !== "official-json" || !plan.moka) throw Error("Moka plan required");
  const rows = options.rows ?? [
    { id: "synthetic-mainland", title: "Synthetic mainland role", locations: options.hydrate ? [] : CN },
    { id: "synthetic-us", title: "Synthetic foreign role", locations: US }
  ];
  const requests: MokaHttpRequest[] = [];
  const fetched = await createMokaSourceFetch({ now: () => new Date(AT), http: async request => {
    requests.push(request);
    const entry = request.method === "GET";
    const detail = request.url.endsWith("/job");
    const offset = Number(request.body?.offset ?? 0);
    return { status: 200, finalUrl: request.url, capturedAt: AT,
      contentType: entry ? "text/html" : "application/json",
      body: entry ? `<input id="init-data" value='${JSON.stringify({ aesIv: IV, mode: "social", siteId: "145996", org: { id: "hengrui" } })}'>`
        : detail ? JSON.stringify({ id: request.body!.jobId, orgId: "hengrui", siteId: "145996", locations: CN })
        : encrypt({ success: true, data: { jobStats: { total: options.total ?? rows.length }, offset, jobs: rows.slice(offset, offset + 50) } }) };
  } })(plan);
  return { plan, fetched, requests };
}
async function accepted(options: Parameters<typeof fixture>[0] = {}) {
  const result = await fixture(options);
  expect(result.fetched.ok).toBe(true);
  if (!result.fetched.ok || !result.fetched.fetchEvidence || !result.fetched.paginationEvaluation) throw Error("Expected complete fixture");
  return { ...result, fetched: { ...result.fetched, fetchEvidence: result.fetched.fetchEvidence, paginationEvaluation: result.fetched.paginationEvaluation } };
}
function recanonicalize(fetched: Awaited<ReturnType<typeof accepted>>["fetched"]) {
  const evidence = deriveCanonicalPaginationEvidence({ evidence: fetched.fetchEvidence, expectedChannelIds: [], filteredOutput: true });
  fetched.fetchEvidence = evidence;
  fetched.paginationEvaluation = evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true });
}
async function certificate(plan: ReturnType<typeof planFor>, fetched: Awaited<ReturnType<typeof accepted>>["fetched"], officialHash?: string) {
  const result = await runSourceCrawl(plan, { fetch: async () => fetched });
  const evidence = result.fetchEvidence!;
  const declaration = evidence.declaredCompleteness!;
  const artifact = evidence.artifacts.find(a => a.logicalKey === declaration.artifactLogicalKey)!;
  const binding = { releaseCandidateId: "synthetic-candidate", batchId: "synthetic-batch", sourceResultId: "synthetic-result", sourceConfigSha256: sourcePlanConfigSha256(plan) };
  const decision = issueAGradeOfficialTotalCertificate({ binding, plan, transportSuccess: result.truth.transportSuccess,
    adapterSuccess: result.truth.adapterSuccess, evidence, paginationEvaluation: result.paginationEvaluation!,
    reconciliation: result.reconciliation!, jobs: result.jobs,
    officialArtifactSha256: officialHash ?? createHash("sha256").update(artifact.body).digest("hex") });
  return { result, decision, binding };
}

describe("Hengrui independently replayed foreign-scope accounting", () => {
  it("preserves the official raw total and certifies only the mainland subtotal", async () => {
    const { plan, fetched } = await accepted();
    expect(fetched.completeness?.expectedJobCount).toBe(2);
    expect(fetched.fetchEvidence.fetchCounts).toMatchObject({ rawCount: 2, parsedCount: 2, validCount: 1, validationDiscardCount: 1 });
    const { result, decision, binding } = await certificate(plan, fetched);
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(decision.status).toBe("CERTIFIED");
    if (decision.status !== "CERTIFIED") throw Error("Expected certificate");
    expect(decision.certificate.counts).toMatchObject({ officialTotal: 2, rawObservationCount: 2, finalUniqueJobCount: 1, validationDiscardCount: 1 });
    expect(decision.certificate.legalScopeExclusionLedger).toHaveLength(1);
    expect(verifyAGradeCompletenessCertificateReceipt({ certificate: decision.certificate, certificateSha256: decision.certificateSha256,
      expected: { ...binding, sourceId: plan.source.id } }).status).toBe("PASS");
  });
  it("excludes only pinned Hong Kong-only rows, with exact raw accounting", async () => {
    const { plan, fetched } = await accepted({ rows: [
      { id: "synthetic-cn", title: "Mainland", locations: CN },
      { id: "synthetic-hk", title: "Hong Kong", locations: HK },
      { id: "synthetic-us", title: "United States", locations: US }
    ] });
    expect(fetched.fetchEvidence.fetchCounts).toMatchObject({ rawCount: 3, validCount: 1, validationDiscardCount: 2 });
    const { result, decision } = await certificate(plan, fetched);
    expect(result.jobs).toHaveLength(1);
    expect(decision.status).toBe("CERTIFIED");
  });
  it("preserves the mainland alternative of a mixed mainland/Hong Kong row", async () => {
    const { plan, fetched } = await accepted({ rows: [{ id: "synthetic-mixed", title: "Mixed location", locations: [...CN, ...HK] }] });
    const { result, decision } = await certificate(plan, fetched);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]!.cities).toEqual(["上海"]);
    expect(fetched.fetchEvidence.fetchLosses).toHaveLength(0);
    expect(decision.status).toBe("CERTIFIED");
  });
  it.each([
    ["wrong city ID", { ...HK[0], cityId: 310000 }],
    ["wrong province ID", { ...HK[0], provinceId: 310000 }],
    ["missing city ID", { ...HK[0], cityId: undefined }],
    ["contradictory city", { ...HK[0], cityName: "上海" }],
    ["contradictory province", { ...HK[0], provinceName: "广东" }]
  ])("rejects Hong Kong exclusion with %s", async (_label, location) => {
    const { plan, fetched } = await fixture({ rows: [{ id: "synthetic-hk-ambiguous", title: "Ambiguous", locations: [location] }] });
    if (fetched.ok) expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(false);
    else expect(fetched.ok).toBe(false);
  });
  it("rejects a forged certificate official-artifact digest", async () => {
    const { plan, fetched } = await accepted();
    const { decision } = await certificate(plan, fetched, "0".repeat(64));
    expect(decision.status).toBe("REJECTED");
    if (decision.status === "REJECTED") expect(decision.blockerCodes).toContain("OFFICIAL_ARTIFACT_INVALID");
  });
  it("rejects contradictory region IDs on an otherwise exact US exclusion", async () => {
    const { fetched } = await fixture({ rows: [
      { id: "synthetic-mainland", title: "Mainland", locations: CN },
      { id: "synthetic-us-contradiction", title: "Contradictory US", locations: [{ ...US[0], cityId: 810000, provinceId: 810000 }] }
    ] });
    expect(fetched.ok).toBe(false);
  });
  it.each([
    ["countryCode", { ...CN[0], countryCode: "US" }],
    ["countryId", { ...CN[0], countryId: 810000 }],
    ["nested locality", { ...CN[0], locality: { cityName: "London", country: "UK" } }],
    ["nested province", { ...CN[0], provinceName: { name: "Shanghai" } }],
    ["US countryCode", { ...US[0], countryCode: "CN" }],
    ["HK countryId", { ...HK[0], countryId: "US" }]
  ])("rejects an unsupported or nested geography field: %s", async (_label, location) => {
    const { fetched } = await fixture({ rows: [
      { id: "synthetic-mainland", title: "Mainland", locations: CN },
      { id: "synthetic-unsupported-location", title: "Unsupported location", locations: [location] }
    ] });
    expect(fetched.ok).toBe(false);
  });
  it("retains exact detail hydration for included rows", async () => {
    const { plan, fetched } = await accepted({ hydrate: true });
    expect((await certificate(plan, fetched)).decision.status).toBe("CERTIFIED");
  });
  it("uses page-qualified loss identities when two pages exclude the same row index", async () => {
    const rows = Array.from({ length: 52 }, (_, i) => ({ id: `synthetic-${i}`, title: `Synthetic role ${i}`, locations: i === 1 || i === 51 ? US : CN }));
    const { plan, fetched } = await accepted({ rows });
    const { decision, binding } = await certificate(plan, fetched);
    expect(decision.status).toBe("CERTIFIED");
    if (decision.status !== "CERTIFIED") throw Error("Expected certificate");
    expect(verifyAGradeCompletenessCertificateReceipt({ certificate: decision.certificate, certificateSha256: decision.certificateSha256, expected: { ...binding, sourceId: plan.source.id } }).status).toBe("PASS");
  });
  it.each([
    ["missing loss", (f: any) => { f.fetchEvidence.fetchLosses = []; }],
    ["duplicate loss", (f: any) => { f.fetchEvidence.fetchLosses.push(structuredClone(f.fetchEvidence.fetchLosses[0])); }],
    ["forged raw hash", (f: any) => { f.fetchEvidence.fetchLosses[0].rawLocator = f.fetchEvidence.fetchLosses[0].rawLocator.replace(/sha256:.+/, `sha256:${"0".repeat(64)}`); }],
    ["wrong loss index", (f: any) => { f.fetchEvidence.fetchLosses[0].details.recordIndex = 0; }],
    ["unknown loss", (f: any) => { f.fetchEvidence.fetchLosses[0].details.code = "UNKNOWN"; }],
    ["compound loss", (f: any) => { f.fetchEvidence.fetchLosses[0].details.field = "title"; }],
    ["wrong stage", (f: any) => { f.fetchEvidence.fetchLosses[0].stage = "PARSE"; }],
    ["tampered output title", (f: any) => { f.payload.data.jobs[0].title = "Injected title"; }],
    ["tampered output URL", (f: any) => { f.payload.data.jobs[0].officialUrl += "x"; }],
    ["tampered output location", (f: any) => { f.payload.data.jobs[0].locationRaw = "北京"; f.payload.data.jobs[0].cities = ["北京"]; }],
    ["tampered output identity", (f: any) => { f.payload.data.jobs[0].id = "sha256:" + "0".repeat(64); }],
    ["missing all losses with forged lossless counters", (f: any) => {
      f.fetchEvidence.fetchLosses = [];
      f.fetchEvidence.fetchCounts.validationDiscardCount = 0;
      f.fetchEvidence.fetchCounts.validCount = f.fetchEvidence.fetchCounts.rawCount;
      f.fetchEvidence.pages[0].validJobIds = [...f.fetchEvidence.pages[0].rawJobIds];
      recanonicalize(f);
    }],
    ["wrong page capture time", (f: any) => { f.fetchEvidence.pages[0].capturedAt = "2026-10-01T00:00:01.000Z"; recanonicalize(f); }],
    ["forged primary eligibility", (f: any) => { f.fetchEvidence.fetchLosses[0].details.code = "UNKNOWN"; f.paginationEvaluation.verifiedEligible = true; }],
    ["wrong request contract", (f: any) => { f.fetchEvidence.artifacts[1].extractorLocator = f.fetchEvidence.artifacts[1].extractorLocator.replace(/sha256:.+/, `sha256:${"0".repeat(64)}`); }],
    ["wrong artifact hash", (f: any) => { f.fetchEvidence.pages[0].responseFingerprintSha256 = "0".repeat(64); }]
  ])("rejects %s", async (_label, mutate) => {
    const { plan, fetched } = await accepted();
    mutate(fetched);
    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(false);
  });
  it("rejects substituting the mainland subtotal for the official total", async () => {
    const { plan, fetched } = await accepted();
    fetched.fetchEvidence.declaredCompleteness!.value = 1;
    fetched.fetchEvidence.pages[0]!.declaredTotal = 1;
    try { recanonicalize(fetched); } catch { /* malformed evidence is also fail-closed */ }
    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(false);
  });
  it.each([
    ["China-labelled London", [{ cityName: "伦敦", provinceName: "英格兰", country: "中国" }]],
    ["China-labelled San Francisco", [{ cityName: "旧金山", provinceName: "加利福尼亚州", country: "中国" }]],
    ["unknown city under a mainland province", [{ cityName: "Unknown City", provinceName: "浙江", country: "中国", provinceId: 330000, cityId: 330282 }]],
    ["mainland city with foreign province", [{ cityName: "上海", provinceName: "英格兰", country: "中国" }]],
    ["contradictory mainland province", [{ cityName: "广州", provinceName: "浙江", country: "中国" }]],
    ["mainland label with Hong Kong region IDs", [{ cityName: "上海", provinceName: "上海", country: "中国", cityId: 810000, provinceId: 810000 }]],
    ["unknown country", [{ cityName: "Synthetic city", country: "Unknown" }]],
    ["missing country", [{ cityName: "Synthetic city" }]],
    ["contradictory mainland city", [{ cityName: "上海", country: "美国" }]],
    ["mixed unproven location", [...US, { cityName: "Synthetic city" }]],
    ["mixed mainland location", [...US, ...CN]]
  ])("does not admit %s as an exclusion proof", async (_label, locations) => {
    const { plan, fetched } = await fixture({ rows: [{ id: "synthetic-ambiguous", title: "Synthetic role", locations }] });
    if (fetched.ok) expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(false);
    else expect(fetched.ok).toBe(false);
  });
  it.each(["source", "company", "org", "site", "policy", "json"])("rejects mismatched %s binding", async kind => {
    const { plan, fetched } = await accepted();
    const changed = structuredClone(plan) as any;
    if (kind === "source") changed.source.id = "source-other";
    if (kind === "company") changed.company.id = "company-other";
    if (kind === "org") changed.moka.expectedOrgId = "other";
    if (kind === "site") changed.moka.expectedSiteId = "other";
    if (kind === "policy") changed.moka.scopeExclusionProof = "OTHER";
    if (kind === "json") changed.json.fields.officialTitle = "other";
    expect((await runSourceCrawl(changed, { fetch: async () => fetched })).truth.completenessVerified).toBe(false);
  });
  it("retains explicit China-wide evidence only when no contradictory locality or region ID is supplied", async () => {
    const { plan, fetched } = await accepted({ rows: [{ id: "synthetic-nationwide", title: "Nationwide", locations: [{ country: "中国" }] }] });
    const { result, decision } = await certificate(plan, fetched);
    expect(result.jobs[0]!.cities).toEqual(["中国"]);
    expect(decision.status).toBe("CERTIFIED");
  });
  it("leaves generic Moka foreign losses fail-closed without the source policy", async () => {
    const plan = planFor() as any;
    delete plan.moka.scopeExclusionProof;
    const { fetched } = await fixture({ plan });
    expect(fetched.ok).toBe(false);
  });
});
