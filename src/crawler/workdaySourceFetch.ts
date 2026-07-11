import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import {
  parsePersistentSourceFetchEvidence,
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";

export interface WorkdayFetchConfig {
  tenant: string;
  site: string;
  searchText?: string;
  appliedFacets?: Record<string, readonly string[]>;
  pageSize?: number;
  maxPages?: number;
  cityHints?: Record<string, readonly string[]>;
}

export interface WorkdayHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface WorkdayHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type WorkdayHttpClient = (request: WorkdayHttpRequest) => Promise<WorkdayHttpResponse>;

export interface WorkdaySourceFetchDeps {
  http?: WorkdayHttpClient;
  now?: () => Date;
}

interface WorkdayJobPosting {
  title?: unknown;
  externalPath?: unknown;
  locationsText?: unknown;
  bulletFields?: unknown;
}

interface WorkdayJobsResponse {
  total?: unknown;
  jobPostings?: unknown;
  facets?: unknown;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 20;

const CITY_MATCHES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"],
  ["Beijing", "北京"],
  ["Suzhou", "苏州"],
  ["Guangzhou", "广州"],
  ["Dongguan", "东莞"],
  ["Huizhou", "惠州"],
  ["Shenzhen", "深圳"],
  ["Hangzhou", "杭州"],
  ["Nanjing", "南京"],
  ["Changsha", "长沙"],
  ["Weifang", "潍坊"],
  ["Wuhan", "武汉"],
  ["Chengdu", "成都"],
  ["Tianjin", "天津"],
  ["Zhengzhou", "郑州"],
  ["Shenyang", "沈阳"],
  ["Huhehaote", "呼和浩特"],
  ["Hohhot", "呼和浩特"],
  ["Guangdong", "广东"],
  ["Zhejiang", "浙江"],
  ["Jiangsu", "江苏"],
  ["Hunan", "湖南"],
  ["Henan", "河南"],
  ["Shandong", "山东"]
];
const WORKDAY_REGION_FALLBACKS = new Set(["广东", "浙江", "江苏", "湖南", "河南", "山东"]);

export function createWorkdaySourceFetch(deps: WorkdaySourceFetchDeps = {}): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();
    let latestEvidence: PersistentSourceFetchEvidence | undefined;
    let latestEvaluation: ReturnType<typeof evaluatePaginationEvidence> | undefined;

    if (plan.source.atsKind !== "WORKDAY") {
      return failed(capturedAt, "Workday source fetch only supports WORKDAY sources");
    }

    if (plan.adapterId !== "official-json" || !plan.workday) {
      return failed(capturedAt, `Workday source ${plan.source.id} is missing Workday config`);
    }

    try {
      const http = deps.http ?? defaultWorkdayHttpClient;
      const jobs: ReturnType<typeof enrichWorkdayJob>[number][] = [];
      const artifacts: SourceFetchArtifactDraft[] = [];
      const pages: SourceFetchPageTrace[] = [];
      const fetchLosses: PersistentSourceFetchEvidence["fetchLosses"] = [];
      const pageSize = normalizePageSize(plan.workday.pageSize);
      const maxPages = Math.max(1, plan.workday.maxPages ?? DEFAULT_MAX_PAGES);
      const url = workdayJobsUrl(plan.source.officialEntryUrl, plan.workday);
      const origin = new URL(plan.source.officialEntryUrl).origin;
      const sitePath = normalizedSitePath(plan.source.officialEntryUrl);
      const configuredAppliedFacets = plan.workday.appliedFacets ?? {};
      let appliedFacets = configuredAppliedFacets;
      let searchText = plan.workday.searchText;
      let expectedJobCount: number | undefined;
      let pagesVisited = 0;
      let rawCount = 0;
      let parsedCount = 0;
      let validCount = 0;
      let parseDiscardCount = 0;
      let validationDiscardCount = 0;
      let scopeRejectCount = 0;

      if (!hasConfiguredLocationFacet(configuredAppliedFacets) && searchText) {
        const preflight = await requestWorkdayJobs({
          http,
          url,
          origin,
          referer: plan.source.officialEntryUrl,
          appliedFacets,
          searchText,
          pageSize,
          offset: 0
        });
        if (preflight.status < 200 || preflight.status >= 300) {
          return failed(capturedAt, `Workday jobs API returned HTTP ${preflight.status}`);
        }
        assertEvidenceResponse(preflight);
        artifacts.push(workdayArtifact("workday-preflight-0000", "ATS_API_RESPONSE", url, preflight, "$.facets"));
        const discoveredFacets = chinaLocationAppliedFacets(
          parseWorkdayJobsResponse(preflight.body).facets
        );
        if (discoveredFacets) {
          appliedFacets = { ...configuredAppliedFacets, ...discoveredFacets };
          searchText = undefined;
        }
      }

      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const offset = pageIndex * pageSize;
        const response = await requestWorkdayJobs({
          http,
          url,
          origin,
          referer: plan.source.officialEntryUrl,
          appliedFacets,
          searchText,
          pageSize,
          offset
        });

        if (response.status < 200 || response.status >= 300) {
          return failed(capturedAt, `Workday jobs API returned HTTP ${response.status}`);
        }

        assertEvidenceResponse(response);

        const parsed = parseWorkdayJobsResponse(response.body);
        const artifactLogicalKey = `workday-page-${String(pageIndex).padStart(4, "0")}`;
        artifacts.push(workdayArtifact(artifactLogicalKey, "PAGINATION_PAGE", url, response, "$.total"));
        expectedJobCount = expectedJobCount ?? parsed.total;
        pagesVisited += 1;
        const pageJobs: ReturnType<typeof enrichWorkdayJob>[number][] = [];
        const rawJobIds: string[] = [];
        const validJobIds: string[] = [];
        for (let recordIndex = 0; recordIndex < parsed.jobPostings.length; recordIndex += 1) {
          const raw = parsed.jobPostings[recordIndex];
          const rawLocator = workdayRawLocator(raw, artifactLogicalKey, pageIndex, recordIndex);
          rawJobIds.push(irreversibleEvidenceId(raw));
          rawCount += 1;
          if (!isRecord(raw) || Array.isArray(raw)) {
            parseDiscardCount += 1;
            fetchLosses.push({
              stage: "PARSE",
              reason: "Workday record is not an object",
              rawLocator,
              details: { code: "NON_OBJECT_RECORD", pageSequence: pageIndex, recordIndex },
              recordedAt: response.capturedAt
            });
            continue;
          }
          parsedCount += 1;
          const missingField = missingWorkdayRequiredField(raw);
          if (missingField) {
            validationDiscardCount += 1;
            fetchLosses.push({
              stage: "VALIDATION",
              reason: "Workday record is missing a required field",
              rawLocator,
              details: { code: "MISSING_REQUIRED_FIELD", field: missingField, pageSequence: pageIndex, recordIndex },
              recordedAt: response.capturedAt
            });
            continue;
          }
          const safeExternalPath = validatedWorkdayExternalPath(raw.externalPath, origin);
          if (!safeExternalPath) {
            validationDiscardCount += 1;
            fetchLosses.push({
              stage: "VALIDATION",
              reason: "Workday record has an invalid external path",
              rawLocator,
              details: { code: "INVALID_EXTERNAL_PATH", field: "externalPath", pageSequence: pageIndex, recordIndex },
              recordedAt: response.capturedAt
            });
            continue;
          }
          if (!hasRecordLevelChinaEvidence(raw, plan.workday.cityHints)) {
            validationDiscardCount += 1;
            scopeRejectCount += 1;
            fetchLosses.push({
              stage: "VALIDATION",
              reason: "Workday record has no record-level China scope evidence",
              rawLocator,
              details: { code: "OUT_OF_SCOPE", pageSequence: pageIndex, recordIndex },
              recordedAt: response.capturedAt
            });
            continue;
          }
          const normalized = enrichWorkdayJob(raw, {
            origin,
            sitePath,
            ...(plan.workday?.cityHints ? { cityHints: plan.workday.cityHints } : {}),
            defaultCities: ["中国"]
          });
          const credentialField = normalized[0] ? emittedCredentialField(normalized[0]) : undefined;
          if (credentialField) {
            validationDiscardCount += 1;
            fetchLosses.push({
              stage: "VALIDATION",
              reason: "Workday normalized job contains credential material",
              rawLocator,
              details: { code: "CREDENTIAL_MATERIAL", field: credentialField, pageSequence: pageIndex, recordIndex },
              recordedAt: response.capturedAt
            });
            continue;
          }
          pageJobs.push(...normalized);
          validCount += normalized.length;
          validJobIds.push(...normalized.map((job) => irreversibleEvidenceId(job.sourceJobId)));
        }

        jobs.push(...pageJobs);
        const rawSeen = rawCount;
        const hasNext = expectedJobCount === undefined
          ? parsed.jobPostings.length === pageSize
          : rawSeen < expectedJobCount;
        const isLastAllowedPage = pageIndex === maxPages - 1;
        const termination: SourceFetchPageTrace["termination"] = hasNext
          ? (isLastAllowedPage ? "MAX_PAGE_LIMIT" : "CONTINUE")
          : parsed.jobPostings.length === 0 && expectedJobCount === 0
            ? "EMPTY_PAGE"
            : expectedJobCount !== undefined && parsed.total === expectedJobCount &&
                new Set([...pages.flatMap((page) => page.validJobIds), ...validJobIds]).size === expectedJobCount
              ? "DECLARED_TOTAL_REACHED"
              : "NEXT_ABSENT";
        pages.push({
          sequence: pageIndex,
          artifactLogicalKey,
          requestedOffset: offset,
          returnedOffset: offset,
          requestedPage: pageIndex,
          returnedPage: pageIndex,
          requestedPageSize: pageSize,
          returnedPageSize: null,
          rawJobIds: [...new Set(rawJobIds)],
          validJobIds: [...new Set(validJobIds)],
          declaredTotal: parsed.total ?? null,
          declaredCount: null,
          declaredPages: parsed.total === undefined ? null : Math.ceil(parsed.total / pageSize),
          nextPageSignalBefore: pageIndex === 0 ? null : String(offset),
          nextPageSignalAfter: hasNext ? String(offset + pageSize) : null,
          responseFingerprintSha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
          termination,
          anomalyCodes: [],
          capturedAt: response.capturedAt!
        });

        if (!hasNext || isLastAllowedPage) {
          break;
        }
      }

      const firstOfficialTotalPage = pages.find((page) => page.declaredTotal !== null && page.declaredTotal !== undefined);
      const rawEvidence = parsePersistentSourceFetchEvidence({
        captureTool: { name: "job-search-workday-fetch", version: "1" },
        artifacts,
        pages,
        ...(firstOfficialTotalPage && expectedJobCount !== undefined
          ? {
              declaredCompleteness: {
                kind: "OFFICIAL_TOTAL_COUNT",
                value: expectedJobCount,
                artifactLogicalKey: firstOfficialTotalPage.artifactLogicalKey,
                extractorLocator: "$.total",
                scope: "SOURCE"
              }
            }
          : {}),
        fetchCounts: { rawCount, parsedCount, validCount, parseDiscardCount, validationDiscardCount },
        fetchLosses
      });
      latestEvidence = rawEvidence;
      const evidence = deriveCanonicalPaginationEvidence({
        evidence: rawEvidence,
        expectedChannelIds: [],
        filteredOutput: Object.keys(appliedFacets).length > 0 || Boolean(searchText)
      });
      latestEvidence = evidence;
      const paginationEvaluation = evaluatePaginationEvidence({
        evidence,
        expectedChannelIds: [],
        filteredOutput: Object.keys(appliedFacets).length > 0 || Boolean(searchText)
      });
      latestEvaluation = paginationEvaluation;
      if (!paginationEvaluation.safeCompleteness) {
        return failed(capturedAt, `Workday pagination evidence failed: ${paginationEvaluation.derivedAnomalyCodes.join(",")}`, evidence, paginationEvaluation);
      }
      if (rawCount > 0 && validCount === 0 && scopeRejectCount > 0) {
        return failed(capturedAt, "Workday source has no record-level China evidence", evidence, paginationEvaluation);
      }

      return {
        ok: true,
        capturedAt,
        payload: { jobPostings: jobs },
        completeness:
          expectedJobCount === undefined
            ? {
                completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
                completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
                completenessEvidenceUrl: plan.source.officialEntryUrl,
                completenessBlockerReason: "Workday response did not include an official total count",
                pageSize,
                pagesVisited
              }
            : {
                completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
                expectedJobCount,
                completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
                completenessEvidenceUrl: plan.source.officialEntryUrl,
                completenessBlockerReason: "Official Workday total is archived; downstream adapter accounting must prove final dedupe output",
                totalPages: Math.ceil(expectedJobCount / pageSize),
                pageSize,
                pagesVisited
              },
        fetchEvidence: evidence,
        paginationEvaluation
      };
    } catch (error) {
      return failed(
        capturedAt,
        error instanceof Error ? error.message : String(error),
        latestEvidence,
        latestEvaluation
      );
    }
  };
}

