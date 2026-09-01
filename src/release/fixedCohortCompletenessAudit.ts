import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { P0_LAUNCH_MANIFEST, launchManifestIdentity, validateLaunchManifest } from "./launchManifest";
import { certificateSha256 } from "./authoritativeLaunchReceipt";
import { verifyAGradeCompletenessCertificateReceipt } from "../crawler/completenessCertificate";
import { verifyBGradeTraversalCertificateReceipt } from "../crawler/traversalCertificate";
import { B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES } from "../crawler/independentTraversalDiagnostics";

export type AuditFailureClass = "PRODUCT_DEFECT" | "SOURCE_TEMPORARILY_UNAVAILABLE" | "CONFIGURATION_ERROR" | "EVIDENCE_INSUFFICIENT";
export interface FixedCohortAuditSourceInput {
  sourceResultId: string; companyId: string; sourceId: string; adapterFamily: string; grade: "A" | "B" | "C";
  sourceConfigSha256: string; certificate: unknown | null; certificateSha256: string | null;
  canonicalJobSetSha256: string | null; canonicalRawEvidenceIdSetSha256: string | null;
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
  blockerCode: string | null; failureCategory: string | null; failureDiagnosticCode: string | null;
  failureCode: string | null;
}
export interface FixedCohortCompletenessAuditReport {
  schemaVersion: 2; decision: "AUDIT_COMPLETE" | "AUDIT_INVALID"; generatedAt: string;
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
  if (input.sources.length !== 41 || new Set(input.sources.map(({ companyId }) => companyId)).size !== 41 ||
    JSON.stringify(expectedSources) !== JSON.stringify(actualSources)) invalidReasons.push("AUDIT_SOURCE_DENOMINATOR_MISMATCH");
  const observedSources = [...input.observedSourceIds].sort(compare);
  if (input.observedSourceIds.length !== 41 || new Set(input.observedSourceIds).size !== 41 ||
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
        orderedSequences.some((page, index) => page.sequence !== index) ||
        paginationByChannel === null || source.paginationEvidence.some((page) =>
      !artifactIds.has(page.artifactId) || !Number.isSafeInteger(page.sequence) || !page.termination.trim() ||
      ![page.responseFingerprintSha256, page.rawJobIdSetSha256, page.validJobIdSetSha256]
        .every((value) => /^[0-9a-f]{64}$/u.test(value)) || !Number.isFinite(Date.parse(page.capturedAt)))) {
      blockers.push("PAGINATION_EVIDENCE_INVALID");
    }
    if (!/^[0-9a-f]{64}$/u.test(source.sourceConfigSha256) ||
        !/^[0-9a-f]{64}$/u.test(source.canonicalJobSetSha256 ?? "")) blockers.push("EVIDENCE_COMMITMENT_INVALID");
    if (!source.expectedEvidenceKind) blockers.push("EXPECTED_EVIDENCE_DECLARATION_MISSING");
    if (source.grade === "C") blockers.push("A_OR_B_CERTIFICATE_MISSING");
    else if (!certificateValid(source, input.releaseCandidateId, input.batchId, input.generatedAt)) blockers.push("CERTIFICATE_INVALID");
    if (source.transportState !== "SUCCEEDED") blockers.push("TRANSPORT_NOT_SUCCEEDED");
    if (source.adapterState !== "SUCCEEDED") blockers.push("ADAPTER_NOT_SUCCEEDED");
    if (source.completenessState !== "VERIFIED") blockers.push("COMPLETENESS_NOT_VERIFIED");
    if (source.atomicCommitState !== "COMMITTED") blockers.push("ATOMIC_COMMIT_NOT_COMMITTED");
    if (!Number.isSafeInteger(source.finalJobCount) || source.finalJobCount < 0) blockers.push("FINAL_JOB_COUNT_INVALID");
    const failureStage = failureStageFor(source, blockers), failureClass = failureClassFor(source, blockers);
    return { ...source, blockers: [...new Set(blockers)], failureStage, failureClass,
      paginationByChannel: paginationByChannel ?? [] };
  });
  const repairFrontier = buildRepairFrontier(companies);
  const identity = launchManifestIdentity(P0_LAUNCH_MANIFEST);
  const base = { schemaVersion: 2 as const, decision: invalidReasons.length === 0 ? "AUDIT_COMPLETE" as const : "AUDIT_INVALID" as const,
    generatedAt: input.generatedAt.toISOString(), releaseCandidateId: input.releaseCandidateId, batchId: input.batchId,
    manifestSha256: identity.manifestSha256, sourceIdentitySha256: identity.sourceIdentitySha256,
    companyCount: companies.length, foreignCompanyCount: companies.filter((row) =>
      manifestBySource.get(row.sourceId)?.category === "FOREIGN_PHARMA").length,
    companies, repairFrontier, invalidReasons: [...new Set(invalidReasons)] };
  return { ...base, contentSha256: sha(JSON.stringify(base)) };
}

