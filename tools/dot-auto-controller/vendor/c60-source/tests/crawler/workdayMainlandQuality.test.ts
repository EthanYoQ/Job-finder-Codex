import { expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { CITY_PENDING } from "../../src/domain/jobLocation";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { parseWorkdayMainlandRow, projectAmgenNativeCities, projectWorkdayMainlandRow, workdayMainlandDetailUrl } from "../../src/crawler/workdayMainlandQuality";

it("requires verified CSL Field Sales details while retaining pending city and country/identity gates", () => {
  const plans = buildStagedSourceCrawlPlans(candidateCompanies);
  const plan = plans.find(p => p.source.id === "source-csl-china-social")!;
  const descriptor = "APAC, CN, Field Sales, CSL Behring";
  const raw = { title: "Product Specialist, Taiyuan", externalPath: "/job/APAC-CN-Field-Sales-CSL-Behring/Product-Specialist--Taiyuan_R-101",
    locationsText: descriptor, postedOn: "Posted Today", timeType: "Full time", bulletFields: ["Regular", "R-101", "Sales", "China"] };
  const row = parseWorkdayMainlandRow(plan, raw);
  expect(row).toMatchObject({ listCity: CITY_PENDING, requiresDetail: true });
  if (!row) throw Error("Expected the exact CSL descriptor to require detail");
  expect(workdayMainlandDetailUrl(plan, row)).toBe(`https://csl.wd1.myworkdayjobs.com/wday/cxs/csl/CSL_External${raw.externalPath}`);
  expect(projectWorkdayMainlandRow(plan, row)).toBeUndefined();
  const country = { descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4" };
  const detail = { userAuthenticated: false, jobPostingInfo: { id: "a".repeat(32), title: raw.title,
    jobReqId: "R-101", jobPostingId: raw.externalPath.split("/").at(-1), jobPostingSiteId: "CSL_External",
    externalUrl: `https://csl.wd1.myworkdayjobs.com/CSL_External${raw.externalPath}`, posted: true, canApply: true,
    country, jobRequisitionLocation: { descriptor, country: { ...country, alpha2Code: "CN" } },
    postedOn: "Posted Today", startDate: "2026-01-01", timeType: raw.timeType, location: descriptor } };
  expect(projectWorkdayMainlandRow(plan, row, JSON.stringify(detail))).toMatchObject({ cities: [CITY_PENDING], locationRaw: descriptor });
  expect(parseWorkdayMainlandRow(plan, { ...raw, bulletFields: ["Regular", "R-101", "Sales", "Australia"] })).toBeUndefined();
  expect(parseWorkdayMainlandRow(plan, { ...raw, externalPath: raw.externalPath.replace("R-101", "R-102") })).toBeUndefined();
  expect(parseWorkdayMainlandRow(plan, { ...raw, locationsText: descriptor.replace(", CN,", ", AU,") })).toBeUndefined();
  const foreignDetail = structuredClone(detail);
  foreignDetail.jobPostingInfo.jobRequisitionLocation.country.alpha2Code = "AU";
  expect(projectWorkdayMainlandRow(plan, row, JSON.stringify(foreignDetail))).toBeUndefined();
  const wrongIdentity = structuredClone(detail);
  wrongIdentity.jobPostingInfo.jobReqId = "R-102";
  expect(projectWorkdayMainlandRow(plan, row, JSON.stringify(wrongIdentity))).toBeUndefined();
  const amgen = plans.find(p => p.source.id === "source-amgen-china-social")!;
  const { timeType: _timeType, ...amgenRaw } = raw;
  expect(parseWorkdayMainlandRow(amgen, { ...amgenRaw, locationsText: "China - Field Sales", bulletFields: ["R-101"],
    externalPath: "/job/China---Field-Sales/Product-Specialist--Taiyuan_R-101" })).toBeUndefined();
});

it("maps Nanchang while preserving rejection of unknown city descriptors", () => {
  const title = "Biopharmaceutical Rep-Repatha-Nanchang";
  expect(projectAmgenNativeCities(title, ["China - Nanchang"], "China  - Field/Remote")).toEqual(["南昌"]);
  expect(projectAmgenNativeCities(title, ["China - Unverified Place"], "China  - Field/Remote")).toBeUndefined();
  expect(projectAmgenNativeCities(title, ["China - Nanchang"], "China - Unverified Place")).toBeUndefined();
});
