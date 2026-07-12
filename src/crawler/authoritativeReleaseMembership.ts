import { createHash, timingSafeEqual } from "node:crypto";
import type { RuntimeBatchIdentity } from "./runtimeBatchIdentity";
import type { SourceCrawlPlan } from "./sourcePlan";
import { assertStartupTrustedReleaseMembership,
  type StartupTrustedReleaseMembership } from "./releaseMembershipAuthority";

export type ReleaseCompanyCategory = "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
export interface ReleaseMember { companyId: string; sourceId: string; surfaceId: string; channelId: string; category: ReleaseCompanyCategory }
export interface OracleAuthorityBinding {
  oracleRawFileSha256: string; oracleContentSha256: string;
  reviewProvenanceRootSha256: string; hopChainProvenanceRootSha256: string;
  reviewSignedPayloadSha256: string; hopChainSignedPayloadSha256: string;
  reviewKeyId: string; hopChainKeyId: string; producerIdentity: string;
}
export interface AuthoritativeReleaseMembershipArtifact {
  schemaVersion: 6;
  kind: "FULL_RELEASE" | "PARTIAL_DIAGNOSTIC";
  releaseCandidateId: string; commitSha: string; rosterSha256: string;
  sourcePlanSha256: string; sourceConfigSha256: string; adapterBundleSha256: string; sourceTreeSha256: string; runtimeTreeSha256:string;
  oracleAuthority: OracleAuthorityBinding;
  members: ReleaseMember[]; memberSetSha256: string; contentSha256: string;
}
type MembershipBinding = Pick<RuntimeBatchIdentity, "releaseCandidateId" | "commitSha" |
  "rosterSha256" | "sourcePlanSha256" | "sourceConfigSha256" | "adapterBundleSha256">;

const bindingFields: readonly (keyof MembershipBinding)[] = ["releaseCandidateId", "commitSha",
  "rosterSha256", "sourcePlanSha256", "sourceConfigSha256", "adapterBundleSha256"];

export function releaseMembersFromPlans(plans: readonly SourceCrawlPlan[]): ReleaseMember[] {
  return plans.flatMap((plan) => (plan.expectedChannels ?? []).map((channel) => ({
    companyId: plan.company.id, sourceId: plan.source.id,
    surfaceId: normalize(plan.source.surfaceId as string, "surfaceId"), channelId: channel.channelId,
    category: validCategory(plan.company.category)
  })));
}

export function canonicalReleaseMembersSha256(members: readonly ReleaseMember[]): string {
  return sha256(frameMembers(canonicalizeMembers(members)));
}

export function releaseMembershipContentSha256(
  artifact: Omit<AuthoritativeReleaseMembershipArtifact, "contentSha256">
): string {
  const fields = [String(artifact.schemaVersion), artifact.kind, ...bindingFields.map((field) => artifact[field]), artifact.sourceTreeSha256,artifact.runtimeTreeSha256,
    artifact.oracleAuthority.oracleRawFileSha256, artifact.oracleAuthority.oracleContentSha256,
    artifact.oracleAuthority.reviewProvenanceRootSha256, artifact.oracleAuthority.hopChainProvenanceRootSha256,
    artifact.oracleAuthority.reviewSignedPayloadSha256, artifact.oracleAuthority.hopChainSignedPayloadSha256,
    artifact.oracleAuthority.reviewKeyId, artifact.oracleAuthority.hopChainKeyId,
    artifact.oracleAuthority.producerIdentity, artifact.memberSetSha256] as string[];
  return sha256(Buffer.concat([frameStrings(fields), frameMembers(artifact.members)]));
}

export function validateAuthoritativeReleaseMembership(
  trusted: StartupTrustedReleaseMembership | undefined,
  expectedBinding: MembershipBinding,
  actualMembers: readonly ReleaseMember[]
): ReleaseMember[] {
  assertStartupTrustedReleaseMembership(trusted);
  const artifact = trusted.artifact;
  const canonicalArtifact=validateAuthoritativeReleaseMembershipArtifactContent(artifact);
  for (const field of bindingFields) {
    if (artifact[field] !== expectedBinding[field]) throw new Error(`Authoritative release membership identity mismatch: ${field}`);
  }
  const canonicalActual = canonicalizeMembers(actualMembers);
  if (!membersEqual(canonicalActual, canonicalArtifact) ||
      !safeHexEqual(canonicalReleaseMembersSha256(canonicalActual), artifact.memberSetSha256)) {
    throw new Error("Production plan member set does not match authoritative release membership");
  }
  return canonicalActual;
}

