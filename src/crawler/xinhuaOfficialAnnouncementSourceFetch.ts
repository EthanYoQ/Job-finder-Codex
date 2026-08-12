import { load } from "cheerio";
import type { CompletenessEvidence } from "../domain/company";
import { fetchWithOfficialTimeout } from "./officialHttpRuntimeLimits";
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

export const XINHUA_SOCIAL_DESKTOP_ENTRY_URL = "https://www.xhzy.com/SHZP/index.html";
export const XINHUA_SOCIAL_MOBILE_ENTRY_URL = "https://www.xhzy.com/SHZP/m_index.html";

const XINHUA_ORIGIN = "https://www.xhzy.com";
const MAX_PUBLIC_LIST_PAGES_PER_CHANNEL = 50;

export interface XinhuaOfficialAnnouncementFetchConfig {
  officialOrigin: typeof XINHUA_ORIGIN;
  desktopEntryUrl: typeof XINHUA_SOCIAL_DESKTOP_ENTRY_URL;
  mobileEntryUrl: typeof XINHUA_SOCIAL_MOBILE_ENTRY_URL;
  maxPagesPerChannel: typeof MAX_PUBLIC_LIST_PAGES_PER_CHANNEL;
}

export const XINHUA_OFFICIAL_ANNOUNCEMENT_FETCH_CONFIG = Object.freeze({
  officialOrigin: XINHUA_ORIGIN,
  desktopEntryUrl: XINHUA_SOCIAL_DESKTOP_ENTRY_URL,
  mobileEntryUrl: XINHUA_SOCIAL_MOBILE_ENTRY_URL,
  maxPagesPerChannel: MAX_PUBLIC_LIST_PAGES_PER_CHANNEL
}) satisfies XinhuaOfficialAnnouncementFetchConfig;

export interface XinhuaOfficialAnnouncementProfileBoundSource {
  kind: "xinhua-official-announcements";
  expectedChannelIds: readonly ["desktop", "mobile"];
  config: XinhuaOfficialAnnouncementFetchConfig;
}

export const XINHUA_OFFICIAL_ANNOUNCEMENT_PROFILE_BOUND_SOURCE = Object.freeze({
  kind: "xinhua-official-announcements",
  expectedChannelIds: ["desktop", "mobile"] as const,
  config: XINHUA_OFFICIAL_ANNOUNCEMENT_FETCH_CONFIG
}) satisfies XinhuaOfficialAnnouncementProfileBoundSource;
const LIST_EXTRACTOR_LOCATOR =
  "a[href]:same-origin:/SHZP/(m_)?index(_PAGE)?.html-and-/SHZP/YYYY-MM-DD/(m_)?CONTENT_ID.html";
const DETAIL_EXTRACTOR_LOCATOR = ".RCMS_EDITOR:text:报名时间-and-img";
const DECLARATION_EXTRACTOR_LOCATOR =
  "desktop+mobile:same-origin-public-pagination-complete-traversal-v1";

type XinhuaChannelId = "desktop" | "mobile";

export interface XinhuaOfficialAnnouncementHttpRequest {
  url: string;
  method: "GET";
  headers: Record<string, string>;
}

export interface XinhuaOfficialAnnouncementHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type XinhuaOfficialAnnouncementHttpClient = (
  request: XinhuaOfficialAnnouncementHttpRequest
) => Promise<XinhuaOfficialAnnouncementHttpResponse>;

export interface XinhuaOfficialAnnouncementSourceFetchDeps {
  http?: XinhuaOfficialAnnouncementHttpClient;
  now?: () => Date;
}

interface AnnouncementRef {
  id: string;
  url: string;
}

interface ListPageCapture {
  channelId: XinhuaChannelId;
  pageNumber: number;
  request: XinhuaOfficialAnnouncementHttpRequest;
  response: Required<Pick<XinhuaOfficialAnnouncementHttpResponse, "status" | "body" | "finalUrl" | "contentType" | "capturedAt">>;
  announcementIds: string[];
  nextPageUrl?: string;
  requestPageSignal?: string;
  logicalKey: string;
}

interface DetailCapture {
  announcement: AnnouncementRef;
  request: XinhuaOfficialAnnouncementHttpRequest;
  response: Required<Pick<XinhuaOfficialAnnouncementHttpResponse, "status" | "body" | "finalUrl" | "contentType" | "capturedAt">>;
  logicalKey: string;
}

interface AnnouncementAssessment {
  announcement: AnnouncementRef;
  detail: DetailCapture;
  parsedDeadline: boolean;
  expired: boolean;
  imageCount: number;
  failureCode:
    | "XINHUA_EXPIRED_ANNOUNCEMENT"
    | "XINHUA_ACTIVE_IMAGE_ONLY_UNSTRUCTURED"
    | "XINHUA_ACTIVE_UNSUPPORTED_STRUCTURE"
    | "XINHUA_DEADLINE_UNPROVEN";
}

class XinhuaSourceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "XinhuaSourceError";
  }
}

