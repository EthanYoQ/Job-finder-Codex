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
  ["source-sanofi-china-social", "特药事业部 医学信息沟通代表 上海", "其他", undefined],
  ["source-novartis-social", "Product Manager", "其他", undefined],
  ["fixture", "Clinical Trial Supply Chain Manager", "供应链/采购", "临床供应链"],
  ["fixture", "Clinical Trials Supply Manager", "供应链/采购", "临床供应链"],
  ["fixture", "Quality Engineer", "质量", "质量保证"],
  ["fixture", "Sales Recruiter", "职能", "人力资源"],
  ["source-qilu-social", "质量研究国际注册总监（专业）(J10977)", "注册", "注册事务"],
  ["source-hengrui-social", "RWE统计师-生物统计与编程部-中央医学事务部", "医学事务", undefined],
];

const oldJobs = cases.map(([sourceId, officialTitle], index) => ({
  id: String(index), sourceId, officialTitle, title: officialTitle, category: "其他",
  city: "上海", cities: ["上海"], locationRaw: "上海", officialPublishedAt: null,
}));
const jobs = [
  ...oldJobs,
  { ...oldJobs[0], id: "manual", category: "医学事务", categoryManuallyCorrected: true },
  { ...oldJobs[0], id: "manual-quality", category: "质量", categoryManuallyCorrected: true },
  { ...oldJobs[0], id: "manual-other", categoryManuallyCorrected: true },
];
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
  assert.equal(byId.get("manual-quality").category, "质量");
  assert.equal(byId.get("manual-quality").subcategory, "临床质量");
  assert.equal(byId.get("manual-quality").categoryManuallyCorrected, undefined);
  assert.equal(byId.get("manual-other").category, "其他");
  assert.equal(byId.get("manual-other").categoryManuallyCorrected, undefined);
  assert.equal(query({ categories: ["销售"] }).totalJobs, 2);
  assert.equal(query({ categories: ["临床质量"] }).totalJobs, 2);
  assert.equal(query({ keyword: "临床供应链" }).totalJobs, 3);
  assert(oldJobs.every((job) => job.category === "其他"));
});

test("verified departments and duties apply to the matching requisition only", () => {
  const evidenceJobs = [
    {
      id: "roche", sourceId: "source-roche-china-social", category: "研发/科学",
      officialTitle: "Associate Manager - MSAT Technology Transfer MSAT技术转移副经理",
      officialUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext/job/Shanghai/Associate-Manager---MSAT-Technology-Transfer-MSAT_202608-121967/apply",
      expected: ["生产/工程", "MSAT 技术转移"],
    },
    ...["R2877042", "R2876733", "R2877056", "R2877279", "R2876712", "R2877032", "R2877000"].map((req, index) => ({
      id: req, sourceId: "source-sanofi-china-social", category: "其他",
      officialTitle: ["SC Medical Information Communication Manager Beijing", "SC Medical Information Communication Manager Cangzhou", "SC Medical Information Communication Manager Changsha", "SC-Medical Information Communication Repres-上海", "SC-Senior Medical Information Communication Manager(Onco)-广州", "心血管与移植事业部 医学信息沟通代表 上海", "特药事业部 医学信息沟通代表 上海"][index],
      officialUrl: "https://www.ajinga.com/ats/job-detail-new/13537/" + req + "/c/?show_policy_popup=1&aj_source=sanofi_careersite&aj_code=radancyjoblist",
      expected: index < 5 ? ["销售", "医药销售"] : index === 5 ? ["销售", undefined] : ["其他", undefined],
    })),
    {
      id: "bms", sourceId: "source-bms-china-social", category: "其他",
      officialTitle: "Medical Information Communication Specialist",
      officialUrl: "https://jobs.bms.com/careers/job/137482757395",
      expected: ["销售", "医药销售"],
    },
    {
      id: "bms-abbreviation", sourceId: "source-bms-china-social", category: "其他",
      officialTitle: "SMICS",
      officialUrl: "https://jobs.bms.com/careers/job/137484350598",
      expected: ["销售", "医药销售"],
    },
    {
      id: "unverified-bms", sourceId: "source-bms-china-social", category: "其他",
      officialTitle: "SMICS", officialUrl: "https://jobs.bms.com/careers/job/999999999999",
      expected: ["其他", undefined],
    },
    {
      id: "different-origin", sourceId: "source-sanofi-china-social", category: "其他",
      officialTitle: "SC Medical Information Communication Manager Beijing",
      officialUrl: "https://example.com/ats/job-detail-new/13537/R2877042/c/",
      expected: ["其他", undefined],
    },
  ];
  const storedJobs = evidenceJobs.map(({expected, ...job}) => ({ ...oldJobs[0], ...job, title: job.officialTitle }));
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs: storedJobs }] };
  const search = (categories = []) => searchPortableSnapshot({city: "全部城市", categories}, saved);
  const result = search();
  assert.equal(result.totalJobs, evidenceJobs.length);
  const published = new Map(result.companies.flatMap((company) => company.jobs).map((job) => [job.id, job]));
  for (const {id, expected} of evidenceJobs) {
    const job = published.get(id);
    assert.deepEqual([job.category, job.subcategory ?? undefined], expected, id);
  }
  assert.equal(search(["销售"]).totalJobs, 8);
  assert.equal(search(["医药销售"]).totalJobs, 7);
  assert.equal(search(["医学事务"]).totalJobs, 0);
  assert.equal(search(["MSAT 技术转移"]).totalJobs, 1);
});
