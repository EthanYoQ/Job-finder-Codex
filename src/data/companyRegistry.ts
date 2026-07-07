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
    status: "ENTRY_FOUND_PENDING_ADAPTER",
    atsKind: "MOKA",
    socialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
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
    socialEntryUrl: "https://www.beonemedicines.com.cn/careers/careers/",
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
    status: "VERIFIED_SCRAPABLE",
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
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-kelun",
    officialChineseName: "四川科伦药业股份有限公司",
    pinyinName: "kelun",
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-roche-china",
    officialChineseName: "上海罗氏制药有限公司",
    pinyinName: "luoshi",
    inclusionReason: "外资药企中国区"
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
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-hansoh",
    officialChineseName: "翰森制药集团有限公司",
    pinyinName: "hansen",
    inclusionReason: "国内头部药企"
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
    inclusionReason: "国内头部药企"
  },
  {
    id: "company-msd-china",
    officialChineseName: "默沙东（中国）投资有限公司",
    pinyinName: "moshadong",
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-bayer-healthcare",
    officialChineseName: "拜耳医药保健有限公司",
    pinyinName: "baier",
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-novo-nordisk-china",
    officialChineseName: "诺和诺德（中国）制药有限公司",
    pinyinName: "nuohe-nuode",
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-innovent",
    officialChineseName: "信达生物制药（苏州）有限公司",
    pinyinName: "xinda-shengwu",
    inclusionReason: "知名 Biotech、用户指定",
    status: "ENTRY_FOUND_PENDING_ADAPTER",
    officialWebsiteUrl: "https://www.innoventbio.com/",
    socialEntryUrl: "https://www.innoventbio.com/",
    officialChainEvidenceUrl: "https://www.innoventbio.com/"
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
    inclusionReason: "国内头部药企"
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
    inclusionReason: "知名 Biotech"
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
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-huahai",
    officialChineseName: "浙江华海药业股份有限公司",
    pinyinName: "huahai",
    inclusionReason: "国内知名药企"
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
    inclusionReason: "国内知名药企"
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
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-haleon-china",
    officialChineseName: "赫力昂（中国）有限公司",
    pinyinName: "haleon",
    inclusionReason: "外资药企中国区"
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
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-allist",
    officialChineseName: "上海艾力斯医药科技股份有限公司",
    pinyinName: "ailisi",
    inclusionReason: "知名 Biotech"
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
    inclusionReason: "知名 Biotech"
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
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-beta-pharma",
    officialChineseName: "贝达药业股份有限公司",
    pinyinName: "beida",
    inclusionReason: "知名创新药企业"
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
    inclusionReason: "国内知名药企"
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
    inclusionReason: "外资药企中国区"
  },
  {
    id: "company-merck-china",
    officialChineseName: "默克中国医药健康",
    pinyinName: "moke",
    inclusionReason: "外资药企中国区"
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
    inclusionReason: "国内知名药企"
  },
  {
    id: "company-sinocelltech",
    officialChineseName: "北京神州细胞生物技术集团股份公司",
    pinyinName: "shenzhou-xibao",
    inclusionReason: "知名 Biotech"
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
    inclusionReason: "知名 Biotech"
  },
  {
    id: "company-kpc",
    officialChineseName: "昆药集团股份有限公司",
    pinyinName: "kunyao",
    inclusionReason: "国内知名药企"
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
    inclusionReason: "外资药企中国区"
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
    inclusionReason: "知名 Biotech 候选"
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
    inclusionReason: "知名 Biotech 候选"
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
    inclusionReason: "知名 Biotech 候选"
  },
  {
    id: "company-alphamab",
    officialChineseName: "康宁杰瑞",
    pinyinName: "kangning-jierui",
    inclusionReason: "知名 Biotech 候选"
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
    inclusionReason: "知名 Biotech 候选"
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
