# Publication review and preparation simplification

Inactive four-file candidate, based on external 0838 commit 32fa560c0fe45d62289861610aeab7ec518bc774 and actual native 110/ac70c21b686c498c4c6a28dbe5bd0f423922d140. No active files or native source changed.

## Actual removed work

1. prepare-original-source.py returns config/control/binding by reading its actual successfully written files. run-original-functions.js consumes this existing command's JSON output instead of three additional cat/exec round trips. Existing sourceId/candidateId/bindingSha256 remain. Each prepared source saves three tool/process round trips (up to108 if all36 routes prepare). Existing binding files and subsequent identity verification remain. Returned objects contain source/config/build/candidate/database-identity metadata, not authentication credentials.
2. original-portable-reader-replay.mts indexes decoded table rows, prior jobs and visible members once using simple Maps/Sets. Repeated per-job find/findIndex/includes scans are removed, while original assertions, field hashes, both reader runs and artifact outputs remain. First-match semantics are retained. No new wrapper or framework.
3. original-portable-sql-review.mts derives its immutable review plan once outside verifyFullBody. The exact existing compiler, SQL parser, byte equality and six negative cases remain. On the real Bayer packet this removes five repeated direct plan constructions:6→1, not7→1, because the trailing-SQL case already failed before construction. Internal compiler calls are unchanged. Twenty-one unused imported names were removed; emitted runtime imports are identical, so no runtime import-speed saving is claimed.

## Evidence

- Real saved Hengrui996 and Novo37 packet reader outputs are fully equal before/after, including both reader result objects and diagnostics. Fixed historical clocks are test-only and confer no publication eligibility.
- Hengrui separate fresh processes:1584ms before,1428ms after, one local historical sample. This is supporting observation, not a guaranteed latency improvement or percentage claim.
- Real saved Bayer2,967,708-byte SQL: both accept original, reject all existing six negative cases, and decode identical rows matching the saved historical packet. The local test extracts the actual compiler/parser/verifyFullBody scope. It does not claim current candidate identity or full live-publication verification.
- prepare portable/A cases return exactly their actual persisted three objects; a preparation error produces no success JSON. Existing automatic-relay tests pass:36 routes, single dispatch, unknown/expiry hold, failed-source isolation, successful context binding and uncertain producer stop.
- TypeScript transpilation, entry syntax and diff whitespace checks pass. Four production files,16 inserted/25 removed lines, net9 fewer. Runtime work reduction is the goal, not line percentage.

## Preserved scope and rejected deletions

No changes to source scope, locks, delta writes, unknown-outcome read-only reconciliation, deadline/receipt requirements, or admission gates. Packet/raw process isolation stays because it protects memory and failure sequencing. Duplicate request archival was not changed: moving it could lose evidence on expiry before the child starts.

Backup whitelist: four files in changes.json, fix.patch, manifest.json, README.md and verification-summary.json. Do not upload real packets, original contexts, snapshots, or entire verification directories. Original private GitHub backup/readback is required before the parent enables this candidate. No activation is performed here.
