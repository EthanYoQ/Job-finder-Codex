import { z } from "zod";

export const EXACT_SOURCE_DIAGNOSTIC_SCHEMA_VERSION = "exact-source-diagnostic-v1" as const;

const sessionSchema = z.object({
  schemaVersion: z.literal(EXACT_SOURCE_DIAGNOSTIC_SCHEMA_VERSION),
  mode: z.literal("NON_CERTIFYING"),
  releaseCandidateId: z.string().min(1),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/u),
  preparedAt: z.string().datetime({ offset: true }),
  requests: z.array(z.object({
    requestId: z.string().min(1),
    sourceId: z.string().min(1)
  }).strict()).min(1).max(5)
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

export async function prepareExactSourceDiagnostic(input: {
  sourceIds: readonly string[];
  authority: { releaseCandidateId: string; commitSha: string; sourceIds: readonly string[] };
  now: Date;
  enqueue(sourceId: string): Promise<{ id: string }>;
}): Promise<ExactSourceDiagnosticSession> {
  if (input.sourceIds.length < 1 || input.sourceIds.length > 5) {
    throw new Error("Exact-source diagnostic requires between one and five sources");
  }
  const selected = new Set(input.sourceIds);
  if (selected.size !== input.sourceIds.length || input.sourceIds.some((sourceId) => !sourceId.trim())) {
    throw new Error("Exact-source diagnostic source selection must be unique and nonblank");
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
  const sources = input.session.requests.map(({ requestId, sourceId }) => {
    const request = rowById.get(requestId);
    if (!request || request.sourceId !== sourceId) {
      throw new Error("Exact-source diagnostic request identity mismatch");
    }
    const batch = request.executionBatches.length === 1 ? request.executionBatches[0] : undefined;
    const sourceResult = batch?.sourceResults.length === 1 && batch.sourceResults[0]?.sourceId === sourceId
      ? batch.sourceResults[0]
      : undefined;
    const succeeded = request.status === "SUCCESS" && batch?.status === "SUCCESS" &&
      sourceResult?.transportState === "SUCCEEDED" && sourceResult.adapterState === "SUCCEEDED" &&
      sourceResult.completenessState === "VERIFIED" && sourceResult.atomicCommitState === "COMMITTED";
    const startedAt = sourceResult?.startedAt ?? request.startedAt;
    const finishedAt = sourceResult?.finishedAt ?? request.finishedAt;
    const durationMs = startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;
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
      diagnosticCode: sourceResult?.blockerCode ?? sourceResult?.failureCode ??
        sourceResult?.failureDiagnosticCode ?? request.failureCode ??
        (succeeded ? "SOURCE_VERIFIED" : "DIAGNOSTIC_EVIDENCE_MISSING"),
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
  const decision = sources.every(({ succeeded }) => succeeded)
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
    sources: sources.map(({ succeeded: _succeeded, ...source }) => source)
  };
}
