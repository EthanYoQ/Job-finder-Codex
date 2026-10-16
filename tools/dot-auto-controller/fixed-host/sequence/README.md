# Closed local Takeda → Biogen → Hengrui → UCB → Viatris sequence

This candidate adds one compile-fixed, no-argument entry for five sources in one
immutable release. It is disabled by default. It is not a production activation,
scheduled-tick result, recovery authority, or a 36-source implementation.

## Identity and paths

- One candidate, original 16 fields, schema50 and 41-company registration
- One immutable source/runtime identity and original source-specific rules
- Fixed order: Takeda, then Biogen, then Hengrui, then UCB, then Viatris. No runtime source selector is exposed
- A fresh source release requires separately qualified runtime identity; this SOURCE_ONLY
  candidate has no dependency tree, dist, installation or inherited runtime qualification
- Separate fixed `sources/takeda`, `sources/biogen`, `sources/hengrui`, `sources/ucb` and `sources/viatris` state roots, rounds,
  binding files, allocation/execution locks and active-round pointers
- Separate pinned candidate CLI/preflight/recovery files and stable CLI entries
- One original lifecycle SH and durable ACTIVE throughout the complete sequence
- Sequence-only durable BEGIN/ACTIVE same-inode pair; ordinary journals retain
  their original single-link rule. A short byte-range lock on the original lock
  inode serializes begin creation without replacing SH/EX

`build-functions-entry.py` deterministically compiles the original source bodies,
pipe/observer cores, SQL extraction and source-specific UI ports. Its source
manifest closes all five profiles plus the native path binding, installer and
activation renderers. Missing/cross-wired profile or shared identity drift rejects
the whole release. A profile cannot be installed or activated independently by
this release's outer entry.

## Safe progression

The next source is not even constructed before the first source's original
Promise and all pending service, helper, observer, response and raw-evidence
operations settle. Each source seals its mutation continuations and issues a
one-use in-memory capability for the exact original result/cycle identity.

The only accepted dispositions are VERIFIED, NOT_DUE, and the original strict
KNOWN_NOT_DISPATCHED. The latter retains the failure, requires the natural
same-session terminal, zero original PUBLISH calls, exact ready/request/packet/
marker/response/expiry checks, no host exception and a durable failure receipt.
It does not become a successful Observation or refresh crawledAt. The ordinary
reported source status remains HOLD for that safely closed failure.

The original holder records source start and settlement durably and completes
only after all five private close capabilities have been consumed by the same
coordinator. A durable BEGIN precedes ACTIVE creation, and complete historical lineage is
checked before a new cycle or EX mutation. Lost ACTIVE, partial records or
missing completion never restore authority. Each command and source barrier
rechecks the original ACTIVE/BEGIN pair and previous records. The original
owned finish retains BEGIN and removes only its paired ACTIVE.

Records are diagnostics, never recoverable permissions. Every
started source remains protected by the single global ACTIVE until that point.

UNKNOWN, possible dispatch, pending original work, integrity exceptions, lost
terminal/holder, UI failure, or early unclassified failures hold the whole cycle.
No lock is cleared on timeout, process death, recovered JSON, or exit status.

## Installation and testing

`render-install.py`, `bound-artifacts.py.in` and `activation-renderer.py` retain
the original EX install transaction, full source/runtime gates, reader identity,
registration freshness and one-boolean activation transform. The rendered
artifact map contains all five profile CLIs and all five profile deployment documents,
as well as the single closed-release document. Generation never executes them.

Tests under `tests/` clearly distinguish source-only/unit/synthetic composition.
`test-bound-install.py` is a separate, explicitly measured TEST_ONLY installation
harness with synthetic official facts; it requires external measured pins and a
fresh owned case. Do not run it without the original free-space gate. Runtime,
measurement manifests and test evidence belong outside this source tree.

