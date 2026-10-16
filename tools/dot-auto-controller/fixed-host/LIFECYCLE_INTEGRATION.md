# Cooperative lifecycle integration candidate

This source is not installed or activated. Default inner entry, stable loader and activation wrapper remain disabled/null. No network, production DB, publication or LIVE filesystem mutation was used to build or test it. Source/deployment pins, official remote commit facts, the original registration/raw fence, DB schema and reader qualification remain separate requirements. Passing these tests grants none of those qualifications.

## Supported ownership chain

1. A reviewed stable functions-loader is evaluated outside the replaceable deployment. Its embedded binding pins a stable holder and entry bytes; no deployment file is read to discover that binding.
2. The stable holder loads its own pinned lifecycle module, validates the fixed domain/parent/lock inode, obtains SH and fsyncs a ROUND ACTIVE journal before reading any enabled entry bytes. Missing/replaced/linked lock or any mutation marker is HOLD.
3. Entry bytes are loaded in bounded chunks from that same process/session. Session, serial, holder ID, digest and byte count must match; a final live ping precedes evaluation. Loss/HOLD during loading never evaluates the assembled entry.
4. The private wrapper awaits the actual generated entry's original runLiveRound Promise. That original composition awaits service, observer.settlementPromise and rawEvidenceTask before returning its actual terminal result. The stable wrapper accepts only strict LIVE_ROUND_VERIFIED or SKIPPED_NOT_DUE terminal conditions. No public caller status, boolean or result is a completion argument.
5. The original holder finishes the ROUND journal while still holding SH, then exits and is reaped. Throw/HOLD/pending/unknown or holder death leaves ACTIVE. PID death/age never clears it; EX mutation still refuses even if the kernel lock was released.

CLI subprocesses use the stable sibling `.job-finder-fixed-live-controller-v1.lifecycle-owner/cli-entry.py`, which reads only its stable binding/module before SH, then compiles the pinned candidate CLI. The active candidate CLI requires the original `LIFECYCLE_LEASE` namespace, passes its inheritable fd to subprocesses and retains it across exec. Existing allocation/execution duties are unchanged. The acquisition order is lifecycle → install (if retained) → allocation → execution; reverse/upgrade/re-entry is rejected in the ordered adapter.

## Complete EX transaction API

`with module.exclusive_transaction(domain) as lease:` acquires EX, rejects unknown ROUND/MUTATION and creates/fsyncs MUTATION ACTIVE before yielding. Every candidate read, stage write, publish/rename, fsync and final verification belongs inside that block. Only after full successful verification may the same owned transaction call `lease.finish_mutation_from_owned_transaction()`. Exiting, throwing, EOF or crashing without that call leaves MUTATION ACTIVE. All subsequent SH/EX acquisitions reject it. This is a held transaction, never a detached write permit.

The fixed activation wrapper's no-argument `activateFixedDeployment()` starts one exclusive-holder session. That same process compiles and calls the original pinned helper for qualify, stays EX while the original execute_sql Promise settles, passes the original raw fence to commit, verifies the original receipt, and only then sends private finish. Commit success alone does not clear MUTATION. A holder killed after put/enabled creation but before finish leaves a marker that prevents new readers and writers.

External activation integration must preserve the original helper checks and pass the identical EX lease through its `pinned_module` namespace into the candidate CLI/builder (`'LIFECYCLE_LEASE': globals()['LIFECYCLE_LEASE']`). Never reopen SH or call flock(SH) on an EX descriptor: duplicated descriptors share an open-file description and can downgrade EX. No adopt-fd API exists.

`read_reconciliation_diagnostic(domain)` only reports ROUND/MUTATION marker presence under a private diagnostic SH lock. It does not delete, repair, reconcile DB state, grant authority or recover UNKNOWN. Recovery requires separate reviewed original evidence. No new scheduler or daemon is introduced.

## Deterministic fixed domain rendering

`render_offline_module(source, cases_root)` restricts tests to private case-* under a lifecycle-cases root and rejects LIVE. `render_fixed_module(source)` is a separate pure bytes renderer: only the exact parent `/workspace/scratch/5e9614251709` and target `job-finder-fixed-live-controller-v1` are accepted. It requires the stable sibling owner directory to be current-UID/0700; fixed parent ancestors must not be group/world writable. No environment variable or authorization boolean broadens the domain. Runtime Domain embeds measured parent and lock device/inode identities. Missing locks are never recreated by runtime/activation; only an explicit first-install owner uses one-time O_EXCL provisioning.

`render_fixed_owner_bundle(sources, domain, entry_sha256, entry_bytes, cli_sha256, activation_helper_sha256=None, deployment_binding=None, registration_sql=None)` generates stable module, binding, CLI, SH holder/loader and optional EX holder/activation wrapper. It performs no filesystem I/O and enforces the exact fixed domain and pinned stable paths. The caller must supply the actual installer-provisioned inode domain, canonical pinned sources and original qualified activation binding. Generated files must be published by that installer under the full EX mutation transaction, not written after lock release. It does not generate or fabricate an official remote fact.

## Evidence and limits

All writable test cases and JSON/log evidence live outside source under candidate `evidence/lifecycle/`. Test source belongs under fixed-host/tests; no cases, __pycache__, dependency tree or dist output belongs in a source manifest.

- 29 real-process primitive regressions run against the current module: EX↔SH, parallel SH, cross exec/fork, death release, missing/link/replaced inode rejection, partial disabled states, journal death fence and order/no reverse deadlock. One inherited original test's TextIO/select buffering race was fixed by raw-fd event buffering; no lock assertion was relaxed.
- 9 mutation/fixed-renderer tests: no finish/exception/partial/link marker fail-closed, same-owned finish once, EX never downgraded, read-only reconciliation, exact fixed-domain pure rendering and TEST_ONLY scope separation.
- 9 bridge tests: real Python SH holder; synthetic small JS/tool ports exercise pending original Promise, terminal-before-settlement, holder death, load loss, session confusion, HOLD, throw and bad receipts.
- 5 activation bridge tests: real Python EX holder; synthetic helper/raw DB Promise exercise original await coverage and put-before-finish SIGKILL. These do not substitute for original helper/source/remote/registration qualification.
- 3 full composition scenarios reuse the actual current generated execution body (byte-equal tail) and existing full-composition fake ports: success, not-due, terminal-before-late-publication settlement. Only deployment/activation/bootstrap data are synthetic. Real Python holder and real competing EX processes; SQL/UI/worker ports are synthetic.
- The parent independently tested the actual functions.exec PTY tools with two small synthetic entries. The author bridge tests simulate exec/write_stdin transport using real subprocess pipes; they are not the actual tool shell.

Threat model is trusted, cooperative, same-UID supported entry points. This is not protection against a malicious same-UID process, debugger, kernel attacker or arbitrary direct execution. The stable wrappers must be the configured supported scheduler/manual entrances; allocation and execution locks remain required. Final installer stage/publish verification and original activation-helper qualification are owned by the separate integration candidate and must be tested against its final real source pins before any production claim.
