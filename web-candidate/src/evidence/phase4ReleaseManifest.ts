import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  canonicalReleaseMembersSha256,
  releaseMembershipContentSha256,
  type AuthoritativeReleaseMembershipArtifact,
  type ReleaseMember
} from "../crawler/authoritativeReleaseMembership";
import {
  assertIndependentCompanyAuditFreshness,
  assertIndependentCompanyAuditMemberBindings,
  assertSignedReviewerBinding,
  canonicalIndependentCompanyAudits,
  canonicalIndependentCompanyAuditsSha256,
  canonicalIndependentOracleMembers,
  canonicalIndependentOracleMembersSha256,
  independentCoverageSetSha256,
  independentHopChainProvenanceRootSha256,
  independentOracleContentSha256,
  independentReviewProvenanceRootSha256,
  type IndependentSourceSurfaceOracleArtifact
} from "../crawler/independentSourceSurfaceOracle";
import { signedProvenancePayloadSha256, type SignedProvenanceEnvelope }
  from "../crawler/reviewerSignatureTrust";
import { confirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";
import { assertExactCanonicalPhase1InScopeRoster, canonicalPhase1AuthorizedExclusionRecords,
  canonicalPhase1ScopeCounts } from "../data/phase1ScopePolicy";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_COMMIT_SHA = /^[0-9a-f]{40}$/u;

export const PHASE4_COVERAGE_CLAIM_BOUNDARY =
  "Completeness covers only social-recruitment jobs reachable at capture time from recruitment entries publicly linked or explicitly endorsed by the target company's official website.";
export const PHASE4_EXCLUDED_PATH_CLASSES = [
  "HIDDEN_OR_UNLINKED_ATS_TENANTS",
  "WECHAT_ONLY_POSTINGS",
  "THIRD_PARTY_JOB_BOARDS",
  "NOT_PUBLICLY_LINKED_OR_EXPLICITLY_ENDORSED_REGIONAL_LEGAL_ENTITY_BRAND_OR_BUSINESS_UNIT_CHANNELS",
  "OTHER_UNENDORSED_RECRUITMENT_PATHS"
] as const;
export const PHASE4_CONTROLLING_PLAN_PATH =
  "docs/superpowers/plans/2026-07-10-p0-recovery-and-release-evidence.md";

interface TrustedArtifactInput {
  kind: "MEMBERSHIP" | "ORACLE";
  rawBase64: string;
  rawSha256: string;
  contentSha256: string;
}

export interface Phase4ReleaseManifestInput {
  outputRoot: string;
  releaseId: string;
  capturedAt: string;
  commitSha: string;
  controllingPlanSha256: string;
  hashes: { sourceTree: string; runtimeTree: string; roster: string; sourcePlan: string; config: string;
    adapter: string; oracle: string; membership: string };
  trustedArtifacts: TrustedArtifactInput[];
  formalBatches: Array<{ id: string; sha256: string }>;
  independentQa: Array<{ batchId: string; decision: "PASS"; sha256: string }>;
}

export function serializeBlockedPhase4Manifest(input: Phase4ReleaseManifestInput) {
  assertExactKeys(input, ["outputRoot", "releaseId", "capturedAt", "commitSha", "controllingPlanSha256", "hashes",
    "trustedArtifacts", "formalBatches", "independentQa"], "manifest input");
  if (typeof input.outputRoot !== "string" || !input.outputRoot) throw new Error("outputRoot is required");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(input.releaseId)) throw new Error("releaseId is not a safe path segment");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.capturedAt) ||
      Number.isNaN(Date.parse(input.capturedAt)) || new Date(input.capturedAt).toISOString() !== input.capturedAt) {
    throw new Error("capturedAt must be strict UTC milliseconds");
  }
  if (!GIT_COMMIT_SHA.test(input.commitSha)) throw new Error("commit must be a lowercase 40-character Git SHA");
  assertSha(input.controllingPlanSha256, "controlling plan");
  assertExactKeys(input.hashes, ["sourceTree", "runtimeTree", "roster", "sourcePlan", "config", "adapter", "oracle",
    "membership"], "manifest hashes");
  Object.entries(input.hashes).forEach(([name, value]) => assertSha(value, name));
  if (!Array.isArray(input.formalBatches) || !Array.isArray(input.independentQa)) {
    throw new Error("formal batches and independent QA must be arrays");
  }
  if (input.formalBatches.length || input.independentQa.length) {
    throw new Error("production Phase4 formal batch promotion is not implemented; BLOCKED skeleton only");
  }
  const parsed = parseTrustedArtifacts(input.trustedArtifacts);
  const coverage = validateAndProjectCoverage(input, parsed.ORACLE, parsed.MEMBERSHIP);
  const artifacts = (["MEMBERSHIP", "ORACLE"] as const).map((kind) => ({ kind, bytes: parsed[kind].bytes.length,
    rawSha256: parsed[kind].rawSha256, contentSha256: parsed[kind].contentSha256 }));

  const manifest = {
    schemaVersion: "phase4-release-manifest-v3" as const,
    releaseId: input.releaseId,
    capturedAt: input.capturedAt,
    git: { head: input.commitSha, commitBound: true as const },
    coverageClaim: { boundary: PHASE4_COVERAGE_CLAIM_BOUNDARY,
      excludedPathClasses: [...PHASE4_EXCLUDED_PATH_CLASSES],
      noPublicOfficialCareersLinkCompaniesAreCrawlCompletenessBlockers: false as const },
    controllingPlan: { path: PHASE4_CONTROLLING_PLAN_PATH, judgmentUpdatedOn: "2026-07-13" as const,
      sha256: input.controllingPlanSha256 },
    hashes: input.hashes,
    trustedArtifacts: artifacts,
    phase1Scope: { ...canonicalPhase1ScopeCounts,
      authorizedExclusions: canonicalPhase1AuthorizedExclusionRecords.map((record) => ({ ...record })) },
    requiredReleaseDisclosures: [
      `${canonicalPhase1AuthorizedExclusionRecords.map(({ companyId }) => companyId).join(" and ")} are user-authorized Phase 1 exclusions.`,
      "No job completeness claim is made for either authorized Phase 1 exclusion.",
      "job.orz.md accessibility is not a Phase 1 deliverable."
    ],
    coverage,
    formalBatches: input.formalBatches,
    independentQa: input.independentQa,
    release: { status: "BLOCKED" as const, releaseClaim: false as const,
      blockers: ["TWO_FORMAL_BATCHES_NOT_BOUND", "EXTERNAL_PRODUCTION_SIGNATURE_ACCEPTANCE_QA_NOT_BOUND",
        "TRUST_FREEZE_ACTIVE"] as const }
  };
  mkdirSync(input.outputRoot, { recursive: true });
  const outputRoot = realpathSync(input.outputRoot);
  const releaseDirectory = join(outputRoot, input.releaseId);
  mkdirSync(releaseDirectory);
  const directory = join(releaseDirectory, input.capturedAt.replace(/[:+]/gu, "-").replace(/\./gu, "-"));
  mkdirSync(directory);
  assertContained(outputRoot, realpathSync(directory), "manifest output");
  const path = join(directory, "manifest.json");
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { path, manifest, input };
}

