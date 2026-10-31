import type {
  Company,
  CrawlObservation,
  RecruitmentSource,
  RequiredJobField
} from "./company";
import { assertExactConfirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";
import { derivePhase1Scope } from "../data/phase1ScopePolicy";

const REQUIRED_FIELDS: RequiredJobField[] = [
  "company",
  "title",
  "officialUrl",
  "location"
];

const REQUIRED_SUCCESSFUL_STABLE_CRAWLS = 2;
export const P0_REQUIRED_COMPANIES = 60;

function isSuccessfulStableObservation(
  observation: CrawlObservation
): boolean {
  if (!observation.successful) return false;
  if (
    observation.completenessEvidenceKind !== "OFFICIAL_TOTAL_COUNT" &&
    observation.completenessEvidenceKind !== "OFFICIAL_TOTAL_PAGES" &&
    observation.completenessEvidenceKind !== "COMPLETE_PAGE_TRAVERSAL"
  ) {
    return false;
  }
  if (
    observation.structuredJobCount === 0 &&
    observation.expectedJobCount === 0 &&
    observation.completenessStatus === "VERIFIED"
  ) {
    return true;
  }
  if (observation.structuredJobCount <= 0) return false;
  if (observation.completenessStatus !== "VERIFIED") return false;
  if (
    observation.expectedJobCount !== undefined &&
    observation.structuredJobCount !== observation.expectedJobCount
  ) {
    return false;
  }

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
  const inScopeCompanies = derivePhase1Scope(companies).inScopeCompanies;
  return inScopeCompanies.filter((company) =>
    company.sources.some((source) =>
      isVerifiedScrapable(source, observationsBySource[source.id] ?? [])
    )
  ).length;
}

export function canLaunchP0(
  companies: Company[],
  observationsBySource: Record<string, CrawlObservation[]>,
  configuredSourceIds: ReadonlySet<string>
): boolean {
  if (!hasExactP0Roster(companies)) return false;
  let inScopeCompanies: Company[];
  try { inScopeCompanies = derivePhase1Scope(companies).inScopeCompanies; } catch { return false; }
  if (!configuredSourceIds) return false;
  const requiredSources = inScopeCompanies.flatMap((company) =>
    company.sources.filter((source) => source.kind === "SOCIAL").map((source) => ({ company, source }))
  );
  const requiredSourceIds = requiredSources.map(({ source }) => source.id);
  if (new Set(requiredSourceIds).size !== requiredSourceIds.length ||
      requiredSources.some(({ company, source }) => source.companyId !== company.id) ||
      configuredSourceIds.size !== requiredSourceIds.length ||
      requiredSourceIds.some((sourceId) => !configuredSourceIds.has(sourceId))) return false;

  return inScopeCompanies.every((company) => {
    if (company.targetStatus === "BLOCKED_EVIDENCE_GAP") return false;
    if (company.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME") {
      return false;
    }

    const socialSources = company.sources.filter((source) => source.kind === "SOCIAL");
    return socialSources.length > 0 && socialSources.every((source) =>
      isVerifiedScrapable(source, observationsBySource[source.id] ?? [])
    );
  });
}

export function hasExactP0Roster(companies: readonly Pick<Company, "id" | "category">[]): boolean {
  try {
    assertExactConfirmedCompanyRosterV3(companies.map(({ id, category }) => ({ id, category })));
    return true;
  } catch {
    return false;
  }
}
