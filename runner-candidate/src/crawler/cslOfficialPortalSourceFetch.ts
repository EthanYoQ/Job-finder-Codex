import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { load } from "cheerio";
import { CITY_PENDING } from "../domain/jobLocation";
import type { OfficialJsonConfig } from "./adapters/types";
import { WORKDAY_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { JOB_QUARANTINE_PAGINATION, quarantineCompleteList, type JobQuarantine } from "./jobQuarantine";
import type { NormalizedJobRecord } from "./normalizedJob";
import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { currentOfficialSourceAttemptSignal, fetchWithOfficialTimeout, officialHttpTimeoutMs } from "./officialHttpRuntimeLimits";
import { parseOfficialRetryAfter, type OfficialRetryAfter } from "./officialRetryAfter";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import type { StrictProfileBoundSourcePolicy } from "./profileBoundSourceEvidence";
import type { SourceFetchFunction } from "./runSourceCrawl";
import {
  parsePersistentSourceFetchEvidence,
  sanitizeEvidenceHttpUrl,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft
} from "./sourceFetchEvidence";
import { retryableHttpTransportFailure, retryableTransportFailureFromError, safeSourceTransportFailureReason, type SourceTransportFailureStage } from "./sourceFetchFailure";
import type { SourceCrawlPlan } from "./sourcePlan";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";

export const CSL_OFFICIAL_PORTAL_ENTRY = "https://jobs.csl.com/en/jobs?country=china";
export const CSL_OFFICIAL_PORTAL_CONFIG = Object.freeze({ policy: "CSL_OFFICIAL_PORTAL_V1", maxPages: 20 } as const);
export type CslOfficialPortalConfig = typeof CSL_OFFICIAL_PORTAL_CONFIG;
export const CSL_PORTAL_JSON_CONFIG: OfficialJsonConfig = Object.freeze({
  ...WORKDAY_JSON_CONFIG,
  fields: Object.freeze({
    ...WORKDAY_JSON_CONFIG.fields,
    officialPublishedAt: "officialPublishedAt"
  })
});

const ORIGIN = "https://jobs.csl.com";
const PUBLIC_ENTRY = "https://jobs.csl.com/en/jobs";
const CHAIN = "https://www.csl.com/careers";
const WD_SITE_PREFIX = "https://csl.wd1.myworkdayjobs.com/CSL_External";
const REPORT = "csl-official-portal-binding-report";
const BODY_LIMIT = 2 * 1024 * 1024;
const LIMIT = 32 * 1024 * 1024;
const WINDOW = 30 * 60 * 1000;
const FAILURE = "CSL_OFFICIAL_PORTAL_INVALID";
const APPLY_RE = /^https:\/\/csl\.wd1\.myworkdayjobs\.com\/CSL_External(\/job\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+_(R-[1-9]\d*)(?:-[1-9]\d*)?)\/apply$/u;

const CSL_PORTAL_CITIES: Readonly<Record<string, string>> = {
  shanghai: "上海", beijing: "北京", guangzhou: "广州", tianjin: "天津", wenzhou: "温州", nantong: "南通", nanjing: "南京",
  suzhou: "苏州", shenzhen: "深圳", hangzhou: "杭州", wuhan: "武汉", chengdu: "成都", chongqing: "重庆", zhengzhou: "郑州",
  shenyang: "沈阳", changsha: "长沙", xuzhou: "徐州", nanning: "南宁", nanchang: "南昌", kunming: "昆明", guiyang: "贵阳",
  yuxi: "玉溪", jieyang: "揭阳", lianyungang: "连云港", ordos: "鄂尔多斯", dali: "大理", yueyang: "岳阳", qinhuangdao: "秦皇岛",
  "yulin (shaanxi)": "榆林", yichang: "宜昌", jiaozuo: "焦作", kaifeng: "开封", zhumadian: "驻马店", zhoukou: "周口",
  liuzhou: "柳州", wuhu: "芜湖", shantou: "汕头", "xi'an": "西安", xian: "西安", xiamen: "厦门", urumqi: "乌鲁木齐",
  harbin: "哈尔滨", nanchong: "南充", xinxiang: "新乡", neijiang: "内江", taiyuan: "太原", jinan: "济南", qingdao: "青岛",
  dalian: "大连", fuzhou: "福州", hefei: "合肥", wuxi: "无锡", ningbo: "宁波", changzhou: "常州", foshan: "佛山",
  yantai: "烟台", quanzhou: "泉州", zhuhai: "珠海", dongguan: "东莞", lanzhou: "兰州", shijiazhuang: "石家庄", haikou: "海口"
};

type Request = { url: string; method: "GET"; headers: Record<string, string> };
type HttpResponse = { status: number; body: string; finalUrl?: string; contentType?: string; capturedAt?: string; retryAfter?: OfficialRetryAfter };
type HttpStatusMeta = Pick<HttpResponse, "status" | "retryAfter">;
type Http = (request: Request) => Promise<HttpResponse>;
type Role = "list" | "detail";
type ListRow = { url: string };
type ParsedListPage = { page: number; total: number; start: number; end: number; hasNext: boolean; rows: ListRow[] };
type ProjectedJob = { sourceJobId: string; title: string; officialUrl: string; locationRaw: string; cities: string[]; officialPublishedAt: string };
type DetailBinding = { portalUrl: string; reqId: string; externalPath: string; officialUrl: string; officialPublishedAt: string };

class PortalHttpBodyError extends Error {
  constructor(message: string, readonly httpMeta: HttpStatusMeta) {
    super(message);
  }
}

const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const clean = (v: string) => v.replace(/\s+/gu, " ").trim();
const nonempty = (v: unknown): v is string => typeof v === "string" && clean(v).length > 0;
function assert(v: unknown): asserts v { if (!v) throw Error(FAILURE); }
const object = (v: unknown): Record<string, unknown> => { assert(v && typeof v === "object" && !Array.isArray(v)); return v as Record<string, unknown>; };
const key = (role: Role, index: number) => `csl-portal-${role}-${String(index).padStart(4, "0")}`;
const pageUrl = (page: number) => page === 1 ? CSL_OFFICIAL_PORTAL_ENTRY : `${CSL_OFFICIAL_PORTAL_ENTRY}&page=${page}`;
const makeRequest = (url: string): Request => ({
  url,
  method: "GET",
  headers: {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
  }
});
const paginationOptions = { expectedChannelIds: [] as string[], filteredOutput: true, ...JOB_QUARANTINE_PAGINATION };

export function isSafeCslOfficialPortalFailureCode(value: unknown): value is string {
  return value === FAILURE;
}

/** Escapes raw ASCII control characters strictly inside JSON string literals so embedded script JSON-LD parses deterministically. */
function escapeControlCharsInJsonStrings(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (!inString) {
      out += ch;
      if (ch === "\"") inString = true;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      out += ch;
      inString = false;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      if (ch === "\r") out += "\\r";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\t") out += "\\t";
      else out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function parseJsonLdObjects(html: string): Record<string, unknown>[] {
  const $ = load(html);
  const blocks = $("script[type='application/ld+json']").toArray();
  assert(blocks.length >= 1);
  return blocks.map(node => {
    const sanitized = escapeControlCharsInJsonStrings($(node).text());
    assert(hasUniqueJsonObjectKeys(sanitized));
    return object(JSON.parse(sanitized));
  });
}

function normalizePublishedAt(value: unknown): string {
  assert(typeof value === "string");
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    const iso = `${trimmed}T00:00:00.000Z`;
    assert(Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().startsWith(trimmed));
    return iso;
  }
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(trimmed) && Number.isFinite(Date.parse(trimmed)));
  return new Date(trimmed).toISOString();
}

function visibleText(html: string): string {
  const $ = load(html);
  const parts: string[] = [];
  function walk(node: unknown): void {
    const n = node as { type?: string; data?: string; name?: string; children?: unknown[] };
    if (n.type === "text" && typeof n.data === "string") { parts.push(n.data); return; }
    if (n.type === "tag" && (n.name === "script" || n.name === "style")) return;
    if (Array.isArray(n.children)) {
      parts.push(" ");
      for (const child of n.children) walk(child);
      parts.push(" ");
    }
  }
  walk($.root()[0]);
  return clean(parts.join(""));
}

function safeDetailUrl(candidate: unknown): string {
  assert(typeof candidate === "string" && candidate.trim() === candidate);
  const parsed = new URL(candidate.replace(/&amp;/gu, "&"));
  assert(parsed.origin === ORIGIN && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.href === candidate);
  const segments = parsed.pathname.split("/").filter(Boolean);
  assert(segments.length >= 3 && segments[0] === "en" && segments[1] === "jobs" &&
    segments.every(s => /^[A-Za-z0-9._-]+$/u.test(s) && s !== "." && s !== ".."));
  return parsed.href;
}

async function fetchPortalHttp(request: Request): Promise<HttpResponse> {
  const controller = new AbortController(), source = currentOfficialSourceAttemptSignal();
  const abort = () => controller.abort(source?.reason);
  const deadline = setTimeout(() => controller.abort(new Error("CSL official portal body deadline exceeded")), officialHttpTimeoutMs());
  if (source?.aborted) abort(); else source?.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel(controller.signal.reason).catch(() => undefined); };
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    controller.signal.throwIfAborted();
    const response = await fetchWithOfficialTimeout(request.url, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
      redirect: "error"
    });
    const retryAfter = parseOfficialRetryAfter(response.headers.get("retry-after"), Date.now());
    const httpMeta: HttpStatusMeta = {
      status: response.status,
      ...(retryAfter && "delayMs" in retryAfter ? { retryAfter } : {})
    };
    try {
      const declared = response.headers.get("content-length");
      if (declared && (!/^[0-9]+$/u.test(declared) || Number(declared) > BODY_LIMIT)) {
        void response.body?.cancel().catch(() => undefined);
        throw new PortalHttpBodyError("CSL official portal response exceeds byte limit", httpMeta);
      }
      if (!response.body) throw new PortalHttpBodyError("CSL official portal response body is missing", httpMeta);
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
          throw new PortalHttpBodyError("CSL official portal response exceeds byte limit", httpMeta);
        }
        chunks.push(chunk.value);
      }
      return {
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type") ?? "",
        body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
        capturedAt: new Date().toISOString(),
        ...(httpMeta.retryAfter ? { retryAfter: httpMeta.retryAfter } : {})
      };
    } catch (error) {
      if (error instanceof PortalHttpBodyError) throw error;
      if (httpMeta.status !== 200) {
        throw new PortalHttpBodyError(error instanceof Error ? error.message : "Failed to read HTTP response body", httpMeta);
      }
      throw error;
    }
  } finally {
    clearTimeout(deadline);
    source?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
}

function exactPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.company.id === "company-csl-china" && plan.source.id === "source-csl-china-social" &&
    plan.source.companyId === plan.company.id && plan.company.officialChineseName === "杰特贝林" && plan.company.category === "FOREIGN_PHARMA" &&
    plan.source.kind === "SOCIAL" && plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === CSL_OFFICIAL_PORTAL_ENTRY && plan.source.officialChainEvidenceUrl === CHAIN &&
    same(plan.profileBoundSource, { kind: "csl-official-portal", config: CSL_OFFICIAL_PORTAL_CONFIG }) && same(plan.json, CSL_PORTAL_JSON_CONFIG) &&
    !plan.workday && !plan.officialJsonFetch && !plan.moka && !plan.hotjob && !plan.hotjobLegacy;
}

function makeArtifact(role: Role, index: number, req: Request, response: HttpResponse, now: string): SourceFetchArtifactDraft {
  const sanitizedUrl = sanitizeEvidenceHttpUrl(req.url);
  assert(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 &&
    (response.finalUrl === req.url || response.finalUrl === sanitizedUrl) &&
    typeof response.body === "string" && Buffer.byteLength(response.body) <= BODY_LIMIT &&
    typeof response.contentType === "string" && response.contentType.length > 0 &&
    (response.status !== 200 || /^text\/html(?:;|$)/iu.test(response.contentType)));
  const capturedAt = response.capturedAt ?? now;
  assert(Number.isFinite(Date.parse(capturedAt)));
  return {
    id: key(role, index),
    logicalKey: key(role, index),
    kind: role === "list" ? "PAGINATION_PAGE" : "ATS_PAGE",
    requestedUrl: sanitizedUrl,
    finalUrl: sanitizedUrl,
    httpStatus: response.status,
    contentType: response.contentType,
    capturedAt,
    body: response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: requestContractV2Locator(role === "list" ? "schema:ItemList+Showing+a[rel='next']" : "schema:JobPosting+a[href*='/apply']", {
      family: "html",
      role: `csl-portal-${role}`,
      method: req.method,
      url: sanitizedUrl,
      body: null,
      coordinate: { index }
    })
  };
}

