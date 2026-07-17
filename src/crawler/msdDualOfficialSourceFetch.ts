import type { CompletenessEvidence } from "../domain/company";
import { fetchWithOfficialTimeout } from "./officialHttpRuntimeLimits";
import type { NormalizedJobRecord } from "./normalizedJob";
import {
  deriveCanonicalPaginationEvidence,
  evaluatePaginationEvidence,
  type PaginationEvaluation
} from "./paginationEvidence";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import {
  parsePersistentSourceFetchEvidence,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import type { SourceCrawlPlan } from "./sourcePlan";
import {
  retryableHttpTransportFailure,
  retryableTransportFailureFromError,
  type SourceTransportFailure
} from "./sourceFetchFailure";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator, requestContractV2Matches } from "./strictPageRequestContract";

const MSD_OFFICIAL_SEARCH_URL = "https://jobs.msd.com/cn/zh/search-results";
const MSD_OFFICIAL_DETAIL_BASE_URL = "https://jobs.msd.com/cn/zh/job";
const MSD_PHENOM_WIDGET_URL = "https://jobs.msd.com/widgets";
const MSD_WORKDAY_ENTRY_URL = "https://msd.wd5.myworkdayjobs.com/SearchJobs";
const MSD_WORKDAY_JOBS_URL = "https://msd.wd5.myworkdayjobs.com/wday/cxs/msd/SearchJobs/jobs";
const MSD_WORKDAY_APPLY_ORIGIN = "https://msd.wd5.myworkdayjobs.com";
const MSD_COUNTRY_DESCRIPTOR = "China";
const MSD_WORKER_SUBTYPE_DESCRIPTOR = "Regular";
const MSD_PHENOM_PAGE_SIZE = 100;
const MSD_WORKDAY_PAGE_SIZE = 20;
const MSD_MAX_PAGES = 20;

export interface MsdDualOfficialFetchConfig {
  officialSearchUrl: typeof MSD_OFFICIAL_SEARCH_URL;
  officialDetailBaseUrl: typeof MSD_OFFICIAL_DETAIL_BASE_URL;
  phenomWidgetUrl: typeof MSD_PHENOM_WIDGET_URL;
  workdayEntryUrl: typeof MSD_WORKDAY_ENTRY_URL;
  workdayJobsUrl: typeof MSD_WORKDAY_JOBS_URL;
  allowedApplyOrigins: readonly [typeof MSD_WORKDAY_APPLY_ORIGIN];
  countryDescriptor: typeof MSD_COUNTRY_DESCRIPTOR;
  workerSubtypeDescriptor: typeof MSD_WORKER_SUBTYPE_DESCRIPTOR;
  pageSize: typeof MSD_PHENOM_PAGE_SIZE;
  workdayPageSize: typeof MSD_WORKDAY_PAGE_SIZE;
  maxPages: typeof MSD_MAX_PAGES;
}

export const MSD_DUAL_OFFICIAL_FETCH_CONFIG = Object.freeze({
  officialSearchUrl: MSD_OFFICIAL_SEARCH_URL,
  officialDetailBaseUrl: MSD_OFFICIAL_DETAIL_BASE_URL,
  phenomWidgetUrl: MSD_PHENOM_WIDGET_URL,
  workdayEntryUrl: MSD_WORKDAY_ENTRY_URL,
  workdayJobsUrl: MSD_WORKDAY_JOBS_URL,
  allowedApplyOrigins: [MSD_WORKDAY_APPLY_ORIGIN] as const,
  countryDescriptor: MSD_COUNTRY_DESCRIPTOR,
  workerSubtypeDescriptor: MSD_WORKER_SUBTYPE_DESCRIPTOR,
  pageSize: MSD_PHENOM_PAGE_SIZE,
  workdayPageSize: MSD_WORKDAY_PAGE_SIZE,
  maxPages: MSD_MAX_PAGES
}) satisfies MsdDualOfficialFetchConfig;

export interface MsdDualOfficialHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface MsdDualOfficialHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type MsdDualOfficialHttpClient = (
  request: MsdDualOfficialHttpRequest
) => Promise<MsdDualOfficialHttpResponse>;

export interface MsdDualOfficialSourceFetchDeps {
  entryHttp?: MsdDualOfficialHttpClient;
  workdayHttp?: MsdDualOfficialHttpClient;
  phenomHttp?: MsdDualOfficialHttpClient;
  now?: () => Date;
}

export interface MsdOfficialReconciliationInput {
  workdayRecords: readonly Record<string, unknown>[];
  phenomRecords: readonly Record<string, unknown>[];
  officialDetailBaseUrl: string;
  allowedApplyOrigins: readonly string[];
}

export interface MsdOfficialReconciledJob {
  officialId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}

export type MsdOfficialReconciliationResult =
  | {
      ok: true;
      jobs: MsdOfficialReconciledJob[];
      excluded: Array<{
        officialId: string;
        code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER";
      }>;
    }
  | {
      ok: false;
      failureCode:
        | "MSD_DUPLICATE_OFFICIAL_ID"
        | "MSD_INVALID_OFFICIAL_RECORD"
        | "MSD_NON_OFFICIAL_URL"
        | "MSD_OUT_OF_SCOPE"
        | "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE";
    };

/**
 * Reconciles MSD's two public official systems without treating either one as
 * self-certifying. Workday defines the formal requisition set. The public MSD
 * careers index defines the current public posting set and supplies the
 * user-facing title, location and stable official detail URL. Workday is an
 * independently archived official corroboration source, not the denominator.
 */
