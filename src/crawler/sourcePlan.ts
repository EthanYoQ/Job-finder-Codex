import { createHash } from "node:crypto";
import {
  candidateCompanies,
  expectedOfficialSurfaces,
  hasUnresolvedSurfaceScope,
  type CandidateCompany,
  type CandidateRecruitmentSource,
  type ExpectedOfficialRecruitmentSurface,
  type ExpectedRecruitmentChannel
} from "../data/companyRegistry";
import {
  isUserAuthorizedPhase1Exclusion,
  USER_AUTHORIZED_PHASE1_EXCLUSION
} from "../data/phase1ScopePolicy";
import type { HtmlTableConfig, OfficialJsonConfig } from "./adapters/types";
import type { HotjobWecruitFetchConfig } from "./hotjobWecruitSourceFetch";
import type { HotjobLegacyFetchConfig } from "./hotjobLegacySourceFetch";
import type { OfficialJsonFetchConfig } from "./officialJsonSourceFetch";
import type { WorkdayFetchConfig } from "./workdaySourceFetch";
import { companyRecruitmentExecutionConfigsBySourceId } from "./companyRecruitmentProfiles";
import type {
  CompanyRecruitmentExecutionConfig,
  MokaFetchConfig,
  ProfileBoundSourceConfig
} from "./companyRecruitmentProfiles/types";
export type { MokaFetchConfig } from "./companyRecruitmentProfiles/types";

export type CrawlAdapterId = "official-json" | "html-table";

export type ExecutableExpectedChannel = Pick<ExpectedRecruitmentChannel, "channelId" | "kind">;
type SourcePlanPolicy = "DISCOVERY" | "STAGED" | "FULL_RELEASE";

type PlannedCompany = Pick<CandidateCompany, "id" | "officialChineseName"> & { category?: CandidateCompany["category"] };
type PlannedSource = Required<
  Pick<
    CandidateRecruitmentSource,
    | "id"
    | "companyId"
    | "kind"
    | "atsKind"
    | "status"
    | "officialEntryUrl"
    | "officialChainEvidenceUrl"
  >
> & { surfaceId?: string };

export type SourceCrawlPlan = (
  | {
      adapterId: "official-json";
      company: PlannedCompany;
      source: PlannedSource;
      json: OfficialJsonConfig;
      officialJsonFetch?: OfficialJsonFetchConfig;
      workday?: WorkdayFetchConfig;
      hotjob?: HotjobWecruitFetchConfig;
      hotjobLegacy?: HotjobLegacyFetchConfig;
      profileBoundSource?: ProfileBoundSourceConfig;
      moka?: MokaFetchConfig;
    }
  | {
      adapterId: "html-table";
      company: PlannedCompany;
      source: PlannedSource;
      table: HtmlTableConfig;
    }) & {
      executionAuthority?: "STAGED";
      expectedChannels?: readonly ExecutableExpectedChannel[];
      expectedChannelSetHash?: string;
    };

const CANONICAL_EXECUTION_CONFIG_JSON_BY_SOURCE_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(companyRecruitmentExecutionConfigsBySourceId).map(([sourceId, config]) => [
      sourceId,
      representativeExecutionConfigJson(config)
    ])
  )
);

export function buildSourceCrawlPlans(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[] = expectedOfficialSurfaces
): SourceCrawlPlan[] {
  return buildPlans(companies, surfaces, "FULL_RELEASE");
}

export function buildStagedSourceCrawlPlans(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[] = expectedOfficialSurfaces
): SourceCrawlPlan[] {
  return buildPlans(companies, surfaces, "STAGED");
}

export function buildDiscoverySourcePlanCandidates(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[] = expectedOfficialSurfaces
): SourceCrawlPlan[] {
  return buildPlans(companies, surfaces, "DISCOVERY");
}