export function parseFixedCohortCompletenessAuditReport(bytes: Buffer): FixedCohortCompletenessAuditReport {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Fixed cohort audit schema is invalid"); }
  const topLevelKeys = ["batchId", "companies", "companyCount", "contentSha256", "decision", "foreignCompanyCount",
    "generatedAt", "invalidReasons", "manifestSha256", "releaseCandidateId", "repairFrontier", "schemaVersion",
    "sourceIdentitySha256"];
  if (!isRecord(value) || !exactKeys(value, topLevelKeys) || value.schemaVersion !== 2 ||
      !["AUDIT_COMPLETE", "AUDIT_INVALID"].includes(String(value.decision)) ||
      !isCanonicalInstant(value.generatedAt) || typeof value.releaseCandidateId !== "string" ||
      !value.releaseCandidateId.trim() || typeof value.batchId !== "string" || !value.batchId.trim() ||
      !/^[0-9a-f]{64}$/u.test(String(value.contentSha256))) {
    throw new Error("Fixed cohort audit schema is invalid");
  }
  const { contentSha256, ...base } = value;
  if (sha(JSON.stringify(base)) !== contentSha256) throw new Error("Fixed cohort audit content hash mismatch");
  const identity = launchManifestIdentity(P0_LAUNCH_MANIFEST);
  const expectedBySource = new Map(P0_LAUNCH_MANIFEST.companies.map((company) => [company.source.sourceId, company]));
  if (value.manifestSha256 !== identity.manifestSha256 || value.sourceIdentitySha256 !== identity.sourceIdentitySha256 ||
      value.companyCount !== 41 || value.foreignCompanyCount !== 30 || !Array.isArray(value.companies) ||
      value.companies.length !== 41 || !Array.isArray(value.invalidReasons) ||
      !value.invalidReasons.every((reason) => typeof reason === "string" && reason.length > 0) ||
      new Set(value.invalidReasons).size !== value.invalidReasons.length || !Array.isArray(value.repairFrontier) ||
      (value.decision === "AUDIT_COMPLETE") !== (value.invalidReasons.length === 0)) {
    throw new Error("Fixed cohort audit does not match the frozen cohort");
  }
  const seenSources = new Set<string>(), seenCompanies = new Set<string>();
  const sources: FixedCohortAuditSourceInput[] = [];
  for (const rawRow of value.companies) {
    const row = parseAuditCompany(rawRow);
    const expected = expectedBySource.get(row.sourceId);
    if (!expected || expected.companyId !== row.companyId || seenSources.has(row.sourceId) || seenCompanies.has(row.companyId)) {
      throw new Error("Fixed cohort audit does not match the frozen cohort");
    }
    seenSources.add(row.sourceId); seenCompanies.add(row.companyId);
    sources.push(stripDerivedAuditFields(row));
  }
  if (seenSources.size !== expectedBySource.size) throw new Error("Fixed cohort audit does not match the frozen cohort");
  const rebuilt = buildFixedCohortCompletenessAudit({
    generatedAt: new Date(value.generatedAt), releaseCandidateId: value.releaseCandidateId, batchId: value.batchId,
    observedSourceIds: sources.map(({ sourceId }) => sourceId), sources, invalidReasons: value.invalidReasons
  });
  if (!isDeepStrictEqual(value, rebuilt)) throw new Error("Fixed cohort audit company evidence is inconsistent");
  return value as unknown as FixedCohortCompletenessAuditReport;
}

const SOURCE_KEYS = ["adapterFamily", "adapterState", "atomicCommitState", "blockerCode", "blockers", "canonicalJobSetSha256",
  "canonicalRawEvidenceIdSetSha256",
  "certificate", "certificateSha256", "companyId", "completenessState", "evidenceArtifacts", "expectedEvidenceKind",
  "expectedJobCount", "failureCategory", "failureClass", "failureCode", "failureDiagnosticCode", "failureStage",
  "finalJobCount", "grade", "officialChannelIds", "officialSurfaceIds", "pagesVisited", "paginationByChannel",
  "paginationEvidence", "plannedChannelIds", "plannedSurfaceIds", "sourceConfigSha256", "sourceId", "sourceResultId",
  "totalPages", "transportState"] as const;
