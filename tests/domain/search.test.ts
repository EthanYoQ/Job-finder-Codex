import { describe, expect, it } from "vitest";
import {
  COMPANY_EXPANSION_MAX_RETURNED,
  COMPANY_EXPANSION_PAGE_SIZE,
  JOB_CATEGORIES,
  CompanyExpansionRequestSchema,
  SearchRequestSchema
} from "../../src/domain/search";

describe("search request contract", () => {
  it("requires city and accepts optional category, keyword, company, sort, and new-job filters", () => {
    const parsed = SearchRequestSchema.parse({
      city: "北京",
      categories: ["销售", "医学事务"],
      keyword: "MSL 肿瘤",
      companyIds: ["company-novartis"],
      sort: "COMPANY_PINYIN_ASC",
      newWithinDays: 7
    });

    expect(parsed.city).toBe("北京");
    expect(parsed.categories).toEqual(["销售", "医学事务"]);
  });

  it("rejects empty city", () => {
    expect(() => SearchRequestSchema.parse({ city: "" })).toThrow();
  });

  it("keeps all 17 P0 job categories", () => {
    expect(JOB_CATEGORIES).toEqual([
      "销售",
      "市场",
      "商务",
      "渠道",
      "KA",
      "医学事务",
      "临床运营",
      "注册",
      "药物警戒/安全",
      "研发/科学",
      "生产/工程",
      "质量",
      "市场准入/政府事务",
      "数据/IT",
      "供应链/采购",
      "职能",
      "其他"
    ]);
  });
});

describe("company expansion contract", () => {
  it("uses controlled loading limits for company expansion", () => {
    expect(COMPANY_EXPANSION_PAGE_SIZE).toBe(10);
    expect(COMPANY_EXPANSION_MAX_RETURNED).toBe(50);
  });

  it("rejects requests beyond the hard expansion cap", () => {
    expect(() =>
      CompanyExpansionRequestSchema.parse({
        companyId: "company-hengrui",
        offset: 50,
        limit: 10
      })
    ).toThrow();
  });
});
