import { buildJobProjectionDeltaReceipt } from "./jobProjectionDeltaCompiler";
import { persistedJobProjection, hashJobPersistedProjection, JOB_SOURCE_UPDATE_FIELDS, isJobProjectionDeltaReceipt, parseJobProjectionDeltaReceipt } from "../domain/jobProjectionDeltaReceipt";
import { hasBoundJnjDomOfficialArtifact } from "./jnjDomEvidenceAdmission";
import { compileAtomicJsonDeclarations, compileAtomicJsonRecords as sqlRecords } from "./atomicJsonDeclarations";
import type { CloudPilotDbStartedInput } from "./cloudPilotSqlControl";
import { portableSourceResultSelect, type PortableSourceResultRow } from "./portablePublicSnapshotRepository";
import { SOURCE_QUALITY_POLICY_ID, SOURCE_QUALITY_RECEIPT_SCHEMA, verifySourceQualityReceipt, verifySourceQualityAtomicCommit } from "../crawler/sourceQualityAdmission";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../crawler/sourcePlan";
import { candidateCompanies } from "../data/companyRegistry";
import { fencePortableCrawlPublication, assertPortableCrawlLeaseOwned, PORTABLE_CRAWL_LEASE_MS, type PortableCrawlLease, type PortableLeaseTransaction } from "../crawler/portableCrawlLease";
import type { IngestionCommand } from "../crawler/ingestion";
import { createHash, randomUUID } from "node:crypto";
import { containsCredentialMaterial } from "../security/credentialMaterial";
import { canonicalizePlannedSourceIds, hashCanonicalStringSet } from "../crawler/runtimeBatchIdentity";
import {
  isSourceFailureCategory,
  isSourceFailureDiagnosticCode,
  tagAtomicEvidencePersistenceStage,
  type AtomicEvidencePersistenceStage,
  type SourceFailureCategory,
  type SourceFailureDiagnosticCode
} from "../crawler/sourceFailureDiagnostics";
import {
  toPrismaJobCategory,
  fromPrismaJobCategory,
  fromPrismaRequiredJobField,
  toPrismaLifecycleStatus,
  toPrismaRequiredJobField,
  type PrismaCompletenessEvidenceKindName,
  type PrismaCompletenessStatusName,
  type PrismaJobCategoryName,
  type PrismaLifecycleStatusName,
  type PrismaRequiredJobFieldName
} from "./prismaMappers";
import {
  requiresAGradeCertificateSourceId,
  verifyAGradeCompletenessCertificateReceipt
} from "../crawler/completenessCertificate";
import {
  requiresBGradeCertificateSourceId,
  requiresBGradeTraversalCertificate,
  verifyBGradeTraversalCertificateReceipt,
  B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS,
  type SanofiArtifactCommitment
} from "../crawler/traversalCertificate";
import {
  assertTrustedBaselineTransition,
  canonicalCompletenessAnomalyTriggerCodes,
  evaluateCompletenessAnomalyForCrawl,
  selectCompletenessValidationTrigger,
  type TrustedBaselineChangeReason
} from "../crawler/completenessAnomalyPolicy";
import { isRetryableSourceTransportFailureCode } from "../crawler/sourceFetchFailure";

interface CrawlObservationCreateArgs {
  data: {
    sourceId: string;
    batchId: string;
    crawledAt: Date;
    successful: boolean;
    structuredJobCount: number;
    expectedJobCount: number | null;
    completenessStatus: PrismaCompletenessStatusName | null;
    completenessEvidenceKind: PrismaCompletenessEvidenceKindName | null;
    completenessEvidenceUrl: string | null;
    completenessBlockerReason: string | null;
    totalPages: number | null;
    pageSize: number | null;
    pagesVisited: number | null;
    stableRequiredFields: PrismaRequiredJobFieldName[];
    failureReason: string | null;
  };
}

interface JobUpsertData {
  companyId: string;
  sourceId: string;
  dedupeKey: string;
  sourceJobId: string | null;
  officialTitle: string;
  auxiliaryChineseTitle: string | null;
  officialUrl: string;
  listUrl: string | null;
  locationRaw: string;
  city: string;
  cities: string[];
  category: PrismaJobCategoryName;
  officialPublishedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  missingSuccessCount: number;
  lifecycleStatus: PrismaLifecycleStatusName;
  visibleInFrontend: boolean;
  isNew: boolean;
}

interface JobUpdateData {
  sourceJobId: string | null;
  officialTitle: string;
  officialUrl: string;
  listUrl: string | null;
  locationRaw: string;
  city: string;
  cities: string[];
  officialPublishedAt: Date | null;
  lastSeenAt: Date;
  missingSuccessCount: number;
  lifecycleStatus: PrismaLifecycleStatusName;
  visibleInFrontend: boolean;
  isNew: boolean;
}

interface JobUpsertArgs {
  where: {
    sourceId_dedupeKey: {
      sourceId: string;
      dedupeKey: string;
    };
  };
  create: JobUpsertData;
  update: JobUpdateData;
}

export interface PrismaIngestionTransactionClient {
  crawlObservation: {
    create(args: CrawlObservationCreateArgs): Promise<unknown>;
  };
  job: {
    upsert(args: JobUpsertArgs): Promise<unknown>;
  };
}

export interface PrismaIngestionDb {
  $transaction<T>(
    operation: (transaction: PrismaIngestionTransactionClient) => Promise<T>
  ): Promise<T>;
}

export interface IngestionExecutionContext {
  batchId: string;
}

type TransportState = "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "SKIPPED";
type AdapterState = TransportState;
type AtomicCommitState = "PENDING" | "COMMITTED" | "ROLLED_BACK" | "NOT_ATTEMPTED" | "FAILED";
type EvidenceArtifactKind =
  | "OFFICIAL_COMPANY_PAGE" | "REDIRECT_TRACE" | "ATS_PAGE" | "ATS_API_RESPONSE"
  | "PAGINATION_PAGE" | "SCREENSHOT" | "DEDUPE_LEDGER" | "ORACLE_RESULT"
  | "COMMAND_OUTPUT";
type LossStage = "PARSE" | "VALIDATION" | "NORMALIZATION" | "DEDUPE";
type PaginationTermination =
  | "CONTINUE" | "NEXT_ABSENT" | "DECLARED_TOTAL_REACHED" | "EMPTY_PAGE" | "REPEATED_CURSOR"
  | "MAX_PAGE_LIMIT" | "FAILED" | "ABORTED";
type PaginationAnomalyCode =
  | "REPEATED_RESPONSE_FINGERPRINT" | "REPEATED_JOB_ID_SET_WITH_NEXT"
  | "CURSOR_NOT_ADVANCING" | "OFFSET_NOT_ADVANCING" | "INTERMEDIATE_EMPTY_PAGE"
  | "TOTAL_CHANGED" | "MAX_PAGES_WITH_NEXT" | "EXPECTED_CHANNEL_NOT_VISITED"
  | "RETURNED_PAGE_MISMATCH" | "DECLARED_CAPACITY_CONTRADICTION"
  | "RAW_ID_OVERLAP_ACROSS_PAGES" | "INTERMEDIATE_SHORT_PAGE"
  | "RETURNED_PAGE_SIZE_MISMATCH";
type TransportAttemptKind = "DIRECT_HTTP" | "BROWSER_SESSION";
type TransportAttemptOutcome = "FAILED" | "SUCCEEDED";
type TransportAttemptCode = "HCM_DIRECT_FAILED" | "HCM_BROWSER_SESSION_FAILED" |
  "HCM_BROWSER_ENTRY_FAILED" | "HCM_BROWSER_COUNT_FAILED" | "HCM_BROWSER_LIST_FAILED" |
  "HCM_BROWSER_SUCCEEDED" | "JNJ_DIRECT_FAILED" | "JNJ_BROWSER_SESSION_FAILED" |
  "JNJ_BROWSER_FETCH_FAILED" | "JNJ_BROWSER_SUCCEEDED";

interface EvidenceTuple {
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  sourceResultId: string;
}

export interface AtomicSourceResultInput {
  id: string;
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  transportState: TransportState;
  adapterState: AdapterState;
  completenessState: PrismaCompletenessStatusName;
  atomicCommitState: AtomicCommitState;
  sourceConfigHash: string;
  adapterVersion: string;
  officialEntryId: string | null;
  officialSurfaceIds: string[];
  officialChannelIds: string[];
  startedAt: Date;
  finishedAt: Date | null;
  rawCount: number;
  parsedCount: number;
  validCount: number;
  normalizedCount: number;
  dedupeInputCount: number;
  dedupeOutputCount: number;
  parseDiscardCount: number;
  validationDiscardCount: number;
  normalizationDiscardCount: number;
  dedupeDiscardCount: number;
  collisionCount: number;
  discardCount: number;
  expectedJobCount: number | null;
  expectedEvidenceKind: PrismaCompletenessEvidenceKindName | null;
  expectedSurfaceSha256: string | null;
  visitedSurfaceSha256: string | null;
  expectedChannelSha256: string | null;
  visitedChannelSha256: string | null;
  canonicalCurrentJobSetSha256: string | null;
  canonicalGraceJobSetSha256: string | null;
  canonicalVisibleJobSetSha256: string | null;
  canonicalOutputSetSha256: string;
  adapterInputCount: number;
  adapterOutputCount: number;
  adapterLossCount: number;
  adapterCollisionGroupCount: number;
  adapterReconciliationSha256: string;
  collisionLedgerSha256: string;
  completenessCertificate: unknown | null;
  completenessCertificateSha256: string | null;
  baselinePreviousSourceResultId?: string | null;
  baselinePreviousJobCount?: number | null;
  baselineChangeReason?: TrustedBaselineChangeReason | null;
  blockerCode?: string | null;
  blockerReason?: string | null;
  failureCategory?: SourceFailureCategory | null;
  failureDiagnosticCode?: SourceFailureDiagnosticCode | null;
  fetchAttemptCount?: number | null;
  retryCount?: number | null;
  retryReasonCodes?: string[];
  failureCode?: string | null;
  failureReason?: string | null;
}

export interface AtomicObservationProvenance extends EvidenceTuple {
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterVersion: string;
  observedFrom: Date;
  observedTo: Date;
  transportSucceeded: boolean;
  adapterSucceeded: boolean;
  completenessVerified: boolean;
  atomicCommitSucceeded: boolean;
  canonicalRawSha256: string;
  canonicalOutputSha256: string;
  canonicalGraceSha256: string;
  canonicalVisibleSha256: string;
  expectedSurfaceSha256: string | null;
  visitedSurfaceSha256: string | null;
  expectedChannelSha256: string | null;
  visitedChannelSha256: string | null;
  paginationTraceSha256: string;
  officialEvidenceArtifactLogicalKey: string;
  artifactRedactionCommitmentSha256: string;
}

export interface AtomicEvidenceArtifactInput extends EvidenceTuple {
  id: string;
  logicalKey: string;
  channelId?: string | null;
  kind: EvidenceArtifactKind;
  requestedUrl?: string;
  finalUrl?: string;
  httpStatus?: number;
  contentType?: string;
  capturedAt: Date;
  sha256: string;
  byteCount: number;
  path: string;
  extractorLocator: string;
  captureToolName: string;
  captureToolVersion: string;
  redactionCommitmentSha256: string;
}

export interface AtomicPaginationEvidenceInput extends EvidenceTuple {
  artifactLogicalKey: string;
  sequence: number;
  channelId?: string | null;
  requestedCursor?: string | null;
  returnedCursor?: string | null;
  requestedOffset?: number | null;
  returnedOffset?: number | null;
  requestedPage?: number | null;
  returnedPage?: number | null;
  requestedPageSize?: number | null;
  returnedPageSize?: number | null;
  responseFingerprintSha256: string;
  rawJobIdSetSha256: string;
  validJobIdSetSha256: string;
  declaredTotal?: number | null;
  declaredCount?: number | null;
  declaredPages?: number | null;
  nextPageSignalBefore?: string | null;
  nextPageSignalAfter?: string | null;
  termination: PaginationTermination;
  anomalyCodes: PaginationAnomalyCode[];
  capturedAt: Date;
}

export interface AtomicLossLedgerInput extends EvidenceTuple {
  stage: LossStage;
  reason: string;
  rawLocator: string;
  details: unknown;
  candidateKey?: string | null;
  winnerKey?: string | null;
  recordedAt?: Date;
}

export interface AtomicTransportAttemptInput extends EvidenceTuple {
  id: string;
  sequence: number;
  transport: TransportAttemptKind;
  outcome: TransportAttemptOutcome;
  code: TransportAttemptCode;
  capturedAt: Date;
  evidenceCommitmentSha256: string;
  pageTraceSha256: string;
  lossLedgerSha256: string;
  paginationEvaluationSha256: string;
  artifactIds: string[];
  details: unknown;
}

export interface AtomicSourceEvidenceCommit {
  /** Portable mode persists evidence only on rejection; never partial Job refreshes. */
  publicationPolicy?: "SOURCE_ATOMIC_LAST_GOOD_V1";
  sourceResult: AtomicSourceResultInput;
  observationProvenance: AtomicObservationProvenance;
  artifacts: AtomicEvidenceArtifactInput[];
  pagination: AtomicPaginationEvidenceInput[];
  lossLedger: AtomicLossLedgerInput[];
  priorTransportAttempts: AtomicTransportAttemptInput[];
  commands: IngestionCommand[];
}

interface ConditionalUpdateResult { count: number }

interface AtomicSourceTransactionClient extends PrismaIngestionTransactionClient {
  $queryRawUnsafe?<T>(query: string, ...values: unknown[]): Promise<T>;
  crawlBatchSourceResult: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<ConditionalUpdateResult>
  };
  evidenceArtifact: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  paginationEvidence: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  lossLedgerEntry: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  transportAttemptEvidence: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  transportAttemptArtifact: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  lifecycleSetEvidenceMember: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface PrismaAtomicSourceEvidenceDb {
  $transaction<T>(
    operation: (transaction: AtomicSourceTransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number }
  ): Promise<T>;
}

export const ATOMIC_EVIDENCE_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 120_000
} as const;

export type PersistedAtomicCommitOutcome =
  | { state: "COMMITTED_EXACT" }
  | { state: "PENDING" }
  | { state: "CONFLICT" };

export interface PersistedBatchSourceResultRow extends Partial<PortableSourceResultRow> {
  sourceId: string;
  transportState: TransportState;
  adapterState: AdapterState;
  completenessState: PrismaCompletenessStatusName | "PENDING";
  atomicCommitState: AtomicCommitState;
  failureCode: string | null;
}

export interface PrismaSourceResultReadDb {
  crawlBatchSourceResult: {
    findUnique(args: {
      where: { id: string };
      include?: Record<string, unknown>;
    }): Promise<Record<string, unknown> | null>;
    findMany(args: {
      where: { releaseCandidateId: string; batchId: string };
      select: typeof portableSourceResultSelect;
      orderBy: { sourceId: "asc" };
    }): Promise<PersistedBatchSourceResultRow[]>;
  };
}

export type ManualSourceCommitFence = { requestId: string; ownerId: string };

export class ManualSourceCommitFenceError extends Error {
  readonly code = "MANUAL_CRAWL_OWNERSHIP_LOST";
  constructor() {
    super("MANUAL_CRAWL_OWNERSHIP_LOST");
    this.name = "ManualSourceCommitFenceError";
  }
}

type PlannedBatchKind = "FULL_RELEASE" | "SCHEDULED" | "MANUAL_SOURCE" | "BASELINE";

export interface PlannedBatchInput {
  id: string;
  releaseCandidateId: string;
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  kind: PlannedBatchKind;
  manualCrawlRequestId?: string;
  plannedSourceIds: string[];
  plannedSourceSetSha256: string;
  plannedSourceCount: number;
  ownerId: string;
  heartbeatAt: Date;
  startedAt: Date;
}

export interface PlannedPendingSourceInput {
  id: string;
  sourceId: string;
  sourceConfigHash: string;
  adapterVersion: string;
  officialEntryId: string | null;
  officialSurfaceIds: string[];
  officialChannelIds: string[];
  startedAt: Date;
}

export interface PlannedBatchWithSourcesInput {
  batch: PlannedBatchInput;
  sources: PlannedPendingSourceInput[];
}

