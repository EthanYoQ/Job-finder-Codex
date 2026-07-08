import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const backupPs1Path = resolve(repoRoot, "ops/backup.ps1");
const backupShPath = resolve(repoRoot, "ops/backup.sh");
const restorePs1Path = resolve(repoRoot, "ops/restore-test.ps1");
const restoreShPath = resolve(repoRoot, "ops/restore-test.sh");

function readRequiredFile(path: string): string {
  expect(existsSync(path), `${path} should exist`).toBe(true);
  return readFileSync(path, "utf8");
}

function expectNoHardcodedSecrets(script: string): void {
  expect(script).not.toMatch(/postgres(ql)?:\/\/[^$"'`\s]+:[^$"'`\s]+@/i);
  expect(script).not.toMatch(/PGPASSWORD\s*=\s*["'][^"']+["']/i);
  expect(script).not.toMatch(/password\s*[:=]\s*["'][^"']+["']/i);
}

describe("backup and restore scripts", () => {
  it("backs up postgres with compressed dumps, 14 day retention, and env-driven credentials", () => {
    const backupPs1 = readRequiredFile(backupPs1Path);
    const backupSh = readRequiredFile(backupShPath);

    for (const script of [backupPs1, backupSh]) {
      expect(script).toMatch(/pg_dump/);
      expect(script).toMatch(/14/);
      expect(script).toMatch(/DATABASE_URL|PGHOST|PGUSER|PGDATABASE/);
      expect(script).toMatch(/gzip|\.sql\.gz|Compress-Archive|GZipStream/i);
      expectNoHardcodedSecrets(script);
    }
  });

  it("restores only into test-style databases and refuses production targets", () => {
    const restorePs1 = readRequiredFile(restorePs1Path);
    const restoreSh = readRequiredFile(restoreShPath);

    for (const script of [restorePs1, restoreSh]) {
      expect(script).toMatch(/test|restore/i);
      expect(script).toMatch(/refus|abort|throw|exit/i);
      expect(script).toMatch(/pg_restore|psql/);
      expect(script).toMatch(/DATABASE_URL|PGHOST|PGUSER|PGDATABASE/);
      expectNoHardcodedSecrets(script);
    }
  });
});