interface ParsedArtifact<T> {
  artifact: T;
  bytes: Buffer;
  rawSha256: string;
  contentSha256: string;
}

function parseTrustedArtifacts(artifacts: TrustedArtifactInput[]): {
  ORACLE: ParsedArtifact<IndependentSourceSurfaceOracleArtifact>;
  MEMBERSHIP: ParsedArtifact<AuthoritativeReleaseMembershipArtifact>;
} {
  if (!Array.isArray(artifacts) || artifacts.length !== 2 ||
      new Set(artifacts.map((artifact) => artifact?.kind)).size !== 2 ||
      !artifacts.some(({ kind }) => kind === "ORACLE") || !artifacts.some(({ kind }) => kind === "MEMBERSHIP")) {
    throw new Error("exact membership and oracle trusted artifacts are required");
  }
  const result = {} as Record<"ORACLE" | "MEMBERSHIP", ParsedArtifact<unknown>>;
  for (const artifact of artifacts) {
    assertExactKeys(artifact, ["kind", "rawBase64", "rawSha256", "contentSha256"], "trusted artifact input");
    assertSha(artifact.rawSha256, "artifact digest");
    assertSha(artifact.contentSha256, "artifact content digest");
    const bytes = Buffer.from(artifact.rawBase64, "base64");
    if (bytes.length < 1 || bytes.toString("base64") !== artifact.rawBase64 || digest(bytes) !== artifact.rawSha256) {
      throw new Error(`artifact raw digest mismatch: ${artifact.kind}`);
    }
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`artifact JSON is invalid: ${artifact.kind}`); }
    if (!isRecord(value)) throw new Error(`artifact JSON root must be an object: ${artifact.kind}`);
    result[artifact.kind] = { artifact: value, bytes, rawSha256: artifact.rawSha256,
      contentSha256: artifact.contentSha256 };
  }
  return result as { ORACLE: ParsedArtifact<IndependentSourceSurfaceOracleArtifact>;
    MEMBERSHIP: ParsedArtifact<AuthoritativeReleaseMembershipArtifact> };
}

