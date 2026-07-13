import { assertExactConfirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";
import { canonicalPhase1ScopeCounts } from "../data/phase1ScopePolicy";
import {
  getCompanyPublicationSnapshotFromDb,
  type PublicationEligibilityDb
} from "../db/publicationEligibilityRepository";
import type {
  CompanyPublicationSnapshot,
  PublicationHealth,
  PublicationState
} from "../domain/publicationEligibility";

export interface CoverageRequest {
  keyword: string;
  offset?: number;
  limit?: number;
}

export interface CoverageCompany {
  id: string;
  companyName: string;
  officialWebsiteUrl: string | null;
  officialCareersUrl: string | null;
  category: "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
  state: PublicationState;
  health: PublicationHealth;
  lastSuccessAt: string | null;
}

export interface CoverageResult {
  companies: CoverageCompany[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

export type CoverageDb = PublicationEligibilityDb;
export type CoveragePublicationSnapshotReader = (
  db: PublicationEligibilityDb
) => Promise<CompanyPublicationSnapshot>;

export async function listCompanyCoverage(
  request: CoverageRequest,
  db: CoverageDb,
  readPublicationSnapshot: CoveragePublicationSnapshotReader = getCompanyPublicationSnapshotFromDb
): Promise<CoverageResult> {
  const keyword = request.keyword.trim().toLocaleLowerCase("zh-CN");
  const offset = request.offset ?? 0;
  const limit = request.limit ?? canonicalPhase1ScopeCounts.fixedRosterCompanyCount;
  const snapshot = await readPublicationSnapshot(db);

  assertExactConfirmedCompanyRosterV3(snapshot.companies.map(({ companyId, category }) => ({
    id: companyId,
    category
  })));

  const companies = snapshot.companies
    .filter((company) => {
      if (keyword === "") return true;
      return company.companyName.toLocaleLowerCase("zh-CN").includes(keyword) ||
        company.pinyinName.toLocaleLowerCase("zh-CN").includes(keyword);
    })
    .sort((left, right) =>
      left.pinyinName.localeCompare(right.pinyinName, "zh-CN") || left.companyId.localeCompare(right.companyId)
    )
    .map((company): CoverageCompany => ({
      id: company.companyId,
      companyName: company.companyName,
      officialWebsiteUrl: company.officialWebsiteUrl,
      officialCareersUrl: company.officialCareersUrl,
      category: company.category,
      state: company.state,
      health: company.health,
      lastSuccessAt: company.lastSuccessAt?.toISOString() ?? null
    }));

  return {
    companies: companies.slice(offset, offset + limit),
    offset,
    limit,
    hasMore: offset + limit < companies.length
  };
}
