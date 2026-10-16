# Five-source composition: source implementation, NOT_RUN

The current driver validates `CLOSED_FIVE_SOURCE_RELEASE` in compile-fixed order
Takeda → Biogen → Hengrui → UCB → Viatris. It declares 106 scenarios; none is
claimed as executed in this SOURCE_ONLY phase. The historical four-source
82-case record is preserved separately in `GENERATED_COMPOSITION.md`.

`composition-source.test.mjs` checks six pure construction properties: actual
generated factory/source-port syntax and source-specific routing, including the
Viatris packet prefix and same-row URL/original-title payload. These checks do
not run native fixture generation or the complete generated business flow.

## Required native fixtures

Takeda/Biogen/Hengrui/UCB retain their original compiler fixture formats and
source identities. Viatris inputs must come from
`fixed-host/viatris/build-full-composition-fixture.mts`, which invokes the
unchanged original native acquisition, publication and projection compilers.
Its `one`, `seven`, and `eleven` variants use original synthetic Tupu fixtures;
zero must remain an original FAILED capture, never a fabricated success fixture.

The emitter requires a separately approved real runtime/dependency environment.
This candidate contains neither dependencies nor dist. A parent's build identity
cannot stand in for this successor's qualification. Any parent-native fixture
reuse must be explicitly identified and approved, preserving source/identity
evidence and without claiming a new-head runtime acceptance.

`five-source-generated-fixtures.mjs` only verifies and assembles already emitted
one/seven/eleven files. It never fabricates receipts or runs a compiler:

```text
PINNED_NODE five-source-generated-fixtures.mjs ONE_JSON SEVEN_JSON ELEVEN_JSON EXTERNAL_VIATRIS_MANIFEST
```

After approval and complete inputs, the current driver's argument order is:

```text
PINNED_NODE generated-composition.test.mjs TAKEDA_JSON BIOGEN_JSON HENGRUI_MANIFEST UCB_MANIFEST VIATRIS_MANIFEST EXTERNAL_REPORT
```

All input/output paths, caches and temporary files must be external, newly owned
and budgeted. Use the approved pinned Node, original no-network fork guard and
full before/after metadata verification. Borrowing dependencies needs its own
exact-path approval and must not overlap the parent's exclusive CLI E2E window.

## Declared coverage and limits

The 106 declared scenarios comprise one success, 18 scenarios per source,
six original-Promise/service ordering cases, three Hengrui variants, three UCB
variants, two Viatris variants and one capability case. They cover five distinct
states/CLIs/seed identities; UCB's original Promise and durable settlement before
Viatris construction; a pending or held Viatris tail preventing cycle close;
and each original private one-shot close capability. Source-specific adapters,
compilers, zero policies and exact UI identity are not substituted across sources.

The eventual composition still uses synthetic external SQL, CLI, child-terminal,
durable-acknowledgment and UI ports. Even a passing composition would not prove
real installation, process termination, production SQL, actual browser capture,
official collection, publication or activation. Pure Linux holder tests establish
their separate bounded filesystem/lock behavior, not native compiler acceptance.

SOURCE_ONLY status: native emitter NOT_RUN; full 106-case generated composition
NOT_RUN; derive-release, bound installation, installed five-CLI prepare probe and
bound runtime exercise NOT_RUN. All checked-in generated defaults are disabled.
