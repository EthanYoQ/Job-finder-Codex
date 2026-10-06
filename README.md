# Deadline companion and SQL test support source backup

Fixed application source identity: 28d9bbe1a4568403b60218e688c8d40de11ef592, parent fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d. Its nine application changes are already preserved in [3687335](https://github.com/EthanYoQ/Job-finder-Codex/tree/368733577fe5a3d395393c6464fc23eb3fa99c80). LOCAL_COMMIT_OBJECT.txt is exact Git provenance; the complete original Git graph and runtime are not included.

Preserve the companion directory layout. Dependencies include Node.js >=22 and the application's locked dependencies, Python 3, Bash, Linux /proc and POSIX process/filesystem facilities. Source files contain fixed path and hash checks; restore them through separately verified binding steps before use.

Actual configuration, build/registration identity, activation records and the identity-embedded load-host-state.js are omitted. The binder, loader and some tests require these inputs. Reconstruct them locally from the rebuilt source/runtime identity and an exact fresh registration readback; never substitute historical registration values. Recompute and verify the restored runtime; a recorded hash must not be reused as proof that omitted bytes were recovered. No registration, activation or deployment is established by this archive. A fresh namespace does not clear old UNKNOWN outcomes or the formal lock.

The legacy direct preflight launch is disabled in this revision. Terminal receipt files alone do not prove original exec completion; use the original session's terminal result. The old supervisor under combined-takeda-20261006T0550Z exists only as a negative regression fixture.

READ_CONTEXT needs context-read.sql from the corresponding prior [Takeda source backup](https://github.com/EthanYoQ/Job-finder-Codex/tree/7198b3e4ae3a74b423b741e822685b0e37616c68). The unused ARCHIVE_STORE branch also needs its omitted audit and transfer helpers. This filtered snapshot is not a directly runnable host.

source-only.diff is derived solely from selected source bytes and previously archived source baselines. Mixed original diffs and operational reports remain excluded; only their hashes are recorded. No source or tests were executed during backup.

The SQL test support is the final r3 source set. Preserve `sql-test-support/node_modules/native-single-test/`: these four files are self-authored test code, not installed third-party dependencies. Official PostgreSQL 17.5 archive/checksum and build dependencies are in `sql-test-support/OFFICIAL_SOURCE.json`. The rebuild recipe compiles the separately obtained verified archive and runs its local self-check; no engine or build output is included.

The adapter is restricted to controlled test SQL with `standard_conforming_strings=on` and one backend. It is not a general SQL driver or a multi-backend acceptance test. It creates temporary data and logs when run; those outputs remain excluded. No CI, tests, installation, registration or deployment was performed for this backup. SOURCE_BACKUP.json, SOURCE_EXCLUSIONS.json and SHA256SUMS record exact source bytes and omitted inputs.
