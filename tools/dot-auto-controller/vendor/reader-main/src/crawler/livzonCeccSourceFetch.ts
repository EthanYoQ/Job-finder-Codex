import { createHash } from "node:crypto";
import { load, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchWithOfficialTimeout } from "./officialHttpRuntimeLimits";
import {
  irreversibleOfficialJsonEvidenceId
} from "./officialJsonEvidence";
import {
  deriveCanonicalPaginationEvidence,
  evaluatePaginationEvidence
} from "./paginationEvidence";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import type { SourceCrawlPlan } from "./sourcePlan";
import {
  parsePersistentSourceFetchEvidence,
  sha256Bytes,
  type SourceFetchArtifactDraft
} from "./sourceFetchEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export interface LivzonCeccPartitionConfig {
  routePath: string;
  categoryId: string;
  categoryName: string;
}

export interface LivzonCeccFetchConfig {
  socialIndexUrl: string;
  routeDeclaredListApiUrl: string;
  listApiUrl: string;
  pageSize: number;
  maxPagesPerPartition: number;
  auditedPartitions: readonly LivzonCeccPartitionConfig[];
  socialPartitionSelector?: string;
}

export interface LivzonCeccHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface LivzonCeccHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
  setCookie?: readonly string[];
}

export type LivzonCeccHttpClient = (
  request: LivzonCeccHttpRequest
) => Promise<LivzonCeccHttpResponse>;

export interface LivzonCeccSourceFetchDeps {
  http?: LivzonCeccHttpClient;
  now?: () => Date;
}

interface CeccPageParams {
  size: number;
  query: Array<Record<string, unknown>>;
  header: Record<string, unknown>;
  from: number;
  sort: unknown[];
  _detailId: string;
}

interface ParsedRouteConfig {
  params: CeccPageParams;
  totalCount: number;
}

interface ParsedApiPage {
  size: number;
  from: number;
  totalCount: number;
  list: unknown[];
}

interface NormalizedCeccJob {
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}

const LIVZON_ORIGIN = "https://www.livzon.com.cn";
const LIVZON_COMPANY_ID = "company-livzon";
const LIVZON_SOURCE_ID = "source-livzon-social";
const DEFAULT_PARTITION_SELECTOR = [
  "#c_product_list_041-1735488276515 .p_list > .p_loopitem .e_text-5 a[href]",
  "#livzon-social-units article h2 a[href]"
].join(",");