function assertEvidenceResponse(response: WorkdayHttpResponse): void {
  if (
    typeof response.finalUrl !== "string" || !response.finalUrl ||
    typeof response.contentType !== "string" || !response.contentType.trim() ||
    typeof response.capturedAt !== "string" || !Number.isFinite(Date.parse(response.capturedAt))
  ) {
    throw new Error("Workday response is missing required evidence metadata (final URL, content type, or captured time)");
  }
  sanitizeEvidenceHttpUrl(response.finalUrl);
}

function workdayArtifact(
  logicalKey: string,
  kind: "ATS_API_RESPONSE" | "PAGINATION_PAGE",
  requestedUrl: string,
  response: WorkdayHttpResponse,
  extractorLocator: string
): SourceFetchArtifactDraft {
  assertEvidenceResponse(response);
  return {
    id: logicalKey,
    logicalKey,
    kind,
    requestedUrl: sanitizeEvidenceHttpUrl(requestedUrl),
    finalUrl: sanitizeEvidenceHttpUrl(response.finalUrl!),
    httpStatus: response.status,
    contentType: response.contentType!,
    capturedAt: response.capturedAt!,
    body: response.body,
    extractorLocator
  };
}

function workdayRawLocator(
  raw: unknown,
  artifactLogicalKey: string,
  pageSequence: number,
  recordIndex: number
): string {
  const rawBytes = Buffer.from(JSON.stringify(raw), "utf8");
  return `${artifactLogicalKey}#page-${pageSequence}#record-${recordIndex}#sha256:${sha256Bytes(rawBytes).sha256}`;
}