interface PlannedBatchTransactionClient {
  $queryRawUnsafe?<T>(query: string, ...values: unknown[]): Promise<T>;
  crawlBatch: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  crawlBatchSourceResult: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface PrismaPlannedBatchDb {
  $transaction<T>(operation: (transaction: PlannedBatchTransactionClient) => Promise<T>): Promise<T>;
}

export interface PendingSourceTerminalInput {
  id: string;
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  transportState: Exclude<TransportState, "PENDING">;
  adapterState: Exclude<AdapterState, "PENDING">;
  completenessState: Exclude<PrismaCompletenessStatusName, "VERIFIED">;
  atomicCommitState: "NOT_ATTEMPTED" | "ROLLED_BACK" | "FAILED";
  finishedAt: Date;
  failureCode: string;
  failureReason: string;
  blockerCode?: string | null;
  blockerReason?: string | null;
  failureCategory?: SourceFailureCategory | null;
  failureDiagnosticCode?: SourceFailureDiagnosticCode | null;
  fetchAttemptCount?: number | null;
  retryCount?: number | null;
  retryReasonCodes?: string[];
}

export interface FailedSourceEvidenceCommit {
  sourceResult: PendingSourceTerminalInput;
  fetchCounts: {
    rawCount: number;
    parsedCount: number;
    validCount: number;
    parseDiscardCount: number;
    validationDiscardCount: number;
  };
  expectedJobCount: number | null;
  expectedEvidenceKind: PrismaCompletenessEvidenceKindName | null;
  artifacts: AtomicEvidenceArtifactInput[];
  pagination: AtomicPaginationEvidenceInput[];
  lossLedger: AtomicLossLedgerInput[];
  priorTransportAttempts: AtomicTransportAttemptInput[];
}

interface PendingSourceTerminalTransactionClient {
  crawlBatchSourceResult: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<ConditionalUpdateResult>
  };
}

export interface PrismaPendingSourceTerminalDb {
  $transaction<T>(operation: (transaction: PendingSourceTerminalTransactionClient) => Promise<T>): Promise<T>;
}

export async function createBatchWithPendingSourceResults(
  input: PlannedBatchWithSourcesInput,
  db: PrismaPlannedBatchDb
): Promise<void> {
  const sources = validatePlannedBatchWithSources(input);
  const batch = input.batch;
  await db.$transaction(async (transaction) => {
    if (batch.kind === "MANUAL_SOURCE") {
      if (!transaction.$queryRawUnsafe) throw new ManualSourceCommitFenceError();
      const owned = await transaction.$queryRawUnsafe<Array<{ id: string }>>(MANUAL_BATCH_CREATE_FENCE_SQL,
        batch.manualCrawlRequestId, batch.ownerId, sources[0]!.sourceId);
      if (owned.length !== 1 || owned[0]?.id !== batch.manualCrawlRequestId) {
        throw new ManualSourceCommitFenceError();
      }
    }
    await transaction.crawlBatch.create({ data: {
      ...batch,
      plannedSourceIds: [...batch.plannedSourceIds],
      status: "RUNNING",
      finishedAt: null,
      aggregateJobSetSha256: null,
      transportSucceededCount: 0,
      transportFailedCount: 0,
      adapterSucceededCount: 0,
      adapterFailedCount: 0,
      completenessVerifiedCount: 0,
      completenessIncompleteCount: 0,
      atomicCommittedCount: 0,
      atomicFailedCount: 0,
      failedSourceCount: 0,
      blockedSourceCount: 0,
      skippedSourceCount: 0
    } });
    for (const source of sources) {
      await transaction.crawlBatchSourceResult.create({ data: {
        ...source,
        releaseCandidateId: batch.releaseCandidateId,
        batchId: batch.id,
        transportState: "PENDING",
        adapterState: "PENDING",
        completenessState: "PENDING",
        atomicCommitState: "PENDING",
        finishedAt: null,
        rawCount: 0,
        parsedCount: 0,
        validCount: 0,
        normalizedCount: 0,
        dedupeInputCount: 0,
        dedupeOutputCount: 0,
        parseDiscardCount: 0,
        validationDiscardCount: 0,
        normalizationDiscardCount: 0,
        dedupeDiscardCount: 0,
        collisionCount: 0,
        discardCount: 0,
        expectedJobCount: null,
        expectedEvidenceKind: null,
        expectedSurfaceSha256: null,
        visitedSurfaceSha256: null,
        expectedChannelSha256: null,
        visitedChannelSha256: null,
        canonicalCurrentJobSetSha256: null,
        canonicalGraceJobSetSha256: null,
        canonicalVisibleJobSetSha256: null,
        canonicalOutputSetSha256: null,
        adapterInputCount: null,
        adapterOutputCount: null,
        adapterLossCount: null,
        adapterCollisionGroupCount: null,
        adapterReconciliationSha256: null,
        collisionLedgerSha256: null,
        completenessCertificate: null,
        completenessCertificateSha256: null,
        blockerCode: null,
        blockerReason: null,
        failureCategory: null,
        failureDiagnosticCode: null,
        fetchAttemptCount: null,
        retryCount: null,
        retryReasonCodes: [],
        failureCode: null,
        failureReason: null
      } });
    }
  });
}

const MANUAL_BATCH_CREATE_FENCE_SQL = `
SELECT request."id"
FROM "ManualCrawlRequest" AS request
WHERE request."id" = $1 AND request."ownerId" = $2 AND request."sourceId" = $3
  AND request."status" = 'RUNNING' AND request."leaseExpiresAt" > clock_timestamp()
FOR UPDATE
`;

export async function terminatePendingSourceResult(
  input: PendingSourceTerminalInput,
  db: PrismaPendingSourceTerminalDb
): Promise<void> {
  validatePendingSourceTerminal(input);
  await db.$transaction(async (transaction) => {
    const result = await transaction.crawlBatchSourceResult.updateMany({
      where: pendingSourceTupleWhere(input),
      data: pendingSourceTerminalData(input)
    });
    requireExactlyOnePendingResult(result);
  });
}

export async function terminateManualPendingSourceResult(
  input: PendingSourceTerminalInput,
  fence: ManualSourceCommitFence,
  db: PrismaAtomicSourceEvidenceDb
): Promise<void> {
  validatePendingSourceTerminal(input);
  await db.$transaction(async (transaction) => {
    await assertManualSourceCommitFence(transaction, fence, input.sourceId, input.batchId);
    const result = await transaction.crawlBatchSourceResult.updateMany({
      where: pendingSourceTupleWhere(input),
      data: pendingSourceTerminalData(input)
    });
    requireExactlyOnePendingResult(result);
  }, ATOMIC_EVIDENCE_TRANSACTION_OPTIONS);
}

function pendingSourceTerminalData(input: PendingSourceTerminalInput): Record<string, unknown> {
  return {
    transportState: input.transportState, adapterState: input.adapterState,
    completenessState: input.completenessState, atomicCommitState: input.atomicCommitState,
    finishedAt: input.finishedAt, failureCode: input.failureCode, failureReason: input.failureReason,
    blockerCode: input.blockerCode ?? null, blockerReason: input.blockerReason ?? null,
    failureCategory: input.failureCategory ?? null,
    failureDiagnosticCode: input.failureDiagnosticCode ?? null,
    fetchAttemptCount: input.fetchAttemptCount ?? null, retryCount: input.retryCount ?? null,
    retryReasonCodes: input.retryReasonCodes ?? []
  };
}

export async function executeFailedSourceEvidenceCommit(
  input: FailedSourceEvidenceCommit,
  db: PrismaAtomicSourceEvidenceDb
): Promise<void> {
  return executeFailedSourceEvidenceCommitInternal(input, db);
}

export async function executeManualFailedSourceEvidenceCommit(
  input: FailedSourceEvidenceCommit,
  fence: ManualSourceCommitFence,
  db: PrismaAtomicSourceEvidenceDb
): Promise<void> {
  if (fence.requestId.trim() === "" || fence.ownerId.trim() === "") {
    throw new ManualSourceCommitFenceError();
  }
  return executeFailedSourceEvidenceCommitInternal(input, db, fence);
}

async function executeFailedSourceEvidenceCommitInternal(
  input: FailedSourceEvidenceCommit,
  db: PrismaAtomicSourceEvidenceDb,
  manualFence?: ManualSourceCommitFence
): Promise<void> {
  let stage: AtomicEvidencePersistenceStage = "ATTESTATION";
  try {
  const { verifyFailedRuntimeEvidenceCommitAttestation } = await import("../crawler/runtimeAtomicEvidence");
  verifyFailedRuntimeEvidenceCommitAttestation(input);
  stage = "INPUT_VALIDATION";
  validatePendingSourceTerminal(input.sourceResult);
  if (input.sourceResult.atomicCommitState !== "NOT_ATTEMPTED") {
    throw new Error("Failed diagnostic evidence cannot claim an atomic source commit");
  }
  const tuple: EvidenceTuple = {
    releaseCandidateId: input.sourceResult.releaseCandidateId,
    batchId: input.sourceResult.batchId,
    sourceId: input.sourceResult.sourceId,
    sourceResultId: input.sourceResult.id
  };
  const artifactIdsByLogicalKey = validateDiagnosticArtifacts(input.artifacts, tuple);
  validateDiagnosticPagination(input.pagination, tuple, artifactIdsByLogicalKey);
  validateDiagnosticLossLedger(input.lossLedger, tuple, input.fetchCounts);
  validateDiagnosticTransportAttempts(input.priorTransportAttempts, tuple, input.artifacts);
  for (const [name, value] of Object.entries(input.fetchCounts)) requireNonnegativeInteger(value, name);
  if (input.fetchCounts.rawCount !== input.fetchCounts.parsedCount + input.fetchCounts.parseDiscardCount ||
      input.fetchCounts.parsedCount !== input.fetchCounts.validCount + input.fetchCounts.validationDiscardCount) {
    throw new Error("Failed diagnostic fetch counts do not reconcile");
  }
  if (input.expectedJobCount !== null) requireNonnegativeInteger(input.expectedJobCount, "expectedJobCount");

  stage = "TRANSACTION_COMMIT";
  await db.$transaction(async (transaction) => {
    if (manualFence) {
      stage = "OWNERSHIP_FENCE";
      await assertManualSourceCommitFence(transaction, manualFence, input.sourceResult.sourceId,
        input.sourceResult.batchId);
    }
    stage = "ARTIFACT_WRITE";
    for (const artifact of input.artifacts) {
      const { logicalKey: _logicalKey, ...data } = artifact;
      await transaction.evidenceArtifact.create({ data });
    }
    stage = "PAGINATION_WRITE";
    for (const page of input.pagination) {
      const { artifactLogicalKey, ...data } = page;
      await transaction.paginationEvidence.create({
        data: { ...data, artifactId: artifactIdsByLogicalKey.get(artifactLogicalKey) }
      });
    }
    stage = "LOSS_LEDGER_WRITE";
    for (const loss of input.lossLedger) {
      await transaction.lossLedgerEntry.create({ data: { ...loss } });
    }
    stage = "TRANSPORT_ATTEMPT_WRITE";
    for (const attempt of input.priorTransportAttempts) {
      const { artifactIds, ...attemptData } = attempt;
      await transaction.transportAttemptEvidence.create({ data: attemptData });
      for (const artifactId of artifactIds) {
        await transaction.transportAttemptArtifact.create({ data: {
          attemptId: attempt.id, artifactId, releaseCandidateId: attempt.releaseCandidateId,
          batchId: attempt.batchId, sourceId: attempt.sourceId, sourceResultId: attempt.sourceResultId
        } });
      }
    }
    stage = "SOURCE_TERMINAL_WRITE";
    const result = await transaction.crawlBatchSourceResult.updateMany({
      where: pendingSourceTupleWhere(input.sourceResult),
      data: {
        transportState: input.sourceResult.transportState,
        adapterState: input.sourceResult.adapterState,
        completenessState: input.sourceResult.completenessState,
        atomicCommitState: input.sourceResult.atomicCommitState,
        finishedAt: input.sourceResult.finishedAt,
        failureCode: input.sourceResult.failureCode,
        failureReason: input.sourceResult.failureReason,
        blockerCode: input.sourceResult.blockerCode ?? null,
        blockerReason: input.sourceResult.blockerReason ?? null,
        failureCategory: input.sourceResult.failureCategory ?? null,
        failureDiagnosticCode: input.sourceResult.failureDiagnosticCode ?? null,
        fetchAttemptCount: input.sourceResult.fetchAttemptCount ?? null,
        retryCount: input.sourceResult.retryCount ?? null,
        retryReasonCodes: input.sourceResult.retryReasonCodes ?? [],
        ...input.fetchCounts,
        discardCount: input.fetchCounts.parseDiscardCount + input.fetchCounts.validationDiscardCount,
        expectedJobCount: input.expectedJobCount,
        expectedEvidenceKind: input.expectedEvidenceKind
      }
    });
    requireExactlyOnePendingResult(result);
    stage = "TRANSACTION_COMMIT";
  }, ATOMIC_EVIDENCE_TRANSACTION_OPTIONS);
  } catch (error) {
    throw tagAtomicEvidencePersistenceStage(error, stage);
  }
}

export async function executeIngestionCommands(
  commands: readonly IngestionCommand[],
  context: IngestionExecutionContext,
  db: PrismaIngestionDb
): Promise<void> {
  await db.$transaction(async (transaction) => {
    await executeIngestionCommandsInTransaction(commands, context, transaction);
  });
}

async function executeIngestionCommandsInTransaction(
  commands: readonly IngestionCommand[],
  context: IngestionExecutionContext,
  db: PrismaIngestionTransactionClient
): Promise<void> {
  for (const command of commands) {
    if (command.type === "UPSERT_CRAWL_OBSERVATION") {
      await db.crawlObservation.create({
        data: {
          sourceId: command.observation.sourceId,
          batchId: context.batchId,
          crawledAt: command.observation.crawledAt,
          successful: command.observation.successful,
          structuredJobCount: command.observation.structuredJobCount,
          expectedJobCount: command.observation.expectedJobCount ?? null,
          completenessStatus: command.observation.completenessStatus ?? null,
          completenessEvidenceKind: command.observation.completenessEvidenceKind ?? null,
          completenessEvidenceUrl: command.observation.completenessEvidenceUrl ?? null,
          completenessBlockerReason: command.observation.completenessBlockerReason ?? null,
          totalPages: command.observation.totalPages ?? null,
          pageSize: command.observation.pageSize ?? null,
          pagesVisited: command.observation.pagesVisited ?? null,
          stableRequiredFields: command.observation.stableRequiredFields.map(
            toPrismaRequiredJobField
          ),
          failureReason: command.observation.failureReason ?? null
        }
      });

      continue;
    }

    await upsertJobCommand(command, db);
  }
}

async function upsertJobCommand(
  command: Extract<IngestionCommand, { type: "UPSERT_JOB" }>,
  db: Pick<PrismaIngestionTransactionClient, "job">
): Promise<void> {
  await db.job.upsert(jobUpsertArgs(command));
}

/** Pure data export from the SAME private persisted mapper used by delta receipts.
 * No write, callback, SQL parse, authority, or compiler behavior is introduced. */
export function jobPersistedProjectionForCommand(command: Extract<IngestionCommand, { type: "UPSERT_JOB" }>) {
  const args = jobUpsertArgs(command);
  return persistedJobProjection({...args.create, ...args.update});
}

function jobUpsertArgs(command: Extract<IngestionCommand, { type: "UPSERT_JOB" }>): JobUpsertArgs {
  const primaryCity = command.record.cities[0];
  if (!primaryCity) {
    throw new Error(`Cannot ingest job ${command.dedupeKey} without at least one city`);
  }

  return {
      where: {
        sourceId_dedupeKey: {
          sourceId: command.record.sourceId,
          dedupeKey: command.dedupeKey
        }
      },
      create: {
        companyId: command.record.companyId,
        sourceId: command.record.sourceId,
        dedupeKey: command.dedupeKey,
        sourceJobId: command.record.sourceJobId ?? null,
        officialTitle: command.record.officialTitle,
        auxiliaryChineseTitle: command.record.auxiliaryChineseTitle ?? null,
        officialUrl: command.record.officialUrl,
        listUrl: command.record.listUrl ?? null,
        locationRaw: command.record.locationRaw,
        city: primaryCity,
        cities: [...command.record.cities],
        category: toPrismaJobCategory(command.record.category),
        officialPublishedAt: toOptionalDate(command.record.officialPublishedAt),
        firstSeenAt: new Date(command.firstSeenAt),
        lastSeenAt: new Date(command.lastSeenAt),
        missingSuccessCount: command.missingSuccessfulCrawlCount,
        lifecycleStatus: toPrismaLifecycleStatus(command.lifecycleStatus),
        visibleInFrontend: command.visibleInFrontend,
        isNew: command.isNew
      },
      update: {
        sourceJobId: command.record.sourceJobId ?? null,
        officialTitle: command.record.officialTitle,
        officialUrl: command.record.officialUrl,
        listUrl: command.record.listUrl ?? null,
        locationRaw: command.record.locationRaw,
        city: primaryCity,
        cities: [...command.record.cities],
        officialPublishedAt: toOptionalDate(command.record.officialPublishedAt),
        lastSeenAt: new Date(command.lastSeenAt),
        missingSuccessCount: command.missingSuccessfulCrawlCount,
        lifecycleStatus: toPrismaLifecycleStatus(command.lifecycleStatus),
        visibleInFrontend: command.visibleInFrontend,
        isNew: command.isNew
      }
  };
}

export async function executeAtomicSourceEvidenceCommit(
  input: AtomicSourceEvidenceCommit,
  db: PrismaAtomicSourceEvidenceDb
): Promise<void> {
  return executeAtomicSourceEvidenceCommitInternal(input, db);
}

