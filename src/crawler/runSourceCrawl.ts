import { createDecipheriv, createHash } from "node:crypto";
import { load } from "cheerio";
import { htmlTableAdapter } from "./adapters/htmlTable";
import { officialJsonAdapter } from "./adapters/officialJson";
import type { CrawlAdapterResult } from "./adapters/types";
import type { CompletenessEvidence } from "../domain/company";
import { validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence, SourceFetchPageTrace } from "./sourceFetchEvidence";
import { evaluatePaginationEvidence, type PaginationEvaluation } from "./paginationEvidence";
import { assertAdapterReconciliation, emptyReconciliation } from "./adapters/reconciliation";
import { containsSensitiveAdapterValue } from "./adapters/safeAdapterValue";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl } from "./sourceFetchEvidence";

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
        : {})
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

      return finalizeTruth(withFetchEvidence(reconcileResult(officialJsonAdapter.extract({
        ...baseInput,
        payload: fetchResult.payload,
        json: plan.json
      }), fetchResult), fetchResult), fetchResult, plan);
    }

    if (!("html" in fetchResult)) {
      return finalizeTruth(withFetchEvidence(failedAdapterInputResult(
        plan,
        fetchResult.capturedAt,
        "Expected HTML payload for html-table adapter",
        safeEvidenceUrl
      ), fetchResult), fetchResult, plan);
    }

    return finalizeTruth(withFetchEvidence(reconcileResult(htmlTableAdapter.extract({
      ...baseInput,
      html: fetchResult.html,
      table: plan.table
    }), fetchResult), fetchResult), fetchResult, plan);
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
  fetchResult: SourceFetchResult,
  plan: SourceCrawlPlan
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
    plan
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
  plan: SourceCrawlPlan
): boolean {
  if (!fetchResult.ok || !fetchResult.fetchEvidence || !fetchResult.paginationEvaluation ||
    fetchResult.paginationEvaluation.safeCompleteness !== true) return false;
  try {
    const evidence = parsePersistentSourceFetchEvidence(fetchResult.fetchEvidence);
    if (plan.executionAuthority !== "STAGED") return false;
    validateExecutablePlanChannelBinding(plan);
    const expectedChannelIds = planBoundEvidenceChannelIds(plan, evidence);
    if (expectedChannelIds === undefined) return false;
    const urlRules = strictPlanUrlRules(plan);
    if (!urlRules) return false;
    const artifactUrlBindings = strictNetworkArtifactUrlBindings(evidence, urlRules);
    if (!artifactUrlBindings) return false;
    if (!strictEvidenceArtifactPurposes(plan, evidence, artifactUrlBindings) ||
      !strictPageRequestContracts(plan, evidence)) return false;
    const replayPolicy = strictPositiveOfficialTotalReplayPolicy(plan);
    const independentlyEvaluated = evaluatePaginationEvidence({
      evidence,
      expectedChannelIds,
      filteredOutput: true,
      ...(replayPolicy ?? {})
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
    const declaredArtifactRules = artifactUrlBindings.get(artifact.logicalKey);
    if (!declaredArtifactRules) return false;
    if (declared.kind === "OFFICIAL_TOTAL_COUNT") {
      if (declared.value !== ledger.rawInputCount) return false;
      if (declared.value > 0 && !declaredArtifactRules.some((rule) =>
        rule.role === "ENDPOINT" && rule.allowsPositiveTotalDeclaration === true)) return false;
    }
    return true;
  } catch {
    return false;
  }
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
  evidence: PersistentSourceFetchEvidence
): boolean {
  if (plan.adapterId !== "official-json") return true;
  if (plan.workday) return strictWorkdayRequestContracts(plan, evidence);
  if (plan.moka) return strictMokaRequestContracts(plan, evidence);
  const strategy = plan.officialJsonFetch;
  if (strategy?.kind === "phenom") return strictPhenomRequestContracts(plan, evidence);
  if (strategy?.kind === "beisen-zhiye-2022") return strictBeisenRequestContracts(plan, evidence);
  if (strategy?.kind === "hcm-cloud") return strictHcmRequestContracts(plan, evidence);
  if (strategy?.kind === "sandoz-jsonapi") return strictSandozScopeArtifacts(plan, evidence);
  return true;
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
  family: "workday" | "moka" | "phenom" | "beisen" | "hcm";
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

function strictWorkdayRequestContracts(plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>, evidence: PersistentSourceFetchEvidence): boolean {
  const config = plan.workday!;
  const pageSize = !config.pageSize || !Number.isFinite(config.pageSize)
    ? 20 : Math.min(20, Math.max(1, Math.floor(config.pageSize)));
  const jobsUrl = new URL(`/wday/cxs/${config.tenant}/${config.site}/jobs`, plan.source.officialEntryUrl).toString();
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  const hasStaticLocationFacet = Object.keys(config.appliedFacets ?? {}).some(
    (facetParameter) => /location|country|countries/iu.test(facetParameter)
  );
  if (config.locationFacetPolicy || artifacts.has("workday-preflight-0000") ||
    (config.searchText && !hasStaticLocationFacet)) return false;
  let appliedFacets: Record<string, readonly string[]> = { ...(config.appliedFacets ?? {}) };
  const facetArtifact = artifacts.get("workday-facet-preflight-0000");
  const hasDescriptorPolicy = Boolean(config.facetDescriptorBoundary) || (config.facetDescriptorExclusions?.length ?? 0) > 0;
  if (hasDescriptorPolicy !== Boolean(facetArtifact)) return false;
  if (facetArtifact) {
    const preflightBody = { appliedFacets, limit: pageSize, offset: 0 };
    if (!strictRequestContractMatches(facetArtifact.extractorLocator, {
      family: "workday", role: "facet-preflight", method: "POST", url: jobsUrl, body: preflightBody,
      coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
    })) return false;
    const derived = strictWorkdayFacetDerivation(facetArtifact.body, config);
    if (!derived) return false;
    appliedFacets = { ...appliedFacets, ...derived };
  }
  const pageKeys = new Set(evidence.pages.map((page) => page.artifactLogicalKey));
  for (const artifact of evidence.artifacts) {
    if ((artifact.requestedUrl === jobsUrl || artifact.finalUrl === jobsUrl) &&
      !pageKeys.has(artifact.logicalKey) && artifact.logicalKey !== "workday-facet-preflight-0000") return false;
  }
  for (const page of evidence.pages) {
    const expected = { sequence: page.sequence, requestedCursor: null,
      requestedOffset: page.sequence * pageSize, requestedPage: page.sequence, requestedPageSize: pageSize };
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || !strictPageCoordinatesEqual(page, expected)) return false;
    const artifact = artifacts.get(page.artifactLogicalKey);
    const body = {
      appliedFacets,
      ...(config.searchText && !hasDescriptorPolicy ? { searchText: config.searchText } : {}),
      limit: pageSize,
      offset: page.sequence * pageSize
    };
    if (!artifact || !strictRequestContractMatches(artifact.extractorLocator, {
      family: "workday", role: "page", method: "POST", url: jobsUrl, body,
      coordinate: { sequence: page.sequence, requestedOffset: page.sequence * pageSize,
        requestedPage: page.sequence, requestedPageSize: pageSize }
    })) return false;
  }
  return true;
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

function strictRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function strictMokaRequestContracts(plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>, evidence: PersistentSourceFetchEvidence): boolean {
  const config = plan.moka!;
  const listUrl = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
  const detailUrl = "https://app.mokahr.com/api/outer/ats-apply/website/job";
  const entryArtifacts = evidence.artifacts.filter((artifact) => artifact.logicalKey === "moka-entry-0000");
  if (entryArtifacts.length !== 1 || entryArtifacts[0]!.bodyRepresentation === "REDACTED") return false;
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
        needStat: true, isCampusJob: false, site: config.expectedMode, locale: "zh-CN" },
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
    if (!detail || strictMokaJobId(detail) !== expectedJobId ||
      strictMokaStringValue(detail.orgId) !== config.expectedOrgId ||
      strictMokaStringValue(detail.siteId) !== config.expectedSiteId ||
      strictMokaCities(detail.locations).length === 0) return false;
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

function strictPhenomRequestContracts(plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>, evidence: PersistentSourceFetchEvidence): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "phenom" || config.facetScope || evidence.artifacts.some((artifact) =>
    artifact.logicalKey.startsWith("phenom-facet-"))) return false;
  const entry = evidence.artifacts.find((artifact) => artifact.logicalKey === "phenom-entry-0000");
  const pageConfig = entry ? strictGatePhenomJsonConfig(entry.body) : undefined;
  if (!pageConfig) return false;
  const endpoint = pageConfig.widgetApiEndpoint;
  let parsedEndpoint: URL;
  try { parsedEndpoint = new URL(endpoint); } catch { return false; }
  if (parsedEndpoint.protocol !== "https:" || parsedEndpoint.origin !== new URL(plan.source.officialEntryUrl).origin ||
    parsedEndpoint.pathname !== "/widgets" || parsedEndpoint.search || parsedEndpoint.hash) return false;
  const pageSize = Math.max(1, Math.min(100, config.pageSize ?? 50));
  const selectedFields = { country: [config.countryFilter ?? "China"] };
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  for (const page of evidence.pages) {
    const offset = page.sequence * pageSize;
    const expected = { sequence: page.sequence, requestedCursor: null, requestedOffset: offset,
      requestedPage: null, requestedPageSize: pageSize };
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || !strictPageCoordinatesEqual(page, expected)) return false;
    const artifact = artifacts.get(page.artifactLogicalKey);
    if (!artifact || !strictRequestContractMatches(artifact.extractorLocator, {
      family: "phenom", role: "page", method: "POST", url: endpoint,
      body: strictGatePhenomRequestBody(pageConfig, pageSize, offset, selectedFields),
      coordinate: { sequence: page.sequence, requestedOffset: offset, requestedPage: null, requestedPageSize: pageSize }
    })) return false;
  }
  return true;
}

