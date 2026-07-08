import type { ATSKind, SourceKind, VerificationStatus } from "../domain/company";

export interface CandidateRecruitmentSource {
  id: string;
  companyId: string;
  kind: SourceKind;
  atsKind: ATSKind;
  status: VerificationStatus;
  officialEntryUrl?: string;
  officialChainEvidenceUrl?: string;
  campusEntryUrl?: string;
}

export interface CandidateCompany {
  id: string;
  officialChineseName: string;
  officialWebsiteUrl?: string;
  pinyinName: string;
  inclusionReason: string;
  sources: CandidateRecruitmentSource[];
}

export interface CandidatePoolStats {
  totalCandidates: number;
  socialSources: number;
  campusSources: number;
  verifiedScrapableCompanies: number;
  canLaunchP0: boolean;
}

interface CandidateSeed {
  id: string;
  officialChineseName: string;
  pinyinName: string;
  inclusionReason: string;
  status?: VerificationStatus;
  atsKind?: ATSKind;
  officialWebsiteUrl?: string;
  socialEntryUrl?: string;
  officialChainEvidenceUrl?: string;
  includeCampusPlaceholder?: boolean;
}

const P0_MIN_CANDIDATES = 80;
const P0_MAX_CANDIDATES = 120;
const P0_MIN_VERIFIED_SCRAPABLE = 50;

function sourceIdFor(companyId: string, kind: "social" | "campus"): string {
  return `source-${companyId.replace(/^company-/, "")}-${kind}`;
}

function toRecruitmentSource(seed: CandidateSeed): CandidateRecruitmentSource {
  return {
    id: sourceIdFor(seed.id, "social"),
    companyId: seed.id,
    kind: "SOCIAL",
    atsKind: seed.atsKind ?? "UNKNOWN",
    status: seed.status ?? "UNVERIFIED",
    ...(seed.socialEntryUrl && seed.officialChainEvidenceUrl
      ? { officialEntryUrl: seed.socialEntryUrl }
      : {}),
    ...(seed.officialChainEvidenceUrl
      ? { officialChainEvidenceUrl: seed.officialChainEvidenceUrl }
      : {})
  };
}

function toCampusSource(seed: CandidateSeed): CandidateRecruitmentSource {
  return {
    id: sourceIdFor(seed.id, "campus"),
    companyId: seed.id,
    kind: "CAMPUS",
    atsKind: "UNKNOWN",
    status: "UNVERIFIED"
  };
}

function toCompany(seed: CandidateSeed): CandidateCompany {
  const sources = [toRecruitmentSource(seed)];

  if (seed.includeCampusPlaceholder) {
    sources.push(toCampusSource(seed));
  }

  return {
    id: seed.id,
    officialChineseName: seed.officialChineseName,
    pinyinName: seed.pinyinName,
    inclusionReason: seed.inclusionReason,
    sources,
    ...(seed.officialWebsiteUrl ? { officialWebsiteUrl: seed.officialWebsiteUrl } : {})
  };
}