function irreversibleEvidenceId(value: unknown): string {
  return `sha256:${sha256Bytes(Buffer.from(JSON.stringify(value), "utf8")).sha256}`;
}

function missingWorkdayRequiredField(job: Record<string, unknown>): string | undefined {
  if (!stringValue(job.externalPath)) return "externalPath";
  if (!stringValue(job.title)) return "title";
  if (!stringValue(job.locationsText)) return "locationsText";
  return undefined;
}

function validatedWorkdayExternalPath(value: unknown, origin: string): string | undefined {
  if (typeof value !== "string" || value !== value.trim() || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }
  if (/[?#\u0000-\u001f\u007f]/u.test(value) || containsCredentialMaterial(value)) {
    return undefined;
  }
  try {
    const resolved = new URL(value, origin);
    return resolved.origin === origin && !resolved.username && !resolved.password ? value : undefined;
  } catch {
    return undefined;
  }
}

function emittedCredentialField(job: {
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}): string | undefined {
  const fields: Array<[string, string]> = [
    ["sourceJobId", job.sourceJobId],
    ["title", job.title],
    ["officialUrl", job.officialUrl],
    ["locationRaw", job.locationRaw],
    ...job.cities.map((city) => ["cities", city] as [string, string])
  ];
  return fields.find(([, value]) => containsCredentialMaterial(value))?.[0];
}

function containsCredentialMaterial(value: string): boolean {
  const decoded = safeDecode(value);
  return /\bbearer(?:\s|%20|[:=])+\s*[A-Za-z0-9._~+/=%-]{6,}/iu.test(decoded) ||
    /(?:^|[^a-z0-9])(?:token|secret|password|passwd|pwd|credential|auth|authorization|cookie|session|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s&]+/iu.test(decoded);
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function hasRecordLevelChinaEvidence(
  job: Record<string, unknown>,
  cityHints: Record<string, readonly string[]> | undefined
): boolean {
  const scopeText = `${stringValue(job.locationsText) ?? ""} ${stringValue(job.externalPath) ?? ""}`;
  const normalized = scopeText.toLowerCase();
  if (/(?:^|[^a-z])(?:china|chn|cn)(?:[^a-z]|$)/u.test(normalized) || scopeText.includes("中国")) {
    return true;
  }
  if (CITY_MATCHES.some(([needle]) => normalized.includes(needle.toLowerCase()))) {
    return true;
  }
  return Object.entries(cityHints ?? {}).some(([hint, cities]) =>
    cities.length > 0 && normalized.includes(hint.toLowerCase()));
}

function requestWorkdayJobs({
  http,
  url,
  origin,
  referer,
  appliedFacets,
  searchText,
  pageSize,
  offset
}: {
  http: WorkdayHttpClient;
  url: string;
  origin: string;
  referer: string;
  appliedFacets: Record<string, readonly string[]>;
  searchText: string | undefined;
  pageSize: number;
  offset: number;
}): Promise<WorkdayHttpResponse> {
  return http({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: origin,
      Referer: referer,
      "User-Agent": "job-search-crawler/0.1"
    },
    body: JSON.stringify({
      appliedFacets,
      ...(searchText ? { searchText } : {}),
      limit: pageSize,
      offset
    })
  });
}

function failed(
  capturedAt: string,
  failureReason: string,
  fetchEvidence?: PersistentSourceFetchEvidence,
  paginationEvaluation?: ReturnType<typeof evaluatePaginationEvidence>
): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason,
    ...(fetchEvidence ? { fetchEvidence } : {}),
    ...(paginationEvaluation ? { paginationEvaluation } : {})
  };
}

