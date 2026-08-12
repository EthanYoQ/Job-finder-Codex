import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { resolveCurrentBuildIdentity } from "../src/readiness/buildIdentity";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import { P0_LAUNCH_MANIFEST } from "../src/release/launchManifest";
import { evaluateAuthoritativeLaunchReadiness, type LaunchCertificateEvidence } from "../src/release/authoritativeLaunchReceipt";
import { readImageQualificationReceipt, readRestoreReceiptSummary, readSecurityReceiptSummary } from "../src/release/launchReceiptFiles";

const prisma = new PrismaClient();
try {
  const evaluatedAt = new Date(), build = resolveCurrentBuildIdentity();
  const authority = await resolveCurrentStagedScheduleAuthority(prisma as never);
  const [releaseCandidate, batches, image, security, restore] = await Promise.all([
    prisma.releaseCandidate.findUniqueOrThrow({ where: { id: authority.identity.releaseCandidateId } }),
    prisma.crawlBatch.findMany({ where: { releaseCandidateId: authority.identity.releaseCandidateId, kind: "FULL_RELEASE" },
      orderBy: { finishedAt: "desc" }, take: 3, include: { sourceResults: true } }),
    readImageQualificationReceipt(required("IMAGE_QUALIFICATION_RECEIPT_PATH")),
    readSecurityReceiptSummary(required("PRODUCTION_SECURITY_RECEIPT_PATH")),
    readRestoreReceiptSummary(required("RESTORE_RECEIPT_PATH"))
  ]);
  const manifestBySource = new Map(P0_LAUNCH_MANIFEST.companies.map((company) => [company.source.sourceId, company]));
  const evidenceBatches = batches.slice(0, 2).map((batch) => ({
    id: batch.id, releaseCandidateId: batch.releaseCandidateId!, commitSha: batch.commitSha!, rosterSha256: batch.rosterSha256!,
    sourcePlanSha256: batch.sourcePlanSha256!, sourceConfigSha256: batch.sourceConfigSha256!,
    adapterBundleSha256: batch.adapterBundleSha256!, status: batch.status,
    finishedAt: batch.finishedAt?.toISOString() ?? "", certificates: batch.sourceResults.map((source): LaunchCertificateEvidence => {
      const company = manifestBySource.get(source.sourceId);
      return { sourceResultId: source.id, companyId: company?.companyId ?? "", sourceId: source.sourceId,
        category: company?.category ?? "DOMESTIC_PHARMA", grade: certificateGrade(source.completenessCertificate),
        sourceConfigSha256: source.sourceConfigHash, canonicalJobSetSha256: source.canonicalOutputSetSha256 ?? "",
        certificate: source.completenessCertificate, certificateSha256: source.completenessCertificateSha256 };
    })
  }));
  const result = evaluateAuthoritativeLaunchReadiness({ evaluatedAt, manifest: P0_LAUNCH_MANIFEST,
    source: { commitSha: build.commitSha, sourceTreeSha256: build.sourceTreeSha256, runtimeTreeSha256: build.runtimeTreeSha256 },
    image: { digest: image.imageDigest, revision: image.revision, qualificationSha256: image.contentSha256,
      securityReceiptSha256: image.securityReceiptSha256, restoreReceiptSha256: image.restoreReceiptSha256 },
    database: { snapshotSha256: releaseCandidate.dbSnapshotHash, schemaSha256: releaseCandidate.schemaHash,
      migrationVersion: releaseCandidate.migrationVersion }, security, restore,
    releaseIdentity: { releaseCandidateId: authority.identity.releaseCandidateId, commitSha: authority.identity.commitSha,
      rosterSha256: authority.identity.rosterSha256, sourcePlanSha256: authority.identity.sourcePlanSha256,
      sourceConfigSha256: authority.identity.sourceConfigSha256, adapterBundleSha256: authority.identity.adapterBundleSha256 },
    batches: evidenceBatches, operationalGates: image.gates.map((name) => ({ name, passed: true,
      evidenceSha256: image.contentSha256, reason: `qualified by exact-image gate ${name}` })) });
  await writeReceipt(required("LAUNCH_RECEIPT_PATH"), result.receipt);
  console.log(JSON.stringify({ decision: result.receipt.decision, contentSha256: result.receipt.contentSha256 }));
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED]") : "Launch qualification failed");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }

function certificateGrade(value: unknown): "A" | "B" | "C" {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const grade = (value as Record<string, unknown>).grade;
    if (grade === "A" || grade === "B") return grade;
  }
  return "C";
}
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
async function writeReceipt(path: string, value: unknown): Promise<void> {
  const absolute = resolve(path), temporary = `${absolute}.${process.pid}.tmp`;
  await mkdir(dirname(absolute), { recursive: true }); await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, absolute);
}
