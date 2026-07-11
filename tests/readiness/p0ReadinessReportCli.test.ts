import { execFileSync,spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("P0 readiness CLI", () => {
  it("requires formal DB mode", () => {
    const command = process.platform === "win32" ? "cmd.exe" : "npx";
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-readiness-report.ts"]
        : ["tsx", "scripts/p0-readiness-report.ts"];

    const result=spawnSync(command,args,{cwd:process.cwd(),encoding:"utf8"});
    expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/--db/i);
  },15_000);

  it("prints usage for the database readiness mode without exposing secrets", () => {
    const output = execFileSync(
      process.platform === "win32" ? "cmd.exe" : "npx",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-readiness-report.ts", "--help"]
        : ["tsx", "scripts/p0-readiness-report.ts", "--help"],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    expect(output).toContain("Usage: npm run p0:readiness -- --db");
    expect(output).not.toContain("--release-candidate-id=");
    expect(output).not.toContain("--legacy-observations");
    expect(output).toContain("--db");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  },15_000);

  it.each(["--legacy-observations","--commit-sha=x","--membership-file=x"])("rejects forbidden flag before mode selection: %s",flag=>{
    const result=spawnSync(process.platform==="win32"?"cmd.exe":"npx",process.platform==="win32"?["/d","/s","/c","npx","tsx","scripts/p0-readiness-report.ts",flag]:["tsx","scripts/p0-readiness-report.ts",flag],{cwd:process.cwd(),encoding:"utf8"});
    expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/forbidden|unknown/i);
  },15_000);
});
