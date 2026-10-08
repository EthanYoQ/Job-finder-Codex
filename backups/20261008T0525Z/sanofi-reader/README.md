# Sanofi reviewed reader: complete six-file source change

This package preserves the exact final six TypeScript files, their original frozen archive, the exact patch, the five complete preimage source files and a strict patch reconstruction verifier. The changed source bytes are independently recoverable. This is not a standalone application/runtime backup.

Frozen six-file archive: 27,573 bytes; SHA256 `10626ae31c39995147b6afc9a2d631ca6a3e9dcdf66b708ec60869ec8e03ffc6`.
Patch: 19,393 bytes; SHA256 `3bd829c979a3adece3ec4efaf5abf07317667318d6515d5b472e17220d76ac11`.
Six complete source files: 109,547 bytes; the inner archive also contains the exact 1,855-byte candidate manifest.

## Verify and recover the change

First verify the outer ARTIFACT_MANIFEST.json. Then run:

`python3 verify_portable_reader_delta.py --baseline baseline-source --archive sanofi-exact-reviewed-reader-source.tar.gz --patch sanofi-exact-reviewed-reader.patch`

The standard-library-only verifier checks both pinned artifacts, exact safe tar membership, the five complete preimages and every patch hunk with exact context. It reconstructs all six final source files in memory and compares their exact hashes/bytes with the frozen tar. It does not execute project code, access a DB, build or deploy. Extraction into a new directory restores the six full changed files without any external patch base.

The exact reviewed batch/candidate IDs, timestamps and hashes in sanofiReviewedPublicReceipt.ts are required functional reader allowlist constants. They are preserved as source. They do not authorize future Sanofi A issuance, new bindings or activation. Code that calls read-only repository APIs is source, not a packaged live SQL transaction or DB response.

## Application-level prerequisites

A runnable application still requires its correct role-specific full baseline. Main and fallback must not be substituted for one another:
- Main source commit `6510baecc784ec87999cb5ea546b0995afe9222f`; source archive 7,531,331 bytes, SHA256 `0801d13002500315bea43bc0d8e701432d11b91f85e1f64b34c1d0047ed3ac00`.
- Fallback source commit `600ad0ab23e886ae9ac429d3d1b076e00af76e88`; source archive 7,526,259 bytes, SHA256 `a924f5888ae5eb35a666ef60907bf2e79070d461cf473332f24e442252e6577e`.

The audit compared all 980 main and 977 fallback baseline archive files with their local restorations and checked each of the five exact old source hashes. Both roles passed zero-fuzz patch dry-run and exact reconstruction. The five preimages needed to reproduce this patch are included here, so those source-byte checks need no outside archive.

Existing restoration records locate the broader historical role archives in private Library item `libfile_1d8dc418a7c48191ae194dbaa6a2e2fc`, under `release/backups/web-main-source.tar.gz` and `release/backups/compatible-fallback-source.tar.gz`. Current remote availability of that historical outer archive was not rechecked for this source change. The outer archive includes private runtime evidence and is deliberately not uploaded here. Re-establish access and verify exact hashes before any future full-application restoration.

Node >=22, lock-matched dependencies, generated Prisma client/native engine, role-specific assets, honest new runtime identity and approved secret/config loading remain separate. Source/patch backup does not establish that the reader is deployed or that real-data regression can be repeated. The prior independent review records 342 tests per role and scoped typechecks; this backup performs byte-recovery validation only and does not rerun private-fixture tests.

Excluded: real DB fixtures/readbacks, raw HTML/capture evidence, actual SQL packets, runtime dumps/config, controller/activation scripts, credentials, node_modules, replay programs/output and runtime binaries. No database backup is performed.
