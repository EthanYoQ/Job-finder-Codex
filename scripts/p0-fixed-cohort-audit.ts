import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import { buildStagedSourceCrawlPlans } from "../src/crawler/sourcePlan";
import { candidateCompanies } from "../src/data/companyRegistry";
import { P0_LAUNCH_MANIFEST, selectLaunchCompanies } from "../src/release/launchManifest";
import { buildFixedCohortCompletenessAudit, type FixedCohortAuditSourceInput } from
  "../src/release/fixedCohortCompletenessAudit";

const outputPath = process.env.FIXED_COHORT_AUDIT_PATH ?? ".runtime/audit/fixed-cohort-completeness.json";
const prisma = new PrismaClient();
const plans = buildStagedSourceCrawlPlans(selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies));
try {
  const generatedAt = new Date();
  const authority = await resolveCurrentStagedScheduleAuthority(prisma as never);
  const requestedBatchId = process.env.FIXED_COHORT_AUDIT_BATCH_ID?.trim();
  const batch = await prisma.crawlBatch.findFirstOrThrow({
    where: requestedBatchId ? { id: requestedBatchId, releaseCandidateId: authority.identity.releaseCandidateId,
      kind: "SCHEDULED" } : { releaseCandidateId: authority.identity.releaseCandidateId, kind: "SCHEDULED",
      status: { in: ["SUCCESS", "INCOMPLETE", "FAILED"] }, finishedAt: { not: null } },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    include: { sourceResults: { include: { evidenceArtifacts: { orderBy: { path: "asc" } },
      paginationEvidence: { orderBy: { sequence: "asc" } } } } }
  });
  const results = new Map(batch.sourceResults.map((row) => [row.sourceId, row]));
  const sources = plans.map((plan): FixedCohortAuditSourceInput => {
    const row = results.get(plan.source.id);
    if (!row) return missingSource(plan);
    const grade = certificateGrade(row.completenessCertificate);
    const declaredPages = row.paginationEvidence.flatMap(({ declaredPages }) => declaredPages === null ? [] : [declaredPages]);
    return {
      sourceResultId: row.id, companyId: plan.company.id, sourceId: plan.source.id,
      adapterFamily: adapterFamily(plan), grade, sourceConfigSha256: row.sourceConfigHash,
      canonicalJobSetSha256: row.canonicalOutputSetSha256 ?? "", certificate: row.completenessCertificate,
      certificateSha256: row.completenessCertificateSha256, officialSurfaceIds: row.officialSurfaceIds,
      officialChannelIds: row.officialChannelIds, evidenceLocations: row.evidenceArtifacts.map(({ path }) => path),
      expectedEvidenceKind: row.expectedEvidenceKind, expectedJobCount: row.expectedJobCount,
      pagesVisited: row.paginationEvidence.length, totalPages: declaredPages.length === 0 ? null : Math.max(...declaredPages),
      finalJobCount: row.dedupeOutputCount, transportState: row.transportState, adapterState: row.adapterState,
      completenessState: row.completenessState, atomicCommitState: row.atomicCommitState,
      failureCategory: row.failureCategory, failureDiagnosticCode: row.failureDiagnosticCode, failureCode: row.failureCode
    };
  });
  const report = buildFixedCohortCompletenessAudit({ generatedAt,
    releaseCandidateId: authority.identity.releaseCandidateId, batchId: batch.id, sources });
  await publish(outputPath, report);
  console.log(JSON.stringify({ decision: report.decision, companyCount: report.companyCount,
    blockerCount: report.companies.filter(({ blockers }) => blockers.length > 0).length,
    repairTicketCount: report.repairFrontier.length, contentSha256: report.contentSha256 }));
  process.exitCode = report.decision === "AUDIT_COMPLETE" ? 0 : 1;
} catch (error) {
  const report = buildFixedCohortCompletenessAudit({ generatedAt: new Date(), releaseCandidateId: "UNAVAILABLE",
    batchId: "UNAVAILABLE", sources: plans.map(missingSource) });
  await publish(outputPath, report);
  console.error("Fixed cohort audit could not load a formal batch; a 50-company failure report was written");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }

function missingSource(plan: ReturnType<typeof buildStagedSourceCrawlPlans>[number]): FixedCohortAuditSourceInput {
  return { sourceResultId: `missing:${plan.source.id}`, companyId: plan.company.id, sourceId: plan.source.id,
    adapterFamily: adapterFamily(plan), grade: "C", sourceConfigSha256: "0".repeat(64),
    canonicalJobSetSha256: "0".repeat(64), certificate: null, certificateSha256: null,
    officialSurfaceIds: plan.source.surfaceId ? [plan.source.surfaceId] : [],
    officialChannelIds: plan.expectedChannels?.map(({ channelId }) => channelId) ?? [], evidenceLocations: [],
    expectedEvidenceKind: null, expectedJobCount: null, pagesVisited: null, totalPages: null, finalJobCount: 0,
    transportState: "NOT_ATTEMPTED", adapterState: "NOT_ATTEMPTED", completenessState: "INCOMPLETE",
    atomicCommitState: "NOT_ATTEMPTED", failureCategory: "EVIDENCE_INSUFFICIENT",
    failureDiagnosticCode: null, failureCode: "SOURCE_RESULT_MISSING" };
}
function certificateGrade(value: unknown): "A" | "B" | "C" {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    ["A", "B"].includes(String((value as Record<string, unknown>).grade))
    ? (value as { grade: "A" | "B" }).grade : "C";
}
function adapterFamily(plan: ReturnType<typeof buildStagedSourceCrawlPlans>[number]): string {
  if (plan.adapterId === "official-json") return `${plan.adapterId}:${plan.officialJsonFetch?.kind ?? "generic"}`;
  return `${plan.adapterId}:${plan.table.pagination?.ajaxMode ?? plan.table.pagination?.talentbrewScope ?? "generic"}`;
}
async function publish(path: string, value: unknown): Promise<void> {
  const absolute = resolve(path), temporary = `${absolute}.${process.pid}.tmp`;
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, absolute);
}
