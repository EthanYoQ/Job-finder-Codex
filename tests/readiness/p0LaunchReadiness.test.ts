import { describe, expect, it, vi } from "vitest";
import {
  getLaunchReadinessGates,
  redactValue,
  resolveCommandInvocation,
  runLaunchReadinessCommand,
  runLaunchReadiness
} from "../../scripts/p0-launch-readiness";

describe("P0 launch readiness aggregator", () => {
  it("declares the required launch gates including DB-backed readiness", () => {
    const gates = getLaunchReadinessGates();
    const gateCommands = gates.map((gate) => gate.command.join(" "));

    expect(gateCommands).toEqual([
      "npm test -- tests/app/App.test.tsx tests/app/appDataProvider.test.ts",
      "npm test -- tests/server/httpServer.test.ts tests/server/publicApi.test.ts tests/server/rateLimit.test.ts tests/domain/route-policy.test.ts",
      "npm test -- tests/admin/AdminApp.test.tsx tests/server/adminApi.test.ts",
      "npm test -- tests/ops/backupRestore.test.ts tests/ops/deploymentConfig.test.ts",
      "npm run ops:check-restore-receipt -- .runtime/restore/restore-receipt.json",
      "npm test -- tests/server/opsMonitoring.test.ts",
      "npm test",
      "npm run typecheck",
      "npm run build",
      "npm run prisma:validate",
      "npm run p0:staged-readiness -- --mode phase1",
      "npm run p0:staged-data-quality",
      "npm run p0:authoritative-launch-receipt"
    ]);
    expect(gateCommands.join("\n")).not.toMatch(/public-beta|p0:readiness|p0:data-quality/);
  });

  it("rejects launch-readiness arguments instead of accepting a mode or threshold override", async () => {
    const runCommand = vi.fn();
    const writes: string[] = [];
    const result = await runLaunchReadinessCommand(["--mode", "public-beta"], {
      runCommand,
      writeLine: (line) => writes.push(line)
    });
    expect(result).toEqual({ exitCode: 2 });
    expect(runCommand).not.toHaveBeenCalled();
    expect(writes).toEqual(["Usage: npm run p0:launch-readiness"]);
  });

  it("surfaces the 45-company failure instead of only printing the first command line", async () => {
    const writes: string[] = [];
    const result = await runLaunchReadiness({
      gates: [{
        name: "Phase 1 staged readiness",
        command: ["npm", "run", "p0:staged-readiness", "--", "--mode", "phase1"]
      }],
      runCommand: async () => ({
        ok: false,
        exitCode: 1,
        stdout: "Mode: PHASE1\nStable companies: 44 / 45\n[FAIL] MINIMUM_STABLE_COMPANIES_NOT_MET: only 44",
        stderr: ""
      }),
      writeLine: (line) => writes.push(line)
    });
    expect(result).toEqual({ exitCode: 1 });
    expect(writes).toContain("stderr: [FAIL] MINIMUM_STABLE_COMPANIES_NOT_MET: only 44");
  });

  it("stops on the first failed gate and reports a concise summary", async () => {
    const executed: string[] = [];
    const writes: string[] = [];

    const result = await runLaunchReadiness({
      gates: [
        { name: "Frontend flow", command: ["npm", "test", "--", "tests/app/App.test.tsx"] },
        { name: "Typecheck", command: ["npm", "run", "typecheck"] },
        { name: "DB readiness", command: ["npm", "run", "p0:readiness", "--", "--db"] }
      ],
      runCommand: async (gate) => {
        executed.push(gate.name);

        if (gate.name === "Typecheck") {
          return {
            ok: false,
            exitCode: 2,
            stdout: "type error",
            stderr: "DATABASE_URL=postgres://user:placeholder@db.example.com:5432/jobs"
          };
        }

        return {
          ok: true,
          exitCode: 0,
          stdout: `${gate.name} ok`,
          stderr: ""
        };
      },
      writeLine: (line) => writes.push(line)
    });

    expect(result.exitCode).toBe(2);
    expect(executed).toEqual(["Frontend flow", "Typecheck"]);
    expect(writes).toEqual([
      "[PASS] Frontend flow",
      "[FAIL] Typecheck",
      "stderr: DATABASE_URL=[REDACTED]",
      "Launch readiness: FAIL at Typecheck"
    ]);
  });

  it("redacts secret-looking env assignments and URLs", () => {
    expect(redactValue("DATABASE_URL=postgres://user:placeholder@db.example.com:5432/jobs")).toBe(
      "DATABASE_URL=[REDACTED]"
    );
    expect(redactValue("TAVILY_API_KEY=tvly-dev-REDACTED")).toBe("TAVILY_API_KEY=[REDACTED]");
    expect(redactValue("--token=abcdef")).toBe("--token=[REDACTED]");
  });

  it("runs npm gates through cmd.exe on Windows instead of spawning npm.cmd directly", () => {
    const invocation = resolveCommandInvocation("npm", ["test", "--", "tests/app/App.test.tsx"]);

    if (process.platform === "win32") {
      expect(invocation.executable.toLocaleLowerCase()).toContain("cmd");
      expect(invocation.args).toEqual([
        "/d",
        "/s",
        "/c",
        "npm test -- tests/app/App.test.tsx"
      ]);
      return;
    }

    expect(invocation).toEqual({
      executable: "npm",
      args: ["test", "--", "tests/app/App.test.tsx"]
    });
  });
});
