import assert from "node:assert/strict";
import test from "node:test";
import { coverageFromPortableSnapshot, searchPortableSnapshot } from "../../web-candidate/src/server/portablePublicationApi.ts";

const cases = [
  ["source-astrazeneca-social", "(Asso.) Clinical Quality Manager", "质量", "临床质量"],
  ["source-astrazeneca-social", "Clinical Supply Chain Planner", "供应链/采购", "临床供应链"],
  ["source-astrazeneca-social", "(Senior) Director, Clinical Pharmacology", "研发/科学", "临床药理"],
  ["source-astrazeneca-social", "(Associate) Country Study Manager - Rare Disease", "临床运营", "临床研究执行"],
  ["source-novartis-social", "Medical Scientific Liaison - IMMU 北京", "医学事务", "医学联络"],
  ["source-novartis-social", "（高级）医药代表/（资深）产品专员", "销售", "医药销售"],
  ["source-sanofi-china-social", "糖尿病事业部-District Manager-重庆", "销售", "销售管理"],
  ["source-sanofi-china-social", "特药事业部 医学信息沟通代表 上海", "销售", "医药销售"],
  ["source-novartis-social", "Product Manager", "市场", "品牌市场"],
  ["fixture", "Clinical Trial Supply Chain Manager", "供应链/采购", "临床供应链"],
  ["fixture", "Clinical Trials Supply Manager", "供应链/采购", "临床供应链"],
  ["fixture", "Quality Engineer", "质量", "质量保证"],
  ["fixture", "Sales Recruiter", "职能", "人力资源"],
  ["source-qilu-social", "质量研究国际注册总监（专业）(J10977)", "注册", "注册事务"],
  ["source-qilu-social", "化学创新药原料药研发领军人才（CSO）（海内外招聘）(J10826)", "研发/科学", "研发科学"],
  ["source-qilu-social", "小分子创新药分析总监或首席专家（CSO）（海内外招聘）(J10834)", "其他", undefined],
  ["source-qilu-social", "社会招聘资深专员/高级专员(J11149)", "职能", "人力资源"],
  ["source-hengrui-social", "RWE统计师-生物统计与编程部-中央医学事务部", "医学事务", undefined],
  ["source-hengrui-social", "注册安全工程师-邛崃羊安", "生产/工程", "工程技术"],
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
    assert.equal(job.officialTitle, title);
    assert.deepEqual([job.category, job.subcategory ?? undefined], [category, subcategory], title);
  }
  assert.equal(byId.get("manual").category, "医学事务");
  assert.equal(byId.get("manual").subcategory ?? undefined, undefined);
  assert.equal(byId.get("manual-quality").category, "质量");
  assert.equal(byId.get("manual-quality").subcategory, "临床质量");
  assert.equal(byId.get("manual-quality").categoryManuallyCorrected, undefined);
  assert.equal(byId.get("manual-other").category, "其他");
  assert.equal(byId.get("manual-other").categoryManuallyCorrected, undefined);
  assert.equal(query({ categories: ["销售"] }).totalJobs, 3);
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
      expected: index === 5 ? ["销售", undefined] : ["销售", "医药销售"],
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
      expected: ["销售", "医药销售"],
    },
    {
      id: "different-origin", sourceId: "source-sanofi-china-social", category: "其他",
      officialTitle: "SC Medical Information Communication Manager Beijing",
      officialUrl: "https://example.com/ats/job-detail-new/13537/R2877042/c/",
      expected: ["销售", "医药销售"],
    },
    ...["299857", "999999"].map((id) => ({
      id, sourceId: "source-merck-china-social", category: "其他",
      officialTitle: "(高级)产品经理",
      officialUrl: `https://careers.emdgroup.com/us/en/job/${id}`,
      expected: ["市场", "品牌市场"],
    })),
    ...["101034777968", "999999999999"].map((id) => ({
      id, sourceId: "source-takeda-china-social", category: "其他",
      officialTitle: "China Biomarker Lead",
      officialUrl: `https://jobs.takeda.com/job/shanghai/china-biomarker-lead/1113/${id}`,
      expected: id === "101034777968" ? ["研发/科学", "转化医学"] : ["其他", undefined],
    })),
    ...[
      ["10090075", "Head of GBA Strategy & Operation", "head-gba-strategy-operation", "职能"],
      ["10090555", "Capability Building Manager - Area", "capability-building-manager-area", "销售"],
      ["10090556", "Capability Building Manager - Area", "capability-building-manager-area", "销售"],
      ["10090557", "Capability Building Manager - Rheum", "capability-building-manager-rheum", "销售"],
      ["10086238", "Clinical Development Medical Manager", "clinical-development-medical-manager", "研发/科学"],
      ["10090055", "Clinical Development Medical Manager", "clinical-development-medical-manager", "研发/科学"],
      ["99999999", "Capability Building Manager - Area", "capability-building-manager-area", "其他"],
    ].map(([id, officialTitle, slug, category]) => ({
      id, officialTitle, sourceId: "source-novartis-social", category: "其他",
      officialUrl: `https://www.novartis.com.cn/careers/career-search/job/details/req-${id}-${slug}`,
      expected: [category, undefined],
    })),
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
  assert.equal(search(["销售"]).totalJobs, 14);
  assert.equal(search(["医药销售"]).totalJobs, 10);
  assert.equal(search(["医学事务"]).totalJobs, 0);
  assert.equal(search(["MSAT 技术转移"]).totalJobs, 1);
  assert.equal(search(["品牌市场"]).totalJobs, 2);
  assert.equal(search(["转化医学"]).totalJobs, 1);
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
  assert.deepEqual(ids("广东", "仅明确到省"), ["guangdong"]);
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
    ["source-pfizer-china-social", "CHN - SD - Shandong", "仅明确到省"],
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
  assert.equal(result.publishedJobSummary.cityPendingJobs, 4);
  assert.equal(search({province: "山西", city: "城市待核"}).totalJobs, 0);
  for (const job of result.companies[0].jobs) assert.equal(job.city, examples[Number(job.id)][2]);
  assert.equal(search({province: "山东", city: "仅明确到省"}).totalJobs, 1);
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
  assert.deepEqual(ids("山东", "仅明确到省"), [4]);
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

