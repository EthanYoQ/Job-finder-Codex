import { accepted, digest } from "./portablePublicSnapshotFixture";
import { JOB_PROJECTION_DELTA_SCHEMA, JOB_PERSISTED_PROJECTION_SCHEMA, hashDeltaManifest, hashJobPersistedProjection, hashProjectionJson, sortJobProjectionMembers, type JobProjectionDeltaReceipt } from "../../src/domain/jobProjectionDeltaReceipt";
import type { PortableJobRow, PortableSourceResultRow } from "../../src/db/portablePublicSnapshotRepository";
export function wrapDeltaFixture(f: ReturnType<typeof accepted>, rows: PortableJobRow[], prior?: ReturnType<typeof accepted>, observed = f.result.finishedAt!.toISOString()) {
  const original = structuredClone(f);
  if (observed !== original.receipt.observation.crawledAt) {
    original.receipt.observation.crawledAt = observed;
    original.receipt.acquisition.startedAt = observed;
    original.result.startedAt = new Date(observed);
    original.result.batch.startedAt = new Date(observed);
    original.result.completenessCertificate = original.receipt;
    original.result.completenessCertificateSha256 = digest(original.receipt);
  }
  const binding = {releaseCandidateId: original.result.releaseCandidateId, batchId: original.result.batchId, sourceId: original.result.sourceId, sourceResultId: original.result.id};
  const members = sortJobProjectionMembers(original.members.map(member => ({...member, lifecycleStatus: "ACTIVE" as const, missingCount: member.missingCount as 0 | 1,
    jobProjectionSha256: hashJobPersistedProjection(rows.find(row => row.dedupeKey === member.jobKey)!),
    lifecycleLastSeenAt: member.missingCount === 0 ? original.result.finishedAt!.toISOString() : prior!.result.finishedAt!.toISOString(),
    lastConfirmedObservedAt: member.missingCount === 0 ? observed : prior!.receipt.observation.crawledAt,
    lastPresentResultId: member.missingCount === 0 ? original.result.id : prior!.result.id
  })));
  const receipt: JobProjectionDeltaReceipt = {schemaVersion: JOB_PROJECTION_DELTA_SCHEMA, projectionSchemaVersion: JOB_PERSISTED_PROJECTION_SCHEMA,
    binding, verifiedAt: original.result.finishedAt!.toISOString(), observedAt: observed,
    legacyCertificate: original.receipt as unknown as Record<string, unknown>, legacyCertificateSha256: original.result.completenessCertificateSha256!,
    detailEvidenceState: "UNKNOWN", members, manifestSha256: hashDeltaManifest(members)};
  return {result: {...original.result, completenessCertificate: receipt, completenessCertificateSha256: hashProjectionJson(receipt)} as PortableSourceResultRow,
    members: original.members, receipt};
}
