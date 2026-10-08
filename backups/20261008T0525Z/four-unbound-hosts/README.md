# Qilu, Sanofi, JNJ and Bayer R2 unbound host source

This source-only package restores all 146 creator-manifest-listed files, 788,431 bytes:
- Qilu: 37 files, 195,794 bytes
- Sanofi: 36 files, 193,065 bytes
- JNJ: 36 files, 192,674 bytes
- Bayer R2: 37 files, 206,898 bytes

Every source byte was rechecked while copying. The three binding-sensitive canonical files in each host are reconstructed from their exact matching unbound templates: host-config.json, runtime/load-host-state.js and the combined monitor starter. This avoids copying live/bound files or racing active state. The source manifest records every canonical target, actual safe input, hash, length and mode. Original workspaces were not altered.

Verify ARTIFACT_MANIFEST.json and SOURCE_MANIFEST.json before restoring into a new directory. Each source/<host>/ subtree reproduces that host's original safe source layout. No actual activation, control-base.json, context-read.sql, owner binding, nonce, run, DB reply, private HTTP/HTML evidence or credential is included. SQL templates and unbound null-candidate JSON templates remain source. They are not live transactions or registration authority.

## Shared source and runtime prerequisites

The complete 865-file producer base is commit `3a2400768e8b087b8600dd05e1a32ac006bd7102`, preserved in the root-level source backup archive of this same GitHub backup history: `job-finder-c51-safe-source-3a240076-20261008T0217Z.tar.gz`, 6,256,183 bytes, SHA256 `40df61a1308618114c7c372cf714d389d88484326c52ae3d4f684a75026fc476`. This base is a full standalone source bundle, not an unavailable delta. It is also retained as private Library item `libfile_818375f3f1208191b1b2cf73e871f057`, version 0.

The host package itself does not embed that producer, Node v22.23.3, physical dependencies/native engines, build output, service access or actual bindings. Those remain separate runtime reconstruction and authorization steps. Original absolute paths participate in source pins; relocating them needs an explicit reviewed source adaptation and fresh verification. Exact source restoration alone does not mean the physical runtime is ready.

## Disabled legacy uploader dependency

The reviewed selected DB_STARTED path does not require the absent historical Library helper. For all four exact source trees, host-stage-functions.js defines handle at line 3 and unconditionally rejects ARCHIVE_STORE at line 8, before its first helper call at line 9. The old branch at line 26, Library upload at line 35 and historical helper call at line 39 are unreachable through that handle. The reviewed loader, monitor and owner delegate through the same handle.

The selected starters use --db-started-control: Qilu uses p0-cloud-portable-source-pilot.ts; Sanofi, JNJ and Bayer use p0-cloud-source-pilot.ts. The missing historical helper is therefore an optional dependency of a disabled old upload branch, not a blocker for this selected collection/DB path. This package does not promise restoration of the legacy uploader. No platform helper implementation is copied, and no source bytes were changed to remove the old reference. Per-host source hashes and call-path evidence are in metadata/HOST_LEGACY_UPLOADER_REACHABILITY.json.

Only static source recovery and path reachability were checked here. No collector was launched, no SQL executed, no DB backed up, and no host activated or deployed by this backup.