test("explicit official locations resolve with native evidence where list and detail may disagree", () => {
  const novo = "source-novo-nordisk-china-social";
  const organon = "source-organon-china-social";
  const nanchangUrl = "https://organon.wd5.myworkdayjobs.com/SearchJobs/job/CHN---Jiangxi---Nanchang/Sr-Pharmaceutical-Info-Specialist_R543217-2/apply";
  const hangzhouUrl = "https://organon.wd5.myworkdayjobs.com/SearchJobs/job/CHN---Hangzhou/Sr-District-Manager_R543371/apply";
  const wuhanUrl = "https://organon.wd5.myworkdayjobs.com/SearchJobs/job/CHN---Hubei---Wuhan/District-Manager_R543466/apply";
  const locations = [
    [novo, "医药代表-咸宁", "China, Xianning", "", "湖北", "咸宁"],
    [novo, "医药代表-齐齐哈尔", "China, Qiqihaer", "", "黑龙江", "齐齐哈尔"],
    [organon, "Sr. Pharmaceutical Info Specialist", "Nanchang, Jiangxi, China", nanchangUrl, "江西", "南昌"],
    [novo, "医药代表-朝阳", "China, Chaoyang", "", "全部地区", "城市待核"],
    [novo, "医药代表-齐齐哈尔", "China, Xianning", "", "全部地区", "城市待核"],
    [organon, "Sr. Pharmaceutical Info Specialist", "Nanchang, Jiangxi, China", "", "江西", "城市待核"],
    [organon, "Sr. Pharmaceutical Info Specialist", "Nanchang, Shanxi, China", nanchangUrl, "全部地区", "城市待核"],
    [organon, "Sr. District Manager", "Hangzhou, China", hangzhouUrl, "浙江", "杭州"],
    [organon, "Sr. District Manager", "Hangzhou, China", "", "全部地区", "城市待核"],
    [organon, "Sr. District Manager", "Hangzhou, China", hangzhouUrl.replace("R543371", "R999999"), "全部地区", "城市待核"],
    // R543466 native detail says CHN - Chengdu despite the Wuhan list and URL.
    [organon, "District Manager", "Wuhan, Hubei, China", wuhanUrl, "湖北", "城市待核"],
    [organon, "District Manager", "Wuhan, Hubei, China", wuhanUrl.replace("CHN---Hubei---Wuhan", "CHN---Chengdu"), "湖北", "城市待核"],
    [organon, "District Manager", "Taiyuan, Shanxi, China", "", "山西", "太原"],
    [organon, "District Manager", "Zhengzhou, Henan, China", "", "河南", "郑州"],
    [organon, "District Manager", "Unknown, Hubei, China", "", "湖北", "城市待核"],
    [novo, "医药代表-辽阳", "China, Liaoyang", "", "辽宁", "辽阳"],
    ...[
      ["China - Shanxi - YangQuan", "山西", "阳泉"],
      ["CHN - HA - Henan | China - Henan - Luoyang", "河南", "洛阳"],
      ["China - Hebei - ZhangJiaKou", "河北", "张家口"],
      ["China - Jiangsu - ZhangJiagang", "江苏", "张家港"],
      ["China - Liaoning - FuShun", "辽宁", "抚顺"],
      ["China - Jiangsu - Kunshan", "江苏", "昆山"],
      ["China - Shanxi - JinZhong", "山西", "晋中"],
      ["China - Liaoning - PanJin", "辽宁", "盘锦"],
      ["China - Guizhou - Qianxinan", "贵州", "黔西南"],
      ["China - Shanxi - BaoJi", "全部地区", "城市待核"],
      ["China - Shanxi - YuLin", "全部地区", "城市待核"],
      ["China - Shanxi - WeiNan", "全部地区", "城市待核"],
      ["China - Jiangsu - YangQuan", "全部地区", "城市待核"],
    ].map(([raw, province, city]) => ["source-pfizer-china-social", "医学信息沟通专员", raw, "", province, city]),
  ];
  const jobs = locations.map(([sourceId, officialTitle, locationRaw, officialUrl], id) => ({
    ...oldJobs[0], id: String(id), sourceId, officialTitle, locationRaw, officialUrl, city: "城市待核", cities: ["城市待核"],
  }));
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs }] };
  for (const [id, [, , locationRaw, , province, city]] of locations.entries()) {
    const result = searchPortableSnapshot({ province, city }, saved);
    const job = result.companies.flatMap(company => company.jobs).find(job => job.id === String(id));
    assert.deepEqual(job?.cities, [city]);
    assert.equal(job.locationRaw, locationRaw);
  }
});

