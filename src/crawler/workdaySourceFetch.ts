import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import { fetchWithOfficialTimeout } from "./officialHttpRuntimeLimits";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import {
  parsePersistentSourceFetchEvidence,
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";
import {
  retryableHttpTransportFailure,
  retryableTransportFailureFromError,
  safeSourceTransportFailureReason,
  type SourceTransportFailure
} from "./sourceFetchFailure";

export interface WorkdayFetchConfig {
  tenant: string;
  site: string;
  searchText?: string;
  appliedFacets?: Record<string, readonly string[]>;
  facetDescriptorExclusions?: readonly WorkdayFacetDescriptorExclusion[];
  facetDescriptorBoundary?: WorkdayFacetDescriptorBoundary;
  laterZeroTotalPolicy?: WorkdayLaterZeroTotalPolicy;
  locationFacetPolicy?: WorkdayLocationFacetPolicy;
  opaqueMultiLocationDetailPolicy?: WorkdayOpaqueMultiLocationDetailPolicy;
  pageSize?: number;
  maxPages?: number;
  cityHints?: Record<string, readonly string[]>;
}

export type WorkdayOpaqueMultiLocationDetailPolicy =
  | "JNJ_AUDITED_CHINA_DETAIL_V1"
  | "MSD_AUDITED_CHINA_DETAIL_V1"
  | "PFIZER_AUDITED_APAC_DETAIL_V1";

export type WorkdayLaterZeroTotalPolicy =
  | "PFIZER_AUDITED_EXACT_RECONCILIATION"
  | "AMGEN_AUDITED_EXACT_RECONCILIATION"
  | "BMS_AUDITED_EXACT_RECONCILIATION";

export type WorkdayLocationFacetPolicy =
  | {
      kind: "JNJ_AUDITED_LOCATIONS_OVERLAP";
      facetParameter: "locations";
      mainlandDescriptorAliases: readonly string[];
      foreignDescriptorAliases: readonly string[];
    }
  | {
      kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP";
      facetParameter: "locations";
      foreignDescriptorAliases: readonly string[];
    }
  | {
      kind: "MSD_AUDITED_NON_CHINA_DUPLICATE_DESCRIPTORS";
      facetParameter: "locations";
      allowedDuplicateDescriptors: readonly string[];
    }
  | {
      kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST";
      facetParameter: "locationHierarchy2";
      foreignSiteDescriptorAliases: readonly string[];
      foreignCountryDescriptorAliases: readonly string[];
    };

export interface WorkdayFacetDescriptorExclusion {
  facetParameter: string;
  excludedDescriptors: readonly string[];
}

export interface WorkdayFacetDescriptorBoundary {
  facetParameter: string;
  allowedDescriptors: readonly string[];
  excludedDescriptors?: readonly string[];
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

export interface WorkdayDetailHttpRequest {
  url: string;
  method: "GET";
  headers: Record<string, string>;
}

export type WorkdayDetailHttpClient = (request: WorkdayDetailHttpRequest) => Promise<WorkdayHttpResponse>;

export interface WorkdaySourceFetchDeps {
  http?: WorkdayHttpClient;
  detailHttp?: WorkdayDetailHttpClient;
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
  userAuthenticated?: unknown;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 20;
const PFIZER_LATER_ZERO_TOTAL_POLICY = "PFIZER_AUDITED_EXACT_RECONCILIATION";
const AMGEN_LATER_ZERO_TOTAL_POLICY = "AMGEN_AUDITED_EXACT_RECONCILIATION";
const BMS_LATER_ZERO_TOTAL_POLICY = "BMS_AUDITED_EXACT_RECONCILIATION";
const AUDITED_CHINA_LOCATION_ID = "6cb77610a8a543aea2d6bc10457e35d4";
const MSD_AUDITED_DUPLICATE_DESCRIPTOR = "IND - Telangana - Hyderabad";
export const BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES = [
  "AZ01 PSA Celgene - Phoenix - AZ",
  "CA06 PSA Celgene - San Diego Science Park - CA",
  "CA09 PSA Celgene - Los Angeles - CA",
  "CA10 PSA - Brisbane - CA",
  "CA14 San Diego Morehouse",
  "IN05 Indianapolis 80th Street",
  "MA01 PSA Cambridge Crossing - MA",
  "MD01 PSA Bethesda - FL",
  "NJ05 PSA New Brunswick - NJ",
  "NJ06 PSA Princeton LVL - NJ",
  "NJ09 PSA Princeton Pike - NJ",
  "NJ13 PSA Plainsboro - NJ",
  "NJ16 PSA Madison - Giralda Farms - NJ",
  "US99 PSA Field - United States",
  "WA04 PSA Celgene - Seattle Dexter Avenue - WA"
] as const;
export const BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES = [
  "Korea, Republic Of",
  "United Kingdom (GB)"
] as const;
export const JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES = [
  "CN002 Beijing Jianguo Road",
  "CN008 Chengdu Zong Fu Rd",
  "CN009 Chongqing Zourong Rd",
  "CN016 Harbin",
  "CN019 Jinan Shanda Rd",
  "CN027 Shanghai Gui Qing Rd",
  "CN038 Suzhou Changyang Rd",
  "CN043 Wuhan TaiHe Plaza",
  "CN046 Zhengzhou"
] as const;
export const JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES = [
  "Alaska (Any City)",
  "Arizona (Any City)",
  "California (Any City)",
  "Colorado (Any City)",
  "Connecticut (Any City)",
  "Delaware (Any City)",
  "Florida (Any City)",
  "Georgia (Any City)",
  "Idaho (Any City)",
  "Indiana (Any City)",
  "Kentucky (Any City)",
  "Louisiana (Any City)",
  "Maine (Any City)",
  "Maryland (Any City)",
  "Massachusetts (Any City)",
  "Michigan (Any City)",
  "Mississippi (Any City)",
  "Montana (Any City)",
  "Nevada (Any City)",
  "New Hampshire (Any City)",
  "New Jersey (Any City)",
  "New Mexico (Any City)",
  "New York (Any City)",
  "North Carolina (Any City)",
  "North Dakota (Any City)",
  "Ohio (Any City)",
  "Oregon (Any City)",
  "Pennsylvania (Any City)",
  "Rhode Island (Any City)",
  "South Carolina (Any City)",
  "South Dakota (Any City)",
  "Utah (Any City)",
  "Vermont (Any City)",
  "Virginia (Any City)",
  "Washington (Any City)",
  "West Virginia (Any City)",
  "Wisconsin (Any City)",
  "Wyoming (Any City)",
  "Albany, New York, United States of America",
  "Boston, Massachusetts, United States of America",
  "Cambridge, Massachusetts, United States of America",
  "Cincinnati, Ohio, United States of America",
  "Colorado Springs, Colorado, United States of America",
  "Danvers, Massachusetts, United States of America",
  "El Paso, Texas, United States of America",
  "Gurabo, Puerto Rico, United States of America",
  "Horsham, Pennsylvania, United States of America",
  "Houston, Texas, United States of America",
  "Irvine, California, United States of America",
  "Irving, Texas, United States of America",
  "Jacksonville, Florida, United States of America",
  "La Jolla, California, United States of America",
  "Los Angeles, California, United States of America",
  "Malvern, Pennsylvania, United States of America",
  "Miami, Florida, United States of America",
  "Minneapolis, Minnesota, United States of America",
  "New Brighton, Minnesota, United States of America",
  "Orlando, Florida, United States of America",
  "Palm Beach Gardens, Florida, United States of America",
  "Providence, Rhode Island, United States of America",
  "Raritan, New Jersey, United States of America",
  "Raynham, Massachusetts, United States of America",
  "Richmond, Virginia, United States of America",
  "Sacramento, California, United States of America",
  "Salt Lake City, Utah, United States of America",
  "SAN ANTONIO, Texas, United States of America",
  "San Diego, California, United States of America",
  "San Francisco, California, United States of America",
  "San Jose, California, United States of America",
  "Santa Clara, California, United States of America",
  "Seattle, Washington, United States of America",
  "South San Francisco, California, United States of America",
  "Spring House, Pennsylvania, United States of America",
  "Tampa, Florida, United States of America",
  "Titusville, New Jersey, United States of America",
  "Warsaw, Indiana, United States of America",
  "Washington, District of Columbia, United States of America",
  "West Chester, Pennsylvania, United States of America",
  "CZ005 Walterovo Namesti",
  "DK005 Copenhagen",
  "FI001 Espoo",
  "FR015 Rungis",
  "GB019 Bessemer",
  "GB025 ACT London, UK",
  "IE006 Airton",
  "IE009 Janssen Cilag Ltd",
  "IT002 Milano",
  "IT004 Pratica di Mare   Pomezia",
  "NL017 Roden",
  "NO001 Oslo",
  "SE007 Stockholm",
  "Ankara, Turkey",
  "Istanbul, Turkey",
  "Remote (US)",
  "Seoul, Korea, Republic of",
  "Alabama (Any City)",
  "Albuquerque, New Mexico, United States of America",
  "Arkansas (Any City)",
  "Bridgewater, Massachusetts, United States of America",
  "Copenhagen",
  "Hawaii (Any City)",
  "Horseheads, New York, United States of America",
  "Huntington Beach, California, United States of America",
  "Illinois (Any City)",
  "IN004 Bangalore",
  "IN014 Mumbai Mahim",
  "IN018 Gurgaon",
  "Incheon, Korea, Republic of",
  "Iowa (Any City)",
  "JP007 Tokyo J&J Headquarter",
  "JP162 Osaka Osaka",
  "Kansas (Any City)",
  "Los Gatos, California, United States of America",
  "Madrid - Lafinca",
  "Memphis, Tennessee, United States of America",
  "Milpitas, California, United States of America",
  "Minnesota (Any City)",
  "Missouri (Any City)",
  "Mooresville, Indiana, United States of America",
  "Mountain View, California, United States of America",
  "MX301 – Circuito Interior Norte - BWI",
  "Nebraska (Any City)",
  "New Brunswick, New Jersey, United States of America",
  "Oklahoma (Any City)",
  "Redwood City, California, United States of America",
  "Roanoke, Virginia, United States of America",
  "San Angelo, Texas, United States of America",
  "Santa Ana, California, United States of America",
  "Shepherdsville, Kentucky, United States of America",
  "Somerset, New Jersey, United States of America",
  "Somerville, New Jersey, United States of America",
  "Tamaulipas (Any City)",
  "Tennessee (Any City)",
  "Texas (Any City)",
  "US345  MA Danvers - 22 Cherry Hill Dr",
  "US356 CA Santa Clara - 5303 Betsy Ross Drive",
  "Wilson, North Carolina, United States of America",
  "Alberta (Any City)",
  "Bridgewater, New Jersey, United States of America",
  "Busan, Korea, Republic of",
  "GIMPO-SI, Korea, Republic of",
  "Pittsburgh, Pennsylvania, United States of America",
  "Trenton, New Jersey, United States of America",
  "Uşak",
  "Lancaster, Pennsylvania, United States of America"
] as const;
export const GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES = [
  "Czech Republic - Prague",
  "UAE - Dubai",
  "United States – Remote"
] as const;
const WORKDAY_PAGINATION_AUTHORITY_KEYS = new Set([
  "total",
  "totalcount",
  "jobpostings",
  "offset",
  "limit",
  "page",
  "pagenumber",
  "pagesize",
  "totalpages",
  "next",
  "nextpage",
  "hasnext"
]);

interface ResolvedWorkdayLocationFacetPolicy {
  facetParameter: string;
  allowOverlappingCounts: boolean;
  allowedDuplicateDescriptors: readonly string[];
  mainlandDescriptorAliases: readonly string[];
  allowedForeignDescriptors: readonly string[];
  allowedForeignSiteDescriptors: readonly string[];
  allowedForeignCountryDescriptors: readonly string[];
  requireUniqueMainlandCountryLeaf: boolean;
}

interface WorkdaySelectedLocation {
  id: string;
  descriptor: string;
}

interface ResolvedWorkdayOpaqueMultiLocationDetailPolicy {
  kind: WorkdayOpaqueMultiLocationDetailPolicy;
}

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

function allowsAuditedLaterZeroTotalPolicy(sourceId: string, config: WorkdayFetchConfig): boolean {
  if (config.laterZeroTotalPolicy === PFIZER_LATER_ZERO_TOTAL_POLICY) {
    return sourceId === "source-pfizer-china-social" &&
      config.tenant === "pfizer" &&
      config.site === "PfizerCareers" &&
      hasExactSingleAppliedFacet(config.appliedFacets, "Location_Country", AUDITED_CHINA_LOCATION_ID);
  }
  if (config.laterZeroTotalPolicy === AMGEN_LATER_ZERO_TOTAL_POLICY) {
    return sourceId === "source-amgen-china-social" &&
      config.tenant === "amgen" &&
      config.site === "Careers" &&
      hasExactSingleAppliedFacet(config.appliedFacets, "LocationCountry", AUDITED_CHINA_LOCATION_ID);
  }
  if (config.laterZeroTotalPolicy === BMS_LATER_ZERO_TOTAL_POLICY) {
    const locationPolicy = config.locationFacetPolicy;
    const workerBoundary = config.facetDescriptorBoundary;
    return sourceId === "source-bms-china-social" &&
      config.tenant === "bristolmyerssquibb" &&
      config.site === "BMS" &&
      config.searchText === "China" &&
      Object.keys(config.appliedFacets ?? {}).length === 0 &&
      locationPolicy?.kind === "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST" &&
      locationPolicy.facetParameter === "locationHierarchy2" &&
      exactStringArray(locationPolicy.foreignSiteDescriptorAliases, BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES) &&
      exactStringArray(locationPolicy.foreignCountryDescriptorAliases, BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES) &&
      workerBoundary?.facetParameter === "workerSubType" &&
      exactStringArray(workerBoundary.allowedDescriptors, ["Fixed Term (Fixed Term)", "Permanent"]) &&
      workerBoundary.excludedDescriptors === undefined;
  }
  return false;
}

function resolveAuditedLocationFacetPolicy(
  sourceId: string,
  config: WorkdayFetchConfig
): ResolvedWorkdayLocationFacetPolicy | undefined {
  const policy = config.locationFacetPolicy;
  if (!policy || config.searchText !== "China" || hasConfiguredLocationFacet(config.appliedFacets ?? {})) {
    return undefined;
  }

  if (
    policy.kind === "JNJ_AUDITED_LOCATIONS_OVERLAP" &&
    policy.facetParameter === "locations" &&
    exactStringArray(policy.mainlandDescriptorAliases, JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES) &&
    exactStringArray(policy.foreignDescriptorAliases, JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES) &&
    sourceId === "source-johnson-innovative-medicine-social" &&
    config.tenant === "jj" &&
    config.site === "JJ"
  ) {
    return {
      facetParameter: "locations",
      allowOverlappingCounts: true,
      allowedDuplicateDescriptors: [],
      mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
      allowedForeignDescriptors: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES,
      allowedForeignSiteDescriptors: [],
      allowedForeignCountryDescriptors: [],
      requireUniqueMainlandCountryLeaf: false
    };
  }
  if (
    policy.kind === "GILEAD_AUDITED_LOCATIONS_OVERLAP" &&
    policy.facetParameter === "locations" &&
    exactStringArray(policy.foreignDescriptorAliases, GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES) &&
    sourceId === "source-gilead-china-social" &&
    config.tenant === "gilead" &&
    config.site === "gileadcareers"
  ) {
    return {
      facetParameter: "locations",
      allowOverlappingCounts: true,
      allowedDuplicateDescriptors: [],
      mainlandDescriptorAliases: [],
      allowedForeignDescriptors: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES,
      allowedForeignSiteDescriptors: [],
      allowedForeignCountryDescriptors: [],
      requireUniqueMainlandCountryLeaf: false
    };
  }
  if (
    policy.kind === "MSD_AUDITED_NON_CHINA_DUPLICATE_DESCRIPTORS" &&
    policy.facetParameter === "locations" &&
    exactStringArray(policy.allowedDuplicateDescriptors, [MSD_AUDITED_DUPLICATE_DESCRIPTOR]) &&
    sourceId === "source-msd-china-social" &&
    config.tenant === "msd" &&
    config.site === "SearchJobs"
  ) {
    return {
      facetParameter: "locations",
      allowOverlappingCounts: true,
      allowedDuplicateDescriptors: [MSD_AUDITED_DUPLICATE_DESCRIPTOR],
      mainlandDescriptorAliases: [],
      allowedForeignDescriptors: [],
      allowedForeignSiteDescriptors: [],
      allowedForeignCountryDescriptors: [],
      requireUniqueMainlandCountryLeaf: false
    };
  }
  if (
    policy.kind === "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST" &&
    policy.facetParameter === "locationHierarchy2" &&
    exactStringArray(policy.foreignSiteDescriptorAliases, BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES) &&
    exactStringArray(policy.foreignCountryDescriptorAliases, BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES) &&
    sourceId === "source-bms-china-social" &&
    config.tenant === "bristolmyerssquibb" &&
    config.site === "BMS"
  ) {
    return {
      facetParameter: "locationHierarchy2",
      allowOverlappingCounts: true,
      allowedDuplicateDescriptors: [],
      mainlandDescriptorAliases: [],
      allowedForeignDescriptors: [],
      allowedForeignSiteDescriptors: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
      allowedForeignCountryDescriptors: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES,
      requireUniqueMainlandCountryLeaf: true
    };
  }
  return undefined;
}

function resolveOpaqueMultiLocationDetailPolicy(
  sourceId: string,
  config: WorkdayFetchConfig,
  auditedLocationFacetPolicy: ResolvedWorkdayLocationFacetPolicy | undefined
): ResolvedWorkdayOpaqueMultiLocationDetailPolicy | undefined {
  const kind = config.opaqueMultiLocationDetailPolicy;
  if (!kind) {
    return undefined;
  }
  if (kind === "PFIZER_AUDITED_APAC_DETAIL_V1") {
    const workerBoundary = config.facetDescriptorBoundary;
    if (
      sourceId === "source-pfizer-china-social" &&
      config.tenant === "pfizer" &&
      config.site === "PfizerCareers" &&
      config.searchText === undefined &&
      config.locationFacetPolicy === undefined &&
      (config.facetDescriptorExclusions?.length ?? 0) === 0 &&
      config.laterZeroTotalPolicy === PFIZER_LATER_ZERO_TOTAL_POLICY &&
      hasExactSingleAppliedFacet(config.appliedFacets, "Location_Country", AUDITED_CHINA_LOCATION_ID) &&
      workerBoundary?.facetParameter === "workerSubType" &&
      exactStringArray(workerBoundary.allowedDescriptors, ["Regular"]) &&
      workerBoundary.excludedDescriptors === undefined
    ) {
      return { kind };
    }
    return undefined;
  }
  if (!auditedLocationFacetPolicy || config.searchText !== "China" || hasConfiguredLocationFacet(config.appliedFacets ?? {})) {
    return undefined;
  }
  if (
    kind === "JNJ_AUDITED_CHINA_DETAIL_V1" &&
    sourceId === "source-johnson-innovative-medicine-social" &&
    config.tenant === "jj" &&
    config.site === "JJ" &&
    auditedLocationFacetPolicy.facetParameter === "locations"
  ) {
    return { kind };
  }
  if (
    kind === "MSD_AUDITED_CHINA_DETAIL_V1" &&
    sourceId === "source-msd-china-social" &&
    config.tenant === "msd" &&
    config.site === "SearchJobs" &&
    auditedLocationFacetPolicy.facetParameter === "locations" &&
    exactStringArray(auditedLocationFacetPolicy.allowedDuplicateDescriptors, [MSD_AUDITED_DUPLICATE_DESCRIPTOR])
  ) {
    return { kind };
  }
  return undefined;
}

function hasExactSingleAppliedFacet(
  appliedFacets: Record<string, readonly string[]> | undefined,
  facetParameter: string,
  expectedId: string
): boolean {
  const entries = Object.entries(appliedFacets ?? {});
  return entries.length === 1 && entries[0]![0] === facetParameter &&
    exactStringArray(entries[0]![1], [expectedId]);
}

function exactStringArray(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

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

    const allowsAuditedLaterZeroTotal = allowsAuditedLaterZeroTotalPolicy(plan.source.id, plan.workday);
    if (plan.workday.laterZeroTotalPolicy !== undefined && !allowsAuditedLaterZeroTotal) {
      return failed(capturedAt, `Workday later-zero total policy is not allowed for source ${plan.source.id}`);
    }
    const auditedLocationFacetPolicy = resolveAuditedLocationFacetPolicy(plan.source.id, plan.workday);
    if (plan.workday.locationFacetPolicy !== undefined && !auditedLocationFacetPolicy) {
      return failed(capturedAt, `Workday location facet policy is not allowed for source ${plan.source.id}`);
    }
    const opaqueMultiLocationDetailPolicy = resolveOpaqueMultiLocationDetailPolicy(
      plan.source.id,
      plan.workday,
      auditedLocationFacetPolicy
    );
    if (plan.workday.opaqueMultiLocationDetailPolicy !== undefined && !opaqueMultiLocationDetailPolicy) {
      return failed(capturedAt, `Workday opaque multi-location detail policy is not allowed for source ${plan.source.id}`);
    }

    try {
      const http = deps.http ?? defaultWorkdayHttpClient;
      const detailHttp = deps.detailHttp ?? (deps.http ? undefined : defaultWorkdayDetailHttpClient);
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
      const facetDescriptorExclusions = plan.workday.facetDescriptorExclusions ?? [];
      const facetDescriptorBoundary = plan.workday.facetDescriptorBoundary;
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
      let derivedFilteredTotal: number | undefined;
      let locationDerivedTotal: number | undefined;
      let sawLaterZeroTotal = false;
      let strictLaterZeroPageEnvelopes = true;
      let firstPaginationEnvelopeFingerprint: string | undefined;
      let selectedMainlandLocations: readonly WorkdaySelectedLocation[] = [];

      const needsLocationFacetDiscovery = !hasConfiguredLocationFacet(configuredAppliedFacets) && Boolean(searchText);
      if (needsLocationFacetDiscovery) {
        const preflightRequest = workdayJobsRequest({
          url,
          origin,
          referer: plan.source.officialEntryUrl,
          appliedFacets,
          searchText: undefined,
          pageSize,
          offset: 0
        });
        const preflight = await http(preflightRequest);
        if (preflight.status < 200 || preflight.status >= 300) {
          const transportFailure = retryableHttpTransportFailure(preflight.status);
          return failed(capturedAt, transportFailure
            ? safeSourceTransportFailureReason(transportFailure)
            : `Workday jobs API returned HTTP ${preflight.status}`, undefined, undefined, transportFailure);
        }
        assertEvidenceResponse(preflight);
        artifacts.push(workdayArtifact("workday-preflight-0000", "ATS_API_RESPONSE", url, preflight,
          requestContractV2Locator("$.facets", {
            family: "workday", role: "location-preflight", method: preflightRequest.method,
            url: preflightRequest.url, body: JSON.parse(preflightRequest.body),
            coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
          })));
        latestEvidence = workdaySupportingArtifactEvidence(artifacts, "FACET_DERIVATION_FAILED");
        const parsedPreflight = parseWorkdayJobsResponse(preflight.body);
        const discovery = chinaLocationAppliedFacets(
          parsedPreflight.facets,
          parsedPreflight.total,
          auditedLocationFacetPolicy
        );
        appliedFacets = { ...appliedFacets, ...discovery.appliedFacets };
        selectedMainlandLocations = discovery.selectedMainlandLocations;
        locationDerivedTotal = discovery.expectedFilteredTotal;
        derivedFilteredTotal = discovery.expectedFilteredTotal;
        searchText = undefined;
      }

      if (facetDescriptorExclusions.length > 0 || facetDescriptorBoundary) {
        if (facetDescriptorExclusions.length > 0 && facetDescriptorBoundary) {
          throw new Error("Workday facet boundary cannot combine allowlist and exclusion modes");
        }
        const facetPreflightRequest = workdayJobsRequest({
          url,
          origin,
          referer: plan.source.officialEntryUrl,
          appliedFacets,
          searchText: undefined,
          pageSize,
          offset: 0
        });
        const facetPreflight = await http(facetPreflightRequest);
        if (facetPreflight.status < 200 || facetPreflight.status >= 300) {
          const transportFailure = retryableHttpTransportFailure(facetPreflight.status);
          return failed(capturedAt, transportFailure
            ? safeSourceTransportFailureReason(transportFailure)
            : `Workday jobs API returned HTTP ${facetPreflight.status}`, undefined, undefined, transportFailure);
        }
        assertEvidenceResponse(facetPreflight);
        artifacts.push(workdayArtifact("workday-facet-preflight-0000", "ATS_API_RESPONSE", url, facetPreflight,
          requestContractV2Locator("$.facets", {
            family: "workday", role: "facet-preflight", method: facetPreflightRequest.method,
            url: facetPreflightRequest.url, body: JSON.parse(facetPreflightRequest.body),
            coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
          })));
        latestEvidence = workdaySupportingArtifactEvidence(artifacts, "FACET_DERIVATION_FAILED");
        const parsedFacetPreflight = parseWorkdayJobsResponse(facetPreflight.body);
        if (locationDerivedTotal !== undefined && parsedFacetPreflight.total !== locationDerivedTotal) {
          latestEvidence = workdaySupportingArtifactEvidence(artifacts, "FACET_FILTER_VALIDATION_FAILED");
          return failed(
            capturedAt,
            `Workday social facet preflight total ${String(parsedFacetPreflight.total)} did not match location-derived total ${locationDerivedTotal}`,
            latestEvidence
          );
        }
        const derivation = facetDescriptorBoundary
          ? deriveAllowedDescriptorAppliedFacet(
              parsedFacetPreflight.facets,
              facetDescriptorBoundary,
              appliedFacets,
              parsedFacetPreflight.total
            )
          : deriveDescriptorExcludedAppliedFacets(
              parsedFacetPreflight.facets,
              facetDescriptorExclusions,
              appliedFacets,
              parsedFacetPreflight.total
            );
        appliedFacets = { ...appliedFacets, ...derivation.appliedFacets };
        derivedFilteredTotal = derivation.expectedFilteredTotal;
        searchText = undefined;
      }

      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const offset = pageIndex * pageSize;
        const pageRequest = workdayJobsRequest({
          url,
          origin,
          referer: plan.source.officialEntryUrl,
          appliedFacets,
          searchText,
          pageSize,
          offset
        });
        const response = await http(pageRequest);

        if (response.status < 200 || response.status >= 300) {
          const transportFailure = retryableHttpTransportFailure(response.status);
          return failed(capturedAt, transportFailure
            ? safeSourceTransportFailureReason(transportFailure)
            : `Workday jobs API returned HTTP ${response.status}`, undefined, undefined, transportFailure);
        }

        assertEvidenceResponse(response);

        const parsed = parseWorkdayJobsResponse(response.body, {
          pageIndex,
          ...(allowsAuditedLaterZeroTotal && plan.workday.laterZeroTotalPolicy !== undefined
            ? {
                auditedLaterZeroPolicy: plan.workday.laterZeroTotalPolicy,
                auditedAppliedFacets: appliedFacets
              }
            : {})
        });
        if (pageIndex === 0) {
          firstPaginationEnvelopeFingerprint = parsed.paginationEnvelopeFingerprint;
        } else {
          strictLaterZeroPageEnvelopes = strictLaterZeroPageEnvelopes &&
            firstPaginationEnvelopeFingerprint !== undefined &&
            parsed.paginationEnvelopeFingerprint === firstPaginationEnvelopeFingerprint;
        }
        if (pageIndex > 0 && parsed.total === 0) {
          sawLaterZeroTotal = true;
          strictLaterZeroPageEnvelopes = strictLaterZeroPageEnvelopes &&
            parsed.jobPostings.length > 0;
        }
        if (pageIndex === 0 && derivedFilteredTotal !== undefined && parsed.total !== derivedFilteredTotal) {
          artifacts.push(workdayArtifact(
            "workday-filter-validation-0000",
            "ATS_API_RESPONSE",
            url,
            response,
            "$.total"
          ));
          latestEvidence = workdaySupportingArtifactEvidence(artifacts, "FACET_FILTER_VALIDATION_FAILED");
          return failed(
            capturedAt,
            `Workday filtered total ${String(parsed.total)} did not match derived total ${derivedFilteredTotal}`,
            latestEvidence
          );
        }
        const artifactLogicalKey = `workday-page-${String(pageIndex).padStart(4, "0")}`;
        artifacts.push(workdayArtifact(
          artifactLogicalKey,
          "PAGINATION_PAGE",
          url,
          response,
          requestContractV2Locator("$.total", {
            family: "workday", role: "page", method: pageRequest.method, url: pageRequest.url,
            body: JSON.parse(pageRequest.body),
            coordinate: { sequence: pageIndex, requestedOffset: offset,
              requestedPage: pageIndex, requestedPageSize: pageSize }
          })
        ));
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
          if (facetDescriptorBoundary && Object.prototype.hasOwnProperty.call(raw, facetDescriptorBoundary.facetParameter)) {
            const recordDescriptor = stringValue(raw[facetDescriptorBoundary.facetParameter]);
            if (!recordDescriptor || !facetDescriptorBoundary.allowedDescriptors.includes(recordDescriptor)) {
              artifacts.pop();
              artifacts.push(workdayArtifact(
                "workday-record-boundary-validation-0000",
                "ATS_API_RESPONSE",
                url,
                response,
                `$.jobPostings[${recordIndex}].${facetDescriptorBoundary.facetParameter}`
              ));
              latestEvidence = workdaySupportingArtifactEvidence(artifacts, "FACET_FILTER_VALIDATION_FAILED");
              return failed(
                capturedAt,
                `Workday record ${facetDescriptorBoundary.facetParameter} descriptor ${recordDescriptor ?? "<invalid>"} is outside the proven boundary`,
                latestEvidence
              );
            }
          }
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
          let normalized: ReturnType<typeof enrichWorkdayJob>;
          if (!hasRecordLevelChinaEvidence(raw, plan.workday.cityHints)) {
            const opaqueLocationCount = exactOpaqueMultiLocationCount(raw.locationsText);
            if (opaqueMultiLocationDetailPolicy && opaqueLocationCount !== undefined) {
              const failOpaqueDetail = (reason: string, recordedAt = response.capturedAt) => {
                validationDiscardCount += 1;
                fetchLosses.push({
                  stage: "VALIDATION" as const,
                  reason: "Workday opaque multi-location detail validation failed",
                  rawLocator,
                  details: { code: "DETAIL_VALIDATION_FAILED", pageSequence: pageIndex, recordIndex },
                  recordedAt
                });
                latestEvidence = workdayInPageFailureEvidence({
                  artifacts,
                  pages,
                  artifactLogicalKey,
                  pageIndex,
                  offset,
                  pageSize,
                  rawJobIds,
                  validJobIds,
                  declaredTotal: parsed.total,
                  response,
                  rawCount,
                  parsedCount,
                  validCount,
                  parseDiscardCount,
                  validationDiscardCount,
                  fetchLosses
                });
                return failed(capturedAt, `Workday opaque multi-location detail validation failed: ${reason}`, latestEvidence);
              };
              if (!detailHttp) {
                return failOpaqueDetail("an injected Workday POST transport requires an explicit detail client");
              }
              const detailUrl = `${origin}/wday/cxs/${plan.workday.tenant}/${plan.workday.site}${safeExternalPath}`;
              let detailResponse: WorkdayHttpResponse | undefined;
              try {
                detailResponse = await requestWorkdayDetail({
                  http: detailHttp,
                  url: detailUrl,
                  referer: plan.source.officialEntryUrl
                });
                artifacts.push(workdayArtifact(
                  `workday-detail-${String(pageIndex).padStart(4, "0")}-${String(recordIndex).padStart(4, "0")}`,
                  "ATS_API_RESPONSE",
                  detailUrl,
                  detailResponse,
                  "$.jobPostingInfo"
                ));
                const detail = validateOpaqueMultiLocationDetail({
                  response: detailResponse,
                  detailUrl,
                  raw,
                  externalPath: safeExternalPath,
                  origin,
                  sitePath,
                  site: plan.workday.site,
                  expectedLocationCount: opaqueLocationCount,
                  policy: opaqueMultiLocationDetailPolicy,
                  selectedMainlandLocations,
                  cityHints: plan.workday.cityHints
                });
                normalized = enrichWorkdayJob(raw, {
                  origin,
                  sitePath,
                  ...(plan.workday.cityHints ? { cityHints: plan.workday.cityHints } : {})
                }).map((job) => ({ ...job, locationRaw: detail.locationRaw, cities: detail.cities }));
              } catch (error) {
                return failOpaqueDetail(
                  error instanceof Error ? error.message : String(error),
                  detailResponse?.capturedAt ?? response.capturedAt
                );
              }
            } else {
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
          } else {
            normalized = enrichWorkdayJob(raw, {
              origin,
              sitePath,
              ...(plan.workday?.cityHints ? { cityHints: plan.workday.cityHints } : {}),
              defaultCities: ["中国"]
            });
          }
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
                extractorLocator: artifacts.find(
                  (artifact) => artifact.logicalKey === firstOfficialTotalPage.artifactLogicalKey
                )!.extractorLocator,
                scope: "SOURCE"
              }
            }
          : {}),
        fetchCounts: { rawCount, parsedCount, validCount, parseDiscardCount, validationDiscardCount },
        fetchLosses
      });
      latestEvidence = rawEvidence;
      const allowLaterZeroDeclaredTotalAfterExactReconciliation = allowsAuditedLaterZeroTotal && sawLaterZeroTotal &&
        strictLaterZeroPageEnvelopes && expectedJobCount !== undefined && expectedJobCount > 0;
      const evidence = deriveCanonicalPaginationEvidence({
        evidence: rawEvidence,
        expectedChannelIds: [],
        filteredOutput: Object.keys(appliedFacets).length > 0 || Boolean(searchText),
        ...(allowLaterZeroDeclaredTotalAfterExactReconciliation
          ? { allowLaterZeroDeclaredTotalAfterExactReconciliation: true }
          : {})
      });
      latestEvidence = evidence;
      const paginationEvaluation = evaluatePaginationEvidence({
        evidence,
        expectedChannelIds: [],
        filteredOutput: Object.keys(appliedFacets).length > 0 || Boolean(searchText),
        ...(allowLaterZeroDeclaredTotalAfterExactReconciliation
          ? { allowLaterZeroDeclaredTotalAfterExactReconciliation: true }
          : {})
      });
      latestEvaluation = paginationEvaluation;
      if (
        plan.workday.laterZeroTotalPolicy === BMS_LATER_ZERO_TOTAL_POLICY &&
        !bmsExactLaterZeroReconciliationProven({
          expectedJobCount,
          rawCount,
          parsedCount,
          validCount,
          parseDiscardCount,
          validationDiscardCount,
          fetchLossCount: fetchLosses.length,
          jobs,
          pages,
          sawLaterZeroTotal,
          strictLaterZeroPageEnvelopes,
          paginationEvaluation
        })
      ) {
        return failed(
          capturedAt,
          "BMS exact later-zero reconciliation did not prove a lossless unique official total",
          evidence,
          paginationEvaluation
        );
      }
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
      const transportFailure = retryableTransportFailureFromError(error);
      return failed(
        capturedAt,
        transportFailure
          ? safeSourceTransportFailureReason(transportFailure)
          : error instanceof Error ? error.message : String(error),
        latestEvidence,
        latestEvaluation,
        transportFailure
      );
    }
  };
}

