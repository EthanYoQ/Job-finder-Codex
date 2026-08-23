import { createHash } from "node:crypto";
import type {
  ATSKind,
  RecruitmentPageCapability,
  RecruitmentPageCapabilityVerification,
  SourceKind,
  VerificationStatus
} from "../domain/company";
import { isVerifiedNonJobRecruitmentPage } from "../domain/company";
import {
  derivePhase1Scope,
  isUserAuthorizedPhase1Exclusion,
  USER_AUTHORIZED_PHASE1_EXCLUSION
} from "./phase1ScopePolicy";

export type CompanyCategory = "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
export type TargetStatus =
  | "ACTIVE"
  | "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME"
  | "BLOCKED_EVIDENCE_GAP"
  | typeof USER_AUTHORIZED_PHASE1_EXCLUSION;
export type OfficialSurfaceStatus =
  | "INCLUDED"
  | "VERIFIED_NON_JOB_RECRUITMENT_INFORMATION"
  | "BLOCKED_NO_STRUCTURED_PUBLIC_SOURCE"
  | "BLOCKED_UNVERIFIED";
export type IndependentOracleStatus = "RESEARCH_PENDING_INDEPENDENT_VERIFICATION" | "INDEPENDENTLY_VERIFIED";
export type RecruitmentScope =
  | { status: "RESOLVED"; value: string; evidenceArtifactSha256: string }
  | { status: "UNRESOLVED"; reason: string };

export type ChinaRecruitmentScope =
  | { status: "RESOLVED"; geography: "MAINLAND_CHINA"; evidenceArtifactSha256: string }
  | { status: "UNRESOLVED"; reason: string };

export interface ExpectedRecruitmentChannel {
  channelId: string;
  kind: "SOCIAL" | "CAMPUS" | "INTERNAL" | "UNKNOWN";
  status: "EXPECTED" | "UNRESOLVED";
}

export interface CandidateRecruitmentSource {
  id: string;
  surfaceId?: string;
  companyId: string;
  kind: SourceKind;
  atsKind: ATSKind;
  status: VerificationStatus;
  officialEntryUrl?: string;
  officialChainEvidenceUrl?: string;
  campusEntryUrl?: string;
  recruitmentPageCapability?: RecruitmentPageCapability;
  capabilityVerification?: RecruitmentPageCapabilityVerification;
}

export interface CandidateCompany {
  id: string;
  officialChineseName: string;
  officialWebsiteUrl?: string;
  pinyinName: string;
  category: CompanyCategory;
  targetStatus: TargetStatus;
  sources: CandidateRecruitmentSource[];
}

export interface CandidatePoolStats {
  totalCandidates: number;
  phase1InScopeCompanies: number;
  authorizedExclusionCompanies: number;
  socialSources: number;
  campusSources: number;
  verifiedScrapableCompanies: number;
  canLaunchP0: boolean;
}

export interface CandidateSocialSourceSeed {
  status?: VerificationStatus;
  atsKind?: ATSKind;
  socialEntryUrl?: string;
  officialChainEvidenceUrl?: string;
  campusEntryUrl?: string;
  recruitmentPageCapability?: RecruitmentPageCapability;
  capabilityVerification?: RecruitmentPageCapabilityVerification;
}

export interface CandidateSeed {
  id: string;
  officialChineseName: string;
  pinyinName: string;
  category: CompanyCategory;
  targetStatus?: TargetStatus;
  status?: VerificationStatus;
  atsKind?: ATSKind;
  officialWebsiteUrl?: string;
  socialEntryUrl?: string;
  officialChainEvidenceUrl?: string;
  campusEntryUrl?: string;
  socialSources?: readonly CandidateSocialSourceSeed[];
}

export interface ExpectedOfficialRecruitmentSurface {
  surfaceId: string;
  companyId: string;
  kind: SourceKind;
  legalEntityScope: RecruitmentScope[];
  businessUnitScope: RecruitmentScope[];
  brandScope: RecruitmentScope[];
  channels: ExpectedRecruitmentChannel[];
  chinaScope: ChinaRecruitmentScope;
  officialEntryUrl?: string;
  officialChainEvidenceUrls: string[];
  atsKind: ATSKind;
  adapterId?: "official-json" | "html-table";
  status: OfficialSurfaceStatus;
  includeReason: string;
  oracleStatus: IndependentOracleStatus;
  recruitmentPageCapability?: RecruitmentPageCapability;
  capabilityVerification?: RecruitmentPageCapabilityVerification;
}

export interface ExcludedCompany {
  companyId: string;
  officialChineseName: string;
  exclusionCategory: "DEVICE" | "DIAGNOSTICS" | "LIFE_SCIENCE_TOOLS" | "MEDTECH" | "CONSUMER_HEALTH" | "UNPROVEN_CHINA" | "OUTSIDE_CONFIRMED_ROSTER";
  reason: string;
}

const P0_REQUIRED_CANDIDATES = 60;

function sourceIdFor(companyId: string, kind: "social" | "campus", index = 0): string {
  return `source-${companyId.replace(/^company-/, "")}-${kind}${index === 0 ? "" : `-${index + 1}`}`;
}

function surfaceIdFor(companyId: string, kind: "social" | "campus", index = 0): string {
  return `surface-${companyId.replace(/^company-/, "")}-${kind}${index === 0 ? "" : `-${index + 1}`}`;
}

function socialSourceSeedsFor(seed: CandidateSeed): CandidateSocialSourceSeed[] {
  if (seed.targetStatus === USER_AUTHORIZED_PHASE1_EXCLUSION) {
    const hasSourceFields = seed.socialSources !== undefined || [
      seed.status,
      seed.atsKind,
      seed.socialEntryUrl,
      seed.officialChainEvidenceUrl,
      seed.campusEntryUrl
    ].some((value) => value !== undefined);
    if (hasSourceFields) throw new Error(`AUTHORIZED_PHASE1_EXCLUSION_HAS_SOURCE_FIELDS:${seed.id}`);
    return [];
  }
  if (seed.socialSources !== undefined) {
    const hasLegacySourceFields = [
      seed.status,
      seed.atsKind,
      seed.socialEntryUrl,
      seed.officialChainEvidenceUrl,
      seed.campusEntryUrl
    ].some((value) => value !== undefined);
    if (hasLegacySourceFields) {
      throw new Error(`CONFLICTING_SOCIAL_SOURCE_FIELDS:${seed.id}`);
    }
    return [...seed.socialSources];
  }
  if (
    seed.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" &&
    !seed.socialEntryUrl &&
    !seed.officialChainEvidenceUrl &&
    !seed.campusEntryUrl
  ) return [];
  return [{
    ...(seed.status ? { status: seed.status } : {}),
    ...(seed.atsKind ? { atsKind: seed.atsKind } : {}),
    ...(seed.socialEntryUrl ? { socialEntryUrl: seed.socialEntryUrl } : {}),
    ...(seed.officialChainEvidenceUrl
      ? { officialChainEvidenceUrl: seed.officialChainEvidenceUrl }
      : {}),
    ...(seed.campusEntryUrl ? { campusEntryUrl: seed.campusEntryUrl } : {})
  }];
}

