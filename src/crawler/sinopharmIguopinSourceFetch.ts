import { createHash } from "node:crypto";
import { load } from "cheerio";
import { fetchWithOfficialTimeout } from "./officialHttpRuntimeLimits";
import { irreversibleOfficialJsonEvidenceId } from "./officialJsonEvidence";
import {
  deriveCanonicalPaginationEvidence,
  evaluatePaginationEvidence
} from "./paginationEvidence";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import type { SourceCrawlPlan } from "./sourcePlan";
import {
  parsePersistentSourceFetchEvidence,
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export interface SinopharmIguopinFetchConfig {
  officialTalentHubUrl: string;
  officialRecruitmentUrl: string;
  officialWechatArticleUrl: string;
  exclusiveEntryUrl: string;
  exclusiveInfoUrl: string;
  projectJobsUrl: string;
  expectedDomain: string;
  expectedCompanyId: string;
  expectedCompanyName: string;
  pageSize: number;
  maxPages: number;
}

export interface SinopharmIguopinHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface SinopharmIguopinHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type SinopharmIguopinHttpClient = (
  request: SinopharmIguopinHttpRequest
) => Promise<SinopharmIguopinHttpResponse>;

export interface SinopharmIguopinSourceFetchDeps {
  http?: SinopharmIguopinHttpClient;
  now?: () => Date;
}

export interface SinopharmIguopinStrictReplayInput {
  plan: SourceCrawlPlan;
  evidence: unknown;
  outputJobs: readonly {
    sourceJobId?: unknown;
    companyId?: unknown;
    sourceId?: unknown;
  }[];
}

export interface SinopharmIguopinReplayResult {
  officialTotal: number;
  socialCurrentCount: number;
  excludedCount: number;
  sourceJobIds: readonly string[];
}

interface ParsedInfo {
  projectId: string;
}

interface ParsedPage {
  page: number;
  pageSize: number;
  total: number;
  list: unknown[];
}

interface NormalizedJob {
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}

interface AssessedJob {
  officialId: string;
  sourceJobId: string;
  job?: NormalizedJob;
  excludedCode?: "SOCIAL_SCOPE_EXCLUDED" | "LIFECYCLE_EXCLUDED";
}

interface ReplayedPage {
  artifact: PersistentSourceFetchEvidence["artifacts"][number];
  rawJobIds: string[];
  validJobIds: string[];
  losses: PersistentSourceFetchEvidence["fetchLosses"];
}

type SinopharmPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }> & {
  profileBoundSource?: {
    kind: string;
    config: unknown;
  };
};

const SINOPHARM_COMPANY_ID = "company-sinopharm";
const SINOPHARM_SOURCE_ID = "source-sinopharm-social";
const IGUOPIN_DETAIL_ORIGIN = "https://www.iguopin.com";

