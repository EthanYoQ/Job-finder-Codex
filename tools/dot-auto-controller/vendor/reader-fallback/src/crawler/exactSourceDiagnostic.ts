import { z } from "zod";
import { B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES } from "./independentTraversalDiagnostics";
import {
  ATOMIC_EVIDENCE_FAILURE_CODES,
  SOURCE_EXECUTION_FAILURE_CODES,
  SOURCE_FAILURE_DIAGNOSTIC_CODES
} from "./sourceFailureDiagnostics";
import { REQUIRED_B_GRADE_TRAVERSAL_CERTIFICATES } from "./traversalCertificate";

export const EXACT_SOURCE_DIAGNOSTIC_SCHEMA_VERSION = "exact-source-diagnostic-v1" as const;
export const EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES = 15;
export const EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS = Object.freeze(
  Object.keys(REQUIRED_B_GRADE_TRAVERSAL_CERTIFICATES).sort()
);
if (EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS.length > EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES) {
  throw new Error("Exact-source diagnostic authority exceeds the bounded source limit");
}

export const EXACT_SOURCE_DIAGNOSTIC_CODES = Object.freeze([
  "SOURCE_VERIFIED",
  "DIAGNOSTIC_EVIDENCE_MISSING",
  "DIAGNOSTIC_EVIDENCE_INVALID",
  "SOURCE_CRAWL_FAILED",
  "MANUAL_CRAWL_FAILED",
  ...B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES,
  ...SOURCE_EXECUTION_FAILURE_CODES,
  ...SOURCE_FAILURE_DIAGNOSTIC_CODES,
  ...ATOMIC_EVIDENCE_FAILURE_CODES
] as const);

const EXACT_SOURCE_DIAGNOSTIC_CODE_SET = new Set<string>(EXACT_SOURCE_DIAGNOSTIC_CODES);

const sessionSchema = z.object({
  schemaVersion: z.literal(EXACT_SOURCE_DIAGNOSTIC_SCHEMA_VERSION),
  mode: z.literal("NON_CERTIFYING"),
  releaseCandidateId: z.string().min(1),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/u),
  preparedAt: z.string().datetime({ offset: true }),
  requests: z.array(z.object({
    requestId: z.string().min(1),
    sourceId: z.string().min(1)
  }).strict()).min(1).max(EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES)
}).strict().superRefine((value, context) => {
  if (new Set(value.requests.map(({ requestId }) => requestId)).size !== value.requests.length ||
      new Set(value.requests.map(({ sourceId }) => sourceId)).size !== value.requests.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "request identities must be unique" });
  }
});

export interface ExactSourceDiagnosticSession {
  schemaVersion: typeof EXACT_SOURCE_DIAGNOSTIC_SCHEMA_VERSION;
  mode: "NON_CERTIFYING";
  releaseCandidateId: string;
  commitSha: string;
  preparedAt: string;
  requests: Array<{ requestId: string; sourceId: string }>;
}

export function parseExactSourceDiagnosticSession(value: unknown): ExactSourceDiagnosticSession {
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) throw new Error("Exact-source diagnostic session is invalid");
  return parsed.data;
}

export interface ExactSourceDiagnosticRequestRow {
  id: string;
  sourceId: string;
  status: string;
  failureCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  executionBatches: Array<{
    id: string;
    kind: string | null;
    releaseCandidateId: string | null;
    commitSha: string | null;
    status: string;
    sourceResults: Array<{
      sourceId: string;
      transportState: string;
      adapterState: string;
      completenessState: string;
      atomicCommitState: string;
      blockerCode: string | null;
      failureCategory: string | null;
      failureDiagnosticCode: string | null;
      failureCode: string | null;
      fetchAttemptCount: number | null;
      retryCount: number | null;
      rawCount: number;
      validCount: number;
      dedupeOutputCount: number;
      startedAt: Date;
      finishedAt: Date | null;
    }>;
  }>;
}

export interface ExactSourceDiagnosticReport {
  schemaVersion: "exact-source-diagnostic-report-v1";
  mode: "NON_CERTIFYING";
  decision: "NON_CERTIFYING_PASS" | "NON_CERTIFYING_FAIL";
  releaseCandidateId: string;
  commitSha: string;
  preparedAt: string;
  evaluatedAt: string;
  sourceCount: number;
  executionOrderMatchesSession: boolean;
  sources: Array<{
    requestId: string;
    sourceId: string;
    requestStatus: string;
    batchId: string | null;
    batchStatus: string | null;
    transportState: string | null;
    adapterState: string | null;
    completenessState: string | null;
    atomicCommitState: string | null;
    diagnosticCode: string;
    fetchAttemptCount: number | null;
    retryCount: number | null;
    rawCount: number | null;
    validCount: number | null;
    dedupeOutputCount: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
  }>;
}

