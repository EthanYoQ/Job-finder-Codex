import {
  RECENT_JOB_WINDOW_DAYS,
  SOURCE_NATIVE_HALF_YEAR_WINDOW_DAYS
} from "../domain/jobRecencyPolicy";

export type FutureCrawlIntakeKind = "NEW_EXPANSION" | "EXISTING_ROSTER_REQUALIFICATION";
export type FutureCrawlSourceAuthorityStatus =
  | "OFFICIAL_CHAIN_VERIFIED"
  | "USER_VERIFIED_PENDING_OFFICIAL_CHAIN_RECHECK";

export type FutureCrawlRecencyPolicy =
  | { kind: "CRAWLER_DATE_WINDOW"; days: typeof RECENT_JOB_WINDOW_DAYS; sourceField: string }
  | { kind: "SOURCE_NATIVE_WINDOW"; days: typeof SOURCE_NATIVE_HALF_YEAR_WINDOW_DAYS; queryParameter: "d" }
  | { kind: "TIME_WINDOW_UNAVAILABLE"; reason: string };

export interface FutureCrawlExpansionCandidate {
  intakeKind: FutureCrawlIntakeKind;
  companyId: string;
  officialChineseName: string;
  officialEntryUrl: string;
  humanBaselineCount: number;
  humanScopeNote: string;
  sourceAuthorityStatus: FutureCrawlSourceAuthorityStatus;
  extractionMethod:
    | "MOKA_API_PAGINATION"
    | "BEISEN_2022_API_PAGINATION"
    | "STATIC_HTML_UNIQUE_DETAIL_URL"
    | "BROWSER_RENDERED_UNIQUE_DETAIL_URL"
    | "LEGACY_BEISEN_HTML_PAGINATION";
  recencyPolicy: FutureCrawlRecencyPolicy;
}

const dateWindow = (sourceField: string): FutureCrawlRecencyPolicy => ({
  kind: "CRAWLER_DATE_WINDOW",
  days: RECENT_JOB_WINDOW_DAYS,
  sourceField
});