function validateAndProjectCoverage(input: Phase4ReleaseManifestInput,
  oracleTrusted: ParsedArtifact<IndependentSourceSurfaceOracleArtifact>,
  membershipTrusted: ParsedArtifact<AuthoritativeReleaseMembershipArtifact>) {
  const oracle = oracleTrusted.artifact;
  assertExactKeys(oracle, ["schemaVersion", "kind", "releaseCandidateId", "commitSha", "rosterSha256",
    "sourcePlanSha256", "sourceConfigSha256", "adapterBundleSha256", "authoritativeMembershipDigest",
    "reviewProvenanceRootSha256", "hopChainProvenanceRootSha256", "producerIdentity", "reviewProvenanceSignature",
    "hopChainProvenanceSignature", "companyAudits", "companyAuditSetSha256", "members", "memberSetSha256",
    "coverageSetSha256", "contentSha256"], "oracle artifact");
  if (oracle.schemaVersion !== 3 || oracle.kind !== "FULL_RELEASE") throw new Error("oracle must be schema v3 FULL_RELEASE");
  if (!Array.isArray(oracle.companyAudits) || !Array.isArray(oracle.members)) throw new Error("oracle audits and members must be arrays");
  assertRawOracleTupleIdentifiersCanonical(oracle.companyAudits, oracle.members);
  const canonicalAudits = canonicalIndependentCompanyAudits(oracle.companyAudits);
  assertIndependentCompanyAuditFreshness(canonicalAudits, new Date(input.capturedAt));
  const canonicalMembers = canonicalIndependentOracleMembers(oracle.members);
  if (canonicalJson(canonicalAudits) !== canonicalJson(oracle.companyAudits)) {
    throw new Error("oracle company audits must use canonical representation and order");
  }
  if (canonicalJson(canonicalMembers) !== canonicalJson(oracle.members)) {
    throw new Error("oracle members must use canonical representation and order");
  }
  assertEqualDigest(oracle.companyAuditSetSha256, canonicalIndependentCompanyAuditsSha256(canonicalAudits),
    "oracle company-audit-set hash mismatch");
  assertEqualDigest(oracle.memberSetSha256, canonicalIndependentOracleMembersSha256(canonicalMembers),
    "oracle member-set hash mismatch");
  assertEqualDigest(oracle.coverageSetSha256, independentCoverageSetSha256(canonicalAudits, canonicalMembers),
    "oracle coverage-set hash mismatch");
  assertEqualDigest(oracle.reviewProvenanceRootSha256,
    independentReviewProvenanceRootSha256(canonicalAudits, canonicalMembers),
    "oracle REVIEW provenance root mismatch");
  assertEqualDigest(oracle.hopChainProvenanceRootSha256,
    independentHopChainProvenanceRootSha256(canonicalAudits, canonicalMembers),
    "oracle HOP_CHAIN provenance root mismatch");
  validateProvenanceEnvelope(oracle.reviewProvenanceSignature, "REVIEW", oracle);
  validateProvenanceEnvelope(oracle.hopChainProvenanceSignature, "HOP_CHAIN", oracle);
  assertSignedReviewerBinding(oracle);
  const { contentSha256: _oracleContent, ...oracleContent } = oracle;
  assertEqualDigest(oracle.contentSha256, independentOracleContentSha256(oracleContent), "oracle content hash mismatch");
  assertEqualDigest(oracle.contentSha256, oracleTrusted.contentSha256, "oracle supplied content digest mismatch");
  assertEqualDigest(oracle.contentSha256, input.hashes.oracle, "oracle manifest hash mismatch");
  assertEqualDigest(oracle.rosterSha256, confirmedCompanyRosterV3.membersSha256, "oracle roster hash mismatch");
  assertExactCanonicalPhase1InScopeRoster(canonicalAudits.map(({ companyId: id, category }) => ({ id, category })));
  assertIndependentCompanyAuditMemberBindings(canonicalAudits, canonicalMembers);
  assertUniqueSourceOwnership(canonicalMembers);

  const membership = membershipTrusted.artifact;
  assertExactKeys(membership, ["schemaVersion", "kind", "releaseCandidateId", "commitSha", "rosterSha256",
    "sourcePlanSha256", "sourceConfigSha256", "adapterBundleSha256", "sourceTreeSha256", "runtimeTreeSha256",
    "oracleAuthority", "members", "memberSetSha256", "contentSha256"], "membership artifact");
  if (membership.schemaVersion !== 6 || membership.kind !== "FULL_RELEASE") {
    throw new Error("membership must be schema v6 FULL_RELEASE");
  }
  if (!Array.isArray(membership.members)) throw new Error("membership members must be an array");
  assertRawMembershipTupleIdentifiersCanonical(membership.members);
  const canonicalMembership = canonicalMembershipMembers(membership.members);
  if (canonicalJson(canonicalMembership) !== canonicalJson(membership.members)) {
    throw new Error("membership members must use canonical representation and order");
  }
  assertEqualDigest(membership.memberSetSha256, canonicalReleaseMembersSha256(canonicalMembership),
    "membership member-set hash mismatch");
  const { contentSha256: _membershipContent, ...membershipContent } = membership;
  assertEqualDigest(membership.contentSha256, releaseMembershipContentSha256(membershipContent),
    "membership content hash mismatch");
  assertEqualDigest(membership.contentSha256, membershipTrusted.contentSha256,
    "membership supplied content digest mismatch");
  assertEqualDigest(membership.contentSha256, input.hashes.membership, "membership manifest hash mismatch");
  const oracleProjection = canonicalMembershipMembers(canonicalMembers.map(({ companyId, sourceId, surfaceId,
    channelId, category }) => ({ companyId, sourceId, surfaceId, channelId, category })));
  if (canonicalJson(canonicalMembership) !== canonicalJson(oracleProjection) ||
      membership.memberSetSha256 !== oracle.authoritativeMembershipDigest) {
    throw new Error("membership members do not exactly match oracle member projection");
  }
  validateArtifactBindings(input, oracle, membership, oracleTrusted.rawSha256);

  const noLinkStatus = "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME";
  const hasLinkStatus = "HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME";
  const memberEntryKeys = new Set(canonicalMembers.map(({ companyId, officialEntryId }) => `${companyId}\0${officialEntryId}`));
  const blockedOrMissing = canonicalAudits.flatMap((audit) => audit.officialEntryIds.map((entryId) =>
    memberEntryKeys.has(`${audit.companyId}\0${entryId}`) ? undefined : entryId)).filter(Boolean).length;
  return {
    targetCompanyCount: canonicalAudits.length,
    foreignCompanyCount: canonicalAudits.filter(({ category }) => category === "FOREIGN_PHARMA").length,
    domesticCompanyCount: canonicalAudits.filter(({ category }) => category === "DOMESTIC_PHARMA").length,
    hasPublicOfficialCareersLinkCompanyCount: canonicalAudits.filter(({ status }) => status === hasLinkStatus).length,
    noPublicOfficialCareersLinkCompanyCount: canonicalAudits.filter(({ status }) => status === noLinkStatus).length,
    auditedOfficialEntryCount: canonicalAudits.reduce((count, audit) => count + audit.officialEntryIds.length, 0),
    uniqueSourceCount: new Set(canonicalMembers.map(({ sourceId }) => sourceId)).size,
    uniqueSurfaceCount: new Set(canonicalMembers.map(({ surfaceId }) => surfaceId)).size,
    uniqueChannelCount: new Set(canonicalMembers.map(({ channelId }) => channelId)).size,
    sourceSurfaceChannelMemberTupleCount: canonicalMembers.length,
    blockedOrMissingAuditedOfficialLinkEntryCount: blockedOrMissing
  };
}

