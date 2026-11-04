import { acquireNovartisNativePartitions } from "./novartisNativePartitions";
import {isSanofiChinesePlan,createSanofiChineseSourceFetch} from "./sanofiChineseNative";
import { projectKelunMainlandFetch } from "./kelunMainlandScope";
import {hasSanofiNativePolicy,createSanofiNativeSourceFetch} from "./sanofiNativeQuality";
import { hasNovartisOfficialPresencePlan, NOVARTIS_PRESENCE_UNKNOWN } from "./novartisOfficialPresence";
import { load } from "cheerio";
import { parseExpression } from "@babel/parser";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import type { CompletenessEvidence } from "../domain/company";
import type { HtmlTableConfig } from "./adapters/types";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import { fetchWithOfficialTimeout, currentOfficialSourceAttemptSignal, currentOfficialSourceAttemptRemainingMs, sourceAttemptTimeoutMs } from "./officialHttpRuntimeLimits";
import {
  parsePersistentSourceFetchEvidence,
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { selectHtmlTableRows } from "./htmlTableRows";
import {
  retryableTransportFailureFromError,
  safeSourceTransportFailureReason,
  type SourceTransportFailure
} from "./sourceFetchFailure";

export interface HttpHtmlRequest {
  url: string;
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  evidenceChannelId?: string;
  /** Explicitly prohibit redirects for a narrowly bound authority request. */
  redirect?: "error";
}

export interface HttpHtmlResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type HttpHtmlClient = (request: HttpHtmlRequest) => Promise<HttpHtmlResponse>;

export interface HttpHtmlSourceFetchDeps {
  http?: HttpHtmlClient;
  now?: () => Date;
}

const TEVA_CHINA_CAREERS_URL = "https://www.careers.teva/careers?location=China";
const TEVA_EMBEDDED_ZERO_LOCATOR =
  "#smartApplyData:strict-json:count,positions,location_used,query.location,all_applicable_locations:" +
  "TEVA_US_REMOTE_GLOBAL_V1";

export function createPresenceCheckedHttpHtmlSourceFetch(deps: HttpHtmlSourceFetchDeps = {}): SourceFetchFunction {
  const fetch = createHttpHtmlSourceFetch(deps);
  return async (plan, tracker) => hasNovartisOfficialPresencePlan(plan)
    ? acquireNovartisNativePartitions(plan, deps.http ?? defaultHttpHtmlClient)
    : fetch(plan, tracker);
}

export function createHttpHtmlSourceFetch(
  deps: HttpHtmlSourceFetchDeps = {}
): SourceFetchFunction {
  const fetch = createUnpartitionedHttpHtmlSourceFetch(deps);
  return async (plan, tracker) => projectKelunMainlandFetch(plan, await fetch(plan, tracker));
}

function createUnpartitionedHttpHtmlSourceFetch(
  deps: HttpHtmlSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    if (isSanofiChinesePlan(plan)) return createSanofiChineseSourceFetch(deps)(plan);
    if (hasSanofiNativePolicy(plan)) return createSanofiNativeSourceFetch(deps)(plan);
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();
    const traversalDeadlineAt = Date.now() + (currentOfficialSourceAttemptRemainingMs() ?? sourceAttemptTimeoutMs());
    const interactions: Array<{ request: HttpHtmlRequest; response: HttpHtmlResponse }> = [];

    if (plan.adapterId !== "html-table") {
      return failed(capturedAt, "Direct HTML source fetch only supports html-table plans");
    }

    try {
      const rawHttp = deps.http ?? defaultHttpHtmlClient;
      let lastResponseAt = new Date(capturedAt).getTime();
      const http: HttpHtmlClient = async (request) => {
        currentOfficialSourceAttemptSignal()?.throwIfAborted();
        if (Date.now() >= traversalDeadlineAt) throw Error("HTML_TRAVERSAL_BUDGET_EXHAUSTED");
        assertSafeHtmlRequest(request, plan.source.officialEntryUrl);
        const response = await rawHttp(request);
        const retained = canRetainHtmlResponse(request, response);
        if (retained) interactions.push({ request, response });
        lastResponseAt = assertStrictHtmlResponse(request, response, capturedAt, lastResponseAt);
        if (!retained) interactions.push({ request, response });
        return response;
      };
      const response = await http({
        url: plan.table.pagination?.requestFirstPageExplicitly === true
          ? buildPageUrl(plan.source.officialEntryUrl, plan.table.pagination, 1)
          : plan.source.officialEntryUrl,
        headers: htmlRequestHeaders(plan.table)
      });

      const firstPage = validateResponse(response);
      if (!firstPage.ok) {
        return attachHtmlEvidence(failed(capturedAt, firstPage.failureReason), interactions,
          plan.table, capturedAt, "ordinary");
      }

      if (plan.table.pagination?.ajaxMode === "talentbrew") {
        const result = await fetchTalentbrewAjaxPages({
          html: response.body,
          http,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          maxPages: plan.table.pagination.maxPages,
          scope: plan.table.pagination.talentbrewScope
        });
        return attachHtmlEvidence(result, interactions, plan.table, capturedAt, "talentbrew");
      }
      if (plan.table.pagination?.ajaxMode === "tupu360") {
        const result = await fetchTupu360AjaxPages({
          html: response.body,
          http,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          maxPages: plan.table.pagination.maxPages
        });
        return attachHtmlEvidence(result, interactions, plan.table, capturedAt, "tupu360");
      }

      const pagination = readPaginationEvidence(response.body, plan.table.pagination);
      // Follow the official total; the existing source attempt budget bounds dispatch.
      if (plan.source.id === "source-abbvie-china-social" &&
          plan.table.abbvieRowScopePolicy === "ABBVIE_CHINA_LISTED_ROWS_V1" &&
          pagination.declaredTotalPages !== undefined && Number.isSafeInteger(pagination.declaredTotalPages)) {
        pagination.pagesToVisit = pagination.declaredTotalPages;
      }
      if (pagination.pagesToVisit <= 1) {
        return attachHtmlEvidence({
          ok: true,
          capturedAt,
          html: response.body,
          completeness: htmlCompleteness(plan.source.officialEntryUrl, pagination, 1)
        }, interactions, plan.table, capturedAt, "ordinary");
      }

      const pages = [response.body];
      let pagesToVisit = pagination.pagesToVisit;
      for (let page = 2; page <= pagesToVisit; page += 1) {
        const pageResponse = await http({
          url: buildPageUrl(plan.source.officialEntryUrl, plan.table.pagination!, page),
          headers: htmlRequestHeaders(plan.table)
        });
        const pageValidation = validateResponse(pageResponse);
        if (!pageValidation.ok) {
          return attachHtmlEvidence(failed(capturedAt, "HTML_PAGE_RESPONSE_INVALID"), interactions,
            plan.table, capturedAt, "ordinary");
        }
        pages.push(pageResponse.body);
        if (plan.table.pagination?.officialWindowMode === "NOVARTIS_PAGE_WINDOW_V1") {
          const laterTotal = readPaginationEvidence(pageResponse.body, plan.table.pagination).declaredTotalPages;
          if (laterTotal !== undefined) {
            pagesToVisit = Math.min(Math.max(pagesToVisit, laterTotal), plan.table.pagination.maxPages);
          }
        }
      }

      return attachHtmlEvidence({
        ok: true,
        capturedAt,
        html: pages.join("\n"),
        completeness: htmlCompleteness(plan.source.officialEntryUrl, pagination, pages.length)
      }, interactions, plan.table, capturedAt, "ordinary");
    } catch (error) {
      const transportFailure = retryableTransportFailureFromError(error);
      const failure = failed(
        capturedAt,
        transportFailure ? safeSourceTransportFailureReason(transportFailure) : safeHtmlFailureCode(error),
        transportFailure
      );
      return plan.adapterId === "html-table" && interactions.length > 0
        ? attachHtmlEvidence(failure, interactions, plan.table, capturedAt,
          plan.table.pagination?.ajaxMode ?? "ordinary")
        : failure;
    }
  };
}

async function fetchTupu360AjaxPages({
  html,
  http,
  entryUrl,
  capturedAt,
  maxPages
}: {
  html: string;
  http: HttpHtmlClient;
  entryUrl: string;
  capturedAt: string;
  maxPages: number;
}): Promise<SourceFetchResult> {
  const $ = load(html);
  const totalPages = parseTupuTotalPages($("#pageTurnUl li:first-child").first().text());
  if (totalPages === undefined) {
    return failed(capturedAt, "HTML_DECLARATION_INVALID");
  }

  const parsedPageSize = tupuDeclaredPageSize($) ?? undefined;
  const pageSize = parsedPageSize;
  if (pageSize === undefined || !Number.isInteger(pageSize) || pageSize < 1) {
    return failed(capturedAt, "HTML_DECLARATION_INVALID");
  }

  const pagesToVisit = Math.min(totalPages, Math.max(1, maxPages));
  const entry = new URL(entryUrl);
  const siteCode = entry.pathname.split("/").filter(Boolean).at(0);
  if (!siteCode) {
    return failed(capturedAt, "Tupu360 entry URL did not expose site code");
  }

  const recruitmentType = entry.searchParams.get("recruitmentType");
  const pages = [html];
  for (let page = 2; page <= pagesToVisit; page += 1) {
    const body = new URLSearchParams({
      offset: String((page - 1) * pageSize),
      max: String(pageSize)
    });
    if (recruitmentType) {
      body.set("recruitmentType", recruitmentType);
    }

    const pageResponse = await http({
      url: new URL(`/${siteCode}/position/nextPageList`, entry.origin).toString(),
      headers: {
        Accept: "text/html, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: entryUrl,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "job-search-crawler/0.1"
      },
      method: "POST",
      body: body.toString()
    });
    const validation = validateResponse(pageResponse);
    if (!validation.ok) {
      return failed(capturedAt, `Tupu360 page ${page}: ${validation.failureReason}`);
    }
    pages.push(pageResponse.body);
  }

  const truncated = pages.length < totalPages;
  return {
    ok: true,
    capturedAt,
    html: pages.join("\n"),
    completeness: {
      completenessStatus: truncated ? "INCOMPLETE" : "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
      completenessEvidenceUrl: entryUrl,
      ...(truncated
        ? { completenessBlockerReason: `Visited ${pages.length} of ${totalPages} Tupu360 pages` }
        : { completenessBlockerReason: "Tupu360 page traversal requires independent completeness review" }),
      totalPages,
      pageSize,
      pagesVisited: pages.length
    }
  };
}

