import { createHash } from "node:crypto";
import {
  canonicalReleaseMembersSha256,
  releaseMembershipContentSha256,
  type AuthoritativeReleaseMembershipArtifact,
  type ReleaseMember
} from "../../../src/crawler/authoritativeReleaseMembership";
import {
  canonicalIndependentCompanyAudits,
  canonicalIndependentCompanyAuditsSha256,
  canonicalIndependentOracleMembers,
  canonicalIndependentOracleMembersSha256,
  independentCoverageSetSha256,
  independentHopChainProvenanceRootSha256,
  independentOracleContentSha256,
  independentReviewProvenanceRootSha256,
  type IndependentCompanyAudit,
  type IndependentSourceSurfaceOracleArtifact,
  type IndependentSourceSurfaceOracleMember
} from "../../../src/crawler/independentSourceSurfaceOracle";
import { confirmedCompanyRosterV3 } from "../../../src/data/confirmedCompanyRosterV3";
import { canonicalPhase1InScopeRosterMembers } from "../../../src/data/phase1ScopePolicy";
import type { Phase4ReleaseManifestInput } from "../../../src/evidence/phase4ReleaseManifest";
import { signedProvenancePayloadSha256 } from "../../../src/crawler/reviewerSignatureTrust";

export const COMMIT_SHA = "1".repeat(40);
export const CONTROLLING_PLAN_SHA256 = "2".repeat(64);
export const HASHES = {
  sourceTree: "3".repeat(64), runtimeTree: "4".repeat(64), roster: confirmedCompanyRosterV3.membersSha256,
  sourcePlan: "5".repeat(64), config: "6".repeat(64), adapter: "7".repeat(64),
  oracle: "", membership: ""
};

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const reviewerId = "8".repeat(64);
const producerIdentity = "9".repeat(64);

export interface StructuralArtifacts {
  oracle: IndependentSourceSurfaceOracleArtifact;
  membership: AuthoritativeReleaseMembershipArtifact;
  trustedArtifacts: Phase4ReleaseManifestInput["trustedArtifacts"];
}