export function createLivzonCeccSourceFetch(
  deps: LivzonCeccSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const now = deps.now ?? (() => new Date());
    const capturedAt = now().toISOString();
    const config = readLivzonCeccConfig(plan);
    if (!config) {
      return failed(capturedAt, "LIVZON_CECC_CONFIG_MISSING");
    }

    try {
      validatePlanBinding(plan, config);
      const http = deps.http ?? createDefaultHttpClient(now);
      const artifacts: SourceFetchArtifactDraft[] = [];
      const apiPages: Array<{
        artifactLogicalKey: string;
        responseFingerprintSha256: string;
        rawJobIds: string[];
        validJobIds: string[];
        capturedAt: string;
      }> = [];

      const socialResponse = await http({
        url: config.socialIndexUrl,
        method: "GET",
        headers: htmlHeaders(config.socialIndexUrl)
      });
      assertResponse(socialResponse, config.socialIndexUrl, "text/html");
      artifacts.push(livzonNetworkArtifact({
        logicalKey: "livzon-social-index",
        kind: "OFFICIAL_COMPANY_PAGE",
        requestedUrl: config.socialIndexUrl,
        response: socialResponse,
        capturedAt,
        extractorLocator: requestContractV2Locator("livzon-cecc-social-index-v1", {
          family: "livzon-cecc",
          role: "social-index",
          method: "GET",
          url: config.socialIndexUrl,
          body: null,
          coordinate: { sequence: null }
        })
      }));
      const discovered = discoverPartitions(
        socialResponse.body,
        config.socialPartitionSelector ?? DEFAULT_PARTITION_SELECTOR
      );
      assertExactPartitionSet(discovered, config.auditedPartitions);

      const jobs: NormalizedCeccJob[] = [];
      const seenOfficialIds = new Set<string>();
      let aggregateOfficialTotal = 0;
      let pagesVisited = 0;

      for (let partitionIndex = 0; partitionIndex < config.auditedPartitions.length; partitionIndex += 1) {
        const partition = config.auditedPartitions[partitionIndex]!;
        const routeUrl = new URL(partition.routePath, config.socialIndexUrl).href;
        const routeResponse = await http({
          url: routeUrl,
          method: "GET",
          headers: htmlHeaders(config.socialIndexUrl)
        });
        assertResponse(routeResponse, routeUrl, "text/html");
        artifacts.push(livzonNetworkArtifact({
          logicalKey: `livzon-route-${String(partitionIndex).padStart(4, "0")}`,
          kind: "ATS_PAGE",
          requestedUrl: routeUrl,
          response: routeResponse,
          capturedAt,
          extractorLocator: requestContractV2Locator("livzon-cecc-partition-route-v1", {
            family: "livzon-cecc",
            role: "partition-route",
            method: "GET",
            url: routeUrl,
            body: null,
            coordinate: { partitionIndex, categoryId: partition.categoryId }
          })
        }));
        const route = parseRouteConfig(
          routeResponse.body,
          partition,
          config
        );

        let partitionTotal: number | undefined;
        let partitionObserved = 0;
        const requiredPagesFromRoute = Math.max(1, Math.ceil(route.totalCount / config.pageSize));
        if (requiredPagesFromRoute > config.maxPagesPerPartition) {
          return failed(capturedAt, "LIVZON_CECC_MAX_PAGES_EXCEEDED");
        }

        for (let pageIndex = 0; pageIndex < requiredPagesFromRoute; pageIndex += 1) {
          const from = pageIndex * config.pageSize;
          const requestParams: CeccPageParams = {
            ...structuredClone(route.params),
            size: config.pageSize,
            from,
            _detailId: partition.categoryId,
            query: route.params.query.map((query) => ({ ...query })),
            header: { ...route.params.header },
            sort: [...route.params.sort]
          };
          const categoryQuery = categoryQueryFrom(requestParams.query);
          if (!categoryQuery || categoryQuery.value !== partition.categoryId) {
            return failed(capturedAt, "LIVZON_CECC_CATEGORY_BINDING_DRIFT");
          }

          const apiResponse = await http({
            url: config.listApiUrl,
            method: "POST",
            headers: jsonHeaders(routeUrl),
            body: JSON.stringify(requestParams)
          });
          assertResponse(apiResponse, config.listApiUrl, "application/json");
          const artifactLogicalKey = `livzon-api-${String(partitionIndex).padStart(4, "0")}-${String(pageIndex).padStart(4, "0")}`;
          const apiArtifact = livzonNetworkArtifact({
            logicalKey: artifactLogicalKey,
            kind: "ATS_API_RESPONSE",
            requestedUrl: config.listApiUrl,
            response: apiResponse,
            capturedAt,
            extractorLocator: requestContractV2Locator("livzon-cecc-partition-api-v1", {
              family: "livzon-cecc",
              role: "partition-api",
              method: "POST",
              url: config.listApiUrl,
              body: requestParams,
              coordinate: { partitionIndex, pageIndex, requestedOffset: from, requestedPageSize: config.pageSize }
            })
          });
          artifacts.push(apiArtifact);
          const apiPage = parseApiPage(apiResponse.body);
          pagesVisited += 1;

          if (
            apiPage.size !== config.pageSize || apiPage.from !== from ||
            (partitionTotal !== undefined && partitionTotal !== apiPage.totalCount) ||
            route.totalCount !== apiPage.totalCount
          ) {
            return failed(capturedAt, "LIVZON_CECC_TOTAL_COUNT_DRIFT");
          }
          partitionTotal ??= apiPage.totalCount;

          const expectedPageLength = Math.min(
            config.pageSize,
            Math.max(0, partitionTotal - from)
          );
          if (apiPage.list.length < expectedPageLength) {
            return failed(capturedAt, "LIVZON_CECC_SHORT_PAGE");
          }
          if (apiPage.list.length > expectedPageLength) {
            return failed(capturedAt, "LIVZON_CECC_TOTAL_COUNT_DRIFT");
          }

          const pageRawIds: string[] = [];
          const pageValidIds: string[] = [];
          for (const raw of apiPage.list) {
            const normalized = normalizeJob(raw, partition);
            const officialKey = officialJobKey(raw);
            if (!officialKey || seenOfficialIds.has(officialKey)) {
              return failed(capturedAt, "LIVZON_CECC_REPEATED_JOB");
            }
            seenOfficialIds.add(officialKey);
            jobs.push(normalized);
            pageRawIds.push(irreversibleOfficialJsonEvidenceId(officialKey));
            pageValidIds.push(irreversibleOfficialJsonEvidenceId(normalized.sourceJobId));
            partitionObserved += 1;
          }
          apiPages.push({
            artifactLogicalKey,
            responseFingerprintSha256: sha256Bytes(Buffer.from(apiResponse.body, "utf8")).sha256,
            rawJobIds: pageRawIds,
            validJobIds: pageValidIds,
            capturedAt: apiResponse.capturedAt ?? capturedAt
          });
        }

        if (partitionTotal === undefined || partitionObserved !== partitionTotal) {
          return failed(capturedAt, "LIVZON_CECC_TOTAL_COUNT_DRIFT");
        }
        aggregateOfficialTotal += partitionTotal;
      }

      if (jobs.length !== aggregateOfficialTotal || seenOfficialIds.size !== aggregateOfficialTotal) {
        return failed(capturedAt, "LIVZON_CECC_TOTAL_COUNT_DRIFT");
      }

      const tracedApiPages = aggregateOfficialTotal === 0
        ? apiPages.slice(0, 1)
        : apiPages.filter((page) => page.rawJobIds.length > 0);
      if (tracedApiPages.length === 0) return failed(capturedAt, "LIVZON_CECC_EVIDENCE_MISSING");
      const pages = tracedApiPages.map((page, sequence) => ({
        sequence,
        artifactLogicalKey: page.artifactLogicalKey,
        rawJobIds: page.rawJobIds,
        validJobIds: page.validJobIds,
        declaredTotal: aggregateOfficialTotal,
        nextPageSignalBefore: sequence === 0 ? null : `livzon-trace:${sequence}`,
        nextPageSignalAfter: sequence === tracedApiPages.length - 1 ? null : `livzon-trace:${sequence + 1}`,
        responseFingerprintSha256: page.responseFingerprintSha256,
        termination: aggregateOfficialTotal === 0
          ? "EMPTY_PAGE" as const
          : sequence === tracedApiPages.length - 1
            ? "DECLARED_TOTAL_REACHED" as const
            : "CONTINUE" as const,
        anomalyCodes: [],
        capturedAt: page.capturedAt
      }));
      const declarationArtifact = artifacts.find(
        (artifact) => artifact.logicalKey === tracedApiPages[0]!.artifactLogicalKey
      );
      if (!declarationArtifact) return failed(capturedAt, "LIVZON_CECC_EVIDENCE_MISSING");
      const evidenceDraft = parsePersistentSourceFetchEvidence({
        captureTool: { name: "livzon-cecc-source-fetch", version: "1" },
        artifacts,
        pages,
        declaredCompleteness: {
          kind: "OFFICIAL_TOTAL_COUNT",
          value: aggregateOfficialTotal,
          artifactLogicalKey: declarationArtifact.logicalKey,
          extractorLocator: declarationArtifact.extractorLocator,
          scope: "SOURCE"
        },
        fetchCounts: {
          rawCount: aggregateOfficialTotal,
          parsedCount: aggregateOfficialTotal,
          validCount: aggregateOfficialTotal,
          parseDiscardCount: 0,
          validationDiscardCount: 0
        },
        fetchLosses: []
      });
      const fetchEvidence = deriveCanonicalPaginationEvidence({
        evidence: evidenceDraft,
        expectedChannelIds: [],
        filteredOutput: true,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      });
      const paginationEvaluation = evaluatePaginationEvidence({
        evidence: fetchEvidence,
        expectedChannelIds: [],
        filteredOutput: true,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      });

      return {
        ok: true,
        capturedAt,
        payload: { jobs },
        completeness: {
          completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
          expectedJobCount: aggregateOfficialTotal,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: config.socialIndexUrl,
          completenessBlockerReason: "Strict downstream replay has not yet certified this fetch result.",
          pageSize: config.pageSize,
          pagesVisited
        },
        fetchEvidence,
        paginationEvaluation
      } satisfies SourceFetchResult;
    } catch (error) {
      return failed(
        capturedAt,
        error instanceof LivzonCeccError
          ? error.code
          : error instanceof Error
            ? `LIVZON_CECC_FETCH_FAILED:${error.message}`
            : "LIVZON_CECC_FETCH_FAILED"
      );
    }
  };
}