export function createXinhuaOfficialAnnouncementSourceFetch(
  deps: XinhuaOfficialAnnouncementSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const now = (deps.now ?? (() => new Date()))();
    const capturedAt = now.toISOString();
    const config = exactXinhuaConfig(plan);
    if (!config) {
      return failed(capturedAt, "XINHUA_PLAN_BINDING_INVALID");
    }

    const rawHttp = deps.http ?? defaultXinhuaHttpClient;
    const listPages: ListPageCapture[] = [];
    const details: DetailCapture[] = [];
    const announcements = new Map<string, AnnouncementRef>();

    try {
      const http = async (
        request: XinhuaOfficialAnnouncementHttpRequest
      ): Promise<ListPageCapture["response"]> => {
        assertSafeRequest(request);
        const response = await rawHttp(request);
        return validateResponse(request, response, capturedAt);
      };

      for (const channel of [
        { channelId: "desktop" as const, entryUrl: config.desktopEntryUrl },
        { channelId: "mobile" as const, entryUrl: config.mobileEntryUrl }
      ]) {
        const captures = await traversePublicListChannel(channel, http, announcements, config.maxPagesPerChannel);
        listPages.push(...captures);
      }

      const assessments: AnnouncementAssessment[] = [];
      for (const announcement of [...announcements.values()].sort((a, b) => a.url.localeCompare(b.url, "en"))) {
        const request = getRequest(announcement.url);
        const response = await http(request);
        const detail: DetailCapture = {
          announcement,
          request,
          response,
          logicalKey: `xinhua-detail-${announcement.id}`
        };
        details.push(detail);
        assessments.push(assessAnnouncement(detail, now));
      }

      const { evidence, evaluation } = buildEvidence({
        capturedAt,
        listPages,
        details,
        assessments
      });
      if (!evaluation.safeCompleteness || evaluation.derivedAnomalyCodes.length > 0) {
        return failed(capturedAt, "XINHUA_PAGINATION_EVIDENCE_UNSAFE", evidence, evaluation);
      }

      if (assessments.some((assessment) => !assessment.parsedDeadline)) {
        return failed(capturedAt, "XINHUA_ANNOUNCEMENT_DEADLINE_UNPROVEN", evidence, evaluation);
      }
      if (assessments.some((assessment) =>
        !assessment.expired && assessment.failureCode === "XINHUA_ACTIVE_IMAGE_ONLY_UNSTRUCTURED"
      )) {
        return failed(capturedAt, "XINHUA_ACTIVE_ANNOUNCEMENT_IMAGE_ONLY", evidence, evaluation);
      }
      if (assessments.some((assessment) => !assessment.expired)) {
        return failed(capturedAt, "XINHUA_ACTIVE_ANNOUNCEMENT_UNSUPPORTED_STRUCTURE", evidence, evaluation);
      }

      return {
        ok: true,
        capturedAt,
        payload: { jobs: [] },
        completeness: zeroOpenJobsCompleteness(
          listPages.length,
          evidence.declaredCompleteness?.kind ?? "COMPLETE_PAGE_TRAVERSAL"
        ),
        fetchEvidence: evidence,
        paginationEvaluation: evaluation
      } satisfies SourceFetchResult;
    } catch (error) {
      return failed(capturedAt, safeFailureCode(error));
    }
  };
}

async function traversePublicListChannel(
  channel: { channelId: XinhuaChannelId; entryUrl: string },
  http: (request: XinhuaOfficialAnnouncementHttpRequest) => Promise<ListPageCapture["response"]>,
  announcements: Map<string, AnnouncementRef>,
  maxPages: number
): Promise<ListPageCapture[]> {
  const queue = [channel.entryUrl];
  const queued = new Set(queue);
  const captured = new Map<string, Omit<ListPageCapture, "nextPageUrl" | "previousPageUrl">>();

  while (queue.length > 0) {
    if (captured.size >= maxPages) {
      throw new XinhuaSourceError("XINHUA_PAGINATION_LIMIT_REACHED");
    }
    const url = queue.shift()!;
    const request = getRequest(url);
    const response = await http(request);
    const parsed = parseListPage(response.body, url, channel.channelId);
    const pageNumber = listPageNumber(new URL(url).pathname, channel.channelId);
    const logicalKey = `xinhua-list-${channel.channelId}-${String(pageNumber).padStart(3, "0")}`;
    if ([...captured.values()].some((page) => page.pageNumber === pageNumber)) {
      throw new XinhuaSourceError("XINHUA_DUPLICATE_PUBLIC_PAGE_NUMBER");
    }
    captured.set(url, {
      channelId: channel.channelId,
      pageNumber,
      request,
      response,
      announcementIds: parsed.announcements.map((announcement) => announcement.id),
      logicalKey
    });

    for (const announcement of parsed.announcements) {
      const prior = announcements.get(announcement.id);
      if (prior && prior.url !== announcement.url) {
        throw new XinhuaSourceError("XINHUA_ANNOUNCEMENT_ID_URL_CONFLICT");
      }
      announcements.set(announcement.id, announcement);
    }
    for (const paginationUrl of parsed.paginationUrls) {
      if (!queued.has(paginationUrl)) {
        queued.add(paginationUrl);
        queue.push(paginationUrl);
      }
    }
  }

  const ordered = [...captured.values()].sort((a, b) => a.pageNumber - b.pageNumber);
  if (ordered.some((page, index) => page.pageNumber !== index + 1)) {
    throw new XinhuaSourceError("XINHUA_PAGINATION_SEQUENCE_GAP");
  }
  return ordered.map((page, index) => ({
    ...page,
    // The pagination evaluator expects the request signal used to enter this
    // page, not the URL of the preceding page.
    ...(index > 0 ? { requestPageSignal: page.request.url } : {}),
    ...(index + 1 < ordered.length ? { nextPageUrl: ordered[index + 1]!.request.url } : {})
  }));
}

