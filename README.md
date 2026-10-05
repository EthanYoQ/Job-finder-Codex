# Public readback: exact CURRENT and GRACE verification

This source-only backup contains the locally adopted external readback helper, synthetic regression tests and the exact diff from the previous helper. The helper SHA256 is `a14502d0fa01fec8bd0f384b39bd6748c2a7db72223234ce3424df62e607c7a8`, matching the adopted local copy at the 2026-10-05 10:02 UTC handoff. It is not a producer Git commit or a new registered runtime identity. Producer42, the database, website and default branch are unchanged by this archive.

The baseline is the [previous readback backup](https://github.com/EthanYoQ/Job-finder-Codex/tree/2b41cdb234c3f308cd81f4289869b5ab74932f47), whose helper SHA256 is `87b2418bc7f9adc15b562153440179e88d0a37ffe8da772be14baa852a226b75`. The supplied diff was checked to match those exact old and new bytes. The original preparation README was not copied because its statement that the helper was not yet adopted is obsolete.

## Verification contract

- Without a formal member proof, preserve the original no-GRACE count and source-result check. Counts alone never admit GRACE
- A present proof must bind the finalized source result, source, batch, successful states and CURRENT count. A present invalid or null proof fails closed
- Check each job-key SHA256, per-set unique keys and public IDs, CURRENT/GRACE missing counts and all three canonical set hashes. Canonicalization uses unique strings in UTF-8 byte order and compact JSON
- Require CURRENT and GRACE to be disjoint and VISIBLE to equal their union with the same public-ID and missing-count mappings
- Match the public CURRENT and GRACE IDs separately and exactly, including current source/result, receipt company and boolean GRACE flags
- A nonempty GRACE set requires the plan-bound-source-quality-v1 receipt type. Other receipt types cannot use this extension
- Keep the exact coverage observation-time match and PUBLISHING/HEALTHY requirements

## Local usage and limits

`--verify-only` prints verification without rewriting saved completion or readback summaries. Repeat `--run-dir` to restrict the selected completed runs. The pure public_status function performs no I/O. The helper makes no network requests or database writes; without `--verify-only`, the CLI retains its original local summary-write behavior. Its default round selector and historical paths remain specific to the original environment and date and require review before reuse.

The implementation handoff reports 15 synthetic cases and a real Hansoh read-only acceptance passing. This backup inspected only source, tests and diff, and did not read the actual acceptance inputs or rerun tests. These results are not full CI or production qualification. The synthetic standard-library suite covers membership, hashes, bindings, overlap, flags, receipt type, coverage and byte/mtime preservation of the verify-only CLI. It uses invented test IDs and contains no captured production rows.

## Archive scope

The six files are the helper, test_readback.py, exact diff, this README, SOURCE_BACKUP.json and a newly generated SHA256SUMS. That checksum file covers the other five uploaded files only; it is not the original working-directory inventory.

Real verification reports, input fingerprints, run/install receipts, test logs, actual public or database JSON, raw bodies, member-proof payloads, control/SQL packets, environment and credentials are excluded. Reproducing real acceptance requires separately authorized exact finalized evidence; do not substitute invented proof for that evidence.

The branch contains no workflow definitions. This backup does not run CI, install dependencies, merge or deploy.