async function defaultWorkdayHttpClient(
  request: WorkdayHttpRequest
): Promise<WorkdayHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  return {
    status: response.status,
    body: await response.text(),
    finalUrl: response.url,
    ...(response.headers.get("content-type")
      ? { contentType: response.headers.get("content-type")! }
      : {}),
    capturedAt: new Date().toISOString()
  };
}

function workdayJobsUrl(entryUrl: string, config: WorkdayFetchConfig): string {
  const origin = new URL(entryUrl).origin;
  return `${origin}/wday/cxs/${config.tenant}/${config.site}/jobs`;
}

function normalizedSitePath(entryUrl: string): string {
  const pathname = new URL(entryUrl).pathname.replace(/\/+$/, "");
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function normalizePageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(20, Math.max(1, Math.floor(pageSize)));
}

function parseWorkdayJobsResponse(body: string): {
  total?: number;
  jobPostings: unknown[];
  facets?: unknown;
} {
  const parsed = JSON.parse(body) as WorkdayJobsResponse;
  if (!Array.isArray(parsed.jobPostings)) {
    throw new Error("Workday response is missing the required jobPostings array");
  }
  const total = typeof parsed.total === "number" && parsed.total >= 0 ? parsed.total : undefined;
  const jobPostings = parsed.jobPostings;

  return {
    ...(total === undefined ? {} : { total }),
    jobPostings,
    ...(parsed.facets === undefined ? {} : { facets: parsed.facets })
  };
}

