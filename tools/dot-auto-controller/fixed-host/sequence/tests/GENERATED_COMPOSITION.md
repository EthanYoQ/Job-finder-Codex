# Lightweight generated four-source composition

`generated-composition.test.mjs` loads the current pinned sequence builder and the canonical test's synthetic release constructor. The original release validator must produce `CLOSED_FOUR_SOURCE_RELEASE` in fixed order Takeda → Biogen → Hengrui → UCB. It renders the closed release in memory and changes only the outer activation data's `enabled` field. Actual source factories, execution bodies, shared cores, close-capability gates, coordinator and source-specific UI code remain unchanged.

The existing full-composition V8 harness is truncated before entry construction to expose its synthetic ports. Original source-specific compiler requests and receipts are retained. Synthetic ports route to the currently started source. Source paths, release/build data and rounds bind to the closed synthetic release. `withKnownNotDispatchedScenarios` supplies explicitly synthetic classification/close receipts. The generated code never receives ambient SQL, browser or executor tools.

## Source identity and fixture construction

Takeda and Biogen reuse their retained original compiler fixtures. The Hengrui fixture manifest reuses its original Moka compiler fixtures with 0, 1, 7 and 51 accepted projections. Its 51 case carries 53 raw jobs, excluding US/HK through the original adapter. Hengrui UI packets expose canonical Moka URLs, and the unchanged native normalizer checks their IDs.

UCB fixtures are produced by `four-source-generated-fixtures.mjs`, using the original `ucb-synthetic-fixture.mts`, `ucb-phenom-synthetic.mts`, owned acquisition/admission/archive replay, publication gate, schema50 compiler and ingestion projection compiler. The helper checks relevant source files and reader pins against the current package before importing them from an existing read-only runtime with its existing dependencies. It neither copies dependencies nor installs anything.

UCB's actual synthetic HTTP rows have `jobSeqNo` different from `reqId`. All generated native source-job IDs are checked against the hash of the original JSON-encoded `jobSeqNo`, rather than any URL fragment. One actual admitted/compiler variant supplies a same-origin `applyUrl` at `/global/zh/apply/...`, outside the usual derived `/global/en/job/<reqId>` shape. Its compiler-produced exact URL is preserved into public projection and UI. UI packets expose raw URLs; the unchanged UCB receipt-bound URL/native-ID join must handle the differing identifiers and application URL. No Hengrui/Biogen fixture is renamed into UCB.

The UCB helper emits four variants: seven jobs, seven jobs with the application URL, an explicitly verified empty result, and an original lifecycle GRACE successor (two baseline jobs, then one present job after thirteen synthetic hours). A test-only clock preserves native Date identity across structured cloning. HTTP transport, SQL rows and clock are synthetic. Admission, source fetch adapter, original compilers and lifecycle reducer are actual code.

## Run

Build UCB fixtures, keeping scripts, archives, logs and caches in a new external evidence directory:

```
PINNED_NODE tools/dot-auto-controller/fixed-host/sequence/tests/four-source-generated-fixtures.mjs CURRENT_PACKAGE EXISTING_RUNTIME_PACKAGE PINNED_NODE EXTERNAL_EVIDENCE_DIR
```

The helper prints a retained manifest path. Use it with the existing Takeda, Biogen and Hengrui fixture inputs:

```
PINNED_NODE tools/dot-auto-controller/fixed-host/sequence/tests/generated-composition.test.mjs TAKEDA_FIXTURE_JSON BIOGEN_FIXTURE_JSON HENGRUI_MANIFEST_JSON UCB_MANIFEST_JSON REPORT_JSON
```

Set `TMPDIR` and `XDG_CACHE_HOME` to dedicated external evidence directories, and set `TSX_DISABLE_CACHE=1` and `NODE_DISABLE_COMPILE_CACHE=1`. The fixture helper additionally supplies those settings for its child, preloads the original no-network guard, and imports the existing runtime's TSX loader. Every helper, archive, stdout/stderr log and generated fixture is retained, including failures. Reports use exclusive creation. There is no fresh installation, runtime/dependency copy, build/measure command, real SQL/browser call, production activation, cleanup or live request.

## Generated-entry coverage

The suite declares 82 cases, counting only cases actually completed in its report:

- Four independent bootstrap/context reads, seed/batch/challenge values, state roots, stable CLI names and due-classification inputs; later sources observe prior synthetic commits
- Each source's exact NOT_DUE or KNOWN_NOT_DISPATCHED close fact permits continuation, preserving the old failure and recording no new success
- Each source's pending original tool, UNKNOWN, corrupt projection, committed-UI failure, uncertain dispatch, signal, half-frame, deferred continuation, raw evidence failure, invalid NOT_DUE, and invalid committed receipt causes global HOLD
- No later factory, prepare, bootstrap or launch occurs while a prior source is unsettled; in particular UCB remains absent when Takeda, Biogen or Hengrui holds
- Deferred raw evidence and durable source-settled acknowledgment on every source hold the next source or final cycle close
- Hengrui's original publication Promise is held before UCB; its actual original Promise is returned unchanged to the observer
- Hengrui's child terminal can arrive while the original READ_OUTCOME service return is blocked; UCB remains uncreated until that service and the close fact settle
- Original Hengrui zero/one/51 and UCB zero/application-URL/GRACE projections execute the actual generated source body/core/UI
- All four actual factories reject JSON-cloned results, forged status, cross-cycle tokens, foreign-factory capabilities and repeated consumption; the original close capability is consumable exactly once

The capability case uses a test-only lexical accessor over the unchanged generated factory prefix, omitting the coordinator footer. Other cases execute the complete generated coordinator unchanged. Assertions verify default generated bytes and forbid modifying the file during a run.

## Native reader/API coverage

The UCB helper also executes both unchanged pinned public snapshot repositories and their actual HTTP handlers using synthetic compiler-derived SQL rows. It compares both readers and records five distinct cases:

1. Native `jobSeqNo` identity and the application URL both survive original projection/readers.
2. No accepted publication is HOLD with `visibleJobCount=null`; a verified zero result is PUBLISHING with `visibleJobCount=0` and zero public jobs.
3. The original GRACE reducer retains one job with actual last-present evidence.
4. A pending successor retains the verified last-good jobs and observation/source-success times, with DEGRADED health.
5. An invalid committed successor cannot masquerade as an unresolved attempt; the readers HOLD and publish no jobs.

These five cases are reported separately in the fixture manifest and referenced by the generated-entry report. They are not counted as 82 generated-entry cases.

## Evidence boundary

These are actual generated-source control-flow and authority-composition tests with synthetic external ports. Child/session terminal facts, SQL results, CLI classification, durable lifecycle acknowledgments and AX/DOM transport are synthetic. They do not establish real child termination, filesystem atomicity, original outer-holder SH/EX behavior, installed closure or production execution.

First-public null contexts and the original-compiler UCB GRACE context are fixture inputs. The generated suite's `classify-context` port is synthetic: NOT_DUE with null first-public inputs is deliberate close-control-flow coverage, not a claim about native due policy. Native due boundaries require their separate tests.

Each report records current generated hashes, exact fixture hashes, source calls, contexts, due inputs, events and completed count. No earlier two/three-source case count is inherited. UCB source plan/config, catalog, core and readers are unchanged by this work.
