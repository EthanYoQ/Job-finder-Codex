# Lightweight generated three-source composition

`generated-composition.test.mjs` loads the current pinned sequence builder and the canonical test's synthetic release constructor. The original release validator runs and must produce `CLOSED_THREE_SOURCE_RELEASE` in the fixed order Takeda → Biogen → Hengrui. It renders the closed release in memory, then changes only the outer activation data's `enabled` field. Actual generated source factories, execution bodies, shared cores, close-capability gates, coordinator and source-specific UI code remain unchanged.

The existing full-composition V8 harness is truncated before entry construction to expose its synthetic ports. Original source-specific compiler requests and receipts are retained. Synthetic ports route to the currently started source. Source paths, release/build data and rounds bind to the closed synthetic release. `withKnownNotDispatchedScenarios` supplies explicitly synthetic classification/close receipts.

Hengrui's source ID is `source-hengrui-social`, its company is `company-hengrui`, and its entry is `https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs`. Its synthetic UI returns full canonical Moka job URLs and `companyPresent`, exactly as its original source-specific port expects; the actual Hengrui normalizer creates and validates the SHA-256 IDs. No Biogen fixture is renamed into Hengrui data. Empty projections omit the company from search and retain its directory timestamp card.

## Run

Prepare an external Hengrui fixture set with an existing pinned runtime and dependencies:

```
node tools/dot-auto-controller/fixed-host/sequence/tests/three-source-generated-fixtures.mjs FROZEN_HENGRUI_PACKAGE EXISTING_HENGRUI_RUNTIME_PACKAGE PINNED_NODE EXTERNAL_EVIDENCE_DIR
```

The helper checks original generator/compiler input bytes against the frozen source, then runs the original Hengrui schema50 fixture, original Moka fetch adapter, admission/archive replay, publication compiler and ingestion projection compiler. Its external helper changes only module resolution, the original source-directory reference, synthetic options and diagnostic output. It writes fixtures with 0, 1, 7 and 51 accepted projections; the 51 case also supplies one US and one HK record. The original transport verifies limit 50, offset 0/50 and official Moka request shapes. The original adapter excludes the US/HK records, preserving 53 raw/51 valid evidence and two OUT_OF_SCOPE losses. The zero case retains an actual compiler-accepted total 0 certificate. No production compiler rule or source input is rewritten.

The helper prints a retained manifest path. Run the generated composition with that manifest:

```
node tools/dot-auto-controller/fixed-host/sequence/tests/generated-composition.test.mjs TAKEDA_FIXTURE_JSON BIOGEN_FIXTURE_JSON HENGRUI_MANIFEST_JSON REPORT_JSON
```

`TMPDIR` and caches must point to dedicated external evidence directories. The fixture helper sets TSX_DISABLE_CACHE, NODE_DISABLE_COMPILE_CACHE, TMPDIR and XDG_CACHE_HOME; it preloads the original no-network guard. Every stdout/stderr log and generated fixture/archive is retained, including failures. There is no install, fresh installed tree, runtime/dependency copy, package install, real SQL call, real browser call, activation, cleanup or network request. The composition itself has no runtime dependencies outside Node/Python standard libraries and the source package's JavaScript helpers.

## Coverage

The suite declares 57 cases, counting only cases actually completed in its report:

- Three independent bootstrap, context reads, seed/batch/challenge values, source state roots and due-classification inputs; the later sources observe prior synthetic commits
- Each source's exact NOT_DUE and KNOWN_NOT_DISPATCHED close fact permits the next fixed source, preserving the old failure and recording no new success
- Each source's pending original tool, UNKNOWN, projection corruption, committed-UI failure, MAY_HAVE_BEEN_SENT, signal, half-frame, deferred continuation, raw evidence failure and invalid NOT_DUE produces global HOLD
- If Takeda or Biogen cannot settle, Hengrui factory/preparation/bootstrap/launch remain absent; no source may start before its predecessor's original close fact and awaited durable acknowledgment
- Deferred raw evidence and durable source-settled acknowledgment on each source keep later factories uncreated; on Hengrui they keep the whole entry incomplete
- Hengrui's child terminal can arrive while its original READ_OUTCOME service return is still blocked; cycle completion waits for that original service
- Hengrui's actual source body/core/UI accepts compiler-produced zero, one and 51 projections, including legal total 0, real Moka ID/URL normalization, page-size 50 and US/HK exclusion evidence
- All three actual generated source factories reject JSON-cloned results, forged public status, another cycle key, another factory's capability, and repeated consumption; the valid original capability remains consumable exactly once

The capability case uses a separate test-only lexical accessor over the unchanged generated factory prefix, omitting the coordinator footer. It does not modify any factory or close gate; all other cases execute the complete generated coordinator unchanged. The original synthetic official-tool Promise is returned unchanged to the actual observer.

## Evidence boundary

These are actual generated-source control-flow and authority-composition tests with synthetic external ports. Child/session terminal facts, SQL results, CLI classification, tombstone persistence, UI transport and durable lifecycle receipts are synthetic. They do not establish real child termination, filesystem atomicity, installed source closure, original outer-holder SH/EX behavior or production execution. Those require separate primitive/install/production suites.

All first-public fixture contexts have `latestAccepted=null` and `firstAccepted=null`. Native due logic and 12-hour boundaries are not proved here: `classify-context` is a synthetic port. NOT_DUE with these inputs is deliberately control-flow coverage, not a claim that a native first-public input is not due.

The report records current generated hashes, exact fixture hashes, per-source calls, contexts, due inputs, events and completed scenario count. Default-disabled/no-argument tests remain in canonical tests; no earlier two-source or Hengrui case count is inherited.
