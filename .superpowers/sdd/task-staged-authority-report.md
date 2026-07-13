# Staged schedule authority implementation report

## Status

Implemented the fail-closed current-build authority and zero-input staged crawl wrapper. No live database, crawl, migration, seed, registry sync, deployment, or ReleaseCandidate mutation was run.

## Root cause

The existing `runP0CrawlCommand` is intentionally generic and accepts plans, companies, and runtime identity from its caller. There was no staged production boundary that derived those values from the current committed/baked build and matched them to one pre-existing immutable ReleaseCandidate before registry or crawl writes.

## RED evidence

Command:

`npx vitest run tests/crawler/stagedScheduleAuthority.test.ts tests/crawler/stagedScheduledCrawl.test.ts --maxWorkers=2 --minWorkers=2`

Initial result: exit 1; both suites failed because `src/crawler/stagedScheduleAuthority.ts` and `src/crawler/stagedScheduledCrawl.ts` did not exist. No production implementation had been written.

## Implementation

- Added current-build derivation of the exact canonical 60-company roster, canonical sorted STAGED plans, source-plan/config/adapter/runtime hashes, and planned-source contract.
- Added one read-only ReleaseCandidate lookup using all derived fields, the staged oracle marker, allowed statuses, and `take: 2`; exactly one row is required and every selected authority field is rechecked in memory.
- Added a deeply copied and frozen authority result with fixed `SCHEDULED` / `staged-scheduler` identity.
- Added a staged wrapper whose public dependency surface contains operational DB/fetch/time/runtime functions only and always invokes the existing command with no source filter and `force: false`.
- Left strict `FULL_RELEASE` code and semantics unchanged.

## GREEN and verification evidence

- New focused suites: 2 files, 28 tests passed, exit 0.
- Required six-file regression command: 5 files passed; 78 tests passed and 1 pre-existing assertion failed. `tests/crawler/runtimeAtomicEvidence.test.ts:328` expects an archive failure to reject, while current HEAD `c04218f` source-local failure isolation returns a truthful `FAILED` batch. The failing test imports neither new staged module, and this task did not modify its execution path.
- `npm run typecheck`: exit 0.
- `git diff --check`: exit 0 before staging.

## Files

- `src/crawler/stagedScheduleAuthority.ts`
- `src/crawler/stagedScheduledCrawl.ts`
- `tests/crawler/stagedScheduleAuthority.test.ts`
- `tests/crawler/stagedScheduledCrawl.test.ts`
- `.superpowers/sdd/task-staged-authority-report.md`

## Concern

The prior source-failure-isolation commit left one regression assertion inconsistent with the new batch behavior. It is outside this task's allowed files and should be reconciled by that task owner; this implementation must not claim the full specified matrix is green until that baseline assertion is resolved.

## Independent review fix: immutable build-bound registry authority

The independent review correctly found that the staged derivation compared the mutable exported `candidateCompanies` singleton with itself. A process-local mutation could therefore reach registry synchronization without changing the derived RC hashes.

The fix recursively freezes the actual exported `candidateCompanies` and `expectedOfficialSurfaces` graphs immediately after their canonical seed build. This covers company fields, nested sources, surface scope objects and arrays, channel objects, and official-chain arrays. Values returned by `buildCandidateCompanyRegistry` remain mutable for isolated callers and tests. The existing build source-tree hash binds the code-derived canonical values; no self-comparison snapshot or hardcoded pass count was added.

Review-fix RED evidence:

- Exported arrays reported unfrozen.
- Company operational-field mutation did not throw.
- A mutated official website URL passed authority derivation and reached the registry-sync seam.

Review-fix GREEN evidence:

- Registry + staged authority/wrapper focus: 3 files, 40 tests passed.
- Company registry + source-plan/channel tests: 3 files, 35 tests passed.
- Original six-file 79-test regression command now contains the new mutation case and passed 80/80 tests.
- The stale runtime atomic assertion was separately reconciled in commit `93e4be0`, so the previously disclosed regression concern is closed.
- No live database, crawl, migration, seed, registry sync, deployment, or RC mutation was run.