function toRecruitmentSource(
  seed: CandidateSeed,
  sourceSeed: CandidateSocialSourceSeed,
  index: number
): CandidateRecruitmentSource {
  return {
    id: sourceIdFor(seed.id, "social", index),
    surfaceId: surfaceIdFor(seed.id, "social", index),
    companyId: seed.id,
    kind: "SOCIAL",
    atsKind: sourceSeed.atsKind ?? "UNKNOWN",
    status: sourceSeed.status ?? "UNVERIFIED",
    ...(sourceSeed.socialEntryUrl && sourceSeed.officialChainEvidenceUrl
      ? { officialEntryUrl: sourceSeed.socialEntryUrl }
      : {}),
    ...(sourceSeed.officialChainEvidenceUrl
      ? { officialChainEvidenceUrl: sourceSeed.officialChainEvidenceUrl }
      : {}),
    ...(sourceSeed.campusEntryUrl ? { campusEntryUrl: sourceSeed.campusEntryUrl } : {}),
    ...(sourceSeed.recruitmentPageCapability
      ? { recruitmentPageCapability: sourceSeed.recruitmentPageCapability }
      : {}),
    ...(sourceSeed.capabilityVerification
      ? { capabilityVerification: sourceSeed.capabilityVerification }
      : {})
  };
}

function toCompany(seed: CandidateSeed): CandidateCompany {
  const sources = socialSourceSeedsFor(seed).map((sourceSeed, index) =>
    toRecruitmentSource(seed, sourceSeed, index)
  );
  return {
    id: seed.id,
    officialChineseName: seed.officialChineseName,
    pinyinName: seed.pinyinName,
    category: seed.category,
    targetStatus: seed.targetStatus ?? "ACTIVE",
    sources,
    ...(seed.officialWebsiteUrl ? { officialWebsiteUrl: seed.officialWebsiteUrl } : {})
  };
}

