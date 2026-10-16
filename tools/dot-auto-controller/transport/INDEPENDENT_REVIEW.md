> Historical pre-sanitization review. Its listed source hashes and real-runtime fixtures describe the earlier source only. They do not qualify the privacy-sanitized derivative or approve activation. Current derivative checks are reported in the package VALIDATION.json.

# Independent review: restricted publication transport

## Disposition

Suitable for a Draft PR and further review as an **inactive prototype**. It is **not production-ready and is not approved for activation**. The local correctness/security defects listed below were addressed and their regressions passed. Provisioning, durable cross-workspace fencing, live database permissions, and complete production orchestration remain unverified or unimplemented.

This review was local only. No database was accessed, no external network request was made, no credentials were read, and no running producer/host state was changed. Synthetic acquisition evidence used temporary directories and was removed. Generated publication SQL was never executed.

## Reviewed changes and verified fixes

1. **Semantic replay after UNKNOWN.** The initial implementation burned only an in-memory ticket and request UUID. Re-preparing the same publication after UNKNOWN produced another send. The revised journal also exclusively claims the original project/candidate/source/batch/source-result tuple. Independent tests cover restart, concurrent separate tickets, and a zero-byte crash marker.
2. **Unbounded response and teardown waits.** The initial implementation could await a response or connection teardown past its original deadline and accept a late acknowledgement. The revised transport enforces absolute waits, classifies uncertain completion as UNKNOWN, preserves the claim, and persists results without waiting for socket teardown.
3. **Accidental activation.** The string `"false"` initially activated transport. Only boolean `true` now activates it; other values cannot open a connection.
4. **Half-open connection leak.** A blackholed session-identity query initially survived the outer connection wait. The factory now bounds connection plus identity verification and closes its own client on expiry.
5. **Untrusted code attesting itself.** The first relocatable compiler imported the target runtime's verification and compiler modules before checking its integrity. A synthetic altered root could report the expected build and run its compiler. The revised, independently implemented verifier uses Node builtins and checks the executing Node binary, dependency lock, complete canonical source/runtime trees, and commit before importing any target runtime code or its TypeScript loader. The hostile-root regression passes under the actual approved Node 22 binary, not just an unsupported Node version.
6. **Owned-admission module identity.** A separate loader namespace risked separating the producer's private issuance WeakMap from the compiler's copy. The revised factory uses the default loader and canonical module URLs. A real existing-producer acquisition/archive/admission flow, with HTTP responses replaced by synthetic fixtures, successfully compiled through the factory into the original atomic publication SQL.

7. **Control/ledger expectation drift.** The factory now snapshots plain control, pending and identity data before its first await, retains the original owned admission/result objects, and checks the compiled terminal tuple again. The native fixture verifies exactly one read of caller control and confirms that the ledger expected batch is the same original snapshot.
8. **Resolver timestamp assumptions.** Initial resolver ordering was stricter than the original publication's allowed one-second clock skew, and compared millisecond-rounded batch timestamps with a microsecond lock timestamp. The proposal now retains that skew and rounding tolerance. Independent arithmetic/structural regressions cover successful cases that the old predicates would falsely hold; actual PostgreSQL timestamp behavior remains an execution-test requirement.
9. **Synchronous acknowledgement boundary.** PostgreSQL startup now requests and verifies synchronous_commit=on; the source-only claim and resolution functions reject another setting. This was checked offline. It does not establish actual server/storage durability without database qualification.

The original publication compiler is retained. Its original evidence cutoff and database-time gates remain in the SQL; no replacement SQL writer was introduced. A transport success means the bounded driver acknowledgement was received and recorded. It is not a substitute for the existing exact persisted-commit, batch-finalization, and holder checks.

## Verification evidence