function parseListPage(html: string, page: number): ParsedListPage {
  const $ = load(html), jsonLds = parseJsonLdObjects(html);
  const itemLists = jsonLds.filter(doc => doc["@type"] === "ItemList");
  assert(itemLists.length === 1);
  const listDoc = itemLists[0]!, entityId = object(listDoc.mainEntityOfPage)["@id"];
  assert(typeof entityId === "string" && entityId.trim().replace(/&amp;/gu, "&") === pageUrl(page));
  const bodyText = visibleText(html);
  const viewMatch = /\bView\s+([1-9][0-9]*)\s+jobs?\b/iu.exec(bodyText);
  const showingMatch = /\bShowing\s+([1-9][0-9]*)\s+to\s+([1-9][0-9]*)\s+of\s+([1-9][0-9]*)\s+results?\b/iu.exec(bodyText);
  assert(viewMatch && showingMatch);
  const total = Number(viewMatch[1]), start = Number(showingMatch[1]), end = Number(showingMatch[2]), showingTotal = Number(showingMatch[3]);
  assert(Number.isSafeInteger(total) && total >= 1 && total === showingTotal && start >= 1 && start <= end && end <= total);
  if (page === 1) assert(start === 1);
  assert(Array.isArray(listDoc.itemListElement) && listDoc.itemListElement.length === end - start + 1);
  const items = listDoc.itemListElement.map(entry => {
    const item = object(entry);
    assert(Number.isSafeInteger(item.position));
    return { position: item.position as number, url: safeDetailUrl(item.url) };
  });
  const localOrder = items.every((item, idx) => item.position === idx + 1);
  const globalOrder = items.every((item, idx) => item.position === start + idx);
  assert(localOrder || globalOrder);
  const nextHrefs = $("a[rel='next']").toArray().map(node => $(node).attr("href")).filter((h): h is string => nonempty(h));
  const hasNext = end < total;
  if (hasNext) {
    assert(nextHrefs.length >= 1 && nextHrefs.every(href => new URL(href.trim(), ORIGIN).href === pageUrl(page + 1)));
  } else {
    assert(nextHrefs.length === 0);
  }
  return { page, total, start, end, hasNext, rows: items.map(item => ({ url: item.url })) };
}

