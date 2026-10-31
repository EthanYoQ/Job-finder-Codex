# Failure-code diagnostic candidate — inactive

## Result

The existing `failure-summary.py` reads a top-level `failureCode`, but both original producer routes use `preservePilotFailure()` in `scripts/p0-cloud-source-pilot.ts`, which writes ordered `errors[].code` instead. All 27 retained failure artifacts had a native error code and no top-level code. The old summary therefore printed `failureCode: null`.

The candidate preserves an explicit legacy top-level code, otherwise selects the first nonempty code in the existing outer-error-to-cause order. It does not infer a publication result, change the full reason or classify an UNKNOWN operation as resolved. Production diff: one added assignment and one replaced field value; no dependencies or protocol changes.

## Scope and caller

The sole active caller is the existing `pollProducer` diagnostic fallback in `original-relay-automation-20261017T0609Z/run-original-functions.js`. It calls this script only when the producer exited unsuccessfully without nonempty terminal output. The caller retains the summary as diagnostic text; it does not use `failureCode` to authorize capture, retry, publication or source isolation. No caller changes are needed.

The retained HOLD evidence was read only. No source HOLD was removed, and this improvement does not make a company operational or increase published coverage. The rejected/unknown relay files were not executed or changed.

## Verification

- `python3 failure-summary.test.py before/failure-summary.py` fails on the exact retained Amgen diagnostic: expected `RELAY_DEADLINE`, actual `null` (`baseline-new-test.log`).
- `python3 failure-summary.test.py` passes (`candidate-test.log`). It covers the retained artifact, explicit top-level precedence, ordered nested codes, null/missing codes, old message-only records and no-artifact output. Phase, reason and job count remain unchanged.
- The candidate and old script were run read-only against all 27 retained failure-artifact directories. Every candidate code matched the existing producer record. Every other output field and every artifact's bytes remained unchanged (`retained-artifact-regression.json`).
- The live `failure-summary.py` still equals `before/failure-summary.py` byte for byte. No active entry, producer, source configuration, request, schedule or runtime changed.

Apply only `change.patch` to the matching original helper after coordination. The copy under `fixtures/artifacts/` is the exact original private diagnostic, not new acquisition or publication evidence.

Not checked: live capture, connector calls, production publications or web acceptance. Not enabled or uploaded. No admission/validation rules, single-source isolation logic or deadline behavior were changed.