/** Portable public writes participate in the same DB-time lease transaction. */
export async function executePortableAtomicSourceEvidenceCommit(
  input: AtomicSourceEvidenceCommit, lease: PortableCrawlLease, db: PrismaAtomicSourceEvidenceDb
): Promise<void> {
  if (input.publicationPolicy !== "SOURCE_ATOMIC_LAST_GOOD_V1") throw new Error("Portable publication policy is required");
  return executeAtomicSourceEvidenceCommitInternal(input, db, undefined, lease);
}

export async function inspectPersistedAtomicCommitOutcome(
  input: AtomicSourceEvidenceCommit,
  db: PrismaSourceResultReadDb
): Promise<PersistedAtomicCommitOutcome> {
  const persisted = await db.crawlBatchSourceResult.findUnique({
    where: { id: input.sourceResult.id }
  });
  if (!persisted) return { state: "CONFLICT" };
  if (isExpectedPendingSourceResult(persisted, input.sourceResult)) return { state: "PENDING" };
  if(isJobProjectionDeltaReceipt(input.sourceResult.completenessCertificate)){
    try{
      const expected=parseJobProjectionDeltaReceipt(input.sourceResult.completenessCertificate,input.sourceResult.completenessCertificateSha256??"");
      const actual=parseJobProjectionDeltaReceipt(persisted.completenessCertificate,String(persisted.completenessCertificateSha256));
      if(expected.manifestSha256!==actual.manifestSha256)return {state:"CONFLICT"};
    }catch{return {state:"CONFLICT"};}
  }
  if (isExactPersistedSourceResult(persisted, input.sourceResult)) {
    return { state: "COMMITTED_EXACT" };
  }
  if (isExpectedPendingSourceResult(persisted, input.sourceResult)) {
    return { state: "PENDING" };
  }
  return { state: "CONFLICT" };
}

export async function inspectPersistedFailedSourceEvidenceCommitOutcome(
  input: FailedSourceEvidenceCommit,
  db: PrismaSourceResultReadDb
): Promise<PersistedAtomicCommitOutcome> {
  const persisted = await db.crawlBatchSourceResult.findUnique({
    where: { id: input.sourceResult.id },
    include: {
      evidenceArtifacts: true,
      paginationEvidence: true,
      lossLedgerEntries: true,
      observations: true,
      transportAttempts: { include: { artifactRefs: true } }
    }
  });
  if (!persisted) return { state: "CONFLICT" };
  if (isExpectedPendingFailedSourceResult(persisted, input.sourceResult)) return { state: "PENDING" };
  return isExactPersistedFailedEvidence(persisted, input)
    ? { state: "COMMITTED_EXACT" }
    : { state: "CONFLICT" };
}

export async function readPersistedBatchSourceResults(
  input: { releaseCandidateId: string; batchId: string },
  db: PrismaSourceResultReadDb
): Promise<PersistedBatchSourceResultRow[]> {
  return db.crawlBatchSourceResult.findMany({
    where: {
      releaseCandidateId: input.releaseCandidateId,
      batchId: input.batchId
    },
    select: portableSourceResultSelect,
    orderBy: { sourceId: "asc" }
  });
}

export async function executeManualSourceEvidenceCommit(
  input: AtomicSourceEvidenceCommit,
  fence: ManualSourceCommitFence,
  db: PrismaAtomicSourceEvidenceDb
): Promise<void> {
  if (fence.requestId.trim() === "" || fence.ownerId.trim() === "") {
    throw new ManualSourceCommitFenceError();
  }
  if (input.commands.some((command) => command.type === "UPSERT_JOB")) {
    throw new Error("Manual source preview cannot contain Job lifecycle commands");
  }
  return executeAtomicSourceEvidenceCommitInternal(input, db, fence);
}

async function executeAtomicSourceEvidenceCommitInternal(
  input: AtomicSourceEvidenceCommit,
  db: PrismaAtomicSourceEvidenceDb,
  manualFence?: ManualSourceCommitFence,
  portableLease?: PortableCrawlLease
): Promise<void> {
  if (input.publicationPolicy === "SOURCE_ATOMIC_LAST_GOOD_V1" && !portableLease) {
    throw new Error("PORTABLE_PUBLICATION_LEASE_REQUIRED");
  }
  let stage: AtomicEvidencePersistenceStage = "ATTESTATION";
  try {
    const { writes, sourceId, batchId } = await prepareAtomicWritePlan(input, manualFence !== undefined,
      validationStage => { stage = validationStage; });

    stage = "TRANSACTION_COMMIT";
    await db.$transaction(async (transaction) => {
    if (portableLease) {
      stage = "OWNERSHIP_FENCE";
      if (!transaction.$queryRawUnsafe) throw new Error("Portable transaction SQL fence is unavailable");
      await fencePortableCrawlPublication(transaction as PortableLeaseTransaction, portableLease);
    }
    if (manualFence) {
      stage = "OWNERSHIP_FENCE";
      await assertManualSourceCommitFence(transaction, manualFence, sourceId, batchId);
    }
    for (const write of writes) {
      stage = write.stage;
      if (write.kind === "job") await transaction.job.upsert(write.args);
      else if (write.kind === "terminal") requireExactlyOnePendingResult(
        await transaction.crawlBatchSourceResult.updateMany({ where: write.where, data: write.data }));
      else if (write.model === "crawlObservation") await transaction.crawlObservation.create({
        data: write.data as CrawlObservationCreateArgs["data"]
      });
      else await transaction[write.model].create({ data: write.data });
    }
    stage = "TRANSACTION_COMMIT";
    }, ATOMIC_EVIDENCE_TRANSACTION_OPTIONS);
  } catch (error) {
    throw tagAtomicEvidencePersistenceStage(error, stage);
  }
}

type AtomicInsertModel = "evidenceArtifact" | "paginationEvidence" | "lossLedgerEntry" |
  "transportAttemptEvidence" | "transportAttemptArtifact" | "crawlObservation" | "lifecycleSetEvidenceMember";
type AtomicWrite = { stage: AtomicEvidencePersistenceStage } & (
  { kind: "insert"; model: AtomicInsertModel; data: Record<string, unknown> } |
  { kind: "job"; args: JobUpsertArgs } |
  { kind: "terminal"; where: Record<string, unknown>; data: Record<string, unknown> }
);

// Never exported or accepted from a caller. All nested references are owned by
// this invocation; no caller reference survives the verified snapshot.
async function prepareAtomicWritePlan(input: AtomicSourceEvidenceCommit, manual: boolean,
  setStage: (stage: AtomicEvidencePersistenceStage) => void): Promise<{ readonly writes: readonly AtomicWrite[]; readonly sourceId: string; readonly batchId: string }> {
    const { verifyAtomicRuntimeCommitAttestation, verifyAtomicRuntimeCommitForPersistence } = await import("../crawler/runtimeAtomicEvidence");
    verifyAtomicRuntimeCommitAttestation(input);
    if (input.sourceResult.sourceId === "source-astellas-china-social" && input.publicationPolicy === "SOURCE_ATOMIC_LAST_GOOD_V1" && input.sourceResult.completenessState === "VERIFIED") {
      await verifyAtomicRuntimeCommitForPersistence(input);
    }
    // A transaction/fence may await IO before its first write. Keep the verified
    // portable payload private so caller mutations cannot change that write set.
    input = structuredClone(input);
    setStage("INPUT_VALIDATION");
    const validated = validateAtomicSourceEvidenceCommit(
      input,
      manual,
      setStage
    );

    const writes: AtomicWrite[] = [];
    let stage: AtomicEvidencePersistenceStage;
    stage = "ARTIFACT_WRITE";
    for (const artifact of input.artifacts) {
      const { logicalKey: _logicalKey, ...data } = artifact;
      writes.push({ kind: "insert", stage, model: "evidenceArtifact", data });
    }

    stage = "PAGINATION_WRITE";
    for (const page of input.pagination) {
      const { artifactLogicalKey, ...data } = page;
      writes.push({ kind: "insert", stage, model: "paginationEvidence",
        data: { ...data, artifactId: validated.artifactIdsByLogicalKey.get(artifactLogicalKey) }
      });
    }

    stage = "LOSS_LEDGER_WRITE";
    for (const loss of input.lossLedger) {
      writes.push({ kind: "insert", stage, model: "lossLedgerEntry", data: { ...loss } });
    }

    stage = "TRANSPORT_ATTEMPT_WRITE";
    for (const attempt of input.priorTransportAttempts) {
      const { artifactIds, ...attemptData } = attempt;
      writes.push({ kind: "insert", stage, model: "transportAttemptEvidence", data: attemptData });
      for (const artifactId of artifactIds) {
        writes.push({ kind: "insert", stage, model: "transportAttemptArtifact", data: {
          attemptId: attempt.id, artifactId, releaseCandidateId: attempt.releaseCandidateId,
          batchId: attempt.batchId, sourceId: attempt.sourceId, sourceResultId: attempt.sourceResultId
        } });
      }
    }

    const observation = validated.observationCommand.observation;
    const sourceResult = input.sourceResult;
    const provenance = input.observationProvenance;
    stage = "OBSERVATION_WRITE";
    writes.push({ kind: "insert", stage, model: "crawlObservation",
      data: {
        sourceId: sourceResult.sourceId,
        batchId: sourceResult.batchId,
        releaseCandidateId: sourceResult.releaseCandidateId,
        sourceResultId: sourceResult.id,
        commitSha: provenance.commitSha,
        rosterSha256: provenance.rosterSha256,
        sourcePlanSha256: provenance.sourcePlanSha256,
        sourceConfigSha256: provenance.sourceConfigSha256,
        adapterVersion: provenance.adapterVersion,
        observedFrom: provenance.observedFrom,
        observedTo: provenance.observedTo,
        crawledAt: observation.crawledAt,
        successful: observation.successful,
        transportSucceeded: provenance.transportSucceeded,
        adapterSucceeded: provenance.adapterSucceeded,
        completenessVerified: provenance.completenessVerified,
        atomicCommitSucceeded: provenance.atomicCommitSucceeded,
        structuredJobCount: observation.structuredJobCount,
        rawCount: sourceResult.rawCount,
        parsedCount: sourceResult.parsedCount,
        validCount: sourceResult.validCount,
        normalizedCount: sourceResult.normalizedCount,
        dedupeInputCount: sourceResult.dedupeInputCount,
        dedupeOutputCount: sourceResult.dedupeOutputCount,
        parseDiscardCount: sourceResult.parseDiscardCount,
        validationDiscardCount: sourceResult.validationDiscardCount,
        normalizationDiscardCount: sourceResult.normalizationDiscardCount,
        dedupeDiscardCount: sourceResult.dedupeDiscardCount,
        discardCount: sourceResult.discardCount,
        collisionCount: sourceResult.collisionCount,
        expectedJobCount: sourceResult.expectedJobCount,
        completenessStatus: observation.completenessStatus ?? null,
        completenessEvidenceKind: observation.completenessEvidenceKind ?? null,
        completenessEvidenceUrl: observation.completenessEvidenceUrl ?? null,
        completenessBlockerReason: observation.completenessBlockerReason ?? null,
        totalPages: observation.totalPages ?? null,
        pageSize: observation.pageSize ?? null,
        pagesVisited: observation.pagesVisited ?? null,
        canonicalRawSha256: provenance.canonicalRawSha256,
        canonicalOutputSha256: provenance.canonicalOutputSha256,
        canonicalGraceSha256: provenance.canonicalGraceSha256,
        canonicalVisibleSha256: provenance.canonicalVisibleSha256,
        artifactRedactionCommitmentSha256: provenance.artifactRedactionCommitmentSha256,
        expectedSurfaceSha256: provenance.expectedSurfaceSha256,
        visitedSurfaceSha256: provenance.visitedSurfaceSha256,
        expectedChannelSha256: provenance.expectedChannelSha256,
        visitedChannelSha256: provenance.visitedChannelSha256,
        paginationTraceSha256: provenance.paginationTraceSha256,
        officialEvidenceArtifactId: validated.officialArtifactId,
        stableRequiredFields: observation.stableRequiredFields.map(toPrismaRequiredJobField),
        failureReason: observation.failureReason ?? null
      } as CrawlObservationCreateArgs["data"] & Record<string, unknown>
    });

    stage = "JOB_WRITE";
    for (const command of input.commands) {
      if (command.type === "UPSERT_JOB") writes.push({ kind: "job", stage, args: jobUpsertArgs(command) });
    }

    stage = "LIFECYCLE_WRITE";
    for (const command of input.commands) {
      if (sourceResult.completenessState !== "VERIFIED") break;
      if(command.type!=="UPSERT_JOB"||command.lifecycleStatus!=="ACTIVE")continue;
      const kinds=command.missingSuccessfulCrawlCount===0?["CURRENT","VISIBLE"] as const:["GRACE","VISIBLE"] as const;
      for(const setKind of kinds)writes.push({ kind: "insert", stage, model: "lifecycleSetEvidenceMember",data:{
        releaseCandidateId:sourceResult.releaseCandidateId,batchId:sourceResult.batchId,sourceId:sourceResult.sourceId,
        sourceResultId:sourceResult.id,setKind,jobKey:command.dedupeKey,
        jobKeySha256:createHash("sha256").update(command.dedupeKey,"utf8").digest("hex"),
        lifecycleStatus:"ACTIVE",missingCount:command.missingSuccessfulCrawlCount
      }});
    }

    stage = "SOURCE_TERMINAL_WRITE";
    const terminal = sourceResultTerminalData(input.sourceResult);
    writes.push({ kind: "terminal", stage,
      where: pendingSourceTupleWhere({
        id: sourceResult.id,
        releaseCandidateId: sourceResult.releaseCandidateId,
        batchId: sourceResult.batchId,
        sourceId: sourceResult.sourceId
      }),
      data: terminal
    });
    return freezeOwned({ writes, sourceId: sourceResult.sourceId, batchId: sourceResult.batchId });

}

function freezeOwned<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) freezeOwned(nested);
    Object.freeze(value);
  }
  return value;
}

/** LOCAL POC ONLY: no caller, route or execute_sql transport is registered.
 * Accepts live in-process authority, never a serialized receipt/write plan.
 * Reuse the returned immutable SQL string for identical allocated IDs; an
 * uncertain execution still requires persisted-outcome inspection, not retry.
 */
export async function compilePortableAtomicSourceEvidenceSql(
  input: AtomicSourceEvidenceCommit, lease: PortableCrawlLease
): Promise<string> {
  if (input.publicationPolicy !== "SOURCE_ATOMIC_LAST_GOOD_V1") throw new Error("Portable publication policy is required");
  let stage: AtomicEvidencePersistenceStage = "ATTESTATION";
  try {
    assertPortableCrawlLeaseOwned(lease);
    const { writes } = await prepareAtomicWritePlan(input, false, next => { stage = next; });
    assertPortableCrawlLeaseOwned(lease);
    const statements = [
      // Bounds each lock wait, not the whole already-running DO statement.
      `PERFORM set_config('lock_timeout', '${ATOMIC_EVIDENCE_TRANSACTION_OPTIONS.timeout}ms', true);`,
      `PERFORM 1 FROM public."CrawlCoordinatorLock" WHERE "id" = ${sqlText(lease.lockId)} FOR UPDATE;`,
      `IF NOT FOUND THEN RAISE EXCEPTION 'CRAWL_LEASE_LOST'; END IF;`,
      // This is a separate command after the row lock: time cannot be stale
      // from evaluation before SELECT FOR UPDATE waited on another holder.
      `UPDATE public."CrawlCoordinatorLock" SET "heartbeatAt" = clock_timestamp()
       WHERE "id" = ${sqlText(lease.lockId)} AND "holderId" = ${sqlText(lease.holderId)}
         AND "heartbeatAt" > clock_timestamp() - (${PORTABLE_CRAWL_LEASE_MS} * interval '1 millisecond');`,
      `GET DIAGNOSTICS affected = ROW_COUNT;`,
      `IF affected <> 1 THEN RAISE EXCEPTION 'CRAWL_LEASE_LOST'; END IF;`
    ];
    statements.push(...compileAtomicWriteStatements(writes, next => { stage = next; }));
    const body = `DECLARE affected bigint; job_data jsonb;\nBEGIN\n${statements.join("\n")}\nEND;`;
    let delimiter: string;
    do { delimiter = `$atomic_${randomUUID().replaceAll("-", "")}$`; } while (body.includes(delimiter));
    // Send this complete string in one simple Query. The setter must precede
    // DO so PostgreSQL starts its statement timeout before any publication work.
    return `SET LOCAL statement_timeout = '${ATOMIC_EVIDENCE_TRANSACTION_OPTIONS.timeout}ms';\nDO ${delimiter}\n${body}\n${delimiter};`;
  } catch (error) { throw tagAtomicEvidencePersistenceStage(error, stage); }
}

