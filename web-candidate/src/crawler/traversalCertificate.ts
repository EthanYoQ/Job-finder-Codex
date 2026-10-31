import { sanofiPersistentJobId } from "./sanofiLegacyIdentity";
import { isServierTraversalPlan, replayServierTraversal } from "./servierMokaScope";
import { sanofiRawEvidenceId, isSanofiChinesePlan, parseSanofiChineseDetail, parseSanofiChineseNative, replaySanofiChineseNative, SANOFI_CN_PAGINATION_POLICY, type SanofiChineseRow } from "./sanofiChineseNative";
import { sanofiChineseIndependentObservedAt, sanofiChineseIndependentFinishedAt,replaySanofiChineseIndependent } from "./sanofiChineseRenderedTraversal";
import { servierHybridObservedAt, servierHybridFinishedAt } from "./servierMokaRenderedTraversal";
import { isPfizerWorkdayTraversalPlan, replayPfizerWorkdayTraversal, pfizerMainSourceJobIds, PFIZER_PAGINATION_POLICY } from "./pfizerWorkdayTraversal";
import { isBayerMedicalTraversalPlan, replayBayerMedicalTraversal } from "./bayerMokaScope";
import { bayerHybridObservedAt, bayerHybridFinishedAt } from "./bayerMokaRenderedTraversal";
import { createHash } from "node:crypto";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { z } from "zod";
import { assertAdapterReconciliation } from "./adapters/reconciliation";
import type { AdapterReconciliation } from "./adapters/types";
import { buildJobDedupeKey, type NormalizedJobRecord } from "./normalizedJob";
import { evaluatePaginationEvidence, type PaginationEvaluation } from "./paginationEvidence";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import {
  canonicalPageTraceSha256,
  canonicalStringSetSha256,
  parsePersistentSourceFetchEvidence,
  type PersistentSourceFetchEvidence
} from "./sourceFetchEvidence";
import { acquireBrowserSourcePermit } from "./browserSourceConcurrency";
import { createAbortableClose } from "./officialHttpRuntimeLimits";
import { tagBGradeIndependentTraversalFailure } from "./independentTraversalDiagnostics";
import {
  strictQiluRawOfficialUrls,
  validateStrictSourceScopeExclusionProof
} from "./strictSourceScopeExclusionProof";
import {
  isStrictQiluOfficialJobUrl,
  qiluRenderedScopeDecision
} from "./qiluRenderedTraversalValidator";
import { irreversibleOfficialJsonEvidenceId } from "./officialJsonEvidence";
import {
  assertPlanBoundHtmlValidationMatchKey,
  capturePlanBoundHtmlRenderedTraversal,
  isPlanBoundHtmlTraversalSourceId,
  PLAN_BOUND_HTML_REQUIRED_CERTIFICATES,
  PLAN_BOUND_HTML_TRAVERSAL_POLICIES,
  PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS,
  type PlanBoundHtmlTraversalSourceId
} from "./planBoundHtmlTraversalValidator";
import { validateStrictHtmlCompletenessProof } from "./strictHtmlCompletenessProof";
import { companyRecruitmentExecutionConfigsBySourceId } from "./companyRecruitmentProfiles";
import {
  captureOfficialJsonRenderedTraversal,
  isOfficialJsonRenderedTraversalSourceId,
  OFFICIAL_JSON_RENDERED_REQUIRED_CERTIFICATES,
  OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES,
  OFFICIAL_JSON_RENDERED_TRAVERSAL_SOURCE_IDS,
  replayOfficialJsonRenderedTraversal,
  type OfficialJsonRenderedRawRow,
  type OfficialJsonRenderedTraversalSourceId
} from "./officialJsonRenderedTraversalValidator";

export const B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION =
  "b-grade-independent-traversal-v2" as const;
export const SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION = "sanofi-cn-dual-chain-attestation-v1" as const;
export const BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION = "bayer-cn-dual-chain-attestation-v1" as const;
export const SANOFI_INDEPENDENT_ORIGINAL_LOCATOR = "sanofi-cn-independent-original-v1" as const;
export function isCurrentBGradeCertificateSchema(value: unknown): value is typeof B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION | typeof SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION | typeof BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION {
  return value===B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION||value===SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION||value===BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION;
}

export const REQUIRED_B_GRADE_TRAVERSAL_CERTIFICATES = Object.freeze({
  "source-viatris-social": "company-viatris",
  ...OFFICIAL_JSON_RENDERED_REQUIRED_CERTIFICATES,
  ...PLAN_BOUND_HTML_REQUIRED_CERTIFICATES
} as const);

const B_GRADE_VALIDATOR_POLICIES = Object.freeze({
  "source-viatris-social": {
    companyId: "company-viatris",
    retrievalPath: "PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION",
    validatorImplementationId: "viatris-playwright-ui-traversal-v1",
    mainRetrievalPath: "HTTP_TUPU360_ENTRY_PLUS_POST",
    matchKeyKind: "SOURCE_JOB_ID",
    artifactLogicalKey: "viatris-browser-traversal-validation"
  },
  ...PLAN_BOUND_HTML_TRAVERSAL_POLICIES,
  ...OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES
} as const);

const LEGACY_QILU_RENDERED_VALIDATOR_POLICY = Object.freeze({
  companyId: "company-qilu",
  retrievalPath: "PLAYWRIGHT_BEISEN_RENDERED_UI_CLICK_PAGINATION",
  validatorImplementationId: "qilu-playwright-rendered-ui-traversal-v1",
  mainRetrievalPath: "HTTP_BEISEN_JOBAD_PAGINATION",
  matchKeyKind: "OFFICIAL_URL",
  artifactLogicalKey: "qilu-browser-traversal-validation"
} as const);

export const B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS = 7 * 24 * 60 * 60 * 1000;
export const B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS = 60 * 60 * 1000;

export type BGradeValidationTrigger =
  | "INITIAL_QUALIFICATION"
  | "CONFIG_CHANGED"
  | "ANOMALY_TRIGGERED"
  | "STABLE_RUN";

export type BGradeCertificateBlockerCode =
  | "UNSUPPORTED_SOURCE"
  | "SCOPE_MISMATCH"
  | "TRANSPORT_OR_ADAPTER_FAILED"
  | "SOURCE_CONFIG_MISMATCH"
  | "MAIN_TRAVERSAL_INCOMPLETE"
  | "LOSSY_PIPELINE"
  | "OUTPUT_MISMATCH"
  | "INDEPENDENT_VALIDATION_INVALID"
  | "VALIDATOR_PATH_NOT_INDEPENDENT"
  | "INDEPENDENT_JOB_SET_MISMATCH"
  | "VALIDATION_REFRESH_REQUIRED"
  | "VALIDATION_EXPIRED";

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/u);
const NONBLANK = z.string().trim().min(1);
const ISO = z.string().datetime({ offset: true });
const legacyBrowserPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  declaredTotalPages: z.number().int().positive(),
  sourceJobIds: z.array(NONBLANK),
  nextControlPresent: z.boolean()
}).strict();
const browserPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  declaredTotalPages: z.number().int().positive(),
  matchKeys: z.array(NONBLANK),
  nextControlPresent: z.boolean()
}).strict();
const qiluRawRowSchema = z.object({
  officialUrl: z.string().url(),
  locationRaw: NONBLANK,
  scopeDecision: z.enum(["INCLUDED_MAINLAND", "EXCLUDED_FOREIGN"])
}).strict();
const qiluBrowserPageSchema = browserPageSchema.extend({ rawRows: z.array(qiluRawRowSchema).min(1) }).strict();
const officialJsonRenderedRawRowSchema = z.object({
  sourceJobId: NONBLANK,
  rawEvidenceId: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  scopeMarker: NONBLANK,
  scopeDecision: z.enum(["INCLUDED_MAINLAND", "EXCLUDED_AUDITED"]),
  recordIndex: z.number().int().nonnegative(),
  rawPayload: z.record(z.string(), z.unknown())
}).strict();
const officialJsonRenderedPageSchema = browserPageSchema.extend({
  channelId: NONBLANK,
  declaredTotalJobs: z.number().int().positive(),
  uiRequestCandidateIds: z.array(NONBLANK),
  rawRows: z.array(officialJsonRenderedRawRowSchema).min(1)
}).strict();
const planBoundHtmlPartitionSchema = z.object({
  controlIndex: z.number().int().positive(),
  controlId: NONBLANK,
  matchKeys: z.array(NONBLANK).min(1)
}).strict();
const renderedValidationFields = {
  sourceConfigSha256: SHA256,
  surfaceIds: z.array(NONBLANK).min(1),
  channelIds: z.array(NONBLANK).min(1),
  pages: z.array(browserPageSchema).min(1),
  pageCount: z.number().int().positive(),
  canonicalMatchKeySetSha256: SHA256,
  artifactLogicalKey: NONBLANK,
  artifactSha256: SHA256,
  observedAt: ISO,
  expiresAt: ISO
} as const;
const legacyViatrisBrowserValidationSchema = z.object({
  schemaVersion: z.literal("viatris-browser-traversal-validator-v1"),
  sourceId: z.literal("source-viatris-social"),
  companyId: z.literal("company-viatris"),
  retrievalPath: z.literal("PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION"),
  validatorImplementationId: z.literal("viatris-playwright-ui-traversal-v1"),
  sourceConfigSha256: SHA256,
  surfaceIds: z.array(NONBLANK).min(1),
  channelIds: z.array(NONBLANK).min(1),
  pages: z.array(legacyBrowserPageSchema).min(1),
  pageCount: z.number().int().positive(),
  canonicalJobIdSetSha256: SHA256,
  artifactLogicalKey: z.literal("viatris-browser-traversal-validation"),
  artifactSha256: SHA256,
  observedAt: ISO,
  expiresAt: ISO
}).strict();
const viatrisBrowserValidationSchema = z.object({
  schemaVersion: z.literal("viatris-browser-traversal-validator-v2"),
  sourceId: z.literal("source-viatris-social"),
  companyId: z.literal("company-viatris"),
  retrievalPath: z.literal("PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION"),
  validatorImplementationId: z.literal("viatris-playwright-ui-traversal-v1"),
  matchKeyKind: z.literal("SOURCE_JOB_ID"),
  ...renderedValidationFields,
  artifactLogicalKey: z.literal("viatris-browser-traversal-validation")
}).strict();
const qiluBrowserValidationSchema = z.object({
  schemaVersion: z.literal("qilu-browser-traversal-validator-v2"),
  sourceId: z.literal("source-qilu-social"),
  companyId: z.literal("company-qilu"),
  retrievalPath: z.literal("PLAYWRIGHT_BEISEN_RENDERED_UI_CLICK_PAGINATION"),
  validatorImplementationId: z.literal("qilu-playwright-rendered-ui-traversal-v1"),
  matchKeyKind: z.literal("OFFICIAL_URL"),
  ...renderedValidationFields,
  pages: z.array(qiluBrowserPageSchema).min(1),
  artifactLogicalKey: z.literal("qilu-browser-traversal-validation")
}).strict();
const planBoundHtmlBrowserPageSchema = browserPageSchema.extend({
  rawMatchKeys: z.array(NONBLANK),
  partitions: z.array(planBoundHtmlPartitionSchema).min(1).optional()
}).strict();
const planBoundTalentbrewBrowserPageSchema = browserPageSchema.extend({
  channelId: NONBLANK,
  declaredTotalJobs: z.number().int().nonnegative(),
  rawMatchKeys: z.array(NONBLANK)
}).strict();
const planBoundHtmlBrowserValidationSchema = z.object({
  schemaVersion: z.literal("plan-bound-html-browser-traversal-v1"),
  sourceId: z.enum(PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS as unknown as
    [PlanBoundHtmlTraversalSourceId, ...PlanBoundHtmlTraversalSourceId[]]),
  companyId: NONBLANK,
  retrievalPath: z.literal("PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL"),
  validatorImplementationId: z.literal("plan-bound-html-playwright-traversal-v1"),
  matchKeyKind: z.enum(["SOURCE_JOB_ID", "OFFICIAL_URL", "JOB_DEDUPE_KEY"]),
  ...renderedValidationFields,
  pages: z.array(planBoundHtmlBrowserPageSchema).min(1),
  artifactLogicalKey: NONBLANK
}).strict();
const planBoundTalentbrewBrowserValidationSchema = z.object({
  schemaVersion: z.literal("plan-bound-html-browser-traversal-v2"),
  sourceId: z.enum(PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS as unknown as
    [PlanBoundHtmlTraversalSourceId, ...PlanBoundHtmlTraversalSourceId[]]),
  companyId: NONBLANK,
  retrievalPath: z.literal("PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL"),
  validatorImplementationId: z.literal("plan-bound-html-playwright-traversal-v2"),
  matchKeyKind: z.literal("JOB_DEDUPE_KEY"),
  ...renderedValidationFields,
  pages: z.array(planBoundTalentbrewBrowserPageSchema).min(1),
  artifactLogicalKey: NONBLANK
}).strict();
const officialJsonRenderedValidationSchema = z.object({
  schemaVersion: z.literal("official-json-browser-network-traversal-v1"),
  sourceId: z.enum(OFFICIAL_JSON_RENDERED_TRAVERSAL_SOURCE_IDS as unknown as
    [OfficialJsonRenderedTraversalSourceId, ...OfficialJsonRenderedTraversalSourceId[]]),
  companyId: NONBLANK,
  retrievalPath: z.enum(["PLAYWRIGHT_OFFICIAL_UI_NETWORK_TRAVERSAL", "PLAYWRIGHT_OFFICIAL_UI_JSONLD_TRAVERSAL", "CUA_DOM_LIST_PLUS_INDEPENDENT_HTTP_DETAILS", "CUA_CHINESE_DOM_LIST_PLUS_NEW_NATIVE_HTTP"]),
  validatorImplementationId: NONBLANK,
  matchKeyKind: z.literal("SOURCE_JOB_ID"),
  ...renderedValidationFields,
  pages: z.array(officialJsonRenderedPageSchema).min(1),
  artifactLogicalKey: NONBLANK
}).strict();
const browserValidationSchema = z.discriminatedUnion("schemaVersion", [
  legacyViatrisBrowserValidationSchema,
  viatrisBrowserValidationSchema,
  qiluBrowserValidationSchema,
  officialJsonRenderedValidationSchema,
  planBoundHtmlBrowserValidationSchema,
  planBoundTalentbrewBrowserValidationSchema
]);

export type BGradeIndependentTraversalValidation = z.infer<typeof browserValidationSchema>;
export type ViatrisBrowserTraversalValidation = z.infer<typeof viatrisBrowserValidationSchema>;

export function parseBGradeIndependentTraversalValidation(
  value: unknown
): BGradeIndependentTraversalValidation {
  const validation = browserValidationSchema.parse(value);
  assertBrowserValidationEquations(validation);
  return validation;
}

type PlanBoundBrowserTraversalValidation = Extract<BGradeIndependentTraversalValidation, {
  schemaVersion: "plan-bound-html-browser-traversal-v1" | "plan-bound-html-browser-traversal-v2";
}>;

function isPlanBoundBrowserTraversalValidation(
  validation: BGradeIndependentTraversalValidation
): validation is PlanBoundBrowserTraversalValidation {
  return validation.schemaVersion === "plan-bound-html-browser-traversal-v1" ||
    validation.schemaVersion === "plan-bound-html-browser-traversal-v2";
}

function isPlanBoundTalentbrewBrowserTraversalValidation(
  validation: BGradeIndependentTraversalValidation
): validation is Extract<BGradeIndependentTraversalValidation, {
  schemaVersion: "plan-bound-html-browser-traversal-v2";
}> {
  return validation.schemaVersion === "plan-bound-html-browser-traversal-v2";
}