function livzonNetworkArtifact(input: {
  logicalKey: string;
  kind: "OFFICIAL_COMPANY_PAGE" | "ATS_PAGE" | "ATS_API_RESPONSE";
  requestedUrl: string;
  response: LivzonCeccHttpResponse;
  capturedAt: string;
  extractorLocator: string;
}): SourceFetchArtifactDraft {
  return {
    id: input.logicalKey,
    logicalKey: input.logicalKey,
    kind: input.kind,
    requestedUrl: input.requestedUrl,
    finalUrl: input.response.finalUrl ?? input.requestedUrl,
    httpStatus: input.response.status,
    contentType: input.response.contentType ?? "application/octet-stream",
    capturedAt: input.response.capturedAt ?? input.capturedAt,
    body: input.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: input.extractorLocator
  };
}

function readLivzonCeccConfig(plan: SourceCrawlPlan): LivzonCeccFetchConfig | undefined {
  const profileBound = (plan as SourceCrawlPlan & {
    profileBoundSource?: { kind: string; config: unknown };
  }).profileBoundSource;
  return profileBound?.kind === "livzon-cecc"
    ? profileBound.config as LivzonCeccFetchConfig
    : undefined;
}

function validatePlanBinding(plan: SourceCrawlPlan, config: LivzonCeccFetchConfig): void {
  if (
    plan.adapterId !== "official-json" ||
    plan.company.id !== LIVZON_COMPANY_ID ||
    plan.source.id !== LIVZON_SOURCE_ID ||
    plan.source.companyId !== LIVZON_COMPANY_ID ||
    plan.source.kind !== "SOCIAL" ||
    plan.source.atsKind !== "OFFICIAL_JSON" ||
    plan.source.officialEntryUrl !== config.socialIndexUrl ||
    plan.source.officialChainEvidenceUrl !== config.socialIndexUrl
  ) {
    throw new LivzonCeccError("LIVZON_CECC_PLAN_BINDING_DRIFT");
  }

  const index = strictOfficialUrl(config.socialIndexUrl);
  const declaredApi = strictOfficialUrl(config.routeDeclaredListApiUrl);
  const api = strictOfficialUrl(config.listApiUrl);
  if (
    index.origin !== LIVZON_ORIGIN || index.pathname !== "/Social.html" ||
    declaredApi.origin !== LIVZON_ORIGIN ||
    declaredApi.pathname !== "/fwebapi/product/product/es/findPage" ||
    declaredApi.searchParams.get("appId") !== "143150160001" ||
    declaredApi.searchParams.get("templateId") !== "product" ||
    [...declaredApi.searchParams.keys()].length !== 2 ||
    api.origin !== LIVZON_ORIGIN ||
    api.pathname !== "/nportal/fwebapi/product/product/es/findPage" ||
    api.searchParams.get("appId") !== "143150160001" ||
    api.searchParams.get("templateId") !== "product" ||
    [...api.searchParams.keys()].length !== 2 ||
    !Number.isSafeInteger(config.pageSize) || config.pageSize <= 0 || config.pageSize > 100 ||
    !Number.isSafeInteger(config.maxPagesPerPartition) || config.maxPagesPerPartition <= 0 ||
    config.maxPagesPerPartition > 1_000 || config.auditedPartitions.length !== 14
  ) {
    throw new LivzonCeccError("LIVZON_CECC_CONFIG_INVALID");
  }

  const routePaths = new Set<string>();
  const categoryIds = new Set<string>();
  for (const partition of config.auditedPartitions) {
    if (
      !/^\/product\/(?:140|141|142|143|144|145|146|147|149|150|151|152|153|154)\/$/.test(partition.routePath) ||
      !/^\d{19}$/.test(partition.categoryId) || !partition.categoryName.trim() ||
      routePaths.has(partition.routePath) || categoryIds.has(partition.categoryId)
    ) {
      throw new LivzonCeccError("LIVZON_CECC_CONFIG_INVALID");
    }
    routePaths.add(partition.routePath);
    categoryIds.add(partition.categoryId);
  }
}