export function buildStructuralArtifacts(): StructuralArtifacts {
  const noLinkCompanyIds = new Set(canonicalPhase1InScopeRosterMembers.slice(0, 2).map(({ id }) => id));
  const audits: IndependentCompanyAudit[] = [];
  const members: IndependentSourceSurfaceOracleMember[] = [];
  for (const { id: companyId, category } of canonicalPhase1InScopeRosterMembers) {
    const noLink = noLinkCompanyIds.has(companyId);
    const officialEntryId = `entry-${companyId}`;
    audits.push({ companyId, category,
      status: noLink ? "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" : "HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME",
      capturedAt: "2026-07-12T00:00:00.000Z", officialWebsiteUrl: `https://example.com/${companyId}`,
      officialWebsiteSha256: sha(`website:${companyId}`), officialEntryIds: noLink ? [] : [officialEntryId],
      evidenceArtifacts: [{ logicalKey: `official-website/${companyId}`, contentSha256: sha(`evidence:${companyId}`) }],
      reviewerId, reviewArtifactSha256: sha(`review:${companyId}`), producerIdentity,
      reviewerDecision: "APPROVED", reviewerStatus: "INDEPENDENT" });
    if (!noLink) members.push({ companyId, category, sourceId: `source-${companyId}`,
      surfaceId: `surface-${companyId}`, channelId: `channel-${companyId}`, officialEntryId,
      reviewerId, reviewArtifactSha256: sha(`member-review:${companyId}`), producerIdentity,
      reviewerDecision: "APPROVED", reviewerStatus: "INDEPENDENT", officialEntrySha256: sha(`entry:${companyId}`),
      officialFinalSha256: sha(`final:${companyId}`), officialHopChainSha256: sha(`hop:${companyId}`),
      chinaScope: "RESOLVED", businessUnitScope: "RESOLVED", legalEntityScope: "RESOLVED", channelScope: "RESOLVED",
      adapterId: "official-json", adapterConfigSha256: sha(`config:${companyId}`), completenessEvidenceKind: "OFFICIAL_TOTAL",
      completenessEvidenceLocatorSha256: sha(`locator:${companyId}`), completenessEvidenceContentSha256: sha(`content:${companyId}`),
      expectedArtifacts: [{ logicalKey: "page-0", contentSha256: sha(`page:${companyId}`) }] });
  }
  const canonicalAudits = canonicalIndependentCompanyAudits(audits);
  const canonicalMembers = canonicalIndependentOracleMembers(members);
  const releaseMembers = canonicalMembershipMembers(canonicalMembers.map(({ companyId, category, sourceId, surfaceId, channelId }) =>
    ({ companyId, category, sourceId, surfaceId, channelId })));
  const authoritativeMembershipDigest = canonicalReleaseMembersSha256(releaseMembers);
  const companyAuditSetSha256 = canonicalIndependentCompanyAuditsSha256(canonicalAudits);
  const memberSetSha256 = canonicalIndependentOracleMembersSha256(canonicalMembers);
  const coverageSetSha256 = independentCoverageSetSha256(canonicalAudits, canonicalMembers);
  const reviewProvenanceRootSha256 = independentReviewProvenanceRootSha256(canonicalAudits, canonicalMembers);
  const hopChainProvenanceRootSha256 = independentHopChainProvenanceRootSha256(canonicalAudits, canonicalMembers);
  const binding = { releaseCandidateId: "phase4-candidate", commitSha: COMMIT_SHA,
    rosterSha256: confirmedCompanyRosterV3.membersSha256, sourcePlanSha256: HASHES.sourcePlan,
    sourceConfigSha256: HASHES.config, adapterBundleSha256: HASHES.adapter };
  const oracleBase: Omit<IndependentSourceSurfaceOracleArtifact, "contentSha256"> = {
    schemaVersion: 3, kind: "FULL_RELEASE", ...binding, authoritativeMembershipDigest,
    reviewProvenanceRootSha256, hopChainProvenanceRootSha256, producerIdentity,
    reviewProvenanceSignature: envelope("REVIEW", reviewProvenanceRootSha256, authoritativeMembershipDigest, coverageSetSha256),
    hopChainProvenanceSignature: envelope("HOP_CHAIN", hopChainProvenanceRootSha256, authoritativeMembershipDigest, coverageSetSha256),
    companyAudits: canonicalAudits, companyAuditSetSha256, members: canonicalMembers, memberSetSha256, coverageSetSha256
  };
  const oracle = { ...oracleBase, contentSha256: independentOracleContentSha256(oracleBase) };
  const oracleBytes = Buffer.from(JSON.stringify(oracle));
  const membershipBase: Omit<AuthoritativeReleaseMembershipArtifact, "contentSha256"> = {
    schemaVersion: 6, kind: "FULL_RELEASE", ...binding, sourceTreeSha256: HASHES.sourceTree,
    runtimeTreeSha256: HASHES.runtimeTree, oracleAuthority: { oracleRawFileSha256: sha(oracleBytes),
      oracleContentSha256: oracle.contentSha256, reviewProvenanceRootSha256, hopChainProvenanceRootSha256,
      reviewSignedPayloadSha256: signedProvenancePayloadSha256(oracle.reviewProvenanceSignature.payload),
      hopChainSignedPayloadSha256: signedProvenancePayloadSha256(oracle.hopChainProvenanceSignature.payload),
        reviewKeyId: oracle.reviewProvenanceSignature.keyId,
        hopChainKeyId: oracle.hopChainProvenanceSignature.keyId, producerIdentity },
    members: releaseMembers, memberSetSha256: authoritativeMembershipDigest
  };
  const membership = { ...membershipBase, contentSha256: releaseMembershipContentSha256(membershipBase) };
  return fromArtifacts(oracle, membership);
}

