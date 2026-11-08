import assert from "node:assert/strict";
import test from "node:test";
import { searchPortableSnapshot } from "../../web-candidate/src/server/portablePublicationApi.ts";

const cases = [
  ["source-astrazeneca-social", "(Asso.) Clinical Quality Manager", "质量", "临床质量"],
  ["source-astrazeneca-social", "Clinical Supply Chain Planner", "供应链/采购", "临床供应链"],
  ["source-astrazeneca-social", "(Senior) Director, Clinical Pharmacology", "研发/科学", "临床药理"],
  ["source-astrazeneca-social", "(Associate) Country Study Manager - Rare Disease", "临床运营", "临床研究执行"],
  ["source-novartis-social", "Medical Scientific Liaison - IMMU 北京", "医学事务", "医学联络"],
  ["source-novartis-social", "（高级）医药代表/（资深）产品专员", "销售", "医药销售"],
  ["source-sanofi-china-social", "糖尿病事业部-District Manager-重庆", "销售", "销售管理"],
  ["source-sanofi-china-social", "特药事业部 医学信息沟通代表 上海", "销售", "医药销售"],
  ["source-novartis-social", "Product Manager", "其他", undefined],
  ["fixture", "Clinical Trial Supply Chain Manager", "供应链/采购", "临床供应链"],
  ["fixture", "Clinical Trials Supply Manager", "供应链/采购", "临床供应链"],
  ["fixture", "Quality Engineer", "质量", "质量保证"],
  ["fixture", "Sales Recruiter", "职能", "人力资源"],
];

const oldJobs = cases.map(([sourceId, officialTitle], index) => ({
  id: String(index), sourceId, officialTitle, title: officialTitle, category: "其他",
  city: "上海", cities: ["上海"], locationRaw: "上海", officialPublishedAt: null,
}));
const jobs = [...oldJobs, { ...oldJobs[0], id: "manual", category: "医学事务" }, { ...oldJobs[0], id: "manual-other", categoryManuallyCorrected: true }];
const snapshot = {
  lastUpdatedAt: null, sources: [],
  coverage: { requiredCompanyCount: 1, excludedCompanyCount: 0 },
  companies: [{ id: "fixture", companyName: "Fixture", pinyin: "Fixture", required: true,
    publishingSourceIds: [...new Set(oldJobs.map((job) => job.sourceId))], jobs }],
};
const query = (request = {}) => searchPortableSnapshot({ city: "全部城市", ...request }, snapshot);

test("saved snapshots expose evidence-backed parent and child filters without changing membership", () => {
  const result = query();
  assert.equal(result.totalJobs, jobs.length);
  const byId = new Map(result.companies.flatMap((company) => company.jobs).map((job) => [job.id, job]));
  for (const [index, [, title, category, subcategory]] of cases.entries()) {
    const job = byId.get(String(index));
    assert.deepEqual([job.category, job.subcategory ?? undefined], [category, subcategory], title);
  }
  assert.equal(byId.get("manual").category, "医学事务");
  assert.equal(byId.get("manual").subcategory ?? undefined, undefined);
  assert.equal(byId.get("manual-other").category, "其他");
  assert.equal(byId.get("manual-other").categoryManuallyCorrected, undefined);
  assert.equal(query({ categories: ["销售"] }).totalJobs, 3);
  assert.equal(query({ categories: ["临床质量"] }).totalJobs, 1);
  assert.equal(query({ keyword: "临床供应链" }).totalJobs, 3);
  assert(oldJobs.every((job) => job.category === "其他"));
});
