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