export type DbStartedCloudSourceInput = Omit<Parameters<typeof import('../crawler/runtimeAtomicEvidence').buildAtomicRuntimeCommit>[0],
 'previousJobs'|'trustedCompletenessBaseline'|'firstAcceptedCurrentPolicyReceipt'|'baselineCompletedBeforeCrawl'>;

/** Deadline arithmetic only; the caller must still validate the complete owned
 * certificate. This function grants no publication or lease authority. */
export function deriveDbStartedPublicationExpiry(source:Pick<AtomicSourceResultInput,'startedAt'|'completenessCertificate'>):number{
 const certificate=source.completenessCertificate as {schemaVersion?:string;acquisition?:{finishedAt?:string};independentValidation?:{observedAt?:string;expiresAt?:string};validationPolicy?:{execution?:string}}|null;
 let expiry=source.startedAt.getTime()+30*60_000;
 // Portable receipts already bound capture duration and issuance to the real
 // acquisition. Waiting never renews its original 30-minute publication cutoff.
 if(certificate?.schemaVersion===SOURCE_QUALITY_RECEIPT_SCHEMA)expiry=Date.parse(certificate.acquisition?.finishedAt??'')+30*60_000;
 if(certificate?.schemaVersion==='b-grade-independent-traversal-v2'){
  expiry=Math.min(expiry,Date.parse(certificate.independentValidation?.expiresAt??''));
  if(certificate.validationPolicy?.execution==='CURRENT_RUN')expiry=Math.min(expiry,Date.parse(certificate.independentValidation?.observedAt??'')+B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS);
 }
 if(!Number.isFinite(expiry))throw Error('PILOT_EVIDENCE_EXPIRY_INVALID');
 return expiry;
}

/** Opt-in, local preparation only. Builds from the exact context subsequently
 * compared in PostgreSQL; accepts neither serialized write plans nor leases.
 * The prospective holder is acquired and released by the same atomic DO. */
export type DbStartedCloudPublicationInput={source:DbStartedCloudSourceInput;control:CloudPilotDbStartedInput;publicationDeadline?:number;jobProjectionDelta?:true};
export async function compileDbStartedCloudSourcePublication(input:DbStartedCloudPublicationInput){
 return compileDbStartedCloudSourcePublicationWithIds(input,randomUUID);
}

/** Same-process review seam only. Does not dispatch or grant publication authority.
 * The allocator is private: callers cannot submit UUID tapes or SQL fragments.
 * Each replay repeats the COMPLETE original preparation/attestation/control path.
 * Only random identifiers are reused, to permit exact full-byte comparison.
 * The live admission/result/attempt tracker identities are intentionally retained.
 */
export async function prepareDbStartedCloudPublicationReplay(input:DbStartedCloudPublicationInput){
 const before=JSON.stringify(input),ids:string[]=[];
 const original=await compileDbStartedCloudSourcePublicationWithIds(input,()=>{const id=randomUUID();ids.push(id);return id;});
 if(JSON.stringify(input)!==before)throw Error('PILOT_REVIEW_INPUT_CHANGED');
 const originalBytes=JSON.stringify(original);
 return Object.freeze({packet:structuredClone(original),async recompile(){
  if(JSON.stringify(input)!==before)throw Error('PILOT_REVIEW_INPUT_CHANGED');
  let index=0;
  const replay=await compileDbStartedCloudSourcePublicationWithIds(input,()=>{
   const id=ids[index++];if(id===undefined)throw Error('PILOT_REVIEW_UUID_EXHAUSTED');return id;
  });
  if(index!==ids.length)throw Error('PILOT_REVIEW_UUID_COUNT');
  if(JSON.stringify(input)!==before)throw Error('PILOT_REVIEW_INPUT_CHANGED');
  if(JSON.stringify(replay)!==originalBytes)throw Error('PILOT_REVIEW_FULL_RECOMPILE_MISMATCH');
  return replay;
 }});
}

async function compileDbStartedCloudSourcePublicationWithIds(input:DbStartedCloudPublicationInput,allocateUuid:()=>string){
 const {loadPilotContext}=await import('../crawler/cloudPilotContext');
 const {buildAtomicRuntimeCommit}=await import('../crawler/runtimeAtomicEvidence');
 const {buildJobDedupeKey}=await import('../crawler/normalizedJob');
 const {prepareCloudPilotDbStartedControl}=await import('./cloudPilotSqlControl');
 const control=structuredClone(input.control),source=input.source;
 if(Boolean(input.jobProjectionDelta)!==Boolean(control.databaseIdentity))throw Error("PILOT_INCREMENTAL_DATABASE_PROFILE_REQUIRED");
 const portable=source.sourceAdmissionPolicy===SOURCE_QUALITY_POLICY_ID;
 if(source.publicationPolicy!=='SOURCE_ATOMIC_LAST_GOOD_V1'||source.sourceAdmissionPolicy!==undefined&&!portable)throw Error('PILOT_REAL_CERTIFICATE_REQUIRED');
 const context=await loadPilotContext(control.context,source.plan,!portable);
 const captureStarted=source.pending.startedAt.getTime();
 if(context.trustedCompletenessBaseline&&Date.parse(context.trustedCompletenessBaseline.verifiedAt)>captureStarted)throw Error('PILOT_CAPTURE_PRECEDES_ACCEPTED_OBSERVATION');
 const currentKeys=new Set(source.result.jobs.map(buildJobDedupeKey));
 const previousJobs=portable?context.previousJobs:context.previousJobs.filter(job=>currentKeys.has(job.dedupeKey)||(context.acceptedVisibilityFloor!==null&&Date.parse(job.lastSeenAt)>=context.acceptedVisibilityFloor.getTime()));
 // Caller hints cannot suppress anomalies derived from the verified context.
 // Validate a supplied list before unioning so an explicit [] remains invalid.
 const suppliedAnomalyCodes=source.completenessAnomalyTriggerCodes
  ?canonicalCompletenessAnomalyTriggerCodes(source.completenessAnomalyTriggerCodes):[];
 const anomaly=evaluateCompletenessAnomalyForCrawl(source.plan,source.result,context.trustedCompletenessBaseline);
 const completenessAnomalyTriggerCodes=[...new Set([...suppliedAnomalyCodes,...anomaly.triggerCodes])];
 // A caller may not label a baseline-derived refresh requirement as STABLE_RUN.
 // Leave stronger hints, missing hints and invalid hints to the original B issuer.
 const independentTraversalValidationTrigger=!portable&&requiresBGradeTraversalCertificate(source.plan)&&
  source.independentTraversalValidationTrigger==='STABLE_RUN'
  ?selectCompletenessValidationTrigger({baseline:context.trustedCompletenessBaseline,currentSourceConfigSha256:source.pending.sourceConfigHash,anomaly:{independentValidationRequired:completenessAnomalyTriggerCodes.length>0}})
  :source.independentTraversalValidationTrigger;
 const commit=buildAtomicRuntimeCommit({...source,...context,previousJobs,
  ...(completenessAnomalyTriggerCodes.length>0?{completenessAnomalyTriggerCodes}:{}),
  ...(independentTraversalValidationTrigger!==undefined?{independentTraversalValidationTrigger}:{})});
 const certificate=commit.sourceResult.completenessCertificate as {schemaVersion?:string;independentValidation?:{observedAt?:string;expiresAt?:string}}|null;
 if(commit.sourceResult.completenessState!=='VERIFIED'||!(portable?[SOURCE_QUALITY_RECEIPT_SCHEMA]:['a-grade-official-total-v2','b-grade-independent-traversal-v2']).includes(certificate?.schemaVersion??''))throw Error('PILOT_REAL_CERTIFICATE_REQUIRED');
 // Original acquisition and B validation times are preserved. No renewed local
 // lease/acknowledgement can manufacture a later deadline for this packet.
 if(input.publicationDeadline!==undefined&&!Number.isSafeInteger(input.publicationDeadline))throw Error('PILOT_PUBLICATION_DEADLINE_INVALID');
 // The outer worker can shorten this packet's DB/relay cutoff, never extend
 // the original acquisition or validation proof window.
 const deadline=Math.min(deriveDbStartedPublicationExpiry(commit.sourceResult),input.publicationDeadline??Infinity);
 if(!Number.isFinite(captureStarted)||!Number.isFinite(deadline)||captureStarted>Date.now()||Date.now()>=deadline)throw Error('PILOT_A_CAPTURE_NOT_FRESH');
 if(commit.artifacts.some(a=>a.capturedAt.getTime()<captureStarted||a.capturedAt.getTime()>Date.now()))throw Error('PILOT_ORIGINAL_CAPTURE_TIMES');
 let stage:AtomicEvidencePersistenceStage='ATTESTATION';
 try{
  const fullPlan=await prepareAtomicWritePlan(commit,false,next=>{stage=next;});
  let writes=fullPlan.writes;
  let publicationCommit=commit;
  let deltaMembers:readonly {jobKey:string;setKind:string}[]|undefined;
  if(input.jobProjectionDelta){
   const delta=buildJobProjectionDeltaReceipt({sourceResult:commit.sourceResult,commands:commit.commands,previousAccepted:control.context.latestAccepted,
    projectionForCommand:command=>{const args=jobUpsertArgs(command);return {...args.create,...args.update};}});
   deltaMembers=delta.receipt.members;
   publicationCommit={...commit,sourceResult:{...commit.sourceResult,completenessCertificate:delta.receipt,completenessCertificateSha256:delta.sha256}};
   writes=fullPlan.writes.filter(write=>{
    if(write.kind!=="job")return true;
    const key=write.args.where.sourceId_dedupeKey;
    const old=control.context.jobs.find(row=>row.sourceId===key.sourceId&&row.dedupeKey===key.dedupeKey);
    if(!old)return true;
    // Older saved contexts lack isNew/visibility. In that case keep the SQL
    // conditional update; never infer an unchanged value from missing columns.
    try{return hashJobPersistedProjection(old)!==hashJobPersistedProjection({...write.args.create,...write.args.update});}catch{return true;}
   }).map(write=>write.kind==="terminal"?{...write,data:sourceResultTerminalData(publicationCommit.sourceResult)}:write);
  }
  const holderId=allocateUuid(),expiresAt=new Date(deadline).toISOString();
  const originalTimesThrough=new Date(Math.max(captureStarted,commit.sourceResult.finishedAt!.getTime(),...commit.artifacts.map(a=>a.capturedAt.getTime()),
   ...(certificate?.schemaVersion==='b-grade-independent-traversal-v2'?[Date.parse(certificate.independentValidation?.observedAt??'')]:[]))).toISOString();
  const controls=prepareCloudPilotDbStartedControl(control,{...publicationCommit.sourceResult},holderId,expiresAt,originalTimesThrough,source.sourceAdmissionPolicy);
  // One complete terminal value feeds the existing update columns and exact
  // postcondition, so large B evidence is serialized only once in this DO.
  const statements=["PERFORM set_config('TimeZone', 'UTC', true);","PERFORM set_config('lock_timeout', '1000ms', true);","SET CONSTRAINTS ALL DEFERRED;",controls.before,...compileAtomicWriteStatements(writes,next=>{stage=next;},true,input.jobProjectionDelta?commit.sourceResult.finishedAt!.toISOString():undefined,allocateUuid,deltaMembers),controls.after];
  const body=`DECLARE affected bigint; job_data jsonb; ${compileAtomicJsonDeclarations(publicationCommit.sourceResult,controls.expectedContext)} current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;\nBEGIN\n${statements.join('\n')}\nEND;`;
  let delimiter:string;do{delimiter=`$atomic_${allocateUuid().replaceAll('-','')}$`;}while(body.includes(delimiter));
  return {sql:`SET LOCAL statement_timeout = '120000ms';\nDO ${delimiter}\n${body}\n${delimiter};`,commit:publicationCommit,holderId,expiresAt};
 }catch(error){throw tagAtomicEvidencePersistenceStage(error,stage);}
}

function compileAtomicWriteStatements(writes:readonly AtomicWrite[],onStage:(stage:AtomicEvidencePersistenceStage)=>void,sharedTerminal=false,deltaVerifiedAt?:string,allocateUuid:()=>string=randomUUID,deltaMembers?:readonly {jobKey:string;setKind:string}[]):string[]{
    const statements:string[]=[];
    for (let index = 0; index < writes.length;) {
      const write = writes[index++]!;
      onStage(write.stage);
      if (write.kind === "insert") {
        const table = ATOMIC_SQL_TABLES[write.model];
        const rows: Record<string, unknown>[] = [];
        let current = write;
        do {
          rows.push(sqlRecordData(table, current.model === "transportAttemptArtifact" || current.model === "transportAttemptEvidence"
            ? current.data : { id: allocateUuid(), ...current.data }));
          const next = writes[index];
          if (next?.kind !== "insert" || next.model !== write.model ||
            JSON.stringify(definedKeys(next.data)) !== JSON.stringify(definedKeys(write.data))) break;
          current = next;
          index++;
        } while (true);
        const columns = definedKeys(rows[0]!).map(sqlIdentifier).join(", ");
        // Delta receipts already contain these exact member fields. Reuse them
        // in this transaction; only newly allocated row IDs need transporting.
        const memberIds = new Map(rows.map(row => [JSON.stringify([row.jobKey,row.setKind]),row.id]));
        const records = sharedTerminal && deltaMembers && write.model === "lifecycleSetEvidenceMember"
          ? `(SELECT jsonb_agg(member.value || jsonb_build_object('id', ${sqlJson(deltaMembers.map(member => memberIds.get(JSON.stringify([member.jobKey,member.setKind]))))}->(member.ordinality::int-1)) ORDER BY member.ordinality)
    FROM jsonb_array_elements(source_result_data->'completenessCertificate'->'members') WITH ORDINALITY AS member(value, ordinality))`
          : sqlRecords(rows);
        statements.push(`INSERT INTO public.${sqlIdentifier(table)} (${columns})
          SELECT ${columns} FROM jsonb_populate_recordset(NULL::public.${sqlIdentifier(table)}, ${records});`);
      } else if (write.kind === "job") {
        // No REPLACE and no whole-record update: retained human/AI fields,
        // category, auxiliaryChineseTitle, companyId and firstSeenAt survive.
        const rows: Record<string, unknown>[] = [];
        let current = write;
        do {
          const create = sqlRecordData("Job", { id: allocateUuid(), ...current.args.create, ...(deltaVerifiedAt?{sourceChangedAt:deltaVerifiedAt}:{}) });
          // Share values between create and update without changing either mapping.
          const update = Object.fromEntries(definedKeys(current.args.update).filter(key =>
            JSON.stringify(current.args.update[key as keyof typeof current.args.update]) !== JSON.stringify(create[key]))
            .map(key => [key, current.args.update[key as keyof typeof current.args.update]]));
          rows.push({ ...create, __update: update });
          const next = writes[index];
          if (next?.kind !== "job" ||
            JSON.stringify(definedKeys(next.args.create)) !== JSON.stringify(definedKeys(write.args.create)) ||
            JSON.stringify(definedKeys(next.args.update)) !== JSON.stringify(definedKeys(write.args.update))) break;
          current = next;
          index++;
        } while (true);
        const columns = ["id", ...definedKeys(write.args.create),...(deltaVerifiedAt?["sourceChangedAt"]:[])].map(sqlIdentifier).join(", ");
        const updates = [...definedKeys(write.args.update),...(deltaVerifiedAt?["sourceChangedAt"]:[])].map(sqlIdentifier).join(", ");
        const deltaWhere=deltaVerifiedAt?` WHERE EXISTS(SELECT 1 FROM jsonb_populate_record(NULL::public."Job", job_data || (job_data->'__update')) proposed WHERE ${JOB_SOURCE_UPDATE_FIELDS.map(key=>`existing_job.${sqlIdentifier(key)} IS DISTINCT FROM proposed.${sqlIdentifier(key)}`).join(" OR ")})`:"";
        // Keep sequential upsert semantics even if a future plan repeats a Job key.
        statements.push(`FOR job_data IN SELECT value FROM jsonb_array_elements(${sqlRecords(rows)}) LOOP
          INSERT INTO public."Job"${deltaVerifiedAt?" AS existing_job":""} (${columns})
          SELECT ${columns} FROM jsonb_populate_record(NULL::public."Job", job_data)
          ON CONFLICT ("sourceId", "dedupeKey") DO UPDATE SET (${updates}) =
            (SELECT ${updates} FROM jsonb_populate_record(NULL::public."Job", job_data || (job_data->'__update')))${deltaWhere};
          END LOOP;`);
      } else {
        statements.push(`UPDATE public."CrawlBatchSourceResult" AS target
          SET ${definedKeys(write.data).map(key => `${sqlIdentifier(key)} = v.${sqlIdentifier(key)}`).join(", ")}
          FROM jsonb_populate_record(NULL::public."CrawlBatchSourceResult", ${sharedTerminal ? "source_result_data" : sqlJson(write.data)}) AS v
          WHERE ${Object.entries(write.where).map(([key, value]) =>
            `target.${sqlIdentifier(key)} = ${sqlText(String(value))}`).join(" AND ")};`,
          `GET DIAGNOSTICS affected = ROW_COUNT;`,
          `IF affected <> 1 THEN RAISE EXCEPTION 'Expected exactly one matching PENDING source result'; END IF;`);
      }
    }
    return statements;
}

