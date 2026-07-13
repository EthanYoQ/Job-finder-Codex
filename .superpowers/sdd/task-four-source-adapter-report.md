# Four-source static official adapter implementation report

## Status

Implementation, independent-review fixture repair, and scoped verification are complete. Apeloa, Huahai, Otsuka group source 2, and Grand Pharma have canonical staged HTML plans backed by one generic static-list contract. Their test fixtures now preserve the real selector-required fragments observed in one fresh official-page capture instead of invented titles. Otsuka subsidiary source 1 remains `ENTRY_FOUND_PENDING_ADAPTER` and has no executable plan, so Otsuka must not be counted as a stable-complete company yet.

No project crawler, database access or write, migration, seed, registry synchronization, deployment, ReleaseCandidate mutation, output-evidence mutation, monitoring change, publication change, or UI change was performed. The repair used one direct read-only HTTPS GET of each of the five already-approved official URLs. Full response bodies were kept in memory only; fixtures retain the minimum selector-required fragments, with contact email omitted and Huahai tracking query parameters removed. Sandoz was not changed.

## TDD evidence

Initial implementation RED used the existing local Vitest executable against the adapter, fetch evidence, source plan/channel, registry/oracle, and fixture suites:

```text
8 test files; 150 tests total
24 failed, 126 passed
```

Every failure mapped to an intended missing capability: composite HTML identity, static-list/explicit-zero evidence, four canonical plans, or the corrected Otsuka/registry bindings. Existing unrelated cases remained green. After the minimum implementation:

```text
8 test files passed
150 tests passed
```

Additional crawler evidence regressions passed during that implementation:

```text
3 test files passed
171 tests passed, 2 skipped
```

The independent review then placed the implementation on HOLD because the original four fixtures used invented titles and insufficient row counts. The review-repair RED was fixture-specific:

```text
1 test file; 7 tests total
7 failed, 0 passed
```

The failures were the intended evidence gaps: missing capture provenance, Apeloa 2/1 rows instead of 19 social/12 campus, missing Huahai adjacent Liepin rows, invented Otsuka and Grand titles, and no Otsuka subsidiary empty-container fixture. After replacing only the fixtures and their test oracle:

```text
1 test file passed
7 tests passed

8 focused test files passed
152 tests passed
```

## Implementation

- Added mutually exclusive `sourceJobIdParts`, requiring every normalized part and deriving `html:sha256:<sha256>` from the U+001F-delimited UTF-8 values. Missing parts fail row validation; ambiguous single/composite configuration fails before extraction.
- Added `staticPublicList` with exact one-container, row-containment, excluded-partition, no-next-control, and non-redacted-body checks.
- Positive static lists emit `COMPLETE_PAGE_TRAVERSAL=1` with `NEXT_ABSENT`; no current row count is stored as a configured total.
- Empty static lists remain noncertifying unless one configured official empty marker matches; only then can evidence emit `OFFICIAL_TOTAL_COUNT=0` with `EMPTY_PAGE` and an exact zero reconciliation.
- Validation loss, duplicate raw rows, dedupe loss, redacted content, pagination controls, missing/multiple containers, outside rows, and excluded-partition overlap remain fail-closed.
- Replaced the orphan Apeloa and Grand config keys with canonical source IDs, promoted Apeloa/Huahai/Grand registry sources, recorded their campus partitions separately, and added the verified Otsuka group page as source 2.
- Preserved Otsuka subsidiary source 1 identity and official chain while leaving it pending and non-executable.
- Replaced the four invented HTML fixtures with sanitized exact selector fragments from one official capture and added the Otsuka subsidiary empty-container fixture. The observation-bound rows are Apeloa 19 social plus 12 campus, Huahai 2 social, Otsuka group 2 social, and Grand Pharma 2 social plus 1 campus. These captured counts are test evidence only; no production expected total is configured or hardcoded.
- Locked the real captured titles and locations, Apeloa first-`mailto` publication-date structure, Grand/Apeloa campus exclusion, and Huahai's adjacent Liepin application links. The Liepin query parameters are removed from the fixture, and the adapter still emits only Huahai's official company URL.
- Added a negative Otsuka subsidiary fixture for the real empty `.positionBox > ul.clear` structure. It has neither an official empty marker nor any discovery/staged executable plan, and the generic static-list probe rejects it instead of certifying zero openings.