function workdaySupportingArtifactEvidence(
  artifacts: readonly SourceFetchArtifactDraft[],
  failureCode: "FACET_DERIVATION_FAILED" | "FACET_FILTER_VALIDATION_FAILED"
): PersistentSourceFetchEvidence {
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "job-search-workday-fetch", version: "1" },
    artifacts,
    pages: [],
    supportingArtifactOnlyFailure: { code: failureCode },
    fetchCounts: {
      rawCount: 0,
      parsedCount: 0,
      validCount: 0,
      parseDiscardCount: 0,
      validationDiscardCount: 0
    },
    fetchLosses: []
  });
}

function workdayInPageFailureEvidence({
  artifacts,
  pages,
  artifactLogicalKey,
  pageIndex,
  offset,
  pageSize,
  rawJobIds,
  validJobIds,
  declaredTotal,
  response,
  rawCount,
  parsedCount,
  validCount,
  parseDiscardCount,
  validationDiscardCount,
  fetchLosses
}: {
  artifacts: readonly SourceFetchArtifactDraft[];
  pages: readonly SourceFetchPageTrace[];
  artifactLogicalKey: string;
  pageIndex: number;
  offset: number;
  pageSize: number;
  rawJobIds: readonly string[];
  validJobIds: readonly string[];
  declaredTotal: number | undefined;
  response: WorkdayHttpResponse;
  rawCount: number;
  parsedCount: number;
  validCount: number;
  parseDiscardCount: number;
  validationDiscardCount: number;
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"];
}): PersistentSourceFetchEvidence {
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "job-search-workday-fetch", version: "1" },
    artifacts,
    pages: [...pages, {
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
      declaredTotal: declaredTotal ?? null,
      declaredCount: null,
      declaredPages: declaredTotal === undefined ? null : Math.ceil(declaredTotal / pageSize),
      nextPageSignalBefore: pageIndex === 0 ? null : String(offset),
      nextPageSignalAfter: null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
      termination: "FAILED",
      anomalyCodes: [],
      capturedAt: response.capturedAt!
    }],
    fetchCounts: { rawCount, parsedCount, validCount, parseDiscardCount, validationDiscardCount },
    fetchLosses
  });
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