export function createSinopharmIguopinSourceFetch(
  deps: SinopharmIguopinSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const now = deps.now ?? (() => new Date());
    const capturedAt = now().toISOString();
    const config = readConfig(plan);
    if (!config) return failed(capturedAt, "SINOPHARM_IGUOPIN_CONFIG_MISSING");

    try {
      validatePlanBinding(plan, config);
      const http = deps.http ?? defaultHttpClient(now);
      const artifacts: SourceFetchArtifactDraft[] = [];

      const talentResponse = await http({
        url: config.officialTalentHubUrl,
        method: "GET",
        headers: htmlHeaders(config.officialTalentHubUrl)
      });
      assertResponse(talentResponse, config.officialTalentHubUrl, "text/html");
      const talentArtifact = networkArtifact({
        logicalKey: "sinopharm-official-talent-hub",
        kind: "OFFICIAL_COMPANY_PAGE",
        request: { url: config.officialTalentHubUrl, method: "GET" },
        response: talentResponse,
        capturedAt,
        locator: requestLocator("sinopharm-official-talent-hub-v1", {
          role: "official-talent-hub",
          method: "GET",
          url: config.officialTalentHubUrl,
          body: null,
          coordinate: { sequence: 0 }
        })
      });
      artifacts.push(talentArtifact);
      assertTalentHubEndorsement(talentResponse.body, config);

      const recruitmentResponse = await http({
        url: config.officialRecruitmentUrl,
        method: "GET",
        headers: htmlHeaders(config.officialTalentHubUrl)
      });
      assertResponse(recruitmentResponse, config.officialRecruitmentUrl, "text/html");
      const recruitmentArtifact = networkArtifact({
        logicalKey: "sinopharm-official-recruitment",
        kind: "OFFICIAL_COMPANY_PAGE",
        request: { url: config.officialRecruitmentUrl, method: "GET" },
        response: recruitmentResponse,
        capturedAt,
        locator: requestLocator("sinopharm-official-recruitment-v1", {
          role: "official-recruitment",
          method: "GET",
          url: config.officialRecruitmentUrl,
          body: null,
          coordinate: { sequence: 1 }
        })
      });
      artifacts.push(recruitmentArtifact);
      assertRecruitmentEndorsement(recruitmentResponse.body, config);

      const entryResponse = await http({
        url: config.exclusiveEntryUrl,
        method: "GET",
        headers: htmlHeaders(config.officialRecruitmentUrl)
      });
      assertResponse(entryResponse, config.exclusiveEntryUrl, "text/html");
      if (!load(entryResponse.body)("html").length) {
        throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_TENANT_BINDING_DRIFT");
      }
      artifacts.push(networkArtifact({
        logicalKey: "sinopharm-iguopin-entry",
        kind: "ATS_PAGE",
        request: { url: config.exclusiveEntryUrl, method: "GET" },
        response: entryResponse,
        capturedAt,
        locator: requestLocator("sinopharm-iguopin-entry-v1", {
          role: "exclusive-entry",
          method: "GET",
          url: config.exclusiveEntryUrl,
          body: null,
          coordinate: { sequence: 2, domain: config.expectedDomain }
        })
      }));

      const infoResponse = await http({
        url: config.exclusiveInfoUrl,
        method: "GET",
        headers: apiHeaders(config)
      });
      assertResponse(infoResponse, config.exclusiveInfoUrl, "application/json");
      const infoArtifact = networkArtifact({
        logicalKey: "sinopharm-iguopin-info",
        kind: "ATS_API_RESPONSE",
        request: { url: config.exclusiveInfoUrl, method: "GET" },
        response: infoResponse,
        capturedAt,
        locator: requestLocator("sinopharm-iguopin-info-v1", {
          role: "exclusive-info",
          method: "GET",
          url: config.exclusiveInfoUrl,
          body: null,
          coordinate: { domain: config.expectedDomain }
        })
      });
      artifacts.push(infoArtifact);
      const { projectId } = parseExclusiveInfo(infoResponse.body, config);

      const jobs: NormalizedJob[] = [];
      const pages: SourceFetchPageTrace[] = [];
      const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
      const seenOfficialIds = new Set<string>();
      let officialTotal: number | undefined;
      let requiredPages = 1;

      for (let requestedPage = 1; requestedPage <= requiredPages; requestedPage += 1) {
        const requestBody = projectJobsRequest(requestedPage, config.pageSize, projectId);
        const response = await http({
          url: config.projectJobsUrl,
          method: "POST",
          headers: apiHeaders(config),
          body: JSON.stringify(requestBody)
        });
        assertResponse(response, config.projectJobsUrl, "application/json");
        const pageIndex = requestedPage - 1;
        const logicalKey = `sinopharm-iguopin-page-${String(pageIndex).padStart(4, "0")}`;
        const artifact = networkArtifact({
          logicalKey,
          kind: "ATS_API_RESPONSE",
          request: { url: config.projectJobsUrl, method: "POST" },
          response,
          capturedAt,
          locator: requestLocator("sinopharm-iguopin-project-jobs-v1", {
            role: "project-jobs",
            method: "POST",
            url: config.projectJobsUrl,
            body: requestBody,
            coordinate: {
              sequence: pageIndex,
              requestedPage,
              requestedPageSize: config.pageSize,
              projectId
            }
          })
        });
        artifacts.push(artifact);

        const parsed = parseProjectJobsPage(response.body, requestedPage, config.pageSize);
        if (officialTotal === undefined) {
          officialTotal = parsed.total;
          requiredPages = Math.max(1, Math.ceil(officialTotal / config.pageSize));
          if (requiredPages > config.maxPages) {
            throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_MAX_PAGES_EXCEEDED");
          }
        } else if (parsed.total !== officialTotal) {
          throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_TOTAL_COUNT_DRIFT");
        }

        const expectedLength = Math.min(
          config.pageSize,
          Math.max(0, officialTotal - pageIndex * config.pageSize)
        );
        if (parsed.list.length < expectedLength) {
          throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_SHORT_PAGE");
        }
        if (parsed.list.length > expectedLength) {
          throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_TOTAL_COUNT_DRIFT");
        }

        const rawJobIds: string[] = [];
        const validJobIds: string[] = [];
        for (let recordIndex = 0; recordIndex < parsed.list.length; recordIndex += 1) {
          const assessed = assessJob(parsed.list[recordIndex], new Date(capturedAt));
          if (seenOfficialIds.has(assessed.officialId)) {
            throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_DUPLICATE_JOB");
          }
          seenOfficialIds.add(assessed.officialId);
          rawJobIds.push(irreversibleOfficialJsonEvidenceId(assessed.officialId));
          if (assessed.job) {
            jobs.push(assessed.job);
            validJobIds.push(irreversibleOfficialJsonEvidenceId(assessed.sourceJobId));
          } else {
            const code = assessed.excludedCode!;
            losses.push({
              stage: "VALIDATION",
              reason: code,
              rawLocator: `${logicalKey}#record:${recordIndex}`,
              details: { code, pageSequence: pageIndex, recordIndex },
              recordedAt: capturedAt
            });
          }
        }

        const last = requestedPage === requiredPages;
        pages.push({
          sequence: pageIndex,
          artifactLogicalKey: logicalKey,
          requestedPage,
          returnedPage: parsed.page,
          requestedPageSize: config.pageSize,
          returnedPageSize: parsed.pageSize,
          rawJobIds,
          validJobIds,
          declaredTotal: officialTotal,
          declaredPages: requiredPages,
          nextPageSignalBefore: pageIndex === 0 ? null : `sinopharm-page:${requestedPage}`,
          nextPageSignalAfter: last ? null : `sinopharm-page:${requestedPage + 1}`,
          responseFingerprintSha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
          termination: officialTotal === 0 ? "EMPTY_PAGE" : last ? "NEXT_ABSENT" : "CONTINUE",
          anomalyCodes: [],
          capturedAt
        });
      }

      if (officialTotal === undefined || seenOfficialIds.size !== officialTotal) {
        throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_TOTAL_COUNT_DRIFT");
      }
      const declarationArtifact = artifacts.find(
        (artifact) => artifact.logicalKey === pages[0]!.artifactLogicalKey
      );
      if (!declarationArtifact) {
        throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_EVIDENCE_MISSING");
      }
      const evidenceDraft = parsePersistentSourceFetchEvidence({
        captureTool: { name: "sinopharm-iguopin-source-fetch", version: "1" },
        artifacts,
        pages,
        declaredCompleteness: officialTotal === 0
          ? {
              kind: "OFFICIAL_TOTAL_COUNT",
              value: 0,
              artifactLogicalKey: declarationArtifact.logicalKey,
              extractorLocator: declarationArtifact.extractorLocator,
              scope: "SOURCE"
            }
          : {
              kind: "COMPLETE_PAGE_TRAVERSAL",
              value: pages.length,
              artifactLogicalKey: declarationArtifact.logicalKey,
              extractorLocator: declarationArtifact.extractorLocator,
              scope: "SOURCE"
            },
        fetchCounts: {
          rawCount: officialTotal,
          parsedCount: officialTotal,
          validCount: jobs.length,
          parseDiscardCount: 0,
          validationDiscardCount: losses.length
        },
        fetchLosses: losses
      });
      const fetchEvidence = deriveCanonicalPaginationEvidence({
        evidence: evidenceDraft,
        expectedChannelIds: [],
        filteredOutput: true,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      });
      const paginationEvaluation = evaluatePaginationEvidence({
        evidence: fetchEvidence,
        expectedChannelIds: [],
        filteredOutput: true,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      });

      return {
        ok: true,
        capturedAt,
        payload: { jobs },
        completeness: {
          completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
          expectedJobCount: officialTotal,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: config.exclusiveEntryUrl,
          completenessBlockerReason: "Strict downstream replay has not yet certified the social and lifecycle scope exclusions.",
          pageSize: config.pageSize,
          pagesVisited: pages.length
        },
        fetchEvidence,
        paginationEvaluation
      } satisfies SourceFetchResult;
    } catch (error) {
      return failed(
        capturedAt,
        error instanceof SinopharmIguopinError
          ? error.code
          : error instanceof Error
            ? `SINOPHARM_IGUOPIN_FETCH_FAILED:${error.message}`
            : "SINOPHARM_IGUOPIN_FETCH_FAILED"
      );
    }
  };
}

