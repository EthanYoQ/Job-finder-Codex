# Bayer host source backup

This snapshot contains 27 unchanged source files (106,125 bytes), a file manifest, and checksums.

Source archive: `bayer46-safe-source-20261006T0201Z.tar.gz`
SHA-256: `ff202f673ab5a48f6fd3672306246012918fa84f136973a13ec1fcd33ce0638c`

Use SOURCE_BACKUP.json as the file allowlist. Verify SHA256SUMS before restoring.

Dependencies: the referenced producer source, Node.js dependencies, and separately supplied configuration and schema expectations. These inputs are omitted, so this source snapshot alone cannot run the host or its tests. Fixed paths and integrity checks require review when restoring to another location.

Excluded: credentials, environment files, configuration and identity documents, captured data, database responses, runtime outputs, internal reports, historical copies, and historical diffs.
