import { isServierTraversalPlan } from "./servierMokaScope";
import { jobQuarantineLossesMatch } from './jobQuarantine';
import { JNJ_DOM_CAPTURE_TOOL } from "./jnjCareersDomContract";
import { isBayerMedicalTraversalPlan } from "./bayerMokaScope";
import { isPfizerWorkdayTraversalPlan } from "./pfizerWorkdayTraversal";
import { createHash } from "node:crypto";
import { hasHengruiScopeExclusionPolicy, replayHengruiScopeExclusionProof } from "./strictMokaScopeExclusionProof";
import { z } from "zod";
import { assertAdapterReconciliation } from "./adapters/reconciliation";
import type { AdapterReconciliation } from "./adapters/types";
import { buildJobDedupeKey, type NormalizedJobRecord } from "./normalizedJob";
import { evaluatePaginationEvidence, type PaginationEvaluation } from "./paginationEvidence";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import {
  supportsStrictOfficialTotalCertificate,
  validateStrictOfficialTotalCertificateEvidence
} from "./runSourceCrawl";
import {
  canonicalStringSetSha256,
  parsePersistentSourceFetchEvidence,
  type PersistentSourceFetchEvidence
} from "./sourceFetchEvidence";

export const A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION =
  "a-grade-official-total-v2" as const;

export const REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES = Object.freeze({
  "source-abbvie-china-social": "company-abbvie-china",
  "source-amgen-china-social": "company-amgen-china",
  "source-astrazeneca-social": "company-astrazeneca",
  "source-bayer-healthcare-social": "company-bayer-healthcare",
  "source-biogen-china-social": "company-biogen-china",
  "source-bms-china-social": "company-bms-china",
  "source-buchang-social": "company-buchang",
  "source-cr-pharma-social": "company-cr-pharma",
  "source-csl-china-social": "company-csl-china",
  "source-cttq-social": "company-cttq",
  "source-daiichi-sankyo-china-social": "company-daiichi-sankyo-china",
  "source-gilead-china-social": "company-gilead-china",
  "source-grifols-china-social": "company-grifols-china",
  "source-gsk-china-social": "company-gsk-china",
  "source-hengrui-social": "company-hengrui",
  "source-jimin-kexin-social": "company-jimin-kexin",
  "source-johnson-innovative-medicine-social": "company-johnson-innovative-medicine",
  "source-lilly-china-social": "company-lilly-china",
  "source-livzon-social": "company-livzon",
  "source-lunan-social": "company-lunan",
  "source-merck-china-social": "company-merck-china",
  "source-msd-china-social": "company-msd-china",
  "source-novo-nordisk-china-social": "company-novo-nordisk-china",
  "source-organon-china-social": "company-organon-china",
  "source-pfizer-china-social": "company-pfizer-china",
  "source-roche-china-social": "company-roche-china",
  "source-servier-china-social": "company-servier-china",
  "source-shanghai-pharma-social": "company-shanghai-pharma",
  "source-ucb-china-social": "company-ucb-china",
  "source-teva-china-social": "company-teva-china",
  "source-yangzijiang-social": "company-yangzijiang"
} as const);

