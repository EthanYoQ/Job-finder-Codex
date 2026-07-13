# Runtime atomic archive regression alignment

## Status

Aligned the stale runtime atomic evidence assertion with the source-local failure isolation contract. Production code was not changed, and no live database, crawl, migration, seed, registry sync, or deployment was run.

## Root cause and RED

`runP0CrawlBatch` now treats archive, archive verification, and atomic evidence commit errors as source-local when `terminatePendingSourceResult` succeeds. It terminalizes the source, finalizes a truthful `FAILED` batch, and returns that batch result. The older test still expected the source error to reject.

Fresh RED command:

`npx vitest run tests/crawler/runtimeAtomicEvidence.test.ts -t "builds a validated full atomic bundle from strict crawl, lifecycle and archive truth" --maxWorkers=1 --minWorkers=1`

Result before the test update: exit 1; the assertion expected rejection but received the single-source `FAILED` batch with `atomicFailedSourceCount: 1` and `failedSourceCount: 1`.

## Updated assertions

- Source-local archive/verification/atomic failures resolve to the exact `FAILED` batch result.
- The failed source is terminalized as transport/adapter succeeded, completeness failed, and atomic commit rolled back.
- Archive failure never invokes the atomic commit seam, job upsert, or crawl-observation creation.
- Batch persistence records exact transport, adapter, atomic, failed-source, completeness, aggregate-set, and terminal status counters.
- Existing orphan-artifact and sanitized orphan-ledger error assertions remain covered by an injected batch-finalization failure, which exposes the retained source diagnostics without changing production behavior.

## Verification

- Focused target after update: 1 passed, 4 skipped, exit 0.
- `tests/crawler/runtimeAtomicEvidence.test.ts` plus `tests/crawler/runCrawlBatch.test.ts`: 2 files, 39 tests passed, exit 0.
- Typecheck and staged diff check are recorded in the task handoff.

## Files

- `tests/crawler/runtimeAtomicEvidence.test.ts`
- `.superpowers/sdd/task-runtime-atomic-archive-test-alignment.md`
