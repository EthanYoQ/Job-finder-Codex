import { SANOFI_HISTORICAL_PUBLIC_PLAN } from "./sanofiHistoricalPublicPlan";
import { SANOFI_HISTORICAL_PUBLIC_RECEIPT as pin } from "../crawler/sanofiHistoricalPublicReceipt";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../crawler/sourcePlan";
import type { PortableSourceResultRow } from "../db/portablePublicSnapshotRepository";

/** The exception is disabled on every other source or future plan configuration. */
export function isSanofiPublicTransitionPlan(plan: SourceCrawlPlan): boolean {
  return plan.source.id === pin.binding.sourceId && plan.company.id === pin.companyId &&
    plan.source.companyId === pin.companyId && sourcePlanConfigSha256(plan) === pin.currentChineseConfigSha256;
}
export function isSanofiHistoricalPublicCandidate(row: PortableSourceResultRow): boolean {
  return row.sourceId === pin.binding.sourceId && row.id === pin.binding.sourceResultId &&
    row.sourceConfigHash === pin.binding.sourceConfigSha256;
}
export function assertSanofiHistoricalPublicRow(row: PortableSourceResultRow, plan: SourceCrawlPlan): void {
  const iso = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (!isSanofiPublicTransitionPlan(plan) ||
      sourcePlanConfigSha256(SANOFI_HISTORICAL_PUBLIC_PLAN) !== pin.binding.sourceConfigSha256 || !isSanofiHistoricalPublicCandidate(row) ||
      row.batchId !== pin.binding.batchId || row.releaseCandidateId !== pin.binding.releaseCandidateId ||
      row.completenessCertificateSha256 !== pin.certificateSha256 || row.adapterVersion !== pin.adapterVersion ||
      row.canonicalOutputSetSha256 !== pin.output.canonicalJobSetSha256 ||
      row.adapterReconciliationSha256 !== pin.output.adapterReconciliationSha256 ||
      row.collisionLedgerSha256 !== pin.output.collisionLedgerSha256 ||
      iso(row.startedAt) !== pin.startedAt || iso(row.finishedAt) !== pin.finishedAt ||
      Object.entries(pin.batch).some(([key, value]) =>
        (key === "startedAt" || key === "finishedAt" ? iso(row.batch[key]) : row.batch[key as keyof typeof row.batch]) !== value)) {
    throw new Error("SANOFI_HISTORICAL_PUBLIC_ROW_MISMATCH");
  }
}