test("reviewed AZ and Roche role fallbacks respect source, department and manual category boundaries", () => {
  const examples = [
    ["source-astrazeneca-social", "Diagnosis Science Liaison-OC-Chengdu", "销售", "医药销售"],
    ["source-roche-china-social", "Head of MSAT Technology Transfer MSAT技术转移负责人", "生产/工程", "MSAT 技术转移"],
    ["source-roche-china-social", "MSAT Manager in Plant", "生产/工程", "生产制造"],
    ["source-roche-china-social", "Assc MSAT Manager - Validation Expert", "生产/工程", "工程技术"],
    ["source-roche-china-social", "MSAT Manager", "其他", undefined],
    ["fixture", "Diagnosis Science Liaison-OC-Chengdu", "其他", undefined],
    ["source-astrazeneca-social", "Diagnostic Specialist", "其他", undefined],
  ];
  const jobs = examples.map(([sourceId, officialTitle], id) => ({...oldJobs[0], id: String(id), sourceId, officialTitle}));
  jobs.push({...jobs[0], id: "department", category: "医学事务"});
  jobs.push({...jobs[0], id: "manual", category: "其他", categoryManuallyCorrected: true});
  const saved = {...snapshot, companies: [{...snapshot.companies[0], jobs}]};
  const result = searchPortableSnapshot({city: "全部城市"}, saved);
  const byId = new Map(result.companies[0].jobs.map(job => [job.id, job]));
  assert.equal(result.totalJobs, jobs.length);
  for (const [id, [, , category, subcategory]] of examples.entries()) {
    const job = byId.get(String(id));
    assert.deepEqual([job.category, job.subcategory], [category, subcategory]);
  }
  assert.equal(byId.get("department").category, "医学事务");
  assert.equal(byId.get("manual").category, "其他");
});

