# 01 — Enforce City-scoped Search end to end

**What to build:** Make every accepted job-discovery request use one concrete selected city, with nationwide and China-wide roles included only as fallbacks within that city search. Remove and reject the legacy all-locations bypass across the request, database, demo, and discovery-interface behavior.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] The legacy all-locations sentinel is rejected before any database job read
- [x] Every accepted database search applies the selected-city predicate plus nationwide/China fallbacks
- [x] The discovery interface no longer offers an all-locations option
- [x] Demo behavior matches the production contract
- [x] Public-seam regression tests turn from red to green without breaking concrete-city searches

## Answer

- The domain now exports one supported-city tuple (北京、上海、广州) shared by the request schema and discovery interface. Requests reject `全部地点`, national/regional/foreign labels, and arbitrary unsupported strings before any database job read; accepted database queries always apply the selected city with `全国` and `中国` fallbacks.
- The discovery interface exposes only the shared supported cities, and demo filtering validates the same city request contract.
- Added public-seam coverage for unsupported-value API rejection before DB reads, UI option absence plus supported-city submission, demo rejection plus supported-city results, and the database predicate.
- Validation passed: `npm test -- tests/app/App.test.tsx tests/app/appDataProvider.test.ts tests/app/jobSearch.test.ts tests/domain/search.test.ts tests/server/jobSearchService.test.ts tests/server/publicApi.test.ts` (6 files, 60 tests); `npm run typecheck`; `git diff --check`.
