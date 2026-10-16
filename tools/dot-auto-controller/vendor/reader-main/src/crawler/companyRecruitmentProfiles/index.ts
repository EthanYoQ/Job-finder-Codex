import {
  candidateCompanies,
  CONFIRMED_ROSTER_V3_PROVENANCE
} from "../../data/companyRegistry";
import { COMPANY_RECRUITMENT_PROFILE_SEEDS } from "./catalog";
import type {
  CompanyCompletenessStrategy,
  CompanyRecruitmentExecutionConfig,
  CompanyRecruitmentProfile,
  CompanyRecruitmentSourceProfile
} from "./types";

export type {
  CompanyCompletenessStrategy,
  CompanyRecruitmentExecutionConfig,
  CompanyRecruitmentProfile,
  CompanyRecruitmentSourceProfile,
  MokaFetchConfig,
  ProfileBoundSourceConfig
} from "./types";

const CHINA_SOCIAL_SCOPE = Object.freeze({
  channel: "SOCIAL" as const,
  geography: "MAINLAND_CHINA" as const,
  authority: "OFFICIAL_LINK_OR_EXPLICIT_ENDORSEMENT" as const
});

function deepFreezeProfileValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeProfileValue(child);
    }
    Object.freeze(value);
  }
  return value;
}

function completenessStrategyFor(
  config: CompanyRecruitmentExecutionConfig
): CompanyCompletenessStrategy {
  if (config.adapterId === "official-json") return "STRICT_OFFICIAL_SOURCE_EVIDENCE";
  if (config.table.completenessProof?.kind === "STATIC_PUBLIC_LIST") {
    return "STATIC_PUBLIC_LIST_EXHAUSTION";
  }
  return "OFFICIAL_HTML_PAGINATION_EVIDENCE";
}

function buildProfiles(): CompanyRecruitmentProfile[] {
  const seedsByCompanyId = new Map<string, (typeof COMPANY_RECRUITMENT_PROFILE_SEEDS)[number]>();
  for (const seed of COMPANY_RECRUITMENT_PROFILE_SEEDS) {
    if (seedsByCompanyId.has(seed.companyId)) {
      throw new Error(`DUPLICATE_COMPANY_RECRUITMENT_PROFILE:${seed.companyId}`);
    }
    seedsByCompanyId.set(seed.companyId, seed);
  }
  if (seedsByCompanyId.size !== candidateCompanies.length) {
    throw new Error("COMPANY_RECRUITMENT_PROFILE_ROSTER_CARDINALITY_MISMATCH");
  }

  const seenSourceIds = new Set<string>();
  const profiles = candidateCompanies.map((company): CompanyRecruitmentProfile => {
    const seed = seedsByCompanyId.get(company.id);
    if (!seed) throw new Error(`MISSING_COMPANY_RECRUITMENT_PROFILE:${company.id}`);
    const sources = seed.sources.map((sourceSeed): CompanyRecruitmentSourceProfile => {
      if (seenSourceIds.has(sourceSeed.sourceId)) {
        throw new Error(`DUPLICATE_COMPANY_RECRUITMENT_SOURCE_PROFILE:${sourceSeed.sourceId}`);
      }
      seenSourceIds.add(sourceSeed.sourceId);
      const source = company.sources.find(({ id }) => id === sourceSeed.sourceId);
      if (
        !source || source.companyId !== company.id || source.kind !== "SOCIAL" ||
        source.status !== "VERIFIED_SCRAPABLE" || !source.officialEntryUrl ||
        !source.officialChainEvidenceUrl
      ) {
        throw new Error(`INVALID_COMPANY_RECRUITMENT_SOURCE_PROFILE:${sourceSeed.sourceId}`);
      }
      const executionConfig = deepFreezeProfileValue(sourceSeed.executionConfig);
      return Object.freeze({
        companyId: company.id,
        sourceId: source.id,
        officialEntryAllowedUrls: Object.freeze([source.officialEntryUrl]),
        officialChainEvidenceUrl: source.officialChainEvidenceUrl,
        atsKind: source.atsKind,
        chinaSocialScope: CHINA_SOCIAL_SCOPE,
        completenessStrategy: completenessStrategyFor(executionConfig),
        failureDisplayStrategy: "VERIFYING_KEEP_OFFICIAL_ENTRY",
        officialChainVerification: Object.freeze({
          checkedAt: CONFIRMED_ROSTER_V3_PROVENANCE.confirmedAt,
          reason: "Canonical roster V3 binds this official entry to its official-chain evidence; runtime freshness and publication state remain dynamic."
        }),
        executionConfig
      });
    });
    return Object.freeze({ companyId: company.id, sources: Object.freeze(sources) });
  });

  for (const seedCompanyId of seedsByCompanyId.keys()) {
    if (!candidateCompanies.some(({ id }) => id === seedCompanyId)) {
      throw new Error(`ORPHAN_COMPANY_RECRUITMENT_PROFILE:${seedCompanyId}`);
    }
  }
  return profiles;
}

export const companyRecruitmentProfiles: readonly CompanyRecruitmentProfile[] =
  Object.freeze(buildProfiles());

export const companyRecruitmentExecutionConfigsBySourceId:
Readonly<Record<string, CompanyRecruitmentExecutionConfig>> = Object.freeze(Object.fromEntries(
  companyRecruitmentProfiles.flatMap(({ sources }) => sources.map(({ sourceId, executionConfig }) => [
    sourceId,
    executionConfig
  ]))
));
