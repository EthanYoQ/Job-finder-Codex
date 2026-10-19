import { isHengruiMainlandLocation } from "./hengruiMainlandGeography";
import { CITY_PENDING } from "../domain/jobLocation";
import type { SourceCrawlPlan } from "./sourcePlan";
import { ucbOfficialPostedDate } from "./ucbOfficialPostedDate";

/** Timestamp preservation only; no age cutoff or Healthcare/category restriction. */
export const MERCK_POSTED_DATE_POLICY = "MERCK_CHINA_PHENOM_POSTED_DATE_V1" as const;
export const MERCK_CITY_SCOPE_POLICY = "MERCK_CHINA_LOCATION_TITLE_PENDING_V2" as const;
export const MERCK_PUBLIC_VISIBILITY_POLICY = "MERCK_CHINA_PUBLIC_VISIBILITY_V1" as const;
export const merckOfficialPostedDate = ucbOfficialPostedDate;

export function requiresMerckChinaQuality(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") return false;
  const config = plan.officialJsonFetch;
  return config.postedDatePolicy === MERCK_POSTED_DATE_POLICY || config.cityScopePolicy === MERCK_CITY_SCOPE_POLICY ||
    config.publicVisibilityPolicy === MERCK_PUBLIC_VISIBILITY_POLICY ||
    (plan.source.id === "source-merck-china-social" && config.facetScope?.partitionProofPolicy !== "MERCK_HEALTHCARE_PARTITION_V1");
}

export function exactMerckChinaQualityPlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") return false;
  const config = plan.officialJsonFetch, fields = plan.json.fields;
  return plan.company.id === "company-merck-china" && plan.company.officialChineseName === "默克医药健康" &&
    plan.company.category === "FOREIGN_PHARMA" && plan.source.id === "source-merck-china-social" &&
    plan.source.companyId === plan.company.id && plan.source.kind === "SOCIAL" &&
    plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === "https://careers.emdgroup.com/us/en/search-results?keywords=China" &&
    plan.source.officialChainEvidenceUrl === "https://careers.merckgroup.com/cn/zh/search-results" &&
    config.postedDatePolicy === MERCK_POSTED_DATE_POLICY && config.cityScopePolicy === MERCK_CITY_SCOPE_POLICY &&
    config.publicVisibilityPolicy === MERCK_PUBLIC_VISIBILITY_POLICY &&
    config.countryFilter === "China" && config.detailBaseUrl === "https://careers.emdgroup.com/us/en/job" &&
    config.allowOmittedOffsetForSinglePage === true && config.pageSize === 50 && config.maxPages === 10 &&
    config.derivedDetailIdField === undefined && config.mixedLocationScopePolicy === undefined &&
    config.allowedApplyOrigins === undefined && config.allowedEntryRedirect === undefined && config.facetScope === undefined &&
    config.requestBoundOmittedOffsetPolicy === undefined && config.exactDuplicateReconciliationPolicy === undefined &&
    !plan.workday && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" && fields.officialUrl === "officialUrl" &&
    fields.locationRaw === "locationRaw" && fields.cities === "cities" && fields.officialPublishedAt === "officialPublishedAt" &&
    fields.category === undefined && fields.auxiliaryChineseTitle === undefined;
}

export function exactMerckChinaBootstrap(config: {
  widgetApiEndpoint: string; country: string; deviceType: string; locale: string; refNum: string; pageName: string; pageId: string;
}): boolean {
  return config.widgetApiEndpoint === "https://careers.emdgroup.com/widgets" && config.country === "us" &&
    config.deviceType === "desktop" && config.locale === "en_us" && config.refNum === "MQAEGZUS" &&
    config.pageName === "search-results" && config.pageId === "page18-ds";
}