async function fetchTalentbrewAjaxPages({
  html,
  http,
  entryUrl,
  capturedAt,
  maxPages,
  scope
}: {
  html: string;
  http: HttpHtmlClient;
  entryUrl: string;
  capturedAt: string;
  maxPages: number;
  scope: NonNullable<NonNullable<HtmlTableConfig["pagination"]>["talentbrewScope"]> | undefined;
}): Promise<SourceFetchResult> {
  const $ = load(html);
  const searchResults = $("#search-results").first();
  if (hasInvalidTalentbrewDeclarations(searchResults)) {
    return failed(capturedAt, "HTML_DECLARATION_INVALID");
  }
  const ajaxUrl = searchResults.attr("data-ajax-url");
  if (!ajaxUrl) {
    return failed(capturedAt, "TalentBrew search results did not expose data-ajax-url");
  }

  const initialTotalPages = numberAttr(searchResults, "data-total-pages");
  const expectedJobCount = numberAttr(searchResults, "data-total-job-results");
  const recordsPerPage = numberAttr(searchResults, "data-records-per-page");
  if (!initialTotalPages && expectedJobCount === undefined) {
    return failed(capturedAt, "TalentBrew search results did not expose total pages or total jobs");
  }

  const criteria = talentbrewCriteria($);
  const partitions = scope
    ? strictTalentbrewPartitions($, searchResults, scope)
    : [{ channelId: undefined, filter: undefined }];
  const pages: string[] = [];
  let totalPages = 0;
  let totalExpectedJobs = 0;
  let hasAllDeclaredJobTotals = true;
  let truncated = false;
  for (const partition of partitions) {
    let declaredPages: number | undefined;
    let declaredJobs: number | undefined;
    let declaredPageSize: number | undefined;
    let page = 1;
    do {
      const url = new URL(ajaxUrl, entryUrl);
      url.search = bindQueryParams({
        ...criteria,
        FacetFilters: [
          ...talentbrewStaticFacetFilters($),
          ...(partition.filter ? [partition.filter] : [])
        ],
        IsPagination: page > 1 ? "True" : "False",
        CurrentPage: page
      });
      const pageResponse = await http({
        url: url.toString(),
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          Referer: entryUrl,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "job-search-crawler/0.1"
        },
        ...(partition.channelId ? { evidenceChannelId: partition.channelId } : {})
      });
      const validation = validateResponse(pageResponse);
      if (!validation.ok) return failed(capturedAt, `TalentBrew page ${page}: ${validation.failureReason}`);
      const parsed = parseTalentbrewAjaxResponse(pageResponse.body);
      if (!parsed.ok) return failed(capturedAt, parsed.failureReason);
      const pageDom = load(parsed.results);
      const returned = pageDom("#search-results").first();
      if (hasInvalidTalentbrewDeclarations(returned)) return failed(capturedAt, "HTML_DECLARATION_INVALID");
      const returnedPage = numberAttr(returned, "data-current-page");
      const returnedPages = numberAttr(returned, "data-total-pages") ?? initialTotalPages;
      const returnedJobs = numberAttr(returned, "data-total-job-results") ?? expectedJobCount;
      const returnedPageSize = numberAttr(returned, "data-records-per-page") ?? recordsPerPage;
      if (scope && (returnedPage !== page || returnedPages === undefined || returnedJobs === undefined || returnedPageSize === undefined)) {
        return failed(capturedAt, "TALENTBREW_SCOPE_INVALID");
      }
      if (scope && returnedJobs !== undefined && returnedPageSize !== undefined && returnedPages !== undefined &&
          Math.ceil(returnedJobs / returnedPageSize) !== returnedPages && !(returnedJobs === 0 && returnedPages === 1)) {
        return failed(capturedAt, "TALENTBREW_SCOPE_INVALID");
      }
      declaredPages ??= returnedPages;
      declaredJobs ??= returnedJobs;
      declaredPageSize ??= returnedPageSize;
      if (scope && (returnedPages !== declaredPages || returnedJobs !== declaredJobs || returnedPageSize !== declaredPageSize)) {
        return failed(capturedAt, "TALENTBREW_SCOPE_INVALID");
      }
      pages.push(parsed.results);
      const effectiveDeclaredPages = declaredPages ?? initialTotalPages ?? 1;
      const pagesToVisit = Math.min(effectiveDeclaredPages, Math.max(1, maxPages));
      page += 1;
      if (page > pagesToVisit) {
        truncated ||= pagesToVisit < effectiveDeclaredPages;
        break;
      }
    } while (true);
    totalPages += declaredPages ?? 0;
    if (declaredJobs === undefined) hasAllDeclaredJobTotals = false;
    else totalExpectedJobs += declaredJobs;
  }

  return {
    ok: true,
    capturedAt,
    html: pages.join("\n"),
    completeness: {
      completenessStatus: truncated ? "INCOMPLETE" : "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(hasAllDeclaredJobTotals ? { expectedJobCount: totalExpectedJobs } : {}),
      completenessEvidenceKind: hasAllDeclaredJobTotals ? "OFFICIAL_TOTAL_COUNT" : "COMPLETE_PAGE_TRAVERSAL",
      completenessEvidenceUrl: entryUrl,
      ...(truncated
        ? { completenessBlockerReason: `Visited ${pages.length} of ${totalPages} TalentBrew pages` }
        : { completenessBlockerReason: "TalentBrew declarations require independent completeness review" }),
      totalPages,
      ...(recordsPerPage === undefined ? {} : { pageSize: recordsPerPage }),
      pagesVisited: pages.length
    }
  };
}

function strictTalentbrewPartitions(
  $: ReturnType<typeof load>,
  results: { attr(name: string): string | undefined },
  scope: NonNullable<NonNullable<HtmlTableConfig["pagination"]>["talentbrewScope"]>
): Array<{ channelId: string; filter: Record<string, TalentbrewCriteriaValue> }> {
  const active = scope.requiredActiveFacet;
  const configuredFacets = [...scope.allowedPartitions, ...(scope.excludedPartitions ?? [])];
  const partitionDimension = scope.allowedPartitions[0];
  const activeMatches = $("#search-filters [data-enabled='false'] .filter-checkbox").filter((_index, element) => {
    const checkbox = $(element);
    return checkbox.attr("checked") !== undefined && checkbox.attr("data-id") === active.id &&
      numberAttr(checkbox, "data-facet-type") === active.facetType && checkbox.attr("data-display") === active.descriptor;
  });
  const sourceTotal = numberAttr(results, "data-total-job-results");
  const activeCount = activeMatches.length === 1 ? numberAttr(activeMatches.first(), "data-count") : undefined;
  const configuredFacetKeys = configuredFacets.map((partition) =>
    JSON.stringify([partition.id, partition.facetType, partition.fieldName, partition.descriptor]));
  const visiblePartitionFacets = partitionDimension
    ? $("#search-filters [data-enabled='true'] .filter-checkbox:not(:checked)").filter((_index, element) => {
        const checkbox = $(element);
        return numberAttr(checkbox, "data-facet-type") === partitionDimension.facetType &&
          checkbox.attr("data-field-name") === partitionDimension.fieldName;
      })
    : $([]);
  if (activeMatches.length !== 1 || results.attr("data-facet-term") !== active.id ||
      numberAttr(results, "data-facet-type") !== active.facetType || sourceTotal === undefined || activeCount !== sourceTotal ||
      !partitionDimension || configuredFacets.some((partition) =>
        partition.facetType !== partitionDimension.facetType || partition.fieldName !== partitionDimension.fieldName) ||
      new Set(scope.allowedPartitions.map((partition) => partition.channelId)).size !== scope.allowedPartitions.length ||
      new Set(configuredFacetKeys).size !== configuredFacets.length ||
      visiblePartitionFacets.length !== configuredFacets.length) {
    throw new Error("TALENTBREW_SCOPE_INVALID");
  }
  const declaredCounts = new Map<string, number>();
  for (const partition of configuredFacets) {
    const matches = $("#search-filters [data-enabled='true'] .filter-checkbox:not(:checked)").filter((_index, element) => {
      const checkbox = $(element);
      return checkbox.attr("data-id") === partition.id && checkbox.attr("data-display") === partition.descriptor &&
        checkbox.attr("data-field-name") === partition.fieldName && numberAttr(checkbox, "data-facet-type") === partition.facetType;
    });
    if (matches.length !== 1) throw new Error("TALENTBREW_SCOPE_INVALID");
    const declaredCount = numberAttr(matches.first(), "data-count");
    if (declaredCount === undefined) throw new Error("TALENTBREW_SCOPE_INVALID");
    declaredCounts.set(JSON.stringify([partition.id, partition.facetType, partition.fieldName, partition.descriptor]), declaredCount);
  }
  if ([...declaredCounts.values()].reduce((sum, count) => sum + count, 0) !== sourceTotal) {
    throw new Error("TALENTBREW_SCOPE_INVALID");
  }
  return scope.allowedPartitions.map((partition) => {
    const declaredCount = declaredCounts.get(
      JSON.stringify([partition.id, partition.facetType, partition.fieldName, partition.descriptor])
    );
    if (declaredCount === undefined) throw new Error("TALENTBREW_SCOPE_INVALID");
    return {
      channelId: partition.channelId,
      filter: {
        ID: partition.id, FacetType: partition.facetType, Count: declaredCount,
        Display: partition.descriptor, IsApplied: true, FieldName: partition.fieldName
      }
    };
  });
}

