import { htmlTableAdapter } from "./adapters/htmlTable";
import { officialJsonAdapter } from "./adapters/officialJson";
import type { CrawlAdapterResult } from "./adapters/types";
import type { CompletenessEvidence } from "../domain/company";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { evaluatePaginationEvidence, type PaginationEvaluation } from "./paginationEvidence";
import { assertAdapterReconciliation, emptyReconciliation } from "./adapters/reconciliation";
import { containsSensitiveAdapterValue } from "./adapters/safeAdapterValue";
import { parsePersistentSourceFetchEvidence } from "./sourceFetchEvidence";

export type SourceFetchResult =
  | { ok: true; capturedAt: string; payload: unknown; completeness?: CompletenessEvidence; fetchEvidence?: PersistentSourceFetchEvidence; paginationEvaluation?: PaginationEvaluation; priorTransportAttempts?: readonly SourceTransportAttempt[] }
  | { ok: true; capturedAt: string; html: string; completeness?: CompletenessEvidence; fetchEvidence?: PersistentSourceFetchEvidence; paginationEvaluation?: PaginationEvaluation; priorTransportAttempts?: readonly SourceTransportAttempt[] }
  | { ok: false; capturedAt: string; failureReason: string; fetchEvidence?: PersistentSourceFetchEvidence; paginationEvaluation?: PaginationEvaluation; priorTransportAttempts?: readonly SourceTransportAttempt[] };

export interface SourceTransportAttempt {
  transport: "DIRECT_HTTP" | "BROWSER_SESSION";
  outcome: "FAILED" | "SUCCEEDED";
  code: "HCM_DIRECT_FAILED" | "HCM_BROWSER_SESSION_FAILED" | "HCM_BROWSER_ENTRY_FAILED" |
    "HCM_BROWSER_COUNT_FAILED" | "HCM_BROWSER_LIST_FAILED";
  capturedAt: string;
  fetchEvidence?: PersistentSourceFetchEvidence;
  paginationEvaluation?: PaginationEvaluation;
}

export type SourceCrawlResult = CrawlAdapterResult & {
  truth: SourceCrawlTruth;
  fetchEvidence?: PersistentSourceFetchEvidence;
  paginationEvaluation?: PaginationEvaluation;
  priorTransportAttempts?: readonly SourceTransportAttempt[];
};

export interface SourceCrawlTruth {
  transportSuccess: boolean;
  adapterSuccess: boolean;
  completenessVerified: boolean;
}

export type SourceFetchFunction = (
  plan: SourceCrawlPlan
) => SourceFetchResult | Promise<SourceFetchResult>;

export interface RunSourceCrawlDeps {
  fetch: SourceFetchFunction;
  isBaseline?: boolean;
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
  try {
    fetchResult = await deps.fetch(plan);
  } catch (error) {
    throw new SourceCrawlStageError("FETCH", error);
  }

  const safeEvidenceUrl = canonicalPublicHttpUrl(plan.source.officialEntryUrl);
  if ([plan.source.id, plan.source.companyId, plan.company.id, plan.company.officialChineseName].some(containsSensitiveAdapterValue)) {
    return finalizeTruth(withFetchEvidence(failedAdapterInputResult(plan, fetchResult.capturedAt,
      "Adapter input metadata is unsafe", safeEvidenceUrl), fetchResult), fetchResult);
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
        : {})
    }, fetchResult);
  }

  try {
    const safeSource = safeSourceClone(plan.source);
    if (!safeSource) {
      return finalizeTruth(withFetchEvidence(failedAdapterInputResult(
        plan,
        fetchResult.capturedAt,
        "Official source URLs are malformed or use an unsupported protocol",
        safeEvidenceUrl
      ), fetchResult), fetchResult);
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
        ), fetchResult), fetchResult);
      }

      return finalizeTruth(withFetchEvidence(reconcileResult(officialJsonAdapter.extract({
        ...baseInput,
        payload: fetchResult.payload,
        json: plan.json
      }), fetchResult), fetchResult), fetchResult);
    }

    if (!("html" in fetchResult)) {
      return finalizeTruth(withFetchEvidence(failedAdapterInputResult(
        plan,
        fetchResult.capturedAt,
        "Expected HTML payload for html-table adapter",
        safeEvidenceUrl
      ), fetchResult), fetchResult);
    }

    return finalizeTruth(withFetchEvidence(reconcileResult(htmlTableAdapter.extract({
      ...baseInput,
      html: fetchResult.html,
      table: plan.table
    }), fetchResult), fetchResult), fetchResult);
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
      : {})
  };
}

function finalizeTruth(
  result: Omit<SourceCrawlResult, "truth">,
  fetchResult: SourceFetchResult
): SourceCrawlResult {
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

  const completenessVerified = adapterSuccess && strictCompletenessGate(
    fetchResult,
    ledger!,
    result.observation.sourceId
  );
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
      observation.expectedJobCount = declaration.value;
    }
    delete observation.completenessBlockerReason;
  } else if (observation.completenessStatus === "VERIFIED") {
    observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
    observation.completenessBlockerReason = "Strict completeness evidence gate was not satisfied";
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

function strictCompletenessGate(
  fetchResult: SourceFetchResult,
  ledger: ReturnType<typeof assertAdapterReconciliation>,
  sourceId: string
): boolean {
  if (!fetchResult.ok || !fetchResult.fetchEvidence || !fetchResult.paginationEvaluation ||
    fetchResult.paginationEvaluation.safeCompleteness !== true ||
    fetchResult.paginationEvaluation.verifiedEligible !== true) return false;
  try {
    const evidence = parsePersistentSourceFetchEvidence(fetchResult.fetchEvidence);
    const independentlyEvaluated = evaluatePaginationEvidence({
      evidence,
      expectedChannelIds: fetchResult.paginationEvaluation.visitedChannelIds,
      filteredOutput: true,
      ...(sourceId === "source-sandoz-china-social" ? {
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      } : {})
    });
    if (independentlyEvaluated.safeCompleteness !== true || independentlyEvaluated.verifiedEligible !== true ||
      independentlyEvaluated.paginationTraceSha256 !== fetchResult.paginationEvaluation.paginationTraceSha256 ||
      JSON.stringify(independentlyEvaluated.derivedAnomalyCodes) !== JSON.stringify(fetchResult.paginationEvaluation.derivedAnomalyCodes) ||
      JSON.stringify(independentlyEvaluated.visitedChannelIds) !== JSON.stringify(fetchResult.paginationEvaluation.visitedChannelIds)) return false;
    const declared = evidence.declaredCompleteness;
    if (!declared || declared.scope === "GLOBAL_UNFILTERED" || evidence.supportingArtifactOnlyFailure ||
      evidence.fetchCounts.validCount !== ledger.rawInputCount ||
      ledger.adapterLosses.length !== 0 || ledger.dedupeOutputCount !== ledger.rawInputCount) return false;
    const artifact = evidence.artifacts.find((candidate) => candidate.logicalKey === declared.artifactLogicalKey);
    if (!artifact || !["OFFICIAL_COMPANY_PAGE", "ATS_PAGE", "ATS_API_RESPONSE", "PAGINATION_PAGE"]
      .includes(artifact.kind)) return false;
    if (declared.kind === "OFFICIAL_TOTAL_COUNT" && declared.value !== ledger.rawInputCount) return false;
    return true;
  } catch {
    return false;
  }
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