// Confirmed target roster. A blocked target remains in place and is never substituted.
// Adjacent-healthcare and outside-roster companies are recorded separately below.
const CANDIDATE_SEEDS: CandidateSeed[] = [
  {
    id: "company-johnson-innovative-medicine",
    officialChineseName: "强生创新制药",
    pinyinName: "qiangsheng-chuangxin-zhiyao",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.jnjpharmaceutical.com.cn/",
    socialEntryUrl: "https://jj.wd5.myworkdayjobs.com/JJ",
    officialChainEvidenceUrl: "https://www.jnjpharmaceutical.com.cn/en/about-jjp/company-overview"
  },
  {
    id: "company-abbvie-china",
    officialChineseName: "艾伯维中国",
    pinyinName: "aibowei",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.abbvie.com.cn/",
    socialEntryUrl: "https://careers.abbvie.com/zh-hans/jobs",
    officialChainEvidenceUrl: "https://careers.abbvie.com/zh-hans/"
  },
  {
    id: "company-msd-china",
    officialChineseName: "默沙东中国",
    pinyinName: "moshadong",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.msdchina.com.cn/",
    socialEntryUrl: "https://jobs.msd.com/cn/zh/search-results",
    officialChainEvidenceUrl: "https://jobs.msd.com/cn/zh/search-results"
  },
  {
    id: "company-roche-china",
    officialChineseName: "罗氏制药中国",
    pinyinName: "luoshi",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.roche.com.cn/",
    socialEntryUrl: "https://careers.roche.com/cn/zh/search-results",
    officialChainEvidenceUrl: "https://careers.roche.com/cn/zh/mainland-china-jobs"
  },
  {
    id: "company-pfizer-china",
    officialChineseName: "辉瑞中国",
    pinyinName: "huirui",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.pfizer.com.cn/",
    socialEntryUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
    officialChainEvidenceUrl: "https://www.pfizer.com/about/careers/search-results"
  },
  {
    id: "company-astrazeneca",
    officialChineseName: "阿斯利康中国",
    pinyinName: "asili-kang",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.astrazeneca.com.cn/",
    socialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
    officialChainEvidenceUrl: "https://careers.astrazeneca.com/china"
  },
  {
    id: "company-novartis",
    officialChineseName: "诺华中国",
    pinyinName: "nuohua",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.novartis.com.cn/",
    socialEntryUrl: "https://prod1.novartis.com/careers/career-search/tag/LOC_CN",
    officialChainEvidenceUrl: "https://www.novartis.com.cn/careers"
  },
  {
    id: "company-bms-china",
    officialChineseName: "百时美施贵宝中国",
    pinyinName: "baishi-meishiguibao",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.bms.com/cn",
    socialEntryUrl: "https://bristolmyerssquibb.wd5.myworkdayjobs.com/BMS",
    officialChainEvidenceUrl: "https://careers.bms.com/cn/"
  },
  {
    id: "company-sanofi-china",
    officialChineseName: "赛诺菲中国",
    pinyinName: "sainuofei",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.sanofi.cn/",
    socialEntryUrl: "https://jobs.sanofi.com/en/location/china-country-jobs/2649/1814991/2",
    officialChainEvidenceUrl: "https://jobs.sanofi.cn/"
  },
  {
    id: "company-novo-nordisk-china",
    officialChineseName: "诺和诺德中国",
    pinyinName: "nuohe-nuode",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.novonordisk.com.cn/",
    socialEntryUrl: "https://www.novonordisk.com/careers/find-a-job/career-search-results.html",
    officialChainEvidenceUrl: "https://www.novonordisk.com.cn/careers.html"
  },
  {
    id: "company-lilly-china",
    officialChineseName: "礼来中国",
    pinyinName: "lilai",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.lilly.com.cn/",
    socialEntryUrl: "https://careers.lilly.com/us/en/search-results?keywords=China",
    officialChainEvidenceUrl: "https://careers.lilly.com/global/zh/china"
  },
  {
    id: "company-gsk-china",
    officialChineseName: "葛兰素史克中国",
    pinyinName: "gelansu-shike",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.gsk-china.com/zh-cn/",
    socialEntryUrl: "https://jobs.gsk.com/cn/zh/search-results?keywords=China",
    officialChainEvidenceUrl: "https://www.gsk-china.com/zh-cn/careers/"
  },
  {
    id: "company-amgen-china",
    officialChineseName: "安进中国",
    pinyinName: "anjin",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.amgen.cn/",
    socialEntryUrl: "https://amgen.wd1.myworkdayjobs.com/Careers",
    officialChainEvidenceUrl: "https://careers.amgen.com/en/location/china-jobs/87/1814991/2"
  },
  {
    id: "company-takeda-china",
    officialChineseName: "武田中国",
    pinyinName: "wutian",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.takeda.com.cn/zh-cn/",
    socialEntryUrl: "https://jobs.takeda.com/location/china-jobs/1113/1814991/2",
    officialChainEvidenceUrl: "https://www.takeda.com.cn/zh-cn/"
  },
  {
    id: "company-gilead-china",
    officialChineseName: "吉利德科学",
    pinyinName: "jilide-kexue",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.gilead.com/zh-hk/",
    socialEntryUrl: "https://gilead.yello.co/job_boards/v42vD4vKxb3AkKvV93YsrQ",
    officialChainEvidenceUrl: "https://www.gilead.com/careers/opportunities"
  },
  {
    id: "company-boehringer-ingelheim-china",
    officialChineseName: "勃林格殷格翰中国",
    pinyinName: "boehringer-ingelheim",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "SUCCESSFACTORS",
    officialWebsiteUrl: "https://www.boehringer-ingelheim.cn/",
    socialEntryUrl: "https://jobs.boehringer-ingelheim.com/search/?q=&locationsearch=China",
    officialChainEvidenceUrl: "https://www.boehringer-ingelheim.cn/careers/jobs"
  },
  {
    id: "company-bayer-healthcare",
    officialChineseName: "拜耳医药保健中国",
    pinyinName: "baier",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "SUCCESSFACTORS",
    officialWebsiteUrl: "https://www.bayer.com.cn/",
    socialEntryUrl: "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN",
    officialChainEvidenceUrl: "https://www.bayer.com.cn/zh-hans/zhaoxiannashi"
  },
  {
    id: "company-csl-china",
    officialChineseName: "杰特贝林",
    pinyinName: "csl",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.csl.com/",
    socialEntryUrl: "https://jobs.csl.com/en/jobs?filterrific%5Bwith_location3%5D=china",
    officialChainEvidenceUrl: "https://www.csl.com/careers"
  },
  {
    id: "company-viatris",
    officialChineseName: "晖致中国",
    pinyinName: "huizhi",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.viatris.cn/",
    socialEntryUrl:
      "https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT",
    officialChainEvidenceUrl: "https://viatris.cn/careers"
  },
  {
    id: "company-teva-china",
    officialChineseName: "梯瓦中国",
    pinyinName: "tiwa",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.teva.cn/",
    socialEntryUrl: "https://www.careers.teva/careers?location=China",
    officialChainEvidenceUrl: "https://www.careers.teva/careers?location=China"
  },
  {
    id: "company-astellas-china",
    officialChineseName: "安斯泰来中国",
    pinyinName: "ansitailai",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.astellas.com/cn/",
    socialEntryUrl: "https://www.astellas.com/en/careers/china-recruitment",
    officialChainEvidenceUrl: "https://www.astellas.com/en/careers/china-recruitment"
  },
  {
    id: "company-daiichi-sankyo-china",
    officialChineseName: "第一三共中国",
    pinyinName: "diyi-sangong",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.daiichisankyo.com.cn/",
    socialEntryUrl: "https://daiichisankyo.cnstaff.com/recruit",
    officialChainEvidenceUrl: "https://www.daiichisankyo.com.cn/"
  },
  {
    id: "company-sandoz-china",
    officialChineseName: "山德士中国",
    pinyinName: "shandeshi-zhongguo",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.sandoz.com/",
    socialEntryUrl: "https://www.sandoz.com/careers/job-search/",
    officialChainEvidenceUrl: "https://www.sandoz.com/careers/job-search/"
  },
  {
    id: "company-merck-china",
    officialChineseName: "默克医药健康",
    pinyinName: "moke",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.merckgroup.com/cn-zh",
    socialEntryUrl: "https://careers.emdgroup.com/us/en/search-results?keywords=China",
    officialChainEvidenceUrl: "https://careers.merckgroup.com/cn/zh/search-results"
  },
  {
    id: "company-otsuka-china",
    officialChineseName: "大冢中国",
    pinyinName: "dazhong-zhongguo",
    category: "FOREIGN_PHARMA",
    officialWebsiteUrl: "https://www.otsuka.com.cn/",
    socialSources: [
      {
        status: "ENTRY_FOUND_PENDING_ADAPTER",
        atsKind: "OFFICIAL_HTML",
        socialEntryUrl: "https://chinaotsuka.com.cn/class/26",
        officialChainEvidenceUrl: "https://www.otsuka.com.cn/otsuka-in-china/index.html",
        recruitmentPageCapability: "RECRUITMENT_INFORMATION_OR_CONTACT",
        capabilityVerification: {
          checkedAt: "2026-07-16",
          reason: "The official page contains recruitment contact information but no job rows, job links, or ATS link."
        }
      },
      {
        status: "VERIFIED_SCRAPABLE",
        atsKind: "OFFICIAL_HTML",
        socialEntryUrl: "https://www.otsuka.com.cn/join-us/index.html",
        officialChainEvidenceUrl: "https://www.otsuka.com.cn/join-us/index.html",
        recruitmentPageCapability: "JOB_LISTING"
      }
    ]
  },
  {
    id: "company-biogen-china",
    officialChineseName: "渤健中国",
    pinyinName: "bojian",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "WORKDAY",
    officialWebsiteUrl: "https://www.biogen.cn/",
    socialEntryUrl: "https://biibhr.wd3.myworkdayjobs.com/external",
    officialChainEvidenceUrl: "https://www.biogen.cn/careers.html"
  },
  {
    id: "company-grifols-china",
    officialChineseName: "基立福中国",
    pinyinName: "jilifu",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.zh.grifolscn.com.cn/zh/china",
    socialEntryUrl: "https://grifols.jobs/locations/chn/jobs/",
    officialChainEvidenceUrl: "https://www.zh.grifolscn.com.cn/zh/careers"
  },
  {
    id: "company-organon-china",
    officialChineseName: "欧加隆中国",
    pinyinName: "oujialong",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.organonchina.com.cn/",
    socialEntryUrl: "https://jobs.organon.com/cn/zh/search-results?keywords=China",
    officialChainEvidenceUrl: "https://jobs.organon.com/cn/zh/home"
  },
  {
    id: "company-ucb-china",
    officialChineseName: "优时比中国",
    pinyinName: "youshibi",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.ucb.com/",
    socialEntryUrl: "https://careers.ucb.com/global/en/search-results?qcountry=China",
    officialChainEvidenceUrl: "https://careers.ucb.com/"
  },
  {
    id: "company-servier-china",
    officialChineseName: "施维雅中国",
    pinyinName: "shiweiya",
    category: "FOREIGN_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "MOKA",
    officialWebsiteUrl: "https://www.servier.com.cn/",
    socialEntryUrl: "https://app.mokahr.com/social-recruitment/shiweiya/47734",
    officialChainEvidenceUrl: "https://www.servier.com.cn/social-recruitment/shiweiya/47734",
    campusEntryUrl: "https://www.servier.com.cn/campus-recruitment/shiweiya/70032"
  },
  {
    id: "company-sinopharm",
    officialChineseName: "中国医药集团有限公司",
    pinyinName: "zhongguo-yiyao-jituan",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.sinopharm.com/",
    socialEntryUrl: "https://sinopharm-global.iguopin.com/job",
    officialChainEvidenceUrl: "https://www.sinopharm.com/recruitment.html"
  },
  {
    id: "company-cr-pharma",
    officialChineseName: "华润医药控股有限公司",
    pinyinName: "huarun-yiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "HOTJOB_WECRUIT",
    officialWebsiteUrl: "https://www.crpharm.com/",
    socialEntryUrl: "https://crc.wintalent.cn/wt/crpharma/web/index/social",
    officialChainEvidenceUrl: "https://www.crpharm.com/"
  },
  {
    id: "company-qilu",
    officialChineseName: "齐鲁制药集团有限公司",
    pinyinName: "qilu",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.qilu-pharma.com/",
    socialEntryUrl: "https://qilu-pharma.zhiye.com/social/jobs",
    officialChainEvidenceUrl: "https://www.qilu-pharma.com/JobPosting_list.html"
  },
  {
    id: "company-grand-pharma",
    officialChineseName: "远大医药集团有限公司",
    pinyinName: "yuanda-yiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.grandpharma.cn/",
    socialEntryUrl: "https://job.grandpharma.cn/",
    officialChainEvidenceUrl: "https://job.grandpharma.cn/",
    campusEntryUrl: "https://job.grandpharma.cn/schooldetail.html"
  },
  {
    id: "company-fosun-pharma",
    officialChineseName: "上海复星医药（集团）股份有限公司",
    pinyinName: "fosun-yiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.fosunpharma.com/",
    socialEntryUrl: "https://fosunpharma.zhiye.com/social",
    officialChainEvidenceUrl: "https://www.fosunpharma.com/careers/"
  },
  {
    id: "company-cspc",
    officialChineseName: "石药控股集团有限公司",
    pinyinName: "shiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.cspc.cn/",
    socialEntryUrl:
      "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/0beb3022-3214-4333-a2e7-20786c4916d5/officeWebsite.mob",
    officialChainEvidenceUrl: "https://www.cspc.cn/hr/index.html",
    campusEntryUrl:
      "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/623d3b53-0d75-4649-8d4c-df366532fb58/officeWebsite.mob"
  },
  {
    id: "company-hengrui",
    officialChineseName: "江苏恒瑞医药股份有限公司",
    pinyinName: "hengrui",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "MOKA",
    officialWebsiteUrl: "https://www.hengrui.com/",
    socialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
    officialChainEvidenceUrl: "https://www.hengrui.com/development/joinUs.html",
    campusEntryUrl: "https://app.mokahr.com/m/campus-recruitment/hengrui/145997"
  },
  {
    id: "company-cttq",
    officialChineseName: "正大天晴药业集团股份有限公司",
    pinyinName: "zhengda-tianqing",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.cttq.com/",
    socialEntryUrl: "https://cttq.zhiye.com/social/jobs",
    officialChainEvidenceUrl: "https://www.cttq.com/personnel/xiao-yuan-zhao-pin-list-0.htm"
  },
  {
    id: "company-shanghai-pharma",
    officialChineseName: "上海医药集团股份有限公司",
    pinyinName: "shanghai-yiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.sphchina.com/",
    socialEntryUrl: "https://sph.zhiye.com/social/jobs",
    officialChainEvidenceUrl: "https://www.sphchina.com/html/footer.html"
  },
  {
    id: "company-kelun",
    officialChineseName: "四川科伦药业股份有限公司",
    pinyinName: "kelun",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.kelun.com/",
    socialEntryUrl: "https://kelun.zhiye.com/social",
    officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html",
    campusEntryUrl: "https://www.kelun.com/intro/5.html"
  },
  {
    id: "company-xiuzheng",
    officialChineseName: "修正药业集团股份有限公司",
    pinyinName: "xiuzheng",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.xiuzheng.com/",
    socialEntryUrl: "https://www.xiuzheng.com/#/recruit",
    officialChainEvidenceUrl: "https://www.xiuzheng.com/"
  },
  {
    id: "company-gphl",
    officialChineseName: "广州医药集团有限公司",
    pinyinName: "guangzhou-yiyao-jituan",
    category: "DOMESTIC_PHARMA",
    status: "ENTRY_FOUND_PENDING_ADAPTER",
    atsKind: "HOTJOB_WECRUIT",
    officialWebsiteUrl: "https://www.gpc.com.cn/",
    socialEntryUrl: "https://gzmpc.hotjob.cn/wt/GZMPC/web/index/campus",
    officialChainEvidenceUrl: "https://www.gpc.com.cn/"
  },
  {
    id: "company-yangzijiang",
    officialChineseName: "扬子江药业集团有限公司",
    pinyinName: "yangzijiang",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.yangzijiang.com/",
    socialEntryUrl: "https://yangzijiang.zhiye.com/social/jobs",
    officialChainEvidenceUrl: "https://www.yangzijiang.com/Career"
  },
  {
    id: "company-humanwell",
    officialChineseName: "人福医药集团股份公司",
    pinyinName: "renfu-yiyao",
    category: "DOMESTIC_PHARMA",
    targetStatus: USER_AUTHORIZED_PHASE1_EXCLUSION,
    officialWebsiteUrl: "http://www.humanwell.com.cn/"
  },
  {
    id: "company-nhu",
    officialChineseName: "新和成控股集团有限公司",
    pinyinName: "xinhecheng",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.cnhu.com/",
    socialEntryUrl: "https://xinhecheng1.zhiye.com/social/jobs",
    officialChainEvidenceUrl: "https://www.cnhu.com/careers/zh-cn"
  },
  {
    id: "company-jimin-kexin",
    officialChineseName: "江西济民可信集团有限公司",
    pinyinName: "jimin-kexin",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "MOKA",
    officialWebsiteUrl: "https://www.jemincare.com/",
    socialEntryUrl: "https://app.mokahr.com/social-recruitment/jemincare/78315#/jobs",
    officialChainEvidenceUrl: "https://www.jemincare.com/"
  },
  {
    id: "company-united-lab",
    officialChineseName: "珠海联邦制药股份有限公司",
    pinyinName: "lianbang-zhiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://tul.com.hk/cn/",
    socialEntryUrl: "https://tulchina.zhiye.com/social/jobs",
    officialChainEvidenceUrl: "https://tul.com.hk/cn/rencaizhongxin/lianbangzhiyaozhongguoyouxiangongsi.html"
  },
  {
    id: "company-changchun-high-tech",
    officialChineseName: "长春高新技术产业（集团）股份有限公司",
    pinyinName: "changchun-gaoxin",
    category: "DOMESTIC_PHARMA",
    status: "ENTRY_FOUND_PENDING_ADAPTER",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://ccht.jl.cn/",
    socialEntryUrl: "https://ccht.jl.cn/jobList/57/1.html",
    officialChainEvidenceUrl: "https://ccht.jl.cn/jobList/57/1.html"
  },
  {
    id: "company-tongrentang",
    officialChineseName: "中国北京同仁堂（集团）有限责任公司",
    pinyinName: "tongrentang",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.tongrentang.com/",
    socialEntryUrl: "https://www.tongrentang.com/newsList/54/1.html",
    officialChainEvidenceUrl: "https://www.tongrentang.com/newsList/54/1.html"
  },
  {
    id: "company-livzon",
    officialChineseName: "丽珠医药集团股份有限公司",
    pinyinName: "lizhu-yiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.livzon.com.cn/",
    socialEntryUrl: "https://www.livzon.com.cn/Social.html",
    officialChainEvidenceUrl: "https://www.livzon.com.cn/Social.html"
  },
  {
    id: "company-buchang",
    officialChineseName: "山东步长制药股份有限公司",
    pinyinName: "buchang-zhiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.buchang.com/",
    socialEntryUrl: "https://www.buchang.com/FormMy/Joinus/ZhaoXianNaShi",
    officialChainEvidenceUrl: "https://www.buchang.com/FormMy/Joinus/ZhaoXianNaShi"
  },
  {
    id: "company-hansoh",
    officialChineseName: "江苏豪森药业集团有限公司",
    pinyinName: "hansen",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.hansoh.cn/",
    socialEntryUrl: "https://hspharm.zhiye.com/social",
    officialChainEvidenceUrl: "https://www.hansoh.cn/job/career-development.htm"
  },
  {
    id: "company-lunan",
    officialChineseName: "鲁南制药集团股份有限公司",
    pinyinName: "lunan",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.lunan.com.cn/",
    socialEntryUrl: "https://hcm.lunan.com.cn/recruit",
    officialChainEvidenceUrl: "https://hcm.lunan.com.cn/recruit"
  },
  {
    id: "company-huahai",
    officialChineseName: "浙江华海药业股份有限公司",
    pinyinName: "huahai-yaoye",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.huahaipharm.com/",
    socialEntryUrl: "https://www.huahaipharm.com/zpgw.html",
    officialChainEvidenceUrl: "https://www.huahaipharm.com/zpgw.html"
  },
  {
    id: "company-north-china-pharma",
    officialChineseName: "华北制药集团有限责任公司",
    pinyinName: "huabei-zhiyao",
    category: "DOMESTIC_PHARMA",
    targetStatus: USER_AUTHORIZED_PHASE1_EXCLUSION,
    officialWebsiteUrl: "https://www.ncpc.com/"
  },
  {
    id: "company-3sbio",
    officialChineseName: "沈阳三生制药有限责任公司",
    pinyinName: "sansheng",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.3sbio.com/",
    socialEntryUrl: "https://3sbio.zhiye.com/social/jobs",
    officialChainEvidenceUrl: "https://www.3sbio.com/career/occupation.aspx"
  },
  {
    id: "company-apeloa",
    officialChineseName: "普洛药业股份有限公司",
    pinyinName: "puluo-yaoye",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_HTML",
    officialWebsiteUrl: "https://www.apeloa.com/",
    socialEntryUrl: "https://www.apeloa.com/join.html",
    officialChainEvidenceUrl: "https://www.apeloa.com/join.html",
    campusEntryUrl: "https://www.apeloa.com/join.html"
  },
  {
    id: "company-xinhua-pharma",
    officialChineseName: "山东新华制药股份有限公司",
    pinyinName: "xinhua-zhiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "OFFICIAL_JSON",
    officialWebsiteUrl: "https://www.xhzy.com/",
    socialEntryUrl: "https://www.xhzy.com/SHZP/index.html",
    officialChainEvidenceUrl: "https://www.xhzy.com/SHZP/index.html"
  },
  {
    id: "company-tianjin-pharma",
    officialChineseName: "天津市医药集团有限公司",
    pinyinName: "tianjin-yiyao",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.pharm.com.cn/",
    socialEntryUrl: "https://tjph.zhiye.com/social/jobs",
    officialChainEvidenceUrl: "https://www.pharm.com.cn/"
  },
  {
    id: "company-dongyangguang",
    officialChineseName: "东阳光药",
    pinyinName: "dongyangguang",
    category: "DOMESTIC_PHARMA",
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialWebsiteUrl: "https://www.hecpharm.com/",
    socialEntryUrl: "https://hec.zhiye.com/Social/jobs",
    officialChainEvidenceUrl: "https://www.hec.cn/"
  }
];

