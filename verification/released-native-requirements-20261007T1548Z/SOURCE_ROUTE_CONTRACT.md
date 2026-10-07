# Pfizer static route contract

Source: source-pfizer-china-social. Route: TRUE_B. Producer commit: 28402a299bb04cbf5873da66c2fe8ca76827c0d1.

static-inputs.json is an exact-key projection of source identity, route, configuration, the complete current source plan, and concrete implementation hashes. Missing fields, additional metadata, changed bytes, duplicate manifest paths, symlinks, or unknown package files are errors. No fallback values are supplied.

The publication route remains DB_STARTED_JOB_PROJECTION_DELTA_V1 with b-grade-independent-traversal-v2. The R2 context-envelope implementation is preserved as its reviewed byte sequence; no external R2 manifest is needed. Original runtime, supervision, owner, and test implementations retain their reviewed bytes. Historical results and preparation reports are excluded.

prepare-pfizer-host.py and finish-pfizer-static.py implement exact source restoration and verification only. They require the enclosing source plan's pinned restore-manifest SHA256. The output must be a new absolute non-production directory. export-route-audit.mts verifies the static route against the fixed producer; it is independent of historical route reports.

Source enumeration is limited to hosts/pfizer, owner-adaptations/pfizer-b-20261007T1548Z, and verification/released-native-requirements-20261007T1548Z. Other sources can share the repository root; they are not read or copied. Additional files inside any Pfizer namespace are rejected. Output verification checks the full new directory and rejects any additional output files.
