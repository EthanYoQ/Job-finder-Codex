# Offline JNJ native-URL source delta

This backup contains 11 frozen changed/new source, migration, test, and configuration files (93,858 bytes), plus their exact candidate.patch (84,214 bytes). Patch SHA-256: `9bdb3bf2d18349b74d65298866f13a07f323cf19d39945c010bf7d6c4b2e3652`. Verify SOURCE_BACKUP.json and SHA256SUMS before restoring.

The source is an uncommitted delta against reconstructed base `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`; this backup's Git commit is not a new producer identity. Restore the corresponding [previous safe base source](https://github.com/EthanYoQ/Job-finder-Codex/tree/0c4586b82690203b93475551bd3409e2fbcb1574), subject to that snapshot's exclusions, then overlay these files at their listed paths. The full base is not duplicated here.

Dependencies include the base package/lockfile and Node.js/TypeScript test dependencies. Reader-compatibility tests additionally import separately restored reader source trees at the relative paths present in the test file; those trees are not supplied by this delta. No runtime configuration, generated identity, raw capture, database content, internal reports, or credentials are included.

The proposed SQL49 migration is unapplied source. The candidate is offline and undeployed; it cannot independently replace the SQL48 registered runtime identity. This backup does not apply a migration or claim PostgreSQL, full-suite, or deployment validation.
