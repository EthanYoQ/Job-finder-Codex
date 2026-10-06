# JNJ offline test source increment

Five unchanged test, package/lock, and installer source files, 28,913 bytes. Source inventory SHA-256: `f67a6e84ae0f0ab421f47620196a1cb144dcc278bf7829f7ae68c5df8eb3448f`. Verify SOURCE_BACKUP.json and SHA256SUMS before restoring.

Keep the two .mts files and installer beside dependencies/. Restore the fixed producer42 source/TypeScript loader and the [native-URL candidate delta](https://github.com/EthanYoQ/Job-finder-Codex/tree/1860ec8dbce576a372e081f376178aa687cd2b51) at the sibling paths used by the scripts. The scripts also require separate reader source closures under readers/a775/src and readers/db56/src; preserve each role's repository, domain, receipt, and cache imports.

Reuse the native synthetic fixture, SHA-256 `6d8e76eafeb4c009233b7d54cc1e380b3b2e7cac9ffb858a448c04333fda9fc6`, and the [safe base source](https://github.com/EthanYoQ/Job-finder-Codex/tree/0c4586b82690203b93475551bd3409e2fbcb1574) entries tests/helpers/portablePublicSnapshotFixture.ts (`581e1cd2c0f2f0d50b95d18b1fdbe5a711274ca0287ccac795165cc21356f931`) and package-lock.json (`3f45f2db3f910be83bb57630db121a175b0375fe216a2fa110cab99ec149fae9`). These prerequisites are not duplicated here.

Use Node.js compatible with the restored producer package. The test dependency is pinned to @electric-sql/pglite 0.3.14 with registry URL and integrity in the included lockfile. The installer is a non-executable source file; its explicit invocation is bash install-test-dependencies.sh. Package contents, npm caches, generated result files, runtime identities, real observations, and database exports are excluded.

No packages, SQL, or tests were run for this backup. These test sources do not apply a production migration or establish live validation. The original longer README is omitted in favor of this dependency summary.
