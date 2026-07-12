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
import { assertExactConfirmedCompanyRosterV3, confirmedCompanyRosterV3,
  type ConfirmedCompanyCategory } from "../data/confirmedCompanyRosterV3";

export interface IndependentOracleExpectedArtifact { logicalKey: string; contentSha256: string }
export type IndependentCompanyAuditStatus = "HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" |
  "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME";
export interface IndependentCompanyAudit {
  companyId: string; category: ConfirmedCompanyCategory; status: IndependentCompanyAuditStatus;
  capturedAt: string; officialWebsiteUrl: string; officialWebsiteSha256: string;
  officialEntryIds: string[]; evidenceArtifacts: IndependentOracleExpectedArtifact[];
  reviewerId: string; reviewArtifactSha256: string; producerIdentity: string;
  reviewerDecision: "APPROVED"; reviewerStatus: "INDEPENDENT";
}
export interface IndependentSourceSurfaceOracleMember {
  companyId: string; category: ConfirmedCompanyCategory; sourceId: string; surfaceId: string; channelId: string; officialEntryId: string;
  reviewerId: string; reviewArtifactSha256: string; producerIdentity: string;
  reviewerDecision: "APPROVED"; reviewerStatus: "INDEPENDENT";
  officialEntrySha256: string; officialFinalSha256: string; officialHopChainSha256: string;
  chinaScope: "RESOLVED"; businessUnitScope: "RESOLVED"; legalEntityScope: "RESOLVED";
  channelScope: "RESOLVED"; adapterId: string; adapterConfigSha256: string;
  completenessEvidenceKind: string; completenessEvidenceLocatorSha256: string;
  completenessEvidenceContentSha256: string; expectedArtifacts: IndependentOracleExpectedArtifact[];
}
export interface IndependentSourceSurfaceOracleArtifact {
  schemaVersion: 3;
  kind: "FULL_RELEASE";
  releaseCandidateId: string; commitSha: string; rosterSha256: string; sourcePlanSha256: string;
  sourceConfigSha256: string; adapterBundleSha256: string; authoritativeMembershipDigest: string;
  reviewProvenanceRootSha256: string; hopChainProvenanceRootSha256: string; producerIdentity: string;
  reviewProvenanceSignature: SignedProvenanceEnvelope; hopChainProvenanceSignature: SignedProvenanceEnvelope;
  companyAudits: IndependentCompanyAudit[]; companyAuditSetSha256: string;
  members: IndependentSourceSurfaceOracleMember[]; memberSetSha256: string; coverageSetSha256: string;
  contentSha256: string;
}

const bindingFields = ["releaseCandidateId", "commitSha", "rosterSha256", "sourcePlanSha256",
  "sourceConfigSha256", "adapterBundleSha256"] as const;
export const INDEPENDENT_COMPANY_AUDIT_FRESHNESS_MAXIMUM_MS = 86_400_000;

export function canonicalIndependentOracleMembersSha256(
  members: readonly IndependentSourceSurfaceOracleMember[]): string {
  const canonical = canonicalIndependentOracleMembers(members);
  return digest(canonicalJson(canonical));
}

export function canonicalIndependentCompanyAuditsSha256(audits: readonly IndependentCompanyAudit[]): string {
  return digest(canonicalJson(canonicalIndependentCompanyAudits(audits)));
}

export function independentCoverageSetSha256(audits: readonly IndependentCompanyAudit[],
  members: readonly IndependentSourceSurfaceOracleMember[]): string {
  const records = [
    ...canonicalIndependentCompanyAudits(audits).map((record) => ({ recordType: "COMPANY_AUDIT" as const, record })),
    ...canonicalIndependentOracleMembers(members).map((record) => ({ recordType: "SOURCE_MEMBER" as const, record }))
  ].sort((a, b) => compare(canonicalJson(a), canonicalJson(b)));
  return digest(canonicalJson(records));
}

export function independentOracleContentSha256(
  artifact: Omit<IndependentSourceSurfaceOracleArtifact, "contentSha256">): string {
  return digest(canonicalJson({ ...artifact, members: canonicalIndependentOracleMembers(artifact.members) }));
}

