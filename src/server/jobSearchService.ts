import { SearchRequestSchema, type JobCategory } from "../domain/search";
import { toPrismaJobCategory, type PrismaJobCategoryName } from "../db/prismaMappers";
import {
  getCompanyPublicationSnapshotFromDb,
  type PublicationEligibilityDb
} from "../db/publicationEligibilityRepository";
import type { CompanyPublicationSnapshot } from "../domain/publicationEligibility";

export interface PrismaJobSearchTransactionDb extends PublicationEligibilityDb {
  job: {
    findMany(args: PrismaLikeJobFindManyArgs): Promise<unknown[]>;
  };
  crawlObservation: {
    findFirst(args: PrismaLikeCrawlObservationFindFirstArgs): Promise<{ crawledAt: Date } | null>;
  };
}

interface RepeatableReadJobSearchTransactionOptions {
  isolationLevel: "RepeatableRead";
  maxWait: number;
  timeout: number;
}

export interface PrismaJobSearchDb extends PrismaJobSearchTransactionDb {
  $transaction?<T>(
    operation: (transaction: PrismaJobSearchTransactionDb) => Promise<T>,
    options: RepeatableReadJobSearchTransactionOptions
  ): Promise<T>;
}

interface JobRow {
  id: string;
  sourceId: string;
  companyId: string;
  officialTitle: string;
  auxiliaryChineseTitle: string | null;
  humanCorrectedTitle: string | null;
  officialUrl: string;
  officialPublishedAt: Date | null;
  city: string;
  cities: string[];
  category: string;
  humanCorrectedCategory: string | null;
  isNew: boolean;
  company: {
    id: string;
    officialChineseName: string;
    pinyinName: string;
  };
}

interface PrismaLikeJobFindManyArgs {
  where: PrismaLikeJobWhereInput;
  include: {
    company: true;
  };
}

interface PrismaLikeCrawlObservationFindFirstArgs {
  select: {
    crawledAt: true;
  };
  orderBy: {
    crawledAt: "desc";
  };
}

interface PrismaLikeJobWhereInput {
  visibleInFrontend: true;
  lifecycleStatus: "ACTIVE";
  OR: Array<Record<string, unknown>>;
  AND?: Array<Record<string, unknown>>;
  companyId?: {
    in: string[];
  };
  sourceId: {
    in: string[];
  };
  isNew?: true;
}

export interface DatabaseSearchJobResult {
  id: string;
  title: string;
  officialTitle: string;
  officialPublishedAt: string | null;
  city: string;
  category: JobCategory;
  isNew: boolean;
  officialUrl: string;
}

export interface DatabaseSearchCompanyResult {
  id: string;
  companyName: string;
  pinyin: string;
  jobs: DatabaseSearchJobResult[];
}

export interface DatabaseSearchResult {
  companies: DatabaseSearchCompanyResult[];
  totalJobs: number;
  lastUpdatedAt: string | null;
}

const PRISMA_TO_JOB_CATEGORY: Record<PrismaJobCategoryName, JobCategory> = {
  SALES: "销售",
  MARKETING: "市场",
  BUSINESS: "商务",
  CHANNEL: "渠道",
  KA: "KA",
  MEDICAL_AFFAIRS: "医学事务",
  CLINICAL_OPERATIONS: "临床运营",
  REGULATORY: "注册",
  DRUG_SAFETY: "药物警戒/安全",
  RESEARCH_SCIENCE: "研发/科学",
  MANUFACTURING_ENGINEERING: "生产/工程",
  QUALITY: "质量",
  MARKET_ACCESS_GOVERNMENT: "市场准入/政府事务",
  DATA_IT: "数据/IT",
  SUPPLY_CHAIN_PROCUREMENT: "供应链/采购",
  CORPORATE_FUNCTIONS: "职能",
  OTHER: "其他"
};

export type PublicationSnapshotReader = (
  db: PublicationEligibilityDb
) => Promise<CompanyPublicationSnapshot>;

export async function searchJobsFromDatabase(
  request: unknown,
  db: PrismaJobSearchDb,
  readPublicationSnapshot: PublicationSnapshotReader = getCompanyPublicationSnapshotFromDb
): Promise<DatabaseSearchResult> {
  const parsed = SearchRequestSchema.parse(request);
  if (typeof db.$transaction !== "function") {
    throw new Error("REPEATABLE_READ_JOB_SEARCH_TRANSACTION_REQUIRED");
  }
  return db.$transaction(
    (transaction) => searchJobsWithinTransaction(parsed, transaction, readPublicationSnapshot),
    { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 10_000 }
  );
}

async function searchJobsWithinTransaction(
  parsed: ReturnType<typeof SearchRequestSchema.parse>,
  db: PrismaJobSearchTransactionDb,
  readPublicationSnapshot: PublicationSnapshotReader
): Promise<DatabaseSearchResult> {
  const snapshot = await readPublicationSnapshot(db);
  const eligibleCompanyIds = [...new Set(snapshot.eligibleCompanyIds)];
  const eligibleSourceIds = [...new Set(snapshot.eligibleSourceIds)];

  if (eligibleSourceIds.length === 0) {
    return { companies: [], totalJobs: 0, lastUpdatedAt: null };
  }

  const rawJobRows = (await db.job.findMany({
    where: buildWhereClause(parsed, eligibleSourceIds),
    include: { company: true }
  })) as JobRow[];
  const eligibleSourceIdSet = new Set(eligibleSourceIds);
  const eligibleCompanyIdSet = new Set(eligibleCompanyIds);
  const jobRows = rawJobRows.filter((row) =>
    eligibleSourceIdSet.has(row.sourceId) && eligibleCompanyIdSet.has(row.companyId)
  );

  const companies = sortCompanies(groupRowsByCompany(jobRows), parsed.sort);

  return {
    companies,
    totalJobs: jobRows.length,
    lastUpdatedAt: latestEligiblePublicationAt(snapshot)
  };
}

