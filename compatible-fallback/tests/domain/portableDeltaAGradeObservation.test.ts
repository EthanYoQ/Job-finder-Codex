// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { captureSyntheticLillyAGrade } from "../helpers/lillyAGradeFixture";
import { accepted, job } from "../helpers/portablePublicSnapshotFixture";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import { selectPortableSourceSnapshots, projectPortableSourceJobs } from "../../src/domain/portablePublicSnapshot";
import { hashJobPersistedProjection, hashProjectionJson, hashDeltaManifest, sortJobProjectionMembers,
  JOB_PROJECTION_DELTA_SCHEMA, JOB_PERSISTED_PROJECTION_SCHEMA, type JobProjectionDeltaReceipt } from "../../src/domain/jobProjectionDeltaReceipt";
import type { PortableSourceResultRow, PortableJobRow } from "../../src/db/portablePublicSnapshotRepository";

// Invented responses pass the actual A issuer. No recorded official jobs or receipts.
async function fixture(observedAt: string, indexes: number[], grace: string[] = []) {
  const {plan, result: crawl} = await captureSyntheticLillyAGrade({observedAt, indexes});
  const finishedAt = new Date(Date.parse(observedAt) + 60_000).toISOString();
  const f = accepted(finishedAt, crawl.jobs.map(row => row.sourceJobId!), grace, plan);
  const evidence = crawl.fetchEvidence!, artifact = evidence.artifacts.find(a => a.logicalKey === evidence.declaredCompleteness!.artifactLogicalKey)!;
  const issued = issueAGradeOfficialTotalCertificate({binding: {releaseCandidateId: f.result.releaseCandidateId,
    batchId: f.result.batchId, sourceResultId: f.result.id, sourceConfigSha256: f.result.sourceConfigHash}, plan,
    transportSuccess: true, adapterSuccess: true, evidence, paginationEvaluation: crawl.paginationEvaluation!,
    reconciliation: crawl.reconciliation!, jobs: crawl.jobs, officialArtifactSha256: createHash("sha256").update(artifact.body).digest("hex")});
  if (issued.status !== "CERTIFIED") throw Error("SYNTHETIC_A_ISSUER_REJECTED");
  const c = issued.certificate;
  Object.assign(f.result, {startedAt: new Date(Date.parse(observedAt) - 60_000), completenessCertificate: c,
    completenessCertificateSha256: issued.certificateSha256, adapterReconciliationSha256: c.output.adapterReconciliationSha256,
    collisionLedgerSha256: c.output.collisionLedgerSha256, expectedSurfaceSha256: hashCanonicalStringSet(c.scope.surfaceIds),
    visitedSurfaceSha256: hashCanonicalStringSet(c.scope.surfaceIds), expectedChannelSha256: hashCanonicalStringSet(c.scope.channelIds),
    visitedChannelSha256: hashCanonicalStringSet(c.scope.channelIds)});
  f.result.observations = [{sourceId: f.result.sourceId, sourceResultId: f.result.id, batchId: f.result.batchId,
    releaseCandidateId: f.result.releaseCandidateId, sourceConfigSha256: f.result.sourceConfigHash, adapterVersion: f.result.adapterVersion,
    observedFrom: f.result.startedAt, observedTo: f.result.finishedAt!, crawledAt: new Date(Date.parse(observedAt) - 30_000),
    successful: true, transportSucceeded: true, adapterSucceeded: true, completenessVerified: true, atomicCommitSucceeded: true,
    canonicalRawSha256: c.pagination.canonicalRawOfficialIdSetSha256, canonicalOutputSha256: c.output.canonicalJobSetSha256,
    paginationTraceSha256: c.pagination.paginationTraceSha256}];
  const jobs: PortableJobRow[] = crawl.jobs.map(record => ({...job(record.sourceJobId!, finishedAt), sourceId: plan.source.id,
    companyId: plan.company.id, dedupeKey: `${plan.source.id}:${record.sourceJobId}`, officialTitle: record.officialTitle,
    officialUrl: record.officialUrl, cities: record.cities, city: record.cities[0]!, locationRaw: record.locationRaw,
    officialPublishedAt: new Date(record.officialPublishedAt!)}));
  return {...f, plan, jobs, certificate: c};
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function wrap(f: Fixture, prior?: Fixture) {
  const result = f.result, observedAt = result.observations[0]!.crawledAt.toISOString();
  const members = sortJobProjectionMembers(f.members.map(member => ({...member, lifecycleStatus: "ACTIVE" as const,
    missingCount: member.missingCount as 0 | 1, jobProjectionSha256: hashJobPersistedProjection(f.jobs.find(row => row.dedupeKey === member.jobKey)!),
    lastConfirmedObservedAt: member.missingCount ? prior!.result.observations[0]!.crawledAt.toISOString() : observedAt,
    lifecycleLastSeenAt: member.missingCount ? prior!.result.finishedAt!.toISOString() : result.finishedAt!.toISOString(),
    lastPresentResultId: member.missingCount ? prior!.result.id : result.id})));
  const receipt: JobProjectionDeltaReceipt = {schemaVersion: JOB_PROJECTION_DELTA_SCHEMA, projectionSchemaVersion: JOB_PERSISTED_PROJECTION_SCHEMA,
    binding: {releaseCandidateId: result.releaseCandidateId, batchId: result.batchId, sourceId: result.sourceId, sourceResultId: result.id},
    observedAt, verifiedAt: result.finishedAt!.toISOString(), legacyCertificate: result.completenessCertificate as Record<string, unknown>,
    legacyCertificateSha256: result.completenessCertificateSha256!, detailEvidenceState: "UNKNOWN", members, manifestSha256: hashDeltaManifest(members)};
  result.completenessCertificate = receipt as unknown as PortableSourceResultRow["completenessCertificate"];
  result.completenessCertificateSha256 = hashProjectionJson(receipt);
  return receipt;
}
function project(f: Fixture, prior?: Fixture) {
  const options = {currentTime: f.result.finishedAt!};
  const selected = selectPortableSourceSnapshots([f.plan], [...(prior ? [prior.result] : []), f.result], options)[0]!;
  return projectPortableSourceJobs(selected, f.members, f.jobs, options, prior?.members);
}
let first: Fixture, second: Fixture;
beforeAll(async () => {
  first = await fixture("2026-10-02T10:00:00.000Z", [0, 1]);
  second = await fixture("2026-10-03T10:00:00.000Z", [0], [first.jobs[1]!.sourceJobId!]);
  second.jobs.push({...structuredClone(first.jobs[1]!), missingSuccessCount: 1});
});

describe("A delta observation semantics", () => {
  it("preserves old A publication without adding an observation requirement", () => {
    const f = structuredClone(first); f.result.observations = [];
    expect(project(f)).toMatchObject({state: "PUBLISHING", visibleJobCount: 2, lastSuccessAt: f.certificate.observedAt});
  });
  it("uses the original crawl observation for delta jobs while retaining the independent A observation", () => {
    const f = structuredClone(first), receipt = wrap(f), before = structuredClone(f);
    expect(receipt.observedAt).not.toBe(f.certificate.observedAt);
    expect(project(f)).toMatchObject({state: "PUBLISHING", visibleJobCount: 2, lastSuccessAt: f.certificate.observedAt,
      jobs: [...f.jobs].sort((a, b) => a.id.localeCompare(b.id)).map(row => ({id: row.id, lastConfirmedObservedAt: receipt.observedAt, lastSeenAt: receipt.verifiedAt}))});
    expect(f).toEqual(before);
  });
  it.each([
    ["missing", (r: PortableSourceResultRow) => {r.observations = [];}],
    ["duplicate", (r: PortableSourceResultRow) => {r.observations.push(structuredClone(r.observations[0]!));}],
    ...(["sourceId", "sourceResultId", "batchId", "releaseCandidateId", "sourceConfigSha256", "adapterVersion", "canonicalOutputSha256"] as const)
      .map(key => [key, (r: PortableSourceResultRow) => {r.observations[0]![key] = "unrelated";}] as const),
    ...(["successful", "transportSucceeded", "adapterSucceeded", "completenessVerified", "atomicCommitSucceeded"] as const)
      .map(key => [key, (r: PortableSourceResultRow) => {r.observations[0]![key] = false;}] as const),
    ["start", (r: PortableSourceResultRow) => {r.observations[0]!.observedFrom = new Date(r.startedAt.getTime() - 1);}],
    ["finish", (r: PortableSourceResultRow) => {r.observations[0]!.observedTo = new Date(r.finishedAt!.getTime() + 1);}],
    ["before acquisition", (r: PortableSourceResultRow) => {r.observations[0]!.crawledAt = new Date(r.startedAt.getTime() - 1);}],
    ["after acquisition", (r: PortableSourceResultRow) => {r.observations[0]!.crawledAt = new Date(r.finishedAt!.getTime() + 1);}],
    ["invalid timestamp", (r: PortableSourceResultRow) => {r.observations[0]!.crawledAt = new Date(NaN);}]
  ] as const)("holds A delta when its original observation has %s drift", (_name, mutate) => {
    const f = structuredClone(first); wrap(f); mutate(f.result);
    expect(project(f)).toMatchObject({state: "HOLD", visibleJobCount: null, jobs: []});
  });
  it("rejects a rehashed wrapper that substitutes the certificate time for the job observation", () => {
    const f = structuredClone(first), receipt = wrap(f);
    receipt.observedAt = f.certificate.observedAt;
    receipt.members = sortJobProjectionMembers(receipt.members.map(m => ({...m, lastConfirmedObservedAt: receipt.observedAt})));
    receipt.manifestSha256 = hashDeltaManifest(receipt.members); f.result.completenessCertificateSha256 = hashProjectionJson(receipt);
    expect(project(f)).toMatchObject({state: "HOLD", jobs: []});
  });
  it.each([false, true])("validates GRACE against original A history (prior delta=%s)", priorDelta => {
    const prior = structuredClone(first), f = structuredClone(second);
    if (priorDelta) wrap(prior);
    wrap(f, prior);
    // Preserve the existing A policy: only CURRENT jobs are listed, GRACE still needs its full proof.
    expect(project(f, prior)).toMatchObject({state: "PUBLISHING", visibleJobCount: 1, jobs: [{id: f.jobs[0]!.id, inGrace: false}]});
    prior.result.observations[0]!.sourceResultId = "unrelated";
    expect(project(f, prior)).toMatchObject({state: "HOLD", jobs: []});
  });
  it("rejects rehashed GRACE that claims the old certificate time instead of the old job observation", () => {
    const prior = structuredClone(first), f = structuredClone(second), receipt = wrap(f, prior);
    receipt.members = sortJobProjectionMembers(receipt.members.map(m => m.missingCount ? {...m, lastConfirmedObservedAt: prior.certificate.observedAt} : m));
    receipt.manifestSha256 = hashDeltaManifest(receipt.members); f.result.completenessCertificateSha256 = hashProjectionJson(receipt);
    expect(project(f, prior)).toMatchObject({state: "HOLD", jobs: []});
  });
});