const ATOMIC_SQL_TABLES: Record<AtomicInsertModel, string> = {
  evidenceArtifact: "EvidenceArtifact", paginationEvidence: "PaginationEvidence", lossLedgerEntry: "LossLedgerEntry",
  transportAttemptEvidence: "TransportAttemptEvidence", transportAttemptArtifact: "TransportAttemptArtifact",
  crawlObservation: "CrawlObservation", lifecycleSetEvidenceMember: "LifecycleSetEvidenceMember"
};
function definedKeys(value: object): string[] {
  return Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined);
}
function sqlIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function sqlText(value: string): string { return `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`; }
function sqlJson(value: unknown): string { return `${sqlText(JSON.stringify(value))}::jsonb`; }
function sqlRecordData(table: string, data: Record<string, unknown>): Record<string, unknown> {
  // These are the only @map enum values in this bounded write set.
  if (table === "Job" && data.category !== undefined) data = { ...data,
    category: fromPrismaJobCategory(data.category as PrismaJobCategoryName) };
  if (table === "CrawlObservation") data = { ...data,
    stableRequiredFields: (data.stableRequiredFields as PrismaRequiredJobFieldName[]).map(fromPrismaRequiredJobField) };
  return data;
}


const LOCK_MANUAL_REQUEST_FOR_COMMIT_SQL = `
SELECT "id" FROM "ManualCrawlRequest"
WHERE "id" = $1 AND "ownerId" = $2 AND "sourceId" = $3
  AND "status" = 'RUNNING' AND "leaseExpiresAt" > clock_timestamp()
FOR UPDATE
`;

const LOCK_MANUAL_BATCH_FOR_COMMIT_SQL = `
SELECT "id" FROM "CrawlBatch"
WHERE "id" = $1 AND "manualCrawlRequestId" = $2
  AND "ownerId" = $3 AND "kind" = 'MANUAL_SOURCE'
FOR UPDATE
`;

async function assertManualSourceCommitFence(
  transaction: AtomicSourceTransactionClient,
  fence: ManualSourceCommitFence,
  sourceId: string,
  batchId: string
): Promise<void> {
  if (!transaction.$queryRawUnsafe) throw new ManualSourceCommitFenceError();
  const ownedRequest = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
    LOCK_MANUAL_REQUEST_FOR_COMMIT_SQL, fence.requestId, fence.ownerId, sourceId);
  if (ownedRequest.length !== 1 || ownedRequest[0]?.id !== fence.requestId) {
    throw new ManualSourceCommitFenceError();
  }
  const ownedBatch = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
    LOCK_MANUAL_BATCH_FOR_COMMIT_SQL, batchId, fence.requestId, fence.ownerId);
  if (ownedBatch.length !== 1 || ownedBatch[0]?.id !== batchId) {
    throw new ManualSourceCommitFenceError();
  }
}

function validatePlannedBatchWithSources(input: PlannedBatchWithSourcesInput): PlannedPendingSourceInput[] {
  const batch = input.batch;
  for (const [name, value] of [
    ["batch id", batch.id], ["releaseCandidateId", batch.releaseCandidateId], ["commitSha", batch.commitSha],
    ["ownerId", batch.ownerId]
  ] as const) requireNonblank(value, name);
  for (const [name, value] of [
    ["rosterSha256", batch.rosterSha256], ["sourcePlanSha256", batch.sourcePlanSha256],
    ["sourceConfigSha256", batch.sourceConfigSha256], ["adapterBundleSha256", batch.adapterBundleSha256],
    ["plannedSourceSetSha256", batch.plannedSourceSetSha256]
  ] as const) requireSha256(value, name);
  if (!(["FULL_RELEASE", "SCHEDULED", "MANUAL_SOURCE", "BASELINE"] as const).includes(batch.kind)) {
    throw new Error("Batch kind is invalid");
  }
  if (batch.kind === "MANUAL_SOURCE") {
    requireNonblank(batch.manualCrawlRequestId ?? "", "manualCrawlRequestId");
    if (batch.plannedSourceIds.length !== 1) throw new Error("MANUAL_SOURCE batch must plan exactly one source");
  } else if (batch.manualCrawlRequestId !== undefined) {
    throw new Error("Only MANUAL_SOURCE may bind a manual crawl request");
  }
  if (!isValidDate(batch.startedAt) || !isValidDate(batch.heartbeatAt)) throw new Error("Batch timestamps are invalid");
  const expectedIds = canonicalizePlannedSourceIds(batch.plannedSourceIds);
  if (expectedIds.length === 0 || JSON.stringify(expectedIds) !== JSON.stringify(batch.plannedSourceIds)) {
    throw new Error("Batch planned source IDs must be a nonempty canonical set");
  }
  if (batch.plannedSourceCount !== expectedIds.length || batch.plannedSourceSetSha256 !== hashCanonicalStringSet(expectedIds)) {
    throw new Error("Batch planned source count or hash mismatch");
  }
  const actualIds = canonicalizePlannedSourceIds(input.sources.map((source) => source.sourceId));
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) throw new Error("Planned source metadata set mismatch");
  const resultIds = new Set<string>();
  for (const source of input.sources) {
    for (const [name, value] of [["source result id", source.id], ["sourceId", source.sourceId],
      ["adapterVersion", source.adapterVersion]] as const) {
      requireNonblank(value, name);
    }
    requireSha256(source.sourceConfigHash, "sourceConfigHash");
    if (source.officialEntryId !== null) requireNonblank(source.officialEntryId, "officialEntryId");
    validateOptionalUniqueList(source.officialSurfaceIds, "official surface");
    validateOptionalUniqueList(source.officialChannelIds, "official channel");
    if (!isValidDate(source.startedAt)) throw new Error("Source startedAt is invalid");
    if (resultIds.has(source.id)) throw new Error(`Duplicate source result id: ${source.id}`);
    resultIds.add(source.id);
  }
  return input.sources;
}

function validatePendingSourceTerminal(input: PendingSourceTerminalInput): void {
  for (const [name, value] of [["id", input.id], ["releaseCandidateId", input.releaseCandidateId],
    ["batchId", input.batchId], ["sourceId", input.sourceId], ["failureCode", input.failureCode],
    ["failureReason", input.failureReason]] as const) requireNonblank(value, name);
  if (!isValidDate(input.finishedAt)) throw new Error("Terminal finishedAt is invalid");
  const notAttempted = input.atomicCommitState === "NOT_ATTEMPTED" && (
    (["FAILED", "BLOCKED", "SKIPPED"] as string[]).includes(input.transportState)
      ? input.adapterState === "SKIPPED"
      : input.transportState === "SUCCEEDED" &&
        (["FAILED", "BLOCKED", "SKIPPED"] as string[]).includes(input.adapterState)
  );
  const attemptedFailure = (["FAILED", "ROLLED_BACK"] as string[]).includes(input.atomicCommitState) &&
    input.transportState === "SUCCEEDED" && input.adapterState === "SUCCEEDED";
  if (input.completenessState !== "FAILED" || (!notAttempted && !attemptedFailure)) {
    throw new Error("Terminal failure state is inconsistent");
  }
  const diagnosticValues = [
    input.failureCategory,
    input.failureDiagnosticCode,
    input.fetchAttemptCount,
    input.retryCount
  ];
  const suppliedDiagnosticCount = diagnosticValues.filter(
    (value) => value !== undefined && value !== null
  ).length;
  if (suppliedDiagnosticCount === 0) {
    if ((input.retryReasonCodes ?? []).length > 0) throw new Error("Retry reasons require source diagnostics");
    return;
  }
  if (suppliedDiagnosticCount !== diagnosticValues.length) {
    throw new Error("Source failure diagnostic bundle must be supplied together");
  }
  if (!isSourceFailureCategory(input.failureCategory)) {
    throw new Error("Source failure category must be a closed value");
  }
  if (!isSourceFailureDiagnosticCode(input.failureDiagnosticCode)) {
    throw new Error("Source failure diagnostic code must be a closed value");
  }
  const fetchAttemptCount = input.fetchAttemptCount;
  const retryCount = input.retryCount;
  if (typeof fetchAttemptCount !== "number" || !Number.isSafeInteger(fetchAttemptCount) ||
      fetchAttemptCount < 0 || typeof retryCount !== "number" ||
      !Number.isSafeInteger(retryCount) || retryCount < 0) {
    throw new Error("Source fetch attempt and retry counts must be nonnegative safe integers");
  }
  if (fetchAttemptCount === 0) {
    if (retryCount !== 0 || input.failureDiagnosticCode !== "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL") {
      throw new Error("zero fetch attempts are valid only when the batch aborts before source execution");
    }
  } else if (retryCount >= fetchAttemptCount) {
    throw new Error("retry count must be less than fetch attempt count");
  }
  validateRetryReasonCodes(input.retryReasonCodes ?? [], retryCount);
}

function validateRetryReasonCodes(values: readonly string[], retryCount: number): void {
  if (!Array.isArray(values) || values.length !== retryCount || retryCount > 2 ||
      values.some((value) => !isRetryableSourceTransportFailureCode(value))) {
    throw new Error("Retry reasons must match the bounded transient retry count and closed transport codes");
  }
}

function validateDiagnosticArtifacts(
  artifacts: readonly AtomicEvidenceArtifactInput[],
  tuple: EvidenceTuple
): Map<string, string> {
  if (artifacts.length === 0) throw new Error("Failed diagnostic evidence requires an archived artifact");
  return validateEvidenceArtifacts(artifacts, tuple).idsByLogicalKey;
}

function validateDiagnosticPagination(
  pages: readonly AtomicPaginationEvidenceInput[],
  tuple: EvidenceTuple,
  artifactIdsByLogicalKey: ReadonlyMap<string, string>
): void {
  validateEvidencePagination(pages, tuple, artifactIdsByLogicalKey, false);
}

function validateDiagnosticLossLedger(
  losses: readonly AtomicLossLedgerInput[],
  tuple: EvidenceTuple,
  counts: FailedSourceEvidenceCommit["fetchCounts"]
): void {
  const { counts: lossCounts } = validateEvidenceLossRows(losses, tuple, true);
  if (lossCounts.PARSE !== counts.parseDiscardCount || lossCounts.VALIDATION !== counts.validationDiscardCount) {
    throw new Error("Failed diagnostic loss rows do not reconcile to fetch discard counts");
  }
}

function validateDiagnosticTransportAttempts(
  attempts: readonly AtomicTransportAttemptInput[],
  tuple: EvidenceTuple,
  artifacts: readonly AtomicEvidenceArtifactInput[]
): void {
  validateEvidenceTransportAttempts(attempts, tuple, new Set(artifacts.map(({ id }) => id)));
}

function validateEvidenceArtifacts(
  artifacts: readonly AtomicEvidenceArtifactInput[],
  tuple: EvidenceTuple
): { idsByLogicalKey: Map<string, string>; artifactsByLogicalKey: Map<string, AtomicEvidenceArtifactInput> } {
  const ids = new Set<string>(), paths = new Set<string>(), idsByLogicalKey = new Map<string, string>();
  const artifactsByLogicalKey = new Map<string, AtomicEvidenceArtifactInput>();
  for (const artifact of artifacts) {
    assertTuple(artifact, tuple, "artifact");
    requireNonblank(artifact.id, "artifact id"); requireNonblank(artifact.logicalKey, "artifact logical key");
    requireNonblank(artifact.path, "artifact path"); requireNonblank(artifact.extractorLocator, "artifact extractorLocator");
    requireNonblank(artifact.captureToolName, "artifact captureToolName");
    requireNonblank(artifact.captureToolVersion, "artifact captureToolVersion");
    requireSha256(artifact.sha256, "artifact sha256");
    requireSha256(artifact.redactionCommitmentSha256, "artifact redaction commitment sha256");
    requireNonnegativeInteger(artifact.byteCount, "artifact byteCount");
    if (!isValidDate(artifact.capturedAt)) throw new Error("Artifact capturedAt is invalid");
    if (ids.has(artifact.id) || idsByLogicalKey.has(artifact.logicalKey) || paths.has(artifact.path)) {
      throw new Error("Artifact ids, logical keys and paths must be unique");
    }
    if (NETWORK_ARTIFACT_KINDS.has(artifact.kind)) {
      requireNonblank(artifact.requestedUrl, "network artifact requestedUrl");
      requireNonblank(artifact.finalUrl, "network artifact finalUrl");
      requireNonblank(artifact.contentType, "network artifact contentType");
      if (!Number.isInteger(artifact.httpStatus) || artifact.httpStatus! < 100 || artifact.httpStatus! > 599) {
        throw new Error("Network artifact httpStatus is invalid");
      }
    }
    ids.add(artifact.id); paths.add(artifact.path); idsByLogicalKey.set(artifact.logicalKey, artifact.id);
    artifactsByLogicalKey.set(artifact.logicalKey, artifact);
  }
  return { idsByLogicalKey, artifactsByLogicalKey };
}

function validateEvidencePagination(
  pages: readonly AtomicPaginationEvidenceInput[],
  tuple: EvidenceTuple,
  artifactIdsByLogicalKey: ReadonlyMap<string, string>,
  verified: boolean
): void {
  const sorted = [...pages].sort((left, right) => left.sequence - right.sequence);
  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index]!;
    assertTuple(page, tuple, "pagination");
    if (!Number.isSafeInteger(page.sequence) || page.sequence !== index) {
      throw new Error("Pagination sequences must be unique and contiguous from zero");
    }
    if (!artifactIdsByLogicalKey.has(page.artifactLogicalKey)) {
      throw new Error("Pagination references an artifact outside the supplied artifact set");
    }
    requireSha256(page.responseFingerprintSha256, "pagination response sha256");
    requireSha256(page.rawJobIdSetSha256, "pagination raw job id set sha256");
    requireSha256(page.validJobIdSetSha256, "pagination valid job id set sha256");
    if (!isValidDate(page.capturedAt)) throw new Error("Pagination capturedAt is invalid");
    for (const [name, value] of [["declaredTotal", page.declaredTotal], ["declaredCount", page.declaredCount],
      ["declaredPages", page.declaredPages], ["requestedOffset", page.requestedOffset],
      ["returnedOffset", page.returnedOffset], ["requestedPage", page.requestedPage],
      ["returnedPage", page.returnedPage], ["requestedPageSize", page.requestedPageSize],
      ["returnedPageSize", page.returnedPageSize]] as const) {
      if (value !== undefined && value !== null) {
        requireNonnegativeInteger(value, `pagination ${name}`);
        if ((name === "requestedPageSize" || name === "returnedPageSize") && value === 0) {
          throw new Error(`pagination ${name} must be positive when supplied`);
        }
      }
    }
    if (verified && page.anomalyCodes.length > 0) {
      throw new Error("VERIFIED completeness cannot contain pagination anomalies");
    }
    if (verified && UNSAFE_VERIFIED_TERMINATIONS.has(page.termination)) {
      throw new Error("VERIFIED completeness cannot use an unsafe pagination termination");
    }
  }
}

function validateEvidenceTransportAttempts(
  attempts: readonly AtomicTransportAttemptInput[],
  tuple: EvidenceTuple,
  artifactIds: ReadonlySet<string>
): void {
  const attemptIds = new Set<string>();
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]!;
    assertTuple(attempt, tuple, "transport attempt"); requireNonblank(attempt.id, "transport attempt id");
    requireNonblank(attempt.code, "transport attempt code");
    if (attempt.sequence !== index || attemptIds.has(attempt.id) || !TRANSPORT_ATTEMPT_CODES.has(attempt.code) ||
        !isValidDate(attempt.capturedAt)) throw new Error("Transport attempt code, sequence, ID or timestamp is invalid");
    const expectedTransport = attempt.code === "HCM_DIRECT_FAILED" || attempt.code === "JNJ_DIRECT_FAILED"
      ? "DIRECT_HTTP" : "BROWSER_SESSION";
    const expectedOutcome = attempt.code === "HCM_BROWSER_SUCCEEDED" || attempt.code === "JNJ_BROWSER_SUCCEEDED"
      ? "SUCCEEDED" : "FAILED";
    if (attempt.transport !== expectedTransport || attempt.outcome !== expectedOutcome) {
      throw new Error("Transport attempt code, transport and outcome are inconsistent");
    }
    if (attempt.code.startsWith("JNJ_") && attempt.sourceId !== JNJ_SOURCE_ID) {
      throw new Error("J&J transport attempt code is bound to the J&J China source");
    }
    for (const value of [attempt.evidenceCommitmentSha256, attempt.pageTraceSha256,
      attempt.lossLedgerSha256, attempt.paginationEvaluationSha256]) requireSha256(value, "transport attempt commitment");
    validateNonblankUniqueList(attempt.artifactIds, "transport attempt artifact");
    if (attempt.artifactIds.some((id) => !artifactIds.has(id))) {
      throw new Error("Transport attempt references an artifact outside the supplied tuple");
    }
    validateSafeJson(attempt.details, "transport attempt details"); attemptIds.add(attempt.id);
  }
}

