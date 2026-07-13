# Staged CLI evidence-path isolation fix

## Status

Closed the sole Important finding from the independent review of `302452a`. No database, crawl, migration, registry sync, deployment, or output evidence was run or changed.

## Root cause

The staged CLI used separate defaults but accepted `STAGED_CRAWL_ATTEMPT_DIR` and `STAGED_CRAWL_SUMMARY_PATH` without comparing them with the strict CLI's active/default paths. A deployment override could therefore append staged attempt events to the strict journal or replace the strict summary.

## RED

`npx vitest run tests/crawler/p0StagedCrawlCli.test.ts --maxWorkers=2 --minWorkers=2`

- 1 failed / 10 passed.
- The new path-isolation test failed because `resolveStagedCrawlEvidencePaths` did not exist.

## Fix

- Resolve staged and strict configured/default paths before any lock, runtime, database, journal, or summary work.
- Reject blank path overrides.
- Reject direct, normalized, nested, cross-file/directory, and case-insensitive Windows overlap between staged and strict evidence paths.
- Also reject overlap between the staged summary and staged attempt journal themselves.
- Keep the existing separate defaults unchanged.

## GREEN

- Focused staged CLI: 1 file, 11/11 passed.
- Scheduler/CLI/orchestration/Compose/deployment matrix: 7 files, 73/73 passed.
- `git diff --check` for the two implementation/test files passed.
- Whole-project typecheck was attempted while an independent parallel publication-evaluator task had uncommitted RED tests; it was temporarily blocked only by that task's three test typing errors. The staged CLI source and tests compiled and executed in the focused matrices. A clean whole-project typecheck remains required after the parallel task finishes and before independent rereview PASS.

## Files

- `src/crawler/stagedCrawlCli.ts`
- `tests/crawler/p0StagedCrawlCli.test.ts`
- `.superpowers/sdd/task-staged-cli-path-isolation-fix.md`
