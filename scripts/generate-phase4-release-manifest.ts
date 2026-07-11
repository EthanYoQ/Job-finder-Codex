import { join } from "node:path";
import { loadCurrentReleaseIdentity } from "../src/readiness/currentReleaseIdentity";
import { serializeBlockedPhase4Manifest } from "../src/evidence/phase4ReleaseManifest";
import { getStartupReleaseMembership } from "../src/crawler/releaseMembershipAuthority";
import { getStartupSourceSurfaceOracle } from "../src/crawler/sourceSurfaceOracleAuthority";

if (process.argv.length !== 2) throw new Error("production Phase4 generator accepts no caller-controlled identity or artifact arguments");
const identity = await loadCurrentReleaseIdentity();
const [membership, oracle] = await Promise.all([getStartupReleaseMembership(), getStartupSourceSurfaceOracle()]);
const capturedAt = new Date().toISOString();
const sha = identity.sourceTreeSha256;
const result = serializeBlockedPhase4Manifest({
  outputRoot: join(process.cwd(), "phase4-evidence"),
  releaseId: identity.releaseCandidateId,
  capturedAt,
  commitSha: identity.commitSha,
  hashes: { sourceTree: identity.sourceTreeSha256, runtimeTree: identity.runtimeTreeSha256,
    roster: identity.rosterSha256, plan: identity.sourcePlanSha256, config: identity.sourceConfigSha256,
    adapter: identity.adapterBundleSha256, oracle: oracle.artifact.contentSha256, membership: membership.artifact.contentSha256 },
  trustedArtifacts: [
    { kind:"MEMBERSHIP",rawBase64:membership.rawFileBase64,rawSha256:membership.rawFileSha256,contentSha256:membership.artifact.contentSha256 },
    { kind:"ORACLE",rawBase64:oracle.rawFileBase64,rawSha256:oracle.rawFileSha256,contentSha256:oracle.artifact.contentSha256 }
  ], formalBatches: [], independentQa: []
});
console.log(JSON.stringify({ path: result.path, status: "BLOCKED" }));
