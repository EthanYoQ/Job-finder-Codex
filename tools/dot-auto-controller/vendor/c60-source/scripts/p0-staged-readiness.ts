import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { getCompanyPublicationSnapshotFromDb } from "../src/db/publicationEligibilityRepository";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import {
  evaluateStagedReleaseReadiness,
  type StagedReleaseMode,
  type StagedReleaseReadinessReport
} from "../src/readiness/stagedReleaseReadiness";

export interface StagedReadinessCommandDeps {
  loadReport(mode: StagedReleaseMode): Promise<StagedReleaseReadinessReport>;
  writeLine(line: string): void;
}

export interface StagedReadinessCommandResult {
  exitCode: number;
}

function parseMode(args: readonly string[]): StagedReleaseMode | null {
  if (args.length !== 2 || args[0] !== "--mode") return null;
  if (args[1] === "phase1") return "PHASE1";
  return null;
}

export async function runStagedReadinessCommand(
  args: readonly string[],
  deps: StagedReadinessCommandDeps
): Promise<StagedReadinessCommandResult> {
  const mode = parseMode(args);
  if (mode === null) {
    deps.writeLine("Usage: npm run p0:staged-readiness -- --mode phase1");
    return { exitCode: 2 };
  }
  const report = await deps.loadReport(mode);
  if (report.mode !== mode) throw new Error("STAGED_READINESS_MODE_DRIFT");
  deps.writeLine(`Mode: ${mode}`);
  deps.writeLine(`Release candidate status: ${report.releaseCandidateStatus}`);
  deps.writeLine(`Roster: ${report.foreignCompanyCount} foreign + ${report.domesticCompanyCount} domestic`);
  deps.writeLine(`Authorized exclusions: ${report.authorizedExclusionCount}`);
  deps.writeLine(`Stable companies: ${report.stableCompanyCount} / ${report.minimumStableCompanyCount}`);
  deps.writeLine(`Freshness maximum hours: ${report.freshnessMaximumMs / 3_600_000}`);
  for (const issue of report.issues) {
    deps.writeLine(`[FAIL] ${issue.code}${issue.companyId ? ` (${issue.companyId})` : ""}: ${issue.message}`);
  }
  deps.writeLine(`Staged release readiness: ${report.canRelease ? "PASS" : "FAIL"}`);
  return { exitCode: report.canRelease ? 0 : 1 };
}

async function loadReportFromCurrentDatabase(mode: StagedReleaseMode): Promise<StagedReleaseReadinessReport> {
  const prisma = new PrismaClient();
  try {
    const currentTime = new Date();
    const authority = await resolveCurrentStagedScheduleAuthority(prisma as never);
    const releaseCandidate = await prisma.releaseCandidate.findUnique({
      where: { id: authority.identity.releaseCandidateId },
      select: { status: true, minimumStableCompanyCount: true }
    });
    const snapshot = await getCompanyPublicationSnapshotFromDb(
      prisma,
      async () => authority,
      { currentTime }
    );
    return evaluateStagedReleaseReadiness({
      snapshot,
      mode,
      currentTime,
      releaseCandidateStatus: releaseCandidate?.status ?? "MISSING",
      minimumStableCompanyCount: releaseCandidate?.minimumStableCompanyCount ?? 0
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  try {
    const result = await runStagedReadinessCommand(process.argv.slice(2), {
      loadReport: loadReportFromCurrentDatabase,
      writeLine: console.log
    });
    process.exitCode = result.exitCode;
  } catch {
    console.error("Staged release readiness: ERROR");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
