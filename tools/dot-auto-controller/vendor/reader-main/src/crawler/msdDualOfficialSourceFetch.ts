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
const MSD_PHENOM_PAGE_SIZE = 100;
const MSD_WORKDAY_PAGE_SIZE = 20;
const MSD_MAX_PAGES = 20;

type MsdFailureStage = "ENTRY" | "WORKDAY_PREFLIGHT" | "WORKDAY_PAGE" | "PHENOM_PAGE" |
  "WORKDAY_DETAIL" | "PHENOM_ONLY_DETAIL";

const SAFE_MSD_DUAL_OFFICIAL_FAILURE_CODES: ReadonlySet<string> = new Set([
  "MSD_DUAL_OFFICIAL_FETCH_FAILED",
  "MSD_DUPLICATE_OFFICIAL_ID",
  "MSD_ENTRY_FETCH_FAILED",
  "MSD_HTTP_RESPONSE_INVALID",
  "MSD_INVALID_OFFICIAL_RECORD",
  "MSD_NON_OFFICIAL_URL",
  "MSD_OUT_OF_SCOPE",
  "MSD_PAGINATION_EVIDENCE_UNSAFE",
  "MSD_PHENOM_ENTRY_CONFIG_INVALID",
  "MSD_PHENOM_MAX_PAGES_REACHED",
  "MSD_PHENOM_PAGE_FETCH_FAILED",
  "MSD_PHENOM_PAGE_INVALID",
  "MSD_PHENOM_PAGINATION_DRIFT",
  "MSD_PHENOM_ONLY_DETAIL_FETCH_FAILED",
  "MSD_PHENOM_ONLY_DETAIL_INVALID",
  "MSD_PHENOM_ONLY_REQUISITION_NOT_CLOSED",
  "MSD_PHENOM_TOTAL_INVALID",
  "MSD_PHENOM_TOTAL_NOT_CLOSED",
  "MSD_PLAN_BINDING_INVALID",
  "MSD_RECONCILIATION_OUTPUT_MISMATCH",
  "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE",
  "MSD_WORKDAY_DETAIL_FETCH_FAILED",
  "MSD_WORKDAY_DETAIL_INVALID",
  "MSD_WORKDAY_FACET_INVALID",
  "MSD_WORKDAY_ID_INVALID",
  "MSD_WORKDAY_MAX_PAGES_REACHED",
  "MSD_WORKDAY_PAGE_FETCH_FAILED",
  "MSD_WORKDAY_PAGE_INVALID",
  "MSD_WORKDAY_PAGE_MISSING",
  "MSD_WORKDAY_PAGINATION_DRIFT",
  "MSD_WORKDAY_PREFLIGHT_FETCH_FAILED",
  "MSD_WORKDAY_PREFLIGHT_INVALID",
  "MSD_WORKDAY_TOTAL_INVALID",
  "MSD_WORKDAY_TOTAL_NOT_CLOSED"
]);

export function isSafeMsdDualOfficialFailureCode(value: unknown): value is string {
  return typeof value === "string" && SAFE_MSD_DUAL_OFFICIAL_FAILURE_CODES.has(value);
}

export interface MsdDualOfficialFetchConfig {
  officialSearchUrl: typeof MSD_OFFICIAL_SEARCH_URL;
  officialDetailBaseUrl: typeof MSD_OFFICIAL_DETAIL_BASE_URL;
  phenomWidgetUrl: typeof MSD_PHENOM_WIDGET_URL;
  workdayEntryUrl: typeof MSD_WORKDAY_ENTRY_URL;
  workdayJobsUrl: typeof MSD_WORKDAY_JOBS_URL;
  allowedApplyOrigins: readonly [typeof MSD_WORKDAY_APPLY_ORIGIN];
  countryDescriptor: typeof MSD_COUNTRY_DESCRIPTOR;
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
  workdayDetailRecords?: readonly Record<string, unknown>[];
  phenomOnlyClosureProofs?: readonly MsdPhenomOnlyClosureProof[];
  officialDetailBaseUrl: string;
  allowedApplyOrigins: readonly string[];
}

export interface MsdPhenomOnlyClosureProof {
  officialId: string;
  status: 403;
  errorCode: "S22";
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
        code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER" | "VERIFIED_WORKDAY_CLOSED_REQUISITION";
      }>;
    }
  | {
      ok: false;
      failureCode:
        | "MSD_DUPLICATE_OFFICIAL_ID"
        | "MSD_INVALID_OFFICIAL_RECORD"
        | "MSD_NON_OFFICIAL_URL"
        | "MSD_OUT_OF_SCOPE"
        | "MSD_PHENOM_ONLY_REQUISITION_NOT_CLOSED"
        | "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE";
    };

