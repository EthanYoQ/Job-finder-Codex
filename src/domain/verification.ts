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

function isSuccessfulStableObservation(
  observation: CrawlObservation
): boolean {
  if (!observation.successful) return false;
  if (observation.structuredJobCount <= 0) return false;

  return REQUIRED_FIELDS.every((field) =>
    observation.stableRequiredFields.includes(field)
  );
}

export function isVerifiedScrapable(
  source: RecruitmentSource,
  observations: CrawlObservation[]
): boolean {
  if (source.kind !== "SOCIAL") return false;
  if (source.status !== "VERIFIED_SCRAPABLE") return false;
  if (!source.officialEntryUrl || !source.officialChainEvidenceUrl) return false;

  const latestObservations = observations
    .filter((observation) => observation.sourceId === source.id)
    .sort((left, right) => right.crawledAt.getTime() - left.crawledAt.getTime())
    .slice(0, REQUIRED_SUCCESSFUL_STABLE_CRAWLS);

  if (latestObservations.length < REQUIRED_SUCCESSFUL_STABLE_CRAWLS) {
    return false;
  }

  return latestObservations.every(isSuccessfulStableObservation);
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