export function readReusableBGradeTraversalValidation(input: {
  certificate: unknown;
  certificateSha256: string;
  sourceConfigSha256: string;
  now: Date;
}): BGradeIndependentTraversalValidation {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new Error("B-grade validation reuse requires a valid current time");
  }
  const certificate = certificateSchema.parse(input.certificate);
  if (certificate.binding.sourceId === "source-sanofi-china-social") throw new Error("Sanofi requires CURRENT_RUN Chinese DOM and native detail traversal");
  if (certificate.binding.sourceId === "source-servier-china-social") throw new Error("Servier requires CURRENT_RUN independent DOM and detail traversal");
  if (certificate.binding.sourceId === "source-pfizer-china-social") throw new Error("Pfizer requires CURRENT_RUN independent UI traversal");
  if (!SHA256.safeParse(input.certificateSha256).success ||
      sha256(canonicalJson(certificate)) !== input.certificateSha256) {
    throw new Error("B-grade traversal certificate hash mismatch");
  }
  if (certificate.binding.sourceConfigSha256 !== input.sourceConfigSha256 ||
      certificate.independentValidation.sourceConfigSha256 !== input.sourceConfigSha256) {
    throw new Error("B-grade traversal certificate source config mismatch");
  }
  const policy = bGradePolicy(certificate.binding.sourceId);
  if (!policy || certificate.scope.companyId !== policy.companyId ||
      certificate.independentValidation.sourceId !== certificate.binding.sourceId ||
      certificate.independentValidation.companyId !== policy.companyId) {
    throw new Error("B-grade traversal certificate registered source binding mismatch");
  }
  assertBrowserValidationEquations(certificate.independentValidation);
  assertCertificateValidationSetEquations(certificate);
  const observedAt = Date.parse(certificate.independentValidation.observedAt);
  const expiresAt = Date.parse(certificate.independentValidation.expiresAt);
  if (observedAt > input.now.getTime() || expiresAt < input.now.getTime() ||
      expiresAt - observedAt > B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS) {
    throw new Error("B-grade traversal validation is expired or temporally invalid");
  }
  return certificate.independentValidation;
}

export const readReusableViatrisTraversalValidation = readReusableBGradeTraversalValidation;

export function bGradeTraversalValidationMatchesCurrentJobs(
  validation: BGradeIndependentTraversalValidation,
  jobs: readonly NormalizedJobRecord[]
): boolean {
  const parsed = browserValidationSchema.safeParse(validation);
  if (!parsed.success) return false;
  const keys = independentMatchKeys(parsed.data.sourceId, jobs);
  return keys !== undefined && keys.length === jobs.length &&
    validationMatchKeySetSha256(parsed.data) === canonicalStringSetSha256(keys);
}

export const viatrisTraversalValidationMatchesCurrentJobs = bGradeTraversalValidationMatchesCurrentJobs;

export interface ViatrisRenderedUiPageCapture {
  pageNumber: number;
  declaredTotalPages: number;
  sourceJobIds: string[];
  nextControlPresent: boolean;
}

export type ViatrisRenderedUiCapture = (input: {
  entryUrl: string;
  signal?: AbortSignal;
}) => Promise<{ observedAt: string; pages: ViatrisRenderedUiPageCapture[] }>;

type ViatrisRenderedPaginationControl = Readonly<{
  action: string | null;
  pageNumber: string | null;
  pageSize: string | null;
}>;

export function __testOnlyViatrisNextRenderedControlIndex(
  controls: readonly ViatrisRenderedPaginationControl[],
  nextPageNumber: number
): number {
  if (!Number.isSafeInteger(nextPageNumber) || nextPageNumber < 2) {
    throw new Error("Viatris browser validator next page number invalid");
  }
  let declaredPageSize: number | undefined;
  const matching: number[] = [];
  for (const [index, control] of controls.entries()) {
    const pageNumber = control.pageNumber && /^\d+$/u.test(control.pageNumber)
      ? Number(control.pageNumber)
      : Number.NaN;
    const pageSize = control.pageSize && /^[1-9]\d*$/u.test(control.pageSize)
      ? Number(control.pageSize)
      : Number.NaN;
    if (control.action !== "pageTurn" || !Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1) {
      throw new Error("Viatris browser validator page control invalid");
    }
    if (declaredPageSize !== undefined && declaredPageSize !== pageSize) {
      throw new Error("Viatris browser validator page-size declaration changed");
    }
    declaredPageSize = pageSize;
    if (pageNumber === nextPageNumber) matching.push(index);
  }
  return matching[0] ?? -1;
}

const legacyCertificateSchema = z.object({
  schemaVersion: z.literal("b-grade-independent-traversal-v1"),
  grade: z.literal("B"),
  binding: z.object({
    releaseCandidateId: NONBLANK, batchId: NONBLANK, sourceResultId: NONBLANK,
    sourceId: z.literal("source-viatris-social"), sourceConfigSha256: SHA256
  }).strict(),
  scope: z.object({
    companyId: z.literal("company-viatris"), sourceId: z.literal("source-viatris-social"),
    recruitmentType: z.literal("SOCIAL"), geography: z.literal("MAINLAND_CHINA"),
    businessUnit: z.literal("ALL"), surfaceIds: z.array(NONBLANK).min(1), channelIds: z.array(NONBLANK).min(1)
  }).strict(),
  mainTraversal: z.object({
    retrievalPath: z.literal("HTTP_TUPU360_ENTRY_PLUS_POST"), pageCount: z.number().int().positive(),
    terminalEvent: z.enum(["NEXT_ABSENT", "EMPTY_PAGE"]), paginationTraceSha256: SHA256,
    canonicalJobIdSetSha256: SHA256
  }).strict(),
  independentValidation: legacyViatrisBrowserValidationSchema,
  validationPolicy: z.object({
    trigger: z.enum(["INITIAL_QUALIFICATION", "CONFIG_CHANGED", "ANOMALY_TRIGGERED", "STABLE_RUN"]),
    execution: z.enum(["CURRENT_RUN", "REUSED"])
  }).strict(),
  counts: z.object({
    mainUniqueJobCount: z.number().int().nonnegative(), independentUniqueJobCount: z.number().int().nonnegative(),
    finalUniqueJobCount: z.number().int().nonnegative(), parseDiscardCount: z.literal(0),
    validationDiscardCount: z.literal(0), normalizationDiscardCount: z.literal(0), dedupeDiscardCount: z.literal(0)
  }).strict(),
  output: z.object({
    canonicalJobSetSha256: SHA256, adapterReconciliationSha256: SHA256, collisionLedgerSha256: SHA256
  }).strict(),
  issuedAt: ISO
}).strict();

const sanofiDecisionSchema = z.object({
  id: z.string().regex(/^\d+$/u), reqId: z.string().regex(/^R\d+$/u), sourceJobId: NONBLANK,
  state: z.enum(["PUBLISHING", "CLOSED", "OUTSIDE"]), title: NONBLANK,
  titleConflict: z.object({chineseTitle: NONBLANK,nativeTitle: NONBLANK}).strict().optional(),
  officialUrl: z.string().url(), applyUrl: z.string().url(), descriptionSha256: SHA256,
  nativePositionId: NONBLANK.nullable(), nativeDescriptionSha256: SHA256.nullable(),
  nativeLocationRaw: NONBLANK.nullable(), nativeCities: z.array(NONBLANK)
}).strict();
const sanofiHeaderAnomalySchema = z.object({
  code: z.literal("SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY"), id: NONBLANK, reqId: NONBLANK,
  officialUrl: z.string().url(), applyUrl: z.string().url(), title: NONBLANK,
  chineseDescriptionSha256: SHA256, mainArtifactBodySha256: SHA256,
  foreignId: NONBLANK, foreignReq: NONBLANK, foreignTitle: NONBLANK, foreignApplyUrl: z.string().url(),
  foreignDescriptionSha256: SHA256, foreignHeaderSha256: SHA256, foreignModuleSha256: SHA256
}).strict();
const sanofiIdentityOracleSchema = z.object({
  schemaVersion: z.literal(3),
  entries: z.array(z.discriminatedUnion("code", [
    sanofiHeaderAnomalySchema,
    z.object({code: z.literal("SANOFI_CN_FOREIGN_MAIN_MODULE"), id: NONBLANK, reqId: NONBLANK,
      foreignId: NONBLANK, foreignReq: NONBLANK.nullable(), foreignApplyUrl: z.string().url(), mainDescriptionSha256: SHA256}).strict(),
    z.object({code: z.literal("SANOFI_CN_REPLACEMENT_CHARACTER_NATIVE_AUTHORITY"), id: NONBLANK, reqId: NONBLANK,
      nativePositionId: NONBLANK, applyUrl: z.string().url(), nativeLocationRaw: NONBLANK, nativeCities: z.array(NONBLANK).min(1),
      chineseDescriptionSha256: SHA256, nativeDescriptionSha256: SHA256, normalizedUtf16Offset: z.number().int().nonnegative(),
      replacementCharacterCount: z.literal(3), nativeCharacterCount: z.literal(1)}).strict()
  ])),
  decisions: z.array(sanofiDecisionSchema).min(1),
  independentArtifactSha256: SHA256.optional()
}).strict();
// Preserve the exact, independently archived ORACLE bytes. Re-serializing its
// parsed object would erase original property order and weaken the hash binding.
const sanofiIdentityProofSchema = z.object({oracleBody: NONBLANK}).strict();
export interface SanofiArtifactCommitment {
  releaseCandidateId: string; batchId: string; sourceResultId: string; sourceId: string;
  kind: string; sha256: string; extractorLocator: string; byteCount?: number|undefined; capturedAt?: Date|string|undefined;
}
/** Query locators only. The returned list is not evidence or publication authority. */
export function sanofiCertificateArtifactLocators(value: unknown): string[] {
  if((value as {schemaVersion?:unknown}|null)?.schemaVersion===SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION)
    return sanofiCompactCertificateSchema.parse(value).artifacts.map(a=>a.extractorLocator);
  const certificate=value as {mainTraversal?:{sanofiIdentityProof?:unknown}}|null;
  const proof=sanofiIdentityProofSchema.parse(certificate?.mainTraversal?.sanofiIdentityProof);
  if(!hasUniqueJsonObjectKeys(proof.oracleBody)) throw new Error("SANOFI_CN_IDENTITY_ORACLE_INVALID");
  const oracle=sanofiIdentityOracleSchema.parse(JSON.parse(proof.oracleBody));
  return ["sanofi-cn-module-anomalies-v2",...oracle.entries.filter(a=>a.code==="SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY")
    .map(a=>requestContractV2Locator("sanofi-cn-detail-v2",{family:"html",role:"sanofi-cn-detail",method:"GET",url:a.officialUrl,body:null,coordinate:{id:a.id}}))];
}

const certificateV2Schema = z.object({
  schemaVersion: z.literal(B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION),
  grade: z.literal("B"),
  binding: z.object({
    releaseCandidateId: NONBLANK,
    batchId: NONBLANK,
    sourceResultId: NONBLANK,
    sourceId: NONBLANK,
    sourceConfigSha256: SHA256
  }).strict(),
  scope: z.object({
    companyId: NONBLANK,
    sourceId: NONBLANK,
    recruitmentType: z.literal("SOCIAL"),
    geography: z.literal("MAINLAND_CHINA"),
    businessUnit: z.literal("ALL"),
    surfaceIds: z.array(NONBLANK).min(1),
    channelIds: z.array(NONBLANK).min(1)
  }).strict(),
  mainTraversal: z.object({
    retrievalPath: NONBLANK,
    matchKeyKind: z.enum(["SOURCE_JOB_ID", "OFFICIAL_URL", "JOB_DEDUPE_KEY"]),
    pageCount: z.number().int().positive(),
    terminalEvent: z.enum(["NEXT_ABSENT", "EMPTY_PAGE", "DECLARED_TOTAL_REACHED"]),
    paginationTraceSha256: SHA256,
    canonicalMatchKeySetSha256: SHA256,
    canonicalRawMatchKeySetSha256: SHA256,
    canonicalExcludedMatchKeySetSha256: SHA256,
    sanofiIdentityProof: sanofiIdentityProofSchema.optional()
  }).strict(),
  independentValidation: browserValidationSchema,
  validationPolicy: z.object({
    trigger: z.enum(["INITIAL_QUALIFICATION", "CONFIG_CHANGED", "ANOMALY_TRIGGERED", "STABLE_RUN"]),
    execution: z.enum(["CURRENT_RUN", "REUSED"])
  }).strict(),
  counts: z.object({
    mainUniqueJobCount: z.number().int().nonnegative(),
    independentUniqueJobCount: z.number().int().nonnegative(),
    finalUniqueJobCount: z.number().int().nonnegative(),
    parseDiscardCount: z.literal(0),
    validationDiscardCount: z.number().int().nonnegative(),
    normalizationDiscardCount: z.literal(0),
    dedupeDiscardCount: z.number().int().nonnegative()
  }).strict(),
  output: z.object({
    canonicalJobSetSha256: SHA256,
    adapterReconciliationSha256: SHA256,
    collisionLedgerSha256: SHA256,
    collisionGroups: z.array(z.object({
      dedupeKeySha256: SHA256,
      candidateKeySha256: z.array(SHA256).min(2),
      winnerKeySha256: SHA256,
      droppedCount: z.number().int().positive(),
      dropReason: z.literal("DUPLICATE_DEDUPE_KEY_DETERMINISTIC_WINNER")
    }).strict()).optional()
  }).strict(),
  issuedAt: ISO
}).strict();

const certificateSchema = z.discriminatedUnion("schemaVersion", [legacyCertificateSchema, certificateV2Schema]);

const sanofiCompactArtifactSchema=z.object({kind:NONBLANK,extractorLocator:NONBLANK,sha256:SHA256,byteCount:z.number().int().positive(),capturedAt:ISO}).strict();
const sanofiCompactCertificateSchema=certificateV2Schema.extend({
  schemaVersion:z.literal(SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION),
  proofBasis:z.literal("PRE_COMMIT_DUAL_ORIGINAL_REPLAY"),
  binding:certificateV2Schema.shape.binding.extend({sourceId:z.literal("source-sanofi-china-social")}),
  mainTraversal:certificateV2Schema.shape.mainTraversal.extend({sanofiIdentityProof:sanofiIdentityProofSchema}),
  independentValidation:officialJsonRenderedValidationSchema.omit({pages:true,schemaVersion:true}).extend({
    schemaVersion:z.literal("sanofi-cn-independent-summary-v1"),finishedAt:ISO,
    originalFile:sanofiCompactArtifactSchema.extend({canonicalArtifactSha256:SHA256}).strict(),
    originals:z.array(z.object({id:NONBLANK,detailSha256:SHA256,nativeSha256:SHA256.nullable(),domSha256:SHA256}).strict()).min(1)
  }).strict(),
  artifacts:z.array(sanofiCompactArtifactSchema).min(1)
}).strict();
type FullBGradeTraversalCertificate = z.infer<typeof certificateSchema>;
export type SanofiCompactTraversalCertificate=z.infer<typeof sanofiCompactCertificateSchema>;
export type BGradeTraversalCertificate = FullBGradeTraversalCertificate | SanofiCompactTraversalCertificate;
export interface SanofiIndependentArchiveBinding {
  sha256:string;byteCount:number;canonicalArtifactSha256:string;
}


