# Sanofi Ajinga failure evidence

The existing private writer now saves the parsed Chinese detail, its original HTTP response and all received Ajinga artifacts on chain failure, including the final replay checks. Both normal and independent callers supply the detail response. Files are diagnostic only, under `${JOBFINDER_STATE_ROOT:-/data/job-finder}/diagnostics/sanofi`, with UUID names and 0700/0600 directory/file modes. No `onReceipt` persistence hook is required.

Closed diagnostics distinguish ENTRY, INFO, STATUS, PROJECTION, TITLE_MATCH and DESCRIPTION_MATCH. Only fixed stages, safe requisition IDs, filenames and hashes are added to logs. A file-save failure preserves the original rejection. Title and normalized whole-description equality remain unchanged until real failure evidence establishes whether they are too strict.

Eight focused synthetic tests passed, covering the six failure stages, unchanged valid-chain acceptance and file-save failure. Tests verify retained artifact counts and that private response markers never appear in diagnostics. Changed-file TypeScript diagnostics: zero; one existing transitive diagnostic remains. No real source or database operation was performed. Real failure-file examination remains pending.
