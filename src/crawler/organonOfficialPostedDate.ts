import { irreversibleOfficialJsonEvidenceId } from "./officialJsonEvidence";
import type { SourceCrawlPlan } from "./sourcePlan";

/** Exact source-local quality binding. No age cutoff or inferred publication dates. */
export const ORGANON_POSTED_DATE_POLICY = "ORGANON_PHENOM_POSTED_DATE_V1" as const;

export const ORGANON_CITY_SCOPE_POLICY = "ORGANON_MAINLAND_LOCATION_PENDING_V1" as const;
export const ORGANON_PUBLIC_VISIBILITY_POLICY = "ORGANON_PUBLIC_VISIBILITY_V1" as const;
export const ORGANON_OFFSET_POLICY = "ORGANON_REQUEST_BOUND_OMITTED_OFFSET_V1" as const;

export function requiresOrganonPostedDate(plan: SourceCrawlPlan): boolean {
  return plan.source.id === "source-organon-china-social" ||
    (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "phenom" &&
      (plan.officialJsonFetch.postedDatePolicy === ORGANON_POSTED_DATE_POLICY ||
       plan.officialJsonFetch.cityScopePolicy === ORGANON_CITY_SCOPE_POLICY ||
       plan.officialJsonFetch.publicVisibilityPolicy === ORGANON_PUBLIC_VISIBILITY_POLICY ||
       plan.officialJsonFetch.requestBoundOmittedOffsetPolicy === ORGANON_OFFSET_POLICY));
}

export function exactOrganonPostedDatePlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") return false;
  const config = plan.officialJsonFetch;
  const fields = plan.json.fields;
  return plan.company.id === "company-organon-china" && plan.company.officialChineseName === "欧加隆中国" &&
    plan.company.category === "FOREIGN_PHARMA" && plan.source.id === "source-organon-china-social" &&
    plan.source.companyId === plan.company.id && plan.source.kind === "SOCIAL" &&
    plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === "https://jobs.organon.com/cn/zh/search-results?keywords=China" &&
    plan.source.officialChainEvidenceUrl === "https://jobs.organon.com/cn/zh/home" &&
    config.postedDatePolicy === ORGANON_POSTED_DATE_POLICY && config.cityScopePolicy === ORGANON_CITY_SCOPE_POLICY &&
    config.publicVisibilityPolicy === ORGANON_PUBLIC_VISIBILITY_POLICY && config.countryFilter === "China" &&
    config.detailBaseUrl === "https://jobs.organon.com/cn/zh/job" &&
    config.allowedApplyOrigins?.length === 1 && config.allowedApplyOrigins[0] === "https://organon.wd5.myworkdayjobs.com" &&
    config.pageSize === 50 && config.maxPages === 5 && config.allowOmittedOffsetForSinglePage === undefined &&
    config.derivedDetailIdField === undefined && config.mixedLocationScopePolicy === undefined &&
    config.allowedEntryRedirect === undefined && config.facetScope === undefined &&
    config.requestBoundOmittedOffsetPolicy === ORGANON_OFFSET_POLICY && config.exactDuplicateReconciliationPolicy === undefined &&
    !plan.workday && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" && fields.officialUrl === "officialUrl" &&
    fields.locationRaw === "locationRaw" && fields.cities === "cities" && fields.officialPublishedAt === "officialPublishedAt" &&
    fields.category === undefined && fields.auxiliaryChineseTitle === undefined;
}

export function exactOrganonPostedDateBootstrap(config: {
  widgetApiEndpoint: string; country: string; deviceType: string; locale: string;
  refNum: string; pageName: string; pageId: string;
}): boolean {
  return config.widgetApiEndpoint === "https://jobs.organon.com/widgets" && config.country === "cn" &&
    config.deviceType === "desktop" && config.locale === "zh_cn" && config.refNum === "MECEUS" &&
    config.pageName === "search-results" && config.pageId === "page18-ds";
}

/** Independently reconstruct the source bootstrap locator for raw replay. */
export function organonBootstrapLocator(config: Parameters<typeof exactOrganonPostedDateBootstrap>[0]): string {
  return ["phenom-entry-config-v1",
    `endpoint:${irreversibleOfficialJsonEvidenceId(config.widgetApiEndpoint)}`,
    `refNum:${irreversibleOfficialJsonEvidenceId(config.refNum)}`,
    `locale:${irreversibleOfficialJsonEvidenceId(config.locale)}`,
    `device:${irreversibleOfficialJsonEvidenceId(config.deviceType)}`,
    `country:${irreversibleOfficialJsonEvidenceId(config.country)}`,
    `pageName:${irreversibleOfficialJsonEvidenceId(config.pageName)}`,
    `pageId:${irreversibleOfficialJsonEvidenceId(config.pageId)}`].join("|");
}