export function independentReviewProvenanceRootSha256(audits: readonly IndependentCompanyAudit[],
  members: readonly IndependentSourceSurfaceOracleMember[]): string {
  return framedRecordsSha256([
    ...canonicalIndependentCompanyAudits(audits).map((audit) => ["COMPANY_AUDIT", audit.companyId, audit.category,
      audit.status, audit.capturedAt, audit.officialWebsiteUrl, audit.officialWebsiteSha256,
      digest(canonicalJson(audit.officialEntryIds)), digest(canonicalJson(audit.evidenceArtifacts)),
      audit.reviewerId, audit.reviewArtifactSha256, audit.producerIdentity]),
    ...canonicalIndependentOracleMembers(members).map((member) => ["SOURCE_MEMBER", member.companyId, member.category,
      member.sourceId, member.surfaceId, member.channelId, member.reviewerId,
      member.reviewArtifactSha256, member.producerIdentity])
  ]);
}
export function independentHopChainProvenanceRootSha256(audits: readonly IndependentCompanyAudit[],
  members: readonly IndependentSourceSurfaceOracleMember[]): string {
  return framedRecordsSha256([
    ...canonicalIndependentCompanyAudits(audits).map((audit) => ["COMPANY_AUDIT", audit.companyId, audit.category,
      audit.status, audit.officialWebsiteUrl, audit.officialWebsiteSha256,
      digest(canonicalJson(audit.officialEntryIds)), digest(canonicalJson(audit.evidenceArtifacts)),
      audit.producerIdentity]),
    ...canonicalIndependentOracleMembers(members).map((member) => ["SOURCE_MEMBER", member.companyId, member.category,
      member.sourceId, member.surfaceId, member.channelId, member.officialHopChainSha256,
      member.producerIdentity])
  ]);
}

export function validateIndependentSourceSurfaceOracleArtifactContent(
  artifact:IndependentSourceSurfaceOracleArtifact,validationTime:Date
):{audits:IndependentCompanyAudit[];members:IndependentSourceSurfaceOracleMember[]}{
  if(artifact.schemaVersion!==3||artifact.kind!=="FULL_RELEASE")throw new Error("Unsupported independent oracle schema version");
  const audits=canonicalIndependentCompanyAudits(artifact.companyAudits);
  const members=canonicalIndependentOracleMembers(artifact.members);
  assertIndependentCompanyAuditFreshness(audits,validationTime);
  if(canonicalJson(audits)!==canonicalJson(artifact.companyAudits)||canonicalJson(members)!==canonicalJson(artifact.members))
    throw new Error("Independent oracle records must use canonical representation and order");
  if(!safeHexEqual(artifact.companyAuditSetSha256,canonicalIndependentCompanyAuditsSha256(audits))||
      !safeHexEqual(artifact.memberSetSha256,canonicalIndependentOracleMembersSha256(members))||
      !safeHexEqual(artifact.coverageSetSha256,independentCoverageSetSha256(audits,members)))
    throw new Error("Independent oracle set hash mismatch");
  const {contentSha256,...content}=artifact;
  if(!safeHexEqual(contentSha256,independentOracleContentSha256(content)))throw new Error("Independent oracle content hash mismatch");
  if(!safeHexEqual(artifact.reviewProvenanceRootSha256,independentReviewProvenanceRootSha256(audits,members))||
      !safeHexEqual(artifact.hopChainProvenanceRootSha256,independentHopChainProvenanceRootSha256(audits,members)))
    throw new Error("Independent oracle provenance root mismatch");
  assertIndependentCompanyAuditMemberBindings(audits,members);
  assertSignedReviewerBinding(artifact);
  return {audits,members};
}

export function sourcePlanOracleConfigSha256(plan: SourceCrawlPlan): string { return digest(canonicalJson(plan)); }
export function independentOracleValueSha256(value: string): string { return digest(value); }

