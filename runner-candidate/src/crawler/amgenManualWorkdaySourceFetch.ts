import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { load } from "cheerio";
import { AMGEN_NATIVE_ENTRY, amgenNativeListReplay } from "./amgenNativeSourceFetch";
import { WORKDAY_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { parsePersistentSourceFetchEvidence, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { fetchWorkdayMainlandHttp, projectAmgenNativeCities } from "./workdayMainlandQuality";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceFetchFunction } from "./runSourceCrawl";
import type { StrictProfileBoundSourcePolicy } from "./profileBoundSourceEvidence";

export const AMGEN_MANUAL_WORKDAY_CONFIG = Object.freeze({ policy: "AMGEN_MANUAL_WORKDAY_LOOKUP_V2", pageSize: 12, maxPages: 30, lookupPageSize: 20, lookupMaxPages: 30 } as const);
export type AmgenManualWorkdayConfig = typeof AMGEN_MANUAL_WORKDAY_CONFIG;
const ORIGIN = "https://careers.amgen.com", WD = "https://amgen.wd1.myworkdayjobs.com";
const PAGES = `${ORIGIN}/en/search-jobs/resultspost`, LOOKUP = `${WD}/wday/cxs/amgen/Careers/jobs`;
const CHAIN = `${ORIGIN}/en/location/china-jobs/87/1814991/2`, CHINA = "6cb77610a8a543aea2d6bc10457e35d4";
const REPORT = "amgen-v2-binding-report", LIMIT = 32 * 1024 * 1024, WINDOW = 10 * 60 * 1000;
const FAILURE = "AMGEN_MANUAL_WORKDAY_INVALID";
type Request = { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string };
type Response = { body: string; status: number; finalUrl?: string; contentType?: string; capturedAt?: string };
type Http = (request: Request) => Promise<Response>;
type Role = "list" | "lookup" | "identity" | "application";
type Row = { id: string; title: string; url: string };
type LookupRow = { req: string; title: string; path: string; location: string };
const { parsePage, pageBody, pageTrace } = amgenNativeListReplay;
const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const clean = (v: string) => v.replace(/\s+/gu, " ").trim();
const nonempty = (v: unknown): v is string => typeof v === "string" && clean(v).length > 0;
function assert(v: unknown): asserts v { if (!v) throw Error(FAILURE); }
const object = (v: unknown): Record<string, unknown> => { assert(v && typeof v === "object" && !Array.isArray(v)); return v as Record<string, unknown>; };
const json = (v: string) => { assert(hasUniqueJsonObjectKeys(v)); return object(JSON.parse(v)); };
const key = (role: Role, index: number) => `amgen-v2-${role}-${String(index).padStart(4, "0")}`;
const request = (url: string, body?: unknown): Request => ({ url, method: body === undefined ? "GET" : "POST", headers: { Accept: "text/html,application/json", ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const lookupRequest = (index: number) => request(LOOKUP, { appliedFacets: { LocationCountry: [CHINA] }, limit: 20, offset: index * 20 });
const options = { expectedChannelIds: [] as string[], filteredOutput: true, allowPositiveOfficialTotalCountAfterAdapterReconciliation: true as const };
function exactPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.company.id === "company-amgen-china" && plan.source.id === "source-amgen-china-social" &&
    plan.source.companyId === plan.company.id && plan.company.officialChineseName === "安进中国" && plan.company.category === "FOREIGN_PHARMA" &&
    plan.source.kind === "SOCIAL" && plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === AMGEN_NATIVE_ENTRY && plan.source.officialChainEvidenceUrl === CHAIN &&
    same(plan.profileBoundSource, { kind: "amgen-manual-workday-lookup", config: AMGEN_MANUAL_WORKDAY_CONFIG }) && same(plan.json, WORKDAY_JSON_CONFIG) &&
    !plan.workday && !plan.officialJsonFetch && !plan.moka && !plan.hotjob && !plan.hotjobLegacy;
}
function artifact(role: Role, index: number, req: Request, response: Response, now: string): SourceFetchArtifactDraft {
  const mime = role === "lookup" || role === "application" || role === "list" && index > 1 ? /^application\/json(?:;|$)/iu : /^text\/html(?:;|$)/iu;
  assert(response.status === 200 && response.finalUrl === req.url && typeof response.body === "string" && Buffer.byteLength(response.body) <= 2 * 1024 * 1024 && mime.test(response.contentType ?? ""));
  const capturedAt = response.capturedAt ?? now; assert(Number.isFinite(Date.parse(capturedAt)));
  return { id: key(role, index), logicalKey: key(role, index), kind: role === "list" ? "PAGINATION_PAGE" : role === "identity" ? "ATS_PAGE" : "ATS_API_RESPONSE",
    requestedUrl: req.url, finalUrl: req.url, httpStatus: 200, contentType: response.contentType!, capturedAt, body: response.body, bodyRepresentation: "EXACT",
    extractorLocator: requestContractV2Locator(role === "list" ? "#search-results@data-total-job-results" : role === "lookup" ? "$.jobPostings:lookup-only" : role === "identity" ? "schema:JobPosting:identity-only" : "$.jobPostingInfo", {
      family: role === "lookup" || role === "application" ? "workday" : "html", role: `amgen-manual-workday-v2-${role}`, method: req.method, url: req.url,
      body: req.body ? JSON.parse(req.body) : null, coordinate: { index }
    }) };
}
function lookupPage(body: string, index: number, declared?: number): { total: number; rows: LookupRow[] } {
  const root = json(body), total = index === 0 ? root.total : declared;
  assert(Number.isSafeInteger(total) && (total as number) >= 0 && (total as number) <= 20 * AMGEN_MANUAL_WORKDAY_CONFIG.lookupMaxPages && Array.isArray(root.jobPostings));
  assert(index === 0 || root.total === 0 || root.total === total);
  assert(root.jobPostings.length === Math.min(20, (total as number) - index * 20));
  if (index === 0) {
    assert(Array.isArray(root.facets));
    const country = root.facets.map(object).filter(f => f.facetParameter === "LocationCountry");
    assert(country.length === 1 && Array.isArray(country[0]!.values));
    const china = country[0]!.values.map(object).filter(v => v.id === CHINA || v.descriptor === "China");
    assert(china.length === 1 && china[0]!.id === CHINA && china[0]!.descriptor === "China" && china[0]!.count === total);
  }
  const rows = root.jobPostings.map(value => {
    const r = object(value); assert(nonempty(r.title) && nonempty(r.externalPath) && nonempty(r.locationsText) && Array.isArray(r.bulletFields) && r.bulletFields.length === 1);
    const req = r.bulletFields[0], match = /^\/job\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+_(R-[1-9]\d*)(?:-[1-9]\d*)?$/u.exec(r.externalPath);
    assert(nonempty(req) && match?.[1] === req && (/^China\s+- /u.test(r.locationsText) || /^[2-9]\d* Locations$/u.test(r.locationsText)));
    return { req, title: clean(r.title), path: r.externalPath, location: r.locationsText };
  });
  assert(new Set(rows.map(r => r.req)).size === rows.length && new Set(rows.map(r => r.path)).size === rows.length);
  return { total: total as number, rows };
}
function identity(html: string, row: Row) {
  const $ = load(html), scripts = $("script[type='application/ld+json']");
  assert(scripts.length === 1 && $("link[rel='canonical']").length === 1 && $("link[rel='canonical']").attr("href") === row.url);
  const schema = json(scripts.text());
  const identifier = typeof schema.identifier === "string" ? schema.identifier : object(schema.identifier);
  if (typeof identifier !== "string") assert(identifier["@type"] === "PropertyValue" && identifier.name === "Job ID" && same(Object.keys(identifier).sort(), ["@type", "name", "value"]));
  const req = typeof identifier === "string" ? identifier : identifier.value;
  assert(schema["@type"] === "JobPosting" && schema.url === row.url && schema.title === row.title && typeof req === "string" && /^R-[1-9]\d*$/u.test(req) &&
    object(schema.hiringOrganization).name === "Amgen" && nonempty(schema.description) && load(schema.description).text().trim().length > 20 && Array.isArray(schema.jobLocation) && schema.jobLocation.length > 0);
  const locations = schema.jobLocation.map(v => object(object(v).address));
  assert(locations.every(a => a.addressCountry === "China" && nonempty(a.addressLocality) && nonempty(a.addressRegion) && !/Hong Kong|Macau|Macao|Taiwan|香港|澳门|台湾/iu.test(`${a.addressLocality} ${a.addressRegion}`)));
  return { req, description: schema.description, locations };
}
function project(row: Row, html: string, lookup: LookupRow, body: string) {
  const id = identity(html, row), root = json(body), info = object(root.jobPostingInfo), country = object(info.country), requisition = object(info.jobRequisitionLocation), reqCountry = object(requisition.country);
  const officialUrl = `${WD}/Careers${lookup.path}`;
  assert(id.req === lookup.req && root.userAuthenticated === false && info.jobReqId === id.req && info.jobPostingId === lookup.path.split("/").at(-1) &&
    info.jobPostingSiteId === "Careers" && info.externalUrl === officialUrl && nonempty(info.title) && info.posted === true && info.canApply === true &&
    country.id === CHINA && country.descriptor === "China" && reqCountry.id === CHINA && reqCountry.descriptor === "China" && reqCountry.alpha2Code === "CN" && nonempty(requisition.descriptor) &&
    nonempty(info.jobDescription) && nonempty(info.location) && (info.additionalLocations === undefined || Array.isArray(info.additionalLocations)));
  // Workday wraps the same complete JD with its category heading and a trailing dot.
  // Do not accept arbitrary containment or use the conflicting visible TalentBrew JD.
  const text = (v: string) => load(v).text().replace(/\s+/gu, "").normalize("NFKC");
  const jd = text(id.description), wd = text(info.jobDescription), pos = wd.indexOf(jd);
  assert(wd === jd || pos > 0 && /^CareerCategory[A-Za-z&/()-]{1,100}JobDescription$/u.test(wd.slice(0, pos)) && wd.slice(pos + jd.length) === ".");
  const locations: unknown[] = [info.location, ...(info.additionalLocations as unknown[] | undefined ?? [])];
  assert(locations.every(nonempty) && locations.length === id.locations.length && new Set(locations).size === locations.length);
  assert(lookup.location === info.location && locations.length === 1 || lookup.location === `${locations.length} Locations` && locations.length > 1);
  for (let i = 0; i < locations.length; i++) { const name = (locations[i] as string).replace(/^China\s+- /u, ""), address = id.locations[i]!;
    assert(name === address.addressLocality || name === "Yulin (Shaanxi)" && address.addressLocality === "Yulin" && address.addressRegion === "Shaanxi"); }
  const cities = projectAmgenNativeCities(info.title as string, locations as string[], requisition.descriptor); assert(cities);
  const $ = load(html), heading = clean($("h1").text()), mainJobIds = $("main#content section.job-description[data-selector-name='jobdetails']").map((_, node) => $(node).attr("data-job-id") ?? "").get();
  const applyLinks = $("a.job-apply").toArray().map(node => ({ numericId: $(node).attr("data-job-id") ?? "", orgId: $(node).attr("data-job-organization-id") ?? "", href: $(node).attr("href") ?? "", dataApplyUrl: $(node).attr("data-apply-url") ?? "" }));
  const expectedNativeApplyRoute = `${officialUrl}/apply`; // Comparison only; never fetched or published as observed evidence.
  const hasConflict = heading !== row.title || mainJobIds.some(v => v !== row.id) || applyLinks.some(v => v.numericId !== row.id || v.orgId !== "87" || v.href !== expectedNativeApplyRoute || v.dataApplyUrl !== expectedNativeApplyRoute);
  // The same requisition can have a newer title at the official application endpoint.
  return { job: { sourceJobId: `workday:sha256:${hash(lookup.path)}`, title: clean(info.title as string), officialUrl, locationRaw: locations.join(" | "), cities },
    binding: { numericId: row.id, reqId: id.req, externalPath: lookup.path, officialUrl, application: { landingUrl: info.externalUrl, canApply: info.canApply, posted: info.posted }, displayConflict: { heading, mainJobIds, applyLinks, hasConflict } } };
}
function reportArtifact(manualTotal: number, catalog: LookupRow[], bindings: ReturnType<typeof project>["binding"][], capturedAt: string): SourceFetchArtifactDraft {
  const selected = new Set(bindings.map(b => b.reqId));
  return { id: REPORT, logicalKey: REPORT, kind: "ORACLE_RESULT", capturedAt, bodyRepresentation: "EXACT", extractorLocator: "amgen-manual-workday-v2:replayed-bindings-and-lookup-only-difference",
    body: JSON.stringify({ policy: AMGEN_MANUAL_WORKDAY_CONFIG.policy, manualTotal, lookupTotal: catalog.length, lookupOnlyReqIds: catalog.filter(r => !selected.has(r.req)).map(r => r.req), bindings }) };
}
function assemble(artifacts: SourceFetchArtifactDraft[], pages: ReturnType<typeof parsePage>[], jobs: ReturnType<typeof project>["job"][]): PersistentSourceFetchEvidence {
  let offset = 0;
  const traces = pages.map(page => { const selected = jobs.slice(offset, offset + page.rows.length); offset += page.rows.length; return pageTrace(page, artifacts.find(a => a.logicalKey === key("list", page.page))!, selected); });
  const first = artifacts[0]!;
  return deriveCanonicalPaginationEvidence({ ...options, evidence: parsePersistentSourceFetchEvidence({ captureTool: { name: "amgen-manual-workday-http", version: "2" }, artifacts, pages: traces,
    declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", scope: "SOURCE", value: pages[0]!.total, artifactLogicalKey: first.logicalKey, extractorLocator: first.extractorLocator },
    fetchCounts: { rawCount: jobs.length, parsedCount: jobs.length, validCount: jobs.length, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: [] }) });
}
function replay(artifacts: SourceFetchArtifactDraft[]) {
  const map = new Map(artifacts.map(a => [a.logicalKey, a])); assert(map.size === artifacts.length && artifacts.reduce((n, a) => n + Buffer.byteLength(a.body), 0) <= LIMIT);
  let consumed = 0, previous = Date.parse(artifacts[0]!.capturedAt); const start = previous;
  const read = (role: Role, index: number, req: Request) => {
    const a = map.get(key(role, index)); assert(a && typeof a.body === "string" && a.logicalKey === artifacts[consumed++]?.logicalKey);
    const time = Date.parse(a.capturedAt); assert(time >= previous && time - start <= WINDOW); previous = time;
    const expected = artifact(role, index, req, { body: a.body, status: a.httpStatus!, finalUrl: a.finalUrl!, contentType: a.contentType!, capturedAt: a.capturedAt }, a.capturedAt);
    assert(same({ ...a, id: expected.id }, expected)); return a.body;
  };
  const entry = read("list", 1, request(AMGEN_NATIVE_ENTRY)), pages = [parsePage(entry, 1)]; pageBody(entry, 2);
  for (let i = 2; i <= pages[0]!.totalPages; i++) pages.push(parsePage(read("list", i, request(PAGES, pageBody(entry, i))), i));
  const rows = pages.flatMap(p => p.rows);
  assert(pages.every(p => p.total === pages[0]!.total && p.totalPages === pages.length) && rows.length === pages[0]!.total && new Set(rows.map(r => r.id)).size === rows.length);
  const first = lookupPage(read("lookup", 0, lookupRequest(0)), 0), catalog = [...first.rows];
  for (let i = 1; i < Math.ceil(first.total / 20); i++) catalog.push(...lookupPage(read("lookup", i, lookupRequest(i)), i, first.total).rows);
  assert(catalog.length === first.total && new Set(catalog.map(r => r.req)).size === first.total && new Set(catalog.map(r => r.path)).size === first.total);
  const selected = new Set<string>(), projected = rows.map((row, i) => { const html = read("identity", i, request(row.url)), id = identity(html, row), match = catalog.find(r => r.req === id.req);
    assert(match && !selected.has(id.req)); selected.add(id.req); return project(row, html, match, read("application", i, request(`${WD}/wday/cxs/amgen/Careers${match.path}`))); });
  assert(artifacts.length === consumed + 1);
  const report = reportArtifact(rows.length, catalog, projected.map(p => p.binding), artifacts[consumed - 1]!.capturedAt);
  assert(same(artifacts[consumed], report));
  const jobs = projected.map(p => p.job); assert(new Set(jobs.map(j => j.sourceJobId)).size === jobs.length);
  return { evidence: assemble(artifacts, pages, jobs), jobs };
}
export function createAmgenManualWorkdaySourceFetch(deps: { http?: Http; now?: () => Date } = {}): SourceFetchFunction {
  return async plan => {
    const now = deps.now ?? (() => new Date()), startedAt = now().toISOString(), artifacts: SourceFetchArtifactDraft[] = []; let bytes = 0;
    try {
      assert(exactPlan(plan)); const http: Http = deps.http ?? (r => fetchWorkdayMainlandHttp(r.method === "POST" ? { ...r, method: "POST", body: r.body! } : { ...r, method: "GET" }));
      const acquire = async (role: Role, index: number, req: Request) => { const a = artifact(role, index, req, await http(req), now().toISOString()); bytes += Buffer.byteLength(a.body); assert(bytes <= LIMIT); artifacts.push(a); return a.body as string; };
      const entry = await acquire("list", 1, request(AMGEN_NATIVE_ENTRY)), pages = [parsePage(entry, 1)]; pageBody(entry, 2);
      for (let i = 2; i <= pages[0]!.totalPages; i++) pages.push(parsePage(await acquire("list", i, request(PAGES, pageBody(entry, i))), i));
      const rows = pages.flatMap(p => p.rows); assert(rows.length === pages[0]!.total && new Set(rows.map(r => r.id)).size === rows.length);
      const first = lookupPage(await acquire("lookup", 0, lookupRequest(0)), 0), catalog = [...first.rows];
      for (let i = 1; i < Math.ceil(first.total / 20); i++) catalog.push(...lookupPage(await acquire("lookup", i, lookupRequest(i)), i, first.total).rows);
      assert(catalog.length === first.total && new Set(catalog.map(r => r.req)).size === first.total && new Set(catalog.map(r => r.path)).size === first.total);
      const bindings: ReturnType<typeof project>["binding"][] = [], seen = new Set<string>();
      for (let i = 0; i < rows.length; i++) { const row = rows[i]!, html = await acquire("identity", i, request(row.url)), id = identity(html, row), match = catalog.find(r => r.req === id.req);
        assert(match && !seen.has(id.req)); seen.add(id.req);
        bindings.push(project(row, html, match, await acquire("application", i, request(`${WD}/wday/cxs/amgen/Careers${match.path}`))).binding); }
      const report = reportArtifact(rows.length, catalog, bindings, artifacts.at(-1)!.capturedAt);
      assert(bytes + Buffer.byteLength(report.body) <= LIMIT); artifacts.push(report);
      const result = replay(artifacts), paginationEvaluation = evaluatePaginationEvidence({ ...options, evidence: result.evidence }); assert(paginationEvaluation.safeCompleteness && paginationEvaluation.verifiedEligible);
      return { ok: true, capturedAt: artifacts[0]!.capturedAt, payload: { jobPostings: result.jobs }, fetchEvidence: result.evidence, paginationEvaluation,
        completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: rows.length, completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT", completenessEvidenceUrl: AMGEN_NATIVE_ENTRY,
          completenessBlockerReason: "Amgen manual denominator and independent Workday lookup/detail replay required", totalPages: pages.length, pageSize: 12, pagesVisited: pages.length } };
    } catch {
      const fetchEvidence = artifacts.length ? parsePersistentSourceFetchEvidence({ captureTool: { name: "amgen-manual-workday-http", version: "2" }, artifacts: artifacts.map(a => a.kind === "ORACLE_RESULT" ? a : { ...a, kind: "ATS_PAGE" }), pages: [], supportingArtifactOnlyFailure: { code: FAILURE },
        fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: [] }) : undefined;
      return { ok: false, capturedAt: startedAt, failureReason: FAILURE, ...(fetchEvidence ? { fetchEvidence } : {}) };
    }
  };
}
export function validateStrictAmgenManualWorkdayEvidence(plan: SourceCrawlPlan, input: PersistentSourceFetchEvidence, output: readonly NormalizedJobRecord[]): boolean {
  try {
    assert(exactPlan(plan)); const evidence = parsePersistentSourceFetchEvidence(input), result = replay(evidence.artifacts); assert(same(evidence, result.evidence));
    assert(output.length === result.jobs.length && new Set(output.map(j => j.sourceJobId)).size === output.length);
    const byId = new Map(result.jobs.map(j => [j.sourceJobId, j]));
    return output.every(job => { const row = byId.get(job.sourceJobId!); return row && typeof job.isBaseline === "boolean" && same(job, {
      companyId: plan.company.id, sourceId: plan.source.id, sourceKind: "SOCIAL", atsKind: "OFFICIAL_JSON", officialChineseCompanyName: plan.company.officialChineseName,
      sourceJobId: row.sourceJobId, officialTitle: row.title, officialUrl: row.officialUrl, listUrl: AMGEN_NATIVE_ENTRY, locationRaw: row.locationRaw, cities: row.cities, category: "其他", isBaseline: job.isBaseline,
      evidence: { officialEntryUrl: AMGEN_NATIVE_ENTRY, officialChainEvidenceUrl: CHAIN, capturedAt: evidence.artifacts[0]!.capturedAt }
    }); });
  } catch { return false; }
}
export function getStrictAmgenManualWorkdayPolicy(plan: SourceCrawlPlan): StrictProfileBoundSourcePolicy | undefined {
  if (!exactPlan(plan)) return undefined;
  return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true, urlRules: [
    { id: "amgen-v2-manual-entry", url: AMGEN_NATIVE_ENTRY, match: "EXACT", allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true },
    { id: "amgen-v2-manual-pages", url: PAGES, match: "EXACT", allowsPagination: true },
    { id: "amgen-v2-identity", url: `${ORIGIN}/en/job/`, match: "PATH_PREFIX" },
    { id: "amgen-v2-lookup-only", url: LOOKUP, match: "EXACT" },
    { id: "amgen-v2-workday-detail", url: `${WD}/wday/cxs/amgen/Careers/job/`, match: "PATH_PREFIX" }
  ] };
}
