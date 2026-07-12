import { assertIndependentCompanyAuditMemberBindings, canonicalIndependentCompanyAuditsSha256,
  canonicalIndependentCompanyAudits,canonicalIndependentOracleMembers,canonicalIndependentOracleMembersSha256, independentCoverageSetSha256,
  independentHopChainProvenanceRootSha256, independentReviewProvenanceRootSha256,
  type IndependentCompanyAudit, type IndependentSourceSurfaceOracleMember } from "./independentSourceSurfaceOracle";
import type { SignedProvenancePayload } from "./reviewerSignatureTrust";
import { confirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";
import { createHash } from "node:crypto";

type LegacyOracleMember = Omit<IndependentSourceSurfaceOracleMember,"category">;
type LegacyOracleInputMember = LegacyOracleMember & { category?: IndependentSourceSurfaceOracleMember["category"] };
interface LegacyOracle {
  schemaVersion?: 1; kind: "FULL_RELEASE"; releaseCandidateId: string; commitSha: string;
  rosterSha256: string; sourcePlanSha256: string; sourceConfigSha256: string; adapterBundleSha256: string;
  authoritativeMembershipDigest: string; producerIdentity: string; members: LegacyOracleMember[];
}
type LegacyOracleInput = Omit<LegacyOracle,"members"> & { members: LegacyOracleInputMember[] };
export interface UnsignedOracleV2Migration {
  schemaVersion: 2; status: "AWAITING_INDEPENDENT_SIGNATURE"; legacy: LegacyOracle;
  memberSetSha256: string; reviewProvenanceRootSha256: string; hopChainProvenanceRootSha256: string;
  reviewPayload: SignedProvenancePayload; hopChainPayload: SignedProvenancePayload;
  reviewSignature: null; hopChainSignature: null;
}
export interface UnsignedOracleV3Migration {
  schemaVersion: 3; status: "AWAITING_INDEPENDENT_SIGNATURE"; legacy: LegacyOracle;
  companyAudits: IndependentCompanyAudit[]; members: IndependentSourceSurfaceOracleMember[];
  memberSetSha256: string; companyAuditSetSha256: string;
  coverageSetSha256: string; reviewProvenanceRootSha256: string; hopChainProvenanceRootSha256: string;
  reviewPayload: SignedProvenancePayload; hopChainPayload: SignedProvenancePayload;
  reviewSignature: null; hopChainSignature: null;
}

export function buildUnsignedOracleV2Migration(input: unknown): UnsignedOracleV2Migration {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Legacy oracle must be an object");
  rejectSigningMaterial(input);
  const rawLegacy = input as LegacyOracleInput;
  if (rawLegacy.schemaVersion !== undefined && rawLegacy.schemaVersion !== 1) {
    throw new Error("Only unversioned or v1 legacy oracle artifacts can be migrated");
  }
  for (const value of [rawLegacy.authoritativeMembershipDigest, rawLegacy.producerIdentity]) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Legacy oracle identity must be canonical SHA-256");
  }
  if (!Array.isArray(rawLegacy.members) || rawLegacy.members.length === 0) throw new Error("Legacy oracle members are required");
  const legacy=sanitizeLegacyOracle(rawLegacy);
  const memberSetSha256 = legacyMemberSetSha256(legacy.members);
  const reviewProvenanceRootSha256 = legacyReviewRootSha256(legacy.members);
  const hopChainProvenanceRootSha256 = legacyHopRootSha256(legacy.members);
  const reviewerIdentitySha256 = legacy.members[0]!.reviewerId;
  if (!legacy.members.every((member) => member.reviewerId === reviewerIdentitySha256 &&
    member.producerIdentity === legacy.producerIdentity)) throw new Error("Legacy reviewer/producer identity is inconsistent");
  const common = { schemaVersion: 1 as const, reviewerIdentitySha256,
    producerIdentitySha256: legacy.producerIdentity, authoritativeMembershipDigest: legacy.authoritativeMembershipDigest,
    oracleMemberSetSha256: memberSetSha256 };
  return { schemaVersion: 2, status: "AWAITING_INDEPENDENT_SIGNATURE", legacy,
    memberSetSha256, reviewProvenanceRootSha256, hopChainProvenanceRootSha256,
    reviewPayload: { ...common, purpose: "REVIEW", provenanceRootSha256: reviewProvenanceRootSha256 },
    hopChainPayload: { ...common, purpose: "HOP_CHAIN", provenanceRootSha256: hopChainProvenanceRootSha256 },
    reviewSignature: null, hopChainSignature: null };
}