export function validateIndependentSourceSurfaceOracle(
  trusted: StartupTrustedSourceSurfaceOracle | undefined,
  membership: StartupTrustedReleaseMembership | undefined,
  identity: RuntimeBatchIdentity,
  plans: readonly SourceCrawlPlan[],
  validationTime: Date
): StartupTrustedSourceSurfaceOracle {
  assertStartupTrustedSourceSurfaceOracle(trusted);
  assertStartupTrustedReleaseMembership(membership);
  const artifact = trusted.artifact;
  if (artifact.schemaVersion !== 3) throw new Error("Unsupported independent oracle schema version");
  for (const field of bindingFields) {
    if (artifact[field] !== identity[field]) throw new Error(`Independent oracle identity mismatch: ${field}`);
  }
  if (!safeHexEqual(artifact.rosterSha256, confirmedCompanyRosterV3.membersSha256)) {
    throw new Error("Independent oracle roster hash does not match confirmed V3 roster");
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
  const {audits:canonicalAudits,members:canonical}=
    validateIndependentSourceSurfaceOracleArtifactContent(artifact,validationTime);
  const releaseDigest = canonicalReleaseMembersSha256(canonical.map(({ companyId, sourceId, surfaceId, channelId, category }) =>
    ({ companyId, sourceId, surfaceId, channelId, category })));
  const plannedDigest = canonicalReleaseMembersSha256(releaseMembersFromPlans(plans));
  if (!safeHexEqual(releaseDigest, plannedDigest) ||
      !safeHexEqual(plannedDigest, artifact.authoritativeMembershipDigest)) {
    throw new Error("Independent oracle member set does not match production plans and membership");
  }
  const planBySource = new Map(plans.map((plan) => [plan.source.id, plan]));
  for (const member of canonical) {
    const plan = planBySource.get(member.sourceId);
    if (!plan || member.companyId !== plan.company.id || member.category !== plan.company.category ||
        member.surfaceId !== plan.source.surfaceId ||
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
  for (const [purpose, envelope, root] of [["REVIEW", artifact.reviewProvenanceSignature,
    artifact.reviewProvenanceRootSha256], ["HOP_CHAIN", artifact.hopChainProvenanceSignature,
    artifact.hopChainProvenanceRootSha256]] as const) {
    if (envelope.payload.purpose !== purpose || envelope.payload.provenanceRootSha256 !== root ||
        envelope.payload.authoritativeMembershipDigest !== artifact.authoritativeMembershipDigest ||
        // Compatibility: the v1 payload field name is legacy; v3 binds the combined coverage digest.
        envelope.payload.oracleMemberSetSha256 !== artifact.coverageSetSha256 ||
        envelope.payload.producerIdentitySha256 !== artifact.producerIdentity) {
      throw new Error("Signed provenance payload does not bind the exact oracle coverage set");
    }
    verifyProductionProvenanceSignature(envelope, { runtimeCommitSha: identity.commitSha,
      adapterBundleSha256: identity.adapterBundleSha256 });
  }
  return trusted;
}

export function assertIndependentCompanyAuditFreshness(
  audits: readonly IndependentCompanyAudit[],
  validationTime: Date
): void {
  const validationTimeMs = validationTime instanceof Date ? validationTime.getTime() : Number.NaN;
  if (!Number.isFinite(validationTimeMs)) {
    throw new Error("Independent oracle validation time must be a valid explicit instant");
  }
  for (const audit of audits) {
    const capturedAtMs = Date.parse(audit.capturedAt);
    if (!Number.isFinite(capturedAtMs)) {
      throw new Error("Independent oracle company audit capturedAt must be a valid instant");
    }
    const ageMs = validationTimeMs - capturedAtMs;
    if (ageMs < 0) throw new Error("Independent oracle company audit capturedAt is in the future");
    if (ageMs >= INDEPENDENT_COMPANY_AUDIT_FRESHNESS_MAXIMUM_MS) {
      throw new Error("Independent oracle company audit is stale at the strict 24-hour freshness boundary");
    }
  }
}

export function assertSignedReviewerBinding(artifact: IndependentSourceSurfaceOracleArtifact): void {
  const reviewers = new Set([...artifact.companyAudits, ...artifact.members]
    .map((record) => normalize(record.reviewerId, "reviewerId")));
  const producers = new Set([...artifact.companyAudits, ...artifact.members]
    .map((record) => normalize(record.producerIdentity, "producerIdentity")));
  const reviewPayloadReviewer = normalize(artifact.reviewProvenanceSignature.payload.reviewerIdentitySha256,
    "review signed reviewer identity");
  const hopPayloadReviewer = normalize(artifact.hopChainProvenanceSignature.payload.reviewerIdentitySha256,
    "hop signed reviewer identity");
  if (reviewers.size !== 1 || !reviewers.has(reviewPayloadReviewer) || reviewPayloadReviewer !== hopPayloadReviewer ||
      producers.size !== 1 || !producers.has(artifact.producerIdentity) ||
      artifact.reviewProvenanceSignature.payload.producerIdentitySha256 !== artifact.producerIdentity ||
      artifact.hopChainProvenanceSignature.payload.producerIdentitySha256 !== artifact.producerIdentity) {
    throw new Error("Signed reviewer identity does not exactly bind the canonical member reviewerId set");
  }
}

export function assertIndependentCompanyAuditMemberBindings(audits: readonly IndependentCompanyAudit[],
  members: readonly IndependentSourceSurfaceOracleMember[]): void {
  const auditByCompany = new Map(audits.map((audit) => [audit.companyId, audit]));
  const membersByCompany = new Map<string, IndependentSourceSurfaceOracleMember[]>();
  for (const member of members) {
    const audit = auditByCompany.get(member.companyId);
    if (!audit) throw new Error("Independent oracle member belongs to an unadjudicated company");
    if (member.category !== audit.category) throw new Error("Independent oracle company/member category mismatch");
    const companyMembers = membersByCompany.get(member.companyId) ?? [];
    companyMembers.push(member); membersByCompany.set(member.companyId, companyMembers);
  }
  for (const audit of audits) {
    const companyMembers = membersByCompany.get(audit.companyId) ?? [];
    const memberEntryIds = new Set(companyMembers.map((member) => member.officialEntryId));
    const auditedEntryIds = new Set(audit.officialEntryIds);
    if (audit.status === "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME") {
      if (audit.officialEntryIds.length !== 0 || companyMembers.length !== 0) {
        throw new Error("Independent oracle no-link company must have zero official entries and members");
      }
      continue;
    }
    if (audit.officialEntryIds.length === 0 || companyMembers.length === 0) {
      throw new Error("Independent oracle has-link company requires official entries and members");
    }
    if (companyMembers.some((member) => !auditedEntryIds.has(member.officialEntryId))) {
      throw new Error("Independent oracle member official entry is absent from company audit");
    }
    if (audit.officialEntryIds.some((entryId) => !memberEntryIds.has(entryId))) {
      throw new Error("Independent oracle audited official entry is omitted from source members");
    }
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

export function canonicalIndependentOracleMembers(members: readonly IndependentSourceSurfaceOracleMember[]) {
  const normalized = members.map((member) => ({ ...member,
    category: member.category === "FOREIGN_PHARMA" || member.category === "DOMESTIC_PHARMA" ? member.category :
      (() => { throw new Error("Independent oracle member category is invalid"); })(),
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
export function canonicalIndependentCompanyAudits(audits: readonly IndependentCompanyAudit[]): IndependentCompanyAudit[] {
  if (!Array.isArray(audits)) throw new Error("Independent oracle company audits must be an array");
  assertExactConfirmedCompanyRosterV3(audits.map(({ companyId: id, category }) => ({ id, category })));
  const normalized = audits.map((audit) => {
    const companyId = normalize(audit.companyId, "company audit companyId");
    if (audit.category !== "FOREIGN_PHARMA" && audit.category !== "DOMESTIC_PHARMA") {
      throw new Error("Independent oracle company audit category is invalid");
    }
    if (audit.status !== "HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" &&
        audit.status !== "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME") {
      throw new Error("Independent oracle company audit status is invalid");
    }
    if (typeof audit.capturedAt !== "string" || Number.isNaN(Date.parse(audit.capturedAt)) ||
        new Date(audit.capturedAt).toISOString() !== audit.capturedAt) {
      throw new Error("Independent oracle company audit capturedAt must be a canonical ISO-8601 UTC instant");
    }
    let officialWebsiteUrl: URL;
    try { officialWebsiteUrl = new URL(audit.officialWebsiteUrl); } catch {
      throw new Error("Independent oracle official website URL must be absolute HTTP(S)");
    }
    if (officialWebsiteUrl.protocol !== "http:" && officialWebsiteUrl.protocol !== "https:") {
      throw new Error("Independent oracle official website URL must be absolute HTTP(S)");
    }
    const officialEntryIds = audit.officialEntryIds.map((entryId: string) => normalize(entryId, "officialEntryId"))
      .sort(compare);
    if (new Set(officialEntryIds).size !== officialEntryIds.length) {
      throw new Error("Independent oracle company audit officialEntryIds must be unique");
    }
    if (!Array.isArray(audit.evidenceArtifacts) || audit.evidenceArtifacts.length === 0) {
      throw new Error("Independent oracle company audit evidence artifacts are required");
    }
    const evidenceArtifacts = audit.evidenceArtifacts.map((artifact: IndependentOracleExpectedArtifact) => ({
      logicalKey: normalize(artifact.logicalKey, "company audit evidence logicalKey"),
      contentSha256: artifact.contentSha256
    })).sort((a: IndependentOracleExpectedArtifact, b: IndependentOracleExpectedArtifact) => compare(canonicalJson(a), canonicalJson(b)));
    if (new Set(evidenceArtifacts.map((artifact: IndependentOracleExpectedArtifact) => canonicalJson(artifact))).size !== evidenceArtifacts.length) {
      throw new Error("Independent oracle company audit evidence artifacts must be unique");
    }
    for (const hash of [audit.officialWebsiteSha256, audit.reviewArtifactSha256, audit.reviewerId,
      audit.producerIdentity, ...evidenceArtifacts.map((artifact: IndependentOracleExpectedArtifact) => artifact.contentSha256)]) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Independent oracle company audit hash is invalid");
    }
    if (audit.reviewerDecision !== "APPROVED" || audit.reviewerStatus !== "INDEPENDENT") {
      throw new Error("Independent oracle company audit review is not approved and independent");
    }
    return { ...audit, companyId, officialEntryIds, evidenceArtifacts };
  }).sort((a, b) => compare(a.companyId, b.companyId));
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