export type AGradeCertificateBlockerCode =
  | "UNSUPPORTED_SOURCE"
  | "SCOPE_MISMATCH"
  | "TRANSPORT_OR_ADAPTER_FAILED"
  | "PAGINATION_NOT_VERIFIED"
  | "EVIDENCE_INVALID"
  | "SOURCE_CONFIG_MISMATCH"
  | "OFFICIAL_ARTIFACT_INVALID"
  | "LOSSY_PIPELINE"
  | "OFFICIAL_TOTAL_MISMATCH"
  | "DEDUPE_LEDGER_INVALID"
  | "OUTPUT_MISMATCH";

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/u);
const NONBLANK = z.string().trim().min(1);
const certificateScopeSchema = z.object({
  companyId: NONBLANK,
  sourceId: NONBLANK,
  recruitmentType: z.literal("SOCIAL"),
  geography: z.literal("MAINLAND_CHINA"),
  businessUnit: z.literal("ALL"),
  verificationPolicy: z.literal("STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1"),
  surfaceIds: z.array(NONBLANK).min(1),
  channelIds: z.array(NONBLANK).min(1)
}).strict();
const legalDedupeEntrySchema = z.object({
  dedupeKeySha256: SHA256,
  candidateKeySha256: z.array(SHA256).min(2),
  winnerKeySha256: SHA256,
  droppedCount: z.number().int().positive(),
  dropReason: z.literal("DUPLICATE_DEDUPE_KEY_DETERMINISTIC_WINNER")
}).strict();
const legalScopeExclusionEntrySchema = z.object({
  rawLocatorSha256: SHA256,
  recordIndex: z.number().int().nonnegative(),
  code: z.enum(["VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE", "VERIFIED_MOKA_OUT_OF_MAINLAND_SCOPE", "ROCHE_DETAIL_DENIED", "LILLY_OFFICIAL_APPLICATION_CLOSED",'ORGANON_OFFICIAL_APPLICATION_CLOSED'])
}).strict();
const certificateSchema = z.object({
  schemaVersion: z.literal(A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION),
  grade: z.literal("A"),
  binding: z.object({
    releaseCandidateId: NONBLANK,
    batchId: NONBLANK,
    sourceResultId: NONBLANK,
    sourceId: NONBLANK,
    sourceConfigSha256: SHA256
  }).strict(),
  scope: certificateScopeSchema,
  declaration: z.object({
    kind: z.literal("OFFICIAL_TOTAL_COUNT"),
    scope: z.literal("SOURCE"),
    artifactLogicalKey: NONBLANK,
    artifactSha256: SHA256,
    extractorLocator: NONBLANK
  }).strict(),
  counts: z.object({
    officialTotal: z.number().int().nonnegative(),
    rawObservationCount: z.number().int().nonnegative(),
    rawUniqueOfficialRecordCount: z.number().int().nonnegative(),
    parsedCount: z.number().int().nonnegative(),
    validCount: z.number().int().nonnegative(),
    normalizedCount: z.number().int().nonnegative(),
    dedupeInputCount: z.number().int().nonnegative(),
    legalDedupeCount: z.number().int().nonnegative(),
    finalUniqueJobCount: z.number().int().nonnegative(),
    parseDiscardCount: z.literal(0),
    validationDiscardCount: z.number().int().nonnegative(),
    normalizationDiscardCount: z.literal(0)
  }).strict(),
  legalDedupeLedger: z.array(legalDedupeEntrySchema),
  legalScopeExclusionLedger: z.array(legalScopeExclusionEntrySchema).optional(),
  jobQuarantineLedger: z.array(z.object({rawLocatorSha256:SHA256,pageSequence:z.number().int().nonnegative(),recordIndex:z.number().int().nonnegative()}).strict()).optional(),
  pagination: z.object({
    pageCount: z.number().int().positive(),
    paginationTraceSha256: SHA256,
    canonicalRawOfficialIdSetSha256: SHA256
  }).strict(),
  output: z.object({
    canonicalJobSetSha256: SHA256,
    adapterReconciliationSha256: SHA256,
    collisionLedgerSha256: SHA256
  }).strict(),
  observedAt: z.string().datetime({ offset: true })
}).strict();

export type AGradeOfficialTotalCertificate = z.infer<typeof certificateSchema>;

export interface AGradeCertificateCandidate {
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
  officialArtifactSha256: string | undefined;
}

export type AGradeCertificateDecision =
  | {
      status: "CERTIFIED";
      certificate: AGradeOfficialTotalCertificate;
      certificateSha256: string;
    }
  | {
      status: "REJECTED";
      blockerCodes: readonly AGradeCertificateBlockerCode[];
    };

