# Direct crawler candidate

One serial database runner connects the original 36 source configurations to the original atomic repository: 20 PORTABLE, 12 TRUE_A, 4 TRUE_B. Each due source receives a fresh batch. This is a locally verified implementation candidate; no live sources, PostgreSQL instance or server have been accessed.

`scripts/direct-round.ts` calls `runP0CrawlBatch` directly. The new execution path removes Functions, FilePilotRelay, host-helper, Git/fixed-binary qualification, host bindings, old manual holds, global company-count launch gates and repeated external SQL/archive/publication reviews. Old HOLD/UNKNOWN evidence remains untouched in `prepared/app`; no old commit request is replayed.

Source configuration, native parser/replay, evidence archive, A/B certificate and atomic writes remain. A/B now use the existing `SOURCE_ATOMIC_LAST_GOOD_V1` policy and the same fenced database lease as PORTABLE. Bayer/Sanofi collect the independent chain before the main HTTP chain and retain its original artifact for their compact certificates. All last-good commits use actual capture completion time.

## Browser acquisition

All six previously identified DOM integration gaps are connected to local Playwright/Chromium. Historical schema names containing `cua` remain compatibility identifiers. Browser failure never falls back to a successful HTTP-only result, changes the source grade, or substitutes old capture bytes.

| Sources | Current entry | Original implementation reused |
| --- | --- | --- |
| Bayer, Servier | `captureLocalHybridDom(sourceId, signal?)`, then original independent detail HTTP and B conversion | `original-relay-automation-20261017T0609Z/moka-b-browser-runtime.js` |
| Sanofi | same entry, native Chinese dual chain | `original-relay-automation-20261017T0609Z/sanofi-browser-runtime.js` |
| CSPC | `withLocalOfficialDom(http)(plan, tracker?)`, fresh DOM and original HTTP comparison before owned admission | `cspc-dom-runtime-functions.js`, `cspc-browser-runtime.js`, `offline-checkers/cspc-dom-http-review.mts` |
| BI | same wrapper, visible DOM compared with original API and reviewed UI exclusions | `bi-functions.js`, `offline-checkers/bi-dom-http-review.mts` |
| JNJ | same wrapper, fresh bytes passed to `createJnjCareersDomSourceFetch({lists, details})` | `jnj-browser-runtime.js`, native `jnjCareersDomEvidence.ts` |
| Pfizer | existing `capturePfizerRenderedTraversal(page, signal?)`, invoked automatically by the isolated B worker | native `pfizerRenderedTraversal.ts`; no Functions dependency |

The bridge derives from `job-finder-instabox-migration-20261031/chromium-dom.mjs`. Original selectors, scope, pagination and identity checks remain. Chromium sandbox stays enabled. Browser environment variables are restricted to platform/display/locale settings, excluding database credentials. The existing B worker retains its credential-isolated child environment and bounded capture lifetime.

## Running after preparation

Restore the original database and constraints. Provide the lockfile's Linux dependencies, generate Prisma for the target platform and install `/usr/bin/chromium`. Run from this directory: the isolated validator launches `scripts/p0-b-grade-validator.ts` relative to the working directory.

Set `DATABASE_URL` and `JOBFINDER_CANDIDATE_ID` to the actual database and a truthful registered `instabox-*` candidate. Candidate identity remains a real foreign-key consumer. Supply authentic `migration-state.json` with this `candidateId`, the imported `legacyCandidateIds`, `replayLegacy: false`, and `unresolvedRequests` retaining historical result/batch/manual IDs and source scopes. UNKNOWN entries may remain UNKNOWN; an empty new database is not proof of rollback. The selected candidate must not be an imported legacy candidate. This entry creates fresh batch IDs and accepts no historical request, batch or result ID for replay.

```sh
npm run check:routes
npm run crawl
```

The initial timer cadence is **00:01 and 12:01 Beijing time**. Only after three complete, genuinely stable calendar days may the deployment timer switch to 00:01 alone. Those days require all 36 real timer captures, database commits, public snapshot readback and recovery acceptance; synthetic tests count as zero days. The runner reuses the existing per-source due check without a daemon or queue.

Only a successful observation in the current schedule window suppresses another capture. A clearly failed capture does not wait until the next 12-hour window: the next refresh may create a fresh batch if no accepted success already covers that window. Unresolved new-runner writes still require fenced recovery or stop the round; no old batch is replayed. Imported successful observations may legitimately suppress same-window work, but are not new-candidate captures for the three-day acceptance period.

