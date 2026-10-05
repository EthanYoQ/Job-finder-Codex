// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { certificateFixture, LATER } from "../helpers/sanofiHeaderFixture";
import { sanofiHash } from "../../src/crawler/sanofiChineseNative";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
import { replaySanofiChineseIndependent } from "../../src/crawler/sanofiChineseRenderedTraversal";
import { sanofiCertificateArtifactLocators, type SanofiArtifactCommitment } from "../../src/crawler/traversalCertificate";
import { bindSanofiPersistedArtifacts, type PortableSourceResultRow } from "../../src/db/portablePublicSnapshotRepository";
import { buildFixedCohortCompletenessAudit, parseFixedCohortCompletenessAuditReport,
  type FixedCohortAuditSourceInput } from "../../src/release/fixedCohortCompletenessAudit";
import { evaluateAuthoritativeLaunchReadiness, type AuthoritativeLaunchEvidence,
  type LaunchCertificateEvidence } from "../../src/release/authoritativeLaunchReceipt";
import { P0_LAUNCH_MANIFEST, launchManifestIdentity } from "../../src/release/launchManifest";

let fixture: Awaited<ReturnType<typeof certificateFixture>>;
const sha = "a".repeat(64), sourceId = "source-sanofi-china-social", companyId = "company-sanofi-china";
beforeAll(async () => { fixture = await certificateFixture(); expect(fixture.issued.status).toBe("CERTIFIED"); });

function evidence() {
  if (fixture.issued.status !== "CERTIFIED") throw Error("Expected real offline certificate");
  const certificate = fixture.issued.certificate;
  const locators = sanofiCertificateArtifactLocators(certificate);
  // These independent metadata rows are derived from the archived original
  // fixture artifacts, never from the certificate's inline commitments.
  const artifacts: SanofiArtifactCommitment[] = fixture.result.fetchEvidence!.artifacts
    .filter(a => locators.includes(a.extractorLocator)).map(a => ({
      releaseCandidateId: certificate.binding.releaseCandidateId, batchId: certificate.binding.batchId,
      sourceResultId: certificate.binding.sourceResultId, sourceId, kind: a.kind,
      extractorLocator: a.extractorLocator, sha256: sanofiHash(String(a.body))
    }));
  const row = { ...certificate.binding, id: certificate.binding.sourceResultId,
    atomicCommitState: "COMMITTED", completenessState: "VERIFIED", completenessCertificate: certificate
  } as unknown as PortableSourceResultRow;
  const receipt: LaunchCertificateEvidence = { sourceResultId: row.id, sourceId, companyId,
    category: "FOREIGN_PHARMA", grade: "B", sourceConfigSha256: certificate.binding.sourceConfigSha256,
    canonicalJobSetSha256: certificate.output.canonicalJobSetSha256,
    canonicalRawEvidenceIdSetSha256: canonicalStringSetSha256(replaySanofiChineseIndependent(fixture.captured.pages).rawEvidenceIds),
    certificate, certificateSha256: fixture.issued.certificateSha256 };
  return { row, receipt, artifacts, locators, binding: certificate.binding };
}

async function readMetadata(artifacts: SanofiArtifactCommitment[]) {
  const value = evidence(), findMany = vi.fn(async () => structuredClone(artifacts));
  value.row.sanofiArtifacts = [{ ...value.artifacts[0]!, sha256: "f".repeat(64) }];
  await bindSanofiPersistedArtifacts({ evidenceArtifact: { findMany } } as never, [value.row]);
  return { ...value, findMany, receipt: { ...value.receipt, sanofiArtifacts: value.row.sanofiArtifacts } };
}

