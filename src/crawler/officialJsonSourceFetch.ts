import type { SourceFetchFunction, SourceFetchResult, SourceTransportAttempt } from "./runSourceCrawl";
import { load as loadHtml } from "cheerio";
import { parse as parseJavaScript, parseExpression } from "@babel/parser";
import type { ObjectExpression } from "@babel/types";
import {
  assertOfficialHtmlMime,
  assertOfficialJsonEvidenceResponse,
  assertOfficialJsonMime,
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

export type OfficialJsonFetchConfig =
  | {
      kind: "innovent";
      endpointUrl: string;
    }
  | {
      kind: "novo-nordisk";
      endpointUrl: string;
    }
  | {
      kind: "phenom";
      detailBaseUrl: string;
      countryFilter?: string;
      allowedApplyOrigins?: string[];
      facetScope?: {
        countryIncludeDescriptor: string;
        categoryExcludeDescriptors: string[];
      };
      pageSize?: number;
      maxPages?: number;
    }
  | {
      kind: "beisen-zhiye-2022";
      category?: string;
      pageSize?: number;
      maxPages?: number;
      detailPath?: string;
      displayFields?: string[];
      defaultLocationRaw?: string;
      geographyScope?: "DOMESTIC_OFFICIAL_TENANT";
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
      kind: "sandoz-jsonapi";
      endpointUrl: string;
      countryTermName: string;
      pageSize?: number;
      maxPages?: number;
      detailBaseUrl: string;
    }
  | {
      kind: "redsea-zp-channel";
      channelQrIds: string[];
      rootId: string;
      sortName?: string;
    }
  | {
      kind: "xiuzheng-job-list";
      endpointUrl: string;
      detailBaseUrl: string;
      pageSize?: number;
      maxPages?: number;
    };

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
  ["Jiangsu", "江苏"],
  ["上海", "上海"],
  ["北京", "北京"],
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
  ["兰州", "兰州"]
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

      if (plan.officialJsonFetch.kind === "sandoz-jsonapi") {
        return finish(await fetchSandozJsonApi({
          http,
          config: plan.officialJsonFetch,
          entryUrl: plan.source.officialEntryUrl,
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

      return finish(await fetchSingleResponseOfficialJson({
        http,
        config: plan.officialJsonFetch,
        entryUrl: plan.source.officialEntryUrl,
        capturedAt,
        now
      }));
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
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
    const canonical = deriveCanonicalPaginationEvidence({
      evidence: enriched,
      expectedChannelIds,
      filteredOutput: true,
      allowMissingReturnedPage
    });
    return {
      evidence: canonical,
      evaluation: evaluatePaginationEvidence({
        evidence: canonical,
        expectedChannelIds,
        filteredOutput: true,
        allowMissingReturnedPage
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
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "innovent" | "novo-nordisk" }>;
  entryUrl: string;
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
  } catch {
    return failed(capturedAt, "Official JSON TRANSPORT_FAILURE");
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
    return failedWithEvidence(
      capturedAt,
      `Official JSON source returned HTTP ${response.status}`,
      finalizeOfficialJsonFailureEvidence(failureState)
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
      cities: citiesFromLocation(city ?? officialLocation)
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
  const countryEntries = [...new URL(endpoint).searchParams.entries()].filter(([key]) =>
    key.normalize("NFKC").toLowerCase() === "country"
  );
  return countryEntries.length === 1 && countryEntries[0]![0] === "country" &&
    countryEntries[0]![1] === "China Mainland";
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
  fetchEvidence: NonNullable<Extract<SourceFetchResult, { ok: false }>["fetchEvidence"]>
): SourceFetchResult {
  return { ok: false, capturedAt, failureReason, fetchEvidence };
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
    channels = [...config.channelQrIds];
    if (channels.length === 0 || new Set(channels).size !== channels.length ||
      channels.some((id) => !safeOfficialJsonId(id)) || !safeOfficialJsonId(config.rootId) ||
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
      body: new URLSearchParams({
        channelQrId,
        sortName,
        peopleId: "",
        root_id: config.rootId,
        shareStaff: "",
        push_request_id: "",
        keyword: "",
        ftl_list_stru_id: ""
      }).toString()
    }); } catch { return redseaFailure(capturedAt, "Redsea API transport failed", artifacts, pages, counts, losses); }
    let apiArtifactResult: ReturnType<typeof redseaArtifact>;
    try { apiArtifactResult = redseaArtifact(channelQrId, "api", "PAGINATION_PAGE", apiUrl, listResponse); }
    catch { return redseaFailure(capturedAt, "Redsea API response is invalid", artifacts, pages, counts, losses); }
    artifacts.push(apiArtifactResult.artifact);
    let terminal: SourceFetchPageTrace["termination"] = "ABORTED";
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
    pages.push(redseaPageTrace(apiArtifactResult.artifact, channelIndex, channelQrId, rawIds, validIds, terminal, repeatedResponse));
  }
  const finalized = finalizeOfficialJsonEvidenceBundle({ artifacts, pages, fetchCounts: counts, fetchLosses: losses, expectedChannelIds: channels });
  return {
    ok: true,
    capturedAt,
    payload: { jobs },
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
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
    let response: OfficialJsonHttpResponse;
    try { response = await http({ url: config.endpointUrl, method: "POST", headers: {
      Accept: "application/json", "Content-Type": "application/json", Referer: safeEntryUrl,
      "User-Agent": "job-search-crawler/0.1"
    }, body: JSON.stringify({ page, pageSize }) }); }
    catch { return xiuzhengFailure(capturedAt, "Xiuzheng job-list transport failed", artifacts, pages, counts, losses, xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact)); }
    const redaction = redactXiuzhengSensitiveBody(response.body, response.setCookie);
    const safeResponse = { ...response, body: redaction.body };
    const logicalKey = `xiuzheng-page-${String(page).padStart(4, "0")}`;
    let artifact: SourceFetchArtifactDraft;
    try {
      artifact = officialJsonNetworkArtifact({ id: logicalKey, logicalKey, kind: "PAGINATION_PAGE",
        requestedUrl: config.endpointUrl, response: safeResponse,
        extractorLocator: xiuzhengLocator(page, pageSize),
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
      parsed.rawJobs.length < pageSize ? "ABORTED" :
      page < (parsed.lastPage ?? Number.POSITIVE_INFINITY) ? "CONTINUE" : "ABORTED";
    pages.push(xiuzhengPageTrace({ artifact, sequence: page - 1, requestedPage: page, parsed, rawIds, validIds, termination: terminal }));
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
  const finalized = finalizeOfficialJsonEvidenceBundle({ artifacts, pages, fetchCounts: counts, fetchLosses: losses,
    ...(xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact) ? { declaredCompleteness: xiuzhengDeclaredCompleteness(declarations?.total, declaredArtifact)! } : {}) });
  return {
    ok: true, capturedAt, payload: { jobs }, completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(declarations?.total === undefined ? {} : { expectedJobCount: declarations.total }),
      completenessEvidenceKind: declarations?.total === undefined ? "WEAK_MANUAL_SAMPLE" : "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: safeEntryUrl,
      completenessBlockerReason: "Xiuzheng pagination and China scope require independent manual review",
      ...(declarations?.lastPage === undefined ? {} : { totalPages: declarations.lastPage }), pageSize, pagesVisited: pages.length
    }, fetchEvidence: finalized.evidence, paginationEvaluation: finalized.evaluation
  };
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
  if (directResult.ok || !browserFetch) return directResult;

  const priorTransportAttempts: readonly SourceTransportAttempt[] = [{
    transport: "DIRECT_HTTP",
    outcome: "FAILED",
    code: "HCM_DIRECT_FAILED",
    capturedAt: directResult.capturedAt,
    ...(directResult.fetchEvidence ? { fetchEvidence: directResult.fetchEvidence } : {}),
    ...(directResult.paginationEvaluation ? { paginationEvaluation: directResult.paginationEvaluation } : {})
  }];
  let session: HcmCloudBrowserSession | undefined;
  try {
    session = await browserFetch({ config, entryUrl: safeEntryUrl, capturedAt });
    assertHcmCloudBrowserSession(session);
  } catch {
    return { ok: false, capturedAt, failureReason: "HCMCloud browser session failed", priorTransportAttempts };
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
      return { ...failure, priorTransportAttempts };
    }
    const browserResult = await fetchHcmCloudWithPost({
      config, entryUrl: safeEntryUrl, entryEvidenceUrl, origin: entry.origin, capturedAt, now,
      post: session.post,
      initialArtifacts: [entryArtifact],
      initialCapturedAtMs: Date.parse(session.entryResponse.capturedAt!),
      artifactPrefix: "browser-"
    });
    if (browserResult.ok) return { ...browserResult, priorTransportAttempts };
    const code = browserResult.fetchEvidence?.pages.length ||
      browserResult.fetchEvidence?.supportingArtifactOnlyFailure?.code === "HCM_LIST_RESPONSE_FAILED"
      ? "HCM_BROWSER_LIST_FAILED" as const
      : "HCM_BROWSER_COUNT_FAILED" as const;
    return {
      ...browserResult,
      failureReason: code === "HCM_BROWSER_LIST_FAILED"
        ? "HCMCloud browser list failed"
        : "HCMCloud browser count failed",
      priorTransportAttempts
    };
  } catch {
    const failure = hcmCloudBrowserEntryFailure(capturedAt, entryArtifact);
    return { ...failure, priorTransportAttempts };
  } finally {
    try { await session.close(); } catch { /* cleanup failures are non-evidence operational details */ }
  }
}

async function fetchSandozJsonApi({
  http,
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  const pageSize = config.pageSize ?? 10;
  const maxPages = config.maxPages ?? 50;
  let endpoint: URL;
  let safeEntryUrl: string;
  let detailBase: URL;
  try {
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0 ||
        !Number.isSafeInteger(maxPages) || maxPages <= 0 ||
        config.countryTermName !== "LOC_CN") throw new Error("invalid limits or country term");
    safeEntryUrl = safeOfficialJsonEndpoint(entryUrl);
    endpoint = sandozEndpoint(config.endpointUrl);
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
  const seen = new Map<string, string>();
  const seenResourceIds = new Map<string, string>();
  let declaredTotal: number | undefined;
  let declaredArtifactKey: string | undefined;
  let previousNext: string | null = null;
  let previousCapturedAtMs = Date.parse(capturedAt);
  let bearerToken: string | undefined;
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

  for (let page = 0; page < maxPages; page += 1) {
    const url = sandozJsonApiUrl(endpoint.toString(), page);
    let response: OfficialJsonHttpResponse;
    try { response = await http({ url, method: "GET", headers: {
      Accept: "application/vnd.api+json,application/json", Referer: safeEntryUrl,
      ...(bearerToken ? { Authorization: ["Bearer", bearerToken].join(" ") } : {}), "User-Agent": "job-search-crawler/0.1"
    }}); } catch {
      return sandozFailure(capturedAt, "Sandoz JSONAPI transport failed", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    try { assertOfficialJsonEvidenceResponse(response, { requestedUrl: url, crawlStartedAtMs: Date.parse(capturedAt), observedNowMs: now().getTime() }); }
    catch { return sandozFailure(capturedAt, "Sandoz JSONAPI response metadata is invalid", artifacts, pages, counts, losses,
      sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey)); }
    const apiRedaction = redactSandozSensitiveBody(response.body, response.setCookie);
    const artifactId = `sandoz-page-${String(page).padStart(4, "0")}`;
    const artifact = officialJsonNetworkArtifact({ id: artifactId, logicalKey: artifactId, kind: "PAGINATION_PAGE",
      requestedUrl: url, response: { ...response, body: apiRedaction.body }, extractorLocator: sandozLocator(page, pageSize, false),
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
    let root: unknown;
    try { root = JSON.parse(response.body); } catch {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI response is not valid JSON", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    if (!hasUniqueJsonObjectKeys(response.body) || !isStrictRecord(root) || !Array.isArray(root.data)) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI response schema is invalid", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    const meta = hasOwn(root, "meta") ? root.meta : undefined;
    const links = hasOwn(root, "links") ? root.links : undefined;
    if ((meta !== undefined && !isStrictRecord(meta)) || (links !== undefined && !isStrictRecord(links))) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI response schema is invalid", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    const pageTotal = meta && hasOwn(meta, "count") ? meta.count : undefined;
    if (pageTotal !== undefined && !isNonnegativeInteger(pageTotal)) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI count declaration is invalid", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    artifact.extractorLocator = sandozLocator(page, pageSize, true);
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let index = 0; index < root.data.length; index += 1) {
      const raw = root.data[index]; counts.rawCount += 1;
      const rawId = isStrictRecord(raw) ? stringValue(raw.id) ?? (isStrictRecord(raw.attributes) ? stringValue(raw.attributes.field_job_id) : undefined) : undefined;
      const evidenceId = irreversibleOfficialJsonEvidenceId(rawId ?? raw);
      if (!rawIds.includes(evidenceId)) rawIds.push(evidenceId);
      const locator = `${artifact.logicalKey}#record:${index}#${irreversibleOfficialJsonEvidenceId([index, raw])}`;
      if (!isStrictRecord(raw)) { recordSandozLoss(losses, counts, "PARSE", "NON_OBJECT_RECORD", locator, page, index); continue; }
      counts.parsedCount += 1;
      const parsed = parseSandozResource(config, detailBase, raw);
      if (!parsed.ok) { recordSandozLoss(losses, counts, "VALIDATION", parsed.code, locator, page, index, parsed.field); continue; }
      const signature = irreversibleOfficialJsonEvidenceId(parsed.job);
      const prior = seen.get(parsed.officialId) ?? seenResourceIds.get(parsed.resourceId);
      if (prior !== undefined) { recordSandozLoss(losses, counts, "VALIDATION", prior === signature ? "DUPLICATE_OFFICIAL_ID" : "CONFLICTING_OFFICIAL_ID", locator, page, index, "id"); continue; }
      seen.set(parsed.officialId, signature); seenResourceIds.set(parsed.resourceId, signature);
      jobs.push(parsed.job); validIds.push(persistentOfficialJsonJobId(parsed.officialId)); counts.validCount += 1;
    }
    if (declaredTotal !== undefined && pageTotal !== undefined && pageTotal !== declaredTotal) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page, rawJobIds: rawIds,
        validJobIds: validIds, declaredTotal: pageTotal, termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI count declaration changed", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    if (declaredTotal === undefined && pageTotal !== undefined) { declaredTotal = pageTotal; declaredArtifactKey = artifact.logicalKey; }
    const rawNext = links && hasOwn(links, "next") ? links.next : undefined;
    let next: string | null;
    try { next = sandozCanonicalNext(rawNext, endpoint, page, pageSize); }
    catch {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page, rawJobIds: rawIds,
        validJobIds: validIds, ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }), termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI next-page declaration is invalid", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    const contradiction = root.data.length > pageSize ||
      (declaredTotal !== undefined && counts.rawCount > declaredTotal) ||
      (declaredTotal === 0 && root.data.length > 0) ||
      (next === null && declaredTotal !== undefined && counts.rawCount !== declaredTotal) ||
      (next !== null && declaredTotal !== undefined && counts.rawCount >= declaredTotal);
    if (contradiction) {
      pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page, rawJobIds: rawIds,
        validJobIds: validIds, ...(declaredTotal === undefined ? {} : { declaredTotal }), termination: "FAILED" }));
      return sandozFailure(capturedAt, "Sandoz JSONAPI declarations contradict observed resources", artifacts, pages, counts, losses,
        sandozDeclaredCompleteness(declaredTotal, declaredArtifactKey));
    }
    const atMax = page + 1 === maxPages;
    const termination: SourceFetchPageTrace["termination"] =
      root.data.length === 0 && page === 0 && declaredTotal === 0 && next === null ? "EMPTY_PAGE" :
      next !== null ? atMax ? "MAX_PAGE_LIMIT" : "CONTINUE" :
      declaredTotal === undefined && root.data.length >= pageSize ? "ABORTED" : "NEXT_ABSENT";
    pages.push(sandozPageTrace({ artifact, sequence: page, requestedPage: page, returnedPage: page, rawJobIds: rawIds,
      validJobIds: validIds, ...(declaredTotal === undefined ? {} : { declaredTotal }),
      nextPageSignalBefore: previousNext, nextPageSignalAfter: next, termination }));
    previousNext = next;
    if (next === null || atMax) break;
  }
  let finalized: ReturnType<typeof finalizeOfficialJsonEvidenceBundle>;
  try { finalized = finalizeOfficialJsonEvidenceBundle({ artifacts, pages, fetchCounts: counts, fetchLosses: losses,
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
      completenessBlockerReason: "Sandoz JSON:API evidence remains manual until downstream adapter loss accounting is complete",
      totalPages: pages.length, pageSize, pagesVisited: pages.length },
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
    } catch {
      return jobsynFailure(capturedAt, "Jobsyn Solr transport failed", artifacts, pages, counts, losses,
        jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
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
      pages.push(jobsynPageTrace({ artifact, sequence: page - 1, requestedPage: page, termination: "FAILED" }));
      return jobsynFailure(capturedAt, `Jobsyn Solr API returned HTTP ${response.status}`, artifacts, pages, counts,
        losses, jobsynDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
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
      const scope = beisenRecordScope(stringValue(raw.country_exact) ?? stringValue(raw.country_short_exact), location);
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
      assertOfficialJsonMime(response);
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
        body: JSON.stringify({
          PageIndex: pageIndex,
          PageSize: pageSize,
          Category: [category],
          KeyWords: "",
          SpecialType: 0,
          PortalId: "",
          DisplayFields: displayFields
        })
      });
    } catch {
      return beisenFailure(
        capturedAt,
        "Beisen Zhiye API TRANSPORT_FAILURE",
        artifacts,
        pages,
        counts,
        losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator)
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
    const unavailableLocator = beisenLocator({ pageIndex, pageSize, category, hasCount: false, hasData: false });
    const artifact = officialJsonNetworkArtifact({
      id: artifactId,
      logicalKey: artifactId,
      kind: "PAGINATION_PAGE",
      requestedUrl: endpointUrl,
      response,
      extractorLocator: unavailableLocator
    });
    artifacts.push(artifact);
    if (response.status < 200 || response.status >= 300) {
      pages.push(beisenPageTrace({ artifact, sequence: pageIndex, requestedPage: pageIndex, termination: "FAILED" }));
      return beisenFailure(capturedAt, `Beisen Zhiye API returned HTTP ${response.status}`,
        artifacts, pages, counts, losses,
        beisenDeclaredCompleteness(declaredTotal, declaredArtifactKey, declaredLocator));
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
    const locator = beisenLocator({ pageIndex, pageSize, category, hasCount: pageTotal !== undefined, hasData: true });
    artifact.extractorLocator = locator;
    if (declaredTotal === undefined && pageTotal !== undefined) {
      declaredTotal = pageTotal;
      declaredArtifactKey = artifact.logicalKey;
      declaredLocator = locator;
    }

    const rawJobs = root.Data as unknown[];
    const rawIds: string[] = rawJobs.map((raw) => {
      const rawOfficialId = isStrictRecord(raw)
        ? stringValue(raw.Id) ?? stringValue(raw.JobAdId)
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
      const officialId = stringValue(raw.Id) ?? stringValue(raw.JobAdId);
      const detailId = stringValue(raw.JobAdId) ?? officialId;
      const title = stringValue(raw.JobAdName);
      const locationParts = stringsValue(raw.LocNames);
      const locationRaw = locationParts.join(" / ") || stringValue(raw.LocName) ||
        stringValue(raw.LocationName) || stringValue(raw.City);
      if (!officialId || !detailId || !title) {
        const missing = !officialId ? "id" : !detailId ? "detailId" : "title";
        recordBeisenLoss(losses, counts, "VALIDATION", "MISSING_REQUIRED_FIELD", rawLocator, pageIndex, recordIndex, missing);
        continue;
      }
      if (!locationRaw) {
        recordBeisenLoss(losses, counts, "VALIDATION",
          config.defaultLocationRaw ? "DECLARED_LOCATION_FALLBACK" : "MISSING_REQUIRED_FIELD",
          rawLocator, pageIndex, recordIndex, "locationRaw");
        continue;
      }
      if (!safeOfficialJsonId(officialId) || !safeOfficialJsonId(detailId)) {
        recordBeisenLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_ID", rawLocator, pageIndex, recordIndex, "id");
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
      const scope = beisenRecordScope(country, locationRaw, config.geographyScope);
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
      jobs.push({
        sourceJobId,
        title,
        officialUrl,
        locationRaw,
        cities: citiesFromBeisenLocation(locationParts.length > 0 ? locationParts : [locationRaw])
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

  const declaredCompleteness = beisenDeclaredCompleteness(
    declaredTotal,
    declaredArtifactKey,
    declaredLocator
  );
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
      ...(declaredTotal === undefined ? {} : { expectedJobCount: declaredTotal }),
      completenessEvidenceKind: declaredTotal === undefined ? "WEAK_MANUAL_SAMPLE" : "OFFICIAL_TOTAL_COUNT",
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
  config,
  entryUrl,
  capturedAt,
  now
}: {
  http: OfficialJsonHttpClient;
  config: Extract<OfficialJsonFetchConfig, { kind: "phenom" }>;
  entryUrl: string;
  capturedAt: string;
  now: () => Date;
}): Promise<SourceFetchResult> {
  let safeEntryUrl: string;
  let detailBaseUrl: string;
  let allowedApplyOrigins: ReadonlySet<string>;
  try {
    safeEntryUrl = safeOfficialJsonEndpoint(entryUrl);
    detailBaseUrl = safeOfficialJsonEndpoint(config.detailBaseUrl);
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
  } catch {
    return failed(capturedAt, "Phenom entry TRANSPORT_FAILURE");
  }
  try {
    assertOfficialJsonEvidenceResponse(entry, {
      requestedUrl: safeEntryUrl,
      crawlStartedAtMs: Date.parse(capturedAt),
      observedNowMs: now().getTime()
    });
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
    return failedWithEvidence(capturedAt, `Phenom entry page returned HTTP ${entry.status}`,
      phenomEntryFailureEvidence(unavailableEntryArtifact));
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
  let allowedCategoryDescriptors: ReadonlySet<string> | undefined;
  let declaredTotal: number | undefined;
  let declaredArtifactKey: string | undefined;
  let declaredLocator: string | undefined;
  let cumulativeRaw = 0;

  if (facetScope) {
    const globalPreflight = await fetchPhenomFacetPreflight({
      http, endpoint: widgetEndpoint, entryUrl: safeEntryUrl, pageConfig,
      pageSize, selectedFields: {}, capturedAt, now,
      id: "phenom-facet-global",
      locator: `${configLocator}|facet-preflight:global|${phenomSelectedFieldsLocator({})}`
    });
    if (!globalPreflight.ok) {
      return phenomFailure(capturedAt, globalPreflight.failureReason, artifacts, pages, counts, losses);
    }
    artifacts.push(globalPreflight.artifact);
    const countryAggregation = exactPhenomAggregation(globalPreflight.envelope, "country");
    const countryCount = countryAggregation?.get(facetScope.countryIncludeDescriptor);
    if (countryCount === undefined) {
      return phenomFailure(capturedAt, "Phenom global country descriptor is missing or ambiguous",
        artifacts, pages, counts, losses);
    }

    const countryPreflight = await fetchPhenomFacetPreflight({
      http, endpoint: widgetEndpoint, entryUrl: safeEntryUrl, pageConfig,
      pageSize, selectedFields: { country: [facetScope.countryIncludeDescriptor] }, capturedAt, now,
      id: "phenom-facet-country",
      locator: `${configLocator}|facet-preflight:country|${phenomSelectedFieldsLocator({
        country: [facetScope.countryIncludeDescriptor]
      })}`
    });
    if (!countryPreflight.ok) {
      return phenomFailure(capturedAt, countryPreflight.failureReason, artifacts, pages, counts, losses);
    }
    artifacts.push(countryPreflight.artifact);
    if (countryPreflight.envelope.totalHits !== countryCount ||
      countryPreflight.envelope.jobs.some((raw) =>
        !isStrictRecord(raw) || stringValue(raw.country) !== facetScope.countryIncludeDescriptor)) {
      return phenomFailure(capturedAt, "Phenom country facet preflight drifted or returned an out-of-scope sample",
        artifacts, pages, counts, losses);
    }
    const categories = exactPhenomAggregation(countryPreflight.envelope, "category");
    if (!categories || [...categories.values()].reduce((sum, value) => sum + value, 0) !== countryCount ||
      facetScope.categoryExcludeDescriptors.some((descriptor) => !categories.has(descriptor))) {
      return phenomFailure(capturedAt, "Phenom category aggregation is not a complete mutually exclusive partition",
        artifacts, pages, counts, losses);
    }
    const allowed = [...categories.keys()].filter(
      (descriptor) => !facetScope.categoryExcludeDescriptors.includes(descriptor)
    ).sort();
    if (allowed.length === 0) {
      return phenomFailure(capturedAt, "Phenom structured facet scope excludes every category",
        artifacts, pages, counts, losses);
    }
    structuredExpectedTotal = allowed.reduce((sum, descriptor) => sum + categories.get(descriptor)!, 0);
    allowedCategoryDescriptors = new Set(allowed);
    formalSelectedFields = {
      country: [facetScope.countryIncludeDescriptor],
      category: allowed
    };
  }

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const requestedOffset = pageIndex * pageSize;
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
        body: phenomWidgetRequestBody(pageConfig, pageSize, requestedOffset, formalSelectedFields)
      });
    } catch {
      return phenomFailure(capturedAt, "Phenom widgets TRANSPORT_FAILURE", artifacts, pages, counts, losses);
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
    const unavailableLocator = `phenom-page-v1|entry:phenom-entry-0000|config:${irreversibleOfficialJsonEvidenceId(configLocator)}|${phenomSelectedFieldsLocator(formalSelectedFields)}|requestOffset:${requestedOffset}|json:unavailable`;
    const artifact = phenomArtifact({
      id: artifactId, kind: "PAGINATION_PAGE", requestedUrl: widgetEndpoint,
      response, extractorLocator: unavailableLocator
    });
    artifacts.push(artifact);
    if (response.status < 200 || response.status >= 300) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt, `Phenom widgets API returned HTTP ${response.status}`, artifacts, pages, counts, losses);
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
        return phenomFailure(capturedAt, "Phenom filtered total does not equal the allowed category partition",
          artifacts, pages, counts, losses);
      }
    }
    let returnedOffset: number | null = null;
    if (facetScope && !hasOwn(refineSearch, "from")) {
      pages.push(phenomPageTrace({ artifact, sequence: pageIndex, requestedOffset, termination: "FAILED" }));
      return phenomFailure(capturedAt, "Phenom structured facet page requires own from",
        artifacts, pages, counts, losses);
    }
    if (hasOwn(refineSearch, "from")) {
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
    const locator = pageTotal === undefined
      ? `${unavailableLocator.replace("json:unavailable", "json:$.refineSearch.data.jobs")}`
      : phenomTotalLocator(configLocator, formalSelectedFields, requestedOffset);
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
      const locationRaw = stringValue(raw.location) ?? stringValue(raw.cityStateCountry) ??
        firstString(raw.multi_location) ?? stringValue(raw.city);
      const applyUrlRaw = stringValue(raw.applyUrl);
      const missing = !id ? "id" : !title ? "title" : !locationRaw ? "locationRaw" : !applyUrlRaw ? "officialUrl" : undefined;
      if (missing) {
        recordPhenomLoss(losses, counts, "VALIDATION", "MISSING_REQUIRED_FIELD", rawLocator, pageIndex, recordIndex, missing);
        continue;
      }
      if (!safeOfficialJsonId(id!)) {
        recordPhenomLoss(losses, counts, "VALIDATION", "UNSAFE_OFFICIAL_ID", rawLocator, pageIndex, recordIndex, "id");
        continue;
      }
      if (seenOfficialIds.has(id!)) {
        recordPhenomLoss(losses, counts, "VALIDATION", "DUPLICATE_OFFICIAL_ID", rawLocator, pageIndex, recordIndex, "id");
        continue;
      }
      const city = stringValue(raw.city);
      if (facetScope && (stringValue(raw.country) !== facetScope.countryIncludeDescriptor ||
        !allowedCategoryDescriptors?.has(stringValue(raw.category) ?? ""))) {
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
        stringValue(raw.country), locationRaw!, city
      )) {
        recordPhenomLoss(losses, counts, "VALIDATION", "OUT_OF_SCOPE", rawLocator, pageIndex, recordIndex);
        continue;
      }
      let officialUrl: string;
      try {
        officialUrl = safePhenomJobUrl(applyUrlRaw!, detailBaseUrl, allowedApplyOrigins);
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
      artifact, sequence: pageIndex, requestedOffset, returnedOffset,
      rawJobIds: rawIds, validJobIds: validIds,
      ...(pageTotal === undefined ? {} : { declaredTotal: pageTotal }),
      nextPageSignalBefore: pageIndex === 0 ? null : `offset:${requestedOffset}`,
      nextPageSignalAfter: nextSignal, termination
    }));
    if (!hasNext || atMax) break;
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
      ...(declaredCompleteness ? { declaredCompleteness } : {})
    });
  } catch (error) {
    return phenomFailure(capturedAt, safeOfficialJsonFailure(error, "Phenom pagination evidence is invalid"),
      artifacts, pages, counts, losses, declaredCompleteness);
  }
  const expectedNoncertifyingNoTotal = declaredTotal === undefined &&
    finalized.evaluation.derivedAnomalyCodes.length === 0;
  if (!finalized.evaluation.safeCompleteness && !expectedNoncertifyingNoTotal) {
    return {
      ok: false, capturedAt,
      failureReason: `Phenom pagination evidence failed: ${finalized.evaluation.derivedAnomalyCodes.join(",")}`,
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

type PhenomFacetEnvelope = {
  totalHits: number;
  jobs: unknown[];
  aggregations: unknown[];
};

function validPhenomFacetScope(value: PhenomFacetScope | undefined): PhenomFacetScope | undefined {
  if (!value || typeof value.countryIncludeDescriptor !== "string" ||
    !value.countryIncludeDescriptor.trim() || !Array.isArray(value.categoryExcludeDescriptors) ||
    value.categoryExcludeDescriptors.length === 0 ||
    value.categoryExcludeDescriptors.some((item) => typeof item !== "string" || !item.trim()) ||
    new Set(value.categoryExcludeDescriptors).size !== value.categoryExcludeDescriptors.length) return undefined;
  return value;
}

function phenomWidgetRequestBody(
  config: CompletePhenomPageConfig,
  size: number,
  from: number,
  selectedFields: Record<string, string[]>
): string {
  return JSON.stringify({
    lang: config.locale, locale: config.locale,
    deviceType: config.deviceType, country: config.country,
    pageName: config.pageName, size, from,
    jobs: true, counts: true,
    all_fields: ["category", "country", "state", "city", "type", "jobLevelId"],
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
  capturedAt: string;
  now: () => Date;
  id: string;
  locator: string;
}): Promise<
  | { ok: true; artifact: SourceFetchArtifactDraft; envelope: PhenomFacetEnvelope }
  | { ok: false; failureReason: string }
> {
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
      body: phenomWidgetRequestBody(input.pageConfig, input.pageSize, 0, input.selectedFields)
    });
  } catch {
    return { ok: false, failureReason: "Phenom facet preflight TRANSPORT_FAILURE" };
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
    return { ok: false, failureReason: safeOfficialJsonFailure(error, "Phenom facet preflight response is invalid") };
  }
  const artifact = phenomArtifact({
    id: input.id,
    kind: "ATS_API_RESPONSE",
    requestedUrl: input.endpoint,
    response,
    extractorLocator: input.locator
  });
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

function phenomFailure(
  capturedAt: string,
  failureReason: string,
  artifacts: SourceFetchArtifactDraft[],
  pages: SourceFetchPageTrace[],
  fetchCounts: PersistentSourceFetchEvidence["fetchCounts"],
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"],
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"]
): SourceFetchResult {
  const evidencePages = pages.length > 0
    ? pages.map((page, index) => index === pages.length - 1 && page.termination === "CONTINUE"
      ? { ...page, termination: "ABORTED" as const }
      : page)
    : [phenomPageTrace({ artifact: artifacts[0]!, sequence: 0, requestedOffset: null, termination: "FAILED" })];
  return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts,
    pages: evidencePages,
    fetchCounts,
    fetchLosses,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  }));
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
  if (country !== undefined) {
    const normalizedCountry = country.normalize("NFKC").trim().toLowerCase();
    return /^(?:china|prc|mainland china|china mainland|people'?s republic of china|people'?s republic of china|中国|中国大陆|中华人民共和国)$/iu.test(
      normalizedCountry
    );
  }
  return explicitlyChina(`${locationRaw} ${city ?? ""}`);
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
  let countResponse: OfficialJsonHttpResponse;
  try {
    countResponse = await post("count", encodeHcmCloudRequest(countPayload));
  } catch {
    return hcmCloudFailure(capturedAt, "HCMCloud count API TRANSPORT_FAILURE", artifacts, pages, counts, losses);
  }
  const countArtifact = hcmCloudArtifact({
    id: `${artifactPrefix}hcm-count-0000`, kind: "ATS_API_RESPONSE", requestedUrl: countUrl,
    response: countResponse,
    locator: hcmCloudCountLocator(countFilterHash)
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
    return hcmCloudFailure(capturedAt, `HCMCloud count API returned HTTP ${countResponse.status}`,
      artifacts, pages, counts, losses);
  }
  try {
    assertOfficialJsonMime(countResponse);
  } catch (error) {
    return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud count MIME is invalid"),
      artifacts, pages, counts, losses);
  }
  let countDecoded: HcmCloudDecoded;
  try {
    countDecoded = decodeHcmCloudResponseStrict(countResponse.body);
  } catch {
    return hcmCloudFailure(capturedAt, "HCMCloud count response decode failed", artifacts, pages, counts, losses);
  }
  let countSelection: { value?: number; path?: string };
  try {
    countSelection = selectHcmCloudCount(countDecoded.value);
  } catch (error) {
    return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud count is invalid"),
      artifacts, pages, counts, losses);
  }
  const expectedJobCount = countSelection.value;
  const countLocator = hcmCloudCountLocator(countFilterHash, countDecoded.algorithm, countSelection.path);
  countArtifact!.extractorLocator = countLocator;
  const jobs: NormalizedOfficialJsonJob[] = [];
  const seenOfficialIds = new Set<string>();
  const seenDetailIds = new Set<string>();
  let cumulativeRaw = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const requestPayload = hcmCloudListPayload(config, page, pageSize);
    if (hcmCloudTupleHash(hcmCloudSemanticFilterTuple(requestPayload)) !== countFilterHash) {
      return hcmCloudFailure(capturedAt, "HCMCloud count/list semantic filter tuple mismatch",
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    let response: OfficialJsonHttpResponse;
    try {
      response = await post("list", encodeHcmCloudRequest(requestPayload));
    } catch {
      return hcmCloudFailure(capturedAt, "HCMCloud list API TRANSPORT_FAILURE",
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact),
        "HCM_LIST_RESPONSE_FAILED");
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
        locator: hcmCloudListLocator(countFilterHash, page, pageSize)
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
      return hcmCloudFailure(capturedAt, `HCMCloud list API returned HTTP ${response.status}`,
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    try { assertOfficialJsonMime(response); } catch (error) {
      pages.push(hcmCloudPageTrace({ artifact, sequence: pages.length, requestedPage: page,
        ...(expectedJobCount !== undefined ? { declaredTotal: expectedJobCount } : {}), termination: "FAILED" }));
      return hcmCloudFailure(capturedAt, safeOfficialJsonFailure(error, "HCMCloud list MIME is invalid"),
        artifacts, pages, counts, losses, hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    let decoded: HcmCloudDecoded;
    try { decoded = decodeHcmCloudResponseStrict(response.body); } catch {
      pages.push(hcmCloudPageTrace({ artifact, sequence: pages.length, requestedPage: page,
        ...(expectedJobCount !== undefined ? { declaredTotal: expectedJobCount } : {}), termination: "FAILED" }));
      return hcmCloudFailure(capturedAt, "HCMCloud list response decode failed", artifacts, pages, counts, losses,
        hcmCloudDeclared(expectedJobCount, countArtifact));
    }
    let list: unknown[];
    let returnedPage: number | undefined;
    try {
      const parsed = parseHcmCloudList(decoded.value);
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
    artifact.extractorLocator = hcmCloudListLocator(countFilterHash, page, pageSize, decoded.algorithm,
      returnedPage !== undefined);
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

function decodeHcmCloudResponseStrict(body: string): HcmCloudDecoded {
  if (!hasUniqueJsonObjectKeys(body)) throw new Error("ambiguous HCMCloud envelope");
  const envelope: unknown = JSON.parse(body);
  if (!isStrictRecord(envelope) || envelope.hcm_transfer_strategy !== "hb5" ||
    typeof envelope.hcm_param !== "string" || !envelope.hcm_param.startsWith("rsp") ||
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

function selectHcmCloudCount(decoded: unknown): { value?: number; path?: string } {
  if (!isStrictRecord(decoded)) throw new Error("HCMCloud count root must be an object");
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

function parseHcmCloudList(decoded: unknown): { list: unknown[]; returnedPage?: number; count?: number } {
  if (!isStrictRecord(decoded) || !hasOwn(decoded, "result") || !isStrictRecord(decoded.result) ||
    !hasOwn(decoded.result, "list") || !Array.isArray(decoded.result.list)) {
    throw new Error("HCMCloud list collection is invalid");
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
  hasReturnedPage = false
): string {
  return `hcm-list-v1|decode:${algorithm}|filter-fields:model,job_class,status,delivery,contract_unit,state,recruit_type` +
    `|filter-sha256:${filterHash}|request-page:${page}|page-size:${pageSize}` +
    `|records:$.result.list${hasReturnedPage ? "|returned-page:$.result.page_index" : ""}`;
}

function hcmCloudPageTrace(input: {
  artifact: SourceFetchArtifactDraft;
  sequence: number;
  requestedPage: number;
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
  supportingCode: "HCM_COUNT_RESPONSE_FAILED" | "HCM_LIST_RESPONSE_FAILED" | "HCM_BROWSER_ENTRY_FAILED" = "HCM_COUNT_RESPONSE_FAILED"
): SourceFetchResult {
  if (artifacts.length === 0) return failed(capturedAt, reason);
  if (pages.length === 0) {
    return failedWithEvidence(capturedAt, reason, finalizeOfficialJsonSupportingFailureEvidence({
      artifacts,
      code: supportingCode
    }));
  }
  const evidencePages = pages.length > 0 ? pages.map((page, index) =>
    index === pages.length - 1 && page.termination === "CONTINUE" ? { ...page, termination: "ABORTED" as const } : page
  ) : [];
  return failedWithEvidence(capturedAt, reason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts, pages: evidencePages, fetchCounts: counts, fetchLosses: losses,
    ...(declared ? { declaredCompleteness: declared } : {})
  }));
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

const HCM_CLOUD_BROWSER_TIMEOUT_MS = 60_000;

async function defaultHcmCloudBrowserFetch({
  entryUrl,
}: HcmCloudBrowserFetchInput): Promise<HcmCloudBrowserSession> {
  const { chromium } = await import("playwright-core");
  const { FORMAL_CHROMIUM_ARGS, FORMAL_CHROMIUM_PATH } = await import("../readiness/formalBrowserPreflight");
  const browser = await chromium.launch({
    ...(process.platform === "linux" ? { executablePath: FORMAL_CHROMIUM_PATH, args:[...FORMAL_CHROMIUM_ARGS] } : { channel: "chrome" }),
    headless: true
  });
  try {
    const page = await browser.newPage();
    const navigation = await page.goto(entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: Number(process.env.P0_BROWSER_TIMEOUT_MS ?? HCM_CLOUD_BROWSER_TIMEOUT_MS)
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
    await page.waitForTimeout(Number(process.env.P0_HCM_CLOUD_BROWSER_SETTLE_MS ?? 3000));
    return {
      entryResponse,
      post: async (endpoint, body) => {
        const path = endpoint === "count"
          ? "/api/hcm.model.count?model=ReleaseJobMgr"
          : "/api/hcm.model.list?model=ReleaseJobMgr";
        return page.evaluate(
          async ({ path: requestPath, requestBody }: { path: string; requestBody: string }) => {
            const response = await fetch(requestPath, {
              method: "POST",
              headers: { Accept: "application/json, text/plain, */*",
                "Content-Type": "application/json;charset=UTF-8" },
              body: requestBody
            });
            const responseBody = await response.text();
            const contentType = response.headers.get("content-type");
            return { status: response.status, body: responseBody, finalUrl: response.url,
              ...(contentType ? { contentType } : {}), capturedAt: new Date().toISOString() };
          },
          { path, requestBody: body }
        );
      },
      close: async () => { await browser.close(); }
    };
  } catch (error) {
    await browser.close();
    throw error;
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

function sandozJsonApiUrl(endpointUrl: string, page: number): string {
  const url = new URL(endpointUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("views-filter[field_job_functional_area]", "All");
  url.searchParams.set("views-filter[field_job_country]", "All");
  url.searchParams.set("views-filter[field_job_alt_country_1]", "");
  url.searchParams.set("views-filter[field_job_posted_date][min]", "");
  url.searchParams.set("views-filter[field_job_posted_date][max]", "");
  return url.toString();
}

function sandozEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "sandoz-com.cms.sandoz.com" || url.port ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== "/jsonapi/views/job_search/job_search") throw new Error("invalid Sandoz endpoint");
  return url;
}

function sandozDetailBase(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "www.sandoz.com" || url.port || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") throw new Error("invalid Sandoz detail base");
  return url;
}

function extractSandozBearerToken(body: string): string | undefined {
  const matches = [...body.matchAll(/"token"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gu)];
  if (matches.length === 0) return undefined;
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

function sandozCanonicalNext(raw: unknown, endpoint: URL, page: number, pageSize: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.trim() !== raw || !raw) throw new Error("invalid next");
  const expected = sandozJsonApiUrl(endpoint.toString(), page + 1);
  const candidate = new URL(raw);
  if (candidate.href !== expected || candidate.origin !== endpoint.origin || candidate.pathname !== endpoint.pathname ||
      candidate.username || candidate.password || candidate.hash || pageSize <= 0) throw new Error("invalid next");
  return `page:${page + 1}`;
}

type SandozLossCode = "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "UNSAFE_OFFICIAL_ID" |
  "UNSAFE_OFFICIAL_URL" | "OUT_OF_SCOPE" | "AMBIGUOUS_SCOPE" | "DUPLICATE_OFFICIAL_ID" |
  "CONFLICTING_OFFICIAL_ID" | "SENSITIVE_OUTPUT" | "INVALID_JSONAPI_RESOURCE";

function parseSandozResource(
  config: Extract<OfficialJsonFetchConfig, { kind: "sandoz-jsonapi" }>, detailBase: URL,
  raw: Record<string, unknown>
): { ok: true; officialId: string; resourceId: string; job: NormalizedOfficialJsonJob } |
  { ok: false; code: SandozLossCode; field?: string } {
  const id = stringValue(raw.id);
  const type = stringValue(raw.type);
  if (!id || !safeOfficialJsonId(id)) return { ok: false, code: id ? "UNSAFE_OFFICIAL_ID" : "MISSING_REQUIRED_FIELD", field: "id" };
  if (!type || type !== "node--job" || !isStrictRecord(raw.attributes) || !isStrictRecord(raw.relationships)) {
    return { ok: false, code: "INVALID_JSONAPI_RESOURCE" };
  }
  const attributes = raw.attributes;
  const sourceJobId = stringValue(attributes.field_job_id) ?? id;
  const title = stringValue(attributes.field_job_title) ?? stringValue(attributes.title);
  const locationRaw = stringValue(attributes.field_job_work_location);
  const path = isStrictRecord(attributes.path) ? stringValue(attributes.path.alias) : undefined;
  if (!sourceJobId || !title || !locationRaw || !path) return { ok: false, code: "MISSING_REQUIRED_FIELD" };
  if (!safeOfficialJsonId(sourceJobId)) return { ok: false, code: "UNSAFE_OFFICIAL_ID", field: "field_job_id" };
  const scope = sandozCountryScope(raw.relationships, config.countryTermName);
  if (scope !== "CHINA") return { ok: false, code: scope === "OUTSIDE" ? "OUT_OF_SCOPE" : "AMBIGUOUS_SCOPE" };
  let officialUrl: string;
  try {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("..") || path.includes("?") || path.includes("#")) throw new Error("unsafe path");
    const url = new URL(path, detailBase);
    if (url.origin !== detailBase.origin || url.username || url.password || url.search || url.hash) throw new Error("unsafe path");
    officialUrl = url.toString();
  } catch { return { ok: false, code: "UNSAFE_OFFICIAL_URL", field: "path.alias" }; }
  const job = { sourceJobId, title, officialUrl, locationRaw, cities: citiesFromLocation(locationRaw) };
  if (sensitiveOfficialJsonField({ sourceJobId, officialUrl, locationRaw })) {
    return { ok: false, code: "SENSITIVE_OUTPUT" };
  }
  return { ok: true, officialId: sourceJobId, resourceId: id, job };
}

function sandozCountryScope(relationships: Record<string, unknown>, countryTermName: string): "CHINA" | "OUTSIDE" | "AMBIGUOUS" {
  const names = ["field_job_country", "field_job_alt_country_1", "field_job_alt_country_2", "field_job_alt_country_3"] as const;
  const terms: string[] = [];
  for (const name of names) {
    if (!hasOwn(relationships, name) || !isStrictRecord(relationships[name])) return "AMBIGUOUS";
    const data = relationships[name].data;
    if (!(data === null || Array.isArray(data) || isStrictRecord(data))) return "AMBIGUOUS";
    const items = data === null ? [] : Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!isStrictRecord(item) || stringValue(item.type) !== "taxonomy_term--job_location" ||
          !stringValue(item.id) || !isStrictRecord(item.meta) || !stringValue(item.meta.term_name)) return "AMBIGUOUS";
      terms.push(stringValue(item.meta.term_name)!);
    }
  }
  if (terms.length === 0) return "AMBIGUOUS";
  const positives = terms.filter((term) => term === countryTermName).length;
  if (positives === terms.length) return "CHINA";
  return positives > 0 ? "AMBIGUOUS" : "OUTSIDE";
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
  const locationRaw = xiuzhengText(job.location) ?? xiuzhengText(job.work_place) ?? xiuzhengText(job.address);
  if (!locationRaw) return { ok: false, code: "AMBIGUOUS_SCOPE", field: "location" };
  if (xiuzhengSensitiveOutput({ sourceJobId, title, locationRaw })) return { ok: false, code: "SENSITIVE_OUTPUT" };
  const scope = cnstaffGeographyScope(locationRaw);
  if (scope !== "CHINA") return { ok: false, code: scope === "FOREIGN" ? "OUT_OF_SCOPE" : "AMBIGUOUS_SCOPE", field: "location" };
  const detail = `${config.detailBaseUrl}?id=${encodeURIComponent(sourceJobId)}&type=job&scene=2`;
  const expectedHash = `#/recruitDetail?id=${encodeURIComponent(sourceJobId)}&type=job&scene=2`;
  let detailUrl: URL;
  try { detailUrl = new URL(detail); } catch { return { ok: false, code: "UNSAFE_OFFICIAL_URL" }; }
  if (detailUrl.origin !== "https://www.xiuzheng.com" || detailUrl.pathname !== "/" || detailUrl.search || detailUrl.hash !== expectedHash) {
    return { ok: false, code: "UNSAFE_OFFICIAL_URL" };
  }
  return { ok: true, sourceJobId, job: { sourceJobId, title, officialUrl: detailUrl.toString(), locationRaw, cities: citiesFromLocation(locationRaw) } };
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
  parsed: ParsedXiuzhengPage; rawIds: string[]; validIds: string[]; termination: SourceFetchPageTrace["termination"] }): SourceFetchPageTrace {
  return { sequence: input.sequence, artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null, returnedCursor: null, requestedOffset: null, returnedOffset: null,
    requestedPage: input.requestedPage, returnedPage: input.parsed.currentPage ?? null,
    rawJobIds: input.rawIds, validJobIds: input.validIds,
    declaredTotal: input.parsed.total ?? null, declaredCount: null, declaredPages: input.parsed.lastPage ?? null,
    nextPageSignalBefore: input.requestedPage === 1 ? null : String(input.requestedPage),
    nextPageSignalAfter: input.termination === "CONTINUE" ? String(input.requestedPage + 1) : null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
    termination: input.termination, anomalyCodes: input.parsed.currentPage !== undefined && input.parsed.currentPage !== input.requestedPage ? ["RETURNED_PAGE_MISMATCH"] : [],
    capturedAt: input.artifact.capturedAt };
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

function sandozJobMatchesCountry(
  relationships: Record<string, unknown>,
  countryTermName: string
): boolean {
  return [
    relationships.field_job_country,
    relationships.field_job_alt_country_1,
    relationships.field_job_alt_country_2,
    relationships.field_job_alt_country_3
  ].some((relationship) => sandozRelationshipHasTerm(relationship, countryTermName));
}

function sandozRelationshipHasTerm(relationship: unknown, countryTermName: string): boolean {
  if (!isObject(relationship)) {
    return false;
  }

  const data = relationship.data;
  const items = Array.isArray(data) ? data : [data];
  return items.some((item) => {
    if (!isObject(item) || !isObject(item.meta)) {
      return false;
    }
    return stringValue(item.meta.term_name) === countryTermName;
  });
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

function sandozLocator(page: number, pageSize: number, declarations: boolean): string {
  void pageSize;
  return `sandoz-jsonapi-v1|page:${page}|filters:all|json:$.data[*]` +
    (declarations ? ",$.meta.count,$.links.next" : "");
}

function sandozPageTrace(input: {
  artifact: SourceFetchArtifactDraft; sequence: number; requestedPage: number; returnedPage?: number | null;
  rawJobIds?: string[]; validJobIds?: string[]; declaredTotal?: number;
  nextPageSignalBefore?: string | null; nextPageSignalAfter?: string | null;
  termination: SourceFetchPageTrace["termination"];
}): SourceFetchPageTrace {
  return {
    sequence: input.sequence, artifactLogicalKey: input.artifact.logicalKey,
    requestedCursor: null, returnedCursor: null, requestedOffset: null, returnedOffset: null,
    requestedPage: input.requestedPage, returnedPage: input.returnedPage ?? null,
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
        extractorLocator: sandozLocator(Number(artifactLogicalKey.slice("sandoz-page-".length)), 1, true), scope: "SOURCE" }
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
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"]): SourceFetchResult {
  if (artifacts.length === 0) return failed(capturedAt, failureReason);
  const evidencePages = pages.length > 0
    ? pages.map((page, index) => index === pages.length - 1 && page.termination === "CONTINUE"
      ? { ...page, termination: "ABORTED" as const } : page)
    : [jobsynPageTrace({ artifact: artifacts[0]!, sequence: 0, requestedPage: 1, termination: "FAILED" })];
  return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts, pages: evidencePages, fetchCounts, fetchLosses,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  }));
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
  response: OfficialJsonHttpResponse): { artifact: SourceFetchArtifactDraft; redacted: boolean } {
  const credentialRedaction = redactSandozSensitiveBody(response.body);
  let upstreamError = false;
  if (suffix === "api" && !credentialRedaction.redacted) {
    try {
      const root = JSON.parse(response.body);
      upstreamError = isStrictRecord(root) && hasOwn(root, "meg") && stringValue(root.state) !== "1";
    } catch { /* malformed bodies remain exact evidence */ }
  }
  const redaction = upstreamError
    ? { body: "[REDACTED_UPSTREAM_ERROR_TEXT]", redacted: true, count: 1 }
    : credentialRedaction;
  const logicalKey = `redsea-${channel}-${suffix}`;
  const artifact = officialJsonNetworkArtifact({
    id: logicalKey, logicalKey, kind, requestedUrl, response: { ...response, body: redaction.body },
    extractorLocator: suffix === "api"
      ? `redsea-channel-v1|channel:${irreversibleOfficialJsonEvidenceId(channel)}|json:$.state,$.jsonList[*]`
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

function parseRedseaQueryPostList(
  body: string
): { ok: true; jobs: unknown[] } | { ok: false; failureReason: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return { ok: false, failureReason: "Redsea API response is not valid JSON" }; }
  if (!hasUniqueJsonObjectKeys(body) || !isStrictRecord(parsed) || stringValue(parsed.state) !== "1" || !Array.isArray(parsed.jsonList)) {
    return { ok: false, failureReason: stringValue(isStrictRecord(parsed) ? parsed.state : undefined) === "0"
      ? "Redsea API state is unsuccessful" : "Redsea API response schema is invalid" };
  }
  return { ok: true, jobs: parsed.jsonList };
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
  if (explicitlyOutsideChina(normalizedLocation) || /(?:香港|澳门|台湾|hong\s*kong|macau|macao|taiwan)/iu.test(normalizedLocation)) {
    return { ok: false, code: "OUT_OF_SCOPE", field: "location" };
  }
  if (!/(?:中国|大陆|上海|北京|广州|深圳|成都|杭州|南京|苏州|武汉|天津|重庆|西安|兰州|河北|石家庄|china|prc|mainland)/iu.test(normalizedLocation)) {
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
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(titleSlug)) {
    return [];
  }

  const locationSlug = jobsynSlug(locationRaw);
  const expectedPath = `/${locationSlug}/${titleSlug}/${sourceJobId}/job/`;
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
  if (uniqueMutation && pageIdState.bootstrapPageIds.some(
    (pageId) => pageId !== undefined && pageId !== uniqueMutation
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
          candidates.push(candidate);
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
    candidates.push(candidate);
  }
  if (fallbackCandidates.length > 0) {
    if (fallbackCandidates.length !== 1 || separatePageIds.length > 1) return null;
    const fallback = fallbackCandidates[0]!;
    if (fallback.pageId && separatePageIds.length > 0) return null;
    const pageId = fallback.pageId ?? separatePageIds[0] ?? externalPageId;
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

function hasUniqueJsonObjectKeys(json: string): boolean {
  let expression: unknown;
  try {
    expression = parseExpression(json, {
      sourceType: "script",
      errorRecovery: false
    });
  } catch {
    return false;
  }
  return uniqueJsonObjectKeysInExpression(expression);
}

function uniqueJsonObjectKeysInExpression(node: unknown): boolean {
  if (!isStrictRecord(node) || typeof node.type !== "string") return false;
  if (["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral"].includes(node.type)) {
    return true;
  }
  if (node.type === "UnaryExpression") {
    return node.operator === "-" && uniqueJsonObjectKeysInExpression(node.argument);
  }
  if (node.type === "ArrayExpression") {
    return Array.isArray(node.elements) && node.elements.every((element) =>
      element !== null && uniqueJsonObjectKeysInExpression(element));
  }
  if (node.type !== "ObjectExpression" || !Array.isArray(node.properties)) return false;
  const keys = new Set<string>();
  for (const property of node.properties) {
    if (!isStrictRecord(property) || property.type !== "ObjectProperty" ||
      property.computed !== false || property.method === true || property.shorthand === true ||
      !isStrictRecord(property.key) || property.key.type !== "StringLiteral" ||
      typeof property.key.value !== "string") return false;
    const key = property.key.value;
    if (keys.has(key)) return false;
    keys.add(key);
    if (!uniqueJsonObjectKeysInExpression(property.value)) return false;
  }
  return true;
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
武汉 黄石 十堰 宜昌 襄阳 鄂州 荆门 孝感 荆州 黄冈 咸宁 随州 恩施 神农架
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
  const segments = normalized.split(/[\s,，;；/|()（）·]+/u).filter(Boolean);
  for (const segment of segments) {
    const stripped = segment.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|地区|盟|省|市)$/u, "");
    if (CNSTAFF_MAINLAND_PROVINCES.has(segment) || CNSTAFF_MAINLAND_PROVINCES.has(stripped) ||
        CNSTAFF_MAINLAND_PREFECTURES.has(segment) || CNSTAFF_MAINLAND_PREFECTURES.has(stripped)) return true;
    if ([...CNSTAFF_MAINLAND_PREFECTURES].some((name) => name.length >= 2 && segment.startsWith(name))) return true;
  }
  return false;
}

function cnstaffHasForeignGeography(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();
  return /(?:香港|澳门|台湾|台北|欧洲大陆|美国|纽约|波士顿|旧金山|洛杉矶|西雅图|日本|东京|大阪|京都|新加坡|印度|德国|法国|加拿大|澳大利亚|英国|伦敦|韩国|首尔)|\b(?:hong kong|macao|macau|taiwan|taipei|european mainland|continental europe|united states|usa|u\.s\.|boston|new york|san francisco|los angeles|seattle|japan|tokyo|osaka|kyoto|singapore|india|germany|france|canada|australia|united kingdom|london|south korea|seoul)\b/u.test(normalized);
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
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"]
): SourceFetchResult {
  if (artifacts.length === 0) return failed(capturedAt, failureReason);
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
  return failedWithEvidence(capturedAt, failureReason, finalizeOfficialJsonFailureEvidenceBundle({
    artifacts,
    pages: evidencePages,
    fetchCounts,
    fetchLosses,
    ...(declaredCompleteness ? { declaredCompleteness } : {})
  }));
}

function recordBeisenLoss(
  losses: PersistentSourceFetchEvidence["fetchLosses"],
  counts: PersistentSourceFetchEvidence["fetchCounts"],
  stage: "PARSE" | "VALIDATION",
  code: "NON_OBJECT_RECORD" | "MISSING_REQUIRED_FIELD" | "DECLARED_LOCATION_FALLBACK" |
    "UNSAFE_OFFICIAL_ID" | "DUPLICATE_OFFICIAL_ID" | "DUPLICATE_DETAIL_ID" |
    "OUT_OF_SCOPE" | "AMBIGUOUS_SCOPE" | "SOCIAL_CHANNEL_MISMATCH" |
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
    reason: `Beisen Zhiye record rejected: ${code}`,
    rawLocator,
    details: { code, ...(field ? { field } : {}), pageSequence, recordIndex }
  });
}

function beisenRecordScope(
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
  if (kind && /(?:校园|校招|实习|campus|intern)/iu.test(kind)) return "Kind";
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
    const response = await fetch(request.url, {
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

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
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
