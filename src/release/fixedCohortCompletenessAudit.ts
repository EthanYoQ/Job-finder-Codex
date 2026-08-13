import { createHash } from "node:crypto";
import { P0_LAUNCH_MANIFEST, launchManifestIdentity, validateLaunchManifest } from "./launchManifest";
import { certificateSha256 } from "./authoritativeLaunchReceipt";
import { verifyAGradeCompletenessCertificateReceipt } from "../crawler/completenessCertificate";
import { verifyBGradeTraversalCertificateReceipt } from "../crawler/traversalCertificate";

export type AuditFailureClass = "PRODUCT_DEFECT" | "SOURCE_TEMPORARILY_UNAVAILABLE" | "CONFIGURATION_ERROR" | "EVIDENCE_INSUFFICIENT";
export interface FixedCohortAuditSourceInput {
  sourceResultId: string; companyId: string; sourceId: string; adapterFamily: string; grade: "A" | "B" | "C";
  sourceConfigSha256: string; certificate: unknown | null; certificateSha256: string | null;
  canonicalJobSetSha256: string;
  plannedSurfaceIds: readonly string[]; plannedChannelIds: readonly string[];
  officialSurfaceIds: readonly string[]; officialChannelIds: readonly string[];
  evidenceArtifacts: readonly { id: string; path: string; sha256: string }[];
  paginationEvidence: readonly { artifactId: string; sequence: number; channelId: string | null; requestedCursor: string | null;
    returnedCursor: string | null; requestedOffset: number | null; returnedOffset: number | null;
    requestedPage: number | null; returnedPage: number | null; requestedPageSize: number | null;
    returnedPageSize: number | null; responseFingerprintSha256: string; rawJobIdSetSha256: string;
    validJobIdSetSha256: string; declaredTotal: number | null; declaredCount: number | null;
    declaredPages: number | null; nextPageSignalBefore: string | null; nextPageSignalAfter: string | null;
    termination: string; anomalyCodes: readonly string[]; capturedAt: string }[];
  expectedEvidenceKind: string | null; expectedJobCount: number | null;
  pagesVisited: number | null; totalPages: number | null; finalJobCount: number;
  transportState: string; adapterState: string; completenessState: string; atomicCommitState: string;
  failureCategory: string | null; failureDiagnosticCode: string | null; failureCode: string | null;
}
export interface FixedCohortCompletenessAuditReport {
  schemaVersion: 1; decision: "AUDIT_COMPLETE" | "AUDIT_INVALID"; generatedAt: string;
  releaseCandidateId: string; batchId: string; manifestSha256: string; sourceIdentitySha256: string;
  companyCount: number; foreignCompanyCount: number;
  companies: readonly (FixedCohortAuditSourceInput & { failureClass: AuditFailureClass | null; failureStage: string | null;
    blockers: readonly string[]; paginationByChannel: readonly { channelId: string | null; pageCount: number;
      declaredTotal: number | null; declaredPages: number | null; terminalEvent: string }[] })[];
  repairFrontier: readonly { clusterId: string; adapterFamily: string; failureClass: AuditFailureClass; rootCause: string;
    companyIds: readonly string[]; sourceIds: readonly string[]; proposedTicketOrdinal: number }[];
  invalidReasons: readonly string[]; contentSha256: string;
}

