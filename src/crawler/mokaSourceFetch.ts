import { createDecipheriv } from "node:crypto";
import { load } from "cheerio";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import type { MokaFetchConfig } from "./sourcePlan";
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
import { requestContractV2Locator } from "./strictPageRequestContract";

export interface MokaInitData {
  aesIv: string;
  orgId: string;
  siteId: string;
  mode: string;
}

export interface MokaEncryptedResponse {
  data: string;
  necromancer: string;
}

export interface MokaHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface MokaHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type MokaHttpClient = (request: MokaHttpRequest) => Promise<MokaHttpResponse>;

export interface MokaSourceFetchDeps {
  http?: MokaHttpClient;
  now?: () => Date;
}

const MOKA_JOBS_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
const MOKA_JOB_DETAIL_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/job";
const MOKA_ORIGIN = "https://app.mokahr.com";
const MOKA_PAGE_SIZE = 50;
const MOKA_MAX_REDIRECTS = 10;
const MOKA_MAX_PAGES = 100;

export function createMokaSourceFetch(deps: MokaSourceFetchDeps = {}): SourceFetchFunction {
  return async (plan) => {
    const now = deps.now ?? (() => new Date());
    const capturedAt = now().toISOString();
    const crawlStartedAtMs = Date.parse(capturedAt);
    let previousResponseCapturedAtMs = crawlStartedAtMs;
    let latestEvidence: PersistentSourceFetchEvidence | undefined;
    let latestEvaluation: ReturnType<typeof evaluatePaginationEvidence> | undefined;

    if (plan.source.atsKind !== "MOKA") {
      return failed(capturedAt, "Moka source fetch only supports MOKA sources");
    }

    try {
      const configuredMoka = "moka" in plan ? plan.moka : undefined;
      const campaignBinding = resolveMokaCampaignBinding(plan.source.officialEntryUrl, configuredMoka);
      const http = deps.http ?? createDefaultMokaHttpClient(now);
      const page = await http({
        url: plan.source.officialEntryUrl,
        method: "GET",
        headers: { "User-Agent": "job-search-crawler/0.1" }
      });
      if (page.status < 200 || page.status >= 300) {
        return failed(capturedAt, `Moka entry page returned HTTP ${page.status}`);
      }
      previousResponseCapturedAtMs = assertEvidenceResponse(page, {
        expected: "entry",
        requestedUrl: plan.source.officialEntryUrl,
        allowedEntryRedirect: configuredMoka?.allowedEntryRedirect,
        crawlStartedAtMs,
        previousCapturedAtMs: previousResponseCapturedAtMs,
        observedNowMs: now().getTime()
      });

      const artifacts: SourceFetchArtifactDraft[] = [mokaArtifact({
        logicalKey: "moka-entry-0000",
        kind: "OFFICIAL_COMPANY_PAGE",
        requestedUrl: credentialSafeEntryUrl(plan.source.officialEntryUrl),
        response: page,
        extractorLocator: "html:#init-data[value]"
      })];

      const initData = extractMokaInitData(page.body);
      if (!initData) {
        latestEvidence = mokaEntryFailureEvidence(artifacts[0]!);
        return failed(capturedAt, "Moka init-data was not found or incomplete", latestEvidence);
      }
      assertMokaInitBinding(initData, campaignBinding);

      const jobs: Record<string, unknown>[] = [];
      const pages: SourceFetchPageTrace[] = [];
      const fetchLosses: PersistentSourceFetchEvidence["fetchLosses"] = [];
      let firstPayload: unknown;
      let expectedJobCount: number | undefined;
      let pagesVisited = 0;
      let rawCount = 0;
      let parsedCount = 0;
      let validCount = 0;
      let parseDiscardCount = 0;
      let validationDiscardCount = 0;
      const seenOfficialIds = new Set<string>();
      const seenRawOfficialIds = new Set<string>();

      for (let pageIndex = 0; pageIndex < MOKA_MAX_PAGES; pageIndex += 1) {
        const offset = pageIndex * MOKA_PAGE_SIZE;
        const listRequest: MokaHttpRequest = {
          url: MOKA_JOBS_ENDPOINT,
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=UTF-8",
            Origin: MOKA_ORIGIN,
            Referer: campaignBinding.campaignUrl,
            "User-Agent": "job-search-crawler/0.1"
          },
          body: {
            orgId: initData.orgId,
            siteId: initData.siteId,
            limit: MOKA_PAGE_SIZE,
            offset,
            needStat: true,
            isCampusJob: false,
            site: initData.mode,
            locale: "zh-CN"
          }
        };
        const api = await http(listRequest);
        if (api.status < 200 || api.status >= 300) {
          return failed(capturedAt, `Moka jobs API returned HTTP ${api.status}`);
        }
        previousResponseCapturedAtMs = assertEvidenceResponse(api, {
          expected: "api",
          requestedUrl: MOKA_JOBS_ENDPOINT,
          crawlStartedAtMs,
          previousCapturedAtMs: previousResponseCapturedAtMs,
          observedNowMs: now().getTime()
        });

        const artifactLogicalKey = `moka-page-${String(pageIndex).padStart(4, "0")}`;
        const pageRequestLocator = (baseLocator: string) => requestContractV2Locator(baseLocator, {
          family: "moka", role: "page", method: listRequest.method, url: listRequest.url,
          body: listRequest.body,
          coordinate: { sequence: pageIndex, requestedOffset: offset,
            requestedPage: null, requestedPageSize: MOKA_PAGE_SIZE }
        });
        artifacts.push(mokaArtifact({
          logicalKey: artifactLogicalKey,
          kind: "PAGINATION_PAGE",
          requestedUrl: MOKA_JOBS_ENDPOINT,
          response: api,
          extractorLocator: pageRequestLocator(mokaTotalLocator(artifactLogicalKey, offset))
        }));

        const encrypted = parseEncryptedResponse(api.body);
        if (!encrypted) {
          latestEvidence = mokaFailedPageEvidence({
            artifacts, pages, fetchLosses, rawCount, parsedCount, validCount,
            parseDiscardCount, validationDiscardCount, artifactLogicalKey,
            pageIndex, offset, response: api, code: "INVALID_ENVELOPE"
          });
          return failed(capturedAt, "Moka jobs API returned an invalid encrypted response", latestEvidence);
        }

        let decryptedText: string;
        try {
          decryptedText = decryptMokaText(encrypted, initData.aesIv);
        } catch {
          latestEvidence = mokaFailedPageEvidence({
            artifacts, pages, fetchLosses, rawCount, parsedCount, validCount,
            parseDiscardCount, validationDiscardCount, artifactLogicalKey,
            pageIndex, offset, response: api, code: "DECRYPTION_FAILED"
          });
          return failed(capturedAt, "Moka jobs API response decryption failed", latestEvidence);
        }
        let decrypted: unknown;
        try {
          decrypted = JSON.parse(decryptedText);
        } catch {
          latestEvidence = mokaFailedPageEvidence({
            artifacts, pages, fetchLosses, rawCount, parsedCount, validCount,
            parseDiscardCount, validationDiscardCount, artifactLogicalKey,
            pageIndex, offset, response: api, code: "INVALID_DECRYPTED_JSON"
          });
          return failed(capturedAt, "Moka decrypted response was not valid JSON", latestEvidence);
        }
        let rawPageJobs: unknown[];
        try {
          rawPageJobs = requireMokaJobs(decrypted);
        } catch {
          latestEvidence = mokaFailedPageEvidence({
            artifacts, pages, fetchLosses, rawCount, parsedCount, validCount,
            parseDiscardCount, validationDiscardCount, artifactLogicalKey,
            pageIndex, offset, response: api, code: "INVALID_RECORD_COLLECTION"
          });
          return failed(capturedAt, "Moka decrypted response is missing the required data.jobs array", latestEvidence);
        }
        firstPayload = firstPayload ?? decrypted;
        const totalEvidence = readMokaTotalEvidence(decrypted);
        const pageTotal = totalEvidence?.value;
        artifacts[artifacts.length - 1] = {
          ...artifacts[artifacts.length - 1]!,
          extractorLocator: pageRequestLocator(mokaTotalLocator(artifactLogicalKey, offset, totalEvidence?.jsonPath))
        };
        expectedJobCount = expectedJobCount ?? pageTotal;
        const pageJobs: Record<string, unknown>[] = [];
        const rawJobIds: string[] = [];
        const validJobIds: string[] = [];
        for (let recordIndex = 0; recordIndex < rawPageJobs.length; recordIndex += 1) {
          const raw = rawPageJobs[recordIndex];
          const rawLocator = mokaRawLocator(raw, artifactLogicalKey, pageIndex, recordIndex);
          const rawEvidenceId = irreversibleEvidenceId(mokaJobId(raw) ?? ["missing-id", recordIndex, raw]);
          if (!rawJobIds.includes(rawEvidenceId)) rawJobIds.push(rawEvidenceId);
          rawCount += 1;
          if (!isObject(raw) || Array.isArray(raw)) {
            parseDiscardCount += 1;
            fetchLosses.push({
              stage: "PARSE",
              reason: "Moka record is not an object",
              rawLocator,
              details: { code: "NON_OBJECT_RECORD", pageSequence: pageIndex, recordIndex },
              recordedAt: api.capturedAt
            });
            continue;
          }
          parsedCount += 1;
          const rawOfficialId = mokaJobId(raw);
          if (rawOfficialId) seenRawOfficialIds.add(rawOfficialId);
          let candidate = raw;
          if (
            rawOfficialId &&
            requiredText(raw.title) &&
            citiesFromMokaLocations(raw.locations).length === 0 &&
            configuredMoka?.hydrateMissingLocationsFromDetail
          ) {
            const detailRequest: MokaHttpRequest = {
              url: MOKA_JOB_DETAIL_ENDPOINT,
              method: "POST",
              headers: {
                "Content-Type": "application/json;charset=UTF-8",
                Origin: MOKA_ORIGIN,
                Referer: campaignBinding.campaignUrl,
                "User-Agent": "job-search-crawler/0.1"
              },
              body: {
                orgId: initData.orgId,
                siteId: initData.siteId,
                jobId: rawOfficialId,
                locale: "zh-CN"
              }
            };
            const detail = await http(detailRequest);
            const detailLogicalKey = `moka-detail-${String(pageIndex).padStart(4, "0")}-${String(recordIndex).padStart(4, "0")}`;
            const detailExtractorLocator = requestContractV2Locator(
              `moka-detail-v2|request:jobId64=${Buffer.from(rawOfficialId, "utf8").toString("base64url")}`,
              { family: "moka", role: "detail", method: detailRequest.method, url: detailRequest.url,
                body: detailRequest.body, coordinate: { sequence: pageIndex, recordIndex } }
            );
            let detailEvidenceFailure: Error | undefined;
            try {
              previousResponseCapturedAtMs = assertEvidenceResponse(detail, {
                expected: "api",
                requestedUrl: MOKA_JOB_DETAIL_ENDPOINT,
                crawlStartedAtMs,
                previousCapturedAtMs: previousResponseCapturedAtMs,
                observedNowMs: now().getTime()
              });
            } catch (error) {
              detailEvidenceFailure = error instanceof Error ? error : new Error(String(error));
            }
            const detailValidation = detailEvidenceFailure
              ? { ok: false as const, field: "finalUrl" }
              : validateMokaDetailResponse({
                  response: detail,
                  expectedJobId: rawOfficialId,
                  expectedOrgId: initData.orgId,
                  expectedSiteId: initData.siteId,
                  requestBody: detailRequest.body,
                  allowSiteIdOmission: configuredMoka?.allowDetailSiteIdOmission === true,
                  aesIv: initData.aesIv
                });
            artifacts.push(detailValidation.ok
              ? mokaArtifact({
                  logicalKey: detailLogicalKey,
                  kind: "ATS_API_RESPONSE",
                  requestedUrl: MOKA_JOB_DETAIL_ENDPOINT,
                  response: detail,
                  extractorLocator: detailExtractorLocator
                })
              : mokaRedactedArtifact({
                  logicalKey: detailLogicalKey,
                  requestedUrl: MOKA_JOB_DETAIL_ENDPOINT,
                  response: detail,
                  extractorLocator: detailExtractorLocator,
                  redactionKind: detailValidation.field === "detail"
                    ? "CREDENTIAL_MATERIAL"
                    : "UPSTREAM_ERROR_TEXT"
                }));
            if (!detailValidation.ok) {
              validationDiscardCount += 1;
              fetchLosses.push({
                stage: "VALIDATION",
                reason: "Moka detail hydration failed closed",
                rawLocator,
                details: {
                  code: "DETAIL_HYDRATION_FAILED",
                  field: detailValidation.field,
                  pageSequence: pageIndex,
                  recordIndex
                },
                recordedAt: detail.capturedAt
              });
              latestEvidence = mokaRecordFailureEvidence({
                artifacts, pages, fetchLosses, rawCount, parsedCount, validCount,
                parseDiscardCount, validationDiscardCount, artifactLogicalKey,
                pageIndex, offset, response: api, rawJobIds, validJobIds,
                declaredTotal: pageTotal ?? null
              });
              return failed(
                capturedAt,
                detailEvidenceFailure?.message ?? "Moka detail hydration failed closed",
                latestEvidence
              );
            }
            candidate = { ...raw, locations: detailValidation.locations };
          }

          const missingField = missingMokaRequiredField(candidate);
          if (missingField) {
            validationDiscardCount += 1;
            fetchLosses.push({
              stage: "VALIDATION",
              reason: "Moka record is missing a required field",
              rawLocator,
              details: { code: "MISSING_REQUIRED_FIELD", field: missingField, pageSequence: pageIndex, recordIndex },
              recordedAt: api.capturedAt
            });
            continue;
          }
          const sensitiveField = sensitiveMokaField(candidate);
          if (sensitiveField) {
            validationDiscardCount += 1;
            fetchLosses.push({
              stage: "VALIDATION",
              reason: "Moka record contains sensitive output material",
              rawLocator,
              details: { code: "SENSITIVE_OUTPUT", field: sensitiveField, pageSequence: pageIndex, recordIndex },
              recordedAt: api.capturedAt
            });
            continue;
          }
          if (isExplicitlyOutsideChina(candidate)) {
            validationDiscardCount += 1;
            fetchLosses.push({
              stage: "VALIDATION",
              reason: "Moka record is explicitly outside China scope",
              rawLocator,
              details: { code: "OUT_OF_SCOPE", pageSequence: pageIndex, recordIndex },
              recordedAt: api.capturedAt
            });
            continue;
          }
          const officialId = mokaJobId(candidate)!;
          if (seenOfficialIds.has(officialId)) {
            validationDiscardCount += 1;
            fetchLosses.push({
              stage: "VALIDATION",
              reason: "Moka record duplicates an official job ID",
              rawLocator,
              details: { code: "DUPLICATE_OFFICIAL_ID", field: "id", pageSequence: pageIndex, recordIndex },
              recordedAt: api.capturedAt
            });
            continue;
          }
          seenOfficialIds.add(officialId);
          const enriched = enrichMokaJob(candidate, campaignBinding.campaignUrl);
          if (!isObject(enriched)) throw new Error("Moka validated record did not enrich to an object");
          pageJobs.push(enriched);
          validCount += 1;
          validJobIds.push(irreversibleEvidenceId(mokaJobId(candidate)!));
        }
        pagesVisited += 1;
        jobs.push(...pageJobs);

        const hasNext = pageTotal === undefined
          ? rawPageJobs.length === MOKA_PAGE_SIZE
          : rawCount < pageTotal;
        const isLastAllowedPage = pageIndex === MOKA_MAX_PAGES - 1;
        const returnedOffset = readMokaOffset(decrypted) ?? null;
        const allValidIds = new Set([...pages.flatMap((candidate) => candidate.validJobIds), ...validJobIds]);
        const termination: SourceFetchPageTrace["termination"] = hasNext
          ? (isLastAllowedPage ? "MAX_PAGE_LIMIT" : "CONTINUE")
          : pageTotal === 0 && rawPageJobs.length === 0
            ? "EMPTY_PAGE"
            : pageTotal !== undefined && allValidIds.size === pageTotal
              ? "DECLARED_TOTAL_REACHED"
              : "NEXT_ABSENT";
        pages.push({
          sequence: pageIndex,
          artifactLogicalKey,
          requestedOffset: offset,
          returnedOffset,
          requestedPage: null,
          returnedPage: null,
          requestedPageSize: MOKA_PAGE_SIZE,
          returnedPageSize: null,
          rawJobIds,
          validJobIds,
          declaredTotal: pageTotal ?? null,
          declaredCount: null,
          declaredPages: null,
          nextPageSignalBefore: pageIndex === 0 ? null : String(offset),
          nextPageSignalAfter: hasNext ? String(offset + MOKA_PAGE_SIZE) : null,
          responseFingerprintSha256: sha256Bytes(Buffer.from(api.body, "utf8")).sha256,
          termination,
          anomalyCodes: [],
          capturedAt: api.capturedAt!
        });

        if (!hasNext || isLastAllowedPage) {
          break;
        }
      }

      const officialTotalPage = pages.find((candidate) => candidate.declaredTotal !== null && candidate.declaredTotal !== undefined);
      const rawEvidence = parsePersistentSourceFetchEvidence({
        captureTool: { name: "moka-http", version: "1" },
        artifacts,
        pages,
        ...(officialTotalPage && expectedJobCount !== undefined
          ? {
              declaredCompleteness: {
                kind: "OFFICIAL_TOTAL_COUNT",
                value: expectedJobCount,
                artifactLogicalKey: officialTotalPage.artifactLogicalKey,
                extractorLocator: artifacts.find(
                  (artifact) => artifact.logicalKey === officialTotalPage.artifactLogicalKey
                )!.extractorLocator,
                scope: "SOURCE"
              }
            }
          : {}),
        fetchCounts: { rawCount, parsedCount, validCount, parseDiscardCount, validationDiscardCount },
        fetchLosses
      });
      latestEvidence = rawEvidence;
      const evidence = deriveCanonicalPaginationEvidence({
        evidence: rawEvidence,
        expectedChannelIds: [],
        filteredOutput: true
      });
      latestEvidence = evidence;
      const paginationEvaluation = evaluatePaginationEvidence({
        evidence,
        expectedChannelIds: [],
        filteredOutput: true
      });
      latestEvaluation = paginationEvaluation;
      if (!paginationEvaluation.safeCompleteness) {
        return failed(
          capturedAt,
          `Moka pagination evidence failed: ${paginationEvaluation.derivedAnomalyCodes.join(",")}`,
          evidence,
          paginationEvaluation
        );
      }
      if (
        expectedJobCount !== undefined &&
        (seenRawOfficialIds.size !== expectedJobCount || seenOfficialIds.size !== expectedJobCount || validCount !== expectedJobCount)
      ) {
        return failed(
          capturedAt,
          "Moka declared total does not match unique raw and hydrated valid job IDs",
          evidence,
          paginationEvaluation
        );
      }

      return {
        ok: true,
        capturedAt,
        payload: mergeMokaJobs(firstPayload, jobs),
        completeness:
          expectedJobCount === undefined
            ? {
                completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
                completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
                completenessEvidenceUrl: credentialSafeEntryUrl(plan.source.officialEntryUrl),
                completenessBlockerReason: "Moka response did not include an official total count",
                pageSize: MOKA_PAGE_SIZE,
                pagesVisited
              }
            : {
                completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
                expectedJobCount,
                completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
                completenessEvidenceUrl: credentialSafeEntryUrl(plan.source.officialEntryUrl),
                completenessBlockerReason: "Official Moka total is archived; downstream adapter accounting must prove final dedupe output",
                totalPages: Math.ceil(expectedJobCount / MOKA_PAGE_SIZE),
                pageSize: MOKA_PAGE_SIZE,
                pagesVisited
              },
        fetchEvidence: evidence,
        paginationEvaluation
      };
    } catch (error) {
      return failed(
        capturedAt,
        error instanceof Error ? error.message : String(error),
        latestEvidence,
        latestEvaluation
      );
    }
  };
}