function discoverPartitions(html: string, selector: string): Map<string, string> {
  const $ = load(html);
  const discovered = new Map<string, string>();
  $(selector).each((_index, element) => {
    const href = $(element).attr("href")?.trim();
    const categoryName = normalizeText($(element).text());
    if (!href || !/^\/product\/\d+\/$/.test(href) || !categoryName) return;
    const previous = discovered.get(href);
    if (previous !== undefined && previous !== categoryName) {
      throw new LivzonCeccError("LIVZON_CECC_CATEGORY_BINDING_DRIFT");
    }
    discovered.set(href, categoryName);
  });
  return discovered;
}

function assertExactPartitionSet(
  discovered: ReadonlyMap<string, string>,
  audited: readonly LivzonCeccPartitionConfig[]
): void {
  const expectedPaths = audited.map(({ routePath }) => routePath).sort(compareUtf8);
  const discoveredPaths = [...discovered.keys()].sort(compareUtf8);
  if (JSON.stringify(expectedPaths) !== JSON.stringify(discoveredPaths)) {
    throw new LivzonCeccError("LIVZON_CECC_PARTITION_SET_DRIFT");
  }
  for (const partition of audited) {
    if (discovered.get(partition.routePath) !== partition.categoryName) {
      throw new LivzonCeccError("LIVZON_CECC_CATEGORY_BINDING_DRIFT");
    }
  }
}

