# Automatic publication transport: reviewed local implementation and deployment decision

## Result and scope

The new transport removes the Supabase MCP tool from the per-publication program interface. It does not wrap `execute_sql` and call that automation. The deployed program can use the existing pinned `pg` client directly after a dedicated credential, privileges, a reachable network route, and a durable dispatch authority have been explicitly approved and verified.

The current code is not activated. The C60 pins are a reviewed reference, not a claim that a newly created PR commit is already the registered production build. Regenerate and independently approve deployment pins for the final checkout/candidate; never relabel a changed tree as C60. No role, password, credential configuration, schema, database row, active host, old publication packet, or Aliyun service was changed. The current Takeda publication UNKNOWN is outside this work and must not be retried.

The route remains dot cloud capture → the same Supabase project → the original Aliyun reader at job.orz.md. Aliyun performs no capture. Source-specific routes and fixes remain in the original source runtime. This package does not replace the 20/13/3 routing matrix with a generic collector.

## Source facts checked

- `ops/cloud-pilot-host/host-helper-functions.js` and the restored host helpers use Supabase MCP `execute_sql` at the dispatch boundary; the host stage returns `AWAITING_PARENT_REVIEW` for publication.
- `src/crawler/cloudDbStartedPilot.ts` owns the existing DB-started publication and reconciliation sequence.
- `scripts/p0-cloud-portable-source-pilot.ts` has TWO paths. Its selected `dbStartedControlPath` branch (lines 82–106 in the reviewed C60 runtime) retains original portable acquisition/admission/archive recovery and calls `runDbStartedCloudPublication`. The later legacy branch uses separate lease/pending/commit/finalize. This adapter only covers the already-selected DB-started branch; it does not silently switch between them.
- `src/db/ingestionRepository.ts:compileDbStartedCloudSourcePublication` mints random holder, row and SQL delimiter IDs. Recompiling an old request is not a valid byte-for-byte verification method. The new transport compiles once in the trusted process and stores an opaque one-shot ticket.
- The existing compiler retains `formal-crawl`, expiry, table/row locks, history/function/trigger checks, original IDs, portable admission and GRACE behavior, and deferred commit checks. A single simple-query `SET LOCAL; DO ...` remains the exact publication SQL; no additional SQL is appended.
- `pg` is already pinned at 8.16.3. Reviewed Node is v22.23.3. Before importing any target module or its TypeScript loader, an independent builtin-only verifier in this package checks /proc/self/exe, the complete source/runtime trees (including dependencies), dependency lock hash and actual Git/build identity. The factory then checks fixed per-process source binding.

## Interface and trust boundary

`createRestrictedTransport({compiler, journal, openConnection, activated, now})`

- `prepare(kind, structuredInput, binding)` calls a deployment-fixed compiler once and returns `{ticket, request, binding, packet}`.
- `dispatch(ticket, {assertScope, verifyPublicationReady})` accepts only the original ticket minted by that transport instance. A serialized/copy/restored request cannot create a ticket.
- Supported operations: `READ_CONTEXT`, `READ_PUBLICATION_CONTEXT`, `READ_READER_CONTEXT`, `PUBLISH`, `READ_OUTCOME`. There is no raw-SQL API, SQL CLI flag, arbitrary RPC endpoint, role selector or request-selected import path.
- The fixed `READ_READER_CONTEXT` prototype is scoped to the reviewed Takeda C60 snapshot query. Its original transaction is `BEGIN ... READ ONLY; SELECT ...; ROLLBACK;`, not COMMIT. Other source/candidate reader profiles remain unsupported until separately ported and reviewed.
- `binding` includes original project/source/config/candidate/batch/source-result identity and absolute dispatch, publication and wrapper deadlines. The transport may shorten, never extend, those deadlines.
- A durable claim is recorded before the final synchronous scope/deadline check and the sole query invocation. Missing/ambiguous replies, malformed completions and failed result persistence remain UNKNOWN. No retry occurs.
- New tickets for the same original publication tuple are fenced by the durable journal, not merely by request UUID.
- The existing real deployed reader gates are still required. `verifyPublicationReady` is an injection seam for the controller's fixed reviewed implementation; an arbitrary callback returning true is NOT evidence that the reader check happened.
- A transport success means the driver completed the query. It does NOT mean frontend publication or exact persisted outcome verification is complete. The controller must reuse the native `inspectPersistedAtomicCommitOutcome`, batch SUCCESS/counter check, holder release check and after-publication reader verification.
- After UNKNOWN, retain the original tuple and wait until the original publication expiry before interpreting absence. A disconnected client or an early null read is not proof of rollback.

