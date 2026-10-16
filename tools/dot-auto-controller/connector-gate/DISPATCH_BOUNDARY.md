# Connector publication observer: offline boundary

## Status and scope

This is an inactive offline contract in the candidate directory. The default mode is `DISABLED`. The only executable mode is explicitly named `TEST_ONLY` and requires a `TEST_ONLY_SYNTHETIC_PORT`. There is no real connector adapter, SQL execution, network client, credential reader, child launcher, source-release operation, schedule service, ledger, migration, or direct PostgreSQL route in this module. It does not modify or import the original host helper as an active entrypoint.

## Runtime-neutral tool-host form

The observer now uses ECMAScript data helpers instead of `node:util` or `structuredClone`. `cloneEvidenceData` and `equalEvidenceData` accept only the original JSON-shaped evidence contract plus actual `undefined`. They distinguish missing fields from explicit `undefined` and zero from negative zero. They reject functions, symbols, nonfinite numbers, bigints, cycles, custom/null prototypes, host objects, sparse/custom arrays, accessors, and nonenumerable properties. Own `__proto__` is copied safely as a data property. Authorization tokens, Promises, and raw tool errors are never routed through these data helpers. As before, trusted in-process callbacks are a composition boundary, not a sandbox for hostile arbitrary JavaScript or proxies.

`dispatch-observer.functions.js` is a fixed, test-checked text transform of this module: remove only line-start `export ` declarations and append a return of the four named functions. It contains no imports or Node globals. It is intended for a trusted tool-host loader after the bundle bytes have been independently pinned. Loading unchecked candidate code and asking it to attest itself is not a trust boundary.

`dispatch-observer.functions.smoke.js` is an AsyncFunction body taking `observerAPI`. Its ports, permissions, evidence authorities, clock, request, and tool Promise are entirely synthetic. It verifies one-use dispatch, preserved Promise identity, the unchanged phase deadlines, restart hold, default disablement, and strict undefined cloning. It calls no tools, connector, network, filesystem, or credentials. `dispatch-observer.host-neutral.test.mjs` checks exact bundle/source equality and runs this smoke in a Node VM realm with no `process`, `require`, or `structuredClone`, alongside strict data-helper rejection tests. The same fixed bundle and smoke also passed in the actual `functions.exec` isolate, where both `structuredClone` and `process` were absent. This is host compatibility evidence only; the actual publication port remains disabled.

The test harness uses local synthetic functions and opaque test tokens. It does not assert that a Node process possesses official connector credentials. The test port marker is a deliberate test opt-in, not a sandbox: trusted JavaScript callbacks can perform arbitrary operations, so a future integration must not put a real tool behind the test interface.

`TEST_ONLY_VERIFIED` means only that the offline contract saw all required synthetic facts in a valid sequence. `releaseEligible` and `newBatchAllowed` are always false, and `sourceHeld` is always true. This module cannot qualify production or release a real source.

## Authorization seam

Construct the observer with the exact original PUBLISH request, an opaque authorization token, and the deterministic gate's trusted `consumeAuthorization` closure. The intended consumer is `consumeReviewedTakedaPublication(authorization, request)` from the adjacent review gate. It must use private in-process token identity, consume before awaiting physical rechecks, and reject copied, previously consumed, or forged tokens. It returns:

```js
{
  request: frozenExactRequest,
  dispatchBefore: originalDispatchTimestamp,
  expiresAt: originalResponseTimestamp,
  outerDeadline: originalOuterTimestamp,
  tuple: frozenOriginalTuple,
  mode: 'OFFLINE_REVIEW_ONLY'
}
```

The observer checks the returned exact request and original timestamps. It never treats a hash, matching JSON, or the mode string as authorization. A supplied verifier function is a trusted composition-root dependency; this generic observer cannot itself attest the provenance of an arbitrary JavaScript function. Do not load the verifier, port callbacks, or evidence authorities from configuration or request data. A future real composition root must bind the imported deterministic consumer directly rather than accept an arbitrary caller's approval predicate.

`dispatch()` seals its instance synchronously before the authorization callback can await. Any later failure leaves it sealed. Separate observers still rely on the gate's one-use token and the original relay's exclusive `wx` intent file. There is no new durable authority here. An offline test explicitly models two separately authorized observers contending on the same exclusive intent; only the first can invoke the synthetic tool.

