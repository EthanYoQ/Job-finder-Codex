import { createHash, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { canonicalReleaseMembersSha256, releaseMembershipContentSha256 } from "../../../src/crawler/authoritativeReleaseMembership";
import { canonicalIndependentOracleMembersSha256, independentHopChainProvenanceRootSha256,
  independentOracleContentSha256, independentOracleValueSha256, independentReviewProvenanceRootSha256,
  sourcePlanOracleConfigSha256 } from "../../../src/crawler/independentSourceSurfaceOracle";
import { expectedChannelSetHash, type SourceCrawlPlan } from "../../../src/crawler/sourcePlan";
import { canonicalSignedProvenancePayload, signedProvenancePayloadSha256,
  type SignedProvenancePayload } from "../../../src/crawler/reviewerSignatureTrust";
import { createReviewerTestKeyPair } from "../../support/reviewerSignatureTestKeys";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const channelId = "source:source-1:default";
export const plan = { adapterId: "official-json", company: { id: "company-1", officialChineseName: "公司",category:"FOREIGN_PHARMA" },
  source: { id: "source-1", companyId: "company-1", kind: "SOCIAL", atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE", surfaceId: "surface-1", officialEntryUrl: "https://example.com/jobs",
    officialChainEvidenceUrl: "https://example.com/careers" },
  json: { jobsPath: "jobs", fields: { sourceJobId: "id", officialTitle: "title", officialUrl: "url", locationRaw: "location" } },
  expectedChannels: [{ channelId, kind: "SOCIAL" }],
  expectedChannelSetHash: expectedChannelSetHash([{ channelId, kind: "SOCIAL" }]) } satisfies SourceCrawlPlan;
const expectedIds = [plan.source.id];
export const identity = { releaseCandidateId: "rc-integration", commitSha: "1".repeat(40), rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64), sourceConfigSha256: "4".repeat(64), adapterBundleSha256: "5".repeat(64),
  batchKind: "FULL_RELEASE" as const, ownerId: "integration", expectedPlannedSourceIds: expectedIds,
  expectedPlannedSourceSetSha256: sha(JSON.stringify(expectedIds)), expectedPlannedSourceCount: 1 };