const PAGINATION_KEYS = ["anomalyCodes", "artifactId", "capturedAt", "channelId", "declaredCount", "declaredPages",
  "declaredTotal", "nextPageSignalAfter", "nextPageSignalBefore", "rawJobIdSetSha256", "requestedCursor",
  "requestedOffset", "requestedPage", "requestedPageSize", "responseFingerprintSha256", "returnedCursor",
  "returnedOffset", "returnedPage", "returnedPageSize", "sequence", "termination", "validJobIdSetSha256"] as const;

function parseAuditCompany(value: unknown): FixedCohortCompletenessAuditReport["companies"][number] {
  if (!isRecord(value) || !exactKeys(value, SOURCE_KEYS) || !stringField(value.sourceResultId) ||
      !stringField(value.companyId) || !stringField(value.sourceId) || !stringField(value.adapterFamily) ||
      !["A", "B", "C"].includes(String(value.grade)) || !stringField(value.sourceConfigSha256) ||
      !nullableString(value.certificateSha256) || !nullableSha256(value.canonicalJobSetSha256) ||
      !nullableSha256(value.canonicalRawEvidenceIdSetSha256) ||
      !stringArray(value.plannedSurfaceIds) || !stringArray(value.plannedChannelIds) ||
      !stringArray(value.officialSurfaceIds) || !stringArray(value.officialChannelIds) ||
      !Array.isArray(value.evidenceArtifacts) || !value.evidenceArtifacts.every(validEvidenceArtifact) ||
      !Array.isArray(value.paginationEvidence) || !value.paginationEvidence.every(validPaginationEvidence) ||
      !nullableString(value.expectedEvidenceKind) || !nullableNonnegativeInteger(value.expectedJobCount) ||
      !nullableNonnegativeInteger(value.pagesVisited) || !nullableNonnegativeInteger(value.totalPages) ||
      !nonnegativeInteger(value.finalJobCount) || !stringField(value.transportState) ||
      !stringField(value.adapterState) || !stringField(value.completenessState) ||
      !stringField(value.atomicCommitState) || !nullableNonemptyString(value.blockerCode) ||
      !nullableString(value.failureCategory) ||
      !nullableString(value.failureDiagnosticCode) || !nullableString(value.failureCode) ||
      !nullableString(value.failureStage) ||
      !(value.failureClass === null || ["PRODUCT_DEFECT", "SOURCE_TEMPORARILY_UNAVAILABLE", "CONFIGURATION_ERROR",
        "EVIDENCE_INSUFFICIENT"].includes(String(value.failureClass))) || !stringArray(value.blockers) ||
      !Array.isArray(value.paginationByChannel) || !value.paginationByChannel.every(validPaginationSummary)) {
    throw new Error("Fixed cohort audit company evidence is invalid");
  }
  return value as unknown as FixedCohortCompletenessAuditReport["companies"][number];
}

function stripDerivedAuditFields(
  row: FixedCohortCompletenessAuditReport["companies"][number]
): FixedCohortAuditSourceInput {
  const { blockers: _blockers, failureClass: _failureClass, failureStage: _failureStage,
    paginationByChannel: _paginationByChannel, ...source } = row;
  return source;
}

