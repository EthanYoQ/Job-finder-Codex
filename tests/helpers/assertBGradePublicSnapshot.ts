import { expect } from "vitest";
import { createHash } from "node:crypto";
import { selectPortableSourceSnapshots, projectPortableSourceJobs } from "../../src/domain/portablePublicSnapshot";
import { readPortableScheduleObservations } from "../../src/db/portableScheduleObservations";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import type { SourceCrawlResult } from "../../src/crawler/runSourceCrawl";
import type { BGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { canonicalPageTraceSha256, canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
import { accepted, digest, job } from "./portablePublicSnapshotFixture";

/** Synthetic issuer output only. These checks never establish live source qualification. */
export async function assertBGradePublicSnapshot(plan: SourceCrawlPlan, crawl: SourceCrawlResult, certificate: BGradeTraversalCertificate) {
  const at = certificate.issuedAt, now = new Date(Date.parse(at) + 60_000);
  const f = accepted(at, crawl.jobs.map(row => row.sourceJobId!), ["historical-grace"], plan);
  const receipt = structuredClone(certificate);
  Object.assign(receipt.binding, {releaseCandidateId: f.result.releaseCandidateId, batchId: f.result.batchId, sourceResultId: f.result.id});
  const counts = crawl.fetchEvidence!.fetchCounts, ledger = crawl.reconciliation!;
  Object.assign(f.result, {completenessCertificate: receipt, completenessCertificateSha256: digest(receipt),
    ...counts, normalizedCount: ledger.validBeforeDedupeCount, dedupeInputCount: ledger.dedupeInputCount,
    validationDiscardCount: counts.validationDiscardCount, discardCount: counts.validationDiscardCount,
    adapterInputCount: ledger.rawInputCount, adapterOutputCount: ledger.dedupeOutputCount, adapterLossCount: 0,
    expectedJobCount: crawl.observation.expectedJobCount ?? null, expectedEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
    adapterReconciliationSha256: receipt.output.adapterReconciliationSha256, collisionLedgerSha256: receipt.output.collisionLedgerSha256,
    expectedSurfaceSha256: canonicalStringSetSha256(receipt.scope.surfaceIds), visitedSurfaceSha256: canonicalStringSetSha256(receipt.scope.surfaceIds),
    expectedChannelSha256: canonicalStringSetSha256(receipt.scope.channelIds), visitedChannelSha256: canonicalStringSetSha256(receipt.scope.channelIds),
    observations: [{sourceId: plan.source.id, batchId: f.result.batchId, releaseCandidateId: f.result.releaseCandidateId,
      sourceResultId: f.result.id, sourceConfigSha256: sourcePlanConfigSha256(plan), adapterVersion: f.result.adapterVersion,
      observedFrom: new Date(at), observedTo: new Date(at), crawledAt: new Date(at), successful: true,
      transportSucceeded: true, adapterSucceeded: true, completenessVerified: true, atomicCommitSucceeded: true,
      canonicalRawSha256: canonicalStringSetSha256(crawl.fetchEvidence!.pages.flatMap(p => p.rawJobIds)),
      canonicalOutputSha256: receipt.output.canonicalJobSetSha256,
      paginationTraceSha256: canonicalPageTraceSha256(crawl.fetchEvidence!.pages)}]});
  const rows = crawl.jobs.map(row => ({...job(row.sourceJobId!, at), sourceId: plan.source.id, companyId: plan.company.id,
    dedupeKey: `${plan.source.id}:${row.sourceJobId}`, officialTitle: row.officialTitle, officialUrl: row.officialUrl,
    cities: row.cities, city: row.cities[0]!, locationRaw: row.locationRaw}));
  const select = (result = f.result, time = now) => selectPortableSourceSnapshots([plan], [result], {currentTime: time})[0]!;
  expect(select(), plan.source.id).toMatchObject({state: "PUBLISHING", policyId: "STRICT_PLAN_BOUND_INDEPENDENT_TRAVERSAL_REPLAY_V2", lastAcceptedJobCount: rows.length, selected: {receipt}});
  if (plan.source.id === "source-servier-china-social") expect(select().sourceScopeSummary).toEqual({portalJobCount: counts.rawCount, verifiedChinaJobCount: rows.length, unknownCountryJobCount: counts.validationDiscardCount});
  expect(projectPortableSourceJobs(select(), f.members, rows, {currentTime: now})).toMatchObject({state: "PUBLISHING", visibleJobCount: rows.length});
  expect((await readPortableScheduleObservations({findMany: async () => [f.result]}, plan, now))[0]).toEqual({crawledAt: new Date(at), successful: true});
  for (const kind of ["hash", "nullOutput", "emptyAdapter", "nullCollision", "raw", "trace", "observationTuple", "count", "scope", "config", "exclusions", "currentRun", "staleCurrentRun"] as const) {
    const invalid: any = structuredClone(f.result), proof = invalid.completenessCertificate;
    if (kind === "nullOutput") invalid.canonicalOutputSetSha256 = null;
    if (kind === "emptyAdapter") invalid.adapterReconciliationSha256 = "";
    if (kind === "nullCollision") invalid.collisionLedgerSha256 = null;
    if (kind === "hash") invalid.completenessCertificateSha256 = "f".repeat(64);
    if (kind === "raw") invalid.observations[0].canonicalRawSha256 = "f".repeat(64);
    if (kind === "trace") invalid.observations[0].paginationTraceSha256 = "f".repeat(64);
    if (kind === "observationTuple") invalid.observations[0].batchId = "other";
    if (kind === "count") invalid.rawCount++;
    if (kind === "scope") proof.independentValidation.surfaceIds = ["wrong"];
    if (kind === "config") proof.independentValidation.sourceConfigSha256 = "f".repeat(64);
    if (kind === "exclusions") proof.mainTraversal.canonicalExcludedMatchKeySetSha256 = "f".repeat(64);
    if (kind === "currentRun") proof.validationPolicy.execution = "REUSED";
    if (kind === "staleCurrentRun") {proof.issuedAt = new Date(Date.parse(at) + 3_600_001).toISOString(); invalid.finishedAt = new Date(proof.issuedAt); invalid.observations[0].observedTo = invalid.finishedAt;}
    if (kind !== "hash") invalid.completenessCertificateSha256 = digest(proof);
    expect(select(invalid, new Date(Date.parse(at) + 3_660_000)).state, `${plan.source.id}:${kind}`).toBe("HOLD");
  }
  const replaced: any = structuredClone(f.result), foreignKey = `${plan.source.id}:invented-key`;
  const originalKey = rows[0]!.dedupeKey;
  const forgedMembers = f.members.map(m => m.jobKey === originalKey ? {...m, jobKey: foreignKey, jobKeySha256: createHash("sha256").update(foreignKey).digest("hex")} : m);
  const forgedRows = rows.map(row => row.dedupeKey === originalKey ? {...row, dedupeKey: foreignKey} : row);
  replaced.canonicalCurrentJobSetSha256 = replaced.canonicalOutputSetSha256 = replaced.completenessCertificate.output.canonicalJobSetSha256 = replaced.observations[0].canonicalOutputSha256 = canonicalStringSetSha256(forgedMembers.filter(m => m.setKind === "CURRENT").map(m => m.jobKey));
  replaced.canonicalVisibleJobSetSha256 = canonicalStringSetSha256(forgedMembers.filter(m => m.setKind === "VISIBLE").map(m => m.jobKey));
  replaced.completenessCertificateSha256 = digest(replaced.completenessCertificate);
  expect(select(replaced).state).toBe("PUBLISHING");
  expect(projectPortableSourceJobs(select(replaced), forgedMembers, forgedRows, {currentTime: now})).toMatchObject({state: "HOLD", reasons: ["PROJECTION_INTEGRITY_HOLD"]});
  const latest = {...structuredClone(f.result), id: "new-failed", startedAt: now, finishedAt: now, atomicCommitState: "NOT_ATTEMPTED" as const, completenessState: "FAILED" as const, completenessCertificate: null, failureCode: "COMPLETENESS_ANOMALY_UNVERIFIED"};
  expect(selectPortableSourceSnapshots([plan], [f.result, latest], {currentTime: now})[0]).toMatchObject({state: "HOLD", reasons: ["LATEST_ATTEMPT_FAILED"]});
  expect(select(f.result, new Date(Date.parse(at) + 30 * 3_600_000)).state).toBe("HOLD");
  const changed = structuredClone(plan); changed.source.officialEntryUrl += "?old-config";
  expect(selectPortableSourceSnapshots([changed], [f.result], {currentTime: now})[0]).toMatchObject({state: "HOLD", policyId: null});
}