const runtimeMetricsSchema = z.object({
  memoryBytes: z.number().int().nonnegative(),
  pidsCurrent: z.number().int().nonnegative(),
  tmpBytes: z.number().int().nonnegative(),
  tmpInodes: z.number().int().nonnegative(),
  braveProcesses: z.number().int().nonnegative(),
  braveRssKiB: z.number().int().nonnegative(),
  crashpadProcesses: z.number().int().nonnegative(),
  zombieProcesses: z.number().int().nonnegative(),
  nodeProcesses: z.number().int().nonnegative(),
  nodeRssKiB: z.number().int().nonnegative(),
  nodeFdCount: z.number().int().nonnegative(),
  nodeThreads: z.number().int().nonnegative()
}).strict();

const runtimeSampleSchema = z.union([
  z.object({
    capturedAt: z.string().datetime({ offset: true }),
    metrics: runtimeMetricsSchema
  }).strict(),
  z.object({
    capturedAt: z.string().datetime({ offset: true }),
    sampleError: z.literal("METRICS_UNAVAILABLE")
  }).strict()
]);

const longTailReportSchema = z.object({
  executionOrderMatchesSession: z.literal(true),
  sources: z.array(z.object({
    sourceId: z.string().min(1),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    finishedAt: z.string().datetime({ offset: true }).nullable()
  }).passthrough()).min(1)
}).passthrough();

export function assertLongTailRuntimeSettled(input: {
  report: unknown;
  telemetry: unknown;
}): void {
  const report = longTailReportSchema.parse(input.report);
  const telemetry = z.array(runtimeSampleSchema).min(3).parse(input.telemetry);
  const terminalFinishedAt = Date.parse(report.sources.at(-1)?.finishedAt ?? "");
  if (!Number.isFinite(terminalFinishedAt)) {
    throw new Error("Long-tail diagnostic terminal source completion is unavailable");
  }

  const measured = telemetry.filter((sample): sample is z.infer<typeof runtimeSampleSchema> & {
    metrics: z.infer<typeof runtimeMetricsSchema>;
  } => "metrics" in sample);
  const preTerminalIdle = measured.filter((sample) =>
    Date.parse(sample.capturedAt) < terminalFinishedAt && sample.metrics.braveProcesses === 0
  );
  if (preTerminalIdle.length < 1) {
    throw new Error("Long-tail diagnostic lacks an idle lifecycle baseline");
  }
  const baselinePids = Math.min(...preTerminalIdle.map(({ metrics }) => metrics.pidsCurrent));
  const terminalWindow = telemetry.filter((sample) => Date.parse(sample.capturedAt) >= terminalFinishedAt).slice(-2);
  if (terminalWindow.length !== 2 || terminalWindow.some((sample) => !("metrics" in sample))) {
    throw new Error("Long-tail diagnostic lacks a settled terminal telemetry window");
  }
  for (const sample of terminalWindow) {
    if (!("metrics" in sample)) throw new Error("Long-tail diagnostic terminal telemetry is unavailable");
    const metrics = sample.metrics;
    if (metrics.braveProcesses !== 0 || metrics.crashpadProcesses !== 0 ||
        metrics.zombieProcesses !== 0 || metrics.nodeProcesses !== 0) {
      throw new Error("Long-tail diagnostic retained browser lifecycle processes");
    }
    if (metrics.pidsCurrent > baselinePids + 16) {
      throw new Error("Long-tail diagnostic leaked browser lifecycle tasks");
    }
  }
}

export async function prepareExactSourceDiagnostic(input: {
  sourceIds: readonly string[];
  authority: { releaseCandidateId: string; commitSha: string; sourceIds: readonly string[] };
  now: Date;
  enqueue(sourceId: string): Promise<{ id: string }>;
}): Promise<ExactSourceDiagnosticSession> {
  if (input.sourceIds.length < 1 || input.sourceIds.length > EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES) {
    throw new Error(`Exact-source diagnostic requires between one and ${EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES} sources`);
  }
  const selected = new Set(input.sourceIds);
  if (selected.size !== input.sourceIds.length || input.sourceIds.some((sourceId) => !sourceId.trim())) {
    throw new Error("Exact-source diagnostic source selection must be unique and nonblank");
  }
  const longTailSet = new Set(EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS);
  const selectsCompleteLongTail = input.sourceIds.length === longTailSet.size &&
    input.sourceIds.every((sourceId) => longTailSet.has(sourceId));
  if (selectsCompleteLongTail &&
      JSON.stringify(input.sourceIds) !== JSON.stringify(EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS)) {
    throw new Error("Exact-source diagnostic complete B-grade selection must use the current authority order");
  }
  const authoritySourceIds = new Set(input.authority.sourceIds);
  if (input.sourceIds.some((sourceId) => !authoritySourceIds.has(sourceId))) {
    throw new Error("Exact-source diagnostic source selection is outside the current authority");
  }
  const requests: Array<{ requestId: string; sourceId: string }> = [];
  for (const sourceId of input.sourceIds) {
    const request = await input.enqueue(sourceId);
    requests.push({ requestId: request.id, sourceId });
  }
  return {
    schemaVersion: EXACT_SOURCE_DIAGNOSTIC_SCHEMA_VERSION,
    mode: "NON_CERTIFYING",
    releaseCandidateId: input.authority.releaseCandidateId,
    commitSha: input.authority.commitSha,
    preparedAt: input.now.toISOString(),
    requests
  };
}