function parseTalentbrewAjaxResponse(
  body: string
): { ok: true; results: string } | { ok: false; failureReason: string } {
  assertNoDuplicateJsonKeys(body);
  const parsed = JSON.parse(body) as { results?: unknown };
  assertTalentbrewJsonShape(parsed);
  if (typeof parsed.results !== "string" || !parsed.results.trim()) {
    return { ok: false, failureReason: "TalentBrew JSON response did not include results HTML" };
  }

  return { ok: true, results: parsed.results };
}

type TalentbrewCriteriaValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | TalentbrewCriteriaValue[]
  | { readonly [key: string]: TalentbrewCriteriaValue };

function talentbrewCriteria($: ReturnType<typeof load>): Record<string, TalentbrewCriteriaValue> {
  const results = $("#search-results").first();
  const filters = $("#search-filters").first();
  return {
    ActiveFacetID: numberAttr(results, "data-active-facet-id") ?? 0,
    RecordsPerPage: numberAttr(results, "data-records-per-page") ?? 20,
    TotalContentResults: numberAttr(results, "data-total-content-results") ?? 0,
    Distance: numberAttr(results, "data-distance") ?? 50,
    RadiusUnitType: numberAttr(filters, "data-radius-unit-type") ?? 2,
    Keywords: results.attr("data-keywords") ?? "",
    Location: results.attr("data-location") ?? "",
    Latitude: results.attr("data-latitude") ?? "",
    Longitude: results.attr("data-longitude") ?? "",
    ShowRadius: results.attr("data-show-radius") ?? "False",
    IsPagination: "False",
    CustomFacetName: results.attr("data-custom-facet-name") ?? "",
    FacetTerm: results.attr("data-facet-term") ?? "",
    FacetType: numberAttr(results, "data-facet-type") ?? null,
    FacetFilters: talentbrewStaticFacetFilters($),
    SearchResultsModuleName: results.attr("data-search-results-module-name") ?? null,
    SearchFiltersModuleName: filters.attr("data-search-filters-module-name") ?? null,
    SortCriteria: numberAttr(results, "data-sort-criteria") ?? 0,
    SortDirection: numberAttr(results, "data-sort-direction") ?? 1,
    SearchType: numberAttr(results, "data-search-type") ?? 1,
    CategoryFacetTerm: results.attr("data-category-facet-term") ?? "",
    CategoryFacetType: numberAttr(results, "data-category-facet-type") ?? null,
    LocationFacetTerm: results.attr("data-location-facet-term") ?? "",
    LocationFacetType: numberAttr(results, "data-location-facet-type") ?? null,
    KeywordType: results.attr("data-keyword-type") ?? "",
    LocationType: results.attr("data-location-type") ?? "",
    LocationPath: results.attr("data-location-path") ?? "",
    OrganizationIds: results.attr("data-organization-ids") ?? "",
    PostalCode: results.attr("data-postal-code") ?? "",
    ResultsType: numberAttr(results, "data-results-type") ?? 0,
    fc: filters.attr("data-filtered-categories") ?? "",
    fl: filters.attr("data-filtered-locations") ?? "",
    fcf: filters.attr("data-filtered-custom-facet") ?? "",
    afc: filters.attr("data-filtered-advanced-categories") ?? "",
    afl: filters.attr("data-filtered-advanced-locations") ?? "",
    afcf: filters.attr("data-filtered-advanced-custom-facet") ?? ""
  };
}

function talentbrewStaticFacetFilters($: ReturnType<typeof load>): TalentbrewCriteriaValue[] {
  return $("#search-filters [data-enabled='false'] .filter-checkbox")
    .toArray()
    .filter((element) => $(element).attr("checked") !== undefined)
    .map((element) => {
      const checkbox = $(element);
      return {
        ID: checkbox.attr("data-id") ?? "",
        FacetType: numberAttr(checkbox, "data-facet-type") ?? null,
        Count: numberAttr(checkbox, "data-count") ?? null,
        Display: checkbox.attr("data-display") ?? "",
        IsApplied: true,
        FieldName: checkbox.attr("data-field-name") ?? ""
      };
    });
}

