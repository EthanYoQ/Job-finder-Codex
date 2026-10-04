import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { AMGEN_NATIVE_CONFIG, createAmgenNativeSourceFetch } from "../../src/crawler/amgenNativeSourceFetch";
import { createAmgenManualWorkdaySourceFetch, validateStrictAmgenManualWorkdayEvidence } from "../../src/crawler/amgenManualWorkdaySourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { amgenManualWorkdayFixture, AMGEN_CHINA_ID, AMGEN_LOOKUP_ENDPOINT, AMGEN_MANUAL_WORKDAY_CONFIG } from "../helpers/amgenManualWorkdayFixture";
import { AMGEN_ENTRY, AMGEN_ENDPOINT, AMGEN_TIME } from "../helpers/amgenNativeFixture";

type Fixture = ReturnType<typeof amgenManualWorkdayFixture>;
const hash = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
const now = () => new Date(AMGEN_TIME);
function plan(): SourceCrawlPlan {
  const p = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-amgen-china-social")!;
  return { ...p, profileBoundSource: { kind: "amgen-manual-workday-lookup", config: AMGEN_MANUAL_WORKDAY_CONFIG } } as SourceCrawlPlan;
}
function legacyPlan(): SourceCrawlPlan {
  return { ...plan(), profileBoundSource: { kind: "amgen-native-china", config: AMGEN_NATIVE_CONFIG } } as SourceCrawlPlan;
}
async function acquire(total = 13) {
  const fixture = amgenManualWorkdayFixture(total), p = plan();
  const result = await runSourceCrawl(p, { fetch: createAmgenManualWorkdaySourceFetch({ http: fixture.http, now }) });
  return { fixture, p, result };
}
function editSchema(fixture: Fixture, mutate: (schema: Record<string, any>) => void) {
  const row = fixture.rows[0]!;
  row.detail = row.detail.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/u, (_, start, raw, end) => {
    const schema = JSON.parse(raw); mutate(schema); return start + JSON.stringify(schema) + end;
  });
}

it("binds the registered V2 source to the original complete manual entry", () => {
  const p = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-amgen-china-social")!;
  expect(p.source.officialEntryUrl).toBe(AMGEN_ENTRY);
  expect(p.adapterId === "official-json" && p.profileBoundSource).toEqual({ kind: "amgen-manual-workday-lookup", config: AMGEN_MANUAL_WORKDAY_CONFIG });
});

it("certifies all 13 manual jobs with a 15-job lookup catalogue without counting or discarding the extra two", async () => {
  const { fixture, p, result } = await acquire();
  expect(result.status).toBe("SUCCESS");
  expect(result.jobs).toHaveLength(13);
  expect(result.jobs.map(j => j.sourceJobId)).toEqual(fixture.rows.map(r => r.sourceJobId));
  expect(result.jobs.map(j => j.officialUrl)).toEqual(fixture.rows.map(r => r.externalUrl));
  expect(result.jobs.every(j => j.listUrl === AMGEN_ENTRY && j.officialPublishedAt === undefined)).toBe(true);
  const evidence = result.fetchEvidence!;
  expect(evidence.declaredCompleteness).toMatchObject({ scope: "SOURCE", kind: "OFFICIAL_TOTAL_COUNT", value: 13 });
  expect(evidence.pages).toHaveLength(2);
  expect(evidence.fetchCounts).toEqual({ rawCount: 13, parsedCount: 13, validCount: 13, parseDiscardCount: 0, validationDiscardCount: 0 });
  expect(evidence.fetchLosses).toEqual([]);
  expect(evidence.pages.reduce((n, page) => n + page.rawJobIds.length, 0)).toBe(13);
  expect(fixture.requests.filter(r => r.url === AMGEN_ENDPOINT).map(r => [r.method, JSON.parse(r.body!).CurrentPage])).toEqual([["POST", 2]]);
  expect(fixture.requests.filter(r => r.url === AMGEN_LOOKUP_ENDPOINT).map(r => [r.method, JSON.parse(r.body!)])).toEqual([
    ["POST", { appliedFacets: { LocationCountry: [AMGEN_CHINA_ID] }, limit: 20, offset: 0 }]
  ]);
  expect(fixture.requests.filter(r => r.url.includes("/wday/cxs/amgen/Careers/job/")).map(r => r.url)).toEqual(fixture.rows.map(r => r.apiUrl));
  expect(fixture.catalogueOnlyRows.every(extra => !fixture.requests.some(r => r.url === extra.apiUrl || r.url === extra.url))).toBe(true);
  expect(validateStrictAmgenManualWorkdayEvidence(p, evidence, result.jobs)).toBe(true);
  const declaration = evidence.artifacts.find(a => a.logicalKey === evidence.declaredCompleteness!.artifactLogicalKey)!;
  expect(declaration.requestedUrl).toBe(AMGEN_ENTRY);
  const report = evidence.artifacts.find(a => a.logicalKey === "amgen-v2-binding-report")!;
  expect(report.kind).toBe("ORACLE_RESULT");
  expect(JSON.parse(String(report.body))).toMatchObject({ manualTotal: 13, lookupTotal: 15, lookupOnlyReqIds: fixture.catalogueOnlyRows.map(r => r.req) });
  const decision = issueAGradeOfficialTotalCertificate({ plan: p, transportSuccess: true, adapterSuccess: true, evidence, paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!, jobs: result.jobs, officialArtifactSha256: hash(declaration.body), binding: { releaseCandidateId: "test-amgen-v2", batchId: "test-amgen-v2-batch", sourceResultId: "test-amgen-v2-result", sourceConfigSha256: sourcePlanConfigSha256(p) } });
  expect(decision.status).toBe("CERTIFIED");
  if (decision.status === "CERTIFIED") expect(decision.certificate.counts).toMatchObject({ officialTotal: 13, rawObservationCount: 13, rawUniqueOfficialRecordCount: 13, parsedCount: 13, validCount: 13, normalizedCount: 13, finalUniqueJobCount: 13, parseDiscardCount: 0, validationDiscardCount: 0 });
});

