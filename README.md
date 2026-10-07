# Node proxy runtime and Grifols host source snapshot

This preserves seven producer source/test files and 27 fixed Grifols host files. The producer commit is 28402a299bb04cbf5873da66c2fe8ca76827c0d1, with original parent dfd22f642469888eb781f5e7b93964a60e082ca0. Start from the producer baseline described in [a47ed7f](https://github.com/EthanYoQ/Job-finder-Codex/tree/a47ed7feeb93e99d45633795cb5fecebc8c0818f), including its migration-deletion requirements, then overlay these seven producer paths. This backup commit is not the producer's original Git or registered runtime identity.

The tracked runtime profile pins Node v22.23.3 Linux x64, official archive provenance and the executable hash. The source verifier checks the executing Linux inode; it does not download or install Node. Existing proxy/CA/environment values are external and absent from this snapshot. Dummy proxy literals in mocked tests are synthetic examples.

Preserve the producer/ and hosts/grifols/ layout. The final starter SHA256 is 7be0282ab0de5d0b77b334c812f46ca8c783a1d7a201328b55cbb6b22ca669bf and pins supervisor 083435a5344a47b86f84184bbe1d2711b0d35def4670afb2ab3c8391ed442e7e. Do not restore the superseded starter pin. The host's SAFE_SOURCE_ALLOWLIST is prior-source provenance, not the current hash manifest; SOURCE_BACKUP.json here records all current backed-up files and the original manifest hashes.

Recovery still needs the matching complete producer Git/build tree, genuine pinned Node binary, installed tsx/zod/cheerio and other locked dependencies, and the authorized tools/load/store/exec/Supabase environment. Actual host-config, activation/control/context, registration/bootstrap and active publisher state are deliberately omitted. The host rejects inconsistent real runtime bindings; code constants and this backup do not supply them.

Selected tests also require their separately held synthetic packet/evidence and runtime inputs. Do not treat these source files as a standalone test suite. The inherited ARCHIVE_STORE branch still depends on omitted legacy archive/Library helpers. The two public observer scripts are outside this snapshot.

The preserved host README describes code behavior and recovery procedure, not completed operational acceptance. This backup only reviewed fixed source, hashes and the one-literal supervisor-pin repair, then verified remote Git objects and bytes. It did not execute code, tests, HTTP/DB calls, install a runtime, merge, register or deploy. Actual captures, results, diagnostics, proxy values, credentials and private binding files are excluded.