function parseListPage(
  html: string,
  pageUrl: string,
  channelId: XinhuaChannelId
): { announcements: AnnouncementRef[]; paginationUrls: string[] } {
  const $ = load(html);
  const announcements = new Map<string, AnnouncementRef>();
  const paginationUrls = new Set<string>();

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href")?.trim();
    if (!href) return;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      return;
    }
    const detail = parseDetailPath(url.pathname);
    if (detail) {
      assertSameOfficialOrigin(url);
      const canonical = canonicalDetailUrl(url, detail);
      const prior = announcements.get(detail.id);
      if (prior && prior.url !== canonical) {
        throw new XinhuaSourceError("XINHUA_ANNOUNCEMENT_ID_URL_CONFLICT");
      }
      announcements.set(detail.id, { id: detail.id, url: canonical });
      return;
    }
    if (isListPath(url.pathname, channelId)) {
      assertSameOfficialOrigin(url);
      url.search = "";
      url.hash = "";
      paginationUrls.add(url.toString());
      return;
    }
    if (isListPath(url.pathname, channelId === "desktop" ? "mobile" : "desktop")) {
      assertSameOfficialOrigin(url);
      return;
    }
    const linkText = $(element).text().replace(/\s+/gu, " ").trim();
    const looksLikeRecruitmentItem = $(element).find(".news-item").length > 0 ||
      $(element).closest(".social-recruitment-list").length > 0 ||
      /(?:新华制药|山东新华).{0,30}(?:招聘|岗位|应聘)/u.test(linkText);
    if (looksLikeRecruitmentItem ||
      (url.origin === XINHUA_ORIGIN && /^\/SHZP\//u.test(url.pathname))) {
      throw new XinhuaSourceError("XINHUA_UNSUPPORTED_RECRUITMENT_LINK");
    }
  });

  return {
    announcements: [...announcements.values()].sort((a, b) => a.url.localeCompare(b.url, "en")),
    paginationUrls: [...paginationUrls].sort((a, b) =>
      listPageNumber(new URL(a).pathname, channelId) - listPageNumber(new URL(b).pathname, channelId)
    )
  };
}

function assessAnnouncement(detail: DetailCapture, now: Date): AnnouncementAssessment {
  const $ = load(detail.response.body);
  const editor = $(".RCMS_EDITOR").first();
  if (editor.length !== 1) {
    return assessment(detail, false, false, 0, "XINHUA_DEADLINE_UNPROVEN");
  }
  const text = editor.text().replace(/\s+/gu, " ").trim();
  const deadline = parseUniqueApplicationDeadline(text);
  const imageCount = editor.find("img[src]").length;
  if (!deadline) {
    return assessment(detail, false, false, imageCount, "XINHUA_DEADLINE_UNPROVEN");
  }
  const expired = now.getTime() >= deadline.exclusiveUtcMs;
  if (expired) {
    return assessment(detail, true, true, imageCount, "XINHUA_EXPIRED_ANNOUNCEMENT");
  }
  return assessment(
    detail,
    true,
    false,
    imageCount,
    imageCount > 0
      ? "XINHUA_ACTIVE_IMAGE_ONLY_UNSTRUCTURED"
      : "XINHUA_ACTIVE_UNSUPPORTED_STRUCTURE"
  );
}

function assessment(
  detail: DetailCapture,
  parsedDeadline: boolean,
  expired: boolean,
  imageCount: number,
  failureCode: AnnouncementAssessment["failureCode"]
): AnnouncementAssessment {
  return { announcement: detail.announcement, detail, parsedDeadline, expired, imageCount, failureCode };
}

function parseUniqueApplicationDeadline(text: string): { exclusiveUtcMs: number } | undefined {
  const pattern = /(?:招聘)?报名时间\s*[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:-|－|—|–|至|到|~|～)\s*(\d{4})年(\d{1,2})月(\d{1,2})日/gu;
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return undefined;
  const match = matches[0]!;
  const end = parseCalendarDate(match[4], match[5], match[6]);
  const start = parseCalendarDate(match[1], match[2], match[3]);
  if (!start || !end || start.utcDayMs > end.utcDayMs) return undefined;
  return { exclusiveUtcMs: Date.UTC(end.year, end.month - 1, end.day, 16, 0, 0, 0) };
}

function parseCalendarDate(
  yearRaw: string | undefined,
  monthRaw: string | undefined,
  dayRaw: string | undefined
): { year: number; month: number; day: number; utcDayMs: number } | undefined {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const utcDayMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcDayMs);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return { year, month, day, utcDayMs };
}

