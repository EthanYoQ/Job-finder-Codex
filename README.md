# Offline fence r4 source backup

Ten unchanged source, unfilled-template, generator, patch, and synthetic-test files, 98,232 bytes. Source inventory SHA-256: `acc27bd9e7dad64242ebfdb3190a5e57a5c5abea1c3dc29eb51ef3f7a151457e`. SOURCE_BACKUP.json is the file allowlist; verify SHA256SUMS before restoring.

Preserve the r4/ layout. Dependencies include Python 3 standard libraries (including zlib), a POSIX shell, and Linux/POSIX descriptor-relative filesystem operations, ownership/mode checks, signals, and directory fsync. The code assumes stable trusted ancestor paths. The tests require suitable execution ownership and filesystem permissions.

r4/test_fence.py additionally reads the omitted ../transfer-bootstrap/upload-000.sh relative to this snapshot root. The supplied patches start from r2/r3 files, which are not included; full r4 target files are included. These missing inputs mean this snapshot alone cannot reproduce every original check or apply every historical patch.

Parent plans and readback inputs remain unfilled. Wrapper-compressed bytes match the included module. The module expects the wrapper's verified-source-hash input; the format/ordering guard is not a general code-injection defense. This is an offline source candidate, not an executed or deployed package.

Actual parent/inode snapshots, receipts, package inventories, configuration, credentials, test outputs, continuation plans, and operational reports are excluded.
