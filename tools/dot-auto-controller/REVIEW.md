# Review scope and verification

## Disposition

Inactive Draft review candidate. No merge, deployment, migration, credential setup or production activation is authorized by these results. Reader endpoint post-fix independent review remains incomplete. The complete Takeda live pipeline and the other 35 source adapters are not qualified or claimed complete.

## Reproducible offline checks

With Node 22.23.3 and the frozen producer dependencies available, run `node scripts/offline-tests.mjs` from this package. The script installs a network-denial guard and runs:

- 187 controller, transport, ledger-contract, reader-identity, privacy-sanitization, import-closure and failure-injection tests: 187 passed, zero failed, zero skipped.
- The actual frozen native lifecycle reducer: unsuccessful observations preserve GRACE/original time; the second verified missing observation becomes SUSPECTED_OFFLINE. Actual database observation `id` mapping is checked.
- The actual control-plane client against file-measured main/fallback proof modules: current nonce-bound proof accepted; replay, stale fallback time and mismatched local replay pins rejected.
- The default-disabled CLI status check, listing all 36 routes and the 35 unsupported adapters explicitly.

The privacy-sanitized derivative passed 168 independent controller/transport/privacy/import tests. Independent actual BI failures in all three capsules preserved prior GRACE, missing counts and timestamps with zero HTTP calls; the Takeda two-job capture and native B-grade certificate checks also passed. The earlier 176-test pre-sanitization review is historical evidence only.

The new derivative's merged TypeScript no-emit attempt did not start. Its bounded 300-second shared-queue admission expired because available memory stayed below the required 2048 MiB. Result: NOT_RUN_RESOURCE_BLOCKED, launcher exit 75. No compiler result or typecheck pass is claimed for this derivative; the historical pre-sanitization pass does not transfer. The proposed validation heap remains 1024 MiB and capture remains 384 MiB. No memory gate or runtime timeout was relaxed.

Normal repository CI does not exercise this isolated tool. Its offline commands must be run separately in the approved environment. Full typecheck, PostgreSQL qualification and live end-to-end qualification remain outstanding. Earlier failed and resource-blocked validation evidence is retained outside the source package.

## Correctness boundaries reviewed during implementation

- A normal pre-mutation failure releases only through a sealed, nonce/batch/source-bound live child IPC proof plus actual original child/wrapper reap. Missing, duplicate, signalled, killed or mutation-attempted cases remain held. No saved proof can recreate the capability, and sealed late continuations cannot claim or publish.
- Only a real owned ChildProcess close mints the live terminal capability. It is launch-bound, checked against the original cutoff and cannot be reconstructed from saved JSON. A restart can read/reconcile but cannot release the source.
- Both the original dispatch UUID and semantic tuple remain fenced after UNKNOWN. A fresh batch cannot bypass a retained source claim; a missing private authority cannot silently create a new owner.
- The private ledger uses immutable original expected native batch/source fields. A fixed committed resolver checks database state. No absence, expiry, timestamp age or successful HTTP snapshot proves that an uncertain write did not happen.
- Reader proof freshness is bounded by the earliest original database and per-role reader observation. Current deployed proof is refreshed before dispatch and binds the exact 19 files used by local replay.
- The publication is compiled once with the actual native owned objects. Compiler random IDs are never normalized away or regenerated to retry a packet.
- Token-bearing CURRENT requests reject redirects. The full webpage/API projection and coverage are compared within the existing 45-second verification budget.
- Ledger resolution retains the original overall deadline. A new recovery window authorizes read-only reconciliation only, not publication or source release.

## Database and deployment checks still required

The ledger SQL is source-only. PostgreSQL parsing/execution, trigger behavior, transaction races, durable acknowledgement, RLS/ACLs, effective role privileges and real timeout/crash recovery have not been tested against a database. The transport documents preserve this distinction. A new migration changes the native history/profile and requires explicit qualification; the historical C60 profile must not be reused unchanged.

The optional reader HTTP integration patches are source-only. They retain the existing main and fixed loopback fallback topology. The main application is not patched by placing these files under tools. A new reviewed deployment must provide exact observed reader/build/proof-module pins.

The source capsules preserve historical provenance but are no longer byte-identical whole trees. Six privacy-sanitized derivative files disable the unsupported signed collector and semantic replay; each records original and current hashes. It is not a replacement for the repository application. It must remain quarantined and receive a new build/candidate before live use.
