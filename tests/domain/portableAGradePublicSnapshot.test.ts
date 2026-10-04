import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import { selectPortableSourceSnapshots, projectPortableSourceJobs } from "../../src/domain/portablePublicSnapshot";
import { captureSyntheticLillyAGrade } from "../helpers/lillyAGradeFixture";
import { accepted, digest, job } from "../helpers/portablePublicSnapshotFixture";

// Invented official responses run through the real strict issuer; never live evidence.
async function aGradeFixture() {
  const {plan, result: crawl, startedAt} = await captureSyntheticLillyAGrade();
  const evidence = crawl.fetchEvidence!;
  const at = "2026-10-02T10:01:00.000Z";
  const fixture = accepted(at, crawl.jobs.map(row => row.sourceJobId!), [], plan);
  const declarationArtifact = evidence.artifacts.find(artifact => artifact.logicalKey === evidence.declaredCompleteness!.artifactLogicalKey)!;
  const issued = issueAGradeOfficialTotalCertificate({
    binding: {releaseCandidateId: fixture.result.releaseCandidateId, batchId: fixture.result.batchId,
      sourceResultId: fixture.result.id, sourceConfigSha256: fixture.result.sourceConfigHash},
    plan, transportSuccess: crawl.truth.transportSuccess, adapterSuccess: crawl.truth.adapterSuccess,
    evidence, paginationEvaluation: crawl.paginationEvaluation!, reconciliation: crawl.reconciliation!, jobs: crawl.jobs,
    officialArtifactSha256: createHash("sha256").update(declarationArtifact.body).digest("hex")
  });
  if (issued.status !== "CERTIFIED") throw Error(`SYNTHETIC_A_ISSUER_REJECTED:${issued.blockerCodes.join(",")}`);
  const certificate = issued.certificate;
  Object.assign(fixture.result, {startedAt, completenessCertificate: certificate,
    completenessCertificateSha256: issued.certificateSha256,
    adapterReconciliationSha256: certificate.output.adapterReconciliationSha256,
    collisionLedgerSha256: certificate.output.collisionLedgerSha256,
    expectedSurfaceSha256: hashCanonicalStringSet(certificate.scope.surfaceIds), visitedSurfaceSha256: hashCanonicalStringSet(certificate.scope.surfaceIds),
    expectedChannelSha256: hashCanonicalStringSet(certificate.scope.channelIds), visitedChannelSha256: hashCanonicalStringSet(certificate.scope.channelIds)});
  const normalized = crawl.jobs[0]!;
  const row = {...job(normalized.sourceJobId!, at), companyId: plan.company.id, sourceId: plan.source.id,
    dedupeKey: fixture.members[0]!.jobKey, officialTitle: normalized.officialTitle, officialUrl: normalized.officialUrl,
    officialPublishedAt: new Date(normalized.officialPublishedAt!), cities: normalized.cities, city: normalized.cities[0]!, locationRaw: normalized.locationRaw};
  return {plan, result: fixture.result, certificate, members: fixture.members, row, now: new Date(Date.parse(at) + 60_000)};
}
type Fixture = Awaited<ReturnType<typeof aGradeFixture>>;
let baseline: Fixture;
beforeAll(async () => { baseline = await aGradeFixture(); });
const select = (f: Fixture) => selectPortableSourceSnapshots([f.plan], [f.result], {currentTime: f.now})[0]!;
const project = (f: Fixture) => projectPortableSourceJobs(select(f), f.members, [f.row], {currentTime: f.now});