export function extractMokaInitData(html: string): MokaInitData | undefined {
  const $ = load(html);
  const rawValue = $("#init-data").attr("value");
  if (!rawValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      aesIv?: unknown;
      mode?: unknown;
      siteId?: unknown;
      org?: { id?: unknown; siteId?: unknown };
    };
    const aesIv = typeof parsed.aesIv === "string" ? parsed.aesIv : undefined;
    const orgId = typeof parsed.org?.id === "string" ? parsed.org.id : undefined;
    const siteId = stringValue(parsed.siteId ?? parsed.org?.siteId);
    const mode = typeof parsed.mode === "string" ? parsed.mode : undefined;

    if (!aesIv || !orgId || !siteId || !mode) {
      return undefined;
    }

    return { aesIv, orgId, siteId, mode };
  } catch {
    return undefined;
  }
}

export function decryptMokaResponse(response: MokaEncryptedResponse, aesIv: string): unknown {
  return JSON.parse(decryptMokaText(response, aesIv));
}

function decryptMokaText(response: MokaEncryptedResponse, aesIv: string): string {
  const decipher = createDecipheriv(
    "aes-128-cbc",
    Buffer.from(response.necromancer, "utf8"),
    Buffer.from(aesIv, "utf8")
  );
  let decrypted = decipher.update(response.data, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

function createDefaultMokaHttpClient(now: () => Date): MokaHttpClient {
  const cookies = new Map<string, string>();

  return async (request) => defaultMokaHttpClient(request, cookies, now);
}

async function defaultMokaHttpClient(
  request: MokaHttpRequest,
  cookies: Map<string, string>,
  now: () => Date
): Promise<MokaHttpResponse> {
  let currentUrl = request.url;

  for (let redirectCount = 0; redirectCount <= MOKA_MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchWithOfficialTimeout(currentUrl, buildFetchInit(request, cookies));
    storeResponseCookies(response.headers, cookies);

    if (!isRedirect(response.status)) {
      return {
        status: response.status,
        body: await response.text(),
        finalUrl: currentUrl,
        ...(response.headers.get("content-type")
          ? { contentType: response.headers.get("content-type")! }
          : {}),
        capturedAt: now().toISOString()
      };
    }

    const location = response.headers.get("location");
    if (!location) {
      return {
        status: response.status,
        body: await response.text(),
        finalUrl: currentUrl,
        ...(response.headers.get("content-type")
          ? { contentType: response.headers.get("content-type")! }
          : {}),
        capturedAt: now().toISOString()
      };
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("Moka request exceeded redirect limit");
}

function buildFetchInit(request: MokaHttpRequest, cookies: Map<string, string>): RequestInit {
  const init: RequestInit = { method: request.method };

  const headers = new Headers(request.headers);
  const cookieHeader = cookieHeaderValue(cookies);
  if (request.method === "GET" && cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }
  init.headers = headers;

  if (request.body) {
    init.body = JSON.stringify(request.body);
  }

  init.redirect = "manual";

  return init;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function storeResponseCookies(headers: Headers, cookies: Map<string, string>): void {
  for (const setCookie of getSetCookieValues(headers)) {
    const cookiePair = setCookie.split(";")[0]?.trim();
    if (!cookiePair) {
      continue;
    }

    const separatorIndex = cookiePair.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    cookies.set(cookiePair.slice(0, separatorIndex), cookiePair.slice(separatorIndex + 1));
  }
}

function getSetCookieValues(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const setCookieValues = withGetSetCookie.getSetCookie?.();
  if (setCookieValues && setCookieValues.length > 0) {
    return setCookieValues;
  }

  const combinedHeader = headers.get("set-cookie");
  return combinedHeader ? splitCombinedSetCookieHeader(combinedHeader) : [];
}

function splitCombinedSetCookieHeader(header: string): string[] {
  return header.split(/,(?=\s*[^;,]+=)/).map((value) => value.trim()).filter(Boolean);
}

function cookieHeaderValue(cookies: ReadonlyMap<string, string>): string | undefined {
  const pairs = [...cookies.entries()].map(([name, value]) => `${name}=${value}`);
  return pairs.length > 0 ? pairs.join("; ") : undefined;
}

function parseEncryptedResponse(body: string): MokaEncryptedResponse | undefined {
  try {
    const parsed = JSON.parse(body) as Partial<MokaEncryptedResponse>;
    if (typeof parsed.data !== "string" || typeof parsed.necromancer !== "string") {
      return undefined;
    }

    return {
      data: parsed.data,
      necromancer: parsed.necromancer
    };
  } catch {
    return undefined;
  }
}

interface MokaCampaignBinding {
  campaignUrl: string;
  orgId: string;
  siteId: string;
  mode: "social";
}

function resolveMokaCampaignBinding(
  officialEntryUrl: string,
  config: MokaFetchConfig | undefined
): MokaCampaignBinding {
  const officialEntry = new URL(officialEntryUrl);
  if (officialEntry.protocol !== "https:" || officialEntry.username || officialEntry.password) {
    throw new Error("Moka official entry must use credential-free HTTPS");
  }

  const campaign = new URL(config?.campaignUrl ?? credentialSafeEntryUrl(officialEntryUrl));
  if (
    campaign.protocol !== "https:" || campaign.origin !== MOKA_ORIGIN ||
    campaign.username || campaign.password || campaign.search || campaign.hash
  ) {
    throw new Error("Moka campaign URL must be an exact credential-free app.mokahr.com HTTPS URL");
  }
  const parsedCampaign = parseMokaCampaignPath(campaign.pathname);
  if (!parsedCampaign) {
    throw new Error("Moka campaign URL path is not a supported social campaign path");
  }

  if (officialEntry.origin !== MOKA_ORIGIN) {
    const allowed = config?.allowedEntryRedirect;
    if (
      !allowed || allowed.origin !== MOKA_ORIGIN ||
      normalizeMokaPath(allowed.pathname) !== normalizeMokaPath(campaign.pathname)
    ) {
      throw new Error("Moka official-domain entry requires an exact app.mokahr.com redirect allowlist");
    }
  }

  const expected = config
    ? {
        orgId: config.expectedOrgId,
        siteId: config.expectedSiteId,
        mode: config.expectedMode
      }
    : { ...parsedCampaign, mode: "social" as const };
  if (
    expected.mode !== "social" ||
    parsedCampaign.orgId !== expected.orgId || parsedCampaign.siteId !== expected.siteId
  ) {
    throw new Error("Moka configured campaign identity does not match its URL path");
  }
  return {
    campaignUrl: campaign.toString(),
    orgId: expected.orgId,
    siteId: expected.siteId,
    mode: expected.mode
  };
}

function parseMokaCampaignPath(pathname: string): { orgId: string; siteId: string } | undefined {
  const segments = normalizeMokaPath(pathname).split("/").filter(Boolean);
  if (segments[0] === "m") segments.shift();
  if (segments.length !== 3 || !["apply", "social-recruitment"].includes(segments[0]!)) return undefined;
  const orgId = segments[1]?.trim();
  const siteId = segments[2]?.trim();
  return orgId && siteId ? { orgId, siteId } : undefined;
}

function normalizeMokaPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized || "/";
}

function assertMokaInitBinding(initData: MokaInitData, binding: MokaCampaignBinding): void {
  if (
    initData.orgId !== binding.orgId ||
    initData.siteId !== binding.siteId ||
    initData.mode !== binding.mode
  ) {
    throw new Error("Moka init data does not match the bound social campaign");
  }
}

function validateMokaDetailResponse(input: {
  response: MokaHttpResponse;
  expectedJobId: string;
  expectedOrgId: string;
  expectedSiteId: string;
  requestBody: unknown;
  allowSiteIdOmission: boolean;
  aesIv: string;
}): { ok: true; locations: unknown[] } | { ok: false; field: string } {
  if (input.response.status < 200 || input.response.status >= 300) return { ok: false, field: "httpStatus" };
  let detail: unknown;
  let encryptedDetail = false;
  try {
    const parsed = JSON.parse(input.response.body) as unknown;
    const encrypted = parseEncryptedResponse(input.response.body);
    if (encrypted) {
      encryptedDetail = true;
      const decrypted = decryptMokaResponse(encrypted, input.aesIv);
      if (!isObject(decrypted) || decrypted.success !== true || !isObject(decrypted.data) || Array.isArray(decrypted.data)) {
        return { ok: false, field: "body" };
      }
      detail = decrypted.data;
    } else {
      detail = parsed;
    }
  } catch {
    return { ok: false, field: "body" };
  }
  if (!isObject(detail) || Array.isArray(detail)) return { ok: false, field: "body" };
  // Plain JSON is archived as-is, so every field must remain credential-free. Encrypted
  // detail bodies are archived only as ciphertext; inspect just the identity/location
  // fields used for binding or output and ignore unrelated prose that is never persisted.
  if (
    (!encryptedDetail && containsCredentialMaterialDeep(detail)) ||
    containsMokaDetailCredentialMaterial(detail)
  ) return { ok: false, field: "detail" };
  if (mokaJobId(detail) !== input.expectedJobId) return { ok: false, field: "id" };
  if (stringValue(detail.orgId) !== input.expectedOrgId) return { ok: false, field: "orgId" };
  const returnedSiteId = stringValue(detail.siteId);
  if (returnedSiteId !== undefined && returnedSiteId !== input.expectedSiteId) {
    return { ok: false, field: "siteId" };
  }
  if (
    returnedSiteId === undefined &&
    (!input.allowSiteIdOmission || !isExactMokaDetailRequestBinding(input.requestBody, input))
  ) return { ok: false, field: "siteId" };
  if (!Array.isArray(detail.locations) || citiesFromMokaLocations(detail.locations).length === 0) {
    return { ok: false, field: "locations" };
  }
  return { ok: true, locations: detail.locations };
}

function isExactMokaDetailRequestBinding(
  value: unknown,
  expected: Pick<Parameters<typeof validateMokaDetailResponse>[0], "expectedJobId" | "expectedOrgId" | "expectedSiteId">
): boolean {
  return isObject(value) && !Array.isArray(value) &&
    stringValue(value.jobId) === expected.expectedJobId &&
    stringValue(value.orgId) === expected.expectedOrgId &&
    stringValue(value.siteId) === expected.expectedSiteId;
}

function containsMokaDetailCredentialMaterial(detail: Record<string, unknown>): boolean {
  for (const value of [detail.id, detail.orgId, detail.siteId, detail.title]) {
    const text = stringValue(value);
    if (text && containsCredentialMaterial(text)) return true;
  }
  if (!Array.isArray(detail.locations)) return false;
  return detail.locations.some((location) => {
    if (!isObject(location) || Array.isArray(location)) return false;
    return [location.cityName, location.provinceName, location.country].some((value) => {
      const text = stringValue(value);
      return text ? containsCredentialMaterial(text) : false;
    });
  });
}

function containsCredentialMaterialDeep(value: unknown): boolean {
  if (typeof value === "string") return containsCredentialMaterial(value);
  if (Array.isArray(value)) return value.some(containsCredentialMaterialDeep);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, candidate]) =>
    WORKDAY_TASK5C_SENSITIVE_ASSIGNMENT_KEYS.has(
      key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "")
    ) || containsCredentialMaterialDeep(candidate)
  );
}

