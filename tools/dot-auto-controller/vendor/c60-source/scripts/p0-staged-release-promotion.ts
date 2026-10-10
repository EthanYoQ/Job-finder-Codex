import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { loadStagedDataQualityGateFromDatabase } from "./p0-staged-data-quality";
import {
  promoteStagedReleaseCandidate,
  type ReleaseCandidatePromotionRow,
  type StagedReleasePromotionResult
} from "../src/readiness/stagedReleasePromotion";

export interface StagedReleasePromotionCommandDeps {
  readEvidence(path: string): Promise<string>;
  promote(input: { releaseCandidateId: string; qaEvidenceText: string }): Promise<StagedReleasePromotionResult>;
  writeLine(line: string): void;
}

export async function runStagedReleasePromotionCommand(
  args: readonly string[],
  deps: StagedReleasePromotionCommandDeps
): Promise<{ exitCode: number }> {
  if (args.length !== 4 || args[0] !== "--release-candidate" || args[2] !== "--qa-evidence" ||
      !args[1]?.trim() || args[1] !== args[1].trim() || !args[3]?.trim()) {
    deps.writeLine("Usage: npm run p0:staged-release-promotion -- --release-candidate <id> --qa-evidence <path>");
    return { exitCode: 2 };
  }
  const qaEvidenceText = await deps.readEvidence(args[3]);
  const result = await deps.promote({ releaseCandidateId: args[1], qaEvidenceText });
  deps.writeLine(JSON.stringify(result));
  return { exitCode: 0 };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await runStagedReleasePromotionCommand(process.argv.slice(2), {
      readEvidence: (path) => readFile(path, "utf8"),
      promote: (input) => promoteStagedReleaseCandidate(input, {
        now: () => new Date(),
        loadCandidate: async (releaseCandidateId) => prisma.releaseCandidate.findUnique({
          where: { id: releaseCandidateId },
          select: {
            id: true,
            goalId: true,
            version: true,
            commitSha: true,
            dbSnapshotHash: true,
            schemaHash: true,
            migrationVersion: true,
            rosterHash: true,
            sourcePlanHash: true,
            sourceConfigHash: true,
            adapterBundleHash: true,
            sourceTreeHash: true,
            runtimeTreeHash: true,
            oracleVersion: true,
            minimumStableCompanyCount: true,
            status: true,
            releaseQaEvidenceSha256: true,
            finalizedAt: true
          }
        }) as Promise<ReleaseCandidatePromotionRow | null>,
        loadGateReport: () => loadStagedDataQualityGateFromDatabase(prisma),
        updateReleased: async ({ releaseCandidate, releaseQaEvidenceSha256, finalizedAt }) => {
          const updated = await prisma.releaseCandidate.updateMany({
            where: {
              id: releaseCandidate.id,
              goalId: releaseCandidate.goalId,
              version: releaseCandidate.version,
              commitSha: releaseCandidate.commitSha,
              dbSnapshotHash: releaseCandidate.dbSnapshotHash,
              schemaHash: releaseCandidate.schemaHash,
              migrationVersion: releaseCandidate.migrationVersion,
              rosterHash: releaseCandidate.rosterHash,
              sourcePlanHash: releaseCandidate.sourcePlanHash,
              sourceConfigHash: releaseCandidate.sourceConfigHash,
              adapterBundleHash: releaseCandidate.adapterBundleHash,
              sourceTreeHash: releaseCandidate.sourceTreeHash,
              runtimeTreeHash: releaseCandidate.runtimeTreeHash,
              oracleVersion: releaseCandidate.oracleVersion,
              minimumStableCompanyCount: releaseCandidate.minimumStableCompanyCount,
              status: "READY_FOR_QA",
              releaseQaEvidenceSha256: null,
              finalizedAt: null
            },
            data: { status: "RELEASED", releaseQaEvidenceSha256, finalizedAt }
          });
          return updated.count;
        }
      }),
      writeLine: console.log
    });
    process.exitCode = result.exitCode;
  } catch {
    console.error("Staged release promotion: ERROR");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