function exactOpaqueMultiLocationCount(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^([2-9][0-9]*) Locations$/u.exec(value);
  if (!match) return undefined;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) ? count : undefined;
}

function validateOpaqueMultiLocationDetail({
  response,
  detailUrl,
  raw,
  externalPath,
  origin,
  sitePath,
  site,
  expectedLocationCount,
  policy,
  selectedMainlandLocations,
  cityHints
}: {
  response: WorkdayHttpResponse;
  detailUrl: string;
  raw: Record<string, unknown>;
  externalPath: string;
  origin: string;
  sitePath: string;
  site: string;
  expectedLocationCount: number;
  policy: ResolvedWorkdayOpaqueMultiLocationDetailPolicy;
  selectedMainlandLocations: readonly WorkdaySelectedLocation[];
  cityHints: Record<string, readonly string[]> | undefined;
}): { locationRaw: string; cities: string[] } {
  if (response.finalUrl !== detailUrl) {
    throw new Error("detail final URL did not exactly match the requested official endpoint");
  }
  if (response.status !== 200) {
    throw new Error(`detail endpoint returned HTTP ${response.status}`);
  }
  if (typeof response.contentType !== "string" || !/^application\/json(?:\s*;|$)/iu.test(response.contentType)) {
    throw new Error("detail endpoint did not return JSON content type");
  }
  if (!hasUniqueJsonObjectKeys(response.body)) {
    throw new Error("detail response contains duplicate JSON object keys or non-strict JSON syntax");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error("detail response is not valid JSON");
  }
  if (!isRecord(parsed) || Array.isArray(parsed) || !isRecord(parsed.jobPostingInfo) || Array.isArray(parsed.jobPostingInfo)) {
    throw new Error("detail response is missing jobPostingInfo");
  }
  const info = parsed.jobPostingInfo;
  const rawTitle = exactNonEmptyString(raw.title);
  const rawReqId = Array.isArray(raw.bulletFields) && raw.bulletFields.length === 1
    ? exactNonEmptyString(raw.bulletFields[0])
    : undefined;
  const expectedPostingId = externalPath.split("/").at(-1);
  if (!rawTitle || exactNonEmptyString(info.title) !== rawTitle) {
    throw new Error("detail title did not exactly match the listing record");
  }
  if (exactNonEmptyString(info.jobPostingSiteId) !== site) {
    throw new Error("detail site identity did not exactly match the configured site");
  }
  if (!expectedPostingId || exactNonEmptyString(info.jobPostingId) !== expectedPostingId) {
    throw new Error("detail posting identity did not exactly match the listing path");
  }
  if (!rawReqId || exactNonEmptyString(info.jobReqId) !== rawReqId) {
    throw new Error("detail requisition identity did not exactly match the listing record");
  }
  if (exactNonEmptyString(info.externalUrl) !== `${origin}${sitePath}${externalPath}`) {
    throw new Error("detail external URL did not exactly match the official listing URL");
  }
  if (info.posted !== true || info.canApply !== true) {
    throw new Error("detail posting is not currently posted and applyable");
  }
  const location = exactNonEmptyString(info.location);
  if (!location || !Array.isArray(info.additionalLocations)) {
    throw new Error("detail response is missing exact public locations");
  }
  const additionalLocations = info.additionalLocations.map(exactNonEmptyString);
  if (additionalLocations.some((value) => value === undefined)) {
    throw new Error("detail additional locations contain an invalid descriptor");
  }
  const publicLocations = [location, ...(additionalLocations as string[])];
  if (publicLocations.length !== expectedLocationCount) {
    throw new Error("detail public location count did not match the opaque listing count");
  }
  if (new Set(publicLocations).size !== publicLocations.length) {
    throw new Error("detail public locations contain duplicate descriptors");
  }
  const selectedDescriptors = new Set(selectedMainlandLocations.map((item) => item.descriptor));
  const matchedMainlandDescriptors = policy.kind === "PFIZER_AUDITED_APAC_DETAIL_V1"
    ? publicLocations.filter(isMainlandChinaLocationDescriptor)
    : publicLocations.filter((descriptor) => selectedDescriptors.has(descriptor));
  if (policy.kind === "PFIZER_AUDITED_APAC_DETAIL_V1") {
    const exactApacDescriptor = "APAC - Any Pfizer Site";
    if (publicLocations.some((descriptor) => /\bAPAC\b/iu.test(descriptor) && descriptor !== exactApacDescriptor)) {
      throw new Error("detail public locations contain an unaudited APAC descriptor");
    }
    if (matchedMainlandDescriptors.length === 0 && !publicLocations.includes(exactApacDescriptor)) {
      throw new Error("detail public locations did not contain explicit mainland China or the exact audited Pfizer APAC site");
    }
  } else if (matchedMainlandDescriptors.length === 0) {
    throw new Error("detail public locations did not exactly match a selected dynamic China descriptor");
  }
  return {
    locationRaw: publicLocations.join(" | "),
    cities: matchedMainlandDescriptors.length === 0
      ? ["APAC - Any Pfizer Site"]
      : citiesFromWorkdayLocation(matchedMainlandDescriptors.join(" | "), cityHints)
  };
}

function exactNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value === value.trim() ? value : undefined;
}

function workdayJobsRequest({
  url,
  origin,
  referer,
  appliedFacets,
  searchText,
  pageSize,
  offset
}: {
  url: string;
  origin: string;
  referer: string;
  appliedFacets: Record<string, readonly string[]>;
  searchText: string | undefined;
  pageSize: number;
  offset: number;
}): WorkdayHttpRequest {
  return {
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
  };
}

function requestWorkdayDetail({
  http,
  url,
  referer
}: {
  http: WorkdayDetailHttpClient;
  url: string;
  referer: string;
}): Promise<WorkdayHttpResponse> {
  return http({
    url,
    method: "GET",
    headers: {
      Accept: "application/json",
      Referer: referer,
      "User-Agent": "job-search-crawler/0.1"
    }
  });
}

function failed(
  capturedAt: string,
  failureReason: string,
  fetchEvidence?: PersistentSourceFetchEvidence,
  paginationEvaluation?: ReturnType<typeof evaluatePaginationEvidence>,
  transportFailure?: SourceTransportFailure
): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason,
    ...(transportFailure ? { transportFailure } : {}),
    ...(fetchEvidence ? { fetchEvidence } : {}),
    ...(paginationEvaluation ? { paginationEvaluation } : {})
  };
}

