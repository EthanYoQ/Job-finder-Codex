# Servier C46 external host source backup

This branch preserves the frozen Servier host source adapted to the restored regular C46 producer. It is a source-only archive, not a registered runtime image or a deployment. Producer source remains `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`; C46 here is the regular restored producer, not the unrelated offline Sanofi candidate whose Git SHA starts with `46beb14`.

## Cutoff and provenance

- Source manifest frozen at 2026-10-05 21:53:58 UTC; SHA256 `b987b8dc225690b34788800bb6096acf123100d01197aba2256fdb3b485257c7`.
- At the publisher's 2026-10-05 22:00 UTC handoff, no new Servier capture, producer launch, database operation or publication had occurred for this host. An active CTTQ round is a separate source and provides no Servier success evidence.
- The publisher reports 13 primary checks plus 56 supplemental synthetic/hash checks passed. It also reports all 33 original PREPARED-file hashes matched, including six omitted source/config references regenerated against exact historical hashes. These are local preparation results, not a real capture, database acceptance, full CI or public validation.
- This backup independently checked the 28 selected source hashes, scanned/reviewed their content, and verified the resulting GitHub tree and file bytes. It did not execute the backed-up code, run tests or access a live capture/run directory.

Historical source: [Servier C42 host archive](https://github.com/EthanYoQ/Job-finder-Codex/tree/40f65562867ad6e8dc6b35745ca3b96eec77577c). Original reference files are not duplicated here. The backup commit identifies this filtered archive and does not recreate an original runtime identity or Git history.

## Preserved contract

The source keeps the existing TRUE_B Chinese rendered-DOM collection route: fresh main traversal and separate independent traversal both require complete details and exact source/config bindings. Main evidence has a 30-minute freshness window; independent CURRENT_RUN validation retains its 60-minute window; the final database bootstrap must be no more than 60 seconds old. Natural due time comes from the exact successful CrawlObservation tuple plus 12 hours, not a historical count or a scheduler guess. Publication expiry/reserve checks and parent review remain required.

The adaptation changes host/producer paths, C46 candidate bindings and the `restored46:servier:` namespace, and adds early string checks for batch IDs. Exact historical overlap exceptions remain narrowly pinned to their established tuples and current non-writable qualification conditions; they do not permit ignoring arbitrary BUILDING/current/unknown work. Expected database identity, migration/guard checks and actual current readback remain necessary.

Before launch, publisher state must have `active` exactly null. Publication additionally permits only its own exact Servier batch. These local state checks do not atomically acquire ownership: the external single-publisher rule remains a prerequisite. The inherited `ARCHIVE_STORE` helper dependency is absent; that unsupported branch is unused by `DB_STARTED_OWNER_V1`. Generic preflight launch is portable-only; Servier uses preflight check plus its dedicated B starter.

The CSPC stale-context reread change is not included. Servier SQL dispatch remains single-dispatch. Main and independent capture inputs must be fresh, separately bound descriptors; old results/raw packages cannot supply a new success.

## Recovery and included files

The archive contains 25 current host/source/read-only-SQL files and 3 preparation tools, copied without modification. Paths are relative to the restoration workspace: `hosts46/servier/` and `verification/`. Some preserved filenames end in `42`; the current C46 bindings are inside the frozen source.

`SOURCE_BACKUP.json` records each source's SHA256 and Git blob SHA. `SHA256SUMS` covers source plus this README and the new manifest. Necessary nonsecret project references, source IDs, code hash pins, fixed candidate IDs, strict historical tuple pins and original workspace paths remain intact.

Runnable restoration additionally needs correct producer/dependencies, separately authorized matching host/control configuration, source plan, expected database identity, registration, live publisher state and fresh evidence. The synthetic checks read omitted files and historical originals, so this filtered branch alone cannot rerun all 69 reported preparation checks. Preserve fail-closed assertions; never substitute synthetic data for missing runtime identity or live evidence. Checks also create local artifacts; their stubs are not a general network/process sandbox.

The preparation tools read external configuration/identity and generate broad local inventories, including runtime outputs. Those generated manifests/directories are not safe upload allowlists and must never be exported wholesale. Historical inputs and original PREPARED references must be recovered separately and checked before using the tools.

## Exclusions

The original manifest lists 99 files; original SHA256SUMS contains those plus the manifest itself, totaling 100 entries. This archive selects 25 current source entries and excludes 75 inventory entries. Three separately listed preparation tools are also included.

Excluded: originals, original diffs/reports, RUNBOOK/COLLECTOR handoffs, source-plan/host-config/control-base/expected-database JSON, PREPARED/SPEC/FROZEN manifests, registration/runtime identity and internal preparation reports. The original checksum file is replaced with the selected-file list. No actual database response, SQL publication request, captured job/raw content, capture descriptor, live-run output, credential or environment file is included. The branch has no workflow entrypoint and does not change the default branch.