function buildEvidence(input: {
  capturedAt: string;
  listPages: readonly ListPageCapture[];
  details: readonly DetailCapture[];
  assessments: readonly AnnouncementAssessment[];
}): { evidence: PersistentSourceFetchEvidence; evaluation: PaginationEvaluation } {
  const first = input.listPages[0];
  if (!first) throw new XinhuaSourceError("XINHUA_LIST_CAPTURE_MISSING");
  const declarationArtifact: SourceFetchArtifactDraft = {
    id: "xinhua-source-declaration",
    logicalKey: "xinhua-source-declaration",
    kind: "OFFICIAL_COMPANY_PAGE",
    requestedUrl: first.request.url,
    finalUrl: first.response.finalUrl,
    httpStatus: first.response.status,
    contentType: first.response.contentType,
    capturedAt: first.response.capturedAt,
    body: first.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: DECLARATION_EXTRACTOR_LOCATOR
  };
  const listArtifacts: SourceFetchArtifactDraft[] = input.listPages.map((page) => ({
    id: page.logicalKey,
    logicalKey: page.logicalKey,
    kind: "PAGINATION_PAGE",
    channelId: page.channelId,
    requestedUrl: page.request.url,
    finalUrl: page.response.finalUrl,
    httpStatus: page.response.status,
    contentType: page.response.contentType,
    capturedAt: page.response.capturedAt,
    body: page.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: LIST_EXTRACTOR_LOCATOR
  }));
  const detailArtifacts: SourceFetchArtifactDraft[] = input.details.map((detail) => ({
    id: detail.logicalKey,
    logicalKey: detail.logicalKey,
    kind: "ATS_PAGE",
    requestedUrl: detail.request.url,
    finalUrl: detail.response.finalUrl,
    httpStatus: detail.response.status,
    contentType: detail.response.contentType,
    capturedAt: detail.response.capturedAt,
    body: detail.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: DETAIL_EXTRACTOR_LOCATOR
  }));

  const pages: SourceFetchPageTrace[] = input.listPages.map((page, sequence) => ({
    sequence,
    artifactLogicalKey: page.logicalKey,
    channelId: page.channelId,
    requestedCursor: null,
    returnedCursor: null,
    requestedOffset: null,
    returnedOffset: null,
    requestedPage: page.pageNumber,
    returnedPage: page.pageNumber,
    requestedPageSize: null,
    returnedPageSize: null,
    rawJobIds: page.announcementIds,
    // These are valid announcement identifiers for traversal replay. Job-level
    // validity remains zero in fetchCounts after the deadline/structure gate.
    validJobIds: page.announcementIds,
    declaredTotal: null,
    declaredCount: null,
    declaredPages: null,
    nextPageSignalBefore: page.requestPageSignal ?? null,
    nextPageSignalAfter: page.nextPageUrl ?? null,
    responseFingerprintSha256: sha256Bytes(Buffer.from(page.response.body, "utf8")).sha256,
    termination: page.nextPageUrl ? "CONTINUE" : page.announcementIds.length === 0 ? "EMPTY_PAGE" : "NEXT_ABSENT",
    anomalyCodes: [],
    capturedAt: page.response.capturedAt
  }));

  // Expired announcements are traversal evidence, not current job records and
  // therefore are neither adapter input nor fetch loss. Only announcements
  // that prevent a zero-open-jobs conclusion are represented as failed input.
  const blockingAssessments = input.assessments.filter((assessment) => !assessment.expired);
  const parseDiscardCount = blockingAssessments.filter((assessment) => !assessment.parsedDeadline).length;
  const validationDiscardCount = blockingAssessments.length - parseDiscardCount;
  const rawEvidence = parsePersistentSourceFetchEvidence({
    captureTool: { name: "xinhua-official-announcement-http", version: "1" },
    artifacts: [declarationArtifact, ...listArtifacts, ...detailArtifacts],
    pages,
    declaredCompleteness: {
      kind: "COMPLETE_PAGE_TRAVERSAL",
      value: pages.length,
      artifactLogicalKey: declarationArtifact.logicalKey,
      extractorLocator: declarationArtifact.extractorLocator,
      scope: "SOURCE"
    },
    fetchCounts: {
      rawCount: blockingAssessments.length,
      parsedCount: blockingAssessments.length - parseDiscardCount,
      validCount: 0,
      parseDiscardCount,
      validationDiscardCount
    },
    fetchLosses: blockingAssessments.map((assessment) => ({
      stage: assessment.parsedDeadline ? "VALIDATION" as const : "PARSE" as const,
      reason: assessment.failureCode,
      rawLocator: `artifact:${assessment.detail.logicalKey}:.RCMS_EDITOR`,
      details: {
        code: assessment.failureCode,
        recordIndex: input.assessments.indexOf(assessment)
      },
      recordedAt: assessment.detail.response.capturedAt
    }))
  });
  const evidence = deriveCanonicalPaginationEvidence({
    evidence: rawEvidence,
    expectedChannelIds: ["desktop", "mobile"],
    filteredOutput: true,
    allowCompleteTraversalOfEmptyFirstPage: true
  });
  const evaluation = evaluatePaginationEvidence({
    evidence,
    expectedChannelIds: ["desktop", "mobile"],
    filteredOutput: true,
    allowCompleteTraversalOfEmptyFirstPage: true
  });
  return { evidence, evaluation };
}

/**
 * Replays the archived official pages without using the fetcher's parsed
 * assessments or its zero-job conclusion. This function is intended to be
 * called by runSourceCrawl's strict, profile-bound gate.
 */
