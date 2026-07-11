import { createHash, timingSafeEqual } from "node:crypto";
import type { RuntimeBatchIdentity } from "./runtimeBatchIdentity";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { ArchivedEvidenceArtifact } from "./artifactArchive";
import type { PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { canonicalReleaseMembersSha256, releaseMembersFromPlans } from "./authoritativeReleaseMembership";
import { assertStartupTrustedReleaseMembership, type StartupTrustedReleaseMembership } from "./releaseMembershipAuthority";
import { signedProvenancePayloadSha256, verifyProductionProvenanceSignature,
  type SignedProvenanceEnvelope } from "./reviewerSignatureTrust";
import { assertStartupTrustedSourceSurfaceOracle,
  type StartupTrustedSourceSurfaceOracle } from "./sourceSurfaceOracleAuthority";

export interface IndependentOracleExpectedArtifact { logicalKey: string; contentSha256: string }
export interface IndependentSourceSurfaceOracleMember {
  companyId: string; sourceId: string; surfaceId: string; channelId: string; officialEntryId: string;
  reviewerId: string; reviewArtifactSha256: string; producerIdentity: string;
  reviewerDecision: "APPROVED"; reviewerStatus: "INDEPENDENT";
  officialEntrySha256: string; officialFinalSha256: string; officialHopChainSha256: string;
  chinaScope: "RESOLVED"; businessUnitScope: "RESOLVED"; legalEntityScope: "RESOLVED";
  channelScope: "RESOLVED"; adapterId: string; adapterConfigSha256: string;
  completenessEvidenceKind: string; completenessEvidenceLocatorSha256: string;
  completenessEvidenceContentSha256: string; expectedArtifacts: IndependentOracleExpectedArtifact[];
}
export interface IndependentSourceSurfaceOracleArtifact {
  schemaVersion: 2;
  kind: "FULL_RELEASE";
  releaseCandidateId: string; commitSha: string; rosterSha256: string; sourcePlanSha256: string;
  sourceConfigSha256: string; adapterBundleSha256: string; authoritativeMembershipDigest: string;
  reviewProvenanceRootSha256: string; hopChainProvenanceRootSha256: string; producerIdentity: string;
  reviewProvenanceSignature: SignedProvenanceEnvelope; hopChainProvenanceSignature: SignedProvenanceEnvelope;
  members: IndependentSourceSurfaceOracleMember[]; memberSetSha256: string; contentSha256: string;
}

const bindingFields = ["releaseCandidateId", "commitSha", "rosterSha256", "sourcePlanSha256",
  "sourceConfigSha256", "adapterBundleSha256"] as const;

export function canonicalIndependentOracleMembersSha256(
  members: readonly IndependentSourceSurfaceOracleMember[]): string {
  const canonical = canonicalMembers(members);
  return digest(canonicalJson(canonical));
}

export function independentOracleContentSha256(
  artifact: Omit<IndependentSourceSurfaceOracleArtifact, "contentSha256">): string {
  return digest(canonicalJson({ ...artifact, members: canonicalMembers(artifact.members) }));
}

export function independentReviewProvenanceRootSha256(members: readonly IndependentSourceSurfaceOracleMember[]): string {
  return framedRecordsSha256(canonicalMembers(members).map((member) => [member.companyId,
    member.sourceId, member.surfaceId, member.channelId, member.reviewerId,
    member.reviewArtifactSha256, member.producerIdentity]));
}
export function independentHopChainProvenanceRootSha256(members: readonly IndependentSourceSurfaceOracleMember[]): string {
  return framedRecordsSha256(canonicalMembers(members).map((member) => [member.companyId,
    member.sourceId, member.surfaceId, member.channelId, member.officialHopChainSha256,
    member.producerIdentity]));
}

export function sourcePlanOracleConfigSha256(plan: SourceCrawlPlan): string { return digest(canonicalJson(plan)); }
export function independentOracleValueSha256(value: string): string { return digest(value); }

export function validateIndependentSourceSurfaceOracle(
  trusted: StartupTrustedSourceSurfaceOracle | undefined,
  membership: StartupTrustedReleaseMembership | undefined,
  identity: RuntimeBatchIdentity,
  plans: readonly SourceCrawlPlan[]
): StartupTrustedSourceSurfaceOracle {
  assertStartupTrustedSourceSurfaceOracle(trusted);
  assertStartupTrustedReleaseMembership(membership);
  const artifact = trusted.artifact;
  if (artifact.schemaVersion !== 2) throw new Error("Unsupported independent oracle schema version");
  for (const field of bindingFields) {
    if (artifact[field] !== identity[field]) throw new Error(`Independent oracle identity mismatch: ${field}`);
  }
  if (!safeHexEqual(artifact.authoritativeMembershipDigest, membership.artifact.memberSetSha256)) {
    throw new Error("Independent oracle authoritative membership digest mismatch");
  }
  const authority = membership.artifact.oracleAuthority;
  if (!safeHexEqual(authority.oracleRawFileSha256, trusted.rawFileSha256) ||
      !safeHexEqual(authority.oracleContentSha256, artifact.contentSha256) ||
      !safeHexEqual(authority.reviewProvenanceRootSha256, artifact.reviewProvenanceRootSha256) ||
      !safeHexEqual(authority.hopChainProvenanceRootSha256, artifact.hopChainProvenanceRootSha256) ||
      authority.producerIdentity !== artifact.producerIdentity ||
      authority.reviewKeyId !== artifact.reviewProvenanceSignature.keyId ||
      authority.hopChainKeyId !== artifact.hopChainProvenanceSignature.keyId ||
      !safeHexEqual(authority.reviewSignedPayloadSha256,
        signedProvenancePayloadSha256(artifact.reviewProvenanceSignature.payload)) ||
      !safeHexEqual(authority.hopChainSignedPayloadSha256,
        signedProvenancePayloadSha256(artifact.hopChainProvenanceSignature.payload))) {
    throw new Error("Independent oracle is not pre-pinned by membership authority");
  }
  const canonical = canonicalMembers(artifact.members);
  if (canonicalJson(canonical) !== canonicalJson(artifact.members)) {
    throw new Error("Independent oracle members must use canonical representation and order");
  }
  if (!safeHexEqual(artifact.memberSetSha256, canonicalIndependentOracleMembersSha256(canonical))) {
    throw new Error("Independent oracle member-set hash mismatch");
  }
  const { contentSha256, ...content } = artifact;
  if (!safeHexEqual(contentSha256, independentOracleContentSha256(content))) {
    throw new Error("Independent oracle content hash mismatch");
  }
  if (!safeHexEqual(artifact.reviewProvenanceRootSha256, independentReviewProvenanceRootSha256(canonical)) ||
      !safeHexEqual(artifact.hopChainProvenanceRootSha256, independentHopChainProvenanceRootSha256(canonical))) {
    throw new Error("Independent oracle provenance root mismatch");
  }
  assertSignedReviewerBinding(artifact);
  for (const [purpose, envelope, root] of [["REVIEW", artifact.reviewProvenanceSignature,
    artifact.reviewProvenanceRootSha256], ["HOP_CHAIN", artifact.hopChainProvenanceSignature,
    artifact.hopChainProvenanceRootSha256]] as const) {
    if (envelope.payload.purpose !== purpose || envelope.payload.provenanceRootSha256 !== root ||
        envelope.payload.authoritativeMembershipDigest !== artifact.authoritativeMembershipDigest ||
        envelope.payload.oracleMemberSetSha256 !== artifact.memberSetSha256 ||
        envelope.payload.producerIdentitySha256 !== artifact.producerIdentity) {
      throw new Error("Signed provenance payload does not bind the exact oracle");
    }
    verifyProductionProvenanceSignature(envelope, { runtimeCommitSha: identity.commitSha,
      adapterBundleSha256: identity.adapterBundleSha256 });
  }
  const categoryByCompany=new Map(plans.map(plan=>[plan.company.id,plan.company.category]));
  const releaseDigest = canonicalReleaseMembersSha256(canonical.map(({ companyId, sourceId, surfaceId, channelId }) =>
    ({ companyId, sourceId, surfaceId, channelId, category: categoryByCompany.get(companyId)! })));
  const plannedDigest = canonicalReleaseMembersSha256(releaseMembersFromPlans(plans));
  if (!safeHexEqual(releaseDigest, plannedDigest)) throw new Error("Independent oracle member set does not match production plans");
  const planBySource = new Map(plans.map((plan) => [plan.source.id, plan]));
  for (const member of canonical) {
    const plan = planBySource.get(member.sourceId);
    if (!plan || member.companyId !== plan.company.id || member.surfaceId !== plan.source.surfaceId ||
        member.producerIdentity !== artifact.producerIdentity ||
        member.adapterId !== plan.adapterId ||
        member.adapterConfigSha256 !== sourcePlanOracleConfigSha256(plan)) {
      throw new Error("Independent oracle adapter/config identity mismatch");
    }
    if (member.officialEntrySha256 !== digest(plan.source.officialEntryUrl) ||
        member.officialFinalSha256 !== digest(plan.source.officialChainEvidenceUrl)) {
      throw new Error("Independent oracle official chain identity mismatch");
    }
    if (!plan.expectedChannels?.some((channel) => channel.channelId === member.channelId)) {
      throw new Error("Independent oracle channel is not in the production plan");
    }
  }
  return trusted;
}

export function assertSignedReviewerBinding(artifact: IndependentSourceSurfaceOracleArtifact): void {
  const reviewers = new Set(artifact.members.map((member) => normalize(member.reviewerId, "reviewerId")));
  const reviewPayloadReviewer = normalize(artifact.reviewProvenanceSignature.payload.reviewerIdentitySha256,
    "review signed reviewer identity");
  const hopPayloadReviewer = normalize(artifact.hopChainProvenanceSignature.payload.reviewerIdentitySha256,
    "hop signed reviewer identity");
  if (reviewers.size !== 1 || !reviewers.has(reviewPayloadReviewer) || reviewPayloadReviewer !== hopPayloadReviewer) {
    throw new Error("Signed reviewer identity does not exactly bind the canonical member reviewerId set");
  }
}

export function sourceOracleProjection(trusted: StartupTrustedSourceSurfaceOracle, sourceId: string) {
  assertStartupTrustedSourceSurfaceOracle(trusted);
  const members = trusted.artifact.members.filter((member) => member.sourceId === sourceId);
  if (members.length === 0) return undefined;
  const entryIds = new Set(members.map((member) => normalize(member.officialEntryId, "officialEntryId")));
  if (entryIds.size !== 1) throw new Error("Independent oracle source has inconsistent officialEntryId values");
  return { officialEntryId: [...entryIds][0]!,
    officialSurfaceIds: members.map((member) => member.surfaceId),
    officialChannelIds: members.map((member) => member.channelId) };
}

export function assertExactObservedOracleArtifacts(trusted: StartupTrustedSourceSurfaceOracle,
  sourceId: string, artifacts: readonly ArchivedEvidenceArtifact[]): void {
  assertStartupTrustedSourceSurfaceOracle(trusted);
  const expected = trusted.artifact.members.filter((member) => member.sourceId === sourceId)
    .flatMap((member) => member.expectedArtifacts.map((artifact) => `${artifact.logicalKey}\0${artifact.contentSha256}`)).sort();
  const actual = artifacts.map((artifact) => `${artifact.logicalKey}\0${artifact.sha256}`).sort();
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length ||
      canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error("Observed archived artifacts do not exactly match independent oracle");
  }
}