/**
 * Independently reconstructs the source result from exact captured artifacts.
 * The shared completeness gate can call this without duplicating company rules.
 */
export function replaySinopharmIguopinEvidence(
  input: SinopharmIguopinStrictReplayInput
): SinopharmIguopinReplayResult | undefined {
  try {
    const config = readConfig(input.plan);
    if (!config) return undefined;
    validatePlanBinding(input.plan, config);
    const evidence = parsePersistentSourceFetchEvidence(input.evidence);
    if (evidence.supportingArtifactOnlyFailure || evidence.artifacts.length < 5) return undefined;

    const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
    if (artifacts.size !== evidence.artifacts.length) return undefined;
    const used = new Set<string>();

    const talent = exactArtifact(artifacts, used, "sinopharm-official-talent-hub", {
      kind: "OFFICIAL_COMPANY_PAGE",
      url: config.officialTalentHubUrl,
      locator: requestLocator("sinopharm-official-talent-hub-v1", {
        role: "official-talent-hub", method: "GET", url: config.officialTalentHubUrl,
        body: null, coordinate: { sequence: 0 }
      })
    });
    assertTalentHubEndorsement(bodyText(talent), config);

    const recruitment = exactArtifact(artifacts, used, "sinopharm-official-recruitment", {
      kind: "OFFICIAL_COMPANY_PAGE",
      url: config.officialRecruitmentUrl,
      locator: requestLocator("sinopharm-official-recruitment-v1", {
        role: "official-recruitment", method: "GET", url: config.officialRecruitmentUrl,
        body: null, coordinate: { sequence: 1 }
      })
    });
    assertRecruitmentEndorsement(bodyText(recruitment), config);

    const entry = exactArtifact(artifacts, used, "sinopharm-iguopin-entry", {
      kind: "ATS_PAGE",
      url: config.exclusiveEntryUrl,
      locator: requestLocator("sinopharm-iguopin-entry-v1", {
        role: "exclusive-entry", method: "GET", url: config.exclusiveEntryUrl,
        body: null, coordinate: { sequence: 2, domain: config.expectedDomain }
      })
    });
    if (!load(bodyText(entry))("html").length) return undefined;

    const info = exactArtifact(artifacts, used, "sinopharm-iguopin-info", {
      kind: "ATS_API_RESPONSE",
      url: config.exclusiveInfoUrl,
      locator: requestLocator("sinopharm-iguopin-info-v1", {
        role: "exclusive-info", method: "GET", url: config.exclusiveInfoUrl,
        body: null, coordinate: { domain: config.expectedDomain }
      })
    });
    const { projectId } = parseExclusiveInfo(bodyText(info), config);

    let officialTotal: number | undefined;
    let requiredPages = 1;
    const replayedPages: ReplayedPage[] = [];
    const seen = new Set<string>();
    const expectedSourceJobIds: string[] = [];
    const lifecycleInstant = new Date(evidence.pages[0]?.capturedAt ?? "invalid");
    if (Number.isNaN(lifecycleInstant.getTime())) return undefined;

    for (let requestedPage = 1; requestedPage <= requiredPages; requestedPage += 1) {
      const pageIndex = requestedPage - 1;
      const requestBody = projectJobsRequest(requestedPage, config.pageSize, projectId);
      const key = `sinopharm-iguopin-page-${String(pageIndex).padStart(4, "0")}`;
      const artifact = exactArtifact(artifacts, used, key, {
        kind: "ATS_API_RESPONSE",
        url: config.projectJobsUrl,
        locator: requestLocator("sinopharm-iguopin-project-jobs-v1", {
          role: "project-jobs", method: "POST", url: config.projectJobsUrl, body: requestBody,
          coordinate: { sequence: pageIndex, requestedPage, requestedPageSize: config.pageSize, projectId }
        })
      });
      const page = parseProjectJobsPage(bodyText(artifact), requestedPage, config.pageSize);
      if (officialTotal === undefined) {
        officialTotal = page.total;
        requiredPages = Math.max(1, Math.ceil(officialTotal / config.pageSize));
        if (requiredPages > config.maxPages) return undefined;
      } else if (page.total !== officialTotal) return undefined;
      const expectedLength = Math.min(config.pageSize, Math.max(0, officialTotal - pageIndex * config.pageSize));
      if (page.list.length !== expectedLength) return undefined;

      const rawJobIds: string[] = [];
      const validJobIds: string[] = [];
      const pageLosses: PersistentSourceFetchEvidence["fetchLosses"] = [];
      for (let recordIndex = 0; recordIndex < page.list.length; recordIndex += 1) {
        const assessed = assessJob(page.list[recordIndex], lifecycleInstant);
        if (seen.has(assessed.officialId)) return undefined;
        seen.add(assessed.officialId);
        rawJobIds.push(irreversibleOfficialJsonEvidenceId(assessed.officialId));
        if (assessed.job) {
          validJobIds.push(irreversibleOfficialJsonEvidenceId(assessed.sourceJobId));
          expectedSourceJobIds.push(assessed.sourceJobId);
        } else {
          const code = assessed.excludedCode!;
          pageLosses.push({
            stage: "VALIDATION",
            reason: code,
            rawLocator: `${key}#record:${recordIndex}`,
            details: { code, pageSequence: pageIndex, recordIndex },
            recordedAt: evidence.pages[0]!.capturedAt
          });
        }
      }
      replayedPages.push({ artifact, rawJobIds, validJobIds, losses: pageLosses });
    }

    if (officialTotal === undefined || seen.size !== officialTotal ||
        replayedPages.length !== evidence.pages.length || used.size !== evidence.artifacts.length) {
      throw new Error("SINOPHARM_REPLAY_AGGREGATE_MISMATCH");
    }
    for (let sequence = 0; sequence < replayedPages.length; sequence += 1) {
      const replayed = replayedPages[sequence]!;
      const page = evidence.pages[sequence]!;
      const requestedPage = sequence + 1;
      const last = sequence === replayedPages.length - 1;
      if (page.sequence !== sequence || page.artifactLogicalKey !== replayed.artifact.logicalKey ||
          page.requestedPage !== requestedPage || page.returnedPage !== requestedPage ||
          page.requestedPageSize !== config.pageSize || page.returnedPageSize !== config.pageSize ||
          JSON.stringify(page.rawJobIds) !== JSON.stringify(replayed.rawJobIds) ||
          JSON.stringify(page.validJobIds) !== JSON.stringify(replayed.validJobIds) ||
          page.declaredTotal !== officialTotal || page.declaredPages !== replayedPages.length ||
          page.nextPageSignalBefore !== (sequence === 0 ? null : `sinopharm-page:${requestedPage}`) ||
          page.nextPageSignalAfter !== (last ? null : `sinopharm-page:${requestedPage + 1}`) ||
          page.termination !== (officialTotal === 0 ? "EMPTY_PAGE" : last ? "NEXT_ABSENT" : "CONTINUE") ||
          page.responseFingerprintSha256 !== sha256Bytes(Buffer.from(bodyText(replayed.artifact), "utf8")).sha256) {
        throw new Error(`SINOPHARM_REPLAY_PAGE_MISMATCH_${sequence}`);
      }
    }

    const expectedLosses = replayedPages.flatMap(({ losses }) => losses);
    if (JSON.stringify(evidence.fetchLosses) !== JSON.stringify(expectedLosses)) {
      throw new Error("SINOPHARM_REPLAY_LOSS_MISMATCH");
    }
    const declaration = evidence.declaredCompleteness;
    const firstArtifact = replayedPages[0]!.artifact;
    const exactDeclaration = officialTotal === 0
      ? declaration?.kind === "OFFICIAL_TOTAL_COUNT" && declaration.value === 0
      : declaration?.kind === "COMPLETE_PAGE_TRAVERSAL" && declaration.value === replayedPages.length;
    if (!exactDeclaration || declaration?.scope !== "SOURCE" || declaration.channelId !== undefined ||
        declaration.artifactLogicalKey !== firstArtifact.logicalKey ||
        declaration.extractorLocator !== firstArtifact.extractorLocator ||
        evidence.fetchCounts.rawCount !== officialTotal || evidence.fetchCounts.parsedCount !== officialTotal ||
        evidence.fetchCounts.validCount !== expectedSourceJobIds.length ||
        evidence.fetchCounts.parseDiscardCount !== 0 ||
        evidence.fetchCounts.validationDiscardCount !== expectedLosses.length) {
      throw new Error("SINOPHARM_REPLAY_COUNT_MISMATCH");
    }

    const outputIds = input.outputJobs.flatMap(({ sourceJobId }) =>
      typeof sourceJobId === "string" ? [sourceJobId] : []
    );
    if (outputIds.length !== input.outputJobs.length ||
        new Set(outputIds).size !== outputIds.length ||
        JSON.stringify([...outputIds].sort(compareUtf8)) !== JSON.stringify([...expectedSourceJobIds].sort(compareUtf8)) ||
        input.outputJobs.some((job) =>
          (job.companyId !== undefined && job.companyId !== input.plan.company.id) ||
          (job.sourceId !== undefined && job.sourceId !== input.plan.source.id))) {
      throw new Error("SINOPHARM_REPLAY_OUTPUT_MISMATCH");
    }

    const independentlyEvaluated = evaluatePaginationEvidence({
      evidence,
      expectedChannelIds: [],
      filteredOutput: true,
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
    });
    if (!independentlyEvaluated.safeCompleteness || !independentlyEvaluated.verifiedEligible) {
      throw new Error("SINOPHARM_REPLAY_PAGINATION_MISMATCH");
    }
    return {
      officialTotal,
      socialCurrentCount: expectedSourceJobIds.length,
      excludedCount: expectedLosses.length,
      sourceJobIds: [...expectedSourceJobIds].sort(compareUtf8)
    };
  } catch {
    return undefined;
  }
}

