import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { CITY_PENDING } from "../domain/jobLocation";
import { GRIFOLS_POSTED_DATE_POLICY, grifolsOfficialPostedDate } from "./grifolsOfficialPostedDate";
import { load } from "cheerio";
import { fetchWithOfficialTimeout } from "./officialHttpRuntimeLimits";
import type { NormalizedJobRecord } from "./normalizedJob";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import {
  parsePersistentSourceFetchEvidence,
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import type { SourceCrawlPlan } from "./sourcePlan";

const GRIFOLS_ENTRY = "https://jobsearch.grifols.com/search/?createNewAlert=false&q=&locationsearch=China";
const GRIFOLS_ORIGIN = "https://jobsearch.grifols.com";
const PAGE_SIZE = 25;
const MAX_PAGES = 20;
const LIST_LOCATOR = "grifols-successfactors-list-v1|locationsearch:China|html:#searchresults tbody tr.data-row";
const DETAIL_LOCATOR = "grifols-successfactors-detail-v1|html:canonical+streetAddress+content-location";

const SAFE_FAILURES = new Set([
  "GRIFOLS_DETAIL_FETCH_FAILED",
  "GRIFOLS_POSTED_DATE_INVALID",
  "GRIFOLS_DETAIL_INVALID",
  "GRIFOLS_DETAIL_SCOPE_AMBIGUOUS",
  "GRIFOLS_LIST_FETCH_FAILED",
  "GRIFOLS_LIST_INVALID",
  "GRIFOLS_PAGINATION_DRIFT",
  "GRIFOLS_PLAN_BINDING_INVALID"
]);

export interface GrifolsChinaFetchConfig {
  officialSearchUrl: typeof GRIFOLS_ENTRY;
  pageSize: typeof PAGE_SIZE;
  maxPages: typeof MAX_PAGES;
  detailScopePolicy: "GRIFOLS_SUCCESSFACTORS_DETAIL_CANONICAL_MAINLAND_V2";
  postedDatePolicy: typeof GRIFOLS_POSTED_DATE_POLICY;
}

export const GRIFOLS_CHINA_FETCH_CONFIG = Object.freeze({
  officialSearchUrl: GRIFOLS_ENTRY,
  pageSize: PAGE_SIZE,
  maxPages: MAX_PAGES,
  detailScopePolicy: "GRIFOLS_SUCCESSFACTORS_DETAIL_CANONICAL_MAINLAND_V2",
  postedDatePolicy: GRIFOLS_POSTED_DATE_POLICY
}) satisfies GrifolsChinaFetchConfig;

export interface GrifolsChinaHttpRequest {
  url: string;
  method: "GET";
  headers: Record<string, string>;
}

export interface GrifolsChinaHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type GrifolsChinaHttpClient = (
  request: GrifolsChinaHttpRequest
) => Promise<GrifolsChinaHttpResponse>;

export interface GrifolsChinaSourceFetchDeps {
  http?: GrifolsChinaHttpClient;
  now?: () => Date;
}

interface GrifolsListJob {
  postedDateLabels: string[];
  officialId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
}

interface GrifolsListPage {
  page: number;
  totalPages: number;
  total: number;
  jobs: GrifolsListJob[];
}

interface CapturedListPage extends GrifolsListPage {
  requestUrl: string;
  artifact: SourceFetchArtifactDraft;
}

interface DetailReview {
  scope: "CHINA" | "OUT_OF_SCOPE" | "AMBIGUOUS";
  officialLocation: string;
  cities: string[];
}

export function isSafeGrifolsChinaFailureCode(value: unknown): value is string {
  return typeof value === "string" && SAFE_FAILURES.has(value);
}

export function createGrifolsChinaSourceFetch(
  deps: GrifolsChinaSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const now = deps.now ?? (() => new Date());
    const capturedAt = now().toISOString();
    const config = exactGrifolsConfig(plan);
    if (!config) return failed(capturedAt, "GRIFOLS_PLAN_BINDING_INVALID");
    const http = deps.http ?? defaultGrifolsHttp;
    const listPages: CapturedListPage[] = [];
    const artifacts: SourceFetchArtifactDraft[] = [];
    const pages: SourceFetchPageTrace[] = [];
    const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
    const jobs: Array<GrifolsListJob & { sourceJobId: string; cities: string[]; officialPublishedAt?: string }> = [];
    let declaredTotal: number | undefined;
    let declaredPages: number | undefined;
    let previousCapturedAt = Date.parse(capturedAt);

    const fail = (reason: string, evidence?: PersistentSourceFetchEvidence,
      evaluation?: ReturnType<typeof evaluatePaginationEvidence>): SourceFetchResult => {
      const retained = evidence ?? (artifacts.length > 0 ? parsePersistentSourceFetchEvidence({
        captureTool: { name: "grifols-successfactors-http", version: "1" },
        artifacts: artifacts.map(artifact => ({ ...artifact, kind: "ATS_PAGE" })), pages: [],
        supportingArtifactOnlyFailure: { code: "GRIFOLS_POSTED_DATE_SOURCE_FAILURE" },
        fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
        fetchLosses: []
      }) : undefined);
      return failed(capturedAt, reason, retained, evaluation);
    };

    for (let page = 1; page <= config.maxPages; page += 1) {
      const requestUrl = grifolsListUrl(config, page);
      const response = await requestGrifols(http, requestUrl, capturedAt, previousCapturedAt);
      if (!response.ok) return fail("GRIFOLS_LIST_FETCH_FAILED");
      previousCapturedAt = Date.parse(response.value.capturedAt!);
      const parsed = parseGrifolsListPage(response.value.body);
      if (!parsed || parsed.page !== page) return fail("GRIFOLS_LIST_INVALID");
      if (declaredTotal === undefined) declaredTotal = parsed.total;
      if (declaredPages === undefined) declaredPages = parsed.totalPages;
      if (parsed.total !== declaredTotal || parsed.totalPages !== declaredPages ||
        parsed.totalPages > config.maxPages) return fail("GRIFOLS_PAGINATION_DRIFT");
      const logicalKey = `grifols-list-${String(page - 1).padStart(4, "0")}`;
      const artifact = networkArtifact(logicalKey, "PAGINATION_PAGE", requestUrl, response.value, LIST_LOCATOR);
      artifacts.push(artifact);
      listPages.push({ ...parsed, requestUrl, artifact });
      if (page === parsed.totalPages) break;
    }
    if (declaredTotal === undefined || declaredPages === undefined || listPages.length !== declaredPages) {
      return fail("GRIFOLS_PAGINATION_DRIFT");
    }
    const rawJobs = listPages.flatMap((page) => page.jobs);
    if (rawJobs.length !== declaredTotal || new Set(rawJobs.map((job) => job.officialId)).size !== rawJobs.length) {
      return fail("GRIFOLS_PAGINATION_DRIFT");
    }

    const acceptedIds = new Set<string>();
    for (let index = 0; index < rawJobs.length; index += 1) {
      const job = rawJobs[index]!;
      const detailResponse = await requestGrifols(http, job.officialUrl, capturedAt, previousCapturedAt);
      if (!detailResponse.ok) return fail("GRIFOLS_DETAIL_FETCH_FAILED");
      previousCapturedAt = Date.parse(detailResponse.value.capturedAt!);
      const logicalKey = `grifols-detail-${String(index).padStart(4, "0")}`;
      artifacts.push(networkArtifact(logicalKey, "ATS_PAGE", job.officialUrl, detailResponse.value, DETAIL_LOCATOR));
      const review = reviewGrifolsDetail(detailResponse.value.body, job);
      if (!review) return fail("GRIFOLS_DETAIL_INVALID");
      if (review.scope === "AMBIGUOUS") return fail("GRIFOLS_DETAIL_SCOPE_AMBIGUOUS");
      if (review.scope === "OUT_OF_SCOPE") {
        losses.push({
          stage: "VALIDATION",
          reason: "official detail places the job outside mainland China",
          rawLocator: `${logicalKey}#${DETAIL_LOCATOR}`,
          details: { code: "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE", recordIndex: index }
        });
        continue;
      }
      const officialPublishedAt = grifolsOfficialPostedDate(job.postedDateLabels, detailResponse.value.body);
      acceptedIds.add(job.officialId);
      jobs.push({ ...job, sourceJobId: job.officialId, cities: review.cities, ...(officialPublishedAt === undefined ? {} : {officialPublishedAt}) });
    }

    for (let sequence = 0; sequence < listPages.length; sequence += 1) {
      const page = listPages[sequence]!;
      const rawIds = page.jobs.map((job) => evidenceId(job.officialId));
      const validIds = page.jobs.filter((job) => acceptedIds.has(job.officialId))
        .map((job) => evidenceId(job.officialId));
      pages.push({
        sequence,
        artifactLogicalKey: page.artifact.logicalKey,
        requestedCursor: null,
        returnedCursor: null,
        requestedOffset: (page.page - 1) * config.pageSize,
        returnedOffset: null,
        requestedPage: page.page,
        returnedPage: page.page,
        requestedPageSize: config.pageSize,
        returnedPageSize: null,
        rawJobIds: rawIds,
        validJobIds: validIds,
        declaredTotal: page.total,
        declaredCount: page.jobs.length,
        declaredPages: page.totalPages,
        nextPageSignalBefore: sequence === 0 ? null : `offset:${sequence * config.pageSize}`,
        nextPageSignalAfter: sequence + 1 < listPages.length ? `offset:${(sequence + 1) * config.pageSize}` : null,
        responseFingerprintSha256: sha256Bytes(Buffer.from(page.artifact.body as string, "utf8")).sha256,
        termination: sequence + 1 < listPages.length ? "CONTINUE" : "NEXT_ABSENT",
        anomalyCodes: [],
        capturedAt: page.artifact.capturedAt
      });
    }
    const evidence0 = parsePersistentSourceFetchEvidence({
      captureTool: { name: "grifols-successfactors-http", version: "1" },
      artifacts,
      pages,
      declaredCompleteness: {
        kind: "OFFICIAL_TOTAL_COUNT",
        value: declaredTotal,
        artifactLogicalKey: listPages[0]!.artifact.logicalKey,
        extractorLocator: LIST_LOCATOR,
        scope: "SOURCE"
      },
      fetchCounts: {
        rawCount: rawJobs.length,
        parsedCount: rawJobs.length,
        validCount: jobs.length,
        parseDiscardCount: 0,
        validationDiscardCount: losses.length
      },
      fetchLosses: losses
    });
    if (losses.some(loss => loss.details.code === "GRIFOLS_POSTED_DATE_INVALID")) {
      return fail("GRIFOLS_POSTED_DATE_INVALID", evidence0);
    }
    const paginationOptions = {
      expectedChannelIds: [] as string[],
      filteredOutput: true,
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      allowIndependentlyVerifiedProfileBoundExclusions: true
    };
    const evidence = deriveCanonicalPaginationEvidence({ evidence: evidence0, ...paginationOptions });
    const paginationEvaluation = evaluatePaginationEvidence({ evidence, ...paginationOptions });
    if (!paginationEvaluation.safeCompleteness) {
      return fail("GRIFOLS_PAGINATION_DRIFT", evidence, paginationEvaluation);
    }
    return {
      ok: true,
      capturedAt,
      payload: { jobs },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: declaredTotal,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: config.officialSearchUrl,
        completenessBlockerReason: "Grifols detail exclusions require independent archived-evidence replay",
        totalPages: declaredPages,
        pageSize: config.pageSize,
        pagesVisited: listPages.length
      },
      fetchEvidence: evidence,
      paginationEvaluation
    };
  };
}

