# 02 — Require mainland evidence for Pfizer China jobs

**What to build:** Make the Pfizer China source fail closed unless archived official detail evidence contains at least one explicit mainland China location. Preserve valid foreign-primary listings only when an explicit mainland additional location establishes China scope.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] India plus APAC-only detail fails source completeness and emits no normalized jobs
- [x] India plus an explicit Shanghai location continues to pass with or without a country suffix
- [x] A mainland-city descriptor with an explicit foreign-country conflict fails closed
- [x] Broad or altered APAC descriptors remain rejected
- [x] Source-crawl public-seam regression tests turn from red to green
- [x] Unrelated Workday source behavior remains unchanged

## Answer

- Pfizer's source-bound Workday replay now requires an explicit mainland-China descriptor in archived detail evidence. `APAC - Any Pfizer Site` may remain supporting text alongside mainland evidence, but cannot qualify a job by itself. A failed replay is fail-closed as `status: FAILED`, `truth.completenessVerified: false`, and `jobs: []`.
- India as the primary location with `Shanghai` or `Shanghai, China` as an additional location remains accepted and normalizes to `上海`; `Shanghai, India`, `Shanghai, United States of America`, broad APAC, and altered APAC descriptors fail closed.
- The Pfizer fetch validator and source-bound replay now share the same audited, foreign-conflict-aware parser. The expanded bare-city recognition is Pfizer-specific; JNJ/Gilead retain their original country/hashed-alias boundary, with a regression proving unaudited bare `Shanghai` remains fail-closed for JNJ.
- Passed: `npm test -- tests/crawler/pfizerStrictCompletenessReplay.test.ts` (6/6).
- Passed: `npm test -- tests/crawler/pfizerStrictCompletenessReplay.test.ts tests/crawler/workdaySourceFetch.test.ts tests/crawler/bmsStrictCompletenessReplay.test.ts tests/crawler/strictPurposeBoundCompleteness.test.ts` (4 files, 184 tests).
- Passed: `git diff --check`.
- During the isolated ticket slice, `npm run typecheck` was temporarily blocked by concurrent City-scoped Search imports of the removed `ALL_LOCATIONS` symbol. Ticket 01 completed those imports, and the integrated candidate subsequently passed `npm run typecheck`.
