# Task 3 Report: CLI Database Mode

## What changed

- Added a new CLI help path to `scripts/p0-readiness-report.ts`.
- Added `--db` CLI routing that calls `getP0ReadinessReportFromDb(db)` through a `PrismaClient` instance.
- Kept the default `npm run p0:readiness` path on the existing static report so it still works without `DATABASE_URL`.
- Added a CLI behavior test in `tests/readiness/p0ReadinessReportCli.test.ts` for `--help` output and secret redaction.

## TDD evidence

### RED

Focused test before implementation failed as expected because `--help` was not implemented.

```text
npm test -- tests/readiness/p0ReadinessReportCli.test.ts

× P0 readiness CLI > prints usage for the database readiness mode without exposing secrets
  → Command failed: cmd.exe /d /s /c npx tsx scripts/p0-readiness-report.ts --help
```

### GREEN

After implementing the CLI split, the focused test passed.

```text
npm test -- tests/readiness/p0ReadinessReportCli.test.ts

✓ tests/readiness/p0ReadinessReportCli.test.ts (2 tests)
  ✓ P0 readiness CLI > prints the current readiness blockers without secrets
  ✓ P0 readiness CLI > prints usage for the database readiness mode without exposing secrets
```

## Tests run

```text
npm test -- tests/readiness/p0ReadinessReportCli.test.ts
```

Result: pass.

```text
npm run p0:readiness
```

Result: exit code 1, static mode output preserved.

```text
npm run p0:readiness -- --help
```

Result: exit code 0, usage text printed.

### Command output notes

`npm run p0:readiness` output:

```text
# P0 Readiness Report

Can launch P0: no
Candidate companies: 110
Declared verified social sources: 5
Configured verified social sources: 5
Crawl-evidenced verified companies: 0/50

## Blockers
- VERIFIED_COMPANIES_BELOW_50: P0 requires at least 50 crawl-evidenced verified companies; current count is 0.
```

`npm run p0:readiness -- --help` output:

```text
Usage: npm run p0:readiness -- [--db]

Without --db, uses the static candidate registry and no persisted observations.
With --db, reads companies, sources, and the latest two crawl observations per source from PostgreSQL.
```

## Self-review

- The help path exits before any database work starts, so it does not require `DATABASE_URL`.
- Default mode still uses the static readiness report and retains the existing blocker output.
- Secrets are not printed by the new test path or help text.

## Concerns

- The `--db` path was not exercised against a live PostgreSQL database in this workspace.
- I did not add a separate mocked `--db` unit test because the task brief only required the CLI behavior test for `--help`, and the db path needs a fake or mocked Prisma layer to stay offline.
