Status: DONE

Files changed:
- `src/crawler/runCrawlBatch.ts`
- `tests/crawler/runCrawlBatch.test.ts`

Commands run:
- `npm test -- tests/crawler/runCrawlBatch.test.ts` - PASS (expected failure before implementation: missing `src/crawler/runCrawlBatch.ts`)
- `npm test -- tests/crawler/runCrawlBatch.test.ts` - FAIL (test expectation used wrong Novartis fixture dedupe key)
- `npm test -- tests/crawler/runCrawlBatch.test.ts` - PASS
- `npm test -- tests/crawler/runCrawlBatch.test.ts tests/crawler/runSourceCrawl.test.ts tests/db/ingestionRepository.test.ts` - PASS
- `npm run typecheck` - FAIL (test fixture used invalid category enum value `"医学"`)
- `npm test -- tests/crawler/runCrawlBatch.test.ts tests/crawler/runSourceCrawl.test.ts tests/db/ingestionRepository.test.ts` - PASS
- `npm run typecheck` - PASS

Commit id: 5500a4d

Concerns:
- CodeGraph is not initialized in this repository, so structural inspection fell back to direct file reads.
- The report file is requested by the task, but the requested commit scope only stages `src/crawler/runCrawlBatch.ts` and `tests/crawler/runCrawlBatch.test.ts`.

---

Fix follow-up: Task 3 review finding

Scope:
- `src/crawler/runCrawlBatch.ts`
- `tests/crawler/runCrawlBatch.test.ts`

Behavior decision:
- When a due source throws during fetch/adapter/ingestion execution, `runP0CrawlBatch` now finalizes the batch with `status: "FAILED"` and `finishedAt`, then rethrows the original error so failure visibility is preserved.

Commands run:
- `npm test -- tests/crawler/runCrawlBatch.test.ts` - FAIL (`crawlBatch.update` was not called when injected fetch threw)
- `npm test -- tests/crawler/runCrawlBatch.test.ts` - PASS
- `npm test -- tests/crawler/runCrawlBatch.test.ts tests/crawler/runSourceCrawl.test.ts tests/db/ingestionRepository.test.ts` - PASS
- `npm run typecheck` - PASS

Results:
- Added a regression test for a due source whose injected fetch throws.
- Updated batch execution to always finalize the batch record after processing, including thrown-error paths.
- Preserved thrown-error visibility after finalization.
