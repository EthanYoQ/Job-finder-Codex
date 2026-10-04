# Servier42 external collection host source backup

This standalone snapshot contains 27 exact source files (112,810 bytes) for the external Servier collection host, including two read-only SQL query definitions. Each file matches both the supplied PREPARED manifest and SHA256SUMS. These files were outside the producer Git checkout; there is no original Git commit for this host snapshot. SOURCE_BACKUP.json records the original byte hashes, modes, verification limits and exclusions.

The registered producer remains version 42, source commit `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`. This external host backup does not replace its source or runtime identity. The preceding host-source archive is [ae035716](https://github.com/EthanYoQ/Job-finder-Codex/tree/ae035716dd52bde303bc9d444e350e588e01e3d2); this branch's tree is limited to the new Servier host and its backup metadata.

## Change and reported verification

The overlap gate distinguishes three expired, superseded INVALIDATED remnants and one exact historical tuple proven ineligible for the current formal write route. That legacy candidate is not claimed to be INVALIDATED. Other BUILDING candidates, current candidate/configuration rows, recent or unknown rows, unproven identities and nonempty formal ownership remain blocking. The exact historical tuple and database-guard pins are retained unchanged because generalizing them would weaken the check. No claim is made that the historical 8b source was read or restored.

The implementation handoff reports 28 focused overlap-gate checks passing at 20:52:52 UTC on 2026-10-04. At the status cutoff of 21:03 UTC, it reports a formal Servier B success at 21:00:01 with 94 accepted jobs and public CURRENT readback at 21:02:36. Those operational results are reported provenance, not database payloads included in this archive. This backup performed byte/hash and static secret checks only; it did not execute the source, run tests, capture jobs or run CI.

## Recovery boundaries

Included source covers file/relay helpers, current-observation due checks, the narrow overlap gate, capture-input checks, preflight, certificate/publication review and monitoring. Code contains intentional historical absolute paths and non-secret project, source, candidate and guard identifiers. They require reviewed adaptation and revalidation before use; this snapshot is not permission to execute a production operation.

Actual host-config, control-base, source-plan, expected-database records, bootstrap, publisher state, database/context readbacks, relay SQL packets, requests/responses, capture/run/readiness directories, raw job bodies, private test inputs, credentials, environment files, generated dependencies/builds and internal operational reports are excluded. Authorized current configuration and private evidence must be recovered separately from the existing private Library recovery archive or re-established by the publisher. Never replace required evidence with dummy or historic successful data.

This host-only tree is not a complete runnable producer checkout. It needs the separately recovered producer42 source/dependencies and prior JNJ/Pfizer/Servier template hosts. The optional archive upload route in host-files.mts references `audit-novo-public-archive.mjs`, which is absent from the supplied host; host-stage-functions.js also references a Library transfer helper absent at its recorded path. These gaps belong to an unused ARCHIVE_STORE branch; the reported successful DB_STARTED_OWNER_V1 capture/publication chain does not call it, and private evidence retention is a separate authorized process. Those existing gaps were not repaired during backup. The 28 gate checks depend on excluded real readback fixtures and cannot be rerun from this tree alone. The narrow legacy exception requires its exact evidence and guard contract; do not turn it into a generic stale-BUILDING exception.

There are no active workflow definitions in this backup tree. No default-branch update, merge or deployment is performed by creating this archive. Future runtime use requires independent reconstruction, validation and identity registration.
