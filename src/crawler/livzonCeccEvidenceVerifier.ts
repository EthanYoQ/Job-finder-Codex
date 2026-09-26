import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import { irreversibleOfficialJsonEvidenceId } from "./officialJsonEvidence";
import type {
  LivzonCeccFetchConfig,
  LivzonCeccPartitionConfig
} from "./livzonCeccSourceFetch";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceCrawlPlan } from "./sourcePlan";
import {
  sanitizeEvidenceHttpUrl,
  type PersistentSourceFetchEvidence
} from "./sourceFetchEvidence";
import { requestContractV2Matches } from "./strictPageRequestContract";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

const LIVZON_ORIGIN = "https://www.livzon.com.cn";
const LIVZON_SOCIAL_INDEX_URL = `${LIVZON_ORIGIN}/Social.html`;
const LIVZON_LIST_API_URL =
  `${LIVZON_ORIGIN}/nportal/fwebapi/product/product/es/findPage?appId=143150160001&templateId=product`;
const LIVZON_ROUTE_DECLARED_LIST_API_URL =
  `${LIVZON_ORIGIN}/fwebapi/product/product/es/findPage?appId=143150160001&templateId=product`;
const LIVZON_SOCIAL_PARTITION_SELECTOR =
  "#c_product_list_041-1735488276515 .p_list > .p_loopitem .e_text-5 a[href]";

const CANONICAL_PARTITIONS = [
  { routePath: "/product/140/", categoryId: "1323235936422219776", categoryName: "丽珠集团总部" },
  { routePath: "/product/141/", categoryId: "1323235936447385600", categoryName: "丽珠营销总部" },
  { routePath: "/product/142/", categoryId: "1323235936472551424", categoryName: "丽珠制药厂" },
  { routePath: "/product/143/", categoryId: "1323235936501911552", categoryName: "丽珠微球" },
  { routePath: "/product/144/", categoryId: "1323235936527077376", categoryName: "丽珠单抗" },
  { routePath: "/product/145/", categoryId: "1323235936552243200", categoryName: "丽珠研究院" },
  { routePath: "/product/146/", categoryId: "1323235936577409024", categoryName: "丽珠利民" },
  { routePath: "/product/147/", categoryId: "1323235936598380544", categoryName: "丽珠合成" },
  { routePath: "/product/149/", categoryId: "1323235936648712192", categoryName: "丽珠新北江" },
  { routePath: "/product/150/", categoryId: "1323235936678072320", categoryName: "丽珠福州福兴" },
  { routePath: "/product/151/", categoryId: "1323235936707432448", categoryName: "丽珠宁夏制药" },
  { routePath: "/product/152/", categoryId: "1323235936732598272", categoryName: "上海丽珠" },
  { routePath: "/product/153/", categoryId: "1323235936757764096", categoryName: "丽珠试剂" },
  { routePath: "/product/154/", categoryId: "1323235936787124224", categoryName: "丽珠四川光大" }
] as const satisfies readonly LivzonCeccPartitionConfig[];

export interface StrictLivzonCeccNetworkPolicy {
  socialIndexUrl: string;
  listApiUrl: string;
  partitionRouteUrls: readonly string[];
}

interface ReplayedRoute {
  params: {
    size: number;
    from: number;
    query: Record<string, unknown>[];
    header: Record<string, unknown>;
    sort: unknown[];
    _detailId: string;
  };
  totalCount: number;
}

interface ExpectedOutputJob {
  sourceJobId: string;
  officialTitle: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}

type EvidenceArtifact = PersistentSourceFetchEvidence["artifacts"][number];

/**
 * Returns the exact, profile-bound endpoints that shared network policy may
 * allow. Undefined means the plan is not the audited Livzon configuration.
 */
export function getStrictLivzonCeccNetworkPolicy(
  plan: SourceCrawlPlan
): StrictLivzonCeccNetworkPolicy | undefined {
  const config = strictLivzonConfig(plan);
  if (!config) return undefined;
  return {
    socialIndexUrl: config.socialIndexUrl,
    listApiUrl: config.listApiUrl,
    partitionRouteUrls: config.auditedPartitions.map((partition) =>
      new URL(partition.routePath, config.socialIndexUrl).toString()
    )
  };
}

