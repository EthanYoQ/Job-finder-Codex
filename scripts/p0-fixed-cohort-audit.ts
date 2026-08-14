import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import { buildStagedSourceCrawlPlans } from "../src/crawler/sourcePlan";
import { candidateCompanies } from "../src/data/companyRegistry";
import { P0_LAUNCH_MANIFEST, selectLaunchCompanies } from "../src/release/launchManifest";
import { buildFixedCohortCompletenessAudit, type FixedCohortAuditSourceInput } from
  "../src/release/fixedCohortCompletenessAudit";
import { projectFailedFixedCohortAuditSource } from "../src/release/fixedCohortAuditSourceProjection";

const outputPath = process.env.FIXED_COHORT_AUDIT_PATH ?? ".runtime/audit/fixed-cohort-completeness.json";
const prisma = new PrismaClient();
let plans: ReturnType<typeof buildStagedSourceCrawlPlans>;
try { plans = buildStagedSourceCrawlPlans(selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies)); }
catch {
  const sources = P0_LAUNCH_MANIFEST.companies.map((company) => missingManifestSource(company.companyId, company.source.sourceId));
  const report = buildFixedCohortCompletenessAudit({ generatedAt: new Date(), releaseCandidateId: "UNAVAILABLE",
    batchId: "UNAVAILABLE", observedSourceIds: [], sources, invalidReasons: ["SOURCE_PLAN_BUILD_FAILED"] });
  try { await publish(outputPath, report); } finally { await prisma.$disconnect(); }
  process.exit(1);
}
try {
  const generatedAt = new Date();
  const requestedBatchId = process.env.FIXED_COHORT_AUDIT_BATCH_ID?.trim();
  const { authority, batch } = await prisma.$transaction(async (transaction) => {
    const authority = await resolveCurrentStagedScheduleAuthority(transaction as never), identity = authority.identity;
    const batch = await transaction.crawlBatch.findFirstOrThrow({
      where: { ...(requestedBatchId ? { id: requestedBatchId } : {}), releaseCandidateId: identity.releaseCandidateId,
        kind: "SCHEDULED", status: { in: ["SUCCESS", "INCOMPLETE", "FAILED"] }, finishedAt: { not: null },
        commitSha: identity.commitSha, rosterSha256: identity.rosterSha256, sourcePlanSha256: identity.sourcePlanSha256,
        sourceConfigSha256: identity.sourceConfigSha256, adapterBundleSha256: identity.adapterBundleSha256,
        plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
        plannedSourceCount: identity.expectedPlannedSourceCount },
      orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
      include: { sourceResults: { include: { evidenceArtifacts: { orderBy: { path: "asc" } },
        paginationEvidence: { orderBy: { sequence: "asc" } }, observations: true } } }
    });
    return { authority, batch };
  }, { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 30_000 });
  const observedSourceIds = batch.sourceResults.map(({ sourceId }) => sourceId);
  const results = new Map(batch.sourceResults.map((row) => [row.sourceId, row]));
  const sources = plans.map((plan): FixedCohortAuditSourceInput => {
    const row = results.get(plan.source.id);
    if (!row) return missingSource(plan);
    if (row.observations.length === 0 && row.atomicCommitState !== "COMMITTED" && row.failureCode) {
      return projectFailedFixedCohortAuditSource({
        plan: { companyId: plan.company.id, sourceId: plan.source.id, adapterFamily: adapterFamily(plan),
          plannedSurfaceIds: plan.source.surfaceId ? [plan.source.surfaceId] : [],
          plannedChannelIds: plan.expectedChannels?.map(({ channelId }) => channelId) ?? [] },
        result: { sourceResultId: row.id, sourceConfigSha256: row.sourceConfigHash,
          officialSurfaceIds: row.officialSurfaceIds, officialChannelIds: row.officialChannelIds,
          expectedEvidenceKind: row.expectedEvidenceKind, expectedJobCount: row.expectedJobCount,
          finalJobCount: row.dedupeOutputCount, transportState: row.transportState, adapterState: row.adapterState,
          completenessState: row.completenessState, atomicCommitState: row.atomicCommitState,
          failureCategory: row.failureCategory, failureDiagnosticCode: row.failureDiagnosticCode,
          failureCode: row.failureCode }
      });
    }
    if (row.observations.length !== 1 || row.observations[0]!.sourceResultId !== row.id) {
      return missingSource(plan);
    }
    const grade = certificateGrade(row.completenessCertificate);
    const declaredPagesByChannel = new Map<string, number | null>();
    for (const page of row.paginationEvidence) {
      const key = page.channelId ?? "\0SOURCE", current = declaredPagesByChannel.get(key);
      if (current === undefined) declaredPagesByChannel.set(key, page.declaredPages);
      else if (current !== page.declaredPages) declaredPagesByChannel.set(key, null);
    }
    const totalPages = declaredPagesByChannel.size > 0 &&
      [...declaredPagesByChannel.values()].every((value): value is number => value !== null)
      ? [...declaredPagesByChannel.values()].reduce((sum, value) => sum + value, 0) : null;
    return {
      sourceResultId: row.id, companyId: plan.company.id, sourceId: plan.source.id,
      adapterFamily: adapterFamily(plan), grade, sourceConfigSha256: row.sourceConfigHash,
      canonicalJobSetSha256: row.canonicalOutputSetSha256, certificate: row.completenessCertificate,
      canonicalRawEvidenceIdSetSha256: row.observations[0]!.canonicalRawSha256,
      certificateSha256: row.completenessCertificateSha256, officialSurfaceIds: row.officialSurfaceIds,
      plannedSurfaceIds: plan.source.surfaceId ? [plan.source.surfaceId] : [],
      plannedChannelIds: plan.expectedChannels?.map(({ channelId }) => channelId) ?? [],
      officialChannelIds: row.officialChannelIds, evidenceArtifacts: row.evidenceArtifacts.map(({ id, path, sha256 }) => ({ id, path, sha256 })),
      paginationEvidence: row.paginationEvidence.map((page) => ({ artifactId: page.artifactId, sequence: page.sequence,
        channelId: page.channelId,
        requestedCursor: page.requestedCursor, returnedCursor: page.returnedCursor, requestedOffset: page.requestedOffset,
        returnedOffset: page.returnedOffset, requestedPage: page.requestedPage, returnedPage: page.returnedPage,
        requestedPageSize: page.requestedPageSize, returnedPageSize: page.returnedPageSize,
        responseFingerprintSha256: page.responseFingerprintSha256, rawJobIdSetSha256: page.rawJobIdSetSha256,
        validJobIdSetSha256: page.validJobIdSetSha256,
        declaredTotal: page.declaredTotal, declaredCount: page.declaredCount, declaredPages: page.declaredPages,
        nextPageSignalBefore: page.nextPageSignalBefore, nextPageSignalAfter: page.nextPageSignalAfter,
        termination: page.termination, anomalyCodes: page.anomalyCodes, capturedAt: page.capturedAt.toISOString() })),
      expectedEvidenceKind: row.expectedEvidenceKind, expectedJobCount: row.expectedJobCount,
      pagesVisited: row.paginationEvidence.length, totalPages,
      finalJobCount: row.dedupeOutputCount, transportState: row.transportState, adapterState: row.adapterState,
      completenessState: row.completenessState, atomicCommitState: row.atomicCommitState,
      failureCategory: row.failureCategory, failureDiagnosticCode: row.failureDiagnosticCode, failureCode: row.failureCode
    };
  });
  const report = buildFixedCohortCompletenessAudit({ generatedAt,
    releaseCandidateId: authority.identity.releaseCandidateId, batchId: batch.id, observedSourceIds, sources });
  await publish(outputPath, report);
  console.log(JSON.stringify({ decision: report.decision, companyCount: report.companyCount,
    blockerCount: report.companies.filter(({ blockers }) => blockers.length > 0).length,
    repairTicketCount: report.repairFrontier.length,
    repairRootCauses: report.repairFrontier.map(({ rootCause }) => rootCause),
    contentSha256: report.contentSha256 }));
  process.exitCode = report.decision === "AUDIT_COMPLETE" ? 0 : 1;
} catch (error) {
  const report = buildFixedCohortCompletenessAudit({ generatedAt: new Date(), releaseCandidateId: "UNAVAILABLE",
    batchId: "UNAVAILABLE", observedSourceIds: [], sources: plans.map(missingSource),
    invalidReasons: ["FORMAL_BATCH_LOAD_FAILED"] });
  await publish(outputPath, report);
  console.error("Fixed cohort audit could not load a formal batch; a 50-company failure report was written");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }

function missingSource(plan: ReturnType<typeof buildStagedSourceCrawlPlans>[number]): FixedCohortAuditSourceInput {
  return { sourceResultId: `missing:${plan.source.id}`, companyId: plan.company.id, sourceId: plan.source.id,
    adapterFamily: adapterFamily(plan), grade: "C", sourceConfigSha256: "0".repeat(64),
    canonicalJobSetSha256: null, canonicalRawEvidenceIdSetSha256: null, certificate: null, certificateSha256: null,
    plannedSurfaceIds: plan.source.surfaceId ? [plan.source.surfaceId] : [],
    plannedChannelIds: plan.expectedChannels?.map(({ channelId }) => channelId) ?? [],
    officialSurfaceIds: plan.source.surfaceId ? [plan.source.surfaceId] : [],
    officialChannelIds: plan.expectedChannels?.map(({ channelId }) => channelId) ?? [], evidenceArtifacts: [], paginationEvidence: [],
    expectedEvidenceKind: null, expectedJobCount: null, pagesVisited: null, totalPages: null, finalJobCount: 0,
    transportState: "NOT_ATTEMPTED", adapterState: "NOT_ATTEMPTED", completenessState: "INCOMPLETE",
    atomicCommitState: "NOT_ATTEMPTED", failureCategory: "EVIDENCE_INSUFFICIENT",
    failureDiagnosticCode: null, failureCode: "SOURCE_RESULT_MISSING" };
}
function missingManifestSource(companyId: string, sourceId: string): FixedCohortAuditSourceInput {
  return { sourceResultId: `missing:${sourceId}`, companyId, sourceId, adapterFamily: "unavailable", grade: "C",
    sourceConfigSha256: "0".repeat(64), canonicalJobSetSha256: null, canonicalRawEvidenceIdSetSha256: null, certificate: null,
    certificateSha256: null, plannedSurfaceIds: [], plannedChannelIds: [], officialSurfaceIds: [], officialChannelIds: [],
    evidenceArtifacts: [], paginationEvidence: [], expectedEvidenceKind: null, expectedJobCount: null, pagesVisited: null,
    totalPages: null, finalJobCount: 0, transportState: "NOT_ATTEMPTED", adapterState: "NOT_ATTEMPTED",
    completenessState: "INCOMPLETE", atomicCommitState: "NOT_ATTEMPTED", failureCategory: "EVIDENCE_INSUFFICIENT",
    failureDiagnosticCode: null, failureCode: "SOURCE_PLAN_MISSING" };
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
