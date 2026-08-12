import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listCurrentPrismaMigrations } from "../../src/db/prismaMigrationManifest";
import { qualifyBackupRestore, readRestoreQualificationEvidence, type RestoreQualificationDeps } from "../../src/ops/restoreQualification";

const root = resolve(".runtime/.cache/restore-qualification-test");
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("backup restore qualification", () => {
  it("restores into a generated empty database, verifies relationships, writes a receipt, and drops it", async () => {
    const input = fixture();
    const deps = fakeDeps();
    const receipt = await qualifyBackupRestore(input, deps);
    expect(receipt).toMatchObject({ decision: "PASSED", sourceServerVersionNum: "160014" });
    expect(JSON.parse(readFileSync(input.receiptPath, "utf8"))).toMatchObject({ decision: "PASSED" });
    expect(deps.createDatabase).toHaveBeenCalledWith(input.adminDatabaseUrl, expect.stringMatching(/^jobfinder_restore_/));
    expect(deps.dropDatabase).toHaveBeenCalledWith(input.adminDatabaseUrl, expect.stringMatching(/^jobfinder_restore_/));
    expect(vi.mocked(deps.dropDatabase).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(deps.publishReceipt!).mock.invocationCallOrder.at(-1)!);
  });

  it("publishes FAILED after a create acknowledgement is lost or cleanup fails, never preserving an old PASS", async () => {
    for (const failure of ["create", "drop"] as const) {
      const input = fixture();
      writeFileSync(input.receiptPath, JSON.stringify({ schemaVersion: 1, decision: "PASSED", verifiedAt: input.now.toISOString(), contentSha256: "0".repeat(64) }));
      const deps = fakeDeps();
      if (failure === "create") vi.mocked(deps.createDatabase).mockRejectedValueOnce(new Error("connection lost after server create"));
      else vi.mocked(deps.dropDatabase).mockRejectedValueOnce(new Error("drop failed"));
      await expect(qualifyBackupRestore(input, deps)).rejects.toThrow();
      expect(deps.dropDatabase).toHaveBeenCalledTimes(1);
      const persisted = JSON.parse(readFileSync(input.receiptPath, "utf8"));
      expect(persisted).toMatchObject({ decision: "FAILED" });
      expect(await readRestoreQualificationEvidence(input.receiptPath)).toMatchObject({ latestRestoreSucceeded: false });
    }
  });

  it("invalidates an old PASS before work and rejects a self-consistent truncated PASSED receipt", async () => {
    const input = fixture();
    const truncatedBase = { schemaVersion: 1, decision: "PASSED", verifiedAt: input.now.toISOString() };
    const contentSha256 = createHash("sha256").update(JSON.stringify(truncatedBase)).digest("hex");
    writeFileSync(input.receiptPath, JSON.stringify({ ...truncatedBase, contentSha256 }));
    expect(await readRestoreQualificationEvidence(input.receiptPath)).toMatchObject({ latestRestoreSucceeded: false });

    const deps = fakeDeps();
    vi.mocked(deps.serverVersionNum).mockRejectedValueOnce(new Error("target unavailable"));
    await expect(qualifyBackupRestore(input, deps)).rejects.toThrow(/target unavailable/);
    expect(vi.mocked(deps.invalidateReceipt!).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(deps.publishReceipt!).mock.invocationCallOrder[0]!);
    expect(JSON.parse(readFileSync(input.receiptPath, "utf8"))).toMatchObject({ decision: "FAILED" });
  });

  it("rejects self-consistent PASSED receipts with zero evidence, orphans, or a stale migration manifest", async () => {
    for (const verification of [
      { ...validFacts(), qualifiedEvidenceChainCount: 0 },
      { ...validFacts(), orphanJobCount: 1 },
      { ...validFacts(), migrations: [] }
    ]) {
      const input = fixture(), base = { schemaVersion: 1, decision: "PASSED", verifiedAt: input.now.toISOString(),
        archiveSha256: "a".repeat(64), backupMetadataSha256: "b".repeat(64), sourceServerVersionNum: "160014",
        targetServerVersionNum: "160014", verification };
      writeFileSync(input.receiptPath, JSON.stringify({ ...base,
        contentSha256: createHash("sha256").update(JSON.stringify(base)).digest("hex") }));
      expect(await readRestoreQualificationEvidence(input.receiptPath, input.expectedMigrations))
        .toMatchObject({ latestRestoreSucceeded: false });
    }
  });

  it("rejects a mismatched migration manifest or unrelated certificate and job counts", async () => {
    const input = fixture();
    const migrationMismatch = fakeDeps();
    vi.mocked(migrationMismatch.inspectRestoredDatabase).mockResolvedValueOnce({ ...validFacts(), migrations: [] });
    await expect(qualifyBackupRestore(input, migrationMismatch)).rejects.toThrow(/migration manifest/i);
    const unrelated = fakeDeps({ qualifiedEvidenceChainCount: 0 });
    await expect(qualifyBackupRestore(input, unrelated)).rejects.toThrow(/evidence chain/i);
  });

  it("rejects a damaged archive before creating a database", async () => {
    const input = fixture();
    writeFileSync(input.archivePath, "damaged");
    const deps = fakeDeps();
    await expect(qualifyBackupRestore(input, deps)).rejects.toThrow(/(?:hash|checksum).*mismatch/i);
    expect(deps.createDatabase).not.toHaveBeenCalled();
  });

  it("rejects an incompatible source version and always drops a created target after relationship failure", async () => {
    const incompatible = fixture("150010");
    await expect(qualifyBackupRestore(incompatible, fakeDeps())).rejects.toThrow(/source server/i);
    const valid = fixture();
    const deps = fakeDeps({ trustedVisibleJobCount: 0 });
    await expect(qualifyBackupRestore(valid, deps)).rejects.toThrow(/evidence chain/i);
    expect(deps.dropDatabase).toHaveBeenCalledTimes(1);
  });
});

