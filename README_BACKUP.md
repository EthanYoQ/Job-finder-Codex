# Sanofi encoding candidate source backup

Source checkpoint: `40141b32bafaef4f2585cad8caf11c6088546de3`, based on `d402d3639c0ea729fa72bd1a4427570b227c7481`, at the 2026-10-04 15:55 UTC cutoff. This is a checked candidate; no new official acquisition, publication or candidate44 registration is claimed at this cutoff.

857 original source/test/config files are included, plus this guide and `SOURCE_BACKUP.json`. Five source paths differ from the previous safe producer backup; other objects are reused. All included bytes, paths, modes and hashes are recorded in the manifest.

The change audits a narrowly constrained Chinese display discrepancy: a single triplet of replacement characters must correspond to one Han character in the same-requisition native description, with all surrounding normalized text equal. Source bodies are not rewritten. Identity, location and discrepancy hashes remain bound to the explicit anomaly ledger.

Reported validation passed 44 targeted tests and a read-only replay of private saved pairs. No complete suite, full TypeScript check or successful new production run is claimed by this backup.

46 tracked non-source/evidence files are excluded, including internal recovery notes, actual database/control material and retained job bodies. Credentials, environment/private profiles, generated dependencies/builds, runtime state, uncommitted files and original local Git history are not uploaded.

The optional `sanofiChineseEncodingCaptureReplay.test.ts` is retained as code. Its private capture directories, raw responses and original JDs are excluded; it needs separately authorized local input via `SANOFI_MAIN_CAPTURE_DIR` and `SANOFI_INDEPENDENT_CAPTURE_DIR`. Other retained-evidence tests also require their excluded inputs for recovery. Synthetic tests remain intact.

Workflow source is retained under `backup/disabled-workflows/`, with no active workflow. This independent backup commit does not preserve runtime registration identity and must not be treated as a deployed build. Nothing is automatically tested, merged or deployed by this branch.