function validateEvidenceLossRows(
  losses: readonly AtomicLossLedgerInput[],
  tuple: EvidenceTuple,
  fetchOnly: boolean
): { counts: Record<LossStage, number>; collisionGroups: Set<string> } {
  const counts: Record<LossStage, number> = { PARSE: 0, VALIDATION: 0, NORMALIZATION: 0, DEDUPE: 0 };
  const collisionGroups = new Set<string>();
  for (const loss of losses) {
    assertTuple(loss, tuple, "loss ledger");
    if (fetchOnly && loss.stage !== "PARSE" && loss.stage !== "VALIDATION") {
      throw new Error("Failed fetch diagnostics may only persist fetch-stage losses");
    }
    requireNonblank(loss.reason, "loss reason"); requireNonblank(loss.rawLocator, "loss rawLocator");
    if (loss.recordedAt !== undefined && !isValidDate(loss.recordedAt)) throw new Error("Loss recordedAt is invalid");
    if (loss.details === undefined) throw new Error("Loss details must be supplied");
    counts[loss.stage] += 1;
    if (loss.stage === "DEDUPE") {
      if (!nonblank(loss.candidateKey) || !nonblank(loss.winnerKey)) {
        throw new Error("Dedupe loss requires nonblank candidateKey and winnerKey");
      }
      collisionGroups.add(loss.winnerKey);
    }
  }
  return { counts, collisionGroups };
}

function validateCommittedSourceResultTruthTable(
  result: AtomicSourceResultInput,
  canonicalRawEvidenceIdSetSha256: string | undefined,
  onStage: (stage: AtomicEvidencePersistenceStage) => void,
  sanofiArtifacts?: readonly SanofiArtifactCommitment[]
): void {
  if (result.atomicCommitState !== "COMMITTED" || result.transportState !== "SUCCEEDED" ||
      result.adapterState !== "SUCCEEDED" || result.finishedAt === null ||
      !(["VERIFIED", "INCOMPLETE", "NEEDS_MANUAL_COMPLETENESS_REVIEW"] as string[])
        .includes(result.completenessState)) {
    throw new Error("COMMITTED source result terminal state is inconsistent");
  }
  if (nonblank(result.failureCode) || nonblank(result.failureReason)) {
    throw new Error("COMMITTED source result failure code and reason must be null");
  }
  if (result.failureCategory !== undefined && result.failureCategory !== null ||
      result.failureDiagnosticCode !== undefined && result.failureDiagnosticCode !== null) {
    throw new Error("COMMITTED source result failure category and diagnostic code must be null");
  }
  const attemptCount = result.fetchAttemptCount;
  const retryCount = result.retryCount;
  const retryReasonCodes = result.retryReasonCodes ?? [];
  if ((attemptCount === undefined || attemptCount === null) !==
      (retryCount === undefined || retryCount === null)) {
    throw new Error("COMMITTED source result fetch attempt counters must be supplied together");
  }
  if (attemptCount !== undefined && attemptCount !== null && retryCount !== undefined && retryCount !== null &&
      (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || !Number.isSafeInteger(retryCount) ||
        retryCount < 0 || retryCount >= attemptCount)) {
    throw new Error("COMMITTED source result fetch attempt counters are inconsistent");
  }
  if (retryCount !== undefined && retryCount !== null) validateRetryReasonCodes(retryReasonCodes, retryCount);
  if (result.completenessState === "VERIFIED") {
    if (nonblank(result.blockerCode) || nonblank(result.blockerReason)) {
      throw new Error("VERIFIED COMMITTED source result blocker must be null");
    }
  } else if (!nonblank(result.blockerCode) || !nonblank(result.blockerReason)) {
    throw new Error("INCOMPLETE or NEEDS_MANUAL COMMITTED source result requires blocker code and reason");
  }
  onStage("CERTIFICATE_VALIDATION");
  if ((result.completenessCertificate === null) !==
      (result.completenessCertificateSha256 === null)) {
    throw new Error("Completeness certificate and hash must be supplied together");
  }
  if ((requiresAGradeCertificateSourceId(result.sourceId) || requiresBGradeCertificateSourceId(result.sourceId)) &&
      result.completenessState === "VERIFIED" &&
      result.completenessCertificate === null) {
    throw new Error("Required completeness certificate is missing");
  }
  if (result.completenessCertificate !== null) {
    if (result.completenessState !== "VERIFIED") {
      throw new Error("Completeness certificate requires VERIFIED source truth");
    }
    verifyPersistedCompletenessCertificate(result, undefined, canonicalRawEvidenceIdSetSha256, sanofiArtifacts);
  }
  onStage("SOURCE_RESULT_VALIDATION");
  const baselineTransitionSupplied = result.baselineChangeReason !== undefined &&
    result.baselineChangeReason !== null;
  if (baselineTransitionSupplied) {
    if (result.completenessState !== "VERIFIED" || result.completenessCertificate === null) {
      throw new Error("Trusted baseline transition requires VERIFIED certificate truth");
    }
    assertTrustedBaselineTransition({
      previousSourceResultId: result.baselinePreviousSourceResultId,
      previousJobCount: result.baselinePreviousJobCount,
      currentSourceResultId: result.id,
      currentJobCount: result.dedupeOutputCount,
      certificateGrade: isSourceQualityReceipt(result.completenessCertificate) ? SOURCE_QUALITY_POLICY_ID
        : (result.completenessCertificate as { grade: "A" | "B" }).grade,
      changeReason: result.baselineChangeReason
    });
  } else if (result.baselinePreviousSourceResultId !== null && result.baselinePreviousSourceResultId !== undefined ||
      result.baselinePreviousJobCount !== null && result.baselinePreviousJobCount !== undefined) {
    throw new Error("Trusted baseline previous values require a change reason");
  }
}

function verifyPersistedCompletenessCertificate(
  result: AtomicSourceResultInput,
  officialArtifact?: { logicalKey: string; sha256: string },
  canonicalRawEvidenceIdSetSha256?: string,
  sanofiArtifacts?: readonly SanofiArtifactCommitment[]
): void {
  const expected = {
    releaseCandidateId: result.releaseCandidateId,
    batchId: result.batchId,
    sourceResultId: result.id,
    sourceId: result.sourceId,
    sourceConfigSha256: result.sourceConfigHash,
    surfaceIds: result.officialSurfaceIds,
    channelIds: result.officialChannelIds,
    canonicalJobSetSha256: result.canonicalOutputSetSha256,
    adapterReconciliationSha256: result.adapterReconciliationSha256,
    collisionLedgerSha256: result.collisionLedgerSha256,
    ...(result.sourceId==="source-sanofi-china-social" && sanofiArtifacts ? {sanofiArtifacts} : {})
  };
  if (isSourceQualityReceipt(result.completenessCertificate)) {
    const receipt = verifySourceQualityReceipt({ receipt: result.completenessCertificate,
      receiptSha256: result.completenessCertificateSha256!, expected: {
        releaseCandidateId: result.releaseCandidateId, batchId: result.batchId, sourceResultId: result.id,
        sourceId: result.sourceId, sourceConfigSha256: result.sourceConfigHash, adapterVersion: result.adapterVersion
      } });
    if (receipt.output.canonicalJobKeySetSha256 !== result.canonicalOutputSetSha256 ||
        receipt.ledger.adapterReconciliationSha256 !== result.adapterReconciliationSha256 ||
        receipt.ledger.collisionLedgerSha256 !== result.collisionLedgerSha256 ||
        receipt.counts.finalUniqueJobCount !== result.dedupeOutputCount ||
        canonicalRawEvidenceIdSetSha256 !== undefined && receipt.canonicalRawEvidenceIdSetSha256 !== canonicalRawEvidenceIdSetSha256) {
      throw new Error("Portable receipt persisted result commitment mismatch");
    }
    return;
  }
  if (requiresAGradeCertificateSourceId(result.sourceId) &&
      (result.completenessCertificate as { grade?: unknown } | null)?.grade !== "B") {
    verifyAGradeCompletenessCertificateReceipt({
      certificate: result.completenessCertificate,
      certificateSha256: result.completenessCertificateSha256!,
      expected: {
        ...expected,
        ...(officialArtifact ? {
          officialArtifactLogicalKey: officialArtifact.logicalKey,
          officialArtifactSha256: officialArtifact.sha256
        } : {})
      }
    });
    return;
  }
  if (requiresBGradeCertificateSourceId(result.sourceId)) {
    if (!(result.finishedAt instanceof Date) || !Number.isFinite(result.finishedAt.getTime())) {
      throw new Error("B-grade completeness certificate requires a finishedAt validation instant");
    }
    verifyBGradeTraversalCertificateReceipt({
      certificate: result.completenessCertificate,
      certificateSha256: result.completenessCertificateSha256!,
      expected: { ...expected, ...(canonicalRawEvidenceIdSetSha256 ? { canonicalRawEvidenceIdSetSha256 } : {}) },
      now: result.finishedAt
    });
    return;
  }
  throw new Error("Completeness certificate is not supported for this source");
}

function pendingSourceTupleWhere(input: { id: string; releaseCandidateId: string; batchId: string; sourceId: string }): Record<string, unknown> {
  return { id: input.id, releaseCandidateId: input.releaseCandidateId, batchId: input.batchId,
    sourceId: input.sourceId, atomicCommitState: "PENDING" };
}

function requireExactlyOnePendingResult(result: ConditionalUpdateResult): void {
  if (result.count !== 1) throw new Error("Expected exactly one matching PENDING source result");
}

function sourceResultTerminalData(result: AtomicSourceResultInput): Record<string, unknown> {
  const { id: _id, releaseCandidateId: _releaseCandidateId, batchId: _batchId, sourceId: _sourceId,
    sourceConfigHash: _sourceConfigHash, adapterVersion: _adapterVersion, officialEntryId: _officialEntryId,
    officialSurfaceIds: _officialSurfaceIds, officialChannelIds: _officialChannelIds, startedAt: _startedAt,
    ...terminal } = result;
  return terminal;
}

const ATOMIC_SOURCE_RESULT_FIELDS = [
  "id", "releaseCandidateId", "batchId", "sourceId", "transportState", "adapterState",
  "completenessState", "atomicCommitState", "sourceConfigHash", "adapterVersion", "officialEntryId",
  "officialSurfaceIds", "officialChannelIds", "startedAt", "finishedAt", "rawCount", "parsedCount",
  "validCount", "normalizedCount", "dedupeInputCount", "dedupeOutputCount", "parseDiscardCount",
  "validationDiscardCount", "normalizationDiscardCount", "dedupeDiscardCount", "collisionCount",
  "discardCount", "expectedJobCount", "expectedEvidenceKind", "expectedSurfaceSha256",
  "visitedSurfaceSha256", "expectedChannelSha256", "visitedChannelSha256",
  "canonicalCurrentJobSetSha256", "canonicalGraceJobSetSha256", "canonicalVisibleJobSetSha256",
  "canonicalOutputSetSha256", "adapterInputCount", "adapterOutputCount", "adapterLossCount",
  "adapterCollisionGroupCount", "adapterReconciliationSha256", "collisionLedgerSha256", "blockerCode",
  "completenessCertificate", "completenessCertificateSha256",
  "baselinePreviousSourceResultId", "baselinePreviousJobCount", "baselineChangeReason",
  "blockerReason", "failureCategory", "failureDiagnosticCode", "fetchAttemptCount", "retryCount", "retryReasonCodes",
  "failureCode", "failureReason"
] as const satisfies readonly (keyof AtomicSourceResultInput)[];

const PENDING_SOURCE_IMMUTABLE_FIELDS = [
  "id", "releaseCandidateId", "batchId", "sourceId", "sourceConfigHash", "adapterVersion",
  "officialEntryId", "officialSurfaceIds", "officialChannelIds", "startedAt"
] as const satisfies readonly (keyof AtomicSourceResultInput)[];

function isExactPersistedSourceResult(
  persisted: Record<string, unknown>,
  expected: AtomicSourceResultInput
): boolean {
  return ATOMIC_SOURCE_RESULT_FIELDS.every((field) => {
    const persistedHasField = Object.prototype.hasOwnProperty.call(persisted, field);
    const expectedHasField = Object.prototype.hasOwnProperty.call(expected, field);
    if (!persistedHasField && !expectedHasField && OPTIONAL_BASELINE_SOURCE_RESULT_FIELDS.has(field)) {
      return true;
    }
    return persistedHasField && persistedSourceValueEquals(persisted[field], expected[field] ?? null);
  });
}

const OPTIONAL_BASELINE_SOURCE_RESULT_FIELDS = new Set<keyof AtomicSourceResultInput>([
  "baselinePreviousSourceResultId", "baselinePreviousJobCount", "baselineChangeReason"
]);

function isExpectedPendingSourceResult(
  persisted: Record<string, unknown>,
  expected: Pick<AtomicSourceResultInput,
    "id" | "releaseCandidateId" | "batchId" | "sourceId" | "sourceConfigHash" |
    "adapterVersion" | "officialEntryId" | "officialSurfaceIds" | "officialChannelIds" | "startedAt">
): boolean {
  if (persisted.transportState !== "PENDING" || persisted.adapterState !== "PENDING" ||
      persisted.completenessState !== "PENDING" || persisted.atomicCommitState !== "PENDING") {
    return false;
  }
  return PENDING_SOURCE_IMMUTABLE_FIELDS.every((field) =>
    Object.prototype.hasOwnProperty.call(persisted, field) &&
    persistedSourceValueEquals(persisted[field], expected[field] ?? null));
}

function isExpectedPendingFailedSourceResult(
  persisted: Record<string, unknown>,
  expected: PendingSourceTerminalInput
): boolean {
  return persisted.transportState === "PENDING" && persisted.adapterState === "PENDING" &&
    persisted.completenessState === "PENDING" && persisted.atomicCommitState === "PENDING" &&
    (["id", "releaseCandidateId", "batchId", "sourceId"] as const).every((field) =>
      persisted[field] === expected[field]);
}