function buildPlans(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[],
  policy: SourcePlanPolicy
): SourceCrawlPlan[] {
  const fullRelease = policy === "FULL_RELEASE";
  const oracleBySurfaceId = new Map(surfaces.map((surface) => [surface.surfaceId, surface]));
  return companies.flatMap((company) =>
    isUserAuthorizedPhase1Exclusion(company.id) || company.targetStatus === USER_AUTHORIZED_PHASE1_EXCLUSION
      ? []
      :
    company.sources.flatMap((source): SourceCrawlPlan[] => {
      if (
        source.kind !== "SOCIAL" ||
        source.status !== "VERIFIED_SCRAPABLE" ||
        !source.officialEntryUrl ||
        !source.officialChainEvidenceUrl
      ) {
        return [];
      }

      const representativeConfig = companyRecruitmentExecutionConfigsBySourceId[source.id];
      const config = representativeConfig ? structuredClone(representativeConfig) : undefined;
      const surface = source.surfaceId ? oracleBySurfaceId.get(source.surfaceId) : undefined;
      if (
        !config ||
        (policy === "STAGED" && !hasCanonicalStagedAuthority(company, source, surface)) ||
        (fullRelease && config.formalEligibility === "QUARANTINED_PENDING_TRUSTED_ORACLE") ||
        !surface ||
        surface.companyId !== company.id ||
        surface.kind !== "SOCIAL" ||
        surface.status !== "INCLUDED" ||
        (fullRelease && surface.oracleStatus !== "INDEPENDENTLY_VERIFIED") ||
        (fullRelease && hasUnresolvedSurfaceScope(surface)) ||
        surface.officialEntryUrl !== source.officialEntryUrl ||
        !surface.officialChainEvidenceUrls.includes(source.officialChainEvidenceUrl) ||
        surface.adapterId !== config.adapterId
      ) {
        return [];
      }

      const plannedCompany: PlannedCompany = {
        id: company.id,
        officialChineseName: company.officialChineseName,
        category: company.category
      };
      const plannedSource: PlannedSource = {
        id: source.id,
        ...(source.surfaceId ? { surfaceId: source.surfaceId } : {}),
        companyId: source.companyId,
        kind: source.kind,
        atsKind: source.atsKind,
        status: source.status,
        officialEntryUrl: source.officialEntryUrl,
        officialChainEvidenceUrl: source.officialChainEvidenceUrl
      };

      let expectedChannels: ExecutableExpectedChannel[];
      try {
        expectedChannels = canonicalExpectedChannels(
          surface.channels
            .filter((channel) => channel.status === "EXPECTED")
            .map(({ channelId, kind }) => ({ channelId, kind }))
        );
      } catch {
        return [];
      }
      if (policy === "STAGED" && expectedChannels.length === 0) {
        try {
          expectedChannels = stagedConfiguredExpectedChannels(config, source.id);
        } catch {
          return [];
        }
      }
      if (fullRelease &&
          (!hasExactAdapterChannelCoverage(config, source.id, expectedChannels) || expectedChannels.length === 0)) {
        return [];
      }
      if (policy === "STAGED" &&
          (!hasExactStagedAdapterChannelCoverage(config, source.id, expectedChannels) || expectedChannels.length === 0)) {
        return [];
      }
      const channelBinding = policy === "STAGED"
        ? {
            executionAuthority: "STAGED" as const,
            expectedChannels,
            expectedChannelSetHash: expectedChannelSetHash(expectedChannels)
          }
        : fullRelease
          ? { expectedChannels, expectedChannelSetHash: expectedChannelSetHash(expectedChannels) }
          : {};

      const plan: SourceCrawlPlan =
        config.adapterId === "official-json"
          ? {
              adapterId: "official-json",
              company: plannedCompany,
              source: plannedSource,
              ...channelBinding,
              json: config.json,
              ...(config.officialJsonFetch ? { officialJsonFetch: config.officialJsonFetch } : {}),
              ...(config.workday ? { workday: config.workday } : {}),
              ...(config.hotjob ? { hotjob: config.hotjob } : {}),
              ...(config.hotjobLegacy ? { hotjobLegacy: config.hotjobLegacy } : {}),
              ...(config.profileBoundSource ? { profileBoundSource: config.profileBoundSource } : {}),
              ...(config.moka ? { moka: config.moka } : {})
            }
          : {
              adapterId: "html-table",
              company: plannedCompany,
              source: plannedSource,
              ...channelBinding,
              table: config.table
            };

      if (policy === "STAGED") {
        try {
          validateExecutablePlanChannelBinding(plan);
        } catch {
          return [];
        }
      }
      return [plan];
    })
  );
}

export function canonicalExpectedChannels(
  channels: readonly ExecutableExpectedChannel[]
): ExecutableExpectedChannel[] {
  const canonical = channels.map((channel) => ({ channelId: channel.channelId, kind: channel.kind }));
  if (canonical.some((channel) => !channel.channelId.trim())) throw new Error("Expected channel id must be nonblank");
  if (new Set(canonical.map((channel) => channel.channelId)).size !== canonical.length) {
    throw new Error("Duplicate expected channel id");
  }
  return canonical.sort((left, right) =>
    compareUtf8(left.channelId, right.channelId) || compareUtf8(left.kind, right.kind)
  );
}

