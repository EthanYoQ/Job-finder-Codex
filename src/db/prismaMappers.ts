import type { LifecycleStatus } from "../crawler/lifecycle";
import type { RequiredJobField } from "../domain/company";
import type { JobCategory } from "../domain/search";

export type PrismaJobCategoryName =
  | "SALES"
  | "MARKETING"
  | "BUSINESS"
  | "CHANNEL"
  | "KA"
  | "MEDICAL_AFFAIRS"
  | "CLINICAL_OPERATIONS"
  | "REGULATORY"
  | "DRUG_SAFETY"
  | "RESEARCH_SCIENCE"
  | "MANUFACTURING_ENGINEERING"
  | "QUALITY"
  | "MARKET_ACCESS_GOVERNMENT"
  | "DATA_IT"
  | "SUPPLY_CHAIN_PROCUREMENT"
  | "CORPORATE_FUNCTIONS"
  | "OTHER";

export type PrismaRequiredJobFieldName = "COMPANY" | "TITLE" | "OFFICIAL_URL" | "LOCATION";
export type PrismaLifecycleStatusName = "ACTIVE" | "SUSPECTED_OFFLINE" | "OFFLINE";

const JOB_CATEGORY_TO_PRISMA = {
  销售: "SALES",
  市场: "MARKETING",
  商务: "BUSINESS",
  渠道: "CHANNEL",
  KA: "KA",
  医学事务: "MEDICAL_AFFAIRS",
  临床运营: "CLINICAL_OPERATIONS",
  注册: "REGULATORY",
  "药物警戒/安全": "DRUG_SAFETY",
  "研发/科学": "RESEARCH_SCIENCE",
  "生产/工程": "MANUFACTURING_ENGINEERING",
  质量: "QUALITY",
  "市场准入/政府事务": "MARKET_ACCESS_GOVERNMENT",
  "数据/IT": "DATA_IT",
  "供应链/采购": "SUPPLY_CHAIN_PROCUREMENT",
  职能: "CORPORATE_FUNCTIONS",
  其他: "OTHER"
} as const satisfies Record<JobCategory, PrismaJobCategoryName>;

const REQUIRED_FIELD_TO_PRISMA = {
  company: "COMPANY",
  title: "TITLE",
  officialUrl: "OFFICIAL_URL",
  location: "LOCATION"
} as const satisfies Record<RequiredJobField, PrismaRequiredJobFieldName>;

const LIFECYCLE_TO_PRISMA = {
  ACTIVE: "ACTIVE",
  SUSPECTED_OFFLINE: "SUSPECTED_OFFLINE",
  OFFLINE: "OFFLINE"
} as const satisfies Record<LifecycleStatus, PrismaLifecycleStatusName>;

export function toPrismaJobCategory(category: JobCategory): PrismaJobCategoryName {
  return JOB_CATEGORY_TO_PRISMA[category];
}

export function toPrismaRequiredJobField(field: RequiredJobField): PrismaRequiredJobFieldName {
  return REQUIRED_FIELD_TO_PRISMA[field];
}

export function toPrismaLifecycleStatus(status: LifecycleStatus): PrismaLifecycleStatusName {
  return LIFECYCLE_TO_PRISMA[status];
}
