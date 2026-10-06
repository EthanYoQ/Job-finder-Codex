# Merck, Gilead and Organon C46 PORTABLE source backup, revision 2

This source snapshot corrects the inherited reviewer source binding for Merck, Gilead and Organon and preserves the matching restoration-recipe correction. It retains the previous 44 host/tool source paths, replacing only the three reviewer files and the restore recipe, and adds the complete 20-file source regression package plus three root metadata files: 67 files total.

## Relationship to the historical backup

The parent is `aeb54251e44a2dbdb57b64c842bb5723e2ee75ae`, tree `69132abfeec5002300b1f73573a616b10a9528cb`. Revision 2 is prepared for `backup/portable-three46-reviewer-r2-20261006-0117`. The parent commit and earlier backup branch remain historical records; revision 2 supersedes their reviewer and recipe bytes for future clean source reconstruction. It does not rewrite that history or change the repository default branch.

The earlier snapshot recorded prepared, not launched hosts at 2026-10-05 23:39:30 UTC. A later publisher handoff reports all three sources committed and CURRENT by 2026-10-06 01:07 UTC. That later status is publisher-reported context, not independently checked by this source backup. No live run, production SQL packet, job data or database state was read or copied to establish it.

## Exact source correction

The historical copied reviewer admitted the old Astellas/Grifols/BMS/Biogen source set. Each corrected reviewer instead requires its one exact Merck, Gilead or Organon source ID. Each before/after pair differs in that single assertion only. The restore recipe now requires exactly one occurrence of the legacy literal, replaces it with the selected source ID, and fails on literal drift. Other reviewer guards and recipe behavior retain their original bytes; no assertion was removed or weakened.

The three corrected reviewer files under `hosts46/` and `verification/restore-portable66-next-host46.py` exactly match the corresponding after/payload bytes in `backup/reviewer-regression-20261006T0100Z/`. All 20 package members remain together with their original layout, including original and fixed sources, exact patches, synthetic test source, publisher aggregate results and package manifests. This preserves the test runner's relative file references.

## Verification and its limits

The packaged publisher result records 135 reviewer CLI calls: 3 accepted own-source synthetic packets, 129 rejected counterexamples against corrected reviewers, and 3 reproduced own-source failures against historical reviewers. The earlier 27 scope-only checks are separate and are not counted here. The package also records a selected 36-template binding audit. During backup preparation these records were checked for consistency and their frozen hashes were verified; the source, regression runner, restoration recipe and full CI were not executed.

This is a narrow source-binding regression, not a complete transaction verifier. The positive fixtures are synthetic reviewer-contract packets, not compiler-issued production packets or source-quality evidence. Inherited SQL checks use case-sensitive regular expressions and token presence; inherited assertions require a nonoptimized Python interpreter, and the reviewer does not independently validate request expiry or recompute the request hash. These unchanged limitations are not resolved by this correction. Neither the synthetic accepts nor this backup establish production qualification, SQL execution, a successful capture, or authority to launch or publish.

## Included and excluded content

Included are 39 host/source/read-only-query templates and 5 shared verification/preparation scripts, plus the 20-file regression package. Forty existing current-source paths reuse the parent's exact blobs. The four current-source replacements and all package members preserve exact approved bytes. Nonsecret project/candidate/source identifiers, configuration hashes and historical workspace paths remain in source and source metadata.

Excluded are environment files, credentials, actual host configuration and source-plan values, active registration/control/publisher state, bootstraps, live run directories, actual generated SQL/request/control packets, raw captured jobs, database responses, internal authorization records and unrelated audit notes. The three inherited `context-read.sql` files are read-only query source templates; they are not saved query results or production publication packets. The synthetic regression constructs SQL-shaped fixtures locally, but no materialized fixture packet is included. Broad runtime/freeze inventories are not safe upload allowlists.

## Recovery boundary

This is a filtered source snapshot, not a runnable runtime image or a database/operational-state backup. The clean restoration recipe requires the separately retained `code80-portable66-contracts/operations/external-host66` original templates and manifest. Matching producer/dependencies, current configuration/control/registration/build identity, publisher state and fresh source evidence remain external. Historical configuration bytes were absent and must be reconstructed from authorized inputs; source hashes do not recover those values.

The recipe rejects an existing destination host. For an authorized clean reconstruction, use the revision-2 recipe at `verification/restore-portable66-next-host46.py`; preserve the packaged original and history. Do not overlay or execute it on an active host. The inherited legacy ARCHIVE_STORE helper remains unsupported. Dedicated source starters/preflight checks, fresh bootstrap/observation gates and exclusive publisher coordination remain necessary; uncertain dispatches must not be treated as safely undispatched.

`SOURCE_BACKUP.json` lists the 64 selected current-source/package paths with exact mode, Git blob SHA, SHA-256 and byte count. Root `SHA256SUMS` covers those 64 files plus this README and `SOURCE_BACKUP.json`; it excludes itself. The package's own manifests remain byte-for-byte unchanged. No GitHub workflow is added by this snapshot.