function isExactPersistedFailedEvidence(
  persisted: Record<string, unknown>,
  expected: FailedSourceEvidenceCommit
): boolean {
  const terminal = expected.sourceResult;
  const terminalFields: Array<keyof PendingSourceTerminalInput> = [
    "id", "releaseCandidateId", "batchId", "sourceId", "transportState", "adapterState",
    "completenessState", "atomicCommitState", "finishedAt", "failureCode", "failureReason",
    "blockerCode", "blockerReason", "failureCategory", "failureDiagnosticCode",
    "fetchAttemptCount", "retryCount", "retryReasonCodes"
  ];
  if (!terminalFields.every((field) => persistedSourceValueEquals(
    persisted[field], terminal[field] ?? null))) return false;
  const countFields = ["rawCount", "parsedCount", "validCount", "parseDiscardCount",
    "validationDiscardCount"] as const;
  if (!countFields.every((field) => persisted[field] === expected.fetchCounts[field]) ||
      persisted.discardCount !== expected.fetchCounts.parseDiscardCount +
        expected.fetchCounts.validationDiscardCount ||
      !persistedSourceValueEquals(persisted.expectedJobCount, expected.expectedJobCount) ||
      !persistedSourceValueEquals(persisted.expectedEvidenceKind, expected.expectedEvidenceKind)) return false;
  const zeroFields = ["normalizedCount", "dedupeInputCount", "dedupeOutputCount",
    "normalizationDiscardCount", "dedupeDiscardCount", "collisionCount"] as const;
  const nullFields = ["expectedSurfaceSha256", "visitedSurfaceSha256", "expectedChannelSha256",
    "visitedChannelSha256", "canonicalCurrentJobSetSha256", "canonicalGraceJobSetSha256",
    "canonicalVisibleJobSetSha256", "canonicalOutputSetSha256", "adapterInputCount",
    "adapterOutputCount", "adapterLossCount", "adapterCollisionGroupCount",
    "adapterReconciliationSha256", "collisionLedgerSha256", "completenessCertificate",
    "completenessCertificateSha256", "baselinePreviousSourceResultId", "baselinePreviousJobCount",
    "baselineChangeReason"] as const;
  if (zeroFields.some((field) => persisted[field] !== 0) ||
      nullFields.some((field) => persisted[field] != null) || relationRows(persisted.observations).length !== 0) {
    return false;
  }

  const artifacts = relationRows(persisted.evidenceArtifacts);
  if (!sameRows(artifacts, expected.artifacts, (row) => ({
    id: row.id, releaseCandidateId: row.releaseCandidateId, batchId: row.batchId,
    sourceId: row.sourceId, sourceResultId: row.sourceResultId, channelId: row.channelId ?? null,
    kind: row.kind, requestedUrl: row.requestedUrl ?? null, finalUrl: row.finalUrl ?? null,
    httpStatus: row.httpStatus ?? null, contentType: row.contentType ?? null,
    capturedAt: dateValue(row.capturedAt), sha256: row.sha256, byteCount: row.byteCount, path: row.path,
    extractorLocator: row.extractorLocator, captureToolName: row.captureToolName,
    captureToolVersion: row.captureToolVersion, redactionCommitmentSha256: row.redactionCommitmentSha256
  }))) return false;
  const artifactIdByLogicalKey = new Map(expected.artifacts.map((item) => [item.logicalKey, item.id]));
  const expectedPages = expected.pagination.map(({ artifactLogicalKey, ...page }) => ({
    ...page, artifactId: artifactIdByLogicalKey.get(artifactLogicalKey)
  }));
  const pagination = relationRows(persisted.paginationEvidence);
  if (!sameRows(pagination, expectedPages, (row) => ({
    releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceId: row.sourceId,
    sourceResultId: row.sourceResultId, artifactId: row.artifactId, sequence: row.sequence,
    channelId: row.channelId ?? null, requestedCursor: row.requestedCursor ?? null,
    returnedCursor: row.returnedCursor ?? null, requestedOffset: row.requestedOffset ?? null,
    returnedOffset: row.returnedOffset ?? null, requestedPage: row.requestedPage ?? null,
    returnedPage: row.returnedPage ?? null, requestedPageSize: row.requestedPageSize ?? null,
    returnedPageSize: row.returnedPageSize ?? null,
    responseFingerprintSha256: row.responseFingerprintSha256, rawJobIdSetSha256: row.rawJobIdSetSha256,
    validJobIdSetSha256: row.validJobIdSetSha256, declaredTotal: row.declaredTotal ?? null,
    declaredCount: row.declaredCount ?? null, declaredPages: row.declaredPages ?? null,
    nextPageSignalBefore: row.nextPageSignalBefore ?? null, nextPageSignalAfter: row.nextPageSignalAfter ?? null,
    termination: row.termination, anomalyCodes: row.anomalyCodes, capturedAt: dateValue(row.capturedAt)
  }))) return false;
  const losses = relationRows(persisted.lossLedgerEntries);
  if (!sameLossRows(losses, expected.lossLedger)) return false;
  const attempts = relationRows(persisted.transportAttempts);
  return sameRows(attempts, expected.priorTransportAttempts, (row) => ({
    id: row.id, releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceId: row.sourceId,
    sourceResultId: row.sourceResultId, sequence: row.sequence, transport: row.transport,
    outcome: row.outcome, code: row.code, capturedAt: dateValue(row.capturedAt),
    evidenceCommitmentSha256: row.evidenceCommitmentSha256, pageTraceSha256: row.pageTraceSha256,
    lossLedgerSha256: row.lossLedgerSha256, paginationEvaluationSha256: row.paginationEvaluationSha256,
    details: row.details,
    artifactIds: Array.isArray(row.artifactIds) ? [...row.artifactIds].sort() :
      relationRows(row.artifactRefs).map((item) => String(item.artifactId)).sort()
  }));
}

function relationRows(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter((row): row is Record<string, any> =>
    typeof row === "object" && row !== null) : [];
}

function sameRows(
  actual: readonly Record<string, any>[],
  expected: readonly Record<string, any>[],
  project: (row: Record<string, any>) => unknown
): boolean {
  if (actual.length !== expected.length) return false;
  const normalize = (rows: readonly Record<string, any>[]) => rows.map((row) =>
    canonicalComparisonJson(project(row))).sort();
  const left = normalize(actual), right = normalize(expected);
  return left.every((value, index) => value === right[index]);
}

