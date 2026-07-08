import type { PrismaClient } from "@prisma/client";
import type { SourceCrawlPlan } from "../crawler/sourcePlan";
import type { CandidateCompany } from "../data/companyRegistry";

export interface CompanyRegistrySyncResult {
  companyCount: number;
  sourceCount: number;
}

export interface CompanyRegistrySyncDb {
  company: {
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
        kind: "SOCIAL";
        atsKind: string;
        officialEntryUrl: string;
        officialChainEvidenceUrl: string;
        status: string;
      };
    }): Promise<unknown>;
  };
}

type PrismaCompanyRegistryDb = Pick<PrismaClient, "company" | "recruitmentSource">;

export async function syncPlannedSourcesToDb(
  plans: readonly SourceCrawlPlan[],
  companies: readonly CandidateCompany[],
  db: CompanyRegistrySyncDb | PrismaCompanyRegistryDb
): Promise<CompanyRegistrySyncResult> {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const plannedCompanyIds = [...new Set(plans.map((plan) => plan.company.id))];

  let companyCount = 0;

  for (const companyId of plannedCompanyIds) {
    const company = companyById.get(companyId);

    if (!company) {
      throw new Error(`${companyId} is missing from candidateCompanies`);
    }

    if (!company.officialWebsiteUrl) {
      throw new Error(`${companyId} is missing officialWebsiteUrl`);
    }

    await db.company.upsert({
      where: { id: company.id },
      create: {
        id: company.id,
        officialChineseName: company.officialChineseName,
        officialWebsiteUrl: company.officialWebsiteUrl,
        pinyinName: company.pinyinName,
        inclusionReason: company.inclusionReason
      },
      update: {
        officialChineseName: company.officialChineseName,
        officialWebsiteUrl: company.officialWebsiteUrl,
        pinyinName: company.pinyinName,
        inclusionReason: company.inclusionReason
      }
    });

    companyCount += 1;
  }

  for (const plan of plans) {
    await db.recruitmentSource.upsert({
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
    sourceCount: plans.length
  };
}