function assertEvidenceResponse(
  response: MokaHttpResponse,
  input: {
    expected: "entry" | "api";
    requestedUrl: string;
    allowedEntryRedirect?: MokaFetchConfig["allowedEntryRedirect"];
    crawlStartedAtMs: number;
    previousCapturedAtMs: number;
    observedNowMs: number;
  }
): number {
  assertEvidenceResponseShape(response, input.expected);
  const finalUrl = new URL(response.finalUrl!);
  const requestedUrl = new URL(input.requestedUrl);
  const exactRequestedEntry =
    input.expected === "entry" &&
    finalUrl.protocol === "https:" && !finalUrl.username && !finalUrl.password &&
    finalUrl.origin === requestedUrl.origin &&
    normalizeMokaPath(finalUrl.pathname) === normalizeMokaPath(requestedUrl.pathname);
  const exactAllowedEntryRedirect =
    input.expected === "entry" && input.allowedEntryRedirect !== undefined &&
    finalUrl.protocol === "https:" && !finalUrl.username && !finalUrl.password &&
    finalUrl.origin === input.allowedEntryRedirect.origin &&
    normalizeMokaPath(finalUrl.pathname) === normalizeMokaPath(input.allowedEntryRedirect.pathname);
  const exactMokaApi =
    input.expected === "api" &&
    finalUrl.protocol === "https:" && !finalUrl.username && !finalUrl.password &&
    finalUrl.origin === requestedUrl.origin && requestedUrl.origin === MOKA_ORIGIN &&
    normalizeMokaPath(finalUrl.pathname) === normalizeMokaPath(requestedUrl.pathname) &&
    !finalUrl.search && !finalUrl.hash;
  const trustedMokaUrl = exactRequestedEntry || exactAllowedEntryRedirect || exactMokaApi;
  if (!trustedMokaUrl) {
    throw new Error(`Moka ${input.expected} response has an invalid final URL`);
  }
  const capturedAtMs = strictEvidenceInstant(response.capturedAt!);
  if (capturedAtMs < input.crawlStartedAtMs) {
    throw new Error("Moka response captured time precedes crawl start");
  }
  if (capturedAtMs > input.observedNowMs) {
    throw new Error("Moka response captured time is unexpectedly in the future");
  }
  if (capturedAtMs < input.previousCapturedAtMs) {
    throw new Error("Moka response captured time must be non-decreasing");
  }
  return capturedAtMs;
}