`scripts/recover-direct.ts` runs under the shared lease. It only handles single-source SCHEDULED batches owned by `direct-scheduler` under the selected new `instabox-*` candidate. Committed results are finalized from stored rows. A remaining PENDING result after fenced takeover becomes `NOT_ATTEMPTED` with reason `DIRECT_WORKER_INTERRUPTED` and FAILED/SKIPPED transport/adapter states, using the restored database's existing legal failure transition. Its batch becomes INCOMPLETE. It never replays a commit, writes Job rows or recovers legacy/manual unknown requests. Unresolved writes remaining in this same candidate/owner/kind scope stop the round. Imported historical states stay untouched and do not block fresh captures. Old writers must remain stopped after cutover.

The web candidate owns snapshot export. Export should follow completed source work even if another source failed, preserving atomic rename/last-good snapshots. Unknown database outcomes must be reconciled before a new snapshot export.

## Explicit manual previews

`scripts/direct-manual.ts --request-id <new-request-id>` consumes one original `ManualCrawlRequest` using the original worker and manual batch executor. It preserves preview-only semantics: `force: true` ignores scheduled windows, but the manual result does not publish Job rows or refresh the public snapshot. Only the exact QUEUED request created after the selected candidate's database registration is claimable. Manifest-listed old manual IDs and all earlier requests are excluded; RUNNING requests are never reclaimed or replayed.

The entry uses the shared database lease and fenced transactions. While that lease is definitely busy, the service waits 30 seconds before attempting acquisition again; the request has not yet been claimed. Any uncertain acquisition, execution or terminal update stops without an automatic replay. `pipeline/jobfinder-manual@.service` is the fixed deployment template, uses the existing postgres/runtime environment files, and has `Restart=no`. It has not been enabled by this local implementation task.

The original active-request uniqueness constraint remains. A source with a historical QUEUED/RUNNING request returns `409 ALREADY_ACTIVE` on enqueue; the consumer does not silently clear history or bypass the index. The web hook starts the fixed service only for a successfully returned new request ID and distinguishes request creation, launch requested, and launch unconfirmed.

Two offline manual tests and three real local PostgreSQL claim/state tests passed. The SQL registration-time comparison uses an ISO UTC value cast to timestamp, matching Prisma's timestamp-without-time-zone field even when the session timezone differs. These tests do not establish that any live source preview succeeded.

## Verification and limits

```sh
npm run test:offline
npm run test:browser
node --import ./scripts/local-check-loader.mjs ./scripts/direct-round.ts --check
```

The offline Windows loader reuses the recovered TypeScript compiler and dependencies. Production uses existing `tsx`; no replacement runtime or dependency installation was added.

- The offline suite covers exact 36-source/20-12-4 mapping, retained legacy UNKNOWN audit records, new candidate/owner-scoped unresolved writes, owned lease requirements, failed A/B/PORTABLE captures retaining Job rows, 00:01/12:01 boundaries, and scoped crash recovery. The two changed historical-isolation tests passed independently after narrowing the old global blocker.
- Two real Chromium tests pass with all requests intercepted and synthetic content served only from 127.0.0.1. Bayer/Servier/Sanofi reach native B conversion and reject HTTP 503. Sanofi also reaches the unchanged atomic writer with one synthetic Job. CSPC exercises iframe/list/popup/placeholder login-entry observation and native HTTP replay. BI checks visible IDs/titles/locations against API rows. JNJ reaches native A replay and the atomic writer with one synthetic Job. Pfizer reaches native automatic DOM/JSON-LD B conversion. Negative tests reject missing CSPC login evidence, BI title drift and missing JNJ detail.
- BI's redundant script byte-length/hash gate was removed; the whole-program AST identity and explicit request, exclusion and render checks remain. Formatting/comments may change, but program structure or behavior may not. No source/test imports consumed the deleted hash constant; the original test's literal hash only asserts its archived fixture bytes. Complete native HTTP replay is still unverified because the original test fixture `tests/fixtures/bi/20261001-exact-evidence.json` and reviewed `recruit.js` are absent from the prepared/recovered inventories. No synthetic program was admitted in place of that source. Production fetches it normally and applies the retained AST/semantic checks.
- Changed entry/core TypeScript files have zero diagnostics. Full transitive checking still has 33 diagnostics in dormant cloud exports/missing host modules and legacy typing; the original core check had 86. This is not a passing full-project typecheck.
- The Windows execution sandbox prevented Chrome Crashpad startup. The authorized browser test ran outside that execution sandbox while Chromium's own sandbox remained enabled.

No PostgreSQL commit/readback, concurrent takeover, restored-schema compatibility or real-source drift was tested. The known database metadata includes 27 tables, 23 functions and 22 triggers; no business constraint was dropped. Authentic old-request reconciliation state is still required before deployment. These are acceptance boundaries, not evidence that the entire unattended production chain already works.

`prepared/app`, recovered evidence, the old local project and `web-candidate` were not modified. `direct-runner.patch`, `validation.json` and `typecheck-result.json` describe the reviewable candidate.
