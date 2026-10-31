import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { load } from "cheerio";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceFetchFunction } from "./runSourceCrawl";
import { parsePersistentSourceFetchEvidence, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft, type SourceFetchPageTrace } from "./sourceFetchEvidence";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { fetchWorkdayMainlandHttp, projectAmgenNativeCities } from "./workdayMainlandQuality";
import { WORKDAY_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import type { StrictProfileBoundSourcePolicy } from "./profileBoundSourceEvidence";

export const AMGEN_NATIVE_ENTRY = "https://careers.amgen.com/en/search-jobs/China/87/2/1814991/35/105/50/2";
const ORIGIN = "https://careers.amgen.com", APPLY_ORIGIN = "https://amgen.wd1.myworkdayjobs.com";
const ENDPOINT = `${ORIGIN}/en/search-jobs/resultspost`;
const CHAIN = "https://careers.amgen.com/en/location/china-jobs/87/1814991/2";
const CHINA_ID = "6cb77610a8a543aea2d6bc10457e35d4";
export const AMGEN_NATIVE_CONFIG = Object.freeze({ policy: "AMGEN_NATIVE_TALENTBREW_WORKDAY_V1", pageSize: 12, maxPages: 30 } as const);
export type AmgenNativeConfig = typeof AMGEN_NATIVE_CONFIG;
type Request = { url: string; method: "GET" | "POST"; body?: string; headers: Record<string, string> };
type Response = { body: string; status: number; finalUrl?: string; contentType?: string; capturedAt?: string };
type Http = (request: Request) => Promise<Response>;
type Row = { id: string; title: string; url: string };
type Page = { page: number; total: number; totalPages: number; rows: Row[]; hasNext: boolean };
type Projection = { sourceJobId: string; title: string; officialUrl: string; locationRaw: string; cities: string[] };
const hash = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
const clean = (s: string) => s.replace(/\s+/gu, " ").trim();
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("AMGEN_NATIVE_INVALID"); return v as Record<string, unknown>; };
const SAFE_FAILURE_CODES = new Set(["AMGEN_NATIVE_INVALID", "AMGEN_NATIVE_DETAIL_TITLE_CONFLICT", "AMGEN_NATIVE_DETAIL_APPLY_ID_CONFLICT"]);
export function isSafeAmgenNativeFailureCode(value: unknown): value is string { return typeof value === "string" && SAFE_FAILURE_CODES.has(value); }
function assert(value: unknown, code = "AMGEN_NATIVE_INVALID"): asserts value { if (!value) throw Error(code); }
const nonempty = (v: unknown): v is string => typeof v === "string" && clean(v).length > 0;
const json = (body: string) => { assert(hasUniqueJsonObjectKeys(body)); return object(JSON.parse(body)); };
const options = { expectedChannelIds: [] as string[], filteredOutput: true, allowPositiveOfficialTotalCountAfterAdapterReconciliation: true as const };
const key = (role: "list" | "detail" | "apply", i: number) => `amgen-${role}-${String(i).padStart(4, "0")}`;
function locator(role: "list" | "detail" | "apply", i: number, request: Request): string {
  return requestContractV2Locator(role === "list" ? "#search-results@data-total-job-results" : role === "detail" ? "schema:JobPosting+native-apply" : "$.jobPostingInfo", {
    family: role === "apply" ? "workday" : "html", role: `amgen-native-${role}`, method: request.method, url: request.url,
    body: request.body ? JSON.parse(request.body) : null, coordinate: { index: i }
  });
}
function request(url: string, body?: unknown): Request {
  return { url, method: body === undefined ? "GET" : "POST", headers: { Accept: "text/html,application/json", ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
function exactPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.source.id === "source-amgen-china-social" && plan.company.id === "company-amgen-china" &&
    plan.source.companyId === plan.company.id && plan.company.officialChineseName === "安进中国" && plan.company.category === "FOREIGN_PHARMA" &&
    plan.source.kind === "SOCIAL" && plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === AMGEN_NATIVE_ENTRY && plan.source.officialChainEvidenceUrl === CHAIN &&
    same(plan.profileBoundSource, { kind: "amgen-native-china", config: AMGEN_NATIVE_CONFIG }) && same(plan.json, WORKDAY_JSON_CONFIG) &&
    !plan.workday && !plan.officialJsonFetch && !plan.moka && !plan.hotjob && !plan.hotjobLegacy;
}
function parsePage(body: string, page: number): Page {
  const html = page === 1 ? body : json(body).results;
  assert(typeof html === "string");
  const $ = load(html), section = $("#search-results");
  assert(section.length === 1);
  for (const [name, value] of Object.entries({ "data-location": "China", "data-location-type": "2", "data-location-path": "1814991", "data-organization-ids": "87", "data-keywords": "" })) assert(section.attr(name) === value);
  const integer = (name: string, min: number) => { const value = section.attr(name); assert(value && /^\d+$/u.test(value)); const n = Number(value); assert(Number.isSafeInteger(n) && n >= min); return n; };
  const total = integer("data-total-job-results", 0), totalPages = integer("data-total-pages", 1);
  assert(integer("data-current-page", 1) === page && integer("data-records-per-page", 1) === 12 && totalPages === Math.max(1, Math.ceil(total / 12)) && totalPages <= AMGEN_NATIVE_CONFIG.maxPages && page <= totalPages);
  const rows = $("#search-results-jobs > li").toArray().map(li => {
    const a = $(li).find("a[data-job-id]"), button = $(li).find("button.js-save-job-btn");
    assert(a.length === 1 && button.length === 1);
    const id = a.attr("data-job-id"), href = a.attr("href"), title = clean(a.find("h3").text());
    assert(id && /^[1-9]\d*$/u.test(id) && href && title && button.attr("data-job-id") === id && button.attr("data-org-id") === "87");
    const url = new URL(href, AMGEN_NATIVE_ENTRY);
    assert(url.origin === ORIGIN && !url.search && !url.hash && !url.username && !url.password && new RegExp(`^/en/job/[^/]+/[^/]+/87/${id}$`, "u").test(url.pathname));
    return { id, title, url: url.href };
  });
  const next = section.find(".pagination .next[data-display-type='Jobs']");
  assert(next.length > 0 && rows.length === Math.min(12, total - (page - 1) * 12) && new Set(rows.map(r => r.id)).size === rows.length);
  const hasNext = next.toArray().some(el => !$(el).hasClass("disabled") && $(el).attr("aria-disabled") !== "true");
  assert(hasNext === (page < totalPages));
  return { page, total, totalPages, rows, hasNext };
}
/** Native search-client mapSearchOptions, then the Jobs pagination action. No hidden filter or alternate search route. */
function pageBody(entry: string, page: number): Record<string, unknown> {
  const $ = load(entry), s = $("#search-results"), f = $("#search-filters");
  assert(s.length === 1 && f.length === 1 && s.attr("data-ajax-post-url") === "/en/search-jobs/resultspost" && s.attr("data-show-radius") === "False" &&
    $(".filter-checkbox:checked").length === 0 && (s.attr("data-refined-keywords") ?? "[]") === "[]");
  const value = (name: string, fallback: unknown = null) => s.attr(`data-${name}`) || fallback;
  const number = (name: string, fallback: number | null = null) => { const raw = s.attr(`data-${name}`); if (!raw) return fallback; assert(/^-?\d+(?:\.\d+)?$/u.test(raw)); return Number(raw); };
  const body = {
    ActiveFacetID: number("active-facet-id", 0), Distance: number("distance", 50), RadiusUnitType: Number(f.attr("data-radius-unit-type")),
    RecordsPerPage: number("records-per-page"), CurrentPage: page, Keywords: value("keywords", ""), Location: value("location"),
    Latitude: Number(value("latitude")).toFixed(5), Longitude: Number(value("longitude")).toFixed(5), ShowRadius: s.attr("data-show-radius") === "True",
    FacetTerm: value("facet-term", ""), FacetType: number("facet-type"), SearchResultsModuleName: value("search-results-module-name"), SearchFiltersModuleName: f.attr("data-search-filters-module-name"),
    SortCriteria: number("sort-criteria", 0), SortDirection: number("sort-direction", 1), SearchType: number("search-type", 1),
    CategoryFacetTerm: value("category-facet-term"), CategoryFacetType: number("category-facet-type"), LocationFacetTerm: value("location-facet-term"), LocationFacetType: number("location-facet-type"),
    KeywordType: value("keyword-type"), LocationType: value("location-type"), LocationPath: value("location-path"), OrganizationIds: value("organization-ids"), PostalCode: value("postal-code"), CustomFacetName: value("custom-facet-name"),
    ResultsType: 1, TotalContentResults: number("total-content-results", 0), FacetFilters: [], RefinedKeywords: [], IsPagination: "False",
    TotalContentPages: Math.ceil(number("total-content-results", 0)! / 12),
    fc: f.attr("data-filtered-categories") ?? "", fl: f.attr("data-filtered-locations") ?? "", fcf: f.attr("data-filtered-custom-facet") ?? "",
    afc: f.attr("data-filtered-advanced-categories") ?? "", afl: f.attr("data-filtered-advanced-locations") ?? "", afcf: f.attr("data-filtered-advanced-custom-facet") ?? ""
  };
  assert(body.ActiveFacetID === 0 && body.Distance === 50 && body.RadiusUnitType === 0 && body.Latitude === "35.00000" && body.Longitude === "105.00000" &&
    !body.ShowRadius && body.FacetTerm === "" && body.FacetType === 0 && body.SortCriteria === 0 && body.SortDirection === 0 && body.SearchType === 1 &&
    [body.fc, body.fl, body.fcf, body.afc, body.afl, body.afcf].every(v => v === "") &&
    [body.CategoryFacetTerm, body.CategoryFacetType, body.LocationFacetTerm, body.LocationFacetType, body.KeywordType, body.PostalCode, body.CustomFacetName].every(v => v === null));
  return body;
}
function detail(body: string, row: Row) {
  const $ = load(body), scripts = $("script[type='application/ld+json']");
  assert(scripts.length === 1 && $("link[rel='canonical']").attr("href") === row.url);
  assert(clean($("h1").text()) === row.title, "AMGEN_NATIVE_DETAIL_TITLE_CONFLICT");
  const schema = json(scripts.text());
  assert(schema["@type"] === "JobPosting" && schema.url === row.url && clean(String(schema.title)) === row.title && nonempty(schema.description) && load(schema.description).text().trim().length > 20 &&
    object(schema.hiringOrganization).name === "Amgen" && typeof schema.identifier === "string" && /^R-[1-9]\d*$/u.test(schema.identifier));
  const links = $("a.job-apply").toArray(); assert(links.length > 0);
  const applyUrls = links.map(el => { const a = $(el); assert(a.attr("data-job-id") === row.id && a.attr("data-job-organization-id") === "87" && a.attr("href") === a.attr("data-apply-url"), "AMGEN_NATIVE_DETAIL_APPLY_ID_CONFLICT"); return a.attr("href")!; });
  assert(new Set(applyUrls).size === 1);
  const apply = new URL(applyUrls[0]!);
  assert(apply.origin === APPLY_ORIGIN && !apply.username && !apply.password && !apply.search && !apply.hash);
  const match = /^\/Careers(\/job\/[^/]+\/([^/]+_(R-[1-9]\d*)(?:-[1-9]\d*)?))\/apply$/u.exec(apply.pathname);
  assert(match && match[3] === schema.identifier);
  assert(Array.isArray(schema.jobLocation) && schema.jobLocation.length > 0);
  const locations = schema.jobLocation.map(v => object(object(v).address));
  assert(locations.every(a => a.addressCountry === "China" && nonempty(a.addressLocality) && nonempty(a.addressRegion) && !/Hong Kong|Macau|Macao|Taiwan|香港|澳门|台湾/iu.test(`${a.addressLocality} ${a.addressRegion}`)));
  return { schema, locations, req: match[3]!, path: match[1]!, posting: match[2]!, externalUrl: apply.href.slice(0, -6), apiUrl: `${APPLY_ORIGIN}/wday/cxs/amgen/Careers${match[1]}` };
}
function projection(row: Row, html: string, applyBody: string): Projection {
  const d = detail(html, row), root = json(applyBody), info = object(root.jobPostingInfo), country = object(info.country), req = object(info.jobRequisitionLocation), reqCountry = object(req.country);
  assert(root.userAuthenticated === false && info.jobReqId === d.req && info.jobPostingId === d.posting && info.jobPostingSiteId === "Careers" &&
    info.externalUrl === d.externalUrl && info.posted === true && info.canApply === true && clean(String(info.title)) === row.title && nonempty(info.jobDescription) && load(info.jobDescription).text().trim().length > 20 &&
    country.id === CHINA_ID && country.descriptor === "China" && reqCountry.id === CHINA_ID && reqCountry.descriptor === "China" && reqCountry.alpha2Code === "CN" && nonempty(req.descriptor) &&
    nonempty(info.location) && (info.additionalLocations === undefined || Array.isArray(info.additionalLocations)));
  const locations: unknown[] = [info.location, ...(info.additionalLocations as unknown[] | undefined ?? [])];
  assert(locations.every(nonempty) && new Set(locations).size === locations.length && locations.length === d.locations.length);
  for (let i = 0; i < locations.length; i++) {
    const name = (locations[i] as string).replace(/^China\s+- /u, ""), address = d.locations[i]!;
    assert(name === address.addressLocality || name === "Yulin (Shaanxi)" && address.addressLocality === "Yulin" && address.addressRegion === "Shaanxi");
  }
  const cities = projectAmgenNativeCities(row.title, locations as string[], req.descriptor); assert(cities);
  return { sourceJobId: `workday:sha256:${hash(d.path)}`, title: row.title, officialUrl: row.url, locationRaw: locations.join(" | "), cities };
}
function artifact(role: "list" | "detail" | "apply", i: number, req: Request, response: Response, fallbackTime: string): SourceFetchArtifactDraft {
  assert(response.status === 200 && response.finalUrl === req.url && typeof response.body === "string" && Buffer.byteLength(response.body) <= 2 * 1024 * 1024 &&
    (role === "apply" || role === "list" && i > 1 ? /^application\/json(?:;|$)/iu : /^text\/html(?:;|$)/iu).test(response.contentType ?? ""));
  const capturedAt = response.capturedAt ?? fallbackTime; assert(Number.isFinite(Date.parse(capturedAt)));
  return { id: key(role, i), logicalKey: key(role, i), kind: role === "list" ? "PAGINATION_PAGE" : role === "detail" ? "ATS_PAGE" : "ATS_API_RESPONSE",
    requestedUrl: req.url, finalUrl: response.finalUrl, httpStatus: response.status, contentType: response.contentType!, capturedAt, body: response.body, bodyRepresentation: "EXACT", extractorLocator: locator(role, i, req) };
}
function pageTrace(parsed: Page, a: SourceFetchArtifactDraft, jobs: Projection[]): SourceFetchPageTrace {
  return { sequence: parsed.page - 1, artifactLogicalKey: a.logicalKey, requestedCursor: null, returnedCursor: null,
    requestedOffset: (parsed.page - 1) * 12, returnedOffset: null, requestedPage: parsed.page, returnedPage: parsed.page,
    requestedPageSize: 12, returnedPageSize: 12, rawJobIds: parsed.rows.map(r => `sha256:${hash(r.id)}`), validJobIds: jobs.map(r => `sha256:${hash(r.sourceJobId)}`),
    declaredTotal: parsed.total, declaredCount: 12, declaredPages: parsed.totalPages,
    nextPageSignalBefore: parsed.page === 1 ? null : `page:${parsed.page}`, nextPageSignalAfter: parsed.hasNext ? `page:${parsed.page + 1}` : null,
    responseFingerprintSha256: hash(a.body), termination: parsed.total === 0 ? "EMPTY_PAGE" : parsed.hasNext ? "CONTINUE" : "NEXT_ABSENT", anomalyCodes: [], capturedAt: a.capturedAt };
}
function buildEvidence(artifacts: SourceFetchArtifactDraft[], list: Page[], jobs: Projection[]): PersistentSourceFetchEvidence {
  let offset = 0;
  const pages = list.map(p => { const rows = jobs.slice(offset, offset + p.rows.length); offset += p.rows.length; return pageTrace(p, artifacts.find(a => a.logicalKey === key("list", p.page))!, rows); });
  const first = artifacts[0]!;
  return deriveCanonicalPaginationEvidence({ ...options, evidence: parsePersistentSourceFetchEvidence({ captureTool: { name: "amgen-native-http", version: "1" }, artifacts, pages,
    declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", scope: "SOURCE", value: list[0]!.total, artifactLogicalKey: first.logicalKey, extractorLocator: first.extractorLocator },
    fetchCounts: { rawCount: jobs.length, parsedCount: jobs.length, validCount: jobs.length, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: [] }) });
}

export function createAmgenNativeSourceFetch(deps: { http?: Http; now?: () => Date } = {}): SourceFetchFunction {
  return async plan => {
    const now = deps.now ?? (() => new Date()), startedAt = now().toISOString(), artifacts: SourceFetchArtifactDraft[] = [];
    try {
      assert(exactPlan(plan));
      const http: Http = deps.http ?? (r => fetchWorkdayMainlandHttp(r.method === "POST" ? { ...r, method: "POST", body: r.body! } : { ...r, method: "GET" }));
      let sourceBytes = 0;
      const acquire = async (role: "list" | "detail" | "apply", i: number, req: Request) => {
        const a = artifact(role, i, req, await http(req), now().toISOString());
        sourceBytes += Buffer.byteLength(a.body); assert(sourceBytes <= 32 * 1024 * 1024);
        artifacts.push(a); return a.body as string;
      };
      const entry = await acquire("list", 1, request(AMGEN_NATIVE_ENTRY));
      const list = [parsePage(entry, 1)]; pageBody(entry, 2);
      for (let i = 2; i <= list[0]!.totalPages; i++) list.push(parsePage(await acquire("list", i, request(ENDPOINT, pageBody(entry, i))), i));
      const rows = list.flatMap(p => p.rows);
      assert(list.every(p => p.total === list[0]!.total && p.totalPages === list.length) && rows.length === list[0]!.total && new Set(rows.map(r => r.id)).size === rows.length);
      const jobs: Projection[] = [], reqIds = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!, html = await acquire("detail", i, request(r.url));
        const d = detail(html, r); assert(!reqIds.has(d.req)); reqIds.add(d.req);
        const application = await acquire("apply", i, request(d.apiUrl));
        jobs.push(projection(r, html, application));
      }
      assert(new Set(jobs.map(j => j.sourceJobId)).size === jobs.length && artifacts.reduce((n, a) => n + Buffer.byteLength(a.body), 0) <= 32 * 1024 * 1024);
      const evidence = buildEvidence(artifacts, list, jobs), paginationEvaluation = evaluatePaginationEvidence({ evidence, ...options });
      assert(paginationEvaluation.safeCompleteness && paginationEvaluation.verifiedEligible);
      return { ok: true, capturedAt: artifacts[0]!.capturedAt, payload: { jobPostings: jobs }, fetchEvidence: evidence, paginationEvaluation,
        completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: rows.length, completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT", completenessEvidenceUrl: AMGEN_NATIVE_ENTRY,
          completenessBlockerReason: "Amgen native list, detail and application evidence requires archived replay", totalPages: list.length, pageSize: 12, pagesVisited: list.length } };
    } catch (error) {
      const failureReason = error instanceof Error && isSafeAmgenNativeFailureCode(error.message) ? error.message : "AMGEN_NATIVE_INVALID";
      const fetchEvidence = artifacts.length ? parsePersistentSourceFetchEvidence({ captureTool: { name: "amgen-native-http", version: "1" }, artifacts: artifacts.map(a => ({ ...a, kind: "ATS_PAGE" })), pages: [],
        supportingArtifactOnlyFailure: { code: failureReason }, fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: [] }) : undefined;
      return { ok: false, capturedAt: startedAt, failureReason, ...(fetchEvidence ? { fetchEvidence } : {}) };
    }
  };
}

export function validateStrictAmgenNativeEvidence(plan: SourceCrawlPlan, input: PersistentSourceFetchEvidence, output: readonly NormalizedJobRecord[]): boolean {
  try {
    assert(exactPlan(plan));
    const evidence = parsePersistentSourceFetchEvidence(input), artifacts = evidence.artifacts, map = new Map(artifacts.map(a => [a.logicalKey, a]));
    assert(map.size === artifacts.length && artifacts.reduce((n, a) => n + Buffer.byteLength(a.body), 0) <= 32 * 1024 * 1024);
    const read = (role: "list" | "detail" | "apply", i: number, req: Request) => {
      const a = map.get(key(role, i)); assert(a && typeof a.body === "string" && a.bodyRepresentation === "EXACT" && a.rawBodySha256 === undefined && a.redactionDescriptors === undefined && a.channelId === undefined);
      const expected = artifact(role, i, req, { body: a.body, status: a.httpStatus!, finalUrl: a.finalUrl!, contentType: a.contentType!, capturedAt: a.capturedAt }, a.capturedAt);
      assert(same({ ...a, id: expected.id }, expected)); return a.body;
    };
    const entry = read("list", 1, request(AMGEN_NATIVE_ENTRY)), list = [parsePage(entry, 1)]; pageBody(entry, 2);
    for (let i = 2; i <= list[0]!.totalPages; i++) list.push(parsePage(read("list", i, request(ENDPOINT, pageBody(entry, i))), i));
    const rows = list.flatMap(p => p.rows);
    assert(list.every(p => p.total === list[0]!.total && p.totalPages === list.length) && rows.length === list[0]!.total && new Set(rows.map(r => r.id)).size === rows.length && artifacts.length === list.length + rows.length * 2);
    const reqIds = new Set<string>();
    const jobs = rows.map((r, i) => { const html = read("detail", i, request(r.url)), d = detail(html, r); assert(!reqIds.has(d.req)); reqIds.add(d.req); return projection(r, html, read("apply", i, request(d.apiUrl))); });
    assert(new Set(jobs.map(j => j.sourceJobId)).size === jobs.length && output.length === jobs.length);
    const replay = buildEvidence(artifacts, list, jobs); assert(same(evidence, replay));
    const byId = new Map(jobs.map(j => [j.sourceJobId, j]));
    return new Set(output.map(j => j.sourceJobId)).size === output.length && output.every(job => {
      const row = byId.get(job.sourceJobId!); return row && typeof job.isBaseline === "boolean" && same(job, { companyId: plan.company.id, sourceId: plan.source.id, sourceKind: "SOCIAL", atsKind: "OFFICIAL_JSON", officialChineseCompanyName: plan.company.officialChineseName,
        sourceJobId: row.sourceJobId, officialTitle: row.title, officialUrl: row.officialUrl, listUrl: AMGEN_NATIVE_ENTRY, locationRaw: row.locationRaw, cities: row.cities, category: "其他", isBaseline: job.isBaseline,
        evidence: { officialEntryUrl: AMGEN_NATIVE_ENTRY, officialChainEvidenceUrl: CHAIN, capturedAt: artifacts[0]!.capturedAt } });
    });
  } catch { return false; }
}
export function getStrictAmgenNativePolicy(plan: SourceCrawlPlan): StrictProfileBoundSourcePolicy | undefined {
  if (!exactPlan(plan)) return undefined;
  return { urlRules: [
    { id: "amgen-native-entry", url: AMGEN_NATIVE_ENTRY, match: "EXACT", allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true },
    { id: "amgen-native-pages", url: ENDPOINT, match: "EXACT", allowsPagination: true },
    { id: "amgen-native-details", url: `${ORIGIN}/en/job/`, match: "PATH_PREFIX" },
    { id: "amgen-native-applications", url: `${APPLY_ORIGIN}/wday/cxs/amgen/Careers/job/`, match: "PATH_PREFIX" }
  ], allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
}

// Pure manual-list parsing is shared; V1's detail and admission rules stay unchanged.
export const amgenNativeListReplay = { parsePage, pageBody, pageTrace };
