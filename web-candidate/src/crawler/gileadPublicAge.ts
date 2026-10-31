import { z } from "zod";
import { CITY_PENDING } from "../domain/jobLocation";
import type { SourceCrawlPlan } from "./sourcePlan";

/** Frozen-cohort preservation only. No age exclusion, inferred year, or exact timestamp. */
export const GILEAD_PUBLIC_AGE_POLICY = "GILEAD_PUBLIC_AGE_PRESERVATION_V1" as const;
export const GILEAD_YELLO_BOARD = "v42vD4vKxb3AkKvV93YsrQ";

const ageClassificationSchema = z.discriminatedUnion("kind", [
  z.object({kind: z.literal("RELATIVE_WEEKS"), amount: z.number().int().positive().safe()}).strict(),
  z.object({kind: z.literal("RELATIVE_YEARS"), amount: z.number().int().positive().safe()}).strict(),
  z.object({kind: z.literal("YEARLESS_MONTH_DAY"), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31)}).strict()
]);
export const gileadPublicAgeEvidenceSchema = z.object({
  policy: z.literal(GILEAD_PUBLIC_AGE_POLICY),
  rawLabel: z.string().min(1),
  classification: ageClassificationSchema,
  exactDateStatus: z.literal("UNKNOWN"),
  timeWindowStatus: z.literal("TIME_WINDOW_UNAVAILABLE"),
  capturedAt: z.string().datetime(),
  artifactLogicalKey: z.string().min(1),
  rowLocator: z.string().min(1),
  rowSha256: z.string().regex(/^[0-9a-f]{64}$/u)
}).strict();
export type GileadPublicAgeClassification = z.infer<typeof ageClassificationSchema>;
export type GileadPublicAgeEvidence = z.infer<typeof gileadPublicAgeEvidenceSchema>;

/** Grammar deliberately limited to reviewed public labels; rounding and year are unknown.
 * February 29 is plausible in an unknown year. Observation month/day never supplies that year. */
export function classifyGileadPublicAge(rawLabel: string): GileadPublicAgeClassification | undefined {
  const label = rawLabel.trim();
  const relative = /^([1-9]\d*)(w|y)$/u.exec(label);
  if (relative) {
    const amount = Number(relative[1]);
    return Number.isSafeInteger(amount)
      ? {kind: relative[2] === "w" ? "RELATIVE_WEEKS" : "RELATIVE_YEARS", amount} : undefined;
  }
  const date = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12]\d|3[01])$/u.exec(label);
  if (!date) return undefined;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(date[1]!) + 1;
  const day = Number(date[2]);
  return day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
    ? {kind: "YEARLESS_MONTH_DAY", month, day} : undefined;
}

export function exactGileadPublicAgePlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "yello-job-board") return false;
  const fields = plan.json.fields;
  return plan.source.id === "source-gilead-china-social" && plan.company.id === "company-gilead-china" &&
    plan.source.companyId === plan.company.id && plan.source.kind === "SOCIAL" && plan.source.atsKind === "OFFICIAL_JSON" &&
    plan.source.officialEntryUrl === `https://gilead.yello.co/job_boards/${GILEAD_YELLO_BOARD}` &&
    plan.source.officialChainEvidenceUrl === "https://www.gilead.com/careers/opportunities" &&
    plan.officialJsonFetch.boardId === GILEAD_YELLO_BOARD && plan.officialJsonFetch.locationFilterId === 72 &&
    plan.officialJsonFetch.expectedLocationLabel === "China" && plan.officialJsonFetch.publicAgePolicy === GILEAD_PUBLIC_AGE_POLICY &&
    !plan.workday && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource &&
    plan.json.jobsPath === "jobs" && fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" &&
    fields.officialUrl === "officialUrl" && fields.locationRaw === "locationRaw" && fields.cities === "cities" &&
    fields.officialPublishedAt === undefined && fields.category === undefined && fields.auxiliaryChineseTitle === undefined &&
    (plan.json.defaultCategory === undefined || plan.json.defaultCategory === "其他");
}

// Preserve existing named-city coverage, but a substring or conflicting locality cannot establish a city.
const CITY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"], ["Beijing", "北京"], ["Changsha", "长沙"], ["Changchun", "长春"], ["Chongqing", "重庆"],
  ["Daqing", "大庆"], ["Suzhou", "苏州"], ["Dongguan", "东莞"], ["Shenzhen", "深圳"], ["Guangzhou", "广州"],
  ["Hangzhou", "杭州"], ["Kashi", "喀什"], ["Leshan", "乐山"], ["Nanjing", "南京"], ["Nanning", "南宁"],
  ["Nantong", "南通"], ["Ningde", "宁德"], ["Songyuan", "松原"], ["Wuhan", "武汉"], ["Chengdu", "成都"],
  ["Urumqi", "乌鲁木齐"], ["Wulumuqi", "乌鲁木齐"], ["Wenzhou", "温州"], ["Tonghua", "通化"], ["Xining", "西宁"],
  ["Zhuhai", "珠海"], ["Tianjin", "天津"], ["Lanzhou", "兰州"], ["Taiyuan", "太原"], ["Yancheng", "盐城"]
];
export function gileadOfficialCities(locationRaw: string): string[] {
  const locality = locationRaw.replace(/^China - /u, "").trim().toLowerCase();
  const alias = CITY_ALIASES.find(([english, chinese]) => locality === english.toLowerCase() || locality === chinese || locality === `${chinese}市`);
  return [alias?.[1] ?? CITY_PENDING];
}
