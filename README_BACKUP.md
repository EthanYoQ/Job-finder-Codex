# Amgen fixed two-chain offline candidate source backup

Exact source commit: `e5a2a01836fa16669a88fa2604a6ca1a007939fe`; direct parent: `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`.

At the 2026-10-05 22:45 UTC handoff this was a clean, frozen offline candidate: not registered, not used for a new live capture, and not deployed. The regular C46 producer and a775 website remained the publisher-reported active versions. No CI, merge, deployment, database operation or source execution was performed by this backup.

## Change and verification scope

Only `src/crawler/amgenManualWorkdaySourceFetch.ts` and `tests/crawler/amgenManualWorkdayConcurrency.test.ts` differ from the frozen parent. Detail collection uses exactly two ordered chains: each native detail must reveal its actual Req before the corresponding Workday detail is requested. A failure stops further dispatch and waits for the in-flight peer. Captured artifacts preserve completion order while projected jobs and the binding report preserve source row order.

The strict replay validator accepts legal two-chain completion interleaving, checks each native-to-Workday pair, and keeps the original 600000 ms window, source scope, request/identity bindings, full denominator and byte limits. The previous 790663 ms failed capture remains out of bounds; no time window was relaxed and that original capture is not included. Replay checks completed responses and pair ordering; it does not independently attest the precise worker dispatch schedule from completion records alone. The running implementation enforces the two-worker cap. Some artificially reordered same-millisecond streams can satisfy response checks without being a schedule this implementation would emit.

The publisher reports 56/56 targeted tests across three files and the related type check passed. Full-project type checking still has 13 unchanged baseline diagnostics. This is not a full-suite/CI pass. The new test uses generated fixture IDs, HTML and Workday JSON; no captured jobs or actual failure records are embedded. This backup independently reviewed the two-file diff and synthetic helper provenance, checked exact Git blobs and source hashes, and verified the GitHub tree.

## Issuer and reader compatibility

Fresh capture and receipt issuance must use the same new source tree. The old fb0 issuer does not accept the new interleaved artifact order. A future runtime requires its own matching identity, registration and fresh authorized capture; the backup Git SHA cannot be used as the original registered identity.

The publisher reports isolated checks of the exact archived a775 and db56 public A-receipt reader entrypoints: a synthetic receipt issued by the candidate is accepted and a hash mutation returns HOLD. Those checks do not establish live database/public reader compatibility, deployment readiness or rollback permission. No web-reader source change is part of this candidate.

## Contents and baseline mapping

This filtered snapshot contains 851 source files. The 850-file safe producer41/b41 baseline was compared path-by-path with the restored fb0 parent: every original source path, mode and Git blob matches. This candidate reuses 849 unchanged safe source blobs, replaces one collector file and adds one synthetic test. The prior safe archive is [producer41 source backup](https://github.com/EthanYoQ/Job-finder-Codex/tree/0c4586b82690203b93475551bd3409e2fbcb1574).

The restored fb0 parent has a new Git root; byte equality with b41 source does not restore the old Git graph or runtime identity. `SOURCE_BACKUP.json` maps every included file back to the candidate Git object, records SHA256/mode/bytes and lists the exact tracked exclusions. Package locks, schema/migration source, application code, normal operation scripts and synthetic tests retain their original bytes.

The production workflow source is retained as `backup/disabled-workflows/production-image.yml`. There is no active `.github/workflows/` entry in this backup and the branch is not an integration/deployment branch.

## Recovery exclusions and limits

The candidate tracks 893 files; 42 tracked files remain excluded under the existing source-only policy. They include retained official-page/job fixtures and capture packages, release/capture evidence, internal recovery/runbook material and the historical certificate file. Credentials, environment files, actual database/control/reader inputs, failure originals, raw pages, generated dependencies/builds, runtime identity and the original local Git history are also excluded.

Some existing tests require retained fixtures that are deliberately absent. Recover those separately through an authorized private evidence workflow before running such tests. Restore dependencies and Prisma output in an isolated authorized environment and validate the exact candidate before any production use. Do not infer a successful new capture, full CI result or reusable runtime identity from this archive.
