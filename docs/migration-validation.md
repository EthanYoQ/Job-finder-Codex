# Migration validation

## Existing-clone procedure

Record row counts and checksums before migration, back up the database, then run:

`prisma migrate resolve --applied 20260710000000_baseline`

Apply pending migrations and compare the post-migration row counts and checksums with the recorded baseline.

For `20260713035000_quarantine_legacy_unbound_manual_batches`, record every pre-existing
`MANUAL_SOURCE` batch before deployment. The migration preserves the row and its legacy
observations, and clears only `kind` and `releaseCandidateId` when the batch is terminal,
has no matching manual request, and has no strict evidence children. A running or otherwise
unsafe unbound batch must stop the migration with
`LEGACY_MANUAL_BATCH_QUARANTINE_UNSAFE_COUNT` before any quarantine update. Do not fabricate
a request or delete the legacy row. If a target already records either
`20260713040000_manual_batch_binding_and_kind_immutability` or
`20260713050000_ai_enrichment_persistence` without recording `20260713035000`, stop for
operator review instead of resolving the new migration as already applied.

## Empty-database procedure

Use only a new PostgreSQL 16 database in an externally isolated container network. The database name must match
`jobfinder_empty_verify_<16-to-64-lowercase-hex-random-characters>`. It must not publish or bind any database port
to the host. This procedure is migration-only: do not run seed, admin bootstrap, registry sync, crawl, backfill, or
lifecycle writes.

Set all of the following inside that isolated runner (values shown for the non-secret controls):

```text
EMPTY_DB_VERIFICATION=1
EMPTY_DB_EXPECTED_DATABASE=<exact random database name>
EMPTY_DB_NETWORK_INTERNAL=1
EMPTY_DB_HOST_PORT_BINDINGS=none
EMPTY_DB_EXPECTED_SYSTEM_IDENTIFIER=<system identifier from isolated provision evidence>
EMPTY_DB_FORBIDDEN_SYSTEM_IDENTIFIERS=<comma-separated source and production system identifiers>
DATABASE_URL=postgresql://<user>:<password>@<network-service>/<exact random database name>?schema=public
```

The URL must use a non-loopback service hostname and no explicit port. Run
`npm run db:verify-empty-migrations`. The command uses the repository-local Prisma CLI and the exact command
`prisma migrate deploy`; it never invokes a shell. Before the first deploy it verifies the selected database, PostgreSQL 16 server
identity, non-template status, empty public schema, and absence of `_prisma_migrations`.
The expected and forbidden system identifiers, internal-network marker, and no-host-port marker must come from and
be bound to the RC's external Docker provision/inspect evidence; the verifier does not self-certify Docker isolation.

Success requires the explicit reviewed set of 20 finished migrations through
`20260714053000_repair_legacy_offline_count_two`, with zero rollbacks; exactly the explicit
reviewed 25 application tables, no extra public application tables, and zero rows in every application table; a
reviewed exact index-name set and canonical `pg_get_indexdef` digest; the reviewed user-type/function contract with
no unexpected view, materialized view, sequence, composite, foreign relation, or standalone base type; a reproducible
normalized schema SHA-256; and a second exact deploy that reports `No pending migrations to apply.`
The command prints only a credential-free JSON report. Any failed check exits nonzero and does not emit the URL,
username, password, child stdout, or child stderr.

Do not run this command against an existing clone, restored RC database, source database, or production database.
The isolated database lifecycle and deletion remain an RC orchestration responsibility outside this verifier.
