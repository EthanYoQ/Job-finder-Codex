import type {
  Company,
  CrawlObservation,
  RecruitmentSource,
  RequiredJobField
} from "./company";

const REQUIRED_FIELDS: RequiredJobField[] = [
  "company",
  "title",
  "officialUrl",
  "location"
];

const REQUIRED_SUCCESSFUL_STABLE_CRAWLS = 2;
export const P0_MIN_VERIFIED_SCRAPABLE_COMPANIES = 50;

export function isVerifiedScrapable(
  source: RecruitmentSource,
  observations: CrawlObservation[]
): boolean {
  if (source.kind !== "SOCIAL") return false;
  if (!source.officialEntryUrl || !source.officialChainEvidenceUrl) return false;

  const successfulStableCrawls = observations.filter((observation) => {
    if (!observation.successful) return false;
    if (observation.structuredJobCount <= 0) return false;

    return REQUIRED_FIELDS.every((field) =>
      observation.stableRequiredFields.includes(field)
    );
  });

  return successfulStableCrawls.length >= REQUIRED_SUCCESSFUL_STABLE_CRAWLS;
}

export function countVerifiedCompanies(
  companies: Company[],
  observationsBySource: Record<string, CrawlObservation[]>
): number {
  return companies.filter((company) =>
    company.sources.some((source) =>
      isVerifiedScrapable(source, observationsBySource[source.id] ?? [])
    )
  ).length;
}

export function canLaunchP0(
  companies: Company[],
  observationsBySource: Record<string, CrawlObservation[]>
): boolean {
  return (
    companies.length >= 80 &&
    companies.length <= 120 &&
    countVerifiedCompanies(companies, observationsBySource) >=
      P0_MIN_VERIFIED_SCRAPABLE_COMPANIES
  );
}
