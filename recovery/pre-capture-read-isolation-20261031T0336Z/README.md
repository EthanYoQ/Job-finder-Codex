# Narrow PRE_CAPTURE read-timeout isolation — inactive candidate

**Result:** 18 offline tests pass. Whole retained-history inspection identifies only BI request `48a6599c-69f9-4ac1-b93d-d30f5c3cfc23` as newly eligible. No active runtime, original request, dispatch marker, response, or database was modified. No fresh source capture/new controller round was started.

## Why this can be isolated without settling the read

Both original native producers await a bound `READ_CONTEXT / PRE_CAPTURE` response before capture and before any lease/publication phase. The exact payload has project/source/config/purpose/deadline, not SQL or write authority. The original host validates its source/build binding before recording dispatch. The actual entry always supplies its original reader callback; `readerBeforeQueries()` requires and preserves `REPEATABLE READ READ ONLY`, the original statement timeout and final `ROLLBACK`. Tests build those original SQL strings but never execute them.

BI's original request still has `MAY_HAVE_BEEN_SENT`, no response, and therefore **UNKNOWN** result. Its matching fsynced `CHILD_EXIT` is exit 1 at `2026-10-31T03:04:48.432Z`. Its unique failure artifact is `PRE_CAPTURE_CONTEXT / RELAY_DEADLINE`, with `crawlResult: null`. Its checkpoint contains only that read. Every other request in the same queue belongs to the other two original runs; none is a BI follow-up. Initial `producer-session.json` remains `exitCode: null`; it is not rewritten or used as terminal proof.

This is not a claim that the read was not dispatched, rejected, succeeded, or rolled back. The read-only protocol plus terminal consumer/no follow-up makes it unnecessary to know that read's result before unrelated sources proceed.

## Small runtime change

1. Add `isolate-pre-capture-read.py`; no dependencies or new controller.
2. Call it from the original entry immediately before the existing global pending check. It accepts only an expired, marked PRE_CAPTURE read with strict request/hash/marker binding, a unique original checkpoint, matching failed wrapper/child termination and pre-capture timeout evidence.
3. It scans **all requests in that original queue**, not just unresolved ones: responded PUBLISH, uncheckpointed files, duplicate ownership and same-source follow-ups prevent isolation.
4. Before returning permission to skip that one pending read, the entry invokes `--persist-holds`. A private, exclusive-create `pre-capture-read-hold.json` is placed in the original run, synced together with its directory, and read back. Existing receipts are never overwritten and are synced again, including after an earlier sync failure. Bad receipts or persistence errors abort the entry.
5. On every later entry the receipt re-establishes the source HOLD even if a response arrives later. It also prevents explicit selection of that old isolated queue. The original new-round mechanism is used for unrelated sources; no old request is settled or replayed.
6. The source's existing HOLD check consumes this HOLD before prepare/launch. The original official live-state query, locks, source configuration, source capture, publication review, 8 previously reviewed exact exceptions and unknown-write global blocking are unchanged.

Already-responded historical timeouts are not newly held: real AbbVie/Amgen history provides the regression case. A single-BI hardcoded exception was abandoned before activation; there is no new source/request allowlist here.

## Scope and limits

- This is startup reconciliation of an original, already-terminated producer. It does not cancel a missing connector result or resume the interrupted Functions call. A live/uncertain producer still blocks.
- “No follow-up” is proved for the original producer/batch and its original serial queue, not a claim that the company has never had requests in other historical rounds. All unresolved requests in every other queue still go through the unchanged global check.
- The pure-read guarantee depends on the original fixed reader protocol. This is not a generic classifier for arbitrary READ_CONTEXT SQL; payloads carrying SQL/lease fields are rejected.
- A local HOLD receipt is control/audit state, not a fabricated relay response or publication outcome. Releasing it requires separate reconciliation/authorization; no automatic HOLD-release feature is added.
- `inspect()` alone is read-only and reports proposed receipts. Only the original entry's explicit `--persist-holds` invocation can persist them; it must succeed before the pending scan can consume the isolation set. The candidate has not been invoked with this flag against the real workspace.

## Verification

`PYTHONDONTWRITEBYTECODE=1 python3 recovery104-work/pre-capture-read-isolation-candidate-20261031T0336Z/isolation.test.py`

18 tests use temporary copies of retained real evidence. Integration extracts and executes only the candidate startup segment in a temporary root, then the original serial loop with no capture callbacks. It verifies fresh queues, durable source HOLD across empty sessions, other-source continuation, preservation of old holds, rejection of old-queue reuse even with a response file, failed fsync recovery, and unchanged official query/legacy exceptions. Historical corpus checks are read-only. Original automatic-relay, host-session and explicit-rejection suites also pass; their logs are included.

No database SQL, website capture, full original entry, backup upload, runtime enablement or production new round was executed. Independent review/coordination and the existing private-backup/readback/idle-check procedure remain required before enablement.