export interface AGradeCertificateReceiptExpectation {
  releaseCandidateId: string;
  batchId: string;
  sourceResultId: string;
  sourceId: string;
  companyId?: string;
  sourceConfigSha256: string;
  surfaceIds?: readonly string[];
  channelIds?: readonly string[];
  officialArtifactLogicalKey?: string;
  officialArtifactSha256?: string;
  canonicalJobSetSha256?: string;
  adapterReconciliationSha256?: string;
  collisionLedgerSha256?: string;
}

export interface AGradeCertificateReceipt {
  status: "PASS";
  grade: "A";
  sourceId: string;
  companyId: string;
  certificateSha256: string;
  finalUniqueJobCount: number;
}

export function requiresAGradeOfficialTotalCertificate(plan: SourceCrawlPlan): boolean {
  return !isServierTraversalPlan(plan) && !isPfizerWorkdayTraversalPlan(plan) && !isBayerMedicalTraversalPlan(plan) && requiresAGradeCertificateSourceId(plan.source.id);
}

export function requiresAGradeCertificateSourceId(sourceId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES, sourceId);
}

export function issueAGradeOfficialTotalCertificate(
  input: AGradeCertificateCandidate
): AGradeCertificateDecision {
  const blockers = new Set<AGradeCertificateBlockerCode>();
  const plan = input.plan;
  if (!requiresAGradeOfficialTotalCertificate(plan)) blockers.add("UNSUPPORTED_SOURCE");
  if (!hasExactSupportedMainlandScope(plan)) blockers.add("SCOPE_MISMATCH");
  if (!input.transportSuccess || !input.adapterSuccess) blockers.add("TRANSPORT_OR_ADAPTER_FAILED");
  if (input.binding.sourceConfigSha256 !== sourcePlanConfigSha256(plan)) {
    blockers.add("SOURCE_CONFIG_MISMATCH");
  }

  let evidence: PersistentSourceFetchEvidence | undefined;
  try {
    evidence = parsePersistentSourceFetchEvidence(input.evidence);
  } catch {
    blockers.add("EVIDENCE_INVALID");
  }

  let ledger: AdapterReconciliation | undefined;
  try {
    ledger = assertAdapterReconciliation({
      jobs: [...input.jobs],
      observation: { structuredJobCount: input.jobs.length } as never,
      reconciliation: input.reconciliation
    });
  } catch {
    blockers.add("DEDUPE_LEDGER_INVALID");
  }

  if (!evidence || !ledger) return rejected(blockers);
  const declaration = evidence.declaredCompleteness;
  if (declaration?.kind !== "OFFICIAL_TOTAL_COUNT" || declaration.scope !== "SOURCE") {
    blockers.add("SCOPE_MISMATCH");
  }
  const officialArtifact = declaration === undefined
    ? undefined
    : evidence.artifacts.find((artifact) => artifact.logicalKey === declaration.artifactLogicalKey);
  if (!officialArtifact || !input.officialArtifactSha256 || !SHA256.safeParse(input.officialArtifactSha256).success ||
      officialArtifact.extractorLocator !== declaration?.extractorLocator) {
    blockers.add("OFFICIAL_ARTIFACT_INVALID");
  }

  if ((hasHengruiScopeExclusionPolicy(plan) || evidence.captureTool.name === JNJ_DOM_CAPTURE_TOOL.name) && officialArtifact &&
      input.officialArtifactSha256 !== createHash("sha256").update(officialArtifact.body).digest("hex")) {
    blockers.add("OFFICIAL_ARTIFACT_INVALID");
  }

  let independentlyEvaluated: PaginationEvaluation | undefined;
  if (plan.source.id === "source-gsk-china-social" && (plan.adapterId !== "official-json" || !plan.moka)) {
    try {
      independentlyEvaluated = evaluatePaginationEvidence({
        evidence,
        expectedChannelIds: canonicalStrings(evidence.pages.flatMap((page) => page.channelId ?? [])),
        filteredOutput: true,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      });
    } catch {
      blockers.add("PAGINATION_NOT_VERIFIED");
    }
    if (!independentlyEvaluated || independentlyEvaluated.safeCompleteness !== true ||
        independentlyEvaluated.verifiedEligible !== true ||
        independentlyEvaluated.paginationTraceSha256 !== input.paginationEvaluation.paginationTraceSha256 ||
        JSON.stringify(independentlyEvaluated.derivedAnomalyCodes) !==
          JSON.stringify(input.paginationEvaluation.derivedAnomalyCodes)) {
      blockers.add("PAGINATION_NOT_VERIFIED");
    }
  } else if (validateStrictOfficialTotalCertificateEvidence({
    plan,
    evidence,
    paginationEvaluation: input.paginationEvaluation,
    reconciliation: ledger,
    jobs: input.jobs
  })) {
    // The strict source gate has already replayed the exact plan-bound pagination policy,
    // including source-specific allowances, and compared its trace to this evaluation.
    independentlyEvaluated = input.paginationEvaluation;
  } else {
    blockers.add("SCOPE_MISMATCH");
  }

  const rawOfficialIds = canonicalStrings(evidence.pages.flatMap((page) => page.rawJobIds));
  const legalDedupeCount = ledger.collisionGroups.reduce((sum, group) => sum + group.droppedCount, 0);
  const legalScopeExclusionLedger = hasHengruiScopeExclusionPolicy(plan)
    ? replayHengruiScopeExclusionProof(plan, evidence, input.jobs)?.exclusions
    : plan.source.id === "source-roche-china-social"
      // Strict source replay above already verified the exact approved denial and complete list.
      ? evidence.fetchLosses.filter(loss=>loss.details.code!=='JOB_QUARANTINED').map(loss=>({rawLocatorSha256:sha256(loss.rawLocator),recordIndex:loss.details.recordIndex as number,code:"ROCHE_DETAIL_DENIED" as const}))
      : plan.source.id === "source-lilly-china-social"||plan.source.id==='source-organon-china-social'
        // Strict source replay above bound every closed shell to its original listed requisition.
        ? evidence.fetchLosses.filter(loss=>loss.details.code!=='JOB_QUARANTINED').map(loss=>({rawLocatorSha256:sha256(loss.rawLocator),
          recordIndex:evidence.pages.slice(0,loss.details.pageSequence as number).reduce((n,page)=>n+page.rawJobIds.length,0)+(loss.details.recordIndex as number),
          code:plan.source.id==='source-organon-china-social'?'ORGANON_OFFICIAL_APPLICATION_CLOSED' as const:"LILLY_OFFICIAL_APPLICATION_CLOSED" as const}))
        : exactGrifolsScopeExclusionLedger(plan, evidence);
  const jobQuarantineLedger=jobQuarantineLossesMatch(evidence)?evidence.jobQuarantines!.map(row=>({
    rawLocatorSha256:sha256(row.rawLocator),pageSequence:row.pageSequence,recordIndex:row.recordIndex
  })):undefined;
  const legalValidationDiscardCount = (legalScopeExclusionLedger?.length ?? 0)+(jobQuarantineLedger?.length??0);
  if (evidence.fetchCounts.parseDiscardCount !== 0 || ledger.adapterLosses.length !== 0 ||
      evidence.fetchCounts.validationDiscardCount !== legalValidationDiscardCount ||
      evidence.fetchLosses.length !== legalValidationDiscardCount ||
      evidence.fetchCounts.rawCount !== evidence.fetchCounts.parsedCount ||
      evidence.fetchCounts.parsedCount !== evidence.fetchCounts.validCount + legalValidationDiscardCount) {
    blockers.add("LOSSY_PIPELINE");
  }
  if (ledger.rawInputCount !== evidence.fetchCounts.validCount ||
      ledger.parsedCount !== evidence.fetchCounts.validCount ||
      ledger.validBeforeDedupeCount !== evidence.fetchCounts.validCount ||
      ledger.dedupeInputCount !== evidence.fetchCounts.validCount ||
      ledger.dedupeInputCount - ledger.dedupeOutputCount !== legalDedupeCount ||
      rawOfficialIds.length > evidence.fetchCounts.rawCount ||
      rawOfficialIds.length < ledger.dedupeOutputCount) {
    blockers.add("DEDUPE_LEDGER_INVALID");
  }
  if (declaration?.value !== evidence.fetchCounts.rawCount ||
      declaration?.value !== ledger.dedupeOutputCount + legalDedupeCount + legalValidationDiscardCount ||
      ledger.dedupeOutputCount !== input.jobs.length) {
    blockers.add("OFFICIAL_TOTAL_MISMATCH");
  }
  const outputKeys = input.jobs.map(buildJobDedupeKey);
  if (new Set(outputKeys).size !== outputKeys.length ||
      canonicalStringSetSha256(outputKeys) !== ledger.outputJobKeySetSha256) {
    blockers.add("OUTPUT_MISMATCH");
  }
  if (blockers.size > 0 || !declaration || !officialArtifact || !independentlyEvaluated ||
      !input.officialArtifactSha256) return rejected(blockers);

  const certificate = certificateSchema.parse({
    schemaVersion: A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION,
    grade: "A",
    binding: {
      ...input.binding,
      sourceId: plan.source.id
    },
    scope: {
      companyId: plan.company.id,
      sourceId: plan.source.id,
      recruitmentType: plan.source.kind,
      geography: "MAINLAND_CHINA",
      businessUnit: "ALL",
      verificationPolicy: "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1",
      surfaceIds: canonicalStrings([plan.source.surfaceId!]),
      channelIds: canonicalStrings(plan.expectedChannels!.map((channel) => channel.channelId))
    },
    declaration: {
      kind: declaration.kind,
      scope: declaration.scope,
      artifactLogicalKey: declaration.artifactLogicalKey,
      artifactSha256: input.officialArtifactSha256,
      extractorLocator: declaration.extractorLocator
    },
    counts: {
      officialTotal: declaration.value,
      rawObservationCount: evidence.fetchCounts.rawCount,
      rawUniqueOfficialRecordCount: rawOfficialIds.length,
      parsedCount: evidence.fetchCounts.parsedCount,
      validCount: evidence.fetchCounts.validCount,
      normalizedCount: ledger.validBeforeDedupeCount,
      dedupeInputCount: ledger.dedupeInputCount,
      legalDedupeCount,
      finalUniqueJobCount: ledger.dedupeOutputCount,
      parseDiscardCount: 0,
      validationDiscardCount: legalValidationDiscardCount,
      normalizationDiscardCount: 0
    },
    legalDedupeLedger: ledger.collisionGroups,
    legalScopeExclusionLedger,
    jobQuarantineLedger,
    pagination: {
      pageCount: evidence.pages.length,
      paginationTraceSha256: independentlyEvaluated.paginationTraceSha256,
      canonicalRawOfficialIdSetSha256: canonicalStringSetSha256(rawOfficialIds)
    },
    output: {
      canonicalJobSetSha256: ledger.outputJobKeySetSha256,
      adapterReconciliationSha256: ledger.ledgerSha256,
      collisionLedgerSha256: sha256(canonicalJson(ledger.collisionGroups))
    },
    observedAt: officialArtifact.capturedAt
  });
  return {
    status: "CERTIFIED",
    certificate,
    certificateSha256: sha256(canonicalJson(certificate))
  };
}