async function defaultWorkdayHttpClient(
  request: WorkdayHttpRequest
): Promise<WorkdayHttpResponse> {
  const response = await fetchWithOfficialTimeout(request.url, {
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

async function defaultWorkdayDetailHttpClient(
  request: WorkdayDetailHttpRequest
): Promise<WorkdayHttpResponse> {
  const response = await fetchWithOfficialTimeout(request.url, {
    method: request.method,
    headers: request.headers
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

function parseWorkdayJobsResponse(
  body: string,
  paginationContext?: {
    pageIndex: number;
    auditedLaterZeroPolicy?: WorkdayLaterZeroTotalPolicy;
    auditedAppliedFacets?: Record<string, readonly string[]>;
  }
): {
  total?: number;
  jobPostings: unknown[];
  facets?: unknown;
  paginationEnvelopeFingerprint?: string;
} {
  if (!hasUniqueJsonObjectKeys(body)) {
    throw new Error("Workday response contains duplicate JSON object keys or non-strict JSON syntax");
  }
  const parsed = JSON.parse(body) as WorkdayJobsResponse;
  if (!Array.isArray(parsed.jobPostings)) {
    throw new Error("Workday response is missing the required jobPostings array");
  }
  const total = typeof parsed.total === "number" && parsed.total >= 0 ? parsed.total : undefined;
  const jobPostings = parsed.jobPostings;
  const paginationEnvelopeFingerprint = workdayPaginationEnvelopeFingerprint(parsed, paginationContext);

  return {
    ...(total === undefined ? {} : { total }),
    jobPostings,
    ...(parsed.facets === undefined ? {} : { facets: parsed.facets }),
    ...(paginationEnvelopeFingerprint === undefined ? {} : { paginationEnvelopeFingerprint })
  };
}

function workdayPaginationEnvelopeFingerprint(
  parsed: WorkdayJobsResponse,
  context?: {
    pageIndex: number;
    auditedLaterZeroPolicy?: WorkdayLaterZeroTotalPolicy;
    auditedAppliedFacets?: Record<string, readonly string[]>;
  }
): string | undefined {
  const keys = Object.keys(parsed).sort(compareUtf8);
  if (exactStringArray(keys, ["jobPostings", "total"])) {
    return "WORKDAY_BASE_ENVELOPE_V1";
  }
  if (
    exactStringArray(keys, ["facets", "jobPostings", "total", "userAuthenticated"]) &&
    Array.isArray(parsed.facets) &&
    parsed.userAuthenticated === false &&
    !containsPaginationAuthority(parsed.facets) &&
    context?.auditedLaterZeroPolicy !== undefined
  ) {
    const expectedShape = context.pageIndex === 0
      ? workdayAuditedFirstPageFacetsProveChinaTotal(
          parsed.facets,
          parsed.total,
          context.auditedLaterZeroPolicy,
          context.auditedAppliedFacets
        )
      : parsed.facets.length === 0;
    return expectedShape ? `WORKDAY_AUDITED_METADATA_V2:${context.auditedLaterZeroPolicy}` : undefined;
  }
  return undefined;
}

function workdayAuditedFirstPageFacetsProveChinaTotal(
  facets: unknown[],
  total: unknown,
  policy: WorkdayLaterZeroTotalPolicy,
  appliedFacets?: Record<string, readonly string[]>
): boolean {
  if (!Number.isInteger(total) || (total as number) < 0) return false;
  if (policy === BMS_LATER_ZERO_TOTAL_POLICY) {
    return workdayBmsFirstPageFacetsProveExactTotal(facets, total as number, appliedFacets);
  }
  const expected = policy === PFIZER_LATER_ZERO_TOTAL_POLICY
    ? { facetParameter: "Location_Country", descriptor: "Location Country" }
    : { facetParameter: "LocationCountry", descriptor: "Country/Territory" };
  const candidates = facets.filter((facet): facet is Record<string, unknown> =>
    isRecord(facet) && !Array.isArray(facet) && facet.facetParameter === expected.facetParameter);
  if (candidates.length !== 1) return false;
  const facet = candidates[0]!;
  if (Object.keys(facet).sort(compareUtf8).join(",") !== "descriptor,facetParameter,values" ||
      facet.descriptor !== expected.descriptor || !Array.isArray(facet.values)) return false;

  const ids = new Set<string>();
  const descriptors = new Set<string>();
  let chinaCount: number | undefined;
  for (const value of facet.values) {
    if (!isRecord(value) || Array.isArray(value) ||
        Object.keys(value).sort(compareUtf8).join(",") !== "count,descriptor,id" ||
        typeof value.descriptor !== "string" || typeof value.id !== "string" ||
        !Number.isInteger(value.count) || (value.count as number) < 0 ||
        ids.has(value.id) || descriptors.has(value.descriptor)) return false;
    ids.add(value.id);
    descriptors.add(value.descriptor);
    if (value.id === AUDITED_CHINA_LOCATION_ID) {
      if (value.descriptor !== "China" || chinaCount !== undefined) return false;
      chinaCount = value.count as number;
    }
  }
  return chinaCount === total;
}

function workdayBmsFirstPageFacetsProveExactTotal(
  facets: unknown[],
  total: number,
  appliedFacets: Record<string, readonly string[]> | undefined
): boolean {
  if (total <= 0) return false;
  const appliedEntries = Object.keys(appliedFacets ?? {}).sort(compareUtf8);
  if (!exactStringArray(appliedEntries, ["locationHierarchy2", "workerSubType"])) return false;
  const locationIds = appliedFacets!.locationHierarchy2;
  const workerIds = appliedFacets!.workerSubType;
  if (!locationIds || locationIds.length !== 1 || !workerIds || workerIds.length !== 2) return false;

  const locationGroups = findExactFacetGroups(facets, "locationHierarchy2");
  const workerGroups = findExactFacetGroups(facets, "workerSubType");
  if (locationGroups.length !== 1 || workerGroups.length !== 1) return false;
  const locationGroup = locationGroups[0]!;
  const workerGroup = workerGroups[0]!;
  if (
    Object.keys(locationGroup).sort(compareUtf8).join(",") !== "descriptor,facetParameter,values" ||
    locationGroup.descriptor !== "Country" ||
    !Array.isArray(locationGroup.values) ||
    Object.keys(workerGroup).sort(compareUtf8).join(",") !== "descriptor,facetParameter,values" ||
    workerGroup.descriptor !== "Job Type" ||
    !Array.isArray(workerGroup.values)
  ) return false;

  const parseExactValues = (values: unknown[]): Array<{ descriptor: string; id: string; count: number }> | undefined => {
    const parsed: Array<{ descriptor: string; id: string; count: number }> = [];
    for (const value of values) {
      if (!isRecord(value) || Array.isArray(value) ||
          Object.keys(value).sort(compareUtf8).join(",") !== "count,descriptor,id" ||
          typeof value.descriptor !== "string" || typeof value.id !== "string" ||
          !Number.isInteger(value.count) || (value.count as number) < 0) return undefined;
      parsed.push({ descriptor: value.descriptor, id: value.id, count: value.count as number });
    }
    if (new Set(parsed.map((value) => value.descriptor)).size !== parsed.length ||
        new Set(parsed.map((value) => value.id)).size !== parsed.length) return undefined;
    return parsed;
  };
  const locations = parseExactValues(locationGroup.values);
  const workers = parseExactValues(workerGroup.values);
  if (!locations || !workers) return false;
  const mainlandLocations = locations.filter((value) => isMainlandChinaCountryDescriptor(value.descriptor));
  if (mainlandLocations.length !== 1 || mainlandLocations[0]!.descriptor !== "China" ||
      mainlandLocations[0]!.id !== locationIds[0] || mainlandLocations[0]!.count !== total) return false;
  return exactStringArray(workers.map((value) => value.descriptor), ["Fixed Term (Fixed Term)", "Permanent"]) &&
    exactStringArray(workers.map((value) => value.id), workerIds) &&
    workers.reduce((sum, value) => sum + value.count, 0) === total;
}

function bmsExactLaterZeroReconciliationProven(input: {
  expectedJobCount: number | undefined;
  rawCount: number;
  parsedCount: number;
  validCount: number;
  parseDiscardCount: number;
  validationDiscardCount: number;
  fetchLossCount: number;
  jobs: readonly { sourceJobId: string }[];
  pages: readonly SourceFetchPageTrace[];
  sawLaterZeroTotal: boolean;
  strictLaterZeroPageEnvelopes: boolean;
  paginationEvaluation: ReturnType<typeof evaluatePaginationEvidence>;
}): boolean {
  const expected = input.expectedJobCount;
  if (expected === undefined || expected <= 0 || !input.sawLaterZeroTotal || !input.strictLaterZeroPageEnvelopes) return false;
  const rawIds = input.pages.flatMap((page) => page.rawJobIds);
  const validIds = input.pages.flatMap((page) => page.validJobIds);
  return input.rawCount === expected && input.parsedCount === expected && input.validCount === expected &&
    input.parseDiscardCount === 0 && input.validationDiscardCount === 0 && input.fetchLossCount === 0 &&
    input.jobs.length === expected && new Set(input.jobs.map((job) => job.sourceJobId)).size === expected &&
    rawIds.length === expected && new Set(rawIds).size === expected &&
    validIds.length === expected && new Set(validIds).size === expected &&
    input.pages.every((page) => page.termination !== "MAX_PAGE_LIMIT" && page.termination !== "EMPTY_PAGE") &&
    input.paginationEvaluation.safeCompleteness && input.paginationEvaluation.derivedAnomalyCodes.length === 0;
}

function containsPaginationAuthority(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPaginationAuthority);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) =>
    WORKDAY_PAGINATION_AUTHORITY_KEYS.has(key.toLowerCase()) || containsPaginationAuthority(item));
}

interface WorkdayFacetNode {
  descriptor: string;
  id?: string;
  count: number;
  children: WorkdayFacetNode[];
}

interface RawWorkdayFacetGroup {
  facetParameter: string;
  descriptor?: string;
  values: unknown[];
}

function chinaLocationAppliedFacets(
  facets: unknown,
  officialTotal: number | undefined,
  auditedPolicy?: ResolvedWorkdayLocationFacetPolicy
): {
  appliedFacets: Record<string, readonly string[]>;
  expectedFilteredTotal?: number;
  selectedMainlandLocations: readonly WorkdaySelectedLocation[];
} {
  const groups = collectFacetGroups(facets)
    .filter((group) => isLocationFacet(group.facetParameter, group.descriptor));

  const countryGroups = groups.filter((group) =>
    isCountryLevelFacet(group.facetParameter, group.descriptor) &&
    facetDescriptors(group.values).some(isMainlandChinaCountryDescriptor)
  );
  if (countryGroups.length > 1) {
    throw new Error("Workday location facet discovery found ambiguous country-level China location facets");
  }
  if (countryGroups.length === 1) {
    const countryGroup = countryGroups[0]!;
    assertAuditedLocationFacetParameter(countryGroup.facetParameter, auditedPolicy);
    const inspection = parseFacetGroup(
      countryGroup,
      officialTotal,
      auditedPolicy?.allowedDuplicateDescriptors ?? []
    );
    const nodes = inspection.nodes;
    assertCountryFacetScopeOwnership(
      countryGroup.facetParameter,
      nodes,
      auditedPolicy?.allowedForeignSiteDescriptors ?? [],
      auditedPolicy?.allowedForeignCountryDescriptors ?? []
    );
    const exactRequestableMainlandIds = nodes.filter((node) =>
      node.children.length === 0 && node.id !== undefined && isMainlandChinaCountryDescriptor(node.descriptor));
    if (auditedPolicy?.requireUniqueMainlandCountryLeaf && exactRequestableMainlandIds.length !== 1) {
      throw new Error(`Workday location facet ${countryGroup.facetParameter} lacks a unique exact mainland-China request id`);
    }
    const selectedLeaves = nodes.flatMap((node) =>
      isMainlandChinaCountryDescriptor(node.descriptor) ? selectableLeaves(node, true) : []
    );
    assertAuditedDuplicateDescriptorsRemainForeign(
      countryGroup.facetParameter,
      nodes,
      selectedLeaves,
      auditedPolicy?.allowedDuplicateDescriptors ?? []
    );
    if (!inspection.completePartition) {
      if (!inspection.overlappingCounts) {
        throw new Error(`Workday location facet ${countryGroup.facetParameter} counts do not prove a complete partition`);
      }
      if (exactRequestableMainlandIds.length !== 1) {
        throw new Error(`Workday location facet ${countryGroup.facetParameter} lacks a unique exact mainland-China request id`);
      }
      return {
        appliedFacets: { [countryGroup.facetParameter]: [exactRequestableMainlandIds[0]!.id!] },
        selectedMainlandLocations: exactRequestableMainlandIds.map(selectedWorkdayLocation)
      };
    }
    return facetSelection(countryGroup.facetParameter, selectedLeaves);
  }

  const cityGroups = groups.filter((group) =>
    !isCountryLevelFacet(group.facetParameter, group.descriptor) &&
    facetDescriptors(group.values).some((descriptor) =>
      isMainlandChinaLocationDescriptor(descriptor) ||
      isMainlandChinaCountryDescriptor(descriptor) ||
      (auditedPolicy?.mainlandDescriptorAliases.includes(descriptor) ?? false)
    )
  );
  if (cityGroups.length > 1) {
    throw new Error("Workday location facet discovery found ambiguous city-level China location facets");
  }
  if (cityGroups.length === 0) {
    throw new Error("Workday location facet discovery found no authoritative China location facet");
  }

  const cityGroup = cityGroups[0]!;
  assertAuditedLocationFacetParameter(cityGroup.facetParameter, auditedPolicy);
  const inspection = parseFacetGroup(
    cityGroup,
    officialTotal,
    auditedPolicy?.allowedDuplicateDescriptors ?? []
  );
  const selectedLeaves = selectMainlandCityLeaves(
    cityGroup.facetParameter,
    inspection.nodes,
    auditedPolicy?.mainlandDescriptorAliases ?? [],
    auditedPolicy?.allowedForeignDescriptors ?? [],
    auditedPolicy?.allowedDuplicateDescriptors ?? []
  );
  assertAuditedDuplicateDescriptorsRemainForeign(
    cityGroup.facetParameter,
    inspection.nodes,
    selectedLeaves,
    auditedPolicy?.allowedDuplicateDescriptors ?? []
  );
  if (!inspection.completePartition) {
    if (!inspection.overlappingCounts || !auditedPolicy?.allowOverlappingCounts) {
      throw new Error(`Workday location facet ${cityGroup.facetParameter} counts do not prove a complete partition`);
    }
    return facetSelectionWithoutExpectedTotal(cityGroup.facetParameter, selectedLeaves);
  }
  return facetSelection(cityGroup.facetParameter, selectedLeaves);
}

function assertAuditedDuplicateDescriptorsRemainForeign(
  facetParameter: string,
  nodes: readonly WorkdayFacetNode[],
  selectedLeaves: readonly WorkdayFacetNode[],
  allowedDuplicateDescriptors: readonly string[]
): void {
  const selectedSet = new Set(selectedLeaves);
  const allNodes = nodes.flatMap(flattenFacetNode);
  for (const descriptor of allowedDuplicateDescriptors) {
    const matchingNodes = allNodes.filter((node) => node.descriptor === descriptor);
    if (matchingNodes.length < 2) continue;
    const unsafe = matchingNodes.some((node) => {
      const path = facetPath(nodes, node);
      const hasNonMainlandBoundary = path.some((candidate) => isNonMainlandChinaDescriptor(candidate.descriptor));
      const hasMainlandScope = path.some((candidate) =>
        isMainlandChinaCountryDescriptor(candidate.descriptor) ||
        isMainlandChinaLocationDescriptor(candidate.descriptor));
      return node.children.length > 0 || selectedSet.has(node) || (hasMainlandScope && !hasNonMainlandBoundary);
    });
    if (unsafe) {
      throw new Error(`Workday location facet ${facetParameter} contains duplicate descriptors or ids`);
    }
  }
}

function assertAuditedLocationFacetParameter(
  actualFacetParameter: string,
  auditedPolicy: ResolvedWorkdayLocationFacetPolicy | undefined
): void {
  if (auditedPolicy && actualFacetParameter !== auditedPolicy.facetParameter) {
    throw new Error(
      `Workday audited location facet policy expected ${auditedPolicy.facetParameter} but received ${actualFacetParameter}`
    );
  }
}

function facetSelectionWithoutExpectedTotal(
  facetParameter: string,
  leaves: readonly WorkdayFacetNode[]
): { appliedFacets: Record<string, readonly string[]>; selectedMainlandLocations: readonly WorkdaySelectedLocation[] } {
  if (leaves.length === 0) {
    throw new Error(`Workday location facet ${facetParameter} has no requestable mainland-China leaf ids`);
  }
  return {
    appliedFacets: { [facetParameter]: leaves.map((leaf) => leaf.id!) },
    selectedMainlandLocations: leaves.map(selectedWorkdayLocation)
  };
}

function facetSelection(
  facetParameter: string,
  leaves: readonly WorkdayFacetNode[]
): {
  appliedFacets: Record<string, readonly string[]>;
  expectedFilteredTotal: number;
  selectedMainlandLocations: readonly WorkdaySelectedLocation[];
} {
  if (leaves.length === 0) {
    throw new Error(`Workday location facet ${facetParameter} has no requestable mainland-China leaf ids`);
  }
  return {
    appliedFacets: { [facetParameter]: leaves.map((leaf) => leaf.id!) },
    expectedFilteredTotal: leaves.reduce((sum, leaf) => sum + leaf.count, 0),
    selectedMainlandLocations: leaves.map(selectedWorkdayLocation)
  };
}

function selectedWorkdayLocation(leaf: WorkdayFacetNode): WorkdaySelectedLocation {
  return { id: leaf.id!, descriptor: leaf.descriptor };
}

function parseFacetGroup(
  group: RawWorkdayFacetGroup,
  officialTotal: number | undefined,
  allowedDuplicateDescriptors: readonly string[] = []
): { nodes: WorkdayFacetNode[]; completePartition: boolean; overlappingCounts: boolean } {
  const nodes = group.values.map((value) => parseFacetNode(value, group.facetParameter));
  const allNodes = nodes.flatMap(flattenFacetNode);
  const ids = allNodes.flatMap((node) => node.id ? [node.id] : []);
  const descriptors = allNodes.map((node) => node.descriptor);
  const duplicateDescriptors = descriptors.filter((descriptor, index) => descriptors.indexOf(descriptor) !== index);
  const uniqueDuplicateDescriptors = [...new Set(duplicateDescriptors)];
  const allowedDuplicateSet = new Set(allowedDuplicateDescriptors);
  const hasUnsafeDuplicateDescriptor = uniqueDuplicateDescriptors.some((descriptor) =>
    !allowedDuplicateSet.has(descriptor) ||
    isMainlandChinaCountryDescriptor(descriptor) ||
    isMainlandChinaLocationDescriptor(descriptor) ||
    !hasKnownForeignCountryPart(descriptor));
  if (new Set(ids).size !== ids.length || hasUnsafeDuplicateDescriptor) {
    throw new Error(`Workday location facet ${group.facetParameter} contains duplicate descriptors or ids`);
  }
  const rootCountTotal = nodes.reduce((sum, node) => sum + node.count, 0);
  return {
    nodes,
    completePartition: officialTotal !== undefined && rootCountTotal === officialTotal,
    overlappingCounts: officialTotal !== undefined && rootCountTotal > officialTotal
  };
}

function assertCountryFacetScopeOwnership(
  facetParameter: string,
  nodes: readonly WorkdayFacetNode[],
  allowedForeignSiteDescriptors: readonly string[] = [],
  allowedForeignCountryDescriptors: readonly string[] = []
): void {
  for (const node of nodes) {
    if (isMainlandChinaCountryDescriptor(node.descriptor) || isExactNonMainlandChinaCountryDescriptor(node.descriptor)) {
      continue;
    }
    assertExplicitForeignCountryBranch(
      facetParameter,
      node,
      allowedForeignSiteDescriptors,
      allowedForeignCountryDescriptors
    );
  }
}

function assertExplicitForeignCountryBranch(
  facetParameter: string,
  node: WorkdayFacetNode,
  allowedForeignSiteDescriptors: readonly string[],
  allowedForeignCountryDescriptors: readonly string[]
): void {
  if (allowedForeignSiteDescriptors.includes(node.descriptor)) {
    if (node.children.length > 0) {
      throw new Error(
        `Workday location facet ${facetParameter} audited foreign site descriptor must remain a leaf: ${node.descriptor}`
      );
    }
    return;
  }
  if (
    allowedForeignCountryDescriptors.includes(node.descriptor) ||
    isKnownForeignCountryDescriptor(node.descriptor) ||
    isExactNonMainlandChinaCountryDescriptor(node.descriptor)
  ) {
    return;
  }
  if (node.children.length > 0) {
    node.children.forEach((child) =>
      assertExplicitForeignCountryBranch(
        facetParameter,
        child,
        allowedForeignSiteDescriptors,
        allowedForeignCountryDescriptors
      ));
    return;
  }
  throw new Error(`Workday location facet ${facetParameter} contains unscoped country descriptor ${node.descriptor}`);
}

function parseFacetNode(value: unknown, facetParameter: string): WorkdayFacetNode {
  if (!isRecord(value)) {
    throw new Error(`Workday location facet ${facetParameter} contains a malformed value`);
  }
  const descriptor = stringValue(value.descriptor);
  if (!descriptor) {
    throw new Error(`Workday location facet ${facetParameter} contains a value missing a descriptor`);
  }
  const count = value.count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Workday location facet ${facetParameter} counts do not prove a complete partition`);
  }
  const childValues = Array.isArray(value.values) ? value.values : [];
  const children = childValues.map((child) => parseFacetNode(child, facetParameter));
  const id = stringValue(value.id);
  if (children.length === 0 && !id) {
    throw new Error(`Workday location facet ${facetParameter} contains a mainland-China descriptor without an id`);
  }
  if (children.length > 0 && children.reduce((sum, child) => sum + child.count, 0) !== count) {
    throw new Error(`Workday location facet ${facetParameter} counts do not prove a complete partition`);
  }
  return { descriptor, ...(id === undefined ? {} : { id }), count, children };
}

function flattenFacetNode(node: WorkdayFacetNode): WorkdayFacetNode[] {
  return [node, ...node.children.flatMap(flattenFacetNode)];
}

function selectableLeaves(node: WorkdayFacetNode, mainlandAncestor: boolean): WorkdayFacetNode[] {
  if (isNonMainlandChinaDescriptor(node.descriptor)) {
    return [];
  }
  const inMainland = mainlandAncestor || isMainlandChinaCountryDescriptor(node.descriptor) ||
    isMainlandChinaLocationDescriptor(node.descriptor);
  if (node.children.length === 0) {
    return inMainland ? [node] : [];
  }
  return node.children.flatMap((child) => selectableLeaves(child, inMainland));
}

function selectMainlandCityLeaves(
  facetParameter: string,
  nodes: readonly WorkdayFacetNode[],
  mainlandDescriptorAliases: readonly string[] = [],
  allowedForeignDescriptors: readonly string[] = [],
  deferredDuplicateDescriptors: readonly string[] = []
): WorkdayFacetNode[] {
  const selected: WorkdayFacetNode[] = [];
  for (const leaf of nodes.flatMap(flattenFacetNode).filter((node) => node.children.length === 0)) {
    const path = facetPath(nodes, leaf);
    const hasMainlandBoundary = path.some((node) =>
      isMainlandChinaCountryDescriptor(node.descriptor) ||
      isMainlandChinaLocationDescriptor(node.descriptor) ||
      mainlandDescriptorAliases.includes(node.descriptor));
    const hasForeignBoundary = path.some((node) =>
      isNonMainlandChinaDescriptor(node.descriptor) ||
      isKnownForeignCountryDescriptor(node.descriptor) ||
      allowedForeignDescriptors.includes(node.descriptor) ||
      hasKnownForeignCountryPart(node.descriptor));
    if (hasMainlandBoundary && hasForeignBoundary && !deferredDuplicateDescriptors.includes(leaf.descriptor)) {
      throw new Error(
        `Workday location facet ${facetParameter} contains conflicting mainland and foreign location boundaries for ${leaf.descriptor}`
      );
    }
    if (path.some((node) => isNonMainlandChinaDescriptor(node.descriptor))) {
      continue;
    }
    if (allowedForeignDescriptors.includes(leaf.descriptor)) {
      continue;
    }
    if (hasMainlandBoundary) {
      selected.push(leaf);
      continue;
    }
    if (!path.some((node) => hasKnownForeignCountryPart(node.descriptor))) {
      throw new Error(`Workday location facet ${facetParameter} contains unscoped location descriptor ${leaf.descriptor}`);
    }
  }
  return selected;
}

function facetPath(roots: readonly WorkdayFacetNode[], target: WorkdayFacetNode): WorkdayFacetNode[] {
  for (const root of roots) {
    if (root === target) return [root];
    const childPath = facetPath(root.children, target);
    if (childPath.length > 0) return [root, ...childPath];
  }
  return [];
}

function deriveDescriptorExcludedAppliedFacets(
  facets: unknown,
  exclusions: readonly WorkdayFacetDescriptorExclusion[],
  configuredAppliedFacets: Record<string, readonly string[]>,
  officialTotal: number | undefined
): {
  appliedFacets: Record<string, readonly string[]>;
  expectedFilteredTotal: number;
} {
  if (exclusions.length !== 1) {
    throw new Error("Workday facet descriptor exclusion requires exactly one complete partition");
  }
  const seenParameters = new Set<string>();
  const derived: Record<string, readonly string[]> = {};
  let expectedFilteredTotal: number | undefined;

  for (const exclusion of exclusions) {
    const facetParameter = stringValue(exclusion.facetParameter);
    if (!facetParameter || facetParameter !== exclusion.facetParameter) {
      throw new Error("Workday facet descriptor exclusion has an invalid facet parameter");
    }
    if (seenParameters.has(facetParameter) || configuredAppliedFacets[facetParameter] !== undefined) {
      throw new Error(`Workday facet parameter ${facetParameter} is duplicated or already configured`);
    }
    seenParameters.add(facetParameter);

    const excludedDescriptors = exclusion.excludedDescriptors.map((descriptor) => stringValue(descriptor));
    if (
      excludedDescriptors.length === 0 ||
      excludedDescriptors.some((descriptor) => descriptor === undefined) ||
      new Set(excludedDescriptors).size !== excludedDescriptors.length
    ) {
      throw new Error(`Workday facet parameter ${facetParameter} has invalid excluded descriptors`);
    }

    const groups = findExactFacetGroups(facets, facetParameter);
    if (groups.length !== 1) {
      throw new Error(`Workday facet parameter ${facetParameter} was missing or ambiguous in preflight evidence`);
    }
    const values = groups[0]!.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Workday facet parameter ${facetParameter} has no values in preflight evidence`);
    }

    const parsedValues = values.map((value) => {
      if (!isRecord(value)) {
        throw new Error(`Workday facet parameter ${facetParameter} contains a malformed value`);
      }
      const descriptor = stringValue(value.descriptor);
      if (!descriptor) {
        throw new Error(`Workday facet parameter ${facetParameter} contains a value missing a descriptor`);
      }
      const id = stringValue(value.id);
      if (!id) {
        throw new Error(`Workday facet parameter ${facetParameter} value ${descriptor} is missing an id`);
      }
      return { descriptor, id, count: value.count };
    });
    if (
      new Set(parsedValues.map((value) => value.descriptor)).size !== parsedValues.length ||
      new Set(parsedValues.map((value) => value.id)).size !== parsedValues.length
    ) {
      throw new Error(`Workday facet parameter ${facetParameter} contains duplicate descriptors or ids`);
    }

    const availableDescriptors = new Set(parsedValues.map((value) => value.descriptor));
    for (const excludedDescriptor of excludedDescriptors as string[]) {
      if (!availableDescriptors.has(excludedDescriptor)) {
        throw new Error(`Workday excluded descriptor ${excludedDescriptor} was missing from facet ${facetParameter}`);
      }
    }
    const counts = parsedValues.map((value) => {
      const count = value.count;
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        throw new Error(`Workday facet parameter ${facetParameter} counts do not prove a complete partition of the official total`);
      }
      return count;
    });
    if (officialTotal === undefined || counts.reduce((sum, count) => sum + count, 0) !== officialTotal) {
      throw new Error(`Workday facet parameter ${facetParameter} counts do not prove a complete partition of the official total`);
    }
    const excludedSet = new Set(excludedDescriptors as string[]);
    const allowedValues = parsedValues.filter((value) => !excludedSet.has(value.descriptor));
    const allowedIds = allowedValues.map((value) => value.id);
    if (allowedIds.length === 0) {
      throw new Error(`Workday facet parameter ${facetParameter} exclusion left no allowed ids`);
    }
    derived[facetParameter] = allowedIds;
    expectedFilteredTotal = allowedValues.reduce((sum, value) => sum + (value.count as number), 0);
  }

  if (expectedFilteredTotal === undefined) {
    throw new Error("Workday facet descriptor exclusion did not derive a complete partition");
  }
  return { appliedFacets: derived, expectedFilteredTotal };
}

