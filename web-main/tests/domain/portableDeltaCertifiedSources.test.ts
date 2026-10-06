// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { chineseBFixture, LATER, EXPIRES } from "../helpers/sanofiChinesePublicFixture";
import { captureSyntheticLillyAGrade } from "../helpers/lillyAGradeFixture";
import { accepted, job } from "../helpers/portablePublicSnapshotFixture";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import { readPortablePublicSnapshot, type PortableSnapshotDb, type PortableSnapshotTransactionDb, type PortableSourceResultRow, type PortableLifecycleMemberRow, type PortableJobRow } from "../../src/db/portablePublicSnapshotRepository";
import { JOB_PROJECTION_DELTA_SCHEMA, JOB_PERSISTED_PROJECTION_SCHEMA, hashDeltaManifest, hashJobPersistedProjection, hashProjectionJson, sortJobProjectionMembers, type JobProjectionDeltaReceipt } from "../../src/domain/jobProjectionDeltaReceipt";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

function wrap(result: PortableSourceResultRow, members: PortableLifecycleMemberRow[], jobs: PortableJobRow[], observedAt: string) {
  const current = members.filter(member => member.missingCount === 0);
  result.canonicalGraceJobSetSha256 = hashCanonicalStringSet([]);
  result.canonicalVisibleJobSetSha256 = result.canonicalCurrentJobSetSha256;
  const manifest = sortJobProjectionMembers(current.map(member => ({...member, lifecycleStatus: "ACTIVE" as const, missingCount: 0 as const,
    jobProjectionSha256: hashJobPersistedProjection(jobs.find(row => row.dedupeKey === member.jobKey)!),
    lifecycleLastSeenAt: result.finishedAt!.toISOString(), lastConfirmedObservedAt: observedAt, lastPresentResultId: result.id})));
  const certificate: JobProjectionDeltaReceipt = {schemaVersion: JOB_PROJECTION_DELTA_SCHEMA, projectionSchemaVersion: JOB_PERSISTED_PROJECTION_SCHEMA,
    binding: {releaseCandidateId: result.releaseCandidateId, batchId: result.batchId, sourceId: result.sourceId, sourceResultId: result.id},
    observedAt, verifiedAt: result.finishedAt!.toISOString(), legacyCertificate: result.completenessCertificate as Record<string, unknown>,
    legacyCertificateSha256: result.completenessCertificateSha256!, detailEvidenceState: "UNKNOWN", members: manifest, manifestSha256: hashDeltaManifest(manifest)};
  result.completenessCertificate = certificate as unknown as PortableSourceResultRow["completenessCertificate"];
  result.completenessCertificateSha256 = hashProjectionJson(certificate);
  return {result, members: current, jobs};
}
function repository(f: {result: PortableSourceResultRow; members: PortableLifecycleMemberRow[]; jobs: PortableJobRow[]}) {
  const tx = {crawlBatchSourceResult: {findMany: vi.fn(async () => [f.result])},
    lifecycleSetEvidenceMember: {findMany: vi.fn(async () => f.members)}, job: {findMany: vi.fn(async () => f.jobs)},
    evidenceArtifact: {findMany: vi.fn(async () => [...(f.result.sanofiArtifacts ?? [])])}};
  const db = {$transaction: async (run: (tx: PortableSnapshotTransactionDb) => unknown) => run(tx)} as PortableSnapshotDb;
  return {tx, db};
}
let b: Awaited<ReturnType<typeof chineseBFixture>>;
beforeAll(async () => {b = await chineseBFixture();});

