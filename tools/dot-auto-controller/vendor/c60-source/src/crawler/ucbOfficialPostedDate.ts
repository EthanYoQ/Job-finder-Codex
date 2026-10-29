import type { SourceCrawlPlan } from "./sourcePlan";

/** Preservation only: this policy selects no temporal eligibility bound and authorizes no publication. */
export const UCB_POSTED_DATE_POLICY = "UCB_PHENOM_POSTED_DATE_V1" as const;

export function requiresUcbPostedDate(plan: SourceCrawlPlan): boolean {
  return plan.source.id === "source-ucb-china-social" ||
    (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "phenom" &&
      (plan.officialJsonFetch.postedDatePolicy !== undefined || plan.officialJsonFetch.cityScopePolicy !== undefined));
}

export function exactUcbPostedDatePlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") return false;
  const config = plan.officialJsonFetch;
  const fields = plan.json.fields;
  return plan.company.id === "company-ucb-china" && plan.company.officialChineseName === "优时比中国" &&
    plan.company.category === "FOREIGN_PHARMA" && plan.source.id === "source-ucb-china-social" &&
    plan.source.companyId === plan.company.id && plan.source.kind === "SOCIAL" &&
    plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === "https://careers.ucb.com/global/zh/search-results?keywords=China" &&
    plan.source.officialChainEvidenceUrl === "https://careers.ucb.com/" &&
    config.postedDatePolicy === UCB_POSTED_DATE_POLICY && config.cityScopePolicy === "UCB_PRIMARY_CITY_AGREEMENT_V1" && config.countryFilter === "China" &&
    config.detailBaseUrl === "https://careers.ucb.com/global/en/job" &&
    config.allowOmittedOffsetForSinglePage === true && config.pageSize === 50 && config.maxPages === 5 &&
    config.derivedDetailIdField === undefined && config.mixedLocationScopePolicy === undefined &&
    config.allowedApplyOrigins === undefined && config.allowedEntryRedirect === undefined &&
    config.facetScope === undefined && config.requestBoundOmittedOffsetPolicy === undefined &&
    config.exactDuplicateReconciliationPolicy === undefined &&
    !plan.workday && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" && fields.officialUrl === "officialUrl" &&
    fields.locationRaw === "locationRaw" && fields.cities === "cities" && fields.officialPublishedAt === "officialPublishedAt" &&
    fields.category === undefined && fields.auxiliaryChineseTitle === undefined;
}

export function exactUcbPostedDateBootstrap(config: {
  widgetApiEndpoint: string; country: string; deviceType: string; locale: string;
  refNum: string; pageName: string; pageId: string;
}): boolean {
  return config.widgetApiEndpoint === "https://careers.ucb.com/widgets" && config.country === "global" &&
    config.deviceType === "desktop" && config.locale === "zh_global" && config.refNum === "UCB1GLOBAL" &&
    config.pageName === "search-results" && (config.pageId === "page17" || config.pageId === "page17-ds");
}

// Exact shared timestamp codec, retained as an alias for existing callers.
export { phenomOfficialPostedDate as ucbOfficialPostedDate } from "./phenomOfficialPostedDate";

// Existing UCB-local city aliases, matched as whole values rather than substrings.
const UCB_CITY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"],
  ["Beijing", "北京"],
  ["Changsha", "长沙"],
  ["Changchun", "长春"],
  ["Chongqing", "重庆"],
  ["Daqing", "大庆"],
  ["Suzhou", "苏州"],
  ["Dongguan", "东莞"],
  ["Shenzhen", "深圳"],
  ["Guangzhou", "广州"],
  ["Hangzhou", "杭州"],
  ["Kashi", "喀什"],
  ["Leshan", "乐山"],
  ["Nanjing", "南京"],
  ["Nanning", "南宁"],
  ["Nantong", "南通"],
  ["Ningde", "宁德"],
  ["Songyuan", "松原"],
  ["Wuhan", "武汉"],
  ["Chengdu", "成都"],
  ["Urumqi", "乌鲁木齐"],
  ["Wulumuqi", "乌鲁木齐"],
  ["Wenzhou", "温州"],
  ["Tonghua", "通化"],
  ["Xining", "西宁"],
  ["Zhuhai", "珠海"],
  ["Tianjin", "天津"],
  ["Lanzhou", "兰州"],
  ["Taiyuan", "太原"],
  ["Yancheng", "盐城"],
  ["上海", "上海"],
  ["北京", "北京"],
  ["长沙", "长沙"],
  ["长春", "长春"],
  ["重庆", "重庆"],
  ["大庆", "大庆"],
  ["苏州", "苏州"],
  ["东莞", "东莞"],
  ["深圳", "深圳"],
  ["广州", "广州"],
  ["杭州", "杭州"],
  ["喀什", "喀什"],
  ["乐山", "乐山"],
  ["南京", "南京"],
  ["宁德", "宁德"],
  ["松原", "松原"],
  ["武汉", "武汉"],
  ["成都", "成都"],
  ["乌鲁木齐", "乌鲁木齐"],
  ["通化", "通化"],
  ["西宁", "西宁"],
  ["天津", "天津"],
  ["兰州", "兰州"],
  ["太原", "太原"],
  ["盐城", "盐城"]
];

/** Reviewed primary grammar: city, China or city, same municipality, China.
 * An unknown province/locality relationship needs separate source review. A raw
 * city must name the same exact locality; it never adds another city to the job. */
export function ucbOfficialCities(primary: unknown, rawCity: unknown): string[] | undefined {
  if (typeof primary !== "string" || typeof rawCity !== "string") return undefined;
  const clean = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const resolve = (value: string) => UCB_CITY_ALIASES.find(([alias]) => clean(alias) === clean(value))?.[1];
  const segments = primary.split(/[,，]/u).map(clean);
  if ((segments.length !== 2 && segments.length !== 3) || segments.at(-1) !== "china") return undefined;
  const city = resolve(segments[0]!);
  if (!city || resolve(rawCity) !== city || (segments.length === 3 && resolve(segments[1]!) !== city)) return undefined;
  return [city];
}