The last step of that TEST_ONLY installation is a prepare-only wiring probe of
all five installed stable CLIs under the original holder. It performs no child
launch or SQL call and deliberately retains unlaunched state and global HOLD.
The pre-probe installation/activation receipt is saved separately; this case
cannot be reused as a fresh cycle or called a completed five-source execution.

Production publication, official Supabase execution, the Aliyun reader/UI and a
real future scheduling tick still require their own authorized verification.

## Hengrui and merge boundary

Hengrui retains its actual Moka parser and owned compiler: source-hengrui-social,
canonical Moka job IDs and URLs, page size 50, verified total=0 valid, and original
US/HK exclusions. It does not use the Biogen Workday parser or zero-job rule.
The native Hengrui builder/core/UI and all seven original ready publications stay
unchanged; the private source-seal bridge is the same reviewed implementation.

This candidate directly descends from sealed integration head
`e47896671e3b5bb100ac41f5211bb805be7818dc`. That exact merge retains ordered
parents `36a03b847f66e8d68d68e2cff1f00fd6b4b83b51` and
`bf192cdce3d3b13347ab51ca3b26120786d55544`, including the full earlier UCB,
Hengrui, shared completeness, legacy and B-selector provenance. Both changed
native fixed-layout bindings retain their entire e478 prior records under a
strict five-source derivative layer. Unrelated records and current bytes remain
unchanged. Prior runtime qualifications do not qualify this new source.

Current history requires exactly ten ordered start/settle records. Prior
four-source eight-record COMPLETE, ACTIVE or HOLD histories are rejected
without migration, appended records or recovered completion authority. Older
single/two/three-source history is likewise not valid five-source authority.
The original ordinary (non-sequence) journal rules remain unchanged.

This iteration is SOURCE_ONLY plus bounded pure Node/Python tests. The native
Viatris fixture emitter and current full generated composition are NOT_RUN.
The derive-release, bound installation, installed five-CLI prepare probe,
bound runtime exercise, real public UI and production paths are NOT_RUN here.
They require separately approved runtime/dependency identity and fresh evidence.

## UCB observed UI identity

UCB retains its original Phenom page-size 50/verified-zero/China and city rules,
independent 12-hour due gate, exact original READ_CONTEXT, source observation
and receipt tuple. Its native ID hashes jobSeqNo (or fallback reqId/jobId), while
the public URL may use a distinct reqId or same-origin applyUrl. The original
reader exposes the actual URL and original title, not native sourceJobId.
The fixed UI port therefore joins independently observed exact URL/title to a
receipt-verified, copied/frozen one-to-one projection map. Unknown or duplicate
URLs and ambiguous mappings HOLD; it never derives a native ID from a URL or
replaces observed page data with expected data. Raw AX and fixed DOM traversal,
count/deletion/source-card checks remain part of the actual composed test path.
Tests use synthetic external AX/DOM and database results; no real public UI or
application authorization is established here.

## Viatris observed UI identity

Viatris retains the original Tupu CONFIGURED_CHANNEL_TRAVERSAL: initial GET,
then the original next-page POST with max/offset/pageSize/social parameters.
There is no official total and zero jobs is FAILED under the original adapter.
Raw positionId, original title and parsed officialUrl are preserved. Native
source rules and compilers are unchanged.

The original reader's same visible `.job` row supplies `a.href` and `p.en`.
The anchor aria-label can be translated and is never the original-title
identity. After the original committed receipt/binding checks, an immutable
one-to-one exact URL → raw positionId map joins independently observed URL and
original title. Unknown/duplicate URLs, ambiguous mappings and title mismatches
HOLD. No Phenom identity or URL-derived job ID is used. The B6 source card must
also satisfy the row visibility/ancestor checks. Current UI tests use explicitly
synthetic DOM/AX and do not claim a real UI capture.

See `tests/FIVE_SOURCE_GENERATED_COMPOSITION.md` for the current declared
composition and its NOT_RUN boundary. `tests/GENERATED_COMPOSITION.md` retains
the historical four-source description and 82-case result only.