export function validateStrictSinopharmIguopinEvidence(
  input: SinopharmIguopinStrictReplayInput
): boolean {
  return replaySinopharmIguopinEvidence(input) !== undefined;
}

function validatePlanBinding(plan: SourceCrawlPlan, config: SinopharmIguopinFetchConfig): void {
  if (plan.adapterId !== "official-json" || plan.company.id !== SINOPHARM_COMPANY_ID ||
      plan.company.category !== "DOMESTIC_PHARMA" || plan.source.id !== SINOPHARM_SOURCE_ID ||
      plan.source.companyId !== SINOPHARM_COMPANY_ID || plan.source.kind !== "SOCIAL" ||
      plan.source.atsKind !== "OFFICIAL_JSON" || plan.source.status !== "VERIFIED_SCRAPABLE" ||
      plan.source.officialEntryUrl !== config.exclusiveEntryUrl ||
      plan.source.officialChainEvidenceUrl !== config.officialRecruitmentUrl ||
      plan.json.jobsPath !== "jobs" || plan.json.defaultCategory !== "其他" ||
      plan.json.fields.sourceJobId !== "sourceJobId" || plan.json.fields.officialTitle !== "title" ||
      plan.json.fields.officialUrl !== "officialUrl" || plan.json.fields.locationRaw !== "locationRaw" ||
      plan.json.fields.cities !== "cities") {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_PLAN_BINDING_DRIFT");
  }

  const talent = strictUrl(config.officialTalentHubUrl);
  const recruitment = strictUrl(config.officialRecruitmentUrl);
  const wechat = strictUrl(config.officialWechatArticleUrl);
  const entry = strictUrl(config.exclusiveEntryUrl);
  const info = strictUrl(config.exclusiveInfoUrl);
  const jobs = strictUrl(config.projectJobsUrl);
  if (talent.href !== "https://www.sinopharm.com/talents.html" ||
      recruitment.href !== "https://www.sinopharm.com/recruitment.html" ||
      wechat.href !== "https://mp.weixin.qq.com/s/HHzjsHj-iLo9jlsf6LH0Vg" ||
      entry.href !== "https://sinopharm-global.iguopin.com/job" ||
      info.origin !== "https://gp-api.iguopin.com" ||
      info.pathname !== "/api/activity/exclusive/v1/info" ||
      info.searchParams.get("domain") !== config.expectedDomain || [...info.searchParams.keys()].length !== 1 ||
      jobs.href !== "https://gp-api.iguopin.com/api/jobs/v1/project-job" ||
      config.expectedDomain !== "sinopharm-global" ||
      config.expectedCompanyId !== "10685286902763068" ||
      config.expectedCompanyName !== "中国医药集团有限公司" ||
      !Number.isSafeInteger(config.pageSize) || config.pageSize <= 0 || config.pageSize > 100 ||
      !Number.isSafeInteger(config.maxPages) || config.maxPages <= 0 || config.maxPages > 1_000) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_CONFIG_INVALID");
  }
}

