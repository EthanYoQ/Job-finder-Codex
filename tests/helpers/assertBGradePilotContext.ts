import { expect } from "vitest";
import { loadPilotContext } from "../../src/crawler/cloudPilotContext";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import type { PortableSourceResultRow } from "../../src/db/portablePublicSnapshotRepository";

/** Synthetic issuer output only; never establishes production qualification. */
export async function assertBGradePilotContext(plan: SourceCrawlPlan, source: PortableSourceResultRow) {
  const row = JSON.parse(JSON.stringify({...source, baselineChangeReason: null,
    baselinePreviousSourceResultId: null, baselinePreviousJobCount: null}));
  const value = {sourceId: plan.source.id, sourceConfigSha256: sourcePlanConfigSha256(plan), jobs: [], firstAccepted: row, latestAccepted: row};
  const bytes = JSON.stringify(value);
  const loaded = await loadPilotContext(value, plan, true);
  expect(loaded.trustedCompletenessBaseline).toMatchObject({certificateGrade: "B", sourceResultId: row.id,
    certificateSha256: row.completenessCertificateSha256, certifiedJobCount: row.dedupeOutputCount});
  expect(loaded.acceptedVisibilityFloor?.toISOString()).toBe(row.finishedAt);
  expect(JSON.stringify(value)).toBe(bytes);
  const mutations: [string, (row: any) => void][] = [
    ["missing observation", r => {delete r.observations;}],
    ["empty observations", r => {r.observations = [];}],
    ["duplicate observations", r => {r.observations.push({...r.observations[0]});}],
    ...["sourceId", "sourceResultId", "batchId", "releaseCandidateId", "sourceConfigSha256", "adapterVersion"].map(key =>
      [key, (r: any) => {r.observations[0][key] = "different";}] as [string, (row: any) => void]),
    ...["successful", "transportSucceeded", "adapterSucceeded", "completenessVerified", "atomicCommitSucceeded"].map(key =>
      [key, (r: any) => {r.observations[0][key] = false;}] as [string, (row: any) => void]),
    ...["observedFrom", "observedTo", "crawledAt"].map(key =>
      [key, (r: any) => {r.observations[0][key] = "2000-01-01T00:00:00.000Z";}] as [string, (row: any) => void]),
    ...["canonicalRawSha256", "canonicalOutputSha256", "paginationTraceSha256"].map(key =>
      [key, (r: any) => {r.observations[0][key] = "f".repeat(64);}] as [string, (row: any) => void]),
    ["missing raw commitment", r => {delete r.observations[0].canonicalRawSha256;}],
    ["missing adapter binding", r => {delete r.adapterVersion; delete r.observations[0].adapterVersion;}],
    ["empty output commitments", r => {r.canonicalCurrentJobSetSha256 = r.canonicalOutputSetSha256 = r.observations[0].canonicalOutputSha256 = "";}],
    ["missing raw commitment with certificate fallback", r => {delete r.observations[0].canonicalRawSha256; r.canonicalRawEvidenceIdSetSha256 = "a".repeat(64);}],
    ["source output", r => {r.canonicalOutputSetSha256 = "f".repeat(64);}],
    ["reconciliation", r => {r.adapterReconciliationSha256 = "f".repeat(64);}],
    ["collision", r => {r.collisionLedgerSha256 = "f".repeat(64);}],
    ["certificate time", r => {r.finishedAt = r.observations[0].observedTo = new Date(Date.parse(r.finishedAt) + 1).toISOString();}]
  ];
  for (const side of ["firstAccepted", "latestAccepted"] as const) for (const [label, mutate] of mutations) {
    const invalid = JSON.parse(bytes);
    mutate(invalid[side]);
    await expect(loadPilotContext(invalid, plan, true), `${side}: ${label}`).rejects.toThrow();
  }
}
