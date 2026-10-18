# Reuse verified archive bytes in successful-source backup

Parent external1603 08c4831b57a6b69489bc431e91ea0ff160664262, native112 b9ef32f269b1e7433d65a0c5a20710ccc59da282. Only package-success-evidence.py changes: keep the first read_bytes result, validate its parsed archive, and insert those exact bytes into the tar member. Previously a second whole-file read supplied the member without comparing or revalidating it.

This removes one archive read and corresponding full-byte allocation per successful backup. The real Novartis sample is8,959,100 bytes; existing Sanofi archive is78,780,814 bytes. This is not a claim about measured latency or peak memory. Output format and all validation remain unchanged; the exact bytes validated are now the bytes packaged.

Strongest reason to retain the second read would be a supported producer updating the archive between validation and packaging. No such lifecycle exists: normal backup starts only after producer exit0, complete outcome and public verification or WEB_PENDING; the packer also requires the final process record exitCode0. The second read never validated a refreshed version, so it was not an independent trust boundary.

The local test used the existing Novartis committed evidence and its exact four relay IDs. Both old/new packages contain20 members and51 raw files; all member bytes, including MANIFEST and RESTORE, are identical. Both package restore verifications pass. Counted archive reads are2 versus1. Tar gzip container timestamps may differ; member bytes are the correct comparison. No new collection, upload or SQL execution took place.

Retained: actual request/response bindings, committed outcome, secret screening, archive raw-file hashes, process exit, web status and independent downloaded-Drive restore verification. No scheduling, locks, unknown-outcome handling, native or entry changes.

Back up only after/package-success-evidence.py at module root, this README and verification-summary.json. Do not back up local real tar fixtures or verification inputs to GitHub. Restore63 runtime files against1603 before activation; active code has not been modified.
