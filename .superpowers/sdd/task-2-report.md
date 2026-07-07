# Task 2 Report: Verification Gate Logic

## Implemented

- Added `src/domain/verification.ts` with:
  - `isVerifiedScrapable(source, observations)`
  - `countVerifiedCompanies(companies, observationsBySource)`
  - `canLaunchP0(companies, observationsBySource)`
  - `P0_MIN_VERIFIED_SCRAPABLE_COMPANIES = 50`
- Extended `tests/domain/verification.test.ts` with the task-specified verification-gate coverage.
- Kept the domain contract aligned to `officialUrl` as the required field name.

## TDD Evidence

### RED

Ran:

```bash
npm test -- tests/domain/verification.test.ts
```

Observed failure:

- Vitest could not resolve `../../src/domain/verification`
- This matched the expected red state before the module existed

### GREEN

Ran:

```bash
npm test -- tests/domain/verification.test.ts
npm run typecheck
```

Result:

- Focused test file passed: 4 tests passed
- Typecheck passed

## Files Changed

- `src/domain/verification.ts`
- `tests/domain/verification.test.ts`

## Self-Review

- The implementation follows the brief exactly and stays narrow.
- The gate only counts crawl observations that are successful, have `structuredJobCount > 0`, and include all required stable fields.
- `countVerifiedCompanies` treats a company as verified if any of its sources is verified scrapable.
- `canLaunchP0` enforces both the company-count band and the verified-company threshold.

## Concerns

- Unverified by this task: whether `officialEntryUrl` and `officialChainEvidenceUrl` should also be validated for format or reachability beyond being present.
- Unverified by this task: whether future launch rules will need additional status checks beyond the current `SOCIAL` and crawl-stability conditions.

## Fix Update

- Aligned `isVerifiedScrapable()` with the clarified launch-gate rule by requiring `source.status === "VERIFIED_SCRAPABLE"` in addition to the existing official evidence and crawl-stability checks.
- Updated the verification tests so pending-adapter sources are rejected even after two successful stable crawls, the positive two-crawl case uses a verified source, and launch-gate fixtures are marked `VERIFIED_SCRAPABLE`.

## Verification

Ran:

```bash
npm test -- tests/domain/verification.test.ts
npm run typecheck
```

Result:

- Targeted verification tests passed: 5 tests passed
- Typecheck passed
