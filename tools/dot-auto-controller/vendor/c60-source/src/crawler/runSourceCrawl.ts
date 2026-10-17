import {isSanofiChinesePlan,replaySanofiChineseNative,SANOFI_CN_PAGINATION_POLICY} from "./sanofiChineseNative";
import { reviewedAbbvieCity } from "./abbvieChinaRowScope";
import { exactKelunMainlandPlan, replayKelunMainlandScope } from "./kelunMainlandScope";
import { isServierTraversalPlan, replayServierTraversal } from "./servierMokaScope";
import { hasNovartisOfficialPresencePlan, hasNovartisPresenceArtifacts, replayNovartisOfficialPresence } from "./novartisOfficialPresence";
import { JNJ_DOM_CAPTURE_TOOL } from "./jnjCareersDomContract";
import { replayJnjCareersDomEvidence } from "./jnjCareersDomEvidence";
import {applySanofiNativeProjection} from "./sanofiNativeQuality";
import { isPfizerWorkdayTraversalPlan, replayPfizerWorkdayTraversal, PFIZER_PAGINATION_POLICY, PFIZER_CHANNEL } from "./pfizerWorkdayTraversal";
import { isBayerMedicalTraversalPlan, replayBayerMedicalTraversal } from "./bayerMokaScope";
import { ROCHE_NATIVE_DETAIL_POLICY, rocheNativeDetail } from "./rocheChinaQuality";
import { mokaDetailLocations, mokaNativeListScope } from "./mokaSourceFetch";
import { auditRedseaCandidateScope } from "./redseaCandidateScope";
import { hasBeisenDetailDatePlan, replayBeisenDetailDates } from "./beisenDetailDates";
import { replayWorkdayMainlandQuality } from "./workdayMainlandQuality";
import { requiresOrganonPostedDate, exactOrganonPostedDatePlan, exactOrganonPostedDateBootstrap, organonBootstrapLocator } from "./organonOfficialPostedDate";
import { organonOfficialCities, organonOfficialIdentity } from "./organonChinaQuality";
import { phenomOfficialPostedDate } from "./phenomOfficialPostedDate";
import { requiresLillyChinaQuality, exactLillyChinaQualityPlan, exactLillyChinaBootstrap, lillyOfficialCities, lillyOfficialPostedDate, lillyPageEnvelopeValid, lillyNativeDetail } from "./lillyChinaQuality";
import { requiresMerckChinaQuality, exactMerckChinaQualityPlan, exactMerckChinaBootstrap, merckOfficialCities, merckOfficialPostedDate, merckOfficialIdentity } from "./merckChinaQuality";
import { NOVO_CHINA_LOCATION_POLICY, exactNovoChinaQualityPlan, replayNovoChinaRows } from "./novoChinaQuality";
import { bmsOfficialPostedDate, exactBmsPostedDatePlan } from "./bmsOfficialPostedDate";
import { replayBiogenListGeography } from "./biogenListGeographyGuard";
import { projectEightfoldPcsxPosition } from "./officialJsonSourceFetch";
import { ucbOfficialCities, exactUcbPostedDatePlan, exactUcbPostedDateBootstrap, requiresUcbPostedDate, ucbOfficialPostedDate } from "./ucbOfficialPostedDate";
import { isDeepStrictEqual } from "node:util";
import { hasAstellasPdfCityPlan, replayAstellasPdfCities } from "./astellasPdfCityAcquisition";
import { hasAstraZenecaDetailPlan, replayAstraZenecaDetails } from "./astraZenecaDetailAcquisition";
import { requiresHansohNativeWindowReplay, validateStrictHansohNativeWindowEvidence, hasUnrecognizedHansohLocation } from "./hansohNativeWindowEvidence";
import { createDecipheriv, createHash } from "node:crypto";
import { hasHengruiScopeExclusionPolicy, replayHengruiScopeExclusionProof } from "./strictMokaScopeExclusionProof";
import { load } from "cheerio";
import { parse as parseJavaScript } from "@babel/parser";
import type { ObjectExpression } from "@babel/types";
import { htmlTableAdapter } from "./adapters/htmlTable";
import { officialJsonAdapter } from "./adapters/officialJson";
import type { CrawlAdapterResult } from "./adapters/types";
import type { CompletenessEvidence } from "../domain/company";
import { validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence, SourceFetchPageTrace } from "./sourceFetchEvidence";
import { evaluatePaginationEvidence, type PaginationEvaluation } from "./paginationEvidence";
import { assertAdapterReconciliation, emptyReconciliation, reconcileAdapterRows } from "./adapters/reconciliation";
import { containsSensitiveAdapterValue } from "./adapters/safeAdapterValue";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import {
  strictHtmlExpectedAdapterOutputCount,
  validateStrictHtmlCompletenessProof
} from "./strictHtmlCompletenessProof";
import { strictCompletenessTrace } from "./strictCompletenessTrace";
import { validateStrictSourceScopeExclusionProof } from "./strictSourceScopeExclusionProof";
import {
  explicitlyForeignOrNonMainlandLocation,
  explicitlyGenericOrAmbiguousLocation,
  irreversibleOfficialJsonEvidenceId,
  persistentOfficialJsonJobId,
  safeOfficialJsonId
} from "./officialJsonEvidence";
import type { NormalizedJobRecord } from "./normalizedJob";
import {
  getStrictProfileBoundSourcePolicy,
  profileBoundPersistedExpectedJobCount,
  validateStrictProfileBoundSourceEvidence
} from "./profileBoundSourceEvidence";
import {
  BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES,
  BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
  PFIZER_AUDITED_FOREIGN_LOCATION_DESCRIPTOR_ALIASES,
  isPfizerWorkdayMainlandChinaLocationDescriptor
} from "./workdaySourceFetch";
import type { SourceTransportFailure } from "./sourceFetchFailure";
import type { RetryableSourceTransportFailureCode } from "./sourceFetchFailure";
import { validateStrictHotjobLegacyEvidence } from "./hotjobLegacySourceFetch";
import { attachYelloPublicAgeEvidence, parseYelloJobBoardResponse, yelloJobBoardBinding, yelloPublicAgeEvidence, yelloScopeExclusionLoss } from "./yelloJobBoardEvidence";
import { exactGileadPublicAgePlan } from "./gileadPublicAge";
import { hasBiSemanticPlan, replayBiSemanticCompleteness } from "./biSemanticCompleteness";
import { BI_API_URL, BI_SCRIPT_URL } from "./biUiSemanticContract";

export type SourceFetchResult =
  | { ok: true; capturedAt: string; payload: unknown; completeness?: CompletenessEvidence; fetchEvidence?: PersistentSourceFetchEvidence; paginationEvaluation?: PaginationEvaluation; priorTransportAttempts?: readonly SourceTransportAttempt[] }
  | { ok: true; capturedAt: string; html: string; completeness?: CompletenessEvidence; fetchEvidence?: PersistentSourceFetchEvidence; paginationEvaluation?: PaginationEvaluation; priorTransportAttempts?: readonly SourceTransportAttempt[] }
  | { ok: false; capturedAt: string; failureReason: string; sourceRetryExhausted?: true; transportFailure?: SourceTransportFailure; fetchEvidence?: PersistentSourceFetchEvidence; paginationEvaluation?: PaginationEvaluation; priorTransportAttempts?: readonly SourceTransportAttempt[] };

export interface SourceTransportAttempt {
  transport: "DIRECT_HTTP" | "BROWSER_SESSION";
  outcome: "FAILED" | "SUCCEEDED";
  code: "HCM_DIRECT_FAILED" | "HCM_BROWSER_SESSION_FAILED" | "HCM_BROWSER_ENTRY_FAILED" |
    "HCM_BROWSER_COUNT_FAILED" | "HCM_BROWSER_LIST_FAILED" | "HCM_BROWSER_SUCCEEDED" |
    "JNJ_DIRECT_FAILED" | "JNJ_BROWSER_SESSION_FAILED" | "JNJ_BROWSER_FETCH_FAILED" |
    "JNJ_BROWSER_SUCCEEDED";
  capturedAt: string;
  fetchEvidence?: PersistentSourceFetchEvidence;
  paginationEvaluation?: PaginationEvaluation;
}

export type SourceCrawlResult = CrawlAdapterResult & {
  truth: SourceCrawlTruth;
  fetchEvidence?: PersistentSourceFetchEvidence;
  paginationEvaluation?: PaginationEvaluation;
  priorTransportAttempts?: readonly SourceTransportAttempt[];
  transportFailure?: SourceTransportFailure;
};

export interface SourceCrawlTruth {
  transportSuccess: boolean;
  adapterSuccess: boolean;
  completenessVerified: boolean;
}

export type SourceFetchFunction = (
  plan: SourceCrawlPlan,
  attemptTracker?: SourceFetchAttemptTracker
) => SourceFetchResult | Promise<SourceFetchResult>;

export interface SourceFetchAttemptTracker {
  fetchAttemptCount: number;
  retryCount: number;
  retryReasonCodes: RetryableSourceTransportFailureCode[];
}

export function createSourceFetchAttemptTracker(): SourceFetchAttemptTracker {
  return { fetchAttemptCount: 0, retryCount: 0, retryReasonCodes: [] };
}

export function markInitialSourceFetchAttempt(tracker: SourceFetchAttemptTracker): void {
  if (tracker.fetchAttemptCount === 0 && tracker.retryCount === 0) {
    tracker.fetchAttemptCount = 1;
    return;
  }
  validateSourceFetchAttemptTracker(tracker);
}

export function markSourceFetchRetry(
  tracker: SourceFetchAttemptTracker,
  reason: RetryableSourceTransportFailureCode
): void {
  validateSourceFetchAttemptTracker(tracker);
  tracker.fetchAttemptCount += 1;
  tracker.retryCount += 1;
  tracker.retryReasonCodes.push(reason);
}

function validateSourceFetchAttemptTracker(tracker: SourceFetchAttemptTracker): void {
  if (!Number.isSafeInteger(tracker.fetchAttemptCount) || tracker.fetchAttemptCount < 1 ||
      !Number.isSafeInteger(tracker.retryCount) || tracker.retryCount < 0 ||
      tracker.retryCount >= tracker.fetchAttemptCount || !Array.isArray(tracker.retryReasonCodes) ||
      tracker.retryReasonCodes.length !== tracker.retryCount) {
    throw new Error("Source fetch attempt tracker is inconsistent");
  }
}

export interface RunSourceCrawlDeps {
  fetch: SourceFetchFunction;
  isBaseline?: boolean;
  attemptTracker?: SourceFetchAttemptTracker;
}