export function expectedChannelSetHash(channels: readonly ExecutableExpectedChannel[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalExpectedChannels(channels)), "utf8")
    .digest("hex");
}

function configuredChannelIds(config: CompanyRecruitmentExecutionConfig, sourceId: string): string[] {
  if (config.adapterId === "official-json" && config.profileBoundSource?.expectedChannelIds) {
    return [...config.profileBoundSource.expectedChannelIds];
  }
  if (
    config.adapterId === "official-json" &&
    config.officialJsonFetch?.kind === "redsea-zp-channel"
  ) {
    return config.officialJsonFetch.channels
      .filter(({ purpose }) => purpose === "SOCIAL")
      .map(({ channelQrId }) => channelQrId);
  }
  return [`source:${sourceId}:default`];
}

function stagedConfiguredChannelIds(config: CompanyRecruitmentExecutionConfig, sourceId: string): string[] {
  if (config.adapterId === "html-table" && config.table.pagination?.talentbrewScope) {
    return config.table.pagination.talentbrewScope.allowedPartitions.map(({ channelId }) => channelId);
  }
  return configuredChannelIds(config, sourceId);
}

function stagedConfiguredExpectedChannels(
  config: CompanyRecruitmentExecutionConfig,
  sourceId: string
): ExecutableExpectedChannel[] {
  return canonicalExpectedChannels(
    stagedConfiguredChannelIds(config, sourceId).map((channelId) => ({ channelId, kind: "SOCIAL" }))
  );
}

function hasExactAdapterChannelCoverage(
  config: CompanyRecruitmentExecutionConfig,
  sourceId: string,
  channels: readonly ExecutableExpectedChannel[]
): boolean {
  try {
    const expectedIds = canonicalExpectedChannels(channels).map((channel) => channel.channelId);
    const configuredIds = configuredChannelIds(config, sourceId).sort(compareUtf8);
    return new Set(configuredIds).size === configuredIds.length &&
      JSON.stringify(expectedIds) === JSON.stringify(configuredIds);
  } catch {
    return false;
  }
}

function hasExactStagedAdapterChannelCoverage(
  config: CompanyRecruitmentExecutionConfig,
  sourceId: string,
  channels: readonly ExecutableExpectedChannel[]
): boolean {
  try {
    if (channels.some((channel) => channel.kind !== "SOCIAL")) return false;
    const expectedIds = canonicalExpectedChannels(channels).map((channel) => channel.channelId);
    const configuredIds = stagedConfiguredChannelIds(config, sourceId).sort(compareUtf8);
    return new Set(configuredIds).size === configuredIds.length &&
      JSON.stringify(expectedIds) === JSON.stringify(configuredIds);
  } catch {
    return false;
  }
}

export function validateExecutablePlanChannelBinding(plan: SourceCrawlPlan): void {
  if (!plan.expectedChannels || !plan.expectedChannelSetHash) {
    throw new Error("Executable source plan channel binding is required");
  }
  const canonical = canonicalExpectedChannels(plan.expectedChannels);
  if (JSON.stringify(canonical) !== JSON.stringify(plan.expectedChannels)) {
    throw new Error("Executable source plan channels must be canonical");
  }
  if (expectedChannelSetHash(canonical) !== plan.expectedChannelSetHash) {
    throw new Error("Executable source plan channel hash mismatch");
  }
  if (plan.adapterId === "official-json" && plan.profileBoundSource && [
    plan.officialJsonFetch,
    plan.workday,
    plan.hotjob,
    plan.hotjobLegacy,
    plan.moka
  ].some((strategy) => strategy !== undefined)) {
    throw new Error("Profile-bound source strategy must be exclusive");
  }
  const staged = plan.executionAuthority === "STAGED";
  if (staged && !hasCanonicalStagedPlanAuthority(plan)) {
    throw new Error("Staged source plan does not match canonical registry authority");
  }
  if (staged && !hasCanonicalStagedExecutionConfig(plan)) {
    throw new Error("Staged source plan execution config does not match canonical registry configuration");
  }
  const expectedAdapter = staged && plan.source.atsKind === "BEISEN_ZHIYE"
    ? plan.adapterId
    : plan.source.atsKind === "OFFICIAL_HTML" || plan.source.atsKind === "SUCCESSFACTORS"
      ? "html-table"
      : plan.source.atsKind === "UNKNOWN" || plan.source.atsKind === "BROWSER_FALLBACK"
        ? undefined
        : "official-json";
  if (!expectedAdapter || expectedAdapter !== plan.adapterId) {
    throw new Error("Executable source plan adapter does not match ATS kind");
  }
  const config: CompanyRecruitmentExecutionConfig = plan.adapterId === "official-json"
    ? {
        adapterId: "official-json", json: plan.json,
        ...(plan.officialJsonFetch ? { officialJsonFetch: plan.officialJsonFetch } : {}),
        ...(plan.workday ? { workday: plan.workday } : {}),
        ...(plan.hotjob ? { hotjob: plan.hotjob } : {}),
        ...(plan.hotjobLegacy ? { hotjobLegacy: plan.hotjobLegacy } : {}),
        ...(plan.profileBoundSource ? { profileBoundSource: plan.profileBoundSource } : {}),
        ...(plan.moka ? { moka: plan.moka } : {})
      }
    : { adapterId: "html-table", table: plan.table };
  const exactCoverage = staged
    ? hasExactStagedAdapterChannelCoverage(config, plan.source.id, canonical)
    : hasExactAdapterChannelCoverage(config, plan.source.id, canonical);
  if (!exactCoverage) {
    throw new Error("Executable source plan channels are not fully covered by adapter config");
  }
}