function deriveAllowedDescriptorAppliedFacet(
  facets: unknown,
  boundary: WorkdayFacetDescriptorBoundary,
  configuredAppliedFacets: Record<string, readonly string[]>,
  officialTotal: number | undefined
): {
  appliedFacets: Record<string, readonly string[]>;
  expectedFilteredTotal: number;
} {
  const facetParameter = stringValue(boundary.facetParameter);
  if (!facetParameter || facetParameter !== boundary.facetParameter) {
    throw new Error("Workday allowed-descriptor boundary has an invalid facet parameter");
  }
  if (configuredAppliedFacets[facetParameter] !== undefined) {
    throw new Error(`Workday facet parameter ${facetParameter} is already configured`);
  }
  const allowedDescriptors = boundary.allowedDescriptors.map((descriptor) => stringValue(descriptor));
  const excludedDescriptors = (boundary.excludedDescriptors ?? []).map((descriptor) => stringValue(descriptor));
  if (
    allowedDescriptors.length === 0 ||
    allowedDescriptors.some((descriptor) => descriptor === undefined) ||
    new Set(allowedDescriptors).size !== allowedDescriptors.length
  ) {
    throw new Error(`Workday facet parameter ${facetParameter} has invalid allowed descriptors`);
  }
  if (
    excludedDescriptors.some((descriptor) => descriptor === undefined) ||
    new Set(excludedDescriptors).size !== excludedDescriptors.length ||
    excludedDescriptors.some((descriptor) => allowedDescriptors.includes(descriptor))
  ) {
    throw new Error(`Workday facet parameter ${facetParameter} has invalid excluded descriptors`);
  }

  const groups = findExactFacetGroups(facets, facetParameter);
  if (groups.length !== 1) {
    throw new Error(`Workday facet parameter ${facetParameter} was missing or ambiguous in preflight evidence`);
  }
  const values = groups[0]!.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Workday facet parameter ${facetParameter} has no values in preflight evidence`);
  }
  const parsedValues = values.map((value) => {
    if (!isRecord(value)) {
      throw new Error(`Workday facet parameter ${facetParameter} contains a malformed value`);
    }
    const descriptor = stringValue(value.descriptor);
    if (!descriptor) {
      throw new Error(`Workday facet parameter ${facetParameter} contains a value missing a descriptor`);
    }
    const id = stringValue(value.id);
    if (!id) {
      throw new Error(`Workday facet parameter ${facetParameter} value ${descriptor} is missing an id`);
    }
    const count = value.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Workday facet parameter ${facetParameter} counts do not prove a complete partition of the official total`);
    }
    return { descriptor, id, count };
  });
  if (
    new Set(parsedValues.map((value) => value.descriptor)).size !== parsedValues.length ||
    new Set(parsedValues.map((value) => value.id)).size !== parsedValues.length
  ) {
    throw new Error(`Workday facet parameter ${facetParameter} contains duplicate descriptors or ids`);
  }
  if (officialTotal === undefined || parsedValues.reduce((sum, value) => sum + value.count, 0) !== officialTotal) {
    throw new Error(`Workday facet parameter ${facetParameter} counts do not prove a complete partition of the official total`);
  }

  const allowedSet = new Set(allowedDescriptors as string[]);
  const availableSet = new Set(parsedValues.map((value) => value.descriptor));
  for (const allowedDescriptor of allowedDescriptors as string[]) {
    if (!availableSet.has(allowedDescriptor)) {
      throw new Error(`Workday allowed descriptor ${allowedDescriptor} was missing from facet ${facetParameter}`);
    }
  }
  for (const excludedDescriptor of excludedDescriptors as string[]) {
    if (!availableSet.has(excludedDescriptor)) {
      throw new Error(`Workday excluded descriptor ${excludedDescriptor} was missing from facet ${facetParameter}`);
    }
  }
  const declaredSet = new Set([...allowedDescriptors, ...excludedDescriptors] as string[]);
  const unexpected = parsedValues.find((value) => !declaredSet.has(value.descriptor));
  if (unexpected) {
    throw new Error(`Workday facet ${facetParameter} contains unexpected descriptor ${unexpected.descriptor}`);
  }
  const allowedValues = parsedValues.filter((value) => allowedSet.has(value.descriptor));

  return {
    appliedFacets: { [facetParameter]: allowedValues.map((value) => value.id) },
    expectedFilteredTotal: allowedValues.reduce((sum, value) => sum + value.count, 0)
  };
}