/**
 * Replays the archived HTML and JSON from bytes. It does not trust fetch-stage
 * totals, page labels, locator claims, or adapter output counts.
 */
export function validateStrictLivzonCeccEvidence(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  try {
    const config = strictLivzonConfig(plan);
    if (!config || evidence.captureTool.name !== "livzon-cecc-source-fetch" ||
      evidence.captureTool.version !== "1" || evidence.fetchLosses.length !== 0) {
      return false;
    }

    const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
    if (artifacts.size !== evidence.artifacts.length ||
      evidence.artifacts.some((artifact) => artifact.id !== artifact.logicalKey)) {
      return false;
    }

    const social = artifacts.get("livzon-social-index");
    if (!isExactNetworkArtifact(social, {
      kind: "OFFICIAL_COMPANY_PAGE",
      requestedUrl: config.socialIndexUrl,
      contentType: "text/html"
    }) || !requestContractV2Matches(social.extractorLocator, {
      family: "livzon-cecc",
      role: "social-index",
      method: "GET",
      url: config.socialIndexUrl,
      body: null,
      coordinate: { sequence: null }
    }) || !strictSocialPartitionReplay(social.body, config)) {
      return false;
    }

    const listEvidenceUrl = sanitizeEvidenceHttpUrl(config.listApiUrl);
    const usedArtifactKeys = new Set<string>([social.logicalKey]);
    const seenOfficialIds = new Set<string>();
    const expectedOutputJobs = new Map<string, ExpectedOutputJob>();
    const replayedApiPages: Array<{
      artifact: EvidenceArtifact;
      rawJobIds: string[];
      validJobIds: string[];
    }> = [];
    let aggregateTotal = 0;

    for (let partitionIndex = 0; partitionIndex < config.auditedPartitions.length; partitionIndex += 1) {
      const partition = config.auditedPartitions[partitionIndex]!;
      const routeUrl = new URL(partition.routePath, config.socialIndexUrl).toString();
      const routeKey = `livzon-route-${String(partitionIndex).padStart(4, "0")}`;
      const routeArtifact = artifacts.get(routeKey);
      if (!isExactNetworkArtifact(routeArtifact, {
        kind: "ATS_PAGE",
        requestedUrl: routeUrl,
        contentType: "text/html"
      }) || !requestContractV2Matches(routeArtifact.extractorLocator, {
        family: "livzon-cecc",
        role: "partition-route",
        method: "GET",
        url: routeUrl,
        body: null,
        coordinate: { partitionIndex, categoryId: partition.categoryId }
      })) {
        return false;
      }
      usedArtifactKeys.add(routeKey);

      const route = strictRouteReplay(routeArtifact.body, partition, config);
      if (!route) return false;
      aggregateTotal += route.totalCount;
      if (!Number.isSafeInteger(aggregateTotal)) return false;

      const requiredPages = Math.max(1, Math.ceil(route.totalCount / config.pageSize));
      if (requiredPages > config.maxPagesPerPartition) return false;
      let partitionObserved = 0;

      for (let pageIndex = 0; pageIndex < requiredPages; pageIndex += 1) {
        const from = pageIndex * config.pageSize;
        const requestBody = {
          ...structuredClone(route.params),
          size: config.pageSize,
          from,
          _detailId: partition.categoryId,
          query: route.params.query.map((query) => ({ ...query })),
          header: { ...route.params.header },
          sort: [...route.params.sort]
        };
        const apiKey =
          `livzon-api-${String(partitionIndex).padStart(4, "0")}-${String(pageIndex).padStart(4, "0")}`;
        const apiArtifact = artifacts.get(apiKey);
        if (!isExactNetworkArtifact(apiArtifact, {
          kind: "ATS_API_RESPONSE",
          requestedUrl: listEvidenceUrl,
          contentType: "application/json"
        }) || !requestContractV2Matches(apiArtifact.extractorLocator, {
          family: "livzon-cecc",
          role: "partition-api",
          method: "POST",
          url: config.listApiUrl,
          body: requestBody,
          coordinate: {
            partitionIndex,
            pageIndex,
            requestedOffset: from,
            requestedPageSize: config.pageSize
          }
        })) {
          return false;
        }
        usedArtifactKeys.add(apiKey);

        const apiPage = strictApiPage(apiArtifact.body);
        if (!apiPage || apiPage.size !== config.pageSize || apiPage.from !== from ||
          apiPage.totalCount !== route.totalCount ||
          apiPage.list.length !== Math.min(config.pageSize, route.totalCount - from)) {
          return false;
        }

        const rawJobIds: string[] = [];
        const validJobIds: string[] = [];
        for (const raw of apiPage.list) {
          const replayed = strictJobReplay(raw, partition);
          if (!replayed || seenOfficialIds.has(replayed.officialId) ||
            expectedOutputJobs.has(replayed.output.sourceJobId)) {
            return false;
          }
          seenOfficialIds.add(replayed.officialId);
          expectedOutputJobs.set(replayed.output.sourceJobId, replayed.output);
          rawJobIds.push(irreversibleOfficialJsonEvidenceId(replayed.officialId));
          validJobIds.push(irreversibleOfficialJsonEvidenceId(replayed.output.sourceJobId));
          partitionObserved += 1;
        }
        replayedApiPages.push({ artifact: apiArtifact, rawJobIds, validJobIds });
      }
      if (partitionObserved !== route.totalCount) return false;
    }

    if (seenOfficialIds.size !== aggregateTotal || expectedOutputJobs.size !== aggregateTotal ||
      usedArtifactKeys.size !== evidence.artifacts.length ||
      evidence.artifacts.some((artifact) => !usedArtifactKeys.has(artifact.logicalKey))) {
      return false;
    }

    const tracedPages = aggregateTotal === 0
      ? replayedApiPages.slice(0, 1)
      : replayedApiPages.filter((page) => page.rawJobIds.length > 0);
    if (tracedPages.length === 0 || tracedPages.length !== evidence.pages.length) return false;

    for (let sequence = 0; sequence < tracedPages.length; sequence += 1) {
      const replayed = tracedPages[sequence]!;
      const page = evidence.pages[sequence]!;
      const isLast = sequence === tracedPages.length - 1;
      if (page.sequence !== sequence || page.artifactLogicalKey !== replayed.artifact.logicalKey ||
        (page.channelId ?? null) !== null ||
        !sameStrings(page.rawJobIds, replayed.rawJobIds) ||
        !sameStrings(page.validJobIds, replayed.validJobIds) ||
        page.declaredTotal !== aggregateTotal || (page.declaredCount ?? null) !== null ||
        (page.declaredPages ?? null) !== null ||
        (page.requestedCursor ?? null) !== null || (page.returnedCursor ?? null) !== null ||
        (page.requestedOffset ?? null) !== null || (page.returnedOffset ?? null) !== null ||
        (page.requestedPage ?? null) !== null || (page.returnedPage ?? null) !== null ||
        (page.requestedPageSize ?? null) !== null || (page.returnedPageSize ?? null) !== null ||
        page.nextPageSignalBefore !== (sequence === 0 ? null : `livzon-trace:${sequence}`) ||
        page.nextPageSignalAfter !== (isLast ? null : `livzon-trace:${sequence + 1}`) ||
        page.termination !== (aggregateTotal === 0
          ? "EMPTY_PAGE"
          : isLast ? "DECLARED_TOTAL_REACHED" : "CONTINUE") ||
        page.anomalyCodes.length !== 0 ||
        page.responseFingerprintSha256 !== sha256Body(replayed.artifact.body)) {
        return false;
      }
    }

    const declaration = evidence.declaredCompleteness;
    const declarationArtifact = tracedPages[0]!.artifact;
    if (declaration?.kind !== "OFFICIAL_TOTAL_COUNT" || declaration.scope !== "SOURCE" ||
      declaration.channelId !== undefined || declaration.value !== aggregateTotal ||
      declaration.artifactLogicalKey !== declarationArtifact.logicalKey ||
      declaration.extractorLocator !== declarationArtifact.extractorLocator ||
      evidence.fetchCounts.rawCount !== aggregateTotal ||
      evidence.fetchCounts.parsedCount !== aggregateTotal ||
      evidence.fetchCounts.validCount !== aggregateTotal ||
      evidence.fetchCounts.parseDiscardCount !== 0 ||
      evidence.fetchCounts.validationDiscardCount !== 0) {
      return false;
    }

    return strictOutputReplay(plan, outputJobs, expectedOutputJobs);
  } catch {
    return false;
  }
}