export function verifyAGradeCompletenessCertificateReceipt(input: {
  certificate: unknown;
  certificateSha256: string;
  expected: AGradeCertificateReceiptExpectation;
}): AGradeCertificateReceipt {
  const certificate = certificateSchema.parse(input.certificate);
  if (!SHA256.safeParse(input.certificateSha256).success ||
      sha256(canonicalJson(certificate)) !== input.certificateSha256) {
    throw new Error("A-grade completeness certificate hash mismatch");
  }
  const expected = input.expected;
  const registeredCompanyId = REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES[
    expected.sourceId as keyof typeof REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES
  ];
  if (certificate.binding.releaseCandidateId !== expected.releaseCandidateId ||
      certificate.binding.batchId !== expected.batchId ||
      certificate.binding.sourceResultId !== expected.sourceResultId ||
      certificate.binding.sourceId !== expected.sourceId ||
      certificate.binding.sourceConfigSha256 !== expected.sourceConfigSha256 ||
      certificate.scope.sourceId !== expected.sourceId ||
      registeredCompanyId === undefined || certificate.scope.companyId !== registeredCompanyId ||
      (expected.companyId !== undefined && certificate.scope.companyId !== expected.companyId)) {
    throw new Error("A-grade completeness certificate Receipt binding mismatch");
  }
  if (expected.surfaceIds !== undefined &&
      JSON.stringify(certificate.scope.surfaceIds) !== JSON.stringify(canonicalStrings(expected.surfaceIds))) {
    throw new Error("A-grade completeness certificate surface scope mismatch");
  }
  if (expected.channelIds !== undefined &&
      JSON.stringify(certificate.scope.channelIds) !== JSON.stringify(canonicalStrings(expected.channelIds))) {
    throw new Error("A-grade completeness certificate channel scope mismatch");
  }
  if ((expected.officialArtifactLogicalKey !== undefined &&
      certificate.declaration.artifactLogicalKey !== expected.officialArtifactLogicalKey) ||
      (expected.officialArtifactSha256 !== undefined &&
      certificate.declaration.artifactSha256 !== expected.officialArtifactSha256)) {
    throw new Error("A-grade completeness certificate official artifact mismatch");
  }
  if ((expected.canonicalJobSetSha256 !== undefined &&
      certificate.output.canonicalJobSetSha256 !== expected.canonicalJobSetSha256) ||
      (expected.adapterReconciliationSha256 !== undefined &&
      certificate.output.adapterReconciliationSha256 !== expected.adapterReconciliationSha256) ||
      (expected.collisionLedgerSha256 !== undefined &&
      certificate.output.collisionLedgerSha256 !== expected.collisionLedgerSha256)) {
    throw new Error("A-grade completeness certificate reconciliation commitment mismatch");
  }
  assertCertificateEquations(certificate);
  return {
    status: "PASS",
    grade: "A",
    sourceId: certificate.scope.sourceId,
    companyId: certificate.scope.companyId,
    certificateSha256: input.certificateSha256,
    finalUniqueJobCount: certificate.counts.finalUniqueJobCount
  };
}

