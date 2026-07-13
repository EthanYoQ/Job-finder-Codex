import {
  buildStagedSourceCrawlPlans,
  sourcePlanConfigSha256,
  validateExecutablePlanChannelBinding
} from "../crawler/sourcePlan";
import { candidateCompanies } from "../data/companyRegistry";
import { assertExactConfirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";
import { derivePhase1Scope } from "../data/phase1ScopePolicy";
import {
  buildCompanyPublicationSnapshot,
  type CompanyPublicationSnapshot,
  type CurrentStagedPublicationSource,
  type PublicationAttempt,
  type PublicationAttemptObservation,
  type PublicationStableRequiredField
} from "../domain/publicationEligibility";

type PublicationBatchKind = "FULL_RELEASE" | "SCHEDULED" | "BASELINE";
type PersistedPublicationBatchKind = PublicationBatchKind | "MANUAL_SOURCE" | null;
type PublicationBatchStatus = "RUNNING" | "INCOMPLETE" | "ABORTED" | "SUCCESS" | "FAILED";
type PublicationTransportState = "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "SKIPPED";
type PublicationCompletenessStatus =
  | "PENDING"
  | "VERIFIED"
  | "NEEDS_MANUAL_COMPLETENESS_REVIEW"
  | "INCOMPLETE"
  | "FAILED";
type PublicationAtomicCommitState = "PENDING" | "COMMITTED" | "ROLLED_BACK" | "NOT_ATTEMPTED" | "FAILED";

export interface PublicationEligibilityObservationRow {
  id: string;
  sourceResultId: string | null;
  sourceId: string;
  sourceConfigSha256: string | null;
  crawledAt: Date;
  successful: boolean;
  transportSucceeded: boolean | null;
  adapterSucceeded: boolean | null;
  completenessVerified: boolean | null;
  atomicCommitSucceeded: boolean | null;
  structuredJobCount: number;
  expectedJobCount: number | null;
  completenessStatus: PublicationCompletenessStatus | null;
  stableRequiredFields: PublicationStableRequiredField[];
}

export interface PublicationEligibilitySourceResultRow {
  id: string;
  batchId: string;
  sourceId: string;
  sourceConfigHash: string;
  transportState: PublicationTransportState;
  adapterState: PublicationTransportState;
  completenessState: PublicationCompletenessStatus;
  atomicCommitState: PublicationAtomicCommitState;
  startedAt: Date;
  finishedAt: Date | null;
  dedupeOutputCount: number;
  expectedJobCount: number | null;
  officialEntryId: string | null;
  officialSurfaceIds: string[];
  officialChannelIds: string[];
  batch: {
    id: string;
    kind: PersistedPublicationBatchKind;
    status: PublicationBatchStatus;
    startedAt: Date;
    finishedAt: Date | null;
  };
  observations: PublicationEligibilityObservationRow[];
}

export interface PublicationEligibilityDb {
  crawlBatchSourceResult: {
    findMany(args: PublicationEligibilityQuery): PromiseLike<unknown>;
  };
}

export interface PublicationEligibilityQuery {
  where: {
    sourceId: { in: string[] };
    batch: { is: { kind: { in: PublicationBatchKind[] } } };
  };
  select: {
    id: true;
    batchId: true;
    sourceId: true;
    sourceConfigHash: true;
    transportState: true;
    adapterState: true;
    completenessState: true;
    atomicCommitState: true;
    startedAt: true;
    finishedAt: true;
    dedupeOutputCount: true;
    expectedJobCount: true;
    officialEntryId: true;
    officialSurfaceIds: true;
    officialChannelIds: true;
    batch: {
      select: { id: true; kind: true; status: true; startedAt: true; finishedAt: true };
    };
    observations: {
      select: {
        id: true;
        sourceResultId: true;
        sourceId: true;
        sourceConfigSha256: true;
        crawledAt: true;
        successful: true;
        transportSucceeded: true;
        adapterSucceeded: true;
        completenessVerified: true;
        atomicCommitSucceeded: true;
        structuredJobCount: true;
        expectedJobCount: true;
        completenessStatus: true;
        stableRequiredFields: true;
      };
      orderBy: [{ crawledAt: "asc" }, { id: "asc" }];
      take: 2;
    };
  };
  orderBy: [
    { batch: { startedAt: "asc" } },
    { batchId: "asc" },
    { startedAt: "asc" },
    { id: "asc" }
  ];
}

const PARTICIPATING_BATCH_KINDS: PublicationBatchKind[] = ["FULL_RELEASE", "SCHEDULED", "BASELINE"];
const participatingBatchKindSet: ReadonlySet<string> = new Set(PARTICIPATING_BATCH_KINDS);

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function deriveCurrentStagedSources(): CurrentStagedPublicationSource[] {
  assertExactConfirmedCompanyRosterV3(candidateCompanies.map(({ id, category }) => ({ id, category })));
  const scope = derivePhase1Scope(candidateCompanies);
  const inScopeCompanyIds = new Set(scope.inScopeCompanies.map(({ id }) => id));
  const canonicalCompanyById = new Map(candidateCompanies.map((company) => [company.id, company]));
  const plans = buildStagedSourceCrawlPlans(candidateCompanies);
  const sourceIds = new Set<string>();

  return plans.map((plan): CurrentStagedPublicationSource => {
    if (plan.executionAuthority !== "STAGED") {
      throw new Error(`PUBLICATION_PLAN_NOT_STAGED:${plan.source.id}`);
    }
    validateExecutablePlanChannelBinding(plan);
    const canonicalCompany = canonicalCompanyById.get(plan.company.id);
    const canonicalSource = canonicalCompany?.sources.find(({ id }) => id === plan.source.id);
    if (
      !canonicalCompany ||
      !canonicalSource ||
      !inScopeCompanyIds.has(plan.company.id) ||
      plan.source.companyId !== plan.company.id ||
      canonicalSource.companyId !== plan.company.id
    ) {
      throw new Error(`PUBLICATION_PLAN_COMPANY_OWNERSHIP_MISMATCH:${plan.source.id}`);
    }
    if (sourceIds.has(plan.source.id)) {
      throw new Error(`DUPLICATE_CURRENT_PUBLICATION_SOURCE:${plan.source.id}`);
    }
    sourceIds.add(plan.source.id);
    return {
      companyId: plan.company.id,
      sourceId: plan.source.id,
      currentConfigSha256: sourcePlanConfigSha256(plan)
    };
  }).sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
}

function publicationEligibilityQuery(stagedSourceIds: string[]): PublicationEligibilityQuery {
  return {
    where: {
      sourceId: { in: stagedSourceIds },
      batch: { is: { kind: { in: [...PARTICIPATING_BATCH_KINDS] } } }
    },
    select: {
      id: true,
      batchId: true,
      sourceId: true,
      sourceConfigHash: true,
      transportState: true,
      adapterState: true,
      completenessState: true,
      atomicCommitState: true,
      startedAt: true,
      finishedAt: true,
      dedupeOutputCount: true,
      expectedJobCount: true,
      officialEntryId: true,
      officialSurfaceIds: true,
      officialChannelIds: true,
      batch: {
        select: { id: true, kind: true, status: true, startedAt: true, finishedAt: true }
      },
      observations: {
        select: {
          id: true,
          sourceResultId: true,
          sourceId: true,
          sourceConfigSha256: true,
          crawledAt: true,
          successful: true,
          transportSucceeded: true,
          adapterSucceeded: true,
          completenessVerified: true,
          atomicCommitSucceeded: true,
          structuredJobCount: true,
          expectedJobCount: true,
          completenessStatus: true,
          stableRequiredFields: true
        },
        orderBy: [{ crawledAt: "asc" }, { id: "asc" }],
        take: 2
      }
    },
    orderBy: [
      { batch: { startedAt: "asc" } },
      { batchId: "asc" },
      { startedAt: "asc" },
      { id: "asc" }
    ]
  };
}

function mapObservation(row: PublicationEligibilityObservationRow): PublicationAttemptObservation {
  return {
    id: row.id,
    sourceResultId: row.sourceResultId,
    sourceId: row.sourceId,
    sourceConfigSha256: row.sourceConfigSha256,
    crawledAt: row.crawledAt,
    successful: row.successful,
    transportSucceeded: row.transportSucceeded,
    adapterSucceeded: row.adapterSucceeded,
    completenessVerified: row.completenessVerified,
    atomicCommitSucceeded: row.atomicCommitSucceeded,
    structuredJobCount: row.structuredJobCount,
    expectedJobCount: row.expectedJobCount,
    completenessStatus: row.completenessStatus,
    stableRequiredFields: [...row.stableRequiredFields].sort(compareUtf8)
  };
}

function mapAttempt(row: PublicationEligibilitySourceResultRow): PublicationAttempt {
  if (row.batch.id !== row.batchId) {
    throw new Error(`PUBLICATION_BATCH_RELATION_TUPLE_DRIFT:${row.id}`);
  }
  if (!participatingBatchKindSet.has(String(row.batch.kind))) {
    throw new Error(`UNSUPPORTED_PUBLICATION_BATCH_KIND:${String(row.batch.kind)}`);
  }
  return {
    id: row.id,
    batchId: row.batchId,
    batchKind: row.batch.kind as PublicationBatchKind,
    batchStatus: row.batch.status,
    batchStartedAt: row.batch.startedAt,
    batchFinishedAt: row.batch.finishedAt,
    sourceId: row.sourceId,
    sourceStartedAt: row.startedAt,
    finishedAt: row.finishedAt,
    sourceConfigHash: row.sourceConfigHash,
    transportState: row.transportState,
    adapterState: row.adapterState,
    completenessState: row.completenessState,
    atomicCommitState: row.atomicCommitState,
    dedupeOutputCount: row.dedupeOutputCount,
    expectedJobCount: row.expectedJobCount,
    officialEntryId: row.officialEntryId,
    officialSurfaceIds: [...row.officialSurfaceIds].sort(compareUtf8),
    officialChannelIds: [...row.officialChannelIds].sort(compareUtf8),
    observations: row.observations.map(mapObservation)
  };
}

export async function getCompanyPublicationSnapshotFromDb(
  db: PublicationEligibilityDb
): Promise<CompanyPublicationSnapshot> {
  const currentSources = deriveCurrentStagedSources();
  const stagedSourceIds = currentSources.map(({ sourceId }) => sourceId);
  const stagedSourceIdSet = new Set(stagedSourceIds);
  const result = await db.crawlBatchSourceResult.findMany(publicationEligibilityQuery(stagedSourceIds));
  if (!Array.isArray(result)) throw new Error("INVALID_PUBLICATION_SOURCE_RESULT_ROWS");
  const rows = result as PublicationEligibilitySourceResultRow[];
  const attempts = rows
    .filter((row) => stagedSourceIdSet.has(row.sourceId))
    .filter((row) => participatingBatchKindSet.has(String(row.batch.kind)))
    .map(mapAttempt);
  return buildCompanyPublicationSnapshot(candidateCompanies, currentSources, attempts);
}