type StrictGatePhenomConfig = {
  widgetApiEndpoint: string; refNum: string; locale: string; deviceType: string;
  country: string; pageName: string; pageId: string;
};

function strictGatePhenomJsonConfig(body: string | Uint8Array): StrictGatePhenomConfig | undefined {
  const html = typeof body === "string" ? body : Buffer.from(body).toString("utf8");
  const candidates: StrictGatePhenomConfig[] = [];
  for (const match of html.matchAll(/<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    let parsed: unknown;
    try { parsed = JSON.parse(match[1]!.trim()); } catch { return undefined; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const phApp = (parsed as Record<string, unknown>).phApp;
    if (!phApp || typeof phApp !== "object" || Array.isArray(phApp)) continue;
    const value = phApp as Record<string, unknown>;
    const keys = ["widgetApiEndpoint", "refNum", "locale", "deviceType", "country", "pageName", "pageId"] as const;
    if (!keys.every((key) => typeof value[key] === "string" && (value[key] as string).length > 0)) return undefined;
    candidates.push(Object.fromEntries(keys.map((key) => [key, value[key]])) as StrictGatePhenomConfig);
  }
  if (candidates.length !== 1) return undefined;
  return candidates[0];
}

function strictGatePhenomRequestBody(
  config: StrictGatePhenomConfig,
  size: number,
  from: number,
  selectedFields: Record<string, string[]>
): Record<string, unknown> {
  return {
    lang: config.locale, locale: config.locale, deviceType: config.deviceType, country: config.country,
    pageName: config.pageName, size, from, jobs: true, counts: true,
    all_fields: ["category", "country", "state", "city", "type", "jobLevelId"],
    clearAll: false, jdsource: "facets", isSliderEnable: false, pageId: config.pageId,
    siteType: "external", keywords: "", global: true, selected_fields: selectedFields,
    sort: { order: "desc", field: "postedDate" }, locationData: {}, refNum: config.refNum, ddoKey: "refineSearch"
  };
}

const STRICT_GATE_BEISEN_DISPLAY_FIELDS = [
  "Category", "Kind", "LocId", "Salary", "Degree", "YearsOfWorking", "ClassificationOne", "WorkWeChatQrCode"
] as const;

function strictBeisenRequestContracts(plan: Extract<SourceCrawlPlan, { adapterId: "official-json" }>, evidence: PersistentSourceFetchEvidence): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "beisen-zhiye-2022") return false;
  const pageSize = Math.max(1, Math.min(100, config.pageSize ?? 100));
  const endpoint = new URL("/api/Jobad/GetJobAdPageList", plan.source.officialEntryUrl).toString();
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  for (const page of evidence.pages) {
    const expected = { sequence: page.sequence, requestedCursor: null, requestedOffset: null,
      requestedPage: page.sequence, requestedPageSize: pageSize };
    if (!Number.isSafeInteger(page.sequence) || page.sequence < 0 || !strictPageCoordinatesEqual(page, expected)) return false;
    const artifact = artifacts.get(page.artifactLogicalKey);
    if (!artifact || !strictRequestContractMatches(artifact.extractorLocator, {
      family: "beisen", role: "page", method: "POST", url: endpoint,
      body: { PageIndex: page.sequence, PageSize: pageSize, Category: [config.category ?? "1"], KeyWords: "",
        SpecialType: 0, PortalId: "", DisplayFields: config.displayFields ?? [...STRICT_GATE_BEISEN_DISPLAY_FIELDS] },
      coordinate: { sequence: page.sequence, requestedPage: page.sequence, requestedPageSize: pageSize }
    })) return false;
  }
  return true;
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

    const strategy = plan.officialJsonFetch;
    if (strategy?.kind === "phenom") {
      rules.push(exactEndpointRule("phenom-widgets", new URL("/widgets", entry.origin), {
        allowsPagination: true, allowsDeclaration: true, allowsPositiveTotalDeclaration: true
      }));
      if (strategy.allowedEntryRedirect) {
        rules.push(redirectRule("phenom-entry-redirect", strategy.allowedEntryRedirect));
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
  allowPositiveOfficialTotalCountAfterAdapterReconciliation: true;
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
    plan.hotjobLegacy
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
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
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
  if (strategy.kind === "phenom") {
    if (plan.source.atsKind !== "OFFICIAL_JSON" ||
      (!strategy.countryFilter?.trim() && !strategy.facetScope)) return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
  }
  if (strategy.kind === "hcm-cloud") {
    if (plan.source.atsKind !== "OFFICIAL_JSON" ||
      strategy.countCoordinatePolicy !== "LUNAN_AGGREGATE_ROW" ||
      strategy.responsePrefixPolicy !== "LUNAN_RANDOM_ALNUM3" ||
      strategy.listPaginationPolicy !== "LUNAN_REQUEST_BOUND_PAGE_V1") return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
  }
  if (strategy.kind === "sandoz-jsonapi") {
    if (plan.source.atsKind !== "OFFICIAL_JSON" || strategy.countryTermName !== "LOC_CN" ||
      !Number.isSafeInteger(strategy.countryTermTargetId) || strategy.countryTermTargetId <= 0 ||
      !strategy.countryTermUuid.trim()) return undefined;
    return { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true };
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
