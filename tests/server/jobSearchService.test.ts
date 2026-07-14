import { describe, expect, it, vi } from "vitest";
import type {
  CompanyPublicationRecord,
  CompanyPublicationSnapshot
} from "../../src/domain/publicationEligibility";
import { searchJobsFromDatabase, type PrismaJobSearchDb } from "../../src/server/jobSearchService";

function dbReturning(
  rows: unknown[],
  lastUpdatedAt = new Date("2026-07-08T00:00:00.000Z")
): PrismaJobSearchDb {
  const transactionClient = {
    job: {
      findMany: vi.fn(() => Promise.resolve(rows))
    },
    crawlObservation: {
      findFirst: vi.fn(() => Promise.resolve({ crawledAt: lastUpdatedAt }))
    },
    crawlBatchSourceResult: {
      findMany: vi.fn(async () => [])
    }
  };
  return {
    ...transactionClient,
    $transaction: vi.fn(async (operation, _options) => operation(transactionClient))
  };
}

function publicationRecord({
  companyId,
  sourceId,
  state = "PUBLISHING",
  lastSuccessAt
}: {
  companyId: string;
  sourceId?: string;
  state?: CompanyPublicationRecord["state"];
  lastSuccessAt: Date | null;
}): CompanyPublicationRecord {
  const eligibleSourceIds = state === "PUBLISHING" && sourceId ? [sourceId] : [];
  return {
    companyId,
    companyName: companyId,
    pinyinName: companyId,
    category: "FOREIGN_PHARMA",
    officialWebsiteUrl: `https://official.example/${companyId}`,
    officialCareersUrl: sourceId ? `https://official.example/${companyId}/careers` : null,
    state,
    health: state === "PUBLISHING" ? "HEALTHY" : "NOT_APPLICABLE",
    stagedSourceIds: sourceId ? [sourceId] : [],
    eligibleSourceIds,
    qualifiedAt: state === "PUBLISHING" ? lastSuccessAt : null,
    lastAttemptAt: lastSuccessAt,
    lastSuccessAt,
    reasonCode: state === "PUBLISHING"
      ? "ALL_CURRENT_STAGED_SOURCES_QUALIFIED"
      : "CURRENT_CONFIG_HAS_NO_ATTEMPT"
  };
}

function publicationSnapshot(companies: CompanyPublicationRecord[]): CompanyPublicationSnapshot {
  const eligibleCompanies = companies.filter(({ state }) => state === "PUBLISHING");
  return {
    companies,
    eligibleCompanyIds: eligibleCompanies.map(({ companyId }) => companyId),
    eligibleSourceIds: eligibleCompanies.flatMap(({ eligibleSourceIds }) => eligibleSourceIds),
    countsByState: {
      PUBLISHING: eligibleCompanies.length,
      VERIFYING: companies.filter(({ state }) => state === "VERIFYING").length,
      OFFICIAL_LINK_ONLY: companies.filter(({ state }) => state === "OFFICIAL_LINK_ONLY").length,
      NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME: companies.filter(
        ({ state }) => state === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME"
      ).length,
      USER_AUTHORIZED_PHASE1_EXCLUSION: companies.filter(
        ({ state }) => state === "USER_AUTHORIZED_PHASE1_EXCLUSION"
      ).length
    },
    countsByHealth: {
      HEALTHY: companies.filter(({ health }) => health === "HEALTHY").length,
      DEGRADED: companies.filter(({ health }) => health === "DEGRADED").length,
      NOT_APPLICABLE: companies.filter(({ health }) => health === "NOT_APPLICABLE").length
    }
  };
}

const defaultPublicationSnapshot = publicationSnapshot([
  publicationRecord({ companyId: "company-a", sourceId: "source-a", lastSuccessAt: new Date("2026-07-07T00:00:00.000Z") }),
  publicationRecord({ companyId: "company-b", sourceId: "source-b", lastSuccessAt: new Date("2026-07-08T00:00:00.000Z") }),
  publicationRecord({ companyId: "company-c", sourceId: "source-c", lastSuccessAt: new Date("2026-07-06T00:00:00.000Z") })
]);

function searchWithSnapshot(
  request: unknown,
  db: PrismaJobSearchDb,
  snapshot: CompanyPublicationSnapshot = defaultPublicationSnapshot
) {
  return searchJobsFromDatabase(request, db, async () => snapshot);
}