function bindQueryParams(criteria: Record<string, TalentbrewCriteriaValue>): string {
  const pairs: string[] = [];
  const append = (key: string, value: TalentbrewCriteriaValue): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (isPlainObject(item)) {
          Object.entries(item).forEach(([childKey, childValue]) =>
            append(`${key}[${index}].${childKey}`, childValue)
          );
          return;
        }
        append(`${key}[${index}]`, item);
      });
      return;
    }

    if (isPlainObject(value)) {
      Object.entries(value).forEach(([childKey, childValue]) =>
        append(`${key}.${childKey}`, childValue)
      );
      return;
    }

    const normalized = value === undefined || value === null ? "" : String(value);
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(normalized)}`);
  };

  Object.entries(criteria).forEach(([key, value]) => append(key, value));
  return pairs.join("&").replace(/%20/g, "+");
}

function isPlainObject(value: TalentbrewCriteriaValue): value is {
  readonly [key: string]: TalentbrewCriteriaValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateResponse(response: HttpHtmlResponse): { ok: true } | { ok: false; failureReason: string } {
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, failureReason: `Direct HTML source returned HTTP ${response.status}` };
  }

  if (!response.body.trim()) {
    return { ok: false, failureReason: "Direct HTML source returned empty content" };
  }

  return { ok: true };
}

function htmlRequestHeaders(table: HtmlTableConfig): Record<string, string> {
  return {
    "User-Agent": "job-search-crawler/0.1",
    ...(table.requestHeaders ?? {})
  };
}

function readPaginationEvidence(
  html: string,
  pagination: HtmlTableConfig["pagination"]
): {
  declaredTotalPages?: number;
  pagesToVisit: number;
  expectedJobCount?: number;
  pageSize?: number;
} {
  if (!pagination) {
    return { pagesToVisit: 1 };
  }

  const $ = load(html);
  if (matchesPaginationExplicitEmptyState($, pagination)) {
    return {
      declaredTotalPages: 1,
      pagesToVisit: 1,
      expectedJobCount: 0,
      ...(pagination.pageSize === undefined ? {} : { pageSize: pagination.pageSize })
    };
  }
  const totalPageValues = $(pagination.totalPagesSelector)
    .toArray()
    .flatMap((element) => {
      const selectedTotalPages = $(element);
      const rawTotalPages = pagination.totalPagesPattern
        ? matchFirstNumber(
            selectedTotalPages.attr(pagination.totalPagesAttribute) ?? selectedTotalPages.text(),
            pagination.totalPagesPattern
          )
        : selectedTotalPages.attr(pagination.totalPagesAttribute);
      const parsed = Number(rawTotalPages);

      return Number.isInteger(parsed) && parsed > 0 ? [parsed] : [];
    });
  const totalPages =
    pagination.totalPagesMode === "max" ? Math.max(...totalPageValues) : totalPageValues[0];
  const expectedJobCountElement = pagination.expectedJobCountSelector
    ? $(pagination.expectedJobCountSelector).first()
    : undefined;
  const rawExpectedJobCountValue =
    expectedJobCountElement && pagination.expectedJobCountAttribute
      ? expectedJobCountElement.attr(pagination.expectedJobCountAttribute)
      : expectedJobCountElement
        ? expectedJobCountElement.text()
        : undefined;
  const rawExpectedJobCount =
    rawExpectedJobCountValue && pagination.expectedJobCountPattern
      ? matchFirstNumber(rawExpectedJobCountValue, pagination.expectedJobCountPattern)
      : rawExpectedJobCountValue;
  const expectedJobCount = rawExpectedJobCount?.trim()
    ? Number(rawExpectedJobCount)
    : Number.NaN;
  const parsedExpectedJobCount =
    Number.isInteger(expectedJobCount) && expectedJobCount >= 0 ? expectedJobCount : undefined;
  const configuredPageSize =
    pagination.pageSize !== undefined && Number.isInteger(pagination.pageSize) && pagination.pageSize > 0
      ? pagination.pageSize
      : undefined;

  const explicitTotalPages =
    typeof totalPages === "number" && Number.isInteger(totalPages) && totalPages >= 1
      ? totalPages
      : undefined;
  const declaredTotalPages =
    explicitTotalPages ??
    (parsedExpectedJobCount !== undefined && configuredPageSize !== undefined
      ? Math.max(1, Math.ceil(parsedExpectedJobCount / configuredPageSize))
      : undefined);

  if (declaredTotalPages === undefined) {
    return {
      pagesToVisit: 1,
      ...(parsedExpectedJobCount === undefined
        ? {}
        : { expectedJobCount: parsedExpectedJobCount }),
      ...(configuredPageSize === undefined ? {} : { pageSize: configuredPageSize })
    };
  }

  return {
    declaredTotalPages,
    pagesToVisit: Math.min(declaredTotalPages, pagination.maxPages),
    ...(parsedExpectedJobCount === undefined ? {} : { expectedJobCount: parsedExpectedJobCount }),
    ...(configuredPageSize === undefined ? {} : { pageSize: configuredPageSize })
  };
}

function matchesPaginationExplicitEmptyState(
  $: ReturnType<typeof load>,
  pagination: NonNullable<HtmlTableConfig["pagination"]>
): boolean {
  const empty = pagination.explicitEmptyState;
  if (!empty) return false;
  const markers = $(empty.selector);
  if (markers.length !== 1) return false;
  const text = markers.first().text().replace(/\s+/gu, " ").trim();
  return new RegExp(empty.pattern, "u").test(text);
}

function htmlCompleteness(
  officialEntryUrl: string,
  pagination: {
    declaredTotalPages?: number;
    pagesToVisit: number;
    expectedJobCount?: number;
    pageSize?: number;
  },
  pagesVisited: number
): CompletenessEvidence {
  if (!pagination.declaredTotalPages && pagination.expectedJobCount === undefined) {
    return {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
      completenessEvidenceUrl: officialEntryUrl,
      completenessBlockerReason:
        "HTML source did not expose official total count or total pages",
      pagesVisited
    };
  }

  const truncated =
    pagination.declaredTotalPages !== undefined && pagesVisited < pagination.declaredTotalPages;

  return {
    completenessStatus: truncated ? "INCOMPLETE" : "NEEDS_MANUAL_COMPLETENESS_REVIEW",
    ...(pagination.expectedJobCount === undefined
      ? {}
      : { expectedJobCount: pagination.expectedJobCount }),
    completenessEvidenceKind:
      pagination.expectedJobCount === undefined ? "COMPLETE_PAGE_TRAVERSAL" : "OFFICIAL_TOTAL_COUNT",
    completenessEvidenceUrl: officialEntryUrl,
    ...(truncated
      ? {
          completenessBlockerReason: `Visited ${pagesVisited} of ${pagination.declaredTotalPages} HTML pages`
        }
      : { completenessBlockerReason: "HTML declarations require independent completeness review" }),
    ...(pagination.declaredTotalPages === undefined
      ? {}
      : { totalPages: pagination.declaredTotalPages }),
    ...(pagination.pageSize === undefined ? {} : { pageSize: pagination.pageSize }),
    pagesVisited
  };
}

function matchFirstNumber(value: string, pattern: string): string | undefined {
  const match = new RegExp(pattern, "u").exec(value);
  return match?.[1];
}

function numberAttr(element: { attr(name: string): string | undefined }, attribute: string): number | undefined {
  const value = Number(element.attr(attribute));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function buildPageUrl(
  entryUrl: string,
  pagination: NonNullable<HtmlTableConfig["pagination"]>,
  page: number
): string {
  const pageParamValue =
    pagination.pageSearchParamMode === "offset" && pagination.pageSize !== undefined
      ? (page - 1) * pagination.pageSize
      : page + (pagination.pageNumberOffset ?? 0);

  if (pagination.pageUrlTemplate) {
    return pagination.pageUrlTemplate.replace("{page}", String(pageParamValue));
  }

  const url = new URL(entryUrl);
  url.searchParams.set(pagination.pageSearchParam, String(pageParamValue));
  return url.toString();
}

export async function defaultHttpHtmlClient(request: HttpHtmlRequest): Promise<HttpHtmlResponse> {
  try {
    return await fetchHtml(request);
  } catch (error) {
    if (isCertificateChainError(error) && enableSystemCertificateAuthorities()) {
      return fetchHtml(request);
    }

    throw error;
  }
}

async function fetchHtml(request: HttpHtmlRequest): Promise<HttpHtmlResponse> {
  const response = await fetchWithOfficialTimeout(request.url, {
    method: request.method ?? "GET",
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    redirect: "follow"
  });

  const body = await response.text();
  return {
    status: response.status,
    body,
    finalUrl: response.url,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    capturedAt: new Date().toISOString()
  };
}

function attachHtmlEvidence(
  result: SourceFetchResult,
  interactions: Array<{ request: HttpHtmlRequest; response: HttpHtmlResponse }>,
  table: HtmlTableConfig,
  capturedAt: string,
  mode: "ordinary" | "talentbrew" | "tupu360"
): SourceFetchResult {
  if (interactions.length === 0) return result;
  const staticAssessment = table.staticPublicList
    ? assessStaticPublicList(interactions, table, mode)
    : undefined;
  const tevaEmbeddedZeroAssessment = table.strictEmbeddedJsonZero?.kind === "TEVA_SMARTAPPLY_CHINA"
    ? assessTevaEmbeddedJsonZero(interactions, table, mode)
    : undefined;
  const acceptsRedactedPositivePartial =
    table.staticPublicList?.allowRedactedPositivePartial === true &&
    staticAssessment?.redactedPositivePartialEligible === true;
  if (result.ok && staticAssessment && !staticAssessment.valid && !acceptsRedactedPositivePartial) {
    result = failed(capturedAt, "HTML_STATIC_PUBLIC_LIST_INVALID");
  }
  if (result.ok && tevaEmbeddedZeroAssessment && !tevaEmbeddedZeroAssessment.valid) {
    result = failed(capturedAt, "HTML_TEVA_EMBEDDED_JSON_ZERO_INVALID");
  }
  const tevaEmbeddedZero = tevaEmbeddedZeroAssessment?.valid === true;
  const strictExtractorLocator = tevaEmbeddedZeroAssessment === undefined
    ? undefined
    : TEVA_EMBEDDED_ZERO_LOCATOR;
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const fetchLosses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  let rawCount = 0;
  let validationDiscardCount = 0;
  let invalidDeclaration = false;
  const entryOnlyOrdinaryDeclaration =
    mode === "ordinary" && table.pagination?.totalPagesDeclaredOnEntryOnly === true
      ? readPaginationEvidence(interactions[0]!.response.body, table.pagination)
      : undefined;
  const novartisWindowTotalPages = mode === "ordinary" && isNovartisOfficialWindow(table)
    ? Math.max(...interactions.map(({ response }) =>
        readPaginationEvidence(response.body, table.pagination).declaredTotalPages ?? 0)) || undefined
    : undefined;
  interactions.forEach(({ request, response }, sequence) => {
    const logicalKey = `official-html-page-${String(sequence).padStart(4, "0")}`;
    const isTalentEntry = mode === "talentbrew" && sequence === 0;
    const kind = isTalentEntry ? "OFFICIAL_COMPANY_PAGE" : "PAGINATION_PAGE";
    const bodyRepresentation = tevaEmbeddedZeroAssessment !== undefined || sensitiveHtmlBody(response.body)
      ? "REDACTED" as const
      : "EXACT" as const;
    const safeStaticProjection = bodyRepresentation === "REDACTED" && staticAssessment?.zero === true
      ? otsukaRedactedEmptyListProjection(response.body, table)
      : undefined;
    const artifactBody = bodyRepresentation === "REDACTED"
      ? safeStaticProjection ?? "[REDACTED_CREDENTIAL_MATERIAL]"
      : response.body;
    artifacts.push({
      id: logicalKey, logicalKey, kind,
      ...(request.evidenceChannelId ? { channelId: request.evidenceChannelId } : {}),
      requestedUrl: safeHtmlEvidenceUrl(request.url),
      finalUrl: safeHtmlEvidenceUrl(response.finalUrl!),
      httpStatus: response.status,
      contentType: response.contentType!, capturedAt: response.capturedAt!,
      body: artifactBody, bodyRepresentation,
      ...(bodyRepresentation === "REDACTED" ? {
        rawBodySha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
        redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: 1 }]
      } : {}),
      extractorLocator: htmlRequestContractLocator(isTalentEntry
        ? "#search-results[data-ajax-url]"
        : strictExtractorLocator ?? table.rowSelector, mode, request, sequence, table.pagination)
    });
    if (isTalentEntry) return;
    let html = response.body;
    if (mode === "talentbrew") {
      try { html = strictTalentbrewResults(response.body); } catch { html = ""; }
    }
    const $ = load(html);
    if (
      mode === "ordinary" &&
      (table.pagination?.totalPagesDeclaredOnEntryOnly !== true || sequence === 0) &&
      hasInvalidOrdinaryDeclaration($, table.pagination)
    ) {
      invalidDeclaration = true;
    }
    const seenRawRows = new Set<string>();
    const validIds: string[] = [];
    const ids = selectHtmlTableRows($, table).map((row, index) => {
      const raw = $.html(row);
      const rawHash = sha256Bytes(Buffer.from(raw, "utf8")).sha256;
      const observationId = `html-row:sha256:${rawHash}`;
      if (seenRawRows.has(rawHash)) {
        validationDiscardCount += 1;
        fetchLosses.push({
          stage: "VALIDATION", reason: "duplicate exact raw HTML row",
          rawLocator: `${logicalKey}#row:${index}`,
          details: { code: "DUPLICATE_RAW_ROW", pageSequence: pages.length, recordIndex: index }
        });
      } else {
        seenRawRows.add(rawHash);
        validIds.push(observationId);
      }
      return observationId;
    });
    rawCount += ids.length;
    const url = new URL(request.url);
    const ordinaryCoordinate = mode === "ordinary"
      ? ordinaryRequestCoordinate(request.url, table.pagination, sequence)
      : {};
    const requestedPage = mode === "talentbrew"
      ? strictOptionalPositiveInt(url.searchParams.get("CurrentPage")) ?? null
      : ordinaryCoordinate.requestedPage ?? null;
    const requestedOffset = mode === "tupu360"
      ? strictOptionalNonnegativeInt(new URLSearchParams(request.body ?? "").get("offset")) ?? null
      : ordinaryCoordinate.requestedOffset ?? null;
    const requestedPageSize = mode === "tupu360"
      ? strictOptionalPositiveInt(new URLSearchParams(request.body ?? "").get("max"))
      : mode === "talentbrew"
        ? strictOptionalPositiveInt(url.searchParams.get("RecordsPerPage"))
        : table.pagination?.pageSize ?? null;
    const ordinaryDeclaration = mode === "ordinary" ? readPaginationEvidence(html, table.pagination) : undefined;
    const returnedPage = mode === "talentbrew"
      ? strictOptionalNonnegativeInt($("#search-results").first().attr("data-current-page") ?? null) ?? null
      : mode === "ordinary" && isNovartisOfficialWindow(table)
        ? novartisActivePage($) ?? null
        : null;
    const declaredTotal = mode === "talentbrew"
      ? strictOptionalNonnegativeInt($("#search-results").first().attr("data-total-job-results") ?? null) ?? null
      : mode === "ordinary" && table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES"
        ? ordinaryDeclaration?.expectedJobCount ?? null
        : null;
    const declaredPages = mode === "talentbrew"
      ? strictOptionalNonnegativeInt($("#search-results").first().attr("data-total-pages") ?? null) ?? null
      : mode === "tupu360"
        ? parseTupuTotalPages($("#pageTurnUl li:first-child").first().text()) ?? null
        : novartisWindowTotalPages ?? entryOnlyOrdinaryDeclaration?.declaredTotalPages ??
          ordinaryDeclaration?.declaredTotalPages ?? null;
    const returnedPageSize = mode === "talentbrew"
      ? strictOptionalPositiveInt($("#search-results").first().attr("data-records-per-page") ?? null) ?? null
      : null;
    const declaredCount = mode === "talentbrew"
      ? returnedPageSize
      : mode === "tupu360"
        ? tupuDeclaredPageSize($)
        : null;
    pages.push({
      sequence: pages.length, artifactLogicalKey: logicalKey,
      ...(request.evidenceChannelId ? { channelId: request.evidenceChannelId } : {}),
      requestedCursor: null, returnedCursor: null,
      requestedOffset, returnedOffset: null,
      requestedPage, returnedPage,
      requestedPageSize, returnedPageSize,
      rawJobIds: [...new Set(ids)], validJobIds: validIds,
      declaredTotal, declaredCount, declaredPages,
      nextPageSignalBefore: pages.length === 0
        ? "initial"
        : requestedOffset !== null
          ? `offset-${requestedOffset}`
          : `page-${requestedPage}`,
      nextPageSignalAfter: null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(artifactBody, "utf8")).sha256,
      termination: "ABORTED", anomalyCodes: [], capturedAt: response.capturedAt!
    });
  });
  if (pages.length === 0) {
    if (!result.ok && artifacts.length > 0 && artifacts.every((artifact) => artifact.kind !== "PAGINATION_PAGE")) {
      const fetchEvidence = parsePersistentSourceFetchEvidence({
        captureTool: { name: "official-html-http", version: "1" }, artifacts, pages: [],
        supportingArtifactOnlyFailure: { code: "HTML_ENTRY_DECLARATION_FAILED" },
        fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
        fetchLosses: []
      });
      return { ...result, failureReason: safeHtmlFailureCode(new Error(result.failureReason)), fetchEvidence };
    }
    return result;
  }
  const pageIndexesByScope = new Map<string, number[]>();
  pages.forEach((page, index) => {
    const key = page.channelId ?? "__SOURCE__";
    const indexes = pageIndexesByScope.get(key) ?? [];
    indexes.push(index);
    pageIndexesByScope.set(key, indexes);
  });
  for (const indexes of pageIndexesByScope.values()) {
    indexes.forEach((pageIndex, scopeIndex) => {
      const page = pages[pageIndex]!;
      const hasNext = scopeIndex < indexes.length - 1;
      const nextPage = hasNext ? pages[indexes[scopeIndex + 1]!]! : undefined;
      page.nextPageSignalAfter = nextPage && nextPage.requestedOffset !== null
        ? `offset-${nextPage.requestedOffset}`
        : hasNext
          ? `page-${(page.requestedPage ?? scopeIndex + 1) + 1}`
          : null;
      page.termination = hasNext ? "CONTINUE" : (result.ok ? "NEXT_ABSENT" : "FAILED");
    });
  }
  if (validationDiscardCount > 0) {
    pages.at(-1)!.termination = "ABORTED";
  }
  if (
    result.ok && pages.length === 1 &&
    (tevaEmbeddedZero || (staticAssessment?.valid === true && staticAssessment.zero) ||
      (mode === "ordinary" && pages[0]!.declaredTotal === 0 && pages[0]!.rawJobIds.length === 0))
  ) {
    pages[0]!.declaredTotal = 0;
    pages[0]!.termination = "EMPTY_PAGE";
  }
  if (result.ok && result.completeness?.completenessStatus === "INCOMPLETE") {
    const last = pages.at(-1)!;
    last.nextPageSignalAfter = "declared-next";
    last.termination = "MAX_PAGE_LIMIT";
  }
  const staticArtifact = artifacts.find((artifact) => artifact.logicalKey === "official-html-page-0000");
  const staticDeclaration = result.ok && validationDiscardCount === 0 && staticArtifact &&
    (tevaEmbeddedZero || staticAssessment?.valid === true)
    ? tevaEmbeddedZero || staticAssessment!.zero
      ? {
          kind: "OFFICIAL_TOTAL_COUNT" as const,
          value: 0,
          artifactLogicalKey: "official-html-page-0000",
          extractorLocator: staticArtifact.extractorLocator,
          scope: "SOURCE" as const
        }
      : {
          kind: "COMPLETE_PAGE_TRAVERSAL" as const,
          value: 1,
          artifactLogicalKey: "official-html-page-0000",
          extractorLocator: staticArtifact.extractorLocator,
          scope: "SOURCE" as const
        }
    : undefined;
  const configuredDeclaration = result.ok && validationDiscardCount === 0 &&
    fetchLosses.length === 0 && artifacts.every((artifact) => artifact.bodyRepresentation === "EXACT")
    ? configuredHtmlCompletenessDeclaration(table, mode, artifacts, pages)
    : undefined;
  const evidence0 = parsePersistentSourceFetchEvidence({
    captureTool: { name: "official-html-http", version: "1" }, artifacts, pages,
    ...(staticDeclaration ?? configuredDeclaration
      ? { declaredCompleteness: staticDeclaration ?? configuredDeclaration }
      : {}),
    fetchCounts: { rawCount, parsedCount: rawCount, validCount: rawCount - validationDiscardCount, parseDiscardCount: 0, validationDiscardCount },
    fetchLosses
  });
  const expectedChannelIds = [...new Set(pages.flatMap((page) => page.channelId ? [page.channelId] : []))];
  const paginationOptions = {
    expectedChannelIds,
    filteredOutput: true,
    ...(mode === "ordinary" && !isNovartisOfficialWindow(table)
      ? { allowMissingReturnedPage: true }
      : {}),
    ...(mode === "ordinary" && isNovartisOfficialWindow(table)
      ? { allowRawIdOverlapAcrossPages: true }
      : {}),
    ...(configuredDeclaration?.kind === "OFFICIAL_TOTAL_COUNT" && configuredDeclaration.value > 0
      ? { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true }
      : {})
  };
  const evidence = deriveCanonicalPaginationEvidence({ evidence: evidence0, ...paginationOptions });
  const paginationEvaluation = evaluatePaginationEvidence({ evidence, ...paginationOptions });
  const manual = {
    completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" as const,
    completenessEvidenceKind: "WEAK_MANUAL_SAMPLE" as const,
    completenessBlockerReason: "HTML fetch evidence requires independent completeness review",
    pagesVisited: pages.length,
    ...(mode === "talentbrew" && result.ok && result.completeness?.expectedJobCount !== undefined
      ? { expectedJobCount: result.completeness.expectedJobCount }
      : {}),
    ...(mode === "talentbrew" && result.ok && result.completeness?.totalPages !== undefined
      ? { totalPages: result.completeness.totalPages }
      : {}),
    ...(mode === "talentbrew" && result.ok && result.completeness?.pageSize !== undefined
      ? { pageSize: result.completeness.pageSize }
      : {})
  };
  if (invalidDeclaration) {
    return { ok: false, capturedAt, failureReason: "HTML_DECLARATION_INVALID", fetchEvidence: evidence, paginationEvaluation };
  }
  return result.ok
    ? paginationEvaluation.safeCompleteness
      ? { ...result, completeness: manual, fetchEvidence: evidence, paginationEvaluation }
      : { ok: false, capturedAt, failureReason: "HTML_PAGINATION_EVIDENCE_UNSAFE", fetchEvidence: evidence, paginationEvaluation }
    : { ...result, failureReason: safeHtmlFailureCode(new Error(result.failureReason)), fetchEvidence: evidence, paginationEvaluation };
}

