# Schema50 source candidate and registration boundary

This is an unregistered source candidate. No migration, retirement, or publication has been executed by preparing it.

## Separate artifacts

- `vendor/c60-source/prisma/migrations/20261014141000_v75_retired_candidate_fence/migration.sql` is immutable reusable DDL only. It defines the candidate-specific publication fence without requiring that historical candidate to exist. It neither retires candidates nor writes migration bookkeeping. Prior migrations 1–49 remain byte-for-byte unchanged.
- `fixed-host/scripts/render-schema50-retirement.py` renders a separate, review-only one-time transaction for the exact 19-field v75 tuple. It preserves all old candidate identity fields and changes only status to INVALIDATED. It is not a migration runner and does not connect to a database.

## Proposed official-connector bookkeeping

The one-time operation must be reviewed before execution. Its existing formal lock, table locks, complete candidate tuple, PENDING, and already-present/reconcile-only checks remain. It then locks and verifies the exact 49 prior Prisma history records, records an actual transaction-local execution-start timestamp, executes the exact canonical migration50 DDL, inserts one new Prisma-format history row, and retires v75, all in the same transaction.

The new row uses a generated UUID, the actual canonical file checksum, actual execution timestamps and logs explicitly identifying `official-connector` and `prismaEngineExecuted:false`. It never overwrites history or represents the operation as a prior Prisma engine execution. Supabase's provider migration ledger is separate and must record the actual one-time operation; it cannot substitute for this explicit canonical-file bookkeeping.

Any failure must roll back DDL, bookkeeping and retirement together. A result read before COMMIT is not a commit receipt. An unknown outcome requires read-only reconciliation, never blind replay. A missing or conflicting prior history row fails closed.

## Identity and compatibility

The generic historical SQL compiler retains its explicit SQL49 profile for existing callers and adds an explicit schema50 profile. New deployment, host-binding and fixed entry configuration requires schema50's exact version/hash. SQL49 function/trigger checks remain intact. Schema50 additionally binds the fence function body hash and catalog attributes, and the exact enabled, non-deferrable BEFORE ROW INSERT/UPDATE trigger and target. No PostgreSQL-rendered function/trigger MD5 has been invented.

Only a newly committed and rebuilt source/runtime identity may register a new candidate. The old v75 schemaHash, migrationVersion and other identity fields must not be relabeled.

## Qualification still required

Static source tests, pure SQL generation, TypeScript checks and disabled-entry regeneration do not establish database qualification. Before production action, obtain real PostgreSQL evidence for full empty-schema migrations 1–50 replay, existing49→50 transition, missing/disabled/altered fence rejection, history drift rejection, tuple-conflict and post-DDL rollback, multi-connection ordering, and deployed-reader compatibility. No synthetic fixture or source assertion is a replacement for those results.
