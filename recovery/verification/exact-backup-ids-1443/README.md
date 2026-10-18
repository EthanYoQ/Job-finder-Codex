# Exact request IDs for committed-source evidence backup (inactive)

Base: automation module 1442, canonical commit cd1b12a922a47259d19b90f4c86907621cefa292. The four input files are byte-identical to module 1303. `changes.json` contains exact before/after SHA-256 values; `fix.patch` contains only the four production changes. No active or native file was edited here.

The service records each actual handled request ID on its existing job. The existing after-source callback passes those IDs to the existing backup helper and repeated `--request-id` arguments. Packaging opens only each specified request/response pair, without listing or parsing unrelated relay requests. All four consumed kinds enter the archive. Existing `official/PUBLISH.json` and `official/READ_OUTCOME.json` aliases remain.

The packaging boundary checks request hashes, request/response identity and kind, reviewed publication/SQL identity, same source/candidate context, and final same-tuple committed database outcome. A missing or mismatched pair fails packaging. PUBLISH FAILED/UNKNOWN is retained as that fact, and can enter a package only with local COMMITTED_EXACT and a successful official same-tuple committed outcome. The backup helper still returns PENDING without upload on packaging failure; retries, source locks and dispatch behavior are unchanged.

The CLI now explicitly requires exactly one `--run` and actual `--request-id` values. Production already calls once per source. Use separate calls for separate runs. There is no historical ID discovery or scanning fallback. `--verify` still verifies old packages, including the existing multi-source manifest format; old packages are not rewritten or represented as having context receipts.

The existing recursive key removal and original raw-file private-key/AWS-key guard remain. New serialized request/response members are also checked for those markers and credential assignments, including escaped JSON inside SQL. A match fails the package instead of attempting SQL redaction.

## Checks actually run

- `check-exact-backup.py`: 21 offline cases using the retained Novartis run, with in-memory mutations only. Checks exact eight relay-file reads, missing/unknown/duplicate IDs, request hash and response identity/kind mismatch, source/review/outcome tuple mismatch, unknown/uncommitted outcome, reconciled UNKNOWN publication, rolled-back publication, SQL credential assignment, explicit single-run rejection and historical verification.
- `check-runtime-handoff.mjs`: actual service job, entry callback and backup helper; confirms exact CLI ID arguments and PENDING/no upload on package failure or missing IDs; verified upload/readback and web-pending flow use tool mocks only.
- Existing `automatic-relay.test.mjs` against a full 1442 restored module plus these four files: passed. Its single-dispatch, unknown/expiry, source sequencing, producer uncertainty and original context-review assertions remain.
- `git diff --no-index --check before after`: passed.

The real retained Novartis package changes from 12 to 20 members. All 11 old non-manifest members are byte-identical. Eight exact request/response members are added; 51 archived raw files remain. See `member-comparison.json`, `python-checks.json`, `runtime-checks.json` and `original-relay-check.log`. The benefit is removing the global scan and unrelated-file corruption coupling; neither code size nor archive size is claimed to decrease.

No new network capture, SQL execution, producer launch, Drive upload, GitHub write, scheduling or active deployment was performed. The local `novartis-after.tar.gz` is retained only for local evidence comparison and must not be included in a source-code backup. Source activation and the separate BI entry merge belong to the parent/native owner.
