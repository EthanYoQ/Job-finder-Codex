import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runCli(args: string[]): string {
  return execFileSync(
    process.platform === "win32" ? "cmd.exe" : "npx",
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-crawl.ts", ...args]
      : ["tsx", "scripts/p0-crawl.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}

describe("P0 crawl CLI", () => {
  it("prints usage without requiring database or Tavily credentials", () => {
    const output = runCli(["--help"]);

    expect(output).toContain("Usage: npm run p0:crawl -- [--source-id <sourceId>]");
    expect(output).toContain("--source-id");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  });
});