export function assertExactIndependentCompletenessEvidence(trusted: StartupTrustedSourceSurfaceOracle,
  sourceId: string, evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ArchivedEvidenceArtifact[], identity: RuntimeBatchIdentity): void {
  assertExactObservedOracleArtifacts(trusted, sourceId, artifacts);
  const runtimeFetchProducerIdentitySha256 = digest(canonicalJson(evidence.captureTool));
  for (const envelope of [trusted.artifact.reviewProvenanceSignature,
    trusted.artifact.hopChainProvenanceSignature]) {
    verifyProductionProvenanceSignature(envelope, { runtimeCommitSha: identity.commitSha,
      adapterBundleSha256: identity.adapterBundleSha256, runtimeFetchProducerIdentitySha256 });
  }
  const declared = evidence.declaredCompleteness;
  if (!declared) throw new Error("Independent oracle requires declared completeness evidence");
  const members = trusted.artifact.members.filter((member) => member.sourceId === sourceId);
  for (const member of members) {
    if (member.completenessEvidenceKind !== declared.kind ||
        member.completenessEvidenceLocatorSha256 !== digest(declared.extractorLocator)) {
      throw new Error("Observed completeness kind/locator does not match independent oracle");
    }
    const expected = member.expectedArtifacts.find((artifact) =>
      artifact.logicalKey === declared.artifactLogicalKey &&
      artifact.contentSha256 === member.completenessEvidenceContentSha256);
    if (!expected) throw new Error("Observed completeness content is not independently bound");
  }
}

