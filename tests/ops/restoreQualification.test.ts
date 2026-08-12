import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { qualifyBackupRestore, type RestoreQualificationDeps } from "../../src/ops/restoreQualification";

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
    await expect(qualifyBackupRestore(valid, deps)).rejects.toThrow(/lacks migrations/i);
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
    now: new Date("2026-08-13T00:00:00Z") };
}

function fakeDeps(facts: Partial<Record<string, number>> = {}): RestoreQualificationDeps & Record<string, ReturnType<typeof vi.fn>> {
  return {
    serverVersionNum: vi.fn(async () => "160014"), createDatabase: vi.fn(async () => undefined),
    restoreArchive: vi.fn(async () => undefined), dropDatabase: vi.fn(async () => undefined),
    inspectRestoredDatabase: vi.fn(async () => ({ migrationCount: 3, successfulFullReleaseBatchCount: 1,
      certifiedSourceResultCount: 1, trustedVisibleJobCount: 1, orphanObservationCount: 0,
      orphanSourceResultCount: 0, orphanJobCount: 0, ...facts }))
  } as never;
}