export interface SourcePlanCoverage {
  unexpectedPlanSourceIds: string[];
  missingEligibleSurfaceIds: string[];
  blockedExpectedSurfaceIds: string[];
}

export function getSourcePlanCoverage(
  companies: readonly CandidateCompany[],
  plans: readonly SourceCrawlPlan[]
): SourcePlanCoverage {
  const companyIds = new Set(companies.map((company) => company.id));
  const surfaces = expectedOfficialSurfaces.filter((surface) => companyIds.has(surface.companyId));
  const jobSurfaces = surfaces.filter((surface) =>
    surface.status !== "VERIFIED_NON_JOB_RECRUITMENT_INFORMATION"
  );
  const eligible = jobSurfaces.filter(
    (surface) =>
      surface.kind === "SOCIAL" &&
      surface.status === "INCLUDED" &&
      surface.oracleStatus === "INDEPENDENTLY_VERIFIED" &&
      !hasUnresolvedSurfaceScope(surface) &&
      Boolean(surface.officialEntryUrl) &&
      surface.officialChainEvidenceUrls.length > 0 &&
      Boolean(surface.adapterId)
  );
  const plannedSurfaceIds = new Set(plans.map((plan) => plan.source.surfaceId).filter(Boolean));
  const eligibleIds = new Set(eligible.map((surface) => surface.surfaceId));
  return {
    unexpectedPlanSourceIds: plans
      .filter((plan) => !plan.source.surfaceId || !eligibleIds.has(plan.source.surfaceId))
      .map((plan) => plan.source.id)
      .sort(compareUtf8),
    missingEligibleSurfaceIds: eligible
      .filter((surface) => !plannedSurfaceIds.has(surface.surfaceId))
      .map((surface) => surface.surfaceId)
      .sort(compareUtf8),
    blockedExpectedSurfaceIds: jobSurfaces
      .filter((surface) => surface.kind === "SOCIAL" && !eligibleIds.has(surface.surfaceId))
      .map((surface) => surface.surfaceId)
      .sort(compareUtf8)
  };
}

function canonicalPlanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPlanValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) => [key, canonicalPlanValue(item)])
    );
  }
  return value;
}

export function sourcePlanConfigSha256(plan: SourceCrawlPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalPlanValue(plan)), "utf8")
    .digest("hex");
}

