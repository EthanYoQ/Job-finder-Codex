import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../src/crawler/sourcePlan";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import type { RuntimeBatchIdentity } from "../src/crawler/runtimeBatchIdentity";
import { getCompanyPublicationSnapshotFromDb } from "../src/db/publicationEligibilityRepository";
import {
  evaluateStagedDataQuality,
  type StagedDataQualityReport,
  type StagedDataQualitySourceResult,
  type StagedEligibleSource,
  type StagedPublicVisibleJob
} from "../src/readiness/stagedDataQuality";
import {
  evaluateStagedReleaseReadiness,
  type StagedReleaseReadinessReport
} from "../src/readiness/stagedReleaseReadiness";
import { isNeutralScheduledSourceNotDueResult } from "../src/domain/publicationEligibility";

export interface StagedDataQualityGateReport {
  canRelease: boolean;
  readiness: StagedReleaseReadinessReport;
  dataQuality: StagedDataQualityReport;
}

export interface StagedDataQualityCommandDeps {
  loadReport(): Promise<StagedDataQualityGateReport>;
  writeLine(line: string): void;
}

export interface StagedDataQualityCommandResult {
  exitCode: number;
}

interface SourceResultRow {
  id: string;
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  sourceConfigHash: string;
  transportState: string;
  adapterState: string;
  completenessState: string;
  atomicCommitState: string;
  failureCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  dedupeOutputCount: number;
  expectedJobCount: number | null;
  canonicalOutputSetSha256: string | null;
  canonicalCurrentJobSetSha256: string | null;
  canonicalGraceJobSetSha256: string | null;
  canonicalVisibleJobSetSha256: string | null;
  batch: {
    id: string;
    releaseCandidateId: string | null;
    kind: string | null;
    status: string;
    startedAt: Date;
    commitSha: string | null;
    rosterSha256: string | null;
    sourcePlanSha256: string | null;
    sourceConfigSha256: string | null;
    adapterBundleSha256: string | null;
    plannedSourceIds: unknown;
    plannedSourceSetSha256: string | null;
    plannedSourceCount: number | null;
    ownerId: string | null;
  };
  observations: Array<{
    releaseCandidateId: string | null;
    batchId: string | null;
    sourceResultId: string | null;
    sourceId: string;
    sourceConfigSha256: string | null;
    successful: boolean;
    transportSucceeded: boolean | null;
    adapterSucceeded: boolean | null;
    completenessVerified: boolean | null;
    atomicCommitSucceeded: boolean | null;
    structuredJobCount: number;
    expectedJobCount: number | null;
    completenessStatus: string | null;
    canonicalOutputSha256: string | null;
    canonicalGraceSha256: string | null;
    canonicalVisibleSha256: string | null;
  }>;
  lifecycleSetMembers: Array<{
    releaseCandidateId: string;
    batchId: string;
    sourceId: string;
    sourceResultId: string;
    setKind: "CURRENT" | "GRACE" | "VISIBLE";
    jobKey: string;
    jobKeySha256: string;
    lifecycleStatus: "ACTIVE" | "SUSPECTED_OFFLINE" | "OFFLINE";
    missingCount: number;
  }>;
}

interface PublicJobRow extends StagedPublicVisibleJob {
  source: { companyId: string };
}

export async function runStagedDataQualityCommand(
  args: readonly string[],
  deps: StagedDataQualityCommandDeps
): Promise<StagedDataQualityCommandResult> {
  if (args.length !== 0) {
    deps.writeLine("Usage: npm run p0:staged-data-quality");
    return { exitCode: 2 };
  }

  const report = await deps.loadReport();
  deps.writeLine(`Stable companies: ${report.readiness.stableCompanyCount} / ${report.readiness.minimumStableCompanyCount}`);
  deps.writeLine(`Eligible sources: ${report.dataQuality.eligibleSourceCount}`);
  deps.writeLine(`Public visible jobs: ${report.dataQuality.publicVisibleJobCount}`);
  for (const issue of report.readiness.issues) {
    deps.writeLine(`[FAIL] ${issue.code}${issue.companyId ? ` (${issue.companyId})` : ""}: ${issue.message}`);
  }
  for (const issue of report.dataQuality.issues) {
    deps.writeLine(`[FAIL] ${issue.code}${issue.sourceId ? ` (${issue.sourceId})` : ""}: ${issue.message}`);
  }
  deps.writeLine(`Staged data quality: ${report.canRelease ? "PASS" : "FAIL"}`);
  return { exitCode: report.canRelease ? 0 : 1 };
}

