import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("P0 readiness CLI", () => {
  it("prints the current readiness blockers without secrets", () => {
    let output = "";
    let exitCode = 0;
    const command = process.platform === "win32" ? "cmd.exe" : "npx";
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-readiness-report.ts"]
        : ["tsx", "scripts/p0-readiness-report.ts"];

    try {
      output = execFileSync(command, args, {
        cwd: process.cwd(),
        encoding: "utf8"
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      exitCode = failure.status ?? 1;
      output = failure.stdout ?? "";
    }

    expect(exitCode).toBe(1);
    expect(output).toContain("# P0 Readiness Report");
    expect(output).toContain("Can launch P0: no");
    expect(output).toContain("VERIFIED_COMPANIES_BELOW_50");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  });
});
