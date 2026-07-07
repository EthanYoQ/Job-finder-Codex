import type { CandidateCompany } from "../data/companyRegistry";
import {
  fromPrismaRequiredJobField,
  type PrismaRequiredJobFieldName
} from "../db/prismaMappers";
import type { ATSKind, SourceKind, VerificationStatus } from "../domain/company";
import type { P0ReadinessInput } from "./p0Readiness";

export interface PersistedReadinessObservationRow {
  id: string;
  sourceId: string;
  crawledAt: Date;
  successful: boolean;
  structuredJobCount: number;
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
  return {
    id: row.id,
    officialChineseName: row.officialChineseName,
    officialWebsiteUrl: row.officialWebsiteUrl,
    pinyinName: row.pinyinName,
    inclusionReason: row.inclusionReason,
    sources: row.sources.map((source) => ({
      id: source.id,
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
