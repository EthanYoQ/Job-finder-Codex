import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256, type SourceCrawlPlan } from "../crawler/sourcePlan";
import { candidateCompanies, type CandidateCompany } from "../data/companyRegistry";
import { assertExactConfirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";
import { derivePhase1Scope, isUserAuthorizedPhase1Exclusion } from "../data/phase1ScopePolicy";
import {
  P0_LAUNCH_MANIFEST,
  validateLaunchManifest
} from "../release/launchManifest";

export interface CompanyRegistrySyncResult {
  companyCount: number;
  sourceCount: number;
  hiddenUnplannedVisibleJobCount: number;
}

export interface CompanyRegistrySyncWriteDb {
  company: {
    findMany(args: { select: { id: true; officialChineseName: true } }): Promise<Array<{
      id: string;
      officialChineseName: string;
    }>>;
    update(args: {
      where: { id: string };
      data: { id: string };
    }): Promise<unknown>;
    upsert(args: {
      where: { id: string };
      create: {
        id: string;
        officialChineseName: string;
        officialWebsiteUrl: string;
        pinyinName: string;
        inclusionReason: string;
      };
      update: {
        officialChineseName: string;
        officialWebsiteUrl: string;
        pinyinName: string;
        inclusionReason: string;
      };
    }): Promise<unknown>;
  };
  recruitmentSource: {
    findMany(args: { select: { id: true; companyId: true } }): Promise<Array<{ id: string; companyId: string }>>;
    upsert(args: {
      where: { id: string };
      create: {
        id: string;
        companyId: string;
        kind: "SOCIAL";
        atsKind: string;
        officialEntryUrl: string;
        officialChainEvidenceUrl: string;
        status: string;
      };
      update: {
        companyId: string;
        kind: "SOCIAL";
        atsKind: string;
        officialEntryUrl: string;
        officialChainEvidenceUrl: string;
        status: string;
      };
    }): Promise<unknown>;
  };
}

export interface CompanyRegistrySyncDb {
  company: CompanyRegistrySyncWriteDb["company"];
  recruitmentSource: CompanyRegistrySyncWriteDb["recruitmentSource"];
  $transaction<T>(operation: (tx: any) => Promise<T>): Promise<T>;
}

export async function syncPlannedSourcesToDb(
  plans: readonly SourceCrawlPlan[],
  companies: readonly CandidateCompany[],
  db: CompanyRegistrySyncDb
): Promise<CompanyRegistrySyncResult> {
  return syncAuthoritativeSourcesToDb(plans, companies, db, "CONFIRMED_V3");
}

export async function syncLaunchCohortSourcesToDb(
  plans: readonly SourceCrawlPlan[],
  companies: readonly CandidateCompany[],
  db: CompanyRegistrySyncDb
): Promise<CompanyRegistrySyncResult> {
  return syncAuthoritativeSourcesToDb(plans, companies, db, "LAUNCH_COHORT");
}

async function syncAuthoritativeSourcesToDb(
  plans: readonly SourceCrawlPlan[],
  companies: readonly CandidateCompany[],
  db: CompanyRegistrySyncDb,
  authority: "CONFIRMED_V3" | "LAUNCH_COHORT"
): Promise<CompanyRegistrySyncResult> {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  if (companyById.size !== companies.length) throw new Error("Supplied company roster contains duplicate ids");
  if (authority === "CONFIRMED_V3") {
    assertExactConfirmedCompanyRosterV3(companies.map(({ id, category }) => ({ id, category })));
    derivePhase1Scope(companies);
  } else {
    assertExactLaunchCohort(companies, plans);
  }
  const orderedCompanies = [...companies].sort((left, right) => compareUtf8(left.id, right.id));
  const rosterSourceById = new Map<string, CandidateCompany["sources"][number]>();
  for (const company of orderedCompanies) {
    requireHttpUrl(company.officialWebsiteUrl, `${company.id} officialWebsiteUrl`);
    if (company.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" && company.sources.length > 0) {
      throw new Error(`${company.id} is a no-link company and must have zero sources`);
    }
    if (isUserAuthorizedPhase1Exclusion(company.id) && company.sources.length > 0) {
      throw new Error(`${company.id} is an authorized Phase 1 exclusion and must have zero sources`);
    }
    for (const source of company.sources) {
      if (rosterSourceById.has(source.id)) throw new Error(`Duplicate roster source id: ${source.id}`);
      if (source.companyId !== company.id) throw new Error(`${source.id} has mismatched roster ownership`);
      rosterSourceById.set(source.id, source);
    }
  }

  const sourceIds = new Set<string>();
  for (const plan of plans) {
    if (sourceIds.has(plan.source.id)) throw new Error(`Duplicate planned source id: ${plan.source.id}`);
    sourceIds.add(plan.source.id);
    const company = companyById.get(plan.company.id);
    if (!company) throw new Error(`${plan.company.id} is missing from candidateCompanies`);
    if (isUserAuthorizedPhase1Exclusion(company.id)) {
      throw new Error(`AUTHORIZED_PHASE1_EXCLUSION_HAS_PLAN:${company.id}`);
    }
    if (plan.company.category !== company.category) {
      throw new Error(`${plan.company.id} has mismatched plan category`);
    }
    if (plan.source.kind !== "SOCIAL") throw new Error(`${plan.source.id} is not a social planned source`);
    requireHttpUrl(plan.source.officialEntryUrl, `${plan.source.id} officialEntryUrl`);
    requireHttpUrl(plan.source.officialChainEvidenceUrl, `${plan.source.id} officialChainEvidenceUrl`);
    if (plan.source.companyId !== plan.company.id) throw new Error(`${plan.source.id} has mismatched plan ownership`);
    const rosterSource = rosterSourceById.get(plan.source.id);
    if (!rosterSource) throw new Error(`${plan.source.id} is missing from supplied company roster`);
    if (rosterSource.companyId !== company.id || rosterSource.kind !== plan.source.kind ||
        rosterSource.atsKind !== plan.source.atsKind || rosterSource.status !== plan.source.status ||
        rosterSource.officialEntryUrl !== plan.source.officialEntryUrl ||
        rosterSource.officialChainEvidenceUrl !== plan.source.officialChainEvidenceUrl) {
      throw new Error(`${plan.source.id} does not exactly match the supplied roster source binding`);
    }
  }
  const rosterExecutableSocialSourceIds = [...rosterSourceById.values()]
    .filter((source) =>
      source.kind === "SOCIAL" &&
      source.status === "VERIFIED_SCRAPABLE" &&
      Boolean(source.officialEntryUrl) &&
      Boolean(source.officialChainEvidenceUrl)
    )
    .map((source) => source.id);
  if (sourceIds.size !== rosterExecutableSocialSourceIds.length ||
      rosterExecutableSocialSourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
    throw new Error("Planned source-ID set must exactly match the supplied roster executable social source-ID set");
  }
  const orderedPlans = [...plans].sort((left, right) => compareUtf8(left.source.id, right.source.id));
  const runTransaction = db.$transaction.bind(db) as unknown as <T>(
    operation: (tx: CompanyRegistrySyncWriteDb) => Promise<T>
  ) => Promise<T>;
  return runTransaction(async (tx) => {
    const [existingCompanies, existingSources] = await Promise.all([
      tx.company.findMany({ select: { id: true, officialChineseName: true } }),
      tx.recruitmentSource.findMany({ select: { id: true, companyId: true } })
    ]);
    assertUniqueExistingRows(existingCompanies, existingSources);
    const legacyCompanyIds = deriveLegacyCompanyIdMap(existingCompanies, orderedCompanies);
    assertCompatibleExistingRows(existingSources, orderedPlans, legacyCompanyIds);
    await canonicalizeLegacyCompanyIds(tx, legacyCompanyIds);

    let companyCount = 0;
    for (const company of orderedCompanies) {
      const officialWebsiteUrl = company.officialWebsiteUrl!;
      await tx.company.upsert({
      where: { id: company.id },
      create: {
        id: company.id,
        officialChineseName: company.officialChineseName,
        officialWebsiteUrl,
        pinyinName: company.pinyinName,
        inclusionReason: company.category
      },
      update: {
        officialChineseName: company.officialChineseName,
        officialWebsiteUrl,
        pinyinName: company.pinyinName,
        inclusionReason: company.category
      }
    });

      companyCount += 1;
    }

    for (const plan of orderedPlans) {
      await tx.recruitmentSource.upsert({
      where: { id: plan.source.id },
      create: {
        id: plan.source.id,
        companyId: plan.company.id,
        kind: "SOCIAL",
        atsKind: plan.source.atsKind,
        officialEntryUrl: plan.source.officialEntryUrl,
        officialChainEvidenceUrl: plan.source.officialChainEvidenceUrl,
        status: plan.source.status
      },
      update: {
        companyId: plan.company.id,
        kind: "SOCIAL",
        atsKind: plan.source.atsKind,
        officialEntryUrl: plan.source.officialEntryUrl,
        officialChainEvidenceUrl: plan.source.officialChainEvidenceUrl,
        status: plan.source.status
      }
    });
    }

    return {
      companyCount,
      sourceCount: plans.length,
      hiddenUnplannedVisibleJobCount: 0
    };
  });
}

function assertExactLaunchCohort(
  companies: readonly CandidateCompany[],
  plans: readonly SourceCrawlPlan[]
): void {
  const errors = validateLaunchManifest(P0_LAUNCH_MANIFEST, companies.map(({ id }) => id));
  const expectedCompanies = new Map(P0_LAUNCH_MANIFEST.companies.map((company) => [company.companyId, company]));
  if (companies.length !== expectedCompanies.size || companies.some((company) =>
    expectedCompanies.get(company.id)?.category !== company.category)) {
    errors.push("RUNTIME_LAUNCH_COMPANY_SET_MISMATCH");
  }
  const expectedPlannedSourceIds = P0_LAUNCH_MANIFEST.companies.map(({ source }) => source.sourceId);
  const sourceIds = plans.map(plan => plan.source.id);
  if (sourceIds.length !== expectedPlannedSourceIds.length || new Set(sourceIds).size !== sourceIds.length ||
      expectedPlannedSourceIds.some(sourceId => !sourceIds.includes(sourceId))) {
    errors.push("RUNTIME_LAUNCH_SOURCE_SET_MISMATCH");
  }
  // The frozen manifest owns cohort membership. Current source configuration is
  // a separate authority: reviewed adapter migrations must match the complete
  // canonical plan, never merely an adapter name supplied by the caller.
  const canonical = new Map(buildStagedSourceCrawlPlans(candidateCompanies).map(plan => [plan.source.id, plan]));
  const memberBySource = new Map(P0_LAUNCH_MANIFEST.companies.map(member => [member.source.sourceId, member]));
  for (const plan of plans) {
    const member = memberBySource.get(plan.source.id), current = canonical.get(plan.source.id);
    if (!member || !current || plan.company.id !== member.companyId ||
        plan.source.surfaceId !== member.source.surfaceId ||
        sourcePlanConfigSha256(plan) !== sourcePlanConfigSha256(current)) {
      errors.push(`RUNTIME_LAUNCH_CURRENT_SOURCE_CONFIG_MISMATCH:${plan.source.id}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Launch Cohort registry sync rejected authority: ${errors.join(",")}`);
  }
}

function assertUniqueExistingRows(
  existingCompanies: readonly { id: string; officialChineseName?: string }[],
  existingSources: readonly { id: string; companyId: string }[]
): void {
  const existingCompanyIds = existingCompanies.map(({ id }) => id);
  if (new Set(existingCompanyIds).size !== existingCompanyIds.length) {
    throw new Error("Existing company rows contain duplicate IDs");
  }
  const existingSourceIds = existingSources.map(({ id }) => id);
  if (new Set(existingSourceIds).size !== existingSourceIds.length) {
    throw new Error("Existing recruitment source rows contain duplicate IDs");
  }
}

function assertCompatibleExistingRows(
  existingSources: readonly { id: string; companyId: string }[],
  plans: readonly SourceCrawlPlan[],
  legacyCompanyIds: ReadonlyMap<string, string>
): void {
  const expectedOwnerBySourceId = new Map(plans.map((plan) => [plan.source.id, plan.company.id]));
  for (const source of existingSources) {
    const expectedOwner = expectedOwnerBySourceId.get(source.id);
    if (!expectedOwner) continue;
    if (source.companyId !== expectedOwner && legacyCompanyIds.get(source.companyId) !== expectedOwner) {
      throw new Error("Existing recruitment source ownership is reassociated");
    }
  }
}

function deriveLegacyCompanyIdMap(
  existingCompanies: readonly { id: string; officialChineseName?: string }[],
  companies: readonly CandidateCompany[]
): ReadonlyMap<string, string> {
  const existingIds = new Set(existingCompanies.map(({ id }) => id));
  const existingByOfficialName = new Map<string, Array<{ id: string; officialChineseName?: string }>>();
  for (const company of existingCompanies) {
    if (!company.officialChineseName) continue;
    const matches = existingByOfficialName.get(company.officialChineseName) ?? [];
    matches.push(company);
    existingByOfficialName.set(company.officialChineseName, matches);
  }
  const canonicalIds = new Set(companies.map(({ id }) => id));
  const legacyCompanyIds = new Map<string, string>();

  for (const company of companies) {
    if (existingIds.has(company.id)) continue;
    const aliases = existingByOfficialName.get(company.officialChineseName) ?? [];
    if (aliases.length > 1) throw new Error(`Ambiguous legacy company aliases: ${company.officialChineseName}`);
    const legacyAlias = aliases[0];
    if (!legacyAlias) continue;
    if (canonicalIds.has(legacyAlias.id)) {
      throw new Error(`Canonical company id is already assigned to another roster member: ${legacyAlias.id}`);
    }
    legacyCompanyIds.set(legacyAlias.id, company.id);
  }
  return legacyCompanyIds;
}

async function canonicalizeLegacyCompanyIds(
  tx: CompanyRegistrySyncWriteDb,
  legacyCompanyIds: ReadonlyMap<string, string>
): Promise<void> {
  for (const [legacyId, canonicalId] of legacyCompanyIds) {
    await tx.company.update({
      where: { id: legacyId },
      data: { id: canonicalId }
    });
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function requireHttpUrl(value: string | undefined, field: string): void {
  if (!value?.trim()) throw new Error(`${field} is missing`);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${field} must be an absolute HTTP(S) URL`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field} must be an absolute HTTP(S) URL`);
  }
}
