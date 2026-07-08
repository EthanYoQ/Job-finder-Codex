import { z } from "zod";
import type { ATSKind } from "../domain/company";
import { JOB_CATEGORIES, type JobCategory } from "../domain/search";

const ATS_KIND_VALUES = [
  "OFFICIAL_HTML",
  "OFFICIAL_JSON",
  "MOKA",
  "BEISEN_ZHIYE",
  "WORKDAY",
  "HOTJOB_WECRUIT",
  "SUCCESSFACTORS",
  "REDSEA",
  "BROWSER_FALLBACK",
  "UNKNOWN"
] as const satisfies readonly [ATSKind, ...ATSKind[]];

const AtsKindSchema = z.enum(ATS_KIND_VALUES) satisfies z.ZodType<ATSKind>;
const JobCategorySchema = z.enum(JOB_CATEGORIES) satisfies z.ZodType<JobCategory>;

export const CrawlEvidenceSchema = z.object({
  officialEntryUrl: z.string().url(),
  officialChainEvidenceUrl: z.string().url(),
  capturedAt: z.string().datetime(),
  rawSnapshotRef: z.string().optional()
});

export const NormalizedJobRecordSchema = z.object({
  companyId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceKind: z.literal("SOCIAL"),
  atsKind: AtsKindSchema,
  officialChineseCompanyName: z.string().min(1),
  officialTitle: z.string().min(1),
  auxiliaryChineseTitle: z.string().min(1).optional(),
  officialUrl: z.string().url(),
  listUrl: z.string().url().optional(),
  sourceJobId: z.string().min(1).optional(),
  locationRaw: z.string().min(1),
  cities: z.array(z.string().min(1)).min(1),
  category: JobCategorySchema,
  officialPublishedAt: z.string().datetime().optional(),
  isBaseline: z.boolean(),
  evidence: CrawlEvidenceSchema
});

export type NormalizedJobRecord = z.infer<typeof NormalizedJobRecordSchema>;

export function hasRequiredJobFields(record: NormalizedJobRecord): boolean {
  return Boolean(
    record.officialChineseCompanyName &&
      record.officialTitle &&
      record.officialUrl &&
      record.locationRaw &&
      record.cities.length > 0
  );
}

export function buildJobDedupeKey(record: NormalizedJobRecord): string {
  return `${record.sourceId}:${record.sourceJobId ?? record.officialUrl}`;
}
