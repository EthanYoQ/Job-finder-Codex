import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const scratchParent = resolve(repoRoot, ".runtime", ".cache");
const shellPath = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\sh.exe" : "sh";
const fixtures: string[] = [];

function toPosixPath(path: string): string {
  return path.replace(/^([A-Za-z]):/u, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/");
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`, "utf8");
  chmodSync(path, 0o755);
}

function createHarness(round: 1 | 2) {
  mkdirSync(scratchParent, { recursive: true });
  const root = mkdtempSync(resolve(scratchParent, "formal-qualification-runner-"));
  fixtures.push(root);
  writeFileSync(resolve(root, ".vibe-owner.json"), JSON.stringify({
    owner: "formal-qualification-runner.test.ts",
    sourceProject: repoRoot,
    createdAt: new Date().toISOString(),
    ttlHours: 1,
    cleanupCommand: `Remove-Item -LiteralPath '${root.replaceAll("'", "''")}' -Recurse -Force`
  }, null, 2));

  const bin = resolve(root, "bin");
  const runtime = resolve(root, ".runtime");
  mkdirSync(bin);
  mkdirSync(resolve(root, "ops"));
  mkdirSync(resolve(runtime, "security"), { recursive: true });
  mkdirSync(resolve(runtime, "restore"), { recursive: true });
  copyFileSync(resolve(repoRoot, "ops", "run-fixed-cohort-qualification.sh"), resolve(root, "ops", "run-fixed-cohort-qualification.sh"));
  for (const path of [
    resolve(runtime, "image-qualification-receipt.json"),
    resolve(runtime, "security", "production-security-receipt.json"),
    resolve(runtime, "restore", "restore-pass-receipt.json")
  ]) writeFileSync(path, "{}\n", "utf8");

  if (round === 2) {
    const input = resolve(runtime, "formal-input");
    mkdirSync(input);
    for (const file of [
      "round-one.dump",
      "round-one-audit.json",
      "round-one-evidence.tar.gz",
      "round-one-image-qualification-receipt.json",
      "round-one-state-receipt.json"
    ]) writeFileSync(resolve(input, file), file.endsWith(".json") ? "{}\n" : "fixture\n", "utf8");
  }

  const eventLog = resolve(root, "docker-events.log");
  writeFileSync(eventLog, "", "utf8");
  writeExecutable(resolve(bin, "sudo"), 'test "${1:-}" = chown');
  writeExecutable(resolve(bin, "docker"), String.raw`
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
state_host=""
work_host=""
pending_volume=0
dump_name=""
for arg in "$@"; do
  if [ "$pending_volume" = 1 ]; then
    case "$arg" in *:/state) state_host="\${arg%:/state}" ;; *:/app/outputs) work_host="\${arg%:/app/outputs}" ;; esac
    pending_volume=0
  elif [ "$arg" = --volume ]; then
    pending_volume=1
  fi
  case "$arg" in --file=/state/*) dump_name="\${arg#--file=/state/}" ;; esac
done
case "\${1:-}" in
  save) printf 'qualified-image-bytes'; exit 0 ;;
  network)
    [ "\${2:-}" = create ] && exit 0
    [ "\${2:-}" = rm ] && exit 0
    ;;
  rm) exit 0 ;;
  exec)
    case "$*" in
      *pg_isready*) exit 0 ;;
      *"SELECT count(*) FROM pg_database"*) printf '0\n'; exit 0 ;;
    esac
    ;;
  image)
    [ "\${2:-}" = inspect ] && { printf 'sha256:%064d\n' 0; exit 0; }
    ;;
  run)
    case "$*" in
      *"run --detach"*) printf 'fake-postgres\n'; exit 0 ;;
    esac
    ;;
esac
case "$*" in
  *listCurrentPrismaMigrations*) printf '{"schemaSha256":"%064d","migrationVersion":"20260813013000"}' 0 ;;
  *scripts/p0-staged-crawl.ts*) exit "\${FAKE_CRAWL_EXIT:-0}" ;;
  *scripts/p0-fixed-cohort-audit.ts*)
    [ -n "$work_host" ]
    case "$*" in *round-two-audit.json*) audit=round-two-audit.json ;; *) audit=round-one-audit.json ;; esac
    printf '{}\n' > "$work_host/$audit"
    ;;
  *pg_dump*) [ -n "$state_host" ] && [ -n "$dump_name" ]; printf 'database-dump\n' > "$state_host/$dump_name" ;;
  *"tar -czf /state/round-one-evidence.tar.gz"*) printf 'round-one-evidence\n' > "$state_host/round-one-evidence.tar.gz" ;;
  *"tar -czf /state/round-two-evidence.tar.gz"*) printf 'round-two-evidence\n' > "$state_host/round-two-evidence.tar.gz" ;;
  *"tar -czf /state/final-database-backup.tar.gz"*) printf 'final-backup-archive\n' > "$state_host/final-database-backup.tar.gz" ;;
  *"p0-formal-qualification-state.ts capture"*) printf '{"decision":"ROUND_ONE_QUALIFIED"}\n' > "$state_host/round-one-state-receipt.json" ;;
  *"sh ./ops/backup.sh"*)
    mkdir -p "$state_host/final-backup"
    printf 'final-dump\n' > "$state_host/final-backup/jobfinder-20260813T000000Z.dump"
    printf 'checksum\n' > "$state_host/final-backup/jobfinder-20260813T000000Z.dump.sha256"
    printf '{}\n' > "$state_host/final-backup/jobfinder-20260813T000000Z.dump.metadata.json"
    ;;
  *scripts/qualify-backup-restore.ts*) printf '{"decision":"PASSED"}\n' > "$state_host/final-restore-receipt.json" ;;
  *scripts/write-image-qualification-receipt.ts*) printf '{"decision":"PASSED"}\n' > "$state_host/final-image-qualification-receipt.json" ;;
  *scripts/p0-authoritative-launch-receipt.ts*) printf '{"decision":"READY"}\n' > "$state_host/launch-receipt.json" ;;
esac
exit 0`.replaceAll("\\${", "${"));

  function run(extraEnv: NodeJS.ProcessEnv = {}) {
    return spawnSync(shellPath, ["-c", 'cd "$HARNESS_ROOT"; PATH="$FAKE_BIN:$PATH"; export PATH; exec sh ops/run-fixed-cohort-qualification.sh'], {
      encoding: "utf8",
      env: {
        ...process.env,
        HARNESS_ROOT: toPosixPath(root),
        FAKE_BIN: toPosixPath(bin),
        FAKE_DOCKER_LOG: toPosixPath(eventLog),
        FORMAL_ROUND: String(round),
        IMAGE_TAG: "job-finder:test",
        GITHUB_SHA: "a".repeat(40),
        GITHUB_RUN_ID: "12345",
        GITHUB_REPOSITORY: "EthanYoQ/job-finder-rc022-cloud-acceptance",
        ...(round === 2 ? { ROUND_ONE_RUN_ID: "11111" } : {}),
        ...extraEnv
      }
    });
  }

  return { root, runtime, eventLog, run };
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("formal Launch Cohort qualification runner", () => {
  it("runs round one through crawl, audit, evidence capture, image export, and cleanup", () => {
    const harness = createHarness(1);
    const result = harness.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(resolve(harness.runtime, "formal-state", "round-one-state-receipt.json"), "utf8")).toContain("ROUND_ONE_QUALIFIED");
    expect(readFileSync(resolve(harness.runtime, "formal-state", "round-one-qualified-image.tar.gz"))).not.toHaveLength(0);
    const events = readFileSync(harness.eventLog, "utf8");
    expect(events.indexOf("scripts/p0-staged-crawl.ts")).toBeLessThan(events.indexOf("scripts/p0-fixed-cohort-audit.ts"));
    expect(events.indexOf("scripts/p0-fixed-cohort-audit.ts")).toBeLessThan(events.indexOf("p0-formal-qualification-state.ts capture"));
    expect(events).toContain("rm --force job-finder-formal-postgres-12345");
    expect(events).toContain("network rm job-finder-formal-12345");
  });

  it("preserves round-one diagnostics and cleanup while reporting a crawl failure", () => {
    const harness = createHarness(1);
    const result = harness.run({ FAKE_CRAWL_EXIT: "17" });
    expect(result.status).toBe(1);
    expect(readFileSync(resolve(harness.runtime, "formal-state", "round-one-state-receipt.json"), "utf8")).toContain("ROUND_ONE_QUALIFIED");
    const events = readFileSync(harness.eventLog, "utf8");
    expect(events).toContain("scripts/p0-fixed-cohort-audit.ts");
    expect(events).toContain("rm --force job-finder-formal-postgres-12345");
    expect(events).toContain("network rm job-finder-formal-12345");
  });

  it("restores round one, reruns the cohort, qualifies the final backup, and produces READY in round two", () => {
    const harness = createHarness(2);
    const result = harness.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(resolve(harness.runtime, "formal-state", "launch-receipt.json"), "utf8")).toContain("READY");
    const events = readFileSync(harness.eventLog, "utf8");
    const verifyFiles = events.indexOf("p0-formal-qualification-state.ts verify-files");
    const restore = events.indexOf("pg_restore", verifyFiles);
    const verifyRestored = events.indexOf("p0-formal-qualification-state.ts verify-restored", restore);
    const crawl = events.indexOf("scripts/p0-staged-crawl.ts", verifyRestored);
    const backup = events.indexOf("sh ./ops/backup.sh", crawl);
    const qualifyRestore = events.indexOf("scripts/qualify-backup-restore.ts", backup);
    const ready = events.indexOf("scripts/p0-authoritative-launch-receipt.ts", qualifyRestore);
    expect(verifyFiles).toBeGreaterThanOrEqual(0);
    expect(restore).toBeGreaterThan(verifyFiles);
    expect(verifyRestored).toBeGreaterThan(restore);
    expect(crawl).toBeGreaterThan(verifyRestored);
    expect(backup).toBeGreaterThan(crawl);
    expect(qualifyRestore).toBeGreaterThan(backup);
    expect(ready).toBeGreaterThan(qualifyRestore);
    expect(events).toContain("rm --force job-finder-formal-postgres-12345");
  });
});
