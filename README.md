# Offline fence candidate source backup

Seven unchanged Python, shell-template, and patch files, 62,737 bytes. Source inventory SHA-256: `488d6635a285e5b8a20d1170bc2a5ca8593abcfdc3106dd61bc77bec703c050b`. SOURCE_BACKUP.json is the file allowlist; verify SHA256SUMS before restoration.

Preserve fence_candidate.py and test_fence.py together, with the five related files under stdin-review/. The code requires Python 3 standard-library modules, a POSIX shell, and Linux/POSIX descriptor-relative filesystem operations, no-follow opens, permissions, signals, and directory fsync.

test_fence.py additionally references the omitted ../transfer-bootstrap/upload-000.sh. That external input was not read or included for this backup, so the complete original test module cannot run from this branch alone. The stdin-review tests depend on the included candidate and template files in their existing relative layout. Their setup requires the execution UID to own the entire absolute parent chain, with no group/other-writable ancestors; ordinary unprivileged execution or a default /tmp location can fail this requirement.

Use fence_module.py through the included wrapper, which supplies its verified source hash; it is not a standalone entry point. The templates retain unfilled parent-snapshot and receipt inputs. They require separately validated inputs before use; restoring these source files does not execute them. The operation label is a non-secret matching value, not a credential.

Actual parent snapshots, inode data, receipts, invocation state, environment/configuration files, credentials, captured data, test outputs, and operational reports are excluded. This source backup makes no runtime or test-execution claim.
