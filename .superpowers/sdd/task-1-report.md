# Task 1 Report

## Scope

- Implemented only Task 1 server modules:
  - `src/server/rateLimit.ts`
  - `src/server/staticDocuments.ts`
  - `src/server/coverageService.ts`
  - `src/server/feedbackService.ts`
  - `src/server/publicApi.ts`
- Added focused tests:
  - `tests/server/rateLimit.test.ts`
  - `tests/server/staticDocuments.test.ts`
  - `tests/server/coverageService.test.ts`
  - `tests/server/feedbackService.test.ts`
  - `tests/server/publicApi.test.ts`
- Wrote this report to `C:\Vibe Coding Project\Job Finder\.superpowers\sdd\task-1-report.md` as requested.

## TDD Evidence

### Red

- Added `tests/server/rateLimit.test.ts` before production code.
- Ran:

```bash
npm test -- tests/server/rateLimit.test.ts
```

- Observed expected failure:
  - import resolution failed because `src/server/rateLimit.ts` did not exist yet.

### Green

- Implemented the five missing server modules with the minimum behavior required by the brief and tests.
- Ran focused Task 1 tests:

```bash
npm test -- tests/server/rateLimit.test.ts tests/server/staticDocuments.test.ts tests/server/coverageService.test.ts tests/server/feedbackService.test.ts tests/server/publicApi.test.ts
```

- Result:
  - 5 test files passed
  - 6 tests passed

### Verification

- Ran:

```bash
npm run typecheck
```

- Result:
  - `tsc --noEmit` passed

## Implemented Facts

1. `rateLimit.ts`
   - Added in-memory hit store.
   - Added fixed-window burst limiting helper.
   - Added suspicious request classification for bulk pagination and automation-looking user agents.
   - Exempted `/privacy` and `/terms` from challenge classification.

2. `staticDocuments.ts`
   - Added `privacy` and `terms` static documents.
   - Included consent-safe and anti-crawl language required by tests.

3. `coverageService.ts`
   - Added company coverage listing that returns only:
     - `id`
     - `companyName`
     - `officialWebsiteUrl`
   - Filters out empty website rows.
   - Sorts by `pinyinName`.

4. `feedbackService.ts`
   - Added anonymous feedback creation.
   - Added recommended company submission creation.
   - Stores abuse signals in persistence payload:
     - `ip`
     - `userAgent`
   - Returns receipts with `OPEN` status.

5. `publicApi.ts`
   - Added handler for:
     - `/privacy`
     - `/terms`
     - `/robots.txt`
     - `/healthz`
     - `/api/search`
     - `/api/coverage`
     - `/api/feedback`
     - `/api/recommend-company`
   - Requires `x-job-search-consent: accepted` for `/api/*` write/search routes in scope.
   - Applies `x-robots-tag: noindex, nofollow` to `/api/*` and `/admin/*`.
   - Applies suspicious-request challenge logic and rate limiting on consented `/api/*` requests.
   - Validates `/api/search` through `SearchRequestSchema.safeParse(...)` and returns `400` on invalid input.
   - Delegates successful search requests to `searchJobsFromDatabase(...)`.

## Candidate Concerns

### Concern 1: search `limit` cap wording is not fully grounded in current schema

- Known fact:
  - The brief says `handlePublicApi` must "cap search limit to the schema limit".
  - Current `SearchRequestSchema` in `src/domain/search.ts` has no `limit` field.
- Unconfirmed conclusion:
  - There is not enough evidence inside Task 1 scope to determine an intended search-page-size contract for `/api/search`.
- What was implemented:
  - Search validation uses the existing schema as-is.
  - Suspicious bulk pagination is challenged through `limit`/`offset` heuristics in `classifySuspiciousRequest(...)`.
  - Unknown `limit` is otherwise ignored by schema-based search parsing.
- Verification path:
  - Confirm whether `/api/search` is supposed to accept pagination parameters at all.
  - If yes, define the contract in `SearchRequestSchema` or another approved domain schema and then add route-level tests for cap behavior.
- Temporary stopgap:
  - Bulk-looking `limit > 50` or `offset > 500` currently receives a `429` challenge decision instead of a normal search response.

## Files Changed

- `C:\Vibe Coding Project\Job Finder\src\server\rateLimit.ts`
- `C:\Vibe Coding Project\Job Finder\src\server\staticDocuments.ts`
- `C:\Vibe Coding Project\Job Finder\src\server\coverageService.ts`
- `C:\Vibe Coding Project\Job Finder\src\server\feedbackService.ts`
- `C:\Vibe Coding Project\Job Finder\src\server\publicApi.ts`
- `C:\Vibe Coding Project\Job Finder\tests\server\rateLimit.test.ts`
- `C:\Vibe Coding Project\Job Finder\tests\server\staticDocuments.test.ts`
- `C:\Vibe Coding Project\Job Finder\tests\server\coverageService.test.ts`
- `C:\Vibe Coding Project\Job Finder\tests\server\feedbackService.test.ts`
- `C:\Vibe Coding Project\Job Finder\tests\server\publicApi.test.ts`
- `C:\Vibe Coding Project\Job Finder\.superpowers\sdd\task-1-report.md`