function validateArtifactBindings(input: Phase4ReleaseManifestInput, oracle: IndependentSourceSurfaceOracleArtifact,
  membership: AuthoritativeReleaseMembershipArtifact, oracleRawSha256: string): void {
  const expected = { releaseCandidateId: input.releaseId, commitSha: input.commitSha,
    rosterSha256: input.hashes.roster, sourcePlanSha256: input.hashes.sourcePlan,
    sourceConfigSha256: input.hashes.config, adapterBundleSha256: input.hashes.adapter };
  for (const [field, value] of Object.entries(expected)) {
    if (oracle[field as keyof typeof expected] !== value || membership[field as keyof typeof expected] !== value) {
      throw new Error(`trusted artifact identity mismatch: ${field}`);
    }
  }
  assertEqualDigest(input.hashes.roster, confirmedCompanyRosterV3.membersSha256, "manifest roster hash mismatch");
  assertEqualDigest(membership.sourceTreeSha256, input.hashes.sourceTree, "membership source-tree hash mismatch");
  assertEqualDigest(membership.runtimeTreeSha256, input.hashes.runtimeTree, "membership runtime-tree hash mismatch");
  if (!isRecord(membership.oracleAuthority)) throw new Error("membership oracle authority is required");
  assertExactKeys(membership.oracleAuthority, ["oracleRawFileSha256", "oracleContentSha256",
    "reviewProvenanceRootSha256", "hopChainProvenanceRootSha256", "reviewSignedPayloadSha256",
    "hopChainSignedPayloadSha256", "reviewKeyId", "hopChainKeyId", "producerIdentity"],
  "membership oracle authority");
  for (const field of ["oracleRawFileSha256", "oracleContentSha256", "reviewProvenanceRootSha256",
    "hopChainProvenanceRootSha256", "reviewSignedPayloadSha256", "hopChainSignedPayloadSha256",
    "producerIdentity"] as const) assertSha(membership.oracleAuthority[field], `membership oracle authority ${field}`);
  if (typeof membership.oracleAuthority.reviewKeyId !== "string" || !membership.oracleAuthority.reviewKeyId.trim() ||
      typeof membership.oracleAuthority.hopChainKeyId !== "string" || !membership.oracleAuthority.hopChainKeyId.trim()) {
    throw new Error("membership oracle authority key IDs must be nonblank");
  }
  assertEqualDigest(membership.oracleAuthority.oracleRawFileSha256, oracleRawSha256,
    "membership oracle raw digest mismatch");
  assertEqualDigest(membership.oracleAuthority.oracleContentSha256, oracle.contentSha256,
    "membership oracle content digest mismatch");
  assertEqualDigest(membership.oracleAuthority.reviewProvenanceRootSha256, oracle.reviewProvenanceRootSha256,
    "membership oracle review root mismatch");
  assertEqualDigest(membership.oracleAuthority.hopChainProvenanceRootSha256, oracle.hopChainProvenanceRootSha256,
    "membership oracle hop root mismatch");
  if (membership.oracleAuthority.producerIdentity !== oracle.producerIdentity) {
    throw new Error("membership oracle producer identity mismatch");
  }
  if (membership.oracleAuthority.reviewKeyId !== oracle.reviewProvenanceSignature.keyId ||
      membership.oracleAuthority.hopChainKeyId !== oracle.hopChainProvenanceSignature.keyId) {
    throw new Error("membership oracle authority key ID does not match oracle envelope");
  }
  assertEqualDigest(membership.oracleAuthority.reviewSignedPayloadSha256,
    signedProvenancePayloadSha256(oracle.reviewProvenanceSignature.payload),
    "membership REVIEW signed payload digest mismatch");
  assertEqualDigest(membership.oracleAuthority.hopChainSignedPayloadSha256,
    signedProvenancePayloadSha256(oracle.hopChainProvenanceSignature.payload),
    "membership HOP_CHAIN signed payload digest mismatch");
}

