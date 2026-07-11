import { canonicalIndependentOracleMembersSha256, independentHopChainProvenanceRootSha256,
  independentReviewProvenanceRootSha256, type IndependentSourceSurfaceOracleMember } from "./independentSourceSurfaceOracle";
import type { SignedProvenancePayload } from "./reviewerSignatureTrust";

interface LegacyOracle {
  schemaVersion?: 1; kind: "FULL_RELEASE"; releaseCandidateId: string; commitSha: string;
  rosterSha256: string; sourcePlanSha256: string; sourceConfigSha256: string; adapterBundleSha256: string;
  authoritativeMembershipDigest: string; producerIdentity: string; members: IndependentSourceSurfaceOracleMember[];
}
export interface UnsignedOracleV2Migration {
  schemaVersion: 2; status: "AWAITING_INDEPENDENT_SIGNATURE"; legacy: LegacyOracle;
  memberSetSha256: string; reviewProvenanceRootSha256: string; hopChainProvenanceRootSha256: string;
  reviewPayload: SignedProvenancePayload; hopChainPayload: SignedProvenancePayload;
  reviewSignature: null; hopChainSignature: null;
}

export function buildUnsignedOracleV2Migration(input: unknown): UnsignedOracleV2Migration {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Legacy oracle must be an object");
  rejectSigningMaterial(input);
  const legacy = input as LegacyOracle;
  if (legacy.schemaVersion !== undefined && legacy.schemaVersion !== 1) {
    throw new Error("Only unversioned or v1 legacy oracle artifacts can be migrated");
  }
  for (const value of [legacy.authoritativeMembershipDigest, legacy.producerIdentity]) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Legacy oracle identity must be canonical SHA-256");
  }
  if (!Array.isArray(legacy.members) || legacy.members.length === 0) throw new Error("Legacy oracle members are required");
  const memberSetSha256 = canonicalIndependentOracleMembersSha256(legacy.members);
  const reviewProvenanceRootSha256 = independentReviewProvenanceRootSha256(legacy.members);
  const hopChainProvenanceRootSha256 = independentHopChainProvenanceRootSha256(legacy.members);
  const reviewerIdentitySha256 = legacy.members[0]!.reviewerId;
  if (!legacy.members.every((member) => member.reviewerId === reviewerIdentitySha256 &&
    member.producerIdentity === legacy.producerIdentity)) throw new Error("Legacy reviewer/producer identity is inconsistent");
  const common = { schemaVersion: 1 as const, reviewerIdentitySha256,
    producerIdentitySha256: legacy.producerIdentity, authoritativeMembershipDigest: legacy.authoritativeMembershipDigest,
    oracleMemberSetSha256: memberSetSha256 };
  return { schemaVersion: 2, status: "AWAITING_INDEPENDENT_SIGNATURE", legacy: structuredClone(legacy),
    memberSetSha256, reviewProvenanceRootSha256, hopChainProvenanceRootSha256,
    reviewPayload: { ...common, purpose: "REVIEW", provenanceRootSha256: reviewProvenanceRootSha256 },
    hopChainPayload: { ...common, purpose: "HOP_CHAIN", provenanceRootSha256: hopChainProvenanceRootSha256 },
    reviewSignature: null, hopChainSignature: null };
}

function rejectSigningMaterial(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/signature|private.?key/i.test(key) || (typeof child === "string" && /BEGIN PRIVATE KEY/.test(child))) {
      throw new Error("Migration input must not contain signature or private-key material");
    }
    rejectSigningMaterial(child);
  }
}
