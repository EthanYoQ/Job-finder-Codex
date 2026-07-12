import type { SourceCrawlPlan } from "../crawler/sourcePlan";
import type { CandidateCompany } from "../data/companyRegistry";
import { assertExactConfirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";

export interface CompanyRegistrySyncResult {
  companyCount: number;
  sourceCount: number;
  hiddenUnplannedVisibleJobCount: number;
}

export interface CompanyRegistrySyncWriteDb {
  company: {
    findMany(args: { select: { id: true } }): Promise<Array<{ id: string }>>;
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
  const companyById = new Map(companies.map((company) => [company.id, company]));
  if (companyById.size !== companies.length) throw new Error("Supplied company roster contains duplicate ids");
  assertExactConfirmedCompanyRosterV3(companies.map(({ id, category }) => ({ id, category })));
  const orderedCompanies = [...companies].sort((left, right) => compareUtf8(left.id, right.id));
  const rosterSourceById = new Map<string, CandidateCompany["sources"][number]>();
  for (const company of orderedCompanies) {
    requireHttpUrl(company.officialWebsiteUrl, `${company.id} officialWebsiteUrl`);
    if (company.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" && company.sources.length > 0) {
      throw new Error(`${company.id} is a no-link company and must have zero sources`);
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
  const rosterSocialSourceIds = [...rosterSourceById.values()]
    .filter((source) => source.kind === "SOCIAL")
    .map((source) => source.id);
  if (sourceIds.size !== rosterSocialSourceIds.length ||
      rosterSocialSourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
    throw new Error("Planned source-ID set must exactly match the supplied roster official-link social source-ID set");
  }
  const orderedPlans = [...plans].sort((left, right) => compareUtf8(left.source.id, right.source.id));
  const runTransaction = db.$transaction.bind(db) as unknown as <T>(
    operation: (tx: CompanyRegistrySyncWriteDb) => Promise<T>
  ) => Promise<T>;
  return runTransaction(async (tx) => {
    const [existingCompanies, existingSources] = await Promise.all([
      tx.company.findMany({ select: { id: true } }),
      tx.recruitmentSource.findMany({ select: { id: true, companyId: true } })
    ]);
    assertExactExistingRows(existingCompanies, existingSources, companyById, orderedPlans);

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

function assertExactExistingRows(
  existingCompanies: readonly { id: string }[],
  existingSources: readonly { id: string; companyId: string }[],
  companyById: ReadonlyMap<string, CandidateCompany>,
  plans: readonly SourceCrawlPlan[]
): void {
  const existingCompanyIds = existingCompanies.map(({ id }) => id);
  if (new Set(existingCompanyIds).size !== existingCompanyIds.length) {
    throw new Error("Existing company rows contain duplicate IDs");
  }
  if (existingCompanyIds.some((companyId) => !companyById.has(companyId))) {
    throw new Error("Existing company rows contain an extra or replacement company");
  }

  const expectedOwnerBySourceId = new Map(plans.map((plan) => [plan.source.id, plan.company.id]));
  const existingSourceIds = existingSources.map(({ id }) => id);
  if (new Set(existingSourceIds).size !== existingSourceIds.length) {
    throw new Error("Existing recruitment source rows contain duplicate IDs");
  }
  for (const source of existingSources) {
    const expectedOwner = expectedOwnerBySourceId.get(source.id);
    if (!expectedOwner) throw new Error("Existing recruitment source rows contain an extra source");
    if (source.companyId !== expectedOwner) {
      throw new Error("Existing recruitment source ownership is reassociated");
    }
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