export interface BGradeCertificateCandidate {
  binding: {
    releaseCandidateId: string;
    batchId: string;
    sourceResultId: string;
    sourceConfigSha256: string;
  };
  plan: SourceCrawlPlan;
  transportSuccess: boolean;
  adapterSuccess: boolean;
  evidence: PersistentSourceFetchEvidence;
  paginationEvaluation: PaginationEvaluation;
  reconciliation: AdapterReconciliation;
  jobs: readonly NormalizedJobRecord[];
  independentValidation: unknown;
  validationExecution: "CURRENT_RUN" | "REUSED";
  trigger: BGradeValidationTrigger;
  now: Date;
  sanofiArchive?: {artifacts:readonly SanofiArtifactCommitment[];independentOriginal:SanofiIndependentArchiveBinding};
}

export type BGradeCertificateDecision =
  | { status: "CERTIFIED"; certificate: BGradeTraversalCertificate; certificateSha256: string }
  | { status: "REJECTED"; resultingGrade: "C"; blockerCodes: readonly BGradeCertificateBlockerCode[] };

export interface BGradeCertificateReceiptExpectation {
  releaseCandidateId: string;
  batchId: string;
  sourceResultId: string;
  sourceId: string;
  companyId?: string;
  sourceConfigSha256: string;
  surfaceIds?: readonly string[];
  channelIds?: readonly string[];
  canonicalJobSetSha256?: string;
  adapterReconciliationSha256?: string;
  collisionLedgerSha256?: string;
  canonicalRawEvidenceIdSetSha256?: string;
  /** Persisted artifacts from the same tuple, supplied independently of certificate JSON. */
  sanofiArtifacts?: readonly SanofiArtifactCommitment[];
}

export function requiresBGradeTraversalCertificate(plan: SourceCrawlPlan): boolean {
  if (plan.source.id === "source-sanofi-china-social") return isSanofiChinesePlan(plan);
  return plan.source.id === "source-servier-china-social" ? isServierTraversalPlan(plan) : plan.source.id === "source-pfizer-china-social" ? isPfizerWorkdayTraversalPlan(plan) :
    plan.source.id === "source-bayer-healthcare-social" ? isBayerMedicalTraversalPlan(plan) : requiresBGradeCertificateSourceId(plan.source.id);
}

export function requiresBGradeCertificateSourceId(sourceId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REQUIRED_B_GRADE_TRAVERSAL_CERTIFICATES, sourceId);
}

export function createViatrisBrowserTraversalValidation(input: {
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  pages: readonly {
    pageNumber: number;
    declaredTotalPages: number;
    channelId?: string;
    declaredTotalJobs?: number;
    sourceJobIds: readonly string[];
    nextControlPresent: boolean;
  }[];
  observedAt: string;
  expiresAt: string;
}): ViatrisBrowserTraversalValidation {
  return createRenderedTraversalValidation({
    ...input,
    pages: input.pages.map(({ sourceJobIds, ...page }) => ({ ...page, matchKeys: sourceJobIds })),
    sourceId: "source-viatris-social",
    companyId: "company-viatris",
    schemaVersion: "viatris-browser-traversal-validator-v2",
    retrievalPath: "PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION",
    validatorImplementationId: "viatris-playwright-ui-traversal-v1",
    matchKeyKind: "SOURCE_JOB_ID",
    artifactLogicalKey: "viatris-browser-traversal-validation"
  }) as ViatrisBrowserTraversalValidation;
}

export function createQiluBrowserTraversalValidation(input: {
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  pages: readonly {
    pageNumber: number;
    declaredTotalPages: number;
    rawRows: readonly { officialUrl: string; locationRaw: string; scopeDecision: "INCLUDED_MAINLAND" | "EXCLUDED_FOREIGN" }[];
    nextControlPresent: boolean;
  }[];
  observedAt: string;
  expiresAt: string;
}): BGradeIndependentTraversalValidation {
  return createRenderedTraversalValidation({
    ...input,
    pages: input.pages.map((page) => ({
      ...page,
      matchKeys: page.rawRows.filter((row) => row.scopeDecision === "INCLUDED_MAINLAND").map((row) => row.officialUrl)
    })),
    sourceId: "source-qilu-social",
    companyId: "company-qilu",
    schemaVersion: "qilu-browser-traversal-validator-v2",
    retrievalPath: "PLAYWRIGHT_BEISEN_RENDERED_UI_CLICK_PAGINATION",
    validatorImplementationId: "qilu-playwright-rendered-ui-traversal-v1",
    matchKeyKind: "OFFICIAL_URL",
    artifactLogicalKey: "qilu-browser-traversal-validation"
  });
}

export function createOfficialJsonRenderedTraversalValidation(input: {
  sourceId: OfficialJsonRenderedTraversalSourceId;
  companyId: string;
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  pages: readonly {
    channelId: string;
    pageNumber: number;
    declaredTotalPages: number;
    declaredTotalJobs: number;
    uiRequestCandidateIds: readonly string[];
    rawRows: readonly OfficialJsonRenderedRawRow[];
    nextControlPresent: boolean;
  }[];
  observedAt: string;
  expiresAt: string;
}): BGradeIndependentTraversalValidation {
  const policy = OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES[input.sourceId];
  const replay = replayOfficialJsonRenderedTraversal(input.sourceId, input.pages);
  if (replay.matchKeys.length < 1) throw new Error("Official JSON browser validation is empty");
  return createRenderedTraversalValidation({
    ...input,
    pages: input.pages.map((page) => ({ ...page, matchKeys: page.rawRows
      .filter((row) => row.scopeDecision === "INCLUDED_MAINLAND")
      .map((row) => row.sourceJobId) })),
    schemaVersion: "official-json-browser-network-traversal-v1",
    retrievalPath: policy.retrievalPath,
    validatorImplementationId: policy.validatorImplementationId,
    matchKeyKind: "SOURCE_JOB_ID",
    artifactLogicalKey: policy.artifactLogicalKey
  });
}

export function createPlanBoundHtmlBrowserTraversalValidation(input: {
  sourceId: PlanBoundHtmlTraversalSourceId;
  companyId: string;
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  pages: readonly {
    pageNumber: number;
    declaredTotalPages: number;
    channelId?: string;
    declaredTotalJobs?: number;
    matchKeys: readonly string[];
    rawMatchKeys?: readonly string[];
    partitions?: readonly {
      controlIndex: number;
      controlId: string;
      matchKeys: readonly string[];
    }[];
    nextControlPresent: boolean;
  }[];
  observedAt: string;
  expiresAt: string;
}): BGradeIndependentTraversalValidation {
  const policy = B_GRADE_VALIDATOR_POLICIES[input.sourceId];
  if (input.companyId !== policy.companyId) {
    throw new Error("Plan-bound HTML browser validation company binding mismatch");
  }
  const talentbrew = "talentbrewScope" in PLAN_BOUND_HTML_TRAVERSAL_POLICIES[input.sourceId];
  return createRenderedTraversalValidation({
    ...input,
    pages: input.pages.map((page) => ({
      ...page,
      rawMatchKeys: page.rawMatchKeys ?? page.matchKeys,
      ...(page.partitions ? {
        partitions: page.partitions.map((partition) => ({
          ...partition,
          matchKeys: canonicalStrings(partition.matchKeys)
        }))
      } : {})
    })),
    schemaVersion: talentbrew
      ? "plan-bound-html-browser-traversal-v2"
      : "plan-bound-html-browser-traversal-v1",
    retrievalPath: policy.retrievalPath,
    validatorImplementationId: policy.validatorImplementationId,
    matchKeyKind: policy.matchKeyKind,
    artifactLogicalKey: policy.artifactLogicalKey
  });
}

function createRenderedTraversalValidation(input: {
  sourceId: string;
  companyId: string;
  schemaVersion: "viatris-browser-traversal-validator-v2" | "qilu-browser-traversal-validator-v2" |
    "official-json-browser-network-traversal-v1" |
    "plan-bound-html-browser-traversal-v1" | "plan-bound-html-browser-traversal-v2";
  retrievalPath: string;
  validatorImplementationId: string;
  matchKeyKind: "SOURCE_JOB_ID" | "OFFICIAL_URL" | "JOB_DEDUPE_KEY";
  artifactLogicalKey: string;
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  pages: readonly {
    pageNumber: number;
    declaredTotalPages: number;
    channelId?: string;
    declaredTotalJobs?: number;
    matchKeys: readonly string[];
    rawRows?: readonly ({ officialUrl: string; locationRaw: string;
      scopeDecision: "INCLUDED_MAINLAND" | "EXCLUDED_FOREIGN" } | OfficialJsonRenderedRawRow)[];
    rawMatchKeys?: readonly string[];
    partitions?: readonly {
      controlIndex: number;
      controlId: string;
      matchKeys: readonly string[];
    }[];
    nextControlPresent: boolean;
  }[];
  observedAt: string;
  expiresAt: string;
}): BGradeIndependentTraversalValidation {
  if (input.pages.length === 0) throw new Error("Browser traversal requires at least one rendered page");
  const total = input.pages.length;
  if (input.schemaVersion !== "plan-bound-html-browser-traversal-v2") {
    for (let index = 0; index < total; index += 1) {
      const page = input.pages[index]!;
      if (page.pageNumber !== index + 1 || page.declaredTotalPages !== total ||
          page.nextControlPresent !== (index < total - 1)) {
        throw new Error("Browser traversal did not visit every declared UI page in order");
      }
    }
  }
  const allMatchKeys = input.pages.flatMap((page) => [...page.matchKeys]);
  if (new Set(allMatchKeys).size !== allMatchKeys.length) {
    throw new Error("Browser traversal contains duplicate match keys across rendered pages");
  }
  const canonicalPages = input.pages.map((page) => ({
    ...page,
    matchKeys: canonicalStrings(page.matchKeys),
    ...(page.rawMatchKeys ? { rawMatchKeys: canonicalStrings(page.rawMatchKeys) } : {}),
    ...(page.partitions ? { partitions: page.partitions.map((partition) => ({
      ...partition,
      matchKeys: canonicalStrings(partition.matchKeys)
    })) } : {}),
    ...(page.rawRows ? { rawRows: page.rawRows.map((row) => ({ ...row })) } : {})
  }));
  const artifactSha256 = sha256(canonicalJson({
    sourceId: input.sourceId,
    retrievalPath: input.retrievalPath,
    matchKeyKind: input.matchKeyKind,
    pages: canonicalPages,
    observedAt: input.observedAt
  }));
  const validation = browserValidationSchema.parse({
    schemaVersion: input.schemaVersion,
    sourceId: input.sourceId,
    companyId: input.companyId,
    retrievalPath: input.retrievalPath,
    validatorImplementationId: input.validatorImplementationId,
    matchKeyKind: input.matchKeyKind,
    sourceConfigSha256: input.sourceConfigSha256,
    surfaceIds: canonicalStrings(input.surfaceIds),
    channelIds: canonicalStrings(input.channelIds),
    pages: canonicalPages,
    pageCount: total,
    canonicalMatchKeySetSha256: canonicalStringSetSha256(allMatchKeys),
    artifactLogicalKey: input.artifactLogicalKey,
    artifactSha256,
    observedAt: input.observedAt,
    expiresAt: input.expiresAt
  });
  assertBrowserValidationEquations(validation);
  return validation;
}

/**
 * Runs the independent Viatris verifier through the rendered public UI. The
 * default path launches Chromium and clicks the site's page controls; it does
 * not import or call the HTTP/Tupu360 adapter used by the main crawl.
 */
export async function runViatrisBrowserTraversalValidator(input: {
  entryUrl: string;
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  signal?: AbortSignal;
  capture?: ViatrisRenderedUiCapture;
}): Promise<ViatrisBrowserTraversalValidation> {
  const expectedEntry = "https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT";
  if (input.entryUrl !== expectedEntry) throw new Error("Viatris browser validator entry URL mismatch");
  const captured = await (input.capture ?? captureViatrisRenderedUiTraversal)({
    entryUrl: input.entryUrl,
    ...(input.signal ? { signal: input.signal } : {})
  });
  const observedAtMs = Date.parse(captured.observedAt);
  if (!Number.isFinite(observedAtMs)) throw new Error("Viatris browser validation observedAt is invalid");
  return createViatrisBrowserTraversalValidation({
    sourceConfigSha256: input.sourceConfigSha256,
    surfaceIds: input.surfaceIds,
    channelIds: input.channelIds,
    pages: captured.pages,
    observedAt: captured.observedAt,
    expiresAt: new Date(observedAtMs + B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS).toISOString()
  });
}

export async function runBGradeIndependentTraversalValidator(input: {
  sourceId: string;
  companyId: string;
  entryUrl: string;
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  signal?: AbortSignal;
}): Promise<BGradeIndependentTraversalValidation> {
  const policy = bGradePolicy(input.sourceId);
  if (!policy || input.companyId !== policy.companyId) {
    throw new Error("B-grade independent validator source binding mismatch");
  }
  if (input.sourceId === "source-viatris-social") {
    return runViatrisBrowserTraversalValidator(input);
  }
  if (isOfficialJsonRenderedTraversalSourceId(input.sourceId)) {
    const captured = await captureOfficialJsonRenderedTraversal({
      sourceId: input.sourceId,
      entryUrl: input.entryUrl,
      ...(input.signal ? { signal: input.signal } : {})
    });
    const observedAtMs = Date.parse(captured.observedAt);
    if (!Number.isFinite(observedAtMs)) {
      throw new Error("Official JSON browser validation observedAt is invalid");
    }
    return createOfficialJsonRenderedTraversalValidation({
      sourceId: input.sourceId,
      companyId: input.companyId,
      sourceConfigSha256: input.sourceConfigSha256,
      surfaceIds: input.surfaceIds,
      channelIds: input.channelIds,
      pages: captured.pages,
      observedAt: captured.observedAt,
      expiresAt: new Date(observedAtMs + B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS).toISOString()
    });
  }
  if (isPlanBoundHtmlTraversalSourceId(input.sourceId)) {
    const captured = await capturePlanBoundHtmlRenderedTraversal({
      sourceId: input.sourceId,
      entryUrl: input.entryUrl,
      ...(input.signal ? { signal: input.signal } : {})
    });
    const observedAtMs = Date.parse(captured.observedAt);
    if (!Number.isFinite(observedAtMs)) throw new Error("Plan-bound HTML browser validation observedAt is invalid");
    return createPlanBoundHtmlBrowserTraversalValidation({
      sourceId: input.sourceId,
      companyId: input.companyId,
      sourceConfigSha256: input.sourceConfigSha256,
      surfaceIds: input.surfaceIds,
      channelIds: input.channelIds,
      pages: captured.pages,
      observedAt: captured.observedAt,
      expiresAt: new Date(observedAtMs + B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS).toISOString()
    });
  }
  throw new Error("B-grade independent validator is not implemented for source");
}