function buildWhereClause(
  request: ReturnType<typeof SearchRequestSchema.parse>,
  eligibleSourceIds: string[]
): PrismaLikeJobWhereInput {
  const where: PrismaLikeJobWhereInput = {
    visibleInFrontend: true,
    lifecycleStatus: "ACTIVE",
    sourceId: { in: eligibleSourceIds },
    OR: [
      { cities: { has: request.city } },
      { city: request.city },
      { cities: { has: "全国" } },
      { city: "全国" },
      { cities: { has: "中国" } },
      { city: "中国" }
    ]
  };

  const effectiveCategoryAndKeywordFilters: Array<Record<string, unknown>> = [];

  if (request.categories.length > 0) {
    const categories = request.categories.map(toPrismaJobCategory);
    effectiveCategoryAndKeywordFilters.push({
      OR: [
        { humanCorrectedCategory: { in: categories } },
        { humanCorrectedCategory: null, category: { in: categories } }
      ]
    });
  }

  if (request.companyIds.length > 0) {
    where.companyId = { in: request.companyIds };
  }

  if (request.keyword && request.keyword.length > 0) {
    effectiveCategoryAndKeywordFilters.push({
      OR: [
        { humanCorrectedTitle: { contains: request.keyword } },
        { officialTitle: { contains: request.keyword } },
        { auxiliaryChineseTitle: { contains: request.keyword } },
        { company: { is: { officialChineseName: { contains: request.keyword } } } },
        { company: { is: { pinyinName: { contains: request.keyword } } } }
      ]
    });
  }

  if (effectiveCategoryAndKeywordFilters.length > 0) {
    where.AND = effectiveCategoryAndKeywordFilters;
  }

  if (request.newWithinDays === 7) {
    where.isNew = true;
  }

  return where;
}

function latestEligiblePublicationAt(snapshot: CompanyPublicationSnapshot): string | null {
  const eligibleCompanyIds = new Set(snapshot.eligibleCompanyIds);
  let latest: Date | null = null;
  for (const company of snapshot.companies) {
    if (!eligibleCompanyIds.has(company.companyId) || company.state !== "PUBLISHING") continue;
    if (company.lastSuccessAt !== null && (latest === null || company.lastSuccessAt > latest)) {
      latest = company.lastSuccessAt;
    }
  }
  return latest?.toISOString() ?? null;
}

function groupRowsByCompany(rows: JobRow[]): DatabaseSearchCompanyResult[] {
  const companies = new Map<string, DatabaseSearchCompanyResult>();

  for (const row of rows) {
    let company = companies.get(row.companyId);

    if (!company) {
      company = {
        id: row.company.id,
        companyName: row.company.officialChineseName,
        pinyin: row.company.pinyinName,
        jobs: []
      };
      companies.set(row.companyId, company);
    }

    company.jobs.push({
      id: row.id,
      title: row.humanCorrectedTitle || row.auxiliaryChineseTitle || row.officialTitle,
      officialTitle: row.officialTitle,
      officialPublishedAt: toIsoString(row.officialPublishedAt),
      city: row.city,
      category:
        PRISMA_TO_JOB_CATEGORY[
          (row.humanCorrectedCategory ?? row.category) as PrismaJobCategoryName
        ],
      isNew: row.isNew,
      officialUrl: row.officialUrl
    });
  }

  for (const company of companies.values()) {
    company.jobs.sort(compareJobsByPublishedAtDesc);
  }

  return [...companies.values()];
}

function sortCompanies(
  companies: DatabaseSearchCompanyResult[],
  sort: ReturnType<typeof SearchRequestSchema.parse>["sort"]
): DatabaseSearchCompanyResult[] {
  const sorted = [...companies];

  if (sort === "LATEST_POSTED") {
    sorted.sort((left, right) => {
      const publishedAtDifference = comparePublishedAtDesc(getLatestPublishedAt(left), getLatestPublishedAt(right));

      if (publishedAtDifference !== 0) {
        return publishedAtDifference;
      }

      return left.pinyin.localeCompare(right.pinyin);
    });

    return sorted;
  }

  if (sort === "MATCHING_JOB_COUNT_DESC") {
    sorted.sort((left, right) => {
      const countDifference = right.jobs.length - left.jobs.length;

      if (countDifference !== 0) {
        return countDifference;
      }

      return left.pinyin.localeCompare(right.pinyin);
    });

    return sorted;
  }

  sorted.sort((left, right) => left.pinyin.localeCompare(right.pinyin));
  return sorted;
}

function compareJobsByPublishedAtDesc(
  left: DatabaseSearchJobResult,
  right: DatabaseSearchJobResult
): number {
  const publishedAtDifference = comparePublishedAtDesc(left.officialPublishedAt, right.officialPublishedAt);

  if (publishedAtDifference !== 0) {
    return publishedAtDifference;
  }

  const titleDifference = left.title.localeCompare(right.title);

  if (titleDifference !== 0) {
    return titleDifference;
  }

  return left.id.localeCompare(right.id);
}

function getLatestPublishedAt(company: DatabaseSearchCompanyResult): string | null {
  const firstJob = company.jobs[0];

  return firstJob?.officialPublishedAt ?? null;
}

function comparePublishedAtDesc(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  const leftTimestamp = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTimestamp = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;

  return rightTimestamp - leftTimestamp;
}

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}