function findExactFacetGroups(value: unknown, facetParameter: string): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => findExactFacetGroups(item, facetParameter));
  }
  if (!isRecord(value)) {
    return [];
  }
  return [
    ...(value.facetParameter === facetParameter ? [value] : []),
    ...findExactFacetGroups(value.values, facetParameter)
  ];
}

function hasConfiguredLocationFacet(appliedFacets: Record<string, readonly string[]>): boolean {
  return Object.keys(appliedFacets).some((facetParameter) =>
    isLocationFacet(facetParameter, facetParameter)
  );
}

function collectFacetGroups(value: unknown): RawWorkdayFacetGroup[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectFacetGroups);
  }
  if (!isRecord(value)) {
    return [];
  }
  const facetParameter = stringValue(value.facetParameter);
  const descriptor = stringValue(value.descriptor);
  const values = Array.isArray(value.values) ? value.values : [];
  const embeddedGroups = values.filter((item) =>
    isRecord(item) && stringValue(item.facetParameter) !== undefined && Array.isArray(item.values)
  );
  const ownValues = values.filter((item) => !embeddedGroups.includes(item));
  return [
    ...(facetParameter && ownValues.length > 0
      ? [{ facetParameter, ...(descriptor === undefined ? {} : { descriptor }), values: ownValues }]
      : []),
    ...embeddedGroups.flatMap(collectFacetGroups),
    ...(!facetParameter ? ownValues.flatMap(collectFacetGroups) : [])
  ];
}