export function validateStrictGrifolsChinaEvidence(
  plan: SourceCrawlPlan,
  evidenceInput: unknown,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  try {
    const config = exactGrifolsConfig(plan);
    if (!config) return false;
    const evidence = parsePersistentSourceFetchEvidence(evidenceInput);
    if (evidence.captureTool.name !== "grifols-successfactors-http" ||
      evidence.captureTool.version !== "1" || evidence.supportingArtifactOnlyFailure ||
      evidence.fetchCounts.parseDiscardCount !== 0) return false;
    const listArtifacts = evidence.artifacts.filter((artifact) => /^grifols-list-\d{4}$/u.test(artifact.logicalKey));
    const detailArtifacts = evidence.artifacts.filter((artifact) => /^grifols-detail-\d{4}$/u.test(artifact.logicalKey));
    if (listArtifacts.length === 0 || listArtifacts.length !== evidence.pages.length) return false;
    const listed: GrifolsListJob[] = [];
    let total: number | undefined;
    let totalPages: number | undefined;
    for (let sequence = 0; sequence < listArtifacts.length; sequence += 1) {
      const artifact = listArtifacts[sequence]!;
      const expectedUrl = grifolsListUrl(config, sequence + 1);
      if (!exactNetworkArtifact(artifact, "PAGINATION_PAGE", expectedUrl, LIST_LOCATOR)) return false;
      const parsed = parseGrifolsListPage(artifact.body as string);
      if (!parsed || parsed.page !== sequence + 1) return false;
      total ??= parsed.total;
      totalPages ??= parsed.totalPages;
      if (parsed.total !== total || parsed.totalPages !== totalPages) return false;
      listed.push(...parsed.jobs);
    }
    if (total === undefined || totalPages !== listArtifacts.length || listed.length !== total ||
      new Set(listed.map(job => job.officialId)).size !== listed.length ||
      detailArtifacts.length !== listed.length || evidence.artifacts.length !== listArtifacts.length + detailArtifacts.length) {
      return false;
    }
    const expectedJobs: Array<GrifolsListJob & { sourceJobId: string; cities: string[]; officialPublishedAt?: string }> = [];
    const expectedLossIndexes: number[] = [];
    for (let index = 0; index < listed.length; index += 1) {
      const artifact = detailArtifacts[index]!;
      const listedJob = listed[index]!;
      if (!artifact || artifact.logicalKey !== `grifols-detail-${String(index).padStart(4, "0")}` ||
        !exactNetworkArtifact(artifact, "ATS_PAGE", listedJob.officialUrl, DETAIL_LOCATOR)) return false;
      const review = reviewGrifolsDetail(artifact.body as string, listedJob);
      if (!review || review.scope === "AMBIGUOUS") return false;
      if (review.scope === "OUT_OF_SCOPE") {
        expectedLossIndexes.push(index);
        continue;
      }
      const officialPublishedAt = grifolsOfficialPostedDate(listedJob.postedDateLabels, artifact.body as string);
      expectedJobs.push({ ...listedJob, sourceJobId: listedJob.officialId, cities: review.cities, ...(officialPublishedAt === undefined ? {} : {officialPublishedAt}) });
    }
    const losses = evidence.fetchLosses;
    if (losses.length !== expectedLossIndexes.length || losses.some((loss, index) =>
      loss.stage !== "VALIDATION" || loss.reason !== "official detail places the job outside mainland China" ||
      loss.details.code !== "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE" ||
      loss.details.recordIndex !== expectedLossIndexes[index])) return false;
    if (evidence.fetchCounts.rawCount !== total || evidence.fetchCounts.parsedCount !== total ||
      evidence.fetchCounts.validCount !== expectedJobs.length ||
      evidence.fetchCounts.validationDiscardCount !== expectedLossIndexes.length) return false;
    const declaration = evidence.declaredCompleteness;
    if (declaration?.kind !== "OFFICIAL_TOTAL_COUNT" || declaration.scope !== "SOURCE" ||
      declaration.value !== total || declaration.artifactLogicalKey !== listArtifacts[0]!.logicalKey ||
      declaration.extractorLocator !== LIST_LOCATOR) return false;
    if (!exactGrifolsPages(evidence.pages, listArtifacts, listed, expectedJobs, config)) return false;
    const expectedOutput = expectedJobs.map((job) => ({
      sourceJobId: job.sourceJobId,
      officialTitle: job.title,
      officialUrl: job.officialUrl,
      locationRaw: job.locationRaw,
      cities: job.cities,
      officialPublishedAt: job.officialPublishedAt
    })).sort(compareJob);
    const actualOutput = outputJobs.map((job) => ({
      sourceJobId: job.sourceJobId,
      officialTitle: job.officialTitle,
      officialUrl: job.officialUrl,
      locationRaw: job.locationRaw,
      cities: job.cities,
      officialPublishedAt: job.officialPublishedAt
    })).sort(compareJob);
    if (JSON.stringify(expectedOutput) !== JSON.stringify(actualOutput)) return false;
    const evaluated = evaluatePaginationEvidence({
      evidence,
      expectedChannelIds: [],
      filteredOutput: true,
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      allowIndependentlyVerifiedProfileBoundExclusions: true
    });
    return evaluated.safeCompleteness && evaluated.verifiedEligible && evaluated.derivedAnomalyCodes.length === 0;
  } catch {
    return false;
  }
}