const rows = [
  {
    id: "job-2",
    sourceId: "source-b",
    companyId: "company-b",
    officialTitle: "Medical Science Liaison",
    auxiliaryChineseTitle: "MSL 医学科学联络官",
    officialUrl: "https://example.com/b/2",
    officialPublishedAt: new Date("2026-07-08T00:00:00.000Z"),
    city: "北京",
    cities: ["北京"],
    category: "MEDICAL_AFFAIRS",
    humanCorrectedCategory: null,
    isNew: true,
    company: { id: "company-b", officialChineseName: "百济神州", pinyinName: "bai ji shen zhou" }
  },
  {
    id: "job-1",
    sourceId: "source-a",
    companyId: "company-a",
    officialTitle: "Regional Sales Manager",
    auxiliaryChineseTitle: "区域销售经理",
    officialUrl: "https://example.com/a/1",
    officialPublishedAt: new Date("2026-07-07T00:00:00.000Z"),
    city: "北京",
    cities: ["北京", "全国"],
    category: "SALES",
    humanCorrectedCategory: null,
    isNew: false,
    company: { id: "company-a", officialChineseName: "阿斯利康", pinyinName: "a si li kang" }
  }
];

describe("searchJobsFromDatabase", () => {
  it("requires city before reading jobs", async () => {
    const db = dbReturning(rows);

    await expect(searchWithSnapshot({ city: "", categories: [] }, db)).rejects.toThrow();
    expect(db.job.findMany).not.toHaveBeenCalled();
  });

  it("returns company-grouped results sorted by pinyin A-Z by default", async () => {
    const result = await searchWithSnapshot({ city: "北京", categories: [] }, dbReturning(rows));

    expect(result.totalJobs).toBe(2);
    expect(result.lastUpdatedAt).toBe("2026-07-08T00:00:00.000Z");
    expect(result.companies.map((company) => company.companyName)).toEqual(["阿斯利康", "百济神州"]);
  });

  it("passes city, category, keyword, company, active visibility, and new filters into the DB query", async () => {
    const db = dbReturning(rows);

    await searchWithSnapshot(
      {
        city: "北京",
        categories: ["销售"],
        keyword: "肿瘤",
        companyIds: ["company-a"],
        sort: "LATEST_POSTED",
        newWithinDays: 7
      },
      db
    );

    expect(db.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visibleInFrontend: true,
          lifecycleStatus: "ACTIVE",
          sourceId: { in: ["source-a", "source-b", "source-c"] },
          companyId: { in: ["company-a"] },
          isNew: true
        }),
        include: { company: true }
      })
    );

    const call = vi.mocked(db.job.findMany).mock.calls[0]?.[0] as
      | { where: { sourceId: { in: string[] } } }
      | undefined;
    expect(call?.where.sourceId.in).toEqual(["source-a", "source-b", "source-c"]);
  });

  it("filters by the human-corrected category before the model category", async () => {
    const db = dbReturning([]);

    await searchWithSnapshot(
      { city: "北京", categories: ["销售", "医学事务"] },
      db
    );

    const call = vi.mocked(db.job.findMany).mock.calls[0]?.[0] as
      | { where: { AND?: Array<Record<string, unknown>> } }
      | undefined;

    expect(call?.where.AND).toContainEqual({
      OR: [
        { humanCorrectedCategory: { in: ["SALES", "MEDICAL_AFFAIRS"] } },
        {
          humanCorrectedCategory: null,
          category: { in: ["SALES", "MEDICAL_AFFAIRS"] }
        }
      ]
    });
  });

  it("combines the effective-category filter and keyword filter in where.AND", async () => {
    const db = dbReturning([]);

    await searchWithSnapshot(
      { city: "北京", categories: ["销售"], keyword: "肿瘤" },
      db
    );

    const call = vi.mocked(db.job.findMany).mock.calls[0]?.[0] as
      | { where: { AND?: Array<Record<string, unknown>> } }
      | undefined;

    expect(call?.where.AND).toHaveLength(2);
    expect(call?.where.AND).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { humanCorrectedCategory: { in: ["SALES"] } },
            { humanCorrectedCategory: null, category: { in: ["SALES"] } }
          ]
        },
        {
          OR: [
            { humanCorrectedTitle: { contains: "肿瘤" } },
            { officialTitle: { contains: "肿瘤" } },
            { auxiliaryChineseTitle: { contains: "肿瘤" } },
            { company: { is: { officialChineseName: { contains: "肿瘤" } } } },
            { company: { is: { pinyinName: { contains: "肿瘤" } } } }
          ]
        }
      ])
    );
  });

  it("does not add an effective-category filter when categories are empty", async () => {
    const withoutKeyword = dbReturning([]);
    const withKeyword = dbReturning([]);

    await searchWithSnapshot({ city: "北京", categories: [] }, withoutKeyword);
    await searchWithSnapshot(
      { city: "北京", categories: [], keyword: "肿瘤" },
      withKeyword
    );

    const withoutKeywordWhere = vi.mocked(withoutKeyword.job.findMany).mock.calls[0]?.[0]
      .where as unknown as Record<string, unknown>;
    const withKeywordWhere = vi.mocked(withKeyword.job.findMany).mock.calls[0]?.[0]
      .where as unknown as { AND?: Array<Record<string, unknown>> };

    expect(withoutKeywordWhere).not.toHaveProperty("AND");
    expect(withoutKeywordWhere).not.toHaveProperty("category");
    expect(withoutKeywordWhere).not.toHaveProperty("humanCorrectedCategory");
    expect(withKeywordWhere.AND).toEqual([
      {
        OR: [
          { humanCorrectedTitle: { contains: "肿瘤" } },
          { officialTitle: { contains: "肿瘤" } },
          { auxiliaryChineseTitle: { contains: "肿瘤" } },
          { company: { is: { officialChineseName: { contains: "肿瘤" } } } },
          { company: { is: { pinyinName: { contains: "肿瘤" } } } }
        ]
      }
    ]);
  });

  it("returns the human-corrected category instead of the model category", async () => {
    const result = await searchWithSnapshot(
      { city: "北京", categories: [] },
      dbReturning([
        {
          ...rows[1],
          category: "SALES",
          humanCorrectedCategory: "MEDICAL_AFFAIRS"
        }
      ])
    );

    expect(result.companies[0]?.jobs[0]?.category).toBe("医学事务");
  });

  it("uses a human-corrected title ahead of AI translation and includes it in keyword search", async () => {
    const db = dbReturning([{ ...rows[1], officialTitle: "Medical Science Liaison",
      auxiliaryChineseTitle: "医学科学联络官", humanCorrectedTitle: "资深医学科学联络官" }]);
    const result = await searchWithSnapshot({ city: "北京", categories: [], keyword: "资深" }, db);
    expect(result.companies[0]?.jobs[0]?.title).toBe("资深医学科学联络官");
    const where = vi.mocked(db.job.findMany).mock.calls[0]?.[0].where as { AND?: Array<{ OR?: unknown[] }> };
    expect(where.AND?.[0]?.OR).toContainEqual({ humanCorrectedTitle: { contains: "资深" } });
  });

  it("sorts latest posted deterministically when some jobs have null publish dates", async () => {
    const result = await searchWithSnapshot(
      { city: "北京", categories: [], sort: "LATEST_POSTED" },
      dbReturning([
        {
          id: "job-c-1",
          sourceId: "source-c",
          companyId: "company-c",
          officialTitle: "Zeta Title",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/c/1",
          officialPublishedAt: null,
          city: "北京",
          cities: ["北京"],
          category: "SALES",
          isNew: false,
          company: { id: "company-c", officialChineseName: "泽塔制药", pinyinName: "ze ta zhi yao" }
        },
        {
          id: "job-c-2",
          sourceId: "source-c",
          companyId: "company-c",
          officialTitle: "Alpha Role",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/c/2",
          officialPublishedAt: null,
          city: "北京",
          cities: ["北京"],
          category: "SALES",
          isNew: false,
          company: { id: "company-c", officialChineseName: "泽塔制药", pinyinName: "ze ta zhi yao" }
        },
        {
          id: "job-b-1",
          sourceId: "source-b",
          companyId: "company-b",
          officialTitle: "Medical Science Liaison",
          auxiliaryChineseTitle: "MSL 医学科学联络官",
          officialUrl: "https://example.com/b/1",
          officialPublishedAt: new Date("2026-07-08T00:00:00.000Z"),
          city: "北京",
          cities: ["北京"],
          category: "MEDICAL_AFFAIRS",
          isNew: true,
          company: { id: "company-b", officialChineseName: "百济神州", pinyinName: "bai ji shen zhou" }
        },
        {
          id: "job-a-2",
          sourceId: "source-a",
          companyId: "company-a",
          officialTitle: "Beta Title",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/a/2",
          officialPublishedAt: null,
          city: "北京",
          cities: ["北京"],
          category: "SALES",
          isNew: false,
          company: { id: "company-a", officialChineseName: "阿斯利康", pinyinName: "a si li kang" }
        },
        {
          id: "job-a-1",
          sourceId: "source-a",
          companyId: "company-a",
          officialTitle: "Alpha Title",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/a/1",
          officialPublishedAt: new Date("2026-07-07T00:00:00.000Z"),
          city: "北京",
          cities: ["北京"],
          category: "SALES",
          isNew: false,
          company: { id: "company-a", officialChineseName: "阿斯利康", pinyinName: "a si li kang" }
        }
      ])
    );

    expect(result.companies.map((company) => company.companyName)).toEqual(["百济神州", "阿斯利康", "泽塔制药"]);
    expect(result.companies[1]?.jobs.map((job) => job.officialTitle)).toEqual(["Alpha Title", "Beta Title"]);
    expect(result.companies[2]?.jobs.map((job) => job.officialTitle)).toEqual(["Alpha Role", "Zeta Title"]);
  });

  it("sorts companies by matching job count descending with pinyin fallback", async () => {
    const result = await searchWithSnapshot(
      { city: "北京", categories: [], sort: "MATCHING_JOB_COUNT_DESC" },
      dbReturning([
        {
          id: "job-b-1",
          sourceId: "source-b",
          companyId: "company-b",
          officialTitle: "Medical Science Liaison",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/b/1",
          officialPublishedAt: new Date("2026-07-08T00:00:00.000Z"),
          city: "北京",
          cities: ["北京"],
          category: "MEDICAL_AFFAIRS",
          isNew: true,
          company: { id: "company-b", officialChineseName: "百济神州", pinyinName: "bai ji shen zhou" }
        },
        {
          id: "job-a-1",
          sourceId: "source-a",
          companyId: "company-a",
          officialTitle: "Regional Sales Manager",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/a/1",
          officialPublishedAt: new Date("2026-07-07T00:00:00.000Z"),
          city: "北京",
          cities: ["北京"],
          category: "SALES",
          isNew: false,
          company: { id: "company-a", officialChineseName: "阿斯利康", pinyinName: "a si li kang" }
        },
        {
          id: "job-a-2",
          sourceId: "source-a",
          companyId: "company-a",
          officialTitle: "Area Manager",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/a/2",
          officialPublishedAt: new Date("2026-07-06T00:00:00.000Z"),
          city: "北京",
          cities: ["北京"],
          category: "SALES",
          isNew: false,
          company: { id: "company-a", officialChineseName: "阿斯利康", pinyinName: "a si li kang" }
        },
        {
          id: "job-c-1",
          sourceId: "source-c",
          companyId: "company-c",
          officialTitle: "Clinical Specialist",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/c/1",
          officialPublishedAt: new Date("2026-07-05T00:00:00.000Z"),
          city: "北京",
          cities: ["北京"],
          category: "SALES",
          isNew: false,
          company: { id: "company-c", officialChineseName: "泽塔制药", pinyinName: "ze ta zhi yao" }
        }
      ])
    );

    expect(result.companies.map((company) => company.companyName)).toEqual(["阿斯利康", "百济神州", "泽塔制药"]);
  });

  it("updates one independently eligible company without a runtime global company-count gate", async () => {
    const eligible = publicationRecord({
      companyId: "company-a",
      sourceId: "source-eligible",
      lastSuccessAt: new Date("2026-07-09T08:00:00.000Z")
    });
    const verifying = publicationRecord({
      companyId: "company-b",
      sourceId: "source-legacy",
      state: "VERIFYING",
      lastSuccessAt: new Date("2026-07-10T08:00:00.000Z")
    });
    const snapshot = publicationSnapshot([eligible, verifying]);
    const readSnapshot = vi.fn(async () => snapshot);
    const db = dbReturning([
      { ...rows[1], sourceId: "source-eligible", companyId: "company-a" },
      { ...rows[0], sourceId: "source-legacy", companyId: "company-b" }
    ], new Date("2026-07-11T08:00:00.000Z"));

    const result = await searchJobsFromDatabase(
      { city: "北京", categories: [] },
      db,
      readSnapshot
    );

    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledWith(expect.not.objectContaining({ $transaction: expect.any(Function) }));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      maxWait: 5_000,
      timeout: 10_000
    });
    expect(db.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceId: { in: ["source-eligible"] } })
    }));
    expect(result.companies.map(({ id }) => id)).toEqual(["company-a"]);
    expect(result.totalJobs).toBe(1);
    expect(result.lastUpdatedAt).toBe("2026-07-09T08:00:00.000Z");
    expect(result.companies.flatMap(({ jobs }) => jobs).map(({ officialUrl }) => officialUrl))
      .toEqual(["https://example.com/a/1"]);
  });

  it("returns an empty result without issuing a broad job query when no source is eligible", async () => {
    const db = dbReturning(rows, new Date("2026-07-11T08:00:00.000Z"));
    const result = await searchWithSnapshot({ city: "北京", categories: [] }, db, publicationSnapshot([]));

    expect(db.job.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ companies: [], totalJobs: 0, lastUpdatedAt: null });
  });

  it("fails closed when the database cannot provide a repeatable-read transaction", async () => {
    const db = dbReturning(rows);
    delete db.$transaction;

    await expect(searchWithSnapshot({ city: "北京", categories: [] }, db)).rejects.toThrow(
      "REPEATABLE_READ_JOB_SEARCH_TRANSACTION_REQUIRED"
    );
    expect(db.job.findMany).not.toHaveBeenCalled();
  });
});