function readConfig(plan: SourceCrawlPlan): SinopharmIguopinFetchConfig | undefined {
  const profileBound = (plan as SinopharmPlan).profileBoundSource;
  return profileBound?.kind === "sinopharm-iguopin"
    ? profileBound.config as SinopharmIguopinFetchConfig
    : undefined;
}

function assertTalentHubEndorsement(html: string, config: SinopharmIguopinFetchConfig): void {
  const $ = load(html);
  const targets: string[] = [];
  $("meta[http-equiv]").each((_index, element) => {
    if (($(element).attr("http-equiv") ?? "").trim().toLowerCase() !== "refresh") return;
    const content = $(element).attr("content") ?? "";
    const match = /(?:^|;)\s*url\s*=\s*['"]?([^'";]+)['"]?\s*$/iu.exec(content);
    if (!match?.[1]) return;
    try { targets.push(new URL(match[1].trim(), config.officialTalentHubUrl).href); } catch { /* ignore */ }
  });
  $("a[href]").each((_index, element) => {
    try { targets.push(new URL($(element).attr("href")!, config.officialTalentHubUrl).href); } catch { /* ignore */ }
  });
  if (!targets.includes(config.officialRecruitmentUrl)) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_OFFICIAL_CHAIN_DRIFT");
  }
}

