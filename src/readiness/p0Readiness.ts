import { buildSourceCrawlPlans } from "../crawler/sourcePlan";
import { candidateCompanies, type CandidateCompany } from "../data/companyRegistry";
import { derivePhase1Scope } from "../data/phase1ScopePolicy";
import type {
  CrawlObservation,
  RecruitmentSource,
  RequiredJobField
} from "../domain/company";
import {
  hasExactP0Roster,
  isVerifiedScrapable,
  P0_REQUIRED_COMPANIES
} from "../domain/verification";

export type P0ReadinessBlockerCode =
  | "CANDIDATE_POOL_OUT_OF_RANGE"
  | "OFFICIAL_LINK_DENOMINATOR_INCOMPLETE"
  | "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN"
  | "BLOCKING_EVIDENCE_GAP"
  | "NO_LINK_AUTHORITY_MISSING"
  | "INVALID_COMPANY_OFFICIAL_LINK_STATUS"
  | "INVALID_SOURCE_GRAPH"
  | "INVALID_PHASE1_SCOPE_POLICY";

export interface P0ReadinessBlocker {
  code: P0ReadinessBlockerCode;
  message: string;
}

export interface P0ReadinessSourceIssue {
  sourceId: string;
  companyId: string;
  companyName: string;
}

export interface P0ReadinessReport {
  totalCandidates: number;
  foreignPharmaCompanies: number;
  domesticPharmaCompanies: number;
  phase1InScopeCompanies: number;
  authorizedExclusionCompanies: number;
  requiredOfficialLinkSources: number;
  plannedOfficialLinkSources: number;
  crawlEvidencedOfficialLinkSources: number;
  noPublicOfficialCareersLinkCompanies: number;
  blockingEvidenceGapCompanies: number;
  sourcePlanOmissions: P0ReadinessSourceIssue[];
  blockers: P0ReadinessBlocker[];
  canLaunchP0: boolean;
}

export type P0ReadinessCrawlObservation = Omit<
  CrawlObservation,
  "stableRequiredFields"
> & {
  stableRequiredFields: readonly RequiredJobField[];
};

export interface P0ReadinessInput {
  companies?: readonly CandidateCompany[];
  configuredSourceIds?: ReadonlySet<string>;
  observationsBySource?: Record<string, readonly P0ReadinessCrawlObservation[]>;
}