function parseRouteConfig(
  html: string,
  partition: LivzonCeccPartitionConfig,
  config: LivzonCeccFetchConfig
): ParsedRouteConfig {
  const $ = load(html);
  let candidate: { element: AnyNode; config: Record<string, unknown> } | undefined;
  $('input[name="_config"]').each((_index, element) => {
    if (candidate) return;
    const raw = $(element).attr("value");
    if (!raw || !hasUniqueJsonObjectKeys(raw)) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (!isRecord(parsed) || !isRecord(parsed.params) || !Array.isArray(parsed.params.query)) return;
    if (categoryQueryFrom(parsed.params.query) !== undefined) {
      candidate = { element, config: parsed };
    }
  });
  if (!candidate) throw new LivzonCeccError("LIVZON_CECC_ROUTE_CONFIG_MISSING");

  const routeConfig = candidate.config;
  const params = parseCeccParams(routeConfig.params);
  const query = categoryQueryFrom(params.query);
  if (
    !query || query.value !== partition.categoryId || params._detailId !== partition.categoryId ||
    params.size !== config.pageSize || params.from !== 0 ||
    routeConfig.api !== new URL(config.routeDeclaredListApiUrl).pathname +
      new URL(config.routeDeclaredListApiUrl).search
  ) {
    throw new LivzonCeccError("LIVZON_CECC_CATEGORY_BINDING_DRIFT");
  }

  const totalCount = readRouteTotalCount($, candidate.element, config.pageSize);
  return { params, totalCount };
}

