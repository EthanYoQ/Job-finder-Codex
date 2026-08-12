# Staged scheduled crawl monitoring implementation report

## Status

Implemented read-only, database-backed staged monitoring authority and aligned the existing scheduler and monitor with the same staged summary and attempt paths. After independent review placed `a45a00d` on HOLD, added a shared fail-closed path boundary so scheduler, crawl CLI, and monitor can use only distinct canonical descendants of their `outputs` root. The historical manual worker retains its strict membership/oracle authority unchanged. No live database, crawl, migration, seed, registry sync, deployment, or ReleaseCandidate mutation was run.

## Root cause

The production scheduler had moved to the staged scheduled crawl, but the monitor still loaded the historical strict `FULL_RELEASE` membership/oracle files and caller-pinned identity, then read the old strict summary and attempt paths. Scheduler and monitor therefore could not observe or authenticate the same scheduled run.

Independent review found a second boundary defect: Compose interpolated caller-controlled staged paths, the existing resolver checked only strict/staged overlap rather than containment, and the monitor still honored legacy strict path variables. `/tmp` paths were therefore accepted even though scheduler and monitor share artifacts only at `/app/outputs`.

## RED evidence

`npx vitest run tests/crawler/stagedMonitoringIdentity.test.ts tests/ops/deploymentConfig.test.ts tests/readiness/composeReleaseAuthority.test.ts --maxWorkers=2 --minWorkers=2`

- Exit 1: 3 test files failed.
- The new loader suite could not resolve `src/crawler/stagedMonitoringIdentity.ts`.
- Five Compose/deployment assertions failed because scheduler/monitor still contained strict authority pins/mounts and lacked the shared staged paths.
- The remaining 28 pre-existing assertions passed, preserving the initial deployment/backup/hardening baseline.

### Independent-review repair RED

`npx vitest run tests/crawler/p0StagedCrawlCli.test.ts tests/ops/deploymentConfig.test.ts tests/readiness/composeReleaseAuthority.test.ts --maxWorkers=2 --minWorkers=2`

- Exit 1: 3 files, 8 failed / 39 passed.
- The resolver accepted absolute paths outside `outputs`; the CLI wrote a rogue attempt journal before reaching its database lock; the scheduler had no shared resolver.
- The monitor performed health/database work for an invalid path; Compose rendered caller overrides as `/tmp/rogue-*`; legacy path fallbacks remained.

## Implementation

- Added a one-argument read-only loader that calls `resolveCurrentStagedScheduleAuthority` exactly once and returns only `crawlEvidenceIdentityFromRuntime(authority.identity)`.
- Added a production wrapper that validates the PostgreSQL URL before client creation, creates one Prisma client for the authority read, and disconnects on success or failure. Resolver and disconnect failures remain fail-closed.
- Changed the monitor to use that database-backed identity while keeping authenticated PostgreSQL readiness as a separate check.
- Made scheduler and monitor use `/app/outputs/staged-crawl-summary.json` and `/app/outputs/staged-crawl-attempts` on their existing shared `formal-artifacts` volume.
- Removed historical strict membership/oracle mounts and release identity pins from scheduler/monitor only. The manual worker service is byte-identical to `HEAD`.
- Preserved existing health, backup integrity, summary/attempt binding, age/failure alerts, service hardening, dependencies, restart behavior, and topology.
- Added one shared lexical path resolver used by scheduler, staged CLI, and monitor. It rejects blank/non-canonical input, traversal, sibling-prefix escapes, strict aliases, root equality, same paths, and either-direction nesting before any journal, lock, database, health, or evidence operation.
- Fixed both Compose service paths to literal `/app/outputs` descendants so `.env` values cannot relocate production evidence, and removed the monitor's legacy `CRAWL_SUMMARY_PATH` / `CRAWL_ATTEMPT_DIR` fallbacks.
- Preserved the existing `(env, cwd)` injection seam and allows distinct safe nested descendants for isolated tests.

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

### Independent-review repair verification

- Repair GREEN: 3 files, 47/47 tests passed.
- Expanded path/authority/schedule/evidence/ops/deployment matrix: 10 files, 121/121 tests passed.
- Adversarial cases cover outside absolute paths, `outputs-evil`, `..` traversal, strict aliases, equal/nested paths, valid nested descendants, and ignored legacy path variables.
- CLI and monitor subprocess tests prove rejection before rogue journal creation or health/database work. A direct scheduler subprocess probe also rejected before waiting or creating evidence.
- Compose override render with caller `/tmp/rogue-*` values produced only the fixed `/app/outputs/staged-crawl-*` paths.
- `npm run build`: passed; 1,596 modules transformed.
- `npm run typecheck`: attempted but temporarily BLOCKED by unrelated concurrent UI/public-API test edits (`tests/app/App.test.tsx`, `tests/server/httpServer.test.ts`, and `tests/server/publicApi.test.ts`). No reported error referenced a staged-monitoring scoped file. The main agent explicitly authorized an isolated repair commit with this blocker recorded; this is not a release-gate pass.
- `git diff --check`, worker preservation, topology preservation, and scoped-file audit are required again immediately before commit.

## Files

- `src/crawler/stagedMonitoringIdentity.ts`
- `src/crawler/stagedCrawlEvidencePaths.ts`
- `src/crawler/stagedCrawlCli.ts`
- `scripts/p0-scheduler.ts`
- `ops/monitoring-check.ts`
- `ops/docker-compose.yml`
- `tests/crawler/stagedMonitoringIdentity.test.ts`
- `tests/ops/deploymentConfig.test.ts`
- `tests/readiness/composeReleaseAuthority.test.ts`
- `.superpowers/sdd/task-staged-monitoring-report.md`

## Concerns

- Production monitoring still requires exactly one current-build staged ReleaseCandidate and a reachable PostgreSQL database. Missing or ambiguous authority intentionally produces an invalid-authority alert.
- This task did not provision or live-run production services. Runtime deployment verification remains a later deployment action.
- Strict release gate remains HOLD until the unrelated global typecheck blocker clears and a fresh independent rereview passes. The repair commit is only a reviewable, reversible handoff.
- Pre-existing `.superpowers/sdd/progress.md`, `outputs/`, Sandoz, and UI/public-API worktree changes were preserved and must remain excluded from this task's commit.