function configuredHtmlCompletenessDeclaration(
  table: HtmlTableConfig,
  mode: "ordinary" | "talentbrew" | "tupu360",
  artifacts: readonly SourceFetchArtifactDraft[],
  pages: readonly SourceFetchPageTrace[]
): PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  const policy = table.completenessProof;
  if (!policy || pages.length === 0) return undefined;

  if (policy.kind === "OFFICIAL_TOTAL_PAGES") {
    if (!table.pagination) return undefined;
    if (mode === "talentbrew") {
      if (table.pagination.talentbrewScope !== undefined || pages.some((page) => page.channelId !== undefined)) {
        return undefined;
      }
      const declaredTotal = pages[0]?.declaredTotal;
      const declaredPages = pages[0]?.declaredPages;
      const pageSize = pages[0]?.returnedPageSize;
      const rawIds = pages.flatMap((page) => page.rawJobIds);
      const closed = typeof declaredTotal === "number" && Number.isSafeInteger(declaredTotal) && declaredTotal >= 0 &&
        typeof declaredPages === "number" && Number.isSafeInteger(declaredPages) && declaredPages > 0 &&
        declaredPages === pages.length && typeof pageSize === "number" && Number.isSafeInteger(pageSize) && pageSize > 0 &&
        pages.every((page, index) => page.declaredTotal === declaredTotal &&
          page.declaredPages === declaredPages && page.requestedPage === index + 1 &&
          page.returnedPage === index + 1 && page.requestedPageSize === pageSize &&
          page.returnedPageSize === pageSize && page.declaredCount === pageSize &&
          page.nextPageSignalAfter === (index + 1 < pages.length ? `page-${index + 2}` : null) &&
          page.termination === (index + 1 < pages.length ? "CONTINUE" : "NEXT_ABSENT")) &&
        rawIds.length === declaredTotal && new Set(rawIds).size === declaredTotal;
      if (!closed) return undefined;
      const artifact = artifacts.find((candidate) => candidate.logicalKey === pages[0]!.artifactLogicalKey);
      return artifact
        ? {
            kind: "OFFICIAL_TOTAL_COUNT",
            value: declaredTotal,
            artifactLogicalKey: artifact.logicalKey,
            extractorLocator: artifact.extractorLocator,
            scope: "SOURCE"
          }
        : undefined;
    }
    if (mode !== "ordinary") return undefined;
    const zeroPage = pages.length === 1 ? pages[0] : undefined;
    if (zeroPage?.declaredTotal === 0 && zeroPage.declaredPages === 1 &&
      zeroPage.termination === "EMPTY_PAGE" && zeroPage.nextPageSignalAfter == null &&
      zeroPage.rawJobIds.length === 0 && zeroPage.validJobIds.length === 0) {
      const artifact = artifacts.find((candidate) => candidate.logicalKey === zeroPage.artifactLogicalKey);
      if (!artifact) return undefined;
      return {
        kind: "OFFICIAL_TOTAL_COUNT",
        value: 0,
        artifactLogicalKey: artifact.logicalKey,
        extractorLocator: artifact.extractorLocator,
        scope: "SOURCE"
      };
    }
    const declaredPages = pages[0]?.declaredPages;
    if (typeof declaredPages !== "number" || !Number.isSafeInteger(declaredPages) || declaredPages <= 0 ||
      declaredPages !== pages.length || pages.some((page) => page.declaredPages !== declaredPages)) return undefined;
    const artifact = artifacts.find((candidate) => candidate.logicalKey === pages[0]!.artifactLogicalKey);
    if (!artifact) return undefined;
    const repeatedOfficialTotal = pages[0]?.declaredTotal;
    const exactOfficialTotal = repeatedOfficialTotal !== null && repeatedOfficialTotal !== undefined &&
      pages.every((page) => page.declaredTotal === repeatedOfficialTotal) &&
      new Set(pages.flatMap((page) => page.rawJobIds)).size === repeatedOfficialTotal;
    return exactOfficialTotal
      ? {
          kind: "OFFICIAL_TOTAL_COUNT",
          value: repeatedOfficialTotal,
          artifactLogicalKey: artifact.logicalKey,
          extractorLocator: artifact.extractorLocator,
          scope: "SOURCE"
        }
      : {
          kind: "OFFICIAL_TOTAL_PAGES",
          value: declaredPages,
          artifactLogicalKey: artifact.logicalKey,
          extractorLocator: artifact.extractorLocator,
          scope: "SOURCE"
        };
  }

  if (policy.kind === "CONFIGURED_CHANNEL_TRAVERSAL") {
    if (mode === "ordinary") return undefined;
    if (mode === "talentbrew") {
      const expected = table.pagination?.talentbrewScope?.allowedPartitions.map((partition) => partition.channelId);
      const visited = [...new Set(pages.flatMap((page) => page.channelId ? [page.channelId] : []))];
      if (!expected || expected.length === 0 || expected.length !== visited.length ||
        expected.some((channelId) => !visited.includes(channelId))) return undefined;
    } else if (pages.some((page) => page.channelId !== undefined)) {
      return undefined;
    }
    const artifact = mode === "talentbrew"
      ? artifacts.find((candidate) => candidate.logicalKey === "official-html-page-0000")
      : artifacts.find((candidate) => candidate.logicalKey === pages[0]!.artifactLogicalKey);
    if (!artifact) return undefined;
    return {
      kind: "COMPLETE_PAGE_TRAVERSAL",
      value: pages.length,
      artifactLogicalKey: artifact.logicalKey,
      extractorLocator: artifact.extractorLocator,
      scope: "SOURCE"
    };
  }

  return undefined;
}