function strictLivzonConfig(plan: SourceCrawlPlan): LivzonCeccFetchConfig | undefined {
  if (plan.adapterId !== "official-json" || plan.company.id !== "company-livzon" ||
    plan.company.category !== "DOMESTIC_PHARMA" || plan.source.id !== "source-livzon-social" ||
    plan.source.companyId !== plan.company.id || plan.source.kind !== "SOCIAL" ||
    plan.source.status !== "VERIFIED_SCRAPABLE" || plan.source.atsKind !== "OFFICIAL_JSON" ||
    plan.source.officialEntryUrl !== LIVZON_SOCIAL_INDEX_URL ||
    plan.source.officialChainEvidenceUrl !== LIVZON_SOCIAL_INDEX_URL ||
    plan.json.jobsPath !== "jobs" || plan.json.defaultCategory !== "其他" ||
    !strictJsonFieldMap(plan.json.fields) || plan.officialJsonFetch !== undefined ||
    plan.workday !== undefined || plan.hotjob !== undefined || plan.hotjobLegacy !== undefined ||
    plan.moka !== undefined || plan.profileBoundSource?.kind !== "livzon-cecc" ||
    plan.profileBoundSource.expectedChannelIds !== undefined) {
    return undefined;
  }
  const config = plan.profileBoundSource.config;
  return config.socialIndexUrl === LIVZON_SOCIAL_INDEX_URL &&
    config.listApiUrl === LIVZON_LIST_API_URL &&
    config.routeDeclaredListApiUrl === LIVZON_ROUTE_DECLARED_LIST_API_URL &&
    config.socialPartitionSelector === LIVZON_SOCIAL_PARTITION_SELECTOR &&
    config.pageSize === 6 && config.maxPagesPerPartition === 20 &&
    samePartitions(config.auditedPartitions, CANONICAL_PARTITIONS)
    ? config
    : undefined;
}