export function validateStrictXinhuaOfficialAnnouncementReplay(
  plan: Parameters<SourceFetchFunction>[0],
  evidenceInput: unknown,
  normalizedOutputJobs: readonly unknown[]
): boolean {
  try {
    const config = exactXinhuaConfig(plan);
    if (!config || normalizedOutputJobs.length !== 0) return false;
    const evidence = parsePersistentSourceFetchEvidence(evidenceInput);
    if (
      evidence.captureTool.name !== "xinhua-official-announcement-http" ||
      evidence.captureTool.version !== "1" ||
      Object.values(evidence.fetchCounts).some((count) => count !== 0) ||
      evidence.fetchLosses.length !== 0 ||
      evidence.supportingArtifactOnlyFailure !== undefined
    ) return false;

    const declaration = evidence.declaredCompleteness;
    const traversalDeclaration = declaration?.kind === "COMPLETE_PAGE_TRAVERSAL" &&
      declaration.value === evidence.pages.length;
    if (
      !traversalDeclaration ||
      declaration.scope !== "SOURCE" ||
      declaration.channelId !== undefined ||
      declaration.artifactLogicalKey !== "xinhua-source-declaration" ||
      declaration.extractorLocator !== DECLARATION_EXTRACTOR_LOCATOR
    ) return false;

    const artifactByKey = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
    const declarationArtifact = artifactByKey.get("xinhua-source-declaration");
    if (!declarationArtifact || !strictReplayNetworkArtifact(declarationArtifact, {
      kind: "OFFICIAL_COMPANY_PAGE",
      url: config.desktopEntryUrl,
      channelId: undefined,
      extractorLocator: DECLARATION_EXTRACTOR_LOCATOR
    })) return false;

    const replayedPages: StrictReplayedListPage[] = [];
    for (const channel of [
      { id: "desktop" as const, entryUrl: config.desktopEntryUrl },
      { id: "mobile" as const, entryUrl: config.mobileEntryUrl }
    ]) {
      const channelArtifacts = evidence.artifacts
        .filter((artifact) => artifact.kind === "PAGINATION_PAGE" && artifact.channelId === channel.id)
        .map((artifact) => strictReplayListArtifact(artifact, channel.id))
        .sort((left, right) => left.pageNumber - right.pageNumber);
      if (
        channelArtifacts.length === 0 ||
        channelArtifacts.length > config.maxPagesPerChannel ||
        channelArtifacts[0]?.url !== channel.entryUrl ||
        channelArtifacts.some((page, index) => page.pageNumber !== index + 1)
      ) return false;

      const capturedUrls = new Set(channelArtifacts.map((page) => page.url));
      if (capturedUrls.size !== channelArtifacts.length) return false;
      for (const page of channelArtifacts) {
        if (page.paginationUrls.some((url) => !capturedUrls.has(url))) return false;
      }
      if (!strictReplayReachablePages(channel.entryUrl, channelArtifacts, capturedUrls)) return false;
      for (let index = 0; index + 1 < channelArtifacts.length; index += 1) {
        if (!channelArtifacts[index]!.paginationUrls.includes(channelArtifacts[index + 1]!.url)) return false;
      }
      replayedPages.push(...channelArtifacts);
    }

    const expectedPageKeys = new Set(replayedPages.map((page) => page.artifact.logicalKey));
    if (evidence.artifacts.filter((artifact) => artifact.kind === "PAGINATION_PAGE").length !== expectedPageKeys.size) {
      return false;
    }
    if (typeof declarationArtifact.body !== "string" || declarationArtifact.body !== replayedPages[0]?.artifact.body) {
      return false;
    }

    if (evidence.pages.length !== replayedPages.length) return false;
    for (let sequence = 0; sequence < replayedPages.length; sequence += 1) {
      const replayed = replayedPages[sequence]!;
      const trace = evidence.pages[sequence];
      const previousInChannel = sequence > 0 && replayedPages[sequence - 1]?.channelId === replayed.channelId
        ? replayedPages[sequence - 1]
        : undefined;
      const nextInChannel = sequence + 1 < replayedPages.length &&
        replayedPages[sequence + 1]?.channelId === replayed.channelId
        ? replayedPages[sequence + 1]
        : undefined;
      const ids = replayed.announcements.map((announcement) => announcement.id);
      const emptyOfficialPage = ids.length === 0 && !nextInChannel;
      if (
        !trace || trace.sequence !== sequence ||
        trace.artifactLogicalKey !== replayed.artifact.logicalKey ||
        trace.channelId !== replayed.channelId ||
        trace.requestedPage !== replayed.pageNumber ||
        trace.returnedPage !== replayed.pageNumber ||
        trace.requestedCursor != null || trace.returnedCursor != null ||
        trace.requestedOffset != null || trace.returnedOffset != null ||
        trace.requestedPageSize != null || trace.returnedPageSize != null ||
        trace.declaredTotal !== null ||
        trace.declaredCount != null || trace.declaredPages != null ||
        JSON.stringify(trace.rawJobIds) !== JSON.stringify(ids) ||
        JSON.stringify(trace.validJobIds) !== JSON.stringify(ids) ||
        trace.nextPageSignalBefore !== (previousInChannel ? replayed.url : null) ||
        trace.nextPageSignalAfter !== (nextInChannel?.url ?? null) ||
        trace.termination !== (nextInChannel ? "CONTINUE" : emptyOfficialPage ? "EMPTY_PAGE" : "NEXT_ABSENT") ||
        trace.responseFingerprintSha256 !== sha256Bytes(Buffer.from(replayed.body, "utf8")).sha256 ||
        trace.capturedAt !== replayed.artifact.capturedAt ||
        trace.anomalyCodes.length !== 0
      ) return false;
    }

    const announcements = new Map<string, AnnouncementRef>();
    for (const page of replayedPages) {
      for (const announcement of page.announcements) {
        const existing = announcements.get(announcement.id);
        if (existing && existing.url !== announcement.url) return false;
        announcements.set(announcement.id, announcement);
      }
    }

    const detailArtifacts = evidence.artifacts.filter((artifact) => artifact.kind === "ATS_PAGE");
    if (detailArtifacts.length !== announcements.size) return false;
    const detailKeys = new Set<string>();
    for (const artifact of detailArtifacts) {
      if (typeof artifact.requestedUrl !== "string") return false;
      const parsedPath = strictReplayDetailPath(new URL(artifact.requestedUrl).pathname);
      if (!parsedPath) return false;
      const announcement = announcements.get(parsedPath.id);
      const expectedKey = `xinhua-detail-${parsedPath.id}`;
      if (
        !announcement || announcement.url !== artifact.requestedUrl ||
        artifact.logicalKey !== expectedKey || detailKeys.has(expectedKey) ||
        !strictReplayNetworkArtifact(artifact, {
          kind: "ATS_PAGE",
          url: announcement.url,
          channelId: undefined,
          extractorLocator: DETAIL_EXTRACTOR_LOCATOR
        }) ||
        typeof artifact.body !== "string" ||
        !strictReplayDetailIsExpired(artifact.body, artifact.capturedAt)
      ) return false;
      detailKeys.add(expectedKey);
    }

    if (evidence.artifacts.length !== 1 + replayedPages.length + detailArtifacts.length) return false;
    const independentEvaluation = evaluatePaginationEvidence({
      evidence,
      expectedChannelIds: ["desktop", "mobile"],
      filteredOutput: true,
      allowCompleteTraversalOfEmptyFirstPage: true
    });
    return independentEvaluation.safeCompleteness === true &&
      independentEvaluation.verifiedEligible === true &&
      independentEvaluation.derivedAnomalyCodes.length === 0;
  } catch {
    return false;
  }
}