// Missing official-chain evidence is represented by absent URL fields.
// Only companies with first-party official-chain evidence are VERIFIED_SCRAPABLE.
const CANDIDATE_SEEDS: CandidateSeed[] = [
  {
    id: "company-hengrui",
    officialChineseName: "江苏恒瑞医药股份有限公司",
    pinyinName: "hengrui",
    inclusionReason: "国内头部药企、已实测",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "MOKA",
    officialWebsiteUrl: "https://www.hengrui.com/",
    socialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
    officialChainEvidenceUrl: "https://www.hengrui.com/development/recruit.html",
    includeCampusPlaceholder: true
  },
  {
    id: "company-astrazeneca",
    officialChineseName: "阿斯利康制药有限公司",
    pinyinName: "asili-kang",
    inclusionReason: "外资药企中国区、已实测",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.astrazeneca.cn/",
    socialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
    officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers",
    includeCampusPlaceholder: true
  },
  {
    id: "company-beigene",
    officialChineseName: "百济神州",
    pinyinName: "baiji-shenzhou",
    inclusionReason: "知名 Biotech、已实测",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "MOKA",
    officialWebsiteUrl: "https://www.beonemedicines.com.cn/",
    socialEntryUrl:
      "https://app.mokahr.com/apply/beigene/98934?sourceToken=ac8c1724c2ec857aed0ae5d025631e2a#/jobs",
    officialChainEvidenceUrl: "https://www.beonemedicines.com.cn/careers/careers/",
    includeCampusPlaceholder: true
  },
  {
    id: "company-sino-biopharmaceutical",
    officialChineseName: "中国生物制药有限公司",
    pinyinName: "zhongguo-shengwu-zhiyao",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-cspc",
    officialChineseName: "石药控股集团有限公司",
    pinyinName: "shiyao",
    inclusionReason: "国内头部药企、已实测",
    status: "ENTRY_FOUND_PENDING_ADAPTER",
    atsKind: "REDSEA",
    officialWebsiteUrl: "https://www.e-cspc.com/",
    socialEntryUrl: "https://www.e-cspc.com/hr/",
    officialChainEvidenceUrl: "https://www.e-cspc.com/hr/"
  },
  {
    id: "company-qilu",
    officialChineseName: "齐鲁制药集团有限公司",
    pinyinName: "qilu",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-yangzijiang",
    officialChineseName: "扬子江药业集团有限公司",
    pinyinName: "yangzijiang",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-fosun-pharma",
    officialChineseName: "上海复星医药（集团）股份有限公司",
    pinyinName: "fosun-yiyao",
    inclusionReason: "国内头部药企、已实测",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.fosunpharma.com/careers",
    socialEntryUrl: "https://fosunpharma.zhiye.com/social",
    officialChainEvidenceUrl: "https://www.fosunpharma.com/careers"
  },
  {
    id: "company-novartis",
    officialChineseName: "北京诺华制药有限公司",
    pinyinName: "nuohua",
    inclusionReason: "外资药企中国区、已实测",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.novartis.com.cn/",
    socialEntryUrl: "https://prod1.novartis.com/careers/career-search/tag/LOC_CN",
    officialChainEvidenceUrl: "https://prod1.novartis.com/careers/career-search/tag/LOC_CN"
  },
  {
    id: "company-sinopharm",
    officialChineseName: "中国医药集团有限公司",
    pinyinName: "guoyao",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-sanofi-china",
    officialChineseName: "赛诺菲（中国）投资有限公司",
    pinyinName: "sainuofei",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.sanofi.com/",
    socialEntryUrl: "https://jobs.sanofi.com/en/china",
    officialChainEvidenceUrl: "https://jobs.sanofi.com/en/china"
  },
  {
    id: "company-kelun",
    officialChineseName: "四川科伦药业股份有限公司",
    pinyinName: "kelun",
    inclusionReason: "国内头部药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.kelun.com/",
    socialEntryUrl: "https://kelun.zhiye.com/social",
    officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html",
    includeCampusPlaceholder: true
  },
  {
    id: "company-roche-china",
    officialChineseName: "上海罗氏制药有限公司",
    pinyinName: "luoshi",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.roche.com.cn/",
    socialEntryUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext",
    officialChainEvidenceUrl: "https://careers.roche.com/cn/zh/china-mainland"
  },
  {
    id: "company-shanghai-pharma",
    officialChineseName: "上海医药集团股份有限公司",
    pinyinName: "shanghai-yiyao",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-pfizer-china",
    officialChineseName: "辉瑞中国",
    pinyinName: "huirui",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.pfizer.com/",
    socialEntryUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
    officialChainEvidenceUrl: "https://www.pfizer.com/about/careers"
  },
  {
    id: "company-hansoh",
    officialChineseName: "翰森制药集团有限公司",
    pinyinName: "hansen",
    inclusionReason: "国内头部药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://cn.hspharm.com/",
    socialEntryUrl: "https://hspharm.zhiye.com/Social",
    officialChainEvidenceUrl: "https://cn.hspharm.com/site/solr.htm"
  },
  {
    id: "company-guangzhou-pharma",
    officialChineseName: "广州医药集团有限公司",
    pinyinName: "guangyao",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-huadong-medicine",
    officialChineseName: "华东医药股份有限公司",
    pinyinName: "huadong-yiyao",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-cr-sanjiu",
    officialChineseName: "华润三九医药股份有限公司",
    pinyinName: "huarun-sanjiu",
    inclusionReason: "国内头部药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "HOTJOB_WECRUIT",
    officialWebsiteUrl: "https://www.999.com.cn/",
    socialEntryUrl: "https://wecruit.hotjob.cn/SU613834ecbef57c3b6383b50e/pb/index.html",
    officialChainEvidenceUrl: "https://www.999.com.cn/applicationGuide/index.html"
  },
  {
    id: "company-msd-china",
    officialChineseName: "默沙东（中国）投资有限公司",
    pinyinName: "moshadong",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.msdchina.com.cn/",
    socialEntryUrl: "https://msd.wd5.myworkdayjobs.com/SearchJobs",
    officialChainEvidenceUrl: "https://jobs.msd.com/cn/zh"
  },
  {
    id: "company-bms-china",
    officialChineseName: "百时美施贵宝中国",
    pinyinName: "baishi-meishiguibao",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.bms.com/cn",
    socialEntryUrl: "https://bristolmyerssquibb.wd5.myworkdayjobs.com/BMS",
    officialChainEvidenceUrl: "https://careers.bms.com/cn/"
  },
  {
    id: "company-gilead-china",
    officialChineseName: "吉利德科学",
    pinyinName: "jilide-kexue",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.gileadchina.cn/",
    socialEntryUrl: "https://gilead.wd1.myworkdayjobs.com/gileadcareers",
    officialChainEvidenceUrl: "https://www.gilead.com/careers/opportunities"
  },
  {
    id: "company-agilent-china",
    officialChineseName: "安捷伦科技（中国）有限公司",
    pinyinName: "anjielun",
    inclusionReason: "器械/生命科学企业中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.agilent.com.cn/",
    socialEntryUrl: "https://agilent.wd5.myworkdayjobs.com/Agilent_Careers",
    officialChainEvidenceUrl: "https://careers.agilent.com/locations/asia-pacific/china/"
  },
  {
    id: "company-abbott-china",
    officialChineseName: "雅培中国",
    pinyinName: "yapei",
    inclusionReason: "外资医药/器械企业中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.abbott.com/",
    socialEntryUrl: "https://abbott.wd5.myworkdayjobs.com/abbottcareers",
    officialChainEvidenceUrl: "https://www.abbott.com/careers.html"
  },
  {
    id: "company-stryker-china",
    officialChineseName: "史赛克中国",
    pinyinName: "shisaike",
    inclusionReason: "外资器械企业中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.stryker.com/",
    socialEntryUrl: "https://stryker.wd1.myworkdayjobs.com/StrykerCareers",
    officialChainEvidenceUrl: "https://careers.stryker.com/"
  },
  {
    id: "company-gehc-china",
    officialChineseName: "通用电气医疗中国",
    pinyinName: "tongyong-dianqi-yiliao",
    inclusionReason: "外资器械企业中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.gehealthcare.com/",
    socialEntryUrl: "https://gehc.wd5.myworkdayjobs.com/gehc_externalsite",
    officialChainEvidenceUrl: "https://www.gehealthcare.com/about/careers"
  },
  {
    id: "company-edwards-china",
    officialChineseName: "爱德华生命科学中国",
    pinyinName: "aidehua-shengming-kexue",
    inclusionReason: "外资器械企业中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.edwards.com/",
    socialEntryUrl: "https://edwards.wd5.myworkdayjobs.com/edwardscareers",
    officialChainEvidenceUrl: "https://www.edwards.com/careers/jobsearch"
  },
  {
    id: "company-medtronic-china",
    officialChineseName: "美敦力中国",
    pinyinName: "meidunli",
    inclusionReason: "外资器械企业中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.medtronic.com/",
    socialEntryUrl: "https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers",
    officialChainEvidenceUrl: "https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers"
  },
  {
    id: "company-thermo-fisher-china",
    officialChineseName: "赛默飞世尔科技中国",
    pinyinName: "saimofei-shier",
    inclusionReason: "外资生命科学/器械企业中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.thermofisher.com/",
    socialEntryUrl: "https://jobs.thermofisher.com/global/en/china-jobs",
    officialChainEvidenceUrl: "https://jobs.thermofisher.com/global/en"
  },
  {
    id: "company-bayer-healthcare",
    officialChineseName: "拜耳医药保健有限公司",
    pinyinName: "baier",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "SUCCESSFACTORS",
    officialWebsiteUrl: "https://www.bayer.com.cn/",
    socialEntryUrl: "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN",
    officialChainEvidenceUrl: "https://www.bayer.com.cn/zh-hans/zhaoxiannashi"
  },
  {
    id: "company-novo-nordisk-china",
    officialChineseName: "诺和诺德（中国）制药有限公司",
    pinyinName: "nuohe-nuode",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.novonordisk.com/",
    socialEntryUrl: "https://www.novonordisk.com/careers/find-a-job/career-search-results.html",
    officialChainEvidenceUrl: "https://www.novonordisk.com/careers/find-a-job.html"
  },
  {
    id: "company-innovent",
    officialChineseName: "信达生物制药（苏州）有限公司",
    pinyinName: "xinda-shengwu",
    inclusionReason: "知名 Biotech、用户指定",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.innoventbio.com/",
    socialEntryUrl: "https://www.innoventbio.com/cn/recruit",
    officialChainEvidenceUrl: "https://www.innoventbio.com/cn/recruit"
  },
  {
    id: "company-yunnan-baiyao",
    officialChineseName: "云南白药集团股份有限公司",
    pinyinName: "yunnan-baiyao",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-grand-pharma-china",
    officialChineseName: "远大医药（中国）有限公司",
    pinyinName: "yuanda-yiyao",
    inclusionReason: "国内头部药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.grandpharma.cn/",
    socialEntryUrl: "https://job.grandpharma.cn/",
    officialChainEvidenceUrl: "https://job.grandpharma.cn/"
  },
  {
    id: "company-pien-tze-huang",
    officialChineseName: "漳州片仔癀药业股份有限公司",
    pinyinName: "pianzaihuang",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-renfu",
    officialChineseName: "人福医药集团股份公司",
    pinyinName: "renfu",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-tongrentang",
    officialChineseName: "中国北京同仁堂（集团）有限责任公司",
    pinyinName: "tongrentang",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-nhu",
    officialChineseName: "新和成控股集团有限公司",
    pinyinName: "xinhecheng",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-lunan",
    officialChineseName: "鲁南制药集团股份有限公司",
    pinyinName: "lunan",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-akeso",
    officialChineseName: "中山康方生物医药有限公司",
    pinyinName: "kangfang",
    inclusionReason: "知名 Biotech",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.akesobio.com/",
    socialEntryUrl: "https://www.akesobio.com/cn/career/social-recruitment/",
    officialChainEvidenceUrl: "https://www.akesobio.com/cn/career/"
  },
  {
    id: "company-changchun-high-tech",
    officialChineseName: "长春高新技术产业（集团）股份有限公司",
    pinyinName: "changchun-gaoxin",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-yiling",
    officialChineseName: "石家庄以岭药业股份有限公司",
    pinyinName: "yiling",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-3sbio",
    officialChineseName: "沈阳三生制药有限责任公司",
    pinyinName: "sansheng",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-viatris",
    officialChineseName: "晖致医药有限公司",
    pinyinName: "huizhi",
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-donga-ejiao",
    officialChineseName: "东阿阿胶股份有限公司",
    pinyinName: "donga-ejiao",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-jimin-kexin",
    officialChineseName: "江西济民可信集团有限公司",
    pinyinName: "jimin-kexin",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-united-lab",
    officialChineseName: "联邦制药国际控股有限公司",
    pinyinName: "lianbang-zhiyao",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-livzon",
    officialChineseName: "丽珠医药集团股份有限公司",
    pinyinName: "lizhu",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-china-tcm",
    officialChineseName: "中国中药控股有限公司",
    pinyinName: "zhongguo-zhongyao",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-taiji",
    officialChineseName: "太极集团有限公司",
    pinyinName: "taiji",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-johnson-innovative-medicine",
    officialChineseName: "强生创新制药有限公司",
    pinyinName: "qiangsheng",
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-lilly-china",
    officialChineseName: "礼来中国",
    pinyinName: "lilai",
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-tasly",
    officialChineseName: "天士力医药集团股份有限公司",
    pinyinName: "tianshili",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-takeda-china",
    officialChineseName: "武田（中国）投资有限公司",
    pinyinName: "wutian",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.takeda.com.cn/",
    socialEntryUrl: "https://jobs.takeda.com/location/china-jobs/1113/1814991/2",
    officialChainEvidenceUrl: "https://www.takeda.com/careers/"
  },
  {
    id: "company-huahai",
    officialChineseName: "浙江华海药业股份有限公司",
    pinyinName: "huahai",
    inclusionReason: "国内知名药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.huahaipharm.com/",
    socialEntryUrl: "https://www.huahaipharm.com/zpgw.html",
    officialChainEvidenceUrl: "https://www.huahaipharm.com/zpgw.html"
  },
  {
    id: "company-darentang",
    officialChineseName: "津药达仁堂集团股份有限公司",
    pinyinName: "darentang",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-simcere",
    officialChineseName: "先声药业有限公司",
    pinyinName: "xiansheng",
    inclusionReason: "国内知名药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "HOTJOB_WECRUIT",
    officialWebsiteUrl: "https://www.simcere.com/",
    socialEntryUrl: "https://wecruit.hotjob.cn/SU61458d83bef57c54dcb4e43f/pb/index.html",
    officialChainEvidenceUrl: "https://www.simcere.com/jrwm/jrwm.aspx"
  },
  {
    id: "company-jichuan",
    officialChineseName: "济川药业集团有限公司",
    pinyinName: "jichuan",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-legend-biotech",
    officialChineseName: "南京传奇生物科技有限公司",
    pinyinName: "chuanqi-shengwu",
    inclusionReason: "知名 Biotech"
  },
  {
    id: "company-joincare",
    officialChineseName: "健康元药业集团股份有限公司",
    pinyinName: "jiankangyuan",
    inclusionReason: "国内知名药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.joincare.com/",
    socialEntryUrl: "https://www.joincare.com/Social_recruitment.html",
    officialChainEvidenceUrl: "https://www.joincare.com/Social_recruitment.html"
  },
  {
    id: "company-haleon-china",
    officialChineseName: "赫力昂（中国）有限公司",
    pinyinName: "haleon",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.haleon.com/",
    socialEntryUrl: "https://gsknch.wd3.myworkdayjobs.com/GSKCareers",
    officialChainEvidenceUrl: "https://www.haleon.com/careers"
  },
  {
    id: "company-cr-double-crane",
    officialChineseName: "华润双鹤药业股份有限公司",
    pinyinName: "huarun-shuanghe",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-raas",
    officialChineseName: "上海莱士血液制品股份有限公司",
    pinyinName: "shanghai-laishi",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-salubris",
    officialChineseName: "深圳信立泰药业股份有限公司",
    pinyinName: "xinlitai",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-cms",
    officialChineseName: "康哲药业控股有限公司",
    pinyinName: "kangzhe",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-hisun",
    officialChineseName: "浙江海正药业股份有限公司",
    pinyinName: "haizheng",
    inclusionReason: "国内知名药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.hisunpharm.com/",
    socialEntryUrl: "https://www.hisunpharm.com/main/recruit-list.thtml?cId=10982",
    officialChainEvidenceUrl: "https://www.hisunpharm.com/main/recruit.thtml?cId=10981"
  },
  {
    id: "company-allist",
    officialChineseName: "上海艾力斯医药科技股份有限公司",
    pinyinName: "ailisi",
    inclusionReason: "知名 Biotech",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.allist.com.cn/",
    socialEntryUrl: "https://allist.zhiye.com/Social",
    officialChainEvidenceUrl: "https://www.allist.com.cn/recruit.html"
  },
  {
    id: "company-buchang",
    officialChineseName: "山东步长制药股份有限公司",
    pinyinName: "buchang",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-tiantan-bio",
    officialChineseName: "北京天坛生物制品股份有限公司",
    pinyinName: "tiantan-shengwu",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-conba",
    officialChineseName: "浙江康恩贝制药股份有限公司",
    pinyinName: "kangenbei",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-junshi",
    officialChineseName: "上海君实生物医药科技股份有限公司",
    pinyinName: "junshi",
    inclusionReason: "知名 Biotech、用户指定",
    status: "ENTRY_FOUND_PENDING_ADAPTER",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.junshipharma.com/",
    socialEntryUrl: "https://www.junshipharma.com/join/",
    officialChainEvidenceUrl: "https://www.junshipharma.com/join/"
  },
  {
    id: "company-zaiding",
    officialChineseName: "再鼎医药（上海）有限公司",
    pinyinName: "zaiding",
    inclusionReason: "知名 Biotech",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://cn.zailaboratory.com/",
    socialEntryUrl: "https://cn.zailaboratory.com/jobs/",
    officialChainEvidenceUrl: "https://cn.zailaboratory.com/careers/"
  },
  {
    id: "company-hutchmed",
    officialChineseName: "和记黄埔医药（上海）有限公司",
    pinyinName: "heji-huangpu",
    inclusionReason: "知名 Biotech"
  },
  {
    id: "company-dongyangguang",
    officialChineseName: "宜昌东阳光长江药业股份有限公司",
    pinyinName: "dongyangguang",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-nhwa",
    officialChineseName: "江苏恩华药业股份有限公司",
    pinyinName: "enhua",
    inclusionReason: "国内知名药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.nhwa-group.com/",
    socialEntryUrl: "https://www.nhwa-group.com/job/ren-cai-zhao-pin-list-0.htm",
    officialChainEvidenceUrl: "https://www.nhwa-group.com/job/ren-cai-zhao-pin-list-0.htm"
  },
  {
    id: "company-beta-pharma",
    officialChineseName: "贝达药业股份有限公司",
    pinyinName: "beida",
    inclusionReason: "知名创新药企业",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.bettapharma.com/",
    socialEntryUrl: "https://bettapharma.zhiye.com/Social",
    officialChainEvidenceUrl: "https://www.bettapharma.com/Jobs/"
  },
  {
    id: "company-grand-life-sciences",
    officialChineseName: "远大生命科学集团有限公司",
    pinyinName: "yuanda-shengming-kexue",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-puluo",
    officialChineseName: "普洛药业股份有限公司",
    pinyinName: "puluo",
    inclusionReason: "国内知名药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.apeloa.com/",
    socialEntryUrl: "https://www.apeloa.com/join.html",
    officialChainEvidenceUrl: "https://www.apeloa.com/join.html"
  },
  {
    id: "company-hualan-bio",
    officialChineseName: "华兰生物工程股份有限公司",
    pinyinName: "hualan-shengwu",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-kanghong",
    officialChineseName: "成都康弘药业集团股份有限公司",
    pinyinName: "kanghong",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-boehringer-ingelheim-china",
    officialChineseName: "勃林格殷格翰（中国）投资有限公司",
    pinyinName: "boehringer-ingelheim",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "SUCCESSFACTORS",
    officialWebsiteUrl: "https://www.boehringer-ingelheim.com/",
    socialEntryUrl: "https://jobs.boehringer-ingelheim.com/search/?q=&locationsearch=China",
    officialChainEvidenceUrl: "https://jobs.boehringer-ingelheim.com/"
  },
  {
    id: "company-merck-china",
    officialChineseName: "默克中国医药健康",
    pinyinName: "moke",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.merckgroup.com/",
    socialEntryUrl: "https://careers.emdgroup.com/us/en/search-results?keywords=China",
    officialChainEvidenceUrl: "https://careers.emdgroup.com/us/en/"
  },
  {
    id: "company-taibang-bio",
    officialChineseName: "山东泰邦生物制品有限公司",
    pinyinName: "taibang-shengwu",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-kuihua",
    officialChineseName: "葵花药业集团股份有限公司",
    pinyinName: "kuihua",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-ganlee",
    officialChineseName: "甘李药业股份有限公司",
    pinyinName: "ganli",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-haisco",
    officialChineseName: "海思科医药集团股份有限公司",
    pinyinName: "haisike",
    inclusionReason: "国内知名药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "HOTJOB_WECRUIT",
    officialWebsiteUrl: "https://www.haisco.com/",
    socialEntryUrl: "https://wecruit.hotjob.cn/SU6663b85a1eb8051cd22556e3/pb/social.html",
    officialChainEvidenceUrl: "https://www.haisco.com/recruitment.html"
  },
  {
    id: "company-sinocelltech",
    officialChineseName: "北京神州细胞生物技术集团股份公司",
    pinyinName: "shenzhou-xibao",
    inclusionReason: "知名 Biotech",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "HOTJOB_WECRUIT",
    officialWebsiteUrl: "https://www.sinocelltech.com/",
    socialEntryUrl: "https://www.hotjob.cn/wt/SCT/web/index",
    officialChainEvidenceUrl: "https://www.sinocelltech.com/Gather/job/pid/7.html"
  },
  {
    id: "company-luye",
    officialChineseName: "绿叶生命科学集团",
    pinyinName: "luye",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-kangyuan",
    officialChineseName: "江苏康缘药业股份有限公司",
    pinyinName: "kangyuan",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-yifan",
    officialChineseName: "亿帆医药股份有限公司",
    pinyinName: "yifan",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-lei-yun-shang",
    officialChineseName: "雷允上药业集团有限公司",
    pinyinName: "leiyunshang",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-ncpc",
    officialChineseName: "华北制药集团有限责任公司",
    pinyinName: "huabei-zhiyao",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-better-pharma",
    officialChineseName: "成都倍特药业股份有限公司",
    pinyinName: "beite",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-rcbio",
    officialChineseName: "荣昌生物制药（烟台）股份有限公司",
    pinyinName: "rongchang-shengwu",
    inclusionReason: "知名 Biotech",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "MOKA",
    officialWebsiteUrl: "https://www.remegen.com/",
    socialEntryUrl: "https://app.mokahr.com/social-recruitment/remegen/45549#/jobs",
    officialChainEvidenceUrl: "https://www.remegen.com/index.php?cid=45&v=listing"
  },
  {
    id: "company-kpc",
    officialChineseName: "昆药集团股份有限公司",
    pinyinName: "kunyao",
    inclusionReason: "国内知名药企",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.kpc.com.cn/",
    socialEntryUrl: "https://www.kpc.com.cn/job/she-hui-zhao-pin-list-0.htm",
    officialChainEvidenceUrl: "https://www.kpc.com.cn/job/index.htm"
  },
  {
    id: "company-xinhua-pharma",
    officialChineseName: "山东新华制药股份有限公司",
    pinyinName: "xinhua-zhiyao",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-kenvue-china",
    officialChineseName: "科赴中国",
    pinyinName: "kefu",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.kenvue.com/",
    socialEntryUrl: "https://kenvue.wd5.myworkdayjobs.com/kenvue",
    officialChainEvidenceUrl: "https://www.kenvue.com/careers"
  },
  {
    id: "company-amgen-china",
    officialChineseName: "安进中国",
    pinyinName: "anjin",
    inclusionReason: "外资药企中国区",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.amgen.cn/",
    socialEntryUrl: "https://amgen.wd1.myworkdayjobs.com/Careers",
    officialChainEvidenceUrl: "https://www.amgen.com/careers"
  },
  {
    id: "company-hongri",
    officialChineseName: "天津红日药业股份有限公司",
    pinyinName: "hongri",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-shijiazhuang-no4-pharma",
    officialChineseName: "石家庄四药有限公司",
    pinyinName: "shijiazhuang-siyao",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-xianju",
    officialChineseName: "浙江仙琚制药股份有限公司",
    pinyinName: "xianju",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-zhejiang-medicine",
    officialChineseName: "浙江医药股份有限公司",
    pinyinName: "zhejiang-yiyao",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-good-doctor",
    officialChineseName: "好医生药业集团有限公司",
    pinyinName: "haoyisheng",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-cr-jiangzhong",
    officialChineseName: "华润江中制药集团有限责任公司",
    pinyinName: "jiangzhong",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-qizheng",
    officialChineseName: "西藏奇正藏药股份有限公司",
    pinyinName: "qizheng",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-lingrui",
    officialChineseName: "河南羚锐制药股份有限公司",
    pinyinName: "lingrui",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-jiudian",
    officialChineseName: "湖南九典制药股份有限公司",
    pinyinName: "jiudian",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-jianmin",
    officialChineseName: "健民药业集团股份有限公司",
    pinyinName: "jianmin",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-hayao",
    officialChineseName: "哈药集团股份有限公司",
    pinyinName: "hayao",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-cisen",
    officialChineseName: "辰欣药业股份有限公司",
    pinyinName: "chenxin",
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-baili-tianheng",
    officialChineseName: "百利天恒",
    pinyinName: "baili-tianheng",
    inclusionReason: "知名 Biotech 候选"
  },
  {
    id: "company-kelun-biotech",
    officialChineseName: "科伦博泰生物",
    pinyinName: "kelun-botai",
    inclusionReason: "知名 Biotech 候选",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.kelun-biotech.com/",
    socialEntryUrl: "https://kelunbotai.zhiye.com/Social",
    officialChainEvidenceUrl: "https://www.kelun-biotech.com/RecruitTalented.aspx"
  },
  {
    id: "company-henlius",
    officialChineseName: "复宏汉霖",
    pinyinName: "fuhong-hanlin",
    inclusionReason: "知名 Biotech 候选"
  },
  {
    id: "company-ascentage",
    officialChineseName: "亚盛医药",
    pinyinName: "yasheng",
    inclusionReason: "知名 Biotech 候选",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://ascentage.com/",
    socialEntryUrl: "https://ascentage.com/careers/job-opportunities/",
    officialChainEvidenceUrl: "https://ascentage.com/careers/job-opportunities/"
  },
  {
    id: "company-harbour-bio",
    officialChineseName: "和铂医药",
    pinyinName: "hebo",
    inclusionReason: "知名 Biotech 候选"
  },
  {
    id: "company-innocare",
    officialChineseName: "诺诚健华",
    pinyinName: "nuocheng-jianhua",
    inclusionReason: "知名 Biotech 候选"
  },
  {
    id: "company-cstone",
    officialChineseName: "基石药业",
    pinyinName: "jishi",
    inclusionReason: "知名 Biotech 候选",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.cstonepharma.com/",
    socialEntryUrl: "https://www.cstonepharma.com/join/job.html",
    officialChainEvidenceUrl: "https://www.cstonepharma.com/join/job.html"
  },
  {
    id: "company-alphamab",
    officialChineseName: "康宁杰瑞",
    pinyinName: "kangning-jierui",
    inclusionReason: "知名 Biotech 候选",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.alphamabonc.com/",
    socialEntryUrl: "https://www.alphamabonc.com/career/job.html",
    officialChainEvidenceUrl: "https://www.alphamabonc.com/career/job.html"
  },
  {
    id: "company-everest-medicines",
    officialChineseName: "云顶新耀",
    pinyinName: "yunding-xinyao",
    inclusionReason: "知名 Biotech 候选"
  },
  {
    id: "company-mabwell",
    officialChineseName: "迈威生物",
    pinyinName: "maiwei",
    inclusionReason: "知名 Biotech 候选",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.mabwell.com/",
    socialEntryUrl: "https://www.mabwell.com/jobs.html",
    officialChainEvidenceUrl: "https://www.mabwell.com/careers.html"
  }
];

export const candidateCompanies: CandidateCompany[] = CANDIDATE_SEEDS.map(toCompany);

export function getSocialSources(
  companies: readonly CandidateCompany[]
): CandidateRecruitmentSource[] {
  return companies.flatMap((company) => company.sources).filter((source) => source.kind === "SOCIAL");
}

export function getCandidatePoolStats(companies: readonly CandidateCompany[]): CandidatePoolStats {
  const sources = companies.flatMap((company) => company.sources);
  const verifiedScrapableCompanies = companies.filter((company) =>
    company.sources.some(
      (source) => source.kind === "SOCIAL" && source.status === "VERIFIED_SCRAPABLE"
    )
  ).length;

  return {
    totalCandidates: companies.length,
    socialSources: sources.filter((source) => source.kind === "SOCIAL").length,
    campusSources: sources.filter((source) => source.kind === "CAMPUS").length,
    verifiedScrapableCompanies,
    canLaunchP0:
      companies.length >= P0_MIN_CANDIDATES &&
      companies.length <= P0_MAX_CANDIDATES &&
      verifiedScrapableCompanies >= P0_MIN_VERIFIED_SCRAPABLE
  };
}
