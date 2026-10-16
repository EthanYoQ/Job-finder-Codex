import { readPortableScheduleObservations, type PortableScheduleResultReader } from "./portableScheduleObservations";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../crawler/sourcePlan";
import { SOURCE_QUALITY_POLICY_ID, SOURCE_QUALITY_RECEIPT_SCHEMA, verifySourceQualityReceipt, type SourceQualityReceipt } from "../crawler/sourceQualityAdmission";
import type { SourceQualityPublicationInput } from "../crawler/sourceQualityPublication";
import { toJobSnapshots, type PersistedCrawlObservationRow, type PersistedJobRow } from "./crawlStateRepository";
import {
  assertTrustedBaselineTransition,
  assertTrustedCompletenessBaseline,
  type PersistedTrustedCompletenessBaseline,
} from "../crawler/completenessAnomalyPolicy";

interface PersistedTrustedBaselineRow {
  releaseCandidateId?: string;
  batchId?: string;
  adapterVersion?: string;
  id: string;
  sourceId: string;
  sourceConfigHash: string;
  dedupeOutputCount: number;
  completenessCertificate: unknown;
  completenessCertificateSha256: string | null;
  finishedAt: Date | null;
  baselinePreviousSourceResultId: string | null;
  baselinePreviousJobCount: number | null;
  baselineChangeReason: string | null;
}

export interface PrismaCrawlRuntimeDb {
  job: {
    findMany(args: {
      where: { sourceId: string };
      include: {
        source: {
          select: {
            atsKind: true;
            kind: true;
            status: true;
            officialEntryUrl: true;
            officialChainEvidenceUrl: true;
          };
        };
        company: {
          select: {
            officialChineseName: true;
          };
        };
      };
      orderBy: { lastSeenAt: "desc" };
    }): Promise<PersistedJobRow[]>;
  };
  crawlObservation: {
    findMany(args: {
      where: { sourceId: string; batch: { is: { kind: { not: "MANUAL_SOURCE" } } } };
      select: { crawledAt: true; successful: true };
      orderBy: { crawledAt: "desc" };
      take: 10;
    }): Promise<PersistedCrawlObservationRow[]>;
    findFirst?(args: {
      where: { sourceId: string; successful: true;
        batch: { is: { kind: { not: "MANUAL_SOURCE" } } } };
      select: { id: true };
      orderBy: { crawledAt: "asc" };
    }): Promise<{ id: string } | null>;
  };
  crawlBatchSourceResult?: {
    findMany?: PortableScheduleResultReader["findMany"];
    findFirst(args: {
      where: {
        sourceId: string;
        completenessState: "VERIFIED";
        atomicCommitState: "COMMITTED";
        completenessCertificateSha256: { not: null };
        sourceConfigHash?: string;
        completenessCertificate?: { path: string[]; equals: string };
        batch: { is: { kind: { not: "MANUAL_SOURCE" } } };
      };
      select: {
        releaseCandidateId?: true;
        batchId?: true;
        adapterVersion?: true;
        id: true;
        sourceId: true;
        sourceConfigHash: true;
        dedupeOutputCount: true;
        completenessCertificate: true;
        completenessCertificateSha256: true;
        finishedAt: true;
        baselinePreviousSourceResultId: true;
        baselinePreviousJobCount: true;
        baselineChangeReason: true;
      };
      orderBy: { finishedAt: "desc" | "asc" };
    }): Promise<PersistedTrustedBaselineRow | null>;
  };
}