export async function captureViatrisRenderedUiTraversal(input: {
  entryUrl: string;
  signal?: AbortSignal;
  launchBrowser?: () => Promise<Pick<import("playwright-core").Browser, "newPage" | "close">>;
}): Promise<{ observedAt: string; pages: ViatrisRenderedUiPageCapture[] }> {
  if (input.signal?.aborted) {
    throw tagBGradeIndependentTraversalFailure(input.signal.reason, "B_GRADE_VALIDATOR_ABORTED");
  }
  const releaseBrowserPermit = await acquireBrowserSourcePermit(input.signal);
  try {
  const browser = await (input.launchBrowser ?? launchViatrisProductionBrowser)();
  const browserLifecycle = createAbortableClose(input.signal, () => browser.close());
  if (input.signal?.aborted) {
    try { await browserLifecycle.close(); } catch { /* the source abort remains authoritative */ }
    browserLifecycle.dispose();
    throw tagBGradeIndependentTraversalFailure(input.signal.reason, "B_GRADE_VALIDATOR_ABORTED");
  }
  let operationError: unknown;
  try {
    const page = await browser.newPage();
    const navigation = await page.goto(input.entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!navigation || navigation.status() < 200 || navigation.status() >= 400 || navigation.url() !== input.entryUrl) {
      throw new Error("Viatris browser validator navigation failed");
    }
    await page.locator(".position-list-body").waitFor({ state: "attached", timeout: 30_000 });
    const totalText = await page.locator("#pageTurnUl li:first-child").first().innerText();
    const totalMatch = /^\s*共\s*([1-9]\d*)\s*页\s*$/u.exec(totalText);
    const totalPages = totalMatch ? Number(totalMatch[1]) : Number.NaN;
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 60) {
      throw new Error("Viatris browser validator page declaration invalid");
    }
    const pages: ViatrisRenderedUiPageCapture[] = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      if (input.signal?.aborted) throw input.signal.reason;
      const hrefs = await page.locator(".position-list-body .position-item .e-title a[href*='positionId=']")
        .evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href));
      const sourceJobIds = hrefs.map((href) => {
        const id = new URL(href).searchParams.get("positionId")?.trim();
        if (!id) throw new Error("Viatris browser validator rendered job ID missing");
        return id;
      });
      const controlLocator = page.locator(
        "#pageTurnUl li[data-action][data-pagenum][data-pagemax]"
      );
      const controls = await controlLocator.evaluateAll((elements) => elements.map((element) => ({
        action: element.getAttribute("data-action"),
        pageNumber: element.getAttribute("data-pagenum"),
        pageSize: element.getAttribute("data-pagemax")
      })));
      const nextIndex = __testOnlyViatrisNextRenderedControlIndex(controls, pageNumber + 1);
      pages.push({
        pageNumber,
        declaredTotalPages: totalPages,
        sourceJobIds,
        nextControlPresent: nextIndex >= 0
      });
      if (pageNumber < totalPages) {
        if (nextIndex < 0) throw new Error("Viatris browser validator next-page control missing");
        await controlLocator.nth(nextIndex).click({ timeout: 30_000 });
        await page.waitForFunction(({ selector, previous }) => {
          const ids = [...document.querySelectorAll<HTMLAnchorElement>(selector)]
            .map((element) => new URL(element.href).searchParams.get("positionId") ?? "")
            .filter(Boolean).sort();
          const value = JSON.stringify([...new Set(ids)]);
          return value !== previous;
        }, { selector: ".position-list-body .position-item .e-title a[href*='positionId=']",
          previous: JSON.stringify([...new Set(sourceJobIds)].sort()) }, { timeout: 30_000 });
      }
    }
    if (input.signal?.aborted) {
      throw tagBGradeIndependentTraversalFailure(input.signal.reason, "B_GRADE_VALIDATOR_ABORTED");
    }
    return { observedAt: new Date().toISOString(), pages };
  } catch (error) {
    operationError = error;
    if (input.signal?.aborted) {
      throw tagBGradeIndependentTraversalFailure(input.signal.reason, "B_GRADE_VALIDATOR_ABORTED");
    }
    throw error;
  } finally {
    browserLifecycle.dispose();
    try {
      await browserLifecycle.close();
    } catch (closeError) {
      if (input.signal?.aborted) {
        throw tagBGradeIndependentTraversalFailure(input.signal.reason, "B_GRADE_VALIDATOR_ABORTED");
      }
      if (operationError === undefined) throw closeError;
    }
  }
  } finally {
    releaseBrowserPermit();
  }
}

async function launchViatrisProductionBrowser(): Promise<Pick<import("playwright-core").Browser, "newPage" | "close">> {
  const { chromium } = await import("playwright-core");
  const { FORMAL_CHROMIUM_ARGS, FORMAL_CHROMIUM_PATH } = await import("../readiness/formalBrowserPreflight");
  return chromium.launch({
    ...(process.platform === "linux"
      ? { executablePath: FORMAL_CHROMIUM_PATH, args: [...FORMAL_CHROMIUM_ARGS] }
      : { channel: "chrome" as const }),
    headless: true, chromiumSandbox: true,
    timeout: 30_000
  });
}

export function evaluateBGradeValidationRequirement(input: {
  trigger: BGradeValidationTrigger;
  validationExecution: "CURRENT_RUN" | "REUSED";
  validation: unknown;
  now: Date;
}): { acceptable: boolean; mustRunNow: boolean; reason: string } {
  const mustRunNow = input.trigger !== "STABLE_RUN";
  if (mustRunNow && input.validationExecution !== "CURRENT_RUN") {
    return { acceptable: false, mustRunNow: true, reason: "TRIGGER_REQUIRES_CURRENT_RUN_VALIDATION" };
  }
  const validation = browserValidationSchema.safeParse(input.validation);
  if (!validation.success || !validDate(input.now)) {
    return { acceptable: false, mustRunNow, reason: "VALIDATION_INVALID" };
  }
  try {
    assertBrowserValidationEquations(validation.data);
  } catch {
    return { acceptable: false, mustRunNow, reason: "VALIDATION_INVALID" };
  }
  if (validation.data.sourceId === "source-pfizer-china-social" && validation.data.schemaVersion === "official-json-browser-network-traversal-v1" &&
      validation.data.pages.some(page => page.rawRows.some(row => {
        const pageAt = (row.rawPayload.listPage as {capturedAt?:unknown} | undefined)?.capturedAt;
        return [row.rawPayload.capturedAt, ...(pageAt === undefined ? [] : [pageAt])].some(value => {
          const at = Date.parse(String(value));
          return !Number.isFinite(at) || at < Date.parse(validation.data.observedAt) || at > input.now.getTime();
        });
      }))) return { acceptable: false, mustRunNow: true, reason: "VALIDATION_INVALID" };
  const observedAt = Date.parse(validation.data.observedAt);
  const expiresAt = Date.parse(validation.data.expiresAt);
  const nowMs = input.now.getTime();
  if (observedAt > nowMs || expiresAt <= nowMs || expiresAt - observedAt > B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS) {
    return { acceptable: false, mustRunNow, reason: "VALIDATION_EXPIRED" };
  }
  if (input.validationExecution === "CURRENT_RUN" && nowMs - observedAt > B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS) {
    return { acceptable: false, mustRunNow, reason: "CURRENT_RUN_VALIDATION_TOO_OLD" };
  }
  return {
    acceptable: true,
    mustRunNow,
    reason: mustRunNow ? "CURRENT_RUN_VALIDATION_REQUIRED_AND_PRESENT" :
      input.validationExecution === "REUSED" ? "UNEXPIRED_STABLE_EVIDENCE_REUSE" : "CURRENT_STABLE_VALIDATION_PRESENT"
  };
}

