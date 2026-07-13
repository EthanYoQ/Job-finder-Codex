# Four-source static official adapter implementation report

## Status

Implementation and scoped verification are complete. Apeloa, Huahai, Otsuka group source 2, and Grand Pharma now have canonical staged HTML plans backed by one generic static-list contract. Otsuka subsidiary source 1 remains `ENTRY_FOUND_PENDING_ADAPTER` and has no executable plan, so Otsuka must not be counted as a stable-complete company yet.

No live network crawl, database access or write, migration, seed, registry synchronization, deployment, ReleaseCandidate mutation, output-evidence mutation, monitoring change, publication change, or UI change was performed. Sandoz was not changed.

## TDD evidence

Initial focused RED used the existing local Vitest executable against the adapter, fetch evidence, source plan/channel, registry/oracle, and sanitized-fixture suites:

```text
8 test files; 150 tests total
24 failed, 126 passed
```

Every failure mapped to an intended missing capability: composite HTML identity, static-list/explicit-zero evidence, four canonical plans, or the corrected Otsuka/registry bindings. Existing unrelated cases remained green.

After the minimum implementation:

```text
8 test files passed
150 tests passed
```

Additional crawler evidence regressions passed:

```text
3 test files passed
171 tests passed, 2 skipped
```

## Implementation

- Added mutually exclusive `sourceJobIdParts`, requiring every normalized part and deriving `html:sha256:<sha256>` from the U+001F-delimited UTF-8 values. Missing parts fail row validation; ambiguous single/composite configuration fails before extraction.
- Added `staticPublicList` with exact one-container, row-containment, excluded-partition, no-next-control, and non-redacted-body checks.
- Positive static lists emit `COMPLETE_PAGE_TRAVERSAL=1` with `NEXT_ABSENT`; no current row count is stored as a configured total.
- Empty static lists remain noncertifying unless one configured official empty marker matches; only then can evidence emit `OFFICIAL_TOTAL_COUNT=0` with `EMPTY_PAGE` and an exact zero reconciliation.
- Validation loss, duplicate raw rows, dedupe loss, redacted content, pagination controls, missing/multiple containers, outside rows, and excluded-partition overlap remain fail-closed.
- Replaced the orphan Apeloa and Grand config keys with canonical source IDs, promoted Apeloa/Huahai/Grand registry sources, recorded their campus partitions separately, and added the verified Otsuka group page as source 2.
- Preserved Otsuka subsidiary source 1 identity and official chain while leaving it pending and non-executable.
- Added four compact sanitized HTML fixtures. They verify social-partition selection, composite IDs, campus exclusion, and that Huahai third-party apply links are never emitted as official job URLs. Fixture counts are test data only; production totals are not hardcoded.

## Adaptive quality gate

Gate level: Standard. The change controls which official-source observations can become completeness-qualified, but it is localized, reversible, and has no runtime data mutation in this task.

Decision: PASS for implementation handoff; independent read-only QA is still required before any live source is called stable in release evidence.

| Gate | Severity | Threshold | Evidence | Status |
| --- | --- | --- | --- | --- |
| Correct behavior | Hard | Focused RED becomes fully green | 150/150 focused tests | PASS |
| Evidence safety | Hard | Static lists fail closed on structural drift, redaction, loss, duplicates, and unlabeled zero | Positive/negative fetch matrix plus strict crawl assertions | PASS |
| Core regression | Hard | Existing reconciliation and pagination evidence remain green | 171 passed, 2 skipped | PASS |
| Type safety | Hard | Repository TypeScript check exits 0 | `.\\node_modules\\.bin\\tsc.cmd --noEmit` | PASS |
| Production build | Hard | Vite production build exits 0 | 1,596 modules transformed; build completed | PASS |
| Scope containment | Hard | No forbidden project/runtime areas changed | Scoped status and path review | PASS |
| Patch hygiene | Hard | Tracked and new-file whitespace checks pass | Scoped `git diff --check` and no-index checks | PASS |
| Side-effect safety | Hard | No live crawl/DB/migration/seed/sync/deploy/RC mutation | Command and status review | PASS |

## Verification commands

```text
.\node_modules\.bin\vitest.cmd run tests/crawler/adapters.test.ts tests/crawler/httpHtmlSourceFetch.test.ts tests/crawler/fourStaticOfficialSources.test.ts tests/crawler/sourcePlan.test.ts tests/crawler/sourcePlanChannels.test.ts tests/data/companyOfficialLinks.test.ts tests/data/companyRegistry.test.ts tests/data/companyOracle.test.ts
.\node_modules\.bin\vitest.cmd run tests/crawler/runSourceCrawl.test.ts tests/crawler/paginationEvidence.test.ts tests/crawler/sourceFetchEvidence.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\vite.cmd build
git diff --check -- <task paths>
```

The first attempted `pnpm exec` was stopped by the local ignored-build policy before tests ran. Its temporary lock/workspace files were removed, and verification used the already-installed project executables without changing dependencies.

## Files in this task

- `src/crawler/adapters/types.ts`
- `src/crawler/adapters/htmlTable.ts`
- `src/crawler/httpHtmlSourceFetch.ts`
- `src/crawler/sourcePlan.ts`
- `src/data/companyRegistry.ts`
- `src/crawler/fixtures/static-official-sources/*.html`
- `tests/crawler/adapters.test.ts`
- `tests/crawler/httpHtmlSourceFetch.test.ts`
- `tests/crawler/fourStaticOfficialSources.test.ts`
- `tests/crawler/sourcePlan.test.ts`
- `tests/crawler/sourcePlanChannels.test.ts`
- `tests/data/companyOfficialLinks.test.ts`
- `tests/data/companyRegistry.test.ts`
- `tests/data/companyOracle.test.ts`
- `.superpowers/sdd/task-four-source-adapter-report.md`

## Release boundary

This implementation does not prove current live titles or counts. Independent QA must fetch official bytes afresh and compare selected rows, exclusions, no-next controls, and artifact hashes. Otsuka subsidiary source 1 remains a disclosed verification gap; group source 2 must not be used to claim all Otsuka official-linked public openings are complete.