function projectCslPortalCities(title: string, addresses: readonly Record<string, unknown>[]): { locationRaw: string; cities: string[] } {
  const descriptors: string[] = [], cities: string[] = [];
  for (const addr of addresses) {
    const countryVal = typeof addr.addressCountry === "string" ? addr.addressCountry : object(addr.addressCountry).name;
    assert(countryVal === "CN" || countryVal === "China");
    const locality = nonempty(addr.addressLocality) ? clean(addr.addressLocality) : "";
    const region = nonempty(addr.addressRegion) ? clean(addr.addressRegion) : "";
    const street = nonempty(addr.streetAddress) ? clean(addr.streetAddress) : "";
    for (const part of [locality, region, street]) {
      assert(!part || !explicitlyForeignOrNonMainlandLocation(part));
    }
    if (!locality) {
      descriptors.push(street ? `China - ${street}` : "China");
      cities.push(CITY_PENDING);
      continue;
    }
    descriptors.push(region ? `China - ${locality}, ${region}` : `China - ${locality}`);
    const normalized = locality.replace(/,\s*(?:China|CN)$/iu, "").replace(/(?:\s+City|\s+Shi|市)$/iu, "").trim().toLowerCase();
    const mapped = CSL_PORTAL_CITIES[normalized] ?? (Object.values(CSL_PORTAL_CITIES).includes(normalized) ? normalized : undefined);
    cities.push(mapped ?? CITY_PENDING);
  }
  const uniqueCities = [...new Set(cities)];
  const titleMentionsCity = [...new Set(Object.entries(CSL_PORTAL_CITIES).flatMap(([en, zh]) => {
    const escaped = en.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|[^a-z])${escaped}(?=$|[^a-z])`, "iu").test(title) || title.includes(zh) ? [zh] : [];
  }))];
  const hasConflict = titleMentionsCity.some(city => !uniqueCities.includes(city));
  return {
    locationRaw: [...new Set(descriptors)].join(" | "),
    cities: uniqueCities.includes(CITY_PENDING) || hasConflict ? [CITY_PENDING] : uniqueCities
  };
}

function projectDetail(html: string, row: ListRow): { job: ProjectedJob; binding: DetailBinding } {
  const $ = load(html), jsonLds = parseJsonLdObjects(html);
  const postings = jsonLds.filter(doc => doc["@type"] === "JobPosting");
  assert(postings.length === 1);
  const schema = postings[0]!;
  assert(nonempty(schema.title) && nonempty(schema.description) && load(schema.description).text().trim().length > 20);
  const identifier = typeof schema.identifier === "string" ? schema.identifier : object(schema.identifier);
  const reqId = typeof identifier === "string" ? identifier : identifier.value;
  assert(typeof reqId === "string" && /^R-[1-9]\d*$/u.test(reqId));
  const urlPath = new URL(row.url).pathname.replace(/\/+$/u, "");
  const urlReqMatch = /(?:^|[/-])r-([1-9]\d*)$/iu.exec(urlPath);
  assert(urlReqMatch && `R-${urlReqMatch[1]}` === reqId);
  const officialPublishedAt = normalizePublishedAt(schema.datePosted);
  const rawLocs = Array.isArray(schema.jobLocation) ? schema.jobLocation : [schema.jobLocation];
  assert(rawLocs.length > 0);
  const addresses = rawLocs.map(loc => object(object(loc).address));
  const title = clean(schema.title);
  const { locationRaw, cities } = projectCslPortalCities(title, addresses);

  const applyMatches: Array<{ path: string; req: string }> = [];
  for (const node of $("a[href]").toArray()) {
    const href = $(node).attr("href")?.trim();
    if (!href) continue;
    const match = APPLY_RE.exec(href);
    if (match) applyMatches.push({ path: match[1]!, req: match[2]! });
  }
  assert(applyMatches.length >= 1 && new Set(applyMatches.map(m => m.path)).size === 1 && applyMatches[0]!.req === reqId);
  const externalPath = applyMatches[0]!.path;
  const officialUrl = `${WD_SITE_PREFIX}${externalPath}`;
  return {
    job: { sourceJobId: `workday:sha256:${hash(externalPath)}`, title, officialUrl, locationRaw, cities, officialPublishedAt },
    binding: { portalUrl: row.url, reqId, externalPath, officialUrl, officialPublishedAt }
  };
}

function reportArtifact(total: number, bindings: DetailBinding[], capturedAt: string): SourceFetchArtifactDraft {
  return {
    id: REPORT,
    logicalKey: REPORT,
    kind: "ORACLE_RESULT",
    capturedAt,
    bodyRepresentation: "EXACT",
    extractorLocator: "csl-official-portal-v1:replayed-official-details",
    body: JSON.stringify({ policy: CSL_OFFICIAL_PORTAL_CONFIG.policy, total, bindings })
  };
}

function pageTrace(page: ParsedListPage, artifact: SourceFetchArtifactDraft, jobs: readonly { sourceJobId: string }[]) {
  return {
    artifactLogicalKey: artifact.logicalKey,
    sequence: page.page - 1,
    requestedPage: page.page,
    returnedPage: page.page,
    requestedPageSize: null,
    returnedPageSize: null,
    rawJobIds: page.rows.map(r => `sha256:${hash(r.url)}`),
    validJobIds: jobs.map(j => `sha256:${hash(j.sourceJobId)}`),
    declaredTotal: page.total,
    declaredCount: null,
    declaredPages: null,
    nextPageSignalBefore: page.page === 1 ? null : `page=${page.page}`,
    nextPageSignalAfter: page.hasNext ? `page=${page.page + 1}` : null,
    responseFingerprintSha256: hash(artifact.body as string),
    termination: (page.hasNext ? "CONTINUE" : "NEXT_ABSENT") as "CONTINUE" | "NEXT_ABSENT",
    anomalyCodes: [],
    capturedAt: artifact.capturedAt
  };
}

function assemble(
  artifacts: SourceFetchArtifactDraft[],
  pages: ParsedListPage[],
  jobs: readonly { sourceJobId: string }[],
  quarantines: JobQuarantine[] = []
): PersistentSourceFetchEvidence {
  let offset = 0;
  const traces = pages.map(page => {
    const selected = jobs.slice(offset, offset + page.rows.length);
    offset += page.rows.length;
    return pageTrace(page, artifacts.find(a => a.logicalKey === key("list", page.page))!, selected);
  });
  const first = artifacts[0]!;
  const evidence = parsePersistentSourceFetchEvidence({
    captureTool: { name: "csl-official-portal-http", version: "1" },
    artifacts,
    pages: traces,
    declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", scope: "SOURCE", value: pages[0]!.total, artifactLogicalKey: first.logicalKey, extractorLocator: first.extractorLocator },
    fetchCounts: { rawCount: jobs.length, parsedCount: jobs.length, validCount: jobs.length, parseDiscardCount: 0, validationDiscardCount: 0 },
    fetchLosses: []
  });
  return deriveCanonicalPaginationEvidence({ ...paginationOptions, evidence: quarantineCompleteList(evidence, quarantines) });
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
    assert(a.httpStatus === 200);
    return a.body;
  };
  const pages: ParsedListPage[] = [parseListPage(read("list", 1, makeRequest(pageUrl(1))), 1)];
  while (pages.at(-1)!.hasNext) {
    assert(pages.length < CSL_OFFICIAL_PORTAL_CONFIG.maxPages);
    const nextNum = pages.length + 1;
    const nextPage = parseListPage(read("list", nextNum, makeRequest(pageUrl(nextNum))), nextNum);
    assert(nextPage.total === pages[0]!.total && nextPage.start === pages.at(-1)!.end + 1);
    pages.push(nextPage);
  }
  const rows = pages.flatMap(p => p.rows);
  assert(rows.length === pages[0]!.total && new Set(rows.map(r => r.url)).size === rows.length);
  const seenReqs = new Set<string>(), seenPaths = new Set<string>(), projected: ReturnType<typeof projectDetail>[] = [];
  const listJobs: Array<{ sourceJobId: string }> = [], quarantines: JobQuarantine[] = [];
  let globalOffset = 0;
  for (const page of pages) {
    for (let recordIndex = 0; recordIndex < page.rows.length; recordIndex++) {
      const i = globalOffset + recordIndex, row = page.rows[recordIndex]!;
      let result: ReturnType<typeof projectDetail> | undefined;
      try {
        const html = read("detail", i, makeRequest(row.url));
        const candidate = projectDetail(html, row);
        assert(!seenReqs.has(candidate.binding.reqId) && !seenPaths.has(candidate.binding.externalPath));
        seenReqs.add(candidate.binding.reqId);
        seenPaths.add(candidate.binding.externalPath);
        result = candidate;
      } catch {
        const a = map.get(key("detail", i));
        if (a && artifacts[consumed]?.logicalKey === a.logicalKey) {
          const time = Date.parse(a.capturedAt);
          assert(time >= previous && time - start <= WINDOW);
          previous = time;
          assert(same({ ...a, id: key("detail", i) }, makeArtifact("detail", i, makeRequest(row.url), {
            body: a.body as string, status: a.httpStatus!, finalUrl: a.finalUrl!, contentType: a.contentType!, capturedAt: a.capturedAt
          }, a.capturedAt)));
          consumed++;
        }
      }
      if (result) { projected.push(result); listJobs.push(result.job); continue; }
      quarantines.push({
        pageSequence: page.page - 1,
        recordIndex,
        validJobId: `sha256:${hash(`unidentified:${i}`)}`,
        rawLocator: `${key("list", page.page)}#row:${recordIndex}`,
        code: "CSL_OFFICIAL_PORTAL_JOB_UNVERIFIED"
      });
      listJobs.push({ sourceJobId: `unidentified:${i}` });
    }
    globalOffset += page.rows.length;
  }
  assert(artifacts.length === consumed + 1);
  const report = reportArtifact(rows.length, projected.map(p => p.binding), (consumed > 0 ? artifacts[consumed - 1]! : artifacts[0]!).capturedAt);
  assert(same(artifacts[consumed], report));
  const jobs = projected.map(p => p.job);
  assert(new Set(jobs.map(j => j.sourceJobId)).size === jobs.length);
  return { evidence: assemble(artifacts, pages, listJobs, quarantines), jobs };
}

