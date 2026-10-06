# Offline bootstrap continuation r5 source backup

Five unchanged final source/generator/test files (87,211 bytes), plus the previously verified 9,232-byte r4 module prerequisite. Source inventory SHA-256: `f5490802e89b549eb8e03b5f23e61d80c189628e362d989779bd6ce2c2552146`. Verify SOURCE_BACKUP.json and SHA256SUMS before restoring.

Keep r5-continuation/ beside r4/. Python 3 standard libraries include ast, base64, hashlib, json, tarfile, and zlib; the code also requires a POSIX shell and Linux/POSIX filesystem ownership, descriptor, signal, and fsync support. The single-file container embeds exactly the included continuation source and the pinned r4 module. The final generator uses explicit rejection guards and retains the 12,288-byte generated-command limit.

Importing build_single_file.py rebuilds its local container file. Its measurements and the tests require the omitted original bootstrap archive and r4 continuation-parts.json; this snapshot alone cannot reproduce those checks. No actual archive bytes, populated execution scripts, receipt chains, parent/inode plans, credentials, result files, historical generators, or operational reports are included.

This is an offline source candidate. Actual execution inputs are not supplied, and nothing in this backup is claimed to have been executed or deployed.