export class SourceCrawlStageError extends Error {
  constructor(
    readonly stage: "FETCH" | "ADAPTER",
    override readonly cause: unknown
  ) {
    super(`${stage} stage failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SourceCrawlStageError";
  }
}

export async function runSourceCrawl(
  plan: SourceCrawlPlan,
  deps: RunSourceCrawlDeps
): Promise<SourceCrawlResult> {
  let fetchResult: SourceFetchResult;
  const attemptTracker = deps.attemptTracker ?? createSourceFetchAttemptTracker();
  try {
    markInitialSourceFetchAttempt(attemptTracker);
    fetchResult = await deps.fetch(plan, attemptTracker);
  } catch (error) {
    throw new SourceCrawlStageError("FETCH", error);
  }

  const safeEvidenceUrl = canonicalPublicHttpUrl(plan.source.officialEntryUrl);
  if ([plan.source.id, plan.source.companyId, plan.company.id, plan.company.officialChineseName].some(containsSensitiveAdapterValue)) {
    return finalizeTruth(withFetchEvidence(failedAdapterInputResult(plan, fetchResult.capturedAt,
      "Adapter input metadata is unsafe", safeEvidenceUrl), fetchResult), fetchResult, plan);
  }

  if (!fetchResult.ok) {
    return finalizeTruth({
      ...failedFetchResult(plan, fetchResult.capturedAt, fetchResult.failureReason, safeEvidenceUrl),
      ...(fetchResult.fetchEvidence ? { fetchEvidence: fetchResult.fetchEvidence } : {}),
      ...(fetchResult.paginationEvaluation
        ? { paginationEvaluation: fetchResult.paginationEvaluation }
        : {}),
      ...(fetchResult.priorTransportAttempts
        ? { priorTransportAttempts: fetchResult.priorTransportAttempts }
        : {}),
      ...(fetchResult.transportFailure ? { transportFailure: fetchResult.transportFailure } : {})
    }, fetchResult, plan);
  }

  try {
    const safeSource = safeSourceClone(plan.source);
    if (!safeSource) {
      return finalizeTruth(withFetchEvidence(failedAdapterInputResult(
        plan,
        fetchResult.capturedAt,
        "Official source URLs are malformed or use an unsupported protocol",
        safeEvidenceUrl
      ), fetchResult), fetchResult, plan);
    }
    const baseInput = {
      company: plan.company,
      source: safeSource,
      capturedAt: fetchResult.capturedAt,
      ...(deps.isBaseline === undefined ? {} : { isBaseline: deps.isBaseline }),
      ...("completeness" in fetchResult && fetchResult.completeness
        ? { completeness: safeCompletenessEvidence(fetchResult.completeness) }
        : {})
    };

    if (plan.adapterId === "official-json") {
      if (!("payload" in fetchResult)) {
        return finalizeTruth(withFetchEvidence(failedAdapterInputResult(
          plan,
          fetchResult.capturedAt,
          "Expected JSON payload for official-json adapter",
          safeEvidenceUrl
        ), fetchResult), fetchResult, plan);
      }

      const adapterResult = reconcileResult(officialJsonAdapter.extract({
        ...baseInput,
        payload: fetchResult.payload,
        json: plan.json
      }), fetchResult);
      attachYelloPublicAgeEvidence(plan, fetchResult.fetchEvidence, adapterResult.jobs);
      return finalizeTruth(withFetchEvidence(
        enforceStrictPfizerMainlandEvidence(adapterResult, fetchResult, plan),
        fetchResult
      ), fetchResult, plan);
    }

    if (!("html" in fetchResult)) {
      return finalizeTruth(withFetchEvidence(failedAdapterInputResult(
        plan,
        fetchResult.capturedAt,
        "Expected HTML payload for html-table adapter",
        safeEvidenceUrl
      ), fetchResult), fetchResult, plan);
    }

    if (fetchResult.fetchEvidence?.astraZenecaDetails) {
      const replay = replayAstraZenecaDetails(plan, fetchResult.fetchEvidence, fetchResult.capturedAt, deps.isBaseline ?? true);
      const normalized = reconcileAdapterRows(replay.jobs.length, replay.jobs.length, replay.jobs, []);
      const result: CrawlAdapterResult = { status: "SUCCESS", ...normalized, observation: {
        id: `${plan.source.id}:astrazeneca-details:${fetchResult.capturedAt}`, sourceId: plan.source.id,
        crawledAt: new Date(fetchResult.capturedAt), successful: true, structuredJobCount: replay.jobs.length,
        stableRequiredFields: ["company", "title", "officialUrl", "location"],
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        ...(!replay.detailComplete || replay.scopeReviewRequired ? {completenessBlockerReason: replay.scopeReviewRequired ? "ASTRAZENECA_SOURCE_SCOPE_REVIEW" : "ASTRAZENECA_DETAIL_UNRESOLVED"} : {})
      }};
      return finalizeTruth(withFetchEvidence(result, fetchResult), fetchResult, plan);
    }
    if (isSanofiChinesePlan(plan) && fetchResult.fetchEvidence) {
      const replay = replaySanofiChineseNative(plan,fetchResult.fetchEvidence,deps.isBaseline ?? true);
      const normalized = reconcileAdapterRows(replay.jobs.length,replay.jobs.length,replay.jobs,[]);
      const result:CrawlAdapterResult = {status:"SUCCESS",...normalized,observation:{
        id:`${plan.source.id}:cn-native:${fetchResult.capturedAt}`,sourceId:plan.source.id,crawledAt:new Date(fetchResult.capturedAt),
        successful:true,structuredJobCount:replay.jobs.length,stableRequiredFields:["company","title","officialUrl","location"],
        completenessStatus:"NEEDS_MANUAL_COMPLETENESS_REVIEW"
      }};
      return finalizeTruth(withFetchEvidence(result,fetchResult),fetchResult,plan);
    }
    const htmlResult = reconcileResult(htmlTableAdapter.extract({
      ...baseInput, html: fetchResult.html, table: plan.table
    }), fetchResult);
    if (hasAstellasPdfCityPlan(plan) && fetchResult.fetchEvidence?.astellasPdfLocations) {
      const replay = await replayAstellasPdfCities(plan, fetchResult.fetchEvidence, fetchResult.capturedAt, deps.isBaseline ?? true);
      htmlResult.jobs = replay.jobs;
    }
    return finalizeTruth(withFetchEvidence(htmlResult, fetchResult), fetchResult, plan);
  } catch (error) {
    throw new SourceCrawlStageError("ADAPTER", error);
  }
}

function reconcileResult(result: CrawlAdapterResult, fetchResult: Extract<SourceFetchResult, { ok: true }>): CrawlAdapterResult {
  let ledger;
  try { ledger = assertAdapterReconciliation(result); }
  catch { return failedReconciliation(result); }
  const boundaryValid = !fetchResult.fetchEvidence ||
    fetchResult.fetchEvidence.fetchCounts.validCount === ledger.rawInputCount;
  const officialZero = fetchResult.fetchEvidence?.declaredCompleteness !== undefined &&
    fetchResult.paginationEvaluation?.safeCompleteness === true &&
    fetchResult.paginationEvaluation.verifiedEligible === true &&
    fetchResult.fetchEvidence.fetchCounts.validCount === 0 && ledger.rawInputCount === 0 &&
    ledger.adapterLosses.length === 0;
  if (result.status === "FAILED" && officialZero) {
    const { failureReason: _failureReason, ...observation } = result.observation;
    return { status: "SUCCESS", jobs: [], reconciliation: ledger, observation: {
      ...observation, successful: true, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      completenessBlockerReason: "Official zero observed; completeness remains manual", structuredJobCount: 0
    } };
  }
  if (boundaryValid) return result;
  return failedReconciliation(result);
}

function enforceStrictPfizerMainlandEvidence(
  result: CrawlAdapterResult,
  fetchResult: Extract<SourceFetchResult, { ok: true }>,
  plan: SourceCrawlPlan
): CrawlAdapterResult {
  if (plan.adapterId !== "official-json" ||
    plan.workday?.opaqueMultiLocationDetailPolicy !== "PFIZER_AUDITED_APAC_DETAIL_V1") return result;
  try {
    if (!fetchResult.fetchEvidence) return failedReconciliation(result);
    const evidence = parsePersistentSourceFetchEvidence(fetchResult.fetchEvidence);
    const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
    return strictPfizerOpaqueDetailReplay(plan, evidence, artifacts, result.jobs)
      ? result
      : failedReconciliation(result);
  } catch {
    return failedReconciliation(result);
  }
}

function failedReconciliation(result: CrawlAdapterResult): CrawlAdapterResult {
  const failureReason = "Adapter reconciliation failed closed";
  return { status: "FAILED", jobs: [], failureReason, reconciliation: result.reconciliation ?? emptyReconciliation(), observation: {
    ...result.observation, successful: false, stableRequiredFields: [], structuredJobCount: 0,
    completenessStatus: "FAILED", completenessBlockerReason: failureReason, failureReason
  } };
}

function withFetchEvidence(
  result: CrawlAdapterResult,
  fetchResult: SourceFetchResult
): Omit<SourceCrawlResult, "truth"> {
  return {
    ...result,
    ...(fetchResult.fetchEvidence ? { fetchEvidence: fetchResult.fetchEvidence } : {}),
    ...(fetchResult.paginationEvaluation
      ? { paginationEvaluation: fetchResult.paginationEvaluation }
      : {}),
    ...(fetchResult.priorTransportAttempts
      ? { priorTransportAttempts: fetchResult.priorTransportAttempts }
      : {}),
    ...(!fetchResult.ok && fetchResult.transportFailure
      ? { transportFailure: fetchResult.transportFailure }
      : {})
  };
}

async function finalizeTruth(
  result: Omit<SourceCrawlResult, "truth">,
  fetchResult: SourceFetchResult,
  plan: SourceCrawlPlan
): Promise<SourceCrawlResult> {
  const transportSuccess = fetchResult.ok;
  let adapterSuccess = false;
  let ledger;
  if (transportSuccess && result.status === "SUCCESS" && result.observation.successful &&
    result.observation.structuredJobCount === result.jobs.length) {
    try {
      ledger = assertAdapterReconciliation(result);
      adapterSuccess = true;
    } catch {
      adapterSuccess = false;
    }
  }

  if (adapterSuccess) applySanofiNativeProjection(plan,fetchResult.fetchEvidence,result.jobs);
  const completenessVerified = adapterSuccess && fetchResult.fetchEvidence !== undefined && fetchResult.paginationEvaluation !== undefined &&
    await replayStrictSourceQualityEvidenceAsync({plan,evidence:fetchResult.fetchEvidence,paginationEvaluation:fetchResult.paginationEvaluation,
      reconciliation:ledger!,jobs:result.jobs,capturedAt:fetchResult.capturedAt});
  const observation = rebuildObservationEvidenceFields(result.observation, fetchResult);
  if (completenessVerified) {
    const strictEvidence = parsePersistentSourceFetchEvidence(fetchResult.fetchEvidence);
    const declaration = strictEvidence.declaredCompleteness!;
    const declarationArtifact = strictEvidence.artifacts.find(
      (artifact) => artifact.logicalKey === declaration.artifactLogicalKey
    )!;
    observation.completenessStatus = "VERIFIED";
    observation.completenessEvidenceKind = declaration.kind;
    observation.completenessEvidenceUrl = declarationArtifact.finalUrl ?? declarationArtifact.requestedUrl!;
    if (declaration.kind === "OFFICIAL_TOTAL_COUNT") {
      observation.expectedJobCount = hasBiSemanticPlan(plan) ? strictEvidence.fetchCounts.validCount : profileBoundPersistedExpectedJobCount(
        plan,
        strictEvidence,
        result.jobs
      ) ?? declaration.value;
    }
    delete observation.completenessBlockerReason;
  } else if (observation.completenessStatus === "VERIFIED") {
    observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
    observation.completenessBlockerReason = "Strict completeness evidence gate was not satisfied";
  }
  if (!completenessVerified && requiresHansohNativeWindowReplay(plan) && fetchResult.fetchEvidence &&
      hasUnrecognizedHansohLocation(fetchResult.fetchEvidence)) {
    observation.completenessBlockerReason = "HANSOH_UNRECOGNIZED_MAINLAND_LOCATION";
  }
  if (!completenessVerified && hasAstraZenecaDetailPlan(plan) && !fetchResult.fetchEvidence?.astraZenecaDetails) {
    observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
    observation.completenessBlockerReason = "ASTRAZENECA_DETAIL_EVIDENCE_REQUIRED";
  }
  if (!completenessVerified && plan.source.id === "source-abbvie-china-social" &&
      result.jobs.some(job => !reviewedAbbvieCity(job.locationRaw))) {
    observation.completenessBlockerReason = "ABBVIE_UNRECOGNIZED_CITY_PROVINCE_PAIR";
  }
  if (!completenessVerified && hasAstellasPdfCityPlan(plan)) {
    if (fetchResult.fetchEvidence?.astellasPdfLocations?.runtimeCapability.available === false) {
      observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
      observation.completenessBlockerReason = "ASTELLAS_PDF_RUNTIME_UNAVAILABLE";
    } else if (result.jobs.some(job=>job.evidence.astellasPdfLocation?.status === "UNREVIEWED_LOCATION")) {
      observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
      observation.completenessBlockerReason = "ASTELLAS_PDF_UNREVIEWED_LOCATION";
    }
  }
  return { ...result, observation, truth: { transportSuccess, adapterSuccess, completenessVerified } } as SourceCrawlResult;
}

function rebuildObservationEvidenceFields(
  input: CrawlAdapterResult["observation"],
  fetchResult: SourceFetchResult
): CrawlAdapterResult["observation"] {
  const observation = { ...input };
  delete observation.expectedJobCount;
  delete observation.totalPages;
  delete observation.pageSize;
  delete observation.pagesVisited;
  if (!fetchResult.fetchEvidence) {
    if (fetchResult.ok) {
      delete observation.completenessEvidenceKind;
      delete observation.completenessEvidenceUrl;
    }
    return observation;
  }
  try {
    const evidence = parsePersistentSourceFetchEvidence(fetchResult.fetchEvidence);
    const declaration = evidence.declaredCompleteness;
    if (!declaration) {
      delete observation.completenessEvidenceKind;
      delete observation.completenessEvidenceUrl;
      return observation;
    }
    const artifact = evidence.artifacts.find(
      (candidate) => candidate.logicalKey === declaration.artifactLogicalKey
    );
    observation.completenessEvidenceKind = declaration.kind;
    const evidenceUrl = artifact?.finalUrl ?? artifact?.requestedUrl;
    if (evidenceUrl !== undefined) {
      observation.completenessEvidenceUrl = evidenceUrl;
    } else {
      delete observation.completenessEvidenceUrl;
    }
    if (declaration.kind === "OFFICIAL_TOTAL_COUNT") observation.expectedJobCount = declaration.value;
    if (declaration.kind === "OFFICIAL_TOTAL_PAGES") observation.totalPages = declaration.value;
    observation.pagesVisited = evidence.pages.length;
    const pageSizes = evidence.pages.flatMap((page) => {
      const requested = page.requestedPageSize;
      const returned = page.returnedPageSize;
      return requested !== null && requested !== undefined &&
        returned !== null && returned !== undefined && requested === returned ? [requested] : [];
    });
    if (pageSizes.length === evidence.pages.length && new Set(pageSizes).size === 1) {
      const pageSize = pageSizes[0];
      if (pageSize !== undefined) observation.pageSize = pageSize;
    }
    return observation;
  } catch {
    delete observation.completenessEvidenceKind;
    delete observation.completenessEvidenceUrl;
    return observation;
  }
}

/** Replays source-specific raw evidence; this does not authenticate acquisition. */
export function replayStrictSourceQualityEvidence(input: {
  plan: SourceCrawlPlan;
  evidence: PersistentSourceFetchEvidence;
  paginationEvaluation: PaginationEvaluation;
  reconciliation: ReturnType<typeof assertAdapterReconciliation>;
  jobs: readonly NormalizedJobRecord[];
  capturedAt: string;
}): boolean {
  if (hasNovartisOfficialPresencePlan(input.plan) && hasNovartisPresenceArtifacts(input.evidence)) {
    try {
      const replay = replayNovartisOfficialPresence(input.plan,input.evidence);
      return strictCompletenessGate({ok:true,capturedAt:input.capturedAt,payload:null,fetchEvidence:replay.listEvidence,
        paginationEvaluation:input.paginationEvaluation},input.reconciliation,input.plan,input.jobs);
    } catch { return false; }
  }
  if (hasBeisenDetailDatePlan(input.plan)) {
    try {
      const listEvidence = replayBeisenDetailDates(input.plan,input.evidence,input.jobs,input.capturedAt);
      return strictCompletenessGate({ok:true,capturedAt:input.capturedAt,payload:null,fetchEvidence:listEvidence,
        paginationEvaluation:input.paginationEvaluation},input.reconciliation,input.plan,input.jobs);
    } catch { return false; }
  }
  if (hasAstraZenecaDetailPlan(input.plan) || input.evidence.astraZenecaDetails) {
    try {
      const replay = replayAstraZenecaDetails(input.plan,input.evidence,input.capturedAt,input.jobs[0]?.isBaseline ?? true);
      if (!replay.detailComplete || replay.scopeReviewRequired || !isDeepStrictEqual(replay.jobs,input.jobs)) return false;
      return strictCompletenessGate({ok:true,capturedAt:input.capturedAt,payload:null,fetchEvidence:replay.listEvidence,
        paginationEvaluation:input.paginationEvaluation},input.reconciliation,input.plan,input.jobs);
    } catch { return false; }
  }
  if (hasAstellasPdfCityPlan(input.plan) || input.evidence.astellasPdfLocations) return false;
  return strictCompletenessGate({
    ok: true, capturedAt: input.capturedAt, payload: null,
    fetchEvidence: input.evidence, paginationEvaluation: input.paginationEvaluation
  }, input.reconciliation, input.plan, input.jobs);
}

export async function replayStrictSourceQualityEvidenceAsync(input: Parameters<typeof replayStrictSourceQualityEvidence>[0]): Promise<boolean> {
  if (!hasAstellasPdfCityPlan(input.plan)) return replayStrictSourceQualityEvidence(input);
  try {
    const replay = await replayAstellasPdfCities(input.plan,input.evidence,input.capturedAt,input.jobs[0]?.isBaseline ?? true);
    if (!replay.runtimeAvailable || replay.hasUnreviewedLocation || !isDeepStrictEqual(replay.jobs,input.jobs)) return false;
    return strictCompletenessGate({ok:true,capturedAt:input.capturedAt,payload:null,fetchEvidence:replay.listEvidence,
      paginationEvaluation:input.paginationEvaluation},input.reconciliation,input.plan,input.jobs);
  } catch { return false; }
}

function strictCompletenessGate(
  fetchResult: SourceFetchResult,
  ledger: ReturnType<typeof assertAdapterReconciliation>,
  plan: SourceCrawlPlan,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  if (!fetchResult.ok || !fetchResult.fetchEvidence || !fetchResult.paginationEvaluation ||
    fetchResult.paginationEvaluation.safeCompleteness !== true) return strictGateTrace(plan, "INPUT_OR_PRIMARY_PAGINATION");
  try {
    const evidence = parsePersistentSourceFetchEvidence(fetchResult.fetchEvidence);
    if (plan.executionAuthority !== "STAGED") return strictGateTrace(plan, "EXECUTION_AUTHORITY");
    validateExecutablePlanChannelBinding(plan);
    if (isSanofiChinesePlan(plan)) {
      const checked=replaySanofiChineseNative(plan,evidence,outputJobs[0]?.isBaseline ?? true);
      const replay=evaluatePaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true,...SANOFI_CN_PAGINATION_POLICY});
      return isDeepStrictEqual(checked.jobs,outputJobs)&&replay.safeCompleteness&&replay.verifiedEligible&&
        isDeepStrictEqual(replay,fetchResult.paginationEvaluation)&&ledger.adapterLosses.length===0&&ledger.collisionGroups.length===0&&
        ledger.rawInputCount===outputJobs.length&&ledger.dedupeInputCount===outputJobs.length&&ledger.dedupeOutputCount===outputJobs.length;
    }
    if (isPfizerWorkdayTraversalPlan(plan)) {
      const replay = evaluatePaginationEvidence({evidence, expectedChannelIds:[], filteredOutput:true, ...PFIZER_PAGINATION_POLICY});
      return replay.verifiedEligible && replay.paginationTraceSha256 === fetchResult.paginationEvaluation.paginationTraceSha256 &&
        ledger.adapterLosses.length === 0 && ledger.collisionGroups.length === 0 && ledger.rawInputCount === outputJobs.length &&
        replayPfizerWorkdayTraversal(plan,evidence,outputJobs);
    }
    // This source-local DOM proof retains original UI observations without
    // claiming network metadata. Every other source follows the existing gates.
    if (evidence.captureTool.name === JNJ_DOM_CAPTURE_TOOL.name) {
      const replay = evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true });
      return replay.safeCompleteness && replay.verifiedEligible && replay.derivedAnomalyCodes.length === 0 &&
        replay.paginationTraceSha256 === fetchResult.paginationEvaluation.paginationTraceSha256 &&
        ledger.adapterLosses.length === 0 && ledger.collisionGroups.length === 0 &&
        ledger.rawInputCount === outputJobs.length && ledger.dedupeInputCount === outputJobs.length &&
        ledger.dedupeOutputCount === outputJobs.length && replayJnjCareersDomEvidence(plan, evidence, outputJobs);
    }
    const expectedChannelIds = planBoundEvidenceChannelIds(plan, evidence);
    if (expectedChannelIds === undefined) return strictGateTrace(plan, "CHANNEL_BINDING");
    const biSource = plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "51job-coapi";
    const biProof = biSource ? replayBiSemanticCompleteness(plan, evidence, outputJobs, fetchResult.capturedAt) : undefined;
    if (biSource && !biProof) return strictGateTrace(plan, "BI_SEMANTIC_REPLAY");
    const configuredHtmlProof = plan.adapterId === "html-table" &&
      plan.table.completenessProof !== undefined;
    const profileBoundEvidenceValidated = plan.adapterId === "official-json" && plan.profileBoundSource
      ? validateStrictProfileBoundSourceEvidence(plan, evidence, outputJobs)
      : false;
    if (plan.adapterId === "official-json" && plan.profileBoundSource && !profileBoundEvidenceValidated) {
      return strictGateTrace(plan, "PROFILE_BOUND_EVIDENCE");
    }
    const novoProof = exactNovoChinaQualityPlan(plan) && replayNovoChinaRows(plan, evidence, outputJobs, fetchResult.capturedAt);
    let artifactUrlBindings: Map<string, StrictUrlRule[]> | undefined;
    if (configuredHtmlProof) {
      if (!validateStrictHtmlCompletenessProof(plan, evidence, outputJobs)) return strictGateTrace(plan, "HTML_PROOF");
    } else {
      const urlRules = strictPlanUrlRules(plan);
      if (!urlRules) return strictGateTrace(plan, "URL_RULES");
      // Novo's supplemental native-detail → official-application redirects are bound per ID by the replay above.
      const msdAjingaProof = plan.adapterId === "official-json" && plan.profileBoundSource?.kind === "msd-ajinga" && profileBoundEvidenceValidated;
      // Ajinga's per-ID query URLs have already been replayed exactly against each raw list row.
      const networkEvidence = novoProof ? {...evidence,artifacts:[evidence.artifacts[0]!]} : msdAjingaProof
        ? {...evidence,artifacts:evidence.artifacts.filter(a=>!a.logicalKey.startsWith("msd-ajinga-detail-")&&!a.logicalKey.startsWith("msd-ajinga-apply-"))} : evidence;
      artifactUrlBindings = strictNetworkArtifactUrlBindings(networkEvidence, urlRules);
      if (!artifactUrlBindings) return strictGateTrace(plan, "ARTIFACT_URL_BINDING");
      if (!strictEvidenceArtifactPurposes(plan, evidence, artifactUrlBindings)) {
        return strictGateTrace(plan, "ARTIFACT_PURPOSE");
      }
      if (!strictPageRequestContracts(plan, evidence, outputJobs, profileBoundEvidenceValidated, fetchResult.capturedAt)) {
        return strictGateTrace(plan, "PAGE_REQUEST_CONTRACT");
      }
    }
    const mokaScopeProof = isServierTraversalPlan(plan) ? replayServierTraversal(plan, evidence, outputJobs) : isBayerMedicalTraversalPlan(plan) ? replayBayerMedicalTraversal(plan, evidence, outputJobs)
      : hasHengruiScopeExclusionPolicy(plan) ? replayHengruiScopeExclusionProof(plan, evidence, outputJobs) : undefined;
    if (isServierTraversalPlan(plan) && !mokaScopeProof) return strictGateTrace(plan, "SERVIER_SCOPE_PROOF");
    if (isBayerMedicalTraversalPlan(plan) && !mokaScopeProof) return strictGateTrace(plan, "BAYER_SCOPE_PROOF");
    if (hasHengruiScopeExclusionPolicy(plan) && !mokaScopeProof) return strictGateTrace(plan, "MOKA_SCOPE_PROOF");
    // strictPageRequestContracts above has already replayed the complete Yello
    // partition and its exact exclusion ledger. No other source inherits this opt-in.
    const yelloScopeProof = exactGileadPublicAgePlan(plan);
    const kelunScopeProof = exactKelunMainlandPlan(plan) && replayKelunMainlandScope(plan, evidence, outputJobs) !== undefined;
    const hasScopeExclusionProof = hasConfiguredScopeExclusionProof(plan);
    if (evidence.fetchLosses.length > 0 && !hasScopeExclusionProof && !profileBoundEvidenceValidated && !mokaScopeProof && !biProof && !novoProof && !yelloScopeProof && !kelunScopeProof) {
      return strictGateTrace(plan, "UNPROVEN_FETCH_LOSS");
    }
    if (hasScopeExclusionProof && !validateStrictSourceScopeExclusionProof(plan, evidence, outputJobs)) {
      return strictGateTrace(plan, "SCOPE_EXCLUSION_PROOF");
    }
    const replayPolicy = strictPositiveOfficialTotalReplayPolicy(plan);
    const htmlReplayPolicy = strictHtmlPaginationReplayPolicy(plan);
    const declared = evidence.declaredCompleteness;
    const htmlOfficialTotalReplayPolicy = configuredHtmlProof &&
      declared?.kind === "OFFICIAL_TOTAL_COUNT" && declared.value > 0
      ? { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true as const }
      : undefined;
    const independentlyEvaluated = evaluatePaginationEvidence({
      evidence,
      expectedChannelIds,
      filteredOutput: true,
      ...(replayPolicy ?? {}),
      ...(htmlReplayPolicy ?? {}),
      ...(htmlOfficialTotalReplayPolicy ?? {})
    });
    if (independentlyEvaluated.safeCompleteness !== true || independentlyEvaluated.verifiedEligible !== true ||
      independentlyEvaluated.paginationTraceSha256 !== fetchResult.paginationEvaluation.paginationTraceSha256 ||
      JSON.stringify(independentlyEvaluated.derivedAnomalyCodes) !== JSON.stringify(fetchResult.paginationEvaluation.derivedAnomalyCodes) ||
      JSON.stringify(independentlyEvaluated.visitedChannelIds) !== JSON.stringify(fetchResult.paginationEvaluation.visitedChannelIds)) {
      return strictGateTrace(plan, "INDEPENDENT_PAGINATION_REPLAY");
    }
    const expectedAdapterOutputCount = configuredHtmlProof
      ? strictHtmlExpectedAdapterOutputCount(plan, evidence)
      : undefined;
    const legalPlanBoundDedupeCount = ledger.collisionGroups.reduce(
      (sum, group) => sum + group.droppedCount,
      0
    );
    const planBoundRawOverlapDedupe = replayPolicy?.allowRawIdOverlapAcrossPages === true &&
      legalPlanBoundDedupeCount > 0 && ledger.validBeforeDedupeCount === ledger.rawInputCount &&
      ledger.dedupeInputCount === ledger.rawInputCount &&
      ledger.dedupeOutputCount + legalPlanBoundDedupeCount === ledger.rawInputCount;
    const adapterOutputBoundaryValid = ledger.dedupeOutputCount === ledger.rawInputCount ||
      planBoundRawOverlapDedupe ||
      (expectedAdapterOutputCount !== undefined &&
        ledger.dedupeOutputCount === expectedAdapterOutputCount &&
        ledger.validBeforeDedupeCount === ledger.rawInputCount);
    if (!declared || declared.scope === "GLOBAL_UNFILTERED" || evidence.supportingArtifactOnlyFailure ||
      evidence.fetchCounts.validCount !== ledger.rawInputCount ||
      ledger.adapterLosses.length !== 0 || !adapterOutputBoundaryValid) return strictGateTrace(plan, "ADAPTER_BOUNDARY");
    const artifact = evidence.artifacts.find((candidate) => candidate.logicalKey === declared.artifactLogicalKey);
    if (!artifact || !["OFFICIAL_COMPANY_PAGE", "ATS_PAGE", "ATS_API_RESPONSE", "PAGINATION_PAGE"]
      .includes(artifact.kind)) return strictGateTrace(plan, "DECLARATION_ARTIFACT");
    const declaredArtifactRules = configuredHtmlProof
      ? []
      : artifactUrlBindings?.get(artifact.logicalKey);
    if (!declaredArtifactRules) return strictGateTrace(plan, "DECLARATION_URL_RULE");
    if (declared.kind === "OFFICIAL_TOTAL_COUNT") {
      const profileBoundExclusionReconciled = (profileBoundEvidenceValidated || mokaScopeProof !== undefined || biProof !== undefined || novoProof || yelloScopeProof) &&
        replayPolicy?.allowIndependentlyVerifiedProfileBoundExclusions === true &&
        declared.value === evidence.fetchCounts.rawCount &&
        ledger.rawInputCount === evidence.fetchCounts.validCount;
      if (declared.value !== ledger.rawInputCount && !profileBoundExclusionReconciled) return strictGateTrace(plan, "OFFICIAL_TOTAL_COUNT");
      const configuredHtmlPositiveTotal = configuredHtmlProof && plan.adapterId === "html-table" &&
        plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
        plan.table.pagination?.expectedJobCountSelector !== undefined;
      if (declared.value > 0 && !configuredHtmlPositiveTotal && !declaredArtifactRules.some((rule) =>
        rule.role === "ENDPOINT" && rule.allowsPositiveTotalDeclaration === true)) return strictGateTrace(plan, "POSITIVE_TOTAL_AUTHORITY");
    }
    return true;
  } catch {
    return strictGateTrace(plan, "EXCEPTION");
  }
}

function strictGateTrace(_plan: SourceCrawlPlan, _reason: string): false {
  return strictCompletenessTrace("STRICT_COMPLETENESS_GATE", _plan.source.id, _reason);
}

export function supportsStrictOfficialTotalCertificate(plan: SourceCrawlPlan): boolean {
  if (isSanofiChinesePlan(plan)) return false;
  if (isServierTraversalPlan(plan)) return false;
  if (plan.adapterId === "html-table") {
    if (plan.table.strictEmbeddedJsonZero?.kind === "TEVA_SMARTAPPLY_CHINA") return true;
    return plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
      plan.table.pagination?.expectedJobCountSelector !== undefined;
  }
  return strictPositiveOfficialTotalReplayPolicy(plan)
    ?.allowPositiveOfficialTotalCountAfterAdapterReconciliation === true;
}

export function validateStrictOfficialTotalCertificateEvidence(input: {
  plan: SourceCrawlPlan;
  evidence: PersistentSourceFetchEvidence;
  paginationEvaluation: NonNullable<SourceFetchResult["paginationEvaluation"]>;
  reconciliation: ReturnType<typeof assertAdapterReconciliation>;
  jobs: readonly NormalizedJobRecord[];
}): boolean {
  if (!supportsStrictOfficialTotalCertificate(input.plan) ||
      input.evidence.declaredCompleteness?.kind !== "OFFICIAL_TOTAL_COUNT") return false;
  // The source-local detail replay is synchronous. Bind every native detail and
  // the full output before the same strict official-total/list proof used by A.
  if (hasBeisenDetailDatePlan(input.plan) || hasAstraZenecaDetailPlan(input.plan) || input.evidence.astraZenecaDetails) {
    return replayStrictSourceQualityEvidence({...input,
      capturedAt: input.jobs[0]?.evidence.capturedAt ?? input.evidence.artifacts[0]?.capturedAt ?? ""});
  }
  return strictCompletenessGate({
    ok: true,
    capturedAt: input.evidence.artifacts[0]?.capturedAt ?? "",
    payload: null,
    fetchEvidence: input.evidence,
    paginationEvaluation: input.paginationEvaluation
  }, input.reconciliation, input.plan, input.jobs);
}

function hasConfiguredScopeExclusionProof(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json") return false;
  const strategy = plan.officialJsonFetch;
  return (strategy?.kind === "beisen-zhiye-2022" || strategy?.kind === "xiuzheng-job-list") &&
    strategy.scopeExclusionProof !== undefined;
}

function strictHtmlPaginationReplayPolicy(
  plan: SourceCrawlPlan
): { allowRawIdOverlapAcrossPages: true } | { allowMissingReturnedPage: true } | undefined {
  if (plan.adapterId !== "html-table") return undefined;
  if (plan.source.id === "source-novartis-social" &&
    plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "NOVARTIS_CHINA_SLIDING_WINDOW_V1" &&
    plan.table.pagination?.officialWindowMode === "NOVARTIS_PAGE_WINDOW_V1") {
    return { allowRawIdOverlapAcrossPages: true };
  }
  return plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.pagination !== undefined && plan.table.pagination.ajaxMode === undefined
    ? { allowMissingReturnedPage: true }
    : undefined;
}

function planBoundEvidenceChannelIds(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence
): string[] | undefined {
  const expectedChannels = plan.expectedChannels!;
  const allowedArtifactChannelIds = new Set(expectedChannels.map((channel) => channel.channelId));
  if (evidence.artifacts.some((artifact) => artifact.channelId !== undefined &&
    !allowedArtifactChannelIds.has(artifact.channelId))) return undefined;
  const declared = evidence.declaredCompleteness;
  if (!declared || evidence.pages.length === 0) return undefined;
  const declaredArtifact = evidence.artifacts.find(
    (artifact) => artifact.logicalKey === declared.artifactLogicalKey
  );
  if (!declaredArtifact) return undefined;
  const explicitPageChannels = evidence.pages.map((page) => page.channelId);
  const hasExplicitChannel = explicitPageChannels.some((channelId) => channelId !== undefined);
  const hasImplicitSource = explicitPageChannels.some((channelId) => channelId === undefined);
  if (hasExplicitChannel && hasImplicitSource) return undefined;

  if (hasImplicitSource) {
    const canonicalDefaultChannelId = `source:${plan.source.id}:default`;
    return declared.scope === "SOURCE" && declared.channelId === undefined &&
      declaredArtifact.channelId === undefined &&
      expectedChannels.length === 1 &&
      expectedChannels[0]?.channelId === canonicalDefaultChannelId &&
      expectedChannels[0]?.kind === "SOCIAL"
      ? []
      : undefined;
  }

  const expectedChannelIds = expectedChannels.map((channel) => channel.channelId);
  const expectedChannelSet = new Set(expectedChannelIds);
  if (expectedChannelSet.size !== expectedChannelIds.length || explicitPageChannels.some(
    (channelId) => channelId === undefined || !expectedChannelSet.has(channelId)
  )) return undefined;
  for (const page of evidence.pages) {
    const artifact = evidence.artifacts.find(
      (candidate) => candidate.logicalKey === page.artifactLogicalKey
    );
    if (!artifact || artifact.channelId !== page.channelId ||
      !artifact.channelId || !expectedChannelSet.has(artifact.channelId)) return undefined;
  }

  const visitedChannels = new Set(explicitPageChannels as string[]);
  if (declared.scope === "SOURCE") {
    if (declared.channelId !== undefined || declaredArtifact.channelId !== undefined ||
      visitedChannels.size !== expectedChannelSet.size ||
      expectedChannelIds.some((channelId) => !visitedChannels.has(channelId))) return undefined;
  } else if (declared.scope === "CHANNEL") {
    if (expectedChannelIds.length !== 1 || !declared.channelId || declared.channelId !== expectedChannelIds[0] ||
      declaredArtifact.channelId !== declared.channelId ||
      visitedChannels.size !== 1 || !visitedChannels.has(declared.channelId)) return undefined;
  } else {
    return undefined;
  }

  return expectedChannelIds;
}

type StrictUrlRule = {
  id: string;
  role: "ENTRY" | "CHAIN" | "ENDPOINT" | "ENTRY_REDIRECT";
  origin: string;
  pathname: string;
  pathnamePrefix?: true;
  exactSearches: readonly string[];
  allowTrailingSlash?: true;
  allowsPagination?: true;
  allowsDeclaration?: true;
  allowsPositiveTotalDeclaration?: true;
};

const STRICT_NETWORK_ARTIFACT_KINDS = new Set([
  "OFFICIAL_COMPANY_PAGE", "REDIRECT_TRACE", "ATS_PAGE", "ATS_API_RESPONSE", "PAGINATION_PAGE"
]);

function strictNetworkArtifactUrlBindings(
  evidence: PersistentSourceFetchEvidence,
  rules: readonly StrictUrlRule[]
): Map<string, StrictUrlRule[]> | undefined {
  const bindings = new Map<string, StrictUrlRule[]>();
  for (const artifact of evidence.artifacts) {
    if (!STRICT_NETWORK_ARTIFACT_KINDS.has(artifact.kind)) continue;
    const matched = strictArtifactUrlBinding(rules, artifact.requestedUrl!, artifact.finalUrl!);
    if (!matched) return undefined;
    bindings.set(artifact.logicalKey, matched);
  }
  return bindings;
}

function strictEvidenceArtifactPurposes(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  bindings: ReadonlyMap<string, readonly StrictUrlRule[]>
): boolean {
  for (const page of evidence.pages) {
    const pageRules = bindings.get(page.artifactLogicalKey);
    if (!pageRules?.some((rule) => rule.allowsPagination === true)) return false;
    if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "sandoz-jsonapi") {
      if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || page.requestedPage !== page.sequence ||
        !pageRules.some((rule) => rule.id === `sandoz-primary-${page.sequence}`)) return false;
    }
    if (plan.adapterId === "official-json" && plan.hotjobLegacy?.paginationMode === "query-page") {
      if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || page.requestedPage !== page.sequence + 1 ||
        !pageRules.some((rule) => rule.id === `hotjob-legacy-page-${page.sequence + 1}`)) return false;
    }
  }
  const declaration = evidence.declaredCompleteness;
  if (!declaration) return false;
  return bindings.get(declaration.artifactLogicalKey)?.some(
    (rule) => rule.allowsDeclaration === true
  ) === true;
}

function strictPageRequestContracts(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[],
  profileBoundEvidenceValidated: boolean,
  capturedAt: string
): boolean {
  if (plan.adapterId !== "official-json") return true;
  if (plan.workday) return strictWorkdayRequestContracts(plan, evidence, outputJobs) && replayWorkdayMainlandQuality(plan, evidence, outputJobs, capturedAt);
  if (plan.moka) return strictMokaRequestContracts(plan, evidence);
  if (plan.hotjobLegacy) return validateStrictHotjobLegacyEvidence(plan, evidence, outputJobs);
  if (plan.profileBoundSource) return profileBoundEvidenceValidated;
  const strategy = plan.officialJsonFetch;
  if (strategy?.kind === "novo-nordisk") return strictNovoRequestContracts(plan, evidence) &&
    (strategy.cityScopePolicy !== NOVO_CHINA_LOCATION_POLICY || replayNovoChinaRows(plan, evidence, outputJobs, capturedAt));
  if (strategy?.kind === "phenom") return strictPhenomRequestContracts(plan, evidence, outputJobs, capturedAt);
  if (strategy?.kind === "beisen-zhiye-2022") return strictBeisenRequestContracts(plan, evidence, outputJobs);
  if (strategy?.kind === "hcm-cloud") return strictHcmRequestContracts(plan, evidence);
  if (strategy?.kind === "jobsyn-solr") return strictJobsynRequestContracts(plan, evidence);
  if (strategy?.kind === "cnstaff") return strictCnstaffRequestContracts(plan, evidence);
  if (strategy?.kind === "eightfold-pcsx") return strictEightfoldDateReplay(plan, evidence, outputJobs, capturedAt);
  if (strategy?.kind === "sandoz-jsonapi") return strictSandozScopeArtifacts(plan, evidence);
  if (strategy?.kind === "redsea-zp-channel") return strictRedseaRequestContracts(plan, evidence);
  if (strategy?.kind === "yello-job-board") return strictYelloRequestContracts(plan, evidence, outputJobs, capturedAt);
  return true;
}

function strictYelloRequestContracts(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[],
  capturedAt: string
): boolean {
  const config = plan.officialJsonFetch;
  if (!exactGileadPublicAgePlan(plan) || config?.kind !== "yello-job-board" || evidence.pages.length !== 1 || evidence.artifacts.length !== 1) {
    return false;
  }
  let binding: ReturnType<typeof yelloJobBoardBinding>;
  try { binding = yelloJobBoardBinding(plan.source.officialEntryUrl, config); }
  catch { return false; }
  const evidenceEndpoint = sanitizeEvidenceHttpUrl(binding.endpointUrl);
  const artifact = evidence.artifacts[0]!, page = evidence.pages[0]!;
  if (artifact.logicalKey !== page.artifactLogicalKey || artifact.bodyRepresentation === "REDACTED" ||
      artifact.requestedUrl !== evidenceEndpoint || artifact.finalUrl !== evidenceEndpoint ||
      artifact.extractorLocator !== binding.extractorLocator ||
      !strictPageCoordinatesEqual(page, { sequence: 0, requestedCursor: null, requestedOffset: null,
        requestedPage: null, requestedPageSize: null }) ||
      createHash("sha256").update(typeof artifact.body === "string"
        ? Buffer.from(artifact.body, "utf8") : Buffer.from(artifact.body)).digest("hex") !==
        page.responseFingerprintSha256) return false;
  let parsed: ReturnType<typeof parseYelloJobBoardResponse>;
  try { parsed = parseYelloJobBoardResponse(typeof artifact.body === "string"
    ? artifact.body : Buffer.from(artifact.body).toString("utf8"), config); }
  catch { return false; }
  const compare = (left: string, right: string) => Buffer.from(left).compare(Buffer.from(right));
  const expectedSourceIds = parsed.jobs.map(({ officialId }) => persistentOfficialJsonJobId(officialId)).sort(compare);
  const actualSourceIds = outputJobs.flatMap(({ sourceJobId }) => sourceJobId ? [sourceJobId] : []).sort(compare);
  const rawIds = parsed.rows.map(row => irreversibleOfficialJsonEvidenceId([row.rowIndex, row.rawHtml])).sort(compare);
  const validIds = expectedSourceIds.map(id => irreversibleOfficialJsonEvidenceId(id)).sort(compare);
  if (!isDeepStrictEqual(rawIds, [...page.rawJobIds].sort(compare)) || !isDeepStrictEqual(validIds, [...page.validJobIds].sort(compare))) return false;
  if (!isDeepStrictEqual(evidence.fetchLosses, parsed.excludedJobs.map(row => yelloScopeExclusionLoss(row, artifact))) ||
      !isDeepStrictEqual(evidence.fetchCounts, { rawCount: parsed.rows.length, parsedCount: parsed.rows.length,
        validCount: parsed.jobs.length, parseDiscardCount: 0, validationDiscardCount: parsed.excludedJobs.length })) return false;
  const byId = new Map(outputJobs.map(job => [job.sourceJobId, job]));
  // Match the adapter's text cleanup; exact source spelling/whitespace remains bound by the row hash.
  const normalizedText = (value: string) => value.replace(/\s+/gu, " ").trim();
  for (const row of parsed.jobs) {
    const job = byId.get(persistentOfficialJsonJobId(row.officialId));
    if (!job || job.companyId !== plan.company.id || job.sourceId !== plan.source.id || job.sourceKind !== "SOCIAL" ||
        job.atsKind !== "OFFICIAL_JSON" || job.officialChineseCompanyName !== plan.company.officialChineseName ||
        job.officialTitle !== normalizedText(row.title) || job.locationRaw !== normalizedText(row.locationRaw) || !isDeepStrictEqual(job.cities, row.cities) ||
        job.officialUrl !== row.officialUrl || job.listUrl !== plan.source.officialEntryUrl ||
        job.officialPublishedAt !== undefined || job.auxiliaryChineseTitle !== undefined || job.category !== "其他" ||
        job.evidence.officialEntryUrl !== plan.source.officialEntryUrl || job.evidence.officialChainEvidenceUrl !== plan.source.officialChainEvidenceUrl ||
        job.evidence.capturedAt !== capturedAt || !isDeepStrictEqual(job.evidence.gileadPublicAge, yelloPublicAgeEvidence(row, row.rowIndex, artifact))) return false;
  }
  const declaration = evidence.declaredCompleteness;
  return parsed.declaredTotal === parsed.rows.length && parsed.rows.length === parsed.jobs.length + parsed.excludedJobs.length &&
    page.rawJobIds.length === parsed.rows.length &&
    page.validJobIds.length === parsed.jobs.length && page.declaredTotal === parsed.declaredTotal &&
    page.declaredCount === parsed.declaredTotal && page.termination === "NEXT_ABSENT" &&
    actualSourceIds.length === outputJobs.length &&
    JSON.stringify(expectedSourceIds) === JSON.stringify(actualSourceIds) &&
    declaration?.kind === "OFFICIAL_TOTAL_COUNT" && declaration.scope === "SOURCE" &&
    declaration.value === parsed.declaredTotal && declaration.artifactLogicalKey === artifact.logicalKey &&
    declaration.extractorLocator === binding.extractorLocator;
}

function strictNovoRequestContracts(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence
): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "novo-nordisk" || evidence.pages.length !== 1 ||
    (config.applicationStatusPolicy ? evidence.artifacts.length < 2 : evidence.artifacts.length !== 1)) return false;
  let endpoints: ReturnType<typeof strictNovoConfiguredEndpoints>;
  try { endpoints = strictNovoConfiguredEndpoints(config.endpointUrl); }
  catch { return false; }
  if (endpoints.request.origin !== new URL(plan.source.officialEntryUrl).origin) return false;
  const page = evidence.pages[0]!;
  if (!strictPageCoordinatesEqual(page, {
    sequence: 0,
    requestedCursor: null,
    requestedOffset: null,
    requestedPage: null,
    requestedPageSize: null
  })) return false;
  const artifact = evidence.artifacts[0]!;
  if (artifact.logicalKey !== page.artifactLogicalKey ||
    artifact.bodyRepresentation === "REDACTED" ||
    artifact.requestedUrl !== endpoints.evidence.toString() ||
    artifact.finalUrl !== endpoints.evidence.toString()) return false;
  const root = strictUniqueJsonRecord(artifact.body);
  const data = strictRecord(root?.data);
  if (!data || !Array.isArray(data.jobs)) return false;
  const totalPath = Object.prototype.hasOwnProperty.call(data, "totalMatches")
    ? "$.data.totalMatches" as const
    : Object.prototype.hasOwnProperty.call(data, "total")
      ? "$.data.total" as const
      : undefined;
  const total = totalPath === "$.data.totalMatches" ? data.totalMatches : data.total;
  if (!totalPath || !strictNonnegativeInteger(total) || data.jobs.length !== total ||
    page.rawJobIds.length !== data.jobs.length || page.declaredTotal !== total ||
    (total === 0 ? page.termination !== "EMPTY_PAGE" : page.termination !== (config.applicationStatusPolicy ? "NEXT_ABSENT" : "DECLARED_TOTAL_REACHED")) ||
    createHash("sha256").update(typeof artifact.body === "string"
      ? Buffer.from(artifact.body, "utf8") : Buffer.from(artifact.body)).digest("hex") !==
      page.responseFingerprintSha256) return false;
  const countryHash = createHash("sha256")
    .update(JSON.stringify("China"), "utf8")
    .digest("hex");
  const locator = `official-json-single-v1|kind:novo-nordisk|request:country=sha256:${countryHash}|json:${totalPath}`;
  return artifact.extractorLocator === locator &&
    evidence.declaredCompleteness?.kind === "OFFICIAL_TOTAL_COUNT" &&
    evidence.declaredCompleteness.scope === "SOURCE" &&
    evidence.declaredCompleteness.value === total &&
    evidence.declaredCompleteness.artifactLogicalKey === artifact.logicalKey &&
    evidence.declaredCompleteness.extractorLocator === locator;
}

function strictPageCoordinatesEqual(
  page: SourceFetchPageTrace,
  expected: {
    sequence: number;
    requestedCursor: string | null;
    requestedOffset: number | null;
    requestedPage: number | null;
    requestedPageSize: number | null;
  }
): boolean {
  return page.sequence === expected.sequence &&
    (page.requestedCursor ?? null) === expected.requestedCursor &&
    (page.requestedOffset ?? null) === expected.requestedOffset &&
    (page.requestedPage ?? null) === expected.requestedPage &&
    (page.requestedPageSize ?? null) === expected.requestedPageSize;
}

type GateRequestContract = {
  family: "workday" | "moka" | "phenom" | "beisen" | "hcm" | "redsea" | "livzon-cecc" | "eightfold";
  role: string;
  method: "GET" | "POST";
  url: string;
  body: unknown;
  coordinate: unknown;
};

function strictRequestContractMatches(locator: string, contract: GateRequestContract): boolean {
  const allMarkers = locator.match(/\|request-contract-v2\|sha256:[0-9a-f]{64}/gu) ?? [];
  if (allMarkers.length !== 1) return false;
  const canonical = strictGateCanonicalValue({
    v: 2,
    family: contract.family,
    role: contract.role,
    method: contract.method,
    url: contract.url,
    body: contract.body,
    coordinate: contract.coordinate
  });
  const digest = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
  return locator.endsWith(`|request-contract-v2|sha256:${digest}`);
}

function strictGateCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strictGateCanonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => [key, strictGateCanonicalValue(child)]));
  }
  return value;
}

function strictRedseaRequestContracts(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence
): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "redsea-zp-channel" ||
    config.paginationPolicy !== "SINGLE_UNPAGINATED_RESPONSE_V1" ||
    !Array.isArray(config.channels)) return false;
  const bindings = config.channels;
  if (bindings.some((binding) =>
    !strictGateExactObjectKeys(binding, ["channelQrId", "purpose"]) ||
    !safeOfficialJsonId(binding.channelQrId) ||
    (binding.purpose !== "SOCIAL" && binding.purpose !== "CAMPUS")) ||
    new Set(bindings.map(({ channelQrId }) => channelQrId)).size !== bindings.length) return false;
  const socialIds = bindings.filter(({ purpose }) => purpose === "SOCIAL").map(({ channelQrId }) => channelQrId);
  if (socialIds.length !== 1 || plan.expectedChannels?.length !== 1 ||
    plan.expectedChannels[0]?.kind !== "SOCIAL" || plan.expectedChannels[0].channelId !== socialIds[0] ||
    evidence.pages.length !== 1 || ![3, 4].includes(evidence.artifacts.length)) return false;

  const channelQrId = socialIds[0]!;
  const origin = new URL(plan.source.officialEntryUrl).origin;
  const entryUrl = new URL(
    `/RedseaPlatform/zhaopin/zpChannelQrCode/${channelQrId}/officeWebsite.mob`, origin
  ).toString();
  if (plan.source.officialEntryUrl !== entryUrl) return false;
  const listUrl = new URL("/RedseaPlatform/zhaopin/zpChannelQrCode/officePage.mob", origin);
  listUrl.searchParams.set("noHead", "1");
  listUrl.searchParams.set("pageId", "list");
  listUrl.searchParams.set("configId", channelQrId);
  listUrl.searchParams.set("lectureId", "");
  const listEvidenceUrl = sanitizeEvidenceHttpUrl(listUrl.toString());
  const apiUrl = new URL("/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob", origin).toString();
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  if (artifacts.size !== evidence.artifacts.length) return false;
  const entryArtifact = artifacts.get(`redsea-${channelQrId}-entry`);
  const listArtifact = artifacts.get(`redsea-${channelQrId}-list`);
  const apiArtifact = artifacts.get(`redsea-${channelQrId}-api`);
  if (!entryArtifact || !listArtifact || !apiArtifact ||
    evidence.artifacts.some((artifact) => artifact.channelId !== channelQrId) ||
    entryArtifact.requestedUrl !== entryUrl || entryArtifact.finalUrl !== entryUrl ||
    listArtifact.requestedUrl !== listEvidenceUrl || listArtifact.finalUrl !== listEvidenceUrl ||
    apiArtifact.requestedUrl !== apiUrl || apiArtifact.finalUrl !== apiUrl ||
    apiArtifact.bodyRepresentation === "REDACTED") return false;

  const page = evidence.pages[0]!;
  if (!strictPageCoordinatesEqual(page, {
    sequence: 0,
    requestedCursor: channelQrId,
    requestedOffset: null,
    requestedPage: null,
    requestedPageSize: null
  }) || page.returnedCursor !== channelQrId || page.channelId !== channelQrId ||
    page.artifactLogicalKey !== apiArtifact.logicalKey || page.termination !== "NEXT_ABSENT" ||
    page.nextPageSignalBefore !== null || page.nextPageSignalAfter !== null) return false;

  const root = strictUniqueJsonRecord(apiArtifact.body);
  if (!root || root.state !== "1" || !Array.isArray(root.jsonList) ||
    strictRedseaHasUnsafePaginationSignal(root, root.jsonList.length) ||
    page.rawJobIds.length !== root.jsonList.length) return false;
  if (typeof listArtifact.body !== "string" || typeof apiArtifact.body !== "string") return false;
  const candidateScope = auditRedseaCandidateScope(listArtifact.body, root.jsonList);
  if (!candidateScope.complete) return false;
  const hasAbsentCandidates = candidateScope.unexplainedCandidateIds.length > 0;
  if (artifacts.size !== (hasAbsentCandidates ? 4 : 3)) return false;
  if (hasAbsentCandidates) {
    const audit = artifacts.get(`redsea-${channelQrId}-candidate-scope`);
    if (!audit || audit.kind !== "COMMAND_OUTPUT" || audit.capturedAt !== apiArtifact.capturedAt ||
      audit.extractorLocator !== "redsea-candidate-scope-v1|configured-candidates-minus-returned-identities" ||
      !isDeepStrictEqual(strictUniqueJsonRecord(audit.body), { ...candidateScope, channelId: channelQrId,
        listArtifactLogicalKey: listArtifact.logicalKey,
        listBodySha256: createHash("sha256").update(listArtifact.body).digest("hex"),
        responseArtifactLogicalKey: apiArtifact.logicalKey,
        responseBodySha256: createHash("sha256").update(apiArtifact.body).digest("hex") })) return false;
  }
  const sortName = config.sortName ?? "zri.ext_rankNum";
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
  if (!strictRequestContractMatches(apiArtifact.extractorLocator, {
    family: "redsea",
    role: "single-unpaginated-response",
    method: "POST",
    url: apiUrl,
    body: requestForm,
    coordinate: { sequence: 0, channelQrId, paginationPolicy: config.paginationPolicy }
  })) return false;
  const declaration = evidence.declaredCompleteness;
  return declaration?.kind === "COMPLETE_PAGE_TRAVERSAL" && declaration.value === 1 &&
    declaration.scope === "CHANNEL" && declaration.channelId === channelQrId &&
    declaration.artifactLogicalKey === apiArtifact.logicalKey &&
    declaration.extractorLocator === apiArtifact.extractorLocator;
}

function strictRedseaHasUnsafePaginationSignal(root: Record<string, unknown>, rowCount: number): boolean {
  const falseLike = (value: unknown) => value === undefined || value === null || value === false ||
    value === "" || (typeof value === "string" && /^(?:false|0|null)$/iu.test(value.trim()));
  for (const key of ["hasNext", "hasMore", "more", "next", "nextPage", "next_page", "nextCursor", "next_cursor"] as const) {
    if (Object.prototype.hasOwnProperty.call(root, key) && !falseLike(root[key])) return true;
  }
  if (Object.prototype.hasOwnProperty.call(root, "page") && strictRecord(root.page)) return true;
  const safeInteger = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value.trim())) return Number(value.trim());
    return undefined;
  };
  if (Object.prototype.hasOwnProperty.call(root, "total") && root.total !== "" && root.total !== null &&
    root.total !== undefined && safeInteger(root.total) !== rowCount) return true;
  for (const key of ["totalPages", "totalPage", "pageCount"] as const) {
    if (Object.prototype.hasOwnProperty.call(root, key) && !falseLike(root[key]) && safeInteger(root[key]) !== 1) return true;
  }
  for (const key of ["currentPage", "pageNo", "pageNum", "pageIndex"] as const) {
    if (Object.prototype.hasOwnProperty.call(root, key) && !falseLike(root[key])) {
      const value = safeInteger(root[key]);
      if (value !== 0 && value !== 1) return true;
    }
  }
  for (const key of ["offset", "start"] as const) {
    if (Object.prototype.hasOwnProperty.call(root, key) && !falseLike(root[key]) && safeInteger(root[key]) !== 0) return true;
  }
  for (const key of ["pageSize", "limit"] as const) {
    if (Object.prototype.hasOwnProperty.call(root, key) && !falseLike(root[key])) {
      const value = safeInteger(root[key]);
      if (value === undefined || value < rowCount) return true;
    }
  }
  return false;
}

function strictWorkdayRequestContracts(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  const config = plan.workday!;
  const pageSize = !config.pageSize || !Number.isFinite(config.pageSize)
    ? 20 : Math.min(20, Math.max(1, Math.floor(config.pageSize)));
  const jobsUrl = new URL(`/wday/cxs/${config.tenant}/${config.site}/jobs`, plan.source.officialEntryUrl).toString();
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  if (artifacts.size !== evidence.artifacts.length) return strictGateTrace(plan, "WORKDAY_DUPLICATE_ARTIFACT");
  const hasStaticLocationFacet = Object.keys(config.appliedFacets ?? {}).some(
    (facetParameter) => /location|country|countries/iu.test(facetParameter)
  );
  let appliedFacets: Record<string, readonly string[]> = { ...(config.appliedFacets ?? {}) };
  let selectedMainlandLocations: readonly StrictWorkdaySelectedLocation[] = [];
  const pfizerLocationRefinement = config.locationFacetPolicy?.kind ===
    "PFIZER_AUDITED_COUNTRY_LOCATION_REFINEMENT";
  const needsLocationPreflight = pfizerLocationRefinement ||
    (Boolean(config.searchText) && !hasStaticLocationFacet);
  const locationArtifact = artifacts.get("workday-preflight-0000");
  if (needsLocationPreflight !== Boolean(locationArtifact) ||
    (config.locationFacetPolicy !== undefined && !needsLocationPreflight) ||
    (needsLocationPreflight && config.searchText !== "China" && !pfizerLocationRefinement)) {
    return strictGateTrace(plan, "WORKDAY_LOCATION_PREFLIGHT_SHAPE");
  }
  let locationExpectedTotal: number | undefined;
  if (locationArtifact) {
    if (locationArtifact.bodyRepresentation === "REDACTED" ||
      !strictRequestContractMatches(locationArtifact.extractorLocator, {
        family: "workday", role: "location-preflight", method: "POST", url: jobsUrl,
        body: { appliedFacets, limit: pageSize, offset: 0 },
        coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
      })) return strictGateTrace(plan, "WORKDAY_LOCATION_PREFLIGHT_REQUEST");
    const location = strictWorkdayLocationFacetDerivation(locationArtifact.body, plan);
    if (!location) return strictGateTrace(plan, "WORKDAY_LOCATION_DERIVATION");
    appliedFacets = { ...appliedFacets, ...location.appliedFacets };
    locationExpectedTotal = location.expectedFilteredTotal;
    selectedMainlandLocations = location.selectedMainlandLocations ?? [];
  }
  const facetArtifact = artifacts.get("workday-facet-preflight-0000");
  const hasDescriptorPolicy = Boolean(config.facetDescriptorBoundary) || (config.facetDescriptorExclusions?.length ?? 0) > 0;
  if (hasDescriptorPolicy !== Boolean(facetArtifact)) return strictGateTrace(plan, "WORKDAY_FACET_PREFLIGHT_SHAPE");
  if (facetArtifact) {
    const preflightBody = { appliedFacets, limit: pageSize, offset: 0 };
    if (facetArtifact.bodyRepresentation === "REDACTED" ||
      !strictRequestContractMatches(facetArtifact.extractorLocator, {
      family: "workday", role: "facet-preflight", method: "POST", url: jobsUrl, body: preflightBody,
      coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
    })) return strictGateTrace(plan, "WORKDAY_FACET_PREFLIGHT_REQUEST");
    const facetRoot = strictUniqueJsonRecord(facetArtifact.body);
    if (!facetRoot || (locationExpectedTotal !== undefined && facetRoot.total !== locationExpectedTotal)) {
      return strictGateTrace(plan, "WORKDAY_FACET_PREFLIGHT_TOTAL");
    }
    const derived = strictWorkdayFacetDerivation(facetArtifact.body, config);
    if (!derived) return strictGateTrace(plan, "WORKDAY_FACET_DERIVATION");
    appliedFacets = { ...appliedFacets, ...derived };
  }
  const pageKeys = new Set(evidence.pages.map((page) => page.artifactLogicalKey));
  for (const artifact of evidence.artifacts) {
    if ((artifact.requestedUrl === jobsUrl || artifact.finalUrl === jobsUrl) &&
      !pageKeys.has(artifact.logicalKey) &&
      artifact.logicalKey !== "workday-preflight-0000" &&
      artifact.logicalKey !== "workday-facet-preflight-0000") return strictGateTrace(plan, "WORKDAY_UNEXPECTED_JOBS_ARTIFACT");
  }
  for (const page of evidence.pages) {
    const expected = { sequence: page.sequence, requestedCursor: null,
      requestedOffset: page.sequence * pageSize, requestedPage: page.sequence, requestedPageSize: pageSize };
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || !strictPageCoordinatesEqual(page, expected)) {
      return strictGateTrace(plan, "WORKDAY_PAGE_COORDINATE");
    }
    const artifact = artifacts.get(page.artifactLogicalKey);
    const body = {
      appliedFacets,
      ...(config.searchText && !needsLocationPreflight && !hasDescriptorPolicy ? { searchText: config.searchText } : {}),
      limit: pageSize,
      offset: page.sequence * pageSize
    };
    if (!artifact || artifact.bodyRepresentation === "REDACTED" ||
      !strictRequestContractMatches(artifact.extractorLocator, {
      family: "workday", role: "page", method: "POST", url: jobsUrl, body,
      coordinate: { sequence: page.sequence, requestedOffset: page.sequence * pageSize,
        requestedPage: page.sequence, requestedPageSize: pageSize }
    })) return strictGateTrace(plan, `WORKDAY_PAGE_REQUEST:${page.sequence}`);
    const pageRoot = strictUniqueJsonRecord(artifact.body);
    if (!pageRoot || !strictNonnegativeInteger(pageRoot.total) || !Array.isArray(pageRoot.jobPostings) ||
      page.declaredTotal !== pageRoot.total ||
      page.rawJobIds.length !== pageRoot.jobPostings.length ||
      createHash("sha256").update(typeof artifact.body === "string"
        ? Buffer.from(artifact.body, "utf8") : Buffer.from(artifact.body)).digest("hex") !==
        page.responseFingerprintSha256) return strictGateTrace(plan, `WORKDAY_PAGE_BODY:${page.sequence}`);
  }
  const jnjReplay = strictJnjOpaqueDetailReplay(
    plan,
    evidence,
    artifacts,
    outputJobs,
    selectedMainlandLocations
  );
  if (!jnjReplay) return strictGateTrace(plan, "WORKDAY_JNJ_DETAIL_REPLAY");
  if (!strictPfizerOpaqueDetailReplay(plan, evidence, artifacts, outputJobs)) {
    return strictGateTrace(plan, "WORKDAY_PFIZER_DETAIL_REPLAY");
  }
  if (!replayBiogenListGeography(plan, evidence, outputJobs)) return strictGateTrace(plan, "BIOGEN_LIST_GEOGRAPHY_UNRESOLVED");
  return true;
}

function strictJnjOpaqueDetailReplay(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence,
  artifacts: ReadonlyMap<string, PersistentSourceFetchEvidence["artifacts"][number]>,
  outputJobs: readonly NormalizedJobRecord[],
  selectedMainlandLocations: readonly StrictWorkdaySelectedLocation[]
): boolean {
  const config = plan.workday!;
  if (config.opaqueMultiLocationDetailPolicy !== "JNJ_AUDITED_CHINA_DETAIL_V1") return true;
  if (!strictJnjWorkdayPlanBinding(plan) || selectedMainlandLocations.length === 0) return false;

  const origin = new URL(plan.source.officialEntryUrl).origin;
  const sitePath = new URL(plan.source.officialEntryUrl).pathname.replace(/\/+$/u, "");
  const selectedDescriptors = new Set(selectedMainlandLocations.map(({ descriptor }) => descriptor));
  const expectedDetailKeys = new Set<string>();
  const expectedOutputById = new Map<string, {
    title: string;
    officialUrl: string;
    locationRaw: string;
    cities: string[];
  }>();

  for (const page of evidence.pages) {
    const pageArtifact = artifacts.get(page.artifactLogicalKey);
    const pageRoot = pageArtifact ? strictUniqueJsonRecord(pageArtifact.body) : undefined;
    if (!pageRoot || !Array.isArray(pageRoot.jobPostings)) return false;
    for (const [recordIndex, candidate] of pageRoot.jobPostings.entries()) {
      const raw = strictRecord(candidate);
      if (!raw) return false;
      const title = strictGateString(raw.title);
      const normalizedTitle = strictAdapterNormalizedString(title);
      const externalPath = strictGateString(raw.externalPath);
      const locationsText = strictGateString(raw.locationsText);
      if (!title || !normalizedTitle || !externalPath || !locationsText || !externalPath.startsWith("/job/")) return false;
      let listingUrl: URL;
      try { listingUrl = new URL(externalPath, `${origin}${sitePath}`); }
      catch { return false; }
      if (listingUrl.origin !== origin ||
        `${listingUrl.pathname}${listingUrl.search}${listingUrl.hash}` !== externalPath) return false;
      const sourceJobId = `workday:sha256:${createHash("sha256").update(Buffer.from(externalPath, "utf8")).digest("hex")}`;
      if (expectedOutputById.has(sourceJobId)) return false;

      let locationRaw = strictAdapterNormalizedString(locationsText)!;
      let cities = strictJnjWorkdayCities(locationsText, `${externalPath} ${title}`, true);
      if (!strictWorkdayRecordHasMainlandEvidence(`${locationsText} ${externalPath}`)) {
        const opaqueMatch = /^([2-9][0-9]*) Locations$/u.exec(locationsText);
        const reqId = Array.isArray(raw.bulletFields) && raw.bulletFields.length === 1
          ? strictGateString(raw.bulletFields[0])
          : undefined;
        if (!opaqueMatch || !reqId) return false;
        const expectedLocationCount = Number(opaqueMatch[1]);
        const detailKey = `workday-detail-${String(page.sequence).padStart(4, "0")}-${String(recordIndex).padStart(4, "0")}`;
        const detailArtifact = artifacts.get(detailKey);
        const detailUrl = `${origin}/wday/cxs/${config.tenant}/${config.site}${externalPath}`;
        if (!Number.isSafeInteger(expectedLocationCount) || !detailArtifact ||
          detailArtifact.kind !== "ATS_API_RESPONSE" || detailArtifact.bodyRepresentation === "REDACTED" ||
          detailArtifact.requestedUrl !== detailUrl || detailArtifact.finalUrl !== detailUrl ||
          detailArtifact.httpStatus !== 200 || typeof detailArtifact.contentType !== "string" ||
          !/^application\/json(?:\s*;|$)/iu.test(detailArtifact.contentType) ||
          detailArtifact.extractorLocator !== "$.jobPostingInfo") return false;
        const detailRoot = strictUniqueJsonRecord(detailArtifact.body);
        const info = strictRecord(detailRoot?.jobPostingInfo);
        const postingId = externalPath.split("/").at(-1);
        if (!info || !postingId || strictGateString(info.title) !== title ||
          strictGateString(info.jobPostingSiteId) !== config.site ||
          strictGateString(info.jobPostingId) !== postingId ||
          strictGateString(info.jobReqId) !== reqId ||
          strictGateString(info.externalUrl) !== `${origin}${sitePath}${externalPath}` ||
          info.posted !== true || info.canApply !== true) return false;
        const location = strictGateString(info.location);
        if (!location || !Array.isArray(info.additionalLocations)) return false;
        const additionalLocations = info.additionalLocations.map(strictGateString);
        if (additionalLocations.some((value) => value === undefined)) return false;
        const publicLocations = [location, ...(additionalLocations as string[])];
        const mainlandLocations = publicLocations.filter((descriptor) => selectedDescriptors.has(descriptor));
        if (publicLocations.length !== expectedLocationCount ||
          new Set(publicLocations).size !== publicLocations.length ||
          mainlandLocations.length === 0) return false;
        locationRaw = strictAdapterNormalizedString(publicLocations.join(" | "))!;
        cities = strictJnjWorkdayCities(mainlandLocations.join(" | "));
        expectedDetailKeys.add(detailKey);
      }
      expectedOutputById.set(sourceJobId, {
        title: normalizedTitle,
        officialUrl: `${origin}${sitePath}${externalPath}`,
        locationRaw,
        cities
      });
    }
  }

  const actualDetailKeys = evidence.artifacts
    .filter((artifact) => artifact.logicalKey.startsWith("workday-detail-"))
    .map((artifact) => artifact.logicalKey);
  if (actualDetailKeys.length !== expectedDetailKeys.size ||
    actualDetailKeys.some((key) => !expectedDetailKeys.has(key)) ||
    outputJobs.length !== expectedOutputById.size) return false;
  for (const output of outputJobs) {
    if (typeof output.sourceJobId !== "string") return false;
    const expected = expectedOutputById.get(output.sourceJobId);
    if (!expected || output.sourceId !== plan.source.id || output.companyId !== plan.company.id ||
      output.officialTitle !== expected.title || output.officialUrl !== expected.officialUrl ||
      output.locationRaw !== expected.locationRaw ||
      !strictExactStringArray(output.cities, expected.cities)) return false;
  }
  return true;
}

function strictPfizerOpaqueDetailReplay(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence,
  artifacts: ReadonlyMap<string, PersistentSourceFetchEvidence["artifacts"][number]>,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  const config = plan.workday!;
  if (config.opaqueMultiLocationDetailPolicy !== "PFIZER_AUDITED_APAC_DETAIL_V1") return true;
  if (
    plan.source.id !== "source-pfizer-china-social" ||
    config.tenant !== "pfizer" || config.site !== "PfizerCareers" ||
    config.searchText !== undefined ||
    config.locationFacetPolicy?.kind !== "PFIZER_AUDITED_COUNTRY_LOCATION_REFINEMENT" ||
    config.locationFacetPolicy.facetParameter !== "locations" ||
    !strictExactStringArray(
      config.locationFacetPolicy.foreignDescriptorAliases,
      PFIZER_AUDITED_FOREIGN_LOCATION_DESCRIPTOR_ALIASES
    ) ||
    (config.facetDescriptorExclusions?.length ?? 0) !== 0 ||
    config.laterZeroTotalPolicy !== "PFIZER_AUDITED_EXACT_RECONCILIATION" ||
    JSON.stringify(config.appliedFacets) !== JSON.stringify({
      Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"]
    })
  ) return false;

  const origin = new URL(plan.source.officialEntryUrl).origin;
  const sitePath = new URL(plan.source.officialEntryUrl).pathname.replace(/\/+$/u, "");
  const expectedDetailKeys = new Set<string>();
  const expectedOutputById = new Map<string, {
    title: string;
    officialUrl: string;
    locationRaw: string;
  }>();
  for (const page of evidence.pages) {
    const pageArtifact = artifacts.get(page.artifactLogicalKey);
    if (!pageArtifact) return false;
    const pageRoot = strictUniqueJsonRecord(pageArtifact.body);
    if (!pageRoot || !Array.isArray(pageRoot.jobPostings)) return false;
    for (const [recordIndex, candidate] of pageRoot.jobPostings.entries()) {
      const raw = strictRecord(candidate);
      if (!raw) return false;
      const locationsText = strictGateString(raw.locationsText);
      const opaqueMatch = locationsText ? /^([2-9][0-9]*) Locations$/u.exec(locationsText) : null;
      if (!opaqueMatch) continue;
      const externalPath = strictGateString(raw.externalPath);
      if (!externalPath || strictWorkdayRecordHasMainlandEvidence(`${locationsText} ${externalPath}`)) continue;
      const expectedLocationCount = Number(opaqueMatch[1]);
      if (!Number.isSafeInteger(expectedLocationCount)) return false;
      const title = strictGateString(raw.title);
      const normalizedTitle = strictAdapterNormalizedString(title);
      const reqId = Array.isArray(raw.bulletFields) && raw.bulletFields.length === 1
        ? strictGateString(raw.bulletFields[0])
        : undefined;
      let listingUrl: URL;
      try { listingUrl = new URL(externalPath, `${origin}${sitePath}`); }
      catch { return false; }
      if (!title || !normalizedTitle || !reqId || !externalPath.startsWith("/job/") || listingUrl.origin !== origin ||
        `${listingUrl.pathname}${listingUrl.search}${listingUrl.hash}` !== externalPath) return false;

      const detailKey = `workday-detail-${String(page.sequence).padStart(4, "0")}-${String(recordIndex).padStart(4, "0")}`;
      expectedDetailKeys.add(detailKey);
      const detailArtifact = artifacts.get(detailKey);
      const detailUrl = `${origin}/wday/cxs/${config.tenant}/${config.site}${externalPath}`;
      if (!detailArtifact || detailArtifact.kind !== "ATS_API_RESPONSE" ||
        detailArtifact.bodyRepresentation === "REDACTED" || detailArtifact.requestedUrl !== detailUrl ||
        detailArtifact.finalUrl !== detailUrl || detailArtifact.httpStatus !== 200 ||
        typeof detailArtifact.contentType !== "string" ||
        !/^application\/json(?:\s*;|$)/iu.test(detailArtifact.contentType) ||
        detailArtifact.extractorLocator !== "$.jobPostingInfo") return false;
      const detailRoot = strictUniqueJsonRecord(detailArtifact.body);
      const info = strictRecord(detailRoot?.jobPostingInfo);
      const postingId = externalPath.split("/").at(-1);
      if (!info || !postingId || strictGateString(info.title) !== title ||
        strictGateString(info.jobPostingSiteId) !== config.site ||
        strictGateString(info.jobPostingId) !== postingId ||
        strictGateString(info.jobReqId) !== reqId ||
        strictGateString(info.externalUrl) !== `${origin}${sitePath}${externalPath}` ||
        info.posted !== true || info.canApply !== true) return false;
      const location = strictGateString(info.location);
      if (!location || !Array.isArray(info.additionalLocations)) return false;
      const additionalLocations = info.additionalLocations.map(strictGateString);
      if (additionalLocations.some((value) => value === undefined)) return false;
      const publicLocations = [location, ...(additionalLocations as string[])];
      if (publicLocations.length !== expectedLocationCount ||
        new Set(publicLocations).size !== publicLocations.length ||
        publicLocations.some((descriptor) => /\bAPAC\b/iu.test(descriptor) &&
          descriptor !== "APAC - Any Pfizer Site")) return false;
      const hasMainland = publicLocations.some(isPfizerWorkdayMainlandChinaLocationDescriptor);
      if (!hasMainland) return false;
      const sourceJobId = `workday:sha256:${createHash("sha256").update(Buffer.from(externalPath, "utf8")).digest("hex")}`;
      if (expectedOutputById.has(sourceJobId)) return false;
      expectedOutputById.set(sourceJobId, {
        title: normalizedTitle,
        officialUrl: `${origin}${sitePath}${externalPath}`,
        locationRaw: strictAdapterNormalizedString(publicLocations.join(" | "))!
      });
    }
  }
  const actualDetailKeys = evidence.artifacts
    .filter((artifact) => artifact.logicalKey.startsWith("workday-detail-"))
    .map((artifact) => artifact.logicalKey);
  if (actualDetailKeys.length !== expectedDetailKeys.size ||
    actualDetailKeys.some((key) => !expectedDetailKeys.has(key))) return false;
  for (const [sourceJobId, expected] of expectedOutputById) {
    const matches = outputJobs.filter((job) => job.sourceJobId === sourceJobId);
    if (matches.length !== 1) return false;
    const output = matches[0]!;
    if (output.sourceId !== plan.source.id || output.companyId !== plan.company.id ||
      output.officialTitle !== expected.title || output.officialUrl !== expected.officialUrl ||
      output.locationRaw !== expected.locationRaw) return false;
  }
  return true;
}

function strictWorkdayRecordHasMainlandEvidence(scopeText: string): boolean {
  const normalized = scopeText.toLowerCase();
  return /(?:^|[^a-z])(?:china|chn|cn)(?:[^a-z]|$)/u.test(normalized) ||
    scopeText.includes("中国") ||
    ["Beijing", "Shanghai", "Guangzhou", "Shenzhen", "Chengdu", "Hangzhou", "Nanjing", "Suzhou",
      "Wuhan", "Tianjin", "Xi'an", "Xian", "Changsha", "Kunming", "Qingdao", "Jinan", "Dalian",
      "Xiamen", "Fuzhou", "Hefei", "Ningbo", "Zhengzhou", "Shenyang", "Hohhot", "Huhehaote"]
      .some((descriptor) => normalized.includes(descriptor.toLowerCase()));
}

function strictWorkdayFacetDerivation(
  body: string | Uint8Array,
  config: NonNullable<Extract<SourceCrawlPlan, { adapterId: "official-json" }>["workday"]>
): Record<string, readonly string[]> | undefined {
  let root: unknown;
  try { root = JSON.parse(typeof body === "string" ? body : Buffer.from(body).toString("utf8")); } catch { return undefined; }
  if (!root || typeof root !== "object" || Array.isArray(root)) return undefined;
  const boundary = config.facetDescriptorBoundary;
  const exclusions = config.facetDescriptorExclusions ?? [];
  if (Boolean(boundary) === (exclusions.length > 0) || exclusions.length > 1) return undefined;
  const parameter = boundary?.facetParameter ?? exclusions[0]?.facetParameter;
  if (!parameter || (config.appliedFacets ?? {})[parameter] !== undefined) return undefined;
  const groups = strictFindWorkdayFacetGroups((root as Record<string, unknown>).facets, parameter);
  if (groups.length !== 1 || !Array.isArray(groups[0]!.values)) return undefined;
  const parsed = groups[0]!.values.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
    const value = candidate as Record<string, unknown>;
    return typeof value.descriptor === "string" && value.descriptor.trim() === value.descriptor &&
      typeof value.id === "string" && value.id.trim() === value.id &&
      typeof value.count === "number" && Number.isSafeInteger(value.count) && value.count >= 0
      ? { descriptor: value.descriptor, id: value.id, count: value.count }
      : undefined;
  });
  if (parsed.some((value) => value === undefined)) return undefined;
  const values = parsed as Array<{ descriptor: string; id: string; count: number }>;
  if (new Set(values.map((value) => value.descriptor)).size !== values.length ||
    new Set(values.map((value) => value.id)).size !== values.length) return undefined;
  const total = (root as Record<string, unknown>).total;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 ||
    values.reduce((sum, value) => sum + value.count, 0) !== total) return undefined;
  if (boundary) {
    const allowed = boundary.allowedDescriptors;
    const excluded = boundary.excludedDescriptors ?? [];
    const declared = new Set([...allowed, ...excluded]);
    if (declared.size !== allowed.length + excluded.length || values.some((value) => !declared.has(value.descriptor)) ||
      [...declared].some((descriptor) => !values.some((value) => value.descriptor === descriptor))) return undefined;
    const allowedSet = new Set(allowed);
    return { [parameter]: values.filter((value) => allowedSet.has(value.descriptor)).map((value) => value.id) };
  }
  const excluded = new Set(exclusions[0]!.excludedDescriptors);
  if ([...excluded].some((descriptor) => !values.some((value) => value.descriptor === descriptor))) return undefined;
  const ids = values.filter((value) => !excluded.has(value.descriptor)).map((value) => value.id);
  return ids.length > 0 ? { [parameter]: ids } : undefined;
}

type StrictWorkdayLocationDerivation = {
  appliedFacets: Record<string, readonly string[]>;
  expectedFilteredTotal?: number;
  selectedMainlandLocations?: readonly StrictWorkdaySelectedLocation[];
};

type StrictWorkdaySelectedLocation = {
  id: string;
  descriptor: string;
};

type StrictWorkdayFacetGroup = {
  facetParameter: string;
  descriptor?: string;
  values: unknown[];
};

type StrictWorkdayFlatFacetValue = {
  descriptor: string;
  id: string;
  count: number;
};

function strictWorkdayLocationFacetDerivation(
  body: string | Uint8Array,
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): StrictWorkdayLocationDerivation | undefined {
  const config = plan.workday!;
  const root = strictUniqueJsonRecord(body);
  if (!root || !strictNonnegativeInteger(root.total) || !Array.isArray(root.facets)) return undefined;
  const groups = strictCollectWorkdayFacetGroups(root.facets).filter((group) =>
    /location|country|countries/iu.test(group.facetParameter) ||
    /location|country|countries|state|province/iu.test(group.descriptor ?? "")
  );
  if (config.locationFacetPolicy?.kind === "JNJ_AUDITED_LOCATIONS_OVERLAP") {
    return strictJnjWorkdayLocationFacetDerivation(root, groups, plan);
  }
  if (config.locationFacetPolicy?.kind === "PFIZER_AUDITED_COUNTRY_LOCATION_REFINEMENT") {
    return strictPfizerWorkdayLocationFacetDerivation(root, groups, plan);
  }
  const countryGroups = groups.filter((group) =>
    (/country|countries/iu.test(group.facetParameter) ||
      /country|countries/iu.test(group.descriptor ?? "")) &&
    group.values.some((value) => {
      const record = strictRecord(value);
      return typeof record?.descriptor === "string" &&
        strictWorkdayExactMainlandCountry(record.descriptor);
    })
  );
  if (countryGroups.length > 1) return undefined;
  if (countryGroups.length === 1) {
    const group = countryGroups[0]!;
    if (config.locationFacetPolicy?.kind === "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST") {
      return strictBmsWorkdayCountryFacetDerivation(root, group, plan);
    }
    if (config.locationFacetPolicy !== undefined) return undefined;
    const values = strictWorkdayFlatFacetValues(group.values, []);
    // Workday country facets count a multi-country posting once in every country,
    // so their aggregate may exceed the root's unique-job total. The selected
    // country's own count is still authoritative and is independently checked
    // against the filtered preflight response below.
    if (!values || values.reduce((sum, value) => sum + value.count, 0) < root.total) return undefined;
    const selected = values.filter((value) => strictWorkdayExactMainlandCountry(value.descriptor));
    if (selected.length !== 1) return undefined;
    return {
      appliedFacets: { [group.facetParameter]: selected.map((value) => value.id) },
      expectedFilteredTotal: selected[0]!.count
    };
  }

  const policy = config.locationFacetPolicy;
  if (policy?.kind !== "GILEAD_AUDITED_LOCATIONS_OVERLAP") return undefined;
  const candidateGroups = groups.filter((group) =>
    group.facetParameter === policy.facetParameter &&
    group.values.some((value) => {
      const record = strictRecord(value);
      return typeof record?.descriptor === "string" &&
        strictWorkdayMainlandLocation(record.descriptor);
    })
  );
  if (candidateGroups.length !== 1) return undefined;
  const allowedDuplicates: string[] = [];
  if (!strictUniqueNonblankStrings(allowedDuplicates)) return undefined;
  const values = strictWorkdayFlatFacetValues(candidateGroups[0]!.values, allowedDuplicates);
  if (!values) return undefined;
  const selected = values.filter((value) => strictWorkdayMainlandLocation(value.descriptor));
  if (selected.length === 0 || selected.some((value) => strictWorkdayNonMainland(value.descriptor))) return undefined;
  const foreignAliases = policy.foreignDescriptorAliases;
  if (!strictUniqueNonblankStrings(foreignAliases) ||
    values.filter((value) => !selected.includes(value)).some((value) =>
      !strictWorkdayForeignLocation(value.descriptor, foreignAliases))) return undefined;
  const total = values.reduce((sum, value) => sum + value.count, 0);
  if (total < root.total) return undefined;
  return {
    appliedFacets: { [candidateGroups[0]!.facetParameter]: selected.map((value) => value.id) },
    ...(total === root.total
      ? { expectedFilteredTotal: selected.reduce((sum, value) => sum + value.count, 0) }
      : {})
  };
}

function strictPfizerWorkdayLocationFacetDerivation(
  root: Record<string, unknown>,
  groups: readonly StrictWorkdayFacetGroup[],
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): StrictWorkdayLocationDerivation | undefined {
  const config = plan.workday;
  const policy = config?.locationFacetPolicy;
  if (!config || plan.company.id !== "company-pfizer-china" ||
    plan.source.id !== "source-pfizer-china-social" || plan.source.companyId !== "company-pfizer-china" ||
    plan.source.atsKind !== "WORKDAY" ||
    plan.source.officialEntryUrl !== "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers" ||
    config.tenant !== "pfizer" || config.site !== "PfizerCareers" || config.searchText !== undefined ||
    config.laterZeroTotalPolicy !== "PFIZER_AUDITED_EXACT_RECONCILIATION" ||
    JSON.stringify(config.appliedFacets) !== JSON.stringify({
      Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"]
    }) ||
    policy?.kind !== "PFIZER_AUDITED_COUNTRY_LOCATION_REFINEMENT" ||
    policy.facetParameter !== "locations" ||
    !strictExactStringArray(
      policy.foreignDescriptorAliases,
      PFIZER_AUDITED_FOREIGN_LOCATION_DESCRIPTOR_ALIASES
    )) return undefined;
  const candidates = groups.filter((group) => group.facetParameter === policy.facetParameter);
  if (candidates.length !== 1) return undefined;
  const values = strictWorkdayFlatFacetValues(candidates[0]!.values, []);
  if (!values) return undefined;
  const selected = values.filter((value) => strictWorkdayMainlandLocation(value.descriptor));
  if (selected.length === 0 || selected.some((value) => strictWorkdayNonMainland(value.descriptor)) ||
    values.filter((value) => !selected.includes(value)).some((value) =>
      !strictWorkdayForeignLocation(value.descriptor, policy.foreignDescriptorAliases))) return undefined;
  return {
    appliedFacets: { [policy.facetParameter]: selected.map(({ id }) => id) },
    selectedMainlandLocations: selected.map(({ id, descriptor }) => ({ id, descriptor }))
  };
}

function strictJnjWorkdayLocationFacetDerivation(
  root: Record<string, unknown>,
  groups: readonly StrictWorkdayFacetGroup[],
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): StrictWorkdayLocationDerivation | undefined {
  if (!strictJnjWorkdayPlanBinding(plan)) return undefined;
  const policy = plan.workday!.locationFacetPolicy;
  if (policy?.kind !== "JNJ_AUDITED_LOCATIONS_OVERLAP") return undefined;
  const candidates = groups.filter((group) =>
    group.facetParameter === policy.facetParameter && group.descriptor === "Locations"
  );
  if (candidates.length !== 1) return undefined;
  const values = strictWorkdayFlatFacetValues(candidates[0]!.values, []);
  if (!values || values.reduce((sum, value) => sum + value.count, 0) < (root.total as number)) {
    return undefined;
  }
  const auditedMainland = new Set(policy.mainlandDescriptorAliases);
  const selected = values.filter((value) =>
    auditedMainland.has(value.descriptor) || strictWorkdayMainlandLocation(value.descriptor)
  );
  if (selected.length === 0 || selected.some((value) => strictWorkdayNonMainland(value.descriptor)) ||
    values.filter((value) => !selected.includes(value)).some((value) =>
      !strictWorkdayForeignLocation(value.descriptor, policy.foreignDescriptorAliases))) return undefined;
  return {
    appliedFacets: { [policy.facetParameter]: selected.map(({ id }) => id) },
    selectedMainlandLocations: selected.map(({ id, descriptor }) => ({ id, descriptor }))
  };
}

function strictJnjWorkdayPlanBinding(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): boolean {
  const config = plan.workday;
  const policy = config?.locationFacetPolicy;
  return config?.searchText === "China" && config.cityHints === undefined &&
    Object.keys(config.appliedFacets ?? {}).length === 0 &&
    (config.facetDescriptorExclusions?.length ?? 0) === 0 &&
    config.laterZeroTotalPolicy === undefined &&
    config.opaqueMultiLocationDetailPolicy === "JNJ_AUDITED_CHINA_DETAIL_V1" &&
    policy?.kind === "JNJ_AUDITED_LOCATIONS_OVERLAP" && policy.facetParameter === "locations" &&
    strictNonEmptyUniqueStringArray(policy.mainlandDescriptorAliases) &&
    strictNonEmptyUniqueStringArray(policy.foreignDescriptorAliases) &&
    policy.mainlandDescriptorAliases.every((descriptor) =>
      !policy.foreignDescriptorAliases.includes(descriptor));
}

function strictNonEmptyUniqueStringArray(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim() === value && value.length > 0) &&
    new Set(values).size === values.length;
}

const STRICT_JNJ_WORKDAY_CITY_MATCHES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"], ["Beijing", "北京"], ["Suzhou", "苏州"], ["Guangzhou", "广州"],
  ["Dongguan", "东莞"], ["Huizhou", "惠州"], ["Shenzhen", "深圳"], ["Hangzhou", "杭州"],
  ["Nanjing", "南京"], ["Changsha", "长沙"], ["Weifang", "潍坊"], ["Wuhan", "武汉"],
  ["Chengdu", "成都"], ["Tianjin", "天津"], ["Zhengzhou", "郑州"], ["Shenyang", "沈阳"],
  ["Huhehaote", "呼和浩特"], ["Hohhot", "呼和浩特"], ["Guangdong", "广东"],
  ["Zhejiang", "浙江"], ["Jiangsu", "江苏"], ["Hunan", "湖南"], ["Henan", "河南"],
  ["Shandong", "山东"]
];
const STRICT_JNJ_WORKDAY_REGION_FALLBACKS = new Set(["广东", "浙江", "江苏", "湖南", "河南", "山东"]);

function strictJnjWorkdayCities(
  locationRaw: string,
  fallbackText = "",
  defaultToChina = false
): string[] {
  const searchable = `${locationRaw} ${fallbackText}`.toLocaleLowerCase("en-US");
  const mapped = STRICT_JNJ_WORKDAY_CITY_MATCHES.flatMap(([needle, city]) =>
    searchable.includes(needle.toLocaleLowerCase("en-US")) ? [city] : []
  );
  const hasSpecificCity = mapped.some((city) => !STRICT_JNJ_WORKDAY_REGION_FALLBACKS.has(city));
  const scoped = hasSpecificCity
    ? mapped.filter((city) => !STRICT_JNJ_WORKDAY_REGION_FALLBACKS.has(city))
    : mapped;
  const cities = [...new Set(scoped)];
  if (cities.length > 0) return cities;
  return defaultToChina || /(?:^|[^a-z])(?:china|chn)(?:[^a-z]|$)/u.test(searchable)
    ? ["中国"]
    : [];
}

function strictBmsWorkdayCountryFacetDerivation(
  root: Record<string, unknown>,
  group: StrictWorkdayFacetGroup,
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): StrictWorkdayLocationDerivation | undefined {
  const config = plan.workday;
  const policy = config?.locationFacetPolicy;
  const workerBoundary = config?.facetDescriptorBoundary;
  if (!config ||
    plan.company.id !== "company-bms-china" ||
    plan.company.officialChineseName !== "百时美施贵宝中国" ||
    plan.source.id !== "source-bms-china-social" ||
    plan.source.companyId !== "company-bms-china" ||
    plan.source.atsKind !== "WORKDAY" ||
    plan.source.officialEntryUrl !== "https://bristolmyerssquibb.wd5.myworkdayjobs.com/BMS" ||
    config.tenant !== "bristolmyerssquibb" ||
    config.site !== "BMS" ||
    config.searchText !== "China" ||
    Object.keys(config.appliedFacets ?? {}).length !== 0 ||
    config.laterZeroTotalPolicy !== "BMS_AUDITED_EXACT_RECONCILIATION" ||
    config.pageSize !== 20 ||
    config.maxPages !== 5 ||
    policy?.kind !== "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST" ||
    policy.facetParameter !== "locationHierarchy2" ||
    !strictExactStringArray(policy.foreignSiteDescriptorAliases, BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES) ||
    !strictExactStringArray(policy.foreignCountryDescriptorAliases, BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES) ||
    workerBoundary?.facetParameter !== "workerSubType" ||
    !strictExactStringArray(workerBoundary.allowedDescriptors, ["Fixed Term (Fixed Term)", "Permanent"]) ||
    workerBoundary.excludedDescriptors !== undefined ||
    group.facetParameter !== policy.facetParameter ||
    group.descriptor !== "Country" ||
    !strictNonnegativeInteger(root.total)) {
    strictGateTrace(plan, "BMS_LOCATION_PLAN_BINDING");
    return undefined;
  }

  const values = strictWorkdayFlatFacetValues(group.values, []);
  if (!values || values.reduce((sum, value) => sum + value.count, 0) < root.total) {
    strictGateTrace(plan, "BMS_LOCATION_VALUES");
    return undefined;
  }
  const selected = values.filter((value) => strictWorkdayExactMainlandCountry(value.descriptor));
  if (selected.length !== 1 || selected[0]!.descriptor !== "China" || selected[0]!.count > root.total) {
    strictGateTrace(plan, "BMS_LOCATION_CHINA_SELECTION");
    return undefined;
  }
  const allowedSites = new Set(policy.foreignSiteDescriptorAliases);
  const allowedCountries = new Set(policy.foreignCountryDescriptorAliases);
  const unexpectedForeign = values.find((value) => !selected.includes(value) &&
    !allowedSites.has(value.descriptor) &&
    !allowedCountries.has(value.descriptor) &&
    !strictWorkdayForeignLocation(value.descriptor, []));
  if (unexpectedForeign) {
    strictGateTrace(plan, "BMS_LOCATION_FOREIGN_BOUNDARY");
    return undefined;
  }
  return {
    appliedFacets: { [policy.facetParameter]: [selected[0]!.id] },
    expectedFilteredTotal: selected[0]!.count
  };
}

function strictExactStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function strictCollectWorkdayFacetGroups(value: unknown): StrictWorkdayFacetGroup[] {
  if (Array.isArray(value)) return value.flatMap(strictCollectWorkdayFacetGroups);
  const record = strictRecord(value);
  if (!record) return [];
  const facetParameter = typeof record.facetParameter === "string" &&
    record.facetParameter.trim() === record.facetParameter && record.facetParameter
    ? record.facetParameter
    : undefined;
  const descriptor = typeof record.descriptor === "string" &&
    record.descriptor.trim() === record.descriptor && record.descriptor
    ? record.descriptor
    : undefined;
  const values = Array.isArray(record.values) ? record.values : [];
  const embedded = values.filter((candidate) => {
    const child = strictRecord(candidate);
    return typeof child?.facetParameter === "string" && Array.isArray(child.values);
  });
  const ownValues = values.filter((candidate) => !embedded.includes(candidate));
  return [
    ...(facetParameter && ownValues.length > 0
      ? [{ facetParameter, ...(descriptor ? { descriptor } : {}), values: ownValues }]
      : []),
    ...embedded.flatMap(strictCollectWorkdayFacetGroups),
    ...(!facetParameter ? ownValues.flatMap(strictCollectWorkdayFacetGroups) : [])
  ];
}

function strictWorkdayFlatFacetValues(
  rawValues: readonly unknown[],
  allowedDuplicateDescriptors: readonly string[]
): StrictWorkdayFlatFacetValue[] | undefined {
  const values = rawValues.map((candidate) => {
    const record = strictRecord(candidate);
    if (!record || Array.isArray(record.values) && record.values.length > 0 ||
      typeof record.descriptor !== "string" || !record.descriptor ||
      record.descriptor.trim() !== record.descriptor ||
      typeof record.id !== "string" || !record.id || record.id.trim() !== record.id ||
      !strictNonnegativeInteger(record.count)) return undefined;
    return { descriptor: record.descriptor, id: record.id, count: record.count };
  });
  if (values.some((value) => value === undefined)) return undefined;
  const parsed = values as StrictWorkdayFlatFacetValue[];
  if (new Set(parsed.map((value) => value.id)).size !== parsed.length) return undefined;
  const allowed = new Set(allowedDuplicateDescriptors);
  for (const descriptor of new Set(parsed.map((value) => value.descriptor))) {
    const matches = parsed.filter((value) => value.descriptor === descriptor);
    if (matches.length > 1 && (!allowed.has(descriptor) ||
      !strictWorkdayForeignLocation(descriptor, []))) return undefined;
  }
  return parsed;
}

function strictUniqueNonblankStrings(values: readonly string[]): boolean {
  return values.every((value) => value.length > 0 && value.trim() === value) &&
    new Set(values).size === values.length;
}

const STRICT_WORKDAY_MAINLAND_NAMES = new Set([
  "china", "china mainland", "mainland china", "people's republic of china",
  "peoples republic of china", "prc", "chn", "cn", "中国", "中国大陆", "中华人民共和国"
]);
const STRICT_WORKDAY_NON_MAINLAND = /hong\s*kong|macau|macao|taiwan|香港|澳门|澳門|台湾|台灣/iu;
const STRICT_WORKDAY_ISO_ALPHA_2 = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ")
);
const STRICT_WORKDAY_ISO_ALPHA_3 = new Set(
  "ABW AFG AGO AIA ALA ALB AND ARE ARG ARM ASM ATA ATF ATG AUS AUT AZE BDI BEL BEN BES BFA BGD BGR BHR BHS BIH BLM BLR BLZ BMU BOL BRA BRB BRN BTN BVT BWA CAF CAN CCK CHE CHL CHN CIV CMR COD COG COK COL COM CPV CRI CUB CUW CXR CYM CYP CZE DEU DJI DMA DNK DOM DZA ECU EGY ERI ESH ESP EST ETH FIN FJI FLK FRA FRO FSM GAB GBR GEO GGY GHA GIB GIN GLP GMB GNB GNQ GRC GRD GRL GTM GUF GUM GUY HKG HMD HND HRV HTI HUN IDN IMN IND IOT IRL IRN IRQ ISL ISR ITA JAM JEY JOR JPN KAZ KEN KGZ KHM KIR KNA KOR KWT LAO LBN LBR LBY LCA LIE LKA LSO LTU LUX LVA MAC MAF MAR MCO MDA MDG MDV MEX MHL MKD MLI MLT MMR MNE MNG MNP MOZ MRT MSR MTQ MUS MWI MYS MYT NAM NCL NER NFK NGA NIC NIU NLD NOR NPL NRU NZL OMN PAK PAN PCN PER PHL PLW PNG POL PRI PRK PRT PRY PSE PYF QAT REU ROU RUS RWA SAU SDN SEN SGP SGS SHN SJM SLB SLE SLV SMR SOM SPM SRB SSD STP SUR SVK SVN SWE SWZ SXM SYC SYR TCA TCD TGO THA TJK TKL TKM TLS TON TTO TUN TUR TUV TWN TZA UGA UKR UMI URY USA UZB VAT VCT VEN VGB VIR VNM VUT WLF WSM YEM ZAF ZMB ZWE".split(" ")
);
const STRICT_WORKDAY_REGION_NAMES = strictWorkdayRegionNames();

function strictWorkdayRegionNames(): ReadonlySet<string> {
  const result = new Set<string>(["united states of america"]);
  for (const locale of ["en", "zh-CN"] as const) {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    for (const code of STRICT_WORKDAY_ISO_ALPHA_2) {
      const name = displayNames.of(code);
      if (name && name !== code) result.add(strictWorkdayNormalizeDescriptor(name));
    }
  }
  return result;
}

function strictWorkdayDescriptorParts(descriptor: string): string[] {
  return descriptor.split(/\s+[-–—]\s+|[,/|]/gu)
    .map(strictWorkdayNormalizeDescriptor)
    .filter(Boolean);
}

function strictWorkdayNormalizeDescriptor(descriptor: string): string {
  return descriptor.trim().toLowerCase().replace(/[()_]+/gu, " ").replace(/\s+/gu, " ");
}

function strictWorkdayNonMainland(descriptor: string): boolean {
  const normalized = strictWorkdayNormalizeDescriptor(descriptor);
  return STRICT_WORKDAY_NON_MAINLAND.test(descriptor) ||
    ["hk", "hkg", "mo", "mac", "tw", "twn"].includes(normalized);
}

function strictWorkdayExactMainlandCountry(descriptor: string): boolean {
  return !strictWorkdayNonMainland(descriptor) &&
    STRICT_WORKDAY_MAINLAND_NAMES.has(strictWorkdayNormalizeDescriptor(descriptor));
}

function strictWorkdayMainlandLocation(descriptor: string): boolean {
  return !strictWorkdayNonMainland(descriptor) &&
    strictWorkdayDescriptorParts(descriptor).some((part) => STRICT_WORKDAY_MAINLAND_NAMES.has(part));
}

function strictWorkdayForeignLocation(
  descriptor: string,
  auditedAliases: readonly string[]
): boolean {
  if (auditedAliases.includes(descriptor) || strictWorkdayNonMainland(descriptor)) return true;
  return strictWorkdayDescriptorParts(descriptor).some((part) => {
    const code = part.toUpperCase();
    return !STRICT_WORKDAY_MAINLAND_NAMES.has(part) && (
      STRICT_WORKDAY_REGION_NAMES.has(part) ||
      (STRICT_WORKDAY_ISO_ALPHA_2.has(code) && code !== "CN") ||
      (STRICT_WORKDAY_ISO_ALPHA_3.has(code) && code !== "CHN")
    );
  });
}

function strictFindWorkdayFacetGroups(value: unknown, parameter: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap((child) => strictFindWorkdayFacetGroups(child, parameter));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.facetParameter === parameter ? [record] : []),
    ...strictFindWorkdayFacetGroups(record.values, parameter)
  ];
}

function strictSandozScopeArtifacts(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence
): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "sandoz-jsonapi") return false;
  let endpoint: URL;
  let taxonomyEndpoint: URL;
  try {
    endpoint = exactConfiguredEndpoint(config.endpointUrl);
    taxonomyEndpoint = exactConfiguredEndpoint(config.taxonomyEndpointUrl);
  } catch {
    return false;
  }
  const uniqueArtifact = (logicalKey: string) => {
    const matches = evidence.artifacts.filter((artifact) => artifact.logicalKey === logicalKey);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const taxonomy = uniqueArtifact("sandoz-taxonomy");
  const taxonomyUrl = sanitizeEvidenceHttpUrl(
    sandozTaxonomyUrl(taxonomyEndpoint, config.countryTermTargetId).toString()
  );
  const taxonomyLocator = `sandoz-taxonomy-v1|target:${config.countryTermTargetId}|json:` +
    "$.data[0].type,$.data[0].id,$.data[0].attributes.drupal_internal__tid,$.data[0].attributes.name";
  if (!taxonomy || taxonomy.kind !== "ATS_API_RESPONSE" || taxonomy.httpStatus !== 200 ||
    taxonomy.bodyRepresentation !== "EXACT" || taxonomy.requestedUrl !== taxonomyUrl ||
    taxonomy.finalUrl !== taxonomyUrl || taxonomy.extractorLocator !== taxonomyLocator) return false;
  const taxonomyBody = strictJsonRecord(taxonomy.body);
  const taxonomyData = taxonomyBody?.data;
  if (!Array.isArray(taxonomyData) || taxonomyData.length !== 1) return false;
  const term = strictRecord(taxonomyData[0]);
  const attributes = strictRecord(term?.attributes);
  if (!term || !attributes || term.type !== "taxonomy_term--job_location" ||
    term.id !== config.countryTermUuid ||
    attributes.drupal_internal__tid !== config.countryTermTargetId ||
    attributes.name !== config.countryTermName) return false;

  for (const probe of ["alt1", "alt2", "alt3"] as const) {
    const logicalKey = `sandoz-${probe}-zero`;
    const artifact = uniqueArtifact(logicalKey);
    const officialResponseUrl = strictSandozProbeUrl(endpoint, config.countryTermTargetId, probe, 0).toString();
    const expectedEvidenceUrl = sanitizeEvidenceHttpUrl(officialResponseUrl);
    const expectedLocator = `sandoz-jsonapi-v2|probe:${probe}|page:0|page-size:${config.pageSize}` +
      "|fields:node--jobs-v1|json:$.data[*],$.meta.count,$.number_of_items_per_page," +
      "$.links.self.href,$.links.next.href";
    if (!artifact || artifact.kind !== "ATS_API_RESPONSE" || artifact.httpStatus !== 200 ||
      artifact.bodyRepresentation !== "EXACT" || artifact.requestedUrl !== expectedEvidenceUrl ||
      artifact.finalUrl !== expectedEvidenceUrl || artifact.extractorLocator !== expectedLocator) return false;
    const body = strictJsonRecord(artifact.body);
    const meta = strictRecord(body?.meta);
    const links = strictRecord(body?.links);
    const self = strictRecord(links?.self);
    if (!body || !meta || !links || !self || !Array.isArray(body.data) || body.data.length !== 0 ||
      meta.count !== 0 || body.number_of_items_per_page !== config.pageSize || config.pageSize !== 10 ||
      Object.keys(self).length !== 1 || self.href !== officialResponseUrl ||
      (Object.prototype.hasOwnProperty.call(links, "next") && links.next !== null)) return false;
  }
  return true;
}

function strictJsonRecord(body: string | Uint8Array): Record<string, unknown> | undefined {
  let value: unknown;
  try { value = JSON.parse(typeof body === "string" ? body : Buffer.from(body).toString("utf8")); }
  catch { return undefined; }
  return strictRecord(value);
}

function strictUniqueJsonRecord(body: string | Uint8Array): Record<string, unknown> | undefined {
  const text = typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  return hasUniqueJsonObjectKeys(text) ? strictJsonRecord(text) : undefined;
}

function strictNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function strictRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function strictMokaRequestContracts(plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>, evidence: PersistentSourceFetchEvidence): boolean {
  if (isServierTraversalPlan(plan)) return replayServierTraversal(plan, evidence) !== undefined;
  if (isBayerMedicalTraversalPlan(plan)) return replayBayerMedicalTraversal(plan, evidence) !== undefined;
  const config = plan.moka!;
  const listUrl = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
  const detailUrl = "https://app.mokahr.com/api/outer/ats-apply/website/job";
  const entryArtifacts = evidence.artifacts.filter((artifact) => artifact.logicalKey === "moka-entry-0000");
  if (entryArtifacts.length !== 1 || entryArtifacts[0]!.bodyRepresentation === "REDACTED") return false;
  let listScope: Record<string, unknown>;
  try { listScope = mokaNativeListScope(plan, String(entryArtifacts[0]!.body)); } catch { return false; }
  const aesIv = strictMokaInitIv(entryArtifacts[0]!.body, config);
  if (!aesIv) return false;
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  if (artifacts.size !== evidence.artifacts.length) return false;
  const requiredDetails = new Map<string, string>();
  for (const page of evidence.pages) {
    const offset = page.sequence * 50;
    const expected = { sequence: page.sequence, requestedCursor: null, requestedOffset: offset,
      requestedPage: null, requestedPageSize: 50 };
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || !strictPageCoordinatesEqual(page, expected)) return false;
    const artifact = artifacts.get(page.artifactLogicalKey);
    if (!artifact || artifact.bodyRepresentation === "REDACTED" ||
      !strictRequestContractMatches(artifact.extractorLocator, {
      family: "moka", role: "page", method: "POST", url: listUrl,
      body: { orgId: config.expectedOrgId, siteId: config.expectedSiteId, limit: 50, offset,
        needStat: true, isCampusJob: false, site: config.expectedMode, locale: "zh-CN", ...listScope },
      coordinate: { sequence: page.sequence, requestedOffset: offset, requestedPage: null, requestedPageSize: 50 }
    })) return false;
    const decrypted = strictMokaDecryptEnvelope(artifact.body, aesIv);
    const root = strictRecord(decrypted);
    const data = strictRecord(root?.data);
    if (!root || root.success !== true || !data || !Array.isArray(data.jobs)) return false;
    for (let recordIndex = 0; recordIndex < data.jobs.length; recordIndex += 1) {
      const record = strictRecord(data.jobs[recordIndex]);
      const jobId = strictMokaJobId(record);
      if (!record || !jobId || !strictNonblankText(record.title)) continue;
      if (config.requisitionStatusPolicy && record.status !== "open") return false;
      if (config.hydrateMissingLocationsFromDetail && strictMokaCities(record.locations).length === 0) {
        const logicalKey = `moka-detail-${String(page.sequence).padStart(4, "0")}-${String(recordIndex).padStart(4, "0")}`;
        requiredDetails.set(logicalKey, jobId);
      }
    }
  }
  const detailArtifacts = evidence.artifacts.filter((candidate) => candidate.logicalKey.startsWith("moka-detail-"));
  if (detailArtifacts.length !== requiredDetails.size ||
    detailArtifacts.some((artifact) => !requiredDetails.has(artifact.logicalKey))) return false;
  for (const artifact of detailArtifacts) {
    const match = /^moka-detail-(\d{4})-(\d{4})$/u.exec(artifact.logicalKey);
    const idMatch = /^moka-detail-v2\|request:jobId64=([A-Za-z0-9_-]+)\|request-contract-v2\|sha256:[0-9a-f]{64}$/u
      .exec(artifact.extractorLocator);
    const expectedJobId = requiredDetails.get(artifact.logicalKey);
    if (!match || !idMatch || !expectedJobId || artifact.kind !== "ATS_API_RESPONSE" ||
      artifact.httpStatus !== 200 || artifact.bodyRepresentation === "REDACTED" ||
      artifact.requestedUrl !== detailUrl || artifact.finalUrl !== detailUrl) return false;
    let locatorJobId: string;
    try { locatorJobId = Buffer.from(idMatch[1]!, "base64url").toString("utf8"); } catch { return false; }
    if (!locatorJobId || locatorJobId !== expectedJobId ||
      Buffer.from(locatorJobId, "utf8").toString("base64url") !== idMatch[1]) return false;
    const sequence = Number(match[1]);
    const recordIndex = Number(match[2]);
    if (!strictRequestContractMatches(artifact.extractorLocator, {
      family: "moka", role: "detail", method: "POST", url: detailUrl,
      body: { orgId: config.expectedOrgId, siteId: config.expectedSiteId, jobId: expectedJobId, locale: "zh-CN" },
      coordinate: { sequence, recordIndex }
    })) return false;
    const detail = strictMokaDetailRecord(artifact.body, aesIv);
    const detailSiteId = strictMokaStringValue(detail?.siteId);
    if (!detail || strictMokaJobId(detail) !== expectedJobId ||
      strictMokaStringValue(detail.orgId) !== config.expectedOrgId ||
      (detailSiteId !== config.expectedSiteId &&
        !(detailSiteId === undefined && config.allowDetailSiteIdOmission === true)) ||
      strictMokaCities(mokaDetailLocations(detail, config.expectedOrgId, config.expectedSiteId)).length === 0) return false;
  }
  return true;
}

function strictMokaInitIv(
  body: string | Uint8Array,
  config: NonNullable<Extract<SourceCrawlPlan, { adapterId: "official-json" }>["moka"]>
): string | undefined {
  let parsed: Record<string, unknown> | undefined;
  try {
    const $ = load(typeof body === "string" ? body : Buffer.from(body).toString("utf8"));
    const raw = $("#init-data").attr("value");
    parsed = raw ? strictRecord(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
  const org = strictRecord(parsed?.org);
  const aesIv = strictNonblankText(parsed?.aesIv);
  if (!parsed || !org || !aesIv || Buffer.byteLength(aesIv, "utf8") !== 16 ||
    strictNonblankText(org.id) !== config.expectedOrgId ||
    strictMokaStringValue(parsed.siteId ?? org.siteId) !== config.expectedSiteId ||
    strictNonblankText(parsed.mode) !== config.expectedMode) return undefined;
  return aesIv;
}

function strictMokaDecryptEnvelope(body: string | Uint8Array, aesIv: string): unknown {
  try {
    const envelope = strictJsonRecord(body);
    const data = strictNonblankText(envelope?.data);
    const key = strictNonblankText(envelope?.necromancer);
    if (!data || !key || Buffer.byteLength(key, "utf8") !== 16 || Buffer.byteLength(aesIv, "utf8") !== 16) {
      return undefined;
    }
    const decipher = createDecipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(aesIv, "utf8"));
    let decrypted = decipher.update(data, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted) as unknown;
  } catch {
    return undefined;
  }
}

function strictMokaDetailRecord(
  body: string | Uint8Array,
  aesIv: string
): Record<string, unknown> | undefined {
  const encrypted = strictMokaDecryptEnvelope(body, aesIv);
  if (encrypted !== undefined) {
    const root = strictRecord(encrypted);
    return root?.success === true ? strictRecord(root.data) : undefined;
  }
  return strictJsonRecord(body);
}

function strictMokaJobId(job: Record<string, unknown> | undefined): string | undefined {
  if (!job) return undefined;
  if (typeof job.id === "string") return job.id.trim() || undefined;
  return typeof job.id === "number" && Number.isSafeInteger(job.id) ? String(job.id) : undefined;
}

function strictNonblankText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function strictMokaStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  return typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
}

function strictMokaCities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const location = strictRecord(candidate);
    const city = strictNonblankText(location?.cityName) ?? strictNonblankText(location?.provinceName) ??
      strictNonblankText(location?.country);
    return city ? [city] : [];
  });
}

function strictPhenomRequestContracts(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[],
  capturedAt: string
): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "phenom") return false;
  if (config.mixedLocationScopePolicy !== undefined &&
    config.mixedLocationScopePolicy !== "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1") return false;
  const allowsMainlandAlternative =
    config.mixedLocationScopePolicy === "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1";
  const mainlandAlternativeOutputs = new Map<string, StrictPhenomMainlandAlternativeOutput>();
  const entryArtifacts = evidence.artifacts.filter((artifact) => artifact.logicalKey === "phenom-entry-0000");
  const entry = entryArtifacts.length === 1 ? entryArtifacts[0] : undefined;
  const pageConfig = entry && entry.bodyRepresentation !== "REDACTED"
    ? strictGatePhenomPageConfig(entry.body)
    : undefined;
  if (!pageConfig) return false;
  const preserveMerckQuality = requiresMerckChinaQuality(plan);
  if (preserveMerckQuality && (!exactMerckChinaQualityPlan(plan) || !exactMerckChinaBootstrap(pageConfig))) return false;
  const merckOutputs = new Map<string, StrictUcbDateOutput>();
  const preserveOrganonQuality = requiresOrganonPostedDate(plan);
  if (preserveOrganonQuality && (!exactOrganonPostedDatePlan(plan) || !exactOrganonPostedDateBootstrap(pageConfig))) return false;
  // Exact Organon bootstrap provenance, including the source attempt's maximum
  // legal runtime window. Absent bodyRepresentation retains the legacy exact
  // bytes default; REDACTED bodies are already rejected above.
  const organonStart = Date.parse(capturedAt);
  const organonEntryTime = entry ? Date.parse(entry.capturedAt) : NaN;
  if (preserveOrganonQuality && (!entry || !Number.isFinite(organonStart) || !Number.isFinite(organonEntryTime) ||
    organonEntryTime < organonStart || organonEntryTime > organonStart + 30 * 60_000 ||
    entry.requestedUrl !== "https://jobs.organon.com/cn/zh/search-results" || entry.finalUrl !== entry.requestedUrl ||
    entry.kind !== "OFFICIAL_COMPANY_PAGE" || entry.httpStatus !== 200 || !/^text\/html(?:;|$)/iu.test(entry.contentType ?? "") ||
    entry.extractorLocator !== organonBootstrapLocator(pageConfig))) return false;
  let organonPreviousCapture = organonEntryTime;
  const organonOutputs = new Map<string, StrictUcbDateOutput>();
  const preserveLillyQuality = requiresLillyChinaQuality(plan);
  if (preserveLillyQuality && (!exactLillyChinaQualityPlan(plan) || !exactLillyChinaBootstrap(pageConfig))) return false;
  const lillyOutputs = new Map<string, StrictUcbDateOutput>();
  const preserveUcbPostedDate = !preserveMerckQuality && !preserveOrganonQuality && !preserveLillyQuality && requiresUcbPostedDate(plan);
  if (preserveUcbPostedDate && (!exactUcbPostedDatePlan(plan) || !exactUcbPostedDateBootstrap(pageConfig))) return false;
  const ucbOutputs = new Map<string, StrictUcbDateOutput>();
  const endpoint = pageConfig.widgetApiEndpoint;
  let parsedEndpoint: URL;
  try { parsedEndpoint = new URL(endpoint); } catch { return false; }
  if (parsedEndpoint.protocol !== "https:" || parsedEndpoint.origin !== new URL(plan.source.officialEntryUrl).origin ||
    parsedEndpoint.pathname !== "/widgets" || parsedEndpoint.search || parsedEndpoint.hash) return false;
  const exactRocheRequestBoundOmittedOffset = strictExactRochePhenomPlan(plan, pageConfig, endpoint);
  const preserveRocheQuality = exactRocheRequestBoundOmittedOffset && config.nativeDetailPolicy === ROCHE_NATIVE_DETAIL_POLICY;
  if (config.nativeDetailPolicy !== undefined && !preserveRocheQuality) return false;
  const rocheOutputs = new Map<string, NonNullable<ReturnType<typeof rocheNativeDetail>>>();
  if (preserveRocheQuality) {
    const start = Date.parse(capturedAt);
    if (!entry || entry.capturedAt !== capturedAt || evidence.artifacts[0]?.logicalKey !== entry.logicalKey) return false;
    for (const artifact of evidence.artifacts.filter(a => a.logicalKey.startsWith("phenom-"))) {
      const isEntry = artifact.logicalKey === "phenom-entry-0000";
      const isPage = artifact.logicalKey.startsWith("phenom-page-");
      const time = Date.parse(artifact.capturedAt);
      if (artifact.bodyRepresentation !== "EXACT" || artifact.httpStatus !== 200 ||
        artifact.requestedUrl !== (isEntry ? plan.source.officialEntryUrl : endpoint) || artifact.finalUrl !== artifact.requestedUrl ||
        artifact.kind !== (isEntry ? "OFFICIAL_COMPANY_PAGE" : isPage ? "PAGINATION_PAGE" : "ATS_API_RESPONSE") ||
        !(isEntry ? /^text\/html(?:;|$)/iu : /^application\/json(?:;|$)/iu).test(artifact.contentType ?? "") ||
        !Number.isFinite(time) || time < start || time > start + 30 * 60_000 ||
        (isPage && evidence.pages.find(page => page.artifactLogicalKey === artifact.logicalKey)?.capturedAt !== artifact.capturedAt)) return false;
    }
  }
  if (config.requestBoundOmittedOffsetPolicy !== undefined && !exactRocheRequestBoundOmittedOffset && !preserveOrganonQuality) return false;
  const exactMerckHealthcarePartition = strictExactMerckHealthcarePhenomPlan(plan, pageConfig, endpoint);
  if (config.facetScope && "partitionProofPolicy" in config.facetScope &&
    config.facetScope.partitionProofPolicy !== undefined && !exactMerckHealthcarePartition) return false;
  let pageSize = Math.max(1, Math.min(exactRocheRequestBoundOmittedOffset ? 250 : 100, config.pageSize ?? 50));
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  if (artifacts.size !== evidence.artifacts.length) return false;
  const facetScope = strictGatePhenomFacetScope(config.facetScope);
  if (Boolean(config.facetScope) !== Boolean(facetScope)) return false;
  const facetArtifacts = evidence.artifacts.filter((artifact) => artifact.logicalKey.startsWith("phenom-facet-"));
  let selectedFields: Record<string, string[]>;
  let structuredExpectedTotal: number | undefined;
  let allowedExclusionDescriptors: ReadonlySet<string> | undefined;
  let merckPartitionReplay: StrictMerckPartitionReplay | undefined;
  if (facetScope) {
    if (exactMerckHealthcarePartition) {
      merckPartitionReplay = strictReplayMerckHealthcarePartitions({
        artifacts,
        facetArtifacts,
        endpoint,
        pageConfig,
        pageSize,
        maxPages: Math.max(1, config.maxPages ?? 20),
        allowOmittedOffsetForSinglePage: config.allowOmittedOffsetForSinglePage === true,
        facetScope
      });
      if (!merckPartitionReplay) return false;
      selectedFields = merckPartitionReplay.selectedFields;
      structuredExpectedTotal = merckPartitionReplay.expectedTotal;
      allowedExclusionDescriptors = merckPartitionReplay.allowedJobLevels;
    } else {
    if (facetArtifacts.length !== 2) return false;
    const global = artifacts.get("phenom-facet-global");
    const country = artifacts.get("phenom-facet-country");
    if (!global || !country || global.bodyRepresentation === "REDACTED" || country.bodyRepresentation === "REDACTED" ||
      !strictRequestContractMatches(global.extractorLocator, {
        family: "phenom", role: "facet-preflight-global", method: "POST", url: endpoint,
        body: strictGatePhenomRequestBody(pageConfig, Math.min(100, pageSize), 0, {}),
        coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: Math.min(100, pageSize) }
      }) ||
      !strictRequestContractMatches(country.extractorLocator, {
        family: "phenom", role: "facet-preflight-country", method: "POST", url: endpoint,
        body: strictGatePhenomRequestBody(pageConfig, Math.min(100, pageSize), 0, {
          country: [facetScope.countryIncludeDescriptor]
        }),
        coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: Math.min(100, pageSize) }
      })) return false;
    const globalEnvelope = strictGatePhenomFacetEnvelope(global.body);
    const countryEnvelope = strictGatePhenomFacetEnvelope(country.body);
    if (!globalEnvelope || !countryEnvelope) return false;
    const globalCountries = strictGatePhenomAggregation(globalEnvelope.aggregations, "country");
    const countryCount = globalCountries?.get(facetScope.countryIncludeDescriptor);
    if (countryCount === undefined || countryEnvelope.totalHits !== countryCount ||
      countryEnvelope.jobs.some((job) =>
        !strictPhenomRecordMatchesCountryFacet(
          strictRecord(job),
          facetScope.countryIncludeDescriptor,
          allowsMainlandAlternative
        ))) return false;
    if (facetScope.requireGlobalDescriptorProof) {
      const globalExclusions = strictGatePhenomAggregation(
        globalEnvelope.aggregations,
        facetScope.exclusionField
      );
      if (!globalExclusions ||
        [...globalExclusions.values()].reduce((sum, count) => sum + count, 0) !== globalEnvelope.totalHits ||
        facetScope.exclusionDescriptors.some((descriptor) => !globalExclusions.has(descriptor))) return false;
    }
    if (facetScope.countryOnly) {
      structuredExpectedTotal = countryCount;
      selectedFields = { country: [facetScope.countryIncludeDescriptor] };
    } else {
    const countryExclusions = strictGatePhenomAggregation(
      countryEnvelope.aggregations,
      facetScope.exclusionField
    );
    if (!countryExclusions ||
      [...countryExclusions.values()].reduce((sum, count) => sum + count, 0) !== countryCount ||
      (!facetScope.requireGlobalDescriptorProof &&
        facetScope.exclusionDescriptors.some((descriptor) => !countryExclusions.has(descriptor)))) return false;
    const allowed = [...countryExclusions.keys()]
      .filter((descriptor) => !facetScope.exclusionDescriptors.includes(descriptor))
      .sort();
    if (allowed.length === 0) return false;
    structuredExpectedTotal = allowed.reduce((sum, descriptor) => sum + countryExclusions.get(descriptor)!, 0);
    allowedExclusionDescriptors = new Set(allowed);
    selectedFields = {
      country: [facetScope.countryIncludeDescriptor],
      [facetScope.exclusionField]: allowed
    };
    }
    }
  } else {
    if (facetArtifacts.length !== 0 || config.countryFilter !== "China") return false;
    selectedFields = { country: ["China"] };
  }
  // Keep equal postedDate values in one official response, without weakening cardinality checks.
  if (preserveRocheQuality) pageSize = Math.max(pageSize, structuredExpectedTotal ?? 0);

  const rocheExpectedTotal = exactRocheRequestBoundOmittedOffset ? structuredExpectedTotal : undefined;
  const rocheExpectedPageCount = rocheExpectedTotal === undefined
    ? undefined
    : rocheExpectedTotal === 0 ? 1 : Math.ceil(rocheExpectedTotal / pageSize);
  if (exactRocheRequestBoundOmittedOffset && (rocheExpectedPageCount === undefined ||
    evidence.pages.length !== rocheExpectedPageCount ||
    evidence.artifacts.length !== evidence.pages.length + 3 + (preserveRocheQuality ? rocheExpectedTotal! : 0))) return false;
  const rocheExpectedOutputIds = new Set<string>();
  const rocheRawOfficialIds = new Set<string>();
  const merckExpectedPageCount = merckPartitionReplay
    ? Math.max(1, Math.ceil(merckPartitionReplay.expectedTotal / pageSize))
    : undefined;
  if (merckPartitionReplay && (evidence.pages.length !== merckExpectedPageCount ||
    evidence.artifacts.length !== 1 + facetArtifacts.length + evidence.pages.length)) return false;
  const merckReturnedRawIds = new Set<string>();
  let pageRawCount = 0;
  for (let pageIndex = 0; pageIndex < evidence.pages.length; pageIndex += 1) {
    const page = evidence.pages[pageIndex]!;
    const offset = page.sequence * pageSize;
    const expected = { sequence: page.sequence, requestedCursor: null, requestedOffset: offset,
      requestedPage: null, requestedPageSize: pageSize };
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || !strictPageCoordinatesEqual(page, expected)) return false;
    const artifact = artifacts.get(page.artifactLogicalKey);
    if (!artifact || artifact.bodyRepresentation === "REDACTED" ||
      !strictRequestContractMatches(artifact.extractorLocator, {
      family: "phenom", role: "page", method: "POST", url: endpoint,
      body: strictGatePhenomRequestBody(
        pageConfig,
        pageSize,
        offset,
        selectedFields,
        exactMerckHealthcarePartition
      ),
      coordinate: { sequence: page.sequence, requestedOffset: offset, requestedPage: null, requestedPageSize: pageSize }
    })) return false;
    const envelope = strictGatePhenomFacetEnvelope(
      artifact.body,
      exactMerckHealthcarePartition || preserveLillyQuality ? selectedFields : undefined
    );
    if (!envelope || page.declaredTotal !== envelope.totalHits ||
      (structuredExpectedTotal !== undefined && envelope.totalHits !== structuredExpectedTotal) ||
      envelope.jobs.length !== page.rawJobIds.length ||
      createHash("sha256").update(typeof artifact.body === "string"
        ? Buffer.from(artifact.body, "utf8") : Buffer.from(artifact.body)).digest("hex") !==
        page.responseFingerprintSha256) return false;
    if (preserveOrganonQuality) {
      const artifactTime = Date.parse(artifact.capturedAt);
      const expectedPrefix = ["phenom-page-v1", "entry:phenom-entry-0000",
        `config:${irreversibleOfficialJsonEvidenceId(organonBootstrapLocator(pageConfig))}`,
        `selectedFields:${irreversibleOfficialJsonEvidenceId(JSON.stringify({country:["China"]}))}`,
        `requestOffset:${offset}`, "json:$.refineSearch.totalHits", "request-contract-v2", "sha256:"].join("|");
      if (artifact.kind !== "PAGINATION_PAGE" || artifact.httpStatus !== 200 ||
        artifact.requestedUrl !== endpoint || artifact.finalUrl !== endpoint || !/^application\/json(?:;|$)/iu.test(artifact.contentType ?? "") ||
        !Number.isFinite(artifactTime) || artifactTime < organonPreviousCapture || artifactTime > organonStart + 30 * 60_000 ||
        page.capturedAt !== artifact.capturedAt || !artifact.extractorLocator.startsWith(expectedPrefix)) return false;
      organonPreviousCapture = artifactTime;
      // This exact Organon feed omits response offsets. Prove each request offset via
      // the bound request, full page cardinality, stable total, and disjoint raw IDs.
      const total = evidence.declaredCompleteness?.value;
      if (total === undefined || envelope.totalHits !== total || page.sequence !== pageIndex ||
        page.artifactLogicalKey !== `phenom-page-${String(pageIndex).padStart(4, "0")}` ||
        evidence.pages.length !== Math.max(1, Math.ceil(total / pageSize)) ||
        evidence.artifacts.length !== evidence.pages.length + 1 || offset > total ||
        envelope.jobs.length !== Math.min(pageSize, total - offset) ||
        (envelope.hasOwnFrom ? envelope.from !== offset || page.returnedOffset !== offset : page.returnedOffset !== null)) return false;
      const last = pageIndex === evidence.pages.length - 1;
      if (page.nextPageSignalBefore !== (pageIndex === 0 ? null : `offset:${offset}`) ||
        page.nextPageSignalAfter !== (last ? null : `offset:${offset + pageSize}`) ||
        page.termination !== (total === 0 ? "EMPTY_PAGE" : last ? "NEXT_ABSENT" : "CONTINUE")) return false;
      const rawIds: string[] = [], validIds: string[] = [];
      for (const value of envelope.jobs) {
        const raw = strictRecord(value);
        const cities = raw && organonOfficialCities(raw);
        const date = raw && phenomOfficialPostedDate(raw.postedDate);
        const title = raw && strictNonblankText(raw.title)?.replace(/\s+/gu, " ");
        if (!raw || !cities || !date || !title || !organonOfficialIdentity(raw)) return false;
        const rawId = raw.jobSeqNo as string, sourceJobId = persistentOfficialJsonJobId(rawId);
        if (organonOutputs.has(sourceJobId)) return false;
        organonOutputs.set(sourceJobId, {rawId, sourceJobId, cities, officialPublishedAt: date, title,
          officialUrl: raw.applyUrl as string, locationRaw: raw.location as string});
        rawIds.push(irreversibleOfficialJsonEvidenceId(rawId));
        validIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
      }
      if (JSON.stringify(page.rawJobIds) !== JSON.stringify(rawIds) || JSON.stringify(page.validJobIds) !== JSON.stringify(validIds)) return false;
    }
    if (preserveMerckQuality) {
      // This exact Merck feed omits response offsets. Prove each request offset via
      // the bound request, full page cardinality, stable total, and disjoint raw IDs.
      const total = evidence.declaredCompleteness?.value;
      if (total === undefined || envelope.totalHits !== total || page.sequence !== pageIndex ||
        page.artifactLogicalKey !== `phenom-page-${String(pageIndex).padStart(4, "0")}` ||
        evidence.pages.length !== Math.max(1, Math.ceil(total / pageSize)) ||
        evidence.artifacts.length !== evidence.pages.length + 1 || offset > total ||
        envelope.jobs.length !== Math.min(pageSize, total - offset) ||
        (envelope.hasOwnFrom ? envelope.from !== offset || page.returnedOffset !== offset : page.returnedOffset !== null)) return false;
      const last = pageIndex === evidence.pages.length - 1;
      if (page.nextPageSignalBefore !== (pageIndex === 0 ? null : `offset:${offset}`) ||
        page.nextPageSignalAfter !== (last ? null : `offset:${offset + pageSize}`) ||
        page.termination !== (total === 0 ? "EMPTY_PAGE" : last ? "NEXT_ABSENT" : "CONTINUE")) return false;
      const rawIds: string[] = [], validIds: string[] = [];
      for (const value of envelope.jobs) {
        const raw = strictRecord(value);
        const cities = raw && merckOfficialCities(raw);
        const date = raw && merckOfficialPostedDate(raw.postedDate);
        const title = raw && strictNonblankText(raw.title)?.replace(/\s+/gu, " ");
        if (!raw || !cities || !date || !title || !merckOfficialIdentity(raw)) return false;
        const rawId = raw.jobSeqNo as string, sourceJobId = persistentOfficialJsonJobId(rawId);
        if (merckOutputs.has(sourceJobId)) return false;
        merckOutputs.set(sourceJobId, {rawId, sourceJobId, cities, officialPublishedAt: date, title,
          officialUrl: `https://careers.emdgroup.com/us/en/job/${raw.reqId as string}`, locationRaw: raw.location as string});
        rawIds.push(irreversibleOfficialJsonEvidenceId(rawId));
        validIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
      }
      if (JSON.stringify(page.rawJobIds) !== JSON.stringify(rawIds) || JSON.stringify(page.validJobIds) !== JSON.stringify(validIds)) return false;
    }
    if (preserveLillyQuality) {
      if (!lillyPageEnvelopeValid(strictJsonRecord(artifact.body)?.refineSearch)) return false;
      // This exact Lilly feed omits response offsets. Prove each request offset via
      // the bound request, full page cardinality, stable total, and disjoint raw IDs.
      const total = evidence.declaredCompleteness?.value;
      if (total === undefined || envelope.totalHits !== total || page.sequence !== pageIndex ||
        page.artifactLogicalKey !== `phenom-page-${String(pageIndex).padStart(4, "0")}` ||
        evidence.pages.length !== Math.max(1, Math.ceil(total / pageSize)) ||
        evidence.artifacts.length !== evidence.pages.length + 1 + total || offset > total ||
        envelope.jobs.length !== Math.min(pageSize, total - offset) ||
        (envelope.hasOwnFrom ? envelope.from !== offset || page.returnedOffset !== offset : page.returnedOffset !== null)) return false;
      const last = pageIndex === evidence.pages.length - 1;
      if (page.nextPageSignalBefore !== (pageIndex === 0 ? null : `offset:${offset}`) ||
        page.nextPageSignalAfter !== (last ? null : `offset:${offset + pageSize}`) ||
        page.termination !== (total === 0 ? "EMPTY_PAGE" : last ? "NEXT_ABSENT" : "CONTINUE")) return false;
      const rawIds: string[] = [], validIds: string[] = [];
      for (const value of envelope.jobs) {
        const raw = strictRecord(value);
        const listCities = raw && lillyOfficialCities(raw);
        const detail = raw && lillyNativeDetail(raw, artifacts.get(`lilly-detail-${raw.reqId}`), capturedAt);
        const cities = detail?.cities;
        const date = raw && lillyOfficialPostedDate(raw.postedDate);
        const title = raw && strictNonblankText(raw.title)?.replace(/\s+/gu, " ");
        if (!raw || !listCities || !detail || !cities || !date || !title) return false;
        const rawId = raw.jobSeqNo as string, sourceJobId = persistentOfficialJsonJobId(rawId);
        if (lillyOutputs.has(sourceJobId)) return false;
        lillyOutputs.set(sourceJobId, {rawId, sourceJobId, cities, officialPublishedAt: date, title,
          officialUrl: raw.applyUrl as string, locationRaw: detail.locationRaw});
        rawIds.push(irreversibleOfficialJsonEvidenceId(rawId));
        validIds.push(irreversibleOfficialJsonEvidenceId(sourceJobId));
      }
      if (JSON.stringify(page.rawJobIds) !== JSON.stringify(rawIds) || JSON.stringify(page.validJobIds) !== JSON.stringify(validIds)) return false;
    }
    if (preserveUcbPostedDate) {
      // The omitted-offset exception is determined by the raw total, never by normalized output.
      const omittedSinglePage = !envelope.hasOwnFrom && pageIndex === 0 && evidence.pages.length === 1 &&
        envelope.totalHits <= pageSize && envelope.jobs.length === envelope.totalHits;
      if (page.sequence !== pageIndex || page.artifactLogicalKey !== `phenom-page-${String(pageIndex).padStart(4, "0")}` ||
        (!omittedSinglePage && (!envelope.hasOwnFrom || envelope.from !== offset)) ||
        page.returnedOffset !== (omittedSinglePage ? null : offset)) return false;
      const rawIds: string[] = [];
      const validIds: string[] = [];
      for (const raw of envelope.jobs) {
        const expectedOutput = strictUcbDateOutput(raw);
        if (!expectedOutput || ucbOutputs.has(expectedOutput.sourceJobId)) return false;
        ucbOutputs.set(expectedOutput.sourceJobId, expectedOutput);
        rawIds.push(irreversibleOfficialJsonEvidenceId(expectedOutput.rawId));
        validIds.push(irreversibleOfficialJsonEvidenceId(expectedOutput.sourceJobId));
      }
      if (JSON.stringify(page.rawJobIds) !== JSON.stringify(rawIds) ||
        JSON.stringify(page.validJobIds) !== JSON.stringify(validIds)) return false;
    }
    if (merckPartitionReplay) {
      const safelyOmittedMerckSinglePageOffset = config.allowOmittedOffsetForSinglePage === true &&
        !envelope.hasOwnFrom && pageIndex === 0 && offset === 0 &&
        merckPartitionReplay.expectedTotal <= pageSize;
      if (page.sequence !== pageIndex || page.artifactLogicalKey !==
        `phenom-page-${String(pageIndex).padStart(4, "0")}` ||
        (!safelyOmittedMerckSinglePageOffset && (!envelope.hasOwnFrom || envelope.from !== offset)) ||
        page.returnedOffset !== offset ||
        envelope.jobs.length !== Math.min(pageSize, merckPartitionReplay.expectedTotal - offset)) return false;
      const expectedRawIds: string[] = [];
      const expectedValidIds: string[] = [];
      for (const raw of envelope.jobs) {
        const record = strictRecord(raw);
        const rawId = record ? strictPhenomOfficialId(record.jobSeqNo) ??
          strictPhenomOfficialId(record.reqId) ?? strictPhenomOfficialId(record.jobId) : undefined;
        const rawEvidenceId = irreversibleOfficialJsonEvidenceId(rawId ?? raw);
        if (!expectedRawIds.includes(rawEvidenceId)) expectedRawIds.push(rawEvidenceId);
        if (!record || !rawId || !safeOfficialJsonId(rawId) ||
          !merckPartitionReplay.expectedRawIds.has(rawId) || merckReturnedRawIds.has(rawId)) return false;
        merckReturnedRawIds.add(rawId);
        expectedValidIds.push(irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId(rawId)));
      }
      if (JSON.stringify(page.rawJobIds) !== JSON.stringify(expectedRawIds) ||
        JSON.stringify(page.validJobIds) !== JSON.stringify(expectedValidIds)) return false;
      const lastPage = pageIndex === evidence.pages.length - 1;
      if (page.nextPageSignalBefore !== (pageIndex === 0 ? null : `offset:${offset}`) ||
        page.nextPageSignalAfter !== (lastPage ? null : `offset:${offset + pageSize}`) ||
        page.termination !== (merckPartitionReplay.expectedTotal === 0
          ? "EMPTY_PAGE" : lastPage ? "NEXT_ABSENT" : "CONTINUE")) return false;
    }
    if (exactRocheRequestBoundOmittedOffset) {
      if (page.sequence !== pageIndex || page.artifactLogicalKey !==
        `phenom-page-${String(pageIndex).padStart(4, "0")}` || rocheExpectedTotal === undefined ||
        offset > rocheExpectedTotal ||
        envelope.jobs.length !== Math.min(pageSize, rocheExpectedTotal - offset)) return false;
      if (envelope.hasOwnFrom) {
        if (envelope.from !== offset || page.returnedOffset !== offset) return false;
      } else if (page.returnedOffset !== null) return false;
      const expectedRawIds: string[] = [];
      const expectedValidIds: string[] = [];
      for (const raw of envelope.jobs) {
        const record = strictRecord(raw);
        const rawId = record ? strictPhenomOfficialId(record.jobSeqNo) ??
          strictPhenomOfficialId(record.reqId) ?? strictPhenomOfficialId(record.jobId) : undefined;
        const rawEvidenceId = irreversibleOfficialJsonEvidenceId(rawId ?? raw);
        if (!expectedRawIds.includes(rawEvidenceId)) expectedRawIds.push(rawEvidenceId);
        if (!record || !rawId || !safeOfficialJsonId(rawId)) return false;
        const sourceJobId = persistentOfficialJsonJobId(rawId);
        const validEvidenceId = irreversibleOfficialJsonEvidenceId(sourceJobId);
        if (expectedValidIds.includes(validEvidenceId)) return false;
        // Equal raw totals plus an overlap can still hide a missing role when sort keys tie.
        if (rocheRawOfficialIds.has(rawId)) return false;
        rocheRawOfficialIds.add(rawId);
        expectedValidIds.push(validEvidenceId);
        rocheExpectedOutputIds.add(sourceJobId);
        if (preserveRocheQuality) {
          const native = rocheNativeDetail(record, artifacts.get(`roche-detail-${record.reqId}`), capturedAt);
          if (!native) return false;
          rocheOutputs.set(sourceJobId, native);
        }
      }
      if (JSON.stringify(page.rawJobIds) !== JSON.stringify(expectedRawIds) ||
        JSON.stringify(page.validJobIds) !== JSON.stringify(expectedValidIds)) return false;
      const lastPage = pageIndex === evidence.pages.length - 1;
      const expectedNextBefore = pageIndex === 0 ? null : `offset:${offset}`;
      const expectedNextAfter = lastPage ? null : `offset:${offset + pageSize}`;
      const expectedTermination = rocheExpectedTotal === 0
        ? "EMPTY_PAGE"
        : lastPage ? "NEXT_ABSENT" : "CONTINUE";
      if (page.nextPageSignalBefore !== expectedNextBefore ||
        page.nextPageSignalAfter !== expectedNextAfter || page.termination !== expectedTermination) return false;
    }
    const expectedCountry = facetScope?.countryIncludeDescriptor ?? "China";
    for (const job of envelope.jobs) {
      const record = strictRecord(job);
      if (!record) return false;
      if (strictPhenomRecordHasGenericLocation(record)) return false;
      if (allowsMainlandAlternative) {
        const primary = strictPhenomPrimaryLocation(record);
        if (record.country === expectedCountry && primary && strictPhenomMainlandLocationCities(primary)) continue;
        const alternative = strictPhenomMainlandAlternative(record);
        const rawId = strictNonblankText(record.jobSeqNo) ?? strictNonblankText(record.reqId) ??
          strictNonblankText(record.jobId);
        if (!alternative || !rawId) return false;
        const sourceJobId = strictPhenomPersistentSourceJobId(rawId);
        if (mainlandAlternativeOutputs.has(sourceJobId)) return false;
        mainlandAlternativeOutputs.set(sourceJobId, { sourceJobId, ...alternative });
        continue;
      }
      const presentInclude = facetScope?.includeField
        ? strictNonblankText(record[facetScope.includeField])
        : undefined;
      const presentExclusion = facetScope
        ? strictNonblankText(record[facetScope.exclusionField])
        : undefined;
      if (record.country !== expectedCountry ||
        (merckPartitionReplay
          ? (presentInclude !== undefined && presentInclude !== facetScope?.includeDescriptor) ||
            (presentExclusion !== undefined && !allowedExclusionDescriptors?.has(presentExclusion))
          : facetScope && !facetScope.countryOnly &&
            !allowedExclusionDescriptors?.has(presentExclusion ?? ""))) {
        return false;
      }
    }
    pageRawCount += envelope.jobs.length;
  }
  const rocheReplayMatches = !exactRocheRequestBoundOmittedOffset ||
    (rocheExpectedTotal !== undefined && pageRawCount === rocheExpectedTotal &&
      rocheExpectedOutputIds.size === rocheExpectedTotal &&
      evidence.fetchCounts.rawCount === rocheExpectedTotal &&
      evidence.fetchCounts.parsedCount === rocheExpectedTotal &&
      evidence.fetchCounts.validCount === rocheExpectedTotal &&
      evidence.fetchCounts.parseDiscardCount === 0 && evidence.fetchCounts.validationDiscardCount === 0 &&
      evidence.fetchLosses.length === 0 && outputJobs.length === rocheExpectedOutputIds.size &&
      outputJobs.every((job) => job.companyId === plan.company.id && job.sourceId === plan.source.id &&
        typeof job.sourceJobId === "string" && rocheExpectedOutputIds.has(job.sourceJobId)) &&
      new Set(outputJobs.map((job) => job.sourceJobId)).size === outputJobs.length);
  const merckReplayMatches = !merckPartitionReplay ||
    (pageRawCount === merckPartitionReplay.expectedTotal &&
      merckReturnedRawIds.size === merckPartitionReplay.expectedRawIds.size &&
      [...merckPartitionReplay.expectedRawIds].every((id) => merckReturnedRawIds.has(id)) &&
      evidence.fetchCounts.rawCount === merckPartitionReplay.expectedTotal &&
      evidence.fetchCounts.parsedCount === merckPartitionReplay.expectedTotal &&
      evidence.fetchCounts.validCount === merckPartitionReplay.expectedTotal &&
      evidence.fetchCounts.parseDiscardCount === 0 && evidence.fetchCounts.validationDiscardCount === 0 &&
      evidence.fetchLosses.length === 0 && outputJobs.length === merckPartitionReplay.expectedTotal &&
      outputJobs.every((job) => job.companyId === plan.company.id && job.sourceId === plan.source.id &&
        [...merckPartitionReplay.expectedRawIds].some((id) => job.sourceJobId === persistentOfficialJsonJobId(id))) &&
      new Set(outputJobs.map((job) => job.sourceJobId)).size === outputJobs.length);
  return evidence.declaredCompleteness?.kind === "OFFICIAL_TOTAL_COUNT" &&
    evidence.declaredCompleteness.value === pageRawCount &&
    rocheReplayMatches &&
    (!preserveRocheQuality || (rocheOutputs.size === pageRawCount && evidence.artifacts.length === evidence.pages.length + 3 + pageRawCount &&
      outputJobs.every(job => {
        const expected = job.sourceJobId && rocheOutputs.get(job.sourceJobId);
        return expected && typeof job.isBaseline === "boolean" && isDeepStrictEqual(job, {
          companyId: plan.company.id, sourceId: plan.source.id, sourceKind: "SOCIAL", atsKind: "OFFICIAL_JSON",
          officialChineseCompanyName: plan.company.officialChineseName, officialTitle: expected.title,
          officialUrl: expected.officialUrl, listUrl: canonicalPublicHttpUrl(plan.source.officialEntryUrl),
          sourceJobId: job.sourceJobId, locationRaw: expected.locationRaw, cities: expected.cities, category: "其他",
          ...(expected.officialPublishedAt ? {officialPublishedAt: expected.officialPublishedAt} : {}), isBaseline: job.isBaseline,
          evidence: {officialEntryUrl: canonicalPublicHttpUrl(plan.source.officialEntryUrl),
            officialChainEvidenceUrl: canonicalPublicHttpUrl(plan.source.officialChainEvidenceUrl!), capturedAt}
        });
      }))) &&
    merckReplayMatches &&
    (!preserveOrganonQuality || (organonOutputs.size === pageRawCount && outputJobs.length === pageRawCount &&
      new Set(outputJobs.map(job => job.sourceJobId)).size === pageRawCount &&
      evidence.fetchCounts.rawCount === pageRawCount && evidence.fetchCounts.parsedCount === pageRawCount &&
      evidence.fetchCounts.validCount === pageRawCount && evidence.fetchCounts.parseDiscardCount === 0 &&
      evidence.fetchCounts.validationDiscardCount === 0 && evidence.fetchLosses.length === 0 &&
      outputJobs.every(job => {
        const expected = job.sourceJobId && organonOutputs.get(job.sourceJobId);
        return expected && typeof job.isBaseline === "boolean" && isDeepStrictEqual(job, {
          companyId: plan.company.id, sourceId: plan.source.id, sourceKind: "SOCIAL", atsKind: "OFFICIAL_JSON",
          officialChineseCompanyName: plan.company.officialChineseName, officialTitle: expected.title,
          officialUrl: expected.officialUrl, listUrl: canonicalPublicHttpUrl(plan.source.officialEntryUrl),
          sourceJobId: expected.sourceJobId, locationRaw: expected.locationRaw, cities: expected.cities, category: "其他",
          officialPublishedAt: expected.officialPublishedAt, isBaseline: job.isBaseline,
          evidence: { officialEntryUrl: canonicalPublicHttpUrl(plan.source.officialEntryUrl),
            officialChainEvidenceUrl: canonicalPublicHttpUrl(plan.source.officialChainEvidenceUrl!), capturedAt }
        });
      }))) &&
    (!preserveMerckQuality || (merckOutputs.size === pageRawCount && outputJobs.length === pageRawCount &&
      new Set(outputJobs.map(job => job.sourceJobId)).size === pageRawCount &&
      evidence.fetchCounts.rawCount === pageRawCount && evidence.fetchCounts.parsedCount === pageRawCount &&
      evidence.fetchCounts.validCount === pageRawCount && evidence.fetchCounts.parseDiscardCount === 0 &&
      evidence.fetchCounts.validationDiscardCount === 0 && evidence.fetchLosses.length === 0 &&
      outputJobs.every(job => {
        const expected = job.sourceJobId && merckOutputs.get(job.sourceJobId);
        return expected && job.companyId === plan.company.id && job.sourceId === plan.source.id &&
          job.evidence.capturedAt === capturedAt && job.officialPublishedAt === expected.officialPublishedAt &&
          job.officialTitle === expected.title && job.officialUrl === expected.officialUrl &&
          job.locationRaw === expected.locationRaw && JSON.stringify(job.cities) === JSON.stringify(expected.cities);
      }))) &&
    (!preserveLillyQuality || (lillyOutputs.size === pageRawCount && outputJobs.length === pageRawCount &&
      new Set(outputJobs.map(job => job.sourceJobId)).size === pageRawCount &&
      evidence.fetchCounts.rawCount === pageRawCount && evidence.fetchCounts.parsedCount === pageRawCount &&
      evidence.fetchCounts.validCount === pageRawCount && evidence.fetchCounts.parseDiscardCount === 0 &&
      evidence.fetchCounts.validationDiscardCount === 0 && evidence.fetchLosses.length === 0 &&
      outputJobs.every(job => {
        const expected = job.sourceJobId && lillyOutputs.get(job.sourceJobId);
        const publicEntry = new URL(plan.source.officialEntryUrl); publicEntry.search = "";
        // Reconstruct the entire Lilly record, including absent optional fields.
        // Baseline is a caller-selected crawl mode, not a claim from the source.
        return expected && typeof job.isBaseline === "boolean" && isDeepStrictEqual(job, {
          sourceJobId: expected.sourceJobId, companyId: plan.company.id, sourceId: plan.source.id,
          sourceKind: "SOCIAL", atsKind: "OFFICIAL_JSON", officialChineseCompanyName: plan.company.officialChineseName,
          officialTitle: expected.title, officialUrl: expected.officialUrl, listUrl: publicEntry.toString(),
          locationRaw: expected.locationRaw, cities: expected.cities, category: "其他",
          officialPublishedAt: expected.officialPublishedAt, isBaseline: job.isBaseline,
          evidence: {officialEntryUrl: publicEntry.toString(),
            officialChainEvidenceUrl: plan.source.officialChainEvidenceUrl, capturedAt}
        });
      }))) &&
    (!preserveUcbPostedDate || (ucbOutputs.size === pageRawCount && outputJobs.length === pageRawCount &&
      new Set(outputJobs.map(job => job.sourceJobId)).size === pageRawCount &&
      evidence.fetchCounts.rawCount === pageRawCount && evidence.fetchCounts.parsedCount === pageRawCount &&
      evidence.fetchCounts.validCount === pageRawCount && evidence.fetchCounts.parseDiscardCount === 0 &&
      evidence.fetchCounts.validationDiscardCount === 0 && evidence.fetchLosses.length === 0 &&
      outputJobs.every(job => {
        const expected = job.sourceJobId && ucbOutputs.get(job.sourceJobId);
        return expected && job.companyId === plan.company.id && job.sourceId === plan.source.id &&
          job.evidence.capturedAt === capturedAt && job.officialPublishedAt === expected.officialPublishedAt &&
          job.officialTitle === expected.title && job.officialUrl === expected.officialUrl &&
          job.locationRaw === expected.locationRaw && JSON.stringify(job.cities) === JSON.stringify(expected.cities);
      }))) &&
    (!allowsMainlandAlternative || strictPhenomMainlandAlternativeOutputMatches(
      plan,
      mainlandAlternativeOutputs,
      outputJobs
    ));
}

