import { describe, expect, it } from "vitest";
import {
  assertLongTailRuntimeSettled,
  buildExactSourceDiagnosticReport,
  EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS,
  EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES,
  parseExactSourceDiagnosticSession,
  prepareExactSourceDiagnostic
} from "../../src/crawler/exactSourceDiagnostic";

const settledMetrics = {
  memoryBytes: 1,
  pidsCurrent: 12,
  tmpBytes: 1,
  tmpInodes: 1,
  braveProcesses: 0,
  braveRssKiB: 0,
  crashpadProcesses: 0,
  zombieProcesses: 0,
  nodeProcesses: 0,
  nodeRssKiB: 0,
  nodeFdCount: 0,
  nodeThreads: 0
};

const longTailReport = {
  executionOrderMatchesSession: true,
  sources: [{
    sourceId: "source-terminal",
    startedAt: "2026-08-14T12:00:05.000Z",
    finishedAt: "2026-08-14T12:00:10.000Z"
  }]
};

describe("NON_CERTIFYING exact-source diagnostic", () => {
  it("rejects a session with additional authority fields", () => {
    expect(() => parseExactSourceDiagnosticSession({
      schemaVersion: "exact-source-diagnostic-v1",
      mode: "NON_CERTIFYING",
      releaseCandidateId: "rc-1",
      commitSha: "a".repeat(40),
      preparedAt: "2026-08-14T12:00:00.000Z",
      requests: [{ requestId: "request-1", sourceId: "source-a" }],
      qualificationDecision: "PASSED"
    })).toThrow("Exact-source diagnostic session is invalid");
  });

  it("prepares one bounded session through the current authority", async () => {
    const enqueued: string[] = [];

    await expect(prepareExactSourceDiagnostic({
      sourceIds: ["source-b", "source-a"],
      authority: {
        releaseCandidateId: "rc-1",
        commitSha: "a".repeat(40),
        sourceIds: ["source-a", "source-b", "source-c"]
      },
      now: new Date("2026-08-14T12:00:00.000Z"),
      enqueue: async (sourceId) => {
        enqueued.push(sourceId);
        return { id: `request-${sourceId}` };
      }
    })).resolves.toEqual({
      schemaVersion: "exact-source-diagnostic-v1",
      mode: "NON_CERTIFYING",
      releaseCandidateId: "rc-1",
      commitSha: "a".repeat(40),
      preparedAt: "2026-08-14T12:00:00.000Z",
      requests: [
        { requestId: "request-source-b", sourceId: "source-b" },
        { requestId: "request-source-a", sourceId: "source-a" }
      ]
    });
    expect(enqueued).toEqual(["source-b", "source-a"]);
  });

  it("round-trips the complete current B-grade authority in bounded sessions", async () => {
    const sourceIds = [...EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS];
    const visited: string[] = [];
    for (let offset = 0; offset < sourceIds.length; offset += EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES) {
      const selection = sourceIds.slice(offset, offset + EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES);
      const session = await prepareExactSourceDiagnostic({
        sourceIds: selection,
        authority: { releaseCandidateId: "rc-1", commitSha: "a".repeat(40), sourceIds },
        now: new Date("2026-08-14T12:00:00.000Z"),
        enqueue: async (sourceId) => { visited.push(sourceId); return { id: `request-${sourceId}` }; }
      });
      expect(parseExactSourceDiagnosticSession(session).requests).toHaveLength(selection.length);
      expect(session.requests.length).toBeLessThanOrEqual(15);
    }
    expect(visited).toEqual(sourceIds);
  });

  it("rejects a bounded B-grade subselection in a different order", async () => {
    const sourceIds = EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS.slice(0, 2);
    [sourceIds[0], sourceIds[1]] = [sourceIds[1]!, sourceIds[0]!];
    let enqueueCount = 0;

    await expect(prepareExactSourceDiagnostic({
      sourceIds,
      authority: {
        releaseCandidateId: "rc-1",
        commitSha: "a".repeat(40),
        sourceIds
      },
      now: new Date("2026-08-14T12:00:00.000Z"),
      enqueue: async () => { enqueueCount += 1; return { id: "request" }; }
    })).rejects.toThrow("current authority order");
    expect(enqueueCount).toBe(0);
  });

  it("rejects unreviewed sources before enqueue even within the session budget", async () => {
    const sourceIds = [EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS[0]!, "source-unreviewed"];
    let enqueued = 0;
    await expect(prepareExactSourceDiagnostic({
      sourceIds,
      authority: { releaseCandidateId: "rc-1", commitSha: "a".repeat(40), sourceIds: EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS },
      now: new Date("2026-08-14T12:00:00.000Z"),
      enqueue: async () => { enqueued += 1; return { id: "request" }; }
    })).rejects.toThrow("outside the current authority");
    expect(enqueued).toBe(0);
  });

  it("keeps the long-tail diagnostic bounded at fifteen sources", async () => {
    let enqueueCount = 0;
    const sourceIds = Array.from({ length: EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES + 1 },
      (_, index) => `s${index + 1}`);

    await expect(prepareExactSourceDiagnostic({
      sourceIds,
      authority: {
        releaseCandidateId: "rc-1",
        commitSha: "a".repeat(40),
        sourceIds
      },
      now: new Date("2026-08-14T12:00:00.000Z"),
      enqueue: async () => { enqueueCount += 1; return { id: "request" }; }
    })).rejects.toThrow("Exact-source diagnostic requires between one and 15 sources");
    expect(enqueueCount).toBe(0);
  });

  it("rejects an over-budget selection even when every source is currently reviewed", async () => {
    const sourceIds = [...EXACT_SOURCE_DIAGNOSTIC_LONG_TAIL_SOURCE_IDS];
    expect(sourceIds.length).toBeGreaterThan(EXACT_SOURCE_DIAGNOSTIC_MAX_SOURCES);
    let enqueued = 0;
    await expect(prepareExactSourceDiagnostic({
      sourceIds,
      authority: { releaseCandidateId: "rc-1", commitSha: "a".repeat(40), sourceIds },
      now: new Date("2026-08-14T12:00:00.000Z"),
      enqueue: async () => { enqueued += 1; return { id: "request" }; }
    })).rejects.toThrow("between one and 15 sources");
    expect(enqueued).toBe(0);
  });

  it("reports a closed B-grade stage as NON_CERTIFYING failure without raw reasons", () => {
    const report = buildExactSourceDiagnosticReport({
      session: {
        schemaVersion: "exact-source-diagnostic-v1",
        mode: "NON_CERTIFYING",
        releaseCandidateId: "rc-1",
        commitSha: "a".repeat(40),
        preparedAt: "2026-08-14T12:00:00.000Z",
        requests: [{ requestId: "request-1", sourceId: "source-astellas-china-social" }]
      },
      evaluatedAt: new Date("2026-08-14T12:01:00.000Z"),
      requests: [{
        id: "request-1",
        sourceId: "source-astellas-china-social",
        status: "FAILED",
        failureCode: "SOURCE_CRAWL_FAILED",
        startedAt: new Date("2026-08-14T12:00:05.000Z"),
        finishedAt: new Date("2026-08-14T12:00:35.000Z"),
        executionBatches: [{
          id: "batch-1",
          kind: "MANUAL_SOURCE",
          releaseCandidateId: "rc-1",
          commitSha: "a".repeat(40),
          status: "INCOMPLETE",
          sourceResults: [{
            sourceId: "source-astellas-china-social",
            transportState: "SUCCEEDED",
            adapterState: "SUCCEEDED",
            completenessState: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
            atomicCommitState: "COMMITTED",
            blockerCode: "B_GRADE_BROWSER_NAVIGATION_FAILED",
            failureCategory: null,
            failureDiagnosticCode: null,
            failureCode: null,
            fetchAttemptCount: 1,
            retryCount: 0,
            rawCount: 15,
            validCount: 15,
            dedupeOutputCount: 15,
            startedAt: new Date("2026-08-14T12:00:05.000Z"),
            finishedAt: new Date("2026-08-14T12:00:35.000Z")
          }]
        }]
      }]
    });

    expect(report).toMatchObject({
      schemaVersion: "exact-source-diagnostic-report-v1",
      mode: "NON_CERTIFYING",
      decision: "NON_CERTIFYING_FAIL",
      sourceCount: 1,
      sources: [{
        sourceId: "source-astellas-china-social",
        diagnosticCode: "B_GRADE_BROWSER_NAVIGATION_FAILED",
        durationMs: 30_000,
        rawCount: 15,
        validCount: 15,
        dedupeOutputCount: 15
      }]
    });
    expect(JSON.stringify(report)).not.toContain("reason");
  });

  it.each([
    { kind: "SCHEDULED", releaseCandidateId: "rc-1", commitSha: "a".repeat(40) },
    { kind: "MANUAL_SOURCE", releaseCandidateId: "rc-other", commitSha: "a".repeat(40) },
    { kind: "MANUAL_SOURCE", releaseCandidateId: "rc-1", commitSha: "b".repeat(40) }
  ])("rejects batch evidence outside the prepared runtime identity", (identity) => {
    expect(() => buildExactSourceDiagnosticReport({
      session: {
        schemaVersion: "exact-source-diagnostic-v1",
        mode: "NON_CERTIFYING",
        releaseCandidateId: "rc-1",
        commitSha: "a".repeat(40),
        preparedAt: "2026-08-14T12:00:00.000Z",
        requests: [{ requestId: "request-1", sourceId: "source-a" }]
      },
      evaluatedAt: new Date("2026-08-14T12:01:00.000Z"),
      requests: [{
        id: "request-1", sourceId: "source-a", status: "FAILED", failureCode: null,
        startedAt: null, finishedAt: null,
        executionBatches: [{ ...identity, id: "batch-1", status: "INCOMPLETE", sourceResults: [] }]
      }]
    })).toThrow("Exact-source diagnostic batch identity mismatch");
  });

  it("replaces persisted free-form diagnostic text with a closed fallback", () => {
    const report = buildExactSourceDiagnosticReport({
      session: {
        schemaVersion: "exact-source-diagnostic-v1", mode: "NON_CERTIFYING",
        releaseCandidateId: "rc-1", commitSha: "a".repeat(40),
        preparedAt: "2026-08-14T12:00:00.000Z",
        requests: [{ requestId: "request-1", sourceId: "source-a" }]
      },
      evaluatedAt: new Date("2026-08-14T12:01:00.000Z"),
      requests: [{
        id: "request-1", sourceId: "source-a", status: "FAILED", failureCode: "raw secret text",
        startedAt: null, finishedAt: null,
        executionBatches: [{
          id: "batch-1", kind: "MANUAL_SOURCE", releaseCandidateId: "rc-1",
          commitSha: "a".repeat(40), status: "INCOMPLETE", sourceResults: []
        }]
      }]
    });

    expect(report.sources[0]?.diagnosticCode).toBe("DIAGNOSTIC_EVIDENCE_INVALID");
    expect(JSON.stringify(report)).not.toContain("raw secret text");
  });

  it("marks a successful long-tail report invalid when the actual claim order differs from the session", () => {
    const session = {
      schemaVersion: "exact-source-diagnostic-v1" as const,
      mode: "NON_CERTIFYING" as const,
      releaseCandidateId: "rc-1",
      commitSha: "a".repeat(40),
      preparedAt: "2026-08-14T12:00:00.000Z",
      requests: [
        { requestId: "request-a", sourceId: "source-a" },
        { requestId: "request-b", sourceId: "source-b" }
      ]
    };
    const report = buildExactSourceDiagnosticReport({
      session,
      evaluatedAt: new Date("2026-08-14T12:01:00.000Z"),
      requests: [
        successfulRequest("request-a", "source-a", "2026-08-14T12:00:10.000Z"),
        successfulRequest("request-b", "source-b", "2026-08-14T12:00:05.000Z")
      ]
    });

    expect(report.executionOrderMatchesSession).toBe(false);
    expect(report.decision).toBe("NON_CERTIFYING_FAIL");
  });

  it("accepts transient lifecycle processes only after two clean post-terminal samples", () => {
    expect(() => assertLongTailRuntimeSettled({
      report: longTailReport,
      telemetry: [
        { capturedAt: "2026-08-14T12:00:01.000Z", metrics: {
          ...settledMetrics, pidsCurrent: 10, zombieProcesses: 1, nodeProcesses: 1
        } },
        { capturedAt: "2026-08-14T12:00:06.000Z", metrics: {
          ...settledMetrics, braveProcesses: 3, nodeProcesses: 1
        } },
        { capturedAt: "2026-08-14T12:00:11.000Z", metrics: settledMetrics },
        { capturedAt: "2026-08-14T12:00:13.000Z", metrics: { ...settledMetrics, pidsCurrent: 11 } }
      ]
    })).not.toThrow();
  });

  it.each([
    {
      name: "a browser still active in the terminal window",
      tail: [
        { capturedAt: "2026-08-14T12:00:11.000Z", metrics: settledMetrics },
        { capturedAt: "2026-08-14T12:00:13.000Z", metrics: { ...settledMetrics, braveProcesses: 1 } }
      ]
    },
    {
      name: "a terminal telemetry error",
      tail: [
        { capturedAt: "2026-08-14T12:00:11.000Z", metrics: settledMetrics },
        { capturedAt: "2026-08-14T12:00:13.000Z", sampleError: "METRICS_UNAVAILABLE" as const }
      ]
    }
  ])("rejects $name", ({ tail }) => {
    expect(() => assertLongTailRuntimeSettled({
      report: longTailReport,
      telemetry: [
        { capturedAt: "2026-08-14T12:00:01.000Z", metrics: {
          ...settledMetrics, pidsCurrent: 10, nodeProcesses: 1
        } },
        ...tail
      ]
    })).toThrow(/terminal|retained/u);
  });
});

function successfulRequest(id: string, sourceId: string, startedAt: string) {
  const start = new Date(startedAt);
  const finish = new Date(start.getTime() + 1_000);
  return {
    id,
    sourceId,
    status: "SUCCESS",
    failureCode: null,
    startedAt: start,
    finishedAt: finish,
    executionBatches: [{
      id: `batch-${id}`,
      kind: "MANUAL_SOURCE",
      releaseCandidateId: "rc-1",
      commitSha: "a".repeat(40),
      status: "SUCCESS",
      sourceResults: [{
        sourceId,
        transportState: "SUCCEEDED",
        adapterState: "SUCCEEDED",
        completenessState: "VERIFIED",
        atomicCommitState: "COMMITTED",
        blockerCode: null,
        failureCategory: null,
        failureDiagnosticCode: null,
        failureCode: null,
        fetchAttemptCount: 1,
        retryCount: 0,
        rawCount: 1,
        validCount: 1,
        dedupeOutputCount: 1,
        startedAt: start,
        finishedAt: finish
      }]
    }]
  };
}