export function buildFixedCohortCompletenessAudit(input: { generatedAt: Date; releaseCandidateId: string; batchId: string;
  observedSourceIds: readonly string[]; sources: readonly FixedCohortAuditSourceInput[]; invalidReasons?: readonly string[]
}): FixedCohortCompletenessAuditReport {
  const invalidReasons = validateLaunchManifest(P0_LAUNCH_MANIFEST, input.sources.map(({ companyId }) => companyId));
  invalidReasons.push(...(input.invalidReasons ?? []));
  const expectedSources = P0_LAUNCH_MANIFEST.companies.map((company) => company.source.sourceId).sort(compare);
  const actualSources = input.sources.map(({ sourceId }) => sourceId).sort(compare);
  if (input.sources.length !== 50 || new Set(input.sources.map(({ companyId }) => companyId)).size !== 50 ||
    JSON.stringify(expectedSources) !== JSON.stringify(actualSources)) invalidReasons.push("AUDIT_SOURCE_DENOMINATOR_MISMATCH");
  const observedSources = [...input.observedSourceIds].sort(compare);
  if (input.observedSourceIds.length !== 50 || new Set(input.observedSourceIds).size !== 50 ||
      JSON.stringify(expectedSources) !== JSON.stringify(observedSources)) invalidReasons.push("OBSERVED_SOURCE_DENOMINATOR_MISMATCH");
  if (!input.releaseCandidateId.trim() || !input.batchId.trim() || !Number.isFinite(input.generatedAt.getTime())) {
    invalidReasons.push("AUDIT_IDENTITY_INVALID");
  }
  const manifestBySource = new Map(P0_LAUNCH_MANIFEST.companies.map((company) => [company.source.sourceId, company]));
  const companies = [...input.sources].sort((a, b) => compare(a.sourceId, b.sourceId)).map((source) => {
    const blockers: string[] = [], expected = manifestBySource.get(source.sourceId);
    if (!expected || expected.companyId !== source.companyId) blockers.push("MANIFEST_BINDING_MISMATCH");
    if (!sameStrings(source.plannedSurfaceIds, source.officialSurfaceIds) ||
        !sameStrings(source.plannedChannelIds, source.officialChannelIds)) blockers.push("OFFICIAL_SCOPE_MISMATCH");
    if (source.evidenceArtifacts.length === 0 || source.evidenceArtifacts.some((artifact) =>
      !artifact.id.trim() || !artifact.path.trim() || !/^[0-9a-f]{64}$/u.test(artifact.sha256))) blockers.push("EVIDENCE_LOCATION_MISSING");
    const artifactIds = new Set(source.evidenceArtifacts.map(({ id }) => id));
    const paginationByChannel = summarizePagination(source);
    const orderedSequences = [...source.paginationEvidence].sort((left, right) => left.sequence - right.sequence);
    if (source.paginationEvidence.length === 0 || source.pagesVisited !== source.paginationEvidence.length ||
        orderedSequences.some((page, index) => page.sequence !== index + 1) ||
        paginationByChannel === null || source.paginationEvidence.some((page) =>
      !artifactIds.has(page.artifactId) || !Number.isSafeInteger(page.sequence) || !page.termination.trim() ||
      ![page.responseFingerprintSha256, page.rawJobIdSetSha256, page.validJobIdSetSha256]
        .every((value) => /^[0-9a-f]{64}$/u.test(value)) || !Number.isFinite(Date.parse(page.capturedAt)))) {
      blockers.push("PAGINATION_EVIDENCE_INVALID");
    }
    if (!/^[0-9a-f]{64}$/u.test(source.sourceConfigSha256) ||
        !/^[0-9a-f]{64}$/u.test(source.canonicalJobSetSha256)) blockers.push("EVIDENCE_COMMITMENT_INVALID");
    if (!source.expectedEvidenceKind) blockers.push("EXPECTED_EVIDENCE_DECLARATION_MISSING");
    if (source.grade === "C") blockers.push("A_OR_B_CERTIFICATE_MISSING");
    else if (!certificateValid(source, input.releaseCandidateId, input.batchId, input.generatedAt)) blockers.push("CERTIFICATE_INVALID");
    if (source.transportState !== "SUCCEEDED") blockers.push("TRANSPORT_NOT_SUCCEEDED");
    if (source.adapterState !== "SUCCEEDED") blockers.push("ADAPTER_NOT_SUCCEEDED");
    if (source.completenessState !== "VERIFIED") blockers.push("COMPLETENESS_NOT_VERIFIED");
    if (source.atomicCommitState !== "COMMITTED") blockers.push("ATOMIC_COMMIT_NOT_COMMITTED");
    if (!Number.isSafeInteger(source.finalJobCount) || source.finalJobCount < 0) blockers.push("FINAL_JOB_COUNT_INVALID");
    const failureStage = failureStageFor(blockers), failureClass = failureClassFor(source, blockers);
    return { ...source, blockers: [...new Set(blockers)], failureStage, failureClass,
      paginationByChannel: paginationByChannel ?? [] };
  });
  const repairFrontier = buildRepairFrontier(companies);
  const identity = launchManifestIdentity(P0_LAUNCH_MANIFEST);
  const base = { schemaVersion: 1 as const, decision: invalidReasons.length === 0 ? "AUDIT_COMPLETE" as const : "AUDIT_INVALID" as const,
    generatedAt: input.generatedAt.toISOString(), releaseCandidateId: input.releaseCandidateId, batchId: input.batchId,
    manifestSha256: identity.manifestSha256, sourceIdentitySha256: identity.sourceIdentitySha256,
    companyCount: companies.length, foreignCompanyCount: companies.filter((row) =>
      manifestBySource.get(row.sourceId)?.category === "FOREIGN_PHARMA").length,
    companies, repairFrontier, invalidReasons: [...new Set(invalidReasons)] };
  return { ...base, contentSha256: sha(JSON.stringify(base)) };
}

