# Three-source reviewer restoration correction

Status: offline verified incremental source package. No live host, publisher state, source crawl, producer code or database was changed by this package.

## Cause and exact correction

The historical portable42-next restoration recipe copied `host-runtime/review-portable-publication.py`, whose executable source allowlist still named Astellas, Grifols, BMS and Biogen. Its general path/candidate binding function never replaced that literal. The previous smoke test only submitted an invalid packet and required rejection, so that test could not establish that a valid Merck, Gilead or Organon packet was accepted.

`payload/verification/restore-portable66-next-host46.py` changes only the reviewer-copy transformation. It requires exactly one occurrence of the old literal and binds that line to the selected single `sourceId`. It fails if the old literal drifts. The three resulting scripts are byte-for-byte equal to the parent's already applied single-line fixes, including all unchanged original guards. `originals/` retains the historical recipe. `reviewer-bytes/` retains each verified before/after script. `patches/` records exact changes.

This is a new increment after the prior code84/GitHub backup, not a replacement historical backup. The old recipe in R2/verification and all current hosts were left untouched. For a future clean R2 reconstruction, preserve the old recipe and apply the included recipe patch at `verification/restore-portable66-next-host46.py`, or overlay the corresponding payload path. The recipe still rejects an already-existing host. Do not run it on an active host or treat this package as launch authority.

## Executed regression

Run `python3 -B test_review_packets.py /absolute/path/to/restored/R2` from this package, using a Python environment with the original code80-portable66-contracts archive available under R2. The test verifies every archived manifest byte before use. It copies only original code templates into a disposable synthetic R2, creates synthetic inert identity metadata, executes the real patched restoration recipe for each source, and then executes each generated reviewer as a subprocess against complete synthetic file packets. No SQL executor or network client is used. Synthetic host/run/request/SQL/archive files are deleted with the temporary directory and are excluded from this package.

Result: 135 actual reviewer invocations passed their expected outcome: 3 accepted own-source packets and 132 rejections. Rejections cover the reproduced historical own-source failure, all four old sources, both sibling sources, an unknown source, row source/candidate/config/batch/result mismatches, failed/unknown states, certificate schema/policy/binding mismatches, raw/deduplicated counts, canonical output hash mismatches, project/kind/request identity, SQL-file/payload mismatch, missing archive, unapproved table, CREATE/ALTER/DROP/TRUNCATE/DELETE and missing finalization tokens. Positive cases also verify generated review-file content and returned SQL/archive hashes and byte counts.

These are real recipe/reviewer CLI tests with synthetic reviewer-contract packets. They are not compiler-issued production packets, source-quality qualification, database execution, or proof of production admission. The SQL fixture contains no production jobs or data and no data mutation. The earlier 27 scope-only checks remain a separate historical result and are not counted here. This patch does not add other validations or broaden the inherited reviewer contract.

## One-pass binding audit

`SOURCE_BINDING_AUDIT.json` records a read-only pass over 36 explicitly selected host template files. Helper environment, stage source/config, loader single-source selection and each reviewer's exact single-source binding match the respective saved source plan. Starter allowlists retain the original three-source scope. Every other template byte matches its original preparation manifest. No live run directory was read. No additional same-class source binding mismatch was found.

The old docstring's four-host wording remains in the exact fixed reviewer bytes; it has no executable effect. The previously documented unsupported legacy ARCHIVE_STORE audit helper remains outside this correction. Original source timing, lock protocol, UNKNOWN blocking, producer, heap and launch command are unchanged.

## Frozen files

`SOURCE_FILELIST.txt` selects only source, patches, synthetic test code and aggregate results. `FILE_MANIFEST.json` records each selected file's SHA-256 and byte count. `SHA256SUMS` additionally freezes the list and JSON manifest. The adjacent safe-source tarball contains those selected files plus the manifests. It contains no actual SQL packet, real run directory, real job data, credentials or active publisher state.
