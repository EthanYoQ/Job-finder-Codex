# Fixed functions host: canonical source and deployment boundary

The previous `functions-entry.js` was a disabled placeholder. This generated
replacement contains the reviewed whole-round implementation and only exports
`runLiveRound()` with no arguments. Its activation is always false when built.
It captures supported tools inside its closure; no task JSON can supply a port,
command, path, SQL, permit, deployment selector or activation setting.

## Source closure

Maintained implementation: `functions/body.template.js`,
`functions/private-live-permits.js`, `functions/sha256.js`,
`functions/host-helper.js`, `functions/read-response-transport.js`, and the
identity-free `functions/bootstrap-query.sql.template`.

`scripts/build-shared-cores.py` transforms the existing canonical pipe and
observer bundles. The exact reviewed core bytes are asserted. There is no new
parallel state machine. `scripts/build-functions-entry.py` assembles those cores,
the existing public verification bundle, and the original READ_OUTCOME SELECT
extracted from canonical `cloudSourcePilotRelay.ts`. Every generator input is
listed by relative path and SHA in `functions/source-pins.json`.

`render-fixed-live-source.py` and `templates/*.in` render the three reviewed
local CLI/preflight/recovery files for the one fixed LIVE root. Their input is
source only. No future commit, runtime hash, candidate row, deployment digest or
registration receipt is written back into a source template.

The UI, original TEST pipe/observer bundles and relay remain at their existing
canonical paths. The old `run-one-round.mts`, fixture child, synthetic UI port and
related files are reference tests, not the functions runtime entry.

## Rebuild

After integrating the source patch into the full package:

    PYTHONDONTWRITEBYTECODE=1 python fixed-host/scripts/build-functions-entry.py check-default-source
    PYTHONDONTWRITEBYTECODE=1 python fixed-host/scripts/build-shared-cores.py --check
    PYTHONDONTWRITEBYTECODE=1 python fixed-host/tests/canonical-build.test.py

The tracked default entry is generated, reviewable and disabled. The writer
operation `write-default-source` only creates a missing file with exclusive
creation; it will never overwrite an existing artifact. Source changes require
reviewing and regenerating the tracked artifact and source pins together.

Only after the new source really exists remotely may the original complete
package/runtime preflight derive its real build identity and expected 16-field
candidate row. Deployment data stays outside the repository, at the single fixed
LIVE root in `deployments/<sha256>.json`. No current TEST root is converted to LIVE.

`check-deployment` and `emit-deployment` use only the fixed digest environment
selector, that immutable JSON, its declared source manifest, and canonical
source. They do not accept an arbitrary path or callback. The generator checks
all listed source bytes and closes its own input set; this does not replace the
original launch preimport's complete package/runtime/Node/deps qualification.
The emitted entry remains disabled, has no future self-referential source hash,
and is written once to the fixed external `candidate/functions-entry.js`.
This generator neither creates a LIVE directory nor performs registration,
bootstrap queries, source capture, publication, browser actions or scheduling.

## Test-only evidence

The two V8 harness sources use synthetic ports and explicit fixture data passed
by a test driver. Fixtures, generated LIVE-SYNTHETIC/HYBRID entries, local source
manifests, candidate rows, controls, SQL relay files, actual tool output bodies,
round directories and diagnostics are not production source inputs and are not
included in this source-only patch. The runtime does not read those test files.

Canonicalization preserves the current body except the fixed root template,
keeps helper/transport/permit/digest bytes exact, generates the same two private
cores, and retains the exact original SELECT. The only assembly simplification
removes six unused, hash-only baseline snapshots from the prototype's SOURCES
constant. These were provenance copies, not executable dependencies.