export function issueBGradeTraversalCertificate(input: BGradeCertificateCandidate): BGradeCertificateDecision {
  const blockers = new Set<BGradeCertificateBlockerCode>();
  const policy = bGradePolicy(input.plan.source.id);
  const expectedSurfaces = canonicalStrings(input.plan.source.surfaceId ? [input.plan.source.surfaceId] : []);
  const expectedChannels = canonicalStrings(input.plan.expectedChannels?.map(({ channelId }) => channelId) ?? []);
  const allowsMainPageOverlap = policy !== undefined &&
    "allowMainPageOverlapAcrossPages" in policy && policy.allowMainPageOverlapAcrossPages === true;
  const auditedBeisen = ["source-fosun-pharma-social", "source-hansoh-social", "source-united-lab-social"]
    .includes(input.plan.source.id);
  if (!requiresBGradeTraversalCertificate(input.plan)) blockers.add("UNSUPPORTED_SOURCE");
  if (isSanofiChinesePlan(input.plan) && input.validationExecution!=="CURRENT_RUN") blockers.add("VALIDATION_REFRESH_REQUIRED");
  if ((isPfizerWorkdayTraversalPlan(input.plan) || isServierTraversalPlan(input.plan)) && input.validationExecution !== "CURRENT_RUN") blockers.add("VALIDATION_REFRESH_REQUIRED");
  if (!policy || input.plan.company.id !== policy.companyId || input.plan.source.companyId !== policy.companyId ||
      input.plan.source.kind !== "SOCIAL" || !input.plan.source.surfaceId ||
      expectedSurfaces.length === 0 || expectedChannels.length === 0) {
    blockers.add("SCOPE_MISMATCH");
  }
  if (!input.transportSuccess || !input.adapterSuccess) blockers.add("TRANSPORT_OR_ADAPTER_FAILED");
  if (input.binding.sourceConfigSha256 !== sourcePlanConfigSha256(input.plan)) {
    blockers.add("SOURCE_CONFIG_MISMATCH");
  }

  let evidence: PersistentSourceFetchEvidence | undefined;
  let pagination: PaginationEvaluation | undefined;
  let pfizerMainProof = false;
  let sanofiMainReplay: ReturnType<typeof replaySanofiChineseNative> | undefined;
  try {
    evidence = parsePersistentSourceFetchEvidence(input.evidence);
    if (requiresPlanBoundHtmlCertificateSourceId(input.plan.source.id) &&
        (input.plan.adapterId !== "html-table" || !validateStrictHtmlCompletenessProof(input.plan, evidence))) {
      throw new Error("B-grade main HTML evidence failed its source-bound replay");
    }
    const planBoundPolicy = requiresPlanBoundHtmlCertificateSourceId(input.plan.source.id)
      ? PLAN_BOUND_HTML_TRAVERSAL_POLICIES[input.plan.source.id]
      : undefined;
    const planBoundOfficialTotalPolicy = planBoundPolicy !== undefined &&
      "officialTotalTraversal" in planBoundPolicy && planBoundPolicy.officialTotalTraversal === true;
    pagination = evaluatePaginationEvidence({
      evidence,
      ...(isSanofiChinesePlan(input.plan) ? SANOFI_CN_PAGINATION_POLICY : {}),
      ...(isPfizerWorkdayTraversalPlan(input.plan) ? PFIZER_PAGINATION_POLICY : {}),
      expectedChannelIds: isOfficialJsonRenderedTraversalSourceId(input.plan.source.id) &&
          evidence.pages.some((page) => page.channelId !== undefined) ||
          requiresPlanBoundHtmlCertificateSourceId(input.plan.source.id) &&
          "talentbrewScope" in PLAN_BOUND_HTML_TRAVERSAL_POLICIES[input.plan.source.id]
        ? expectedChannels
        : [],
      filteredOutput: true,
      ...(input.plan.source.id === "source-qilu-social" || input.plan.source.id === "source-nhu-social" || auditedBeisen
        ? { allowMissingReturnedPage: true }
        : {}),
      ...(input.plan.source.id === "source-nhu-social" || input.plan.source.id === "source-fosun-pharma-social"
        ? { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true }
        : {}),
      ...(input.plan.source.id === "source-boehringer-ingelheim-china-social"
        ? {
            allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
            allowIndependentlyVerifiedProfileBoundExclusions: true
          }
        : {}),
      ...(planBoundOfficialTotalPolicy
        ? { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true }
        : {}),
      ...(allowsMainPageOverlap
        ? { allowRawIdOverlapAcrossPages: true }
        : requiresPlanBoundHtmlCertificateSourceId(input.plan.source.id)
          ? { allowMissingReturnedPage: true }
          : {})
    });
    pfizerMainProof = isPfizerWorkdayTraversalPlan(input.plan) && replayPfizerWorkdayTraversal(input.plan,evidence,input.jobs,input.now);
    if (isSanofiChinesePlan(input.plan)) {
      const chinese=sanofiMainReplay=replaySanofiChineseNative(input.plan,evidence,input.jobs[0]?.isBaseline ?? true);
      if(canonicalJson(chinese.jobs)!==canonicalJson(input.jobs)) throw new Error("Sanofi Chinese native output mismatch");
    }
    if (isPfizerWorkdayTraversalPlan(input.plan) && !pfizerMainProof) throw new Error("Pfizer source traversal failed strict raw replay");
    if (isServierTraversalPlan(input.plan) && !replayServierTraversal(input.plan, evidence, input.jobs)) throw new Error("Servier source traversal failed strict raw replay");
    const declaration = evidence.declaredCompleteness;
    const declaredPages = evidence.pages[0]?.declaredPages;
    const last = evidence.pages.at(-1);
    const talentbrewTraversal = requiresPlanBoundHtmlCertificateSourceId(input.plan.source.id) &&
      "talentbrewScope" in PLAN_BOUND_HTML_TRAVERSAL_POLICIES[input.plan.source.id];
    const planBoundOfficialTotalTraversal = planBoundOfficialTotalPolicy &&
      declaration?.kind === "OFFICIAL_TOTAL_COUNT" && declaration.scope === "SOURCE" &&
      declaration.value === evidence.fetchCounts.rawCount;
    const talentbrewPageGroups = talentbrewTraversal
      ? groupPaginationPagesByChannel(evidence.pages)
      : undefined;
    const declaredPageContract = pfizerMainProof ? true : talentbrewPageGroups
      ? talentbrewPageGroups.size === expectedChannels.length &&
        canonicalJson([...talentbrewPageGroups.keys()].sort(compareUtf8)) === canonicalJson(expectedChannels) &&
        [...talentbrewPageGroups.values()].every((pages) => pages.length > 0 &&
          pages.every((page) => page.declaredPages === pages.length) &&
          pages.at(-1)?.termination === "NEXT_ABSENT")
      : declaredPages == null
        ? evidence.pages.every((page) => page.declaredPages == null)
        : declaredPages === evidence.pages.length && evidence.pages.every((page) => page.declaredPages === declaredPages);
    const planBoundEmpty = allowsEmptyPlanBoundSource(input.plan.source.id) &&
      declaration?.kind === "OFFICIAL_TOTAL_COUNT" && declaration.scope === "SOURCE" && declaration.value === 0 &&
      evidence.pages.length === 1 && evidence.pages[0]?.termination === "EMPTY_PAGE" &&
      evidence.fetchCounts.rawCount === 0 && evidence.fetchCounts.validCount === 0 &&
      evidence.fetchLosses.length === 0;
    const officialJsonTotal = isOfficialJsonRenderedTraversalSourceId(input.plan.source.id) &&
      declaration?.kind === "OFFICIAL_TOTAL_COUNT" && declaration.scope === "SOURCE" &&
      declaration.value === evidence.fetchCounts.rawCount;
    const boehringerUiFilteredMain = input.plan.source.id === "source-boehringer-ingelheim-china-social" &&
      officialJsonTotal && evidence.pages.length === 1 && evidence.pages[0]?.declaredPages === 1 &&
      evidence.pages[0]?.termination === "NEXT_ABSENT" &&
      evidence.fetchCounts.rawCount === evidence.fetchCounts.validCount + 1 &&
      evidence.pages[0]?.declaredTotal === evidence.fetchCounts.rawCount &&
      input.paginationEvaluation.derivedAnomalyCodes.length === 0;
    const completeTraversal = declaration !== undefined &&
      (["COMPLETE_PAGE_TRAVERSAL", "OFFICIAL_TOTAL_PAGES"].includes(declaration.kind) ||
        planBoundEmpty || officialJsonTotal || planBoundOfficialTotalTraversal) &&
      (declaration.scope === "SOURCE" || isOfficialJsonRenderedTraversalSourceId(input.plan.source.id) &&
        declaration.scope === "CHANNEL" &&
        expectedChannels.length === 1 && declaration.channelId === expectedChannels[0]) &&
      (planBoundEmpty || officialJsonTotal || planBoundOfficialTotalTraversal ||
        declaration.value === evidence.pages.length) &&
      declaredPageContract &&
      (talentbrewPageGroups !== undefined || last?.termination === "NEXT_ABSENT" || last?.termination === "EMPTY_PAGE" ||
        boehringerUiFilteredMain) &&
      pagination.safeCompleteness && pagination.verifiedEligible &&
      pagination.paginationTraceSha256 === input.paginationEvaluation.paginationTraceSha256;
    if (!completeTraversal) blockers.add("MAIN_TRAVERSAL_INCOMPLETE");
  } catch {
    blockers.add("MAIN_TRAVERSAL_INCOMPLETE");
  }

  let ledger: AdapterReconciliation | undefined;
  try {
    ledger = assertAdapterReconciliation({
      jobs: [...input.jobs],
      observation: { structuredJobCount: input.jobs.length } as never,
      reconciliation: input.reconciliation
    });
  } catch {
    blockers.add("OUTPUT_MISMATCH");
  }
  const rawObservationIds = evidence ? canonicalStrings(evidence.pages.flatMap((page) => page.validJobIds)) : [];
  const rawObservationCount = evidence?.pages.reduce((count, page) => count + page.validJobIds.length, 0) ?? 0;
  const outputIds = policy ? independentMatchKeys(input.plan.source.id, input.jobs) ?? [] : [];
  const scopeExclusionsProven = evidence &&
    ((sanofiMainReplay ? canonicalJson(sanofiMainReplay.jobs)===canonicalJson(input.jobs) : sanofiChineseExclusionsProven(input.plan,evidence,input.jobs)) || validateStrictSourceScopeExclusionProof(input.plan, evidence, input.jobs) ||
      pfizerMainProof ||
      replayBayerMedicalTraversal(input.plan, evidence, input.jobs) !== undefined ||
      replayServierTraversal(input.plan, evidence, input.jobs) !== undefined);
  const sourceBoundOfficialJsonExclusions = evidence && auditedOfficialJsonLosses(input.plan.source.id, evidence);
  if (evidence && (evidence.fetchCounts.parseDiscardCount !== 0 ||
      evidence.fetchCounts.validationDiscardCount !== evidence.fetchLosses.length ||
      (allowsMainPageOverlap
        ? evidence.fetchCounts.validCount !== rawObservationCount
        : evidence.fetchCounts.validCount !== rawObservationIds.length) ||
      evidence.fetchCounts.rawCount !== evidence.fetchCounts.validCount + evidence.fetchCounts.validationDiscardCount ||
      evidence.fetchLosses.length > 0 && !scopeExclusionsProven && !sourceBoundOfficialJsonExclusions)) {
    blockers.add("LOSSY_PIPELINE");
  }
  const collisionDiscardCount = ledger?.collisionGroups.reduce((count, group) => count + group.droppedCount, 0) ?? 0;
  const mainReconciliationMatchesPolicy = ledger !== undefined && (allowsMainPageOverlap
    ? ledger.rawInputCount === evidence?.fetchCounts.validCount &&
      collisionDiscardCount === rawObservationCount - input.jobs.length
    : ledger.collisionGroups.length === 0 && ledger.rawInputCount === rawObservationIds.length);
  if (!ledger || ledger.adapterLosses.length !== 0 || !mainReconciliationMatchesPolicy ||
      ledger.dedupeOutputCount !== input.jobs.length ||
      outputIds.length !== input.jobs.length ||
      canonicalStringSetSha256(input.jobs.map(buildJobDedupeKey)) !== ledger.outputJobKeySetSha256) {
    blockers.add("OUTPUT_MISMATCH");
  }

  const rawValidation = input.independentValidation as Record<string, unknown> | null;
  if (rawValidation && policy && rawValidation.retrievalPath === policy.mainRetrievalPath) {
    blockers.add("VALIDATOR_PATH_NOT_INDEPENDENT");
  }
  if (rawValidation && (Array.isArray(rawValidation.surfaceIds) && rawValidation.surfaceIds.length === 0 ||
      Array.isArray(rawValidation.channelIds) && rawValidation.channelIds.length === 0)) {
    blockers.add("SCOPE_MISMATCH");
  }
  const validationResult = browserValidationSchema.safeParse(input.independentValidation);
  const validation = validationResult.success ? validationResult.data : undefined;
  if (validation?.schemaVersion === "official-json-browser-network-traversal-v1" && validation.sourceId === "source-sanofi-china-social") {
    try { if (Date.parse(sanofiChineseIndependentFinishedAt(validation.pages)) > input.now.getTime()) blockers.add("INDEPENDENT_VALIDATION_INVALID"); }
    catch { blockers.add("INDEPENDENT_VALIDATION_INVALID"); }
  }
  if (validation?.schemaVersion === "official-json-browser-network-traversal-v1" && validation.sourceId === "source-servier-china-social") {
    try { if (Date.parse(servierHybridFinishedAt(validation.pages)) > input.now.getTime()) blockers.add("INDEPENDENT_VALIDATION_INVALID"); }
    catch { blockers.add("INDEPENDENT_VALIDATION_INVALID"); }
  }
  if (validation?.schemaVersion === "official-json-browser-network-traversal-v1" && validation.sourceId === "source-bayer-healthcare-social") {
    try { if (Date.parse(bayerHybridFinishedAt(validation.pages)) > input.now.getTime()) blockers.add("INDEPENDENT_VALIDATION_INVALID"); }
    catch { blockers.add("INDEPENDENT_VALIDATION_INVALID"); }
  }
  if (!validation) blockers.add("INDEPENDENT_VALIDATION_INVALID");
  if (validation && policy && (validation.sourceId !== input.plan.source.id ||
      validation.companyId !== policy.companyId || validation.retrievalPath !== policy.retrievalPath ||
      validation.validatorImplementationId !== policy.validatorImplementationId ||
      validationMatchKeyKind(validation) !== policy.matchKeyKind ||
      validation.sourceConfigSha256 !== input.binding.sourceConfigSha256 ||
      canonicalJson(validation.surfaceIds) !== canonicalJson(expectedSurfaces) ||
      canonicalJson(validation.channelIds) !== canonicalJson(expectedChannels))) {
    blockers.add("SCOPE_MISMATCH");
  }
  if (validation && validationMatchKeySetSha256(validation) !== canonicalStringSetSha256(outputIds)) {
    blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
  }
  if (validation?.schemaVersion === "plan-bound-html-browser-traversal-v1" && ledger &&
      canonicalJson(planBoundDuplicateMultiplicity(validation)) !==
        canonicalJson(collisionMultiplicity(ledger.collisionGroups))) {
    blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
  }
  let sanofiIdentityProof: z.infer<typeof sanofiIdentityProofSchema> | undefined;
  let mainRawMatchKeys = outputIds;
  let mainExcludedMatchKeys: string[] = [];
  if (validation?.schemaVersion === "qilu-browser-traversal-validator-v2" &&
      input.plan.source.id === "source-qilu-social" && evidence) {
    const strictRawUrls = strictQiluRawOfficialUrls(input.plan, evidence, input.jobs);
    const outputSet = new Set(outputIds);
    if (!strictRawUrls || strictRawUrls.some((url) => !isStrictQiluOfficialJobUrl(url)) ||
        outputIds.some((url) => !strictRawUrls.includes(url))) {
      blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
    } else {
      mainRawMatchKeys = canonicalStrings(strictRawUrls);
      mainExcludedMatchKeys = canonicalStrings(strictRawUrls.filter((url) => !outputSet.has(url)));
    }
  }
  if (validation?.schemaVersion === "qilu-browser-traversal-validator-v2" && evidence) {
    const independentRaw = qiluRawMatchKeys(validation);
    const independentExcluded = qiluExcludedMatchKeys(validation);
    if (qiluRawRowCount(validation) !== evidence.fetchCounts.rawCount ||
        qiluExcludedRowCount(validation) !== evidence.fetchCounts.validationDiscardCount ||
        canonicalJson(independentRaw) !== canonicalJson(mainRawMatchKeys) ||
        canonicalJson(independentExcluded) !== canonicalJson(mainExcludedMatchKeys)) {
      blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
    }
  }
  if (validation?.schemaVersion === "official-json-browser-network-traversal-v1" && evidence) {
    const sanofiIndependent=validation.sourceId==="source-sanofi-china-social" ? replaySanofiChineseIndependent(validation.pages) : undefined;
    const replay = sanofiIndependent ?? replayOfficialJsonRenderedTraversal(validation.sourceId, validation.pages);
    const mainRawEvidenceIds = canonicalStrings(evidence.pages.flatMap((page) => page.rawJobIds));
    if(isSanofiChinesePlan(input.plan)){
      try {const main=sanofiMainReplay??replaySanofiChineseNative(input.plan,evidence,input.jobs[0]?.isBaseline??true),independent=sanofiIndependent??replaySanofiChineseIndependent(validation.pages);
        mainRawMatchKeys=canonicalStrings(main.rawPersistentIds);mainExcludedMatchKeys=canonicalStrings([...main.excludedIds]);
        const oracle=evidence.artifacts.find(a=>a.logicalKey==="sanofi-cn-module-anomalies-v2");
        if(!oracle) throw new Error("SANOFI_CN_IDENTITY_ORACLE_REQUIRED");
        sanofiIdentityProof={oracleBody:typeof oracle.body==="string"?oracle.body:Buffer.from(oracle.body).toString("utf8")};
        assertSanofiIdentityReplay(sanofiIdentityProof,independent,validation.pages,validation.artifactSha256);
        if(canonicalJson(main.anomalies.filter(a=>a.code==="SANOFI_CN_REPLACEMENT_CHARACTER_NATIVE_AUTHORITY"))!==canonicalJson(independent.descriptionAnomalies)||
          canonicalJson(main.decisions)!==canonicalJson(independent.decisions)||canonicalJson(mainRawMatchKeys)!==canonicalJson(replay.rawSourceJobIds)||
          canonicalJson(mainExcludedMatchKeys)!==canonicalJson(replay.excludedSourceJobIds)) blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
      }catch{blockers.add("INDEPENDENT_JOB_SET_MISMATCH");}
    }
    if (pfizerMainProof) {
      mainRawMatchKeys = canonicalStrings(pfizerMainSourceJobIds(evidence));
      mainExcludedMatchKeys = mainRawMatchKeys.filter(key => !outputIds.includes(key));
      if (canonicalJson(replay.rawSourceJobIds) !== canonicalJson(mainRawMatchKeys) ||
          canonicalJson(replay.excludedSourceJobIds) !== canonicalJson(mainExcludedMatchKeys)) blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
    }
    const boehringerRenderedOutputOnly = input.plan.source.id === "source-boehringer-ingelheim-china-social";
    if (boehringerRenderedOutputOnly
      ? replay.rawCount !== input.jobs.length || replay.excludedCount !== 0
      : replay.rawCount !== evidence.fetchCounts.rawCount ||
        replay.excludedCount !== evidence.fetchCounts.validationDiscardCount ||
        canonicalJson(replay.rawEvidenceIds) !== canonicalJson(mainRawEvidenceIds)) {
      blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
    } else if (!pfizerMainProof && !isSanofiChinesePlan(input.plan)) {
      mainRawMatchKeys = replay.rawSourceJobIds;
      mainExcludedMatchKeys = replay.excludedSourceJobIds;
    }
  }
  const requirement = evaluateBGradeValidationRequirement({
    trigger: input.trigger,
    validationExecution: input.validationExecution,
    validation: input.independentValidation,
    now: input.now
  });
  if (!requirement.acceptable) {
    blockers.add(requirement.reason === "VALIDATION_EXPIRED" ? "VALIDATION_EXPIRED" : "VALIDATION_REFRESH_REQUIRED");
  }
  if (blockers.size > 0 || !evidence || !pagination || !ledger || !validation) {
    return { status: "REJECTED", resultingGrade: "C", blockerCodes: [...blockers].sort() };
  }

  const certificateDraft = {
    schemaVersion: B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION,
    grade: "B",
    binding: { ...input.binding, sourceId: input.plan.source.id },
    scope: {
      companyId: input.plan.company.id,
      sourceId: input.plan.source.id,
      recruitmentType: input.plan.source.kind,
      geography: "MAINLAND_CHINA",
      businessUnit: "ALL",
      surfaceIds: expectedSurfaces,
      channelIds: expectedChannels
    },
    mainTraversal: {
      retrievalPath: policy!.mainRetrievalPath,
      matchKeyKind: policy!.matchKeyKind,
      pageCount: evidence.pages.length,
      terminalEvent: evidence.pages.at(-1)!.termination,
      paginationTraceSha256: canonicalPageTraceSha256(evidence.pages),
      canonicalMatchKeySetSha256: canonicalStringSetSha256(outputIds),
      canonicalRawMatchKeySetSha256: canonicalStringSetSha256(mainRawMatchKeys),
      canonicalExcludedMatchKeySetSha256: canonicalStringSetSha256(mainExcludedMatchKeys),
      ...(sanofiIdentityProof ? {sanofiIdentityProof} : {})
    },
    independentValidation: validation,
    validationPolicy: { trigger: input.trigger, execution: input.validationExecution },
    counts: {
      mainUniqueJobCount: outputIds.length,
      independentUniqueJobCount: validationMatchKeys(validation).length,
      finalUniqueJobCount: input.jobs.length,
      parseDiscardCount: 0,
      validationDiscardCount: evidence.fetchCounts.validationDiscardCount,
      normalizationDiscardCount: 0,
      dedupeDiscardCount: collisionDiscardCount
    },
    output: {
      canonicalJobSetSha256: ledger.outputJobKeySetSha256,
      adapterReconciliationSha256: ledger.ledgerSha256,
      collisionLedgerSha256: sha256(canonicalJson(ledger.collisionGroups)),
      ...(validation.schemaVersion === "plan-bound-html-browser-traversal-v1"
        ? { collisionGroups: ledger.collisionGroups }
        : {})
    },
    issuedAt: input.now.toISOString()
  };
  if(input.sanofiArchive){
    if(!isSanofiChinesePlan(input.plan)||validation.schemaVersion!=="official-json-browser-network-traversal-v1"||!sanofiIdentityProof)throw Error("SANOFI_COMPACT_SCOPE_REQUIRED");
    const {pages,...summary}=validation;
    for(const a of evidence.artifacts){
      const archived=input.sanofiArchive.artifacts.filter(x=>x.extractorLocator===a.extractorLocator);
      const bytes=typeof a.body==="string"?Buffer.from(a.body):a.body;
      if(archived.length!==1||archived[0]!.kind!==a.kind||archived[0]!.sha256!==createHash("sha256").update(bytes).digest("hex")||archived[0]!.byteCount!==bytes.byteLength||new Date(archived[0]!.capturedAt??"").toISOString()!==new Date(a.capturedAt).toISOString())
        throw Error("SANOFI_COMPACT_MAIN_ORIGINAL_MISMATCH");
    }
    const original=input.sanofiArchive.independentOriginal;
    if(original.canonicalArtifactSha256!==validation.artifactSha256)throw Error("SANOFI_COMPACT_INDEPENDENT_ORIGINAL_MISMATCH");
    const artifacts=input.sanofiArchive.artifacts.map(a=>({kind:a.kind,extractorLocator:a.extractorLocator,sha256:a.sha256,byteCount:a.byteCount,capturedAt:a.capturedAt instanceof Date?a.capturedAt.toISOString():a.capturedAt}));
    const originalFile={kind:"COMMAND_OUTPUT",extractorLocator:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR,...original,capturedAt:sanofiChineseIndependentFinishedAt(pages)};
    const originals=pages.flatMap(page=>page.rawRows.map(({rawPayload:v})=>({id:(v.domRow as SanofiChineseRow).id,
      detailSha256:(v.detailResponse as {bodySha256:string}).bodySha256,nativeSha256:(v.nativeResponse as {bodySha256:string}|undefined)?.bodySha256??null,
      domSha256:sha256((v.domPage as {searchResultsHtml:string}).searchResultsHtml)})));
    const certificate=sanofiCompactCertificateSchema.parse({...certificateDraft,schemaVersion:SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION,
      proofBasis:"PRE_COMMIT_DUAL_ORIGINAL_REPLAY",artifacts,independentValidation:{...summary,schemaVersion:"sanofi-cn-independent-summary-v1",finishedAt:sanofiChineseIndependentFinishedAt(pages),originalFile,originals}});
    const certificateSha256=sha256(canonicalJson(certificate));
    verifySanofiCompactCertificate({certificate,certificateSha256,now:input.now,expected:{...input.binding,sourceId:input.plan.source.id,
      canonicalJobSetSha256:ledger.outputJobKeySetSha256,canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(evidence.pages.flatMap(p=>p.rawJobIds)),sanofiArtifacts:input.sanofiArchive.artifacts}});
    return {status:"CERTIFIED",certificate,certificateSha256};
  }
  const certificate=certificateSchema.parse(certificateDraft);
  assertCertificateValidationSetEquations(certificate);
  return { status: "CERTIFIED", certificate, certificateSha256: sha256(canonicalJson(certificate)) };
}