function assertRecruitmentEndorsement(html: string, config: SinopharmIguopinFetchConfig): void {
  const $ = load(html);
  const links = $("a[href]").toArray().flatMap((element) => {
    try { return [new URL($(element).attr("href")!, config.officialRecruitmentUrl).href]; } catch { return []; }
  });
  if (!links.includes(config.officialWechatArticleUrl)) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_OFFICIAL_CHAIN_DRIFT");
  }
}

function parseExclusiveInfo(body: string, config: SinopharmIguopinFetchConfig): ParsedInfo {
  const root = strictJsonRecord(body, "SINOPHARM_IGUOPIN_TENANT_BINDING_DRIFT");
  const data = record(root.data);
  const company = record(data?.company);
  if (root.code !== 200 || !data || data.key !== config.expectedDomain || data.status !== 1 ||
      data.is_display !== 1 || data.company_id !== config.expectedCompanyId ||
      nonblank(data.title) === undefined || company?.id !== config.expectedCompanyId ||
      company.name !== config.expectedCompanyName || company.show_name !== config.expectedCompanyName ||
      typeof data.content !== "string" || !hasUniqueJsonObjectKeys(data.content)) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_TENANT_BINDING_DRIFT");
  }
  let content: unknown;
  try { content = JSON.parse(data.content); } catch {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_TENANT_BINDING_DRIFT");
  }
  const contentRecord = record(content);
  const desktop = projectIds(record(contentRecord?.params)?.nav);
  const mobile = projectIds(record(contentRecord?.paramsMobile)?.nav);
  if (contentRecord?.key !== config.expectedDomain || contentRecord.company_id !== config.expectedCompanyId ||
      desktop.length !== 1 || mobile.length !== 1 || desktop[0] !== mobile[0] ||
      !/^\d{18}$/u.test(desktop[0]!)) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_PROJECT_BINDING_DRIFT");
  }
  return { projectId: desktop[0]! };
}

function projectIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const nav = record(item);
    const props = record(nav?.props);
    return nav?.key === "job" && nav.route === "/job" && nav.type === "job" && nav.hidden === 0 &&
      typeof props?.projectId === "string" ? [props.projectId] : [];
  });
}

function parseProjectJobsPage(body: string, requestedPage: number, pageSize: number): ParsedPage {
  const root = strictJsonRecord(body, "SINOPHARM_IGUOPIN_INVALID_PAGE");
  const data = record(root.data);
  if (root.code !== 200 || !data || data.page !== requestedPage || data.page_size !== pageSize ||
      !Number.isSafeInteger(data.total) || (data.total as number) < 0 || !Array.isArray(data.list)) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_INVALID_PAGE");
  }
  return { page: requestedPage, pageSize, total: data.total as number, list: data.list };
}

function assessJob(value: unknown, instant: Date): AssessedJob {
  const job = record(value);
  const companyInfo = record(job?.company_info);
  const officialId = nonblank(job?.job_id);
  const title = nonblank(job?.job_name);
  const companyId = nonblank(job?.company_id);
  const companyName = nonblank(job?.company_name);
  const companyShowName = nonblank(companyInfo?.show_name);
  const contents = nonblank(job?.contents);
  const category = nonblank(job?.category_cn);
  const department = nonblank(job?.department_cn);
  const education = nonblank(job?.education_cn);
  const experience = nonblank(job?.experience_cn);
  const startTime = chinaInstant(job?.start_time);
  const endTime = chinaInstant(job?.end_time);
  const districtList = Array.isArray(job?.district_list) ? job.district_list : undefined;
  const cities = districtList
    ? districtList.map((item) => nonblank(record(item)?.area_cn)).filter((item): item is string => Boolean(item))
    : [];
  if (!officialId || !title || !companyId || !companyName || !companyShowName || !contents || !category ||
      !department || !education || !experience || !startTime || !endTime || startTime > endTime ||
      !districtList || cities.length === 0 || cities.length !== districtList.length ||
      !Number.isSafeInteger(job?.status) || typeof job?.is_apply !== "boolean" ||
      !Number.isSafeInteger(job?.hide)) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_INVALID_JOB");
  }
  const recruitmentType = nonblank(job?.recruitment_type_cn);
  const nature = nonblank(job?.nature_cn);
  const isSocial = recruitmentType === "社会招聘" && nature === "社招";
  const isCampus = recruitmentType === "校园招聘" && nature === "校招";
  if (!isSocial && !isCampus) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_SOCIAL_BOUNDARY_DRIFT");
  }
  const sourceJobId = `sinopharm-iguopin:sha256:${sha256(officialId)}`;
  if (isCampus) return { officialId, sourceJobId, excludedCode: "SOCIAL_SCOPE_EXCLUDED" };
  if (job!.status !== 1 || job!.is_apply !== true || job!.hide !== 0 ||
      instant.getTime() < startTime.getTime() || instant.getTime() > endTime.getTime()) {
    return { officialId, sourceJobId, excludedCode: "LIFECYCLE_EXCLUDED" };
  }
  return {
    officialId,
    sourceJobId,
    job: {
      sourceJobId,
      title,
      officialUrl: `${IGUOPIN_DETAIL_ORIGIN}/job/detail?id=${encodeURIComponent(officialId)}`,
      locationRaw: cities.join("、"),
      cities: [...new Set(cities)]
    }
  };
}