export function createCslOfficialPortalSourceFetch(deps: { http?: Http; now?: () => Date } = {}): SourceFetchFunction {
  return async plan => {
    const now = deps.now ?? (() => new Date()), startedAt = now().toISOString(), artifacts: SourceFetchArtifactDraft[] = [];
    let bytes = 0;
    let failedHttp: HttpStatusMeta | undefined;
    let firstDetailFailedHttp: HttpStatusMeta | undefined;
    let firstDetailRetryableHttp: HttpStatusMeta | undefined;
    let firstDetailTransportError: unknown;
    let firstDetailRetryableTransportError: unknown;
    let closedList: ParsedListPage[] | undefined;
    let stage: SourceTransportFailureStage = "ENTRY";
    try {
      assert(exactPlan(plan));
      const http: Http = deps.http ?? fetchPortalHttp;
      let blocked: HttpStatusMeta | undefined;
      const recordDetailHttpFailure = (meta: HttpStatusMeta) => {
        if (!firstDetailFailedHttp) firstDetailFailedHttp = meta;
        if (!firstDetailRetryableHttp && retryableHttpTransportFailure(meta.status, meta.retryAfter)) {
          firstDetailRetryableHttp = meta;
        }
      };
      const acquire = async (role: Role, index: number, req: Request) => {
        assert(!blocked);
        stage = role === "list" && index === 1 ? "ENTRY" : "PAGE";
        let response: HttpResponse;
        try {
          response = await http(req);
        } catch (error) {
          if (error instanceof PortalHttpBodyError) {
            if (error.httpMeta.status === 403 || error.httpMeta.status === 429) blocked = error.httpMeta;
            if (error.httpMeta.status !== 200 && role === "list") failedHttp = error.httpMeta;
            if (error.httpMeta.status !== 200 && role === "detail") recordDetailHttpFailure(error.httpMeta);
          }
          if (role === "detail") {
            if (firstDetailTransportError === undefined) firstDetailTransportError = error;
            if (firstDetailRetryableTransportError === undefined && retryableTransportFailureFromError(error)) {
              firstDetailRetryableTransportError = error;
            }
          }
          throw error;
        }
        if (response.status === 403 || response.status === 429) blocked = response;
        if (response.status !== 200 && role === "list") failedHttp = response;
        if (response.status !== 200 && role === "detail") recordDetailHttpFailure(response);
        const a = makeArtifact(role, index, req, response, now().toISOString());
        bytes += Buffer.byteLength(a.body);
        assert(bytes <= LIMIT);
        artifacts.push(a);
        assert(a.httpStatus === 200);
        return a.body as string;
      };
      const pages: ParsedListPage[] = [parseListPage(await acquire("list", 1, makeRequest(pageUrl(1))), 1)];
      while (pages.at(-1)!.hasNext) {
        assert(pages.length < CSL_OFFICIAL_PORTAL_CONFIG.maxPages);
        const nextNum = pages.length + 1;
        const nextPage = parseListPage(await acquire("list", nextNum, makeRequest(pageUrl(nextNum))), nextNum);
        assert(nextPage.total === pages[0]!.total && nextPage.start === pages.at(-1)!.end + 1);
        pages.push(nextPage);
      }
      const rows = pages.flatMap(p => p.rows);
      assert(rows.length === pages[0]!.total && new Set(rows.map(r => r.url)).size === rows.length);
      closedList = pages;
      const bindings: DetailBinding[] = [], seenReqs = new Set<string>(), seenPaths = new Set<string>();
      for (const [i, row] of rows.entries()) {
        try {
          const html = await acquire("detail", i, makeRequest(row.url));
          const projected = projectDetail(html, row);
          assert(!seenReqs.has(projected.binding.reqId) && !seenPaths.has(projected.binding.externalPath));
          seenReqs.add(projected.binding.reqId);
          seenPaths.add(projected.binding.externalPath);
          bindings.push(projected.binding);
        } catch {
          // Single-job failures isolate via quarantineCompleteList during replay unless blocked or all rows fail in transport.
        }
      }
      if (blocked) {
        failedHttp = blocked;
        throw Error(FAILURE);
      }
      if (rows.length > 0 && bindings.length === 0 && (firstDetailFailedHttp || firstDetailTransportError !== undefined)) {
        if (firstDetailRetryableHttp) {
          failedHttp = firstDetailRetryableHttp;
          throw Error(FAILURE);
        }
        if (firstDetailRetryableTransportError !== undefined) {
          throw firstDetailRetryableTransportError instanceof Error ? firstDetailRetryableTransportError : Error(FAILURE);
        }
        if (firstDetailFailedHttp) failedHttp = firstDetailFailedHttp;
        throw firstDetailTransportError instanceof Error ? firstDetailTransportError : Error(FAILURE);
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
          completenessEvidenceUrl: CSL_OFFICIAL_PORTAL_ENTRY,
          completenessBlockerReason: "CSL official portal ItemList and JobPosting detail evidence replay",
          totalPages: pages.length,
          pagesVisited: pages.length
        }
      };
    } catch (error) {
      const failure = failedHttp
        ? retryableHttpTransportFailure(failedHttp.status, failedHttp.retryAfter)
        : retryableTransportFailureFromError(error);
      const transportFailure = failure ? { ...failure, stage } : undefined;
      const failureReason = transportFailure ? safeSourceTransportFailureReason(transportFailure)
        : failedHttp ? `Official JSON source returned HTTP ${failedHttp.status}` : FAILURE;
      let fetchEvidence: PersistentSourceFetchEvidence | undefined;
      if (closedList) {
        const rawCount = closedList.reduce((count, page) => count + page.rows.length, 0), first = artifacts[0]!;
        fetchEvidence = parsePersistentSourceFetchEvidence({
          captureTool: { name: "csl-official-portal-http", version: "1" },
          artifacts,
          pages: closedList.map(page => pageTrace(page, artifacts.find(a => a.logicalKey === key("list", page.page))!, [])),
          fetchCounts: { rawCount, parsedCount: rawCount, validCount: 0, parseDiscardCount: 0, validationDiscardCount: rawCount },
          fetchLosses: closedList.flatMap(page => page.rows.map((_, recordIndex) => ({
            stage: "VALIDATION",
            reason: "CSL official portal binding was not completed",
            rawLocator: `${key("list", page.page)}#row:${recordIndex}`,
            details: { code: "CSL_OFFICIAL_PORTAL_BINDING_INCOMPLETE", pageSequence: page.page - 1, recordIndex },
            recordedAt: first.capturedAt
          })))
        });
      } else if (artifacts.length) {
        fetchEvidence = parsePersistentSourceFetchEvidence({
          captureTool: { name: "csl-official-portal-http", version: "1" },
          artifacts: artifacts.map(a => a.kind === "ORACLE_RESULT" ? a : { ...a, kind: "ATS_PAGE" }),
          pages: [],
          supportingArtifactOnlyFailure: { code: FAILURE },
          fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
          fetchLosses: []
        });
      }
      return {
        ok: false,
        capturedAt: startedAt,
        failureReason,
        ...(transportFailure ? { transportFailure } : {}),
        ...(fetchEvidence ? { fetchEvidence } : {})
      };
    }
  };
}

