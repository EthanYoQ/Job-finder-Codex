import type { IngestionCommand } from "../crawler/ingestion";
import { createHash } from "node:crypto";
import { containsCredentialMaterial } from "../security/credentialMaterial";
import { canonicalizePlannedSourceIds, hashCanonicalStringSet } from "../crawler/runtimeBatchIdentity";
import {
  toPrismaJobCategory,
  toPrismaLifecycleStatus,
  toPrismaRequiredJobField,
  type PrismaCompletenessEvidenceKindName,
  type PrismaCompletenessStatusName,
  type PrismaJobCategoryName,
  type PrismaLifecycleStatusName,
  type PrismaRequiredJobFieldName
} from "./prismaMappers";

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
  auxiliaryChineseTitle: string | null;
  officialUrl: string;
  listUrl: string | null;
  locationRaw: string;
  city: string;
  cities: string[];
  category: PrismaJobCategoryName;
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
  "HCM_BROWSER_ENTRY_FAILED" | "HCM_BROWSER_COUNT_FAILED" | "HCM_BROWSER_LIST_FAILED";

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
  blockerCode?: string | null;
  blockerReason?: string | null;
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
  $transaction<T>(operation: (transaction: AtomicSourceTransactionClient) => Promise<T>): Promise<T>;
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
        blockerCode: null,
        blockerReason: null,
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
      data: {
        transportState: input.transportState,
        adapterState: input.adapterState,
        completenessState: input.completenessState,
        atomicCommitState: input.atomicCommitState,
        finishedAt: input.finishedAt,
        failureCode: input.failureCode,
        failureReason: input.failureReason,
        blockerCode: input.blockerCode ?? null,
        blockerReason: input.blockerReason ?? null
      }
    });
    requireExactlyOnePendingResult(result);
  });
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
  const primaryCity = command.record.cities[0];
  if (!primaryCity) {
    throw new Error(`Cannot ingest job ${command.dedupeKey} without at least one city`);
  }

  await db.job.upsert({
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
        auxiliaryChineseTitle: command.record.auxiliaryChineseTitle ?? null,
        officialUrl: command.record.officialUrl,
        listUrl: command.record.listUrl ?? null,
        locationRaw: command.record.locationRaw,
        city: primaryCity,
        cities: [...command.record.cities],
        category: toPrismaJobCategory(command.record.category),
        officialPublishedAt: toOptionalDate(command.record.officialPublishedAt),
        lastSeenAt: new Date(command.lastSeenAt),
        missingSuccessCount: command.missingSuccessfulCrawlCount,
        lifecycleStatus: toPrismaLifecycleStatus(command.lifecycleStatus),
        visibleInFrontend: command.visibleInFrontend,
        isNew: command.isNew
      }
  });
}

