# CSL and CR unbound source recovery

Preserves 121 exact reviewed source files plus this note and a hash index. Historical logs, execution results and redundant inventories were removed. Source code was not executed for this backup. No workflow is included.

Restore the original relative layout beneath the fixed root named by RESTORE_DEPENDENCIES.json, in an isolated environment. The recipe reads 27 pinned seed files from that root; --output-root only changes its output destination. Ten owner dependency files (five per host) and their hashes are included. Seed entrypoints and owner.test.mjs are generation inputs, with historical Amgen/AbbVie names; do not run them as standalone hosts or wildcard test suites. Targeted generated CSL/CR owner suites and key/preload tests need the external project dependencies.

Producer commit 28402a299bb04cbf5873da66c2fe8ca76827c0d1, its parent source, lockfile/physical dependencies, Prisma and pinned Node 22.23.3 remain separate prerequisites. Safe source references begin at https://github.com/EthanYoQ/Job-finder-Codex/tree/5820ceb6f1d9b329e11f3619f7bb3156b19f7079 . This branch does not restore original Git/runtime identity by itself. External producer transitive inputs, including schedule authority, require separate verified recovery.

Keep candidate/database identity null in these templates. Static source/config/project identifiers are compatibility constraints, not actual registered database bindings or execution permission. Actual controls, activation, registered readbacks, runtime state, capture data and credentials are absent. Query templates retain an unfilled candidate placeholder; test SQL is mocked in memory, not exported publication data.

ARCHIVE_STORE is explicitly disabled; its unreachable legacy helpers are not restored. Existing independent owner/deadline and binding validation remain prerequisites. The terminal JSON fixture is an artificial 195-byte object with fixed session 24680 and synthetic-only output, used for newline roundtrip checks. Historical test reports are not preserved or represented as current verification.
