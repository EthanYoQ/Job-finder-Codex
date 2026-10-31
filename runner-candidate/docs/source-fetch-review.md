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

The next live JNJ diagnostic reported `BROWSER_WAIT_TIMEOUT` from the wrapper that discarded the original exception. The local follow-up now preserves that original exception and prints only the fixed readiness stage (`JNJ_RESULTS_READY` or `JNJ_HEADING_READY`). Two synthetic regressions verify both stages, original error identity, cleanup and exclusion of page data. Selector and timeout behavior remain unchanged; the live root cause is still unconfirmed.

The native batch's default source timeout is five minutes, while the external CSPC/JNJ collectors permit thirty minutes. `direct-round.ts` currently passes no per-source override; after migration the full local DOM capture runs inside that native timeout. This is a possible early cutoff, not the demonstrated cause of the observed JNJ wait failure. No global or per-source timeout was increased. Any runtime environment override must be checked separately.

## Novo application locality follow-up

The parent's next live run saved 79 Novo responses before failing at requisition `347671.en_GB`. Its native detail identity and substantive description were valid. The official application page shortened `Liangshan Yi Autonomous Prefecture` to `Liangshan Yi Autonomous Prefec, Sichuan, CN`; strict city-string equality alone rejected it.

The application validator now accepts an unresolved locality only when the official application still names CN and the same verified mainland province as the list. It marks that job's city uncertain; both acquisition and evidence replay project city pending while retaining the original list location label. Explicit foreign location, different province/country and incorrect apply-link identity still reject. No title-based city inference or receipt rewrite is involved.

Two portable synthetic regression tests passed (`tests/novo-application-locality.test.mjs`). A local single-row synthetic run using the saved detail/application bytes also passed the real adapter and `replayNovoChinaRows`, preserving city pending and the original label. Full saved-body replay consumed all 79 responses and advanced to the next unavailable detail, `347667.en_GB`; it does not prove completion of all 77 list members. The same offline replay also passed the complete eight-response Organon capture. Source requests were forbidden, saved-body hashes checked, and reconstructed metadata/synthetic list scope explicitly recorded in `prepared/simple-review/novo-single-row-replay.json` and `latest-response-replay.json`. Focused TypeScript checking still reports only the unchanged Hansoh TS2345 described above.

## JNJ failed-detail evidence

The next formal run reached detail traversal and timed out at the `#js-job-detail` visibility wait (then line 89), before the separate Apply now wait. Absence of an apply button was not established. The existing JNJ schema requires a valid apply link and explicitly rejects closed text; there is no existing closed-row exclusion path. Unknown or challenged details continue to fail the source and preserve lastgood.

On a detail failure, the collector now saves one private diagnostic file under `${JOBFINDER_STATE_ROOT:-/data/job-finder}/diagnostics/jnj/`, named `jnj-detail-r-<id>-<uuid>.json`. It records the official card identity, index/completed count/total, failed stage, navigation HTTP status when available, and a fresh same-tab DOM observation (current URL, document title/readiness, detail-container count, apply links and root HTML). The observation read has a five-second bound. This file is explicitly not publication evidence and is never supplied to the source adapter.

New directories use mode 0700 and files use exclusive creation with mode 0600 on Linux. The structured log contains only the validated job ID, fixed stage, filename and SHA-256; it does not emit HTML, titles, full URLs, queries or filesystem paths. A failed browser observation still saves context with `captureUnavailable`; a file-write failure only marks `privateCaptureUnavailable` and never replaces the original exception. There is no page reload, request replay, challenge bypass or closure inference. Three local synthetic regressions cover detail/apply wait failures, hash/log privacy, missing DOM and failed disk writes. After deployment, retrieve the one file identified in the diagnostic log and inspect the failed member rather than restarting all 136 details just to find its identity.

## Pfizer and Sanofi private diagnostics

Pfizer's entry-navigation gate requires a response, HTTP 200 and the exact China-filtered URL. An initial suspicion that this gate caused the reported error was not established: the actual error-message hash does not match its fixed error text, and transpiled stack locations alone cannot identify the failure. The parent's isolated read observed HTTP 200 and the exact URL; zero cards immediately at DOMContentLoaded does not establish a problem because the collector already waits for cards and the China filter afterward. No URL, host, filter, status or waiting rule was relaxed.

Pfizer now records a private failure at entry navigation, card readiness or country-filter readiness, including response status/URL, observed URL and current DOM. Files default to `/data/job-finder/diagnostics/pfizer/pfizer-entry-<uuid>.json`. Sanofi's actual reported line 40 was the next-link click, outside its earlier readiness-loop fix. It now captures failures in page reads or advancing, including page number, root HTML, next-link markup/computed visibility/bounds and the element covering its center. Files default to `/data/job-finder/diagnostics/sanofi/sanofi-page-<number>-<uuid>.json`.

The existing bounded private writer was extracted once and reused for JNJ, Sanofi and Pfizer; 5-second observation bounds, exclusive 0600 files, 0700 new directories and original-error preservation remain. Logs contain only fixed stage/page and filename/hash. Fourteen related synthetic regressions passed, covering these new failure paths plus JNJ preservation and existing readiness deadlines. Focused TypeScript checking again reports only the unchanged Hansoh TS2345. No live source was requested by these local tests; the root cause of intermittent Pfizer navigation and Sanofi next-link failure awaits the captured live pages.

The next run failed intermittently at JNJ list-container readiness. The existing list catch's DOM observation was returned but discarded by the upper wrapper. That catch now also writes `diagnostics/jnj/jnj-list-<page>-<uuid>.json`, preserving the original observation and a fresh root HTML/title/readiness/result-count/heading capture. Navigation status comes from the browser's navigation timing entry when available, otherwise null. The log exposes only page/stage/file/hash; both results-container and heading failure tests verify stored bytes, hash, original-error identity, cleanup and no page-data logging. No timeout, navigation or retry rule changed.

## Confirmed Sanofi overlay and complete Pfizer traversal capture

The private Sanofi page from the parent matched SHA-256 `1c86dbb2689247fb7cca6ed6c7057a36faf2404cec6b64da28785f1352c26aef`. Its next link was visible with pointer events enabled, but the hit-tested element at its center was `.onetrust-pc-dark-filter.ot-fade-in`. The same DOM contained the official `#onetrust-reject-all-handler` button (全部拒絕). Before advancing, the collector now normally clicks this button if visible, then normally clicks next. It does not force clicks, remove overlays, accept optional cookies or change search scope. A sandboxed local Chrome test restricted to a loopback server passed both the blocking-cookie and no-cookie paths with exactly one next click. The execution-container Chrome attempt failed to start; the approved local execution retained Chrome's own sandbox and passed.

Pfizer's private catch now covers the entire capture, including detail-page creation and every list/detail/pagination stage. `pfizer-traversal-<uuid>.json` records the original error message/stack privately, page/record/card position, completed pages/seen IDs and navigation statuses, plus parallel list and detail DOM observations within the shared five-second bound. Unknown dynamic Playwright, JSON/URL or row-validation errors remain failures; none are reclassified as a successful capture. Eight diagnostic regressions pass, including dynamic failures at newPage, list read and detail read; the original exception and detail cleanup are preserved and logs exclude private messages. Focused typechecking reports only the existing Hansoh TS2345. The next live capture must identify Pfizer's actual cause before any compatibility rule is changed.
