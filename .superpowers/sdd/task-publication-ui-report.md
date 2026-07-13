# Publication-aware search and canonical company directory report

## Outcome

Subtask status: **PASS, ready for independent read-only review and the parent-controlled index window.**

- Public job search now queries and returns only source IDs in the current publication snapshot.
- An empty eligible-source set returns zero jobs without issuing a broad job query.
- `lastUpdatedAt` is derived only from eligible `PUBLISHING` company records.
- Company coverage is derived from the canonical roster snapshot and returns the exact 60 companies in one batched publication read.
- The two user-authorized Phase 1 exclusions remain in the directory and are explicitly labeled without a completeness claim.
- The production provider requests the canonical roster count in one call; the count is derived from a browser-safe canonical roster data boundary rather than a hard-coded total.
- The directory prefers the official careers URL, falls back to the official website, and clearly presents all five publication states plus degraded health.
- Existing official job URLs, search grouping/filtering/sorting, consent checks, rate limits, pagination caps, feedback, and privacy paths remain covered by tests.

No database mutation, crawl, scheduler, evidence-output, staging, or commit action was performed.

## Systematic debugging and TDD record

### Root causes

1. Job search used a static source-plan list instead of the current publication snapshot, so legacy or unqualified sources could remain queryable.
2. Coverage read the database `Company` table, removed rows without websites, and capped results at 50, so it could neither prove nor return the canonical 60-company directory.
3. The provider and UI requested only 50 rows and displayed a raw website URL without publication state, health, careers preference, or truthful pending/exclusion language.
4. The anti-bulk request detector used a fixed limit of 50, which conflicted with the valid canonical 60-row directory request.
5. The first dynamic-count implementation imported a server-only roster hashing module into the browser bundle. The roster members were split into a browser-safe data boundary while the cryptographic assertion stayed server-only.

### RED

Initial focused run:

```text
vitest run tests/server/jobSearchService.test.ts tests/server/coverageService.test.ts tests/server/publicApi.test.ts tests/app/appDataProvider.test.ts tests/app/App.test.tsx
Test Files: 4 passed, 1 failed
Tests: 36 passed, 9 failed
```

The failures matched the intended gaps: publication snapshot ignored by search, broad query on empty eligibility, legacy last-update source, database-company coverage, 50-row cap, missing 60-row provider request, and missing truthful directory UI.

### Minimum implementation

- Injected one publication-snapshot reader into search and coverage services.
- Added exact eligible source constraints at query time and defensive source/company filtering after the query.
- Switched coverage to the canonical 60-company publication snapshot and asserted the exact versioned roster.
- Added route-specific dynamic coverage pagination and suspicious-request caps.
- Added a browser-safe canonical roster-members module for the front-end page size while preserving the server-only roster hash assertion.
- Added five Chinese publication-state labels, degraded health, category, last successful update, truthful state notes, official-careers preference, and website fallback.

## UI quality application

### Typography

| Before | After |
|---|---|
| Headings and short explanatory copy used default wrapping. | Headings use balanced wrapping; directory notes and explanatory copy use readable wrapping. |
| Dynamic counts and timestamps used proportional numerals. | Company/job counts and update timestamps use tabular numerals. |
| Root text rendering relied on browser defaults. | Root font smoothing is explicitly enabled. |

### Surfaces

| Before | After |
|---|---|
| Directory rows used a depth-suggesting border and exposed a raw URL. | Directory rows use the existing layered card shadow and a clear official-entry action. |
| Publication state and degraded health were invisible. | Consistent pill surfaces distinguish all five states and degraded health without changing the existing visual language. |
| Pending and exclusion rows could look equivalent to fully updated rows. | Each state has explicit Chinese status and a truthful note; exclusions state that no completeness claim is made. |

### Performance and interaction

| Before | After |
|---|---|
| Production directory loaded at most 50 rows. | One bounded request loads the dynamically derived canonical roster count. |
| A server-only hashing import entered the browser graph during the first implementation. | Browser imports only roster member data; the server retains the cryptographic assertion. |
| Press feedback used a smaller scale change. | Existing interactive controls use the consistent `0.96` active scale; transitions remain property-specific with no unnecessary `will-change`. |

The existing `lucide-react` icon system is preserved. No icon library, handwritten SVG path, emoji icon, or mixed icon style was introduced.

## Verification evidence

Final focused and regression run:

```text
vitest run tests/server/jobSearchService.test.ts tests/server/coverageService.test.ts tests/server/publicApi.test.ts tests/server/rateLimit.test.ts tests/server/httpServer.test.ts tests/domain/publicationEligibility.test.ts tests/db/publicationEligibilityRepository.test.ts tests/data/confirmedCompanyRosterV3.test.ts tests/app/appDataProvider.test.ts tests/app/App.test.tsx
Test Files: 10 passed
Tests: 92 passed
```

Additional gates:

```text
npm test
PASS — 135 test files; 2176 passed, 3 skipped

npm run typecheck
PASS

npm run build
PASS — 1597 modules transformed; production assets emitted

git diff --check -- <subtask files>
PASS
```

## Strict quality gate

| Dimension | Result | Evidence |
|---|---|---|
| Publication correctness | PASS | Exact eligible source query, defensive filtering, empty eligibility short-circuit, eligible-only update time tests. |
| Canonical roster completeness | PASS | Exact 60, exact 30 foreign plus 30 domestic, canonical IDs, one batched repository read, and roster hash/shape tests. |
| Truthful user-facing claims | PASS | Five state labels, degraded health, explicit exclusion note, and no pending-state completeness implication. |
| Official link integrity | PASS | Careers-first and website-fallback tests; existing official job-link test remains green. |
| Security and privacy | PASS | Consent, route-specific caps, suspicious-request behavior, rate limiting, privacy, and server-route regressions are green. |
| Browser production integration | PASS | Browser-safe roster boundary, typecheck pass, and Vite production build pass. |
| Independent release authority | PENDING AT PARENT LEVEL | This implementation agent did not self-authorize final release; parent must run the required independent read-only QA. |

## Files owned by this subtask

```text
src/app/App.css
src/app/App.tsx
src/app/appDataProvider.ts
src/data/confirmedCompanyRosterV3.ts
src/data/confirmedCompanyRosterV3Members.ts
src/server/coverageService.ts
src/server/jobSearchService.ts
src/server/publicApi.ts
src/server/rateLimit.ts
tests/app/App.test.tsx
tests/app/appDataProvider.test.ts
tests/server/coverageService.test.ts
tests/server/httpServer.test.ts
tests/server/jobSearchService.test.ts
tests/server/publicApi.test.ts
tests/server/rateLimit.test.ts
.superpowers/sdd/task-publication-ui-report.md
```