test("Novartis social search excludes confirmed internships and applies approved role categories", () => {
  const job = (id, officialTitle, sourceId = "source-novartis-social") => ({
    ...oldJobs[0], id, sourceId, officialTitle, title: officialTitle,
    officialUrl: "https://www.novartis.com.cn/careers/career-search/job/details/req-" + id + "-official-role",
  });
  const rows = [
    ...["10087296", "10088943", "10092349", "10092450", "10091068", "10090456"].map(id => job(id, "MR Intern")),
    job("10080456", "Data Management & Infrastructure Lead"),
    job("10087318", "New Products Lead"),
    { ...job("10087296", "Another source vacancy", "fixture"), id: "other-source" },
  ];
  const current = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs: rows }] };
  const result = searchPortableSnapshot({ city: "全部城市" }, current);
  assert.equal(result.publishedJobSummary.totalJobs, 3);
  assert.deepEqual(Object.fromEntries(result.companies[0].jobs.map(j => [j.id, [j.category, j.subcategory]])), {
    "10080456": ["数据/IT", "信息技术"],
    "10087318": ["市场", "品牌市场"],
    "other-source": ["其他", undefined],
  });
  assert.equal(searchPortableSnapshot({ city: "全部城市", keyword: "MR Intern" }, current).totalJobs, 0);
  assert.equal(rows.length, 9);
});

test("Hansoh social search omits the four verified campus vacancies", () => {
  const sourceId = "source-hansoh-social";
  const officialUrl = id => "https://hspharm.zhiye.com/social/detail?jobAdId=" + id;
  const campusJobs = [
    ["5872825e-9a36-4e86-af26-e5e9e77c9959", "工艺员（2027校招）(J16833)"],
    ["ccad94da-9ea2-4cb0-8583-913608cf2b42", "QA（2027校招）(J16834)"],
    ["157a8a20-a5ef-497f-9bcd-6cf62d18a7f9", "工艺安全工程师（2027校招）(J16835)"],
    ["d579d1b4-7d3b-4238-b33b-ed38e2e071cc", "公用工程技术员（2027校招）(J16836)"],
  ].map(([id, title]) => ({ ...oldJobs[0], id, sourceId, category: "质量", categoryManuallyCorrected: true,
    title, officialTitle: title, officialUrl: officialUrl(id), inGrace: false }));
  const rows = [
    ...campusJobs,
    { ...campusJobs[0], id: "legacy-copy", inGrace: true, title: "工艺员", officialTitle: "工艺员" },
    { ...campusJobs[1], id: "other-source", sourceId: "fixture", title: "合规专员", officialTitle: "合规专员", category: "职能" },
    { ...campusJobs[2], id: "different-url", officialUrl: officialUrl("11111111-1111-4111-8111-111111111111"),
      title: "医药代表实习生", officialTitle: "医药代表实习生", category: "销售" },
  ];
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], id: "company-hansoh",
    companyName: "豪森", pinyin: "haosen", health: "HEALTHY", publishingSourceIds: [sourceId], sourceIds: [sourceId], jobs: rows }] };
  const search = (request = {}) => searchPortableSnapshot({ city: "全部城市", ...request }, saved);
  const result = search();
  assert.deepEqual(result.companies[0].jobs.map(job => job.id).sort(), ["other-source"]);
  assert.equal(result.totalJobs, 1);
  assert.equal(result.publishedJobSummary.totalJobs, 1);
  assert.equal(result.cityFacets.find(facet => facet.city === "上海").jobCount, 1);
  assert.equal(result.provinceFacets.find(facet => facet.province === "上海").jobCount, 1);
  assert.equal(search({ keyword: "2027校招" }).totalJobs, 0);
  assert.equal(search({ categories: ["质量"] }).totalJobs, 0);
  const coverage = coverageFromPortableSnapshot({ keyword: "" }, saved);
  assert.equal(coverage.coverageSummary.publishingCompanyCount, 1);
  assert.equal(coverage.companies[0].state, "PUBLISHING");
  assert.equal(saved.companies[0].jobs.length, 7);
});