export function verifyBGradeTraversalCertificateReceipt(input: {
  certificate: unknown;
  certificateSha256: string;
  expected: BGradeCertificateReceiptExpectation;
  now: Date;
}): { status: "PASS"; grade: "B"; sourceId: string; companyId: string; certificateSha256: string; finalUniqueJobCount: number } {
  if((input.certificate as {schemaVersion?:unknown}|null)?.schemaVersion===SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION)return verifySanofiCompactCertificate(input);
  const certificate = certificateSchema.parse(input.certificate);
  const policy = bGradePolicy(certificate.binding.sourceId);
  if (!policy || certificate.scope.companyId !== policy.companyId ||
      certificate.independentValidation.sourceId !== certificate.binding.sourceId ||
      certificate.independentValidation.companyId !== policy.companyId ||
      certificate.mainTraversal.retrievalPath !== policy.mainRetrievalPath ||
      certificateMainMatchKeyKind(certificate) !== policy.matchKeyKind ||
      certificate.independentValidation.retrievalPath !== policy.retrievalPath ||
      certificate.independentValidation.validatorImplementationId !== policy.validatorImplementationId ||
      validationMatchKeyKind(certificate.independentValidation) !== policy.matchKeyKind) {
    throw new Error("B-grade traversal certificate registered policy binding mismatch");
  }
  if (sha256(canonicalJson(certificate)) !== input.certificateSha256) {
    throw new Error("B-grade traversal certificate hash mismatch");
  }
  if (!validDate(input.now) || Date.parse(certificate.issuedAt) > input.now.getTime()) {
    throw new Error("B-grade traversal certificate issuance time is invalid");
  }
  const expected = input.expected;
  if (certificate.binding.releaseCandidateId !== expected.releaseCandidateId ||
      certificate.binding.batchId !== expected.batchId || certificate.binding.sourceResultId !== expected.sourceResultId ||
      certificate.binding.sourceId !== expected.sourceId || certificate.binding.sourceConfigSha256 !== expected.sourceConfigSha256 ||
      certificate.scope.sourceId !== expected.sourceId ||
      (expected.companyId !== undefined && certificate.scope.companyId !== expected.companyId)) {
    throw new Error("B-grade traversal certificate Receipt binding mismatch");
  }
  if ((expected.surfaceIds && canonicalJson(certificate.scope.surfaceIds) !== canonicalJson(canonicalStrings(expected.surfaceIds))) ||
      (expected.channelIds && canonicalJson(certificate.scope.channelIds) !== canonicalJson(canonicalStrings(expected.channelIds)))) {
    throw new Error("B-grade traversal certificate scope mismatch");
  }
  if ((expected.canonicalJobSetSha256 && certificate.output.canonicalJobSetSha256 !== expected.canonicalJobSetSha256) ||
      (expected.adapterReconciliationSha256 && certificate.output.adapterReconciliationSha256 !== expected.adapterReconciliationSha256) ||
      (expected.collisionLedgerSha256 && certificate.output.collisionLedgerSha256 !== expected.collisionLedgerSha256)) {
    throw new Error("B-grade traversal certificate reconciliation commitment mismatch");
  }
  if (certificate.schemaVersion === B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION &&
      certificateMainMatchKeyKind(certificate) === "JOB_DEDUPE_KEY" &&
      (!expected.canonicalJobSetSha256 ||
       certificate.mainTraversal.canonicalMatchKeySetSha256 !== expected.canonicalJobSetSha256)) {
    throw new Error("B-grade traversal certificate external job-set commitment mismatch");
  }
  assertRawEvidenceCommitment(
    certificate.independentValidation,
    certificate.binding.sourceId,
    expected.canonicalRawEvidenceIdSetSha256
  );
  const requirement = evaluateBGradeValidationRequirement({
    trigger: "STABLE_RUN",
    validationExecution: "REUSED",
    validation: certificate.independentValidation,
    now: input.now
  });
  if (!requirement.acceptable) throw new Error(`B-grade traversal certificate validation unavailable: ${requirement.reason}`);
  const issuedAtMs = Date.parse(certificate.issuedAt);
  if (certificate.independentValidation.schemaVersion === "official-json-browser-network-traversal-v1" &&
      certificate.independentValidation.sourceId === "source-sanofi-china-social" &&
      Date.parse(sanofiChineseIndependentFinishedAt(certificate.independentValidation.pages)) > issuedAtMs) {
    throw new Error("Sanofi independent native receipt is later than certificate issuance");
  }
  if (certificate.independentValidation.schemaVersion === "official-json-browser-network-traversal-v1" &&
      certificate.independentValidation.sourceId === "source-servier-china-social" &&
      Date.parse(servierHybridFinishedAt(certificate.independentValidation.pages)) > issuedAtMs) {
    throw new Error("Servier independent HTTP receipt is later than certificate issuance");
  }
  if (certificate.independentValidation.schemaVersion === "official-json-browser-network-traversal-v1" &&
      certificate.independentValidation.sourceId === "source-bayer-healthcare-social" &&
      Date.parse(bayerHybridFinishedAt(certificate.independentValidation.pages)) > issuedAtMs) {
    throw new Error("Bayer independent HTTP receipt is later than certificate issuance");
  }
  const observedAtMs = Date.parse(certificate.independentValidation.observedAt);
  if (observedAtMs > issuedAtMs ||
      certificate.validationPolicy.execution === "CURRENT_RUN" &&
        issuedAtMs - observedAtMs > B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS ||
      certificate.validationPolicy.trigger !== "STABLE_RUN" && certificate.validationPolicy.execution !== "CURRENT_RUN" ||
      ["source-pfizer-china-social", "source-servier-china-social", "source-sanofi-china-social"].includes(certificate.binding.sourceId) && certificate.validationPolicy.execution !== "CURRENT_RUN") {
    throw new Error("B-grade traversal certificate validation was not current at issuance");
  }
  if (certificateMainMatchKeySetSha256(certificate) !== validationMatchKeySetSha256(certificate.independentValidation) ||
      certificate.counts.mainUniqueJobCount !== certificate.counts.independentUniqueJobCount ||
      certificate.counts.mainUniqueJobCount !== certificate.counts.finalUniqueJobCount) {
    throw new Error("B-grade traversal certificate equations do not reconcile");
  }
  const sanofiOracle=assertCertificateValidationSetEquations(certificate);
  assertSanofiPersistedIdentityCommitments(certificate, expected, sanofiOracle);
  return {
    status: "PASS",
    grade: "B",
    sourceId: certificate.scope.sourceId,
    companyId: certificate.scope.companyId,
    certificateSha256: input.certificateSha256,
    finalUniqueJobCount: certificate.counts.finalUniqueJobCount
  };
}

/** Approved compact policy: original semantics were checked before commit;
 * readers verify commitments, never claim to replay the absent HTML bodies. */
function verifySanofiCompactCertificate(input: {
  certificate:unknown;certificateSha256:string;expected:BGradeCertificateReceiptExpectation;now:Date
}):{status:"PASS";grade:"B";sourceId:string;companyId:string;certificateSha256:string;finalUniqueJobCount:number} {
  const c=sanofiCompactCertificateSchema.parse(input.certificate),v=c.independentValidation,e=input.expected;
  const fail=(code:string):never=>{throw Error(`SANOFI_COMPACT_${code}`);};
  const policy=bGradePolicy(c.binding.sourceId)!;
  if(sha256(canonicalJson(c))!==input.certificateSha256)fail("HASH_MISMATCH");
  if(!validDate(input.now)||Date.parse(c.issuedAt)>input.now.getTime())fail("ISSUANCE_TIME");
  if(c.scope.companyId!==policy.companyId||c.scope.sourceId!==c.binding.sourceId||v.sourceId!==c.binding.sourceId||v.companyId!==policy.companyId||
    c.mainTraversal.retrievalPath!==policy.mainRetrievalPath||c.mainTraversal.matchKeyKind!==policy.matchKeyKind||v.retrievalPath!==policy.retrievalPath||
    v.validatorImplementationId!==policy.validatorImplementationId||v.matchKeyKind!==policy.matchKeyKind||v.artifactLogicalKey!==policy.artifactLogicalKey||
    v.sourceConfigSha256!==c.binding.sourceConfigSha256||c.validationPolicy.execution!=="CURRENT_RUN")fail("POLICY_MISMATCH");
  if(c.binding.releaseCandidateId!==e.releaseCandidateId||c.binding.batchId!==e.batchId||c.binding.sourceResultId!==e.sourceResultId||
    c.binding.sourceId!==e.sourceId||c.binding.sourceConfigSha256!==e.sourceConfigSha256||(e.companyId!==undefined&&e.companyId!==c.scope.companyId))fail("BINDING_MISMATCH");
  for(const [actual,expected] of [[c.scope.surfaceIds,v.surfaceIds],[c.scope.channelIds,v.channelIds],[c.scope.surfaceIds,e.surfaceIds],[c.scope.channelIds,e.channelIds]] as const)
    if(expected&&(canonicalJson(actual)!==canonicalJson(canonicalStrings(expected))||canonicalJson(actual)!==canonicalJson(canonicalStrings(actual))))fail("SCOPE_MISMATCH");
  if((e.canonicalJobSetSha256&&e.canonicalJobSetSha256!==c.output.canonicalJobSetSha256)||
    (e.adapterReconciliationSha256&&e.adapterReconciliationSha256!==c.output.adapterReconciliationSha256)||
    (e.collisionLedgerSha256&&e.collisionLedgerSha256!==c.output.collisionLedgerSha256))fail("OUTPUT_MISMATCH");
  const observed=Date.parse(v.observedAt),finished=Date.parse(v.finishedAt),issued=Date.parse(c.issuedAt),expires=Date.parse(v.expiresAt);
  if(observed>finished||finished>issued||finished-observed>30*60_000||issued-observed>B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS||
    expires<=input.now.getTime()||expires-observed>B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS||observed>input.now.getTime())fail("VALIDATION_EXPIRED");
  const oracleBody=c.mainTraversal.sanofiIdentityProof.oracleBody;
  if(!hasUniqueJsonObjectKeys(oracleBody))fail("ORACLE_INVALID");
  const oracle=sanofiIdentityOracleSchema.parse(JSON.parse(oracleBody)),decisions=oracle.decisions;
  if(oracle.independentArtifactSha256!==v.artifactSha256||v.originalFile.canonicalArtifactSha256!==v.artifactSha256||
    v.originalFile.capturedAt!==v.finishedAt||v.originalFile.kind!=="COMMAND_OUTPUT"||v.originalFile.extractorLocator!==SANOFI_INDEPENDENT_ORIGINAL_LOCATOR)fail("INDEPENDENT_ORIGINAL_MISMATCH");
  const originals=new Map(v.originals.map(r=>[r.id,r]));
  if(originals.size!==v.originals.length||v.originals.length!==decisions.length||new Set(decisions.map(d=>d.id)).size!==decisions.length||
    new Set(decisions.map(d=>d.reqId)).size!==decisions.length||new Set(decisions.map(d=>d.sourceJobId)).size!==decisions.length||
    decisions.some(d=>!originals.has(d.id)||(d.state==="OUTSIDE")!==(originals.get(d.id)!.nativeSha256===null)||
      d.sourceJobId!==sanofiPersistentJobId(d.reqId)||d.titleConflict&&(d.title!==d.titleConflict.nativeTitle||d.nativeDescriptionSha256!==d.descriptionSha256)))fail("DECISION_MISMATCH");
  const included=decisions.filter(d=>d.state==="PUBLISHING").map(d=>d.sourceJobId),excluded=decisions.filter(d=>d.state!=="PUBLISHING").map(d=>d.sourceJobId);
  if(c.counts.mainUniqueJobCount!==included.length||c.counts.independentUniqueJobCount!==included.length||c.counts.finalUniqueJobCount!==included.length||
    c.counts.validationDiscardCount!==excluded.length||c.counts.dedupeDiscardCount!==0||c.output.collisionGroups!==undefined||
    c.mainTraversal.canonicalMatchKeySetSha256!==canonicalStringSetSha256(included)||v.canonicalMatchKeySetSha256!==canonicalStringSetSha256(included)||
    c.mainTraversal.canonicalRawMatchKeySetSha256!==canonicalStringSetSha256(decisions.map(d=>d.sourceJobId))||
    c.mainTraversal.canonicalExcludedMatchKeySetSha256!==canonicalStringSetSha256(excluded)||
    c.output.canonicalJobSetSha256!==canonicalStringSetSha256(included.map(id=>`${c.binding.sourceId}:${id}`))||
    c.mainTraversal.pageCount!==v.pageCount||v.pageCount!==Math.ceil(decisions.length/15)||v.pageCount>25||c.mainTraversal.terminalEvent!=="NEXT_ABSENT"||
    !e.canonicalRawEvidenceIdSetSha256||e.canonicalRawEvidenceIdSetSha256!==canonicalStringSetSha256(decisions.map(d=>sanofiRawEvidenceId(d.id))))fail("SET_EQUATION_MISMATCH");
  const artifacts=e.sanofiArtifacts;
  if(!artifacts||artifacts.length!==c.artifacts.length||new Set(c.artifacts.map(a=>a.extractorLocator)).size!==c.artifacts.length)fail("ARTIFACT_SET_MISMATCH");
  for(const a of c.artifacts){if(Date.parse(a.capturedAt)<observed||Date.parse(a.capturedAt)>issued)fail("ARTIFACT_TIME");const matches=artifacts!.filter(x=>x.extractorLocator===a.extractorLocator);
    if(matches.length!==1||matches[0]!.kind!==a.kind||matches[0]!.sha256!==a.sha256||matches[0]!.byteCount!==a.byteCount||new Date(matches[0]!.capturedAt??"").toISOString()!==a.capturedAt||
      matches[0]!.releaseCandidateId!==e.releaseCandidateId||matches[0]!.batchId!==e.batchId||matches[0]!.sourceResultId!==e.sourceResultId||matches[0]!.sourceId!==e.sourceId)fail("ARTIFACT_BINDING_MISMATCH");
  }
  const bind=(kind:string,locator:string,hash:string,byteCount?:number)=>{
    const found=c.artifacts.filter(a=>a.kind===kind&&a.extractorLocator===locator);
    if(found.length!==1||found[0]!.sha256!==hash||(byteCount!==undefined&&found[0]!.byteCount!==byteCount))fail("ORIGINAL_COMMITMENT_MISMATCH");
  };
  bind("ORACLE_RESULT","sanofi-cn-module-anomalies-v2",sha256(oracleBody));
  bind(v.originalFile.kind,v.originalFile.extractorLocator,v.originalFile.sha256,v.originalFile.byteCount);
  for(const a of oracle.entries)if(a.code==="SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY")
    bind("ATS_PAGE",requestContractV2Locator("sanofi-cn-detail-v2",{family:"html",role:"sanofi-cn-detail",method:"GET",url:a.officialUrl,body:null,coordinate:{id:a.id}}),a.mainArtifactBodySha256);
  return {status:"PASS",grade:"B",sourceId:c.binding.sourceId,companyId:c.scope.companyId,certificateSha256:input.certificateSha256,finalUniqueJobCount:included.length};
}