export const CONFIRMED_ROSTER_V3_PROVENANCE = {
  artifact: "docs/research/company-list-60-official-entry-status.md",
  userConfirmation: "名单已确认",
  sourceThreadId: "019f4295-1a92-7202-8e38-1bdd8cec8351",
  confirmedAt: "2026-07-09"
} as const;

export const CONFIRMED_V3_TO_RUNTIME_COMPANY_ID: Readonly<Record<string, string>> = {
  "foreign-johnson-johnson-innovative-medicine-cn": "company-johnson-innovative-medicine",
  "foreign-abbvie-cn": "company-abbvie-china", "foreign-msd-cn": "company-msd-china",
  "foreign-roche-pharma-cn": "company-roche-china", "foreign-pfizer-cn": "company-pfizer-china",
  "foreign-astrazeneca-cn": "company-astrazeneca", "foreign-novartis-cn": "company-novartis",
  "foreign-bms-cn": "company-bms-china", "foreign-sanofi-cn": "company-sanofi-china",
  "foreign-novo-nordisk-cn": "company-novo-nordisk-china", "foreign-lilly-cn": "company-lilly-china",
  "foreign-gsk-cn": "company-gsk-china", "foreign-amgen-cn": "company-amgen-china",
  "foreign-takeda-cn": "company-takeda-china", "foreign-gilead-cn": "company-gilead-china",
  "foreign-boehringer-ingelheim-cn": "company-boehringer-ingelheim-china",
  "foreign-bayer-pharma-cn": "company-bayer-healthcare", "foreign-csl-cn": "company-csl-china",
  "foreign-viatris-cn": "company-viatris", "foreign-teva-cn": "company-teva-china",
  "foreign-astellas-cn": "company-astellas-china", "foreign-daiichi-sankyo-cn": "company-daiichi-sankyo-china",
  "foreign-sandoz-cn": "company-sandoz-china", "foreign-merck-kgaa-healthcare-cn": "company-merck-china",
  "foreign-otsuka-cn": "company-otsuka-china", "foreign-biogen-cn": "company-biogen-china",
  "foreign-grifols-cn": "company-grifols-china", "foreign-organon-cn": "company-organon-china",
  "foreign-ucb-cn": "company-ucb-china", "foreign-servier-cn": "company-servier-china",
  "domestic-sinopharm": "company-sinopharm", "domestic-cr-pharma": "company-cr-pharma",
  "domestic-qilu-pharma": "company-qilu", "domestic-grand-pharma": "company-grand-pharma",
  "domestic-fosun-pharma": "company-fosun-pharma", "domestic-cspc": "company-cspc",
  "domestic-hengrui": "company-hengrui", "domestic-cttq": "company-cttq",
  "domestic-shanghai-pharma": "company-shanghai-pharma", "domestic-kelun": "company-kelun",
  "domestic-xiuzheng": "company-xiuzheng", "domestic-gphl": "company-gphl",
  "domestic-yangzijiang": "company-yangzijiang", "domestic-humanwell": "company-humanwell",
  "domestic-nhu": "company-nhu", "domestic-jemincare": "company-jimin-kexin",
  "domestic-united-labs": "company-united-lab", "domestic-changchun-high-tech": "company-changchun-high-tech",
  "domestic-tongrentang": "company-tongrentang", "domestic-livzon": "company-livzon",
  "domestic-buchang": "company-buchang", "domestic-hansoh": "company-hansoh",
  "domestic-lunan": "company-lunan", "domestic-huahai": "company-huahai",
  "domestic-north-china-pharma": "company-north-china-pharma", "domestic-3sbio": "company-3sbio",
  "domestic-apeloa": "company-apeloa", "domestic-xinhua-pharma": "company-xinhua-pharma",
  "domestic-tianjin-pharma": "company-tianjin-pharma", "domestic-hec-pharm": "company-dongyangguang"
};

