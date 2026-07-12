import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { canonicalReleaseMembersSha256, releaseMembershipContentSha256 } from "../../../src/crawler/authoritativeReleaseMembership";
import {
  canonicalIndependentCompanyAuditsSha256,
  canonicalIndependentOracleMembersSha256,
  independentCoverageSetSha256,
  independentHopChainProvenanceRootSha256,
  independentOracleContentSha256,
  independentOracleValueSha256,
  independentReviewProvenanceRootSha256,
  sourcePlanOracleConfigSha256,
  type IndependentCompanyAudit,
  type IndependentSourceSurfaceOracleMember
} from "../../../src/crawler/independentSourceSurfaceOracle";
import { confirmedCompanyRosterV3, confirmedCompanyRosterV3Members } from "../../../src/data/confirmedCompanyRosterV3";
import { expectedChannelSetHash, type SourceCrawlPlan } from "../../../src/crawler/sourcePlan";
import { signedProvenancePayloadSha256, type SignedProvenanceEnvelope } from "../../../src/crawler/reviewerSignatureTrust";

export type V3ScenarioMode = "valid-empty" | "freeze" | "missing-audit" | "no-link-member" | "no-link-entry" |
  "has-link-no-member" | "audited-entry-omitted" | "member-entry-absent" | "member-category-mismatch" |
  "audit-set-tamper" | "coverage-tamper" | "review-root-tamper" | "hop-root-tamper" |
  "payload-coverage-tamper" | "roster-hash-tamper" | "stale-audit" | "boundary-audit" |
  "future-audit" | "mixed-age-audits";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const reviewerId = "a".repeat(64);
const producerIdentity = "b".repeat(64);
const first = confirmedCompanyRosterV3Members[0]!;
const channelId = "source:source-1:default";

const plan = { adapterId: "official-json", company: { id: first.id, officialChineseName: "公司", category: first.category },
  source: { id: "source-1", companyId: first.id, kind: "SOCIAL", atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE", surfaceId: "surface-1", officialEntryUrl: "https://example.com/jobs",
    officialChainEvidenceUrl: "https://example.com/careers" },
  json: { jobsPath: "jobs", fields: { sourceJobId: "id", officialTitle: "title", officialUrl: "url", locationRaw: "location" } },
  expectedChannels: [{ channelId, kind: "SOCIAL" }],
  expectedChannelSetHash: expectedChannelSetHash([{ channelId, kind: "SOCIAL" }]) } satisfies SourceCrawlPlan;

function companyAudits(): IndependentCompanyAudit[] {
  return confirmedCompanyRosterV3Members.map(({ id: companyId, category }) => ({ companyId, category,
    status: "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME", capturedAt: "2026-07-12T00:00:00.000Z",
    officialWebsiteUrl: `https://example.com/${companyId}`, officialWebsiteSha256: sha(`website:${companyId}`),
    officialEntryIds: [], evidenceArtifacts: [{ logicalKey: `official-website/${companyId}`,
      contentSha256: sha(`evidence:${companyId}`) }], reviewerId, reviewArtifactSha256: sha(`review:${companyId}`),
    producerIdentity, reviewerDecision: "APPROVED", reviewerStatus: "INDEPENDENT" }));
}

function sourceMember(): IndependentSourceSurfaceOracleMember {
  return { companyId: first.id, category: first.category, sourceId: plan.source.id, surfaceId: plan.source.surfaceId,
    channelId, officialEntryId: "entry-1", reviewerId, reviewArtifactSha256: sha("review:member"), producerIdentity,
    reviewerDecision: "APPROVED", reviewerStatus: "INDEPENDENT", officialEntrySha256: independentOracleValueSha256(plan.source.officialEntryUrl),
    officialFinalSha256: independentOracleValueSha256(plan.source.officialChainEvidenceUrl), officialHopChainSha256: sha("hop"),
    chinaScope: "RESOLVED", businessUnitScope: "RESOLVED", legalEntityScope: "RESOLVED", channelScope: "RESOLVED",
    adapterId: plan.adapterId, adapterConfigSha256: sourcePlanOracleConfigSha256(plan), completenessEvidenceKind: "OFFICIAL_TOTAL",
    completenessEvidenceLocatorSha256: sha("locator"), completenessEvidenceContentSha256: sha("content"),
    expectedArtifacts: [{ logicalKey: "page-0", contentSha256: sha("page") }] };
}