describe("bounded genuine A-grade public snapshots", () => {
  it("publishes an issuer-produced A certificate with its original proof and exact lifecycle members", () => {
    const f = structuredClone(baseline), before = structuredClone(f);
    expect(select(f)).toMatchObject({state: "PUBLISHING", policyId: "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1",
      lastAcceptedAt: f.result.finishedAt!.toISOString(), visibilityFloor: f.result.finishedAt!.toISOString(),
      lastSuccessAt: f.certificate.observedAt, lastAcceptedJobCount: 1, selected: {receipt: f.certificate}});
    expect(project(f)).toMatchObject({state: "PUBLISHING", visibleJobCount: 1, jobs: [{id: f.row.id}]});
    expect(f).toEqual(before);
  });

  it.each([
    ["certificate hash", (f: Fixture) => {f.result.completenessCertificateSha256 = "f".repeat(64);}],
    ["certificate tuple", (f: Fixture) => {f.certificate.binding.batchId = "other"; f.result.completenessCertificateSha256 = digest(f.certificate);}],
    ["certificate source", (f: Fixture) => {f.certificate.scope.sourceId = "source-csl-china-social"; f.result.completenessCertificateSha256 = digest(f.certificate);}],
    ["batch tuple", (f: Fixture) => {f.result.batch.releaseCandidateId = "other";}],
    ["count", (f: Fixture) => {f.result.rawCount++;}],
    ["output commitment", (f: Fixture) => {f.result.canonicalCurrentJobSetSha256 = "f".repeat(64);}],
    ["ledger commitment", (f: Fixture) => {f.result.adapterReconciliationSha256 = "f".repeat(64);}],
    ["surface commitment", (f: Fixture) => {f.result.visitedSurfaceSha256 = "f".repeat(64);}],
    ["observation before start", (f: Fixture) => {f.certificate.observedAt = new Date(f.result.startedAt.getTime() - 1).toISOString(); f.result.completenessCertificateSha256 = digest(f.certificate);}],
    ["observation after finish", (f: Fixture) => {f.certificate.observedAt = new Date(f.result.finishedAt!.getTime() + 1).toISOString(); f.result.completenessCertificateSha256 = digest(f.certificate);}],
    ["future result", (f: Fixture) => {f.result.finishedAt = new Date(f.now.getTime() + 1);}]
  ] as const)("holds an A proof with %s drift", (_name, mutate) => {
    const f = structuredClone(baseline); mutate(f);
    expect(select(f)).toMatchObject({state: "HOLD", reasons: ["RECEIPT_INTEGRITY_HOLD"]});
    expect(project(f).jobs).toEqual([]);
  });

  it("does not admit old configurations or other registered A sources", () => {
    const old = structuredClone(baseline); old.result.sourceConfigHash = "f".repeat(64);
    expect(select(old)).toMatchObject({state: "HOLD", selected: null});
    const changed = structuredClone(baseline); changed.plan.source.officialEntryUrl += "?old-config";
    expect(select(changed)).toMatchObject({state: "HOLD", policyId: null, selected: null});
    const other = structuredClone(baseline);
    other.plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-ucb-china-social")!;
    other.result.sourceId = other.plan.source.id; other.result.sourceConfigHash = sourcePlanConfigSha256(other.plan);
    Object.assign(other.certificate.binding, {sourceId: other.result.sourceId, sourceConfigSha256: other.result.sourceConfigHash});
    Object.assign(other.certificate.scope, {sourceId: other.result.sourceId, companyId: other.plan.company.id,
      surfaceIds: [other.plan.source.surfaceId!], channelIds: other.plan.expectedChannels!.map(channel => channel.channelId)});
    other.result.completenessCertificateSha256 = digest(other.certificate);
    expect(select(other)).toMatchObject({state: "HOLD", selected: null});
  });

  it("preserves the A visibility floor while holding unverified portable and later unknown writers", () => {
    const f = structuredClone(baseline);
    const portable = accepted("2026-10-02T09:00:00.000Z", ["old"], [], f.plan);
    // Lilly's portable policy is now reviewed too; make this receipt explicitly
    // unverified instead of relying on the source's former policy exclusion.
    portable.result.completenessCertificateSha256 = "f".repeat(64);
    const selected = selectPortableSourceSnapshots([f.plan], [f.result, portable.result], {currentTime: f.now})[0]!;
    expect(selected).toMatchObject({state: "HOLD", reasons:["RECEIPT_INTEGRITY_HOLD"], visibilityFloor: f.result.finishedAt!.toISOString()});
    const legacy = accepted(f.now.toISOString(), [], [], f.plan).result;
    legacy.completenessCertificate = {grade: "A"};
    expect(selectPortableSourceSnapshots([f.plan], [f.result, legacy], {currentTime: f.now})[0]).toMatchObject({
      state: "HOLD", reasons: ["RECEIPT_INTEGRITY_HOLD"]
    });
  });

  it.each([30, 31, 240])("keeps verified A jobs public at %s hours while recording stale observedAt", hours => {
    const f = structuredClone(baseline); f.now = new Date(Date.parse(f.certificate.observedAt) + hours * 60 * 60 * 1000);
    expect(select(f)).toMatchObject({state: "PUBLISHING", health: "HEALTHY", freshness: "STALE", lastSuccessAt: f.certificate.observedAt, reasons: ["LAST_GOOD_STALE"]});
    expect(project(f)).toMatchObject({state: "PUBLISHING", visibleJobCount: 1, jobs: [{id: f.row.id, lastSeenAt: f.row.lastSeenAt.toISOString()}]});
  });

  it.each(["membership", "pre-floor job", "post-ceiling job"])("keeps existing projection checks for %s", kind => {
    const f = structuredClone(baseline);
    if (kind === "membership") f.members[0]!.jobKeySha256 = "f".repeat(64);
    if (kind === "pre-floor job") f.row.lastSeenAt = new Date(f.result.finishedAt!.getTime() - 1);
    if (kind === "post-ceiling job") f.row.lastSeenAt = new Date(f.result.finishedAt!.getTime() + 1);
    expect(project(f)).toMatchObject({state: "HOLD", visibleJobCount: null, jobs: [], reasons: ["PROJECTION_INTEGRITY_HOLD"]});
  });
});
