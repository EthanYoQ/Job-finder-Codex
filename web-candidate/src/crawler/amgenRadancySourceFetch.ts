import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { load } from "cheerio";
import { AMGEN_NATIVE_ENTRY, amgenNativeListReplay } from "./amgenNativeSourceFetch";
import { WORKDAY_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { currentOfficialSourceAttemptSignal, fetchWithOfficialTimeout, officialHttpTimeoutMs } from "./officialHttpRuntimeLimits";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { StrictProfileBoundSourcePolicy } from "./profileBoundSourceEvidence";
import type { SourceFetchFunction } from "./runSourceCrawl";
import { parsePersistentSourceFetchEvidence, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { projectAmgenNativeCities } from "./workdayMainlandQuality";
import type { SourceCrawlPlan } from "./sourcePlan";

export const AMGEN_RADANCY_CONFIG = Object.freeze({ policy: "AMGEN_RADANCY_OFFICIAL_V1", pageSize: 12, maxPages: 30 } as const);
export type AmgenRadancyConfig = typeof AMGEN_RADANCY_CONFIG;

const ORIGIN = "https://careers.amgen.com";
const WD = "https://amgen.wd1.myworkdayjobs.com";
const PAGES = `${ORIGIN}/en/search-jobs/resultspost`;
const CHAIN = `${ORIGIN}/en/location/china-jobs/87/1814991/2`;
const REPORT = "amgen-radancy-binding-report";
const BODY_LIMIT = 2 * 1024 * 1024;
const LIMIT = 32 * 1024 * 1024;
const WINDOW = 30 * 60 * 1000;
const FAILURE = "AMGEN_RADANCY_INVALID";

type Request = { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string };
type HttpResponse = { status: number; body: string; finalUrl?: string; contentType?: string; capturedAt?: string };
type Http = (request: Request) => Promise<HttpResponse>;
type Role = "list" | "detail";
type Row = { id: string; title: string; url: string };
type ProjectedJob = { sourceJobId: string; title: string; officialUrl: string; locationRaw: string; cities: string[] };
type DetailBinding = { numericId: string; reqId: string; externalPath: string; officialUrl: string };

const { parsePage, pageBody, pageTrace } = amgenNativeListReplay;
const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const clean = (v: string) => v.replace(/\s+/gu, " ").trim();
const nonempty = (v: unknown): v is string => typeof v === "string" && clean(v).length > 0;
function assert(v: unknown): asserts v { if (!v) throw Error(FAILURE); }
const object = (v: unknown): Record<string, unknown> => { assert(v && typeof v === "object" && !Array.isArray(v)); return v as Record<string, unknown>; };
const json = (v: string) => { assert(hasUniqueJsonObjectKeys(v)); return object(JSON.parse(v)); };
const key = (role: Role, index: number) => `amgen-radancy-${role}-${String(index).padStart(4, "0")}`;
const makeRequest = (url: string, body?: unknown): Request => ({
  url,
  method: body === undefined ? "GET" : "POST",
  headers: { Accept: "text/html,application/json", ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const paginationOptions = { expectedChannelIds: [] as string[], filteredOutput: true, allowPositiveOfficialTotalCountAfterAdapterReconciliation: true as const };

export function isSafeAmgenRadancyFailureCode(value: unknown): value is string {
  return value === FAILURE;
}

async function fetchPortalHttp(request: Request): Promise<HttpResponse> {
  const controller = new AbortController(), source = currentOfficialSourceAttemptSignal();
  const abort = () => controller.abort(source?.reason);
  const deadline = setTimeout(() => controller.abort(new Error("Amgen official portal body deadline exceeded")), officialHttpTimeoutMs());
  if (source?.aborted) abort(); else source?.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel(controller.signal.reason).catch(() => undefined); };
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    controller.signal.throwIfAborted();
    const response = await fetchWithOfficialTimeout(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: controller.signal,
      redirect: "error"
    });
    const declared = response.headers.get("content-length");
    if (declared && (!/^[0-9]+$/u.test(declared) || Number(declared) > BODY_LIMIT)) {
      void response.body?.cancel().catch(() => undefined);
      throw Error("Amgen official portal response exceeds byte limit");
    }
    if (!response.body) throw Error("Amgen official portal response body is missing");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      controller.signal.throwIfAborted();
      const chunk = await reader.read();
      controller.signal.throwIfAborted();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > BODY_LIMIT) {
        void reader.cancel().catch(() => undefined);
        throw Error("Amgen official portal response exceeds byte limit");
      }
      chunks.push(chunk.value);
    }
    return {
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") ?? "",
      body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      capturedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(deadline);
    source?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
}

function exactPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.company.id === "company-amgen-china" && plan.source.id === "source-amgen-china-social" &&
    plan.source.companyId === plan.company.id && plan.company.officialChineseName === "安进中国" && plan.company.category === "FOREIGN_PHARMA" &&
    plan.source.kind === "SOCIAL" && plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === AMGEN_NATIVE_ENTRY && plan.source.officialChainEvidenceUrl === CHAIN &&
    same(plan.profileBoundSource, { kind: "amgen-radancy-china", config: AMGEN_RADANCY_CONFIG }) && same(plan.json, WORKDAY_JSON_CONFIG) &&
    !plan.workday && !plan.officialJsonFetch && !plan.moka && !plan.hotjob && !plan.hotjobLegacy;
}

function makeArtifact(role: Role, index: number, req: Request, response: HttpResponse, now: string): SourceFetchArtifactDraft {
  const mime = role === "list" && index > 1 ? /^application\/json(?:;|$)/iu : /^text\/html(?:;|$)/iu;
  assert(response.status === 200 && response.finalUrl === req.url && typeof response.body === "string" &&
    Buffer.byteLength(response.body) <= BODY_LIMIT && mime.test(response.contentType ?? ""));
  const capturedAt = response.capturedAt ?? now;
  assert(Number.isFinite(Date.parse(capturedAt)));
  return {
    id: key(role, index),
    logicalKey: key(role, index),
    kind: role === "list" ? "PAGINATION_PAGE" : "ATS_PAGE",
    requestedUrl: req.url,
    finalUrl: req.url,
    httpStatus: 200,
    contentType: response.contentType!,
    capturedAt,
    body: response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: requestContractV2Locator(role === "list" ? "#search-results@data-total-job-results" : "schema:JobPosting+a.job-apply[data-apply-url]", {
      family: "html",
      role: `amgen-radancy-${role}`,
      method: req.method,
      url: req.url,
      body: req.body ? JSON.parse(req.body) : null,
      coordinate: { index }
    })
  };
}

function projectDetail(html: string, row: Row): { job: ProjectedJob; binding: DetailBinding } {
  const $ = load(html), scripts = $("script[type='application/ld+json']");
  assert(scripts.length === 1 && $("link[rel='canonical']").length === 1 && $("link[rel='canonical']").attr("href") === row.url);
  const schema = json(scripts.text());
  const identifier = typeof schema.identifier === "string" ? schema.identifier : object(schema.identifier);
  if (typeof identifier !== "string") {
    assert(identifier["@type"] === "PropertyValue" && identifier.name === "Job ID" && same(Object.keys(identifier).sort(), ["@type", "name", "value"]));
  }
  const reqId = typeof identifier === "string" ? identifier : identifier.value;
  assert(schema["@type"] === "JobPosting" && schema.url === row.url && nonempty(schema.title) && clean(schema.title) === row.title &&
    typeof reqId === "string" && /^R-[1-9]\d*$/u.test(reqId) && object(schema.hiringOrganization).name === "Amgen" &&
    nonempty(schema.description) && load(schema.description).text().trim().length > 20 &&
    Array.isArray(schema.jobLocation) && schema.jobLocation.length > 0);
  const addresses = schema.jobLocation.map(v => object(object(v).address));
  assert(addresses.every(a => a.addressCountry === "China" && nonempty(a.addressLocality) && nonempty(a.addressRegion) &&
    !/Hong Kong|Macau|Macao|Taiwan|香港|澳门|台湾/iu.test(`${a.addressLocality} ${a.addressRegion}`)));
  const applyUrls = $("a.job-apply").toArray().map(node => $(node).attr("data-apply-url") ?? "");
  assert(applyUrls.length > 0 && new Set(applyUrls).size === 1);
  const applyUrl = new URL(applyUrls[0]!);
  assert(applyUrl.origin === WD && !applyUrl.username && !applyUrl.password && !applyUrl.search && !applyUrl.hash && applyUrl.href === applyUrls[0]);
  const pathMatch = /^\/Careers(\/job\/[^/]+\/[^/]+_(R-[1-9]\d*)(?:-[1-9]\d*)?)\/apply$/u.exec(applyUrl.pathname);
  assert(pathMatch && pathMatch[2] === reqId);
  const externalPath = pathMatch[1]!;
  const officialUrl = `${WD}/Careers${externalPath}`;
  const locations = [...new Set(addresses.map(a =>
    a.addressLocality === "Yulin" && a.addressRegion === "Shaanxi" ? "China - Yulin (Shaanxi)" : `China - ${clean(a.addressLocality as string)}`
  ))];
  const cities = projectAmgenNativeCities(clean(schema.title), locations, locations[0]!);
  assert(cities);
  return {
    job: { sourceJobId: `workday:sha256:${hash(externalPath)}`, title: clean(schema.title), officialUrl, locationRaw: locations.join(" | "), cities },
    binding: { numericId: row.id, reqId, externalPath, officialUrl }
  };
}

function reportArtifact(total: number, bindings: DetailBinding[], capturedAt: string): SourceFetchArtifactDraft {
  return {
    id: REPORT,
    logicalKey: REPORT,
    kind: "ORACLE_RESULT",
    capturedAt,
    bodyRepresentation: "EXACT",
    extractorLocator: "amgen-radancy-v1:replayed-official-details",
    body: JSON.stringify({ policy: AMGEN_RADANCY_CONFIG.policy, total, bindings })
  };
}

function assemble(
  artifacts: SourceFetchArtifactDraft[],
  pages: ReturnType<typeof parsePage>[],
  jobs: ProjectedJob[]
): PersistentSourceFetchEvidence {
  let offset = 0;
  const traces = pages.map(page => {
    const selected = jobs.slice(offset, offset + page.rows.length);
    offset += page.rows.length;
    return pageTrace(page, artifacts.find(a => a.logicalKey === key("list", page.page))!, selected);
  });
  const first = artifacts[0]!;
  return deriveCanonicalPaginationEvidence({
    ...paginationOptions,
    evidence: parsePersistentSourceFetchEvidence({
      captureTool: { name: "amgen-radancy-http", version: "1" },
      artifacts,
      pages: traces,
      declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", scope: "SOURCE", value: pages[0]!.total, artifactLogicalKey: first.logicalKey, extractorLocator: first.extractorLocator },
      fetchCounts: { rawCount: jobs.length, parsedCount: jobs.length, validCount: jobs.length, parseDiscardCount: 0, validationDiscardCount: 0 },
      fetchLosses: []
    })
  });
}

function replay(artifacts: SourceFetchArtifactDraft[]) {
  const map = new Map(artifacts.map(a => [a.logicalKey, a]));
  assert(map.size === artifacts.length && artifacts.reduce((n, a) => n + Buffer.byteLength(a.body), 0) <= LIMIT);
  let consumed = 0, previous = Date.parse(artifacts[0]!.capturedAt);
  const start = previous;
  const read = (role: Role, index: number, req: Request) => {
    const a = map.get(key(role, index));
    assert(a && typeof a.body === "string" && a.logicalKey === artifacts[consumed]?.logicalKey);
    const time = Date.parse(a.capturedAt);
    assert(time >= previous && time - start <= WINDOW);
    previous = time;
    const expected = makeArtifact(role, index, req, { body: a.body, status: a.httpStatus!, finalUrl: a.finalUrl!, contentType: a.contentType!, capturedAt: a.capturedAt }, a.capturedAt);
    assert(same({ ...a, id: expected.id }, expected));
    consumed++;
    return a.body;
  };
  const entry = read("list", 1, makeRequest(AMGEN_NATIVE_ENTRY)), pages = [parsePage(entry, 1)];
  pageBody(entry, 2);
  for (let i = 2; i <= pages[0]!.totalPages; i++) pages.push(parsePage(read("list", i, makeRequest(PAGES, pageBody(entry, i))), i));
  const rows = pages.flatMap(p => p.rows);
  assert(pages.every(p => p.total === pages[0]!.total && p.totalPages === pages.length) && rows.length === pages[0]!.total && new Set(rows.map(r => r.id)).size === rows.length);
  const seenReqs = new Set<string>(), seenPaths = new Set<string>();
  const projected = rows.map((row, i) => {
    const html = read("detail", i, makeRequest(row.url));
    const candidate = projectDetail(html, row);
    assert(!seenReqs.has(candidate.binding.reqId) && !seenPaths.has(candidate.binding.externalPath));
    seenReqs.add(candidate.binding.reqId);
    seenPaths.add(candidate.binding.externalPath);
    return candidate;
  });
  assert(artifacts.length === consumed + 1);
  const report = reportArtifact(rows.length, projected.map(p => p.binding), (consumed > 0 ? artifacts[consumed - 1]! : artifacts[0]!).capturedAt);
  assert(same(artifacts[consumed], report));
  const jobs = projected.map(p => p.job);
  assert(new Set(jobs.map(j => j.sourceJobId)).size === jobs.length);
  return { evidence: assemble(artifacts, pages, jobs), jobs };
}

export function createAmgenRadancySourceFetch(deps: { http?: Http; now?: () => Date } = {}): SourceFetchFunction {
  return async plan => {
    const now = deps.now ?? (() => new Date()), startedAt = now().toISOString(), artifacts: SourceFetchArtifactDraft[] = [];
    let bytes = 0;
    try {
      assert(exactPlan(plan));
      const http: Http = deps.http ?? fetchPortalHttp;
      const acquire = async (role: Role, index: number, req: Request) => {
        const a = makeArtifact(role, index, req, await http(req), now().toISOString());
        bytes += Buffer.byteLength(a.body);
        assert(bytes <= LIMIT);
        artifacts.push(a);
        return a.body as string;
      };
      const entry = await acquire("list", 1, makeRequest(AMGEN_NATIVE_ENTRY)), pages = [parsePage(entry, 1)];
      pageBody(entry, 2);
      for (let i = 2; i <= pages[0]!.totalPages; i++) pages.push(parsePage(await acquire("list", i, makeRequest(PAGES, pageBody(entry, i))), i));
      const rows = pages.flatMap(p => p.rows);
      assert(rows.length === pages[0]!.total && new Set(rows.map(r => r.id)).size === rows.length);
      const bindings: DetailBinding[] = [], seenReqs = new Set<string>(), seenPaths = new Set<string>();
      for (const [i, row] of rows.entries()) {
        const html = await acquire("detail", i, makeRequest(row.url));
        const projected = projectDetail(html, row);
        assert(!seenReqs.has(projected.binding.reqId) && !seenPaths.has(projected.binding.externalPath));
        seenReqs.add(projected.binding.reqId);
        seenPaths.add(projected.binding.externalPath);
        bindings.push(projected.binding);
      }
      const report = reportArtifact(rows.length, bindings, artifacts.at(-1)!.capturedAt);
      assert(bytes + Buffer.byteLength(report.body) <= LIMIT);
      artifacts.push(report);
      const result = replay(artifacts), paginationEvaluation = evaluatePaginationEvidence({ ...paginationOptions, evidence: result.evidence });
      assert(paginationEvaluation.safeCompleteness && paginationEvaluation.verifiedEligible);
      return {
        ok: true,
        capturedAt: artifacts[0]!.capturedAt,
        payload: { jobPostings: result.jobs },
        fetchEvidence: result.evidence,
        paginationEvaluation,
        completeness: {
          completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
          expectedJobCount: rows.length,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: AMGEN_NATIVE_ENTRY,
          completenessBlockerReason: "Amgen official Radancy list and detail evidence replay",
          totalPages: pages.length,
          pageSize: 12,
          pagesVisited: pages.length
        }
      };
    } catch {
      const fetchEvidence = artifacts.length ? parsePersistentSourceFetchEvidence({
        captureTool: { name: "amgen-radancy-http", version: "1" },
        artifacts: artifacts.map(a => a.kind === "ORACLE_RESULT" ? a : { ...a, kind: "ATS_PAGE" }),
        pages: [],
        supportingArtifactOnlyFailure: { code: FAILURE },
        fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
        fetchLosses: []
      }) : undefined;
      return { ok: false, capturedAt: startedAt, failureReason: FAILURE, ...(fetchEvidence ? { fetchEvidence } : {}) };
    }
  };
}

export function validateStrictAmgenRadancyEvidence(
  plan: SourceCrawlPlan,
  input: PersistentSourceFetchEvidence,
  output: readonly NormalizedJobRecord[]
): boolean {
  try {
    assert(exactPlan(plan));
    const evidence = parsePersistentSourceFetchEvidence(input), result = replay(evidence.artifacts);
    assert(same(evidence, result.evidence));
    assert(output.length === result.jobs.length && new Set(output.map(j => j.sourceJobId)).size === output.length);
    const byId = new Map(result.jobs.map(j => [j.sourceJobId, j]));
    return output.every(job => {
      const row = byId.get(job.sourceJobId!);
      return row && typeof job.isBaseline === "boolean" && same(job, {
        companyId: plan.company.id,
        sourceId: plan.source.id,
        sourceKind: "SOCIAL",
        atsKind: "OFFICIAL_JSON",
        officialChineseCompanyName: plan.company.officialChineseName,
        sourceJobId: row.sourceJobId,
        officialTitle: row.title,
        officialUrl: row.officialUrl,
        listUrl: AMGEN_NATIVE_ENTRY,
        locationRaw: row.locationRaw,
        cities: row.cities,
        category: "其他",
        isBaseline: job.isBaseline,
        evidence: { officialEntryUrl: AMGEN_NATIVE_ENTRY, officialChainEvidenceUrl: CHAIN, capturedAt: evidence.artifacts[0]!.capturedAt }
      });
    });
  } catch {
    return false;
  }
}

export function getStrictAmgenRadancyPolicy(plan: SourceCrawlPlan): StrictProfileBoundSourcePolicy | undefined {
  if (!exactPlan(plan)) return undefined;
  return {
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    urlRules: [
      { id: "amgen-radancy-entry", url: AMGEN_NATIVE_ENTRY, match: "EXACT", allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true },
      { id: "amgen-radancy-pages", url: PAGES, match: "EXACT", allowsPagination: true },
      { id: "amgen-radancy-detail", url: `${ORIGIN}/en/job/`, match: "PATH_PREFIX" }
    ]
  };
}