type StrictUcbDateOutput = {
  rawId: string; sourceJobId: string; officialPublishedAt: string;
  title: string; officialUrl: string; locationRaw: string; cities: string[];
};

/** Reconstruct the date-to-job join from the raw response, independently of the payload adapter. */
function strictUcbDateOutput(value: unknown): StrictUcbDateOutput | undefined {
  const raw = strictRecord(value);
  if (!raw || raw.country !== "China") return undefined;
  const rawId = strictPhenomOfficialId(raw.jobSeqNo) ?? strictPhenomOfficialId(raw.reqId) ?? strictPhenomOfficialId(raw.jobId);
  const title = strictNonblankText(raw.title)?.replace(/\s+/gu, " ");
  const primary = strictPhenomPrimaryLocation(raw);
  const city = strictNonblankText(raw.city);
  const officialPublishedAt = ucbOfficialPostedDate(raw.postedDate);
  if (!rawId || !safeOfficialJsonId(rawId) || !title || !primary || !officialPublishedAt ||
    explicitlyForeignOrNonMainlandLocation(primary) || explicitlyGenericOrAmbiguousLocation(primary) ||
    strictUcbLocationHasAmbiguousSegments(primary) ||
    (city && (explicitlyForeignOrNonMainlandLocation(city) || explicitlyGenericOrAmbiguousLocation(city)))) return undefined;
  const applyUrl = strictNonblankText(raw.applyUrl);
  const reqId = strictPhenomOfficialId(raw.reqId);
  if (!applyUrl && (!reqId || !safeOfficialJsonId(reqId))) return undefined;
  let url: URL;
  try {
    url = new URL(applyUrl ?? `https://careers.ucb.com/global/en/job/${encodeURIComponent(reqId!)}`,
      "https://careers.ucb.com/global/en/job");
  } catch { return undefined; }
  if (url.origin !== "https://careers.ucb.com" || url.username || url.password) return undefined;
  const locationRaw = primary.replace(/\s+/gu, " ");
  const cities = ucbOfficialCities(primary, raw.city);
  if (!cities) return undefined;
  return { rawId, sourceJobId: persistentOfficialJsonJobId(rawId), officialPublishedAt,
    title, officialUrl: url.toString(), locationRaw, cities };
}