function strictJsonFieldMap(fields: object): boolean {
  const record = fields as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify([
    "cities", "locationRaw", "officialTitle", "officialUrl", "sourceJobId"
  ]) && record.sourceJobId === "sourceJobId" && record.officialTitle === "title" &&
    record.officialUrl === "officialUrl" && record.locationRaw === "locationRaw" &&
    record.cities === "cities";
}

function samePartitions(
  actual: readonly LivzonCeccPartitionConfig[],
  expected: readonly LivzonCeccPartitionConfig[]
): boolean {
  return actual.length === expected.length && actual.every((partition, index) => {
    const canonical = expected[index];
    return canonical !== undefined && partition.routePath === canonical.routePath &&
      partition.categoryId === canonical.categoryId && partition.categoryName === canonical.categoryName &&
      JSON.stringify(Object.keys(partition).sort()) ===
        JSON.stringify(["categoryId", "categoryName", "routePath"]);
  });
}

function isExactNetworkArtifact(
  artifact: EvidenceArtifact | undefined,
  expected: {
    kind: EvidenceArtifact["kind"];
    requestedUrl: string;
    contentType: "text/html" | "application/json";
  }
): artifact is EvidenceArtifact {
  return artifact !== undefined && artifact.kind === expected.kind &&
    artifact.bodyRepresentation === "EXACT" && artifact.requestedUrl === expected.requestedUrl &&
    artifact.finalUrl === expected.requestedUrl && artifact.httpStatus !== undefined &&
    artifact.httpStatus >= 200 && artifact.httpStatus < 300 &&
    artifact.contentType?.toLowerCase().startsWith(expected.contentType) === true;
}