interface StrictReplayedListPage {
  artifact: PersistentSourceFetchEvidence["artifacts"][number];
  channelId: XinhuaChannelId;
  pageNumber: number;
  url: string;
  body: string;
  announcements: AnnouncementRef[];
  paginationUrls: string[];
}

function strictReplayListArtifact(
  artifact: PersistentSourceFetchEvidence["artifacts"][number],
  channelId: XinhuaChannelId
): StrictReplayedListPage {
  if (typeof artifact.requestedUrl !== "string" || typeof artifact.body !== "string") {
    throw new XinhuaSourceError("XINHUA_STRICT_LIST_ARTIFACT_INVALID");
  }
  const pageNumber = strictReplayListPageNumber(new URL(artifact.requestedUrl).pathname, channelId);
  if (!strictReplayNetworkArtifact(artifact, {
    kind: "PAGINATION_PAGE",
    url: artifact.requestedUrl,
    channelId,
    extractorLocator: LIST_EXTRACTOR_LOCATOR
  }) || artifact.logicalKey !== `xinhua-list-${channelId}-${String(pageNumber).padStart(3, "0")}`) {
    throw new XinhuaSourceError("XINHUA_STRICT_LIST_ARTIFACT_INVALID");
  }
  const parsed = strictReplayListBody(artifact.body, artifact.requestedUrl, channelId);
  return {
    artifact,
    channelId,
    pageNumber,
    url: artifact.requestedUrl,
    body: artifact.body,
    announcements: parsed.announcements,
    paginationUrls: parsed.paginationUrls
  };
}

function strictReplayNetworkArtifact(
  artifact: PersistentSourceFetchEvidence["artifacts"][number],
  expected: {
    kind: "OFFICIAL_COMPANY_PAGE" | "PAGINATION_PAGE" | "ATS_PAGE";
    url: string;
    channelId: XinhuaChannelId | undefined;
    extractorLocator: string;
  }
): boolean {
  return artifact.kind === expected.kind && artifact.requestedUrl === expected.url &&
    artifact.finalUrl === expected.url && artifact.httpStatus === 200 &&
    /^text\/html\b/iu.test(artifact.contentType ?? "") && artifact.bodyRepresentation === "EXACT" &&
    artifact.channelId === expected.channelId && artifact.extractorLocator === expected.extractorLocator &&
    typeof artifact.body === "string" && artifact.body.trim().length > 0 &&
    Number.isFinite(Date.parse(artifact.capturedAt));
}

function strictReplayListBody(
  html: string,
  pageUrl: string,
  channelId: XinhuaChannelId
): { announcements: AnnouncementRef[]; paginationUrls: string[] } {
  const $ = load(html);
  const announcements = new Map<string, AnnouncementRef>();
  const paginationUrls = new Set<string>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href")?.trim();
    if (!href) return;
    let url: URL;
    try { url = new URL(href, pageUrl); } catch { return; }
    const detail = strictReplayDetailPath(url.pathname);
    if (detail) {
      if (!strictReplayOfficialUrl(url)) throw new XinhuaSourceError("XINHUA_STRICT_DETAIL_ORIGIN_INVALID");
      const canonical = `${XINHUA_ORIGIN}/SHZP/${detail.date}/${detail.contentId}.html`;
      const existing = announcements.get(detail.id);
      if (existing && existing.url !== canonical) {
        throw new XinhuaSourceError("XINHUA_STRICT_DETAIL_CONFLICT");
      }
      announcements.set(detail.id, { id: detail.id, url: canonical });
      return;
    }
    if (strictReplayIsListPath(url.pathname, channelId)) {
      if (!strictReplayOfficialUrl(url)) throw new XinhuaSourceError("XINHUA_STRICT_LIST_ORIGIN_INVALID");
      url.search = "";
      url.hash = "";
      paginationUrls.add(url.toString());
      return;
    }
    if (strictReplayIsListPath(url.pathname, channelId === "desktop" ? "mobile" : "desktop")) {
      if (!strictReplayOfficialUrl(url)) throw new XinhuaSourceError("XINHUA_STRICT_LIST_ORIGIN_INVALID");
      return;
    }
    const linkText = $(element).text().replace(/\s+/gu, " ").trim();
    const looksLikeRecruitmentItem = $(element).find(".news-item").length > 0 ||
      $(element).closest(".social-recruitment-list").length > 0 ||
      /(?:新华制药|山东新华).{0,30}(?:招聘|岗位|应聘)/u.test(linkText);
    if (looksLikeRecruitmentItem ||
      (url.origin === XINHUA_ORIGIN && /^\/SHZP\//u.test(url.pathname))) {
      throw new XinhuaSourceError("XINHUA_STRICT_UNSUPPORTED_RECRUITMENT_LINK");
    }
  });
  return {
    announcements: [...announcements.values()].sort((left, right) => left.url.localeCompare(right.url, "en")),
    paginationUrls: [...paginationUrls].sort((left, right) =>
      strictReplayListPageNumber(new URL(left).pathname, channelId) -
      strictReplayListPageNumber(new URL(right).pathname, channelId))
  };
}