function fixture(serverVersionNum = "160014") {
  mkdirSync(root, { recursive: true });
  const archivePath = resolve(root, "backup.dump"), metadataPath = `${archivePath}.metadata.json`;
  const checksumPath = `${archivePath}.sha256`;
  const receiptPath = resolve(root, "restore-receipt.json"), archive = Buffer.from("archive");
  writeFileSync(archivePath, archive);
  writeFileSync(checksumPath, `${createHash("sha256").update(archive).digest("hex")}  backup.dump\n`);
  writeFileSync(metadataPath, JSON.stringify({ schemaVersion: 1,
    archiveSha256: createHash("sha256").update(archive).digest("hex"), database: { serverVersionNum } }));
  return { archivePath, checksumPath, metadataPath, receiptPath, adminDatabaseUrl: "postgresql://user:secret@db/postgres",
    expectedMigrations: listCurrentPrismaMigrations(process.cwd()),
    now: new Date("2026-08-13T00:00:00Z") };
}

function fakeDeps(facts: Partial<Record<string, number>> = {}): RestoreQualificationDeps & Record<string, ReturnType<typeof vi.fn>> {
  return {
    serverVersionNum: vi.fn(async () => "160014"), createDatabase: vi.fn(async () => undefined),
    restoreArchive: vi.fn(async () => undefined), dropDatabase: vi.fn(async () => undefined),
    publishReceipt: vi.fn(async (path: string, value: unknown) => {
      mkdirSync(resolve(path, ".."), { recursive: true }); writeFileSync(path, `${JSON.stringify(value)}\n`);
    }),
    invalidateReceipt: vi.fn(async (path: string) => { rmSync(path, { force: true }); }),
    inspectRestoredDatabase: vi.fn(async () => ({ ...validFacts(), ...facts }))
  } as never;
}

function validFacts() {
  return { migrations: listCurrentPrismaMigrations(process.cwd()), successfulFullReleaseBatchCount: 1,
    certifiedSourceResultCount: 1, trustedVisibleJobCount: 1, qualifiedEvidenceChainCount: 1,
    orphanObservationCount: 0, orphanSourceResultCount: 0, orphanJobCount: 0,
    mismatchedJobSourceCompanyCount: 0 };
}