export async function executeAtomicSourceEvidenceCommit(
  input: AtomicSourceEvidenceCommit,
  db: PrismaAtomicSourceEvidenceDb
): Promise<void> {
  return executeAtomicSourceEvidenceCommitInternal(input, db);
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
  manualFence?: ManualSourceCommitFence
): Promise<void> {
  const { verifyAtomicRuntimeCommitAttestation } = await import("../crawler/runtimeAtomicEvidence");
  verifyAtomicRuntimeCommitAttestation(input);
  const validated = validateAtomicSourceEvidenceCommit(input, manualFence !== undefined);

  await db.$transaction(async (transaction) => {
    if (manualFence) {
      if (!transaction.$queryRawUnsafe) throw new ManualSourceCommitFenceError();
      const ownedRequest = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        LOCK_MANUAL_REQUEST_FOR_COMMIT_SQL,
        manualFence.requestId, manualFence.ownerId, input.sourceResult.sourceId);
      if (ownedRequest.length !== 1 || ownedRequest[0]?.id !== manualFence.requestId) {
        throw new ManualSourceCommitFenceError();
      }
      const ownedBatch = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        LOCK_MANUAL_BATCH_FOR_COMMIT_SQL,
        input.sourceResult.batchId, manualFence.requestId, manualFence.ownerId);
      if (ownedBatch.length !== 1 || ownedBatch[0]?.id !== input.sourceResult.batchId) {
        throw new ManualSourceCommitFenceError();
      }
    }
    for (const artifact of input.artifacts) {
      const { logicalKey: _logicalKey, ...data } = artifact;
      await transaction.evidenceArtifact.create({ data });
    }

    for (const page of input.pagination) {
      const { artifactLogicalKey, ...data } = page;
      await transaction.paginationEvidence.create({
        data: { ...data, artifactId: validated.artifactIdsByLogicalKey.get(artifactLogicalKey) }
      });
    }

    for (const loss of input.lossLedger) {
      await transaction.lossLedgerEntry.create({ data: { ...loss } });
    }

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

    const observation = validated.observationCommand.observation;
    const sourceResult = input.sourceResult;
    const provenance = input.observationProvenance;
    await transaction.crawlObservation.create({
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

    for (const command of input.commands) {
      if (command.type === "UPSERT_JOB") await upsertJobCommand(command, transaction);
    }

    for (const command of input.commands) {
      if(command.type!=="UPSERT_JOB"||command.lifecycleStatus!=="ACTIVE")continue;
      const kinds=command.missingSuccessfulCrawlCount===0?["CURRENT","VISIBLE"] as const:["GRACE","VISIBLE"] as const;
      for(const setKind of kinds)await transaction.lifecycleSetEvidenceMember.create({data:{
        releaseCandidateId:sourceResult.releaseCandidateId,batchId:sourceResult.batchId,sourceId:sourceResult.sourceId,
        sourceResultId:sourceResult.id,setKind,jobKey:command.dedupeKey,
        jobKeySha256:createHash("sha256").update(command.dedupeKey,"utf8").digest("hex"),
        lifecycleStatus:"ACTIVE",missingCount:command.missingSuccessfulCrawlCount
      }});
    }

    const terminal = sourceResultTerminalData(input.sourceResult);
    const updateResult = await transaction.crawlBatchSourceResult.updateMany({
      where: pendingSourceTupleWhere({
        id: sourceResult.id,
        releaseCandidateId: sourceResult.releaseCandidateId,
        batchId: sourceResult.batchId,
        sourceId: sourceResult.sourceId
      }),
      data: terminal
    });
    requireExactlyOnePendingResult(updateResult);
  });
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
}