export function validateStrictCslOfficialPortalEvidence(
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
        listUrl: PUBLIC_ENTRY,
        locationRaw: row.locationRaw,
        cities: row.cities,
        category: "其他",
        officialPublishedAt: row.officialPublishedAt,
        isBaseline: job.isBaseline,
        evidence: { officialEntryUrl: PUBLIC_ENTRY, officialChainEvidenceUrl: CHAIN, capturedAt: evidence.artifacts[0]!.capturedAt }
      });
    });
  } catch {
    return false;
  }
}

export function getStrictCslOfficialPortalPolicy(plan: SourceCrawlPlan): StrictProfileBoundSourcePolicy | undefined {
  if (!exactPlan(plan)) return undefined;
  return {
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true,
    urlRules: [
      ...Array.from({ length: CSL_OFFICIAL_PORTAL_CONFIG.maxPages }, (_, index) => {
        const page = index + 1;
        return {
          id: `csl-official-page-${page}`,
          url: sanitizeEvidenceHttpUrl(pageUrl(page)),
          match: "EXACT" as const,
          allowsPagination: true as const,
          ...(page === 1 ? { allowsDeclaration: true as const, allowsPositiveTotalDeclaration: true as const } : {})
        };
      }),
      { id: "csl-official-detail", url: `${ORIGIN}/en/jobs/`, match: "PATH_PREFIX" }
    ]
  };
}
