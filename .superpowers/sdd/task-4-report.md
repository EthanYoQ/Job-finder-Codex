# Task 4 Report: Privacy Consent And SEO Route Policy

## Implemented

Added a small route policy module at `src/domain/route-policy.ts` with the three requested policy functions:

- `canAccessWithoutConsent(pathname): boolean`
- `isIndexableRoute(pathname): boolean`
- `shouldLoadOperationalAnalytics(pathname, hasConsent): boolean`

Also added focused contract tests at `tests/domain/route-policy.test.ts`.

## TDD Evidence

### RED

Ran the focused test command before implementation:

```bash
npm test -- tests/domain/route-policy.test.ts
```

Observed failure because `src/domain/route-policy.ts` did not exist:

- Vitest reported `Cannot find module '../../src/domain/route-policy'`
- The suite failed to load, as expected for the missing implementation step

### GREEN

After implementing the module, reran:

```bash
npm test -- tests/domain/route-policy.test.ts
npm run typecheck
```

Results:

- Route policy test file passed: 5 tests, 5 passed
- TypeScript typecheck passed with no errors

## Tests Run

- `npm test -- tests/domain/route-policy.test.ts`
- `npm run typecheck`

## Files Changed

- `src/domain/route-policy.ts`
- `tests/domain/route-policy.test.ts`

## Self-Review

- The implementation matches the brief exactly and stays isolated to policy logic only.
- No frontend UI or router code was changed.
- Path normalization handles query strings and trailing slashes, which keeps the policy stable for the requested inputs.

## Concerns

- No unresolved implementation concerns for Task 4.
- The policy is intentionally narrow and only covers the routes named in the brief; later router/middleware integration should still be verified against real request objects.

# Task 4 Report: Wave 1 Live Evidence Verification

## Commands Run

1. `npm test`
   - Exit code: `1`
   - Important output:
     - `Test Files 5 failed | 29 passed`
     - `Tests 7 failed | 150 passed`
     - Failing files:
       - `tests/crawler/runCrawlBatch.test.ts`
       - `tests/crawler/runSourceCrawl.test.ts`
       - `tests/readiness/p0Readiness.test.ts`
       - `tests/readiness/prismaReadiness.test.ts`
       - `tests/prisma/schema.test.ts`
     - Notable failures:
       - `runSourceCrawl` expectations observed `FAILED` instead of `SUCCESS`
       - readiness tests still expect declared/configured verified sources `5`, but runtime now reports `6`
       - Prisma schema test timed out at `5000ms`

2. `npm run typecheck`
   - Exit code: `0`
   - Important output: `tsc --noEmit` passed

3. `npm run build`
   - Exit code: `0`
   - Important output: Vite production build passed

4. `npm run prisma:validate`
   - Exit code: `0`
   - Important output: `The schema at prisma\\schema.prisma is valid`

5. `git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'`
   - Exit code: `1`
   - Important output: no output; treated as clean per brief

6. `$env:DATABASE_URL='postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public'; npm run p0:crawl -- --force --source-id source-beigene-social --source-id source-hengrui-social --source-id source-astrazeneca-social --source-id source-novartis-social --source-id source-fosun-pharma-social --source-id source-kelun-social`
   - Exit code: `0`
   - Important output:
     - `Planned sources: 6`
     - `Due sources: 6`
     - `Successful sources: 6`
     - `Failed sources: 0`
     - `Skipped sources: 0`
   - No Tavily credentials were requested in output

7. `$env:DATABASE_URL='postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public'; npm run p0:crawl -- --force --source-id source-beigene-social --source-id source-hengrui-social --source-id source-astrazeneca-social --source-id source-novartis-social --source-id source-fosun-pharma-social --source-id source-kelun-social`
   - Exit code: `0`
   - Important output:
     - `Planned sources: 6`
     - `Due sources: 6`
     - `Successful sources: 6`
     - `Failed sources: 0`
     - `Skipped sources: 0`
   - No Tavily credentials were requested in output

8. `$env:DATABASE_URL='postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public'; npm run p0:readiness -- --db`
   - Exit code: `1`
   - Important output:
     - `Candidate companies: 110`
     - `Declared verified social sources: 6`
     - `Configured verified social sources: 6`
     - `Crawl-evidenced verified companies: 6/50`
     - blocker: `VERIFIED_COMPANIES_BELOW_50`