function auditInput(receipt: LaunchCertificateEvidence) {
  const sources = P0_LAUNCH_MANIFEST.companies.map((company): FixedCohortAuditSourceInput => {
    const own = company.source.sourceId === sourceId;
    const surface = own ? fixture.p.source.surfaceId! : `surface:${company.source.sourceId}`;
    const channel = own ? fixture.p.expectedChannels![0]!.channelId : `channel:${company.source.sourceId}`;
    const artifactId = `artifact:${company.source.sourceId}`;
    return { sourceResultId: own ? receipt.sourceResultId : `result:${company.source.sourceId}`,
      companyId: company.companyId, sourceId: company.source.sourceId, adapterFamily: "html-table",
      grade: own ? "B" : "C", sourceConfigSha256: own ? receipt.sourceConfigSha256 : sha,
      canonicalJobSetSha256: own ? receipt.canonicalJobSetSha256 : sha,
      canonicalRawEvidenceIdSetSha256: own ? receipt.canonicalRawEvidenceIdSetSha256 : sha,
      certificate: own ? receipt.certificate : null, certificateSha256: own ? receipt.certificateSha256 : null,
      ...(own && receipt.sanofiArtifacts ? { sanofiArtifacts: receipt.sanofiArtifacts } : {}),
      plannedSurfaceIds: [surface], officialSurfaceIds: [surface], plannedChannelIds: [channel], officialChannelIds: [channel],
      evidenceArtifacts: [{ id: artifactId, path: `evidence/${company.source.sourceId}.json`, sha256: sha }],
      paginationEvidence: [{ artifactId, sequence: 0, channelId: channel, requestedCursor: null, returnedCursor: null,
        requestedOffset: 0, returnedOffset: 0, requestedPage: 1, returnedPage: 1, requestedPageSize: 15, returnedPageSize: 2,
        responseFingerprintSha256: sha, rawJobIdSetSha256: sha, validJobIdSetSha256: sha, declaredTotal: 2, declaredCount: 2,
        declaredPages: 1, nextPageSignalBefore: null, nextPageSignalAfter: null, termination: "NEXT_ABSENT",
        anomalyCodes: [], capturedAt: LATER }], expectedEvidenceKind: "COMPLETE_PAGE_TRAVERSAL", expectedJobCount: null,
      pagesVisited: 1, totalPages: 1, finalJobCount: 2, transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
      completenessState: "VERIFIED", atomicCommitState: "COMMITTED", failureCategory: null,
      blockerCode: null, failureDiagnosticCode: null, failureCode: null };
  });
  return { generatedAt: new Date(LATER), releaseCandidateId: evidence().binding.releaseCandidateId,
    batchId: evidence().binding.batchId, observedSourceIds: sources.map(s => s.sourceId), sources };
}

function launchInput(receipt: LaunchCertificateEvidence): AuthoritativeLaunchEvidence {
  const identity = launchManifestIdentity(P0_LAUNCH_MANIFEST), binding = evidence().binding;
  const releaseIdentity = { releaseCandidateId: binding.releaseCandidateId, commitSha: "b".repeat(40),
    rosterSha256: identity.companySetSha256, sourcePlanSha256: identity.sourceIdentitySha256,
    sourceConfigSha256: sha, adapterBundleSha256: sha };
  const batch = (id: string, includeSanofi: boolean) => ({ id, ...releaseIdentity, status: "SUCCESS", finishedAt: LATER,
    certificates: P0_LAUNCH_MANIFEST.companies.map((company): LaunchCertificateEvidence =>
      includeSanofi && company.source.sourceId === sourceId ? receipt : {
        sourceResultId: `${id}:${company.source.sourceId}`, sourceId: company.source.sourceId, companyId: company.companyId,
        category: company.category, grade: "C", sourceConfigSha256: sha, canonicalJobSetSha256: sha,
        canonicalRawEvidenceIdSetSha256: sha, certificate: null, certificateSha256: null }) });
  return { evaluatedAt: new Date(LATER), manifest: P0_LAUNCH_MANIFEST, releaseIdentity,
    source: { commitSha: releaseIdentity.commitSha, sourceTreeSha256: sha, runtimeTreeSha256: sha, buildIdentityContentSha256: sha },
    image: { digest: `sha256:${sha}`, revision: releaseIdentity.commitSha, qualificationSha256: sha,
      buildIdentityContentSha256: sha, securityReceiptSha256: sha, restoreReceiptSha256: sha },
    database: { snapshotSha256: sha, schemaSha256: sha, migrationVersion: "test", migrationManifestSha256: sha, bootstrapReady: true },
    security: { decision: "PASSED", contentSha256: sha, imageDigest: `sha256:${sha}`, evaluatedAt: LATER },
    restore: { decision: "PASSED", contentSha256: sha, verifiedAt: LATER, archiveSha256: sha },
    formalQualification: { roundOneBatchId: binding.batchId, roundTwoBatchId: "other-round", roundOneStateReceiptSha256: sha,
      roundOneAuditSha256: sha, roundOneEvidenceArchiveSha256: sha, roundOneDatabaseArchiveSha256: sha,
      roundTwoAuditSha256: sha, roundTwoEvidenceArchiveSha256: sha },
    batches: [batch(binding.batchId, true), batch("other-round", false)], operationalGates: [] };
}

