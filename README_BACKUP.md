# Sanofi public-reader candidate backup

Source checkpoint: `43c53a6262e4c94c1fd84fbf8418d4a3064f01a6`, frozen at 2026-10-04 10:30 UTC. **Prepared and reviewed; not registered, newly captured or deployed.**

## Contents and provenance

This backup retains 957 unchanged source/assets/test/config files plus this guide and `SOURCE_BACKUP.json`. Every included source file has its original path, Git blob, mode, byte length and SHA-256 recorded. Workflow source is relocated under `backup/disabled-workflows/`; no active workflow is present.

The restored local baseline is `6085e424957f6e1b06e2b2844d23d88994eb7ded`. Its source provenance is the prepared performance candidate `a789e0db617fcd204eca2101f4a6c5669a6c25da`, based on `a2bbb88dd4817da17493a62f9f530d2fb7dece9a`. The original Git history was not restored. The backup has a separate Git commit identity and cannot reuse an existing runtime registration.

The 18-file application change contains the Sanofi Chinese-only reader dependency closure and the narrowly pinned historical public receipt exception. Its dependency origin is the previously backed-up candidate `d402d3639c0ea729fa72bd1a4427570b227c7481`. It preserves the prepared performance behavior, exact historical A88 verification pins and continued prohibition on ordinary Sanofi A issuance. No producer SQL/runtime or UI change is mixed in.

## Verification state

The implementation's reported checks passed 223 targeted tests in 10 files, followed by 109 affected tests after the final change. The transition suite has 42 cases. All 23 changed/new TypeScript files passed isolated syntax transpilation, and read-only review found no blockers. This does not establish a full semantic typecheck, complete test suite, frontend build or production qualification.

## Recovery limits

33 tracked files are excluded: raw/retained capture fixtures and evidence, actual database context/control records, internal diagnostic/recovery notes and certificate material. Credentials, environment files, private profiles, generated dependencies/builds, uncommitted work and local Git history are excluded.

Specifically, `tests/fixtures/sanofi-historical-public-context.json` contains a real database projection with 88 jobs, 176 lifecycle members and a historical result/receipt. It is not included. The transition test suite cannot run fully from this backup without separately authorized recovery of that fixture. Other retained-evidence tests have the same boundary. Synthetic test code remains intact. The small non-secret exact receipt pins and static verification-only plan required by application behavior remain in source.

The original prepared web backup supplies unchanged frontend assets, fonts and logos; they are reused without re-uploading. This branch is a recovery checkpoint only. It does not run CI, merge into the default branch or deploy. Live web remains separately managed at the a2 source checkpoint.

