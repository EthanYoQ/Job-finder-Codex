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

test("province and city filters share the same geography for published AbbVie locations", () => {
  // Location field projections from the 2026-11-08 12:01 published batch, with one conflicting control.
  const locations = [
    ["qingdao", "Qingdao, Shandong", "Qingdao, Shandong"],
    ["jinan", "济南", "Jinan, Shandong"],
    ["shanghai", "上海", "Shanghai, Shanghai"],
    ["guangdong", "城市待核", "Guangdong, GD"],
    ["conflict", "城市待核", "Shanghai, Shanghai"],
    ["newtown", "城市待核", "Newtown, Henan"],
  ];
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0],
    jobs: locations.map(([id, city, locationRaw]) => ({ ...oldJobs[0], id, sourceId: "source-abbvie-china-social", city, cities: [city], locationRaw }))
  }] };
  const ids = (province, city = "全部城市") => searchPortableSnapshot({ province, city }, saved)
    .companies.flatMap(company => company.jobs.map(job => job.id)).sort();
  assert.deepEqual(ids("山东"), ["jinan", "qingdao"]);
  assert.deepEqual(ids("山东", "青岛"), ["qingdao"]);
  assert.deepEqual(ids("上海", "上海"), ["shanghai"]);
  assert.deepEqual(ids("河南", "城市待核"), ["newtown"]);
  assert.deepEqual(ids("广东", "城市待核"), ["guangdong"]);
  assert.deepEqual(ids("广东", "广州"), []);
});

test("the public projection resolves known locations without overriding source conflicts", () => {
  const examples = [
    ["source-novartis-social", "Haerbin (Heilongjiang Province)", "哈尔滨"],
    ["source-lilly-china-social", "CN: Nan Tong, China", "南通"],
    ["source-novartis-social", "Jilin (Jilin Province)", "吉林"],
    ["source-novartis-social", "Haiyan (Zhejiang Province)", "海盐"],
    ["source-shanghai-pharma-social", "上海市·青浦区", "上海"],
    ["source-pfizer-china-social", "CHN - HB - Hubei | China - Hubei - Wuhan", "武汉"],
    ["source-pfizer-china-social", "CHN - SD - Shandong", "城市待核"],
    ["source-pfizer-china-social", "China - Shanxi - Xi'an", "城市待核"],
    ["source-pfizer-china-social", "China - Shanxi - XianYang", "城市待核"],
    ["source-roche-china-social", "抚州, 福建, 中国大陆", "福州"],
    ["source-astrazeneca-social", "上海 上海", "城市待核"],
    ["source-takeda-china-social", "Remote", "城市待核"],
  ];
  const jobs = examples.map(([sourceId, locationRaw], id) => ({ ...oldJobs[0], id: String(id), sourceId,
    city: "城市待核", cities: ["城市待核"], locationRaw }));
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs }] };
  const search = (request = {}) => searchPortableSnapshot({ city: "全部城市", ...request }, saved);
  const result = search();
  assert.equal(result.totalJobs, examples.length);
  assert.equal(result.publishedJobSummary.cityPendingJobs, 5);
  assert.equal(search({province: "山西", city: "城市待核"}).totalJobs, 0);
  for (const job of result.companies[0].jobs) assert.equal(job.city, examples[Number(job.id)][2]);
  assert.equal(search({province: "山东", city: "城市待核"}).totalJobs, 1);
  assert.equal(search({province: "山东", city: "青岛"}).totalJobs, 0);
  assert.equal(search({province: "上海"}).totalJobs, 1);
  assert.equal(search({province: "吉林", city: "吉林"}).totalJobs, 1);
  assert.equal(search({province: "浙江", city: "海盐"}).totalJobs, 1);
});


