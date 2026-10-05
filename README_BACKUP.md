# Exact commit and public round readback helpers

This independent source-only snapshot contains two external operational helpers and their exact byte hashes. They have no original Git commit and are not part of the registered producer42 source/runtime identity. The reported producer remains `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`, and the reported web remains a775 on port 3036.

- `host-runtime/complete-reviewed-source-readback.js`: 4,585 bytes, SHA256 `1615b0f5b5e74cb9d02ec37e5201d7a10deacf7d6bc9b017ed30bc2abbe576a9`
- `public-readback-exact-round.py`: 3,539 bytes, SHA256 `87b2418bc7f9adc15b562153440179e88d0a37ffe8da772be14baa852a226b75`

The JavaScript helper requires the original process's actual zero exit and performs SELECT-only database readback against the reviewed source/batch, commit state, counts, hashes, empty formal holder and successful observation. It then saves local summaries and updates local publisher bookkeeping. Its pending-state branch supports an already recorded read-only terminal wait; it does not bypass the actual-zero-exit requirement or authorize another database write.

The Python helper reads already saved public search/coverage responses and exact local completion records. It checks source-result identity, current counts, coverage health and observation time, then writes local verification records. It does not fetch network data itself. This file contains a date-specific round selector and historical paths; review them before use for another round.

## Review and reported use

The handoff reports use of the exact commit helper for the first three completed sources and public verification of 17 batches / 1,259 jobs by the validator. At that handoff the pending-read-only-terminal branch had not reached an executed terminal result; it is not claimed to have been exercised successfully.

Static backup review found that the initial Python UTC parser discarded negative timezone offsets. Before upload, the author corrected only the parser: naive timestamps receive UTC, and aware timestamps are normalized with astimezone(UTC). The author reports four equivalent-instant cases (Z, negative offset, positive offset and naive UTC) plus one unequal case passing. The corrected source is included; the earlier version was not uploaded. The author reports the existing 17-batch inputs were Z or naive UTC, so that specific defect did not change those results. The backup did not read the actual inputs to independently establish this.

Both files were read repeatedly, fixed by SHA256 and Git blob hash, and inspected for credential patterns. No secret findings were identified. No helper, database query, collection, test or CI was executed by this backup. These checks are not a full correctness certification.

## Recovery boundaries

Only these two source files, this README and SOURCE_BACKUP.json are included. Actual SQL packets, requests/responses, real database/context, public JSON, raw captures/evidence, local publisher/completion state, internal logs, credentials and environment are excluded. The helpers require separately authorized exact evidence and current host/session bindings before invocation. Both can write local state/reports; their archival is not permission to execute them.

There are no active workflow definitions in this tree. This backup does not merge, deploy, update the default branch or alter registered production identities.