function hasExactSupportedMainlandScope(plan: SourceCrawlPlan): boolean {
  return REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES[
      plan.source.id as keyof typeof REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES
    ] === plan.company.id &&
    plan.source.companyId === plan.company.id &&
    plan.source.kind === "SOCIAL" &&
    (plan.source.id !== "source-gsk-china-social" || plan.adapterId === "official-json" &&
      (plan.officialJsonFetch?.kind === "phenom" && plan.officialJsonFetch.countryFilter === "China" ||
       plan.moka?.requisitionStatusPolicy === "GSK_NATIVE_OPEN_REQUISITIONS_V1")) &&
    supportsStrictOfficialTotalCertificate(plan) &&
    Boolean(plan.source.surfaceId?.trim()) &&
    Boolean(plan.expectedChannels?.length) &&
    new Set(plan.expectedChannels?.map((channel) => channel.channelId)).size === plan.expectedChannels?.length;
}

function assertCertificateEquations(certificate: AGradeOfficialTotalCertificate): void {
  const counts = certificate.counts;
  const legalDedupeCount = certificate.legalDedupeLedger.reduce(
    (sum, group) => sum + group.droppedCount,
    0
  );
  const dedupeKeys = certificate.legalDedupeLedger.map((group) => group.dedupeKeySha256);
  const legalScopeExclusionLedger = certificate.legalScopeExclusionLedger ?? [];
  const scopeExclusionIndexes = legalScopeExclusionLedger.map((entry) => entry.recordIndex);
  const invalidDedupeGroup = certificate.legalDedupeLedger.some((group) =>
    new Set(group.candidateKeySha256).size !== group.candidateKeySha256.length ||
    group.winnerKeySha256 !== group.candidateKeySha256[0] ||
    group.droppedCount !== group.candidateKeySha256.length - 1
  );
  if (counts.parseDiscardCount !== 0 ||
      counts.normalizationDiscardCount !== 0 ||
      counts.rawObservationCount !== counts.parsedCount ||
      counts.parsedCount !== counts.validCount + counts.validationDiscardCount ||
      counts.validCount !== counts.normalizedCount ||
      counts.normalizedCount !== counts.dedupeInputCount ||
      counts.dedupeInputCount - counts.finalUniqueJobCount !== counts.legalDedupeCount ||
      counts.rawUniqueOfficialRecordCount > counts.rawObservationCount ||
      counts.rawUniqueOfficialRecordCount < counts.finalUniqueJobCount ||
      counts.legalDedupeCount !== legalDedupeCount ||
      counts.validationDiscardCount !== legalScopeExclusionLedger.length+(certificate.jobQuarantineLedger?.length??0) ||
      counts.officialTotal !== counts.rawObservationCount ||
      counts.officialTotal !== counts.finalUniqueJobCount + counts.legalDedupeCount +
        counts.validationDiscardCount ||
      new Set(scopeExclusionIndexes).size !== scopeExclusionIndexes.length ||
      new Set(dedupeKeys).size !== dedupeKeys.length || invalidDedupeGroup ||
      certificate.output.collisionLedgerSha256 !== sha256(canonicalJson(certificate.legalDedupeLedger)) ||
      new Set(certificate.scope.surfaceIds).size !== certificate.scope.surfaceIds.length ||
      new Set(certificate.scope.channelIds).size !== certificate.scope.channelIds.length) {
    throw new Error("A-grade completeness certificate equations do not reconcile");
  }
}