function strictReplayReachablePages(
  entryUrl: string,
  pages: readonly StrictReplayedListPage[],
  capturedUrls: ReadonlySet<string>
): boolean {
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const visited = new Set<string>();
  const queue = [entryUrl];
  while (queue.length > 0) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    const page = byUrl.get(url);
    if (!page) return false;
    visited.add(url);
    for (const next of page.paginationUrls) {
      if (capturedUrls.has(next) && !visited.has(next)) queue.push(next);
    }
  }
  return visited.size === capturedUrls.size;
}

function strictReplayDetailIsExpired(html: string, capturedAt: string): boolean {
  const $ = load(html);
  const editors = $(".RCMS_EDITOR");
  if (editors.length !== 1) return false;
  const text = editors.first().text().replace(/\s+/gu, " ").trim();
  const matches = [...text.matchAll(
    /(?:招聘)?报名时间\s*[：:]\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:-|－|—|–|至|到|~|～)\s*(\d{4})年(\d{1,2})月(\d{1,2})日/gu
  )];
  if (matches.length !== 1) return false;
  const match = matches[0]!;
  const start = strictReplayCalendarDate(match[1], match[2], match[3]);
  const end = strictReplayCalendarDate(match[4], match[5], match[6]);
  if (!start || !end || start.utcDayMs > end.utcDayMs) return false;
  const exclusiveDeadline = Date.UTC(end.year, end.month - 1, end.day, 16, 0, 0, 0);
  const captureMs = Date.parse(capturedAt);
  return Number.isFinite(captureMs) && captureMs >= exclusiveDeadline;
}

function strictReplayCalendarDate(
  yearRaw: string | undefined,
  monthRaw: string | undefined,
  dayRaw: string | undefined
): { year: number; month: number; day: number; utcDayMs: number } | undefined {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const utcDayMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcDayMs);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? { year, month, day, utcDayMs }
    : undefined;
}

function strictReplayOfficialUrl(url: URL): boolean {
  return url.protocol === "https:" && url.origin === XINHUA_ORIGIN &&
    !url.username && !url.password && !url.search && !url.hash;
}

function strictReplayIsListPath(pathname: string, channelId: XinhuaChannelId): boolean {
  return channelId === "desktop"
    ? /^\/SHZP\/index(?:_\d+)?\.html$/u.test(pathname)
    : /^\/SHZP\/m_index(?:_\d+)?\.html$/u.test(pathname);
}

function strictReplayListPageNumber(pathname: string, channelId: XinhuaChannelId): number {
  if (!strictReplayIsListPath(pathname, channelId)) {
    throw new XinhuaSourceError("XINHUA_STRICT_LIST_PATH_INVALID");
  }
  const page = Number(pathname.match(/index(?:_(\d+))?\.html$/u)?.[1] ?? "1");
  if (!Number.isSafeInteger(page) || page < 1) throw new XinhuaSourceError("XINHUA_STRICT_PAGE_INVALID");
  return page;
}

function strictReplayDetailPath(
  pathname: string
): { id: string; date: string; contentId: string } | undefined {
  const match = pathname.match(/^\/SHZP\/(\d{4}-\d{2}-\d{2})\/(?:m_)?(\d+)\.html$/u);
  return match ? { id: `${match[1]}-${match[2]}`, date: match[1]!, contentId: match[2]! } : undefined;
}

function exactXinhuaConfig(
  plan: Parameters<SourceFetchFunction>[0]
): XinhuaOfficialAnnouncementFetchConfig | undefined {
  const config = (plan as typeof plan & {
    profileBoundSource?: XinhuaOfficialAnnouncementProfileBoundSource;
  }).profileBoundSource;
  return plan.adapterId === "official-json" &&
    plan.company.id === "company-xinhua-pharma" &&
    plan.source.id === "source-xinhua-pharma-social" &&
    plan.source.companyId === "company-xinhua-pharma" &&
    plan.source.kind === "SOCIAL" &&
    plan.source.officialEntryUrl === XINHUA_SOCIAL_DESKTOP_ENTRY_URL &&
    plan.source.officialChainEvidenceUrl === XINHUA_SOCIAL_DESKTOP_ENTRY_URL &&
    config?.kind === "xinhua-official-announcements" &&
    config.expectedChannelIds.length === 2 &&
    config.expectedChannelIds[0] === "desktop" &&
    config.expectedChannelIds[1] === "mobile" &&
    config.config.officialOrigin === XINHUA_ORIGIN &&
    config.config.desktopEntryUrl === XINHUA_SOCIAL_DESKTOP_ENTRY_URL &&
    config.config.mobileEntryUrl === XINHUA_SOCIAL_MOBILE_ENTRY_URL &&
    config.config.maxPagesPerChannel === MAX_PUBLIC_LIST_PAGES_PER_CHANNEL
    ? config.config
    : undefined;
}

