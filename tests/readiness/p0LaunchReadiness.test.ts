import { describe, expect, it } from "vitest";
import {
  getLaunchReadinessGates,
  redactValue,
  runLaunchReadiness
} from "../../scripts/p0-launch-readiness";

describe("P0 launch readiness aggregator", () => {
  it("declares the required launch gates including DB-backed readiness", () => {
    const gates = getLaunchReadinessGates();
    const gateCommands = gates.map((gate) => gate.command.join(" "));

    expect(gateCommands).toEqual([
      "npm test -- tests/app/App.test.tsx",
      "npm test -- tests/server/publicApi.test.ts tests/server/rateLimit.test.ts tests/domain/route-policy.test.ts",
      "npm test -- tests/admin/AdminApp.test.tsx",
      "npm test -- tests/ops/backupRestore.test.ts tests/ops/deploymentConfig.test.ts",
      "npm test -- tests/server/opsMonitoring.test.ts",
      "npm test",
      "npm run typecheck",
      "npm run build",
      "npm run prisma:validate",
      "npm run p0:readiness -- --db"
    ]);
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
            stderr: "DATABASE_URL=postgres://user:secret@db.example.com:5432/jobs"
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
    expect(redactValue("DATABASE_URL=postgres://user:secret@db.example.com:5432/jobs")).toBe(
      "DATABASE_URL=[REDACTED]"
    );
    expect(redactValue("TAVILY_API_KEY=tvly-dev-secret-key")).toBe("TAVILY_API_KEY=[REDACTED]");
    expect(redactValue("--token=abcdef")).toBe("--token=[REDACTED]");
  });
});