## Dispatch and deadline sequence

1. Seal this observer, retain the original request, and start independent deadline observation.
2. Consume the gate token and finish its deterministic/physical rechecks.
3. Recheck the original dispatch, response, and outer deadlines.
4. Enter the existing exclusive intent boundary exactly once. Its callback receives `flag: 'wx'`. A confirmed receipt must identify the exact request and exclusive creation. A thrown, lost, duplicate, malformed, or unconfirmed receipt holds the attempt before publication.
5. Recheck all original deadlines after the asynchronous intent acknowledgement.
6. Invoke the synthetic tool once and retain the exact returned native Promise. `dispatch()` then returns a snapshot; it does not wait for that publication Promise to finish.
7. Observe settlement on that same Promise. Independent one-shot timers and `observeDeadline()` never race away, cancel, recreate, or replace it. The active timer uses the earliest still-pending phase's original deadline. After a timely exact PUBLISH response acknowledgement, the PUBLISH response deadline stops governing the later read and exit phases. There is no interval or lease renewal.

If a phase's own original deadline arrives while that phase remains pending, the state becomes `UNKNOWN`. The response cutoff governs authorization, intent, tool and response; the original READ_OUTCOME cutoff governs its read; the original outer cutoff governs remaining wrapper/child completion. Crossing a completed phase's cutoff does not fail a later phase. Expiry does not mean cancellation, rollback, non-dispatch, or permission for another batch.

The live observer retains `liveToolPromise`, `settlementPromise`, and `rawToolFact`. A late success, rejection, or malformed response is still observed on the original Promise and kept as a raw fact. Nothing synthesizes a SQL timeout response. After expiry, no new response write starts. An already-started response write retains its original Promise; a late acknowledgement is recorded as `WRITTEN_EXACT_LATE` and remains held. This stricter boundary does not change the original host helper on disk.

A timely settled tool result may cause exactly one `writeResponseOnce` call. The callback receives the original request, normalized result, actual raw tool fact, and `flag: 'wx'`. A native Promise and exact exclusive acknowledgement are required. Lost acknowledgement, duplicate response, write error, changed request/result, or missing receipt holds the source. Neither publication nor response writing is retried.

## Independent original-evidence gates

Tool success and response persistence do not prove successful publication. Both independent gates must also succeed within their own original phase deadlines:

- The original wrapper and original child must have been actually reaped, both with exit code zero and no signal. The owning authority must validate a live in-process token obtained from the original process observation. It must bind the original request, tuple, launch/session identity, and original outer deadline. The observer rejects missing identity, nonzero exits, nonterminal children, future or pre-invocation observations, and terminal observations at or beyond the original outer deadline.
- The original `READ_OUTCOME` authority must validate a separate live token from the original read-only inspector and original tuple. The observer requires `COMMITTED_EXACT` observed before the exact original read request's `expiresAt`. Missing, ambiguous, mismatched, or rollback evidence cannot qualify completion. It never derives database commit from a transport success envelope.

The observer captures each authority's `accept(token, expected)` function at construction. `expected` is `{ requestId, requestSha256, tuple, outerDeadline }`. After private token validation, the terminal authority returns:

```js
{
  kind: 'ORIGINAL_CHILD_TERMINAL', expected, observedAt,
  originalSessionId, originalLaunchSha256,
  wrapper: { state: 'TERMINATED', exitCode: 0, signal: null, reaped: true },
  child: { state: 'TERMINATED', exitCode: 0, signal: null, reaped: true }
}
```

The read-only authority returns `{ kind: 'READ_OUTCOME', expected, originalRequest, observedAt, state }`. `originalRequest` is the exact original worker's immutable READ_OUTCOME request, including its request ID, hash, SQL, project, expiry, and dispatch cutoff. The trusted authority must verify the request's live provenance, original tuple, original native deadline derivation, and exact native inspector result. A matching request-shaped JSON object alone is not accepted.