test("province search separates nationwide, confirmed multi-city and unassigned jobs", () => {
  const locations = [
    ["source-cspc-social", "中华人民共和国", ["城市待核"], "临床监查员", ""],
    ["source-takeda-china-social", "Multiple Locations", ["城市待核"], "China Biomarker Lead", "https://jobs.takeda.com/job/shanghai/china-biomarker-lead/1113/101034777968"],
    ["source-merck-china-social", "Shanghai, Shanghai, China", ["城市待核"], "(高级)产品经理", "https://careers.emdgroup.com/us/en/job/299857"],
    ["source-takeda-china-social", "Remote", ["城市待核"], "(Sr.)Key Account Manager, Market Access, Shenyang/Haerbin/Dalian", ""],
    ["source-pfizer-china-social", "CHN - SD - Shandong", ["城市待核"], "医学信息沟通专员", ""],
    ["source-pfizer-china-social", "CHN - SD - Shandong", ["城市待核"], "辉瑞生物制剂-GE-医学信息沟通专员-济宁", ""],
    ["source-bms-china-social", "Field - China", ["城市待核"], "Account Executive", ""],
    ["source-cspc-social", "北京市,河北省石家庄市", ["北京"], "临床监查员", ""],
    ["source-daiichi-sankyo-china-social", "大连，上海", ["上海"], "医学岗位", ""],
    ["source-pfizer-china-social", "China - Shanghai - STIT | CHN - BJ - Beijing R&D Center", ["上海"], "Clinical Assay Lead, Manager (Contractor) - Shanghai or Beijing", ""],
    ["source-bayer-healthcare-social", "启东", ["启东"], "技术员", ""],
    ["source-amgen-china-social", "China - Beijing", ["城市待核"], "Biopharmaceutical Rep-Prolia-Shanghai", ""],
  ];
  const jobs = locations.map(([sourceId, locationRaw, cities, officialTitle, officialUrl], id) => ({ ...oldJobs[0],
    id: String(id), sourceId, city: cities[0], cities, locationRaw, officialTitle, officialUrl }));
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs }] };
  const query = (province, city = "全部城市") => searchPortableSnapshot({ province, city }, saved);
  const ids = (province, city) => query(province, city).companies.flatMap(c => c.jobs.map(job => Number(job.id))).sort((a, b) => a - b);
  assert.deepEqual(ids("山东"), [0, 4, 5]);
  assert.deepEqual(ids("山东", "城市待核"), [4]);
  assert.deepEqual(ids("山东", "济宁"), [5]);
  assert.deepEqual(ids("山东", "全国"), [0]);
  assert.deepEqual(ids("河北", "石家庄"), [7]);
  assert.deepEqual(ids("辽宁", "多城市"), [3, 8]);
  assert.deepEqual(ids("北京", "多城市"), [1, 2, 7, 9]);
  assert.deepEqual(ids("江苏", "启东"), [10]);
  assert.deepEqual(ids("上海", "上海"), [1, 2, 8, 9, 11]);
  assert.deepEqual(ids("全部地区", "省份待核"), [6]);
  assert.deepEqual(ids("山东", "省份待核"), []);
  assert.equal(query("山东").provinceFacets.find(f => f.province === "山东").jobCount, 3);
  assert.equal(query("北京").provinceFacets.find(f => f.province === "北京").multiCityJobs, 4);
  assert.equal(query("全部地区").totalJobs, locations.length);
});


test("reviewed work cities override ATS office locations without duplicating a requisition", () => {
  const samples = [
    {sourceId:"source-astrazeneca-social", locationRaw:"上海 上海", cities:["上海"], title:"DSM-Fasenra-武汉"},
    {sourceId:"source-astrazeneca-social", locationRaw:"上海 上海", cities:["城市待核"], title:"Medical Advisor-Hema-Shanghai/Beijing"},
    {sourceId:"source-amgen-china-social", locationRaw:"China - Jingmen", cities:["城市待核"], title:"Sr Biopharmaceutical Rep-Xiaogan"},
    {sourceId:"source-roche-china-social", locationRaw:"武汉, 湖北, 中国大陆 | 抚州, 福建, 中国大陆", cities:["城市待核"], title:"患者解决方案经理 - 免疫治疗领域 - 武汉"},
    {sourceId:"source-amgen-china-social", locationRaw:"China - JTaizhou", cities:["城市待核"], title:"Biopharmaceutical Rep-Taizhou"},
    {sourceId:"source-servier-china-social", locationRaw:"朝阳区", cities:["城市待核"], title:"Data Governance Manager 数据治理经理"},
    {sourceId:"source-astrazeneca-social", locationRaw:"Multiple locations", cities:["上海","成都"], title:"MR-CVRM-成都"},
    {sourceId:"source-roche-china-social", locationRaw:"武汉, 湖北, 中国大陆 | 新城, 福建, 中国大陆", cities:["城市待核"], title:"市场经理"},
    {sourceId:"source-hengrui-social", locationRaw:"深圳、未知", cities:["城市待核"], title:"医药代表"},
  ];
  const jobs = samples.map(({title, ...location}, id) => ({...oldJobs[0], id:String(id), ...location,
    city:location.cities[0], officialTitle:title}));
  const saved = {...snapshot, companies:[{...snapshot.companies[0], jobs}]};
  const query = (province, city = "全部城市") => searchPortableSnapshot({province, city}, saved);
  const result = query("全部地区");
  assert.equal(result.totalJobs, samples.length);
  const byId = new Map(result.companies[0].jobs.map(job => [job.id, job]));
  assert.deepEqual(byId.get("0").cities, ["武汉"]);
  assert.deepEqual(byId.get("1").cities, ["上海", "北京"]);
  assert.deepEqual(byId.get("2").cities, ["孝感"]);
  assert.deepEqual(byId.get("3").cities, ["武汉", "福州"]);
  assert.equal(byId.get("3").locationRaw, samples[3].locationRaw);
  assert.deepEqual(byId.get("4").cities, ["城市待核"]);
  assert.deepEqual(byId.get("5").cities, ["城市待核"]);
  assert.deepEqual(byId.get("6").cities, ["上海", "成都"]);
  assert.equal(byId.get("7").cityPending, true);
  assert.equal(query("广东", "城市待核").companies[0].jobs[0].id, "8");
  assert.equal(query("广东", "深圳").totalJobs, 0);
  assert(query("福建", "城市待核").companies[0].jobs.some(job => job.id === "7"));
  assert(query("上海", "多城市").companies[0].jobs.some(job => job.id === "6"));
  assert(query("四川", "成都").companies[0].jobs.some(job => job.id === "6"));
  assert.equal(query("福建", "福州").companies[0].jobs[0].id, "3");
  assert(query("湖北", "武汉").companies[0].jobs.some(job => job.id === "3"));
});