export function getStrictGrifolsChinaNetworkPolicy(plan: SourceCrawlPlan): {
  urlRules: Array<{
    id: string;
    url: string;
    match: "EXACT" | "PATH_PREFIX";
    allowsPagination?: true;
    allowsDeclaration?: true;
    allowsPositiveTotalDeclaration?: true;
  }>;
  allowPositiveOfficialTotalCountAfterAdapterReconciliation: true;
  allowIndependentlyVerifiedProfileBoundExclusions: true;
} | undefined {
  if (!exactGrifolsConfig(plan)) return undefined;
  const config = GRIFOLS_CHINA_FETCH_CONFIG;
  return {
    urlRules: [
      ...Array.from({ length: config.maxPages }, (_, index) => ({
        id: `profile-grifols-list-${index + 1}`,
        url: grifolsListUrl(config, index + 1),
        match: "EXACT" as const,
        allowsPagination: true as const,
        allowsDeclaration: true as const,
        allowsPositiveTotalDeclaration: true as const
      })),
      { id: "profile-grifols-detail", url: `${GRIFOLS_ORIGIN}/job/`, match: "PATH_PREFIX" }
    ],
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true
  };
}

export function parseGrifolsListPage(html: string): GrifolsListPage | undefined {
  const $ = load(html);
  const label = $(".paginationLabel").first().text().replace(/\s+/gu, " ").trim();
  const labelMatch = /(?:Results\s+)?(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/iu.exec(label);
  const aria = $("#searchresults[aria-label]").first().attr("aria-label") ?? "";
  const pageMatch = /Page\s+(\d+)\s+of\s+(\d+)/iu.exec(aria);
  if (!labelMatch || !pageMatch) return undefined;
  const first = Number(labelMatch[1]), last = Number(labelMatch[2]), total = Number(labelMatch[3]);
  const page = Number(pageMatch[1]), totalPages = Number(pageMatch[2]);
  if (![first, last, total, page, totalPages].every(Number.isSafeInteger) ||
    first < 1 || last < first || total < last || page < 1 || totalPages < page) return undefined;
  const jobs: GrifolsListJob[] = [];
  $("#searchresults tbody tr.data-row").each((_index, row) => {
    const anchor = $(row).find(".jobTitle.hidden-phone a.jobTitle-link").first();
    const href = anchor.attr("href");
    const title = anchor.text().replace(/\s+/gu, " ").trim();
    const locationRaw = $(row).find(".colLocation.hidden-phone .jobLocation").first().text()
      .replace(/\s+/gu, " ").trim();
    const officialUrl = href ? safeGrifolsJobUrl(href) : undefined;
    const officialId = officialUrl ? /\/(\d+)\/$/u.exec(new URL(officialUrl).pathname)?.[1] : undefined;
    if (!officialId || !title || !locationRaw || !officialUrl) return;
    const postedDateLabels = $(row).find(".jobDate").toArray().map(element => $(element).text().replace(/\s+/gu, " ").trim());
    jobs.push({ officialId, title, officialUrl, locationRaw, postedDateLabels });
  });
  if (jobs.length !== last - first + 1) return undefined;
  return { page, totalPages, total, jobs };
}

function reviewGrifolsDetail(html: string, listed: GrifolsListJob): DetailReview | undefined {
  const $ = load(html);
  const canonical = $("link[rel='canonical']").first().attr("href");
  const streetAddress = $(".jobDisplayShell meta[itemprop='streetAddress']").first().attr("content")?.trim();
  if (canonical !== listed.officialUrl || streetAddress !== listed.locationRaw) return undefined;
  const statements = $(".jobDisplayShell .jobDisplay .content b, .jobDisplayShell .jobDisplay .content strong")
    .toArray().map((element) => {
      const label = $(element).text().replace(/\s+/gu, " ").trim();
      if (!/^Location\s*:/iu.test(label)) return undefined;
      // An inline span is not a location boundary: its same-paragraph siblings
      // may contradict the label. Stay inside the nearest bounded text block.
      const parent = $(element).parent();
      const standaloneComplete = !/^Location\s*:$/iu.test(label) &&
        parent.is(".content") && parent.children().length === 1;
      const block = standaloneComplete ? parent : $(element).closest("p, li");
      if (block.length !== 1 || (!standaloneComplete && block.is(".content, .jobDisplay, .jobDisplayShell")) ||
        block.closest(".content")[0] !== $(element).closest(".content")[0] ||
        block.find("p, div, li, section, table").length > 0) return "Location:";
      if (!/^Location\s*:$/iu.test(label)) {
        // A complete bold statement cannot silently discard text at any inline
        // wrapper level. Siblings are only checked for ambiguity, never promoted
        // into location evidence for a non-exact label.
        let child = $(element);
        while (child[0] !== block[0]) {
          const mixedSiblings = child.parent().contents().toArray().some((sibling) => {
            if (sibling === child[0]) return false;
            const text = $(sibling).text().trim();
            return text.length > 0 && (!$(sibling).is("b, strong") || !/^Location\s*:/iu.test(text));
          });
          if (mixedSiblings) return "Location:";
          child = child.parent();
        }
        return label;
      }
      // Only the exact split label permits reading this block's text. Never climb
      // to the whole description or borrow a following paragraph.
      const text = block.text().replace(/\s+/gu, " ").trim();
      if (text.length > 512 || !/^Location\s*:/iu.test(text)) return label;
      return text;
    }).filter((value): value is string => value !== undefined)
    .map((value) => value.replace(/\s*:\s*/gu, ":").replace(/^Location:/iu, "Location:"));
  const locations = [...new Set(statements)];
  const officialLocation = locations.join(" | ");
  const ambiguous: DetailReview = { scope: "AMBIGUOUS", officialLocation, cities: [] };
  if (locations.length !== 1) return ambiguous;

  // A bounded nationwide China statement need not repeat a historical city or punctuation.
  const nationwide = /^Location:(?:Open to candidates\s+)?(?:across|throughout)\s+(?:mainland\s+)?China(?:,\s*not limited to\s+([^.;]+))?\.?$/iu.exec(officialLocation);
  if (nationwide && !explicitlyForeignOrNonMainlandLocation(officialLocation) &&
    !explicitlyForeignOrNonMainlandLocation(nationwide[1] ?? "")) {
    return listed.locationRaw === "Home Office, CN"
      ? { scope: "CHINA", officialLocation, cities: ["全国"] }
      : ambiguous;
  }
  if (listed.locationRaw === "Shanghai, CN" &&
    /^Location:APAC:China:Shanghai:(?:Shanghai|Shangai)$/iu.test(officialLocation)) {
    return { scope: "CHINA", officialLocation, cities: ["上海"] };
  }
  if (/^Location:APAC:China:[^:]+(?::[^:]+)*$/iu.test(officialLocation) && /, CN$/u.test(listed.locationRaw) &&
    !explicitlyForeignOrNonMainlandLocation(officialLocation.replaceAll(":", ",")) && !explicitlyForeignOrNonMainlandLocation(listed.locationRaw)) {
    return { scope: "CHINA", officialLocation, cities: [CITY_PENDING] };
  }
  if (listed.locationRaw === "Home Office, CN" &&
    /^Location:APAC:(Hong Kong|香港|Macao|Macau|澳门|Taiwan|台湾):Home Office:\1$/iu.test(officialLocation)) {
    return { scope: "OUT_OF_SCOPE", officialLocation, cities: [] };
  }
  return ambiguous;
}

function exactGrifolsPages(
  pages: readonly SourceFetchPageTrace[],
  artifacts: readonly PersistentSourceFetchEvidence["artifacts"][number][],
  listed: readonly GrifolsListJob[],
  accepted: readonly GrifolsListJob[],
  config: GrifolsChinaFetchConfig
): boolean {
  const acceptedIds = new Set(accepted.map((job) => job.officialId));
  let offset = 0;
  return pages.length === artifacts.length && pages.every((page, sequence) => {
    const artifact = artifacts[sequence]!;
    const parsed = parseGrifolsListPage(artifact.body as string);
    if (!parsed) return false;
    const rawIds = parsed.jobs.map((job) => evidenceId(job.officialId));
    const validIds = parsed.jobs.filter((job) => acceptedIds.has(job.officialId)).map((job) => evidenceId(job.officialId));
    const expectedOffset = offset;
    offset += parsed.jobs.length;
    const last = sequence === pages.length - 1;
    return page.sequence === sequence && page.artifactLogicalKey === artifact.logicalKey &&
      page.requestedOffset === (parsed.page - 1) * config.pageSize && page.returnedOffset === null &&
      page.requestedPage === parsed.page && page.returnedPage === parsed.page &&
      page.requestedPageSize === config.pageSize && page.returnedPageSize === null &&
      JSON.stringify(page.rawJobIds) === JSON.stringify(rawIds) &&
      JSON.stringify(page.validJobIds) === JSON.stringify(validIds) &&
      page.declaredTotal === listed.length && page.declaredCount === parsed.jobs.length &&
      page.declaredPages === pages.length &&
      page.nextPageSignalBefore === (sequence === 0 ? null : `offset:${(parsed.page - 1) * config.pageSize}`) &&
      page.nextPageSignalAfter === (last ? null : `offset:${parsed.page * config.pageSize}`) &&
      page.termination === (last ? "NEXT_ABSENT" : "CONTINUE") &&
      page.responseFingerprintSha256 === sha256Bytes(Buffer.from(artifact.body as string, "utf8")).sha256 &&
      expectedOffset === listed.slice(0, expectedOffset).length && page.anomalyCodes.length === 0;
  });
}

function exactGrifolsConfig(plan: SourceCrawlPlan): GrifolsChinaFetchConfig | undefined {
  if (plan.adapterId !== "official-json" || plan.company.id !== "company-grifols-china" ||
    plan.source.id !== "source-grifols-china-social" || plan.source.companyId !== "company-grifols-china" ||
    plan.source.atsKind !== "OFFICIAL_JSON" || plan.source.officialEntryUrl !== GRIFOLS_ENTRY ||
    plan.profileBoundSource?.kind !== "grifols-china-detail-scope") return undefined;
  const config = plan.profileBoundSource.config;
  return config.officialSearchUrl === GRIFOLS_ENTRY && config.pageSize === PAGE_SIZE &&
    config.maxPages === MAX_PAGES && config.detailScopePolicy === "GRIFOLS_SUCCESSFACTORS_DETAIL_CANONICAL_MAINLAND_V2" &&
    config.postedDatePolicy === GRIFOLS_POSTED_DATE_POLICY &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    plan.json.fields.sourceJobId === "sourceJobId" && plan.json.fields.officialTitle === "title" &&
    plan.json.fields.officialUrl === "officialUrl" && plan.json.fields.locationRaw === "locationRaw" &&
    plan.json.fields.cities === "cities" && plan.json.fields.officialPublishedAt === "officialPublishedAt"
    ? config : undefined;
}

function grifolsListUrl(config: GrifolsChinaFetchConfig, page: number): string {
  if (page === 1) return config.officialSearchUrl;
  const url = new URL(config.officialSearchUrl);
  url.searchParams.set("startrow", String((page - 1) * config.pageSize));
  return url.toString();
}

async function requestGrifols(
  http: GrifolsChinaHttpClient,
  url: string,
  crawlStartedAt: string,
  previousCapturedAt: number
): Promise<{ ok: true; value: GrifolsChinaHttpResponse } | { ok: false }> {
  try {
    const response = await http({
      url,
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "job-search-crawler/0.1" }
    });
    const captured = Date.parse(response.capturedAt ?? "");
    if (response.status !== 200 || response.finalUrl !== url ||
      !/^text\/html(?:\s*;|$)/iu.test(response.contentType ?? "") ||
      !Number.isFinite(captured) || captured < Date.parse(crawlStartedAt) || captured < previousCapturedAt) {
      return { ok: false };
    }
    return { ok: true, value: response };
  } catch {
    return { ok: false };
  }
}

