import type { SourceFetchFunction, SourceFetchResult, SourceTransportAttempt } from "./runSourceCrawl";
import {
  createAbortableClose,
  currentOfficialSourceAttemptSignal,
  fetchWithOfficialTimeout,
  hcmCloudBrowserSettleMs,
  officialBrowserTimeoutMs,
  officialHttpTimeoutMs
} from "./officialHttpRuntimeLimits";
import {
  isRetryableSourceTransportFailure,
  retryableHttpTransportFailure,
  retryableTransportFailureFromError,
  safeSourceTransportFailureReason,
  type SourceTransportFailure
} from "./sourceFetchFailure";
import { acquireBrowserSourcePermit } from "./browserSourceConcurrency";
import { load as loadHtml } from "cheerio";
import { parse as parseJavaScript } from "@babel/parser";
import type { ObjectExpression } from "@babel/types";
import { createHash } from "node:crypto";
import {
  assertOfficialHtmlMime,
  assertOfficialJsonEvidenceResponse,
  assertOfficialJsonMime,
  explicitlyForeignOrNonMainlandLocation,
  explicitlyGenericOrAmbiguousLocation,
  explicitlyOutsideChina,
  finalizeOfficialJsonEvidence,
  finalizeOfficialJsonEvidenceBundle,
  finalizeOfficialJsonFailureEvidence,
  finalizeOfficialJsonFailureEvidenceBundle,
  finalizeOfficialJsonSupportingFailureEvidence,
  initialOfficialJsonEvidenceState,
  irreversibleOfficialJsonEvidenceId,
  officialJsonArtifact,
  officialJsonNetworkArtifact,
  officialJsonRawLocator,
  persistentOfficialJsonJobId,
  safeOfficialJsonEndpoint,
  safeOfficialJsonEvidenceUrl,
  safeOfficialJsonId,
  sensitiveOfficialJsonField,
  type OfficialJsonEvidenceState
} from "./officialJsonEvidence";
import {
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";
import type { SourceCrawlPlan } from "./sourcePlan";
import {
  parseYelloJobBoardResponse,
  yelloJobBoardBinding,
  type YelloJobBoardConfig
} from "./yelloJobBoardEvidence";

export type OfficialJsonFetchConfig =
  | {
      kind: "innovent";
      endpointUrl: string;
    }
  | {
      kind: "novo-nordisk";
      endpointUrl: string;
      cityScopePolicy?: "NOVO_CHINA_MAINLAND_JOB_CITY_V1";
    }
  | {
      kind: "phenom";
      detailBaseUrl: string;
      derivedDetailIdField?: "reqId" | "jobSeqNo";
      mixedLocationScopePolicy?: "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1";
      countryFilter?: string;
      allowedApplyOrigins?: string[];
      allowedEntryRedirect?: {
        origin: string;
        pathname: string;
      };
      facetScope?: {
        countryIncludeDescriptor: string;
        categoryExcludeDescriptors: string[];
        exclusionFacet?: never;
        includeFacet?: never;
        partitionProofPolicy?: never;
      } | {
        countryIncludeDescriptor: string;
        categoryExcludeDescriptors?: never;
        exclusionFacet: {
          field: "category" | "jobLevelId" | "type";
          descriptors: string[];
        };
        includeFacet?: never;
        partitionProofPolicy?: never;
      } | {
        countryIncludeDescriptor: string;
        categoryExcludeDescriptors?: never;
        includeFacet: {
          field: "businessSector";
          descriptor: string;
        };
        exclusionFacet: {
          field: "jobLevelId";
          descriptors: string[];
        };
        partitionProofPolicy: "MERCK_HEALTHCARE_PARTITION_V1";
      };
      allowOmittedOffsetForSinglePage?: boolean;
      requestBoundOmittedOffsetPolicy?: "ROCHE_REQUEST_BOUND_OMITTED_OFFSET_V1";
      exactDuplicateReconciliationPolicy?: "ROCHE_IDENTICAL_CROSS_PAGE_V1";
      pageSize?: number;
      maxPages?: number;
    }
  | {
      kind: "beisen-zhiye-2022";
      changedWithinDays?: 183;
      postDateWithinDays?: 180;
      category?: string;
      pageSize?: number;
      maxPages?: number;
      detailPath?: string;
      displayFields?: string[];
      defaultLocationRaw?: string;
      geographyScope?: "DOMESTIC_OFFICIAL_TENANT";
      mixedLocationPolicy?:
        | "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES"
        | "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS";
      scopeExclusionProof?:
        | "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1"
        | "NHU_EXPLICIT_JAPAN_ONLY_V1"
        | "QILU_EXPLICIT_US_OR_HONG_KONG_ONLY_V2"
        | "THREESBIO_XIANYANG_HOMOGRAPH_V1";
    }
  | {
      kind: "cnstaff";
      pageSize?: number;
      maxPages?: number;
    }
  | {
      kind: "hcm-cloud";
      jobClass?: string;
      portalState?: string;
      recruitType?: string;
      pageSize?: number;
      maxPages?: number;
      detailPath?: string;
      defaultLocationRaw?: string;
      countCoordinatePolicy?: "LUNAN_AGGREGATE_ROW";
      responsePrefixPolicy?: "LUNAN_RANDOM_ALNUM3";
      listPaginationPolicy?: "LUNAN_REQUEST_BOUND_PAGE_V1";
    }
  | {
      kind: "jobsyn-solr";
      endpointUrl: string;
      siteOrigin: string;
      location: string;
      pageSize?: number;
      maxPages?: number;
      detailBaseUrl: string;
    }
  | {
      kind: "eightfold-pcsx";
      domain: string;
      location: string;
      pageSize?: number;
      maxPages?: number;
      detailBaseUrl: string;
    }
  | {
      kind: "51job-coapi";
      ctmid: string;
      uiScriptUrl: string;
      detailBaseUrl: string;
      pageSize?: 500;
    }
  | {
      kind: "sandoz-jsonapi";
      endpointUrl: string;
      taxonomyEndpointUrl: string;
      countryTermName: string;
      countryTermTargetId: number;
      countryTermUuid: string;
      pageSize?: number;
      maxPages?: number;
      detailBaseUrl: string;
      cityScopePolicy?: "SANDOZ_CHINA_TAXONOMY_LOCATION_V1";
    }
  | {
      kind: "redsea-zp-channel";
      channels: Array<{
        channelQrId: string;
        purpose: "SOCIAL" | "CAMPUS";
      }>;
      rootId: string;
      sortName?: string;
      paginationPolicy: "SINGLE_UNPAGINATED_RESPONSE_V1";
    }
  | {
      kind: "xiuzheng-job-list";
      endpointUrl: string;
      detailBaseUrl: string;
      defaultLocationRaw?: "未披露";
      pageSize?: number;
      maxPages?: number;
      scopeExclusionProof?: "XIUZHENG_NON_RECRUITMENT_TITLE_V1";
    }
  | YelloJobBoardConfig;

export interface OfficialJsonHttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface OfficialJsonHttpResponse {
  status: number;
  body: string;
  setCookie?: string[];
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type OfficialJsonHttpClient = (
  request: OfficialJsonHttpRequest
) => Promise<OfficialJsonHttpResponse>;

export interface HcmCloudBrowserFetchInput {
  config: Extract<OfficialJsonFetchConfig, { kind: "hcm-cloud" }>;
  entryUrl: string;
  capturedAt: string;
  signal?: AbortSignal;
}

export interface HcmCloudBrowserSession {
  entryResponse: OfficialJsonHttpResponse;
  post: (endpoint: "count" | "list", body: string) => Promise<OfficialJsonHttpResponse>;
  close: () => Promise<void>;
}

export type HcmCloudBrowserFetch = (
  input: HcmCloudBrowserFetchInput
) => Promise<HcmCloudBrowserSession>;

export interface OfficialJsonSourceFetchDeps {
  http?: OfficialJsonHttpClient;
  now?: () => Date;
  hcmCloudBrowserFetch?: HcmCloudBrowserFetch;
}

interface NormalizedOfficialJsonJob {
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}

const CITY_MATCHES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"],
  ["Beijing", "北京"],
  ["Changsha", "长沙"],
  ["Changchun", "长春"],
  ["Chongqing", "重庆"],
  ["Daqing", "大庆"],
  ["Suzhou", "苏州"],
  ["Dongguan", "东莞"],
  ["Shenzhen", "深圳"],
  ["Guangzhou", "广州"],
  ["Hangzhou", "杭州"],
  ["Kashi", "喀什"],
  ["Leshan", "乐山"],
  ["Nanjing", "南京"],
  ["Nanning", "南宁"],
  ["Nantong", "南通"],
  ["Ningde", "宁德"],
  ["Songyuan", "松原"],
  ["Wuhan", "武汉"],
  ["Chengdu", "成都"],
  ["Urumqi", "乌鲁木齐"],
  ["Wulumuqi", "乌鲁木齐"],
  ["Wenzhou", "温州"],
  ["Tonghua", "通化"],
  ["Xining", "西宁"],
  ["Zhuhai", "珠海"],
  ["Tianjin", "天津"],
  ["Lanzhou", "兰州"],
  ["Taiyuan", "太原"],
  ["Yancheng", "盐城"],
  ["Jiangsu", "江苏"],
  ["上海", "上海"],
  ["北京", "北京"],
  ["长沙", "长沙"],
  ["长春", "长春"],
  ["重庆", "重庆"],
  ["大庆", "大庆"],
  ["苏州", "苏州"],
  ["东莞", "东莞"],
  ["深圳", "深圳"],
  ["广州", "广州"],
  ["杭州", "杭州"],
  ["喀什", "喀什"],
  ["乐山", "乐山"],
  ["南京", "南京"],
  ["宁德", "宁德"],
  ["松原", "松原"],
  ["武汉", "武汉"],
  ["成都", "成都"],
  ["乌鲁木齐", "乌鲁木齐"],
  ["通化", "通化"],
  ["西宁", "西宁"],
  ["天津", "天津"],
  ["兰州", "兰州"],
  ["太原", "太原"],
  ["盐城", "盐城"]
];
const DEFAULT_BEISEN_ZHIYE_DISPLAY_FIELDS = [
  "Category",
  "Kind",
  "LocId",
  "Salary",
  "Degree",
  "YearsOfWorking",
  "ClassificationOne",
  "WorkWeChatQrCode"
] as const;

export function createOfficialJsonSourceFetch(
  deps: OfficialJsonSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const now = deps.now ?? (() => new Date());
    const capturedAt = now().toISOString();

    if (plan.adapterId !== "official-json" || !plan.officialJsonFetch) {
      return failed(capturedAt, `Official JSON source ${plan.source.id} is missing fetch config`);
    }

    try {
      const http = deps.http ?? createDefaultHttpClient(now);
      const finish = (result: SourceFetchResult): SourceFetchResult =>
        attachOfficialJsonPageCapacity(result, plan.officialJsonFetch!);
      if (plan.officialJsonFetch.kind === "phenom") {
        return finish(await fetchPhenomWidgets({
          http,
          plan,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "beisen-zhiye-2022") {
        return finish(await fetchBeisenZhiye2022({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "cnstaff") {
        return finish(await fetchCnstaff({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "hcm-cloud") {
        const browserFetch =
          deps.hcmCloudBrowserFetch ?? (deps.http ? undefined : defaultHcmCloudBrowserFetch);
        return finish(await fetchHcmCloud({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now,
          ...(browserFetch ? { browserFetch } : {})
        }));
      }

      if (plan.officialJsonFetch.kind === "jobsyn-solr") {
        return finish(await fetchJobsynSolr({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "eightfold-pcsx") {
        return finish(await fetchEightfoldPcsx({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "51job-coapi") {
        return finish(await fetch51jobCoapi({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "sandoz-jsonapi") {
        return finish(await fetchSandozJsonApi({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          sourceIdentity: { id: plan.source.id, companyId: plan.source.companyId },
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "redsea-zp-channel") {
        return finish(await fetchRedseaZpChannel({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "xiuzheng-job-list") {
        return finish(await fetchXiuzhengJobList({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      if (plan.officialJsonFetch.kind === "yello-job-board") {
        return finish(await fetchYelloJobBoard({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
          capturedAt,
          now
        }));
      }

      return finish(await fetchSingleResponseOfficialJson({
        http,
        config: plan.officialJsonFetch,
        entryUrl: plan.source.officialEntryUrl,
        sourceIdentity: { id: plan.source.id, companyId: plan.source.companyId },
        capturedAt,
        now
      }));
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
  };
}

async function fetchYelloJobBoard({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "yello-job-board" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  let safeEntryUrl: string;
  let endpoint: string;
  let extractorLocator: string;
  try {
    const binding = yelloJobBoardBinding(safeOfficialJsonEvidenceUrl(entryUrl), config);
    safeEntryUrl = binding.entryUrl;
    endpoint = binding.endpointUrl;
    extractorLocator = binding.extractorLocator;
  } catch {
    return failed(capturedAt, "Yello source configuration is invalid");
  }

  let response: OfficialJsonHttpResponse;
  try {
    response = await http({
      url: endpoint,
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "job-search-crawler/0.1"
      }
    });
  } catch {
    return failed(capturedAt, "Yello source transport failed");
  }

  try {
    assertOfficialJsonEvidenceResponse(response, {
      requestedUrl: endpoint,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    });
  } catch {
    return failed(capturedAt, "Yello response metadata is invalid");
  }
  const artifact = officialJsonArtifact({ requestedUrl: endpoint, response, extractorLocator });
  const failureState = initialOfficialJsonEvidenceState({ artifact, termination: "FAILED" });
  if (response.status < 200 || response.status >= 300) {
    return failedWithEvidence(capturedAt, `Yello source returned HTTP ${response.status}`,
      finalizeOfficialJsonFailureEvidence(failureState));
  }
  try {
    assertOfficialJsonMime(response);
  } catch {
    return failedWithEvidence(capturedAt, "Yello response has an invalid Content-Type",
      finalizeOfficialJsonFailureEvidence(failureState));
  }

  let parsed: ReturnType<typeof parseYelloJobBoardResponse>;
  try {
    parsed = parseYelloJobBoardResponse(response.body, config);
  } catch {
    return failedWithEvidence(capturedAt, "Yello response failed strict China partition replay",
      finalizeOfficialJsonFailureEvidence(failureState));
  }
  const count = parsed.declaredTotal;
  const state = initialOfficialJsonEvidenceState({ artifact, declaredTotal: count, termination: "ABORTED" });
  state.page.declaredCount = count;
  const jobs: NormalizedOfficialJsonJob[] = [];
  for (let index = 0; index < parsed.jobs.length; index += 1) {
    const row = parsed.jobs[index]!;
    state.rawCount += 1;
    state.page.rawJobIds.push(irreversibleOfficialJsonEvidenceId([index, row.rawHtml]));
    state.parsedCount += 1;
    const sourceJobId = persistentOfficialJsonJobId(row.officialId);
    jobs.push({ sourceJobId, title: row.title, officialUrl: row.officialUrl, locationRaw: row.locationRaw,
      cities: citiesFromLocation(row.locationRaw) });
    state.validCount += 1;
    state.page.validJobIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
  }
  state.page.termination = "NEXT_ABSENT";
  const { evidence, evaluation } = finalizeOfficialJsonEvidence({
    state,
    declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: count,
      artifactLogicalKey: artifact.logicalKey, extractorLocator, scope: "SOURCE" }
  });
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      expectedJobCount: count,
      completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: safeEntryUrl,
      completenessBlockerReason: "Yello official China total remains manual until downstream adapter accounting is complete",
      pagesVisited: 1
    },
    fetchEvidence: evidence,
    paginationEvaluation: evaluation
  };
}

function attachOfficialJsonPageCapacity(
  result: SourceFetchResult,
  config: OfficialJsonFetchConfig
): SourceFetchResult {
  const requestedPageSize = officialJsonRequestedPageSize(config);
  const attachEvidence = (evidence: PersistentSourceFetchEvidence | undefined) => {
    if (!evidence) return undefined;
    const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
    const enriched = {
      ...evidence,
      pages: evidence.pages.map((page) => ({
        ...page,
        requestedPageSize,
        returnedPageSize: explicitOfficialReturnedPageSize(config.kind, artifacts.get(page.artifactLogicalKey)?.body)
      }))
    };
    if (evidence.supportingArtifactOnlyFailure) {
      return { evidence: enriched as PersistentSourceFetchEvidence, evaluation: undefined };
    }
    const expectedChannelIds = config.kind === "redsea-zp-channel"
      ? [...new Set(evidence.pages.flatMap((page) => page.channelId ? [page.channelId] : []))]
      : [];
    const allowMissingReturnedPage = config.kind === "beisen-zhiye-2022";
    const allowPositiveOfficialTotalCountAfterAdapterReconciliation =
      config.kind === "sandoz-jsonapi" || config.kind === "yello-job-board" || config.kind === "51job-coapi";
    const allowIndependentlyVerifiedProfileBoundExclusions = config.kind === "51job-coapi";
    const allowRawIdOverlapAcrossPages = config.kind === "phenom" &&
      config.exactDuplicateReconciliationPolicy === "ROCHE_IDENTICAL_CROSS_PAGE_V1";
    const canonical = deriveCanonicalPaginationEvidence({
      evidence: enriched,
      expectedChannelIds,
      filteredOutput: true,
      allowMissingReturnedPage,
      allowPositiveOfficialTotalCountAfterAdapterReconciliation,
      allowIndependentlyVerifiedProfileBoundExclusions,
      allowRawIdOverlapAcrossPages
    });
    return {
      evidence: canonical,
      evaluation: evaluatePaginationEvidence({
        evidence: canonical,
        expectedChannelIds,
        filteredOutput: true,
        allowMissingReturnedPage,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation,
        allowIndependentlyVerifiedProfileBoundExclusions,
        allowRawIdOverlapAcrossPages
      })
    };
  };
  const current = attachEvidence(result.fetchEvidence);
  const priorTransportAttempts = result.priorTransportAttempts?.map((attempt) => {
    const prior = attachEvidence(attempt.fetchEvidence);
    return prior ? { ...attempt, fetchEvidence: prior.evidence,
      ...(prior.evaluation ? { paginationEvaluation: prior.evaluation } : {}) } : attempt;
  });
  const base = {
    ...result,
    ...(current ? { fetchEvidence: current.evidence,
      ...(current.evaluation ? { paginationEvaluation: current.evaluation } : {}) } : {}),
    ...(priorTransportAttempts ? { priorTransportAttempts } : {})
  };
  return base;
}

function officialJsonRequestedPageSize(config: OfficialJsonFetchConfig): number | null {
  switch (config.kind) {
    case "phenom": return Math.max(1, Math.min(100, config.pageSize ?? 50));
    case "beisen-zhiye-2022": return Math.max(1, Math.min(100, config.pageSize ?? 100));
    case "cnstaff": return Math.max(1, Math.min(100, config.pageSize ?? 15));
    case "hcm-cloud": return Math.max(1, config.pageSize ?? 20);
    case "jobsyn-solr": return config.pageSize ?? 9;
    case "eightfold-pcsx": return Math.max(1, Math.min(100, config.pageSize ?? 10));
    case "51job-coapi": return config.pageSize ?? 500;
    case "sandoz-jsonapi": return config.pageSize ?? 10;
    case "xiuzheng-job-list": return config.pageSize ?? 10;
    default: return null;
  }
}

function explicitOfficialReturnedPageSize(
  kind: OfficialJsonFetchConfig["kind"],
  body: string | Uint8Array | undefined
): number | null {
  if (typeof body !== "string" || (kind !== "jobsyn-solr" && kind !== "xiuzheng-job-list")) return null;
  try {
    const root = JSON.parse(body) as unknown;
    if (!isStrictRecord(root)) return null;
    const container = kind === "jobsyn-solr" ? root.pagination : root.data;
    if (!isStrictRecord(container)) return null;
    const value = kind === "jobsyn-solr" ? container.page_size : container.per_page;
    return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
  } catch {
    return null;
  }
}

async function fetchSingleResponseOfficialJson({
  http,
  config,
  entryUrl,
  sourceIdentity,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "innovent" | "novo-nordisk" }>;
  entryUrl: string;
  sourceIdentity: { id: string; companyId: string };
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  let completenessEvidenceUrl: string;
  try {
    completenessEvidenceUrl = safeOfficialJsonEvidenceUrl(entryUrl);
  } catch {
    return failed(capturedAt, "Official JSON official entry URL is invalid");
  }
  let endpoint: string;
  try {
    endpoint = safeOfficialJsonEndpoint(config.endpointUrl);
  } catch {
    return failed(capturedAt, "Official JSON request URL is invalid");
  }

  let response: OfficialJsonHttpResponse;
  try {
    response = await http({
      url: endpoint,
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "job-search-crawler/0.1"
      }
    });
  } catch (error) {
    const transportFailure = retryableTransportFailureFromError(error);
    return failed(
      capturedAt,
      transportFailure ? safeSourceTransportFailureReason(transportFailure) : "Official JSON TRANSPORT_FAILURE",
      transportFailure
    );
  }

  try {
    assertOfficialJsonEvidenceResponse(response, {
      requestedUrl: endpoint,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    });
  } catch (error) {
    return failed(capturedAt, safeOfficialJsonFailure(error, "Official JSON response metadata is invalid"));
  }

  const failureArtifact = officialJsonArtifact({
    requestedUrl: endpoint,
    response,
    extractorLocator: "json:unavailable"
  });
  const failureState = initialOfficialJsonEvidenceState({ artifact: failureArtifact, termination: "FAILED" });
  if (response.status < 200 || response.status >= 300) {
    const transportFailure = retryableHttpTransportFailure(response.status);
    return failedWithEvidence(
      capturedAt,
      transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : `Official JSON source returned HTTP ${response.status}`,
      finalizeOfficialJsonFailureEvidence(failureState),
      transportFailure
    );
  }
  try {
    assertOfficialJsonMime(response);
  } catch (error) {
    return failedWithEvidence(
      capturedAt,
      safeOfficialJsonFailure(error, "Official JSON response has an invalid Content-Type"),
      finalizeOfficialJsonFailureEvidence(failureState)
    );
  }

  let root: unknown;
  try {
    root = JSON.parse(response.body);
  } catch {
    return failedWithEvidence(
      capturedAt,
      "Official JSON response is not valid JSON",
      finalizeOfficialJsonFailureEvidence(failureState)
    );
  }
  if (!isStrictRecord(root)) {
    return failedWithEvidence(
      capturedAt,
      "Official JSON response root must be an object",
      finalizeOfficialJsonFailureEvidence(failureState)
    );
  }

  const data = root.data;
  let rawJobs: unknown[];
  let declaredTotal: number | undefined;
  let totalPath: "$.data.totalMatches" | "$.data.total" | undefined;
  let officialTotalHasSourceScope = false;
  if (config.kind === "innovent") {
    if (!Array.isArray(data)) {
      return failedWithEvidence(
        capturedAt,
        "Innovent response requires a $.data array",
        finalizeOfficialJsonFailureEvidence(failureState)
      );
    }
    rawJobs = data;
  } else {
    if (!isStrictRecord(data) || !Array.isArray(data.jobs)) {
      return failedWithEvidence(
        capturedAt,
        "Novo response requires a $.data.jobs array",
        finalizeOfficialJsonFailureEvidence(failureState)
      );
    }
    rawJobs = data.jobs;
    if (hasOwn(data, "totalMatches")) {
      if (!isNonnegativeInteger(data.totalMatches)) {
        return failedWithEvidence(
          capturedAt,
          "Novo response $.data.totalMatches must be a nonnegative integer",
          finalizeOfficialJsonFailureEvidence(failureState)
        );
      }
      declaredTotal = data.totalMatches;
      totalPath = "$.data.totalMatches";
    } else if (hasOwn(data, "total")) {
      if (!isNonnegativeInteger(data.total)) {
        return failedWithEvidence(
          capturedAt,
          "Novo response $.data.total must be a nonnegative integer",
          finalizeOfficialJsonFailureEvidence(failureState)
        );
      }
      declaredTotal = data.total;
      totalPath = "$.data.total";
    }
    officialTotalHasSourceScope = isNovoChinaMainlandRequest(endpoint);
  }

  const extractorLocator = totalPath
    ? novoTotalLocator(endpoint, totalPath)
    : config.kind === "innovent"
      ? "official-json-single-v1|kind:innovent|request:limit-bound-only|json:$.data"
      : "official-json-single-v1|kind:novo-nordisk|request:country-filter-bound|json:$.data.jobs";
  const artifact = officialJsonArtifact({ requestedUrl: endpoint, response, extractorLocator });
  const state = initialOfficialJsonEvidenceState({
    artifact,
    ...(declaredTotal === undefined ? {} : { declaredTotal }),
    termination: "ABORTED"
  });
  const jobs: NormalizedOfficialJsonJob[] = [];
  const seenOfficialIds = new Set<string>();
  const usesNovoChinaCityPolicy = isExactNovoChinaCityPolicy({ config, entryUrl, sourceIdentity, endpoint });
  for (let recordIndex = 0; recordIndex < rawJobs.length; recordIndex += 1) {
    const raw = rawJobs[recordIndex];
    state.rawCount += 1;
    state.page.rawJobIds.push(irreversibleOfficialJsonEvidenceId([recordIndex, raw]));
    const rawLocator = officialJsonRawLocator(raw, recordIndex);
    if (!isStrictRecord(raw)) {
      recordOfficialJsonLoss(state, "PARSE", "NON_OBJECT_RECORD", rawLocator, recordIndex);
      continue;
    }
    state.parsedCount += 1;
    const id = stringValue(config.kind === "innovent" ? raw.id : raw.jobId);
    const title = stringValue(config.kind === "innovent" ? raw.title : raw.jobTitle);
    const locationRaw = stringValue(config.kind === "innovent" ? raw.city : raw.jobLocationLabel);
    const city = config.kind === "novo-nordisk" && isStrictRecord(raw.jobCity)
      ? stringValue(raw.jobCity.label)
      : undefined;
    const missingField = !id ? "id" : !title ? "title" : !locationRaw ? "locationRaw" : undefined;
    if (missingField) {
      recordOfficialJsonLoss(state, "VALIDATION", "MISSING_REQUIRED_FIELD", rawLocator, recordIndex, missingField);
      continue;
    }
    const officialId = id!;
    const officialTitle = title!;
    const officialLocation = locationRaw!;
    if (!safeOfficialJsonId(officialId)) {
      recordOfficialJsonLoss(state, "VALIDATION", "UNSAFE_OFFICIAL_ID", rawLocator, recordIndex, "id");
      continue;
    }
    if (seenOfficialIds.has(officialId)) {
      recordOfficialJsonLoss(state, "VALIDATION", "DUPLICATE_OFFICIAL_ID", rawLocator, recordIndex, "id");
      continue;
    }
    if (explicitlyOutsideChina(`${officialLocation} ${city ?? ""}`)) {
      recordOfficialJsonLoss(state, "VALIDATION", "OUT_OF_SCOPE", rawLocator, recordIndex);
      continue;
    }
    const novoCityReview = usesNovoChinaCityPolicy
      ? reviewNovoChinaMainlandCity(officialLocation, city)
      : undefined;
    if (novoCityReview && novoCityReview.scope !== "CHINA") {
      recordOfficialJsonLoss(state, "VALIDATION", "OUT_OF_SCOPE", rawLocator, recordIndex);
      continue;
    }
    const officialUrl = officialJsonJobUrl(config.kind, officialId);
    const sensitiveField = sensitiveOfficialJsonField({
      id: officialId,
      title: officialTitle,
      locationRaw: officialLocation,
      city: city ?? "",
      officialUrl
    });
    if (sensitiveField) {
      recordOfficialJsonLoss(state, "VALIDATION", "SENSITIVE_OUTPUT", rawLocator, recordIndex, sensitiveField);
      continue;
    }
    seenOfficialIds.add(officialId);
    const sourceJobId = persistentOfficialJsonJobId(officialId);
    jobs.push({
      sourceJobId,
      title: officialTitle,
      officialUrl,
      locationRaw: officialLocation,
      cities: novoCityReview?.cities ?? citiesFromLocation(city ?? officialLocation)
    });
    state.validCount += 1;
    state.page.validJobIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
  }

  if (rawJobs.length === 0 && declaredTotal !== 0) {
    state.page.termination = "FAILED";
    return failedWithEvidence(
      capturedAt,
      "Official JSON empty response lacks explicit official zero evidence",
      finalizeOfficialJsonFailureEvidence(state)
    );
  }
  if (config.kind === "novo-nordisk" && officialTotalHasSourceScope && declaredTotal !== undefined &&
    rawJobs.length === declaredTotal && state.fetchLosses.length === 0 &&
    state.validCount === declaredTotal && state.parseDiscardCount === 0 &&
    state.validationDiscardCount === 0) {
    state.page.termination = declaredTotal === 0 ? "EMPTY_PAGE" : "DECLARED_TOTAL_REACHED";
  }

  const declaredCompleteness = declaredTotal === undefined || !totalPath || !officialTotalHasSourceScope
    ? undefined
    : {
        kind: "OFFICIAL_TOTAL_COUNT" as const,
        value: declaredTotal,
        artifactLogicalKey: artifact.logicalKey,
        extractorLocator,
        scope: "SOURCE" as const
      };
  const { evidence, evaluation } = finalizeOfficialJsonEvidence({
    state,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  });
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(declaredTotal === undefined || !officialTotalHasSourceScope
        ? {}
        : { expectedJobCount: declaredTotal }),
      completenessEvidenceKind: declaredTotal === undefined || !officialTotalHasSourceScope
        ? "WEAK_MANUAL_SAMPLE"
        : "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl,
      completenessBlockerReason: config.kind === "innovent"
        ? "Innovent single response and configured limit do not prove endpoint exhaustion"
        : "Novo official total remains manual until downstream adapter accounting is complete",
      pagesVisited: 1
    },
    fetchEvidence: evidence,
    paginationEvaluation: evaluation
  };
}

function recordOfficialJsonLoss(
  state: OfficialJsonEvidenceState,
  stage: "PARSE" | "VALIDATION",
  code: "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "DUPLICATE_OFFICIAL_ID" | "OUT_OF_SCOPE" | "UNSAFE_OFFICIAL_ID" | "SENSITIVE_OUTPUT",
  rawLocator: string,
  recordIndex: number,
  field?: string
): void {
  if (stage === "PARSE") state.parseDiscardCount += 1;
  else state.validationDiscardCount += 1;
  state.fetchLosses.push({
    stage,
    reason: `Official JSON record rejected: ${code}`,
    rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence: 0, recordIndex },
    recordedAt: state.artifact.capturedAt
  });
}

function novoTotalLocator(endpoint: string, path: "$.data.totalMatches" | "$.data.total"): string {
  const country = new URL(endpoint).searchParams.get("country") ?? "";
  return `official-json-single-v1|kind:novo-nordisk|request:country=${irreversibleOfficialJsonEvidenceId(country)}|json:${path}`;
}

function isNovoChinaMainlandRequest(endpoint: string): boolean {
  const url = new URL(endpoint);
  const countryEntries = [...new URL(endpoint).searchParams.entries()].filter(([key]) =>
    key.normalize("NFKC").toLowerCase() === "country"
  );
  return countryEntries.length === 1 && countryEntries[0]![0] === "country" &&
    (countryEntries[0]![1] === "China Mainland" ||
      (url.hostname === "www.novonordisk.com.cn" && countryEntries[0]![1] === "China"));
}

const EXACT_NOVO_CHINA_SOURCE_ID = "source-novo-nordisk-china-social";
const EXACT_NOVO_CHINA_COMPANY_ID = "company-novo-nordisk-china";
const EXACT_NOVO_CHINA_ENTRY_URL =
  "https://www.novonordisk.com.cn/careers/find-a-job/career-search-results.html?searchText=&countries=China&categories=";
const EXACT_NOVO_CHINA_ENDPOINT =
  "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";

function isExactNovoChinaCityPolicy(input: {
  config: Extract<OfficialJsonFetchConfig, { kind: "innovent" | "novo-nordisk" }>;
  entryUrl: string;
  sourceIdentity: { id: string; companyId: string };
  endpoint: string;
}): boolean {
  return input.config.kind === "novo-nordisk" &&
    input.config.cityScopePolicy === "NOVO_CHINA_MAINLAND_JOB_CITY_V1" &&
    input.sourceIdentity.id === EXACT_NOVO_CHINA_SOURCE_ID &&
    input.sourceIdentity.companyId === EXACT_NOVO_CHINA_COMPANY_ID &&
    input.entryUrl === EXACT_NOVO_CHINA_ENTRY_URL &&
    input.config.endpointUrl === EXACT_NOVO_CHINA_ENDPOINT &&
    input.endpoint === EXACT_NOVO_CHINA_ENDPOINT &&
    isNovoChinaMainlandRequest(input.endpoint);
}

function reviewNovoChinaMainlandCity(
  locationRaw: string,
  city: string | undefined
): { scope: "CHINA" | "OUT_OF_SCOPE" | "AMBIGUOUS"; cities: string[] } {
  const combined = `${locationRaw} ${city ?? ""}`.normalize("NFKC");
  if (explicitlyForeignOrNonMainlandLocation(combined)) {
    return { scope: "OUT_OF_SCOPE", cities: [] };
  }

  const locationSegments = locationRaw.normalize("NFKC")
    .split(/[,，;；、/|()（）\r\n]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!locationSegments.some(isNovoChinaMainlandCountrySegment)) {
    return { scope: "AMBIGUOUS", cities: [] };
  }

  const cityCandidate = city?.normalize("NFKC").trim() ||
    locationSegments.find((segment) => !isNovoChinaMainlandCountrySegment(segment));
  if (!cityCandidate || isNovoChinaMainlandCountrySegment(cityCandidate) ||
    explicitlyForeignOrNonMainlandLocation(cityCandidate)) {
    return { scope: "AMBIGUOUS", cities: [] };
  }

  return {
    scope: "CHINA",
    cities: citiesWithFallback(`${cityCandidate} ${locationRaw}`, cityCandidate)
  };
}

function isNovoChinaMainlandCountrySegment(value: string): boolean {
  return /^(?:china(?:\s+mainland)?|mainland\s+china|prc|people['’]?s republic of china|中国|中国大陆|中华人民共和国)$/iu.test(
    value.normalize("NFKC").trim()
  );
}

function officialJsonJobUrl(kind: "innovent" | "novo-nordisk", officialId: string): string {
  const origin = kind === "innovent" ? "https://www.innoventbio.com" : "https://www.novonordisk.com";
  const expectedPath = kind === "innovent"
    ? `/cn/recruit/${officialId}`
    : `/careers/find-a-job/job-ad.${officialId}.html`;
  const url = new URL(expectedPath, origin);
  if (url.origin !== origin || url.pathname !== expectedPath || url.search || url.hash) {
    throw new Error("Official JSON official job URL failed path round-trip validation");
  }
  return url.toString();
}

function isStrictRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function safeOfficialJsonFailure(error: unknown, fallback: string): string {
  if (error instanceof Error && /^Official JSON [A-Za-z ]+$/.test(error.message)) return error.message;
  return fallback;
}

function failedWithEvidence(
  capturedAt: string,
  failureReason: string,
  fetchEvidence: NonNullable<Extract<SourceFetchResult, { ok: false }>["fetchEvidence"]>,
  transportFailure?: SourceTransportFailure
): Extract<SourceFetchResult, { ok: false }> {
  return {
    ok: false,
    capturedAt,
    failureReason,
    fetchEvidence,
    ...(transportFailure ? { transportFailure } : {})
  };
}

async function fetchRedseaZpChannel({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "redsea-zp-channel" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  let origin: string;
  let channels: string[];
  let safeEntryUrl: string;
  const sortName = config.sortName ?? "zri.ext_rankNum";
  try {
    safeEntryUrl = safeOfficialJsonEndpoint(entryUrl);
    const parsedEntry = new URL(safeEntryUrl);
    if (!Array.isArray(config.channels) || config.channels.some((binding) =>
      !isStrictRecord(binding) ||
      JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify(["channelQrId", "purpose"]) ||
      !safeOfficialJsonId(stringValue(binding.channelQrId) ?? "") ||
      (binding.purpose !== "SOCIAL" && binding.purpose !== "CAMPUS"))) {
      throw new Error("invalid Redsea channel bindings");
    }
    const configuredIds = config.channels.map(({ channelQrId }) => channelQrId);
    channels = config.channels
      .filter(({ purpose }) => purpose === "SOCIAL")
      .map(({ channelQrId }) => channelQrId);
    if (channels.length !== 1 || new Set(configuredIds).size !== configuredIds.length ||
      !safeOfficialJsonId(config.rootId) ||
      config.paginationPolicy !== "SINGLE_UNPAGINATED_RESPONSE_V1" ||
      sortName !== "zri.ext_rankNum" || parsedEntry.search || parsedEntry.hash ||
      parsedEntry.pathname !== `/RedseaPlatform/zhaopin/zpChannelQrCode/${channels[0]}/officeWebsite.mob`) {
      throw new Error("invalid Redsea config");
    }
    origin = parsedEntry.origin;
  } catch {
    return failed(capturedAt, "Redsea channel configuration is invalid");
  }
  const jobs: NormalizedOfficialJsonJob[] = [];
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
  const seen = new Map<string, string>();
  const responseFingerprints = new Set<string>();
  let previousCapturedAtMs = Date.parse(capturedAt);

  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channelQrId = channels[channelIndex]!;
    const cookieJar = new Map<string, string>();
    const channelEntryUrl = redseaChannelEntryUrl(origin, channelQrId);
    let entryResponse: OfficialJsonHttpResponse;
    try { entryResponse = await http({ url: channelEntryUrl, method: "GET", headers: redseaHtmlHeaders() }); }
    catch { return redseaFailure(capturedAt, "Redsea entry transport failed", artifacts, pages, counts, losses); }
    let entryArtifactResult: ReturnType<typeof redseaArtifact>;
    try { entryArtifactResult = redseaArtifact(channelQrId, "entry", "OFFICIAL_COMPANY_PAGE", channelEntryUrl, entryResponse); }
    catch { return redseaFailure(capturedAt, "Redsea entry response is invalid", artifacts, pages, counts, losses); }
    artifacts.push(entryArtifactResult.artifact);
    try { previousCapturedAtMs = assertRedseaResponse(entryResponse, channelEntryUrl, "html", capturedAt, now, previousCapturedAtMs); }
    catch { return redseaFailure(capturedAt, "Redsea entry response is invalid", artifacts, pages, counts, losses); }
    if (entryResponse.status < 200 || entryResponse.status >= 300) return redseaFailure(capturedAt, "Redsea entry response is invalid", artifacts, pages, counts, losses);
    absorbCookies(cookieJar, entryResponse.setCookie);

    const officePageUrl = new URL("/RedseaPlatform/zhaopin/zpChannelQrCode/officePage.mob", origin);
    officePageUrl.searchParams.set("noHead", "1");
    officePageUrl.searchParams.set("pageId", "list");
    officePageUrl.searchParams.set("configId", channelQrId);
    officePageUrl.searchParams.set("lectureId", "");
    let officePageResponse: OfficialJsonHttpResponse;
    try { officePageResponse = await http({
      url: officePageUrl.toString(),
      method: "GET",
      headers: {
        ...redseaHtmlHeaders(),
        Cookie: cookieHeader(cookieJar),
        Referer: channelEntryUrl
      }
    }); } catch { return redseaFailure(capturedAt, "Redsea list transport failed", artifacts, pages, counts, losses); }
    let officeArtifactResult: ReturnType<typeof redseaArtifact>;
    try { officeArtifactResult = redseaArtifact(channelQrId, "list", "OFFICIAL_COMPANY_PAGE", officePageUrl.toString(), officePageResponse); }
    catch { return redseaFailure(capturedAt, "Redsea list response is invalid", artifacts, pages, counts, losses); }
    artifacts.push(officeArtifactResult.artifact);
    try { previousCapturedAtMs = assertRedseaResponse(officePageResponse, officePageUrl.toString(), "html", capturedAt, now, previousCapturedAtMs); }
    catch { return redseaFailure(capturedAt, "Redsea list response is invalid", artifacts, pages, counts, losses); }
    if (officePageResponse.status < 200 || officePageResponse.status >= 300) return redseaFailure(capturedAt, "Redsea list response is invalid", artifacts, pages, counts, losses);
    absorbCookies(cookieJar, officePageResponse.setCookie);

    const apiUrl = new URL("/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob", origin).toString();
    const requestForm = {
      channelQrId,
      sortName,
      peopleId: "",
      root_id: config.rootId,
      shareStaff: "",
      push_request_id: "",
      keyword: "",
      ftl_list_stru_id: ""
    };
    const requestBody = new URLSearchParams(requestForm).toString();
    let listResponse: OfficialJsonHttpResponse;
    try { listResponse = await http({
      url: apiUrl,
      method: "POST",
      headers: {
        Accept: "application/json,text/javascript,*/*;q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "job-search-crawler/0.1",
        Cookie: cookieHeader(cookieJar),
        Referer: channelEntryUrl
      },
      body: requestBody
    }); } catch { return redseaFailure(capturedAt, "Redsea API transport failed", artifacts, pages, counts, losses); }
    let apiArtifactResult: ReturnType<typeof redseaArtifact>;
    try { apiArtifactResult = redseaArtifact(channelQrId, "api", "PAGINATION_PAGE", apiUrl, listResponse,
      requestContractV2Locator(
        `redsea-channel-v2|channel:${irreversibleOfficialJsonEvidenceId(channelQrId)}|json:$.state,$.total,$.jsonList[*]`,
        {
          family: "redsea",
          role: "single-unpaginated-response",
          method: "POST",
          url: apiUrl,
          body: requestForm,
          coordinate: { sequence: channelIndex, channelQrId, paginationPolicy: config.paginationPolicy }
        }
      )); }
    catch { return redseaFailure(capturedAt, "Redsea API response is invalid", artifacts, pages, counts, losses); }
    artifacts.push(apiArtifactResult.artifact);
    try { previousCapturedAtMs = assertRedseaResponse(listResponse, apiUrl, "json", capturedAt, now, previousCapturedAtMs); }
    catch {
      pages.push(redseaPageTrace(apiArtifactResult.artifact, channelIndex, channelQrId, [], [], "FAILED"));
      return redseaFailure(capturedAt, "Redsea API response is invalid", artifacts, pages, counts, losses);
    }
    if (listResponse.status < 200 || listResponse.status >= 300 || apiArtifactResult.redacted) {
      pages.push(redseaPageTrace(apiArtifactResult.artifact, channelIndex, channelQrId, [], [], "FAILED"));
      return redseaFailure(capturedAt, apiArtifactResult.redacted ? "Redsea API state is unsuccessful" : "Redsea API response is invalid", artifacts, pages, counts, losses);
    }
    const parsed = parseRedseaQueryPostList(listResponse.body);
    if (!parsed.ok) {
      pages.push(redseaPageTrace(apiArtifactResult.artifact, channelIndex, channelQrId, [], [], "FAILED"));
      return redseaFailure(capturedAt, parsed.failureReason, artifacts, pages, counts, losses);
    }
    const fingerprint = sha256Bytes(Buffer.from(listResponse.body, "utf8")).sha256;
    const repeatedResponse = responseFingerprints.has(fingerprint);
    responseFingerprints.add(fingerprint);
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let recordIndex = 0; recordIndex < parsed.jobs.length; recordIndex += 1) {
      const raw = parsed.jobs[recordIndex]; counts.rawCount += 1;
      const rawId = isStrictRecord(raw) ? stringValue(raw.REQUEST_ID) : undefined;
      const evidenceId = irreversibleOfficialJsonEvidenceId(rawId ?? raw);
      if (!rawIds.includes(evidenceId)) rawIds.push(evidenceId);
      const locator = `${apiArtifactResult.artifact.logicalKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex, raw])}`;
      if (!isStrictRecord(raw)) { recordRedseaLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", locator, channelIndex, recordIndex); continue; }
      counts.parsedCount += 1;
      const normalized = normalizeRedseaJob({ origin, channelQrId, rootId: config.rootId, job: raw });
      if (!normalized.ok) { recordRedseaLoss(losses, counts, "VALIDATION", normalized.code, locator, channelIndex, recordIndex, normalized.field); continue; }
      const signature = irreversibleOfficialJsonEvidenceId({ requestId: normalized.requestId,
        title: normalized.job.title, locationRaw: normalized.job.locationRaw });
      const prior = seen.get(normalized.requestId);
      if (prior !== undefined) { recordRedseaLoss(losses, counts, "VALIDATION", prior === signature ? "DUPLICATE_OFFICIAL_ID" : "CONFLICTING_OFFICIAL_ID", locator, channelIndex, recordIndex, "REQUEST_ID",
        repeatedResponse ? "REPEATED_RESPONSE_CONTENT" : undefined); continue; }
      seen.set(normalized.requestId, signature); jobs.push(normalized.job); counts.validCount += 1;
      validIds.push(persistentOfficialJsonJobId(normalized.requestId));
    }
    const terminal: SourceFetchPageTrace["termination"] = parsed.jobs.length === 0 ? "ABORTED" : "NEXT_ABSENT";
    pages.push(redseaPageTrace(apiArtifactResult.artifact, channelIndex, channelQrId, rawIds, validIds, terminal, repeatedResponse));
  }
  const declarationPage = pages.length === 1 && pages[0]!.termination === "NEXT_ABSENT" ? pages[0] : undefined;
  const declarationArtifact = declarationPage
    ? artifacts.find((artifact) => artifact.logicalKey === declarationPage.artifactLogicalKey)
    : undefined;
  const declaredCompleteness = declarationPage && declarationArtifact
    ? {
        kind: "COMPLETE_PAGE_TRAVERSAL" as const,
        value: 1,
        artifactLogicalKey: declarationArtifact.logicalKey,
        extractorLocator: declarationArtifact.extractorLocator,
        scope: "CHANNEL" as const,
        channelId: declarationPage.channelId!
      }
    : undefined;
  const finalized = finalizeOfficialJsonEvidenceBundle({
    artifacts,
    pages,
    fetchCounts: counts,
    fetchLosses: losses,
    expectedChannelIds: channels,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  });
  const verified = finalized.evaluation.verifiedEligible && losses.length === 0;
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: verified ? "VERIFIED" : "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
      completenessEvidenceUrl: safeEntryUrl,
      pagesVisited: pages.length
    },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

async function fetchXiuzhengJobList({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "xiuzheng-job-list" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  const pageSize = config.pageSize ?? 10;
  const maxPages = config.maxPages ?? 20;
  let safeEntryUrl: string;
  try {
    safeEntryUrl = entryUrl;
    safeOfficialJsonEvidenceUrl(entryUrl);
    if (entryUrl !== "https://www.xiuzheng.com/#/recruit" ||
        config.endpointUrl !== "https://www.xiuzheng.com/front/human-resource/job-list" ||
        config.detailBaseUrl !== "https://www.xiuzheng.com/#/recruitDetail" ||
        (config.defaultLocationRaw !== undefined && config.defaultLocationRaw !== "未披露") ||
        !Number.isSafeInteger(pageSize) || pageSize <= 0 ||
        !Number.isSafeInteger(maxPages) || maxPages <= 0) throw new Error("invalid Xiuzheng config");
  } catch {
    return failed(capturedAt, "Xiuzheng job-list configuration is invalid");
  }
  const jobs: NormalizedOfficialJsonJob[] = [];
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
  const seen = new Map<string, string>();
  let declarations: { total?: number; lastPage?: number; perPage?: number } | undefined;
  let declaredArtifact: SourceFetchArtifactDraft | undefined;
  let previousCapturedAtMs = Date.parse(capturedAt);

  for (let page = 1; page <= maxPages; page += 1) {
    const requestBody = { page, pageSize };
    let response: OfficialJsonHttpResponse;
    try { response = await http({ url: config.endpointUrl, method: "POST", headers: {
      Accept: "application/json", "Content-Type": "application/json", Referer: safeEntryUrl,
      "User-Agent": "job-search-crawler/0.1"
    }, body: JSON.stringify(requestBody) }); }
    catch { return xiuzhengFailure(capturedAt, "Xiuzheng job-list transport failed", artifacts, pages, counts, losses, xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact)); }
    const redaction = redactXiuzhengSensitiveBody(response.body, response.setCookie);
    const safeResponse = { ...response, body: redaction.body };
    const logicalKey = `xiuzheng-page-${String(page).padStart(4, "0")}`;
    let artifact: SourceFetchArtifactDraft;
    try {
      artifact = officialJsonNetworkArtifact({ id: logicalKey, logicalKey, kind: "PAGINATION_PAGE",
        requestedUrl: config.endpointUrl, response: safeResponse,
        extractorLocator: requestContractV2Locator(xiuzhengLocator(page, pageSize), {
          family: "xiuzheng", role: "page", method: "POST", url: config.endpointUrl, body: requestBody,
          coordinate: { sequence: page - 1, requestedPage: page, requestedPageSize: pageSize }
        }),
        bodyRepresentation: redaction.redacted ? "REDACTED" : "EXACT",
        ...(redaction.redacted ? { rawBodySha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
          redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: redaction.count }] } : {}) });
      artifacts.push(artifact);
      assertOfficialJsonEvidenceResponse(response, { requestedUrl: config.endpointUrl,
        crawlStartedAtMs: Date.parse(capturedAt), observedNowMs: now().getTime() });
      assertOfficialJsonMime(response);
      const currentTime = Date.parse(response.capturedAt!);
      if (currentTime < previousCapturedAtMs) throw new Error("capture time reversed");
      previousCapturedAtMs = currentTime;
    } catch {
      return xiuzhengFailure(capturedAt, "Xiuzheng job-list response metadata is invalid", artifacts, pages, counts, losses, xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact));
    }
    if (response.status < 200 || response.status >= 300) {
      return xiuzhengFailure(capturedAt, `Xiuzheng job-list returned HTTP ${response.status}`, artifacts, pages, counts, losses, xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact));
    }
    const parsed = parseXiuzhengJobListResponse(response.body);
    if (!parsed.ok) return xiuzhengFailure(capturedAt, parsed.failureReason, artifacts, pages, counts, losses, xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact));
    const rawIds: string[] = [];
    const validIds: string[] = [];
    const lossCountBeforePage = losses.length;
    for (let recordIndex = 0; recordIndex < parsed.rawJobs.length; recordIndex += 1) {
      const raw = parsed.rawJobs[recordIndex]; counts.rawCount += 1;
      rawIds.push(irreversibleOfficialJsonEvidenceId([recordIndex, raw]));
      const locator = `${logicalKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex, raw])}`;
      if (!isStrictRecord(raw)) { recordXiuzhengLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", locator, page - 1, recordIndex); continue; }
      counts.parsedCount += 1;
      const normalized = normalizeXiuzhengJob(config, raw);
      if (!normalized.ok) { recordXiuzhengLoss(losses, counts, "VALIDATION", normalized.code, locator, page - 1, recordIndex, normalized.field); continue; }
      const signature = irreversibleOfficialJsonEvidenceId({ title: normalized.job.title, locationRaw: normalized.job.locationRaw, officialUrl: normalized.job.officialUrl });
      const prior = seen.get(normalized.sourceJobId);
      if (prior !== undefined) { recordXiuzhengLoss(losses, counts, "VALIDATION", prior === signature ? "DUPLICATE_OFFICIAL_ID" : "CONFLICTING_OFFICIAL_ID", locator, page - 1, recordIndex, "id"); continue; }
      seen.set(normalized.sourceJobId, signature); jobs.push(normalized.job); counts.validCount += 1;
      validIds.push(persistentOfficialJsonJobId(normalized.sourceJobId));
    }
    if (redaction.redacted && !losses.slice(lossCountBeforePage).some((loss) => loss.details.code === "SENSITIVE_OUTPUT")) {
      return xiuzhengFailure(capturedAt, "Xiuzheng job-list response contains sensitive material", artifacts, pages, counts, losses, xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact));
    }
    const declarationFailure = xiuzhengDeclarationFailure({ requestedPage: page, requestedPageSize: pageSize,
      rawPageSize: parsed.rawJobs.length, cumulativeRawCount: counts.rawCount, current: parsed,
      ...(declarations ? { prior: declarations } : {}) });
    const terminal: SourceFetchPageTrace["termination"] = declarationFailure ? "FAILED" :
      parsed.total === 0 && page === 1 ? "EMPTY_PAGE" :
      parsed.lastPage !== undefined && page < parsed.lastPage ? "CONTINUE" :
      parsed.lastPage !== undefined && page === parsed.lastPage &&
        parsed.total !== undefined && counts.rawCount === parsed.total ? "NEXT_ABSENT" : "ABORTED";
    pages.push(xiuzhengPageTrace({ artifact, sequence: page - 1, requestedPage: page,
      requestedPageSize: pageSize, parsed, rawIds, validIds, termination: terminal }));
    if (declarationFailure) return xiuzhengFailure(capturedAt, "Xiuzheng pagination declaration is inconsistent", artifacts, pages, counts, losses, xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact));
    declarations = { ...(parsed.total === undefined ? {} : { total: parsed.total }),
      ...(parsed.lastPage === undefined ? {} : { lastPage: parsed.lastPage }),
      ...(parsed.perPage === undefined ? {} : { perPage: parsed.perPage }) };
    declaredArtifact ??= artifact;
    if (terminal !== "CONTINUE") break;
  }
  if (pages.length === maxPages && pages[pages.length - 1]?.termination === "CONTINUE") {
    pages[pages.length - 1] = { ...pages[pages.length - 1]!, termination: "MAX_PAGE_LIMIT",
      anomalyCodes: [...pages[pages.length - 1]!.anomalyCodes, "MAX_PAGES_WITH_NEXT"] };
  }
  const declaredCompleteness = config.scopeExclusionProof === "XIUZHENG_NON_RECRUITMENT_TITLE_V1"
    ? sourceTraversalCompleteness(pages, artifacts)
    : xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact);
  const finalized = finalizeOfficialJsonEvidenceBundle({ artifacts, pages, fetchCounts: counts, fetchLosses: losses,
    ...(declaredCompleteness ? { declaredCompleteness } : {}) });
  return {
    ok: true, capturedAt, payload: { jobs }, completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(config.scopeExclusionProof || declarations?.total === undefined ? {} : { expectedJobCount: declarations.total }),
      completenessEvidenceKind: config.scopeExclusionProof
        ? "COMPLETE_PAGE_TRAVERSAL"
        : declarations?.total === undefined ? "WEAK_MANUAL_SAMPLE" : "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: safeEntryUrl,
      completenessBlockerReason: "Xiuzheng pagination and China scope require independent manual review",
      ...(declarations?.lastPage === undefined ? {} : { totalPages: declarations.lastPage }), pageSize, pagesVisited: pages.length
    }, fetchEvidence: finalized.evidence, paginationEvaluation: finalized.evaluation
  };
}

function assertCnstaffMime(
  response: OfficialJsonHttpResponse,
  requestedUrl: string,
  entryUrl: string
): void {
  try {
    assertOfficialJsonMime(response);
    return;
  } catch (error) {
    const contentType = response.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    const exactEntryUrl = "https://daiichisankyo.cnstaff.com/recruit";
    let requested: URL;
    try {
      requested = new URL(requestedUrl);
    } catch {
      throw error;
    }
    const page = requested.searchParams.get("p");
    const expected = new URL(exactEntryUrl);
    if (page && /^[1-9]\d*$/u.test(page)) {
      expected.searchParams.set("n", "1");
      expected.searchParams.set("p", page);
    }
    let root: unknown;
    try {
      root = JSON.parse(response.body);
    } catch {
      throw error;
    }
    if (
      contentType !== "text/html" || entryUrl !== exactEntryUrl ||
      requested.href !== expected.href || !hasUniqueJsonObjectKeys(response.body) ||
      !isStrictRecord(root) || !Array.isArray(root.list) || !isStrictRecord(root.page)
    ) {
      throw error;
    }
  }
}

async function fetchHcmCloud({
  http,
  config,
  entryUrl,
  capturedAt,
  now,
  browserFetch
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "hcm-cloud" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
  browserFetch?: HcmCloudBrowserFetch;
}): Promise<SourceFetchResult> {
  let safeEntryUrl: string;
  let entryEvidenceUrl: string;
  try {
    safeEntryUrl = safeOfficialJsonEndpoint(entryUrl);
    entryEvidenceUrl = safeOfficialJsonEvidenceUrl(safeEntryUrl);
    if ((config.countCoordinatePolicy === "LUNAN_AGGREGATE_ROW" ||
        config.responsePrefixPolicy === "LUNAN_RANDOM_ALNUM3" ||
        config.listPaginationPolicy === "LUNAN_REQUEST_BOUND_PAGE_V1") &&
        safeEntryUrl !== "https://hcm.lunan.com.cn/recruit") {
      throw new Error("Lunan count policy requires the exact official entry");
    }
    if (config.responsePrefixPolicy === "LUNAN_RANDOM_ALNUM3" &&
        config.countCoordinatePolicy !== "LUNAN_AGGREGATE_ROW") {
      throw new Error("Lunan response prefix policy requires the aggregate count policy");
    }
    if (config.listPaginationPolicy === "LUNAN_REQUEST_BOUND_PAGE_V1" &&
        (config.countCoordinatePolicy !== "LUNAN_AGGREGATE_ROW" ||
          config.responsePrefixPolicy !== "LUNAN_RANDOM_ALNUM3")) {
      throw new Error("Lunan request-bound pagination requires the audited count and prefix policies");
    }
  } catch {
    return failed(capturedAt, "HCMCloud official entry URL is invalid");
  }
  const entry = new URL(safeEntryUrl);
  const countUrl = new URL("/api/hcm.model.count?model=ReleaseJobMgr", entry.origin).toString();
  const listUrl = new URL("/api/hcm.model.list?model=ReleaseJobMgr", entry.origin).toString();
  const directResult = await fetchHcmCloudWithPost({
    config,
    entryUrl: safeEntryUrl,
    entryEvidenceUrl,
    origin: entry.origin,
    capturedAt,
    now,
    post: (endpoint, body) =>
      http({
        url: endpoint === "count" ? countUrl : listUrl,
        method: "POST",
        headers: hcmCloudHeaders(safeEntryUrl),
        body
      })
  });
  if (directResult.ok || !browserFetch ||
      !isRetryableSourceTransportFailure(directResult.transportFailure)) return directResult;

  const transportAttempts: SourceTransportAttempt[] = [{
    transport: "DIRECT_HTTP",
    outcome: "FAILED",
    code: "HCM_DIRECT_FAILED",
    capturedAt: directResult.capturedAt,
    ...(directResult.fetchEvidence ? { fetchEvidence: directResult.fetchEvidence } : {}),
    ...(directResult.paginationEvaluation ? { paginationEvaluation: directResult.paginationEvaluation } : {})
  }];
  let session: HcmCloudBrowserSession | undefined;
  const signal = currentOfficialSourceAttemptSignal();
  try {
    session = await browserFetch({ config, entryUrl: safeEntryUrl, capturedAt, ...(signal ? { signal } : {}) });
  } catch {
    if (signal?.aborted) throw signal.reason;
    return { ok: false, capturedAt, failureReason: "HCMCloud browser session failed",
      transportFailure: { code: "OFFICIAL_BROWSER_SESSION_ERROR", retryable: true, stage: "ENTRY" },
      priorTransportAttempts: [
      ...transportAttempts,
      { transport: "BROWSER_SESSION", outcome: "FAILED", code: "HCM_BROWSER_SESSION_FAILED", capturedAt }
    ] };
  }
  try {
    assertHcmCloudBrowserSession(session);
  } catch {
    const close = (session as unknown as { close?: unknown })?.close;
    if (typeof close === "function") {
      try { await close.call(session); } catch { /* invalid-session cleanup must not replace failure */ }
    }
    return { ok: false, capturedAt, failureReason: "HCMCloud browser session failed", priorTransportAttempts: [
      ...transportAttempts,
      { transport: "BROWSER_SESSION", outcome: "FAILED", code: "HCM_BROWSER_SESSION_FAILED", capturedAt }
    ] };
  }

  let entryArtifact: SourceFetchArtifactDraft | undefined;
  try {
    entryArtifact = hcmCloudBrowserEntryArtifact(safeEntryUrl, session.entryResponse);
    assertOfficialJsonEvidenceResponse(session.entryResponse, {
      requestedUrl: safeEntryUrl,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    });
    if (session.entryResponse.status < 200 || session.entryResponse.status >= 300 ||
      !/^text\/html(?:\s*;|$)/iu.test(session.entryResponse.contentType ?? "")) {
      const failure = hcmCloudBrowserEntryFailure(capturedAt, entryArtifact);
      return { ...failure, priorTransportAttempts: [...transportAttempts, {
        transport: "BROWSER_SESSION", outcome: "FAILED", code: "HCM_BROWSER_ENTRY_FAILED", capturedAt,
        ...(failure.fetchEvidence ? { fetchEvidence: failure.fetchEvidence } : {})
      }] };
    }
    const browserResult = await fetchHcmCloudWithPost({
      config, entryUrl: safeEntryUrl, entryEvidenceUrl, origin: entry.origin, capturedAt, now,
      post: session.post,
      initialArtifacts: [entryArtifact],
      initialCapturedAtMs: Date.parse(session.entryResponse.capturedAt!),
      artifactPrefix: "browser-"
    });
    if (browserResult.ok) return { ...browserResult, priorTransportAttempts: [
      ...transportAttempts,
      { transport: "BROWSER_SESSION", outcome: "SUCCEEDED", code: "HCM_BROWSER_SUCCEEDED", capturedAt,
        ...(browserResult.paginationEvaluation ? { paginationEvaluation: browserResult.paginationEvaluation } : {}) }
    ] };
    const code = browserResult.fetchEvidence?.pages.length ||
      browserResult.fetchEvidence?.supportingArtifactOnlyFailure?.code === "HCM_LIST_RESPONSE_FAILED"
      ? "HCM_BROWSER_LIST_FAILED" as const
      : "HCM_BROWSER_COUNT_FAILED" as const;
    return {
      ...browserResult,
      failureReason: code === "HCM_BROWSER_LIST_FAILED"
        ? "HCMCloud browser list failed"
        : "HCMCloud browser count failed",
      priorTransportAttempts: [...transportAttempts, {
        transport: "BROWSER_SESSION", outcome: "FAILED", code, capturedAt,
        ...(browserResult.fetchEvidence ? { fetchEvidence: browserResult.fetchEvidence } : {}),
        ...(browserResult.paginationEvaluation ? { paginationEvaluation: browserResult.paginationEvaluation } : {})
      }]
    };
  } catch {
    const failure = hcmCloudBrowserEntryFailure(capturedAt, entryArtifact);
    return { ...failure, priorTransportAttempts: [...transportAttempts, {
      transport: "BROWSER_SESSION", outcome: "FAILED", code: "HCM_BROWSER_ENTRY_FAILED", capturedAt,
      ...(failure.fetchEvidence ? { fetchEvidence: failure.fetchEvidence } : {})
    }] };
  } finally {
    try { await session.close(); } catch { /* cleanup failures are non-evidence operational details */ }
  }
}

async function fetchSandozJsonApi({
  http,
  config,
  entryUrl,
  sourceIdentity,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>;
  entryUrl: string;
  sourceIdentity: { id: string; companyId: string };
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  const pageSize = config.pageSize ?? 10;
  const maxPages = config.maxPages ?? 50;
  let endpoint: URL;
  let taxonomyEndpoint: URL;
  let safeEntryUrl: string;
  let detailBase: URL;
  try {
    if (pageSize !== 10 ||
        !Number.isSafeInteger(maxPages) || maxPages <= 0 ||
        config.countryTermName !== "LOC_CN" || config.countryTermTargetId !== 806 ||
        config.countryTermUuid !== "2f829192-01a9-4909-b729-baab0b0bad0c") {
      throw new Error("invalid limits or country term");
    }
    safeEntryUrl = safeOfficialJsonEndpoint(entryUrl);
    endpoint = sandozEndpoint(config.endpointUrl);
    taxonomyEndpoint = sandozTaxonomyEndpoint(config.taxonomyEndpointUrl);
    detailBase = sandozDetailBase(config.detailBaseUrl);
    const officialEntry = new URL(safeEntryUrl);
    if (officialEntry.href !== "https://www.sandoz.com/careers/job-search/" || entryUrl !== officialEntry.href ||
        detailBase.origin !== officialEntry.origin) {
      throw new Error("unbound official origin");
    }
  } catch {
    return failed(capturedAt, "Sandoz JSONAPI configuration is invalid");
  }
  const jobs: NormalizedOfficialJsonJob[] = [];
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = {
    rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0
  };
  const seen = new Map<string, { resourceId: string; signature: string }>();
  const seenResourceIds = new Map<string, { officialId: string; signature: string }>();
  let declaredTotal: number | undefined;
  let declaredArtifactKey: string | undefined;
  let previousNext: string | null = null;
  let previousCapturedAtMs = Date.parse(capturedAt);
  let bearerToken: string;
  try {
    const entry = await http({ url: safeEntryUrl, method: "GET", headers: { Accept: "text/html", "User-Agent": "job-search-crawler/0.1" } });
    assertOfficialJsonEvidenceResponse(entry, { requestedUrl: safeEntryUrl, crawlStartedAtMs: Date.parse(capturedAt), observedNowMs: now().getTime() });
    const entryRedaction = redactSandozSensitiveBody(entry.body, entry.setCookie);
    const safeEntryResponse = { ...entry, body: entryRedaction.body };
    const artifact = officialJsonNetworkArtifact({ id: "sandoz-entry", logicalKey: "sandoz-entry", kind: "OFFICIAL_COMPANY_PAGE",
      requestedUrl: safeEntryUrl, response: safeEntryResponse,
      extractorLocator: "sandoz-token-discovery-v2|credential-provenance:structured",
      bodyRepresentation: entryRedaction.redacted ? "REDACTED" : "EXACT",
      ...(entryRedaction.redacted ? {
        rawBodySha256: sha256Bytes(Buffer.from(entry.body, "utf8")).sha256,
        redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: entryRedaction.count }]
      } : {}) });
    artifacts.push(artifact);
    if (entry.status < 200 || entry.status >= 300) {
      return sandozFailure(capturedAt, `Sandoz entry page returned HTTP ${entry.status}`, artifacts, pages, counts, losses);
    }
    assertOfficialHtmlMime(entry);
    bearerToken = extractSandozBearerToken(entry.body);
  } catch (error) {
    return sandozFailure(capturedAt, safeOfficialJsonFailure(error, "Sandoz entry/token evidence is invalid"), artifacts, pages, counts, losses);
  }

  const authorizationHeaders = {
    Accept: "application/vnd.api+json,application/json",
    Referer: safeEntryUrl,
    Authorization: ["Bearer", bearerToken].join(" "),
    "User-Agent": "job-search-crawler/0.1"
  };
  const taxonomyUrl = sandozTaxonomyUrl(taxonomyEndpoint, config.countryTermTargetId);
  try {
    const response = await http({ url: taxonomyUrl, method: "GET", headers: authorizationHeaders });
    assertOfficialJsonEvidenceResponse(response, {
      requestedUrl: taxonomyUrl,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    });
    const redaction = redactSandozSensitiveBody(response.body, response.setCookie);
    const artifact = officialJsonNetworkArtifact({
      id: "sandoz-taxonomy",
      logicalKey: "sandoz-taxonomy",
      kind: "ATS_API_RESPONSE",
      requestedUrl: taxonomyUrl,
      response: { ...response, body: redaction.body },
      extractorLocator: sandozTaxonomyLocator(config),
      bodyRepresentation: redaction.redacted ? "REDACTED" : "EXACT",
      ...(redaction.redacted ? {
        rawBodySha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
        redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: redaction.count }]
      } : {})
    });
    artifacts.push(artifact);
    const artifactCapturedAtMs = Date.parse(artifact.capturedAt);
    if (artifactCapturedAtMs < previousCapturedAtMs) throw new Error("capture time moved backwards");
    previousCapturedAtMs = artifactCapturedAtMs;
    if (redaction.redacted || response.status < 200 || response.status >= 300) {
      return sandozFailure(capturedAt, "Sandoz China taxonomy validation failed", artifacts, pages, counts, losses);
    }
    assertOfficialJsonMime(response);
    if (!validateSandozTaxonomy(response.body, config)) {
      return sandozFailure(capturedAt, "Sandoz China taxonomy validation failed", artifacts, pages, counts, losses);
    }
  } catch {
    return sandozFailure(capturedAt, "Sandoz China taxonomy validation failed", artifacts, pages, counts, losses);
  }

  for (let page = 0; page < maxPages; page += 1) {
    const url = sandozProbeUrl(endpoint, config, "primary", page);
    let response: OfficialJsonHttpResponse;
    try { response = await http({ url, method: "GET", headers: authorizationHeaders }); } catch {
      return sandozFailure(capturedAt, "Sandoz JSONAPI transport failed", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    try { assertOfficialJsonEvidenceResponse(response, { requestedUrl: url, crawlStartedAtMs: Date.parse(capturedAt), observedNowMs: now().getTime() }); }
    catch { return sandozFailure(capturedAt, "Sandoz JSONAPI response metadata is invalid", artifacts, pages, counts, losses,
      sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey)); }
    const apiRedaction = redactSandozSensitiveBody(response.body, response.setCookie);
    const artifactId = `sandoz-primary-page-${String(page).padStart(4, "0")}`;
    const artifact = officialJsonNetworkArtifact({ id: artifactId, logicalKey: artifactId, kind: "PAGINATION_PAGE",
      requestedUrl: url, response: { ...response, body: apiRedaction.body }, extractorLocator: sandozLocator("primary", page, pageSize, false),
      bodyRepresentation: apiRedaction.redacted ? "REDACTED" : "EXACT",
      ...(apiRedaction.redacted ? {
        rawBodySha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
        redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: apiRedaction.count }]
      } : {}) });
    artifacts.push(artifact);
    const artifactCapturedAtMs = Date.parse(artifact.capturedAt);
    if (artifactCapturedAtMs < previousCapturedAtMs) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI response capture time moved backwards", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    previousCapturedAtMs = artifactCapturedAtMs;
    if (apiRedaction.redacted) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI response contains sensitive material", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    if (response.status < 200 || response.status >= 300) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, `Sandoz JSONAPI returned HTTP ${response.status}`, artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    try { assertOfficialJsonMime(response); } catch {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI response has an invalid Content-Type", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    let envelope: SandozPageEnvelope;
    try { envelope = parseSandozPageEnvelope(response.body, url, endpoint, config, "primary", page); } catch (error) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, sandozEnvelopeFailureReason(error, false), artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    const pageTotal = envelope.count;
    artifact.extractorLocator = sandozLocator("primary", page, pageSize, true);
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let index = 0; index < envelope.data.length; index += 1) {
      const raw = envelope.data[index]; counts.rawCount += 1;
      const rawId = isStrictRecord(raw) ? stringValue(raw.id) ?? (isStrictRecord(raw.attributes) ? stringValue(raw.attributes.field_job_id) : undefined) : undefined;
      const evidenceId = irreversibleOfficialJsonEvidenceId(rawId ?? raw);
      if (!rawIds.includes(evidenceId)) rawIds.push(evidenceId);
      const locator = `${artifact.logicalKey}#record:${index}#${irreversibleOfficialJsonEvidenceId([index, raw])}`;
      if (!isStrictRecord(raw)) {
        recordSandozLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", locator, page, index);
        pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page,
          requestedPageSize: pageSize, returnedPageSize: envelope.pageSize, rawJobIds: rawIds, validJobIds: validIds,
          declaredTotal: pageTotal, termination: "FAILED" }));
        return sandozFailure(capturedAt, "Sandoz JSONAPI resource validation failed", artifacts, pages, counts, losses,
          sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
      }
      counts.parsedCount += 1;
      const parsed = parseSandozResource(
        config,
        detailBase,
        raw,
        isExactSandozChinaCityPolicy({ config, entryUrl, sourceIdentity })
      );
      if (!parsed.ok) {
        recordSandozLoss(losses, counts, "VALIDATION", parsed.code, locator, page, index, parsed.field);
        pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page,
          requestedPageSize: pageSize, returnedPageSize: envelope.pageSize, rawJobIds: rawIds, validJobIds: validIds,
          declaredTotal: pageTotal, termination: "FAILED" }));
        return sandozFailure(capturedAt, parsed.code === "CAMPUS_BOUNDARY_DRIFT"
          ? "Sandoz social/campus boundary drift detected" : "Sandoz JSONAPI resource validation failed",
        artifacts, pages, counts, losses, sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
      }
      const signature = irreversibleOfficialJsonEvidenceId(parsed.job);
      const priorOfficial = seen.get(parsed.officialId);
      const priorResource = seenResourceIds.get(parsed.resourceId);
      if (priorOfficial !== undefined || priorResource !== undefined) {
        const duplicate = priorOfficial?.resourceId === parsed.resourceId && priorOfficial.signature === signature &&
          priorResource?.officialId === parsed.officialId && priorResource.signature === signature;
        recordSandozLoss(losses, counts, "VALIDATION", duplicate ? "DUPLICATE_OFFICIAL_ID" : "CONFLICTING_OFFICIAL_ID", locator, page, index, "id");
        pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page,
          requestedPageSize: pageSize, returnedPageSize: envelope.pageSize, rawJobIds: rawIds, validJobIds: validIds,
          declaredTotal: pageTotal, termination: "FAILED" }));
        return sandozFailure(capturedAt, "Sandoz JSONAPI duplicate or collision detected", artifacts, pages, counts, losses,
          sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
      }
      seen.set(parsed.officialId, { resourceId: parsed.resourceId, signature });
      seenResourceIds.set(parsed.resourceId, { officialId: parsed.officialId, signature });
      jobs.push(parsed.job); validIds.push(persistentOfficialJsonJobId(parsed.officialId)); counts.validCount += 1;
    }
    if (declaredTotal !== undefined && pageTotal !== declaredTotal) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page, rawJobIds: rawIds,
        validJobIds: validIds, declaredTotal: pageTotal, requestedPageSize: pageSize,
        returnedPageSize: envelope.pageSize, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI count declaration changed", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    if (declaredTotal === undefined) { declaredTotal = pageTotal; declaredArtifactKey = artifact.logicalKey; }
    const next = envelope.next;
    const contradiction = envelope.data.length > pageSize || counts.rawCount > declaredTotal ||
      (declaredTotal === 0 && envelope.data.length > 0) ||
      (next === null && counts.rawCount !== declaredTotal) || (next !== null && counts.rawCount >= declaredTotal);
    if (contradiction) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page, rawJobIds: rawIds,
        validJobIds: validIds, declaredTotal, requestedPageSize: pageSize,
        returnedPageSize: envelope.pageSize, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI declarations contradict observed resources", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    const atMax = page + 1 === maxPages;
    const termination: SourceFetchPageTrace["termination"] =
      envelope.data.length === 0 && page === 0 && declaredTotal === 0 && next === null ? "EMPTY_PAGE" :
      next !== null ? atMax ? "MAX_PAGE_LIMIT" : "CONTINUE" :
      "NEXT_ABSENT";
    pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page, rawJobIds: rawIds,
      validJobIds: validIds, declaredTotal, requestedPageSize: pageSize, returnedPageSize: envelope.pageSize,
      nextPageSignalBefore: previousNext, nextPageSignalAfter: next, termination }));
    if (atMax && next !== null) {
      return sandozFailure(capturedAt, "Sandoz JSONAPI pagination reached max pages with next", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    previousNext = next;
    if (next === null || atMax) break;
  }

  for (const probe of ["alt1", "alt2", "alt3"] as const) {
    const url = sandozProbeUrl(endpoint, config, probe, 0);
    let response: OfficialJsonHttpResponse;
    try { response = await http({ url, method: "GET", headers: authorizationHeaders }); }
    catch {
      return sandozFailure(capturedAt, "Sandoz alternate-country probe transport failed", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    try {
      assertOfficialJsonEvidenceResponse(response, {
        requestedUrl: url,
        crawlStartedAtMs: Date.parse(capturedAt),
        observedNowMs: now().getTime()
      });
    } catch {
      return sandozFailure(capturedAt, "Sandoz alternate-country probe metadata is invalid", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    const redaction = redactSandozSensitiveBody(response.body, response.setCookie);
    const artifactId = `sandoz-${probe}-zero`;
    const artifact = officialJsonNetworkArtifact({
      id: artifactId,
      logicalKey: artifactId,
      kind: "ATS_API_RESPONSE",
      requestedUrl: url,
      response: { ...response, body: redaction.body },
      extractorLocator: sandozLocator(probe, 0, pageSize, true),
      bodyRepresentation: redaction.redacted ? "REDACTED" : "EXACT",
      ...(redaction.redacted ? {
        rawBodySha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
        redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" as const, count: redaction.count }]
      } : {})
    });
    artifacts.push(artifact);
    const artifactCapturedAtMs = Date.parse(artifact.capturedAt);
    if (artifactCapturedAtMs < previousCapturedAtMs || redaction.redacted) {
      return sandozFailure(capturedAt, "Sandoz alternate-country probe metadata is invalid", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    previousCapturedAtMs = artifactCapturedAtMs;
    if (response.status < 200 || response.status >= 300) {
      return sandozFailure(capturedAt, `Sandoz JSONAPI returned HTTP ${response.status}`, artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    try { assertOfficialJsonMime(response); }
    catch {
      return sandozFailure(capturedAt, "Sandoz alternate-country probe metadata is invalid", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    let envelope: SandozPageEnvelope;
    try { envelope = parseSandozPageEnvelope(response.body, url, endpoint, config, probe, 0); }
    catch (error) {
      return sandozFailure(capturedAt, sandozEnvelopeFailureReason(error, true), artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    if (envelope.count !== 0 || envelope.data.length !== 0 || envelope.next !== null) {
      return sandozFailure(capturedAt, "Sandoz alternate-country boundary drift detected", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
  }

  let finalized: ReturnType<typeof finalizeOfficialJsonEvidenceBundle>;
  try { finalized = finalizeOfficialJsonEvidenceBundle({ artifacts, pages, fetchCounts: counts, fetchLosses: losses,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    ...(sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey)
      ? { declaredCompleteness: sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey)! } : {}) }); }
  catch (error) { return sandozFailure(capturedAt, safeOfficialJsonFailure(error, "Sandoz JSONAPI pagination evidence is invalid"),
    artifacts, pages, counts, losses, sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey)); }
  return {
    ok: true, capturedAt,
    payload: { jobs },
    completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(declaredTotal === undefined ? {} : { expectedJobCount: declaredTotal }),
      completenessEvidenceKind: declaredTotal === undefined ? "WEAK_MANUAL_SAMPLE" : "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: safeOfficialJsonEvidenceUrl(safeEntryUrl),
      completenessBlockerReason: "Sandoz completeness awaits downstream adapter reconciliation",
      totalPages: pages.length, pageSize, pagesVisited: pages.length },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

const FIFTY_ONE_JOB_COAPI_PUBLIC_KEY =
  "tuD&#mheJQBlgy&Sm300l8xK^X4NzFYBcrN8@YLCret$fv1AZbtujg*KN^$YnUkh";

async function fetch51jobCoapi({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "51job-coapi" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  let safeEntryUrl: string;
  let scriptUrl: string;
  let detailBase: URL;
  try {
    safeEntryUrl = safeOfficialJsonEvidenceUrl(entryUrl);
    const entry = new URL(safeEntryUrl);
    scriptUrl = safeOfficialJsonEndpoint(config.uiScriptUrl);
    detailBase = new URL(safeOfficialJsonEndpoint(config.detailBaseUrl));
    const script = new URL(scriptUrl);
    if (entry.origin !== "https://campus.51job.com" || script.origin !== entry.origin ||
      detailBase.origin !== entry.origin || !/^\d+$/u.test(config.ctmid) ||
      config.pageSize !== undefined && config.pageSize !== 500) throw new Error();
  } catch {
    return failed(capturedAt, "51job CoAPI source configuration is invalid");
  }

  let scriptResponse: OfficialJsonHttpResponse;
  try {
    scriptResponse = await http({ url: scriptUrl, method: "GET", headers: {
      Accept: "application/javascript,text/javascript,*/*;q=0.1",
      Referer: safeEntryUrl,
      "User-Agent": "job-search-crawler/0.1"
    } });
    assertOfficialJsonEvidenceResponse(scriptResponse, {
      requestedUrl: scriptUrl,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    });
  } catch {
    return failed(capturedAt, "51job recruitment UI script transport or metadata failed");
  }
  if (scriptResponse.status < 200 || scriptResponse.status >= 300) {
    return failed(capturedAt, `51job recruitment UI script returned HTTP ${scriptResponse.status}`);
  }
  const uiExclusions = parse51jobUiExclusions(scriptResponse.body);
  if (!uiExclusions) return failed(capturedAt, "51job recruitment UI exclusion contract is invalid");
  const scriptArtifact = officialJsonNetworkArtifact({
    id: "51job-ui-script",
    logicalKey: "51job-ui-script",
    kind: "OFFICIAL_COMPANY_PAGE",
    requestedUrl: scriptUrl,
    response: scriptResponse,
    extractorLocator: "javascript:sxsPosCode[code,jobareaname]"
  });

  const params = {
    ctmid: config.ctmid,
    pagesize: config.pageSize ?? 500,
    pagenum: 1,
    sort: "issuedate",
    sequence: "0",
    keyword: null,
    jobarea: null,
    functype: null,
    divid: null,
    poscode: null
  };
  const serializedParams = JSON.stringify(params);
  const keyIndex = 1;
  const sign = createHash("md5")
    .update(`coapi${serializedParams}${FIFTY_ONE_JOB_COAPI_PUBLIC_KEY.slice(keyIndex, keyIndex + 15)}`)
    .digest("hex");
  const endpoint = new URL("https://coapi.51job.com/job_list.php");
  endpoint.searchParams.set("key", String(keyIndex));
  endpoint.searchParams.set("sign", sign);
  endpoint.searchParams.set("params", serializedParams);
  endpoint.searchParams.set("jsoncallback", "jsoncallback");
  const requestedUrl = endpoint.toString();
  let response: OfficialJsonHttpResponse;
  try {
    response = await http({ url: requestedUrl, method: "GET", headers: {
      Accept: "application/javascript,application/json,text/javascript,*/*;q=0.1",
      Referer: safeEntryUrl,
      "User-Agent": "job-search-crawler/0.1"
    } });
    assertOfficialJsonEvidenceResponse(response, {
      requestedUrl,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    });
  } catch {
    return failed(capturedAt, "51job CoAPI transport or metadata failed");
  }
  const locator = requestContractV2Locator(
    "51job-coapi-v1|jsonp:$.resultbody.joblist|total:$.resultbody.totalnum|ui:sxsPosCode",
    { family: "51job-coapi", role: "page", method: "GET", url: requestedUrl, body: null,
      coordinate: { sequence: 0, requestedPage: 1, requestedPageSize: params.pagesize } }
  );
  const apiArtifact = officialJsonNetworkArtifact({
    id: "51job-page-0001",
    logicalKey: "51job-page-0001",
    kind: "ATS_API_RESPONSE",
    requestedUrl: "https://coapi.51job.com/job_list.php",
    response: { ...response, finalUrl: "https://coapi.51job.com/job_list.php" },
    extractorLocator: locator
  });
  if (response.status < 200 || response.status >= 300) {
    return failed(capturedAt, `51job CoAPI returned HTTP ${response.status}`);
  }
  const envelope = parse51jobJsonp(response.body);
  if (!envelope) return failed(capturedAt, "51job CoAPI response schema is invalid");

  const jobs: NormalizedOfficialJsonJob[] = [];
  const rawIds: string[] = [];
  const validIds: string[] = [];
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = {
    rawCount: envelope.jobs.length,
    parsedCount: envelope.jobs.length,
    validCount: 0,
    parseDiscardCount: 0,
    validationDiscardCount: 0
  };
  const seen = new Set<string>();
  for (let index = 0; index < envelope.jobs.length; index += 1) {
    const raw = envelope.jobs[index]!;
    const rawId = stringValue(raw.jobid);
    rawIds.push(irreversibleOfficialJsonEvidenceId(rawId ?? raw));
    const title = stringValue(raw.jobname);
    const locationRaw = stringValue(raw.jobareaname);
    if (!rawId || !title || !locationRaw || seen.has(rawId)) {
      counts.validationDiscardCount += 1;
      losses.push({ stage: "VALIDATION", reason: "51job record rejected: INVALID_REQUIRED_FIELD",
        rawLocator: officialJsonRawLocator(0, index), details: { code: "INVALID_REQUIRED_FIELD", recordIndex: index } });
      continue;
    }
    if (uiExclusions.some((rule) => title.includes(rule.code) && locationRaw.includes(rule.location))) {
      counts.validationDiscardCount += 1;
      losses.push({ stage: "VALIDATION", reason: "51job record excluded by official recruitment UI",
        rawLocator: officialJsonRawLocator(0, index), details: { code: "OFFICIAL_UI_EXCLUSION", recordIndex: index } });
      continue;
    }
    const officialUrl = new URL(detailBase);
    officialUrl.searchParams.set("jobId", rawId);
    const sourceJobId = persistentOfficialJsonJobId(rawId);
    jobs.push({ sourceJobId, title, officialUrl: officialUrl.toString(), locationRaw,
      cities: citiesWithFallback(locationRaw, locationRaw) });
    seen.add(rawId);
    counts.validCount += 1;
    validIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
  }
  if (envelope.total !== envelope.jobs.length || envelope.jobs.length > params.pagesize ||
    counts.validCount + counts.validationDiscardCount !== counts.rawCount) {
    return failed(capturedAt, "51job CoAPI traversal did not close the declared total");
  }
  const page: SourceFetchPageTrace = {
    sequence: 0,
    artifactLogicalKey: apiArtifact.logicalKey,
    requestedCursor: null,
    returnedCursor: null,
    requestedOffset: null,
    returnedOffset: null,
    requestedPage: 1,
    returnedPage: 1,
    requestedPageSize: params.pagesize,
    returnedPageSize: envelope.jobs.length,
    rawJobIds: [...new Set(rawIds)],
    validJobIds: validIds,
    // The API page declares its raw result count. The separate source-level
    // declaration below records the official UI-visible count after applying
    // the page's own published exclusion rules.
    declaredTotal: envelope.total,
    declaredCount: envelope.total,
    declaredPages: 1,
    nextPageSignalBefore: null,
    nextPageSignalAfter: null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
    termination: "NEXT_ABSENT",
    anomalyCodes: [],
    capturedAt: apiArtifact.capturedAt
  };
  const declaredCompleteness = {
    kind: "OFFICIAL_TOTAL_COUNT" as const,
    value: envelope.total,
    artifactLogicalKey: apiArtifact.logicalKey,
    extractorLocator: locator,
    scope: "SOURCE" as const
  };
  const finalized = finalizeOfficialJsonEvidenceBundle({
    artifacts: [scriptArtifact, apiArtifact],
    pages: [page],
    fetchCounts: counts,
    fetchLosses: losses,
    declaredCompleteness,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true
  });
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      expectedJobCount: counts.validCount,
      completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: safeEntryUrl,
      completenessBlockerReason: "51job UI exclusions await independent strict replay",
      totalPages: 1,
      pageSize: params.pagesize,
      pagesVisited: 1
    },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

function parse51jobUiExclusions(body: string): Array<{ code: string; location: string }> | undefined {
  const block = /(?:let|var|const)\s+sxsPosCode\s*=\s*\[([\s\S]*?)\]\s*(?:;|\/\/)/u.exec(body)?.[1];
  if (!block) return undefined;
  const rules: Array<{ code: string; location: string }> = [];
  const objectPattern = /\{\s*code\s*:\s*["']([^"']+)["']\s*,\s*jobareaname\s*:\s*["']([^"']+)["']\s*,?\s*\}/gu;
  for (const match of block.matchAll(objectPattern)) {
    const code = match[1]?.trim();
    const location = match[2]?.trim();
    if (!code || !location) return undefined;
    rules.push({ code, location });
  }
  return rules.length > 0 && new Set(rules.map((rule) => `${rule.code}\u0000${rule.location}`)).size === rules.length
    ? rules
    : undefined;
}

function parse51jobJsonp(body: string): { total: number; jobs: Record<string, unknown>[] } | undefined {
  const match = /^\s*jsoncallback\((\{[\s\S]*\})\)\s*;?\s*$/u.exec(body);
  if (!match || !hasUniqueJsonObjectKeys(match[1]!)) return undefined;
  try {
    const root = JSON.parse(match[1]!) as unknown;
    if (!isStrictRecord(root) || root.status !== "1" || !isStrictRecord(root.resultbody) ||
      !Array.isArray(root.resultbody.joblist)) return undefined;
    const totalRaw = root.resultbody.totalnum;
    const total = typeof totalRaw === "string" && /^\d+$/u.test(totalRaw) ? Number(totalRaw) : totalRaw;
    if (!isNonnegativeInteger(total) || root.resultbody.joblist.some((row) => !isStrictRecord(row))) return undefined;
    return { total, jobs: root.resultbody.joblist as Record<string, unknown>[] };
  } catch {
    return undefined;
  }
}

async function fetchEightfoldPcsx({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "eightfold-pcsx" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  let safeEntryUrl: string;
  let endpoint: URL;
  let detailBase: URL;
  try {
    safeEntryUrl = safeOfficialJsonEvidenceUrl(entryUrl);
    const entry = new URL(safeEntryUrl);
    endpoint = new URL("/api/pcsx/search", entry.origin);
    detailBase = new URL(safeOfficialJsonEndpoint(config.detailBaseUrl));
    if (detailBase.origin !== entry.origin || !detailBase.pathname.startsWith("/careers/job")) throw new Error();
    if (!/^[a-z0-9.-]+$/u.test(config.domain) || !/^[a-z]+$/u.test(config.location)) throw new Error();
  } catch {
    return failed(capturedAt, "Eightfold PCSx source configuration is invalid");
  }
  const pageSize = Math.max(1, Math.min(100, config.pageSize ?? 10));
  const maxPages = Math.max(1, config.maxPages ?? 20);
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = {
    rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0
  };
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const jobs: NormalizedOfficialJsonJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;
  let declaredArtifactKey: string | undefined;
  let declaredLocator: string | undefined;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const start = pageIndex * pageSize;
    const url = new URL(endpoint);
    url.searchParams.set("domain", config.domain);
    url.searchParams.set("query", "");
    url.searchParams.set("location", config.location);
    url.searchParams.set("start", String(start));
    url.searchParams.set("sort_by", "distance");
    const requestUrl = url.toString();
    const locator = requestContractV2Locator(
      "eightfold-pcsx-v1|json:$.data.positions|total:$.data.count",
      { family: "eightfold", role: "page", method: "GET", url: requestUrl, body: null,
        coordinate: { sequence: pageIndex, requestedOffset: start, requestedPageSize: pageSize } }
    );
    let response: OfficialJsonHttpResponse;
    try {
      response = await http({ url: requestUrl, method: "GET", headers: {
        Accept: "application/json", Referer: safeEntryUrl, "User-Agent": "job-search-crawler/0.1"
      } });
      assertOfficialJsonEvidenceResponse(response, {
        requestedUrl: requestUrl,
        crawlStartedAtMs: Date.parse(capturedAt),
        observedNowMs: now().getTime()
      });
    } catch (error) {
      return failed(capturedAt, safeOfficialJsonFailure(error, "Eightfold PCSx transport or metadata failed"));
    }
    const artifact = officialJsonNetworkArtifact({
      id: `eightfold-page-${String(pageIndex).padStart(4, "0")}`,
      logicalKey: `eightfold-page-${String(pageIndex).padStart(4, "0")}`,
      kind: "PAGINATION_PAGE",
      requestedUrl: requestUrl,
      response,
      extractorLocator: locator
    });
    artifacts.push(artifact);
    if (response.status < 200 || response.status >= 300) {
      return failed(capturedAt, `Eightfold PCSx returned HTTP ${response.status}`);
    }
    try { assertOfficialJsonMime(response); } catch {
      return failed(capturedAt, "Eightfold PCSx response has an invalid Content-Type");
    }
    let root: unknown;
    try { root = JSON.parse(response.body); } catch {
      return failed(capturedAt, "Eightfold PCSx response is not valid JSON");
    }
    if (!hasUniqueJsonObjectKeys(response.body) || !isStrictRecord(root) || root.status !== 200 ||
      !isStrictRecord(root.data) || !isNonnegativeInteger(root.data.count) ||
      !Array.isArray(root.data.positions)) {
      return failed(capturedAt, "Eightfold PCSx response schema is invalid");
    }
    const total = root.data.count;
    if (declaredTotal === undefined) {
      declaredTotal = total;
      declaredArtifactKey = artifact.logicalKey;
      declaredLocator = locator;
    } else if (total !== declaredTotal) {
      return failed(capturedAt, "Eightfold PCSx total changed during pagination");
    }
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let recordIndex = 0; recordIndex < root.data.positions.length; recordIndex += 1) {
      const raw = root.data.positions[recordIndex];
      counts.rawCount += 1;
      const rawId = isStrictRecord(raw) ? stringValue(raw.id) : undefined;
      rawIds.push(irreversibleOfficialJsonEvidenceId(rawId ?? raw));
      if (!isStrictRecord(raw)) {
        counts.parseDiscardCount += 1;
        continue;
      }
      counts.parsedCount += 1;
      const id = stringValue(raw.id);
      const title = stringValue(raw.name);
      const positionUrl = stringValue(raw.positionUrl);
      const locations = stringsValue(raw.locations);
      if (!id || !title || !positionUrl || locations.length === 0 || seen.has(id)) {
        counts.validationDiscardCount += 1;
        continue;
      }
      let officialUrl: URL;
      try { officialUrl = new URL(positionUrl, detailBase.origin); } catch {
        counts.validationDiscardCount += 1;
        continue;
      }
      if (officialUrl.origin !== detailBase.origin || !officialUrl.pathname.startsWith(`${detailBase.pathname}/`)) {
        counts.validationDiscardCount += 1;
        continue;
      }
      const locationRaw = locations.join(" | ");
      const sourceJobId = persistentOfficialJsonJobId(id);
      jobs.push({ sourceJobId, title, officialUrl: officialUrl.toString(), locationRaw,
        cities: citiesWithFallback(locationRaw, locationRaw) });
      seen.add(id);
      counts.validCount += 1;
      validIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
    }
    const hasNext = counts.rawCount < total;
    const atMax = pageIndex === maxPages - 1;
    pages.push({
      sequence: pageIndex, artifactLogicalKey: artifact.logicalKey,
      requestedCursor: null, returnedCursor: null,
      requestedOffset: start, returnedOffset: start,
      requestedPage: null, returnedPage: null,
      requestedPageSize: pageSize, returnedPageSize: root.data.positions.length,
      rawJobIds: [...new Set(rawIds)], validJobIds: validIds,
      declaredTotal: total, declaredCount: null, declaredPages: null,
      nextPageSignalBefore: pageIndex === 0 ? null : `start:${start}`,
      nextPageSignalAfter: hasNext ? `start:${start + pageSize}` : null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
      termination: hasNext ? (atMax ? "MAX_PAGE_LIMIT" : "CONTINUE") : "NEXT_ABSENT",
      anomalyCodes: [], capturedAt: artifact.capturedAt
    });
    if (!hasNext || atMax) break;
  }
  if (declaredTotal === undefined || !declaredArtifactKey || !declaredLocator || counts.rawCount !== declaredTotal ||
    counts.validCount !== declaredTotal || counts.parseDiscardCount !== 0 || counts.validationDiscardCount !== 0) {
    return failed(capturedAt, "Eightfold PCSx traversal did not close the declared total");
  }
  const declaredCompleteness = { kind: "OFFICIAL_TOTAL_COUNT" as const, value: declaredTotal,
    artifactLogicalKey: declaredArtifactKey, extractorLocator: declaredLocator, scope: "SOURCE" as const };
  const finalized = finalizeOfficialJsonEvidenceBundle({
    artifacts, pages, fetchCounts: counts, fetchLosses: losses, declaredCompleteness
  });
  return {
    ok: true, capturedAt, payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      expectedJobCount: declaredTotal,
      completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: safeEntryUrl,
      completenessBlockerReason: "Eightfold PCSx evidence remains manual until downstream adapter accounting is complete",
      totalPages: Math.ceil(declaredTotal / pageSize), pageSize, pagesVisited: pages.length
    },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

async function fetchJobsynSolr({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "jobsyn-solr" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  const pageSize = config.pageSize ?? 9;
  const maxPages = config.maxPages ?? 50;
  let endpoint: URL;
  try {
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0 ||
        !Number.isSafeInteger(maxPages) || maxPages <= 0) throw new Error("invalid Jobsyn limits");
    endpoint = jobsynEndpoint(config.endpointUrl);
    const detailBase = jobsynDetailBase(config.detailBaseUrl);
    const safeEntry = new URL(safeOfficialJsonEvidenceUrl(entryUrl));
    if (detailBase.origin !== safeEntry.origin) throw new Error("Jobsyn detail base is not the official entry origin");
    jobsynSiteOrigin(config.siteOrigin, safeEntry.hostname);
  } catch {
    return failed(capturedAt, "Jobsyn Solr configuration is invalid");
  }
  const jobs: NormalizedOfficialJsonJob[] = [];
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = {
    rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0
  };
  const seen = new Map<string, string>();
  let declaredTotal: number | undefined;
  let declaredPages: number | undefined;
  let declaredArtifactKey: string | undefined;
  let declaredLocator: string | undefined;
  let previousNext: string | null = null;
  let previousCapturedAtMs = Date.parse(capturedAt);
  const responseFingerprints = new Set<string>();

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(endpoint);
    url.searchParams.append("page", String(page));
    url.searchParams.set("location", config.location);
    url.searchParams.set("num_items", String(pageSize));
    const requestedUrl = url.toString();
    let response: OfficialJsonHttpResponse;
    try {
      response = await http({ url: requestedUrl, method: "GET", headers: {
        Accept: "application/json", "X-Origin": config.siteOrigin, "User-Agent": "job-search-crawler/0.1"
      }});
    } catch (error) {
      const transportFailure = retryableTransportFailureFromError(error);
      return jobsynFailure(capturedAt, transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : "Jobsyn Solr transport failed", artifacts, pages, counts, losses,
      jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator), transportFailure);
    }
    try {
      assertOfficialJsonEvidenceResponse(response, {
        requestedUrl, crawlStartedAtMs: Date.parse(capturedAt), observedNowMs: now().getTime()
      });
    } catch {
      return jobsynFailure(capturedAt, "Jobsyn Solr response metadata is invalid",
        artifacts, pages, counts, losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const artifactId = `jobsyn-page-${String(page).padStart(4, "0")}`;
    const artifact = officialJsonNetworkArtifact({ id: artifactId, logicalKey: artifactId,
      kind: "PAGINATION_PAGE", requestedUrl, response,
      extractorLocator: jobsynLocator(page, pageSize, config.location, false) });
    artifacts.push(artifact);
    const artifactCapturedAtMs = Date.parse(artifact.capturedAt);
    if (artifactCapturedAtMs < previousCapturedAtMs) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr response capture time moved backwards", artifacts, pages, counts,
        losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    previousCapturedAtMs = artifactCapturedAtMs;
    if (response.status < 200 || response.status >= 300) {
      const transportFailure = retryableHttpTransportFailure(response.status);
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return jobsynFailure(capturedAt, transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : `Jobsyn Solr API returned HTTP ${response.status}`, artifacts, pages, counts,
      losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator), transportFailure);
    }
    try { assertOfficialJsonMime(response); } catch (error) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return jobsynFailure(capturedAt, safeOfficialJsonFailure(error, "Jobsyn Solr response has an invalid Content-Type"),
        artifacts, pages, counts, losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    let root: unknown;
    try { root = JSON.parse(response.body); } catch {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr response is not valid JSON", artifacts, pages, counts, losses,
        jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (!hasUniqueJsonObjectKeys(response.body) || !isStrictRecord(root)) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr response contains ambiguous JSON object keys", artifacts, pages,
        counts, losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (!hasOwn(root, "jobs") || !Array.isArray(root.jobs) || !isStrictRecord(root.pagination)) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr response schema is invalid", artifacts, pages, counts, losses,
        jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const pagination = root.pagination;
    const pageTotal = jobsynOptionalInteger(pagination, "total");
    const pagePages = jobsynOptionalInteger(pagination, "total_pages");
    const returnedPage = jobsynOptionalInteger(pagination, "page");
    const declaredPageSize = jobsynOptionalInteger(pagination, "page_size");
    if (pageTotal.invalid || pagePages.invalid || returnedPage.invalid || declaredPageSize.invalid) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr pagination declaration is invalid", artifacts, pages, counts,
        losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const rawJobs = root.jobs;
    const totalValue = pageTotal.value;
    const pagesValue = pagePages.value;
    artifact.extractorLocator = jobsynLocator(page, pageSize, config.location, true);
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let index = 0; index < rawJobs.length; index += 1) {
      const raw = rawJobs[index]; counts.rawCount += 1;
      const rawId = isStrictRecord(raw) ? stringValue(raw.guid) ?? stringValue(raw.id) ?? stringValue(raw.reqid) : undefined;
      const evidenceId = irreversibleOfficialJsonEvidenceId(rawId ?? raw);
      if (!rawIds.includes(evidenceId)) rawIds.push(evidenceId);
      const locator = `${artifact.logicalKey}#record:${index}#${irreversibleOfficialJsonEvidenceId([index, raw])}`;
      if (!isStrictRecord(raw)) { recordJobsynLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", locator, page - 1, index); continue; }
      counts.parsedCount += 1;
      const normalized = normalizeJobsynSolrJob(config, raw);
      if (!rawId || !safeOfficialJsonId(rawId)) { recordJobsynLoss(losses, counts, "VALIDATION", rawId ? "UNSAFE_OFFICIAL_ID" : "MISSING_REQUIRED_FIELD", locator, page - 1, index, "id"); continue; }
      const title = stringValue(raw.title_exact) ?? stringValue(raw.title);
      const location = stringValue(raw.location_exact) ?? [stringValue(raw.city_exact), stringValue(raw.country_short_exact) ?? stringValue(raw.country_exact)].filter(Boolean).join(", ");
      if (!title || !location) { recordJobsynLoss(losses, counts, "VALIDATION", "MISSING_REQUIRED_FIELD", locator, page - 1, index); continue; }
      if (normalized.length !== 1) { recordJobsynLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_URL", locator, page - 1, index, "officialUrl"); continue; }
      const scope = officialJsonChinaRecordScope(
        stringValue(raw.country_exact) ?? stringValue(raw.country_short_exact),
        location
      );
      if (scope !== "CHINA") { recordJobsynLoss(losses, counts, "VALIDATION", scope === "AMBIGUOUS" ? "AMBIGUOUS_SCOPE" : "OUT_OF_SCOPE", locator, page - 1, index); continue; }
      if (sensitiveOfficialJsonField({ sourceJobId: rawId, title, locationRaw: location,
        officialUrl: normalized[0]!.officialUrl })) {
        recordJobsynLoss(losses, counts, "VALIDATION", "SENSITIVE_OUTPUT", locator, page - 1, index);
        continue;
      }
      const signature = irreversibleOfficialJsonEvidenceId(normalized[0]);
      const prior = seen.get(rawId);
      if (prior !== undefined) { recordJobsynLoss(losses, counts, "VALIDATION", prior === signature ? "DUPLICATE_OFFICIAL_ID" : "CONFLICTING_OFFICIAL_ID", locator, page - 1, index, "id"); continue; }
      seen.set(rawId, signature); jobs.push(normalized[0]!); validIds.push(persistentOfficialJsonJobId(rawId)); counts.validCount += 1;
    }
    if ((declaredTotal !== undefined && pageTotal.value !== declaredTotal) ||
        (declaredPages !== undefined && pagePages.value !== declaredPages)) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page,
        returnedPage: returnedPage.value ?? null, rawJobIds: rawIds, validJobIds: validIds,
        ...(pageTotal.value === undefined ? {} : { declaredTotal: pageTotal.value }),
        ...(pagePages.value === undefined ? {} : { declaredPages: pagePages.value }), termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr pagination declaration changed", artifacts, pages, counts,
        losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const impossibleDeclaration =
      (declaredPageSize.value !== undefined && declaredPageSize.value !== pageSize) ||
      rawJobs.length > pageSize ||
      (totalValue !== undefined && counts.rawCount > totalValue) ||
      (totalValue === 0 && rawJobs.length > 0) ||
      (pagesValue === 0 && (rawJobs.length > 0 || (totalValue !== undefined && totalValue > 0))) ||
      (totalValue !== undefined && pagesValue !== undefined && totalValue > 0 &&
        Math.ceil(totalValue / pageSize) !== pagesValue) ||
      (pagesValue !== undefined && pagesValue > 0 && page > pagesValue);
    if (impossibleDeclaration) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page,
        returnedPage: returnedPage.value ?? null, rawJobIds: rawIds, validJobIds: validIds,
        ...(totalValue === undefined ? {} : { declaredTotal: totalValue }),
        ...(pagesValue === undefined ? {} : { declaredPages: pagesValue }), termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr pagination declaration contradicts observed rows", artifacts,
        pages, counts, losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (declaredTotal === undefined && pageTotal.value !== undefined) {
      declaredTotal = pageTotal.value; declaredArtifactKey = artifact.logicalKey;
      declaredLocator = jobsynLocator(page, pageSize, config.location, true);
    }
    if (declaredPages === undefined && pagePages.value !== undefined) declaredPages = pagePages.value;
    const hasMoreValue = hasOwn(pagination, "has_more_pages") ? pagination.has_more_pages : undefined;
    if (hasMoreValue !== undefined && typeof hasMoreValue !== "boolean") {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, returnedPage: returnedPage.value ?? null,
        rawJobIds: rawIds, validJobIds: validIds,
        ...(declaredTotal === undefined ? {} : { declaredTotal }),
        ...(declaredPages === undefined ? {} : { declaredPages }), termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr next-page declaration is invalid", artifacts, pages, counts, losses,
        jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const pagesSayNext = pagePages.value !== undefined ? page < pagePages.value : undefined;
    if (typeof hasMoreValue === "boolean" && pagesSayNext !== undefined && hasMoreValue !== pagesSayNext) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page,
        returnedPage: returnedPage.value ?? null, rawJobIds: rawIds, validJobIds: validIds,
        ...(declaredTotal === undefined ? {} : { declaredTotal }),
        ...(declaredPages === undefined ? {} : { declaredPages }), termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr pagination declarations conflict", artifacts, pages, counts,
        losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const hasNext = hasMoreValue === true || pagesSayNext === true;
    if (!hasNext && declaredTotal !== undefined && counts.rawCount !== declaredTotal) {
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page,
        returnedPage: returnedPage.value ?? null, rawJobIds: rawIds, validJobIds: validIds,
        declaredTotal, ...(declaredPages === undefined ? {} : { declaredPages }), termination: "FAILED" }));
      return jobsynFailure(capturedAt, "Jobsyn Solr pagination declaration contradicts observed rows", artifacts,
        pages, counts, losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const atMax = page === maxPages;
    const next = hasNext ? `page:${page + 1}` : null;
    const fingerprint = sha256Bytes(Buffer.from(response.body, "utf8")).sha256;
    const repeated = responseFingerprints.has(fingerprint);
    responseFingerprints.add(fingerprint);
    const noOfficialNextDeclaration = hasMoreValue === undefined && pagePages.value === undefined;
    const termination: SourceFetchPageTrace["termination"] =
      repeated ? "REPEATED_CURSOR" :
      rawIds.length === 0 && page === 1 && declaredTotal === 0 && !hasNext ? "EMPTY_PAGE" :
      hasNext ? atMax ? "MAX_PAGE_LIMIT" : "CONTINUE" :
      noOfficialNextDeclaration && rawIds.length >= pageSize ? "ABORTED" : "NEXT_ABSENT";
    pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page,
      returnedPage: returnedPage.value ?? null, rawJobIds: rawIds, validJobIds: validIds,
      ...(declaredTotal === undefined ? {} : { declaredTotal }),
      ...(declaredPages === undefined ? {} : { declaredPages }),
      nextPageSignalBefore: previousNext, nextPageSignalAfter: next, termination }));
    previousNext = next;
    if (repeated || !hasNext || atMax) break;
  }
  let finalized: ReturnType<typeof finalizeOfficialJsonEvidenceBundle>;
  try { finalized = finalizeOfficialJsonEvidenceBundle({ artifacts, pages, fetchCounts: counts, fetchLosses: losses,
    ...(jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator)
      ? { declaredCompleteness: jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator)! } : {}) }); }
  catch (error) { return jobsynFailure(capturedAt, safeOfficialJsonFailure(error, "Jobsyn Solr pagination evidence is invalid"), artifacts, pages, counts, losses,
    jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator)); }
  return {
    ok: true, capturedAt,
    payload: { jobs },
    completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(declaredTotal === undefined ? {} : { expectedJobCount: declaredTotal }),
      completenessEvidenceKind: declaredTotal === undefined ? "WEAK_MANUAL_SAMPLE" : "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: safeOfficialJsonEvidenceUrl(entryUrl),
      completenessBlockerReason: "Jobsyn declarations remain manual until downstream adapter loss accounting is complete",
      ...(declaredPages === undefined ? {} : { totalPages: declaredPages }), pageSize, pagesVisited: pages.length },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

async function fetchCnstaff({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "cnstaff" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  let safeEntryUrl: string;
  try {
    safeEntryUrl = safeOfficialJsonEndpoint(entryUrl);
  } catch {
    return failed(capturedAt, "CNStaff official URL configuration is invalid");
  }
  const pageSize = Math.max(1, Math.min(100, config.pageSize ?? 15));
  const maxPages = Math.max(1, config.maxPages ?? 50);
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = {
    rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0
  };
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const jobs: NormalizedOfficialJsonJob[] = [];
  const seenOfficialIds = new Set<string>();
  const seenDetailIds = new Set<string>();
  let declaredTotal: number | undefined;
  let declaredPages: number | undefined;
  let declaredArtifactKey: string | undefined;
  let declaredLocator: string | undefined;
  let cumulativeRaw = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = new URL(safeEntryUrl);
    pageUrl.searchParams.set("n", "1");
    pageUrl.searchParams.set("p", String(page));
    const requestedUrl = pageUrl.toString();
    let response: OfficialJsonHttpResponse;
    try {
      response = await http({
        url: requestedUrl,
        method: "GET",
        headers: {
          Accept: "application/json",
          Referer: safeEntryUrl,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "job-search-crawler/0.1"
        }
      });
    } catch {
      return cnstaffFailure(capturedAt, "CNStaff API TRANSPORT_FAILURE", artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    try {
      assertOfficialJsonEvidenceResponse(response, {
        requestedUrl,
        crawlStartedAtMs: Date.parse(capturedAt),
        observedNowMs: now().getTime()
      });
    } catch (error) {
      return cnstaffFailure(capturedAt,
        safeOfficialJsonFailure(error, "CNStaff response metadata is invalid"),
        artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const artifactId = `cnstaff-page-${String(page).padStart(4, "0")}`;
    const artifact = officialJsonNetworkArtifact({
      id: artifactId,
      logicalKey: artifactId,
      kind: "PAGINATION_PAGE",
      requestedUrl,
      response,
      extractorLocator: cnstaffLocator({ page, pageSize, hasTotal: false, hasPages: false, hasReturnedPage: false, hasList: false })
    });
    artifacts.push(artifact);
    if (response.status < 200 || response.status >= 300) {
      pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return cnstaffFailure(capturedAt, `CNStaff API returned HTTP ${response.status}`,
        artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    try {
      assertCnstaffMime(response, requestedUrl, safeEntryUrl);
    } catch (error) {
      pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return cnstaffFailure(capturedAt,
        safeOfficialJsonFailure(error, "CNStaff response has an invalid Content-Type"),
        artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    let root: unknown;
    try {
      root = JSON.parse(response.body);
    } catch {
      pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return cnstaffFailure(capturedAt, "CNStaff response is not valid JSON", artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (!hasUniqueJsonObjectKeys(response.body) || !isStrictRecord(root)) {
      pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return cnstaffFailure(capturedAt, "CNStaff response has invalid or ambiguous object structure",
        artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (!hasOwn(root, "list") || !Array.isArray(root.list) || !hasOwn(root, "page") || !isStrictRecord(root.page)) {
      pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return cnstaffFailure(capturedAt, "CNStaff response list/page shape is invalid", artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    let pageTotal: number | undefined;
    if (hasOwn(root, "total")) {
      if (!isNonnegativeInteger(root.total)) {
        pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
        return cnstaffFailure(capturedAt, "CNStaff total must be a nonnegative integer", artifacts, pages, counts, losses,
          cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
      }
      pageTotal = root.total;
    }
    let pageTotalPages: number | undefined;
    if (hasOwn(root.page, "total")) {
      if (!isNonnegativeInteger(root.page.total)) {
        pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
        return cnstaffFailure(capturedAt, "CNStaff page.total must be a nonnegative integer", artifacts, pages, counts, losses,
          cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
      }
      pageTotalPages = root.page.total;
    }
    let returnedPage: number | null = null;
    if (hasOwn(root.page, "now")) {
      if (!isNonnegativeInteger(root.page.now)) {
        pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
        return cnstaffFailure(capturedAt, "CNStaff page.now must be a nonnegative integer", artifacts, pages, counts, losses,
          cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
      }
      returnedPage = root.page.now;
    }
    const locator = cnstaffLocator({
      page, pageSize, hasTotal: pageTotal !== undefined, hasPages: pageTotalPages !== undefined,
      hasReturnedPage: returnedPage !== null, hasList: true
    });
    artifact.extractorLocator = locator;
    if (declaredTotal === undefined && pageTotal !== undefined) {
      declaredTotal = pageTotal;
      declaredArtifactKey = artifact.logicalKey;
      declaredLocator = locator;
    }
    if (declaredPages === undefined && pageTotalPages !== undefined) declaredPages = pageTotalPages;

    const rawJobs = root.list as unknown[];
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let recordIndex = 0; recordIndex < rawJobs.length; recordIndex += 1) {
      const raw = rawJobs[recordIndex];
      counts.rawCount += 1;
      const rawOfficialId = isStrictRecord(raw)
        ? stringValue(raw.job_publish_id) ?? stringValue(raw.job_id)
        : undefined;
      const rawEvidenceId = irreversibleOfficialJsonEvidenceId(rawOfficialId ?? raw);
      if (!rawIds.includes(rawEvidenceId)) rawIds.push(rawEvidenceId);
      const rawLocator = `${artifact.logicalKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex, raw])}`;
      if (!isStrictRecord(raw)) {
        recordCnstaffLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", rawLocator, page - 1, recordIndex);
        continue;
      }
      counts.parsedCount += 1;
      const officialId = stringValue(raw.job_publish_id) ?? stringValue(raw.job_id);
      const detailId = stringValue(raw.job_id) ?? officialId;
      const title = stringValue(raw.job_name_show) ?? stringValue(raw.job_name);
      const locationRaw = stringValue(raw.job_address_name) ?? stringValue(raw.job_workplace);
      if (!officialId || !detailId || !title || !locationRaw) {
        const field = !officialId ? "id" : !detailId ? "detailId" : !title ? "title" : "locationRaw";
        recordCnstaffLoss(losses, counts, "VALIDATION", "MISSING_REQUIRED_FIELD", rawLocator, page - 1, recordIndex, field);
        continue;
      }
      if (!safeOfficialJsonId(officialId) || !safeOfficialJsonId(detailId)) {
        recordCnstaffLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_ID", rawLocator, page - 1, recordIndex, "id");
        continue;
      }
      if (seenOfficialIds.has(officialId)) {
        recordCnstaffLoss(losses, counts, "VALIDATION", "DUPLICATE_OFFICIAL_ID", rawLocator, page - 1, recordIndex, "id");
        continue;
      }
      if (seenDetailIds.has(detailId)) {
        recordCnstaffLoss(losses, counts, "VALIDATION", "DUPLICATE_DETAIL_ID", rawLocator, page - 1, recordIndex, "detailId");
        continue;
      }
      const countryCoordinates = cnstaffCountryCoordinates(raw);
      const scope = cnstaffRecordScope(countryCoordinates, locationRaw);
      if (scope !== "CHINA") {
        const countryFields = countryCoordinates.map(({ field }) => field);
        const scopeLocator = countryFields.length > 0
          ? `${rawLocator}#countryFields:${countryFields.join("+")}`
          : rawLocator;
        recordCnstaffLoss(losses, counts, "VALIDATION", scope === "AMBIGUOUS" ? "AMBIGUOUS_SCOPE" : "OUT_OF_SCOPE",
          scopeLocator, page - 1, recordIndex, countryFields[0]);
        continue;
      }
      let officialUrl: string;
      try {
        officialUrl = cnstaffDetailUrl(safeEntryUrl, detailId);
      } catch {
        recordCnstaffLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_URL", rawLocator, page - 1, recordIndex, "officialUrl");
        continue;
      }
      const sensitive = sensitiveOfficialJsonField({ officialId, detailId, title, locationRaw, officialUrl });
      if (sensitive) {
        recordCnstaffLoss(losses, counts, "VALIDATION", "SENSITIVE_OUTPUT", rawLocator, page - 1, recordIndex, sensitive);
        continue;
      }
      seenOfficialIds.add(officialId);
      seenDetailIds.add(detailId);
      const sourceJobId = persistentOfficialJsonJobId(officialId);
      jobs.push({ sourceJobId, title, officialUrl, locationRaw, cities: citiesWithFallback(locationRaw, locationRaw) });
      counts.validCount += 1;
      validIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
    }

    cumulativeRaw += rawJobs.length;
    if (pageTotal !== undefined && cumulativeRaw > pageTotal) {
      pages.push(cnstaffPageTrace({ artifact, sequence: page - 1, requestedPage: page, returnedPage,
        rawJobIds: rawIds, validJobIds: validIds,
        ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }),
        ...(pageTotalPages === undefined ? {} : { declaredPages: pageTotalPages }),
        termination: "FAILED" }));
      return cnstaffFailure(capturedAt, "CNStaff official total is smaller than the raw record count",
        artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const totalChanged = declaredTotal !== undefined && pageTotal !== undefined && declaredTotal !== pageTotal;
    const pagesChanged = declaredPages !== undefined && pageTotalPages !== undefined && declaredPages !== pageTotalPages;
    const declarationContradiction = !totalChanged && !pagesChanged &&
      pageTotal !== undefined && pageTotalPages !== undefined &&
      ((cumulativeRaw < pageTotal) !== (page < pageTotalPages));
    if (declarationContradiction) {
      pages.push(cnstaffPageTrace({
        artifact, sequence: page - 1, requestedPage: page, returnedPage,
        rawJobIds: rawIds, validJobIds: validIds, declaredTotal: pageTotal!, declaredPages: pageTotalPages!,
        termination: "FAILED"
      }));
      return cnstaffFailure(capturedAt, "CNStaff total and page declarations contradict the raw traversal",
        artifacts, pages, counts, losses,
        cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const hasNext = !totalChanged && !pagesChanged && pageTotal !== undefined && pageTotalPages !== undefined &&
      cumulativeRaw < pageTotal && page < pageTotalPages;
    const atMax = page === maxPages;
    const coordinateUnproven = returnedPage === null;
    const declarationUnproven = pageTotal === undefined || pageTotalPages === undefined;
    const intermediateEmpty = rawJobs.length === 0 && hasNext;
    const termination: SourceFetchPageTrace["termination"] = declarationUnproven || coordinateUnproven || intermediateEmpty
      ? "ABORTED"
      : hasNext ? atMax ? "MAX_PAGE_LIMIT" : "CONTINUE"
        : rawJobs.length === 0 && page === 1 && pageTotal === 0 ? "EMPTY_PAGE" : "NEXT_ABSENT";
    pages.push(cnstaffPageTrace({
      artifact, sequence: page - 1, requestedPage: page, returnedPage, rawJobIds: rawIds, validJobIds: validIds,
      ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }),
      ...(pageTotalPages === undefined ? {} : { declaredPages: pageTotalPages }),
      nextPageSignalBefore: page === 1 ? null : `page:${page}`,
      nextPageSignalAfter: hasNext ? `page:${page + 1}` : null,
      termination
    }));
    if (declarationUnproven || coordinateUnproven || intermediateEmpty || !hasNext || atMax) break;
  }

  const declaredCompleteness = cnstaffDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator);
  let finalized: ReturnType<typeof finalizeOfficialJsonEvidenceBundle>;
  try {
    finalized = finalizeOfficialJsonEvidenceBundle({
      artifacts, pages, fetchCounts: counts, fetchLosses: losses,
      ...(declaredCompleteness ? { declaredCompleteness } : {})
    });
  } catch (error) {
    return cnstaffFailure(capturedAt, safeOfficialJsonFailure(error, "CNStaff pagination evidence is invalid"),
      artifacts, pages, counts, losses, declaredCompleteness);
  }
  const anomalyText = finalized.evaluation.derivedAnomalyCodes.join(", ");
  const blockerReason = anomalyText
    ? `CNStaff pagination evidence requires manual review: ${anomalyText}`
    : declaredTotal === undefined || declaredPages === undefined
      ? "CNStaff API did not expose complete total/page declarations"
      : "CNStaff fetch evidence requires downstream adapter accounting";
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(declaredTotal === undefined ? {} : {
        expectedJobCount: declaredTotal,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const
      }),
      completenessEvidenceUrl: safeEntryUrl,
      completenessBlockerReason: blockerReason,
      ...(declaredPages === undefined ? {} : { totalPages: declaredPages }),
      pageSize,
      pagesVisited: pages.length
    },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

async function fetchBeisenZhiye2022({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "beisen-zhiye-2022" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  if (config.changedWithinDays !== undefined && config.postDateWithinDays !== undefined) {
    return failed(capturedAt, "Beisen Zhiye date window must use either ChangeDate or the official PostDate filter, not both");
  }
  let safeEntryUrl: string;
  let endpointUrl: string;
  try {
    safeEntryUrl = safeOfficialJsonEndpoint(entryUrl);
    const entry = new URL(safeEntryUrl);
    endpointUrl = safeOfficialJsonEndpoint(
      new URL("/api/Jobad/GetJobAdPageList", entry.origin).toString()
    );
    if (new URL(endpointUrl).origin !== entry.origin) {
      throw new Error("Beisen endpoint origin mismatch");
    }
  } catch {
    return failed(capturedAt, "Beisen Zhiye official URL configuration is invalid");
  }
  const pageSize = Math.max(1, Math.min(100, config.pageSize ?? 100));
  const maxPages = Math.max(1, config.maxPages ?? 50);
  const category = config.category ?? "1";
  const displayFields = config.displayFields ?? [...DEFAULT_BEISEN_ZHIYE_DISPLAY_FIELDS];
  if (config.mixedLocationPolicy === "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS" &&
    (safeEntryUrl !== "https://sph.zhiye.com/social/jobs" || category !== "1" ||
      pageSize !== 100 || config.detailPath !== "social/detail" ||
      config.geographyScope !== "DOMESTIC_OFFICIAL_TENANT")) {
    return failed(capturedAt, "Beisen sibling-location inheritance is not bound to the exact Shanghai Pharma source");
  }
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = {
    rawCount: 0,
    parsedCount: 0,
    validCount: 0,
    parseDiscardCount: 0,
    validationDiscardCount: 0
  };
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const jobs: NormalizedOfficialJsonJob[] = [];
  const seenOfficialIds = new Set<string>();
  const seenDetailIds = new Set<string>();
  let declaredTotal: number | undefined;
  let declaredArtifactKey: string | undefined;
  let declaredLocator: string | undefined;
  let cumulativeRaw = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const requestBody = {
      PageIndex: pageIndex,
      PageSize: pageSize,
      ...(config.postDateWithinDays === undefined ? {} : { PostDate: [config.postDateWithinDays] }),
      Category: [category],
      KeyWords: "",
      SpecialType: 0,
      PortalId: "",
      DisplayFields: displayFields
    };
    const pageRequestLocator = (baseLocator: string) => requestContractV2Locator(baseLocator, {
      family: "beisen", role: "page", method: "POST", url: endpointUrl, body: requestBody,
      coordinate: { sequence: pageIndex, requestedPage: pageIndex, requestedPageSize: pageSize }
    });
    let response: OfficialJsonHttpResponse;
    try {
      response = await http({
        url: endpointUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Referer: safeEntryUrl,
          "X-Requested-With": "xmlhttprequest",
          langType: "zh_CN",
          "User-Agent": "job-search-crawler/0.1"
        },
        body: JSON.stringify(requestBody)
      });
    } catch (error) {
      const transportFailure = retryableTransportFailureFromError(error);
      return beisenFailure(
        capturedAt,
        transportFailure
          ? safeSourceTransportFailureReason(transportFailure)
          : "Beisen Zhiye API TRANSPORT_FAILURE",
        artifacts,
        pages,
        counts,
        losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator),
        transportFailure
      );
    }
    try {
      assertOfficialJsonEvidenceResponse(response, {
        requestedUrl: endpointUrl,
        crawlStartedAtMs: Date.parse(capturedAt),
        observedNowMs: now().getTime()
      });
    } catch (error) {
      return beisenFailure(
        capturedAt,
        safeOfficialJsonFailure(error, "Beisen Zhiye response metadata is invalid"),
        artifacts,
        pages,
        counts,
        losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator)
      );
    }

    const artifactId = `beisen-page-${String(pageIndex).padStart(4, "0")}`;
    const unavailableLocator = pageRequestLocator(
      beisenLocator({ pageIndex, pageSize, category, hasCount: false, hasData: false })
    );
    const artifact = officialJsonNetworkArtifact({
      id: artifactId,
      logicalKey: artifactId,
      kind: "PAGINATION_PAGE",
      requestedUrl: endpointUrl,
      response,
      extractorLocator: unavailableLocator,
      ...(config.scopeExclusionProof || config.postDateWithinDays !== undefined ||
        config.mixedLocationPolicy === "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS"
        ? { bodyRepresentation: "EXACT" as const } : {})
    });
    artifacts.push(artifact);
    if (response.status < 200 || response.status >= 300) {
      const transportFailure = retryableHttpTransportFailure(response.status);
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt, transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : `Beisen Zhiye API returned HTTP ${response.status}`,
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator), transportFailure);
    }
    try {
      assertOfficialJsonMime(response);
    } catch (error) {
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt,
        safeOfficialJsonFailure(error, "Beisen Zhiye response has an invalid Content-Type"),
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }

    const rawRootProperties = topLevelJsonProperties(response.body);
    if (rawRootProperties && ["Code", "Data", "Count", "PageIndex"].some((key) =>
      rawRootProperties.filter((property) => property.key === key).length > 1)) {
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt, "Beisen Zhiye response contains duplicate pagination keys",
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    let root: unknown;
    try {
      root = JSON.parse(response.body);
    } catch {
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt, "Beisen Zhiye response is not valid JSON",
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (!hasUniqueJsonObjectKeys(response.body)) {
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt, "Beisen Zhiye response contains ambiguous JSON object keys",
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (!isStrictRecord(root)) {
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt, "Beisen Zhiye response root must be an object",
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (!hasOwn(root, "Code") || root.Code !== 200) {
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt, "Beisen Zhiye response Code must be exactly 200",
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    if (!hasOwn(root, "Data") || !Array.isArray(root.Data)) {
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt, "Beisen Zhiye response Data must be an array",
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    let pageTotal: number | undefined;
    if (hasOwn(root, "Count")) {
      if (!isNonnegativeInteger(root.Count)) {
        pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
        return beisenFailure(capturedAt, "Beisen Zhiye response Count must be a nonnegative integer",
          artifacts, pages, counts, losses,
          beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
      }
      pageTotal = root.Count;
    }
    let returnedPage: number | null = null;
    if (hasOwn(root, "PageIndex")) {
      if (!isNonnegativeInteger(root.PageIndex)) {
        pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
        return beisenFailure(capturedAt, "Beisen Zhiye response PageIndex must be a nonnegative integer",
          artifacts, pages, counts, losses,
          beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
      }
      returnedPage = root.PageIndex;
    }
    const locator = pageRequestLocator(
      beisenLocator({ pageIndex, pageSize, category, hasCount: pageTotal !== undefined, hasData: true })
    );
    artifact.extractorLocator = locator;
    if (declaredTotal === undefined && pageTotal !== undefined) {
      declaredTotal = pageTotal;
      declaredArtifactKey = artifact.logicalKey;
      declaredLocator = locator;
    }

    const rawJobs = root.Data as unknown[];
    const rawIds: string[] = rawJobs.map((raw) => {
      const rawOfficialId = isStrictRecord(raw) && typeof raw.Id === "string"
        ? raw.Id
        : undefined;
      return irreversibleOfficialJsonEvidenceId(rawOfficialId ?? raw);
    }).filter((id, index, ids) => ids.indexOf(id) === index);
    const validIds: string[] = [];
    for (let recordIndex = 0; recordIndex < rawJobs.length; recordIndex += 1) {
      const raw = rawJobs[recordIndex];
      counts.rawCount += 1;
      const rawLocator = `${artifact.logicalKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex, raw])}`;
      if (!isStrictRecord(raw)) {
        recordBeisenLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", rawLocator, pageIndex, recordIndex);
        continue;
      }
      counts.parsedCount += 1;
      const socialMismatch = beisenSocialChannelMismatch(raw, category);
      if (socialMismatch) {
        recordBeisenLoss(losses, counts, "VALIDATION", "SOCIAL_CHANNEL_MISMATCH",
          rawLocator, pageIndex, recordIndex, socialMismatch);
        pages.push(beisenPageTrace({
          artifact,
          sequence: pageIndex,
          requestedPage: pageIndex,
          returnedPage,
          rawJobIds: rawIds,
          validJobIds: validIds,
          ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }),
          nextPageSignalBefore: pageIndex === 0 ? null : `page:${pageIndex}`,
          nextPageSignalAfter: null,
          termination: "FAILED"
        }));
        return beisenFailure(capturedAt, "Beisen Zhiye social channel binding failed",
          artifacts, pages, counts, losses,
          beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
      }
      const officialId = beisenCanonicalOriginalUuid(raw.Id);
      const detailId = officialId;
      const title = stringValue(raw.JobAdName);
      if (config.changedWithinDays !== undefined) {
        const changedAt = beisenChinaLocalDateMs(raw.ChangeDate);
        const cutoffAt = chinaCalendarCutoffMs(capturedAt, config.changedWithinDays);
        if (changedAt === undefined) {
          recordBeisenLoss(losses, counts, "VALIDATION", "DATE_INVALID",
            rawLocator, pageIndex, recordIndex, "ChangeDate");
          continue;
        }
        if (changedAt < cutoffAt) {
          recordBeisenLoss(losses, counts, "VALIDATION", "OUT_OF_TIME_WINDOW",
            rawLocator, pageIndex, recordIndex, "ChangeDate");
          continue;
        }
      }
      const upstreamLocationParts = stringsValue(raw.LocNames);
      const upstreamLocationRaw = upstreamLocationParts.join(" / ") || stringValue(raw.LocName) ||
        stringValue(raw.LocationName) || stringValue(raw.City);
      const correctedLocation = beisenSourceBoundLocationCorrection(
        config, raw, officialId, title, upstreamLocationParts, upstreamLocationRaw
      );
      const locationParts = correctedLocation.locationParts;
      const locationRaw = correctedLocation.locationRaw;
      if (!hasOwn(raw, "Id") || raw.Id === undefined || raw.Id === null ||
        (typeof raw.Id === "string" && raw.Id.trim() === "")) {
        recordBeisenLoss(losses, counts, "VALIDATION", "MISSING_REQUIRED_FIELD", rawLocator, pageIndex, recordIndex, "id");
        continue;
      }
      if (!officialId || !detailId || !safeOfficialJsonId(officialId)) {
        recordBeisenLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_ID", rawLocator, pageIndex, recordIndex, "id");
        continue;
      }
      if (!title) {
        const missing = "title";
        recordBeisenLoss(losses, counts, "VALIDATION", "MISSING_REQUIRED_FIELD", rawLocator, pageIndex, recordIndex, missing);
        continue;
      }
      if (!locationRaw) {
        recordBeisenLoss(losses, counts, "VALIDATION",
          config.defaultLocationRaw ? "DECLARED_LOCATION_FALLBACK" : "MISSING_REQUIRED_FIELD",
          rawLocator, pageIndex, recordIndex, "locationRaw");
        continue;
      }
      if (seenOfficialIds.has(officialId)) {
        recordBeisenLoss(losses, counts, "VALIDATION", "DUPLICATE_OFFICIAL_ID", rawLocator, pageIndex, recordIndex, "id");
        continue;
      }
      if (seenDetailIds.has(detailId)) {
        recordBeisenLoss(losses, counts, "VALIDATION", "DUPLICATE_DETAIL_ID", rawLocator, pageIndex, recordIndex, "detailId");
        continue;
      }
      const country = stringValue(raw.Country) ?? stringValue(raw.CountryName);
      const scopeReview = beisenDomesticRecordScopeReview(
        country,
        locationParts.length > 0 ? locationParts : [locationRaw],
        locationRaw,
        config.geographyScope,
        config.mixedLocationPolicy
      );
      const scope = scopeReview.scope;
      if (scope !== "CHINA") {
        recordBeisenLoss(losses, counts, "VALIDATION",
          scope === "AMBIGUOUS" ? "AMBIGUOUS_SCOPE" : "OUT_OF_SCOPE",
          rawLocator, pageIndex, recordIndex);
        continue;
      }
      let officialUrl: string;
      try {
        officialUrl = beisenZhiyeDetailUrl(safeEntryUrl, config.detailPath, detailId);
      } catch {
        recordBeisenLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_URL", rawLocator, pageIndex, recordIndex, "officialUrl");
        continue;
      }
      const sensitive = sensitiveOfficialJsonField({ officialId, title, locationRaw, officialUrl });
      if (sensitive) {
        recordBeisenLoss(losses, counts, "VALIDATION", "SENSITIVE_OUTPUT", rawLocator, pageIndex, recordIndex, sensitive);
        continue;
      }
      seenOfficialIds.add(officialId);
      seenDetailIds.add(detailId);
      const sourceJobId = persistentOfficialJsonJobId(officialId);
      const observedCities = citiesFromBeisenLocation(
        config.mixedLocationPolicy === "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES"
          ? scopeReview.mainlandLocationParts
          : locationParts.length > 0 ? locationParts : [locationRaw]
      );
      jobs.push({
        sourceJobId,
        title,
        officialUrl,
        locationRaw,
        cities: observedCities
      });
      counts.validCount += 1;
      validIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
    }

    cumulativeRaw += rawJobs.length;
    if (pageTotal !== undefined && cumulativeRaw > pageTotal) {
      pages.push(beisenPageTrace({
        artifact,
        sequence: pageIndex,
        requestedPage: pageIndex,
        returnedPage,
        rawJobIds: rawIds,
        validJobIds: validIds,
        declaredTotal: pageTotal,
        nextPageSignalBefore: pageIndex === 0 ? null : `page:${pageIndex}`,
        nextPageSignalAfter: null,
        termination: "FAILED"
      }));
      return beisenFailure(capturedAt,
        "Beisen Zhiye official Count is smaller than the raw record count",
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
    }
    const totalChanged = declaredTotal !== undefined && pageTotal !== undefined &&
      declaredTotal !== pageTotal;
    const hasNext = !totalChanged && pageTotal !== undefined && cumulativeRaw < pageTotal;
    const atMax = pageIndex === maxPages - 1;
    const intermediateEmpty = rawJobs.length === 0 && hasNext;
    const termination: SourceFetchPageTrace["termination"] = pageTotal === undefined || intermediateEmpty
      ? "ABORTED"
      : hasNext
        ? atMax ? "MAX_PAGE_LIMIT" : "CONTINUE"
        : rawJobs.length === 0 && pageIndex === 0 && pageTotal === 0 ? "EMPTY_PAGE" : "NEXT_ABSENT";
    pages.push(beisenPageTrace({
      artifact,
      sequence: pageIndex,
      requestedPage: pageIndex,
      requestedPageSize: pageSize,
      returnedPage,
      rawJobIds: rawIds,
      validJobIds: validIds,
      ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }),
      nextPageSignalBefore: pageIndex === 0 ? null : `page:${pageIndex}`,
      nextPageSignalAfter: hasNext ? `page:${pageIndex + 1}` : null,
      termination
    }));
    if (pageTotal === undefined || intermediateEmpty || !hasNext || atMax) break;
  }

  const declaredCompleteness = config.scopeExclusionProof || config.changedWithinDays !== undefined
    ? sourceTraversalCompleteness(pages, artifacts)
    : beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator);
  let finalized: ReturnType<typeof finalizeOfficialJsonEvidenceBundle>;
  try {
    finalized = finalizeOfficialJsonEvidenceBundle({
      artifacts,
      pages,
      fetchCounts: counts,
      fetchLosses: losses,
      allowMissingReturnedPage: true,
      ...(declaredCompleteness ? { declaredCompleteness } : {})
    });
  } catch (error) {
    return beisenFailure(capturedAt,
      safeOfficialJsonFailure(error, "Beisen Zhiye pagination evidence is invalid"),
      artifacts, pages, counts, losses, declaredCompleteness);
  }
  const expectedNoncertifyingNoTotal = declaredTotal === undefined &&
    finalized.evaluation.derivedAnomalyCodes.length === 0;
  if (!finalized.evaluation.safeCompleteness && !expectedNoncertifyingNoTotal) {
    return {
      ok: false,
      capturedAt,
      failureReason: `Beisen Zhiye pagination evidence failed: ${finalized.evaluation.derivedAnomalyCodes.join(",")}`,
      fetchEvidence: finalized.evidence,
      paginationEvaluation: finalized.evaluation
    };
  }
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(config.scopeExclusionProof || config.changedWithinDays !== undefined || declaredTotal === undefined
        ? {} : { expectedJobCount: declaredTotal }),
      completenessEvidenceKind: config.scopeExclusionProof || config.changedWithinDays !== undefined
        ? "COMPLETE_PAGE_TRAVERSAL"
        : declaredTotal === undefined ? "WEAK_MANUAL_SAMPLE" : "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: safeOfficialJsonEvidenceUrl(safeEntryUrl),
      completenessBlockerReason:
        "Beisen Zhiye evidence remains manual until downstream adapter accounting is complete",
      ...(declaredTotal === undefined ? {} : { totalPages: Math.ceil(declaredTotal / pageSize) }),
      pageSize,
      pagesVisited: pages.length
    },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

async function fetchPhenomWidgets({
  http,
  plan,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>;
  config: Extract<OfficialJsonFetchConfig, { kind: "phenom" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  let safeEntryUrl: string;
  let detailBaseUrl: string;
  let allowedApplyOrigins: ReadonlySet<string>;
  let allowedEntryRedirect: { origin: string; pathname: string } | undefined;
  try {
    safeEntryUrl = safeOfficialJsonEndpoint(entryUrl);
    detailBaseUrl = safeOfficialJsonEndpoint(config.detailBaseUrl);
    if (config.derivedDetailIdField !== undefined &&
      config.derivedDetailIdField !== "reqId" && config.derivedDetailIdField !== "jobSeqNo") {
      throw new Error("Phenom derived detail ID field is invalid");
    }
    if (config.mixedLocationScopePolicy !== undefined &&
      config.mixedLocationScopePolicy !== "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1") {
      throw new Error("Phenom mixed-location scope policy is invalid");
    }
    if (new URL(detailBaseUrl).origin !== new URL(safeEntryUrl).origin) {
      throw new Error("Phenom detail origin does not match the official entry");
    }
    allowedApplyOrigins = new Set([
      new URL(detailBaseUrl).origin,
      ...(config.allowedApplyOrigins ?? []).map((value) => {
        const safe = safeOfficialJsonEndpoint(value);
        const parsed = new URL(safe);
        if (safe !== parsed.origin && safe !== `${parsed.origin}/`) throw new Error("origin path is not allowed");
        return parsed.origin;
      })
    ]);
    allowedEntryRedirect = validatedPhenomEntryRedirect(config.allowedEntryRedirect, safeEntryUrl);
  } catch {
    return failed(capturedAt, "Phenom official URL configuration is invalid");
  }

  let entry: OfficialJsonHttpResponse;
  try {
    entry = await http({
      url: safeEntryUrl,
      method: "GET",
      headers: { Accept: "text/html", "User-Agent": "job-search-crawler/0.1" }
    });
  } catch (error) {
    const transportFailure = withPhenomTransportStage(
      retryableTransportFailureFromError(error),
      "ENTRY"
    );
    return failed(
      capturedAt,
      transportFailure ? safeSourceTransportFailureReason(transportFailure) : "Phenom entry TRANSPORT_FAILURE",
      transportFailure
    );
  }
  try {
    assertPhenomEntryEvidenceResponse(entry, {
      requestedUrl: safeEntryUrl,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    }, allowedEntryRedirect);
  } catch (error) {
    return failed(capturedAt, safeOfficialJsonFailure(error, "Phenom entry response metadata is invalid"));
  }

  const unavailableEntryArtifact = phenomArtifact({
    id: "phenom-entry-0000",
    kind: "OFFICIAL_COMPANY_PAGE",
    requestedUrl: safeEntryUrl,
    response: entry,
    extractorLocator: "phenom-entry-config-v1|config:unavailable"
  });
  if (entry.status < 200 || entry.status >= 300) {
    const transportFailure = withPhenomTransportStage(
      retryableHttpTransportFailure(entry.status),
      "ENTRY"
    );
    return failedWithEvidence(
      capturedAt,
      transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : `Phenom entry page returned HTTP ${entry.status}`,
      phenomEntryFailureEvidence(unavailableEntryArtifact),
      transportFailure
    );
  }
  try {
    assertOfficialHtmlMime(entry);
  } catch (error) {
    return failedWithEvidence(capturedAt, safeOfficialJsonFailure(error, "Phenom entry response has an invalid Content-Type"),
      phenomEntryFailureEvidence(unavailableEntryArtifact));
  }

  const pageConfig = parsePhenomPageConfig(entry.body);
  if (!completePhenomPageConfig(pageConfig)) {
    return failedWithEvidence(capturedAt, "Phenom required widget configuration was not found",
      phenomEntryFailureEvidence(unavailableEntryArtifact));
  }
  let widgetEndpoint: string;
  try {
    widgetEndpoint = safeOfficialJsonEndpoint(pageConfig.widgetApiEndpoint);
    if (new URL(widgetEndpoint).origin !== new URL(safeEntryUrl).origin) {
      throw new Error("Phenom widget origin mismatch");
    }
  } catch {
    return failedWithEvidence(capturedAt, "Phenom widget endpoint is invalid",
      phenomEntryFailureEvidence(unavailableEntryArtifact));
  }

  const exactRocheRequestBoundOmittedOffset = exactRocheRequestBoundOmittedOffsetPlan(
    plan,
    pageConfig,
    widgetEndpoint
  );
  if (config.requestBoundOmittedOffsetPolicy !== undefined && !exactRocheRequestBoundOmittedOffset) {
    return failedWithEvidence(capturedAt,
      "Phenom request-bound omitted offset policy is not bound to the exact Roche source",
      phenomEntryFailureEvidence(unavailableEntryArtifact));
  }
  const exactMerckHealthcarePartition = exactMerckHealthcarePartitionPlan(
    plan,
    pageConfig,
    widgetEndpoint
  );
  if (config.facetScope && "partitionProofPolicy" in config.facetScope &&
    config.facetScope.partitionProofPolicy !== undefined && !exactMerckHealthcarePartition) {
    return failedWithEvidence(capturedAt,
      "Phenom partition proof policy is not bound to the exact Merck Healthcare source",
      phenomEntryFailureEvidence(unavailableEntryArtifact));
  }

  const configLocator = phenomConfigLocator(pageConfig, widgetEndpoint);
  const entryArtifact = phenomArtifact({
    id: "phenom-entry-0000",
    kind: "OFFICIAL_COMPANY_PAGE",
    requestedUrl: safeEntryUrl,
    response: entry,
    extractorLocator: configLocator
  });
  const artifacts: SourceFetchArtifactDraft[] = [entryArtifact];
  const pages: SourceFetchPageTrace[] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = {
    rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0
  };
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  const jobs: NormalizedOfficialJsonJob[] = [];
  const seenOfficialIds = new Set<string>();
  const firstRawByOfficialId = new Map<string, { pageIndex: number; serialized: string }>();
  const pageSize = Math.max(1, Math.min(100, config.pageSize ?? 50));
  const maxPages = Math.max(1, config.maxPages ?? 20);
  const countryFilter = config.countryFilter ?? "China";
  const facetScope = validPhenomFacetScope(config.facetScope);
  if (config.facetScope && !facetScope) {
    return phenomFailure(capturedAt, "Phenom structured facet scope configuration is invalid",
      artifacts, pages, counts, losses);
  }
  const sourceScopedChinaRequest = !facetScope && countryFilter === "China";
  let formalSelectedFields: Record<string, string[]> = { country: [countryFilter] };
  let structuredExpectedTotal: number | undefined;
  let allowedExclusionFacetDescriptors: ReadonlySet<string> | undefined;
  let partitionExpectedOfficialIds: ReadonlySet<string> | undefined;
  let declaredTotal: number | undefined;
  let declaredArtifactKey: string | undefined;
  let declaredLocator: string | undefined;
  let cumulativeRaw = 0;

  if (facetScope) {
    const globalPreflight = await fetchPhenomFacetPreflight({
      http, endpoint: widgetEndpoint, entryUrl: safeEntryUrl, pageConfig,
      pageSize, selectedFields: {}, capturedAt, now,
      enforceExactUiSelections: exactMerckHealthcarePartition,
      id: "phenom-facet-global",
      locator: `${configLocator}|facet-preflight:global|${phenomSelectedFieldsLocator({})}`
    });
    if (!globalPreflight.ok) {
      if (globalPreflight.failureArtifact) artifacts.push(globalPreflight.failureArtifact);
      return phenomFailure(
        capturedAt,
        globalPreflight.failureReason,
        artifacts,
        pages,
        counts,
        losses,
        undefined,
        globalPreflight.transportFailure,
        "FACET_GLOBAL"
      );
    }
    artifacts.push(globalPreflight.artifact);
    const countryAggregation = exactPhenomAggregation(globalPreflight.envelope, "country");
    const countryCount = countryAggregation?.get(facetScope.countryIncludeDescriptor);
    if (countryCount === undefined) {
      return phenomFailure(capturedAt, "Phenom global country descriptor is missing or ambiguous",
        artifacts, pages, counts, losses);
    }
    if (facetScope.requireGlobalDescriptorProof) {
      const globalExclusionAggregation = exactPhenomAggregation(
        globalPreflight.envelope,
        facetScope.exclusionField
      );
      if (!globalExclusionAggregation ||
        [...globalExclusionAggregation.values()].reduce((sum, value) => sum + value, 0) !==
          globalPreflight.envelope.totalHits ||
        facetScope.exclusionDescriptors.some((descriptor) => !globalExclusionAggregation.has(descriptor))) {
        return phenomFailure(capturedAt,
          "Phenom global exclusion facet is missing descriptors or is not a complete partition",
          artifacts, pages, counts, losses);
      }
    }

    const countryPreflight = await fetchPhenomFacetPreflight({
      http, endpoint: widgetEndpoint, entryUrl: safeEntryUrl, pageConfig,
      pageSize, selectedFields: { country: [facetScope.countryIncludeDescriptor] }, capturedAt, now,
      enforceExactUiSelections: exactMerckHealthcarePartition,
      id: "phenom-facet-country",
      locator: `${configLocator}|facet-preflight:country|${phenomSelectedFieldsLocator({
        country: [facetScope.countryIncludeDescriptor]
      })}`
    });
    if (!countryPreflight.ok) {
      if (countryPreflight.failureArtifact) artifacts.push(countryPreflight.failureArtifact);
      return phenomFailure(
        capturedAt,
        countryPreflight.failureReason,
        artifacts,
        pages,
        counts,
        losses,
        undefined,
        countryPreflight.transportFailure,
        "FACET_COUNTRY"
      );
    }
    artifacts.push(countryPreflight.artifact);
    if (countryPreflight.envelope.totalHits !== countryCount ||
      countryPreflight.envelope.jobs.some((raw) =>
        !isStrictRecord(raw) || !phenomRecordMatchesCountryFacet(
          raw,
          facetScope.countryIncludeDescriptor,
          config.mixedLocationScopePolicy === "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1"
        ))) {
      return phenomFailure(capturedAt, "Phenom country facet preflight drifted or returned an out-of-scope sample",
        artifacts, pages, counts, losses);
    }
    if (facetScope.countryOnly) {
      structuredExpectedTotal = countryCount;
      formalSelectedFields = { country: [facetScope.countryIncludeDescriptor] };
    } else if (facetScope.partitionProofPolicy === "MERCK_HEALTHCARE_PARTITION_V1" &&
      facetScope.includeField && facetScope.includeDescriptor && exactMerckHealthcarePartition) {
      const sectorAggregation = exactPhenomAggregation(countryPreflight.envelope, facetScope.includeField);
      if (!sectorAggregation || !sectorAggregation.has(facetScope.includeDescriptor) ||
        [...sectorAggregation.values()].reduce((sum, value) => sum + value, 0) !== countryCount) {
        return phenomFailure(capturedAt, "Phenom business-sector facet is not a complete dynamic partition",
          artifacts, pages, counts, losses);
      }
      const allSectorIds = new Set<string>();
      let includedSectorProof: PhenomPartitionProof | undefined;
      const sectors = [...sectorAggregation.keys()].sort();
      for (let partitionIndex = 0; partitionIndex < sectors.length; partitionIndex += 1) {
        const descriptor = sectors[partitionIndex]!;
        const proof = await fetchPhenomPartitionProof({
          http, endpoint: widgetEndpoint, entryUrl: safeEntryUrl, pageConfig, pageSize, maxPages,
          selectedFields: {
            country: [facetScope.countryIncludeDescriptor],
            [facetScope.includeField]: [descriptor]
          },
          expectedTotal: sectorAggregation.get(descriptor)!, capturedAt, now,
          family: "business-sector", partitionIndex,
          requiredCountry: facetScope.countryIncludeDescriptor,
          optionalExactFields: [{ field: facetScope.includeField, descriptor }],
          allowOmittedOffsetForSinglePage: config.allowOmittedOffsetForSinglePage === true,
          configLocator
        });
        if (!proof.ok) {
          return phenomFailure(capturedAt, proof.failureReason, artifacts, pages, counts, losses);
        }
        artifacts.push(...proof.proof.artifacts);
        for (const id of proof.proof.ids) {
          if (allSectorIds.has(id)) {
            return phenomFailure(capturedAt, "Phenom business-sector partitions overlap by job ID",
              artifacts, pages, counts, losses);
          }
          allSectorIds.add(id);
        }
        if (descriptor === facetScope.includeDescriptor) includedSectorProof = proof.proof;
      }
      if (allSectorIds.size !== countryCount || !includedSectorProof) {
        return phenomFailure(capturedAt, "Phenom business-sector job IDs do not close the country total",
          artifacts, pages, counts, losses);
      }
      const jobLevelAggregation = exactPhenomAggregation(
        includedSectorProof.firstEnvelope,
        facetScope.exclusionField
      );
      if (!jobLevelAggregation ||
        [...jobLevelAggregation.values()].reduce((sum, value) => sum + value, 0) !==
          includedSectorProof.ids.size) {
        return phenomFailure(capturedAt, "Phenom Healthcare job-level facet is not a complete dynamic partition",
          artifacts, pages, counts, losses);
      }
      const allJobLevelIds = new Set<string>();
      const allowedJobIds = new Set<string>();
      const allowed: string[] = [];
      const jobLevels = [...jobLevelAggregation.keys()].sort();
      for (let partitionIndex = 0; partitionIndex < jobLevels.length; partitionIndex += 1) {
        const descriptor = jobLevels[partitionIndex]!;
        const proof = await fetchPhenomPartitionProof({
          http, endpoint: widgetEndpoint, entryUrl: safeEntryUrl, pageConfig, pageSize, maxPages,
          selectedFields: {
            country: [facetScope.countryIncludeDescriptor],
            [facetScope.includeField]: [facetScope.includeDescriptor],
            [facetScope.exclusionField]: [descriptor]
          },
          expectedTotal: jobLevelAggregation.get(descriptor)!, capturedAt, now,
          family: "job-level", partitionIndex,
          requiredCountry: facetScope.countryIncludeDescriptor,
          optionalExactFields: [
            { field: facetScope.includeField, descriptor: facetScope.includeDescriptor },
            { field: facetScope.exclusionField, descriptor }
          ],
          allowOmittedOffsetForSinglePage: config.allowOmittedOffsetForSinglePage === true,
          configLocator
        });
        if (!proof.ok) {
          return phenomFailure(capturedAt, proof.failureReason, artifacts, pages, counts, losses);
        }
        artifacts.push(...proof.proof.artifacts);
        const isAllowed = !facetScope.exclusionDescriptors.includes(descriptor);
        if (isAllowed) allowed.push(descriptor);
        for (const id of proof.proof.ids) {
          if (allJobLevelIds.has(id)) {
            return phenomFailure(capturedAt, "Phenom Healthcare job-level partitions overlap by job ID",
              artifacts, pages, counts, losses);
          }
          allJobLevelIds.add(id);
          if (isAllowed) allowedJobIds.add(id);
        }
      }
      if (allJobLevelIds.size !== includedSectorProof.ids.size ||
        [...includedSectorProof.ids].some((id) => !allJobLevelIds.has(id))) {
        return phenomFailure(capturedAt, "Phenom Healthcare job-level job IDs do not close the sector partition",
          artifacts, pages, counts, losses);
      }
      if (allowed.length === 0) {
        return phenomFailure(capturedAt, "Phenom structured facet scope excludes every descriptor for the configured facet",
          artifacts, pages, counts, losses);
      }
      structuredExpectedTotal = allowedJobIds.size;
      partitionExpectedOfficialIds = allowedJobIds;
      allowedExclusionFacetDescriptors = new Set(allowed);
      formalSelectedFields = {
        country: [facetScope.countryIncludeDescriptor],
        [facetScope.includeField]: [facetScope.includeDescriptor],
        [facetScope.exclusionField]: allowed
      };
    } else {
      const exclusionAggregation = exactPhenomAggregation(countryPreflight.envelope, facetScope.exclusionField);
      if (!exclusionAggregation ||
        [...exclusionAggregation.values()].reduce((sum, value) => sum + value, 0) !== countryCount ||
        (!facetScope.requireGlobalDescriptorProof &&
          facetScope.exclusionDescriptors.some((descriptor) => !exclusionAggregation.has(descriptor)))) {
        return phenomFailure(capturedAt, "Phenom exclusion facet is not a complete mutually exclusive partition",
          artifacts, pages, counts, losses);
      }
      const allowed = [...exclusionAggregation.keys()].filter(
        (descriptor) => !facetScope.exclusionDescriptors.includes(descriptor)
      ).sort();
      if (allowed.length === 0) {
        return phenomFailure(capturedAt, "Phenom structured facet scope excludes every descriptor for the configured facet",
          artifacts, pages, counts, losses);
      }
      structuredExpectedTotal = allowed.reduce((sum, descriptor) => sum + exclusionAggregation.get(descriptor)!, 0);
      allowedExclusionFacetDescriptors = new Set(allowed);
      formalSelectedFields = {
        country: [facetScope.countryIncludeDescriptor],
        [facetScope.exclusionField]: allowed
      };
    }
  }

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const requestedOffset = pageIndex * pageSize;
    const pageRequestBody = phenomWidgetRequestBody(
      pageConfig,
      pageSize,
      requestedOffset,
      formalSelectedFields,
      exactMerckHealthcarePartition
    );
    const pageRequestLocator = (baseLocator: string) => requestContractV2Locator(baseLocator, {
      family: "phenom", role: "page", method: "POST", url: widgetEndpoint,
      body: JSON.parse(pageRequestBody),
      coordinate: { sequence: pageIndex, requestedOffset, requestedPage: null, requestedPageSize: pageSize }
    });
    let response: OfficialJsonHttpResponse;
    try {
      response = await http({
        url: widgetEndpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json", Accept: "application/json",
          Origin: new URL(safeEntryUrl).origin, Referer: safeEntryUrl,
          "User-Agent": "job-search-crawler/0.1"
        },
        body: pageRequestBody
      });
    } catch (error) {
      const transportFailure = withPhenomTransportStage(
        retryableTransportFailureFromError(error),
        "PAGE"
      );
      return phenomFailure(
        capturedAt,
        transportFailure ? safeSourceTransportFailureReason(transportFailure) : "Phenom widgets TRANSPORT_FAILURE",
        artifacts,
        pages,
        counts,
        losses,
        undefined,
        transportFailure
      );
    }
    try {
      assertOfficialJsonEvidenceResponse(response, {
        requestedUrl: widgetEndpoint,
        crawlStartedAtMs: Date.parse(capturedAt),
        observedNowMs: now().getTime()
      });
    } catch (error) {
      return phenomFailure(capturedAt, safeOfficialJsonFailure(error, "Phenom widget response metadata is invalid"),
        artifacts, pages, counts, losses);
    }

    const artifactId = `phenom-page-${String(pageIndex).padStart(4, "0")}`;
    const unavailableBaseLocator = `phenom-page-v1|entry:phenom-entry-0000|config:${irreversibleOfficialJsonEvidenceId(configLocator)}|${phenomSelectedFieldsLocator(formalSelectedFields)}|requestOffset:${requestedOffset}|json:unavailable`;
    const unavailableLocator = pageRequestLocator(unavailableBaseLocator);
    const artifact = phenomArtifact({
      id: artifactId, kind: "PAGINATION_PAGE", requestedUrl: widgetEndpoint,
      response, extractorLocator: unavailableLocator
    });
    artifacts.push(artifact);
    if (response.status < 200 || response.status >= 300) {
      const transportFailure = withPhenomTransportStage(
        retryableHttpTransportFailure(response.status),
        "PAGE"
      );
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(
        capturedAt,
        transportFailure
          ? safeSourceTransportFailureReason(transportFailure)
          : `Phenom widgets API returned HTTP ${response.status}`,
        artifacts,
        pages,
        counts,
        losses,
        undefined,
        transportFailure
      );
    }
    try {
      assertOfficialJsonMime(response);
    } catch (error) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt, safeOfficialJsonFailure(error, "Phenom widget response has an invalid Content-Type"),
        artifacts, pages, counts, losses);
    }

    let root: unknown;
    try { root = JSON.parse(response.body); } catch {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt, "Phenom widgets response is not valid JSON", artifacts, pages, counts, losses);
    }
    if (!hasUniqueJsonObjectKeys(response.body)) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt, "Phenom widgets response contains ambiguous duplicate JSON keys",
        artifacts, pages, counts, losses);
    }
    if (!isStrictRecord(root) || !isStrictRecord(root.refineSearch) ||
      !isStrictRecord(root.refineSearch.data) || !Array.isArray(root.refineSearch.data.jobs)) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt, "Phenom widgets response requires $.refineSearch.data.jobs array",
        artifacts, pages, counts, losses);
    }
    const refineSearch = root.refineSearch;
    const refineData = refineSearch.data as Record<string, unknown>;
    if (exactMerckHealthcarePartition &&
      !exactPhenomResponseUiSelections(refineData, formalSelectedFields)) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt,
        "Phenom Merck formal response ui_selections does not equal the requested selected_fields",
        artifacts, pages, counts, losses);
    }
    let pageTotal: number | undefined;
    if (facetScope && !hasOwn(refineSearch, "totalHits")) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt, "Phenom structured facet page requires own totalHits",
        artifacts, pages, counts, losses);
    }
    if (hasOwn(refineSearch, "totalHits")) {
      if (!isNonnegativeInteger(refineSearch.totalHits)) {
        pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
        return phenomFailure(capturedAt, "Phenom $.refineSearch.totalHits must be a nonnegative integer",
          artifacts, pages, counts, losses);
      }
      pageTotal = refineSearch.totalHits;
      if (structuredExpectedTotal !== undefined && pageTotal !== structuredExpectedTotal) {
        pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
        return phenomFailure(capturedAt, "Phenom filtered total does not equal the allowed exclusion partition",
          artifacts, pages, counts, losses);
      }
    }
    let returnedOffset: number | null = null;
    const requestBoundOmittedOffset = exactRocheRequestBoundOmittedOffset && !hasOwn(refineSearch, "from");
    const safelyOmittedSinglePageOffset = facetScope && config.allowOmittedOffsetForSinglePage === true &&
      !hasOwn(refineSearch, "from") && pageIndex === 0 && requestedOffset === 0 &&
      pageTotal !== undefined && pageTotal <= pageSize &&
      (refineData.jobs as unknown[]).length === pageTotal;
    if (requestBoundOmittedOffset && (pageTotal === undefined || requestedOffset > pageTotal ||
      (refineData.jobs as unknown[]).length !== Math.min(pageSize, pageTotal - requestedOffset))) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt,
        "Phenom Roche request-bound page cardinality does not close the requested offset",
        artifacts, pages, counts, losses);
    }
    if (facetScope && !hasOwn(refineSearch, "from") &&
      !safelyOmittedSinglePageOffset && !requestBoundOmittedOffset) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt, "Phenom structured facet page requires own from",
        artifacts, pages, counts, losses);
    }
    if (safelyOmittedSinglePageOffset) {
      returnedOffset = 0;
    } else if (hasOwn(refineSearch, "from")) {
      if (!isNonnegativeInteger(refineSearch.from)) {
        pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
        return phenomFailure(capturedAt, "Phenom $.refineSearch.from must be a nonnegative integer",
          artifacts, pages, counts, losses);
      }
      returnedOffset = refineSearch.from;
      if (facetScope && returnedOffset !== requestedOffset) {
        pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, returnedOffset, termination: "FAILED" }));
        return phenomFailure(capturedAt, "Phenom structured facet page offset drifted",
          artifacts, pages, counts, losses);
      }
    }
    const locator = pageRequestLocator(pageTotal === undefined
      ? unavailableBaseLocator.replace("json:unavailable", "json:$.refineSearch.data.jobs")
      : phenomTotalLocator(configLocator, formalSelectedFields, requestedOffset));
    artifact.extractorLocator = locator;
    if (declaredTotal === undefined && pageTotal !== undefined) {
      declaredTotal = pageTotal;
      declaredArtifactKey = artifact.logicalKey;
      declaredLocator = locator;
    }

    const rawJobs = refineData.jobs as unknown[];
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let recordIndex = 0; recordIndex < rawJobs.length; recordIndex += 1) {
      const raw = rawJobs[recordIndex];
      counts.rawCount += 1;
      const rawOfficialId = isStrictRecord(raw)
        ? stringValue(raw.jobSeqNo) ?? stringValue(raw.reqId) ?? stringValue(raw.jobId)
        : undefined;
      const rawEvidenceId = irreversibleOfficialJsonEvidenceId(rawOfficialId ?? raw);
      if (!rawIds.includes(rawEvidenceId)) rawIds.push(rawEvidenceId);
      const rawLocator = `${artifact.logicalKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex, raw])}`;
      if (!isStrictRecord(raw)) {
        recordPhenomLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", rawLocator, pageIndex, recordIndex);
        continue;
      }
      counts.parsedCount += 1;
      const id = stringValue(raw.jobSeqNo) ?? stringValue(raw.reqId) ?? stringValue(raw.jobId);
      const title = stringValue(raw.title);
      const locationSelection = selectPhenomLocation(raw);
      const locationRaw = locationSelection.locationRaw;
      const applyUrlRaw = stringValue(raw.applyUrl);
      const reqId = stringValue(raw.reqId);
      const derivedDetailId = config.derivedDetailIdField === "jobSeqNo"
        ? stringValue(raw.jobSeqNo)
        : reqId;
      const missing = !id ? "id" : !title ? "title" : !locationRaw ? "locationRaw" :
        !applyUrlRaw && !derivedDetailId ? "officialUrl" : undefined;
      if (missing) {
        recordPhenomLoss(losses, counts, "VALIDATION", "MISSING_REQUIRED_FIELD", rawLocator, pageIndex, recordIndex, missing);
        continue;
      }
      if (!safeOfficialJsonId(id!)) {
        recordPhenomLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_ID", rawLocator, pageIndex, recordIndex, "id");
        continue;
      }
      const firstRaw = firstRawByOfficialId.get(id!);
      const exactDuplicate = seenOfficialIds.has(id!) && firstRaw !== undefined &&
        firstRaw.pageIndex !== pageIndex && exactRocheRequestBoundOmittedOffset &&
        config.exactDuplicateReconciliationPolicy === "ROCHE_IDENTICAL_CROSS_PAGE_V1" &&
        firstRaw.serialized === JSON.stringify(raw);
      if (seenOfficialIds.has(id!) && !exactDuplicate) {
        recordPhenomLoss(losses, counts, "VALIDATION", "DUPLICATE_OFFICIAL_ID", rawLocator, pageIndex, recordIndex, "id");
        continue;
      }
      const city = locationSelection.city;
      const locationScopeInvalid = explicitlyForeignOrNonMainlandLocation(locationRaw!) ||
        (city !== undefined && explicitlyForeignOrNonMainlandLocation(city)) ||
        explicitlyGenericOrAmbiguousLocation(locationRaw!) ||
        (city !== undefined && explicitlyGenericOrAmbiguousLocation(city)) ||
        stringsValue(raw.multi_location).some(explicitlyGenericOrAmbiguousLocation) ||
        phenomLocationHasAmbiguousSegments(locationRaw!);
      if ((facetScope || sourceScopedChinaRequest) && phenomCountryIsMainlandChina(locationSelection.country) &&
        locationScopeInvalid) {
        recordPhenomLoss(losses, counts, "VALIDATION", "OUT_OF_SCOPE", rawLocator, pageIndex, recordIndex);
        pages.push(phenomPageTrace({
          artifact, sequence: pageIndex, requestedOffset, returnedOffset,
          rawJobIds: rawIds, validJobIds: validIds,
          ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }),
          termination: "FAILED"
        }));
        return phenomFailure(capturedAt,
          "Phenom record location conflicts with the requested mainland China scope",
          artifacts, pages, counts, losses);
      }
      const partitionScoped = facetScope?.partitionProofPolicy === "MERCK_HEALTHCARE_PARTITION_V1";
      const presentIncludeDescriptor = facetScope?.includeField
        ? stringValue(raw[facetScope.includeField])
        : undefined;
      const presentExclusionDescriptor = facetScope
        ? stringValue(raw[facetScope.exclusionField])
        : undefined;
      const structuredScopeDrift = facetScope && (
        !phenomRecordMatchesCountryFacet(
          raw,
          facetScope.countryIncludeDescriptor,
          config.mixedLocationScopePolicy === "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1"
        ) ||
        (!facetScope.countryOnly && (partitionScoped
          ? !partitionExpectedOfficialIds?.has(id!) ||
            (presentIncludeDescriptor !== undefined && presentIncludeDescriptor !== facetScope.includeDescriptor) ||
            (presentExclusionDescriptor !== undefined &&
              !allowedExclusionFacetDescriptors?.has(presentExclusionDescriptor))
          : !allowedExclusionFacetDescriptors?.has(presentExclusionDescriptor ?? "")))
      );
      if (structuredScopeDrift) {
        recordPhenomLoss(losses, counts, "VALIDATION", "OUT_OF_SCOPE", rawLocator, pageIndex, recordIndex);
        pages.push(phenomPageTrace({
          artifact, sequence: pageIndex, requestedOffset, returnedOffset,
          rawJobIds: rawIds, validJobIds: validIds,
          ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }),
          termination: "FAILED"
        }));
        return phenomFailure(capturedAt,
          "Phenom structured facet record drifted outside the requested scope",
          artifacts, pages, counts, losses);
      }
      if (sourceScopedChinaRequest && !phenomRecordHasChinaScope(
        locationSelection.country, locationRaw!, city
      )) {
        recordPhenomLoss(losses, counts, "VALIDATION", "OUT_OF_SCOPE", rawLocator, pageIndex, recordIndex);
        continue;
      }
      let officialUrl: string;
      try {
        officialUrl = applyUrlRaw
          ? safePhenomJobUrl(applyUrlRaw, detailBaseUrl, allowedApplyOrigins)
          : safePhenomDerivedDetailUrl(derivedDetailId!, detailBaseUrl);
      } catch {
        recordPhenomLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_URL", rawLocator, pageIndex, recordIndex, "officialUrl");
        continue;
      }
      const sensitiveField = sensitiveOfficialJsonField({
        id: id!, title: title!, locationRaw: locationRaw!, city: city ?? "", officialUrl
      });
      if (sensitiveField) {
        recordPhenomLoss(losses, counts, "VALIDATION", "SENSITIVE_OUTPUT", rawLocator, pageIndex, recordIndex, sensitiveField);
        continue;
      }
      seenOfficialIds.add(id!);
      if (!firstRaw) firstRawByOfficialId.set(id!, { pageIndex, serialized: JSON.stringify(raw) });
      const sourceJobId = persistentOfficialJsonJobId(id!);
      jobs.push({
        sourceJobId, title: title!, officialUrl, locationRaw: locationRaw!,
        cities: citiesWithFallback(`${city ?? ""} ${locationRaw!}`, city ?? locationRaw!)
      });
      counts.validCount += 1;
      validIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
    }

    cumulativeRaw += rawJobs.length;
    const hasNext = pageTotal !== undefined && cumulativeRaw < pageTotal;
    const atMax = pageIndex === maxPages - 1;
    const nextSignal = hasNext ? `offset:${requestedOffset + pageSize}` : null;
    const termination: SourceFetchPageTrace["termination"] = pageTotal === undefined
      ? "ABORTED"
      : hasNext
        ? atMax ? "MAX_PAGE_LIMIT" : "CONTINUE"
        : rawJobs.length === 0 && pageIndex === 0 && pageTotal === 0 ? "EMPTY_PAGE" : "NEXT_ABSENT";
    pages.push(phenomPageTrace({
      artifact, sequence: pageIndex, requestedOffset, returnedOffset, requestedPageSize: pageSize,
      rawJobIds: rawIds, validJobIds: validIds,
      ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }),
      nextPageSignalBefore: pageIndex === 0 ? null : `offset:${requestedOffset}`,
      nextPageSignalAfter: nextSignal, termination
    }));
    if (!hasNext || atMax) break;
  }

  if (partitionExpectedOfficialIds &&
    (seenOfficialIds.size !== partitionExpectedOfficialIds.size ||
      [...partitionExpectedOfficialIds].some((id) => !seenOfficialIds.has(id)))) {
    return phenomFailure(capturedAt,
      "Phenom final Healthcare result does not equal the dynamically proven allowed job IDs",
      artifacts, pages, counts, losses);
  }

  const declaredCompleteness = (sourceScopedChinaRequest || facetScope !== undefined) && declaredTotal !== undefined &&
    declaredArtifactKey && declaredLocator
    ? {
        kind: "OFFICIAL_TOTAL_COUNT" as const, value: declaredTotal,
        artifactLogicalKey: declaredArtifactKey, extractorLocator: declaredLocator, scope: "SOURCE" as const
      }
    : undefined;
  let finalized: ReturnType<typeof finalizeOfficialJsonEvidenceBundle>;
  try {
    finalized = finalizeOfficialJsonEvidenceBundle({
      artifacts, pages, fetchCounts: counts, fetchLosses: losses,
      ...(declaredCompleteness ? { declaredCompleteness } : {}),
      ...(exactRocheRequestBoundOmittedOffset &&
        config.exactDuplicateReconciliationPolicy === "ROCHE_IDENTICAL_CROSS_PAGE_V1"
        ? { allowRawIdOverlapAcrossPages: true }
        : {})
    });
  } catch (error) {
    return phenomFailure(capturedAt, safeOfficialJsonFailure(error, "Phenom pagination evidence is invalid"),
      artifacts, pages, counts, losses, declaredCompleteness);
  }
  const expectedNoncertifyingNoTotal = declaredTotal === undefined &&
    finalized.evaluation.derivedAnomalyCodes.length === 0;
  if (!finalized.evaluation.safeCompleteness && !expectedNoncertifyingNoTotal) {
    const retryableSnapshotDrift = finalized.evaluation.derivedAnomalyCodes.length === 1 &&
      finalized.evaluation.derivedAnomalyCodes[0] === "RAW_ID_OVERLAP_ACROSS_PAGES";
    return {
      ok: false, capturedAt,
      failureReason: `Phenom pagination evidence failed: ${finalized.evaluation.derivedAnomalyCodes.join(",")}`,
      fetchEvidence: finalized.evidence,
      paginationEvaluation: finalized.evaluation,
      ...(retryableSnapshotDrift ? {
        transportFailure: {
          code: "OFFICIAL_PAGINATION_SNAPSHOT_DRIFT" as const,
          retryable: true as const,
          stage: "PAGE" as const
        }
      } : {})
    };
  }
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...((sourceScopedChinaRequest || facetScope) && declaredTotal !== undefined ? { expectedJobCount: declaredTotal } : {}),
      completenessEvidenceKind: (sourceScopedChinaRequest || facetScope) && declaredTotal !== undefined
        ? "OFFICIAL_TOTAL_COUNT" : "WEAK_MANUAL_SAMPLE",
      completenessEvidenceUrl: safeOfficialJsonEvidenceUrl(safeEntryUrl),
      completenessBlockerReason: "Phenom evidence remains manual until downstream adapter accounting is complete",
      ...(declaredTotal === undefined ? {} : { totalPages: Math.ceil(declaredTotal / pageSize) }),
      pageSize,
      pagesVisited: pages.length
    },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

function exactRocheRequestBoundOmittedOffsetPlan(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  pageConfig: CompletePhenomPageConfig,
  widgetEndpoint: string
): boolean {
  const config = plan.officialJsonFetch;
  const fields = plan.json.fields;
  const facet = config?.kind === "phenom" ? config.facetScope : undefined;
  return config?.kind === "phenom" &&
    plan.company.id === "company-roche-china" && plan.company.officialChineseName === "罗氏制药中国" &&
    plan.company.category === "FOREIGN_PHARMA" &&
    plan.source.id === "source-roche-china-social" && plan.source.companyId === "company-roche-china" &&
    plan.source.kind === "SOCIAL" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.atsKind === "OFFICIAL_JSON" &&
    plan.source.officialEntryUrl === "https://careers.roche.com/cn/zh/search-results" &&
    plan.source.officialChainEvidenceUrl === "https://careers.roche.com/cn/zh/mainland-china-jobs" &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" &&
    fields.officialUrl === "officialUrl" && fields.locationRaw === "locationRaw" && fields.cities === "cities" &&
    config.detailBaseUrl === "https://careers.roche.com/cn/zh/job" &&
    JSON.stringify(config.allowedApplyOrigins) === JSON.stringify(["https://roche.wd3.myworkdayjobs.com"]) &&
    facet !== undefined && !("exclusionFacet" in facet) &&
    facet.countryIncludeDescriptor === "中国大陆" &&
    JSON.stringify(facet.categoryExcludeDescriptors) === JSON.stringify([]) &&
    config.countryFilter === undefined && config.allowedEntryRedirect === undefined &&
    config.allowOmittedOffsetForSinglePage === undefined &&
    config.mixedLocationScopePolicy === "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1" &&
    config.requestBoundOmittedOffsetPolicy === "ROCHE_REQUEST_BOUND_OMITTED_OFFSET_V1" &&
    config.exactDuplicateReconciliationPolicy === "ROCHE_IDENTICAL_CROSS_PAGE_V1" &&
    config.pageSize === 100 && config.maxPages === 10 &&
    widgetEndpoint === "https://careers.roche.com/widgets" &&
    pageConfig.widgetApiEndpoint === "https://careers.roche.com/widgets" &&
    pageConfig.country === "cn" && pageConfig.deviceType === "desktop" &&
    pageConfig.locale === "zh_cn" && pageConfig.refNum === "ROCHGLOBAL" &&
    pageConfig.pageName === "search-results" && pageConfig.pageId === "page11-ds";
}

function exactMerckHealthcarePartitionPlan(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  pageConfig: CompletePhenomPageConfig,
  widgetEndpoint: string
): boolean {
  const config = plan.officialJsonFetch;
  const fields = plan.json.fields;
  const facet = config?.kind === "phenom" ? config.facetScope : undefined;
  return config?.kind === "phenom" && facet !== undefined &&
    "partitionProofPolicy" in facet && facet.partitionProofPolicy === "MERCK_HEALTHCARE_PARTITION_V1" &&
    "includeFacet" in facet && facet.includeFacet?.field === "businessSector" &&
    facet.includeFacet.descriptor === "Healthcare" &&
    "exclusionFacet" in facet && facet.exclusionFacet?.field === "jobLevelId" &&
    JSON.stringify(facet.exclusionFacet.descriptors) === JSON.stringify([
      "A - Current Student",
      "B - Recent University Graduate(<1 year of experience)"
    ]) && facet.countryIncludeDescriptor === "China" &&
    plan.company.category === "FOREIGN_PHARMA" && plan.source.companyId === plan.company.id &&
    plan.source.kind === "SOCIAL" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.atsKind === "OFFICIAL_JSON" &&
    plan.source.officialEntryUrl === "https://careers.emdgroup.com/us/en/search-results?keywords=China" &&
    plan.source.officialChainEvidenceUrl === "https://careers.merckgroup.com/cn/zh/search-results" &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" &&
    fields.officialUrl === "officialUrl" && fields.locationRaw === "locationRaw" && fields.cities === "cities" &&
    config.detailBaseUrl === "https://careers.emdgroup.com/us/en/job" &&
    config.countryFilter === undefined && config.allowedApplyOrigins === undefined &&
    config.allowedEntryRedirect === undefined && config.derivedDetailIdField === undefined &&
    config.mixedLocationScopePolicy === undefined && config.requestBoundOmittedOffsetPolicy === undefined &&
    config.allowOmittedOffsetForSinglePage === true && config.pageSize === 50 && config.maxPages === 10 &&
    widgetEndpoint === "https://careers.emdgroup.com/widgets" &&
    pageConfig.widgetApiEndpoint === "https://careers.emdgroup.com/widgets" &&
    pageConfig.country === "us" && pageConfig.deviceType === "desktop" &&
    pageConfig.locale === "en_us" && pageConfig.refNum === "MQAEGZUS" &&
    pageConfig.pageName === "search-results" && pageConfig.pageId === "page18-ds";
}

function validatedPhenomEntryRedirect(
  candidate: Extract<OfficialJsonFetchConfig, { kind: "phenom" }>["allowedEntryRedirect"],
  entryUrl: string
): { origin: string; pathname: string } | undefined {
  if (candidate === undefined) return undefined;
  if (!isStrictRecord(candidate) || Object.keys(candidate).sort().join(",") !== "origin,pathname" ||
      typeof candidate.origin !== "string" || typeof candidate.pathname !== "string") {
    throw new Error("Phenom entry redirect configuration is invalid");
  }
  const safeOrigin = safeOfficialJsonEndpoint(candidate.origin);
  const origin = new URL(safeOrigin);
  if ((safeOrigin !== origin.origin && safeOrigin !== `${origin.origin}/`) ||
      origin.origin !== new URL(entryUrl).origin || !candidate.pathname.startsWith("/")) {
    throw new Error("Phenom entry redirect configuration is invalid");
  }
  const redirect = new URL(candidate.pathname, origin.origin);
  if (redirect.origin !== origin.origin || redirect.pathname !== candidate.pathname || redirect.search || redirect.hash) {
    throw new Error("Phenom entry redirect configuration is invalid");
  }
  return { origin: origin.origin, pathname: redirect.pathname };
}

function assertPhenomEntryEvidenceResponse(
  response: OfficialJsonHttpResponse,
  input: { requestedUrl: string; crawlStartedAtMs: number; observedNowMs: number },
  allowedRedirect: { origin: string; pathname: string } | undefined
): void {
  try {
    assertOfficialJsonEvidenceResponse(response, input);
    return;
  } catch (error) {
    if (!allowedRedirect || typeof response.finalUrl !== "string") throw error;
    let final: URL;
    try {
      final = new URL(safeOfficialJsonEndpoint(response.finalUrl));
    } catch {
      throw error;
    }
    if (final.origin !== allowedRedirect.origin || final.pathname !== allowedRedirect.pathname ||
        final.search || final.hash) {
      throw error;
    }
    assertOfficialJsonEvidenceResponse({ ...response, finalUrl: input.requestedUrl }, input);
  }
}

type CompletePhenomPageConfig = {
  widgetApiEndpoint: string;
  refNum: string;
  locale: string;
  deviceType: string;
  country: string;
  pageName: string;
  pageId: string;
};

type PhenomFacetScope = NonNullable<Extract<OfficialJsonFetchConfig, { kind: "phenom" }>["facetScope"]>;

type ValidPhenomFacetScope = {
  countryIncludeDescriptor: string;
  countryOnly: boolean;
  exclusionField: "category" | "jobLevelId" | "type";
  exclusionDescriptors: string[];
  requireGlobalDescriptorProof: boolean;
  includeField?: "businessSector";
  includeDescriptor?: string;
  partitionProofPolicy?: "MERCK_HEALTHCARE_PARTITION_V1";
};

type PhenomFacetEnvelope = {
  totalHits: number;
  jobs: unknown[];
  aggregations: unknown[];
};

function validPhenomFacetScope(value: PhenomFacetScope | undefined): ValidPhenomFacetScope | undefined {
  if (!value || typeof value.countryIncludeDescriptor !== "string" ||
    !value.countryIncludeDescriptor.trim()) return undefined;
  const modern = "exclusionFacet" in value && value.exclusionFacet !== undefined;
  const field = modern ? value.exclusionFacet.field : "category";
  const descriptors = modern ? value.exclusionFacet.descriptors : value.categoryExcludeDescriptors;
  if (!["category", "jobLevelId", "type"].includes(field) || !Array.isArray(descriptors) ||
    (modern && descriptors.length === 0) ||
    descriptors.some((item) => typeof item !== "string" || !item.trim()) ||
    new Set(descriptors).size !== descriptors.length) return undefined;
  const partitioned = "partitionProofPolicy" in value &&
    value.partitionProofPolicy === "MERCK_HEALTHCARE_PARTITION_V1";
  if (partitioned && (!("includeFacet" in value) || value.includeFacet?.field !== "businessSector" ||
    typeof value.includeFacet.descriptor !== "string" || !value.includeFacet.descriptor.trim())) return undefined;
  if (!partitioned && ("includeFacet" in value && value.includeFacet !== undefined)) return undefined;
  return {
    countryIncludeDescriptor: value.countryIncludeDescriptor,
    countryOnly: descriptors.length === 0,
    exclusionField: field,
    exclusionDescriptors: descriptors,
    requireGlobalDescriptorProof: modern && !partitioned,
    ...(partitioned ? {
      includeField: "businessSector" as const,
      includeDescriptor: value.includeFacet.descriptor,
      partitionProofPolicy: value.partitionProofPolicy
    } : {})
  };
}

function phenomWidgetRequestBody(
  config: CompletePhenomPageConfig,
  size: number,
  from: number,
  selectedFields: Record<string, string[]>,
  includeBusinessSector = false
): string {
  return JSON.stringify({
    lang: config.locale, locale: config.locale,
    deviceType: config.deviceType, country: config.country,
    pageName: config.pageName, size, from,
    jobs: true, counts: true,
    all_fields: [
      "category", "country", "state", "city", "type", "jobLevelId",
      ...(includeBusinessSector ? ["businessSector"] : [])
    ],
    clearAll: false, jdsource: "facets", isSliderEnable: false,
    pageId: config.pageId, siteType: "external", keywords: "", global: true,
    selected_fields: selectedFields,
    sort: { order: "desc", field: "postedDate" }, locationData: {},
    refNum: config.refNum, ddoKey: "refineSearch"
  });
}

async function fetchPhenomFacetPreflight(input: {
  http: OfficialJsonHttpClient;
  endpoint: string;
  entryUrl: string;
  pageConfig: CompletePhenomPageConfig;
  pageSize: number;
  selectedFields: Record<string, string[]>;
  enforceExactUiSelections: boolean;
  capturedAt: string;
  now: () => Date;
  id: string;
  locator: string;
}): Promise<
  | { ok: true; artifact: SourceFetchArtifactDraft; envelope: PhenomFacetEnvelope }
  | {
      ok: false;
      failureReason: string;
      transportFailure?: SourceTransportFailure;
      failureArtifact?: SourceFetchArtifactDraft;
    }
> {
  const failureStage: NonNullable<SourceTransportFailure["stage"]> =
    input.id === "phenom-facet-global" ? "FACET_GLOBAL" : "FACET_COUNTRY";
  const requestBody = phenomWidgetRequestBody(
    input.pageConfig,
    input.pageSize,
    0,
    input.selectedFields,
    input.enforceExactUiSelections
  );
  let response: OfficialJsonHttpResponse;
  try {
    response = await input.http({
      url: input.endpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/json", Accept: "application/json",
        Origin: new URL(input.entryUrl).origin, Referer: input.entryUrl,
        "User-Agent": "job-search-crawler/0.1"
      },
      body: requestBody
    });
  } catch (error) {
    const transportFailure = withPhenomTransportStage(
      retryableTransportFailureFromError(error),
      failureStage
    );
    return {
      ok: false,
      failureReason: transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : "Phenom facet preflight TRANSPORT_FAILURE",
      ...(transportFailure ? { transportFailure } : {})
    };
  }
  try {
    assertOfficialJsonEvidenceResponse(response, {
      requestedUrl: input.endpoint,
      crawlStartedAtMs: Date.parse(input.capturedAt),
      observedNowMs: input.now().getTime()
    });
  } catch (error) {
    return {
      ok: false,
      failureReason: safeOfficialJsonFailure(error, "Phenom facet preflight response metadata is invalid")
    };
  }
  const artifact = phenomArtifact({
    id: input.id,
    kind: "ATS_API_RESPONSE",
    requestedUrl: input.endpoint,
    response,
    extractorLocator: requestContractV2Locator(input.locator, {
      family: "phenom",
      role: input.id === "phenom-facet-global" ? "facet-preflight-global" : "facet-preflight-country",
      method: "POST",
      url: input.endpoint,
      body: JSON.parse(requestBody),
      coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: input.pageSize }
    })
  });
  if (response.status < 200 || response.status >= 300) {
    const transportFailure = withPhenomTransportStage(
      retryableHttpTransportFailure(response.status),
      failureStage
    );
    return {
      ok: false,
      failureReason: transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : `Phenom facet preflight returned HTTP ${response.status}`,
      failureArtifact: artifact,
      ...(transportFailure ? { transportFailure } : {})
    };
  }
  try {
    assertOfficialJsonMime(response);
  } catch (error) {
    return {
      ok: false,
      failureReason: safeOfficialJsonFailure(error, "Phenom facet preflight response has an invalid Content-Type"),
      failureArtifact: artifact
    };
  }
  if (!hasUniqueJsonObjectKeys(response.body)) {
    return { ok: false, failureReason: "Phenom facet preflight contains ambiguous duplicate JSON keys" };
  }
  let root: unknown;
  try { root = JSON.parse(response.body); } catch {
    return { ok: false, failureReason: "Phenom facet preflight is not valid JSON" };
  }
  if (!isStrictRecord(root) || !isStrictRecord(root.refineSearch) ||
    !isNonnegativeInteger(root.refineSearch.totalHits) || !isStrictRecord(root.refineSearch.data) ||
    !Array.isArray(root.refineSearch.data.jobs) || !Array.isArray(root.refineSearch.data.aggregations)) {
    return { ok: false, failureReason: "Phenom facet preflight envelope is invalid" };
  }
  if (input.enforceExactUiSelections &&
    !exactPhenomResponseUiSelections(root.refineSearch.data, input.selectedFields)) {
    return { ok: false, failureReason: "Phenom facet preflight ui_selections does not equal selected_fields" };
  }
  return {
    ok: true,
    artifact,
    envelope: {
      totalHits: root.refineSearch.totalHits,
      jobs: root.refineSearch.data.jobs,
      aggregations: root.refineSearch.data.aggregations
    }
  };
}

type PhenomPartitionProof = {
  artifacts: SourceFetchArtifactDraft[];
  ids: Set<string>;
  firstEnvelope: PhenomFacetEnvelope;
};

async function fetchPhenomPartitionProof(input: {
  http: OfficialJsonHttpClient;
  endpoint: string;
  entryUrl: string;
  pageConfig: CompletePhenomPageConfig;
  pageSize: number;
  maxPages: number;
  selectedFields: Record<string, string[]>;
  expectedTotal: number;
  capturedAt: string;
  now: () => Date;
  family: "business-sector" | "job-level";
  partitionIndex: number;
  requiredCountry: string;
  optionalExactFields: Array<{ field: string; descriptor: string }>;
  allowOmittedOffsetForSinglePage: boolean;
  configLocator: string;
}): Promise<{ ok: true; proof: PhenomPartitionProof } | { ok: false; failureReason: string }> {
  const artifacts: SourceFetchArtifactDraft[] = [];
  const ids = new Set<string>();
  let firstEnvelope: PhenomFacetEnvelope | undefined;
  for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
    const from = pageIndex * input.pageSize;
    if (from > input.expectedTotal || (from === input.expectedTotal && input.expectedTotal > 0)) break;
    const requestBody = phenomWidgetRequestBody(
      input.pageConfig,
      input.pageSize,
      from,
      input.selectedFields,
      true
    );
    let response: OfficialJsonHttpResponse;
    try {
      response = await input.http({
        url: input.endpoint,
        method: "POST",
        headers: {
          "Content-Type": "application/json", Accept: "application/json",
          Origin: new URL(input.entryUrl).origin, Referer: input.entryUrl,
          "User-Agent": "job-search-crawler/0.1"
        },
        body: requestBody
      });
    } catch {
      return { ok: false, failureReason: "Phenom partition proof TRANSPORT_FAILURE" };
    }
    try {
      assertOfficialJsonEvidenceResponse(response, {
        requestedUrl: input.endpoint,
        crawlStartedAtMs: Date.parse(input.capturedAt),
        observedNowMs: input.now().getTime()
      });
      if (response.status < 200 || response.status >= 300) throw new Error("HTTP status");
      assertOfficialJsonMime(response);
    } catch (error) {
      return { ok: false, failureReason: safeOfficialJsonFailure(error, "Phenom partition proof response is invalid") };
    }
    const logicalKey = `phenom-facet-proof-${input.family}-${String(input.partitionIndex).padStart(4, "0")}-${String(pageIndex).padStart(4, "0")}`;
    artifacts.push(phenomArtifact({
      id: logicalKey,
      kind: "ATS_API_RESPONSE",
      requestedUrl: input.endpoint,
      response,
      extractorLocator: requestContractV2Locator([
        input.configLocator,
        `facet-partition:${input.family}`,
        phenomSelectedFieldsLocator(input.selectedFields),
        `requestOffset:${from}`
      ].join("|"), {
        family: "phenom",
        role: `facet-partition-${input.family}`,
        method: "POST",
        url: input.endpoint,
        body: JSON.parse(requestBody),
        coordinate: {
          sequence: pageIndex,
          requestedOffset: from,
          requestedPage: null,
          requestedPageSize: input.pageSize
        }
      })
    }));
    if (!hasUniqueJsonObjectKeys(response.body)) {
      return { ok: false, failureReason: "Phenom partition proof contains ambiguous duplicate JSON keys" };
    }
    let root: unknown;
    try { root = JSON.parse(response.body); } catch {
      return { ok: false, failureReason: "Phenom partition proof is not valid JSON" };
    }
    if (!isStrictRecord(root) || !isStrictRecord(root.refineSearch)) {
      return { ok: false, failureReason: "Phenom partition proof envelope drifted" };
    }
    const hasReturnedOffset = hasOwn(root.refineSearch, "from");
    const safelyOmittedSinglePageOffset = input.allowOmittedOffsetForSinglePage && !hasReturnedOffset &&
      pageIndex === 0 && from === 0 && input.expectedTotal <= input.pageSize;
    if (root.refineSearch.totalHits !== input.expectedTotal ||
      (!safelyOmittedSinglePageOffset && (!hasReturnedOffset || root.refineSearch.from !== from)) ||
      !isStrictRecord(root.refineSearch.data) || !Array.isArray(root.refineSearch.data.jobs) ||
      !Array.isArray(root.refineSearch.data.aggregations)) {
      return { ok: false, failureReason: "Phenom partition proof envelope drifted" };
    }
    if (!exactPhenomResponseUiSelections(root.refineSearch.data, input.selectedFields)) {
      return { ok: false, failureReason: "Phenom partition proof ui_selections does not equal selected_fields" };
    }
    const rawJobs = root.refineSearch.data.jobs;
    const expectedPageCount = Math.min(input.pageSize, input.expectedTotal - from);
    if (rawJobs.length !== expectedPageCount) {
      return { ok: false, failureReason: "Phenom partition proof page cardinality drifted" };
    }
    const envelope: PhenomFacetEnvelope = {
      totalHits: input.expectedTotal,
      jobs: rawJobs,
      aggregations: root.refineSearch.data.aggregations
    };
    firstEnvelope ??= envelope;
    for (const raw of rawJobs) {
      if (!isStrictRecord(raw) || stringValue(raw.country) !== input.requiredCountry) {
        return { ok: false, failureReason: "Phenom partition proof returned an out-of-country record" };
      }
      for (const exact of input.optionalExactFields) {
        const present = stringValue(raw[exact.field]);
        if (present !== undefined && present !== exact.descriptor) {
          return { ok: false, failureReason: "Phenom partition proof record contradicted its requested facet" };
        }
      }
      const id = stringValue(raw.jobSeqNo) ?? stringValue(raw.reqId) ?? stringValue(raw.jobId);
      if (!id || !safeOfficialJsonId(id) || ids.has(id)) {
        return { ok: false, failureReason: "Phenom partition proof returned a missing, unsafe, or repeated job ID" };
      }
      ids.add(id);
    }
    if (ids.size === input.expectedTotal) break;
  }
  if (!firstEnvelope || ids.size !== input.expectedTotal) {
    return { ok: false, failureReason: "Phenom partition proof did not close its dynamic total" };
  }
  return { ok: true, proof: { artifacts, ids, firstEnvelope } };
}

function exactPhenomAggregation(envelope: PhenomFacetEnvelope, field: string): Map<string, number> | undefined {
  const matches = envelope.aggregations.filter(
    (item) => isStrictRecord(item) && stringValue(item.field) === field
  );
  const match = matches[0];
  if (matches.length !== 1 || !isStrictRecord(match) || !isStrictRecord(match.value)) return undefined;
  const values = new Map<string, number>();
  for (const [descriptor, count] of Object.entries(match.value)) {
    if (!descriptor.trim() || !isNonnegativeInteger(count) || values.has(descriptor)) return undefined;
    values.set(descriptor, count);
  }
  return values;
}

function exactPhenomResponseUiSelections(
  data: Record<string, unknown>,
  selectedFields: Record<string, string[]>
): boolean {
  const expectedKeys = Object.keys(selectedFields);
  const hasUiSelections = hasOwn(data, "ui_selections");
  if (expectedKeys.length === 0) {
    if (!hasUiSelections) return true;
    return isStrictRecord(data.ui_selections) && Object.keys(data.ui_selections).length === 0;
  }
  if (!hasUiSelections || !isStrictRecord(data.ui_selections)) return false;
  const uiSelections = data.ui_selections;
  const actualKeys = Object.keys(uiSelections);
  if (actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key) => !hasOwn(selectedFields, key))) return false;
  for (const key of expectedKeys) {
    const expected = selectedFields[key];
    const actual = uiSelections[key];
    if (!Array.isArray(expected) || !Array.isArray(actual) ||
      expected.some((value) => typeof value !== "string") ||
      actual.some((value) => typeof value !== "string") ||
      new Set(expected).size !== expected.length || new Set(actual).size !== actual.length ||
      actual.length !== expected.length || expected.some((value) => !actual.includes(value))) return false;
  }
  return true;
}

function completePhenomPageConfig(
  value: Partial<Record<keyof CompletePhenomPageConfig, string | undefined>>
): value is CompletePhenomPageConfig {
  return [
    value.widgetApiEndpoint, value.refNum, value.locale, value.deviceType,
    value.country, value.pageName, value.pageId
  ].every((item) => typeof item === "string" && item.length > 0);
}

function phenomConfigLocator(config: CompletePhenomPageConfig, endpoint: string): string {
  return [
    "phenom-entry-config-v1",
    `endpoint:${irreversibleOfficialJsonEvidenceId(endpoint)}`,
    `refNum:${irreversibleOfficialJsonEvidenceId(config.refNum)}`,
    `locale:${irreversibleOfficialJsonEvidenceId(config.locale)}`,
    `device:${irreversibleOfficialJsonEvidenceId(config.deviceType)}`,
    `country:${irreversibleOfficialJsonEvidenceId(config.country)}`,
    `pageName:${irreversibleOfficialJsonEvidenceId(config.pageName)}`,
    `pageId:${irreversibleOfficialJsonEvidenceId(config.pageId)}`
  ].join("|");
}

function phenomTotalLocator(
  configLocator: string,
  selectedFields: Record<string, string[]>,
  requestedOffset: number
): string {
  return [
    "phenom-page-v1",
    "entry:phenom-entry-0000",
    `config:${irreversibleOfficialJsonEvidenceId(configLocator)}`,
    phenomSelectedFieldsLocator(selectedFields),
    `requestOffset:${requestedOffset}`,
    "json:$.refineSearch.totalHits"
  ].join("|");
}

function phenomSelectedFieldsLocator(selectedFields: Record<string, string[]>): string {
  const canonical = Object.fromEntries(
    Object.keys(selectedFields).sort().map((field) => [
      field,
      [...(selectedFields[field] ?? [])].sort()
    ])
  );
  return `selectedFields:${irreversibleOfficialJsonEvidenceId(JSON.stringify(canonical))}`;
}

function phenomArtifact(input: {
  id: string;
  kind: "OFFICIAL_COMPANY_PAGE" | "ATS_API_RESPONSE" | "PAGINATION_PAGE";
  requestedUrl: string;
  response: OfficialJsonHttpResponse;
  extractorLocator: string;
}): SourceFetchArtifactDraft {
  return officialJsonNetworkArtifact({
    id: input.id,
    logicalKey: input.id,
    kind: input.kind,
    requestedUrl: input.requestedUrl,
    response: input.response,
    extractorLocator: input.extractorLocator
  });
}

function phenomPageTrace(input: {
  artifact: SourceFetchArtifactDraft;
  sequence: number;
  requestedOffset: number | null;
  requestedPageSize?: number | null;
  returnedOffset?: number | null;
  rawJobIds?: string[];
  validJobIds?: string[];
  declaredTotal?: number;
  nextPageSignalBefore?: string | null;
  nextPageSignalAfter?: string | null;
  termination: SourceFetchPageTrace["termination"];
}): SourceFetchPageTrace {
  return {
    sequence: input.sequence,
    artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null,
    returnedCursor: null,
    requestedOffset: input.requestedOffset,
    returnedOffset: input.returnedOffset ?? null,
    requestedPage: null,
    returnedPage: null,
    requestedPageSize: input.requestedPageSize ?? null,
    returnedPageSize: null,
    rawJobIds: input.rawJobIds ?? [],
    validJobIds: input.validJobIds ?? [],
    declaredTotal: input.declaredTotal ?? null,
    declaredCount: null,
    declaredPages: null,
    nextPageSignalBefore: input.nextPageSignalBefore ?? null,
    nextPageSignalAfter: input.nextPageSignalAfter ?? null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
    termination: input.termination,
    anomalyCodes: [],
    capturedAt: input.artifact.capturedAt
  };
}

function phenomEntryFailureEvidence(artifact: SourceFetchArtifactDraft): PersistentSourceFetchEvidence {
  return finalizeOfficialJsonFailureEvidenceBundle({
    artifacts: [artifact],
    pages: [phenomPageTrace({ artifact, sequence: 0, requestedOffset: null, termination: "FAILED" })],
    fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
    fetchLosses: []
  });
}

function withPhenomTransportStage(
  failure: SourceTransportFailure | undefined,
  stage: NonNullable<SourceTransportFailure["stage"]>
): SourceTransportFailure | undefined {
  return failure ? { ...failure, stage } : undefined;
}

function phenomFailure(
  capturedAt: string,
  failureReason: string,
  artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[],
  fetchCounts: PersistentSourceFetchEvidence["fetchCounts"],
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"],
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"],
  transportFailure?: SourceTransportFailure,
  failureStage?: NonNullable<SourceTransportFailure["stage"]>
): SourceFetchResult {
  const supportingFailureStage = failureStage ?? transportFailure?.stage;
  if (pages.length === 0 && supportingFailureStage) {
    return failedWithEvidence(
      capturedAt,
      failureReason,
      finalizeOfficialJsonSupportingFailureEvidence({
        artifacts,
        code: `PHENOM_${supportingFailureStage}_FAILED`
      }),
      transportFailure
    );
  }
  const evidencePages = pages.length > 0
    ? pages.map((page, index) => index === pages.length - 1 && page.termination === "CONTINUE"
      ? { ...page, termination: "ABORTED" as const }
      : page)
    : [phenomPageTrace({ artifact: artifacts[0]!, sequence: 0, requestedOffset: null, termination: "FAILED" })];
  return failedWithEvidence(
    capturedAt,
    failureReason,
    finalizeOfficialJsonFailureEvidenceBundle({
      artifacts,
      pages: evidencePages,
      fetchCounts,
      fetchLosses,
      ...(declaredCompleteness ? { declaredCompleteness } : {})
    }),
    transportFailure
  );
}

function recordPhenomLoss(
  losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"],
  stage: "PARSE" | "VALIDATION",
  code: "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "UNSAFE_OFFICIAL_ID" |
    "DUPLICATE_OFFICIAL_ID" | "OUT_OF_SCOPE" | "UNSAFE_OFFICIAL_URL" | "SENSITIVE_OUTPUT",
  rawLocator: string,
  pageSequence: number,
  recordIndex: number,
  field?: string
): void {
  if (stage === "PARSE") counts.parseDiscardCount += 1;
  else counts.validationDiscardCount += 1;
  losses.push({
    stage,
    reason: `Phenom record rejected: ${code}`,
    rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence, recordIndex }
  });
}

function explicitlyChina(value: string): boolean {
  return /(?:中华人民共和国|中国大陆|中国|大陆|china|prc|people'?s republic of china|mainland china|上海|北京|广州|深圳|成都|杭州|南京|苏州|武汉|天津|重庆|西安|兰州|太原)/iu.test(
    value.normalize("NFKC")
  );
}

function phenomRecordHasChinaScope(
  country: string | undefined,
  locationRaw: string,
  city: string | undefined
): boolean {
  if (explicitlyForeignOrNonMainlandLocation(locationRaw) ||
    (city !== undefined && explicitlyForeignOrNonMainlandLocation(city)) ||
    explicitlyGenericOrAmbiguousLocation(locationRaw) ||
    (city !== undefined && explicitlyGenericOrAmbiguousLocation(city)) ||
    phenomLocationHasAmbiguousSegments(locationRaw)) return false;
  if (country !== undefined) {
    return phenomCountryIsMainlandChina(country);
  }
  return explicitlyChina(`${locationRaw} ${city ?? ""}`);
}

function phenomLocationHasAmbiguousSegments(locationRaw: string): boolean {
  const normalized = locationRaw.normalize("NFKC");
  const segments = normalized.split(/[,，/|;；\r\n>、()（）\-–—]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) return false;
  if (segments.some((segment) => /^(?:china|prc|chn|mainland china|china mainland|中国|中国大陆|中华人民共和国)$/iu.test(segment))) {
    return false;
  }
  return segments.some((segment) =>
    !explicitlyForeignOrNonMainlandLocation(segment) &&
    !explicitlyChina(segment) &&
    !/^(?:cn|chn|shanghai|beijing|guangzhou|shenzhen|chengdu|hangzhou|nanjing|suzhou|wuhan|tianjin|chongqing|xi'?an|jiangsu|zhejiang|guangdong|sichuan|hubei|hunan|henan|hebei|shandong|fujian|anhui|jiangxi|liaoning|jilin|heilongjiang|shanxi|shaanxi|yunnan|guizhou|gansu|qinghai|hainan|内蒙古|广西|宁夏|新疆|西藏)$/iu.test(segment)
  );
}

function phenomCountryIsMainlandChina(country: string | undefined): boolean {
  if (country === undefined) return false;
  const normalizedCountry = country.normalize("NFKC").trim().toLowerCase();
  return /^(?:china|prc|mainland china|china mainland|people'?s republic of china|中国|中国大陆|中华人民共和国)$/iu.test(
    normalizedCountry
  );
}

function phenomRecordMatchesCountryFacet(
  record: Record<string, unknown>,
  countryDescriptor: string,
  allowMainlandAlternative: boolean
): boolean {
  if (stringValue(record.country) === countryDescriptor) return true;
  if (!allowMainlandAlternative || !phenomCountryIsMainlandChina(countryDescriptor)) return false;

  const primary = stringValue(record.location) ?? stringValue(record.cityStateCountry) ?? stringValue(record.city);
  const country = stringValue(record.country);
  const locations = stringsValue(record.multi_location);
  if (!primary || !country || locations.length < 2 ||
    !explicitlyForeignOrNonMainlandLocation(primary) ||
    !explicitlyForeignOrNonMainlandLocation(country)) return false;

  const locationKey = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  const keys = locations.map(locationKey);
  if (new Set(keys).size !== keys.length || !keys.includes(locationKey(primary))) return false;

  const mainland = locations.filter((location) =>
    !explicitlyForeignOrNonMainlandLocation(location) &&
    !phenomLocationHasAmbiguousSegments(location) &&
    phenomRecordHasChinaScope(undefined, location, undefined)
  );
  return mainland.length === 1 && locations.every((location) =>
    location === mainland[0] || explicitlyForeignOrNonMainlandLocation(location)
  );
}

function selectPhenomLocation(record: Record<string, unknown>): {
  locationRaw: string | undefined;
  city: string | undefined;
  country: string | undefined;
} {
  const country = stringValue(record.country);
  const city = stringValue(record.city);
  const primary = stringValue(record.location) ?? stringValue(record.cityStateCountry) ?? city;
  const mainlandAlternative = stringsValue(record.multi_location).find((candidate) =>
    !explicitlyForeignOrNonMainlandLocation(candidate) &&
    !phenomLocationHasAmbiguousSegments(candidate) &&
    phenomRecordHasChinaScope(undefined, candidate, undefined)
  );

  if (mainlandAlternative !== undefined &&
      (primary === undefined || explicitlyForeignOrNonMainlandLocation(primary))) {
    return { locationRaw: mainlandAlternative, city: undefined, country: undefined };
  }

  return {
    locationRaw: primary ?? firstString(record.multi_location),
    city,
    country
  };
}

function safePhenomJobUrl(
  raw: string,
  detailBaseUrl: string,
  allowedOrigins: ReadonlySet<string>
): string {
  const url = safeOfficialJsonEndpoint(new URL(raw, detailBaseUrl).toString());
  if (!allowedOrigins.has(new URL(url).origin)) {
    throw new Error("Phenom official job origin mismatch");
  }
  return url;
}

function safePhenomDerivedDetailUrl(detailId: string, detailBaseUrl: string): string {
  if (!safeOfficialJsonId(detailId)) throw new Error("Phenom derived detail ID is invalid");
  const base = safeOfficialJsonEndpoint(detailBaseUrl);
  const url = safeOfficialJsonEndpoint(`${base.replace(/\/+$/u, "")}/${encodeURIComponent(detailId)}`);
  if (new URL(url).origin !== new URL(base).origin) {
    throw new Error("Phenom derived detail origin mismatch");
  }
  return url;
}

type HcmCloudEndpoint = "count" | "list";

type HcmCloudPost = (
  endpoint: HcmCloudEndpoint,
  body: string
) => Promise<OfficialJsonHttpResponse>;

async function fetchHcmCloudWithPost({
  config,
  entryUrl,
  entryEvidenceUrl,
  origin,
  capturedAt,
  now,
  post,
  initialArtifacts = [],
  initialCapturedAtMs,
  artifactPrefix = ""
}: {
  config: Extract<OfficialJsonFetchConfig, { kind: "hcm-cloud" }>;
  entryUrl: string;
  entryEvidenceUrl: string;
  origin: string;
  capturedAt: string;
  now: () => Date;
  post: HcmCloudPost;
  initialArtifacts?: SourceFetchArtifactDraft[];
  initialCapturedAtMs?: number;
  artifactPrefix?: "" | "browser-";
}): Promise<SourceFetchResult> {
  const pageSize = Math.max(1, config.pageSize ?? 20);
  const maxPages = Math.max(1, config.maxPages ?? 50);
  const countUrl = new URL("/api/hcm.model.count?model=ReleaseJobMgr", origin).toString();
  const listUrl = new URL("/api/hcm.model.list?model=ReleaseJobMgr", origin).toString();
  const artifacts: SourceFetchArtifactDraft[] = [...initialArtifacts];
  const pages: SourceFetchPageTrace[] = [];
  const counts: PersistentSourceFetchEvidence["fetchCounts"] = {
    rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0
  };
  const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  let previousCapturedAtMs = initialCapturedAtMs ?? Date.parse(capturedAt);
  const countPayload = hcmCloudCountPayload(config);
  const listProbePayload = hcmCloudListPayload(config, 1, pageSize);
  const countFilter = hcmCloudSemanticFilterTuple(countPayload);
  const listFilter = hcmCloudSemanticFilterTuple(listProbePayload);
  const countFilterHash = hcmCloudTupleHash(countFilter);
  if (countFilterHash !== hcmCloudTupleHash(listFilter)) {
    return failed(capturedAt, "HCMCloud count/list semantic filter tuple mismatch");
  }
  const countRequestLocator = (baseLocator: string) => requestContractV2Locator(baseLocator, {
    family: "hcm", role: "count", method: "POST", url: countUrl, body: countPayload,
    coordinate: { sequence: null, requestedPage: null, requestedPageSize: null }
  });
  let countResponse: OfficialJsonHttpResponse;
  try {
    countResponse = await post("count", encodeHcmCloudRequest(countPayload));
  } catch (error) {
    const transportFailure = retryableTransportFailureFromError(error);
    return hcmCloudFailure(capturedAt, transportFailure
      ? safeSourceTransportFailureReason(transportFailure)
      : "HCMCloud count API TRANSPORT_FAILURE", artifacts, pages, counts, losses,
      undefined, "HCM_COUNT_RESPONSE_FAILED", transportFailure);
  }
  const countArtifact = hcmCloudArtifact({
    id: `${artifactPrefix}hcm-count-0000`, kind: "ATS_API_RESPONSE", requestedUrl: countUrl,
    response: countResponse,
    locator: countRequestLocator(hcmCloudCountLocator(countFilterHash))
  });
  try {
    assertOfficialJsonEvidenceResponse(countResponse, {
      requestedUrl: countUrl,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    });
    previousCapturedAtMs = hcmCloudNondecreasingCapture(countResponse, previousCapturedAtMs);
  } catch (error) {
    return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud count metadata is invalid"),
      countArtifact ? [countArtifact] : [], pages, counts, losses);
  }
  artifacts.push(countArtifact!);
  if (countResponse.status < 200 || countResponse.status >= 300) {
    const transportFailure = retryableHttpTransportFailure(countResponse.status);
    return hcmCloudFailure(capturedAt, transportFailure
      ? safeSourceTransportFailureReason(transportFailure)
      : `HCMCloud count API returned HTTP ${countResponse.status}`,
      artifacts, pages, counts, losses, undefined, "HCM_COUNT_RESPONSE_FAILED", transportFailure);
  }
  try {
    assertOfficialJsonMime(countResponse);
  } catch (error) {
    return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud count MIME is invalid"),
      artifacts, pages, counts, losses);
  }
  let countDecoded: HcmCloudDecoded;
  try {
    countDecoded = decodeHcmCloudResponseStrict(countResponse.body, config.responsePrefixPolicy);
  } catch {
    return hcmCloudFailure(capturedAt, "HCMCloud count response decode failed", artifacts, pages, counts, losses);
  }
  let countSelection: { value?: number; path?: string };
  try {
    countSelection = selectHcmCloudCount(countDecoded.value, config.countCoordinatePolicy);
  } catch (error) {
    return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud count is invalid"),
      artifacts, pages, counts, losses);
  }
  const expectedJobCount = countSelection.value;
  const countLocator = countRequestLocator(
    hcmCloudCountLocator(countFilterHash, countDecoded.algorithm, countSelection.path)
  );
  countArtifact!.extractorLocator = countLocator;
  const jobs: NormalizedOfficialJsonJob[] = [];
  const seenOfficialIds = new Set<string>();
  const seenDetailIds = new Set<string>();
  let cumulativeRaw = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageSequence = pages.length;
    const requestPayload = hcmCloudListPayload(config, page, pageSize);
    const pageRequestLocator = (baseLocator: string) => requestContractV2Locator(baseLocator, {
      family: "hcm", role: "page", method: "POST", url: listUrl, body: requestPayload,
      coordinate: { sequence: pageSequence, requestedPage: page, requestedPageSize: pageSize }
    });
    if (hcmCloudTupleHash(hcmCloudSemanticFilterTuple(requestPayload)) !== countFilterHash) {
      return hcmCloudFailure(capturedAt, "HCMCloud count/list semantic filter tuple mismatch",
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    let response: OfficialJsonHttpResponse;
    try {
      response = await post("list", encodeHcmCloudRequest(requestPayload));
    } catch (error) {
      const transportFailure = retryableTransportFailureFromError(error);
      return hcmCloudFailure(capturedAt, transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : "HCMCloud list API TRANSPORT_FAILURE",
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact),
        "HCM_LIST_RESPONSE_FAILED", transportFailure);
    }
    let artifact: SourceFetchArtifactDraft | undefined;
    try {
      assertOfficialJsonEvidenceResponse(response, {
        requestedUrl: listUrl,
        crawlStartedAtMs: Date.parse(capturedAt),
        observedNowMs: now().getTime()
      });
      hcmCloudNondecreasingCapture(response, previousCapturedAtMs);
      artifact = hcmCloudArtifact({
        id: `${artifactPrefix}hcm-list-${String(page).padStart(4, "0")}`, kind: "PAGINATION_PAGE",
        requestedUrl: listUrl, response,
        locator: pageRequestLocator(hcmCloudListLocator(countFilterHash, page, pageSize))
      });
      artifacts.push(artifact);
      previousCapturedAtMs = Date.parse(response.capturedAt!);
    } catch (error) {
      return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud list metadata is invalid"),
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact),
        "HCM_LIST_RESPONSE_FAILED");
    }
    if (response.status < 200 || response.status >= 300) {
      pages.push(hcmCloudPageTrace({ artifact, sequence: pages.length, requestedPage: page,
        ...(expectedJobCount !== undefined ? { declaredTotal: expectedJobCount } : {}), termination: "FAILED" }));
      const transportFailure = retryableHttpTransportFailure(response.status);
      return hcmCloudFailure(capturedAt, transportFailure
        ? safeSourceTransportFailureReason(transportFailure)
        : `HCMCloud list API returned HTTP ${response.status}`,
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact),
        "HCM_LIST_RESPONSE_FAILED", transportFailure);
    }
    try { assertOfficialJsonMime(response); } catch (error) {
      pages.push(hcmCloudPageTrace({ artifact, sequence: pages.length, requestedPage: page,
        ...(expectedJobCount !== undefined ? { declaredTotal: expectedJobCount } : {}), termination: "FAILED" }));
      return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud list MIME is invalid"),
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    let decoded: HcmCloudDecoded;
    try { decoded = decodeHcmCloudResponseStrict(response.body, config.responsePrefixPolicy); } catch {
      pages.push(hcmCloudPageTrace({ artifact, sequence: pages.length, requestedPage: page,
        ...(expectedJobCount !== undefined ? { declaredTotal: expectedJobCount } : {}), termination: "FAILED" }));
      return hcmCloudFailure(capturedAt, "HCMCloud list response decode failed", artifacts, pages, counts, losses,
        hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    let list: unknown[];
    let returnedPage: number | undefined;
    try {
      const parsed = parseHcmCloudList(decoded.value, config.listPaginationPolicy, page);
      list = parsed.list;
      returnedPage = parsed.returnedPage;
      if (parsed.count !== undefined && expectedJobCount !== undefined && parsed.count !== expectedJobCount) {
        throw new Error("HCMCloud list official count changed");
      }
    } catch (error) {
      pages.push(hcmCloudPageTrace({ artifact, sequence: pages.length, requestedPage: page,
        ...(expectedJobCount !== undefined ? { declaredTotal: expectedJobCount } : {}), termination: "FAILED" }));
      return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud list shape is invalid"),
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    artifact.extractorLocator = pageRequestLocator(hcmCloudListLocator(countFilterHash, page, pageSize, decoded.algorithm,
      config.listPaginationPolicy === "LUNAN_REQUEST_BOUND_PAGE_V1" ? "request-bound:lunan-v1" :
        returnedPage !== undefined ? "$.result.page_index" : undefined));
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let recordIndex = 0; recordIndex < list.length; recordIndex += 1) {
      const raw = list[recordIndex];
      counts.rawCount += 1;
      const rawId = isStrictRecord(raw) ? stringValue(raw.id) ?? stringValue(raw.job_id) : undefined;
      rawIds.push(irreversibleOfficialJsonEvidenceId(rawId ?? [page, recordIndex, raw]));
      const locator = `${artifact.logicalKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId(raw)}`;
      if (!isStrictRecord(raw)) {
        recordHcmCloudLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", locator, page - 1, recordIndex);
        continue;
      }
      counts.parsedCount += 1;
      const officialId = stringValue(raw.id) ?? stringValue(raw.job_id);
      const detailId = stringValue(raw.job_id) ?? officialId;
      const title = stringValue(raw.name) ?? stringValue(raw.job_name) ?? stringValue(raw.job_title) ?? stringValue(raw.title);
      const rawLocation = hcmCloudLocationValue(raw.work_city) ?? hcmCloudLocationValue(raw.work_address) ??
        hcmCloudLocationValue(raw.job_address) ?? hcmCloudLocationValue(raw.work_place) ??
        hcmCloudLocationValue(raw.address) ?? hcmCloudLocationValue(raw.city);
      if (!officialId || !detailId || !title || !rawLocation) {
        recordHcmCloudLoss(losses, counts, "VALIDATION", rawLocation ? "MISSING_REQUIRED_FIELD" :
          config.defaultLocationRaw ? "DECLARED_LOCATION_FALLBACK" : "MISSING_REQUIRED_FIELD",
          locator, page - 1, recordIndex);
        continue;
      }
      if (!safeOfficialJsonId(officialId) || !safeOfficialJsonId(detailId)) {
        recordHcmCloudLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_ID", locator, page - 1, recordIndex);
        continue;
      }
      if (seenOfficialIds.has(officialId)) {
        recordHcmCloudLoss(losses, counts, "VALIDATION", "DUPLICATE_OFFICIAL_ID", locator, page - 1, recordIndex);
        continue;
      }
      if (seenDetailIds.has(detailId)) {
        recordHcmCloudLoss(losses, counts, "VALIDATION", "DUPLICATE_DETAIL_ID", locator, page - 1, recordIndex);
        continue;
      }
      const scope = cnstaffRecordScope(cnstaffCountryCoordinates(raw), rawLocation);
      if (scope !== "CHINA") {
        recordHcmCloudLoss(losses, counts, "VALIDATION", scope === "AMBIGUOUS" ? "AMBIGUOUS_SCOPE" : "OUT_OF_SCOPE",
          locator, page - 1, recordIndex);
        continue;
      }
      let officialUrl: string;
      try { officialUrl = hcmCloudDetailUrl(origin, config.detailPath, detailId); } catch {
        recordHcmCloudLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_URL", locator, page - 1, recordIndex);
        continue;
      }
      const sensitive = sensitiveOfficialJsonField({ title, locationRaw: rawLocation, officialUrl });
      if (sensitive) {
        recordHcmCloudLoss(losses, counts, "VALIDATION", "SENSITIVE_OUTPUT", locator, page - 1, recordIndex);
        continue;
      }
      seenOfficialIds.add(officialId); seenDetailIds.add(detailId);
      counts.validCount += 1;
      const persistentId = persistentOfficialJsonJobId(officialId);
      validIds.push(irreversibleOfficialJsonEvidenceId(officialId));
      jobs.push({ sourceJobId: persistentId, title, officialUrl, locationRaw: rawLocation,
        cities: citiesFromBeisenLocation([rawLocation]) });
    }
    cumulativeRaw += list.length;
    if (expectedJobCount !== undefined && cumulativeRaw > expectedJobCount) {
      pages.push(hcmCloudPageTrace({ artifact, sequence: pages.length, requestedPage: page,
        ...(returnedPage !== undefined ? { returnedPage } : {}), rawJobIds: rawIds, validJobIds: validIds,
        ...(expectedJobCount !== undefined ? { declaredTotal: expectedJobCount } : {}), termination: "FAILED" }));
      return hcmCloudFailure(capturedAt, "HCMCloud raw rows exceed official count", artifacts, pages, counts, losses,
        hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    const officialZeroCandidate = expectedJobCount === 0 && cumulativeRaw === 0 && list.length === 0 && page === 1;
    const officialZeroSafe = officialZeroCandidate && returnedPage === page;
    const reached = expectedJobCount !== undefined && expectedJobCount !== 0 &&
      cumulativeRaw === expectedJobCount &&
      counts.validCount === expectedJobCount;
    const canContinue = expectedJobCount !== undefined && cumulativeRaw < expectedJobCount && list.length > 0 &&
      returnedPage !== undefined;
    const maxed = page === maxPages && canContinue;
    const termination: SourceFetchPageTrace["termination"] = officialZeroSafe ? "EMPTY_PAGE" :
      reached ? "DECLARED_TOTAL_REACHED" :
      maxed ? "MAX_PAGE_LIMIT" : canContinue ? "CONTINUE" : "ABORTED";
    const next = canContinue ? `page:${page + 1}` : null;
    pages.push(hcmCloudPageTrace({ artifact, sequence: pages.length, requestedPage: page,
      requestedPageSize: pageSize,
      ...(returnedPage !== undefined ? { returnedPage } : {}), rawJobIds: rawIds, validJobIds: validIds,
      ...(expectedJobCount !== undefined ? { declaredTotal: expectedJobCount } : {}),
      nextPageSignalBefore: page > 1 ? `page:${page}` : null, nextPageSignalAfter: next, termination }));
    if (termination !== "CONTINUE") break;
  }
  const declared = hcmCloudDeclared(expectedJobCount, countArtifact);
  let finalized: ReturnType<typeof finalizeOfficialJsonEvidenceBundle>;
  try {
    finalized = finalizeOfficialJsonEvidenceBundle({ artifacts, pages, fetchCounts: counts, fetchLosses: losses,
      ...(declared ? { declaredCompleteness: declared } : {}) });
  } catch {
    return hcmCloudFailure(capturedAt, "HCMCloud pagination evidence validation failed",
      artifacts, pages, counts, losses, declared, "HCM_LIST_RESPONSE_FAILED");
  }
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(expectedJobCount !== undefined ? { expectedJobCount, completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const } :
        { completenessEvidenceKind: "WEAK_MANUAL_SAMPLE" as const }),
      completenessEvidenceUrl: entryEvidenceUrl,
      completenessBlockerReason: "HCMCloud direct fetch requires downstream adapter accounting and independent completeness review",
      pageSize,
      pagesVisited: pages.length
    },
    fetchEvidence: finalized.evidence,
    paginationEvaluation: finalized.evaluation
  };
}

interface HcmCloudDecoded {
  value: unknown;
  algorithm: "hb5-base64-v1";
}

function hcmCloudNondecreasingCapture(
  response: OfficialJsonHttpResponse,
  previousCapturedAtMs: number
): number {
  const current = Date.parse(response.capturedAt!);
  if (!Number.isFinite(current) || current < previousCapturedAtMs) {
    throw new Error("HCMCloud response capture time moved backwards");
  }
  return current;
}

function hcmCloudArtifact(input: {
  id: string;
  kind: "ATS_API_RESPONSE" | "PAGINATION_PAGE";
  requestedUrl: string;
  response: OfficialJsonHttpResponse;
  locator: string;
}): SourceFetchArtifactDraft {
  return officialJsonNetworkArtifact({
    id: input.id,
    logicalKey: input.id,
    kind: input.kind,
    requestedUrl: input.requestedUrl,
    response: input.response,
    extractorLocator: input.locator
  });
}

function emptyHcmCloudCounts(): PersistentSourceFetchEvidence["fetchCounts"] {
  return { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
}

function hcmCloudBrowserEntryFailure(
  capturedAt: string,
  artifact: SourceFetchArtifactDraft | undefined
): SourceFetchResult {
  if (artifact) {
    try {
      return hcmCloudFailure(capturedAt, "HCMCloud browser entry failed", [artifact], [],
        emptyHcmCloudCounts(), [], undefined, "HCM_BROWSER_ENTRY_FAILED");
    } catch {
      // A draft with incomplete network metadata must never become persistent evidence.
    }
  }
  return failed(capturedAt, "HCMCloud browser entry failed");
}

function assertHcmCloudBrowserSession(value: unknown): asserts value is HcmCloudBrowserSession {
  if (!isStrictRecord(value) || Object.keys(value).sort().join(",") !== "close,entryResponse,post" ||
    !isStrictRecord(value.entryResponse) || typeof value.post !== "function" || typeof value.close !== "function") {
    throw new Error("invalid HCMCloud browser session");
  }
}

function hcmCloudBrowserEntryArtifact(
  entryUrl: string,
  response: OfficialJsonHttpResponse
): SourceFetchArtifactDraft {
  return officialJsonNetworkArtifact({
    id: "browser-hcm-entry-0000",
    logicalKey: "browser-hcm-entry-0000",
    kind: "OFFICIAL_COMPANY_PAGE",
    requestedUrl: entryUrl,
    response,
    extractorLocator: "hcm-browser-entry-v1|document:official-company-page"
  });
}

function decodeHcmCloudResponseStrict(
  body: string,
  prefixPolicy?: "LUNAN_RANDOM_ALNUM3"
): HcmCloudDecoded {
  if (!hasUniqueJsonObjectKeys(body)) throw new Error("ambiguous HCMCloud envelope");
  const envelope: unknown = JSON.parse(body);
  const encodedParameter = isStrictRecord(envelope) && typeof envelope.hcm_param === "string"
    ? envelope.hcm_param
    : undefined;
  const prefix = encodedParameter?.slice(0, 3);
  const prefixValid = prefixPolicy === "LUNAN_RANDOM_ALNUM3"
    ? /^[A-Za-z0-9]{3}$/u.test(prefix ?? "")
    : prefix === "rsp";
  if (!isStrictRecord(envelope) || envelope.hcm_transfer_strategy !== "hb5" ||
    typeof envelope.hcm_param !== "string" || !prefixValid ||
    envelope.hcm_param.length <= 3) throw new Error("invalid HCMCloud envelope");
  const encoded = envelope.hcm_param.slice(3).replaceAll("a", "5").replaceAll("!", "a");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error("invalid HCMCloud base64");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new Error("noncanonical HCMCloud base64");
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!hasUniqueJsonObjectKeys(decoded)) throw new Error("ambiguous HCMCloud decoded JSON");
  return { value: JSON.parse(decoded), algorithm: "hb5-base64-v1" };
}

function selectHcmCloudCount(
  decoded: unknown,
  policy?: "LUNAN_AGGREGATE_ROW"
): { value?: number; path?: string } {
  if (!isStrictRecord(decoded)) throw new Error("HCMCloud count root must be an object");
  if (policy === "LUNAN_AGGREGATE_ROW") {
    if (hasOwn(decoded, "count") || !hasOwn(decoded, "result") || !isStrictRecord(decoded.result) ||
        Object.keys(decoded.result).sort().join(",") !== "count,list" ||
        !isNonnegativeInteger(decoded.result.count) || !Array.isArray(decoded.result.list) ||
        decoded.result.count !== decoded.result.list.length || decoded.result.list.length !== 1) {
      throw new Error("HCMCloud Lunan aggregate count envelope is invalid");
    }
    const aggregate = decoded.result.list[0];
    if (!isStrictRecord(aggregate) || Object.keys(aggregate).sort().join(",") !== "count__id,id" ||
        !isNonnegativeInteger(aggregate.count__id) || !isNonnegativeInteger(aggregate.id) ||
        aggregate.count__id !== aggregate.id) {
      throw new Error("HCMCloud Lunan aggregate count row is invalid");
    }
    return { value: aggregate.count__id, path: "$.result.list[0].count__id" };
  }
  const candidates: Array<{ value: unknown; path: string }> = [];
  if (hasOwn(decoded, "count")) candidates.push({ value: decoded.count, path: "$.count" });
  if (hasOwn(decoded, "result")) {
    if (!isStrictRecord(decoded.result)) throw new Error("HCMCloud count result must be an object");
    if (hasOwn(decoded.result, "count")) candidates.push({ value: decoded.result.count, path: "$.result.count" });
    if (hasOwn(decoded.result, "list")) {
      if (!Array.isArray(decoded.result.list)) throw new Error("HCMCloud count result.list must be an array");
      for (let index = 0; index < decoded.result.list.length; index += 1) {
        const row = decoded.result.list[index];
        if (!isStrictRecord(row)) continue;
        if (hasOwn(row, "count__id")) candidates.push({ value: row.count__id, path: `$.result.list[${index}].count__id` });
        if (hasOwn(row, "id")) candidates.push({ value: row.id, path: `$.result.list[${index}].id` });
      }
    }
  }
  if (candidates.length === 0) return {};
  if (candidates.length !== 1) throw new Error("HCMCloud count paths are ambiguous");
  const selected = candidates[0]!;
  if (!isNonnegativeInteger(selected.value)) throw new Error("HCMCloud count must be a nonnegative integer");
  return { value: selected.value, path: selected.path };
}

function parseHcmCloudList(
  decoded: unknown,
  policy?: "LUNAN_REQUEST_BOUND_PAGE_V1",
  requestedPage?: number
): { list: unknown[]; returnedPage?: number; count?: number } {
  if (!isStrictRecord(decoded) || !hasOwn(decoded, "result") || !isStrictRecord(decoded.result) ||
    !hasOwn(decoded.result, "list") || !Array.isArray(decoded.result.list)) {
    throw new Error("HCMCloud list collection is invalid");
  }
  if (policy === "LUNAN_REQUEST_BOUND_PAGE_V1") {
    if (!isNonnegativeInteger(requestedPage) || requestedPage === 0 ||
        Object.keys(decoded).sort().join(",") !== "result,srv_all,srv_begin,srv_end" ||
        Object.keys(decoded.result).sort().join(",") !== "count,list" || decoded.result.count !== 0 ||
        !isNonnegativeInteger(decoded.srv_begin) || !isNonnegativeInteger(decoded.srv_end) ||
        !isNonnegativeInteger(decoded.srv_all) || decoded.srv_begin > decoded.srv_end ||
        decoded.srv_end > decoded.srv_all) {
      throw new Error("HCMCloud Lunan request-bound list envelope is invalid");
    }
    return { list: decoded.result.list, returnedPage: requestedPage };
  }
  let returnedPage: number | undefined;
  if (hasOwn(decoded.result, "page_index")) {
    if (!isNonnegativeInteger(decoded.result.page_index)) throw new Error("HCMCloud returned page is invalid");
    returnedPage = decoded.result.page_index;
  }
  const countCandidates: unknown[] = [];
  if (hasOwn(decoded, "count")) countCandidates.push(decoded.count);
  if (hasOwn(decoded.result, "count")) countCandidates.push(decoded.result.count);
  if (countCandidates.length > 1) throw new Error("HCMCloud list count paths are ambiguous");
  let count: number | undefined;
  if (countCandidates.length === 1) {
    if (!isNonnegativeInteger(countCandidates[0])) throw new Error("HCMCloud list count is invalid");
    count = countCandidates[0];
  }
  return { list: decoded.result.list, ...(returnedPage !== undefined ? { returnedPage } : {}),
    ...(count !== undefined ? { count } : {}) };
}

function hcmCloudSemanticFilterTuple(payload: Record<string, unknown>): Record<string, unknown> {
  const filter = isStrictRecord(payload.filter_dict) ? payload.filter_dict : {};
  const extra = isStrictRecord(payload.extra_property) ? payload.extra_property : {};
  const params = isStrictRecord(extra.filter_params) ? extra.filter_params : {};
  return {
    model: payload.model ?? null,
    jobClass: filter.job_class ?? null,
    status: filter.status ?? null,
    delivery: filter.delivery ?? null,
    contractUnit: filter.contract_unit ?? null,
    portalState: extra.state ?? null,
    recruitType: params.job_class ?? null
  };
}

function hcmCloudTupleHash(tuple: Record<string, unknown>): string {
  return sha256Bytes(Buffer.from(JSON.stringify(tuple), "utf8")).sha256;
}

function hcmCloudCountLocator(filterHash: string, algorithm = "hb5-base64-v1", path?: string): string {
  return `hcm-count-v1|decode:${algorithm}|filter-fields:model,job_class,status,delivery,contract_unit,state,recruit_type` +
    `|filter-sha256:${filterHash}|path:${path ?? "unselected"}`;
}

function hcmCloudListLocator(
  filterHash: string,
  page: number,
  pageSize: number,
  algorithm = "hb5-base64-v1",
  returnedPageEvidence?: "$.result.page_index" | "request-bound:lunan-v1"
): string {
  return `hcm-list-v1|decode:${algorithm}|filter-fields:model,job_class,status,delivery,contract_unit,state,recruit_type` +
    `|filter-sha256:${filterHash}|request-page:${page}|page-size:${pageSize}` +
    `|records:$.result.list${returnedPageEvidence ? `|returned-page:${returnedPageEvidence}` : ""}`;
}

function hcmCloudPageTrace(input: {
  artifact: SourceFetchArtifactDraft;
  sequence: number;
  requestedPage: number;
  requestedPageSize?: number | null;
  returnedPage?: number;
  rawJobIds?: string[];
  validJobIds?: string[];
  declaredTotal?: number;
  nextPageSignalBefore?: string | null;
  nextPageSignalAfter?: string | null;
  termination: SourceFetchPageTrace["termination"];
}): SourceFetchPageTrace {
  return {
    sequence: input.sequence, artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null, returnedCursor: null, requestedOffset: null, returnedOffset: null,
    requestedPage: input.requestedPage, returnedPage: input.returnedPage ?? null,
    requestedPageSize: input.requestedPageSize ?? null, returnedPageSize: null,
    rawJobIds: [...new Set(input.rawJobIds ?? [])], validJobIds: [...new Set(input.validJobIds ?? [])],
    declaredTotal: input.declaredTotal ?? null, declaredCount: null, declaredPages: null,
    nextPageSignalBefore: input.nextPageSignalBefore ?? null,
    nextPageSignalAfter: input.nextPageSignalAfter ?? null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
    termination: input.termination, anomalyCodes: [], capturedAt: input.artifact.capturedAt
  };
}

function hcmCloudDeclared(
  count: number | undefined,
  artifact: SourceFetchArtifactDraft | undefined
): PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  return count !== undefined && artifact ? {
    kind: "OFFICIAL_TOTAL_COUNT", value: count, artifactLogicalKey: artifact.logicalKey,
    extractorLocator: artifact.extractorLocator, scope: "SOURCE"
  } : undefined;
}

function hcmCloudFailure(
  capturedAt: string,
  reason: string,
  artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[],
  counts: PersistentSourceFetchEvidence["fetchCounts"],
  losses: PersistentSourceFetchEvidence["fetchLosses"],
  declared?: PersistentSourceFetchEvidence["declaredCompleteness"],
  supportingCode: "HCM_COUNT_RESPONSE_FAILED" | "HCM_LIST_RESPONSE_FAILED" | "HCM_BROWSER_ENTRY_FAILED" = "HCM_COUNT_RESPONSE_FAILED",
  transportFailure?: SourceTransportFailure
): SourceFetchResult {
  if (artifacts.length === 0) {
    const result = failed(capturedAt, reason);
    return transportFailure ? { ...result, transportFailure } : result;
  }
  if (pages.length === 0) {
    const result = failedWithEvidence(capturedAt, reason, finalizeOfficialJsonSupportingFailureEvidence({
      artifacts,
      code: supportingCode
    }));
    return transportFailure ? { ...result, transportFailure } : result;
  }
  const evidencePages = pages.length > 0 ? pages.map((page, index) =>
    index === pages.length - 1 && page.termination === "CONTINUE" ? { ...page, termination: "ABORTED" as const } : page
  ) : [];
  const result = failedWithEvidence(capturedAt, reason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts, pages: evidencePages, fetchCounts: counts, fetchLosses: losses,
    ...(declared ? { declaredCompleteness: declared } : {})
  }));
  return transportFailure ? { ...result, transportFailure } : result;
}

function recordHcmCloudLoss(
  losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"],
  stage: "PARSE" | "VALIDATION",
  code: "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "DECLARED_LOCATION_FALLBACK" |
    "UNSAFE_OFFICIAL_ID" | "DUPLICATE_OFFICIAL_ID" | "DUPLICATE_DETAIL_ID" |
    "OUT_OF_SCOPE" | "AMBIGUOUS_SCOPE" | "UNSAFE_OFFICIAL_URL" | "SENSITIVE_OUTPUT",
  rawLocator: string,
  pageSequence: number,
  recordIndex: number
): void {
  if (stage === "PARSE") counts.parseDiscardCount += 1; else counts.validationDiscardCount += 1;
  losses.push({ stage, reason: `HCMCloud record rejected: ${code}`, rawLocator,
    details: { code, pageSequence, recordIndex } });
}

function hcmCloudDetailUrl(origin: string, detailPath: string | undefined, detailId: string): string {
  const raw = detailPath ?? "/recruit/#/portal_job_detail";
  if (sensitiveOfficialJsonField({ detailPath: raw }) || raw.includes("..")) throw new Error("unsafe detail path");
  const [pathnameRaw = "", fragmentRaw = ""] = raw.split("#", 2);
  const pathname = pathnameRaw.startsWith("/") ? pathnameRaw : `/${pathnameRaw}`;
  if (!/^\/[A-Za-z0-9_/-]*$/u.test(pathname) || !/^\/?[A-Za-z0-9_/-]*$/u.test(fragmentRaw)) {
    throw new Error("unsafe detail path");
  }
  const url = new URL(pathname, origin);
  if (url.origin !== origin || url.pathname !== pathname) throw new Error("unsafe detail origin");
  const fragmentPath = fragmentRaw || "/portal_job_detail";
  url.hash = `${fragmentPath}?id=${encodeURIComponent(detailId)}`;
  const result = url.toString();
  if (sensitiveOfficialJsonField({ officialUrl: result })) throw new Error("unsafe detail URL");
  return result;
}

export async function defaultHcmCloudBrowserFetch({
  entryUrl,
  signal
}: HcmCloudBrowserFetchInput): Promise<HcmCloudBrowserSession> {
  if (signal?.aborted) throw signal.reason;
  const releaseBrowserPermit = await acquireBrowserSourcePermit(signal);
  let permitTransferredToSession = false;
  try {
  const { chromium } = await import("playwright-core");
  const { FORMAL_CHROMIUM_ARGS, FORMAL_CHROMIUM_PATH } = await import("../readiness/formalBrowserPreflight");
  const browserTimeoutMs = officialBrowserTimeoutMs();
  if (signal?.aborted) throw signal.reason;
  const browser = await chromium.launch({
    ...(process.platform === "linux" ? { executablePath: FORMAL_CHROMIUM_PATH, args:[...FORMAL_CHROMIUM_ARGS] } : { channel: "chrome" }),
    headless: true,
    timeout: browserTimeoutMs
  });
  const browserLifecycle = createAbortableClose(signal, () => browser.close());
  if (signal?.aborted) {
    try { await browserLifecycle.close(); } catch { /* the source timeout remains authoritative */ }
    browserLifecycle.dispose();
    throw signal.reason;
  }
  try {
    const page = await browser.newPage();
    const navigation = await page.goto(entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: browserTimeoutMs
    });
    if (!navigation) throw new Error("missing browser navigation response");
    const entryBody = await navigation.text();
    const entryResponse: OfficialJsonHttpResponse = {
      status: navigation.status(),
      body: entryBody,
      finalUrl: navigation.url(),
      ...(navigation.headers()["content-type"] ? { contentType: navigation.headers()["content-type"] } : {}),
      capturedAt: new Date().toISOString()
    };
    await page.waitForTimeout(hcmCloudBrowserSettleMs());
    const session: HcmCloudBrowserSession = {
      entryResponse,
      post: async (endpoint, body) => {
        const path = endpoint === "count"
          ? "/api/hcm.model.count?model=ReleaseJobMgr"
          : "/api/hcm.model.list?model=ReleaseJobMgr";
        return page.evaluate(
          async ({ path: requestPath, requestBody, timeoutMs }:
            { path: string; requestBody: string; timeoutMs: number }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const response = await fetch(requestPath, {
                method: "POST",
                headers: { Accept: "application/json, text/plain, */*",
                  "Content-Type": "application/json;charset=UTF-8" },
                body: requestBody,
                signal: controller.signal
              });
              const responseBody = await response.text();
              const contentType = response.headers.get("content-type");
              return { status: response.status, body: responseBody, finalUrl: response.url,
                ...(contentType ? { contentType } : {}), capturedAt: new Date().toISOString() };
            } finally {
              clearTimeout(timer);
            }
          },
          { path, requestBody: body, timeoutMs: officialHttpTimeoutMs() }
        );
      },
      close: async () => {
        browserLifecycle.dispose();
        try { await browserLifecycle.close(); } finally { releaseBrowserPermit(); }
      }
    };
    permitTransferredToSession = true;
    return session;
  } catch (error) {
    browserLifecycle.dispose();
    try { await browserLifecycle.close(); } catch { /* cleanup must not replace the crawl failure */ }
    throw error;
  }
  } finally {
    if (!permitTransferredToSession) releaseBrowserPermit();
  }
}

function hcmCloudHeaders(entryUrl: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Referer: entryUrl,
    "User-Agent": "job-search-crawler/0.1"
  };
}

function encodeHcmCloudRequest(payload: unknown): string {
  return JSON.stringify({
    hcm_transfer_strategy: "hb4",
    hcm_param: `jsc${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}`
  });
}

function decodeHcmCloudResponse(body: string): unknown {
  const parsed = JSON.parse(body) as { hcm_param?: unknown };
  const strategy = stringValue((parsed as { hcm_transfer_strategy?: unknown }).hcm_transfer_strategy);
  const encoded = stringValue(parsed.hcm_param);
  if (!encoded || encoded.length <= 3) {
    throw new Error("HCMCloud response did not include hcm_param");
  }

  const payload =
    strategy === "hb5"
      ? encoded.slice(3).replaceAll("a", "5").replaceAll("!", "a")
      : encoded.slice(3);

  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

function hcmCloudListPayload(
  config: Extract<OfficialJsonFetchConfig, { kind: "hcm-cloud" }>,
  pageIndex: number,
  pageSize: number
): Record<string, unknown> {
  const jobClass = config.jobClass ?? "社会招聘";
  const recruitType = config.recruitType ?? "social";
  return {
    model: "ReleaseJobMgr",
    filter_str: null,
    filter_dict: {
      job_class: jobClass,
      status: "1",
      delivery: 1,
      contract_unit: null
    },
    page_index: pageIndex,
    page_size: pageSize,
    extra_property: {
      state: config.portalState ?? "portal_social",
      sorts: [
        { type: "desc", key: "is_top" },
        { key: "release_date", type: "desc" },
        { type: "desc", key: "id" }
      ],
      filter_params: {
        job_class: recruitType,
        filter_dict: { select_depart: null },
        page_index: pageIndex,
        page_size: pageSize,
        filter_str: null,
        show_fields_key: []
      },
      only_list: true
    },
    biz_type: "list"
  };
}

function hcmCloudCountPayload(
  config: Extract<OfficialJsonFetchConfig, { kind: "hcm-cloud" }>
): Record<string, unknown> {
  const payload = hcmCloudListPayload(config, 1, 20);
  const extraProperty: Record<string, unknown> = isObject(payload.extra_property)
    ? { ...payload.extra_property }
    : {};
  delete extraProperty.only_list;

  return {
    ...payload,
    page_index: null,
    page_size: null,
    extra_property: extraProperty,
    count_by: ["id"],
    sum_by: [],
    group_by: null,
    avg_by: [],
    min_by: [],
    max_by: []
  };
}

function readHcmCloudExpectedCount(decoded: unknown): number | undefined {
  const result = isObject(decoded) && isObject(decoded.result) ? decoded.result : undefined;
  const rows = Array.isArray(result?.list) ? result.list : [];
  const firstRow = rows.find(isObject);
  return numberValue(firstRow?.count__id) ?? numberValue(firstRow?.id) ?? numberValue(result?.count);
}

function readHcmCloudJobs(decoded: unknown): unknown[] {
  const result = isObject(decoded) && isObject(decoded.result) ? decoded.result : undefined;
  return Array.isArray(result?.list) ? result.list : [];
}

const SANDOZ_JSONAPI_FIELDS = [
  "title", "field_job_title", "field_job_employment_type", "field_job_type", "field_job_id",
  "field_job_business_unit", "field_job_work_location", "field_job_posted_date", "path",
  "drupal_internal__tid", "field_date", "field_job_country", "field_job_alt_country_1",
  "field_job_alt_country_2", "field_job_alt_country_3"
].join(",");

type SandozProbe = "primary" | "alt1" | "alt2" | "alt3";

interface SandozPageEnvelope {
  data: unknown[];
  count: number;
  pageSize: number;
  next: string | null;
}

type SandozEnvelopeErrorCode = "SCHEMA" | "COUNT" | "PAGE_SIZE" | "SELF" | "NEXT";

class SandozEnvelopeError extends Error {
  constructor(readonly code: SandozEnvelopeErrorCode) {
    super(code);
    this.name = "SandozEnvelopeError";
  }
}

function sandozProbeUrl(
  endpoint: URL,
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>,
  probe: SandozProbe,
  page: number
): string {
  const url = new URL(endpoint.toString());
  url.searchParams.set("fields[node--jobs]", SANDOZ_JSONAPI_FIELDS);
  url.searchParams.set("page", String(page));
  url.searchParams.set("views-filter[field_job_functional_area]", "All");
  url.searchParams.set("views-filter[field_job_posted_date][min]", "");
  url.searchParams.set("views-filter[field_job_posted_date][max]", "");
  if (probe === "primary") {
    url.searchParams.set("views-filter[field_job_country]", String(config.countryTermTargetId));
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
  } else if (probe === "alt1") {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", String(config.countryTermTargetId));
  } else if (probe === "alt2") {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
    url.searchParams.set("views-filter[field_job_alt_country_2]", String(config.countryTermTargetId));
  } else {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
    url.searchParams.set("views-filter[field_job_alt_country_3]", String(config.countryTermTargetId));
  }
  return url.toString();
}

function sandozEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "sandoz-com.cms.sandoz.com" || url.port ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== "/jsonapi/views/job_search/job_search") throw new Error("invalid Sandoz endpoint");
  return url;
}

function sandozTaxonomyEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "sandoz-com.cms.sandoz.com" || url.port ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== "/jsonapi/taxonomy_term/job_location") {
    throw new Error("invalid Sandoz taxonomy endpoint");
  }
  return url;
}

function sandozTaxonomyUrl(endpoint: URL, targetId: number): string {
  const url = new URL(endpoint.toString());
  url.searchParams.set("filter[drupal_internal__tid]", String(targetId));
  return url.toString();
}

function sandozTaxonomyLocator(config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>): string {
  return `sandoz-taxonomy-v1|target:${config.countryTermTargetId}|json:$.data[0].type,$.data[0].id,` +
    `$.data[0].attributes.drupal_internal__tid,$.data[0].attributes.name`;
}

function validateSandozTaxonomy(
  body: string,
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>
): boolean {
  let root: unknown;
  try { root = JSON.parse(body); } catch { return false; }
  if (!hasUniqueJsonObjectKeys(body) || !isStrictRecord(root) || !Array.isArray(root.data) || root.data.length !== 1) {
    return false;
  }
  const term = root.data[0];
  return isStrictRecord(term) && term.type === "taxonomy_term--job_location" &&
    term.id === config.countryTermUuid && isStrictRecord(term.attributes) &&
    term.attributes.drupal_internal__tid === config.countryTermTargetId &&
    term.attributes.name === config.countryTermName;
}

function sandozDetailBase(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.sandoz.com" || url.port || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") throw new Error("invalid Sandoz detail base");
  return url;
}

function extractSandozBearerToken(body: string): string {
  const matches = [...body.matchAll(/"token"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gu)];
  if (matches.length !== 1) throw new Error("Sandoz token discovery is ambiguous");
  let token: unknown;
  try { token = JSON.parse(`"${matches[0]![1]}"`); } catch { throw new Error("Sandoz token discovery is invalid"); }
  if (typeof token !== "string" || token.length < 8 || token.length > 4096 ||
      !/^[A-Za-z0-9._~+\/-]+={0,2}$/u.test(token)) {
    throw new Error("Sandoz token discovery is invalid");
  }
  return token;
}

function redactSandozSensitiveBody(body: string, setCookie?: string[]): {
  body: string; redacted: boolean; count: number;
} {
  const candidates = [body, ...(setCookie ?? [])];
  let count = 0;
  for (const candidate of candidates) {
    let decoded = candidate.normalize("NFKC");
    for (let layer = 0; layer < 2; layer += 1) {
      try {
        const next = decodeURIComponent(decoded).normalize("NFKC");
        if (next === decoded) break;
        decoded = next;
      } catch { break; }
    }
    count += sandozStructuredCredentialCount(decoded);
    count += decoded.match(/(?:["']?\b(?:authorization|cookie|set-cookie|header|token|secret|password|session|jwt)\b["']?\s*(?::|=)\s*(?:["'][^"']+["']|[^\s<>{},;]+))/giu)?.length ?? 0;
    count += decoded.match(/\bname\s*=\s*["'](?:authorization|cookie|set-cookie|header|token|secret|password|session|jwt)["'][^>]*\bcontent\s*=\s*["'][^"']+["']/giu)?.length ?? 0;
    for (const match of decoded.matchAll(/\b(?:bearer|basic)\s*(?:\s|:|=)\s*([A-Za-z0-9._~+\/-]{8,}={0,2})/giu)) {
      const credential = match[1]!;
      if (/[^A-Za-z]/u.test(credential)) count += 1;
    }
    count += decoded.match(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/gu)?.length ?? 0;
  }
  if (count === 0) return { body, redacted: false, count: 0 };
  return { body: "[REDACTED_CREDENTIAL_MATERIAL]", redacted: true, count };
}

const SANDOZ_CREDENTIAL_KEYS = new Set([
  "auth", "authorization", "basic", "bearer", "token", "accesstoken", "refreshtoken",
  "cookie", "setcookie", "secret", "password", "session", "jwt", "header"
]);

function sandozStructuredCredentialCount(value: string): number {
  try { return sandozJsonCredentialCount(JSON.parse(value), ""); } catch { /* not standalone JSON */ }
  try {
    const $ = loadHtml(value); let count = 0;
    $("*").each((_index, element) => {
      if (!("attribs" in element) || !("tagName" in element)) return;
      const attrs = Object.fromEntries(Object.entries(element.attribs ?? {}).map(([key, item]) => [key.normalize("NFKC").toLowerCase(), item]));
      for (const [key, item] of Object.entries(attrs)) {
        const normalizedValue = item.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/gu, "");
        if (SANDOZ_CREDENTIAL_KEYS.has(key.replace(/[^a-z0-9]/gu, "")) && item.trim()) count += 1;
        if (SANDOZ_CREDENTIAL_KEYS.has(normalizedValue) && Object.entries(attrs).some(([otherKey, otherValue]) =>
          otherKey !== key && /^(?:content|value|data-value)$/u.test(otherKey) && otherValue.trim())) count += 1;
      }
      if (element.tagName === "script" && sandozAuthSchemeValue($(element).text())) count += 1;
    });
    return count;
  } catch { return 0; }
}

function sandozJsonCredentialCount(value: unknown, parentKey: string): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sandozJsonCredentialCount(item, parentKey), 0);
  if (isStrictRecord(value)) return Object.entries(value).reduce((sum, [key, item]) => {
    const normalizedKey = key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/gu, "");
    return sum + (SANDOZ_CREDENTIAL_KEYS.has(normalizedKey) ? 1 : 0) + sandozJsonCredentialCount(item, normalizedKey);
  }, 0);
  return typeof value === "string" && !/(?:title|name)$/u.test(parentKey) && sandozAuthSchemeValue(value) ? 1 : 0;
}

function sandozAuthSchemeValue(value: string): boolean {
  return /\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/iu.test(value);
}

function parseSandozPageEnvelope(
  body: string,
  requestedUrl: string,
  endpoint: URL,
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>,
  probe: SandozProbe,
  page: number
): SandozPageEnvelope {
  let root: unknown;
  try { root = JSON.parse(body); } catch { throw new SandozEnvelopeError("SCHEMA"); }
  if (!hasUniqueJsonObjectKeys(body) || !isStrictRecord(root) || !Array.isArray(root.data) ||
      !isStrictRecord(root.meta) || !isStrictRecord(root.links)) {
    throw new SandozEnvelopeError("SCHEMA");
  }
  if (!hasOwn(root.meta, "count") || !isNonnegativeInteger(root.meta.count)) {
    throw new SandozEnvelopeError("COUNT");
  }
  if (root.number_of_items_per_page !== config.pageSize || root.number_of_items_per_page !== 10) {
    throw new SandozEnvelopeError("PAGE_SIZE");
  }
  const self = root.links.self;
  if (!isStrictRecord(self) || Object.keys(self).length !== 1 || self.href !== requestedUrl) {
    throw new SandozEnvelopeError("SELF");
  }
  const rawNext = hasOwn(root.links, "next") ? root.links.next : undefined;
  let next: string | null = null;
  if (rawNext !== undefined && rawNext !== null) {
    if (!isStrictRecord(rawNext) || Object.keys(rawNext).length !== 1 || typeof rawNext.href !== "string" ||
        rawNext.href !== sandozProbeUrl(endpoint, config, probe, page + 1)) {
      throw new SandozEnvelopeError("NEXT");
    }
    next = `page:${page + 1}`;
  }
  return { data: root.data, count: root.meta.count, pageSize: root.number_of_items_per_page, next };
}

function sandozEnvelopeFailureReason(error: unknown, alternate: boolean): string {
  if (error instanceof SandozEnvelopeError) {
    if (error.code === "SELF") return alternate
      ? "Sandoz alternate-country probe scope is invalid"
      : "Sandoz JSONAPI self scope is invalid";
    if (error.code === "NEXT") return "Sandoz JSONAPI next-page declaration is invalid";
    if (error.code === "COUNT") return "Sandoz JSONAPI count declaration is invalid";
    if (error.code === "PAGE_SIZE") return "Sandoz JSONAPI page-size declaration is invalid";
  }
  return alternate ? "Sandoz alternate-country probe schema is invalid" : "Sandoz JSONAPI response schema is invalid";
}

type SandozLossCode = "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "UNSAFE_OFFICIAL_ID" |
  "UNSAFE_OFFICIAL_URL" | "OUT_OF_SCOPE" | "AMBIGUOUS_SCOPE" | "DUPLICATE_OFFICIAL_ID" |
  "CONFLICTING_OFFICIAL_ID" | "SENSITIVE_OUTPUT" | "INVALID_JSONAPI_RESOURCE" |
  "CAMPUS_BOUNDARY_DRIFT";

function isExactSandozChinaCityPolicy(input: {
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>;
  entryUrl: string;
  sourceIdentity: { id: string; companyId: string };
}): boolean {
  const { config, entryUrl, sourceIdentity } = input;
  return config.cityScopePolicy === "SANDOZ_CHINA_TAXONOMY_LOCATION_V1" &&
    sourceIdentity.id === "source-sandoz-china-social" &&
    sourceIdentity.companyId === "company-sandoz-china" &&
    entryUrl === "https://www.sandoz.com/careers/job-search/" &&
    config.endpointUrl === "https://sandoz-com.cms.sandoz.com/jsonapi/views/job_search/job_search" &&
    config.taxonomyEndpointUrl === "https://sandoz-com.cms.sandoz.com/jsonapi/taxonomy_term/job_location" &&
    config.countryTermName === "LOC_CN" && config.countryTermTargetId === 806 &&
    config.countryTermUuid === "2f829192-01a9-4909-b729-baab0b0bad0c" &&
    config.pageSize === 10 && config.maxPages === 50 && config.detailBaseUrl === "https://www.sandoz.com";
}

function sandozChinaLocationFallback(locationRaw: string): string[] {
  const candidate = locationRaw.normalize("NFKC")
    .split(/[,，;；、/|()（）\r\n]+/u)
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0 &&
      !/^(?:sandoz|china|china mainland|mainland china|中国|中国大陆|中华人民共和国)$/iu.test(segment));
  if (!candidate || /^(?:remote|multiple locations?|various locations?|未披露|未知)$/iu.test(candidate)) return [];
  return citiesWithFallback(locationRaw, candidate);
}

function parseSandozResource(
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>, detailBase: URL,
  raw: Record<string, unknown>,
  usesChinaCityPolicy = false
): { ok: true; officialId: string; resourceId: string; job: NormalizedOfficialJsonJob } |
  { ok: false; code: SandozLossCode; field?: string } {
  const id = stringValue(raw.id);
  const type = stringValue(raw.type);
  if (!id || !safeOfficialJsonId(id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    return { ok: false, code: id ? "UNSAFE_OFFICIAL_ID" : "MISSING_REQUIRED_FIELD", field: "id" };
  }
  if (!type || type !== "node--jobs" || !isStrictRecord(raw.attributes) || !isStrictRecord(raw.relationships)) {
    return { ok: false, code: "INVALID_JSONAPI_RESOURCE" };
  }
  const attributes = raw.attributes;
  const sourceJobId = typeof attributes.field_job_id === "string" && attributes.field_job_id.trim()
    ? attributes.field_job_id.trim() : undefined;
  const title = typeof attributes.field_job_title === "string" && attributes.field_job_title.trim()
    ? attributes.field_job_title.trim() : undefined;
  const locationRaw = typeof attributes.field_job_work_location === "string" && attributes.field_job_work_location.trim()
    ? attributes.field_job_work_location.trim() : undefined;
  const path = isStrictRecord(attributes.path) ? stringValue(attributes.path.alias) : undefined;
  if (!sourceJobId || !title || !locationRaw || !path) return { ok: false, code: "MISSING_REQUIRED_FIELD" };
  if (!safeOfficialJsonId(sourceJobId)) return { ok: false, code: "UNSAFE_OFFICIAL_ID", field: "field_job_id" };
  if (sandozCampusBoundaryDrift(attributes, title)) {
    return { ok: false, code: "CAMPUS_BOUNDARY_DRIFT" };
  }
  const scope = sandozCountryScope(raw.relationships, config);
  if (scope !== "CHINA") return { ok: false, code: scope === "OUTSIDE" ? "OUT_OF_SCOPE" : "AMBIGUOUS_SCOPE" };
  if (usesChinaCityPolicy && explicitlyForeignOrNonMainlandLocation(locationRaw)) {
    return { ok: false, code: "OUT_OF_SCOPE", field: "field_job_work_location" };
  }
  let officialUrl: string;
  try {
    if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/u.test(path) || path.startsWith("//") || path.includes("//") ||
        path.includes("..") || /%(?:2e|2f|5c)/iu.test(path)) throw new Error("unsafe path");
    const canonicalPath = path.endsWith("/") ? path : `${path}/`;
    const url = new URL(canonicalPath, detailBase);
    if (url.origin !== detailBase.origin || url.username || url.password || url.search || url.hash ||
        url.pathname !== canonicalPath) throw new Error("unsafe path");
    officialUrl = url.toString();
  } catch { return { ok: false, code: "UNSAFE_OFFICIAL_URL", field: "path.alias" }; }
  const mappedCities = citiesFromLocation(locationRaw);
  const cities = mappedCities.length > 0 || !usesChinaCityPolicy
    ? mappedCities
    : sandozChinaLocationFallback(locationRaw);
  if (usesChinaCityPolicy && cities.length === 0) {
    return { ok: false, code: "AMBIGUOUS_SCOPE", field: "field_job_work_location" };
  }
  const job = { sourceJobId, title, officialUrl, locationRaw, cities };
  if (sensitiveOfficialJsonField({ sourceJobId, title, officialUrl, locationRaw })) {
    return { ok: false, code: "SENSITIVE_OUTPUT" };
  }
  return { ok: true, officialId: sourceJobId, resourceId: id, job };
}

function sandozCountryScope(
  relationships: Record<string, unknown>,
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>
): "CHINA" | "OUTSIDE" | "AMBIGUOUS" {
  if (!isStrictRecord(relationships.field_job_country) ||
      !Array.isArray(relationships.field_job_country.data) || relationships.field_job_country.data.length !== 1) {
    return "AMBIGUOUS";
  }
  const term = relationships.field_job_country.data[0];
  if (!isStrictRecord(term) || term.type !== "taxonomy_term--job_location" || term.id !== config.countryTermUuid ||
      !isStrictRecord(term.meta) || term.meta.drupal_internal__target_id !== config.countryTermTargetId ||
      term.meta.term_name !== config.countryTermName) {
    return "OUTSIDE";
  }
  for (const name of ["field_job_alt_country_1", "field_job_alt_country_2", "field_job_alt_country_3"] as const) {
    if (!hasOwn(relationships, name)) continue;
    const relationship = relationships[name];
    if (!isStrictRecord(relationship) || !(relationship.data === null ||
        (Array.isArray(relationship.data) && relationship.data.length === 0))) return "AMBIGUOUS";
  }
  return "CHINA";
}

function sandozCampusBoundaryDrift(attributes: Record<string, unknown>, title: string): boolean {
  const values = [title, attributes.field_job_employment_type, attributes.field_job_type]
    .filter((value): value is string => typeof value === "string");
  return values.some((value) => /(?:\b(?:intern(?:ship)?|apprentice|trainee|graduate\s+program|student)\b|实习|校招|应届|管培生)/iu
    .test(value.normalize("NFKC")));
}

interface ParsedXiuzhengPage {
  currentPage?: number;
  lastPage?: number;
  total?: number;
  perPage?: number;
  rawJobs: unknown[];
}

function parseXiuzhengJobListResponse(body: string):
  | ({ ok: true } & ParsedXiuzhengPage)
  | { ok: false; failureReason: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { ok: false, failureReason: "Xiuzheng job-list response is not valid JSON" }; }
  if (!hasUniqueJsonObjectKeys(body) || !isStrictRecord(parsed) || !hasOwn(parsed, "code") || parsed.code !== 0 ||
      !isStrictRecord(parsed.data) || !hasOwn(parsed.data, "data") || !Array.isArray(parsed.data.data)) {
    return { ok: false, failureReason: "Xiuzheng job-list response schema is invalid" };
  }
  const integerFields = [["current_page", "currentPage"], ["last_page", "lastPage"], ["total", "total"], ["per_page", "perPage"]] as const;
  const result: ParsedXiuzhengPage = { rawJobs: parsed.data.data };
  for (const [rawKey, resultKey] of integerFields) {
    if (!hasOwn(parsed.data, rawKey)) continue;
    const value = parsed.data[rawKey];
    if (!isNonnegativeInteger(value) || ((rawKey === "current_page" || rawKey === "last_page" || rawKey === "per_page") && value === 0)) {
      return { ok: false, failureReason: "Xiuzheng job-list response schema is invalid" };
    }
    result[resultKey] = value;
  }
  return { ok: true, ...result };
}

type XiuzhengLossCode = "NON_OBJECT_RECORD" | "NON_RECRUITMENT_CONTENT" | "MISSING_REQUIRED_FIELD" |
  "UNSAFE_OFFICIAL_ID" | "UNSAFE_OFFICIAL_URL" | "SENSITIVE_OUTPUT" | "AMBIGUOUS_SCOPE" |
  "OUT_OF_SCOPE" | "DUPLICATE_OFFICIAL_ID" | "CONFLICTING_OFFICIAL_ID";

function normalizeXiuzhengJob(
  config: Extract<OfficialJsonFetchConfig, { kind: "xiuzheng-job-list" }>,
  job: Record<string, unknown>
): { ok: true; sourceJobId: string; job: NormalizedOfficialJsonJob } | { ok: false; code: XiuzhengLossCode; field?: string } {
  const sourceJobId = xiuzhengOfficialId(job.id);
  const title = xiuzhengText(job.name);
  if (!sourceJobId) return { ok: false, code: hasOwn(job, "id") ? "UNSAFE_OFFICIAL_ID" : "MISSING_REQUIRED_FIELD", field: "id" };
  if (!safeOfficialJsonId(sourceJobId)) return { ok: false, code: "UNSAFE_OFFICIAL_ID", field: "id" };
  if (!title) return { ok: false, code: "MISSING_REQUIRED_FIELD", field: "name" };
  if (title === "用人理念") return { ok: false, code: "NON_RECRUITMENT_CONTENT", field: "name" };
  if (sensitiveOfficialJsonField({ id: sourceJobId, name: title })) return { ok: false, code: "SENSITIVE_OUTPUT" };
  const explicitLocation = xiuzhengText(job.location) ?? xiuzhengText(job.work_place) ?? xiuzhengText(job.address);
  const usesLockedDefaultLocation = explicitLocation === undefined && config.defaultLocationRaw === "未披露";
  const locationRaw = explicitLocation ?? (usesLockedDefaultLocation ? "未披露" : undefined);
  if (!locationRaw) return { ok: false, code: "AMBIGUOUS_SCOPE", field: "location" };
  if (xiuzhengSensitiveOutput({ sourceJobId, title, locationRaw })) return { ok: false, code: "SENSITIVE_OUTPUT" };
  if (!usesLockedDefaultLocation) {
    const scope = cnstaffGeographyScope(locationRaw);
    if (scope !== "CHINA") return { ok: false, code: scope === "FOREIGN" ? "OUT_OF_SCOPE" : "AMBIGUOUS_SCOPE", field: "location" };
  }
  const detail = `${config.detailBaseUrl}?id=${encodeURIComponent(sourceJobId)}&type=job&scene=2`;
  const expectedHash = `#/recruitDetail?id=${encodeURIComponent(sourceJobId)}&type=job&scene=2`;
  let detailUrl: URL;
  try { detailUrl = new URL(detail); } catch { return { ok: false, code: "UNSAFE_OFFICIAL_URL" }; }
  if (detailUrl.origin !== "https://www.xiuzheng.com" || detailUrl.pathname !== "/" || detailUrl.search || detailUrl.hash !== expectedHash) {
    return { ok: false, code: "UNSAFE_OFFICIAL_URL" };
  }
  return { ok: true, sourceJobId, job: { sourceJobId, title, officialUrl: detailUrl.toString(), locationRaw, cities: citiesWithFallback(locationRaw, locationRaw) } };
}

function xiuzhengOfficialId(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() && safeOfficialJsonId(value.trim()) ? value.trim() : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    const id = String(value);
    return safeOfficialJsonId(id) ? id : undefined;
  }
  return undefined;
}

function xiuzhengText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function xiuzhengSensitiveOutput(fields: Record<string, string>): boolean {
  const variants: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    let current = value.normalize("NFKC");
    variants[key] = current;
    for (let round = 1; round <= 2; round += 1) {
      try { current = decodeURIComponent(current).normalize("NFKC"); }
      catch { break; }
      variants[`${key}Decoded${round}`] = current;
    }
  }
  return Boolean(sensitiveOfficialJsonField(variants));
}

function redactXiuzhengSensitiveBody(body: string, setCookie?: string[]): ReturnType<typeof redactSandozSensitiveBody> {
  const base = redactSandozSensitiveBody(body, setCookie);
  if (base.redacted) return base;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return base; }
  let count = 0;
  const visit = (value: unknown): void => {
    if (typeof value === "string" && xiuzhengSensitiveOutput({ value })) count += 1;
    else if (Array.isArray(value)) value.forEach(visit);
    else if (isStrictRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (xiuzhengSensitiveOutput({ key, value: typeof child === "string" ? child : "" })) count += 1;
        visit(child);
      }
    }
  };
  visit(parsed);
  return count > 0 ? { body: "[REDACTED_CREDENTIAL_MATERIAL]", redacted: true, count } : base;
}

function xiuzhengLocator(page: number, pageSize: number): string {
  return `xiuzheng-job-list-v1|request:page=${page},pageSize=${pageSize}|json:$.code,$.data.current_page,$.data.last_page,$.data.total,$.data.per_page,$.data.data[*]`;
}

function xiuzhengPageTrace(input: { artifact: SourceFetchArtifactDraft; sequence: number; requestedPage: number;
  requestedPageSize?: number;
  parsed: ParsedXiuzhengPage; rawIds: string[]; validIds: string[]; termination: SourceFetchPageTrace["termination"] }): SourceFetchPageTrace {
  return { sequence: input.sequence, artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null, returnedCursor: null, requestedOffset: null, returnedOffset: null,
    requestedPage: input.requestedPage, returnedPage: input.parsed.currentPage ?? null,
    requestedPageSize: input.requestedPageSize ?? null, returnedPageSize: null,
    rawJobIds: input.rawIds, validJobIds: input.validIds,
    declaredTotal: input.parsed.total ?? null, declaredCount: null, declaredPages: input.parsed.lastPage ?? null,
    nextPageSignalBefore: input.requestedPage === 1 ? null : String(input.requestedPage),
    nextPageSignalAfter: input.termination === "CONTINUE" ? String(input.requestedPage + 1) : null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
    termination: input.termination, anomalyCodes: input.parsed.currentPage !== undefined && input.parsed.currentPage !== input.requestedPage ? ["RETURNED_PAGE_MISMATCH"] : [],
    capturedAt: input.artifact.capturedAt };
}

function sourceTraversalCompleteness(
  pages: readonly SourceFetchPageTrace[],
  artifacts: readonly SourceFetchArtifactDraft[]
): PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  const firstPage = pages[0];
  if (!firstPage) return undefined;
  const artifact = artifacts.find((candidate) => candidate.logicalKey === firstPage.artifactLogicalKey);
  return artifact
    ? {
        kind: "COMPLETE_PAGE_TRAVERSAL",
        value: pages.length,
        artifactLogicalKey: artifact.logicalKey,
        extractorLocator: artifact.extractorLocator,
        scope: "SOURCE"
      }
    : undefined;
}

function xiuzhengDeclaredCompleteness(total: number | undefined, artifact: SourceFetchArtifactDraft | undefined):
  PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  return total !== undefined && artifact
    ? { kind: "OFFICIAL_TOTAL_COUNT", value: total, artifactLogicalKey: artifact.logicalKey,
      extractorLocator: artifact.extractorLocator, scope: "SOURCE" }
    : undefined;
}

function xiuzhengDeclarationFailure(input: { requestedPage: number; requestedPageSize: number; rawPageSize: number;
  cumulativeRawCount: number; current: ParsedXiuzhengPage; prior?: { total?: number; lastPage?: number; perPage?: number } }): boolean {
  const { current, prior } = input;
  if (current.currentPage !== undefined && current.currentPage !== input.requestedPage) return true;
  if (current.perPage !== undefined && current.perPage !== input.requestedPageSize) return true;
  if (input.rawPageSize > input.requestedPageSize) return true;
  if (prior && (["total", "lastPage", "perPage"] as const).some((key) =>
    prior[key] !== undefined && current[key] !== undefined && prior[key] !== current[key])) return true;
  if (current.total !== undefined && input.cumulativeRawCount > current.total) return true;
  if (current.lastPage !== undefined && input.requestedPage > current.lastPage) return true;
  if (current.total !== undefined && current.perPage !== undefined && current.lastPage !== undefined) {
    const calculated = Math.max(1, Math.ceil(current.total / current.perPage));
    if (calculated !== current.lastPage) return true;
  }
  if (current.lastPage !== undefined && input.requestedPage === current.lastPage &&
      current.total !== undefined && input.cumulativeRawCount !== current.total) return true;
  if (current.lastPage !== undefined && input.requestedPage < current.lastPage &&
      input.rawPageSize < input.requestedPageSize) return true;
  return false;
}

function xiuzhengFailure(capturedAt: string, failureReason: string, artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[], fetchCounts: PersistentSourceFetchEvidence["fetchCounts"],
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"],
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"]): SourceFetchResult {
  if (artifacts.length === 0) return failed(capturedAt, failureReason);
  const pagesWithCurrentFailure = artifacts.length > pages.length
    ? [...pages, xiuzhengPageTrace({ artifact: artifacts[artifacts.length - 1]!, sequence: pages.length,
      requestedPage: pages.length + 1, parsed: { rawJobs: [] }, rawIds: [], validIds: [], termination: "FAILED" })]
    : pages;
  const evidencePages = pagesWithCurrentFailure.length > 0
    ? pagesWithCurrentFailure.map((page, index) => index === pagesWithCurrentFailure.length - 1 && page.termination === "CONTINUE"
      ? { ...page, termination: "ABORTED" as const } : page)
    : [xiuzhengPageTrace({ artifact: artifacts[0]!, sequence: 0, requestedPage: 1,
      parsed: { rawJobs: [] }, rawIds: [], validIds: [], termination: "FAILED" })];
  return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts, pages: evidencePages, fetchCounts, fetchLosses,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  }));
}

function recordXiuzhengLoss(losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"], stage: "PARSE" | "VALIDATION", code: XiuzhengLossCode,
  rawLocator: string, pageSequence: number, recordIndex: number, field?: string): void {
  if (stage === "PARSE") counts.parseDiscardCount += 1; else counts.validationDiscardCount += 1;
  losses.push({ stage, reason: `Xiuzheng record rejected: ${code}`, rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence, recordIndex } });
}

function jobsynEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "prod-search-api.jobsyn.org" ||
      url.port || url.username || url.password || url.hash || url.search ||
      url.pathname !== "/api/v1/solr/search") throw new Error("invalid Jobsyn endpoint");
  return url;
}

function jobsynSiteOrigin(value: string, officialHost: string): string {
  if (!/^[a-z0-9.-]+$/u.test(value) || value.startsWith(".") || value.endsWith(".") ||
      value !== officialHost) {
    throw new Error("invalid Jobsyn site origin");
  }
  return value;
}

function jobsynDetailBase(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/") throw new Error("invalid Jobsyn detail base");
  return url;
}

function sandozLocator(probe: SandozProbe, page: number, pageSize: number, declarations: boolean): string {
  return `sandoz-jsonapi-v2|probe:${probe}|page:${page}|page-size:${pageSize}|fields:node--jobs-v1|json:$.data[*]` +
    (declarations ? ",$.meta.count,$.number_of_items_per_page,$.links.self.href,$.links.next.href" : "");
}

function sandozPageTrace(input: {
  artifact: SourceFetchArtifactDraft; sequence: number; requestedPage: number; returnedPage?: number | null;
  rawJobIds?: string[]; validJobIds?: string[]; declaredTotal?: number;
  requestedPageSize?: number | null; returnedPageSize?: number | null;
  nextPageSignalBefore?: string | null; nextPageSignalAfter?: string | null;
  termination: SourceFetchPageTrace["termination"];
}): SourceFetchPageTrace {
  return {
    sequence: input.sequence, artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null, returnedCursor: null, requestedOffset: null, returnedOffset: null,
    requestedPage: input.requestedPage, returnedPage: input.returnedPage ?? null,
    requestedPageSize: input.requestedPageSize ?? null, returnedPageSize: input.returnedPageSize ?? null,
    rawJobIds: input.rawJobIds ?? [], validJobIds: input.validJobIds ?? [],
    declaredTotal: input.declaredTotal ?? null, declaredCount: null, declaredPages: null,
    nextPageSignalBefore: input.nextPageSignalBefore ?? null, nextPageSignalAfter: input.nextPageSignalAfter ?? null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
    termination: input.termination, anomalyCodes: [], capturedAt: input.artifact.capturedAt
  };
}

function sandozDeclaredCompleteness(total: number | undefined, artifactLogicalKey: string | undefined):
  PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  return total !== undefined && artifactLogicalKey
    ? { kind: "OFFICIAL_TOTAL_COUNT", value: total, artifactLogicalKey,
        extractorLocator: sandozLocator("primary", Number(artifactLogicalKey.slice("sandoz-primary-page-".length)), 10, true), scope: "SOURCE" }
    : undefined;
}

function sandozFailure(capturedAt: string, failureReason: string, artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[], fetchCounts: PersistentSourceFetchEvidence["fetchCounts"],
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"],
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"]): SourceFetchResult {
  if (artifacts.length === 0) return failed(capturedAt, failureReason);
  if (artifacts.every((artifact) => artifact.kind !== "PAGINATION_PAGE")) {
    return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonSupportingFailureEvidence({
      artifacts, code: "SANDOZ_ENTRY_OR_TOKEN_FAILED"
    }));
  }
  const evidencePages = pages.map((page, index) => index === pages.length - 1 && page.termination === "CONTINUE"
    ? { ...page, termination: "ABORTED" as const } : page);
  return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts, pages: evidencePages, fetchCounts, fetchLosses,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  }));
}

function recordSandozLoss(losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"], stage: "PARSE" | "VALIDATION", code: SandozLossCode,
  rawLocator: string, pageSequence: number, recordIndex: number, field?: string): void {
  if (stage === "PARSE") counts.parseDiscardCount += 1; else counts.validationDiscardCount += 1;
  losses.push({ stage, reason: `Sandoz JSONAPI resource rejected: ${code}`, rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence, recordIndex } });
}

function jobsynOptionalInteger(record: Record<string, unknown>, key: string): {
  value?: number; invalid: boolean;
} {
  if (!hasOwn(record, key)) return { invalid: false };
  return isNonnegativeInteger(record[key]) ? { value: record[key], invalid: false } : { invalid: true };
}

function jobsynLocator(page: number, pageSize: number, location: string, declarations: boolean): string {
  return `jobsyn-solr-v1|page:${page}|num_items:${pageSize}|location:${irreversibleOfficialJsonEvidenceId(location)}` +
    `|json:$.jobs[*]${declarations ? ",$.pagination.total,$.pagination.total_pages,$.pagination.page" : ""}`;
}

function jobsynPageTrace(input: {
  artifact: SourceFetchArtifactDraft; sequence: number; requestedPage: number; returnedPage?: number | null;
  rawJobIds?: string[]; validJobIds?: string[]; declaredTotal?: number; declaredPages?: number;
  nextPageSignalBefore?: string | null; nextPageSignalAfter?: string | null;
  termination: SourceFetchPageTrace["termination"];
}): SourceFetchPageTrace {
  return {
    sequence: input.sequence, artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null, returnedCursor: null, requestedOffset: null, returnedOffset: null,
    requestedPage: input.requestedPage, returnedPage: input.returnedPage ?? null,
    rawJobIds: input.rawJobIds ?? [], validJobIds: input.validJobIds ?? [],
    declaredTotal: input.declaredTotal ?? null, declaredCount: null, declaredPages: input.declaredPages ?? null,
    nextPageSignalBefore: input.nextPageSignalBefore ?? null, nextPageSignalAfter: input.nextPageSignalAfter ?? null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
    termination: input.termination, anomalyCodes: [], capturedAt: input.artifact.capturedAt
  };
}

function jobsynDeclaredCompleteness(total: number | undefined, artifactLogicalKey: string | undefined,
  extractorLocator: string | undefined): PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  return total !== undefined && artifactLogicalKey && extractorLocator
    ? { kind: "OFFICIAL_TOTAL_COUNT", value: total, artifactLogicalKey, extractorLocator, scope: "SOURCE" }
    : undefined;
}

function jobsynFailure(capturedAt: string, failureReason: string, artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[], fetchCounts: PersistentSourceFetchEvidence["fetchCounts"],
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"],
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"],
  transportFailure?: SourceTransportFailure): SourceFetchResult {
  if (artifacts.length === 0) return failed(capturedAt, failureReason, transportFailure);
  const evidencePages = pages.length > 0
    ? pages.map((page, index) => index === pages.length - 1 && page.termination === "CONTINUE"
      ? { ...page, termination: "ABORTED" as const } : page)
    : [jobsynPageTrace({ artifact: artifacts[0]!, sequence: 0, requestedPage: 1, termination: "FAILED" })];
  return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts, pages: evidencePages, fetchCounts, fetchLosses,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  }), transportFailure);
}

function recordJobsynLoss(losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"], stage: "PARSE" | "VALIDATION",
  code: "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "UNSAFE_OFFICIAL_ID" |
    "DUPLICATE_OFFICIAL_ID" | "CONFLICTING_OFFICIAL_ID" | "OUT_OF_SCOPE" | "AMBIGUOUS_SCOPE" |
    "UNSAFE_OFFICIAL_URL" | "SENSITIVE_OUTPUT",
  rawLocator: string, pageSequence: number, recordIndex: number, field?: string): void {
  if (stage === "PARSE") counts.parseDiscardCount += 1; else counts.validationDiscardCount += 1;
  losses.push({ stage, reason: `Jobsyn Solr record rejected: ${code}`, rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence, recordIndex } });
}

type RedseaLossCode = "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "UNSAFE_OFFICIAL_ID" |
  "DUPLICATE_OFFICIAL_ID" | "CONFLICTING_OFFICIAL_ID" | "OUT_OF_SCOPE" | "AMBIGUOUS_SCOPE" | "SENSITIVE_OUTPUT";

function redseaArtifact(channel: string, suffix: "entry" | "list" | "api",
  kind: "OFFICIAL_COMPANY_PAGE" | "PAGINATION_PAGE", requestedUrl: string,
  response: OfficialJsonHttpResponse, apiExtractorLocator?: string): { artifact: SourceFetchArtifactDraft; redacted: boolean } {
  const credentialRedaction = redactSandozSensitiveBody(response.body);
  let upstreamError = false;
  if (suffix === "api" && !credentialRedaction.redacted) {
    try {
      const root = JSON.parse(response.body);
      upstreamError = isStrictRecord(root) && hasOwn(root, "meg") && root.state !== "1";
    } catch { /* malformed bodies remain exact evidence */ }
  }
  const redaction = upstreamError
    ? { body: "[REDACTED_UPSTREAM_ERROR_TEXT]", redacted: true, count: 1 }
    : credentialRedaction;
  const logicalKey = `redsea-${channel}-${suffix}`;
  const artifact = officialJsonNetworkArtifact({
    id: logicalKey, logicalKey, kind, requestedUrl, response: { ...response, body: redaction.body },
    extractorLocator: suffix === "api"
      ? apiExtractorLocator ?? `redsea-channel-v1|channel:${irreversibleOfficialJsonEvidenceId(channel)}|json:$.state,$.jsonList[*]`
      : `redsea-channel-v1|channel:${irreversibleOfficialJsonEvidenceId(channel)}|${suffix}`,
    bodyRepresentation: redaction.redacted ? "REDACTED" : "EXACT",
    ...(redaction.redacted ? { rawBodySha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
      redactionDescriptors: [{ kind: upstreamError ? "UPSTREAM_ERROR_TEXT" as const : "CREDENTIAL_MATERIAL" as const, count: redaction.count }] } : {})
  });
  artifact.channelId = channel;
  return { redacted: redaction.redacted, artifact };
}

function assertRedseaResponse(response: OfficialJsonHttpResponse, requestedUrl: string, mime: "html" | "json",
  capturedAt: string, now: () => Date, previousCapturedAtMs: number): number {
  assertOfficialJsonEvidenceResponse(response, { requestedUrl, crawlStartedAtMs: Date.parse(capturedAt), observedNowMs: now().getTime() });
  if (mime === "html") assertOfficialHtmlMime(response); else assertOfficialJsonMime(response);
  const current = Date.parse(response.capturedAt!);
  if (current < previousCapturedAtMs) throw new Error("capture time reversed");
  return current;
}

function redseaPageTrace(artifact: SourceFetchArtifactDraft, sequence: number, channel: string,
  rawJobIds: string[], validJobIds: string[], termination: SourceFetchPageTrace["termination"], repeatedResponse = false): SourceFetchPageTrace {
  return { sequence, artifactLogicalKey: artifact.logicalKey,
    channelId: channel, requestedCursor: channel, returnedCursor: channel, requestedOffset: null, returnedOffset: null,
    requestedPage: null, returnedPage: null, rawJobIds, validJobIds,
    declaredTotal: null, declaredCount: null, declaredPages: null,
    nextPageSignalBefore: null, nextPageSignalAfter: null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(artifact.body), "utf8")).sha256,
    termination, anomalyCodes: repeatedResponse ? ["REPEATED_RESPONSE_FINGERPRINT"] : [],
    capturedAt: artifact.capturedAt };
}

function redseaFailure(capturedAt: string, failureReason: string, artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[], fetchCounts: PersistentSourceFetchEvidence["fetchCounts"],
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"]): SourceFetchResult {
  if (artifacts.length === 0) return failed(capturedAt, failureReason);
  if (pages.length === 0) return failedWithEvidence(capturedAt, failureReason,
    finalizeOfficialJsonSupportingFailureEvidence({ artifacts, code: "REDSEA_SUPPORTING_RESPONSE_FAILED" }));
  const evidencePages = pages.map((page, index) => index === pages.length - 1 && page.termination === "CONTINUE"
    ? { ...page, termination: "ABORTED" as const } : page);
  return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts, pages: evidencePages, fetchCounts, fetchLosses
  }));
}

function recordRedseaLoss(losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"], stage: "PARSE" | "VALIDATION", code: RedseaLossCode,
  rawLocator: string, pageSequence: number, recordIndex: number, field?: string, noteCode?: string): void {
  if (stage === "PARSE") counts.parseDiscardCount += 1; else counts.validationDiscardCount += 1;
  losses.push({ stage, reason: `Redsea record rejected: ${code}`, rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence, recordIndex, ...(noteCode ? { noteCode } : {}) } });
}

export function parseRedseaQueryPostList(
  body: string
): { ok: true; jobs: unknown[] } | { ok: false; failureReason: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { ok: false, failureReason: "Redsea API response is not valid JSON" }; }
  if (!hasUniqueJsonObjectKeys(body) || !isStrictRecord(parsed) || parsed.state !== "1" || !Array.isArray(parsed.jsonList)) {
    return { ok: false, failureReason: stringValue(isStrictRecord(parsed) ? parsed.state : undefined) === "0"
      ? "Redsea API state is unsuccessful" : "Redsea API response schema is invalid" };
  }
  if (redseaHasUnsafePaginationSignal(parsed, parsed.jsonList.length)) {
    return { ok: false, failureReason: "Redsea API pagination signal is unsafe" };
  }
  return { ok: true, jobs: parsed.jsonList };
}

function redseaHasUnsafePaginationSignal(root: Record<string, unknown>, rowCount: number): boolean {
  const falseLike = (value: unknown) => value === undefined || value === null || value === false || value === 0 ||
    value === "" || (typeof value === "string" && /^(?:false|0|null)$/iu.test(value.trim()));
  for (const key of ["hasNext", "hasMore", "more", "next", "nextPage", "next_page", "nextCursor", "next_cursor"] as const) {
    if (hasOwn(root, key) && !falseLike(root[key])) return true;
  }
  if (hasOwn(root, "page") && isStrictRecord(root.page)) return true;

  const safeInteger = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value.trim())) return Number(value.trim());
    return undefined;
  };
  if (hasOwn(root, "total") && root.total !== "" && root.total !== null && root.total !== undefined &&
    safeInteger(root.total) !== rowCount) return true;
  for (const key of ["totalPages", "totalPage", "pageCount"] as const) {
    if (hasOwn(root, key) && !falseLike(root[key])) {
      const value = safeInteger(root[key]);
      if (value !== 1) return true;
    }
  }
  for (const key of ["currentPage", "pageNo", "pageNum", "pageIndex"] as const) {
    if (hasOwn(root, key) && !falseLike(root[key])) {
      const value = safeInteger(root[key]);
      if (value !== 0 && value !== 1) return true;
    }
  }
  for (const key of ["offset", "start"] as const) {
    if (hasOwn(root, key) && !falseLike(root[key]) && safeInteger(root[key]) !== 0) return true;
  }
  for (const key of ["pageSize", "limit"] as const) {
    if (hasOwn(root, key) && !falseLike(root[key])) {
      const value = safeInteger(root[key]);
      if (value === undefined || value < rowCount) return true;
    }
  }
  return false;
}

function normalizeRedseaJob({
  origin,
  channelQrId,
  rootId,
  job
}: {
  origin: string;
  channelQrId: string;
  rootId: string;
  job: unknown;
}): { ok: true; requestId: string; job: NormalizedOfficialJsonJob } | { ok: false; code: RedseaLossCode; field?: string } {
  if (!isObject(job)) {
    return { ok: false, code: "NON_OBJECT_RECORD" };
  }

  const requestId = stringValue(job.REQUEST_ID);
  const title = stringValue(job.PUBLISH_NAME);
  const locationRaw =
    stringValue(job.work_place) ??
    stringValue(job.WORK_PLACE) ??
    stringValue(job.item3) ??
    stringValue(job.BELONG_UNIT_ORG_NAME);
  if (!requestId || !title || !locationRaw) {
    return { ok: false, code: "MISSING_REQUIRED_FIELD" };
  }
  if (!safeOfficialJsonId(requestId)) return { ok: false, code: "UNSAFE_OFFICIAL_ID", field: "REQUEST_ID" };
  if (sensitiveOfficialJsonField({ requestId, title, locationRaw })) return { ok: false, code: "SENSITIVE_OUTPUT" };
  const normalizedLocation = locationRaw.normalize("NFKC");
  const locationScope = cnstaffGeographyScope(normalizedLocation);
  if (locationScope === "FOREIGN") {
    return { ok: false, code: "OUT_OF_SCOPE", field: "location" };
  }
  if (locationScope !== "CHINA") {
    return { ok: false, code: "AMBIGUOUS_SCOPE", field: "location" };
  }

  const detailUrl = new URL(
    `/RedseaPlatform/zhaopin/zpChannelQrCode/${channelQrId}/officeWebsite.mob`,
    origin
  );
  detailUrl.searchParams.set("jumpPageId", "detail");
  detailUrl.searchParams.set("detailRequestId", requestId);
  detailUrl.searchParams.set("rootId", rootId);

  return { ok: true, requestId, job: {
      sourceJobId: `${channelQrId}:${requestId}`,
      title,
      officialUrl: detailUrl.toString(),
      locationRaw,
      cities: citiesWithFallback(locationRaw, locationRaw)
    } };
}

function normalizeJobsynSolrJob(
  config: Extract<OfficialJsonFetchConfig, { kind: "jobsyn-solr" }>,
  job: unknown
): NormalizedOfficialJsonJob[] {
  if (!isObject(job)) {
    return [];
  }

  const sourceJobId = stringValue(job.guid) ?? stringValue(job.id) ?? stringValue(job.reqid);
  const title = stringValue(job.title_exact) ?? stringValue(job.title);
  const titleSlug = stringValue(job.title_slug) ?? (title ? jobsynSlug(title) : undefined);
  const locationRaw =
    stringValue(job.location_exact) ??
    [stringValue(job.city_exact), stringValue(job.country_short_exact) ?? stringValue(job.country_exact)]
      .filter(Boolean)
      .join(", ");
  if (!sourceJobId || !safeOfficialJsonId(sourceJobId) || !title || !titleSlug || !locationRaw ||
      !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(titleSlug)) {
    return [];
  }

  const locationSlug = jobsynSlug(locationRaw);
  const expectedPath = `/${locationSlug}/${encodeURIComponent(titleSlug)}/${sourceJobId}/job/`;
  const base = jobsynDetailBase(config.detailBaseUrl);
  const officialUrl = new URL(expectedPath, base);
  if (officialUrl.origin !== base.origin || officialUrl.pathname !== expectedPath || officialUrl.search || officialUrl.hash) {
    return [];
  }
  return [
    {
      sourceJobId,
      title,
      officialUrl: officialUrl.toString(),
      locationRaw,
      cities: citiesWithFallback(locationRaw, stringValue(job.city_exact) ?? locationRaw)
    }
  ];
}

function normalizedBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function jobsynSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[A-Za-z0-9]+/g)
    ?.map((part) => part.toLowerCase())
    .join("-") ?? "jobs";
}

function normalizeHcmCloudJob({
  origin,
  detailPath,
  defaultLocationRaw,
  job
}: {
  origin: string;
  detailPath: string | undefined;
  defaultLocationRaw: string | undefined;
  job: unknown;
}): NormalizedOfficialJsonJob[] {
  if (!isObject(job)) {
    return [];
  }

  const sourceJobId = stringValue(job.id) ?? stringValue(job.job_id);
  const title =
    stringValue(job.name) ??
    stringValue(job.job_name) ??
    stringValue(job.job_title) ??
    stringValue(job.title);
  const locationRaw =
    hcmCloudLocationValue(job.work_city) ??
    hcmCloudLocationValue(job.work_address) ??
    hcmCloudLocationValue(job.job_address) ??
    hcmCloudLocationValue(job.work_place) ??
    hcmCloudLocationValue(job.address) ??
    hcmCloudLocationValue(job.city) ??
    defaultLocationRaw;
  if (!sourceJobId || !title || !locationRaw) {
    return [];
  }

  const normalizedDetailPath = detailPath ?? "/recruit/#/portal_job_detail";
  return [
    {
      sourceJobId,
      title,
      officialUrl: `${origin}${normalizedDetailPath}?id=${encodeURIComponent(sourceJobId)}`,
      locationRaw,
      cities: citiesFromBeisenLocation([locationRaw])
    }
  ];
}

function hcmCloudLocationValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map(hcmCloudLocationValue).filter(Boolean).join(" / ") || undefined;
  }

  if (!isObject(value)) {
    return stringValue(value);
  }

  return (
    stringValue(value.name) ??
    stringValue(value.label) ??
    stringValue(value.value) ??
    stringValue(value.text)
  );
}

function parsePhenomPageConfig(
  html: string
): {
  widgetApiEndpoint: string | undefined;
  refNum: string | undefined;
  locale: string | undefined;
  deviceType: string | undefined;
  country: string | undefined;
  pageName: string | undefined;
  pageId: string | undefined;
} {
  const candidates: CompletePhenomPageConfig[] = [];
  const $ = loadHtml(html);
  const scripts = $("script").toArray().map((script) => ({
    content: $(script).html() ?? "",
    kind: phenomScriptKind($(script).attr("type"))
  }));
  const pageIdState = scripts.reduce<{
    invalid: boolean;
    bootstrapPageIds: Array<string | undefined>;
    mutations: string[];
  }>((state, script) => {
    if (state.invalid || script.kind === "INERT" || script.kind === "JSON") return state;
    const scan = scanPhenomTopLevelPageIds(script.content, script.kind === "MODULE" ? "module" : "script");
    if (!scan) return { ...state, invalid: script.content.includes("phApp") };
    return {
      invalid: state.invalid || scan.invalid,
      bootstrapPageIds: [...state.bootstrapPageIds, ...scan.bootstrapPageIds],
      mutations: [...state.mutations, ...scan.mutations]
    };
  }, { invalid: false, bootstrapPageIds: [], mutations: [] });
  if (pageIdState.invalid || pageIdState.mutations.length > 1) return emptyPhenomPageConfig();
  const uniqueMutation = pageIdState.mutations[0];
  if (uniqueMutation && (
    pageIdState.bootstrapPageIds.length === 0 ||
    pageIdState.bootstrapPageIds.some((pageId) =>
      pageId !== undefined &&
      pageId !== uniqueMutation &&
      `${pageId}-ds` !== uniqueMutation
    )
  )) return emptyPhenomPageConfig();

  for (const { content, kind: scriptKind } of scripts) {
    if (scriptKind === "INERT") continue;
    if (scriptKind === "JSON") {
      const candidate = phenomConfigFromJsonScript(content);
      if (candidate === null) return emptyPhenomPageConfig();
      if (candidate) candidates.push(candidate);
      continue;
    }
    const assignments = phenomTopLevelJavaScriptConfigs(
      content,
      scriptKind === "MODULE" ? "module" : "script",
      uniqueMutation
    );
    if (assignments === null) return emptyPhenomPageConfig();
    candidates.push(...assignments);
  }

  if (candidates.length === 0) return emptyPhenomPageConfig();
  const canonical = JSON.stringify(candidates[0]);
  if (candidates.some((candidate) => JSON.stringify(candidate) !== canonical)) {
    return emptyPhenomPageConfig();
  }
  return candidates[0]!;
}

function phenomScriptKind(rawType: string | undefined): "CLASSIC" | "MODULE" | "JSON" | "INERT" {
  const normalized = (rawType ?? "").trim().toLowerCase();
  if (!normalized) return "CLASSIC";
  if (normalized === "module") return "MODULE";
  const essence = normalized.split(";", 1)[0]!.trim();
  if (essence === "application/json") return "JSON";
  if (essence === "text/javascript" || essence === "application/javascript") return "CLASSIC";
  return "INERT";
}

function phenomConfigFromJsonScript(content: string): CompletePhenomPageConfig | undefined | null {
  const json = content.trim();
  if (!json) return undefined;
  const rootProperties = topLevelJsonProperties(json);
  if (!rootProperties) return undefined;
  const phAppProperties = rootProperties.filter((property) => property.key === "phApp");
  if (phAppProperties.length === 0) return undefined;
  if (phAppProperties.length !== 1) return null;
  let parsedRoot: unknown;
  try { parsedRoot = JSON.parse(json); } catch { return null; }
  if (!isStrictRecord(parsedRoot) || !hasOwn(parsedRoot, "phApp")) return null;
  const objectStart = skipJsonWhitespace(json, phAppProperties[0]!.valueStart);
  if (json[objectStart] !== "{") return null;
  const objectJson = balancedJsonObject(json, objectStart);
  if (!objectJson) return null;
  return strictPhenomConfigJson(objectJson) ?? null;
}

function strictPhenomConfigJson(json: string): CompletePhenomPageConfig | undefined {
  const properties = topLevelJsonProperties(json);
  if (!properties) return undefined;
  const required = [
    "widgetApiEndpoint", "refNum", "locale", "deviceType", "country", "pageName", "pageId"
  ] as const;
  for (const key of required) {
    if (properties.filter((property) => property.key === key).length !== 1) return undefined;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return undefined; }
  return strictPhenomPageConfig(parsed);
}

function phenomTopLevelJavaScriptConfigs(
  script: string,
  sourceType: "script" | "module",
  externalPageId?: string
): CompletePhenomPageConfig[] | null {
  let program: ReturnType<typeof parseJavaScript>;
  try {
    program = parseJavaScript(script, {
      sourceType,
      allowAwaitOutsideFunction: false,
      allowReturnOutsideFunction: false,
      errorRecovery: false
    });
  } catch {
    return script.includes("phApp") ? null : [];
  }

  const candidates: CompletePhenomPageConfig[] = [];
  const fallbackCandidates: Array<Partial<CompletePhenomPageConfig>> = [];
  const separatePageIds: string[] = [];
  for (const statement of program.program.body) {
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations) {
        if (declaration.id.type !== "Identifier" || declaration.id.name !== "phApp") continue;
        if (declaration.init?.type === "ObjectExpression") {
          const candidate = phenomConfigFromObjectExpression(declaration.init);
          if (!candidate) return null;
          candidates.push(externalPageId ? { ...candidate, pageId: externalPageId } : candidate);
          continue;
        }
        if (declaration.init?.type === "LogicalExpression" && declaration.init.operator === "||" &&
          declaration.init.left.type === "Identifier" && declaration.init.left.name === "phApp" &&
          declaration.init.right.type === "ObjectExpression") {
          const candidate = phenomPartialConfigFromObjectExpression(declaration.init.right);
          if (!candidate) return null;
          fallbackCandidates.push(candidate);
          continue;
        }
        return null;
      }
      continue;
    }
    if (statement.type !== "ExpressionStatement" || statement.expression.type !== "AssignmentExpression") {
      continue;
    }
    const assignment = statement.expression;
    if (isTopLevelPhenomPageIdAssignmentTarget(assignment.left)) {
      if (assignment.operator !== "=" || assignment.right.type !== "StringLiteral" ||
        typeof assignment.right.value !== "string" || !assignment.right.value.trim()) return null;
      separatePageIds.push(assignment.right.value);
      continue;
    }
    if (assignment.operator !== "=" || !isTopLevelPhenomAssignmentTarget(assignment.left)) continue;
    if (assignment.right.type !== "ObjectExpression") return null;
    const candidate = phenomConfigFromObjectExpression(assignment.right);
    if (!candidate) return null;
    candidates.push(externalPageId ? { ...candidate, pageId: externalPageId } : candidate);
  }
  if (fallbackCandidates.length > 0) {
    if (fallbackCandidates.length !== 1 || separatePageIds.length > 1) return null;
    const fallback = fallbackCandidates[0]!;
    if (fallback.pageId && separatePageIds.length > 0) return null;
    const pageId = externalPageId ?? fallback.pageId ?? separatePageIds[0];
    if (!pageId) return null;
    candidates.push({ ...fallback, pageId } as CompletePhenomPageConfig);
  } else if (separatePageIds.length > 0) {
    // A standalone runtime pageId mutation is not a bootstrap config and must
    // neither override nor invalidate a complete static phApp object elsewhere.
    return [];
  }
  return candidates;
}

function scanPhenomTopLevelPageIds(
  script: string,
  sourceType: "script" | "module"
): { invalid: boolean; bootstrapPageIds: Array<string | undefined>; mutations: string[] } | undefined {
  let program: ReturnType<typeof parseJavaScript>;
  try {
    program = parseJavaScript(script, {
      sourceType,
      allowAwaitOutsideFunction: false,
      allowReturnOutsideFunction: false,
      errorRecovery: false
    });
  } catch {
    return undefined;
  }
  const bootstrapPageIds: Array<string | undefined> = [];
  const mutations: string[] = [];
  const allowedPageIdAssignments = new Set<object>();
  for (const statement of program.program.body) {
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations) {
        if (declaration.id.type !== "Identifier" || declaration.id.name !== "phApp") continue;
        const object = declaration.init?.type === "ObjectExpression"
          ? declaration.init
          : declaration.init?.type === "LogicalExpression" && declaration.init.operator === "||" &&
              declaration.init.left.type === "Identifier" && declaration.init.left.name === "phApp" &&
              declaration.init.right.type === "ObjectExpression"
            ? declaration.init.right
            : undefined;
        if (!object) return { invalid: true, bootstrapPageIds, mutations };
        const config = phenomPartialConfigFromObjectExpression(object);
        if (!config) return { invalid: true, bootstrapPageIds, mutations };
        bootstrapPageIds.push(config.pageId);
      }
      continue;
    }
    if (statement.type !== "ExpressionStatement" || statement.expression.type !== "AssignmentExpression") continue;
    const assignment = statement.expression;
    if (isAnyTopLevelPhenomPageIdMutationTarget(assignment.left)) {
      if (!isTopLevelPhenomPageIdAssignmentTarget(assignment.left) || assignment.operator !== "=" ||
        assignment.right.type !== "StringLiteral" || typeof assignment.right.value !== "string" ||
        !assignment.right.value.trim()) return { invalid: true, bootstrapPageIds, mutations };
      mutations.push(assignment.right.value);
      allowedPageIdAssignments.add(assignment);
      continue;
    }
    if (!isTopLevelPhenomAssignmentTarget(assignment.left)) continue;
    if (assignment.operator !== "=" || assignment.right.type !== "ObjectExpression") {
      return { invalid: true, bootstrapPageIds, mutations };
    }
    const config = phenomPartialConfigFromObjectExpression(assignment.right);
    if (!config) return { invalid: true, bootstrapPageIds, mutations };
    bootstrapPageIds.push(config.pageId);
  }
  if (hasUnsafePhenomPageIdMutation(program.program, allowedPageIdAssignments)) {
    return { invalid: true, bootstrapPageIds, mutations };
  }
  return { invalid: false, bootstrapPageIds, mutations };
}

function hasUnsafePhenomPageIdMutation(root: unknown, allowedAssignments: ReadonlySet<object>): boolean {
  const seen = new Set<object>();
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    const node = value as Record<string, unknown>;
    if (node.type === "AssignmentExpression" && isDeepPhenomPageIdTarget(node.left) &&
      !allowedAssignments.has(value)) return true;
    if (node.type === "UpdateExpression" && isDeepPhenomPageIdTarget(node.argument)) return true;
    if (node.type === "CallExpression" && isObjectAssignToPhenom(node)) return true;
    return Object.entries(node).some(([key, child]) =>
      !["loc", "start", "end", "leadingComments", "trailingComments", "innerComments"].includes(key) && visit(child)
    );
  };
  return visit(root);
}

function isDeepPhenomPageIdTarget(value: unknown): boolean {
  if (!isStrictRecord(value) || value.type !== "MemberExpression" || !isStrictRecord(value.property)) return false;
  const propertyIsPageId = value.computed === true
    ? value.property.type === "StringLiteral" && value.property.value === "pageId"
    : value.property.type === "Identifier" && value.property.name === "pageId";
  return propertyIsPageId && isDirectPhenomObject(value.object);
}

function isDirectPhenomObject(value: unknown): boolean {
  if (!isStrictRecord(value)) return false;
  if (value.type === "Identifier" && value.name === "phApp") return true;
  if (value.type !== "MemberExpression" || !isStrictRecord(value.object) || !isStrictRecord(value.property)) return false;
  const propertyIsPhApp = value.computed === true
    ? value.property.type === "StringLiteral" && value.property.value === "phApp"
    : value.property.type === "Identifier" && value.property.name === "phApp";
  return propertyIsPhApp && value.object.type === "Identifier" &&
    (value.object.name === "window" || value.object.name === "globalThis");
}

function isObjectAssignToPhenom(node: Record<string, unknown>): boolean {
  if (!isStrictRecord(node.callee) || node.callee.type !== "MemberExpression" ||
    !isStrictRecord(node.callee.object) || !isStrictRecord(node.callee.property) ||
    node.callee.object.type !== "Identifier" || node.callee.object.name !== "Object") return false;
  const isAssign = node.callee.computed === true
    ? node.callee.property.type === "StringLiteral" && node.callee.property.value === "assign"
    : node.callee.property.type === "Identifier" && node.callee.property.name === "assign";
  return isAssign && Array.isArray(node.arguments) && isDirectPhenomObject(node.arguments[0]);
}

function isAnyTopLevelPhenomPageIdMutationTarget(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "MemberExpression" ||
    !("object" in value) || !("property" in value) || !value.object || typeof value.object !== "object" ||
    !value.property || typeof value.property !== "object" || !("type" in value.object) ||
    value.object.type !== "Identifier" || !("name" in value.object) || value.object.name !== "phApp") return false;
  if (!("computed" in value) || !value.computed) {
    return "type" in value.property && value.property.type === "Identifier" &&
      "name" in value.property && value.property.name === "pageId";
  }
  return "type" in value.property && value.property.type === "StringLiteral" &&
    "value" in value.property && value.property.value === "pageId";
}

function isTopLevelPhenomPageIdAssignmentTarget(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "MemberExpression" ||
    !("computed" in value) || value.computed || !("object" in value) || !("property" in value) ||
    !value.object || typeof value.object !== "object" || !value.property || typeof value.property !== "object") {
    return false;
  }
  return "type" in value.object && value.object.type === "Identifier" &&
    "name" in value.object && value.object.name === "phApp" &&
    "type" in value.property && value.property.type === "Identifier" &&
    "name" in value.property && value.property.name === "pageId";
}

function isTopLevelPhenomAssignmentTarget(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "Identifier") {
    return "name" in value && value.name === "phApp";
  }
  if (value.type !== "MemberExpression" || !("computed" in value) || value.computed) return false;
  if (!("object" in value) || !("property" in value) ||
    !value.object || typeof value.object !== "object" ||
    !value.property || typeof value.property !== "object") return false;
  return "type" in value.object && value.object.type === "Identifier" &&
    "name" in value.object && value.object.name === "window" &&
    "type" in value.property && value.property.type === "Identifier" &&
    "name" in value.property && value.property.name === "phApp";
}

function phenomConfigFromObjectExpression(
  expression: ObjectExpression
): CompletePhenomPageConfig | undefined {
  const result = phenomPartialConfigFromObjectExpression(expression);
  return result && completePhenomPageConfig(result) ? result : undefined;
}

function phenomPartialConfigFromObjectExpression(
  expression: ObjectExpression
): Partial<CompletePhenomPageConfig> | undefined {
  const values = new Map<string, string>();
  for (const property of expression.properties) {
    if (!property || typeof property !== "object" || !("type" in property) ||
      property.type !== "ObjectProperty" || !("computed" in property) || property.computed ||
      !("key" in property) || !("value" in property)) return undefined;
    const keyNode = property.key;
    const valueNode = property.value;
    if (!keyNode || typeof keyNode !== "object" || !valueNode || typeof valueNode !== "object" ||
      !("type" in keyNode) || !("type" in valueNode)) return undefined;
    const key = keyNode.type === "Identifier" && "name" in keyNode
      ? keyNode.name
      : keyNode.type === "StringLiteral" && "value" in keyNode
        ? keyNode.value
        : undefined;
    if (typeof key !== "string" || values.has(key)) return undefined;
    if (valueNode.type === "StringLiteral" && "value" in valueNode && typeof valueNode.value === "string") {
      values.set(key, valueNode.value);
    } else {
      values.set(key, "");
    }
  }
  const required = ["widgetApiEndpoint", "refNum", "locale", "deviceType", "country", "pageName"] as const;
  const result: Partial<CompletePhenomPageConfig> = {};
  for (const key of required) {
    const value = values.get(key);
    if (!value?.trim()) return undefined;
    result[key] = value;
  }
  const pageId = values.get("pageId");
  if (pageId !== undefined) {
    if (!pageId.trim()) return undefined;
    result.pageId = pageId;
  }
  return result;
}

function topLevelJsonProperties(json: string): Array<{ key: string; valueStart: number }> | undefined {
  const start = skipJsonWhitespace(json, 0);
  if (json[start] !== "{") return undefined;
  const properties: Array<{ key: string; valueStart: number }> = [];
  let depth = 0;
  for (let index = start; index < json.length; index += 1) {
    const char = json[index]!;
    if (char === '"') {
      const end = jsonStringEnd(json, index);
      if (end < 0) return undefined;
      if (depth === 1) {
        const colon = skipJsonWhitespace(json, end);
        if (json[colon] === ":") {
          let key: unknown;
          try { key = JSON.parse(json.slice(index, end)); } catch { return undefined; }
          if (typeof key !== "string") return undefined;
          properties.push({ key, valueStart: colon + 1 });
        }
      }
      index = end - 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return properties;
    }
  }
  return undefined;
}

function jsonStringEnd(value: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index]!;
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') return index + 1;
  }
  return -1;
}

function skipJsonWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && /\s/u.test(value[index]!)) index += 1;
  return index;
}

function strictPhenomPageConfig(value: unknown): CompletePhenomPageConfig | undefined {
  if (!isStrictRecord(value)) return undefined;
  const fields = [
    "widgetApiEndpoint", "refNum", "locale", "deviceType", "country", "pageName", "pageId"
  ] as const;
  const result: Partial<CompletePhenomPageConfig> = {};
  for (const field of fields) {
    if (!hasOwn(value, field) || typeof value[field] !== "string" || !value[field].trim()) {
      return undefined;
    }
    result[field] = value[field];
  }
  return result as CompletePhenomPageConfig;
}

function emptyPhenomPageConfig(): ReturnType<typeof parsePhenomPageConfig> {
  return {
    widgetApiEndpoint: undefined,
    refNum: undefined,
    locale: undefined,
    deviceType: undefined,
    country: undefined,
    pageName: undefined,
    pageId: undefined
  };
}

function beisenLocator(input: {
  pageIndex: number;
  pageSize: number;
  category: string;
  hasCount: boolean;
  hasData: boolean;
}): string {
  const paths = [input.hasCount ? "$.Count" : undefined, input.hasData ? "$.Data" : undefined]
    .filter((value): value is string => value !== undefined)
    .join(",") || "unavailable";
  return [
    "beisen-zhiye-page-v1",
    `requestPageIndex:${input.pageIndex}`,
    `requestPageSize:${input.pageSize}`,
    `requestCategory:${irreversibleOfficialJsonEvidenceId(input.category)}`,
    `json:${paths}`
  ].join("|");
}

function cnstaffLocator(input: {
  page: number;
  pageSize: number;
  hasTotal: boolean;
  hasPages: boolean;
  hasReturnedPage: boolean;
  hasList: boolean;
}): string {
  const paths = [
    input.hasTotal ? "$.total" : undefined,
    input.hasPages ? "$.page.total" : undefined,
    input.hasReturnedPage ? "$.page.now" : undefined,
    input.hasList ? "$.list" : undefined
  ].filter((value): value is string => value !== undefined).join(",") || "unavailable";
  return `cnstaff-page-v1|requestPage:${input.page}|requestPageSize:${input.pageSize}|requestN:1|json:${paths}`;
}

const CNSTAFF_COUNTRY_FIELDS = [
  "Country", "country", "job_country", "job_country_name", "country_name"
] as const;

const CNSTAFF_MAINLAND_PROVINCES = new Set(`
北京 北京市 天津 天津市 上海 上海市 重庆 重庆市
河北 河北省 冀 山西 山西省 晋 辽宁 辽宁省 辽 吉林 吉林省 吉 黑龙江 黑龙江省 黑
江苏 江苏省 苏 浙江 浙江省 浙 安徽 安徽省 皖 福建 福建省 闽 江西 江西省 赣
山东 山东省 鲁 河南 河南省 豫 湖北 湖北省 鄂 湖南 湖南省 湘 广东 广东省 粤
海南 海南省 琼 四川 四川省 川 蜀 贵州 贵州省 贵 黔 云南 云南省 云 滇
陕西 陕西省 陕 秦 甘肃 甘肃省 甘 陇 青海 青海省 青
内蒙古 内蒙古自治区 蒙 广西 广西壮族自治区 桂 西藏 西藏自治区 藏
宁夏 宁夏回族自治区 宁 新疆 新疆维吾尔自治区 新
`.trim().split(/\s+/u));

const CNSTAFF_MAINLAND_PREFECTURES = new Set(`
石家庄 唐山 秦皇岛 邯郸 邢台 保定 张家口 承德 沧州 廊坊 衡水
太原 大同 阳泉 长治 晋城 朔州 晋中 运城 忻州 临汾 吕梁
呼和浩特 包头 乌海 赤峰 通辽 鄂尔多斯 呼伦贝尔 巴彦淖尔 乌兰察布 兴安盟 锡林郭勒盟 阿拉善盟
沈阳 大连 鞍山 抚顺 本溪 丹东 锦州 营口 阜新 辽阳 盘锦 铁岭 朝阳 葫芦岛
长春 吉林 四平 辽源 通化 白山 松原 白城 延边 延边朝鲜族自治州
哈尔滨 齐齐哈尔 鸡西 鹤岗 双鸭山 大庆 伊春 佳木斯 七台河 牡丹江 黑河 绥化 大兴安岭
南京 无锡 徐州 常州 苏州 南通 连云港 淮安 盐城 扬州 镇江 泰州 宿迁
杭州 宁波 温州 嘉兴 湖州 绍兴 金华 衢州 舟山 台州 丽水
合肥 芜湖 蚌埠 淮南 马鞍山 淮北 铜陵 安庆 黄山 滁州 阜阳 宿州 六安 亳州 池州 宣城
福州 厦门 莆田 三明 泉州 漳州 南平 龙岩 宁德
南昌 景德镇 萍乡 九江 新余 鹰潭 赣州 吉安 宜春 抚州 上饶
济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽
郑州 开封 洛阳 平顶山 安阳 鹤壁 新乡 焦作 濮阳 许昌 漯河 三门峡 南阳 商丘 信阳 周口 驻马店 济源
武汉 黄石 十堰 宜昌 襄阳 鄂州 荆门 孝感 荆州 黄冈 咸宁 随州 恩施 神农架 潜江 仙桃 天门
长沙 株洲 湘潭 衡阳 邵阳 岳阳 常德 张家界 益阳 郴州 永州 怀化 娄底 湘西
广州 韶关 深圳 珠海 汕头 佛山 江门 湛江 茂名 肇庆 惠州 梅州 汕尾 河源 阳江 清远 东莞 中山 潮州 揭阳 云浮
南宁 柳州 桂林 梧州 北海 防城港 钦州 贵港 玉林 百色 贺州 河池 来宾 崇左
海口 三亚 三沙 儋州
成都 自贡 攀枝花 泸州 德阳 绵阳 广元 遂宁 内江 乐山 南充 眉山 宜宾 广安 达州 雅安 巴中 资阳 阿坝 甘孜 凉山
贵阳 六盘水 遵义 安顺 毕节 铜仁 黔西南 黔东南 黔南
昆明 曲靖 玉溪 保山 昭通 丽江 普洱 临沧 楚雄 红河 文山 西双版纳 大理 德宏 怒江 迪庆
拉萨 日喀则 昌都 林芝 山南 那曲 阿里
西安 铜川 宝鸡 咸阳 渭南 延安 汉中 榆林 安康 商洛
兰州 嘉峪关 金昌 白银 天水 武威 张掖 平凉 酒泉 庆阳 定西 陇南 临夏 甘南
西宁 海东 海北 黄南 海南州 果洛 玉树 海西
银川 石嘴山 吴忠 固原 中卫
乌鲁木齐 克拉玛依 吐鲁番 哈密 昌吉 博尔塔拉 巴音郭楞 阿克苏 克孜勒苏 喀什 和田 伊犁 塔城 阿勒泰 石河子 阿拉尔 图木舒克 五家渠 北屯 铁门关 双河 可克达拉 昆玉 胡杨河 新星
`.trim().split(/\s+/u));

type CnstaffScope = "CHINA" | "OUT_OF_SCOPE" | "AMBIGUOUS";
type CnstaffGeographyScope = "CHINA" | "FOREIGN" | "UNKNOWN" | "AMBIGUOUS";
type CnstaffCountryCoordinate = { field: typeof CNSTAFF_COUNTRY_FIELDS[number]; value: unknown };

function cnstaffCountryCoordinates(record: Record<string, unknown>): CnstaffCountryCoordinate[] {
  return CNSTAFF_COUNTRY_FIELDS.flatMap((field) => hasOwn(record, field)
    ? [{ field, value: record[field] }]
    : []);
}

function cnstaffRecordScope(
  countryCoordinates: CnstaffCountryCoordinate[],
  locationRaw: string
): CnstaffScope {
  const location = cnstaffGeographyScope(locationRaw);
  if (countryCoordinates.length === 0) {
    return location === "CHINA" ? "CHINA" : location === "AMBIGUOUS" ? "AMBIGUOUS" : "OUT_OF_SCOPE";
  }
  const countryKinds = new Set(countryCoordinates.map(({ value }) => cnstaffCountryValueScope(value)));
  if (countryKinds.size > 1) return "AMBIGUOUS";
  const country = [...countryKinds][0]!;
  if (country === "UNKNOWN") return "OUT_OF_SCOPE";
  if ((country === "CHINA" && location === "FOREIGN") ||
      (country === "FOREIGN" && location === "CHINA") || location === "AMBIGUOUS") {
    return "AMBIGUOUS";
  }
  return country === "CHINA" ? "CHINA" : "OUT_OF_SCOPE";
}

function cnstaffCountryValueScope(value: unknown): "CHINA" | "FOREIGN" | "UNKNOWN" {
  if (typeof value !== "string" || !value.trim()) return "UNKNOWN";
  const canonical = cnstaffCanonicalScopeText(value);
  if (canonical === undefined) return "UNKNOWN";
  const normalized = canonical.trim().toLowerCase();
  if (/^(?:china|prc|mainland china|china mainland|people'?s republic of china|中国|中国大陆|中华人民共和国)$/iu.test(normalized)) {
    return "CHINA";
  }
  if (/^(?:united states|usa|u\.s\.?|japan|singapore|india|germany|france|canada|australia|united kingdom|uk|日本|美国|新加坡|印度|德国|法国|加拿大|澳大利亚|英国)$/iu.test(normalized)) {
    return "FOREIGN";
  }
  return "UNKNOWN";
}

function cnstaffGeographyScope(value: string): CnstaffGeographyScope {
  const normalized = cnstaffCanonicalScopeText(value);
  if (normalized === undefined) return "UNKNOWN";
  const china = cnstaffHasMainlandGeography(normalized);
  const foreign = cnstaffHasForeignGeography(normalized);
  if (foreign) return "FOREIGN";
  return china ? "CHINA" : "UNKNOWN";
}

function cnstaffCanonicalScopeText(value: string): string | undefined {
  let current = value.normalize("NFKC");
  for (let round = 0; round < 2; round += 1) {
    if (!/%[0-9A-Fa-f]{2}/u.test(current)) break;
    try {
      current = decodeURIComponent(current).normalize("NFKC");
    } catch {
      return undefined;
    }
  }
  if (/%/u.test(current)) return undefined;
  return current.trim();
}

function cnstaffHasMainlandGeography(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  if (new Set(["中华人民共和国", "中国大陆", "大陆地区", "中国", "全国"]).has(normalized) ||
      /\b(?:china|prc|mainland china|china mainland|people'?s republic of china)\b/iu.test(normalized)) {
    return true;
  }
  const segments = normalized.split(/[\s,，;；/|()（）·、]+/u).filter(Boolean);
  for (const segment of segments) {
    const stripped = segment.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|地区|盟|省|市)$/u, "");
    if (CNSTAFF_MAINLAND_PROVINCES.has(segment) || CNSTAFF_MAINLAND_PROVINCES.has(stripped) ||
        CNSTAFF_MAINLAND_PREFECTURES.has(segment) || CNSTAFF_MAINLAND_PREFECTURES.has(stripped)) return true;
    if (cnstaffHasMunicipalityAdministrativeGeography(segment)) return true;
    if (cnstaffHasChainedMainlandGeography(segment)) return true;
    if (cnstaffHasPrefectureAdministrativeGeography(segment)) return true;
  }
  return false;
}

function cnstaffHasMunicipalityAdministrativeGeography(segment: string): boolean {
  return ["北京", "上海", "天津", "重庆"].some((municipality) => {
    if (!segment.startsWith(municipality) || segment.length === municipality.length) return false;
    return cnstaffHasCompleteAdministrativeSuffix(segment.slice(municipality.length));
  });
}

function cnstaffHasChainedMainlandGeography(segment: string): boolean {
  const provinceNames = [...CNSTAFF_MAINLAND_PROVINCES]
    .filter((name) => name.length >= 2)
    .sort((left, right) => right.length - left.length);
  const prefectureNames = [...CNSTAFF_MAINLAND_PREFECTURES]
    .filter((name) => name.length >= 2)
    .sort((left, right) => right.length - left.length);

  for (const province of provinceNames) {
    if (!segment.startsWith(province) || segment.length === province.length) continue;
    const remainder = segment.slice(province.length);
    for (const prefecture of prefectureNames) {
      if (!remainder.startsWith(prefecture)) continue;
      const administrativeSuffix = remainder.slice(prefecture.length);
      if (cnstaffHasCompleteAdministrativeSuffix(administrativeSuffix)) return true;
    }
  }
  return false;
}

function cnstaffHasPrefectureAdministrativeGeography(segment: string): boolean {
  return [...CNSTAFF_MAINLAND_PREFECTURES].some((prefecture) => {
    if (prefecture.length < 2 || !segment.startsWith(prefecture)) return false;
    const administrativeSuffix = segment.slice(prefecture.length);
    return cnstaffHasCompleteAdministrativeSuffix(administrativeSuffix);
  });
}

function cnstaffHasCompleteAdministrativeSuffix(suffix: string): boolean {
  if (suffix === "") return true;
  if (/^[\p{Script=Han}]{1,16}族自治州(?:[\p{Script=Han}]{1,12}(?:区|县|市|旗|镇|乡))?$/u.test(suffix)) {
    return true;
  }
  const topLevelSuffix = /^(?:市|自治州|地区|盟)/u.exec(suffix)?.[0];
  const countyLevel = topLevelSuffix === undefined ? suffix : suffix.slice(topLevelSuffix.length);
  return countyLevel === "" || /^[\p{Script=Han}]{1,12}(?:区|县|市|旗|镇|乡|街道|新区|开发区|高新区|工业园|园区|湖)$/u.test(countyLevel);
}

function cnstaffHasForeignGeography(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();
  return /(?:香港|澳门|台湾|台北|海外|国外|欧洲大陆|美国|纽约|波士顿|旧金山|洛杉矶|西雅图|日本|东京|大阪|京都|新加坡|印度|德国|法国|加拿大|澳大利亚|英国|伦敦|韩国|首尔)|\b(?:hong kong|macao|macau|taiwan|taipei|overseas|abroad|european mainland|continental europe|united states|usa|u\.s\.|boston|new york|san francisco|los angeles|seattle|japan|tokyo|osaka|kyoto|singapore|india|germany|france|canada|australia|united kingdom|london|south korea|seoul)\b/u.test(normalized);
}

function cnstaffPageTrace(input: {
  artifact: SourceFetchArtifactDraft;
  sequence: number;
  requestedPage: number;
  returnedPage?: number | null;
  rawJobIds?: string[];
  validJobIds?: string[];
  declaredTotal?: number;
  declaredPages?: number;
  nextPageSignalBefore?: string | null;
  nextPageSignalAfter?: string | null;
  termination: SourceFetchPageTrace["termination"];
}): SourceFetchPageTrace {
  return {
    sequence: input.sequence,
    artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null,
    returnedCursor: null,
    requestedOffset: null,
    returnedOffset: null,
    requestedPage: input.requestedPage,
    returnedPage: input.returnedPage ?? null,
    rawJobIds: input.rawJobIds ?? [],
    validJobIds: input.validJobIds ?? [],
    declaredTotal: input.declaredTotal ?? null,
    declaredCount: null,
    declaredPages: input.declaredPages ?? null,
    nextPageSignalBefore: input.nextPageSignalBefore ?? null,
    nextPageSignalAfter: input.nextPageSignalAfter ?? null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
    termination: input.termination,
    anomalyCodes: [],
    capturedAt: input.artifact.capturedAt
  };
}

function cnstaffDeclaredCompleteness(
  total: number | undefined,
  artifactLogicalKey: string | undefined,
  extractorLocator: string | undefined
): PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  return total !== undefined && artifactLogicalKey && extractorLocator
    ? { kind: "OFFICIAL_TOTAL_COUNT", value: total, artifactLogicalKey, extractorLocator, scope: "SOURCE" }
    : undefined;
}

function cnstaffFailure(
  capturedAt: string,
  failureReason: string,
  artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[],
  fetchCounts: PersistentSourceFetchEvidence["fetchCounts"],
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"],
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"]
): SourceFetchResult {
  if (artifacts.length === 0) return failed(capturedAt, failureReason);
  const evidencePages = pages.length > 0
    ? pages.map((page, index) => index === pages.length - 1 && page.termination === "CONTINUE"
      ? { ...page, termination: "ABORTED" as const }
      : page)
    : [cnstaffPageTrace({ artifact: artifacts[0]!, sequence: 0, requestedPage: 1, termination: "FAILED" })];
  return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts,
    pages: evidencePages,
    fetchCounts,
    fetchLosses,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  }));
}

function recordCnstaffLoss(
  losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"],
  stage: "PARSE" | "VALIDATION",
  code: "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "UNSAFE_OFFICIAL_ID" |
    "DUPLICATE_OFFICIAL_ID" | "DUPLICATE_DETAIL_ID" | "OUT_OF_SCOPE" | "AMBIGUOUS_SCOPE" |
    "UNSAFE_OFFICIAL_URL" | "SENSITIVE_OUTPUT",
  rawLocator: string,
  pageSequence: number,
  recordIndex: number,
  field?: string
): void {
  if (stage === "PARSE") counts.parseDiscardCount += 1;
  else counts.validationDiscardCount += 1;
  losses.push({
    stage,
    reason: `CNStaff record rejected: ${code}`,
    rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence, recordIndex }
  });
}

function cnstaffDetailUrl(entryUrl: string, detailId: string): string {
  if (!safeOfficialJsonId(detailId)) throw new Error("CNStaff detail ID is unsafe");
  const origin = new URL(entryUrl).origin;
  const expectedPath = `/recruitment/job/detail/id/${detailId}/`;
  const url = new URL(expectedPath, origin);
  if (url.origin !== origin || url.pathname !== expectedPath || url.search || url.hash) {
    throw new Error("CNStaff detail URL failed round-trip validation");
  }
  return safeOfficialJsonEndpoint(url.toString());
}

function beisenPageTrace(input: {
  artifact: SourceFetchArtifactDraft;
  sequence: number;
  requestedPage: number;
  requestedPageSize?: number | null;
  returnedPage?: number | null;
  rawJobIds?: string[];
  validJobIds?: string[];
  declaredTotal?: number;
  nextPageSignalBefore?: string | null;
  nextPageSignalAfter?: string | null;
  termination: SourceFetchPageTrace["termination"];
}): SourceFetchPageTrace {
  return {
    sequence: input.sequence,
    artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null,
    returnedCursor: null,
    requestedOffset: null,
    returnedOffset: null,
    requestedPage: input.requestedPage,
    returnedPage: input.returnedPage ?? null,
    requestedPageSize: input.requestedPageSize ?? null,
    returnedPageSize: null,
    rawJobIds: input.rawJobIds ?? [],
    validJobIds: input.validJobIds ?? [],
    declaredTotal: input.declaredTotal ?? null,
    declaredCount: null,
    declaredPages: null,
    nextPageSignalBefore: input.nextPageSignalBefore ?? null,
    nextPageSignalAfter: input.nextPageSignalAfter ?? null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
    termination: input.termination,
    anomalyCodes: [],
    capturedAt: input.artifact.capturedAt
  };
}

function beisenDeclaredCompleteness(
  total: number | undefined,
  artifactLogicalKey: string | undefined,
  extractorLocator: string | undefined
): PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  return total !== undefined && artifactLogicalKey && extractorLocator
    ? {
        kind: "OFFICIAL_TOTAL_COUNT",
        value: total,
        artifactLogicalKey,
        extractorLocator,
        scope: "SOURCE"
      }
    : undefined;
}

function beisenFailure(
  capturedAt: string,
  failureReason: string,
  artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[],
  fetchCounts: PersistentSourceFetchEvidence["fetchCounts"],
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"],
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"],
  transportFailure?: SourceTransportFailure
): SourceFetchResult {
  if (artifacts.length === 0) {
    const result = failed(capturedAt, failureReason);
    return transportFailure ? { ...result, transportFailure } : result;
  }
  const evidencePages = pages.length > 0
    ? pages.map((page, index) => index === pages.length - 1 && page.termination === "CONTINUE"
      ? { ...page, termination: "ABORTED" as const }
      : page)
    : [beisenPageTrace({
        artifact: artifacts[0]!,
        sequence: 0,
        requestedPage: 0,
        termination: "FAILED"
      })];
  const result = failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts,
    pages: evidencePages,
    fetchCounts,
    fetchLosses,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  }));
  return transportFailure ? { ...result, transportFailure } : result;
}

function recordBeisenLoss(
  losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"],
  stage: "PARSE" | "VALIDATION",
  code: "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "DECLARED_LOCATION_FALLBACK" |
    "UNSAFE_OFFICIAL_ID" | "DUPLICATE_OFFICIAL_ID" | "DUPLICATE_DETAIL_ID" |
    "OUT_OF_SCOPE" | "AMBIGUOUS_SCOPE" | "SOCIAL_CHANNEL_MISMATCH" |
    "UNSAFE_OFFICIAL_URL" | "SENSITIVE_OUTPUT" | "DATE_INVALID" | "OUT_OF_TIME_WINDOW",
  rawLocator: string,
  pageSequence: number,
  recordIndex: number,
  field?: string
): void {
  if (stage === "PARSE") counts.parseDiscardCount += 1;
  else counts.validationDiscardCount += 1;
  losses.push({
    stage,
    reason: `Beisen Zhiye record rejected: ${code}`,
    rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence, recordIndex }
  });
}

function beisenChinaLocalDateMs(value: unknown): number | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/u.test(normalized) ? normalized : `${normalized}+08:00`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function chinaCalendarCutoffMs(capturedAt: string, days: number): number {
  const chinaOffsetMs = 8 * 60 * 60 * 1_000;
  const chinaCalendar = new Date(Date.parse(capturedAt) + chinaOffsetMs);
  const chinaMidnightUtc = Date.UTC(
    chinaCalendar.getUTCFullYear(),
    chinaCalendar.getUTCMonth(),
    chinaCalendar.getUTCDate()
  ) - chinaOffsetMs;
  return chinaMidnightUtc - days * 24 * 60 * 60 * 1_000;
}

const BEISEN_CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function beisenCanonicalOriginalUuid(value: unknown): string | undefined {
  return typeof value === "string" && BEISEN_CANONICAL_UUID.test(value) ? value : undefined;
}

type BeisenRecordScopeReview = {
  scope: "CHINA" | "OUT_OF_SCOPE" | "AMBIGUOUS";
  mainlandLocationParts: string[];
};

function officialJsonChinaRecordScope(
  country: string | undefined,
  locationRaw: string,
  geographyScope?: "DOMESTIC_OFFICIAL_TENANT"
): "CHINA" | "OUT_OF_SCOPE" | "AMBIGUOUS" {
  const normalizedCountry = country?.normalize("NFKC").trim().toLowerCase();
  const countryChina = normalizedCountry !== undefined &&
    /^(?:china|prc|mainland china|china mainland|people'?s republic of china|中国|中国大陆|中华人民共和国)$/iu.test(
      normalizedCountry
    );
  const countryForeign = normalizedCountry !== undefined && beisenHasForeignMarker(normalizedCountry);
  const locationChina = explicitlyChina(locationRaw);
  const locationForeign = beisenHasForeignMarker(locationRaw);
  if ((countryChina || locationChina) && (countryForeign || locationForeign)) return "AMBIGUOUS";
  if (geographyScope === "DOMESTIC_OFFICIAL_TENANT") {
    if (countryForeign || locationForeign) return "OUT_OF_SCOPE";
    if (countryChina) return "CHINA";
    if (country !== undefined && !countryChina) return "AMBIGUOUS";
    return cnstaffHasMainlandGeography(locationRaw) ? "CHINA" : "AMBIGUOUS";
  }
  if (country !== undefined) return countryChina ? "CHINA" : "OUT_OF_SCOPE";
  return locationChina ? "CHINA" : "OUT_OF_SCOPE";
}

function beisenDomesticRecordScopeReview(
  country: string | undefined,
  locationParts: readonly string[],
  locationRaw: string,
  geographyScope?: "DOMESTIC_OFFICIAL_TENANT",
  mixedLocationPolicy?:
    | "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES"
    | "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS"
): BeisenRecordScopeReview {
  const normalizedCountry = country?.normalize("NFKC").trim().toLowerCase();
  const countryChina = normalizedCountry !== undefined &&
    /^(?:china|prc|mainland china|china mainland|people'?s republic of china|中国|中国大陆|中华人民共和国)$/iu.test(
      normalizedCountry
    );
  const rawSegments = beisenLocationSegments(locationParts);
  const inheritedSegments = mixedLocationPolicy === "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS"
    ? beisenInheritMainlandParentForSiblingLocations(rawSegments)
    : undefined;
  const segments = inheritedSegments ?? rawSegments;
  const mainlandSegments = segments.filter(beisenIsMainlandLocationSegment);
  const mainlandPlaces = mainlandSegments.filter((segment) => !beisenIsMainlandCountrySegment(segment));
  const mainlandLocationParts = mainlandPlaces.length > 0 ? mainlandPlaces : mainlandSegments;

  if (geographyScope === "DOMESTIC_OFFICIAL_TENANT") {
    if (normalizedCountry !== undefined && !countryChina) {
      return {
        scope: beisenHasForeignMarker(normalizedCountry) ? "OUT_OF_SCOPE" : "AMBIGUOUS",
        mainlandLocationParts
      };
    }
    if (segments.length === 0) return { scope: "AMBIGUOUS", mainlandLocationParts };

    const japanSegments = segments.filter(beisenIsExplicitJapanLocationSegment);
    const invalidSegments = segments.filter((segment) =>
      !beisenIsMainlandLocationSegment(segment) && !beisenIsExplicitJapanLocationSegment(segment)
    );
    if (invalidSegments.length > 0) {
      const knownForeign = invalidSegments.some(beisenHasForeignMarker);
      return {
        scope: countryChina && mainlandSegments.length > 0
          ? "AMBIGUOUS"
          : knownForeign ? "OUT_OF_SCOPE" : "AMBIGUOUS",
        mainlandLocationParts
      };
    }
    if (japanSegments.length > 0) {
      const allowJapanAlternative = mixedLocationPolicy === "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES" &&
        mainlandPlaces.length > 0 && mainlandSegments.length + japanSegments.length === segments.length;
      return {
        scope: allowJapanAlternative ? "CHINA" : "OUT_OF_SCOPE",
        mainlandLocationParts
      };
    }
    return {
      scope: mainlandSegments.length === segments.length && mainlandSegments.length > 0 ? "CHINA" : "AMBIGUOUS",
      mainlandLocationParts
    };
  }

  const countryForeign = normalizedCountry !== undefined && beisenHasForeignMarker(normalizedCountry);
  const locationChina = explicitlyChina(locationRaw);
  const locationForeign = beisenHasForeignMarker(locationRaw);
  const scope = (countryChina || locationChina) && (countryForeign || locationForeign)
    ? "AMBIGUOUS"
    : country !== undefined
      ? countryChina ? "CHINA" : "OUT_OF_SCOPE"
      : locationChina ? "CHINA" : "OUT_OF_SCOPE";
  return { scope, mainlandLocationParts };
}

function beisenInheritMainlandParentForSiblingLocations(
  segments: readonly string[]
): string[] | undefined {
  if (segments.length < 2 || segments.some(beisenHasForeignMarker)) return undefined;
  const firstParts = segments[0]!.split(/[·・]/u).map((part) => part.trim()).filter(Boolean);
  if (firstParts.length !== 2 || !beisenHasExplicitMainlandHierarchy(segments[0]!)) return undefined;
  const parent = firstParts[0]!;
  const inherited = [segments[0]!];
  for (const segment of segments.slice(1)) {
    if (segment.includes("·") || segment.includes("・") ||
      !/^[\p{Script=Han}]{1,24}(?:区|县|旗|市|镇|乡|街道|新区|开发区|高新区|工业园|园区)$/u.test(segment)) {
      return undefined;
    }
    const expanded = `${parent}·${segment}`;
    if (!beisenHasExplicitMainlandHierarchy(expanded)) return undefined;
    inherited.push(expanded);
  }
  return inherited;
}

const BEISEN_DOMESTIC_SCOPE_WORDS = new Set([
  "中华人民共和国", "中国大陆", "大陆地区", "中国境内", "全国各地", "全国", "国内", "境内",
  "china", "prc", "mainland china", "china mainland", "people's republic of china", "people’s republic of china"
]);

const BEISEN_MAINLAND_ENGLISH_LOCATIONS = new Set([
  "anhui", "beijing", "changchun", "changsha", "chengdu", "chongqing", "dalian", "dongguan",
  "foshan", "fujian", "fuzhou", "gansu", "guangdong", "guangxi", "guangzhou", "guizhou",
  "haikou", "hainan", "hangzhou", "harbin", "hebei", "hefei", "heilongjiang", "henan",
  "hohhot", "hubei", "hunan", "inner mongolia", "jiangsu", "jiangxi", "jinan", "jilin",
  "kunming", "lanzhou", "liaoning", "nanchang", "nanjing", "nanning", "nantong", "ningbo",
  "ningxia", "qingdao", "qinghai", "shaanxi", "shandong", "shanghai", "shanxi", "shenyang",
  "shenzhen", "shijiazhuang", "sichuan", "suzhou", "taiyuan", "tianjin", "urumqi", "wenzhou",
  "wuhan", "wuxi", "xiamen", "xi'an", "xian", "xinjiang", "xizang", "yunnan", "zhengzhou",
  "zhejiang", "zhuhai"
]);

const BEISEN_EXPLICIT_JAPAN_LOCATIONS = new Set([
  "日本", "东京", "東京", "大阪", "京都", "横滨", "横浜", "名古屋", "神户", "神戸", "福冈", "福岡",
  "japan", "tokyo", "osaka", "kyoto", "yokohama", "nagoya", "kobe", "fukuoka"
]);

const BEISEN_MAINLAND_COUNTY_LEVEL_CITIES = new Set(["诸城"]);

function beisenLocationSegments(locationParts: readonly string[]): string[] {
  return locationParts.flatMap((part) => part.normalize("NFKC")
    .split(/[,，;；/／|｜、()（）\r\n]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean));
}

function beisenIsMainlandCountrySegment(value: string): boolean {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return /^(?:中华人民共和国|中国大陆|中国境内|中国|china|prc|mainland china|china mainland|people['’]?s republic of china)$/iu.test(
    normalized
  );
}

function beisenIsMainlandLocationSegment(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  if (beisenHasForeignMarker(normalized)) return false;
  const lower = normalized.toLowerCase();
  if (BEISEN_DOMESTIC_SCOPE_WORDS.has(lower) || BEISEN_DOMESTIC_SCOPE_WORDS.has(normalized)) return true;
  const englishCore = lower.replace(/\s+(?:city|province|municipality|autonomous region)$/u, "").trim();
  if (BEISEN_MAINLAND_ENGLISH_LOCATIONS.has(englishCore)) return true;

  const compact = normalized.replace(/[·・]/gu, "");
  const stripped = compact.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|地区|盟|省|市)$/u, "");
  return beisenHasExplicitMainlandHierarchy(normalized) ||
    CNSTAFF_MAINLAND_PROVINCES.has(compact) || CNSTAFF_MAINLAND_PROVINCES.has(stripped) ||
    CNSTAFF_MAINLAND_PREFECTURES.has(compact) || CNSTAFF_MAINLAND_PREFECTURES.has(stripped) ||
    BEISEN_MAINLAND_COUNTY_LEVEL_CITIES.has(stripped) ||
    cnstaffHasMunicipalityAdministrativeGeography(compact) || cnstaffHasChainedMainlandGeography(compact) ||
    cnstaffHasPrefectureAdministrativeGeography(compact);
}

function beisenHasExplicitMainlandHierarchy(value: string): boolean {
  const parts = value.split(/[·・]/u).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.some(beisenHasForeignMarker)) return false;
  const province = parts[0]!;
  const strippedProvince = province.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/u, "");
  if (!CNSTAFF_MAINLAND_PROVINCES.has(province) && !CNSTAFF_MAINLAND_PROVINCES.has(strippedProvince)) return false;
  return parts.slice(1).every((part) =>
    /^[\p{Script=Han}]{1,24}(?:自治州|地区|盟|市|区|县|旗|镇|乡|街道|新区|开发区|高新区|工业园|园区|湖)$/u.test(part));
}

function beisenIsExplicitJapanLocationSegment(value: string): boolean {
  const pieces = value.normalize("NFKC").split(/[·・]/u).map((part) => part.trim()).filter(Boolean);
  return pieces.length > 0 && pieces.every((piece) => {
    const normalized = piece.toLowerCase();
    const withoutAdministrativeSuffix = normalized.replace(/(?:都|道|府|県|县|市)$/u, "");
    return BEISEN_EXPLICIT_JAPAN_LOCATIONS.has(normalized) ||
      BEISEN_EXPLICIT_JAPAN_LOCATIONS.has(withoutAdministrativeSuffix);
  });
}

function beisenSourceBoundLocationCorrection(
  config: Extract<OfficialJsonFetchConfig, { kind: "beisen-zhiye-2022" }>,
  raw: Record<string, unknown>,
  officialId: string | undefined,
  title: string | undefined,
  locationParts: string[],
  locationRaw: string | undefined
): { locationParts: string[]; locationRaw: string | undefined } {
  const exactHomograph = config.scopeExclusionProof === "THREESBIO_XIANYANG_HOMOGRAPH_V1" &&
    officialId === "3074600c-a1bb-4f66-80e4-93f08a71bf44" &&
    title === "(高级)医学信息沟通专员-TBU专岗-(咸阳)(J16744)" &&
    Array.isArray(raw.LocNames) && raw.LocNames.length === 1 &&
    raw.LocNames[0] === "韩国·庆尚南道·咸阳郡" &&
    locationParts.length === 1 && locationRaw === "韩国·庆尚南道·咸阳郡" &&
    stringValue(raw.Country) === undefined && stringValue(raw.CountryName) === undefined;
  return exactHomograph
    ? { locationParts: ["咸阳"], locationRaw: "咸阳" }
    : { locationParts, locationRaw };
}

function beisenHasForeignMarker(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();
  return /(?:港澳台|香港|九龙|澳门|台湾|台北|高雄|国外|海外|韩国|首尔|美国|纽约|波士顿|新加坡|日本|东京|印度|德国|法国|加拿大|澳大利亚|英国|伦敦)|\b(?:hong kong|kowloon|macao|macau|taiwan|taipei|kaohsiung|south korea|seoul|overseas|abroad|united states|usa|u\.s\.|boston|new york|singapore|japan|tokyo|india|germany|france|canada|australia|united kingdom|london)\b/u.test(
    normalized
  );
}

function beisenSocialChannelMismatch(
  raw: Record<string, unknown>,
  requestedCategory: string
): "Category" | "CategoryId" | "Kind" | undefined {
  if (stringValue(raw.Category) !== "社会招聘") return "Category";
  if (hasOwn(raw, "CategoryId") && String(raw.CategoryId).trim() !== requestedCategory) return "CategoryId";
  const kind = stringValue(raw.Kind);
  if (kind && /(?:校园|校招|campus)/iu.test(kind)) return "Kind";
  return undefined;
}

function beisenZhiyeDetailUrl(
  entryUrl: string,
  detailPath: string | undefined,
  sourceJobId: string
): string {
  const origin = new URL(entryUrl).origin;
  const normalizedDetailPath = (detailPath ?? "social/detail").replace(/^\/+/, "");
  const detailSegments = normalizedDetailPath.split("/");
  if (!normalizedDetailPath ||
    detailSegments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment) || segment === "." || segment === "..") ||
    sensitiveOfficialJsonField({ detailPath: normalizedDetailPath })) {
    throw new Error("Beisen detail path is invalid");
  }
  const url = new URL(`/${normalizedDetailPath}`, origin);
  url.searchParams.set("jobAdId", sourceJobId);
  const safe = safeOfficialJsonEndpoint(url.toString());
  if (new URL(safe).origin !== origin) throw new Error("Beisen detail origin mismatch");
  return safe;
}

function citiesFromBeisenLocation(locationParts: readonly string[]): string[] {
  const cities = locationParts.flatMap((location) => {
    const segments = location
      .split(/[/,，;；、]/u)
      .map((segment) => segment.trim())
      .filter(Boolean);

    return segments.flatMap((segment) => {
      const hierarchy = segment
        .split("·")
        .map((part) => part.trim())
        .filter(Boolean);
      return hierarchy.at(-1) ?? segment;
    });
  });

  if (cities.length > 0) {
    return [...new Set(cities)];
  }

  return [...new Set(locationParts.flatMap(citiesFromLocation))];
}

function normalizePhenomWidgetJob(
  config: Extract<OfficialJsonFetchConfig, { kind: "phenom" }>,
  job: unknown
): NormalizedOfficialJsonJob[] {
  if (!isObject(job)) {
    return [];
  }

  const country = stringValue(job.country);
  const locationRaw =
    stringValue(job.location) ??
    stringValue(job.cityStateCountry) ??
    firstString(job.multi_location) ??
    stringValue(job.city);
  if (country !== "China" && !locationRaw?.includes("China")) {
    return [];
  }

  const sourceJobId =
    stringValue(job.jobSeqNo) ?? stringValue(job.reqId) ?? stringValue(job.jobId);
  const title = stringValue(job.title);
  if (!sourceJobId || !title || !locationRaw) {
    return [];
  }

  const applyUrl = stringValue(job.applyUrl);
  const city = stringValue(job.city);
  return [
    {
      sourceJobId,
      title,
      officialUrl: applyUrl || `${config.detailBaseUrl}/${sourceJobId}`,
      locationRaw,
      cities: citiesWithFallback(`${city ?? ""} ${locationRaw}`, city ?? locationRaw)
    }
  ];
}

function normalizePhenomJob(
  config: Extract<OfficialJsonFetchConfig, { kind: "phenom" }>,
  job: unknown
): NormalizedOfficialJsonJob[] {
  if (!isObject(job)) {
    return [];
  }

  const country = stringValue(job.country);
  const locationRaw = stringValue(job.location);
  if (country !== "China" && !locationRaw?.includes("China")) {
    return [];
  }

  const sourceJobId = stringValue(job.jobSeqNo) ?? stringValue(job.reqId);
  const title = stringValue(job.title);
  if (!sourceJobId || !title || !locationRaw) {
    return [];
  }

  const applyUrl = stringValue(job.applyUrl);
  const city = stringValue(job.city);
  return [
    {
      sourceJobId,
      title,
      officialUrl: applyUrl || `${config.detailBaseUrl}/${sourceJobId}`,
      locationRaw,
      cities: citiesWithFallback(locationRaw, city ?? locationRaw)
    }
  ];
}

function extractPhenomRefineSearch(body: string): { data?: Record<string, unknown> } {
  const marker = '"eagerLoadRefineSearch":';
  const markerIndex = body.indexOf(marker);
  if (markerIndex < 0) {
    return {};
  }

  const start = body.indexOf("{", markerIndex + marker.length);
  if (start < 0) {
    return {};
  }

  const json = balancedJsonObject(body, start);
  return json ? (JSON.parse(json) as { data?: Record<string, unknown> }) : {};
}

function balancedJsonObject(input: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function createDefaultHttpClient(now: () => Date): OfficialJsonHttpClient {
  return async (request) => {
    const response = await fetchWithOfficialTimeout(request.url, {
      headers: request.headers,
      method: request.method ?? "GET",
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: "follow"
    });
    const body = await response.text();
    const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
    return {
      status: response.status,
      body,
      setCookie: responseHeaders.getSetCookie?.() ?? cookieHeaderValues(response.headers.get("set-cookie")),
      finalUrl: response.url,
      ...(response.headers.get("content-type")
        ? { contentType: response.headers.get("content-type")! }
        : {}),
      capturedAt: now().toISOString()
    };
  };
}

function redseaHtmlHeaders(): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
  };
}

function redseaChannelEntryUrl(origin: string, channelQrId: string): string {
  return new URL(
    `/RedseaPlatform/zhaopin/zpChannelQrCode/${channelQrId}/officeWebsite.mob`,
    origin
  ).toString();
}

function absorbCookies(cookieJar: Map<string, string>, cookies: readonly string[] | undefined): void {
  for (const cookie of cookies ?? []) {
    const [pair] = cookie.split(";");
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator <= 0) {
      continue;
    }
    cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(cookieJar: ReadonlyMap<string, string>): string {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function cookieHeaderValues(value: string | null): string[] {
  return value ? [value] : [];
}

function citiesFromLocation(locationRaw: string): string[] {
  const lowerLocation = locationRaw.toLowerCase();
  const cities = CITY_MATCHES.flatMap(([needle, city]) =>
    lowerLocation.includes(needle.toLowerCase()) ? [city] : []
  );

  return [...new Set(cities)];
}

function citiesWithFallback(locationRaw: string, fallbackLocation: string): string[] {
  const mappedCities = citiesFromLocation(locationRaw);
  if (mappedCities.length > 0) {
    return mappedCities;
  }

  const fallbackCity = firstLocationSegment(fallbackLocation);
  return fallbackCity ? [fallbackCity] : [];
}

function firstLocationSegment(locationRaw: string): string | undefined {
  return locationRaw
    .split(/[,，;；、/]/u)
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0 && segment.toLowerCase() !== "china");
}

function failed(
  capturedAt: string,
  failureReason: string,
  transportFailure?: SourceTransportFailure
): Extract<SourceFetchResult, { ok: false }> {
  return {
    ok: false,
    capturedAt,
    failureReason,
    ...(transportFailure ? { transportFailure } : {})
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.map(stringValue).find(Boolean) : undefined;
}

function stringsValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(stringValue).filter((item): item is string => Boolean(item));
  }

  const string = stringValue(value);
  return string ? [string] : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