function assertSanofiIdentityReplay(
  proof: z.infer<typeof sanofiIdentityProofSchema>,
  independent: ReturnType<typeof replaySanofiChineseIndependent>,
  pages: Parameters<typeof replaySanofiChineseIndependent>[0],
  independentArtifactSha256: string
): z.infer<typeof sanofiIdentityOracleSchema> {
  if (!hasUniqueJsonObjectKeys(proof.oracleBody)) throw new Error("SANOFI_CN_IDENTITY_ORACLE_INVALID");
  const oracle=sanofiIdentityOracleSchema.parse(JSON.parse(proof.oracleBody));
  if(canonicalJson(oracle.decisions)!==canonicalJson(independent.decisions) ||
    canonicalJson(oracle.entries.filter(a=>a.code==="SANOFI_CN_REPLACEMENT_CHARACTER_NATIVE_AUTHORITY"))!==canonicalJson(independent.descriptionAnomalies))
    throw new Error("SANOFI_CN_INDEPENDENT_IDENTITY_MISMATCH");
  const byId=new Map(independent.decisions.map(d=>[d.id,d])),headers=new Set<string>();
  for(const anomaly of oracle.entries){
    const own=byId.get(anomaly.id);
    if(!own || own.reqId!==anomaly.reqId) throw new Error("SANOFI_CN_ANOMALY_IDENTITY_MISMATCH");
    if(anomaly.code!=="SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY") continue;
    const foreign=byId.get(anomaly.foreignId);
    if(headers.has(anomaly.id) || !foreign || foreign.id===own.id || foreign.reqId===own.reqId ||
      own.state!=="PUBLISHING" || !own.nativePositionId || own.nativeCities.length===0 ||
      own.nativeDescriptionSha256!==own.descriptionSha256 ||
      own.officialUrl!==anomaly.officialUrl || own.title!==anomaly.title || own.applyUrl!==anomaly.applyUrl ||
      own.descriptionSha256!==anomaly.chineseDescriptionSha256 ||
      foreign.reqId!==anomaly.foreignReq || (foreign.titleConflict?.chineseTitle??foreign.title)!==anomaly.foreignTitle ||
      foreign.applyUrl!==anomaly.foreignApplyUrl || foreign.descriptionSha256!==anomaly.foreignDescriptionSha256)
      throw new Error("SANOFI_CN_FOREIGN_HEADER_INDEPENDENT_MISMATCH");
    // The fallback requires a stronger native identity than the ordinary
    // parser's reviewed alias/tombstone rules. Recheck only this original pair.
    const payload=pages.flatMap(p=>p.rawRows).find(r=>(r.rawPayload.domRow as SanofiChineseRow).id===anomaly.id)?.rawPayload;
    const native=payload?.nativeResponse as {body:string;redirect?:unknown}|undefined;
    const detailResponse=payload?.detailResponse as {body:string}|undefined;
    if(!payload || !native || !detailResponse || native.redirect!=="error") throw new Error("SANOFI_CN_FOREIGN_HEADER_INDEPENDENT_NATIVE_UNPROVEN");
    const detail=parseSanofiChineseDetail(detailResponse.body,payload.domRow as SanofiChineseRow);
    parseSanofiChineseNative(native.body,{...detail,headerAnomaly:anomaly});
    headers.add(anomaly.id);
  }
  if(headers.size>0 && oracle.independentArtifactSha256!==independentArtifactSha256)
    throw new Error("SANOFI_CN_INDEPENDENT_ARTIFACT_MISMATCH");
  return oracle;
}
function assertSanofiPersistedIdentityCommitments(
  certificate: FullBGradeTraversalCertificate, expected: BGradeCertificateReceiptExpectation,
  oracle: z.infer<typeof sanofiIdentityOracleSchema> | undefined
): void {
  if(certificate.binding.sourceId!=="source-sanofi-china-social") return;
  if(certificate.schemaVersion!==B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION ||
    certificate.independentValidation.schemaVersion!=="official-json-browser-network-traversal-v1" ||
    !certificate.mainTraversal.sanofiIdentityProof) throw new Error("SANOFI_CN_IDENTITY_ORACLE_REQUIRED");
  if(!oracle) throw new Error("SANOFI_CN_IDENTITY_ORACLE_REQUIRED");
  const proof=certificate.mainTraversal.sanofiIdentityProof;
  const artifacts=expected.sanofiArtifacts;
  if(!Array.isArray(artifacts) || artifacts.length===0) throw new Error("SANOFI_CN_PERSISTED_ARTIFACT_COMMITMENTS_REQUIRED");
  const bind=(kind:string,locator:string,hash:string)=>{
    const matches=artifacts.filter(a=>a.kind===kind&&a.extractorLocator===locator);
    if(matches.length!==1 || matches[0]!.sha256!==hash ||
      matches[0]!.releaseCandidateId!==expected.releaseCandidateId || matches[0]!.batchId!==expected.batchId ||
      matches[0]!.sourceResultId!==expected.sourceResultId || matches[0]!.sourceId!==expected.sourceId)
      throw new Error("SANOFI_CN_PERSISTED_ARTIFACT_COMMITMENT_MISMATCH");
  };
  bind("ORACLE_RESULT","sanofi-cn-module-anomalies-v2",sha256(proof.oracleBody));
  for(const anomaly of oracle.entries) if(anomaly.code==="SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY")
    bind("ATS_PAGE",requestContractV2Locator("sanofi-cn-detail-v2",{family:"html",role:"sanofi-cn-detail",method:"GET",url:anomaly.officialUrl,body:null,coordinate:{id:anomaly.id}}),anomaly.mainArtifactBodySha256);
}

function assertRawEvidenceCommitment(
  validation: BGradeIndependentTraversalValidation,
  sourceId: string,
  expectedSha256: string | undefined
): void {
  if (validation.schemaVersion === "qilu-browser-traversal-validator-v2" &&
      (!SHA256.safeParse(expectedSha256).success ||
       expectedSha256 !== qiluRawEvidenceIdSetSha256(validation))) {
    throw new Error("B-grade traversal certificate main raw evidence commitment mismatch");
  }
  if (validation.schemaVersion === "official-json-browser-network-traversal-v1" &&
      sourceId !== "source-boehringer-ingelheim-china-social" &&
      (!SHA256.safeParse(expectedSha256).success ||
       expectedSha256 !== canonicalStringSetSha256(
         replayOfficialJsonRenderedTraversal(validation.sourceId, validation.pages).rawEvidenceIds
       ))) {
    throw new Error("B-grade traversal certificate main raw evidence commitment mismatch");
  }
}

function bGradePolicy(sourceId: string) {
  return B_GRADE_VALIDATOR_POLICIES[sourceId as keyof typeof B_GRADE_VALIDATOR_POLICIES];
}

function assertCertificateValidationSetEquations(certificate: FullBGradeTraversalCertificate): z.infer<typeof sanofiIdentityOracleSchema> | undefined {
  if (certificate.schemaVersion !== B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION) return;
  if (certificate.independentValidation.schemaVersion === "plan-bound-html-browser-traversal-v1") {
    const collisionGroups = certificate.output.collisionGroups;
    if (!collisionGroups || sha256(canonicalJson(collisionGroups)) !== certificate.output.collisionLedgerSha256 ||
        collisionGroups.some((group) => group.droppedCount !== group.candidateKeySha256.length - 1 ||
          new Set(group.candidateKeySha256).size !== group.candidateKeySha256.length ||
          !group.candidateKeySha256.includes(group.winnerKeySha256)) ||
        new Set(collisionGroups.map((group) => group.dedupeKeySha256)).size !== collisionGroups.length ||
        canonicalJson(collisionMultiplicity(collisionGroups)) !==
          canonicalJson(planBoundDuplicateMultiplicity(certificate.independentValidation))) {
      throw new Error("B-grade traversal certificate collision multiplicity does not reconcile");
    }
  }
  if (certificate.binding.sourceId === "source-sanofi-china-social") {
    if(certificate.independentValidation.schemaVersion!=="official-json-browser-network-traversal-v1" || !certificate.mainTraversal.sanofiIdentityProof)
      throw new Error("SANOFI_CN_IDENTITY_ORACLE_REQUIRED");
  } else if(certificate.mainTraversal.sanofiIdentityProof) throw new Error("SANOFI_CN_IDENTITY_ORACLE_SOURCE_MISMATCH");
  if (certificate.independentValidation.schemaVersion === "official-json-browser-network-traversal-v1") {
    // Reuse this existing strict replay for the identity check; do not parse the
    // large independent capture again for the persisted metadata binding.
    const sanofiReplay=certificate.binding.sourceId==="source-sanofi-china-social"
      ? replaySanofiChineseIndependent(certificate.independentValidation.pages) : undefined;
    const replay=sanofiReplay ?? replayOfficialJsonRenderedTraversal(certificate.independentValidation.sourceId,certificate.independentValidation.pages);
    const sanofiOracle=sanofiReplay ? assertSanofiIdentityReplay(certificate.mainTraversal.sanofiIdentityProof!,sanofiReplay,certificate.independentValidation.pages,certificate.independentValidation.artifactSha256) : undefined;
    const boehringerRenderedOutputOnly = certificate.binding.sourceId ===
      "source-boehringer-ingelheim-china-social";
    if ((boehringerRenderedOutputOnly
      ? replay.rawCount !== certificate.counts.independentUniqueJobCount || replay.excludedCount !== 0
      : replay.rawCount !== certificate.counts.independentUniqueJobCount + certificate.counts.validationDiscardCount ||
        replay.excludedCount !== certificate.counts.validationDiscardCount) ||
        certificate.counts.dedupeDiscardCount !== 0 ||
        certificate.mainTraversal.canonicalRawMatchKeySetSha256 !==
          canonicalStringSetSha256(replay.rawSourceJobIds) ||
        certificate.mainTraversal.canonicalExcludedMatchKeySetSha256 !==
          canonicalStringSetSha256(replay.excludedSourceJobIds)) {
      throw new Error("B-grade traversal certificate official JSON raw-row equations do not reconcile");
    }
    return sanofiOracle;
  }
  if (certificate.independentValidation.schemaVersion !== "qilu-browser-traversal-validator-v2") {
    if (certificate.mainTraversal.canonicalRawMatchKeySetSha256 !== certificate.mainTraversal.canonicalMatchKeySetSha256 ||
        certificate.mainTraversal.canonicalExcludedMatchKeySetSha256 !== canonicalStringSetSha256([])) {
      throw new Error("B-grade traversal certificate raw-set equations do not reconcile");
    }
    const certificatePolicy = bGradePolicy(certificate.binding.sourceId);
    const permitsMainOverlap = certificatePolicy !== undefined &&
      "allowMainPageOverlapAcrossPages" in certificatePolicy &&
      certificatePolicy.allowMainPageOverlapAcrossPages === true;
    if (!permitsMainOverlap && certificate.counts.dedupeDiscardCount !== 0) {
      throw new Error("B-grade traversal certificate has an unexpected dedupe discard count");
    }
    return;
  }
  if (qiluRawRowCount(certificate.independentValidation) !==
        certificate.counts.independentUniqueJobCount + certificate.counts.validationDiscardCount ||
      qiluExcludedRowCount(certificate.independentValidation) !== certificate.counts.validationDiscardCount ||
      certificate.counts.dedupeDiscardCount !== 0 ||
      certificate.mainTraversal.canonicalRawMatchKeySetSha256 !==
        canonicalStringSetSha256(qiluRawMatchKeys(certificate.independentValidation)) ||
      certificate.mainTraversal.canonicalExcludedMatchKeySetSha256 !==
        canonicalStringSetSha256(qiluExcludedMatchKeys(certificate.independentValidation))) {
    throw new Error("B-grade traversal certificate Qilu raw-row equations do not reconcile");
  }
}

function independentMatchKeys(
  sourceId: string,
  jobs: readonly NormalizedJobRecord[]
): string[] | undefined {
  const policy = bGradePolicy(sourceId);
  if (!policy || jobs.some((job) => job.sourceId !== sourceId)) return undefined;
  const matchKeyKind = (policy as { matchKeyKind: "SOURCE_JOB_ID" | "OFFICIAL_URL" | "JOB_DEDUPE_KEY" })
    .matchKeyKind;
  const keys = matchKeyKind === "SOURCE_JOB_ID"
    ? jobs.map((job) => job.sourceJobId?.trim() ?? "")
    : matchKeyKind === "OFFICIAL_URL"
      ? jobs.map((job) => job.officialUrl.trim())
      : jobs.map(buildJobDedupeKey);
  return keys.some((key) => !key) ? undefined : canonicalStrings(keys);
}