function strictUcbLocationHasAmbiguousSegments(value: string): boolean {
  const segments = value.normalize("NFKC").split(/[,，/|;；\r\n>、()（）\-–—]+/u)
    .map(segment => segment.trim()).filter(Boolean);
  if (segments.length < 2 || segments.some(segment =>
    /^(?:china|prc|chn|mainland china|china mainland|中国|中国大陆|中华人民共和国)$/iu.test(segment))) return false;
  const mainland = /(?:中华人民共和国|中国大陆|中国|大陆|china|prc|people'?s republic of china|mainland china|上海|北京|广州|深圳|成都|杭州|南京|苏州|武汉|天津|重庆|西安|兰州|太原)/iu;
  const locality = /^(?:cn|chn|shanghai|beijing|guangzhou|shenzhen|chengdu|hangzhou|nanjing|suzhou|wuhan|tianjin|chongqing|xi'?an|jiangsu|zhejiang|guangdong|sichuan|hubei|hunan|henan|hebei|shandong|fujian|anhui|jiangxi|liaoning|jilin|heilongjiang|shanxi|shaanxi|yunnan|guizhou|gansu|qinghai|hainan|内蒙古|广西|宁夏|新疆|西藏)$/iu;
  return segments.some(segment => !explicitlyForeignOrNonMainlandLocation(segment) &&
    !mainland.test(segment) && !locality.test(segment));
}

function strictPhenomOfficialId(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return strictNonblankText(value);
}

function strictPhenomRecordHasGenericLocation(record: Record<string, unknown>): boolean {
  const locations = [record.location, record.cityStateCountry, record.city];
  if (Array.isArray(record.multi_location)) locations.push(...record.multi_location);
  return locations.some((value) => {
    const location = strictNonblankText(value);
    return location !== undefined && explicitlyGenericOrAmbiguousLocation(location);
  });
}

type StrictPhenomMainlandAlternativeOutput = {
  sourceJobId: string;
  locationRaw: string;
  cities: string[];
};

const STRICT_PHENOM_MAINLAND_LOCATIONS: ReadonlyArray<readonly [string, string]> = [
  ["shanghai", "上海"], ["beijing", "北京"], ["changchun", "长春"], ["chongqing", "重庆"],
  ["daqing", "大庆"], ["suzhou", "苏州"], ["dongguan", "东莞"], ["shenzhen", "深圳"],
  ["guangzhou", "广州"], ["hangzhou", "杭州"], ["kashi", "喀什"], ["leshan", "乐山"],
  ["nanjing", "南京"], ["nanning", "南宁"], ["nantong", "南通"], ["ningde", "宁德"],
  ["songyuan", "松原"], ["wuhan", "武汉"], ["chengdu", "成都"], ["urumqi", "乌鲁木齐"],
  ["wulumuqi", "乌鲁木齐"], ["wenzhou", "温州"], ["tonghua", "通化"], ["xining", "西宁"],
  ["zhuhai", "珠海"], ["tianjin", "天津"], ["lanzhou", "兰州"], ["jiangsu", "江苏"],
  ["上海", "上海"], ["北京", "北京"], ["长春", "长春"], ["重庆", "重庆"], ["大庆", "大庆"],
  ["苏州", "苏州"], ["东莞", "东莞"], ["深圳", "深圳"], ["广州", "广州"], ["杭州", "杭州"],
  ["喀什", "喀什"], ["乐山", "乐山"], ["南京", "南京"], ["宁德", "宁德"], ["松原", "松原"],
  ["武汉", "武汉"], ["成都", "成都"], ["乌鲁木齐", "乌鲁木齐"], ["通化", "通化"],
  ["西宁", "西宁"], ["天津", "天津"], ["兰州", "兰州"]
];

const STRICT_PHENOM_MAINLAND_COUNTRY_SEGMENTS = new Set([
  "china", "mainland china", "china mainland", "prc", "cn", "chn", "中国", "中国大陆", "中华人民共和国"
]);

const STRICT_PHENOM_MAINLAND_PROVINCES = new Map([
  ["anhui", "安徽"], ["fujian", "福建"], ["gansu", "甘肃"], ["guangdong", "广东"],
  ["guizhou", "贵州"], ["hainan", "海南"], ["hebei", "河北"], ["heilongjiang", "黑龙江"],
  ["henan", "河南"], ["hubei", "湖北"], ["hunan", "湖南"], ["jiangsu", "江苏"],
  ["jiangxi", "江西"], ["jilin", "吉林"], ["liaoning", "辽宁"], ["qinghai", "青海"],
  ["shaanxi", "陕西"], ["shandong", "山东"], ["shanxi", "山西"], ["sichuan", "四川"],
  ["yunnan", "云南"], ["zhejiang", "浙江"], ["guangxi", "广西"], ["inner mongolia", "内蒙古"],
  ["ningxia", "宁夏"], ["tibet", "西藏"], ["xinjiang", "新疆"],
  ["安徽", "安徽"], ["福建", "福建"], ["甘肃", "甘肃"], ["广东", "广东"], ["贵州", "贵州"],
  ["海南", "海南"], ["河北", "河北"], ["黑龙江", "黑龙江"], ["河南", "河南"], ["湖北", "湖北"],
  ["湖南", "湖南"], ["江苏", "江苏"], ["江西", "江西"], ["吉林", "吉林"], ["辽宁", "辽宁"],
  ["青海", "青海"], ["陕西", "陕西"], ["山东", "山东"], ["山西", "山西"], ["四川", "四川"],
  ["云南", "云南"], ["浙江", "浙江"], ["广西", "广西"], ["内蒙古", "内蒙古"], ["宁夏", "宁夏"],
  ["西藏", "西藏"], ["新疆", "新疆"]
]);

const STRICT_PHENOM_EXPLICIT_FOREIGN_COUNTRY_SEGMENTS = new Set([
  "singapore", "新加坡", "switzerland", "瑞士", "hong kong", "hong kong sar",
  "香港", "macau", "macao", "澳门", "taiwan", "台湾", "united kingdom", "uk", "英国",
  "united states", "united states of america", "usa", "us", "美国", "germany", "德国", "france", "法国",
  "japan", "日本", "south korea", "korea", "韩国", "india", "印度", "canada", "加拿大",
  "australia", "澳大利亚", "poland", "波兰", "malaysia", "马来西亚"
]);

function strictPhenomRecordMatchesCountryFacet(
  record: Record<string, unknown> | undefined,
  expectedCountry: string,
  allowMainlandAlternative: boolean
): boolean {
  if (!record) return false;
  if (record.country === expectedCountry) return true;
  return allowMainlandAlternative && strictPhenomMainlandAlternative(record) !== undefined;
}

function strictExactRochePhenomPlan(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  pageConfig: StrictGatePhenomConfig,
  endpoint: string
): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "phenom" || !config.facetScope) return false;
  const facet = config.facetScope;
  if ("exclusionFacet" in facet && facet.exclusionFacet !== undefined) return false;
  const fields = plan.json.fields;
  return plan.company.id === "company-roche-china" && plan.company.officialChineseName === "罗氏制药中国" &&
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
    facet.countryIncludeDescriptor === "中国大陆" &&
    JSON.stringify(facet.categoryExcludeDescriptors) === JSON.stringify([]) &&
    config.countryFilter === undefined && config.allowedEntryRedirect === undefined &&
    config.allowOmittedOffsetForSinglePage === undefined &&
    config.mixedLocationScopePolicy === "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1" &&
    config.requestBoundOmittedOffsetPolicy === "ROCHE_REQUEST_BOUND_OMITTED_OFFSET_V1" &&
    config.exactDuplicateReconciliationPolicy === "ROCHE_IDENTICAL_CROSS_PAGE_V1" &&
    (config.nativeDetailPolicy === undefined ? fields.officialPublishedAt === undefined :
      config.nativeDetailPolicy === ROCHE_NATIVE_DETAIL_POLICY && fields.officialPublishedAt === "officialPublishedAt") &&
    (config.pageSize === 100 || config.pageSize === 250) && config.maxPages === 10 &&
    endpoint === "https://careers.roche.com/widgets" &&
    pageConfig.widgetApiEndpoint === "https://careers.roche.com/widgets" &&
    pageConfig.country === "cn" && pageConfig.deviceType === "desktop" &&
    pageConfig.locale === "zh_cn" && pageConfig.refNum === "ROCHGLOBAL" &&
    pageConfig.pageName === "search-results" && pageConfig.pageId === "page11-ds";
}