export function fromArtifacts(oracle: IndependentSourceSurfaceOracleArtifact,
  membership: AuthoritativeReleaseMembershipArtifact): StructuralArtifacts {
  const oracleBytes = Buffer.from(JSON.stringify(oracle));
  const membershipBytes = Buffer.from(JSON.stringify(membership));
  return { oracle, membership, trustedArtifacts: [
    { kind: "MEMBERSHIP", rawBase64: membershipBytes.toString("base64"), rawSha256: sha(membershipBytes),
      contentSha256: membership.contentSha256 },
    { kind: "ORACLE", rawBase64: oracleBytes.toString("base64"), rawSha256: sha(oracleBytes),
      contentSha256: oracle.contentSha256 }
  ] };
}

export function rebuildStructuralArtifacts(source: StructuralArtifacts,
  mutate: (value: { oracle: IndependentSourceSurfaceOracleArtifact;
    membership: AuthoritativeReleaseMembershipArtifact }) => void,
  syncMembershipProjection = true,
  preserveRawOracleMembers = false): StructuralArtifacts {
  const value = structuredClone({ oracle: source.oracle, membership: source.membership });
  mutate(value);
  value.oracle.companyAudits = canonicalIndependentCompanyAudits(value.oracle.companyAudits);
  const rawOracleMembers = value.oracle.members;
  const canonicalOracleMembers = canonicalIndependentOracleMembers(rawOracleMembers);
  value.oracle.members = preserveRawOracleMembers ? rawOracleMembers : canonicalOracleMembers;
  if (syncMembershipProjection) {
    value.membership.members = canonicalMembershipMembers(canonicalOracleMembers.map(({ companyId, category, sourceId,
      surfaceId, channelId }) => ({ companyId, category, sourceId, surfaceId, channelId })));
  } else {
    value.membership.members = canonicalMembershipMembers(value.membership.members);
  }
  value.membership.memberSetSha256 = canonicalReleaseMembersSha256(value.membership.members);
  value.oracle.authoritativeMembershipDigest = value.membership.memberSetSha256;
  value.oracle.companyAuditSetSha256 = canonicalIndependentCompanyAuditsSha256(value.oracle.companyAudits);
  value.oracle.memberSetSha256 = canonicalIndependentOracleMembersSha256(value.oracle.members);
  value.oracle.coverageSetSha256 = independentCoverageSetSha256(value.oracle.companyAudits, value.oracle.members);
  value.oracle.reviewProvenanceRootSha256 = independentReviewProvenanceRootSha256(value.oracle.companyAudits,
    value.oracle.members);
  value.oracle.hopChainProvenanceRootSha256 = independentHopChainProvenanceRootSha256(value.oracle.companyAudits,
    value.oracle.members);
  value.oracle.reviewProvenanceSignature.payload.provenanceRootSha256 = value.oracle.reviewProvenanceRootSha256;
  value.oracle.reviewProvenanceSignature.payload.authoritativeMembershipDigest = value.oracle.authoritativeMembershipDigest;
  value.oracle.reviewProvenanceSignature.payload.oracleMemberSetSha256 = value.oracle.coverageSetSha256;
  value.oracle.hopChainProvenanceSignature.payload.provenanceRootSha256 = value.oracle.hopChainProvenanceRootSha256;
  value.oracle.hopChainProvenanceSignature.payload.authoritativeMembershipDigest = value.oracle.authoritativeMembershipDigest;
  value.oracle.hopChainProvenanceSignature.payload.oracleMemberSetSha256 = value.oracle.coverageSetSha256;
  value.membership.oracleAuthority.reviewSignedPayloadSha256 =
    signedProvenancePayloadSha256(value.oracle.reviewProvenanceSignature.payload);
  value.membership.oracleAuthority.hopChainSignedPayloadSha256 =
    signedProvenancePayloadSha256(value.oracle.hopChainProvenanceSignature.payload);
  const { contentSha256: _oldOracleContent, ...oracleBase } = value.oracle;
  value.oracle.contentSha256 = independentOracleContentSha256(oracleBase);
  const oracleBytes = Buffer.from(JSON.stringify(value.oracle));
  value.membership.oracleAuthority.oracleRawFileSha256 = sha(oracleBytes);
  value.membership.oracleAuthority.oracleContentSha256 = value.oracle.contentSha256;
  value.membership.oracleAuthority.reviewProvenanceRootSha256 = value.oracle.reviewProvenanceRootSha256;
  value.membership.oracleAuthority.hopChainProvenanceRootSha256 = value.oracle.hopChainProvenanceRootSha256;
  const { contentSha256: _oldMembershipContent, ...membershipBase } = value.membership;
  value.membership.contentSha256 = releaseMembershipContentSha256(membershipBase);
  return fromArtifacts(value.oracle, value.membership);
}

