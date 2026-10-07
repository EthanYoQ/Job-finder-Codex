import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { createAmgenManualWorkdaySourceFetch } from "../src/crawler/amgenManualWorkdaySourceFetch";
import { runSourceCrawl } from "../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../src/crawler/completenessCertificate";
import { hashCanonicalStringSet } from "../src/crawler/runtimeBatchIdentity";
import { amgenManualWorkdayFixture } from "../tests/helpers/amgenManualWorkdayFixture";
import { AMGEN_TIME } from "../tests/helpers/amgenNativeFixture";

const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-amgen-china-social")!;
let clock = Date.parse(AMGEN_TIME), detailCalls = 0;
const fixture = amgenManualWorkdayFixture(13), target = fixture.rows.at(-1)!.apiUrl;
const crawl = await runSourceCrawl(plan, { fetch: createAmgenManualWorkdaySourceFetch({ now: () => new Date(clock),
  delay: async ms => { clock += ms; }, http: async req => {
    const response = {...await fixture.http(req), capturedAt: new Date(clock).toISOString()};
    return req.url === target && ++detailCalls === 1 ? {...response, status: 502, body: "Synthetic upstream gateway failure", contentType: "text/html"} : response;
  } }) });
assert.equal(crawl.status, "SUCCESS"); assert.equal(crawl.jobs.length, 13); assert.equal(detailCalls, 2);
assert.equal(crawl.fetchEvidence!.artifacts.filter(a => a.kind === "COMMAND_OUTPUT").length, 1);
const readers = [
  {role: "web-main", commit: "6510baecc784ec87999cb5ea546b0995afe9222f"},
  {role: "compatible-fallback", commit: "600ad0a"}
];
const outcomes = [];
for (const reader of readers) {
  const root = `/workspace/scratch/5e9614251709/jb-astra-reader-release-20261007T1054Z/roles/${reader.role}`;
  const from = (path: string) => import(pathToFileURL(`${root}/${path}`).href);
  const [sp, registry, certificate, quality, pub, delta, helper, oldFetch] = await Promise.all([
    from("src/crawler/sourcePlan.ts"), from("src/data/companyRegistry.ts"), from("src/crawler/completenessCertificate.ts"),
    from("src/crawler/sourceQualityAdmission.ts"), from("src/db/portablePublicSnapshotRepository.ts"),
    from("src/domain/jobProjectionDeltaReceipt.ts"), from("tests/helpers/portablePublicSnapshotFixture.ts"), from("src/crawler/amgenManualWorkdaySourceFetch.ts")
  ]);
  const readerPlan = sp.buildStagedSourceCrawlPlans(registry.candidateCompanies).find((p: any) => p.source.id === plan.source.id);
  assert.equal(sp.sourcePlanConfigSha256(readerPlan), sourcePlanConfigSha256(plan));
  assert.equal(quality.getSourceQualityPolicy(readerPlan), null);
  // This establishes the boundary: the old raw replay cannot consume the new
  // diagnostic grammar, while the unchanged public receipt path can.
  assert.equal(oldFetch.validateStrictAmgenManualWorkdayEvidence(readerPlan, crawl.fetchEvidence, crawl.jobs), false);
  const at = new Date(clock + 1_000).toISOString();
  const f = helper.accepted(at, crawl.jobs.map(j => j.sourceJobId!), [], readerPlan);
  const evidence = crawl.fetchEvidence!, artifact = evidence.artifacts.find(a => a.logicalKey === evidence.declaredCompleteness!.artifactLogicalKey)!;
  const issued = issueAGradeOfficialTotalCertificate({ binding: { releaseCandidateId: f.result.releaseCandidateId, batchId: f.result.batchId, sourceResultId: f.result.id, sourceConfigSha256: f.result.sourceConfigHash },
    plan, transportSuccess: true, adapterSuccess: true, evidence, paginationEvaluation: crawl.paginationEvaluation!, reconciliation: crawl.reconciliation!, jobs: crawl.jobs,
    officialArtifactSha256: createHash("sha256").update(artifact.body).digest("hex") });
  assert.equal(issued.status, "CERTIFIED"); if (issued.status !== "CERTIFIED") throw Error("SYNTHETIC_CERTIFICATE_REJECTED");
  const c = issued.certificate;
  const receipt = certificate.verifyAGradeCompletenessCertificateReceipt({certificate: c, certificateSha256: issued.certificateSha256, expected: {
    releaseCandidateId: f.result.releaseCandidateId, batchId: f.result.batchId, sourceResultId: f.result.id, sourceId: plan.source.id, companyId: plan.company.id,
    sourceConfigSha256: sp.sourcePlanConfigSha256(readerPlan), surfaceIds: [readerPlan.source.surfaceId!], channelIds: readerPlan.expectedChannels.map((x:any) => x.channelId),
    canonicalJobSetSha256: c.output.canonicalJobSetSha256, adapterReconciliationSha256: c.output.adapterReconciliationSha256, collisionLedgerSha256: c.output.collisionLedgerSha256
  }}); assert.equal(receipt.status, "PASS");
  Object.assign(f.result, { startedAt: new Date(Date.parse(AMGEN_TIME) - 1_000), completenessCertificate: c, completenessCertificateSha256: issued.certificateSha256,
    adapterReconciliationSha256: c.output.adapterReconciliationSha256, collisionLedgerSha256: c.output.collisionLedgerSha256,
    expectedSurfaceSha256: hashCanonicalStringSet(c.scope.surfaceIds), visitedSurfaceSha256: hashCanonicalStringSet(c.scope.surfaceIds),
    expectedChannelSha256: hashCanonicalStringSet(c.scope.channelIds), visitedChannelSha256: hashCanonicalStringSet(c.scope.channelIds) });
  f.result.observations = [{sourceId: plan.source.id, sourceResultId: f.result.id, batchId: f.result.batchId, releaseCandidateId: f.result.releaseCandidateId,
    sourceConfigSha256: f.result.sourceConfigHash, adapterVersion: f.result.adapterVersion, observedFrom: f.result.startedAt, observedTo: f.result.finishedAt,
    crawledAt: new Date(AMGEN_TIME), successful: true, transportSucceeded: true, adapterSucceeded: true, completenessVerified: true, atomicCommitSucceeded: true,
    canonicalRawSha256: c.pagination.canonicalRawOfficialIdSetSha256, canonicalOutputSha256: c.output.canonicalJobSetSha256, paginationTraceSha256: c.pagination.paginationTraceSha256}];
  const jobs = crawl.jobs.map(record => ({...helper.job(record.sourceJobId!, at), sourceId: plan.source.id, companyId: plan.company.id,
    dedupeKey: `${plan.source.id}:${record.sourceJobId}`, officialTitle: record.officialTitle, officialUrl: record.officialUrl, listUrl: record.listUrl,
    cities: record.cities, city: record.cities[0]!, locationRaw: record.locationRaw, officialPublishedAt: null }));
  const manifest = delta.sortJobProjectionMembers(f.members.map((m: any) => ({...m, jobProjectionSha256: delta.hashJobPersistedProjection(jobs.find(j => j.dedupeKey === m.jobKey)),
    lastConfirmedObservedAt: AMGEN_TIME, lifecycleLastSeenAt: at, lastPresentResultId: f.result.id })));
  const wrapper = { schemaVersion: delta.JOB_PROJECTION_DELTA_SCHEMA, projectionSchemaVersion: delta.JOB_PERSISTED_PROJECTION_SCHEMA,
    binding: { releaseCandidateId: f.result.releaseCandidateId, batchId: f.result.batchId, sourceId: plan.source.id, sourceResultId: f.result.id },
    verifiedAt: at, observedAt: AMGEN_TIME, legacyCertificate: c, legacyCertificateSha256: issued.certificateSha256, detailEvidenceState: "UNKNOWN", members: manifest, manifestSha256: delta.hashDeltaManifest(manifest) };
  f.result.completenessCertificate = wrapper; f.result.completenessCertificateSha256 = delta.hashProjectionJson(wrapper);
  let artifactReads = 0;
  const tx = { crawlBatchSourceResult: { findMany: async () => [f.result] }, lifecycleSetEvidenceMember: {findMany: async () => f.members},
    job: {findMany: async () => jobs}, evidenceArtifact: {findMany: async () => { artifactReads++; throw Error("UNEXPECTED_ARTIFACT_READ"); }} };
  const db = { $transaction: async (operation: (tx: unknown) => unknown) => operation(tx) };
  const snapshot = await pub.readPortablePublicSnapshot(db, { currentTime: new Date(at) }, [readerPlan]);
  assert.equal(snapshot.sources[0].state, "PUBLISHING"); assert.equal(snapshot.sources[0].visibleJobCount, 13); assert.equal(artifactReads, 0);
  // Existing receipt tamper holds must still fire on each exact reader.
  f.result.completenessCertificateSha256 = "0".repeat(64);
  const corrupt = await pub.readPortablePublicSnapshot(db, { currentTime: new Date(at) }, [readerPlan]);
  assert.equal(corrupt.sources[0].state, "HOLD");
  outcomes.push({...reader, sourceConfigSha256: sp.sourcePlanConfigSha256(readerPlan), syntheticHttpCalls: fixture.requests.length, detailRetryCount: 1,
    failedResponseArtifacts: 1, certificateReceipt: receipt.status, publicState: snapshot.sources[0].state, visibleJobCount: snapshot.sources[0].visibleJobCount,
    evidenceArtifactQueries: artifactReads, rawOldReplayAcceptsNewDiagnosticGrammar: false, corruptReceiptState: corrupt.sources[0].state, separateSourceQualityPolicy: null});
}
console.log(JSON.stringify({kind: "SYNTHETIC_OFFLINE_READER_COMPATIBILITY", sourceId: plan.source.id, outcomes}, null, 2));
