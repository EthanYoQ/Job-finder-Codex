import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { publishBackupAttemptReceipt, readBackupAttemptEvidence } from "../../src/ops/backupAttemptReceipt";

describe("backup attempt receipts", () => {
  it("makes a new failed attempt override an older valid archive immediately", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "jobfinder-backup-attempt-"));
    const path = resolve(root, "latest-backup-attempt.json");
    const archiveName = "jobfinder-20260813T010000Z.dump";
    const archive = Buffer.from("valid-backup");
    await writeFile(resolve(root, archiveName), archive);
    await publishBackupAttemptReceipt(path, { decision: "SUCCEEDED", attemptedAt: "2026-08-13T01:00:00.000Z",
      completedAt: "2026-08-13T01:01:00.000Z", archiveName,
      archiveSha256: createHash("sha256").update(archive).digest("hex") });
    expect(await readBackupAttemptEvidence(path)).toMatchObject({ latestBackupSucceeded: true });

    await publishBackupAttemptReceipt(path, { decision: "RUNNING", attemptedAt: "2026-08-13T02:00:00.000Z" });
    expect(await readBackupAttemptEvidence(path)).toEqual({ latestBackupAt: "2026-08-13T02:00:00.000Z",
      latestBackupSucceeded: false });
    await publishBackupAttemptReceipt(path, { decision: "FAILED", attemptedAt: "2026-08-13T02:00:00.000Z",
      completedAt: "2026-08-13T02:00:03.000Z" });
    expect(await readBackupAttemptEvidence(path)).toEqual({ latestBackupAt: "2026-08-13T02:00:03.000Z",
      latestBackupSucceeded: false });
  });

  it("fails closed for a tampered or truncated receipt", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "jobfinder-backup-attempt-"));
    const path = resolve(root, "latest-backup-attempt.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, decision: "SUCCEEDED",
      attemptedAt: "2026-08-13T01:00:00.000Z", contentSha256: "0".repeat(64) }));
    expect(await readBackupAttemptEvidence(path)).toEqual({ latestBackupSucceeded: false });
    expect((await readFile(path, "utf8")).length).toBeGreaterThan(0);
  });

  it("rejects non-canonical, reversed, and future attempt timestamps", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "jobfinder-backup-attempt-"));
    const path = resolve(root, "latest-backup-attempt.json");
    await expect(publishBackupAttemptReceipt(path, { decision: "RUNNING",
      attemptedAt: "2026-08-13 01:00:00Z" })).rejects.toThrow(/date is invalid/u);
    await expect(publishBackupAttemptReceipt(path, { decision: "FAILED",
      attemptedAt: "2026-08-13T02:00:00.000Z", completedAt: "2026-08-13T01:00:00.000Z" }))
      .rejects.toThrow(/timestamps are invalid/u);

    const archiveName = "jobfinder-20990101T000000Z.dump";
    const archive = Buffer.from("future-backup");
    await writeFile(resolve(root, archiveName), archive);
    const base = { schemaVersion: 1, decision: "SUCCEEDED", attemptedAt: "2099-01-01T00:00:00.000Z",
      completedAt: "2099-01-01T00:01:00.000Z", archiveName,
      archiveSha256: createHash("sha256").update(archive).digest("hex") };
    const contentSha256 = createHash("sha256").update(JSON.stringify(base)).digest("hex");
    await writeFile(path, `${JSON.stringify({ ...base, contentSha256 })}\n`);
    expect(await readBackupAttemptEvidence(path)).toEqual({ latestBackupSucceeded: false });
  });
});