function chinaLocationAppliedFacets(facets: unknown): Record<string, readonly string[]> | undefined {
  const groups = collectFacetValueGroups(facets)
    .filter((group) => isLocationFacet(group.facetParameter, group.descriptor))
    .map((group) => ({
      facetParameter: group.facetParameter,
      ids: group.values
        .filter((value) => isChinaLocationDescriptor(value.descriptor))
        .map((value) => value.id)
    }))
    .filter((group) => group.ids.length > 0);

  if (groups.length === 0) {
    return undefined;
  }

  return Object.fromEntries(groups.map((group) => [group.facetParameter, group.ids]));
}

function hasConfiguredLocationFacet(appliedFacets: Record<string, readonly string[]>): boolean {
  return Object.keys(appliedFacets).some((facetParameter) =>
    isLocationFacet(facetParameter, facetParameter)
  );
}

function collectFacetValueGroups(
  value: unknown,
  inheritedParameter?: string,
  inheritedDescriptor?: string
): Array<{
  facetParameter: string;
  descriptor?: string;
  values: Array<{ id: string; descriptor: string }>;
}> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFacetValueGroups(item, inheritedParameter, inheritedDescriptor));
  }

  if (!isRecord(value)) {
    return [];
  }

  const facetParameter = stringValue(value.facetParameter) ?? inheritedParameter;
  const descriptor = stringValue(value.descriptor) ?? inheritedDescriptor;
  const values = Array.isArray(value.values) ? value.values : [];
  const directValues = values.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const id = stringValue(item.id);
    const itemDescriptor = stringValue(item.descriptor);
    return id && itemDescriptor ? [{ id, descriptor: itemDescriptor }] : [];
  });
  const nestedValues = values.flatMap((item) =>
    collectFacetValueGroups(item, facetParameter, descriptor)
  );

  return [
    ...(facetParameter && directValues.length > 0
      ? [
          {
            facetParameter,
            ...(descriptor === undefined ? {} : { descriptor }),
            values: directValues
          }
        ]
      : []),
    ...nestedValues
  ];
}