export function reconcileMsdOfficialSets(
  input: MsdOfficialReconciliationInput
): MsdOfficialReconciliationResult {
  const detailBaseUrl = safeHttpsUrl(input.officialDetailBaseUrl);
  if (!detailBaseUrl || new URL(detailBaseUrl).hostname !== "jobs.msd.com") {
    return { ok: false, failureCode: "MSD_NON_OFFICIAL_URL" };
  }
  const allowedApplyOrigins = new Set<string>();
  for (const value of input.allowedApplyOrigins) {
    const url = safeHttpsUrl(value);
    if (!url) return { ok: false, failureCode: "MSD_NON_OFFICIAL_URL" };
    const parsed = new URL(url);
    if (url !== parsed.origin && url !== `${parsed.origin}/`) {
      return { ok: false, failureCode: "MSD_NON_OFFICIAL_URL" };
    }
    allowedApplyOrigins.add(parsed.origin);
  }

  const workdayById = new Map<string, Record<string, unknown>>();
  for (const record of input.workdayRecords) {
    const id = workdayOfficialId(record);
    if (!id) return { ok: false, failureCode: "MSD_INVALID_OFFICIAL_RECORD" };
    if (workdayById.has(id)) return { ok: false, failureCode: "MSD_DUPLICATE_OFFICIAL_ID" };
    workdayById.set(id, record);
  }

  const phenomById = new Map<string, Record<string, unknown>>();
  for (const record of input.phenomRecords) {
    const id = stringField(record, "reqId");
    if (!id) return { ok: false, failureCode: "MSD_INVALID_OFFICIAL_RECORD" };
    if (phenomById.has(id)) return { ok: false, failureCode: "MSD_DUPLICATE_OFFICIAL_ID" };
    const applyUrl = stringField(record, "applyUrl");
    if (applyUrl) {
      const safeApplyUrl = safeHttpsUrl(applyUrl);
      if (!safeApplyUrl || !allowedApplyOrigins.has(new URL(safeApplyUrl).origin)) {
        return { ok: false, failureCode: "MSD_NON_OFFICIAL_URL" };
      }
    }
    phenomById.set(id, record);
  }

  for (const id of workdayById.keys()) {
    if (!phenomById.has(id)) {
      return { ok: false, failureCode: "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE" };
    }
  }

  const jobs: MsdOfficialReconciledJob[] = [];
  const excluded: Array<{
    officialId: string;
    code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER";
  }> = [];
  for (const [id, record] of [...phenomById.entries()].sort(([left], [right]) => compareUtf8(left, right))) {
    const inWorkday = workdayById.has(id);
    if (isVerifiedTestPlaceholder(record, id)) {
      if (inWorkday) {
        return { ok: false, failureCode: "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE" };
      }
      excluded.push({ officialId: id, code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER" });
      continue;
    }
    if (!inWorkday && !isStrongOfficialPageJob(record, id)) {
      return { ok: false, failureCode: "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE" };
    }
    const title = stringField(record, "title");
    const selectedLocation = selectMainlandLocation(record);
    if (!title || !selectedLocation) {
      return {
        ok: false,
        failureCode: selectedLocation ? "MSD_INVALID_OFFICIAL_RECORD" : "MSD_OUT_OF_SCOPE"
      };
    }
    jobs.push({
      officialId: id,
      title,
      officialUrl: `${detailBaseUrl.replace(/\/+$/u, "")}/${encodeURIComponent(id)}`,
      locationRaw: selectedLocation.locationRaw,
      cities: selectedLocation.city ? [selectedLocation.city] : [selectedLocation.locationRaw]
    });
  }

  return { ok: true, jobs, excluded };
}

function workdayOfficialId(record: Record<string, unknown>): string | undefined {
  const bulletFields = record.bulletFields;
  if (!Array.isArray(bulletFields)) return undefined;
  const ids = bulletFields.filter((value): value is string =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.trim())
  ).map((value) => value.trim());
  return ids.length === 1 ? ids[0] : undefined;
}

function isVerifiedTestPlaceholder(record: Record<string, unknown>, officialId: string): boolean {
  const title = stringField(record, "title") ?? "";
  const normalizedTitle = title.normalize("NFKC").toLowerCase();
  const hasUnambiguousTestMarker = /\b(?:do not apply|not for application|test only)\b/u
    .test(normalizedTitle) ||
    /^(?:[\p{L}-]+\s+)?(?:job|vacancy|position|requisition)\s+(?:test|testing)$/u
      .test(normalizedTitle);
  const description = [
    stringField(record, "descriptionTeaser"),
    nestedStringField(record, ["ml_job_parser", "descriptionTeaser_ats"])
  ].filter((value): value is string => value !== undefined).join(" ");
  const descriptionWithoutIdentifier = description
    .normalize("NFKC")
    .replace(/requisition\s*id/giu, "")
    .replaceAll(officialId, "")
    .replace(/[\s.,，。:：;；_\-]+/gu, "");
  return hasUnambiguousTestMarker && descriptionWithoutIdentifier.length === 0 &&
    !stringField(record, "applyUrl") && record.externalApply === false;
}

function isStrongOfficialPageJob(record: Record<string, unknown>, officialId: string): boolean {
  const title = stringField(record, "title") ?? "";
  const description = [
    stringField(record, "descriptionTeaser"),
    nestedStringField(record, ["ml_job_parser", "descriptionTeaser_ats"])
  ].filter((value): value is string => value !== undefined).join(" ");
  const meaningfulDescription = description
    .normalize("NFKC")
    .replace(/requisition\s*id/giu, "")
    .replaceAll(officialId, "")
    .replace(/[\s.,，。:：;；_\-]+/gu, "");
  const applyUrl = stringField(record, "applyUrl");
  const postedDate = stringField(record, "postedDate");
  return title.length > 0 && meaningfulDescription.length >= 12 && Boolean(applyUrl) &&
    record.externalApply === true && stringField(record, "visibilityType") === "External" &&
    Boolean(postedDate && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/u.test(postedDate)) &&
    selectMainlandLocation(record) !== undefined;
}

function selectMainlandLocation(record: Record<string, unknown>): {
  locationRaw: string;
  city?: string;
} | undefined {
  const candidates = [
    stringField(record, "location"),
    stringField(record, "cityStateCountry"),
    stringField(record, "city"),
    ...stringArrayField(record, "multi_location")
  ].filter((value): value is string => value !== undefined);
  const mainland = candidates.find(isMainlandChinaLocation);
  if (!mainland) return undefined;
  const city = stringField(record, "city");
  return {
    locationRaw: mainland,
    ...(city && isMainlandChinaLocation(`${city}, China`) ? { city } : {})
  };
}

function isMainlandChinaLocation(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  return /(?:\bChina\b|中国|CHN\s*-)/iu.test(normalized) &&
    !/(?:Hong\s*Kong|香港|Macau|Macao|澳门|Taiwan|台湾)/iu.test(normalized);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nestedStringField(record: Record<string, unknown>, path: readonly string[]): string | undefined {
  let value: unknown = record;
  for (const field of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[field];
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayField(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
    : [];
}

function safeHttpsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizedOfficialJsonOutputString(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

interface MsdPageConfig {
  widgetApiEndpoint: string;
  country: string;
  deviceType: string;
  locale: string;
  refNum: string;
  pageName: string;
  pageId: string;
}

interface MsdValidatedResponse {
  status: number;
  body: string;
  finalUrl: string;
  contentType: string;
  capturedAt: string;
}

interface MsdCapturedPage {
  logicalKey: string;
  request: MsdDualOfficialHttpRequest;
  response: MsdValidatedResponse;
  records: Record<string, unknown>[];
  total: number;
  requestedOffset: number;
  requestedPageSize: number;
  locator: string;
}

interface MsdCapture {
  entry: {
    request: MsdDualOfficialHttpRequest;
    response: MsdValidatedResponse;
    pageConfig: MsdPageConfig;
  };
  workdayPreflight: {
    request: MsdDualOfficialHttpRequest;
    response: MsdValidatedResponse;
    locationIds: string[];
    workerSubtypeId: string;
    locator: string;
  };
  workdayPages: MsdCapturedPage[];
  phenomPages: MsdCapturedPage[];
}

class MsdSourceError extends Error {
  constructor(
    readonly code: string,
    readonly transportFailure?: SourceTransportFailure
  ) {
    super(code);
    this.name = "MsdSourceError";
  }
}

export function createMsdDualOfficialSourceFetch(
  deps: MsdDualOfficialSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const now = deps.now ?? (() => new Date());
    const capturedAt = now().toISOString();
    const config = exactMsdDualOfficialConfig(plan);
    if (!config) return failedMsd(capturedAt, "MSD_PLAN_BINDING_INVALID");
    const entryHttp = deps.entryHttp ?? defaultMsdHttpClient;
    const workdayHttp = deps.workdayHttp ?? defaultMsdHttpClient;
    const phenomHttp = deps.phenomHttp ?? defaultMsdHttpClient;

    try {
      const entryRequest = msdGetRequest(config.officialSearchUrl);
      const entryResponse = validateMsdResponse(
        entryRequest,
        await entryHttp(entryRequest),
        capturedAt,
        "text/html"
      );
      const pageConfig = parseMsdPageConfig(entryResponse.body);
      assertMsdPageConfig(pageConfig, config);

      const preflightBody = JSON.stringify({
        appliedFacets: {}, limit: config.workdayPageSize, offset: 0, searchText: ""
      });
      const preflightRequest = msdPostRequest(config.workdayJobsUrl, preflightBody, config.workdayEntryUrl);
      const preflightResponse = validateMsdResponse(
        preflightRequest,
        await workdayHttp(preflightRequest),
        capturedAt,
        "application/json"
      );
      const preflightRoot = strictJsonRecord(preflightResponse.body, "MSD_WORKDAY_PREFLIGHT_INVALID");
      const workdayFacetSelection = deriveMsdWorkdayFacetSelection(
        preflightRoot.facets,
        config.workerSubtypeDescriptor
      );
      const preflightLocator = requestContractV2Locator("msd-workday-facets-v1|json:$.facets", {
        family: "workday",
        role: "facet-preflight",
        method: "POST",
        url: config.workdayJobsUrl,
        body: JSON.parse(preflightBody),
        coordinate: { sequence: -1, requestedOffset: 0, requestedPageSize: config.workdayPageSize }
      });

      const appliedFacets = {
        locations: workdayFacetSelection.locationIds,
        workerSubType: [workdayFacetSelection.workerSubtypeId]
      };
      const workdayPages: MsdCapturedPage[] = [];
      const workdayRecords: Record<string, unknown>[] = [];
      let workdayTotal: number | undefined;
      for (let pageIndex = 0; pageIndex < config.maxPages; pageIndex += 1) {
        const requestedOffset = pageIndex * config.workdayPageSize;
        const body = JSON.stringify({
          appliedFacets,
          limit: config.workdayPageSize,
          offset: requestedOffset,
          searchText: ""
        });
        const request = msdPostRequest(config.workdayJobsUrl, body, config.workdayEntryUrl);
        const response = validateMsdResponse(
          request,
          await workdayHttp(request),
          capturedAt,
          "application/json"
        );
        const root = strictJsonRecord(response.body, "MSD_WORKDAY_PAGE_INVALID");
        const total = nonnegativeInteger(root.total, "MSD_WORKDAY_TOTAL_INVALID");
        const records = strictRecordArray(root.jobPostings, "MSD_WORKDAY_PAGE_INVALID");
        if (workdayTotal === undefined) workdayTotal = total;
        if (total !== workdayTotal || requestedOffset > total ||
          records.length !== Math.min(config.workdayPageSize, Math.max(0, total - requestedOffset))) {
          throw new MsdSourceError("MSD_WORKDAY_PAGINATION_DRIFT");
        }
        const logicalKey = `msd-workday-page-${String(pageIndex).padStart(4, "0")}`;
        const locator = requestContractV2Locator("msd-workday-page-v1|json:$.total+$.jobPostings", {
          family: "workday",
          role: "page",
          method: "POST",
          url: config.workdayJobsUrl,
          body: JSON.parse(body),
          coordinate: { sequence: pageIndex, requestedOffset, requestedPageSize: config.workdayPageSize }
        });
        workdayPages.push({
          logicalKey, request, response, records, total,
          requestedOffset, requestedPageSize: config.workdayPageSize, locator
        });
        workdayRecords.push(...records);
        if (workdayRecords.length === total) break;
        if (pageIndex === config.maxPages - 1) throw new MsdSourceError("MSD_WORKDAY_MAX_PAGES_REACHED");
      }
      if (workdayTotal === undefined || workdayRecords.length !== workdayTotal) {
        throw new MsdSourceError("MSD_WORKDAY_TOTAL_NOT_CLOSED");
      }

      const phenomPages: MsdCapturedPage[] = [];
      const phenomRecords: Record<string, unknown>[] = [];
      let phenomTotal: number | undefined;
      for (let pageIndex = 0; pageIndex < config.maxPages; pageIndex += 1) {
        const requestedOffset = pageIndex * config.pageSize;
        const body = JSON.stringify(msdPhenomRequestBody(
          pageConfig,
          config.countryDescriptor,
          config.pageSize,
          requestedOffset
        ));
        const request = msdPostRequest(config.phenomWidgetUrl, body, config.officialSearchUrl);
        const response = validateMsdResponse(
          request,
          await phenomHttp(request),
          capturedAt,
          "application/json"
        );
        const envelope = parseMsdPhenomEnvelope(response.body);
        if (phenomTotal === undefined) phenomTotal = envelope.total;
        if (envelope.total !== phenomTotal || requestedOffset > envelope.total ||
          envelope.records.length !== Math.min(config.pageSize, Math.max(0, envelope.total - requestedOffset))) {
          throw new MsdSourceError("MSD_PHENOM_PAGINATION_DRIFT");
        }
        const logicalKey = `msd-phenom-page-${String(pageIndex).padStart(4, "0")}`;
        const locator = requestContractV2Locator("msd-phenom-page-v1|json:$.refineSearch", {
          family: "phenom",
          role: "page-corroboration",
          method: "POST",
          url: config.phenomWidgetUrl,
          body: JSON.parse(body),
          coordinate: { sequence: pageIndex, requestedOffset, requestedPageSize: config.pageSize }
        });
        phenomPages.push({
          logicalKey, request, response, records: envelope.records, total: envelope.total,
          requestedOffset, requestedPageSize: config.pageSize, locator
        });
        phenomRecords.push(...envelope.records);
        if (phenomRecords.length === envelope.total) break;
        if (pageIndex === config.maxPages - 1) throw new MsdSourceError("MSD_PHENOM_MAX_PAGES_REACHED");
      }
      if (phenomTotal === undefined || phenomRecords.length !== phenomTotal) {
        throw new MsdSourceError("MSD_PHENOM_TOTAL_NOT_CLOSED");
      }

      const reconciliation = reconcileMsdOfficialSets({
        workdayRecords,
        phenomRecords,
        officialDetailBaseUrl: config.officialDetailBaseUrl,
        allowedApplyOrigins: config.allowedApplyOrigins
      });
      if (!reconciliation.ok) throw new MsdSourceError(reconciliation.failureCode);

      const capture: MsdCapture = {
        entry: { request: entryRequest, response: entryResponse, pageConfig },
        workdayPreflight: {
          request: preflightRequest,
          response: preflightResponse,
          locationIds: workdayFacetSelection.locationIds,
          workerSubtypeId: workdayFacetSelection.workerSubtypeId,
          locator: preflightLocator
        },
        workdayPages,
        phenomPages
      };
      const { evidence, evaluation } = buildMsdEvidence(capture, reconciliation.jobs);
      if (!evaluation.safeCompleteness || evaluation.derivedAnomalyCodes.length > 0) {
        return failedMsd(capturedAt, "MSD_PAGINATION_EVIDENCE_UNSAFE", evidence, evaluation);
      }

      return {
        ok: true,
        capturedAt,
        payload: {
          jobPostings: reconciliation.jobs.map((job) => ({
            sourceJobId: job.officialId,
            title: job.title,
            officialUrl: job.officialUrl,
            locationRaw: job.locationRaw,
            cities: job.cities
          }))
        },
        completeness: msdCompleteness(phenomTotal, phenomPages.length),
        fetchEvidence: evidence,
        paginationEvaluation: evaluation
      } satisfies SourceFetchResult;
    } catch (error) {
      const transportFailure = error instanceof MsdSourceError
        ? error.transportFailure
        : retryableTransportFailureFromError(error);
      return failedMsd(
        capturedAt,
        safeMsdFailureCode(error),
        undefined,
        undefined,
        transportFailure
      );
    }
  };
}

function buildMsdEvidence(
  capture: MsdCapture,
  jobs: readonly MsdOfficialReconciledJob[]
): { evidence: PersistentSourceFetchEvidence; evaluation: PaginationEvaluation } {
  const entryArtifact: SourceFetchArtifactDraft = {
    id: "msd-official-entry",
    logicalKey: "msd-official-entry",
    kind: "OFFICIAL_COMPANY_PAGE",
    requestedUrl: capture.entry.request.url,
    finalUrl: capture.entry.response.finalUrl,
    httpStatus: capture.entry.response.status,
    contentType: capture.entry.response.contentType,
    capturedAt: capture.entry.response.capturedAt,
    body: capture.entry.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: "msd-entry-config-v1|json:phApp+phApp.pageId"
  };
  const preflightArtifact: SourceFetchArtifactDraft = {
    id: "msd-workday-preflight",
    logicalKey: "msd-workday-preflight",
    kind: "ATS_API_RESPONSE",
    requestedUrl: capture.workdayPreflight.request.url,
    finalUrl: capture.workdayPreflight.response.finalUrl,
    httpStatus: capture.workdayPreflight.response.status,
    contentType: capture.workdayPreflight.response.contentType,
    capturedAt: capture.workdayPreflight.response.capturedAt,
    body: capture.workdayPreflight.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: capture.workdayPreflight.locator
  };
  const workdayArtifacts: SourceFetchArtifactDraft[] = capture.workdayPages.map((page) => ({
    id: page.logicalKey,
    logicalKey: page.logicalKey,
    kind: "ATS_API_RESPONSE",
    requestedUrl: page.request.url,
    finalUrl: page.response.finalUrl,
    httpStatus: page.response.status,
    contentType: page.response.contentType,
    capturedAt: page.response.capturedAt,
    body: page.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: page.locator
  }));
  const phenomArtifacts: SourceFetchArtifactDraft[] = capture.phenomPages.map((page) => ({
    id: page.logicalKey,
    logicalKey: page.logicalKey,
    kind: "PAGINATION_PAGE",
    requestedUrl: page.request.url,
    finalUrl: page.response.finalUrl,
    httpStatus: page.response.status,
    contentType: page.response.contentType,
    capturedAt: page.response.capturedAt,
    body: page.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: page.locator
  }));
  const validIds = new Set(jobs.map((job) => job.officialId));
  const exclusions: Array<{ pageSequence: number; recordIndex: number; id: string }> = [];
  const pages: SourceFetchPageTrace[] = capture.phenomPages.map((page, sequence) => {
    const ids = page.records.map((record) => stringField(record, "reqId"));
    if (ids.some((id) => id === undefined)) throw new MsdSourceError("MSD_PHENOM_ID_INVALID");
    const rawIds = ids as string[];
    const pageValidIds = rawIds.filter((id, recordIndex) => {
      const valid = validIds.has(id);
      if (!valid) exclusions.push({ pageSequence: sequence, recordIndex, id });
      return valid;
    });
    const nextOffset = page.requestedOffset + page.records.length;
    const hasNext = nextOffset < page.total;
    return {
      sequence,
      artifactLogicalKey: page.logicalKey,
      requestedCursor: null,
      returnedCursor: null,
      requestedOffset: page.requestedOffset,
      returnedOffset: null,
      requestedPage: null,
      returnedPage: null,
      requestedPageSize: page.requestedPageSize,
      // Phenom does not declare an effective page-size field in the response.
      // The number of records on the final page is an observation, not a
      // returned capacity declaration; rawJobIds already records that count.
      returnedPageSize: null,
      rawJobIds: rawIds,
      validJobIds: pageValidIds,
      declaredTotal: page.total,
      declaredCount: null,
      declaredPages: null,
      nextPageSignalBefore: page.requestedOffset === 0 ? null : `offset:${page.requestedOffset}`,
      nextPageSignalAfter: hasNext ? `offset:${nextOffset}` : null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(page.response.body, "utf8")).sha256,
      termination: page.total === 0 ? "EMPTY_PAGE" : hasNext ? "CONTINUE" : "NEXT_ABSENT",
      anomalyCodes: [],
      capturedAt: page.response.capturedAt
    };
  });
  const declarationArtifact = phenomArtifacts[0];
  if (!declarationArtifact) throw new MsdSourceError("MSD_PHENOM_PAGE_MISSING");
  const rawCount = capture.phenomPages.reduce((sum, page) => sum + page.records.length, 0);
  if (rawCount !== jobs.length + exclusions.length) {
    throw new MsdSourceError("MSD_RECONCILIATION_OUTPUT_MISMATCH");
  }
  const rawEvidence = parsePersistentSourceFetchEvidence({
    captureTool: { name: "msd-dual-official-http", version: "1" },
    artifacts: [entryArtifact, preflightArtifact, ...workdayArtifacts, ...phenomArtifacts],
    pages,
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT",
      value: rawCount,
      artifactLogicalKey: declarationArtifact.logicalKey,
      extractorLocator: declarationArtifact.extractorLocator,
      scope: "SOURCE"
    },
    fetchCounts: {
      rawCount,
      parsedCount: rawCount,
      validCount: jobs.length,
      parseDiscardCount: 0,
      validationDiscardCount: exclusions.length
    },
    fetchLosses: exclusions.map((exclusion) => ({
      stage: "VALIDATION" as const,
      reason: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER",
      rawLocator: `msd-phenom-page-${String(exclusion.pageSequence).padStart(4, "0")}#record:${exclusion.recordIndex}`,
      details: {
        code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER",
        pageSequence: exclusion.pageSequence,
        recordIndex: exclusion.recordIndex
      }
    }))
  });
  const evidence = deriveCanonicalPaginationEvidence({
    evidence: rawEvidence,
    expectedChannelIds: [],
    filteredOutput: true,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true
  });
  const evaluation = evaluatePaginationEvidence({
    evidence,
    expectedChannelIds: [],
    filteredOutput: true,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true
  });
  return { evidence, evaluation };
}

function msdCompleteness(expectedJobCount: number, pagesVisited: number): CompletenessEvidence {
  return {
    completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
    expectedJobCount,
    completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
    completenessEvidenceUrl: MSD_OFFICIAL_SEARCH_URL,
    pagesVisited,
    pageSize: MSD_PHENOM_PAGE_SIZE,
    totalPages: Math.ceil(expectedJobCount / MSD_PHENOM_PAGE_SIZE),
    completenessBlockerReason: "Strict downstream replay has not yet certified the dual-official-source archive"
  };
}

function exactMsdDualOfficialConfig(plan: SourceCrawlPlan): MsdDualOfficialFetchConfig | undefined {
  const profile = plan.adapterId === "official-json" ? plan.profileBoundSource : undefined;
  if (
    plan.adapterId !== "official-json" ||
    plan.company.id !== "company-msd-china" ||
    plan.company.officialChineseName !== "默沙东中国" ||
    plan.company.category !== "FOREIGN_PHARMA" ||
    plan.source.id !== "source-msd-china-social" ||
    plan.source.companyId !== "company-msd-china" ||
    plan.source.kind !== "SOCIAL" ||
    plan.source.status !== "VERIFIED_SCRAPABLE" ||
    plan.source.atsKind !== "OFFICIAL_JSON" ||
    plan.source.officialEntryUrl !== MSD_OFFICIAL_SEARCH_URL ||
    plan.source.officialChainEvidenceUrl !== MSD_OFFICIAL_SEARCH_URL ||
    profile?.kind !== "msd-dual-official" ||
    JSON.stringify(profile.config) !== JSON.stringify(MSD_DUAL_OFFICIAL_FETCH_CONFIG)
  ) return undefined;
  return profile.config;
}

function msdGetRequest(url: string): MsdDualOfficialHttpRequest {
  return {
    url,
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": "job-search-crawler/0.1"
    }
  };
}

function msdPostRequest(url: string, body: string, referer: string): MsdDualOfficialHttpRequest {
  return {
    url,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: new URL(referer).origin,
      Referer: referer,
      "User-Agent": "job-search-crawler/0.1"
    },
    body
  };
}