function networkArtifact(
  logicalKey: string,
  kind: "PAGINATION_PAGE" | "ATS_PAGE",
  url: string,
  response: GrifolsChinaHttpResponse,
  extractorLocator: string
): SourceFetchArtifactDraft {
  return {
    id: logicalKey,
    logicalKey,
    kind,
    requestedUrl: url,
    finalUrl: response.finalUrl!,
    httpStatus: response.status,
    contentType: response.contentType!,
    capturedAt: response.capturedAt!,
    body: response.body,
    bodyRepresentation: "EXACT",
    extractorLocator
  };
}

function exactNetworkArtifact(
  artifact: PersistentSourceFetchEvidence["artifacts"][number],
  kind: "PAGINATION_PAGE" | "ATS_PAGE",
  url: string,
  locator: string
): boolean {
  const evidenceUrl = sanitizeEvidenceHttpUrl(url);
  return artifact.kind === kind && artifact.requestedUrl === evidenceUrl && artifact.finalUrl === evidenceUrl &&
    artifact.httpStatus === 200 && /^text\/html(?:\s*;|$)/iu.test(artifact.contentType ?? "") &&
    artifact.bodyRepresentation === "EXACT" && typeof artifact.body === "string" && artifact.body.trim().length > 0 &&
    artifact.extractorLocator === locator && Number.isFinite(Date.parse(artifact.capturedAt));
}

function safeGrifolsJobUrl(value: string): string | undefined {
  try {
    const url = new URL(value, GRIFOLS_ORIGIN);
    if (url.origin !== GRIFOLS_ORIGIN || url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || !/^\/job\/[^/]+\/\d+\/$/u.test(url.pathname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}


function evidenceId(officialId: string): string {
  return `grifols:sha256:${sha256Bytes(Buffer.from(officialId, "utf8")).sha256}`;
}

function compareJob(
  left: { sourceJobId?: string | undefined },
  right: { sourceJobId?: string | undefined }
): number {
  return Buffer.from(left.sourceJobId ?? "", "utf8").compare(Buffer.from(right.sourceJobId ?? "", "utf8"));
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

async function defaultGrifolsHttp(request: GrifolsChinaHttpRequest): Promise<GrifolsChinaHttpResponse> {
  const response = await fetchWithOfficialTimeout(request.url, {
    method: request.method,
    headers: request.headers,
    redirect: "follow"
  });
  return {
    status: response.status,
    body: await response.text(),
    finalUrl: response.url,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    capturedAt: new Date().toISOString()
  };
}