export function oracleHasExactSourceCoverage(trusted: StartupTrustedSourceSurfaceOracle,
  sourceId: string, artifacts: readonly ArchivedEvidenceArtifact[]): boolean {
  try { assertExactObservedOracleArtifacts(trusted, sourceId, artifacts); return true; } catch { return false; }
}

function canonicalMembers(members: readonly IndependentSourceSurfaceOracleMember[]) {
  const normalized = members.map((member) => ({ ...member,
    officialEntryId: normalize(member.officialEntryId, "officialEntryId"),
    expectedArtifacts: [...member.expectedArtifacts].sort((a, b) => compare(canonicalJson(a), canonicalJson(b))) }))
    .sort((a, b) => compare(canonicalJson(a), canonicalJson(b)));
  const keys = normalized.map((member) => `${member.companyId}\0${member.sourceId}\0${member.surfaceId}\0${member.channelId}`);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate independent oracle member");
  for (const member of normalized) {
    if (!member.reviewerId.trim() || !member.completenessEvidenceKind.trim() ||
        member.producerIdentity !== members[0]?.producerIdentity ||
        member.reviewerDecision !== "APPROVED" || member.reviewerStatus !== "INDEPENDENT" ||
        member.chinaScope !== "RESOLVED" || member.businessUnitScope !== "RESOLVED" ||
        member.legalEntityScope !== "RESOLVED" || member.channelScope !== "RESOLVED") {
      throw new Error("Independent oracle reviewer/scope decision is unresolved");
    }
    for (const value of [member.reviewerId, member.producerIdentity, member.reviewArtifactSha256,
      member.officialEntrySha256, member.officialFinalSha256, member.officialHopChainSha256,
      member.adapterConfigSha256, member.completenessEvidenceLocatorSha256,
      member.completenessEvidenceContentSha256, ...member.expectedArtifacts.map((x) => x.contentSha256)]) {
      if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Independent oracle hash is invalid");
    }
  }
  return normalized;
}
function normalize(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Independent oracle ${field} must be nonblank`);
  return value.trim().normalize("NFC");
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compare(a, b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}
function compare(a: string, b: string) { return Buffer.compare(Buffer.from(a), Buffer.from(b)); }
function digest(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function safeHexEqual(a: string, b: string) {
  return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
function framedRecordsSha256(records: readonly (readonly string[])[]): string {
  const framed = records.map((record) => frameStrings(record.map((value) => normalize(value, "provenance field"))));
  const count = u32(framed.length);
  return createHash("sha256").update(Buffer.concat([count, ...framed.map((record) =>
    Buffer.concat([u32(record.length), record]))])).digest("hex");
}
function frameStrings(values: readonly string[]): Buffer {
  const chunks = values.map((value) => Buffer.from(value, "utf8"));
  return Buffer.concat([u32(chunks.length), ...chunks.map((chunk) => Buffer.concat([u32(chunk.length), chunk]))]);
}
function u32(value: number): Buffer { const out = Buffer.allocUnsafe(4); out.writeUInt32BE(value); return out; }