function validateProvenanceEnvelope(envelope: SignedProvenanceEnvelope, purpose: "REVIEW" | "HOP_CHAIN",
  oracle: IndependentSourceSurfaceOracleArtifact): void {
  assertExactKeys(envelope, ["keyId", "payload", "signatureBase64"], `oracle ${purpose} envelope`);
  if (typeof envelope.keyId !== "string" || !envelope.keyId.trim() || typeof envelope.signatureBase64 !== "string") {
    throw new Error(`oracle ${purpose} envelope structure is invalid`);
  }
  assertExactKeys(envelope.payload, ["schemaVersion", "purpose", "reviewerIdentitySha256",
    "producerIdentitySha256", "provenanceRootSha256", "authoritativeMembershipDigest",
    "oracleMemberSetSha256"], `oracle ${purpose} envelope payload`);
  const expectedRoot = purpose === "REVIEW" ? oracle.reviewProvenanceRootSha256 : oracle.hopChainProvenanceRootSha256;
  if (envelope.payload.schemaVersion !== 1 || envelope.payload.purpose !== purpose ||
      envelope.payload.provenanceRootSha256 !== expectedRoot ||
      envelope.payload.authoritativeMembershipDigest !== oracle.authoritativeMembershipDigest ||
      envelope.payload.oracleMemberSetSha256 !== oracle.coverageSetSha256 ||
      envelope.payload.producerIdentitySha256 !== oracle.producerIdentity) {
    throw new Error(`oracle ${purpose} envelope payload binding mismatch`);
  }
  for (const [field, value] of Object.entries(envelope.payload)) {
    if (field !== "schemaVersion" && field !== "purpose") assertSha(value as string, `oracle ${purpose} payload ${field}`);
  }
}

