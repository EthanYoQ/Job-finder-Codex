import { BMS_GEOGRAPHY_POLICY } from "./bmsMainlandGeography";
import type { SourceCrawlPlan } from "./sourcePlan";

/** Preservation only. No lower age limit, future eligibility limit, or publication authority. */
export const BMS_POSTED_DATE_POLICY = "BMS_EIGHTFOLD_POSTED_SECONDS_V1" as const;

export function requiresBmsPostedDate(plan: SourceCrawlPlan): boolean {
  return plan.source.id === "source-bms-china-social" ||
    (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "eightfold-pcsx" &&
      (plan.officialJsonFetch.postedDatePolicy !== undefined || plan.officialJsonFetch.cityScopePolicy !== undefined));
}

export function exactBmsPostedDatePlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json") return false;
  const config = plan.officialJsonFetch;
  const fields = plan.json.fields;
  let entry: URL;
  try { entry = new URL(plan.source.officialEntryUrl); } catch { return false; }
  return plan.company.id === "company-bms-china" &&
    plan.company.officialChineseName === "百时美施贵宝中国" &&
    plan.source.id === "source-bms-china-social" && plan.source.companyId === "company-bms-china" &&
    plan.source.atsKind === "OFFICIAL_JSON" &&
    entry.origin === "https://jobs.bms.com" && entry.pathname === "/careers" &&
    !entry.username && !entry.password && !entry.hash &&
    config?.kind === "eightfold-pcsx" && config.domain === "bms.com" && config.location === "china" &&
    config.detailBaseUrl === "https://jobs.bms.com/careers/job" && config.pageSize === 10 && config.maxPages === 5 &&
    config.postedDatePolicy === BMS_POSTED_DATE_POLICY && config.cityScopePolicy === BMS_GEOGRAPHY_POLICY &&
    !plan.workday && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" && fields.officialUrl === "officialUrl" &&
    fields.locationRaw === "locationRaw" && fields.cities === "cities" && fields.officialPublishedAt === "officialPublishedAt" &&
    fields.category === undefined && fields.auxiliaryChineseTitle === undefined;
}

/** Integer Unix seconds, including pre-epoch dates. Zero/-1 are missing-value sentinels.
 * The four-digit calendar domain rejects milliseconds; it is not a recency window. */
export function bmsOfficialPostedDate(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value === 0 || value === -1) return undefined;
  const instant = new Date(value * 1000);
  const year = instant.getUTCFullYear();
  if (!Number.isFinite(instant.getTime()) || year < 1 || year > 9999 || instant.getTime() / 1000 !== value) return undefined;
  return instant.toISOString();
}
