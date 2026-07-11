import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export interface LaunchGate {
  name: string;
  command: [string, ...string[]];
}

export interface LaunchGateResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface LaunchReadinessResult {
  exitCode: number;
}

export interface RunLaunchReadinessOptions {
  gates?: readonly LaunchGate[];
  runCommand?: (gate: LaunchGate) => Promise<LaunchGateResult>;
  writeLine?: (line: string) => void;
}

export function getLaunchReadinessGates(): LaunchGate[] {
  return [
    {
      name: "Frontend flow",
      command: ["npm", "test", "--", "tests/app/App.test.tsx", "tests/app/appDataProvider.test.ts"]
    },
    {
      name: "Route and rate-limit",
      command: [
        "npm",
        "test",
        "--",
        "tests/server/httpServer.test.ts",
        "tests/server/publicApi.test.ts",
        "tests/server/rateLimit.test.ts",
        "tests/domain/route-policy.test.ts"
      ]
    },
    {
      name: "Admin console",
      command: ["npm", "test", "--", "tests/admin/AdminApp.test.tsx", "tests/server/adminApi.test.ts"]
    },
    {
      name: "Backup and restore",
      command: ["npm", "test", "--", "tests/ops/backupRestore.test.ts", "tests/ops/deploymentConfig.test.ts"]
    },
    {
      name: "Monitoring alerts",
      command: ["npm", "test", "--", "tests/server/opsMonitoring.test.ts"]
    },
    {
      name: "Full test suite",
      command: ["npm", "test"]
    },
    {
      name: "Typecheck",
      command: ["npm", "run", "typecheck"]
    },
    {
      name: "Build",
      command: ["npm", "run", "build"]
    },
    {
      name: "Prisma validate",
      command: ["npm", "run", "prisma:validate"]
    },
    {
      name: "DB readiness",
      command: ["npm", "run", "p0:readiness", "--", "--db"]
    },
    {
      name: "DB data quality",
      command: ["npm", "run", "p0:data-quality", "--", "--db"]
    }
  ];
}

export function redactValue(value: string): string {
  return value
    .replace(/\b([A-Z][A-Z0-9_]*)(=)(["'])?([^\s"']+)(\3)?/g, "$1$2[REDACTED]")
    .replace(/(^|\s)(--?[A-Za-z0-9_-]*(?:token|key|secret|password)[A-Za-z0-9_-]*=)([^\s]+)/gi, "$1$2[REDACTED]")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED]");
}

export async function runLaunchReadiness(
  options: RunLaunchReadinessOptions = {}
): Promise<LaunchReadinessResult> {
  const gates = options.gates ?? getLaunchReadinessGates();
  const runCommand = options.runCommand ?? defaultRunCommand;
  const writeLine = options.writeLine ?? console.log;

  for (const gate of gates) {
    const result = await runCommand(gate);

    if (result.ok) {
      writeLine(`[PASS] ${gate.name}`);
      continue;
    }

    writeLine(`[FAIL] ${gate.name}`);
    const detail = firstNonEmptyLine(result.stderr) ?? firstNonEmptyLine(result.stdout);
    if (detail !== undefined) {
      writeLine(`stderr: ${redactValue(detail)}`);
    }
    writeLine(`Launch readiness: FAIL at ${gate.name}`);
    return { exitCode: result.exitCode || 1 };
  }

  writeLine("Launch readiness: PASS");
  return { exitCode: 0 };
}

async function defaultRunCommand(gate: LaunchGate): Promise<LaunchGateResult> {
  const [command, ...args] = gate.command;
  const invocation = resolveCommandInvocation(command, args);

  try {
    const result = await execFileAsync(invocation.executable, invocation.args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      maxBuffer: 1024 * 1024 * 10
    });

    return {
      ok: true,
      exitCode: 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };

    return {
      ok: false,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

export function resolveCommandInvocation(command: string, args: string[]): { executable: string; args: string[] } {
  if (process.platform === "win32" && command === "npm") {
    return {
      executable: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", ["npm", ...args].map(quoteWindowsShellArg).join(" ")]
    };
  }

  return { executable: command, args };
}

function quoteWindowsShellArg(value: string): string {
  if (value.length > 0 && !/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function firstNonEmptyLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

async function main(): Promise<void> {
  const result = await runLaunchReadiness();
  process.exitCode = result.exitCode;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