// Retained official fields only. New fields require review, including shadow geography such as workLocations.
const RAW_FIELDS = new Set([
  "descriptionTeaser", "state", "siteType", "multi_category", "reqId", "city", "latitude", "multi_location", "roleLevel",
  "applyUrl", "externalApply", "cityState", "country", "visibilityType", "longitude", "jobId", "locale", "title", "jobSeqNo",
  "postedDate", "dateCreated", "cityStateCountry", "jobVisibility", "location", "category", "ml_skills", "ml_job_parser",
  "isMultiLocation", "multi_location_array", "isMultiCategory", "multi_category_array", "badge", "type"
]);
const MAINLAND_LOCATIONS = [
  ["Shanghai", "Shanghai", "上海", "31.22222", "121.45806"],
  ["Beijing", "Beijing", "北京", "39.9075", "116.39723"],
  ["Guangzhou", "Guangdong", "广州", "23.11667", "113.25"],
  ["Suzhou", "Jiangsu", "苏州", "31.30408", "120.59538"],
  ["Wuxi", "Jiangsu", "无锡", "31.56887", "120.28857"],
  ["Nantong", "Jiangsu", "南通", "32.03028", "120.87472"],
  ["Shenzhen", "Guangdong", "深圳", "22.54554", "114.0683"]
] as const;
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exactFields(value: Record<string, unknown>, fields: string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

/** Every redundant geography value must agree with one reviewed mainland locality.
 * Coordinates corroborate the retained named locality; they never infer another city. */
export function merckOfficialCities(raw: Record<string, unknown>): string[] | undefined {
  if (Object.keys(raw).some(field => !RAW_FIELDS.has(field)) || raw.country !== "China" || raw.isMultiLocation !== false) return undefined;
  // Official municipality-only Shanghai evidence proves China, not an exact job city.
  const municipalityOnly = raw.city === "" && raw.state === "Shanghai";
  const pair = MAINLAND_LOCATIONS.find(([city, state]) => (municipalityOnly ? city === "Shanghai" : raw.city === city) && raw.state === state);
  if (!pair) return undefined;
  const [city, state, chineseCity, latitude, longitude] = pair;
  const location = municipalityOnly ? `${state}, China` : `${city}, ${state}, China`;
  if (raw.location !== location || raw.cityStateCountry !== location || raw.cityState !== (municipalityOnly ? state : `${city}, ${state}`) ||
    raw.latitude !== latitude || raw.longitude !== longitude || !Array.isArray(raw.multi_location) ||
    raw.multi_location.length !== 1 || raw.multi_location[0] !== location || !Array.isArray(raw.multi_location_array) ||
    raw.multi_location_array.length !== 1) return undefined;
  const alternative = raw.multi_location_array[0];
  if (!record(alternative) || !exactFields(alternative, ["location", "latlong"]) || alternative.location !== location ||
    !record(alternative.latlong) || !exactFields(alternative.latlong, ["lat", "lon"]) ||
    alternative.latlong.lat !== Number(latitude) || alternative.latlong.lon !== Number(longitude)) return undefined;
  return merckTitleCityScope(raw, municipalityOnly ? CITY_PENDING : chineseCity);
}

/** The retained feed derives its detail URL from the exact official requisition identity. */
export function merckOfficialIdentity(raw: Record<string, unknown>): boolean {
  return merckPublicVisibility(raw) && raw.externalApply === false &&
    typeof raw.reqId === "string" && /^\d+$/u.test(raw.reqId) && raw.jobId === raw.reqId &&
    raw.jobSeqNo === `MQAEGZUS${raw.reqId}EXTERNALENUS` && raw.applyUrl === "";
}

/** The source explicitly marks external visibility. Array order and optional
 * internal visibility are immaterial; unknown labels or internal-only rows hold.
 * This is public visibility, not a separate assertion of current job status. */
function merckPublicVisibility(raw: Record<string, unknown>): boolean {
  const labels = raw.jobVisibility;
  return raw.visibilityType === "External" && raw.siteType === "external" && Array.isArray(labels) &&
    labels.includes("external") && labels.every(label => label === "external" || label === "internal") &&
    new Set(labels).size === labels.length;
}

// Only observed, positively identified mainland city labels; no city is inferred
// from a role title. A conflicting/extra label retains the job with city pending.
const REVIEWED_NON_LOCATION_SUFFIXES = new Set([
  "客户服务AI及数字化解决方案", "Data & AI Solution Enablement", "上游", "Protein and Cell Biology",
  "生物安全检测", "生物工艺解决方案", "Upstream", "下游工艺", "零售"
]);
// These are explicit location-bearing syntaxes, but not the reviewed final city
// suffix grammar. Hold them even when a recognized city appears; never silently
// trust the primary city or reinterpret office/territory/remote semantics.
const UNREVIEWED_LOCATION_LABEL = /(?:工作地点|工作城市|办公地点|办公城市|工作地[：:]|(?:work|job|office)\s+location|\blocation\s*[:：]|\bbased\s+(?:in|at)\b|\bremote\b)/iu;

const TITLE_ENGLISH_CITIES: ReadonlyMap<string, string> = new Map(MAINLAND_LOCATIONS.map(([english, , chinese]) => [english, chinese]));
const DESCRIPTION_TEXT_FIELDS = new Set([
  "descriptionTeaser", "descriptionTeaser_first200", "descriptionTeaser_keyword", "descriptionTeaser_ats"
]);
function mainlandTitleCity(value: string): string | undefined {
  return isHengruiMainlandLocation({ country: "China", cityName: value }) ? value.replace(/市$/u, "") : TITLE_ENGLISH_CITIES.get(value);
}
function knownCityLabels(value: string): string[] | undefined {
  const labels = value.split("/").map(mainlandTitleCity);
  return labels.length > 0 && labels.every(label => label !== undefined) && new Set(labels).size === labels.length
    ? labels as string[] : undefined;
}

function merckTitleCityScope(raw: Record<string, unknown>, structuredCity: string): string[] | undefined {
  if (typeof raw.title !== "string" || !raw.title.trim()) return undefined;
  const texts: unknown[] = [raw.title];
  if (Object.hasOwn(raw, "descriptionTeaser")) texts.push(raw.descriptionTeaser);
  if (Object.hasOwn(raw, "ml_job_parser")) {
    if (!record(raw.ml_job_parser) || Object.keys(raw.ml_job_parser).some(key => !DESCRIPTION_TEXT_FIELDS.has(key))) return undefined;
    texts.push(...Object.values(raw.ml_job_parser));
  }
  const mentionedCities = new Set<string>();
  const cleanTexts: string[] = [];
  for (const text of texts) {
    if (typeof text !== "string") return undefined;
    let invalid = false;
    // The complete observed sentence is the only reviewed labeled grammar. It
    // names a China alternative set; it never proves office versus territory.
    const cleaned = text.replace(/(^|[.!?]\s+)Location: ([^.,:;\r\n]+), China\./gu, (sentence, prefix: string, value: string) => {
      const labels = knownCityLabels(value);
      if (!labels) { invalid = true; return sentence; }
      labels.forEach(city => mentionedCities.add(city));
      return prefix;
    });
    if (invalid || UNREVIEWED_LOCATION_LABEL.test(cleaned)) return undefined;
    cleanTexts.push(cleaned);
  }
  const parts = cleanTexts[0]!.trim().split(/[-,，]/u);
  if (parts.length > 1) {
    const suffix = parts.at(-1)!.trim();
    if (!REVIEWED_NON_LOCATION_SUFFIXES.has(suffix)) {
      // Titles were reviewed with Chinese suffix labels. English city aliases
      // are supported only inside the explicit Location: ..., China. sentence.
      const labels = suffix.split("/");
      if (labels.some(label => !isHengruiMainlandLocation({ country: "China", cityName: label })) || new Set(labels).size !== labels.length) return undefined;
      labels.forEach(city => mentionedCities.add(city));
    }
  }
  // Duplicate official text surfaces may repeat or reorder a mainland set. If
  // their positive mainland sets differ, retain the row with city pending.
  return [...mentionedCities].every(city => city === structuredCity) ? [structuredCity] : [CITY_PENDING];
}
