import { SearchRequestSchema, type JobCategory } from "../domain/search";
import { toPrismaJobCategory, type PrismaJobCategoryName } from "../db/prismaMappers";

export interface PrismaJobSearchDb {
  job: {
    findMany(args: PrismaLikeJobFindManyArgs): Promise<unknown[]>;
  };
  crawlObservation: {
    findFirst(args: PrismaLikeCrawlObservationFindFirstArgs): Promise<{ crawledAt: Date } | null>;
  };
}

interface JobRow {
  id: string;
  companyId: string;
  officialTitle: string;
  auxiliaryChineseTitle: string | null;
  officialUrl: string;
  officialPublishedAt: Date | null;
  city: string;
  cities: string[];
  category: string;
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
  category?: {
    in: PrismaJobCategoryName[];
  };
  companyId?: {
    in: string[];
  };
  isNew?: true;
}

export interface DatabaseSearchJobResult {
  id: string;
  title: string;
  officialTitle: string;
  officialPublishedAt: string;
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

export async function searchJobsFromDatabase(
  request: unknown,
  db: PrismaJobSearchDb
): Promise<DatabaseSearchResult> {
  const parsed = SearchRequestSchema.parse(request);

  const jobRows = (await db.job.findMany({
    where: buildWhereClause(parsed),
    include: { company: true }
  })) as JobRow[];

  const companies = sortCompanies(groupRowsByCompany(jobRows), parsed.sort);
  const latestObservation = await db.crawlObservation.findFirst({
    select: { crawledAt: true },
    orderBy: { crawledAt: "desc" }
  });

  return {
    companies,
    totalJobs: jobRows.length,
    lastUpdatedAt: latestObservation?.crawledAt.toISOString() ?? null
  };
}

function buildWhereClause(request: ReturnType<typeof SearchRequestSchema.parse>): PrismaLikeJobWhereInput {
  const where: PrismaLikeJobWhereInput = {
    visibleInFrontend: true,
    lifecycleStatus: "ACTIVE",
    OR: [
      { cities: { has: request.city } },
      { city: request.city },
      { cities: { has: "全国" } },
      { city: "全国" },
      { cities: { has: "中国" } },
      { city: "中国" }
    ]
  };

  if (request.categories.length > 0) {
    where.category = { in: request.categories.map(toPrismaJobCategory) };
  }

  if (request.companyIds.length > 0) {
    where.companyId = { in: request.companyIds };
  }

  if (request.keyword && request.keyword.length > 0) {
    where.AND = [
      {
        OR: [
          { officialTitle: { contains: request.keyword } },
          { auxiliaryChineseTitle: { contains: request.keyword } },
          { company: { is: { officialChineseName: { contains: request.keyword } } } },
          { company: { is: { pinyinName: { contains: request.keyword } } } }
        ]
      }
    ];
  }

  if (request.newWithinDays === 7) {
    where.isNew = true;
  }

  return where;
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
      title: row.auxiliaryChineseTitle || row.officialTitle,
      officialTitle: row.officialTitle,
      officialPublishedAt: toIsoString(row.officialPublishedAt),
      city: row.city,
      category: PRISMA_TO_JOB_CATEGORY[row.category as PrismaJobCategoryName],
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
      return getLatestPublishedTimestamp(right) - getLatestPublishedTimestamp(left);
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
  return Date.parse(right.officialPublishedAt) - Date.parse(left.officialPublishedAt);
}

function getLatestPublishedTimestamp(company: DatabaseSearchCompanyResult): number {
  const firstJob = company.jobs[0];

  return firstJob ? Date.parse(firstJob.officialPublishedAt) : 0;
}

function toIsoString(value: Date | null): string {
  return value?.toISOString() ?? "";
}
