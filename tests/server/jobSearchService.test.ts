import { describe, expect, it, vi } from "vitest";
import { searchJobsFromDatabase, type PrismaJobSearchDb } from "../../src/server/jobSearchService";

function dbReturning(
  rows: unknown[],
  lastUpdatedAt = new Date("2026-07-08T00:00:00.000Z")
): PrismaJobSearchDb {
  return {
    job: {
      findMany: vi.fn(() => Promise.resolve(rows))
    },
    crawlObservation: {
      findFirst: vi.fn(() => Promise.resolve({ crawledAt: lastUpdatedAt }))
    }
  };
}

const rows = [
  {
    id: "job-2",
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

    await expect(searchJobsFromDatabase({ city: "", categories: [] }, db)).rejects.toThrow();
    expect(db.job.findMany).not.toHaveBeenCalled();
  });

  it("returns company-grouped results sorted by pinyin A-Z by default", async () => {
    const result = await searchJobsFromDatabase({ city: "北京", categories: [] }, dbReturning(rows));

    expect(result.totalJobs).toBe(2);
    expect(result.lastUpdatedAt).toBe("2026-07-08T00:00:00.000Z");
    expect(result.companies.map((company) => company.companyName)).toEqual(["阿斯利康", "百济神州"]);
  });

  it("passes city, category, keyword, company, active visibility, and new filters into the DB query", async () => {
    const db = dbReturning(rows);

    await searchJobsFromDatabase(
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
          sourceId: {
            in: []
          },
          companyId: { in: ["company-a"] },
          isNew: true
        }),
        include: { company: true }
      })
    );

    const call = vi.mocked(db.job.findMany).mock.calls[0]?.[0] as
      | { where: { sourceId: { in: string[] } } }
      | undefined;
    expect(call?.where.sourceId.in).toEqual([]);
  });

  it("filters by the human-corrected category before the model category", async () => {
    const db = dbReturning([]);

    await searchJobsFromDatabase(
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

    await searchJobsFromDatabase(
      { city: "北京", categories: ["销售"], keyword: "肿瘤" },
      db
    );

    const call = vi.mocked(db.job.findMany).mock.calls[0]?.[0] as
      | { where: { AND?: Array<Record<string, unknown>> } }
      | undefined;

    expect(call?.where.AND).toEqual([
      {
        OR: [
          { humanCorrectedCategory: { in: ["SALES"] } },
          { humanCorrectedCategory: null, category: { in: ["SALES"] } }
        ]
      },
      {
        OR: [
          { officialTitle: { contains: "肿瘤" } },
          { auxiliaryChineseTitle: { contains: "肿瘤" } },
          { company: { is: { officialChineseName: { contains: "肿瘤" } } } },
          { company: { is: { pinyinName: { contains: "肿瘤" } } } }
        ]
      }
    ]);
  });

  it("does not add an effective-category filter when categories are empty", async () => {
    const withoutKeyword = dbReturning([]);
    const withKeyword = dbReturning([]);

    await searchJobsFromDatabase({ city: "北京", categories: [] }, withoutKeyword);
    await searchJobsFromDatabase(
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
          { officialTitle: { contains: "肿瘤" } },
          { auxiliaryChineseTitle: { contains: "肿瘤" } },
          { company: { is: { officialChineseName: { contains: "肿瘤" } } } },
          { company: { is: { pinyinName: { contains: "肿瘤" } } } }
        ]
      }
    ]);
  });

  it("returns the human-corrected category instead of the model category", async () => {
    const result = await searchJobsFromDatabase(
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

  it("sorts latest posted deterministically when some jobs have null publish dates", async () => {
    const result = await searchJobsFromDatabase(
      { city: "北京", categories: [], sort: "LATEST_POSTED" },
      dbReturning([
        {
          id: "job-c-1",
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
    const result = await searchJobsFromDatabase(
      { city: "北京", categories: [], sort: "MATCHING_JOB_COUNT_DESC" },
      dbReturning([
        {
          id: "job-b-1",
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
});