it("fully traverses lookup offsets with first-page total and later-page zero totals", async () => {
  const { fixture, p, result } = await acquire(21);
  expect(result.status).toBe("SUCCESS");
  expect(result.jobs).toHaveLength(21);
  expect(fixture.requests.filter(r => r.url === AMGEN_LOOKUP_ENDPOINT).map(r => JSON.parse(r.body!))).toEqual([
    { appliedFacets: { LocationCountry: [AMGEN_CHINA_ID] }, limit: 20, offset: 0 },
    { appliedFacets: { LocationCountry: [AMGEN_CHINA_ID] }, limit: 20, offset: 20 }
  ]);
  const lookupArtifacts = result.fetchEvidence!.artifacts.filter(a => a.requestedUrl === AMGEN_LOOKUP_ENDPOINT);
  expect(lookupArtifacts.map(a => JSON.parse(String(a.body)).total)).toEqual([23, 0]);
  expect(validateStrictAmgenManualWorkdayEvidence(p, result.fetchEvidence!, result.jobs)).toBe(true);
});

it("preserves true -1 observed path identity rather than inventing an unsuffixed application path", async () => {
  const { fixture, result } = await acquire(1), row = fixture.rows[0]!;
  expect(result.status).toBe("SUCCESS");
  expect(row.path.endsWith(`${row.req}-1`)).toBe(true);
  expect(result.jobs[0]!.sourceJobId).toBe(`workday:sha256:${hash(row.path)}`);
  expect(result.jobs[0]!.sourceJobId).not.toBe(`workday:sha256:${hash(row.path.replace(/-1$/u, ""))}`);
  expect(result.jobs[0]!.officialUrl).toBe(row.externalUrl);
  expect(fixture.requests.some(r => r.url === row.apiUrl)).toBe(true);
  expect(fixture.requests.some(r => r.url === row.apiUrl.replace(/-1$/u, ""))).toBe(false);
});

it("archives conflicting native heading, main IDs and Indian apply links only as diagnostics", async () => {
  const fixture = amgenManualWorkdayFixture(1), row = fixture.rows[0]!;
  const indian = "https://amgen.wd1.myworkdayjobs.com/Careers/job/India---Hyderabad/Product-Owner_R-99999";
  row.detail = row.detail.replace(/<h1>[^<]+<\/h1>/u, '<main data-job-id="100333338432"><h1>Product Owner - Digital Lab Platform</h1><p>India - Hyderabad</p></main>')
    .replaceAll(row.externalUrl, indian).replace(`data-job-id="${row.id}"`, 'data-job-id="100333338432"');
  const p = plan(), result = await runSourceCrawl(p, { fetch: createAmgenManualWorkdaySourceFetch({ http: fixture.http, now }) });
  expect(result.status).toBe("SUCCESS");
  expect(result.jobs[0]).toMatchObject({ officialTitle: row.title, officialUrl: row.externalUrl, cities: ["上海"] });
  expect(fixture.requests.some(r => r.url.includes("R-99999") || r.url.endsWith("/apply"))).toBe(false);
  expect(result.fetchEvidence!.artifacts.find(a => a.requestedUrl === row.url)!.body).toBe(row.detail);
  const report = JSON.parse(String(result.fetchEvidence!.artifacts.find(a => a.logicalKey === "amgen-v2-binding-report")!.body));
  expect(report.bindings[0]).toMatchObject({ numericId: row.id, reqId: row.req, externalPath: row.path, officialUrl: row.externalUrl, application: { landingUrl: row.externalUrl, canApply: true, posted: true }, displayConflict: { hasConflict: true } });
  expect(JSON.stringify(report.bindings[0].displayConflict)).toContain("Product Owner - Digital Lab Platform");
  expect(JSON.stringify(report.bindings[0].displayConflict)).toContain("R-99999");
  expect(validateStrictAmgenManualWorkdayEvidence(p, result.fetchEvidence!, result.jobs)).toBe(true);
  const old = await createAmgenNativeSourceFetch({ http: fixture.http, now })(legacyPlan());
  expect(old.ok).toBe(false);
});