function sanofiAudit(receipt: LaunchCertificateEvidence) {
  return buildFixedCohortCompletenessAudit(auditInput(receipt)).companies.find(row => row.sourceId === sourceId)!;
}
function launchReasons(receipt: LaunchCertificateEvidence) {
  return evaluateAuthoritativeLaunchReadiness(launchInput(receipt)).receipt.gates
    .find(gate => gate.name === "TWO_ROUND_41_COMPANY_CERTIFICATES")!.reasons;
}
const rejection = () => `CERTIFICATE_INVALID:${evidence().binding.batchId}:${companyId}`;

describe("Sanofi persisted commitments through formal audit and launch", () => {
  it("queries only the exact tuple/locators and seven persisted metadata fields, replacing supplied values", async () => {
    const { artifacts } = evidence(), value = await readMetadata(artifacts);
    expect(value.findMany).toHaveBeenCalledWith({ where: { OR: [{ releaseCandidateId: value.binding.releaseCandidateId,
      batchId: value.binding.batchId, sourceResultId: value.binding.sourceResultId, sourceId,
      extractorLocator: { in: value.locators } }] },
      select: { releaseCandidateId: true, batchId: true, sourceResultId: true, sourceId: true,
        kind: true, sha256: true, extractorLocator: true } });
    expect(value.receipt.sanofiArtifacts).toEqual(artifacts);
    expect(sanofiAudit(value.receipt).blockers).toEqual([]);
    expect(launchReasons(value.receipt)).not.toContain(rejection());
    // The remaining synthetic sources and round timing still block a full launch.
    expect(evaluateAuthoritativeLaunchReadiness(launchInput(value.receipt)).receipt.decision).toBe("NOT_READY");
    const report = buildFixedCohortCompletenessAudit(auditInput(value.receipt));
    expect(parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(report)))).toEqual(report);
  });

  it.each(["missing", "hash", "releaseCandidateId", "batchId", "sourceResultId", "sourceId", "kind", "locator", "duplicate"])(
    "keeps both formal gates closed on persisted %s drift", async kind => {
      const artifacts = structuredClone(evidence().artifacts);
      const oracle = artifacts.find(a => a.kind === "ORACLE_RESULT")!;
      if (kind === "missing") artifacts.splice(artifacts.indexOf(oracle), 1);
      else if (kind === "hash") oracle.sha256 = "f".repeat(64);
      else if (kind === "kind") oracle.kind = "ATS_PAGE";
      else if (kind === "locator") oracle.extractorLocator = "wrong-locator";
      else if (kind === "duplicate") artifacts.push({ ...oracle });
      else oracle[kind as "releaseCandidateId" | "batchId" | "sourceResultId" | "sourceId"] = "wrong";
      const value = await readMetadata(artifacts);
      expect(sanofiAudit(value.receipt).blockers).toContain("CERTIFICATE_INVALID");
      expect(launchReasons(value.receipt)).toContain(rejection());
    }
  );

  it("does not recover missing persisted metadata from the complete inline proof", () => {
    const { receipt } = evidence();
    expect(sanofiAudit(receipt).blockers).toContain("CERTIFICATE_INVALID");
    expect(launchReasons(receipt)).toContain(rejection());
  });

  it("rejects metadata rewritten in a serialized audit even after its outer hash is recomputed", async () => {
    const value = await readMetadata(evidence().artifacts);
    const report = structuredClone(buildFixedCohortCompletenessAudit(auditInput(value.receipt)));
    report.companies.find(row => row.sourceId === sourceId)!.sanofiArtifacts![0]!.sha256 = "f".repeat(64);
    const { contentSha256: _old, ...base } = report;
    report.contentSha256 = createHash("sha256").update(JSON.stringify(base)).digest("hex");
    expect(() => parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(report))))
      .toThrow("Fixed cohort audit company evidence is inconsistent");
  });

  it("rejects unknown metadata fields and keeps historical report shapes unchanged", async () => {
    const value = await readMetadata(evidence().artifacts);
    const report = structuredClone(buildFixedCohortCompletenessAudit(auditInput(value.receipt)));
    Object.assign(report.companies.find(row => row.sourceId === sourceId)!.sanofiArtifacts![0]!, { body: "unrequested" });
    const { contentSha256: _old, ...base } = report;
    report.contentSha256 = createHash("sha256").update(JSON.stringify(base)).digest("hex");
    expect(() => parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(report))))
      .toThrow("Fixed cohort audit company evidence is invalid");
    const historicalShape = buildFixedCohortCompletenessAudit(auditInput(evidence().receipt));
    expect(parseFixedCohortCompletenessAuditReport(Buffer.from(JSON.stringify(historicalShape)))).toEqual(historicalShape);
  });
});