function exactGrifolsScopeExclusionLedger(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence
): Array<{ rawLocatorSha256: string; recordIndex: number;
  code: "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE" }> | undefined {
  if (evidence.fetchCounts.validationDiscardCount === 0 && evidence.fetchLosses.length === 0) return [];
  if (plan.source.id !== "source-grifols-china-social" ||
      plan.company.id !== "company-grifols-china" ||
      plan.source.companyId !== "company-grifols-china" ||
      plan.adapterId !== "official-json" ||
      plan.profileBoundSource?.kind !== "grifols-china-detail-scope") return undefined;
  const indexes = new Set<number>();
  const rows: Array<{ rawLocatorSha256: string; recordIndex: number;
    code: "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE" }> = [];
  for (const loss of evidence.fetchLosses) {
    const recordIndex = loss.details?.recordIndex;
    if (loss.stage !== "VALIDATION" ||
        loss.reason !== "official detail places the job outside mainland China" ||
        loss.details?.code !== "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE" ||
        !Number.isSafeInteger(recordIndex) || (recordIndex as number) < 0 || indexes.has(recordIndex as number) ||
        !/^grifols-detail-\d{4}#grifols-successfactors-detail-v1\|html:canonical\+streetAddress\+content-location$/u
          .test(loss.rawLocator)) return undefined;
    indexes.add(recordIndex as number);
    rows.push({
      rawLocatorSha256: sha256(loss.rawLocator),
      recordIndex: recordIndex as number,
      code: "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE"
    });
  }
  return rows.sort((left, right) => left.recordIndex - right.recordIndex);
}

function rejected(blockers: ReadonlySet<AGradeCertificateBlockerCode>): AGradeCertificateDecision {
  const blockerCodes = [...blockers].sort(compareUtf8);
  if (blockerCodes.length === 0) blockerCodes.push("EVIDENCE_INVALID");
  return { status: "REJECTED", blockerCodes };
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
