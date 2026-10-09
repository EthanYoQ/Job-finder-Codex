import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI_PROCESS_TEST_TIMEOUT_MS = 15_000;
const IDENTITY_ARGS = [
  "--release-candidate-id",
  "p0-rc-20260710-001",
  "--commit-sha",
  "0123456789abcdef0123456789abcdef01234567",
  "--roster-sha256",
  "a".repeat(64),
  "--source-plan-sha256",
  "b".repeat(64),
  "--source-config-sha256",
  "c".repeat(64),
  "--adapter-bundle-sha256",
  "d".repeat(64),
  "--batch-kind",
  "MANUAL_SOURCE",
  "--owner-id",
  "phase1-task4-cli-test"
];

function runCli(args: string[]): string {
  const result = spawnSync(
    process.platform === "win32" ? "cmd.exe" : "npx",
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-crawl.ts", ...args]
      : ["tsx", "scripts/p0-crawl.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, CRAWL_ATTEMPT_DIR: resolve(mkdtempSync(resolve(tmpdir(), "p0-crawl-cli-")), "attempts") }
    }
  );

  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== 0) {
    throw new Error(output);
  }

  return output;
}

function runCliExpectingFailure(args: string[]): string {
  const result = spawnSync(
    process.platform === "win32" ? "cmd.exe" : "npx",
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-crawl.ts", ...args]
      : ["tsx", "scripts/p0-crawl.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, CRAWL_ATTEMPT_DIR: resolve(mkdtempSync(resolve(tmpdir(), "p0-crawl-cli-")), "attempts") }
    }
  );

  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0) {
    throw new Error("Expected CLI command to fail");
  }

  return output;
}

describe("P0 crawl CLI", () => {
  it("does not accept caller-supplied formal release identity flags",()=>{
    const source=readFileSync("scripts/p0-crawl.ts","utf8");
    expect(source).not.toMatch(/--release-candidate-id|--commit-sha|--roster-sha256|--source-plan-sha256|--source-config-sha256|--adapter-bundle-sha256/u);
    const output=runCliExpectingFailure(["--release-candidate-id","rc-forged"]);
    expect(output).toContain("Unknown argument");
    expect(output).not.toMatch(/Prisma|DATABASE_URL/u);
  }, CLI_PROCESS_TEST_TIMEOUT_MS);
  it("prints usage without requiring database or Tavily credentials", () => {
    const output = runCli(["--help"]);

    expect(output).toContain("Usage: npm run p0:crawl -- [--force]");
    expect(output).toContain("--force");
    expect(output).toContain("identity is derived");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  }, CLI_PROCESS_TEST_TIMEOUT_MS);

  it("does not advertise Tavily as a formal readiness evidence fetcher", () => {
    const output = runCli(["--help"]);

    expect(output).toContain("Runs configured P0 official-source crawl plans");
    expect(output).not.toContain("Tavily-backed readiness");
  }, CLI_PROCESS_TEST_TIMEOUT_MS);

  it("rejects partial selection as non-formal before database dependencies", () => {
    const output = runCliExpectingFailure(["--source-id","missing-source"]);
    expect(output).toContain("Partial diagnostic selection cannot certify formal release evidence");
    expect(output).not.toContain("Tavily extraction is not configured");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  }, CLI_PROCESS_TEST_TIMEOUT_MS);

  it("fails closed when production release authority is unavailable before database dependencies", () => {
    const output = runCliExpectingFailure([]);
    expect(output).toMatch(/Production release authority is unavailable/);
    expect(output).not.toContain("DATABASE_URL");
  }, CLI_PROCESS_TEST_TIMEOUT_MS);

  it("rejects caller identity flags before loading database dependencies", () => {
    const output = runCliExpectingFailure(IDENTITY_ARGS);
    expect(output).toContain("caller-supplied release identity is forbidden");
    expect(output).not.toContain("DATABASE_URL");
  }, CLI_PROCESS_TEST_TIMEOUT_MS);
});
