# Incremental job projection candidate source backup

Frozen source cutoff: 2026-10-06 18:40:05 UTC. This is a three-role source increment, with exact patches and synthetic test support. It is not a full application or registered runtime backup.

## Restore the correct baselines

- Producer: safe source [0c4586b](https://github.com/EthanYoQ/Job-finder-Codex/tree/0c4586b82690203b93475551bd3409e2fbcb1574), then the nine-file deadline source overlay [3687335](https://github.com/EthanYoQ/Job-finder-Codex/tree/368733577fe5a3d395393c6464fc23eb3fa99c80). This preserves the relevant bytes of the 47b74924 baseline; it does not reconstruct the original full Git/runtime identity.
- Main reader: the 966-file safe [6f82160](https://github.com/EthanYoQ/Job-finder-Codex/tree/6f82160f209ac4556da8578a85de7da9ffc3ff41) source snapshot.
- Compatible fallback: the 963-file safe [a6ced57](https://github.com/EthanYoQ/Job-finder-Codex/tree/a6ced5737df2b4ebc4800fa547c874e79ad6a41c) source snapshot.

Apply each exact patch once at its matching baseline root. Alternatively overlay the role's source files and explicitly perform the deletion below; do not apply the patch again after overlaying. SOURCE_ROLE_MAP.json distinguishes actual producer ancestry from the two rebuilt web Git roots. The 62 original files remain byte-for-byte unchanged.

## Required deletion and schema boundary

The producer patch deletes prisma/migrations/20261002103742_lilly_source_policy/migration.sql from the executable migration chain. Its copy under contract/unapplied-source-only is source preservation only and must not be copied back into active migrations. Its historical introductory comment does not mean this backup imports capture data.

The new projection migration requires the precise SQL48 baseline and its guards. It has not been applied by this backup and is not an idempotent migration for arbitrary databases. The older a775 reader and original rollback reader do not understand the new receipt wrapper; the supplied main and compatible fallback changes are a required pair.

## Dependencies and limits

Keep the producer/web-main/compatible-fallback/contract layout and restore dependencies from DEPENDENCY_REQUIREMENTS.json. The PGLITE_MODULE dependency and explicit test-only SHA256 adapter are required for the in-memory tests; missing PGlite can skip that test group. No installed dependencies or binaries are included.

publisher-generated-fixtures.json contains generated synthetic scenarios. SQL_FUNCTION_FINGERPRINTS.json contains schema definitions and fingerprints from a synthetic in-memory environment. Neither is a backup or acceptance record of production data. Fixed public source identifiers and non-secret policy hashes remain in the original code.

This backup excludes actual database/capture data, runtime controls, activation state, credentials, logs, reports and workflows. It does not establish full CI, registered runtime identity, native PostgreSQL/pgcrypto or multiple-backend acceptance, measured physical I/O savings, or deployment readiness. Backup validation checked exact patch reversal/application, baseline Git objects and remote source bytes; it did not execute application code, tests, migrations, CI or deployment.