export function buildUnsignedOracleV3Migration(input: unknown): UnsignedOracleV3Migration {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Oracle v3 migration input must be an object");
  }
  rejectSigningMaterial(input);
  const candidate = input as { legacy?: LegacyOracleInput; companyAudits?: IndependentCompanyAudit[] };
  if (!candidate.legacy || typeof candidate.legacy !== "object" || Array.isArray(candidate.legacy)) {
    throw new Error("Legacy source-member material is required");
  }
  if (!Array.isArray(candidate.companyAudits)) throw new Error("Complete company audit input is required");
  const rawLegacy = candidate.legacy;
  if (rawLegacy.schemaVersion !== undefined && rawLegacy.schemaVersion !== 1) {
    throw new Error("Only unversioned or v1 legacy oracle material can be migrated to v3");
  }
  if (!Array.isArray(rawLegacy.members)) throw new Error("Legacy oracle members must be an array");
  for (const value of [rawLegacy.authoritativeMembershipDigest, rawLegacy.producerIdentity]) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Legacy oracle identity must be canonical SHA-256");
  }
  if (rawLegacy.rosterSha256 !== confirmedCompanyRosterV3.membersSha256) {
    throw new Error("Legacy oracle roster hash does not match confirmed V3 roster");
  }
  const legacy=sanitizeLegacyOracle(rawLegacy);
  const companyAudits=canonicalIndependentCompanyAudits(candidate.companyAudits.map(sanitizeCompanyAudit));
  const auditByCompany=new Map(companyAudits.map(audit=>[audit.companyId,audit]));
  const members=canonicalIndependentOracleMembers(rawLegacy.members.map(rawMember=>{
    const audit=auditByCompany.get(rawMember.companyId);
    if(!audit)throw new Error("Legacy oracle member has no matching company audit");
    if(rawMember.category!==undefined&&rawMember.category!==audit.category){
      throw new Error("Legacy oracle member category conflicts with matching company audit");
    }
    return {...sanitizeLegacyMember(rawMember),category:audit.category};
  }));
  const companyAuditSetSha256 = canonicalIndependentCompanyAuditsSha256(companyAudits);
  const memberSetSha256 = canonicalIndependentOracleMembersSha256(members);
  assertIndependentCompanyAuditMemberBindings(companyAudits, members);
  const combined = [...companyAudits, ...members];
  const reviewers = new Set(combined.map((record) => record.reviewerId));
  const producers = new Set(combined.map((record) => record.producerIdentity));
  if (reviewers.size !== 1 || producers.size !== 1 || !producers.has(legacy.producerIdentity)) {
    throw new Error("Oracle v3 migration reviewer/producer identity is inconsistent");
  }
  const reviewerIdentitySha256 = combined[0]!.reviewerId;
  const coverageSetSha256 = independentCoverageSetSha256(companyAudits, members);
  const reviewProvenanceRootSha256 = independentReviewProvenanceRootSha256(companyAudits, members);
  const hopChainProvenanceRootSha256 = independentHopChainProvenanceRootSha256(companyAudits, members);
  const common = { schemaVersion: 1 as const, reviewerIdentitySha256,
    producerIdentitySha256: legacy.producerIdentity,
    authoritativeMembershipDigest: legacy.authoritativeMembershipDigest,
    // Compatibility: v1 field name retained; v3 value is the combined coverage digest.
    oracleMemberSetSha256: coverageSetSha256 };
  return { schemaVersion: 3, status: "AWAITING_INDEPENDENT_SIGNATURE", legacy,
    companyAudits, members, memberSetSha256, companyAuditSetSha256,
    coverageSetSha256, reviewProvenanceRootSha256, hopChainProvenanceRootSha256,
    reviewPayload: { ...common, purpose: "REVIEW", provenanceRootSha256: reviewProvenanceRootSha256 },
    hopChainPayload: { ...common, purpose: "HOP_CHAIN", provenanceRootSha256: hopChainProvenanceRootSha256 },
    reviewSignature: null, hopChainSignature: null };
}

function rejectSigningMaterial(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/signature|private.?key/i.test(key) || (typeof child === "string" &&
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/i.test(child))) {
      throw new Error("Migration input must not contain signature or private-key material");
    }
    rejectSigningMaterial(child);
  }
}

function sanitizeLegacyOracle(input:LegacyOracleInput):LegacyOracle{
  return {...(input.schemaVersion===1?{schemaVersion:1 as const}:{}),kind:input.kind,
    releaseCandidateId:input.releaseCandidateId,commitSha:input.commitSha,rosterSha256:input.rosterSha256,
    sourcePlanSha256:input.sourcePlanSha256,sourceConfigSha256:input.sourceConfigSha256,
    adapterBundleSha256:input.adapterBundleSha256,authoritativeMembershipDigest:input.authoritativeMembershipDigest,
    producerIdentity:input.producerIdentity,members:input.members.map(sanitizeLegacyMember)};
}
function sanitizeLegacyMember(member:LegacyOracleInputMember):LegacyOracleMember{
  return {companyId:member.companyId,sourceId:member.sourceId,surfaceId:member.surfaceId,channelId:member.channelId,
    officialEntryId:member.officialEntryId,reviewerId:member.reviewerId,reviewArtifactSha256:member.reviewArtifactSha256,
    producerIdentity:member.producerIdentity,reviewerDecision:member.reviewerDecision,reviewerStatus:member.reviewerStatus,
    officialEntrySha256:member.officialEntrySha256,officialFinalSha256:member.officialFinalSha256,
    officialHopChainSha256:member.officialHopChainSha256,chinaScope:member.chinaScope,
    businessUnitScope:member.businessUnitScope,legalEntityScope:member.legalEntityScope,channelScope:member.channelScope,
    adapterId:member.adapterId,adapterConfigSha256:member.adapterConfigSha256,
    completenessEvidenceKind:member.completenessEvidenceKind,
    completenessEvidenceLocatorSha256:member.completenessEvidenceLocatorSha256,
    completenessEvidenceContentSha256:member.completenessEvidenceContentSha256,
    expectedArtifacts:member.expectedArtifacts.map(artifact=>({logicalKey:artifact.logicalKey,contentSha256:artifact.contentSha256}))};
}
function sanitizeCompanyAudit(audit:IndependentCompanyAudit):IndependentCompanyAudit{
  return {companyId:audit.companyId,category:audit.category,status:audit.status,capturedAt:audit.capturedAt,
    officialWebsiteUrl:audit.officialWebsiteUrl,officialWebsiteSha256:audit.officialWebsiteSha256,
    officialEntryIds:[...audit.officialEntryIds],evidenceArtifacts:audit.evidenceArtifacts.map(artifact=>({
      logicalKey:artifact.logicalKey,contentSha256:artifact.contentSha256})),reviewerId:audit.reviewerId,
    reviewArtifactSha256:audit.reviewArtifactSha256,producerIdentity:audit.producerIdentity,
    reviewerDecision:audit.reviewerDecision,reviewerStatus:audit.reviewerStatus};
}

