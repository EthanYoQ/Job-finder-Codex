# Source fetch compatibility and diagnostics — 2026-10-31

Only the runner's five fetch files changed. No source request, database access, production execution, historical publication or receipt rewrite was performed by this review.

## Corrected response gates

- Merck: two of 66 official rows had title suffixes `北京2` and `HPLC`. The structured China locations and requisition identities were valid. An unresolved title suffix now keeps the row with city pending; explicit foreign/non-mainland suffixes still reject.
- Novo: eight of 77 official rows used city names absent from the reviewed dictionary. A confirmed mainland province plus China country now permits city pending. Original labels remain intact, including the source's `Xinzhou` / `Shaanxi` pair; no city or province correction is inferred. Country, province, ID, duplicate, count, native URL and nested-label checks remain.
- Organon: the first native detail's JSON-LD locality was the list's independently validated `workLocation` (`CHN - Chengdu`), while the native URL used Nanchang. Either validated locality can bind the detail; conflicting mainland cities still project as city pending. Native identity, title, date, country, URL and availability checks remain.

The web reader consumes committed receipts and projections, explicitly without replaying response bodies. Its older acquisition helpers are not part of the active public read path and were not replaced. Current plan hashes and receipt identity were not relabeled.

## Safe failure evidence

`runSourceCrawl` now logs one `SOURCE_FETCH_DIAGNOSTIC` at the fetch boundary, preserving the original result/exception. Returned failures expose only fixed reason codes, HTTP status counts and selected validation-loss counts. Thrown failures expose exception type, normalized reason, message SHA-256 and application-relative stack locations. Bodies, headers, URLs, command arguments, credentials and raw stacks are excluded.

Browser classifiers include missing serialized `__name`, ReferenceError type, unsupported method, invalid/ambiguous selector, timeout, missing executable/dependencies, sandbox failure and selected network error codes. No browser behavior or sandbox setting changed. CSPC/JNJ/Sanofi require next-run diagnostics before a specific browser fix is justified.

For existing database evidence, safe columns are `EvidenceArtifact.kind/httpStatus/contentType/byteCount/capturedAt` by sourceResultId; `TransportAttemptEvidence.sequence/transport/outcome/code/capturedAt` when present. HTTP status belongs to referenced artifacts. The observed five failures had no TransportAttemptEvidence rows.

## Local verification and limits

Six focused regressions passed on Windows: safe metadata logging, safe browser classifications, unchanged real fetch failure handling, all 66 Merck rows, all 77 Novo rows with eight pending cities, and the first Organon native detail with negative identity/country/locality tests. Tests disabled global network fetch and verified SHA-256 for all six parent-downloaded response bodies.

The injected HTTP replay passed Merck's complete saved-body path. Novo advanced beyond list validation but has no saved career-search entry/native pages. Organon advanced beyond the first detail but has no saved second native detail (R541737). Those cases remain incomplete and retain lastgood; these old response replays are not publication evidence. Redacted request URLs required reconstructing metadata from the request plan, explicitly recorded in local replay JSON.

Focused TypeScript checking included all five changed files plus the parent's `scripts/p0-b-grade-validator.ts` and `src/crawler/isolatedBGradeTraversalValidator.ts`. It reported one pre-existing error in unchanged `hansohNativeWindowEvidence.ts`: TS2345, `string | Uint8Array` passed to JSON.parse. No diagnostic names a changed file. This is not a clean full typecheck.

Local supporting files reside in `prepared/simple-review`: `source-fetch-tests.tap` (6/6), `source-field-compatibility.test.mjs`, `fetch-diagnostics.test.mjs`, `failed-response-replay.json`, `source-fetch-typecheck.json`, and `source-fetch-manifest.json`. The private response files remain outside this source package. New-machine/Linux and live-source validation are pending the parent's deployment/run.

## Local browser readiness follow-up

Static review confirmed `timeoutMs` is mapped to Playwright's `timeout` and browser tabs share one context. The CSPC and Sanofi wait loops, however, recognized only legacy CUA timeout messages: a native Playwright `TimeoutError` prematurely terminated the intended 60-second readiness budget after its first 10-second wait. They now recognize that exception type; CSPC's navigation timeout also proceeds to its existing same-tab readiness check. The original overall deadlines and all non-timeout exceptions remain unchanged. There is no new source request, page reload or capture retry. Sanofi fixed failure codes are now included in safe diagnostics.

Six focused synthetic tests in `tests/local-browser-readiness.test.mjs` cover both collectors: native timeout continuation in one tab, immediate non-timeout propagation, and overall deadline enforcement. This fixes a code-proven compatibility defect; it does not establish the cause of the still-unobserved live browser failures. JNJ already gives its selector wait the full remaining 30-second budget and was not changed.
