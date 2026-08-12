# Source-local crawl failure isolation report

## Status

PASS. A successfully terminalized source-local failure no longer prevents later due sources from running. Mixed batches remain `FAILED`; only successfully committed source job keys enter the aggregate hash.

## RED evidence

- Command: `npx vitest run tests/crawler/runCrawlBatch.test.ts -t "isolates a thrown fetch failure" --maxWorkers=2 --minWorkers=2`
- Result before the production change: FAIL. The batch rejected with `first source network timeout`, so the later source was not reached.

## GREEN evidence

- `npx vitest run tests/crawler/runCrawlBatch.test.ts tests/crawler/crawlSummary.test.ts tests/crawler/lifecycle.test.ts --maxWorkers=2 --minWorkers=2`: PASS, 3 files and 81 tests.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS.

## Files

- `src/crawler/runCrawlBatch.ts`
- `tests/crawler/runCrawlBatch.test.ts`
- `.superpowers/sdd/task-source-failure-isolation-report.md`

## Commit

- This commit: `fix: isolate source crawl failures`

## Concerns

- No live crawl, database, scheduler, search, readiness, eligibility, or lifecycle mutation was run.
- Source-local diagnostics are retained for an aggregate error if normal batch finalization also fails; successfully finalized mixed batches return the existing counter-only result contract.

## Review v2 reconciliation

### Technical reconciliation

- Review Finding 1 was not applied. `getRecentObservations`, `isBaselineCompleted`, and `getPreviousJobs` remain outside the source-local catches, so state-read failures still abort. No Prisma message or error-code classifier was added.
- `executeAtomicCommit` retains the designed health boundary: its failure is source-local only when the pending source can be terminalized. A database-wide outage that also prevents terminalization aborts the batch before any later source fetch.
- Review Finding 2 was applied. The originating fetch/adapter or post-crawl/atomic error is recorded before terminalization. If terminalization fails, the rejection aggregates the originating and terminalization errors; a subsequent batch-finalization failure is appended to the same diagnostic list.

### RED evidence

- Command: `npx vitest run tests/crawler/runCrawlBatch.test.ts -t "retains the source and terminalization errors" --maxWorkers=2 --minWorkers=2`
- Result before the reconciliation change: FAIL. The rejection was only `terminal source write failed`, not an `AggregateError` containing both source and terminalization errors.

### GREEN evidence

- `npx vitest run tests/crawler/runCrawlBatch.test.ts tests/crawler/crawlSummary.test.ts tests/crawler/lifecycle.test.ts --maxWorkers=2 --minWorkers=2`: PASS, 3 files and 83 tests.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS.

### Reconciliation commit

- This commit: `fix: preserve crawl failure diagnostics`