export function validateAuthoritativeReleaseMembershipArtifactContent(
  artifact:AuthoritativeReleaseMembershipArtifact
):ReleaseMember[]{
  if (artifact.schemaVersion !== 6) throw new Error("Unsupported authoritative release membership schema version");
  if(!/^[a-f0-9]{64}$/.test(artifact.sourceTreeSha256)||!/^[a-f0-9]{64}$/.test(artifact.runtimeTreeSha256))throw new Error("Authoritative release membership tree hash is invalid");
  validateOracleAuthorityBinding(artifact.oracleAuthority);
  if (artifact.kind !== "FULL_RELEASE") throw new Error("PARTIAL_DIAGNOSTIC can never become formal release evidence");
  const canonical=canonicalizeMembers(artifact.members);
  if (!membersEqual(canonical, artifact.members)) throw new Error("Authoritative release membership members must use canonical representation and order");
  if (!safeHexEqual(artifact.memberSetSha256, canonicalReleaseMembersSha256(canonical))) throw new Error("Authoritative release membership member-set hash mismatch");
  const { contentSha256, ...content } = artifact;
  if (!safeHexEqual(contentSha256, releaseMembershipContentSha256(content))) throw new Error("Authoritative release membership content hash mismatch");
  return canonical;
}

function canonicalizeMembers(members: readonly ReleaseMember[]): ReleaseMember[] {
  const normalized = members.map((member) => ({ companyId: normalize(member.companyId, "companyId"),
    sourceId: normalize(member.sourceId, "sourceId"), surfaceId: normalize(member.surfaceId, "surfaceId"),
    channelId: normalize(member.channelId, "channelId"), category: validCategory(member.category) }));
  const companyCategories = new Map<string, ReleaseCompanyCategory>();
  for (const member of normalized) { const prior=companyCategories.get(member.companyId); if(prior&&prior!==member.category) throw new Error("Authoritative release membership company category drift"); companyCategories.set(member.companyId,member.category); }
  normalized.sort((a, b) => Buffer.compare(frameMember(a), frameMember(b)));
  for (let i = 1; i < normalized.length; i += 1) {
    if (Buffer.compare(frameMember(normalized[i - 1]!), frameMember(normalized[i]!)) === 0) {
      throw new Error("Duplicate authoritative release member after canonicalization");
    }
  }
  return normalized;
}

function normalize(value: string, field: string): string {
  if (typeof value !== "string") throw new Error(`Release member ${field} must be a string`);
  const normalized = value.trim().normalize("NFC");
  if (!normalized) throw new Error(`Release member ${field} must be nonblank`);
  return normalized;
}
function frameMember(member: ReleaseMember): Buffer { return frameStrings([member.companyId, member.sourceId, member.surfaceId, member.channelId, member.category]); }
function validCategory(value: unknown): ReleaseCompanyCategory { if(value!=="FOREIGN_PHARMA"&&value!=="DOMESTIC_PHARMA") throw new Error("Release member category is invalid"); return value; }
function frameMembers(members: readonly ReleaseMember[]): Buffer {
  const chunks = members.map(frameMember); return Buffer.concat([u32(chunks.length), ...chunks.map((chunk) => Buffer.concat([u32(chunk.length), chunk]))]);
}
function frameStrings(values: readonly string[]): Buffer {
  const chunks = values.map((value) => Buffer.from(value.normalize("NFC"), "utf8"));
  return Buffer.concat([u32(chunks.length), ...chunks.map((chunk) => Buffer.concat([u32(chunk.length), chunk]))]);
}
function u32(value: number): Buffer { const out = Buffer.allocUnsafe(4); out.writeUInt32BE(value); return out; }
function membersEqual(a: readonly ReleaseMember[], b: readonly ReleaseMember[]): boolean { return frameMembers(a).equals(frameMembers(b)); }
function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function safeHexEqual(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
function validateOracleAuthorityBinding(binding: OracleAuthorityBinding): void {
  for (const [field, value] of Object.entries(binding)) {
    if (field === "reviewKeyId" || field === "hopChainKeyId") {
      if (typeof value !== "string" || !value.trim()) throw new Error("Membership oracle producer identity is invalid");
    } else if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`Membership oracle authority hash is invalid: ${field}`);
    }
  }
}
