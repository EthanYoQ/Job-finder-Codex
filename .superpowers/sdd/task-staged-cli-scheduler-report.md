# Staged crawl CLI and scheduler implementation report

## Status

Implemented the zero-argument staged production crawl entry and changed the existing 08:00/20:00 scheduler child from the historical strict command to the staged command. No live database, crawl, migration, seed, registry sync, deployment, or ReleaseCandidate mutation was run.

## Root cause

The scheduler still spawned `p0:formal-crawl-once`, which delegates to the strict `FULL_RELEASE` CLI and strict operational evidence paths. The already-reviewed current-build staged authority wrapper therefore had no production CLI, shared-lock orchestration, separate journal/summary path, or scheduled child.

## RED evidence

1. `npx vitest run tests/crawler/p0StagedCrawlCli.test.ts --maxWorkers=2 --minWorkers=2`
   - Exit 1.
   - The suite failed to resolve `src/crawler/stagedCrawlCli.ts`; no staged operational implementation or script existed.
2. `npx vitest run tests/crawler/stagedScheduledCrawl.test.ts --maxWorkers=2 --minWorkers=2`
   - Exit 1 with 5 passed / 1 failed.
   - The new assertion received `undefined` for the wrapper's internally derived identity, proving the existing return value could not bind a post-run summary.

## Implementation

- Added `p0:staged-crawl`, which rejects every argument with exit 2 before importing the operational module.
- Added a dependency-injected staged operational runner that writes RUNNING/terminal attempt events, reuses the existing PostgreSQL advisory lock, filesystem lock, browser preflight, atomic summary helper, and aggregate cleanup helper.
- Runtime modules, Prisma, official fetchers, and the fetch router are loaded only after argument validation, locks, and browser preflight. The only crawl entry invoked is `runCurrentStagedScheduledCrawl`.
- Returned a copied and frozen internally resolved staged identity alongside the existing command result; no authority input seam was added.
- Used separate defaults `outputs/staged-crawl-summary.json` and `outputs/staged-crawl-attempts`, with the scheduler pinning the resolved attempt directory into the child environment.
- Preserved mixed-batch counters and successful source results, writes the truthful terminal summary, returns exit 1, and waits for the next scheduled window without immediate retry.
- Changed only scheduler wording, child command, and attempt directory; `nextP0CrawlWindow`, 08:00/20:00 China time, one synchronous child, and the 60-second handoff remain unchanged.
- Kept `scripts/p0-crawl.ts`, `scripts/p0-formal-crawl-once.ts`, and Compose service topology unchanged.

## GREEN and verification evidence

- Focused staged CLI + wrapper: 2 files, 16/16 tests passed.
- Scheduler/orchestration/strict CLI/Compose/deployment matrix:
  `npx vitest run tests/crawler/p0StagedCrawlCli.test.ts tests/crawler/stagedScheduledCrawl.test.ts tests/crawler/schedule.test.ts tests/crawler/crawlAttemptOrchestration.test.ts tests/crawler/p0CrawlCli.test.ts tests/readiness/composeReleaseAuthority.test.ts tests/ops/deploymentConfig.test.ts --maxWorkers=2 --minWorkers=2`
  - 7 files, 72/72 tests passed.
- Staged authority matrix:
  `npx vitest run tests/crawler/stagedScheduleAuthority.test.ts tests/crawler/stagedScheduledCrawl.test.ts tests/crawler/sourcePlan.test.ts tests/crawler/sourcePlanChannels.test.ts tests/crawler/p0CrawlCommand.test.ts tests/crawler/runtimeAtomicEvidence.test.ts --maxWorkers=2 --minWorkers=2`
  - 6 files, 80/80 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; 1,596 modules transformed.
- `git diff --check`: passed.
- Static Git-blob assertions prove both historical strict scripts are byte-identical to `HEAD`.

## Files

- `src/crawler/stagedScheduledCrawl.ts`
- `src/crawler/stagedCrawlCli.ts`
- `scripts/p0-staged-crawl.ts`
- `scripts/p0-scheduler.ts`
- `package.json`
- `tests/crawler/stagedScheduledCrawl.test.ts`
- `tests/crawler/p0StagedCrawlCli.test.ts`
- `.superpowers/sdd/task-staged-cli-scheduler-report.md`

## Concerns

- Production execution still requires the exact pre-authorized staged ReleaseCandidate and the existing Linux browser/lock runtime. Their absence fails closed; this task intentionally did not provision or live-run them.
- Pre-existing `.superpowers/sdd/progress.md` and `outputs/` worktree changes were preserved and excluded from this task's commit.
