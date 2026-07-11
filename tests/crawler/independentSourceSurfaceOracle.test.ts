import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  canonicalIndependentOracleMembersSha256,
  assertSignedReviewerBinding,
  independentHopChainProvenanceRootSha256,
  independentReviewProvenanceRootSha256,
  independentOracleContentSha256,
  type IndependentSourceSurfaceOracleArtifact
} from "../../src/crawler/independentSourceSurfaceOracle";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const binding = { releaseCandidateId: "rc-1", commitSha: "1".repeat(40), rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64), sourceConfigSha256: "4".repeat(64), adapterBundleSha256: "5".repeat(64),
  authoritativeMembershipDigest: "6".repeat(64) };
const members = [{ companyId: "company-1", sourceId: "source-1", surfaceId: "surface-1",
  channelId: "channel-1", officialEntryId: "entry-1", reviewerId: "e".repeat(64),
  reviewArtifactSha256: "f".repeat(64), producerIdentity: "0".repeat(64),
  reviewerDecision: "APPROVED" as const, reviewerStatus: "INDEPENDENT" as const,
  officialEntrySha256: "7".repeat(64), officialFinalSha256: "8".repeat(64),
  officialHopChainSha256: "9".repeat(64), chinaScope: "RESOLVED" as const,
  businessUnitScope: "RESOLVED" as const, legalEntityScope: "RESOLVED" as const,
  channelScope: "RESOLVED" as const, adapterId: "official-json",
  adapterConfigSha256: "a".repeat(64), completenessEvidenceKind: "OFFICIAL_TOTAL",
  completenessEvidenceLocatorSha256: "b".repeat(64), completenessEvidenceContentSha256: "c".repeat(64),
  expectedArtifacts: [{ logicalKey: "page-0", contentSha256: "d".repeat(64) }] }];

function artifact(): IndependentSourceSurfaceOracleArtifact {
  const reviewProvenanceRootSha256 = independentReviewProvenanceRootSha256(members);
  const hopChainProvenanceRootSha256 = independentHopChainProvenanceRootSha256(members);
  const memberSetSha256 = canonicalIndependentOracleMembersSha256(members);
  const envelope = (purpose: "REVIEW" | "HOP_CHAIN", provenanceRootSha256: string) => ({ keyId: "unused-authority-fixture",
    payload: { schemaVersion: 1 as const, purpose, reviewerIdentitySha256: members[0]!.reviewerId,
      producerIdentitySha256: members[0]!.producerIdentity, provenanceRootSha256,
      authoritativeMembershipDigest: binding.authoritativeMembershipDigest, oracleMemberSetSha256: memberSetSha256 },
    signatureBase64: Buffer.alloc(64).toString("base64") });
  const base = { schemaVersion: 2 as const, kind: "FULL_RELEASE" as const, ...binding,
    reviewProvenanceRootSha256, hopChainProvenanceRootSha256, producerIdentity: members[0]!.producerIdentity,
    reviewProvenanceSignature: envelope("REVIEW", reviewProvenanceRootSha256),
    hopChainProvenanceSignature: envelope("HOP_CHAIN", hopChainProvenanceRootSha256), members, memberSetSha256 };
  return { ...base, contentSha256: independentOracleContentSha256(base) };
}

function child(script: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "--eval", script], { cwd: process.cwd(), encoding: "utf8",
    env: { ...process.env, P0_FULL_RELEASE_ORACLE_FILE: undefined,
      P0_FULL_RELEASE_ORACLE_FILE_SHA256: undefined, ...env } });
}

describe("independent source/surface oracle startup authority", () => {
  it("fails closed without startup authority and never accepts a plain or cloned artifact", () => {
    const url = pathToFileURL(resolve("src/crawler/sourceSurfaceOracleAuthority.ts")).href;
    const script = `import('${url}').then(async m=>{try{await m.getStartupSourceSurfaceOracle()}catch(e){console.log(e.message)};for(const v of [${JSON.stringify({ artifact: artifact() })},structuredClone(${JSON.stringify({ artifact: artifact() })})]){try{m.assertStartupTrustedSourceSurfaceOracle(v)}catch(e){console.log(e.message)}}})`;
    const result = child(script);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("startup source/surface oracle authority is unavailable");
    expect(result.stdout.match(/not trusted by startup authority/g)).toHaveLength(2);
  });

  it("pins original raw bytes at module initialization and rejects pre-load replacement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "independent-oracle-"));
    const originalPath = join(dir, "original.json");
    const replacementPath = join(dir, "replacement.json");
    const bytes = Buffer.from(JSON.stringify(artifact()));
    await writeFile(originalPath, bytes);
    await writeFile(replacementPath, JSON.stringify({ ...artifact(), releaseCandidateId: "replacement" }));
    const url = pathToFileURL(resolve("src/crawler/sourceSurfaceOracleAuthority.ts")).href;
    const script = `import('${url}').then(async m=>{process.env.P0_FULL_RELEASE_ORACLE_FILE=${JSON.stringify(replacementPath)};process.env.P0_FULL_RELEASE_ORACLE_FILE_SHA256='0'.repeat(64);const v=await m.getStartupSourceSurfaceOracle();console.log(v.artifact.releaseCandidateId);console.log(Object.isFrozen(v.artifact.members[0].expectedArtifacts))})`;
    const result = child(script, { P0_FULL_RELEASE_ORACLE_FILE: originalPath,
      P0_FULL_RELEASE_ORACLE_FILE_SHA256: sha(bytes.toString("utf8")) });
    await rm(dir, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("rc-1");
    expect(result.stdout).toContain("true");
  });

  it("changes the member digest for replacement, duplicate or artifact-content changes", () => {
    expect(canonicalIndependentOracleMembersSha256([{ ...members[0]!, surfaceId: "replacement" }]))
      .not.toBe(canonicalIndependentOracleMembersSha256(members));
    expect(() => canonicalIndependentOracleMembersSha256([members[0]!, { ...members[0]! }]))
      .toThrow(/Duplicate/);
    expect(canonicalIndependentOracleMembersSha256([{ ...members[0]!, expectedArtifacts: [
      { logicalKey: "page-0", contentSha256: "e".repeat(64) }] }]))
      .not.toBe(canonicalIndependentOracleMembersSha256(members));
  });
  it("rejects a signed reviewer different from members and a mixed reviewer member set", () => {
    const different = artifact();
    different.reviewProvenanceSignature.payload.reviewerIdentitySha256 = "1".repeat(64);
    expect(() => assertSignedReviewerBinding(different)).toThrow(/does not exactly bind/i);
    const mixed = artifact();
    mixed.members.push({ ...mixed.members[0]!, companyId: "company-2", reviewerId: "2".repeat(64) });
    expect(() => assertSignedReviewerBinding(mixed)).toThrow(/does not exactly bind/i);
  });

});
