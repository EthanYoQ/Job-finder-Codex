import { describe, expect, it } from "vitest";
import { filterJobs, sortCompanies } from "../../src/app/jobSearch";

describe("frontend job search helpers", () => {
  it("requires a city before returning company results", () => {
    expect(filterJobs({ city: "", keyword: "", categories: [], onlyNew: false })).toEqual([]);
  });

  it("returns Beijing jobs grouped by company with category and keyword filters", () => {
    const results = filterJobs({
      city: "北京",
      keyword: "MSL",
      categories: ["医学事务"],
      onlyNew: false
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.companyName).toBe("辉瑞");
    expect(results[0]?.jobs.map((job) => job.title)).toContain("MSL 医学科学联络官");
  });

  it("filters near-seven-day new jobs without treating all baseline jobs as new", () => {
    const results = filterJobs({
      city: "北京",
      keyword: "",
      categories: [],
      onlyNew: true
    });

    expect(results.flatMap((company) => company.jobs).every((job) => job.isNew)).toBe(true);
    expect(results.flatMap((company) => company.jobs)).not.toHaveLength(0);
  });

  it("sorts companies by pinyin A-Z by default", () => {
    const results = filterJobs({
      city: "北京",
      keyword: "",
      categories: [],
      onlyNew: false
    });

    expect(sortCompanies(results, "PINYIN_ASC").map((company) => company.companyName)).toEqual([
      "阿斯利康",
      "百济神州",
      "辉瑞",
      "诺华",
      "信达生物"
    ]);
  });
});
