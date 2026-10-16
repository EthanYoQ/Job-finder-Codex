import { describe, expect, it } from "vitest";
import { CITY_PENDING, isCityPendingJob, matchesPortableSearchCity } from "../../src/domain/jobLocation";

describe("portable city resolution", () => {
  it.each([
    { city: CITY_PENDING, cities: [CITY_PENDING], pending: true },
    { city: "中国", cities: [], pending: true },
    { city: "China", cities: ["中国", "China"], pending: true },
    { city: "", cities: ["中国"], pending: true },
    { city: "中国", cities: ["北京市"], pending: false },
    { city: "北京市", cities: ["中国"], pending: false },
    { city: "中国", cities: ["杭州"], pending: false },
    { city: "China", cities: ["APAC"], pending: false },
    { city: "中国", cities: ["全国"], pending: false },
    { city: "全国", cities: ["中国"], pending: false },
    { city: "", cities: [], pending: false },
    { city: "APAC", cities: ["APAC"], pending: false }
  ])("classifies only unresolved or country-only locations: $city / $cities", ({ pending, ...job }) => {
    expect(isCityPendingJob(job)).toBe(pending);
    expect(matchesPortableSearchCity(job, CITY_PENDING)).toBe(pending);
  });

  it("keeps a pending marker alongside a nationwide label discoverable only as pending", () => {
    const job = { city: CITY_PENDING, cities: [CITY_PENDING, "全国"] };
    expect(isCityPendingJob(job)).toBe(true);
    expect(matchesPortableSearchCity(job, CITY_PENDING)).toBe(true);
    for (const city of ["北京", "上海", "广州"]) expect(matchesPortableSearchCity(job, city)).toBe(false);
  });
});