function assertEvidenceResponseShape(response: MokaHttpResponse, expected: "entry" | "api"): void {
  if (
    typeof response.finalUrl !== "string" || !response.finalUrl ||
    typeof response.contentType !== "string" || !response.contentType.trim() ||
    typeof response.capturedAt !== "string"
  ) {
    throw new Error("Moka response is missing required evidence metadata (final URL, content type, or captured time)");
  }
  const essence = response.contentType.split(";", 1)[0]!.trim().toLowerCase();
  const validContentType = expected === "entry"
    ? essence === "text/html"
    : essence === "application/json" || /^application\/[a-z0-9.+-]+\+json$/.test(essence);
  if (!validContentType) {
    throw new Error(`Moka ${expected} response has an invalid Content-Type`);
  }
  sanitizeEvidenceHttpUrl(credentialSafeEntryUrl(response.finalUrl));
}

function strictEvidenceInstant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("Moka response captured time must be a canonical UTC instant");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("Moka response captured time is invalid");
  }
  return parsed.getTime();
}

function mokaArtifact(input: {
  logicalKey: string;
  kind: "OFFICIAL_COMPANY_PAGE" | "PAGINATION_PAGE" | "ATS_API_RESPONSE";
  requestedUrl: string;
  response: MokaHttpResponse;
  extractorLocator: string;
}): SourceFetchArtifactDraft {
  assertEvidenceResponseShape(input.response, input.kind === "OFFICIAL_COMPANY_PAGE" ? "entry" : "api");
  return {
    id: input.logicalKey,
    logicalKey: input.logicalKey,
    kind: input.kind,
    requestedUrl: sanitizeEvidenceHttpUrl(credentialSafeEntryUrl(input.requestedUrl)),
    finalUrl: sanitizeEvidenceHttpUrl(credentialSafeEntryUrl(input.response.finalUrl!)),
    httpStatus: input.response.status,
    contentType: input.response.contentType!,
    capturedAt: input.response.capturedAt!,
    body: input.response.body,
    extractorLocator: input.extractorLocator
  };
}