function isLocationFacet(parameter: string, descriptor: string | undefined): boolean {
  return /location/i.test(parameter) || /location|state|province/i.test(descriptor ?? "");
}

const CHINA_LOCATION_TERMS = [
  "china",
  "chn",
  "cn",
  "beijing",
  "shanghai",
  "chengdu",
  "nanjing",
  "nanning",
  "shenzhen",
  "urumqi",
  "wenzhou",
  "wuhan",
  "zhuhai",
  "xian",
  "xi'an",
  "shijiazhuang",
  "dongying",
  "suzhou",
  "hangzhou",
  "guangzhou",
  "dongguan",
  "huizhou",
  "changsha",
  "weifang",
  "tianjin",
  "zhengzhou",
  "shenyang",
  "sichuan",
  "shaanxi",
  "guangdong",
  "zhejiang",
  "jiangsu",
  "hunan",
  "henan",
  "shandong",
  "liaoning",
  "hebei"
] as const;

function isChinaLocationDescriptor(descriptor: string): boolean {
  const normalized = descriptor.toLowerCase();
  return CHINA_LOCATION_TERMS.some((term) => new RegExp(`(^|[^a-z])${escapeRegExp(term)}([^a-z]|$)`, "u").test(normalized));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function enrichWorkdayJob(
  job: WorkdayJobPosting,
  context: {
    origin: string;
    sitePath: string;
    cityHints?: Record<string, readonly string[]>;
    defaultCities?: readonly string[];
  }
): Array<{
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}> {
  const title = stringValue(job.title);
  const externalPath = stringValue(job.externalPath);
  const locationRaw = stringValue(job.locationsText);
  if (!title || !externalPath || !locationRaw) {
    return [];
  }

  return [
    {
      sourceJobId: sourceJobId(externalPath),
      title,
      officialUrl: `${context.origin}${context.sitePath}${externalPath}`,
      locationRaw,
      cities: citiesFromWorkdayLocation(
        locationRaw,
        context.cityHints,
        `${externalPath} ${title}`,
        context.defaultCities
      )
    }
  ];
}

function sourceJobId(externalPath: string): string {
  return `workday:sha256:${sha256Bytes(Buffer.from(externalPath, "utf8")).sha256}`;
}

function citiesFromWorkdayLocation(
  locationRaw: string,
  cityHints: Record<string, readonly string[]> | undefined,
  fallbackText = "",
  defaultCities: readonly string[] | undefined = undefined
): string[] {
  const searchableLocation = `${locationRaw} ${fallbackText}`;
  const lowerLocation = searchableLocation.toLowerCase();
  const hinted = Object.entries(cityHints ?? {}).flatMap(([hint, cities]) =>
    lowerLocation.includes(hint.toLowerCase()) ? cities : []
  );
  const mapped = CITY_MATCHES.flatMap(([needle, city]) =>
    lowerLocation.includes(needle.toLowerCase()) ? [city] : []
  );
  const hasSpecificCity = mapped.some((city) => !WORKDAY_REGION_FALLBACKS.has(city));
  const locationMatches = hasSpecificCity
    ? mapped.filter((city) => !WORKDAY_REGION_FALLBACKS.has(city))
    : mapped;

  const cities = [...new Set([...hinted, ...locationMatches])];
  if (cities.length === 0 && defaultCities !== undefined) {
    return [...defaultCities];
  }
  return cities.length > 0 || !/(china|chn)\b/u.test(lowerLocation) ? cities : ["中国"];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