const OFFICIAL_JSON_ATS = new Set<ATSKind>([
  "OFFICIAL_JSON",
  "MOKA",
  "BEISEN_ZHIYE",
  "WORKDAY",
  "HOTJOB_WECRUIT",
  "REDSEA"
]);

function implementedAdapterFor(
  seed: CandidateSeed,
  sourceSeed: CandidateSocialSourceSeed
): "official-json" | "html-table" | undefined {
  if (seed.targetStatus && seed.targetStatus !== "ACTIVE") return undefined;
  if (isVerifiedNonJobRecruitmentPage(sourceSeed)) return undefined;
  if ([
    "company-fosun-pharma",
    "company-kelun"
  ].includes(seed.id)) return "html-table";
  if (OFFICIAL_JSON_ATS.has(sourceSeed.atsKind ?? "UNKNOWN")) return "official-json";
  if (sourceSeed.atsKind === "OFFICIAL_HTML" || sourceSeed.atsKind === "SUCCESSFACTORS") return "html-table";
  return undefined;
}

function expectedSurfacesFor(seed: CandidateSeed): ExpectedOfficialRecruitmentSurface[] {
  return socialSourceSeedsFor(seed).flatMap((sourceSeed, index) => {
    const social: ExpectedOfficialRecruitmentSurface = {
      surfaceId: surfaceIdFor(seed.id, "social", index),
      companyId: seed.id,
      kind: "SOCIAL",
      legalEntityScope: [{ status: "UNRESOLVED", reason: "Fresh official legal-entity scope evidence is pending." }],
      businessUnitScope: [{ status: "UNRESOLVED", reason: "Fresh official business-unit scope evidence is pending." }],
      brandScope: [{ status: "UNRESOLVED", reason: "Fresh official brand scope evidence is pending." }],
      channels: [{
        channelId: `channel-${seed.id.replace(/^company-/, "")}-social-unresolved`,
        kind: "UNKNOWN",
        status: "UNRESOLVED"
      }],
      chinaScope: { status: "UNRESOLVED", reason: "Fresh official Mainland-China geography evidence is pending." },
      ...(sourceSeed.socialEntryUrl ? { officialEntryUrl: sourceSeed.socialEntryUrl } : {}),
      officialChainEvidenceUrls: sourceSeed.officialChainEvidenceUrl ? [sourceSeed.officialChainEvidenceUrl] : [],
      atsKind: sourceSeed.atsKind ?? "UNKNOWN",
      ...(sourceSeed.recruitmentPageCapability
        ? { recruitmentPageCapability: sourceSeed.recruitmentPageCapability }
        : {}),
      ...(sourceSeed.capabilityVerification
        ? { capabilityVerification: sourceSeed.capabilityVerification }
        : {}),
      ...(() => {
        const adapterId = implementedAdapterFor(seed, sourceSeed);
        return adapterId ? { adapterId } : {};
      })(),
      status:
        seed.targetStatus === "BLOCKED_EVIDENCE_GAP"
          ? "BLOCKED_UNVERIFIED"
          : isVerifiedNonJobRecruitmentPage(sourceSeed)
            ? "VERIFIED_NON_JOB_RECRUITMENT_INFORMATION"
          : sourceSeed.socialEntryUrl && sourceSeed.officialChainEvidenceUrl
            ? "INCLUDED"
            : "BLOCKED_UNVERIFIED",
      includeReason:
        seed.targetStatus === "BLOCKED_EVIDENCE_GAP"
          ? "Official-linked entry retained; required evidence or implementation remains incomplete."
          : isVerifiedNonJobRecruitmentPage(sourceSeed)
            ? "Official recruitment information or contact page verified as not containing a job listing at capture time."
          : "Recorded official recruitment chain; independent completeness remains pending.",
      oracleStatus: "RESEARCH_PENDING_INDEPENDENT_VERIFICATION"
    };
    const campus: ExpectedOfficialRecruitmentSurface[] = sourceSeed.campusEntryUrl
      ? [(() => {
          const { adapterId: _adapterId, ...campusSurface } = social;
          return {
          ...campusSurface,
          surfaceId: surfaceIdFor(seed.id, "campus", index),
          kind: "CAMPUS",
          officialEntryUrl: sourceSeed.campusEntryUrl,
          status: "BLOCKED_UNVERIFIED",
          includeReason: "Campus surface recorded separately; excluded from social ingestion until independently verified."
        }; })()]
      : [];
    return [social, ...campus];
  });
}

