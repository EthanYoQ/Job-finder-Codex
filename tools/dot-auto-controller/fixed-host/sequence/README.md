# Closed local Takeda → Biogen sequence

This candidate adds one compile-fixed, no-argument entry for two sources in one
immutable release. It is disabled by default. It is not a production activation,
scheduled-tick result, recovery authority, or a 36-source implementation.

## Identity and paths

- One candidate, original 16 fields, schema50 and 41-company registration
- One immutable source/runtime identity and original source-specific rules
- Fixed order: Takeda, then Biogen. No runtime source selector is exposed
- Shared readonly runtime checkout and Node/dependency tree
- Separate fixed `sources/takeda` and `sources/biogen` state roots, rounds,
  binding files, allocation/execution locks and active-round pointers
- Separate pinned candidate CLI/preflight/recovery files and stable CLI entries
- One original lifecycle SH and durable ACTIVE throughout the complete sequence
- Sequence-only durable BEGIN/ACTIVE same-inode pair; ordinary journals retain
  their original single-link rule. A short byte-range lock on the original lock
  inode serializes begin creation without replacing SH/EX

`build-functions-entry.py` deterministically compiles the original source bodies,
pipe/observer cores, SQL extraction and source-specific UI ports. Its source
manifest closes both profiles plus the native path binding, installer and
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
only after both private close capabilities have been consumed by the same
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
artifact map contains both profile CLIs and both profile deployment documents,
as well as the single closed-release document. Generation never executes them.

Tests under `tests/` clearly distinguish source-only/unit/synthetic composition.
`test-bound-install.py` is a separate, explicitly measured TEST_ONLY installation
harness with synthetic official facts; it requires external measured pins and a
fresh owned case. Do not run it without the original free-space gate. Runtime,
measurement manifests and test evidence belong outside this source tree.

The last step of that TEST_ONLY installation is a prepare-only wiring probe of
both installed stable CLIs under the original holder. It performs no child
launch or SQL call and deliberately retains unlaunched state and global HOLD.
The pre-probe installation/activation receipt is saved separately; this case
cannot be reused as a fresh cycle or called a completed two-source execution.

Production publication, official Supabase execution, the Aliyun reader/UI and a
real future scheduling tick still require their own authorized verification.
