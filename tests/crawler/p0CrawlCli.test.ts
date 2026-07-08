import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runCli(args: string[]): string {
  const result = spawnSync(
    process.platform === "win32" ? "cmd.exe" : "npx",
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-crawl.ts", ...args]
      : ["tsx", "scripts/p0-crawl.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8"
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
      encoding: "utf8"
    }
  );

  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0) {
    throw new Error("Expected CLI command to fail");
  }

  return output;
}

describe("P0 crawl CLI", () => {
  it("prints usage without requiring database or Tavily credentials", () => {
    const output = runCli(["--help"]);

    expect(output).toContain("Usage: npm run p0:crawl -- [--source-id <sourceId>]");
    expect(output).toContain("--source-id");
    expect(output).toContain("--force");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  });

  it("validates source ids before requiring Tavily credentials", () => {
    const output = runCliExpectingFailure(["--source-id", "missing-source"]);

    expect(output).toContain("Unknown source id: missing-source");
    expect(output).not.toContain("Tavily extraction is not configured");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  });
});