test("expanded unambiguous pharmaceutical role classifications leave ambiguous titles unchanged", () => {
  const expandedCases = [
    ["fixture", "Cloud Platform Engineer", "数据/IT", "信息技术"],
    ["fixture", "Python全栈开发工程师", "数据/IT", "信息技术"],
    ["fixture", "滴眼剂质量工程师", "质量", "质量保证"],
    ["fixture", "Statistical Programming Lead", "研发/科学", "生物统计"],
    ["fixture", "统计编程经理", "研发/科学", "生物统计"],
    ["fixture", "Director, Statistical Genetics", "研发/科学", "生物统计"],
    ["fixture", "公用工程设备运维", "生产/工程", "工程技术"],
    ["source-hengrui-social", "医药信息沟通高级专员", "销售", "医药销售"],
    ["source-pfizer-china-social", "医学信息沟通主管", "销售", "销售管理"],
    ["source-roche-china-social", "治疗领域经理", "销售", "医药销售"],
    ["source-takeda-china-social", "MCR, GI, Suzhou", "销售", "医药销售"],
    ["source-takeda-china-social", "(S)PM, Oncology", "销售", "销售管理"],
    ["source-takeda-china-social", "(S)RM, Rare Disease", "销售", "销售管理"],
    ["source-bayer-healthcare-social", "Medical Specialist", "销售", "医药销售"],
    ["source-viatris-social", "医学信息沟通代表", "销售", "医药销售"],
    ["source-shanghai-pharma-social", "医学信息沟通专员", "销售", "医药销售"],
    ["source-astrazeneca-social", "DSM, CV", "销售", "销售管理"],
    ["source-astrazeneca-social", "BM-Oncology", "市场", "品牌市场"],
    ["source-daiichi-sankyo-china-social", "ASM-广州", "销售", "销售管理"],
    ["fixture", "SAE", "KA", "大客户管理"],
    ["fixture", "客户解决方案专员", "KA", "大客户管理"],
    ["fixture", "Assistant Product Manager", "市场", "品牌市场"],
    ["fixture", "RPM", "市场", "品牌市场"],
    ["fixture", "临床项目高级经理", "临床运营", "临床研究执行"],
    ["fixture", "中心稽查", "质量", "临床质量"],
    ["fixture", "安全医生", "药物警戒/安全", "药物安全"],
    ["fixture", "RA Operations", "注册", "注册事务"],
    ["fixture", "医药信息沟通专员", "销售", "医药销售"],
    ["fixture", "药物发现与药效学", "研发/科学", "药物发现"],
    ["fixture", "市场准入项目规划", "市场准入/政府事务", "准入与定价"],
    ["fixture", "数据洞察", "数据/IT", "数据科学"],
    ["fixture", "投资者关系", "职能", "财务"],
    ["fixture", "早期研究", "研发/科学", "研发科学"],
    ["fixture", "灌装操作", "生产/工程", "生产制造"],
    ["source-abbvie-china-social", "District Mgr - Medical Aesth", "销售", "销售管理"],
    ["source-amgen-china-social", "District Manager-CV", "销售", "销售管理"],
    ["source-pfizer-china-social", "零售地区经理", "销售", "销售管理"],
    ["source-pfizer-china-social", "零售代表", "销售", "零售销售"],
    ["source-kelun-social", "科伦嘉讯-省区经理（云贵）(J13395)", "销售", "销售管理"],
    ["source-hengrui-social", "临床协调专员/高级专员", "临床运营", "临床研究执行"],
    ["source-astrazeneca-social", "Global Study Lead", "临床运营", "临床研究执行"],
    ["source-amgen-china-social", "Sr Associate Global Safety", "药物警戒/安全", "药物安全"],
    ["source-astellas-china-social", "China Safety Officer", "药物警戒/安全", "药物安全"],
    ["source-astrazeneca-social", "Safety Data Lead I", "药物警戒/安全", "药物安全"],
    ["source-astrazeneca-social", "(Senior) Medical Science Manager (CVM)", "医学事务", "医学顾问"],
    ["source-astellas-china-social", "Field Force Training Expert – China", "销售", "培训与赋能"],
    ["source-astellas-china-social", "Lead, CMC Lead China", "研发/科学", "研发科学"],
    ["source-fosun-pharma-social", "(高级)医药信息专员-肿瘤领域(J13593)", "销售", "医药销售"],
    ["source-msd-china-social", "Asso. Pharmaceutical Information Manager, Onco", "销售", "医药销售"],
    ["source-cttq-social", "推广专员（长春-肝病领域）(J16856)", "销售", "医药销售"],
    ["source-daiichi-sankyo-china-social", "PV Physician-上海", "药物警戒/安全", "药物安全"],
    ["source-qilu-social", "PV医生(J10733)", "药物警戒/安全", "药物安全"],
    ["source-hengrui-social", "BBU 业务管理团队 省区准入经理 外招", "市场准入/政府事务", "准入与定价"],
    ["source-hengrui-social", "BBU 业务管理团队 准入（KB）主管/经理（副本）", "市场准入/政府事务", "准入与定价"],
    ["source-merck-china-social", "医学教育项目经理-北京", "医学事务", "医学顾问"],
    ["source-fosun-pharma-social", "创新药专利事务副总监/总监(J14596)", "职能", "法务合规"],
    ["source-astrazeneca-social", "Associate Director External Quality", "质量", "质量保证"],
    ["source-merck-china-social", "Sourcing Manager", "供应链/采购", "采购"],
    ["source-roche-china-social", "区域市场专员", "市场", "品牌市场"],
    ["source-shanghai-pharma-social", "网络安全负责人(J13032)", "数据/IT", "信息技术"],
    ["source-qilu-social", "JAVA开发顾问(J10922)", "数据/IT", "信息技术"],
    ["source-qilu-social", "MES项目经理(J11159)", "数据/IT", "信息技术"],
    ["source-viatris-social", "临床研究负责人", "临床运营", "临床研究执行"],
    ["source-amgen-china-social", "Regional Manager-BI-North", "其他", undefined],
  ];
  const expandedJobs = expandedCases.map(([sourceId, officialTitle], id) => ({
    ...oldJobs[0], id: `exp-${id}`, sourceId, officialTitle, title: officialTitle,
  }));
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs: expandedJobs }] };
  const result = searchPortableSnapshot({ city: "全部城市" }, saved);
  const byId = new Map(result.companies[0].jobs.map(job => [job.id, job]));
  for (const [id, [, title, category, subcategory]] of expandedCases.entries()) {
    const job = byId.get(`exp-${id}`);
    assert.deepEqual([job.category, job.subcategory ?? undefined], [category, subcategory], title);
  }
});