export function getP0ReadinessReport(input: P0ReadinessInput = {}): P0ReadinessReport {
  const companies = input.companies ?? candidateCompanies;
  let policyError: Error | undefined;
  let inScopeCompanies: readonly CandidateCompany[] = companies;
  let authorizedExclusionCount = 0;
  try {
    const scope = derivePhase1Scope(companies);
    inScopeCompanies = scope.inScopeCompanies;
    authorizedExclusionCount = scope.authorizedExclusionCount;
  } catch (error) {
    policyError = error instanceof Error ? error : new Error("Invalid Phase 1 scope policy");
  }
  const sourceGraph = validateSourceGraph(inScopeCompanies);
  const activeSourceIds = new Set(buildSourceCrawlPlans(companies).map((plan) => plan.source.id));
  const configuredSourceIds = input.configuredSourceIds
    ? new Set([...input.configuredSourceIds].filter((sourceId) => activeSourceIds.has(sourceId)))
    : activeSourceIds;
  const observationsBySource = input.observationsBySource ?? {};
  const requiredOfficialLinkSources = sourceGraph.uniqueSocialSources;
  const sourcePlanOmissions = requiredOfficialLinkSources
    .filter(({ source }) => !configuredSourceIds.has(source.id))
    .map(({ company, source }) => ({
      sourceId: source.id,
      companyId: company.id,
      companyName: company.officialChineseName
    }));
  const plannedOfficialLinkSources = requiredOfficialLinkSources.filter(({ source }) =>
    configuredSourceIds.has(source.id)
  );
  const crawlEvidencedOfficialLinkSources = requiredOfficialLinkSources.filter(({ company, source }) => {
      if (sourceGraph.invalidSourceIds.has(source.id)) return false;
      if (!configuredSourceIds.has(source.id)) return false;
      const completeSource = toCompleteRecruitmentSource(company, source);
      return completeSource
        ? isVerifiedScrapable(
            completeSource,
            toCrawlObservations(observationsBySource[source.id] ?? [])
          )
        : false;
  }).length;
  const noPublicOfficialCareersLinkCompanies = inScopeCompanies.filter((company) =>
    company.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME").length;
  const blockingEvidenceGapCompanies = inScopeCompanies.filter((company) =>
    company.targetStatus === "BLOCKED_EVIDENCE_GAP").length;
  const invalidStatusCompanies = inScopeCompanies.filter((company) => {
    if (company.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME") return company.sources.length > 0;
    if (company.targetStatus === "BLOCKED_EVIDENCE_GAP") return false;
    const socialSources = company.sources.filter((source) => source.kind === "SOCIAL");
    return socialSources.length === 0 || socialSources.some((source) =>
      source.status !== "VERIFIED_SCRAPABLE" ||
      !source.officialEntryUrl?.trim() ||
      !source.officialChainEvidenceUrl?.trim()
    );
  });
  const blockers = buildBlockers({
    companies,
    plannedOfficialLinkSourceCount: plannedOfficialLinkSources.length,
    crawlEvidencedOfficialLinkSources,
    sourcePlanOmissions,
    blockingEvidenceGapCompanies,
    noPublicOfficialCareersLinkCompanies,
    invalidStatusCompanies,
    sourceGraphIssueCount: sourceGraph.issueCount,
    ...(policyError ? { policyError } : {})
  });

  return {
    totalCandidates: companies.length,
    foreignPharmaCompanies: companies.filter((company) => company.category === "FOREIGN_PHARMA").length,
    domesticPharmaCompanies: companies.filter((company) => company.category === "DOMESTIC_PHARMA").length,
    phase1InScopeCompanies: inScopeCompanies.length,
    authorizedExclusionCompanies: authorizedExclusionCount,
    requiredOfficialLinkSources: requiredOfficialLinkSources.length,
    plannedOfficialLinkSources: plannedOfficialLinkSources.length,
    crawlEvidencedOfficialLinkSources,
    noPublicOfficialCareersLinkCompanies,
    blockingEvidenceGapCompanies,
    sourcePlanOmissions,
    blockers,
    canLaunchP0: blockers.length === 0
  };
}

function toCrawlObservations(
  observations: readonly P0ReadinessCrawlObservation[]
): CrawlObservation[] {
  return observations.map((observation) => ({
    ...observation,
    stableRequiredFields: [...observation.stableRequiredFields]
  }));
}

function toCompleteRecruitmentSource(
  company: CandidateCompany,
  source: CandidateCompany["sources"][number]
): RecruitmentSource | undefined {
  if (!company.officialWebsiteUrl || !source.officialEntryUrl || !source.officialChainEvidenceUrl) {
    return undefined;
  }

  return {
    id: source.id,
    companyId: source.companyId,
    kind: source.kind,
    atsKind: source.atsKind,
    officialEntryUrl: source.officialEntryUrl,
    officialChainEvidenceUrl: source.officialChainEvidenceUrl,
    status: source.status
  };
}

function buildBlockers({
  companies,
  plannedOfficialLinkSourceCount,
  crawlEvidencedOfficialLinkSources,
  sourcePlanOmissions,
  blockingEvidenceGapCompanies,
  noPublicOfficialCareersLinkCompanies,
  invalidStatusCompanies,
  sourceGraphIssueCount,
  policyError
}: {
  companies: readonly CandidateCompany[];
  plannedOfficialLinkSourceCount: number;
  crawlEvidencedOfficialLinkSources: number;
  sourcePlanOmissions: readonly P0ReadinessSourceIssue[];
  blockingEvidenceGapCompanies: number;
  noPublicOfficialCareersLinkCompanies: number;
  invalidStatusCompanies: readonly CandidateCompany[];
  sourceGraphIssueCount: number;
  policyError?: Error;
}): P0ReadinessBlocker[] {
  const blockers: P0ReadinessBlocker[] = [];

  if (!hasExactP0Roster(companies)) {
    blockers.push({
      code: "CANDIDATE_POOL_OUT_OF_RANGE",
      message: `P0 roster must contain exactly ${P0_REQUIRED_COMPANIES} unique companies with 30 foreign and 30 domestic; current total is ${companies.length}.`
    });
  }

  if (policyError) blockers.push({
    code: "INVALID_PHASE1_SCOPE_POLICY",
    message: policyError.message
  });

  if (crawlEvidencedOfficialLinkSources !== plannedOfficialLinkSourceCount) {
    blockers.push({
      code: "OFFICIAL_LINK_DENOMINATOR_INCOMPLETE",
      message: `P0 requires evidence for every planned official-link source; evidenced ${crawlEvidencedOfficialLinkSources} of ${plannedOfficialLinkSourceCount}.`
    });
  }

  if (sourcePlanOmissions.length > 0) {
    blockers.push({
      code: "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN",
      message: `${sourcePlanOmissions.length} required official-link source(s) are missing crawl-plan configuration.`
    });
  }

  if (blockingEvidenceGapCompanies > 0) blockers.push({
    code: "BLOCKING_EVIDENCE_GAP",
    message: `${blockingEvidenceGapCompanies} roster company audit(s) remain blocked by evidence gaps.`
  });

  if (noPublicOfficialCareersLinkCompanies > 0) blockers.push({
    code: "NO_LINK_AUTHORITY_MISSING",
    message: `${noPublicOfficialCareersLinkCompanies} no-link adjudication(s) lack startup-validated oracle-v3 authority in static readiness mode.`
  });

  if (invalidStatusCompanies.length > 0) blockers.push({
    code: "INVALID_COMPANY_OFFICIAL_LINK_STATUS",
    message: `${invalidStatusCompanies.length} roster company status/source combination(s) are invalid.`
  });

  if (sourceGraphIssueCount > 0) blockers.push({
    code: "INVALID_SOURCE_GRAPH",
    message: `${sourceGraphIssueCount} duplicate or reassociated source identity issue(s) block readiness.`
  });

  return blockers;
}

function validateSourceGraph(companies: readonly CandidateCompany[]): {
  uniqueSocialSources: Array<{ company: CandidateCompany; source: CandidateCompany["sources"][number] }>;
  invalidSourceIds: Set<string>;
  issueCount: number;
} {
  const seenOwners = new Map<string, string>();
  const uniqueSocialById = new Map<string, { company: CandidateCompany; source: CandidateCompany["sources"][number] }>();
  const invalidSourceIds = new Set<string>();
  let issueCount = 0;
  for (const company of companies) {
    for (const source of company.sources) {
      if (source.companyId !== company.id) {
        invalidSourceIds.add(source.id);
        issueCount += 1;
      }
      if (seenOwners.has(source.id)) {
        invalidSourceIds.add(source.id);
        issueCount += 1;
      } else {
        seenOwners.set(source.id, company.id);
      }
      if (source.kind === "SOCIAL" && !uniqueSocialById.has(source.id)) {
        uniqueSocialById.set(source.id, { company, source });
      }
    }
  }
  return { uniqueSocialSources: [...uniqueSocialById.values()], invalidSourceIds, issueCount };
}