function validEvidenceArtifact(value: unknown): boolean {
  return isRecord(value) && exactKeys(value, ["id", "path", "sha256"]) && stringField(value.id) &&
    stringField(value.path) && stringField(value.sha256);
}
function validPaginationEvidence(value: unknown): boolean {
  return isRecord(value) && exactKeys(value, PAGINATION_KEYS) && stringField(value.artifactId) &&
    nonnegativeInteger(value.sequence) && nullableString(value.channelId) && nullableString(value.requestedCursor) &&
    nullableString(value.returnedCursor) && nullableNonnegativeInteger(value.requestedOffset) &&
    nullableNonnegativeInteger(value.returnedOffset) && nullableNonnegativeInteger(value.requestedPage) &&
    nullableNonnegativeInteger(value.returnedPage) && nullableNonnegativeInteger(value.requestedPageSize) &&
    nullableNonnegativeInteger(value.returnedPageSize) && stringField(value.responseFingerprintSha256) &&
    stringField(value.rawJobIdSetSha256) && stringField(value.validJobIdSetSha256) &&
    nullableNonnegativeInteger(value.declaredTotal) && nullableNonnegativeInteger(value.declaredCount) &&
    nullableNonnegativeInteger(value.declaredPages) && nullableString(value.nextPageSignalBefore) &&
    nullableString(value.nextPageSignalAfter) && stringField(value.termination) && stringArray(value.anomalyCodes) &&
    isCanonicalInstant(value.capturedAt);
}
function validPaginationSummary(value: unknown): boolean {
  return isRecord(value) && exactKeys(value, ["channelId", "declaredPages", "declaredTotal", "pageCount", "terminalEvent"]) &&
    nullableString(value.channelId) && nonnegativeInteger(value.pageCount) && nullableNonnegativeInteger(value.declaredTotal) &&
    nullableNonnegativeInteger(value.declaredPages) && stringField(value.terminalEvent);
}
function stringField(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function nullableNonemptyString(value: unknown): value is string | null { return value === null || stringField(value); }
function nullableSha256(value: unknown): value is string | null {
  return value === null || typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}
function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") && new Set(value).size === value.length;
}
function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function nullableNonnegativeInteger(value: unknown): value is number | null {
  return value === null || nonnegativeInteger(value);
}

function certificateValid(source: FixedCohortAuditSourceInput, releaseCandidateId: string, batchId: string, now: Date): boolean {
  if (!source.canonicalJobSetSha256 || !source.certificate || !source.certificateSha256 ||
    certificateSha256(source.certificate) !== source.certificateSha256 ||
    typeof source.certificate !== "object" || Array.isArray(source.certificate)) return false;
  const expected = { releaseCandidateId, batchId, sourceResultId: source.sourceResultId, sourceId: source.sourceId,
    companyId: source.companyId, sourceConfigSha256: source.sourceConfigSha256,
      canonicalJobSetSha256: source.canonicalJobSetSha256, surfaceIds: source.plannedSurfaceIds,
      channelIds: source.plannedChannelIds,
      ...(source.canonicalRawEvidenceIdSetSha256 ? {
        canonicalRawEvidenceIdSetSha256: source.canonicalRawEvidenceIdSetSha256
      } : {}) };
  try {
    if (source.grade === "A") verifyAGradeCompletenessCertificateReceipt({ certificate: source.certificate,
      certificateSha256: source.certificateSha256, expected });
    else if (source.grade === "B") verifyBGradeTraversalCertificateReceipt({ certificate: source.certificate,
      certificateSha256: source.certificateSha256, expected, now });
    else return false;
    return true;
  } catch { return false; }
}
function failureStageFor(source: FixedCohortAuditSourceInput, blockers: readonly string[]): string | null {
  if (blockers.length === 0) return null;
  if (source.atomicCommitState === "ROLLED_BACK") return "PERSISTENCE";
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
    const defaultChannelId = source.officialChannelIds.length === 1 ? source.officialChannelIds[0]! : null;
    const key = page.channelId ?? defaultChannelId ?? "\0SOURCE";
    const rows = groups.get(key) ?? []; rows.push(page); groups.set(key, rows);
  }
  const observedChannelIds = [...groups.keys()].filter((key) => key !== "\0SOURCE").sort(compare);
  if (groups.has("\0SOURCE") && source.officialChannelIds.length > 0 ||
      JSON.stringify(observedChannelIds) !== JSON.stringify([...source.officialChannelIds].sort(compare))) return null;
  const summaries = [];
  let usedExactLaterZeroDeclaration = false;
  for (const [key, rows] of [...groups].sort(([left], [right]) => compare(left, right))) {
    rows.sort((left, right) => left.sequence - right.sequence);
    if (rows.some((page) =>
      [page.requestedOffset, page.returnedOffset, page.requestedPage, page.returnedPage,
        page.requestedPageSize, page.returnedPageSize, page.declaredTotal, page.declaredCount, page.declaredPages]
        .some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0)))) return null;
    const reconciledLaterZero = exactLaterZeroPaginationDeclaration(source, rows);
    usedExactLaterZeroDeclaration ||= reconciledLaterZero !== null;
    const totals = reconciledLaterZero
      ? [reconciledLaterZero.declaredTotal]
      : [...new Set(rows.flatMap((page) => page.declaredTotal === null ? [] : [page.declaredTotal]))];
    const pages = reconciledLaterZero
      ? [reconciledLaterZero.declaredPages]
      : [...new Set(rows.flatMap((page) => page.declaredPages === null ? [] : [page.declaredPages]))];
    if (totals.length > 1 || pages.length > 1 || (pages[0] !== undefined && pages[0] !== rows.length)) return null;
    summaries.push({ channelId: key === "\0SOURCE" ? null : key, pageCount: rows.length,
      declaredTotal: totals[0] ?? null, declaredPages: pages[0] ?? null, terminalEvent: rows.at(-1)!.termination });
  }
  const expectedTotalPages = summaries.some(({ declaredPages }) => declaredPages === null)
    ? null : summaries.reduce((sum, row) => sum + row.declaredPages!, 0);
  if (source.totalPages !== expectedTotalPages && !(
    usedExactLaterZeroDeclaration && summaries.length === 1 && source.totalPages === null
  )) return null;
  return summaries;
}