function assertBrowserValidationEquations(validation: BGradeIndependentTraversalValidation): void {
  if (validation.schemaVersion === "official-json-browser-network-traversal-v1" && validation.sourceId === "source-sanofi-china-social" &&
      validation.observedAt !== sanofiChineseIndependentObservedAt(validation.pages)) throw new Error("Sanofi observation does not bind its first original Chinese DOM capture");
  if (validation.schemaVersion === "official-json-browser-network-traversal-v1" && validation.sourceId === "source-servier-china-social" &&
      validation.observedAt !== servierHybridObservedAt(validation.pages)) throw new Error("Servier observation does not bind its first original DOM capture");
  if (validation.schemaVersion === "official-json-browser-network-traversal-v1" && validation.sourceId === "source-bayer-healthcare-social" &&
      validation.observedAt !== bayerHybridObservedAt(validation.pages)) throw new Error("Bayer independent observation does not bind the first original DOM capture");
  const policy = validation.schemaVersion === "qilu-browser-traversal-validator-v2"
    ? LEGACY_QILU_RENDERED_VALIDATOR_POLICY
    : bGradePolicy(validation.sourceId);
  if (!policy || validation.companyId !== policy.companyId ||
      validation.retrievalPath !== policy.retrievalPath ||
      validation.validatorImplementationId !== policy.validatorImplementationId ||
      validationMatchKeyKind(validation) !== policy.matchKeyKind ||
      validation.artifactLogicalKey !== policy.artifactLogicalKey) {
    throw new Error("B-grade browser validation registered policy mismatch");
  }
  if (canonicalJson(validation.surfaceIds) !== canonicalJson(canonicalStrings(validation.surfaceIds)) ||
      canonicalJson(validation.channelIds) !== canonicalJson(canonicalStrings(validation.channelIds)) ||
      validation.pageCount !== validation.pages.length) {
    throw new Error("B-grade browser validation canonical scope or page count mismatch");
  }
  if (isPlanBoundBrowserTraversalValidation(validation)) {
    const planBoundPolicy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[validation.sourceId];
    if (validation.pages.length < 1 ||
        (!isPlanBoundTalentbrewBrowserTraversalValidation(validation) &&
          validation.pages.length > planBoundPolicy.maxPages) ||
        planBoundPolicy.maxPages === 1 && validation.pages.length !== 1) {
      throw new Error("Plan-bound HTML browser validation page limit mismatch");
    }
    const allRawMatchKeys = validation.pages.flatMap((page) => page.rawMatchKeys);
    if (allRawMatchKeys.length === 0 && (!("allowEmptyList" in planBoundPolicy) ||
        planBoundPolicy.allowEmptyList !== true || validation.pages.length !== 1 ||
        validation.pages[0]?.pageNumber !== 1 || validation.pages[0]?.declaredTotalPages !== 1 ||
        validation.pages[0]?.nextControlPresent !== false)) {
      throw new Error("Plan-bound HTML browser validation empty-list policy mismatch");
    }
  }
  const matchKeys: string[] = [];
  const qiluRawUrls: string[] = [];
  const planBoundSeenRawMatchKeys = new Set<string>();
  const officialJsonReplay = validation.schemaVersion === "official-json-browser-network-traversal-v1"
    ? replayOfficialJsonRenderedTraversal(validation.sourceId, validation.pages)
    : undefined;
  const officialJsonChannelIds = validation.schemaVersion === "official-json-browser-network-traversal-v1"
    ? validation.pages.map((page) => page.channelId)
    : undefined;
  if (officialJsonReplay &&
      (canonicalJson(validation.channelIds) !== canonicalJson(canonicalStrings(officialJsonChannelIds ?? [])) ||
       officialJsonReplay.matchKeys.length < 1)) {
    throw new Error("Official JSON browser validation raw row replay mismatch");
  }
  for (let index = 0; index < validation.pages.length; index += 1) {
    const page = validation.pages[index]!;
    const pageMatchKeys = "matchKeys" in page ? page.matchKeys : page.sourceJobIds;
    if ((!isPlanBoundTalentbrewBrowserTraversalValidation(validation) &&
        (page.pageNumber !== index + 1 || page.declaredTotalPages !== validation.pages.length ||
         page.nextControlPresent !== (index < validation.pages.length - 1))) ||
        canonicalJson(pageMatchKeys) !== canonicalJson(canonicalStrings(pageMatchKeys))) {
      throw new Error("B-grade browser validation page traversal mismatch");
    }
    if (validation.schemaVersion === "qilu-browser-traversal-validator-v2") {
      const qiluPage = validation.pages[index]!;
      const rawUrls = qiluPage.rawRows.map((row) => row.officialUrl);
      const derived = qiluPage.rawRows.filter((row) => row.scopeDecision === "INCLUDED_MAINLAND").map((row) => row.officialUrl);
      if (new Set(rawUrls).size !== rawUrls.length ||
          rawUrls.some((url) => !isStrictQiluOfficialJobUrl(url)) ||
          qiluPage.rawRows.some((row) => qiluScopeDecision(row.locationRaw) !== row.scopeDecision) ||
          canonicalJson(qiluPage.matchKeys) !== canonicalJson(canonicalStrings(derived))) {
        throw new Error("Qilu browser validation raw row scope replay mismatch");
      }
      qiluRawUrls.push(...rawUrls);
    }
    if (validation.schemaVersion === "official-json-browser-network-traversal-v1") {
      const derivedPageMatchKeys = validation.pages[index]!.rawRows
        .filter((row) => row.scopeDecision === "INCLUDED_MAINLAND")
        .map((row) => row.sourceJobId);
      if (canonicalJson(pageMatchKeys) !== canonicalJson(canonicalStrings(derivedPageMatchKeys))) {
        throw new Error("Official JSON browser validation raw row replay mismatch");
      }
    }
    if (isPlanBoundBrowserTraversalValidation(validation)) {
      const planBoundPage = validation.pages[index]!;
      const rawMatchKeys = planBoundPage.rawMatchKeys;
      const partitions = "partitions" in planBoundPage ? planBoundPage.partitions : undefined;
      const expectedNewMatchKeys = rawMatchKeys.filter((key) => {
        if (planBoundSeenRawMatchKeys.has(key)) return false;
        planBoundSeenRawMatchKeys.add(key);
        return true;
      });
      if (canonicalJson(rawMatchKeys) !== canonicalJson(canonicalStrings(rawMatchKeys)) ||
          canonicalJson(pageMatchKeys) !== canonicalJson(canonicalStrings(expectedNewMatchKeys)) ||
          rawMatchKeys.some((key) => {
            try {
              assertPlanBoundHtmlValidationMatchKey(validation.sourceId, key);
              return false;
            } catch {
              return true;
            }
          })) {
        throw new Error("Plan-bound HTML browser validation raw page set mismatch");
      }
      if (isPlanBoundTalentbrewBrowserTraversalValidation(validation)) {
        if (partitions !== undefined) {
          throw new Error("TalentBrew browser validation has unexpected reveal partitions");
        }
      } else if (validation.sourceId === "source-astellas-china-social") {
        if (index !== 0 || !partitions || partitions.length !== 3 ||
            new Set(partitions.map((partition) => partition.controlId)).size !== 3 ||
            partitions.some((partition, partitionIndex) => partition.controlIndex !== partitionIndex + 1 ||
              canonicalJson(partition.matchKeys) !== canonicalJson(canonicalStrings(partition.matchKeys))) ||
            new Set(partitions.flatMap((partition) => partition.matchKeys)).size !==
              partitions.reduce((count, partition) => count + partition.matchKeys.length, 0) ||
            canonicalJson(canonicalStrings(partitions.flatMap((partition) => partition.matchKeys))) !==
              canonicalJson(rawMatchKeys)) {
          throw new Error("Astellas browser validation partition proof mismatch");
        }
      } else if (partitions !== undefined) {
        throw new Error("Plan-bound HTML browser validation has unexpected partition proof");
      }
    }
    matchKeys.push(...pageMatchKeys);
  }
  if (new Set(matchKeys).size !== matchKeys.length || validationMatchKeySetSha256(validation) !== canonicalStringSetSha256(matchKeys)) {
    throw new Error("B-grade browser validation job set mismatch");
  }
  if (new Set(qiluRawUrls).size !== qiluRawUrls.length) {
    throw new Error("Qilu browser validation contains duplicate raw job URLs across pages");
  }
  if (isPlanBoundTalentbrewBrowserTraversalValidation(validation)) {
    assertTalentbrewValidationEquations(validation);
  }
  const expectedArtifactSha256 = sha256(canonicalJson({
    sourceId: validation.sourceId,
    retrievalPath: validation.retrievalPath,
    ...("matchKeyKind" in validation ? { matchKeyKind: validation.matchKeyKind } : {}),
    pages: validation.pages,
    observedAt: validation.observedAt
  }));
  if (validation.artifactSha256 !== expectedArtifactSha256) {
    throw new Error("B-grade browser validation artifact hash mismatch");
  }
}

function sanofiChineseExclusionsProven(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,jobs:readonly NormalizedJobRecord[]):boolean {
  try {return isSanofiChinesePlan(plan)&&canonicalJson(replaySanofiChineseNative(plan,evidence,jobs[0]?.isBaseline??true).jobs)===canonicalJson(jobs);}
  catch {return false;}
}

function planBoundDuplicateMultiplicity(
  validation: Extract<BGradeIndependentTraversalValidation,
    { schemaVersion: "plan-bound-html-browser-traversal-v1" | "plan-bound-html-browser-traversal-v2" }>
): Array<{ dedupeKeySha256: string; droppedCount: number }> {
  const counts = new Map<string, number>();
  for (const key of validation.pages.flatMap((page) => page.rawMatchKeys)) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ dedupeKeySha256: sha256(key), droppedCount: count - 1 }))
    .sort((left, right) => compareUtf8(left.dedupeKeySha256, right.dedupeKeySha256));
}

function assertTalentbrewValidationEquations(
  validation: Extract<BGradeIndependentTraversalValidation,
    { schemaVersion: "plan-bound-html-browser-traversal-v2" }>
): void {
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[validation.sourceId];
  if (!("talentbrewScope" in policy)) {
    throw new Error("TalentBrew browser validation source policy mismatch");
  }
  const configured = companyRecruitmentExecutionConfigsBySourceId[validation.sourceId];
  const table = configured?.adapterId === "html-table" ? configured.table : undefined;
  const partitions = table?.pagination?.ajaxMode === "talentbrew"
    ? table.pagination.talentbrewScope?.allowedPartitions
    : undefined;
  if (!partitions || canonicalJson(validation.channelIds) !==
      canonicalJson(canonicalStrings(partitions.map(({ channelId }) => channelId)))) {
    throw new Error("TalentBrew browser validation channel scope mismatch");
  }
  let cursor = 0;
  const rawKeys = new Set<string>();
  for (const partition of partitions) {
    const first = validation.pages[cursor];
    if (!first || first.channelId !== partition.channelId || first.pageNumber !== 1) {
      throw new Error("TalentBrew browser validation partition order mismatch");
    }
    const partitionPages = validation.pages.slice(cursor, cursor + first.declaredTotalPages);
    if (partitionPages.length !== first.declaredTotalPages || first.declaredTotalPages > policy.maxPages) {
      throw new Error("TalentBrew browser validation partition page count mismatch");
    }
    let rowCount = 0;
    for (let index = 0; index < partitionPages.length; index += 1) {
      const page = partitionPages[index]!;
      if (page.channelId !== partition.channelId || page.pageNumber !== index + 1 ||
          page.declaredTotalPages !== partitionPages.length ||
          page.declaredTotalJobs !== first.declaredTotalJobs ||
          page.nextControlPresent !== (index < partitionPages.length - 1) ||
          page.rawMatchKeys.some((key) => rawKeys.has(key))) {
        throw new Error("TalentBrew browser validation partition page equation mismatch");
      }
      page.rawMatchKeys.forEach((key) => rawKeys.add(key));
      rowCount += page.rawMatchKeys.length;
    }
    if (rowCount !== first.declaredTotalJobs) {
      throw new Error("TalentBrew browser validation partition total mismatch");
    }
    cursor += partitionPages.length;
  }
  if (cursor !== validation.pages.length) {
    throw new Error("TalentBrew browser validation has an unregistered partition");
  }
}

function collisionMultiplicity(
  groups: readonly { dedupeKeySha256: string; droppedCount: number }[]
): Array<{ dedupeKeySha256: string; droppedCount: number }> {
  return groups.map(({ dedupeKeySha256, droppedCount }) => ({ dedupeKeySha256, droppedCount }))
    .sort((left, right) => compareUtf8(left.dedupeKeySha256, right.dedupeKeySha256));
}

function groupPaginationPagesByChannel(
  pages: readonly PersistentSourceFetchEvidence["pages"][number][]
): Map<string, PersistentSourceFetchEvidence["pages"]> {
  const groups = new Map<string, PersistentSourceFetchEvidence["pages"]>();
  for (const page of pages) {
    const channelId = page.channelId ?? "";
    const existing = groups.get(channelId) ?? [];
    existing.push(page);
    groups.set(channelId, existing);
  }
  return groups;
}

function validationMatchKeys(validation: BGradeIndependentTraversalValidation): string[] {
  return canonicalStrings(validation.pages.flatMap((page) => "matchKeys" in page ? page.matchKeys : page.sourceJobIds));
}

function validationMatchKeyKind(
  validation: BGradeIndependentTraversalValidation
): "SOURCE_JOB_ID" | "OFFICIAL_URL" | "JOB_DEDUPE_KEY" {
  return "matchKeyKind" in validation ? validation.matchKeyKind : "SOURCE_JOB_ID";
}

function validationMatchKeySetSha256(validation: BGradeIndependentTraversalValidation): string {
  return "canonicalMatchKeySetSha256" in validation
    ? validation.canonicalMatchKeySetSha256
    : validation.canonicalJobIdSetSha256;
}

function certificateMainMatchKeySetSha256(certificate: FullBGradeTraversalCertificate): string {
  return "canonicalMatchKeySetSha256" in certificate.mainTraversal
    ? certificate.mainTraversal.canonicalMatchKeySetSha256
    : certificate.mainTraversal.canonicalJobIdSetSha256;
}

function certificateMainMatchKeyKind(
  certificate: FullBGradeTraversalCertificate
): "SOURCE_JOB_ID" | "OFFICIAL_URL" | "JOB_DEDUPE_KEY" {
  return "matchKeyKind" in certificate.mainTraversal ? certificate.mainTraversal.matchKeyKind : "SOURCE_JOB_ID";
}

function qiluScopeDecision(locationRaw: string): "INCLUDED_MAINLAND" | "EXCLUDED_FOREIGN" {
  const decision = qiluRenderedScopeDecision(locationRaw);
  if (!decision) throw new Error("Qilu browser validation location is outside the audited scope policy");
  return decision;
}

function qiluRawRowCount(validation: z.infer<typeof qiluBrowserValidationSchema>): number {
  return validation.pages.reduce((count, page) => count + page.rawRows.length, 0);
}

function qiluRawMatchKeys(validation: z.infer<typeof qiluBrowserValidationSchema>): string[] {
  return canonicalStrings(validation.pages.flatMap((page) => page.rawRows.map((row) => row.officialUrl)));
}

function qiluRawEvidenceIdSetSha256(validation: z.infer<typeof qiluBrowserValidationSchema>): string {
  return canonicalStringSetSha256(validation.pages.flatMap((page) => page.rawRows.map((row) => {
    const jobAdId = new URL(row.officialUrl).searchParams.get("jobAdId");
    if (!jobAdId) throw new Error("Qilu browser validation raw URL is missing jobAdId");
    return irreversibleOfficialJsonEvidenceId(jobAdId);
  })));
}

function qiluExcludedMatchKeys(validation: z.infer<typeof qiluBrowserValidationSchema>): string[] {
  return canonicalStrings(validation.pages.flatMap((page) => page.rawRows
    .filter((row) => row.scopeDecision === "EXCLUDED_FOREIGN")
    .map((row) => row.officialUrl)));
}

function qiluExcludedRowCount(validation: z.infer<typeof qiluBrowserValidationSchema>): number {
  return validation.pages.reduce(
    (count, page) => count + page.rawRows.filter((row) => row.scopeDecision === "EXCLUDED_FOREIGN").length,
    0
  );
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function auditedOfficialJsonLosses(sourceId: string, evidence: PersistentSourceFetchEvidence): boolean {
  const allowed = sourceId === "source-boehringer-ingelheim-china-social"
    ? new Set(["OFFICIAL_UI_EXCLUSION"])
    : sourceId === "source-hansoh-social" || sourceId === "source-united-lab-social"
      ? new Set(["OUT_OF_TIME_WINDOW", "OUT_OF_SCOPE"])
      : sourceId === "source-fosun-pharma-social"
        ? new Set<string>()
        : undefined;
  if (!allowed) return false;
  return evidence.fetchLosses.length === evidence.fetchCounts.validationDiscardCount &&
    evidence.fetchLosses.every((loss) => {
      const code = loss.details && typeof loss.details === "object" && "code" in loss.details
        ? (loss.details as { code?: unknown }).code
        : undefined;
      return typeof code === "string" && allowed.has(code);
    });
}

function allowsEmptyPlanBoundSource(sourceId: string): boolean {
  if (!requiresPlanBoundHtmlCertificateSourceId(sourceId)) return false;
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
  return "allowEmptyList" in policy && policy.allowEmptyList === true;
}

function requiresPlanBoundHtmlCertificateSourceId(sourceId: string): sourceId is PlanBoundHtmlTraversalSourceId {
  return Object.prototype.hasOwnProperty.call(PLAN_BOUND_HTML_REQUIRED_CERTIFICATES, sourceId);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
