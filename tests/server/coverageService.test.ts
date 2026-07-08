import { describe, expect, it, vi } from "vitest";
import { listCompanyCoverage } from "../../src/server/coverageService";

describe("company coverage service", () => {
  it("returns only company names and official website links sorted by pinyin", async () => {
    const db = {
      company: {
        findMany: vi.fn(async () => [
          {
            id: "b",
            officialChineseName: "百济神州",
            officialWebsiteUrl: "https://www.beigene.cn",
            pinyinName: "bai ji shen zhou"
          },
          {
            id: "a",
            officialChineseName: "阿斯利康",
            officialWebsiteUrl: "https://www.astrazeneca.com.cn",
            pinyinName: "a si li kang"
          }
        ])
      }
    };

    await expect(listCompanyCoverage({ keyword: "" }, db)).resolves.toEqual({
      companies: [
        { id: "a", companyName: "阿斯利康", officialWebsiteUrl: "https://www.astrazeneca.com.cn" },
        { id: "b", companyName: "百济神州", officialWebsiteUrl: "https://www.beigene.cn" }
      ],
      offset: 0,
      limit: 50,
      hasMore: false
    });
  });

  it("applies offset and limit caps instead of returning the full company list", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      id: `company-${index + 1}`,
      officialChineseName: `药企 ${index + 1}`,
      officialWebsiteUrl: `https://example.com/${index + 1}`,
      pinyinName: `company ${String(index + 1).padStart(2, "0")}`
    }));
    const db = {
      company: {
        findMany: vi.fn(async () => rows)
      }
    };

    await expect(listCompanyCoverage({ keyword: "", offset: 10, limit: 50 }, db)).resolves.toEqual({
      companies: rows.slice(10, 60).map((row) => ({
        id: row.id,
        companyName: row.officialChineseName,
        officialWebsiteUrl: row.officialWebsiteUrl
      })),
      offset: 10,
      limit: 50,
      hasMore: false
    });
  });
});