export async function runFullReleaseOracleProductionScenario(mode: "invalid-command" | "invalid-batch" | "self-derived-command" | "known-test-key-command") {
  const testReviewerPrivateKey = createReviewerTestKeyPair().privateKey;
  const rogueReviewerPrivateKey = createReviewerTestKeyPair().privateKey;
  const dir = await mkdtemp(join(tmpdir(), "full-release-oracle-integration-"));
  try {
    const body = JSON.stringify({ jobs: [{ id: "1", title: "Role", url: "https://example.com/jobs/1", location: "上海" }] });
    const releaseMembers = [{ companyId: plan.company.id, sourceId: plan.source.id,
      surfaceId: plan.source.surfaceId!, channelId,category:"FOREIGN_PHARMA" as const }];
    const membershipDigest = canonicalReleaseMembersSha256(releaseMembers);
    const oracleMembers = [{ companyId: plan.company.id, sourceId: plan.source.id, surfaceId: plan.source.surfaceId!, channelId,
      officialEntryId: "entry-1", reviewerId: "6".repeat(64), reviewArtifactSha256: "7".repeat(64),
      producerIdentity: mode === "self-derived-command" ? sha(identity.commitSha) :
        mode === "known-test-key-command" ? sha('{"name":"integration","version":"1"}') : "8".repeat(64),
      reviewerDecision: "APPROVED" as const,
      reviewerStatus: "INDEPENDENT" as const, officialEntrySha256: independentOracleValueSha256(plan.source.officialEntryUrl),
      officialFinalSha256: independentOracleValueSha256(plan.source.officialChainEvidenceUrl), officialHopChainSha256: "9".repeat(64),
      chinaScope: "RESOLVED" as const, businessUnitScope: "RESOLVED" as const, legalEntityScope: "RESOLVED" as const,
      channelScope: "RESOLVED" as const, adapterId: plan.adapterId, adapterConfigSha256: sourcePlanOracleConfigSha256(plan),
      completenessEvidenceKind: "OFFICIAL_TOTAL_PAGES", completenessEvidenceLocatorSha256: independentOracleValueSha256("json:total"),
      completenessEvidenceContentSha256: sha(body), expectedArtifacts: [{ logicalKey: "page-0", contentSha256: sha(body) }] }];
    const reviewRoot = independentReviewProvenanceRootSha256(oracleMembers);
    const hopRoot = independentHopChainProvenanceRootSha256(oracleMembers);
    const memberSetSha256 = canonicalIndependentOracleMembersSha256(oracleMembers);
    const envelope = (purpose: "REVIEW" | "HOP_CHAIN", provenanceRootSha256: string) => {
      const payload: SignedProvenancePayload = { schemaVersion: 1, purpose,
        reviewerIdentitySha256: oracleMembers[0]!.reviewerId, producerIdentitySha256: oracleMembers[0]!.producerIdentity,
        provenanceRootSha256, authoritativeMembershipDigest: membershipDigest, oracleMemberSetSha256: memberSetSha256 };
      const selfDerived = mode === "self-derived-command";
      return { keyId: selfDerived ? "self-derived-key" : "p0-independent-reviewer-test-2026-01", payload,
        signatureBase64: sign(null, canonicalSignedProvenancePayload(payload), selfDerived ? rogueReviewerPrivateKey : testReviewerPrivateKey).toString("base64") };
    };
    const reviewProvenanceSignature = envelope("REVIEW", reviewRoot);
    const hopChainProvenanceSignature = envelope("HOP_CHAIN", hopRoot);
    const oracleBase = { schemaVersion: 2 as const, kind: "FULL_RELEASE" as const,
      releaseCandidateId: identity.releaseCandidateId, commitSha: identity.commitSha, rosterSha256: identity.rosterSha256,
      sourcePlanSha256: identity.sourcePlanSha256, sourceConfigSha256: identity.sourceConfigSha256,
      adapterBundleSha256: identity.adapterBundleSha256, authoritativeMembershipDigest: membershipDigest,
      reviewProvenanceRootSha256: reviewRoot, hopChainProvenanceRootSha256: hopRoot,
      producerIdentity: oracleMembers[0]!.producerIdentity, reviewProvenanceSignature,
      hopChainProvenanceSignature, members: oracleMembers, memberSetSha256 };
    const oracle = { ...oracleBase, contentSha256: independentOracleContentSha256(oracleBase) };
    const oracleBytes = Buffer.from(JSON.stringify(oracle)); const oracleFile = join(dir, "oracle.json"); await writeFile(oracleFile, oracleBytes);
    const membershipBase = { schemaVersion: 6 as const, kind: "FULL_RELEASE" as const,sourceTreeSha256:"a".repeat(64),runtimeTreeSha256:"b".repeat(64),
      releaseCandidateId: identity.releaseCandidateId, commitSha: identity.commitSha, rosterSha256: identity.rosterSha256,
      sourcePlanSha256: identity.sourcePlanSha256, sourceConfigSha256: identity.sourceConfigSha256,
      adapterBundleSha256: identity.adapterBundleSha256,
      oracleAuthority: { oracleRawFileSha256: mode === "self-derived-command" ||
        mode === "known-test-key-command" ? sha(oracleBytes) : "0".repeat(64),
        oracleContentSha256: oracle.contentSha256, reviewProvenanceRootSha256: oracle.reviewProvenanceRootSha256,
        hopChainProvenanceRootSha256: oracle.hopChainProvenanceRootSha256,
        reviewSignedPayloadSha256: signedProvenancePayloadSha256(reviewProvenanceSignature.payload),
        hopChainSignedPayloadSha256: signedProvenancePayloadSha256(hopChainProvenanceSignature.payload),
        reviewKeyId: reviewProvenanceSignature.keyId, hopChainKeyId: hopChainProvenanceSignature.keyId,
        producerIdentity: oracle.producerIdentity },
      members: releaseMembers, memberSetSha256: membershipDigest };
    const membership = { ...membershipBase, contentSha256: releaseMembershipContentSha256(membershipBase) };
    const membershipBytes = Buffer.from(JSON.stringify(membership)); const membershipFile = join(dir, "membership.json");
    await writeFile(membershipFile, membershipBytes);
    const helperUrl = pathToFileURL(resolve("tests/crawler/helpers/fullReleaseOracleProductionScenario.ts")).href;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--eval",
      `import('${helperUrl}').then(m=>m.executeFullReleaseScenario(${JSON.stringify(mode)},${JSON.stringify(dir)})).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exit(9)})`],
      { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, P0_FULL_RELEASE_MEMBERSHIP_FILE: membershipFile,
        P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256: sha(membershipBytes), P0_FULL_RELEASE_ORACLE_FILE: oracleFile,
        P0_FULL_RELEASE_ORACLE_FILE_SHA256: sha(oracleBytes) } });
    const parsed = child.stdout.trim() ? JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!) : {};
    return { status: child.status, ...parsed };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function executeFullReleaseScenario(mode: string, workspaceRoot: string) {
  const [{ runP0CrawlCommand }, { runP0CrawlBatch }, { evaluatePaginationEvidence }] = await Promise.all([
    import("../../../src/crawler/p0CrawlCommand"), import("../../../src/crawler/runCrawlBatch"),
    import("../../../src/crawler/paginationEvidence")]);
  const calls = { syncCalls: 0, transactionCalls: 0, batchCreates: 0, atomicTerminalUpdates: 0, completenessVerified: 0 };
  const model = { create: async () => undefined };
  const tx = { crawlBatch: { create: async () => { calls.batchCreates += 1; } },
    crawlBatchSourceResult: { create: async () => undefined, updateMany: async () => { calls.atomicTerminalUpdates += 1; return { count: 1 }; } },
    evidenceArtifact: model, paginationEvidence: model, lossLedgerEntry: model, transportAttemptEvidence: model,
    transportAttemptArtifact: model, crawlObservation: model, job: { upsert: async () => undefined }, lifecycleSetEvidenceMember: model };
  const db = { createBatchId: () => "batch-1", $transaction: async <T>(fn: (v: typeof tx) => Promise<T>) => {
    calls.transactionCalls += 1; return fn(tx); }, crawlBatch: { update: async (args: any) => {
      calls.completenessVerified = args.data.completenessVerifiedCount; } } };
  const body = JSON.stringify({ jobs: [{ id: "1", title: "Role", url: "https://example.com/jobs/1", location: "上海" }] });
  const evidence: any = { captureTool: { name: "integration", version: "1" }, artifacts: [{ id: "page-0", logicalKey: "page-0",
    kind: "PAGINATION_PAGE", channelId, requestedUrl: "https://example.com/api", finalUrl: "https://example.com/api",
    httpStatus: 200, contentType: "application/json", capturedAt: "2026-07-12T00:00:00Z", body, extractorLocator: "json:total" }],
    pages: [{ sequence: 0, artifactLogicalKey: "page-0", channelId, requestedPage: 1, returnedPage: 1,
      requestedPageSize: 1, returnedPageSize: 1, rawJobIds: ["1"], validJobIds: ["1"], declaredTotal: 1,
      declaredCount: 1, declaredPages: 1, responseFingerprintSha256: sha(body), termination: "DECLARED_TOTAL_REACHED",
      anomalyCodes: [], capturedAt: "2026-07-12T00:00:00Z" }],
    declaredCompleteness: { kind: "OFFICIAL_TOTAL_PAGES", value: 1, artifactLogicalKey: "page-0",
      extractorLocator: "json:total", scope: "CHANNEL", channelId },
    fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: [] };
  const evaluation = evaluatePaginationEvidence({ evidence, expectedChannelIds: [channelId], filteredOutput: true });
  const fetch = async () => ({ ok: true as const, capturedAt: "2026-07-12T00:00:00Z", payload: JSON.parse(body),
    fetchEvidence: evidence, paginationEvaluation: evaluation });
  const runtime = { getPreviousJobs: async () => [], getRecentObservations: async () => [], isBaselineCompleted: async () => true,
    workspaceRoot };
  try {
    if (mode === "invalid-batch") await runP0CrawlBatch([plan], { db: db as never, fetch, now: new Date(), identity,
      ...runtime } as never);
    else await runP0CrawlCommand({ plans: [plan], companies: [] as never, options: { help: false, sourceIds: [] }, identity,
      db: db as never, fetch, now: new Date(), syncPlannedSourcesToDb: async () => { calls.syncCalls += 1;
        return { companyCount: 0, sourceCount: 0, hiddenUnplannedVisibleJobCount: 0 }; },
      createRuntimeDeps: () => runtime, runP0CrawlBatch } as never);
    return { ...calls, rejected: false };
  } catch (error) { return { ...calls, rejected: true, error: error instanceof Error ? error.message : String(error) }; }
}