function strictSocialPartitionReplay(
  body: string | Uint8Array,
  config: LivzonCeccFetchConfig
): boolean {
  const $ = load(bodyText(body));
  const elements = $(config.socialPartitionSelector!);
  if (elements.length !== config.auditedPartitions.length) return false;
  const discovered = new Map<string, string>();
  let valid = true;
  elements.each((_index, element) => {
    const href = $(element).attr("href")?.trim();
    const name = $(element).text().replace(/\s+/gu, " ").trim();
    if (!href || !name || discovered.has(href)) {
      valid = false;
      return;
    }
    discovered.set(href, name);
  });
  return valid && discovered.size === config.auditedPartitions.length &&
    config.auditedPartitions.every((partition) =>
      discovered.get(partition.routePath) === partition.categoryName
    );
}

function strictRouteReplay(
  body: string | Uint8Array,
  partition: LivzonCeccPartitionConfig,
  config: LivzonCeccFetchConfig
): ReplayedRoute | undefined {
  const $ = load(bodyText(body));
  const candidates: Array<{ config: Record<string, unknown>; element: AnyNode }> = [];
  $('input[name="_config"]').each((_index, element) => {
    const raw = $(element).attr("value");
    if (!raw || !hasUniqueJsonObjectKeys(raw)) return;
    try {
      const parsed = strictRecord(JSON.parse(raw));
      if (parsed) candidates.push({ config: parsed, element });
    } catch {
      // Unrelated malformed widgets never become an audited candidate.
    }
  });
  const bound = candidates.filter((candidate) => {
    const params = strictRecord(candidate.config.params);
    if (!params || !Array.isArray(params.query)) return false;
    const categoryQueries = params.query.filter((query) => {
      const record = strictRecord(query);
      return record?.field === "categoryId" && record.esField === "category.id";
    });
    return categoryQueries.length === 1 &&
      strictRecord(categoryQueries[0])?.value === partition.categoryId;
  });
  if (bound.length !== 1) return undefined;

  const rawParams = strictRecord(bound[0]!.config.params);
  const header = strictRecord(rawParams?.header);
  const rawQuery = Array.isArray(rawParams?.query) ? rawParams.query : undefined;
  const query = rawQuery
    ? rawQuery.map(strictRecord)
    : [];
  if (!rawParams || rawParams.size !== config.pageSize || rawParams.from !== 0 ||
    rawParams._detailId !== partition.categoryId || !header || !rawQuery ||
    query.length !== rawQuery.length || query.some((value) => value === undefined) ||
    !Array.isArray(rawParams.sort) ||
    bound[0]!.config.api !== new URL(config.routeDeclaredListApiUrl).pathname +
      new URL(config.routeDeclaredListApiUrl).search) {
    return undefined;
  }

  const localTotals = $(bound[0]!.element).parent().find('input[name="pageParamsJson"]');
  const totalCandidates = localTotals.length > 0
    ? localTotals
    : $('input[name="pageParamsJson"]');
  const totals: number[] = [];
  totalCandidates.each((_index, element) => {
    const raw = $(element).attr("value");
    if (!raw || !hasUniqueJsonObjectKeys(raw)) return;
    try {
      const parsed = strictRecord(JSON.parse(raw));
      if (parsed?.size === config.pageSize && parsed.from === 0 &&
        isNonnegativeInteger(parsed.totalCount)) {
        totals.push(parsed.totalCount);
      }
    } catch {
      // The bound widget must still provide an unambiguous valid total.
    }
  });
  if (totals.length === 0 || new Set(totals).size !== 1) return undefined;

  return {
    params: {
      size: config.pageSize,
      from: 0,
      query: query as Record<string, unknown>[],
      header: { ...header },
      sort: [...rawParams.sort],
      _detailId: partition.categoryId
    },
    totalCount: totals[0]!
  };
}

function strictApiPage(body: string | Uint8Array): {
  size: number;
  from: number;
  totalCount: number;
  list: unknown[];
} | undefined {
  const root = strictUniqueRecord(body);
  const data = strictRecord(root?.data);
  const page = strictRecord(data?.page);
  if (!data || data.code !== 200 || !page || !Array.isArray(data.list) ||
    !isPositiveInteger(page.size) || !isNonnegativeInteger(page.from) ||
    !isNonnegativeInteger(page.totalCount)) {
    return undefined;
  }
  return {
    size: page.size,
    from: page.from,
    totalCount: page.totalCount,
    list: data.list
  };
}

