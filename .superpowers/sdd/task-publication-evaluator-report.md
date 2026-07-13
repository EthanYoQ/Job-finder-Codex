# Per-company publication eligibility implementation report

## Status

Implementation and repository-wide verification are complete. The scoped patch is ready to commit.

## Boundary

This task adds only:

- `.superpowers/sdd/task-publication-evaluator-brief.md` (the controlling corrected task boundary)
- `src/domain/publicationEligibility.ts`
- `src/db/publicationEligibilityRepository.ts`
- `tests/domain/publicationEligibility.test.ts`
- `tests/db/publicationEligibilityRepository.test.ts`
- this report

It does not change the schema, migrations, registry, crawler, scheduler, search, API, UI, readiness, outputs, or progress ledger. No live database, crawl, migration, seed, registry sync, or deployment was run.

## Root cause and implementation

The codebase lacked one shared per-company publication truth. Deriving continuity from observations alone would erase a terminal source failure that produced no observation, allowing successes on either side to be joined incorrectly.

The implementation therefore:

- derives the exact directory from canonical `candidateCompanies`, validates the confirmed 30+30 roster and Phase 1 exclusions, and derives current staged source plans and their config hashes internally;
- issues exactly one batched `crawlBatchSourceResult.findMany` for explicit `FULL_RELEASE`, `SCHEDULED`, and `BASELINE` batches, selecting batch completion facts and at most two observations per result;
- treats every non-running source result as an ordered event, including zero-observation failures, while ignoring every still-`RUNNING` batch until the batch finishes;
- requires terminal batches to have `batch.finishedAt`, while preserving successful sources inside mixed `FAILED` or `INCOMPLETE` batches;
- requires two adjacent qualifying completed events per current source, makes qualification sticky only for the current config, and restores healthy status only after two adjacent recovery successes;
- applies the multi-source all-of rule, retains eligible source ids after later failure, and dynamically reduces every state, health, and eligible count;
- keeps a company in `VERIFYING` when any canonical SOCIAL official-entry/chain source is not represented by a current staged plan, even if a staged subset has already qualified;
- allows null/empty `officialEntryId`, `officialSurfaceIds`, and `officialChannelIds`, as required by the corrected strict-oracle boundary.

## TDD evidence

Initial RED:

```text
npx vitest run tests/domain/publicationEligibility.test.ts tests/db/publicationEligibilityRepository.test.ts --maxWorkers=2 --minWorkers=2
2 test files failed; 0 tests collected.
Single cause: the two planned implementation modules did not exist.
```

Independent process review found a second boundary gap. The added RED tests produced three expected failures because a terminal source result inside a still-running batch was counted early and a terminal batch without `batch.finishedAt` could qualify.

A later dynamic-source review found one further RED: with two canonical official SOCIAL sources but only one staged and twice successful, the company was incorrectly marked `PUBLISHING`. The generic source-coverage rule now keeps that company `VERIFYING` with no eligible source ids until every canonical official SOCIAL entry/chain source is staged.

After the minimum batch-boundary correction, the focused suite passed:

```text
2 test files passed
36 tests passed
```

The tests cover qualification fields and counts, exact zero jobs, observation cardinality and tuple binding, empty strict-oracle fields, adjacency and config reset, zero-observation failures, in-flight and terminal batch rules, sticky/degraded/recovery behavior, deterministic ordering, duplicate and unknown-event rejection, multi-source all-of behavior, incomplete staged coverage of canonical official sources, state priority, one-query repository behavior, canonical directory preservation, internal plan/hash derivation, extra-source filtering, and relation tuple drift.

Fresh compatibility verification also passed:

```text
npm run typecheck
exit 0

confirmed roster + Phase 1 scope + source-plan authority integration
4 test files passed; 37 tests passed
```

## Adaptive quality gate

Gate level: Standard. This is decision-driving authorization logic for which official jobs may be published, but it is isolated, read-only, and reversible.

Decision: RELEASE.

| Gate | Severity | Threshold | Evidence | Status |
| --- | --- | --- | --- | --- |
| Correct behavior | Hard | Corrected brief scenarios pass | Focused Vitest: 36/36 | PASS |
| Type safety | Hard | New implementation/tests and real Prisma client contract typecheck | Scoped `tsc` plus `PrismaClient` assignability probe | PASS |
| Repository-wide compatibility | Hard | `npm run typecheck` exits 0 and authority integration remains green | Typecheck exit 0; related integration 37/37 | PASS |
| Scope containment | Hard | Only the six authorized task files enter this commit | Exact staged-path comparison | PASS |
| Patch hygiene | Hard | `git diff --check` exits 0 on the staged patch | `git diff --cached --check`, exit 0 | PASS |
| Side-effect safety | Hard | No prohibited runtime or data mutation | Commands and status review | PASS |

## Concerns and explicit non-goals

- This task intentionally does not wire the snapshot into search, API, or UI; those are separate tasks in the controlling plan.
- The repository was exercised with typed mocks only. A live database was explicitly prohibited for this task.
- Publication eligibility is current-config derived, so a source-plan config change correctly requires a new adjacent success pair.