This is application containment. A database credential with table/column grants can still issue other SQL within those privileges if stolen. The local whitelist is not a server-side fixed-operation security boundary.

## Recommended path and alternative

### Recommended: existing native compiler + dedicated Postgres role + same-project dispatch ledger

This minimizes changes to acquisition and atomic publication. A small private control ledger in the SAME Supabase project supplies crash-safe dispatch intent and unresolved-run fencing. No new service or credential provider is assumed. The new DB objects and role/privileges require a separate exact action confirmation before deployment.

A direct connection is appropriate for a persistent Node process; session-mode Supavisor is the IPv4 alternative. Use one connection, verified TLS, a verified project host, a dedicated login and no `postgres`, secret API key or `service_role`. Transaction-mode pooling is intentionally not enabled by this implementation. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) and [node-postgres SSL](https://node-postgres.com/features/ssl).

The initial immutable ledger claim must be durably committed before native PUBLISH. A lost ledger acknowledgement never authorizes native PUBLISH. On reboot, load unresolved intents and reconcile them read-only; do not mint fresh IDs to evade the fence. `LEDGER_PROPOSAL.md` specifies the required schema/API and verification work. No partially implemented ledger is represented as production-ready.

Adding a registered migration changes the exact migration-count/hash expectation in the original compiler. The old frozen C60 packet cannot continue unchanged after that. Deployment needs a new reviewed migration profile/build/candidate, while retaining the SAME checks, mutex, deadline and lifecycle rules. Do not skip migration history, weaken the guard, or pretend role/table changes are invisible.

### Alternative: fixed database publication functions

A private, non-exposed API accepting typed data rather than SQL can give a caller EXECUTE only, keeping DML in a tightly scoped NOLOGIN function owner. This offers stronger credential containment than table grants. However, it moves the publication program into database functions and requires a larger audited port of every native guard, source policy and deferred trigger behavior. It is not a minimal transport swap.

A function accepting `sql text` and executing it dynamically is forbidden. `supabase-js.rpc()` alone is not a permission boundary. A secret/service-role key maps to an elevated role and defeats the intended isolation. Function ACLs and owner privileges require explicit audit; public EXECUTE defaults must be revoked. See [Supabase functions](https://supabase.com/docs/guides/database/functions), [API security](https://supabase.com/docs/guides/api/securing-your-api), and [API-key roles](https://supabase.com/docs/guides/getting-started/api-keys).

## Direct-role minimum privilege proposal

This is an exact object-scope proposal to refine against FRESH catalog inspection, not an executed grant and not proof that current production ACLs permit it.

Principal: `dot_jobfinder_writer`; no superuser, BYPASSRLS, CREATEDB, CREATEROLE, replication, role memberships, table ownership or grant option. Initially NOLOGIN until secure credential setup is complete. Use a bounded expiry and a single connection. No grants to anon/authenticated/PUBLIC are added.

- CONNECT only to database `postgres`; USAGE on `public`, `extensions`, and the private execution-ledger schema.
- SELECT: `Company`, `RecruitmentSource`, `ReleaseCandidate`, `_prisma_migrations`, `CrawlCoordinatorLock`, `Job`, `CrawlBatch`, `CrawlBatchSourceResult`, `EvidenceArtifact`, `PaginationEvidence`, `LossLedgerEntry`, `TransportAttemptEvidence`, `TransportAttemptArtifact`, `CrawlObservation`, `LifecycleSetEvidenceMember`.
- INSERT: `CrawlCoordinatorLock`, `Job`, `CrawlBatch`, `CrawlBatchSourceResult`, and the seven append-only evidence tables listed above. Narrow INSERT columns to the reviewed compiler output if catalog tests prove that compatible.
- UPDATE `CrawlCoordinatorLock`: holderId, acquiredAt, heartbeatAt, metadata.
- UPDATE `Job`: sourceJobId, officialTitle, officialUrl, listUrl, locationRaw, city, cities, officialPublishedAt, lastSeenAt, missingSuccessCount, lifecycleStatus, visibleInFrontend, isNew, sourceChangedAt. Do not grant updates to ownership, firstSeenAt, auxiliaryChineseTitle, category, human/AI overlay columns or other columns.
- UPDATE `CrawlBatch`: transportSucceededCount, adapterSucceededCount, completenessVerifiedCount, atomicCommittedCount, aggregateJobSetSha256, heartbeatAt, finishedAt, status, matching the DB-started finalization statement.
- UPDATE `CrawlBatchSourceResult`: the exact terminal-data columns generated by `sourceResultTerminalData`; exclude id/releaseCandidateId/batchId/sourceId/sourceConfigHash/adapterVersion/officialEntryId/officialSurfaceIds/officialChannelIds/startedAt/createdAt. Generate and review the exact column list from the fixed compiler before granting.
- PG17 MAINTAIN on `_prisma_migrations`, `Job`, `CrawlBatch`, `CrawlBatchSourceResult`, `CrawlObservation` for the original SHARE / SHARE ROW EXCLUSIVE table locks if column-level UPDATE grants do not satisfy table-lock ACLs. MAINTAIN also permits maintenance operations and must be disclosed; it is not “read only”. The last known server was 17.6; recheck before granting. [PostgreSQL LOCK](https://www.postgresql.org/docs/17/sql-lock.html).
- FOR SHARE also requires UPDATE on at least one column of each selected reference table. Proposed narrow columns: `ReleaseCandidate.commitSha` (existing immutable-identity trigger must be freshly verified), `Company.updatedAt`, `RecruitmentSource.updatedAt`. The latter two allow timestamp changes; disclose that. Do NOT use id: existing foreign keys have ON UPDATE CASCADE. [PostgreSQL SELECT privileges](https://www.postgresql.org/docs/17/sql-select.html).
- EXECUTE only on the required pure `job_projection_canonical_json(jsonb)`, `job_persisted_projection_sha256(public."Job")`, `job_delta_effective_legacy_certificate(jsonb,text,jsonb,timestamp)` and `extensions.digest(bytea,text)` if not already safely available. Trigger functions are not made generally executable to fix errors blindly; inspect actual invoker dependencies and test.
- The private ledger gets only its fixed function EXECUTEs if that proposal is selected. No generic SQL executor.
- No DELETE, TRUNCATE, CREATE schema/object, ALTER owner, auth/storage/admin data privileges, or ability to SET ROLE to a privileged role.
- Exact proposed column/object names are also in `privilege-proposal.json`. Object/column ACLs do not isolate the 36 source IDs; this remains an application policy unless the stronger fixed-function alternative is chosen.

Before activation, inspect existing PUBLIC grants, role inheritance, RLS, function owners/search_paths/EXECUTE and constraint/trigger definitions. A new NOINHERIT role still receives PUBLIC privileges. Do not solve an RLS failure by adding BYPASSRLS or disabling RLS. Any newly discovered extra permission is a new decision, not an automatic escalation.

## Exact one-time action confirmation and secure handoff

The release owner must first choose the reviewed strategy and finish catalog/network checks, then show a precise confirmation for:

1. The same Supabase project, the named role(s), exact object/column/function grants, MAINTAIN and reference-row-lock risks, credential expiry and revocation method.
2. The selected private execution-ledger schema/functions/migration and the new build/profile/candidate required to retain exact history checks.
3. Persistent use of ONLY that credential by the dot-cloud producer at the verified database host. No browser/frontend/Aliyun copy and no high-privilege API key.
4. The secure user handoff for creating/entering the credential and granting persistent access. Do not ask the user to paste a password into chat, a source file, a Library upload, backup, SQL argument or command line. Do not promise a secret-entry UI or secret store that has not been verified.

`passwordProvider` is deliberately an unimplemented secure-injection interface. This package does not discover, extract, create, save or configure credentials. A supported secure provider/handoff is still an activation blocker. Once configuration is approved and verified, normal bounded program operations do not need a new MCP SQL request each round. That does not waive future security changes or other required confirmations.

## Deployment and stopping gates

1. Resolve the existing UNKNOWN run read-only. Never dispatch its packet again.
2. Finish code review, create the requested draft PR and send its verified link. Do not merge before the user's third-party review.
3. Reconcile the destination checkout and make the import root/pins reproducible. Ship only source/tests/docs/fixed SQL; no node_modules, credentials, artifacts or private raw evidence.
4. Obtain fresh healthy DB/catalog identity and a permitted network route. Current credential-free probe of `db.yiopvxysxrtrnvqxwgbx.supabase.co:5432` failed DNS on 2026-10-09 06:13:48 UTC. No TCP/TLS/authentication happened. This is not proof of an IPv6-only failure and not a database-health finding. Do not guess a pooler region or bypass network denial.
5. Approve and install the exact selected privileges/ledger and safely configure the credential. Rebuild/re-register the required profile; do not patch frozen old packets.
6. Verify TLS hostname/CA, login identity, least privileges, connection loss, SQLSTATE handling, unique ledger claims and restart recovery on a suitable test environment. Offline tests are not this verification.
7. Start a fresh canary on its original source route. Run actual before-reader gates, native acquisition/admission, intent claim, single native publication, exact outcome and after-reader checks. Verify untouched sources.
8. Expand only to already validated routes with their own pinned reader/source/runtime profiles. Reject unsupported paths rather than falling back.

## Local journal and recovery

`createFileJournal(directory,{expectedAuthorityId})` requires a pre-existing private directory and matching private `authority.json`. It never initializes a missing/empty replacement. It fences both request UUID and original semantic publication tuple, and fsyncs files and directory entries.

This local journal alone is NOT sufficient across daily dot-cloud workspace cleanup. Missing authority means fail closed. Restoring a stale snapshot and continuing publication is not allowed. Existing authorized Drive backups may retain nonsecret audit/checkpoint material, but ordinary Drive create/list is not a cross-worker atomic unique claim. A tool-based backup bridge is not a standalone program transport. The same-project ledger is the recommended authoritative fence; Drive remains backup/review storage.

## Verification completed here

- No-network tests cover exact single dispatch, opaque tickets, parallel calls, tuple replay after restart, scope/deadline drift, strict activation, result loss, missing authority, fake-driver TLS/role enforcement and query/identity timeouts.
- The fixed TypeScript prototype passed the existing compiler typecheck. The relocatable factory and actual Node/build/source/query pins are independently reviewed before packaging.
- No live restricted-role test, live TLS/database connection, live ledger migration, fresh capture or publication was performed.

## Source implementation update: private ledger and new reviewed reader candidate

The durable-ledger direction is now implemented in `proposal/jobfinder-control-ledger.sql` and its fixed wire contract/tests; see `LEDGER_PROPOSAL.md` for the exact 4 APIs, full original expectedBatch retention, server-side source/batch/member/holder verification and permanent HOLD boundary. Earlier references to a ledger as future design describe deployment status, not missing source code. No live PostgreSQL execution/transaction/ACL evidence exists. Absence resolution remains deliberately unavailable.

`reader-template.mjs` allows only a trusted, separately reviewed candidate identifier to replace the one historical literal after verifying the entire original fixed reader SQL hash. It adds no arbitrary SQL or runtime path and does not weaken full runtime identity verification. `expectedReaderCandidateId` must come from trusted deployment configuration and match the request binding.
