# CSPC publication-context refresh source backup

This is a small, exact-byte source backup for the CSPC C46 external host. It is not a producer release or a registered runtime image. The backup branch does not run CI or deploy anything.

## Version and status cutoff

- Review snapshot: approximately 2026-10-05 21:47 UTC. The preserved `Review-only` source comment describes that review-stage snapshot; it is not a current activation flag.
- Publisher-reported activation: 2026-10-05 21:51:16 UTC, replacing only the CSPC host helper. Producer source `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d` and its C46 registered identity were unchanged.
- At this handoff, there had been no new capture with the enabled fix. The previous failed round was reported as 31 captured items and zero database publication; it was not replayed. Neither activation nor the local tests establish a successful new capture.
- Corrected helper SHA256: `643fd7fdb699bb0c2be0814a000006ad40437e41b896ba9d62c6b51d116d0511`.
- Original helper SHA256: `d9969b3bddbe628de14a870ae55ea2be1edbc40ee57a6610e635f63f83426712`.

The original host source and related dependencies are preserved in [the preceding host backup](https://github.com/EthanYoQ/Job-finder-Codex/tree/fccc397f6abb90c0f980af63bcc1d3cb469aac59). This new GitHub commit identifies the sanitized archive, not an original source Git commit or registered runtime identity.

## Behavior and checks

Only `READ_PUBLICATION_CONTEXT`, with the exact fixed compiler-produced SELECT, source/config and candidate binding, may perform one extra read in the same live handler when a valid snapshot became stale during transport. The exclusive dispatch marker, original request bytes, original dispatch/expiry deadlines, and actual database timestamps are retained. Malformed, future, pre-attempt, mismatched, SQL-error and transport-error responses do not trigger a retry. Publication and lease writes remain single-dispatch.

The publisher reports 13 synthetic local tests passed. They exercise normal/stale reads, second stale results, deadline exhaustion, errors, exact query and identity checks, request mutation and write no-retry behavior. This backup only reviewed frozen bytes; it did not run tests, CI, SQL, capture or deployment. Later scheduling or file delivery can still cause the producer's 60-second freshness gate to reject a result; this is not a guarantee against delay. Dispatch deadlines prevent a new dispatch but do not cancel an SQL call already in progress; final producer validation remains necessary.

`fixed-read-fixture.json` contains the exact nonsecret query and code-binding constants, including the project reference, workspace paths, source hash and candidate ID. The test harness produces synthetic response rows with empty `jobs`; no actual database rows, observed job content or runtime credential is included. The query is a read-only SELECT, not a captured publication request.

## Contents and recovery boundary

Five source files are preserved without modification: corrected helper, exact original helper, synthetic test, fixed-query fixture and exact unified patch. `SOURCE_BACKUP.json` binds each to SHA256 and Git blob SHA; `SHA256SUMS` also covers the new README and manifest.

For source recovery, restore the matching CSPC host dependencies from the preceding safe host archive, then place `cspc-context-refresh/host-helper-functions.js` at that archive's `hosts46/cspc/host-helper-functions.js`. The original helper is retained for an exact byte comparison. The included patch records the same transformation, using its original review-stage paths. The test file and fixture expect to remain adjacent to the corrected helper.

A usable live host still requires separately authorized local configuration, matching producer/dependencies, relay context, registration, and fresh evidence. Those are not reconstructed by this source-only archive. Fixed paths and exact safety bindings must be reassessed explicitly if restoring in a different environment; do not generalize the narrow SELECT retry or bypass identity/deadline checks.

Excluded: original `ACTIVATION.json`, `RESULT.json`, `REVIEW.md`; real requests/responses, SQL publication packets, captured pages/jobs, database/control state, runtime identity files, credentials, environment files and internal operation reports. No live run or capture directory was scanned.