function mokaRedactedArtifact(input: {
  logicalKey: string;
  requestedUrl: string;
  response: MokaHttpResponse;
  extractorLocator: string;
  redactionKind: "CREDENTIAL_MATERIAL" | "UPSTREAM_ERROR_TEXT";
}): SourceFetchArtifactDraft {
  assertEvidenceResponseShape(input.response, "api");
  return {
    id: input.logicalKey,
    logicalKey: input.logicalKey,
    kind: "ATS_API_RESPONSE",
    requestedUrl: sanitizeEvidenceHttpUrl(credentialSafeEntryUrl(input.requestedUrl)),
    finalUrl: sanitizeEvidenceHttpUrl(credentialSafeEntryUrl(input.response.finalUrl!)),
    httpStatus: input.response.status,
    contentType: input.response.contentType!,
    capturedAt: input.response.capturedAt!,
    body: "[redacted]",
    bodyRepresentation: "REDACTED",
    rawBodySha256: sha256Bytes(Buffer.from(input.response.body, "utf8")).sha256,
    redactionDescriptors: [{ kind: input.redactionKind, count: 1 }],
    extractorLocator: input.extractorLocator
  };
}

function mokaTotalLocator(artifactLogicalKey: string, offset: number, jsonPath = "unavailable"): string {
  return `moka-envelope-v1|raw:${artifactLogicalKey}|request:offset=${offset},limit=${MOKA_PAGE_SIZE}` +
    `|init:moka-entry-0000|decrypt:aes-128-cbc-v1|json:${jsonPath}`;
}

