import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const backupPs1Path = resolve(repoRoot, "ops/backup.ps1");
const backupShPath = resolve(repoRoot, "ops/backup.sh");
const restorePs1Path = resolve(repoRoot, "ops/restore-test.ps1");
const restoreShPath = resolve(repoRoot, "ops/restore-test.sh");
const isWindows = process.platform === "win32";
const gitShPath = isWindows ? "C:\\Program Files\\Git\\bin\\sh.exe" : "sh";
const portablePwshPath = isWindows
  ? "C:\\Users\\Public\\Tools\\PowerShell\\7.6.3\\pwsh.exe"
  : "pwsh";

function readRequiredFile(path: string): string {
  expect(existsSync(path), `${path} should exist`).toBe(true);
  return readFileSync(path, "utf8");
}

function expectNoHardcodedSecrets(script: string): void {
  expect(script).not.toMatch(/postgres(ql)?:\/\/[^$"'`\s]+:[^$"'`\s]+@/i);
  expect(script).not.toMatch(/PGPASSWORD\s*=\s*["'][^"']+["']/i);
  expect(script).not.toMatch(/password\s*[:=]\s*["'][^"']+["']/i);
}

function toPosixPath(path: string): string {
  return path.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/");
}

function writeFakeTool(binDir: string, name: string, body: string): void {
  const path = resolve(binDir, name);
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`, "utf8");
  chmodSync(path, 0o755);
}

function createShHarness() {
  const root = mkdtempSync(resolve(tmpdir(), "jobfinder-backup-test-"));
  const binDir = resolve(root, "bin");
  const backupDir = resolve(root, "backups");
  const eventLog = resolve(root, "events.log");
  mkdirSync(binDir);
  mkdirSync(backupDir);
  writeFileSync(eventLog, "", "utf8");

  writeFakeTool(binDir, "date", 'printf "%s\\n" "20260712T150000Z"');
  writeFakeTool(binDir, "flock", '[ "${FAKE_FLOCK_FAIL:-0}" != "1" ]');
  writeFakeTool(
    binDir,
    "pg_dump",
    `if [ "\${1:-}" = "--version" ]; then echo "pg_dump (PostgreSQL) 16.14"; exit 0; fi
[ "\${FAKE_PG_DUMP_FAIL:-0}" != "1" ] || exit 12
file=""
database_url=""
for arg in "$@"; do case "$arg" in --file=*) file="\${arg#--file=}" ;; --dbname=*) database_url="\${arg#--dbname=}" ;; esac; done
[ -z "\${EXPECTED_LIBPQ_DATABASE_URL:-}" ] || [ "$database_url" = "$EXPECTED_LIBPQ_DATABASE_URL" ] || exit 16
[ -n "$file" ] || exit 13
printf 'custom-archive' > "$file"
printf 'pg_dump\\n' >> "$EVENT_LOG"`
  );
  writeFakeTool(
    binDir,
    "pg_restore",
    `if [ "\${1:-}" = "--version" ]; then echo "pg_restore (PostgreSQL) 16.14"; exit 0; fi
if [ "\${1:-}" = "--list" ]; then [ "\${FAKE_PG_RESTORE_LIST_FAIL:-0}" != "1" ] || exit 14; printf 'list\\n' >> "$EVENT_LOG"; exit 0; fi
database_url=""
for arg in "$@"; do case "$arg" in --dbname=*) database_url="\${arg#--dbname=}" ;; esac; done
[ -z "\${EXPECTED_LIBPQ_DATABASE_URL:-}" ] || [ "$database_url" = "$EXPECTED_LIBPQ_DATABASE_URL" ] || exit 16
printf 'restore\\n' >> "$EVENT_LOG"`
  );
  writeFakeTool(
    binDir,
    "sha256sum",
    `if [ "\${FAKE_SHA_MISMATCH:-0}" = "1" ]; then printf '%064d  %s\\n' 0 "$1"; else /usr/bin/sha256sum "$@"; fi`
  );
  writeFakeTool(
    binDir,
    "mv",
    `case "\${2:-}" in *.sha256) [ "\${FAKE_MARKER_MOVE_FAIL:-0}" != "1" ] || exit 15 ;; esac
printf 'mv:%s\\n' "\${2:-}" >> "$EVENT_LOG"
/usr/bin/mv "$@"`
  );
  writeFakeTool(
    binDir,
    "psql",
    `if [ "\${1:-}" = "--version" ]; then echo "psql (PostgreSQL) 16.14"; exit 0; fi