/**
 * Reconciles MSD's two public official systems without treating either one as
 * self-certifying. The exact China-scoped Workday result set is the formal
 * denominator. The public MSD careers index corroborates matching records and
 * supplies their user-facing title, location and stable detail URL. A Workday-
 * only requisition is accepted only when its archived exact detail response
 * independently proves that it remains posted, applicable and mainland-scoped.
 * A Phenom-only requisition is excluded only when its archived Workday detail
 * response exactly proves that the requisition is closed.
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

  const workdayDetailsById = new Map<string, Record<string, unknown>>();
  for (const detailRecord of input.workdayDetailRecords ?? []) {
    const info = isRecord(detailRecord.jobPostingInfo) ? detailRecord.jobPostingInfo : undefined;
    const id = info ? stringField(info, "jobReqId") : undefined;
    if (!id) return { ok: false, failureCode: "MSD_INVALID_OFFICIAL_RECORD" };
    if (workdayDetailsById.has(id)) return { ok: false, failureCode: "MSD_DUPLICATE_OFFICIAL_ID" };
    workdayDetailsById.set(id, detailRecord);
  }

  const phenomOnlyClosureById = new Map<string, MsdPhenomOnlyClosureProof>();
  for (const proof of input.phenomOnlyClosureProofs ?? []) {
    if (!proof || typeof proof !== "object" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(proof.officialId) ||
      proof.status !== 403 || proof.errorCode !== "S22") {
      return { ok: false, failureCode: "MSD_PHENOM_ONLY_REQUISITION_NOT_CLOSED" };
    }
    if (phenomOnlyClosureById.has(proof.officialId)) {
      return { ok: false, failureCode: "MSD_DUPLICATE_OFFICIAL_ID" };
    }
    phenomOnlyClosureById.set(proof.officialId, proof);
  }

  const jobs: MsdOfficialReconciledJob[] = [];
  const excluded: Array<{
    officialId: string;
    code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER" | "VERIFIED_WORKDAY_CLOSED_REQUISITION";
  }> = [];
  for (const [id, record] of [...workdayById.entries()].sort(([left], [right]) => compareUtf8(left, right))) {
    if (phenomById.has(id)) continue;
    const detailRecord = workdayDetailsById.get(id);
    const detailJob = detailRecord
      ? reconcileMsdWorkdayOnlyDetail(record, detailRecord, id, allowedApplyOrigins)
      : undefined;
    if (!detailJob) return { ok: false, failureCode: "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE" };
    jobs.push(detailJob);
  }
  if ([...workdayDetailsById.keys()].some((id) => phenomById.has(id) || !workdayById.has(id))) {
    return { ok: false, failureCode: "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE" };
  }
  for (const [id, record] of [...phenomById.entries()].sort(([left], [right]) => compareUtf8(left, right))) {
    const inWorkday = workdayById.has(id);
    if (isVerifiedTestPlaceholder(record, id)) {
      if (inWorkday || phenomOnlyClosureById.has(id)) {
        return { ok: false, failureCode: "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE" };
      }
      excluded.push({ officialId: id, code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER" });
      continue;
    }
    if (!inWorkday) {
      if (!phenomOnlyClosureById.delete(id)) {
        return { ok: false, failureCode: "MSD_PHENOM_ONLY_REQUISITION_NOT_CLOSED" };
      }
      excluded.push({ officialId: id, code: "VERIFIED_WORKDAY_CLOSED_REQUISITION" });
      continue;
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
  if (phenomOnlyClosureById.size > 0) {
    return { ok: false, failureCode: "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE" };
  }

  return {
    ok: true,
    jobs: jobs.sort((left, right) => compareUtf8(left.officialId, right.officialId)),
    excluded: excluded.sort((left, right) => compareUtf8(left.officialId, right.officialId))
  };
}

function reconcileMsdWorkdayOnlyDetail(
  listRecord: Record<string, unknown>,
  detailRecord: Record<string, unknown>,
  officialId: string,
  allowedApplyOrigins: ReadonlySet<string>
): MsdOfficialReconciledJob | undefined {
  const info = isRecord(detailRecord.jobPostingInfo) ? detailRecord.jobPostingInfo : undefined;
  const title = stringField(listRecord, "title");
  const externalPath = stringField(listRecord, "externalPath");
  if (!info || !title || !externalPath || !externalPath.startsWith("/job/") ||
      stringField(info, "jobReqId") !== officialId || stringField(info, "title") !== title ||
      stringField(info, "jobPostingSiteId") !== "SearchJobs" ||
      stringField(info, "jobPostingId") !== externalPath.split("/").at(-1) ||
      info.posted !== true || info.canApply !== true) return undefined;
  const externalUrl = stringField(info, "externalUrl");
  const safeExternalUrl = externalUrl ? safeHttpsUrl(externalUrl) : undefined;
  if (!safeExternalUrl || !allowedApplyOrigins.has(new URL(safeExternalUrl).origin) ||
      new URL(safeExternalUrl).pathname !== `/SearchJobs${externalPath}`) return undefined;
  const location = stringField(info, "location");
  const additionalLocationsValue = info.additionalLocations;
  const additionalLocations = additionalLocationsValue === undefined
    ? []
    : stringArrayField(info, "additionalLocations");
  if (!location || (additionalLocationsValue !== undefined &&
      (!Array.isArray(additionalLocationsValue) || additionalLocations.length !== additionalLocationsValue.length))) {
    return undefined;
  }
  const publicLocations = [location, ...additionalLocations];
  if (new Set(publicLocations).size !== publicLocations.length) return undefined;
  const opaqueCount = /^([1-9][0-9]*) Locations$/u.exec(stringField(listRecord, "locationsText") ?? "");
  if (opaqueCount && Number(opaqueCount[1]) !== publicLocations.length) return undefined;
  const mainlandLocations = publicLocations.filter(isMainlandChinaLocation);
  if (mainlandLocations.length === 0) return undefined;
  return {
    officialId,
    title,
    officialUrl: safeExternalUrl,
    locationRaw: mainlandLocations.join(" | "),
    cities: mainlandLocations
  };
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

interface MsdCapturedDetail {
  logicalKey: string;
  officialId: string;
  request: MsdDualOfficialHttpRequest;
  response: MsdValidatedResponse;
  record: Record<string, unknown>;
  locator: string;
}

interface MsdCapturedPhenomOnlyDetail {
  logicalKey: string;
  officialId: string;
  request: MsdDualOfficialHttpRequest;
  response: MsdValidatedResponse;
  closureProof?: MsdPhenomOnlyClosureProof;
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
    locator: string;
  };
  workdayPages: MsdCapturedPage[];
  workdayDetails: MsdCapturedDetail[];
  phenomPages: MsdCapturedPage[];
  phenomOnlyDetails: MsdCapturedPhenomOnlyDetail[];
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
    let failureStage: MsdFailureStage = "ENTRY";

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
      failureStage = "WORKDAY_PREFLIGHT";
      const preflightRequest = msdPostRequest(config.workdayJobsUrl, preflightBody, config.workdayEntryUrl);
      const preflightResponse = validateMsdResponse(
        preflightRequest,
        await workdayHttp(preflightRequest),
        capturedAt,
        "application/json"
      );
      const preflightRoot = strictJsonRecord(preflightResponse.body, "MSD_WORKDAY_PREFLIGHT_INVALID");
      const workdayFacetSelection = deriveMsdWorkdayFacetSelection(preflightRoot.facets);
      const preflightLocator = requestContractV2Locator("msd-workday-facets-v1|json:$.facets", {
        family: "workday",
        role: "facet-preflight",
        method: "POST",
        url: config.workdayJobsUrl,
        body: JSON.parse(preflightBody),
        coordinate: { sequence: -1, requestedOffset: 0, requestedPageSize: config.workdayPageSize }
      });

      const appliedFacets = {
        locations: workdayFacetSelection.locationIds
      };
      const workdayPages: MsdCapturedPage[] = [];
      const workdayRecords: Record<string, unknown>[] = [];
      let workdayTotal: number | undefined;
      for (let pageIndex = 0; pageIndex < config.maxPages; pageIndex += 1) {
        failureStage = "WORKDAY_PAGE";
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
        failureStage = "PHENOM_PAGE";
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

      const phenomIds = new Set(phenomRecords.map((record) => stringField(record, "reqId")));
      const workdayDetails: MsdCapturedDetail[] = [];
      const workdayOnlyRecords = workdayRecords
        .map((record) => ({ record, officialId: workdayOfficialId(record) }))
        .filter((item): item is { record: Record<string, unknown>; officialId: string } =>
          item.officialId !== undefined && !phenomIds.has(item.officialId))
        .sort((left, right) => compareUtf8(left.officialId, right.officialId));
      for (let detailIndex = 0; detailIndex < workdayOnlyRecords.length; detailIndex += 1) {
        failureStage = "WORKDAY_DETAIL";
        const { record, officialId } = workdayOnlyRecords[detailIndex]!;
        const externalPath = stringField(record, "externalPath");
        const detailUrl = externalPath
          ? safeMsdWorkdayDetailUrl(config.allowedApplyOrigins[0], externalPath)
          : undefined;
        if (!detailUrl) throw new MsdSourceError("MSD_WORKDAY_DETAIL_INVALID");
        const detailRequest = msdJsonGetRequest(detailUrl, config.workdayEntryUrl);
        const detailResponse = validateMsdResponse(
          detailRequest,
          await workdayHttp(detailRequest),
          capturedAt,
          "application/json"
        );
        const detailRecord = strictJsonRecord(detailResponse.body, "MSD_WORKDAY_DETAIL_INVALID");
        const logicalKey = `msd-workday-detail-${String(detailIndex).padStart(4, "0")}`;
        const locator = requestContractV2Locator("msd-workday-detail-v1|json:$.jobPostingInfo", {
          family: "workday",
          role: "detail-corroboration",
          method: "GET",
          url: detailUrl,
          body: null,
          coordinate: { sequence: detailIndex, officialId }
        });
        workdayDetails.push({
          logicalKey,
          officialId,
          request: detailRequest,
          response: detailResponse,
          record: detailRecord,
          locator
        });
      }

      const workdayIds = workdayRecords.map(workdayOfficialId);
      if (workdayIds.some((id) => id === undefined)) {
        throw new MsdSourceError("MSD_INVALID_OFFICIAL_RECORD");
      }
      const workdayIdSet = new Set(workdayIds as string[]);
      const phenomOnlyRecords = phenomRecords
        .map((record) => ({ record, officialId: stringField(record, "reqId") }))
        .filter((item): item is { record: Record<string, unknown>; officialId: string } =>
          item.officialId !== undefined && !workdayIdSet.has(item.officialId) &&
          !isVerifiedTestPlaceholder(item.record, item.officialId))
        .sort((left, right) => compareUtf8(left.officialId, right.officialId));
      const phenomOnlyDetails: MsdCapturedPhenomOnlyDetail[] = [];
      for (let detailIndex = 0; detailIndex < phenomOnlyRecords.length; detailIndex += 1) {
        failureStage = "PHENOM_ONLY_DETAIL";
        const { record, officialId } = phenomOnlyRecords[detailIndex]!;
        const applyUrl = stringField(record, "applyUrl");
        const detailUrl = applyUrl
          ? safeMsdPhenomApplyDetailUrl(config.allowedApplyOrigins[0], applyUrl)
          : undefined;
        if (!detailUrl) throw new MsdSourceError("MSD_PHENOM_ONLY_DETAIL_INVALID");
        const detailRequest = msdJsonGetRequest(detailUrl, config.workdayEntryUrl);
        const { response: detailResponse, closureProof } = validateMsdPhenomOnlyDetailResponse(
          detailRequest,
          await workdayHttp(detailRequest),
          capturedAt,
          officialId
        );
        const logicalKey = `msd-phenom-only-detail-${String(detailIndex).padStart(4, "0")}`;
        const locator = requestContractV2Locator("msd-phenom-only-detail-v1|json:$", {
          family: "workday",
          role: "closed-detail-corroboration",
          method: "GET",
          url: detailUrl,
          body: null,
          coordinate: { sequence: detailIndex, officialId }
        });
        phenomOnlyDetails.push({
          logicalKey,
          officialId,
          request: detailRequest,
          response: detailResponse,
          ...(closureProof ? { closureProof } : {}),
          locator
        });
      }

      const capture: MsdCapture = {
        entry: { request: entryRequest, response: entryResponse, pageConfig },
        workdayPreflight: {
          request: preflightRequest,
          response: preflightResponse,
          locationIds: workdayFacetSelection.locationIds,
          locator: preflightLocator
        },
        workdayPages,
        workdayDetails,
        phenomPages,
        phenomOnlyDetails
      };
      const { evidence, evaluation } = buildMsdEvidence(capture);

      const reconciliation = reconcileMsdOfficialSets({
        workdayRecords,
        phenomRecords,
        workdayDetailRecords: workdayDetails.map((detail) => detail.record),
        phenomOnlyClosureProofs: phenomOnlyDetails.flatMap((detail) =>
          detail.closureProof ? [detail.closureProof] : []),
        officialDetailBaseUrl: config.officialDetailBaseUrl,
        allowedApplyOrigins: config.allowedApplyOrigins
      });
      if (!reconciliation.ok) {
        return failedMsd(capturedAt, reconciliation.failureCode, evidence, evaluation);
      }
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
        completeness: msdCompleteness(workdayTotal, workdayPages.length),
        fetchEvidence: evidence,
        paginationEvaluation: evaluation
      } satisfies SourceFetchResult;
    } catch (error) {
      const transportFailure = error instanceof MsdSourceError
        ? error.transportFailure
        : retryableTransportFailureFromError(error);
      return failedMsd(
        capturedAt,
        safeMsdFailureCode(error, failureStage),
        undefined,
        undefined,
        transportFailure
      );
    }
  };
}

function buildMsdEvidence(
  capture: MsdCapture
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
  const workdayDetailArtifacts: SourceFetchArtifactDraft[] = capture.workdayDetails.map((detail) => ({
    id: detail.logicalKey,
    logicalKey: detail.logicalKey,
    kind: "ATS_API_RESPONSE",
    requestedUrl: detail.request.url,
    finalUrl: detail.response.finalUrl,
    httpStatus: detail.response.status,
    contentType: detail.response.contentType,
    capturedAt: detail.response.capturedAt,
    body: detail.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: detail.locator
  }));
  const phenomArtifacts: SourceFetchArtifactDraft[] = capture.phenomPages.map((page) => ({
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
  const phenomOnlyDetailArtifacts: SourceFetchArtifactDraft[] = capture.phenomOnlyDetails.map((detail) => ({
    id: detail.logicalKey,
    logicalKey: detail.logicalKey,
    kind: "ATS_API_RESPONSE",
    requestedUrl: detail.request.url,
    finalUrl: detail.response.finalUrl,
    httpStatus: detail.response.status,
    contentType: detail.response.contentType,
    capturedAt: detail.response.capturedAt,
    body: detail.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: detail.locator
  }));
  const allWorkdayIds = capture.workdayPages.flatMap((page) => page.records.map(workdayOfficialId));
  if (allWorkdayIds.some((id) => id === undefined)) {
    throw new MsdSourceError("MSD_WORKDAY_ID_INVALID");
  }
  const validIds = new Set(allWorkdayIds as string[]);
  const pages: SourceFetchPageTrace[] = capture.workdayPages.map((page, sequence) => {
    const ids = page.records.map(workdayOfficialId);
    if (ids.some((id) => id === undefined)) throw new MsdSourceError("MSD_WORKDAY_ID_INVALID");
    const rawIds = ids as string[];
    const pageValidIds = rawIds.filter((id) => validIds.has(id));
    if (pageValidIds.length !== rawIds.length) throw new MsdSourceError("MSD_RECONCILIATION_OUTPUT_MISMATCH");
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
      returnedPageSize: null,
      rawJobIds: rawIds,
      validJobIds: pageValidIds,
      declaredTotal: page.total,
      declaredCount: null,
      declaredPages: Math.ceil(page.total / page.requestedPageSize),
      nextPageSignalBefore: page.requestedOffset === 0 ? null : `offset:${page.requestedOffset}`,
      nextPageSignalAfter: hasNext ? `offset:${nextOffset}` : null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(page.response.body, "utf8")).sha256,
      termination: page.total === 0 ? "EMPTY_PAGE" : hasNext ? "CONTINUE" : "DECLARED_TOTAL_REACHED",
      anomalyCodes: [],
      capturedAt: page.response.capturedAt
    };
  });
  const declarationArtifact = workdayArtifacts[0];
  if (!declarationArtifact) throw new MsdSourceError("MSD_WORKDAY_PAGE_MISSING");
  const rawCount = capture.workdayPages.reduce((sum, page) => sum + page.records.length, 0);
  if (rawCount !== validIds.size) {
    throw new MsdSourceError("MSD_RECONCILIATION_OUTPUT_MISMATCH");
  }
  const rawEvidence = parsePersistentSourceFetchEvidence({
    captureTool: { name: "msd-dual-official-http", version: "1" },
    artifacts: [entryArtifact, preflightArtifact, ...workdayArtifacts, ...workdayDetailArtifacts,
      ...phenomArtifacts, ...phenomOnlyDetailArtifacts],
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
      validCount: rawCount,
      parseDiscardCount: 0,
      validationDiscardCount: 0
    },
    fetchLosses: []
  });
  const evidence = deriveCanonicalPaginationEvidence({
    evidence: rawEvidence,
    expectedChannelIds: [],
    filteredOutput: true,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
  });
  const evaluation = evaluatePaginationEvidence({
    evidence,
    expectedChannelIds: [],
    filteredOutput: true,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
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

function msdJsonGetRequest(url: string, referer: string): MsdDualOfficialHttpRequest {
  return {
    url,
    method: "GET",
    headers: {
      Accept: "application/json",
      Referer: referer,
      "User-Agent": "job-search-crawler/0.1"
    }
  };
}

function safeMsdWorkdayDetailUrl(origin: string, externalPath: string): string | undefined {
  try {
    const originUrl = new URL(origin);
    const url = new URL(`/wday/cxs/msd/SearchJobs${externalPath}`, originUrl.origin);
    return originUrl.protocol === "https:" && externalPath.startsWith("/job/") &&
      !externalPath.includes("?") && !externalPath.includes("#") && url.origin === originUrl.origin
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function safeMsdPhenomApplyDetailUrl(origin: string, applyUrl: string): string | undefined {
  try {
    const originUrl = new URL(origin);
    const apply = new URL(applyUrl);
    if (originUrl.protocol !== "https:" || apply.origin !== originUrl.origin || apply.username ||
      apply.password || apply.search || apply.hash) return undefined;
    const segments = apply.pathname.split("/");
    if (segments.at(-1) === "") segments.pop();
    if (segments[0] !== "") return undefined;
    const searchJobsIndex = segments[1] === "SearchJobs" ? 1 :
      /^[A-Za-z]{2}-[A-Za-z]{2}$/u.test(segments[1] ?? "") && segments[2] === "SearchJobs" ? 2 : -1;
    const jobSegments = searchJobsIndex >= 0 ? segments.slice(searchJobsIndex + 2, -1) : [];
    if (segments[searchJobsIndex + 1] !== "job" || segments.at(-1) !== "apply" ||
      jobSegments.length < 2 || jobSegments.some((segment) =>
        segment.length === 0 || segment === "." || segment === ".." || /^apply$/iu.test(segment) ||
        /\\/u.test(segment) || /%(?:25|2e|2f|5c)/iu.test(segment))) return undefined;
    return safeMsdWorkdayDetailUrl(originUrl.origin, `/job/${jobSegments.join("/")}`);
  } catch {
    return undefined;
  }
}

function hasExactMsdMediaType(contentType: string, expectedContentType: "text/html" | "application/json"): boolean {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === expectedContentType;
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
  const validated = validateMsdResponseMetadata(request, response, fallbackCapturedAt, expectedContentType);
  if (validated.status !== 200) {
    throw new MsdSourceError(
      "MSD_HTTP_RESPONSE_INVALID",
      retryableHttpTransportFailure(validated.status)
    );
  }
  return validated;
}

function validateMsdResponseMetadata(
  request: MsdDualOfficialHttpRequest,
  response: MsdDualOfficialHttpResponse,
  fallbackCapturedAt: string,
  expectedContentType: "text/html" | "application/json"
): MsdValidatedResponse {
  const finalUrl = response.finalUrl ?? request.url;
  const contentType = response.contentType ?? "";
  const capturedAt = response.capturedAt ?? fallbackCapturedAt;
  if (
    finalUrl !== request.url || response.body.trim().length === 0 ||
    !hasExactMsdMediaType(contentType, expectedContentType) ||
    !Number.isFinite(Date.parse(capturedAt)) ||
    !safeHttpsUrl(request.url) || !safeHttpsUrl(finalUrl)
  ) throw new MsdSourceError("MSD_HTTP_RESPONSE_INVALID");
  return { status: response.status, body: response.body, finalUrl, contentType, capturedAt };
}

function validateMsdPhenomOnlyDetailResponse(
  request: MsdDualOfficialHttpRequest,
  response: MsdDualOfficialHttpResponse,
  fallbackCapturedAt: string,
  officialId: string
): { response: MsdValidatedResponse; closureProof?: MsdPhenomOnlyClosureProof } {
  const validated = validateMsdResponseMetadata(request, response, fallbackCapturedAt, "application/json");
  const transportFailure = retryableHttpTransportFailure(validated.status);
  if (transportFailure) {
    throw new MsdSourceError("MSD_HTTP_RESPONSE_INVALID", transportFailure);
  }
  if (validated.status !== 403) return { response: validated };
  let root: Record<string, unknown> | undefined;
  try { root = strictJsonRecord(validated.body, "MSD_PHENOM_ONLY_DETAIL_INVALID"); }
  catch { return { response: validated }; }
  const exactClosure = isExactMsdClosedDetail(root);
  return {
    response: validated,
    ...(exactClosure ? {
      closureProof: { officialId, status: 403 as const, errorCode: "S22" as const }
    } : {})
  };
}

function isExactMsdClosedDetail(root: Record<string, unknown>): boolean {
  const messageParams = root.messageParams;
  return Object.keys(root).sort(compareUtf8).join("\u0000") ===
      ["errorCaseId", "errorCode", "httpStatus", "locale", "message", "messageParams"].sort(compareUtf8).join("\u0000") &&
    root.errorCode === "S22" && root.httpStatus === 403 && root.locale === "*" &&
    root.message === "permission denied" && typeof root.errorCaseId === "string" &&
    /^[A-Za-z0-9-]{1,64}$/u.test(root.errorCaseId) && isRecord(messageParams) &&
    Object.keys(messageParams).length === 0;
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

function deriveMsdWorkdayFacetSelection(value: unknown): { locationIds: string[] } {
  const groups = collectFacetGroups(value);
  const locationGroups = groups.filter((group) => group.facetParameter === "locations");
  const subtypeGroups = groups.filter((group) => group.facetParameter === "workerSubType");
  if (locationGroups.length !== 1 || subtypeGroups.length !== 1) {
    throw new MsdSourceError("MSD_WORKDAY_FACET_INVALID");
  }
  const locationValues = strictFacetValues(locationGroups[0]!.values);
  strictFacetValues(subtypeGroups[0]!.values);
  const locations = locationValues.filter((entry) => /^CHN\s*-/u.test(entry.descriptor));
  if (locations.length === 0 ||
    new Set(locations.map((entry) => entry.id)).size !== locations.length) {
    throw new MsdSourceError("MSD_WORKDAY_FACET_INVALID");
  }
  return {
    locationIds: locations.map((entry) => entry.id).sort(compareUtf8)
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
    match: "EXACT" | "PATH_PREFIX";
    allowsPagination?: true;
    allowsDeclaration?: true;
    allowsPositiveTotalDeclaration?: true;
  }>;
  allowPositiveOfficialTotalCountAfterAdapterReconciliation: true;
} | undefined {
  const config = exactMsdDualOfficialConfig(plan);
  if (!config) return undefined;
  return {
    urlRules: [
      { id: "profile-msd-entry", url: config.officialSearchUrl, match: "EXACT" },
      {
        id: "profile-msd-phenom",
        url: config.phenomWidgetUrl,
        match: "EXACT"
      },
      {
        id: "profile-msd-workday",
        url: config.workdayJobsUrl,
        match: "EXACT",
        allowsPagination: true,
        allowsDeclaration: true,
        allowsPositiveTotalDeclaration: true
      },
      {
        id: "profile-msd-workday-detail",
        url: `${config.allowedApplyOrigins[0]}/wday/cxs/msd/SearchJobs/job/`,
        match: "PATH_PREFIX"
      }
    ],
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
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
    const facetSelection = deriveMsdWorkdayFacetSelection(preflightRoot.facets);
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
    const workdayDetailArtifacts = evidence.artifacts
      .filter((artifact) => /^msd-workday-detail-\d{4}$/u.test(artifact.logicalKey))
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey, "en"));
    const phenomArtifacts = evidence.artifacts
      .filter((artifact) => /^msd-phenom-page-\d{4}$/u.test(artifact.logicalKey))
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey, "en"));
    const phenomOnlyDetailArtifacts = evidence.artifacts
      .filter((artifact) => /^msd-phenom-only-detail-\d{4}$/u.test(artifact.logicalKey))
      .sort((left, right) => left.logicalKey.localeCompare(right.logicalKey, "en"));
    if (workdayArtifacts.length === 0 || phenomArtifacts.length === 0 ||
      workdayArtifacts.length > config.maxPages || phenomArtifacts.length > config.maxPages ||
      evidence.artifacts.length !== 2 + workdayArtifacts.length + workdayDetailArtifacts.length +
        phenomArtifacts.length + phenomOnlyDetailArtifacts.length ||
      evidence.pages.length !== workdayArtifacts.length) return false;

    const appliedFacets = {
      locations: facetSelection.locationIds
    };
    const workdayRecords: Record<string, unknown>[] = [];
    const workdayPageRecords: Array<{
      artifact: PersistentSourceFetchEvidence["artifacts"][number];
      records: Record<string, unknown>[];
      total: number;
      offset: number;
      rawIds: string[];
    }> = [];
    let workdayTotal: number | undefined;
    for (let sequence = 0; sequence < workdayArtifacts.length; sequence += 1) {
      const artifact = workdayArtifacts[sequence]!;
      const offset = sequence * config.workdayPageSize;
      if (artifact.logicalKey !== `msd-workday-page-${String(sequence).padStart(4, "0")}` ||
        !strictMsdNetworkArtifact(artifact, "PAGINATION_PAGE", config.workdayJobsUrl) ||
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
      workdayPageRecords.push({ artifact, records, total, offset, rawIds: ids as string[] });
      workdayRecords.push(...records);
    }
    if (workdayTotal === undefined || workdayRecords.length !== workdayTotal) return false;

    const phenomRecords: Record<string, unknown>[] = [];
    let phenomTotal: number | undefined;
    for (let sequence = 0; sequence < phenomArtifacts.length; sequence += 1) {
      const artifact = phenomArtifacts[sequence]!;
      const offset = sequence * config.pageSize;
      if (artifact.logicalKey !== `msd-phenom-page-${String(sequence).padStart(4, "0")}` ||
        !strictMsdNetworkArtifact(artifact, "ATS_API_RESPONSE", config.phenomWidgetUrl) ||
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
      phenomRecords.push(...envelope.records);
    }
    if (phenomTotal === undefined || phenomRecords.length !== phenomTotal) return false;

    const phenomIds = new Set(phenomRecords.map((record) => stringField(record, "reqId")));
    const expectedWorkdayOnly = workdayRecords
      .map((record) => ({ record, officialId: workdayOfficialId(record) }))
      .filter((item): item is { record: Record<string, unknown>; officialId: string } =>
        item.officialId !== undefined && !phenomIds.has(item.officialId))
      .sort((left, right) => compareUtf8(left.officialId, right.officialId));
    if (expectedWorkdayOnly.length !== workdayDetailArtifacts.length) return false;
    const workdayDetailRecords: Record<string, unknown>[] = [];
    for (let sequence = 0; sequence < workdayDetailArtifacts.length; sequence += 1) {
      const artifact = workdayDetailArtifacts[sequence]!;
      const expected = expectedWorkdayOnly[sequence]!;
      const externalPath = stringField(expected.record, "externalPath");
      const detailUrl = externalPath
        ? safeMsdWorkdayDetailUrl(config.allowedApplyOrigins[0], externalPath)
        : undefined;
      if (!detailUrl ||
        artifact.logicalKey !== `msd-workday-detail-${String(sequence).padStart(4, "0")}` ||
        !strictMsdNetworkArtifact(artifact, "ATS_API_RESPONSE", detailUrl) ||
        typeof artifact.body !== "string" ||
        !requestContractV2Matches(artifact.extractorLocator, {
          family: "workday",
          role: "detail-corroboration",
          method: "GET",
          url: detailUrl,
          body: null,
          coordinate: { sequence, officialId: expected.officialId }
        })) return false;
      workdayDetailRecords.push(strictJsonRecord(artifact.body, "MSD_WORKDAY_DETAIL_INVALID"));
    }

    const workdayIds = new Set(workdayRecords.map(workdayOfficialId).filter(
      (id): id is string => id !== undefined
    ));
    const expectedPhenomOnly = phenomRecords
      .map((record) => ({ record, officialId: stringField(record, "reqId") }))
      .filter((item): item is { record: Record<string, unknown>; officialId: string } =>
        item.officialId !== undefined && !workdayIds.has(item.officialId) &&
        !isVerifiedTestPlaceholder(item.record, item.officialId))
      .sort((left, right) => compareUtf8(left.officialId, right.officialId));
    if (expectedPhenomOnly.length !== phenomOnlyDetailArtifacts.length) return false;
    const phenomOnlyClosureProofs: MsdPhenomOnlyClosureProof[] = [];
    for (let sequence = 0; sequence < phenomOnlyDetailArtifacts.length; sequence += 1) {
      const artifact = phenomOnlyDetailArtifacts[sequence]!;
      const expected = expectedPhenomOnly[sequence]!;
      const applyUrl = stringField(expected.record, "applyUrl");
      const detailUrl = applyUrl
        ? safeMsdPhenomApplyDetailUrl(config.allowedApplyOrigins[0], applyUrl)
        : undefined;
      if (!detailUrl ||
        artifact.logicalKey !== `msd-phenom-only-detail-${String(sequence).padStart(4, "0")}` ||
        !strictMsdClosedDetailArtifact(artifact, detailUrl) ||
        typeof artifact.body !== "string" ||
        !requestContractV2Matches(artifact.extractorLocator, {
          family: "workday",
          role: "closed-detail-corroboration",
          method: "GET",
          url: detailUrl,
          body: null,
          coordinate: { sequence, officialId: expected.officialId }
        })) return false;
      const root = strictJsonRecord(artifact.body, "MSD_PHENOM_ONLY_DETAIL_INVALID");
      if (!isExactMsdClosedDetail(root)) return false;
      phenomOnlyClosureProofs.push({
        officialId: expected.officialId,
        status: 403,
        errorCode: "S22"
      });
    }

    const reconciled = reconcileMsdOfficialSets({
      workdayRecords,
      phenomRecords,
      workdayDetailRecords,
      phenomOnlyClosureProofs,
      officialDetailBaseUrl: config.officialDetailBaseUrl,
      allowedApplyOrigins: config.allowedApplyOrigins
    });
    if (!reconciled.ok) return false;
    const validIds = new Set(reconciled.jobs.map((job) => job.officialId));
    for (let sequence = 0; sequence < workdayPageRecords.length; sequence += 1) {
      const page = workdayPageRecords[sequence]!;
      const trace = evidence.pages[sequence];
      const validPageIds = page.rawIds.filter((id) => validIds.has(id));
      if (validPageIds.length !== page.rawIds.length) return false;
      const nextOffset = page.offset + page.records.length;
      const hasNext = nextOffset < page.total;
      if (!trace ||
        trace.sequence !== sequence || trace.artifactLogicalKey !== page.artifact.logicalKey ||
        trace.requestedOffset !== page.offset || trace.returnedOffset !== null ||
        trace.requestedCursor !== null || trace.returnedCursor !== null ||
        trace.requestedPage !== null || trace.returnedPage !== null ||
        trace.requestedPageSize !== config.workdayPageSize ||
        trace.returnedPageSize !== null ||
        JSON.stringify(trace.rawJobIds) !== JSON.stringify(page.rawIds) ||
        JSON.stringify(trace.validJobIds) !== JSON.stringify(validPageIds) ||
        trace.declaredTotal !== page.total || trace.declaredCount !== null ||
        trace.declaredPages !== Math.ceil(page.total / config.workdayPageSize) ||
        trace.nextPageSignalBefore !== (page.offset === 0 ? null : `offset:${page.offset}`) ||
        trace.nextPageSignalAfter !== (hasNext ? `offset:${nextOffset}` : null) ||
        trace.termination !== (page.total === 0 ? "EMPTY_PAGE" : hasNext ? "CONTINUE" : "DECLARED_TOTAL_REACHED") ||
        typeof page.artifact.body !== "string" ||
        trace.responseFingerprintSha256 !== sha256Bytes(Buffer.from(page.artifact.body, "utf8")).sha256 ||
        trace.capturedAt !== page.artifact.capturedAt || trace.anomalyCodes.length !== 0
      ) return false;
    }
    const declaration = evidence.declaredCompleteness;
    if (
      declaration?.kind !== "OFFICIAL_TOTAL_COUNT" || declaration.scope !== "SOURCE" ||
      declaration.channelId !== undefined || declaration.value !== workdayTotal ||
      declaration.artifactLogicalKey !== workdayArtifacts[0]!.logicalKey ||
      declaration.extractorLocator !== workdayArtifacts[0]!.extractorLocator ||
      evidence.fetchCounts.rawCount !== workdayTotal ||
      evidence.fetchCounts.parsedCount !== workdayTotal ||
      evidence.fetchCounts.validCount !== reconciled.jobs.length ||
      evidence.fetchCounts.validationDiscardCount !== 0 || evidence.fetchLosses.length !== 0 ||
      reconciled.jobs.length !== workdayTotal
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
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
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
      ? hasExactMsdMediaType(artifact.contentType ?? "", "text/html")
      : hasExactMsdMediaType(artifact.contentType ?? "", "application/json"));
}

function strictMsdClosedDetailArtifact(
  artifact: PersistentSourceFetchEvidence["artifacts"][number],
  url: string
): boolean {
  return artifact.kind === "ATS_API_RESPONSE" && artifact.requestedUrl === url && artifact.finalUrl === url &&
    artifact.httpStatus === 403 && artifact.bodyRepresentation === "EXACT" &&
    typeof artifact.body === "string" && artifact.body.trim().length > 0 &&
    Number.isFinite(Date.parse(artifact.capturedAt)) &&
    hasExactMsdMediaType(artifact.contentType ?? "", "application/json");
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

function safeMsdFailureCode(error: unknown, stage: MsdFailureStage): string {
  if (error instanceof MsdSourceError && isSafeMsdDualOfficialFailureCode(error.code)) return error.code;
  return `MSD_${stage}_FETCH_FAILED`;
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
