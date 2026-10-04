# Sanofi Chinese candidate source backup

This source-only backup records reviewed candidate `d402d3639c0ea729fa72bd1a4427570b227c7481` at 2026-10-04 09:20 UTC. It is **not deployed, registered, freshly captured, or published**.

The candidate starts from reconstructed baseline `2397e134834ba9f3c89e22ab392e403a42702407`, whose source provenance is the earlier Chinese Sanofi candidate `98293f68d1054f6760af60435a6932c6ccf0d1ee`. The original Git graph was not recovered. This GitHub commit is a separate safe backup identity.

## Source scope

856 unchanged source files from the candidate are retained: collector/application source, package lock, Prisma schema and migration source, operational scripts, and tests. Every source path, Git blob, file mode, byte count and SHA-256 is recorded in `SOURCE_BACKUP.json`. Existing reviewed source blobs are reused from the producer41 backup; 19 source paths differ from that checkpoint.

The new Sanofi path uses the Chinese official list and matching requisition on the Chinese native application site for body, location and open/closed status. The latest repair independently reconciles complete persisted grade-B loss rows in both portable and DB_STARTED atomic SQL routes.

The reported bounded local verification passed 5 selected tests. Both SQL routes passed positive cases and rejected six loss-row mutations each. All 48 migration checksums and the existing SQL guard were checked. This is synthetic local SQL evidence; no full suite, TypeScript check, fresh acquisition, concurrent publication, or production qualification is claimed.

## Recovery boundaries

45 tracked non-source/evidence files are omitted, including raw or retained job-body fixtures, historical evidence manifests, operational notes and recovery reports. Credentials, all environment files, database payloads, private profiles, uncommitted changes, dependencies/build output and original local Git history are not uploaded.

In particular, `tests/fixtures/sanofi/chinese-native-semantics-20261004.json.gz` and `main-identity-semantics-20261003.json.gz` retain lengthy job descriptions despite their semantic-fixture names. They are excluded. The three real-page Sanofi regressions and any other tests using excluded retained fixtures need those inputs supplied through a separately authorized recovery. Synthetic Sanofi tests remain in source.

Workflow source is moved to `backup/disabled-workflows/`. This backup branch does not run CI or deploy. Restore pinned dependencies and verify in isolation before using the code; a future build needs its own runtime registration.

## Current producer context

Registered producer42 uses reconstructed Git root `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`. All 850 source files included in the existing producer41 GitHub backup were compared and are byte/mode-identical to that reconstruction, whose original code provenance is `b41a18415cfe8177740918b04c5139095d7abcc5`. Producer42 is not this Sanofi candidate.

The default branch remains the separately CI-verified merged source `a536b80d4a0bda2196b29fac1991dcb610ae62b5`; no merge or deployment is performed by this backup.