function assertRawOracleTupleIdentifiersCanonical(
  audits: IndependentSourceSurfaceOracleArtifact["companyAudits"],
  members: IndependentSourceSurfaceOracleArtifact["members"]): void {
  for (const audit of audits) {
    assertCanonicalTupleId(audit.companyId, "oracle company audit companyId");
    if (!Array.isArray(audit.officialEntryIds)) throw new Error("oracle company audit officialEntryIds must be an array");
    for (const entryId of audit.officialEntryIds) assertCanonicalTupleId(entryId, "oracle company audit officialEntryId");
  }
  for (const member of members) {
    for (const field of ["companyId", "sourceId", "surfaceId", "channelId", "officialEntryId"] as const) {
      assertCanonicalTupleId(member[field], `oracle member ${field}`);
    }
  }
}

function assertRawMembershipTupleIdentifiersCanonical(members: readonly ReleaseMember[]): void {
  for (const member of members) {
    for (const field of ["companyId", "sourceId", "surfaceId", "channelId"] as const) {
      assertCanonicalTupleId(member[field], `membership member ${field}`);
    }
  }
}

function assertCanonicalTupleId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonblank`);
  if (value !== value.trim().normalize("NFC")) throw new Error(`${label} must use raw trim+NFC canonical form`);
}

function assertUniqueSourceOwnership(members: IndependentSourceSurfaceOracleArtifact["members"]): void {
  const owners = new Map<string, string>();
  for (const member of members) {
    const owner = `${member.companyId}\0${member.category}`;
    const prior = owners.get(member.sourceId);
    if (prior && prior !== owner) throw new Error("oracle sourceId has duplicate company ownership");
    owners.set(member.sourceId, owner);
  }
}

function canonicalMembershipMembers(members: readonly ReleaseMember[]): ReleaseMember[] {
  if (!Array.isArray(members)) throw new Error("membership members must be an array");
  const normalized = members.map((member) => ({ companyId: normalizeMember(member.companyId, "companyId"),
    sourceId: normalizeMember(member.sourceId, "sourceId"), surfaceId: normalizeMember(member.surfaceId, "surfaceId"),
    channelId: normalizeMember(member.channelId, "channelId"), category: validCategory(member.category) }));
  const owners = new Map<string, string>();
  for (const member of normalized) {
    const prior = owners.get(member.companyId);
    if (prior && prior !== member.category) throw new Error("membership company category drift");
    owners.set(member.companyId, member.category);
  }
  normalized.sort((a, b) => Buffer.compare(frameMember(a), frameMember(b)));
  for (let index = 1; index < normalized.length; index += 1) {
    if (frameMember(normalized[index - 1]!).equals(frameMember(normalized[index]!))) {
      throw new Error("duplicate membership member after canonicalization");
    }
  }
  return normalized;
}

function normalizeMember(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`membership ${field} must be nonblank`);
  return value.trim().normalize("NFC");
}
function validCategory(value: unknown): ReleaseMember["category"] {
  if (value !== "FOREIGN_PHARMA" && value !== "DOMESTIC_PHARMA") throw new Error("membership category is invalid");
  return value;
}
function frameMember(member: ReleaseMember): Buffer {
  return frameStrings([member.companyId, member.sourceId, member.surfaceId, member.channelId, member.category]);
}
function frameStrings(values: readonly string[]): Buffer {
  const chunks = values.map((value) => Buffer.from(value, "utf8"));
  return Buffer.concat([u32(chunks.length), ...chunks.map((chunk) => Buffer.concat([u32(chunk.length), chunk]))]);
}
function u32(value: number): Buffer { const output = Buffer.allocUnsafe(4); output.writeUInt32BE(value); return output; }

function assertExactKeys(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    throw new Error(`${label} contains missing or unsupported fields`);
  }
}
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compare(a, b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}
function compare(a: string, b: string): number { return Buffer.compare(Buffer.from(a), Buffer.from(b)); }
function assertEqualDigest(actual: string, expected: string, message: string): void {
  if (!SHA256.test(actual) || !SHA256.test(expected) || actual !== expected) throw new Error(message);
}
function digest(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function assertContained(root: string, candidate: string, label: string): void {
  const rel = relative(root, candidate);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`${label} escapes fixed root`);
}
function assertSha(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase sha256 digest`);
}
