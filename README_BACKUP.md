# Sanofi rebuilt publisher source backup

Actual frozen source Git commit: `7783b73e9f56b3d181a64b74288a714116bbf150`. This source has a new root commit, with no Git parent. The historical `46beb14fcca2dd05854f45781abbc1b43da90ea1` identifies provenance only; neither its old Git graph nor its registered runtime identity was restored.

This is the paired Chinese Sanofi publisher logic from the previously reviewed 46beb14 source, restored under a new actual Git root. It must be matched with a compatible reader and a freshly qualified publisher runtime before a new publication.

## Status and paired roles

The reconstructed source/package manifest was frozen at 2026-10-06 00:27:57 UTC (SHA256 `2a28ef4cbfab3c48125627156c47778b6d75c93806163931a7d9de1a0a2f7b36`). At the subsequent 01:10 UTC handoff all three roles remained unregistered and undeployed; production web was still a775. This archive does not constitute target-runtime or production acceptance.

Paired actual source identities:
- Publisher: `7783b73e9f56b3d181a64b74288a714116bbf150`
- Main web: `b60390477578be18d0f4319eb2a3db888c4fcb17`
- Compatible fallback: `a38cbeb014d6ce3d7648218d8d4a96264ae42bf8`

The original a775 and protected legacy 3031 reader verifier modules reject the new paired Sanofi B packet. The compatible fallback is separate; preserving 3031 does not make it a compatible reader for newly published B data. Any deployment/registration/capture remains a separate authorized qualification step.

## Verification limits

All selected source files match previously reviewed private GitHub objects by path, mode and Git blob. No application-source bytes were added or changed by reconstruction. The reported local application TypeScript checks and all three Vite builds passed. Main historical transition 51/51 and fallback transition 53/53 were reported passed; the private actual old-88 context used for these checks is excluded and is not an archived original fixture.

Full CI has not passed. The local main full-repository type check has seven inherited test diagnostics. Publisher's corrected broader local run reports 180 passed, 2 failed and 50 skipped: the failures are inherited policy-count and Qilu owner-ID expectations. Optional retained replay/PGlite inputs were omitted or unavailable, not replaced with fake live evidence. Main broader tests reported 215 passed/1 existing skip and static/UI tests 94 passed; fallback broader tests reported 245 passed. These overlapping groups must not be summed as unique test totals. This backup did not rerun source/tests or GitHub CI.

A local dependency-cache packaging difference was corrected in the independent candidate copy. The publisher reports all three final archive round trips matched their recomputed local source/runtime identities. Those results cover local Linux x64 Node 24.19.0 only. Actual Ali Node22/OS/native-engine compatibility, dependencies and runtime identity still require target verification. No node_modules, built runtime archives, local build-identity files or private diagnostics are uploaded here.

## Exact scope and recovery

This role contains 857 safe source files, all reused without byte changes from [its prior safe snapshot](https://github.com/EthanYoQ/Job-finder-Codex/tree/d72a0b38924c939dc92d88c4833ad62ccf705e59). The current Git tree has one additional tracked `RECOVERY_SOURCE_IDENTITY.json`; it is excluded and replaced by the narrowly scoped mapping in `SOURCE_BACKUP.json`. The backup Git commit is distinct from the actual frozen source Git commit.

The filtered reconstruction omitted seven files that existed in that prior safe snapshot:
- `backup/disabled-workflows/production-image.yml`
- `ops/run-fixed-cohort-qualification.sh`
- `tests/db/emptyDatabaseMigrationVerification.test.ts`
- `tests/ops/deploymentConfig.test.ts`
- `tests/ops/formalQualificationRunner.test.ts`
- `tests/ops/opsBootstrap.test.ts`
- `tests/readiness/p0StagedReleaseCandidateCli.test.ts`

Those omissions are preserved rather than silently reintroducing files absent from the new source Git object. They affect historical operation/qualification and some test workflows. Recovering them, if required, would be a separately reviewed source change. There is no active GitHub workflow in this backup branch.

Previously excluded raw/retained job fixtures, real DB context and reader inputs, operational evidence and internal notes remain excluded. Credentials, environment files, actual configuration/registration/runtime identity, generated dependencies/builds, artifacts/private package directories and original history are not included. Necessary exact nonsecret source-policy/receipt hash pins and synthetic fixture source remain unchanged.

The source archive alone does not supply missing retained inputs, matching runtime dependencies or target registration. Rebuilding a source tree does not recreate an old runtime identity. Obtain and verify authorized dependencies and fresh target evidence before any use; this backup does not merge, deploy or alter the default branch.
