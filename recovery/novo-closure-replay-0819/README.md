# Novo original reader replay closure adaptation

Inactive external module change, based on 0756 / 881bc58fd2288e1bb1f266fe00b41b4b25f9693b. Native candidate107, the deployed readers, SQL publication compiler and publication bytes are unchanged.

## Actual incident

The original before input omitted the four persisted JOB_VERIFICATION closures and their artifacts. The external replay used the pure domain projector, whereas the deployed repository verifies and applies these closures. Thus local before contained19 jobs and the real public response15. The four extra jobs were exactly the previously closed jobs. No comparison is removed.

## Two production paths

- support/transport/viatris-reader-before-original.sql: in the original repeatable-read transaction, Novo only loads matching closure records with parent result/batch, the referenced original/current evidence metadata, and closure historical membership. No artifact bodies. Other sources receive an empty closure array and retain their original source data.
- support/offline-checkers/original-portable-reader-replay.mts: Novo uses the deployed readPortablePublicSnapshot repository and existing transaction adapter pattern. Original closure parsing, receipt/artifact validation, historical membership and time-aware removal remain owned by the deployed implementation. Other source projection paths remain unchanged. Missing closure snapshot is rejected rather than treated as an empty set.

## Verification

The exact original read-only template with the change was executed through the original official connector. It returned4 closure records,8 bound artifacts and38 members. The first diagnostic query accidentally used the wrong company literal; it was corrected before the successful replay. Inputs are explicitly RECONCILED diagnostic inputs, not recovered original inputs.

With a copied run and the original packet/context/HTTP archive, the complete original review command passed: SQL exact recompilation and packet validation, both deployed-reader projections, complete86-artifact raw replay, and both target API projections. Before is15 jobs and every public field matches the independently captured public before. After is37 jobs and both readers match. The old batch remains NOT_DISPATCHED; this offline result cannot authorize its submission or refresh its timestamps.

Only the two paths in changes.json are runtime modifications. This README may be backed up separately. RECONCILED_READER_BEFORE files, reconciled-host, logs, raw data, and official responses are diagnostic evidence and must not go to GitHub. The frozen code diff is closure-replay.patch. No production file is modified by this delivery.
