import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSourceFetchAttemptTracker } from "../src/crawler/runSourceCrawl.ts";
import { createSourceFetchRouter } from "../src/crawler/sourceFetchRouter.ts";
import { isRetryableSourceTransportFailureCode, isRetryableSourceTransportFailure,
  retryableTransportFailureFromError, safeSourceTransportFailureReason } from "../src/crawler/sourceFetchFailure.ts";
import { OfficialRequestDeferredError } from "../src/crawler/sourceTransportObservation.ts";
import { WorkdayCooldownError } from "../src/crawler/workdayRequestPolicy.ts";
import { transportFailureDiagnosticBundle } from "../src/crawler/sourceFailureDiagnostics.ts";
import { terminatePendingSourceResult, terminateManualPendingSourceResult } from "../src/db/ingestionRepository.ts";

const plan = { source: { id: "source-deferred-test", atsKind: "OFFICIAL_HTML" }, adapterId: "html-table",
  transientRetryPolicy: { maxRetries: 2, backoffMs: 10_000 } };
const failed = transportFailure => ({ ok: false, capturedAt: new Date().toISOString(),
  failureReason: safeSourceTransportFailureReason(transportFailure), transportFailure });
const unexpected = () => assert.fail("Unexpected adapter");
const terminal = (failure, tracker) => ({ id: "result", releaseCandidateId: "candidate", batchId: "batch",
  sourceId: plan.source.id, transportState: "FAILED", adapterState: "SKIPPED", completenessState: "FAILED",
  atomicCommitState: "NOT_ATTEMPTED", finishedAt: new Date(), failureCode: "SOURCE_TRANSPORT_FAILED",
  failureReason: safeSourceTransportFailureReason(failure), ...transportFailureDiagnosticBundle(failure, tracker) });

for (const milliseconds of [0, 1, 9_999]) {
  for (const kind of ["workday", "official"]) {
    test(`${kind} local deferral with ${milliseconds}ms remaining ends the acquisition before retry accounting`, async () => {
      const error = kind === "workday" ? new WorkdayCooldownError(429, milliseconds)
        : new OfficialRequestDeferredError(Date.now() + milliseconds);
      const failure = retryableTransportFailureFromError(error), tracker = createSourceFetchAttemptTracker();
      let captures = 0, stored;
      const router = createSourceFetchRouter({ fallback: unexpected, moka: unexpected,
        html: async () => { captures++; return failed(failure); },
        delay: () => assert.fail("Local deferral must not enter the in-wave wait") });
      assert.equal((await router(plan, tracker)).transportFailure.code, "OFFICIAL_REQUEST_DEFERRED");
      assert.equal(captures, 1);
      assert.deepEqual(tracker, { fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] });
      const input = terminal(failure, tracker);
      await terminatePendingSourceResult(input, { $transaction: async operation => operation({
        crawlBatchSourceResult: { updateMany: async ({data}) => { stored = data; return { count: 1 }; } }
      }) });
      assert.equal(stored.failureDiagnosticCode, "FETCH_FAILED_CLOSED");
      assert.deepEqual(stored.retryReasonCodes, []);
    });
  }
}

test("a real transient retry followed by local deferral stores only the real retry reason", async () => {
  const tracker = createSourceFetchAttemptTracker();
  let captures = 0, waits = 0;
  const router = createSourceFetchRouter({ fallback: unexpected, moka: unexpected,
    html: async () => failed(++captures === 1 ? { code: "OFFICIAL_HTTP_503", retryable: true }
      : retryableTransportFailureFromError(new WorkdayCooldownError(403, 1))),
    delay: async () => { waits++; } });
  assert.equal((await router(plan, tracker)).transportFailure.code, "OFFICIAL_REQUEST_DEFERRED");
  assert.equal(captures, 2);
  assert.equal(waits, 1);
  assert.deepEqual(tracker, { fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_HTTP_503"] });
});

test("the persisted retry-code validator matches the SQL constraint and excludes local deferral", async () => {
  const migration = readFileSync(new URL("../prisma/migrations/20260825093000_browser_and_pagination_retry_diagnostics/migration.sql", import.meta.url), "utf8");
  const pattern = migration.match(/'(\^\(OFFICIAL_HTTP_TIMEOUT[^']+)'/)[1];
  const constraint = new RegExp(pattern);
  const codes = ["OFFICIAL_HTTP_TIMEOUT", "OFFICIAL_NETWORK_ERROR", "OFFICIAL_BROWSER_SESSION_ERROR",
    "OFFICIAL_PAGINATION_SNAPSHOT_DRIFT", "OFFICIAL_HTTP_429",
    ...Array.from({length:100}, (_, index) => `OFFICIAL_HTTP_${500 + index}`), "OFFICIAL_REQUEST_DEFERRED"];
  for (const code of codes) assert.equal(isRetryableSourceTransportFailureCode(code), constraint.test(code), code);
  const failure = retryableTransportFailureFromError(new WorkdayCooldownError(429, 1));
  assert.equal(isRetryableSourceTransportFailure(failure), true, "Local deferral remains a valid internal failure");
  const input = terminal(failure, { fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_REQUEST_DEFERRED"] });
  const db = { $transaction: () => assert.fail("Invalid retry reason must fail before any storage transaction") };
  await assert.rejects(terminatePendingSourceResult(input, db), /closed transport codes/);
  await assert.rejects(terminateManualPendingSourceResult(input, {}, db), /closed transport codes/);
});