export async function loadStagedDataQualityGateFromDatabase(
  prisma: PrismaClient,
  currentTime = new Date()
): Promise<StagedDataQualityGateReport> {
  return prisma.$transaction(async (transaction) => {
    const authority = await resolveCurrentStagedScheduleAuthority(transaction as never);
    const releaseCandidateId = authority.identity.releaseCandidateId;
    const releaseCandidate = await transaction.releaseCandidate.findUnique({
      where: { id: releaseCandidateId },
      select: { status: true, minimumStableCompanyCount: true }
    });
    const snapshot = await getCompanyPublicationSnapshotFromDb(
      transaction as never,
      async () => authority,
      { currentTime }
    );
    const readiness = evaluateStagedReleaseReadiness({
      snapshot,
      mode: "PHASE1",
      currentTime,
      releaseCandidateStatus: releaseCandidate?.status ?? "MISSING",
      minimumStableCompanyCount: releaseCandidate?.minimumStableCompanyCount ?? 0
    });
    const eligibleSources = deriveEligibleSources(authority.plans, snapshot.eligibleSourceIds);
    const sourceRows = await transaction.crawlBatchSourceResult.findMany({
      where: {
        releaseCandidateId,
        sourceId: { in: snapshot.eligibleSourceIds },
        batch: { is: { releaseCandidateId, kind: "SCHEDULED" } }
      },
      select: {
        id: true,
        releaseCandidateId: true,
        batchId: true,
        sourceId: true,
        sourceConfigHash: true,
        transportState: true,
        adapterState: true,
        completenessState: true,
        atomicCommitState: true,
        failureCode: true,
        startedAt: true,
        finishedAt: true,
        dedupeOutputCount: true,
        expectedJobCount: true,
        canonicalOutputSetSha256: true,
        canonicalCurrentJobSetSha256: true,
        canonicalGraceJobSetSha256: true,
        canonicalVisibleJobSetSha256: true,
        batch: {
          select: {
            id: true,
            releaseCandidateId: true,
            kind: true,
            status: true,
            startedAt: true,
            commitSha: true,
            rosterSha256: true,
            sourcePlanSha256: true,
            sourceConfigSha256: true,
            adapterBundleSha256: true,
            plannedSourceIds: true,
            plannedSourceSetSha256: true,
            plannedSourceCount: true,
            ownerId: true
          }
        },
        observations: {
          where: { releaseCandidateId },
          select: {
            releaseCandidateId: true,
            batchId: true,
            sourceResultId: true,
            sourceId: true,
            sourceConfigSha256: true,
            successful: true,
            transportSucceeded: true,
            adapterSucceeded: true,
            completenessVerified: true,
            atomicCommitSucceeded: true,
            structuredJobCount: true,
            expectedJobCount: true,
            completenessStatus: true,
            canonicalOutputSha256: true,
            canonicalGraceSha256: true,
            canonicalVisibleSha256: true
          },
          orderBy: [{ crawledAt: "asc" }, { id: "asc" }],
          take: 2
        },
        lifecycleSetMembers: {
          select: {
            releaseCandidateId: true,
            batchId: true,
            sourceId: true,
            sourceResultId: true,
            setKind: true,
            jobKey: true,
            jobKeySha256: true,
            lifecycleStatus: true,
            missingCount: true
          }
        }
      },
      orderBy: [
        { batch: { startedAt: "asc" } },
        { batchId: "asc" },
        { startedAt: "asc" },
        { id: "asc" }
      ]
    });
    const publicJobRows = await transaction.job.findMany({
      where: {
        sourceId: { in: snapshot.eligibleSourceIds },
        visibleInFrontend: true,
        lifecycleStatus: "ACTIVE"
      },
      select: {
        sourceId: true,
        dedupeKey: true,
        companyId: true,
        officialTitle: true,
        officialUrl: true,
        locationRaw: true,
        source: { select: { companyId: true } }
      },
      orderBy: [{ sourceId: "asc" }, { dedupeKey: "asc" }, { id: "asc" }]
    });

    const latestSourceResults = selectAndMapLatestSourceResults(
      sourceRows as unknown as SourceResultRow[],
      authority.identity,
      new Set(snapshot.eligibleSourceIds)
    );
    const publicVisibleJobs = mapPublicJobs(
      publicJobRows as unknown as PublicJobRow[],
      new Map(eligibleSources.map((source) => [source.sourceId, source.companyId]))
    );
    const dataQuality = evaluateStagedDataQuality({
      releaseCandidateId,
      eligibleSources,
      latestSourceResults,
      publicVisibleJobs
    });
    return {
      canRelease: readiness.canRelease && dataQuality.canRelease,
      readiness,
      dataQuality
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 60_000
  });
}

function deriveEligibleSources(
  plans: readonly SourceCrawlPlan[],
  eligibleSourceIds: readonly string[]
): StagedEligibleSource[] {
  const planBySource = new Map(plans.map((plan) => [plan.source.id, plan]));
  if (planBySource.size !== plans.length || new Set(eligibleSourceIds).size !== eligibleSourceIds.length) {
    throw new Error("STAGED_DATA_QUALITY_ELIGIBLE_SOURCE_SET_DRIFT");
  }
  return [...eligibleSourceIds].sort(compareUtf8).map((sourceId) => {
    const plan = planBySource.get(sourceId);
    if (!plan) throw new Error(`STAGED_DATA_QUALITY_SOURCE_PLAN_MISSING:${sourceId}`);
    return {
      sourceId,
      companyId: plan.company.id,
      currentConfigSha256: sourcePlanConfigSha256(plan)
    };
  });
}

export function selectAndMapLatestSourceResults(
  rows: readonly SourceResultRow[],
  identity: RuntimeBatchIdentity,
  eligibleSourceIds: ReadonlySet<string>
): StagedDataQualitySourceResult[] {
  const latestBySource = new Map<string, SourceResultRow>();
  for (const row of [...rows].sort(compareSourceResultRows)) {
    if (row.releaseCandidateId !== identity.releaseCandidateId ||
        row.batch.releaseCandidateId !== identity.releaseCandidateId ||
        row.batch.id !== row.batchId || !eligibleSourceIds.has(row.sourceId)) {
      throw new Error(`STAGED_DATA_QUALITY_SOURCE_RESULT_TUPLE_DRIFT:${row.id}`);
    }
    assertCurrentBatchIdentity(row, identity);
    if (isNeutralSourceNotDueRow(row)) continue;
    if (row.batch.status === "RUNNING" && isSuccessfulOrPendingRunningSource(row)) continue;
    latestBySource.set(row.sourceId, row);
  }
  return [...latestBySource.values()].sort((left, right) => compareUtf8(left.sourceId, right.sourceId))
    .map((row) => mapSourceResult(row));
}

function isNeutralSourceNotDueRow(row: SourceResultRow): boolean {
  return isNeutralScheduledSourceNotDueResult({ ...row, batchKind: row.batch.kind }) &&
    row.lifecycleSetMembers.length === 0 &&
    row.canonicalOutputSetSha256 === null &&
    row.canonicalCurrentJobSetSha256 === null &&
    row.canonicalGraceJobSetSha256 === null &&
    row.canonicalVisibleJobSetSha256 === null;
}

function assertCurrentBatchIdentity(row: SourceResultRow, identity: RuntimeBatchIdentity): void {
  const plannedSourceIds = Array.isArray(row.batch.plannedSourceIds) &&
    row.batch.plannedSourceIds.every((value): value is string => typeof value === "string")
    ? row.batch.plannedSourceIds
    : null;
  if (
    row.batch.kind !== identity.batchKind ||
    row.batch.commitSha !== identity.commitSha ||
    row.batch.rosterSha256 !== identity.rosterSha256 ||
    row.batch.sourcePlanSha256 !== identity.sourcePlanSha256 ||
    row.batch.sourceConfigSha256 !== identity.sourceConfigSha256 ||
    row.batch.adapterBundleSha256 !== identity.adapterBundleSha256 ||
    row.batch.ownerId !== identity.ownerId ||
    row.batch.plannedSourceSetSha256 !== identity.expectedPlannedSourceSetSha256 ||
    row.batch.plannedSourceCount !== identity.expectedPlannedSourceCount ||
    plannedSourceIds === null ||
    JSON.stringify(plannedSourceIds) !== JSON.stringify(identity.expectedPlannedSourceIds)
  ) {
    throw new Error(`STAGED_DATA_QUALITY_BATCH_IDENTITY_DRIFT:${row.id}`);
  }
}

function isSuccessfulOrPendingRunningSource(row: SourceResultRow): boolean {
  if (row.finishedAt === null) return true;
  return row.transportState === "SUCCEEDED" &&
    row.adapterState === "SUCCEEDED" &&
    row.completenessState === "VERIFIED" &&
    row.atomicCommitState === "COMMITTED";
}

function mapSourceResult(row: SourceResultRow): StagedDataQualitySourceResult {
  if (row.observations.length !== 1) {
    throw new Error(`STAGED_DATA_QUALITY_OBSERVATION_COUNT:${row.id}:${row.observations.length}`);
  }
  const observation = row.observations[0]!;
  const tuple = {
    releaseCandidateId: row.releaseCandidateId,
    batchId: row.batchId,
    sourceResultId: row.id,
    sourceId: row.sourceId
  };
  if (observation.releaseCandidateId !== tuple.releaseCandidateId || observation.batchId !== tuple.batchId ||
      observation.sourceResultId !== tuple.sourceResultId || observation.sourceId !== tuple.sourceId) {
    throw new Error(`STAGED_DATA_QUALITY_OBSERVATION_TUPLE_DRIFT:${row.id}`);
  }

  const lifecycle = new Map<string, { status: "ACTIVE" | "SUSPECTED_OFFLINE" | "OFFLINE"; missingCount: number }>();
  for (const member of row.lifecycleSetMembers) {
    if (member.releaseCandidateId !== tuple.releaseCandidateId || member.batchId !== tuple.batchId ||
        member.sourceResultId !== tuple.sourceResultId || member.sourceId !== tuple.sourceId ||
        member.jobKeySha256 !== sha256(member.jobKey)) {
      throw new Error(`STAGED_DATA_QUALITY_LIFECYCLE_TUPLE_DRIFT:${row.id}`);
    }
    const prior = lifecycle.get(member.jobKey);
    if (prior && (prior.status !== member.lifecycleStatus || prior.missingCount !== member.missingCount)) {
      throw new Error(`STAGED_DATA_QUALITY_LIFECYCLE_PROJECTION_DRIFT:${row.id}`);
    }
    lifecycle.set(member.jobKey, { status: member.lifecycleStatus, missingCount: member.missingCount });
  }
  const members = (kind: SourceResultRow["lifecycleSetMembers"][number]["setKind"]) =>
    row.lifecycleSetMembers.filter(({ setKind }) => setKind === kind);

  return {
    ...tuple,
    sourceConfigHash: row.sourceConfigHash,
    batchKind: row.batch.kind ?? "MISSING",
    transportState: row.transportState,
    adapterState: row.adapterState,
    completenessState: row.completenessState,
    atomicCommitState: row.atomicCommitState,
    dedupeOutputCount: row.dedupeOutputCount,
    expectedJobCount: row.expectedJobCount,
    canonicalOutputSetSha256: row.canonicalOutputSetSha256,
    canonicalCurrentJobSetSha256: row.canonicalCurrentJobSetSha256,
    canonicalGraceJobSetSha256: row.canonicalGraceJobSetSha256,
    canonicalVisibleJobSetSha256: row.canonicalVisibleJobSetSha256,
    observation: {
      ...tuple,
      sourceConfigSha256: observation.sourceConfigSha256,
      successful: observation.successful,
      transportSucceeded: observation.transportSucceeded,
      adapterSucceeded: observation.adapterSucceeded,
      completenessVerified: observation.completenessVerified,
      atomicCommitSucceeded: observation.atomicCommitSucceeded,
      structuredJobCount: observation.structuredJobCount,
      expectedJobCount: observation.expectedJobCount,
      completenessStatus: observation.completenessStatus,
      canonicalOutputSha256: observation.canonicalOutputSha256,
      canonicalGraceSha256: observation.canonicalGraceSha256,
      canonicalVisibleSha256: observation.canonicalVisibleSha256
    },
    lifecycleSetEvidence: {
      ...tuple,
      currentKeys: members("CURRENT").map(({ jobKey }) => jobKey),
      currentSha256: requireHash(row.canonicalCurrentJobSetSha256, "current", row.id),
      graceEntries: members("GRACE").map((member) => ({
        ...tuple,
        key: member.jobKey,
        status: member.lifecycleStatus,
        missingSuccessfulCrawlCount: member.missingCount
      })),
      graceSha256: requireHash(row.canonicalGraceJobSetSha256, "grace", row.id),
      visibleKeys: members("VISIBLE").map(({ jobKey }) => jobKey),
      visibleSha256: requireHash(row.canonicalVisibleJobSetSha256, "visible", row.id),
      lifecycleEntries: [...lifecycle].map(([key, value]) => ({
        ...tuple,
        key,
        status: value.status,
        missingSuccessfulCrawlCount: value.missingCount
      }))
    }
  };
}

function mapPublicJobs(
  rows: readonly PublicJobRow[],
  expectedCompanyBySource: ReadonlyMap<string, string>
): StagedPublicVisibleJob[] {
  return rows.map((row) => {
    const expectedCompanyId = expectedCompanyBySource.get(row.sourceId);
    if (!expectedCompanyId || row.source.companyId !== expectedCompanyId) {
      throw new Error(`STAGED_DATA_QUALITY_JOB_SOURCE_OWNERSHIP_DRIFT:${row.sourceId}:${row.dedupeKey}`);
    }
    return {
      sourceId: row.sourceId,
      dedupeKey: row.dedupeKey,
      companyId: row.companyId,
      officialTitle: row.officialTitle,
      officialUrl: row.officialUrl,
      locationRaw: row.locationRaw
    };
  });
}

function compareSourceResultRows(left: SourceResultRow, right: SourceResultRow): number {
  return left.batch.startedAt.getTime() - right.batch.startedAt.getTime() ||
    compareUtf8(left.batchId, right.batchId) ||
    left.startedAt.getTime() - right.startedAt.getTime() ||
    compareUtf8(left.id, right.id);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireHash(value: string | null, label: string, sourceResultId: string): string {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`STAGED_DATA_QUALITY_${label.toUpperCase()}_HASH_MISSING:${sourceResultId}`);
  }
  return value;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await runStagedDataQualityCommand(process.argv.slice(2), {
      loadReport: () => loadStagedDataQualityGateFromDatabase(prisma),
      writeLine: console.log
    });
    process.exitCode = result.exitCode;
  } catch {
    console.error("Staged data quality: ERROR");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