The optional `observeReadOutcomeRequest(token)` accepts the same authority's opaque `{ kind: 'READ_OUTCOME_REQUEST', expected, originalRequest }` fact when the original read is queued. This enables independent observation of that read's exact deadline before its result arrives. Without this live token, the observer leaves `outcomeDeadline` unknown and does not invent one; a final authenticated outcome token can bind it later. Once bound, a different request ID, hash, SQL, or deadline is rejected, including a one-millisecond extension. This method does not dispatch a read or create a timer budget.

The fixture's test-only authorities use private WeakMaps so JSON copies are rejected. No actual child/process or read-request adapter is shipped here; fitting the preserved live observer to these interfaces remains a separate integration obligation.

### Original phase boundaries retained

The source of these boundaries is `vendor/c60-source/src/crawler/cloudDbStartedPilot.ts`, not a new observer policy:

- Lines 27–30 reserve two `controlMs` windows after publication: one final read and one local report/exit window. `publicationDeadline = min(evidenceExpiry, overallDeadline - 2 * controlMs)`.
- Lines 48–52 make one PUBLISH call. An unknown response may wait to the same PUBLISH `expiresAt`; it does not cancel SQL or authorize retry.
- Lines 55–64 make one final READ_OUTCOME call. Its original worker chooses `outcomeDeadline = min(overallDeadline - controlMs, originalPhaseEntryTime + controlMs)`. The original code requires more than `controlCompletionMs` remaining before the read. `cloudSourcePilotRelay.ts:10,52–56` fixes these values at 60,000 ms and 25,000 ms and records read dispatch cutoff as `outcomeDeadline - 25,000`.
- Lines 68–73 inspect the exact persisted outcome and native terminal batch/holder state. Successful read completion can be followed by local reporting and actual original child/wrapper exit before the unchanged outer deadline.

The observer verifies the authenticated original read request is bounded by `outerDeadline - 60,000` and retains its exact `expiresAt` and `dispatchBefore`; it never computes `now() + 60,000`. After timely `COMMITTED_EXACT`, the read cutoff no longer governs the pending child. A timely PUBLISH response, READ_OUTCOME after PUBLISH expiry, and actual child exit after the read deadline but before outer are therefore permitted by the synthetic contract. Tool/response expiry remains an irreversible UNKNOWN hold, and the real source stays held in all modes.

The observer's successful-envelope parser mirrors the original helper's `untrusted-data` row extraction. All error envelopes and exceptions conservatively remain unknown; it does not claim a new rollback proof. Existing stronger rollback recognition is not replaced.

## Recovery and holds

`restoreDispatchObserver({ request, expected, readOutcomeAuthority })` treats saved data only as context. It always starts `UNKNOWN` in `RESTORED_READ_ONLY` mode. It cannot dispatch, recreate a live Promise or child capability, restore prior completion, or release the source. It may accept the original read-only outcome token to record what the database inspector actually learned; the hold remains even when that result is `COMMITTED_EXACT`.

Unknown/failure conditions are sticky. Later positive facts can improve the recorded outcome but cannot erase an earlier unsafe boundary. This is deliberately conservative. A stopped or lost host cannot continue observing its vanished in-memory Promise; no restart mechanism here pretends otherwise. Cross-process recovery, live official-tool binding, response-file durability, exact actual-child authority, original inspector integration, and full end-to-end qualification remain unimplemented.

## Verification

Run from `tools/dot-auto-controller` with the pinned Node 22.23.3 binary:

```sh
node --require ./test/no-network.cjs --test connector-gate/dispatch-observer.test.mjs
```

Tests exercise default disablement, asynchronous permit consumption, copied/forged tokens, gate recheck failure, duplicate dispatch, cross-observer exclusive intents, each deadline boundary, the original staged read/report/exit reserves, pending tools, late success/failure/unknown responses, response loss/duplicate/write failure, child and outcome failures, JSON terminal forgery, restart holds, and immutable callback/request binding. The old-red/new-green regression retains a timely response, completes READ_OUTCOME after PUBLISH expiry, then accepts a real-token fixture child exit after the read cutoff but before outer. Additional tests reject changed read request/SQL/hash, extended cutoff, missing original request, late read, wrong project, and forged request JSON. The source check rejects connector calls, network clients, direct-PG imports, `Promise.race`, interval renewals, and environment-secret reads in this module. These are focused offline contract tests, not live connector or full-controller qualification.
