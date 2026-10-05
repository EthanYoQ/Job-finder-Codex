# Bayer single-batch publication review helper

This source-only snapshot preserves `hosts/bayer42/runtime/review-bayer-20261005T0022Z.py` exactly as supplied: 5,901 bytes, SHA256 `6a33258442ac03cee4d40bba5b9a638b877733a7f2ee9749f702270927174ab1`. It is an external host helper with no original Git commit and does not change registered producer42 (`fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`) or the deployed web runtime.

Compared with the [previous Bayer reviewer](https://github.com/EthanYoQ/Job-finder-Codex/blob/ae035716dd52bde303bc9d444e350e588e01e3d2/hosts/bayer42/runtime/review-current-bayer.py), only the expected independent observation timestamp and artifact SHA256 changed. The old file's exact Git blob was verified against that archive; it did not already contain this new file. Review logic, source/database qualification and the collector are unchanged.

This helper is specific to one batch. Its expected timestamp, artifact hash and counts must be established from that batch's actual evidence before review. The 32 raw, 30 CURRENT and 2 officially paused assertions are manual review expectations for the observed batch, not a collector quantity target. Do not reuse these expectations for a later batch without reading and checking its new evidence.

The implementation handoff reports Python syntax and the complete publication review passing, atomic publication at 00:23:32 UTC on 2026-10-05, and public verification of the new batch at 00:44:37. The backup checked the exact two-literal change, byte hash and credential patterns; it did not execute this script, read the batch inputs or rerun tests. Operational outcomes are attributed to the handoff, not independently established by this backup.

Only this source file and two backup metadata files are included. Actual SQL, requests, database/context, artifacts/raw captures, configuration, credentials, environment and internal logs/reports are excluded. Reproducing the review requires separately authorized evidence and host configuration. The script writes review output when executed; archiving it is not permission to run it.

The tree contains no workflow definitions. This independent backup branch performs no CI, merge, deployment or default-branch update. SOURCE_BACKUP.json records exact provenance and recovery limits.
