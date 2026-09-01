import { createHash } from "node:crypto";
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
  captureQiluRenderedUiTraversal,
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
  "source-qilu-social": {
    companyId: "company-qilu",
    retrievalPath: "PLAYWRIGHT_BEISEN_RENDERED_UI_CLICK_PAGINATION",
    validatorImplementationId: "qilu-playwright-rendered-ui-traversal-v1",
    mainRetrievalPath: "HTTP_BEISEN_JOBAD_PAGINATION",
    matchKeyKind: "OFFICIAL_URL",
    artifactLogicalKey: "qilu-browser-traversal-validation"
  },
  ...OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES,
  ...PLAN_BOUND_HTML_TRAVERSAL_POLICIES
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
  rawMatchKeys: z.array(NONBLANK).min(1),
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
  retrievalPath: z.literal("PLAYWRIGHT_OFFICIAL_UI_NETWORK_TRAVERSAL"),
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
    terminalEvent: z.enum(["NEXT_ABSENT", "EMPTY_PAGE"]),
    paginationTraceSha256: SHA256,
    canonicalMatchKeySetSha256: SHA256,
    canonicalRawMatchKeySetSha256: SHA256,
    canonicalExcludedMatchKeySetSha256: SHA256
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

export type BGradeTraversalCertificate = z.infer<typeof certificateSchema>;

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
}

