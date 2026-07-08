Files changed
- `src/data/companyRegistry.ts`
- `src/crawler/sourcePlan.ts`
- `tests/crawler/sourcePlan.test.ts`
- `tests/data/companyRegistry.test.ts`

Test commands run and results
- Red phase:
  - Command: `npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts`
  - Result: FAIL as expected.
  - Failure evidence:
    - `tests/data/companyRegistry.test.ts`: HengRui source still had `status: "ENTRY_FOUND_PENDING_ADAPTER"` instead of `VERIFIED_SCRAPABLE`.
    - `tests/crawler/sourcePlan.test.ts`: `source-astrazeneca-social` still resolved to `adapterId: "official-json"` instead of `html-table`.
    - `tests/crawler/sourcePlan.test.ts`: wave-1 source-plan expectations for AstraZeneca/HengRui/Kelun did not match current configuration.
- Green phase:
  - Command: `npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts tests/crawler/adapters.test.ts`
  - Result: PASS. `3` test files passed, `17` tests passed.
- Typecheck:
  - Command: `npm run typecheck`
  - Result: PASS.

Commit hash
- `c0f1e1d`

Self-review notes
- Followed TDD sequence from the brief: wrote new assertions first, captured the expected red-phase failures, then implemented the minimum registry and source-plan changes.
- Reused a shared `MOKA_JSON_CONFIG` for Beigene and HengRui as required.
- Updated the pre-existing HengRui exclusion assertion in `tests/crawler/sourcePlan.test.ts` because it contradicted the new verified-source requirement and caused a false negative during focused verification.
- Kept changes within the owned source/test files from the task brief.

Concerns
- `CodeGraph` was not initialized in this workspace, so structural inspection fell back to direct file reads. This did not block the task.

## Review fix

Files changed
- `src/data/companyRegistry.ts`
- `src/crawler/sourcePlan.ts`
- `tests/crawler/sourcePlan.test.ts`
- `tests/data/companyRegistry.test.ts`

Commands and results
- `npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts tests/crawler/adapters.test.ts` -> PASS
- `npm run typecheck` -> PASS

Commit hash
- `0a47e6f`

Self-review
- CSPC is no longer treated as wave-1 plannable: its company source status now reflects entry found but still pending follow-up, and its representative source config was removed.
- Source plan tests now assert the exact six allowed wave-1 source IDs and explicitly reject CSPC planning.
- This fix is scoped to the requested files only.
