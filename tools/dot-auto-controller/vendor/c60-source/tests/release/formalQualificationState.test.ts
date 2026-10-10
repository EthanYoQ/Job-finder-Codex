import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertFormalQualificationSecondRoundMayStart,
  createFormalQualificationRoundOneReceipt,
  parseFormalQualificationRoundOneReceipt
} from "../../src/release/formalQualificationState";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceRevision = "a".repeat(40);
const imageDigest = `sha256:${sha("qualified image")}`;
const buildIdentityContentSha256 = sha("build-identity");
const archiveBytes = Buffer.from("postgres archive");
const auditBytes = Buffer.from("fixed cohort audit");
const evidenceArchiveBytes = Buffer.from("formal crawl evidence archive");
const imageQualificationBytes = Buffer.from("image qualification");

function qualifiedReceipt(overrides: Record<string, unknown> = {}) {
  return createFormalQualificationRoundOneReceipt({
    repository: "EthanYoQ/job-finder-rc022-cloud-acceptance",
    workflowRunId: "31710000000",
    sourceRevision,
    imageDigest,
    buildIdentityContentSha256,
    releaseCandidateId: "p0-launch-a1b2c3d",
    batchId: "11111111-1111-4111-8111-111111111111",
    batchStatus: "SUCCESS",
    batchFinishedAt: new Date("2026-08-13T00:00:00.000Z"),
    databaseArchiveSha256: sha(archiveBytes.toString()),
    databaseArchiveBytes: archiveBytes.length,
    auditSha256: sha(auditBytes.toString()),
    auditContentSha256: sha("audit-content"),
    evidenceArchiveSha256: sha(evidenceArchiveBytes.toString()),
    evidenceArchiveBytes: evidenceArchiveBytes.length,
    imageQualificationContentSha256: sha(imageQualificationBytes.toString()),
    auditDecision: "AUDIT_COMPLETE",
    companyCount: 41,
    foreignCompanyCount: 30,
    blockerCount: 0,
    capturedAt: new Date("2026-08-13T00:05:00.000Z"),
    ...overrides
  });
}

describe("formal qualification round-one state", () => {
  it("round-trips exact evidence", () => {
    const receipt = qualifiedReceipt();
    const parsed = parseFormalQualificationRoundOneReceipt(Buffer.from(JSON.stringify(receipt)), {
      repository: receipt.repository,
      workflowRunId: receipt.workflowRunId,
      sourceRevision,
      imageDigest,
      buildIdentityContentSha256,
      databaseArchiveSha256: receipt.databaseArchiveSha256,
      databaseArchiveBytes: archiveBytes.length,
      auditSha256: receipt.auditSha256,
      auditContentSha256: receipt.auditContentSha256,
      evidenceArchiveSha256: receipt.evidenceArchiveSha256,
      evidenceArchiveBytes: evidenceArchiveBytes.length,
      imageQualificationContentSha256: receipt.imageQualificationContentSha256,
      now: new Date("2026-08-13T12:00:00.000Z")
    });

    expect(parsed).toEqual(receipt);
  });

  it.each([
    "2026-08-13T05:59:59.999Z",
    "2026-08-16T00:00:00.001Z"
  ])("rejects a second-round start outside the 6 through 72 hour window: %s", (now) => {
    expect(() => assertFormalQualificationSecondRoundMayStart(qualifiedReceipt(), new Date(now)))
      .toThrow(/6.*72/u);
  });

  it.each([
    "2026-08-13T06:00:00.000Z",
    "2026-08-13T09:00:00.000Z",
    "2026-08-16T00:00:00.000Z"
  ])("allows a qualified second round inside the inclusive 6 through 72 hour window: %s", (now) => {
    const receipt = qualifiedReceipt();
    expect(assertFormalQualificationSecondRoundMayStart(receipt, new Date(now))).toEqual(receipt);
  });

  it.each([
    { batchStatus: "INCOMPLETE" },
    { auditDecision: "AUDIT_INVALID" },
    { companyCount: 40 },
    { companyCount: 49 },
    { foreignCompanyCount: 29 },
    { blockerCount: 1 }
  ])("keeps an incomplete first round diagnostic-only: %#", (override) => {
    const receipt = qualifiedReceipt(override);
    expect(receipt.decision).toBe("ROUND_ONE_DIAGNOSTIC");
    expect(() => assertFormalQualificationSecondRoundMayStart(receipt,
      new Date("2026-08-13T06:00:00.000Z"))).toThrow(/qualified/u);
  });

  it("rejects replacement evidence, extra fields, and a self-consistent future receipt", () => {
    const receipt = qualifiedReceipt();
    const expected = {
      repository: receipt.repository,
      workflowRunId: receipt.workflowRunId,
      sourceRevision,
      imageDigest,
      buildIdentityContentSha256,
      databaseArchiveSha256: receipt.databaseArchiveSha256,
      databaseArchiveBytes: archiveBytes.length,
      auditSha256: receipt.auditSha256,
      auditContentSha256: receipt.auditContentSha256,
      evidenceArchiveSha256: receipt.evidenceArchiveSha256,
      evidenceArchiveBytes: evidenceArchiveBytes.length,
      imageQualificationContentSha256: receipt.imageQualificationContentSha256,
      now: new Date("2026-08-13T12:00:00.000Z")
    };
    expect(() => parseFormalQualificationRoundOneReceipt(Buffer.from(JSON.stringify(receipt)), {
      ...expected, databaseArchiveSha256: sha("replacement")
    })).toThrow(/identity/u);
    expect(() => parseFormalQualificationRoundOneReceipt(Buffer.from(JSON.stringify(receipt)), {
      ...expected, evidenceArchiveSha256: sha("replacement-evidence")
    })).toThrow(/identity/u);
    expect(() => parseFormalQualificationRoundOneReceipt(Buffer.from(JSON.stringify(receipt)), {
      ...expected, imageDigest: `sha256:${sha("different exact image")}`
    })).toThrow(/identity/u);
    expect(() => parseFormalQualificationRoundOneReceipt(Buffer.from(JSON.stringify({ ...receipt, extra: true })), expected))
      .toThrow(/schema/u);
    const future = qualifiedReceipt({ capturedAt: new Date("2026-08-13T12:06:00.000Z") });
    expect(() => parseFormalQualificationRoundOneReceipt(Buffer.from(JSON.stringify(future)), expected))
      .toThrow(/time/u);
  });
});