function assertStrictHtmlResponse(request: HttpHtmlRequest, response: HttpHtmlResponse, crawlStartedAt: string, previousResponseAt: number): number {
  if (!response.finalUrl || !response.contentType?.trim() || !response.capturedAt) {
    throw new Error("HTML_RESPONSE_METADATA_MISSING");
  }
  if (/[\u0000-\u001f\u007f]/u.test(response.contentType) || sensitiveHtmlBody(response.contentType)) {
    throw new Error("HTML_RESPONSE_METADATA_INVALID");
  }
  const requested = new URL(request.url);
  const final = new URL(response.finalUrl);
  if (requested.protocol !== "https:" || requested.href !== final.href) {
    throw new Error("HTML_RESPONSE_REDIRECT_MISMATCH");
  }
  const mime = response.contentType.split(";", 1)[0]!.trim().toLowerCase();
  const ajaxJson = request.headers.Accept?.includes("application/json");
  if (ajaxJson ? !(mime === "application/json" || mime.endsWith("+json")) : !(mime === "text/html" || mime === "application/xhtml+xml")) {
    throw new Error("HTML_RESPONSE_MIME_INVALID");
  }
  const time = new Date(response.capturedAt).getTime();
  if (!Number.isFinite(time) || time < new Date(crawlStartedAt).getTime() || time < previousResponseAt) throw new Error("HTML_RESPONSE_TIME_INVALID");
  return time;
}

function canRetainHtmlResponse(request: HttpHtmlRequest, response: HttpHtmlResponse): boolean {
  if (!response.finalUrl || !response.contentType?.trim() || !response.capturedAt) return false;
  try {
    safeHtmlEvidenceUrl(request.url);
    safeHtmlEvidenceUrl(response.finalUrl);
    if (/[\u0000-\u001f\u007f]/u.test(response.contentType) || sensitiveHtmlBody(response.contentType)) return false;
    const time = new Date(response.capturedAt);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(response.capturedAt) &&
      Number.isFinite(time.getTime()) && time.toISOString() === response.capturedAt;
  } catch {
    return false;
  }
}

function assertSafeHtmlRequest(request: HttpHtmlRequest, entryUrl: string): void {
  const url = new URL(request.url);
  const entry = new URL(entryUrl);
  if (url.protocol !== "https:" || url.origin !== entry.origin || url.username || url.password || url.hash) {
    throw new Error("HTML_REQUEST_UNSAFE");
  }
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) throw new Error("HTML_REQUEST_DUPLICATE_QUERY");
}

function strictTalentbrewResults(body: string): string {
  assertNoDuplicateJsonKeys(body);
  const parsed = JSON.parse(body) as { results?: unknown };
  assertTalentbrewJsonShape(parsed);
  if (typeof parsed.results !== "string") throw new Error("TALENTBREW_RESULTS_INVALID");
  return parsed.results;
}