function facetDescriptors(values: readonly unknown[]): string[] {
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const descriptor = stringValue(value.descriptor);
    const children = Array.isArray(value.values) ? facetDescriptors(value.values) : [];
    return [...(descriptor ? [descriptor] : []), ...children];
  });
}

function isLocationFacet(parameter: string, descriptor: string | undefined): boolean {
  return /location|country|countries/i.test(parameter) || /location|country|countries|state|province/i.test(descriptor ?? "");
}

function isCountryLevelFacet(parameter: string, descriptor: string | undefined): boolean {
  return /country|countries/i.test(parameter) || /country|countries/i.test(descriptor ?? "");
}

function isMainlandChinaLocationDescriptor(descriptor: string): boolean {
  return !isNonMainlandChinaDescriptor(descriptor) &&
    descriptorParts(descriptor).some((part) => MAINLAND_CHINA_NAMES.has(part));
}

function isMainlandChinaCountryDescriptor(descriptor: string): boolean {
  return !isNonMainlandChinaDescriptor(descriptor) && MAINLAND_CHINA_NAMES.has(normalizeFacetDescriptor(descriptor));
}

function isNonMainlandChinaDescriptor(descriptor: string): boolean {
  const normalized = normalizeFacetDescriptor(descriptor);
  return /hong\s*kong|macau|macao|taiwan|香港|澳门|澳門|台湾|台灣/iu.test(descriptor) ||
    NON_MAINLAND_CHINA_CODES.has(normalized);
}

const MAINLAND_CHINA_NAMES = new Set([
  "china", "china mainland", "mainland china", "people's republic of china", "peoples republic of china",
  "prc", "chn", "cn", "中国", "中国大陆", "中华人民共和国"
]);
const NON_MAINLAND_CHINA_CODES = new Set(["hk", "hkg", "mo", "mac", "tw", "twn"]);
const NON_MAINLAND_CHINA_COUNTRY_NAMES = new Set([
  ...NON_MAINLAND_CHINA_CODES,
  "hong kong", "hong kong sar china", "香港", "中国香港", "中國香港",
  "macau", "macao", "macao sar china", "澳门", "澳門", "中国澳门", "中國澳門",
  "taiwan", "taiwan province of china", "台湾", "台灣", "中国台湾", "中國台灣"
]);
const EXACT_FOREIGN_COUNTRY_ALIASES = new Set(["united states of america"]);

// Exact ISO 3166-1 assignments are generated from Debian iso-codes through
// pycountry 26.2.16 (https://github.com/pycountry/pycountry); display names
// come from the runtime Unicode CLDR data exposed by Intl.DisplayNames.
const ISO_ALPHA_2_CODES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" "));
const ISO_ALPHA_3_CODES = new Set("ABW AFG AGO AIA ALA ALB AND ARE ARG ARM ASM ATA ATF ATG AUS AUT AZE BDI BEL BEN BES BFA BGD BGR BHR BHS BIH BLM BLR BLZ BMU BOL BRA BRB BRN BTN BVT BWA CAF CAN CCK CHE CHL CHN CIV CMR COD COG COK COL COM CPV CRI CUB CUW CXR CYM CYP CZE DEU DJI DMA DNK DOM DZA ECU EGY ERI ESH ESP EST ETH FIN FJI FLK FRA FRO FSM GAB GBR GEO GGY GHA GIB GIN GLP GMB GNB GNQ GRC GRD GRL GTM GUF GUM GUY HKG HMD HND HRV HTI HUN IDN IMN IND IOT IRL IRN IRQ ISL ISR ITA JAM JEY JOR JPN KAZ KEN KGZ KHM KIR KNA KOR KWT LAO LBN LBR LBY LCA LIE LKA LSO LTU LUX LVA MAC MAF MAR MCO MDA MDG MDV MEX MHL MKD MLI MLT MMR MNE MNG MNP MOZ MRT MSR MTQ MUS MWI MYS MYT NAM NCL NER NFK NGA NIC NIU NLD NOR NPL NRU NZL OMN PAK PAN PCN PER PHL PLW PNG POL PRI PRK PRT PRY PSE PYF QAT REU ROU RUS RWA SAU SDN SEN SGP SGS SHN SJM SLB SLE SLV SMR SOM SPM SRB SSD STP SUR SVK SVN SWE SWZ SXM SYC SYR TCA TCD TGO THA TJK TKL TKM TLS TON TTO TUN TUR TUV TWN TZA UGA UKR UMI URY USA UZB VAT VCT VEN VGB VIR VNM VUT WLF WSM YEM ZAF ZMB ZWE".split(" "));
const KNOWN_REGION_NAMES = buildKnownRegionNames();

function buildKnownRegionNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const locale of ["en", "zh-CN"] as const) {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    for (const code of ISO_ALPHA_2_CODES) {
      const name = displayNames.of(code);
      if (name && name !== code) names.add(normalizeFacetDescriptor(name));
    }
  }
  return names;
}

function isKnownForeignCountryDescriptor(descriptor: string): boolean {
  const normalized = normalizeFacetDescriptor(descriptor);
  const code = descriptor.trim().toUpperCase();
  return !MAINLAND_CHINA_NAMES.has(normalized) && !isExactNonMainlandChinaCountryDescriptor(descriptor) && (
    EXACT_FOREIGN_COUNTRY_ALIASES.has(normalized) ||
    KNOWN_REGION_NAMES.has(normalized) ||
    (ISO_ALPHA_2_CODES.has(code) && code !== "CN") ||
    (ISO_ALPHA_3_CODES.has(code) && code !== "CHN")
  );
}

function isExactNonMainlandChinaCountryDescriptor(descriptor: string): boolean {
  return NON_MAINLAND_CHINA_COUNTRY_NAMES.has(normalizeFacetDescriptor(descriptor));
}

function hasKnownForeignCountryPart(descriptor: string): boolean {
  return descriptorParts(descriptor).some((part) => {
    const code = part.toUpperCase();
    return !MAINLAND_CHINA_NAMES.has(part) && (
      KNOWN_REGION_NAMES.has(part) ||
      (ISO_ALPHA_2_CODES.has(code) && code !== "CN") ||
      (ISO_ALPHA_3_CODES.has(code) && code !== "CHN")
    );
  });
}

function descriptorParts(descriptor: string): string[] {
  return descriptor
    .split(/\s+-\s+|[,/|]/gu)
    .map(normalizeFacetDescriptor)
    .filter(Boolean);
}

function normalizeFacetDescriptor(descriptor: string): string {
  return descriptor.trim().toLowerCase().replace(/[()_]+/gu, " ").replace(/\s+/gu, " ");
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
