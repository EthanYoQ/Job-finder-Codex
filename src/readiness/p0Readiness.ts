import { buildSourceCrawlPlans } from "../crawler/sourcePlan";
import { candidateCompanies, type CandidateCompany } from "../data/companyRegistry";
import type {
  CrawlObservation,
  RecruitmentSource,
  RequiredJobField
} from "../domain/company";
import {
  isVerifiedScrapable,
  P0_MIN_VERIFIED_SCRAPABLE_COMPANIES
} from "../domain/verification";

export type P0ReadinessBlockerCode =
  | "CANDIDATE_POOL_OUT_OF_RANGE"
  | "VERIFIED_COMPANIES_BELOW_50"
  | "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN";

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
  requiredVerifiedCompanies: number;
  declaredVerifiedSocialSources: number;
  configuredVerifiedSocialSources: number;
  crawlEvidencedVerifiedCompanies: number;
  verifiedSourcesMissingCrawlPlan: P0ReadinessSourceIssue[];
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
  const configuredSourceIds =
    input.configuredSourceIds ??
    new Set(buildSourceCrawlPlans(companies).map((plan) => plan.source.id));
  const observationsBySource = input.observationsBySource ?? {};
  const declaredVerifiedSources = companies.flatMap((company) =>
    company.sources
      .filter((source) => source.kind === "SOCIAL" && source.status === "VERIFIED_SCRAPABLE")
      .map((source) => ({ company, source }))
  );
  const verifiedSourcesMissingCrawlPlan = declaredVerifiedSources
    .filter(({ source }) => !configuredSourceIds.has(source.id))
    .map(({ company, source }) => ({
      sourceId: source.id,
      companyId: company.id,
      companyName: company.officialChineseName
    }));
  const configuredVerifiedSocialSources = declaredVerifiedSources.filter(({ source }) =>
    configuredSourceIds.has(source.id)
  );
  const crawlEvidencedVerifiedCompanies = companies.filter((company) =>
    company.sources.some((source) => {
      if (!configuredSourceIds.has(source.id)) return false;
      const completeSource = toCompleteRecruitmentSource(company, source);
      return completeSource
        ? isVerifiedScrapable(
            completeSource,
            toCrawlObservations(observationsBySource[source.id] ?? [])
          )
        : false;
    })
  ).length;
  const blockers = buildBlockers({
    totalCandidates: companies.length,
    crawlEvidencedVerifiedCompanies,
    verifiedSourcesMissingCrawlPlan
  });

  return {
    totalCandidates: companies.length,
    requiredVerifiedCompanies: P0_MIN_VERIFIED_SCRAPABLE_COMPANIES,
    declaredVerifiedSocialSources: declaredVerifiedSources.length,
    configuredVerifiedSocialSources: configuredVerifiedSocialSources.length,
    crawlEvidencedVerifiedCompanies,
    verifiedSourcesMissingCrawlPlan,
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
  totalCandidates,
  crawlEvidencedVerifiedCompanies,
  verifiedSourcesMissingCrawlPlan
}: {
  totalCandidates: number;
  crawlEvidencedVerifiedCompanies: number;
  verifiedSourcesMissingCrawlPlan: readonly P0ReadinessSourceIssue[];
}): P0ReadinessBlocker[] {
  const blockers: P0ReadinessBlocker[] = [];

  if (totalCandidates < 80 || totalCandidates > 120) {
    blockers.push({
      code: "CANDIDATE_POOL_OUT_OF_RANGE",
      message: `P0 candidate pool must contain 80-120 companies; current count is ${totalCandidates}.`
    });
  }

  if (crawlEvidencedVerifiedCompanies < P0_MIN_VERIFIED_SCRAPABLE_COMPANIES) {
    blockers.push({
      code: "VERIFIED_COMPANIES_BELOW_50",
      message: `P0 requires at least ${P0_MIN_VERIFIED_SCRAPABLE_COMPANIES} crawl-evidenced verified companies; current count is ${crawlEvidencedVerifiedCompanies}.`
    });
  }

  if (verifiedSourcesMissingCrawlPlan.length > 0) {
    blockers.push({
      code: "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN",
      message: `${verifiedSourcesMissingCrawlPlan.length} declared verified social source(s) are missing crawl-plan configuration.`
    });
  }

  return blockers;
}
