STATUS: DONE

task:
- Task 2: HTML Fetch Routing (brief at `.superpowers/sdd/task-2-brief.md`)

changed files:
- C:\Vibe Coding Project\Job Finder\src\crawler\sourceFetchRouter.ts
- C:\Vibe Coding Project\Job Finder\tests\crawler\sourceFetchRouter.test.ts
- C:\Vibe Coding Project\Job Finder\scripts\p0-crawl.ts

tests run with outputs:
- `npm test -- tests/crawler/sourceFetchRouter.test.ts`
  - RED run: one failure in `routes html-table plans to the direct HTML fetcher when provided`; actual call order was `["fallback"]` (or fallback failure), proving router did not yet route html-table to direct fetch.
- `npm test -- tests/crawler/sourceFetchRouter.test.ts`
  - GREEN run: 1 test file passed with `3 passed`.
- `npm test -- tests/crawler/sourceFetchRouter.test.ts tests/crawler/p0CrawlCli.test.ts`
  - PASS: 2 files, 5 tests.
- `npm run typecheck`
  - PASS: `tsc --noEmit` exited 0.

commit:
- fefa44988161385426cefd32dbe66ad915290c29

self-review notes:
- `createSourceFetchRouter` now routes `MOKA` first, then html-table via optional `html` fetcher, and falls back otherwise.
- CLI wiring now wires `createHttpHtmlSourceFetch()` into router construction, so html-table plans are attempted with direct HTTP HTML before Tavily fallback.
- Added focused test for html-table routing and kept existing Moka/non-Moka coverage.

concerns:
- None.

---

STATUS: DONE

task:
- Task 2: Frontend reviewer findings fix (`src/app/App.tsx`, `src/app/App.css`, `tests/app/App.test.tsx`)

changed files:
- C:\Vibe Coding Project\Job Finder\src\app\App.tsx
- C:\Vibe Coding Project\Job Finder\src\app\App.css
- C:\Vibe Coding Project\Job Finder\tests\app\App.test.tsx

frontend fixes:
- `handleSearch()` now passes the current UI state into `dataProvider.searchJobs(...)`: `city`, `keyword`, `selectedCategories`, `onlyNew`, and `sort`.
- `推荐公司` no longer appears in the primary view strip. It remains available as an auxiliary action via `推荐未覆盖公司`, which opens the recommendation form without promoting it to a main tab.
- App tests now verify:
  - consent gating still prevents `searchJobs` before acceptance;
  - provider receives current search filters from the UI;
  - `只看新增` updates visible results;
  - sort changes update rendered company order;
  - recommendation submission still works from the auxiliary entry.

tests run with outputs:
- `npm test -- tests/app/App.test.tsx`
  - RED run: 3 failures reproduced the reviewer findings:
    - provider received empty `keyword/categories/onlyNew`;
    - primary view strip still contained `推荐公司`;
    - sort-order assertion exposed the current UI structure and required the intended order behavior to be verified explicitly.
- `npm test -- tests/app/App.test.tsx`
  - GREEN run: 1 test file passed with `8 passed`.
- `npm test -- tests/app/App.test.tsx tests/app/jobSearch.test.ts`
  - PASS: 2 files, 13 tests.
- `npm run typecheck`
  - PASS: `tsc --noEmit` exited 0.
- `npm run build`
  - PASS: Vite production build exited 0.

commit:
- `fix: align frontend search flow`

concerns:
- None.
