# Five host source backups

This snapshot contains 96 unchanged source files (583,919 bytes) for bi, fosun, kelun, msd, and novartis, including selected preparation and synthetic check programs. SOURCE_BACKUP.json is the exact file allowlist; verify SHA256SUMS before restoration.

The frozen source inventory is NEXT_DUE46_SAFE_SOURCE_MANIFEST.json, SHA-256 `6e223a5f28097b036164131b7a7a0a11c5965617ca93de978c40ba66151ddc2e`. The original inventory is omitted because it also lists excluded files.

Dependencies include the referenced producer source, Node.js and Python dependencies, separately supplied configuration and schema expectations, and any template files imported by the preparation programs. These inputs are omitted. This snapshot alone cannot run the hosts or all checks. Restore and validate inputs separately, and review fixed paths and integrity checks before relocation.

Excluded: credentials, environment and configuration files, identity documents, captured data, database responses, runtime outputs, internal reports, old source copies and diffs, superseded inventories, and the preparation generators listed as omitted in SOURCE_BACKUP.json. Omitted generators mean their preparation steps are not fully reproducible from this branch alone.