function strictExactMerckHealthcarePhenomPlan(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  pageConfig: StrictGatePhenomConfig,
  endpoint: string
): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "phenom" || !config.facetScope) return false;
  const facet = config.facetScope;
  const fields = plan.json.fields;
  return "partitionProofPolicy" in facet && facet.partitionProofPolicy === "MERCK_HEALTHCARE_PARTITION_V1" &&
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
    endpoint === "https://careers.emdgroup.com/widgets" &&
    pageConfig.widgetApiEndpoint === "https://careers.emdgroup.com/widgets" &&
    pageConfig.country === "us" && pageConfig.deviceType === "desktop" &&
    pageConfig.locale === "en_us" && pageConfig.refNum === "MQAEGZUS" &&
    pageConfig.pageName === "search-results" && pageConfig.pageId === "page18-ds";
}

function strictPhenomPrimaryLocation(record: Record<string, unknown>): string | undefined {
  return strictNonblankText(record.location) ?? strictNonblankText(record.cityStateCountry) ??
    strictNonblankText(record.city);
}

function strictPhenomMainlandAlternative(
  record: Record<string, unknown>
): Omit<StrictPhenomMainlandAlternativeOutput, "sourceJobId"> | undefined {
  const primary = strictPhenomPrimaryLocation(record);
  const country = strictNonblankText(record.country);
  const city = strictNonblankText(record.city);
  if (!primary || !country || !strictPhenomExplicitForeignLocation(primary) ||
    !strictPhenomExplicitForeignLocation(country) ||
    (city !== undefined && !strictPhenomForeignLocality(city)) ||
    !Array.isArray(record.multi_location) || record.multi_location.length < 2) return undefined;

  const candidates = record.multi_location.map(strictNonblankText);
  if (candidates.some((candidate) => candidate === undefined)) return undefined;
  const exact = candidates as string[];
  if (new Set(exact.map(strictPhenomLocationKey)).size !== exact.length ||
    !exact.some((candidate) => strictPhenomLocationKey(candidate) === strictPhenomLocationKey(primary))) return undefined;

  const mainland: Array<{ locationRaw: string; cities: string[] }> = [];
  for (const candidate of exact) {
    const cities = strictPhenomMainlandLocationCities(candidate);
    if (cities) mainland.push({ locationRaw: candidate, cities });
    else if (!strictPhenomExplicitForeignLocation(candidate)) return undefined;
  }
  return mainland.length === 1 ? mainland[0] : undefined;
}

