# Organon host source and recovery templates

This snapshot preserves the 2026-10-06 13:14:53 UTC frozen preparation files. Null-candidate/UNREGISTERED labels describe that historical template state, not current runtime status. Required nonsecret configuration, expected identity pins, source-specific read-only SQL and the reconstructed loader are included; actual activation/control, binding responses, run folders, SQL write packets, captures, credentials and measurements are excluded.

Restore `organon/` to `hosts-next/organon/` under the recovered root. RESTORE_LAYOUT.json maps the three reused test dependencies from [Merck 7085ade](https://github.com/EthanYoQ/Job-finder-Codex/tree/7085ade42115c2cf2832081e7dc7bc5254a66127). Historical starter/supervisor files are test references, not current launch entries. Their old absolute-path constraints remain; restoring files is not proof the entire legacy suite can run.

Dependencies include Node.js >=22, the producer's locked packages (including tsx/zod/cheerio), Python 3, Bash, Linux /proc, POSIX process/filesystem facilities and the host tool mapping. Producer identity 47b74924f850a4d329460b71717b36df9a5159b8 uses the application changes archived in [3687335](https://github.com/EthanYoQ/Job-finder-Codex/tree/368733577fe5a3d395393c6464fc23eb3fa99c80); its full original Git graph, package installation and runtime are not stored here.

The loader was reconstructed, not recovered as original historical bytes. Recompute restored source/runtime bindings and use an exact fresh registration readback. The context SQL contains a fixed candidate ID and must match that registration. Initialize activation separately with status UNREGISTERED and candidate null; do not copy LOCAL_UNREGISTERED status or archived hashes as proof of a valid runtime. A new namespace does not clear old UNKNOWN outcomes or the formal lock.

The selected source/configuration adaptation is retained in SOURCE_ADAPTATION_SOURCE_ONLY.patch, with exact no-final-newline handling. It omits the LAUNCH_HOLD state segment; the original mixed patch SHA-256 is recorded in RESTORE_LAYOUT.json. SOURCE_ADAPTATION_DIFF.json is the original technical path/hash inventory. The unused ARCHIVE_STORE branch still needs its omitted archive-audit and transfer helpers.

No source, unit tests, database operations, registration, CI, merge or deployment were executed for this backup. Only static source/hash review and local patch-byte reconstruction were performed. SOURCE_BACKUP.json and SHA256SUMS identify exact archived bytes.