export function requiresBGradeTraversalCertificate(plan: SourceCrawlPlan): boolean {
  return requiresBGradeCertificateSourceId(plan.source.id);
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
  if (input.sourceId === "source-qilu-social") {
    const captured = await captureQiluRenderedUiTraversal({
      entryUrl: input.entryUrl,
      ...(input.signal ? { signal: input.signal } : {})
    });
    const observedAtMs = Date.parse(captured.observedAt);
    if (!Number.isFinite(observedAtMs)) throw new Error("Qilu browser validation observedAt is invalid");
    return createQiluBrowserTraversalValidation({
      sourceConfigSha256: input.sourceConfigSha256,
      surfaceIds: input.surfaceIds,
      channelIds: input.channelIds,
      pages: captured.pages,
      observedAt: captured.observedAt,
      expiresAt: new Date(observedAtMs + B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS).toISOString()
    });
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
    headless: true,
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
  if (!requiresBGradeTraversalCertificate(input.plan)) blockers.add("UNSUPPORTED_SOURCE");
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
  try {
    evidence = parsePersistentSourceFetchEvidence(input.evidence);
    if (isPlanBoundHtmlTraversalSourceId(input.plan.source.id) &&
        (input.plan.adapterId !== "html-table" || !validateStrictHtmlCompletenessProof(input.plan, evidence))) {
      throw new Error("B-grade main HTML evidence failed its source-bound replay");
    }
    pagination = evaluatePaginationEvidence({
      evidence,
      expectedChannelIds: isOfficialJsonRenderedTraversalSourceId(input.plan.source.id) &&
          evidence.pages.some((page) => page.channelId !== undefined) ||
          isPlanBoundHtmlTraversalSourceId(input.plan.source.id) &&
          "talentbrewScope" in PLAN_BOUND_HTML_TRAVERSAL_POLICIES[input.plan.source.id]
        ? expectedChannels
        : [],
      filteredOutput: true,
      ...(input.plan.source.id === "source-qilu-social" || input.plan.source.id === "source-nhu-social"
        ? { allowMissingReturnedPage: true }
        : {}),
      ...(input.plan.source.id === "source-nhu-social"
        ? { allowPositiveOfficialTotalCountAfterAdapterReconciliation: true }
        : {}),
      ...(allowsMainPageOverlap
        ? { allowRawIdOverlapAcrossPages: true }
        : isPlanBoundHtmlTraversalSourceId(input.plan.source.id)
          ? { allowMissingReturnedPage: true }
          : {})
    });
    const declaration = evidence.declaredCompleteness;
    const declaredPages = evidence.pages[0]?.declaredPages;
    const last = evidence.pages.at(-1);
    const talentbrewTraversal = isPlanBoundHtmlTraversalSourceId(input.plan.source.id) &&
      "talentbrewScope" in PLAN_BOUND_HTML_TRAVERSAL_POLICIES[input.plan.source.id];
    const talentbrewPageGroups = talentbrewTraversal
      ? groupPaginationPagesByChannel(evidence.pages)
      : undefined;
    const declaredPageContract = talentbrewPageGroups
      ? talentbrewPageGroups.size === expectedChannels.length &&
        canonicalJson([...talentbrewPageGroups.keys()].sort(compareUtf8)) === canonicalJson(expectedChannels) &&
        [...talentbrewPageGroups.values()].every((pages) => pages.length > 0 &&
          pages.every((page) => page.declaredPages === pages.length) &&
          pages.at(-1)?.termination === "NEXT_ABSENT")
      : declaredPages == null
        ? evidence.pages.every((page) => page.declaredPages == null)
        : declaredPages === evidence.pages.length && evidence.pages.every((page) => page.declaredPages === declaredPages);
    const completeTraversal = declaration !== undefined &&
      ["COMPLETE_PAGE_TRAVERSAL", "OFFICIAL_TOTAL_PAGES"].includes(declaration.kind) &&
      (declaration.scope === "SOURCE" || isOfficialJsonRenderedTraversalSourceId(input.plan.source.id) &&
        declaration.scope === "CHANNEL" &&
        expectedChannels.length === 1 && declaration.channelId === expectedChannels[0]) &&
      declaration.value === evidence.pages.length &&
      declaredPageContract &&
      (talentbrewPageGroups !== undefined || last?.termination === "NEXT_ABSENT" || last?.termination === "EMPTY_PAGE") &&
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
    validateStrictSourceScopeExclusionProof(input.plan, evidence, input.jobs);
  if (evidence && (evidence.fetchCounts.parseDiscardCount !== 0 ||
      evidence.fetchCounts.validationDiscardCount !== evidence.fetchLosses.length ||
      (allowsMainPageOverlap
        ? evidence.fetchCounts.validCount !== rawObservationCount
        : evidence.fetchCounts.validCount !== rawObservationIds.length) ||
      evidence.fetchCounts.rawCount !== evidence.fetchCounts.validCount + evidence.fetchCounts.validationDiscardCount ||
      evidence.fetchLosses.length > 0 && !scopeExclusionsProven)) {
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
  let mainRawMatchKeys = outputIds;
  let mainExcludedMatchKeys: string[] = [];
  if (input.plan.source.id === "source-qilu-social" && evidence) {
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
    const replay = replayOfficialJsonRenderedTraversal(validation.sourceId, validation.pages);
    const mainRawEvidenceIds = canonicalStrings(evidence.pages.flatMap((page) => page.rawJobIds));
    if (replay.rawCount !== evidence.fetchCounts.rawCount ||
        replay.excludedCount !== evidence.fetchCounts.validationDiscardCount ||
        canonicalJson(replay.rawEvidenceIds) !== canonicalJson(mainRawEvidenceIds)) {
      blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
    } else {
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

  const certificate = certificateSchema.parse({
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
      canonicalExcludedMatchKeySetSha256: canonicalStringSetSha256(mainExcludedMatchKeys)
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
  });
  assertCertificateValidationSetEquations(certificate);
  return { status: "CERTIFIED", certificate, certificateSha256: sha256(canonicalJson(certificate)) };
}

export function verifyBGradeTraversalCertificateReceipt(input: {
  certificate: unknown;
  certificateSha256: string;
  expected: BGradeCertificateReceiptExpectation;
  now: Date;
}): { status: "PASS"; grade: "B"; sourceId: string; companyId: string; certificateSha256: string; finalUniqueJobCount: number } {
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
  if (certificate.independentValidation.schemaVersion === "qilu-browser-traversal-validator-v2" &&
      (!SHA256.safeParse(expected.canonicalRawEvidenceIdSetSha256).success ||
       expected.canonicalRawEvidenceIdSetSha256 !== qiluRawEvidenceIdSetSha256(certificate.independentValidation))) {
    throw new Error("B-grade traversal certificate main raw evidence commitment mismatch");
  }
  if (certificate.independentValidation.schemaVersion === "official-json-browser-network-traversal-v1" &&
      (!SHA256.safeParse(expected.canonicalRawEvidenceIdSetSha256).success ||
       expected.canonicalRawEvidenceIdSetSha256 !== canonicalStringSetSha256(
         replayOfficialJsonRenderedTraversal(
           certificate.independentValidation.sourceId,
           certificate.independentValidation.pages
         ).rawEvidenceIds
       ))) {
    throw new Error("B-grade traversal certificate main raw evidence commitment mismatch");
  }
  const requirement = evaluateBGradeValidationRequirement({
    trigger: "STABLE_RUN",
    validationExecution: "REUSED",
    validation: certificate.independentValidation,
    now: input.now
  });
  if (!requirement.acceptable) throw new Error(`B-grade traversal certificate validation unavailable: ${requirement.reason}`);
  const issuedAtMs = Date.parse(certificate.issuedAt);
  const observedAtMs = Date.parse(certificate.independentValidation.observedAt);
  if (observedAtMs > issuedAtMs ||
      certificate.validationPolicy.execution === "CURRENT_RUN" &&
        issuedAtMs - observedAtMs > B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS ||
      certificate.validationPolicy.trigger !== "STABLE_RUN" && certificate.validationPolicy.execution !== "CURRENT_RUN") {
    throw new Error("B-grade traversal certificate validation was not current at issuance");
  }
  if (certificateMainMatchKeySetSha256(certificate) !== validationMatchKeySetSha256(certificate.independentValidation) ||
      certificate.counts.mainUniqueJobCount !== certificate.counts.independentUniqueJobCount ||
      certificate.counts.mainUniqueJobCount !== certificate.counts.finalUniqueJobCount) {
    throw new Error("B-grade traversal certificate equations do not reconcile");
  }
  assertCertificateValidationSetEquations(certificate);
  return {
    status: "PASS",
    grade: "B",
    sourceId: certificate.scope.sourceId,
    companyId: certificate.scope.companyId,
    certificateSha256: input.certificateSha256,
    finalUniqueJobCount: certificate.counts.finalUniqueJobCount
  };
}

function bGradePolicy(sourceId: string) {
  return B_GRADE_VALIDATOR_POLICIES[sourceId as keyof typeof B_GRADE_VALIDATOR_POLICIES];
}

function assertCertificateValidationSetEquations(certificate: BGradeTraversalCertificate): void {
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
  if (certificate.independentValidation.schemaVersion === "official-json-browser-network-traversal-v1") {
    const replay = replayOfficialJsonRenderedTraversal(
      certificate.independentValidation.sourceId,
      certificate.independentValidation.pages
    );
    if (replay.rawCount !== certificate.counts.independentUniqueJobCount + certificate.counts.validationDiscardCount ||
        replay.excludedCount !== certificate.counts.validationDiscardCount ||
        certificate.counts.dedupeDiscardCount !== 0 ||
        certificate.mainTraversal.canonicalRawMatchKeySetSha256 !==
          canonicalStringSetSha256(replay.rawSourceJobIds) ||
        certificate.mainTraversal.canonicalExcludedMatchKeySetSha256 !==
          canonicalStringSetSha256(replay.excludedSourceJobIds)) {
      throw new Error("B-grade traversal certificate official JSON raw-row equations do not reconcile");
    }
    return;
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
  const keys = policy.matchKeyKind === "SOURCE_JOB_ID"
    ? jobs.map((job) => job.sourceJobId?.trim() ?? "")
    : policy.matchKeyKind === "OFFICIAL_URL"
      ? jobs.map((job) => job.officialUrl.trim())
      : jobs.map(buildJobDedupeKey);
  return keys.some((key) => !key) ? undefined : canonicalStrings(keys);
}

function assertBrowserValidationEquations(validation: BGradeIndependentTraversalValidation): void {
  const policy = bGradePolicy(validation.sourceId);
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
        (validation.schemaVersion !== "plan-bound-html-browser-traversal-v2" &&
          validation.pages.length > planBoundPolicy.maxPages) ||
        planBoundPolicy.maxPages === 1 && validation.pages.length !== 1) {
      throw new Error("Plan-bound HTML browser validation page limit mismatch");
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
    if ((validation.schemaVersion !== "plan-bound-html-browser-traversal-v2" &&
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
      if (validation.schemaVersion === "plan-bound-html-browser-traversal-v2") {
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
  if (validation.schemaVersion === "plan-bound-html-browser-traversal-v2") {
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

function certificateMainMatchKeySetSha256(certificate: BGradeTraversalCertificate): string {
  return "canonicalMatchKeySetSha256" in certificate.mainTraversal
    ? certificate.mainTraversal.canonicalMatchKeySetSha256
    : certificate.mainTraversal.canonicalJobIdSetSha256;
}

function certificateMainMatchKeyKind(
  certificate: BGradeTraversalCertificate
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