function parseCeccParams(value: unknown): CeccPageParams {
  if (
    !isRecord(value) || !Number.isSafeInteger(value.size) || !Number.isSafeInteger(value.from) ||
    !Array.isArray(value.query) || !isRecord(value.header) || !Array.isArray(value.sort) ||
    typeof value._detailId !== "string"
  ) {
    throw new LivzonCeccError("LIVZON_CECC_ROUTE_CONFIG_INVALID");
  }
  return {
    size: Number(value.size),
    query: value.query.map((item) => {
      if (!isRecord(item)) throw new LivzonCeccError("LIVZON_CECC_ROUTE_CONFIG_INVALID");
      return { ...item };
    }),
    header: { ...value.header },
    from: Number(value.from),
    sort: [...value.sort],
    _detailId: value._detailId
  };
}

function readRouteTotalCount($: CheerioAPI, element: AnyNode, pageSize: number): number {
  const local = $(element).parent().find('input[name="pageParamsJson"]');
  const global = $('input[name="pageParamsJson"]');
  const candidates = local.length > 0 ? local : global;
  const totals: number[] = [];
  candidates.each((_index, input) => {
    const raw = $(input).attr("value");
    if (!raw || !hasUniqueJsonObjectKeys(raw)) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        isRecord(parsed) && parsed.size === pageSize && parsed.from === 0 &&
        Number.isSafeInteger(parsed.totalCount) && Number(parsed.totalCount) >= 0
      ) {
        totals.push(Number(parsed.totalCount));
      }
    } catch {
      // Ignore unrelated page widgets; the bound recruitment widget must still provide one valid total.
    }
  });
  if (totals.length === 0) throw new LivzonCeccError("LIVZON_CECC_ROUTE_TOTAL_MISSING");
  const uniqueTotals = new Set(totals);
  if (uniqueTotals.size !== 1) throw new LivzonCeccError("LIVZON_CECC_TOTAL_COUNT_DRIFT");
  return totals[0]!;
}

function categoryQueryFrom(query: unknown[]): { value: string } | undefined {
  const candidate = query.find((item) =>
    isRecord(item) && item.field === "categoryId" && item.esField === "category.id"
  );
  return isRecord(candidate) && typeof candidate.value === "string"
    ? { value: candidate.value }
    : undefined;
}

function parseApiPage(body: string): ParsedApiPage {
  if (!hasUniqueJsonObjectKeys(body)) {
    throw new LivzonCeccError("LIVZON_CECC_INVALID_JSON");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new LivzonCeccError("LIVZON_CECC_INVALID_JSON"); }
  if (
    !isRecord(parsed) || !isRecord(parsed.data) || parsed.data.code !== 200 ||
    !isRecord(parsed.data.page) || !Array.isArray(parsed.data.list)
  ) {
    throw new LivzonCeccError("LIVZON_CECC_INVALID_ENVELOPE");
  }
  const { page } = parsed.data;
  if (
    !Number.isSafeInteger(page.size) || Number(page.size) <= 0 ||
    !Number.isSafeInteger(page.from) || Number(page.from) < 0 ||
    !Number.isSafeInteger(page.totalCount) || Number(page.totalCount) < 0
  ) {
    throw new LivzonCeccError("LIVZON_CECC_INVALID_ENVELOPE");
  }
  return {
    size: Number(page.size),
    from: Number(page.from),
    totalCount: Number(page.totalCount),
    list: parsed.data.list
  };
}