function exactLaterZeroPaginationDeclaration(
  source: FixedCohortAuditSourceInput,
  rows: FixedCohortAuditSourceInput["paginationEvidence"][number][]
): { declaredTotal: number; declaredPages: number } | null {
  const first = rows[0];
  if (!AUDITED_LATER_ZERO_WORKDAY_SOURCE_IDS.has(source.sourceId) ||
      !first || rows.length < 2 || first.declaredTotal === null || first.declaredTotal <= 0 ||
      first.declaredPages === null || first.declaredPages !== rows.length) return null;
  if (rows.slice(1).some((page) => page.declaredTotal !== 0 || page.declaredPages !== 0)) return null;
  if (rows.slice(0, -1).some((page) => page.termination !== "CONTINUE") ||
      rows.at(-1)!.termination !== "NEXT_ABSENT") return null;
  if (rows.some((page) => page.anomalyCodes.length > 0)) return null;
  if (source.expectedEvidenceKind !== "OFFICIAL_TOTAL_COUNT" ||
      source.expectedJobCount !== first.declaredTotal || source.finalJobCount !== first.declaredTotal ||
      source.pagesVisited !== rows.length ||
      (source.totalPages !== null && source.totalPages !== first.declaredPages) ||
      source.transportState !== "SUCCEEDED" || source.adapterState !== "SUCCEEDED" ||
      source.completenessState !== "VERIFIED" || source.atomicCommitState !== "COMMITTED") return null;
  return { declaredTotal: first.declaredTotal, declaredPages: first.declaredPages };
}
const AUDITED_LATER_ZERO_WORKDAY_SOURCE_IDS = new Set([
  "source-amgen-china-social",
  "source-bms-china-social",
  "source-pfizer-china-social"
]);
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
  if (row.failureClass === "CONFIGURATION_ERROR") {
    return ["MANIFEST_BINDING_MISMATCH", "OFFICIAL_SCOPE_MISMATCH"]
      .find((blocker) => row.blockers.includes(blocker)) ?? row.failureCode ?? "CONFIGURATION_INVALID";
  }
  if (row.failureClass === "PRODUCT_DEFECT") {
    return row.failureCode ?? row.failureDiagnosticCode ??
      (row.atomicCommitState === "ROLLED_BACK" ? "ATOMIC_COMMIT_ROLLED_BACK" : "ADAPTER_EXECUTION_FAILED");
  }
  const evidencePriority = ["OFFICIAL_SCOPE_MISMATCH", "PAGINATION_EVIDENCE_INVALID", "EVIDENCE_LOCATION_MISSING",
    "EXPECTED_EVIDENCE_DECLARATION_MISSING", "EVIDENCE_COMMITMENT_INVALID", "CERTIFICATE_INVALID",
    "A_OR_B_CERTIFICATE_MISSING", "COMPLETENESS_NOT_VERIFIED"];
  const certificateFailure = row.blockerCode !== null && CERTIFICATE_FAILURE_CODES.has(row.blockerCode)
    ? row.blockerCode : undefined;
  return certificateFailure ?? evidencePriority.find((blocker) => row.blockers.includes(blocker)) ??
    row.blockers[0] ?? "UNKNOWN";
}
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) return false;
  return JSON.stringify([...left].sort(compare)) === JSON.stringify([...right].sort(compare));
}
const compare = (a: string, b: string) => Buffer.from(a).compare(Buffer.from(b));
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const CERTIFICATE_FAILURE_CODES = new Set<string>([
  ...B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES,
  "A_GRADE_CERTIFICATE_NOT_ISSUED",
  "B_GRADE_CERTIFICATE_NOT_ISSUED"
]);
const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const isCanonicalInstant = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
};