function validateCommittedSourceResultTruthTable(result: AtomicSourceResultInput): void {
  if (result.atomicCommitState !== "COMMITTED" || result.transportState !== "SUCCEEDED" ||
      result.adapterState !== "SUCCEEDED" || result.finishedAt === null ||
      !(["VERIFIED", "INCOMPLETE", "NEEDS_MANUAL_COMPLETENESS_REVIEW"] as string[])
        .includes(result.completenessState)) {
    throw new Error("COMMITTED source result terminal state is inconsistent");
  }
  if (nonblank(result.failureCode) || nonblank(result.failureReason)) {
    throw new Error("COMMITTED source result failure code and reason must be null");
  }
  if (result.completenessState === "VERIFIED") {
    if (nonblank(result.blockerCode) || nonblank(result.blockerReason)) {
      throw new Error("VERIFIED COMMITTED source result blocker must be null");
    }
  } else if (!nonblank(result.blockerCode) || !nonblank(result.blockerReason)) {
    throw new Error("INCOMPLETE or NEEDS_MANUAL COMMITTED source result requires blocker code and reason");
  }
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

function validateAtomicSourceEvidenceCommit(input: AtomicSourceEvidenceCommit, manualPreview = false): {
  observationCommand: Extract<IngestionCommand, { type: "UPSERT_CRAWL_OBSERVATION" }>;
  artifactIdsByLogicalKey: Map<string, string>;
  officialArtifactId: string;
} {
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
  validateCommittedSourceResultTruthTable(result);
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
  if(result.completenessState!=="VERIFIED" && jobCommands.length!==0) throw new Error("Incomplete source result cannot contain lifecycle job commands");
  if(result.completenessState==="VERIFIED" && !manualPreview) {
    if(new Set(jobCommands.map(command=>command.dedupeKey)).size!==jobCommands.length) throw new Error("Lifecycle job commands must be unique");
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

  const artifactIdsByLogicalKey = new Map<string, string>();
  const paths = new Set<string>();
  const artifactByLogicalKey = new Map<string, AtomicEvidenceArtifactInput>();
  for (const artifact of input.artifacts) {
    assertTuple(artifact, tuple, "artifact");
    requireNonblank(artifact.id, "artifact id");
    requireNonblank(artifact.logicalKey, "artifact logical key");
    requireNonblank(artifact.path, "artifact path");
    requireNonblank(artifact.extractorLocator, "artifact extractorLocator");
    requireNonblank(artifact.captureToolName, "artifact captureToolName");
    requireNonblank(artifact.captureToolVersion, "artifact captureToolVersion");
    requireSha256(artifact.sha256, "artifact sha256");
    requireSha256(artifact.redactionCommitmentSha256, "artifact redaction commitment sha256");
    requireNonnegativeInteger(artifact.byteCount, "artifact byteCount");
    if (!isValidDate(artifact.capturedAt)) throw new Error("Artifact capturedAt is invalid");
    if (artifactIdsByLogicalKey.has(artifact.logicalKey)) throw new Error("Artifact logical keys must be unique");
    if (paths.has(artifact.path)) throw new Error("Artifact paths must be unique");
    if (NETWORK_ARTIFACT_KINDS.has(artifact.kind)) {
      requireNonblank(artifact.requestedUrl, "network artifact requestedUrl");
      requireNonblank(artifact.finalUrl, "network artifact finalUrl");
      requireNonblank(artifact.contentType, "network artifact contentType");
      if (!Number.isInteger(artifact.httpStatus) || artifact.httpStatus! < 100 || artifact.httpStatus! > 599) {
        throw new Error("Network artifact httpStatus is invalid");
      }
    }
    artifactIdsByLogicalKey.set(artifact.logicalKey, artifact.id);
    artifactByLogicalKey.set(artifact.logicalKey, artifact);
    paths.add(artifact.path);
  }
  requireNonblank(provenance.officialEvidenceArtifactLogicalKey, "official evidence artifact logical key");
  const officialArtifact = artifactByLogicalKey.get(provenance.officialEvidenceArtifactLogicalKey);
  if (!officialArtifact) throw new Error("Designated official evidence artifact is missing");
  if (result.expectedEvidenceKind === "OFFICIAL_TOTAL_COUNT") {
    if (result.expectedJobCount === null || !NETWORK_ARTIFACT_KINDS.has(officialArtifact.kind)) {
      throw new Error("OFFICIAL_TOTAL_COUNT requires explicit expectedJobCount and an archived network artifact");
    }
    if (result.completenessState === "VERIFIED" &&
        result.expectedJobCount !== result.dedupeOutputCount) {
      throw new Error("OFFICIAL_TOTAL_COUNT expectedJobCount must equal dedupeOutputCount");
    }
    requireNonblank(officialArtifact.extractorLocator, "OFFICIAL_TOTAL_COUNT extraction locator");
  }

  const sortedPages = [...input.pagination].sort((a, b) => a.sequence - b.sequence);
  const seenSequences = new Set<number>();
  for (let index = 0; index < sortedPages.length; index += 1) {
    const page = sortedPages[index]!;
    assertTuple(page, tuple, "pagination");
    if (!Number.isInteger(page.sequence) || page.sequence !== index || seenSequences.has(page.sequence)) {
      throw new Error("Pagination sequences must be unique and contiguous from zero");
    }
    seenSequences.add(page.sequence);
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
      ["returnedPage", page.returnedPage]] as const) {
      if (value !== undefined && value !== null) requireNonnegativeInteger(value, `pagination ${name}`);
    }
    for (const [name, value] of [["requestedPageSize", page.requestedPageSize],
      ["returnedPageSize", page.returnedPageSize]] as const) {
      if (value !== undefined && value !== null) {
        requireNonnegativeInteger(value, `pagination ${name}`);
        if (value === 0) throw new Error(`pagination ${name} must be positive when supplied`);
      }
    }
    if (result.completenessState === "VERIFIED" && page.anomalyCodes.length > 0) {
      throw new Error("VERIFIED completeness cannot contain pagination anomalies");
    }
    if (result.completenessState === "VERIFIED" && UNSAFE_VERIFIED_TERMINATIONS.has(page.termination)) {
      throw new Error("VERIFIED completeness cannot use an unsafe pagination termination");
    }
  }

  const lossCounts: Record<LossStage, number> = { PARSE: 0, VALIDATION: 0, NORMALIZATION: 0, DEDUPE: 0 };
  const collisionGroups = new Set<string>();
  for (const loss of input.lossLedger) {
    assertTuple(loss, tuple, "loss ledger");
    requireNonblank(loss.reason, "loss reason");
    requireNonblank(loss.rawLocator, "loss rawLocator");
    if (loss.recordedAt !== undefined && !isValidDate(loss.recordedAt)) throw new Error("Loss recordedAt is invalid");
    if (loss.details === undefined) throw new Error("Loss details must be supplied");
    lossCounts[loss.stage] += 1;
    if (loss.stage === "DEDUPE") {
      if (!nonblank(loss.candidateKey) || !nonblank(loss.winnerKey)) {
        throw new Error("Dedupe loss requires nonblank candidateKey and winnerKey");
      }
      collisionGroups.add(loss.winnerKey);
    }
  }
  if (lossCounts.PARSE !== result.parseDiscardCount ||
      lossCounts.VALIDATION !== result.validationDiscardCount ||
      lossCounts.NORMALIZATION !== result.normalizationDiscardCount ||
      lossCounts.DEDUPE !== result.dedupeDiscardCount || collisionGroups.size !== result.collisionCount) {
    throw new Error("Loss ledger rows do not reconcile to discard and collision counts");
  }

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
  const seenAttemptIds = new Set<string>();
  for (let index = 0; index < input.priorTransportAttempts.length; index += 1) {
    const attempt = input.priorTransportAttempts[index]!;
    assertTuple(attempt, tuple, "transport attempt");
    requireNonblank(attempt.id, "transport attempt id");
    requireNonblank(attempt.code, "transport attempt code");
    if (!TRANSPORT_ATTEMPT_CODES.has(attempt.code)) throw new Error("Transport attempt code is invalid");
    if (attempt.sequence !== index || seenAttemptIds.has(attempt.id)) {
      throw new Error("Transport-attempt sequences and IDs must be unique and contiguous");
    }
    seenAttemptIds.add(attempt.id);
    if (!isValidDate(attempt.capturedAt)) throw new Error("Transport attempt capturedAt is invalid");
    requireSha256(attempt.evidenceCommitmentSha256, "transport attempt evidence commitment");
    requireSha256(attempt.pageTraceSha256, "transport attempt page trace commitment");
    requireSha256(attempt.lossLedgerSha256, "transport attempt loss ledger commitment");
    requireSha256(attempt.paginationEvaluationSha256, "transport attempt pagination evaluation commitment");
    validateNonblankUniqueList(attempt.artifactIds, "transport attempt artifact");
    if (attempt.artifactIds.some((id) => !input.artifacts.some((artifact) => artifact.id === id))) {
      throw new Error("Transport attempt references an artifact outside the supplied tuple");
    }
    validateSafeJson(attempt.details, "transport attempt details");
  }

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
  "HCM_BROWSER_COUNT_FAILED", "HCM_BROWSER_LIST_FAILED"
]);

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
