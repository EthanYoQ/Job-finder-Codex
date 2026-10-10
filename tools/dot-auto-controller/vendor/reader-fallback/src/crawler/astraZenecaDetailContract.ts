import { z } from 'zod';

/** Exact production profile policy. Runtime source limits do not change global defaults. */
export const ASTRAZENECA_DETAIL_CONFIG = Object.freeze({
  policy: 'ASTRAZENECA_OWNED_DETAILS_V1' as const,
  extractor: 'ASTRAZENECA_JOBPOSTING_DOM_V1' as const,
  maxDetails: 375, maxBodyBytes: 256 * 1024, maxRetainedBytes: 24 * 1024 * 1024,
  concurrency: 2 as const, httpTimeoutMs: 45_000, sourceTimeoutMs: 600_000, abortDrainMs: 30_000,
  pendingCity: '城市待核' as const,
  scopeReview: 'EXPLICIT_EARLY_CAREER_V1' as const,
  publishedDate: 'CALENDAR_DAY_EVIDENCE_ONLY_V1' as const
});
export const ASTRAZENECA_DETAIL_PLAN_SHA256 = 'ed85e5a1e4798e4393003cccd6899db986a90c9ff180e95425a63e622cd8ccc5';
/** A sort encoding is NOT an observed instant. Do not assign it to
 * officialPublishedAt until the display/storage precision contract is reviewed. */
export const astraZenecaPostedDaySchema = z.object({
  raw: z.string().min(1), calendarDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  precision: z.literal('DAY'), canonicalSortEncoding: z.string().datetime()
}).strict();
export type AstraZenecaPostedDay = z.infer<typeof astraZenecaPostedDaySchema>;
const employmentTypeSchema=z.union([z.string().min(1),z.array(z.string().min(1)).min(1)]);
const dateConflictSchema=z.object({status:z.literal('UNKNOWN'),schemaRaw:z.string().min(1),visibleRaw:z.string().min(1)}).strict();
const applicationSchema=z.object({artifactLogicalKey:z.string().min(1),bodySha256:z.string().regex(/^[a-f0-9]{64}$/u),officialUrl:z.string().url(),positionId:z.string().min(1),locationRaw:z.literal('全国')}).strict();
const scopeReviewSchema=z.array(z.enum(['TITLE_EARLY_CAREER','EMPLOYMENT_INTERNSHIP','CATEGORY_EARLY_CAREER']));
export const astraZenecaDetailClaimSchema = z.object({
  sourceJobId: z.string().regex(/^\d+$/u), requisitionId: z.string().regex(/^TP\d+$/u),
  officialUrl: z.string().url(), officialTitle: z.string().min(1), bodySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  locations: z.array(z.object({visibleRaw:z.string().min(1),schemaRaw:z.object({city:z.string(),region:z.string(),country:z.string().min(1)}).strict().optional(),city:z.string().optional(),conflict:z.literal(true).optional()}).strict()).min(1).max(100),
  cities:z.array(z.string().min(1)).min(1), locationStatus:z.enum(['CITY_SPECIFIC','CITY_PENDING']),
  postedDay:astraZenecaPostedDaySchema.optional(),dateConflict:dateConflictSchema.optional(),application:applicationSchema.optional()
  ,employmentTypeRaw:employmentTypeSchema.optional(),occupationalCategoryRaw:employmentTypeSchema.optional(),scopeReviewCodes:scopeReviewSchema
}).strict();
export type AstraZenecaDetailClaim = z.infer<typeof astraZenecaDetailClaimSchema>;
export const astraZenecaFailureSchema = z.enum(['DETAIL_URL_INVALID','DETAIL_RESPONSE_INVALID','DETAIL_BODY_TOO_LARGE','DETAIL_TRANSPORT_FAILED','DETAIL_CANCELLED','DETAIL_BOT_BLOCKED','DETAIL_NOT_ATTEMPTED_AFTER_BLOCK','DETAIL_RETAINED_BUDGET_EXCEEDED','DETAIL_PARSE_INVALID','DETAIL_IDENTITY_INVALID','DETAIL_LOCATION_INVALID','DETAIL_COUNTRY_INVALID','DETAIL_DATE_INVALID','DETAIL_APPLICATION_REQUIRED','DETAIL_APPLICATION_INVALID']);
export type AstraZenecaFailure = z.infer<typeof astraZenecaFailureSchema>;
export const astraZenecaDetailEnvelopeSchema = z.object({
  schemaVersion:z.literal('astrazeneca-owned-details-v1'),policy:z.literal(ASTRAZENECA_DETAIL_CONFIG.policy),
  sourceConfigSha256:z.string().regex(/^[a-f0-9]{64}$/u),
  listArtifactLogicalKeys:z.array(z.string().min(1)).min(1).max(25),
  entries:z.array(z.object({sourceJobId:z.string().regex(/^\d+$/u),officialUrl:z.string().url(),artifactLogicalKey:z.string().min(1).optional(),applicationArtifactLogicalKey:z.string().min(1).optional(),
    outcome:z.discriminatedUnion('ok',[
      z.object({ok:z.literal(true),evidence:astraZenecaDetailClaimSchema}).strict(),
      z.object({ok:z.literal(false),code:astraZenecaFailureSchema}).strict()
    ])}).strict()).max(ASTRAZENECA_DETAIL_CONFIG.maxDetails)
}).strict();
export const astraZenecaJobEvidenceSchema = z.object({
  country:z.literal('中国').optional(),sourceCountryContext:z.literal('中国').optional(),status:z.enum(['CITY_SPECIFIC','CITY_PENDING','UNRESOLVED']),
  listLocationRaw:z.string().min(1),artifactLogicalKey:z.string().min(1).optional(),
  bodySha256:z.string().regex(/^[a-f0-9]{64}$/u).optional(),requisitionId:z.string().optional(),
  detailLocations:astraZenecaDetailClaimSchema.shape.locations.optional(),
  postedDay:astraZenecaPostedDaySchema.optional(),dateConflict:dateConflictSchema.optional(),application:applicationSchema.optional(),failureCode:astraZenecaFailureSchema.optional()
  ,employmentTypeRaw:employmentTypeSchema.optional(),occupationalCategoryRaw:employmentTypeSchema.optional(),scopeReviewCodes:scopeReviewSchema.optional()
}).strict();
