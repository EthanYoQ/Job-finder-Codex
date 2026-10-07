# Hansoh / Fosun C51 r4 safe source backup

This is a complete snapshot of the 69 reviewed, unbound host/owner source and template files, plus the exact synthetic test sources and their small synthetic fixtures. It preserves the final SQL guard and terminal-scope repairs. It is not a complete producer, installed runtime, live binding, database backup, or permission to launch.

## Verify and reproduce offline

1. Run `python3 verify-snapshot.py` from this snapshot. The manifest freezes every delivered file except itself by byte count, SHA-256 and Git blob identity.
2. With already available Node.js, Python 3 and Bash, run `python3 run-offline-tests.py --destination /an/authorized/new/test-directory --node /path/to/node`. The destination must not exist. This creates only an isolated test copy. It changes absolute paths in that copy and regenerates the three derived synthetic owner pins. Original payload and test sources remain unchanged.
3. Inspect the resulting TAP output. The expected offline suite is 683 tests, zero failures and zero skips. SQL, source HTTP, tool replies and terminal state in these suites are in-memory stubs. The inert wrapper test uses only a local child. This does not prove any live platform session, publication, candidate registration or installed runtime.

The seven synthetic-test files are saved directly, so restoring this snapshot does not require a previous Novo/r3 workspace or its fixture generator. `R3_TO_R4_SOURCE.patch` is provided as exact change provenance; full final payload bytes are authoritative. Do not apply it blindly to an unknown host.

## Applying to the existing base, only after separate authorization

The payload is tied to producer commit `28402a299bb04cbf5873da66c2fe8ca76827c0d1` and the absolute runtime roots recorded in its source. Preserve `hosts/<source>/{host,supervision}` and the named `owner-adaptations` directory together. Its source pins and templates preserve the original C51 mapping, source/config hashes and build-identity expectation. The producer and its dependencies are not included here.

Verify the exact producer, package/lockfile, physical dependency tree and installed Node v22.23.3 profile through the existing recovery contract before any operational restoration. The source-level C51 increment is separately preserved at [commit 5820ceb](https://github.com/EthanYoQ/Job-finder-Codex/tree/5820ceb6f1d9b329e11f3619f7bb3156b19f7079); it is not a complete runtime and itself depends on earlier source layers. Do not replace missing files with guessed versions or treat these build hashes as a newly computed physical identity.

The packet reviewer and source binder require matching producer compiler/runtime files and their transitive dependencies. `generate-context.mts` and `verify-context-recovered.mts` preserve the original compiler-based template verification and expect this directory under `<runtime>/verification/<preparation>` with producer at `<runtime>/producer`. Run them only offline against the exact base with the matching source-selection environment. They are not part of the self-contained 683-test suite.

Before controlled installation, require an empty/fresh destination and no active owner/capture. Do not overwrite an existing bound host or clear a launch hold. Independently verify all source bytes, then generate fresh source-specific candidate/database bindings and matching context/loader/starter hashes through the existing reviewed process. The included control and owner-binding templates deliberately have null candidate/database identity. Unbound loader and starter fail closed. Never copy historical activation, control, nonce, run, request or uncertain terminal state.

This C51 owner must not be installed as a Novo C59 adapter. Preserve the 12-hour due gate, original wrapper deadline, 384 MiB heap, 45-second HTTP limit, distinct batches and serial publishing. A late guard refusal retains prior markers; it does not establish rollback or global zero writes. UNKNOWN and no-retry semantics remain in force.

## Data boundary

Included: reviewed source, static unbound templates, public official URLs/source configuration, static code hashes and filesystem paths, synthetic tests, recovery scripts and a non-sensitive review summary. Excluded: actual activation/control/binding objects, nonce/run payloads, real SQL requests or query results, original test or runtime logs, private evidence, credentials, runtime binaries and dependency directories. The review package archive and raw reviewer report are not uploaded. `REVIEW_SCOPE.json` records their source-manifest/review hashes and the scope of the offline conclusion.