test("social search filters explicit campus and intern titles before counting jobs and facets", () => {
  const titles = [
    ["研究实习", "Research"], ["销售", "销售（校招）"], ["校园招聘技术员", "技术员"],
    ["行政", "应届岗位"], ["MR INTERN", "MR"], ["Sales", "Brand Internship"],
    ["管培生", "管培生"], ["International Operations", "Internal Audit"],
  ];
  const rows = titles.map(([title, officialTitle], id) => ({ ...oldJobs[0], id: String(id), title, officialTitle }));
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs: rows }] };
  const original = structuredClone(saved);
  const result = searchPortableSnapshot({ city: "全部城市" }, saved);
  assert.deepEqual(result.companies[0].jobs.map(job => job.id).sort(), ["6", "7"]);
  assert.equal(result.publishedJobSummary.totalJobs, 2);
  assert.equal(result.cityFacets.find(facet => facet.city === "上海").jobCount, 2);
  assert.deepEqual(saved, original);
});

test("public search resolves official locality aliases, Tier labels and distinct work cities", () => {
  const examples = [
    ...[
      ["Shaoyang (Hunan Province)", "邵阳"], ["Zhuzhou (Hunan Province)", "株洲"],
      ["Liuyang (Hunan Province)", "浏阳"], ["Yueyang (Hunan Province)", "岳阳"],
      ["Ezhou (Hubei Province)", "鄂州"], ["Kaili (Guizhou Province)", "凯里"],
      ["Qiqihar (Heilongjiang Province)", "齐齐哈尔"], ["Daqing (Heilongjiang Province)", "大庆"],
      ["Tonghua (Jilin Province)", "通化"], ["Dandong (Liaoning Province)", "丹东"],
      ["Huludao (Liaoning Province)", "葫芦岛"], ["Xingtai (Hebei Province)", "邢台"],
      ["Qinhuangdao (Hebei Province)", "秦皇岛"],
    ].map(([raw, city]) => ["source-novartis-social", raw, "医药代表", [city]]),
    ...[
      ["China - Jiangxi - Ji'An", "吉安"], ["China - Shandong - Tai'an", "泰安"],
      ["China - Hubei - XiangFan", "襄阳"], ["China - Hunan - HuaiHua", "怀化"],
      ["China - Hunan - ShaoYang", "邵阳"], ["CHN - SH - Shanghai (Tier 1)", "上海"],
      ["CHN - Anhui (Tier 3) | China - Anhui - Hefei", "合肥"],
    ].map(([raw, city]) => ["source-pfizer-china-social", raw, "医学信息沟通专员", [city]]),
    ["source-pfizer-china-social", "CHN - Hubei (Tier 3)", "辉瑞生物制药+零售关键客户专员+武汉", ["武汉"]],
    ["source-pfizer-china-social", "CHN - Hunan (Tier 3)", "医学信息沟通专员-武汉", ["城市待核"]],
    ["source-msd-china-social", "Nanning、Qionghai", "销售代表", ["南宁", "琼海"]],
    ["source-merck-china-social", "Beijing, Beijing, China", "Product Manager", ["北京"]],
    ["source-takeda-china-social", "Remote", "MCR, GI, Hohhot", ["呼和浩特"]],
    ["source-takeda-china-social", "Remote", "MCR, OBU, ST, Jinzhou", ["锦州"]],
  ];
  const rows = examples.map(([sourceId, locationRaw, officialTitle], id) => ({
    ...oldJobs[0], id: String(id), sourceId, officialTitle, locationRaw, city: "城市待核", cities: ["城市待核"],
  }));
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs: rows }] };
  const result = searchPortableSnapshot({ city: "全部城市" }, saved);
  assert.equal(result.totalJobs, examples.length);
  for (const job of result.companies[0].jobs) {
    assert.deepEqual(job.cities, examples[Number(job.id)][3], job.locationRaw);
  }
});