export function buildCandidateCompanyRegistry(
  seeds: readonly CandidateSeed[]
): { companies: CandidateCompany[]; surfaces: ExpectedOfficialRecruitmentSurface[] } {
  const companies = seeds.map(toCompany);
  derivePhase1Scope(companies);
  return {
    companies,
    surfaces: seeds.flatMap(expectedSurfacesFor)
  };
}

const candidateRegistry = buildCandidateCompanyRegistry(CANDIDATE_SEEDS);
export const candidateCompanies: CandidateCompany[] = deepFreezeRegistryAuthority(candidateRegistry.companies);
export const expectedOfficialSurfaces: ExpectedOfficialRecruitmentSurface[] = deepFreezeRegistryAuthority(
  candidateRegistry.surfaces
);

function deepFreezeRegistryAuthority<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeRegistryAuthority(child);
    }
    Object.freeze(value);
  }
  return value;
}

export const excludedCompanies: ExcludedCompany[] = [
  { companyId: "company-edwards-china", officialChineseName: "爱德华生命科学中国", exclusionCategory: "DEVICE", reason: "Cardiovascular medical device company." },
  { companyId: "company-kefu-china", officialChineseName: "科赴中国", exclusionCategory: "UNPROVEN_CHINA", reason: "Not proven to be an in-scope pharma target." },
  { companyId: "company-medtronic-china", officialChineseName: "美敦力中国", exclusionCategory: "MEDTECH", reason: "Medical device company." },
  { companyId: "company-thermo-fisher-china", officialChineseName: "赛默飞世尔科技中国", exclusionCategory: "LIFE_SCIENCE_TOOLS", reason: "Life-science tools and services company." },
  { companyId: "company-ge-healthcare-china", officialChineseName: "通用电气医疗中国", exclusionCategory: "MEDTECH", reason: "Imaging and healthcare technology company." },
  { companyId: "company-vertex-china", officialChineseName: "福泰制药", exclusionCategory: "UNPROVEN_CHINA", reason: "China business and recruitment chain were not proven in the confirmed evidence." },
  { companyId: "company-regeneron-china", officialChineseName: "再生元", exclusionCategory: "UNPROVEN_CHINA", reason: "China business and recruitment chain were not proven in the confirmed evidence." },
  { companyId: "company-alcon-china", officialChineseName: "爱尔康", exclusionCategory: "DEVICE", reason: "Mixed vision-care and surgical-device scope is outside the strict roster." },
  { companyId: "company-beta-pharma", officialChineseName: "贝达药业股份有限公司", exclusionCategory: "OUTSIDE_CONFIRMED_ROSTER", reason: "Not a member of the confirmed domestic 30 target roster." },
  { companyId: "company-jacobio", officialChineseName: "加科思药业", exclusionCategory: "OUTSIDE_CONFIRMED_ROSTER", reason: "Not a member of the confirmed domestic 30 target roster." },
  ...[
    ["company-beigene", "百济神州"], ["company-jichuan", "济川药业集团有限公司"],
    ["company-simcere", "先声药业有限公司"], ["company-yiling", "石家庄以岭药业股份有限公司"],
    ["company-kanghong", "成都康弘药业集团股份有限公司"], ["company-innocare", "诺诚健华"],
    ["company-henlius", "复宏汉霖"], ["company-haisco", "海思科医药集团股份有限公司"],
    ["company-ascentage", "亚盛医药"], ["company-better-pharma", "成都倍特药业股份有限公司"],
    ["company-mabwell", "迈威生物"], ["company-cms", "康哲药业控股有限公司"]
  ].map(([companyId, officialChineseName]) => ({
    companyId: companyId!, officialChineseName: officialChineseName!,
    exclusionCategory: "OUTSIDE_CONFIRMED_ROSTER" as const,
    reason: "Later runtime-only target change not present in the user-confirmed V3 roster."
  }))
];

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalHash<T>(values: readonly T[], key: (value: T) => string): string {
  const ordered = [...values].sort((left, right) => compareUtf8(key(left), key(right)));
  return createHash("sha256").update(canonicalJson(ordered), "utf8").digest("hex");
}

