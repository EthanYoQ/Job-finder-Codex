# Archive single read, inactive

Based on external module 1303, canonical 50376672c07ac435431908d98d913a193e6503ff. Native 111 is unchanged. Only the two files in after/ are runtime changes. Parent/root owns backup and activation.

## Change and consumer

- original-portable-sql-review.mts:131–132 formerly read the full original archive, decoded it to UTF-8, parsed JSON, and checked only schemaVersion, the four-field source tuple, and archive-file count against decoded EvidenceArtifact rows.
- Those exact three conditions now run immediately after the existing raw archive parse in replay-original-json-archive.mts:5–6. The generic SQL phase no longer loads this original archive. Specialized Hengrui/Biogen packet gates are untouched; no source-specific BI code or native code is edited.
- review-original-publication.mjs:13–16 retains packet/readers → raw → target sequencing. It throws on any child failure. run-original-functions.js:4 and :79 require the complete wrapper's exit 0 before returning the review result. Normal publication still runs every original check before dispatch.
- No other production caller of reviewOriginalPortableSql or this raw CLI was found in the active module/offline-checkers/controller scan. Historical checks and host-session.test.mjs are non-production consumers.

## Observable phase change

Explicit packet-only and packet-only-sql-selftest now defer archive existence, JSON syntax, schema, tuple, and file-count checks to the raw stage. They can produce a packet-only PASS without a valid archive; their sourceRawReplayPending field remains true. On the normal path, reader reports can be written before a malformed archive fails raw review. The wrapper still fails, target projection is skipped, and publication is not dispatched. This is an ownership/phase change, not a claim of identical standalone packet-only behavior.

## Evidence and limits

- Existing real Novartis run dot-auto-novartis-20261018T123719665Z: 8,959,100 archive bytes, 169 jobs. Complete old/new raw replay reports are byte-equal to each other and the saved historical report.
- Three narrow negative checks (schema, source tuple, file count) execute the exact old/new guards; each version rejects each case. Mechanical source comparison proves there are no other owner changes. TypeScript syntax diagnostics: zero. Diff whitespace: clean.
- Normal generic full archive reads/parses fall from 2 to 1. Existing Sanofi archive size is 78,780,814 bytes (75.13 MiB); it was only stat'ed, not replayed in this batch. No timing or peak-memory benchmark is claimed.
- Full current SQL release identity/deadlines were not rerun against expired historical requests. No new real capture, network request, SQL execution, database write, native edit, or activation occurred. The old raw command's exit code was not retained, but its complete PASS report was written and matches both outputs. The new command exit is 0.

Verification uses copied historical decoded input and symlinks to original artifact directories and unchanged helper modules. No original evidence files were edited. The symlink inventory is retained separately.