test("official requisition details disambiguate a city only for the reviewed vacancy", () => {
  const officialUrl = "https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.348703.en_GB.html";
  const original = { ...oldJobs[0], sourceId: "source-novo-nordisk-china-social", officialTitle: "医药代表-朝阳",
    locationRaw: "China, Chaoyang", city: "城市待核", cities: ["城市待核"], officialUrl };
  const jobs = [original, { ...original, id: "other", officialUrl: officialUrl.replace("348703", "999999") }];
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs }] };
  const result = searchPortableSnapshot({ city: "全部城市" }, saved);
  const byId = new Map(result.companies[0].jobs.map(job => [job.id, job]));
  assert.deepEqual(byId.get(original.id).cities, ["朝阳"]);
  assert.equal(byId.get("other").cityPending, true);
});

test("province-only facets match the public province filter and exclude named cities", () => {
  const row = { ...oldJobs[0], sourceId: "source-pfizer-china-social", officialTitle: "医学信息沟通专员",
    city: "城市待核", cities: ["城市待核"], locationRaw: "CHN - Shandong (Tier 3)" };
  const saved = { ...snapshot, companies: [{ ...snapshot.companies[0], jobs: [row] }] };
  const query = (province, city) => searchPortableSnapshot({ province, city }, saved);
  const provinceOnly = query("山东", "仅明确到省");
  assert.equal(provinceOnly.companies[0].jobs[0].provinceOnly, "山东");
  assert.equal(provinceOnly.publishedJobSummary.provinceOnlyJobs, 1);
  assert.equal(provinceOnly.publishedJobSummary.cityPendingJobs, 0);
  assert.equal(provinceOnly.provinceFacets.find(f => f.province === "山东").provinceOnlyJobs, 1);
  assert.equal(query("江苏", "仅明确到省").totalJobs, 0);
  assert.equal(query("山东", "济南").totalJobs, 0);
  assert.equal(query("山东", "城市待核").totalJobs, 0);
});
