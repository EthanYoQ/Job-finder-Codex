# Task 4 Report

## Status

- DONE

## Files Changed

- `src/server/jobSearchService.ts`
- `tests/server/jobSearchService.test.ts`

## Commands Run

1. `npm test -- tests/server/jobSearchService.test.ts`
   - FAIL
   - Reason: `src/server/jobSearchService.ts` did not exist yet, so the test suite failed to resolve the import.
2. `npm test -- tests/server/jobSearchService.test.ts`
   - PASS
3. `npm test -- tests/server/jobSearchService.test.ts tests/domain/search.test.ts`
   - PASS
4. `npm run typecheck`
   - FAIL
   - Reason: the local generated Prisma client did not export the model/where types assumed by the first implementation.
5. `npm test -- tests/server/jobSearchService.test.ts tests/domain/search.test.ts`
   - PASS
6. `npm run typecheck`
   - PASS
7. `git add src/server/jobSearchService.ts tests/server/jobSearchService.test.ts`
   - PASS
8. `git commit -m "feat: add internal database job search service"`
   - PASS

## Commit ID

- `62a7a42`

## Concerns

- None.

---

## Task 4 Review Fix

### Status

- DONE

### Files Changed

- `src/server/jobSearchService.ts`
- `tests/server/jobSearchService.test.ts`

### Commands Run

1. `npm test -- tests/server/jobSearchService.test.ts`
   - FAIL
   - Reason: `LATEST_POSTED` ordering was unstable when `officialPublishedAt` was `null`; a null-dated company sorted ahead of dated results.
2. `npm test -- tests/server/jobSearchService.test.ts`
   - FAIL
   - Reason: null-null job date comparison still produced `NaN`, so title fallback ordering did not apply.
3. `npm test -- tests/server/jobSearchService.test.ts`
   - PASS
4. `npm test -- tests/server/jobSearchService.test.ts tests/domain/search.test.ts`
   - PASS
5. `npm run typecheck`
   - PASS

### Summary

- Added a regression test covering `LATEST_POSTED` with `officialPublishedAt: null`, asserting null dates sort last and deterministic pinyin/title fallback is preserved.
- Extended coverage for `MATCHING_JOB_COUNT_DESC` to assert returned company order.
- Fixed the service to preserve `null` publish dates instead of serializing them to `""`, and to use deterministic comparators for company/job ordering.