function legacyMembers(members: readonly LegacyOracleMember[]) {
  const canonical=members.map((member)=>({...member,officialEntryId:legacyNormalize(member.officialEntryId,"officialEntryId"),
    expectedArtifacts:[...member.expectedArtifacts].sort((a,b)=>Buffer.compare(Buffer.from(legacyCanonicalJson(a)),Buffer.from(legacyCanonicalJson(b))))}))
    .sort((a,b)=>Buffer.compare(Buffer.from(legacyCanonicalJson(a)),Buffer.from(legacyCanonicalJson(b))));
  const keys=canonical.map((member)=>`${member.companyId}\0${member.sourceId}\0${member.surfaceId}\0${member.channelId}`);
  if(new Set(keys).size!==keys.length)throw new Error("Duplicate independent oracle member");
  for(const member of canonical){
    if(!member.reviewerId.trim()||!member.completenessEvidenceKind.trim()||
      member.producerIdentity!==canonical[0]?.producerIdentity||member.reviewerDecision!=="APPROVED"||
      member.reviewerStatus!=="INDEPENDENT"||member.chinaScope!=="RESOLVED"||
      member.businessUnitScope!=="RESOLVED"||member.legalEntityScope!=="RESOLVED"||member.channelScope!=="RESOLVED"){
      throw new Error("Independent oracle reviewer/scope decision is unresolved");
    }
    for(const value of [member.reviewerId,member.producerIdentity,member.reviewArtifactSha256,
      member.officialEntrySha256,member.officialFinalSha256,member.officialHopChainSha256,
      member.adapterConfigSha256,member.completenessEvidenceLocatorSha256,
      member.completenessEvidenceContentSha256,...member.expectedArtifacts.map(artifact=>artifact.contentSha256)]){
      if(!/^[a-f0-9]{64}$/.test(value))throw new Error("Independent oracle hash is invalid");
    }
  }
  return canonical;
}
function legacyMemberSetSha256(members:readonly LegacyOracleMember[]){return hash(legacyCanonicalJson(legacyMembers(members)));}
function legacyReviewRootSha256(members:readonly LegacyOracleMember[]){return framed(legacyMembers(members).map(member=>[member.companyId,member.sourceId,member.surfaceId,member.channelId,member.reviewerId,member.reviewArtifactSha256,member.producerIdentity]));}
function legacyHopRootSha256(members:readonly LegacyOracleMember[]){return framed(legacyMembers(members).map(member=>[member.companyId,member.sourceId,member.surfaceId,member.channelId,member.officialHopChainSha256,member.producerIdentity]));}
function legacyCanonicalJson(value:unknown):string{if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(legacyCanonicalJson).join(",")}]`;return`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([key,child])=>`${JSON.stringify(key)}:${legacyCanonicalJson(child)}`).join(",")}}`;}
function framed(records:readonly (readonly string[])[]):string{const values=records.map(record=>frameStrings(record.map(value=>value.trim().normalize("NFC"))));return createHash("sha256").update(Buffer.concat([u32(values.length),...values.map(value=>Buffer.concat([u32(value.length),value]))])).digest("hex");}
function frameStrings(values:readonly string[]):Buffer{const chunks=values.map(value=>Buffer.from(value,"utf8"));return Buffer.concat([u32(chunks.length),...chunks.map(chunk=>Buffer.concat([u32(chunk.length),chunk]))]);}
function u32(value:number):Buffer{const out=Buffer.allocUnsafe(4);out.writeUInt32BE(value);return out;}
function hash(value:string):string{return createHash("sha256").update(value,"utf8").digest("hex");}
function legacyNormalize(value:string,field:string):string{if(typeof value!=="string"||!value.trim())throw new Error(`Independent oracle ${field} must be nonblank`);return value.trim().normalize("NFC");}