export function createPrismaCrawlRuntimeDeps(db: PrismaCrawlRuntimeDb, options: {portablePlans?:readonly SourceCrawlPlan[];now?:()=>Date} = {}) {
  const portablePlans=options.portablePlans===undefined?undefined:new Map(structuredClone([...options.portablePlans]).map(plan=>[plan.source.id,plan]));
  return {
    async getPreviousJobs(sourceId: string) {
      const rows = await db.job.findMany({
        where: { sourceId },
        include: {
          source: {
            select: {
              atsKind: true,
              kind: true,
              status: true,
              officialEntryUrl: true,
              officialChainEvidenceUrl: true
            }
          },
          company: {
            select: {
              officialChineseName: true
            }
          }
        },
        orderBy: { lastSeenAt: "desc" }
      });

      return toJobSnapshots(rows);
    },
    async getRecentObservations(sourceId: string) {
      if(portablePlans){
        const plan=portablePlans.get(sourceId),reader=db.crawlBatchSourceResult;
        if(!plan||!reader?.findMany)throw Error("PORTABLE_SCHEDULE_CURRENT_POLICY_READER_REQUIRED");
        return readPortableScheduleObservations({findMany:args=>reader.findMany!(args)},plan,(options.now??(()=>new Date()))());
      }
      return db.crawlObservation.findMany({
        where: { sourceId, batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
        select: { crawledAt: true, successful: true },
        orderBy: { crawledAt: "desc" },
        take: 10
      });
    },
    async getTrustedCompletenessBaseline(sourceId: string) {
      const plan = portablePlans?.get(sourceId);
      if (portablePlans && !plan) throw new Error("PORTABLE_BASELINE_CURRENT_PLAN_REQUIRED");
      const currentConfig = plan ? sourcePlanConfigSha256(plan) : undefined;
      // Obsolete receipts remain historical evidence, but must not be validated
      // against today's registry before the current configuration is selected.
      const row = await findTrustedCompletenessBaselineRow(db, sourceId, currentConfig);
      if (row && currentConfig && (row.sourceId !== sourceId || row.sourceConfigHash !== currentConfig ||
          (row.completenessCertificate as {schemaVersion?:unknown}|null)?.schemaVersion !== SOURCE_QUALITY_RECEIPT_SCHEMA)) {
        throw new Error("PORTABLE_BASELINE_QUERY_BINDING_INVALID");
      }
      return row === null ? null : toTrustedCompletenessBaseline(row);
    },
    async getFirstAcceptedCurrentPolicyReceipt(sourceId: string, sourceConfigSha256: string): Promise<SourceQualityPublicationInput["firstAcceptedCurrentPolicyReceipt"]> {
      if (!db.crawlBatchSourceResult) throw new Error("Portable receipt repository is unavailable");
      const row = await db.crawlBatchSourceResult.findFirst({
        where: { sourceId, sourceConfigHash: sourceConfigSha256, completenessState: "VERIFIED", atomicCommitState: "COMMITTED",
          completenessCertificateSha256: { not: null }, completenessCertificate: { path: ["schemaVersion"], equals: SOURCE_QUALITY_RECEIPT_SCHEMA },
          batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
        select: { id: true, sourceId: true, sourceConfigHash: true, releaseCandidateId: true, batchId: true, adapterVersion: true,
          dedupeOutputCount: true, completenessCertificate: true, completenessCertificateSha256: true, finishedAt: true,
          baselinePreviousSourceResultId: true, baselinePreviousJobCount: true, baselineChangeReason: true },
        orderBy: { finishedAt: "asc" }
      });
      if (!row) return null;
      if (row.sourceId !== sourceId || row.sourceConfigHash !== sourceConfigSha256) throw new Error("Portable receipt lookup returned a different source/configuration");
      const verified = portableReceiptFromRow(row);
      return { receipt: verified.receipt, receiptSha256: row.completenessCertificateSha256!, expectedBinding: verified.expectedBinding };
    },
    async isBaselineCompleted(sourceId: string) {
      if (!db.crawlObservation.findFirst) return false;
      return (await db.crawlObservation.findFirst({
        where: { sourceId, successful: true,
          batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
        select: { id: true },
        orderBy: { crawledAt: "asc" }
      })) !== null;
    }
  };
}

function findTrustedCompletenessBaselineRow(
  db: PrismaCrawlRuntimeDb,
  sourceId: string,
  currentPortableConfig?: string
): Promise<PersistedTrustedBaselineRow | null> {
  if (!db.crawlBatchSourceResult) return Promise.resolve(null);
  return db.crawlBatchSourceResult.findFirst({
    where: {
      sourceId,
      ...(currentPortableConfig ? { sourceConfigHash: currentPortableConfig,
        completenessCertificate: {path:["schemaVersion"],equals:SOURCE_QUALITY_RECEIPT_SCHEMA} } : {}),
      completenessState: "VERIFIED",
      atomicCommitState: "COMMITTED",
      completenessCertificateSha256: { not: null },
      batch: { is: { kind: { not: "MANUAL_SOURCE" } } }
    },
    select: {
      releaseCandidateId: true, batchId: true, adapterVersion: true,
      id: true,
      sourceId: true,
      sourceConfigHash: true,
      dedupeOutputCount: true,
      completenessCertificate: true,
      completenessCertificateSha256: true,
      finishedAt: true,
      baselinePreviousSourceResultId: true,
      baselinePreviousJobCount: true,
      baselineChangeReason: true
    },
    orderBy: { finishedAt: "desc" }
  });
}

function toTrustedCompletenessBaseline(
  row: PersistedTrustedBaselineRow
): PersistedTrustedCompletenessBaseline {
  if (!row.finishedAt || !row.completenessCertificateSha256 ||
      typeof row.completenessCertificate !== "object" || row.completenessCertificate === null) {
    throw new Error("Persisted trusted baseline certificate row is incomplete");
  }
  const portable = (row.completenessCertificate as { schemaVersion?: unknown }).schemaVersion === SOURCE_QUALITY_RECEIPT_SCHEMA;
  if (portable) portableReceiptFromRow(row);
  const grade = portable ? SOURCE_QUALITY_POLICY_ID : (row.completenessCertificate as { grade?: unknown }).grade;
  if (grade !== "A" && grade !== "B" && grade !== SOURCE_QUALITY_POLICY_ID) {
    throw new Error("Persisted trusted baseline certificate grade is invalid");
  }
  let changeReason: PersistedTrustedCompletenessBaseline["changeReason"] = null;
  if (row.baselineChangeReason !== null) {
    changeReason = assertTrustedBaselineTransition({
      previousSourceResultId: row.baselinePreviousSourceResultId,
      previousJobCount: row.baselinePreviousJobCount,
      currentSourceResultId: row.id,
      currentJobCount: row.dedupeOutputCount,
      certificateGrade: grade,
      changeReason: row.baselineChangeReason
    }).changeReason;
  } else if (row.baselinePreviousSourceResultId !== null || row.baselinePreviousJobCount !== null) {
    throw new Error("Persisted trusted baseline previous values require a change reason");
  }
  const baseline: PersistedTrustedCompletenessBaseline = {
    sourceId: row.sourceId,
    sourceResultId: row.id,
    sourceConfigSha256: row.sourceConfigHash,
    certificateGrade: grade,
    certificateSha256: row.completenessCertificateSha256,
    certifiedJobCount: row.dedupeOutputCount,
    verifiedAt: row.finishedAt.toISOString(),
    certificate: row.completenessCertificate,
    previousSourceResultId: row.baselinePreviousSourceResultId,
    previousJobCount: row.baselinePreviousJobCount,
    changeReason
  };
  assertTrustedCompletenessBaseline(baseline);
  return baseline;
}

function portableReceiptFromRow(row: PersistedTrustedBaselineRow): { receipt: SourceQualityReceipt; expectedBinding: SourceQualityReceipt["binding"] } {
  if (!row.releaseCandidateId || !row.batchId || !row.adapterVersion || !row.finishedAt || !row.completenessCertificateSha256) {
    throw new Error("Persisted portable receipt tuple is incomplete");
  }
  const expectedBinding = { releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceResultId: row.id,
    sourceId: row.sourceId, sourceConfigSha256: row.sourceConfigHash, adapterVersion: row.adapterVersion };
  const receipt = verifySourceQualityReceipt({ receipt: row.completenessCertificate, receiptSha256: row.completenessCertificateSha256, expected: expectedBinding });
  if (receipt.counts.finalUniqueJobCount !== row.dedupeOutputCount || receipt.issuedAt !== row.finishedAt.toISOString()) {
    throw new Error("Persisted portable receipt count or accepted time disagrees with its source result");
  }
  return { receipt, expectedBinding };
}
