# Job Finder source backup

Source revision: `a789e0db617fcd204eca2101f4a6c5669a6c25da`

State at 2026-10-04 03:20 UTC: **TESTED_NOT_DEPLOYED**. This is a source-only backup. It does not deploy, change the live database, qualify a release, or retain the original runtime commit identity. The backup commit is a new, different commit.

## Contents

Application and server/collector source, package lock, Prisma schema and migration source, configuration templates expressed as code, operational source, tests, and runtime image/font assets where present. `SOURCE_BACKUP.json` records every included original Git blob, SHA-256, mode, and source path. Included source bytes are unchanged.

## Recovery limits

Credentials, all `.env` files, raw captures, retained capture fixtures, database payloads/personal records, internal notes/conversations, uncommitted work, generated dependencies/builds, and original local Git history are excluded. Tests that require excluded retained evidence need that evidence supplied separately through an authorized private restore. No full test/build pass is claimed by this backup. Install the pinned dependencies, regenerate Prisma, and verify in an isolated recovery environment before any use. Do not replay historical migrations or reuse old capture/runtime identities merely because source bytes match.

GitHub Actions workflow source is retained under `backup/disabled-workflows/`; there is no active `.github/workflows/` in this backup. This branch is for backup and must not be merged or deployed automatically.

The live homepage source is a2bbb88; the separately backed up performance candidate a789e0d is tested but not deployed. Producer40 source is 507e40b. Unfinished Sanofi Chinese-only and portable DB_STARTED changes are outside this cutoff.