## Fresh official capture provenance

All five requests returned status 200 and ended at the same official URL that was requested. The SHA-256 values and byte counts below describe the complete response bytes before sanitization; the repository fixtures contain only selector-required fragments.

| Source | Captured at (UTC) | Final URL | Full bytes | Full-response SHA-256 |
| --- | --- | --- | ---: | --- |
| Apeloa | `2026-07-13T18:48:14.505Z` | `https://www.apeloa.com/join.html` | 185804 | `e885c02b61498579788a9976d887b55ddbaeb7be2aa7f818b606d6b8d6efd2c4` |
| Huahai | `2026-07-13T18:48:15.669Z` | `https://www.huahaipharm.com/zpgw.html` | 22711 | `9b0a718db14901534756d32970102871ed4bc59496f35e28f9406b79e21e33c6` |
| Otsuka group | `2026-07-13T18:48:16.998Z` | `https://www.otsuka.com.cn/join-us/index.html` | 20799 | `fcdd871bba7290bc34c5b4d3f403c9d9434c2143d6bd02b97ecfa2ac84ebec6e` |
| Otsuka subsidiary | `2026-07-13T18:48:18.665Z` | `https://chinaotsuka.com.cn/class/26` | 39132 | `324e9a5716d3e440e87e72ab51c7b1a7ffeb733f3a1385469fc4ea58ebb393e4` |
| Grand Pharma | `2026-07-13T18:48:19.777Z` | `https://job.grandpharma.cn/` | 31136 | `c921be1b5520a1c797cfa8238d11f289a52c10f345dc6c5b53cfc165d2f69f7d` |

## Adaptive quality gate

Gate level: Standard. The change controls which official-source observations can become completeness-qualified, but it is localized, reversible, and has no runtime data mutation in this task.

Decision: PASS for repair handoff. The prior independent HOLD is not self-cleared here; a read-only reviewer who did not make this repair must re-check the fixtures and tests before any live source is called stable in release evidence.

| Gate | Severity | Threshold | Evidence | Status |
| --- | --- | --- | --- | --- |
| Correct behavior | Hard | Fixture RED becomes green and the full focused matrix remains green | 7/7 fixture tests; 152/152 focused tests | PASS |
| Evidence safety | Hard | Static lists fail closed on structural drift, redaction, loss, duplicates, and unlabeled zero | Positive/negative fetch matrix plus strict fixture assertions | PASS |
| Core regression | Hard | Existing reconciliation and pagination evidence remain green | 171 passed, 2 skipped in the implementation verification | PASS |
| Type safety | Hard | Repository TypeScript check exits 0 | `.\node_modules\.bin\tsc.cmd --noEmit` | PASS |
| Production build | Hard | Runtime implementation build exits 0 | 1,596 modules transformed in the implementation verification; fixture repair changes no runtime code | PASS |
| Scope containment | Hard | Review repair changes only fixtures, their test oracle, and this report | Scoped status and path review | PASS |
| Patch hygiene | Hard | Tracked and new-file whitespace checks pass | Scoped `git diff --check` | PASS |
| Side-effect safety | Hard | No project crawl/DB/migration/seed/sync/deploy/RC mutation | Command and status review; five one-shot read-only official GETs only | PASS |

## Verification commands

```text
.\node_modules\.bin\vitest.cmd run tests/crawler/fourStaticOfficialSources.test.ts
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

The repaired fixtures prove what the five official pages exposed in the recorded capture, including the 19/2/2/2 selected social-row counts and 12/1 campus exclusions. They do not prove that those titles or counts remain current at a later release time. Independent QA must parse the repaired fixtures without relying on the production adapter and must still compare fresh official bytes, selected rows, exclusions, no-next controls, and artifact hashes before release evidence can call a source current and stable. Otsuka subsidiary source 1 remains a disclosed verification gap; group source 2 must not be used to claim all Otsuka official-linked public openings are complete.
