# Takeda host source backup

Twenty unchanged source and synthetic-check files, 118,963 bytes. Source inventory SHA-256: `7adf3d05e58d241469dec2a84751438448b162fc64dc7f960ab55634cce4a308`. SOURCE_BACKUP.json is the selected allowlist; verify SHA256SUMS before restoring.

Preserve the hosts46/takeda/ and verification/ layout. Dependencies include the separately restored producer source and Node.js dependencies, Python 3 with assertions enabled, configuration/control inputs, schema expectations, and template/archive inputs referenced by the preparation tools. Fixed paths and source integrity bindings require review when adapting the files. This subset alone cannot run the host or all synthetic checks.

The remaining inventory entries are omitted, including configuration and identity documents, reports, original copies and diffs. Actual database replies, capture data, runtime directories, credentials, and environment files are also excluded. No code execution or runtime qualification is claimed by this backup.