export const FUTURE_CRAWL_INTAKE: readonly FutureCrawlExpansionCandidate[] = [
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-beigene", officialChineseName: "百济神州",
    officialEntryUrl: "https://app.mokahr.com/apply/beigene/98934#/jobs",
    humanBaselineCount: 483, humanScopeNote: "社会招聘；人工数为未按时间过滤的全量快照。",
    sourceAuthorityStatus: "OFFICIAL_CHAIN_VERIFIED", extractionMethod: "MOKA_API_PAGINATION",
    recencyPolicy: dateWindow("publishedAt")
  },
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-innovent", officialChineseName: "信达生物",
    officialEntryUrl: "https://innoventbio.zhiye.com/social/jobs", humanBaselineCount: 590,
    humanScopeNote: "社会招聘；半年内；全部地点。", sourceAuthorityStatus: "USER_VERIFIED_PENDING_OFFICIAL_CHAIN_RECHECK",
    extractionMethod: "BEISEN_2022_API_PAGINATION", recencyPolicy: dateWindow("ChangeDate")
  },
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-junshi", officialChineseName: "君实生物",
    officialEntryUrl: "https://junshibiosciences.zhiye.com/social/jobs", humanBaselineCount: 22,
    humanScopeNote: "社会招聘；半年内。", sourceAuthorityStatus: "OFFICIAL_CHAIN_VERIFIED",
    extractionMethod: "BEISEN_2022_API_PAGINATION", recencyPolicy: dateWindow("ChangeDate")
  },
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-akeso", officialChineseName: "康方生物",
    officialEntryUrl: "https://www.akesobio.com/cn/career/social-recruitment/", humanBaselineCount: 94,
    humanScopeNote: "社会招聘；人工数为未按时间过滤的全量快照。", sourceAuthorityStatus: "OFFICIAL_CHAIN_VERIFIED",
    extractionMethod: "STATIC_HTML_UNIQUE_DETAIL_URL", recencyPolicy: dateWindow("publishedDate")
  },
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-henlius", officialChineseName: "复宏汉霖",
    officialEntryUrl: "https://henlius.zhiye.com/social/jobs", humanBaselineCount: 77,
    humanScopeNote: "社会招聘；半年内。", sourceAuthorityStatus: "USER_VERIFIED_PENDING_OFFICIAL_CHAIN_RECHECK",
    extractionMethod: "BEISEN_2022_API_PAGINATION", recencyPolicy: dateWindow("ChangeDate")
  },
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-zaiding", officialChineseName: "再鼎医药",
    officialEntryUrl: "https://cn.zailaboratory.com/jobs/?location=%e5%a4%a7%e4%b8%ad%e5%8d%8e%e5%8c%ba",
    humanBaselineCount: 58, humanScopeNote: "大中华区。", sourceAuthorityStatus: "OFFICIAL_CHAIN_VERIFIED",
    extractionMethod: "BROWSER_RENDERED_UNIQUE_DETAIL_URL",
    recencyPolicy: { kind: "TIME_WINDOW_UNAVAILABLE", reason: "当前官方列表未提供可验证发布日期或官方时间过滤器。" }
  },
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-hutchmed", officialChineseName: "和黄医药",
    officialEntryUrl: "https://app.mokahr.com/social-recruitment/hutchmed/140975#/jobs", humanBaselineCount: 71,
    humanScopeNote: "社会招聘；人工数为未按时间过滤的全量快照。", sourceAuthorityStatus: "OFFICIAL_CHAIN_VERIFIED",
    extractionMethod: "MOKA_API_PAGINATION", recencyPolicy: dateWindow("publishedAt")
  },
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-innocare", officialChineseName: "诺诚健华",
    officialEntryUrl: "https://innocare.zhiye.com/social/jobs", humanBaselineCount: 86,
    humanScopeNote: "社会招聘；人工数为未按时间过滤的全量快照。", sourceAuthorityStatus: "OFFICIAL_CHAIN_VERIFIED",
    extractionMethod: "BEISEN_2022_API_PAGINATION", recencyPolicy: dateWindow("ChangeDate")
  },
  {
    intakeKind: "EXISTING_ROSTER_REQUALIFICATION", companyId: "company-3sbio", officialChineseName: "三生制药",
    officialEntryUrl: "https://3sbio.zhiye.com/social/jobs", humanBaselineCount: 164,
    humanScopeNote: "社会招聘；半年内。", sourceAuthorityStatus: "OFFICIAL_CHAIN_VERIFIED",
    extractionMethod: "BEISEN_2022_API_PAGINATION", recencyPolicy: dateWindow("ChangeDate")
  },
  {
    intakeKind: "NEW_EXPANSION", companyId: "company-allist", officialChineseName: "艾力斯",
    officialEntryUrl: "https://allist.zhiye.com/social?r=&p=&c=&d=180&k=#jlt", humanBaselineCount: 161,
    humanScopeNote: "社会招聘；官方 180 天过滤器。", sourceAuthorityStatus: "OFFICIAL_CHAIN_VERIFIED",
    extractionMethod: "LEGACY_BEISEN_HTML_PAGINATION",
    recencyPolicy: { kind: "SOURCE_NATIVE_WINDOW", days: SOURCE_NATIVE_HALF_YEAR_WINDOW_DAYS, queryParameter: "d" }
  }
] as const;

export const FUTURE_CRAWL_EXPANSION_CANDIDATES = FUTURE_CRAWL_INTAKE.filter(
  ({ intakeKind }) => intakeKind === "NEW_EXPANSION"
);

export const EXISTING_ROSTER_REQUALIFICATION_CANDIDATES = FUTURE_CRAWL_INTAKE.filter(
  ({ intakeKind }) => intakeKind === "EXISTING_ROSTER_REQUALIFICATION"
);