function normalizeJob(raw: unknown, partition: LivzonCeccPartitionConfig): NormalizedCeccJob {
  if (!isRecord(raw)) throw new LivzonCeccError("LIVZON_CECC_INVALID_JOB");
  const officialId = officialJobKey(raw);
  const title = readNonemptyString(raw.title);
  const href = readNonemptyString(raw.href) ??
    (isRecord(raw.hrefObject) ? readNonemptyString(raw.hrefObject.value) : undefined);
  const categoryName = readNonemptyString(raw.categoryName);
  const locationRaw = readAttribute(raw.attributeList, "工作地点") ?? "未披露";
  if (!officialId || !title || !href || !categoryName) {
    throw new LivzonCeccError("LIVZON_CECC_INVALID_JOB");
  }
  const categorySegments = categoryName.split("->").map((segment) => segment.trim());
  if (
    categorySegments.at(-1) !== partition.categoryName ||
    (categorySegments.length > 1 && categorySegments.at(-2) !== "社会招聘")
  ) {
    throw new LivzonCeccError("LIVZON_CECC_CATEGORY_BINDING_DRIFT");
  }

  const officialUrl = new URL(href, LIVZON_ORIGIN);
  if (
    officialUrl.protocol !== "https:" || officialUrl.origin !== LIVZON_ORIGIN ||
    officialUrl.username || officialUrl.password || officialUrl.search || officialUrl.hash ||
    !/^\/product\/\d+\.html$/.test(officialUrl.pathname)
  ) {
    throw new LivzonCeccError("LIVZON_CECC_DETAIL_URL_OUT_OF_SCOPE");
  }

  return {
    sourceJobId: `livzon-cecc:sha256:${sha256(`${partition.categoryId}:${officialId}`)}`,
    title,
    officialUrl: officialUrl.href,
    locationRaw,
    cities: [locationRaw]
  };
}

function officialJobKey(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const productId = readNonemptyString(raw.productId);
  const code = readNonemptyString(raw.code);
  const value = productId ?? code;
  return value && /^\d{1,32}$/.test(value) ? value : undefined;
}

function readAttribute(value: unknown, attribute: string): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (isRecord(item) && item.attribute === attribute) {
      return readNonemptyString(item.value);
    }
  }
  return undefined;
}

function readNonemptyString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

function assertResponse(
  response: LivzonCeccHttpResponse,
  requestedUrl: string,
  expectedMime: "text/html" | "application/json"
): void {
  if (response.status < 200 || response.status >= 300) {
    throw new LivzonCeccError("LIVZON_CECC_HTTP_FAILURE");
  }
  if (!response.contentType?.toLowerCase().startsWith(expectedMime)) {
    throw new LivzonCeccError("LIVZON_CECC_CONTENT_TYPE_DRIFT");
  }
  const requested = strictOfficialUrl(requestedUrl);
  const final = strictOfficialUrl(response.finalUrl ?? requestedUrl);
  if (requested.href !== final.href) {
    throw new LivzonCeccError("LIVZON_CECC_REDIRECT_DRIFT");
  }
}

function strictOfficialUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== LIVZON_ORIGIN || url.username || url.password || url.hash) {
    throw new LivzonCeccError("LIVZON_CECC_URL_OUT_OF_SCOPE");
  }
  return url;
}

function htmlHeaders(referer: string): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml",
    Referer: referer,
    "User-Agent": "job-search-crawler/0.1"
  };
}

function jsonHeaders(referer: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    Origin: LIVZON_ORIGIN,
    Referer: referer,
    "User-Agent": "job-search-crawler/0.1",
    "X-Requested-With": "XMLHttpRequest"
  };
}

function createDefaultHttpClient(now: () => Date): LivzonCeccHttpClient {
  const cookies = new Map<string, string>();
  return async (request) => {
    const cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await fetchWithOfficialTimeout(request.url, {
      method: request.method,
      headers: { ...request.headers, ...(cookie ? { Cookie: cookie } : {}) },
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: "follow"
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const header of setCookies) {
      const first = header.split(";", 1)[0];
      const separator = first?.indexOf("=") ?? -1;
      if (first && separator > 0) cookies.set(first.slice(0, separator), first.slice(separator + 1));
    }
    const contentType = response.headers.get("content-type") ?? undefined;
    return {
      status: response.status,
      body: await response.text(),
      finalUrl: response.url,
      ...(contentType === undefined ? {} : { contentType }),
      capturedAt: now().toISOString(),
      setCookie: setCookies
    };
  };
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return { ok: false, capturedAt, failureReason };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class LivzonCeccError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LivzonCeccError";
  }
}