const mutations: Array<[string, (fixture: Fixture) => void]> = [
  ["wrong native canonical URL", f => { f.rows[0]!.detail = f.rows[0]!.detail.replace('<link rel="canonical" href="' + f.rows[0]!.url, '<link rel="canonical" href="https://careers.amgen.com/en/job/other/role/87/999'); }],
  ["JSON-LD URL mismatch", f => editSchema(f, s => { s.url += "-changed"; })],
  ["JSON-LD requisition mismatch", f => editSchema(f, s => { s.identifier = "R-99999"; })],
  ["JSON-LD title mismatch", f => editSchema(f, s => { s.title = "Unrelated role"; })],
  ["JSON-LD location mismatch", f => editSchema(f, s => { s.jobLocation[0].address.addressLocality = "Beijing"; })],
  ["JSON-LD description mismatch", f => editSchema(f, s => { s.description = "<p>Completely unrelated official description</p>"; })],
  ["Workday requisition mismatch", f => { f.rows[0]!.info.jobReqId = "R-99999"; }],
  ["Workday posting path mismatch", f => { f.rows[0]!.info.externalUrl += "-changed"; }],
  ["Workday title mismatch", f => { f.rows[0]!.info.title = "Unrelated role"; }],
  ["Workday location mismatch", f => { f.rows[0]!.info.location = "China - Beijing"; }],
  ["unposted Workday detail", f => { f.rows[0]!.info.posted = false; }],
  ["closed Workday application", f => { f.rows[0]!.info.canApply = false; }],
  ["foreign Workday country", f => { f.rows[0]!.info.country = { id: "india-country", descriptor: "India" }; }],
  ["missing manual requisition in lookup", f => { f.lookupRows.shift(); }],
  ["lookup title mismatch", f => { f.lookupRows[0]!.title = "Unrelated role"; }],
  ["lookup location mismatch", f => { f.lookupRows[0]!.locationsText = "China - Beijing"; }],
  ["lookup requisition/path disagreement", f => { f.lookupRows[0]!.bulletFields = ["R-99999"]; }],
  ["duplicate lookup path", f => { f.lookupRows[1]!.externalPath = f.lookupRows[0]!.externalPath; }],
  ["duplicate lookup requisition even on another path", f => { f.lookupRows[1]!.bulletFields = [...f.lookupRows[0]!.bulletFields]; f.lookupRows[1]!.externalPath = `/job/China---Shanghai/Duplicate_${f.rows[0]!.req}`; }]
];
it.each(mutations)("fails closed for %s", async (_, mutate) => {
  const fixture = amgenManualWorkdayFixture(1); mutate(fixture);
  const result = await createAmgenManualWorkdaySourceFetch({ http: fixture.http, now })(plan());
  expect(result.ok).toBe(false);
});

it.each([
  ["wrong China scope", (body: ReturnType<Fixture["lookupPage"]>) => { body.facets[0]!.values[0]!.id = "india-country"; }],
  ["wrong China facet count", (body: ReturnType<Fixture["lookupPage"]>) => { body.facets[0]!.values[0]!.count--; }],
  ["truncated catalogue", (body: ReturnType<Fixture["lookupPage"]>) => { body.jobPostings.pop(); }]
] as const)("rejects %s in the lookup response", async (_, mutate) => {
  const fixture = amgenManualWorkdayFixture(1);
  const result = await createAmgenManualWorkdaySourceFetch({ now, http: async request => {
    const response = await fixture.http(request);
    if (request.url !== AMGEN_LOOKUP_ENDPOINT) return response;
    const body = JSON.parse(response.body); mutate(body); return { ...response, body: JSON.stringify(body) };
  } })(plan());
  expect(result.ok).toBe(false);
});

