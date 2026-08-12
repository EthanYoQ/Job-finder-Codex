import type { CandidateCompany } from "../data/companyRegistry";
import {
  fromPrismaRequiredJobField,
  type PrismaRequiredJobFieldName
} from "../db/prismaMappers";
import type { ATSKind, SourceKind, VerificationStatus } from "../domain/company";
import type { CompletenessEvidenceKind, CompletenessStatus } from "../domain/company";
import type { P0ReadinessInput } from "./p0Readiness";

export interface PersistedReadinessObservationRow {
  id: string;
  sourceId: string;
  crawledAt: Date;
  successful: boolean;
  structuredJobCount: number;
  expectedJobCount: number | null;
  completenessStatus: CompletenessStatus | null;
  completenessEvidenceKind: CompletenessEvidenceKind | null;
  completenessEvidenceUrl: string | null;
  completenessBlockerReason: string | null;
  totalPages: number | null;
  pageSize: number | null;
  pagesVisited: number | null;
  stableRequiredFields: readonly PrismaRequiredJobFieldName[];
  failureReason: string | null;
}

export interface PersistedReadinessSourceRow {
  id: string;
  companyId: string;
  kind: SourceKind;
  atsKind: ATSKind;
  status: VerificationStatus;
  officialEntryUrl: string;
  officialChainEvidenceUrl: string;
  campusEntryUrl: string | null;
  crawlObservations: readonly PersistedReadinessObservationRow[];
}

export interface PersistedReadinessCompanyRow {
  id: string;
  officialChineseName: string;
  officialWebsiteUrl: string;
  pinyinName: string;
  inclusionReason: string;
  sources: readonly PersistedReadinessSourceRow[];
}

export function toP0ReadinessInput(
  rows: readonly PersistedReadinessCompanyRow[]
): P0ReadinessInput {
  return {
    companies: rows.map(toCandidateCompany),
    observationsBySource: Object.fromEntries(
      rows.flatMap((company) =>
        company.sources.map((source) => [
          source.id,
          source.crawlObservations.map((observation) => ({
            id: observation.id,
            sourceId: observation.sourceId,
            crawledAt: observation.crawledAt,
            successful: observation.successful,
            structuredJobCount: observation.structuredJobCount,
            ...(observation.expectedJobCount === null
              ? {}
              : { expectedJobCount: observation.expectedJobCount }),
            ...(observation.completenessStatus === null
              ? {}
              : { completenessStatus: observation.completenessStatus }),
            ...(observation.completenessEvidenceKind === null
              ? {}
              : { completenessEvidenceKind: observation.completenessEvidenceKind }),
            ...(observation.completenessEvidenceUrl === null
              ? {}
              : { completenessEvidenceUrl: observation.completenessEvidenceUrl }),
            ...(observation.completenessBlockerReason === null
              ? {}
              : { completenessBlockerReason: observation.completenessBlockerReason }),
            ...(observation.totalPages === null ? {} : { totalPages: observation.totalPages }),
            ...(observation.pageSize === null ? {} : { pageSize: observation.pageSize }),
            ...(observation.pagesVisited === null
              ? {}
              : { pagesVisited: observation.pagesVisited }),
            stableRequiredFields: observation.stableRequiredFields.map(fromPrismaRequiredJobField),
            ...(observation.failureReason === null
              ? {}
              : { failureReason: observation.failureReason })
          }))
        ])
      )
    )
  };
}

function toCandidateCompany(row: PersistedReadinessCompanyRow): CandidateCompany {
  if (row.inclusionReason !== "FOREIGN_PHARMA" && row.inclusionReason !== "DOMESTIC_PHARMA") {
    throw new Error(`Persisted company category is invalid: ${row.inclusionReason}`);
  }
  return {
    id: row.id,
    officialChineseName: row.officialChineseName,
    officialWebsiteUrl: row.officialWebsiteUrl,
    pinyinName: row.pinyinName,
    category: row.inclusionReason,
    targetStatus: row.sources.length === 0 ? "BLOCKED_EVIDENCE_GAP" : "ACTIVE",
    sources: row.sources.map((source) => ({
      id: source.id,
      surfaceId: `surface-${source.id.replace(/^source-/, "").replace(/-social$/, "")}-social`,
      companyId: source.companyId,
      kind: source.kind,
      atsKind: source.atsKind,
      status: source.status,
      officialEntryUrl: source.officialEntryUrl,
      officialChainEvidenceUrl: source.officialChainEvidenceUrl,
      ...(source.campusEntryUrl === null ? {} : { campusEntryUrl: source.campusEntryUrl })
    }))
  };
}