function sameLossRows(
  actual: readonly Record<string, any>[],
  expected: readonly AtomicLossLedgerInput[]
): boolean {
  if (actual.length !== expected.length) return false;
  const core = (row: Record<string, any>) => canonicalComparisonJson({
    releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceId: row.sourceId,
    sourceResultId: row.sourceResultId, stage: row.stage, reason: row.reason, rawLocator: row.rawLocator,
    details: row.details, candidateKey: row.candidateKey ?? null, winnerKey: row.winnerKey ?? null
  });
  const remaining = [...actual];
  for (const expectedRow of expected) {
    const index = remaining.findIndex((actualRow) => core(actualRow) === core(expectedRow) &&
      (expectedRow.recordedAt === undefined ||
        dateValue(actualRow.recordedAt) === dateValue(expectedRow.recordedAt)));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function canonicalComparisonJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalComparisonJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)).map(([key, child]) =>
      `${JSON.stringify(key)}:${canonicalComparisonJson(child)}`).join(",")}}`;
}

function dateValue(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function persistedSourceValueEquals(actual: unknown, expected: unknown): boolean {
  if (actual == null || expected == null) return actual == null && expected == null;
  if (expected instanceof Date) {
    const actualDate = actual instanceof Date ? actual : new Date(String(actual));
    return !Number.isNaN(actualDate.getTime()) && actualDate.getTime() === expected.getTime();
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      expected.every((value, index) => actual[index] === value);
  }
  if (typeof expected === "object") {
    return Object.prototype.toString.call(expected) === "[object Object]" &&
      Object.prototype.toString.call(actual) === "[object Object]" &&
      canonicalComparisonJson(actual) === canonicalComparisonJson(expected);
  }
  return actual === expected;
}

function validateAtomicSourceEvidenceCommit(
  input: AtomicSourceEvidenceCommit,
  manualPreview: boolean,
  onStage: (stage: AtomicEvidencePersistenceStage) => void
): {
  observationCommand: Extract<IngestionCommand, { type: "UPSERT_CRAWL_OBSERVATION" }>;
  artifactIdsByLogicalKey: Map<string, string>;
  officialArtifactId: string;
} {
  onStage("SOURCE_RESULT_VALIDATION");
  const result = input.sourceResult;
  const tuple: EvidenceTuple = {
    releaseCandidateId: result.releaseCandidateId,
    batchId: result.batchId,
    sourceId: result.sourceId,
    sourceResultId: result.id
  };
  for (const [name, value] of Object.entries(tuple)) requireNonblank(value, name);
  for (const [name, value] of [
    ["commitSha", input.observationProvenance.commitSha],
    ["rosterSha256", input.observationProvenance.rosterSha256],
    ["sourcePlanSha256", input.observationProvenance.sourcePlanSha256],
    ["sourceConfigHash", result.sourceConfigHash],
    ["adapterVersion", result.adapterVersion]
  ] as const) requireNonblank(value, name);
  if (result.officialEntryId !== null) requireNonblank(result.officialEntryId, "officialEntryId");
  if (!isValidDate(result.startedAt) || (result.finishedAt !== null && !isValidDate(result.finishedAt)) ||
      (result.finishedAt !== null && result.startedAt > result.finishedAt)) {
    throw new Error("Source-result timestamps are invalid or unordered");
  }
  validateCommittedSourceResultTruthTable(
    result,
    input.observationProvenance.canonicalRawSha256,
    onStage,
    input.artifacts
  );
  onStage("SOURCE_RESULT_VALIDATION");
  const provenance = input.observationProvenance;
  assertTuple(provenance, tuple, "observation provenance");
  if (!isValidDate(provenance.observedFrom) || !isValidDate(provenance.observedTo) ||
      provenance.observedFrom > provenance.observedTo) {
    throw new Error("Observation timestamps are invalid or unordered");
  }
  if (provenance.sourceConfigSha256 !== result.sourceConfigHash || provenance.adapterVersion !== result.adapterVersion) {
    throw new Error("Observation provenance does not match source result");
  }
  for (const [name, value] of [
    ["rosterSha256", provenance.rosterSha256],
    ["sourcePlanSha256", provenance.sourcePlanSha256],
    ["sourceConfigSha256", provenance.sourceConfigSha256],
    ["sourceConfigHash", result.sourceConfigHash]
  ] as const) requireSha256(value, name);
  validateNonblankUniqueList(result.officialSurfaceIds, "official surface");
  validateNonblankUniqueList(result.officialChannelIds, "official channel");
  validateCounts(result);
  if (isSourceQualityReceipt(result.completenessCertificate)) {
    verifySourceQualityAtomicCommit({ plan: sourceQualityPlan(result.sourceId), commit: input });
  }

  onStage("COMMAND_VALIDATION");
  const observations = input.commands.filter(
    (command): command is Extract<IngestionCommand, { type: "UPSERT_CRAWL_OBSERVATION" }> =>
      command.type === "UPSERT_CRAWL_OBSERVATION"
  );
  if (observations.length !== 1) throw new Error("Exactly one observation command is required");
  const observation = observations[0]!;
  if (observation.observation.sourceId !== tuple.sourceId) throw new Error("Observation source tuple mismatch");
  if (!isValidDate(observation.observation.crawledAt)) {
    throw new Error("Observation crawledAt is invalid");
  }
  for (const [name, value] of [
    ["totalPages", observation.observation.totalPages],
    ["pageSize", observation.observation.pageSize],
    ["pagesVisited", observation.observation.pagesVisited]
  ] as const) {
    if (value !== undefined) requireNonnegativeInteger(value, `observation ${name}`);
  }
  for (const command of input.commands) {
    if (command.type !== "UPSERT_JOB") continue;
    requireNonblank(command.dedupeKey, "job dedupeKey");
    requireNonblank(command.record.companyId, "job companyId");
    requireNonblank(command.record.sourceId, "job sourceId");
    requireNonblank(command.record.officialTitle, "job officialTitle");
    requireNonblank(command.record.officialUrl, "job officialUrl");
    requireNonblank(command.record.locationRaw, "job locationRaw");
    if (command.record.sourceId !== tuple.sourceId) throw new Error("Job source does not match source tuple");
    if (command.record.cities.length === 0 || command.record.cities.some((city) => !nonblank(city))) {
      throw new Error(`Job ${command.dedupeKey} cities must contain at least one nonblank city`);
    }
    const firstSeenAt = new Date(command.firstSeenAt);
    const lastSeenAt = new Date(command.lastSeenAt);
    if (!isValidDate(firstSeenAt) || !isValidDate(lastSeenAt)) {
      throw new Error(`Job ${command.dedupeKey} timestamps are invalid`);
    }
    if (firstSeenAt > lastSeenAt) {
      throw new Error(`Job ${command.dedupeKey} firstSeenAt must not be after lastSeenAt`);
    }
    if (command.record.officialPublishedAt !== undefined &&
        !isValidDate(new Date(command.record.officialPublishedAt))) {
      throw new Error(`Job ${command.dedupeKey} officialPublishedAt is invalid`);
    }
    requireNonnegativeInteger(
      command.missingSuccessfulCrawlCount,
      `job ${command.dedupeKey} missingSuccessfulCrawlCount`
    );
  }
  const jobCommands=input.commands.filter((command):command is Extract<IngestionCommand,{type:"UPSERT_JOB"}>=>command.type==="UPSERT_JOB");
  if (manualPreview) {
    if (jobCommands.length !== 0) throw new Error("Manual source preview cannot contain Job lifecycle commands");
    const emptySetHash = hashCanonicalStringSet([]);
    if (result.canonicalGraceJobSetSha256 !== emptySetHash ||
        result.canonicalVisibleJobSetSha256 !== emptySetHash) {
      throw new Error("Manual source preview lifecycle sets must be empty");
    }
  }
  if(new Set(jobCommands.map(command=>command.dedupeKey)).size!==jobCommands.length) {
    throw new Error("Job commands must be unique");
  }
  if(result.completenessState==="VERIFIED" && !manualPreview) {
    for(const command of jobCommands) {
      const expectedStatus=command.missingSuccessfulCrawlCount<=1?"ACTIVE":command.missingSuccessfulCrawlCount===2?"SUSPECTED_OFFLINE":"OFFLINE";
      if(command.lifecycleStatus!==expectedStatus||command.visibleInFrontend!==(command.lifecycleStatus==="ACTIVE")) throw new Error("Lifecycle command status/count/visibility mismatch");
    }
    const currentKeys=jobCommands.filter(command=>command.missingSuccessfulCrawlCount===0).map(command=>command.dedupeKey);
    const graceKeys=jobCommands.filter(command=>command.missingSuccessfulCrawlCount===1&&command.lifecycleStatus==="ACTIVE").map(command=>command.dedupeKey);
    const visibleKeys=jobCommands.filter(command=>command.visibleInFrontend).map(command=>command.dedupeKey);
    if(currentKeys.length!==result.dedupeOutputCount || currentKeys.some(key=>graceKeys.includes(key)) ||
        hashCanonicalStringSet(currentKeys)!==result.canonicalCurrentJobSetSha256 ||
        hashCanonicalStringSet(graceKeys)!==result.canonicalGraceJobSetSha256 ||
        hashCanonicalStringSet(visibleKeys)!==result.canonicalVisibleJobSetSha256) {
      throw new Error("Lifecycle current/grace/visible sets do not match committed hashes");
    }
  } else if (!manualPreview) {
    const emptySetHash = hashCanonicalStringSet([]);
    if (input.publicationPolicy === "SOURCE_ATOMIC_LAST_GOOD_V1" || result.blockerCode === "COMPLETENESS_ANOMALY_UNVERIFIED") {
      if (jobCommands.length !== 0 || result.canonicalGraceJobSetSha256 !== emptySetHash ||
          result.canonicalVisibleJobSetSha256 !== emptySetHash ||
          result.canonicalOutputSetSha256 !== result.canonicalCurrentJobSetSha256) {
        throw new Error("Unverified completeness anomaly must preserve the prior public Job projection");
      }
    } else {
      for (const command of jobCommands) {
        if (command.missingSuccessfulCrawlCount !== 0 || command.lifecycleStatus !== "ACTIVE" ||
            command.visibleInFrontend !== true) {
          throw new Error("Partial source result may only refresh currently observed active jobs");
        }
      }
      const currentKeys = jobCommands.map((command) => command.dedupeKey);
      if (currentKeys.length !== result.dedupeOutputCount ||
          hashCanonicalStringSet(currentKeys) !== result.canonicalCurrentJobSetSha256 ||
          result.canonicalOutputSetSha256 !== result.canonicalCurrentJobSetSha256 ||
          result.canonicalGraceJobSetSha256 !== emptySetHash ||
          result.canonicalVisibleJobSetSha256 !== result.canonicalCurrentJobSetSha256) {
        throw new Error("Partial current job set does not match committed hashes");
      }
    }
  }
  if (observation.observation.structuredJobCount !== result.dedupeOutputCount) {
    throw new Error("Observation structured output does not match dedupeOutputCount");
  }
  if ((observation.observation.expectedJobCount ?? null) !== result.expectedJobCount ||
      (observation.observation.completenessEvidenceKind ?? null) !== result.expectedEvidenceKind ||
      (observation.observation.completenessStatus ?? null) !== result.completenessState ||
      (observation.observation.completenessBlockerReason ?? null) !== (result.blockerReason ?? null)) {
    throw new Error("Observation counters or completeness do not match source result");
  }

  onStage("ARTIFACT_VALIDATION");
  const { idsByLogicalKey: artifactIdsByLogicalKey,
    artifactsByLogicalKey: artifactByLogicalKey } = validateEvidenceArtifacts(input.artifacts, tuple);
  requireNonblank(provenance.officialEvidenceArtifactLogicalKey, "official evidence artifact logical key");
  const officialArtifact = artifactByLogicalKey.get(provenance.officialEvidenceArtifactLogicalKey);
  if (!officialArtifact) throw new Error("Designated official evidence artifact is missing");
  if (result.completenessCertificate !== null) {
    onStage("CERTIFICATE_VALIDATION");
    verifyPersistedCompletenessCertificate(result, {
      logicalKey: officialArtifact.logicalKey,
      sha256: officialArtifact.sha256
    }, provenance.canonicalRawSha256, input.artifacts);
  }
  onStage("ARTIFACT_VALIDATION");
  if (result.expectedEvidenceKind === "OFFICIAL_TOTAL_COUNT") {
    if (result.expectedJobCount === null || (!NETWORK_ARTIFACT_KINDS.has(officialArtifact.kind) && !hasBoundJnjDomOfficialArtifact(input, officialArtifact))) {
      throw new Error("OFFICIAL_TOTAL_COUNT requires explicit expectedJobCount and an archived network artifact");
    }
    if (result.completenessState === "VERIFIED" &&
        result.expectedJobCount !== result.dedupeOutputCount &&
        !hasVerifiedPortableOfficialTotalAccounting(input) &&
        !hasVerifiedAGradeOfficialTotalDedupe(input) &&
        !hasExactBoehringerVerifiedUiExclusions(input) &&
        !hasExactGrifolsVerifiedDetailScopeExclusions(input, artifactByLogicalKey)) {
      throw new Error("OFFICIAL_TOTAL_COUNT expectedJobCount must equal dedupeOutputCount");
    }
    requireNonblank(officialArtifact.extractorLocator, "OFFICIAL_TOTAL_COUNT extraction locator");
  }

  onStage("PAGINATION_VALIDATION");
  validateEvidencePagination(input.pagination, tuple, artifactIdsByLogicalKey,
    result.completenessState === "VERIFIED");

  onStage("LOSS_LEDGER_VALIDATION");
  const { counts: lossCounts, collisionGroups } = validateEvidenceLossRows(input.lossLedger, tuple, false);
  if (lossCounts.PARSE !== result.parseDiscardCount ||
      lossCounts.VALIDATION !== result.validationDiscardCount ||
      lossCounts.NORMALIZATION !== result.normalizationDiscardCount ||
      lossCounts.DEDUPE !== result.dedupeDiscardCount || collisionGroups.size !== result.collisionCount) {
    throw new Error("Loss ledger rows do not reconcile to discard and collision counts");
  }

  onStage("RECONCILIATION_VALIDATION");
  requireSha256(result.canonicalOutputSetSha256, "canonicalOutputSetSha256");
  requireSha256(result.adapterReconciliationSha256, "adapterReconciliationSha256");
  requireSha256(result.collisionLedgerSha256, "collisionLedgerSha256");
  requireSha256(provenance.artifactRedactionCommitmentSha256, "artifactRedactionCommitmentSha256");
  for (const field of ["adapterInputCount", "adapterOutputCount", "adapterLossCount",
    "adapterCollisionGroupCount"] as const) requireNonnegativeInteger(result[field], field);
  if (result.adapterInputCount !== result.adapterOutputCount + result.adapterLossCount ||
      result.adapterOutputCount !== result.dedupeOutputCount ||
      result.adapterCollisionGroupCount !== result.collisionCount ||
      result.canonicalOutputSetSha256 !== provenance.canonicalOutputSha256) {
    throw new Error("Adapter reconciliation does not match canonical source-result truth");
  }
  if (hashCanonicalStringSet(input.artifacts.map((artifact) => artifact.redactionCommitmentSha256)) !==
      provenance.artifactRedactionCommitmentSha256) {
    throw new Error("Artifact redaction commitments do not match observation provenance");
  }
  onStage("TRANSPORT_ATTEMPT_VALIDATION");
  validateEvidenceTransportAttempts(input.priorTransportAttempts, tuple,
    new Set(input.artifacts.map(({ id }) => id)));

  onStage("COMMITTED_EVIDENCE_VALIDATION");
  if (!provenance.transportSucceeded || !provenance.adapterSucceeded || !provenance.atomicCommitSucceeded ||
      provenance.completenessVerified !== (result.completenessState === "VERIFIED") ||
      !observation.observation.successful) {
    throw new Error("COMMITTED state requires matching successful observation provenance");
  }
  if (input.pagination.length === 0) {
    throw new Error("COMMITTED completeness requires nonempty pagination evidence");
  }
  if (observation.observation.pagesVisited !== input.pagination.length) {
    throw new Error("pagesVisited must equal pagination evidence row count");
  }
  if (provenance.expectedSurfaceSha256 !== result.expectedSurfaceSha256 ||
      provenance.visitedSurfaceSha256 !== result.visitedSurfaceSha256 ||
      provenance.expectedChannelSha256 !== result.expectedChannelSha256 ||
      provenance.visitedChannelSha256 !== result.visitedChannelSha256 ||
      provenance.canonicalOutputSha256 !== result.canonicalCurrentJobSetSha256 ||
      provenance.canonicalGraceSha256 !== result.canonicalGraceJobSetSha256 ||
      provenance.canonicalVisibleSha256 !== result.canonicalVisibleJobSetSha256) {
    throw new Error("COMMITTED observation evidence hashes do not match source result");
  }

  if (result.completenessState === "VERIFIED") {
    const verifiedHashes: Array<[string, string | null]> = [
      ["expectedSurfaceSha256", result.expectedSurfaceSha256],
      ["visitedSurfaceSha256", result.visitedSurfaceSha256],
      ["expectedChannelSha256", result.expectedChannelSha256],
      ["visitedChannelSha256", result.visitedChannelSha256],
      ["canonicalCurrentJobSetSha256", result.canonicalCurrentJobSetSha256],
      ["canonicalGraceJobSetSha256", result.canonicalGraceJobSetSha256],
      ["canonicalVisibleJobSetSha256", result.canonicalVisibleJobSetSha256],
      ["canonicalRawSha256", provenance.canonicalRawSha256],
      ["canonicalOutputSha256", provenance.canonicalOutputSha256],
      ["canonicalGraceSha256", provenance.canonicalGraceSha256],
      ["canonicalVisibleSha256", provenance.canonicalVisibleSha256],
      ["paginationTraceSha256", provenance.paginationTraceSha256]
    ];
    for (const [name, value] of verifiedHashes) {
      if (value === null) throw new Error(`VERIFIED completeness requires explicit ${name} hash`);
      requireSha256(value, `VERIFIED ${name}`);
    }
    if (result.expectedSurfaceSha256 !== result.visitedSurfaceSha256) {
      throw new Error("VERIFIED expected and visited surface hashes must match");
    }
    if (result.expectedChannelSha256 !== result.visitedChannelSha256) {
      throw new Error("VERIFIED expected and visited channel hashes must match");
    }
  }
  return { observationCommand: observation, artifactIdsByLogicalKey, officialArtifactId: officialArtifact.id };
}

const GRIFOLS_SOURCE_ID = "source-grifols-china-social";
const BOEHRINGER_SOURCE_ID = "source-boehringer-ingelheim-china-social";
const GRIFOLS_DETAIL_LOCATOR =
  "grifols-successfactors-detail-v1|html:canonical+streetAddress+content-location";

function hasVerifiedAGradeOfficialTotalDedupe(input: AtomicSourceEvidenceCommit): boolean {
  const result = input.sourceResult;
  const certificate = result.completenessCertificate;
  if (!requiresAGradeCertificateSourceId(result.sourceId) ||
      typeof certificate !== "object" || certificate === null || Array.isArray(certificate) ||
      (certificate as { grade?: unknown }).grade !== "A" ||
      result.expectedEvidenceKind !== "OFFICIAL_TOTAL_COUNT" || result.expectedJobCount === null ||
      result.parseDiscardCount !== 0 || result.validationDiscardCount !== 0 ||
      result.normalizationDiscardCount !== 0 || result.dedupeDiscardCount <= 0 ||
      result.collisionCount <= 0 || result.discardCount !== result.dedupeDiscardCount ||
      result.rawCount !== result.expectedJobCount || result.parsedCount !== result.rawCount ||
      result.validCount !== result.rawCount || result.normalizedCount !== result.rawCount ||
      result.dedupeInputCount !== result.rawCount ||
      result.expectedJobCount !== result.dedupeOutputCount + result.dedupeDiscardCount ||
      result.adapterInputCount !== result.dedupeInputCount ||
      result.adapterOutputCount !== result.dedupeOutputCount ||
      result.adapterLossCount !== result.dedupeDiscardCount ||
      result.adapterCollisionGroupCount !== result.collisionCount ||
      input.lossLedger.length !== result.dedupeDiscardCount) return false;
  return input.lossLedger.every((loss) =>
    loss.stage === "DEDUPE" && nonblank(loss.candidateKey) && nonblank(loss.winnerKey));
}

function hasExactBoehringerVerifiedUiExclusions(input: AtomicSourceEvidenceCommit): boolean {
  const result = input.sourceResult;
  const certificate = result.completenessCertificate;
  if (result.sourceId !== BOEHRINGER_SOURCE_ID ||
      result.expectedEvidenceKind !== "OFFICIAL_TOTAL_COUNT" || result.expectedJobCount === null ||
      typeof certificate !== "object" || certificate === null || Array.isArray(certificate) ||
      (certificate as { schemaVersion?: unknown }).schemaVersion !== "b-grade-independent-traversal-v2" ||
      (certificate as { grade?: unknown }).grade !== "B" ||
      result.parseDiscardCount !== 0 || result.validationDiscardCount <= 0 ||
      result.normalizationDiscardCount !== 0 || result.dedupeDiscardCount !== 0 || result.collisionCount !== 0 ||
      result.discardCount !== result.validationDiscardCount || result.rawCount !== result.expectedJobCount ||
      result.parsedCount !== result.rawCount ||
      result.validCount !== result.rawCount - result.validationDiscardCount ||
      result.normalizedCount !== result.validCount || result.dedupeInputCount !== result.validCount ||
      result.dedupeOutputCount !== result.validCount ||
      result.expectedJobCount !== result.dedupeOutputCount + result.validationDiscardCount ||
      input.lossLedger.length !== result.validationDiscardCount) return false;
  const values = certificate as {
    binding?: { sourceId?: unknown };
    counts?: { validationDiscardCount?: unknown; finalUniqueJobCount?: unknown };
  };
  if (values.binding?.sourceId !== BOEHRINGER_SOURCE_ID ||
      values.counts?.validationDiscardCount !== result.validationDiscardCount ||
      values.counts?.finalUniqueJobCount !== result.dedupeOutputCount) return false;
  const indexes = new Set<number>();
  return input.lossLedger.every((loss) => {
    const details = loss.details;
    if (loss.stage !== "VALIDATION" || loss.reason !== "51job record excluded by official recruitment UI" ||
        !/^official-json-page-0000#record:\d+#sha256:[0-9a-f]{64}$/u.test(loss.rawLocator) ||
        typeof details !== "object" || details === null || Array.isArray(details)) return false;
    const code = (details as Record<string, unknown>).code;
    const recordIndex = (details as Record<string, unknown>).recordIndex;
    if (code !== "OFFICIAL_UI_EXCLUSION" || !Number.isSafeInteger(recordIndex) ||
        (recordIndex as number) < 0 || indexes.has(recordIndex as number)) return false;
    indexes.add(recordIndex as number);
    return true;
  });
}

function hasExactGrifolsVerifiedDetailScopeExclusions(
  input: AtomicSourceEvidenceCommit,
  artifactsByLogicalKey: ReadonlyMap<string, AtomicEvidenceArtifactInput>
): boolean {
  const result = input.sourceResult;
  if (result.sourceId !== GRIFOLS_SOURCE_ID || result.expectedEvidenceKind !== "OFFICIAL_TOTAL_COUNT" ||
      result.expectedJobCount === null || result.parseDiscardCount !== 0 || result.normalizationDiscardCount !== 0 ||
      result.dedupeDiscardCount !== 0 || result.validationDiscardCount <= 0 ||
      result.rawCount !== result.expectedJobCount || result.parsedCount !== result.rawCount ||
      result.validCount !== result.dedupeOutputCount ||
      result.expectedJobCount !== result.dedupeOutputCount + result.validationDiscardCount ||
      input.lossLedger.length !== result.validationDiscardCount) return false;

  const recordIndexes = new Set<number>();
  for (const loss of input.lossLedger) {
    const details = loss.details;
    if (loss.stage !== "VALIDATION" ||
        loss.reason !== "official detail places the job outside mainland China" ||
        typeof details !== "object" || details === null || Array.isArray(details)) return false;
    const values = details as Record<string, unknown>;
    const recordIndex = values.recordIndex;
    if (values.code !== "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE" ||
        !Number.isSafeInteger(recordIndex) || (recordIndex as number) < 0 || recordIndexes.has(recordIndex as number)) {
      return false;
    }
    const rawLocatorMatch = /^(grifols-detail-\d{4})#(.+)$/u.exec(loss.rawLocator);
    if (!rawLocatorMatch || rawLocatorMatch[2] !== GRIFOLS_DETAIL_LOCATOR) return false;
    const artifact = artifactsByLogicalKey.get(rawLocatorMatch[1]!);
    if (!artifact || artifact.kind !== "ATS_PAGE" || artifact.extractorLocator !== GRIFOLS_DETAIL_LOCATOR) return false;
    recordIndexes.add(recordIndex as number);
  }
  return true;
}

const NETWORK_ARTIFACT_KINDS = new Set<EvidenceArtifactKind>([
  "OFFICIAL_COMPANY_PAGE", "REDIRECT_TRACE", "ATS_PAGE", "ATS_API_RESPONSE", "PAGINATION_PAGE"
]);
const UNSAFE_VERIFIED_TERMINATIONS = new Set<PaginationTermination>([
  "REPEATED_CURSOR", "MAX_PAGE_LIMIT", "FAILED", "ABORTED"
]);

function validateCounts(result: AtomicSourceResultInput): void {
  const fields = ["rawCount", "parsedCount", "validCount", "normalizedCount", "dedupeInputCount",
    "dedupeOutputCount", "parseDiscardCount", "validationDiscardCount", "normalizationDiscardCount",
    "dedupeDiscardCount", "collisionCount", "discardCount", "adapterInputCount", "adapterOutputCount",
    "adapterLossCount", "adapterCollisionGroupCount"] as const;
  for (const field of fields) requireNonnegativeInteger(result[field], field);
  if (result.expectedJobCount !== null) requireNonnegativeInteger(result.expectedJobCount, "expectedJobCount");
  if (result.rawCount !== result.parsedCount + result.parseDiscardCount ||
      result.parsedCount !== result.validCount + result.validationDiscardCount ||
      result.validCount !== result.normalizedCount + result.normalizationDiscardCount ||
      result.normalizedCount !== result.dedupeInputCount ||
      result.dedupeInputCount !== result.dedupeOutputCount + result.dedupeDiscardCount ||
      result.discardCount !== result.parseDiscardCount + result.validationDiscardCount +
        result.normalizationDiscardCount + result.dedupeDiscardCount ||
      result.collisionCount > result.dedupeDiscardCount) {
    throw new Error("Source-result counts violate SQL loss reconciliation");
  }
}

function validateSafeJson(value: unknown, label: string, depth = 0): void {
  if (depth > 12) throw new Error(`${label} exceeds safe JSON depth`);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (containsCredentialMaterial(value)) throw new Error(`${label} contains credential material`);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) validateSafeJson(item, label, depth + 1); return; }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be strict JSON`);
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/password|secret|token|cookie|authorization|credential|api[-_]?key/i.test(key) ||
        key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`${label} contains a forbidden key`);
    }
    validateSafeJson(item, label, depth + 1);
  }
}

const TRANSPORT_ATTEMPT_CODES = new Set<TransportAttemptCode>([
  "HCM_DIRECT_FAILED", "HCM_BROWSER_SESSION_FAILED", "HCM_BROWSER_ENTRY_FAILED",
  "HCM_BROWSER_COUNT_FAILED", "HCM_BROWSER_LIST_FAILED", "HCM_BROWSER_SUCCEEDED",
  "JNJ_DIRECT_FAILED", "JNJ_BROWSER_SESSION_FAILED", "JNJ_BROWSER_FETCH_FAILED", "JNJ_BROWSER_SUCCEEDED"
]);
const JNJ_SOURCE_ID = "source-johnson-innovative-medicine-social";

function assertTuple(value: EvidenceTuple, expected: EvidenceTuple, label: string): void {
  if (value.releaseCandidateId !== expected.releaseCandidateId || value.batchId !== expected.batchId ||
      value.sourceId !== expected.sourceId || value.sourceResultId !== expected.sourceResultId) {
    throw new Error(`${label} tuple mismatch`);
  }
}

function validateNonblankUniqueList(values: readonly string[], label: string): void {
  if (values.length === 0 || values.some((value) => !nonblank(value)) || new Set(values).size !== values.length) {
    throw new Error(`${label} IDs must be nonblank and unique`);
  }
}

function validateOptionalUniqueList(values: readonly string[], label: string): void {
  if (values.some((value) => !nonblank(value)) || new Set(values).size !== values.length) {
    throw new Error(`${label} IDs must be nonblank and unique when supplied`);
  }
}

function requireNonblank(value: string | undefined | null, name: string): asserts value is string {
  if (!nonblank(value)) throw new Error(`${name} must be nonblank`);
}

function nonblank(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireSha256(value: string, name: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be a lowercase 64-hex sha256`);
}

function requireNonnegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative integer`);
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function toOptionalDate(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}

function isSourceQualityReceipt(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === SOURCE_QUALITY_RECEIPT_SCHEMA;
}
function sourceQualityPlan(sourceId: string): SourceCrawlPlan {
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(plan => plan.source.id === sourceId);
  if (!plan) throw new Error("Portable source plan is unavailable");
  return plan;
}
function hasVerifiedPortableOfficialTotalAccounting(input: AtomicSourceEvidenceCommit): boolean {
  if (!isSourceQualityReceipt(input.sourceResult.completenessCertificate)) return false;
  const receipt = verifySourceQualityAtomicCommit({ plan: sourceQualityPlan(input.sourceResult.sourceId), commit: input });
  return receipt.declaredCompleteness.kind === "OFFICIAL_TOTAL_COUNT" && receipt.declaredCompleteness.scope === "SOURCE" &&
    receipt.declaredCompleteness.value === input.sourceResult.expectedJobCount &&
    receipt.counts.rawCount === input.sourceResult.expectedJobCount;
}