function mokaEntryFailureEvidence(entryArtifact: SourceFetchArtifactDraft): PersistentSourceFetchEvidence {
  const body = typeof entryArtifact.body === "string"
    ? Buffer.from(entryArtifact.body, "utf8")
    : Buffer.from(entryArtifact.body);
  const fingerprint = sha256Bytes(body).sha256;
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "moka-http", version: "1" },
    artifacts: [entryArtifact],
    pages: [{
      sequence: 0,
      artifactLogicalKey: entryArtifact.logicalKey,
      requestedCursor: null,
      returnedCursor: null,
      requestedOffset: null,
      returnedOffset: null,
      requestedPage: null,
      returnedPage: null,
      requestedPageSize: null,
      returnedPageSize: null,
      rawJobIds: [`sha256:${fingerprint}`],
      validJobIds: [],
      declaredTotal: null,
      declaredCount: null,
      declaredPages: null,
      nextPageSignalBefore: null,
      nextPageSignalAfter: null,
      responseFingerprintSha256: fingerprint,
      termination: "FAILED",
      anomalyCodes: [],
      capturedAt: entryArtifact.capturedAt
    }],
    fetchCounts: {
      rawCount: 1,
      parsedCount: 0,
      validCount: 0,
      parseDiscardCount: 1,
      validationDiscardCount: 0
    },
    fetchLosses: [{
      stage: "PARSE",
      reason: "Moka entry init data is missing or invalid",
      rawLocator: `${entryArtifact.logicalKey}#sha256:${fingerprint}`,
      details: { code: "INVALID_INIT_DATA", pageSequence: 0 },
      recordedAt: entryArtifact.capturedAt
    }]
  });
}