export function buildExactSourceDiagnosticReport(input: {
  session: ExactSourceDiagnosticSession;
  evaluatedAt: Date;
  requests: readonly ExactSourceDiagnosticRequestRow[];
}): ExactSourceDiagnosticReport {
  const rowById = new Map(input.requests.map((row) => [row.id, row]));
  if (rowById.size !== input.requests.length || input.requests.length !== input.session.requests.length) {
    throw new Error("Exact-source diagnostic request evidence does not match the session");
  }
  const actualRequestOrder = [...input.requests]
    .filter((request): request is ExactSourceDiagnosticRequestRow & { startedAt: Date } => request.startedAt !== null)
    .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime() || left.id.localeCompare(right.id))
    .map(({ id }) => id);
  const executionOrderMatchesSession = actualRequestOrder.length === input.session.requests.length &&
    JSON.stringify(actualRequestOrder) === JSON.stringify(input.session.requests.map(({ requestId }) => requestId));
  const sources = input.session.requests.map(({ requestId, sourceId }) => {
    const request = rowById.get(requestId);
    if (!request || request.sourceId !== sourceId) {
      throw new Error("Exact-source diagnostic request identity mismatch");
    }
    const batch = request.executionBatches.length === 1 ? request.executionBatches[0] : undefined;
    if (batch && (batch.kind !== "MANUAL_SOURCE" ||
        batch.releaseCandidateId !== input.session.releaseCandidateId ||
        batch.commitSha !== input.session.commitSha)) {
      throw new Error("Exact-source diagnostic batch identity mismatch");
    }
    const sourceResult = batch?.sourceResults.length === 1 && batch.sourceResults[0]?.sourceId === sourceId
      ? batch.sourceResults[0]
      : undefined;
    const succeeded = request.status === "SUCCESS" && batch?.status === "SUCCESS" &&
      sourceResult?.transportState === "SUCCEEDED" && sourceResult.adapterState === "SUCCEEDED" &&
      sourceResult.completenessState === "VERIFIED" && sourceResult.atomicCommitState === "COMMITTED";
    const startedAt = sourceResult?.startedAt ?? request.startedAt;
    const finishedAt = sourceResult?.finishedAt ?? request.finishedAt;
    const durationMs = startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;
    const persistedDiagnosticCode = sourceResult?.blockerCode ?? sourceResult?.failureDiagnosticCode ??
      sourceResult?.failureCode ?? request.failureCode;
    const diagnosticCode = persistedDiagnosticCode === null || persistedDiagnosticCode === undefined
      ? (succeeded ? "SOURCE_VERIFIED" : "DIAGNOSTIC_EVIDENCE_MISSING")
      : EXACT_SOURCE_DIAGNOSTIC_CODE_SET.has(persistedDiagnosticCode)
        ? persistedDiagnosticCode
        : "DIAGNOSTIC_EVIDENCE_INVALID";
    return {
      requestId,
      sourceId,
      requestStatus: request.status,
      batchId: batch?.id ?? null,
      batchStatus: batch?.status ?? null,
      transportState: sourceResult?.transportState ?? null,
      adapterState: sourceResult?.adapterState ?? null,
      completenessState: sourceResult?.completenessState ?? null,
      atomicCommitState: sourceResult?.atomicCommitState ?? null,
      diagnosticCode,
      fetchAttemptCount: sourceResult?.fetchAttemptCount ?? null,
      retryCount: sourceResult?.retryCount ?? null,
      rawCount: sourceResult?.rawCount ?? null,
      validCount: sourceResult?.validCount ?? null,
      dedupeOutputCount: sourceResult?.dedupeOutputCount ?? null,
      startedAt: startedAt?.toISOString() ?? null,
      finishedAt: finishedAt?.toISOString() ?? null,
      durationMs: durationMs !== null && Number.isSafeInteger(durationMs) && durationMs >= 0 ? durationMs : null,
      succeeded
    };
  });
  const decision = executionOrderMatchesSession && sources.every(({ succeeded }) => succeeded)
    ? "NON_CERTIFYING_PASS" as const
    : "NON_CERTIFYING_FAIL" as const;
  return {
    schemaVersion: "exact-source-diagnostic-report-v1",
    mode: "NON_CERTIFYING",
    decision,
    releaseCandidateId: input.session.releaseCandidateId,
    commitSha: input.session.commitSha,
    preparedAt: input.session.preparedAt,
    evaluatedAt: input.evaluatedAt.toISOString(),
    sourceCount: sources.length,
    executionOrderMatchesSession,
    sources: sources.map(({ succeeded: _succeeded, ...source }) => source)
  };
}