function validateMsdResponse(
  request: MsdDualOfficialHttpRequest,
  response: MsdDualOfficialHttpResponse,
  fallbackCapturedAt: string,
  expectedContentType: "text/html" | "application/json"
): MsdValidatedResponse {
  const finalUrl = response.finalUrl ?? request.url;
  const contentType = response.contentType ?? "";
  const capturedAt = response.capturedAt ?? fallbackCapturedAt;
  if (response.status !== 200) {
    throw new MsdSourceError(
      "MSD_HTTP_RESPONSE_INVALID",
      retryableHttpTransportFailure(response.status)
    );
  }
  if (
    finalUrl !== request.url || response.body.trim().length === 0 ||
    !contentType.toLowerCase().startsWith(expectedContentType) ||
    !Number.isFinite(Date.parse(capturedAt)) ||
    !safeHttpsUrl(request.url) || !safeHttpsUrl(finalUrl)
  ) throw new MsdSourceError("MSD_HTTP_RESPONSE_INVALID");
  return { status: response.status, body: response.body, finalUrl, contentType, capturedAt };
}

function parseMsdPageConfig(html: string): MsdPageConfig {
  const appMatch = html.match(/var\s+phApp\s*=\s*phApp\s*\|\|\s*(\{.*?\})\s*;\s*phApp\.ddo\s*=/su);
  const pageIdMatch = html.match(/phApp\.pageId\s*=\s*["']([^"']+)["']/u);
  if (!appMatch?.[1] || !pageIdMatch?.[1] || !hasUniqueJsonObjectKeys(appMatch[1])) {
    throw new MsdSourceError("MSD_PHENOM_ENTRY_CONFIG_INVALID");
  }
  let root: unknown;
  try { root = JSON.parse(appMatch[1]); }
  catch { throw new MsdSourceError("MSD_PHENOM_ENTRY_CONFIG_INVALID"); }
  if (!isRecord(root)) throw new MsdSourceError("MSD_PHENOM_ENTRY_CONFIG_INVALID");
  const required = {
    widgetApiEndpoint: stringField(root, "widgetApiEndpoint"),
    country: stringField(root, "country"),
    deviceType: stringField(root, "deviceType"),
    locale: stringField(root, "locale"),
    refNum: stringField(root, "refNum"),
    pageName: stringField(root, "pageName"),
    pageId: pageIdMatch[1]
  };
  if (Object.values(required).some((value) => !value)) {
    throw new MsdSourceError("MSD_PHENOM_ENTRY_CONFIG_INVALID");
  }
  return required as MsdPageConfig;
}