export async function runIndependentOracleV3Scenario(mode: V3ScenarioMode) {
  const dir = await mkdtemp(join(tmpdir(), "independent-oracle-v3-"));
  try {
    let audits = companyAudits();
    let members: IndependentSourceSurfaceOracleMember[] = [];
    let plans: SourceCrawlPlan[] = [];
    const linked = (entryIds: string[]) => { audits[0] = { ...audits[0]!,
      status: "HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME", officialEntryIds: entryIds }; };
    if (["no-link-member", "audited-entry-omitted", "member-entry-absent", "member-category-mismatch"].includes(mode)) {
      members = [sourceMember()]; plans = [plan];
    }
    if (mode === "has-link-no-member") linked(["entry-1"]);
    if (mode === "no-link-entry") audits[0] = { ...audits[0]!, officialEntryIds: ["entry-1"] };
    if (mode === "audited-entry-omitted") linked(["entry-1", "entry-2"]);
    if (mode === "member-entry-absent") linked(["entry-2"]);
    if (mode === "member-category-mismatch") {
      linked(["entry-1"]); members[0] = { ...members[0]!,
        category: first.category === "FOREIGN_PHARMA" ? "DOMESTIC_PHARMA" : "FOREIGN_PHARMA" };
    }
    if (mode === "stale-audit") audits = audits.map((audit) => ({ ...audit,
      capturedAt: "2026-07-11T11:59:59.999Z" }));
    if (mode === "boundary-audit") audits = audits.map((audit) => ({ ...audit,
      capturedAt: "2026-07-11T12:00:00.000Z" }));
    if (mode === "future-audit") audits = audits.map((audit) => ({ ...audit,
      capturedAt: "2026-07-12T12:00:00.001Z" }));
    if (mode === "mixed-age-audits") audits[0] = { ...audits[0]!,
      capturedAt: "2026-07-11T11:59:59.999Z" };
    const releaseMembers = plans.flatMap((value) => value.expectedChannels!.map((channel) => ({ companyId: value.company.id,
      sourceId: value.source.id, surfaceId: value.source.surfaceId!, channelId: channel.channelId, category: first.category })));
    const membershipDigest = canonicalReleaseMembersSha256(releaseMembers);
    const rosterSha256 = mode === "roster-hash-tamper" ? "f".repeat(64) : confirmedCompanyRosterV3.membersSha256;
    const binding = { releaseCandidateId: "rc-v3", commitSha: "1".repeat(40), rosterSha256,
      sourcePlanSha256: "2".repeat(64), sourceConfigSha256: "3".repeat(64), adapterBundleSha256: "4".repeat(64) };
    const memberSetSha256 = canonicalIndependentOracleMembersSha256(members);
    const companyAuditSetSha256 = canonicalIndependentCompanyAuditsSha256(audits);
    const coverageSetSha256 = independentCoverageSetSha256(audits, members);
    const reviewProvenanceRootSha256 = independentReviewProvenanceRootSha256(audits, members);
    const hopChainProvenanceRootSha256 = independentHopChainProvenanceRootSha256(audits, members);
    const envelope = (purpose: "REVIEW" | "HOP_CHAIN", provenanceRootSha256: string): SignedProvenanceEnvelope => ({
      keyId: "not-a-production-key", payload: { schemaVersion: 1, purpose, reviewerIdentitySha256: reviewerId,
        producerIdentitySha256: producerIdentity, provenanceRootSha256, authoritativeMembershipDigest: membershipDigest,
        oracleMemberSetSha256: coverageSetSha256 }, signatureBase64: Buffer.alloc(64).toString("base64") });
    const base: any = { schemaVersion: 3, kind: "FULL_RELEASE", ...binding, authoritativeMembershipDigest: membershipDigest,
      reviewProvenanceRootSha256, hopChainProvenanceRootSha256, producerIdentity,
      reviewProvenanceSignature: envelope("REVIEW", reviewProvenanceRootSha256),
      hopChainProvenanceSignature: envelope("HOP_CHAIN", hopChainProvenanceRootSha256),
      companyAudits: audits, companyAuditSetSha256, members, memberSetSha256, coverageSetSha256 };
    if (mode === "missing-audit") base.companyAudits = audits.slice(1);
    if (mode === "audit-set-tamper") base.companyAuditSetSha256 = "0".repeat(64);
    if (mode === "coverage-tamper") base.coverageSetSha256 = "0".repeat(64);
    if (mode === "review-root-tamper") base.reviewProvenanceRootSha256 = "0".repeat(64);
    if (mode === "hop-root-tamper") base.hopChainProvenanceRootSha256 = "0".repeat(64);
    if (mode === "payload-coverage-tamper") base.reviewProvenanceSignature.payload.oracleMemberSetSha256 = "0".repeat(64);
    const oracle = { ...base, contentSha256: independentOracleContentSha256(base) };
    const oracleBytes = Buffer.from(JSON.stringify(oracle)); const oraclePath = join(dir, "oracle.json");
    await writeFile(oraclePath, oracleBytes);
    const membershipBase = { schemaVersion: 6 as const, kind: "FULL_RELEASE" as const, ...binding,
      sourceTreeSha256: "5".repeat(64), runtimeTreeSha256: "6".repeat(64),
      oracleAuthority: { oracleRawFileSha256: sha(oracleBytes), oracleContentSha256: oracle.contentSha256,
        reviewProvenanceRootSha256: oracle.reviewProvenanceRootSha256,
        hopChainProvenanceRootSha256: oracle.hopChainProvenanceRootSha256,
        reviewSignedPayloadSha256: signedProvenancePayloadSha256(oracle.reviewProvenanceSignature.payload),
        hopChainSignedPayloadSha256: signedProvenancePayloadSha256(oracle.hopChainProvenanceSignature.payload),
        reviewKeyId: oracle.reviewProvenanceSignature.keyId, hopChainKeyId: oracle.hopChainProvenanceSignature.keyId,
        producerIdentity }, members: releaseMembers, memberSetSha256: membershipDigest };
    const membership = { ...membershipBase, contentSha256: releaseMembershipContentSha256(membershipBase) };
    const membershipBytes = Buffer.from(JSON.stringify(membership)); const membershipPath = join(dir, "membership.json");
    await writeFile(membershipPath, membershipBytes);
    const oracleAuthorityUrl = pathToFileURL(resolve("src/crawler/sourceSurfaceOracleAuthority.ts")).href;
    const membershipAuthorityUrl = pathToFileURL(resolve("src/crawler/releaseMembershipAuthority.ts")).href;
    const validatorUrl = pathToFileURL(resolve("src/crawler/independentSourceSurfaceOracle.ts")).href;
    const identity = { ...binding, batchKind: "FULL_RELEASE", ownerId: "test", expectedPlannedSourceIds: plans.map((value) => value.source.id),
      expectedPlannedSourceSetSha256: "0".repeat(64), expectedPlannedSourceCount: plans.length };
    const script = `Promise.all([import('${oracleAuthorityUrl}'),import('${membershipAuthorityUrl}'),import('${validatorUrl}')]).then(async([o,m,v])=>{const oracle=await o.getStartupSourceSurfaceOracle();if(${JSON.stringify(mode)}==='freeze'){const a=oracle.artifact.companyAudits[0];console.log(JSON.stringify([Object.isFrozen(a),Object.isFrozen(a.officialEntryIds),Object.isFrozen(a.evidenceArtifacts),Object.isFrozen(a.evidenceArtifacts[0]),Object.isFrozen(oracle.artifact.companyAudits),Object.isFrozen(oracle.artifact.members),Object.isFrozen(oracle.artifact)]));return}try{v.validateIndependentSourceSurfaceOracle(oracle,await m.getStartupReleaseMembership(),${JSON.stringify(identity)},${JSON.stringify(plans)},new Date('2026-07-12T12:00:00.000Z'));console.log('ACCEPTED')}catch(e){console.log(e.message)}})`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--eval", script], { cwd: process.cwd(), encoding: "utf8",
      env: { ...process.env, P0_FULL_RELEASE_ORACLE_FILE: oraclePath, P0_FULL_RELEASE_ORACLE_FILE_SHA256: sha(oracleBytes),
        P0_FULL_RELEASE_MEMBERSHIP_FILE: membershipPath, P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256: sha(membershipBytes) } });
    return { status: child.status, output: child.stdout.trim(), stderr: child.stderr.trim() };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
