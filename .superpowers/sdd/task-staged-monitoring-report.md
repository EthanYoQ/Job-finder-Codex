# Staged scheduled crawl monitoring implementation report

## Status

Implemented read-only, database-backed staged monitoring authority and aligned the existing scheduler and monitor with the same staged summary and attempt paths. The historical manual worker retains its strict membership/oracle authority unchanged. No live database, crawl, migration, seed, registry sync, deployment, or ReleaseCandidate mutation was run.

## Root cause

The production scheduler had moved to the staged scheduled crawl, but the monitor still loaded the historical strict `FULL_RELEASE` membership/oracle files and caller-pinned identity, then read the old strict summary and attempt paths. Scheduler and monitor therefore could not observe or authenticate the same scheduled run.

## RED evidence

`npx vitest run tests/crawler/stagedMonitoringIdentity.test.ts tests/ops/deploymentConfig.test.ts tests/readiness/composeReleaseAuthority.test.ts --maxWorkers=2 --minWorkers=2`

- Exit 1: 3 test files failed.
- The new loader suite could not resolve `src/crawler/stagedMonitoringIdentity.ts`.
- Five Compose/deployment assertions failed because scheduler/monitor still contained strict authority pins/mounts and lacked the shared staged paths.
- The remaining 28 pre-existing assertions passed, preserving the initial deployment/backup/hardening baseline.

## Implementation

- Added a one-argument read-only loader that calls `resolveCurrentStagedScheduleAuthority` exactly once and returns only `crawlEvidenceIdentityFromRuntime(authority.identity)`.
- Added a production wrapper that validates the PostgreSQL URL before client creation, creates one Prisma client for the authority read, and disconnects on success or failure. Resolver and disconnect failures remain fail-closed.
- Changed the monitor to use that database-backed identity while keeping authenticated PostgreSQL readiness as a separate check.
- Made scheduler and monitor use `/app/outputs/staged-crawl-summary.json` and `/app/outputs/staged-crawl-attempts` on their existing shared `formal-artifacts` volume.
- Removed historical strict membership/oracle mounts and release identity pins from scheduler/monitor only. The manual worker service is byte-identical to `HEAD`.
- Preserved existing health, backup integrity, summary/attempt binding, age/failure alerts, service hardening, dependencies, restart behavior, and topology.

## GREEN and verification evidence

- Initial GREEN: staged loader + deployment + Compose, 3 files and 42/42 tests passed.
- Expanded matrix:
  `npx vitest run tests/crawler/stagedMonitoringIdentity.test.ts tests/crawler/stagedScheduleAuthority.test.ts tests/crawler/crawlSummary.test.ts tests/crawler/crawlAttemptEvidence.test.ts tests/crawler/crawlAttemptOrchestration.test.ts tests/crawler/p0StagedCrawlCli.test.ts tests/server/opsMonitoring.test.ts tests/ops/deploymentConfig.test.ts tests/readiness/composeReleaseAuthority.test.ts --maxWorkers=2 --minWorkers=2`
  - 9 files, 111/111 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; 1,596 modules transformed.
- `docker compose -f ops/docker-compose.yml config`: rendered successfully with non-secret placeholder inputs.
- `git diff --check`: passed.
- Static service-section comparison against `HEAD`: `WORKER_SECTION_UNCHANGED=PASS`.

## Files

- `src/crawler/stagedMonitoringIdentity.ts`
- `ops/monitoring-check.ts`
- `ops/docker-compose.yml`
- `tests/crawler/stagedMonitoringIdentity.test.ts`
- `tests/ops/deploymentConfig.test.ts`
- `tests/readiness/composeReleaseAuthority.test.ts`
- `.superpowers/sdd/task-staged-monitoring-report.md`

## Concerns

- Production monitoring still requires exactly one current-build staged ReleaseCandidate and a reachable PostgreSQL database. Missing or ambiguous authority intentionally produces an invalid-authority alert.
- This task did not provision or live-run production services. Runtime deployment verification remains a later deployment action.
- Pre-existing `.superpowers/sdd/progress.md` and `outputs/` worktree changes were preserved and must remain excluded from this task's commit.
