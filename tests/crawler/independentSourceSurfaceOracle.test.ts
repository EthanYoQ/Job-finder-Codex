import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  canonicalIndependentOracleMembersSha256,
  canonicalIndependentCompanyAuditsSha256,
  assertSignedReviewerBinding,
  independentCoverageSetSha256,
  independentHopChainProvenanceRootSha256,
  independentReviewProvenanceRootSha256,
  independentOracleContentSha256,
  validateIndependentSourceSurfaceOracleArtifactContent,
  type IndependentSourceSurfaceOracleArtifact
} from "../../src/crawler/independentSourceSurfaceOracle";
import { canonicalReleaseMembersSha256, releaseMembershipContentSha256 } from "../../src/crawler/authoritativeReleaseMembership";
import { signedProvenancePayloadSha256 } from "../../src/crawler/reviewerSignatureTrust";
import { confirmedCompanyRosterV3, confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const binding = { releaseCandidateId: "rc-1", commitSha: "1".repeat(40), rosterSha256: confirmedCompanyRosterV3.membersSha256,
  sourcePlanSha256: "3".repeat(64), sourceConfigSha256: "4".repeat(64), adapterBundleSha256: "5".repeat(64),
  authoritativeMembershipDigest: "6".repeat(64) };
const first=confirmedCompanyRosterV3Members[0]!;
const members = [{ companyId: first.id, category:first.category, sourceId: "source-1", surfaceId: "surface-1",
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
const companyAudits=confirmedCompanyRosterV3Members.map(({id:companyId,category})=>({companyId,category,
  status:(companyId===first.id?"HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME":"NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME") as "HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME"|"NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME",
  capturedAt:"2026-07-12T00:00:00.000Z",officialWebsiteUrl:`https://example.com/${companyId}`,
  officialWebsiteSha256:sha(`website:${companyId}`),officialEntryIds:companyId===first.id?["entry-1"]:[],
  evidenceArtifacts:[{logicalKey:`website/${companyId}`,contentSha256:sha(`evidence:${companyId}`)}],
  reviewerId:"e".repeat(64),reviewArtifactSha256:sha(`review:${companyId}`),producerIdentity:"0".repeat(64),
  reviewerDecision:"APPROVED" as const,reviewerStatus:"INDEPENDENT" as const}));

function artifact(): IndependentSourceSurfaceOracleArtifact {
  const reviewProvenanceRootSha256 = independentReviewProvenanceRootSha256(companyAudits,members);
  const hopChainProvenanceRootSha256 = independentHopChainProvenanceRootSha256(companyAudits,members);
  const memberSetSha256 = canonicalIndependentOracleMembersSha256(members);
  const companyAuditSetSha256=canonicalIndependentCompanyAuditsSha256(companyAudits);
  const coverageSetSha256=independentCoverageSetSha256(companyAudits,members);
  const envelope = (purpose: "REVIEW" | "HOP_CHAIN", provenanceRootSha256: string) => ({ keyId: "unused-authority-fixture",
    payload: { schemaVersion: 1 as const, purpose, reviewerIdentitySha256: members[0]!.reviewerId,
      producerIdentitySha256: members[0]!.producerIdentity, provenanceRootSha256,
      authoritativeMembershipDigest: binding.authoritativeMembershipDigest, oracleMemberSetSha256: coverageSetSha256 },
    signatureBase64: Buffer.alloc(64).toString("base64") });
  const base = { schemaVersion: 3 as const, kind: "FULL_RELEASE" as const, ...binding,
    reviewProvenanceRootSha256, hopChainProvenanceRootSha256, producerIdentity: members[0]!.producerIdentity,
    reviewProvenanceSignature: envelope("REVIEW", reviewProvenanceRootSha256),
    hopChainProvenanceSignature: envelope("HOP_CHAIN", hopChainProvenanceRootSha256),companyAudits,companyAuditSetSha256,
    members,memberSetSha256,coverageSetSha256 };
  return { ...base, contentSha256: independentOracleContentSha256(base) };
}

function child(script: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "--eval", script], { cwd: process.cwd(), encoding: "utf8",
    env: { ...process.env, P0_FULL_RELEASE_ORACLE_FILE: undefined,
      P0_FULL_RELEASE_ORACLE_FILE_SHA256: undefined, ...env } });
}

describe("independent source/surface oracle startup authority", () => {
  it("exposes a pure full-content/root validator for monitoring",()=>{
    expect(validateIndependentSourceSurfaceOracleArtifactContent(artifact(),new Date("2026-07-12T12:00:00Z"))).toMatchObject({members});
    const tampered=structuredClone(artifact());tampered.members[0]!.expectedArtifacts[0]!.contentSha256="0".repeat(64);
    expect(()=>validateIndependentSourceSurfaceOracleArtifactContent(tampered,new Date("2026-07-12T12:00:00Z")))
      .toThrow(/set hash|content|provenance/i);
  });
  it("rejects a trusted schema-v2 artifact at the runtime validator boundary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "independent-oracle-v2-runtime-"));
    const current = artifact();
    const {companyAudits:_companyAudits,companyAuditSetSha256:_auditSet,coverageSetSha256:_coverage,...v2}=current;
    const oracle = { ...v2, schemaVersion: 2 } as unknown as IndependentSourceSurfaceOracleArtifact;
    const oracleBytes = Buffer.from(JSON.stringify(oracle));
    const oraclePath = join(dir, "oracle.json");
    await writeFile(oraclePath, oracleBytes);
    const releaseMembers = members.map(({ companyId, sourceId, surfaceId, channelId }) =>
      ({ companyId, sourceId, surfaceId, channelId, category: "FOREIGN_PHARMA" as const }));
    const memberSetSha256 = canonicalReleaseMembersSha256(releaseMembers);
    const membershipBase = { schemaVersion: 6 as const, kind: "FULL_RELEASE" as const, ...binding,
      sourceTreeSha256: "a".repeat(64), runtimeTreeSha256: "b".repeat(64),
      oracleAuthority: { oracleRawFileSha256: sha(oracleBytes.toString("utf8")),
        oracleContentSha256: oracle.contentSha256,
        reviewProvenanceRootSha256: oracle.reviewProvenanceRootSha256,
        hopChainProvenanceRootSha256: oracle.hopChainProvenanceRootSha256,
        reviewSignedPayloadSha256: signedProvenancePayloadSha256(oracle.reviewProvenanceSignature.payload),
        hopChainSignedPayloadSha256: signedProvenancePayloadSha256(oracle.hopChainProvenanceSignature.payload),
        reviewKeyId: oracle.reviewProvenanceSignature.keyId,
        hopChainKeyId: oracle.hopChainProvenanceSignature.keyId,
        producerIdentity: oracle.producerIdentity }, members: releaseMembers, memberSetSha256 };
    const membership = { ...membershipBase, contentSha256: releaseMembershipContentSha256(membershipBase) };
    const membershipBytes = Buffer.from(JSON.stringify(membership));
    const membershipPath = join(dir, "membership.json");
    await writeFile(membershipPath, membershipBytes);
    const oracleAuthorityUrl = pathToFileURL(resolve("src/crawler/sourceSurfaceOracleAuthority.ts")).href;
    const membershipAuthorityUrl = pathToFileURL(resolve("src/crawler/releaseMembershipAuthority.ts")).href;
    const validatorUrl = pathToFileURL(resolve("src/crawler/independentSourceSurfaceOracle.ts")).href;
    const script = `Promise.all([import('${oracleAuthorityUrl}'),import('${membershipAuthorityUrl}'),import('${validatorUrl}')]).then(async([o,m,v])=>{try{v.validateIndependentSourceSurfaceOracle(await o.getStartupSourceSurfaceOracle(),await m.getStartupReleaseMembership(),${JSON.stringify({ ...binding, batchKind: "FULL_RELEASE", ownerId: "test", expectedPlannedSourceIds: ["source-1"], expectedPlannedSourceSetSha256: "0".repeat(64), expectedPlannedSourceCount: 1 })},[],new Date('2026-07-12T12:00:00.000Z'))}catch(e){console.log(e.message)}})`;
    const result = child(script, { P0_FULL_RELEASE_ORACLE_FILE: oraclePath,
      P0_FULL_RELEASE_ORACLE_FILE_SHA256: sha(oracleBytes.toString("utf8")),
      P0_FULL_RELEASE_MEMBERSHIP_FILE: membershipPath,
      P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256: sha(membershipBytes.toString("utf8")) });
    await rm(dir, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Unsupported independent oracle schema version/);
  });
  it("fails closed without startup authority and never accepts a plain or cloned artifact", () => {
    const url = pathToFileURL(resolve("src/crawler/sourceSurfaceOracleAuthority.ts")).href;
    const untrusted={artifact:{schemaVersion:3}};
    const script = `import('${url}').then(async m=>{try{await m.getStartupSourceSurfaceOracle()}catch(e){console.log(e.message)};for(const v of [${JSON.stringify(untrusted)},structuredClone(${JSON.stringify(untrusted)})]){try{m.assertStartupTrustedSourceSurfaceOracle(v)}catch(e){console.log(e.message)}}})`;
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