function assertMsdPageConfig(pageConfig: MsdPageConfig, config: MsdDualOfficialFetchConfig): void {
  if (
    pageConfig.widgetApiEndpoint !== config.phenomWidgetUrl ||
    pageConfig.country !== "cn" ||
    pageConfig.deviceType !== "desktop" ||
    pageConfig.locale !== "zh_cn" ||
    pageConfig.refNum !== "MSD1GB" ||
    pageConfig.pageName !== "search-results" ||
    pageConfig.pageId !== "page10-ds"
  ) throw new MsdSourceError("MSD_PHENOM_ENTRY_CONFIG_INVALID");
}

function strictJsonRecord(body: string, code: string): Record<string, unknown> {
  if (!hasUniqueJsonObjectKeys(body)) throw new MsdSourceError(code);
  let value: unknown;
  try { value = JSON.parse(body); }
  catch { throw new MsdSourceError(code); }
  if (!isRecord(value)) throw new MsdSourceError(code);
  return value;
}

function strictRecordArray(value: unknown, code: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) throw new MsdSourceError(code);
  return value as Record<string, unknown>[];
}

function nonnegativeInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new MsdSourceError(code);
  return value as number;
}

function deriveMsdWorkdayFacetSelection(
  value: unknown,
  workerSubtypeDescriptor: string
): { locationIds: string[]; workerSubtypeId: string } {
  const groups = collectFacetGroups(value);
  const locationGroups = groups.filter((group) => group.facetParameter === "locations");
  const subtypeGroups = groups.filter((group) => group.facetParameter === "workerSubType");
  if (locationGroups.length !== 1 || subtypeGroups.length !== 1) {
    throw new MsdSourceError("MSD_WORKDAY_FACET_INVALID");
  }
  const locationValues = strictFacetValues(locationGroups[0]!.values);
  const subtypeValues = strictFacetValues(subtypeGroups[0]!.values);
  const locations = locationValues.filter((entry) => /^CHN\s*-/u.test(entry.descriptor));
  const workerSubtypes = subtypeValues.filter((entry) => entry.descriptor === workerSubtypeDescriptor);
  if (locations.length === 0 || workerSubtypes.length !== 1 ||
    new Set(locations.map((entry) => entry.id)).size !== locations.length) {
    throw new MsdSourceError("MSD_WORKDAY_FACET_INVALID");
  }
  return {
    locationIds: locations.map((entry) => entry.id).sort(compareUtf8),
    workerSubtypeId: workerSubtypes[0]!.id
  };
}