function strictJobReplay(
  raw: unknown,
  partition: LivzonCeccPartitionConfig
): { officialId: string; output: ExpectedOutputJob } | undefined {
  const record = strictRecord(raw);
  const officialId = strictOfficialId(record);
  const officialTitle = adapterNormalizedDisplayText(record?.title);
  const href = strictText(record?.href) ?? strictText(strictRecord(record?.hrefObject)?.value);
  const categoryName = strictText(record?.categoryName);
  const categorySegments = categoryName?.split("->").map((value) => value.trim()) ?? [];
  if (!record || !officialId || !officialTitle || !href || !categoryName ||
    categorySegments.at(-1) !== partition.categoryName ||
    (categorySegments.length > 1 && categorySegments.at(-2) !== "社会招聘")) {
    return undefined;
  }

  let officialUrl: URL;
  try {
    officialUrl = new URL(href, LIVZON_ORIGIN);
  } catch {
    return undefined;
  }
  if (officialUrl.protocol !== "https:" || officialUrl.origin !== LIVZON_ORIGIN ||
    officialUrl.username || officialUrl.password || officialUrl.search || officialUrl.hash ||
    !/^\/product\/\d+\.html$/u.test(officialUrl.pathname)) {
    return undefined;
  }

  const locationRaw = strictLocation(record.attributeList) ?? "未披露";
  const sourceJobId = `livzon-cecc:sha256:${createHash("sha256")
    .update(`${partition.categoryId}:${officialId}`, "utf8").digest("hex")}`;
  return {
    officialId,
    output: {
      sourceJobId,
      officialTitle,
      officialUrl: officialUrl.href,
      locationRaw,
      cities: [locationRaw]
    }
  };
}

function strictOutputReplay(
  plan: SourceCrawlPlan,
  outputJobs: readonly NormalizedJobRecord[],
  expected: ReadonlyMap<string, ExpectedOutputJob>
): boolean {
  if (outputJobs.length !== expected.size) return false;
  const seen = new Set<string>();
  for (const job of outputJobs) {
    if (!job.sourceJobId || seen.has(job.sourceJobId)) return false;
    seen.add(job.sourceJobId);
    const replayed = expected.get(job.sourceJobId);
    if (!replayed || job.companyId !== plan.company.id || job.sourceId !== plan.source.id ||
      job.sourceKind !== "SOCIAL" || job.atsKind !== "OFFICIAL_JSON" ||
      job.officialChineseCompanyName !== plan.company.officialChineseName ||
      job.officialTitle !== replayed.officialTitle || job.officialUrl !== replayed.officialUrl ||
      job.locationRaw !== replayed.locationRaw || !sameStrings(job.cities, replayed.cities)) {
      return false;
    }
  }
  return seen.size === expected.size;
}

function strictUniqueRecord(body: string | Uint8Array): Record<string, unknown> | undefined {
  const text = bodyText(body);
  if (!hasUniqueJsonObjectKeys(text)) return undefined;
  try {
    return strictRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function strictRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function strictOfficialId(record: Record<string, unknown> | undefined): string | undefined {
  const value = strictText(record?.productId) ?? strictText(record?.code);
  return value && /^\d{1,32}$/u.test(value) ? value : undefined;
}

function strictLocation(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const record = strictRecord(item);
    if (record?.attribute === "工作地点") return adapterNormalizedDisplayText(record.value);
  }
  return undefined;
}

function adapterNormalizedDisplayText(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.replace(/\s+/gu, " ").trim() || undefined
    : undefined;
}

function strictText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonnegativeInteger(value) && value > 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function bodyText(body: string | Uint8Array): string {
  return typeof body === "string" ? body : Buffer.from(body).toString("utf8");
}

function sha256Body(body: string | Uint8Array): string {
  return createHash("sha256")
    .update(typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body))
    .digest("hex");
}