function strictPhenomMainlandLocationCities(value: string): string[] | undefined {
  if (explicitlyForeignOrNonMainlandLocation(value)) return undefined;
  const rawSegments = strictPhenomRawLocationSegments(value);
  const segments = rawSegments.map((segment) => segment.toLocaleLowerCase("en-US"));
  if (segments.length === 0) return undefined;
  const cities: string[] = [];
  const provinces: string[] = [];
  const unknown: string[] = [];
  let countrySegmentCount = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (STRICT_PHENOM_MAINLAND_COUNTRY_SEGMENTS.has(segment)) continue;
    const city = STRICT_PHENOM_MAINLAND_LOCATIONS.find(([candidate]) => candidate === segment)?.[1];
    if (city) {
      if (!cities.includes(city)) cities.push(city);
    } else if (STRICT_PHENOM_MAINLAND_PROVINCES.has(segment)) {
      const province = STRICT_PHENOM_MAINLAND_PROVINCES.get(segment)!;
      if (!provinces.includes(province)) provinces.push(province);
    } else {
      unknown.push(rawSegments[index]!);
    }
  }
  for (const segment of segments) {
    if (STRICT_PHENOM_MAINLAND_COUNTRY_SEGMENTS.has(segment)) countrySegmentCount += 1;
  }
  if (unknown.length === 0) return cities.length > 0 ? cities : provinces.length === 1 ? provinces : undefined;
  if (countrySegmentCount === 1 && cities.length === 1 && unknown.length === 1 &&
    strictPhenomMainlandSubCitySegment(unknown[0]!)) return cities;
  if (countrySegmentCount === 1 && cities.length === 0 && unknown.length === 1 && provinces.length <= 1) {
    const firstNonCountry = rawSegments.find((_, index) =>
      !STRICT_PHENOM_MAINLAND_COUNTRY_SEGMENTS.has(segments[index]!));
    return firstNonCountry === unknown[0] ? [unknown[0]!] : undefined;
  }
  const nonCountryCount = segments.length - countrySegmentCount;
  return countrySegmentCount === 1 && nonCountryCount === 1 && cities.length === 0 && unknown.length === 1
    ? [unknown[0]!]
    : undefined;
}

function strictPhenomMainlandSubCitySegment(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  return /^(?=.{1,80}$)[\p{L}\p{M}.'’ -]+\s(?:district|new district)$/iu.test(normalized) ||
    /^(?=.{2,20}$)[\p{Script=Han}]+(?:区|新区)$/u.test(normalized);
}

function strictPhenomExplicitForeignLocation(value: string): boolean {
  if (explicitlyGenericOrAmbiguousLocation(value)) return false;
  const segments = strictPhenomLocationSegments(value);
  if (segments.length === 0 || segments.some(strictPhenomMainlandSegment)) return false;
  return segments.some((segment) => STRICT_PHENOM_EXPLICIT_FOREIGN_COUNTRY_SEGMENTS.has(segment));
}

function strictPhenomForeignLocality(value: string): boolean {
  if (explicitlyGenericOrAmbiguousLocation(value)) return false;
  const segments = strictPhenomLocationSegments(value);
  return segments.length > 0 && !segments.some(strictPhenomMainlandSegment);
}

function strictPhenomMainlandSegment(segment: string): boolean {
  return STRICT_PHENOM_MAINLAND_COUNTRY_SEGMENTS.has(segment) ||
    STRICT_PHENOM_MAINLAND_LOCATIONS.some(([candidate]) => candidate === segment);
}

function strictPhenomLocationSegments(value: string): string[] {
  return strictPhenomRawLocationSegments(value)
    .map((segment) => segment.toLocaleLowerCase("en-US"));
}

function strictPhenomRawLocationSegments(value: string): string[] {
  return value.normalize("NFKC").trim()
    .split(/\s*[,，/／|｜;；、()（）\-–—]\s*/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function strictPhenomLocationKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en-US");
}

function strictPhenomPersistentSourceJobId(rawId: string): string {
  const sha256 = createHash("sha256").update(JSON.stringify(rawId), "utf8").digest("hex");
  return `official-json:sha256:${sha256}`;
}

function strictPhenomMainlandAlternativeOutputMatches(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  expected: ReadonlyMap<string, StrictPhenomMainlandAlternativeOutput>,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  for (const value of expected.values()) {
    const matches = outputJobs.filter((job) => job.sourceJobId === value.sourceJobId);
    if (matches.length !== 1) return false;
    const output = matches[0]!;
    if (output.companyId !== plan.company.id || output.sourceId !== plan.source.id ||
      output.locationRaw !== value.locationRaw || JSON.stringify(output.cities) !== JSON.stringify(value.cities)) {
      return false;
    }
  }
  return true;
}

type StrictGatePhenomConfig = {
  widgetApiEndpoint: string; refNum: string; locale: string; deviceType: string;
  country: string; pageName: string; pageId: string;
};

type StrictGatePhenomFacetScope = {
  countryIncludeDescriptor: string;
  countryOnly: boolean;
  exclusionField: "category" | "jobLevelId" | "type";
  exclusionDescriptors: string[];
  requireGlobalDescriptorProof: boolean;
  includeField?: "businessSector";
  includeDescriptor?: string;
  partitionProofPolicy?: "MERCK_HEALTHCARE_PARTITION_V1";
};

type StrictGatePhenomFacetEnvelope = {
  totalHits: number;
  jobs: unknown[];
  aggregations: unknown[];
  hasOwnFrom: boolean;
  from?: number;
};

function strictGatePhenomFacetScope(
  value: Extract<NonNullable<Extract<SourceCrawlPlan, { adapterId: "official-json" }>["officialJsonFetch"]>, { kind: "phenom" }>["facetScope"]
): StrictGatePhenomFacetScope | undefined {
  if (!value || typeof value.countryIncludeDescriptor !== "string" ||
    !value.countryIncludeDescriptor.trim() ||
    value.countryIncludeDescriptor.trim() !== value.countryIncludeDescriptor) return undefined;
  const modern = "exclusionFacet" in value && value.exclusionFacet !== undefined;
  const field = modern ? value.exclusionFacet.field : "category";
  const descriptors = modern ? value.exclusionFacet.descriptors : value.categoryExcludeDescriptors;
  if (!["category", "jobLevelId", "type"].includes(field) || !Array.isArray(descriptors) ||
    (modern && descriptors.length === 0) ||
    (descriptors.length > 0 && !strictUniqueNonblankStrings(descriptors))) return undefined;
  const partitioned = "partitionProofPolicy" in value &&
    value.partitionProofPolicy === "MERCK_HEALTHCARE_PARTITION_V1";
  const includeFacet = "includeFacet" in value ? value.includeFacet : undefined;
  if (partitioned && (includeFacet?.field !== "businessSector" ||
    typeof includeFacet.descriptor !== "string" || !includeFacet.descriptor.trim() ||
    includeFacet.descriptor.trim() !== includeFacet.descriptor)) return undefined;
  if (!partitioned && includeFacet !== undefined) return undefined;
  return {
    countryIncludeDescriptor: value.countryIncludeDescriptor,
    countryOnly: descriptors.length === 0,
    exclusionField: field,
    exclusionDescriptors: [...descriptors],
    requireGlobalDescriptorProof: modern && !partitioned,
    ...(partitioned ? {
      includeField: "businessSector" as const,
      includeDescriptor: includeFacet!.descriptor,
      partitionProofPolicy: "MERCK_HEALTHCARE_PARTITION_V1" as const
    } : {})
  };
}

function strictGatePhenomFacetEnvelope(
  body: string | Uint8Array,
  expectedUiSelections?: Record<string, string[]>
): StrictGatePhenomFacetEnvelope | undefined {
  const root = strictUniqueJsonRecord(body);
  const refineSearch = strictRecord(root?.refineSearch);
  const data = strictRecord(refineSearch?.data);
  if (!refineSearch || !data || !strictNonnegativeInteger(refineSearch.totalHits) ||
    !Array.isArray(data.jobs) || !Array.isArray(data.aggregations)) return undefined;
  if (expectedUiSelections !== undefined &&
    !strictGateExactPhenomUiSelections(data, expectedUiSelections)) return undefined;
  const hasOwnFrom = Object.prototype.hasOwnProperty.call(refineSearch, "from");
  if (hasOwnFrom && !strictNonnegativeInteger(refineSearch.from)) return undefined;
  return {
    totalHits: refineSearch.totalHits,
    jobs: data.jobs,
    aggregations: data.aggregations,
    hasOwnFrom,
    ...(hasOwnFrom ? { from: refineSearch.from as number } : {})
  };
}

function strictGatePhenomAggregation(
  aggregations: readonly unknown[],
  field: string
): Map<string, number> | undefined {
  const matches = aggregations.filter((candidate) => strictRecord(candidate)?.field === field);
  const value = matches.length === 1 ? strictRecord(strictRecord(matches[0])?.value) : undefined;
  if (!value) return undefined;
  const parsed = new Map<string, number>();
  for (const [descriptor, count] of Object.entries(value)) {
    if (!descriptor.trim() || descriptor.trim() !== descriptor ||
      !strictNonnegativeInteger(count) || parsed.has(descriptor)) return undefined;
    parsed.set(descriptor, count);
  }
  return parsed;
}

function strictGateExactPhenomUiSelections(
  data: Record<string, unknown>,
  selectedFields: Record<string, string[]>
): boolean {
  const expectedKeys = Object.keys(selectedFields);
  const hasUiSelections = Object.prototype.hasOwnProperty.call(data, "ui_selections");
  if (expectedKeys.length === 0) {
    if (!hasUiSelections) return true;
    const empty = strictRecord(data.ui_selections);
    return Boolean(empty) && Object.keys(empty!).length === 0;
  }
  const uiSelections = hasUiSelections ? strictRecord(data.ui_selections) : undefined;
  if (!uiSelections) return false;
  const actualKeys = Object.keys(uiSelections);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key) =>
    !Object.prototype.hasOwnProperty.call(selectedFields, key))) return false;
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

type StrictMerckPartitionReplay = {
  selectedFields: Record<string, string[]>;
  expectedRawIds: Set<string>;
  allowedJobLevels: Set<string>;
  expectedTotal: number;
};

function strictReplayMerckHealthcarePartitions(input: {
  artifacts: Map<string, PersistentSourceFetchEvidence["artifacts"][number]>;
  facetArtifacts: PersistentSourceFetchEvidence["artifacts"];
  endpoint: string;
  pageConfig: StrictGatePhenomConfig;
  pageSize: number;
  maxPages: number;
  allowOmittedOffsetForSinglePage: boolean;
  facetScope: StrictGatePhenomFacetScope;
}): StrictMerckPartitionReplay | undefined {
  const { artifacts, endpoint, pageConfig, pageSize, maxPages, facetScope,
    allowOmittedOffsetForSinglePage } = input;
  if (facetScope.partitionProofPolicy !== "MERCK_HEALTHCARE_PARTITION_V1" ||
    facetScope.includeField !== "businessSector" || !facetScope.includeDescriptor ||
    facetScope.exclusionField !== "jobLevelId") return undefined;
  const used = new Set<string>();
  const global = artifacts.get("phenom-facet-global");
  const country = artifacts.get("phenom-facet-country");
  if (!global || !country || global.bodyRepresentation === "REDACTED" ||
    country.bodyRepresentation === "REDACTED" ||
    !strictRequestContractMatches(global.extractorLocator, {
      family: "phenom", role: "facet-preflight-global", method: "POST", url: endpoint,
      body: strictGatePhenomRequestBody(pageConfig, pageSize, 0, {}, true),
      coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
    }) || !strictRequestContractMatches(country.extractorLocator, {
      family: "phenom", role: "facet-preflight-country", method: "POST", url: endpoint,
      body: strictGatePhenomRequestBody(pageConfig, pageSize, 0, {
        country: [facetScope.countryIncludeDescriptor]
      }, true),
      coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
    })) return undefined;
  used.add(global.logicalKey);
  used.add(country.logicalKey);
  const globalEnvelope = strictGatePhenomFacetEnvelope(global.body, {});
  const countryEnvelope = strictGatePhenomFacetEnvelope(country.body, {
    country: [facetScope.countryIncludeDescriptor]
  });
  if (!globalEnvelope || !countryEnvelope) return undefined;
  const countries = strictGatePhenomAggregation(globalEnvelope.aggregations, "country");
  const countryTotal = countries?.get(facetScope.countryIncludeDescriptor);
  if (countryTotal === undefined || countryEnvelope.totalHits !== countryTotal ||
    countryEnvelope.jobs.some((job) => strictRecord(job)?.country !== facetScope.countryIncludeDescriptor)) {
    return undefined;
  }
  const sectors = strictGatePhenomAggregation(countryEnvelope.aggregations, facetScope.includeField);
  if (!sectors || !sectors.has(facetScope.includeDescriptor) ||
    [...sectors.values()].reduce((sum, count) => sum + count, 0) !== countryTotal) return undefined;

  const replayPartition = (
    family: "business-sector" | "job-level",
    partitionIndex: number,
    selectedFields: Record<string, string[]>,
    expectedTotal: number,
    optionalExactFields: Array<{ field: string; descriptor: string }>
  ): { ids: Set<string>; firstEnvelope: StrictGatePhenomFacetEnvelope } | undefined => {
    const ids = new Set<string>();
    let firstEnvelope: StrictGatePhenomFacetEnvelope | undefined;
    const expectedPages = Math.max(1, Math.ceil(expectedTotal / pageSize));
    if (expectedPages > maxPages) return undefined;
    for (let pageIndex = 0; pageIndex < expectedPages; pageIndex += 1) {
      const key = `phenom-facet-proof-${family}-${String(partitionIndex).padStart(4, "0")}-${String(pageIndex).padStart(4, "0")}`;
      const artifact = artifacts.get(key);
      const from = pageIndex * pageSize;
      if (!artifact || artifact.bodyRepresentation === "REDACTED" ||
        !strictRequestContractMatches(artifact.extractorLocator, {
          family: "phenom", role: `facet-partition-${family}`, method: "POST", url: endpoint,
          body: strictGatePhenomRequestBody(pageConfig, pageSize, from, selectedFields, true),
          coordinate: {
            sequence: pageIndex,
            requestedOffset: from,
            requestedPage: null,
            requestedPageSize: pageSize
          }
        })) return undefined;
      used.add(key);
      const envelope = strictGatePhenomFacetEnvelope(artifact.body, selectedFields);
      const safelyOmittedSinglePageOffset = allowOmittedOffsetForSinglePage && !envelope?.hasOwnFrom &&
        pageIndex === 0 && from === 0 && expectedTotal <= pageSize;
      if (!envelope || envelope.totalHits !== expectedTotal ||
        (!safelyOmittedSinglePageOffset && (!envelope.hasOwnFrom || envelope.from !== from)) ||
        envelope.jobs.length !== Math.min(pageSize, expectedTotal - from)) return undefined;
      firstEnvelope ??= envelope;
      for (const raw of envelope.jobs) {
        const record = strictRecord(raw);
        const id = strictNonblankText(record?.jobSeqNo) ?? strictNonblankText(record?.reqId) ??
          strictNonblankText(record?.jobId);
        if (!record || record.country !== facetScope.countryIncludeDescriptor || !id ||
          !safeOfficialJsonId(id) || ids.has(id)) return undefined;
        for (const exact of optionalExactFields) {
          const present = strictNonblankText(record[exact.field]);
          if (present !== undefined && present !== exact.descriptor) return undefined;
        }
        ids.add(id);
      }
    }
    return firstEnvelope && ids.size === expectedTotal ? { ids, firstEnvelope } : undefined;
  };

  const allSectorIds = new Set<string>();
  let healthcare: { ids: Set<string>; firstEnvelope: StrictGatePhenomFacetEnvelope } | undefined;
  const sortedSectors = [...sectors.keys()].sort();
  for (let index = 0; index < sortedSectors.length; index += 1) {
    const descriptor = sortedSectors[index]!;
    const replayed = replayPartition("business-sector", index, {
      country: [facetScope.countryIncludeDescriptor],
      [facetScope.includeField]: [descriptor]
    }, sectors.get(descriptor)!, [{ field: facetScope.includeField, descriptor }]);
    if (!replayed) return undefined;
    for (const id of replayed.ids) {
      if (allSectorIds.has(id)) return undefined;
      allSectorIds.add(id);
    }
    if (descriptor === facetScope.includeDescriptor) healthcare = replayed;
  }
  if (!healthcare || allSectorIds.size !== countryTotal) return undefined;
  const jobLevels = strictGatePhenomAggregation(healthcare.firstEnvelope.aggregations, facetScope.exclusionField);
  if (!jobLevels || [...jobLevels.values()].reduce((sum, count) => sum + count, 0) !== healthcare.ids.size) {
    return undefined;
  }
  const allHealthcareIds = new Set<string>();
  const expectedRawIds = new Set<string>();
  const allowedJobLevels = new Set<string>();
  const sortedJobLevels = [...jobLevels.keys()].sort();
  for (let index = 0; index < sortedJobLevels.length; index += 1) {
    const descriptor = sortedJobLevels[index]!;
    const replayed = replayPartition("job-level", index, {
      country: [facetScope.countryIncludeDescriptor],
      [facetScope.includeField]: [facetScope.includeDescriptor],
      [facetScope.exclusionField]: [descriptor]
    }, jobLevels.get(descriptor)!, [
      { field: facetScope.includeField, descriptor: facetScope.includeDescriptor },
      { field: facetScope.exclusionField, descriptor }
    ]);
    if (!replayed) return undefined;
    const allowed = !facetScope.exclusionDescriptors.includes(descriptor);
    if (allowed) allowedJobLevels.add(descriptor);
    for (const id of replayed.ids) {
      if (allHealthcareIds.has(id)) return undefined;
      allHealthcareIds.add(id);
      if (allowed) expectedRawIds.add(id);
    }
  }
  if (allowedJobLevels.size === 0 || allHealthcareIds.size !== healthcare.ids.size ||
    [...healthcare.ids].some((id) => !allHealthcareIds.has(id)) ||
    input.facetArtifacts.length !== used.size || input.facetArtifacts.some((artifact) => !used.has(artifact.logicalKey))) {
    return undefined;
  }
  return {
    selectedFields: {
      country: [facetScope.countryIncludeDescriptor],
      [facetScope.includeField]: [facetScope.includeDescriptor],
      [facetScope.exclusionField]: [...allowedJobLevels].sort()
    },
    expectedRawIds,
    allowedJobLevels,
    expectedTotal: expectedRawIds.size
  };
}

function strictGatePhenomPageConfig(body: string | Uint8Array): StrictGatePhenomConfig | undefined {
  const html = typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  const candidates: StrictGatePhenomConfig[] = [];
  const pageIdAssignments: string[] = [];
  const $ = load(html);
  for (const script of $("script").toArray()) {
    const content = $(script).html() ?? "";
    const rawType = ($(script).attr("type") ?? "").trim().toLowerCase();
    const essence = rawType.split(";", 1)[0]!.trim();
    if (essence === "application/json") {
      if (!content.trim()) continue;
      const root = strictUniqueJsonRecord(content);
      if (!root || !Object.prototype.hasOwnProperty.call(root, "phApp")) {
        if (/\bphApp\b/u.test(content)) return undefined;
        continue;
      }
      const config = strictGatePhenomConfigRecord(strictRecord(root.phApp));
      if (!config) return undefined;
      candidates.push(config);
      continue;
    }
    if (rawType && !["module", "text/javascript", "application/javascript"].includes(essence)) continue;
    const parsed = strictGatePhenomJavaScriptConfigs(content, rawType === "module" ? "module" : "script");
    if (!parsed) return undefined;
    candidates.push(...parsed.configs);
    pageIdAssignments.push(...parsed.pageIdAssignments);
  }
  if (candidates.length !== 1) return undefined;
  const candidate = candidates[0]!;
  if (pageIdAssignments.length > 1) return undefined;
  if (pageIdAssignments.length === 1) {
    const assigned = pageIdAssignments[0]!;
    if (assigned !== candidate.pageId &&
      (!assigned.endsWith("-ds") || assigned.slice(0, -3) !== candidate.pageId || candidate.pageId.endsWith("-ds"))) {
      return undefined;
    }
    return { ...candidate, pageId: assigned };
  }
  return candidate;
}

function strictGatePhenomJavaScriptConfigs(
  script: string,
  sourceType: "script" | "module"
): { configs: StrictGatePhenomConfig[]; pageIdAssignments: string[] } | undefined {
  let program: ReturnType<typeof parseJavaScript>;
  try {
    program = parseJavaScript(script, {
      sourceType,
      allowAwaitOutsideFunction: false,
      allowReturnOutsideFunction: false,
      errorRecovery: false
    });
  } catch {
    return /\bphApp\b/u.test(script) ? undefined : { configs: [], pageIdAssignments: [] };
  }
  const candidates: StrictGatePhenomConfig[] = [];
  const pageIdAssignments: string[] = [];
  const allowedBindings = new Set<object>();
  for (const statement of program.program.body) {
    if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations) {
        if (declaration.id.type !== "Identifier" || declaration.id.name !== "phApp") continue;
        const object = declaration.init?.type === "ObjectExpression"
          ? declaration.init
          : declaration.init?.type === "LogicalExpression" &&
              declaration.init.operator === "||" &&
              declaration.init.left.type === "Identifier" &&
              declaration.init.left.name === "phApp" &&
              declaration.init.right.type === "ObjectExpression"
            ? declaration.init.right
            : undefined;
        if (!object) return undefined;
        const config = strictGatePhenomConfigObject(object);
        if (!config) return undefined;
        candidates.push(config);
        allowedBindings.add(declaration);
      }
      continue;
    }
    if (statement.type !== "ExpressionStatement" ||
      statement.expression.type !== "AssignmentExpression") continue;
    const assignment = statement.expression;
    if (strictGatePhenomStandalonePageIdTarget(assignment.left)) {
      if (assignment.operator !== "=" || assignment.right.type !== "StringLiteral" ||
        !assignment.right.value || assignment.right.value.trim() !== assignment.right.value) return undefined;
      pageIdAssignments.push(assignment.right.value);
      allowedBindings.add(assignment);
      continue;
    }
    if (!strictGatePhenomRootTarget(assignment.left)) continue;
    if (assignment.operator !== "=" || assignment.right.type !== "ObjectExpression") return undefined;
    const config = strictGatePhenomConfigObject(assignment.right);
    if (!config) return undefined;
    candidates.push(config);
    allowedBindings.add(assignment);
  }
  if (strictGatePhenomHasUnsafeBinding(program.program, allowedBindings)) return undefined;
  return { configs: candidates, pageIdAssignments };
}

function strictGatePhenomConfigObject(object: ObjectExpression): StrictGatePhenomConfig | undefined {
  const required = new Set([
    "widgetApiEndpoint", "refNum", "locale", "deviceType", "country", "pageName", "pageId"
  ]);
  const value: Record<string, string> = {};
  for (const property of object.properties) {
    if (property.type !== "ObjectProperty" || property.computed) return undefined;
    const key = property.key.type === "Identifier"
      ? property.key.name
      : property.key.type === "StringLiteral"
        ? property.key.value
        : undefined;
    if (!key || !required.has(key)) continue;
    if (key in value || property.value.type !== "StringLiteral" ||
      !property.value.value || property.value.value.trim() !== property.value.value) return undefined;
    value[key] = property.value.value;
  }
  return strictGatePhenomConfigRecord(value);
}