function chinaInstant(value: unknown): Date | undefined {
  const text = nonblank(value);
  if (!text || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(text)) return undefined;
  const parsed = new Date(`${text.replace(" ", "T")}+08:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function projectJobsRequest(page: number, pageSize: number, projectId: string): Record<string, unknown> {
  return { page, page_size: pageSize, source: "s_job_list", project_id: [projectId] };
}

function networkArtifact(input: {
  logicalKey: string;
  kind: "OFFICIAL_COMPANY_PAGE" | "ATS_PAGE" | "ATS_API_RESPONSE";
  request: { url: string; method: "GET" | "POST" };
  response: SinopharmIguopinHttpResponse;
  capturedAt: string;
  locator: string;
}): SourceFetchArtifactDraft {
  return {
    id: input.logicalKey,
    logicalKey: input.logicalKey,
    kind: input.kind,
    requestedUrl: input.request.url,
    finalUrl: input.response.finalUrl ?? input.request.url,
    httpStatus: input.response.status,
    contentType: input.response.contentType ?? "application/octet-stream",
    capturedAt: input.capturedAt,
    body: input.response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: input.locator
  };
}

function exactArtifact(
  artifacts: ReadonlyMap<string, PersistentSourceFetchEvidence["artifacts"][number]>,
  used: Set<string>,
  key: string,
  expected: { kind: string; url: string; locator: string }
): PersistentSourceFetchEvidence["artifacts"][number] {
  const artifact = artifacts.get(key);
  const evidenceUrl = sanitizeEvidenceHttpUrl(expected.url);
  if (!artifact || artifact.kind !== expected.kind || artifact.bodyRepresentation !== "EXACT" ||
      artifact.requestedUrl !== evidenceUrl || artifact.finalUrl !== evidenceUrl ||
      artifact.httpStatus !== 200 || artifact.extractorLocator !== expected.locator || used.has(key)) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_EVIDENCE_REPLAY_FAILED");
  }
  used.add(key);
  return artifact;
}

function requestLocator(
  base: string,
  input: Omit<Parameters<typeof requestContractV2Locator>[1], "family">
): string {
  return requestContractV2Locator(base, {
    ...input,
    // The shared union is extended by the integration wiring; runtime serialization is already exact.
    family: "sinopharm-iguopin"
  });
}

function assertResponse(
  response: SinopharmIguopinHttpResponse,
  requestedUrl: string,
  mime: "text/html" | "application/json"
): void {
  if (response.status < 200 || response.status >= 300) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_HTTP_FAILURE");
  }
  if (!response.contentType?.toLowerCase().startsWith(mime)) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_CONTENT_TYPE_DRIFT");
  }
  if (strictUrl(response.finalUrl ?? requestedUrl).href !== strictUrl(requestedUrl).href) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_REDIRECT_DRIFT");
  }
}

function strictUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new SinopharmIguopinError("SINOPHARM_IGUOPIN_URL_OUT_OF_SCOPE");
  }
  return url;
}

function htmlHeaders(referer: string): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml",
    Referer: referer,
    "User-Agent": "job-search-crawler/0.1"
  };
}

function apiHeaders(config: SinopharmIguopinFetchConfig): Record<string, string> {
  const origin = new URL(config.exclusiveEntryUrl).origin;
  return {
    Accept: "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    Device: "pc",
    Version: "5.0.0",
    Subsite: "iguopin",
    Origin: origin,
    Referer: `${origin}/`,
    "User-Agent": "job-search-crawler/0.1"
  };
}

function defaultHttpClient(now: () => Date): SinopharmIguopinHttpClient {
  return async (request) => {
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
      capturedAt: now().toISOString()
    };
  };
}

function strictJsonRecord(body: string, errorCode: string): Record<string, unknown> {
  if (!hasUniqueJsonObjectKeys(body)) throw new SinopharmIguopinError(errorCode);
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new SinopharmIguopinError(errorCode); }
  const parsed = record(value);
  if (!parsed) throw new SinopharmIguopinError(errorCode);
  return parsed;
}

function bodyText(artifact: PersistentSourceFetchEvidence["artifacts"][number]): string {
  return typeof artifact.body === "string" ? artifact.body : Buffer.from(artifact.body).toString("utf8");
}

function nonblank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return { ok: false, capturedAt, failureReason };
}

class SinopharmIguopinError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SinopharmIguopinError";
  }
}
