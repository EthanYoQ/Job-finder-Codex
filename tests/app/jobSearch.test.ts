import { describe, expect, it } from "vitest";
import {
  companies as reExportedCompanies,
  filterJobs,
  sortCompanies
} from "../../src/app/jobSearch";
import { companies as jobDataCompanies } from "../../src/app/jobData";

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

  it("filters jobs marked as new without treating all baseline jobs as new", () => {
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

  it("sorts companies by latest official job publish date instead of isNew", () => {
    const results = filterJobs({
      city: "北京",
      keyword: "",
      categories: [],
      onlyNew: false
    });

    expect(sortCompanies(results, "LATEST").map((company) => company.companyName)).toEqual([
      "诺华",
      "辉瑞",
      "阿斯利康",
      "百济神州",
      "信达生物"
    ]);
  });

  it("sorts companies by matching job count descending with pinyin tie-breaks", () => {
    const results = filterJobs({
      city: "北京",
      keyword: "",
      categories: [],
      onlyNew: false
    });

    expect(sortCompanies(results, "JOB_COUNT_DESC").map((company) => company.companyName)).toEqual([
      "辉瑞",
      "阿斯利康",
      "百济神州",
      "诺华",
      "信达生物"
    ]);
  });

  it("re-exports companies from jobSearch", () => {
    expect(reExportedCompanies).toBe(jobDataCompanies);
  });
});