describe("delta wrappers retain the actual A/B certificate and artifact gates", () => {
  it("accepts synthetic Sanofi B through its inner receipt and independently read persisted artifacts", async () => {
    const f = structuredClone(b);
    for (const row of f.jobs) row.lastSeenAt = new Date("2026-10-01T00:00:00.000Z");
    const wrapped = wrap(f.result, f.members, f.jobs, LATER), r = repository(wrapped);
    const snapshot = await readPortablePublicSnapshot(r.db, {currentTime: new Date(LATER)}, [f.plan]);
    expect(snapshot.sources[0]).toMatchObject({state: "PUBLISHING", visibleJobCount: f.jobs.length, jobs: f.jobs.map(row => ({id: row.id, lastSeenAt: LATER, lastConfirmedObservedAt: LATER, inGrace: false}))});
    expect(r.tx.evidenceArtifact.findMany).toHaveBeenCalledOnce();
  });
  it("holds a wrapped Sanofi B if persisted artifact commitments are absent or corrupt", async () => {
    const f = structuredClone(b), r = repository(wrap(f.result, f.members, f.jobs, LATER));
    r.tx.evidenceArtifact.findMany.mockResolvedValueOnce([]);
    expect((await readPortablePublicSnapshot(r.db, {currentTime: new Date(LATER)}, [f.plan])).sources[0]).toMatchObject({state: "HOLD"});
  });
  it("still holds a wrapped B at independent validation expiry and for a later failed attempt", async () => {
    const f = structuredClone(b), r = repository(wrap(f.result, f.members, f.jobs, LATER));
    expect((await readPortablePublicSnapshot(r.db, {currentTime: new Date(EXPIRES)}, [f.plan])).sources[0]).toMatchObject({state: "HOLD"});
    const failed = {...f.result, id: "later-failed", startedAt: new Date(Date.parse(LATER) + 1000), finishedAt: new Date(Date.parse(LATER) + 2000),
      atomicCommitState: "NOT_ATTEMPTED" as const, completenessState: "FAILED" as const, transportState: "FAILED" as const,
      completenessCertificate: null, completenessCertificateSha256: null, failureCode: "FETCH_FAILED"};
    r.tx.crawlBatchSourceResult.findMany.mockResolvedValueOnce([f.result, failed]);
    expect((await readPortablePublicSnapshot(r.db, {currentTime: new Date(Date.parse(LATER) + 3000)}, [f.plan])).sources[0]).toMatchObject({state: "HOLD", reasons: ["LATEST_ATTEMPT_FAILED"]});
  });
  it("accepts a real synthetic A issuer's observedAt independently of Job and acceptance timestamps", async () => {
    const {plan, result: crawl, startedAt} = await captureSyntheticLillyAGrade(), at = "2026-10-02T10:01:00.000Z";
    const f = accepted(at, crawl.jobs.map(row => row.sourceJobId!), [], plan), evidence = crawl.fetchEvidence!;
    const artifact = evidence.artifacts.find(row => row.logicalKey === evidence.declaredCompleteness!.artifactLogicalKey)!;
    const issued = issueAGradeOfficialTotalCertificate({binding: {releaseCandidateId: f.result.releaseCandidateId, batchId: f.result.batchId, sourceResultId: f.result.id, sourceConfigSha256: f.result.sourceConfigHash},
      plan, transportSuccess: true, adapterSuccess: true, evidence, paginationEvaluation: crawl.paginationEvaluation!, reconciliation: crawl.reconciliation!, jobs: crawl.jobs,
      officialArtifactSha256: createHash("sha256").update(artifact.body).digest("hex")});
    if (issued.status !== "CERTIFIED") throw Error("A_FIXTURE_ISSUER_REJECTED");
    const c = issued.certificate;
    Object.assign(f.result, {startedAt, completenessCertificate: c, completenessCertificateSha256: issued.certificateSha256,
      adapterReconciliationSha256: c.output.adapterReconciliationSha256, collisionLedgerSha256: c.output.collisionLedgerSha256,
      expectedSurfaceSha256: hashCanonicalStringSet(c.scope.surfaceIds), visitedSurfaceSha256: hashCanonicalStringSet(c.scope.surfaceIds),
      expectedChannelSha256: hashCanonicalStringSet(c.scope.channelIds), visitedChannelSha256: hashCanonicalStringSet(c.scope.channelIds)});
    const jobs = crawl.jobs.map(record => ({...job(record.sourceJobId!, "2026-10-01T00:00:00.000Z"), sourceId: plan.source.id, companyId: plan.company.id,
      dedupeKey: `${plan.source.id}:${record.sourceJobId}`, officialTitle: record.officialTitle, officialUrl: record.officialUrl, cities: record.cities, city: record.cities[0]!, locationRaw: record.locationRaw,
      officialPublishedAt: new Date(record.officialPublishedAt!)}));
    const r = repository(wrap(f.result, f.members, jobs, c.observedAt));
    const snapshot = await readPortablePublicSnapshot(r.db, {currentTime: new Date(at)}, [plan]);
    expect(snapshot.sources[0]).toMatchObject({state: "PUBLISHING", lastSuccessAt: c.observedAt, visibleJobCount: 1, jobs: [{lastConfirmedObservedAt: c.observedAt, lastSeenAt: at}]});
  });
});
