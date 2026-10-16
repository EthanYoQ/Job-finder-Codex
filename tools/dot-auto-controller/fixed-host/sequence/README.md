# Closed local Takeda → Biogen → Hengrui → UCB sequence

This candidate adds one compile-fixed, no-argument entry for four sources in one
immutable release. It is disabled by default. It is not a production activation,
scheduled-tick result, recovery authority, or a 36-source implementation.

## Identity and paths

- One candidate, original 16 fields, schema50 and 41-company registration
- One immutable source/runtime identity and original source-specific rules
- Fixed order: Takeda, then Biogen, then Hengrui, then UCB. No runtime source selector is exposed
- Shared readonly runtime checkout and Node/dependency tree
- Separate fixed `sources/takeda`, `sources/biogen`, `sources/hengrui` and `sources/ucb` state roots, rounds,
  binding files, allocation/execution locks and active-round pointers
- Separate pinned candidate CLI/preflight/recovery files and stable CLI entries
- One original lifecycle SH and durable ACTIVE throughout the complete sequence
- Sequence-only durable BEGIN/ACTIVE same-inode pair; ordinary journals retain
  their original single-link rule. A short byte-range lock on the original lock
  inode serializes begin creation without replacing SH/EX

`build-functions-entry.py` deterministically compiles the original source bodies,
pipe/observer cores, SQL extraction and source-specific UI ports. Its source
manifest closes all four profiles plus the native path binding, installer and
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
only after all four private close capabilities have been consumed by the same
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
artifact map contains all four profile CLIs and all four profile deployment documents,
as well as the single closed-release document. Generation never executes them.

Tests under `tests/` clearly distinguish source-only/unit/synthetic composition.
`test-bound-install.py` is a separate, explicitly measured TEST_ONLY installation
harness with synthetic official facts; it requires external measured pins and a
fresh owned case. Do not run it without the original free-space gate. Runtime,
measurement manifests and test evidence belong outside this source tree.

The last step of that TEST_ONLY installation is a prepare-only wiring probe of
all four installed stable CLIs under the original holder. It performs no child
launch or SQL call and deliberately retains unlaunched state and global HOLD.
The pre-probe installation/activation receipt is saved separately; this case
cannot be reused as a fresh cycle or called a completed four-source execution.

Production publication, official Supabase execution, the Aliyun reader/UI and a
real future scheduling tick still require their own authorized verification.

## Hengrui and merge boundary

Hengrui retains its actual Moka parser and owned compiler: source-hengrui-social,
canonical Moka job IDs and URLs, page size 50, verified total=0 valid, and original
US/HK exclusions. It does not use the Biogen Workday parser or zero-job rule.
The native Hengrui builder/core/UI and all seven original ready publications stay
unchanged; the private source-seal bridge is the same reviewed implementation.

This candidate directly descends from actual UCB head
36bd3c5a6052159cac47609bbc58750012b74eb0. Its 48e three-source ancestry and
original b52/5ff merge parents remain exact history. Prior qualifications do not
qualify this new source. Negative history requires exactly eight ordered records;
there is no migration of prior single/two/three-source history and no recovered
completion authority. This iteration is source-only and small tests. Runtime,
measurement, fresh test installation and production remain separately gated.

The strict original Hengrui-only and UCB-only manifest refreshers still refuse
unrelated changes. Two four-source native state bindings carry explicit 36bd
parent provenance while retaining their full prior c53 chain. No original
source plan, configuration hash, roster, parser, compiler or reader is changed.

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
