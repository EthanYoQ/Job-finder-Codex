# Independent review: staged crawl CLI and scheduler

## Verdict

**HOLD**

Commit reviewed: `302452a feat: schedule staged official crawls`

The main execution boundaries are implemented correctly and all independent regression checks passed. One Important path-isolation defect remains: staged path overrides can alias the historical strict evidence locations, so the new command does not uphold the design's “never overwrite strict formal evidence paths” guarantee under supported environment configuration.

## Findings

### Important — staged path overrides can write into strict evidence locations

`src/crawler/stagedCrawlCli.ts:180-181` accepts `STAGED_CRAWL_ATTEMPT_DIR` and `STAGED_CRAWL_SUMMARY_PATH` verbatim. It does not reject either path when it resolves to the strict CLI's active/default `CRAWL_ATTEMPT_DIR` or `CRAWL_SUMMARY_PATH` (`scripts/p0-crawl.ts:45-46`).

This is not limited to a theoretical low-level call. `runProductionStagedCrawlCli` passes these environment values directly to the real immutable-event and atomic-summary writers. A configuration such as:

```text
STAGED_CRAWL_ATTEMPT_DIR=<repo>/outputs/crawl-attempts
STAGED_CRAWL_SUMMARY_PATH=<repo>/outputs/crawl-summary.json
```

causes the staged command to append staged RUNNING/terminal events to the strict journal and atomically replace the strict summary. That can erase the effective strict summary and make the strict attempt reader select a staged identity as its newest evidence. The committed test only proves the separate defaults; it does not cover alias rejection.

Independent no-I/O dependency-injection probe result:

```json
{
  "writes": [
    { "kind": "attempt", "directory": "C:/repo/outputs/crawl-attempts", "state": "RUNNING" },
    { "kind": "summary", "path": "C:/repo/outputs/crawl-summary.json" },
    { "kind": "attempt", "directory": "C:/repo/outputs/crawl-attempts", "state": "SUCCESS" }
  ]
}
```

Required before PASS: fail closed before journal/lock/database work when staged outputs overlap the active or default strict summary/attempt locations, and add focused tests for direct and normalized path aliases. Keeping the staged paths fixed instead of configurable would also satisfy this boundary.

## Verified boundaries

- Zero-argument boundary: every tested argument exits 2 before the dynamic operational import; static inspection confirms Prisma/database/lock modules are loaded only after argument rejection.
- Internal authority: the production runtime invokes only `runCurrentStagedScheduledCrawl`; the wrapper fixes `SCHEDULED`, all plans, and `force:false`, exposes no authority input seam, and returns a copied/frozen identity.
- Locking and cleanup: staged and strict reuse the same PostgreSQL advisory lock and filesystem lock; cleanup uses the existing all-settled aggregate helper and attempts disconnect, file close/unlink, and advisory release even when one fails.
- Failure truth: completed mixed batches retain successful source counters/results, publish the truthful FAILED summary, emit one FAILED terminal event, and return 1. Authority/preflight/execution/source-health/summary/cleanup failures use the narrow existing failure codes.
- Scheduler behavior: `nextP0CrawlWindow` remains the source of the 08:00/20:00 China-time windows; one synchronous staged child is launched, the 60-second handoff remains, and there is no immediate retry.
- Historical strict path: parent/commit blob IDs are identical for `scripts/p0-crawl.ts` and `scripts/p0-formal-crawl-once.ts`; `ops/docker-compose.yml` is also blob-identical and scheduler topology is unchanged.
- Scope: all eight changed files are allowed by the task brief; no registry, schema/migration, release/publication/search/readiness logic, strict entry, Compose topology, output evidence, or control/progress file is part of the commit.

## Independent verification

- Scheduler/CLI/orchestration/Compose/deployment matrix: **72/72 passed**.
- Staged authority/source-plan/runtime matrix: **80/80 passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed; 1,596 modules transformed.
- `git diff --check 302452a^ 302452a`: passed.
- Parent-versus-commit strict/topology diff: empty; verified by matching blob IDs, not by comparing the worktree to its own `HEAD`.

## Non-blocking follow-up dependency

Deployment and monitoring still need an explicit consumer/configuration path for the new staged summary and attempt directory. That work is outside this commit's stated CLI scope and is not counted as a specification violation in this verdict.