function collectFacetGroups(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectFacetGroups);
  if (!isRecord(value)) return [];
  return [
    ...(typeof value.facetParameter === "string" ? [value] : []),
    ...collectFacetGroups(value.values),
    ...collectFacetGroups(value.children)
  ];
}

function strictFacetValues(value: unknown): Array<{ descriptor: string; id: string }> {
  if (!Array.isArray(value)) throw new MsdSourceError("MSD_WORKDAY_FACET_INVALID");
  const result = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const descriptor = stringField(item, "descriptor");
    const id = stringField(item, "id");
    return descriptor && id ? [{ descriptor, id }] : [];
  });
  if (result.length !== value.length) throw new MsdSourceError("MSD_WORKDAY_FACET_INVALID");
  return result;
}

function msdPhenomRequestBody(
  config: MsdPageConfig,
  countryDescriptor: string,
  size: number,
  from: number
): Record<string, unknown> {
  return {
    lang: config.locale,
    locale: config.locale,
    deviceType: config.deviceType,
    country: config.country,
    pageName: config.pageName,
    size,
    from,
    jobs: true,
    counts: true,
    all_fields: ["category", "country", "state", "city", "type", "jobLevelId"],
    clearAll: false,
    jdsource: "facets",
    isSliderEnable: false,
    pageId: config.pageId,
    siteType: "external",
    keywords: "",
    global: true,
    selected_fields: { country: [countryDescriptor] },
    sort: { order: "desc", field: "postedDate" },
    locationData: {},
    refNum: config.refNum,
    ddoKey: "refineSearch"
  };
}

