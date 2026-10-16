# Lightweight generated two-source composition

`generated-composition.test.mjs` loads the current pinned sequence builder and the canonical test's synthetic release constructor. The original release validator runs. It renders the closed release in memory, then changes only the outer activation data's `enabled` field. The actual generated Takeda and Biogen factories, source execution bodies, shared cores, close-capability gates, fixed order, and source-specific UI code are unchanged.

The existing full-composition V8 harness is truncated before entry construction to expose its synthetic ports. Its original source-specific request/receipt data are retained. Synthetic ports are routed to the currently started source. Source paths, candidate/build data, source-specific UI values, and rounds are adjusted to the closed synthetic release. The existing `withKnownNotDispatchedScenarios` supplies synthetic classification/close receipts.

Run:

```
node tools/dot-auto-controller/fixed-host/sequence/tests/generated-composition.test.mjs TAKEDA_FIXTURE_JSON BIOGEN_FIXTURE_JSON REPORT_JSON
```

No installation, fresh TEST_ONLY installed tree, runtime/dependency copy, package install, official SQL call, browser call, activation, or network request is performed. Fixtures and report files must remain outside the candidate package. The current run uses the existing Takeda lifecycle fixture and a newly generated Biogen fixture from the original schema50 Biogen fixture/compiler using an existing pinned Node 22 runtime and existing dependencies. No fixture is fabricated by translating Takeda's business rules into Biogen's.

## Coverage boundary

The cases exercise actual generated sequential composition with synthetic transport/SQL/UI/lifecycle ports:

- A success followed by B's independent bootstrap, seed, batch, challenge, source path, and fresh context after a synthetic A commit
- A NOT_DUE and exact KNOWN_NOT_DISPATCHED followed by B
- A original tool pending, UNKNOWN, projection integrity failure, committed UI failure, MAY_HAVE_BEEN_SENT, signal, and half-frame all keeping B preparation/bootstrap/launch at zero
- Deferred raw evidence and deferred durable source-settled acknowledgment keeping B unstarted until release
- Deferred record/mark continuation and half-frame failures preventing late publication and B startup
- Raw evidence failure and nonzero NOT_DUE holding globally

The original synthetic tool Promise is returned unchanged to the actual observer. No public status or JSON record is substituted for the original closure's private close capability.

Both original fixture contexts have `latestAccepted=null` and `firstAccepted=null`; this establishes explicit first-public input coverage for both source factories. The `classify-context` port remains synthetic. This suite does not prove the native due algorithm or its 12-hour boundaries. The NOT_DUE case deliberately supplies a synthetic due-classification response, so it is control-flow coverage rather than a valid first-public/native-due combination.

Child/session terminal facts, CLI classification, tombstone persistence, and lifecycle receipts in this suite are synthetic. It does not prove actual child process termination, filesystem atomicity, installed source closure, original outer holder SH/EX behavior, or official production execution. Those require the distinct primitive/install/production suites. Default-disabled/no-argument and cross-cycle/token tests are maintained separately and are not included in this composition count. No prior c53 case count is inherited.
