# Task 4 Report: Privacy Consent And SEO Route Policy

## Implemented

Added a small route policy module at `src/domain/route-policy.ts` with the three requested policy functions:

- `canAccessWithoutConsent(pathname): boolean`
- `isIndexableRoute(pathname): boolean`
- `shouldLoadOperationalAnalytics(pathname, hasConsent): boolean`

Also added focused contract tests at `tests/domain/route-policy.test.ts`.

## TDD Evidence

### RED

Ran the focused test command before implementation:

```bash
npm test -- tests/domain/route-policy.test.ts
```

Observed failure because `src/domain/route-policy.ts` did not exist:

- Vitest reported `Cannot find module '../../src/domain/route-policy'`
- The suite failed to load, as expected for the missing implementation step

### GREEN

After implementing the module, reran:

```bash
npm test -- tests/domain/route-policy.test.ts
npm run typecheck
```

Results:

- Route policy test file passed: 5 tests, 5 passed
- TypeScript typecheck passed with no errors

## Tests Run

- `npm test -- tests/domain/route-policy.test.ts`
- `npm run typecheck`

## Files Changed

- `src/domain/route-policy.ts`
- `tests/domain/route-policy.test.ts`

## Self-Review

- The implementation matches the brief exactly and stays isolated to policy logic only.
- No frontend UI or router code was changed.
- Path normalization handles query strings and trailing slashes, which keeps the policy stable for the requested inputs.

## Concerns

- No unresolved implementation concerns for Task 4.
- The policy is intentionally narrow and only covers the routes named in the brief; later router/middleware integration should still be verified against real request objects.