function parseMsdPhenomEnvelope(body: string): {
  total: number;
  records: Record<string, unknown>[];
} {
  const root = strictJsonRecord(body, "MSD_PHENOM_PAGE_INVALID");
  if (!isRecord(root.refineSearch) || !isRecord(root.refineSearch.data)) {
    throw new MsdSourceError("MSD_PHENOM_PAGE_INVALID");
  }
  return {
    total: nonnegativeInteger(root.refineSearch.totalHits, "MSD_PHENOM_TOTAL_INVALID"),
    records: strictRecordArray(root.refineSearch.data.jobs, "MSD_PHENOM_PAGE_INVALID")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getStrictMsdDualOfficialNetworkPolicy(
  plan: SourceCrawlPlan
): {
  urlRules: Array<{
    id: string;
    url: string;
    match: "EXACT";
    allowsPagination?: true;
    allowsDeclaration?: true;
    allowsPositiveTotalDeclaration?: true;
  }>; 
  allowPositiveOfficialTotalCountAfterAdapterReconciliation: true;
  allowIndependentlyVerifiedProfileBoundExclusions: true;
} | undefined {
  const config = exactMsdDualOfficialConfig(plan);
  if (!config) return undefined;
  return {
    urlRules: [
      { id: "profile-msd-entry", url: config.officialSearchUrl, match: "EXACT" },
      {
        id: "profile-msd-phenom",
        url: config.phenomWidgetUrl,
        match: "EXACT",
        allowsPagination: true,
        allowsDeclaration: true,
        allowsPositiveTotalDeclaration: true
      },
      { id: "profile-msd-workday", url: config.workdayJobsUrl, match: "EXACT" }
    ],
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true
  };
}

/**
 * Independently reconstructs the official sets from the archived response
 * bodies and request-contract hashes. It does not trust the fetcher's parsed
 * jobs, counts or placeholder decision.
 */
export function validateStrictMsdDualOfficialEvidence(
  plan: SourceCrawlPlan,
  evidenceInput: unknown,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  try {
    const config = exactMsdDualOfficialConfig(plan);
    if (!config) return false;
    const evidence = parsePersistentSourceFetchEvidence(evidenceInput);
    if (
      evidence.captureTool.name !== "msd-dual-official-http" ||
      evidence.captureTool.version !== "1" ||
      evidence.supportingArtifactOnlyFailure !== undefined ||
      evidence.fetchCounts.parseDiscardCount !== 0 ||
      evidence.fetchCounts.validationDiscardCount !== evidence.fetchLosses.length
    ) return false;

    const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
    if (artifacts.size !== evidence.artifacts.length) return false;
    const entry = artifacts.get("msd-official-entry");
    const preflight = artifacts.get("msd-workday-preflight");
    if (!entry || !preflight ||
      !strictMsdNetworkArtifact(entry, "OFFICIAL_COMPANY_PAGE", config.officialSearchUrl) ||
      entry.extractorLocator !== "msd-entry-config-v1|json:phApp+phApp.pageId" ||
      typeof entry.body !== "string" ||
      !strictMsdNetworkArtifact(preflight, "ATS_API_RESPONSE", config.workdayJobsUrl) ||
      typeof preflight.body !== "string") return false;
    const pageConfig = parseMsdPageConfig(entry.body);
    assertMsdPageConfig(pageConfig, config);

    const preflightRoot = strictJsonRecord(preflight.body, "MSD_WORKDAY_PREFLIGHT_INVALID");
    const facetSelection = deriveMsdWorkdayFacetSelection(
      preflightRoot.facets,
      config.workerSubtypeDescriptor
    );
    const preflightBody = {
      appliedFacets: {}, limit: config.workdayPageSize, offset: 0, searchText: ""
    };
    if (!requestContractV2Matches(preflight.extractorLocator, {
      family: "workday",
      role: "facet-preflight",
      method: "POST",
      url: config.workdayJobsUrl,
      body: preflightBody,
      coordinate: { sequence: -1, requestedOffset: 0, requestedPageSize: config.workdayPageSize }
    })) return false;

    const workdayArtifacts = evidence.artifacts
      .filter((artifact) => /^msd-workday-page-\d{4}$/u.test(artifact.logicalKey))
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey, "en"));
    const phenomArtifacts = evidence.artifacts
      .filter((artifact) => /^msd-phenom-page-\d{4}$/u.test(artifact.logicalKey))
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey, "en"));
    if (workdayArtifacts.length === 0 || phenomArtifacts.length === 0 ||
      workdayArtifacts.length > config.maxPages || phenomArtifacts.length > config.maxPages ||
      evidence.artifacts.length !== 2 + workdayArtifacts.length + phenomArtifacts.length ||
      evidence.pages.length !== phenomArtifacts.length) return false;

    const appliedFacets = {
      locations: facetSelection.locationIds,
      workerSubType: [facetSelection.workerSubtypeId]
    };
    const workdayRecords: Record<string, unknown>[] = [];
    let workdayTotal: number | undefined;
    for (let sequence = 0; sequence < workdayArtifacts.length; sequence += 1) {
      const artifact = workdayArtifacts[sequence]!;
      const offset = sequence * config.workdayPageSize;
      if (artifact.logicalKey !== `msd-workday-page-${String(sequence).padStart(4, "0")}` ||
        !strictMsdNetworkArtifact(artifact, "ATS_API_RESPONSE", config.workdayJobsUrl) ||
        typeof artifact.body !== "string") return false;
      const root = strictJsonRecord(artifact.body, "MSD_WORKDAY_PAGE_INVALID");
      const total = nonnegativeInteger(root.total, "MSD_WORKDAY_TOTAL_INVALID");
      const records = strictRecordArray(root.jobPostings, "MSD_WORKDAY_PAGE_INVALID");
      if (workdayTotal === undefined) workdayTotal = total;
      if (total !== workdayTotal || records.length !==
        Math.min(config.workdayPageSize, Math.max(0, total - offset))) return false;
      const body = {
        appliedFacets,
        limit: config.workdayPageSize,
        offset,
        searchText: ""
      };
      if (!requestContractV2Matches(artifact.extractorLocator, {
        family: "workday",
        role: "page",
        method: "POST",
        url: config.workdayJobsUrl,
        body,
        coordinate: { sequence, requestedOffset: offset, requestedPageSize: config.workdayPageSize }
      })) return false;
      const ids = records.map(workdayOfficialId);
      if (ids.some((id) => id === undefined)) return false;
      workdayRecords.push(...records);
    }
    if (workdayTotal === undefined || workdayRecords.length !== workdayTotal) return false;

    const phenomRecords: Record<string, unknown>[] = [];
    const phenomPageRecords: Array<{
      artifact: PersistentSourceFetchEvidence["artifacts"][number];
      records: Record<string, unknown>[];
      total: number;
      offset: number;
      rawIds: string[];
    }> = [];
    let phenomTotal: number | undefined;
    for (let sequence = 0; sequence < phenomArtifacts.length; sequence += 1) {
      const artifact = phenomArtifacts[sequence]!;
      const offset = sequence * config.pageSize;
      if (artifact.logicalKey !== `msd-phenom-page-${String(sequence).padStart(4, "0")}` ||
        !strictMsdNetworkArtifact(artifact, "PAGINATION_PAGE", config.phenomWidgetUrl) ||
        typeof artifact.body !== "string") return false;
      const envelope = parseMsdPhenomEnvelope(artifact.body);
      if (phenomTotal === undefined) phenomTotal = envelope.total;
      if (envelope.total !== phenomTotal || envelope.records.length !==
        Math.min(config.pageSize, Math.max(0, envelope.total - offset))) return false;
      const body = msdPhenomRequestBody(pageConfig, config.countryDescriptor, config.pageSize, offset);
      if (!requestContractV2Matches(artifact.extractorLocator, {
        family: "phenom",
        role: "page-corroboration",
        method: "POST",
        url: config.phenomWidgetUrl,
        body,
        coordinate: { sequence, requestedOffset: offset, requestedPageSize: config.pageSize }
      })) return false;
      const rawIds = envelope.records.map((record) => stringField(record, "reqId"));
      if (rawIds.some((id) => id === undefined)) return false;
      phenomPageRecords.push({
        artifact,
        records: envelope.records,
        total: envelope.total,
        offset,
        rawIds: rawIds as string[]
      });
      phenomRecords.push(...envelope.records);
    }
    if (phenomTotal === undefined || phenomRecords.length !== phenomTotal) return false;

    const reconciled = reconcileMsdOfficialSets({
      workdayRecords,
      phenomRecords,
      officialDetailBaseUrl: config.officialDetailBaseUrl,
      allowedApplyOrigins: config.allowedApplyOrigins
    });
    if (!reconciled.ok) return false;
    const validIds = new Set(reconciled.jobs.map((job) => job.officialId));
    const expectedLosses: Array<{
      stage: "VALIDATION";
      reason: string;
      rawLocator: string;
      details: { code: string; pageSequence: number; recordIndex: number };
    }> = [];
    for (let sequence = 0; sequence < phenomPageRecords.length; sequence += 1) {
      const page = phenomPageRecords[sequence]!;
      const trace = evidence.pages[sequence];
      const validPageIds = page.rawIds.filter((id, recordIndex) => {
        const valid = validIds.has(id);
        if (!valid) {
          expectedLosses.push({
            stage: "VALIDATION",
            reason: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER",
            rawLocator: `msd-phenom-page-${String(sequence).padStart(4, "0")}#record:${recordIndex}`,
            details: {
              code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER",
              pageSequence: sequence,
              recordIndex
            }
          });
        }
        return valid;
      });
      const nextOffset = page.offset + page.records.length;
      const hasNext = nextOffset < page.total;
      if (!trace ||
        trace.sequence !== sequence || trace.artifactLogicalKey !== page.artifact.logicalKey ||
        trace.requestedOffset !== page.offset || trace.returnedOffset !== null ||
        trace.requestedCursor !== null || trace.returnedCursor !== null ||
        trace.requestedPage !== null || trace.returnedPage !== null ||
        trace.requestedPageSize !== config.pageSize ||
        trace.returnedPageSize !== null ||
        JSON.stringify(trace.rawJobIds) !== JSON.stringify(page.rawIds) ||
        JSON.stringify(trace.validJobIds) !== JSON.stringify(validPageIds) ||
        trace.declaredTotal !== page.total || trace.declaredCount !== null || trace.declaredPages !== null ||
        trace.nextPageSignalBefore !== (page.offset === 0 ? null : `offset:${page.offset}`) ||
        trace.nextPageSignalAfter !== (hasNext ? `offset:${nextOffset}` : null) ||
        trace.termination !== (page.total === 0 ? "EMPTY_PAGE" : hasNext ? "CONTINUE" : "NEXT_ABSENT") ||
        typeof page.artifact.body !== "string" ||
        trace.responseFingerprintSha256 !== sha256Bytes(Buffer.from(page.artifact.body, "utf8")).sha256 ||
        trace.capturedAt !== page.artifact.capturedAt || trace.anomalyCodes.length !== 0
      ) return false;
    }
    const observedLosses = evidence.fetchLosses.map((loss) => ({
      stage: loss.stage,
      reason: loss.reason,
      rawLocator: loss.rawLocator,
      details: loss.details
    }));
    if (JSON.stringify(observedLosses) !== JSON.stringify(expectedLosses)) return false;
    const declaration = evidence.declaredCompleteness;
    if (
      declaration?.kind !== "OFFICIAL_TOTAL_COUNT" || declaration.scope !== "SOURCE" ||
      declaration.channelId !== undefined || declaration.value !== phenomTotal ||
      declaration.artifactLogicalKey !== phenomArtifacts[0]!.logicalKey ||
      declaration.extractorLocator !== phenomArtifacts[0]!.extractorLocator ||
      evidence.fetchCounts.rawCount !== phenomTotal ||
      evidence.fetchCounts.parsedCount !== phenomTotal ||
      evidence.fetchCounts.validCount !== reconciled.jobs.length ||
      evidence.fetchCounts.validationDiscardCount !== expectedLosses.length ||
      reconciled.jobs.length + expectedLosses.length !== phenomTotal
    ) return false;

    const expectedOutput = reconciled.jobs.map((job) => ({
      sourceJobId: job.officialId,
      officialTitle: normalizedOfficialJsonOutputString(job.title),
      officialUrl: job.officialUrl,
      locationRaw: normalizedOfficialJsonOutputString(job.locationRaw),
      cities: job.cities.map(normalizedOfficialJsonOutputString)
    })).sort((left, right) => compareUtf8(left.sourceJobId, right.sourceJobId));
    const observedOutput = outputJobs.map((job) => ({
      sourceJobId: job.sourceJobId,
      officialTitle: job.officialTitle,
      officialUrl: job.officialUrl,
      locationRaw: job.locationRaw,
      cities: job.cities
    })).sort((left, right) => compareUtf8(left.sourceJobId ?? "", right.sourceJobId ?? ""));
    if (JSON.stringify(observedOutput) !== JSON.stringify(expectedOutput)) return false;

    const evaluation = evaluatePaginationEvidence({
      evidence,
      expectedChannelIds: [],
      filteredOutput: true,
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      allowIndependentlyVerifiedProfileBoundExclusions: true
    });
    return evaluation.safeCompleteness === true && evaluation.verifiedEligible === true &&
      evaluation.derivedAnomalyCodes.length === 0;
  } catch {
    return false;
  }
}