function certificateValid(source: FixedCohortAuditSourceInput, releaseCandidateId: string, batchId: string, now: Date): boolean {
  if (!source.certificate || !source.certificateSha256 || certificateSha256(source.certificate) !== source.certificateSha256 ||
    typeof source.certificate !== "object" || Array.isArray(source.certificate)) return false;
  const expected = { releaseCandidateId, batchId, sourceResultId: source.sourceResultId, sourceId: source.sourceId,
    companyId: source.companyId, sourceConfigSha256: source.sourceConfigSha256,
      canonicalJobSetSha256: source.canonicalJobSetSha256, surfaceIds: source.plannedSurfaceIds,
      channelIds: source.plannedChannelIds };
  try {
    if (source.grade === "A") verifyAGradeCompletenessCertificateReceipt({ certificate: source.certificate,
      certificateSha256: source.certificateSha256, expected });
    else if (source.grade === "B") verifyBGradeTraversalCertificateReceipt({ certificate: source.certificate,
      certificateSha256: source.certificateSha256, expected, now });
    else return false;
    return true;
  } catch { return false; }
}
function failureStageFor(blockers: readonly string[]): string | null {
  if (blockers.length === 0) return null;
  if (blockers.some((code) => code.includes("TRANSPORT"))) return "TRANSPORT";
  if (blockers.some((code) => code.includes("ADAPTER"))) return "ADAPTER";
  if (blockers.some((code) => code.includes("COMPLETENESS") || code.includes("CERTIFICATE") || code.includes("EVIDENCE"))) return "COMPLETENESS_EVIDENCE";
  if (blockers.some((code) => code.includes("ATOMIC"))) return "PERSISTENCE";
  return "INPUT_VALIDATION";
}
function failureClassFor(source: FixedCohortAuditSourceInput, blockers: readonly string[]): AuditFailureClass | null {
  if (blockers.length === 0) return null;
  if (["TEMPORARY_OFFICIAL_SOURCE_FAILURE", "SOURCE_TIME_LIMIT_REACHED"].includes(source.failureCategory ?? "")) {
    return "SOURCE_TEMPORARILY_UNAVAILABLE";
  }
  if (blockers.some((blocker) => ["MANIFEST_BINDING_MISMATCH", "OFFICIAL_SCOPE_MISMATCH"].includes(blocker)) ||
      source.failureCode?.includes("CONFIG") || source.failureCode?.includes("PLAN_") ||
      source.failureCode?.includes("SCOPE_")) return "CONFIGURATION_ERROR";
  if (source.adapterState !== "SUCCEEDED" || source.atomicCommitState === "ROLLED_BACK") return "PRODUCT_DEFECT";
  return "EVIDENCE_INSUFFICIENT";
}
function summarizePagination(source: FixedCohortAuditSourceInput): Array<{ channelId: string | null; pageCount: number;
  declaredTotal: number | null; declaredPages: number | null; terminalEvent: string }> | null {
  const groups = new Map<string, FixedCohortAuditSourceInput["paginationEvidence"][number][]>();
  for (const page of source.paginationEvidence) {
    if (page.channelId !== null && !source.officialChannelIds.includes(page.channelId)) return null;
    const key = page.channelId ?? "\0SOURCE", rows = groups.get(key) ?? []; rows.push(page); groups.set(key, rows);
  }
  const summaries = [];
  for (const [key, rows] of [...groups].sort(([left], [right]) => compare(left, right))) {
    rows.sort((left, right) => left.sequence - right.sequence);
    if (rows.some((page) =>
      [page.requestedOffset, page.returnedOffset, page.requestedPage, page.returnedPage,
        page.requestedPageSize, page.returnedPageSize, page.declaredTotal, page.declaredCount, page.declaredPages]
        .some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0)))) return null;
    const totals = [...new Set(rows.flatMap((page) => page.declaredTotal === null ? [] : [page.declaredTotal]))];
    const pages = [...new Set(rows.flatMap((page) => page.declaredPages === null ? [] : [page.declaredPages]))];
    if (totals.length > 1 || pages.length > 1 || (pages[0] !== undefined && pages[0] !== rows.length)) return null;
    summaries.push({ channelId: key === "\0SOURCE" ? null : key, pageCount: rows.length,
      declaredTotal: totals[0] ?? null, declaredPages: pages[0] ?? null, terminalEvent: rows.at(-1)!.termination });
  }
  const expectedTotalPages = summaries.some(({ declaredPages }) => declaredPages === null)
    ? null : summaries.reduce((sum, row) => sum + row.declaredPages!, 0);
  if (source.totalPages !== expectedTotalPages) return null;
  return summaries;
}
function buildRepairFrontier(companies: readonly (FixedCohortAuditSourceInput & {
  failureClass: AuditFailureClass | null; blockers: readonly string[]
})[]) {
  const groups = new Map<string, typeof companies[number][]>();
  for (const row of companies) if (row.failureClass) {
    const rootCause = primaryRootCause(row), key = `${row.adapterFamily}\0${row.failureClass}\0${rootCause}`,
      group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const frontier: { clusterId: string; adapterFamily: string; failureClass: AuditFailureClass; rootCause: string;
    companyIds: string[]; sourceIds: string[]; proposedTicketOrdinal: number }[] = [];
  for (const [key, rows] of [...groups].sort(([a], [b]) => compare(a, b))) {
    const [adapterFamily, failureClass, rootCause] = key.split("\0") as [string, AuditFailureClass, string];
    const sorted = rows.sort((a, b) => compare(a.companyId, b.companyId));
    for (let index = 0; index < sorted.length; index += 5) {
      const chunk = sorted.slice(index, index + 5), ordinal = index / 5 + 1;
      frontier.push({ clusterId: sha(`${key}\0${ordinal}`).slice(0, 16), adapterFamily, failureClass, rootCause,
        companyIds: chunk.map(({ companyId }) => companyId), sourceIds: chunk.map(({ sourceId }) => sourceId), proposedTicketOrdinal: ordinal });
    }
  }
  return frontier;
}
function primaryRootCause(row: FixedCohortAuditSourceInput & { failureClass: AuditFailureClass | null;
  blockers: readonly string[] }): string {
  if (row.failureClass === "SOURCE_TEMPORARILY_UNAVAILABLE") {
    return [row.failureCategory, row.failureDiagnosticCode].filter(Boolean).join(":") || "TEMPORARY_SOURCE_UNKNOWN";
  }
  if (row.failureClass === "CONFIGURATION_ERROR") return row.failureCode ?? "CONFIGURATION_INVALID";
  if (row.failureClass === "PRODUCT_DEFECT") {
    return row.failureDiagnosticCode ?? row.failureCode ??
      (row.atomicCommitState === "ROLLED_BACK" ? "ATOMIC_COMMIT_ROLLED_BACK" : "ADAPTER_EXECUTION_FAILED");
  }
  const evidencePriority = ["CERTIFICATE_INVALID", "A_OR_B_CERTIFICATE_MISSING", "OFFICIAL_SCOPE_MISMATCH",
    "PAGINATION_EVIDENCE_INVALID", "EVIDENCE_LOCATION_MISSING", "EXPECTED_EVIDENCE_DECLARATION_MISSING",
    "EVIDENCE_COMMITMENT_INVALID", "COMPLETENESS_NOT_VERIFIED"];
  return evidencePriority.find((blocker) => row.blockers.includes(blocker)) ?? row.blockers[0] ?? "UNKNOWN";
}
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  return JSON.stringify([...left].sort(compare)) === JSON.stringify([...right].sort(compare));
}
const compare = (a: string, b: string) => Buffer.from(a).compare(Buffer.from(b));
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