database_url=""
for arg in "$@"; do case "$arg" in --dbname=*) database_url="\${arg#--dbname=}" ;; esac; done
[ -z "\${EXPECTED_LIBPQ_DATABASE_URL:-}" ] || [ "$database_url" = "$EXPECTED_LIBPQ_DATABASE_URL" ] || exit 16
case "$*" in *server_version_num*) printf '%s\\n' "\${FAKE_SERVER_VERSION_NUM:-160014}" ;; *to_regclass*) printf '%s\\n' "\${FAKE_MIGRATIONS_PRESENT:-0}" ;; *) printf '%s\\n' "\${FAKE_TARGET_NONEMPTY:-0}" ;; esac
printf 'psql-check\\n' >> "$EVENT_LOG"`
  );

  const baseEnv = {
    ...process.env,
    FAKE_BIN: toPosixPath(binDir),
    EVENT_LOG: toPosixPath(eventLog),
    BACKUP_DIR: toPosixPath(backupDir),
    BACKUP_RETENTION_DAYS: "14",
    DATABASE_URL: "postgresql://db:5432/jobfinder"
  };

  function run(scriptPath: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
    return spawnSync(
      gitShPath,
      ["-c", 'PATH="$FAKE_BIN:$PATH"; export PATH; exec sh "$@"', "harness", toPosixPath(scriptPath), ...args],
      { env: { ...baseEnv, ...env }, encoding: "utf8" }
    );
  }

  return { root, backupDir, eventLog, run };
}

describe("backup and restore scripts", () => {
  it("publishes PostgreSQL 16 custom-format backups with a SHA256 sidecar as the final commit marker", () => {
    const backupPs1 = readRequiredFile(backupPs1Path);
    const backupSh = readRequiredFile(backupShPath);

    for (const script of [backupPs1, backupSh]) {
      expect(script).toMatch(/pg_dump/);
      expect(script).toMatch(/pg_dump[^\n]*(--version|version)/i);
      expect(script).toMatch(/PostgreSQL\)?\s*16|major[^\n]*16|version[^\n]*16/i);
      expect(script).toMatch(/--format(?:=|\s+)custom|-Fc/);
      expect(script).toMatch(/pg_restore[^\n]*--list/);
      expect(script).toMatch(/\.partial/);
      expect(script).toMatch(/SHA256|sha256sum|Get-FileHash/i);
      expect(script).toMatch(/\.sha256/);
      expect(script).toMatch(/14/);
      expect(script).toMatch(/DATABASE_URL|PGHOST|PGUSER|PGDATABASE/);
      expect(script).toMatch(/\.dump/);
      expect(script).not.toMatch(/gzip|\.sql\.gz|Compress-Archive|GZipStream/i);
      expectNoHardcodedSecrets(script);
    }

    expect(backupSh.indexOf('mv "$PARTIAL_ARCHIVE_PATH" "$ARCHIVE_PATH"')).toBeGreaterThan(-1);
    expect(backupSh.indexOf('mv "$PARTIAL_CHECKSUM_PATH" "$CHECKSUM_PATH"')).toBeGreaterThan(
      backupSh.indexOf('mv "$PARTIAL_ARCHIVE_PATH" "$ARCHIVE_PATH"')
    );
    expect(backupPs1.indexOf("Move-Item -LiteralPath $partialArchivePath -Destination $archivePath")).toBeGreaterThan(-1);
    expect(backupPs1.indexOf("Move-Item -LiteralPath $partialChecksumPath -Destination $checksumPath")).toBeGreaterThan(
      backupPs1.indexOf("Move-Item -LiteralPath $partialArchivePath -Destination $archivePath")
    );
    expect(backupSh).toContain("RETENTION_FIND_DAYS=$((BACKUP_RETENTION_DAYS - 1))");
    expect(backupSh).toContain('-mtime +"$RETENTION_FIND_DAYS"');
    expect(backupPs1.match(/\$lockStream\.Dispose\(\)/g)).toHaveLength(1);
    expect(backupPs1).toMatch(/finally\s*\{[\s\S]*\$lockStream\.Dispose\(\)/);
    expect(backupPs1).toMatch(/\$retentionDaysRaw[^\n]*BACKUP_RETENTION_DAYS/);
    expect(backupPs1).toMatch(/\$retentionDaysRaw\s+-notmatch\s+['"]\^\[0-9\]\+\$['"]/);
    expect(backupPs1.indexOf("$retentionDaysRaw -notmatch")).toBeLessThan(
      backupPs1.indexOf("[int]$retentionDaysRaw")
    );
  });

  it("verifies the sidecar and archive before restoring only into test-style databases", () => {
    const restorePs1 = readRequiredFile(restorePs1Path);
    const restoreSh = readRequiredFile(restoreShPath);

    for (const script of [restorePs1, restoreSh]) {
      expect(script).toMatch(/test|restore/i);
      expect(script).toMatch(/refus|abort|throw|exit/i);
      expect(script).toMatch(/\.sha256/);
      expect(script).toMatch(/SHA256|sha256sum|Get-FileHash/i);
      expect(script).toMatch(/pg_restore[^\n]*--list/);
      expect(script).toMatch(/pg_restore[^\n]*--exit-on-error/);
      expect(script).toMatch(/--single-transaction/);
      expect(script).toMatch(/TARGET_DATABASE_URL/);
      expect(script).not.toContain('TARGET_DATABASE_URL="${TARGET_DATABASE_URL:-${DATABASE_URL:-}}"');
      expect(script).not.toMatch(/else\s*\{\s*\$env:DATABASE_URL/);
      expect(script).toMatch(/psql/);
      expect(script).not.toMatch(/\|\s*(?:&\s*)?psql|gunzip/i);
      expect(script).toMatch(/DATABASE_URL|PGHOST|PGUSER|PGDATABASE/);
      expectNoHardcodedSecrets(script);
    }
  });

  it("publishes the checksum last and cleans up owned artifacts after injected tool failures", () => {
    const success = createShHarness();
    const successResult = success.run(backupShPath);
    expect(successResult.status, successResult.stderr).toBe(0);
    const archive = resolve(success.backupDir, "jobfinder-20260712T150000Z.dump");
    expect(existsSync(archive)).toBe(true);
    expect(existsSync(`${archive}.sha256`)).toBe(true);
    expect(existsSync(`${archive}.partial`)).toBe(false);
    expect(readFileSync(success.eventLog, "utf8").trim().split(/\r?\n/).at(-1)).toBe(
      `mv:${toPosixPath(archive)}.sha256`
    );

    for (const failureEnv of [
      { FAKE_PG_DUMP_FAIL: "1" },
      { FAKE_PG_RESTORE_LIST_FAIL: "1" },
      { FAKE_MARKER_MOVE_FAIL: "1" }
    ]) {
      const failure = createShHarness();
      const result = failure.run(backupShPath, [], failureEnv);
      expect(result.status).not.toBe(0);
      expect(existsSync(resolve(failure.backupDir, "jobfinder-20260712T150000Z.dump"))).toBe(false);
      expect(existsSync(resolve(failure.backupDir, "jobfinder-20260712T150000Z.dump.sha256"))).toBe(false);
      expect(existsSync(resolve(failure.backupDir, "jobfinder-20260712T150000Z.dump.partial"))).toBe(false);
    }
  }, 15_000);

  it("removes Prisma-only schema parameters before invoking PostgreSQL command-line tools", () => {
    const harness = createShHarness();
    const backupResult = harness.run(backupShPath, [], {
      DATABASE_URL: "postgresql://db:5432/jobfinder?schema=public&sslmode=require",
      EXPECTED_LIBPQ_DATABASE_URL: "postgresql://db:5432/jobfinder?sslmode=require"
    });
    expect(backupResult.status, backupResult.stderr).toBe(0);

    const archive = resolve(harness.backupDir, "jobfinder-20260712T150000Z.dump");
    const restoreResult = harness.run(restoreShPath, [toPosixPath(archive)], {
      DATABASE_URL: "",
      TARGET_DATABASE_URL: "postgresql://db:5432/rc_restore?sslmode=require&schema=public",
      EXPECTED_LIBPQ_DATABASE_URL: "postgresql://db:5432/rc_restore?sslmode=require"
    });
    expect(restoreResult.status, restoreResult.stderr).toBe(0);
  });

  it("rejects invalid retention, a held lock, and same-name artifacts without deleting them", () => {
    for (const retention of ["-1", "6", "15", "abc"]) {
      const harness = createShHarness();
      const result = harness.run(backupShPath, [], { BACKUP_RETENTION_DAYS: retention });
      expect(result.status).not.toBe(0);
      expect(readFileSync(harness.eventLog, "utf8")).toBe("");
    }

    const locked = createShHarness();
    expect(locked.run(backupShPath, [], { FAKE_FLOCK_FAIL: "1" }).status).not.toBe(0);

    const collision = createShHarness();
    const archive = resolve(collision.backupDir, "jobfinder-20260712T150000Z.dump");
    writeFileSync(archive, "belongs-to-another-process", "utf8");
    const collisionResult = collision.run(backupShPath);
    expect(collisionResult.status).not.toBe(0);
    expect(readFileSync(archive, "utf8")).toBe("belongs-to-another-process");
  });

  it("PowerShell rejects non-integer retention before requiring database credentials", () => {
    for (const retention of ["7.5", "7e0"]) {
      const result = spawnSync(
        portablePwshPath,
        ["-NoProfile", "-NonInteractive", "-File", backupPs1Path],
        {
          env: {
            ...process.env,
            BACKUP_RETENTION_DAYS: retention,
            DATABASE_URL: "",
            BACKUP_DATABASE_URL: ""
          },
          encoding: "utf8"
        }
      );
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/BACKUP_RETENTION_DAYS must be an integer/);
    }
  });

  it("retains files younger than 14 days and removes files once they reach 14 days", () => {
    const harness = createShHarness();
    const retained = resolve(harness.backupDir, "jobfinder-retained.dump");
    const expired = resolve(harness.backupDir, "jobfinder-expired.dump");
    for (const path of [retained, `${retained}.sha256`, expired, `${expired}.sha256`]) {
      writeFileSync(path, "old", "utf8");
    }
    const now = Date.now();
    const retainedTime = new Date(now - 13.5 * 24 * 60 * 60 * 1000);
    const expiredTime = new Date(now - 14.5 * 24 * 60 * 60 * 1000);
    for (const path of [retained, `${retained}.sha256`]) utimesSync(path, retainedTime, retainedTime);
    for (const path of [expired, `${expired}.sha256`]) utimesSync(path, expiredTime, expiredTime);

    const result = harness.run(backupShPath);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(retained)).toBe(true);
    expect(existsSync(`${retained}.sha256`)).toBe(true);
    expect(existsSync(expired)).toBe(false);
    expect(existsSync(`${expired}.sha256`)).toBe(false);
  });

  it("restores only after canonical checksum, PG16 tools, and an empty target are verified", () => {
    const harness = createShHarness();
    expect(harness.run(backupShPath).status).toBe(0);
    const archive = resolve(harness.backupDir, "jobfinder-20260712T150000Z.dump");
    const archivePosix = toPosixPath(archive);
    writeFileSync(harness.eventLog, "", "utf8");

    const restored = harness.run(restoreShPath, [archivePosix], {
      DATABASE_URL: "",
      TARGET_DATABASE_URL: "postgresql://db:5432/rc_restore"
    });
    expect(restored.status, restored.stderr).toBe(0);
    expect(readFileSync(harness.eventLog, "utf8")).toMatch(/psql-check[\s\S]*psql-check[\s\S]*list[\s\S]*restore/);

    for (const scenario of [
      { env: { DATABASE_URL: "", TARGET_DATABASE_URL: "postgresql://db:5432/jobfinder" } },
      { env: { DATABASE_URL: "postgresql://db:5432/rc_restore", TARGET_DATABASE_URL: "" } },
      { env: { DATABASE_URL: "", TARGET_DATABASE_URL: "postgresql://db:5432/rc_restore", FAKE_TARGET_NONEMPTY: "1" } },
      { env: { DATABASE_URL: "", TARGET_DATABASE_URL: "postgresql://db:5432/rc_restore", FAKE_MIGRATIONS_PRESENT: "1" } }
    ]) {
      writeFileSync(harness.eventLog, "", "utf8");
      const result = harness.run(restoreShPath, [archivePosix], scenario.env);
      expect(result.status).not.toBe(0);
      expect(readFileSync(harness.eventLog, "utf8")).not.toMatch(/^restore$/m);
    }

    const originalMarker = readFileSync(`${archive}.sha256`, "utf8");
    for (const marker of [
      originalMarker.replace(/  .+\n$/, "  wrong.dump\n"),
      `${originalMarker}extra\n`,
      `${"0".repeat(64)}  ${archive.split(/[\\/]/).at(-1)}\n`
    ]) {
      writeFileSync(`${archive}.sha256`, marker, "utf8");
      const result = harness.run(restoreShPath, [archivePosix], {
        DATABASE_URL: "",
        TARGET_DATABASE_URL: "postgresql://db:5432/rc_restore"
      });
      expect(result.status).not.toBe(0);
    }
  }, 60_000);
});