function assertTalentbrewJsonShape(value: unknown): asserts value is { results?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("TALENTBREW_JSON_SCHEMA_INVALID");
  }
  const allowed = new Set(["results", "hasJobs", "hasContent", "filters"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("TALENTBREW_JSON_SCHEMA_INVALID");
  }
}

function assertNoDuplicateJsonKeys(body: string): void {
  let ast: ReturnType<typeof parseExpression>;
  try {
    ast = parseExpression(body, { sourceType: "script" });
  } catch {
    throw new Error("TALENTBREW_JSON_INVALID");
  }
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "ObjectExpression") {
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (property.type !== "ObjectProperty" || property.computed || property.method) {
          throw new Error("TALENTBREW_JSON_INVALID");
        }
        const key = property.key.type === "Identifier" ? property.key.name : String(property.key.value);
        if (keys.has(key)) throw new Error("TALENTBREW_JSON_DUPLICATE_KEY");
        keys.add(key);
        visit(property.value);
      }
      return;
    }
    if (node.type === "ArrayExpression") for (const child of node.elements) visit(child);
  };
  visit(ast);
}

function strictOptionalNonnegativeInt(value: string | null): number | undefined {
  if (value === null) return undefined;
  return /^(?:0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}
function strictOptionalPositiveInt(value: string | null): number | undefined {
  const parsed = strictOptionalNonnegativeInt(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}
function ordinaryRequestCoordinate(
  requestUrl: string,
  pagination: HtmlTableConfig["pagination"],
  sequence?: number
): { requestedPage?: number; requestedOffset?: number } {
  if (!pagination) return {};
  const url = new URL(requestUrl);
  let raw = url.searchParams.get(pagination.pageSearchParam);
  if (raw === null && pagination.pageUrlTemplate) {
    const [prefix, suffix] = pagination.pageUrlTemplate.split("{page}");
    if (prefix !== undefined && suffix !== undefined && requestUrl.startsWith(prefix) && requestUrl.endsWith(suffix)) {
      raw = requestUrl.slice(prefix.length, requestUrl.length - suffix.length);
    }
  }
  const value = strictOptionalNonnegativeInt(raw);
  if (pagination.officialWindowMode === "NOVARTIS_PAGE_WINDOW_V1") {
    if (raw === null) return sequence === 0 ? { requestedPage: 1 } : {};
    return value === undefined ? {} : { requestedPage: value - (pagination.pageNumberOffset ?? 0) };
  }
  if (value === undefined) return {};
  return pagination.pageSearchParamMode === "offset"
    ? { requestedOffset: value }
    : { requestedPage: value };
}

function htmlRequestContractLocator(
  baseLocator: string,
  mode: "ordinary" | "talentbrew" | "tupu360",
  request: HttpHtmlRequest,
  sequence: number,
  pagination: HtmlTableConfig["pagination"]
): string {
  const url = safeHtmlEvidenceUrl(request.url);
  const ordinary = mode === "ordinary" ? ordinaryRequestCoordinate(request.url, pagination, sequence) : {};
  const query = new URL(url).searchParams;
  const form = new URLSearchParams(request.body ?? "");
  const coordinate = mode === "ordinary"
    ? { sequence, ...ordinary }
    : mode === "talentbrew"
      ? {
          sequence,
          channelId: request.evidenceChannelId ?? null,
          requestedPage: strictOptionalPositiveInt(query.get("CurrentPage")) ?? null,
          requestedPageSize: strictOptionalPositiveInt(query.get("RecordsPerPage")) ?? null
        }
      : {
          sequence,
          requestedOffset: strictOptionalNonnegativeInt(form.get("offset")) ?? null,
          requestedPageSize: strictOptionalPositiveInt(form.get("max")) ?? null
        };
  return requestContractV2Locator(baseLocator, {
    family: "html",
    role: sequence === 0 ? "entry" : `${mode}-page`,
    method: request.method ?? "GET",
    url,
    body: request.body ?? null,
    coordinate
  });
}
function isNovartisOfficialWindow(table: HtmlTableConfig): boolean {
  return table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    table.completenessProof.sourcePolicy === "NOVARTIS_CHINA_SLIDING_WINDOW_V1" &&
    table.pagination?.officialWindowMode === "NOVARTIS_PAGE_WINDOW_V1";
}
function novartisActivePage($: ReturnType<typeof load>): number | undefined {
  const active = $(".pagination .page-link[title*='out of'][title*='pages']").filter((_index, element) =>
    /(?:\bactive\b|活跃)/iu.test($(element).attr("title") ?? "")
  );
  if (active.length !== 1) return undefined;
  const title = active.first().attr("title")?.replace(/\s+/gu, " ").trim();
  const match = title ? /^page\s+([1-9]\d*)\s+(?:active|活跃)\s+out of\s+([1-9]\d*)\s+pages$/iu.exec(title) : null;
  return match ? strictOptionalPositiveInt(match[1]!) : undefined;
}
function tupuDeclaredPageSize($: ReturnType<typeof load>): number | null {
  const onclick = $("#pageTurnUl li[onclick]").toArray()
    .map((element) => $(element).attr("onclick") ?? "")
    .find((value) => value.includes("pageTurn"));
  if (onclick) return parseTupuPageSize(onclick) ?? null;
  const declared = $("#pageTurnUl li[data-action], #pageTurnUl li[data-pagenum], #pageTurnUl li[data-pagemax]").toArray();
  if (declared.length === 0) return null;
  const pageSizes = new Set<number>();
  for (const element of declared) {
    const node = $(element);
    const pageNumber = strictOptionalPositiveInt(node.attr("data-pagenum") ?? null);
    const pageSize = strictOptionalPositiveInt(node.attr("data-pagemax") ?? null);
    if (node.attr("data-action") !== "pageTurn" || pageNumber === undefined || pageSize === undefined) return null;
    pageSizes.add(pageSize);
  }
  return pageSizes.size === 1 ? [...pageSizes][0]! : null;
}
function parseTupuTotalPages(value: string): number | undefined {
  const match = /^\s*共\s*([1-9]\d*)\s*页\s*$/u.exec(value);
  return match ? strictOptionalPositiveInt(match[1]!) : undefined;
}
function parseTupuPageSize(value: string): number | undefined {
  const match = /^\s*pageTurn\(\s*\d+\s*,\s*([1-9]\d*)(?:\.0+)?\s*\)\s*$/u.exec(value);
  return match ? strictOptionalPositiveInt(match[1]!) : undefined;
}
function hasInvalidOrdinaryDeclaration(
  $: ReturnType<typeof load>,
  pagination: HtmlTableConfig["pagination"]
): boolean {
  if (!pagination) return false;
  for (const element of $(pagination.totalPagesSelector).toArray()) {
    const selected = $(element);
    const raw = pagination.totalPagesPattern
      ? selected.attr(pagination.totalPagesAttribute) ?? selected.text()
      : selected.attr(pagination.totalPagesAttribute);
    if (raw === undefined) continue;
    const extracted = pagination.totalPagesPattern ? matchFirstNumber(raw, pagination.totalPagesPattern) : raw;
    if (extracted !== undefined && strictOptionalPositiveInt(extracted.trim()) === undefined) return true;
    if (pagination.totalPagesPattern && extracted === undefined && raw.trim()) return true;
  }
  if (pagination.expectedJobCountSelector) {
    const selected = $(pagination.expectedJobCountSelector).first();
    if (selected.length > 0) {
      const raw = pagination.expectedJobCountAttribute
        ? selected.attr(pagination.expectedJobCountAttribute)
        : selected.text();
      if (raw !== undefined) {
        const extracted = pagination.expectedJobCountPattern ? matchFirstNumber(raw, pagination.expectedJobCountPattern) : raw;
        if (extracted === undefined || strictOptionalNonnegativeInt(extracted.trim()) === undefined) return true;
      }
    }
  }
  return false;
}
function hasInvalidTalentbrewDeclarations(element: { attr(name: string): string | undefined }): boolean {
  const rules: Array<[string, (value: string | null) => number | undefined]> = [
    ["data-current-page", strictOptionalPositiveInt],
    ["data-total-pages", strictOptionalPositiveInt],
    ["data-total-job-results", strictOptionalNonnegativeInt],
    ["data-records-per-page", strictOptionalPositiveInt]
  ];
  return rules.some(([attribute, parse]) => {
    const raw = element.attr(attribute);
    return raw !== undefined && parse(raw) === undefined;
  });
}
function sensitiveHtmlBody(body: string): boolean {
  const normalized = body.normalize("NFKC");
  if (/(?:authorization|password|access[_-]?token|client[_-]?secret)\s*[:=]/iu.test(normalized)) {
    return true;
  }
  return /(?:document\.)?cookie\s*=\s*(["'`])[^"'`]*(?:session|auth|token|jwt|secret|password)[^"'`]*\1/iu
    .test(normalized);
}
function safeHtmlFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "HTML_FETCH_FAILED";
  return SAFE_HTML_FAILURE_CODES.has(message) ? message : "HTML_FETCH_FAILED";
}

const SAFE_HTML_FAILURE_CODES = new Set([
  "HTML_TRAVERSAL_BUDGET_EXHAUSTED",
  NOVARTIS_PRESENCE_UNKNOWN,
  "NOVARTIS_NATIVE_PARTITIONS_INCOMPLETE",
  "HTML_FETCH_FAILED", "HTML_RESPONSE_METADATA_MISSING", "HTML_RESPONSE_REDIRECT_MISMATCH",
  "HTML_RESPONSE_METADATA_INVALID",
  "HTML_RESPONSE_MIME_INVALID", "HTML_RESPONSE_TIME_INVALID", "HTML_REQUEST_UNSAFE",
  "HTML_REQUEST_DUPLICATE_QUERY", "HTML_PAGE_RESPONSE_INVALID", "HTML_DECLARATION_INVALID",
  "HTML_PAGINATION_EVIDENCE_UNSAFE", "HTML_STATIC_PUBLIC_LIST_INVALID", "TALENTBREW_JSON_INVALID",
  "HTML_TEVA_EMBEDDED_JSON_ZERO_INVALID",
  "TALENTBREW_JSON_DUPLICATE_KEY", "TALENTBREW_JSON_SCHEMA_INVALID", "TALENTBREW_RESULTS_INVALID",
  "TALENTBREW_SCOPE_INVALID"
]);

export function isSafeHtmlFailureCode(value: unknown): value is string {
  return typeof value === "string" && SAFE_HTML_FAILURE_CODES.has(value);
}

function assessStaticPublicList(
  interactions: Array<{ request: HttpHtmlRequest; response: HttpHtmlResponse }>,
  table: HtmlTableConfig,
  mode: "ordinary" | "talentbrew" | "tupu360"
): { valid: boolean; zero: boolean; redactedPositivePartialEligible: boolean } {
  const config = table.staticPublicList;
  if (!config || mode !== "ordinary" || interactions.length !== 1) {
    return { valid: false, zero: false, redactedPositivePartialEligible: false };
  }
  const body = interactions[0]!.response.body;
  try {
    const $ = load(body);
    const containers = $(config.containerSelector);
    const rows = $(table.rowSelector).toArray();
    if (containers.length !== 1 || $(config.nextControlSelector).length !== 0) {
      return { valid: false, zero: false, redactedPositivePartialEligible: false };
    }
    const container = containers.get(0)!;
    const redacted = sensitiveHtmlBody($.html(container));
    if (rows.some((row) => !$.contains(container, row))) {
      return { valid: false, zero: false, redactedPositivePartialEligible: false };
    }
    for (const selector of config.excludedPartitionSelectors ?? []) {
      const excluded = $(selector).toArray();
      if (rows.some((row) => excluded.some((partition) =>
        row === partition || $.contains(partition, row) || $.contains(row, partition)))) {
        return { valid: false, zero: false, redactedPositivePartialEligible: false };
      }
    }
    if (rows.length > 0) {
      return {
        valid: !redacted,
        zero: false,
        redactedPositivePartialEligible: redacted
      };
    }
    const empty = config.explicitEmptyState;
    if (!empty || redacted) return { valid: false, zero: false, redactedPositivePartialEligible: false };
    const markers = $(empty.selector);
    if (markers.length !== 1) return { valid: false, zero: false, redactedPositivePartialEligible: false };
    const marker = markers.get(0)!;
    const normalized = markers.first().text().replace(/\s+/gu, " ").trim();
    return {
      valid: (marker === container || $.contains(container, marker)) &&
        normalized.length > 0 && new RegExp(empty.pattern, "u").test(normalized),
      zero: true,
      redactedPositivePartialEligible: false
    };
  } catch {
    return { valid: false, zero: false, redactedPositivePartialEligible: false };
  }
}

function otsukaRedactedEmptyListProjection(body: string, table: HtmlTableConfig): string | undefined {
  if (table.completenessProof?.kind !== "STATIC_PUBLIC_LIST" ||
    table.completenessProof.sourcePolicy !== "OTSUKA_CHINA_EMPTY_PUBLIC_LIST_V1" ||
    table.rowSelector !== ".container.Box [data-job-id], .container.Box .job-item" ||
    table.staticPublicList?.containerSelector !== ".container.Box" ||
    table.staticPublicList.nextControlSelector !==
      ".container.Box .pagination, .container.Box a[rel='next'], .container.Box [data-page]" ||
    table.staticPublicList.explicitEmptyState?.selector !== ".container.Box" ||
    table.staticPublicList.explicitEmptyState.pattern !== "热招岗位[\\s\\S]*联系我们") return undefined;
  const $ = load(body);
  const container = $(table.staticPublicList.containerSelector);
  if (container.length !== 1 || $(table.rowSelector).length !== 0 ||
    $(table.staticPublicList.nextControlSelector).length !== 0) return undefined;
  const projection = $.html(container.get(0));
  return projection && !sensitiveHtmlBody(projection) ? projection : undefined;
}

function assessTevaEmbeddedJsonZero(
  interactions: Array<{ request: HttpHtmlRequest; response: HttpHtmlResponse }>,
  table: HtmlTableConfig,
  mode: "ordinary" | "talentbrew" | "tupu360"
): { valid: boolean } {
  if (
    table.strictEmbeddedJsonZero?.kind !== "TEVA_SMARTAPPLY_CHINA" ||
    mode !== "ordinary" ||
    table.pagination !== undefined ||
    interactions.length !== 1
  ) {
    return { valid: false };
  }

  const { request, response } = interactions[0]!;
  const mime = response.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const hasCookie = Object.keys(request.headers).some((name) => name.trim().toLowerCase() === "cookie");
  if (
    request.url !== TEVA_CHINA_CAREERS_URL ||
    response.finalUrl !== TEVA_CHINA_CAREERS_URL ||
    (request.method ?? "GET") !== "GET" ||
    request.body !== undefined ||
    hasCookie ||
    response.status !== 200 ||
    mime !== "text/html"
  ) {
    return { valid: false };
  }

  try {
    const $ = load(response.body);
    const elements = $("#smartApplyData");
    const element = elements.get(0);
    if (elements.length !== 1 || element?.type !== "tag" || element.name !== "code") {
      return { valid: false };
    }
    const encodedJson = elements.first().text().trim();
    if (!encodedJson) return { valid: false };
    assertNoDuplicateJsonKeys(encodedJson);
    const parsed = JSON.parse(encodedJson) as unknown;
    if (!isPlainRecord(parsed)) return { valid: false };
    const query = parsed.query;
    return {
      valid:
        tevaChinaLocalCountIsZero(parsed, table) &&
        parsed.location_used === "China" &&
        isPlainRecord(query) && query.location === "China" &&
        Array.isArray(parsed.all_applicable_locations) && parsed.all_applicable_locations.length === 0
    };
  } catch {
    return { valid: false };
  }
}

function tevaChinaLocalCountIsZero(parsed: Record<string, unknown>, table: HtmlTableConfig): boolean {
  if (table.strictEmbeddedJsonZero?.remoteGlobalForeignExclusionPolicy !== "TEVA_US_REMOTE_GLOBAL_V1" ||
    !Number.isSafeInteger(parsed.count) || (parsed.count as number) < 0 ||
    !Array.isArray(parsed.positions) || parsed.positions.length !== parsed.count) return false;
  if (parsed.count === 0) return true;
  if ((parsed.count as number) > 20 || parsed.fuzzyResultsReturned !== false || parsed.requestLocation !== true ||
    JSON.stringify(parsed.location_user) !== JSON.stringify(["China", "remote,China"])) return false;

  const ids = new Set<string>();
  return parsed.positions.every((candidate) => {
    if (!isPlainRecord(candidate)) return false;
    const rawId = candidate.id;
    const id = typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0
      ? String(rawId)
      : typeof rawId === "string" && /^[1-9][0-9]{0,19}$/u.test(rawId) ? rawId : undefined;
    if (!id || ids.has(id) || candidate.work_location_option !== "remote_global" ||
      candidate.isPrivate !== false || typeof candidate.location !== "string" ||
      !tevaExplicitUnitedStatesLocation(candidate.location) || !Array.isArray(candidate.locations) ||
      candidate.locations.length === 0 || candidate.locations.some((location) =>
        typeof location !== "string" || !tevaExplicitUnitedStatesLocation(location)) ||
      !candidate.locations.includes(candidate.location) ||
      candidate.canonicalPositionUrl !== `${TEVA_CHINA_CAREERS_URL.split("?")[0]}/job/${id}`) return false;
    ids.add(id);
    return true;
  });
}

function tevaExplicitUnitedStatesLocation(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= 200 &&
    /(?:^|, )United States$/u.test(normalized) &&
    !/(?:China|Mainland|中国|上海|北京|苏州|深圳|广州)/iu.test(normalized);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function safeHtmlEvidenceUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.normalize("NFKC").toLowerCase().replace(/[^a-z]/g, "");
    if (normalized.includes("keyword")) url.searchParams.delete(key);
  }
  return sanitizeEvidenceHttpUrl(url.toString());
}

let systemCertificateAuthoritiesEnabled = false;

function enableSystemCertificateAuthorities(): boolean {
  if (systemCertificateAuthoritiesEnabled) {
    return true;
  }

  try {
    setDefaultCACertificates([
      ...getCACertificates("default"),
      ...getCACertificates("system")
    ]);
    systemCertificateAuthoritiesEnabled = true;
    return true;
  } catch {
    return false;
  }
}

function isCertificateChainError(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } }).cause?.code;
  return code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
}

function failed(
  capturedAt: string,
  failureReason: string,
  transportFailure?: SourceTransportFailure
): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason,
    ...(transportFailure ? { transportFailure } : {})
  };
}
