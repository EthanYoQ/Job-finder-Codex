STATUS: DONE
FILES_CHANGED:
- src/crawler/lifecycle.ts
- tests/crawler/lifecycle.test.ts
- .superpowers/sdd/data-acquisition-task-4-report.md
TESTS_RUN:
- npm test -- tests/crawler/lifecycle.test.ts (RED: failed because src/crawler/lifecycle.ts did not exist)
- npm test -- tests/crawler/lifecycle.test.ts (PASS: 7 tests)
- npm run typecheck (PASS)
COMMITS:
- feat: add crawl lifecycle reducer
CONCERNS:
- None

## FIX: Reviewer Findings

STATUS: FIXED_WITH_CONCERNS
FILES_CHANGED:
- src/crawler/lifecycle.ts
- tests/crawler/lifecycle.test.ts
- .superpowers/sdd/data-acquisition-task-4-report.md
RED_CHECK:
- npm test -- tests/crawler/lifecycle.test.ts (RED: first-ever non-baseline crawl before baseline completion stored isNew=true instead of false)
TESTS_RUN:
- npm test -- tests/crawler/lifecycle.test.ts (PASS: 1 file, 8 tests)
- npm run typecheck (PASS)
- git diff --check -- src/crawler/lifecycle.ts tests/crawler/lifecycle.test.ts (PASS)
COMMIT_ID:
- 91778d40a50f14770c70246b957cffe17af2fc19
FIXES:
- Added baselineCompletedBeforeCrawl to ApplyCrawlObservationOptions.
- Gated isNew on missing previous job, successful crawl, completed baseline, and non-baseline record.
- Added regression coverage for first-ever non-baseline crawls before baseline completion.
CONCERNS:
- CodeGraph MCP is not initialized for this workspace, so this fix used direct file reads after the tool reported that state.
- The report was appended after creating the fix commit so it can record the actual commit id without invalidating that id.