it.each(["missing page", "duplicate across pages", "changed later total"])("rejects lookup pagination with %s", async failure => {
  const fixture = amgenManualWorkdayFixture(21);
  const result = await createAmgenManualWorkdaySourceFetch({ now, http: async request => {
    const response = await fixture.http(request);
    if (request.url !== AMGEN_LOOKUP_ENDPOINT || JSON.parse(request.body!).offset !== 20) return response;
    if (failure === "missing page") return { ...response, status: 503 };
    const body = JSON.parse(response.body);
    if (failure === "duplicate across pages") body.jobPostings[0] = fixture.lookupRows[0];
    else body.total = 24;
    return { ...response, body: JSON.stringify(body) };
  } })(plan());
  expect(result.ok).toBe(false);
});

it.each(["2026-09-30T12:00:00.000Z", "2026-10-02T12:11:00.000Z"])("rejects detail evidence outside the single capture window: %s", async capturedAt => {
  const fixture = amgenManualWorkdayFixture(1);
  const result = await createAmgenManualWorkdaySourceFetch({ now, http: async request => {
    const response = await fixture.http(request);
    return request.url === fixture.rows[0]!.apiUrl ? { ...response, capturedAt } : response;
  } })(plan());
  expect(result.ok).toBe(false);
});

it("replays archived lookup, binding report, exact request contract and capture time rather than trusting claims", async () => {
  const { fixture, p, result } = await acquire(1);
  expect(result.status).toBe("SUCCESS");
  type Evidence = NonNullable<typeof result.fetchEvidence>;
  const lookup = (e: Evidence) => e.artifacts.find(a => a.requestedUrl === AMGEN_LOOKUP_ENDPOINT)!;
  const report = (e: Evidence) => e.artifacts.find(a => a.logicalKey === "amgen-v2-binding-report")!;
  const mutations: Array<(e: Evidence) => void> = [
    e => { e.artifacts.splice(e.artifacts.indexOf(lookup(e)), 1); },
    e => { lookup(e).body = String(lookup(e).body).replace(fixture.rows[0]!.req, "R-99999"); },
    e => { lookup(e).extractorLocator += "changed"; },
    e => { lookup(e).requestedUrl += "?offset=20"; },
    e => { lookup(e).capturedAt = "2026-09-30T12:00:00.000Z"; },
    e => { lookup(e).bodyRepresentation = "REDACTED"; },
    e => { const body = JSON.parse(String(report(e).body)); body.lookupTotal++; report(e).body = JSON.stringify(body); },
    e => { e.artifacts.splice(e.artifacts.indexOf(report(e)), 1); },
    e => { e.declaredCompleteness!.value = 3; },
    e => { e.pages[0]!.declaredTotal = 3; },
    e => { e.fetchCounts.rawCount = 3; }
  ];
  for (const mutate of mutations) {
    const evidence = structuredClone(result.fetchEvidence!); mutate(evidence);
    expect(validateStrictAmgenManualWorkdayEvidence(p, evidence, result.jobs)).toBe(false);
  }
});

it("rejects normalized output changes and V1 policy relabeling", async () => {
  const { fixture, p, result } = await acquire(1);
  expect(result.status).toBe("SUCCESS");
  const mutations: Array<(j: typeof result.jobs[number]) => void> = [
    j => { j.officialTitle = "changed"; },
    j => { j.officialUrl = fixture.rows[0]!.url; },
    j => { j.sourceJobId += "-1"; },
    j => { j.cities = ["北京"]; },
    j => { j.locationRaw = "China - Beijing"; },
    j => { j.officialPublishedAt = AMGEN_TIME; }
  ];
  for (const mutate of mutations) {
    const jobs = structuredClone(result.jobs); mutate(jobs[0]!);
    expect(validateStrictAmgenManualWorkdayEvidence(p, result.fetchEvidence!, jobs)).toBe(false);
  }
  expect(validateStrictAmgenManualWorkdayEvidence(p, result.fetchEvidence!, [])).toBe(false);
  expect(validateStrictAmgenManualWorkdayEvidence(p, result.fetchEvidence!, [...result.jobs, result.jobs[0]!])).toBe(false);
  expect(validateStrictAmgenManualWorkdayEvidence(legacyPlan(), result.fetchEvidence!, result.jobs)).toBe(false);
  expect((await createAmgenManualWorkdaySourceFetch({ http: fixture.http, now })(legacyPlan())).ok).toBe(false);
});
