# Task 1 Report: Crawl Batch Force Option

## Outcome

Implemented optional `force?: boolean` on `RunP0CrawlBatchDeps` so `runP0CrawlBatch` will process plans even when they are inside the current schedule window, while preserving the default schedule gate when `force` is absent or false.

## TDD Evidence

### RED

Added this test first in `tests/crawler/runCrawlBatch.test.ts`:

- `runs a source in the current schedule window when force is enabled`

Focused test run before implementation:

- Command: `npm test -- tests/crawler/runCrawlBatch.test.ts`
- Result: failed as expected
- Failure: `expected "spy" to be called 1 times, but got 0 times`

That failure matched the missing behavior: the source was skipped before `fetch` ran.

### GREEN

Implemented the minimal production change in `src/crawler/runCrawlBatch.ts`:

- added `force?: boolean` to `RunP0CrawlBatchDeps`
- changed the due check to bypass `isSourceDueForScheduledRun(...)` when `deps.force` is true

Verification after implementation:

- Command: `npm test -- tests/crawler/runCrawlBatch.test.ts`
- Result: passed
- Command: `npm run typecheck`
- Result: passed

## Files Changed

- `src/crawler/runCrawlBatch.ts`
- `tests/crawler/runCrawlBatch.test.ts`

## Self-Review

- Scope stayed within the two allowed files.
- Default behavior remains gated by schedule when `force` is not set.
- Forced runs still go through the existing real fetch path and downstream lifecycle/ingestion flow.
- No additional source expansion, APIs, or operational surface were introduced.

## Concerns

- None identified from the focused test and typecheck results.