function mokaFailedPageEvidence(input: {
  artifacts: SourceFetchArtifactDraft[];
  pages: SourceFetchPageTrace[];
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"];
  rawCount: number;
  parsedCount: number;
  validCount: number;
  parseDiscardCount: number;
  validationDiscardCount: number;
  artifactLogicalKey: string;
  pageIndex: number;
  offset: number;
  response: MokaHttpResponse;
  code: "INVALID_ENVELOPE" | "DECRYPTION_FAILED" | "INVALID_DECRYPTED_JSON" | "INVALID_RECORD_COLLECTION";
}): PersistentSourceFetchEvidence {
  const rawLocator = `${input.artifactLogicalKey}#response#sha256:${
    sha256Bytes(Buffer.from(input.response.body, "utf8")).sha256
  }`;
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "moka-http", version: "1" },
    artifacts: input.artifacts,
    pages: [
      ...input.pages,
      {
        sequence: input.pageIndex,
        artifactLogicalKey: input.artifactLogicalKey,
        requestedOffset: input.offset,
        returnedOffset: null,
        requestedPage: null,
        returnedPage: null,
        requestedPageSize: MOKA_PAGE_SIZE,
        returnedPageSize: null,
        rawJobIds: [irreversibleEvidenceId(input.response.body)],
        validJobIds: [],
        declaredTotal: null,
        declaredCount: null,
        declaredPages: null,
        nextPageSignalBefore: input.pageIndex === 0 ? null : String(input.offset),
        nextPageSignalAfter: null,
        responseFingerprintSha256: sha256Bytes(Buffer.from(input.response.body, "utf8")).sha256,
        termination: "FAILED",
        anomalyCodes: [],
        capturedAt: input.response.capturedAt!
      }
    ],
    fetchCounts: {
      rawCount: input.rawCount + 1,
      parsedCount: input.parsedCount,
      validCount: input.validCount,
      parseDiscardCount: input.parseDiscardCount + 1,
      validationDiscardCount: input.validationDiscardCount
    },
    fetchLosses: [
      ...input.fetchLosses,
      {
        stage: "PARSE",
        reason: "Moka response could not be converted to a record collection",
        rawLocator,
        details: { code: input.code, pageSequence: input.pageIndex },
        recordedAt: input.response.capturedAt
      }
    ]
  });
}

function mokaRecordFailureEvidence(input: {
  artifacts: SourceFetchArtifactDraft[];
  pages: SourceFetchPageTrace[];
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"];
  rawCount: number;
  parsedCount: number;
  validCount: number;
  parseDiscardCount: number;
  validationDiscardCount: number;
  artifactLogicalKey: string;
  pageIndex: number;
  offset: number;
  response: MokaHttpResponse;
  rawJobIds: string[];
  validJobIds: string[];
  declaredTotal: number | null;
}): PersistentSourceFetchEvidence {
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "moka-http", version: "1" },
    artifacts: input.artifacts,
    pages: [
      ...input.pages,
      {
        sequence: input.pageIndex,
        artifactLogicalKey: input.artifactLogicalKey,
        requestedOffset: input.offset,
        returnedOffset: null,
        requestedPage: null,
        returnedPage: null,
        requestedPageSize: MOKA_PAGE_SIZE,
        returnedPageSize: null,
        rawJobIds: input.rawJobIds,
        validJobIds: input.validJobIds,
        declaredTotal: input.declaredTotal,
        declaredCount: null,
        declaredPages: null,
        nextPageSignalBefore: input.pageIndex === 0 ? null : String(input.offset),
        nextPageSignalAfter: null,
        responseFingerprintSha256: sha256Bytes(Buffer.from(input.response.body, "utf8")).sha256,
        termination: "FAILED",
        anomalyCodes: [],
        capturedAt: input.response.capturedAt!
      }
    ],
    fetchCounts: {
      rawCount: input.rawCount,
      parsedCount: input.parsedCount,
      validCount: input.validCount,
      parseDiscardCount: input.parseDiscardCount,
      validationDiscardCount: input.validationDiscardCount
    },
    fetchLosses: input.fetchLosses
  });
}

function credentialSafeEntryUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function readMokaTotalEvidence(payload: unknown): { value: number; jsonPath: string } | undefined {
  if (!isObject(payload) || !isObject(payload.data)) {
    return undefined;
  }

  const stats = isObject(payload.data.jobStats) ? payload.data.jobStats : undefined;
  const candidates: Array<[unknown, string]> = [
    [stats?.total, "$.data.jobStats.total"],
    [payload.data.total, "$.data.total"],
    [payload.data.count, "$.data.count"]
  ];
  for (const [candidate, jsonPath] of candidates) {
    const value = numberValue(candidate);
    if (value !== undefined) return { value, jsonPath };
  }
  return undefined;
}

function requireMokaJobs(payload: unknown): unknown[] {
  if (!isObject(payload) || !isObject(payload.data) || !Array.isArray(payload.data.jobs)) {
    throw new Error("Moka decrypted response is missing the required data.jobs array");
  }

  return payload.data.jobs;
}

function readMokaOffset(payload: unknown): number | undefined {
  if (!isObject(payload) || !isObject(payload.data)) return undefined;
  return numberValue(payload.data.offset);
}

function mergeMokaJobs(firstPayload: unknown, jobs: unknown[]): unknown {
  void firstPayload;
  return {
    success: true,
    data: { jobs }
  };
}

function enrichMokaJob(job: unknown, officialEntryUrl: string): unknown {
  if (!isObject(job)) {
    return job;
  }

  const sourceJobId = mokaJobId(job);
  const cities = citiesFromMokaLocations(job.locations);

  return {
    id: irreversibleEvidenceId(sourceJobId),
    title: requiredText(job.title),
    officialUrl: buildMokaJobUrl(officialEntryUrl, sourceJobId!),
    locationRaw: cities.join("、"),
    cities
  };
}

function buildMokaJobUrl(officialEntryUrl: string, sourceJobId: string): string {
  const url = new URL(officialEntryUrl);
  url.search = "";
  url.hash = `/job/${encodeURIComponent(sourceJobId)}`;
  return url.toString();
}

function mokaRawLocator(
  raw: unknown,
  artifactLogicalKey: string,
  pageSequence: number,
  recordIndex: number
): string {
  return `${artifactLogicalKey}#page-${pageSequence}#record-${recordIndex}#sha256:${
    sha256Bytes(Buffer.from(JSON.stringify(raw), "utf8")).sha256
  }`;
}

function irreversibleEvidenceId(value: unknown): string {
  return `sha256:${sha256Bytes(Buffer.from(JSON.stringify(value), "utf8")).sha256}`;
}

function missingMokaRequiredField(job: Record<string, unknown>): string | undefined {
  if (!mokaJobId(job)) return "id";
  if (!requiredText(job.title)) return "title";
  if (citiesFromMokaLocations(job.locations).length === 0) return "locations";
  return undefined;
}

function mokaJobId(job: unknown): string | undefined {
  if (!isObject(job) || Array.isArray(job)) return undefined;
  if (typeof job.id === "string") return job.id.trim() || undefined;
  if (typeof job.id === "number" && Number.isSafeInteger(job.id)) return String(job.id);
  return undefined;
}

function requiredText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function isExplicitlyOutsideChina(job: Record<string, unknown>): boolean {
  if (!Array.isArray(job.locations) || job.locations.length === 0) return false;
  const countries = job.locations.flatMap((location) => {
    if (!isObject(location)) return [];
    const country = stringValue(location.country);
    return country ? [normalizeCountry(country)] : [];
  });
  return countries.length > 0 && countries.every((country) => !CHINA_COUNTRY_ALIASES.has(country));
}

const CHINA_COUNTRY_ALIASES = new Set([
  "cn", "prc", "china", "mainlandchina", "peoplesrepublicofchina",
  "中国", "中国大陆", "大陆", "中华人民共和国"
]);

function normalizeCountry(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, "");
}

function sensitiveMokaField(job: Record<string, unknown>): "id" | "title" | "locations" | undefined {
  const id = mokaJobId(job);
  if (id && containsCredentialMaterial(id)) return "id";
  const title = requiredText(job.title);
  if (title && containsCredentialMaterial(title)) return "title";
  if (Array.isArray(job.locations)) {
    for (const location of job.locations) {
      if (!isObject(location) || Array.isArray(location)) continue;
      for (const value of [location.cityName, location.provinceName, location.country]) {
        const text = requiredText(value);
        if (text && containsCredentialMaterial(text)) return "locations";
      }
    }
  }
  return undefined;
}

function containsCredentialMaterial(value: string): boolean {
  const decoded = decodeCredentialText(value);
  if (/\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]{4,}/i.test(decoded)) return true;
  const assignments = decoded.matchAll(/([A-Za-z][A-Za-z0-9_.-]{1,63})\s*[:=]\s*([^\s,;]+)/g);
  for (const match of assignments) {
    const key = match[1]!.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (WORKDAY_TASK5C_SENSITIVE_ASSIGNMENT_KEYS.has(key) && match[2]) return true;
  }
  return false;
}

// Explicitly aligned with the Workday/Task 5C credential boundary; kept local
// because the existing Workday scanner is private and has different return semantics.
const WORKDAY_TASK5C_SENSITIVE_ASSIGNMENT_KEYS = new Set([
  "auth", "authorization", "basic", "bearer", "cookie", "password", "passwd", "pwd",
  "secret", "session", "sessionid", "credential", "token", "sourcetoken",
  "accesstoken", "refreshtoken", "apikey", "clientsecret", "jwt", "xapikey"
]);

function decodeCredentialText(value: string): string {
  let decoded = value.normalize("NFKC");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded).normalize("NFKC");
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.normalize("NFKC");
}

function citiesFromMokaLocations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((location) => {
      if (!isObject(location)) {
        return undefined;
      }

      return stringValue(location.cityName ?? location.provinceName ?? location.country);
    })
    .filter((city): city is string => Boolean(city));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
