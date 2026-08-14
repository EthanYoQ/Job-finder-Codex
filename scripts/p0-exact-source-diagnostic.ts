import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type {
  ExactSourceDiagnosticReport,
  ExactSourceDiagnosticSession
} from "../src/crawler/exactSourceDiagnostic";
import {
  buildExactSourceDiagnosticReport,
  parseExactSourceDiagnosticSession,
  prepareExactSourceDiagnostic
} from "../src/crawler/exactSourceDiagnostic";

export type ExactSourceDiagnosticCommand =
  | { command: "prepare"; sessionPath: string; sourceIds: string[] }
  | { command: "report"; sessionPath: string; reportPath: string };

export function parseExactSourceDiagnosticCommand(args: readonly string[]): ExactSourceDiagnosticCommand {
  const command = args[0];
  if (command === "prepare") {
    const sourceIds: string[] = [];
    let sessionPath: string | undefined;
    for (let index = 1; index < args.length; index += 2) {
      const option = args[index];
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Invalid exact-source diagnostic arguments");
      if (option === "--session" && sessionPath === undefined) sessionPath = value;
      else if (option === "--source-id") sourceIds.push(value);
      else throw new Error("Invalid exact-source diagnostic arguments");
    }
    if (!sessionPath || sourceIds.length < 1 || sourceIds.length > 5) {
      throw new Error("Invalid exact-source diagnostic arguments");
    }
    return { command, sessionPath, sourceIds };
  }
  if (command === "report" && args.length === 5) {
    const values = new Map<string, string>();
    for (let index = 1; index < args.length; index += 2) {
      const option = args[index];
      const value = args[index + 1];
      if (!option || !value || value.startsWith("--") || values.has(option) ||
          !["--session", "--report"].includes(option)) {
        throw new Error("Invalid exact-source diagnostic arguments");
      }
      values.set(option, value);
    }
    const sessionPath = values.get("--session");
    const reportPath = values.get("--report");
    if (sessionPath && reportPath) return { command, sessionPath, reportPath };
  }
  throw new Error("Invalid exact-source diagnostic arguments");
}

export async function runExactSourceDiagnosticCommand(
  command: ExactSourceDiagnosticCommand,
  deps: {
    prepare(sourceIds: readonly string[]): Promise<ExactSourceDiagnosticSession>;
    report(sessionPath: string): Promise<ExactSourceDiagnosticReport>;
    writeJson(path: string, value: unknown): Promise<void>;
  }
): Promise<{ exitCode: number }> {
  if (command.command === "prepare") {
    const session = await deps.prepare(command.sourceIds);
    await deps.writeJson(command.sessionPath, session);
    return { exitCode: 0 };
  }
  const report = await deps.report(command.sessionPath);
  await deps.writeJson(command.reportPath, report);
  return { exitCode: report.decision === "NON_CERTIFYING_PASS" ? 0 : 1 };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error(JSON.stringify({ ok: false, code: "EXACT_SOURCE_DIAGNOSTIC_FAILED" }));
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  const command = parseExactSourceDiagnosticCommand(process.argv.slice(2));
  const [
    { PrismaClient },
    { createManualCrawlRequestRepository },
    { resolveCurrentStagedScheduleAuthority },
    { syncLaunchCohortSourcesToDb }
  ] = await Promise.all([
    import("@prisma/client"),
    import("../src/db/manualCrawlRequestRepository"),
    import("../src/crawler/stagedScheduleAuthority"),
    import("../src/db/companyRegistrySync")
  ]);
  const prisma = new PrismaClient();
  try {
    const result = await runExactSourceDiagnosticCommand(command, {
      prepare: async (sourceIds) => {
        const authority = await resolveCurrentStagedScheduleAuthority(prisma as never);
        await syncLaunchCohortSourcesToDb(authority.plans, authority.companies, prisma as never);
        const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
        if (!adminEmail) throw new Error("Exact-source diagnostic admin identity is unavailable");
        const admin = await prisma.adminUser.findFirst({
          where: { email: adminEmail, role: "ADMIN", disabledAt: null },
          select: { id: true }
        });
        if (!admin) throw new Error("Exact-source diagnostic admin identity is unavailable");
        const resolveSourceIds = async () =>
          (await resolveCurrentStagedScheduleAuthority(prisma as never)).plans.map(({ source }) => source.id);
        const repository = createManualCrawlRequestRepository({
          db: prisma,
          resolveEnqueueableSourceIds: resolveSourceIds
        });
        return prepareExactSourceDiagnostic({
          sourceIds,
          authority: {
            releaseCandidateId: authority.identity.releaseCandidateId,
            commitSha: authority.identity.commitSha,
            sourceIds: authority.plans.map(({ source }) => source.id)
          },
          now: new Date(),
          enqueue: (sourceId) => repository.enqueue({
            sourceId,
            requestedById: admin.id,
            reason: "NON_CERTIFYING_EXACT_SOURCE_DIAGNOSTIC",
            ip: "127.0.0.1",
            userAgent: "job-finder-exact-source-diagnostic/v1"
          })
        });
      },
      report: async (sessionPath) => {
        const session = parseExactSourceDiagnosticSession(JSON.parse(await readFile(sessionPath, "utf8")));
        const rows = await prisma.manualCrawlRequest.findMany({
          where: { id: { in: session.requests.map(({ requestId }) => requestId) } },
          select: {
            id: true,
            sourceId: true,
            status: true,
            failureCode: true,
            startedAt: true,
            finishedAt: true,
            executionBatches: {
              orderBy: { startedAt: "asc" },
              select: {
                id: true,
                kind: true,
                releaseCandidateId: true,
                commitSha: true,
                status: true,
                sourceResults: {
                  select: {
                    sourceId: true,
                    transportState: true,
                    adapterState: true,
                    completenessState: true,
                    atomicCommitState: true,
                    blockerCode: true,
                    failureCategory: true,
                    failureDiagnosticCode: true,
                    failureCode: true,
                    fetchAttemptCount: true,
                    retryCount: true,
                    rawCount: true,
                    validCount: true,
                    dedupeOutputCount: true,
                    startedAt: true,
                    finishedAt: true
                  }
                }
              }
            }
          }
        });
        return buildExactSourceDiagnosticReport({ session, evaluatedAt: new Date(), requests: rows });
      },
      writeJson: writeJsonAtomically
    });
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.partial-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporaryPath, filePath);
}
