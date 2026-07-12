import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadCurrentReleaseIdentity } from "../src/readiness/currentReleaseIdentity";
import { PHASE4_CONTROLLING_PLAN_PATH, serializeBlockedPhase4Manifest }
  from "../src/evidence/phase4ReleaseManifest";
import { getStartupReleaseMembership } from "../src/crawler/releaseMembershipAuthority";
import { getStartupSourceSurfaceOracle } from "../src/crawler/sourceSurfaceOracleAuthority";

const SHA256 = /^[0-9a-f]{64}$/u;
const CONTROLLING_PLAN_ENV = "PHASE4_CONTROLLING_PLAN_SHA256";

export function resolvePhase4GeneratorStartup(argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>): { controllingPlanSha256: string } {
  if (argv.length !== 2) {
    throw new Error("production Phase4 generator accepts no caller-controlled identity, artifact, or hash arguments");
  }
  const controllingPlanSha256 = env[CONTROLLING_PLAN_ENV];
  if (!controllingPlanSha256) throw new Error(`controlling-plan SHA is required via ${CONTROLLING_PLAN_ENV}`);
  if (!SHA256.test(controllingPlanSha256)) throw new Error("controlling-plan SHA must be a lowercase sha256 digest");
  return { controllingPlanSha256 };
}

export function assertControllingPlanBytesSha256(bytes: Buffer, expectedSha256: string): void {
  if (!SHA256.test(expectedSha256) || createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    throw new Error("controlling-plan SHA does not bind the exact controlling-plan bytes");
  }
}

export async function main(): Promise<void> {
  const startup = resolvePhase4GeneratorStartup(process.argv, process.env);
  const controllingPlanBytes = readFileSync(PHASE4_CONTROLLING_PLAN_PATH);
  assertControllingPlanBytesSha256(controllingPlanBytes, startup.controllingPlanSha256);
  const identity = await loadCurrentReleaseIdentity();
  const [membership, oracle] = await Promise.all([getStartupReleaseMembership(), getStartupSourceSurfaceOracle()]);
  const result = serializeBlockedPhase4Manifest({
    outputRoot: join(process.cwd(), "phase4-evidence"),
    releaseId: identity.releaseCandidateId,
    capturedAt: new Date().toISOString(),
    commitSha: identity.commitSha,
    controllingPlanSha256: startup.controllingPlanSha256,
    hashes: { sourceTree: identity.sourceTreeSha256, runtimeTree: identity.runtimeTreeSha256,
      roster: identity.rosterSha256, sourcePlan: identity.sourcePlanSha256, config: identity.sourceConfigSha256,
      adapter: identity.adapterBundleSha256, oracle: oracle.artifact.contentSha256,
      membership: membership.artifact.contentSha256 },
    trustedArtifacts: [
      { kind: "MEMBERSHIP", rawBase64: membership.rawFileBase64, rawSha256: membership.rawFileSha256,
        contentSha256: membership.artifact.contentSha256 },
      { kind: "ORACLE", rawBase64: oracle.rawFileBase64, rawSha256: oracle.rawFileSha256,
        contentSha256: oracle.artifact.contentSha256 }
    ],
    formalBatches: [],
    independentQa: []
  });
  console.log(JSON.stringify({ path: result.path, status: "BLOCKED" }));
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) await main();