export function companyRosterSha256(companies: readonly CandidateCompany[]): string {
  return canonicalHash(companies, (company) => company.id);
}

export function officialSurfaceOracleSha256(surfaces: readonly ExpectedOfficialRecruitmentSurface[]): string {
  return canonicalHash(surfaces, (surface) => surface.surfaceId);
}

export function validateStrictCompanyRegistry(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[],
  exclusions: readonly ExcludedCompany[]
): string[] {
  const errors: string[] = [];
  if (companies.filter((company) => company.category === "FOREIGN_PHARMA").length !== 30) errors.push("FOREIGN_PHARMA_COUNT_NOT_30");
  if (companies.filter((company) => company.category === "DOMESTIC_PHARMA").length !== 30) errors.push("DOMESTIC_PHARMA_COUNT_NOT_30");
  if (new Set(companies.map((company) => company.id)).size !== companies.length) errors.push("DUPLICATE_COMPANY_ID");
  if (new Set(surfaces.map((surface) => surface.surfaceId)).size !== surfaces.length) errors.push("DUPLICATE_SURFACE_ID");
  if (companies.some((company) => !company.officialWebsiteUrl)) errors.push("MISSING_OFFICIAL_WEBSITE");
  if (companies.some((company) => company.officialChineseName.trim().length === 0)) errors.push("EMPTY_OFFICIAL_CHINESE_NAME");
  if (new Set(companies.map((company) => company.officialChineseName.trim())).size !== companies.length) errors.push("DUPLICATE_OFFICIAL_CHINESE_NAME");
  if (companies.some((company) => company.officialChineseName.includes("/"))) errors.push("AMBIGUOUS_OFFICIAL_CHINESE_NAME");
  const targetIds = new Set(companies.map((company) => company.id));
  if (exclusions.some((company) => targetIds.has(company.companyId))) errors.push("EXCLUDED_COMPANY_IN_TARGET");
  if (surfaces.some((surface) => !targetIds.has(surface.companyId))) errors.push("SURFACE_WITHOUT_TARGET_COMPANY");
  const noLinkCompanyIds = new Set(
    companies
      .filter((company) => company.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME")
      .map((company) => company.id)
  );
  if (companies.some((company) => noLinkCompanyIds.has(company.id) && company.sources.length > 0)) {
    errors.push("NO_LINK_COMPANY_HAS_SOURCE");
  }
  if (surfaces.some((surface) => noLinkCompanyIds.has(surface.companyId))) {
    errors.push("NO_LINK_COMPANY_HAS_SURFACE");
  }
  try {
    const scope = derivePhase1Scope(companies);
    const excludedIds = new Set(scope.authorizedExclusionCompanies.map(({ id }) => id));
    if (surfaces.some((surface) => excludedIds.has(surface.companyId))) {
      errors.push("AUTHORIZED_PHASE1_EXCLUSION_HAS_SURFACE");
    }
  } catch {
    errors.push("INVALID_PHASE1_SCOPE_POLICY");
  }
  if (surfaces.some((surface) => surface.legalEntityScope.length === 0 || surface.businessUnitScope.length === 0 || surface.brandScope.length === 0)) errors.push("EMPTY_SURFACE_SCOPE");
  if (surfaces.some((surface) => surface.channels.length === 0)) errors.push("EMPTY_SURFACE_CHANNELS");
  if (surfaces.some((surface) => surface.oracleStatus === "INDEPENDENTLY_VERIFIED" && hasUnresolvedSurfaceScope(surface))) errors.push("VERIFIED_SURFACE_HAS_UNRESOLVED_SCOPE");
  if (surfaces.some((surface) =>
    surface.status === "VERIFIED_NON_JOB_RECRUITMENT_INFORMATION" &&
    (!isVerifiedNonJobRecruitmentPage(surface) || surface.adapterId !== undefined)
  )) errors.push("INVALID_NON_JOB_RECRUITMENT_INFORMATION_SURFACE");
  if (surfaces.some((surface) =>
    isVerifiedNonJobRecruitmentPage(surface) &&
    surface.status !== "VERIFIED_NON_JOB_RECRUITMENT_INFORMATION"
  )) errors.push("NON_JOB_RECRUITMENT_INFORMATION_SURFACE_STATUS_DRIFT");
  return errors;
}

export function hasUnresolvedSurfaceScope(surface: ExpectedOfficialRecruitmentSurface): boolean {
  const scopeArrays = [surface.legalEntityScope, surface.businessUnitScope, surface.brandScope];
  const hasInvalidScopeShape = scopeArrays.some(
    (scopes) => !Array.isArray(scopes) || scopes.length === 0 || scopes.some((scope) => !isStrictScope(scope))
  );
  const hasUnresolvedScope = !hasInvalidScopeShape && scopeArrays.some(
    (scopes) => scopes.some((scope) => scope.status !== "RESOLVED")
  );
  const hasInvalidChannelShape = !Array.isArray(surface.channels) || surface.channels.length === 0 ||
    surface.channels.some((channel) => !isStrictExpectedChannel(channel));
  const hasUnresolvedChannel = !hasInvalidChannelShape &&
    surface.channels.some((channel) => channel.status !== "EXPECTED");
  return hasInvalidScopeShape || hasUnresolvedScope ||
    hasInvalidChannelShape || hasUnresolvedChannel ||
    !hasResolvedChinaScope(surface.chinaScope);
}

function hasResolvedChinaScope(scope: unknown): scope is Extract<ChinaRecruitmentScope, { status: "RESOLVED" }> {
  if (!scope || typeof scope !== "object") return false;
  const value = scope as Record<string, unknown>;
  return hasExactKeys(value, ["status", "geography", "evidenceArtifactSha256"]) &&
    value.status === "RESOLVED" && value.geography === "MAINLAND_CHINA" && isSha256(value.evidenceArtifactSha256);
}

function isStrictScope(scope: unknown): boolean {
  if (!scope || typeof scope !== "object") return false;
  const value = scope as Record<string, unknown>;
  if (value.status === "RESOLVED") {
    return hasExactKeys(value, ["status", "value", "evidenceArtifactSha256"]) &&
      typeof value.value === "string" && value.value.trim().length > 0 && isSha256(value.evidenceArtifactSha256);
  }
  return value.status === "UNRESOLVED" && hasExactKeys(value, ["status", "reason"]) &&
    typeof value.reason === "string" && value.reason.trim().length > 0;
}

function isStrictExpectedChannel(channel: unknown): boolean {
  if (!channel || typeof channel !== "object") return false;
  const value = channel as Record<string, unknown>;
  return hasExactKeys(value, ["channelId", "kind", "status"]) &&
    typeof value.channelId === "string" && value.channelId.trim().length > 0 &&
    (value.status === "UNRESOLVED" || (value.status === "EXPECTED" && ["SOCIAL", "CAMPUS", "INTERNAL"].includes(String(value.kind))));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function isSha256(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function getSocialSources(
  companies: readonly CandidateCompany[]
): CandidateRecruitmentSource[] {
  return companies
    .filter((company) => !isUserAuthorizedPhase1Exclusion(company.id))
    .flatMap((company) => company.sources)
    .filter((source) => source.kind === "SOCIAL");
}

export function getCandidatePoolStats(
  companies: readonly CandidateCompany[],
  officialSurfaces: readonly ExpectedOfficialRecruitmentSurface[] = expectedOfficialSurfaces
): CandidatePoolStats {
  const scope = derivePhase1Scope(companies);
  const inScopeCompanies = scope.inScopeCompanies;
  const sources = inScopeCompanies.flatMap((company) => company.sources);
  const activeSurfaceIds = new Set(
    officialSurfaces
      .filter((surface) =>
        surface.kind === "SOCIAL" &&
        surface.status === "INCLUDED" &&
        surface.oracleStatus === "INDEPENDENTLY_VERIFIED" &&
        !hasUnresolvedSurfaceScope(surface) &&
        isValidHttpUrl(surface.officialEntryUrl) &&
        surface.officialChainEvidenceUrls.length > 0 &&
        surface.officialChainEvidenceUrls.every(isValidHttpUrl) &&
        Boolean(surface.adapterId)
      )
      .map((surface) => surface.surfaceId)
  );
  const verifiedScrapableCompanies = inScopeCompanies.filter((company) =>
    company.sources.some(
      (source) =>
        source.kind === "SOCIAL" &&
        source.status === "VERIFIED_SCRAPABLE" &&
        isValidHttpUrl(source.officialEntryUrl) &&
        isValidHttpUrl(source.officialChainEvidenceUrl) &&
        Boolean(source.surfaceId) &&
        activeSurfaceIds.has(source.surfaceId!)
    )
  ).length;
  const socialSources = sources.filter((source) => source.kind === "SOCIAL");
  const expectedSocialSurfaces = officialSurfaces.filter((surface) => surface.kind === "SOCIAL");
  const socialSourceSurfaceIds = new Set(
    socialSources.flatMap((source) => source.surfaceId ? [source.surfaceId] : [])
  );
  const expectedSocialSurfaceIds = new Set(expectedSocialSurfaces.map((surface) => surface.surfaceId));
  const noLinkCompaniesAreEmpty = inScopeCompanies
    .filter((company) => company.targetStatus === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME")
    .every((company) =>
      company.sources.length === 0 &&
      !officialSurfaces.some((surface) => surface.companyId === company.id)
    );
  const linkedCompaniesAreReady = inScopeCompanies
    .filter((company) => company.targetStatus !== "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME")
    .every((company) =>
      company.targetStatus !== "BLOCKED_EVIDENCE_GAP" &&
      company.sources.some((source) => source.kind === "SOCIAL")
    );
  const allExpectedSocialSurfacesAreReady = expectedSocialSurfaces.every((surface) =>
    activeSurfaceIds.has(surface.surfaceId)
  );
  const allSocialSourcesAreReady = socialSources.every((source) =>
    source.status === "VERIFIED_SCRAPABLE" &&
    isValidHttpUrl(source.officialEntryUrl) &&
    isValidHttpUrl(source.officialChainEvidenceUrl) &&
    Boolean(source.surfaceId) &&
    activeSurfaceIds.has(source.surfaceId!)
  );
  const sourcesAndSurfacesMatch =
    socialSourceSurfaceIds.size === expectedSocialSurfaceIds.size &&
    [...socialSourceSurfaceIds].every((surfaceId) => expectedSocialSurfaceIds.has(surfaceId));

  return {
    totalCandidates: companies.length,
    phase1InScopeCompanies: scope.inScopeCompanies.length,
    authorizedExclusionCompanies: scope.authorizedExclusionCount,
    socialSources: socialSources.length,
    campusSources: sources.filter((source) => source.kind === "CAMPUS").length,
    verifiedScrapableCompanies,
    canLaunchP0:
      companies.length === P0_REQUIRED_CANDIDATES &&
      noLinkCompaniesAreEmpty &&
      linkedCompaniesAreReady &&
      allExpectedSocialSurfacesAreReady &&
      allSocialSourcesAreReady &&
      sourcesAndSurfacesMatch
  };
}