function strictGatePhenomConfigRecord(
  value: Record<string, unknown> | undefined
): StrictGatePhenomConfig | undefined {
  if (!value) return undefined;
  const keys = [
    "widgetApiEndpoint", "refNum", "locale", "deviceType", "country", "pageName", "pageId"
  ] as const;
  if (!keys.every((key) => typeof value[key] === "string" &&
    (value[key] as string).length > 0 &&
    (value[key] as string).trim() === value[key])) return undefined;
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as StrictGatePhenomConfig;
}

function strictGatePhenomRootTarget(value: unknown): boolean {
  const target = strictRecord(value);
  if (target?.type === "Identifier") return target.name === "phApp";
  if (target?.type !== "MemberExpression" || target.computed === true) return false;
  const object = strictRecord(target.object);
  const property = strictRecord(target.property);
  return object?.type === "Identifier" &&
    ["window", "globalThis"].includes(String(object.name)) &&
    property?.type === "Identifier" && property.name === "phApp";
}

function strictGatePhenomPageIdTarget(value: unknown): boolean {
  const target = strictRecord(value);
  if (target?.type !== "MemberExpression" || target.computed === true) return false;
  const property = strictRecord(target.property);
  return property?.type === "Identifier" && property.name === "pageId" &&
    strictGatePhenomRootTarget(target.object);
}

function strictGatePhenomStandalonePageIdTarget(value: unknown): boolean {
  const target = strictRecord(value);
  if (target?.type !== "MemberExpression" || target.computed === true) return false;
  const object = strictRecord(target.object);
  const property = strictRecord(target.property);
  return object?.type === "Identifier" && object.name === "phApp" &&
    property?.type === "Identifier" && property.name === "pageId";
}

function strictGatePhenomHasUnsafeBinding(
  value: unknown,
  allowedBindings: ReadonlySet<object>
): boolean {
  if (Array.isArray(value)) return value.some((child) =>
    strictGatePhenomHasUnsafeBinding(child, allowedBindings));
  const record = strictRecord(value);
  if (!record) return false;
  if (record.type === "VariableDeclarator") {
    const id = strictRecord(record.id);
    if (id?.type === "Identifier" && id.name === "phApp" && !allowedBindings.has(record)) return true;
  }
  if (record.type === "AssignmentExpression") {
    if (strictGatePhenomPageIdTarget(record.left) && !allowedBindings.has(record)) return true;
    if (strictGatePhenomRootTarget(record.left) && !allowedBindings.has(record)) return true;
  }
  return Object.entries(record).some(([key, child]) =>
    key !== "loc" && key !== "start" && key !== "end" &&
    strictGatePhenomHasUnsafeBinding(child, allowedBindings));
}

function strictGatePhenomRequestBody(
  config: StrictGatePhenomConfig,
  size: number,
  from: number,
  selectedFields: Record<string, string[]>,
  includeBusinessSector = false
): Record<string, unknown> {
  return {
    lang: config.locale, locale: config.locale, deviceType: config.deviceType, country: config.country,
    pageName: config.pageName, size, from, jobs: true, counts: true,
    all_fields: [
      "category", "country", "state", "city", "type", "jobLevelId",
      ...(includeBusinessSector ? ["businessSector"] : [])
    ],
    clearAll: false, jdsource: "facets", isSliderEnable: false, pageId: config.pageId,
    siteType: "external", keywords: "", global: true, selected_fields: selectedFields,
    sort: { order: "desc", field: "postedDate" }, locationData: {}, refNum: config.refNum, ddoKey: "refineSearch"
  };
}

const STRICT_GATE_BEISEN_DISPLAY_FIELDS = [
  "Category", "Kind", "LocId", "Salary", "Degree", "YearsOfWorking", "ClassificationOne", "WorkWeChatQrCode"
] as const;

function strictBeisenRequestContracts(plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>, evidence: PersistentSourceFetchEvidence, outputJobs: readonly NormalizedJobRecord[]): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "beisen-zhiye-2022") return false;
  if (requiresHansohNativeWindowReplay(plan)) {
    return validateStrictHansohNativeWindowEvidence(plan, evidence, outputJobs);
  }
  const exactShanghaiSiblingPolicy = strictExactShanghaiPharmaBeisenPlan(plan);
  if (config.mixedLocationPolicy === "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS" &&
    !exactShanghaiSiblingPolicy) return false;
  const pageSize = Math.max(1, Math.min(100, config.pageSize ?? 100));
  const endpoint = new URL("/api/Jobad/GetJobAdPageList", plan.source.officialEntryUrl).toString();
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  for (const page of evidence.pages) {
    const expected = { sequence: page.sequence, requestedCursor: null, requestedOffset: null,
      requestedPage: page.sequence, requestedPageSize: pageSize };
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || !strictPageCoordinatesEqual(page, expected)) return false;
    const artifact = artifacts.get(page.artifactLogicalKey);
    if (exactShanghaiSiblingPolicy && artifact?.bodyRepresentation !== "EXACT") return false;
    if (!artifact || !strictRequestContractMatches(artifact.extractorLocator, {
      family: "beisen", role: "page", method: "POST", url: endpoint,
      body: { PageIndex: page.sequence, PageSize: pageSize, Category: [config.category ?? "1"], KeyWords: "",
        SpecialType: 0, PortalId: "", DisplayFields: config.displayFields ?? [...STRICT_GATE_BEISEN_DISPLAY_FIELDS] },
      coordinate: { sequence: page.sequence, requestedPage: page.sequence, requestedPageSize: pageSize }
    })) return false;
  }
  return true;
}

function strictExactShanghaiPharmaBeisenPlan(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "beisen-zhiye-2022") return false;
  const fields = plan.json.fields;
  return plan.company.category === "DOMESTIC_PHARMA" && plan.source.companyId === plan.company.id &&
    plan.source.kind === "SOCIAL" &&
    plan.source.status === "VERIFIED_SCRAPABLE" && plan.source.atsKind === "BEISEN_ZHIYE" &&
    plan.source.officialEntryUrl === "https://sph.zhiye.com/social/jobs" &&
    plan.source.officialChainEvidenceUrl === "https://www.sphchina.com/html/footer.html" &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" &&
    fields.officialUrl === "officialUrl" && fields.locationRaw === "locationRaw" && fields.cities === "cities" &&
    config.category === "1" && config.pageSize === 100 && config.maxPages === undefined &&
    config.detailPath === "social/detail" && config.displayFields === undefined &&
    config.defaultLocationRaw === undefined && config.geographyScope === "DOMESTIC_OFFICIAL_TENANT" &&
    config.mixedLocationPolicy === "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS" &&
    config.scopeExclusionProof === undefined;
}

function strictHcmRequestContracts(plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>, evidence: PersistentSourceFetchEvidence): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "hcm-cloud") return false;
  const origin = new URL(plan.source.officialEntryUrl).origin;
  const countUrl = new URL("/api/hcm.model.count?model=ReleaseJobMgr", origin).toString();
  const listUrl = new URL("/api/hcm.model.list?model=ReleaseJobMgr", origin).toString();
  const countArtifact = evidence.artifacts.find((artifact) => /hcm-count-0000$/u.test(artifact.logicalKey));
  if (!countArtifact || !strictRequestContractMatches(countArtifact.extractorLocator, {
    family: "hcm", role: "count", method: "POST", url: countUrl,
    body: strictGateHcmCountBody(config), coordinate: { sequence: null, requestedPage: null, requestedPageSize: null }
  })) return false;
  const pageSize = Math.max(1, config.pageSize ?? 20);
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  for (const page of evidence.pages) {
    const requestedPage = page.sequence + 1;
    const expected = { sequence: page.sequence, requestedCursor: null, requestedOffset: null,
      requestedPage, requestedPageSize: pageSize };
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || !strictPageCoordinatesEqual(page, expected)) return false;
    const artifact = artifacts.get(page.artifactLogicalKey);
    if (!artifact || !strictRequestContractMatches(artifact.extractorLocator, {
      family: "hcm", role: "page", method: "POST", url: listUrl,
      body: strictGateHcmListBody(config, requestedPage, pageSize),
      coordinate: { sequence: page.sequence, requestedPage, requestedPageSize: pageSize }
    })) return false;
  }
  return true;
}

function strictGateHcmListBody(
  config: Extract<NonNullable<Extract<SourceCrawlPlan, { adapterId: "official-json" }>["officialJsonFetch"]>, { kind: "hcm-cloud" }>,
  page: number,
  pageSize: number
): Record<string, unknown> {
  return {
    model: "ReleaseJobMgr", filter_str: null,
    filter_dict: { job_class: config.jobClass ?? "社会招聘", status: "1", delivery: 1, contract_unit: null },
    page_index: page, page_size: pageSize,
    extra_property: {
      state: config.portalState ?? "portal_social",
      sorts: [{ type: "desc", key: "is_top" }, { key: "release_date", type: "desc" }, { type: "desc", key: "id" }],
      filter_params: { job_class: config.recruitType ?? "social", filter_dict: { select_depart: null },
        page_index: page, page_size: pageSize, filter_str: null, show_fields_key: [] },
      only_list: true
    },
    biz_type: "list"
  };
}

function strictGateHcmCountBody(
  config: Extract<NonNullable<Extract<SourceCrawlPlan, { adapterId: "official-json" }>["officialJsonFetch"]>, { kind: "hcm-cloud" }>
): Record<string, unknown> {
  const list = strictGateHcmListBody(config, 1, 20);
  const extra = { ...(list.extra_property as Record<string, unknown>) };
  delete extra.only_list;
  return { ...list, page_index: null, page_size: null, extra_property: extra,
    count_by: ["id"], sum_by: [], group_by: null, avg_by: [], min_by: [], max_by: [] };
}

type StrictJobsynConfig = Extract<
  NonNullable<Extract<SourceCrawlPlan, { adapterId: "official-json" }>["officialJsonFetch"]>,
  { kind: "jobsyn-solr" }
>;

function strictJobsynPlanBinding(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): boolean {
  const config = plan.officialJsonFetch;
  return plan.company.id === "company-grifols-china" &&
    plan.company.officialChineseName === "基立福中国" &&
    plan.source.id === "source-grifols-china-social" &&
    plan.source.companyId === "company-grifols-china" &&
    plan.source.atsKind === "OFFICIAL_JSON" &&
    plan.source.officialEntryUrl === "https://grifols.jobs/locations/chn/jobs/" &&
    plan.source.officialChainEvidenceUrl === "https://www.zh.grifolscn.com.cn/zh/careers" &&
    config?.kind === "jobsyn-solr" &&
    config.endpointUrl === "https://prod-search-api.jobsyn.org/api/v1/solr/search" &&
    config.siteOrigin === "grifols.jobs" &&
    config.location === "chn" &&
    config.pageSize === 9 &&
    config.maxPages === 5 &&
    config.detailBaseUrl === "https://grifols.jobs";
}

function strictCnstaffPlanBinding(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): boolean {
  const config = plan.officialJsonFetch;
  return plan.company.id === "company-daiichi-sankyo-china" &&
    plan.company.officialChineseName === "第一三共中国" &&
    plan.source.id === "source-daiichi-sankyo-china-social" &&
    plan.source.companyId === "company-daiichi-sankyo-china" &&
    plan.source.atsKind === "OFFICIAL_JSON" &&
    plan.source.officialEntryUrl === "https://daiichisankyo.cnstaff.com/recruit" &&
    plan.source.officialChainEvidenceUrl === "https://www.daiichisankyo.com.cn/" &&
    config?.kind === "cnstaff" &&
    config.pageSize === 15 &&
    config.maxPages === 10;
}

function strictEightfoldPlanBinding(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>
): boolean {
  return exactBmsPostedDatePlan(plan);
}

function strictEightfoldDateReplay(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[],
  capturedAt: string
): boolean {
  const config = plan.officialJsonFetch;
  if (!strictEightfoldPlanBinding(plan) || config?.kind !== "eightfold-pcsx" ||
    evidence.pages.length === 0 || evidence.pages.length > config.maxPages! ||
    evidence.artifacts.length !== evidence.pages.length || evidence.fetchLosses.length > 0) return strictGateTrace(plan, "BMS_DATE_INPUT");
  const expected = new Map<string, ReturnType<typeof projectEightfoldPcsxPosition> & { officialPublishedAt: string }>();
  let total: number | undefined;
  let declarationLocator: string | undefined;
  const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
  for (let index = 0; index < evidence.pages.length; index++) {
    const page = evidence.pages[index]!;
    const artifact = evidence.artifacts[index]!;
    const logicalKey = `eightfold-page-${String(index).padStart(4, "0")}`;
    const requestUrl = strictEightfoldPageUrl(plan, index).toString();
    const offset = index * config.pageSize!;
    if (artifact.logicalKey !== logicalKey || page.artifactLogicalKey !== logicalKey ||
      artifact.bodyRepresentation === "REDACTED" || artifact.requestedUrl !== sanitizeEvidenceHttpUrl(requestUrl) ||
      artifact.finalUrl !== sanitizeEvidenceHttpUrl(requestUrl) ||
      !strictPageCoordinatesEqual(page, { sequence: index, requestedCursor: null, requestedOffset: offset,
        requestedPage: null, requestedPageSize: config.pageSize! }) || page.returnedOffset !== offset ||
      !strictRequestContractMatches(artifact.extractorLocator, { family: "eightfold", role: "page", method: "GET",
        url: requestUrl, body: null, coordinate: { sequence: index, requestedOffset: offset, requestedPageSize: config.pageSize! } }) ||
      strictGateBodySha256(artifact.body) !== page.responseFingerprintSha256) return strictGateTrace(plan, "BMS_DATE_REQUEST");
    const root = strictUniqueJsonRecord(artifact.body);
    const data = strictRecord(root?.data);
    if (root?.status !== 200 || !data || !strictNonnegativeInteger(data.count) || !Array.isArray(data.positions) ||
      (total !== undefined && total !== data.count)) return strictGateTrace(plan, "BMS_DATE_SCHEMA");
    total ??= data.count;
    if (data.positions.length !== Math.min(config.pageSize!, total - offset) ||
      page.returnedPageSize !== null) return strictGateTrace(plan, "BMS_DATE_PAGE_SIZE");
    const rawIds: string[] = [], validIds: string[] = [];
    for (const value of data.positions) {
      const raw = strictRecord(value);
      const projection = raw && projectEightfoldPcsxPosition(raw, new URL(config.detailBaseUrl), config.cityScopePolicy);
      const officialPublishedAt = raw && bmsOfficialPostedDate(raw.postedTs);
      if (!projection || !officialPublishedAt || expected.has(projection.sourceJobId)) return strictGateTrace(plan, "BMS_DATE_ROW");
      expected.set(projection.sourceJobId, { ...projection, officialPublishedAt });
      rawIds.push(irreversibleOfficialJsonEvidenceId(projection.rawId));
      validIds.push(irreversibleOfficialJsonEvidenceId(projection.sourceJobId));
    }
    const hasNext = expected.size < total;
    if (JSON.stringify(page.rawJobIds) !== JSON.stringify(rawIds) || JSON.stringify(page.validJobIds) !== JSON.stringify(validIds) ||
      page.declaredTotal !== total || page.declaredCount !== null || page.declaredPages !== null ||
      page.nextPageSignalBefore !== (index === 0 ? null : `start:${offset}`) ||
      page.nextPageSignalAfter !== (hasNext ? `start:${offset + config.pageSize!}` : null) ||
      page.termination !== (hasNext ? "CONTINUE" : "NEXT_ABSENT")) return strictGateTrace(plan, "BMS_DATE_PAGE_IDS");
    if (index === 0) declarationLocator = artifact.extractorLocator;
  }
  const valid = total !== undefined && expected.size === total && outputJobs.length === total &&
    new Set(outputJobs.map(job => job.sourceJobId)).size === total &&
    evidence.fetchCounts.rawCount === total && evidence.fetchCounts.parsedCount === total && evidence.fetchCounts.validCount === total &&
    evidence.fetchCounts.parseDiscardCount === 0 && evidence.fetchCounts.validationDiscardCount === 0 &&
    strictGateOfficialTotalDeclaration(evidence, total, evidence.pages[0]!.artifactLogicalKey, declarationLocator!) &&
    outputJobs.every(job => {
      const raw = job.sourceJobId && expected.get(job.sourceJobId);
      return raw && job.companyId === plan.company.id && job.sourceId === plan.source.id && job.evidence.capturedAt === capturedAt &&
        job.officialPublishedAt === raw.officialPublishedAt && job.officialTitle === clean(raw.title) &&
        job.officialUrl === raw.officialUrl && job.locationRaw === clean(raw.locationRaw) &&
        JSON.stringify(job.cities) === JSON.stringify(raw.cities.map(clean));
    });
  return valid || strictGateTrace(plan, "BMS_DATE_OUTPUT");
}

function strictEightfoldPageUrl(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  pageIndex: number
): URL {
  const config = plan.officialJsonFetch;
  if (!strictEightfoldPlanBinding(plan) || !Number.isSafeInteger(pageIndex) || pageIndex < 0 ||
    config?.kind !== "eightfold-pcsx" || pageIndex >= config.maxPages!) {
    throw new Error("Invalid Eightfold page");
  }
  const url = new URL("/api/pcsx/search", new URL(plan.source.officialEntryUrl).origin);
  url.searchParams.set("domain", config.domain);
  url.searchParams.set("query", "");
  url.searchParams.set("location", config.location);
  url.searchParams.set("start", String(pageIndex * config.pageSize!));
  url.searchParams.set("sort_by", "distance");
  exactConfiguredEndpoint(url.toString());
  return url; // Request-contract hashes bind raw query values; artifact URLs use their sanitized form.
}

function strictJobsynPageUrl(config: StrictJobsynConfig, page: number): URL {
  if (!Number.isSafeInteger(page) || page <= 0) throw new Error("Invalid Jobsyn page");
  const url = new URL(config.endpointUrl);
  exactConfiguredEndpoint(url.toString());
  url.searchParams.append("page", String(page));
  url.searchParams.set("location", config.location);
  url.searchParams.set("num_items", String(config.pageSize));
  return url;
}

function strictCnstaffPageUrl(entryUrl: string, page: number): URL {
  if (!Number.isSafeInteger(page) || page <= 0) throw new Error("Invalid CNStaff page");
  const url = new URL(entryUrl);
  exactConfiguredEndpoint(url.toString());
  url.searchParams.set("n", "1");
  url.searchParams.set("p", String(page));
  return url;
}

function strictJobsynRequestContracts(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence
): boolean {
  if (!strictJobsynPlanBinding(plan)) return false;
  const config = plan.officialJsonFetch as StrictJobsynConfig;
  if (evidence.pages.length === 0 || evidence.artifacts.length !== evidence.pages.length ||
    evidence.pages.length > config.maxPages!) return false;
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  if (artifacts.size !== evidence.artifacts.length) return false;
  let officialTotal: number | undefined;
  let officialPages: number | undefined;
  let observedRows = 0;
  let declarationLocator: string | undefined;
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const page = evidence.pages[index]!;
    const requestedPage = index + 1;
    if (!strictPageCoordinatesEqual(page, {
      sequence: index, requestedCursor: null, requestedOffset: null,
      requestedPage, requestedPageSize: config.pageSize!
    }) || page.returnedPage !== requestedPage) return false;
    const logicalKey = `jobsyn-page-${String(requestedPage).padStart(4, "0")}`;
    const artifact = artifacts.get(logicalKey);
    const expectedUrl = exactConfiguredEndpoint(strictJobsynPageUrl(config, requestedPage).toString()).toString();
    if (!artifact || page.artifactLogicalKey !== logicalKey ||
      artifact.bodyRepresentation === "REDACTED" ||
      artifact.requestedUrl !== expectedUrl || artifact.finalUrl !== expectedUrl) return false;
    const root = strictUniqueJsonRecord(artifact.body);
    const pagination = strictRecord(root?.pagination);
    if (!root || !strictGateExactObjectKeys(root, ["featured_jobs", "filters", "jobs", "meta", "pagination"]) ||
      !Array.isArray(root.jobs) || !pagination ||
      !strictJobsynSupplementalMetadata(root, config) ||
      !strictGateExactObjectKeys(pagination, ["has_more_pages", "offset", "page", "page_size", "total", "total_pages"]) ||
      !strictNonnegativeInteger(pagination.total) ||
      !strictNonnegativeInteger(pagination.total_pages) ||
      pagination.offset !== (requestedPage - 1) * config.pageSize! ||
      pagination.page !== requestedPage || pagination.page_size !== config.pageSize ||
      pagination.has_more_pages !== (requestedPage < pagination.total_pages)) return false;
    const total = pagination.total;
    const totalPages = pagination.total_pages;
    if ((officialTotal !== undefined && total !== officialTotal) ||
      (officialPages !== undefined && totalPages !== officialPages)) return false;
    officialTotal ??= total;
    officialPages ??= totalPages;
    if (totalPages !== (total === 0 ? 0 : Math.ceil(total / config.pageSize!)) ||
      root.jobs.length > config.pageSize!) return false;
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (const raw of root.jobs) {
      const parsed = strictJobsynChinaRecord(raw);
      if (!parsed || rawIds.includes(strictGateEvidenceId(parsed.id))) return false;
      rawIds.push(strictGateEvidenceId(parsed.id));
      validIds.push(strictGatePersistentJobId(parsed.id));
    }
    observedRows += root.jobs.length;
    const hasNext = requestedPage < totalPages;
    const expectedTermination = total === 0 && requestedPage === 1
      ? "EMPTY_PAGE"
      : hasNext ? "CONTINUE" : "NEXT_ABSENT";
    if (JSON.stringify(page.rawJobIds) !== JSON.stringify(rawIds) ||
      JSON.stringify(page.validJobIds) !== JSON.stringify(validIds) ||
      page.declaredTotal !== total || page.declaredPages !== totalPages ||
      page.nextPageSignalBefore !== (requestedPage === 1 ? null : `page:${requestedPage}`) ||
      page.nextPageSignalAfter !== (hasNext ? `page:${requestedPage + 1}` : null) ||
      page.termination !== expectedTermination ||
      strictGateBodySha256(artifact.body) !== page.responseFingerprintSha256) return false;
    const locator = strictJobsynLocator(requestedPage, config.pageSize!, config.location);
    if (artifact.extractorLocator !== locator) return false;
    if (requestedPage === 1) declarationLocator = locator;
  }
  return officialTotal !== undefined && officialPages !== undefined &&
    observedRows === officialTotal &&
    evidence.pages.length === (officialTotal === 0 ? 1 : officialPages) &&
    strictGateOfficialTotalDeclaration(evidence, officialTotal, evidence.pages[0]!.artifactLogicalKey, declarationLocator!);
}

function strictJobsynSupplementalMetadata(root: Record<string, unknown>, config: StrictJobsynConfig): boolean {
  if (!Array.isArray(root.featured_jobs) || root.featured_jobs.length !== 0) return false;
  const filters = strictRecord(root.filters);
  const meta = strictRecord(root.meta);
  const sort = strictRecord(meta?.sort);
  if (!filters || !strictGateExactObjectKeys(filters, ["city", "country", "jobcategory", "militarybases", "state", "title"]) ||
    !Object.values(filters).every((value) => Array.isArray(value) && value.every(strictJobsynFilterValue)) ||
    !meta || !strictGateExactObjectKeys(meta, ["canonical", "filters", "request_country", "request_id", "rss", "sort", "source"]) ||
    meta.canonical !== `/locations/${config.location}/jobs/` ||
    meta.rss !== `/locations/${config.location}/jobs/feeds/rss` ||
    meta.request_country !== "US" || meta.request_id !== null || meta.source !== "solr" ||
    !Array.isArray(meta.filters) || meta.filters.length !== 1 ||
    !sort || !strictGateExactObjectKeys(sort, ["active", "options"]) ||
    sort.active !== "date" || !Array.isArray(sort.options) || sort.options.length !== 0) return false;
  const active = strictRecord(meta.filters[0]);
  return Boolean(active && strictGateExactObjectKeys(active, ["display", "key", "link", "name"]) &&
    active.display === config.location.toUpperCase() && active.key === "locations" &&
    active.link === "/jobs" && active.name === "locations");
}

function strictJobsynFilterValue(value: unknown): boolean {
  const record = strictRecord(value);
  return Boolean(record && strictGateExactObjectKeys(record, ["display", "link", "value"]) &&
    strictGateString(record.display) && strictGateString(record.link)?.startsWith("/") &&
    strictNonnegativeInteger(record.value));
}

function strictCnstaffRequestContracts(
  plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>,
  evidence: PersistentSourceFetchEvidence
): boolean {
  if (!strictCnstaffPlanBinding(plan)) return strictGateTrace(plan, "CNSTAFF_PLAN");
  const config = plan.officialJsonFetch;
  if (config?.kind !== "cnstaff" || evidence.pages.length === 0 ||
    evidence.artifacts.length !== evidence.pages.length || evidence.pages.length > config.maxPages!) return strictGateTrace(plan, "CNSTAFF_ENVELOPE");
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  if (artifacts.size !== evidence.artifacts.length) return strictGateTrace(plan, "CNSTAFF_ARTIFACT_KEYS");
  let officialTotal: number | undefined;
  let officialPages: number | undefined;
  let observedRows = 0;
  let declarationLocator: string | undefined;
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const page = evidence.pages[index]!;
    const requestedPage = index + 1;
    if (!strictPageCoordinatesEqual(page, {
      sequence: index, requestedCursor: null, requestedOffset: null,
      requestedPage, requestedPageSize: config.pageSize!
    }) || page.returnedPage !== requestedPage) return strictGateTrace(plan, `CNSTAFF_COORDINATE:${requestedPage}`);
    const logicalKey = `cnstaff-page-${String(requestedPage).padStart(4, "0")}`;
    const artifact = artifacts.get(logicalKey);
    const expectedUrl = exactConfiguredEndpoint(
      strictCnstaffPageUrl(plan.source.officialEntryUrl, requestedPage).toString()
    ).toString();
    if (!artifact || page.artifactLogicalKey !== logicalKey ||
      artifact.bodyRepresentation === "REDACTED" ||
      artifact.requestedUrl !== expectedUrl || artifact.finalUrl !== expectedUrl) return strictGateTrace(plan, `CNSTAFF_ARTIFACT:${requestedPage}`);
    const root = strictUniqueJsonRecord(artifact.body);
    const pageDeclaration = strictRecord(root?.page);
    if (!root || !strictGateExactObjectKeys(root, ["list", "page", "total"]) ||
      !Array.isArray(root.list) || !pageDeclaration ||
      !strictGateExactObjectKeys(pageDeclaration, ["code", "limit", "now", "pageSize", "total"]) ||
      !strictNonnegativeInteger(root.total) ||
      !strictNonnegativeInteger(pageDeclaration.total) ||
      typeof pageDeclaration.code !== "string" || pageDeclaration.code.length > 1_000_000 ||
      pageDeclaration.limit !== `${(requestedPage - 1) * config.pageSize!},${config.pageSize!}` ||
      pageDeclaration.pageSize !== config.pageSize ||
      pageDeclaration.now !== requestedPage) return strictGateTrace(plan, `CNSTAFF_SCHEMA:${requestedPage}`);
    const total = root.total;
    const totalPages = pageDeclaration.total;
    if ((officialTotal !== undefined && total !== officialTotal) ||
      (officialPages !== undefined && totalPages !== officialPages)) return strictGateTrace(plan, `CNSTAFF_TOTAL_DRIFT:${requestedPage}`);
    officialTotal ??= total;
    officialPages ??= totalPages;
    if (totalPages !== (total === 0 ? 0 : Math.ceil(total / config.pageSize!)) ||
      root.list.length > config.pageSize!) return strictGateTrace(plan, `CNSTAFF_PAGE_ARITHMETIC:${requestedPage}`);
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let rowIndex = 0; rowIndex < root.list.length; rowIndex += 1) {
      const raw = root.list[rowIndex];
      const parsed = strictCnstaffChinaRecord(raw);
      if (!parsed || rawIds.includes(strictGateEvidenceId(parsed.officialId)) ||
        validIds.includes(strictGateEvidenceId(strictGatePersistentJobId(parsed.officialId)))) {
        return strictGateTrace(plan, `CNSTAFF_ROW:${requestedPage}:${rowIndex + 1}`);
      }
      rawIds.push(strictGateEvidenceId(parsed.officialId));
      validIds.push(strictGateEvidenceId(strictGatePersistentJobId(parsed.officialId)));
    }
    observedRows += root.list.length;
    const hasNext = requestedPage < totalPages;
    const expectedTermination = total === 0 && requestedPage === 1
      ? "EMPTY_PAGE"
      : hasNext ? "CONTINUE" : "NEXT_ABSENT";
    if (JSON.stringify(page.rawJobIds) !== JSON.stringify(rawIds) ||
      JSON.stringify(page.validJobIds) !== JSON.stringify(validIds) ||
      page.declaredTotal !== total || page.declaredPages !== totalPages ||
      page.nextPageSignalBefore !== (requestedPage === 1 ? null : `page:${requestedPage}`) ||
      page.nextPageSignalAfter !== (hasNext ? `page:${requestedPage + 1}` : null) ||
      page.termination !== expectedTermination ||
      strictGateBodySha256(artifact.body) !== page.responseFingerprintSha256) return strictGateTrace(plan, `CNSTAFF_PAGE_EVIDENCE:${requestedPage}`);
    const locator = strictCnstaffLocator(requestedPage, config.pageSize!);
    if (artifact.extractorLocator !== locator) return strictGateTrace(plan, `CNSTAFF_LOCATOR:${requestedPage}`);
    if (requestedPage === 1) declarationLocator = locator;
  }
  const valid = officialTotal !== undefined && officialPages !== undefined &&
    observedRows === officialTotal &&
    evidence.pages.length === (officialTotal === 0 ? 1 : officialPages) &&
    strictGateOfficialTotalDeclaration(evidence, officialTotal, evidence.pages[0]!.artifactLogicalKey, declarationLocator!);
  return valid || strictGateTrace(plan, "CNSTAFF_FINAL");
}

function strictJobsynLocator(page: number, pageSize: number, location: string): string {
  return `jobsyn-solr-v1|page:${page}|num_items:${pageSize}|location:${strictGateEvidenceId(location)}` +
    "|json:$.jobs[*],$.pagination.total,$.pagination.total_pages,$.pagination.page";
}

function strictCnstaffLocator(page: number, pageSize: number): string {
  return `cnstaff-page-v1|requestPage:${page}|requestPageSize:${pageSize}|requestN:1|` +
    "json:$.total,$.page.total,$.page.now,$.list";
}

function strictGateExactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const sortedExpected = [...expected].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return JSON.stringify(keys) === JSON.stringify(sortedExpected);
}

function strictGateBodySha256(body: string | Uint8Array): string {
  return createHash("sha256").update(typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body)).digest("hex");
}

function strictGateJsonSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function strictGateEvidenceId(value: unknown): string {
  return `sha256:${strictGateJsonSha256(value)}`;
}

function strictGatePersistentJobId(value: string): string {
  return `official-json:sha256:${strictGateJsonSha256(value)}`;
}

function strictGateOfficialTotalDeclaration(
  evidence: PersistentSourceFetchEvidence,
  total: number,
  artifactLogicalKey: string,
  locator: string
): boolean {
  const declaration = evidence.declaredCompleteness;
  return declaration?.kind === "OFFICIAL_TOTAL_COUNT" &&
    declaration.scope === "SOURCE" && declaration.value === total &&
    declaration.artifactLogicalKey === artifactLogicalKey &&
    declaration.extractorLocator === locator;
}

function strictJobsynChinaRecord(value: unknown): { id: string } | undefined {
  const record = strictRecord(value);
  if (!record) return undefined;
  const id = strictGateFirstString(record, ["guid", "id", "reqid"]);
  const title = strictGateFirstString(record, ["title_exact", "title"]);
  const location = strictGateFirstString(record, ["location_exact"]) ?? [
    strictGateFirstString(record, ["city_exact"]),
    strictGateFirstString(record, ["country_short_exact", "country_exact"])
  ].filter((part): part is string => part !== undefined).join(", ");
  const country = strictGateFirstString(record, ["country_exact", "country_short_exact"]);
  if (!id || !strictGateSafeId(id) || !title || !location ||
    !strictGateMainlandScope(country, location)) return undefined;
  return { id };
}

function strictCnstaffChinaRecord(value: unknown): { officialId: string; detailId: string } | undefined {
  const record = strictRecord(value);
  if (!record) return undefined;
  const officialId = strictGateFirstString(record, ["job_publish_id", "job_id"]);
  const detailId = strictGateFirstString(record, ["job_id"]) ?? officialId;
  const title = strictGateFirstString(record, ["job_name_show", "job_name"]);
  const location = strictGateFirstString(record, ["job_address_name", "job_workplace"]);
  if (!officialId || !detailId || !strictGateSafeId(officialId) || !strictGateSafeId(detailId) ||
    !title || !location) return undefined;
  const countryFields = ["Country", "country", "job_country", "job_country_name", "country_name"]
    .filter((field) => Object.prototype.hasOwnProperty.call(record, field));
  const countries = countryFields.map((field) => strictGateString(record[field]));
  if (countries.some((country) => country === undefined) ||
    !strictGateMainlandScope(countries.length > 0 ? countries[0] : undefined, location) ||
    countries.some((country) => !strictGateExactMainlandCountry(country!))) return undefined;
  return { officialId, detailId };
}

function strictGateFirstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = strictGateString(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function strictGateString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() === value && value.length > 0 ? value : undefined;
}

function strictAdapterNormalizedString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized || undefined;
}

function strictGateSafeId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/u.test(value) && value !== "." && value !== "..";
}

function strictGateMainlandScope(country: string | undefined, location: string): boolean {
  const decoded = strictGateDecodedLocation(location);
  if (!decoded || STRICT_GATE_FOREIGN_LOCATION.test(decoded)) return false;
  if (country !== undefined && !strictGateExactMainlandCountry(country)) return false;
  return country !== undefined || STRICT_GATE_MAINLAND_LOCATION.test(decoded);
}

function strictGateDecodedLocation(value: string): string | undefined {
  let decoded = value.normalize("NFKC");
  for (let round = 0; round < 2; round += 1) {
    if (!/%[0-9a-f]{2}/iu.test(decoded)) break;
    try { decoded = decodeURIComponent(decoded).normalize("NFKC"); }
    catch { return undefined; }
  }
  return /%/u.test(decoded) ? undefined : decoded;
}

function strictGateExactMainlandCountry(value: string): boolean {
  return /^(?:China|PRC|Mainland China|China Mainland|People'?s Republic of China|中国|中国大陆|中华人民共和国)$/iu
    .test(value.normalize("NFKC").trim());
}

const STRICT_GATE_FOREIGN_LOCATION =
  /(?:香港|澳门|台湾|台北|海外|国外|美国|纽约|波士顿|西雅图|日本|东京|大阪|新加坡|印度|德国|法国|加拿大|澳大利亚|英国|伦敦|韩国|首尔)|\b(?:hong kong|macao|macau|taiwan|taipei|overseas|abroad|united states|usa|u\.s\.|boston|new york|seattle|japan|tokyo|osaka|singapore|india|germany|france|canada|australia|united kingdom|london|south korea|seoul)\b/iu;
const STRICT_GATE_MAINLAND_LOCATION =
  /(?:中华人民共和国|中国大陆|大陆地区|中国|全国|北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|西藏|宁夏|新疆|石家庄|太原|沈阳|大连|长春|哈尔滨|南京|无锡|苏州|扬州|杭州|宁波|温州|台州|合肥|福州|厦门|南昌|济南|青岛|烟台|潍坊|临沂|郑州|开封|平顶山|新乡|武汉|长沙|淮南|淮安|广州|佛山|深圳|珠海|中山|茂名|南宁|海口|成都|贵阳|昆明|拉萨|西安|兰州|西宁|银川|乌鲁木齐)|\b(?:china|prc|mainland china|china mainland|people'?s republic of china)\b/iu;

function strictArtifactUrlBinding(
  rules: readonly StrictUrlRule[],
  requestedUrl: string,
  finalUrl: string
): StrictUrlRule[] | undefined {
  const requested = strictEvidenceUrl(requestedUrl);
  const final = strictEvidenceUrl(finalUrl);
  if (!requested || !final) return undefined;
  const requestedRules = rules.filter((rule) => strictUrlRuleMatches(requested, rule));
  const finalRules = rules.filter((rule) => strictUrlRuleMatches(final, rule));
  if (requestedRules.length === 0 || finalRules.length === 0) return undefined;
  const sharedRules = requestedRules.filter((requestedRule) => finalRules.some(
    (finalRule) => finalRule.id === requestedRule.id &&
      strictUrlsEquivalentForRule(requested, final, requestedRule)
  ));
  if (sharedRules.length > 0) return sharedRules;
  return requestedRules.some((rule) => rule.role === "ENTRY") &&
    finalRules.some((rule) => rule.role === "ENTRY_REDIRECT")
    ? []
    : undefined;
}

function strictPlanUrlRules(plan: SourceCrawlPlan): StrictUrlRule[] | undefined {
  try {
    const entry = configuredUrlRule(
      "official-entry",
      "ENTRY",
      plan.source.officialEntryUrl,
      { allowQueryless: plan.adapterId === "official-json" && plan.moka !== undefined }
    );
    const chain = configuredUrlRule("official-chain", "CHAIN", plan.source.officialChainEvidenceUrl);
    const rules: StrictUrlRule[] = [entry, chain];
    if (plan.adapterId !== "official-json") {
      entry.allowsPagination = true;
      entry.allowsDeclaration = true;
      chain.allowsPagination = true;
      chain.allowsDeclaration = true;
      return rules;
    }

    if (plan.workday) {
      const workdayRoot = new URL(
        `/wday/cxs/${plan.workday.tenant}/${plan.workday.site}/`,
        entry.origin
      );
      rules.push(exactEndpointRule("workday-jobs", new URL(
        `/wday/cxs/${plan.workday.tenant}/${plan.workday.site}/jobs`,
        entry.origin
      ), { allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true }));
      rules.push(prefixEndpointRule("workday-detail", workdayRoot));
      return rules;
    }
    if (plan.moka) {
      rules.push(exactEndpointRule("moka-jobs", new URL(
        "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2"
      ), { allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true }));
      rules.push(exactEndpointRule("moka-job-detail", new URL(
        "https://app.mokahr.com/api/outer/ats-apply/website/job"
      )));
      if (plan.moka.allowedEntryRedirect) {
        rules.push(redirectRule("moka-entry-redirect", plan.moka.allowedEntryRedirect));
      }
      return rules;
    }

    if (plan.hotjobLegacy) {
      const maxPages = Math.max(1, plan.hotjobLegacy.maxPages ?? 20);
      for (let page = 1; page <= maxPages; page += 1) {
        rules.push(exactEndpointRule(
          `hotjob-legacy-page-${page}`,
          strictHotjobLegacyPageUrl(plan.hotjobLegacy.listUrl, plan.hotjobLegacy.paginationMode, page),
          {
            allowsPagination: true,
            ...(page === 1 ? {
              allowsDeclaration: true as const,
              allowsPositiveTotalDeclaration: true as const
            } : {})
          }
        ));
      }
      return rules;
    }

    if (plan.profileBoundSource) {
      const policy = getStrictProfileBoundSourcePolicy(plan);
      if (!policy) return undefined;
      for (const rule of policy.urlRules) {
        const options = {
          ...(rule.allowsPagination ? { allowsPagination: true as const } : {}),
          ...(rule.allowsDeclaration ? { allowsDeclaration: true as const } : {}),
          ...(rule.allowsPositiveTotalDeclaration
            ? { allowsPositiveTotalDeclaration: true as const }
            : {})
        };
        rules.push(rule.match === "EXACT"
          ? exactEndpointRule(rule.id, new URL(rule.url), options)
          : { ...prefixEndpointRule(rule.id, new URL(rule.url)), ...options });
      }
      return rules;
    }

    const strategy = plan.officialJsonFetch;
    if (strategy?.kind === "51job-coapi") {
      if (!hasBiSemanticPlan(plan)) return undefined;
      rules.push(exactEndpointRule("bi-reviewed-ui-script", new URL(BI_SCRIPT_URL)));
      rules.push(exactEndpointRule("bi-board-api", new URL(BI_API_URL), {
        allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true
      }));
      return rules;
    }
    if (strategy?.kind === "novo-nordisk") {
      const endpoints = strictNovoConfiguredEndpoints(strategy.endpointUrl);
      if (endpoints.request.origin !== entry.origin) return undefined;
      rules.push(exactEndpointRule("novo-nordisk-careersearch", endpoints.evidence, {
        allowsPagination: true,
        allowsDeclaration: true,
        allowsPositiveTotalDeclaration: true
      }));
      return rules;
    }
    if (strategy?.kind === "phenom") {
      rules.push(exactEndpointRule("phenom-widgets", new URL("/widgets", entry.origin), {
        allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true
      }));
      if (strategy.allowedEntryRedirect) {
        rules.push(redirectRule("phenom-entry-redirect", strategy.allowedEntryRedirect));
      }
      if (plan.source.id === "source-roche-china-social" && strategy.nativeDetailPolicy === ROCHE_NATIVE_DETAIL_POLICY) {
        rules.push(prefixEndpointRule("roche-native-detail", new URL("https://roche.wd3.myworkdayjobs.com/wday/cxs/roche/roche-ext/job/")));
      }
      if (exactLillyChinaQualityPlan(plan)) {
        rules.push(prefixEndpointRule("lilly-native-detail", new URL("https://lilly.wd115.myworkdayjobs.com/LLY/job/")));
      }
      return rules;
    }
    if (strategy?.kind === "beisen-zhiye-2022") {
      rules.push(exactEndpointRule(
        "beisen-job-list",
        new URL("/api/Jobad/GetJobAdPageList", entry.origin),
        { allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true }
      ));
      return rules;
    }
    if (strategy?.kind === "hcm-cloud") {
      rules.push(exactEndpointRule(
        "hcm-count",
        new URL("/api/hcm.model.count?model=ReleaseJobMgr", entry.origin),
        { allowsDeclaration: true, allowsPositiveTotalDeclaration: true }
      ));
      rules.push(exactEndpointRule(
        "hcm-list",
        new URL("/api/hcm.model.list?model=ReleaseJobMgr", entry.origin),
        { allowsPagination: true }
      ));
      return rules;
    }
    if (strategy?.kind === "jobsyn-solr") {
      if (!strictJobsynPlanBinding(plan)) return undefined;
      for (let page = 1; page <= strategy.maxPages!; page += 1) {
        rules.push(exactEndpointRule(
          `jobsyn-page-${page}`,
          strictJobsynPageUrl(strategy, page),
          {
            allowsPagination: true,
            ...(page === 1 ? {
              allowsDeclaration: true as const,
              allowsPositiveTotalDeclaration: true as const
            } : {})
          }
        ));
      }
      return rules;
    }
    if (strategy?.kind === "cnstaff") {
      if (!strictCnstaffPlanBinding(plan)) return undefined;
      for (let page = 1; page <= strategy.maxPages!; page += 1) {
        rules.push(exactEndpointRule(
          `cnstaff-page-${page}`,
          strictCnstaffPageUrl(plan.source.officialEntryUrl, page),
          {
            allowsPagination: true,
            ...(page === 1 ? {
              allowsDeclaration: true as const,
              allowsPositiveTotalDeclaration: true as const
            } : {})
          }
        ));
      }
      return rules;
    }
    if (strategy?.kind === "eightfold-pcsx") {
      if (!strictEightfoldPlanBinding(plan)) return undefined;
      for (let pageIndex = 0; pageIndex < strategy.maxPages!; pageIndex += 1) {
        rules.push(exactEndpointRule(
          `eightfold-page-${pageIndex}`,
          strictEightfoldPageUrl(plan, pageIndex),
          {
            allowsPagination: true,
            ...(pageIndex === 0 ? {
              allowsDeclaration: true as const,
              allowsPositiveTotalDeclaration: true as const
            } : {})
          }
        ));
      }
      return rules;
    }
    if (strategy?.kind === "sandoz-jsonapi") {
      const maxPages = strategy.maxPages ?? 50;
      if (strategy.pageSize !== 10 || !Number.isSafeInteger(maxPages) || maxPages <= 0 ||
        strategy.countryTermName !== "LOC_CN" || strategy.countryTermTargetId !== 806 ||
        strategy.countryTermUuid !== "2f829192-01a9-4909-b729-baab0b0bad0c") return undefined;
      const endpoint = exactConfiguredEndpoint(strategy.endpointUrl);
      const taxonomyEndpoint = exactConfiguredEndpoint(strategy.taxonomyEndpointUrl);
      rules.push(exactEndpointRule(
        "sandoz-taxonomy",
        sandozTaxonomyUrl(taxonomyEndpoint, strategy.countryTermTargetId)
      ));
      for (let page = 0; page < maxPages; page += 1) {
        rules.push(exactEndpointRule(
          `sandoz-primary-${page}`,
          strictSandozProbeUrl(endpoint, strategy.countryTermTargetId, "primary", page),
          {
            allowsPagination: true,
            ...(page === 0 ? {
              allowsDeclaration: true as const,
              allowsPositiveTotalDeclaration: true as const
            } : {})
          }
        ));
      }
      for (const probe of ["alt1", "alt2", "alt3"] as const) {
        rules.push(exactEndpointRule(
          `sandoz-${probe}-0`,
          strictSandozProbeUrl(endpoint, strategy.countryTermTargetId, probe, 0)
        ));
      }
      return rules;
    }
    if (strategy?.kind === "yello-job-board") {
      const binding = yelloJobBoardBinding(plan.source.officialEntryUrl, strategy);
      rules.push(exactEndpointRule("yello-china-search", new URL(sanitizeEvidenceHttpUrl(binding.endpointUrl)), {
        allowsPagination: true,
        allowsDeclaration: true,
        allowsPositiveTotalDeclaration: true
      }));
      return rules;
    }
    if (strategy?.kind === "xiuzheng-job-list") {
      rules.push(exactEndpointRule(
        "xiuzheng-job-list",
        exactConfiguredEndpoint(strategy.endpointUrl),
        { allowsPagination: true, allowsDeclaration: true }
      ));
      return rules;
    }
    if (strategy?.kind === "redsea-zp-channel") {
      if (strategy.paginationPolicy !== "SINGLE_UNPAGINATED_RESPONSE_V1" ||
        !Array.isArray(strategy.channels) ||
        new Set(strategy.channels.map(({ channelQrId }) => channelQrId)).size !== strategy.channels.length) {
        return undefined;
      }
      const social = strategy.channels.filter(({ purpose }) => purpose === "SOCIAL");
      if (social.length !== 1 || strategy.channels.some(({ channelQrId, purpose }) =>
        !safeOfficialJsonId(channelQrId) || (purpose !== "SOCIAL" && purpose !== "CAMPUS"))) return undefined;
      const channelQrId = social[0]!.channelQrId;
      const expectedEntry = new URL(
        `/RedseaPlatform/zhaopin/zpChannelQrCode/${channelQrId}/officeWebsite.mob`, entry.origin
      );
      if (expectedEntry.toString() !== plan.source.officialEntryUrl) return undefined;
      const list = new URL("/RedseaPlatform/zhaopin/zpChannelQrCode/officePage.mob", entry.origin);
      list.searchParams.set("noHead", "1");
      list.searchParams.set("pageId", "list");
      list.searchParams.set("configId", channelQrId);
      list.searchParams.set("lectureId", "");
      rules.push(exactEndpointRule(`redsea-list-${channelQrId}`, list));
      rules.push(exactEndpointRule(
        `redsea-api-${channelQrId}`,
        new URL("/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob", entry.origin),
        { allowsPagination: true, allowsDeclaration: true }
      ));
      return rules;
    }
    return rules;
  } catch {
    return undefined;
  }
}

function configuredUrlRule(
  id: string,
  role: "ENTRY" | "CHAIN",
  value: string,
  options: { allowQueryless?: boolean } = {}
): StrictUrlRule {
  const raw = new URL(value);
  if (raw.protocol !== "https:" || raw.username || raw.password) {
    throw new Error("Configured official URL is invalid");
  }
  raw.hash = "";
  const base = new URL(raw.toString());
  base.search = "";
  const configured = exactConfiguredEndpoint(base.toString());
  const variantValues = [raw.toString()];
  const withoutKeywords = new URL(raw.toString());
  for (const key of [...withoutKeywords.searchParams.keys()]) {
    const normalized = key.normalize("NFKC").toLowerCase();
    if (normalized === "keyword" || normalized === "keywords") withoutKeywords.searchParams.delete(key);
  }
  variantValues.push(withoutKeywords.toString());
  if (options.allowQueryless) {
    const queryless = new URL(raw.toString());
    queryless.search = "";
    variantValues.push(queryless.toString());
  }
  const variants = variantValues.flatMap((variant) => {
    try { return [exactConfiguredEndpoint(variant)]; } catch { return []; }
  });
  if (variants.length === 0) throw new Error("Configured official URL has no safe exact evidence form");
  return {
    id,
    role,
    origin: configured.origin,
    pathname: configured.pathname,
    exactSearches: [...new Set(variants.map((variant) => variant.search))],
    allowTrailingSlash: true
  };
}

function redirectRule(id: string, value: { origin: string; pathname: string }): StrictUrlRule {
  const configured = exactConfiguredEndpoint(new URL(value.pathname, value.origin).toString());
  if (!configured || configured.origin !== new URL(value.origin).origin) {
    throw new Error("Configured official redirect is invalid");
  }
  return {
    id,
    role: "ENTRY_REDIRECT",
    origin: configured.origin,
    pathname: configured.pathname,
    exactSearches: [""],
    allowTrailingSlash: true
  };
}

function exactEndpointRule(
  id: string,
  value: URL,
  options: {
    allowsPagination?: true;
    allowsDeclaration?: true;
    allowsPositiveTotalDeclaration?: true;
  } = {}
): StrictUrlRule {
  const endpoint = exactConfiguredEndpoint(value.toString());
  return {
    id,
    role: "ENDPOINT",
    origin: endpoint.origin,
    pathname: endpoint.pathname,
    exactSearches: [endpoint.search],
    ...options
  };
}

function prefixEndpointRule(id: string, value: URL): StrictUrlRule {
  const endpoint = exactConfiguredEndpoint(value.toString());
  if (endpoint.search || !endpoint.pathname.endsWith("/")) {
    throw new Error("Configured strategy endpoint prefix is invalid");
  }
  return {
    id,
    role: "ENDPOINT",
    origin: endpoint.origin,
    pathname: endpoint.pathname,
    pathnamePrefix: true,
    exactSearches: [""]
  };
}

function strictHotjobLegacyPageUrl(
  value: string,
  mode: "body-current-page" | "query-page" | undefined,
  page: number
): URL {
  if (!Number.isSafeInteger(page) || page <= 0) throw new Error("Invalid Hotjob legacy page");
  const raw = new URL(value);
  const retained = new URLSearchParams();
  for (const [key, candidate] of raw.searchParams) {
    if (candidate !== "") retained.append(key, candidate);
  }
  raw.search = retained.toString();
  if (mode === "query-page") raw.searchParams.set("page", String(page));
  return exactConfiguredEndpoint(raw.toString());
}

function exactConfiguredEndpoint(value: string): URL {
  const raw = new URL(value);
  if (raw.protocol !== "https:" || raw.username || raw.password || raw.hash) {
    throw new Error("Configured strategy endpoint is invalid");
  }
  const endpoint = strictEvidenceUrl(sanitizeEvidenceHttpUrl(raw.toString()));
  if (!endpoint) throw new Error("Configured strategy endpoint is invalid");
  return endpoint;
}

function strictNovoConfiguredEndpoints(value: string): { request: URL; evidence: URL } {
  const request = new URL(value);
  if (request.protocol !== "https:" || request.username || request.password || request.hash) {
    throw new Error("Novo configured endpoint is invalid");
  }
  const entries = [...request.searchParams.entries()];
  const exactQuery = (key: string, expected: string) =>
    entries.filter(([candidate]) => candidate === key).length === 1 &&
    request.searchParams.get(key) === expected;
  if (entries.length !== 4 ||
    !exactQuery("keyword", "") ||
    !exactQuery("country", "China") ||
    !exactQuery("category", "") ||
    !exactQuery("locale", "zh-cn") ||
    request.hostname !== "www.novonordisk.com.cn") {
    throw new Error("Novo configured endpoint does not bind the official China scope");
  }
  const evidenceRequest = new URL(request.toString());
  evidenceRequest.searchParams.delete("keyword");
  return { request, evidence: exactConfiguredEndpoint(evidenceRequest.toString()) };
}

function strictEvidenceUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function strictUrlRuleMatches(candidate: URL, rule: StrictUrlRule): boolean {
  if (candidate.origin !== rule.origin) return false;
  const candidatePath = rule.allowTrailingSlash ? trimTrailingSlash(candidate.pathname) : candidate.pathname;
  const rulePath = rule.allowTrailingSlash ? trimTrailingSlash(rule.pathname) : rule.pathname;
  const pathMatches = rule.pathnamePrefix
    ? candidatePath.startsWith(rulePath)
    : candidatePath === rulePath;
  return pathMatches && rule.exactSearches.includes(candidate.search);
}

function strictUrlsEquivalentForRule(left: URL, right: URL, rule: StrictUrlRule): boolean {
  const leftPath = rule.allowTrailingSlash ? trimTrailingSlash(left.pathname) : left.pathname;
  const rightPath = rule.allowTrailingSlash ? trimTrailingSlash(right.pathname) : right.pathname;
  return left.origin === right.origin && leftPath === rightPath && left.search === right.search;
}

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
}

const STRICT_SANDOZ_JSONAPI_FIELDS = [
  "title", "field_job_title", "field_job_employment_type", "field_job_type", "field_job_id",
  "field_job_business_unit", "field_job_work_location", "field_job_posted_date", "path",
  "drupal_internal__tid", "field_date", "field_job_country", "field_job_alt_country_1",
  "field_job_alt_country_2", "field_job_alt_country_3"
].join(",");

function strictSandozProbeUrl(
  endpoint: URL,
  targetId: number,
  probe: "primary" | "alt1" | "alt2" | "alt3",
  page: number
): URL {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error("Invalid Sandoz page");
  const url = new URL(endpoint.toString());
  url.search = "";
  url.searchParams.set("fields[node--jobs]", STRICT_SANDOZ_JSONAPI_FIELDS);
  url.searchParams.set("page", String(page));
  url.searchParams.set("views-filter[field_job_functional_area]", "All");
  url.searchParams.set("views-filter[field_job_posted_date][min]", "");
  url.searchParams.set("views-filter[field_job_posted_date][max]", "");
  if (probe === "primary") {
    url.searchParams.set("views-filter[field_job_country]", String(targetId));
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
  } else if (probe === "alt1") {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", String(targetId));
  } else if (probe === "alt2") {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
    url.searchParams.set("views-filter[field_job_alt_country_2]", String(targetId));
  } else {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
    url.searchParams.set("views-filter[field_job_alt_country_3]", String(targetId));
  }
  return url;
}

function sandozTaxonomyUrl(endpoint: URL, targetId: number): URL {
  const url = new URL(endpoint.toString());
  url.search = "";
  url.searchParams.set("filter[drupal_internal__tid]", String(targetId));
  return url;
}

interface StrictPositiveOfficialTotalReplayPolicy {
  allowMissingReturnedPage?: true;
  allowLaterZeroDeclaredTotalAfterExactReconciliation?: true;
  allowPositiveOfficialTotalCountAfterAdapterReconciliation?: true;
  allowIndependentlyVerifiedProfileBoundExclusions?: true;
  allowCompleteTraversalOfEmptyFirstPage?: true;
  allowRawIdOverlapAcrossPages?: true;
}

function strictPositiveOfficialTotalReplayPolicy(
  plan: SourceCrawlPlan
): StrictPositiveOfficialTotalReplayPolicy | undefined {
  if (plan.adapterId !== "official-json") return undefined;
  const configuredStrategies = [
    plan.officialJsonFetch,
    plan.workday,
    plan.moka,
    plan.hotjob,
    plan.hotjobLegacy,
    plan.profileBoundSource
  ].filter((strategy) => strategy !== undefined);
  if (configuredStrategies.length !== 1) return undefined;

  if (plan.workday) {
    if (plan.source.atsKind !== "WORKDAY" ||
      (!plan.workday.searchText && Object.keys(plan.workday.appliedFacets ?? {}).length === 0)) return undefined;
    const laterZeroPolicy = plan.workday.laterZeroTotalPolicy;
    if (laterZeroPolicy !== undefined && ![
      "PFIZER_AUDITED_EXACT_RECONCILIATION",
      "AMGEN_AUDITED_EXACT_RECONCILIATION",
      "BMS_AUDITED_EXACT_RECONCILIATION"
    ].includes(laterZeroPolicy)) return undefined;
    return {
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      ...(laterZeroPolicy === undefined
        ? {}
        : { allowLaterZeroDeclaredTotalAfterExactReconciliation: true })
    };
  }

  if (plan.moka) {
    if (plan.source.atsKind !== "MOKA" || plan.moka.expectedMode !== "social" ||
      !plan.moka.expectedOrgId.trim() || !plan.moka.expectedSiteId.trim()) return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      ...(hasHengruiScopeExclusionPolicy(plan) ? { allowIndependentlyVerifiedProfileBoundExclusions: true as const } : {}) };
  }

  if (plan.hotjobLegacy) {
    const pageSize = plan.hotjobLegacy.pageSize ?? 20;
    const maxPages = plan.hotjobLegacy.maxPages ?? 20;
    if (plan.source.atsKind !== "HOTJOB_WECRUIT" || plan.hotjobLegacy.paginationMode !== "query-page" ||
      !plan.hotjobLegacy.suitePath.trim() || !Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > 50 ||
      !Number.isSafeInteger(maxPages) || maxPages <= 0) return undefined;
    try { strictHotjobLegacyPageUrl(plan.hotjobLegacy.listUrl, plan.hotjobLegacy.paginationMode, 1); }
    catch { return undefined; }
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
  }

  if (plan.profileBoundSource) {
    const policy = getStrictProfileBoundSourcePolicy(plan);
    if (!policy) return undefined;
    const replayPolicy: StrictPositiveOfficialTotalReplayPolicy = {
      ...(policy.allowMissingReturnedPage ? { allowMissingReturnedPage: true as const } : {}),
      ...(policy.allowPositiveOfficialTotalCountAfterAdapterReconciliation
        ? { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true as const }
        : {}),
      ...(policy.allowCompleteTraversalOfEmptyFirstPage
        ? { allowCompleteTraversalOfEmptyFirstPage: true as const }
        : {}),
      ...(policy.allowIndependentlyVerifiedProfileBoundExclusions
        ? { allowIndependentlyVerifiedProfileBoundExclusions: true as const }
        : {})
    };
    return Object.keys(replayPolicy).length > 0 ? replayPolicy : undefined;
  }

  const strategy = plan.officialJsonFetch;
  if (!strategy) return undefined;
  if (strategy.kind === "beisen-zhiye-2022") {
    if (plan.source.atsKind !== "BEISEN_ZHIYE" ||
      strategy.geographyScope !== "DOMESTIC_OFFICIAL_TENANT") return undefined;
    return {
      allowMissingReturnedPage: true,
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
    };
  }
  if (strategy.kind === "novo-nordisk") {
    if (plan.source.atsKind !== "OFFICIAL_JSON") return undefined;
    try {
      const endpoints = strictNovoConfiguredEndpoints(strategy.endpointUrl);
      if (endpoints.request.origin !== new URL(plan.source.officialEntryUrl).origin) return undefined;
    } catch {
      return undefined;
    }
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      ...(exactNovoChinaQualityPlan(plan) ? { allowIndependentlyVerifiedProfileBoundExclusions: true as const } : {}) };
  }
  if (strategy.kind === "phenom") {
    if (plan.source.atsKind !== "OFFICIAL_JSON" ||
      (!strategy.countryFilter?.trim() && !strategy.facetScope)) return undefined;
    const exactRocheDuplicatePolicy = strategy.exactDuplicateReconciliationPolicy ===
      "ROCHE_IDENTICAL_CROSS_PAGE_V1" &&
      plan.company.id === "company-roche-china" &&
      plan.source.id === "source-roche-china-social" &&
      plan.source.companyId === "company-roche-china" &&
      plan.source.officialEntryUrl === "https://careers.roche.com/cn/zh/search-results";
    if (strategy.exactDuplicateReconciliationPolicy !== undefined && !exactRocheDuplicatePolicy) return undefined;
    return {
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      ...(exactRocheDuplicatePolicy ? { allowRawIdOverlapAcrossPages: true as const } : {})
    };
  }
  if (strategy.kind === "hcm-cloud") {
    if (plan.source.atsKind !== "OFFICIAL_JSON" ||
      strategy.countCoordinatePolicy !== "LUNAN_AGGREGATE_ROW" ||
      strategy.responsePrefixPolicy !== "LUNAN_RANDOM_ALNUM3" ||
      strategy.listPaginationPolicy !== "LUNAN_REQUEST_BOUND_PAGE_V1") return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
  }
  if (strategy.kind === "jobsyn-solr") {
    if (!strictJobsynPlanBinding(plan)) return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
  }
  if (strategy.kind === "cnstaff") {
    if (!strictCnstaffPlanBinding(plan)) return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
  }
  if (strategy.kind === "eightfold-pcsx") {
    if (!strictEightfoldPlanBinding(plan)) return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
  }
  if (strategy.kind === "sandoz-jsonapi") {
    if (plan.source.atsKind !== "OFFICIAL_JSON" || strategy.countryTermName !== "LOC_CN" ||
      !Number.isSafeInteger(strategy.countryTermTargetId) || strategy.countryTermTargetId <= 0 ||
      !strategy.countryTermUuid.trim()) return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
  }
  if (strategy.kind === "51job-coapi") {
    if (plan.source.id !== "source-boehringer-ingelheim-china-social" ||
      plan.source.atsKind !== "OFFICIAL_JSON") return undefined;
    return {
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      allowIndependentlyVerifiedProfileBoundExclusions: true
    };
  }
  if (strategy.kind === "yello-job-board") {
    if (plan.source.atsKind !== "OFFICIAL_JSON") return undefined;
    try { yelloJobBoardBinding(plan.source.officialEntryUrl, strategy); }
    catch { return undefined; }
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
      allowIndependentlyVerifiedProfileBoundExclusions: true };
  }
  return undefined;
}

function failedAdapterInputResult(
  plan: SourceCrawlPlan,
  capturedAt: string,
  failureReason: string,
  evidenceUrl?: string
): CrawlAdapterResult {
  const safeSourceId = containsSensitiveAdapterValue(plan.source.id) ? "redacted-source" : plan.source.id;
  return {
    status: "FAILED",
    jobs: [],
    failureReason,
    observation: {
      id: `${safeSourceId}:adapter-input:${capturedAt}`,
      sourceId: safeSourceId,
      crawledAt: new Date(capturedAt),
      successful: false,
      stableRequiredFields: [],
      structuredJobCount: 0,
      completenessStatus: "FAILED",
      ...(evidenceUrl === undefined ? {} : { completenessEvidenceUrl: evidenceUrl }),
      completenessBlockerReason: failureReason,
      failureReason
    }, reconciliation: emptyReconciliation()
  };
}

function failedFetchResult(
  plan: SourceCrawlPlan,
  capturedAt: string,
  failureReason: string,
  evidenceUrl?: string
): CrawlAdapterResult {
  return {
    status: "FAILED",
    jobs: [],
    failureReason,
    observation: {
      id: `${plan.source.id}:fetch:${capturedAt}`,
      sourceId: plan.source.id,
      crawledAt: new Date(capturedAt),
      successful: false,
      stableRequiredFields: [],
      structuredJobCount: 0,
      completenessStatus: "FAILED",
      completenessEvidenceKind: "FETCH_FAILURE",
      ...(evidenceUrl === undefined ? {} : { completenessEvidenceUrl: evidenceUrl }),
      completenessBlockerReason: failureReason,
      failureReason
    }, reconciliation: emptyReconciliation()
  };
}

function canonicalPublicHttpUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (containsCredentialAssignment(url.pathname)) return undefined;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function safeSourceClone<T extends SourceCrawlPlan["source"]>(source: T): (
  Omit<T, "officialEntryUrl" | "officialChainEvidenceUrl"> & {
    officialEntryUrl: string;
    officialChainEvidenceUrl?: string;
  }
) | undefined {
  const officialEntryUrl = canonicalPublicHttpUrl(source.officialEntryUrl);
  const officialChainEvidenceUrl = canonicalPublicHttpUrl(source.officialChainEvidenceUrl);
  if (!officialEntryUrl) return undefined;
  const {
    officialEntryUrl: _rawOfficialEntryUrl,
    officialChainEvidenceUrl: _rawOfficialChainEvidenceUrl,
    ...rest
  } = source;
  return {
    ...rest,
    officialEntryUrl,
    ...(officialChainEvidenceUrl ? { officialChainEvidenceUrl } : {})
  };
}

function safeCompletenessEvidence(
  completeness: CompletenessEvidence
): CompletenessEvidence {
  if (completeness.completenessEvidenceUrl === undefined) return { ...completeness };
  const { completenessEvidenceUrl: _rawEvidenceUrl, ...rest } = completeness;
  const completenessEvidenceUrl = canonicalPublicHttpUrl(completeness.completenessEvidenceUrl);
  return completenessEvidenceUrl === undefined
    ? rest
    : { ...rest, completenessEvidenceUrl };
}

function containsCredentialAssignment(value: string): boolean {
  const normalized = decodeAndNormalizeCredentialText(value);
  return /(?:^|[^a-z0-9])(?:api[._-]?key|client[._-]?secret|access[._-]?token|refresh[._-]?token|token|secret|password|passwd|pwd|credential|auth|authorization|cookie|session|jwt|bearer|basic)\s*[:=]\s*\S+/iu.test(normalized);
}

function decodeAndNormalizeCredentialText(value: string): string {
  let result = value.normalize("NFKC");
  for (let round = 0; round < 2; round += 1) {
    try {
      const decoded = decodeURIComponent(result).normalize("NFKC");
      if (decoded === result) break;
      result = decoded;
    } catch {
      break;
    }
  }
  return result.normalize("NFKC");
}
