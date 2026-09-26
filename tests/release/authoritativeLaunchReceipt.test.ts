import { describe, expect, it } from "vitest";
import { certificateSha256, evaluateAuthoritativeLaunchReadiness, type AuthoritativeLaunchEvidence } from "../../src/release/authoritativeLaunchReceipt";
import { P0_LAUNCH_MANIFEST, launchManifestIdentity } from "../../src/release/launchManifest";

describe("authoritative launch receipt", () => {
  it("rejects synthetic certificate shells even when all 41 bindings and hashes look consistent", () => {
    const result = evaluateAuthoritativeLaunchReadiness(fixture());
    expect(result.exitCode).toBe(1);
    expect(result.receipt.decision).toBe("NOT_READY");
    expect(result.receipt.gates.find(({ name }) => name === "TWO_ROUND_41_COMPANY_CERTIFICATES")?.reasons)
      .toContain("CERTIFICATE_INVALID:round-1:company-gsk-china");
  });

  it("emits deterministic NOT_READY for a C-grade foreign company without partial-ready wording", () => {
    const input = fixture();
    input.batches[1]!.certificates[0]!.grade = "C";
    input.batches[1]!.certificates[0]!.certificateSha256 = certificateSha256(input.batches[1]!.certificates[0]!.certificate);
    const first = evaluateAuthoritativeLaunchReadiness(input);
    const second = evaluateAuthoritativeLaunchReadiness(input);
    expect(first.exitCode).toBe(1);
    expect(first.receipt.decision).toBe("NOT_READY");
    expect(first.receipt.contentSha256).toBe(second.receipt.contentSha256);
    expect(JSON.stringify(first.receipt)).not.toContain("PARTIAL");
  });

  it("rejects rounds less than 12 hours apart or older than 72 hours while allowing job-set changes", () => {
    const close = fixture(); close.batches[1]!.finishedAt = "2026-08-12T19:59:59.999Z";
    expect(evaluateAuthoritativeLaunchReadiness(close).receipt.gates.find(({ name }) =>
      name === "TWO_ROUND_41_COMPANY_CERTIFICATES")?.reasons).toContain("BATCH_INTERVAL_BELOW_12_HOURS");
    const stale = fixture(); stale.batches[0]!.finishedAt = "2026-08-09T00:00:00.000Z";
    expect(evaluateAuthoritativeLaunchReadiness(stale).exitCode).toBe(1);
  });

  it("rejects an exact-image qualification that is not bound to the running build identity", () => {
    const input = fixture();
    input.image.buildIdentityContentSha256 = "f".repeat(64);
    expect(evaluateAuthoritativeLaunchReadiness(input).receipt.gates.find(({ name }) =>
      name === "RELEASE_IDENTITY")?.reasons).toContain("IMAGE_BUILD_IDENTITY_MISMATCH");
  });

  it("binds both formal rounds and their archived evidence into the authoritative receipt", () => {
    const input = fixture();
    const result = evaluateAuthoritativeLaunchReadiness(input);
    expect(result.receipt.identity.roundOneStateReceiptSha256).toBe(input.formalQualification.roundOneStateReceiptSha256);
    input.formalQualification.roundTwoBatchId = "replacement-round";
    expect(evaluateAuthoritativeLaunchReadiness(input).receipt.gates.find(({ name }) =>
      name === "FORMAL_QUALIFICATION_EVIDENCE")?.reasons).toContain("FORMAL_BATCH_BINDING_MISMATCH");
  });
});

function fixture(): AuthoritativeLaunchEvidence {
  const manifestIdentity = launchManifestIdentity(P0_LAUNCH_MANIFEST), sha = "a".repeat(64);
  const releaseIdentity = { releaseCandidateId: "rc", commitSha: "b".repeat(40),
    rosterSha256: manifestIdentity.companySetSha256, sourcePlanSha256: manifestIdentity.sourceIdentitySha256,
    sourceConfigSha256: "c".repeat(64), adapterBundleSha256: "d".repeat(64) };
  const batch = (id: string, finishedAt: string) => ({ id, ...releaseIdentity, status: "SUCCESS", finishedAt,
    certificates: P0_LAUNCH_MANIFEST.companies.map((company, index) => {
      const sourceResultId = `${id}-result-${index}`, sourceConfigSha256 = releaseIdentity.sourceConfigSha256;
      const certificate = { schemaVersion: 1, grade: "A", binding: { releaseCandidateId: releaseIdentity.releaseCandidateId,
        batchId: id, sourceResultId, sourceId: company.source.sourceId, sourceConfigSha256 },
        scope: { companyId: company.companyId, sourceId: company.source.sourceId },
        output: { canonicalJobSetSha256: sha } };
      return { sourceResultId, companyId: company.companyId, sourceId: company.source.sourceId,
        category: company.category, grade: "A" as const, sourceConfigSha256, canonicalJobSetSha256: sha,
        canonicalRawEvidenceIdSetSha256: sha,
        certificate, certificateSha256: certificateSha256(certificate) };
    }) });
  return { evaluatedAt: new Date("2026-08-13T00:00:00.000Z"), manifest: P0_LAUNCH_MANIFEST,
    source: { commitSha: releaseIdentity.commitSha, sourceTreeSha256: sha, runtimeTreeSha256: sha,
      buildIdentityContentSha256: sha },
    image: { digest: `sha256:${sha}`, revision: releaseIdentity.commitSha, qualificationSha256: sha,
      buildIdentityContentSha256: sha,
      securityReceiptSha256: sha, restoreReceiptSha256: sha },
    database: { snapshotSha256: sha, schemaSha256: sha, migrationVersion: "20260813013000",
      migrationManifestSha256: sha, bootstrapReady: true },
    security: { decision: "PASSED", contentSha256: sha, imageDigest: `sha256:${sha}`, evaluatedAt: "2026-08-12T23:00:00.000Z" },
    restore: { decision: "PASSED", contentSha256: sha, verifiedAt: "2026-08-12T22:00:00.000Z",
      archiveSha256: sha },
    formalQualification: { roundOneBatchId: "round-1", roundTwoBatchId: "round-2",
      roundOneStateReceiptSha256: sha, roundOneAuditSha256: sha, roundOneEvidenceArchiveSha256: sha,
      roundOneDatabaseArchiveSha256: sha, roundTwoAuditSha256: sha, roundTwoEvidenceArchiveSha256: sha },
    releaseIdentity, batches: [batch("round-1", "2026-08-12T08:00:00.000Z"), batch("round-2", "2026-08-12T21:00:00.000Z")],
    operationalGates: [{ name: "container-ready", passed: true, evidenceSha256: sha, reason: "readyz=200" }]
  };
}
