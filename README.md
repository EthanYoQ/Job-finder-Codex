# Supervisor and sampler revision 2 source backup

Eighteen unchanged source, patch, and synthetic-test files (141,527 bytes), plus the unchanged 672-byte build-observed-command.mjs prerequisite. Source inventory SHA-256: `0bec95076e305cbb19e097b67ed023b9fba9cb714f421c4bf74ba04aa5b01f7f`. Verify SOURCE_BACKUP.json and SHA256SUMS before restoring.

Preserve combined-takeda-supervision-r2-20261006T0718Z/ beneath build-observed-command.mjs. Dependencies include Node.js, Python 3 standard libraries, Bash, sha256sum, Linux /proc, process-group/signal support, and writable test directories. Integration checks also depend on separately restored normal Takeda starter and producer wrapper sources. Regression tests additionally require the earlier supervisor at ../combined-takeda-20261006T0550Z/supervise-cancel.mjs and earlier sampler at ../sample_process_tree.py, relative to the revision directory; they are not duplicated here. Fixed absolute paths and source bindings require review and regeneration when relocating.

Git records these as non-executable source files; original POSIX modes are retained in the manifest where provided. Synthetic workloads can create real local test processes and files if run. The cross-exec fixture is for controlled synthetic receipts only; do not give it operational receipts. No source or tests were executed for this backup, and no real-capture or deployment validation is claimed.

REVIEW.md, generated descriptors, nonce/cancellation state, metrics, actual configuration/database responses, credentials, and operational reports are excluded. The earlier candidate remains available separately.