export function activeSourcePlanSha256(plans: readonly SourceCrawlPlan[]): string {
  const ordered = [...plans].sort((left, right) => compareUtf8(left.source.id, right.source.id));
  return createHash("sha256")
    .update(JSON.stringify(canonicalPlanValue(ordered)), "utf8")
    .digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function hasCanonicalStagedAuthority(
  company: CandidateCompany,
  source: CandidateRecruitmentSource,
  surface: ExpectedOfficialRecruitmentSurface | undefined
): boolean {
  const canonicalCompany = candidateCompanies.find((candidate) => candidate.id === company.id);
  const canonicalSource = canonicalCompany?.sources.find((candidate) => candidate.id === source.id);
  const canonicalSurface = canonicalSource?.surfaceId
    ? expectedOfficialSurfaces.find((candidate) => candidate.surfaceId === canonicalSource.surfaceId)
    : undefined;
  return Boolean(
    canonicalCompany && canonicalSource && canonicalSurface && surface &&
    company.officialChineseName === canonicalCompany.officialChineseName &&
    company.pinyinName === canonicalCompany.pinyinName &&
    company.category === canonicalCompany.category &&
    company.targetStatus === canonicalCompany.targetStatus &&
    company.officialWebsiteUrl === canonicalCompany.officialWebsiteUrl &&
    hasCanonicalSourceAuthority(source, canonicalSource) &&
    surface.surfaceId === canonicalSurface.surfaceId &&
    surface.companyId === canonicalSurface.companyId &&
    surface.kind === canonicalSurface.kind &&
    surface.officialEntryUrl === canonicalSurface.officialEntryUrl &&
    JSON.stringify(surface.officialChainEvidenceUrls) === JSON.stringify(canonicalSurface.officialChainEvidenceUrls) &&
    surface.atsKind === canonicalSurface.atsKind &&
    surface.adapterId === canonicalSurface.adapterId &&
    surface.status === canonicalSurface.status
  );
}

function hasCanonicalStagedPlanAuthority(plan: SourceCrawlPlan): boolean {
  const canonicalCompany = candidateCompanies.find((candidate) => candidate.id === plan.company.id);
  const canonicalSource = canonicalCompany?.sources.find((candidate) => candidate.id === plan.source.id);
  return Boolean(
    canonicalCompany && canonicalSource &&
    plan.company.officialChineseName === canonicalCompany.officialChineseName &&
    plan.company.category === canonicalCompany.category &&
    hasCanonicalPlannedSourceAuthority(plan.source, canonicalSource)
  );
}

function hasCanonicalStagedExecutionConfig(plan: SourceCrawlPlan): boolean {
  const canonicalExecutionConfigJson = CANONICAL_EXECUTION_CONFIG_JSON_BY_SOURCE_ID[plan.source.id];
  if (!canonicalExecutionConfigJson) return false;
  const planExecutionConfig: CompanyRecruitmentExecutionConfig = plan.adapterId === "official-json"
    ? {
        adapterId: "official-json",
        json: plan.json,
        ...(plan.officialJsonFetch ? { officialJsonFetch: plan.officialJsonFetch } : {}),
        ...(plan.workday ? { workday: plan.workday } : {}),
        ...(plan.hotjob ? { hotjob: plan.hotjob } : {}),
        ...(plan.hotjobLegacy ? { hotjobLegacy: plan.hotjobLegacy } : {}),
        ...(plan.profileBoundSource ? { profileBoundSource: plan.profileBoundSource } : {}),
        ...(plan.moka ? { moka: plan.moka } : {})
      }
    : { adapterId: "html-table", table: plan.table };
  return representativeExecutionConfigJson(planExecutionConfig) === canonicalExecutionConfigJson;
}

function representativeExecutionConfigJson(config: CompanyRecruitmentExecutionConfig): string {
  const { formalEligibility: _formalEligibility, ...executionConfig } = config;
  return JSON.stringify(canonicalPlanValue(executionConfig));
}

function hasCanonicalPlannedSourceAuthority(
  source: PlannedSource,
  canonicalSource: CandidateRecruitmentSource
): boolean {
  return source.id === canonicalSource.id &&
    source.surfaceId === canonicalSource.surfaceId &&
    source.companyId === canonicalSource.companyId &&
    source.kind === canonicalSource.kind &&
    source.atsKind === canonicalSource.atsKind &&
    source.status === canonicalSource.status &&
    source.officialEntryUrl === canonicalSource.officialEntryUrl &&
    source.officialChainEvidenceUrl === canonicalSource.officialChainEvidenceUrl;
}

function hasCanonicalSourceAuthority(
  source: CandidateRecruitmentSource,
  canonicalSource: CandidateRecruitmentSource
): boolean {
  return source.id === canonicalSource.id &&
    source.surfaceId === canonicalSource.surfaceId &&
    source.companyId === canonicalSource.companyId &&
    source.kind === canonicalSource.kind &&
    source.atsKind === canonicalSource.atsKind &&
    source.status === canonicalSource.status &&
    source.officialEntryUrl === canonicalSource.officialEntryUrl &&
    source.officialChainEvidenceUrl === canonicalSource.officialChainEvidenceUrl &&
    source.campusEntryUrl === canonicalSource.campusEntryUrl;
}

export function getPlanBySourceId(
  plans: readonly SourceCrawlPlan[],
  sourceId: string
): SourceCrawlPlan | undefined {
  return plans.find((plan) => plan.source.id === sourceId);
}