export function rebindOuterArtifacts(source: StructuralArtifacts,
  mutate: (value: { oracle: IndependentSourceSurfaceOracleArtifact;
    membership: AuthoritativeReleaseMembershipArtifact }) => void): StructuralArtifacts {
  const value = structuredClone({ oracle: source.oracle, membership: source.membership });
  mutate(value);
  const { contentSha256: _oldOracleContent, ...oracleBase } = value.oracle;
  value.oracle.contentSha256 = independentOracleContentSha256(oracleBase);
  const oracleBytes = Buffer.from(JSON.stringify(value.oracle));
  value.membership.oracleAuthority.oracleRawFileSha256 = sha(oracleBytes);
  value.membership.oracleAuthority.oracleContentSha256 = value.oracle.contentSha256;
  const { contentSha256: _oldMembershipContent, ...membershipBase } = value.membership;
  value.membership.contentSha256 = releaseMembershipContentSha256(membershipBase);
  return fromArtifacts(value.oracle, value.membership);
}

export function manifestInput(outputRoot: string, artifacts = buildStructuralArtifacts()): Phase4ReleaseManifestInput {
  return { outputRoot, releaseId: "phase4-candidate", capturedAt: "2026-07-12T02:00:00.000Z",
    commitSha: COMMIT_SHA, controllingPlanSha256: CONTROLLING_PLAN_SHA256,
    hashes: { ...HASHES, oracle: artifacts.oracle.contentSha256, membership: artifacts.membership.contentSha256 },
    trustedArtifacts: artifacts.trustedArtifacts, formalBatches: [], independentQa: [] };
}

function envelope(purpose: "REVIEW" | "HOP_CHAIN", provenanceRootSha256: string,
  authoritativeMembershipDigest: string, coverageSetSha256: string) {
  return { keyId: `${purpose.toLowerCase()}-key`, payload: { schemaVersion: 1 as const, purpose,
    reviewerIdentitySha256: reviewerId, producerIdentitySha256: producerIdentity, provenanceRootSha256,
    authoritativeMembershipDigest, oracleMemberSetSha256: coverageSetSha256 },
  signatureBase64: Buffer.alloc(64).toString("base64") };
}

function canonicalMembershipMembers(members: ReleaseMember[]): ReleaseMember[] {
  return [...members].sort((a, b) => Buffer.compare(frameMember(a), frameMember(b)));
}

function frameMember(member: ReleaseMember): Buffer {
  return frameStrings([member.companyId, member.sourceId, member.surfaceId, member.channelId, member.category]);
}

function frameStrings(values: string[]): Buffer {
  const chunks = values.map((value) => Buffer.from(value, "utf8"));
  return Buffer.concat([u32(chunks.length), ...chunks.map((chunk) => Buffer.concat([u32(chunk.length), chunk]))]);
}

function u32(value: number): Buffer { const out = Buffer.allocUnsafe(4); out.writeUInt32BE(value); return out; }