function getRequest(url: string): XinhuaOfficialAnnouncementHttpRequest {
  return {
    url,
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "User-Agent": "job-search-crawler/0.1"
    }
  };
}

function assertSafeRequest(request: XinhuaOfficialAnnouncementHttpRequest): void {
  if (request.method !== "GET" || request.headers["User-Agent"] !== "job-search-crawler/0.1") {
    throw new XinhuaSourceError("XINHUA_REQUEST_CONTRACT_INVALID");
  }
  const url = new URL(request.url);
  assertSameOfficialOrigin(url);
  if (url.username || url.password || url.search || url.hash ||
      (!isListPath(url.pathname, "desktop") && !isListPath(url.pathname, "mobile") && !parseDetailPath(url.pathname))) {
    throw new XinhuaSourceError("XINHUA_REQUEST_URL_INVALID");
  }
}

function validateResponse(
  request: XinhuaOfficialAnnouncementHttpRequest,
  response: XinhuaOfficialAnnouncementHttpResponse,
  fallbackCapturedAt: string
): ListPageCapture["response"] {
  const finalUrl = response.finalUrl ?? request.url;
  const contentType = response.contentType ?? "";
  const capturedAt = response.capturedAt ?? fallbackCapturedAt;
  if (response.status !== 200 || finalUrl !== request.url || !/^text\/html\b/iu.test(contentType) ||
      response.body.trim().length === 0 || !Number.isFinite(new Date(capturedAt).getTime())) {
    throw new XinhuaSourceError("XINHUA_HTTP_RESPONSE_INVALID");
  }
  assertSafeRequest({ ...request, url: finalUrl });
  return { status: response.status, body: response.body, finalUrl, contentType, capturedAt };
}

function assertSameOfficialOrigin(url: URL): void {
  if (url.origin !== XINHUA_ORIGIN || url.protocol !== "https:" || url.hostname !== "www.xhzy.com") {
    throw new XinhuaSourceError("XINHUA_OFFICIAL_ORIGIN_VIOLATION");
  }
}

function isListPath(pathname: string, channelId: XinhuaChannelId): boolean {
  return channelId === "desktop"
    ? /^\/SHZP\/index(?:_\d+)?\.html$/u.test(pathname)
    : /^\/SHZP\/m_index(?:_\d+)?\.html$/u.test(pathname);
}

function listPageNumber(pathname: string, channelId: XinhuaChannelId): number {
  if (!isListPath(pathname, channelId)) throw new XinhuaSourceError("XINHUA_LIST_PAGE_PATH_INVALID");
  const match = pathname.match(/index(?:_(\d+))?\.html$/u);
  const page = match?.[1] ? Number(match[1]) : 1;
  if (!Number.isSafeInteger(page) || page < 1) throw new XinhuaSourceError("XINHUA_LIST_PAGE_NUMBER_INVALID");
  return page;
}

function parseDetailPath(pathname: string): { id: string; date: string } | undefined {
  const match = pathname.match(/^\/SHZP\/(\d{4}-\d{2}-\d{2})\/(?:m_)?(\d+)\.html$/u);
  if (!match) return undefined;
  return { id: `${match[1]}-${match[2]}`, date: match[1]! };
}

function canonicalDetailUrl(url: URL, detail: { id: string; date: string }): string {
  const contentId = detail.id.slice(detail.date.length + 1);
  return `${XINHUA_ORIGIN}/SHZP/${detail.date}/${contentId}.html`;
}

function zeroOpenJobsCompleteness(
  pagesVisited: number,
  evidenceKind: "OFFICIAL_TOTAL_COUNT" | "OFFICIAL_TOTAL_PAGES" | "COMPLETE_PAGE_TRAVERSAL"
): CompletenessEvidence {
  return {
    completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
    expectedJobCount: 0,
    completenessEvidenceKind: evidenceKind,
    completenessEvidenceUrl: XINHUA_SOCIAL_DESKTOP_ENTRY_URL,
    pagesVisited,
    completenessBlockerReason: "Strict downstream replay has not yet certified this zero-job result"
  };
}

function failed(
  capturedAt: string,
  failureReason: string,
  fetchEvidence?: PersistentSourceFetchEvidence,
  paginationEvaluation?: PaginationEvaluation
): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason,
    ...(fetchEvidence ? { fetchEvidence } : {}),
    ...(paginationEvaluation ? { paginationEvaluation } : {})
  };
}

function safeFailureCode(error: unknown): string {
  return error instanceof XinhuaSourceError ? error.code : "XINHUA_FETCH_FAILED";
}

async function defaultXinhuaHttpClient(
  request: XinhuaOfficialAnnouncementHttpRequest
): Promise<XinhuaOfficialAnnouncementHttpResponse> {
  const response = await fetchWithOfficialTimeout(request.url, {
    method: request.method,
    headers: request.headers,
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