## Readiness Result

- Live database readiness matched the required gate outcome for this wave:
  - exit `1`
  - `Candidate companies: 110`
  - `Crawl-evidenced verified companies: 6/50`
  - blocker `VERIFIED_COMPANIES_BELOW_50`

## Files Changed

- `C:\Vibe Coding Project\Job Finder\.superpowers\sdd\task-4-report.md`

## Commit

- No commit created

## Concerns

- Verified fact: the full verification set did not match the brief because `npm test` failed.
- Verified fact: both forced crawl runs succeeded for all 6 wave-1 sources and did not require Tavily credentials.
- Verified fact: readiness output is still blocked at `6/50`, which is expected for this wave.
- Unconfirmed cause: the failing test expectations may be stale relative to the current branch state, because readiness-related tests still assert `5` verified sources while runtime reports `6`.
- Unconfirmed cause: the `runSourceCrawl` and `runCrawlBatch` failures may come from upstream changes in shared crawl behavior rather than this task's verification-only scope.
- Unconfirmed cause: the Prisma schema timeout may be environmental or due to current test timeout budget; this report does not establish root cause.
- Per brief, plan checkboxes were not marked and the completion commit was not created.

# Task 4 verification test fix

## Files Changed

- `tests/crawler/runSourceCrawl.test.ts`
- `tests/crawler/runCrawlBatch.test.ts`
- `tests/readiness/p0Readiness.test.ts`
- `tests/readiness/prismaReadiness.test.ts`
- `src/crawler/fixtures/astrazeneca-search-results.html`
- `src/crawler/fixtures/novartis-table.html`
- `.superpowers/sdd/task-4-report.md`

## Red Evidence

- Reproduced with:
  - `npm test -- tests/readiness/p0Readiness.test.ts tests/readiness/prismaReadiness.test.ts tests/crawler/runSourceCrawl.test.ts tests/crawler/runCrawlBatch.test.ts`
- Observed failures:
  - readiness tests expected `declaredVerifiedSocialSources` and `configuredVerifiedSocialSources` to be `5`, while runtime reported `6`
  - `runSourceCrawl` for `source-astrazeneca-social` failed because the test still provided JSON payload input although the current source plan uses `html-table`
  - `runSourceCrawl` for `source-novartis-social` failed because the fixture still used the old `data-testid` / `data-field` markup instead of the current Drupal table selectors
  - `runCrawlBatch` failed as a downstream effect because the Novartis crawl returned a failed observation instead of a normalized job result

## Commands And Results

- `npm test -- tests/readiness/p0Readiness.test.ts tests/readiness/prismaReadiness.test.ts tests/crawler/runSourceCrawl.test.ts tests/crawler/runCrawlBatch.test.ts`
  - Result: passed
  - Summary: `4` files passed, `13` tests passed
- `npm test -- tests/prisma/schema.test.ts`
  - Result: passed
  - Summary: `1` file passed, `6` tests passed
- `npm run typecheck`
  - Result: passed

## Commit Hash

- `8c954b0`

## Remaining Concerns

- Confirmed fact: these fixes only align tests and fixtures to the current wave-1 source plan and do not change production behavior.
- Confirmed fact: `tests/prisma/schema.test.ts` passed when rerun alone in `2505ms`, so no schema-timeout change was needed.
- Unconfirmed concern: adapter tests in other files may still reference the older Novartis fixture shape; they were outside the owned write scope for this task.

# Task 4 adapter fixture follow-up

## Files Changed

- `tests/crawler/adapters.test.ts`
- `.superpowers/sdd/task-4-report.md`

## Red Evidence

- After commit `8c954b0`, `npm test` still failed in `tests/crawler/adapters.test.ts`.
- Verified failure:
  - `crawler source adapters > normalizes title, city, category, and official URL from an HTML table fixture`
  - the test still used the old Novartis fixture selectors while `src/crawler/fixtures/novartis-table.html` had been updated to the current Drupal table shape.

## Commands And Results

- `npm test -- tests/crawler/adapters.test.ts`
  - First result: failed with stale selector/expectation mismatch.
  - After updating only the test selectors and expectations: passed, `1` file, `6` tests.
- `npm test`
  - Result: passed, `34` files, `157` tests.

## Remaining Concerns

- Confirmed fact: this follow-up changed test expectations only; production source code was not changed.