- Approved Node v22.23.3: 89/89 tests passed, zero skipped (`independent-final-results.tap`). This includes transport, connection, journal, reader-template, ledger-wire/static-SQL tests and independent negative-boundary regressions. All SQL-related tests are offline structural checks or arithmetic models, not database tests.
- Pure-Node portable-factory integration passed (`independent-portable-compiler-results.log`): reviewed source/runtime/lock pins, actual context compiler, changed-build rejection, hash-pinned read-only reader SQL, and parameterized outcome SQL.
- Real owned-admission integration passed (`independent-owned-admission-results.log`): original source fetch/adapter/archive/issuer and original publication compiler, synthetic Hansoh responses, no database execution. The final run also verifies a single caller-control snapshot, an unchanged original expected batch, and successful validation of the real compiled packet by the ledger wire contract. It ran against the final frozen compiler revision.
- Final reviewed bytes and evidence hashes are recorded in `independent-review-manifest.json`.
- The old absolute-path `existing-compiler.mts`, its old integration test, and its old tsconfig/typecheck artifacts are superseded and should not be included as the deployable implementation.

## Ledger and reader proposal review

Static review found the revised ledger source to preserve immutable request/tuple/holder/hash bindings, a permanent native-tuple fence, one global unresolved slot, four fixed non-SQL-taking APIs, a separate NOLOGIN owner, private-schema revocations, and owner-only ledger RLS. Its resolver compares the original 57 source fields and planned batch fields through native composite types, checks batch counters/member hashes/released holder in one native SELECT snapshot, and locks only its own ledger row. The independent field-map test compares these names with the original exact-outcome implementation.

There is deliberately no absence/rollback/clear resolver. Missing or nonexact native evidence returns HOLD and cannot release the global slot. A crash after a durable claim but before a send can therefore require separately reviewed/manual recovery indefinitely; expiry alone does not unlock it. This is an explicit safety/availability boundary, not an implemented automatic recovery path.

A claim result row is not necessarily a committed claim. Production must use a new independent autocommit request, await the complete driver transaction acknowledgement, retain synchronous WAL acknowledgement, and only then invoke native publication. A caller-controlled outer BEGIN would invalidate that guarantee. The actual client/database integration must prove this boundary.

The reader adaptation hashes the entire fixed template and changes only one strict, deployment-owned candidate identifier literal. Request data cannot select the candidate or change another SQL byte. A new candidate still requires the independently approved new runtime/profile; this substitution does not authorize registration or deployment.

No PostgreSQL parser, database engine, actual SQL function call, RLS/ACL check, transaction race, or trigger test was run. Passing the offline ledger tests is not evidence that installation or native publication succeeds in PostgreSQL.

## Activation blockers and limits

1. **Durable authority is source-only and not provisioned.** A private, identified, fsynced local journal is not durable across workspace deletion, daily cleanup, or independent replicas. It cannot be the sole production authority. Concrete same-project ledger SQL and four fixed APIs have now been implemented as proposal source. They still require SQL parsing/execution, privilege/RLS, concurrent-claim, crash/timeout/recovery tests and explicit provisioning authorization. Ordinary Drive create/list operations are not an atomic unique-claim substitute.
2. **Database changes affect the reviewed profile.** Adding an execution-ledger migration can violate the original compiler's exact migration-history guard. Any approved change must reconcile the migration/profile and candidate identity deliberately; it must not be described as leaving all production SQL/profile assumptions unchanged.
3. **Credentials and least privilege are not provisioned or proven.** The role, secret-provider setup, verified endpoint/CA, real TLS connection, actual ACLs, inherited memberships, ownership, callable privileged functions, and required table-lock privileges were not tested. Checking the login role's own flags does not establish its effective permissions. Direct table grants do not create a server-enforced fixed-action SQL API.
4. **Production orchestration remains required.** The entry point must run one source per process, use the trusted pure-Node bootstrap before unverified preloads, pin the actual production build/candidate/source, use the durable authority, and preserve the original total budget. An UNKNOWN publication must block later publication, wait through the original publication cutoff when required, and reconcile the retained tuple using a separate read-only window inside the original total budget. A null read while the original write may still be running is not proof of failure.
5. **Live end-to-end behavior was not exercised.** The actual Supabase project, deployed Aliyun `job.orz.md` reader, real publication permissions, original deferred database gates, and post-publication reader behavior remain activation checks. Synthetic local fixture success must not be reported as a real job publication.
6. **The filesystem and startup environment remain trusted deployment inputs.** Integrity pins are not an OS sandbox. The approved runtime must stay immutable while used, and the transport package/launch environment must themselves be reviewed. No request may choose a runtime root, loader, compiler, or new pin set.