function strictMsdNetworkArtifact(
  artifact: PersistentSourceFetchEvidence["artifacts"][number],
  kind: "OFFICIAL_COMPANY_PAGE" | "ATS_API_RESPONSE" | "PAGINATION_PAGE",
  url: string
): boolean {
  return artifact.kind === kind && artifact.requestedUrl === url && artifact.finalUrl === url &&
    artifact.httpStatus === 200 && artifact.bodyRepresentation === "EXACT" &&
    typeof artifact.body === "string" && artifact.body.trim().length > 0 &&
    Number.isFinite(Date.parse(artifact.capturedAt)) &&
    (kind === "OFFICIAL_COMPANY_PAGE"
      ? /^text\/html\b/iu.test(artifact.contentType ?? "")
      : /^application\/json\b/iu.test(artifact.contentType ?? ""));
}

function failedMsd(
  capturedAt: string,
  failureReason: string,
  fetchEvidence?: PersistentSourceFetchEvidence,
  paginationEvaluation?: PaginationEvaluation,
  transportFailure?: SourceTransportFailure
): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason,
    ...(fetchEvidence ? { fetchEvidence } : {}),
    ...(paginationEvaluation ? { paginationEvaluation } : {}),
    ...(transportFailure ? { transportFailure } : {})
  };
}

function safeMsdFailureCode(error: unknown): string {
  return error instanceof MsdSourceError ? error.code : "MSD_DUAL_OFFICIAL_FETCH_FAILED";
}

async function defaultMsdHttpClient(
  request: MsdDualOfficialHttpRequest
): Promise<MsdDualOfficialHttpResponse> {
  const response = await fetchWithOfficialTimeout(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    redirect: "follow"
  });
  const contentType = response.headers.get("content-type") ?? undefined;
  return {
    status: response.status,
    body: await response.text(),
    finalUrl: response.url,
    ...(contentType === undefined ? {} : { contentType }),
    capturedAt: new Date().toISOString()
  };
}
